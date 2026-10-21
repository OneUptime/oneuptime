<#
OneUptime host collector installer (Windows).

Adds this host to OneUptime in one command. It installs two programs from
the OpenTelemetry Collector releases (github.com/open-telemetry/
opentelemetry-collector-releases), each checked against the SHA-256 its
release publishes:

  - otelcol-contrib, the OpenTelemetry Collector, which reads this host;
  - opampsupervisor, which runs the collector and keeps it on the config
    OneUptime sends it over OpAMP. A config that does not start is rolled
    back to the last one that worked.

and runs them as the Windows service "oneuptime-collector", as LocalSystem,
like the collector of the manual guide: it reads every event log, the
Security log included, and every Windows service. Nothing else changes.

Run from an elevated PowerShell (Run as administrator); the Hosts page of
OneUptime fills in the values:

  & ([scriptblock]::Create((Invoke-RestMethod -Uri '<OneUptime URL>/docs/static/scripts/host-collector/install.ps1'))) -Url '<OneUptime URL>' -Key '<ingestion key>'

Parameters:
  -Url URL            Where OneUptime is (https://oneuptime.com).
  -Key KEY            A telemetry ingestion key of your project.
  -Label KEY=VALUE    Labels for the host: -Label 'env=production','team=web'.
  -EnvVar NAME=VALUE  Environment variables for the collector, for configs
                      that read ${env:NAME}.
  -Version VERSION    The collector release (default: the one this OneUptime
                      pins).
  -DownloadUrl URL    Download the releases from a mirror with the same
                      layout as GitHub's releases/download.
  -Proxy URL          Send the downloads and the collector's traffic through
                      this HTTP(S) proxy.
  -ReplaceExisting    Stop and disable a collector installed by hand (the
                      otelcol-contrib service) on this host.
  -Uninstall          Remove the service and everything this installed.

Run it again to change any of these, or to move to a new release.
#>
[CmdletBinding()]
param(
    [string]$Url = "",
    [string]$Key = "",
    [string[]]$Label = @(),
    [string[]]$EnvVar = @(),
    [string]$Version = "0.161.0",
    [string]$DownloadUrl = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download",
    [string]$Proxy = "",
    [switch]$ReplaceExisting,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2

$ServiceName = "oneuptime-collector"
$InstallDir = Join-Path $env:ProgramFiles "OneUptime Collector"
$DataDir = Join-Path $env:ProgramData "OneUptime Collector"
$StateDir = Join-Path $DataDir "state"
$ConfigFile = Join-Path $DataDir "supervisor.yaml"

function Stop-WithError([string]$Message) {
    throw "OneUptime collector installer: $Message"
}

function Test-Administrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# A value as a single-quoted YAML string: ' doubled, nothing else escaped.
function ConvertTo-YamlString([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-TrimmedUrl([string]$Value) {
    return $Value.Trim().TrimEnd("/")
}

function Test-UrlValue([string]$Value) {
    return $Value -match '^https?://[A-Za-z0-9._:/@%+=~-]+$'
}

function Test-KeyValue([string]$Value) {
    return $Value -match '^[A-Za-z0-9._-]+$'
}

# key=value (or key:value): a key of letters, digits and _ - . ; a value that
# may also hold : / @ and spaces.
function ConvertFrom-LabelText([string]$Text) {
    $separator = $Text.IndexOf("=")
    if ($separator -lt 0) {
        $separator = $Text.IndexOf(":")
    }
    if ($separator -le 0) {
        return $null
    }
    $labelKey = $Text.Substring(0, $separator).Trim()
    $labelValue = $Text.Substring($separator + 1).Trim()
    if ($labelKey -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$') {
        return $null
    }
    if ($labelValue -notmatch '^[A-Za-z0-9][A-Za-z0-9_.:/@ -]{0,127}$') {
        return $null
    }
    return @{ Key = $labelKey; Value = $labelValue }
}

function Stop-CollectorService {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.Status -ne "Stopped") {
        Stop-Service -Name $ServiceName -Force
    }
}

if (-not (Test-Administrator)) {
    Stop-WithError "Run this from an elevated PowerShell (Run as administrator)."
}

# Windows PowerShell 5.1 on Windows Server 2016 does not use TLS 1.2 by itself.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if ($Uninstall) {
    Write-Host "Removing the OneUptime collector from this host..."
    Stop-CollectorService
    if ($null -ne (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
        & sc.exe delete $ServiceName | Out-Null
    }
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir, $DataDir
    Write-Host "Done. The host stays in OneUptime with its history; delete it there if you no longer want it."
    return
}

$Url = Get-TrimmedUrl $Url
$DownloadUrl = Get-TrimmedUrl $DownloadUrl
$Key = $Key.Trim()

if (-not $Url) { Stop-WithError "-Url is required: where your OneUptime is, such as https://oneuptime.com." }
if (-not $Key) { Stop-WithError "-Key is required: a telemetry ingestion key of your project." }
if (-not (Test-UrlValue $Url)) { Stop-WithError "-Url must be an http:// or https:// address, such as https://oneuptime.com." }
if (-not (Test-KeyValue $Key)) { Stop-WithError "-Key does not look like an ingestion key. Copy it again from OneUptime." }
if (-not (Test-UrlValue $DownloadUrl)) { Stop-WithError "-DownloadUrl must be an http:// or https:// address." }
if ($Version -notmatch '^[0-9]+(\.[0-9]+)*$') { Stop-WithError "-Version must be a release number, such as 0.161.0." }
$Proxy = Get-TrimmedUrl $Proxy
if ($Proxy -and -not (Test-UrlValue $Proxy)) { Stop-WithError "-Proxy must be an http:// or https:// address, such as http://proxy:3128." }

$labelLines = ""
foreach ($text in $Label) {
    $parsed = ConvertFrom-LabelText $text
    if ($null -eq $parsed) {
        Stop-WithError "-Label $text is not a label this installer takes: use key=value with letters, digits and _ - . (a value may also hold : / @ and spaces)."
    }
    $labelLines += "      oneuptime.label.$($parsed.Key): $(ConvertTo-YamlString $parsed.Value)`n"
}

$envLines = ""
foreach ($text in $EnvVar) {
    $separator = $text.IndexOf("=")
    if ($separator -le 0) {
        Stop-WithError "-EnvVar $text must be NAME=VALUE."
    }
    $envName = $text.Substring(0, $separator)
    $envValue = $text.Substring($separator + 1)
    if ($envName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        Stop-WithError "-EnvVar $envName must be a name of letters, digits and _."
    }
    if ($envName -eq "ONEUPTIME_URL" -or $envName -eq "ONEUPTIME_INGESTION_KEY") {
        Stop-WithError "-EnvVar $envName is set by the installer from -Url and -Key."
    }
    if ($envValue.Contains("`n") -or $envValue.Contains("`r")) {
        Stop-WithError "-EnvVar $envName may not hold a line break."
    }
    $envLines += "    ${envName}: $(ConvertTo-YamlString $envValue)`n"
}

# The supervisor is released for amd64; Windows on Arm runs it as x64.
$Arch = "amd64"
$hostName = [System.Net.Dns]::GetHostName()

Write-Host "Installing the OneUptime collector (OpenTelemetry Collector $Version) on $hostName..."

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("oneuptime-collector-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

# Downloads a file and checks it against the SHA-256 published beside it.
function Get-CheckedDownload([string]$FromUrl, [string]$ToFile) {
    $proxyArguments = @{}
    if ($Proxy) {
        $proxyArguments["Proxy"] = $Proxy
    }
    Invoke-WebRequest -UseBasicParsing -Uri $FromUrl -OutFile $ToFile @proxyArguments
    Invoke-WebRequest -UseBasicParsing -Uri ($FromUrl + ".sha256") -OutFile ($ToFile + ".sha256") @proxyArguments
    $expected = ((Get-Content -Raw -Path ($ToFile + ".sha256")).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -Path $ToFile).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        Stop-WithError "The download of $FromUrl does not match its published SHA-256. Nothing was installed."
    }
}

try {
    $collectorArchive = "otelcol-contrib_${Version}_windows_${Arch}.tar.gz"
    $supervisorBinary = "opampsupervisor_${Version}_windows_${Arch}.exe"

    Get-CheckedDownload "$DownloadUrl/v$Version/$collectorArchive" (Join-Path $workDir $collectorArchive)
    Get-CheckedDownload "$DownloadUrl/cmd%2Fopampsupervisor%2Fv$Version/$supervisorBinary" (Join-Path $workDir "opampsupervisor.exe")

    # tar.exe ships with Windows 10 1803 and Windows Server 2019 and later.
    & tar.exe -xzf (Join-Path $workDir $collectorArchive) -C $workDir otelcol-contrib.exe
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError "The collector archive does not hold otelcol-contrib.exe."
    }

    Stop-CollectorService

    New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir, $StateDir | Out-Null
    Copy-Item -Force (Join-Path $workDir "otelcol-contrib.exe") (Join-Path $InstallDir "otelcol-contrib.exe")
    Copy-Item -Force (Join-Path $workDir "opampsupervisor.exe") (Join-Path $InstallDir "opampsupervisor.exe")
}
finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $workDir
}

# The supervisor's config holds the key: only SYSTEM and Administrators may
# read the folder it is in.
& icacls.exe $DataDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null

# A run of the installer starts the supervisor afresh: it asks OneUptime for
# its config again, which is how the end of this script knows OneUptime
# answered. The last config that worked stays, to roll back to.
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $StateDir "last_recv_remote_config.dat"), (Join-Path $StateDir "persistent_state.yaml")

