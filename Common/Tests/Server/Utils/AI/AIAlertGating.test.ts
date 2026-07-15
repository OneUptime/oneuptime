import AIAlertInvestigationRunner, {
  AlertGateDecision,
} from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIRunService from "../../../../Server/Services/AIRunService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Cost gates for autonomous alert investigations (Phase 1 / G4):
 *   - severity floor: explicit per-project minimum severity, defaulting to the
 *     project's top two tiers (lowest two `order` values; lower order = higher
 *     severity);
 *   - per-monitor dedupe window: a monitor already investigated within the
 *     window is not re-investigated;
 *   - per-project concurrency cap in the shared engine.
 *
 * These tests mock the persistence layer (no Postgres) to lock in the gate
 * decisions and their fail directions: unknown severity PASSES the severity
 * gate (it only filters known-low-severity noise), while a failed cap check
 * SKIPS (a cost gate fails cheap).
 */

function fakeAlert(data: {
  monitorId?: ObjectID | undefined;
  severityOrder?: number | undefined;
}): Alert {
  return {
    id: ObjectID.generate(),
    monitorId: data.monitorId,
    alertSeverity:
      data.severityOrder !== undefined
        ? ({ order: data.severityOrder } as AlertSeverity)
        : undefined,
  } as unknown as Alert;
}

function fakeProject(
  minimumSeverityId?: ObjectID | undefined,
  dedupeWindowMinutes?: number | undefined,
): Project {
  return {
    id: ObjectID.generate(),
    alertInvestigationMinimumSeverityId: minimumSeverityId,
    alertInvestigationDedupeWindowMinutes: dedupeWindowMinutes,
  } as unknown as Project;
}

function fakeSeverities(orders: Array<number>): Array<AlertSeverity> {
  return orders.map((order: number) => {
    return { order } as AlertSeverity;
  });
}

describe("AIAlertInvestigationRunner.shouldInvestigateAlert", () => {
  const alertId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockGates(data: {
    alert: Alert | null;
    project?: Project;
    explicitFloorSeverity?: AlertSeverity | null;
    topTiers?: Array<AlertSeverity>;
    recentRunCount?: number;
  }): void {
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(data.alert);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(data.project || fakeProject());
    jest
      .spyOn(AlertSeverityService, "findOneById")
      .mockResolvedValue(data.explicitFloorSeverity ?? null);
    jest
      .spyOn(AlertSeverityService, "findBy")
      .mockResolvedValue(data.topTiers || []);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(data.recentRunCount || 0));
  }

  test("skips when severity is below an explicitly configured floor", async () => {
    const floorSeverityId: ObjectID = ObjectID.generate();
    mockGates({
      alert: fakeAlert({ severityOrder: 3 }),
      project: fakeProject(floorSeverityId),
      explicitFloorSeverity: { order: 2 } as AlertSeverity,
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(false);
    expect(decision.reason).toContain("below the investigation floor");
  });

  test("investigates when severity meets the explicit floor and no recent run exists", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const floorSeverityId: ObjectID = ObjectID.generate();
    mockGates({
      alert: fakeAlert({ severityOrder: 2, monitorId }),
      project: fakeProject(floorSeverityId),
      explicitFloorSeverity: { order: 2 } as AlertSeverity,
      recentRunCount: 0,
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(true);
    expect(decision.monitorId).toBe(monitorId);
  });

  test("default floor is the top two tiers: third tier is skipped", async () => {
    mockGates({
      alert: fakeAlert({ severityOrder: 3 }),
      topTiers: fakeSeverities([1, 2]),
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(false);
  });

  test("default floor: second tier is investigated", async () => {
    mockGates({
      alert: fakeAlert({ severityOrder: 2 }),
      topTiers: fakeSeverities([1, 2]),
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(true);
  });

  test("a deleted explicit floor severity falls back to the top-two default", async () => {
    // Project points at a severity that no longer exists (findOneById → null).
    mockGates({
      alert: fakeAlert({ severityOrder: 3 }),
      project: fakeProject(ObjectID.generate()),
      explicitFloorSeverity: null,
      topTiers: fakeSeverities([1, 2]),
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(false);
  });

  test("unknown alert severity passes the severity gate", async () => {
    mockGates({
      alert: fakeAlert({ severityOrder: undefined }),
      topTiers: fakeSeverities([1, 2]),
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(true);
  });

  test("skips when the monitor was already investigated within the window", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const countBy: jest.SpyInstance = jest.spyOn(AIRunService, "countBy");

    mockGates({
      alert: fakeAlert({ severityOrder: 1, monitorId }),
      topTiers: fakeSeverities([1, 2]),
      recentRunCount: 1,
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(false);
    expect(decision.reason).toContain("already investigated");
    expect(countBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          monitorId,
        }),
      }),
    );
  });

  test("alerts without a monitor skip the dedupe check entirely", async () => {
    const countBy: jest.SpyInstance = jest.spyOn(AIRunService, "countBy");

    mockGates({
      alert: fakeAlert({ severityOrder: 1 }),
      topTiers: fakeSeverities([1, 2]),
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("a cooldown of 0 disables the dedupe check entirely", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const countBy: jest.SpyInstance = jest.spyOn(AIRunService, "countBy");

    mockGates({
      alert: fakeAlert({ severityOrder: 1, monitorId }),
      project: fakeProject(undefined, 0),
      topTiers: fakeSeverities([1, 2]),
      recentRunCount: 1,
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("a custom cooldown is used for the dedupe window", async () => {
    const monitorId: ObjectID = ObjectID.generate();

    mockGates({
      alert: fakeAlert({ severityOrder: 1, monitorId }),
      project: fakeProject(undefined, 45),
      topTiers: fakeSeverities([1, 2]),
      recentRunCount: 1,
    });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(false);
    expect(decision.reason).toContain("within the last 45 minutes");
  });

  test("skips when the alert cannot be found", async () => {
    mockGates({ alert: null });

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId,
        projectId,
      });

    expect(decision.investigate).toBe(false);
  });
});

describe("AIInvestigationQueue concurrency cap", () => {
  beforeEach(() => {
    // No per-project override => the default cap of 3 applies.
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("leaves the run queued when the per-project cap is reached", async () => {
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(3));
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });

    expect(claim).not.toHaveBeenCalled();
  });

  test("leaves the run queued when the cap check itself fails", async () => {
    jest.spyOn(AIRunService, "countBy").mockRejectedValue(new Error("db down"));
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });

    expect(claim).not.toHaveBeenCalled();
  });

  test("a per-project cap override of 1 blocks the second concurrent run", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: ObjectID.generate(),
      aiMaxConcurrentInvestigations: 1,
    } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });

    expect(claim).not.toHaveBeenCalled();
  });
});
