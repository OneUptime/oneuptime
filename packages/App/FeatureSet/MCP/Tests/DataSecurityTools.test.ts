import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  DATA_SECURITY_TOOL_DEFINITIONS,
  DataSecurityToolDefinition,
  handleDataSecurityTool,
  isDataSecurityTool,
  isDeletingCall,
} from "../Tools/DataSecurityTools";
import {
  generateWorkflowTools,
  handleWorkflowTool,
  isWorkflowTool,
} from "../Tools/WorkflowTools";
import * as ToolGenerator from "../Tools/ToolGenerator";
import { applyWritePolicy, generateAllTools } from "../Tools/ToolGenerator";
import { getAsksAPersonSuggestion } from "../Handlers/ToolHandler";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import McpCredentialUtil, { McpCredential } from "../Types/McpCredential";
import { JSONSchema, McpToolInfo } from "../Types/McpTypes";
import AIToolbox from "Common/Server/Utils/AI/Toolbox/Index";
import { ObservabilityTool } from "Common/Server/Utils/AI/Toolbox/ToolTypes";
import { getAsksInEveryModeRefusal } from "Common/Server/Utils/AI/Toolbox/DataSecurityActionRunner";
import {
  ASKS_IN_EVERY_MODE_REFUSAL_PREFIX,
  ASKS_IN_EVERY_MODE_SUGGESTION,
  DATA_SECURITY_ACTION_READ_TOOL_NAMES,
  DATA_SECURITY_ACTION_RUN_ROUTE,
  DATA_SECURITY_ACTION_TOOL_NAMES,
  DATA_SECURITY_ACTIONS_RUN_OUTSIDE_CHAT,
  getDataSecurityActionApiKeyRefusal,
} from "Common/Types/AI/AIDataSecurityActions";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";

jest.mock("../Utils/MCPLogger");

/*
 * DATA SECURITY'S ACTIONS ON THE MCP SERVER (#10378, #10889).
 *
 *   - Listed beside the workflow tools: the eight actions Ask AI has, and
 *     the two reads - a rule's draft and OneUptime AI's proposals.
 *   - MCP_READ_ONLY leaves only the two reads; MCP_ALLOW_DESTRUCTIVE=false
 *     keeps every tool, and refuses only the call that deletes: removing a
 *     store's owners.
 *   - Each call is Ask AI's own action, run by the API as the person who
 *     signed in: a project API key may read, never change.
 *   - What Ask AI asks a person about in every mode is refused by the API,
 *     and the agent is told why, where to do it, and not to retry.
 *   - Their arguments are Ask AI's, property for property.
 */

type ApiCallSpy = jest.SpyInstance;

const STORE_ID: string = "10378000-0000-4000-8000-0000000000b1";

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

const SIGNED_IN: McpCredential = oauthCredential([
  McpOAuthScope.Read,
  McpOAuthScope.Write,
]);

function spyOnApi(answer: unknown): ApiCallSpy {
  return jest
    .spyOn(OneUptimeApiService, "makeAuthenticatedApiCall")
    .mockResolvedValue(answer as never) as unknown as ApiCallSpy;
}

function withWritePolicy(policy: {
  readOnly: boolean;
  allowDestructive: boolean;
}): void {
  jest.spyOn(ToolGenerator, "getServerWritePolicy").mockReturnValue(policy);
}

afterEach(() => {
  jest.restoreAllMocks();
});

const WRITES: Array<string> = [...DATA_SECURITY_ACTION_TOOL_NAMES];
const READS: Array<string> = [...DATA_SECURITY_ACTION_READ_TOOL_NAMES];

