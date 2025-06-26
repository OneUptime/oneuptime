# Quick Start

Get up and running with the OneUptime MCP Server in just a few minutes.

## Step 1: Install the MCP Server

If you haven't already, install the MCP server:

```bash
npm install -g @oneuptime/mcp-server
```

## Step 2: Get Your API Key

1. Log in to your OneUptime instance
2. Go to **Settings** → **API Keys**
3. Create a new API key with appropriate permissions
4. Copy the API key for use in configuration

## Step 3: Configure Claude Desktop

Add the OneUptime MCP server to your Claude Desktop configuration.

### Find Your Configuration File

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### Update Configuration

Add the following to your Claude Desktop configuration file:

```json
{
  "mcpServers": {
    "oneuptime": {
      "command": "oneuptime-mcp",
      "env": {
        "ONEUPTIME_API_KEY": "your-api-key-here",
        "ONEUPTIME_URL": "https://oneuptime.com"
      }
    }
  }
}
```

**For self-hosted OneUptime**, replace `https://oneuptime.com` with your instance URL.

### Example Complete Configuration

```json
{
  "mcpServers": {
    "oneuptime": {
      "command": "oneuptime-mcp",
      "env": {
        "ONEUPTIME_API_KEY": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "ONEUPTIME_URL": "https://my-company.oneuptime.com"
      }
    }
  }
}
```

## Step 4: Restart Claude Desktop

Close and restart Claude Desktop for the configuration changes to take effect.

## Step 5: Test the Connection

Once Claude Desktop restarts, you can test the MCP server by asking Claude to:

- "List my OneUptime projects"
- "Show me recent incidents"
- "What monitors are currently down?"
- "Create a new monitor for my website"

## Example Conversation

Here's what you can do once everything is set up:

**You**: "Can you show me all my OneUptime projects?"

**Claude**: "I'll list your OneUptime projects for you."

*Claude will use the MCP server to fetch and display your projects*

**You**: "Create a new monitor for https://example.com"

**Claude**: "I'll create a website monitor for https://example.com."

*Claude will use the MCP server to create the monitor*

## Common Issues

### Permission Errors

If you see permission errors, ensure your API key has the necessary permissions:
- Read access for listing resources
- Write access for creating/updating resources
- Delete access if you want to remove resources

### Connection Issues

If Claude can't connect to your OneUptime instance:
1. Verify your `ONEUPTIME_URL` is correct
2. Check that your API key is valid
3. Ensure your OneUptime instance is accessible

### MCP Server Not Found

If you get "command not found" errors:
1. Verify the installation: `npm list -g @oneuptime/mcp-server`
2. Check your PATH includes npm global binaries
3. Try reinstalling: `npm install -g @oneuptime/mcp-server`

## Next Steps

- [Learn about configuration options](/docs/mcp/configuration)
- [Explore usage examples](/docs/mcp/examples)
- [View available resources](/docs/mcp/resources)
