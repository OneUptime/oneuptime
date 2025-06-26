import { MCPServerConfig, OpenAPISpec, MCPTool } from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { OpenAPIParser } from "./OpenAPIParser";

export class MCPServerGenerator {
  private config: MCPServerConfig;
  private spec: OpenAPISpec;
  private fileGenerator: FileGenerator;

  public constructor(config: MCPServerConfig, spec: OpenAPISpec) {
    this.config = config;
    this.spec = spec;
    this.fileGenerator = new FileGenerator(config.outputDir);
  }

  public async generateServer(): Promise<void> {
    await this.generatePackageJson();
    await this.generateIndexFile();
    await this.generateMCPService();
    await this.generateAPIClient();
    await this.generateConfigUtils();
    await this.generateReadme();
    await this.generateTsConfig();
    await this.generateNodemonConfig();
    await this.generateDockerfile();
  }

  private async generatePackageJson(): Promise<void> {
    const packageJson: any = {
      name: this.config.npmPackageName,
      version: this.config.serverVersion,
      description: this.config.description,
      main: "build/Index.js",
      bin: {
        [this.config.serverName]: "./build/Index.js",
      },
      files: ["build", "README.md", "package.json"],
      scripts: {
        start:
          "export NODE_OPTIONS='--max-old-space-size=8096' && node --require ts-node/register Index.ts",
        build: "rm -rf build && tsc",
        compile: "npm run build",
        dev: "npx nodemon",
        "clear-modules":
          "rm -rf node_modules && rm package-lock.json && npm install",
        audit: "npm audit --audit-level=low",
        "dep-check":
          "npm install -g depcheck && depcheck ./ --skip-missing=true",
        test: "jest --detectOpenHandles --passWithNoTests",
        coverage: "jest --detectOpenHandles --coverage",
        prepublishOnly: "npm run build && chmod +x build/Index.js",
      },
      keywords: [
        "mcp",
        "model-context-protocol",
        "oneuptime",
        "api",
        "monitoring",
        "observability",
      ],
      author: "OneUptime <hello@oneuptime.com> (https://oneuptime.com/)",
      license: "Apache-2.0",
      repository: {
        type: "git",
        url: "https://github.com/OneUptime/oneuptime.git",
        directory: "MCP",
      },
      bugs: {
        url: "https://github.com/OneUptime/oneuptime/issues",
      },
      homepage: "https://oneuptime.com",
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.12.0",
        axios: "^1.6.0",
        dotenv: "^16.3.1",
      },
      devDependencies: {
        "@types/jest": "^29.5.11",
        "@types/node": "^20.0.0",
        jest: "^29.0.0",
        nodemon: "^3.0.0",
        "ts-node": "^10.9.0",
        typescript: "^5.0.0",
      },
    };

