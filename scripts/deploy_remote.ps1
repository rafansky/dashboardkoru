param(
  [Parameter(Mandatory = $true)]
  [string]$User,
  [string]$HostName = "192.168.1.133",
  [string]$Password,
  [string]$HostKey = "SHA256:0ftcCNGtY+09lW9pQAlsOWasxcEnaqSGdCJu19de4BY",
  [string]$AppDir = "/opt/koru-dashboard",
  [int]$Port = 10101,
  [string]$DashboardPassword
)

$ErrorActionPreference = "Stop"

if (-not $Password) {
  $secure = Read-Host "SSH password" -AsSecureString
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}

if (-not $DashboardPassword) {
  $secureDashboard = Read-Host "Dashboard password" -AsSecureString
  $DashboardPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureDashboard)
  )
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$archive = Join-Path $env:TEMP "koru-dashboard.tar.gz"

Push-Location $root
try {
  if (Test-Path $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
  tar `
    --exclude ./.venv `
    --exclude ./screenshots `
    --exclude './data/*.db' `
    --exclude './uploads/*' `
    -czf $archive .

  pscp -batch -hostkey $HostKey -pw $Password $archive "${User}@${HostName}:/tmp/koru-dashboard.tar.gz"
  pscp -batch -hostkey $HostKey -pw $Password "scripts/install_remote.sh" "${User}@${HostName}:/tmp/koru-install.sh"

  $remote = "chmod +x /tmp/koru-install.sh && APP_DIR='$AppDir' PORT='$Port' SUDO_PASS='$Password' KORU_ACCESS_PASSWORD='$DashboardPassword' bash /tmp/koru-install.sh"
  plink -ssh -batch -hostkey $HostKey -pw $Password "${User}@${HostName}" $remote
}
finally {
  Pop-Location
}