describe("the Data Security tools are listed", () => {
  const tools: Array<McpToolInfo> = generateAllTools();

  function listed(name: string): McpToolInfo {
    return tools.find((tool: McpToolInfo): boolean => {
      return tool.name === name;
    }) as McpToolInfo;
  }

  it("are the eight actions and the two reads the API runs outside the chat, each once", () => {
    const names: Array<string> = DATA_SECURITY_TOOL_DEFINITIONS.map(
      (definition: DataSecurityToolDefinition): string => {
        return definition.name;
      },
    );

    expect(WRITES).toHaveLength(8);
    expect([...READS].sort()).toEqual([
      "draft_data_security_rule",
      "query_data_security_proposals",
    ]);
    expect([...names].sort()).toEqual(
      [...DATA_SECURITY_ACTIONS_RUN_OUTSIDE_CHAT].sort(),
    );
    expect(new Set(names).size).toBe(names.length);

    for (const name of names) {
      expect({ name, listed: Boolean(listed(name)) }).toEqual({
        name,
        listed: true,
      });
      expect(isDataSecurityTool(name)).toBe(true);
      expect(isWorkflowTool(name)).toBe(true);
    }
  });

  it("the two reads are read-only, and every action is not", () => {
    for (const definition of DATA_SECURITY_TOOL_DEFINITIONS) {
      expect({
        name: definition.name,
        readOnly: definition.readOnly,
      }).toEqual({
        name: definition.name,
        readOnly: READS.includes(definition.name),
      });
    }
  });

  it("a response through a store's cloud and a pull request reach outside the project: open-world", () => {
    for (const definition of DATA_SECURITY_TOOL_DEFINITIONS) {
      expect({
        name: definition.name,
        reachesOutside: Boolean(definition.reachesOutside),
      }).toEqual({
        name: definition.name,
        reachesOutside:
          definition.name === "respond_on_data_store" ||
          definition.name === "fix_data_security_issue_with_ai",
      });
    }
  });

  it("each action says it acts as the person signed in", () => {
    for (const definition of DATA_SECURITY_TOOL_DEFINITIONS) {
      if (definition.readOnly) {
        continue;
      }

      expect(definition.description).toContain(
        "Acts as the person signed in (OAuth), with their permissions; an API key cannot.",
      );
    }
  });

  it("the actions Ask AI always asks about say they are refused here, and where to do them instead", () => {
    for (const name of [
      "respond_on_data_store",
      "set_data_store_owners",
      "save_data_security_rule",
      "decide_data_security_proposal",
    ]) {
      expect(
        DATA_SECURITY_TOOL_DEFINITIONS.find(
          (definition: DataSecurityToolDefinition): boolean => {
            return definition.name === name;
          },
        )!.description,
      ).toContain("it is refused here, with the page in OneUptime where they do it");
    }
  });

  it("MCP_READ_ONLY leaves the two reads, and takes the eight actions away", () => {
    const kept: Array<string> = applyWritePolicy(generateWorkflowTools(), {
      readOnly: true,
      allowDestructive: true,
    }).map((tool: McpToolInfo): string => {
      return tool.name;
    });

    for (const name of READS) {
      expect(kept).toContain(name);
    }

    for (const name of WRITES) {
      expect(kept).not.toContain(name);
    }
  });

  it("MCP_ALLOW_DESTRUCTIVE=false keeps them all: only a call that removes owners deletes", () => {
    const kept: Array<string> = applyWritePolicy(generateWorkflowTools(), {
      readOnly: false,
      allowDestructive: false,
    }).map((tool: McpToolInfo): string => {
      return tool.name;
    });

    for (const name of [...WRITES, ...READS]) {
      expect(kept).toContain(name);
    }

    expect(
      isDeletingCall("set_data_store_owners", {
        dataStoreId: STORE_ID,
        remove: ["Jane Doe"],
      }),
    ).toBe(true);
    expect(
      isDeletingCall("set_data_store_owners", {
        dataStoreId: STORE_ID,
        add: ["Jane Doe"],
        remove: [],
      }),
    ).toBe(false);
    expect(
      isDeletingCall("change_data_security_issue", { remove: ["x"] }),
    ).toBe(false);
  });
});

