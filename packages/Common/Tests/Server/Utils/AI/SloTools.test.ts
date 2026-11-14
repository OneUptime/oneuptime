import { QuerySlosTool } from "../../../../Server/Utils/AI/Toolbox/SloTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveMonitorRuleService from "../../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjectiveErrorBudgetPolicyTierService from "../../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import LabelService from "../../../../Server/Services/LabelService";
import ServiceLevelObjectiveMonitorRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import Label from "../../../../Models/DatabaseModels/Label";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../../Types/ServiceLevelObjective/SloWindowType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  AIActionCardWords,
  describeAIActionCardWords,
} from "../../../../Types/AI/AIActionWords";
import { dashboardTranslator } from "../../../Helpers/DashboardLocales";
import { expectReadCardWorded } from "../../../Helpers/ReadCardWords";

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

/*
 * Detail mode also reads the SLO's monitor rules. Most cases here are about
 * something else, so they get "no monitor rules" by default; the monitor rule
 * cases below override it.
 */
beforeEach(() => {
  jest
    .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
    .mockResolvedValue([] as never);
  // And no error budget policy, unless a case below gives it one.
  jest
    .spyOn(ServiceLevelObjectiveErrorBudgetPolicyTierService, "findBy")
    .mockResolvedValue([] as never);
});

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

/*
 * Burn-rate rules now take the monitor step form's alert and incident
 * options, so "what happens when this rule fires?" also means: under which
 * title, with which labels and owners, visible to whom, and whether it closes
 * on its own. These pin the select (an unselected column reads back as its
 * default) and that each output's options are reported with the worker's
 * defaults, only for the outputs the rule actually produces.
 */
