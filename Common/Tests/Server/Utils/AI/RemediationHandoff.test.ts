import RemediationHandoff from "../../../../Server/Utils/AI/SRE/RemediationHandoff";
import AIIncidentInvestigationRunner, {
  IncidentGateDecision,
} from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner, {
  AlertGateDecision,
} from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AutoRemediationRuleEngineService from "../../../../Server/Services/AutoRemediationRuleEngineService";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * RCA-first ordering, the two ends the create hooks depend on:
 *   (a) RemediationHandoff.runForSettledInvestigation routes a settled
 *       investigation's subject to the right rule-engine entry point —
 *       incident vs alert — and NEVER throws (it runs after terminal run
 *       transitions, where a failure must be logged, not propagated);
 *   (b) investigateNewIncident/investigateNewAlert return the "enqueued"
 *       boolean the create hooks branch on: true ONLY when a durable run was
 *       actually recorded — any gate failure, quiet skip or error means
 *       false, so the hook applies remediation immediately instead of
 *       deferring it behind an investigation that will never settle.
 */

describe("RemediationHandoff.runForSettledInvestigation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an incident subject is released to the incident rule engine", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();
    const applyToIncident: jest.SpyInstance = jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncidentById")
      .mockResolvedValue(undefined);
    const applyToAlert: jest.SpyInstance = jest.spyOn(
      AutoRemediationRuleEngineService,
      "applyRulesToAlertById",
    );

    await RemediationHandoff.runForSettledInvestigation({
      projectId,
      incidentId,
    });

    expect(applyToIncident).toHaveBeenCalledTimes(1);
    expect(applyToIncident).toHaveBeenCalledWith({ incidentId, projectId });
    expect(applyToAlert).not.toHaveBeenCalled();
  });

  test("an alert subject is released to the alert rule engine", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const alertId: ObjectID = ObjectID.generate();
    const applyToIncident: jest.SpyInstance = jest.spyOn(
      AutoRemediationRuleEngineService,
      "applyRulesToIncidentById",
    );
    const applyToAlert: jest.SpyInstance = jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToAlertById")
      .mockResolvedValue(undefined);

    await RemediationHandoff.runForSettledInvestigation({
      projectId,
      alertId,
    });

    expect(applyToAlert).toHaveBeenCalledTimes(1);
    expect(applyToAlert).toHaveBeenCalledWith({ alertId, projectId });
    expect(applyToIncident).not.toHaveBeenCalled();
  });

  test("no subject id means no rule-engine call at all", async () => {
    const applyToIncident: jest.SpyInstance = jest.spyOn(
      AutoRemediationRuleEngineService,
      "applyRulesToIncidentById",
    );
    const applyToAlert: jest.SpyInstance = jest.spyOn(
      AutoRemediationRuleEngineService,
      "applyRulesToAlertById",
    );

    await RemediationHandoff.runForSettledInvestigation({
      projectId: ObjectID.generate(),
    });

    expect(applyToIncident).not.toHaveBeenCalled();
    expect(applyToAlert).not.toHaveBeenCalled();
  });

  test("an incident rule-engine failure is swallowed — the hand-off never throws", async () => {
    jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncidentById")
      .mockRejectedValue(new Error("db down"));

    await expect(
      RemediationHandoff.runForSettledInvestigation({
        projectId: ObjectID.generate(),
        incidentId: ObjectID.generate(),
      }),
    ).resolves.toBeUndefined();
  });

  test("an alert rule-engine failure is swallowed too", async () => {
    jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToAlertById")
      .mockRejectedValue(new Error("db down"));

    await expect(
      RemediationHandoff.runForSettledInvestigation({
        projectId: ObjectID.generate(),
        alertId: ObjectID.generate(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("AIIncidentInvestigationRunner.investigateNewIncident — the enqueued signal", () => {
  const projectId: ObjectID = ObjectID.generate();
  const incidentId: ObjectID = ObjectID.generate();

  function mockGates(data: { enabled: boolean; investigate: boolean }): void {
    jest
      .spyOn(AIInvestigationEngine, "isEnabledForProject")
      .mockResolvedValue(data.enabled);
    jest
      .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
      .mockResolvedValue({
        investigate: data.investigate,
        reason: "test gate",
      } as IncidentGateDecision);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns true only when an investigation run was actually enqueued", async () => {
    mockGates({ enabled: true, investigate: true });
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(ObjectID.generate());

    const enqueued: boolean =
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId,
        projectId,
      });

    expect(enqueued).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        subjectIncidentId: incidentId,
      }),
    );
  });

  test("returns false when enqueue quiet-skipped (returned null) — remediation must not be deferred", async () => {
    mockGates({ enabled: true, investigate: true });
    jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(null);

    const enqueued: boolean =
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId,
        projectId,
      });

    expect(enqueued).toBe(false);
  });

  test("returns false when the project gate fails, without touching the queue", async () => {
    mockGates({ enabled: false, investigate: true });
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const enqueued: boolean =
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId,
        projectId,
      });

    expect(enqueued).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("returns false when the incident cost gates say skip", async () => {
    mockGates({ enabled: true, investigate: false });
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const enqueued: boolean =
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId,
        projectId,
      });

    expect(enqueued).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("returns false (never throws) when enqueue itself throws", async () => {
    mockGates({ enabled: true, investigate: true });
    jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockRejectedValue(new Error("db down"));

    await expect(
      AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId,
        projectId,
      }),
    ).resolves.toBe(false);
  });
});

describe("AIAlertInvestigationRunner.investigateNewAlert — the enqueued signal", () => {
  const projectId: ObjectID = ObjectID.generate();
  const alertId: ObjectID = ObjectID.generate();

  function mockGates(data: { enabled: boolean; investigate: boolean }): void {
    jest
      .spyOn(AIInvestigationEngine, "isEnabledForProject")
      .mockResolvedValue(data.enabled);
    jest
      .spyOn(AIAlertInvestigationRunner, "shouldInvestigateAlert")
      .mockResolvedValue({
        investigate: data.investigate,
        reason: "test gate",
      } as AlertGateDecision);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns true only when an investigation run was actually enqueued", async () => {
    mockGates({ enabled: true, investigate: true });
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(ObjectID.generate());

    const enqueued: boolean =
      await AIAlertInvestigationRunner.investigateNewAlert({
        alertId,
        projectId,
      });

    expect(enqueued).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        subjectAlertId: alertId,
      }),
    );
  });

  test("returns false when enqueue quiet-skipped (returned null)", async () => {
    mockGates({ enabled: true, investigate: true });
    jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(null);

    const enqueued: boolean =
      await AIAlertInvestigationRunner.investigateNewAlert({
        alertId,
        projectId,
      });

    expect(enqueued).toBe(false);
  });

  test("returns false when the gates fail, without touching the queue", async () => {
    mockGates({ enabled: true, investigate: false });
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const enqueued: boolean =
      await AIAlertInvestigationRunner.investigateNewAlert({
        alertId,
        projectId,
      });

    expect(enqueued).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("returns false (never throws) when enqueue itself throws", async () => {
    mockGates({ enabled: true, investigate: true });
    jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockRejectedValue(new Error("db down"));

    await expect(
      AIAlertInvestigationRunner.investigateNewAlert({
        alertId,
        projectId,
      }),
    ).resolves.toBe(false);
  });
});
