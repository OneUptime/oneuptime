import {
  countExternalMcpServerChangingTools,
  countExternalMcpServerReadOnlyTools,
  readExternalMcpServerTool,
  readExternalMcpServerTools,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import {
  MAX_EXTERNAL_MCP_SERVER_TOOLS,
  MAX_EXTERNAL_MCP_TOOL_DESCRIPTION_CHARS,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerLimits";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import {
  EXTERNAL_MCP_SERVER_TRANSPORT_TITLES,
  isExternalMcpServerTransport,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import {
  ExternalMcpServerFailureKind,
  isExternalMcpServerFailureKind,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import { describe, expect, test } from "@jest/globals";

/*
 * The tools a server offered, as its record keeps them: text from outside
 * OneUptime, read back defensively - and the names the run's activity uses.
 */

describe("readExternalMcpServerTools", () => {
  test("keeps each tool's name, title, description and whether it only reads", () => {
    expect(
      readExternalMcpServerTools([
        {
          name: "describe_instances",
          title: "Describe instances",
          description: "Lists instances.",
          readsOnly: true,
        },
        { name: "restart_service", readsOnly: false },
      ]),
    ).toEqual([
      {
        name: "describe_instances",
        title: "Describe instances",
        description: "Lists instances.",
        readsOnly: true,
      },
      { name: "restart_service", readsOnly: false },
    ]);
  });

  test("leaves out what is not a tool, and a name given twice", () => {
    expect(
      readExternalMcpServerTools([
        null,
        "tool",
        [],
        { name: "" },
        { name: 5 },
        { name: "a", readsOnly: "yes" },
        { name: "a", readsOnly: true },
        { name: "n".repeat(129) },
      ]),
    ).toEqual([{ name: "a", readsOnly: false }]);
    expect(readExternalMcpServerTools("not a list")).toEqual([]);
  });

  test("holds a description to its length", () => {
    const tool: { description?: string | undefined } | null =
      readExternalMcpServerTool({
        name: "x",
        description: "d".repeat(MAX_EXTERNAL_MCP_TOOL_DESCRIPTION_CHARS + 50),
      });

    expect(tool?.description).toHaveLength(
      MAX_EXTERNAL_MCP_TOOL_DESCRIPTION_CHARS,
    );
    expect(tool?.description?.endsWith("…")).toBe(true);
  });

  test("keeps at most MAX_EXTERNAL_MCP_SERVER_TOOLS tools", () => {
    const stored: Array<{ name: string }> = [];

    for (
      let index: number = 0;
      index < MAX_EXTERNAL_MCP_SERVER_TOOLS + 5;
      index++
    ) {
      stored.push({ name: `tool_${index}` });
    }

    expect(readExternalMcpServerTools(stored)).toHaveLength(
      MAX_EXTERNAL_MCP_SERVER_TOOLS,
    );
  });

  test("counts the tools that only read and those that may change something", () => {
    const tools: Array<{ name: string; readsOnly: boolean }> = [
      { name: "a", readsOnly: true },
      { name: "b", readsOnly: false },
      { name: "c", readsOnly: false },
    ];

    expect(countExternalMcpServerReadOnlyTools(tools)).toBe(1);
    expect(countExternalMcpServerChangingTools(tools)).toBe(2);
  });
});

describe("ExternalMcpToolNames", () => {
  test("names the two tools", () => {
    expect(LIST_MCP_TOOLS_TOOL_NAME).toBe("list_mcp_tools");
    expect(CALL_MCP_TOOL_TOOL_NAME).toBe("call_mcp_tool");
  });
});

describe("transports and failures", () => {
  test("names both transports", () => {
    expect(EXTERNAL_MCP_SERVER_TRANSPORT_TITLES).toEqual({
      StreamableHttp: "Streamable HTTP",
      Sse: "SSE",
    });
    expect(isExternalMcpServerTransport("Sse")).toBe(true);
    expect(isExternalMcpServerTransport("WebSocket")).toBe(false);
  });

  test("knows every kind of failure", () => {
    for (const kind of Object.values(ExternalMcpServerFailureKind)) {
      expect(isExternalMcpServerFailureKind(kind)).toBe(true);
    }

    expect(isExternalMcpServerFailureKind("Nope")).toBe(false);
  });
});
