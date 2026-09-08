# 최신 로거 코드를 GitHub에서 받아 이 폴더 위에 덮어씁니다.
# Arduino IDE 보드 설정은 그대로입니다.
$ErrorActionPreference = "Stop"
$Branch = "cursor/t2can-can-logger-5292"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if ($args.Count -ge 1) {
  $RepoRoot = $args[0]
}
if (Test-Path (Join-Path $RepoRoot "t2can-logger.ino")) {
  $RepoRoot = Split-Path -Parent $RepoRoot
}
if (-not (Test-Path (Join-Path $RepoRoot "t2can-logger\t2can-logger.ino"))) {
  Write-Error "저장소 폴더가 아닙니다: $RepoRoot"
}

Write-Host "대상: $RepoRoot"
Write-Host "Arduino IDE 는 닫아 두세요."

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("t2can-upd-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $Zip = Join-Path $Tmp "src.zip"
  $Url = "https://github.com/kwaktai/teslaFleetAPI/archive/refs/heads/$Branch.zip"
  Write-Host "다운로드 중..."
  Invoke-WebRequest -Uri $Url -OutFile $Zip
  Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
  $Src = Get-ChildItem $Tmp -Directory | Where-Object { $_.Name -like "teslaFleetAPI-*" } | Select-Object -First 1
  if (-not $Src) {
    Write-Error "ZIP 안에 저장소 폴더가 없습니다."
  }
  $null = & robocopy $Src.FullName $RepoRoot /E /NFL /NDL /NJH /NJS /XD .git data __pycache__ /XF .env "canlog-*.csv"
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed: $LASTEXITCODE"
  }
} finally {
  Remove-Item -Recurse -Force $Tmp
}

Write-Host "완료. 다음부터는 t2can-logger 폴더에서:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\update-from-github.ps1"
Write-Host "로거만 다시 열려면:  $RepoRoot\t2can-logger\t2can-logger.ino"
