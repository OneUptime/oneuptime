import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  ObservabilityTool,
  ToolContext,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import ServerProducts from "../../../../../Server/Utils/ServerProducts/ServerProducts";
import { AIToolRefusal } from "../../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import ProductKey from "../../../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../../../Types/Product/ServerProducts";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * AN ACTION THE PERSON MAY NOT TAKE NEVER REACHES THE APPROVAL CARD, FOR
 * EVERY ACTION (issue #7248).
 *
 * In Ask to act, a person whose role may not acknowledge an incident used to
 * see "Acknowledge incident #42", approve it, and only then read "Not done:
 * your role does not allow it". Setup actions were asked before their card
 * (#6829); now every action is: AIToolbox.checkBeforeApproval asks the very
 * gates executeTool asks when it runs - the request is this project's,
 * there is a signed-in person, they hold the tool's permissions for its
 * arguments with no team blocking them, and the tool's products are on -
 * so the card and the run cannot disagree. A read is never asked: it runs
 * at once, through the same gates.
 *
 * The three the issue names: an incident action, a runbook and a workflow
 * change.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

type Spy = jest.SpyInstance;

afterEach(() => {
  jest.restoreAllMocks();
});

function asMember(
  permissions: Array<Permission>,
  blocks?: Array<Permission>,
): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: customDomainCaller({
      permissions,
      projectId: PROJECT_ID,
      ...(blocks ? { blocks } : {}),
    }),
  };
}

interface ActionCase {
  // What the issue calls it.
  kind: string;
  name: string;
  args: JSONObject;
  // A role that may take it, and the permission the answer names otherwise.
  mayTakeIt: Array<Permission>;
  namedPermission: string;
  // A permission the action needs, for a team's block on it.
  blockable: Permission;
  product: ProductKey;
  productTitle: string;
}

const ACTIONS: Array<ActionCase> = [
  {
    kind: "an incident action",
    name: "acknowledge_incident",
    args: { incidentId: ObjectID.generate().toString() },
    mayTakeIt: [Permission.ProjectMember],
    namedPermission: "Create Incident State Timeline",
    blockable: Permission.CreateIncidentStateTimeline,
    product: ProductKey.Incidents,
    productTitle: "Incidents",
  },
  {
    kind: "a runbook",
    name: "run_runbook",
    args: { runbookId: ObjectID.generate().toString() },
    mayTakeIt: [Permission.ProjectMember],
    namedPermission: "Create Runbook Execution",
    blockable: Permission.CreateRunbookExecution,
    product: ProductKey.Runbooks,
    productTitle: "Runbooks",
  },
  {
    kind: "a workflow change",
    name: "update_workflow",
    args: {
      workflowId: ObjectID.generate().toString(),
      name: "Page the database team",
    },
    // A Project Member may not change workflows: an admin's grant may.
    mayTakeIt: [Permission.ProjectAdmin],
    namedPermission: "Edit Workflow",
    blockable: Permission.EditWorkflow,
    product: ProductKey.Workflows,
    productTitle: "Workflows",
  },
];

// A tool with execute typed as always there, to spy on.
function executeOf(name: string): { execute: ObservabilityTool["execute"] } {
  return AIToolbox.getToolByName(name) as unknown as {
    execute: ObservabilityTool["execute"];
  };
}

function switchOff(product: ProductKey): void {
  jest.spyOn(ServerProducts, "getFirstOff").mockImplementation((async (
    products: ReadonlyArray<ProductKey>,
  ) => {
    return products.includes(product)
      ? { product: product, reason: ServerProductOffReason.SwitchedOff }
      : null;
  }) as never);
}