describe("query_slos — burn-rate rule alert and incident options", () => {
  function idStubs<TModel extends BaseModel>(
    modelType: { new (): TModel },
    count: number,
  ): Array<TModel> {
    const stubs: Array<TModel> = [];

    for (let index: number = 0; index < count; index++) {
      const stub: TModel = new modelType();
      stub._id = ObjectID.generate().toString();
      stubs.push(stub);
    }

    return stubs;
  }

  async function describeRules(
    rules: Array<ServiceLevelObjectiveBurnRateRule>,
  ): Promise<string> {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue(rules as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    return result.dataForLlm;
  }

  test("selects every option, the lists as ids only, and leaves remediation notes out", async () => {
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

    for (const output of ["alert", "incident"]) {
      const capitalized: string =
        output.charAt(0).toUpperCase() + output.slice(1);

      expect(select[`${output}TitleTemplate`]).toBe(true);
      expect(select[`${output}DescriptionTemplate`]).toBe(true);
      expect(select[`is${capitalized}Private`]).toBe(true);
      expect(select[`autoResolve${capitalized}`]).toBe(true);
      expect(select[`${output}Labels`]).toEqual({ _id: true });
      expect(select[`${output}OwnerTeams`]).toEqual({ _id: true });
      expect(select[`${output}OwnerUsers`]).toEqual({ _id: true });
      expect(select[`${output}RemediationNotes`]).toBeUndefined();
    }

    expect(select["addSloOwnersAsOwners"]).toBe(true);
  });

  test("an alerting rule reports its alert options, with templates as set rather than inlined", async () => {
    const rule: ServiceLevelObjectiveBurnRateRule = buildRule({
      name: "Fast burn",
      shouldCreateAlert: true,
    });
    rule.alertTitleTemplate = "{{sloName}} is burning its error budget";
    rule.alertLabels = idStubs(Label, 2);
    rule.alertOwnerTeams = idStubs(Team, 1);
    rule.alertOwnerUsers = idStubs(User, 3);
    rule.isAlertPrivate = true;
    rule.autoResolveAlert = false;
    rule.addSloOwnersAsOwners = true;

    const data: string = await describeRules([rule]);

    expect(data).toContain("hasAlertTitleTemplate=true");
    expect(data).toContain("hasAlertDescriptionTemplate=false");
    expect(data).toContain("alertLabelCount=2");
    expect(data).toContain("alertOwnerTeamCount=1");
    expect(data).toContain("alertOwnerUserCount=3");
    expect(data).toContain("isAlertPrivate=true");
    expect(data).toContain("autoResolveAlert=false");
    expect(data).toContain("addSloOwnersAsOwners=true");
    expect(data).not.toContain("is burning its error budget");
  });

  test("an incident rule reports its incident options", async () => {
    const rule: ServiceLevelObjectiveBurnRateRule = buildRule({
      name: "Incident burn",
      shouldCreateIncident: true,
      incidentSeverity: "Sev1",
    });
    rule.incidentTitleTemplate = "{{sloName}} error budget incident";
    rule.incidentDescriptionTemplate = "Burning at {{burnRate}}x.";
    rule.incidentLabels = idStubs(Label, 1);
    rule.incidentOwnerTeams = idStubs(Team, 2);
    rule.incidentOwnerUsers = [];
    rule.isIncidentPrivate = true;
    rule.autoResolveIncident = false;

    const data: string = await describeRules([rule]);

    expect(data).toContain("hasIncidentTitleTemplate=true");
    expect(data).toContain("hasIncidentDescriptionTemplate=true");
    expect(data).toContain("incidentLabelCount=1");
    expect(data).toContain("incidentOwnerTeamCount=2");
    expect(data).toContain("incidentOwnerUserCount=0");
    expect(data).toContain("isIncidentPrivate=true");
    expect(data).toContain("autoResolveIncident=false");
    expect(data).toContain("addSloOwnersAsOwners=false");
    expect(data).not.toContain("Burning at");
  });

  test("options left unset read as the worker applies them: public, auto-resolving, no extra owners", async () => {
    // Neither option column set, i.e. a rule row that predates them.
    const data: string = await describeRules([
      buildRule({ name: "Legacy burn" }),
    ]);

    expect(data).toContain("hasAlertTitleTemplate=false");
    expect(data).toContain("hasAlertDescriptionTemplate=false");
    expect(data).toContain("alertLabelCount=0");
    expect(data).toContain("alertOwnerTeamCount=0");
    expect(data).toContain("alertOwnerUserCount=0");
    expect(data).toContain("isAlertPrivate=false");
    expect(data).toContain("autoResolveAlert=true");
    expect(data).toContain("addSloOwnersAsOwners=false");
  });

  test("an alert-only rule says nothing about incident options, and an incident-only rule nothing about alert ones", async () => {
    const alertOnly: string = await describeRules([
      buildRule({ name: "Alert only" }),
    ]);

    expect(alertOnly).toContain("autoResolveAlert=true");
    expect(alertOnly).not.toContain("autoResolveIncident=");
    expect(alertOnly).not.toContain("isIncidentPrivate=");
    expect(alertOnly).not.toContain("incidentLabelCount=");
    expect(alertOnly).not.toContain("hasIncidentTitleTemplate=");

    // Re-spying hands back the same spies, now serving the second rule.
    const incidentOnly: string = await describeRules([
      buildRule({
        name: "Incident only",
        shouldCreateAlert: false,
        shouldCreateIncident: true,
      }),
    ]);

    expect(incidentOnly).toContain("autoResolveIncident=true");
    expect(incidentOnly).not.toContain("autoResolveAlert=");
    expect(incidentOnly).not.toContain("isAlertPrivate=");
    expect(incidentOnly).not.toContain("alertLabelCount=");
    expect(incidentOnly).not.toContain("hasAlertTitleTemplate=");
  });

  test("a rule with neither output reports no output options at all", async () => {
    const data: string = await describeRules([
      buildRule({
        name: "Silent",
        shouldCreateAlert: false,
        shouldCreateIncident: false,
      }),
    ]);

    expect(data).toContain("createsAlert=false");
    expect(data).toContain("createsIncident=false");
    expect(data).not.toContain("autoResolveAlert=");
    expect(data).not.toContain("autoResolveIncident=");
    expect(data).not.toContain("addSloOwnersAsOwners=");
  });

  test("a whitespace-only template reads as no template, since the default text is used", async () => {
    const rule: ServiceLevelObjectiveBurnRateRule = buildRule({
      name: "Blank templates",
    });
    rule.alertTitleTemplate = "   ";
    rule.alertDescriptionTemplate = "\n\t";

    const data: string = await describeRules([rule]);

    expect(data).toContain("hasAlertTitleTemplate=false");
    expect(data).toContain("hasAlertDescriptionTemplate=false");
  });

  test("the tool description tells the model it can say how each output is created", () => {
    const description: string = QuerySlosTool.description.toLowerCase();

    expect(description).toContain("template");
    expect(description).toContain("owner");
    expect(description).toContain("private");
    expect(description).toContain("auto-resolve");
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

/*
 * SLO Monitor Rules replaced the single "auto-add monitors with labels" list
 * on the SLO. The model answers "why is this monitor on the SLO?" from these
 * rows, so each rule reports whether it is enabled and what it matches in
 * words - the same words the SLO feed uses - read under the user's own props.
 */
describe("query_slos — monitor rules", () => {
  const PRODUCTION_LABEL_ID: ObjectID = ObjectID.generate();
  const TIER1_LABEL_ID: ObjectID = ObjectID.generate();

  function buildLabel(id: ObjectID, name: string): Label {
    const label: Label = new Label();
    label._id = id.toString();
    label.name = name;
    return label;
  }

  function buildMonitorRules(): Array<ServiceLevelObjectiveMonitorRule> {
    const legacy: ServiceLevelObjectiveMonitorRule =
      new ServiceLevelObjectiveMonitorRule();
    legacy._id = ObjectID.generate().toString();
    legacy.name = "Production APIs";
    legacy.isEnabled = true;
    legacy.monitorLabels = [buildLabel(PRODUCTION_LABEL_ID, "Production")];
    legacy.monitorNamePattern = "^api-";
    legacy.monitorType = MonitorType.API;

    const configured: ServiceLevelObjectiveMonitorRule =
      new ServiceLevelObjectiveMonitorRule();
    configured._id = ObjectID.generate().toString();
    configured.name = "Tier one";
    configured.isEnabled = false;
    configured.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [TIER1_LABEL_ID.toString()],
        },
        {
          field: "monitorType",
          operator: RuleCriteriaOperator.NotEquals,
          value: MonitorType.Manual,
        },
      ],
    };

    return [legacy, configured];
  }

  test("reads this SLO's monitor rules under the user's props and says what each one matches", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);
    const monitorRulesSpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockResolvedValue(buildMonitorRules() as never);
    const labelsSpy: jest.SpyInstance = jest
      .spyOn(LabelService, "findBy")
      .mockResolvedValue([buildLabel(TIER1_LABEL_ID, "Tier 1")] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    // SLO row + 2 monitor rule rows.
    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).toContain("Production APIs");
    expect(result.dataForLlm).toContain("Labels has any of");
    expect(result.dataForLlm).toContain("Name matches pattern");
    expect(result.dataForLlm).toContain("Type is");
    expect(result.dataForLlm).toContain("Type is not");
    expect(result.dataForLlm).toContain("Tier one");
    // A criteria rule stores label ids; the name is looked up for the model.
    expect(result.dataForLlm).toContain("Tier 1");

    const call: JSONObject = monitorRulesSpy.mock.calls[0]?.[0] as JSONObject;
    expect(
      (call["query"] as JSONObject)["serviceLevelObjectiveId"]?.toString(),
    ).toBe(SLO_ID.toString());
    expect(call["props"]).toBe(ctx.props);
    expect((call["select"] as JSONObject)["criteria"]).toBe(true);
    expect((call["select"] as JSONObject)["monitorType"]).toBe(true);
    expect((call["select"] as JSONObject)["monitorLabels"]).toEqual({
      _id: true,
      name: true,
    });

    // Only the unnamed criteria label is looked up, and as the user.
    expect(labelsSpy).toHaveBeenCalledTimes(1);
    expect((labelsSpy.mock.calls[0]?.[0] as JSONObject)["props"]).toBe(
      ctx.props,
    );
  });

  test("counts the enabled monitor rules on the widget", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockResolvedValue(buildMonitorRules() as never);
    jest.spyOn(LabelService, "findBy").mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(JSON.stringify(result.widget)).toContain("1 of 2 enabled");
  });

  test("a label the user cannot read degrades to an unknown label instead of failing the tool", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockResolvedValue(buildMonitorRules() as never);
    jest
      .spyOn(LabelService, "findBy")
      .mockRejectedValue(new Error("not allowed") as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).toContain("unknown label");
  });

  test("does not look monitor rules up for an SLO the user cannot see", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(null as never);
    const monitorRulesSpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockResolvedValue([] as never);

    await QuerySlosTool.execute({ sloId: SLO_ID.toString() }, ctx);

    expect(monitorRulesSpy).not.toHaveBeenCalled();
  });

  test("no longer reports the deprecated auto-attach label list off the SLO", async () => {
    const findOneByIdSpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(buildSlo() as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain("autoAttachMonitorLabels");
    expect(
      (
        (findOneByIdSpy.mock.calls[0]?.[0] as JSONObject)[
          "select"
        ] as JSONObject
      )["monitorLabels"],
    ).toBeUndefined();

    const sloIdDescription: string = String(
      (
        (QuerySlosTool.inputSchema as unknown as JSONObject)[
          "properties"
        ] as JSONObject
      )["sloId"]
        ? (
            (
              (QuerySlosTool.inputSchema as unknown as JSONObject)[
                "properties"
              ] as JSONObject
            )["sloId"] as JSONObject
          )["description"]
        : "",
    );

    expect(sloIdDescription).toContain("monitor rules");
    expect(sloIdDescription).not.toContain("monitor labels");
  });
});

