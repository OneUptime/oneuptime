#!/bin/bash

# 

# Check if curl is installed
if ! [ -x "$(command -v curl)" ]; then
  echo "Error: curl is not installed. Please install curl and return this command" >&2
  exit 1
fi

# Download the binary from the latest release from 
curl -L -o InfrastructureAgent

# Get the binary name and service name from arguments
BINARY_NAME="InfrastructureAgent"
SERVICE_NAME="infrastructure-agent"


# Check if binary exists
if [ ! -f "$BINARY_NAME" ]; then
  echo "Error: Binary '$BINARY_NAME' not found."
  exit 1
fi

# Get the absolute path of the binary
BINARY_PATH=$(realpath "$BINARY_NAME")

# Create the systemd service file content
SERVICE_CONTENT=$(cat <<EOF
[Unit]
Description=$SERVICE_NAME Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/your/binary/directory  # Replace with actual directory
ExecStart=$BINARY_PATH
Restart=always
User=your_system_user  # Replace with desired user

[Install]
WantedBy=multi-user.target
EOF
)

# Create the systemd service file
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
echo "$SERVICE_CONTENT" > "$SERVICE_FILE"

# Reload systemd and enable/start the service
systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service"
systemctl start "$SERVICE_NAME.service"

echo "Service '$SERVICE_NAME' installed and started."
