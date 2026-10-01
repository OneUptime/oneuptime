/**
 * Workflow tool tests.
 *
 * These tools compose multiple OneUptime API calls (state lookup + timeline
 * creation) so agents can acknowledge/resolve incidents and alerts without
 * insider knowledge of the data model. In most of this file the API layer is
 * mocked via a spy on OneUptimeApiService.makeAuthenticatedApiCall — no HTTP
 * is performed.
 *
 * The last block does perform HTTP, against a small local server that answers
 * as the API does. It exists because the mock above can answer in a shape the
 * real API client never returns: a list endpoint answers
 * `{ data, count, skip, limit }`, and the client hands back the ROWS, not
 * that envelope. Tools that read `.data` off the result passed every mocked
 * test and found nothing in production.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import {
  generateWorkflowTools,
  isReadOnlyWorkflowTool,
  isWorkflowTool,
  handleWorkflowTool,
} from "../Tools/WorkflowTools";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import McpCredentialUtil, { McpCredential } from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import McpDelegationToken from "Common/Server/Utils/Mcp/McpDelegationToken";
import Email from "Common/Types/Email";
import { JSONObject, JSONArray } from "Common/Types/JSON";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";

const VALID_UUID: string = "550e8400-e29b-41d4-a716-446655440000";
const API_KEY: string = "test-api-key";

// A client that signed in with OAuth, as the request gate hands it on.
function oauthCredential(scopes: Array<McpOAuthScope>): McpCredential {
  const grant: McpOAuthGrant = new McpOAuthGrant();

  grant._id = ObjectID.generate().toString();
  grant.projectId = ObjectID.generate();
  grant.userId = ObjectID.generate();
  grant.clientId = ObjectID.generate().toString();
  grant.name = "Claude Code";
  grant.scope = scopes.join(" ");

  return McpCredentialUtil.fromPrincipal({
    grant,
    user: {
      id: grant.userId,
      email: new Email("jane@example.com"),
      name: "Jane Doe",
      isMasterAdmin: false,
    },
    scopes,
  });
}

const OAUTH_READ_WRITE: McpCredential = oauthCredential([
  McpOAuthScope.Read,
  McpOAuthScope.Write,
]);
const OAUTH_READ_ONLY: McpCredential = oauthCredential([McpOAuthScope.Read]);

/*
 * The four tools that move an incident or alert to a state, with what each
 * one looks up and what it then writes.
 */
