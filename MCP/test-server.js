#!/usr/bin/env node

// Simple test script for the OneUptime MCP Server
import MCP from "./Service/MCPServer.js";

async function testMCPServer() {
  try {
    console.log("Testing OneUptime MCP Server...");
    
    // Create MCP server instance
    const mcpServer = new MCP();
    
    console.log("✅ MCP Server created successfully");
    
    // Test would run the server here, but we'll just verify it initializes
    console.log("✅ Test completed successfully");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

testMCPServer();