/*
 * The burn-rate rules OneUptime recommends for every SLO - Fast burn, Slow
 * burn and Slow leak - that this SLO does not have. An SLO created before
 * Slow leak existed is missing it, and "is this SLO covered?" is a question
 * the model is asked. They travel as a note, never as rows: they are not
 * records of the SLO, and nothing about them fires.
 */
describe("query_slos — recommended burn-rate rules the SLO is missing", () => {
  function ruleWith(
    name: string,
    longWindowInMinutes: number,
  ): ServiceLevelObjectiveBurnRateRule {
    const rule: ServiceLevelObjectiveBurnRateRule = buildRule({ name });
    rule.longWindowInMinutes = longWindowInMinutes;
    return rule;
  }

  async function detailWith(
    rules: Array<ServiceLevelObjectiveBurnRateRule>,
    slo: ServiceLevelObjective = buildSlo(),
  ): Promise<ToolExecutionResult> {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(slo as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue(rules as never);

    return await QuerySlosTool.execute({ sloId: SLO_ID.toString() }, ctx);
  }

  test("an SLO created before Slow leak existed is told it is missing it, scaled to its window, and where it is added", async () => {
    const result: ToolExecutionResult = await detailWith([
      ruleWith("Fast burn", 60),
      ruleWith("Slow burn", 360),
    ]);

    expect(result.dataForLlm).toContain(
      "Note: this SLO does not have this burn-rate rule OneUptime recommends for every SLO",
    );
    expect(result.dataForLlm).toContain(
      "Slow leak (burn rate 1x over 4320 minutes, confirmed over 360 minutes; raises an alert at the project's least severe alert severity and declares no incident; waits 1440 minutes after an alert resolves before raising another)",
    );
    expect(result.dataForLlm).toContain(
      "on the SLO's Burn Rate Rules page with Add recommended rules",
    );
    expect(result.dataForLlm).toContain("It is not set up and never fire");

    // A note, not a record: the SLO row and its two rules.
    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).not.toContain("Fast burn (burn rate");
  });

  test("an SLO with every recommended rule carries no note", async () => {
    const result: ToolExecutionResult = await detailWith([
      ruleWith("Fast burn", 60),
      ruleWith("Slow burn", 360),
      ruleWith("Slow leak", 4320),
    ]);

    expect(result.dataForLlm).not.toContain("OneUptime recommends");
    expect(result.rowCount).toBe(4);
  });

  test("a renamed or tuned default rule still counts as there", async () => {
    const result: ToolExecutionResult = await detailWith([
      ruleWith("Paging", 60),
      ruleWith("Slow burn", 240),
      ruleWith("Ticket", 4320),
    ]);

    expect(result.dataForLlm).not.toContain("OneUptime recommends");
  });

  test("an SLO with no rules is told about all three, the pages at the most severe severity", async () => {
    const result: ToolExecutionResult = await detailWith([]);

    expect(result.dataForLlm).toContain(
      "Note: this SLO does not have these burn-rate rules OneUptime recommends for every SLO",
    );
    expect(result.dataForLlm).toContain(
      "Fast burn (burn rate 14.4x over 60 minutes, confirmed over 5 minutes; raises an alert at the project's most severe alert severity and declares no incident; waits 60 minutes after an alert resolves before raising another)",
    );
    expect(result.dataForLlm).toContain(
      "Slow burn (burn rate 6x over 360 minutes, confirmed over 30 minutes; raises an alert at the project's most severe alert severity",
    );
    expect(result.dataForLlm).toContain("Slow leak (burn rate 1x over 4320");
    expect(result.dataForLlm).toContain("They are not set up and never fire");
  });

  test("a 7-day SLO's slow leak is described as it would be added: 16.8 hours over 84 minutes", async () => {
    const slo: ServiceLevelObjective = buildSlo();
    slo.windowDays = 7;

    const result: ToolExecutionResult = await detailWith(
      [ruleWith("Fast burn", 60), ruleWith("Slow burn", 360)],
      slo,
    );

    expect(result.dataForLlm).toContain(
      "Slow leak (burn rate 1x over 1008 minutes, confirmed over 84 minutes;",
    );
    expect(result.dataForLlm).toContain(
      "waits 1008 minutes after an alert resolves",
    );
  });

  test("a read the limit cut short says nothing: a rule that is there could read as missing", async () => {
    const rules: Array<ServiceLevelObjectiveBurnRateRule> = Array.from(
      { length: 25 },
      (_value: unknown, index: number): ServiceLevelObjectiveBurnRateRule => {
        return ruleWith(`Rule ${index + 1}`, 30);
      },
    );

    const result: ToolExecutionResult = await detailWith(rules);

    expect(result.dataForLlm).not.toContain("OneUptime recommends");
  });

  test("the tool description says it reports the recommended rules an SLO is missing", () => {
    expect(QuerySlosTool.description).toContain(
      "which of OneUptime's recommended burn-rate rules (Fast burn, Slow burn, Slow leak) the SLO is missing",
    );
  });

  /*
   * A team that wants Slow leak everywhere asks how to add it to all its
   * SLOs: the model is told the SLO list's Bulk Actions do that, not only
   * each SLO's own page.
   */
  test("says the missing rules can be added to many SLOs at once from the SLO list", async () => {
    const result: ToolExecutionResult = await detailWith([
      ruleWith("Fast burn", 60),
      ruleWith("Slow burn", 360),
    ]);

    expect(result.dataForLlm).toContain(
      "Anyone who can create SLO burn rate rules can add it on the SLO's Burn Rate Rules page with Add recommended rules, or add the missing recommended rules to many SLOs at once by selecting them on the SLO list and choosing Add recommended rules under Bulk Actions.",
    );
    expect(result.dataForLlm).not.toContain("unarchive the SLO first");
  });

  test("an archived SLO is told to be unarchived first: neither its page nor the SLO list offers the rules", async () => {
    const slo: ServiceLevelObjective = buildSlo();
    slo.isArchived = true;

    const result: ToolExecutionResult = await detailWith(
      [ruleWith("Fast burn", 60), ruleWith("Slow burn", 360)],
      slo,
    );

    expect(result.dataForLlm).toContain(
      "Note: this SLO does not have this burn-rate rule OneUptime recommends for every SLO",
    );
    expect(result.dataForLlm).toContain(
      "This SLO is archived, so its rules never fire and neither its Burn Rate Rules page nor the SLO list offers it: unarchive the SLO first, then add it on its Burn Rate Rules page with Add recommended rules.",
    );
    expect(result.dataForLlm).not.toContain("under Bulk Actions");
  });

  test("speaks of every missing rule in the plural, live or archived", async () => {
    const live: ToolExecutionResult = await detailWith([]);

    expect(live.dataForLlm).toContain(
      "Anyone who can create SLO burn rate rules can add them on the SLO's Burn Rate Rules page with Add recommended rules",
    );

    const slo: ServiceLevelObjective = buildSlo();
    slo.isArchived = true;

    const archived: ToolExecutionResult = await detailWith([], slo);

    expect(archived.dataForLlm).toContain(
      "neither its Burn Rate Rules page nor the SLO list offers them: unarchive the SLO first, then add them",
    );
  });
});

