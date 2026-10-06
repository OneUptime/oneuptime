import InvestigationLimitCatchUp, {
  LIMIT_CATCH_UP_BATCH_SIZE,
  LIMIT_CATCH_UP_PROJECT_LOOKBACK_HOURS,
  LIMIT_CATCH_UP_WINDOW_HOURS,
  LimitCatchUpProjectResult,
} from "../../../../Server/Utils/AI/SRE/InvestigationLimitCatchUp";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import InvestigationEligibility from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService, {
  ProjectAiDailyLimitStatus,
} from "../../../../Server/Services/AIService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../../Types/AI/InvestigationNotStartedReason";
import { ProjectAiDailyLimit } from "../../../../Types/AI/ProjectAiDailyLimits";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Regression (found in #4410): an incident or alert created while the
 * project's own daily AI limit (Project Settings → AI Features → More
 * settings) was reached was skipped - its AI card says "project_daily_limit_
 * reached" - and nothing ever came back for it. After midnight UTC, when
 * the limit resets, it stayed uninvestigated however long it stayed open.
 *
 * InvestigationLimitCatchUp (run by a Workers job) now takes such records
 * back: once the limit no longer stops OneUptime AI - the reset, or an
 * owner raising or removing it - every one that is still open and less
 * than a day old goes through the new-record investigation path again,
 * once.
 *
 * The suite runs the real module against a small in-memory stand-in for the
 * incident and alert tables that applies the module's own query - project,
 * the states that count as open, the recorded reason, the age - and the
 * compare-and-set it takes a record off the waiting list with, so "only
 * open skipped records" and "no double runs" are checked, not assumed.
 */

const NOW: Date = new Date("2026-10-07T00:03:00.000Z");

type Lane = "Incident" | "Alert";

interface FakeRecord {
  lane: Lane;
  id: ObjectID;
  projectId: ObjectID;
  stateId: ObjectID;
  createdAt: Date;
  decision: InvestigationNotStartedReason | null;
}

interface FakeRun {
  projectId: ObjectID;
  lane: Lane;
  subjectId: ObjectID;
  status: AIRunStatus;
}

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-2222-4222-8222-222222222222",
);

// Each project's states: two open ones, then Resolved and a "Closed" after it.
const OPEN_INCIDENT_STATES: Array<ObjectID> = [
  ObjectID.generate(),
  ObjectID.generate(),
];
const RESOLVED_INCIDENT_STATE: ObjectID = ObjectID.generate();
const OPEN_ALERT_STATES: Array<ObjectID> = [
  ObjectID.generate(),
  ObjectID.generate(),
];
const RESOLVED_ALERT_STATE: ObjectID = ObjectID.generate();

let records: Array<FakeRecord> = [];
let runs: Array<FakeRun> = [];
let limitReached: (projectId: ObjectID) => boolean = () => {
  return false;
};
let queuedInLane: Record<Lane, number> = { Incident: 0, Alert: 0 };
let investigateIncident: jest.SpyInstance;
let investigateAlert: jest.SpyInstance;
let limitChecks: jest.SpyInstance;
let incidentQueries: Array<Record<string, unknown>> = [];
let alertQueries: Array<Record<string, unknown>> = [];

