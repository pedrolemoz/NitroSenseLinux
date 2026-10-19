param(
    [string]$Msi = 'Installer/NitroSense_5.1_RC10_v5.1.392_20251115/Setup/NitroSenseConfig.msi',
    [string]$Output = 'analysis/msi-layout.json'
)
# Database mode 0 is read-only. No InstallProduct, msiexec or custom action runs.
$ErrorActionPreference = 'Stop'
$msiPath = (Resolve-Path -LiteralPath $Msi).Path
$installerDbApi = New-Object -ComObject WindowsInstaller.Installer
$db = $installerDbApi.OpenDatabase($msiPath, 0)
$tables = [ordered]@{}
$specs = @(
    @{ Name = 'File'; Columns = @('File', 'Component_', 'FileName', 'FileSize', 'Sequence') },
    @{ Name = 'Component'; Columns = @('Component', 'Directory_', 'Condition', 'KeyPath') },
    @{ Name = 'Directory'; Columns = @('Directory', 'Directory_Parent', 'DefaultDir') },
    @{ Name = 'Media'; Columns = @('DiskId', 'LastSequence', 'Cabinet') }
)
try {
    foreach ($spec in $specs) {
        $columns = ($spec.Columns | ForEach-Object { '`' + $_ + '`' }) -join ', '
        $query = 'SELECT ' + $columns + ' FROM `' + $spec.Name + '`'
        $view = $db.OpenView($query)
        try {
            $view.Execute()
            $rows = @()
            while ($null -ne ($rec = $view.Fetch())) {
                $row = [ordered]@{}
                for ($idx = 0; $idx -lt $spec.Columns.Count; $idx++) {
                    $row[$spec.Columns[$idx]] = $rec.StringData($idx + 1)
                }
                $rows += [pscustomobject]$row
            }
            $tables[$spec.Name] = $rows
        } finally {
            $view.Close()
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
        }
    }
    [ordered]@{
        path = $msiPath
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $msiPath).Hash.ToLowerInvariant()
        evidenceType = 'Read-only MSI database inventory; no installation executed'
        tables = $tables
    } | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -LiteralPath $Output
    $tables.GetEnumerator() | ForEach-Object { '{0}: {1} rows' -f $_.Key,$_.Value.Count }
} finally {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($db)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installerDbApi)
}
