# OneUptime MCP Server Generator

## Overview

This project provides a **dynamic MCP (Model Context Protocol) server generator** that automatically creates a complete, production-ready MCP server from OneUptime's OpenAPI specification. The generator is written in TypeScript and produces a fully functional MCP server that allows LLMs to interact with OneUptime APIs.

## 🚀 Features

### ✅ Dynamic Generation
- **Automatic tool discovery** from OpenAPI operations and endpoints
- **Schema generation** from API request/response models  
- **Type-safe** TypeScript code generation with full type definitions
- **Input validation** using JSON schemas derived from OpenAPI spec
- **Error handling** with comprehensive error messages and validation

### ✅ Complete MCP Server Structure
- **Main server file** with MCP SDK integration
- **API client** with authentication and request handling
- **Tool registry** with all discovered API endpoints as MCP tools
- **Configuration utilities** for environment-based setup
- **Documentation** auto-generated with usage examples
- **Docker support** for containerized deployment

### ✅ Build System
- **NPM package** with proper dependencies and scripts
- **TypeScript compilation** with source maps and declarations
- **Build scripts** for development and production
- **Testing infrastructure** with Jest setup
- **Publishing scripts** for NPM and Docker registries

## 📁 Generated Structure

```
MCP/
├── package.json                 # NPM package configuration
├── Index.ts                     # Main MCP server entry point
├── README.md                    # Complete usage documentation
├── tsconfig.json               # TypeScript configuration
├── nodemon.json                # Development configuration
├── Dockerfile                  # Container deployment
├── .env.example                # Environment variables template
├── .gitignore                  # Git ignore rules
├── CHANGELOG.md                # Version history
├── LICENSE                     # Apache 2.0 license
├── Service/
│   ├── MCP.ts                  # MCP tool registry and handlers
│   └── APIClient.ts            # OneUptime API client
└── Utils/
    └── Config.ts               # Configuration utilities
```

## 🔧 Usage

### Generate the MCP Server

```bash
# Generate the complete MCP server
npm run generate-mcp-server
```

### Build and Test

```bash
# Navigate to the generated server
cd MCP

# Install dependencies
npm install

# Build the server
npm run build

# Test the server (optional)
npm test

# Run in development mode
npm run dev
```

### Use the MCP Server

```bash
# Set your OneUptime API key
export ONEUPTIME_API_KEY=your-api-key-here

# Optional: Set your OneUptime instance URL (defaults to https://oneuptime.com)
export ONEUPTIME_URL=https://oneuptime.com

# Run the MCP server
npm start
```

### Docker Usage

```bash
# Build Docker image
cd MCP
docker build -t oneuptime-mcp .

# Run with environment variables
docker run -e ONEUPTIME_API_KEY=your-key oneuptime-mcp
```

## 🏗️ Architecture

### Core Components

1. **OpenAPIParser** - Parses OpenAPI spec and extracts MCP tool definitions
2. **MCPServerGenerator** - Generates complete MCP server project structure
3. **FileGenerator** - Handles file I/O operations and directory management
4. **StringUtils** - Utility functions for naming conversions and sanitization
5. **GenerateMCPServer** - Main orchestration script that coordinates generation

### Generation Flow

```
OpenAPI Spec → Parser → Tool Discovery → Code Generation → MCP Server
     ↓              ↓            ↓              ↓             ↓
JSON Schema → Operations → MCP Tools → TypeScript Files → NPM Package
```

## 📋 Generated MCP Tools

The generator automatically creates MCP tools for all OneUptime API endpoints, including:

- **Projects** - Project management and organization
- **Monitors** - Service monitoring and health checks
- **Incidents** - Incident management and tracking  
- **Alerts** - Alert rules and notification management
- **Status Pages** - Public status page management
- **Teams** - Team organization and permissions
- **Users** - User management and authentication
- **Workflows** - Automation and workflow management
- **Service Catalog** - Service discovery and documentation
- **And 700+ more tools** covering the complete OneUptime API

Each tool includes:
- **Input validation** using JSON schemas
- **Type-safe parameters** with TypeScript definitions
- **Comprehensive documentation** with examples
- **Error handling** with detailed error messages

