param([string]$Output = 'analysis/windows-wmi-class.json')
# Class definitions only. No Get-CimInstance or Invoke-CimMethod.
$ErrorActionPreference = 'Stop'
$class = Get-CimClass -Namespace root/wmi -ClassName AcerGamingFunction
function Convert-Qualifiers($Qualifiers) {
    @($Qualifiers | ForEach-Object { [pscustomobject]@{Name=$_.Name;Value=$_.Value} })
}
[pscustomobject]@{
    Class = $class.CimClassName
    Qualifiers = @(Convert-Qualifiers $class.CimClassQualifiers)
    Methods = @($class.CimClassMethods | ForEach-Object {
        [pscustomobject]@{
            Name = $_.Name
            Qualifiers = @(Convert-Qualifiers $_.Qualifiers)
            Parameters = @($_.Parameters | ForEach-Object {
                [pscustomobject]@{Name=$_.Name;Type=$_.CimType.ToString();Qualifiers=@(Convert-Qualifiers $_.Qualifiers)}
            })
        }
    })
} | ConvertTo-Json -Depth 9 | Set-Content -Encoding utf8 -LiteralPath $Output