describe("a call runs Ask AI's own action through the API, as the person", () => {
  it("sends the action and its arguments as given, and answers with what changed, what stopped working and what it cost", async () => {
    const api: ApiCallSpy = spyOnApi({
      action: "fix_data_security_issue_with_ai",
      title: 'Ask OneUptime AI to fix "Anyone on the internet can read it" in code',
      details: [],
      changes: [
        "OneUptime AI writes the smallest change that fixes it and opens a pull request in \"infra\".",
      ],
      stopsWorking: [],
      costs: [
        "It uses OneUptime AI: it counts toward the project's AI credits and daily limits.",
      ],
      message: "Started: OneUptime AI is writing the pull request.",
      record: {
        type: "DataSecurityIssue",
        params: { dataSecurityIssueId: "i-1" },
      },
    });

    const answer: JSONObject = await handleDataSecurityTool(
      "fix_data_security_issue_with_ai",
      { dataSecurityIssueId: "i-1" },
      SIGNED_IN,
    );

    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toEqual({
      method: "POST",
      path: `/api${DATA_SECURITY_ACTION_RUN_ROUTE}`,
      body: {
        action: "fix_data_security_issue_with_ai",
        arguments: { dataSecurityIssueId: "i-1" },
      },
      credential: SIGNED_IN,
    });
    expect(DATA_SECURITY_ACTION_RUN_ROUTE).toBe("/data-security-actions/run");

    expect(answer).toEqual({
      success: true,
      operation: "fix_data_security_issue_with_ai",
      done: 'Ask OneUptime AI to fix "Anyone on the internet can read it" in code',
      details: [],
      changes: [
        "OneUptime AI writes the smallest change that fixes it and opens a pull request in \"infra\".",
      ],
      stopsWorking: [],
      costs: [
        "It uses OneUptime AI: it counts toward the project's AI credits and daily limits.",
      ],
      message: "Started: OneUptime AI is writing the pull request.",
      record: {
        type: "DataSecurityIssue",
        params: { dataSecurityIssueId: "i-1" },
      },
    });
  });

  it("is reached through the workflow tools' handler", async () => {
    const api: ApiCallSpy = spyOnApi({
      action: "change_data_security_issue",
      details: [],
      message: 'Done: reopen on the issue "Versioning is off".',
    });

    const answer: JSONObject = await handleWorkflowTool(
      "change_data_security_issue",
      { dataSecurityIssueId: "i-2", change: "reopen" },
      SIGNED_IN,
    );

    expect((api.mock.calls[0]![0] as { body: JSONObject }).body).toEqual({
      action: "change_data_security_issue",
      arguments: { dataSecurityIssueId: "i-2", change: "reopen" },
    });
    expect(answer["message"]).toBe(
      'Done: reopen on the issue "Versioning is off".',
    );
    expect(answer["done"]).toBeUndefined();
    expect(answer["changes"]).toEqual([]);
  });

  it("an answer that is not an object is read as nothing said, never as a success it did not report", async () => {
    spyOnApi("unexpected");

    const answer: JSONObject = await handleDataSecurityTool(
      "query_data_security_proposals",
      {},
      SIGNED_IN,
    );

    expect(answer).toEqual({
      success: true,
      operation: "query_data_security_proposals",
      details: [],
      changes: [],
      stopsWorking: [],
      costs: [],
      message: "Done.",
    });
  });

  it("what Ask AI asks a person about in every mode is refused by the API: the agent is told why, where, and not to retry", async () => {
    const refusal: string = getAsksInEveryModeRefusal({
      action: "respond_on_data_store",
      reason:
        "Asks first in every mode: it changes the store in its cloud, and what reads it may stop working.",
      pageUrl: "https://oneuptime.example/dashboard/p/data-security/stores/s",
    });

    jest
      .spyOn(OneUptimeApiService, "makeAuthenticatedApiCall")
      .mockRejectedValue(new Error(refusal) as never);

    const error: Error = await handleDataSecurityTool(
      "respond_on_data_store",
      { dataStoreId: STORE_ID, action: "Block public access" },
      SIGNED_IN,
    ).then(
      () => {
        throw new Error("It ran.");
      },
      (thrown: Error) => {
        return thrown;
      },
    );

    expect(error.message).toBe(refusal);
    expect(refusal.startsWith(ASKS_IN_EVERY_MODE_REFUSAL_PREFIX)).toBe(true);
    expect(refusal).toContain(
      "https://oneuptime.example/dashboard/p/data-security/stores/s",
    );
    expect(refusal).toContain("is not run here");
    expect(getAsksAPersonSuggestion(error)).toBe(ASKS_IN_EVERY_MODE_SUGGESTION);
    // Any other error is not told so.
    expect(
      getAsksAPersonSuggestion(new Error("Data store not found.")),
    ).toBeUndefined();
  });

  it("removing a store's owners is refused before any request where deletes are off, and named by its switch", async () => {
    withWritePolicy({ readOnly: false, allowDestructive: false });
    const api: ApiCallSpy = spyOnApi({});

    await expect(
      handleDataSecurityTool(
        "set_data_store_owners",
        { dataStoreId: STORE_ID, remove: ["Jane Doe"] },
        SIGNED_IN,
      ),
    ).rejects.toThrow("MCP_ALLOW_DESTRUCTIVE");
    expect(api).not.toHaveBeenCalled();

    // Adding one deletes nothing: it goes to the API, which asks a person.
    await handleDataSecurityTool(
      "set_data_store_owners",
      { dataStoreId: STORE_ID, add: ["Jane Doe"] },
      SIGNED_IN,
    );
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe("a project API key", () => {
  it.each(WRITES)(
    "is refused %s before any request, with what to do instead",
    async (name: string) => {
      const api: ApiCallSpy = spyOnApi({});

      await expect(
        handleDataSecurityTool(name, {}, "a-project-api-key"),
      ).rejects.toThrow(getDataSecurityActionApiKeyRefusal(name));
      expect(api).not.toHaveBeenCalled();
      expect(getDataSecurityActionApiKeyRefusal(name)).toContain(
        "signing in to OneUptime (OAuth)",
      );
    },
  );

  it.each(READS)("may still use %s, which changes nothing", async (name: string) => {
    const api: ApiCallSpy = spyOnApi({ details: [], message: "Read." });

    const answer: JSONObject = await handleDataSecurityTool(
      name,
      {},
      "a-project-api-key",
    );

    expect(api).toHaveBeenCalledTimes(1);
    expect(answer["message"]).toBe("Read.");
  });
});

describe("their arguments are Ask AI's", () => {
  function propertiesOf(
    schema: JSONSchema | JSONObject,
  ): Record<string, JSONObject> {
    return ((schema as JSONObject)["properties"] || {}) as Record<
      string,
      JSONObject
    >;
  }

  function shapeOf(property: JSONObject): JSONObject {
    const items: JSONObject | undefined = property["items"] as
      | JSONObject
      | undefined;

    return {
      type: property["type"] || null,
      enum: property["enum"] ? [...(property["enum"] as Array<string>)] : null,
      items: items
        ? {
            type: items["type"] || null,
            enum: items["enum"]
              ? [...(items["enum"] as Array<string>)]
              : null,
          }
        : null,
    };
  }

  it.each(DATA_SECURITY_TOOL_DEFINITIONS.map((d: DataSecurityToolDefinition) => d.name))(
    "%s takes exactly what Ask AI's tool takes, and requires the same",
    (name: string) => {
      const definition: DataSecurityToolDefinition =
        DATA_SECURITY_TOOL_DEFINITIONS.find(
          (candidate: DataSecurityToolDefinition): boolean => {
            return candidate.name === name;
          },
        )!;
      const tool: ObservabilityTool | undefined =
        AIToolbox.getToolByName(name);

      expect(tool).toBeDefined();
      // An action and a read alike, as Ask AI's.
      expect(Boolean(tool!.isMutation)).toBe(!definition.readOnly);

      const ours: Record<string, JSONObject> = propertiesOf(
        definition.inputSchema,
      );
      const askAi: Record<string, JSONObject> = propertiesOf(
        tool!.inputSchema as unknown as JSONObject,
      );

      expect(Object.keys(ours).sort()).toEqual(Object.keys(askAi).sort());

      for (const key of Object.keys(askAi)) {
        expect({ key, ...shapeOf(ours[key]!) }).toEqual({
          key,
          ...shapeOf(askAi[key]!),
        });
      }

      expect(
        [
          ...(((definition.inputSchema as JSONObject)["required"] as
            | Array<string>
            | undefined) || []),
        ].sort(),
      ).toEqual(
        [
          ...(((tool!.inputSchema as unknown as JSONObject)["required"] as
            | Array<string>
            | undefined) || []),
        ].sort(),
      );
      // Nothing else: what the prepare works out is never the agent's to pass.
      expect((definition.inputSchema as JSONObject)["additionalProperties"]).toBe(
        false,
      );
    },
  );
});
