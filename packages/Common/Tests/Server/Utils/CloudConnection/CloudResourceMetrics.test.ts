import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudResourceMetrics, {
  CloudResourceMetricsDependencies,
  getAwsDefaultStatistic,
  getAwsDimensionsOfAttributes,
  getGcpLabelsOfAttributes,
  getGcpMetricPrefixesOfType,
  getGcpReadOfDescriptor,
} from "../../../../Server/Utils/CloudConnection/CloudResourceMetrics";
import CloudLiveReadRateLimit, {
  CLOUD_LIVE_READS_PER_MINUTE,
} from "../../../../Server/Utils/CloudConnection/LiveRead/CloudLiveReadRateLimit";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  CLOUD_ADDED_METRIC_REFUSALS,
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
  readCloudAddedMetrics,
  toStoredCloudAddedMetrics,
} from "../../../../Types/Cloud/CloudAddedMetrics";
import { CloudKeyMetricCondition } from "../../../../Types/Cloud/CloudKeyMetricCondition";
import { AWS_KEY_METRICS } from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudPublishedMetric,
  CloudPublishedMetricBlock,
  CloudPublishedMetricStatus,
  CloudPublishedMetricsListing,
} from "../../../../Types/Cloud/CloudPublishedMetrics";
import {
  CloudUnreportedKeyMetricReport,
  CloudUnreportedReason,
} from "../../../../Types/Cloud/CloudUnreportedKeyMetrics";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  AZURE_CLIENT,
  AZURE_CLIENT_SECRET,
  AZURE_SUBSCRIPTION,
  AZURE_TENANT,
  AwsLiveCall,
  FakeAwsLive,
  FakeAzureLive,
  FakeGcpLive,
  LIVE_ACCOUNT,
  awsJson,
  createFakeAwsLive,
  createFakeAzureLive,
  createFakeGcpLive,
} from "./CloudLiveReadFakes";
import { json } from "../LlmObservability/FakeProviderApi";

/*
 * A cloud resource's metrics beyond its key metrics (#9563) and why it did
 * not report some of its key metrics (#9569), against fake clouds and
 * faked services: what each cloud's listing asks and how its answer is
 * read, adding and removing within the caps, and the reasons - its Azure
 * definitions, its stream, its connection's last read - with since when.
 */

const PROJECT: ObjectID = new ObjectID("5f8b9c1e-1111-4111-8111-111111111111");
const RESOURCE: ObjectID = new ObjectID("5f8b9c1e-2222-4222-8222-222222222222");
const OTHER_RESOURCE: ObjectID = new ObjectID(
  "5f8b9c1e-3333-4333-8333-333333333333",
);
const CONNECTION: ObjectID = new ObjectID(
  "5f8b9c1e-4444-4444-8444-444444444444",
);
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const SITE: string = `/subscriptions/${AZURE_SUBSCRIPTION}/resourceGroups/rg-web/providers/Microsoft.Web/sites/shop`;
const APP_SERVICE: string = "Microsoft.Web/sites";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

let resource: CloudResource | null = null;
let connection: CloudConnection | null = null;
let settings: CloudConnectionSettings;
let resourcesOfType: Array<CloudResource> = [];
let saved: Array<JSONObject> = [];

// An override may be undefined: a resource no connection reads.
type RowOverrides<T> = { [K in keyof T]?: T[K] | undefined };

function resourceRow(
  overrides: RowOverrides<CloudResource> = {},
): CloudResource {
  const row: CloudResource = new CloudResource();
  row.id = RESOURCE;
  row.projectId = PROJECT;
  row.name = "shop";
  row.cloudProvider = CloudProvider.Azure;
  row.cloudResourceType = APP_SERVICE;
  row.cloudAccountId = AZURE_SUBSCRIPTION;
  row.cloudRegion = "westeurope";
  row.providerResourceId = SITE;
  row.telemetryAttributes = { "azuremonitor.resource_id": SITE };
  row.cloudConnectionId = CONNECTION;
  row.createdAt = new Date("2026-01-01T00:00:00.000Z");
  Object.assign(row, overrides);
  return row;
}

function connectionRow(
  overrides: Partial<CloudConnection> = {},
): CloudConnection {
  const row: CloudConnection = new CloudConnection();
  row.id = CONNECTION;
  row.projectId = PROJECT;
  row.provider = CloudProvider.Azure;
  row.isEnabled = true;
  row.config = {};
  row.pullState = {};
  Object.assign(row, overrides);
  return row;
}

function rowOf(id: ObjectID): CloudResource {
  const row: CloudResource = new CloudResource();
  row.id = id;
  return row;
}

function azureSettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: PROJECT.toString(),
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: AZURE_TENANT,
      clientId: AZURE_CLIENT,
      cloud: "public",
    },
    secrets: { clientSecret: AZURE_CLIENT_SECRET },
  };
}

function awsSettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT.toString(),
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

function gcpSettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: PROJECT.toString(),
    config: { authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey },
    secrets: {
      serviceAccountJson: JSON.stringify({
        type: "service_account",
        project_id: "acme-prod",
        client_email: "oneuptime@acme-prod.iam.gserviceaccount.com",
        private_key: privateKey,
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    },
  };
}

function definition(name: string, overrides: JSONObject = {}): JSONObject {
  return {
    name: { value: name, localizedValue: name },
    unit: "Bytes",
    primaryAggregationType: "Average",
    supportedAggregationTypes: ["Average", "Maximum"],
    metricAvailabilities: [
      { timeGrain: "PT1M", retention: "P93D" },
      { timeGrain: "PT1H", retention: "P93D" },
    ],
    ...overrides,
  };
}

const SITE_DEFINITIONS: Array<JSONObject> = [
  definition("Requests", { primaryAggregationType: "Total", unit: "Count" }),
  definition("Http5xx", { primaryAggregationType: "Total", unit: "Count" }),
  definition("AverageMemoryWorkingSet", {
    name: {
      value: "AverageMemoryWorkingSet",
      localizedValue: "Average memory working set",
    },
    displayDescription: "The average memory the app used.",
  }),
  definition("Http3xx", { primaryAggregationType: "Total", unit: "Count" }),
  definition("InstanceSplit", { isDimensionRequired: true }),
  definition("DailyOnly", {
    metricAvailabilities: [{ timeGrain: "P1D", retention: "P93D" }],
  }),
];

function azureFake(
  definitions: Array<JSONObject> = SITE_DEFINITIONS,
): FakeAzureLive {
  return createFakeAzureLive({
    arm: (url: URL) => {
      if (
        url.pathname.endsWith("/providers/Microsoft.Insights/metricDefinitions")
      ) {
        return json({ value: definitions });
      }

      return json({ error: { code: "NoFake" } }, 404);
    },
  });
}

function dependencies(
  transport: FakeAzureLive["transport"],
  extra: Partial<CloudResourceMetricsDependencies> = {},
): CloudResourceMetricsDependencies {
  return {
    transport,
    now: () => {
      return NOW;
    },
    sleep: async () => {},
    isRateLimited: false,
    ...extra,
  };
}

function added(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
  const metric: CloudAddedMetric = {
    key: "",
    provider: CloudProvider.Azure,
    scope: CloudAddedMetricScope.Type,
    resourceType: APP_SERVICE,
    name: "AverageMemoryWorkingSet",
    aggregation: "Average",
    grain: "PT1M",
    unit: "Bytes",
    addedAt: NOW.toISOString(),
    ...overrides,
  };

  return { ...metric, key: getCloudAddedMetricKey(metric) };
}

function savedAdditions(): Array<CloudAddedMetric> {
  return readCloudAddedMetrics(saved[saved.length - 1]?.["addedMetrics"]);
}

async function refusalOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal.");
}

