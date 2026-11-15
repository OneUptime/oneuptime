import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  getOnCallPolicyRunPagingDueAt,
  isOnCallPolicyRunWaitOver,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import OnCallPageTiming, {
  OnCallPageStartMoment,
} from "Common/Server/Utils/OnCall/OnCallPageTiming";
import { OnCallPageStart } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import OnCallPolicyRunMessage from "Common/Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";

/*
 * A HELD RUN'S PAGE IS TIMED FROM WHEN ITS HOLD RAN OUT (issue #6708).
 *
 * A run its on-call rule holds until working hours, or OneUptime AI holds
 * while it investigates, waits until its moment (pagingStartsAt). Once a
 * minute the worker reads the runs that wait, and starts each whose moment
 * has come (OnCallDutyPolicyExecutionLogService.startWaitingRun). Its page
 * is timed from that moment - not from the tick that got to it - so the
 * minutes a worker that fell behind added are in the page's time to send
 * (notification.time_to_send, page_started), where an operator's SLO reads
 * them.
 *
 * The worker's tick drives the real startWaitingRun here: its claim (one
 * atomic UPDATE, held in memory), the run's first escalation rule paging
 * inside its page's start, and what that rule's notifications would be
 * told (OnCallPageTiming.getPageStart). The database, the rule's paging and
 * the run's Slack and Microsoft Teams message are stood in for.
 *
 * The job registers itself through RunCron at import time and exports
 * nothing, so the Cron util is mocked to capture the handler and each test
 * drives its ticks.
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

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import IncidentService from "Common/Server/Services/IncidentService";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

// The run is held until 09:00 UTC: working hours start, or its hold runs out.
const HOLD_RAN_OUT: Date = new Date("2026-11-11T09:00:00.000Z");

const FIRST_RULE: ObjectID = new ObjectID(
  "67080000-0000-4000-8000-000000000001",
);

// One page start the first rule's notifications would be told, by run.
interface SeenPage {
  runId: string;
  pageStart: OnCallPageStartMoment | null;
}

// The runs in the table, as the worker's read finds them.
let table: Array<OnCallDutyPolicyExecutionLog>;
// The values each claim wrote, in order, and whether it won.
let claims: Array<{ values: Record<string, unknown>; won: boolean }>;
let seen: Array<SeenPage>;
let now: Date;

function heldRun(data: {
  pagingStartsAt?: Date | string | undefined;
  isAiHeld?: boolean | undefined;
}): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = ObjectID.generate();
  run.projectId = ObjectID.generate();
  run.onCallDutyPolicyId = ObjectID.generate();
  run.triggeredByIncidentId = ObjectID.generate();
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  run.status = OnCallDutyPolicyStatus.Waiting;
  run.statusMessage =
    "Waiting for working hours. Paging starts Wed 09:00 (Europe/London).";
  run.createdAt = new Date(HOLD_RAN_OUT.getTime() - 7 * HOUR);
  run.onCallPolicyExecutionRepeatCount = 1;

  if (data.pagingStartsAt !== undefined) {
    (run as unknown as { pagingStartsAt: Date | string }).pagingStartsAt =
      data.pagingStartsAt;
  }

  if (data.isAiHeld) {
    run.aiHoldOutcome = OnCallPolicyAiHoldOutcome.Holding;
  }

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.isArchived = false;
  policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = 0;
  run.onCallDutyPolicy = policy;

  table.push(run);

  return run;
}

// The worker's tick at `at`.
async function tickAt(at: Date): Promise<void> {
  now = at;

  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

  if (!handler) {
    throw new Error(`${JOB_NAME} did not register`);
  }

  await handler();
}

function pageStartOf(run: OnCallDutyPolicyExecutionLog): Array<Date | null> {
  return seen
    .filter((page: SeenPage) => {
      return page.runId === run.id!.toString();
    })
    .map((page: SeenPage) => {
      return page.pageStart ? page.pageStart.startedAt : null;
    });
}

beforeEach(() => {
  table = [];
  claims = [];
  seen = [];
  now = HOLD_RAN_OUT;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(now);
  });

  // The worker's read: the runs still waiting, each a fresh copy.
  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
    .mockImplementation((async () => {
      return table
        .filter((run: OnCallDutyPolicyExecutionLog) => {
          return run.status === OnCallDutyPolicyStatus.Waiting;
        })
        .map((run: OnCallDutyPolicyExecutionLog) => {
          return Object.assign(new OnCallDutyPolicyExecutionLog(), run);
        });
    }) as never);

  /*
   * The claim: one conditional UPDATE from Waiting. It wins while the run
   * still waits, and moves it on as Postgres would.
   */
  jest
    .spyOn(
      OnCallDutyPolicyExecutionLogService as unknown as {
        getRepository: () => unknown;
      },
      "getRepository",
    )
    .mockReturnValue({
      update: async (
        where: { _id: string; status: OnCallDutyPolicyStatus },
        values: Record<string, unknown>,
      ): Promise<{ affected: number }> => {
        const run: OnCallDutyPolicyExecutionLog | undefined = table.find(
          (row: OnCallDutyPolicyExecutionLog) => {
            return (
              row.id!.toString() === where._id && row.status === where.status
            );
          },
        );

        claims.push({ values: { ...values }, won: Boolean(run) });

        if (!run) {
          return { affected: 0 };
        }

        Object.assign(run, values);

        return { affected: 1 };
      },
    } as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
    .mockResolvedValue(1 as never);

  jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
    return undefined;
  });

  // No policy link: the record's feed entry is not what these are about.
  jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue(null as never);

  jest
    .spyOn(IncidentService, "isIncidentAcknowledged")
    .mockResolvedValue(false as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
    .mockImplementation((async () => {
      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.id = FIRST_RULE;
      return rule;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
    .mockImplementation((async (
      _ruleId: ObjectID,
      options: { onCallPolicyExecutionLogId: ObjectID },
    ) => {
      // What a notification the rule writes now would be told.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      seen.push({
        runId: options.onCallPolicyExecutionLogId.toString(),
        pageStart: OnCallPageTiming.getPageStart(),
      });

      return { movesOnAtOnce: false };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a run held until 09:00, started by the worker's tick", () => {
  test.each([
    ["at its very moment", 0],
    ["half a minute late, as a worker that keeps up is", 30 * 1000],
    ["a minute late", MINUTE],
    ["7 minutes late, a worker that fell behind", 7 * MINUTE],
    ["an hour late", HOUR],
    ["a day late, a worker that stopped and came back", 24 * HOUR],
  ])(
    "ticked %s: its page starts at 09:00, so the lateness is in its time to send",
    async (_name: string, lateByInMs: number) => {
      const run: OnCallDutyPolicyExecutionLog = heldRun({
        pagingStartsAt: HOLD_RAN_OUT,
      });

      await tickAt(new Date(HOLD_RAN_OUT.getTime() + lateByInMs));

      expect(seen).toEqual([
        {
          runId: run.id!.toString(),
          pageStart: {
            startedAt: HOLD_RAN_OUT,
            start: OnCallPageStart.PageStarted,
          },
        },
      ]);
    },
  );

  test("the tick a second before its moment pages nobody and claims nothing", async () => {
    heldRun({ pagingStartsAt: HOLD_RAN_OUT });

    await tickAt(new Date(HOLD_RAN_OUT.getTime() - 1000));

    expect(claims).toEqual([]);
    expect(seen).toEqual([]);
  });

  test("its claim still moves the run's moment to the tick, and its page keeps the moment the worker read", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: HOLD_RAN_OUT,
    });
    const tick: Date = new Date(HOLD_RAN_OUT.getTime() + 12 * MINUTE);

    await tickAt(tick);

    expect(claims).toEqual([
      {
        values: {
          status: OnCallDutyPolicyStatus.Started,
          statusMessage: "Execution started...",
          pagingStartsAt: tick,
        },
        won: true,
      },
    ]);
    expect(pageStartOf(run)).toEqual([HOLD_RAN_OUT]);
  });

  test("a run OneUptime AI held, its hold time run out: the claim says so, and its page starts when the hold ran out", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: HOLD_RAN_OUT,
      isAiHeld: true,
    });

    await tickAt(new Date(HOLD_RAN_OUT.getTime() + 3 * MINUTE + 20 * 1000));

    expect(claims).toHaveLength(1);
    expect(claims[0]!.values["aiHoldOutcome"]).toBe(
      OnCallPolicyAiHoldOutcome.HoldTimeRanOut,
    );
    expect(seen).toEqual([
      {
        runId: run.id!.toString(),
        pageStart: {
          startedAt: HOLD_RAN_OUT,
          start: OnCallPageStart.PageStarted,
        },
      },
    ]);
  });

  test("its moment read back as text counts the same", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: HOLD_RAN_OUT.toISOString(),
    });

    await tickAt(new Date(HOLD_RAN_OUT.getTime() + 5 * MINUTE));

    expect(pageStartOf(run)).toEqual([HOLD_RAN_OUT]);
  });

  test("a run with no moment of its own pages at once, from the tick", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({});
    const tick: Date = new Date("2026-11-11T09:41:30.000Z");

    await tickAt(tick);

    expect(pageStartOf(run)).toEqual([tick]);
  });

  test("two worker replicas that read it tick at once: one claim wins, one page, from its moment", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: HOLD_RAN_OUT,
    });

    now = new Date(HOLD_RAN_OUT.getTime() + 4 * MINUTE);

    const handler: CronHandler = mockCapturedJobs[JOB_NAME]!;
    await Promise.all([handler(), handler()]);

    expect(
      claims.map((claim: { won: boolean }) => {
        return claim.won;
      }),
    ).toEqual([true, false]);
    expect(pageStartOf(run)).toEqual([HOLD_RAN_OUT]);
  });

  test("ticks every minute at :30, 08:57 to 09:03: started at 09:00:30, timed from 09:00:00 - the worker and its page read the moment alike", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: HOLD_RAN_OUT,
    });

    const startedAtTick: Array<string> = [];

    for (
      let tick: Date = new Date("2026-11-11T08:57:30.000Z");
      tick.getTime() <= new Date("2026-11-11T09:03:30.000Z").getTime();
      tick = new Date(tick.getTime() + MINUTE)
    ) {
      const wasWaiting: boolean = run.status === OnCallDutyPolicyStatus.Waiting;
      const pagesBefore: number = seen.length;

      await tickAt(tick);

      const started: boolean = seen.length > pagesBefore;

      if (started) {
        startedAtTick.push(tick.toISOString());

        // The page's start is the moment the worker decided by.
        expect(seen[seen.length - 1]!.pageStart!.startedAt).toEqual(
          getOnCallPolicyRunPagingDueAt({
            pagingStartsAt: HOLD_RAN_OUT,
            now: tick,
          }),
        );
      }

      // It starts exactly when the worker's own rule says its wait is over.
      expect(started).toBe(
        wasWaiting &&
          isOnCallPolicyRunWaitOver({
            pagingStartsAt: HOLD_RAN_OUT,
            now: tick,
          }),
      );
    }

    expect(startedAtTick).toEqual(["2026-11-11T09:00:30.000Z"]);
    expect(pageStartOf(run)).toEqual([HOLD_RAN_OUT]);
  });

  test("a worker that stopped overnight, back at 09:12: each run it starts is timed from its own moment", async () => {
    const working: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: new Date("2026-11-11T08:00:00.000Z"),
    });
    const ai: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: new Date("2026-11-11T08:47:15.000Z"),
      isAiHeld: true,
    });
    const notYet: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: new Date("2026-11-11T09:30:00.000Z"),
    });

    await tickAt(new Date("2026-11-11T09:12:00.000Z"));

    expect(pageStartOf(working)).toEqual([
      new Date("2026-11-11T08:00:00.000Z"),
    ]);
    expect(pageStartOf(ai)).toEqual([new Date("2026-11-11T08:47:15.000Z")]);
    expect(pageStartOf(notYet)).toEqual([]);
    expect(notYet.status).toBe(OnCallDutyPolicyStatus.Waiting);
  });

  test("its page start is the run's own: after the tick, nothing is left in a page's start", async () => {
    heldRun({ pagingStartsAt: HOLD_RAN_OUT });

    await tickAt(new Date(HOLD_RAN_OUT.getTime() + 2 * MINUTE));

    expect(seen).toHaveLength(1);
    expect(OnCallPageTiming.getPageStart()).toBeNull();
  });
});
