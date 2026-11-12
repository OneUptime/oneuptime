import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import { SetUpWebsiteMonitoringTool } from "../../../../../Server/Utils/AI/Toolbox/SetupTools";
import {
  ObservabilityTool,
  ToolContext,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import MonitorStatusService from "../../../../../Server/Services/MonitorStatusService";
import { AIToolRefusal } from "../../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A SETUP ACTION THAT CANNOT BE MADE IS NEVER PROPOSED (issue #6829).
 *
 * "A request it cannot fulfil (no permission, a plan limit, no phone number)
 * ends with what is needed, not with an error." Before a setup action's card
 * is shown, AIToolbox.checkBeforeApproval asks the gates a run asks - the
 * request is this project's, there is a signed-in person to act as, and
 * they hold the action's permissions - then the action's own check. Either
 * refusal is what the model is told instead of a card; nothing runs. Any
 * other tool keeps its card, and its gates are asked when it runs, as
 * before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

type Spy = jest.SpyInstance;

afterEach(() => {
  jest.restoreAllMocks();
});

function asMember(permissions: Array<Permission>): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: customDomainCaller({ permissions, projectId: PROJECT_ID }),
  };
}

// set_up_website_monitoring with execute typed as always there, to spy on.
const SETUP_TOOL: { execute: ObservabilityTool["execute"] } =
  SetUpWebsiteMonitoringTool as unknown as {
    execute: ObservabilityTool["execute"];
  };

describe("AIToolbox.checkBeforeApproval", () => {
  test("is no gate for a tool that is not a setup action: its card shows, and it is gated when it runs", async () => {
    const execute: Spy = jest.spyOn(SETUP_TOOL, "execute");

    expect(
      await AIToolbox.checkBeforeApproval({
        name: "create_incident",
        args: { title: "x" },
        ctx: asMember([]),
      }),
    ).toBeNull();
    expect(
      await AIToolbox.checkBeforeApproval({
        name: "query_monitors",
        args: {},
        ctx: asMember([]),
      }),
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  test("a person whose role may not make it is told which permission it needs, and nothing runs", async () => {
    const execute: Spy = jest.spyOn(SETUP_TOOL, "execute");

    const refused: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      {
        name: "set_up_website_monitoring",
        args: { address: "example.com" },
        ctx: asMember([Permission.ReadProjectMonitor]),
      },
    );

    expect(refused?.success).toBe(false);
    expect(refused?.refusal).toBe(AIToolRefusal.Permission);
    expect(refused?.textForLlm).toContain(
      "does not have permission to use set_up_website_monitoring",
    );
    expect(refused?.textForLlm).toContain("Create Monitor");
    expect(execute).not.toHaveBeenCalled();
  });

  test("a team's block on the permission it needs is told as the block", async () => {
    const refused: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      {
        name: "set_up_website_monitoring",
        args: { address: "example.com" },
        ctx: {
          projectId: PROJECT_ID,
          props: customDomainCaller({
            permissions: [Permission.ProjectMember],
            blocks: [Permission.CreateProjectMonitor],
            projectId: PROJECT_ID,
          }),
        },
      },
    );

    expect(refused?.refusal).toBe(AIToolRefusal.TeamBlock);
  });

  test("a run with nobody signed in, or for another project, makes nothing", async () => {
    const execute: Spy = jest.spyOn(SETUP_TOOL, "execute");

    const asOneUptime: ToolCallOutcome | null =
      await AIToolbox.checkBeforeApproval({
        name: "set_up_website_monitoring",
        args: { address: "example.com" },
        ctx: { projectId: PROJECT_ID, props: { isRoot: true } },
      });

    expect(asOneUptime?.refusal).toBe(AIToolRefusal.NotAllowed);
    expect(asOneUptime?.textForLlm).toContain(
      "only runs for a signed-in person",
    );

    const member: ToolContext = asMember([Permission.ProjectMember]);
    const elsewhere: ToolCallOutcome | null =
      await AIToolbox.checkBeforeApproval({
        name: "set_up_website_monitoring",
        args: { address: "example.com" },
        ctx: { projectId: ObjectID.generate(), props: member.props },
      });

    expect(elsewhere?.refusal).toBe(AIToolRefusal.NotAllowed);
    expect(execute).not.toHaveBeenCalled();
  });

  test("a person who may make it gets the action's own check: an address that is not one is said, with no card", async () => {
    const refused: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      {
        name: "set_up_website_monitoring",
        args: { address: "the website" },
        ctx: asMember([Permission.ProjectMember]),
      },
    );

    expect(refused?.success).toBe(false);
    expect(refused?.refusal).toBeUndefined();
    expect(refused?.textForLlm).toContain(
      "That is not a web address a website monitor can check",
    );
    expect(refused?.errorMessage).toBe(refused?.textForLlm);
  });

  test("nothing missing: null, and the card shows", async () => {
    jest
      .spyOn(MonitorStatusService, "findBy")
      .mockRejectedValue(new Error("unreadable now") as never);

    expect(
      await AIToolbox.checkBeforeApproval({
        name: "set_up_website_monitoring",
        args: { address: "example.com" },
        ctx: asMember([Permission.ProjectMember]),
      }),
    ).toBeNull();
  });

  test("a check that throws lets the card show: running it says what went wrong", async () => {
    const tool: {
      checkBeforeApproval: NonNullable<
        ObservabilityTool["checkBeforeApproval"]
      >;
    } = SetUpWebsiteMonitoringTool as unknown as {
      checkBeforeApproval: NonNullable<
        ObservabilityTool["checkBeforeApproval"]
      >;
    };
    jest
      .spyOn(tool, "checkBeforeApproval")
      .mockRejectedValue(new Error("boom") as never);

    expect(
      await AIToolbox.checkBeforeApproval({
        name: "set_up_website_monitoring",
        args: { address: "example.com" },
        ctx: asMember([Permission.ProjectMember]),
      }),
    ).toBeNull();
  });

  test("arguments that are not an object are refused as running them would be", async () => {
    const refused: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      {
        name: "set_up_website_monitoring",
        args: [] as never,
        ctx: asMember([Permission.ProjectMember]),
      },
    );

    expect(refused?.textForLlm).toContain("must be a JSON object");
  });
});

describe("executeTool keeps its gates, now shared with the check", () => {
  test("a refused setup action is refused the same way when it runs", async () => {
    const execute: Spy = jest.spyOn(SETUP_TOOL, "execute");
    const ctx: ToolContext = asMember([Permission.ReadProjectMonitor]);

    const checked: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      {
        name: "set_up_website_monitoring",
        args: { address: "example.com" },
        ctx,
      },
    );
    const ran: ToolCallOutcome = await AIToolbox.executeTool({
      name: "set_up_website_monitoring",
      args: { address: "example.com" },
      ctx,
    });

    expect(ran.textForLlm).toBe(checked?.textForLlm);
    expect(ran.refusal).toBe(checked?.refusal);
    expect(execute).not.toHaveBeenCalled();
  });
});