## 🔐 Authentication

The MCP server supports OneUptime API key authentication:

```bash
# Set your API key
export ONEUPTIME_API_KEY=your-api-key-here

# Optional: Set custom OneUptime URL
export ONEUPTIME_URL=https://your-instance.oneuptime.com
```

Environment variables supported:
- `ONEUPTIME_API_KEY` - Your OneUptime API key (required)
- `ONEUPTIME_URL` - Your OneUptime instance URL (optional, defaults to oneuptime.com)
- `API_KEY` - Alternative API key variable name
- `ONEUPTIME_API_URL` - Alternative full API URL

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run coverage

# Run in watch mode during development
npm run dev
```

## 📦 Publishing

### Manual Publishing

```bash
# Publish to NPM
npm run publish-mcp-server -- --version 1.0.0

# Dry run (test without publishing)
npm run publish-mcp-server -- --version 1.0.0 --dry-run

# With NPM token
npm run publish-mcp-server -- --version 1.0.0 --npm-token YOUR_TOKEN
```

### Automated Publishing

The project includes GitHub Actions workflows for automated publishing:

1. **MCP Server Generation** - Validates generation on every PR/push
2. **Publish MCP Server** - Publishes to NPM and Docker on releases

## 🔄 Dynamic Updates

The generator is designed to be **completely dynamic**:

- **New API endpoints** are automatically discovered and added as MCP tools
- **Schema changes** are reflected in the generated code
- **No manual updates** required when the OneUptime API evolves
- **Regenerate anytime** with a single command

## 🎯 Benefits

1. **Always Up-to-Date** - MCP server automatically includes new API features
2. **Type Safety** - Generated TypeScript code is type-safe and follows best practices  
3. **Complete Coverage** - All API endpoints become MCP tools for LLM integration
4. **Production Ready** - Includes error handling, logging, validation, and documentation
5. **Standards Compliant** - Follows MCP protocol specifications and TypeScript conventions
6. **Easy Maintenance** - Single source of truth (OpenAPI spec)

## 🛠️ Development

To modify the generator:

1. Edit TypeScript files in `Scripts/MCPProvider/Core/`
2. Run `npm run generate-mcp-server` to test changes
3. Check generated code in `MCP/`
4. Iterate and improve

### Key Files

- `Scripts/MCPProvider/Core/Types.ts` - Type definitions
- `Scripts/MCPProvider/Core/OpenAPIParser.ts` - OpenAPI parsing logic
- `Scripts/MCPProvider/Core/MCPServerGenerator.ts` - Main generation logic
- `Scripts/MCPProvider/GenerateMCPServer.ts` - Generation orchestration

## 🌟 Example Usage with LLMs

Once the MCP server is running, LLMs can use it to interact with OneUptime:

```typescript
// Example: Create a new monitor
{
  "tool": "createMonitor", 
  "arguments": {
    "name": "Website Health Check",
    "type": "http",
    "url": "https://example.com",
    "projectId": "project-id-here"
  }
}

// Example: Get incident details
{
  "tool": "getIncident",
  "arguments": {
    "incidentId": "incident-id-here"
  }
}

// Example: Update status page
{
  "tool": "updateStatusPage",
  "arguments": {
    "statusPageId": "status-page-id",
    "status": "operational"
  }
}
```

## 📚 Documentation

- **Generated README** provides complete usage instructions for each generated server
- **API Documentation** auto-generated from OpenAPI specifications  
- **Examples** show common usage patterns and integrations
- **Type Definitions** provide IntelliSense support in IDEs

## 🤝 Contributing

1. This is part of the main OneUptime repository
2. The MCP server is generated automatically from the OpenAPI specification
3. To add new features, update the underlying OneUptime APIs
4. The generator will automatically include new endpoints in the next generation

## 📄 License

Apache License 2.0 - see [LICENSE](LICENSE) for details.

---

This generator provides a complete, maintainable solution for creating MCP servers from OpenAPI specifications, ensuring that your LLM integration tools stay synchronized with your API evolution.
