param(
  [Parameter(Mandatory = $true)]
  [string] $BinaryPath,

  [Parameter(Mandatory = $true)]
  [string] $ServiceName
)

# Get the absolute path of the binary
$BinaryFullPath = Get-FullPath -Path $BinaryPath

# Check if binary exists
if (-not (Test-Path $BinaryFullPath)) {
  Write-Error "Error: Binary '$BinaryPath' not found."
  exit 1
}

# Create a service configuration object
$serviceConfig = New-Object System.ServiceProcess.ServiceProcessInstaller

$serviceConfig.Account = ServiceAccount::LocalSystem
$serviceConfig.DisplayName = $ServiceName
$serviceConfig.StartType = ServiceStartMode::Demand

# Create a service executable object
$serviceExec = New-Object System.ServiceProcess.ServiceInstaller

$serviceExec.DisplayName = $ServiceName
$serviceExec.StartType = ServiceStartMode::Demand

# Set the path to the binary executable
$serviceExec.AddCommandLineArgument($BinaryFullPath)

# Install the service
try {
  [System.ServiceProcess.ServiceController]::Install($ServiceName, $serviceConfig, $serviceExec)
  Write-Host "Service '$ServiceName' installed successfully."
}
catch {
  Write-Error "Error installing service: $_"
  exit 1
}


# How to use this
# .\install_as_service.ps1 -BinaryPath "C:\path\to\your\binary.exe" -ServiceName MyService