function decision(
  code: InvestigationNotStartedCode,
  evaluatedAt: Date = new Date("2026-10-06T20:00:00.000Z"),
): InvestigationNotStartedReason {
  return {
    ...InvestigationEligibility.reason(code, {
      projectId: PROJECT_A,
      incidentId: ObjectID.generate(),
    }),
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

function addRecord(
  values: Partial<FakeRecord> & { lane?: Lane } = {},
): FakeRecord {
  const lane: Lane = values.lane || "Incident";
  const record: FakeRecord = {
    lane,
    id: ObjectID.generate(),
    projectId: PROJECT_A,
    stateId:
      lane === "Incident" ? OPEN_INCIDENT_STATES[0]! : OPEN_ALERT_STATES[0]!,
    createdAt: new Date("2026-10-06T20:00:00.000Z"),
    decision: decision("project_daily_limit_reached"),
    ...values,
  };
  records.push(record);
  return record;
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function reachedStatus(): ProjectAiDailyLimitStatus {
  return {
    tokenLimit: 1000,
    spendLimitInUSD: null,
    reachedLimit: ProjectAiDailyLimit.Tokens,
    usage: { usedTokensToday: 1000, spentTodayInUSDCents: 0 },
    isSpendCounted: false,
    resetsAt: new Date("2026-10-08T00:00:00.000Z"),
  };
}

// The values a FindOperator built by QueryHelper binds (Raw parameters).
function operatorParameters(value: unknown): Array<unknown> {
  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    value as { objectLiteralParameters?: Record<string, unknown> };

  return Object.values(operator?.objectLiteralParameters || {});
}

function operatorSql(value: unknown): string {
  const operator: { getSql?: ((alias: string) => string) | undefined } =
    value as { getSql?: ((alias: string) => string) | undefined };

  return operator.getSql?.("column") || "";
}

/*
 * The candidate read, as Postgres would answer it: this project, a state
 * the query names, a recorded reason containing the query's JSON, created
 * at or after the query's time, newest first, at most `limit`.
 */
function answerCandidateQuery(
  lane: Lane,
  data: {
    query: Record<string, unknown>;
    limit?: PositiveNumber | number | undefined;
    sort?: Record<string, unknown> | undefined;
  },
): Array<Incident | Alert> {
  const query: Record<string, unknown> = data.query;
  const stateColumn: string =
    lane === "Incident" ? "currentIncidentStateId" : "currentAlertStateId";

  const allowedStates: Array<string> =
    (
      operatorParameters(query[stateColumn])[0] as Array<string> | undefined
    )?.map((id: string) => {
      return id.toString();
    }) || [];

  const contained: Record<string, unknown> = JSON.parse(
    operatorParameters(query["aiInvestigationDecision"])[0] as string,
  );

  const createdSince: Date = operatorParameters(query["createdAt"])[0] as Date;

  const limit: number =
    data.limit instanceof PositiveNumber
      ? data.limit.toNumber()
      : (data.limit as number);

  return records
    .filter((record: FakeRecord): boolean => {
      return (
        record.lane === lane &&
        record.projectId.toString() ===
          (query["projectId"] as ObjectID).toString() &&
        allowedStates.includes(record.stateId.toString()) &&
        record.decision !== null &&
        Object.entries(contained).every(([key, value]: [string, unknown]) => {
          return (
            (record.decision as unknown as Record<string, unknown>)[key] ===
            value
          );
        }) &&
        record.createdAt.getTime() >= createdSince.getTime()
      );
    })
    .sort((a: FakeRecord, b: FakeRecord): number => {
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, limit)
    .map((record: FakeRecord): Incident | Alert => {
      return {
        id: record.id,
        _id: record.id.toString(),
        projectId: record.projectId,
        createdAt: record.createdAt,
        // The column comes back parsed, as a fresh object.
        aiInvestigationDecision: record.decision
          ? JSON.parse(JSON.stringify(record.decision))
          : null,
      } as unknown as Incident | Alert;
    });
}

/*
 * The compare-and-set that takes a record off the waiting list: it writes
 * only while the column still holds exactly what the caller read.
 */
function compareAndSet(
  lane: Lane,
  input: {
    id: ObjectID;
    data: Record<string, unknown>;
    expectedData: Record<string, unknown>;
  },
): boolean {
  const record: FakeRecord | undefined = records.find(
    (candidate: FakeRecord): boolean => {
      return (
        candidate.lane === lane &&
        candidate.id.toString() === input.id.toString()
      );
    },
  );

  if (!record) {
    return false;
  }

  if (
    JSON.stringify(record.decision) !==
    JSON.stringify(input.expectedData["aiInvestigationDecision"] ?? null)
  ) {
    return false;
  }

  record.decision =
    (input.data["aiInvestigationDecision"] as InvestigationNotStartedReason) ??
    null;
  return true;
}

function countRuns(query: Record<string, unknown>): number {
  if (query["status"] === AIRunStatus.Queued) {
    const isIncidentLane: boolean = operatorSql(
      query["triggeredByIncidentId"],
    ).includes("IS NOT NULL");

    return queuedInLane[isIncidentLane ? "Incident" : "Alert"];
  }

  const subjectId: ObjectID | undefined = (query["triggeredByIncidentId"] ||
    query["triggeredByAlertId"]) as ObjectID | undefined;

  return runs.filter((run: FakeRun): boolean => {
    return (
      run.projectId.toString() ===
        (query["projectId"] as ObjectID).toString() &&
      run.subjectId.toString() === subjectId?.toString() &&
      query["runType"] === AIRunType.Investigation
    );
  }).length;
}

function findRecord(id: ObjectID): FakeRecord {
  return records.find((record: FakeRecord): boolean => {
    return record.id.toString() === id.toString();
  })!;
}

/*
 * What the new-record investigation path does, by default: it queues a run
 * (the record has an investigation now). A test can make it record another
 * reason instead, as the real gates would.
 */
let runnerOutcome: (
  record: FakeRecord,
) => InvestigationNotStartedCode | null = () => {
  return null;
};

function runRunner(lane: Lane, subjectId: ObjectID): boolean {
  const record: FakeRecord = findRecord(subjectId);
  const skippedWith: InvestigationNotStartedCode | null = runnerOutcome(record);

  if (skippedWith) {
    // recordSkipped: only when nothing is recorded (the first decision wins).
    if (record.decision === null) {
      record.decision = decision(skippedWith, new Date(NOW.getTime() + 1));
    }
    return false;
  }

  runs.push({
    projectId: record.projectId,
    lane,
    subjectId,
    status: AIRunStatus.Queued,
  });
  return true;
}

/*
 * What stops OneUptime AI for a whole lane now, as the new-record gate
 * (AIInvestigationEngine.getDisabledReason) and the lane's own daily token
 * limit (AIService.getAutonomousDailyBudgetStatus) would say.
 */
let lanePausedBy: Record<Lane, InvestigationNotStartedCode | null> = {
  Incident: null,
  Alert: null,
};
let laneBudgetSpent: Record<Lane, boolean> = { Incident: false, Alert: false };
let laneGate: jest.SpyInstance;

beforeEach(() => {
  records = [];
  runs = [];
  incidentQueries = [];
  alertQueries = [];
  queuedInLane = { Incident: 0, Alert: 0 };
  lanePausedBy = { Incident: null, Alert: null };
  laneBudgetSpent = { Incident: false, Alert: false };
  limitReached = () => {
    return false;
  };
  runnerOutcome = () => {
    return null;
  };

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });

  // The one rule for resolved (Common/Utils/ResolvedState) names the open states.
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockImplementation(async () => {
      return [...OPEN_INCIDENT_STATES];
    });
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockImplementation(async () => {
      return [...OPEN_ALERT_STATES];
    });

  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(async (data: unknown) => {
      const findBy: { query: Record<string, unknown> } = data as {
        query: Record<string, unknown>;
      };
      incidentQueries.push(findBy.query);
      return answerCandidateQuery(
        "Incident",
        data as Parameters<typeof answerCandidateQuery>[1],
      ) as Array<Incident>;
    });
  jest
    .spyOn(AlertService, "findBy")
    .mockImplementation(async (data: unknown) => {
      const findBy: { query: Record<string, unknown> } = data as {
        query: Record<string, unknown>;
      };
      alertQueries.push(findBy.query);
      return answerCandidateQuery(
        "Alert",
        data as Parameters<typeof answerCandidateQuery>[1],
      ) as Array<Alert>;
    });

  jest
    .spyOn(IncidentService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(async (input: unknown) => {
      return compareAndSet(
        "Incident",
        input as Parameters<typeof compareAndSet>[1],
      );
    });
  jest
    .spyOn(AlertService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(async (input: unknown) => {
      return compareAndSet(
        "Alert",
        input as Parameters<typeof compareAndSet>[1],
      );
    });

  jest
    .spyOn(AIRunService, "countBy")
    .mockImplementation(async (data: unknown) => {
      return new PositiveNumber(
        countRuns((data as { query: Record<string, unknown> }).query),
      );
    });

  limitChecks = jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockImplementation(async (data: { projectId: ObjectID }) => {
      return limitReached(data.projectId) ? reachedStatus() : null;
    });

  laneGate = jest
    .spyOn(AIInvestigationEngine, "getDisabledReason")
    .mockImplementation(
      async (projectId: ObjectID, subjectType: "Incident" | "Alert") => {
        // Ordered like the real gate: the project's limit is checked last.
        return (
          lanePausedBy[subjectType] ||
          (limitReached(projectId) ? "project_daily_limit_reached" : null)
        );
      },
    );

  jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockImplementation(
    async (
      _projectId: ObjectID,
      subject?: {
        incidentId?: ObjectID | undefined;
        alertId?: ObjectID | undefined;
      },
    ) => {
      const lane: Lane = subject?.incidentId ? "Incident" : "Alert";
      return {
        exhausted: laneBudgetSpent[lane],
        limitInTokens: laneBudgetSpent[lane] ? 1000 : null,
        usedTokensToday: laneBudgetSpent[lane] ? 1000 : 0,
      };
    },
  );

  investigateIncident = jest
    .spyOn(AIIncidentInvestigationRunner, "investigateNewIncident")
    .mockImplementation(async (data: { incidentId: ObjectID }) => {
      return runRunner("Incident", data.incidentId);
    });
  investigateAlert = jest
    .spyOn(AIAlertInvestigationRunner, "investigateNewAlert")
    .mockImplementation(async (data: { alertId: ObjectID }) => {
      return runRunner("Alert", data.alertId);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function investigatedIncidentIds(): Array<string> {
  return investigateIncident.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { incidentId: ObjectID }).incidentId.toString();
  });
}

function investigatedAlertIds(): Array<string> {
  return investigateAlert.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { alertId: ObjectID }).alertId.toString();
  });
}

describe("after the reset, skipped incidents and alerts that are still open are investigated", () => {
  test("an open incident skipped by the project's daily limit is investigated once the limit no longer stops AI", async () => {
    const incident: FakeRecord = addRecord();

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).toHaveBeenCalledTimes(1);
    expect(investigateIncident).toHaveBeenCalledWith({
      incidentId: incident.id,
      projectId: PROJECT_A,
    });
    // Off the waiting list: the run is what its AI card shows now.
    expect(findRecord(incident.id).decision).toBeNull();
    expect(runs).toHaveLength(1);
  });

  test("an open alert the same way, through the alert path", async () => {
    const alert: FakeRecord = addRecord({ lane: "Alert" });

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateAlert).toHaveBeenCalledWith({
      alertId: alert.id,
      projectId: PROJECT_A,
    });
    expect(investigateIncident).not.toHaveBeenCalled();
  });

  test("the result says what was done, lane by lane", async () => {
    addRecord();
    addRecord({ lane: "Alert" });
    addRecord({ lane: "Alert" });

    const result: LimitCatchUpProjectResult =
      await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(result.limitStillReached).toBe(false);
    expect(
      result.lanes.map((lane: { lane: Lane; investigated: number }) => {
        return [lane.lane, lane.investigated];
      }),
    ).toEqual([
      ["Incident", 1],
      ["Alert", 2],
    ]);
  });
});

