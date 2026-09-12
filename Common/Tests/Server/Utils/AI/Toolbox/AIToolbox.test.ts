import { describe, expect, jest, test } from "@jest/globals";
import AIChatPermissionMode from "../../../../../Types/AI/AIChatPermissionMode";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";

/*
 * The toolbox is the authorization gate for everything the AI can do with a
 * customer's project - read their logs, page their on-call, open a pull
 * request against their code. Individual tools have their own suites; what
 * had none was the gate itself.
 *
 * The interesting cases are all refusals: a mutating tool must not even be
 * OFFERED to the model in ReadOnly mode (a model cannot propose a tool it
 * was never shown), a blocked permission must deny outright rather than be
 * outvoted by an allowed one, and a tool that throws must come back as an
 * error the model can correct from rather than as an exception that ends the
 * conversation.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);

/*
 * A stand-in for one real read tool. Index.ts imports ContextTools at module
 * load, so replacing the module is the only way to drive the execute path
 * without a database behind it - and it keeps the rest of the belt real, so
 * the contract assertions below still cover every shipped tool.
 */
let lookupBehaviour: () => Promise<JSONObject> =
  async (): Promise<JSONObject> => {
    return {};
  };

jest.mock("../../../../../Server/Utils/AI/Toolbox/ContextTools", () => {
  return {
    __esModule: true,
    LookupContextTool: {
      name: "lookup_context",
      description: "Test double for the context lookup tool.",
      inputSchema: {
        type: "object",
        properties: { type: { type: "string" } },
        required: ["type"],
      },
      requiredPermissions: [Permission.ProjectOwner, Permission.ProjectMember],
      execute: async (): Promise<JSONObject> => {
        return lookupBehaviour();
      },
    },
  };
});

import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  ObservabilityTool,
  ToolContext,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { LLMToolDefinition } from "../../../../../Server/Utils/LLM/LLMService";

function contextFor(data: {
  allow?: Array<Permission>;
  block?: Array<Permission>;
  isRoot?: boolean;
  isMasterAdmin?: boolean;
}): ToolContext {
  const props: DatabaseCommonInteractionProps = {
    isRoot: data.isRoot,
    isMasterAdmin: data.isMasterAdmin,
    tenantId: projectId,
    userId: new ObjectID("22222222-2222-2222-2222-222222222222"),
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public],
      projectIds: [projectId],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: [
          ...(data.allow || []).map((permission: Permission) => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission" as const,
            };
          }),
          ...(data.block || []).map((permission: Permission) => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: true,
              _type: "UserPermission" as const,
            };
          }),
        ],
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;

  return { projectId: projectId, props: props };
}

const tools: Array<ObservabilityTool> = AIToolbox.getTools();

