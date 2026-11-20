import {
  PublishStatusPageTool,
  countStatusPagesSetUpInPlan,
} from "../../../../../Server/Utils/AI/Toolbox/SetupTools";
import {
  SetupActionRefusal,
  ToolContext,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import MonitorService from "../../../../../Server/Services/MonitorService";
import StatusPageService, {
  FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE,
  UNPAID_SUBSCRIPTION_STATUS_PAGE_MESSAGE,
} from "../../../../../Server/Services/StatusPageService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import { AIToolRefusal } from "../../../../../Types/AI/AIChatTypes";
import {
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
} from "../../../../../Types/AI/AISetupActions";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * PUBLISH_STATUS_PAGE ASKS THE PROJECT'S PLAN BEFORE ITS CARD (#7250).
 *
 * On OneUptime Cloud's Free plan a project has one status page, and an
 * unpaid subscription may add none. The card used to be shown, approved,
 * and the part then failed with the plan's sentence. Now the plan is asked
 * first, with StatusPageService's own answer (getCreateRefusal, which the
 * create gives again), for every status page the plan publishes: no card,
 * the plan's sentence in what the model is told, and the refusal the
 * activity calls the plan's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72500000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("72500000-0000-4000-8000-000000000002");
const MONITOR_ID: string = "72500000-0000-4000-8000-000000000003";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: USER_ID, tenantId: PROJECT_ID },
};

type Spy = jest.SpyInstance;

afterEach(() => {
  jest.restoreAllMocks();
});

function projectHasMonitorNamed(name: string): void {
  jest
    .spyOn(MonitorService, "findBy")
    .mockResolvedValue([
      Object.assign(new Monitor(), { _id: MONITOR_ID, name: name }),
    ] as never);
}

function planSays(refusal: string | null): Spy {
  return jest
    .spyOn(StatusPageService, "getCreateRefusal")
    .mockResolvedValue(refusal as never);
}

describe("publish_status_page and the project's plan", () => {
  test("the Free plan's one status page, taken: the plan's own sentence, before any card", async () => {
    projectHasMonitorNamed("example.com");
    const plan: Spy = planSays(FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE);

    const refused: SetupActionRefusal | null =
      await PublishStatusPageTool.checkBeforeApproval!(
        { name: "Acme Status", monitors: ["example.com"] },
        ctx,
      );

    expect(refused?.refusal).toBe(AIToolRefusal.Plan);
    expect(refused?.toldModel).toContain(FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE);
    expect(refused?.toldModel).toContain(
      "Nothing proposed: the project's plan does not allow another status page now.",
    );
    // What the person can do instead, with the page they have.
    expect(refused?.toldModel).toContain("add_monitors_to_status_page");
    expect(plan).toHaveBeenCalledWith({ projectId: PROJECT_ID, adding: 1 });
  });

  test("an unpaid subscription: its sentence, before any card", async () => {
    projectHasMonitorNamed("example.com");
    planSays(UNPAID_SUBSCRIPTION_STATUS_PAGE_MESSAGE);

    const refused: SetupActionRefusal | null =
      await PublishStatusPageTool.checkBeforeApproval!(
        { name: "Acme Status", monitors: ["example.com"] },
        ctx,
      );

    expect(refused?.refusal).toBe(AIToolRefusal.Plan);
    expect(refused?.toldModel).toContain(
      UNPAID_SUBSCRIPTION_STATUS_PAGE_MESSAGE,
    );
  });

  test("asked for every status page its plan publishes, and nothing else of the plan", async () => {
    projectHasMonitorNamed("example.com");
    const plan: Spy = planSays(null);

    expect(
      await PublishStatusPageTool.checkBeforeApproval!(
        { name: "Acme Status", monitors: ["example.com"] },
        {
          ...ctx,
          plannedCalls: [
            {
              name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
              arguments: { address: "example.com" },
            },
            {
              name: PUBLISH_STATUS_PAGE_TOOL_NAME,
              arguments: { name: "Acme Status", monitors: ["example.com"] },
            },
            {
              name: PUBLISH_STATUS_PAGE_TOOL_NAME,
              arguments: { name: "Acme API", monitors: ["example.com"] },
            },
          ],
        },
      ),
    ).toBeNull();
    expect(plan).toHaveBeenCalledWith({ projectId: PROJECT_ID, adding: 2 });
  });

  test("room in the plan lets the card show", async () => {
    projectHasMonitorNamed("example.com");
    planSays(null);

    expect(
      await PublishStatusPageTool.checkBeforeApproval!(
        { name: "Acme Status", monitors: ["example.com"] },
        ctx,
      ),
    ).toBeNull();
  });

  test("a plan that cannot be read lets the card show: creating the page asks again", async () => {
    projectHasMonitorNamed("example.com");
    jest
      .spyOn(StatusPageService, "getCreateRefusal")
      .mockRejectedValue(new Error("down") as never);

    expect(
      await PublishStatusPageTool.checkBeforeApproval!(
        { name: "Acme Status", monitors: ["example.com"] },
        ctx,
      ),
    ).toBeNull();
  });

  test("a name too short is said first: there is nothing to ask the plan about yet", async () => {
    const plan: Spy = planSays(FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE);

    expect(
      (
        await PublishStatusPageTool.checkBeforeApproval!(
          { name: "A", monitors: ["example.com"] },
          ctx,
        )
      )?.toldModel,
    ).toContain("at least two characters");
    expect(plan).not.toHaveBeenCalled();
  });

  test("counts the status pages a plan publishes, at least the one being checked", () => {
    expect(countStatusPagesSetUpInPlan(undefined)).toBe(1);
    expect(countStatusPagesSetUpInPlan([])).toBe(1);
    expect(
      countStatusPagesSetUpInPlan([
        { name: SET_UP_WEBSITE_MONITORING_TOOL_NAME, arguments: {} },
        { name: PUBLISH_STATUS_PAGE_TOOL_NAME, arguments: {} },
      ]),
    ).toBe(1);
    expect(
      countStatusPagesSetUpInPlan([
        { name: PUBLISH_STATUS_PAGE_TOOL_NAME, arguments: {} },
        { name: PUBLISH_STATUS_PAGE_TOOL_NAME, arguments: {} },
        { name: PUBLISH_STATUS_PAGE_TOOL_NAME, arguments: {} },
      ]),
    ).toBe(3);
  });
});
