#!/bin/bash

# Get the binary name and service name from arguments
BINARY_NAME="$1"
SERVICE_NAME="$2"

# Check if arguments are provided
if [ -z "$BINARY_NAME" ] || [ -z "$SERVICE_NAME" ]; then
  echo "Usage: $0 <binary_name> <service_name>"
  exit 1
fi

# Check if binary exists
if [ ! -f "$BINARY_NAME" ]; then
  echo "Error: Binary '$BINARY_NAME' not found."
  exit 1
fi

# Get the absolute path of the binary
BINARY_PATH=$(realpath "$BINARY_NAME")

# Create the launchd plist content
SERVICE_CONTENT=$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST File Format//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.example.$SERVICE_NAME</string>  <key>ProgramArguments</key>
  <array>
    <string>$BINARY_PATH</string>
  </array>
  <key>RunAsUser</key>
  <integer>501</integer>  <key>WorkingDirectory</key>
  <string>/path/to/your/binary/directory</string>  <key>StandardOutPath</key>
  <string>/var/log/$SERVICE_NAME.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/$SERVICE_NAME.err</string>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
EOF
)

# Create the plist file with a unique identifier
SERVICE_PLIST="/Library/LaunchDaemons/com.example.$SERVICE_NAME.plist"
echo "$SERVICE_CONTENT" > "$SERVICE_PLIST"

# Load and start the service
launchctl load "$SERVICE_PLIST"
launchctl start "com.example.$SERVICE_NAME"

echo "Service '$SERVICE_NAME' installed and started."


# How to use the script:

# Save the script as install_as_service.sh.

# Make the script executable: chmod +x install_as_service.sh.

# Run the script with the binary name and desired service name as arguments:

#./install_as_service.sh /path/to/your/binary my_service