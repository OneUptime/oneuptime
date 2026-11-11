import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyEscalationRuleService, {
  OnCallRuleExecutionOutcome,
} from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import logger from "../../../../Server/Utils/Logger";
import OnCallEscalationAdvance, {
  ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  OnCallEscalationAdvanceKind,
  OnCallEscalationAdvanceResult,
} from "../../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import { OnCallPassOnRefusal } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import OnCallTestPageRuns, {
  OnCallTestPageTick,
} from "../../../../Server/Utils/OnCall/OnCallTestPageRuns";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
  ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE,
  OnCallTestPageRecordKind,
} from "../../../../Types/OnCallDutyPolicy/OnCallTestPage";
import PositiveNumber from "../../../../Types/PositiveNumber";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A TEST PAGE'S RUN AFTER IT STARTS (OnCallTestPageRuns, and the guards in
 * OnCallEscalationAdvance and OnCallPagePassOn).
 *
 * Once a minute the worker hands every test page still paging to tick: a
 * test ends, unanswered, fifteen minutes after it started; a test of people
 * or of a policy's first level waits for that; a test that walks every level
 * moves on after a short wait - two minutes, or the level's own if shorter -
 * the one way any run moves on, which never starts a test's policy again.
 * A test is acknowledged, never passed on.
 */

