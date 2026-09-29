$ErrorActionPreference = 'Stop'
$product = Join-Path $PSScriptRoot '..\..'
$updater = Join-Path $product 'Luoxian.Updater.exe'
if (!(Test-Path -LiteralPath $updater)) { throw 'Native updater has not been built.' }
& $updater --self-test
if ($LASTEXITCODE -ne 0) { throw 'Updater self-tests failed.' }