beforeEach(() => {
  resource = resourceRow();
  connection = connectionRow();
  settings = azureSettings();
  resourcesOfType = [rowOf(RESOURCE), rowOf(OTHER_RESOURCE)];
  saved = [];
  AssumedRoleCache.clear();
  CloudLiveReadRateLimit.clearLocal();

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
  jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockImplementation((async () => {
      return settings;
    }) as never);
  jest
    .spyOn(CloudConnectionService, "updateOneById")
    .mockImplementation((async (data: { data: JSONObject }) => {
      saved.push(JSON.parse(JSON.stringify(data.data)) as JSONObject);
      return undefined;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an Azure resource's metrics", () => {
  test("its definitions, each said read already, added or not, with how it would be read and why it cannot be added", async () => {
    connection = connectionRow({
      addedMetrics: toStoredCloudAddedMetrics([added()]) as never,
    });
    const fake: FakeAzureLive = azureFake();

    const listing: CloudPublishedMetricsListing =
      await CloudResourceMetrics.listPublished({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        canEdit: true,
        dependencies: dependencies(fake.transport),
      });

    expect(
      fake.armCalls.map((url: URL): string => {
        return url.pathname;
      }),
    ).toEqual([`${SITE}/providers/Microsoft.Insights/metricDefinitions`]);
    expect(
      listing.metrics.map((metric: CloudPublishedMetric) => {
        return {
          name: metric.name,
          status: metric.status,
          block: metric.block,
        };
      }),
    ).toEqual([
      {
        name: "AverageMemoryWorkingSet",
        status: CloudPublishedMetricStatus.Added,
        block: undefined,
      },
      {
        name: "Http3xx",
        status: CloudPublishedMetricStatus.Available,
        block: undefined,
      },
      {
        name: "DailyOnly",
        status: CloudPublishedMetricStatus.Available,
        block: CloudPublishedMetricBlock.CoarseGrain,
      },
      {
        name: "InstanceSplit",
        status: CloudPublishedMetricStatus.Available,
        block: CloudPublishedMetricBlock.NeedsDimension,
      },
      {
        name: "Http5xx",
        status: CloudPublishedMetricStatus.Key,
        block: undefined,
      },
      {
        name: "Requests",
        status: CloudPublishedMetricStatus.Key,
        block: undefined,
      },
    ]);

    const memory: CloudPublishedMetric = listing.metrics[0]!;

    expect(memory).toEqual(
      expect.objectContaining({
        displayName: "Average memory working set",
        description: "The average memory the app used.",
        unit: "Bytes",
        aggregation: "Average",
        grain: "PT1M",
        addedKey: added().key,
        addedScope: CloudAddedMetricScope.Type,
      }),
    );
    expect(listing).toEqual(
      expect.objectContaining({
        provider: "azure",
        resourceType: APP_SERVICE,
        resourcesOfType: 2,
        readIntervalInMinutes: expect.any(Number),
        // Requests, Http5xx and the added memory: its minute call carries three.
        azureMetricsInCall: 3,
        addedForResource: 1,
        canEdit: true,
      }),
    );
  });

  test("adding one for the resource keeps its ARM id, aggregation and grain, and the connection reads it from its next read", async () => {
    const result: {
      added: CloudAddedMetric;
      addedMetrics: Array<CloudAddedMetric>;
    } = await CloudResourceMetrics.add({
      projectId: PROJECT,
      cloudResourceId: RESOURCE,
      props: { isRoot: true },
      name: "averagememoryworkingset",
      scope: CloudAddedMetricScope.Resource,
      userId: new ObjectID("5f8b9c1e-5555-4555-8555-555555555555"),
      dependencies: dependencies(azureFake().transport),
    });

    expect(result.added).toEqual(
      expect.objectContaining({
        provider: CloudProvider.Azure,
        scope: CloudAddedMetricScope.Resource,
        resourceType: APP_SERVICE,
        cloudResourceId: RESOURCE.toString(),
        azureResourceId: SITE,
        name: "AverageMemoryWorkingSet",
        aggregation: "Average",
        grain: "PT1M",
        unit: "Bytes",
        addedAt: NOW.toISOString(),
        addedByUserId: "5f8b9c1e-5555-4555-8555-555555555555",
      }),
    );
    expect(savedAdditions()).toEqual([result.added]);
  });

  test("an aggregation asked for is kept when Azure takes it", async () => {
    const result: { added: CloudAddedMetric } = await CloudResourceMetrics.add({
      projectId: PROJECT,
      cloudResourceId: RESOURCE,
      props: { isRoot: true },
      name: "AverageMemoryWorkingSet",
      scope: CloudAddedMetricScope.Type,
      aggregation: "Maximum",
      dependencies: dependencies(azureFake().transport),
    });

    expect(result.added.aggregation).toBe("Maximum");
    expect(result.added.cloudResourceId).toBeUndefined();
  });

  test("a metric its cloud does not list, cannot read, or reads already is refused, and nothing is kept", async () => {
    for (const name of ["NotThere", "InstanceSplit", "DailyOnly"]) {
      expect(
        await refusalOf(() => {
          return CloudResourceMetrics.add({
            projectId: PROJECT,
            cloudResourceId: RESOURCE,
            props: { isRoot: true },
            name,
            scope: CloudAddedMetricScope.Resource,
            dependencies: dependencies(azureFake().transport),
          });
        }),
      ).toBe(CLOUD_ADDED_METRIC_REFUSALS["invalid"]);
    }

    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.add({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          name: "Requests",
          scope: CloudAddedMetricScope.Resource,
          dependencies: dependencies(azureFake().transport),
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["alreadyRead"]);
    expect(saved).toEqual([]);
  });

  test("a type's addition is refused when a resource of the type has the most additions", async () => {
    const full: Array<CloudAddedMetric> = Array.from(
      { length: 10 },
      (_: unknown, index: number): CloudAddedMetric => {
        return added({
          scope: CloudAddedMetricScope.Resource,
          cloudResourceId: OTHER_RESOURCE.toString(),
          azureResourceId: `${SITE}-2`,
          name: `Other ${index}`,
        });
      },
    );
    connection = connectionRow({
      addedMetrics: toStoredCloudAddedMetrics(full) as never,
    });

    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.add({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          name: "AverageMemoryWorkingSet",
          scope: CloudAddedMetricScope.Type,
          dependencies: dependencies(azureFake().transport),
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["resourceFull"]);
  });

  test("removing one that applies to the resource; refusing one that does not", async () => {
    const other: CloudAddedMetric = added({
      scope: CloudAddedMetricScope.Resource,
      cloudResourceId: OTHER_RESOURCE.toString(),
      azureResourceId: `${SITE}-2`,
      name: "Http3xx",
    });
    connection = connectionRow({
      addedMetrics: toStoredCloudAddedMetrics([added(), other]) as never,
    });

    const result: { addedMetrics: Array<CloudAddedMetric> } =
      await CloudResourceMetrics.remove({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        key: added().key,
      });

    expect(result.addedMetrics).toEqual([other]);
    expect(savedAdditions()).toEqual([other]);

    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.remove({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          key: other.key,
        });
      }),
    ).toBe(
      "This metric is not added to what this resource's cloud connection reads.",
    );
  });
});

describe("an AWS resource's metrics", () => {
  const DB_ATTRIBUTES: Record<string, string> = {
    Namespace: "AWS/RDS",
    "Dimensions.DBInstanceIdentifier": "orders",
    "resource.cloud.account.id": LIVE_ACCOUNT,
    "resource.cloud.region": "us-east-1",
  };

  function awsFake(): FakeAwsLive {
    return createFakeAwsLive({
      "monitoring:ListMetrics": () => {
        return awsJson({
          Metrics: [
            {
              Namespace: "AWS/RDS",
              MetricName: "SwapUsage",
              Dimensions: [{ Name: "DBInstanceIdentifier", Value: "orders" }],
            },
            {
              Namespace: "AWS/RDS",
              MetricName: "CPUUtilization",
              Dimensions: [{ Name: "DBInstanceIdentifier", Value: "orders" }],
            },
            {
              Namespace: "AWS/RDS",
              MetricName: "ReadThroughput",
              Dimensions: [{ Name: "DBInstanceIdentifier", Value: "orders" }],
            },
            // A split of the same database: not its own series.
            {
              Namespace: "AWS/RDS",
              MetricName: "SwapUsage",
              Dimensions: [
                { Name: "DBInstanceIdentifier", Value: "orders" },
                { Name: "Role", Value: "WRITER" },
              ],
            },
            {
              Namespace: "AWS/RDS",
              MetricName: "OnlyOnASplit",
              Dimensions: [
                { Name: "DBInstanceIdentifier", Value: "orders" },
                { Name: "Role", Value: "WRITER" },
              ],
            },
          ],
        });
      },
    });
  }

  beforeEach(() => {
    resource = resourceRow({
      cloudProvider: CloudProvider.AWS,
      cloudResourceType: "AWS::RDS::DBInstance",
      cloudAccountId: LIVE_ACCOUNT,
      cloudRegion: "us-east-1",
      providerResourceId: `arn:aws:rds:us-east-1:${LIVE_ACCOUNT}:db:orders`,
      telemetryAttributes: DB_ATTRIBUTES,
    });
    connection = connectionRow({ provider: CloudProvider.AWS });
    settings = awsSettings();
  });

  test("lists the metrics on its own dimensions over two weeks, each once, read as its sum or average by its name", async () => {
    const fake: FakeAwsLive = awsFake();

    const listing: CloudPublishedMetricsListing =
      await CloudResourceMetrics.listPublished({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        canEdit: false,
        dependencies: dependencies(fake.transport),
      });
    const call: AwsLiveCall = fake.callsTo("monitoring:ListMetrics")[0]!;

    expect(call.region).toBe("us-east-1");
    expect(call.json).toEqual({
      Namespace: "AWS/RDS",
      Dimensions: [{ Name: "DBInstanceIdentifier", Value: "orders" }],
    });
    expect(
      listing.metrics.map((metric: CloudPublishedMetric) => {
        return `${metric.name}:${metric.status}:${metric.aggregation}`;
      }),
    ).toEqual([
      "ReadThroughput:available:Average",
      "SwapUsage:available:Average",
      "CPUUtilization:key:Average",
    ]);
    expect(listing.metrics[1]!.dimensions).toEqual([
      { name: "DBInstanceIdentifier", value: "orders" },
    ]);
    expect(listing.canEdit).toBe(false);
    expect(listing.azureMetricsInCall).toBeUndefined();
  });

  test("adding one for the resource keeps its account, Region and series", async () => {
    const result: { added: CloudAddedMetric } = await CloudResourceMetrics.add({
      projectId: PROJECT,
      cloudResourceId: RESOURCE,
      props: { isRoot: true },
      name: "SwapUsage",
      namespace: "AWS/RDS",
      scope: CloudAddedMetricScope.Resource,
      aggregation: "Maximum",
      dependencies: dependencies(awsFake().transport),
    });

    expect(result.added).toEqual(
      expect.objectContaining({
        provider: CloudProvider.AWS,
        namespace: "AWS/RDS",
        name: "SwapUsage",
        aggregation: "Maximum",
        accountId: LIVE_ACCOUNT,
        region: "us-east-1",
        dimensions: [{ name: "DBInstanceIdentifier", value: "orders" }],
      }),
    );
  });

  test("a resource whose dimensions are not known yet is not listed", async () => {
    resource = resourceRow({
      cloudProvider: CloudProvider.AWS,
      cloudResourceType: "AWS::RDS::DBInstance",
      cloudRegion: "us-east-1",
      telemetryAttributes: { Namespace: "AWS/RDS" },
    });

    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.listPublished({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          canEdit: true,
          dependencies: dependencies(awsFake().transport),
        });
      }),
    ).toContain("are not known yet");
  });
});

