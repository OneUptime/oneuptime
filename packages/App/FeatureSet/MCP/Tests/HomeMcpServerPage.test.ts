import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import fs from "fs";
import path from "path";
import { generateAllTools } from "../Tools/ToolGenerator";
import { McpToolInfo } from "../Types/McpTypes";

/*
 * The website's MCP server page (packages/Home: Views/mcp-server.ejs,
 * Utils/McpServerPage.ts) and its Markdown copy name tools. They used to name
 * query_logs, get_metrics and search_traces, which this server has never had,
 * so an agent reading the page looked for tools it could not find. Every tool
 * they name is held here to the tools this server lists.
 *
 * Read from the file rather than imported: the App compiles this folder, and
 * its build has no reason to take in a file of the website's.
 */
const PAGE_CONTENT: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "Home",
    "Utils",
    "McpServerPage.ts",
  ),
  "utf8",
);

const namedOnThePage: Array<string> = [
  ...PAGE_CONTENT.matchAll(/name: "(\w+)"/g),
].map((match: RegExpMatchArray): string => {
  return match[1] as string;
});

describe("the tools the website's MCP server page names", () => {
  test("are read from the page's content", () => {
    expect(namedOnThePage).toEqual([
      "list_incidents",
      "list_monitors",
      "list_logs",
      "list_metrics",
      "list_spans",
    ]);
  });

  test("are tools this server lists", () => {
    const toolNames: Set<string> = new Set(
      generateAllTools().map((tool: McpToolInfo): string => {
        return tool.name;
      }),
    );

    expect(
      namedOnThePage.filter((name: string): boolean => {
        return !toolNames.has(name);
      }),
    ).toEqual([]);
  });
});
