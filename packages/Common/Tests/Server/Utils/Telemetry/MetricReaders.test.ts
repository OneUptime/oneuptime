import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import MetricRecordingRule from "../../../../Models/DatabaseModels/MetricRecordingRule";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import DashboardService from "../../../../Server/Services/DashboardService";
import MetricRecordingRuleService from "../../../../Server/Services/MetricRecordingRuleService";
import MonitorService from "../../../../Server/Services/MonitorService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import logger from "../../../../Server/Utils/Logger";
import {
  DashboardMetricReferences,
  findDashboardMetricReferences,
  findMetricNameReferences,
  findMetricReaders,
  findRecordingRuleMetricReferences,
  findSloMetricReferences,
  METRIC_READER_KINDS,
  MetricNameReference,
  MetricReader,
  MetricReaderKind,
  MetricReaders,
  MetricReadersOfKind,
  MetricReaderWidget,
} from "../../../../Server/Utils/Telemetry/MetricReaders";
import {
  countMetricOutputReaders,
  getEmptyMetricOutputReaders,
  isMetricOutputReadersEmpty,
  MAX_OUTPUT_METRIC_DEPTH,
  METRIC_OUTPUT_READER_KIND_KEYS,
  MetricOutputReader,
  MetricOutputReaders,
  MetricOutputReadersOfKind,
  readMetricOutputReaders,
} from "../../../../Types/Metrics/MetricOutputReaders";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";

/*
 * WHICH SAVED RECORDS READ A METRIC (#9757, #9946).
 *
 * Before a metric stops being stored, whatever reads it is named: monitors,
 * dashboards (and the widgets on them), Metric SLOs of the service and
 * metric recording rules. Records are read as the server, so all of them
 * are counted, and named only where the person asking may read them
 * themselves - the rest are a count, never a name.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000e9401",
);
const USER_ID: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000e9402");
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000000e9411";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-0000000e9412";
const PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

const LEAKED: string = "signups.jane.doe@acme-corp.com.count";

function metricQuery(
  metricName: string,
  serviceIds?: Array<string>,
): Record<string, unknown> {
  return {
    metricQueryData: {
      filterData: {
        metricName,
        ...(serviceIds ? { telemetryServiceIds: serviceIds } : {}),
      },
    },
  };
}

function monitorOf(name: string, metricName: string, id?: string): Monitor {
  const monitor: Monitor = new Monitor(
    id ? new ObjectID(id) : ObjectID.generate(),
  );

  monitor.name = name;
  (monitor as unknown as { monitorSteps: unknown }).monitorSteps = {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          data: {
            metricMonitor: {
              metricViewConfig: { queryConfigs: [metricQuery(metricName)] },
            },
          },
        },
      ],
    },
  };

  return monitor;
}

function dashboardOf(
  name: string,
  components: Array<Record<string, unknown>>,
): Dashboard {
  const dashboard: Dashboard = new Dashboard(ObjectID.generate());

  dashboard.name = name;
  (
    dashboard as unknown as { dashboardViewConfig: unknown }
  ).dashboardViewConfig = { _type: "DashboardViewConfig", components };

  return dashboard;
}

function chartOf(
  title: string,
  metricName: string,
  componentId: string = ObjectID.generate().toString(),
): Record<string, unknown> {
  return {
    _type: "DashboardComponent",
    componentType: "Chart",
    componentId: { _type: "ObjectID", value: componentId },
    arguments: {
      chartTitle: title,
      metricQueryConfigs: [metricQuery(metricName)],
    },
  };
}

function sloOf(data: {
  name: string;
  metricName: string;
  serviceIds: Array<string>;
  sliType?: SliType;
}): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(
    ObjectID.generate(),
  );

  slo.name = data.name;
  slo.sliType = data.sliType || SliType.Metric;
  slo.metricQueryConfig = {
    metricName: data.metricName,
    kind: "Counter",
    goodFilter: "@http.response.status_code:<500",
  };
  slo.services = data.serviceIds.map((id: string): Service => {
    return new Service(new ObjectID(id));
  });

  return slo;
}

function recordingRuleOf(data: {
  name: string;
  outputMetricName: string;
  metricNames: Array<string>;
}): MetricRecordingRule {
  const rule: MetricRecordingRule = new MetricRecordingRule(
    ObjectID.generate(),
  );

  rule.name = data.name;
  rule.outputMetricName = data.outputMetricName;
  rule.definition = {
    sources: data.metricNames.map((metricName: string, index: number) => {
      return {
        alias: "ABCD"[index]!,
        metricName,
        aggregationType: "Sum",
      };
    }) as never,
    expression: "A",
  };

  return rule;
}

// What is read, by the email in a name, of the checkout service or every service.
function readsLeak(reference: MetricNameReference): boolean {
  return (
    reference.metricName.includes("@") &&
    (!reference.serviceIds || reference.serviceIds.includes(CHECKOUT))
  );
}

type AnyFindBy = FindBy<any>;

/*
 * A kind's records, as the server reads them (isRoot), and the ones the
 * person asking may read, as their own read answers: only those of `visible`
 * among the ids asked for.
 */
function serve<T extends { id?: ObjectID | null }>(
  service: { findBy: (findBy: AnyFindBy) => Promise<Array<T>> },
  data: { all: Array<T>; visible?: ((record: T) => boolean) | Error },
): ReturnType<typeof jest.spyOn> {
  return jest
    .spyOn(service as never, "findBy" as never)
    .mockImplementation((async (findBy: AnyFindBy): Promise<Array<T>> => {
      if (findBy.props.isRoot) {
        return data.all;
      }

      if (data.visible instanceof Error) {
        throw data.visible;
      }

      // QueryHelper.any: a Raw operator holding the ids as its parameter.
      const operator: {
        objectLiteralParameters?: Record<string, Array<string>>;
      } = (findBy.query as Record<string, unknown>)["_id"] as {
        objectLiteralParameters?: Record<string, Array<string>>;
      };
      const asked: Array<string> = Object.values(
        operator.objectLiteralParameters || {},
      )
        .flat()
        .map((id: string): string => {
          return id.toString().toLowerCase();
        });

      return data.all.filter((record: T): boolean => {
        return (
          asked.includes(record.id!.toString().toLowerCase()) &&
          (data.visible
            ? (data.visible as (record: T) => boolean)(record)
            : true)
        );
      });
    }) as never);
}

let monitors: Array<Monitor>;
let dashboards: Array<Dashboard>;
let slos: Array<ServiceLevelObjective>;
let rules: Array<MetricRecordingRule>;

