$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$base = "https://xiangqi-wasm-dev.vercel.app"

$assetFiles = @(
  "list.975f5d54.js",
  "wr.ac00dd32.js",
  "wr.c66e167c.js",
  "wr.26132a75.js",
  "wr.98c86d26.js",
  "wr.fc88fbb7.js",
  "b_b.f7a4223f.js",
  "b_c.2571ead1.js",
  "b_k.33319e2d.js",
  "b_n.2001ed38.js",
  "b_p.3109a1c5.js",
  "b_r.96434e95.js",
  "ba.37ee2c28.js",
  "ba.38ac1c3c.js",
  "ba.45ed3e1e.js",
  "ba.70fc3c09.js",
  "ba.866dcae3.js",
  "ba.dcfcfeca.js",
  "bb.28d019b7.js",
  "bb.46f70563.js",
  "bb.4d09cca4.js",
  "bb.63efb096.js",
  "bb.8011c5ed.js",
  "bc.31ba7693.js",
  "bc.3d7e391c.js",
  "bc.4b9947af.js",
  "bc.52b1e82a.js",
  "bc.f763e347.js",
  "bk.74b02b8e.js",
  "bk.acdc9ccd.js",
  "bk.d097dab0.js",
  "bk.eecb67dd.js",
  "bk.ef2310dd.js",
  "black_first.136fe1ec.js",
  "black_first.52947b5b.js",
  "black_first.5d47c53d.js",
  "black_first.6ef3be1a.js",
  "black_first.bf9ab9c9.js",
  "black_first.ceaa5d7e.js",
  "bn.512582d9.js",
  "bn.6c3ff8e0.js",
  "bn.8b2fdc6e.js",
  "bn.90011ac2.js",
  "bn.b3938b71.js",
  "board.310ce401.js",
  "board.4d7749f0.js",
  "board.91ac12b0.js",
  "board.9b7a311c.js",
  "board.f0a86ec8.js",
  "board.f78104b1.js",
  "board_plain.08e6973d.js",
  "board_plain.2594d2fa.js",
  "board_plain.3465826b.js",
  "board_plain.3624fbae.js",
  "board_plain.74021086.js",
  "board_plain.d31cb4b7.js",
  "bp.15e6fc02.js",
  "bp.3f139d02.js",
  "bp.434120e3.js",
  "bp.63553d9e.js",
  "bp.817bbfa6.js",
  "br.34d8d469.js",
  "br.5d404e32.js",
  "br.74b36ce2.js",
  "br.a9efc337.js",
  "br.bffdaae7.js",
  "from.09a3f864.js",
  "from.15126225.js",
  "from.382faacb.js",
  "from.5fbc6b60.js",
  "from.ace69faa.js",
  "path_eat.01da33c4.js",
  "path_eat.12e8e6dc.js",
  "path_eat.2a5b9656.js",
  "path_eat.3952f335.js",
  "path_eat.811c5ac1.js",
  "path_eat.bb63b37a.js",
  "path_go.01ae3ebd.js",
  "path_go.0920f2e8.js",
  "path_go.12376e5b.js",
  "path_go.2ac4ba32.js",
  "path_go.c01ed0d9.js",
  "path_go.cc6965fe.js",
  "r_a.af192e0b.js",
  "r_b.375bf83a.js",
  "r_c.b18d07fb.js",
  "r_k.c47fa920.js",
  "r_n.6cb10911.js",
  "r_p.906a3c20.js",
  "r_r.bf5c3ce0.js",
  "red_first.0f87d299.js",
  "red_first.4577e3a4.js",
  "red_first.4859cd20.js",
  "red_first.50c095ec.js",
  "red_first.ba2ad802.js",
  "red_first.d2c41fdd.js",
  "selection.0a2647b5.js",
  "selection.2471212a.js",
  "selection.5136eb38.js",
  "selection.5f1c6a06.js",
  "selection.6cf34624.js",
  "selection.7dd83498.js",
  "wa.0d73253c.js",
  "wa.105ff044.js",
  "wa.430a138b.js",
  "wa.440f9648.js",
  "wa.a59da34a.js",
  "wb.47105b4d.js",
  "wb.61b05d5a.js",
  "wb.7ddbde00.js",
  "wb.b12906ba.js",
  "wb.bb8b5382.js",
  "wc.157a3283.js",
  "wc.167f0e88.js",
  "wc.9ce9b788.js",
  "wc.b38866b8.js",
  "wc.c99c1068.js",
  "wk.67b42361.js",
  "wk.7f11ff80.js",
  "wk.96c517ac.js",
  "wk.982007ed.js",
  "wk.fdf5690e.js",
  "wn.1c091f47.js",
  "wn.8e08b8d3.js",
  "wn.af6a34a4.js",
  "wn.b1adf4a9.js",
  "wn.c00f4b39.js",
  "wp.0a17795a.js",
  "wp.24279974.js",
  "wp.607ff16d.js",
  "wp.92db37f1.js",
  "wp.e3405abc.js"
)

New-Item -ItemType Directory -Force -Path "assets", "assets/svg", "wasm/single_simd", "wasm/data" | Out-Null

foreach ($file in $assetFiles) {
  $target = Join-Path "assets" $file
  if (-not (Test-Path $target)) {
    Invoke-WebRequest -UseBasicParsing "$base/assets/$file" -OutFile $target
  }
}

$svgNames = @(
  "analyze.svg",
  "arrow-double-left.svg",
  "arrow-double-right.svg",
  "arrow-left-bold.svg",
  "arrow-right-bold.svg",
  "clear.svg",
  "computer_black.svg",
  "computer_red.svg",
  "edit.svg",
  "exit.svg",
  "flash.svg",
  "flip.svg",
  "new.svg",
  "paste.svg",
  "settings.svg",
  "share.svg"
)

foreach ($svg in $svgNames) {
  $target = Join-Path "assets/svg" $svg
  if (Test-Path $svg) {
    Copy-Item -LiteralPath $svg -Destination $target -Force
  } else {
    Invoke-WebRequest -UseBasicParsing "$base/assets/svg/$svg" -OutFile $target
  }
}

Invoke-WebRequest -UseBasicParsing "$base/wasm/single_simd/pikafish.js" -OutFile "wasm/single_simd/pikafish.js"
Invoke-WebRequest -UseBasicParsing "$base/wasm/single_simd/pikafish.wasm" -OutFile "wasm/single_simd/pikafish.wasm"
Invoke-WebRequest -UseBasicParsing "$base/wasm/single_simd/pikafish.worker.js" -OutFile "wasm/single_simd/pikafish.worker.js"
Invoke-WebRequest -UseBasicParsing "$base/wasm/data/pikafish.data" -OutFile "wasm/data/pikafish.data"
