import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Dashboard from "../../../../../Models/DatabaseModels/Dashboard";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import AnalyticsDatabaseService, {
  Results,
} from "../../../../../Server/Services/AnalyticsDatabaseService";
import DashboardService from "../../../../../Server/Services/DashboardService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../../Server/Services/MetricPipelineRuleService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import CreateBy from "../../../../../Server/Types/Database/CreateBy";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  findMetricNameReferences,
  isReferenceDropped,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/MetricNameUsers";
import {
  buildDroppedNameMatcher,
  buildServiceMetricNamesStatement,
  getDropMetricImpact,
  MAX_METRIC_NAMES_COUNTED,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryMetricDrop";
import {
  buildMetricDropFilters,
  buildMetricDropRule,
  buildScrubPatternForDataType,
  CoveringScrubRule,
  createDropRuleForFinding,
  createScrubRuleForFinding,
  DATA_SECURITY_SCRUB_RULE_NAME_PREFIX,
  getMetricDropUnavailableReason,
  isFindingScrubbed,
  METRIC_DROP_RULE_NAME,
  METRIC_DROP_UNAVAILABLE_SENTENCES,
  METRIC_NAME_NOT_SCRUBBABLE,
  toCoveringMetricRule,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { validateMetricPipelineRuleFilters } from "../../../../../Server/Utils/MetricPipelineRuleValidation";
import logger from "../../../../../Server/Utils/Logger";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityDropMetricImpact,
  DataSecurityDropMetricUnavailableReason,
} from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { isMetricNameFinding } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../../Types/JSON";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../../../Types/Metrics/MetricPipelineRuleType";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * DROP THIS METRIC (issue #9757).
 *
 * No rule can take the data out of a metric's name: a pipeline rule only
 * renames a metric whole. A Drop rule can keep the service's metrics named
 * so from being stored at all, until the code that names them is fixed.
 * Their points are lost for good, so it is never Scrub It's: a rule of its
 * own, made only when asked for after the page has said what it drops and
 * which monitors and dashboards it leaves without data - made as the person
 * who asked, audited as theirs, and undone by deleting it. The rule run
 * through the metric pipeline itself is App's
 * DataSecurityMetricDropRuleIngest test.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d9701",
);
const USER_ID: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d9702");
const CHECKOUT: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d9711");
const PAYMENTS: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d9712");

type Finding = {
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  serviceId: ObjectID;
};

function nameFinding(
  dataTypeId: string = "email-address",
  serviceId: ObjectID = CHECKOUT,
): Finding {
  return {
    kind: DataStoreKind.TelemetryMetrics,
    dataTypeId,
    location: "name",
    serviceId,
  };
}

function attributeFinding(location: string): Finding {
  return { ...nameFinding(), location };
}

function savedRule(data: Partial<MetricPipelineRule>): MetricPipelineRule {
  const saved: MetricPipelineRule = new MetricPipelineRule();
  saved._id = ObjectID.generate().toString();
  Object.assign(saved, data);
  return saved;
}

function dropRuleOf(
  dataTypeId: string = "email-address",
  serviceId: ObjectID | undefined = CHECKOUT,
): MetricPipelineRule {
  const rule: MetricPipelineRule = buildMetricDropRule({
    projectId: PROJECT_ID,
    serviceId: CHECKOUT,
    kind: DataStoreKind.TelemetryMetrics,
    dataTypeId,
    location: "name",
  });

  rule._id = ObjectID.generate().toString();
  rule.serviceId = serviceId;

  return rule;
}

function covers(rule: MetricPipelineRule, finding: Finding): boolean {
  const covering: CoveringScrubRule | null = toCoveringMetricRule(rule);

  return covering ? isFindingScrubbed({ rules: [covering] }, finding) : false;
}

let metricCreate: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(MetricPipelineRuleService, "findBy")
    .mockResolvedValue([] as never);
  metricCreate = jest
    .spyOn(MetricPipelineRuleService, "create")
    .mockImplementation((async (
      createBy: CreateBy<MetricPipelineRule>,
    ): Promise<MetricPipelineRule> => {
      createBy.data._id = "0192f1a0-0000-7000-8000-0000000d9721";
      return createBy.data;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the rule Drop This Metric makes", () => {
  test("a Drop rule for the service: every new point of a metric whose name has the type's shape, as a rule saved by hand is checked", () => {
    const rule: MetricPipelineRule = buildMetricDropRule({
      projectId: PROJECT_ID,
      serviceId: CHECKOUT,
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId: "email-address",
      location: "name",
    });

    expect(rule.projectId).toEqual(PROJECT_ID);
    expect(rule.serviceId?.toString()).toBe(CHECKOUT.toString());
    expect(rule.ruleType).toBe(MetricPipelineRuleType.Drop);
    expect(rule.filterCondition).toBe(FilterCondition.All);
    expect(rule.isEnabled).toBe(true);
    expect(rule.filters).toEqual([
      {
        checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
        conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
        value: buildScrubPatternForDataType("email-address"),
      },
    ]);
    expect(buildMetricDropFilters("email-address")).toEqual(rule.filters);
    expect(rule.name).toBe(
      `${DATA_SECURITY_SCRUB_RULE_NAME_PREFIX}${METRIC_DROP_RULE_NAME}Email address`,
    );
    expect(rule.name!.length).toBeLessThanOrEqual(100);
    // What it does, where a person reads the rule: lost for good, stored data stays, how to undo.
    expect(rule.description).toContain(
      'Made by Data Security ("Drop This Metric")',
    );
    expect(rule.description).toContain("those points are lost for good");
    expect(rule.description).toContain(
      "What is stored already stays until its retention ends.",
    );
    expect(rule.description).toContain("Delete this rule to keep them again.");
    expect(rule.description!.length).toBeLessThanOrEqual(500);
    expect(() => {
      validateMetricPipelineRuleFilters(rule.filters);
    }).not.toThrow();
  });

  test("refused, saying why: a finding that is no metric's name, a type no pattern finds, a service that is gone", () => {
    const refusal: (data: {
      dataTypeId?: string;
      location?: string;
      serviceId?: ObjectID | string | null;
      kind?: DataStoreKind;
    }) => string = (data: {
      dataTypeId?: string;
      location?: string;
      serviceId?: ObjectID | string | null;
      kind?: DataStoreKind;
    }): string => {
      try {
        buildMetricDropRule({
          projectId: PROJECT_ID,
          serviceId: data.serviceId === undefined ? CHECKOUT : data.serviceId,
          kind: data.kind || DataStoreKind.TelemetryMetrics,
          dataTypeId: data.dataTypeId || "email-address",
          location: data.location || "name",
        });
      } catch (error) {
        expect(error).toBeInstanceOf(BadDataException);
        return (error as Error).message;
      }

      return "";
    };

    expect(refusal({ location: "attributes.user.email" })).toBe(
      METRIC_DROP_UNAVAILABLE_SENTENCES[
        DataSecurityDropMetricUnavailableReason.NotAMetricName
      ],
    );
    expect(refusal({ kind: DataStoreKind.TelemetryTraces })).toBe(
      METRIC_DROP_UNAVAILABLE_SENTENCES[
        DataSecurityDropMetricUnavailableReason.NotAMetricName
      ],
    );
    // Found by a field's name alone, and one of the project's own: no pattern.
    for (const dataTypeId of ["person-name", "custom:0192f1a0"]) {
      expect(refusal({ dataTypeId })).toBe(
        METRIC_DROP_UNAVAILABLE_SENTENCES[
          DataSecurityDropMetricUnavailableReason.NoPattern
        ],
      );
    }
    for (const serviceId of [null, "", "not-a-service"]) {
      expect(refusal({ serviceId })).toBe(
        METRIC_DROP_UNAVAILABLE_SENTENCES[
          DataSecurityDropMetricUnavailableReason.NoService
        ],
      );
    }
    expect(
      getMetricDropUnavailableReason({
        kind: DataStoreKind.TelemetryMetrics,
        location: "name",
        dataTypeId: "ip-address",
        serviceId: CHECKOUT,
      }),
    ).toBeNull();
    expect(isMetricNameFinding(DataStoreKind.TelemetryMetrics, " name ")).toBe(
      true,
    );
    expect(isMetricNameFinding(DataStoreKind.TelemetryTraces, "name")).toBe(
      false,
    );
  });
});

describe("what a Drop rule covers", () => {
  test("Drop This Metric's rule covers the name finding of its service and type - the service's or the project's - and nothing else", () => {
    expect(covers(dropRuleOf(), nameFinding())).toBe(true);
    // The project's own, for every service.
    expect(covers(dropRuleOf("email-address", undefined), nameFinding())).toBe(
      true,
    );
    // Another service's metrics, another type in the name, or a label: not this rule's.
    expect(covers(dropRuleOf(), nameFinding("email-address", PAYMENTS))).toBe(
      false,
    );
    expect(covers(dropRuleOf(), nameFinding("ip-address"))).toBe(false);
    expect(
      covers(dropRuleOf(), attributeFinding("attributes.user.email")),
    ).toBe(false);

    // A Drop rule whose filter a person wrote never counts for a name.
    const own: MetricPipelineRule = dropRuleOf();

    own.filters = [
      {
        checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
        conditionType: MetricPipelineRuleFilterConditionType.Contains,
        value: "@",
      },
    ];
    expect(covers(own, nameFinding())).toBe(false);
  });

  test("a Drop rule with no filter stores none of the service's metrics: it covers every finding in them", () => {
    const everything: MetricPipelineRule = savedRule({
      ruleType: MetricPipelineRuleType.Drop,
      serviceId: CHECKOUT,
      filters: [],
    });

    expect(covers(everything, nameFinding())).toBe(true);
    expect(covers(everything, attributeFinding("attributes.user.email"))).toBe(
      true,
    );
    expect(covers(everything, nameFinding("email-address", PAYMENTS))).toBe(
      false,
    );
    // Nothing but a metric's: a log finding is not a metric's.
    expect(
      covers(everything, {
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "body",
        serviceId: CHECKOUT,
      }),
    ).toBe(false);
  });

  test("undone by deleting it: without the rule, the finding is not covered", () => {
    expect(isFindingScrubbed({ rules: [] }, nameFinding())).toBe(false);
  });
});

describe("dropping, as the person who asked", () => {
  test("made with the person's own props: the metric pipeline rules' permission is checked, and the rule is audited as theirs", async () => {
    const memberProps: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      tenantId: PROJECT_ID,
    };

    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(memberProps as never);

    const created: { ruleId: string; ruleName: string; isNew: boolean } =
      await createDropRuleForFinding({
        projectId: PROJECT_ID,
        userId: USER_ID,
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "email-address",
        location: "name",
        serviceId: CHECKOUT,
      });

    expect(created).toEqual({
      ruleId: "0192f1a0-0000-7000-8000-0000000d9721",
      ruleName: `${DATA_SECURITY_SCRUB_RULE_NAME_PREFIX}${METRIC_DROP_RULE_NAME}Email address`,
      isNew: true,
    });
    // With the person's props, never as OneUptime: their permission, their audit entry.
    expect(metricCreate.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ props: memberProps }),
    );
    expect(
      (metricCreate.mock.calls[0]![0] as CreateBy<MetricPipelineRule>).data
        .ruleType,
    ).toBe(MetricPipelineRuleType.Drop);
    // Making the rule, and deleting it to undo it, are both in the audit log.
    expect(new MetricPipelineRule().enableAuditLogOn).toEqual(
      expect.objectContaining({ create: true, update: true, delete: true }),
    );
  });

  test("a person who may not create pipeline rules is refused by the rules' own permission", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue({ userId: USER_ID, tenantId: PROJECT_ID } as never);
    metricCreate.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to create Metric Pipeline Rule.",
      ) as never,
    );

    await expect(
      createDropRuleForFinding({
        projectId: PROJECT_ID,
        userId: USER_ID,
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "email-address",
        location: "name",
        serviceId: CHECKOUT,
      }),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("metrics a rule already drops get that rule, no second one", async () => {
    jest.spyOn(MetricPipelineRuleService, "findBy").mockResolvedValue([
      savedRule({
        ...dropRuleOf(),
        _id: "0192f1a0-0000-7000-8000-0000000d9798",
        name: "Data Security: drop metrics named with Email address",
      }),
    ] as never);

    expect(
      await createDropRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "email-address",
        location: "name",
        serviceId: CHECKOUT,
      }),
    ).toEqual({
      ruleId: "0192f1a0-0000-7000-8000-0000000d9798",
      ruleName: "Data Security: drop metrics named with Email address",
      isNew: false,
    });
    expect(metricCreate).not.toHaveBeenCalled();
  });

  test("Scrub It still refuses a metric's name: dropping is an action of its own", async () => {
    await expect(
      createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "email-address",
        location: "name",
        serviceId: CHECKOUT,
      }),
    ).rejects.toThrow(METRIC_NAME_NOT_SCRUBBABLE);
    expect(metricCreate).not.toHaveBeenCalled();
  });
});

