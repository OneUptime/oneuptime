import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import { getRepeatClaimKey } from "Common/Types/NotificationRule/NotificationRepeat";
import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import UserNotificationRuleService, {
  ExecuteNotificationRuleOptions,
} from "Common/Server/Services/UserNotificationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import logger from "Common/Server/Utils/Logger";
import Telemetry from "Common/Server/Utils/Telemetry";
import OnCallSendLag, {
  OnCallScheduledSend,
} from "Common/Server/Utils/OnCall/OnCallSendLag";
import { NotificationSchedule } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * HOW LATE THE RULES' WORKER SENDS WHAT A PERSON'S ON-CALL RULES MADE DUE
 * (notification.send.lag, issue #6646).
 *
 * Once a minute the worker goes through every on-call log still running and
 * sends each delivery of a person's rules that has come due: a rule's first
 * notification once its wait ("call me after 10 minutes") ran out, and each
 * repeat of a push repeated until somebody acknowledges. Each is sent inside
 * a scheduled send (OnCallRulesTick), so the notifications it writes know
 * when they were due:
 *
 *   - as the rule's schedule says, from the moment the log started;
 *   - for a repeat a worker that fell behind sends in place of those it
 *     skipped, from the first repeat the person went without;
 *   - never before the worker last went through the log's rules and found
 *     it not due: a rule added or changed meanwhile, or the record's
 *     severity changed so other rules apply, is no lateness of the platform.
 *
 * Driven here tick by tick against one log on a clock that moves as a real
 * worker's does, with the claim each delivery makes played back on the
 * log's executedNotificationRules and Redis held in memory.
 */

// The worker's Cron util as a no-op: importing the job enqueues nothing.
jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

/*
 * Where each run's record stands, answered one record at a time by the
 * per-record reads this suite mocks, as the worker read them before it read
 * a page's records together (Fixtures/OnCallRecordStatesPerRecord).
 */
jest.mock("Common/Server/Utils/OnCall/OnCallRecordStates", () => {
  return jest
    .requireActual("../Fixtures/OnCallRecordStatesPerRecord")
    .onCallRecordStatesReadPerRecord();
});

import { executePendingNotificationLog } from "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";

type PendingLog = Parameters<typeof executePendingNotificationLog>[0];

const MEMBER: { isProjectMember: boolean } = { isProjectMember: true };

const SECOND_IN_MS: number = 1000;
const MINUTE_IN_MS: number = 60 * SECOND_IN_MS;

const LOG_ID: ObjectID = new ObjectID("6646bbbb-0000-4000-8000-000000000001");
const PROJECT_ID: ObjectID = new ObjectID(
  "6646bbbb-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("6646bbbb-0000-4000-8000-000000000003");
const INCIDENT_ID: ObjectID = new ObjectID(
  "6646bbbb-0000-4000-8000-000000000004",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "6646bbbb-0000-4000-8000-000000000005",
);
const CALL_RULE_ID: string = "6646bbbb-0000-4000-8000-0000000000a1";
const PUSH_RULE_ID: string = "6646bbbb-0000-4000-8000-0000000000a2";
const ADDED_RULE_ID: string = "6646bbbb-0000-4000-8000-0000000000a3";

// When the log started: every rule's schedule counts from it.
const LOG_CREATED_AT: Date = new Date("2026-11-10T09:00:00.000Z");

const RULES_CHECKED: string = OnCallSendLag.RULES_CHECKED_CACHE_NAMESPACE;

// One delivery the worker handed to executeNotificationRuleItem.
interface Delivery {
  // The worker's clock as it sent it.
  sentAt: Date;
  ruleId: string;
  // 0 for the rule's first notification, n for repeat n.
  repeatNumber: number;
  // What the notifications it writes were told.
  send: OnCallScheduledSend | null;
  options: ExecuteNotificationRuleOptions;
}

let rules: Array<UserNotificationRule>;
let claimedKeys: Array<string>;
let deliveries: Array<Delivery>;
let now: Date;
let metricsOn: boolean;
let cache: Map<string, { value: string; expiresInSeconds: number }>;
let isRedisDown: boolean;
let failNextSend: boolean;
// What a delivery's notification does as it is written; nothing by default.
let onDeliver: ((delivery: Delivery) => Promise<void>) | null;
let setString: jest.SpiedFunction<typeof GlobalCache.setString>;
let getString: jest.SpiedFunction<typeof GlobalCache.getString>;
let getAndDeleteString: jest.SpiedFunction<
  typeof GlobalCache.getAndDeleteString
>;
let updateSpy: jest.SpiedFunction<typeof UserOnCallLogService.updateOneById>;

beforeEach(() => {
  rules = [];
  claimedKeys = [];
  deliveries = [];
  now = LOG_CREATED_AT;
  metricsOn = true;
  cache = new Map();
  isRedisDown = false;
  failNextSend = false;
  onDeliver = null;

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  // The worker's clock, as each tick sets it.
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(now.getTime());
  });

  jest.spyOn(Telemetry, "isMetricsEnabled").mockImplementation((): boolean => {
    return metricsOn;
  });

  setString = jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number },
      ): Promise<void> => {
        if (isRedisDown) {
          throw new Error("Cache is not connected");
        }

        cache.set(`${namespace}-${key}`, {
          value: value,
          expiresInSeconds: options?.expiresInSeconds || 0,
        });
      },
    );

  getString = jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        if (isRedisDown) {
          throw new Error("Cache is not connected");
        }

        return cache.get(`${namespace}-${key}`)?.value || null;
      },
    );

  getAndDeleteString = jest
    .spyOn(GlobalCache, "getAndDeleteString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        if (isRedisDown) {
          throw new Error("Cache is not connected");
        }

        const entry: { value: string } | undefined = cache.get(
          `${namespace}-${key}`,
        );
        cache.delete(`${namespace}-${key}`);
        return entry ? entry.value : null;
      },
    );

  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    incidentSeverityId: SEVERITY_ID,
  } as never);
  jest
    .spyOn(IncidentService, "isIncidentAcknowledged")
    .mockResolvedValue(false as never);

  jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockImplementation((): Promise<Array<UserNotificationRule>> => {
      return Promise.resolve(rules);
    });

  jest
    .spyOn(UserNotificationRuleService, "executeNotificationRuleItem")
    .mockImplementation(
      async (
        ruleId: ObjectID,
        options: ExecuteNotificationRuleOptions,
      ): Promise<void> => {
        if (failNextSend) {
          failNextSend = false;
          throw new Error("connection reset");
        }

        const repeatNumber: number = options.repeatNumber || 0;

        // The claim each delivery takes on the log, under its own key.
        claimedKeys.push(
          repeatNumber > 0
            ? getRepeatClaimKey(ruleId.toString(), repeatNumber)
            : ruleId.toString(),
        );

        const delivery: Delivery = {
          sentAt: OneUptimeDate.getCurrentDate(),
          ruleId: ruleId.toString(),
          repeatNumber: repeatNumber,
          send: OnCallSendLag.getScheduledSend(),
          options: options,
        };

        deliveries.push(delivery);

        if (onDeliver) {
          await onDeliver(delivery);
        }
      },
    );

  updateSpy = jest
    .spyOn(UserOnCallLogService, "updateOneById")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function at(minutes: number, seconds: number = 0): Date {
  return new Date(
    LOG_CREATED_AT.getTime() + minutes * MINUTE_IN_MS + seconds * SECOND_IN_MS,
  );
}

