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
if ($status) {
  $message = "Update JOL $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  git add app.js server.js index.html styles.css data.json locations.json admin.html package.json package-lock.json README.md .gitignore .env.example publish.ps1
  git commit -m $message
} else {
  Write-Host 'No new file changes. Trying to push existing commits.' -ForegroundColor Yellow
}

git branch -M main
git push -u origin main
if ($LASTEXITCODE -ne 0) {
  throw 'GitHub push failed. Check your internet connection and run npm run publish again.'
}
Write-Host 'Done: changes pushed to GitHub. Render will deploy automatically.' -ForegroundColor Green