const STATE_TOOLS: Array<{
  tool: string;
  idArgument: string;
  statePath: string;
  timelinePath: string;
  flag: string;
  stateName: string;
  kind: string;
}> = [
  {
    tool: "acknowledge_incident",
    idArgument: "incidentId",
    statePath: "/api/incident-state/get-list",
    timelinePath: "/api/incident-state-timeline",
    flag: "isAcknowledgedState",
    stateName: "Acknowledged",
    kind: "incident",
  },
  {
    tool: "resolve_incident",
    idArgument: "incidentId",
    statePath: "/api/incident-state/get-list",
    timelinePath: "/api/incident-state-timeline",
    flag: "isResolvedState",
    stateName: "Resolved",
    kind: "incident",
  },
  {
    tool: "acknowledge_alert",
    idArgument: "alertId",
    statePath: "/api/alert-state/get-list",
    timelinePath: "/api/alert-state-timeline",
    flag: "isAcknowledgedState",
    stateName: "Acknowledged",
    kind: "alert",
  },
  {
    tool: "resolve_alert",
    idArgument: "alertId",
    statePath: "/api/alert-state/get-list",
    timelinePath: "/api/alert-state-timeline",
    flag: "isResolvedState",
    stateName: "Resolved",
    kind: "alert",
  },
];

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
          credential: API_KEY,
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
          credential: API_KEY,
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
          credential: API_KEY,
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

  describe("isReadOnlyWorkflowTool", () => {
    it("marks whoami, and only whoami, as a tool that only reads", () => {
      expect(
        WORKFLOW_TOOL_NAMES.filter((name: string): boolean => {
          return isReadOnlyWorkflowTool(name);
        }),
      ).toEqual(["oneuptime_whoami"]);
    });

    it("agrees with the readOnlyHint each tool shows to clients", () => {
      for (const tool of generateWorkflowTools()) {
        expect(isReadOnlyWorkflowTool(tool.name)).toBe(
          tool.annotations?.readOnlyHint === true,
        );
      }
    });

    it("is false for a tool that is not a workflow tool at all", () => {
      expect(isReadOnlyWorkflowTool("list_incidents")).toBe(false);
      expect(isReadOnlyWorkflowTool("oneuptime_help")).toBe(false);
      expect(isReadOnlyWorkflowTool("")).toBe(false);
    });
  });

  describe("a list answered the way the API client really answers it: as the rows themselves", () => {
    it.each(STATE_TOOLS)(
      "$tool finds the state in a bare array and writes the timeline entry",
      async (definition: (typeof STATE_TOOLS)[number]) => {
        apiCallSpy
          .mockResolvedValueOnce([
            { _id: "state-7", name: definition.stateName },
          ] as never)
          .mockResolvedValueOnce({ _id: "timeline-1" } as never);

        const result: JSONObject = await handleWorkflowTool(
          definition.tool,
          { [definition.idArgument]: VALID_UUID },
          API_KEY,
        );

        expect(apiCallSpy).toHaveBeenCalledTimes(2);
        expect(apiCallSpy).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            method: "POST",
            path: definition.statePath,
            body: expect.objectContaining({
              query: { [definition.flag]: true },
            }),
          }),
        );
        expect(apiCallSpy).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            method: "POST",
            path: definition.timelinePath,
            body: {
              data: {
                [definition.idArgument]: VALID_UUID,
                [`${definition.kind}StateId`]: "state-7",
              },
            },
          }),
        );

        expect(result["success"]).toBe(true);
        expect(result["operation"]).toBe(definition.tool);
        expect(result["newState"]).toBe(definition.stateName);
      },
    );

    it.each(STATE_TOOLS)(
      "$tool still accepts the envelope, for a caller that passes one through",
      async (definition: (typeof STATE_TOOLS)[number]) => {
        apiCallSpy
          .mockResolvedValueOnce({
            data: [{ _id: "state-8", name: definition.stateName }],
            count: 1,
            skip: 0,
            limit: 1,
          } as never)
          .mockResolvedValueOnce({} as never);

        const result: JSONObject = await handleWorkflowTool(
          definition.tool,
          { [definition.idArgument]: VALID_UUID },
          API_KEY,
        );

        expect(result["success"]).toBe(true);
        expect(apiCallSpy).toHaveBeenCalledTimes(2);
      },
    );

    it("whoami lists the projects in a bare array", async () => {
      apiCallSpy.mockResolvedValueOnce([
        { _id: "proj-1", name: "Acme" },
        { _id: "proj-2", name: "Globex" },
      ] as never);

      const result: JSONObject = await handleWorkflowTool(
        "oneuptime_whoami",
        {},
        API_KEY,
      );

      expect(result["projects"] as JSONArray).toEqual([
        { projectId: "proj-1", projectName: "Acme" },
        { projectId: "proj-2", projectName: "Globex" },
      ]);
      expect(result["message"]).toBe(
        "These are the project(s) your API key can access. projectId is inferred automatically on create operations.",
      );
    });
  });

  describe("a list with nothing in it", () => {
    const EMPTY_ANSWERS: Array<[string, unknown]> = [
      ["an empty array", []],
      ["an envelope with no rows", { data: [], count: 0, skip: 0, limit: 1 }],
      ["null", null],
      ["undefined", undefined],
      ["an empty object", {}],
      ["an envelope whose data is not a list", { data: "nothing" }],
      ["an envelope whose data is an object", { data: { _id: "state-1" } }],
      ["a bare string", "nothing"],
      ["a number", 0],
    ];

    describe.each(EMPTY_ANSWERS)("(%s)", (_label: string, answer: unknown) => {
      it.each(STATE_TOOLS)(
        "$tool says the state could not be found, blames the API key, and writes nothing",
        async (definition: (typeof STATE_TOOLS)[number]) => {
          apiCallSpy.mockResolvedValueOnce(answer as never);

          await expect(
            handleWorkflowTool(
              definition.tool,
              { [definition.idArgument]: VALID_UUID },
              API_KEY,
            ),
          ).rejects.toThrow(
            `Could not find the project's '${definition.stateName}' ${definition.kind} state. The API key may lack permission to read ${definition.kind} states.`,
          );

          // No timeline entry may be created when the lookup finds nothing.
          expect(apiCallSpy).toHaveBeenCalledTimes(1);
        },
      );

      it.each(STATE_TOOLS)(
        "$tool blames the signed-in account, not a key, for a client that signed in",
        async (definition: (typeof STATE_TOOLS)[number]) => {
          apiCallSpy.mockResolvedValueOnce(answer as never);

          await expect(
            handleWorkflowTool(
              definition.tool,
              { [definition.idArgument]: VALID_UUID },
              OAUTH_READ_WRITE,
            ),
          ).rejects.toThrow(
            `Could not find the project's '${definition.stateName}' ${definition.kind} state. Your account may lack permission to read ${definition.kind} states.`,
          );

          expect(apiCallSpy).toHaveBeenCalledTimes(1);
        },
      );

      it("whoami tells an API key that no project is visible to it", async () => {
        apiCallSpy.mockResolvedValueOnce(answer as never);

        const result: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          API_KEY,
        );

        expect(result["success"]).toBe(true);
        expect(result["projects"]).toEqual([]);
        expect(result["message"]).toBe(
          "No project visible to this API key — it may lack read permission on Project.",
        );
      });

      it("whoami tells a signed-in client that its user cannot read the project", async () => {
        apiCallSpy.mockResolvedValueOnce(answer as never);

        const result: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          OAUTH_READ_WRITE,
        );

        expect(result["success"]).toBe(true);
        expect(result["projects"]).toEqual([]);
        expect(result["message"]).toBe(
          "You are signed in with OAuth, but this user cannot read the project - their teams may not grant read permission on Project.",
        );
      });
    });

    it("a state row with no id is no state", async () => {
      apiCallSpy.mockResolvedValueOnce([{ name: "Acknowledged" }] as never);

      await expect(
        handleWorkflowTool(
          "acknowledge_incident",
          { incidentId: VALID_UUID },
          API_KEY,
        ),
      ).rejects.toThrow(/Could not find the project's 'Acknowledged'/);

      expect(apiCallSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("a client that signed in with OAuth", () => {
    it("has its credential, not a key, on every API call a tool makes", async () => {
      apiCallSpy
        .mockResolvedValueOnce([{ _id: "state-1", name: "Resolved" }] as never)
        .mockResolvedValueOnce({} as never);

      await handleWorkflowTool(
        "resolve_incident",
        { incidentId: VALID_UUID },
        OAUTH_READ_WRITE,
      );

      expect(apiCallSpy).toHaveBeenCalledTimes(2);
      expect(apiCallSpy.mock.calls[0]![0].credential).toBe(OAUTH_READ_WRITE);
      expect(apiCallSpy.mock.calls[1]![0].credential).toBe(OAUTH_READ_WRITE);
    });

    it.each<[string, Record<string, unknown>, string]>([
      [
        "add_incident_note",
        { incidentId: VALID_UUID, note: "n" },
        "/api/incident-internal-note",
      ],
      [
        "add_alert_note",
        { alertId: VALID_UUID, note: "n" },
        "/api/alert-internal-note",
      ],
    ])(
      "has it on %s too",
      async (tool: string, args: Record<string, unknown>, path: string) => {
        apiCallSpy.mockResolvedValueOnce({ _id: "note-1" } as never);

        const result: JSONObject = await handleWorkflowTool(
          tool,
          args,
          OAUTH_READ_WRITE,
        );

        expect(result["success"]).toBe(true);
        expect(apiCallSpy).toHaveBeenCalledWith(
          expect.objectContaining({ path, credential: OAUTH_READ_WRITE }),
        );
      },
    );

    describe("whoami", () => {
      it("says who the client is signed in as, through which client, and that it may write", async () => {
        apiCallSpy.mockResolvedValueOnce([
          { _id: "proj-1", name: "Acme" },
        ] as never);

        const result: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          OAUTH_READ_WRITE,
        );

        expect(result).toEqual({
          success: true,
          operation: "oneuptime_whoami",
          projects: [{ projectId: "proj-1", projectName: "Acme" }],
          authentication: "oauth",
          signedInAs: { email: "jane@example.com", name: "Jane Doe" },
          client: "Claude Code",
          access: "read-and-write",
          message:
            "You are signed in with OAuth and act as this OneUptime user in the project above, with that user's permissions. projectId is inferred automatically on create operations.",
        });
      });

      it("tells a read-only client that it is read-only, and what that rules out", async () => {
        apiCallSpy.mockResolvedValueOnce([
          { _id: "proj-1", name: "Acme" },
        ] as never);

        const result: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          OAUTH_READ_ONLY,
        );

        expect(result["access"]).toBe("read-only");
        expect(result["message"]).toBe(
          "You are signed in with OAuth and act as this OneUptime user in the project above, with that user's permissions. projectId is inferred automatically on create operations. This connection is read-only: tools that create, update, delete, acknowledge or resolve will be refused until the user authorizes read and write access.",
        );
      });

      it("says both things to a read-only client whose user cannot read the project", async () => {
        apiCallSpy.mockResolvedValueOnce([] as never);

        const result: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          OAUTH_READ_ONLY,
        );

        expect(result["projects"]).toEqual([]);
        expect(result["access"]).toBe("read-only");
        expect(result["message"]).toBe(
          "You are signed in with OAuth, but this user cannot read the project - their teams may not grant read permission on Project. This connection is read-only: tools that create, update, delete, acknowledge or resolve will be refused until the user authorizes read and write access.",
        );
      });

      it("treats write alone as able to write", async () => {
        apiCallSpy.mockResolvedValueOnce([] as never);

        const result: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          oauthCredential([McpOAuthScope.Write]),
        );

        expect(result["access"]).toBe("read-and-write");
      });

      it("reports no client name when the grant has none", async () => {
        const credential: McpCredential = oauthCredential([McpOAuthScope.Read]);

        if (credential.type === "oauth") {
          delete credential.principal.grant.name;
        }

        apiCallSpy.mockResolvedValueOnce([] as never);

        const result: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          credential,
        );

        expect(result["client"]).toBeNull();
      });

      it("asks the API with the OAuth credential", async () => {
        apiCallSpy.mockResolvedValueOnce([] as never);

        await handleWorkflowTool("oneuptime_whoami", {}, OAUTH_READ_ONLY);

        expect(apiCallSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            method: "POST",
            path: "/api/project/get-list",
            credential: OAUTH_READ_ONLY,
          }),
        );
      });
    });

    describe("an API key's whoami", () => {
      it("says nothing about a sign-in: no authentication, signedInAs, client or access", async () => {
        apiCallSpy.mockResolvedValueOnce([
          { _id: "proj-1", name: "Acme" },
        ] as never);

        const result: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          API_KEY,
        );

        expect(Object.keys(result).sort()).toEqual([
          "message",
          "operation",
          "projects",
          "success",
        ]);
      });

      it("is the same for an API key credential object as for the bare string", async () => {
        apiCallSpy.mockResolvedValue([
          { _id: "proj-1", name: "Acme" },
        ] as never);

        const fromString: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          API_KEY,
        );
        const fromObject: JSONObject = await handleWorkflowTool(
          "oneuptime_whoami",
          {},
          McpCredentialUtil.fromApiKey(API_KEY),
        );

        expect(fromObject).toEqual(fromString);
      });
    });
  });
});

