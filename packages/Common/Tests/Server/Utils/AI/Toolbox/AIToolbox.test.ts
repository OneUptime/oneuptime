import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AIChatPermissionMode from "../../../../../Types/AI/AIChatPermissionMode";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";

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

// A second project the same user belongs to.
const otherProjectId: ObjectID = new ObjectID(
  "33333333-3333-3333-3333-333333333333",
);

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

/*
 * The shape of the evidence re-run bug: the caller holds every grant in the
 * tenant their request names, but the tool is pointed at a different project
 * (or the request is multi-tenant). The grants checked must be the grants of
 * the project queried, so all of these must be refused.
 */
function mismatchedContexts(): Array<[string, ToolContext]> {
  const allowed: ToolContext = contextFor({
    allow: [Permission.ProjectOwner, Permission.ProjectMember],
  });

  return [
    [
      "a tool pointed at a project other than the request's tenant",
      { projectId: otherProjectId, props: allowed.props },
    ],
    [
      "a multi-tenant request, even inside the tenant",
      {
        projectId: projectId,
        props: { ...allowed.props, isMultiTenantRequest: true },
      },
    ],
    [
      "a multi-tenant request pointed at another project",
      {
        projectId: otherProjectId,
        props: { ...allowed.props, isMultiTenantRequest: true },
      },
    ],
    [
      "a request with no tenant at all",
      {
        projectId: projectId,
        props: { ...allowed.props, tenantId: undefined },
      },
    ],
  ];
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

  test.each(mismatchedContexts())(
    "refuses %s despite the tenant's grants",
    (_name: string, ctx: ToolContext) => {
      expect(AIToolbox.hasPermissionForTool(tool, ctx)).toBe(false);
    },
  );

  test("still lets a system (root) run query any project it is pointed at", () => {
    expect(
      AIToolbox.hasPermissionForTool(tool, {
        projectId: otherProjectId,
        props: { isRoot: true },
      }),
    ).toBe(true);
  });
});