const PROJECT: ObjectID = new ObjectID("7e570000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("7e570000-0000-4000-8000-000000000002");
const RUN: ObjectID = new ObjectID("7e570000-0000-4000-8000-000000000003");
const SEVERITY: ObjectID = new ObjectID(
  "7e570000-0000-4000-8000-000000000004",
);
const ANA: ObjectID = new ObjectID("7e570000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("7e570000-0000-4000-8000-0000000000b1");

const STARTED: Date = new Date("2026-11-11T09:00:00.000Z");
const MINUTE: number = 60 * 1000;

function at(minutes: number): Date {
  return new Date(STARTED.getTime() + minutes * MINUTE);
}

function testRun(
  data: {
    walksEscalation?: boolean;
    hasPolicy?: boolean;
    levelOrder?: number;
    levelStartedAt?: Date;
    levelWaitInMinutes?: number;
    repeats?: number;
  } = {},
): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = RUN;
  run.projectId = PROJECT;

  if (data.hasPolicy !== false) {
    run.onCallDutyPolicyId = POLICY;
    run.onCallDutyPolicy = {
      repeatPolicyIfNoOneAcknowledges: Boolean(data.repeats),
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: data.repeats || 0,
    } as never;
  }

  run.userNotificationEventType = UserNotificationEventType.TestPage;
  run.testPageRecordKind = OnCallTestPageRecordKind.Incident;
  run.testPageSeverityId = SEVERITY;
  run.testPageWalksEscalation = Boolean(data.walksEscalation);
  run.status = OnCallDutyPolicyStatus.Executing;
  run.createdAt = STARTED;
  run.lastExecutedEscalationRuleOrder = data.levelOrder ?? 1;
  run.lastEscalationRuleExecutedAt = data.levelStartedAt || STARTED;
  run.executeNextEscalationRuleInMinutes = data.levelWaitInMinutes ?? 30;
  run.onCallPolicyExecutionRepeatCount = 1;
  return run;
}

function ruleOf(order: number): OnCallDutyPolicyEscalationRule {
  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = new ObjectID(`7e570000-0000-4000-8000-00000000010${order}`);
  rule.order = order;
  rule.name = `Level ${order}`;
  return rule;
}

function outcome(
  data: Partial<OnCallRuleExecutionOutcome> = {},
): OnCallRuleExecutionOutcome {
  return {
    paged: [],
    notPaged: [],
    hadScheduleGap: false,
    movesOnAtOnce: false,
    ...data,
  };
}

function line(
  userId: ObjectID,
  status: OnCallDutyExecutionLogTimelineStatus,
): OnCallDutyPolicyExecutionLogTimeline {
  const row: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  row.alertSentToUserId = userId;
  row.status = status;
  return row;
}

let rules: Array<OnCallDutyPolicyEscalationRule>;
let lines: Array<OnCallDutyPolicyExecutionLogTimeline>;
let updateSpy: SpyInstance<
  typeof OnCallDutyPolicyExecutionLogService.updateOneById
>;
let startSpy: SpyInstance<
  typeof OnCallDutyPolicyEscalationRuleService.startRuleExecution
>;
let claimSpy: SpyInstance<
  typeof OnCallDutyPolicyExecutionLogService.claimEscalationAdvance
>;

beforeEach(() => {
  rules = [ruleOf(1), ruleOf(2), ruleOf(3)];
  lines = [];

  claimSpy = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "claimEscalationAdvance")
    .mockResolvedValue(true);

  updateSpy = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
    .mockResolvedValue({
      status: OnCallDutyPolicyStatus.Executing,
      lastEscalationRuleExecutedAt: STARTED,
    } as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
    .mockImplementation((async (data: { query: { order: number } }) => {
      return (
        rules.find((rule: OnCallDutyPolicyEscalationRule) => {
          return rule.order === data.query.order;
        }) || null
      );
    }) as never);

  startSpy = jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
    .mockResolvedValue(
      outcome({
        paged: [
          {
            userId: BOB,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
        ],
      }),
    );

  jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
    .mockImplementation((async (data: { query: { status?: unknown } }) => {
      if (data.query.status === OnCallDutyExecutionLogTimelineStatus.PassedOn) {
        return lines.filter((row: OnCallDutyPolicyExecutionLogTimeline) => {
          return row.status === OnCallDutyExecutionLogTimelineStatus.PassedOn;
        });
      }

      return lines;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "countBy")
    .mockImplementation((async () => {
      return new PositiveNumber(lines.length);
    }) as never);

  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a test ends, unanswered, fifteen minutes after it started", () => {
  test("at fifteen minutes it is Completed, saying nobody acknowledged it", async () => {
    const result: OnCallTestPageTick = await OnCallTestPageRuns.tick({
      run: testRun(),
      now: at(15),
    });

    expect(result).toBe(OnCallTestPageTick.Ended);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual({
      id: RUN,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
      },
      props: { isRoot: true },
    });
    expect(ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE).toBe(
      "Test ended: nobody acknowledged it within 15 minutes.",
    );
  });

  test("a walking test ends then too, rather than moving on to another level", async () => {
    const result: OnCallTestPageTick = await OnCallTestPageRuns.tick({
      run: testRun({ walksEscalation: true, levelStartedAt: at(10) }),
      now: at(16),
    });

    expect(result).toBe(OnCallTestPageTick.Ended);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  test("a minute before, it is still waiting for somebody to acknowledge it", async () => {
    const result: OnCallTestPageTick = await OnCallTestPageRuns.tick({
      run: testRun(),
      now: at(14),
    });

    expect(result).toBe(OnCallTestPageTick.Waiting);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a run whose start cannot be read is over, not paging for ever", async () => {
    const run: OnCallDutyPolicyExecutionLog = testRun();
    run.createdAt = undefined as never;

    const result: OnCallTestPageTick = await OnCallTestPageRuns.tick({
      run: run,
      now: at(1),
    });

    expect(result).toBe(OnCallTestPageTick.Ended);
  });
});

describe("a test of people, or of a policy's first level, only waits", () => {
  test("a test of people pages nobody more", async () => {
    const result: OnCallTestPageTick = await OnCallTestPageRuns.tick({
      run: testRun({ hasPolicy: false, walksEscalation: true }),
      now: at(5),
    });

    expect(result).toBe(OnCallTestPageTick.Waiting);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a test of a policy's first level stays on it, however long its wait is over", async () => {
    const result: OnCallTestPageTick = await OnCallTestPageRuns.tick({
      run: testRun({ walksEscalation: false, levelWaitInMinutes: 1 }),
      now: at(10),
    });

    expect(result).toBe(OnCallTestPageTick.Waiting);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });
});

describe("a test that walks every level moves on after a short wait", () => {
  test("a level that waits 30 minutes waits two in a test", async () => {
    const run: OnCallDutyPolicyExecutionLog = testRun({
      walksEscalation: true,
      levelWaitInMinutes: 30,
    });

    expect(
      await OnCallTestPageRuns.tick({ run: run, now: at(1) }),
    ).toBe(OnCallTestPageTick.Waiting);
    expect(claimSpy).not.toHaveBeenCalled();

    expect(
      await OnCallTestPageRuns.tick({ run: run, now: at(2) }),
    ).toBe(OnCallTestPageTick.MovedOn);

    // The next level, paged as a test: no record, the test's event type.
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy.mock.calls[0]![0]).toEqual(rules[1]!.id);
    expect(startSpy.mock.calls[0]![1]).toMatchObject({
      projectId: PROJECT,
      userNotificationEventType: UserNotificationEventType.TestPage,
      onCallPolicyExecutionLogId: RUN,
      onCallPolicyId: POLICY,
    });
    expect(startSpy.mock.calls[0]![1].triggeredByIncidentId).toBeUndefined();
    expect(startSpy.mock.calls[0]![1].triggeredByAlertId).toBeUndefined();
  });

  test("a level whose own wait is shorter keeps it", async () => {
    const run: OnCallDutyPolicyExecutionLog = testRun({
      walksEscalation: true,
      levelWaitInMinutes: 1,
    });

    expect(OnCallTestPageRuns.getTestWait(run)).toEqual({
      lastEscalationRuleExecutedAt: STARTED,
      createdAt: STARTED,
      executeNextEscalationRuleInMinutes: 1,
    });
    expect(
      await OnCallTestPageRuns.tick({ run: run, now: at(1) }),
    ).toBe(OnCallTestPageTick.MovedOn);
  });

  test("the wait is cut to two minutes, from when the level started", () => {
    expect(
      OnCallTestPageRuns.getTestWait(
        testRun({
          walksEscalation: true,
          levelStartedAt: at(4),
          levelWaitInMinutes: 45,
        }),
      ),
    ).toEqual({
      lastEscalationRuleExecutedAt: at(4),
      createdAt: STARTED,
      executeNextEscalationRuleInMinutes: 2,
    });
  });

  test("moving on is claimed as for any run, from the time the level was read with", async () => {
    await OnCallTestPageRuns.tick({
      run: testRun({ walksEscalation: true, levelStartedAt: at(4) }),
      now: at(7),
    });

    expect(claimSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy.mock.calls[0]![0].executionLogId).toEqual(RUN);
    expect(claimSpy.mock.calls[0]![0].previousLastEscalationRuleExecutedAt).toEqual(
      at(4),
    );
  });
});

describe("a test that walked every level ends after the last, and is never repeated", () => {
  test("its policy's Repeat Policy does not start it again", async () => {
    lines = [line(ANA, OnCallDutyExecutionLogTimelineStatus.NotificationSent)];

    const result: OnCallEscalationAdvanceResult =
      await OnCallEscalationAdvance.advance({
        run: testRun({ walksEscalation: true, levelOrder: 3, repeats: 3 }),
        now: at(6),
      });

    expect(startSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: OnCallEscalationAdvanceKind.Ended,
      pagedUserIds: [],
      endedWithStatus: OnCallDutyPolicyStatus.Completed,
      endedWithMessage: ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE,
    });

    // No write starts the policy again.
    for (const call of updateSpy.mock.calls) {
      expect(
        (call[0].data as Record<string, unknown>)[
          "onCallPolicyExecutionRepeatCount"
        ],
      ).toBeUndefined();
    }
  });

  test("a real run of the same policy still repeats (regression)", async () => {
    const run: OnCallDutyPolicyExecutionLog = testRun({
      levelOrder: 3,
      repeats: 3,
    });
    run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    run.triggeredByIncidentId = new ObjectID(
      "7e570000-0000-4000-8000-000000000009",
    );

    const result: OnCallEscalationAdvanceResult =
      await OnCallEscalationAdvance.advance({ run: run, now: at(6) });

    expect(result.kind).toBe(OnCallEscalationAdvanceKind.PolicyStartedAgain);
  });

  test("how many repeats a run has: none for a test, its policy's for a real run", () => {
    expect(
      OnCallEscalationAdvance.getRepeatsAllowed(testRun({ repeats: 5 })),
    ).toBe(0);

    const real: OnCallDutyPolicyExecutionLog = testRun({ repeats: 5 });
    real.userNotificationEventType = UserNotificationEventType.AlertCreated;

    expect(OnCallEscalationAdvance.getRepeatsAllowed(real)).toBe(5);
  });

  test("a real run that went through every rule keeps its words", async () => {
    lines = [line(ANA, OnCallDutyExecutionLogTimelineStatus.NotificationSent)];

    const run: OnCallDutyPolicyExecutionLog = testRun({ levelOrder: 3 });
    run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    run.triggeredByIncidentId = new ObjectID(
      "7e570000-0000-4000-8000-000000000009",
    );

    const result: OnCallEscalationAdvanceResult =
      await OnCallEscalationAdvance.advance({ run: run, now: at(6) });

    expect(result.endedWithMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
  });

  test("a test that reached nobody at all says so, as any run does", async () => {
    const result: OnCallEscalationAdvanceResult =
      await OnCallEscalationAdvance.advance({
        run: testRun({ walksEscalation: true, levelOrder: 3 }),
        now: at(6),
      });

    expect(result.endedWithStatus).toBe(
      OnCallDutyPolicyStatus.CompletedWithNoNotifications,
    );
    expect(result.endedWithMessage).toBe(
      ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
    );
  });
});

describe("a test page is acknowledged, never passed on", () => {
  test("passing it on is refused as over, and nobody else is paged", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(testRun({ walksEscalation: true }) as never);
    const logsRead: SpyInstance<typeof UserOnCallLogService.findBy> = jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockResolvedValue([] as never);

    const answer: unknown = await OnCallPagePassOn.passOn({
      userId: ANA,
      executionLogId: RUN,
    });

    expect(answer).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.PageOver,
    });
    expect(logsRead).not.toHaveBeenCalled();
    expect(claimSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });
});
