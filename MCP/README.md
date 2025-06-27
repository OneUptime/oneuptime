# OneUptime Hello World MCP Server

A basic Hello World implementation of a Model Context Protocol (MCP) server for OneUptime.

## What is this?

This is a simple MCP server that demonstrates how to create a Model Context Protocol server within the OneUptime ecosystem. It provides basic tools that can be used by AI assistants like Claude to interact with the server.

## Available Tools

1. **hello** - Say hello with a personalized greeting
   - Parameters: `name` (string, required)
   - Example: Returns "Hello, [name]! Welcome to OneUptime's Hello World MCP Server! 🚀"

2. **get_time** - Get the current server time
   - Parameters: None
   - Example: Returns current ISO timestamp

3. **echo** - Echo back any message
   - Parameters: `message` (string, required)
   - Example: Returns "Echo: [your message]"

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- TypeScript

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. Start production server:
   ```bash
   npm start
   ```

### Docker

Build and run with Docker:

```bash
# Build the Docker image
docker build -f Dockerfile.tpl -t oneuptime-mcp-hello-world .

# Run the container
docker run -it oneuptime-mcp-hello-world
```

## Usage

This MCP server communicates over stdio and is designed to be used with MCP-compatible clients like Claude Desktop or other AI assistants that support the Model Context Protocol.

### Example Configuration for Claude Desktop

Add this to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "oneuptime": {
      "command": "node",
      "args": ["--require", "ts-node/register", "/path/to/mcp-hello-world/Index.ts"]
    }
  }
}
```

## Architecture

The server is built using:
- **@modelcontextprotocol/sdk**: Official MCP SDK for TypeScript
- **OneUptime Common**: Shared utilities and logging from OneUptime
- **TypeScript**: For type safety and better development experience

## Contributing

This is part of the OneUptime project. Follow the standard OneUptime development practices and coding standards.

## License

Apache-2.0 - see the OneUptime project license for details.
