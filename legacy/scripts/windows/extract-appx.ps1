param(
    [string]$Appx = 'Installer/NitroSense_5.1_RC10_v5.1.392_20251115/UWP/51da90fb2fd64a69b6714b41d285f6c7.appx',
    [string]$Destination = 'analysis/extracted'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = (Resolve-Path -LiteralPath $Appx).Path
$target = [IO.Path]::GetFullPath((Join-Path (Get-Location) $Destination))
New-Item -ItemType Directory -Force -Path $target | Out-Null
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($member in @('AppxManifest.xml', 'app/resources/app.asar', 'app/NitroSense.exe')) {
        $entry = $zip.GetEntry($member)
        if (!$entry) { throw "Missing package member: $member" }
        $output = Join-Path $target ([IO.Path]::GetFileName($member))
        if (Test-Path -LiteralPath $output) { throw "Output already exists: $output" }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $output, $false)
    }
} finally {
    $zip.Dispose()
}
Get-FileHash -Algorithm SHA256 -LiteralPath $archive, (Join-Path $target 'app.asar')
