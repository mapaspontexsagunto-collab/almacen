<#
.SYNOPSIS
  Copia las tablas del almacén desde Supabase a SQL Server (esquema "copia").

.DESCRIPTION
  La app sigue usando Supabase. Este script descarga los artículos, la configuración, los movimientos
  y el historial de precios de los dos almacenes y los guarda en SQL Server como copia de seguridad
  y para informes. Cada ejecución sustituye la copia anterior de cada tabla por la actual.

  Las columnas se crean solas a partir de los datos. Las fotos de los artículos no se copian salvo
  con -IncluirFotos. Cada ejecución deja una fila por tabla en copia.registro.

.EXAMPLE
  .\copiar-supabase.ps1 -GuardarCredencial
  Pide el correo y la contraseña de la cuenta de la app y los guarda cifrados para este usuario de Windows.

.EXAMPLE
  .\copiar-supabase.ps1
  Hace la copia con la configuración por defecto (.\SQLEXPRESS, base de datos Almacen_Mantenimiento).
#>
[CmdletBinding()]
param(
  [switch]$GuardarCredencial,
  [string]$Servidor = '.\SQLEXPRESS',
  [string]$BaseDatos = 'Almacen_Mantenimiento',
  [string]$CadenaConexion,
  [string]$Esquema = 'copia',
  [string]$FicheroCredencial = (Join-Path $PSScriptRoot 'credencial-supabase.xml'),
  [string]$FicheroRegistro = (Join-Path $PSScriptRoot 'copia-supabase.log'),
  [switch]$IncluirFotos,
  [string]$Proxy,
  [string]$SupabaseUrl = 'https://pttopgjtndbhtvrkuppk.supabase.co',
  [string]$SupabaseClave = 'sb_publishable_x2BxA94JGgKWqNR1tYXYPA_2s-C_wEy'
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 no activa TLS 1.2 por defecto y Supabase lo exige
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Orden estable para paginar sin saltarse ni repetir filas; se usan solo las columnas que existan
$Tablas = @(
  @{ Nombre = 'items';             Orden = @('id') },
  @{ Nombre = 'items_mec';         Orden = @('id') },
  @{ Nombre = 'config';            Orden = @('key') },
  @{ Nombre = 'config_mec';        Orden = @('key') },
  @{ Nombre = 'movements';         Orden = @('ts', 'itemId') },
  @{ Nombre = 'movements_mec';     Orden = @('ts', 'itemId') },
  @{ Nombre = 'price_history';     Orden = @('ts', 'item_id', 'id'); SoloAdmin = $true },
  @{ Nombre = 'price_history_mec'; Orden = @('ts', 'item_id', 'id'); SoloAdmin = $true }
)
$ColumnasFoto = @('photo')
$TamPagina = 1000

function Escribir-Log([string]$Texto) {
  $linea = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Texto
  Write-Host $linea
  try { Add-Content -Path $FicheroRegistro -Value $linea -Encoding UTF8 } catch { }
}

function Opciones-Red {
  $o = @{ UseBasicParsing = $true }
  if ($Proxy) { $o.Proxy = $Proxy; $o.ProxyUseDefaultCredentials = $true }
  return $o
}

if ($GuardarCredencial) {
  $c = Get-Credential -Message 'Correo y contraseña de una cuenta ADMINISTRADORA de la app del almacén'
  $c | Export-Clixml -Path $FicheroCredencial
  Write-Host "Credencial guardada en $FicheroCredencial (cifrada: solo la puede leer este usuario de Windows en este servidor)."
  exit 0
}

function Iniciar-Sesion {
  if (-not (Test-Path $FicheroCredencial)) { throw "No hay credencial guardada. Ejecuta primero: .\copiar-supabase.ps1 -GuardarCredencial" }
  $c = Import-Clixml -Path $FicheroCredencial
  $cuerpo = @{ email = $c.UserName; password = $c.GetNetworkCredential().Password } | ConvertTo-Json -Compress
  $red = Opciones-Red
  try {
    $r = Invoke-RestMethod @red -Method Post -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" `
      -Headers @{ apikey = $SupabaseClave } -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo))
  } catch {
    $st = 0; if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
    if ($st -eq 400) { throw "Supabase rechaza el correo o la contraseña guardados ($($c.UserName)). Si cambiaste la contraseña, ejecuta de nuevo -GuardarCredencial" }
    throw "No se pudo conectar con Supabase para iniciar sesión: $($_.Exception.Message)"
  }
  if (-not $r.access_token) { throw 'Supabase no devolvió sesión: revisa el correo y la contraseña guardados' }
  return $r.access_token
}

