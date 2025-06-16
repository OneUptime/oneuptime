# OneUptime MCP Server Examples

This directory contains usage examples for the OneUptime MCP Server.

## Claude Desktop Configuration

To use the OneUptime MCP Server with Claude Desktop, add this configuration to your Claude Desktop settings:

### macOS
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "oneuptime": {
      "command": "npx",
      "args": ["@oneuptime/mcp-server"],
      "env": {
        "ONEUPTIME_URL": "https://your-instance.oneuptime.com",
        "ONEUPTIME_PROJECT_ID": "your-project-id",
        "ONEUPTIME_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Windows
Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "oneuptime": {
      "command": "npx",
      "args": ["@oneuptime/mcp-server"],
      "env": {
        "ONEUPTIME_URL": "https://your-instance.oneuptime.com",
        "ONEUPTIME_PROJECT_ID": "your-project-id",
        "ONEUPTIME_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Example Conversations

### 1. Discovering Available Tools

**You:** "What OneUptime tools are available?"

**Claude will use:** `list_available_models`

**Expected response:** A list of all available OneUptime models and their descriptions.

### 2. Creating a Monitor

**You:** "Create a website monitor for https://example.com that checks every 5 minutes"

**Claude will use:** `create_monitor`

**Parameters:**
```json
{
  "data": {
    "name": "Example.com Monitor",
    "description": "Website monitor for example.com",
    "monitorType": "Website",
    "url": "https://example.com",
    "intervalInMinutes": 5
  }
}
```

### 3. Listing Incidents

**You:** "Show me all open incidents"

**Claude will use:** `list_incident`

**Parameters:**
```json
{
  "query": {
    "currentIncidentState": "Open"
  },
  "limit": 10
}
```

### 4. Creating an Incident

**You:** "Create a new incident for database outage with high severity"

**Claude will use:** `create_incident`

**Parameters:**
```json
{
  "data": {
    "title": "Database Outage",
    "description": "Primary database is experiencing connectivity issues",
    "severity": "High",
    "currentIncidentState": "Open"
  }
}
```

### 5. Managing Status Pages

**You:** "Create a public status page for our services"

**Claude will use:** `create_statuspage`

**Parameters:**
```json
{
  "data": {
    "name": "Service Status",
    "description": "Current status of all our services",
    "slug": "status",
    "isPublic": true
  }
}
```

### 6. Team Management

**You:** "List all team members"

**Claude will use:** `list_teammember`

### 7. Getting Model Schemas

**You:** "What fields are available for monitors?"

**Claude will use:** `get_model_schema`

**Parameters:**
```json
{
  "modelName": "Monitor"
}
```

## Tips for Better Results

1. **Be specific about what you want to do:** Instead of "show monitors", say "list all website monitors" or "show monitors that are currently down"

2. **Provide context:** When creating resources, provide relevant details like names, descriptions, and configuration options

3. **Use natural language:** You can ask questions like "What's the status of my website monitors?" and Claude will use the appropriate tools

4. **Explore available tools:** Start by asking "What OneUptime management tools are available?" to see what you can do

## Troubleshooting

### Common Issues

1. **"No tools available"**
   - Check your environment variables are set correctly
   - Verify your API key has the required permissions
   - Ensure your OneUptime URL is accessible

2. **"Authentication failed"**
   - Verify your API key is correct and not expired
   - Check that the API key has permissions for the requested operation

3. **"Model not found"**
   - Some models might not be available in all OneUptime versions
   - Use `list_available_models` to see what's available in your instance

### Debug Mode

If you're having issues, you can enable debug mode by setting the DEBUG environment variable:

```bash
DEBUG=mcp* npx @oneuptime/mcp-server
```

This will provide detailed logging of what the MCP server is doing.
