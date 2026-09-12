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
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
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
 * results are honest (rowCount 0, no widget). Since a burn-rate rule can now
 * raise an alert, declare an incident, or both, the rule rows also have to
 * report each output — with the model's defaults applied, so a rule written
 * before incidents existed is not handed to the LLM as a blank.
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

/*
 * shouldCreateAlert / shouldCreateIncident and the incident columns are left
 * unset unless a case asks for them: that is exactly the shape of a rule row
 * written before burn-rate rules could declare incidents, which is the case
 * the serializer's defaults exist for.
 */
function buildRule(data?: {
  name?: string;
  threshold?: number;
  shouldCreateAlert?: boolean;
  shouldCreateIncident?: boolean;
  incidentSeverity?: string;
  lastIncidentCreatedAt?: Date;
  lastIncidentResolvedAt?: Date;
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

  if (data?.shouldCreateAlert !== undefined) {
    rule.shouldCreateAlert = data.shouldCreateAlert;
  }

  if (data?.shouldCreateIncident !== undefined) {
    rule.shouldCreateIncident = data.shouldCreateIncident;
  }

  if (data?.incidentSeverity) {
    const incidentSeverity: IncidentSeverity = new IncidentSeverity();
    incidentSeverity.name = data.incidentSeverity;
    rule.incidentSeverity = incidentSeverity;
  }

  if (data?.lastIncidentCreatedAt) {
    rule.lastIncidentCreatedAt = data.lastIncidentCreatedAt;
  }

  if (data?.lastIncidentResolvedAt) {
    rule.lastIncidentResolvedAt = data.lastIncidentResolvedAt;
  }

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

/*
 * A burn-rate rule has two independent outputs — an alert and an incident —
 * each with its own severity and its own created/resolved stamps. The model
 * answers "what happens when this rule fires?" purely from these fields, so
 * both halves are pinned: the select that reaches the database (an unselected
 * column comes back undefined and quietly reads as its default) and the
 * serialized row the LLM actually sees.
 */
describe("query_slos — burn-rate rule outputs", () => {
  test("selects both output lifecycles for each rule", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    const rulesSpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);

    await QuerySlosTool.execute({ sloId: SLO_ID.toString() }, ctx);

    const select: JSONObject = (rulesSpy.mock.calls[0]?.[0] as JSONObject)[
      "select"
    ] as JSONObject;

    expect(select["shouldCreateAlert"]).toBe(true);
    expect(select["alertSeverity"]).toEqual({ name: true });
    expect(select["lastAlertCreatedAt"]).toBe(true);
    expect(select["lastAlertResolvedAt"]).toBe(true);
    expect(select["shouldCreateIncident"]).toBe(true);
    expect(select["incidentSeverity"]).toEqual({ name: true });
    expect(select["lastIncidentCreatedAt"]).toBe(true);
    expect(select["lastIncidentResolvedAt"]).toBe(true);
  });

  test("a rule that alerts and declares an incident reports both, with both severities and both stamps", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([
        buildRule({
          name: "Fast burn",
          shouldCreateAlert: true,
          shouldCreateIncident: true,
          incidentSeverity: "Sev1",
          lastIncidentCreatedAt: new Date("2026-08-14T10:00:00Z"),
          lastIncidentResolvedAt: new Date("2026-08-14T11:30:00Z"),
        }),
      ] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("createsAlert=true");
    expect(result.dataForLlm).toContain("alertSeverity=Critical");
    expect(result.dataForLlm).toContain("createsIncident=true");
    expect(result.dataForLlm).toContain("incidentSeverity=Sev1");
    /*
     * The incident stamps are a lifecycle of their own — the model reads them
     * to say whether the declared incident is still open, so they must not be
     * folded into or shadowed by the alert stamps.
     */
    expect(result.dataForLlm).toContain(
      "lastIncidentCreatedAt=2026-08-14T10:00:00.000Z",
    );
    expect(result.dataForLlm).toContain(
      "lastIncidentResolvedAt=2026-08-14T11:30:00.000Z",
    );
  });

  test("a rule written before this feature reads as alerts-only, never as a blank", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      // Neither flag set, i.e. a rule row that predates the incident columns.
      .mockResolvedValue([buildRule({ name: "Legacy burn" })] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    /*
     * The model's defaults (alert on, incident off) must be applied here
     * rather than emitted as an absent field: a missing createsAlert would
     * leave the LLM guessing whether an old rule pages anyone at all.
     */
    expect(result.dataForLlm).toContain("createsAlert=true");
    expect(result.dataForLlm).toContain("createsIncident=false");
    expect(result.dataForLlm).not.toContain("createsAlert=false");
    expect(result.dataForLlm).not.toContain("createsIncident=true");
  });

  test("an explicit shouldCreateAlert=false is honoured, so an incident-only rule never reads as alerting", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([
        buildRule({
          name: "Incident only",
          shouldCreateAlert: false,
          shouldCreateIncident: true,
          incidentSeverity: "Sev2",
        }),
      ] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("createsAlert=false");
    expect(result.dataForLlm).toContain("createsIncident=true");
    expect(result.dataForLlm).toContain("incidentSeverity=Sev2");
  });

  test("an incident rule with no severity relation loaded serializes without one instead of throwing", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([
        buildRule({ name: "No severity", shouldCreateIncident: true }),
      ] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    // SLO row + the one rule row: the rule still made it through.
    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("createsIncident=true");
    expect(result.dataForLlm).not.toContain("incidentSeverity=");
  });

  test("the tool description tells the model rules can declare incidents and where to follow them", () => {
    const description: string = QuerySlosTool.description.toLowerCase();

    // Without this the model never learns the incident half of a rule exists.
    expect(description).toContain("incident");
    expect(description).toContain("query_incidents");
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
