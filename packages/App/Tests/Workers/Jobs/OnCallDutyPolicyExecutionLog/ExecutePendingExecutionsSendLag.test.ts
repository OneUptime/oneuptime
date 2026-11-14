import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  getOnCallEscalationDueAt,
  isOnCallEscalationWaitOver,
} from "Common/Types/OnCallDutyPolicy/OnCallEscalationWait";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Telemetry from "Common/Server/Utils/Telemetry";
import OnCallSendLag, {
  OnCallScheduledSend,
} from "Common/Server/Utils/OnCall/OnCallSendLag";
import { NotificationSchedule } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";

/*
 * HOW LATE THE ESCALATION WORKER PAGES THE NEXT LEVEL (notification.send.lag,
 * issue #6646).
 *
 * A run pages a level, then waits the level's "Escalate after" for somebody
 * to acknowledge. Once a minute the worker finds the runs whose wait ran out
 * and moves each on (OnCallEscalationAdvance): the next level - or, past the
 * last, the policy's first level again (its Repeat Policy). What the level
 * pages was due when the wait ran out (OnCallEscalationWait), and is timed
 * from then: the tick that came late, or a worker that stopped, shows.
 *
 * The moment it was due is the first at which the worker itself says the
 * wait is over - it counts whole minutes - so a worker on time is late by
 * no more than where in the minute its tick fell.
 *
 * The job registers itself through RunCron at import time and exports
 * nothing, so the Cron util is mocked to capture the handler and each test
 * drives one tick; the advance is the real one, its services mocked.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/OnCallDutyPolicyExecutionLogService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
      claimEscalationAdvance: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Services/OnCallDutyPolicyEscalationRuleService",
  () => {
    return {
      __esModule: true,
      default: {
        findOneBy: jest.fn(),
        startRuleExecution: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: { isIncidentAcknowledged: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: { isAlertAcknowledged: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return {
    __esModule: true,
    default: { isEpisodeAcknowledged: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: { isEpisodeAcknowledged: jest.fn() },
  };
});

jest.mock(
  "Common/Server/Services/OnCallDutyPolicyExecutionLogTimelineService",
  () => {
    return {
      __esModule: true,
      // findBy: who passed the run's page on - nobody, here.
      default: {
        create: jest.fn(),
        findBy: jest.fn(async () => {
          return [];
        }),
      },
    };
  },
);

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

const executionLogService: {
  findBy: jest.Mock;
  findOneById: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
} = OnCallDutyPolicyExecutionLogService as unknown as {
  findBy: jest.Mock;
  findOneById: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
};

const ruleService: {
  findOneBy: jest.Mock;
  startRuleExecution: jest.Mock;
} = OnCallDutyPolicyEscalationRuleService as unknown as {
  findOneBy: jest.Mock;
  startRuleExecution: jest.Mock;
};

const incidentService: { isIncidentAcknowledged: jest.Mock } =
  IncidentService as unknown as { isIncidentAcknowledged: jest.Mock };

const SECOND_IN_MS: number = 1000;
const MINUTE_IN_MS: number = 60 * SECOND_IN_MS;

// When the level the run is on started paging.
const LEVEL_STARTED_AT: Date = new Date("2026-11-10T09:00:00.000Z");

const FIRST_RULE_ID: ObjectID = new ObjectID(
  "6646cccc-0000-4000-8000-0000000000a1",
);
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "6646cccc-0000-4000-8000-0000000000a2",
);
const THIRD_RULE_ID: ObjectID = new ObjectID(
  "6646cccc-0000-4000-8000-0000000000a3",
);
const NOTIFICATION_ID: ObjectID = new ObjectID(
  "6646cccc-0000-4000-8000-0000000000b1",
);

// The policy's three levels, by order.
const RULE_IDS: Record<number, ObjectID> = {
  1: FIRST_RULE_ID,
  2: SECOND_RULE_ID,
  3: THIRD_RULE_ID,
};

// What each level started was told, as it started.
let told: Array<OnCallScheduledSend | null>;
let now: Date;
let metricsOn: boolean;
let cache: Map<string, { value: string; expiresInSeconds: number }>;
// Whether the level started writes a notification, as a real one does.
let writesNotification: boolean;

function after(start: Date, milliseconds: number): Date {
  return new Date(start.getTime() + milliseconds);
}

// A run of a three-level policy on level `order`, its wait `waitInMinutes`.
function runOnLevel(data: {
  order: number;
  waitInMinutes: number | undefined;
  levelStartedAt?: Date | undefined;
  createdAt?: Date | undefined;
  repeats?: number | undefined;
}): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.onCallDutyPolicyId = ObjectID.generate();
  log.triggeredByIncidentId = ObjectID.generate();
  log.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  log.status = OnCallDutyPolicyStatus.Executing;
  log.lastExecutedEscalationRuleOrder = data.order;
  log.createdAt =
    data.createdAt || new Date(LEVEL_STARTED_AT.getTime() - 30 * MINUTE_IN_MS);
  log.onCallPolicyExecutionRepeatCount = 1;

  if (data.waitInMinutes !== undefined) {
    log.executeNextEscalationRuleInMinutes = data.waitInMinutes;
  }

  if (data.levelStartedAt !== null) {
    log.lastEscalationRuleExecutedAt = data.levelStartedAt || LEVEL_STARTED_AT;
  }

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.isArchived = false;

  if (data.repeats) {
    policy.repeatPolicyIfNoOneAcknowledges = true;
    policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = data.repeats;
  }

  log.onCallDutyPolicy = policy;
  return log;
}

async function tickAt(
  moment: Date,
  run: OnCallDutyPolicyExecutionLog,
): Promise<void> {
  now = moment;
  executionLogService.findBy.mockResolvedValue([run]);

  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

  if (!handler) {
    throw new Error(`${JOB_NAME} did not register`);
  }

  await handler();
}

// The ids of the levels the tick started, in order.
function levelsStarted(): Array<string> {
  return ruleService.startRuleExecution.mock.calls.map(
    (call: Array<unknown>): string => {
      return String(call[0]);
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();

  told = [];
  now = LEVEL_STARTED_AT;
  metricsOn = true;
  cache = new Map();
  writesNotification = false;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(now.getTime());
  });

  jest.spyOn(Telemetry, "isMetricsEnabled").mockImplementation((): boolean => {
    return metricsOn;
  });

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number },
      ): Promise<void> => {
        cache.set(`${namespace}-${key}`, {
          value: value,
          expiresInSeconds: options?.expiresInSeconds || 0,
        });
      },
    );

  jest
    .spyOn(GlobalCache, "getAndDeleteString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        const entry: { value: string } | undefined = cache.get(
          `${namespace}-${key}`,
        );
        cache.delete(`${namespace}-${key}`);
        return entry ? entry.value : null;
      },
    );

  executionLogService.updateOneById.mockResolvedValue(undefined);
  executionLogService.claimEscalationAdvance.mockResolvedValue(true);
  incidentService.isIncidentAcknowledged.mockResolvedValue(false);

  ruleService.findOneBy.mockImplementation(
    (args: {
      query: { order: number };
    }): Promise<OnCallDutyPolicyEscalationRule | null> => {
      const id: ObjectID | undefined = RULE_IDS[args.query.order];

      if (!id) {
        return Promise.resolve(null);
      }

      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.id = id;
      rule.order = args.query.order;
      return Promise.resolve(rule);
    },
  );

  // A level started pages somebody: the run waits on it.
  ruleService.startRuleExecution.mockImplementation(
    async (): Promise<undefined> => {
      // What a notification the level writes later in its call is told.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
      told.push(OnCallSendLag.getScheduledSend());

      if (writesNotification) {
        await OnCallSendLag.rememberDueTimeOf(NOTIFICATION_ID);
      }

      return undefined;
    },
  );
});

describe("the next level's notifications are due when the level before's wait ran out", () => {
  test("a 10-minute wait, the worker 3 min 20 s late: due at 09:10, as an escalation", async () => {
    const run: OnCallDutyPolicyExecutionLog = runOnLevel({
      order: 1,
      waitInMinutes: 10,
    });

    await tickAt(new Date("2026-11-10T09:13:20.000Z"), run);

    expect(levelsStarted()).toEqual([SECOND_RULE_ID.toString()]);
    expect(told).toEqual([
      {
        dueAt: new Date("2026-11-10T09:10:00.000Z"),
        schedule: NotificationSchedule.Escalation,
      },
    ]);
    expect(told[0]!.dueAt).toEqual(getOnCallEscalationDueAt(run));
  });

  test("the worker stopped for an hour: still due when the wait ran out - the hour shows", async () => {
    const run: OnCallDutyPolicyExecutionLog = runOnLevel({
      order: 2,
      waitInMinutes: 5,
    });

    await tickAt(after(LEVEL_STARTED_AT, 65 * MINUTE_IN_MS + 4_000), run);

    expect(levelsStarted()).toEqual([THIRD_RULE_ID.toString()]);
    expect(told).toEqual([
      {
        dueAt: after(LEVEL_STARTED_AT, 5 * MINUTE_IN_MS),
        schedule: NotificationSchedule.Escalation,
      },
    ]);
  });

  test("before any level started, the wait counts from the run's creation", async () => {
    const createdAt: Date = new Date("2026-11-10T08:40:00.000Z");
    const run: OnCallDutyPolicyExecutionLog = runOnLevel({
      order: 1,
      waitInMinutes: 15,
      createdAt: createdAt,
      levelStartedAt: null as unknown as undefined,
    });

    expect(run.lastEscalationRuleExecutedAt).toBeUndefined();

    await tickAt(new Date("2026-11-10T08:56:30.000Z"), run);

    expect(told).toEqual([
      {
        dueAt: new Date("2026-11-10T08:55:00.000Z"),
        schedule: NotificationSchedule.Escalation,
      },
    ]);
  });

  test("past the last level, the policy starts again: its first level is a policy repeat, due when the last level's wait ran out", async () => {
    const run: OnCallDutyPolicyExecutionLog = runOnLevel({
      order: 3,
      waitInMinutes: 20,
      repeats: 2,
    });

    await tickAt(after(LEVEL_STARTED_AT, 21 * MINUTE_IN_MS), run);

    expect(levelsStarted()).toEqual([FIRST_RULE_ID.toString()]);
    expect(told).toEqual([
      {
        dueAt: after(LEVEL_STARTED_AT, 20 * MINUTE_IN_MS),
        schedule: NotificationSchedule.PolicyRepeat,
      },
    ]);
  });

  test("a level that pages nobody is moved past at once: the level after it is due at the same moment", async () => {
    const run: OnCallDutyPolicyExecutionLog = runOnLevel({
      order: 1,
      waitInMinutes: 10,
    });

    let started: number = 0;

    // The run re-read to move it on again: still paging, on the level just started.
    executionLogService.findOneById.mockResolvedValue({
      status: OnCallDutyPolicyStatus.Executing,
      lastEscalationRuleExecutedAt: after(LEVEL_STARTED_AT, 12 * MINUTE_IN_MS),
    });

    ruleService.startRuleExecution.mockImplementation(
      async (): Promise<{ movesOnAtOnce: boolean } | undefined> => {
        told.push(OnCallSendLag.getScheduledSend());
        started++;
        // The second level has nobody on call.
        return started === 1 ? { movesOnAtOnce: true } : undefined;
      },
    );

    await tickAt(after(LEVEL_STARTED_AT, 12 * MINUTE_IN_MS), run);

    expect(levelsStarted()).toEqual([
      SECOND_RULE_ID.toString(),
      THIRD_RULE_ID.toString(),
    ]);
    expect(told).toEqual([
      {
        dueAt: after(LEVEL_STARTED_AT, 10 * MINUTE_IN_MS),
        schedule: NotificationSchedule.Escalation,
      },
      {
        dueAt: after(LEVEL_STARTED_AT, 10 * MINUTE_IN_MS),
        schedule: NotificationSchedule.Escalation,
      },
    ]);
  });
});

/*
 * The due moment is the first at which the worker moves the run on: for
 * each wait, a moment before it the worker waits on, and from it on the
 * worker moves on - a worker on time is late by where in the minute it
 * ticked, no more.
 */
