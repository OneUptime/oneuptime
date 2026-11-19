/**
 * Ask AI's setup actions as MCP tools (#7241).
 *
 *   - Five tools: set_up_website_monitoring, set_up_paging,
 *     publish_status_page, add_monitors_to_status_page and who_is_told.
 *     The four that make something are writes - not read-only,
 *     destructive, and open-world when they publish a status page - and
 *     the read is read-only. A read-only sign-in may not call the writes,
 *     and MCP_READ_ONLY leaves only the read.
 *   - Each call goes to the API's POST /api/setup-actions/run, as the
 *     credential's person, with the arguments as given: nothing is built
 *     here (Common's SetupActionRunner runs Ask AI's own tool).
 *   - A project API key is refused the writes before any request, in words
 *     that say what to do instead; it may still read who is told.
 *   - Their arguments are Ask AI's: every property is one Ask AI's tool
 *     takes, of its type and among its choices, and both require the same.
 */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  SETUP_TOOL_DEFINITIONS,
  SetupToolDefinition,
  getApiKeyRefusal,
  handleSetupTool,
  isSetupTool,
} from "../Tools/SetupTools";
import {
  generateWorkflowTools,
  handleWorkflowTool,
  isReadOnlyWorkflowTool,
  isWorkflowTool,
} from "../Tools/WorkflowTools";
import { applyWritePolicy, generateAllTools } from "../Tools/ToolGenerator";
import RequestGate, { McpToolAccess } from "../OAuth/RequestGate";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import McpCredentialUtil, { McpCredential } from "../Types/McpCredential";
import { JSONSchema, McpToolInfo } from "../Types/McpTypes";
import AIToolbox from "Common/Server/Utils/AI/Toolbox/Index";
import { ObservabilityTool } from "Common/Server/Utils/AI/Toolbox/ToolTypes";
import { SETUP_ACTIONS_RUN_OUTSIDE_CHAT } from "Common/Types/AI/AISetupActions";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";

jest.mock("../Utils/MCPLogger");

// Bare SpyInstance keeps the annotation compatible across @types/jest versions.
type ApiCallSpy = jest.SpyInstance;

const WRITES: Array<string> = [
  "set_up_website_monitoring",
  "set_up_paging",
  "publish_status_page",
  "add_monitors_to_status_page",
];

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
    .mockResolvedValue(answer as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the setup tools are listed", () => {
  const tools: Array<McpToolInfo> = generateAllTools();

  function listed(name: string): McpToolInfo {
    return tools.find((tool: McpToolInfo): boolean => {
      return tool.name === name;
    }) as McpToolInfo;
  }

  it("are the setup actions the API runs outside the chat, each once", () => {
    expect(
      SETUP_TOOL_DEFINITIONS.map((definition: SetupToolDefinition) => {
        return definition.name;
      }),
    ).toEqual([...SETUP_ACTIONS_RUN_OUTSIDE_CHAT]);

    for (const name of SETUP_ACTIONS_RUN_OUTSIDE_CHAT) {
      expect([name, Boolean(listed(name))]).toEqual([name, true]);
      expect(isSetupTool(name)).toBe(true);
      expect(isWorkflowTool(name)).toBe(true);
    }

    expect(isSetupTool("create_monitor")).toBe(false);
  });

  it.each(WRITES)(
    "%s makes something: not read-only, destructive, and asked for by a write",
    (name: string) => {
      const tool: McpToolInfo = listed(name);

      expect(tool.annotations?.readOnlyHint).toBe(false);
      expect(tool.annotations?.destructiveHint).toBe(true);
      expect(isReadOnlyWorkflowTool(name)).toBe(false);
      expect(RequestGate.getToolAccess(name, tools)).toBe(McpToolAccess.Write);
      // Each says who it acts as: there is no approval card.
      expect(tool.description).toContain("signed in (OAuth)");
    },
  );

  it("who_is_told only reads: read-only, not destructive, and a read", () => {
    const tool: McpToolInfo = listed("who_is_told");

    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.destructiveHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(false);
    expect(RequestGate.getToolAccess("who_is_told", tools)).toBe(
      McpToolAccess.Read,
    );
  });

  it("a status page is published by the two that put monitors on one: open-world", () => {
    expect(listed("publish_status_page").annotations?.openWorldHint).toBe(true);
    expect(
      listed("add_monitors_to_status_page").annotations?.openWorldHint,
    ).toBe(true);
    expect(listed("set_up_website_monitoring").annotations?.openWorldHint).toBe(
      false,
    );
    expect(listed("set_up_paging").annotations?.openWorldHint).toBe(false);
  });

  it("each says what it makes, in its description", () => {
    expect(listed("set_up_website_monitoring").description).toContain(
      "opens an incident when the address does not answer",
    );
    expect(listed("set_up_paging").description).toContain(
      '"Default on-call policy"',
    );
    expect(listed("publish_status_page").description).toContain(
      "It is public as soon as it is created",
    );
    expect(listed("add_monitors_to_status_page").description).toContain(
      "shown on the public page",
    );
  });

  it("MCP_READ_ONLY leaves the read, and takes the four writes away", () => {
    const kept: Array<string> = applyWritePolicy(generateWorkflowTools(), {
      readOnly: true,
      allowDestructive: true,
    }).map((tool: McpToolInfo): string => {
      return tool.name;
    });

    expect(kept).toContain("who_is_told");

    for (const name of WRITES) {
      expect(kept).not.toContain(name);
    }
  });

  it("MCP_ALLOW_DESTRUCTIVE=false keeps them all: none deletes anything", () => {
    const kept: Array<string> = applyWritePolicy(generateWorkflowTools(), {
      readOnly: false,
      allowDestructive: false,
    }).map((tool: McpToolInfo): string => {
      return tool.name;
    });

    for (const name of SETUP_ACTIONS_RUN_OUTSIDE_CHAT) {
      expect(kept).toContain(name);
    }
  });
});

