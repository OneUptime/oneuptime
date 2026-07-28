import AutoRemediationRuleEngineService, {
  AutoRemediationDecision,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import IncidentAutoRemediationRuleService from "../../../Server/Services/IncidentAutoRemediationRuleService";
import AlertAutoRemediationRuleService from "../../../Server/Services/AlertAutoRemediationRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import MonitorService from "../../../Server/Services/MonitorService";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import IncidentAutoRemediationRule from "../../../Models/DatabaseModels/IncidentAutoRemediationRule";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The auto-remediation rule engine — THE standing authorization for
 * unattended AI execution. Rules match in the same shape as On-Call and
 * Owner rules; the engine answers {matched, commandsAllowed}.
 *
 * The contract these tests pin:
 *   - fail-CLOSED on every unhappy path (no rules, no match, missing
 *     subject, thrown error) — autonomy is never the failure mode;
 *   - criteria are AND-ed across dimensions, OR-ed within a dimension;
 *   - commandsAllowed is the UNION over MATCHING rules only — a
 *     commands-enabled rule that does not match must not grant anything;
 *   - an invalid stored regex is a non-match, never a crash.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const monitorId: ObjectID = ObjectID.generate();
const otherMonitorId: ObjectID = ObjectID.generate();
const severityId: ObjectID = ObjectID.generate();
const labelId: ObjectID = ObjectID.generate();

function fakeIncident(overrides: Record<string, unknown> = {}): Incident {
  return {
    _id: incidentId.toString(),
    projectId,
    title: "Cart checkout failures",
    description: "Checkout is timing out",
    incidentSeverityId: severityId,
    monitors: [{ id: monitorId } as unknown as Monitor],
    labels: [],
    ...overrides,
  } as unknown as Incident;
}

function fakeAlert(overrides: Record<string, unknown> = {}): Alert {
  return {
    _id: alertId.toString(),
    projectId,
    title: "[AI] Error log volume spike",
    description: "payments-api",
    alertSeverityId: severityId,
    monitorId,
    labels: [],
    ...overrides,
  } as unknown as Alert;
}

function rule(
  overrides: Record<string, unknown> = {},
): IncidentAutoRemediationRule {
  return {
    id: ObjectID.generate(),
    name: "Auto-remediate checkout",
    autoExecuteCommands: false,
    monitors: [],
    incidentSeverities: [],
    incidentLabels: [],
    monitorLabels: [],
    ...overrides,
  } as unknown as IncidentAutoRemediationRule;
}

function mockIncident(incident: Incident | null): void {
  jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(incident as never);
}

function mockRules(rules: Array<IncidentAutoRemediationRule>): void {
  jest
    .spyOn(IncidentAutoRemediationRuleService, "findBy")
    .mockResolvedValue(rules as never);
}

describe("AutoRemediationRuleEngine — fail-closed", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a project with NO rules denies autonomy", async () => {
    mockIncident(fakeIncident());
    mockRules([]);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForIncident(incidentId);

    expect(decision).toEqual({
      matched: false,
      commandsAllowed: false,
      matchedRuleNames: [],
    });
  });

  test("a missing subject denies autonomy", async () => {
    mockIncident(null);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForIncident(incidentId);

    expect(decision.matched).toBe(false);
  });

  test("a thrown error denies autonomy instead of propagating", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockRejectedValue(new Error("db down") as never);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForIncident(incidentId);

    expect(decision).toEqual({
      matched: false,
      commandsAllowed: false,
      matchedRuleNames: [],
    });
  });

  test("an invalid stored regex is a non-match, not a crash", async () => {
    mockIncident(fakeIncident());
    mockRules([rule({ incidentTitlePattern: "([unclosed" })]);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForIncident(incidentId);

    expect(decision.matched).toBe(false);
  });
});

