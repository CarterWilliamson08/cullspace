$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'CullSpace.lnk'
$iconPath = Join-Path $root 'assets\cullspace.ico'
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $electron)) { throw "Electron not found at $electron." }
if (-not (Test-Path $iconPath)) { throw "Icon missing: $iconPath" }

# Remove old shortcut so Explorer does not keep a stale icon handle
if (Test-Path $shortcutPath) { Remove-Item -Force $shortcutPath }

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($shortcutPath)
$sc.TargetPath = $electron
$sc.Arguments = "`"$root`""
$sc.WorkingDirectory = $root
$sc.IconLocation = "$iconPath,0"
$sc.Description = 'CullSpace - scan and securely remove large files and apps'
$sc.Save()

# Ask Explorer to refresh desktop icons
try {
  $sig = @'
[DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
'@
  $type = Add-Type -MemberDefinition $sig -Name 'ShellNotify' -Namespace 'Win32' -PassThru
  # SHCNE_ASSOCCHANGED
  $type::SHChangeNotify(0x8000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
} catch {
  # best effort
}

Write-Host "Shortcut created: $shortcutPath"
Write-Host "IconLocation: $($sc.IconLocation)"
