import AIIncidentInvestigationRunner, {
  DEFAULT_INCIDENT_DEDUPE_WINDOW_MINUTES,
  IncidentGateDecision,
} from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIRunService from "../../../../Server/Services/AIRunService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunType from "../../../../Types/AI/AIRunType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Cost gates for autonomous INCIDENT investigations.
 *
 * Alerts have had a severity floor and a per-monitor cooldown since Phase 1;
 * incidents had neither, so every incident in an enabled project enqueued a
 * run. These tests lock in the gates AND the one deliberate asymmetry:
 *
 *   - the severity floor is UNSET by default, so an existing project's
 *     coverage does not silently shrink on deploy (an incident already
 *     cleared a human-authored threshold to exist, unlike an alert firing
 *     straight off a monitor);
 *   - the cooldown IS on by default at 30 minutes, because it only suppresses
 *     repeat work on a monitor that was just investigated;
 *   - an incident affects a SET of monitors, so the dedupe key is "any of
 *     them" — a storm that opens several incidents is the case this exists
 *     for.
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

  test("a monitor investigated inside the window skips the incident", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({});
    mockRecentRunCount(1);

    const decision: IncidentGateDecision = await gate();

    expect(decision.investigate).toBe(false);
    expect(decision.reason).toContain("already investigated");
  });

  test("no recent run investigates", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({});
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
    mockProject({});
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

  test("an incident affecting no monitor skips the dedupe query entirely", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [] }));
    mockProject({});
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

  test("the default window is used when the project sets none", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident({ monitorIds: [MONITOR_A] }));
    mockProject({});
    mockRecentRunCount(1);

    expect((await gate()).reason).toContain(
      `${DEFAULT_INCIDENT_DEDUPE_WINDOW_MINUTES} minutes`,
    );
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
      .spyOn(AIInvestigationEngine, "isEnabledForProject")
      .mockResolvedValue(true);
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
      .spyOn(AIInvestigationEngine, "isEnabledForProject")
      .mockResolvedValue(true);
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
      .spyOn(AIInvestigationEngine, "isEnabledForProject")
      .mockResolvedValue(false);
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

  // A gate failure must never take incident creation down with it.
  test("a throwing gate is swallowed and enqueues nothing", async () => {
    jest
      .spyOn(AIInvestigationEngine, "isEnabledForProject")
      .mockResolvedValue(true);
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
    ).resolves.toBeUndefined();

    expect(enqueue).not.toHaveBeenCalled();
  });
});
