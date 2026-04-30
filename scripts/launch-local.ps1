$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$port = 4173
$url = "http://localhost:$port/#autostart"
$bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
$stdout = Join-Path $root ".tmp-serve.log"
$stderr = Join-Path $root ".tmp-serve.err.log"

if (!(Test-Path -LiteralPath $bun)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("未找到 Bun: $bun", "简单GTO 启动失败", "OK", "Error") | Out-Null
  exit 1
}

$env:SystemRoot = "C:\WINDOWS"
$env:PORT = "$port"
Start-Process `
  -FilePath $bun `
  -ArgumentList @("run", "serve") `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr

Start-Sleep -Seconds 2
Start-Process -FilePath "explorer.exe" -ArgumentList $url
