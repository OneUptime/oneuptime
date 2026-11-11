import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A HELD RUN SOMETHING ELSE STARTS BEFORE THE WORKER DOES, AND WHEN ITS PAGE
 * WAS DUE (issue #6708).
 *
 * A run held by its on-call rule (working hours) or by OneUptime AI waits
 * until its moment (pagingStartsAt), and the escalation worker starts it on
 * its first tick after - timed from the moment, so a worker that fell behind
 * shows. Two other callers start held runs, through the same
 * startWaitingRun:
 *
 *   - a rule that now matches the record, which pages right away
 *     (WaitingRunsOnRecordChange): a P3 alert raised to P1 at 03:00 does not
 *     wait for 09:00;
 *   - OneUptime AI handing its hold to people (AiFirstResponder): it cannot
 *     fix the record, somebody pressed Page now, or AI was turned off.
 *
 * Started before its moment, a run is due as it starts: nothing was late.
 * Started after its moment - the hold ran out, and the worker's tick had
 * not come yet - it was due at its moment, whoever started it.
 *
 * The real callers and the real startWaitingRun run here: the record's and
 * the runs' reads, the claim (one conditional UPDATE, held in memory), the
 * first rule's paging and the run's Slack and Microsoft Teams message are
 * stood in for. What the first rule's notifications are told is read inside
 * its paging (OnCallPageTiming.getPageStart), as each notification would.
 */

jest.mock("../../../../Server/Utils/Logger", () => {
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

import Incident from "../../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import IncidentOnCallRuleEngineService from "../../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import AiFirstResponder from "../../../../Server/Utils/AI/FirstResponder/AiFirstResponder";
import OnCallPageTiming, {
  OnCallPageStartMoment,
} from "../../../../Server/Utils/OnCall/OnCallPageTiming";
import WaitingRunsOnRecordChange from "../../../../Server/Utils/OnCall/WaitingRunsOnRecordChange";
import { OnCallPageStart } from "../../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import OnCallPolicyRunMessage from "../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  getOnCallPolicyRunPagingDueAt,
  isOnCallPolicyRunWaitOver,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";

const MINUTE: number = 60 * 1000;

const PROJECT: ObjectID = new ObjectID("67080e00-0000-4000-8000-000000000001");
const INCIDENT: ObjectID = new ObjectID("67080e00-0000-4000-8000-000000000002");
const PLATFORM_POLICY: ObjectID = new ObjectID(
  "67080e00-0000-4000-8000-0000000000a1",
);
const PAYMENTS_POLICY: ObjectID = new ObjectID(
  "67080e00-0000-4000-8000-0000000000a2",
);
const FIRST_RULE: ObjectID = new ObjectID(
  "67080e00-0000-4000-8000-0000000000c1",
);

// Working hours start at 09:00: the P3 incident raised at 02:00 waits for it.
const WORKING_HOURS_START: Date = new Date("2026-11-11T09:00:00.000Z");

// What the first rule's notifications were told, run by run.
interface SeenPage {
  runId: string;
  pageStart: OnCallPageStartMoment | null;
}

// The runs in the table, as their reads find them.
let table: Array<OnCallDutyPolicyExecutionLog>;
// Each claim's run and the values it wrote, and whether it won.
let claims: Array<{
  runId: string;
  values: Record<string, unknown>;
  won: boolean;
}>;
let seen: Array<SeenPage>;
let now: Date;
let runCount: number;

function heldRun(data: {
  pagingStartsAt: Date;
  policyId?: ObjectID | undefined;
  isAiHeld?: boolean | undefined;
}): OnCallDutyPolicyExecutionLog {
  runCount++;

  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = new ObjectID(
    `67080e00-0000-4000-8000-${String(runCount).padStart(12, "0")}`,
  );
  run.projectId = PROJECT;
  run.onCallDutyPolicyId = data.policyId || PLATFORM_POLICY;
  run.triggeredByIncidentId = INCIDENT;
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  run.status = OnCallDutyPolicyStatus.Waiting;
  run.pagingStartsAt = data.pagingStartsAt;
  run.createdAt = new Date("2026-11-11T02:00:00.000Z");
  run.onCallPolicyExecutionRepeatCount = 1;

  if (data.isAiHeld) {
    run.aiHoldOutcome = OnCallPolicyAiHoldOutcome.Holding;
  }

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.isArchived = false;
  run.onCallDutyPolicy = policy;

  table.push(run);

  return run;
}

// Whether a run's column holds what a read's condition asks for.
function holds(value: unknown, wanted: unknown): boolean {
  if (wanted instanceof ObjectID || typeof wanted === "string") {
    return String(value) === String(wanted);
  }

  // A condition these reads make that is no plain value: not filtered on.
  return true;
}

function pageStartsOf(run: OnCallDutyPolicyExecutionLog): Array<Date | null> {
  return seen
    .filter((page: SeenPage): boolean => {
      return page.runId === run.id!.toString();
    })
    .map((page: SeenPage): Date | null => {
      return page.pageStart ? page.pageStart.startedAt : null;
    });
}

function claimOf(
  run: OnCallDutyPolicyExecutionLog,
): Record<string, unknown> | undefined {
  return claims.find((claim: { runId: string }): boolean => {
    return claim.runId === run.id!.toString();
  })?.values;
}

beforeEach(() => {
  table = [];
  claims = [];
  seen = [];
  now = WORKING_HOURS_START;
  runCount = 0;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(now);
  });

  // The runs' reads, each a fresh copy, as a read from the database is.
  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<OnCallDutyPolicyExecutionLog>> => {
      return table
        .filter((run: OnCallDutyPolicyExecutionLog): boolean => {
          return Object.entries(findBy.query).every(
            ([column, wanted]: [string, unknown]): boolean => {
              return holds(
                (run as unknown as Record<string, unknown>)[column],
                wanted,
              );
            },
          );
        })
        .map((run: OnCallDutyPolicyExecutionLog) => {
          return Object.assign(new OnCallDutyPolicyExecutionLog(), run);
        });
    }) as never);

  // The claim: one conditional UPDATE from Waiting, as Postgres runs it.
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
          (row: OnCallDutyPolicyExecutionLog): boolean => {
            return (
              row.id!.toString() === where._id && row.status === where.status
            );
          },
        );

        claims.push({
          runId: where._id,
          values: { ...values },
          won: Boolean(run),
        });

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

  // The incident, not acknowledged, and the P1 rule that pages right away.
  jest
    .spyOn(IncidentService, "isIncidentAcknowledged")
    .mockResolvedValue(false as never);

  jest.spyOn(IncidentService, "findOneById").mockImplementation((async () => {
    const incident: Incident = new Incident();
    incident.id = INCIDENT;
    incident.projectId = PROJECT;
    incident.title = "Card payments are failing";
    return incident;
  }) as never);

  jest
    .spyOn(IncidentOnCallRuleEngineService, "getPoliciesPagingNow")
    .mockResolvedValue(
      new Map<string, Array<string>>([
        [PLATFORM_POLICY.toString(), ["P1 pages right away"]],
        [PAYMENTS_POLICY.toString(), ["P1 pages right away"]],
      ]) as never,
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a rule that now matches the record starts its held run (WaitingRunsOnRecordChange)", () => {
  test("raised to P1 at 03:00, six hours before working hours: its page is due at 03:00, as it starts", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: WORKING_HOURS_START,
    });

    now = new Date("2026-11-11T03:00:00.000Z");

    expect(await WaitingRunsOnRecordChange.startForIncident(INCIDENT)).toBe(1);

    expect(seen).toEqual([
      {
        runId: run.id!.toString(),
        pageStart: {
          startedAt: new Date("2026-11-11T03:00:00.000Z"),
          start: OnCallPageStart.PageStarted,
        },
      },
    ]);
    // Started early, and says why.
    expect(String(claimOf(run)!["pagingStartedEarlyReason"])).toContain(
      "P1 pages right away",
    );
  });

  test.each([
    ["09:00:01, a second in", 1000],
    ["09:00:40, before the worker's tick", 40 * 1000],
    ["09:15:00, with the worker a quarter of an hour behind", 15 * MINUTE],
  ])(
    "raised to P1 at %s: due at 09:00, when its hold ran out",
    async (_name: string, afterInMs: number) => {
      const run: OnCallDutyPolicyExecutionLog = heldRun({
        pagingStartsAt: WORKING_HOURS_START,
      });

      now = new Date(WORKING_HOURS_START.getTime() + afterInMs);

      expect(await WaitingRunsOnRecordChange.startForIncident(INCIDENT)).toBe(
        1,
      );

      expect(pageStartsOf(run)).toEqual([WORKING_HOURS_START]);
    },
  );

  test("two held runs of the record, one past its moment and one not: each due by its own moment", async () => {
    const overdue: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: new Date("2026-11-11T08:30:00.000Z"),
      policyId: PLATFORM_POLICY,
    });
    const waiting: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: new Date("2026-11-11T10:00:00.000Z"),
      policyId: PAYMENTS_POLICY,
    });

    now = new Date("2026-11-11T08:31:10.000Z");

    expect(await WaitingRunsOnRecordChange.startForIncident(INCIDENT)).toBe(2);

    expect(pageStartsOf(overdue)).toEqual([
      new Date("2026-11-11T08:30:00.000Z"),
    ]);
    expect(pageStartsOf(waiting)).toEqual([
      new Date("2026-11-11T08:31:10.000Z"),
    ]);
  });

  test("the claim still moves each run's moment to when it started", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: WORKING_HOURS_START,
    });

    now = new Date("2026-11-11T09:02:00.000Z");

    await WaitingRunsOnRecordChange.startForIncident(INCIDENT);

    expect(claimOf(run)!["pagingStartsAt"]).toEqual(
      new Date("2026-11-11T09:02:00.000Z"),
    );
    expect(pageStartsOf(run)).toEqual([WORKING_HOURS_START]);
  });
});