describe("AIToolbox contract", () => {
  test("ships tools", () => {
    expect(tools.length).toBeGreaterThan(20);
  });

  /*
   * Two tools with the same name means getToolByName resolves the model's
   * call to whichever was registered first - silently running one tool while
   * the model believes it called the other.
   */
  test("gives every tool a unique name", () => {
    const names: Array<string> = tools.map(
      (tool: ObservabilityTool): string => {
        return tool.name;
      },
    );

    expect(new Set(names).size).toBe(names.length);
  });

  test.each(
    tools.map((tool: ObservabilityTool): [string, ObservabilityTool] => {
      return [tool.name, tool];
    }),
  )(
    "%s is a name the model providers accept",
    (_name: string, tool: ObservabilityTool) => {
      expect(tool.name).toMatch(/^[a-z0-9_]{1,64}$/);
    },
  );

  test.each(
    tools.map((tool: ObservabilityTool): [string, ObservabilityTool] => {
      return [tool.name, tool];
    }),
  )(
    "%s describes itself and its arguments",
    (_name: string, tool: ObservabilityTool) => {
      expect(tool.description.trim().length).toBeGreaterThan(20);
      expect(tool.inputSchema["type"]).toBe("object");
      expect(typeof tool.inputSchema["properties"]).toBe("object");
    },
  );

  /*
   * An empty list would make hasPermissionForTool's intersection vacuously
   * false-then-true in the wrong direction: no required permission means no
   * blocked permission can ever match it, so the block check could not
   * refuse the tool at all.
   */
  test.each(
    tools.map((tool: ObservabilityTool): [string, ObservabilityTool] => {
      return [tool.name, tool];
    }),
  )(
    "%s requires at least one permission",
    (_name: string, tool: ObservabilityTool) => {
      expect(tool.requiredPermissions.length).toBeGreaterThan(0);
    },
  );

  test("marks every write tool as a mutation", () => {
    const mutationNames: Array<string> = tools
      .filter((tool: ObservabilityTool): boolean => {
        return Boolean(tool.isMutation);
      })
      .map((tool: ObservabilityTool): string => {
        return tool.name;
      });

    /*
     * Named rather than pattern-matched: a tool that mutates a customer's
     * project and is not on this list runs unapproved in AskForApproval mode
     * and is offered to the model in ReadOnly mode, so adding one has to be
     * a deliberate edit here too.
     */
    expect(mutationNames.sort()).toEqual(
      [
        "acknowledge_alert",
        "acknowledge_incident",
        "change_incident_severity",
        "commit_code_to_branch",
        "create_alert_note",
        "create_incident",
        "create_incident_note",
        "open_code_pull_request",
        "page_on_call_policy",
        "post_incident_status_update",
        "resolve_alert",
        "resolve_incident",
        "run_runbook",
        "start_investigation",
      ].sort(),
    );
  });

  test("agrees with itself about which tools mutate", () => {
    for (const tool of tools) {
      expect(AIToolbox.isMutationTool(tool.name)).toBe(
        Boolean(tool.isMutation),
      );
    }
  });

  test("treats an unknown tool as not a mutation and not found", () => {
    expect(AIToolbox.isMutationTool("drop_everything")).toBe(false);
    expect(AIToolbox.getToolByName("drop_everything")).toBeUndefined();
  });
});

describe("AIToolbox.getLlmToolDefinitions", () => {
  /*
   * ReadOnly is asked for FIRST on purpose. The definitions are cached per
   * mode, and a cache keyed carelessly would serve this filtered list back
   * to AutoRun - quietly disabling every action the product has.
   */
  test("withholds mutating tools in ReadOnly mode", () => {
    const names: Array<string> = AIToolbox.getLlmToolDefinitions(
      AIChatPermissionMode.ReadOnly,
    ).map((definition: LLMToolDefinition): string => {
      return definition.name;
    });

    expect(names).not.toContain("create_incident");
    expect(names).not.toContain("page_on_call_policy");
    expect(names).not.toContain("commit_code_to_branch");
    expect(names).toContain("query_incidents");
  });

  test.each([
    AIChatPermissionMode.AskForApproval,
    AIChatPermissionMode.AutoRun,
  ])("offers mutating tools in %s mode", (mode: AIChatPermissionMode) => {
    const names: Array<string> = AIToolbox.getLlmToolDefinitions(mode).map(
      (definition: LLMToolDefinition): string => {
        return definition.name;
      },
    );

    expect(names).toContain("create_incident");
    expect(names).toContain("page_on_call_policy");
  });

  test("the ReadOnly list is exactly the belt minus its mutations", () => {
    const readOnlyCount: number = AIToolbox.getLlmToolDefinitions(
      AIChatPermissionMode.ReadOnly,
    ).length;
    const mutationCount: number = tools.filter(
      (tool: ObservabilityTool): boolean => {
        return Boolean(tool.isMutation);
      },
    ).length;

    expect(readOnlyCount).toBe(tools.length - mutationCount);
  });

  test("hands the model the same schema the tool declares", () => {
    const definition: LLMToolDefinition | undefined =
      AIToolbox.getLlmToolDefinitions(AIChatPermissionMode.AutoRun).find(
        (candidate: LLMToolDefinition): boolean => {
          return candidate.name === "lookup_context";
        },
      );

    expect(definition?.inputSchema).toEqual(
      AIToolbox.getToolByName("lookup_context")?.inputSchema,
    );
  });

  test("returns the same list on a second call", () => {
    expect(
      AIToolbox.getLlmToolDefinitions(AIChatPermissionMode.ReadOnly),
    ).toEqual(AIToolbox.getLlmToolDefinitions(AIChatPermissionMode.ReadOnly));
  });
});

