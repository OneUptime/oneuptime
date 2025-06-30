# Installation

This guide will walk you through installing and setting up the OneUptime MCP Server.

## Prerequisites

Before installing the MCP server, ensure you have:

- A OneUptime instance (cloud or self-hosted)
- A valid OneUptime API key
- Node.js 18 or later (for npm installation)

## Installation Methods

### Method 1: NPM Installation (Recommended)

Install the MCP server globally using npm:

```bash
npm install -g @oneuptime/mcp-server
```

This will install the `oneuptime-mcp` command globally on your system.

### Method 2: From Source

If you want to build from source or contribute to the project:

```bash
# Clone the OneUptime repository
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Generate the MCP server
cd MCP


# Install dependencies
npm install && npm link

# This should now execute
oneuptime-mcp --version
```

## Getting Your API Key

### For OneUptime Cloud

1. Log in to [OneUptime Cloud](https://oneuptime.com)
2. Navigate to **Settings** → **API Keys**
3. Click **Create API Key**
4. Provide a name (e.g., "MCP Server")
5. Select the appropriate permissions for your use case
6. Copy the generated API key

### For Self-Hosted OneUptime

1. Access your OneUptime instance
2. Navigate to **Settings** → **API Keys**
3. Click **Create API Key**
4. Provide a name (e.g., "MCP Server")
5. Select the appropriate permissions
6. Copy the generated API key

## Verification

Verify your installation by checking the version:

```bash
oneuptime-mcp --version
```

## Next Steps

- [Configure the MCP Server](/docs/mcp/configuration)
- [Set up with Claude Desktop](/docs/mcp/quick-start)
- [Explore configuration options](/docs/mcp/configuration)