describe("the due moment is the first the worker says the wait is over", () => {
  const WAITS: Array<[number, number]> = [
    // [the level's wait in minutes, the moment it runs out, in minutes]
    [1, 1],
    [1.5, 2],
    [2.25, 3],
    [5, 5],
    [10, 10],
    [30, 30],
    [60, 60],
  ];

  test.each(WAITS)(
    "a wait of %s minutes runs out at minute %s",
    async (waitInMinutes: number, runsOutAtMinute: number) => {
      const dueAt: Date = after(
        LEVEL_STARTED_AT,
        runsOutAtMinute * MINUTE_IN_MS,
      );

      // A millisecond before: the worker waits, and nothing is told.
      await tickAt(
        after(dueAt, -1),
        runOnLevel({ order: 1, waitInMinutes: waitInMinutes }),
      );

      expect(executionLogService.claimEscalationAdvance).not.toHaveBeenCalled();
      expect(told).toEqual([]);

      // At it, and at every moment of the minute after it: due then.
      for (const lateBy of [0, 1, 30 * SECOND_IN_MS, MINUTE_IN_MS - 1]) {
        told = [];

        const run: OnCallDutyPolicyExecutionLog = runOnLevel({
          order: 1,
          waitInMinutes: waitInMinutes,
        });

        expect(isOnCallEscalationWaitOver(run, after(dueAt, lateBy))).toBe(
          true,
        );

        await tickAt(after(dueAt, lateBy), run);

        expect(told).toEqual([
          { dueAt: dueAt, schedule: NotificationSchedule.Escalation },
        ]);
      }
    },
  );

  test("a level with no wait: due as it started, the next tick late by its minute", async () => {
    const run: OnCallDutyPolicyExecutionLog = runOnLevel({
      order: 1,
      waitInMinutes: undefined,
    });

    await tickAt(after(LEVEL_STARTED_AT, 40 * SECOND_IN_MS), run);

    expect(told).toEqual([
      { dueAt: LEVEL_STARTED_AT, schedule: NotificationSchedule.Escalation },
    ]);
  });

  test("a level whose start is a moment after the worker's clock - two servers apart: due now, never later", async () => {
    const tickMoment: Date = after(LEVEL_STARTED_AT, -1_500);

    await tickAt(tickMoment, runOnLevel({ order: 1, waitInMinutes: 0 }));

    expect(told).toEqual([
      { dueAt: tickMoment, schedule: NotificationSchedule.Escalation },
    ]);
  });
});