describe("only the records the limit skipped, still open, less than a day old", () => {
  test("never a resolved one: the read asks only for the states that count as open", async () => {
    const open: FakeRecord = addRecord();
    addRecord({ stateId: RESOLVED_INCIDENT_STATE });
    addRecord({ lane: "Alert", stateId: RESOLVED_ALERT_STATE });

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigatedIncidentIds()).toEqual([open.id.toString()]);
    expect(investigateAlert).not.toHaveBeenCalled();
    expect(
      IncidentStateService.getUnresolvedIncidentStateIds,
    ).toHaveBeenCalledWith(PROJECT_A);
    expect(AlertStateService.getUnresolvedAlertStateIds).toHaveBeenCalledWith(
      PROJECT_A,
    );

    const stateFilter: Array<string> = operatorParameters(
      incidentQueries[0]!["currentIncidentStateId"],
    )[0] as Array<string>;

    expect([...stateFilter].sort()).toEqual(
      OPEN_INCIDENT_STATES.map((id: ObjectID) => {
        return id.toString();
      }).sort(),
    );
  });

  test("a record that became resolved before the reset is left alone", async () => {
    const incident: FakeRecord = addRecord();
    incident.stateId = RESOLVED_INCIDENT_STATE;

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).not.toHaveBeenCalled();
    // Its card still says why it was not investigated.
    expect(findRecord(incident.id).decision?.code).toBe(
      "project_daily_limit_reached",
    );
  });

  test("only the daily limit's reason: records skipped for any other reason stay as they are", async () => {
    const skipped: FakeRecord = addRecord();
    const others: Array<FakeRecord> = (
      [
        "daily_budget_exhausted",
        "severity_below_threshold",
        "monitor_cooldown",
        "ai_disabled",
        "insufficient_ai_balance",
        "created_resolved",
      ] as Array<InvestigationNotStartedCode>
    ).map((code: InvestigationNotStartedCode): FakeRecord => {
      return addRecord({ decision: decision(code) });
    });
    const neverSkipped: FakeRecord = addRecord({ decision: null });

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigatedIncidentIds()).toEqual([skipped.id.toString()]);

    for (const other of others) {
      expect(findRecord(other.id).decision?.code).toBe(other.decision?.code);
    }
    expect(findRecord(neverSkipped.id).decision).toBeNull();

    expect(
      operatorSql(incidentQueries[0]!["aiInvestigationDecision"]),
    ).toContain("@>");
    expect(
      JSON.parse(
        operatorParameters(
          incidentQueries[0]!["aiInvestigationDecision"],
        )[0] as string,
      ),
    ).toEqual({ code: "project_daily_limit_reached" });
  });

  test(`a record more than ${LIMIT_CATCH_UP_WINDOW_HOURS} hours old is not investigated late`, async () => {
    const recent: FakeRecord = addRecord({ createdAt: hoursAgo(23) });
    addRecord({ createdAt: hoursAgo(25) });

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigatedIncidentIds()).toEqual([recent.id.toString()]);
    expect(
      (
        operatorParameters(incidentQueries[0]!["createdAt"])[0] as Date
      ).getTime(),
    ).toBe(hoursAgo(LIMIT_CATCH_UP_WINDOW_HOURS).getTime());
  });

  test("only this project's records", async () => {
    const mine: FakeRecord = addRecord();
    addRecord({ projectId: PROJECT_B });

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigatedIncidentIds()).toEqual([mine.id.toString()]);
    expect(incidentQueries[0]!["projectId"]).toEqual(PROJECT_A);
  });
});

