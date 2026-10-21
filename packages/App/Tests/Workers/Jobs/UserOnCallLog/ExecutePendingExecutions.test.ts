import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import BadDataException from "Common/Types/Exception/BadDataException";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import {
  getRepeatClaimKey,
  MAX_NOTIFICATION_REPEATS,
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
} from "Common/Types/NotificationRule/NotificationRepeat";
import UserOnCallLogService, {
  NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
} from "Common/Server/Services/UserOnCallLogService";
import UserNotificationRuleService, {
  ExecuteNotificationRuleOptions,
} from "Common/Server/Services/UserNotificationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import logger from "Common/Server/Utils/Logger";
import ProjectMembership, {
  ProjectUserPair,
} from "Common/Server/Utils/TeamMember/ProjectMembership";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * ExecutePendingExecutions runs EVERY_MINUTE and, for each UserOnCallLog still
 * in `Executing`, fires the user's due escalation notification rules. Audit H3:
 * `Error` is a TERMINAL status — no worker re-selects an Error log
 * (ExecutePendingExecutions queries `Executing`, TimeoutStuckExecutions queries
 * `Started`). The old catch marked EVERY failure `Error`, so one transient DB
 * blip (connection reset / pool timeout) during a single tick permanently
 * dropped a user's not-yet-fired escalation steps — including the last-resort
 * "call at N minutes" page.
 *
 * The fix only marks `Error` when the caught error `instanceof
 * BadDataException` (a PERMANENT bad/missing-data failure a retry cannot fix).
 * For any other (transient/unknown) error it logs and LEAVES the log
 * `Executing`, so the next tick retries. Retries are idempotent — the loop
 * skips rules already in `executedNotificationRules`.
 *
 * These tests import the worker's inner `executePendingNotificationLog`
 * (exported for testability) with the Cron util mocked to a no-op so
 * RunCron does not enqueue anything at import time, then drive:
 *   (1) PERMANENT (BadDataException) => updateOneById called with status Error,
 *   (2) TRANSIENT (generic Error)   => updateOneById NOT called => left
 *       Executing for the next tick to retry,
 *   (3) happy path (no due rules)   => updateOneById called with status
 *       Completed, proving the catch is not triggered on success.
 */

// Mock the worker's Cron util so RunCron is a no-op (no queue side effects).
jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

// Import AFTER the jest.mock above (hoisted by jest) so RunCron is already a no-op.
import { executePendingNotificationLog } from "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";

// The tick itself: what the job registered with RunCron when it was imported.
const runTick: () => Promise<void> = (RunCron as unknown as jest.Mock).mock
  .calls[0]![2] as () => Promise<void>;

const MEMBER: { isProjectMember: boolean } = { isProjectMember: true };

type PendingLog = Parameters<typeof executePendingNotificationLog>[0];

function makePendingLog(
  overrides: Partial<Record<string, unknown>> = {},
): PendingLog {
  /*
   * createdAt a few minutes ago so any due rule (notifyAfterMinutes <= elapsed)
   * would be considered due.
   */
  const createdAt: Date = new Date(Date.now() - 5 * 60 * 1000);

  return {
    id: new ObjectID("log1"),
    _id: "log1",
    projectId: new ObjectID("p1"),
    userId: new ObjectID("u1"),
    createdAt,
    executedNotificationRules: {},
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    ...overrides,
  } as unknown as PendingLog;
}