    await this.fileGenerator.writeFile(
      "package.json",
      JSON.stringify(packageJson, null, 2),
    );
  }

  private async generateIndexFile(): Promise<void> {
    const indexContent: string = [
      "#!/usr/bin/env node",
      "",
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";',
      'import { ServerConfig } from "./Utils/Config.js";',
      'import { MCPService } from "./Service/MCP.js";',
      'import dotenv from "dotenv";',
      "",
      "// Load environment variables",
      "dotenv.config();",
      "",
      "async function main(): Promise<void> {",
      "  try {",
      "    // Create server instance",
      "    const server: McpServer = new McpServer({",
      "      name: ServerConfig.name,",
      "      version: ServerConfig.version,",
      "      capabilities: {",
      "        tools: {},",
      "        resources: {},",
      "      },",
      "    });",
      "",
      "    // Add tools to server",
      "    const mcpService = new MCPService();",
      "    await mcpService.addToolsToServer(server);",
      "",
      "    const transport: StdioServerTransport = new StdioServerTransport();",
      "    await server.connect(transport);",
      '    console.error("OneUptime MCP Server running on stdio");',
      "  } catch (error) {",
      '    console.error("Fatal error in main():");',
      "    console.error(error);",
      "    process.exit(1);",
      "  }",
      "}",
      "",
      "// Handle graceful shutdown",
      'process.on("SIGINT", () => {',
      '  console.error("Received SIGINT, shutting down gracefully...");',
      "  process.exit(0);",
      "});",
      "",
      'process.on("SIGTERM", () => {',
      '  console.error("Received SIGTERM, shutting down gracefully...");',
      "  process.exit(0);",
      "});",
      "",
      "main().catch((error: Error) => {",
      '  console.error("Fatal error in main():");',
      "  console.error(error);",
      "  process.exit(1);",
      "});",
    ].join("\n");

    await this.fileGenerator.writeFile("Index.ts", indexContent);
  }

  private async generateMCPService(): Promise<void> {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(this.spec);
    const tools: any[] = parser.getMCPTools();

    const toolRegistrations: string = tools
      .map((tool: any) => {
        return [
          `    server.tool(`,
          `      "${tool.name}",`,
          `      "${StringUtils.sanitizeDescription(tool.description)}",`,
          `      ${JSON.stringify(tool.inputSchema, null, 6).replace(/^/gm, "      ")},`,
          `      async (args: any) => {`,
          `        return await this.${StringUtils.toCamelCase(tool.name)}(args);`,
          `      }`,
          `    );`,
        ].join("\n");
      })
      .join("\n\n");

    const toolMethods: string = tools
      .map((tool: any) => {
        return this.generateToolMethod(tool);
      })
      .join("\n\n");

    const serviceContent: string = [
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'import { OneUptimeAPIClient } from "./APIClient.js";',
      "",
      "export class MCPService {",
      "  private apiClient: OneUptimeAPIClient;",
      "",
      "  public constructor() {",
      "    this.apiClient = new OneUptimeAPIClient();",
      "  }",
      "",
      "  public async addToolsToServer(server: McpServer): Promise<void> {",
      "    // Register all tools",
      toolRegistrations,
      "  }",
      "",
      toolMethods,
      "}",
    ].join("\n");

    this.fileGenerator.ensureDirectoryExists("Service");
    await this.fileGenerator.writeFile("Service/MCP.ts", serviceContent);
  }

  private generateToolMethod(tool: MCPTool): string {
    const methodName: string = StringUtils.toCamelCase(tool.name);
    const operation: any = tool.operation;

    return [
      `  private async ${methodName}(args: any): Promise<any> {`,
      "    try {",
      "      const response = await this.apiClient.request({",
      `        method: "${operation.method.toUpperCase()}",`,
      `        path: "${operation.path}",`,
      "        data: args,",
      "      });",
      "",
      "      return {",
      "        content: [",
      "          {",
      '            type: "text",',
      "            text: JSON.stringify(response.data, null, 2),",
      "          },",
      "        ],",
      "      };",
      "    } catch (error) {",
      '      throw new Error(`API request failed: ${error instanceof Error ? error.message : "Unknown error"}`);',
      "    }",
      "  }",
    ].join("\n");
  }

  private async generateAPIClient(): Promise<void> {
    const clientContent: string = [
      'import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";',
      "",
      "export interface APIRequestConfig {",
      "  method: string;",
      "  path: string;",
      "  data?: any;",
      "  params?: any;",
      "  headers?: Record<string, string>;",
      "}",
      "",
      "export class OneUptimeAPIClient {",
      "  private client: AxiosInstance;",
      "  private baseURL: string;",
      "  private apiKey: string;",
      "",
      "  public constructor() {",
      "    this.baseURL = this.getBaseURL();",
      "    this.apiKey = this.getAPIKey();",
      "",
      "    this.client = axios.create({",
      "      baseURL: this.baseURL,",
      "      timeout: 30000,",
      "      headers: {",
      '        "Content-Type": "application/json",',
      '        "Accept": "application/json",',
      '        "User-Agent": "OneUptime MCP Server/1.0.0",',
      "      },",
      "    });",
      "",
      "    // Add request interceptor for authentication",
      "    this.client.interceptors.request.use((config) => {",
      "      if (this.apiKey) {",
      '        config.headers["APIKey"] = this.apiKey;',
      "      }",
      "      return config;",
      "    });",
      "",
      "    // Add response interceptor for error handling",
      "    this.client.interceptors.response.use(",
      "      (response) => response,",
      "      (error) => {",
      "        if (error.response) {",
      "          const errorMessage = error.response.data?.message || error.response.statusText;",
      "          throw new Error(`HTTP ${error.response.status}: ${errorMessage}`);",
      "        } else if (error.request) {",
      '          throw new Error("Network error: No response received from server");',
      "        } else {",
      "          throw new Error(`Request error: ${error.message}`);",
      "        }",
      "      }",
      "    );",
      "  }",
      "",
      "  private getBaseURL(): string {",
      '    const url = process.env.ONEUPTIME_URL || process.env.ONEUPTIME_API_URL || "https://oneuptime.com";',
      "    ",
      "    // Ensure the URL has the correct scheme",
      '    const normalizedURL = url.startsWith("http") ? url : `https://${url}`;',
      "    ",
      "    // Append /api if not present",
      '    return normalizedURL.endsWith("/api") ? normalizedURL : `${normalizedURL.replace(/\\/$/, "")}/api`;',
      "  }",
      "",
      "  private getAPIKey(): string {",
      "    const apiKey = process.env.ONEUPTIME_API_KEY || process.env.API_KEY;",
      "    if (!apiKey) {",
      "      throw new Error(",
      '        "OneUptime API key is required. Set ONEUPTIME_API_KEY or API_KEY environment variable."',
      "      );",
      "    }",
      "    return apiKey;",
      "  }",
      "",
      "  public async request(config: APIRequestConfig): Promise<AxiosResponse> {",
      "    const requestConfig: AxiosRequestConfig = {",
      "      method: config.method.toLowerCase() as any,",
      "      url: this.interpolatePath(config.path, config.data || config.params),",
      '      data: config.method.toUpperCase() !== "GET" ? config.data : undefined,',
      '      params: config.method.toUpperCase() === "GET" ? config.params : undefined,',
      "      headers: config.headers || {},",
      "    };",
      "",
      "    return await this.client.request(requestConfig);",
      "  }",
      "",
      "  private interpolatePath(path: string, data: any): string {",
      "    if (!data) return path;",
      "",
      "    return path.replace(/\\{([^}]+)\\}/g, (match, paramName) => {",
      "      const value = data[paramName];",
      "      if (value === undefined) {",
      "        throw new Error(`Missing required path parameter: ${paramName}`);",
      "      }",
      "      return encodeURIComponent(value.toString());",
      "    });",
      "  }",
      "",
      "  public async get(path: string, params?: any): Promise<AxiosResponse> {",
      '    return this.request({ method: "GET", path, params });',
      "  }",
      "",
      "  public async post(path: string, data?: any): Promise<AxiosResponse> {",
      '    return this.request({ method: "POST", path, data });',
      "  }",
      "",
      "  public async put(path: string, data?: any): Promise<AxiosResponse> {",
      '    return this.request({ method: "PUT", path, data });',
      "  }",
      "",
      "  public async patch(path: string, data?: any): Promise<AxiosResponse> {",
      '    return this.request({ method: "PATCH", path, data });',
      "  }",
      "",
      "  public async delete(path: string): Promise<AxiosResponse> {",
      '    return this.request({ method: "DELETE", path });',
      "  }",
      "}",
    ].join("\n");

    this.fileGenerator.ensureDirectoryExists("Service");
    await this.fileGenerator.writeFile("Service/APIClient.ts", clientContent);
  }

  private async generateConfigUtils(): Promise<void> {
    const configContent: string = [
      "export const ServerConfig = {",
      `  name: "${this.config.serverName}",`,
      `  version: "${this.config.serverVersion}",`,
      `  description: "${this.config.description}",`,
      "} as const;",
      "",
      "export const EnvironmentVariables = {",
      '  ONEUPTIME_URL: "ONEUPTIME_URL",',
      '  ONEUPTIME_API_URL: "ONEUPTIME_API_URL",',
      '  ONEUPTIME_API_KEY: "ONEUPTIME_API_KEY",',
      '  API_KEY: "API_KEY",',
      "} as const;",
      "",
      "export function validateEnvironment(): void {",
      "  const apiKey = process.env.ONEUPTIME_API_KEY || process.env.API_KEY;",
      "  ",
      "  if (!apiKey) {",
      "    throw new Error(",
      '      "OneUptime API key is required. Please set one of the following environment variables:\\n" +',
      '      "- ONEUPTIME_API_KEY\\n" +',
      '      "- API_KEY"',
      "    );",
      "  }",
      "}",
      "",
      "export function getEnvironmentInfo(): Record<string, string | undefined> {",
      "  return {",
      "    ONEUPTIME_URL: process.env.ONEUPTIME_URL,",
      "    ONEUPTIME_API_URL: process.env.ONEUPTIME_API_URL,",
      '    ONEUPTIME_API_KEY: process.env.ONEUPTIME_API_KEY ? "[REDACTED]" : undefined,',
      '    API_KEY: process.env.API_KEY ? "[REDACTED]" : undefined,',
      "    NODE_ENV: process.env.NODE_ENV,",
      "  };",
      "}",
    ].join("\n");

    this.fileGenerator.ensureDirectoryExists("Utils");
    await this.fileGenerator.writeFile("Utils/Config.ts", configContent);
  }

  private async generateReadme(): Promise<void> {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(this.spec);
    const tools: any[] = parser.getMCPTools();
    const resourceTags: string[] = parser.getResourceTags();

    const toolList: string = tools
      .slice(0, 20)
      .map((tool: any) => {
        return `- **${tool.name}**: ${tool.description}`;
      })
      .join("\n");

    const resourceList: string = resourceTags
      .map((tag: string) => {
        return `- **${StringUtils.toPascalCase(tag)}**`;
      })
      .join("\n");

    const additionalToolsNote: string =
      tools.length > 20 ? `\n...and ${tools.length - 20} more tools` : "";

    const readmeContent: string = `# ${this.config.serverName}

${this.config.description}

This is a Model Context Protocol (MCP) server that provides access to OneUptime's APIs, allowing LLMs to interact with your OneUptime instance for monitoring, incident management, and observability operations.

## Features

- **Complete API Coverage**: Access to ${tools.length} OneUptime API endpoints
- **Resource Management**: Manage ${resourceTags.length} different resource types including ${resourceTags.slice(0, 5).join(", ")}${resourceTags.length > 5 ? ", and more" : ""}
- **Real-time Operations**: Create, read, update, and delete resources in your OneUptime instance
- **Type-safe**: Fully typed interface with comprehensive input validation
- **Error Handling**: Robust error handling with detailed error messages
- **Authentication**: Secure API key-based authentication

## Installation

### Via NPM

\`\`\`bash
npm install -g ${this.config.npmPackageName}
\`\`\`

### From Source

\`\`\`bash
git clone https://github.com/OneUptime/oneuptime.git
npm run generate-mcp-server
cd oneuptime/MCP
npm install
npm run build
\`\`\`

## Configuration

### Environment Variables

The MCP server requires the following environment variables:

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| \`ONEUPTIME_API_KEY\` | Your OneUptime API key | Yes | \`xxxxxxxx-xxxx-xxxx-xxxx\` |
| \`ONEUPTIME_URL\` | Your OneUptime instance URL | No | \`https://oneuptime.com\` (default) |

### Getting Your API Key

1. **For OneUptime Cloud**:
   - Go to [OneUptime Cloud](https://oneuptime.com) and log in
   - Navigate to **Settings** → **API Keys**
   - Click **Create API Key**
   - Name it "MCP Server" and select appropriate permissions
   - Copy the generated API key

2. **For Self-Hosted OneUptime**:
   - Access your OneUptime instance
   - Navigate to **Settings** → **API Keys**
   - Click **Create API Key**
   - Name it "MCP Server" and select appropriate permissions
   - Copy the generated API key

## Usage

### With Claude Desktop

Add the following to your Claude Desktop configuration file:

\`\`\`json
{
  "mcpServers": {
    "oneuptime": {
      "command": "${this.config.serverName}",
      "env": {
        "ONEUPTIME_API_KEY": "your-api-key-here",
        "ONEUPTIME_URL": "https://oneuptime.com"
      }
    }
  }
}
\`\`\`

### With Other MCP Clients

The server can be used with any MCP-compatible client by running:

\`\`\`bash
${this.config.serverName}
\`\`\`

Ensure the environment variables are set before running the server.

## Available Tools

The MCP server provides access to the following OneUptime operations:

${toolList}${additionalToolsNote}

## Resource Types

You can manage the following OneUptime resources:

${resourceList}

## Development

### Prerequisites

- Node.js 18+
- TypeScript 5+
- OneUptime API access

### Setup

1. Clone the repository and navigate to the generated MCP directory
2. Install dependencies: \`npm install\`
3. Set up environment variables
4. Start development server: \`npm run dev\`

### Building

\`\`\`bash
npm run build
\`\`\`

### Testing

\`\`\`bash
npm test
\`\`\`

## License

This project is licensed under the Apache 2.0 License.

---

Generated from OneUptime OpenAPI specification v${this.spec.info.version}
`;

    await this.fileGenerator.writeFile("README.md", readmeContent);
  }

  private async generateTsConfig(): Promise<void> {
    const tsConfigContent: string = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./build",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "removeComments": false,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitThis": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    "exactOptionalPropertyTypes": false,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": false,
    "noUncheckedIndexedAccess": false
  },
  "include": [
    "**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "build",
    "**/*.test.ts",
    "**/*.spec.ts"
  ]
}
`;

    await this.fileGenerator.writeFile("tsconfig.json", tsConfigContent);
  }

  private async generateNodemonConfig(): Promise<void> {
    const nodemonContent: string = `{
  "watch": ["**/*.ts"],
  "ext": "ts",
  "ignore": ["build/**/*", "node_modules/**/*"],
  "exec": "ts-node Index.ts",
  "env": {
    "NODE_ENV": "development"
  }
}
`;

    await this.fileGenerator.writeFile("nodemon.json", nodemonContent);
  }

  private async generateDockerfile(): Promise<void> {
    const dockerContent: string = `FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S oneuptime -u 1001

# Change ownership of the app directory
RUN chown -R oneuptime:nodejs /app
USER oneuptime

# Expose port (if needed for debugging)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Start the application
CMD ["node", "build/Index.js"]
`;

    await this.fileGenerator.writeFile("Dockerfile", dockerContent);
  }
}