describe("a Google Cloud resource's metrics", () => {
  const SQL_ATTRIBUTES: Record<string, string> = {
    "resource.gcp.resource_type": "cloudsql_database",
    "resource.project_id": "acme-prod",
    "resource.database_id": "acme-prod:orders",
    "resource.region": "us-central1",
  };

  function descriptor(type: string, overrides: JSONObject = {}): JSONObject {
    return {
      type,
      displayName: type.split("/").pop(),
      description: `What ${type} is.`,
      unit: "1",
      metricKind: "GAUGE",
      valueType: "INT64",
      launchStage: "GA",
      monitoredResourceTypes: ["cloudsql_database"],
      ...overrides,
    };
  }

  function gcpFake(): FakeGcpLive {
    return createFakeGcpLive({
      monitoring: (url: URL) => {
        if (!url.pathname.endsWith("/metricDescriptors")) {
          return json({ timeSeries: [] });
        }

        return json({
          metricDescriptors: [
            descriptor(
              "cloudsql.googleapis.com/database/postgresql/num_backends",
            ),
            descriptor(
              "cloudsql.googleapis.com/database/disk/read_bytes_count",
              {
                metricKind: "DELTA",
                unit: "By",
              },
            ),
            descriptor("cloudsql.googleapis.com/database/state", {
              valueType: "STRING",
            }),
            descriptor("cloudsql.googleapis.com/database/uptime", {
              launchStage: "DEPRECATED",
              metricKind: "DELTA",
            }),
            descriptor("cloudsql.googleapis.com/database/cpu/utilization", {
              valueType: "DOUBLE",
            }),
            // Another type's metric of the same service.
            descriptor("cloudsql.googleapis.com/instance/other", {
              monitoredResourceTypes: ["cloudsql_instance"],
            }),
          ],
        });
      },
    });
  }

  beforeEach(() => {
    resource = resourceRow({
      cloudProvider: CloudProvider.GCP,
      cloudResourceType: "cloudsql_database",
      cloudAccountId: "acme-prod",
      cloudRegion: "us-central1",
      providerResourceId:
        "//cloudsql.googleapis.com/projects/acme-prod/instances/orders",
      telemetryAttributes: SQL_ATTRIBUTES,
    });
    connection = connectionRow({ provider: CloudProvider.GCP });
    settings = gcpSettings();
  });

  test("lists its type's descriptors, each read as its kind allows, the deprecated and the text ones not addable", async () => {
    const fake: FakeGcpLive = gcpFake();

    const listing: CloudPublishedMetricsListing =
      await CloudResourceMetrics.listPublished({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        canEdit: true,
        dependencies: dependencies(fake.transport),
      });
    const call: URL = fake.monitoringCalls[0]!;

    expect(call.pathname).toBe("/v3/projects/acme-prod/metricDescriptors");
    expect(call.searchParams.get("filter")).toBe(
      'metric.type = starts_with("cloudsql.googleapis.com/")',
    );
    expect(
      listing.metrics.map((metric: CloudPublishedMetric) => {
        return {
          name: metric.name.split("/").slice(-2).join("/"),
          status: metric.status,
          aggregation: metric.aggregation,
          unit: metric.unit,
          block: metric.block,
        };
      }),
    ).toEqual([
      // By their names in words: "num_backends" before "read_bytes_count".
      {
        name: "postgresql/num_backends",
        status: CloudPublishedMetricStatus.Available,
        aggregation: "ALIGN_MEAN",
        unit: "1",
        block: undefined,
      },
      {
        name: "disk/read_bytes_count",
        status: CloudPublishedMetricStatus.Available,
        aggregation: "ALIGN_RATE",
        unit: "By/s",
        block: undefined,
      },
      {
        name: "database/state",
        status: CloudPublishedMetricStatus.Available,
        aggregation: "",
        unit: "1",
        block: CloudPublishedMetricBlock.Unreadable,
      },
      {
        name: "database/uptime",
        status: CloudPublishedMetricStatus.Available,
        aggregation: "ALIGN_RATE",
        unit: "1/s",
        block: CloudPublishedMetricBlock.Deprecated,
      },
      {
        name: "cpu/utilization",
        status: CloudPublishedMetricStatus.Key,
        aggregation: "ALIGN_MEAN",
        unit: "1",
        block: undefined,
      },
    ]);
  });

  test("adding one for the resource keeps its project and identifying labels", async () => {
    const result: { added: CloudAddedMetric } = await CloudResourceMetrics.add({
      projectId: PROJECT,
      cloudResourceId: RESOURCE,
      props: { isRoot: true },
      name: "cloudsql.googleapis.com/database/postgresql/num_backends",
      scope: CloudAddedMetricScope.Resource,
      dependencies: dependencies(gcpFake().transport),
    });

    expect(result.added).toEqual(
      expect.objectContaining({
        provider: CloudProvider.GCP,
        resourceType: "cloudsql_database",
        aggregation: "ALIGN_MEAN",
        accountId: "acme-prod",
        resourceLabels: {
          project_id: "acme-prod",
          database_id: "acme-prod:orders",
          region: "us-central1",
        },
      }),
    );
  });
});

