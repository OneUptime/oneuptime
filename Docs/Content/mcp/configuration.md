# Configuration

Learn how to configure the OneUptime MCP Server for your specific needs.

## Claude Desktop Configuration

The MCP server is hosted alongside your OneUptime instance. Configure your Claude Desktop to connect via SSE transport.

### Find Your Configuration File

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### OneUptime Cloud Configuration

Add the following to your Claude Desktop configuration file:

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

### Self-Hosted OneUptime Configuration

If you're running a self-hosted OneUptime instance:

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

## Available Endpoints

The MCP server provides the following endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp/sse` | GET | SSE endpoint for establishing MCP connections |
| `/mcp/message` | POST | Endpoint for sending messages to the server |
| `/mcp/health` | GET | Health check endpoint returning server status |
| `/mcp/tools` | GET | REST API listing all available tools |

## Testing the Connection

You can verify the server is working by checking the health endpoint:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Or list available tools:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## API Key Permissions

Your API key needs appropriate permissions based on what operations you want to perform:

### Read-Only Access

For viewing data only, add read permissions for this API Key.

### Full Access

For full access to create, update, and delete resources, ensure your API key has the following permissions:
- Project Admin

### Minimal Permissions

It is recommended to have minimum set of permissions assigned to your API key for your use-case.

## Multiple Instances

You can configure multiple OneUptime instances by creating separate MCP server configurations:

```json
{
  "mcpServers": {
    "oneuptime-prod": {
      "transport": "sse",
      "url": "https://prod.oneuptime.com/mcp/sse",
      "headers": {
        "x-api-key": "prod-api-key"
      }
    },
    "oneuptime-staging": {
      "transport": "sse",
      "url": "https://staging.oneuptime.com/mcp/sse",
      "headers": {
        "x-api-key": "staging-api-key"
      }
    }
  }
}
```

## Configuration Validation

To verify your configuration is working:

1. **Check API Key**: Ensure your API key is valid and has proper permissions
2. **Test Connection**: Ask Claude to list your projects or monitors
3. **Verify Permissions**: Try creating a simple resource to test write access

## Troubleshooting Configuration

### Invalid API Key
- Verify the API key in your OneUptime settings
- Check for extra spaces or characters
- Ensure the key hasn't expired

### Connection Failed
- Verify your OneUptime instance URL
- Ensure it includes the protocol (https://)
- Check for typos in the domain
- Verify the MCP server is running (check `/mcp/health`)

### Permission Denied
- Review your API key permissions
- Contact your OneUptime administrator if needed
- Try with a more permissive API key for testing

## Security Best Practices

1. **Use Specific Permissions**: Only grant the minimum permissions needed
2. **Rotate API Keys**: Regularly rotate your API keys
3. **Monitor Usage**: Keep track of API key usage in OneUptime
4. **Separate Keys**: Use different API keys for different environments

## Next Steps

- [Explore usage examples](/docs/mcp/examples)
- [View available resources](/docs/mcp/resources)
