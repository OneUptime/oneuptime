import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import MetricRecordingRule from "../../../../Models/DatabaseModels/MetricRecordingRule";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DashboardService from "../../../../Server/Services/DashboardService";
import MetricRecordingRuleService from "../../../../Server/Services/MetricRecordingRuleService";
import MonitorService from "../../../../Server/Services/MonitorService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import {
  findCloudAddedMetricReaders,
  getNamedCloudResource,
  readsCloudAddedMetric,
} from "../../../../Server/Utils/CloudConnection/CloudAddedMetricReaders";
import CloudResourceMetrics from "../../../../Server/Utils/CloudConnection/CloudResourceMetrics";
import logger from "../../../../Server/Utils/Logger";
import {
  findRecordingRuleMetricReferences,
  MetricNameReference,
} from "../../../../Server/Utils/Telemetry/MetricReaders";
import {
  CloudAddedMetricReader,
  CloudAddedMetricReaderKind,
  CloudAddedMetricReaders,
  readCloudAddedMetricReaders,
} from "../../../../Types/Cloud/CloudAddedMetricReaders";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
  getCloudAddedMetricStoredName,
  toStoredCloudAddedMetrics,
} from "../../../../Types/Cloud/CloudAddedMetrics";
import {
  AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE,
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";

/*
 * #9807: before an added metric is removed, which monitors, dashboard
 * widgets, SLOs and recording rules read it - of the resource it is removed
 * from, or of any resource of its type for a type's addition, and of the
 * service the connection stores its points under. Found by the lookup every
 * change that takes a metric away asks (Telemetry/MetricReaders), against
 * records as the services answer them.
 */

const PROJECT: ObjectID = new ObjectID("5f8b9c1e-1111-4111-8111-111111111111");
const RESOURCE: ObjectID = new ObjectID("5f8b9c1e-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "5f8b9c1e-4444-4444-8444-444444444444",
);
// The service the connection stores its metrics under, and another one.
const SERVICE: string = "5f8b9c1e-5555-4555-8555-555555555555";
const OTHER_SERVICE: string = "5f8b9c1e-6666-4666-8666-666666666666";
const ASKER: ObjectID = new ObjectID("5f8b9c1e-7777-4777-8777-777777777777");
const ACCOUNT: string = "123456789012";
const SWAP: string = "amazonaws.com/aws/rds/swapusage";
const CPU: string = "amazonaws.com/aws/rds/cpuutilization";
const RDS: string = "AWS::RDS::DBInstance";

function database(name: string): Record<string, string> {
  return {
    Namespace: "AWS/RDS",
    "Dimensions.DBInstanceIdentifier": name,
    "resource.cloud.account.id": ACCOUNT,
    "resource.cloud.region": "us-east-1",
  };
}

// The same, as an SLO's filter writes it.
function databaseFilter(name: string): string {
  return Object.entries(database(name))
    .map(([key, value]: [string, string]): string => {
      return `@${key}:${value}`;
    })
    .join(" ");
}

function identifierOf(name: string): string {
  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    { metricName: SWAP, attributes: database(name) },
  );

  return buildCloudMonitoredResourceIdentifier(resource!).toLowerCase();
}

function query(
  metricName: string,
  attributes: JSONObject,
  options: { variable?: string; serviceIds?: Array<string> } = {},
): JSONObject {
  return {
    metricAliasData: { metricVariable: options.variable || "a" },
    metricQueryData: {
      filterData: {
        metricName,
        attributes,
        aggegationType: "Avg",
        ...(options.serviceIds
          ? { telemetryServiceIds: options.serviceIds }
          : {}),
      },
      groupByAttributeKeys: [],
    },
  };
}

const ID: (n: number) => string = (n: number): string => {
  return `5f8b9c1e-9999-4999-8999-${String(n).padStart(12, "0")}`;
};

function stepsOf(queries: Array<JSONObject>): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            metricMonitor: {
              metricViewConfig: { queryConfigs: queries, formulaConfigs: [] },
            },
          },
        },
      ],
    },
  };
}

