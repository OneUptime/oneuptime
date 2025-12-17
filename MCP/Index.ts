#!/usr/bin/env npx ts-node

/**
 * OneUptime MCP Server
 * Main entry point for the Model Context Protocol server
 */

import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import "ejs";

import { APP_NAME, getApiUrl } from "./Config/ServerConfig";
import { initializeMCPServer, getMCPServer } from "./Server/MCPServer";
import { registerToolHandlers } from "./Handlers/ToolHandler";
import { setupMCPRoutes } from "./Handlers/RouteHandler";
import { generateAllTools } from "./Tools/ToolGenerator";
import OneUptimeApiService, { OneUptimeApiConfig } from "./Services/OneUptimeApiService";
import { McpToolInfo } from "./Types/McpTypes";

const app: ExpressApplication = Express.getExpressApp();

/**
 * Initialize OneUptime API Service
 */
function initializeApiService(): void {
    const apiUrl: string = getApiUrl();

    const config: OneUptimeApiConfig = {
        url: apiUrl,
    };

    OneUptimeApiService.initialize(config);
    logger.info(
        `OneUptime API Service initialized with: ${apiUrl} (API keys provided per-request via x-api-key header)`
    );
}

/**
 * Generate MCP tools for all models
 */
function generateTools(): McpToolInfo[] {
    try {
        const tools: McpToolInfo[] = generateAllTools();
        logger.info(`Generated ${tools.length} OneUptime MCP tools`);
        return tools;
    } catch (error) {
        logger.error(`Failed to generate tools: ${error}`);
        throw error;
    }
}

/**
 * Simple status check for MCP (no database connections)
 */
const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
    // MCP server doesn't connect to databases directly
    // Just verify the server is running
    return Promise.resolve();
};

/**
 * Main initialization function
 */
const init: PromiseVoidFunction = async (): Promise<void> => {
    try {
        // Initialize telemetry
        Telemetry.init({
            serviceName: APP_NAME,
        });

        // Initialize the app with service name and status checks
        await App.init({
            appName: APP_NAME,
            statusOptions: {
                liveCheck: statusCheck,
                readyCheck: statusCheck,
            },
        });

        // Initialize services
        initializeApiService();

        // Initialize MCP server
        initializeMCPServer();

        // Generate tools
        const tools: McpToolInfo[] = generateTools();

        // Register tool handlers
        registerToolHandlers(getMCPServer(), tools);

        // Setup MCP-specific routes
        setupMCPRoutes(app, tools);

        // Add default routes to the app
        await App.addDefaultRoutes();

        logger.info(`OneUptime MCP Server started successfully`);
        logger.info(`Available tools: ${tools.length} total`);

        // Log some example tools
        const exampleTools: string[] = tools.slice(0, 5).map((t: McpToolInfo) => t.name);
        logger.info(`Example tools: ${exampleTools.join(", ")}`);
    } catch (err) {
        logger.error("MCP Server Init Failed:");
        logger.error(err);
        throw err;
    }
};

// Start the server
init().catch((err: Error) => {
    logger.error(err);
    logger.error("Exiting node process");
    process.exit(1);
});
