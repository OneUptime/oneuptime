# Quick Start

Get up and running with the OneUptime MCP Server in just a few minutes.

## Step 1: Get Your API Key

1. Log in to your OneUptime instance
2. Go to **Settings** → **API Keys**
3. Create a new API key with appropriate permissions
4. Copy the API key for use in configuration

## Step 2: Configure Claude Desktop

Find your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### For OneUptime Cloud

Add the following configuration:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "sse",
      "url": "https://oneuptime.com/mcp/sse",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### For Self-Hosted OneUptime

Replace `oneuptime.com` with your OneUptime domain:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "sse",
      "url": "https://your-oneuptime-domain.com/mcp/sse",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

## Step 3: Restart Claude Desktop

Close and restart Claude Desktop for the configuration changes to take effect.

That's it! You're ready to use the OneUptime MCP Server.

## Step 4: Test the Connection

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
1. Verify your OneUptime URL is correct
2. Check that your API key is valid
3. Ensure your OneUptime instance is accessible
4. Test the health endpoint: `curl https://your-oneuptime-domain.com/mcp/health`

## Next Steps

- [Learn about configuration options](/docs/mcp/configuration)
- [Explore usage examples](/docs/mcp/examples)
- [View available resources](/docs/mcp/resources)