describe("what refuses a listing", () => {
  test("no connection reads the resource, its connection is off, or another cloud's connection is linked", async () => {
    resource = resourceRow({ cloudConnectionId: undefined });

    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.listPublished({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          canEdit: true,
          dependencies: dependencies(azureFake().transport),
        });
      }),
    ).toContain("No cloud connection reads this resource");

    resource = resourceRow();
    connection = connectionRow({ isEnabled: false });

    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.listPublished({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          canEdit: true,
          dependencies: dependencies(azureFake().transport),
        });
      }),
    ).toContain("turned off");

    connection = connectionRow({ provider: CloudProvider.AWS });

    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.listPublished({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          canEdit: true,
          dependencies: dependencies(azureFake().transport),
        });
      }),
    ).toContain("No cloud connection reads this resource");
  });

  test("a resource the caller may not read is not found", async () => {
    resource = null;

    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.listPublished({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          canEdit: true,
          dependencies: dependencies(azureFake().transport),
        });
      }),
    ).toBe("This cloud resource was not found in the project.");
  });

  test("a connection asked too often in a minute", async () => {
    const counts: Map<string, number> = new Map<string, number>();

    jest.spyOn(GlobalCache, "incrementIfBelow").mockImplementation((async (
      _namespace: string,
      key: string,
      options: { limit: number },
    ): Promise<number | null> => {
      const count: number = counts.get(key) || 0;

      if (count >= options.limit) {
        return null;
      }

      counts.set(key, count + 1);
      return count + 1;
    }) as never);

    const list: () => Promise<CloudPublishedMetricsListing> = () => {
      return CloudResourceMetrics.listPublished({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        canEdit: true,
        dependencies: dependencies(azureFake().transport, {
          isRateLimited: true,
        }),
      });
    };

    for (let index: number = 0; index < CLOUD_LIVE_READS_PER_MINUTE; index++) {
      await list();
    }

    expect(await refusalOf(list)).toContain("Try again in a minute");
    expect(Array.from(counts.keys())[0]).toContain(
      `published-metrics:${CONNECTION.toString()}`,
    );
  });
});

