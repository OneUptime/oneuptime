import InvestigationEligibility from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AIIncidentInvestigationRunner, {
  IncidentGateDecision,
} from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIRunService from "../../../../Server/Services/AIRunService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import ProjectService from "../../../../Server/Services/ProjectService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunType from "../../../../Types/AI/AIRunType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import InvestigationRules from "../../../../Server/Utils/AI/SRE/InvestigationRules";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Cost gates for autonomous INCIDENT investigations.
 *
 * A project may narrow which incidents are investigated with a severity floor
 * and a per-monitor cooldown. These tests lock in the gates AND that both are
 * opt-in, so a project that never touched them has every incident
 * investigated:
 *
 *   - the severity floor is UNSET by default — every severity is
 *     investigated;
 *   - the cooldown is OFF by default (it used to default to 30 minutes, which
 *     silently skipped a repeat incident on a monitor investigated within
 *     the half hour);
 *   - an incident affects a SET of monitors, so the dedupe key is "any of
 *     them" — a storm that opens several incidents is the case a configured
 *     cooldown exists for.
 *
 * Fail directions are asserted explicitly: an incident whose severity order is
 * unknown PASSES the severity gate (it only filters known-low severities), and
 * a deleted floor severity falls back to no floor rather than to
 * investigate-nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const MONITOR_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_B: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);

function fakeIncident(data: {
  monitorIds?: Array<ObjectID>;
  severityOrder?: number | undefined;
}): Incident {
  return {
    id: INCIDENT_ID,
    monitors: (data.monitorIds || []).map((id: ObjectID) => {
      return { _id: id.toString() };
    }),
    incidentSeverity:
      data.severityOrder !== undefined
        ? ({ order: data.severityOrder } as IncidentSeverity)
        : undefined,
  } as unknown as Incident;
}

function mockProject(
  overrides: {
    minimumSeverityId?: ObjectID | undefined;
    dedupeWindowMinutes?: number | undefined;
  } = {},
): void {
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    incidentInvestigationMinimumSeverityId: overrides.minimumSeverityId,
    incidentInvestigationDedupeWindowMinutes: overrides.dedupeWindowMinutes,
  } as unknown as Project);
}

function mockRecentRunCount(count: number): jest.SpyInstance {
  return jest
    .spyOn(AIRunService, "countBy")
    .mockResolvedValue(new PositiveNumber(count));
}

function gate(): Promise<IncidentGateDecision> {
  return AIIncidentInvestigationRunner.shouldInvestigateIncident({
    incidentId: INCIDENT_ID,
    projectId: PROJECT_ID,
  });
}

// No investigation rule unless a test sets some: every incident is in scope.
beforeEach(() => {
  jest
    .spyOn(InvestigationRules, "getIncidentScope")
    .mockResolvedValue({ isInScope: true, rulesChecked: 0 });
});

describe("AIIncidentInvestigationRunner.shouldInvestigateIncident — investigation rules", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an incident no rule matches is not investigated, whatever its severity, and says how many rules there are", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        fakeIncident({ monitorIds: [MONITOR_A, MONITOR_B], severityOrder: 1 }),
      );
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: false, rulesChecked: 3 });
    const project: jest.SpyInstance = jest.spyOn(ProjectService, "findOneById");
    const runs: jest.SpyInstance = mockRecentRunCount(0);

    const decision: IncidentGateDecision = await gate();

    expect(decision).toMatchObject({
      investigate: false,
      notStartedCode: "no_investigation_rule_matched",
      notStartedDetails: { rulesChecked: 3 },
      monitorId: MONITOR_A,
    });
    expect(decision.reason).toContain("investigation rules");
    // Checked first: neither the floor nor the cooldown is read.
    expect(project).not.toHaveBeenCalled();
    expect(runs).not.toHaveBeenCalled();
  });

  test("an incident a rule matches goes on to the other gates", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ severityOrder: 3 }));
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 2 });
    mockProject({ minimumSeverityId: SEVERITY_ID });
    jest
      .spyOn(IncidentSeverityService, "findOneById")
      .mockResolvedValue({ order: 1, name: "Critical" } as never);

    const decision: IncidentGateDecision = await gate();

    expect(decision.investigate).toBe(false);
    expect(decision.notStartedCode).toBe("severity_below_threshold");
  });

  test("the rules see the incident with what they match on", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({}));
    const scope: jest.SpyInstance = jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 0 });
    mockProject({});
    mockRecentRunCount(0);

    expect((await gate()).investigate).toBe(true);
    expect(read.mock.calls[0]![0]).toMatchObject({
      id: INCIDENT_ID,
      select: {
        title: true,
        description: true,
        incidentSeverityId: true,
        labels: { _id: true },
        monitors: { _id: true },
      },
      props: { isRoot: true },
    });
    expect(scope).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incident: expect.objectContaining({ id: INCIDENT_ID }),
    });
  });
});