describe("once each: no double runs", () => {
  test("a record whose investigation was queued is never picked again", async () => {
    addRecord();

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);
    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);
    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(1);
  });

  test("two workers running at the same moment investigate each record once between them", async () => {
    for (let index: number = 0; index < 4; index++) {
      addRecord({ createdAt: hoursAgo(index + 1) });
      addRecord({ lane: "Alert", createdAt: hoursAgo(index + 1) });
    }

    await Promise.all([
      InvestigationLimitCatchUp.catchUpProject(PROJECT_A),
      InvestigationLimitCatchUp.catchUpProject(PROJECT_A),
      InvestigationLimitCatchUp.catchUpProject(PROJECT_A),
    ]);

    expect(investigatedIncidentIds()).toHaveLength(4);
    expect(new Set(investigatedIncidentIds()).size).toBe(4);
    expect(investigatedAlertIds()).toHaveLength(4);
    expect(new Set(investigatedAlertIds()).size).toBe(4);
    expect(runs).toHaveLength(8);
  });

  test("a record that was investigated since it was skipped (someone asked AI to) gets no second run, and leaves the waiting list", async () => {
    const incident: FakeRecord = addRecord();
    runs.push({
      projectId: PROJECT_A,
      lane: "Incident",
      subjectId: incident.id,
      status: AIRunStatus.Completed,
    });

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).not.toHaveBeenCalled();
    expect(findRecord(incident.id).decision).toBeNull();

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);
    expect(investigateIncident).not.toHaveBeenCalled();
    expect(runs).toHaveLength(1);
  });

  test("the claim compares the whole recorded reason, so a record whose reason changed after it was read is not taken", async () => {
    const incident: FakeRecord = addRecord();

    (
      IncidentService.compareAndSetColumnsByIdWithoutHooks as unknown as jest.Mock
    ).mockImplementationOnce(async (input: unknown) => {
      // Another worker re-recorded it between the read and the claim.
      findRecord(incident.id).decision = decision(
        "project_daily_limit_reached",
        new Date("2026-10-07T00:02:59.000Z"),
      );
      return compareAndSet(
        "Incident",
        input as Parameters<typeof compareAndSet>[1],
      );
    });

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).not.toHaveBeenCalled();
    expect(
      IncidentService.compareAndSetColumnsByIdWithoutHooks,
    ).toHaveBeenCalledWith({
      id: incident.id,
      data: { aiInvestigationDecision: null },
      expectedData: {
        aiInvestigationDecision: JSON.parse(
          JSON.stringify(decision("project_daily_limit_reached")),
        ),
      },
      skipUpdateDateColumn: true,
    });
  });
});