describe("why key metrics were not reported", () => {
  test("since when each last reported, never when the look-back holds the resource's whole life, and the reasons OneUptime knows", async () => {
    resource = resourceRow({
      cloudResourceType: "Microsoft.Compute/virtualMachines",
      createdAt: new Date("2026-11-10T00:00:00.000Z"),
      telemetryAttributes: { "azuremonitor.resource_id": SITE },
    });
    connection = connectionRow({
      pullState: {
        azureResourceMetricDefinitions: {
          [SITE.toLowerCase()]: {
            at: NOW.toISOString(),
            of: "x",
            metrics: [{ name: "Percentage CPU" }],
          },
        },
      },
      lastPullResult: {
        status: "partial",
        accounts: [],
        resourceCount: 1,
        resourceTypes: [],
        regions: [],
        newResources: 0,
        archivedResources: 0,
        pointsWritten: 0,
        changesRecorded: 0,
        requestCount: 1,
        warnings: [
          "Azure Monitor could not read Available Memory Bytes of 1 resource: Throttled",
        ],
        durationMs: 1,
        finishedAt: NOW.toISOString(),
      },
    });
    const asked: Array<{
      names: Array<string>;
      attributes: Record<string, string>;
    }> = [];

    const reports: Array<CloudUnreportedKeyMetricReport> =
      await CloudResourceMetrics.explainUnreported({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        keys: [
          "cpu credits remaining",
          "available memory bytes",
          "percentage cpu",
          "not a key metric",
        ],
        dependencies: {
          now: () => {
            return NOW;
          },
          findLastReported: async (data: {
            names: Array<string>;
            attributes: Record<string, string>;
          }) => {
            asked.push(data);
            return new Map<string, Date>([
              [
                "azure_percentage_cpu_maximum",
                new Date("2026-11-19T09:00:00.000Z"),
              ],
              [
                "azure_percentage_cpu_average",
                new Date("2026-11-19T11:00:00.000Z"),
              ],
            ]);
          },
        },
      });

    // Asked once, for every name each may be stored under, on the resource's attributes.
    expect(asked).toHaveLength(1);
    expect(asked[0]!.attributes).toEqual({ "azuremonitor.resource_id": SITE });
    expect(asked[0]!.names).toContain("azure_percentage_cpu_average");
    expect(asked[0]!.names).toContain("azure_cpu_credits_remaining_count");

    const byKey: Map<string, CloudUnreportedKeyMetricReport> = new Map(
      reports.map(
        (
          report: CloudUnreportedKeyMetricReport,
        ): [string, CloudUnreportedKeyMetricReport] => {
          return [report.key, report];
        },
      ),
    );

    expect(Array.from(byKey.keys()).sort()).toEqual([
      "available memory bytes",
      "cpu credits remaining",
      "percentage cpu",
    ]);
    // The newest of the names it is stored under.
    expect(byKey.get("percentage cpu")!.lastReportedAt).toBe(
      "2026-11-19T11:00:00.000Z",
    );
    expect(byKey.get("percentage cpu")!.isNeverReported).toBe(false);
    // Created nine days ago: the 30-day look-back holds its whole life.
    expect(byKey.get("cpu credits remaining")).toEqual({
      key: "cpu credits remaining",
      name: "CPU Credits Remaining",
      lastReportedAt: null,
      isNeverReported: true,
      reasons: [
        { reason: CloudUnreportedReason.NotPublished },
        {
          reason: CloudUnreportedReason.Condition,
          condition: CloudKeyMetricCondition.Burstable,
        },
      ],
    });
    expect(byKey.get("available memory bytes")!.reasons).toEqual([
      { reason: CloudUnreportedReason.ReadFailed, fix: "cloud-connect" },
      { reason: CloudUnreportedReason.NotPublished },
    ]);
  });

  test("a resource older than the look-back did not report it in the last 30 days, which is not never", async () => {
    const reports: Array<CloudUnreportedKeyMetricReport> =
      await CloudResourceMetrics.explainUnreported({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        keys: ["requests"],
        dependencies: {
          now: () => {
            return NOW;
          },
          findLastReported: async () => {
            return new Map<string, Date>();
          },
        },
      });

    expect(reports).toEqual([
      {
        key: "requests",
        name: "Requests",
        lastReportedAt: null,
        isNeverReported: false,
        reasons: [],
      },
    ]);
  });

  test("an AWS key metric its stream sends, and none came; a resource with no connection", async () => {
    resource = resourceRow({
      cloudProvider: CloudProvider.AWS,
      cloudResourceType: "AWS::EC2::Instance",
      cloudAccountId: LIVE_ACCOUNT,
      cloudRegion: "us-east-1",
      telemetryAttributes: {
        Namespace: "AWS/EC2",
        "Dimensions.InstanceId": "i-0aaa",
      },
    });
    connection = connectionRow({
      provider: CloudProvider.AWS,
      streamKeyCreatedAt: new Date("2026-11-01T00:00:00.000Z"),
      streamSummary: {
        metricSources: [
          {
            accountId: LIVE_ACCOUNT,
            region: "us-east-1",
            namespaces: ["AWS/EC2"],
            lastAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
            templateVersion: 2,
          },
        ],
        logSources: [],
      },
    });
    const explain: () => Promise<
      Array<CloudUnreportedKeyMetricReport>
    > = () => {
      return CloudResourceMetrics.explainUnreported({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        keys: ["aws/ec2|cpuutilization"],
        dependencies: {
          now: () => {
            return NOW;
          },
          findLastReported: async () => {
            return new Map<string, Date>();
          },
        },
      });
    };

    expect((await explain())[0]!.reasons).toEqual([
      { reason: CloudUnreportedReason.Streamed, fix: "cloud-connect" },
    ]);

    resource = resourceRow({
      cloudProvider: CloudProvider.AWS,
      cloudResourceType: "AWS::EC2::Instance",
      cloudConnectionId: undefined,
      telemetryAttributes: {
        Namespace: "AWS/EC2",
        "Dimensions.InstanceId": "i-0aaa",
      },
    });

    expect((await explain())[0]!.reasons).toEqual([
      { reason: CloudUnreportedReason.NoConnection, fix: "cloud-connect" },
    ]);
  });

  test("no keys of its type: nothing is asked", async () => {
    let asked: number = 0;

    expect(
      await CloudResourceMetrics.explainUnreported({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        keys: ["nothing"],
        dependencies: {
          findLastReported: async () => {
            asked++;
            return new Map<string, Date>();
          },
        },
      }),
    ).toEqual([]);
    expect(asked).toBe(0);
  });
});

