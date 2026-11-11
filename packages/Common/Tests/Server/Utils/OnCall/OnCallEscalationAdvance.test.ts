import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyEscalationRuleService, {
  OnCallNotPagedReason,
  OnCallPagingOutcome,
  OnCallRuleExecutionOutcome,
  Service as OnCallDutyPolicyEscalationRuleServiceClass,
} from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import OnCallPageTiming from "../../../../Server/Utils/OnCall/OnCallPageTiming";
import OnCallSendLag, {
  OnCallScheduledSend,
} from "../../../../Server/Utils/OnCall/OnCallSendLag";
import Telemetry from "../../../../Server/Utils/Telemetry";
import {
  NotificationSchedule,
  OnCallPageStart,
} from "../../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import OnCallEscalationAdvance, {
  ON_CALL_POLICY_RUN_MOVE_ON_FAILED_MESSAGE,
  ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  OnCallEscalationAdvanceKind,
  OnCallEscalationAdvanceResult,
} from "../../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
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
 * MOVING A RUN ON: THE ONE WAY, FOR THE WORKER AND FOR A PAGE PASSED ON.
 *
 * OnCallEscalationAdvance is what the worker does once a rule's wait has run
 * out, and what passing a page on does at once. These pin each branch with
 * the services it calls stubbed: the claim first, the rule after, the
 * policy starting again, the run ending - and, new, the people who passed
 * the page on handed to every rule it starts, and a rule they alone were on
 * passed at once.
 */