describe("which monitors and dashboards read a metric", () => {
  test("every metricName a monitor's steps or a dashboard's widgets query, with the services its query is limited to", () => {
    const steps: JSONObject = {
      _type: "MonitorSteps",
      value: {
        monitorStepsInstanceArray: [
          {
            data: {
              metricMonitor: {
                // The step's services: every query under it.
                telemetryServiceIds: [
                  {
                    _type: "ObjectID",
                    value: CHECKOUT.toString().toUpperCase(),
                  },
                ],
                metricViewConfig: {
                  queryConfigs: [
                    {
                      metricQueryData: {
                        filterData: {
                          metricName: "signups.jane@acme.io.count",
                        },
                      },
                    },
                    {
                      metricQueryData: {
                        // Its own services win over the step's.
                        filterData: {
                          metricName: "http.server.duration",
                          telemetryServiceIds: [PAYMENTS.toString()],
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    };

    expect(findMetricNameReferences(steps)).toEqual([
      {
        metricName: "signups.jane@acme.io.count",
        serviceIds: [CHECKOUT.toString().toLowerCase()],
      },
      {
        metricName: "http.server.duration",
        serviceIds: [PAYMENTS.toString().toLowerCase()],
      },
    ]);
    // A dashboard's widget of every service; nothing for what holds no query.
    expect(
      findMetricNameReferences({
        components: [
          {
            arguments: {
              metricQueryConfig: {
                metricQueryData: { filterData: { metricName: "orders" } },
              },
            },
          },
        ],
      }),
    ).toEqual([{ metricName: "orders", serviceIds: null }]);
    expect(findMetricNameReferences(null)).toEqual([]);
    expect(findMetricNameReferences("text")).toEqual([]);
    expect(findMetricNameReferences({ metricName: "" })).toEqual([]);
  });

  test("a query reads a dropped metric when the rule matches its name and the query reads the rule's service", () => {
    const isNameDropped: (metricName: string) => boolean =
      buildDroppedNameMatcher(buildMetricDropFilters("email-address")!);
    const serviceId: string = CHECKOUT.toString();

    expect(isNameDropped("signups.jane.doe@acme-corp.com.count")).toBe(true);
    expect(isNameDropped("http.server.duration")).toBe(false);
    expect(
      isReferenceDropped(
        {
          metricName: "signups.jane.doe@acme-corp.com.count",
          serviceIds: null,
        },
        { serviceId, isNameDropped },
      ),
    ).toBe(true);
    // A query limited to another service never reads the dropped points.
    expect(
      isReferenceDropped(
        {
          metricName: "signups.jane.doe@acme-corp.com.count",
          serviceIds: [PAYMENTS.toString()],
        },
        { serviceId, isNameDropped },
      ),
    ).toBe(false);
    // A pattern that cannot run drops nothing, as at ingest.
    expect(
      buildDroppedNameMatcher([
        {
          checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
          conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
          value: "(unclosed",
        },
      ])("anything"),
    ).toBe(false);
  });
});

describe("what dropping would do, before it is asked for", () => {
  const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
  let statements: Array<Statement>;

  function monitorOf(name: string, metricName: string): Monitor {
    const monitor: Monitor = new Monitor(ObjectID.generate());
    monitor.name = name;
    (monitor as unknown as { monitorSteps: unknown }).monitorSteps = {
      monitorStepsInstanceArray: [
        {
          data: {
            metricMonitor: {
              metricViewConfig: {
                queryConfigs: [
                  { metricQueryData: { filterData: { metricName } } },
                ],
              },
            },
          },
        },
      ],
    };
    return monitor;
  }

  function dashboardOf(name: string, metricName: string): Dashboard {
    const dashboard: Dashboard = new Dashboard(ObjectID.generate());
    dashboard.name = name;
    (
      dashboard as unknown as { dashboardViewConfig: unknown }
    ).dashboardViewConfig = {
      components: [
        {
          arguments: {
            metricQueryConfig: {
              metricQueryData: { filterData: { metricName } },
            },
          },
        },
      ],
    };
    return dashboard;
  }

  async function impactOf(
    finding: Finding = nameFinding(),
  ): Promise<DataSecurityDropMetricImpact> {
    return await getDropMetricImpact({
      projectId: PROJECT_ID,
      ...finding,
      props: { userId: USER_ID, tenantId: PROJECT_ID },
      now: NOW,
    });
  }

  beforeEach(() => {
    statements = [];
    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        statements.push(statement);

        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({
              data: [
                { metricName: "signups.jane.doe@acme-corp.com.count" },
                { metricName: "signups.kim.lee@acme-corp.com.count" },
                { metricName: "http.server.duration" },
              ],
            });
          },
        } as unknown as Results;
      }) as never);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        monitorOf("Signups of Jane", "signups.jane.doe@acme-corp.com.count"),
        monitorOf("Checkout latency", "http.server.duration"),
      ] as never);
    jest
      .spyOn(DashboardService, "findBy")
      .mockResolvedValue([
        dashboardOf("Growth", "signups.kim.lee@acme-corp.com.count"),
        dashboardOf("Latency", "http.server.duration"),
      ] as never);
  });

  test("how many of the service's metrics it drops - their names never sent - and the monitors and dashboards that read them", async () => {
    const impact: DataSecurityDropMetricImpact = await impactOf();

    expect(impact).toEqual({
      isAvailable: true,
      ruleName: `${DATA_SECURITY_SCRUB_RULE_NAME_PREFIX}${METRIC_DROP_RULE_NAME}Email address`,
      metricsMatched: 2,
      isMetricsMatchedCapped: false,
      monitors: [{ id: expect.any(String), name: "Signups of Jane" }],
      dashboards: [{ id: expect.any(String), name: "Growth" }],
      monitorsChecked: true,
      dashboardsChecked: true,
    });
    // No metric's name in the answer: they hold the data.
    expect(JSON.stringify(impact)).not.toContain("acme-corp.com");

    // The service's metric names of the last day, from the rollup, bounded.
    const [names] = statements;

    expect(names!.query).toContain("SELECT DISTINCT name AS metricName FROM ");
    expect(names!.query).toContain("MetricItemAggMV1m");
    expect(Object.values(names!.query_params)).toEqual(
      expect.arrayContaining([
        PROJECT_ID.toString(),
        CHECKOUT.toString(),
        MAX_METRIC_NAMES_COUNTED + 1,
      ]),
    );
    expect(names!.query).toContain("max_execution_time = 20");
  });

  test("monitors and dashboards are read with the reader's own permissions, and one they may not read is said to be unchecked", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No.") as never);
    jest.spyOn(logger, "debug").mockImplementation((): void => {});

    const impact: DataSecurityDropMetricImpact = await impactOf();

    expect(impact.monitorsChecked).toBe(false);
    expect(impact.monitors).toEqual([]);
    expect(impact.dashboardsChecked).toBe(true);
    expect(DashboardService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: PROJECT_ID },
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      }),
    );
  });

  test("a rule that already drops them is named; a finding that cannot be dropped says why and reads nothing", async () => {
    jest.spyOn(MetricPipelineRuleService, "findBy").mockResolvedValue([
      savedRule({
        ...dropRuleOf(),
        _id: "0192f1a0-0000-7000-8000-0000000d9799",
        name: "Drop emailed metrics",
      }),
    ] as never);

    expect((await impactOf()).existingRule).toEqual({
      id: "0192f1a0-0000-7000-8000-0000000d9799",
      name: "Drop emailed metrics",
    });

    statements = [];

    const refused: DataSecurityDropMetricImpact = await impactOf(
      nameFinding("person-name"),
    );

    expect(refused.isAvailable).toBe(false);
    expect(refused.unavailableReason).toBe(
      DataSecurityDropMetricUnavailableReason.NoPattern,
    );
    expect(statements).toEqual([]);
  });

  test("the count, when the names cannot be read, is none - and the rest is still said", async () => {
    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockRejectedValue(new Error("Code: 60. Table does not exist."));
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const impact: DataSecurityDropMetricImpact = await impactOf();

    expect(impact.metricsMatched).toBe(0);
    expect(impact.monitors).toHaveLength(1);
  });

  test("the names' read: one service's, of the window, every value bound", () => {
    const statement: Statement = buildServiceMetricNamesStatement({
      projectId: PROJECT_ID,
      serviceId: CHECKOUT.toString(),
      since: new Date("2026-11-18T12:00:00.000Z"),
      until: NOW,
      limit: 10,
    });

    expect(statement.query).not.toContain(CHECKOUT.toString());
    expect(statement.query).toMatch(
      /WHERE projectId = \{p\d+:String\} AND primaryEntityId = \{p\d+:String\} AND bucketTime >= \{p\d+:DateTime64\(9\)\} AND bucketTime <= \{p\d+:DateTime64\(9\)\} AND retentionDate >= now\(\) LIMIT \{p\d+:Int32\}/,
    );
  });
});
