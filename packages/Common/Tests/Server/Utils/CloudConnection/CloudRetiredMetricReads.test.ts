import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DashboardService from "../../../../Server/Services/DashboardService";
import MonitorService from "../../../../Server/Services/MonitorService";
import CloudRetiredMetricReads, {
  CLOUD_RETIRED_READS_MEMO_MS,
  CLOUD_RETIRED_READ_SOURCES_MAX,
  NAMES_RETIRED_COSMOS_METRIC,
  NAMES_RETIRED_PUBSUB_METRIC,
  findRetiredCloudMetricQueriesOfProject,
} from "../../../../Server/Utils/CloudConnection/CloudRetiredMetricReads";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
} from "../../../../Types/Cloud/CloudAddedMetrics";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import {
  PUBSUB_MESSAGES_PUBLISHED_METRIC,
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetric,
  RetiredCloudMetricQuery,
} from "../../../../Utils/Metrics/RetiredCloudMetricMoves";

/*
 * Which deprecated metrics a project's connections still read, and of what
 * (#9739's gap): found from its Metrics monitors and its dashboards whose
 * stored queries still name one, as an added metric each, kept for ten
 * minutes, and only for Azure's and Google Cloud's connections.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const COSMOS_ID: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.DocumentDB/databaseAccounts/orders-db";
const TOPIC: JSONObject = {
  "resource.gcp.resource_type": "pubsub_topic",
  "resource.project_id": "shop-prod",
  "resource.topic_id": "orders",
};

function query(metricName: string, attributes: JSONObject): JSONObject {
  return {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: {
      filterData: { metricName, attributes, aggegationType: "Avg" },
      groupByAttributeKeys: [],
    },
  };
}

// Monitor steps as Postgres holds them.
function monitorSteps(queries: Array<JSONObject>): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: "step-1",
            metricMonitor: {
              metricViewConfig: { queryConfigs: queries, formulaConfigs: [] },
            },
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: { monitorCriteriaInstanceArray: [] },
            },
          },
        },
      ],
    },
  };
}

function dashboard(queries: Array<JSONObject>): JSONObject {
  return {
    _type: "DashboardViewConfig",
    components: [
      {
        _type: "DashboardComponent",
        componentType: "Chart",
        arguments: { metricQueryConfigs: queries },
      },
    ],
  };
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

let statements: Array<Statement>;
let monitorRows: Array<{ monitorSteps: unknown }>;
let dashboardRows: Array<{ dashboardViewConfig: unknown }>;

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

beforeEach(() => {
  statements = [];
  monitorRows = [];
  dashboardRows = [];
  CloudRetiredMetricReads.forget();
  stub(MonitorService as never, () => {
    return monitorRows;
  });
  stub(DashboardService as never, () => {
    return dashboardRows;
  });
});

afterEach(() => {
  CloudRetiredMetricReads.findQueries = findRetiredCloudMetricQueriesOfProject;
  CloudRetiredMetricReads.forget();
  jest.restoreAllMocks();
});

describe("a project's queries of a deprecated metric", () => {
  test("are its Metrics monitors' and its dashboards' that are not deleted and whose JSON names one", async () => {
    await findRetiredCloudMetricQueriesOfProject({ projectId: PROJECT });

    expect(statements).toHaveLength(2);
    expect(statements[0]!.sql).toContain('FROM "Monitor"');
    expect(statements[0]!.sql).toContain('"deletedAt" IS NULL');
    expect(statements[0]!.sql).toContain('"monitorType" = $2');
    expect(statements[0]!.sql).toContain('"monitorSteps"::text ILIKE $3');
    expect(statements[0]!.parameters).toEqual([
      PROJECT.toString(),
      MonitorType.Metrics,
      NAMES_RETIRED_PUBSUB_METRIC,
      NAMES_RETIRED_COSMOS_METRIC,
      CLOUD_RETIRED_READ_SOURCES_MAX,
    ]);
    expect(statements[1]!.sql).toContain('FROM "Dashboard"');
    expect(statements[1]!.sql).toContain('"deletedAt" IS NULL');
    expect(statements[1]!.parameters).toEqual([
      PROJECT.toString(),
      NAMES_RETIRED_PUBSUB_METRIC,
      NAMES_RETIRED_COSMOS_METRIC,
      CLOUD_RETIRED_READ_SOURCES_MAX,
    ]);
  });

  test("a moved query's replacement is never one: the Cosmos DB pattern ends at the deprecated name", () => {
    // LIKE's "\\_" is an underscore itself: ServerSideLatencyDirect's name does not match.
    expect(NAMES_RETIRED_COSMOS_METRIC).toBe("%serversidelatency\\_%");
    expect(NAMES_RETIRED_PUBSUB_METRIC).toBe("%send_message_operation_count%");
  });

  test("are read from each row's steps and widgets, as jsonb or as text, and a row that names one in passing reads none", async () => {
    monitorRows = [
      {
        monitorSteps: monitorSteps([
          query("azure_serversidelatency_average", {
            "azuremonitor.resource_id": COSMOS_ID,
          }),
          query("azure_serversidelatencydirect_average", {}),
        ]),
      },
      {
        monitorSteps: JSON.stringify(
          monitorSteps([query(PUBSUB_PUBLISH_OPERATIONS_METRIC, TOPIC)]),
        ),
      },
      // Moved already: its description names the old metric, its query does not.
      {
        monitorSteps: monitorSteps([
          {
            ...query(PUBSUB_MESSAGES_PUBLISHED_METRIC, TOPIC),
            metricAliasData: {
              metricVariable: "a",
              description: `was ${PUBSUB_PUBLISH_OPERATIONS_METRIC}`,
            },
          },
        ]),
      },
      { monitorSteps: "not json" },
    ];
    dashboardRows = [
      {
        dashboardViewConfig: dashboard([
          query(PUBSUB_PUBLISH_OPERATIONS_METRIC, {}),
        ]),
      },
    ];

    const queries: Array<RetiredCloudMetricQuery> =
      await findRetiredCloudMetricQueriesOfProject({ projectId: PROJECT });

    expect(
      queries.map((found: RetiredCloudMetricQuery) => {
        return [found.metric, found.metricName, found.attributes];
      }),
    ).toEqual([
      [
        RetiredCloudMetric.CosmosServerSideLatency,
        "azure_serversidelatency_average",
        { "azuremonitor.resource_id": COSMOS_ID },
      ],
      [
        RetiredCloudMetric.PubSubPublishOperations,
        PUBSUB_PUBLISH_OPERATIONS_METRIC,
        TOPIC,
      ],
      [
        RetiredCloudMetric.PubSubPublishOperations,
        PUBSUB_PUBLISH_OPERATIONS_METRIC,
        {},
      ],
    ]);
  });
});

describe("what a connection keeps reading for them", () => {
  test("an Azure connection, the Azure reads; a Google Cloud one, Google Cloud's", async () => {
    monitorRows = [
      {
        monitorSteps: monitorSteps([
          query("azure_serversidelatency_average", {
            "azuremonitor.resource_id": COSMOS_ID,
          }),
          query(PUBSUB_PUBLISH_OPERATIONS_METRIC, TOPIC),
        ]),
      },
    ];

    const azure: Array<CloudAddedMetric> = await CloudRetiredMetricReads.find({
      projectId: PROJECT,
      provider: CloudProvider.Azure,
      now: NOW,
    });
    const gcp: Array<CloudAddedMetric> = await CloudRetiredMetricReads.find({
      projectId: PROJECT,
      provider: CloudProvider.GCP,
      now: NOW,
    });

    expect(
      azure.map((read: CloudAddedMetric) => {
        return [read.scope, read.name, read.azureResourceId];
      }),
    ).toEqual([
      [CloudAddedMetricScope.Resource, "ServerSideLatency", COSMOS_ID],
    ]);
    expect(
      gcp.map((read: CloudAddedMetric) => {
        return [read.scope, read.name, read.resourceLabels];
      }),
    ).toEqual([
      [
        CloudAddedMetricScope.Resource,
        PUBSUB_PUBLISH_OPERATIONS_METRIC,
        { project_id: "shop-prod", topic_id: "orders" },
      ],
    ]);
  });

  test("an AWS connection, or one of no provider, gets none and asks nothing", async () => {
    for (const provider of [CloudProvider.AWS, undefined, "other"]) {
      expect(
        await CloudRetiredMetricReads.find({
          projectId: PROJECT,
          provider,
          now: NOW,
        }),
      ).toEqual([]);
    }

    expect(statements).toEqual([]);
  });

  test("a project with nothing on a deprecated metric reads nothing more", async () => {
    expect(
      await CloudRetiredMetricReads.find({
        projectId: PROJECT,
        provider: CloudProvider.Azure,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("are kept ten minutes a project, then found again: a monitor moved meanwhile is read as it is", async () => {
    let asked: number = 0;
    let found: Array<RetiredCloudMetricQuery> = [
      {
        metric: RetiredCloudMetric.CosmosServerSideLatency,
        metricVariable: "a",
        metricName: "azure_serversidelatency_average",
        attributes: { "azuremonitor.resource_id": COSMOS_ID },
      },
    ];

    CloudRetiredMetricReads.findQueries = async () => {
      asked++;
      return found;
    };

    const find: (at: Date, projectId?: ObjectID) => Promise<number> = async (
      at: Date,
      projectId: ObjectID = PROJECT,
    ): Promise<number> => {
      return (
        await CloudRetiredMetricReads.find({
          projectId,
          provider: CloudProvider.Azure,
          now: at,
        })
      ).length;
    };

    expect(await find(NOW)).toBe(1);
    expect(asked).toBe(1);

    // Moved meanwhile: still read until the ten minutes are up.
    found = [];
    expect(
      await find(new Date(NOW.getTime() + CLOUD_RETIRED_READS_MEMO_MS - 1)),
    ).toBe(1);
    expect(asked).toBe(1);

    // Another project is its own.
    expect(await find(NOW, OTHER_PROJECT)).toBe(0);
    expect(asked).toBe(2);

    expect(
      await find(new Date(NOW.getTime() + CLOUD_RETIRED_READS_MEMO_MS)),
    ).toBe(0);
    expect(asked).toBe(3);

    // A clock that went back reads again rather than trusting the future.
    found = [
      {
        metric: RetiredCloudMetric.CosmosServerSideLatency,
        metricVariable: "a",
        metricName: "azure_serversidelatency_average",
        attributes: {},
      },
    ];
    expect(await find(new Date(NOW.getTime() - 1000))).toBe(1);
    expect(asked).toBe(4);
  });

  test("a project forgotten is found again at its next read: a move is not read for ten more minutes", async () => {
    let asked: number = 0;

    CloudRetiredMetricReads.findQueries = async () => {
      asked++;
      return [];
    };

    await CloudRetiredMetricReads.find({
      projectId: PROJECT,
      provider: CloudProvider.GCP,
      now: NOW,
    });
    CloudRetiredMetricReads.forget(PROJECT);
    await CloudRetiredMetricReads.find({
      projectId: PROJECT,
      provider: CloudProvider.GCP,
      now: NOW,
    });

    expect(asked).toBe(2);
  });
});