describe("query_slos — error budget policy", () => {
  const CAUTION_ID: ObjectID = ObjectID.generate();
  const RELIABILITY_FIRST_ID: ObjectID = ObjectID.generate();
  const EXHAUSTED_ID: ObjectID = ObjectID.generate();

  function buildTier(data: {
    id: ObjectID;
    name: string;
    thresholdPercentage: number;
    whatWeDo?: string;
    isEnabled?: boolean;
    freezesDeployments?: boolean;
    shouldCreateAlert?: boolean;
    shouldCreateIncident?: boolean;
  }): ServiceLevelObjectiveErrorBudgetPolicyTier {
    const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
      new ServiceLevelObjectiveErrorBudgetPolicyTier();
    tier._id = data.id.toString();
    tier.name = data.name;
    tier.thresholdPercentage = data.thresholdPercentage;
    tier.whatWeDo = data.whatWeDo ?? `${data.name}: what the team does.`;
    tier.isEnabled = data.isEnabled ?? true;

    if (data.freezesDeployments !== undefined) {
      tier.freezesDeployments = data.freezesDeployments;
    }

    if (data.shouldCreateAlert !== undefined) {
      tier.shouldCreateAlert = data.shouldCreateAlert;
    }

    if (data.shouldCreateIncident !== undefined) {
      tier.shouldCreateIncident = data.shouldCreateIncident;
    }

    return tier;
  }

  // The recommended policy, read back from the database in no useful order.
  function policy(): Array<ServiceLevelObjectiveErrorBudgetPolicyTier> {
    return [
      buildTier({
        id: EXHAUSTED_ID,
        name: "Budget exhausted",
        thresholdPercentage: 0,
        shouldCreateIncident: true,
      }),
      buildTier({
        id: CAUTION_ID,
        name: "Caution",
        thresholdPercentage: 50,
      }),
      buildTier({
        id: RELIABILITY_FIRST_ID,
        name: "Reliability first",
        thresholdPercentage: 25,
        shouldCreateAlert: true,
      }),
    ];
  }

  function sloInTier(
    tierId: ObjectID | null,
    tierName: string | null,
  ): ServiceLevelObjective {
    const slo: ServiceLevelObjective = buildSlo();

    if (tierId && tierName) {
      slo.currentErrorBudgetPolicyTierId = tierId;
      slo.currentErrorBudgetPolicyTierName = tierName;
      slo.currentErrorBudgetPolicyTierEnteredAt = new Date(
        "2026-08-13T10:00:00Z",
      );
    }

    return slo;
  }

  async function detail(data: {
    slo: ServiceLevelObjective;
    tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier> | "denied";
  }): Promise<{ result: ToolExecutionResult; tiersSpy: jest.SpyInstance }> {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(data.slo as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);

    const tiersSpy: jest.SpyInstance = jest.spyOn(
      ServiceLevelObjectiveErrorBudgetPolicyTierService,
      "findBy",
    );

    if (data.tiers === "denied") {
      tiersSpy.mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to read SLO Error Budget Policy Tiers.",
        ) as never,
      );
    } else {
      tiersSpy.mockResolvedValue(data.tiers as never);
    }

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    return { result, tiersSpy };
  }

  function widgetField(
    result: ToolExecutionResult,
    label: string,
  ): string | undefined {
    const widget: {
      data?: { fields?: Array<{ label: string; value: string }> };
    } =
      (result.widget as unknown as {
        data?: { fields?: Array<{ label: string; value: string }> };
      }) || {};
    const fields: Array<{ label: string; value: string }> =
      widget.data?.fields || [];

    return fields.find((field: { label: string }): boolean => {
      return field.label === label;
    })?.value;
  }

  test("returns the tiers, most budget left first, and marks the one the SLO is in", async () => {
    const { result } = await detail({
      slo: sloInTier(RELIABILITY_FIRST_ID, "Reliability first"),
      tiers: policy(),
    });

    const text: string = result.dataForLlm;

    // SLO row, then the three tiers in the order the budget reaches them.
    expect(result.rowCount).toBe(4);
    expect(text.indexOf("Caution")).toBeLessThan(
      text.indexOf("Reliability first: what the team does."),
    );
    expect(text.indexOf("Reliability first: what the team does.")).toBeLessThan(
      text.indexOf("Budget exhausted"),
    );
    expect(text).toContain("error budget left at or below 25%");
    expect(text).toContain("error budget left at or below 0%");
    expect(text).toContain("Reliability first: what the team does.");
    // The SLO row names the tier it is in.
    expect(text).toContain("currentErrorBudgetPolicyTier");
    expect(text).toContain("isCurrentTier");
    // The model is told how to read a tier.
    expect(text).toContain(
      "errorBudgetPolicyTier rows are the SLO's error budget policy",
    );
    expect(widgetField(result, "Error budget policy tier")).toBe(
      "Reliability first",
    );
  });

  test("reads the tiers as the caller, only for the SLO asked about", async () => {
    const { tiersSpy } = await detail({
      slo: sloInTier(null, null),
      tiers: policy(),
    });

    const callArgs: JSONObject = tiersSpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
    expect(
      (callArgs["query"] as JSONObject)["serviceLevelObjectiveId"]?.toString(),
    ).toBe(SLO_ID.toString());
  });

  test("a tier's outputs read with the tier's defaults: off unless switched on", async () => {
    const { result } = await detail({
      slo: sloInTier(null, null),
      tiers: [
        buildTier({
          id: CAUTION_ID,
          name: "Caution",
          thresholdPercentage: 50,
        }),
      ],
    });

    const tierRow: string =
      result.dataForLlm.split("\n").find((line: string): boolean => {
        return (
          line.includes("errorBudgetPolicyTier") && line.includes("Caution")
        );
      }) || result.dataForLlm;

    expect(tierRow).toContain("createsAlert");
    expect(result.dataForLlm).not.toMatch(/createsAlert[^,\n]*true/);
    expect(result.dataForLlm).not.toMatch(/createsIncident[^,\n]*true/);
  });

  test("an SLO above every tier says so, and one without a policy says that", async () => {
    const { result: aboveEveryTier } = await detail({
      slo: sloInTier(null, null),
      tiers: policy(),
    });

    expect(widgetField(aboveEveryTier, "Error budget policy tier")).toBe(
      "None - the budget is above every tier",
    );

    jest.restoreAllMocks();
    jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockResolvedValue([] as never);

    const { result: noPolicy } = await detail({
      slo: sloInTier(null, null),
      tiers: [],
    });

    expect(widgetField(noPolicy, "Error budget policy tier")).toBe(
      "No error budget policy",
    );
    // No tiers, no note about reading them.
    expect(noPolicy.dataForLlm).not.toContain("errorBudgetPolicyTier rows are");
  });

  test("a caller who may not read tiers still gets the SLO, and the tier it is in", async () => {
    const { result } = await detail({
      slo: sloInTier(EXHAUSTED_ID, "Budget exhausted"),
      tiers: "denied",
    });

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(
      "error budget policy tiers are left out because the current user does not have permission to read SLO Error Budget Policy Tiers (ReadServiceLevelObjectiveErrorBudgetPolicyTier)",
    );
    // The tier is SLO data: still there, on the SLO row and in the card.
    expect(result.dataForLlm).toContain("Budget exhausted");
    expect(widgetField(result, "Error budget policy tier")).toBe(
      "Budget exhausted",
    );
  });

  test("a caller who may not read tiers, for an SLO in none, is told it cannot see them", async () => {
    const { result } = await detail({
      slo: sloInTier(null, null),
      tiers: "denied",
    });

    expect(widgetField(result, "Error budget policy tier")).toBe(
      "Not visible to you",
    );
  });

  test("a failure that is not a permission denial still fails the call", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(sloInTier(null, null) as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ServiceLevelObjectiveErrorBudgetPolicyTierService, "findBy")
      .mockRejectedValue(new Error("connection lost") as never);

    await expect(
      QuerySlosTool.execute({ sloId: SLO_ID.toString() }, ctx),
    ).rejects.toThrow("connection lost");
  });

  test('a long "what we do" is cut, so one tier cannot crowd out the rest', async () => {
    const { result } = await detail({
      slo: sloInTier(null, null),
      tiers: [
        buildTier({
          id: CAUTION_ID,
          name: "Caution",
          thresholdPercentage: 50,
          whatWeDo: "x".repeat(5000),
        }),
      ],
    });

    expect(result.dataForLlm).toContain(`${"x".repeat(1000)}…`);
    expect(result.dataForLlm).not.toContain("x".repeat(1001));
  });

  test("the tiers of an SLO the caller cannot see are never read", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(null as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);
    const tiersSpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveErrorBudgetPolicyTierService, "findBy")
      .mockResolvedValue(policy() as never);

    await QuerySlosTool.execute({ sloId: SLO_ID.toString() }, ctx);

    expect(tiersSpy).not.toHaveBeenCalled();
  });

  test("list mode names the tier each SLO is in", async () => {
    const inTier: ServiceLevelObjective = sloInTier(CAUTION_ID, "Caution");
    const findBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([
        inTier,
        buildSlo({ id: ObjectID.generate(), name: "Search latency" }),
      ] as never);
    jest
      .spyOn(ServiceLevelObjectiveService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute({}, ctx);

    expect(result.dataForLlm).toContain("currentErrorBudgetPolicyTier");
    expect(result.dataForLlm).toContain("Caution");

    const select: JSONObject = (findBySpy.mock.calls[0]?.[0] as JSONObject)[
      "select"
    ] as JSONObject;
    expect(select["currentErrorBudgetPolicyTierName"]).toBe(true);
  });

  test("the tool description says it reports the error budget policy", () => {
    expect(QuerySlosTool.description).toContain("error budget policy");
    expect(QuerySlosTool.description).toContain("the tier the SLO is in now");
  });

  /*
   * The SLO's own row: the line that carries deploymentsAllowed and is not
   * the note above the rows, which names the field to say how to read it.
   */
  const sloRowOf: (result: ToolExecutionResult) => string = (
    result: ToolExecutionResult,
  ): string => {
    return (
      result.dataForLlm.split("\n").find((line: string): boolean => {
        return line.includes("deploymentsAllowed") && !line.startsWith("Note:");
      }) || ""
    );
  };

  test("an SLO's row answers the deploy gate: allowed, and the model is told how to read it", async () => {
    const { result } = await detail({
      slo: sloInTier(CAUTION_ID, "Caution"),
      tiers: policy(),
    });

    const sloRow: string = sloRowOf(result);

    expect(sloRow).toMatch(/deploymentsAllowed[^,\n]*true/);
    // No freeze time on an allowed SLO's row.
    expect(sloRow).not.toContain("deploymentsFrozenAt");
    expect(result.dataForLlm).toContain(
      "deploymentsAllowed on an SLO row is the deploy gate CI/CD pipelines read before they release",
    );
    expect(widgetField(result, "Deployments")).toBe("Allowed");
  });

  test("a frozen SLO's row says so, and since when", async () => {
    const frozen: ServiceLevelObjective = sloInTier(
      EXHAUSTED_ID,
      "Budget exhausted",
    );
    frozen.deploymentsAllowed = false;
    frozen.deploymentsFrozenAt = new Date("2026-08-13T10:05:00Z");

    const { result } = await detail({
      slo: frozen,
      tiers: policy().map(
        (
          tier: ServiceLevelObjectiveErrorBudgetPolicyTier,
        ): ServiceLevelObjectiveErrorBudgetPolicyTier => {
          tier.freezesDeployments = tier.name === "Budget exhausted";
          return tier;
        },
      ),
    });

    const sloRow: string = sloRowOf(result);

    expect(sloRow).toMatch(/deploymentsAllowed[^,\n]*false/);
    expect(sloRow).toContain("deploymentsFrozenAt");
    expect(sloRow).toContain("2026-08-13");
    expect(widgetField(result, "Deployments")).toBe(
      "Frozen by the error budget policy",
    );

    // Each tier says whether it freezes deployments.
    const exhaustedRow: string =
      result.dataForLlm.split("\n").find((line: string): boolean => {
        return (
          line.includes("errorBudgetPolicyTier") &&
          line.includes("Budget exhausted")
        );
      }) || "";

    expect(exhaustedRow).toMatch(/freezesDeployments[^,\n]*true/);
    expect(result.dataForLlm).toContain(
      "freezesDeployments says whether being in the tier freezes deployments",
    );
  });

  test("reads the deploy gate with the SLO, and each tier's switch with the tiers", async () => {
    const findOneByIdSpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(sloInTier(null, null) as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([] as never);
    const tiersSpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveErrorBudgetPolicyTierService, "findBy")
      .mockResolvedValue(policy() as never);

    await QuerySlosTool.execute({ sloId: SLO_ID.toString() }, ctx);

    const sloSelect: JSONObject = (
      findOneByIdSpy.mock.calls[0]?.[0] as JSONObject
    )["select"] as JSONObject;
    const tierSelect: JSONObject = (tiersSpy.mock.calls[0]?.[0] as JSONObject)[
      "select"
    ] as JSONObject;

    expect(sloSelect["deploymentsAllowed"]).toBe(true);
    expect(sloSelect["deploymentsFrozenAt"]).toBe(true);
    expect(tierSelect["freezesDeployments"]).toBe(true);
  });

  test("a caller who may not read tiers still gets the deploy gate: it is SLO data", async () => {
    const frozen: ServiceLevelObjective = sloInTier(
      EXHAUSTED_ID,
      "Budget exhausted",
    );
    frozen.deploymentsAllowed = false;

    const { result } = await detail({ slo: frozen, tiers: "denied" });

    expect(sloRowOf(result)).toMatch(/deploymentsAllowed[^,\n]*false/);
    expect(widgetField(result, "Deployments")).toBe(
      "Frozen by the error budget policy",
    );
  });

  test("list mode answers the deploy gate on every row", async () => {
    const frozen: ServiceLevelObjective = sloInTier(
      EXHAUSTED_ID,
      "Budget exhausted",
    );
    frozen.deploymentsAllowed = false;

    const findBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([
        frozen,
        buildSlo({ id: ObjectID.generate(), name: "Search latency" }),
      ] as never);
    jest
      .spyOn(ServiceLevelObjectiveService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute({}, ctx);

    const lines: Array<string> = result.dataForLlm.split("\n");

    expect(
      lines.find((line: string): boolean => {
        return line.includes("Checkout availability");
      }),
    ).toMatch(/deploymentsAllowed[^,\n]*false/);
    expect(
      lines.find((line: string): boolean => {
        return line.includes("Search latency");
      }),
    ).toMatch(/deploymentsAllowed[^,\n]*true/);
    expect(result.dataForLlm).toContain(
      "deploymentsAllowed on an SLO row is the deploy gate",
    );

    const select: JSONObject = (findBySpy.mock.calls[0]?.[0] as JSONObject)[
      "select"
    ] as JSONObject;
    expect(select["deploymentsAllowed"]).toBe(true);
  });

  test("the tool description says how to read the deploy gate", () => {
    expect(QuerySlosTool.description).toContain("deploymentsAllowed: false");
    expect(QuerySlosTool.description).toContain(
      "whether each freezes deployments",
    );
  });
});