describe("AIIncidentInvestigationRunner.shouldInvestigateIncident — severity floor", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The behaviour-preservation invariant. Before this gate existed every
   * incident was investigated; with no configured floor that must still be
   * true, or upgrading silently removes analysis someone relied on.
   */
  test("no configured floor investigates every severity, including the lowest", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ severityOrder: 99 }));
    mockProject({});
    mockRecentRunCount(0);

    const decision: IncidentGateDecision = await gate();

    expect(decision.investigate).toBe(true);
  });

  test("an incident above the floor is investigated", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ severityOrder: 1 }));
    mockProject({ minimumSeverityId: SEVERITY_ID });
    jest
      .spyOn(IncidentSeverityService, "findOneById")
      .mockResolvedValue({ order: 2 } as unknown as IncidentSeverity);
    mockRecentRunCount(0);

    expect((await gate()).investigate).toBe(true);
  });

  // Lower order = higher severity, so equal order still qualifies.
  test("an incident exactly at the floor is investigated", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ severityOrder: 2 }));
    mockProject({ minimumSeverityId: SEVERITY_ID });
    jest
      .spyOn(IncidentSeverityService, "findOneById")
      .mockResolvedValue({ order: 2 } as unknown as IncidentSeverity);
    mockRecentRunCount(0);

    expect((await gate()).investigate).toBe(true);
  });

  test("an incident below the floor is skipped, and says why", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ severityOrder: 5 }));
    mockProject({ minimumSeverityId: SEVERITY_ID });
    jest
      .spyOn(IncidentSeverityService, "findOneById")
      .mockResolvedValue({ order: 2 } as unknown as IncidentSeverity);

    const decision: IncidentGateDecision = await gate();

    expect(decision.investigate).toBe(false);
    expect(decision.reason).toContain("below the investigation floor");
  });

  /*
   * The severity gate only filters KNOWN-low severities. An incident with no
   * severity set must not be silently dropped.
   */
  test("an incident with no severity passes the floor", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({}));
    mockProject({ minimumSeverityId: SEVERITY_ID });
    jest
      .spyOn(IncidentSeverityService, "findOneById")
      .mockResolvedValue({ order: 1 } as unknown as IncidentSeverity);
    mockRecentRunCount(0);

    expect((await gate()).investigate).toBe(true);
  });

  /*
   * A configured floor severity that was later deleted must fall back to "no
   * floor" — the opposite fallback would quietly stop investigating
   * everything, which is the worst possible failure for a safety gate.
   */
  test("a deleted floor severity falls back to no floor", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ severityOrder: 99 }));
    mockProject({ minimumSeverityId: SEVERITY_ID });
    jest.spyOn(IncidentSeverityService, "findOneById").mockResolvedValue(null);
    mockRecentRunCount(0);

    expect((await gate()).investigate).toBe(true);
  });

  test("a floor severity with no order falls back to no floor", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ severityOrder: 99 }));
    mockProject({ minimumSeverityId: SEVERITY_ID });
    jest
      .spyOn(IncidentSeverityService, "findOneById")
      .mockResolvedValue({} as unknown as IncidentSeverity);
    mockRecentRunCount(0);

    expect((await gate()).investigate).toBe(true);
  });

  test("no severity lookup happens when no floor is configured", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ severityOrder: 99 }));
    mockProject({});
    mockRecentRunCount(0);
    const severityLookup: jest.SpyInstance = jest.spyOn(
      IncidentSeverityService,
      "findOneById",
    );

    await gate();

    expect(severityLookup).not.toHaveBeenCalled();
  });
});

