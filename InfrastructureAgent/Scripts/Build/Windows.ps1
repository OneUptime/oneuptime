# This is taken from: https://nodejs.org/api/single-executable-applications.html
# Run Base.sh

# This is a PowerShell script that builds the Windows version of the Infrastructure Agent.
SET SCRIPT_DIR=%~dp0
Write-Host "Scirpt Directory: $SCRIPT_DIR"
bash $SCRIPT_DIR/Base.sh
node --experimental-sea-config $SCRIPT_DIR/../../sea-config.json 
node -e "require('fs').copyFileSync(process.execPath, 'InfrastructureAgent.exe')" 
signtool remove /s InfrastructureAgent.exe
npx postject InfrastructureAgent.exe NODE_SEA_BLOB sea-prep.blob `
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 
signtool sign /fd SHA256 InfrastructureAgent.exe