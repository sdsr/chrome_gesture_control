Add-Type -AssemblyName System.Drawing

function New-GestureIcon {
    param(
        [int]$Size,
        [string]$OutputPath
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Background circle - blue
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(74, 144, 217))
    $g.FillEllipse($brush, 0, 0, ($Size - 1), ($Size - 1))

    # Arrow - white
    $penWidth = [Math]::Max(($Size / 8), 1.5)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $penWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $p = [int]($Size * 0.25)
    $q = [int]($Size * 0.75)
    $mid = [int]($Size * 0.5)
    $arr = [int]($Size * 0.15)

    # Horizontal line
    $g.DrawLine($pen, $p, $mid, $q, $mid)
    # Arrowhead top
    $g.DrawLine($pen, ($q - $arr), ($mid - $arr), $q, $mid)
    # Arrowhead bottom
    $g.DrawLine($pen, ($q - $arr), ($mid + $arr), $q, $mid)

    $g.Dispose()
    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $brush.Dispose()
    $pen.Dispose()

    Write-Host "Created: $OutputPath ($Size x $Size)"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

New-GestureIcon -Size 16 -OutputPath (Join-Path $scriptDir "icon16.png")
New-GestureIcon -Size 48 -OutputPath (Join-Path $scriptDir "icon48.png")
New-GestureIcon -Size 128 -OutputPath (Join-Path $scriptDir "icon128.png")

Write-Host "All icons generated successfully!"