function notificationRule(data: {
  id: string;
  notifyAfterMinutes: number;
  repeatEveryMinutes?: number | undefined;
}): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule._id = data.id;
  rule.notifyAfterMinutes = data.notifyAfterMinutes;

  if (data.repeatEveryMinutes !== undefined) {
    rule.repeatEveryMinutes = data.repeatEveryMinutes;
  }

  return rule;
}

function executedNotificationRules(): JSONObject {
  const executed: JSONObject = {};

  for (const key of claimedKeys) {
    executed[key] = LOG_CREATED_AT.toISOString();
  }

  return executed;
}

function pendingLog(): PendingLog {
  return {
    id: LOG_ID,
    _id: LOG_ID.toString(),
    projectId: PROJECT_ID,
    userId: USER_ID,
    createdAt: LOG_CREATED_AT,
    executedNotificationRules: executedNotificationRules(),
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: INCIDENT_ID,
  } as unknown as PendingLog;
}

// One tick of the worker at `moment`; whether it ended the log.
async function tickAt(moment: Date): Promise<boolean> {
  now = moment;

  const updatesBefore: number = updateSpy.mock.calls.length;

  await executePendingNotificationLog(pendingLog(), MEMBER);

  return updateSpy.mock.calls
    .slice(updatesBefore)
    .some((call: Array<unknown>): boolean => {
      return (
        (call[0] as { data?: { status?: string } })?.data?.status ===
        UserNotificationExecutionStatus.Completed
      );
    });
}

/*
 * The worker every minute from `first` to `last`, `seconds` into each, until
 * the log ends - no tick selects it after that. The minute it ended, or null.
 */
