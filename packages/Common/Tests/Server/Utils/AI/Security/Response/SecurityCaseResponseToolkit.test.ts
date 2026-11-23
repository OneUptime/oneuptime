import SecurityCase from "../../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityCaseFeed from "../../../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityPlaybookRun from "../../../../../../Models/DatabaseModels/SecurityPlaybookRun";
import SecurityBlockService from "../../../../../../Server/Services/SecurityBlockService";
import SecurityCaseAiActionService from "../../../../../../Server/Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../../../../../Server/Services/SecurityCaseFeedService";
import SecurityPlaybookRunService, {
  AiStepRunRequest,
} from "../../../../../../Server/Services/SecurityPlaybookRunService";
import SecurityProtectedEntityService from "../../../../../../Server/Services/SecurityProtectedEntityService";
import SecurityCaseResponseToolkit, {
  ToolResult,
  ToolkitCase,
} from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseToolkit";
import { ResponderIntent } from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponsePlanner";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_CASE_AI_DEFAULT_MODES,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiArea,
  SecurityCaseAiDecisionKind,
  SecurityCaseAiMode,
  SecurityCaseHandOffReason,
} from "../../../../../../Types/SecurityCase/SecurityCaseAi";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchesJson,
} from "../../../../../../Types/SecurityCase/SecurityCaseMatches";
import { SecurityEntityType } from "../../../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// A step that fails is logged; the tests read the result instead.
jest.mock("../../../../../../Server/Utils/Logger");

