param(
    [string]$BasePath = "/xiangqi/",
    [string]$OutputRoot = "dist\github-pages",
    [string]$PackageName = "xiangqi"
)

$ErrorActionPreference = "Stop"

function Ensure-Trailing-Slash {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return "/"
    }
    if (-not $Value.StartsWith("/")) {
        $Value = "/" + $Value
    }
    if (-not $Value.EndsWith("/")) {
        $Value += "/"
    }
    return $Value
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BasePath = Ensure-Trailing-Slash $BasePath
$outputRootPath = Join-Path $repoRoot $OutputRoot
$packageRoot = Join-Path $outputRootPath $PackageName
$zipPath = Join-Path $outputRootPath "$PackageName-github-pages.zip"

if (Test-Path $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

$copyItems = @(
    "assets",
    "wasm",
    "index.6cb394a3.css",
    "index.db1f3122.js",
    "MainView.03b1c0fb.css",
    "MainView.809a0694.js",
    "manifest.webmanifest",
    "icon.svg",
    "favicon-pinned.svg",
    "workbox-window.prod.es5.983a7963.js",
    "sw.js",
    "VschessTestView.369da1df.js",
    "VschessTestView.b918d83e.css",
    "vschess.function.9e74de8e.js",
    "analyze.svg",
    "arrow-double-left.svg",
    "arrow-double-right.svg",
    "arrow-left-bold.svg",
    "arrow-right-bold.svg",
    "clear.svg",
    "computer_black.svg",
    "computer_red.svg",
    "edit.svg",
    "flash.svg",
    "flip.svg",
    "new.svg",
    "paste.svg",
    "settings.svg",
    "share.svg"
)

foreach ($item in $copyItems) {
    $source = Join-Path $repoRoot $item
    if (-not (Test-Path $source)) {
        continue
    }
    $destination = Join-Path $packageRoot $item
    $parent = Split-Path -Parent $destination
    if ($parent) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

$indexHtml = @"
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Pikafish Xiangqi</title>
  <meta name="description" content="Pikafish Xiangqi web build for GitHub Pages.">
  <meta name="theme-color" content="#d8c891">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Pikafish Xiangqi">
  <link rel="icon" href="./icon.svg" type="image/svg+xml">
  <link rel="mask-icon" href="./favicon-pinned.svg" color="#b1624d">
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="stylesheet" href="./index.6cb394a3.css">
  <script>
    window.__APP_BASE__ = "$BasePath";
  </script>
</head>
<body>
  <noscript>This page requires JavaScript.</noscript>
  <div id="app"></div>
  <script type="module" src="./index.db1f3122.js"></script>
</body>
</html>
"@
Set-Content -LiteralPath (Join-Path $packageRoot "index.html") -Value $indexHtml -Encoding UTF8

$manifestPath = Join-Path $packageRoot "manifest.webmanifest"
if (Test-Path $manifestPath) {
    $manifest = Get-Content -Raw -LiteralPath $manifestPath
    $manifest = $manifest -replace '"start_url"\s*:\s*"[^"]*"', ('"start_url": "' + $BasePath + '"')
    $manifest = $manifest -replace '"scope"\s*:\s*"[^"]*"', ('"scope": "' + $BasePath + '"')
    $manifest = $manifest -replace '"src"\s*:\s*"/icon\.svg"', '"src": "./icon.svg"'
    $manifest = $manifest -replace '"src"\s*:\s*"icon\.svg"', '"src": "./icon.svg"'
    Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8
}

$indexJsFiles = @(
    (Join-Path $packageRoot "index.db1f3122.js"),
    (Join-Path $packageRoot "assets\index.db1f3122.js")
)

foreach ($file in $indexJsFiles) {
    if (-not (Test-Path $file)) {
        continue
    }
    $content = Get-Content -Raw -LiteralPath $file
    $content = $content.Replace('Yw="/"', 'Yw=window.__APP_BASE__||"/"')
    $content = $content.Replace('if("serviceWorker"in navigator){', 'if(!1&&"serviceWorker"in navigator){')
    $content = $content.Replace('new v("/sw.js",{scope:"/",type:"classic"})', 'new v((window.__APP_BASE__||"/")+"sw.js",{scope:window.__APP_BASE__||"/",type:"classic"})')
    $content = $content.Replace('o?o("/sw.js",E):s==null||s(E)', 'o?o((window.__APP_BASE__||"/")+"sw.js",E):s==null||s(E)')
    Set-Content -LiteralPath $file -Value $content -Encoding UTF8
}

$mainViewPath = Join-Path $packageRoot "assets\MainView.809a0694.js"
if (Test-Path $mainViewPath) {
    $mainView = Get-Content -Raw -LiteralPath $mainViewPath
    $mainView = $mainView.Replace('/assets/', ($BasePath + 'assets/'))
    $mainView = $mainView.Replace('Lt.import("/wasm/"+e+"/pikafish.js")', 'Lt.import((window.__APP_BASE__||"/")+"wasm/"+e+"/pikafish.js")')
    $mainView = $mainView.Replace('window.location.origin+"/wasm/data/"+i', 'window.location.origin+(window.__APP_BASE__||"/")+"wasm/data/"+i')
    $mainView = $mainView.Replace('window.location.origin+"/wasm/"+e+"/"+i', 'window.location.origin+(window.__APP_BASE__||"/")+"wasm/"+e+"/"+i')
    $mainView = $mainView.Replace('this.Engine.postMessage({wasm_type:e,origin:window.location.origin})', 'this.Engine.postMessage({wasm_type:e,origin:window.location.origin+(window.__APP_BASE__||"/").replace(/\/$/,"")})')
    $mainView = $mainView.Replace(',"Skill Level":20', '')
    $mainView = $mainView.Replace('setoption name Skill Level value 20', 'setoption name MultiPV value 1')
    Set-Content -LiteralPath $mainViewPath -Value $mainView -Encoding UTF8
}

$assetJsFiles = Get-ChildItem -LiteralPath (Join-Path $packageRoot "assets") -File -Filter "*.js" -ErrorAction SilentlyContinue
foreach ($file in $assetJsFiles) {
    $content = Get-Content -Raw -LiteralPath $file.FullName
    $updated = $content.Replace('"/assets/', ('"' + $BasePath + 'assets/'))
    $updated = $updated.Replace("'/assets/", ("'" + $BasePath + 'assets/'))
    if ($updated -ne $content) {
        Set-Content -LiteralPath $file.FullName -Value $updated -Encoding UTF8
    }
}

Set-Content -LiteralPath (Join-Path $packageRoot ".nojekyll") -Value "" -Encoding ASCII

$readme = @"
Deploy target: $BasePath

Upload the CONTENTS of this folder to:
$PackageName/

For your repo, that means:
nguyenphanvn95.github.io/$PackageName/

If you use the root repository working tree directly, copy every file and folder inside this package into the '$PackageName' folder of that repo.
"@
Set-Content -LiteralPath (Join-Path $packageRoot "DEPLOY.txt") -Value $readme -Encoding UTF8

Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -Force

Write-Host "GitHub Pages package created:"
Write-Host "Folder: $packageRoot"
Write-Host "Zip:    $zipPath"