function Es-Admin([string]$Token) {
  $p = $Token.Split('.')[1].Replace('-', '+').Replace('_', '/')
  switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
  $datos = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
  return ($datos.app_metadata -and $datos.app_metadata.role -eq 'admin')
}

function Cabeceras([string]$Token) { return @{ apikey = $SupabaseClave; Authorization = "Bearer $Token" } }

function Pedir-Filas([string]$Token, [string]$Tabla, [string]$Consulta) {
  $red = Opciones-Red
  $r = Invoke-RestMethod @red -Method Get -Uri "$SupabaseUrl/rest/v1/$Tabla`?$Consulta" -Headers (Cabeceras $Token)
  if ($null -eq $r) { return , @() }
  return , @($r)
}

function Contar-Filas([string]$Token, [string]$Tabla) {
  $red = Opciones-Red
  $h = Cabeceras $Token
  $h.Prefer = 'count=exact'
  $resp = Invoke-WebRequest @red -Method Get -Uri "$SupabaseUrl/rest/v1/$Tabla`?select=*&limit=1" -Headers $h
  $rango = (@($resp.Headers['Content-Range']) -join '')
  if ($rango -match '/(\d+)$') { return [int64]$Matches[1] }
  throw "Supabase no devolvió el total de filas de $Tabla"
}

# Descarga todas las filas de una tabla. Devuelve $null si la tabla está vacía.
function Descargar-Tabla([string]$Token, [hashtable]$Def) {
  $tabla = $Def.Nombre
  $muestra = Pedir-Filas $Token $tabla 'select=*&limit=1'
  if ($muestra.Count -eq 0) { return $null }
  $columnas = @($muestra[0].PSObject.Properties | ForEach-Object { $_.Name })
  if (-not $IncluirFotos) { $columnas = @($columnas | Where-Object { $ColumnasFoto -notcontains $_ }) }
  $orden = @($Def.Orden | Where-Object { $columnas -contains $_ } | ForEach-Object { "$_.asc" }) -join ','
  $select = [uri]::EscapeDataString(($columnas -join ','))

  for ($intento = 1; $intento -le 2; $intento++) {
    $total = Contar-Filas $Token $tabla
    $filas = New-Object System.Collections.Generic.List[object]
    $offset = 0
    # Se avanza por las filas realmente recibidas: si Supabase limita la página a menos de $TamPagina no se pierde nada
    while ($offset -lt $total) {
      $q = "select=$select&limit=$TamPagina&offset=$offset"
      if ($orden) { $q += '&order=' + [uri]::EscapeDataString($orden) }
      $pagina = Pedir-Filas $Token $tabla $q
      if ($pagina.Count -eq 0) { break }
      foreach ($f in $pagina) { $filas.Add($f) }
      $offset += $pagina.Count
    }
    if ($filas.Count -ge $total) { break }
    if ($intento -eq 1) { Escribir-Log "  $tabla : faltan filas ($($filas.Count) de $total), se repite la descarga" }
  }
  return @{ Columnas = $columnas; Filas = $filas; Total = $total }
}

function Tipo-Valor($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [bool]) { return 'bit' }
  if ($v -is [int16] -or $v -is [int32] -or $v -is [int64] -or $v -is [byte]) { return 'bigint' }
  if ($v -is [double] -or $v -is [decimal] -or $v -is [single]) { return 'float' }
  if ($v -is [datetime]) { return 'datetime2' }
  if ($v -is [string]) {
    if ($v -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}') { return 'datetime2' }
    return 'nvarchar'
  }
  return 'json'
}

# Tipo SQL de cada columna según todos sus valores: si se mezclan tipos se guarda como texto
function Deducir-Tipos($Columnas, $Filas) {
  $tipos = @{}
  foreach ($c in $Columnas) {
    $vistos = @{}
    foreach ($f in $Filas) { $t = Tipo-Valor $f.$c; if ($t) { $vistos[$t] = $true } }
    $k = @($vistos.Keys)
    if ($k.Count -eq 0) { $tipos[$c] = 'nvarchar' }
    elseif ($k.Count -eq 1) { $tipos[$c] = $k[0] }
    elseif (($k | Where-Object { $_ -notin @('bigint', 'float') }).Count -eq 0) { $tipos[$c] = 'float' }
    else { $tipos[$c] = 'nvarchar' }
  }
  return $tipos
}

