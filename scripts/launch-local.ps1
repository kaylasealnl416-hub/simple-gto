$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$index = Join-Path $root "index.html"

if (!(Test-Path -LiteralPath $index)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("未找到入口文件: $index", "简单GTO 启动失败", "OK", "Error") | Out-Null
  exit 1
}

$url = ([System.Uri]$index).AbsoluteUri + "#autostart"
Start-Process $url
