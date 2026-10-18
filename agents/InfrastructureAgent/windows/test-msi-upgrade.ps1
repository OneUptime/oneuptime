<#
  The infrastructure agent's MSI on Windows, handled the way Intune or
  Configuration Manager handles it: silent installs (msiexec /qn) of two
  versions built by build-msi.sh, with the agent running as a service in
  between. The "Infrastructure Agent MSI Test" workflow runs it on Windows x64
  and on Windows on Arm.

  It checks that:
    - the older version installs per machine, into
      C:\Program Files\OneUptimeInfrastructureAgent, and that with no service
      yet the installer's attempt to start one is ignored;
    - `configure` and `start` run the agent as a service, reporting to a
      stand-in OneUptime on 127.0.0.1;
    - the newer version upgrades it in place: msiexec exits 0 (not 1638, as
      the fixed ProductCode made it, nor 3010, a restart of Windows because a
      file was in use), one agent is installed, its program is the newer
      build, and the installer has started the service again on it;
    - the older version then refuses to install over the newer one;
    - uninstalling removes the program and the service, and keeps the
      configuration.

  Usage: test-msi-upgrade.ps1 -Arch amd64|arm64 -MsiDirectory <dir>
    <dir>\1.0.0 and <dir>\1.0.1 each hold oneuptime-infrastructure-agent-<arch>.msi
    and agent-<arch>.exe, the program that MSI carries.
  Run it as an administrator, on a machine without the agent.
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('amd64', 'arm64')]
    [string] $Arch,

    [Parameter(Mandatory = $true)]
    [string] $MsiDirectory,

    [string] $LogDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) 'msi-logs')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName = 'oneuptime-infrastructure-agent'
$InstallDirectory = Join-Path $env:ProgramFiles 'OneUptimeInfrastructureAgent'
$Program = Join-Path $InstallDirectory 'oneuptime-infrastructure-agent.exe'
$ConfigFile = Join-Path $env:ProgramData 'oneuptime-infrastructure-agent\config.json'
$Port = 8087

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

function Fail([string] $Message) {
    Write-Host "::error::$Message"
    exit 1
}

function Expect([bool] $Condition, [string] $Message) {
    if (-not $Condition) {
        Fail $Message
    }
}

# msiexec, silently, logging verbosely to <LogDirectory>\<Name>.log. Returns
# its exit code. 1618 is another installation in progress, which a fresh
# runner's own updates can cause: wait and try again.
function Invoke-Msi([string] $Name, [string[]] $Arguments) {
    $log = Join-Path $LogDirectory "$Name.log"
    for ($attempt = 1; ; $attempt++) {
        $process = Start-Process -FilePath 'msiexec.exe' -Wait -PassThru `
            -ArgumentList ($Arguments + @('/qn', '/norestart', '/l*v', "`"$log`""))
        if ($process.ExitCode -ne 1618 -or $attempt -ge 10) {
            Write-Host "msiexec $($Arguments -join ' ') exited $($process.ExitCode)"
            return $process.ExitCode
        }
        Start-Sleep -Seconds 30
    }
}

# The agents Windows lists as installed, 64-bit and 32-bit packages both.
function Get-InstalledAgent {
    $keys = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    return @(Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object {
            $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like 'OneUptime Infrastructure Agent*'
        })
}

function Get-AgentService {
    return Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'"
}

function Wait-AgentRunning([string] $When) {
    $service = $null
    for ($second = 0; $second -lt 60; $second++) {
        $service = Get-AgentService
        if ($service -and $service.State -eq 'Running') {
            return $service
        }
        Start-Sleep -Seconds 1
    }
    $state = if ($service) { $service.State } else { 'not installed' }
    Fail "The agent's service is not running $When (it is $state)."
}

function Expect-Installed([string] $Version, [string] $ProgramFrom, [string] $When) {
    $installed = Get-InstalledAgent
    $listed = ($installed | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)" }) -join ', '
    Expect ($installed.Count -eq 1 -and $installed[0].DisplayVersion -eq $Version) `
        "$When, Windows lists [$listed], not one agent at $Version."
    Expect (Test-Path $Program) "$When, $Program is missing."
    Expect ((Get-FileHash $Program).Hash -eq (Get-FileHash $ProgramFrom).Hash) `
        "$When, $Program is not the $Version build."
}

