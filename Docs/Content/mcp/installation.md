# Installation

This guide will walk you through setting up the OneUptime MCP Server.

## Prerequisites

Before setting up the MCP server, ensure you have:

- A OneUptime instance (cloud or self-hosted)
- A valid OneUptime API key
- An MCP-compatible client (Claude Desktop, etc.)

## MCP Server URL

The MCP server is hosted alongside your OneUptime instance. No local installation is required.

**OneUptime Cloud**: `https://oneuptime.com/mcp`
**Self-Hosted**: `https://your-oneuptime-domain.com/mcp`

## Available Endpoints

The MCP server exposes the following endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp/sse` | GET | SSE endpoint for MCP connections |
| `/mcp/message` | POST | Message endpoint for client-to-server communication |
| `/mcp/health` | GET | Health check endpoint |
| `/mcp/tools` | GET | REST API to list available tools |

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

You can verify the MCP server is running by checking the health endpoint:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

You can also list available tools:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## Next Steps

- [Configure with Claude Desktop](/docs/mcp/configuration)
- [Quick Start Guide](/docs/mcp/quick-start)
- [View Usage Examples](/docs/mcp/examples)
