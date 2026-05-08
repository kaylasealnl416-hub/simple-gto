$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$port = 4173
$url = "http://127.0.0.1:$port/#autostart"
$bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
$stdout = Join-Path $root ".tmp-serve.log"
$stderr = Join-Path $root ".tmp-serve.err.log"

if (!(Test-Path -LiteralPath $bun)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("未找到 Bun: $bun", "简单GTO 启动失败", "OK", "Error") | Out-Null
  exit 1
}

function Test-LocalPort {
  param([int]$Port)
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $connect.AsyncWaitHandle.WaitOne(300)
    if ($ok) {
      $client.EndConnect($connect)
    }
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

function Test-AppReady {
  param([string]$Url)
  try {
    $request = [System.Net.WebRequest]::Create($Url)
    $request.Timeout = 800
    $response = $request.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    $body = $reader.ReadToEnd()
    $reader.Close()
    $response.Close()
    return $body -match "简单GTO"
  } catch {
    return $false
  }
}

$env:SystemRoot = "C:\WINDOWS"
$env:PORT = "$port"

if ((Test-LocalPort -Port $port) -and !(Test-AppReady -Url "http://127.0.0.1:$port/")) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("端口 $port 已被其他程序占用。请关闭占用程序后再打开简单GTO。", "简单GTO 启动失败", "OK", "Error") | Out-Null
  exit 1
}

if (!(Test-AppReady -Url "http://127.0.0.1:$port/")) {
  Start-Process `
    -FilePath $bun `
    -ArgumentList @("run", "serve") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr

  $ready = $false
  for ($i = 0; $i -lt 20; $i += 1) {
    Start-Sleep -Milliseconds 250
    if (Test-AppReady -Url "http://127.0.0.1:$port/") {
      $ready = $true
      break
    }
  }

  if (!$ready) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("本地服务未能启动，请查看：$stderr", "简单GTO 启动失败", "OK", "Error") | Out-Null
    exit 1
  }
}

Start-Process -FilePath "explorer.exe" -ArgumentList $url
