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
  MetricReaderKind,
  MetricReaders,
} from "../../../../Server/Utils/Telemetry/MetricReaders";
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
    componentType: "chart",
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
          componentType: "value",
          componentId: "0192F1A0-0000-7000-8000-0000000E9421",
          arguments: {
            title: "Signups today",
            metricQueryConfig: metricQuery(LEAKED),
          },
        },
        {
          componentType: "gauge",
          componentId: ObjectID.generate().toString(),
          arguments: {
            gaugeTitle: "Error budget",
            metricQueryConfig: metricQuery("errors"),
          },
        },
        {
          componentType: "table",
          componentId: ObjectID.generate().toString(),
          arguments: {
            tableTitle: "  ",
            metricQueryConfigs: [metricQuery(LEAKED, [CHECKOUT])],
          },
        },
        // A text widget: no metric.
        {
          componentType: "text",
          componentId: ObjectID.generate().toString(),
          arguments: { text: "Hello" },
        },
        "not a widget",
      ],
      // Read outside its widgets, as a variable might.
      variables: [{ name: "v", metricName: "queue.depth" }],
    });

    expect(
      found.widgets.map((entry: { widget: Record<string, unknown> }) => {
        return entry.widget;
      }),
    ).toEqual([
      { id: chartId, title: "Signups", type: "chart" },
      {
        id: "0192f1a0-0000-7000-8000-0000000e9421",
        title: "Signups today",
        type: "value",
      },
      { id: expect.any(String), title: "Error budget", type: "gauge" },
      // A title of blanks is none: the widget is named by its kind.
      { id: expect.any(String), title: "", type: "table" },
      { id: expect.any(String), title: "", type: "text" },
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
      { metricName: "http.requests", serviceIds: null },
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
            { id: expect.any(String), title: "Signups", type: "chart" },
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