async function everyMinute(data: {
  first: number;
  last: number;
  seconds: number;
}): Promise<number | null> {
  for (let minute: number = data.first; minute <= data.last; minute++) {
    if (await tickAt(at(minute, data.seconds))) {
      return minute;
    }
  }

  return null;
}

// How late a delivery went out: from when it was due to when it was sent.
function lagOf(delivery: Delivery): number {
  return delivery.sentAt.getTime() - delivery.send!.dueAt.getTime();
}

// The moments the worker kept as its last pass through the log's rules.
function passesKept(): Array<Date> {
  return setString.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === RULES_CHECKED;
    })
    .map((call: Array<unknown>): Date => {
      return new Date(Number(call[2]));
    });
}

function readsOfLastPass(): number {
  return getString.mock.calls.filter((call: Array<unknown>): boolean => {
    return call[0] === RULES_CHECKED;
  }).length;
}

describe("the rules' worker on time: each delivery is due when its rule's schedule says", () => {
  test("a rule that waits 10 minutes: due at minute 10 exactly, as a rule's wait - late only by where in the minute the tick fell", async () => {
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 10 })];

    const endedAt: number | null = await everyMinute({
      first: 0,
      last: 20,
      seconds: 20,
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.sentAt).toEqual(at(10, 20));
    expect(deliveries[0]!.send).toEqual({
      dueAt: at(10),
      schedule: NotificationSchedule.RuleWait,
    });
    expect(lagOf(deliveries[0]!)).toBe(20 * SECOND_IN_MS);
    expect(endedAt).toBe(11);
  });

  test("a rule with no wait, sent at the log's first tick: due as the log started", async () => {
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 0 })];

    await tickAt(at(0, 3));

    expect(
      deliveries.map((delivery: Delivery) => {
        return delivery.send;
      }),
    ).toEqual([{ dueAt: at(0), schedule: NotificationSchedule.RuleWait }]);
    expect(lagOf(deliveries[0]!)).toBe(3 * SECOND_IN_MS);
  });

  test("a push repeated every 5 minutes after a 2-minute wait: the first after its wait, each repeat after its interval, every one 7 seconds late", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 2,
        repeatEveryMinutes: 5,
      }),
    ];

    const endedAt: number | null = await everyMinute({
      first: 0,
      last: 90,
      seconds: 7,
    });

    expect(
      deliveries.map((delivery: Delivery) => {
        return [delivery.repeatNumber, delivery.send];
      }),
    ).toEqual(
      Array.from({ length: 11 }, (_unused: unknown, repeatNumber: number) => {
        return [
          repeatNumber,
          {
            dueAt: at(2 + repeatNumber * 5),
            schedule:
              repeatNumber === 0
                ? NotificationSchedule.RuleWait
                : NotificationSchedule.Repeat,
          },
        ];
      }),
    );
    expect(deliveries.map(lagOf)).toEqual(
      Array.from({ length: 11 }, () => {
        return 7 * SECOND_IN_MS;
      }),
    );
    expect(endedAt).toBe(2 + 10 * 5 + 1);
  });

  test("two rules due at the same tick: each its own schedule, one read of the last pass between them", async () => {
    rules = [
      notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 5 }),
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];

    await everyMinute({ first: 0, last: 4, seconds: 30 });
    const readsBefore: number = readsOfLastPass();

    await tickAt(at(5, 30));

    const atMinute5: Array<Delivery> = deliveries.filter(
      (delivery: Delivery) => {
        return delivery.sentAt.getTime() === at(5, 30).getTime();
      },
    );

    expect(
      atMinute5.map((delivery: Delivery) => {
        return [delivery.ruleId, delivery.repeatNumber, delivery.send];
      }),
    ).toEqual([
      [
        CALL_RULE_ID,
        0,
        { dueAt: at(5), schedule: NotificationSchedule.RuleWait },
      ],
      [
        PUSH_RULE_ID,
        1,
        { dueAt: at(5), schedule: NotificationSchedule.Repeat },
      ],
    ]);
    expect(readsOfLastPass() - readsBefore).toBe(1);
  });
});

