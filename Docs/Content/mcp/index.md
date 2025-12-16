# OneUptime MCP Server

The OneUptime Model Context Protocol (MCP) Server provides LLMs with direct access to your OneUptime instance, enabling AI-powered monitoring, incident management, and observability operations.

## What is the OneUptime MCP Server?

The OneUptime MCP Server is a bridge between Large Language Models (LLMs) and your OneUptime instance. It implements the Model Context Protocol (MCP), allowing AI assistants like Claude to interact directly with your monitoring infrastructure.

## How It Works

The MCP server is hosted alongside your OneUptime instance and accessible via Server-Sent Events (SSE). No local installation is required.

**Cloud Users**: `https://oneuptime.com/mcp`
**Self-Hosted Users**: `https://your-oneuptime-domain.com/mcp`

## Key Features

- **Complete API Coverage**: Access to 711 OneUptime API endpoints
- **126 Resource Types**: Manage all OneUptime resources including monitors, incidents, teams, probes, and more
- **Real-time Operations**: Create, read, update, and delete resources in real-time
- **Type-safe Interface**: Fully typed with comprehensive input validation
- **Secure Authentication**: API key-based authentication with proper error handling
- **Easy Integration**: Works with Claude Desktop and other MCP-compatible clients

## What You Can Do

With the OneUptime MCP Server, AI assistants can help you:

- **Monitor Management**: Create and configure monitors, check their status, and manage monitor groups
- **Incident Response**: Create incidents, add notes, assign team members, and track resolution
- **Team Operations**: Manage teams, permissions, and on-call schedules
- **Status Pages**: Update status pages, create announcements, and manage subscribers
- **Alerting**: Configure alert rules, manage escalation policies, and check notification logs
- **Probes**: Deploy and manage monitoring probes across different locations
- **Reports & Analytics**: Generate reports and analyze monitoring data

## Getting Started

1. [Installation Guide](/docs/mcp/installation) - Install and configure the MCP server
2. [Quick Start](/docs/mcp/quick-start) - Get up and running in minutes
3. [Configuration](/docs/mcp/configuration) - Detailed configuration options
4. [Usage Examples](/docs/mcp/examples) - Common use cases and examples

## Requirements

- OneUptime instance (cloud or self-hosted)
- Valid OneUptime API key
- MCP-compatible client (Claude Desktop, etc.)

## Architecture

The MCP server acts as a translation layer between the Model Context Protocol and OneUptime's REST API:

```
LLM Client (Claude) ↔ MCP Server ↔ OneUptime API
```

This architecture ensures secure, efficient access to your OneUptime data while maintaining proper authentication and authorization.

## Next Steps

- [Install the MCP Server](/docs/mcp/installation)
- [Learn about Configuration Options](/docs/mcp/configuration)
- [Explore Usage Examples](/docs/mcp/examples)
- [View Available Resources](/docs/mcp/resources)
