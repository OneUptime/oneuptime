/**
 * Public status page tool tests.
 *
 * The four get_public_status_page_* tools need no API key, so the only thing
 * standing between an AI agent and a status page's data is the enableMcpServer
 * gate in handlePublicStatusPageTool. These tests cover:
 * - the gate opens when MCP is enabled and closes when it is not
 * - the gate fails CLOSED on a database error (no request is made)
 * - identifier validation still runs BEFORE the gate, so a malformed
 *   identifier never reaches the database
 * - "disabled" and "does not exist" are indistinguishable, so the tools cannot
 *   be used to enumerate status pages
 *
 * StatusPageService is mocked, so no database is touched; API.post is spied on,
 * so no HTTP traffic occurs.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

jest.mock("../Utils/MCPLogger");
jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      isMcpServerEnabled: jest.fn(),
    },
  };
});

import {
  generatePublicStatusPageTools,
  isPublicStatusPageTool,
  handlePublicStatusPageTool,
} from "../Tools/PublicStatusPageTools";
import { McpToolInfo } from "../Types/McpTypes";
import MCPLogger from "../Utils/MCPLogger";
import StatusPageService from "Common/Server/Services/StatusPageService";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";

const VALID_UUID: string = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_UUID: string = "660e8400-e29b-41d4-a716-446655440001";
const DOMAIN: string = "status.company.com";

const ALL_TOOLS: Array<string> = [
  "get_public_status_page_overview",
  "get_public_status_page_incidents",
  "get_public_status_page_scheduled_maintenance",
  "get_public_status_page_announcements",
];

// Bare jest.Mock keeps the annotation compatible across @types/jest versions;
// mocked values are cast with `as never`, as elsewhere in this suite.
function enabledMock(): jest.Mock {
  return StatusPageService.isMcpServerEnabled as unknown as jest.Mock;
}

function parse(raw: string): JSONObject {
  return JSON.parse(raw) as JSONObject;
}

describe("PublicStatusPageTools", () => {
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    postSpy = jest.spyOn(API, "post").mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}) as never,
    ) as unknown as jest.SpyInstance;

    enabledMock().mockReset();
    // Default to enabled — the shipped default for every status page.
    enabledMock().mockResolvedValue(true as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("tool metadata", () => {
    it("generates exactly the four public status page tools", () => {
      const tools: Array<McpToolInfo> = generatePublicStatusPageTools();

      expect(tools).toHaveLength(4);
      expect(
        tools.map((tool: McpToolInfo) => {
          return tool.name;
        }),
      ).toEqual(ALL_TOOLS);
    });

    it("recognizes each public tool and rejects non-public tools", () => {
      for (const name of ALL_TOOLS) {
        expect(isPublicStatusPageTool(name)).toBe(true);
      }

      expect(isPublicStatusPageTool("oneuptime_help")).toBe(false);
      expect(isPublicStatusPageTool("get_status_page")).toBe(false);
    });

    it("tells agents the setting exists, so a refusal is actionable", () => {
      const tools: Array<McpToolInfo> = generatePublicStatusPageTools();

      for (const tool of tools) {
        expect(tool.description).toContain("disable MCP access");
      }
    });
  });

  describe("when MCP is enabled", () => {
    it.each(ALL_TOOLS)("serves %s", async (toolName: string) => {
      const result: JSONObject = parse(
        await handlePublicStatusPageTool(toolName, {
          statusPageIdOrDomain: VALID_UUID,
        }),
      );

      expect(result["success"]).toBe(true);
      expect(result["statusPageIdOrDomain"]).toBe(VALID_UUID);
      expect(result["data"]).toEqual({ ok: true });
    });

    it("requests the overview endpoint exactly once", async () => {
      await handlePublicStatusPageTool("get_public_status_page_overview", {
        statusPageIdOrDomain: VALID_UUID,
      });

      expect(postSpy).toHaveBeenCalledTimes(1);

      const url: string = (
        postSpy.mock.calls[0]![0] as { url: { toString: () => string } }
      ).url.toString();

      expect(url).toContain(`/api/status-page/overview/${VALID_UUID}`);
    });

    it("routes to the incident sub-path when an incidentId is given", async () => {
      await handlePublicStatusPageTool("get_public_status_page_incidents", {
        statusPageIdOrDomain: VALID_UUID,
        incidentId: OTHER_UUID,
      });

      const url: string = (
        postSpy.mock.calls[0]![0] as { url: { toString: () => string } }
      ).url.toString();

      expect(url).toContain(
        `/api/status-page/incidents/${VALID_UUID}/${OTHER_UUID}`,
      );
    });

    it("reports the operation name for each tool", async () => {
      const expected: Record<string, string> = {
        get_public_status_page_overview: "get_overview",
        get_public_status_page_incidents: "get_incidents",
        get_public_status_page_scheduled_maintenance: "get_scheduled_maintenance",
        get_public_status_page_announcements: "get_announcements",
      };

      for (const toolName of ALL_TOOLS) {
        const result: JSONObject = parse(
          await handlePublicStatusPageTool(toolName, {
            statusPageIdOrDomain: VALID_UUID,
          }),
        );

        expect(result["operation"]).toBe(expected[toolName]);
      }
    });

    it("checks the gate exactly once per call", async () => {
      await handlePublicStatusPageTool("get_public_status_page_overview", {
        statusPageIdOrDomain: VALID_UUID,
      });

      expect(enabledMock()).toHaveBeenCalledTimes(1);
    });

    it("passes a UUID identifier through to the gate unchanged", async () => {
      await handlePublicStatusPageTool("get_public_status_page_overview", {
        statusPageIdOrDomain: VALID_UUID,
      });

      expect(enabledMock()).toHaveBeenCalledWith(VALID_UUID);
    });

    it("passes a domain identifier through to the gate unchanged", async () => {
      await handlePublicStatusPageTool("get_public_status_page_overview", {
        statusPageIdOrDomain: DOMAIN,
      });

      expect(enabledMock()).toHaveBeenCalledWith(DOMAIN);
    });

    it("pretty-prints success payloads", async () => {
      const raw: string = await handlePublicStatusPageTool(
        "get_public_status_page_overview",
        { statusPageIdOrDomain: VALID_UUID },
      );

      expect(raw).toContain("\n  ");
    });

    it("surfaces an upstream API error through the standard envelope", async () => {
      postSpy.mockResolvedValue(
        new HTTPErrorResponse(404, { message: "Not found" }, {}) as never,
      );

      const result: JSONObject = parse(
        await handlePublicStatusPageTool("get_public_status_page_overview", {
          statusPageIdOrDomain: VALID_UUID,
        }),
      );

      expect(result["success"]).toBe(false);
      expect(result["error"]).toContain(
        "Failed to execute get_public_status_page_overview",
      );
    });
  });

  describe("when MCP is disabled", () => {
    beforeEach(() => {
      enabledMock().mockResolvedValue(false as never);
    });

    it.each(ALL_TOOLS)("refuses %s", async (toolName: string) => {
      const result: JSONObject = parse(
        await handlePublicStatusPageTool(toolName, {
          statusPageIdOrDomain: VALID_UUID,
        }),
      );

      expect(result["success"]).toBe(false);
      expect(result["error"]).toBe(
        `Status page '${VALID_UUID}' is not available over MCP.`,
      );
    });

    it("never reaches the status page API", async () => {
      for (const toolName of ALL_TOOLS) {
        await handlePublicStatusPageTool(toolName, {
          statusPageIdOrDomain: VALID_UUID,
        });
      }

      expect(postSpy).not.toHaveBeenCalled();
    });

    it("refuses a domain identifier the same way as a UUID", async () => {
      const byDomain: JSONObject = parse(
        await handlePublicStatusPageTool("get_public_status_page_overview", {
          statusPageIdOrDomain: DOMAIN,
        }),
      );

      expect(byDomain["error"]).toBe(
        `Status page '${DOMAIN}' is not available over MCP.`,
      );
      expect(postSpy).not.toHaveBeenCalled();
    });

    /*
     * "Status page does not exist" and "owner turned MCP off" are deliberately
     * indistinguishable here, otherwise these unauthenticated tools become a
     * status page enumeration oracle. That property cannot be observed at this
     * layer — isMcpServerEnabled collapses both cases into false before the
     * tool sees them — so it is pinned in StatusPageServiceMcp.test.ts instead.
     */

    it("returns a compact refusal with only success and error", async () => {
      const raw: string = await handlePublicStatusPageTool(
        "get_public_status_page_overview",
        { statusPageIdOrDomain: VALID_UUID },
      );

      expect(raw).not.toContain("\n");
      expect(Object.keys(parse(raw)).sort()).toEqual(["error", "success"]);
    });
  });

  describe("when the database fails", () => {
    beforeEach(() => {
      enabledMock().mockRejectedValue(new Error("connection terminated") as never);
    });

    it("fails closed rather than serving the status page", async () => {
      await handlePublicStatusPageTool("get_public_status_page_overview", {
        statusPageIdOrDomain: VALID_UUID,
      });

      expect(postSpy).not.toHaveBeenCalled();
    });

    it("reports the failure through the standard error envelope", async () => {
      const result: JSONObject = parse(
        await handlePublicStatusPageTool("get_public_status_page_overview", {
          statusPageIdOrDomain: VALID_UUID,
        }),
      );

      expect(result["success"]).toBe(false);
      expect(result["error"]).toContain(
        "Failed to execute get_public_status_page_overview",
      );
      expect(result["error"]).toContain("connection terminated");
    });

    it("does not throw out of the tool handler", async () => {
      await expect(
        handlePublicStatusPageTool("get_public_status_page_overview", {
          statusPageIdOrDomain: VALID_UUID,
        }),
      ).resolves.toBeDefined();
    });

    it("logs the failure", async () => {
      await handlePublicStatusPageTool("get_public_status_page_overview", {
        statusPageIdOrDomain: VALID_UUID,
      });

      expect(MCPLogger.error).toHaveBeenCalled();
    });
  });

  describe("validation runs before the gate", () => {
    it("rejects a missing identifier without touching the database", async () => {
      const result: JSONObject = parse(
        await handlePublicStatusPageTool("get_public_status_page_overview", {}),
      );

      expect(result["success"]).toBe(false);
      expect(result["error"]).toBe("statusPageIdOrDomain is required");
      expect(enabledMock()).not.toHaveBeenCalled();
    });

    it.each([
      ["../../etc/passwd", "path traversal"],
      ["foo bar", "a space"],
      ["status.company.com/../admin", "a nested path"],
    ])(
      "rejects %s without touching the database",
      async (identifier: string) => {
        const result: JSONObject = parse(
          await handlePublicStatusPageTool("get_public_status_page_overview", {
            statusPageIdOrDomain: identifier,
          }),
        );

        expect(result["success"]).toBe(false);
        expect(result["error"]).toContain("Invalid statusPageIdOrDomain");
        expect(enabledMock()).not.toHaveBeenCalled();
        expect(postSpy).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["incidentId", "get_public_status_page_incidents"],
      ["scheduledMaintenanceId", "get_public_status_page_scheduled_maintenance"],
      ["announcementId", "get_public_status_page_announcements"],
    ])(
      "rejects a non-UUID %s without touching the database",
      async (idArg: string, toolName: string) => {
        const result: JSONObject = parse(
          await handlePublicStatusPageTool(toolName, {
            statusPageIdOrDomain: VALID_UUID,
            [idArg]: "not-a-uuid",
          }),
        );

        expect(result["success"]).toBe(false);
        expect(result["error"]).toBe(`Invalid ${idArg}: expected a UUID.`);
        // Proves the gate sits after the sub-id loop, not merely after the
        // identifier check.
        expect(enabledMock()).not.toHaveBeenCalled();
      },
    );

    it("treats an empty sub-id as absent and still runs the gate", async () => {
      const result: JSONObject = parse(
        await handlePublicStatusPageTool("get_public_status_page_incidents", {
          statusPageIdOrDomain: VALID_UUID,
          incidentId: "",
        }),
      );

      expect(result["success"]).toBe(true);
      expect(enabledMock()).toHaveBeenCalledTimes(1);
    });
  });

  describe("unknown tools", () => {
    it("reports an unknown tool name once past the gate", async () => {
      const result: JSONObject = parse(
        await handlePublicStatusPageTool("get_public_status_page_nonsense", {
          statusPageIdOrDomain: VALID_UUID,
        }),
      );

      expect(result["success"]).toBe(false);
      expect(result["error"]).toContain("Unknown public status page tool");
    });

    it("refuses an unknown tool for a gated status page too", async () => {
      enabledMock().mockResolvedValue(false as never);

      const result: JSONObject = parse(
        await handlePublicStatusPageTool("get_public_status_page_nonsense", {
          statusPageIdOrDomain: VALID_UUID,
        }),
      );

      expect(result["error"]).toContain("not available over MCP");
    });
  });
});
