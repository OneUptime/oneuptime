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
import MetricService from "../../../../Server/Services/MetricService";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import {
  CloudConnectionSettings,
  GcpSplitUnranked,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { getGcpSplitRankKey } from "../../../../Server/Utils/CloudConnection/Gcp/GcpCloudConnector";
import {
  AWS_CLOUDWATCH_UNITS,
  AWS_UNIT_LOOK_BACK_DAYS,
  pickAwsMetricUnit,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudWatch";
import CloudResourceMetrics, {
  CLOUD_PUBLISHED_METRICS_UNIT_PROBES,
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
import { getAwsDocumentedMetricUnit } from "../../../../Types/Cloud/AwsMetricUnits";
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
  awsJsonError,
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
  // Read only split, by a dimension it lists (#9808): added split.
  definition("Http406", {
    primaryAggregationType: "Total",
    unit: "Count",
    isDimensionRequired: true,
    dimensions: [{ value: "Instance", localizedValue: "Instance" }],
  }),
  definition("Gen0Collections", {
    primaryAggregationType: "Total",
    dimensions: [
      { value: "Instance", localizedValue: "Instance" },
      { value: "Bad Name", localizedValue: "Bad Name" },
    ],
  }),
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
        name: "Gen0Collections",
        status: CloudPublishedMetricStatus.Available,
        block: undefined,
      },
      {
        name: "Http3xx",
        status: CloudPublishedMetricStatus.Available,
        block: undefined,
      },
      // Read only split, by a dimension it lists: added split (#9808).
      {
        name: "Http406",
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
    const of: (name: string) => CloudPublishedMetric = (
      name: string,
    ): CloudPublishedMetric => {
      return listing.metrics.find((metric: CloudPublishedMetric) => {
        return metric.name === name;
      })!;
    };

    // Each dimension a split call can name, in its definition's words.
    expect(of("Http406").splits).toEqual([{ name: "Instance" }]);
    expect(of("Http406").isSplitRequired).toBe(true);
    expect(of("Gen0Collections").splits).toEqual([{ name: "Instance" }]);
    expect(of("Gen0Collections").isSplitRequired).toBeUndefined();
    // Required, but no dimension listed: still cannot be added.
    expect(of("InstanceSplit").splits).toBeUndefined();

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

  // The database's metrics, as ListMetrics lists them over two weeks.
  function listMetricsAnswer(): ReturnType<typeof awsJson> {
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
  }

  function awsFake(): FakeAwsLive {
    return createFakeAwsLive({ "monitoring:ListMetrics": listMetricsAnswer });
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
      // Published only per Role (#9808): added split by it.
      "OnlyOnASplit:available:Average",
      "ReadThroughput:available:Average",
      "SwapUsage:available:Average",
      "CPUUtilization:key:Average",
    ]);
    expect(listing.metrics[2]!.dimensions).toEqual([
      { name: "DBInstanceIdentifier", value: "orders" },
    ]);
    expect(listing.canEdit).toBe(false);
    expect(listing.azureMetricsInCall).toBeUndefined();
  });

  /*
   * #9808: CloudWatch lists a metric's series of one dimension more than
   * the resource's own - SwapUsage per Role - and the list offers each such
   * dimension to split by, with how many values the resource has; one it
   * publishes only so is added only split.
   */
  test("lists what each metric can be split by, its values now, and one it publishes only split", async () => {
    const listing: CloudPublishedMetricsListing =
      await CloudResourceMetrics.listPublished({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        canEdit: true,
        dependencies: dependencies(awsFake().transport),
      });
    const of: (name: string) => CloudPublishedMetric = (
      name: string,
    ): CloudPublishedMetric => {
      return listing.metrics.find((metric: CloudPublishedMetric) => {
        return metric.name === name;
      })!;
    };

    expect(of("SwapUsage").splits).toEqual([{ name: "Role", values: 1 }]);
    expect(of("SwapUsage").isSplitRequired).toBeUndefined();
    expect(of("OnlyOnASplit").splits).toEqual([{ name: "Role", values: 1 }]);
    expect(of("OnlyOnASplit").isSplitRequired).toBe(true);
    expect(of("ReadThroughput").splits).toBeUndefined();
  });

  test("adding one split keeps its split; a split it does not list, or none where one is needed, is refused", async () => {
    const result: { added: CloudAddedMetric } = await CloudResourceMetrics.add({
      projectId: PROJECT,
      cloudResourceId: RESOURCE,
      props: { isRoot: true },
      name: "OnlyOnASplit",
      namespace: "AWS/RDS",
      scope: CloudAddedMetricScope.Resource,
      splitBy: "Role",
      dependencies: dependencies(awsFake().transport),
    });

    expect(result.added.splitBy).toBe("Role");
    expect(result.added.dimensions).toEqual([
      { name: "DBInstanceIdentifier", value: "orders" },
    ]);
    expect(savedAdditions()[0]!.splitBy).toBe("Role");

    saved = [];

    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.add({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          name: "OnlyOnASplit",
          namespace: "AWS/RDS",
          scope: CloudAddedMetricScope.Resource,
          dependencies: dependencies(awsFake().transport),
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["splitRequired"]);
    expect(
      await refusalOf(() => {
        return CloudResourceMetrics.add({
          projectId: PROJECT,
          cloudResourceId: RESOURCE,
          props: { isRoot: true },
          name: "SwapUsage",
          namespace: "AWS/RDS",
          scope: CloudAddedMetricScope.Resource,
          splitBy: "AvailabilityZone",
          dependencies: dependencies(awsFake().transport),
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["invalidSplit"]);
    expect(saved).toHaveLength(0);
  });

  test("a metric added split learns its unit from a series of the split, where its own has none", async () => {
    const fake: FakeAwsLive = awsFakeWithUnits({ OnlyOnASplit: "Count" });

    const result: { added: CloudAddedMetric } = await CloudResourceMetrics.add({
      projectId: PROJECT,
      cloudResourceId: RESOURCE,
      props: { isRoot: true },
      name: "OnlyOnASplit",
      namespace: "AWS/RDS",
      scope: CloudAddedMetricScope.Resource,
      splitBy: "Role",
      dependencies: dependencies(fake.transport),
    });
    const probe: AwsLiveCall = fake.callsTo("monitoring:GetMetricData")[0]!;
    const query: JSONObject = (
      probe.json["MetricDataQueries"] as Array<JSONObject>
    )[0]!;

    expect(result.added.unit).toBe("Count");
    expect(
      ((query["MetricStat"] as JSONObject)["Metric"] as JSONObject)[
        "Dimensions"
      ],
    ).toEqual([
      { Name: "DBInstanceIdentifier", Value: "orders" },
      { Name: "Role", Value: "WRITER" },
    ]);
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

  /*
   * #9809: CloudWatch answers a GetMetricData query that names a unit only
   * with the data published with that unit, as here: each metric's
   * datapoints carry the unit of `publishedWith`, a day's sample count a
   * point over the fortnight asked.
   */
  function unitProbe(
    publishedWith: Record<string, string | Array<[string, number]>>,
  ): (call: AwsLiveCall) => ReturnType<typeof awsJson> {
    return (call: AwsLiveCall) => {
      const queries: Array<JSONObject> = call.json[
        "MetricDataQueries"
      ] as Array<JSONObject>;

      return awsJson({
        MetricDataResults: queries.map((query: JSONObject): JSONObject => {
          const stat: JSONObject = query["MetricStat"] as JSONObject;
          const name: string = String(
            (stat["Metric"] as JSONObject)["MetricName"],
          );
          const published: string | Array<[string, number]> | undefined =
            publishedWith[name];
          const units: Array<[string, number]> =
            typeof published === "string"
              ? [[published, 1440]]
              : published || [];
          const samples: number =
            units.find((entry: [string, number]): boolean => {
              return entry[0] === stat["Unit"];
            })?.[1] || 0;

          return {
            Id: query["Id"],
            Label: name,
            StatusCode: "Complete",
            Timestamps: samples ? [1763337600, 1763424000] : [],
            Values: samples ? [samples, samples] : [],
          };
        }),
      });
    };
  }

  function awsFakeWithUnits(
    publishedWith: Record<string, string | Array<[string, number]>>,
  ): FakeAwsLive {
    return createFakeAwsLive({
      "monitoring:ListMetrics": listMetricsAnswer,
      "monitoring:GetMetricData": unitProbe(publishedWith),
    });
  }

  test("adding one learns its unit from its datapoints: one GetMetricData call, a query per CloudWatch unit, on its own series", async () => {
    const fake: FakeAwsLive = awsFakeWithUnits({ SwapUsage: "Bytes" });

    const result: { added: CloudAddedMetric } = await CloudResourceMetrics.add({
      projectId: PROJECT,
      cloudResourceId: RESOURCE,
      props: { isRoot: true },
      name: "SwapUsage",
      namespace: "AWS/RDS",
      scope: CloudAddedMetricScope.Resource,
      dependencies: dependencies(fake.transport),
    });
    const probes: Array<AwsLiveCall> = fake.callsTo("monitoring:GetMetricData");

    expect(result.added.unit).toBe("Bytes");
    expect(savedAdditions()[0]!.unit).toBe("Bytes");
    expect(probes).toHaveLength(1);
    expect(probes[0]!.region).toBe("us-east-1");

    const queries: Array<JSONObject> = probes[0]!.json[
      "MetricDataQueries"
    ] as Array<JSONObject>;

    expect(
      queries.map((query: JSONObject): unknown => {
        return (query["MetricStat"] as JSONObject)["Unit"];
      }),
    ).toEqual([...AWS_CLOUDWATCH_UNITS]);

    for (const query of queries) {
      const stat: JSONObject = query["MetricStat"] as JSONObject;

      expect(stat["Stat"]).toBe("SampleCount");
      expect(stat["Period"]).toBe(86400);
      expect(stat["Metric"]).toEqual({
        Namespace: "AWS/RDS",
        MetricName: "SwapUsage",
        Dimensions: [{ Name: "DBInstanceIdentifier", Value: "orders" }],
      });
    }

    // The fortnight ListMetrics lists a quiet metric for, up to now.
    expect(probes[0]!.json["EndTime"]).toBe(NOW.getTime() / 1000);
    expect(probes[0]!.json["StartTime"]).toBe(
      NOW.getTime() / 1000 - AWS_UNIT_LOOK_BACK_DAYS * 86400,
    );
  });

  test("a type's addition learns its unit from the series of the resource it is added from", async () => {
    const fake: FakeAwsLive = awsFakeWithUnits({
      ReadThroughput: "Bytes/Second",
    });

    const result: { added: CloudAddedMetric } = await CloudResourceMetrics.add({
      projectId: PROJECT,
      cloudResourceId: RESOURCE,
      props: { isRoot: true },
      name: "ReadThroughput",
      namespace: "AWS/RDS",
      scope: CloudAddedMetricScope.Type,
      dependencies: dependencies(fake.transport),
    });

    expect(result.added.unit).toBe("Bytes/Second");
    expect(result.added.dimensions).toBeUndefined();
  });

  test("a metric published with two units is kept with the one of most samples", () => {
    expect(
      pickAwsMetricUnit([
        { id: "u14", timestamps: [1, 2], values: [3, 2] },
        { id: "u26", timestamps: [1], values: [1440] },
        { id: "u3", timestamps: [], values: [] },
      ]),
    ).toBe("None");
    expect(
      pickAwsMetricUnit([
        { id: "u14", timestamps: [1, 2], values: [700, 800] },
        { id: "u26", timestamps: [1], values: [1440] },
      ]),
    ).toBe("Count");
    // Nothing published, or answers that are no probe's.
    expect(pickAwsMetricUnit([])).toBe("");
    expect(
      pickAwsMetricUnit([
        { id: "u3", timestamps: [1], values: [0] },
        { id: "q0", timestamps: [1], values: [5] },
        { id: "u99", timestamps: [1], values: [5] },
      ]),
    ).toBe("");
  });

  test("no datapoints in a fortnight, or a probe the role refuses: added all the same, with the unit AWS documents or none", async () => {
    for (const probe of [
      unitProbe({}),
      (): ReturnType<typeof awsJson> => {
        return awsJsonError(400, "AccessDenied", "not authorized");
      },
    ]) {
      saved = [];

      const fake: FakeAwsLive = createFakeAwsLive({
        "monitoring:ListMetrics": listMetricsAnswer,
        "monitoring:GetMetricData": probe,
      });

      const swap: { added: CloudAddedMetric } = await CloudResourceMetrics.add({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        name: "SwapUsage",
        namespace: "AWS/RDS",
        scope: CloudAddedMetricScope.Resource,
        dependencies: dependencies(fake.transport),
      });

      expect(swap.added.unit).toBe(
        getAwsDocumentedMetricUnit("AWS/RDS", "SwapUsage"),
      );
      expect(savedAdditions()).toHaveLength(1);
    }
  });

  test("the list says each metric's unit: an addition's as it was kept, a key metric's from the catalog, any other's as AWS documents it", async () => {
    connection = connectionRow({
      provider: CloudProvider.AWS,
      addedMetrics: toStoredCloudAddedMetrics([
        added({
          provider: CloudProvider.AWS,
          resourceType: "AWS::RDS::DBInstance",
          namespace: "AWS/RDS",
          name: "SwapUsage",
          aggregation: "Average",
          grain: undefined,
          unit: "Bytes",
        }),
      ]) as never,
    });

    const fake: FakeAwsLive = awsFakeWithUnits({});
    const listing: CloudPublishedMetricsListing =
      await CloudResourceMetrics.listPublished({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        canEdit: true,
        dependencies: dependencies(fake.transport),
      });
    const unitOf: (name: string) => string = (name: string): string => {
      return (
        listing.metrics.find((metric: CloudPublishedMetric): boolean => {
          return metric.name === name;
        })?.unit ?? "missing"
      );
    };

    expect(unitOf("SwapUsage")).toBe("Bytes");
    expect(unitOf("CPUUtilization")).toBe("Percent");
    expect(unitOf("ReadThroughput")).toBe(
      getAwsDocumentedMetricUnit("AWS/RDS", "ReadThroughput"),
    );
    // An addition with its unit is never asked again.
    expect(fake.callsTo("monitoring:GetMetricData")).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  test("an addition kept with no unit is asked again when it is listed, and kept with the unit its datapoints now carry", async () => {
    const swap: CloudAddedMetric = added({
      provider: CloudProvider.AWS,
      resourceType: "AWS::RDS::DBInstance",
      namespace: "AWS/RDS",
      name: "SwapUsage",
      aggregation: "Average",
      grain: undefined,
      unit: "",
    });
    const other: CloudAddedMetric = added({
      provider: CloudProvider.AWS,
      resourceType: "AWS::RDS::DBInstance",
      namespace: "AWS/RDS",
      name: "BinLogDiskUsage",
      aggregation: "Average",
      grain: undefined,
      unit: "",
    });

    connection = connectionRow({
      provider: CloudProvider.AWS,
      addedMetrics: toStoredCloudAddedMetrics([swap, other]) as never,
    });
    jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockImplementation((async () => {
        return connection;
      }) as never);

    const fake: FakeAwsLive = awsFakeWithUnits({ SwapUsage: "Bytes" });
    const listing: CloudPublishedMetricsListing =
      await CloudResourceMetrics.listPublished({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        canEdit: true,
        dependencies: dependencies(fake.transport),
      });

    expect(
      listing.metrics.find((metric: CloudPublishedMetric): boolean => {
        return metric.name === "SwapUsage";
      })?.unit,
    ).toBe("Bytes");
    expect(fake.callsTo("monitoring:GetMetricData")).toHaveLength(1);
    // Kept with it; the other addition, not listed for this resource, as it was.
    expect(
      savedAdditions().map((metric: CloudAddedMetric): string => {
        return `${metric.name}:${metric.unit}`;
      }),
    ).toEqual(["SwapUsage:Bytes", "BinLogDiskUsage:"]);
  });

  test("a listing asks the unit of two additions at most", async () => {
    const names: Array<string> = ["SwapUsage", "ReadThroughput", "OtherOne"];

    connection = connectionRow({
      provider: CloudProvider.AWS,
      addedMetrics: toStoredCloudAddedMetrics(
        names.map((name: string): CloudAddedMetric => {
          return added({
            provider: CloudProvider.AWS,
            resourceType: "AWS::RDS::DBInstance",
            namespace: "AWS/RDS",
            name,
            aggregation: "Average",
            grain: undefined,
            unit: "",
          });
        }),
      ) as never,
    });
    jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockImplementation((async () => {
        return connection;
      }) as never);

    const fake: FakeAwsLive = createFakeAwsLive({
      "monitoring:ListMetrics": () => {
        return awsJson({
          Metrics: names.map((name: string): JSONObject => {
            return {
              Namespace: "AWS/RDS",
              MetricName: name,
              Dimensions: [{ Name: "DBInstanceIdentifier", Value: "orders" }],
            };
          }),
        });
      },
      "monitoring:GetMetricData": unitProbe({
        SwapUsage: "Bytes",
        ReadThroughput: "Bytes/Second",
        OtherOne: "Count",
      }),
    });

    await CloudResourceMetrics.listPublished({
      projectId: PROJECT,
      cloudResourceId: RESOURCE,
      props: { isRoot: true },
      canEdit: true,
      dependencies: dependencies(fake.transport),
    });

    expect(fake.callsTo("monitoring:GetMetricData")).toHaveLength(
      CLOUD_PUBLISHED_METRICS_UNIT_PROBES,
    );
    expect(
      savedAdditions().filter((metric: CloudAddedMetric): boolean => {
        return Boolean(metric.unit);
      }),
    ).toHaveLength(CLOUD_PUBLISHED_METRICS_UNIT_PROBES);
  });

  /*
   * #10077: the reads learn an addition's unit from its datapoints and keep
   * it in the account's read state, so the listing shows it, and asks
   * nothing of an addition whose unit a read learned - an organization's
   * account's in its own state.
   */
  test("a unit the reads learned is the one listed, and the listing asks nothing more of it", async () => {
    const swap: CloudAddedMetric = added({
      provider: CloudProvider.AWS,
      resourceType: "AWS::RDS::DBInstance",
      namespace: "AWS/RDS",
      name: "SwapUsage",
      aggregation: "Average",
      grain: undefined,
      // Kept with none when it was added: nothing published in the fortnight.
      unit: "",
    });
    const burst: CloudAddedMetric = added({
      provider: CloudProvider.AWS,
      resourceType: "AWS::RDS::DBInstance",
      namespace: "AWS/RDS",
      name: "BurstBalance",
      aggregation: "Average",
      grain: undefined,
      // Kept with one; the reads found the publisher sends another now.
      unit: "Percent",
    });

    connection = connectionRow({
      provider: CloudProvider.AWS,
      addedMetrics: toStoredCloudAddedMetrics([swap, burst]) as never,
      pullState: {
        accountStates: {
          [LIVE_ACCOUNT]: {
            awsAddedMetricUnits: {
              [swap.key]: { unit: "Bytes", checkedAt: NOW.toISOString() },
              [burst.key]: { unit: "Count", checkedAt: NOW.toISOString() },
            },
          },
        },
      } as never,
    });
    jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockImplementation((async () => {
        return connection;
      }) as never);

    const fake: FakeAwsLive = createFakeAwsLive({
      "monitoring:ListMetrics": () => {
        return awsJson({
          Metrics: ["SwapUsage", "BurstBalance"].map(
            (name: string): JSONObject => {
              return {
                Namespace: "AWS/RDS",
                MetricName: name,
                Dimensions: [{ Name: "DBInstanceIdentifier", Value: "orders" }],
              };
            },
          ),
        });
      },
      "monitoring:GetMetricData": unitProbe({ SwapUsage: "Kilobytes" }),
    });
    const listing: CloudPublishedMetricsListing =
      await CloudResourceMetrics.listPublished({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        canEdit: true,
        dependencies: dependencies(fake.transport),
      });
    const unitOf: (name: string) => string | undefined = (
      name: string,
    ): string | undefined => {
      return listing.metrics.find((metric: CloudPublishedMetric): boolean => {
        return metric.name === name;
      })?.unit;
    };

    expect(unitOf("SwapUsage")).toBe("Bytes");
    expect(unitOf("BurstBalance")).toBe("Count");
    // Learned by the reads: no listing probe, nothing saved again.
    expect(fake.callsTo("monitoring:GetMetricData")).toHaveLength(0);
    expect(savedAdditions()).toHaveLength(0);
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

  /*
   * #10164: a split its connection's reads found PromQL cannot rank says
   * so, with what the hour's list returned of each resource, so its cost
   * counts the learning's every value.
   */
  test("a split its reads found PromQL cannot rank says so, with what the hour's list returns of a resource", async () => {
    const METRIC: string =
      "cloudsql.googleapis.com/database/postgresql/statements_executed_count";
    const unranked: GcpSplitUnranked = {
      at: new Date().toISOString(),
      projectId: "acme-prod",
      metricType: METRIC,
      aligner: "ALIGN_RATE",
      label: "operation_type",
      valuesPerResource: 42,
    };

    connection = connectionRow({
      provider: CloudProvider.GCP,
      pullState: {
        gcpSplitUnranked: { [getGcpSplitRankKey(unranked)]: unranked },
      } as JSONObject,
    });

    const fake: FakeGcpLive = createFakeGcpLive({
      monitoring: (url: URL) => {
        if (!url.pathname.endsWith("/metricDescriptors")) {
          return json({ timeSeries: [] });
        }

        return json({
          metricDescriptors: [
            descriptor(METRIC, {
              metricKind: "DELTA",
              labels: [
                { key: "operation_type", valueType: "STRING" },
                { key: "user_name", valueType: "STRING" },
              ],
            }),
          ],
        });
      },
    });

    const listing: CloudPublishedMetricsListing =
      await CloudResourceMetrics.listPublished({
        projectId: PROJECT,
        cloudResourceId: RESOURCE,
        props: { isRoot: true },
        canEdit: true,
        dependencies: dependencies(fake.transport),
      });
    const listed: CloudPublishedMetric | undefined = listing.metrics.find(
      (metric: CloudPublishedMetric): boolean => {
        return metric.name === METRIC;
      },
    );

    expect(listed?.splits).toEqual([
      {
        name: "operation_type",
        isLearnedFromEveryValue: true,
        learnedValuesPerResource: 42,
      },
      // Another label of it: PromQL was never refused by it.
      { name: "user_name" },
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

  /*
   * #9739: a Cosmos DB monitor of the ServerSideLatency Microsoft retires
   * moves to the latency its account reported most: the same read, its
   * points counted.
   */
  test("how many points each reported: the same read, counted", () => {
    const data: Parameters<
      typeof CloudResourceMetrics.buildReportedPointsStatement
    >[0] = {
      projectId: PROJECT,
      attributes: { "azuremonitor.resource_id": SITE },
      names: [
        "azure_serversidelatencydirect_average",
        "AZURE_SERVERSIDELATENCYGATEWAY_AVERAGE",
      ],
      since: new Date("2026-10-20T12:00:00.000Z"),
      until: NOW,
    };
    const counted: Statement =
      CloudResourceMetrics.buildReportedPointsStatement(data);
    const last: Statement =
      CloudResourceMetrics.buildLastReportedStatement(data);

    expect(counted.query).toContain(
      "SELECT name, count() AS points FROM Metric",
    );
    // Everything after what is read of each name is the last-reported read's.
    expect(counted.query.slice(counted.query.indexOf(" FROM "))).toBe(
      last.query.slice(last.query.indexOf(" FROM ")),
    );
    expect(Object.values(counted.query_params)).toEqual(
      Object.values(last.query_params),
    );
    expect(JSON.stringify(Object.values(counted.query_params))).toContain(
      "azure_serversidelatencygateway_average",
    );
  });

  test("the points are read back by name, a name with none left out", async () => {
    let reads: number = 0;

    // Restored after each test (afterEach).
    jest.spyOn(MetricService, "executeQuery").mockImplementation((async () => {
      reads++;

      return {
        json: async () => {
          return {
            data: [
              { name: "AZURE_SERVERSIDELATENCYDIRECT_AVERAGE", points: "4200" },
              { name: "azure_serversidelatencygateway_average", points: 0 },
              { name: "", points: 3 },
            ],
          };
        },
      };
    }) as never);

    const points: Map<string, number> =
      await CloudResourceMetrics.findReportedPoints({
        projectId: PROJECT,
        attributes: { "azuremonitor.resource_id": SITE },
        names: [
          "azure_serversidelatencydirect_average",
          "azure_serversidelatencygateway_average",
        ],
        since: new Date("2026-10-20T12:00:00.000Z"),
        until: NOW,
      });

    expect(Array.from(points.entries())).toEqual([
      ["azure_serversidelatencydirect_average", 4200],
    ]);
    expect(reads).toBe(1);
    // No names, no read.
    expect(
      await CloudResourceMetrics.findReportedPoints({
        projectId: PROJECT,
        attributes: {},
        names: [],
        since: new Date("2026-10-20T12:00:00.000Z"),
        until: NOW,
      }),
    ).toEqual(new Map());
    expect(reads).toBe(1);
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