describe("ExecutePendingExecutions.executePendingNotificationLog", () => {
  beforeEach(() => {
    // Silence the catch-path logger.error noise.
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("PERMANENT failure (BadDataException) => log is marked Error", async () => {
    // First call in the function throws a permanent bad-data error.
    jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockImplementation((): NotificationRuleType => {
        throw new BadDataException("bad");
      });

    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await executePendingNotificationLog(makePendingLog(), MEMBER);

    // The permanent-failure branch marks the log Error.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const callArg: any = updateSpy.mock.calls[0]![0];
    expect(callArg.data.status).toBe(UserNotificationExecutionStatus.Error);
  });

  test("TRANSIENT failure (generic Error) => log is LEFT Executing (no Error mark)", async () => {
    // Same early call, but a transient/unknown error a retry could fix.
    jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockImplementation((): NotificationRuleType => {
        throw new Error("db connection reset");
      });

    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await executePendingNotificationLog(makePendingLog(), MEMBER);

    /*
     * The log must NOT be marked Error (it stays Executing for the next tick).
     * Ideally the catch does not touch updateOneById at all.
     */
    expect(updateSpy).not.toHaveBeenCalled();

    const markedError: boolean = updateSpy.mock.calls.some(
      (call: Array<any>) => {
        return (
          call[0] &&
          call[0].data &&
          call[0].data.status === UserNotificationExecutionStatus.Error
        );
      },
    );
    expect(markedError).toBe(false);
  });

  test("happy path (no due rules) => log is marked Completed (catch not triggered)", async () => {
    // Return a valid rule type so we proceed past the first call.
    jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockReturnValue(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT);

    // Incident exists so the "nothing found" guard does not throw.
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      incidentSeverityId: new ObjectID("sev1"),
    } as never);
    /*
     * Not acknowledged, so we do not short-circuit to the acknowledged-Completed
     * branch and instead reach the notification-rules loop.
     */
    jest
      .spyOn(IncidentService, "isIncidentAcknowledged")
      .mockResolvedValue(false as never);

    // No notification rules => the loop is empty => isAllExecuted stays true.
    jest
      .spyOn(UserNotificationRuleService, "findBy")
      .mockResolvedValue([] as never);

    // Guard against any accidental sibling-entity lookups.
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(null as never);
    jest
      .spyOn(AlertEpisodeService, "findOneById")
      .mockResolvedValue(null as never);
    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockResolvedValue(null as never);

    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await executePendingNotificationLog(
      makePendingLog({ triggeredByIncidentId: new ObjectID("inc1") }),
      MEMBER,
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const callArg: any = updateSpy.mock.calls[0]![0];
    expect(callArg.data.status).toBe(UserNotificationExecutionStatus.Completed);

    // Catch was never entered on the success path.
    expect(logger.error).not.toHaveBeenCalled();
  });
});

/*
 * A log keeps running its later rules for as long as the event is not
 * acknowledged, so the person it pages may leave the project while it runs.
 * Somebody who is no longer a member is not paged again: the log ends with
 * the reason, and the rules still due for them are not run. Membership is
 * read once per tick for every pending log (ProjectMembership).
 */
describe("ExecutePendingExecutions - the person paged left the project", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the log ends with the reason, and no rule of theirs is run", async () => {
    const ruleType: jest.SpyInstance = jest.spyOn(
      UserOnCallLogService,
      "getNotificationRuleType",
    );
    const rules: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "findBy",
    );
    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await executePendingNotificationLog(
      makePendingLog({ triggeredByIncidentId: new ObjectID("inc1") }),
      { isProjectMember: false },
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const callArg: any = updateSpy.mock.calls[0]![0];
    expect(callArg.id.toString()).toBe("log1");
    expect(callArg.data).toEqual({
      status: UserNotificationExecutionStatus.Completed,
      statusMessage: NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
    });
    expect(ruleType).not.toHaveBeenCalled();
    expect(rules).not.toHaveBeenCalled();
  });

  test("one membership read per tick, for every pending log; only members' logs go on", async () => {
    const STAYING: ObjectID = new ObjectID(
      "10000000-0000-4000-8000-000000000001",
    );
    const LEAVING: ObjectID = new ObjectID(
      "20000000-0000-4000-8000-000000000002",
    );
    const PROJECT_1: ObjectID = new ObjectID(
      "aaaaaaaa-0000-4000-8000-000000000001",
    );
    const PROJECT_2: ObjectID = new ObjectID(
      "bbbbbbbb-0000-4000-8000-000000000002",
    );

    const logs: Array<UserOnCallLog> = [
      makePendingLog({
        id: new ObjectID("log-staying"),
        projectId: PROJECT_1,
        userId: STAYING,
      }),
      makePendingLog({
        id: new ObjectID("log-leaving"),
        projectId: PROJECT_1,
        userId: LEAVING,
      }),
      // A member of PROJECT_2 still - membership is per project.
      makePendingLog({
        id: new ObjectID("log-leaving-other-project"),
        projectId: PROJECT_2,
        userId: LEAVING,
      }),
    ] as unknown as Array<UserOnCallLog>;

    jest
      .spyOn(UserOnCallLogService, "findAllBy")
      .mockResolvedValue(logs as never);

    const membershipReads: Array<Array<ProjectUserPair>> = [];

    jest
      .spyOn(ProjectMembership, "getMemberKeys")
      .mockImplementation(
        async (pairs: Array<ProjectUserPair>): Promise<Set<string>> => {
          membershipReads.push(pairs);

          return new Set<string>([
            ProjectMembership.getKey(PROJECT_1, STAYING),
            ProjectMembership.getKey(PROJECT_2, LEAVING),
          ]);
        },
      );

    // Members' logs go on to their rules; stop them there.
    const ruleType: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockImplementation((): NotificationRuleType => {
        throw new Error("stop here");
      });
    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await runTick();

    expect(membershipReads).toHaveLength(1);
    expect(
      membershipReads[0]!.map((pair: ProjectUserPair): string => {
        return ProjectMembership.getKey(pair.projectId, pair.userId);
      }),
    ).toEqual([
      ProjectMembership.getKey(PROJECT_1, STAYING),
      ProjectMembership.getKey(PROJECT_1, LEAVING),
      ProjectMembership.getKey(PROJECT_2, LEAVING),
    ]);

    // The member logs went on to their rules...
    expect(ruleType).toHaveBeenCalledTimes(2);

    // ...the former member's log in PROJECT_1 ended, and only that one.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const callArg: any = updateSpy.mock.calls[0]![0];
    expect(callArg.id.toString()).toBe("log-leaving");
    expect(callArg.data.statusMessage).toBe(
      NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
    );
  });

  test("membership that cannot be read runs every log as before, rather than none", async () => {
    const logs: Array<UserOnCallLog> = [
      makePendingLog({ id: new ObjectID("log-a") }),
      makePendingLog({ id: new ObjectID("log-b") }),
    ] as unknown as Array<UserOnCallLog>;

    jest
      .spyOn(UserOnCallLogService, "findAllBy")
      .mockResolvedValue(logs as never);
    jest
      .spyOn(ProjectMembership, "getMemberKeys")
      .mockRejectedValue(new Error("database unavailable"));

    const ruleType: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockImplementation((): NotificationRuleType => {
        throw new Error("stop here");
      });
    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await runTick();

    // Both logs went on to their rules; neither was ended as a former member's.
    expect(ruleType).toHaveBeenCalledTimes(2);
    expect(
      updateSpy.mock.calls.some((call: Array<any>) => {
        return (
          call[0]?.data?.statusMessage ===
          NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE
        );
      }),
    ).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});

