import { QuerySlosTool } from "../../../../Server/Utils/AI/Toolbox/SloTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../../Types/ServiceLevelObjective/SloWindowType";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_slos surfaces SLO definitions plus the worker-persisted compliance
 * columns. These tests lock in what the model relies on: the detail mode
 * returns the definition, persisted compliance and burn-rate rules for one
 * SLO; the list mode respects clamps, pagination and the status filter;
 * compliance is always labeled as persisted (never recomputed); and empty
 * results are honest (rowCount 0, no widget).
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const SLO_ID: ObjectID = ObjectID.generate();

function buildSlo(data?: {
  id?: ObjectID;
  name?: string;
  status?: SloStatus;
  evaluated?: boolean;
  monitors?: Array<string>;
}): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = (data?.id ?? SLO_ID).toString();
  slo.name = data?.name ?? "Checkout availability";
  slo.description = "Checkout must stay reachable.";
  slo.isEnabled = true;
  slo.sliType = SliType.MonitorUptime;
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.atRiskThresholdPercentage = 20;
  slo.sloStatus = data?.status ?? SloStatus.Healthy;

  if (data?.evaluated !== false) {
    slo.currentSliPercentage = 99.95;
    slo.errorBudgetRemainingPercentage = 47.3;
    slo.errorBudgetRemainingSeconds = 20460;
    slo.errorBudgetTotalSeconds = 43200;
    slo.currentBurnRate = 0.8;
    slo.lastEvaluatedAt = new Date("2026-08-14T09:00:00Z");
  }

  slo.monitors = (data?.monitors ?? ["Checkout API"]).map(
    (name: string): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor.name = name;
      return monitor;
    },
  );

  return slo;
}

function buildRule(data?: {
  name?: string;
  threshold?: number;
}): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule._id = ObjectID.generate().toString();
  rule.name = data?.name ?? "Fast burn";
  rule.isEnabled = true;
  rule.burnRateThreshold = data?.threshold ?? 14.4;
  rule.longWindowInMinutes = 60;
  rule.shortWindowInMinutes = 5;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Critical";
  rule.alertSeverity = severity;

  return rule;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_slos — detail mode", () => {
  test("returns the definition, persisted compliance and burn-rate rules with a view citation", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    const rulesSpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([
        buildRule({ name: "Fast burn", threshold: 14.4 }),
        buildRule({ name: "Slow burn", threshold: 3 }),
      ] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    // SLO row + 2 burn-rate rule rows.
    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).toContain("Checkout availability");
    expect(result.dataForLlm).toContain("targetPercentage=99.9");
    expect(result.dataForLlm).toContain("Rolling 30d");
    expect(result.dataForLlm).toContain("Checkout API");
    expect(result.dataForLlm).toContain("currentSliPercentage=99.95");
    expect(result.dataForLlm).toContain("Fast burn");
    expect(result.dataForLlm).toContain("burnRateThreshold=14.4");
    expect(result.dataForLlm).toContain("Slow burn");
    // Compliance figures must be labeled as persisted, not live.
    expect(result.dataForLlm).toContain("last worker evaluation");
    expect(result.citationLabel).toBe("SLO Checkout availability");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.SloView,
      params: { sloId: SLO_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    // Rules are scoped to this SLO and run under the user's props.
    const ruleCallArgs: JSONObject = rulesSpy.mock.calls[0]?.[0] as JSONObject;
    expect(
      (ruleCallArgs["query"] as JSONObject)[
        "serviceLevelObjectiveId"
      ]?.toString(),
    ).toBe(SLO_ID.toString());
    expect(ruleCallArgs["props"]).toBe(ctx.props);
  });

  test("a missing SLO is honest: zero rows, no widget, no rule lookup", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(null as never);
    const rulesSpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(rulesSpy).not.toHaveBeenCalled();
  });
});

describe("query_slos — list mode", () => {
  test("lists SLOs with target, window and persisted compliance", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([
        buildSlo(),
        buildSlo({
          id: ObjectID.generate(),
          name: "Search latency",
          status: SloStatus.AtRisk,
          evaluated: false,
          monitors: [],
        }),
      ] as never);
    jest
      .spyOn(ServiceLevelObjectiveService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute({}, ctx);

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Checkout availability");
    expect(result.dataForLlm).toContain("Search latency");
    // Persisted-compliance note travels with every non-empty result.
    expect(result.dataForLlm).toContain("last worker evaluation");
    // Nothing paginated: no "Showing rows" banner.
    expect(result.dataForLlm).not.toContain("Showing rows");
    expect(result.citationLabel).toBe("SLOs (2 found)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Slos,
    });
    expect(result.widget).toBeDefined();

    // The query must run under the requesting user's props, never as root+.
    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
    expect(callArgs["skip"]).toBe(0);
  });

  test("the sloStatus filter reaches the service query (case-insensitively)", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([buildSlo({ status: SloStatus.AtRisk })] as never);
    const countBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloStatus: "at risk" },
      ctx,
    );

    expect(result.citationLabel).toBe("At Risk SLOs (1 found)");

    const findQuery: JSONObject = (findBySpy.mock.calls[0]?.[0] as JSONObject)[
      "query"
    ] as JSONObject;
    expect(findQuery["sloStatus"]).toBe(SloStatus.AtRisk);

    // countBy must count the same filtered set, or the total lies.
    const countQuery: JSONObject = (
      countBySpy.mock.calls[0]?.[0] as JSONObject
    )["query"] as JSONObject;
    expect(countQuery["sloStatus"]).toBe(SloStatus.AtRisk);
  });

  test("an invalid sloStatus is an error envelope, not a silent empty match", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloStatus: "Exploded" },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("Error:");
    expect(result.dataForLlm).toContain(SloStatus.BudgetExhausted);
    expect(result.widget).toBeUndefined();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("clamps limit and skip arguments", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ServiceLevelObjectiveService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    await QuerySlosTool.execute({ limit: 999, skip: -5 }, ctx);

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(25);
    expect(callArgs["skip"]).toBe(0);
  });

  test("tells the model when it is only seeing a page of a larger set", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([
        buildSlo(),
        buildSlo({ id: ObjectID.generate(), name: "Search latency" }),
      ] as never);
    jest
      .spyOn(ServiceLevelObjectiveService, "countBy")
      .mockResolvedValue(new PositiveNumber(30) as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { skip: 10, limit: 2 },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "Showing rows 11–12 of 30 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("SLOs (30 found)");
  });

  test("an empty project is honest: zero rows, no widget, no compliance note", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ServiceLevelObjectiveService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute({}, ctx);

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(result.dataForLlm).toBe("(no rows found)");
  });
});

describe("query_slos — permissions", () => {
  test("required permissions derive from the model read ACL", () => {
    expect(QuerySlosTool.requiredPermissions.length).toBeGreaterThan(0);
  });
});