describe("AIToolbox.isContextScopedToOneProject", () => {
  test("accepts a caller whose tenant is the tool's project", () => {
    expect(AIToolbox.isContextScopedToOneProject(contextFor({}))).toBe(true);
  });

  // Chat/Slack/Teams build the context from an ObjectID of the same value.
  test("compares project ids by value, not identity", () => {
    const ctx: ToolContext = contextFor({});

    expect(
      AIToolbox.isContextScopedToOneProject({
        projectId: new ObjectID(projectId.toString()),
        props: ctx.props,
      }),
    ).toBe(true);
  });

  test.each(mismatchedContexts())(
    "rejects %s",
    (_name: string, ctx: ToolContext) => {
      expect(AIToolbox.isContextScopedToOneProject(ctx)).toBe(false);
    },
  );

  test.each([
    ["root", { isRoot: true }],
    ["a master admin", { isMasterAdmin: true }],
  ])("does not constrain %s", (_name: string, flags: JSONObject) => {
    expect(
      AIToolbox.isContextScopedToOneProject({
        projectId: otherProjectId,
        props: {
          ...flags,
          isMultiTenantRequest: true,
        } as DatabaseCommonInteractionProps,
      }),
    ).toBe(true);
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

  test.each(mismatchedContexts())(
    "refuses %s without running the tool",
    async (_name: string, ctx: ToolContext) => {
      let ran: boolean = false;
      lookupBehaviour = async (): Promise<JSONObject> => {
        ran = true;
        return {
          dataForLlm: "rows from the wrong project",
          rowCount: 1,
          citationLabel: "Services",
          redactionCount: 0,
          isTruncated: false,
        };
      };

      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name: "lookup_context",
        args: { type: "services" },
        ctx,
      });

      expect(ran).toBe(false);
      expect(outcome.success).toBe(false);
      expect(outcome.result).toBeUndefined();
      expect(outcome.errorMessage).toContain("Permission denied");
      expect(outcome.errorMessage).toContain("not scoped to this project");
      expect(outcome.textForLlm).not.toContain("rows from the wrong project");
    },
  );

  test("runs a root context pointed at any project", async () => {
    lookupBehaviour = async (): Promise<JSONObject> => {
      return {
        dataForLlm: "services: checkout",
        rowCount: 1,
        citationLabel: "Services",
        redactionCount: 0,
        isTruncated: false,
      };
    };

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: { type: "services" },
      ctx: { projectId: otherProjectId, props: { isRoot: true } },
    });

    expect(outcome.success).toBe(true);
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

/*
 * A tool that changes the project writes as the person who asked for it,
 * with their own props, so a run that is no person - a system run as
 * OneUptime, an autonomous investigation - has nobody to write as and
 * changes nothing. And a change the person may not make is no mistake in
 * the arguments: the model is told it was refused, why, and not to retry.
 */
describe("AIToolbox.executeTool and the person a change is made as", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mutationTool(): ObservabilityTool {
    const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(
      "acknowledge_incident",
    );
    expect(tool?.isMutation).toBe(true);
    return tool!;
  }

  test.each([
    ["a system run as OneUptime", false],
    ["a system run that also names a user", true],
  ])(
    "refuses a tool that changes the project for %s, without running it",
    async (_name: string, namesUser: boolean) => {
      const tool: ObservabilityTool = mutationTool();
      const executeSpy: SpyInstance<typeof tool.execute> = jest
        .spyOn(tool, "execute")
        .mockResolvedValue({
          dataForLlm: "changed",
          rowCount: 1,
          citationLabel: "Changed",
          redactionCount: 0,
          isTruncated: false,
        });

      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name: tool.name,
        args: { incidentId: ObjectID.generate().toString() },
        ctx: {
          projectId: projectId,
          props: {
            isRoot: true,
            ...(namesUser
              ? { userId: ObjectID.generate(), tenantId: projectId }
              : {}),
          },
        },
      });

      expect(executeSpy).not.toHaveBeenCalled();
      expect(outcome.success).toBe(false);
      expect(outcome.result).toBeUndefined();
      expect(outcome.textForLlm).toBe(
        "Error: acknowledge_incident changes the project, and only runs for a signed-in person who asked for it. Answer with the data you already have.",
      );
      expect(outcome.errorMessage).toContain("no signed-in person to act as");
    },
  );

  test("refuses a tool that changes the project when the request names no user, without running it", async () => {
    const tool: ObservabilityTool = mutationTool();
    const executeSpy: SpyInstance<typeof tool.execute> = jest.spyOn(
      tool,
      "execute",
    );
    const ctx: ToolContext = contextFor({ allow: [Permission.ProjectOwner] });
    delete ctx.props.userId;

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: tool.name,
      args: { incidentId: ObjectID.generate().toString() },
      ctx: ctx,
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toContain("no signed-in person to act as");
  });

  test("refuses a tool that changes the project for a master admin whose request names no project, without running it", async () => {
    const tool: ObservabilityTool = mutationTool();
    const executeSpy: SpyInstance<typeof tool.execute> = jest.spyOn(
      tool,
      "execute",
    );

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: tool.name,
      args: { incidentId: ObjectID.generate().toString() },
      ctx: {
        projectId: projectId,
        props: { isMasterAdmin: true, userId: ObjectID.generate() },
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toBe(
      "Error: acknowledge_incident changes the project, and only runs inside the project the request is for. Answer with the data you already have.",
    );
    expect(outcome.errorMessage).toContain(
      "the request is not for this project",
    );
  });

  test("runs a tool that changes the project for a signed-in person who holds its permission", async () => {
    const tool: ObservabilityTool = mutationTool();
    const executeSpy: SpyInstance<typeof tool.execute> = jest
      .spyOn(tool, "execute")
      .mockResolvedValue({
        dataForLlm: "Incident #42 is now Acknowledged.",
        rowCount: 1,
        citationLabel: "Acknowledged incident #42",
        redactionCount: 0,
        isTruncated: false,
      });
    const ctx: ToolContext = contextFor({ allow: [Permission.ProjectMember] });

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: tool.name,
      args: { incidentId: ObjectID.generate().toString() },
      ctx: ctx,
    });

    expect(outcome.success).toBe(true);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    // The tool is handed the person's own props, as they arrived.
    expect(executeSpy.mock.calls[0]![1].props).toBe(ctx.props);
  });

  test("still runs a tool that only reads for a system run", async () => {
    lookupBehaviour = async (): Promise<JSONObject> => {
      return {
        dataForLlm: "services: checkout",
        rowCount: 1,
        citationLabel: "Services",
        redactionCount: 0,
        isTruncated: false,
      };
    };

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: { type: "services" },
      ctx: { projectId: projectId, props: { isRoot: true } },
    });

    expect(outcome.success).toBe(true);
  });

  test("tells the model which permissions a refused tool needs", async () => {
    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: { type: "services" },
      ctx: contextFor({ allow: [Permission.ReadStatusPageSSO] }),
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "It needs one of these permissions: Project Owner, Project Member.",
    );
  });

  test("tells the model a permission the user holds is blocked on some labels, rather than missing", async () => {
    const ctx: ToolContext = contextFor({ allow: [Permission.ProjectMember] });
    ctx.props.userTenantAccessPermission![
      projectId.toString()
    ]!.permissions.push({
      permission: Permission.ProjectMember,
      labelIds: [ObjectID.generate()],
      isBlockPermission: true,
      _type: "UserPermission",
    });

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: { type: "services" },
      ctx: ctx,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "tell the user why: they hold a permission it needs, but a team they belong to blocks Project Member on some labels, and a block on any permission this tool accepts refuses it everywhere.",
    );
    expect(outcome.textForLlm).not.toContain(
      "It needs one of these permissions",
    );
    expect(outcome.textForLlm).not.toContain("which permission is missing");
  });

  test("tells the model a permission the user holds is blocked outright, rather than missing", async () => {
    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "lookup_context",
      args: { type: "services" },
      ctx: contextFor({
        allow: [Permission.ProjectMember],
        block: [Permission.ProjectOwner],
      }),
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "tell the user why: they hold a permission it needs, but a team they belong to blocks Project Owner, and a block on any permission this tool accepts refuses it.",
    );
    expect(outcome.textForLlm).not.toContain("on some labels");
    expect(outcome.textForLlm).not.toContain(
      "It needs one of these permissions",
    );
  });

  test("a person who may edit incidents but not change their state is not let through", async () => {
    const tool: ObservabilityTool = mutationTool();
    const executeSpy: SpyInstance<typeof tool.execute> = jest.spyOn(
      tool,
      "execute",
    );

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: tool.name,
      args: { incidentId: ObjectID.generate().toString() },
      ctx: contextFor({ allow: [Permission.EditProjectIncident] }),
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toContain("Permission denied");
    expect(outcome.textForLlm).toContain("Create Incident State Timeline");
  });

  test.each([
    [
      "the person may not make it",
      new NotAuthorizedException(
        "You do not have permissions to create Incident State Timeline.",
      ),
    ],
    [
      "the project's plan does not include it",
      new PaymentRequiredException(
        "Please upgrade your plan to Growth to make this change.",
      ),
    ],
  ])(
    "a change refused because %s is answered plainly, without asking for a retry",
    async (_name: string, refusal: Error) => {
      lookupBehaviour = async (): Promise<JSONObject> => {
        throw refusal;
      };

      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name: "lookup_context",
        args: { type: "services" },
        ctx: contextFor({ allow: [Permission.ProjectOwner] }),
      });

      expect(outcome.success).toBe(false);
      expect(outcome.errorMessage).toBe(refusal.message);
      expect(outcome.textForLlm).toBe(
        "Refused: lookup_context was not allowed for the current user. " +
          refusal.message +
          " Do not retry it. Tell the user plainly that it was not done, and why.",
      );
      expect(outcome.textForLlm).not.toContain("Adjust the arguments");
    },
  );
});