describe("AIToolbox.hasPermissionForTool", () => {
  const tool: ObservabilityTool = AIToolbox.getToolByName("lookup_context")!;

  test("allows a user holding one of the required permissions", () => {
    expect(
      AIToolbox.hasPermissionForTool(
        tool,
        contextFor({ allow: [Permission.ProjectMember] }),
      ),
    ).toBe(true);
  });

  test("refuses a user holding none of them", () => {
    expect(
      AIToolbox.hasPermissionForTool(
        tool,
        contextFor({ allow: [Permission.ReadStatusPageSSO] }),
      ),
    ).toBe(false);
  });

  test("refuses a user with no project permissions at all", () => {
    expect(AIToolbox.hasPermissionForTool(tool, contextFor({}))).toBe(false);
  });

  /*
   * Fail closed. A block permission wins even when an allow permission for
   * the same tool is present - for the raw-SQL aggregation tools this gate
   * is the only authorization there is, so "some other grant also matched"
   * must not be enough.
   */
  test("refuses when a required permission is blocked, even if another is allowed", () => {
    expect(
      AIToolbox.hasPermissionForTool(
        tool,
        contextFor({
          allow: [Permission.ProjectMember],
          block: [Permission.ProjectOwner],
        }),
      ),
    ).toBe(false);
  });

  test("ignores a block on a permission the tool does not require", () => {
    expect(
      AIToolbox.hasPermissionForTool(
        tool,
        contextFor({
          allow: [Permission.ProjectMember],
          block: [Permission.DeleteProject],
        }),
      ),
    ).toBe(true);
  });

  test.each([
    ["root", { isRoot: true }],
    ["a master admin", { isMasterAdmin: true }],
  ])("lets %s through", (_name: string, flags: JSONObject) => {
    expect(AIToolbox.hasPermissionForTool(tool, contextFor({ ...flags }))).toBe(
      true,
    );
  });
});

describe("AIToolbox.executeTool", () => {
  test("runs a permitted tool and hands its data back to the model", async () => {
    lookupBehaviour = async (): Promise<JSONObject> => {
      return {
        dataForLlm: "services: checkout, payments",
        rowCount: 2,
        citationLabel: "Services",
        redactionCount: 0,
        isTruncated: false,
      };
    };

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: { type: "services" },
      ctx: contextFor({ allow: [Permission.ProjectMember] }),
    });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toBe("services: checkout, payments");
    expect(outcome.result?.rowCount).toBe(2);
  });

  /*
   * The model chose this name, so the reply is written for the model: say
   * what went wrong and list what it could have called instead.
   */
  test("answers an unknown tool with the names it could have used", async () => {
    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "drop_everything",
      args: {},
      ctx: contextFor({ allow: [Permission.ProjectOwner] }),
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain('unknown tool "drop_everything"');
    expect(outcome.textForLlm).toContain("query_incidents");
    expect(outcome.result).toBeUndefined();
  });

  test("refuses a tool the user may not use, without running it", async () => {
    let ran: boolean = false;
    lookupBehaviour = async (): Promise<JSONObject> => {
      ran = true;
      return {};
    };

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: { type: "services" },
      ctx: contextFor({ allow: [Permission.ReadStatusPageSSO] }),
    });

    expect(ran).toBe(false);
    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toContain("Permission denied");
    expect(outcome.textForLlm).toContain("which permission is missing");
  });

  test("refuses a blocked tool even when the user is otherwise permitted", async () => {
    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: { type: "services" },
      ctx: contextFor({
        allow: [Permission.ProjectMember],
        block: [Permission.ProjectMember],
      }),
    });

    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toContain("Permission denied");
  });

  /*
   * A tool that throws must not end the conversation. The model gets the
   * message and can correct its arguments or answer with what it has.
   */
  test("turns a failing tool into an error the model can act on", async () => {
    lookupBehaviour = async (): Promise<JSONObject> => {
      throw new Error("Invalid lookup type.");
    };

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: { type: "nonsense" },
      ctx: contextFor({ allow: [Permission.ProjectOwner] }),
    });

    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toBe("Invalid lookup type.");
    expect(outcome.textForLlm).toContain("Invalid lookup type.");
    expect(outcome.textForLlm).toContain("Adjust the arguments and try again");
  });

  test("survives a tool that throws something that is not an Error", async () => {
    lookupBehaviour = async (): Promise<JSONObject> => {
      throw "just a string";
    };

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: {},
      ctx: contextFor({ allow: [Permission.ProjectOwner] }),
    });

    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toBe("just a string");
  });
});
