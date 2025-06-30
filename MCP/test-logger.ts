#!/usr/bin/env npx ts-node

import MCPLogger from "./Utils/MCPLogger";

// Test the MCP Logger to verify it outputs to stderr
MCPLogger.info("Test info message - should go to stderr");
MCPLogger.warn("Test warning message - should go to stderr");
MCPLogger.error("Test error message - should go to stderr");

// This should go to stdout and would cause MCP parsing issues
console.log("This would cause MCP parsing issues");

// Show that stdout is clear for JSON-RPC
process.stdout.write('{"jsonrpc":"2.0","id":1,"result":"test"}\n');
