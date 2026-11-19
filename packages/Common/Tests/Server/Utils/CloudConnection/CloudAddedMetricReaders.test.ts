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
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DashboardService from "../../../../Server/Services/DashboardService";
import MonitorService from "../../../../Server/Services/MonitorService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import {
  findCloudAddedMetricReaders,
  getNamedCloudResource,
} from "../../../../Server/Utils/CloudConnection/CloudAddedMetricReaders";
import CloudResourceMetrics from "../../../../Server/Utils/CloudConnection/CloudResourceMetrics";
import { getContainsPattern } from "../../../../Server/Utils/CloudConnection/CloudSavedMetricQueries";
import {
  CLOUD_ADDED_METRIC_READERS_MAX_ROWS,
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
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * #9807: before an added metric is removed, which Metrics monitors,
 * dashboard widgets and SLOs read it - of the resource it is removed from,
 * or of any resource of its type for a type's addition - found the way the
 * deprecated metrics' reads find theirs (CloudSavedMetricQueries, a LIKE
 * on the stored JSON, then the queries themselves), against stored rows as
 * Postgres answers them.
 */

const PROJECT: ObjectID = new ObjectID("5f8b9c1e-1111-4111-8111-111111111111");
const RESOURCE: ObjectID = new ObjectID("5f8b9c1e-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "5f8b9c1e-4444-4444-8444-444444444444",
);
const ACCOUNT: string = "123456789012";
const SWAP: string = "amazonaws.com/aws/rds/swapusage";
const RDS: string = "AWS::RDS::DBInstance";

function database(name: string): Record<string, string> {
  return {
    Namespace: "AWS/RDS",
    "Dimensions.DBInstanceIdentifier": name,
    "resource.cloud.account.id": ACCOUNT,
    "resource.cloud.region": "us-east-1",
  };
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
  variable: string = "a",
): JSONObject {
  return {
    metricAliasData: { metricVariable: variable },
    metricQueryData: {
      filterData: { metricName, attributes, aggegationType: "Avg" },
      groupByAttributeKeys: [],
    },
  };
}

function monitorSteps(queries: Array<JSONObject>): JSONObject {
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

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

let statements: Array<Statement>;
let monitorRows: Array<Record<string, unknown>>;
let dashboardRows: Array<Record<string, unknown>>;
let sloRows: Array<Record<string, unknown>>;
// The ids of each kind the asker may read: all when null.
let readable: Record<string, Array<string> | null | "refused">;

function stub(
  service: { getRepository: () => unknown },
  rows: () => Array<unknown>,
): void {
  jest.spyOn(service, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, parameters: Array<unknown>) => {
        statements.push({ sql, parameters });
        return rows();
      },
    },
  } as never);
}

function stubReadable(
  service: { findBy: (data: never) => Promise<unknown> },
  kind: string,
  rows: () => Array<Record<string, unknown>>,
): void {
  jest.spyOn(service, "findBy").mockImplementation((async () => {
    const allowed: Array<string> | null | "refused" = readable[kind] ?? null;

    if (allowed === "refused") {
      throw new BadDataException("You do not have permission to read this.");
    }

    return rows()
      .filter((row: Record<string, unknown>): boolean => {
        return allowed === null || allowed.includes(String(row["_id"]));
      })
      .map((row: Record<string, unknown>) => {
        return { id: new ObjectID(String(row["_id"])) };
      });
  }) as never);
}

const ID: (n: number) => string = (n: number): string => {
  return `5f8b9c1e-9999-4999-8999-${String(n).padStart(12, "0")}`;
};