/*
 * ONEUPTIME AI'S TOOLS ON A CASE (#10352), with the services faked as they
 * answer: every change goes through the playbook engine as a one-step run
 * of OneUptime AI's (SecurityPlaybookRunService.startAiStepRun) - asked
 * first, or on its own with the stamp of the Security Admin who let it -
 * and the toolkit's own authorization stops what the planner may not have
 * seen: the hourly limit, an address that is not the case's, one already
 * blocked, a protected address or user. Each action is logged before it
 * starts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RUN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const ADMIN_ID: string = "44444444-4444-4444-8444-444444444444";
const ADDRESS: string = "35.196.249.14";
const BLOCK_KEY: string = `contain:block-ip:${ADDRESS}`;
const NOW: Date = new Date("2026-11-22T12:00:00.000Z");

function matches(): SecurityCaseMatchesJson {
  return {
    detections: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        source: "Detection Rule",
        title: `Web scanner — ${ADDRESS}`,
        severity: "Medium",
        groupValue: ADDRESS,
        ruleName: "Web scanner",
        eventCount: 120,
        fireCount: 1,
        firstSeenAt: "2026-11-22T09:00:00.000Z",
        lastSeenAt: "2026-11-22T09:30:00.000Z",
        sampleMessage: "",
        isOpening: true,
        rule: null,
        threatIntelFeedId: "",
        securityEventConnectionId: "",
        basis: SecurityCaseMatchBasis.RuleCondition,
        windowStart: "2026-11-22T09:00:00.000Z",
        windowEnd: "2026-11-22T09:30:00.000Z",
        events: [],
        isKept: false,
        keptPastRetentionCount: 0,
        hiddenEventCount: 0,
        matchedEventCount: 120,
        outcomes: {},
      },
    ],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };
}

function toolkitCase(
  overrides: Partial<ToolkitCase> = {},
  edge: SecurityCaseAiMode = SecurityCaseAiMode.OnItsOwn,
): ToolkitCase {
  const securityCase: SecurityCase = new SecurityCase(CASE_ID);
  securityCase.projectId = PROJECT_ID;
  securityCase.entities = [
    { type: SecurityEntityType.IpAddress, value: ADDRESS },
  ] as never;

  return {
    projectId: PROJECT_ID,
    securityCase,
    aiRunId: RUN_ID,
    limits: {
      isOn: true,
      modes: {
        ...SECURITY_CASE_AI_DEFAULT_MODES,
        [SecurityCaseAiArea.Edge]: edge,
      },
      stamps: {
        [SecurityCaseAiArea.Edge]: {
          byUserId: ADMIN_ID,
          at: "2026-11-20T10:00:00.000Z",
        },
      },
    },
    values: { priorities: [], statuses: [] } as never,
    matches: matches(),
    stepsByKey: new Map(),
    now: NOW,
    ...overrides,
  };
}

function blockIntent(
  decision: SecurityCaseAiDecisionKind = SecurityCaseAiDecisionKind.Do,
  target: string = ADDRESS,
): ResponderIntent {
  return {
    kind: SecurityCaseAiActionKind.BlockAddress,
    stepKey: BLOCK_KEY,
    target,
    decision,
    reason:
      decision === SecurityCaseAiDecisionKind.Do
        ? SecurityCaseAiActionReason.OnItsOwn
        : SecurityCaseAiActionReason.SettingAsks,
    mode:
      decision === SecurityCaseAiDecisionKind.Do
        ? SecurityCaseAiMode.OnItsOwn
        : SecurityCaseAiMode.Ask,
  };
}

let actionsThisHour: number;
let created: Array<SecurityCaseAiAction>;
let updates: Array<{ id: string; data: Record<string, unknown> }>;
let started: Array<AiStepRunRequest>;
let feed: Array<string>;
let blockCheck: Record<string, unknown>;
let startError: Error | null;

beforeEach(() => {
  actionsThisHour = 0;
  created = [];
  updates = [];
  started = [];
  feed = [];
  startError = null;
  blockCheck = {
    coveredBy: null,
    problem: null,
    protection: { protection: null, unreadSources: [] },
  };

  jest
    .spyOn(SecurityCaseAiActionService, "countBy")
    .mockImplementation((async () => {
      return {
        toNumber: () => {
          return actionsThisHour;
        },
      };
    }) as never);
  jest
    .spyOn(SecurityCaseAiActionService, "create")
    .mockImplementation((async (args: { data: SecurityCaseAiAction }) => {
      const row: SecurityCaseAiAction = args.data;
      row.id = new ObjectID(
        `aaaaaaaa-aaaa-4aaa-8aaa-${String(created.length + 1).padStart(12, "0")}`,
      );
      created.push(row);
      return row;
    }) as never);
  jest
    .spyOn(SecurityCaseAiActionService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      updates.push({ id: args.id.toString(), data: args.data });
    }) as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (args: { feedInfoInMarkdown: string }) => {
      feed.push(args.feedInfoInMarkdown);
      return new SecurityCaseFeed();
    }) as never);
  jest.spyOn(SecurityBlockService, "check").mockImplementation((async () => {
    return blockCheck;
  }) as never);
  jest
    .spyOn(SecurityProtectedEntityService, "getRules")
    .mockImplementation((async () => {
      return [];
    }) as never);
  jest
    .spyOn(SecurityPlaybookRunService, "startAiStepRun")
    .mockImplementation((async (request: AiStepRunRequest) => {
      started.push(request);

      if (startError) {
        throw startError;
      }

      const run: SecurityPlaybookRun = new SecurityPlaybookRun(
        new ObjectID("55555555-5555-4555-8555-555555555555"),
      );
      return run;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("through the playbook engine, as OneUptime AI", () => {
  test("on its own: one step of OneUptime AI's, no approval, carrying the stamp of the Security Admin who let it", async () => {
    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase(),
      blockIntent(),
    );

    expect(result).toEqual({ status: SecurityCaseAiActionStatus.Doing });
    expect(started).toHaveLength(1);
    expect(started[0]!.projectId).toEqual(PROJECT_ID);
    expect(started[0]!.securityCaseId).toEqual(CASE_ID);
    expect(started[0]!.step).toEqual(
      expect.objectContaining({
        action: SecurityPlaybookActionType.BlockAddress,
        requiresApproval: false,
        config: {
          blockAction: SecurityBlockAction.Block,
          duration: SecurityBlockDuration.OneDay,
        },
        approvalTurnedOff: {
          byUserId: ADMIN_ID,
          at: "2026-11-20T10:00:00.000Z",
        },
      }),
    );
    expect(started[0]!.targets).toEqual([
      expect.objectContaining({
        type: SecurityEntityType.IpAddress,
        value: ADDRESS,
      }),
    ]);
  });

  test("logged before it starts, then linked to its run", async () => {
    await SecurityCaseResponseToolkit.carryOut(toolkitCase(), blockIntent());

    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(
      expect.objectContaining({
        kind: SecurityCaseAiActionKind.BlockAddress,
        status: SecurityCaseAiActionStatus.Doing,
        reason: SecurityCaseAiActionReason.OnItsOwn,
        area: SecurityCaseAiArea.Edge,
        mode: SecurityCaseAiMode.OnItsOwn,
        target: ADDRESS,
        stepKey: BLOCK_KEY,
      }),
    );
    expect(created[0]!.aiRunId).toEqual(RUN_ID);
    expect(updates).toEqual([
      {
        id: created[0]!.id!.toString(),
        data: {
          securityPlaybookRunId: new ObjectID(
            "55555555-5555-4555-8555-555555555555",
          ),
        },
      },
    ]);
  });

  test("asked first: the step waits for a person's approval, with no stamp", async () => {
    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase({}, SecurityCaseAiMode.Ask),
      blockIntent(SecurityCaseAiDecisionKind.Ask),
    );

    expect(result).toEqual({ status: SecurityCaseAiActionStatus.Asked });
    expect(started[0]!.step.requiresApproval).toBe(true);
    expect(started[0]!.step.approvalTurnedOff).toBeUndefined();
    expect(updates[0]!.data).toEqual(
      expect.objectContaining({
        status: SecurityCaseAiActionStatus.Asked,
        askedAt: NOW,
      }),
    );
  });

  test("an engine that refuses the step fails it, and the case goes to people", async () => {
    startError = new Error("The engine is down.");

    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase(),
      blockIntent(),
    );

    expect(result).toEqual({
      status: SecurityCaseAiActionStatus.Failed,
      handOff: SecurityCaseHandOffReason.StepFailed,
    });
    expect(updates[0]!.data).toEqual(
      expect.objectContaining({
        status: SecurityCaseAiActionStatus.Failed,
        reason: SecurityCaseAiActionReason.EngineFailed,
      }),
    );
  });

  test("one of its runs already on the case for the same step is that step, never a second run", async () => {
    startError = new BadDataException("A run of this already waits.");
    jest
      .spyOn(SecurityPlaybookRunService, "findBy")
      .mockImplementation((async () => {
        const run: SecurityPlaybookRun = new SecurityPlaybookRun(
          new ObjectID("66666666-6666-4666-8666-666666666666"),
        );
        // The step it would have started, as the engine keeps it.
        run.steps = started.map((request: AiStepRunRequest) => {
          return request.step;
        }) as never;
        return [run];
      }) as never);

    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase(),
      blockIntent(),
    );

    expect(result.status).toBe(SecurityCaseAiActionStatus.Doing);
    expect(started).toHaveLength(1);
  });
});

describe("its own authorization, whatever the planner decided", () => {
  test("past the hour's limit nothing runs on its own: the case goes to people", async () => {
    actionsThisHour = 10;

    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase(),
      blockIntent(),
    );

    expect(result).toEqual({
      status: SecurityCaseAiActionStatus.Left,
      handOff: SecurityCaseHandOffReason.BreakerTripped,
    });
    expect(started).toEqual([]);
  });

  test("the limit does not stop asking a person", async () => {
    actionsThisHour = 10;

    expect(
      (
        await SecurityCaseResponseToolkit.carryOut(
          toolkitCase({}, SecurityCaseAiMode.Ask),
          blockIntent(SecurityCaseAiDecisionKind.Ask),
        )
      ).status,
    ).toBe(SecurityCaseAiActionStatus.Asked);
  });

  test("an address none of the case's requests came from is never blocked", async () => {
    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase(),
      blockIntent(SecurityCaseAiDecisionKind.Do, "198.51.100.77"),
    );

    expect(result).toEqual({ status: SecurityCaseAiActionStatus.Left });
    expect(started).toEqual([]);
    expect(created[0]!.reason).toBe(SecurityCaseAiActionReason.NeedsJudgement);
  });

  test("an address already blocked is left as it is", async () => {
    blockCheck["coveredBy"] = { value: "35.196.249.0/24" };

    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase(),
      blockIntent(),
    );

    expect(result).toEqual({ status: SecurityCaseAiActionStatus.Left });
    expect(created[0]!.reason).toBe(SecurityCaseAiActionReason.AlreadyBlocked);
    expect(started).toEqual([]);
  });

  test("a protected address, or one of the project's own, goes to people", async () => {
    blockCheck["protection"] = {
      protection: { source: "Host", name: "web-1" },
      unreadSources: [],
    };

    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase(),
      blockIntent(),
    );

    expect(result).toEqual({
      status: SecurityCaseAiActionStatus.Left,
      handOff: SecurityCaseHandOffReason.ProtectedTarget,
    });
    expect(created[0]!.reason).toBe(SecurityCaseAiActionReason.ProtectedTarget);
    expect(started).toEqual([]);
  });

  test("an address OneUptime could not tell is the project's own goes to people", async () => {
    blockCheck["protection"] = {
      protection: null,
      unreadSources: ["Hosts"],
    };

    expect(
      await SecurityCaseResponseToolkit.carryOut(toolkitCase(), blockIntent()),
    ).toEqual({
      status: SecurityCaseAiActionStatus.Left,
      handOff: SecurityCaseHandOffReason.CannotTell,
    });
    expect(started).toEqual([]);
  });

  test("a protected user is never contained", async () => {
    jest
      .spyOn(SecurityProtectedEntityService, "getRules")
      .mockImplementation((async () => {
        return [
          {
            type: SecurityEntityType.User,
            value: "break-glass@example.com",
          },
        ];
      }) as never);

    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase(),
      {
        kind: SecurityCaseAiActionKind.ContainAccount,
        stepKey: "contain:user:break-glass@example.com",
        target: "break-glass@example.com",
        decision: SecurityCaseAiDecisionKind.Do,
        reason: SecurityCaseAiActionReason.OnItsOwn,
        mode: SecurityCaseAiMode.OnItsOwn,
      },
    );

    expect(result).toEqual({
      status: SecurityCaseAiActionStatus.Left,
      handOff: SecurityCaseHandOffReason.ProtectedTarget,
    });
    expect(started).toEqual([]);
  });
});

describe("a step left for a person", () => {
  test("is logged with why, and said on the case's timeline as OneUptime AI's", async () => {
    const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
      toolkitCase(),
      {
        kind: SecurityCaseAiActionKind.StepForPeople,
        stepKey: "fix:account-changes",
        decision: SecurityCaseAiDecisionKind.Leave,
        reason: SecurityCaseAiActionReason.FixNotChecked,
        mode: null,
      },
    );

    expect(result).toEqual({ status: SecurityCaseAiActionStatus.Left });
    expect(created[0]).toEqual(
      expect.objectContaining({
        status: SecurityCaseAiActionStatus.Left,
        reason: SecurityCaseAiActionReason.FixNotChecked,
      }),
    );
    expect(started).toEqual([]);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toContain("OneUptime AI left a step for a person");
  });
});