describe("what is kept, and what is not", () => {
  test("a notification the next level writes keeps its due moment for whichever server marks it sent", async () => {
    writesNotification = true;

    await tickAt(
      after(LEVEL_STARTED_AT, 7 * MINUTE_IN_MS + 9 * SECOND_IN_MS),
      runOnLevel({ order: 1, waitInMinutes: 6 }),
    );

    expect(
      cache.get(`${OnCallSendLag.CACHE_NAMESPACE}-${NOTIFICATION_ID}`),
    ).toEqual({
      value: JSON.stringify({
        dueAt: after(LEVEL_STARTED_AT, 6 * MINUTE_IN_MS).getTime(),
        schedule: NotificationSchedule.Escalation,
      }),
      expiresInSeconds: OnCallSendLag.CACHE_EXPIRES_IN_SECONDS,
    });

    expect(await OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID)).toEqual({
      dueAt: after(LEVEL_STARTED_AT, 6 * MINUTE_IN_MS),
      schedule: NotificationSchedule.Escalation,
    });
    expect(await OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID)).toBeNull();
  });

  test("with the metrics off: the same level starts with the same page, and nothing is kept", async () => {
    writesNotification = true;
    const moment: Date = after(LEVEL_STARTED_AT, 11 * MINUTE_IN_MS);

    const run: OnCallDutyPolicyExecutionLog = runOnLevel({
      order: 1,
      waitInMinutes: 10,
    });

    await tickAt(moment, run);
    const withMetrics: Array<unknown> = JSON.parse(
      JSON.stringify(ruleService.startRuleExecution.mock.calls),
    );

    ruleService.startRuleExecution.mockClear();
    cache.clear();
    metricsOn = false;

    await tickAt(moment, run);

    expect(
      JSON.parse(JSON.stringify(ruleService.startRuleExecution.mock.calls)),
    ).toEqual(withMetrics);
    expect(cache.size).toBe(0);
  });

  test("a move on another tick claimed first starts nothing, and tells nothing", async () => {
    executionLogService.claimEscalationAdvance.mockResolvedValue(false);

    await tickAt(
      after(LEVEL_STARTED_AT, 15 * MINUTE_IN_MS),
      runOnLevel({ order: 1, waitInMinutes: 10 }),
    );

    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
    expect(told).toEqual([]);
  });

  test("an acknowledged record ends the run: nothing is told", async () => {
    incidentService.isIncidentAcknowledged.mockResolvedValue(true);

    await tickAt(
      after(LEVEL_STARTED_AT, 15 * MINUTE_IN_MS),
      runOnLevel({ order: 1, waitInMinutes: 10 }),
    );

    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
    expect(told).toEqual([]);
  });

  test("nothing outside the tick's move on is told a send", async () => {
    await tickAt(
      after(LEVEL_STARTED_AT, 15 * MINUTE_IN_MS),
      runOnLevel({ order: 1, waitInMinutes: 10 }),
    );

    expect(told).toHaveLength(1);
    expect(OnCallSendLag.getScheduledSend()).toBeNull();
  });
});
