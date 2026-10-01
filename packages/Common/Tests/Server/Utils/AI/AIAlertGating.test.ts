import AIAlertInvestigationRunner, {
  AlertGateDecision,
} from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIRunService from "../../../../Server/Services/AIRunService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Cost gates for autonomous alert investigations (Phase 1 / G4). Every one of
 * them is opt-in — unset means no limit, so by default every alert is
 * investigated:
 *   - severity floor: an explicit per-project minimum severity; unset means
 *     every severity (it used to default to the project's top two tiers);
 *   - per-monitor cooldown: a monitor already investigated within a window
 *     the project set is not re-investigated; unset means no cooldown (it
 *     used to default to 30 minutes);
 *   - an alert-specific concurrency cap in the shared queue; unset means no
 *     cap (it used to default to 3).
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
    recentRunCount?: number;
  }): {
    severityLookup: jest.SpyInstance;
    severityList: jest.SpyInstance;
    countBy: jest.SpyInstance;
  } {
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(data.alert);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(data.project || fakeProject());
    const severityLookup: jest.SpyInstance = jest
      .spyOn(AlertSeverityService, "findOneById")
      .mockResolvedValue(data.explicitFloorSeverity ?? null);
    // The old top-two-tiers default listed the project's severities.
    const severityList: jest.SpyInstance = jest
      .spyOn(AlertSeverityService, "findBy")
      .mockResolvedValue([{ order: 1 }, { order: 2 }] as Array<AlertSeverity>);
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(data.recentRunCount || 0));

    return { severityLookup, severityList, countBy };
  }

  function gate(): Promise<AlertGateDecision> {
    return AIAlertInvestigationRunner.shouldInvestigateAlert({
      alertId,
      projectId,
    });
  }

  describe("severity floor", () => {
    test("skips when severity is below an explicitly configured floor", async () => {
      const floorSeverityId: ObjectID = ObjectID.generate();
      mockGates({
        alert: fakeAlert({ severityOrder: 3 }),
        project: fakeProject(floorSeverityId),
        explicitFloorSeverity: { order: 2, name: "Major" } as AlertSeverity,
      });

      const decision: AlertGateDecision = await gate();

      expect(decision.investigate).toBe(false);
      expect(decision.reason).toContain("below the investigation floor");
      expect(decision.notStartedCode).toBe("severity_below_threshold");
      expect(decision.notStartedDetails?.minimumSeverityName).toBe("Major");
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

      const decision: AlertGateDecision = await gate();

      expect(decision.investigate).toBe(true);
      expect(decision.monitorId).toBe(monitorId);
    });

    /*
     * The headline change. Unset used to mean "the top two severity tiers",
     * so a project's third-tier alerts were silently never investigated.
     * Unset now means what it says: no floor.
     */
    test.each([[1], [2], [3], [4], [10]])(
      "with no configured floor, an alert of severity order %p is investigated",
      async (severityOrder: number) => {
        mockGates({ alert: fakeAlert({ severityOrder }) });

        expect((await gate()).investigate).toBe(true);
      },
    );

    test("with no configured floor, no severity is looked up at all", async () => {
      const { severityLookup, severityList } = mockGates({
        alert: fakeAlert({ severityOrder: 5 }),
      });

      await gate();

      expect(severityLookup).not.toHaveBeenCalled();
      expect(severityList).not.toHaveBeenCalled();
    });

    test("a deleted explicit floor severity falls back to no floor, not to a default tier", async () => {
      // Project points at a severity that no longer exists (findOneById → null).
      const { severityList } = mockGates({
        alert: fakeAlert({ severityOrder: 3 }),
        project: fakeProject(ObjectID.generate()),
        explicitFloorSeverity: null,
      });

      expect((await gate()).investigate).toBe(true);
      expect(severityList).not.toHaveBeenCalled();
    });

    test("a floor severity with no order falls back to no floor", async () => {
      mockGates({
        alert: fakeAlert({ severityOrder: 9 }),
        project: fakeProject(ObjectID.generate()),
        explicitFloorSeverity: { name: "Broken" } as AlertSeverity,
      });

      expect((await gate()).investigate).toBe(true);
    });

    test("unknown alert severity passes the severity gate", async () => {
      mockGates({
        alert: fakeAlert({ severityOrder: undefined }),
        project: fakeProject(ObjectID.generate()),
        explicitFloorSeverity: { order: 1 } as AlertSeverity,
      });

      expect((await gate()).investigate).toBe(true);
    });
  });

  describe("per-monitor cooldown", () => {
    /*
     * The other headline change: unset used to mean a 30-minute cooldown, so
     * a monitor that fired again within half an hour was not looked at.
     */
    test("with no configured cooldown, a repeat alert from a just-investigated monitor is investigated again", async () => {
      const monitorId: ObjectID = ObjectID.generate();
      const { countBy } = mockGates({
        alert: fakeAlert({ severityOrder: 1, monitorId }),
        recentRunCount: 1,
      });

      const decision: AlertGateDecision = await gate();

      expect(decision.investigate).toBe(true);
      expect(decision.monitorId).toBe(monitorId);
      // No cooldown, so there is nothing to look up.
      expect(countBy).not.toHaveBeenCalled();
    });

    test("skips when the monitor was already investigated within a configured window", async () => {
      const monitorId: ObjectID = ObjectID.generate();
      const { countBy } = mockGates({
        alert: fakeAlert({ severityOrder: 1, monitorId }),
        project: fakeProject(undefined, 30),
        recentRunCount: 1,
      });

      const decision: AlertGateDecision = await gate();

      expect(decision.investigate).toBe(false);
      expect(decision.reason).toContain("already investigated");
      expect(decision.reason).toContain("within the last 30 minutes");
      expect(decision.notStartedCode).toBe("monitor_cooldown");
      expect(decision.notStartedDetails).toEqual({ cooldownWindowMinutes: 30 });
      expect(countBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            monitorId,
          }),
        }),
      );
    });

    test("investigates inside a configured window when the monitor has no recent run", async () => {
      mockGates({
        alert: fakeAlert({ severityOrder: 1, monitorId: ObjectID.generate() }),
        project: fakeProject(undefined, 30),
        recentRunCount: 0,
      });

      expect((await gate()).investigate).toBe(true);
    });

    test("the cooldown counts alert investigations only, so incident runs cannot suppress an alert", async () => {
      const monitorId: ObjectID = ObjectID.generate();
      const alertSubjectFilter: Record<string, string> = {
        operator: "alert-not-null",
      };
      const incidentSubjectFilter: Record<string, string> = {
        operator: "incident-null",
      };
      jest.spyOn(QueryHelper, "notNull").mockReturnValue(alertSubjectFilter);
      jest.spyOn(QueryHelper, "isNull").mockReturnValue(incidentSubjectFilter);

      const { countBy } = mockGates({
        alert: fakeAlert({ severityOrder: 1, monitorId }),
        project: fakeProject(undefined, 30),
        recentRunCount: 0,
      });

      await gate();

      const query: Record<string, unknown> = (
        countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["triggeredByAlertId"]).toBe(alertSubjectFilter);
      expect(query["triggeredByIncidentId"]).toBe(incidentSubjectFilter);
    });

    test("alerts without a monitor skip the dedupe check entirely, even with a cooldown set", async () => {
      const { countBy } = mockGates({
        alert: fakeAlert({ severityOrder: 1 }),
        project: fakeProject(undefined, 30),
      });

      const decision: AlertGateDecision = await gate();

      expect(decision.investigate).toBe(true);
      expect(countBy).not.toHaveBeenCalled();
    });

    test("a cooldown of 0 disables the dedupe check entirely", async () => {
      const { countBy } = mockGates({
        alert: fakeAlert({ severityOrder: 1, monitorId: ObjectID.generate() }),
        project: fakeProject(undefined, 0),
        recentRunCount: 1,
      });

      expect((await gate()).investigate).toBe(true);
      expect(countBy).not.toHaveBeenCalled();
    });

    test("a negative cooldown is read as none rather than inverting the query", async () => {
      const { countBy } = mockGates({
        alert: fakeAlert({ severityOrder: 1, monitorId: ObjectID.generate() }),
        project: fakeProject(undefined, -30),
        recentRunCount: 1,
      });

      expect((await gate()).investigate).toBe(true);
      expect(countBy).not.toHaveBeenCalled();
    });

    test("a custom cooldown is used for the dedupe window", async () => {
      mockGates({
        alert: fakeAlert({ severityOrder: 1, monitorId: ObjectID.generate() }),
        project: fakeProject(undefined, 45),
        recentRunCount: 1,
      });

      const decision: AlertGateDecision = await gate();

      expect(decision.investigate).toBe(false);
      expect(decision.reason).toContain("within the last 45 minutes");
    });

    test("an absurd cooldown is clamped to a day", async () => {
      mockGates({
        alert: fakeAlert({ severityOrder: 1, monitorId: ObjectID.generate() }),
        project: fakeProject(undefined, 60 * 24 * 365),
        recentRunCount: 1,
      });

      const decision: AlertGateDecision = await gate();

      expect(decision.investigate).toBe(false);
      expect(decision.reason).toContain(`${60 * 24} minutes`);
    });
  });

  test("skips when the alert cannot be found", async () => {
    mockGates({ alert: null });

    const decision: AlertGateDecision = await gate();

    expect(decision.investigate).toBe(false);
    expect(decision.notStartedCode).toBe("eligibility_check_failed");
  });

  /*
   * A project that never touched its alert AI settings: every gate is open,
   * whatever the alert looks like.
   */
  test("a project with no alert AI settings investigates a low-severity repeat alert", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const { severityLookup, severityList, countBy } = mockGates({
      alert: fakeAlert({ severityOrder: 7, monitorId }),
      recentRunCount: 3,
    });

    const decision: AlertGateDecision = await gate();

    expect(decision).toEqual({
      investigate: true,
      reason: "passed severity and dedupe gates",
      monitorId,
    });
    expect(severityLookup).not.toHaveBeenCalled();
    expect(severityList).not.toHaveBeenCalled();
    expect(countBy).not.toHaveBeenCalled();
  });
});