describe("AIIncidentInvestigationRunner.shouldInvestigateIncident — dedupe window", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A cooldown a project set, for the tests about how a set window behaves.
  const COOLDOWN_MINUTES: number = 30;

  /*
   * The headline change for incidents: no cooldown unless one is set, so an
   * incident on a monitor that was investigated a minute ago is investigated
   * too — and nothing is even looked up to decide that.
   */
  test("with no configured cooldown, a just-investigated monitor's incident is investigated", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({});
    const countBy: jest.SpyInstance = mockRecentRunCount(1);

    const decision: IncidentGateDecision = await gate();

    expect(decision.investigate).toBe(true);
    expect(decision.monitorId?.toString()).toBe(MONITOR_A.toString());
    expect(countBy).not.toHaveBeenCalled();
  });

  test("a monitor investigated inside a configured window skips the incident", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({ dedupeWindowMinutes: COOLDOWN_MINUTES });
    mockRecentRunCount(1);

    const decision: IncidentGateDecision = await gate();

    expect(decision.investigate).toBe(false);
    expect(decision.reason).toContain("already investigated");
    expect(decision.reason).toContain(`${COOLDOWN_MINUTES} minutes`);
    expect(decision.notStartedCode).toBe("monitor_cooldown");
    expect(decision.notStartedDetails).toEqual({
      cooldownWindowMinutes: COOLDOWN_MINUTES,
    });
  });

  test("no recent run investigates inside a configured window", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({ dedupeWindowMinutes: COOLDOWN_MINUTES });
    mockRecentRunCount(0);

    expect((await gate()).investigate).toBe(true);
  });

  /*
   * The multi-monitor case is why this differs from the alert lane: any
   * affected monitor having been investigated is enough, because a storm
   * opening several overlapping incidents is the repeat work being suppressed.
   */
  test("the window covers EVERY monitor the incident affects", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A, MONITOR_B] }));
    mockProject({ dedupeWindowMinutes: COOLDOWN_MINUTES });
    const countBy: jest.SpyInstance = mockRecentRunCount(0);

    await gate();

    const query: Record<string, unknown> = (
      countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["runType"]).toBe(AIRunType.Investigation);
    expect(query["projectId"]).toBe(PROJECT_ID);
    // Both monitors reach the query, not just the first.
    expect(JSON.stringify(query["monitorId"])).toContain(MONITOR_A.toString());
    expect(JSON.stringify(query["monitorId"])).toContain(MONITOR_B.toString());
  });

  test("the cooldown counts incident investigations only, so alert runs cannot suppress an incident", async () => {
    const incidentSubjectFilter: Record<string, string> = {
      operator: "incident-not-null",
    };
    const alertSubjectFilter: Record<string, string> = {
      operator: "alert-null",
    };
    jest.spyOn(QueryHelper, "notNull").mockReturnValue(incidentSubjectFilter);
    jest.spyOn(QueryHelper, "isNull").mockReturnValue(alertSubjectFilter);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({ dedupeWindowMinutes: COOLDOWN_MINUTES });
    const countBy: jest.SpyInstance = mockRecentRunCount(0);

    await gate();

    const query: Record<string, unknown> = (
      countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["triggeredByIncidentId"]).toBe(incidentSubjectFilter);
    expect(query["triggeredByAlertId"]).toBe(alertSubjectFilter);
  });

  test("an incident affecting no monitor skips the dedupe query entirely", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [] }));
    mockProject({ dedupeWindowMinutes: COOLDOWN_MINUTES });
    const countBy: jest.SpyInstance = mockRecentRunCount(0);

    const decision: IncidentGateDecision = await gate();

    expect(decision.investigate).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
    expect(decision.monitorId).toBeUndefined();
  });

  test("a zero window disables the cooldown", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({ dedupeWindowMinutes: 0 });
    const countBy: jest.SpyInstance = mockRecentRunCount(5);

    expect((await gate()).investigate).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("a negative window is clamped to disabled rather than inverting the query", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({ dedupeWindowMinutes: -30 });
    const countBy: jest.SpyInstance = mockRecentRunCount(5);

    expect((await gate()).investigate).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("an absurd window is clamped to a day", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({ dedupeWindowMinutes: 60 * 24 * 365 });
    mockRecentRunCount(1);

    const decision: IncidentGateDecision = await gate();

    expect(decision.investigate).toBe(false);
    expect(decision.reason).toContain(`${60 * 24} minutes`);
  });

  test("a custom window is used as set", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({ dedupeWindowMinutes: 45 });
    mockRecentRunCount(1);

    expect((await gate()).reason).toContain("within the last 45 minutes");
  });
});

