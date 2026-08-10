# Build a classic multi-size Windows .ico (32bpp BMP + AND mask) from assets/icon.png
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$pngPath = Join-Path $root 'assets\icon.png'
$icoPath = Join-Path $root 'assets\icon.ico'
if (-not (Test-Path $pngPath)) { throw "Missing $pngPath" }

function Get-IconImageBytes([System.Drawing.Bitmap]$bmp) {
  # Convert to 32bpp ARGB
  $w = $bmp.Width
  $h = $bmp.Height
  $clone = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($clone)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($bmp, 0, 0, $w, $h)
  $g.Dispose()

  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $data = $clone.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $stride = $data.Stride
    $bytes = New-Object byte[] ($stride * $h)
    [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

    # XOR bitmap is bottom-up BGRA
    $xor = New-Object byte[] ($w * $h * 4)
    for ($y = 0; $y -lt $h; $y++) {
      $srcY = $h - 1 - $y
      [Buffer]::BlockCopy($bytes, $srcY * $stride, $xor, $y * $w * 4, $w * 4)
    }

    # AND mask: 1 bit/pixel, padded to 32-bit rows, bottom-up
    $rowBytes = [Math]::Ceiling($w / 32.0) * 4
    $and = New-Object byte[] ($rowBytes * $h)
    for ($y = 0; $y -lt $h; $y++) {
      $srcY = $h - 1 - $y
      for ($x = 0; $x -lt $w; $x++) {
        $a = $bytes[($srcY * $stride) + ($x * 4) + 3]
        if ($a -lt 128) {
          $byteIndex = ($y * $rowBytes) + [Math]::Floor($x / 8)
          $bit = 7 - ($x % 8)
          $and[$byteIndex] = $and[$byteIndex] -bor (1 -shl $bit)
        }
      }
    }

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter $ms
    # BITMAPINFOHEADER
    $bw.Write([UInt32]40)
    $bw.Write([Int32]$w)
    $bw.Write([Int32]($h * 2)) # height includes AND mask
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]0)
    $bw.Write([UInt32]($xor.Length + $and.Length))
    $bw.Write([Int32]0)
    $bw.Write([Int32]0)
    $bw.Write([UInt32]0)
    $bw.Write([UInt32]0)
    $bw.Write($xor)
    $bw.Write($and)
    $bw.Flush()
    return $ms.ToArray()
  }
  finally {
    $clone.UnlockBits($data)
    $clone.Dispose()
  }
}

$sizes = @(16, 32, 48, 256)
$src = [System.Drawing.Image]::FromFile($pngPath)
$images = @()
try {
  foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()
    $images += ,@{ Size = $s; Bytes = (Get-IconImageBytes $bmp) }
    $bmp.Dispose()
  }

  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]$images.Count)

  $offset = 6 + (16 * $images.Count)
  foreach ($img in $images) {
    $s = $img.Size
    $len = $img.Bytes.Length
    $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
    $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$len)
    $bw.Write([UInt32]$offset)
    $offset += $len
  }
  foreach ($img in $images) { $bw.Write($img.Bytes) }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
  Write-Host "Wrote $icoPath ($((Get-Item $icoPath).Length) bytes)"
}
finally {
  $src.Dispose()
}