/*
 * Push rules that repeat until acknowledged.
 *
 * A rule may now send its push again every few minutes
 * (UserNotificationRule.repeatEveryMinutes), up to ten times, until the page
 * is acknowledged. The worker is what makes that happen, once a minute: it
 * sends a rule's first push once its delay has passed - as it always did -
 * and then the latest repeat due, each claimed on the log under a key of its
 * own (NotificationRepeat). A rule only counts as executed once it has
 * nothing left to send, so the log stays open while repeats are due and
 * closes the tick after the last one.
 *
 * Driven here minute by minute against one log, with the claim each delivery
 * makes played on the log's executedNotificationRules, as the real one does.
 */
describe("ExecutePendingExecutions - push rules that repeat until acknowledged", () => {
  const NOW: Date = new Date("2026-10-13T09:00:00.000Z");
  const INCIDENT_ID: ObjectID = new ObjectID(
    "c0000000-0000-4000-8000-000000000001",
  );
  const ALERT_ID: ObjectID = new ObjectID(
    "c0000000-0000-4000-8000-000000000002",
  );
  const ALERT_EPISODE_ID: ObjectID = new ObjectID(
    "c0000000-0000-4000-8000-000000000003",
  );
  const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
    "c0000000-0000-4000-8000-000000000004",
  );
  const SEVERITY_ID: ObjectID = new ObjectID(
    "c0000000-0000-4000-8000-000000000005",
  );
  const PUSH_RULE_ID: string = "d0000000-0000-4000-8000-000000000001";
  const SMS_RULE_ID: string = "d0000000-0000-4000-8000-000000000002";
  const FAST_PUSH_RULE_ID: string = "d0000000-0000-4000-8000-000000000003";

  // One delivery the worker handed to executeNotificationRuleItem.
  interface Execution {
    minute: number;
    ruleId: string;
    repeatNumber: number | undefined;
    options: ExecuteNotificationRuleOptions;
  }

  let rules: Array<UserNotificationRule>;
  let claimedKeys: Array<string>;
  let executions: Array<Execution>;
  let currentMinute: number;
  let findRulesSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;

  beforeEach(() => {
    rules = [];
    claimedKeys = [];
    executions = [];
    currentMinute = 0;

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    // The worker's clock: every tick is read against the same now.
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      incidentSeverityId: SEVERITY_ID,
    } as never);
    jest
      .spyOn(IncidentService, "isIncidentAcknowledged")
      .mockResolvedValue(false as never);

    findRulesSpy = jest
      .spyOn(UserNotificationRuleService, "findBy")
      .mockImplementation((): Promise<Array<UserNotificationRule>> => {
        return Promise.resolve(rules);
      }) as unknown as jest.SpyInstance;

    jest
      .spyOn(UserNotificationRuleService, "executeNotificationRuleItem")
      .mockImplementation(
        (
          ruleId: ObjectID,
          options: ExecuteNotificationRuleOptions,
        ): Promise<void> => {
          // The claim each delivery takes on the log, under its own key.
          claimedKeys.push(
            options.repeatNumber && options.repeatNumber > 0
              ? getRepeatClaimKey(ruleId.toString(), options.repeatNumber)
              : ruleId.toString(),
          );

          executions.push({
            minute: currentMinute,
            ruleId: ruleId.toString(),
            repeatNumber: options.repeatNumber,
            options: options,
          });

          return Promise.resolve();
        },
      );

    updateSpy = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Half a minute more than asked: the worker counts whole minutes since the
   * page started, so it has been running exactly `minutes` of them.
   */
  function startedMinutesAgo(minutes: number): Date {
    return new Date(NOW.getTime() - minutes * 60 * 1000 - 30 * 1000);
  }

  // A rule as the worker's read returns it. Any interval, known or not.
  function notificationRule(data: {
    id: string;
    notifyAfterMinutes: number;
    repeatEveryMinutes?: unknown;
  }): UserNotificationRule {
    const rule: UserNotificationRule = new UserNotificationRule();
    rule._id = data.id;
    rule.notifyAfterMinutes = data.notifyAfterMinutes;

    if (data.repeatEveryMinutes !== undefined) {
      (rule as unknown as Record<string, unknown>)["repeatEveryMinutes"] =
        data.repeatEveryMinutes;
    }

    return rule;
  }

  function executedNotificationRules(): JSONObject {
    const executed: JSONObject = {};

    for (const key of claimedKeys) {
      executed[key] = NOW.toISOString();
    }

    return executed;
  }

  // Whether an update in `calls` ended the log.
  function completesLog(calls: Array<Array<any>>): boolean {
    return calls.some((call: Array<any>): boolean => {
      return (
        call[0]?.data?.status === UserNotificationExecutionStatus.Completed
      );
    });
  }

  // One tick of the worker at `minute`; whether it ended the log.
  async function tick(
    minute: number,
    overrides: Partial<Record<string, unknown>> = {},
  ): Promise<boolean> {
    currentMinute = minute;

    const updatesBefore: number = updateSpy.mock.calls.length;

    await executePendingNotificationLog(
      makePendingLog({
        id: new ObjectID("log-repeat"),
        createdAt: startedMinutesAgo(minute),
        executedNotificationRules: executedNotificationRules(),
        triggeredByIncidentId: INCIDENT_ID,
        ...overrides,
      }),
      MEMBER,
    );

    return completesLog(updateSpy.mock.calls.slice(updatesBefore));
  }

  /*
   * The worker every minute from `first`, until the log ends - after which
   * no tick selects it again - or `last`. The minute it ended, or null.
   */
  async function everyMinute(
    first: number,
    last: number,
  ): Promise<number | null> {
    for (let minute: number = first; minute <= last; minute++) {
      if (await tick(minute)) {
        return minute;
      }
    }

    return null;
  }

  // [minute, repeat number] of each delivery of one rule; 0 is the first push.
  function scheduleOf(ruleId: string): Array<[number, number]> {
    return executions
      .filter((execution: Execution): boolean => {
        return execution.ruleId === ruleId;
      })
      .map((execution: Execution): [number, number] => {
        return [execution.minute, execution.repeatNumber || 0];
      });
  }

  function expectedSchedule(data: {
    notifyAfterMinutes: number;
    repeatEveryMinutes: number;
  }): Array<[number, number]> {
    const schedule: Array<[number, number]> = [[data.notifyAfterMinutes, 0]];

    for (
      let repeatNumber: number = 1;
      repeatNumber <= MAX_NOTIFICATION_REPEATS;
      repeatNumber++
    ) {
      schedule.push([
        data.notifyAfterMinutes + repeatNumber * data.repeatEveryMinutes,
        repeatNumber,
      ]);
    }

    return schedule;
  }

  test("the worker reads each rule's interval with the rule", async () => {
    /*
     * Unselected, the interval reads as undefined - "do not repeat" - and
     * every rule set to repeat would quietly send one push.
     */
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];

    await tick(0);

    const select: JSONObject = (
      findRulesSpy.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    expect(select).toEqual({
      _id: true,
      notifyAfterMinutes: true,
      repeatEveryMinutes: true,
    });
  });

  // Every interval the page offers, with and without a delay first.
  const SCHEDULES: Array<[number, number]> =
    REPEAT_EVERY_MINUTES_OPTIONS.flatMap(
      (repeatEveryMinutes: number): Array<[number, number]> => {
        return [0, 5].map((notifyAfterMinutes: number): [number, number] => {
          return [repeatEveryMinutes, notifyAfterMinutes];
        });
      },
    );

  test.each(SCHEDULES)(
    "every %i min after %i min: the first push, ten repeats on time, and the log ends the tick after the last",
    async (repeatEveryMinutes: number, notifyAfterMinutes: number) => {
      rules = [
        notificationRule({
          id: PUSH_RULE_ID,
          notifyAfterMinutes: notifyAfterMinutes,
          repeatEveryMinutes: repeatEveryMinutes,
        }),
      ];

      const tenthAt: number =
        notifyAfterMinutes + MAX_NOTIFICATION_REPEATS * repeatEveryMinutes;

      const endedAt: number | null = await everyMinute(0, tenthAt + 30);

      expect(scheduleOf(PUSH_RULE_ID)).toEqual(
        expectedSchedule({
          notifyAfterMinutes: notifyAfterMinutes,
          repeatEveryMinutes: repeatEveryMinutes,
        }),
      );
      expect(endedAt).toBe(tenthAt + 1);
    },
  );

  test("the first push is handed over exactly as before - with no repeat number at all", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];

    await tick(0);

    expect(executions).toHaveLength(1);
    expect("repeatNumber" in executions[0]!.options).toBe(false);
  });

  test("a repeat is handed over with its number, and everything else the first push had", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];

    await tick(0);
    await tick(5);

    expect(executions).toHaveLength(2);

    const firstPush: ExecuteNotificationRuleOptions = executions[0]!.options;
    const repeat: ExecuteNotificationRuleOptions = executions[1]!.options;

    expect(repeat.repeatNumber).toBe(1);
    expect({ ...repeat, repeatNumber: undefined }).toEqual({
      ...firstPush,
      repeatNumber: undefined,
    });
    expect(repeat.userNotificationLogId.toString()).toBe("log-repeat");
    expect(repeat.triggeredByIncidentId?.toString()).toBe(
      INCIDENT_ID.toString(),
    );
  });

  test("the first push waits for the rule's delay", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 10,
        repeatEveryMinutes: 1,
      }),
    ];

    // Not due yet: nothing sent, and the log stays open for it.
    expect(await tick(9)).toBe(false);
    expect(executions).toEqual([]);
    expect(updateSpy).not.toHaveBeenCalled();

    await tick(10);

    expect(scheduleOf(PUSH_RULE_ID)).toEqual([[10, 0]]);
  });

  test.each([
    ["does not repeat", NO_NOTIFICATION_REPEAT],
    ["was read without the column", undefined],
    ["has an interval this build does not know", 7],
  ])(
    "a rule that %s runs exactly as before: one push at its delay, then the log ends",
    async (_label: string, repeatEveryMinutes: unknown) => {
      rules = [
        notificationRule({
          id: SMS_RULE_ID,
          notifyAfterMinutes: 5,
          repeatEveryMinutes: repeatEveryMinutes,
        }),
      ];

      const endedAt: number | null = await everyMinute(0, 60);

      expect(scheduleOf(SMS_RULE_ID)).toEqual([[5, 0]]);
      expect(endedAt).toBe(6);
      expect("repeatNumber" in executions[0]!.options).toBe(false);
    },
  );

  test("after the tenth repeat nothing more is sent, and the log counts as all executed", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];
    claimedKeys = [PUSH_RULE_ID];

    for (
      let repeatNumber: number = 1;
      repeatNumber <= MAX_NOTIFICATION_REPEATS;
      repeatNumber++
    ) {
      claimedKeys.push(getRepeatClaimKey(PUSH_RULE_ID, repeatNumber));
    }

    // Hours later, a page nobody acknowledged.
    expect(await tick(600)).toBe(true);
    expect(executions).toEqual([]);
  });

  test("the tick that sends the tenth repeat leaves the log open; the next one ends it", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 3,
      }),
    ];
    claimedKeys = [PUSH_RULE_ID];

    for (
      let repeatNumber: number = 1;
      repeatNumber < MAX_NOTIFICATION_REPEATS;
      repeatNumber++
    ) {
      claimedKeys.push(getRepeatClaimKey(PUSH_RULE_ID, repeatNumber));
    }

    expect(await tick(30)).toBe(false);
    expect(scheduleOf(PUSH_RULE_ID)).toEqual([[30, MAX_NOTIFICATION_REPEATS]]);

    expect(await tick(31)).toBe(true);
    expect(executions).toHaveLength(1);
  });

  test("a repeat already claimed, and still the latest due, is not sent again - and the log stays open", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];
    claimedKeys = [
      PUSH_RULE_ID,
      getRepeatClaimKey(PUSH_RULE_ID, 1),
      getRepeatClaimKey(PUSH_RULE_ID, 2),
    ];

    // Repeat 2 went out at minute 10; repeat 3 is not due until 15.
    for (const minute of [11, 12, 13, 14]) {
      expect(await tick(minute)).toBe(false);
    }

    expect(executions).toEqual([]);
    expect(updateSpy).not.toHaveBeenCalled();

    await tick(15);

    expect(scheduleOf(PUSH_RULE_ID)).toEqual([[15, 3]]);
  });

  test("a first push not sent yet goes out before any repeat, however many are due by the clock", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 2,
        repeatEveryMinutes: 5,
      }),
    ];

    // The worker's first look at this page is at minute 17.
    await tick(17);

    expect(scheduleOf(PUSH_RULE_ID)).toEqual([[17, 0]]);

    // The next tick sends the repeat due by the page's clock: the third.
    await tick(18);

    expect(scheduleOf(PUSH_RULE_ID)).toEqual([
      [17, 0],
      [18, 3],
    ]);
  });

  test("a worker that was down sends the latest repeat due, and never the ones it missed", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];

    await everyMinute(0, 2);
    // Down from minute 3 to 36.
    const endedAt: number | null = await everyMinute(37, 120);

    expect(scheduleOf(PUSH_RULE_ID)).toEqual([
      [0, 0],
      [37, 7],
      [40, 8],
      [45, 9],
      [50, 10],
    ]);
    expect(endedAt).toBe(51);
  });

  test("rules that repeat and rules that do not share a log without disturbing each other", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
      // An SMS a few minutes in, as an escalation step: never repeats.
      notificationRule({
        id: SMS_RULE_ID,
        notifyAfterMinutes: 10,
        repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
      }),
      notificationRule({
        id: FAST_PUSH_RULE_ID,
        notifyAfterMinutes: 3,
        repeatEveryMinutes: 1,
      }),
    ];

    const endedAt: number | null = await everyMinute(0, 120);

    expect(scheduleOf(PUSH_RULE_ID)).toEqual(
      expectedSchedule({ notifyAfterMinutes: 0, repeatEveryMinutes: 5 }),
    );
    expect(scheduleOf(SMS_RULE_ID)).toEqual([[10, 0]]);
    expect(scheduleOf(FAST_PUSH_RULE_ID)).toEqual(
      expectedSchedule({ notifyAfterMinutes: 3, repeatEveryMinutes: 1 }),
    );

    // Open until the slowest rule's last repeat has gone out.
    expect(endedAt).toBe(51);

    // Every delivery was claimed once.
    expect(new Set(claimedKeys).size).toBe(claimedKeys.length);
    expect(claimedKeys).toHaveLength(2 * (MAX_NOTIFICATION_REPEATS + 1) + 1);
  });

  test("one rule's repeats on the log say nothing about another rule's", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
      notificationRule({
        id: FAST_PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];
    claimedKeys = [
      PUSH_RULE_ID,
      FAST_PUSH_RULE_ID,
      getRepeatClaimKey(PUSH_RULE_ID, 1),
    ];

    await tick(5);

    expect(
      executions.map((execution: Execution): [string, number] => {
        return [execution.ruleId, execution.repeatNumber || 0];
      }),
    ).toEqual([[FAST_PUSH_RULE_ID, 1]]);
  });

  /*
   * Acknowledging is what ends the repeats: the worker ends the log of an
   * acknowledged incident, alert or episode before it reads a single rule,
   * as it always has.
   */
  const ACKNOWLEDGED: Array<
    [string, () => void, Record<string, unknown>, string]
  > = [
    [
      "incident",
      (): void => {
        jest
          .spyOn(IncidentService, "isIncidentAcknowledged")
          .mockResolvedValue(true as never);
      },
      {},
      "Execution completed because incident is acknowledged.",
    ],
    [
      "alert",
      (): void => {
        jest.spyOn(AlertService, "findOneById").mockResolvedValue({
          alertSeverityId: SEVERITY_ID,
        } as never);
        jest
          .spyOn(AlertService, "isAlertAcknowledged")
          .mockResolvedValue(true as never);
      },
      {
        triggeredByIncidentId: undefined,
        triggeredByAlertId: ALERT_ID,
        userNotificationEventType: UserNotificationEventType.AlertCreated,
      },
      "Execution completed because alert is acknowledged.",
    ],
    [
      "alert episode",
      (): void => {
        jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue({
          alertSeverityId: SEVERITY_ID,
        } as never);
        jest
          .spyOn(AlertEpisodeService, "isEpisodeAcknowledged")
          .mockResolvedValue(true as never);
      },
      {
        triggeredByIncidentId: undefined,
        triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
        userNotificationEventType:
          UserNotificationEventType.AlertEpisodeCreated,
      },
      "Execution completed because alert episode is acknowledged.",
    ],
    [
      "incident episode",
      (): void => {
        jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
          incidentSeverityId: SEVERITY_ID,
        } as never);
        jest
          .spyOn(IncidentEpisodeService, "isEpisodeAcknowledged")
          .mockResolvedValue(true as never);
      },
      {
        triggeredByIncidentId: undefined,
        triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
        userNotificationEventType:
          UserNotificationEventType.IncidentEpisodeCreated,
      },
      "Execution completed because incident episode is acknowledged.",
    ],
  ];

  test.each(ACKNOWLEDGED)(
    "an acknowledged %s gets no more repeats, and its log ends",
    async (
      _label: string,
      acknowledge: () => void,
      logOverrides: Record<string, unknown>,
      statusMessage: string,
    ) => {
      rules = [
        notificationRule({
          id: PUSH_RULE_ID,
          notifyAfterMinutes: 0,
          repeatEveryMinutes: 1,
        }),
      ];
      claimedKeys = [
        PUSH_RULE_ID,
        getRepeatClaimKey(PUSH_RULE_ID, 1),
        getRepeatClaimKey(PUSH_RULE_ID, 2),
      ];

      acknowledge();

      // Repeat 5 is due by the clock, and is not sent.
      expect(await tick(5, logOverrides)).toBe(true);

      expect(executions).toEqual([]);
      expect(findRulesSpy).not.toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(
        (updateSpy.mock.calls[0]![0] as { data: JSONObject }).data,
      ).toEqual({
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: statusMessage,
      });
    },
  );

  test.each(ACKNOWLEDGED)(
    "an unacknowledged %s keeps getting its repeats",
    async (
      _label: string,
      _acknowledge: () => void,
      logOverrides: Record<string, unknown>,
    ) => {
      jest.spyOn(AlertService, "findOneById").mockResolvedValue({
        alertSeverityId: SEVERITY_ID,
      } as never);
      jest
        .spyOn(AlertService, "isAlertAcknowledged")
        .mockResolvedValue(false as never);
      jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue({
        alertSeverityId: SEVERITY_ID,
      } as never);
      jest
        .spyOn(AlertEpisodeService, "isEpisodeAcknowledged")
        .mockResolvedValue(false as never);
      jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
        incidentSeverityId: SEVERITY_ID,
      } as never);
      jest
        .spyOn(IncidentEpisodeService, "isEpisodeAcknowledged")
        .mockResolvedValue(false as never);

      rules = [
        notificationRule({
          id: PUSH_RULE_ID,
          notifyAfterMinutes: 0,
          repeatEveryMinutes: 1,
        }),
      ];
      claimedKeys = [
        PUSH_RULE_ID,
        getRepeatClaimKey(PUSH_RULE_ID, 1),
        getRepeatClaimKey(PUSH_RULE_ID, 2),
      ];

      expect(await tick(5, logOverrides)).toBe(false);

      expect(scheduleOf(PUSH_RULE_ID)).toEqual([[5, 5]]);
    },
  );
});
