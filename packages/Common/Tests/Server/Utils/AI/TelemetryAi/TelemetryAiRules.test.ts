import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AutoRemediationRuleService from "../../../../../Server/Services/AutoRemediationRuleService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryAiRules, {
  TELEMETRY_AI_PROJECT_SELECT,
  TelemetryAiRuleService,
} from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiRules";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import Label from "../../../../../Models/DatabaseModels/Label";
import Project from "../../../../../Models/DatabaseModels/Project";
import Service from "../../../../../Models/DatabaseModels/Service";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import { AiRuleFix } from "../../../../../Types/AI/AiRule";
import {
  TelemetryAiLane,
  TelemetryAiSkip,
  TelemetryAiWork,
} from "../../../../../Types/AI/TelemetryAi";
import AutoRemediationExecutionMode from "../../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "../../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../../Types/Rules/RuleCriteria";

/*
 * The AI rules of a telemetry lane, read and matched by the service a
 * problem was found in (TelemetryAiRules): the picked services, the named
 * labels and a pattern on the name - or the conditions the dashboard
 * writes, read through the one criteria matcher every rule uses.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5092bbbb-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5092bbbb-0000-4000-8000-000000000002";
const BILLING: string = "5092bbbb-0000-4000-8000-000000000003";
const PROD_LABEL: string = "5092bbbb-0000-4000-8000-000000000004";
const STAGING_LABEL: string = "5092bbbb-0000-4000-8000-000000000005";

const SERVICES: Map<string, TelemetryAiRuleService> = new Map<
  string,
  TelemetryAiRuleService
>([
  [CHECKOUT, { id: CHECKOUT, name: "checkout-api", labelIds: [PROD_LABEL] }],
  [BILLING, { id: BILLING, name: "billing-worker", labelIds: [STAGING_LABEL] }],
]);

function rule(
  overrides: Partial<AutoRemediationRule> = {},
): AutoRemediationRule {
  const value: AutoRemediationRule = new AutoRemediationRule();
  value.id = ObjectID.generate();
  value.name = "A rule";
  value.investigates = true;
  value.fixes = true;
  value.executionMode = AutoRemediationExecutionMode.FullAuto;
  Object.assign(value, overrides);
  return value;
}

function relation<T extends { id?: ObjectID | null }>(
  type: new () => T,
  id: string,
): T {
  const row: T = new type();
  row.id = new ObjectID(id);
  return row;
}

function criteria(
  filters: RuleCriteria["filters"],
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition,
    filters,
  };
}

function decide(
  rules: Array<AutoRemediationRule> | null,
  serviceIds: Array<string> = [CHECKOUT, BILLING],
): Map<string, TelemetryAiWork> {
  return TelemetryAiRules.decideForServices({
    isAiEnabled: true,
    isLaneOn: true,
    rules,
    serviceIds,
    services: SERVICES,
  });
}

function matchesBoth(rules: Array<AutoRemediationRule>): Array<boolean> {
  const work: Map<string, TelemetryAiWork> = decide(rules);

  return [CHECKOUT, BILLING].map((id: string): boolean => {
    return work.get(id)!.skip === null;
  });
}

describe("decideForServices - the rule columns", () => {
  test("no rule: every service's slow code is investigated and fixed", () => {
    const work: Map<string, TelemetryAiWork> = decide([]);

    for (const id of [CHECKOUT, BILLING]) {
      expect(work.get(id)!.skip).toBeNull();
      expect(work.get(id)!.fix).toBe(AiRuleFix.WithoutAsking);
    }
  });

  test("a rule with no condition matches every service", () => {
    expect(matchesBoth([rule()])).toEqual([true, true]);
  });

  test("picked services: only those", () => {
    expect(
      matchesBoth([rule({ services: [relation(Service, CHECKOUT)] })]),
    ).toEqual([true, false]);
  });

  test("named labels: a service that carries one of them", () => {
    expect(
      matchesBoth([rule({ serviceLabels: [relation(Label, STAGING_LABEL)] })]),
    ).toEqual([false, true]);
  });

  test("a name pattern: a service whose name it matches, case-insensitive", () => {
    expect(matchesBoth([rule({ serviceNamePattern: "CHECKOUT" })])).toEqual([
      true,
      false,
    ]);
    expect(matchesBoth([rule({ serviceNamePattern: "^billing-" })])).toEqual([
      false,
      true,
    ]);
  });

  test("columns together must all hold", () => {
    expect(
      matchesBoth([
        rule({
          services: [relation(Service, CHECKOUT), relation(Service, BILLING)],
          serviceLabels: [relation(Label, PROD_LABEL)],
        }),
      ]),
    ).toEqual([true, false]);
  });

  test("the never-match pattern an old API pod would read matches nothing", () => {
    expect(
      matchesBoth([
        rule({ serviceNamePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN }),
      ]),
    ).toEqual([false, false]);
  });

  test("an unreadable pattern matches nothing, and says so", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});

    expect(matchesBoth([rule({ serviceNamePattern: "(" })])).toEqual([
      false,
      false,
    ]);
  });
});

describe("decideForServices - the conditions the dashboard writes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Services has any of", () => {
    expect(
      matchesBoth([
        rule({
          criteria: criteria([
            {
              field: "services",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [BILLING],
            },
          ]),
          // Beside conditions, the dashboard writes this: it is ignored.
          serviceNamePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
        }),
      ]),
    ).toEqual([false, true]);
  });

  test("Services has none of", () => {
    expect(
      matchesBoth([
        rule({
          criteria: criteria([
            {
              field: "services",
              operator: RuleCriteriaOperator.HasNoneOf,
              value: [BILLING],
            },
          ]),
        }),
      ]),
    ).toEqual([true, false]);
  });

  test("Service labels has any of, or the name starts with - any of them", () => {
    expect(
      matchesBoth([
        rule({
          criteria: criteria(
            [
              {
                field: "serviceLabels",
                operator: RuleCriteriaOperator.HasAnyOf,
                value: [PROD_LABEL],
              },
              {
                field: "serviceNamePattern",
                operator: RuleCriteriaOperator.StartsWith,
                value: "billing",
              },
            ],
            FilterCondition.Any,
          ),
        }),
      ]),
    ).toEqual([true, true]);
  });

  test('"All services": conditions with none match every service', () => {
    expect(matchesBoth([rule({ criteria: criteria([]) })])).toEqual([
      true,
      true,
    ]);
  });

  test("a condition on an incident's field never matches a service", () => {
    expect(
      matchesBoth([
        rule({
          criteria: criteria([
            {
              field: "monitors",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [CHECKOUT],
            },
          ]),
        }),
      ]),
    ).toEqual([false, false]);
  });
});

describe("decideForServices - the decision", () => {
  test("rules that could not be read: nothing is done", () => {
    expect(decide(null).get(CHECKOUT)!.skip).toBe(
      TelemetryAiSkip.RulesUnreadable,
    );
  });

  test("each service gets its own rules' work", () => {
    const work: Map<string, TelemetryAiWork> = decide([
      rule({
        name: "Checkout asks first",
        services: [relation(Service, CHECKOUT)],
        executionMode: AutoRemediationExecutionMode.Suggest,
      }),
      rule({
        name: "Billing only looks",
        services: [relation(Service, BILLING)],
        fixes: false,
      }),
    ]);

    expect(work.get(CHECKOUT)!.fix).toBe(AiRuleFix.AskFirst);
    expect(work.get(BILLING)!.fix).toBe(AiRuleFix.DoNotFix);
    expect(work.get(BILLING)!.investigate).toBe(true);
  });

  test("a service that is gone matches only a rule with no condition", () => {
    const gone: string = "5092bbbb-0000-4000-8000-0000000000ff";

    expect(
      decide([rule({ services: [relation(Service, CHECKOUT)] })], [gone]).get(
        gone,
      )!.skip,
    ).toBe(TelemetryAiSkip.NoMatchingRule);
    expect(decide([rule()], [gone]).get(gone)!.skip).toBeNull();
  });

  test("service ids are read case-insensitively, each once", () => {
    const work: Map<string, TelemetryAiWork> = decide(
      [rule({ services: [relation(Service, CHECKOUT)] })],
      [CHECKOUT.toUpperCase(), ` ${CHECKOUT} `],
    );

    expect(Array.from(work.keys())).toEqual([CHECKOUT]);
    expect(work.get(CHECKOUT)!.skip).toBeNull();
  });

  test("Enable AI and the lane's switch come before any rule", () => {
    expect(
      TelemetryAiRules.decideForServices({
        isAiEnabled: false,
        isLaneOn: true,
        rules: [rule()],
        serviceIds: [CHECKOUT],
        services: SERVICES,
      }).get(CHECKOUT)!.skip,
    ).toBe(TelemetryAiSkip.AiOff);
    expect(
      TelemetryAiRules.decideForServices({
        isAiEnabled: true,
        isLaneOn: false,
        rules: [rule()],
        serviceIds: [CHECKOUT],
        services: SERVICES,
      }).get(CHECKOUT)!.skip,
    ).toBe(TelemetryAiSkip.LaneOff);
  });
});

describe("the lane's switch", () => {
  test("is the project's column, read strictly", () => {
    const on: Project = new Project();
    on.enableAutomaticProfileRemediation = true;
    const off: Project = new Project();
    off.enableAutomaticProfileRemediation = false;
    const unread: Project = new Project();

    expect(TelemetryAiRules.isLaneOn(on, TelemetryAiLane.Profile)).toBe(true);
    expect(TelemetryAiRules.isLaneOn(off, TelemetryAiLane.Profile)).toBe(false);
    expect(TelemetryAiRules.isLaneOn(unread, TelemetryAiLane.Profile)).toBe(
      false,
    );
    expect(TelemetryAiRules.getLanesOn(on)).toEqual([TelemetryAiLane.Profile]);
    expect(TelemetryAiRules.getLanesOn(off)).toEqual([]);
  });

  test("each lane has its own: Traces' switch is not the Profiler's", () => {
    const traces: Project = new Project();
    traces.enableAutomaticTraceRemediation = true;
    const both: Project = new Project();
    both.enableAutomaticTraceRemediation = true;
    both.enableAutomaticProfileRemediation = true;

    expect(TelemetryAiRules.isLaneOn(traces, TelemetryAiLane.Trace)).toBe(true);
    expect(TelemetryAiRules.isLaneOn(traces, TelemetryAiLane.Profile)).toBe(
      false,
    );
    expect(TelemetryAiRules.getLanesOn(traces)).toEqual([
      TelemetryAiLane.Trace,
    ]);
    expect(TelemetryAiRules.getLanesOn(both)).toEqual([
      TelemetryAiLane.Profile,
      TelemetryAiLane.Trace,
    ]);
  });

  test("the project select reads Enable AI and every lane's switch", () => {
    expect(TELEMETRY_AI_PROJECT_SELECT).toEqual({
      _id: true,
      enableAi: true,
      enableAutomaticProfileRemediation: true,
      enableAutomaticTraceRemediation: true,
      enableAutomaticMetricRemediation: true,
    });
  });
});

describe("getServiceId", () => {
  test("the insight's service, else its evidence's", () => {
    const withColumn: AIInsight = new AIInsight();
    withColumn.telemetryServiceId = new ObjectID(CHECKOUT.toUpperCase());

    const withEvidence: AIInsight = new AIInsight();
    withEvidence.evidence = {
      profile: {
        serviceId: BILLING,
      } as unknown as NonNullable<AIInsight["evidence"]>["profile"],
    };

    expect(TelemetryAiRules.getServiceId(withColumn)).toBe(CHECKOUT);
    expect(TelemetryAiRules.getServiceId(withEvidence)).toBe(BILLING);
    expect(TelemetryAiRules.getServiceId(new AIInsight())).toBe("");
  });

  test("a trace finding's service, from its evidence when the column is unset", () => {
    const traceFinding: AIInsight = new AIInsight();
    traceFinding.evidence = {
      trace: {
        serviceId: BILLING.toUpperCase(),
      } as unknown as NonNullable<AIInsight["evidence"]>["trace"],
    };

    expect(TelemetryAiRules.getServiceId(traceFinding)).toBe(BILLING);
  });

  test("a metric finding's service, from its evidence when the column is unset", () => {
    const metricFinding: AIInsight = new AIInsight();
    metricFinding.evidence = {
      metric: {
        serviceId: ` ${BILLING.toUpperCase()} `,
      } as unknown as NonNullable<AIInsight["evidence"]>["metric"],
    };

    expect(TelemetryAiRules.getServiceId(metricFinding)).toBe(BILLING);

    // The column wins over the evidence, as for every lane.
    metricFinding.telemetryServiceId = new ObjectID(CHECKOUT);
    expect(TelemetryAiRules.getServiceId(metricFinding)).toBe(CHECKOUT);
  });
});

describe("readRules and readServices", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the lane's enabled rules as root, with what they match and decide", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> = jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockResolvedValue([rule()]);

    await expect(
      TelemetryAiRules.readRules({
        projectId: PROJECT_ID,
        lane: TelemetryAiLane.Profile,
      }),
    ).resolves.toHaveLength(1);

    const call: JSONObject = findBy.mock.calls[0]![0] as unknown as JSONObject;
    expect(call["query"]).toEqual({
      projectId: PROJECT_ID,
      isEnabled: true,
      triggerEntityType: AutoRemediationTriggerEntity.Profile,
    });
    expect(call["select"]).toMatchObject({
      criteria: true,
      services: { _id: true },
      serviceLabels: { _id: true },
      serviceNamePattern: true,
      investigates: true,
      fixes: true,
      executionMode: true,
      onlyIfOpenAfterMinutes: true,
      codeRepositories: { _id: true },
      externalMcpServers: { _id: true },
      llmProviderId: true,
    });
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("a failed read is null: nothing a rule may have kept out is done", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockRejectedValue(new Error("db down"));

    await expect(
      TelemetryAiRules.readRules({
        projectId: PROJECT_ID,
        lane: TelemetryAiLane.Profile,
      }),
    ).resolves.toBeNull();
  });

  test("reads the services' names and labels, by lower-cased id", async () => {
    const findBy: SpyInstance<typeof ServiceService.findBy> = jest
      .spyOn(ServiceService, "findBy")
      .mockImplementation(async () => {
        const service: Service = new Service();
        service.id = new ObjectID(CHECKOUT);
        service.name = "checkout-api";
        service.labels = [relation(Label, PROD_LABEL)];
        return [service];
      });

    const services: Map<string, TelemetryAiRuleService> =
      await TelemetryAiRules.readServices({
        projectId: PROJECT_ID,
        serviceIds: [CHECKOUT.toUpperCase(), "", CHECKOUT],
      });

    expect(services.get(CHECKOUT)).toEqual({
      id: CHECKOUT,
      name: "checkout-api",
      labelIds: [PROD_LABEL],
    });
    expect(findBy).toHaveBeenCalledTimes(1);
    expect((findBy.mock.calls[0]![0] as unknown as JSONObject)["limit"]).toBe(
      1,
    );
  });

  test("no service ids: nothing is read", async () => {
    const findBy: SpyInstance<typeof ServiceService.findBy> = jest.spyOn(
      ServiceService,
      "findBy",
    );

    await expect(
      TelemetryAiRules.readServices({ projectId: PROJECT_ID, serviceIds: [] }),
    ).resolves.toEqual(new Map());
    expect(findBy).not.toHaveBeenCalled();
  });

  test("decideForInsight: the insight's service, the lane's rules and the project's switches", async () => {
    jest.spyOn(AutoRemediationRuleService, "findBy").mockResolvedValue([
      rule({
        services: [relation(Service, CHECKOUT)],
        executionMode: AutoRemediationExecutionMode.Suggest,
      }),
    ]);
    jest.spyOn(ServiceService, "findBy").mockResolvedValue([]);

    const insight: AIInsight = new AIInsight();
    insight.projectId = PROJECT_ID;
    insight.insightType = AIInsightType.ProfileHotspot;
    insight.telemetryServiceId = new ObjectID(CHECKOUT);

    const project: Project = new Project();
    project.enableAi = true;
    project.enableAutomaticProfileRemediation = true;

    const work: TelemetryAiWork | null =
      await TelemetryAiRules.decideForInsight({ insight, project });

    expect(work?.fix).toBe(AiRuleFix.AskFirst);
  });

  test("decideForInsight: an insight no lane works on is null", async () => {
    const insight: AIInsight = new AIInsight();
    insight.projectId = PROJECT_ID;
    insight.insightType = AIInsightType.NewException;

    await expect(
      TelemetryAiRules.decideForInsight({ insight, project: new Project() }),
    ).resolves.toBeNull();
  });
});