const PROJECT: ObjectID = new ObjectID("0f700000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("0f700000-0000-4000-8000-000000000002");
const RUN: ObjectID = new ObjectID("0f700000-0000-4000-8000-000000000003");
const INCIDENT: ObjectID = new ObjectID("0f700000-0000-4000-8000-000000000004");
const ANA: ObjectID = new ObjectID("0f700000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("0f700000-0000-4000-8000-0000000000b1");

const STARTED: Date = new Date("2026-10-16T03:00:00.000Z");
const NOW: Date = new Date("2026-10-16T03:30:00.000Z");

function ruleOf(order: number): OnCallDutyPolicyEscalationRule {
  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = new ObjectID(`0f700000-0000-4000-8000-00000000010${order}`);
  rule.order = order;
  rule.name = `Level ${order}`;
  return rule;
}

function runOn(
  order: number,
  settings: { pass?: number; repeats?: number } = {},
): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = RUN;
  run.projectId = PROJECT;
  run.onCallDutyPolicyId = POLICY;
  run.triggeredByIncidentId = INCIDENT;
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  run.status = OnCallDutyPolicyStatus.Executing;
  run.lastExecutedEscalationRuleOrder = order;
  run.lastEscalationRuleExecutedAt = STARTED;
  run.onCallPolicyExecutionRepeatCount = settings.pass || 1;
  run.onCallDutyPolicy = {
    repeatPolicyIfNoOneAcknowledges: Boolean(settings.repeats),
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: settings.repeats || 0,
  } as never;
  return run;
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
let claimSpy: SpyInstance<
  typeof OnCallDutyPolicyExecutionLogService.claimEscalationAdvance
>;
let startSpy: SpyInstance<
  typeof OnCallDutyPolicyEscalationRuleService.startRuleExecution
>;
let updateSpy: SpyInstance<
  typeof OnCallDutyPolicyExecutionLogService.updateOneById
>;
let errors: Array<string>;

beforeEach(() => {
  rules = [ruleOf(1), ruleOf(2), ruleOf(3)];
  lines = [];
  errors = [];

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
      lastEscalationRuleExecutedAt: NOW,
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
      // The passers read asks for "Passed On" lines only.
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
  jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
    errors.push(String(message));
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function advance(
  run: OnCallDutyPolicyExecutionLog,
): Promise<OnCallEscalationAdvanceResult> {
  return await OnCallEscalationAdvance.advance({ run: run, now: NOW });
}

describe("the claim", () => {
  test("comes first, comparing the time the run was read with", async () => {
    await advance(runOn(1));

    expect(claimSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy.mock.calls[0]![0]).toEqual({
      executionLogId: RUN,
      previousLastEscalationRuleExecutedAt: STARTED,
      newLastEscalationRuleExecutedAt: NOW,
    });
  });

  test("lost, nothing happens: no rule is paged, nothing is written", async () => {
    claimSpy.mockResolvedValue(false);

    const result: OnCallEscalationAdvanceResult = await advance(runOn(1));

    expect(result).toEqual({
      kind: OnCallEscalationAdvanceKind.NotClaimed,
      pagedUserIds: [],
    });
    expect(startSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a run that never started a rule claims from 'never'", async () => {
    const run: OnCallDutyPolicyExecutionLog = runOn(0);
    run.lastEscalationRuleExecutedAt = undefined as never;

    await advance(run);

    expect(
      claimSpy.mock.calls[0]![0].previousLastEscalationRuleExecutedAt,
    ).toBe(null);
  });
});

describe("the time a claim writes", () => {
  test("is now, when now is later than the time read", () => {
    expect(
      OnCallEscalationAdvance.getClaimTime({ previous: STARTED, now: NOW }),
    ).toEqual(NOW);
  });

  test("is a moment after the time read, when now is not later: two claims in one millisecond", () => {
    expect(
      OnCallEscalationAdvance.getClaimTime({ previous: NOW, now: NOW }),
    ).toEqual(new Date(NOW.getTime() + 1));
  });

  test("is a moment after the time read for a clock that runs behind", () => {
    expect(
      OnCallEscalationAdvance.getClaimTime({ previous: NOW, now: STARTED }),
    ).toEqual(new Date(NOW.getTime() + 1));
  });

  test("is now with no time read", () => {
    expect(
      OnCallEscalationAdvance.getClaimTime({ previous: null, now: NOW }),
    ).toEqual(NOW);
    expect(
      OnCallEscalationAdvance.getClaimTime({ previous: undefined, now: NOW }),
    ).toEqual(NOW);
  });
});

describe("the next rule", () => {
  test("is started, and what it paged is the answer", async () => {
    const result: OnCallEscalationAdvanceResult = await advance(runOn(1));

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy.mock.calls[0]![0]).toEqual(rules[1]!.id);
    expect(result).toEqual({
      kind: OnCallEscalationAdvanceKind.RuleStarted,
      rule: { id: rules[1]!.id, order: 2, name: "Level 2" },
      pagedUserIds: [BOB],
    });
  });

  test("is started for the run's record, under its policy", async () => {
    await advance(runOn(1));

    expect(startSpy.mock.calls[0]![1]).toMatchObject({
      projectId: PROJECT,
      triggeredByIncidentId: INCIDENT,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: RUN,
      onCallPolicyId: POLICY,
    });
  });

  test("is handed the people who passed the run's page on, once each", async () => {
    lines = [
      line(ANA, OnCallDutyExecutionLogTimelineStatus.PassedOn),
      line(ANA, OnCallDutyExecutionLogTimelineStatus.PassedOn),
      line(BOB, OnCallDutyExecutionLogTimelineStatus.NotificationSent),
    ];

    await advance(runOn(1));

    expect(startSpy.mock.calls[0]![1].passedOnUserIds).toEqual([ANA]);
  });

  test("is handed nobody when who passed it on cannot be read: a page beats no page", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockRejectedValue(new Error("connection reset") as never);

    await advance(runOn(1));

    expect(startSpy.mock.calls[0]![1].passedOnUserIds).toEqual([]);
    expect(errors.join("\n")).toContain(
      "paging its next rule as if nobody had",
    );
  });

  test("a stubbed rule start that says nothing is a rule that paged: the run stays on it", async () => {
    startSpy.mockResolvedValue(undefined as never);

    const result: OnCallEscalationAdvanceResult = await advance(runOn(1));

    expect(result.kind).toBe(OnCallEscalationAdvanceKind.RuleStarted);
    expect(result.pagedUserIds).toEqual([]);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });
});

describe("a rule that only people who passed it on were on", () => {
  test("is passed at once: the run goes on to the rule after, claimed again", async () => {
    startSpy
      .mockResolvedValueOnce(outcome({ movesOnAtOnce: true }))
      .mockResolvedValueOnce(
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

    const result: OnCallEscalationAdvanceResult = await advance(runOn(1));

    expect(
      startSpy.mock.calls.map((call: Array<unknown>) => {
        return String(call[0]);
      }),
    ).toEqual([rules[1]!.id!.toString(), rules[2]!.id!.toString()]);
    expect(result.rule?.order).toBe(3);
    expect(claimSpy).toHaveBeenCalledTimes(2);
    // The second claim compares the time the run moved on to the second rule.
    expect(
      claimSpy.mock.calls[1]![0].previousLastEscalationRuleExecutedAt,
    ).toEqual(NOW);
  });

  test("is left on when the claim to pass it is lost: somebody else moved the run on", async () => {
    startSpy.mockResolvedValueOnce(outcome({ movesOnAtOnce: true }));
    claimSpy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result: OnCallEscalationAdvanceResult = await advance(runOn(1));

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(result.rule?.order).toBe(2);
  });

  test("is left on when the run ended in the meantime", async () => {
    startSpy.mockResolvedValueOnce(outcome({ movesOnAtOnce: true }));
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue({
        status: OnCallDutyPolicyStatus.Completed,
      } as never);

    await advance(runOn(1));

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy).toHaveBeenCalledTimes(1);
  });

  test("a loop of them stops: a guard, not a limit anybody meets", async () => {
    // Every rule, for ever, pages nobody but people who passed it on.
    startSpy.mockResolvedValue(outcome({ movesOnAtOnce: true }));
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(rules[1]! as never);

    const result: OnCallEscalationAdvanceResult = await advance(runOn(1));

    expect(startSpy).toHaveBeenCalledTimes(200);
    expect(result.kind).toBe(OnCallEscalationAdvanceKind.RuleStarted);
    expect(errors.join("\n")).toContain("moved past 200 escalation rules");
  });
});

describe("after the last rule", () => {
  test("the policy starts again from rule 1 while it has repeats left", async () => {
    const result: OnCallEscalationAdvanceResult = await advance(
      runOn(3, { pass: 1, repeats: 2 }),
    );

    expect(updateSpy.mock.calls[0]![0]).toMatchObject({
      id: RUN,
      data: { onCallPolicyExecutionRepeatCount: 2 },
    });
    expect(startSpy.mock.calls[0]![0]).toEqual(rules[0]!.id);
    expect(result.kind).toBe(OnCallEscalationAdvanceKind.PolicyStartedAgain);
    expect(result.rule?.order).toBe(1);
  });

  test("its last repeat ends the run, nobody having acknowledged", async () => {
    lines = [line(ANA, OnCallDutyExecutionLogTimelineStatus.NotificationSent)];

    const result: OnCallEscalationAdvanceResult = await advance(
      runOn(3, { pass: 3, repeats: 2 }),
    );

    expect(startSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: OnCallEscalationAdvanceKind.Ended,
      pagedUserIds: [],
      endedWithStatus: OnCallDutyPolicyStatus.Completed,
      endedWithMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    });
    expect(updateSpy.mock.calls[0]![0].data).toEqual({
      status: OnCallDutyPolicyStatus.Completed,
      statusMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    });
  });

  test("a run that notified nobody at all says so", async () => {
    const result: OnCallEscalationAdvanceResult = await advance(runOn(3));

    expect(result.endedWithStatus).toBe(
      OnCallDutyPolicyStatus.CompletedWithNoNotifications,
    );
    expect(result.endedWithMessage).toBe(
      ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
    );
  });

  test("a run everybody passed on says nobody could take it", async () => {
    lines = [
      line(ANA, OnCallDutyExecutionLogTimelineStatus.PassedOn),
      line(BOB, OnCallDutyExecutionLogTimelineStatus.PassedOn),
      line(ANA, OnCallDutyExecutionLogTimelineStatus.Skipped),
    ];

    const result: OnCallEscalationAdvanceResult = await advance(runOn(3));

    expect(result.endedWithMessage).toBe(
      ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
    );
  });

  test("a run somebody it paged never answered ends as one nobody acknowledged", async () => {
    lines = [
      line(ANA, OnCallDutyExecutionLogTimelineStatus.PassedOn),
      line(BOB, OnCallDutyExecutionLogTimelineStatus.NotificationSent),
    ];

    expect((await advance(runOn(3))).endedWithMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
  });

  test("a policy whose first rule is gone ends rather than repeating nothing", async () => {
    rules = [ruleOf(2), ruleOf(3)];

    const result: OnCallEscalationAdvanceResult = await advance(
      runOn(3, { pass: 1, repeats: 1 }),
    );

    expect(result.kind).toBe(OnCallEscalationAdvanceKind.Ended);
    expect(result.endedWithMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
  });

  test("a repeat whose first rule only passers were on goes straight on to rule 2", async () => {
    startSpy
      .mockResolvedValueOnce(outcome({ movesOnAtOnce: true }))
      .mockResolvedValueOnce(outcome({}));

    const result: OnCallEscalationAdvanceResult = await advance(
      runOn(3, { pass: 1, repeats: 1 }),
    );

    expect(
      startSpy.mock.calls.map((call: Array<unknown>) => {
        return String(call[0]);
      }),
    ).toEqual([rules[0]!.id!.toString(), rules[1]!.id!.toString()]);
    expect(result.kind).toBe(OnCallEscalationAdvanceKind.RuleStarted);
  });
});

describe("who was reached, and who passed it on", () => {
  test("everybody reached passed it on", () => {
    expect(
      OnCallEscalationAdvance.isEverybodyReachedPassedOn([
        line(ANA, OnCallDutyExecutionLogTimelineStatus.PassedOn),
        line(BOB, OnCallDutyExecutionLogTimelineStatus.PassedOn),
      ]),
    ).toBe(true);
  });

  test("a person paged twice who passed it on once passed it on", () => {
    expect(
      OnCallEscalationAdvance.isEverybodyReachedPassedOn([
        line(ANA, OnCallDutyExecutionLogTimelineStatus.NotificationSent),
        line(ANA, OnCallDutyExecutionLogTimelineStatus.PassedOn),
      ]),
    ).toBe(true);
  });

  test("somebody reached who did not pass it on", () => {
    expect(
      OnCallEscalationAdvance.isEverybodyReachedPassedOn([
        line(ANA, OnCallDutyExecutionLogTimelineStatus.PassedOn),
        line(BOB, OnCallDutyExecutionLogTimelineStatus.Executing),
      ]),
    ).toBe(false);
  });

  test("skipped and failed lines reached nobody, either way", () => {
    expect(
      OnCallEscalationAdvance.isEverybodyReachedPassedOn([
        line(ANA, OnCallDutyExecutionLogTimelineStatus.PassedOn),
        line(BOB, OnCallDutyExecutionLogTimelineStatus.Skipped),
        line(BOB, OnCallDutyExecutionLogTimelineStatus.Error),
      ]),
    ).toBe(true);
  });

  test("nobody reached at all is not everybody passing it on", () => {
    expect(OnCallEscalationAdvance.isEverybodyReachedPassedOn([])).toBe(false);
    expect(
      OnCallEscalationAdvance.isEverybodyReachedPassedOn([
        line(BOB, OnCallDutyExecutionLogTimelineStatus.Skipped),
      ]),
    ).toBe(false);
  });

  test("ids once each, in order, none missing", () => {
    expect(
      OnCallEscalationAdvance.uniqueIds([
        ANA,
        undefined,
        BOB,
        null,
        new ObjectID(ANA.toString().toUpperCase()),
      ]),
    ).toEqual([ANA, BOB]);
  });
});

describe("whether every target of a rule passed it on - the rule then says nothing of itself", () => {
  const passer: OnCallPagingOutcome["notPaged"][number] = {
    reason: OnCallNotPagedReason.PassedOn,
    userId: ANA,
    teamId: null,
    scheduleId: null,
    awayUntil: null,
  };
  const away: OnCallPagingOutcome["notPaged"][number] = {
    ...passer,
    reason: OnCallNotPagedReason.Away,
    userId: BOB,
  };

  test("only people who passed it on: yes", () => {
    expect(
      OnCallDutyPolicyEscalationRuleServiceClass.isEveryTargetPassedOn({
        paged: [],
        notPaged: [passer],
        hadScheduleGap: false,
      }),
    ).toBe(true);
  });

  test("a passer and somebody away: no - the level's own line says it paged nobody", () => {
    expect(
      OnCallDutyPolicyEscalationRuleServiceClass.isEveryTargetPassedOn({
        paged: [],
        notPaged: [passer, away],
        hadScheduleGap: false,
      }),
    ).toBe(false);
  });

  test("somebody paged: no", () => {
    expect(
      OnCallDutyPolicyEscalationRuleServiceClass.isEveryTargetPassedOn({
        paged: [
          {
            userId: BOB,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
        ],
        notPaged: [passer],
        hadScheduleGap: false,
      }),
    ).toBe(false);
  });

  test("nobody named at all: no", () => {
    expect(
      OnCallDutyPolicyEscalationRuleServiceClass.isEveryTargetPassedOn({
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
      }),
    ).toBe(false);
  });
});

/*
 * A PASS THAT REACHED NOBODY IS NOT GONE ROUND AGAIN. Every rule started
 * here and moved past reached nobody; whether the rule the run was on did
 * is the caller's to say (isCurrentRuleEmpty).
 */
describe("a pass that reached nobody", () => {
  const empty: OnCallRuleExecutionOutcome = outcome({ movesOnAtOnce: true });
  const pagedBob: OnCallRuleExecutionOutcome = outcome({
    paged: [
      {
        userId: BOB,
        coveringForUserId: null,
        teamId: null,
        scheduleId: null,
      },
    ],
  });

  function startedOrders(): Array<number> {
    return startSpy.mock.calls.map((call: Array<unknown>): number => {
      return rules.find((rule: OnCallDutyPolicyEscalationRule) => {
        return rule.id!.toString() === String(call[0]);
      })!.order!;
    });
  }

  function repeatWrites(): Array<unknown> {
    return updateSpy.mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as { data: Record<string, unknown> }).data[
          "onCallPolicyExecutionRepeatCount"
        ];
      })
      .filter((value: unknown): boolean => {
        return value !== undefined;
      });
  }

  test("is not repeated: a run that moved on at once from its first level, with every level empty, ends after the last - repeats or not", async () => {
    startSpy.mockResolvedValue(empty);

    const result: OnCallEscalationAdvanceResult =
      await OnCallEscalationAdvance.advance({
        run: runOn(1, { pass: 1, repeats: 2 }),
        now: NOW,
        isCurrentRuleEmpty: true,
      });

    expect(startedOrders()).toEqual([2, 3]);
    expect(repeatWrites()).toEqual([]);
    expect(result).toEqual({
      kind: OnCallEscalationAdvanceKind.Ended,
      pagedUserIds: [],
      endedWithStatus: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      endedWithMessage: ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
    });
  });

  test("a repeat whose every level is empty ends the run after one round, not after every repeat", async () => {
    // Bob was reached on rule 3, whose wait ran out; then nobody is on call.
    lines = [line(BOB, OnCallDutyExecutionLogTimelineStatus.NotificationSent)];
    startSpy.mockResolvedValue(empty);

    const result: OnCallEscalationAdvanceResult = await advance(
      runOn(3, { pass: 1, repeats: 3 }),
    );

    expect(startedOrders()).toEqual([1, 2, 3]);
    expect(repeatWrites()).toEqual([2]);
    expect(result.kind).toBe(OnCallEscalationAdvanceKind.Ended);
    // Bob was paged, earlier in the run: nobody acknowledged.
    expect(result.endedWithStatus).toBe(OnCallDutyPolicyStatus.Completed);
    expect(result.endedWithMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
  });

  test("a pass whose level the run is on reached somebody is repeated, though every other level of it is empty", async () => {
    startSpy
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(pagedBob);

    const result: OnCallEscalationAdvanceResult = await advance(
      runOn(1, { pass: 1, repeats: 1 }),
    );

    expect(startedOrders()).toEqual([2, 3, 1]);
    expect(repeatWrites()).toEqual([2]);
    expect(result.kind).toBe(OnCallEscalationAdvanceKind.PolicyStartedAgain);
    expect(result.rule?.order).toBe(1);
    expect(result.pagedUserIds).toEqual([BOB]);
  });

  test("a run that moved on at once from a later level - a page again starts there - may repeat, to reach the levels before it", async () => {
    startSpy.mockResolvedValueOnce(empty).mockResolvedValueOnce(pagedBob);

    const result: OnCallEscalationAdvanceResult =
      await OnCallEscalationAdvance.advance({
        run: runOn(2, { pass: 1, repeats: 1 }),
        now: NOW,
        isCurrentRuleEmpty: true,
      });

    expect(startedOrders()).toEqual([3, 1]);
    expect(result.kind).toBe(OnCallEscalationAdvanceKind.PolicyStartedAgain);
    expect(result.pagedUserIds).toEqual([BOB]);
  });

  test("...and that repeat, all of it empty, ends the run", async () => {
    startSpy.mockResolvedValue(empty);

    const result: OnCallEscalationAdvanceResult =
      await OnCallEscalationAdvance.advance({
        run: runOn(2, { pass: 1, repeats: 5 }),
        now: NOW,
        isCurrentRuleEmpty: true,
      });

    expect(startedOrders()).toEqual([3, 1, 2, 3]);
    expect(repeatWrites()).toEqual([2]);
    expect(result.endedWithStatus).toBe(
      OnCallDutyPolicyStatus.CompletedWithNoNotifications,
    );
  });

  test("a level that reached somebody in the middle of the pass holds the run there, as every level did", async () => {
    startSpy.mockResolvedValueOnce(pagedBob);

    const result: OnCallEscalationAdvanceResult =
      await OnCallEscalationAdvance.advance({
        run: runOn(1, { pass: 1, repeats: 1 }),
        now: NOW,
        isCurrentRuleEmpty: true,
      });

    expect(startedOrders()).toEqual([2]);
    expect(result).toEqual({
      kind: OnCallEscalationAdvanceKind.RuleStarted,
      rule: { id: rules[1]!.id, order: 2, name: "Level 2" },
      pagedUserIds: [BOB],
    });
  });
});

describe("moving on at once from the rule a run starts with", () => {
  function storedRun(
    status: OnCallDutyPolicyStatus = OnCallDutyPolicyStatus.Executing,
  ): OnCallDutyPolicyExecutionLog {
    const run: OnCallDutyPolicyExecutionLog = runOn(1, {
      pass: 1,
      repeats: 1,
    });
    run.status = status;
    run.lastEscalationRuleExecutedAt = NOW;
    return run;
  }

  test("reads the run again and moves it on from that rule, claiming from what starting the rule wrote", async () => {
    const findSpy: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.findOneById
    > = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(storedRun() as never);

    const result: OnCallEscalationAdvanceResult | null =
      await OnCallEscalationAdvance.moveOnAtOnce({ runId: RUN });

    expect(findSpy.mock.calls[0]![0]).toMatchObject({
      id: RUN,
      props: { isRoot: true },
    });
    // Everything the worker reads of a run, to move it on.
    expect(findSpy.mock.calls[0]![0].select).toMatchObject({
      lastEscalationRuleExecutedAt: true,
      lastExecutedEscalationRuleOrder: true,
      onCallPolicyExecutionRepeatCount: true,
      userNotificationEventType: true,
      triggeredByIncidentId: true,
      triggeredByAlertId: true,
      triggeredByAlertEpisodeId: true,
      triggeredByIncidentEpisodeId: true,
      onCallDutyPolicy: {
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
      },
    });
    expect(
      claimSpy.mock.calls[0]![0].previousLastEscalationRuleExecutedAt,
    ).toEqual(NOW);
    expect(startSpy.mock.calls[0]![0]).toEqual(rules[1]!.id);
    expect(result?.kind).toBe(OnCallEscalationAdvanceKind.RuleStarted);
  });

  test("it moves on as from a rule that reached nobody: with every level empty, the run ends without repeating", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(storedRun() as never);
    startSpy.mockResolvedValue(outcome({ movesOnAtOnce: true }));

    const result: OnCallEscalationAdvanceResult | null =
      await OnCallEscalationAdvance.moveOnAtOnce({ runId: RUN });

    expect(startSpy).toHaveBeenCalledTimes(2);
    expect(result?.endedWithStatus).toBe(
      OnCallDutyPolicyStatus.CompletedWithNoNotifications,
    );
  });

  test.each([
    OnCallDutyPolicyStatus.Completed,
    OnCallDutyPolicyStatus.CompletedWithNoNotifications,
    OnCallDutyPolicyStatus.Error,
    OnCallDutyPolicyStatus.Started,
  ])(
    "a run that is %s is left as it is",
    async (status: OnCallDutyPolicyStatus) => {
      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
        .mockResolvedValue(storedRun(status) as never);

      expect(
        await OnCallEscalationAdvance.moveOnAtOnce({ runId: RUN }),
      ).toBeNull();
      expect(claimSpy).not.toHaveBeenCalled();
      expect(startSpy).not.toHaveBeenCalled();
    },
  );

  test("a run that is gone is left", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(null as never);

    expect(
      await OnCallEscalationAdvance.moveOnAtOnce({ runId: RUN }),
    ).toBeNull();
    expect(startSpy).not.toHaveBeenCalled();
  });

  test("a move that fails ends the run with an error that says why - and never throws", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(storedRun() as never);
    startSpy.mockImplementation((async () => {
      throw new Error("The SMS provider is down.");
    }) as never);

    expect(
      await OnCallEscalationAdvance.moveOnAtOnce({ runId: RUN }),
    ).toBeNull();

    expect(updateSpy).toHaveBeenLastCalledWith({
      id: RUN,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage: "The SMS provider is down.",
      },
      props: { isRoot: true },
    });
    expect(errors.join("\n")).toContain(
      "on at once from a rule that paged nobody",
    );
  });

  test("an error with no words of its own ends the run in the worker's words", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockImplementation((async () => {
        throw new Error("");
      }) as never);

    await OnCallEscalationAdvance.moveOnAtOnce({ runId: RUN });

    expect(updateSpy.mock.calls[0]![0].data).toEqual({
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: ON_CALL_POLICY_RUN_MOVE_ON_FAILED_MESSAGE,
    });
    expect(ON_CALL_POLICY_RUN_MOVE_ON_FAILED_MESSAGE).toBe(
      "Error occurred while executing the on-call policy.",
    );
  });

  test("when even saying so fails, it is logged and still does not throw", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockImplementation((async () => {
        throw new Error("connection reset");
      }) as never);
    updateSpy.mockImplementation((async () => {
      throw new Error("still down");
    }) as never);

    await expect(
      OnCallEscalationAdvance.moveOnAtOnce({ runId: RUN }),
    ).resolves.toBeNull();
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("how a run that went through every rule ends", () => {
  test.each([
    [OnCallDutyExecutionLogTimelineStatus.Skipped],
    [OnCallDutyExecutionLogTimelineStatus.Error],
  ])(
    "a person whose line says %s was not notified: with nobody else, the run paged nobody",
    async (status: OnCallDutyExecutionLogTimelineStatus) => {
      lines = [line(ANA, status), line(BOB, status)];

      const result: OnCallEscalationAdvanceResult = await advance(runOn(3));

      expect(result.endedWithStatus).toBe(
        OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      );
      expect(result.endedWithMessage).toBe(
        ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
      );
    },
  );

  test.each([
    [OnCallDutyExecutionLogTimelineStatus.NotificationSent],
    [OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged],
    [OnCallDutyExecutionLogTimelineStatus.Executing],
    [OnCallDutyExecutionLogTimelineStatus.Started],
  ])(
    "a page that went out - %s - notified somebody: nobody acknowledged",
    async (status: OnCallDutyExecutionLogTimelineStatus) => {
      lines = [
        line(ANA, OnCallDutyExecutionLogTimelineStatus.Skipped),
        line(BOB, status),
      ];

      const result: OnCallEscalationAdvanceResult = await advance(runOn(3));

      expect(result.endedWithStatus).toBe(OnCallDutyPolicyStatus.Completed);
      expect(result.endedWithMessage).toBe(
        ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      );
    },
  );

  test("a run that paged nobody says who can put it right: the policy's owners", () => {
    expect(ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE).toBe(
      "Execution completed, but no one was notified: no escalation rule of this policy had anybody to page. This policy's owners should add responders to its escalation rules, or check who is on call in its schedules.",
    );
  });

  test("the people it reads are a run's lines about a person, at most a project's worth", async () => {
    const findSpy: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogTimelineService.findBy
    > = jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockResolvedValue([] as never);

    await advance(runOn(3));

    const read: Record<string, unknown> = findSpy.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { select?: Record<string, unknown> }).select?.[
            "status"
          ] === true
        );
      },
    )![0] as unknown as Record<string, unknown>;

    expect(
      (read["query"] as Record<string, unknown>)[
        "onCallDutyPolicyExecutionLogId"
      ],
    ).toEqual(RUN);
    expect(read["select"]).toEqual({
      alertSentToUserId: true,
      status: true,
    });
    expect(read["limit"]).toBe(LIMIT_PER_PROJECT);
  });
});