describe("a worker that fell behind: the lag shows how far", () => {
  test("stopped from minute 12 to 40: the repeat it sends on its return is due when the first one the person went without was", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];

    await everyMinute({ first: 0, last: 12, seconds: 7 });
    await tickAt(at(40, 7));

    expect(
      deliveries.map((delivery: Delivery) => {
        return [delivery.repeatNumber, delivery.send!.dueAt, lagOf(delivery)];
      }),
    ).toEqual([
      [0, at(0), 7 * SECOND_IN_MS],
      [1, at(5), 7 * SECOND_IN_MS],
      [2, at(10), 7 * SECOND_IN_MS],
      // Repeat 8 is what goes out; repeat 3 was owed since minute 15.
      [8, at(15), 25 * MINUTE_IN_MS + 7 * SECOND_IN_MS],
    ]);
    expect(deliveries[3]!.send!.schedule).toBe(NotificationSchedule.Repeat);

    // Back on time: the next repeat is due at minute 45.
    await everyMinute({ first: 41, last: 45, seconds: 7 });

    expect(deliveries).toHaveLength(5);
    expect(deliveries[4]!.repeatNumber).toBe(9);
    expect(deliveries[4]!.send!.dueAt).toEqual(at(45));
  });

  test("a rule's wait that ran out while the worker was stopped: due when it ran out", async () => {
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 10 })];

    await everyMinute({ first: 0, last: 3, seconds: 0 });
    await tickAt(at(26, 45));

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.send).toEqual({
      dueAt: at(10),
      schedule: NotificationSchedule.RuleWait,
    });
    expect(lagOf(deliveries[0]!)).toBe(16 * MINUTE_IN_MS + 45 * SECOND_IN_MS);
  });
});

describe("what came due between two ticks without the platform being late", () => {
  test("a rule added while the log ran: due no earlier than the worker's last pass through the log's rules", async () => {
    // A rule far off keeps the log running.
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 30 })];

    await everyMinute({ first: 0, last: 9, seconds: 20 });

    // Added at 09:09:50: the rule says "at once".
    rules = [
      ...rules,
      notificationRule({ id: ADDED_RULE_ID, notifyAfterMinutes: 0 }),
    ];

    await tickAt(at(10, 20));

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.ruleId).toBe(ADDED_RULE_ID);
    expect(deliveries[0]!.send).toEqual({
      dueAt: at(9, 20),
      schedule: NotificationSchedule.RuleWait,
    });
    // One tick: not the ten minutes since the log started.
    expect(lagOf(deliveries[0]!)).toBe(MINUTE_IN_MS);
  });

  test("the last pass forgotten - Redis lost it: the schedule is what is left", async () => {
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 30 })];

    await everyMinute({ first: 0, last: 9, seconds: 20 });

    cache.clear();
    rules = [
      ...rules,
      notificationRule({ id: ADDED_RULE_ID, notifyAfterMinutes: 0 }),
    ];

    await tickAt(at(10, 20));

    expect(deliveries[0]!.send!.dueAt).toEqual(at(0));
  });

  test("a pass kept is no later than the tick it was: one that sent nothing still counts", async () => {
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 30 })];

    await everyMinute({ first: 0, last: 2, seconds: 20 });

    expect(deliveries).toHaveLength(0);
    expect(passesKept()).toEqual([at(0, 20), at(1, 20), at(2, 20)]);
    expect(cache.get(`${RULES_CHECKED}-${LOG_ID.toString()}`)).toEqual({
      value: String(at(2, 20).getTime()),
      expiresInSeconds: OnCallSendLag.RULES_CHECKED_CACHE_EXPIRES_IN_SECONDS,
    });
  });

  test("a log that is done keeps no pass: no tick reads it again", async () => {
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 0 })];

    expect(await tickAt(at(0, 5))).toBe(false);
    expect(await tickAt(at(1, 5))).toBe(true);

    // The tick that sent it went through the rules; the one that ended the log kept nothing.
    expect(passesKept()).toEqual([at(0, 5)]);
  });
});

describe("the notifications a delivery writes keep its due moment", () => {
  test("for whichever server writes that one was sent - read back once", async () => {
    const notificationId: ObjectID = new ObjectID(
      "6646bbbb-0000-4000-8000-0000000000b1",
    );

    onDeliver = async (): Promise<void> => {
      await OnCallSendLag.rememberDueTimeOf(notificationId);
    };

    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 4 })];

    await everyMinute({ first: 0, last: 4, seconds: 50 });

    expect(
      cache.get(`${OnCallSendLag.CACHE_NAMESPACE}-${notificationId}`),
    ).toEqual({
      value: JSON.stringify({
        dueAt: at(4).getTime(),
        schedule: NotificationSchedule.RuleWait,
      }),
      expiresInSeconds: OnCallSendLag.CACHE_EXPIRES_IN_SECONDS,
    });

    expect(await OnCallSendLag.takeDueTimeOf(notificationId)).toEqual({
      dueAt: at(4),
      schedule: NotificationSchedule.RuleWait,
    });
    expect(await OnCallSendLag.takeDueTimeOf(notificationId)).toBeNull();
  });

  test("nothing outside a delivery is told one", async () => {
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 0 })];

    await tickAt(at(0, 1));

    expect(deliveries[0]!.send).not.toBeNull();
    expect(OnCallSendLag.getScheduledSend()).toBeNull();
  });
});