describe("OneUptime AI hands its hold to people (AiFirstResponder)", () => {
  // OneUptime AI holds the page for ten minutes from 02:00.
  const HOLD_TIME_RUNS_OUT: Date = new Date("2026-11-11T02:10:00.000Z");

  test("handed off four minutes in - AI cannot fix it: due as it is handed off", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: HOLD_TIME_RUNS_OUT,
      isAiHeld: true,
    });

    now = new Date("2026-11-11T02:04:00.000Z");

    expect(
      await AiFirstResponder.handOff({
        projectId: PROJECT,
        incidentId: INCIDENT,
        reason: "OneUptime AI found no fix it can run.",
      }),
    ).toBe(1);

    expect(seen).toEqual([
      {
        runId: run.id!.toString(),
        pageStart: {
          startedAt: new Date("2026-11-11T02:04:00.000Z"),
          start: OnCallPageStart.PageStarted,
        },
      },
    ]);
    expect(claimOf(run)!["aiHoldOutcome"]).toBe(
      OnCallPolicyAiHoldOutcome.HandedOff,
    );
  });

  test("Page now pressed a minute in: due as it is pressed", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: HOLD_TIME_RUNS_OUT,
      isAiHeld: true,
    });

    now = new Date("2026-11-11T02:01:00.000Z");

    expect(
      await AiFirstResponder.pageNow({
        projectId: PROJECT,
        incidentId: INCIDENT,
      }),
    ).toBe(1);

    expect(pageStartsOf(run)).toEqual([new Date("2026-11-11T02:01:00.000Z")]);
    expect(claimOf(run)!["aiHoldOutcome"]).toBe(
      OnCallPolicyAiHoldOutcome.PageNowPressed,
    );
  });

  test("AI turned off for the project: every page it held goes to people, each due as it is handed off", async () => {
    const platform: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: HOLD_TIME_RUNS_OUT,
      policyId: PLATFORM_POLICY,
      isAiHeld: true,
    });
    const payments: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: new Date("2026-11-11T02:25:00.000Z"),
      policyId: PAYMENTS_POLICY,
      isAiHeld: true,
    });

    now = new Date("2026-11-11T02:06:30.000Z");

    await AiFirstResponder.onProjectAiSettingsChanged({
      projectId: PROJECT,
      isAiTurnedOff: true,
      isIncidentFixingTurnedOff: false,
      isAlertFixingTurnedOff: false,
    });

    expect(pageStartsOf(platform)).toEqual([
      new Date("2026-11-11T02:06:30.000Z"),
    ]);
    expect(pageStartsOf(payments)).toEqual([
      new Date("2026-11-11T02:06:30.000Z"),
    ]);
  });

  test("handed off twenty seconds after its hold time ran out, before the worker's tick: due when its hold time ran out", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun({
      pagingStartsAt: HOLD_TIME_RUNS_OUT,
      isAiHeld: true,
    });

    now = new Date("2026-11-11T02:10:20.000Z");

    await AiFirstResponder.handOff({
      projectId: PROJECT,
      incidentId: INCIDENT,
      reason: "OneUptime AI found no fix it can run.",
    });

    expect(pageStartsOf(run)).toEqual([HOLD_TIME_RUNS_OUT]);
  });
});