/*
 * Issue #7175: the SLO's card said "Target", "Rolling 30-day window" and
 * "None - monitors are picked by hand" in English on a German page. Its
 * words are OneUptime's own now, its figures written the reader's way, and
 * the English it stores the same words in English.
 */
describe("query_slos — the card, in the reader's language", () => {
  async function sloCardWords(
    slo: ServiceLevelObjective,
  ): Promise<AIActionCardWords> {
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(slo as never);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([
        buildRule({ name: "Fast burn", threshold: 14.4 }),
        buildRule({ name: "Slow burn", threshold: 3 }),
      ] as never);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(result.widget!.data["heading"]).toBe("Checkout availability");

    return expectReadCardWorded(result.widget);
  }

  test("every word worded in every language; its English the card's as before", async () => {
    const words: AIActionCardWords = await sloCardWords(buildSlo());

    expect(describeAIActionCardWords(words)).toEqual({
      kind: "SLO",
      line: "Checkout must stay reachable.",
      facts: [
        { label: "Target", value: "99.9%" },
        { label: "Window", value: "Rolling 30-day window" },
        { label: "SLI type", value: "Monitor uptime" },
        { label: "Status", value: "Healthy" },
        { label: "Current SLI", value: "99.95%" },
        { label: "Error budget left", value: "47.3%" },
        { label: "Burn rate", value: "0.8" },
        { label: "Monitors", value: "Checkout API" },
        { label: "Monitor rules", value: "None - monitors are picked by hand" },
        { label: "Burn-rate rules", value: "2" },
        { label: "Error budget policy tier", value: "No error budget policy" },
        { label: "Deployments", value: "Allowed" },
      ],
    });
  });

  test("in German: German words, German figures; the SLO's description and monitors as written", async () => {
    const words: AIActionCardWords = await sloCardWords(buildSlo());
    const drawn: {
      kind: string;
      line?: string | undefined;
      facts: Array<{ label: string; value: string }>;
    } = describeAIActionCardWords(words, dashboardTranslator("de"));
    const noBreakSpace: string = String.fromCharCode(0x00a0);

    expect(drawn.line).toBe("Checkout must stay reachable.");
    expect(drawn.facts).toEqual(
      expect.arrayContaining([
        { label: "Ziel", value: `99,9${noBreakSpace}%` },
        {
          label: "Zeitfenster",
          value: "Rollierendes Zeitfenster von 30 Tagen",
        },
        { label: "Burn-Rate", value: "0,8" },
        { label: "Monitore", value: "Checkout API" },
      ]),
    );

    for (const english of [
      "Target",
      "Rolling",
      "Monitor uptime",
      "Healthy",
      "None - monitors are picked by hand",
      "No error budget policy",
      "Allowed",
    ]) {
      expect(JSON.stringify(drawn)).not.toContain(english);
    }
  });

  test("an SLO not evaluated yet says so in the reader's language, never 0%", async () => {
    const words: AIActionCardWords = await sloCardWords(
      buildSlo({ evaluated: false }),
    );
    const notEvaluated: Array<string> = describeAIActionCardWords(words)
      .facts.filter((fact: { value: string }): boolean => {
        return fact.value === "Not evaluated yet";
      })
      .map((fact: { label: string }): string => {
        return fact.label;
      });

    expect(notEvaluated).toEqual([
      "Current SLI",
      "Error budget left",
      "Burn rate",
    ]);
    expect(
      JSON.stringify(
        describeAIActionCardWords(words, dashboardTranslator("fa")),
      ),
    ).not.toContain("Not evaluated yet");
  });
});
