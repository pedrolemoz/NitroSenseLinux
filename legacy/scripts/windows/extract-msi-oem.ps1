param(
    [string]$Msi = 'Installer/NitroSense_5.1_RC10_v5.1.392_20251115/Setup/NitroSenseConfig.msi',
    [string]$Destination = 'analysis/extracted/msi-oem'
)
$ErrorActionPreference = 'Stop'
# Only this audited MSI is supported. Database APIs below are read-only.
$expectedHash = '1a9715c8d4de31a8d88b2b3f61574ec53dca1b81eba07ccb0a00a41a3a3a2e10'
$msiPath = (Resolve-Path -LiteralPath $Msi).Path
$actualHash = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw 'MSI hash differs from audited 5.1.392 package; extraction refused.' }
$outputRoot = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $outputRoot) { throw "Destination already exists; refusing overwrite: $outputRoot" }
$ancestor = [IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($outputRoot))
while ($null -ne $ancestor) {
    if ($ancestor.Exists -and (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw "Reparse-point ancestor refused: $($ancestor.FullName)"
    }
    $ancestor = $ancestor.Parent
}
$expand = Join-Path $env:SystemRoot 'System32/expand.exe'
if (!(Test-Path -LiteralPath $expand -PathType Leaf)) { throw 'Windows expand.exe not found.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NitroReadOnlyMsi {
 [DllImport("msi.dll", CharSet=CharSet.Unicode, EntryPoint="MsiOpenDatabaseW")]
 public static extern uint Open(string path, IntPtr mode, out uint handle);
 [DllImport("msi.dll", CharSet=CharSet.Unicode, EntryPoint="MsiDatabaseOpenViewW")]
 public static extern uint View(uint db, string query, out uint view);
 [DllImport("msi.dll", EntryPoint="MsiViewExecute")]
 public static extern uint Execute(uint view, uint record);
 [DllImport("msi.dll", EntryPoint="MsiViewFetch")]
 public static extern uint Fetch(uint view, out uint record);
 [DllImport("msi.dll", CharSet=CharSet.Unicode, EntryPoint="MsiRecordGetStringW")]
 public static extern uint String(uint record, uint field, StringBuilder value, ref uint count);
 [DllImport("msi.dll", EntryPoint="MsiRecordReadStream")]
 public static extern uint Read(uint record, uint field, byte[] bytes, ref uint count);
 [DllImport("msi.dll", EntryPoint="MsiCloseHandle")]
 public static extern uint Close(uint handle);
}
'@
function Assert-MsiResult([uint32]$Code, [string]$Operation) {
    if ($Code -ne 0) { throw "MSI read failed ($Operation), Windows Installer code $Code" }
}
function Get-Table($Database, [string]$Name, [string[]]$Columns) {
    $query = 'SELECT ' + (($Columns | ForEach-Object { '`' + $_ + '`' }) -join ',') + ' FROM `' + $Name + '`'
    $view = $Database.OpenView($query)
    try {
        [void]$view.Execute()
        while ($null -ne ($record = $view.Fetch())) {
            try {
                $row = @{}
                for ($index = 0; $index -lt $Columns.Count; $index++) { $row[$Columns[$index]] = $record.StringData($index + 1) }
                [pscustomobject]$row
            } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
        }
    } finally {
        [void]$view.Close()
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
    }
}
function Get-LongName([string]$Value) {
    $target = $Value.Split(':')[0].Split('|')[-1]
    if (!$target -or $target -eq '.' -or $target -eq '..' -or $target -match '[\\/:\x00-\x1f]' -or $target.EndsWith('.') -or $target.EndsWith(' ')) {
        throw "Unsafe MSI target name: $Value"
    }
    return $target
}

$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $null
try {
    $database = $installer.OpenDatabase($msiPath, 0)
    $files = @(Get-Table $database 'File' @('File','Component_','FileName','FileSize','Sequence'))
    $components = @{}
    foreach ($entry in (Get-Table $database 'Component' @('Component','Directory_'))) { $components[$entry.Component] = $entry.Directory_ }
    $directories = @{}
    foreach ($entry in (Get-Table $database 'Directory' @('Directory','Directory_Parent','DefaultDir'))) { $directories[$entry.Directory] = $entry }
    $media = @(Get-Table $database 'Media' @('DiskId','LastSequence','Cabinet') | Sort-Object { [int]$_.LastSequence })
    $properties = @(Get-Table $database 'Property' @('Property','Value'))
} finally {
    if ($null -ne $database) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
}
$version = ($properties | Where-Object Property -eq 'ProductVersion').Value
if ($version -ne '5.1.392') { throw "Unexpected MSI ProductVersion: $version" }
$oemRootId = 'INSTALLFOLDER_OEM_NitroSense'
if (!$directories.ContainsKey($oemRootId)) { throw 'OEM NitroSense directory missing from MSI.' }
$planned = @()
$targetNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($file in $files) {
    if ($file.File -notmatch '^[A-Za-z0-9_.-]+$' -or $file.File -in @('.', '..')) { throw 'Unsafe cabinet File identifier.' }
    $directoryId = $components[$file.Component_]
    $segments = @()
    $visited = @{}
    while ($directoryId -and $directoryId -ne $oemRootId) {
        if ($visited.ContainsKey($directoryId) -or !$directories.ContainsKey($directoryId)) { throw 'Invalid MSI directory graph.' }
        $visited[$directoryId] = $true
        $entry = $directories[$directoryId]
        if ($entry.DefaultDir -ne '.') { $segments = @((Get-LongName $entry.DefaultDir)) + $segments }
        $directoryId = $entry.Directory_Parent
    }
    if ($directoryId -ne $oemRootId) { continue }
    $relative = (@($segments) + @(Get-LongName $file.FileName)) -join [IO.Path]::DirectorySeparatorChar
    if (!$targetNames.Add($relative)) { throw "Duplicate OEM target: $relative" }
    $disk = $media | Where-Object { [int]$_.LastSequence -ge [int]$file.Sequence } | Select-Object -First 1
    if (!$disk -or !$disk.Cabinet.StartsWith('#')) { throw 'Only embedded cabinets are supported.' }
    $planned += [pscustomobject]@{ File = $file.File; Relative = $relative; Size = [long]$file.FileSize; Cabinet = $disk.Cabinet.Substring(1) }
}
if (!($planned | Where-Object Relative -eq ('Common' + [IO.Path]::DirectorySeparatorChar + 'Settings.json'))) { throw 'Common/Settings.json missing from MSI mapping.' }

[void][IO.Directory]::CreateDirectory($outputRoot)
$workRoot = Join-Path $outputRoot '.extraction-work'
[void][IO.Directory]::CreateDirectory($workRoot)
$cabinetNames = @($planned.Cabinet | Sort-Object -Unique)
$databaseHandle = [uint32]0
$viewHandle = [uint32]0
try {
    Assert-MsiResult ([NitroReadOnlyMsi]::Open($msiPath, [IntPtr]::Zero, [ref]$databaseHandle)) 'open readonly'
    Assert-MsiResult ([NitroReadOnlyMsi]::View($databaseHandle, 'SELECT `Name`,`Data` FROM `_Streams`', [ref]$viewHandle)) 'streams view'
    Assert-MsiResult ([NitroReadOnlyMsi]::Execute($viewHandle, 0)) 'streams execute'
    $seen = @{}
    while ($true) {
        $recordHandle = [uint32]0
        $result = [NitroReadOnlyMsi]::Fetch($viewHandle, [ref]$recordHandle)
        if ($result -eq 259) { break }
        Assert-MsiResult $result 'streams fetch'
        try {
            $nameBuffer = [Text.StringBuilder]::new(1024)
            $nameLength = [uint32]1024
            Assert-MsiResult ([NitroReadOnlyMsi]::String($recordHandle, 1, $nameBuffer, [ref]$nameLength)) 'stream name'
            $name = $nameBuffer.ToString()
            if ($name -notin $cabinetNames) { continue }
            if ($name -notmatch '^cab[0-9]+\.cab$' -or $seen.ContainsKey($name)) { throw 'Unsafe or duplicate cabinet stream name.' }
            $seen[$name] = $true
            $cabinetPath = Join-Path $workRoot $name
            $stream = [IO.File]::Open($cabinetPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
            try {
                $buffer = [byte[]]::new(65536)
                do {
                    $count = [uint32]$buffer.Length
                    Assert-MsiResult ([NitroReadOnlyMsi]::Read($recordHandle, 2, $buffer, [ref]$count)) 'cabinet bytes'
                    if ($count -gt 0) { $stream.Write($buffer, 0, $count) }
                } while ($count -gt 0)
            } finally { $stream.Dispose() }
        } finally { [void][NitroReadOnlyMsi]::Close($recordHandle) }
    }
    if ($seen.Count -ne $cabinetNames.Count) { throw 'Not all required embedded cabinets were found.' }
} finally {
    if ($viewHandle) { [void][NitroReadOnlyMsi]::Close($viewHandle) }
    if ($databaseHandle) { [void][NitroReadOnlyMsi]::Close($databaseHandle) }
}

# Validate all CAB member names before invoking Windows decompression, preventing traversal.
$allFileIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($file in $files) { [void]$allFileIds.Add($file.File) }
foreach ($cabinet in $cabinetNames) {
    $cabinetPath = Join-Path $workRoot $cabinet
    $bytes = [IO.File]::ReadAllBytes($cabinetPath)
    if ($bytes.Length -lt 36 -or [Text.Encoding]::ASCII.GetString($bytes,0,4) -ne 'MSCF') { throw 'Invalid cabinet header.' }
    if ([BitConverter]::ToUInt32($bytes,8) -ne $bytes.Length) { throw 'Cabinet size mismatch.' }
    $offset = [int][BitConverter]::ToUInt32($bytes,16)
    $memberCount = [int][BitConverter]::ToUInt16($bytes,28)
    $members = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    for ($member = 0; $member -lt $memberCount; $member++) {
        $offset += 16
        if ($offset -ge $bytes.Length) { throw 'Truncated cabinet file table.' }
        $end = $offset
        while ($end -lt $bytes.Length -and $bytes[$end] -ne 0) { $end++ }
        if ($end -eq $bytes.Length) { throw 'Unterminated cabinet member name.' }
        $name = [Text.Encoding]::ASCII.GetString($bytes,$offset,$end-$offset)
        if ($name -notmatch '^[A-Za-z0-9_.-]+$' -or !$allFileIds.Contains($name) -or !$members.Add($name)) { throw "Unexpected or unsafe cabinet member: $name" }
        $offset = $end + 1
    }
    $expanded = Join-Path $workRoot ([IO.Path]::GetFileNameWithoutExtension($cabinet))
    [void][IO.Directory]::CreateDirectory($expanded)
    & $expand '-F:*' $cabinetPath $expanded | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "expand.exe failed for $cabinet with exit $LASTEXITCODE" }
}
$report = @()
foreach ($entry in $planned) {
    $source = Join-Path (Join-Path $workRoot ([IO.Path]::GetFileNameWithoutExtension($entry.Cabinet))) $entry.File
    $target = [IO.Path]::GetFullPath((Join-Path $outputRoot $entry.Relative))
    if (!$target.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Target escaped destination.' }
    $sourceItem = Get-Item -LiteralPath $source -Force
    if ($sourceItem.Length -ne $entry.Size -or ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Unexpected extracted file: $($entry.File)" }
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    [IO.File]::Copy($source, $target, $false)
    $report += [ordered]@{ path = $entry.Relative.Replace('\','/'); bytes = $entry.Size; sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() }
}
[ordered]@{ msiSha256 = $actualHash; productVersion = $version; evidence = 'Readonly MSI tables and embedded cabinet extraction; no installation or custom actions'; files = $report } |
    ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputRoot 'extraction-report.json') -Encoding utf8
$resolvedWork = [IO.Path]::GetFullPath($workRoot)
if ($resolvedWork -ne (Join-Path $outputRoot '.extraction-work') -or !$resolvedWork.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup path outside output.' }
Remove-Item -LiteralPath $resolvedWork -Recurse -Force
Write-Output "Extracted $($report.Count) OEM files to $outputRoot (version $version)."