describe("the read of when each name last reported", () => {
  test("one grouped read of the resource's names over the look-back, on its attributes exactly", () => {
    const statement: Statement =
      CloudResourceMetrics.buildLastReportedStatement({
        projectId: PROJECT,
        attributes: {
          "azuremonitor.resource_id": SITE,
          "resource.cloud.region": "westeurope",
        },
        names: ["AZURE_PERCENTAGE_CPU_AVERAGE", "azure_requests_total"],
        since: new Date("2026-10-20T12:00:00.000Z"),
        until: NOW,
      });
    const values: Array<unknown> = Object.values(statement.query_params);

    expect(statement.query).toContain(
      "SELECT name, toUnixTimestamp64Milli(max(time)) AS lastAtMs FROM Metric",
    );
    expect(statement.query).toContain(
      "AND retentionDate >= now() AND name IN (",
    );
    expect(statement.query.match(/AND attributes\[/g)).toHaveLength(2);
    expect(statement.query).toContain("GROUP BY name LIMIT 500");
    expect(values).toContain(SITE);
    expect(values).toContain("westeurope");
    expect(values).toContain("azuremonitor.resource_id");
    expect(JSON.stringify(values)).toContain("azure_percentage_cpu_average");
  });
});

describe("what a listing is read from", () => {
  test("an AWS resource's dimensions, in name order", () => {
    expect(
      getAwsDimensionsOfAttributes({
        Namespace: "AWS/ECS",
        "Dimensions.ServiceName": "web",
        "Dimensions.ClusterName": "prod",
        "resource.cloud.region": "us-east-1",
      }),
    ).toEqual([
      { name: "ClusterName", value: "prod" },
      { name: "ServiceName", value: "web" },
    ]);
  });

  test("a Google Cloud resource's labels, not its type or the connection's attributes", () => {
    expect(
      getGcpLabelsOfAttributes({
        "resource.gcp.resource_type": "gce_instance",
        "resource.instance_id": "1001",
        "resource.zone": "us-central1-a",
        "resource.cloud.region": "us-central1",
        instance_name: "web-1",
      }),
    ).toEqual({ instance_id: "1001", zone: "us-central1-a" });
  });

  test("an AWS metric named like a count in a period is read as its sum, a level, share or rate as its average", () => {
    for (const name of [
      "RequestCount",
      "5XXError",
      "Errors",
      "NumberOfMessagesSent",
      "ExecutionsFailed",
      "NetworkBytes",
      "DroppedPackets",
      "NetworkPacketsIn",
    ]) {
      expect({ name, statistic: getAwsDefaultStatistic(name) }).toEqual({
        name,
        statistic: "Sum",
      });
    }

    for (const name of [
      "CPUUtilization",
      "ReadIOPS",
      "ReadThroughput",
      "SwapUsage",
      "BytesPerSecond",
      "HealthyHostCount",
      "BucketSizeBytes",
      "5xxErrorRate",
      "ProvisionedReadCapacityUnits",
    ]) {
      expect({ name, statistic: getAwsDefaultStatistic(name) }).toEqual({
        name,
        statistic: "Average",
      });
    }
  });

  test("the default agrees with the curated statistic of nearly every AWS key metric read as a sum or an average", () => {
    const misses: Array<string> = [];
    let total: number = 0;

    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        if (metric.statistic !== "Sum" && metric.statistic !== "Average") {
          continue;
        }

        total++;

        if (getAwsDefaultStatistic(metric.metricName) !== metric.statistic) {
          misses.push(`${entry.namespace}/${metric.metricName}`);
        }
      }
    }

    /*
     * Its few misses are names that say nothing either way (an ALB's
     * ActiveConnectionCount is summed, an EFS file system's
     * ClientConnections too): the page lets the person pick another.
     */
    expect(total).toBeGreaterThan(150);
    expect({
      isNearlyAlways: misses.length / total <= 0.05,
      misses,
    }).toEqual({ isNearlyAlways: true, misses });
  });

  test("a Cloud Monitoring descriptor's read, by its kind", () => {
    expect(
      getGcpReadOfDescriptor({
        metricKind: "GAUGE",
        valueType: "DOUBLE",
        unit: "%",
      }),
    ).toEqual({ aligner: "ALIGN_MEAN", unit: "%" });
    expect(
      getGcpReadOfDescriptor({
        metricKind: "CUMULATIVE",
        valueType: "INT64",
        unit: "By",
      }),
    ).toEqual({ aligner: "ALIGN_RATE", unit: "By/s" });
    expect(
      getGcpReadOfDescriptor({
        metricKind: "DELTA",
        valueType: "DISTRIBUTION",
        unit: "ms",
      }),
    ).toEqual({ aligner: "ALIGN_PERCENTILE_95", unit: "ms" });
    expect(
      getGcpReadOfDescriptor({
        metricKind: "GAUGE",
        valueType: "BOOL",
        unit: "",
      }),
    ).toEqual({ aligner: "ALIGN_FRACTION_TRUE", unit: "1" });
    expect(
      getGcpReadOfDescriptor({
        metricKind: "DELTA",
        valueType: "BOOL",
        unit: "",
      }),
    ).toBeNull();
    expect(
      getGcpReadOfDescriptor({
        metricKind: "GAUGE",
        valueType: "STRING",
        unit: "",
      }),
    ).toBeNull();
    expect(
      getGcpReadOfDescriptor({
        metricKind: "GAUGE",
        valueType: "MONEY",
        unit: "USD",
      }),
    ).toBeNull();
  });

  test("a Google Cloud type's metric prefixes: each service its key metrics come from, the Ops Agent's for a VM", () => {
    expect(getGcpMetricPrefixesOfType("cloudsql_database")).toEqual([
      "cloudsql.googleapis.com/",
    ]);
    expect(getGcpMetricPrefixesOfType("gce_instance")).toEqual([
      "compute.googleapis.com/",
      "agent.googleapis.com/",
    ]);
    expect(getGcpMetricPrefixesOfType("not_a_type")).toEqual([]);
  });
});
