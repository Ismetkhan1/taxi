$ErrorActionPreference = 'Stop'

if (-not (Test-Path '.git')) {
  git init
  git branch -M main
}

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  git remote add origin 'https://github.com/Ismetkhan1/taxi.git'
}

$status = git status --short
if (-not $status) {
  Write-Host 'No changes to publish.' -ForegroundColor Yellow
  exit 0
}

$message = "Update JOL $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git add app.js server.js index.html styles.css data.json locations.json admin.html package.json package-lock.json README.md .gitignore publish.ps1
git commit -m $message

git branch -M main
git push -u origin main
Write-Host 'Done: changes pushed to GitHub. Render will deploy automatically.' -ForegroundColor Green
