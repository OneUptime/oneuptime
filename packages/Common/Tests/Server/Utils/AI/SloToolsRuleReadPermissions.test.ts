import { QuerySlosTool } from "../../../../Server/Utils/AI/Toolbox/SloTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import LabelService from "../../../../Server/Services/LabelService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveMonitorRuleService from "../../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveMonitorRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../../Types/ServiceLevelObjective/SloWindowType";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_slos is gated on reading SLOs. Its detail mode also reads two child
 * tables, and each has its own read permission: SLO Monitor Rules
 * (ReadServiceLevelObjectiveMonitorRule, new in this release) and SLO Burn
 * Rate Rules (ReadServiceLevelObjectiveBurnRateRule). A custom role can read
 * SLOs without one or both of them. Every custom role created before monitor
 * rules shipped is in that position.
 *
 * For such a role the rule read throws NotAuthorizedException. The toolbox
 * turns a thrown error into a failed tool call, so the model used to get
 * nothing at all, not even the SLO definition it was allowed to see. These
 * tests pin the degraded answer: the SLO and whatever else is readable, plus
 * a note that names the missing permission so the model never reports
 * "this SLO has no rules".
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SLO_ID: ObjectID = ObjectID.generate();

// A custom-role caller, not root: the reads below are what its RBAC allows.
const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
  },
};

const MONITOR_RULES_PERMISSION: string = "ReadServiceLevelObjectiveMonitorRule";
const BURN_RATE_RULES_PERMISSION: string =
  "ReadServiceLevelObjectiveBurnRateRule";

function buildSlo(): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.name = "Checkout availability";
  slo.description = "Checkout must stay reachable.";
  slo.isEnabled = true;
  slo.sliType = SliType.MonitorUptime;
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.sloStatus = SloStatus.Healthy;
  slo.currentSliPercentage = 99.95;
  slo.lastEvaluatedAt = new Date("2026-09-14T09:00:00Z");
  return slo;
}

function buildMonitorRule(): ServiceLevelObjectiveMonitorRule {
  const rule: ServiceLevelObjectiveMonitorRule =
    new ServiceLevelObjectiveMonitorRule();
  rule._id = ObjectID.generate().toString();
  rule.name = "Production APIs";
  rule.isEnabled = true;
  // A name pattern only, so describing it needs no label lookup.
  rule.monitorNamePattern = "^api-";
  return rule;
}

function buildBurnRateRule(): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule._id = ObjectID.generate().toString();
  rule.name = "Fast burn";
  rule.isEnabled = true;
  rule.burnRateThreshold = 14.4;
  rule.longWindowInMinutes = 60;
  rule.shortWindowInMinutes = 5;
  return rule;
}

// The exception table-level permission checking throws for these tables.
function denied(tableName: string): NotAuthorizedException {
  return new NotAuthorizedException(
    `You do not have permissions to read ${tableName}. You need one of these permissions: ...`,
  );
}

type RuleRead = "allowed" | "denied";

function mockReads(data: { monitorRules: RuleRead; burnRateRules: RuleRead }): {
  monitorRules: jest.SpyInstance;
  burnRateRules: jest.SpyInstance;
} {
  jest
    .spyOn(ServiceLevelObjectiveService, "findOneById")
    .mockResolvedValue(buildSlo() as never);

  const monitorRules: jest.SpyInstance = jest.spyOn(
    ServiceLevelObjectiveMonitorRuleService,
    "findBy",
  );

  if (data.monitorRules === "allowed") {
    monitorRules.mockResolvedValue([buildMonitorRule()] as never);
  } else {
    monitorRules.mockRejectedValue(denied("SLO Monitor Rules") as never);
  }

  const burnRateRules: jest.SpyInstance = jest.spyOn(
    ServiceLevelObjectiveBurnRateRuleService,
    "findBy",
  );

  if (data.burnRateRules === "allowed") {
    burnRateRules.mockResolvedValue([buildBurnRateRule()] as never);
  } else {
    burnRateRules.mockRejectedValue(denied("SLO Burn Rate Rules") as never);
  }

  return { monitorRules, burnRateRules };
}

function widgetFieldValue(
  result: ToolExecutionResult,
  label: string,
): string | undefined {
  const widget: {
    data?: { fields?: Array<{ label: string; value: string }> };
  } =
    (result.widget as unknown as {
      data?: { fields?: Array<{ label: string; value: string }> };
    }) || {};

  return (widget.data?.fields || []).find(
    (field: { label: string; value: string }): boolean => {
      return field.label === label;
    },
  )?.value;
}