beforeEach(() => {
  statements = [];
  monitorRows = [];
  dashboardRows = [];
  sloRows = [];
  readable = {};
  stub(MonitorService as never, () => {
    return monitorRows;
  });
  stub(DashboardService as never, () => {
    return dashboardRows;
  });
  stub(ServiceLevelObjectiveService as never, () => {
    return sloRows;
  });
  stubReadable(MonitorService as never, "monitor", () => {
    return monitorRows;
  });
  stubReadable(DashboardService as never, "dashboard", () => {
    return dashboardRows;
  });
  stubReadable(ServiceLevelObjectiveService as never, "slo", () => {
    return sloRows;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function readersOfOrders(
  identifiers: Array<string> = [identifierOf("orders")],
): Promise<CloudAddedMetricReaders> {
  const known: Set<string> = new Set<string>(identifiers);

  return await findCloudAddedMetricReaders({
    projectId: PROJECT,
    storedName: SWAP,
    readsResource: (resource: CloudMonitoredResource): boolean => {
      return known.has(
        buildCloudMonitoredResourceIdentifier(resource).toLowerCase(),
      );
    },
    props: { userId: new ObjectID("5f8b9c1e-7777-4777-8777-777777777777") },
  });
}

describe("the rows that may read an added metric", () => {
  test("its Metrics monitors', its dashboards' and its SLOs' not deleted or archived whose JSON names it", async () => {
    await readersOfOrders();

    const pattern: string = getContainsPattern(SWAP);

    expect(statements).toHaveLength(3);
    expect(statements[0]!.sql).toContain('FROM "Monitor"');
    expect(statements[0]!.sql).toContain('"monitorType" = $2');
    expect(statements[0]!.sql).toContain('"monitorSteps"::text ILIKE $3');
    expect(statements[0]!.parameters).toEqual([
      PROJECT.toString(),
      MonitorType.Metrics,
      pattern,
      CLOUD_ADDED_METRIC_READERS_MAX_ROWS,
    ]);
    expect(statements[1]!.sql).toContain('FROM "Dashboard"');
    expect(statements[1]!.sql).toContain('"deletedAt" IS NULL');
    expect(statements[1]!.parameters).toEqual([
      PROJECT.toString(),
      pattern,
      CLOUD_ADDED_METRIC_READERS_MAX_ROWS,
    ]);
    expect(statements[2]!.sql).toContain('FROM "ServiceLevelObjective"');
    expect(statements[2]!.sql).toContain('"isArchived" IS NOT TRUE');
    expect(statements[2]!.sql).toContain('"metricQueryConfig"::text ILIKE $2');
    expect(statements[2]!.parameters).toEqual([
      PROJECT.toString(),
      pattern,
      CLOUD_ADDED_METRIC_READERS_MAX_ROWS,
    ]);
  });

  test("a name's own LIKE characters are themselves: Azure's underscores match no other metric", () => {
    expect(getContainsPattern("azure_averagememoryworkingset_average")).toBe(
      "%azure\\_averagememoryworkingset\\_average%",
    );
    expect(getContainsPattern("a%b\\c")).toBe("%a\\%b\\\\c%");
  });
});

describe("which of them read it", () => {
  test("a monitor of this resource, or of every resource, reads it; one of another resource, or naming it only in words, does not", async () => {
    monitorRows = [
      {
        _id: ID(1),
        name: "Orders swap",
        monitorSteps: monitorSteps([query(SWAP, database("orders"))]),
      },
      {
        _id: ID(2),
        name: "Every database's swap",
        // As Postgres may answer a column: as text.
        monitorSteps: JSON.stringify(monitorSteps([query(SWAP, {})])),
      },
      {
        _id: ID(3),
        name: "Billing swap",
        monitorSteps: monitorSteps([query(SWAP, database("billing"))]),
      },
      {
        _id: ID(4),
        name: "CPU",
        monitorSteps: monitorSteps([
          {
            ...query(
              "amazonaws.com/aws/rds/cpuutilization",
              database("orders"),
            ),
            metricAliasData: { metricVariable: "a", description: SWAP },
          },
        ]),
      },
    ];

    const readers: CloudAddedMetricReaders = await readersOfOrders();

    expect(
      readers.readers.map((reader: { name: string }) => {
        return reader.name;
      }),
    ).toEqual(["Every database's swap", "Orders swap"]);
    expect(readers.hidden).toBe(0);
    expect(readers.isCapped).toBe(false);
  });

  test("a filter that names no one resource - an operator, attributes no resource is known by - is counted as reading it", async () => {
    monitorRows = [
      {
        _id: ID(1),
        name: "Some databases",
        monitorSteps: monitorSteps([
          query(SWAP, {
            "Dimensions.DBInstanceIdentifier": {
              _type: "Includes",
              value: ["orders", "billing"],
            },
          }),
        ]),
      },
      {
        _id: ID(2),
        name: "East",
        monitorSteps: monitorSteps([
          query(SWAP, { "resource.cloud.region": "us-east-1" }),
        ]),
      },
    ];

    const readers: CloudAddedMetricReaders = await readersOfOrders();

    expect(readers.readers).toHaveLength(2);
  });

  test("a dashboard names the widgets that read it, each once; a widget of another resource is not one", async () => {
    dashboardRows = [
      {
        _id: ID(5),
        name: "Databases",
        dashboardViewConfig: {
          components: [
            chart("chart-1", "Swap", [
              query(SWAP, database("orders"), "a"),
              query(SWAP, {}, "b"),
            ]),
            chart("chart-2", "Billing swap", [
              query(SWAP, database("billing")),
            ]),
            chart("chart-3", "", [query(SWAP, database("orders"))]),
          ],
        },
      },
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

  test("an SLO of the metric reads it, by the filter it is written with", async () => {
    sloRows = [
      {
        _id: ID(6),
        name: "Orders swap budget",
        metricQueryConfig: {
          metricName: SWAP,
          filter:
            "@Namespace:AWS/RDS @Dimensions.DBInstanceIdentifier:orders @resource.cloud.account.id:123456789012 @resource.cloud.region:us-east-1",
        },
      },
      {
        _id: ID(7),
        name: "Billing swap budget",
        metricQueryConfig: {
          metricName: SWAP,
          filter:
            "@Namespace:AWS/RDS @Dimensions.DBInstanceIdentifier:billing @resource.cloud.account.id:123456789012 @resource.cloud.region:us-east-1",
        },
      },
    ];

    const readers: CloudAddedMetricReaders = await readersOfOrders();

    expect(
      readers.readers.map((reader: { kind: string; name: string }) => {
        return `${reader.kind}:${reader.name}`;
      }),
    ).toEqual(["slo:Orders swap budget"]);
  });

  test("monitors first, then dashboards, then SLOs, each by name; what the asker may not open is counted, never named", async () => {
    monitorRows = [
      {
        _id: ID(1),
        name: "zeta",
        monitorSteps: monitorSteps([query(SWAP, {})]),
      },
      {
        _id: ID(2),
        name: "Alpha",
        monitorSteps: monitorSteps([query(SWAP, {})]),
      },
      {
        _id: ID(3),
        name: "Private",
        monitorSteps: monitorSteps([query(SWAP, {})]),
      },
    ];
    dashboardRows = [
      {
        _id: ID(4),
        name: "Board",
        dashboardViewConfig: {
          components: [chart("chart-1", "Swap", [query(SWAP, {})])],
        },
      },
    ];
    sloRows = [
      {
        _id: ID(5),
        name: "Budget",
        metricQueryConfig: { metricName: SWAP },
      },
    ];
    readable = { monitor: [ID(1), ID(2)], slo: "refused" };

    const readers: CloudAddedMetricReaders = await readersOfOrders();

    expect(
      readers.readers.map((reader: { kind: string; name: string }) => {
        return `${reader.kind}:${reader.name}`;
      }),
    ).toEqual(["monitor:Alpha", "monitor:zeta", "dashboard:Board"]);
    // The private monitor, and the SLO the asker's role may not read.
    expect(readers.hidden).toBe(2);
  });

  test("a kind that filled the rows read may have more", async () => {
    monitorRows = Array.from(
      { length: CLOUD_ADDED_METRIC_READERS_MAX_ROWS },
      (_item: unknown, index: number): Record<string, unknown> => {
        return {
          _id: ID(index + 1),
          name: `Monitor ${index}`,
          monitorSteps: monitorSteps([query(SWAP, {})]),
        };
      },
    );

    expect((await readersOfOrders()).isCapped).toBe(true);
  });

  test("the answer as the page reads it: anything else is no answer, a reader without its id is none", () => {
    expect(readCloudAddedMetricReaders(null)).toBe(null);
    expect(readCloudAddedMetricReaders({ readers: "x" })).toBe(null);
    expect(
      readCloudAddedMetricReaders({
        readers: [
          { kind: "monitor", id: ID(1), name: "A", widgets: [] },
          { kind: "dashboard", id: ID(2), name: "B", widgets: ["W", 3] },
          { kind: "workflow", id: ID(3), name: "C" },
          { kind: "slo", name: "D" },
        ],
        hidden: 2.7,
        isCapped: true,
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
      ],
      hidden: 2,
      isCapped: true,
    });
  });

  test("the resource a query names: none for a filter of every resource or one no resource is known by", () => {
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
});

/*
 * CloudResourceMetrics.readersOf: the addition by its key, of the
 * resource's own or its type's, and which resources its removal stops
 * reading it for.
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
    resourcesOfType = [row("orders"), row("billing")];
    monitorRows = [
      {
        _id: ID(1),
        name: "Orders swap",
        monitorSteps: monitorSteps([query(SWAP, database("orders"))]),
      },
      {
        _id: ID(2),
        name: "Billing swap",
        monitorSteps: monitorSteps([query(SWAP, database("billing"))]),
      },
      {
        _id: ID(3),
        name: "Reports swap",
        monitorSteps: monitorSteps([query(SWAP, database("reports"))]),
      },
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
        props: { isRoot: true },
        key: added.key,
      })
    ).readers.map((reader: { name: string }) => {
      return reader.name;
    });
  }

  test("a resource's own: the queries of this resource", async () => {
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
