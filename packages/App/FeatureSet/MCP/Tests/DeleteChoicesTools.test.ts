/**
 * WHAT A DELETE SAYS BESIDES THE RECORD, OVER MCP (#9949).
 *
 * OneUptime deletes a custom role that workflows run as only when the
 * delete says what they run as instead, in miscDataProps, and refuses one
 * that does not, naming the workflows (Common/Utils/DeveloperDocs
 * /DeleteChoices.ts). A table's delete tool takes those choices from that
 * one copy, as inputs named by their keys, checked as the CLI checks its
 * flags, sent as the API takes them; a refusal comes back in the API's own
 * words, with a suggestion in the tool's.
 *
 * No table with choices has MCP tools today - custom roles have none - so
 * these build the delete tool a custom role would have (createDeleteTool),
 * and every generated delete tool is held to its table's choices: none.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  /*
   * Only the logger itself is silenced. The module's other exports stay real:
   * the API's error responder calls one of them on every refusal.
   */
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});
jest.mock("../Utils/MCPLogger");

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  getDeleteChoicesSuggestion,
  registerToolHandlers,
} from "../Handlers/ToolHandler";
import { McpServer, createMCPServerInstance } from "../Server/MCPServer";
import OneUptimeApiService, {
  OneUptimeApiError,
} from "../Services/OneUptimeApiService";
import {
  buildDeleteChoiceProperties,
  createDeleteTool,
  describeDeleteTool,
  generateAllTools,
} from "../Tools/ToolGenerator";
import { JSONSchemaProperty, McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import Route from "Common/Types/API/Route";
import Headers from "Common/Types/API/Headers";
import { JSONObject } from "Common/Types/JSON";
import {
  getCustomRoleDeleteWorkflowEditRefusedMessage,
  getCustomRoleDeleteWorkflowsMessage,
} from "Common/Types/Workflow/WorkflowRunAs";
import {
  DeleteChoiceError,
  getDeleteChoices,
} from "Common/Utils/DeveloperDocs/DeleteChoices";

const API_KEY: string = "3b241101-e2bb-4255-8caf-4136c566a962";
const ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000aa";
const OTHER_ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000bb";

// The words OneUptime refuses a delete with that says nothing.
const REFUSAL: string = getCustomRoleDeleteWorkflowsMessage({
  roleNames: ["Incident Responder"],
  workflowNames: ["Close stale incidents"],
  workflowCount: 1,
});

// The delete tool a custom role would have, were custom roles on the MCP server.
const ROLE_DELETE_TOOL: McpToolInfo = createDeleteTool(
  "CustomRole",
  "Custom Role",
  "Custom Roles",
  "/custom-role",
);

const CHOICES_SUGGESTION: string =
  'Nothing was deleted: the error names what depends on it. Ask the user which they want, then call delete_custom_role again with workflowsRunAs set to "Default", or with workflowsRunAs set to "CustomRole" and workflowsRunAsCustomRoleId set to an ID. Do not choose for them.';

const FIX_SUGGESTION: string =
  "Nothing was deleted. Fix what the error names and call delete_custom_role again, with what the user chose: ask them if they have not said.";

type MakeApiRequestArgs = [
  OneUptimeOperation,
  Route,
  Headers,
  JSONObject | undefined,
];

function propertiesOf(tool: McpToolInfo): Record<string, JSONSchemaProperty> {
  return tool.inputSchema.properties || {};
}

describe("a delete tool's inputs", () => {
  it("for a custom role, say what its workflows run as instead, named as the API takes them", () => {
    expect(ROLE_DELETE_TOOL.name).toBe("delete_custom_role");
    expect(ROLE_DELETE_TOOL.operation).toBe(OneUptimeOperation.Delete);
    expect(ROLE_DELETE_TOOL.inputSchema.required).toEqual(["id"]);
    expect(ROLE_DELETE_TOOL.inputSchema.additionalProperties).toBe(false);
    expect(propertiesOf(ROLE_DELETE_TOOL)).toEqual({
      id: { type: "string", description: "ID." },
      workflowsRunAs: {
        type: "string",
        enum: ["Default", "CustomRole"],
        description:
          'What the workflows that run as this custom role run as once it is deleted: "Default", the default permissions, or "CustomRole", another custom role you could give a team, named in workflowsRunAsCustomRoleId. Never Project Owner: deleting a role never raises what a workflow can do.',
      },
      workflowsRunAsCustomRoleId: {
        type: "string",
        description:
          'The ID of the other custom role the workflows run as, when workflowsRunAs is "CustomRole": one you could give a team, and not the role being deleted.',
      },
    });
  });

  it("say when they are needed, and that the user chooses", () => {
    expect(ROLE_DELETE_TOOL.description).toBe(
      "Permanently delete one Custom Role by ID. OneUptime deletes a custom role that workflows run as only when the delete says what they run as instead, and refuses one that does not, naming the workflows. Leave workflowsRunAs and workflowsRunAsCustomRoleId out unless the user chose them: a delete that needs them is refused, saying why.",
    );
    expect(JSON.stringify(ROLE_DELETE_TOOL)).not.toContain("miscDataProps");
    expect(JSON.stringify(ROLE_DELETE_TOOL)).not.toContain("ProjectOwner");
  });

  it("for a table whose delete takes no choices, are its ID alone, as they always were", () => {
    const team: McpToolInfo = createDeleteTool(
      "Team",
      "Team",
      "Teams",
      "/team",
    );

    expect(propertiesOf(team)).toEqual({
      id: { type: "string", description: "ID." },
    });
    expect(team.description).toBe("Permanently delete one Team by ID.");
    expect(buildDeleteChoiceProperties("Team")).toEqual({});
    expect(describeDeleteTool("Team", "Team")).toBe(
      "Permanently delete one Team by ID.",
    );
  });

  it("of every delete tool the server serves are its ID and its table's choices", () => {
    const deletes: Array<McpToolInfo> = generateAllTools().filter(
      (tool: McpToolInfo): boolean => {
        return tool.operation === OneUptimeOperation.Delete;
      },
    );

    expect(deletes.length).toBeGreaterThan(40);

    for (const tool of deletes) {
      expect({
        tool: tool.name,
        inputs: Object.keys(propertiesOf(tool)),
      }).toEqual({
        tool: tool.name,
        inputs: [
          "id",
          ...(getDeleteChoices(tool.tableName)?.choices || []).map(
            (choice: { key: string }): string => {
              return choice.key;
            },
          ),
        ],
      });
    }
  });
});

describe("a delete tool's call", () => {
  let makeApiRequestSpy: jest.SpyInstance;

  beforeAll(() => {
    OneUptimeApiService.initialize({ url: "https://test.oneuptime.com" });
  });

  beforeEach(() => {
    makeApiRequestSpy = jest
      .spyOn(
        OneUptimeApiService as unknown as {
          makeApiRequest: (...args: MakeApiRequestArgs) => Promise<unknown>;
        },
        "makeApiRequest",
      )
      .mockResolvedValue({}) as unknown as jest.SpyInstance;
  });

  afterEach(() => {
    makeApiRequestSpy.mockRestore();
  });

  async function deleteRole(args: Record<string, unknown>): Promise<unknown> {
    return OneUptimeApiService.executeOperation(
      "CustomRole",
      OneUptimeOperation.Delete,
      ModelType.Database,
      "/custom-role",
      { id: ROLE_ID, ...args },
      API_KEY,
    );
  }

  // What the one request sent: its route and its body.
  function sent(): { route: string; data: JSONObject | undefined } {
    expect(makeApiRequestSpy).toHaveBeenCalledTimes(1);

    const call: MakeApiRequestArgs = makeApiRequestSpy.mock
      .calls[0] as unknown as MakeApiRequestArgs;

    return { route: call[1].toString(), data: call[3] };
  }

  it("that says nothing sends no body, as it always did", async () => {
    await deleteRole({});

    expect(sent()).toEqual({
      route: `/api/custom-role/${ROLE_ID}/`,
      data: undefined,
    });
  });

  it.each([["Default"], ["default"]])(
    "with workflowsRunAs %p sends it as the API takes it",
    async (written: string) => {
      await deleteRole({ workflowsRunAs: written });

      expect(sent().data).toEqual({
        miscDataProps: { workflowsRunAs: "Default" },
      });
    },
  );

  it("with another custom role sends it and its ID", async () => {
    await deleteRole({
      workflowsRunAs: "CustomRole",
      workflowsRunAsCustomRoleId: OTHER_ROLE_ID,
    });

    expect(sent().data).toEqual({
      miscDataProps: {
        workflowsRunAs: "CustomRole",
        workflowsRunAsCustomRoleId: OTHER_ROLE_ID,
      },
    });
  });

  it.each([
    [
      { workflowsRunAs: "ProjectOwner" },
      'workflowsRunAs can\'t be "ProjectOwner": deleting a role never raises what a workflow can do. Choose "Default", or "CustomRole" with workflowsRunAsCustomRoleId.',
    ],
    [
      { workflowsRunAs: "Owner" },
      'workflowsRunAs takes "Default" or "CustomRole", and "Owner" is neither.',
    ],
    [
      { workflowsRunAs: "CustomRole" },
      'workflowsRunAs is "CustomRole", which needs workflowsRunAsCustomRoleId too. Add workflowsRunAsCustomRoleId, or set workflowsRunAs to "Default".',
    ],
    [
      { workflowsRunAsCustomRoleId: OTHER_ROLE_ID },
      'workflowsRunAsCustomRoleId goes with workflowsRunAs set to "CustomRole", and workflowsRunAs isn\'t given. Set workflowsRunAs to "CustomRole", or leave workflowsRunAsCustomRoleId out.',
    ],
    [
      { workflowsRunAs: "CustomRole", workflowsRunAsCustomRoleId: ROLE_ID },
      'workflowsRunAsCustomRoleId names the custom role being deleted. Name another custom role, or set workflowsRunAs to "Default".',
    ],
    [
      { workflowsRunAs: "CustomRole", workflowsRunAsCustomRoleId: "admins" },
      'workflowsRunAsCustomRoleId takes an ID, such as 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11, and "admins" is not one.',
    ],
  ])(
    "with %j is refused in the inputs' names before anything is sent",
    async (args: Record<string, unknown>, message: string) => {
      const refused: unknown = await deleteRole(args).catch(
        (error: unknown) => {
          return error;
        },
      );

      expect(refused).toBeInstanceOf(DeleteChoiceError);
      expect((refused as Error).message).toBe(message);
      expect(makeApiRequestSpy).not.toHaveBeenCalled();
    },
  );

  it("of a table whose delete takes no choices sends none, whatever it is given", async () => {
    await OneUptimeApiService.executeOperation(
      "Team",
      OneUptimeOperation.Delete,
      ModelType.Database,
      "/team",
      {
        id: OTHER_ROLE_ID,
        workflowsRunAs: "ProjectOwner",
      } as Record<string, unknown>,
      API_KEY,
    );

    expect(sent()).toEqual({
      route: `/api/team/${OTHER_ROLE_ID}/`,
      data: undefined,
    });
  });
});

describe("a delete tool's call, through the MCP server", () => {
  const tools: Array<McpToolInfo> = [...generateAllTools(), ROLE_DELETE_TOOL];

  let makeApiRequestSpy: jest.SpyInstance;
  let mcpServer: McpServer | undefined;
  let client: Client | undefined;

  beforeAll(() => {
    OneUptimeApiService.initialize({ url: "https://test.oneuptime.com" });
  });

  beforeEach(() => {
    makeApiRequestSpy = jest
      .spyOn(
        OneUptimeApiService as unknown as {
          makeApiRequest: (...args: MakeApiRequestArgs) => Promise<unknown>;
        },
        "makeApiRequest",
      )
      .mockResolvedValue({}) as unknown as jest.SpyInstance;
  });

  afterEach(async () => {
    makeApiRequestSpy.mockRestore();
    await client?.close();
    await mcpServer?.close();
    client = undefined;
    mcpServer = undefined;
  });

  async function call(
    args: Record<string, unknown>,
  ): Promise<{ isError: boolean; payload: JSONObject }> {
    const [clientTransport, serverTransport]: [
      InMemoryTransport,
      InMemoryTransport,
    ] = InMemoryTransport.createLinkedPair();

    mcpServer = createMCPServerInstance();
    registerToolHandlers(mcpServer, tools, API_KEY);
    await mcpServer.connect(serverTransport);

    client = new Client({ name: "delete-choices-test", version: "1.0.0" });
    await client.connect(clientTransport);

    const result: {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    } = (await client.callTool({
      name: "delete_custom_role",
      arguments: { id: ROLE_ID, ...args },
    })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };

    return {
      isError: result.isError === true,
      payload: JSON.parse(result.content[0]!.text) as JSONObject,
    };
  }

  it("refused for what the workflows run as: the API's words, naming them, and how to say it in the tool's inputs", async () => {
    makeApiRequestSpy.mockRejectedValue(
      new OneUptimeApiError(`API request failed: 400 - ${REFUSAL}`, 400, {
        message: REFUSAL,
      }),
    );

    const result: { isError: boolean; payload: JSONObject } = await call({});

    expect(result.isError).toBe(true);
    expect(result.payload).toEqual({
      success: false,
      tool: "delete_custom_role",
      error: `API request failed: 400 - ${REFUSAL}`,
      statusCode: 400,
      details: { message: REFUSAL },
      suggestion: CHOICES_SUGGESTION,
    });
    expect(REFUSAL).toContain(
      'The workflow "Close stale incidents" runs as the custom role "Incident Responder".',
    );
  });

  it("refused for something else once it said what they run as: the API's words, and the usual suggestion", async () => {
    const refusal: string = getCustomRoleDeleteWorkflowEditRefusedMessage({
      workflowName: "Close stale incidents",
    });

    makeApiRequestSpy.mockRejectedValue(
      new OneUptimeApiError(`API request failed: 403 - ${refusal}`, 403, {
        message: refusal,
      }),
    );

    const result: { isError: boolean; payload: JSONObject } = await call({
      workflowsRunAs: "Default",
    });

    expect(result.isError).toBe(true);
    expect(result.payload["error"]).toBe(
      `API request failed: 403 - ${refusal}`,
    );
    expect(result.payload["suggestion"]).toBe(
      "The API key lacks permission for this operation. Ask a Project Admin to grant the relevant permission to the key.",
    );
    expect(
      (makeApiRequestSpy.mock.calls[0] as unknown as MakeApiRequestArgs)[3],
    ).toEqual({ miscDataProps: { workflowsRunAs: "Default" } });
  });

  it("with Project Owner: refused before any request, saying why and what to do", async () => {
    const result: { isError: boolean; payload: JSONObject } = await call({
      workflowsRunAs: "ProjectOwner",
    });

    expect(result.isError).toBe(true);
    expect(result.payload).toEqual({
      success: false,
      tool: "delete_custom_role",
      error:
        'workflowsRunAs can\'t be "ProjectOwner": deleting a role never raises what a workflow can do. Choose "Default", or "CustomRole" with workflowsRunAsCustomRoleId.',
      suggestion: FIX_SUGGESTION,
    });
    expect(makeApiRequestSpy).not.toHaveBeenCalled();
  });

  it("that says what they run as deletes the role", async () => {
    const result: { isError: boolean; payload: JSONObject } = await call({
      workflowsRunAs: "CustomRole",
      workflowsRunAsCustomRoleId: OTHER_ROLE_ID,
    });

    expect(result.isError).toBe(false);
    expect(result.payload).toEqual({
      success: true,
      operation: "delete",
      resourceType: "Custom Role",
      resourceId: ROLE_ID,
      message: `Successfully deleted Custom Role (ID: ${ROLE_ID})`,
    });
  });
});

describe("the suggestion for a refused delete", () => {
  const refused: OneUptimeApiError = new OneUptimeApiError(
    `API request failed: 400 - ${REFUSAL}`,
    400,
  );

  it("is the tool's own words for a delete that took and needed choices", () => {
    expect(
      getDeleteChoicesSuggestion({
        tool: ROLE_DELETE_TOOL,
        args: { id: ROLE_ID },
        error: refused,
      }),
    ).toBe(CHOICES_SUGGESTION);
  });

  it("is none for any other tool, any other error, or a delete that gave a choice", () => {
    const team: McpToolInfo = createDeleteTool(
      "Team",
      "Team",
      "Teams",
      "/team",
    );
    const list: McpToolInfo | undefined = generateAllTools().find(
      (tool: McpToolInfo): boolean => {
        return tool.name === "list_incidents";
      },
    );

    for (const tool of [team, list, undefined]) {
      expect(
        getDeleteChoicesSuggestion({ tool, args: {}, error: refused }),
      ).toBeUndefined();
    }

    expect(
      getDeleteChoicesSuggestion({
        tool: ROLE_DELETE_TOOL,
        args: { id: ROLE_ID },
        error: new OneUptimeApiError(
          "API request failed: 404 - Custom Role not found.",
          404,
        ),
      }),
    ).toBeUndefined();
    expect(
      getDeleteChoicesSuggestion({
        tool: ROLE_DELETE_TOOL,
        args: { id: ROLE_ID, workflowsRunAs: "Default" },
        error: refused,
      }),
    ).toBeUndefined();
  });
});
