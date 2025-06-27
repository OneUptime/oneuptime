# OneUptime MCP Server

A production-ready Model Context Protocol (MCP) server for OneUptime that provides dynamic tools for all OneUptime models and operations.

## Features

- **Dynamic Tool Generation**: Automatically generates MCP tools for all OneUptime models (Database and Analytics)
- **Full CRUD Operations**: Supports Create, Read, Update, Delete, List, and Count operations
- **Production Ready**: Built with proper error handling, logging, and configuration
- **Extensible**: Automatically supports new models as they are added to OneUptime
- **Type Safe**: Fully typed with TypeScript

## Available Operations

The MCP server automatically generates tools for each OneUptime model with the following operations:

### Database Models
- `oneuptime_create{ModelName}` - Create a new record
- `oneuptime_get{ModelName}` - Retrieve a record by ID  
- `oneuptime_list{ModelName}s` - List records with filtering
- `oneuptime_update{ModelName}` - Update a record
- `oneuptime_delete{ModelName}` - Delete a record
- `oneuptime_count{ModelName}s` - Count records

### Analytics Models  
- `oneuptime_create{ModelName}` - Create analytics data
- `oneuptime_list{ModelName}s` - Query analytics data
- `oneuptime_count{ModelName}s` - Count analytics records

## Supported Models

The server automatically generates tools for all OneUptime models including:

**Database Models**: Incident, Alert, Monitor, Project, User, Team, StatusPage, and 100+ more
**Analytics Models**: Log, Metric, Span, TelemetryAttribute, ExceptionInstance, MonitorLog

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# OneUptime API Key (Required)
ONEUPTIME_API_KEY=your_oneuptime_api_key_here

# OneUptime Instance URL (Optional - defaults to https://oneuptime.com)
ONEUPTIME_URL=https://oneuptime.com
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your OneUptime configuration
```

3. Build the server:
```bash
npm run build
```

4. (Optional) Link for global CLI usage:
```bash
npm run link
```


## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## Example Tool Usage

### List Incidents
```json
{
  "name": "oneuptime_listIncidents",
  "arguments": {
    "query": {"projectId": "your-project-id"},
    "limit": 10
  }
}
```

### Create Alert
```json
{
  "name": "oneuptime_createAlert", 
  "arguments": {
    "data": {
      "title": "High CPU Usage",
      "description": "CPU usage above 90%",
      "projectId": "your-project-id"
    }
  }
}
```

### Get Monitor by ID
```json
{
  "name": "oneuptime_getMonitor",
  "arguments": {
    "id": "monitor-id-here"
  }
}
```

### Query Logs
```json
{
  "name": "oneuptime_listLogs",
  "arguments": {
    "query": {
      "serviceId": "service-id",
      "severity": "error"
    },
    "limit": 50,
    "sort": {"time": -1}
  }
}
```

## Troubleshooting

### MCP Logging Compatibility

This server uses a custom `MCPLogger` class that ensures all log messages are directed to `stderr` instead of `stdout`. This is critical for MCP protocol compliance, as `stdout` is reserved for JSON-RPC messages.

**Fixed Issues:**
- `Failed to parse message` warnings caused by log messages going to stdout
- Dotenv initialization messages interfering with MCP protocol
- All informational logging now properly directed to stderr

If you encounter parsing warnings, ensure no code is writing to stdout directly - use `MCPLogger` instead of console methods.

## Architecture

- **DynamicToolGenerator**: Automatically discovers and generates tools for all OneUptime models
- **OneUptimeApiService**: Handles API communication with OneUptime instance
- **Type Definitions**: Provides type safety and IntelliSense support
- **Error Handling**: Comprehensive error handling and user-friendly messages

## Development

### Adding New Models

New models are automatically supported! When new models are added to OneUptime:

1. Database models added to `Common/Models/DatabaseModels/Index.ts` 
2. Analytics models added to `Common/Models/AnalyticsModels/Index.ts`

The MCP server will automatically generate tools for them on the next restart.

### Testing

```bash
npm test
```

### Linting

```bash
npm run audit
npm run dep-check
```

## License

Apache-2.0 - See LICENSE file for details.