function Valor-Sql($v, [string]$Tipo) {
  if ($null -eq $v) { return [DBNull]::Value }
  $inv = [Globalization.CultureInfo]::InvariantCulture
  switch ($Tipo) {
    'bit'       { return [bool]$v }
    'bigint'    { return [int64]$v }
    'float'     { return [double]$v }
    'datetime2' {
      if ($v -is [datetime]) { return $v.ToUniversalTime() }
      return [DateTimeOffset]::Parse([string]$v, $inv).UtcDateTime
    }
    'json'      { return (ConvertTo-Json -InputObject $v -Compress -Depth 20) }
    default {
      if ($v -is [string]) { return $v }
      if ((Tipo-Valor $v) -eq 'json') { return (ConvertTo-Json -InputObject $v -Compress -Depth 20) }
      return [Convert]::ToString($v, $inv)
    }
  }
}

function Q([string]$Nombre) { return '[' + $Nombre.Replace(']', ']]') + ']' }

$TipoSql = @{ bit = 'BIT'; bigint = 'BIGINT'; float = 'FLOAT'; datetime2 = 'DATETIME2(3)'; nvarchar = 'NVARCHAR(MAX)'; json = 'NVARCHAR(MAX)' }
$TipoNet = @{ bit = [bool]; bigint = [int64]; float = [double]; datetime2 = [datetime]; nvarchar = [string]; json = [string] }

function Ejecutar([System.Data.SqlClient.SqlConnection]$Cn, [string]$Sql, [hashtable]$Param = @{}, $Tx = $null) {
  $cmd = $Cn.CreateCommand()
  $cmd.CommandText = $Sql
  $cmd.CommandTimeout = 300
  if ($Tx) { $cmd.Transaction = $Tx }
  foreach ($k in $Param.Keys) {
    $v = $Param[$k]; if ($null -eq $v) { $v = [DBNull]::Value }
    [void]$cmd.Parameters.AddWithValue("@$k", $v)
  }
  return $cmd.ExecuteScalar()
}

function Preparar-Sql([System.Data.SqlClient.SqlConnection]$Cn) {
  Ejecutar $Cn "IF SCHEMA_ID(@e) IS NULL BEGIN DECLARE @s nvarchar(400) = N'CREATE SCHEMA ' + QUOTENAME(@e); EXEC(@s); END" @{ e = $Esquema } | Out-Null
  Ejecutar $Cn ("IF OBJECT_ID(@t, 'U') IS NULL CREATE TABLE $(Q $Esquema).[registro] (" +
    "id INT IDENTITY(1,1) PRIMARY KEY, fecha DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(), " +
    "tabla NVARCHAR(128) NOT NULL, filas INT NULL, estado NVARCHAR(20) NOT NULL, mensaje NVARCHAR(MAX) NULL)") @{ t = "$Esquema.registro" } | Out-Null
}

function Registrar([System.Data.SqlClient.SqlConnection]$Cn, [string]$Tabla, $Filas, [string]$Estado, [string]$Mensaje) {
  try {
    Ejecutar $Cn "INSERT INTO $(Q $Esquema).[registro] (tabla, filas, estado, mensaje) VALUES (@t, @f, @e, @m)" @{ t = $Tabla; f = $Filas; e = $Estado; m = $Mensaje } | Out-Null
  } catch { Escribir-Log "  (no se pudo anotar en $Esquema.registro: $($_.Exception.Message))" }
}

function Filas-Actuales([System.Data.SqlClient.SqlConnection]$Cn, [string]$Tabla) {
  $n = Ejecutar $Cn "IF OBJECT_ID(@t, 'U') IS NULL SELECT CAST(-1 AS BIGINT) ELSE SELECT CAST(SUM(p.rows) AS BIGINT) FROM sys.partitions p WHERE p.object_id = OBJECT_ID(@t) AND p.index_id IN (0, 1)" @{ t = "$Esquema.$Tabla" }
  if ($n -is [DBNull] -or $null -eq $n) { return 0 }
  return [int64]$n
}

