# Captures the ReadS window to a PNG.
#
#   pwsh -File scripts/capture-window.ps1 -Out build/shots/app.png
#
# A capture process that is not DPI aware receives *virtualised* window
# coordinates from Windows: on a 150% display GetWindowRect reports 1440x900
# for a window that is really 2160x1350. PrintWindow then renders into a bitmap
# of the virtualised size and silently crops the right and bottom of the
# window, which looks exactly like a layout overflow bug in the app. Declaring
# per-monitor DPI awareness first avoids that trap entirely.
param(
    [string]$Out = 'build/shots/app-window.png',
    [string]$ProcessName = 'ReadS'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct CAPRECT { public int Left, Top, Right, Bottom; }
public class WinCapture {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out CAPRECT r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
}
"@

# 2 = PROCESS_PER_MONITOR_DPI_AWARE. Must run before any window query.
try { [WinCapture]::SetProcessDpiAwareness(2) | Out-Null } catch { }

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { throw "$ProcessName is not running" }

$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "$ProcessName has no main window yet" }

[WinCapture]::ShowWindow($hwnd, 9) | Out-Null
[WinCapture]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 1500

$rect = New-Object CAPRECT
[WinCapture]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$dpi = [WinCapture]::GetDpiForWindow($hwnd)

$root = Split-Path -Parent $PSScriptRoot
# Accept both an absolute path and one relative to the project root.
$target = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $root $Out }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$ok = [WinCapture]::PrintWindow($hwnd, $hdc, 2) # PW_RENDERFULLCONTENT
$graphics.ReleaseHdc($hdc)
$graphics.Dispose()
$bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

$scale = [math]::Round($dpi / 96, 3)
Write-Host ("captured {0} ({1}x{2} physical, dpi {3}, scale {4} -> {5}x{6} CSS)" -f `
    $target, $width, $height, $dpi, $scale,
    [int]($width / $scale), [int]($height / $scale))