beforeEach(() => {
  monitors = [
    monitorOf("Signups of Jane", LEAKED),
    monitorOf("Checkout latency", "http.server.duration"),
  ];
  dashboards = [
    dashboardOf("Growth", [
      chartOf("Signups", LEAKED),
      chartOf("Latency", "http.server.duration"),
    ]),
  ];
  slos = [
    sloOf({
      name: "Signup success",
      metricName: LEAKED,
      serviceIds: [CHECKOUT],
    }),
  ];
  rules = [
    recordingRuleOf({
      name: "Signup rate",
      outputMetricName: "signup_rate",
      metricNames: [LEAKED],
    }),
  ];
  serve(MonitorService, { all: monitors });
  serve(DashboardService, { all: dashboards });
  serve(ServiceLevelObjectiveService, { all: slos });
  serve(MetricRecordingRuleService, { all: rules });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function readers(): Promise<MetricReaders> {
  return await findMetricReaders({
    projectId: PROJECT_ID,
    reads: readsLeak,
    props: PROPS,
  });
}

describe("what a record reads", () => {
  test("a monitor's steps: every metricName, with the services its query or step is limited to", () => {
    expect(
      findMetricNameReferences({
        monitorStepsInstanceArray: [
          {
            data: {
              metricMonitor: {
                telemetryServiceIds: [{ _type: "ObjectID", value: CHECKOUT }],
                metricViewConfig: {
                  queryConfigs: [
                    metricQuery(LEAKED),
                    metricQuery("orders", [PAYMENTS.toUpperCase()]),
                  ],
                },
              },
            },
          },
        ],
      }),
    ).toEqual([
      { metricName: LEAKED, serviceIds: [CHECKOUT] },
      { metricName: "orders", serviceIds: [PAYMENTS] },
    ]);
    // A step stored as text, as an older row may hold it.
    expect(
      findMetricNameReferences(JSON.stringify(metricQuery("orders"))),
    ).toEqual([{ metricName: "orders", serviceIds: null }]);
    expect(findMetricNameReferences("text")).toEqual([]);
    expect(findMetricNameReferences(null)).toEqual([]);
  });

  test("a dashboard, widget by widget: each named by its title whatever its kind calls it, or by its kind when it has none", () => {
    const chartId: string = ObjectID.generate().toString();
    const found: DashboardMetricReferences = findDashboardMetricReferences({
      _type: "DashboardViewConfig",
      components: [
        chartOf("Signups", LEAKED, chartId),
        {
          componentType: "Value",
          componentId: "0192F1A0-0000-7000-8000-0000000E9421",
          arguments: {
            title: "Signups today",
            metricQueryConfig: metricQuery(LEAKED),
          },
        },
        {
          componentType: "Gauge",
          componentId: ObjectID.generate().toString(),
          arguments: {
            gaugeTitle: "Error budget",
            metricQueryConfig: metricQuery("errors"),
          },
        },
        {
          componentType: "Table",
          componentId: ObjectID.generate().toString(),
          arguments: {
            tableTitle: "  ",
            metricQueryConfigs: [metricQuery(LEAKED, [CHECKOUT])],
          },
        },
        // A text widget: no metric.
        {
          componentType: "Text",
          componentId: ObjectID.generate().toString(),
          arguments: { text: "Hello" },
        },
        "not a widget",
      ],
      // Read outside its widgets, as a variable might.
      variables: [{ name: "v", metricName: "queue.depth" }],
    });

    expect(
      found.widgets.map(
        (entry: { widget: MetricReaderWidget }): MetricReaderWidget => {
          return entry.widget;
        },
      ),
    ).toEqual([
      { id: chartId, title: "Signups", type: "Chart" },
      {
        id: "0192f1a0-0000-7000-8000-0000000e9421",
        title: "Signups today",
        type: "Value",
      },
      { id: expect.any(String), title: "Error budget", type: "Gauge" },
      // A title of blanks is none: the widget is named by its kind.
      { id: expect.any(String), title: "", type: "Table" },
      { id: expect.any(String), title: "", type: "Text" },
    ]);
    expect(found.widgets[3]!.references).toEqual([
      { metricName: LEAKED, serviceIds: [CHECKOUT] },
    ]);
    expect(found.widgets[4]!.references).toEqual([]);
    expect(found.dashboard).toEqual([
      { metricName: "queue.depth", serviceIds: null },
    ]);
    expect(findDashboardMetricReferences(null)).toEqual({
      widgets: [],
      dashboard: [],
    });
    // A title is kept to a length to know it by.
    expect(
      findDashboardMetricReferences({
        components: [chartOf("x".repeat(5000), LEAKED)],
      }).widgets[0]!.widget.title,
    ).toHaveLength(200);
  });

  test("a Metric SLO: its metric, of its own services - no other kind of SLO, and none of no service", () => {
    expect(
      findSloMetricReferences({
        sliType: SliType.Metric,
        metricQueryConfig: { metricName: LEAKED, kind: "Counter" },
        serviceIds: [CHECKOUT.toUpperCase(), "not an id"],
      }),
    ).toEqual([{ metricName: LEAKED, serviceIds: [CHECKOUT] }]);
    // A request SLO keeps no metric it reads, even with a stale metric query.
    expect(
      findSloMetricReferences({
        sliType: SliType.RequestSuccess,
        metricQueryConfig: { metricName: LEAKED },
        serviceIds: [CHECKOUT],
      }),
    ).toEqual([]);
    // No service chosen: it counts nothing (EvaluateSlos).
    expect(
      findSloMetricReferences({
        sliType: SliType.Metric,
        metricQueryConfig: { metricName: LEAKED },
        serviceIds: [],
      }),
    ).toEqual([]);
    expect(
      findSloMetricReferences({
        sliType: SliType.Metric,
        metricQueryConfig: { metricName: "  " },
        serviceIds: [CHECKOUT],
      }),
    ).toEqual([]);
    // Stored as text.
    expect(
      findSloMetricReferences({
        sliType: SliType.Metric,
        metricQueryConfig: JSON.stringify({ metricName: "orders" }),
        serviceIds: [CHECKOUT],
      }),
    ).toEqual([{ metricName: "orders", serviceIds: [CHECKOUT] }]);
  });

  test("a recording rule: each source's metric, of every service - its cron reads them of the whole project", () => {
    expect(
      findRecordingRuleMetricReferences({
        sources: [
          { alias: "A", metricName: LEAKED, aggregationType: "Sum" },
          {
            alias: "B",
            metricName: "http.requests",
            aggregationType: "Sum",
            filterAttributeKey: "service.name",
            filterAttributeValue: "checkout",
          },
        ],
        expression: "A / B",
      }),
    ).toEqual([
      { metricName: LEAKED, serviceIds: null },
      {
        metricName: "http.requests",
        serviceIds: null,
        attributes: { "service.name": "checkout" },
      },
    ]);
    expect(
      findRecordingRuleMetricReferences(
        JSON.stringify({
          sources: [{ alias: "A", metricName: "orders" }],
          expression: "A",
        }),
      ),
    ).toEqual([{ metricName: "orders", serviceIds: null }]);
    expect(findRecordingRuleMetricReferences(undefined)).toEqual([]);
    // Its expression and group-by are no metrics.
    expect(
      findRecordingRuleMetricReferences({
        sources: [],
        expression: "A",
        groupByAttribute: "metricName",
      }),
    ).toEqual([]);
  });
});

/*
 * The series a query keeps, by their attributes (#9807): a caller that
 * takes away the metric of some series only - a cloud resource's - names
 * the queries of those. Always among the series named, never fewer.
 */
describe("the attributes a query reads a metric's series by", () => {
  const ORDERS: Record<string, string> = {
    Namespace: "AWS/RDS",
    "Dimensions.DBInstanceIdentifier": "orders",
  };

  test("a metric query's own filter, values and operators as stored; none when it keeps every series", () => {
    expect(
      findMetricNameReferences({
        queryConfigs: [
          {
            metricQueryData: {
              filterData: { metricName: "swap", attributes: ORDERS },
            },
          },
          {
            metricQueryData: {
              filterData: {
                metricName: "swap",
                attributes: {
                  Namespace: "AWS/RDS",
                  "Dimensions.DBInstanceIdentifier": {
                    _type: "Includes",
                    value: ["orders", "billing"],
                  },
                },
              },
            },
          },
          {
            metricQueryData: {
              filterData: { metricName: "swap", attributes: {} },
            },
          },
          metricQuery("swap"),
        ],
      }),
    ).toEqual([
      { metricName: "swap", serviceIds: null, attributes: ORDERS },
      {
        metricName: "swap",
        serviceIds: null,
        attributes: {
          Namespace: "AWS/RDS",
          "Dimensions.DBInstanceIdentifier": {
            _type: "Includes",
            value: ["orders", "billing"],
          },
        },
      },
      { metricName: "swap", serviceIds: null },
      { metricName: "swap", serviceIds: null },
    ]);
  });

  test("a table's columns are read with the table's filter; a query of its own keeps its own", () => {
    const found: DashboardMetricReferences = findDashboardMetricReferences({
      components: [
        {
          componentType: "Table",
          componentId: ObjectID.generate().toString(),
          arguments: {
            tableTitle: "Databases",
            attributeFilters: ORDERS,
            columns: [
              { kind: "metric", metricName: "swap", variable: "a" },
              { kind: "formula", formula: "a * 2", variable: "b" },
            ],
            // A table's older queries: each with its filter, which it keeps.
            metricQueryConfigs: [
              {
                metricQueryData: {
                  filterData: { metricName: "cpu", attributes: {} },
                },
              },
            ],
          },
        },
        {
          componentType: "Table",
          componentId: ObjectID.generate().toString(),
          arguments: {
            attributeFilters: {},
            columns: [{ kind: "metric", metricName: "swap", variable: "a" }],
          },
        },
      ],
    });

    expect(
      found.widgets.map(
        (entry: {
          references: Array<MetricNameReference>;
        }): Array<MetricNameReference> => {
          return entry.references;
        },
      ),
    ).toEqual([
      [
        { metricName: "swap", serviceIds: null, attributes: ORDERS },
        { metricName: "cpu", serviceIds: null },
      ],
      [{ metricName: "swap", serviceIds: null }],
    ]);
  });

  test("a Metric SLO's `@key:value` terms; terms of another kind keep fewer series and are left out", () => {
    const slo: (filter: unknown) => Array<MetricNameReference> = (
      filter: unknown,
    ): Array<MetricNameReference> => {
      return findSloMetricReferences({
        sliType: SliType.Metric,
        metricQueryConfig: { metricName: "swap", kind: "Histogram", filter },
        serviceIds: [CHECKOUT],
      });
    };

    expect(
      slo(
        "@Namespace:AWS/RDS @Dimensions.DBInstanceIdentifier:orders -@Role:replica @Load:<5",
      ),
    ).toEqual([
      {
        metricName: "swap",
        serviceIds: [CHECKOUT],
        attributes: ORDERS,
      },
    ]);
    // A key said twice is read by its first value: the SLO keeps no more than that.
    expect(slo("@Namespace:AWS/RDS @Namespace:AWS/EC2")).toEqual([
      {
        metricName: "swap",
        serviceIds: [CHECKOUT],
        attributes: { Namespace: "AWS/RDS" },
      },
    ]);
    // None: no filter, one of no value, or one that cannot be read (that SLO measures nothing).
    for (const filter of [undefined, "", "-@Role:replica", "free text", 5]) {
      expect(slo(filter)).toEqual([
        { metricName: "swap", serviceIds: [CHECKOUT] },
      ]);
    }
  });

  test("a recording rule's source: its key and value, which its cron reads only together", () => {
    expect(
      findRecordingRuleMetricReferences({
        sources: [
          {
            alias: "A",
            metricName: "swap",
            aggregationType: "Avg",
            filterAttributeKey: "Dimensions.DBInstanceIdentifier",
            filterAttributeValue: "orders",
          },
          {
            alias: "B",
            metricName: "swap",
            aggregationType: "Avg",
            filterAttributeKey: "Dimensions.DBInstanceIdentifier",
            filterAttributeValue: "",
          },
          {
            alias: "C",
            metricName: "swap",
            aggregationType: "Avg",
            filterAttributeValue: "orders",
          },
        ],
        expression: "A + B + C",
      }),
    ).toEqual([
      {
        metricName: "swap",
        serviceIds: null,
        attributes: { "Dimensions.DBInstanceIdentifier": "orders" },
      },
      { metricName: "swap", serviceIds: null },
      { metricName: "swap", serviceIds: null },
    ]);
  });

  test("a caller's test of a query is given its attributes", async () => {
    const seen: Array<MetricNameReference> = [];

    monitors = [
      (() => {
        const monitor: Monitor = monitorOf("Orders swap", "swap");

        (monitor as unknown as { monitorSteps: unknown }).monitorSteps = {
          monitorStepsInstanceArray: [
            {
              data: {
                metricMonitor: {
                  metricViewConfig: {
                    queryConfigs: [
                      {
                        metricQueryData: {
                          filterData: {
                            metricName: "swap",
                            attributes: ORDERS,
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        };

        return monitor;
      })(),
    ];
    jest.restoreAllMocks();
    serve(MonitorService, { all: monitors });
    serve(DashboardService, { all: [] });
    serve(ServiceLevelObjectiveService, { all: [] });
    serve(MetricRecordingRuleService, { all: [] });

    const found: MetricReaders = await findMetricReaders({
      projectId: PROJECT_ID,
      reads: (reference: MetricNameReference): boolean => {
        seen.push(reference);
        return true;
      },
      props: PROPS,
    });

    expect(seen).toEqual([
      { metricName: "swap", serviceIds: null, attributes: ORDERS },
    ]);
    expect(found[MetricReaderKind.Monitor].readers).toEqual([
      { id: expect.any(String), name: "Orders swap" },
    ]);
  });
});

describe("which records read it", () => {
  test("every kind, each reader named, the ones that read something else left out", async () => {
    const found: MetricReaders = await readers();

    expect(found[MetricReaderKind.Monitor]).toEqual({
      readers: [{ id: monitors[0]!.id!.toString(), name: "Signups of Jane" }],
      hiddenCount: 0,
      isChecked: true,
    });
    expect(found[MetricReaderKind.Dashboard]).toEqual({
      readers: [
        {
          id: dashboards[0]!.id!.toString(),
          name: "Growth",
          // Only the widget that reads it.
          widgets: [
            { id: expect.any(String), title: "Signups", type: "Chart" },
          ],
        },
      ],
      hiddenCount: 0,
      isChecked: true,
    });
    expect(found[MetricReaderKind.ServiceLevelObjective]).toEqual({
      readers: [{ id: slos[0]!.id!.toString(), name: "Signup success" }],
      hiddenCount: 0,
      isChecked: true,
    });
    expect(found[MetricReaderKind.MetricRecordingRule]).toEqual({
      readers: [
        {
          id: rules[0]!.id!.toString(),
          name: "Signup rate",
          outputMetricName: "signup_rate",
        },
      ],
      hiddenCount: 0,
      isChecked: true,
    });
    expect(METRIC_READER_KINDS).toEqual(Object.keys(found));
  });

  test("records are read as the server, and which of them the person may read, with their own permissions", async () => {
    await readers();

    for (const service of [
      MonitorService,
      DashboardService,
      ServiceLevelObjectiveService,
      MetricRecordingRuleService,
    ]) {
      const calls: Array<[AnyFindBy]> = (
        service.findBy as unknown as { mock: { calls: Array<[AnyFindBy]> } }
      ).mock.calls;
      const [all, theirs] = calls;

      expect(calls).toHaveLength(2);
      expect(all![0].props).toEqual({ isRoot: true });
      expect(all![0].query).toMatchObject({ projectId: PROJECT_ID });
      // Their own read asks only for the readers, and selects nothing else.
      expect(theirs![0].props).toBe(PROPS);
      expect(theirs![0].select).toEqual({ _id: true });
      expect(theirs![0].query).toMatchObject({ projectId: PROJECT_ID });
    }

    // Only Metric SLOs that are still measured.
    const sloRead: AnyFindBy = (
      ServiceLevelObjectiveService.findBy as unknown as {
        mock: { calls: Array<[AnyFindBy]> };
      }
    ).mock.calls[0]![0];

    expect(sloRead.query).toEqual({
      projectId: PROJECT_ID,
      sliType: SliType.Metric,
      isArchived: false,
    });
    expect(sloRead.select).toMatchObject({ services: { _id: true } });
  });

  test("none reads it: nothing named, nothing hidden, and the person's own read never asked", async () => {
    const found: MetricReaders = await findMetricReaders({
      projectId: PROJECT_ID,
      reads: (): boolean => {
        return false;
      },
      props: PROPS,
    });

    for (const kind of METRIC_READER_KINDS) {
      expect(found[kind]).toEqual({
        readers: [],
        hiddenCount: 0,
        isChecked: true,
      });
    }

    expect(MonitorService.findBy).toHaveBeenCalledTimes(1);
  });

  test("many read it: each named once, by name", async () => {
    monitors.splice(
      0,
      monitors.length,
      ...["Zeta", "alpha", "Mu", "beta"].map((name: string): Monitor => {
        return monitorOf(name, LEAKED);
      }),
    );

    const found: MetricReaders = await readers();

    expect(
      found[MetricReaderKind.Monitor].readers.map(
        (reader: { name: string }): string => {
          return reader.name;
        },
      ),
    ).toEqual(["alpha", "beta", "Mu", "Zeta"]);
  });

  test("ones the person may not read are counted, never named", async () => {
    monitors.push(
      monitorOf("Secret signups", LEAKED),
      monitorOf("Secret growth", LEAKED),
    );
    jest.restoreAllMocks();
    serve(MonitorService, {
      all: monitors,
      visible: (monitor: Monitor): boolean => {
        return !monitor.name!.startsWith("Secret");
      },
    });
    serve(DashboardService, { all: dashboards });
    serve(ServiceLevelObjectiveService, {
      all: slos,
      visible: (): boolean => {
        return false;
      },
    });
    serve(MetricRecordingRuleService, { all: rules });

    const found: MetricReaders = await readers();

    expect(found[MetricReaderKind.Monitor]).toEqual({
      readers: [{ id: expect.any(String), name: "Signups of Jane" }],
      hiddenCount: 2,
      isChecked: true,
    });
    expect(found[MetricReaderKind.ServiceLevelObjective]).toEqual({
      readers: [],
      hiddenCount: 1,
      isChecked: true,
    });
    expect(JSON.stringify(found)).not.toContain("Secret");
    expect(JSON.stringify(found)).not.toContain("Signup success");
  });

  test("a role that may read none of a kind: all of them counted, never named, and said to be checked", async () => {
    for (const refusal of [
      new NotAuthorizedException("You do not have permission to read Monitor."),
      new NotAuthenticatedException("Sign in."),
      new PaymentRequiredException("Upgrade."),
    ]) {
      jest.restoreAllMocks();
      serve(MonitorService, { all: monitors, visible: refusal });
      serve(DashboardService, { all: dashboards });
      serve(ServiceLevelObjectiveService, { all: slos });
      serve(MetricRecordingRuleService, { all: rules });

      const found: MetricReaders = await readers();

      expect(found[MetricReaderKind.Monitor]).toEqual({
        readers: [],
        hiddenCount: 1,
        isChecked: true,
      });
      expect(found[MetricReaderKind.Dashboard].readers).toHaveLength(1);
    }
  });

  test("records that could not be read are said to be unchecked - not none - and the other kinds are still read", async () => {
    jest.restoreAllMocks();
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new Error("Connection terminated unexpectedly"));
    // What the person may read could not be told: not "you can't see them".
    serve(DashboardService, {
      all: dashboards,
      visible: new Error("Query read timeout"),
    });
    serve(ServiceLevelObjectiveService, { all: slos });
    serve(MetricRecordingRuleService, { all: rules });

    const found: MetricReaders = await readers();

    expect(found[MetricReaderKind.Monitor]).toEqual({
      readers: [],
      hiddenCount: 0,
      isChecked: false,
    });
    expect(found[MetricReaderKind.Dashboard]).toEqual({
      readers: [],
      hiddenCount: 0,
      isChecked: false,
    });
    expect(found[MetricReaderKind.ServiceLevelObjective].readers).toHaveLength(
      1,
    );
    expect(found[MetricReaderKind.MetricRecordingRule].readers).toHaveLength(1);
  });

  test("an SLO of another service, or of no service, does not read it; a recording rule reads it of every service", async () => {
    slos.push(
      sloOf({
        name: "Payments success",
        metricName: LEAKED,
        serviceIds: [PAYMENTS],
      }),
      sloOf({ name: "Unset", metricName: LEAKED, serviceIds: [] }),
      sloOf({
        name: "Requests",
        metricName: LEAKED,
        serviceIds: [CHECKOUT],
        sliType: SliType.RequestSuccess,
      }),
    );

    const found: MetricReaders = await readers();

    expect(
      found[MetricReaderKind.ServiceLevelObjective].readers.map(
        (reader: { name: string }): string => {
          return reader.name;
        },
      ),
    ).toEqual(["Signup success"]);
    expect(found[MetricReaderKind.MetricRecordingRule].readers).toHaveLength(1);
  });

  test("a dashboard read only outside its widgets is named with no widget", async () => {
    dashboards.push(
      (() => {
        const dashboard: Dashboard = dashboardOf("Variables", [
          chartOf("Latency", "http.server.duration"),
        ]);

        (
          dashboard as unknown as {
            dashboardViewConfig: { variables: Array<Record<string, unknown>> };
          }
        ).dashboardViewConfig.variables = [{ metricName: LEAKED }];

        return dashboard;
      })(),
    );

    const found: MetricReaders = await readers();

    expect(found[MetricReaderKind.Dashboard].readers).toEqual([
      expect.objectContaining({ name: "Growth" }),
      expect.objectContaining({ name: "Variables", widgets: [] }),
    ]);
  });
});

/*
 * #10078: a caller that tells more of what each reader reads - which cloud
 * resource a query names - asks for the references that read it. Every
 * reference of a record is then asked, not only up to the first that reads
 * it; the hidden readers' are kept apart, never with a name; and an answer
 * that did not ask for them has none, as Drop This Metric's.
 */
describe("the references that read it, when asked for", () => {
  test("each reader with its references that read it, every one of them; a hidden reader's apart, never named", async () => {
    const twoQueries: Monitor = monitorOf("Two signups", LEAKED);

    (
      twoQueries as unknown as {
        monitorSteps: {
          value: {
            monitorStepsInstanceArray: Array<{
              data: {
                metricMonitor: {
                  metricViewConfig: { queryConfigs: Array<unknown> };
                };
              };
            }>;
          };
        };
      }
    ).monitorSteps.value.monitorStepsInstanceArray[0]!.data.metricMonitor.metricViewConfig.queryConfigs.push(
      metricQuery(`${LEAKED}.retries`, [CHECKOUT]),
      metricQuery("http.server.duration"),
    );
    monitors.splice(
      0,
      monitors.length,
      twoQueries,
      monitorOf("Hidden", LEAKED),
    );
    serve(MonitorService, {
      all: monitors,
      visible: (monitor: Monitor): boolean => {
        return monitor.name !== "Hidden";
      },
    });

    const asked: Array<string> = [];
    const found: MetricReaders = await findMetricReaders({
      projectId: PROJECT_ID,
      reads: (reference: MetricNameReference): boolean => {
        asked.push(reference.metricName);
        return readsLeak(reference);
      },
      props: PROPS,
      keepsReferences: true,
    });
    const monitorsFound: MetricReadersOfKind = found[MetricReaderKind.Monitor];

    expect(monitorsFound.readers).toEqual([
      {
        id: twoQueries.id!.toString(),
        name: "Two signups",
        references: [
          { metricName: LEAKED, serviceIds: null },
          { metricName: `${LEAKED}.retries`, serviceIds: [CHECKOUT] },
        ],
      },
    ]);
    // Every reference asked: not only up to the first that reads it.
    expect(asked).toContain("http.server.duration");
    expect(monitorsFound.hiddenCount).toBe(1);
    expect(monitorsFound.hiddenReferences).toEqual([
      { metricName: LEAKED, serviceIds: null },
    ]);
    // A dashboard's references are its widgets' that read it.
    expect(found[MetricReaderKind.Dashboard].readers[0]!.references).toEqual([
      { metricName: LEAKED, serviceIds: null },
    ]);
  });

  test("not asked for, none: the answer Drop This Metric reads is as it was", async () => {
    const found: MetricReaders = await readers();

    for (const kind of METRIC_READER_KINDS) {
      expect(found[kind].hiddenReferences).toBeUndefined();

      for (const reader of found[kind].readers) {
        expect(reader.references).toBeUndefined();
      }
    }
  });
});

/*
 * #10085: WHAT READS A RECORDING RULE'S OUTPUT METRIC, DOWN THE CHAIN.
 *
 * A recording rule that reads what is taken away computes its output
 * metric without it, so whatever reads that output - a monitor, a
 * dashboard's widget, a Metric SLO, another recording rule - gets less from
 * it, one step further on. Asked to (followsOutputMetrics), the lookup
 * names them under the rule, and follows the rules among them on: each
 * record once, at the first place met (a dashboard once per widget), a
 * chain that closes on itself ending there, three output metrics down at
 * most. As everywhere, what the person may not read is counted, never
 * named - a rule they may not read is still followed, what reads its
 * output named under its count - and a kind that could not be read is
 * neither named nor counted down the chain.
 */
describe("what reads a recording rule's output metric, down the chain", () => {
  function monitorReading(
    name: string,
    metricName: string,
    serviceIds?: Array<string>,
  ): Monitor {
    const monitor: Monitor = new Monitor(ObjectID.generate());

    monitor.name = name;
    (monitor as unknown as { monitorSteps: unknown }).monitorSteps = {
      monitorStepsInstanceArray: [
        {
          data: {
            metricMonitor: {
              metricViewConfig: {
                queryConfigs: [metricQuery(metricName, serviceIds)],
              },
            },
          },
        },
      ],
    };

    return monitor;
  }

  function serveAll(visible?: {
    monitors?: ((monitor: Monitor) => boolean) | Error;
    dashboards?: ((dashboard: Dashboard) => boolean) | Error;
    slos?: ((slo: ServiceLevelObjective) => boolean) | Error;
    rules?: ((rule: MetricRecordingRule) => boolean) | Error;
  }): void {
    jest.restoreAllMocks();
    serve(MonitorService, {
      all: monitors,
      ...(visible?.monitors ? { visible: visible.monitors } : {}),
    });
    serve(DashboardService, {
      all: dashboards,
      ...(visible?.dashboards ? { visible: visible.dashboards } : {}),
    });
    serve(ServiceLevelObjectiveService, {
      all: slos,
      ...(visible?.slos ? { visible: visible.slos } : {}),
    });
    serve(MetricRecordingRuleService, {
      all: rules,
      ...(visible?.rules ? { visible: visible.rules } : {}),
    });
  }

  async function follow(): Promise<MetricReaders> {
    return await findMetricReaders({
      projectId: PROJECT_ID,
      reads: readsLeak,
      props: PROPS,
      followsOutputMetrics: true,
    });
  }

  function ruleNamed(name: string): MetricRecordingRule {
    return rules.find((rule: MetricRecordingRule): boolean => {
      return rule.name === name;
    })!;
  }

  function namesOf(ofKind: MetricOutputReadersOfKind): Array<string> {
    return ofKind.readers.map((reader: MetricOutputReader): string => {
      return reader.name;
    });
  }

  // The first recording rule the drop empties, as named.
  function firstRule(found: MetricReaders): MetricReader {
    return found[MetricReaderKind.MetricRecordingRule].readers[0]!;
  }

  test("a rule that reads it names what reads its output metric, of every kind and every service", async () => {
    const dailyWidgetId: string = ObjectID.generate().toString();

    monitors.push(
      // Of another service: the rule writes its output for the project.
      monitorReading("Signup rate alert", "signup_rate", [PAYMENTS]),
      monitorReading("Orders", "orders"),
    );
    dashboards.push(
      dashboardOf("Growth trends", [
        chartOf("Signup rate", "signup_rate", dailyWidgetId),
        chartOf("Orders", "orders"),
      ]),
    );
    slos.push(
      sloOf({
        name: "Signup rate budget",
        metricName: "signup_rate",
        serviceIds: [CHECKOUT],
      }),
    );
    rules.push(
      recordingRuleOf({
        name: "Signup rate daily",
        outputMetricName: "signup_rate_daily",
        metricNames: ["signup_rate"],
      }),
    );
    serveAll();

    const rule: MetricReader = firstRule(await follow());

    expect(rule.name).toBe("Signup rate");
    expect(rule.outputReaders).toEqual({
      monitors: {
        readers: [
          {
            id: monitors[2]!.id!.toString(),
            name: "Signup rate alert",
          },
        ],
        hidden: 0,
      },
      dashboards: {
        readers: [
          {
            id: dashboards[1]!.id!.toString(),
            name: "Growth trends",
            // Only the widget that reads it, by the id the board draws it under.
            widgets: [
              { id: dailyWidgetId, title: "Signup rate", type: "Chart" },
            ],
          },
        ],
        hidden: 0,
      },
      slos: {
        readers: [{ id: slos[1]!.id!.toString(), name: "Signup rate budget" }],
        hidden: 0,
      },
      recordingRules: {
        readers: [
          {
            id: ruleNamed("Signup rate daily").id!.toString(),
            name: "Signup rate daily",
            outputMetricName: "signup_rate_daily",
          },
        ],
        hidden: 0,
      },
    });
    // What reads something else is named nowhere.
    expect(JSON.stringify(rule.outputReaders)).not.toContain("Orders");
  });

  test("on down the chain: what reads the output of a rule that reads the output", async () => {
    rules.push(
      recordingRuleOf({
        name: "Signup rate daily",
        outputMetricName: "signup_rate_daily",
        metricNames: ["signup_rate"],
      }),
    );
    monitors.push(monitorReading("Daily signups", "signup_rate_daily"));
    serveAll();

    const daily: MetricOutputReader = firstRule(await follow()).outputReaders!
      .recordingRules.readers[0]!;

    expect(daily.name).toBe("Signup rate daily");
    expect(namesOf(daily.outputReaders!.monitors)).toEqual(["Daily signups"]);
  });

  test("each record named once, at the first place it is met", async () => {
    // A monitor that reads the metric and the rule's output: named as a reader of the metric.
    (
      monitors[0] as unknown as {
        monitorSteps: {
          value: {
            monitorStepsInstanceArray: Array<{
              data: {
                metricMonitor: {
                  metricViewConfig: { queryConfigs: Array<unknown> };
                };
              };
            }>;
          };
        };
      }
    ).monitorSteps.value.monitorStepsInstanceArray[0]!.data.metricMonitor.metricViewConfig.queryConfigs.push(
      metricQuery("signup_rate"),
    );
    // Two rules the drop empties, and one monitor that reads both their outputs.
    rules.push(
      recordingRuleOf({
        name: "Another signup rate",
        outputMetricName: "another_signup_rate",
        metricNames: [LEAKED],
      }),
    );
    monitors.push(
      (() => {
        const both: Monitor = monitorReading("Both rates", "signup_rate");

        (
          both as unknown as {
            monitorSteps: {
              monitorStepsInstanceArray: Array<{
                data: {
                  metricMonitor: {
                    metricViewConfig: { queryConfigs: Array<unknown> };
                  };
                };
              }>;
            };
          }
        ).monitorSteps.monitorStepsInstanceArray[0]!.data.metricMonitor.metricViewConfig.queryConfigs.push(
          metricQuery("another_signup_rate"),
        );

        return both;
      })(),
    );
    serveAll();

    const found: MetricReaders = await follow();
    const [another, signup] = found[MetricReaderKind.MetricRecordingRule]
      .readers as [MetricReader, MetricReader];

    expect(another.name).toBe("Another signup rate");
    expect(signup.name).toBe("Signup rate");
    // Met first under the rule first by name; not named again under the other.
    expect(namesOf(another.outputReaders!.monitors)).toEqual(["Both rates"]);
    expect(signup.outputReaders).toBeUndefined();
    // The monitor that reads the metric itself is named once, as its reader.
    expect(
      found[MetricReaderKind.Monitor].readers.map(
        (reader: MetricReader): string => {
          return reader.name;
        },
      ),
    ).toEqual(["Signups of Jane"]);
    expect(JSON.stringify(another.outputReaders)).not.toContain(
      "Signups of Jane",
    );
  });

  test("a dashboard is named once for each widget: one reads the metric, another the rule's output", async () => {
    const rateWidgetId: string = ObjectID.generate().toString();

    (
      dashboards[0] as unknown as {
        dashboardViewConfig: { components: Array<Record<string, unknown>> };
      }
    ).dashboardViewConfig.components.push(
      chartOf("Signup rate", "signup_rate", rateWidgetId),
    );
    serveAll();

    const found: MetricReaders = await follow();

    expect(
      found[MetricReaderKind.Dashboard].readers[0]!.widgets!.map(
        (widget: MetricReaderWidget): string => {
          return widget.title;
        },
      ),
    ).toEqual(["Signups"]);
    expect(firstRule(found).outputReaders!.dashboards.readers).toEqual([
      {
        id: dashboards[0]!.id!.toString(),
        name: "Growth",
        widgets: [{ id: rateWidgetId, title: "Signup rate", type: "Chart" }],
      },
    ]);
  });

  test("a chain that comes back on itself ends where it closes", async () => {
    // A rule that reads its own output, and two that read each other's.
    rules.splice(
      0,
      rules.length,
      recordingRuleOf({
        name: "Signup rate",
        outputMetricName: "signup_rate",
        metricNames: [LEAKED, "signup_rate", "signup_echo"],
      }),
      recordingRuleOf({
        name: "Signup echo",
        outputMetricName: "signup_echo",
        metricNames: ["signup_rate"],
      }),
    );
    serveAll();

    const found: MetricReaders = await follow();
    const rule: MetricReader = firstRule(found);

    expect(found[MetricReaderKind.MetricRecordingRule].readers).toHaveLength(1);
    expect(namesOf(rule.outputReaders!.recordingRules)).toEqual([
      "Signup echo",
    ]);
    // The echo's output leads back to a rule already named: nothing more.
    expect(
      rule.outputReaders!.recordingRules.readers[0]!.outputReaders,
    ).toBeUndefined();
  });

  test(`${MAX_OUTPUT_METRIC_DEPTH} output metrics down at most: past that, more readers are said, never named`, async () => {
    expect(MAX_OUTPUT_METRIC_DEPTH).toBe(3);

    // Signup rate -> step 1 -> step 2 -> step 3, whose output a monitor reads.
    rules.push(
      recordingRuleOf({
        name: "Step 1",
        outputMetricName: "step_1",
        metricNames: ["signup_rate"],
      }),
      recordingRuleOf({
        name: "Step 2",
        outputMetricName: "step_2",
        metricNames: ["step_1"],
      }),
      recordingRuleOf({
        name: "Step 3",
        outputMetricName: "step_3",
        metricNames: ["step_2"],
      }),
    );
    monitors.push(monitorReading("Far down", "step_3"));
    serveAll();

    const found: MetricReaders = await follow();
    const step1: MetricOutputReader =
      firstRule(found).outputReaders!.recordingRules.readers[0]!;
    const step2: MetricOutputReader =
      step1.outputReaders!.recordingRules.readers[0]!;
    const step3: MetricOutputReader =
      step2.outputReaders!.recordingRules.readers[0]!;

    expect([step1.name, step2.name, step3.name]).toEqual([
      "Step 1",
      "Step 2",
      "Step 3",
    ]);
    // Step 3 is named; what reads its output is past the depth followed.
    expect(step3.outputReaders).toEqual({
      ...getEmptyMetricOutputReaders(),
      isPastDepth: true,
    });
    expect(JSON.stringify(found)).not.toContain("Far down");

    // Nothing past it: nothing said.
    monitors.pop();
    serveAll();
    expect(
      (await follow())[MetricReaderKind.MetricRecordingRule].readers[0]!
        .outputReaders!.recordingRules.readers[0]!.outputReaders!.recordingRules
        .readers[0]!.outputReaders!.recordingRules.readers[0]!.outputReaders,
    ).toBeUndefined();
  });

  test("an output metric is read whatever its case, or the spaces around it", async () => {
    monitors.push(monitorReading("Shouting", "  SIGNUP_RATE "));
    serveAll();

    expect(namesOf(firstRule(await follow()).outputReaders!.monitors)).toEqual([
      "Shouting",
    ]);
  });

  test("a rule with no output metric, or one nothing reads, carries none", async () => {
    rules[0]!.outputMetricName = "";
    monitors.push(monitorReading("Reads nothing it writes", ""));
    serveAll();

    expect(firstRule(await follow()).outputReaders).toBeUndefined();
  });

  test("what the person may not read down the chain is counted, never named", async () => {
    monitors.push(
      monitorReading("Secret rate alert", "signup_rate"),
      monitorReading("Rate alert", "signup_rate"),
    );
    serveAll({
      monitors: (monitor: Monitor): boolean => {
        return !monitor.name!.startsWith("Secret");
      },
    });

    const found: MetricReaders = await follow();

    expect(firstRule(found).outputReaders!.monitors).toEqual({
      readers: [{ id: expect.any(String), name: "Rate alert" }],
      hidden: 1,
    });
    expect(JSON.stringify(found)).not.toContain("Secret");
  });

  test("a rule the person may not read is counted, and what reads its output named under the count", async () => {
    rules.push(
      recordingRuleOf({
        name: "Secret daily",
        outputMetricName: "secret_daily",
        metricNames: ["signup_rate"],
      }),
    );
    monitors.push(
      monitorReading("Daily alert", "secret_daily"),
      monitorReading("Rate alert", "signup_rate"),
    );
    // The drop's own rule hidden too: what reads its output under the count.
    serveAll({
      rules: (rule: MetricRecordingRule): boolean => {
        return rule.name !== "Secret daily";
      },
    });

    const found: MetricReaders = await follow();
    const outputs: MetricOutputReaders = firstRule(found).outputReaders!;

    expect(outputs.recordingRules.readers).toEqual([]);
    expect(outputs.recordingRules.hidden).toBe(1);
    expect(
      namesOf(outputs.recordingRules.hiddenOutputReaders!.monitors),
    ).toEqual(["Daily alert"]);
    expect(JSON.stringify(found)).not.toContain("Secret daily");
    expect(JSON.stringify(found)).not.toContain("secret_daily");

    // A rule the drop empties, hidden itself: counted, its readers under the count.
    serveAll({
      rules: (): boolean => {
        return false;
      },
    });

    const hidden: MetricReadersOfKind = (await follow())[
      MetricReaderKind.MetricRecordingRule
    ];

    expect(hidden.readers).toEqual([]);
    expect(hidden.hiddenCount).toBe(1);
    expect(namesOf(hidden.hiddenOutputReaders!.monitors)).toEqual([
      "Rate alert",
    ]);
    // The hidden rule it leads to is counted as hidden, its own readers under it.
    expect(hidden.hiddenOutputReaders!.recordingRules.hidden).toBe(1);
    expect(
      namesOf(
        hidden.hiddenOutputReaders!.recordingRules.hiddenOutputReaders!
          .monitors,
      ),
    ).toEqual(["Daily alert"]);
  });

  test("a record two rules lead to is named under the one the person can see", async () => {
    rules.push(
      recordingRuleOf({
        name: "Another signup rate",
        outputMetricName: "another_signup_rate",
        metricNames: [LEAKED],
      }),
    );
    // One monitor that reads both rules' outputs.
    monitors.push(
      (() => {
        const both: Monitor = monitorReading("Both rates", "signup_rate");

        (
          both as unknown as {
            monitorSteps: {
              monitorStepsInstanceArray: Array<{
                data: {
                  metricMonitor: {
                    metricViewConfig: { queryConfigs: Array<unknown> };
                  };
                };
              }>;
            };
          }
        ).monitorSteps.monitorStepsInstanceArray[0]!.data.metricMonitor.metricViewConfig.queryConfigs.push(
          metricQuery("another_signup_rate"),
        );

        return both;
      })(),
    );
    // "Another signup rate" comes first by name, but the person cannot see it.
    serveAll({
      rules: (rule: MetricRecordingRule): boolean => {
        return rule.name === "Signup rate";
      },
    });

    const kind: MetricReadersOfKind = (await follow())[
      MetricReaderKind.MetricRecordingRule
    ];

    expect(
      kind.readers.map((reader: MetricReader): string => {
        return reader.name;
      }),
    ).toEqual(["Signup rate"]);
    expect(namesOf(kind.readers[0]!.outputReaders!.monitors)).toEqual([
      "Both rates",
    ]);
    // Not again under the count of the one they cannot see.
    expect(kind.hiddenCount).toBe(1);
    expect(kind.hiddenOutputReaders).toBeUndefined();
  });

  test("a kind that could not be read is neither named nor counted down the chain; the rest is", async () => {
    monitors.push(monitorReading("Rate alert", "signup_rate"));
    dashboards.push(
      dashboardOf("Rates", [chartOf("Signup rate", "signup_rate")]),
    );
    slos.push(
      sloOf({
        name: "Rate budget",
        metricName: "signup_rate",
        serviceIds: [CHECKOUT],
      }),
    );
    jest.restoreAllMocks();
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new Error("Connection terminated unexpectedly"));
    serve(DashboardService, { all: dashboards });
    serve(ServiceLevelObjectiveService, {
      all: slos,
      visible: new Error("Query read timeout"),
    });
    serve(MetricRecordingRuleService, { all: rules });

    const found: MetricReaders = await follow();
    const outputs: MetricOutputReaders = firstRule(found).outputReaders!;

    expect(found[MetricReaderKind.Monitor].isChecked).toBe(false);
    expect(found[MetricReaderKind.ServiceLevelObjective].isChecked).toBe(false);
    expect(outputs.monitors).toEqual({ readers: [], hidden: 0 });
    expect(outputs.slos).toEqual({ readers: [], hidden: 0 });
    expect(namesOf(outputs.dashboards)).toEqual(["Rates"]);
  });

  test("one read of each kind as the server, and one as the person, however long the chain", async () => {
    rules.push(
      recordingRuleOf({
        name: "Step 1",
        outputMetricName: "step_1",
        metricNames: ["signup_rate"],
      }),
      recordingRuleOf({
        name: "Step 2",
        outputMetricName: "step_2",
        metricNames: ["step_1"],
      }),
    );
    monitors.push(monitorReading("Step 2 alert", "step_2"));
    serveAll();

    await follow();

    for (const service of [
      MonitorService,
      DashboardService,
      ServiceLevelObjectiveService,
      MetricRecordingRuleService,
    ]) {
      const calls: Array<[AnyFindBy]> = (
        service.findBy as unknown as { mock: { calls: Array<[AnyFindBy]> } }
      ).mock.calls;

      expect(calls).toHaveLength(2);
      expect(calls[0]![0].props).toEqual({ isRoot: true });
      expect(calls[1]![0].props).toBe(PROPS);
    }

    // The person's read of the rules asks for all of them at once.
    const rulesAsked: {
      objectLiteralParameters?: Record<string, Array<string>>;
    } = (
      MetricRecordingRuleService.findBy as unknown as {
        mock: { calls: Array<[AnyFindBy]> };
      }
    ).mock.calls[1]![0].query["_id"] as {
      objectLiteralParameters?: Record<string, Array<string>>;
    };

    expect(
      Object.values(rulesAsked.objectLiteralParameters || {}).flat(),
    ).toHaveLength(3);
  });

  test("not asked for: no rule carries what reads its output, as Drop This Metric's answer was", async () => {
    monitors.push(monitorReading("Rate alert", "signup_rate"));
    serveAll();

    const found: MetricReaders = await readers();

    expect(firstRule(found).outputReaders).toBeUndefined();
    expect(
      found[MetricReaderKind.MetricRecordingRule].hiddenOutputReaders,
    ).toBeUndefined();
  });
});

/*
 * The answer's shape, read defensively on the page
 * (Types/Metrics/MetricOutputReaders): what is no answer is none, a reader
 * without its id is no reader, a count that is no count is none, an answer
 * deeper than any server writes is cut where it goes too deep.
 */
describe("what reads an output metric, as the page reads the answer", () => {
  test("an answer that says nothing, or is none, is none", () => {
    for (const value of [
      null,
      undefined,
      "x",
      [],
      {},
      getEmptyMetricOutputReaders(),
    ]) {
      expect(readMetricOutputReaders(value)).toBeUndefined();
    }

    expect(isMetricOutputReadersEmpty(undefined)).toBe(true);
    expect(
      isMetricOutputReadersEmpty({
        ...getEmptyMetricOutputReaders(),
        isPastDepth: true,
      }),
    ).toBe(false);
  });

  test("each kind read as it is answered: a reader without its id is none, a widget's fields text, a count whole", () => {
    expect(
      readMetricOutputReaders({
        monitors: {
          readers: [{ id: "m1", name: "Rate alert" }, { name: "No id" }, 3],
          hidden: 2.6,
        },
        dashboards: {
          readers: [
            {
              id: "d1",
              name: "Rates",
              widgets: [{ id: "w1", title: "Rate", type: "Chart" }, null, 4],
            },
          ],
          hidden: -1,
        },
        slos: "none",
        recordingRules: {
          readers: [
            {
              id: "r1",
              name: "Daily",
              outputMetricName: "daily",
              outputReaders: {
                monitors: { readers: [{ id: "m2", name: "Far" }] },
              },
            },
          ],
          hidden: 1,
          hiddenOutputReaders: { isPastDepth: true },
        },
      }),
    ).toEqual({
      monitors: { readers: [{ id: "m1", name: "Rate alert" }], hidden: 2 },
      dashboards: {
        readers: [
          {
            id: "d1",
            name: "Rates",
            widgets: [{ id: "w1", title: "Rate", type: "Chart" }],
          },
        ],
        hidden: 0,
      },
      slos: { readers: [], hidden: 0 },
      recordingRules: {
        readers: [
          {
            id: "r1",
            name: "Daily",
            outputMetricName: "daily",
            outputReaders: {
              ...getEmptyMetricOutputReaders(),
              monitors: { readers: [{ id: "m2", name: "Far" }], hidden: 0 },
            },
          },
        ],
        hidden: 1,
        hiddenOutputReaders: {
          ...getEmptyMetricOutputReaders(),
          isPastDepth: true,
        },
      },
    });
  });

  test("an answer deeper than any server writes is cut where it goes too deep", () => {
    let answer: Record<string, unknown> = {
      monitors: { readers: [{ id: "bottom", name: "Bottom" }] },
    };

    for (let step: number = 0; step < 40; step++) {
      answer = {
        recordingRules: {
          readers: [
            { id: `r${step}`, name: `Rule ${step}`, outputReaders: answer },
          ],
        },
      };
    }

    const read: MetricOutputReaders = readMetricOutputReaders(answer)!;

    expect(JSON.stringify(read)).not.toContain("Bottom");
    expect(countMetricOutputReaders(read)).toBeLessThanOrEqual(
      MAX_OUTPUT_METRIC_DEPTH + 5,
    );
  });

  test("counted at every step of the chain", () => {
    expect(
      countMetricOutputReaders({
        ...getEmptyMetricOutputReaders(),
        monitors: { readers: [{ id: "m1", name: "A" }], hidden: 2 },
        recordingRules: {
          readers: [
            {
              id: "r1",
              name: "R",
              outputReaders: {
                ...getEmptyMetricOutputReaders(),
                slos: { readers: [], hidden: 1 },
              },
            },
          ],
          hidden: 1,
          hiddenOutputReaders: {
            ...getEmptyMetricOutputReaders(),
            dashboards: { readers: [{ id: "d1", name: "D" }], hidden: 0 },
          },
        },
      }),
    ).toBe(7);
    expect(METRIC_OUTPUT_READER_KIND_KEYS).toEqual([
      "monitors",
      "dashboards",
      "slos",
      "recordingRules",
    ]);
  });
});