describe("the limits still apply", () => {
  test("while the project's limit still stops AI, the records keep waiting", async () => {
    const incident: FakeRecord = addRecord();
    const alert: FakeRecord = addRecord({ lane: "Alert" });
    limitReached = () => {
      return true;
    };

    const result: LimitCatchUpProjectResult =
      await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(result.limitStillReached).toBe(true);
    expect(investigateIncident).not.toHaveBeenCalled();
    expect(investigateAlert).not.toHaveBeenCalled();
    expect(findRecord(incident.id).decision?.code).toBe(
      "project_daily_limit_reached",
    );
    expect(findRecord(alert.id).decision?.code).toBe(
      "project_daily_limit_reached",
    );
  });

  test("an owner raising or removing the limit lets them through the same day", async () => {
    const incident: FakeRecord = addRecord({ createdAt: hoursAgo(2) });
    limitReached = () => {
      return true;
    };

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);
    expect(investigateIncident).not.toHaveBeenCalled();

    // The limit was raised: nothing stops AI any more.
    limitReached = () => {
      return false;
    };
    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigatedIncidentIds()).toEqual([incident.id.toString()]);
  });

  test("it stops as soon as the limit is reached again, leaving the rest for the next reset", async () => {
    const newest: FakeRecord = addRecord({ createdAt: hoursAgo(1) });
    const older: FakeRecord = addRecord({ createdAt: hoursAgo(2) });
    const alert: FakeRecord = addRecord({
      lane: "Alert",
      createdAt: hoursAgo(1),
    });

    // The first investigation brings the project to its limit.
    limitReached = () => {
      return runs.length > 0;
    };

    const result: LimitCatchUpProjectResult =
      await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigatedIncidentIds()).toEqual([newest.id.toString()]);
    expect(investigateAlert).not.toHaveBeenCalled();
    expect(result.limitStillReached).toBe(true);
    expect(findRecord(older.id).decision?.code).toBe(
      "project_daily_limit_reached",
    );
    expect(findRecord(alert.id).decision?.code).toBe(
      "project_daily_limit_reached",
    );
  });

  test("a record the limit stops again waits for the following reset, then is investigated", async () => {
    const incident: FakeRecord = addRecord({ createdAt: hoursAgo(3) });

    // The investigation path finds the limit reached again when it gets there.
    runnerOutcome = () => {
      return "project_daily_limit_reached";
    };
    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(0);
    expect(findRecord(incident.id).decision?.code).toBe(
      "project_daily_limit_reached",
    );

    runnerOutcome = () => {
      return null;
    };
    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).toHaveBeenCalledTimes(2);
    expect(runs).toHaveLength(1);
  });

  test("it goes through the new-record gates: whatever stops it now is recorded instead, and it is not tried again", async () => {
    const incident: FakeRecord = addRecord();
    const alert: FakeRecord = addRecord({ lane: "Alert" });

    runnerOutcome = (record: FakeRecord) => {
      return record.lane === "Incident"
        ? "severity_below_threshold"
        : "daily_budget_exhausted";
    };

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);
    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).toHaveBeenCalledTimes(1);
    expect(investigateAlert).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(0);
    expect(findRecord(incident.id).decision?.code).toBe(
      "severity_below_threshold",
    );
    expect(findRecord(alert.id).decision?.code).toBe("daily_budget_exhausted");
  });

  test("it adds work only to a lane whose queue is empty: queued runs (a concurrency cap) go first", async () => {
    addRecord();
    const alert: FakeRecord = addRecord({ lane: "Alert" });
    queuedInLane = { Incident: 2, Alert: 0 };

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).not.toHaveBeenCalled();
    expect(investigatedAlertIds()).toEqual([alert.id.toString()]);

    // The incident lane's queue drained: its record is taken next time.
    queuedInLane = { Incident: 0, Alert: 0 };
    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).toHaveBeenCalledTimes(1);
  });

  test(`it takes at most ${LIMIT_CATCH_UP_BATCH_SIZE} records of a lane per run, the most recent first`, async () => {
    const created: Array<FakeRecord> = [];

    for (
      let index: number = 0;
      index < LIMIT_CATCH_UP_BATCH_SIZE + 3;
      index++
    ) {
      created.push(addRecord({ createdAt: hoursAgo(index + 1) }));
    }

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigatedIncidentIds()).toEqual(
      created.slice(0, LIMIT_CATCH_UP_BATCH_SIZE).map((record: FakeRecord) => {
        return record.id.toString();
      }),
    );

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);
    expect(investigateIncident).toHaveBeenCalledTimes(
      LIMIT_CATCH_UP_BATCH_SIZE + 3,
    );
  });

  test("a project with nothing waiting costs no limit check", async () => {
    addRecord({ decision: decision("monitor_cooldown") });

    await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(limitChecks).not.toHaveBeenCalled();
    expect(laneGate).not.toHaveBeenCalled();
    expect(AIService.getAutonomousDailyBudgetStatus).not.toHaveBeenCalled();
    expect(AIRunService.countBy).not.toHaveBeenCalled();
  });

  test.each([
    "ai_disabled",
    "automatic_investigation_disabled",
    "provider_missing",
    "insufficient_ai_balance",
  ] as Array<InvestigationNotStartedCode>)(
    "what stops AI for the whole lane now (%s) leaves its records waiting, untouched, and the other lane goes on",
    async (code: InvestigationNotStartedCode) => {
      const incident: FakeRecord = addRecord();
      const alert: FakeRecord = addRecord({ lane: "Alert" });
      lanePausedBy = { Incident: code, Alert: null };

      const result: LimitCatchUpProjectResult =
        await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

      expect(investigateIncident).not.toHaveBeenCalled();
      // Its card still says the daily limit stopped it, which stays true.
      expect(findRecord(incident.id).decision).toEqual(
        decision("project_daily_limit_reached"),
      );
      expect(result.lanes[0]).toEqual(
        expect.objectContaining({ lane: "Incident", pausedBy: code }),
      );
      expect(result.limitStillReached).toBe(false);
      expect(laneGate).toHaveBeenCalledWith(PROJECT_A, "Incident");

      expect(investigatedAlertIds()).toEqual([alert.id.toString()]);

      // Turned back on while the record may still wait: it is investigated.
      lanePausedBy = { Incident: null, Alert: null };
      await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);
      expect(investigatedIncidentIds()).toEqual([incident.id.toString()]);
    },
  );

  test("the lane's own daily token limit spent: its records wait, untouched; the other lane goes on", async () => {
    const incident: FakeRecord = addRecord();
    const alert: FakeRecord = addRecord({ lane: "Alert" });
    laneBudgetSpent = { Incident: true, Alert: false };

    const result: LimitCatchUpProjectResult =
      await InvestigationLimitCatchUp.catchUpProject(PROJECT_A);

    expect(investigateIncident).not.toHaveBeenCalled();
    expect(findRecord(incident.id).decision?.code).toBe(
      "project_daily_limit_reached",
    );
    expect(result.lanes[0]).toEqual(
      expect.objectContaining({
        lane: "Incident",
        pausedBy: "daily_budget_exhausted",
      }),
    );
    expect(AIService.getAutonomousDailyBudgetStatus).toHaveBeenCalledWith(
      PROJECT_A,
      { incidentId: incident.id },
    );
    expect(investigatedAlertIds()).toEqual([alert.id.toString()]);
    expect(AIService.getAutonomousDailyBudgetStatus).toHaveBeenCalledWith(
      PROJECT_A,
      { alertId: alert.id },
    );
  });
});

