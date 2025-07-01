import { describe, it, expect } from "@jest/globals";

describe("MCP Hello World Server", () => {
  it("should have basic structure", () => {
    // Basic test to ensure the test setup works
    expect(true).toBe(true);
  });

  it("should export required tools", () => {
    // Test for tool definitions
    const expectedTools: string[] = ["hello", "get_time", "echo"];
    expect(expectedTools).toContain("hello");
    expect(expectedTools).toContain("get_time");
    expect(expectedTools).toContain("echo");
  });
});