function runDetail(): Promise<ToolExecutionResult> {
  return QuerySlosTool.execute({ sloId: SLO_ID.toString() }, ctx);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_slos detail mode when a rule table is not readable", () => {
  test("no monitor rule permission: the SLO and its burn-rate rules still come back, with a note", async () => {
    mockReads({ monitorRules: "denied", burnRateRules: "allowed" });

    const result: ToolExecutionResult = await runDetail();

    // SLO row + the burn-rate rule row; no monitor rule rows.
    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Checkout availability");
    expect(result.dataForLlm).toContain("Fast burn");
    expect(result.dataForLlm).not.toContain("record=monitorRule");
    expect(result.dataForLlm).toContain(MONITOR_RULES_PERMISSION);
    expect(result.dataForLlm).toContain(
      "Do not conclude that the SLO has no monitor rules",
    );
    expect(result.dataForLlm).not.toContain(BURN_RATE_RULES_PERMISSION);
    // The compliance note still travels with the SLO row.
    expect(result.dataForLlm).toContain("last worker evaluation");

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.SloView,
      params: { sloId: SLO_ID.toString() },
    });

    // The widget must not claim the SLO's monitors are picked by hand.
    expect(widgetFieldValue(result, "Monitor rules")).toBe(
      "not visible to you",
    );
    expect(widgetFieldValue(result, "Burn-rate rules")).toBe("1");
  });

  test("no burn-rate rule permission: the SLO and its monitor rules still come back, with a note", async () => {
    mockReads({ monitorRules: "allowed", burnRateRules: "denied" });

    const result: ToolExecutionResult = await runDetail();

    // SLO row + the monitor rule row; no burn-rate rule rows.
    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Checkout availability");
    expect(result.dataForLlm).toContain("Production APIs");
    expect(result.dataForLlm).not.toContain("record=burnRateRule");
    expect(result.dataForLlm).toContain(BURN_RATE_RULES_PERMISSION);
    expect(result.dataForLlm).toContain(
      "Do not conclude that the SLO has no burn-rate rules",
    );
    expect(result.dataForLlm).not.toContain(MONITOR_RULES_PERMISSION);

    // "0" would read as "this SLO has no burn-rate rules".
    expect(widgetFieldValue(result, "Burn-rate rules")).toBe(
      "not visible to you",
    );
    expect(widgetFieldValue(result, "Monitor rules")).toBe("1 of 1 enabled");
  });

  test("neither rule table readable: the SLO row alone, with both notes", async () => {
    mockReads({ monitorRules: "denied", burnRateRules: "denied" });

    const result: ToolExecutionResult = await runDetail();

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Checkout availability");
    expect(result.dataForLlm).toContain(MONITOR_RULES_PERMISSION);
    expect(result.dataForLlm).toContain(BURN_RATE_RULES_PERMISSION);
    expect(result.citationLabel).toBe("SLO Checkout availability");
    expect(widgetFieldValue(result, "Monitor rules")).toBe(
      "not visible to you",
    );
    expect(widgetFieldValue(result, "Burn-rate rules")).toBe(
      "not visible to you",
    );
  });

  test("no label lookup is attempted for monitor rules that could not be read", async () => {
    mockReads({ monitorRules: "denied", burnRateRules: "allowed" });
    const labels: jest.SpyInstance = jest
      .spyOn(LabelService, "findBy")
      .mockResolvedValue([] as never);

    await runDetail();

    expect(labels).not.toHaveBeenCalled();
  });

  test("when both rule tables are readable nothing is marked as hidden", async () => {
    mockReads({ monitorRules: "allowed", burnRateRules: "allowed" });

    const result: ToolExecutionResult = await runDetail();

    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).not.toContain(MONITOR_RULES_PERMISSION);
    expect(result.dataForLlm).not.toContain(BURN_RATE_RULES_PERMISSION);
    expect(JSON.stringify(result.widget)).not.toContain("not visible to you");
  });

  test.each([["monitor rules"], ["burn-rate rules"]])(
    "a failure reading %s that is not a permission denial still fails the call",
    async (table: string) => {
      mockReads({ monitorRules: "allowed", burnRateRules: "allowed" });

      /*
       * A lost connection must not be dressed up as "not visible": the model
       * would then tell the user about a permission that is not missing.
       */
      const failing: jest.SpyInstance =
        table === "monitor rules"
          ? jest.spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
          : jest.spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy");

      failing.mockRejectedValue(
        new Error("Connection terminated unexpectedly") as never,
      );

      await expect(runDetail()).rejects.toThrow(
        "Connection terminated unexpectedly",
      );
    },
  );

  test("a missing SLO still reads no rule table, so nothing is marked hidden", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(null as never);
    const monitorRules: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockRejectedValue(denied("SLO Monitor Rules") as never);
    const burnRateRules: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockRejectedValue(denied("SLO Burn Rate Rules") as never);

    const result: ToolExecutionResult = await runDetail();

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(result.dataForLlm).not.toContain(MONITOR_RULES_PERMISSION);
    expect(monitorRules).not.toHaveBeenCalled();
    expect(burnRateRules).not.toHaveBeenCalled();
  });
});