// A monitor of these queries, or of steps kept as text, as a column may come back.
function monitorOf(
  n: number,
  name: string,
  steps: Array<JSONObject> | string,
): Monitor {
  const monitor: Monitor = new Monitor(new ObjectID(ID(n)));

  monitor.name = name;
  (monitor as unknown as { monitorSteps: unknown }).monitorSteps =
    typeof steps === "string" ? steps : stepsOf(steps);

  return monitor;
}

function chart(
  id: string,
  title: string,
  queries: Array<JSONObject>,
): JSONObject {
  return {
    componentId: { _type: "ObjectID", value: id },
    componentType: "Chart",
    arguments: { chartTitle: title, metricQueryConfigs: queries },
  };
}

// A table: its columns' metrics, read with the table's own filter.
function table(
  id: string,
  title: string,
  metricNames: Array<string>,
  attributeFilters?: JSONObject,
): JSONObject {
  return {
    componentId: { _type: "ObjectID", value: id },
    componentType: "Table",
    arguments: {
      tableTitle: title,
      columns: metricNames.map((metricName: string, index: number) => {
        return {
          kind: "metric",
          metricName,
          variable: "abcd"[index],
          aggregation: "Avg",
        };
      }),
      ...(attributeFilters ? { attributeFilters } : {}),
    },
  };
}

function dashboardOf(
  n: number,
  name: string,
  components: Array<JSONObject>,
): Dashboard {
  const dashboard: Dashboard = new Dashboard(new ObjectID(ID(n)));

  dashboard.name = name;
  (
    dashboard as unknown as { dashboardViewConfig: unknown }
  ).dashboardViewConfig = { _type: "DashboardViewConfig", components };

  return dashboard;
}

function sloOf(
  n: number,
  name: string,
  data: { metricName: string; filter?: string; serviceIds: Array<string> },
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(
    new ObjectID(ID(n)),
  );

  slo.name = name;
  slo.sliType = SliType.Metric;
  slo.metricQueryConfig = {
    metricName: data.metricName,
    kind: "Histogram",
    goodAtOrUnder: 1073741824,
    ...(data.filter ? { filter: data.filter } : {}),
  };
  slo.services = data.serviceIds.map((id: string): Service => {
    return new Service(new ObjectID(id));
  });

  return slo;
}

function ruleOf(
  n: number,
  name: string,
  outputMetricName: string,
  sources: Array<JSONObject>,
): MetricRecordingRule {
  const rule: MetricRecordingRule = new MetricRecordingRule(
    new ObjectID(ID(n)),
  );

  rule.name = name;
  rule.outputMetricName = outputMetricName;
  rule.definition = { sources: sources as never, expression: "A" };

  return rule;
}

type AnyFindBy = FindBy<any>;

/*
 * A kind's records, as the server reads them (isRoot), and the ones the
 * asker may read, as their own read answers: those of `visible` among the
 * ids asked for. An Error for `all` is a read that fails.
 */