describe.each(ACTIONS)(
  "$kind ($name), before its card",
  (action: ActionCase) => {
    test("is a mutation, so a card would be shown for it in Ask to act", () => {
      expect(AIToolbox.isMutationTool(action.name)).toBe(true);
      expect(AIToolbox.isSetupAction(action.name)).toBe(false);
    });

    test("a person whose role may not take it is told which permission it needs, and nothing runs", async () => {
      const execute: Spy = jest.spyOn(executeOf(action.name), "execute");

      const refused: ToolCallOutcome | null =
        await AIToolbox.checkBeforeApproval({
          name: action.name,
          args: action.args,
          ctx: asMember([Permission.Viewer]),
        });

      expect(refused?.success).toBe(false);
      expect(refused?.refusal).toBe(AIToolRefusal.Permission);
      expect(refused?.textForLlm).toContain(
        `does not have permission to use ${action.name}`,
      );
      expect(refused?.textForLlm).toContain(action.namedPermission);
      expect(refused?.errorMessage).toBe(
        `Permission denied for tool: ${action.name}`,
      );
      expect(execute).not.toHaveBeenCalled();
    });

    test("a team's block on a permission it needs is told as the block, not as a missing role", async () => {
      const refused: ToolCallOutcome | null =
        await AIToolbox.checkBeforeApproval({
          name: action.name,
          args: action.args,
          ctx: asMember(action.mayTakeIt, [action.blockable]),
        });

      expect(refused?.refusal).toBe(AIToolRefusal.TeamBlock);
      expect(refused?.textForLlm).toContain("a team they belong to blocks");
    });

    test("a person who may take it gets its card: nothing stops it", async () => {
      const execute: Spy = jest.spyOn(executeOf(action.name), "execute");

      expect(
        await AIToolbox.checkBeforeApproval({
          name: action.name,
          args: action.args,
          ctx: asMember(action.mayTakeIt),
        }),
      ).toBeNull();
      expect(execute).not.toHaveBeenCalled();
    });

    test("its product switched off on the server: no card, and who can switch it on", async () => {
      switchOff(action.product);

      const refused: ToolCallOutcome | null =
        await AIToolbox.checkBeforeApproval({
          name: action.name,
          args: action.args,
          ctx: asMember(action.mayTakeIt),
        });

      expect(refused?.refusal).toBe(AIToolRefusal.ProductOff);
      expect(refused?.errorMessage).toContain(
        `${action.productTitle} is switched off on this server.`,
      );
    });

    test("a run with nobody signed in, or for another project, is refused as running it would be", async () => {
      const asOneUptime: ToolCallOutcome | null =
        await AIToolbox.checkBeforeApproval({
          name: action.name,
          args: action.args,
          ctx: { projectId: PROJECT_ID, props: { isRoot: true } },
        });

      expect(asOneUptime?.refusal).toBe(AIToolRefusal.NotAllowed);

      const elsewhere: ToolCallOutcome | null =
        await AIToolbox.checkBeforeApproval({
          name: action.name,
          args: action.args,
          ctx: {
            projectId: ObjectID.generate(),
            props: asMember(action.mayTakeIt).props,
          },
        });

      expect(elsewhere?.refusal).toBe(AIToolRefusal.NotAllowed);
    });

    test("the card's refusal is the run's, word for word: the two cannot disagree", async () => {
      const execute: Spy = jest.spyOn(executeOf(action.name), "execute");
      const ctx: ToolContext = asMember([Permission.Viewer]);

      const checked: ToolCallOutcome | null =
        await AIToolbox.checkBeforeApproval({
          name: action.name,
          args: action.args,
          ctx,
        });
      const ran: ToolCallOutcome = await AIToolbox.executeTool({
        name: action.name,
        args: action.args,
        ctx,
      });

      expect(checked).not.toBeNull();
      expect(ran.success).toBe(false);
      expect(ran.textForLlm).toBe(checked?.textForLlm);
      expect(ran.errorMessage).toBe(checked?.errorMessage);
      expect(ran.refusal).toBe(checked?.refusal);
      expect(execute).not.toHaveBeenCalled();
    });
  },
);

describe("every action of the toolbox is asked before its card", () => {
  const mutations: Array<ObservabilityTool> = AIToolbox.getTools().filter(
    (tool: ObservabilityTool): boolean => {
      return Boolean(tool.isMutation);
    },
  );

  test("there are actions to ask about", () => {
    expect(mutations.length).toBeGreaterThan(20);
  });

  test.each(
    mutations.map((tool: ObservabilityTool): [string] => {
      return [tool.name];
    }),
  )("%s: a run with nobody signed in gets no card", async (name: string) => {
    const refused: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      {
        name: name,
        args: {},
        ctx: { projectId: PROJECT_ID, props: { isRoot: true } },
      },
    );

    expect(refused?.success).toBe(false);
    expect(refused?.refusal).toBe(AIToolRefusal.NotAllowed);
  });

  /*
   * Every action but the ones about the person themselves (their own How to
   * Reach Me: every signed-in member may change it).
   */
  const projectActions: Array<ObservabilityTool> = mutations.filter(
    (tool: ObservabilityTool): boolean => {
      return !tool.requiredPermissions.includes(Permission.CurrentUser);
    },
  );

  test("only an action about the person themselves is left out", () => {
    expect(
      mutations
        .filter((tool: ObservabilityTool): boolean => {
          return !projectActions.includes(tool);
        })
        .map((tool: ObservabilityTool): string => {
          return tool.name;
        }),
    ).toEqual(["set_how_to_reach_me"]);
  });

  test.each(
    projectActions.map((tool: ObservabilityTool): [string] => {
      return [tool.name];
    }),
  )(
    "%s: a person who holds no permission at all gets no card",
    async (name: string) => {
      const refused: ToolCallOutcome | null =
        await AIToolbox.checkBeforeApproval({
          name: name,
          args: {},
          ctx: asMember([]),
        });

      expect(refused?.success).toBe(false);
      expect([AIToolRefusal.Permission, AIToolRefusal.TeamBlock]).toContain(
        refused?.refusal,
      );
    },
  );
});

describe("a read is never asked before a card: it runs at once, through the same gates", () => {
  test.each([["query_incidents"], ["query_monitors"], ["who_is_told"]])(
    "%s",
    async (name: string) => {
      expect(AIToolbox.isMutationTool(name)).toBe(false);
      expect(
        await AIToolbox.checkBeforeApproval({
          name: name,
          args: {},
          ctx: asMember([]),
        }),
      ).toBeNull();
    },
  );

  test("a tool the toolbox does not have is not asked either", async () => {
    expect(
      await AIToolbox.checkBeforeApproval({
        name: "run_kubectl",
        args: {},
        ctx: asMember([]),
      }),
    ).toBeNull();
  });
});