$collectorPath = Join-Path $InstallDir "otelcol-contrib.exe"
$config = @"
# Written by the OneUptime host collector installer. To change it, run the
# installer again; the collector's own config comes from OneUptime.
server:
  endpoint: $(ConvertTo-YamlString "$Url/opamp/v1")
  headers:
    x-oneuptime-token: $(ConvertTo-YamlString $Key)

capabilities:
  accepts_remote_config: true
  reports_health: true
  reports_heartbeat: true
  # The config the collector runs, as the supervisor put it together - with
  # `${env:...} still unread, so it holds no key.
  reports_effective_config: true
  reports_own_metrics: false
  reports_own_logs: false
  reports_own_traces: false

agent:
  executable: $(ConvertTo-YamlString $collectorPath)
  # Check a new config with the collector before switching to it, and go
  # back to the last config that worked when one does not start.
  validate_config: true
  automatic_config_rollback: true
  config_apply_timeout: 20s
  bootstrap_timeout: 15s
  collector_crash_log_snippet_kib: 4
  passthrough_logs: true
  description:
    non_identifying_attributes:
      oneuptime.collector.installer: 'host-collector'
$($labelLines)  env:
    ONEUPTIME_URL: $(ConvertTo-YamlString $Url)
    ONEUPTIME_INGESTION_KEY: $(ConvertTo-YamlString $Key)