describe("the deliveries themselves do not change", () => {
  // The same 25 minutes with a repeating push and a waiting call.
  async function run(): Promise<Array<[string, number, string, unknown]>> {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
      notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 10 }),
    ];

    await everyMinute({ first: 0, last: 25, seconds: 12 });

    return deliveries.map((delivery: Delivery) => {
      return [
        delivery.sentAt.toISOString(),
        delivery.repeatNumber,
        delivery.ruleId,
        JSON.parse(JSON.stringify(delivery.options)),
      ];
    });
  }

  test("with the metrics off: the same deliveries, with the same options, and Redis is never touched", async () => {
    const withMetrics: Array<[string, number, string, unknown]> = await run();

    expect(withMetrics.length).toBeGreaterThan(5);

    claimedKeys = [];
    deliveries = [];
    metricsOn = false;
    jest.clearAllMocks();

    const withoutMetrics: Array<[string, number, string, unknown]> =
      await run();

    expect(withoutMetrics).toEqual(withMetrics);
    expect(
      deliveries.every((delivery: Delivery) => {
        return delivery.send === null;
      }),
    ).toBe(true);
    expect(setString).not.toHaveBeenCalled();
    expect(getString).not.toHaveBeenCalled();
    expect(getAndDeleteString).not.toHaveBeenCalled();
  });

  test("a first notification is handed over with no repeat number at all, a repeat with its own", async () => {
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ];

    await everyMinute({ first: 0, last: 5, seconds: 12 });

    expect(deliveries).toHaveLength(2);
    expect("repeatNumber" in deliveries[0]!.options).toBe(false);
    expect(deliveries[1]!.options.repeatNumber).toBe(1);
    expect(deliveries[0]!.options).toEqual({
      userNotificationLogId: LOG_ID,
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      triggeredByAlertId: undefined,
      triggeredByAlertEpisodeId: undefined,
      triggeredByIncidentEpisodeId: undefined,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: undefined,
      onCallPolicyId: undefined,
      onCallPolicyEscalationRuleId: undefined,
      userBelongsToTeamId: undefined,
      onCallDutyPolicyExecutionLogTimelineId: undefined,
      onCallScheduleId: undefined,
    });
  });
});

describe("when something fails", () => {
  test("Redis down: every delivery still goes out on time, timed by its schedule alone", async () => {
    isRedisDown = true;
    rules = [
      notificationRule({
        id: PUSH_RULE_ID,
        notifyAfterMinutes: 1,
        repeatEveryMinutes: 5,
      }),
    ];

    await everyMinute({ first: 0, last: 11, seconds: 9 });

    expect(
      deliveries.map((delivery: Delivery) => {
        return [delivery.sentAt, delivery.repeatNumber, delivery.send];
      }),
    ).toEqual([
      [at(1, 9), 0, { dueAt: at(1), schedule: NotificationSchedule.RuleWait }],
      [at(6, 9), 1, { dueAt: at(6), schedule: NotificationSchedule.Repeat }],
      [at(11, 9), 2, { dueAt: at(11), schedule: NotificationSchedule.Repeat }],
    ]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a send that fails leaves the log running and keeps no pass: the retry is late from the schedule", async () => {
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 5 })];

    await everyMinute({ first: 0, last: 4, seconds: 30 });

    failNextSend = true;
    await tickAt(at(5, 30));

    // Left Executing, as before; no pass kept for the tick that failed.
    expect(updateSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(passesKept()).toEqual([
      at(0, 30),
      at(1, 30),
      at(2, 30),
      at(3, 30),
      at(4, 30),
    ]);

    await tickAt(at(6, 30));

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.send).toEqual({
      dueAt: at(5),
      schedule: NotificationSchedule.RuleWait,
    });
    expect(lagOf(deliveries[0]!)).toBe(MINUTE_IN_MS + 30 * SECOND_IN_MS);
  });

  test("a last pass that is no moment is no pass", async () => {
    rules = [notificationRule({ id: CALL_RULE_ID, notifyAfterMinutes: 3 })];

    cache.set(`${RULES_CHECKED}-${LOG_ID.toString()}`, {
      value: "soon",
      expiresInSeconds: 60,
    });

    await tickAt(at(3, 30));

    expect(deliveries[0]!.send!.dueAt).toEqual(at(3));
  });
});