/*
 * No mock of the API layer below this line. The real OneUptimeApiService and
 * the real Common API client talk to a local server that answers a get-list
 * the way the OneUptime API does, so the envelope is unwrapped by the same
 * code that unwraps it in production.
 */
describe("WorkflowTools against an API that answers over HTTP", () => {
  interface ReceivedRequest {
    method: string;
    path: string;
    headers: http.IncomingHttpHeaders;
    body: any;
  }

  const PROJECT_ID: string = "9d6f6f0e-3a61-4d0b-9f0a-2c1a7a5e4b11";
  const STATE_ID: string = "0b0f5c3e-64a6-4b27-8a59-7d8d1f1f0c22";

  let server: http.Server;
  let received: Array<ReceivedRequest>;
  // What each get-list answers with; a test empties one to see "no rows".
  let rowsByPath: Record<string, Array<JSONObject>>;

  beforeAll(async () => {
    server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse): void => {
        let raw: string = "";

        req.setEncoding("utf8");
        req.on("data", (chunk: string): void => {
          raw += chunk;
        });
        req.on("end", (): void => {
          const path: string = req.url || "";

          received.push({
            method: req.method || "",
            path,
            headers: req.headers,
            body: raw ? JSON.parse(raw) : null,
          });

          res.setHeader("Content-Type", "application/json");

          if (path.endsWith("/get-list")) {
            const rows: Array<JSONObject> = rowsByPath[path] || [];

            // The envelope every OneUptime list endpoint answers with.
            res.statusCode = 200;
            res.end(
              JSON.stringify({
                data: rows,
                count: rows.length,
                skip: 0,
                limit: 10,
              }),
            );
            return;
          }

          res.statusCode = 200;
          res.end(JSON.stringify({ _id: "created-1" }));
        });
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, "127.0.0.1", (): void => {
        resolve();
      });
    });

    OneUptimeApiService.initialize({
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
      server.closeAllConnections();
    });
  });

  beforeEach(() => {
    received = [];
    rowsByPath = {
      "/api/project/get-list": [{ _id: PROJECT_ID, name: "Acme Production" }],
      "/api/incident-state/get-list": [{ _id: STATE_ID, name: "Acknowledged" }],
      "/api/alert-state/get-list": [{ _id: STATE_ID, name: "Resolved" }],
    };
  });

  it("whoami lists the project the API returned", async () => {
    const result: JSONObject = await handleWorkflowTool(
      "oneuptime_whoami",
      {},
      API_KEY,
    );

    expect(result["projects"]).toEqual([
      { projectId: PROJECT_ID, projectName: "Acme Production" },
    ]);
    expect(result["message"]).toBe(
      "These are the project(s) your API key can access. projectId is inferred automatically on create operations.",
    );

    expect(received).toHaveLength(1);
    expect(received[0]!.method).toBe("POST");
    expect(received[0]!.path).toBe("/api/project/get-list");
    expect(received[0]!.headers["apikey"]).toBe(API_KEY);
    expect(received[0]!.body).toEqual({
      query: {},
      select: { _id: true, name: true },
      skip: 0,
      limit: 10,
    });
  });

  it("whoami for a signed-in client lists the project, and presents a delegation token to get it", async () => {
    const result: JSONObject = await handleWorkflowTool(
      "oneuptime_whoami",
      {},
      OAUTH_READ_ONLY,
    );

    expect(result["projects"]).toEqual([
      { projectId: PROJECT_ID, projectName: "Acme Production" },
    ]);
    expect(result["authentication"]).toBe("oauth");
    expect(result["access"]).toBe("read-only");

    expect("apikey" in received[0]!.headers).toBe(false);
    expect(
      McpDelegationToken.verify(
        received[0]!.headers["x-oneuptime-mcp-delegation"],
      ),
    ).not.toBeNull();
  });

  it("whoami says so when the API returns no project", async () => {
    rowsByPath["/api/project/get-list"] = [];

    const result: JSONObject = await handleWorkflowTool(
      "oneuptime_whoami",
      {},
      API_KEY,
    );

    expect(result["projects"]).toEqual([]);
    expect(result["message"]).toBe(
      "No project visible to this API key — it may lack read permission on Project.",
    );
  });

  it("acknowledge_incident finds the state the API returned, then creates the timeline entry", async () => {
    const result: JSONObject = await handleWorkflowTool(
      "acknowledge_incident",
      { incidentId: VALID_UUID },
      API_KEY,
    );

    expect(result["success"]).toBe(true);
    expect(result["newState"]).toBe("Acknowledged");

    expect(
      received.map((request: ReceivedRequest): string => {
        return `${request.method} ${request.path}`;
      }),
    ).toEqual([
      "POST /api/incident-state/get-list",
      "POST /api/incident-state-timeline",
    ]);
    expect(received[0]!.body.query).toEqual({ isAcknowledgedState: true });
    expect(received[1]!.body).toEqual({
      data: { incidentId: VALID_UUID, incidentStateId: STATE_ID },
    });
  });

  it("resolve_alert finds the state the API returned, then creates the timeline entry", async () => {
    const result: JSONObject = await handleWorkflowTool(
      "resolve_alert",
      { alertId: VALID_UUID },
      OAUTH_READ_WRITE,
    );

    expect(result["success"]).toBe(true);
    expect(result["newState"]).toBe("Resolved");

    expect(
      received.map((request: ReceivedRequest): string => {
        return `${request.method} ${request.path}`;
      }),
    ).toEqual([
      "POST /api/alert-state/get-list",
      "POST /api/alert-state-timeline",
    ]);
    expect(received[1]!.body).toEqual({
      data: { alertId: VALID_UUID, alertStateId: STATE_ID },
    });
  });

  it("a state tool writes nothing when the API returns no state", async () => {
    rowsByPath["/api/incident-state/get-list"] = [];

    await expect(
      handleWorkflowTool(
        "resolve_incident",
        { incidentId: VALID_UUID },
        API_KEY,
      ),
    ).rejects.toThrow(
      "Could not find the project's 'Resolved' incident state. The API key may lack permission to read incident states.",
    );

    expect(received).toHaveLength(1);
  });
});
