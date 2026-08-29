# 로컬 사이트를 자체 완결형 단일 HTML 로 묶는다 (Artifact 게시용).
#   - CSS / JS 인라인, 이미지 data URI 화
#   - <html>/<head>/<body> 래퍼 제거 (Artifact 가 직접 감싼다)
# 사용: powershell -File build-artifact.ps1 <출력.html>

param([Parameter(Mandatory=$true)][string]$Out)

$ErrorActionPreference = 'Stop'
$PROJ = 'C:\Users\ujo21\OneDrive\Desktop\Claude_Project\1st_Project_Time_Website'

function Get-DataUri([string]$file) {
  $bytes = [System.IO.File]::ReadAllBytes($file)
  $ext = [System.IO.Path]::GetExtension($file).ToLower()
  $mime = switch ($ext) { '.png' { 'image/png' } '.svg' { 'image/svg+xml' } '.gif' { 'image/gif' } '.webp' { 'image/webp' } default { 'image/jpeg' } }
  return 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
}

$html = [System.IO.File]::ReadAllText((Join-Path $PROJ 'index.html'))
$css  = [System.IO.File]::ReadAllText((Join-Path $PROJ 'assets\css\style.css'))
$i18n = [System.IO.File]::ReadAllText((Join-Path $PROJ 'assets\js\i18n.js'))
$main = [System.IO.File]::ReadAllText((Join-Path $PROJ 'assets\js\main.js'))
$game = [System.IO.File]::ReadAllText((Join-Path $PROJ 'assets\js\game.js'))

# ---- 1. 이미지 경로 -> data URI ----
$refs = [System.Collections.Generic.HashSet[string]]::new()
foreach ($m in [regex]::Matches($html, '(?:src|href)="(assets/img/[^"]+)"')) { [void]$refs.Add($m.Groups[1].Value) }
foreach ($rel in $refs) {
  $abs = Join-Path $PROJ ($rel -replace '/', '\')
  if (-not (Test-Path $abs)) { throw "missing image: $rel" }
  $html = $html.Replace('"' + $rel + '"', '"' + (Get-DataUri $abs) + '"')
}
Write-Host ("inlined images: " + $refs.Count)

# ---- 2. CSS / JS 인라인 ----
$pairs = @(
  @('<link rel="stylesheet" href="assets/css/style.css" />', "<style>`n$css`n</style>"),
  @('<script src="assets/js/i18n.js"></script>', "<script>`n$i18n`n</script>"),
  @('<script src="assets/js/main.js"></script>', "<script>`n$main`n</script>"),
  @('<script src="assets/js/game.js"></script>', "<script>`n$game`n</script>")
)
foreach ($p in $pairs) {
  if (-not $html.Contains($p[0])) { throw ("tag not found: " + $p[0]) }
  $html = $html.Replace($p[0], $p[1])
}

# ---- 3. 문서 래퍼 제거 ----
$title = '리브리드 REBREATHE'
$headM = [regex]::Match($html, '(?s)<head>(.*?)</head>')
$bodyM = [regex]::Match($html, '(?s)<body>(.*?)</body>')
if (-not $headM.Success -or -not $bodyM.Success) { throw 'head/body not found' }
$head = $headM.Groups[1].Value
$body = $bodyM.Groups[1].Value

$keep = [System.Collections.Generic.List[string]]::new()
$keep.Add('<title>' + $title + '</title>')
foreach ($pat in @(
    '<meta name="description"[^>]*>',
    '<meta property="og:[^>]*>',
    '<link rel="preconnect"[^>]*>',
    '<link href="https://fonts\.googleapis\.com[^>]*>',
    '<link rel="icon"[^>]*>')) {
  foreach ($m in [regex]::Matches($head, $pat)) { $keep.Add($m.Value) }
}
foreach ($m in [regex]::Matches($head, '(?s)<script>.*?</script>')) { $keep.Add($m.Value) }
foreach ($m in [regex]::Matches($head, '(?s)<style>.*?</style>')) { $keep.Add($m.Value) }
$keep.Add('<style>html{background:#ffffff;}body{background:#ffffff;margin:0;}</style>')

$outText = ($keep -join "`n") + "`n" + $body.Trim() + "`n"

$leftover = [regex]::Matches($outText, 'assets/(img|css|js)/').Count
if ($leftover -gt 0) { throw "remaining asset refs: $leftover" }

[System.IO.File]::WriteAllText($Out, $outText, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("wrote " + $Out)
Write-Host ("size: " + [math]::Round(((Get-Item $Out).Length / 1MB), 2) + " MB")