describe("AIIncidentInvestigationRunner.shouldInvestigateIncident — subject resolution", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a missing incident is not investigated", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);

    const decision: IncidentGateDecision = await gate();

    expect(decision.investigate).toBe(false);
    expect(decision.reason).toBe("incident not found");
  });

  /*
   * The returned monitorId becomes AIRun.monitorId, which is the dedupe key
   * the NEXT incident reads — if it were dropped the cooldown could never
   * fire for incidents.
   */
  test("the first affected monitor is returned as the run's dedupe key", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A, MONITOR_B] }));
    mockProject({});
    mockRecentRunCount(0);

    expect((await gate()).monitorId?.toString()).toBe(MONITOR_A.toString());
  });
});

describe("AIIncidentInvestigationRunner.investigateNewIncident — gate wiring", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a gated-out incident is never enqueued", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    jest
      .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
      .mockResolvedValue({ investigate: false, reason: "below floor" });
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(null);

    await AIIncidentInvestigationRunner.investigateNewIncident({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a passing incident is enqueued carrying its monitor as the dedupe key", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    jest
      .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
      .mockResolvedValue({
        investigate: true,
        reason: "passed",
        monitorId: MONITOR_A,
      });
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(null);

    await AIIncidentInvestigationRunner.investigateNewIncident({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectIncidentId: INCIDENT_ID,
        subjectMonitorId: MONITOR_A,
      }),
    );
  });

  // The project opt-in is still checked before anything else costs a query.
  test("a project with investigations disabled never reaches the gate", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue("automatic_investigation_disabled");
    const gateSpy: jest.SpyInstance = jest.spyOn(
      AIIncidentInvestigationRunner,
      "shouldInvestigateIncident",
    );
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    await AIIncidentInvestigationRunner.investigateNewIncident({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    expect(gateSpy).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  /*
   * A gate failure must never take incident creation down with it — and it
   * must report "not enqueued", because the create hook reads that answer
   * to decide whether auto-remediation runs immediately or waits for the
   * investigation to settle. Returning true here would strand remediation
   * behind an investigation that never started.
   */
  test("a throwing gate is swallowed, enqueues nothing, and reports not-enqueued", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    jest
      .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
      .mockRejectedValue(new Error("database unavailable"));
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    await expect(
      AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(false);

    expect(enqueue).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  jest
    .spyOn(InvestigationEligibility, "recordSkipped")
    .mockResolvedValue(undefined);
});