$older = (Resolve-Path (Join-Path $MsiDirectory "1.0.0\oneuptime-infrastructure-agent-$Arch.msi")).Path
$newer = (Resolve-Path (Join-Path $MsiDirectory "1.0.1\oneuptime-infrastructure-agent-$Arch.msi")).Path
$olderProgram = (Resolve-Path (Join-Path $MsiDirectory "1.0.0\agent-$Arch.exe")).Path
$newerProgram = (Resolve-Path (Join-Path $MsiDirectory "1.0.1\agent-$Arch.exe")).Path

Expect ((Get-FileHash $olderProgram).Hash -ne (Get-FileHash $newerProgram).Hash) `
    'The two versions carry the same program, so the test could not tell them apart.'
Expect ((Get-InstalledAgent).Count -eq 0) 'An agent is installed before the test starts.'
Expect (-not (Get-AgentService)) "The $ServiceName service exists before the test starts."

# A stand-in OneUptime: it accepts any secret key and every report, so the
# agent keeps running as a service.
$server = Start-Job -ArgumentList $Port -ScriptBlock {
    param($Port)
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    $listener.Start()
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $body = [System.Text.Encoding]::UTF8.GetBytes('{}')
        $context.Response.StatusCode = 200
        $context.Response.ContentType = 'application/json'
        $context.Response.OutputStream.Write($body, 0, $body.Length)
        $context.Response.Close()
    }
}
$listening = $false
for ($second = 0; $second -lt 30 -and -not $listening; $second++) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $listening = $true
    } catch {
        Start-Sleep -Seconds 1
    }
}
Expect $listening "The stand-in OneUptime did not answer on port $Port. $(Receive-Job $server 2>&1)"

try {
    Write-Host '--- The older version, on a machine without the agent'
    $code = Invoke-Msi 'install-1.0.0' @('/i', "`"$older`"")
    Expect ($code -eq 0) "Installing 1.0.0 exited $code."
    Expect-Installed '1.0.0' $olderProgram 'After installing 1.0.0'
    Expect (-not (Get-AgentService)) 'The installer registered a service; configure does that.'

    Write-Host '--- configure and start'
    & $Program configure --secret-key=msi-upgrade-test "--oneuptime-url=http://127.0.0.1:$Port"
    Expect ($LASTEXITCODE -eq 0) "configure exited $LASTEXITCODE."
    & $Program start
    Expect ($LASTEXITCODE -eq 0) "start exited $LASTEXITCODE."
    $before = Wait-AgentRunning 'after configure and start'
    Expect ($before.PathName -like "*$InstallDirectory*") "The service runs $($before.PathName)."

    Write-Host '--- The newer version, over the running agent'
    $code = Invoke-Msi 'upgrade-1.0.1' @('/i', "`"$newer`"")
    Expect ($code -eq 0) ("Upgrading to 1.0.1 exited $code. 1638 means Windows would not upgrade the " +
        'installed version; 3010 means a file was in use and Windows must restart.')
    Expect-Installed '1.0.1' $newerProgram 'After the upgrade'
    $after = Wait-AgentRunning 'after the upgrade'
    Expect ($after.ProcessId -ne $before.ProcessId) 'The upgrade did not restart the service.'
    $running = (Get-Process -Id $after.ProcessId).Path
    Expect ($running -eq $Program) "The service runs $running, not $Program."

    Write-Host '--- The older version, over the newer one'
    $code = Invoke-Msi 'downgrade-1.0.0' @('/i', "`"$older`"")
    Expect ($code -eq 1603) "Installing 1.0.0 over 1.0.1 exited $code, not 1603 (refused)."
    Expect-Installed '1.0.1' $newerProgram 'After the refused downgrade'
    Wait-AgentRunning 'after the refused downgrade' | Out-Null

    Write-Host '--- Uninstall'
    $code = Invoke-Msi 'uninstall-1.0.1' @('/x', "`"$newer`"")
    Expect ($code -eq 0) "Uninstalling exited $code."
    Expect ((Get-InstalledAgent).Count -eq 0) 'Windows still lists the agent after uninstalling it.'
    Expect (-not (Test-Path $Program)) "Uninstalling left $Program."
    Expect (-not (Get-AgentService)) "Uninstalling left the $ServiceName service registered."
    Expect (Test-Path $ConfigFile) "Uninstalling deleted the agent's configuration, $ConfigFile."
} finally {
    Stop-Job $server -ErrorAction SilentlyContinue
    Remove-Job $server -Force -ErrorAction SilentlyContinue
}

Write-Host "PASS: the $Arch MSI installs, upgrades the running agent in place, refuses a downgrade and uninstalls."