describe("a call runs Ask AI's own action through the API, as the person", () => {
  it("sends the action and its arguments as given, and answers with what was made", async () => {
    const api: ApiCallSpy = spyOnApi({
      action: "set_up_website_monitoring",
      title: "Set up monitoring for example.com",
      details: [
        "A website monitor checks https://example.com every minute.",
        "You own this monitor, so you are emailed when its status changes.",
      ],
      message: 'Created the Website monitor "example.com".',
      record: { type: "MonitorView", params: { monitorId: "m-1" } },
    });

    const answer: JSONObject = await handleSetupTool(
      "set_up_website_monitoring",
      { address: "example.com", checkEveryMinutes: 1 },
      SIGNED_IN,
    );

    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toEqual({
      method: "POST",
      path: "/api/setup-actions/run",
      body: {
        action: "set_up_website_monitoring",
        arguments: { address: "example.com", checkEveryMinutes: 1 },
      },
      credential: SIGNED_IN,
    });

    expect(answer).toEqual({
      success: true,
      operation: "set_up_website_monitoring",
      made: "Set up monitoring for example.com",
      details: [
        "A website monitor checks https://example.com every minute.",
        "You own this monitor, so you are emailed when its status changes.",
      ],
      message: 'Created the Website monitor "example.com".',
      record: { type: "MonitorView", params: { monitorId: "m-1" } },
    });
  });

  it("is reached through the workflow tools' handler", async () => {
    const api: ApiCallSpy = spyOnApi({
      action: "publish_status_page",
      details: [],
      message: 'Published "Acme Status".',
    });

    const answer: JSONObject = await handleWorkflowTool(
      "publish_status_page",
      { monitors: ["example.com"] },
      SIGNED_IN,
    );

    expect((api.mock.calls[0]![0] as { body: JSONObject }).body["action"]).toBe(
      "publish_status_page",
    );
    expect(answer["message"]).toBe('Published "Acme Status".');
    expect(answer["details"]).toEqual([]);
    expect(answer["made"]).toBeUndefined();
  });

  it("a refusal from the API is the tool's error, word for word", async () => {
    jest
      .spyOn(OneUptimeApiService, "makeAuthenticatedApiCall")
      .mockRejectedValue(
        new Error(
          "Nothing was set up: this project already pages people.",
        ) as never,
      );

    await expect(
      handleSetupTool("set_up_paging", {}, SIGNED_IN),
    ).rejects.toThrow("this project already pages people");
  });
});

describe("a project API key", () => {
  it.each(WRITES)(
    "is refused %s before any request, with what to do instead",
    async (name: string) => {
      const api: ApiCallSpy = spyOnApi({});

      await expect(
        handleSetupTool(name, {}, "a-project-api-key"),
      ).rejects.toThrow(getApiKeyRefusal(name));
      expect(api).not.toHaveBeenCalled();
      expect(getApiKeyRefusal(name)).toContain("signing in to OneUptime");
    },
  );

  it("may still read who is told", async () => {
    const api: ApiCallSpy = spyOnApi({
      action: "who_is_told",
      details: [],
      message: "example.com pages the Default on-call policy.",
    });

    const answer: JSONObject = await handleSetupTool(
      "who_is_told",
      { monitor: "example.com" },
      "a-project-api-key",
    );

    expect(api).toHaveBeenCalledTimes(1);
    expect(answer["message"]).toBe(
      "example.com pages the Default on-call policy.",
    );
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
            enum: items["enum"] ? [...(items["enum"] as Array<string>)] : null,
          }
        : null,
    };
  }

  it.each(
    SETUP_TOOL_DEFINITIONS.map((definition: SetupToolDefinition) => {
      return [definition.name, definition];
    }),
  )(
    "%s takes what Ask AI's tool takes, of the same types, and requires the same",
    (_name: unknown, definition: unknown) => {
      const mcp: SetupToolDefinition = definition as SetupToolDefinition;
      const askAi: ObservabilityTool | undefined = AIToolbox.getToolByName(
        mcp.name,
      );

      expect(askAi).toBeDefined();
      expect(Boolean(askAi!.isMutation)).toBe(!mcp.readOnly);

      const askAiProperties: Record<string, JSONObject> = propertiesOf(
        askAi!.inputSchema,
      );

      for (const [key, property] of Object.entries(
        propertiesOf(mcp.inputSchema),
      )) {
        expect([key, Boolean(askAiProperties[key])]).toEqual([key, true]);
        expect([key, shapeOf(property)]).toEqual([
          key,
          shapeOf(askAiProperties[key]!),
        ]);
      }

      // Nothing Ask AI's tool takes is left out of the agent's.
      expect(Object.keys(propertiesOf(mcp.inputSchema)).sort()).toEqual(
        Object.keys(askAiProperties).sort(),
      );

      expect(
        [
          ...(((mcp.inputSchema as unknown as JSONObject)[
            "required"
          ] as Array<string>) || []),
        ].sort(),
      ).toEqual(
        [...((askAi!.inputSchema["required"] as Array<string>) || [])].sort(),
      );
    },
  );
});