# Carga la tabla en una tabla nueva y la cambia por la anterior en una transacción: quien consulte la copia
# ve siempre una versión completa, y si algo falla la copia anterior queda intacta.
function Guardar-Tabla([System.Data.SqlClient.SqlConnection]$Cn, [string]$Tabla, $Datos) {
  $columnas = $Datos.Columnas
  $tipos = Deducir-Tipos $columnas $Datos.Filas
  $conFecha = ($columnas -contains 'ts') -and ($tipos['ts'] -eq 'bigint') -and ($columnas -notcontains 'ts_fecha')

  $dt = New-Object System.Data.DataTable
  foreach ($c in $columnas) { [void]$dt.Columns.Add($c, $TipoNet[$tipos[$c]]) }
  if ($conFecha) { [void]$dt.Columns.Add('ts_fecha', [datetime]) }
  foreach ($f in $Datos.Filas) {
    $r = $dt.NewRow()
    foreach ($c in $columnas) { $r[$c] = Valor-Sql $f.$c $tipos[$c] }
    if ($conFecha -and $null -ne $f.ts) { $r['ts_fecha'] = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$f.ts).LocalDateTime }
    $dt.Rows.Add($r)
  }

  $nueva = "${Tabla}__nueva"
  $defs = @($columnas | ForEach-Object { "$(Q $_) $($TipoSql[$tipos[$_]]) NULL" })
  if ($conFecha) { $defs += '[ts_fecha] DATETIME2(3) NULL' }
  Ejecutar $Cn "IF OBJECT_ID(@t, 'U') IS NOT NULL DROP TABLE $(Q $Esquema).$(Q $nueva)" @{ t = "$Esquema.$nueva" } | Out-Null
  Ejecutar $Cn "CREATE TABLE $(Q $Esquema).$(Q $nueva) ($($defs -join ', '))" | Out-Null

  $bulk = New-Object System.Data.SqlClient.SqlBulkCopy($Cn)
  $bulk.DestinationTableName = "$(Q $Esquema).$(Q $nueva)"
  $bulk.BulkCopyTimeout = 600
  foreach ($col in $dt.Columns) { [void]$bulk.ColumnMappings.Add($col.ColumnName, $col.ColumnName) }
  $bulk.WriteToServer($dt)
  $bulk.Close()

  $tx = $Cn.BeginTransaction()
  try {
    Ejecutar $Cn "IF OBJECT_ID(@t, 'U') IS NOT NULL DROP TABLE $(Q $Esquema).$(Q $Tabla)" @{ t = "$Esquema.$Tabla" } $tx | Out-Null
    Ejecutar $Cn "EXEC sp_rename @viejo, @nuevo, 'OBJECT'" @{ viejo = "$Esquema.$nueva"; nuevo = $Tabla } $tx | Out-Null
    $tx.Commit()
  } catch { $tx.Rollback(); throw }
  return $dt.Rows.Count
}

# ---------------- Programa principal ----------------
$fallos = 0
Escribir-Log '=== Copia de Supabase a SQL Server ==='
try {
  $token = Iniciar-Sesion
  $admin = Es-Admin $token
  if (-not $admin) { Escribir-Log 'AVISO: la cuenta no es administradora; el historial de precios no se copia (Supabase solo se lo muestra a administradores).' }

  if (-not $CadenaConexion) { $CadenaConexion = "Server=$Servidor;Database=$BaseDatos;Integrated Security=True;Application Name=CopiaSupabase" }
  $cn = New-Object System.Data.SqlClient.SqlConnection($CadenaConexion)
  $cn.Open()
  Preparar-Sql $cn

  foreach ($def in $Tablas) {
    $t = $def.Nombre
    try {
      if ($def.SoloAdmin -and -not $admin) { Registrar $cn $t $null 'omitida' 'La cuenta no es administradora'; continue }
      $datos = Descargar-Tabla $token $def
      if ($null -eq $datos -or $datos.Filas.Count -eq 0) {
        $previas = Filas-Actuales $cn $t
        if ($previas -gt 0) {
          # Supabase devolvió 0 filas pero la copia tenía datos: no se borra la copia por si es un fallo pasajero
          Escribir-Log "  $t : AVISO, Supabase devuelve 0 filas; se conserva la copia anterior ($previas filas)"
          Registrar $cn $t 0 'aviso' "0 filas en Supabase; se conserva la copia anterior ($previas filas)"
        } else {
          Escribir-Log "  $t : vacía"
          Registrar $cn $t 0 'vacia' $null
        }
        continue
      }
      $n = Guardar-Tabla $cn $t $datos
      $msg = $null
      if ($n -lt $datos.Total) { $msg = "Se copiaron $n de $($datos.Total) filas (la tabla cambió durante la copia)" }
      Escribir-Log "  $t : $n filas"
      Registrar $cn $t $n 'ok' $msg
    } catch {
      $fallos++
      Escribir-Log "  $t : ERROR $($_.Exception.Message)"
      Registrar $cn $t $null 'error' $_.Exception.Message
    }
  }
  $cn.Close()
} catch {
  $fallos++
  Escribir-Log "ERROR: $($_.Exception.Message)"
}

if ($fallos -gt 0) { Escribir-Log "Terminado con $fallos error(es)"; exit 1 }
Escribir-Log 'Terminado correctamente'
exit 0