describe("which projects are looked at", () => {
  test(`only projects that reached a daily limit in the last ${LIMIT_CATCH_UP_PROJECT_LOOKBACK_HOURS} hours, each once`, async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(ProjectService, "findBy")
      .mockImplementation(async (data: unknown) => {
        const query: Record<string, unknown> = (
          data as { query: Record<string, unknown> }
        ).query;

        if (query["aiDailyTokenLimitReachedAt"]) {
          return [
            { id: PROJECT_A, _id: PROJECT_A.toString() },
            { id: PROJECT_B, _id: PROJECT_B.toString() },
          ] as unknown as Array<Project>;
        }

        return [
          { id: PROJECT_B, _id: PROJECT_B.toString() },
        ] as unknown as Array<Project>;
      });

    const projectIds: Array<ObjectID> =
      await InvestigationLimitCatchUp.getProjectIds();

    expect(
      projectIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([PROJECT_A.toString(), PROJECT_B.toString()]);
    expect(findBy).toHaveBeenCalledTimes(2);

    const since: Date = hoursAgo(LIMIT_CATCH_UP_PROJECT_LOOKBACK_HOURS);

    for (const column of [
      "aiDailyTokenLimitReachedAt",
      "aiDailySpendLimitReachedAt",
    ]) {
      const call: Array<unknown> | undefined = findBy.mock.calls.find(
        (args: Array<unknown>): boolean => {
          return Boolean(
            (args[0] as { query: Record<string, unknown> }).query[column],
          );
        },
      );

      expect(call).toBeDefined();
      const query: Record<string, unknown> = (
        call![0] as { query: Record<string, unknown> }
      ).query;
      expect(operatorSql(query[column])).toContain(">=");
      expect((operatorParameters(query[column])[0] as Date).getTime()).toBe(
        since.getTime(),
      );
      expect((call![0] as { props: unknown }).props).toEqual({ isRoot: true });
    }
  });

  test("run() catches up every such project, and one project's failure does not stop the others", async () => {
    jest
      .spyOn(InvestigationLimitCatchUp, "getProjectIds")
      .mockResolvedValue([PROJECT_A, PROJECT_B]);

    const incidentA: FakeRecord = addRecord();
    const incidentB: FakeRecord = addRecord({ projectId: PROJECT_B });

    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });

    (
      IncidentStateService.getUnresolvedIncidentStateIds as unknown as jest.Mock
    ).mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });

    await expect(InvestigationLimitCatchUp.run()).resolves.toBeDefined();

    expect(investigatedIncidentIds()).toEqual([incidentB.id.toString()]);
    expect(findRecord(incidentA.id).decision?.code).toBe(
      "project_daily_limit_reached",
    );
    expect(error).toHaveBeenCalled();
  });

  test("run() never throws, even when the projects cannot be read", async () => {
    jest
      .spyOn(InvestigationLimitCatchUp, "getProjectIds")
      .mockRejectedValue(new Error("database unavailable"));
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    await expect(InvestigationLimitCatchUp.run()).resolves.toEqual([]);
  });
});