/*
 * Whoever starts a held run, its page is due at the moment the worker
 * would have decided by: its own, once that has come (the worker's
 * isOnCallPolicyRunWaitOver), and the moment it starts before then - never
 * later than it starts, never before its hold ran out unless it started
 * first.
 */
describe("whoever starts a held run, its page is due as the worker reads its moment", () => {
  test("minute by minute around 09:00, a rule match is due where the worker's own reading puts it", async () => {
    for (let minute: number = -3; minute <= 3; minute++) {
      table = [];
      seen = [];

      const run: OnCallDutyPolicyExecutionLog = heldRun({
        pagingStartsAt: WORKING_HOURS_START,
      });

      now = new Date(WORKING_HOURS_START.getTime() + minute * MINUTE + 25_000);

      await WaitingRunsOnRecordChange.startForIncident(INCIDENT);

      const dueAt: Date = pageStartsOf(run)[0]!;
      const isOver: boolean = isOnCallPolicyRunWaitOver({
        pagingStartsAt: WORKING_HOURS_START,
        now: now,
      });

      expect({ minute, dueAt }).toEqual({
        minute,
        dueAt: getOnCallPolicyRunPagingDueAt({
          pagingStartsAt: WORKING_HOURS_START,
          now: now,
        }),
      });
      expect({
        minute,
        dueAt: dueAt.toISOString(),
      }).toEqual({
        minute,
        dueAt: isOver ? WORKING_HOURS_START.toISOString() : now.toISOString(),
      });
      expect(dueAt.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  test("after it pages, nothing left in a page's start", async () => {
    heldRun({ pagingStartsAt: WORKING_HOURS_START });

    now = new Date("2026-11-11T09:05:00.000Z");

    await WaitingRunsOnRecordChange.startForIncident(INCIDENT);

    expect(seen).toHaveLength(1);
    expect(OnCallPageTiming.getPageStart()).toBeNull();
  });
});