function serve<T extends { id?: ObjectID | null }>(
  service: { findBy: (findBy: AnyFindBy) => Promise<Array<T>> },
  data: {
    all: () => Array<T> | Error;
    visible?: () => Array<string> | null | Error;
  },
): void {
  jest.spyOn(service as never, "findBy" as never).mockImplementation((async (
    findBy: AnyFindBy,
  ): Promise<Array<T>> => {
    const all: Array<T> | Error = data.all();

    if (all instanceof Error) {
      throw all;
    }

    if (findBy.props.isRoot) {
      return all;
    }

    const visible: Array<string> | null | Error = data.visible
      ? data.visible()
      : null;

    if (visible instanceof Error) {
      throw visible;
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

    return all.filter((record: T): boolean => {
      const id: string = record.id!.toString().toLowerCase();

      return asked.includes(id) && (!visible || visible.includes(id));
    });
  }) as never);
}

let monitors: Array<Monitor> | Error;
let dashboards: Array<Dashboard> | Error;
let slos: Array<ServiceLevelObjective> | Error;
let rules: Array<MetricRecordingRule> | Error;
// The ids of each kind the asker may read: all when null.
let readable: Record<string, Array<string> | null | Error>;

beforeEach(() => {
  monitors = [];
  dashboards = [];
  slos = [];
  rules = [];
  readable = {};
  serve(MonitorService as never, {
    all: () => {
      return monitors;
    },
    visible: () => {
      return readable["monitor"] ?? null;
    },
  });
  serve(DashboardService as never, {
    all: () => {
      return dashboards;
    },
    visible: () => {
      return readable["dashboard"] ?? null;
    },
  });
  serve(ServiceLevelObjectiveService as never, {
    all: () => {
      return slos;
    },
    visible: () => {
      return readable["slo"] ?? null;
    },
  });
  serve(MetricRecordingRuleService as never, {
    all: () => {
      return rules;
    },
    visible: () => {
      return readable["recordingRule"] ?? null;
    },
  });
  // A read that fails is logged: kept out of the test's output.
  jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function readsOrders(
  identifiers: Array<string> = [identifierOf("orders")],
): (resource: CloudMonitoredResource) => boolean {
  const known: Set<string> = new Set<string>(identifiers);

  return (resource: CloudMonitoredResource): boolean => {
    return known.has(
      buildCloudMonitoredResourceIdentifier(resource).toLowerCase(),
    );
  };
}

async function readersOfOrders(): Promise<CloudAddedMetricReaders> {
  return await findCloudAddedMetricReaders({
    projectId: PROJECT,
    storedName: SWAP,
    serviceId: SERVICE,
    readsResource: readsOrders(),
    props: { userId: ASKER, tenantId: PROJECT },
  });
}

function namesOf(readers: CloudAddedMetricReaders): Array<string> {
  return readers.readers.map((reader: CloudAddedMetricReader): string => {
    return `${reader.kind}:${reader.name}`;
  });
}

describe("which queries read an added metric", () => {
  const reads: (
    reference: MetricNameReference,
    serviceId?: string | null,
  ) => boolean = (
    reference: MetricNameReference,
    serviceId: string | null = SERVICE,
  ): boolean => {
    return readsCloudAddedMetric(reference, {
      storedName: SWAP,
      serviceId,
      readsResource: readsOrders(),
    });
  };

  test("its stored name, whatever its case or the spaces around it, and no other", () => {
    expect(
      reads({
        metricName: " AmazonAWS.com/AWS/RDS/SwapUsage ",
        serviceIds: null,
      }),
    ).toBe(true);
    expect(reads({ metricName: CPU, serviceIds: null })).toBe(false);
    expect(reads({ metricName: `${SWAP}.total`, serviceIds: null })).toBe(
      false,
    );
  });

  test("of the connection's service, or of every service: a query of other services never reads its points", () => {
    expect(reads({ metricName: SWAP, serviceIds: [SERVICE] })).toBe(true);
    expect(
      reads({ metricName: SWAP, serviceIds: [OTHER_SERVICE, SERVICE] }),
    ).toBe(true);
    expect(reads({ metricName: SWAP, serviceIds: [OTHER_SERVICE] })).toBe(
      false,
    );
    expect(reads({ metricName: SWAP, serviceIds: null })).toBe(true);
    // A connection with no service yet: what it is read of is not known.
    expect(reads({ metricName: SWAP, serviceIds: [OTHER_SERVICE] }, null)).toBe(
      true,
    );
  });

  test("of a resource its removal stops reading it for, or of every resource; not of another resource", () => {
    expect(
      reads({
        metricName: SWAP,
        serviceIds: null,
        attributes: database("orders"),
      }),
    ).toBe(true);
    expect(
      reads({
        metricName: SWAP,
        serviceIds: null,
        attributes: database("billing"),
      }),
    ).toBe(false);
    expect(reads({ metricName: SWAP, serviceIds: null })).toBe(true);
    // An operator, or attributes no resource is known by, names no one resource.
    expect(
      reads({
        metricName: SWAP,
        serviceIds: null,
        attributes: {
          ...database("billing"),
          "Dimensions.DBInstanceIdentifier": {
            _type: "Includes",
            value: ["orders", "billing"],
          },
        },
      }),
    ).toBe(true);
    expect(
      reads({
        metricName: SWAP,
        serviceIds: null,
        attributes: { "resource.cloud.region": "us-east-1" },
      }),
    ).toBe(true);
  });

  test("the resource a query names: none for a filter of every resource, or one no resource is known by", () => {
    expect(
      getNamedCloudResource({
        metricName: SWAP,
        attributes: database("orders"),
      })?.resourceType,
    ).toBe(RDS);
    expect(getNamedCloudResource({ metricName: SWAP, attributes: {} })).toBe(
      null,
    );
    expect(
      getNamedCloudResource({ metricName: SWAP, attributes: undefined }),
    ).toBe(null);
    expect(
      getNamedCloudResource({
        metricName: SWAP,
        attributes: { ...database("orders"), Namespace: 5 },
      }),
    ).toBe(null);
  });

  test("a recording rule's source reads it of the one resource its filter names, when the filter names one", () => {
    const SITES: string = "azure.microsoft.web/sites.http406";
    const appId: (name: string) => string = (name: string): string => {
      return `/subscriptions/0b3f9c1e-0000-4000-8000-000000000001/resourceGroups/shop/providers/Microsoft.Web/sites/${name}`;
    };
    const checkout: CloudMonitoredResource = resolveCloudMonitoredResource({
      metricName: SITES,
      attributes: { [AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE]: appId("checkout") },
    })!;
    const ruleReads: (name: string) => boolean = (name: string): boolean => {
      const [reference]: Array<MetricNameReference> =
        findRecordingRuleMetricReferences({
          sources: [
            {
              alias: "A",
              metricName: SITES,
              aggregationType: "Sum",
              filterAttributeKey: AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE,
              filterAttributeValue: appId(name),
            },
          ],
          expression: "A",
        });

      return readsCloudAddedMetric(reference!, {
        storedName: SITES,
        serviceId: SERVICE,
        readsResource: (resource: CloudMonitoredResource): boolean => {
          return (
            buildCloudMonitoredResourceIdentifier(resource) ===
            buildCloudMonitoredResourceIdentifier(checkout)
          );
        },
      });
    };

    expect(ruleReads("checkout")).toBe(true);
    expect(ruleReads("billing")).toBe(false);
  });
});

describe("what reads it, as the lookup of what reads a metric finds it", () => {
  test("a monitor of this resource, or of every resource, of the connection's service; not of another resource or service, or naming it only in words", async () => {
    monitors = [
      monitorOf(1, "Orders swap", [query(SWAP, database("orders"))]),
      monitorOf(
        2,
        "Every database's swap",
        JSON.stringify(stepsOf([query(SWAP, {})])),
      ),
      monitorOf(3, "Billing swap", [query(SWAP, database("billing"))]),
      monitorOf(4, "CPU", [
        {
          ...query(CPU, database("orders")),
          metricAliasData: { metricVariable: "a", description: SWAP },
        },
      ]),
      monitorOf(5, "Orders swap of the connection's service", [
        query(SWAP, database("orders"), { serviceIds: [SERVICE] }),
      ]),
      monitorOf(6, "Swap of another service", [
        query(SWAP, {}, { serviceIds: [OTHER_SERVICE] }),
      ]),
    ];

    const readers: CloudAddedMetricReaders = await readersOfOrders();

    expect(namesOf(readers)).toEqual([
      "monitor:Every database's swap",
      "monitor:Orders swap",
      "monitor:Orders swap of the connection's service",
    ]);
    expect(readers.hidden).toBe(0);
    expect(readers.uncheckedKinds).toEqual([]);
  });

  test("a dashboard names the widgets that read it, each once; a widget of another resource is not one", async () => {
    dashboards = [
      dashboardOf(5, "Databases", [
        chart("chart-1", "Swap", [
          query(SWAP, database("orders"), { variable: "a" }),
          query(SWAP, {}, { variable: "b" }),
        ]),
        chart("chart-2", "Billing swap", [query(SWAP, database("billing"))]),
        chart("chart-3", "", [query(SWAP, database("orders"))]),
      ]),
      dashboardOf(6, "Billing", [
        chart("chart-4", "Billing swap", [query(SWAP, database("billing"))]),
      ]),
    ];

    const readers: CloudAddedMetricReaders = await readersOfOrders();

    expect(readers.readers).toEqual([
      {
        kind: CloudAddedMetricReaderKind.Dashboard,
        id: ID(5),
        name: "Databases",
        widgets: ["Swap", ""],
      },
    ]);
  });

  test("a table's columns read it with the table's own filter", async () => {
    dashboards = [
      dashboardOf(5, "Databases", [
        table("table-1", "Orders", [CPU, SWAP], database("orders")),
        table("table-2", "Billing", [SWAP], database("billing")),
        table("table-3", "Every database", [SWAP]),
        table("table-4", "CPU", [CPU]),
      ]),
    ];

    expect((await readersOfOrders()).readers).toEqual([
      {
        kind: CloudAddedMetricReaderKind.Dashboard,
        id: ID(5),
        name: "Databases",
        widgets: ["Orders", "Every database"],
      },
    ]);
  });

  test("a Metric SLO of the connection's service reads it by the filter it is written with; one of another service, or of none, does not", async () => {
    slos = [
      sloOf(6, "Orders swap budget", {
        metricName: SWAP,
        filter: databaseFilter("orders"),
        serviceIds: [SERVICE],
      }),
      sloOf(7, "Billing swap budget", {
        metricName: SWAP,
        filter: databaseFilter("billing"),
        serviceIds: [SERVICE],
      }),
      sloOf(8, "Orders swap of another service", {
        metricName: SWAP,
        filter: databaseFilter("orders"),
        serviceIds: [OTHER_SERVICE],
      }),
      // An SLO of no service measures nothing.
      sloOf(9, "Orders swap of no service", {
        metricName: SWAP,
        filter: databaseFilter("orders"),
        serviceIds: [],
      }),
      // A term that is no value keeps fewer series: the rest still name the resource.
      sloOf(10, "Orders swap while busy", {
        metricName: SWAP,
        filter: `${databaseFilter("orders")} @Role:<2`,
        serviceIds: [SERVICE],
      }),
      sloOf(11, "Every database's swap", {
        metricName: SWAP,
        serviceIds: [SERVICE],
      }),
    ];

    expect(namesOf(await readersOfOrders())).toEqual([
      "slo:Every database's swap",
      "slo:Orders swap budget",
      "slo:Orders swap while busy",
    ]);
  });

  test("a recording rule reads it of every resource, and is named with the metric it writes", async () => {
    rules = [
      ruleOf(12, "Swap rate", "swap_rate", [
        { alias: "A", metricName: SWAP, aggregationType: "Avg" },
      ]),
      ruleOf(13, "CPU rate", "cpu_rate", [
        { alias: "A", metricName: CPU, aggregationType: "Avg" },
      ]),
      // One dimension names no one database: it may read this one's.
      ruleOf(14, "Billing swap rate", "billing_swap_rate", [
        {
          alias: "A",
          metricName: SWAP,
          aggregationType: "Avg",
          filterAttributeKey: "Dimensions.DBInstanceIdentifier",
          filterAttributeValue: "billing",
        },
      ]),
    ];

    expect((await readersOfOrders()).readers).toEqual([
      {
        kind: CloudAddedMetricReaderKind.RecordingRule,
        id: ID(14),
        name: "Billing swap rate",
        widgets: [],
        outputMetricName: "billing_swap_rate",
      },
      {
        kind: CloudAddedMetricReaderKind.RecordingRule,
        id: ID(12),
        name: "Swap rate",
        widgets: [],
        outputMetricName: "swap_rate",
      },
    ]);
  });

  test("monitors first, then dashboards, SLOs and recording rules, each by name; what the asker may not open is counted, never named", async () => {
    monitors = [
      monitorOf(1, "zeta", [query(SWAP, {})]),
      monitorOf(2, "Alpha", [query(SWAP, {})]),
      monitorOf(3, "Private", [query(SWAP, {})]),
    ];
    dashboards = [
      dashboardOf(4, "Board", [chart("chart-1", "Swap", [query(SWAP, {})])]),
    ];
    slos = [sloOf(5, "Budget", { metricName: SWAP, serviceIds: [SERVICE] })];
    rules = [
      ruleOf(6, "Swap rate", "swap_rate", [
        { alias: "A", metricName: SWAP, aggregationType: "Avg" },
      ]),
    ];
    readable = {
      monitor: [ID(1), ID(2)],
      slo: new NotAuthorizedException("You do not have permission to read."),
    };

    const readers: CloudAddedMetricReaders = await readersOfOrders();

    expect(namesOf(readers)).toEqual([
      "monitor:Alpha",
      "monitor:zeta",
      "dashboard:Board",
      "recordingRule:Swap rate",
    ]);
    // The private monitor, and the SLO the asker's role may not read.
    expect(readers.hidden).toBe(2);
    expect(readers.uncheckedKinds).toEqual([]);
  });

  test("records that could not be read are said to be unchecked, not none, and the other kinds are still named", async () => {
    monitors = [monitorOf(1, "Orders swap", [query(SWAP, database("orders"))])];
    dashboards = new Error("connect ECONNREFUSED 10.0.0.5:5432");
    rules = [
      ruleOf(6, "Swap rate", "swap_rate", [
        { alias: "A", metricName: SWAP, aggregationType: "Avg" },
      ]),
    ];
    readable = { recordingRule: new Error("statement timeout") };

    const readers: CloudAddedMetricReaders = await readersOfOrders();

    expect(namesOf(readers)).toEqual(["monitor:Orders swap"]);
    expect(readers.uncheckedKinds).toEqual([
      CloudAddedMetricReaderKind.Dashboard,
      CloudAddedMetricReaderKind.RecordingRule,
    ]);
  });

  test("the answer as the page reads it: anything else is no answer, a reader without its id or of another kind is none", () => {
    expect(readCloudAddedMetricReaders(null)).toBe(null);
    expect(readCloudAddedMetricReaders({ readers: "x" })).toBe(null);
    expect(
      readCloudAddedMetricReaders({
        readers: [
          { kind: "monitor", id: ID(1), name: "A", widgets: [] },
          { kind: "dashboard", id: ID(2), name: "B", widgets: ["W", 3] },
          {
            kind: "recordingRule",
            id: ID(3),
            name: "C",
            outputMetricName: "c_rate",
          },
          { kind: "workflow", id: ID(4), name: "D" },
          { kind: "slo", name: "E" },
        ],
        hidden: 2.7,
        uncheckedKinds: ["slo", "slo", "workflow", 3],
      }),
    ).toEqual({
      readers: [
        {
          kind: CloudAddedMetricReaderKind.Monitor,
          id: ID(1),
          name: "A",
          widgets: [],
        },
        {
          kind: CloudAddedMetricReaderKind.Dashboard,
          id: ID(2),
          name: "B",
          widgets: ["W"],
        },
        {
          kind: CloudAddedMetricReaderKind.RecordingRule,
          id: ID(3),
          name: "C",
          widgets: [],
          outputMetricName: "c_rate",
        },
      ],
      hidden: 2,
      uncheckedKinds: [CloudAddedMetricReaderKind.Slo],
    });
    expect(readCloudAddedMetricReaders({ readers: [], hidden: -1 })).toEqual({
      readers: [],
      hidden: 0,
      uncheckedKinds: [],
    });
  });
});

/*
 * CloudResourceMetrics.readersOf: the addition by its key, of the
 * resource's own or its type's, which resources its removal stops reading
 * it for, and the service the connection stores its points under.
 */
describe("what reads an addition of a resource", () => {
  let resource: CloudResource;
  let connection: CloudConnection;
  let resourcesOfType: Array<CloudResource>;

  function addition(scope: CloudAddedMetricScope): CloudAddedMetric {
    const metric: CloudAddedMetric = {
      key: "",
      provider: CloudProvider.AWS,
      scope,
      resourceType: RDS,
      namespace: "AWS/RDS",
      name: "SwapUsage",
      aggregation: "Average",
      unit: "Bytes",
      addedAt: "2026-11-19T12:00:00.000Z",
      ...(scope === CloudAddedMetricScope.Resource
        ? {
            cloudResourceId: RESOURCE.toString(),
            accountId: ACCOUNT,
            region: "us-east-1",
            dimensions: [{ name: "DBInstanceIdentifier", value: "orders" }],
          }
        : {}),
    };

    return { ...metric, key: getCloudAddedMetricKey(metric) };
  }

  function row(name: string): CloudResource {
    const entry: CloudResource = new CloudResource();
    entry.id = ObjectID.generate();
    entry.resourceIdentifier = identifierOf(name);
    return entry;
  }

  beforeEach(() => {
    resource = new CloudResource();
    resource.id = RESOURCE;
    resource.projectId = PROJECT;
    resource.cloudProvider = CloudProvider.AWS;
    resource.cloudResourceType = RDS;
    resource.cloudConnectionId = CONNECTION;
    resource.resourceIdentifier = identifierOf("orders");
    resource.telemetryAttributes = database("orders");
    connection = new CloudConnection();
    connection.id = CONNECTION;
    connection.projectId = PROJECT;
    connection.provider = CloudProvider.AWS;
    connection.isEnabled = true;
    connection.serviceId = new ObjectID(SERVICE);
    resourcesOfType = [row("orders"), row("billing")];
    monitors = [
      monitorOf(1, "Orders swap", [query(SWAP, database("orders"))]),
      monitorOf(2, "Billing swap", [query(SWAP, database("billing"))]),
      // A database of the account this connection does not read.
      monitorOf(3, "Reports swap", [query(SWAP, database("reports"))]),
      monitorOf(4, "Orders swap of another service", [
        query(SWAP, database("orders"), { serviceIds: [OTHER_SERVICE] }),
      ]),
    ];

    jest
      .spyOn(CloudResourceService, "findOneBy")
      .mockImplementation((async () => {
        return resource;
      }) as never);
    jest.spyOn(CloudResourceService, "findBy").mockImplementation((async () => {
      return resourcesOfType;
    }) as never);
    jest
      .spyOn(CloudConnectionService, "findOneBy")
      .mockImplementation((async () => {
        return connection;
      }) as never);
  });

  async function namesFor(
    scope: CloudAddedMetricScope,
  ): Promise<Array<string>> {
    const added: CloudAddedMetric = addition(scope);

    connection.addedMetrics = toStoredCloudAddedMetrics([added]) as never;

    return (
      await CloudResourceMetrics.readersOf({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { userId: ASKER, tenantId: PROJECT },
        key: added.key,
      })
    ).readers.map((reader: { name: string }) => {
      return reader.name;
    });
  }

  test("a resource's own: the queries of this resource, of the connection's service", async () => {
    expect(
      getCloudAddedMetricStoredName(addition(CloudAddedMetricScope.Resource)),
    ).toBe(SWAP);
    expect(await namesFor(CloudAddedMetricScope.Resource)).toEqual([
      "Orders swap",
    ]);
  });

  test("a type's: the queries of any resource of its type the connection reads, not one it does not", async () => {
    expect(await namesFor(CloudAddedMetricScope.Type)).toEqual([
      "Billing swap",
      "Orders swap",
    ]);
  });

  test("a key that is no addition of the resource is refused", async () => {
    connection.addedMetrics = toStoredCloudAddedMetrics([
      addition(CloudAddedMetricScope.Type),
    ]) as never;

    await expect(
      CloudResourceMetrics.readersOf({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        key: "type|aws::rds::dbinstance||aws/rds|binlogdiskusage",
      }),
    ).rejects.toThrow(
      "This metric is not added to what this resource's cloud connection reads.",
    );
  });
});