/*
 * WHAT A MOVE ON PAGES IS TIMED FROM WHEN IT WAS DUE (OnCallSendLag,
 * notification.send.lag, issue #6646): each rule a move on starts writes
 * its notifications inside a scheduled send - due when the wait ran out,
 * for the worker's; now, for a person passing the page on - as an
 * escalation, and from the moment the policy starts again, as a policy
 * repeat.
 */
describe("what a move on pages, timed from when it was due", () => {
  // The rule's wait ran out at 03:15; the worker got to it at 03:30.
  const WAIT_RAN_OUT: Date = new Date("2026-10-16T03:15:00.000Z");

  const PAGED_BOB: OnCallRuleExecutionOutcome = outcome({
    paged: [
      { userId: BOB, coveringForUserId: null, teamId: null, scheduleId: null },
    ],
  });
  const EMPTY: OnCallRuleExecutionOutcome = outcome({ movesOnAtOnce: true });

  // What each rule started was told, in order.
  let seen: Array<OnCallScheduledSend | null>;

  // Each rule started answers the next outcome; the last one for the rest.
  function rulesAnswer(outcomes: Array<OnCallRuleExecutionOutcome>): void {
    let started: number = 0;

    startSpy.mockImplementation((async () => {
      // What a notification the rule writes later in its call is told.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
      seen.push(OnCallSendLag.getScheduledSend());

      const answer: OnCallRuleExecutionOutcome =
        outcomes[Math.min(started, outcomes.length - 1)]!;
      started++;
      return answer;
    }) as never);
  }

  beforeEach(() => {
    seen = [];
    rulesAnswer([PAGED_BOB]);
  });

  test("the worker's: the next level's notifications are due when the wait ran out, as an escalation", async () => {
    await OnCallEscalationAdvance.advance({
      run: runOn(1),
      now: NOW,
      dueAt: WAIT_RAN_OUT,
    });

    expect(seen).toEqual([
      { dueAt: WAIT_RAN_OUT, schedule: NotificationSchedule.Escalation },
    ]);
  });

  test("a person passing the page on - no due moment - is due now", async () => {
    await OnCallEscalationAdvance.advance({ run: runOn(1), now: NOW });

    expect(seen).toEqual([
      { dueAt: NOW, schedule: NotificationSchedule.Escalation },
    ]);
  });

  test("a level the person picked, past the next: due now, as an escalation", async () => {
    // The picked level is read by its id; the levels it skips, all at once.
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockImplementation((async (data: {
        query: { order?: number; _id?: string };
      }) => {
        return (
          rules.find((rule: OnCallDutyPolicyEscalationRule) => {
            return data.query._id
              ? rule.id!.toString() === data.query._id
              : rule.order === data.query.order;
          }) || null
        );
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
      .mockResolvedValue([] as never);

    await OnCallEscalationAdvance.advance({
      run: runOn(1),
      now: NOW,
      toRuleId: rules[2]!.id!,
    });

    expect(startSpy.mock.calls[0]![0]).toEqual(rules[2]!.id);
    expect(seen).toEqual([
      { dueAt: NOW, schedule: NotificationSchedule.Escalation },
    ]);
  });

  test.each([
    ["after now - two servers' clocks apart", new Date(NOW.getTime() + 5_000)],
    ["that is no moment", new Date(NaN)],
  ])("a due moment %s is now", async (_what: string, dueAt: Date) => {
    await OnCallEscalationAdvance.advance({
      run: runOn(1),
      now: NOW,
      dueAt: dueAt,
    });

    expect(seen).toEqual([
      { dueAt: NOW, schedule: NotificationSchedule.Escalation },
    ]);
  });

  test("a level moved past at once is due at the same moment - and so is the level after it", async () => {
    rulesAnswer([EMPTY, PAGED_BOB]);

    await OnCallEscalationAdvance.advance({
      run: runOn(1),
      now: NOW,
      dueAt: WAIT_RAN_OUT,
    });

    expect(seen).toEqual([
      { dueAt: WAIT_RAN_OUT, schedule: NotificationSchedule.Escalation },
      { dueAt: WAIT_RAN_OUT, schedule: NotificationSchedule.Escalation },
    ]);
  });

  test("the policy starting again: its first level is a policy repeat, due when the last level's wait ran out", async () => {
    await OnCallEscalationAdvance.advance({
      run: runOn(3, { pass: 1, repeats: 2 }),
      now: NOW,
      dueAt: WAIT_RAN_OUT,
    });

    expect(startSpy.mock.calls[0]![0]).toEqual(rules[0]!.id);
    expect(seen).toEqual([
      { dueAt: WAIT_RAN_OUT, schedule: NotificationSchedule.PolicyRepeat },
    ]);
  });

  test("a repeat's first level moved past at once: the level after it is part of the policy repeat", async () => {
    rulesAnswer([EMPTY, PAGED_BOB]);

    await OnCallEscalationAdvance.advance({
      run: runOn(3, { pass: 1, repeats: 1 }),
      now: NOW,
      dueAt: WAIT_RAN_OUT,
    });

    expect(seen).toEqual([
      { dueAt: WAIT_RAN_OUT, schedule: NotificationSchedule.PolicyRepeat },
      { dueAt: WAIT_RAN_OUT, schedule: NotificationSchedule.PolicyRepeat },
    ]);
  });

  test("an empty last level, then the policy again: an escalation, then a policy repeat - each kept as it was told", async () => {
    rulesAnswer([EMPTY, PAGED_BOB]);

    await OnCallEscalationAdvance.advance({
      run: runOn(2, { pass: 1, repeats: 1 }),
      now: NOW,
      dueAt: WAIT_RAN_OUT,
    });

    expect(
      startSpy.mock.calls.map((call: Array<unknown>) => {
        return String(call[0]);
      }),
    ).toEqual([rules[2]!.id!.toString(), rules[0]!.id!.toString()]);

    // Read after the advance finished: the last level's send was not changed under it.
    expect(seen).toEqual([
      { dueAt: WAIT_RAN_OUT, schedule: NotificationSchedule.Escalation },
      { dueAt: WAIT_RAN_OUT, schedule: NotificationSchedule.PolicyRepeat },
    ]);
  });

  test("nothing outside the move on is told a send", async () => {
    await OnCallEscalationAdvance.advance({
      run: runOn(1),
      now: NOW,
      dueAt: WAIT_RAN_OUT,
    });

    expect(OnCallSendLag.getScheduledSend()).toBeNull();
  });

  test("a lost claim starts nothing, and tells nothing", async () => {
    claimSpy.mockResolvedValue(false);

    await OnCallEscalationAdvance.advance({
      run: runOn(1),
      now: NOW,
      dueAt: WAIT_RAN_OUT,
    });

    expect(seen).toEqual([]);
  });

  test("a move on inside a page's start - a run starting, its first level empty - keeps no due moment: the page's start times it", async () => {
    jest.spyOn(Telemetry, "isMetricsEnabled").mockReturnValue(true);
    const setString: SpyInstance<typeof GlobalCache.setString> = jest
      .spyOn(GlobalCache, "setString")
      .mockResolvedValue(undefined as never);
    const notificationId: ObjectID = ObjectID.generate();

    startSpy.mockImplementation((async () => {
      await OnCallSendLag.rememberDueTimeOf(notificationId);
      return PAGED_BOB;
    }) as never);

    await OnCallPageTiming.runInPageStart(
      { startedAt: STARTED, start: OnCallPageStart.RecordCreated },
      async (): Promise<void> => {
        await OnCallEscalationAdvance.advance({ run: runOn(1), now: NOW });
      },
    );

    expect(setString).not.toHaveBeenCalled();

    // The same move on outside a page's start keeps one.
    await OnCallEscalationAdvance.advance({ run: runOn(1), now: NOW });

    expect(setString).toHaveBeenCalledTimes(1);
    expect(setString.mock.calls[0]![0]).toBe(OnCallSendLag.CACHE_NAMESPACE);
  });
});

describe("when a move on was due (getDueAt)", () => {
  test("the moment the wait ran out, as a Date of its own", () => {
    const dueAt: Date = new Date(STARTED.getTime());
    const result: Date = OnCallEscalationAdvance.getDueAt({
      dueAt: dueAt,
      now: NOW,
    });

    expect(result).toEqual(STARTED);
    expect(result).not.toBe(dueAt);
  });

  test("no moment: now", () => {
    expect(OnCallEscalationAdvance.getDueAt({ now: NOW })).toEqual(NOW);
    expect(
      OnCallEscalationAdvance.getDueAt({ dueAt: undefined, now: NOW }),
    ).toEqual(NOW);
  });

  test("this very moment: now", () => {
    expect(
      OnCallEscalationAdvance.getDueAt({
        dueAt: new Date(NOW.getTime()),
        now: NOW,
      }),
    ).toEqual(NOW);
  });

  test("a moment after now - a clock ahead - is now: never later", () => {
    expect(
      OnCallEscalationAdvance.getDueAt({
        dueAt: new Date(NOW.getTime() + 1),
        now: NOW,
      }),
    ).toEqual(NOW);
  });

  test("a moment that is no moment is now", () => {
    expect(
      OnCallEscalationAdvance.getDueAt({ dueAt: new Date(NaN), now: NOW }),
    ).toEqual(NOW);
  });
});