$($envLines)
storage:
  directory: $(ConvertTo-YamlString $StateDir)

telemetry:
  logs:
    level: info
"@

# UTF-8 without a byte order mark, which Windows PowerShell's Set-Content adds.
[System.IO.File]::WriteAllText($ConfigFile, $config.Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding $false))

# The supervisor writes its log to the Application event log under its
# service name.
if (-not [System.Diagnostics.EventLog]::SourceExists($ServiceName)) {
    [System.Diagnostics.EventLog]::CreateEventSource($ServiceName, "Application")
}

$existing = Get-Service -Name "otelcol-contrib" -ErrorAction SilentlyContinue
if ($null -ne $existing -and $existing.Status -eq "Running") {
    if ($ReplaceExisting) {
        Write-Host "Stopping the collector installed by hand (otelcol-contrib): OneUptime runs this host's collector now."
        Stop-Service -Name "otelcol-contrib" -Force
        Set-Service -Name "otelcol-contrib" -StartupType Disabled
    }
    else {
        Write-Host "Note: another OpenTelemetry Collector runs on this host (the otelcol-contrib service)."
        Write-Host "      If it sends this host's data to OneUptime too, stop it, or the host reports twice:"
        Write-Host "      Stop-Service otelcol-contrib; Set-Service otelcol-contrib -StartupType Disabled"
        Write-Host "      (or run this installer again with -ReplaceExisting)."
    }
}

$binaryPath = '"' + (Join-Path $InstallDir "opampsupervisor.exe") + '" --config "' + $ConfigFile + '"'
if ($null -eq (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    New-Service -Name $ServiceName -BinaryPathName $binaryPath -DisplayName "OneUptime Collector" -Description "OpenTelemetry Collector, configured by OneUptime." -StartupType Automatic | Out-Null
}
else {
    & sc.exe config $ServiceName binPath= $binaryPath start= auto | Out-Null
}
# Restart the service if it stops.
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

# The proxy, for the supervisor and the collector it runs: the service's own
# environment.
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
if ($Proxy) {
    New-ItemProperty -Path $serviceKey -Name "Environment" -PropertyType MultiString -Value @("HTTPS_PROXY=$Proxy", "HTTP_PROXY=$Proxy") -Force | Out-Null
}
else {
    Remove-ItemProperty -Path $serviceKey -Name "Environment" -ErrorAction SilentlyContinue
}

$startedAt = Get-Date
Start-Service -Name $ServiceName

# The HTTP status OneUptime refused the supervisor's key with, if it did,
# read from this run's events; empty while it has not.
function Get-RefusedStatus {
    $events = Get-WinEvent -FilterHashtable @{ LogName = "Application"; ProviderName = $ServiceName; StartTime = $startedAt } -ErrorAction SilentlyContinue
    foreach ($status in @("401", "403", "422")) {
        foreach ($logEvent in @($events)) {
            if ($null -ne $logEvent -and $logEvent.Message -like "*response from server: $status*") {
                return $status
            }
        }
    }
    return ""
}

Write-Host "Waiting for OneUptime to send this host its config..."
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    $refusal = Get-RefusedStatus
    if ($refusal) {
        Write-Host ""
        Write-Host "OneUptime refused the key (HTTP $refusal)."
        if ($refusal -eq "401") {
            Write-Host "The key is wrong, has expired or was deleted. Copy it again from OneUptime, or"
            Write-Host "create one under Project Settings > Telemetry Ingestion Keys, and run this again."
        }
        else {
            Write-Host "The key is disabled, is a browser key, or is pinned to one service. Use an enabled"
            Write-Host "server ingestion key from Project Settings > Telemetry Ingestion Keys, and run this again."
        }
        Write-Host "The collector stays installed and asks again every 30 seconds."
        exit 1
    }
    if (Test-Path (Join-Path $StateDir "last_recv_remote_config.dat")) {
        Write-Host ""
        Write-Host "Done. $hostName is connected to OneUptime and runs the config OneUptime sent it."
        Write-Host "It shows under Hosts now; its metrics and logs follow within a minute."
        Write-Host "Logs: Event Viewer > Windows Logs > Application, source $ServiceName."
        return
    }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "The collector is installed and running, but OneUptime has not answered yet."
Write-Host "Check that this host can reach $Url, and read Event Viewer > Windows Logs > Application, source $ServiceName."