describe("AutoRemediationRuleEngine — matching semantics", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a rule with NO criteria matches everything in the project", async () => {
    mockIncident(fakeIncident());
    mockRules([rule()]);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForIncident(incidentId);

    expect(decision.matched).toBe(true);
    expect(decision.matchedRuleNames).toEqual(["Auto-remediate checkout"]);
  });

  test("monitor criteria match when the incident carries that monitor", async () => {
    mockIncident(fakeIncident());
    mockRules([rule({ monitors: [{ id: monitorId }] })]);

    expect(
      (
        await AutoRemediationRuleEngineService.getDecisionForIncident(
          incidentId,
        )
      ).matched,
    ).toBe(true);
  });

  test("monitor criteria do NOT match a different monitor", async () => {
    mockIncident(fakeIncident());
    mockRules([rule({ monitors: [{ id: otherMonitorId }] })]);

    expect(
      (
        await AutoRemediationRuleEngineService.getDecisionForIncident(
          incidentId,
        )
      ).matched,
    ).toBe(false);
  });

  test("severity criteria gate the match", async () => {
    mockIncident(fakeIncident());
    mockRules([rule({ incidentSeverities: [{ id: ObjectID.generate() }] })]);

    expect(
      (
        await AutoRemediationRuleEngineService.getDecisionForIncident(
          incidentId,
        )
      ).matched,
    ).toBe(false);
  });

  test("criteria are AND-ed: one failing dimension fails the rule", async () => {
    mockIncident(fakeIncident());
    mockRules([
      rule({
        // Monitor matches...
        monitors: [{ id: monitorId }],
        // ...but the title pattern does not.
        incidentTitlePattern: "^database outage$",
      }),
    ]);

    expect(
      (
        await AutoRemediationRuleEngineService.getDecisionForIncident(
          incidentId,
        )
      ).matched,
    ).toBe(false);
  });

  test("title patterns match case-insensitively", async () => {
    mockIncident(fakeIncident());
    mockRules([rule({ incidentTitlePattern: "CHECKOUT" })]);

    expect(
      (
        await AutoRemediationRuleEngineService.getDecisionForIncident(
          incidentId,
        )
      ).matched,
    ).toBe(true);
  });

  test("label criteria require an overlapping label", async () => {
    mockIncident(fakeIncident({ labels: [{ id: labelId }] }));
    mockRules([rule({ incidentLabels: [{ id: labelId }] })]);

    expect(
      (
        await AutoRemediationRuleEngineService.getDecisionForIncident(
          incidentId,
        )
      ).matched,
    ).toBe(true);
  });

  test("monitor-name criteria resolve the monitor and match on it", async () => {
    mockIncident(fakeIncident());
    mockRules([rule({ monitorNamePattern: "payments" })]);
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue({
      name: "payments-api health",
      description: "",
      labels: [],
    } as never);

    expect(
      (
        await AutoRemediationRuleEngineService.getDecisionForIncident(
          incidentId,
        )
      ).matched,
    ).toBe(true);
  });
});

describe("AutoRemediationRuleEngine — the commands grant", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("commandsAllowed is false when the matching rule withholds it", async () => {
    mockIncident(fakeIncident());
    mockRules([rule({ autoExecuteCommands: false })]);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForIncident(incidentId);

    expect(decision.matched).toBe(true);
    expect(decision.commandsAllowed).toBe(false);
  });

  test("commandsAllowed unions across MATCHING rules", async () => {
    mockIncident(fakeIncident());
    mockRules([
      rule({ name: "narrow", autoExecuteCommands: false }),
      rule({ name: "broad", autoExecuteCommands: true }),
    ]);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForIncident(incidentId);

    expect(decision.commandsAllowed).toBe(true);
    expect(decision.matchedRuleNames).toEqual(["narrow", "broad"]);
  });

  test("a commands-enabled rule that does NOT match grants nothing", async () => {
    mockIncident(fakeIncident());
    mockRules([
      rule({
        name: "other-service",
        autoExecuteCommands: true,
        monitors: [{ id: otherMonitorId }],
      }),
    ]);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForIncident(incidentId);

    expect(decision.matched).toBe(false);
    expect(decision.commandsAllowed).toBe(false);
  });
});

describe("AutoRemediationRuleEngine — alerts", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an alert matches on its single monitor", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(fakeAlert() as never);
    jest.spyOn(AlertAutoRemediationRuleService, "findBy").mockResolvedValue([
      {
        id: ObjectID.generate(),
        name: "alert rule",
        autoExecuteCommands: true,
        monitors: [{ id: monitorId }],
        alertSeverities: [],
        alertLabels: [],
        monitorLabels: [],
      },
    ] as unknown as never);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForAlert(alertId);

    expect(decision.matched).toBe(true);
    expect(decision.commandsAllowed).toBe(true);
  });

  test("an AI-escalated alert (no monitor) cannot match monitor criteria", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(fakeAlert({ monitorId: undefined }) as never);
    jest.spyOn(AlertAutoRemediationRuleService, "findBy").mockResolvedValue([
      {
        id: ObjectID.generate(),
        name: "monitor-scoped rule",
        autoExecuteCommands: true,
        monitors: [{ id: monitorId }],
        alertSeverities: [],
        alertLabels: [],
        monitorLabels: [],
      },
    ] as unknown as never);

    const decision: AutoRemediationDecision =
      await AutoRemediationRuleEngineService.getDecisionForAlert(alertId);

    expect(decision.matched).toBe(false);
  });
});
