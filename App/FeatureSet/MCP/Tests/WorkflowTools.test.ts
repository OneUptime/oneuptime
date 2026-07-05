/**
 * Workflow tool tests.
 *
 * These tools compose multiple OneUptime API calls (state lookup + timeline
 * creation) so agents can acknowledge/resolve incidents and alerts without
 * insider knowledge of the data model. The API layer is mocked via a spy on
 * OneUptimeApiService.makeAuthenticatedApiCall — no HTTP is performed.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  generateWorkflowTools,
  isWorkflowTool,
  handleWorkflowTool,
} from "../Tools/WorkflowTools";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import { McpToolInfo } from "../Types/McpTypes";
import { JSONObject, JSONArray } from "Common/Types/JSON";

const VALID_UUID: string = "550e8400-e29b-41d4-a716-446655440000";
const API_KEY: string = "test-api-key";

const WORKFLOW_TOOL_NAMES: string[] = [
  "acknowledge_incident",
  "resolve_incident",
  "acknowledge_alert",
  "resolve_alert",
  "add_incident_note",
  "add_alert_note",
  "oneuptime_whoami",
];

describe("WorkflowTools", () => {
  // Bare SpyInstance keeps the annotation compatible across @types/jest versions
  let apiCallSpy: jest.SpyInstance;

  beforeEach(() => {
    apiCallSpy = jest
      .spyOn(OneUptimeApiService, "makeAuthenticatedApiCall")
      .mockResolvedValue({} as never) as unknown as jest.SpyInstance;
  });

  afterEach(() => {
    apiCallSpy.mockRestore();
  });

  describe("isWorkflowTool", () => {
    it("recognizes all workflow tool names", () => {
      WORKFLOW_TOOL_NAMES.forEach((name: string) => {
        expect(isWorkflowTool(name)).toBe(true);
      });
    });

    it("rejects non-workflow tool names", () => {
      expect(isWorkflowTool("list_incidents")).toBe(false);
      expect(isWorkflowTool("oneuptime_help")).toBe(false);
      expect(isWorkflowTool("create_incident")).toBe(false);
    });
  });

  describe("generateWorkflowTools", () => {
    it("generates all workflow tools with titles and annotations", () => {
      const tools: McpToolInfo[] = generateWorkflowTools();

      expect(
        tools
          .map((tool: McpToolInfo) => {
            return tool.name;
          })
          .sort(),
      ).toEqual([...WORKFLOW_TOOL_NAMES].sort());

      tools.forEach((tool: McpToolInfo) => {
        expect(typeof tool.title).toBe("string");
        expect((tool.title as string).length).toBeGreaterThan(0);
        expect(tool.annotations).toBeDefined();
      });
    });

    it("marks whoami read-only and mutating tools non-destructive", () => {
      const tools: McpToolInfo[] = generateWorkflowTools();
      const whoami: McpToolInfo | undefined = tools.find(
        (tool: McpToolInfo) => {
          return tool.name === "oneuptime_whoami";
        },
      );
      const acknowledge: McpToolInfo | undefined = tools.find(
        (tool: McpToolInfo) => {
          return tool.name === "acknowledge_incident";
        },
      );

      expect(whoami?.annotations).toEqual({ readOnlyHint: true });
      expect(acknowledge?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
      });
    });
  });

  describe("acknowledge_incident", () => {
    it("looks up the Acknowledged state, then creates a timeline entry", async () => {
      apiCallSpy
        .mockResolvedValueOnce({
          data: [{ _id: "state-1", name: "Acknowledged" }],
        } as never)
        .mockResolvedValueOnce({} as never);

      const result: JSONObject = await handleWorkflowTool(
        "acknowledge_incident",
        { incidentId: VALID_UUID },
        API_KEY,
      );

      expect(apiCallSpy).toHaveBeenCalledTimes(2);
      expect(apiCallSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          method: "POST",
          path: "/api/incident-state/get-list",
          apiKey: API_KEY,
          body: expect.objectContaining({
            query: { isAcknowledgedState: true },
          }),
        }),
      );
      expect(apiCallSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          method: "POST",
          path: "/api/incident-state-timeline",
          apiKey: API_KEY,
          body: {
            data: {
              incidentId: VALID_UUID,
              incidentStateId: "state-1",
            },
          },
        }),
      );

      expect(result["success"]).toBe(true);
      expect(result["operation"]).toBe("acknowledge_incident");
      expect(result["incidentId"]).toBe(VALID_UUID);
      expect(result["newState"]).toBe("Acknowledged");
    });

    it("rejects a non-UUID incidentId without calling the API", async () => {
      await expect(
        handleWorkflowTool(
          "acknowledge_incident",
          { incidentId: "not-a-uuid" },
          API_KEY,
        ),
      ).rejects.toThrow(/UUID/);

      expect(apiCallSpy).not.toHaveBeenCalled();
    });

    it("rejects when incidentId is missing", async () => {
      await expect(
        handleWorkflowTool("acknowledge_incident", {}, API_KEY),
      ).rejects.toThrow(/'incidentId' is required/);

      expect(apiCallSpy).not.toHaveBeenCalled();
    });

    it("fails with a friendly error when the state cannot be found", async () => {
      apiCallSpy.mockResolvedValueOnce({ data: [] } as never);

      await expect(
        handleWorkflowTool(
          "acknowledge_incident",
          { incidentId: VALID_UUID },
          API_KEY,
        ),
      ).rejects.toThrow(/Acknowledged/);

      // No timeline entry may be created when the lookup fails.
      expect(apiCallSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolve_alert", () => {
    it("uses the alert state and alert timeline endpoints", async () => {
      apiCallSpy
        .mockResolvedValueOnce({
          data: [{ _id: "state-9", name: "Resolved" }],
        } as never)
        .mockResolvedValueOnce({} as never);

      const result: JSONObject = await handleWorkflowTool(
        "resolve_alert",
        { alertId: VALID_UUID },
        API_KEY,
      );

      expect(apiCallSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          path: "/api/alert-state/get-list",
          body: expect.objectContaining({
            query: { isResolvedState: true },
          }),
        }),
      );
      expect(apiCallSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          path: "/api/alert-state-timeline",
          body: {
            data: {
              alertId: VALID_UUID,
              alertStateId: "state-9",
            },
          },
        }),
      );

      expect(result["success"]).toBe(true);
      expect(result["operation"]).toBe("resolve_alert");
      expect(result["newState"]).toBe("Resolved");
    });
  });

  describe("add_incident_note", () => {
    it("creates an internal note by default", async () => {
      apiCallSpy.mockResolvedValueOnce({ _id: "note-1" } as never);

      const result: JSONObject = await handleWorkflowTool(
        "add_incident_note",
        { incidentId: VALID_UUID, note: "Investigating." },
        API_KEY,
      );

      expect(apiCallSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/api/incident-internal-note",
          body: {
            data: {
              incidentId: VALID_UUID,
              note: "Investigating.",
            },
          },
        }),
      );
      expect(result["success"]).toBe(true);
      expect(result["visibility"]).toBe("internal");
      expect(result["noteId"]).toBe("note-1");
    });

    it("posts to the public note endpoint when visibility is public", async () => {
      apiCallSpy.mockResolvedValueOnce({ _id: "note-2" } as never);

      const result: JSONObject = await handleWorkflowTool(
        "add_incident_note",
        {
          incidentId: VALID_UUID,
          note: "We found the issue.",
          visibility: "public",
        },
        API_KEY,
      );

      expect(apiCallSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/incident-public-note",
        }),
      );
      expect(result["visibility"]).toBe("public");
    });
  });

  describe("oneuptime_whoami", () => {
    it("maps the project list into projectId/projectName pairs", async () => {
      apiCallSpy.mockResolvedValueOnce({
        data: [{ _id: "proj-1", name: "Acme" }],
      } as never);

      const result: JSONObject = await handleWorkflowTool(
        "oneuptime_whoami",
        {},
        API_KEY,
      );

      expect(apiCallSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/api/project/get-list",
          apiKey: API_KEY,
        }),
      );
      expect(result["success"]).toBe(true);
      expect(result["projects"] as JSONArray).toEqual([
        { projectId: "proj-1", projectName: "Acme" },
      ]);
    });
  });

  describe("unknown tools", () => {
    it("rejects unknown workflow tool names", async () => {
      await expect(
        handleWorkflowTool("not_a_workflow_tool", {}, API_KEY),
      ).rejects.toThrow(/Unknown workflow tool/);
    });
  });
});
