# OneUptime MCP Server

A dynamic Model Context Protocol (MCP) server for OneUptime that automatically generates tools from OpenAPI specifications. This server provides comprehensive monitoring, alerting, and incident management capabilities through the MCP protocol.

## Features

- **🔄 Dynamic Tool Generation**: Automatically generates MCP tools from OneUptime's OpenAPI specification
- **📊 Complete CRUD Operations**: Support for Create, Read, Update, Delete operations on all OneUptime models
- **🔍 Model Discovery**: Built-in tools to explore available models and their schemas
- **🔗 OpenAPI Integration**: Direct integration with OneUptime's OpenAPI specification
- **⚡ Real-time Updates**: Tools stay synchronized with API changes
- **🔧 Comprehensive Coverage**: Supports monitors, incidents, status pages, teams, and more

## Installation

### NPM (Recommended)

```bash
npm install -g @oneuptime/mcp-server
```

### Docker

```bash
docker pull oneuptime/mcp-server:latest
```

### From Source

```bash
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime/MCP
npm install
npm run build
```

## Configuration

Set the following environment variables:

```bash
export ONEUPTIME_URL="https://your-instance.oneuptime.com"
export ONEUPTIME_PROJECT_ID="your-project-id"
export ONEUPTIME_API_KEY="your-api-key"
```

### Getting Your API Key

1. Log into your OneUptime dashboard
2. Go to Project Settings → API Keys
3. Create a new API key with appropriate permissions
4. Copy the key and set it as `ONEUPTIME_API_KEY`

## Usage

### With Claude Desktop

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "oneuptime": {
      "command": "oneuptime-mcp",
      "env": {
        "ONEUPTIME_URL": "https://your-instance.oneuptime.com",
        "ONEUPTIME_PROJECT_ID": "your-project-id",
        "ONEUPTIME_API_KEY": "your-api-key"
      }
    }
  }
}
```

### With Docker

```bash
docker run --rm -i \
  -e ONEUPTIME_URL="https://your-instance.oneuptime.com" \
  -e ONEUPTIME_PROJECT_ID="your-project-id" \
  -e ONEUPTIME_API_KEY="your-api-key" \
  oneuptime/mcp-server:latest
```

### Standalone

```bash
ONEUPTIME_URL="https://your-instance.oneuptime.com" \
ONEUPTIME_PROJECT_ID="your-project-id" \
ONEUPTIME_API_KEY="your-api-key" \
oneuptime-mcp
```

## Available Tools

The MCP server dynamically generates tools for all OneUptime models. Common tools include:

### Monitoring
- `list_monitor` - List all monitors
- `get_monitor` - Get monitor details
- `create_monitor` - Create a new monitor
- `update_monitor` - Update monitor settings
- `delete_monitor` - Delete a monitor

### Incident Management
- `list_incident` - List incidents
- `get_incident` - Get incident details
- `create_incident` - Create new incident
- `update_incident` - Update incident status
- `delete_incident` - Delete incident

### Status Pages
- `list_statuspage` - List status pages
- `get_statuspage` - Get status page details
- `create_statuspage` - Create status page
- `update_statuspage` - Update status page
- `delete_statuspage` - Delete status page

### Teams & Users
- `list_team` - List teams
- `list_user` - List users
- `create_team` - Create team
- `add_team_member` - Add team member

### Utility Tools
- `list_available_models` - Discover all available models
- `get_model_schema` - Get schema for a specific model
- `get_openapi_endpoints` - View all API endpoints

## Examples

### Creating a Monitor

```typescript
// Use the create_monitor tool
{
  "name": "Website Monitor",
  "description": "Monitor main website",
  "monitorType": "Website",
  "url": "https://example.com",
  "intervalInMinutes": 5
}
```

### Listing Active Incidents

```typescript
// Use the list_incident tool with filters
{
  "query": {
    "currentIncidentState": "Open"
  },
  "limit": 10
}
```

### Creating a Status Page

```typescript
// Use the create_statuspage tool
{
  "name": "Public Status",
  "description": "Public status page for our services",
  "slug": "status",
  "isPublic": true
}
```

## Model Schema

All tools are generated from the OneUptime database models, which include:

- **Monitor**: Website, API, Server monitoring
- **Incident**: Incident management and tracking
- **StatusPage**: Public and private status pages
- **Alert**: Alert management and routing
- **Team**: Team and user management
- **OnCallDutyPolicy**: On-call schedules and escalation
- **Probe**: Monitoring probes and locations
- **Project**: Project settings and configuration

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Development Mode

```bash
npm run dev
```

### Adding New Tools

Tools are automatically generated from the OpenAPI specification. To add support for new models:

1. Ensure the model is properly defined in OneUptime
2. Update the OpenAPI specification
3. Rebuild the MCP server - tools will be generated automatically

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   MCP Client    │    │   MCP Server     │    │   OneUptime     │
│   (Claude)      │◄──►│   Dynamic        │◄──►│   API           │
│                 │    │   Generator      │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   OpenAPI        │
                       │   Specification  │
                       └──────────────────┘
```

The server uses a dynamic generation approach:

1. **Initialization**: Loads OpenAPI specification at startup
2. **Model Discovery**: Extracts model information from API paths
3. **Tool Generation**: Creates CRUD tools for each discovered model
4. **Runtime**: Handles tool calls by mapping them to OneUptime API endpoints

## Error Handling

The server includes comprehensive error handling:

- **API Errors**: Proper error messages from OneUptime API
- **Validation Errors**: Input validation with clear error messages
- **Network Errors**: Retry logic and connection error handling
- **Authentication Errors**: Clear guidance on API key issues

## Troubleshooting

### Common Issues

1. **"Unknown tool" errors**: Tool names are dynamically generated. Use `list_available_models` to see available tools.

2. **Authentication errors**: Verify your API key has the required permissions for the operation.

3. **Network errors**: Check your OneUptime URL and network connectivity.

4. **Model not found**: Some models may not be available in all OneUptime instances.

### Debug Mode

Enable debug logging:

```bash
DEBUG=mcp* oneuptime-mcp
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

Apache 2.0 - see LICENSE file for details.

## Support

- 📖 Documentation: [OneUptime Docs](https://docs.oneuptime.com)
- 💬 Community: [Discord](https://discord.gg/oneuptime)
- 🐛 Issues: [GitHub Issues](https://github.com/OneUptime/oneuptime/issues)
- 📧 Email: hello@oneuptime.com

---

Made with ❤️ by the OneUptime team