describe("AIInvestigationQueue concurrency cap", () => {
  function projectWithAlertCap(cap: number | undefined): Project {
    return {
      id: ObjectID.generate(),
      alertAiMaxConcurrentInvestigations: cap,
    } as unknown as Project;
  }

  beforeEach(() => {
    // No per-project cap: the alert lane has no concurrency limit.
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Unset used to mean a cap of 3, so the fourth alert in a burst waited in
   * the queue — and expired there after 30 minutes if the burst kept coming.
   */
  test("with no cap set, an alert run is claimed however many are already running", async () => {
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(500));
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(0);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });

    // Nothing to count against, so nothing is counted.
    expect(countBy).not.toHaveBeenCalled();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  test("leaves the run queued when a configured alert cap is reached", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithAlertCap(3));
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
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithAlertCap(3));
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

  test("an alert cap override of 1 blocks the second concurrent alert run", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: ObjectID.generate(),
      incidentAiMaxConcurrentInvestigations: 10,
      alertAiMaxConcurrentInvestigations: 1,
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

  // A cap set above the old ceiling of 25 used to be clamped back to 25.
  test("a configured cap above 25 is honoured", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithAlertCap(40));
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(30));
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(0);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });

    expect(claim).toHaveBeenCalledTimes(1);
  });

  test("a configured cap of 0 reads as 1, not as paused", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithAlertCap(0));
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(0);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });
    expect(claim).toHaveBeenCalledTimes(1);

    countBy.mockResolvedValue(new PositiveNumber(1));
    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });
    expect(claim).toHaveBeenCalledTimes(1);
  });
});
