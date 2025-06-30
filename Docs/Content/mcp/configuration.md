# Configuration

Learn how to configure the OneUptime MCP Server for your specific needs.

## Environment Variables

The MCP server uses environment variables for configuration:

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `ONEUPTIME_API_KEY` | Your OneUptime API key | **Yes** | - | `xxxxxxxx-xxxx-xxxx-xxxx` |
| `ONEUPTIME_URL` | Your OneUptime instance URL | No | `https://oneuptime.com` | `https://my-company.oneuptime.com` |

## Setting Environment Variables

### In Claude Desktop Configuration

The recommended way is to set environment variables in your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "oneuptime": {
      "command": "oneuptime-mcp",
      "env": {
        "ONEUPTIME_API_KEY": "your-api-key-here",
        "ONEUPTIME_URL": "https://oneuptime.com" // Replace with your instance URL if you are self-hosting
      }
    }
  }
}
```

### System Environment Variables

Alternatively, you can set system environment variables:

**macOS/Linux**:
```bash
export ONEUPTIME_API_KEY="your-api-key-here"
# Optional: Set custom OneUptime URL. Replace with your instance if self-hosted
export ONEUPTIME_URL="https://oneuptime.com"
```

**Windows**:
```cmd
set ONEUPTIME_API_KEY=your-api-key-here
# Optional: Set custom OneUptime URL. Replace with your instance if self-hosted
set ONEUPTIME_URL=https://oneuptime.com
```

### Using .env File

For development, you can create a `.env` file in your working directory:

```env
ONEUPTIME_API_KEY=your-api-key-here
# Optional: Set custom OneUptime URL. Replace with your instance if self-hosted
ONEUPTIME_URL=https://oneuptime.com
```

## API Key Permissions

Your API key needs appropriate permissions based on what operations you want to perform:

### Read-Only Access

For viewing data only, Please add read permissions for this API Key, 

### Full Access

For full access to create, update, and delete resources, ensure your API key has the following permissions:
- Project Admin

### Minimal Permissions

It is recommended to have minimum set of permissions assigned to your API key for your use-case. 

## Advanced Configuration

### Multiple Instances

You can configure multiple OneUptime instances by creating separate MCP server configurations:

```json
{
  "mcpServers": {
    "oneuptime-prod": {
      "command": "oneuptime-mcp",
      "env": {
        "ONEUPTIME_API_KEY": "prod-api-key",
        "ONEUPTIME_URL": "https://prod.oneuptime.com"
      }
    },
    "oneuptime-staging": {
      "command": "oneuptime-mcp",
      "env": {
        "ONEUPTIME_API_KEY": "staging-api-key",
        "ONEUPTIME_URL": "https://staging.oneuptime.com"
      }
    }
  }
}
```

### Custom Command Path

If you installed from source or want to use a specific version:

```json
{
  "mcpServers": {
    "oneuptime": {
      "command": "/path/to/your/oneuptime-mcp",
      "env": {
        "ONEUPTIME_API_KEY": "your-api-key-here"
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

### Wrong URL
- Verify your OneUptime instance URL
- Ensure it includes the protocol (https://)
- Check for typos in the domain

### Permission Denied
- Review your API key permissions
- Contact your OneUptime administrator if needed
- Try with a more permissive API key for testing

## Security Best Practices

1. **Use Specific Permissions**: Only grant the minimum permissions needed
2. **Rotate API Keys**: Regularly rotate your API keys
3. **Monitor Usage**: Keep track of API key usage in OneUptime
4. **Separate Keys**: Use different API keys for different environments
5. **Store Securely**: Never commit API keys to version control

## Next Steps

- [Explore usage examples](/docs/mcp/examples)
- [View available resources](/docs/mcp/resources)
- [Learn about troubleshooting](/docs/mcp/troubleshooting)
