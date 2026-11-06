jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import {
  DecodedDelivery,
  decodeFirehoseRecords,
} from "../../FeatureSet/Telemetry/Utils/AwsFirehose/FirehoseRecords";
import {
  CloudResourceScopeSource,
  getCloudResourceAttributeFilters,
  isCloudResourceScoped,
} from "../../FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import CloudAppService from "Common/Server/Services/CloudAppService";
import CloudAppRevisionService from "Common/Server/Services/CloudAppRevisionService";
import LabelService from "Common/Server/Services/LabelService";
import LogService from "Common/Server/Services/LogService";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { HEARTBEAT_ROW_PRESENT } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import {
  STORED_CLOUD_RESOURCE_ID_ATTRIBUTE,
  getAwsLogGroupResource,
} from "Common/Types/Cloud/CloudLogGroups";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  ACCOUNT_ID,
  MINUTE_START_MS,
  REGION,
  cloudWatchLogsDocument,
  cloudWatchLogsRecord,
} from "./Helpers/FakeFirehose";

/*
 * A STREAM'S APP RUNNER, ELASTIC BEANSTALK AND ECS LOGS ON THEIR APP
 * PLATFORMS ENVIRONMENT.
 *
 * A delivery of CloudWatch Logs goes through the stream's decoding
 * (decodeFirehoseRecords), the real logs ingest and the real Cloud
 * Environment discovery (autoDiscoverCloudResource), with only Postgres,
 * Redis, the rule loads and the writer replaced. What is pinned:
 *
 *   - each log group of an App Platforms platform finds its environment -
 *     the platform in the delivery's account and Region, the very one the
 *     platform's apps report to - and nothing else: no app named after the
 *     connection's telemetry service, none from what the group names, no
 *     instance;
 *   - its rows match the environment's Logs tab - the filter the Dashboard
 *     itself builds (CloudResourceTelemetryScope) - and, for an App Runner
 *     service, a Beanstalk environment and an ECS cluster, the resource's
 *     own Logs tab in Cloud as well;
 *   - an app's own telemetry in that environment still makes its app.
 *
 * `jest` is the global one.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const SERVICE_NAME: string = "Production AWS";
const ENTITY_ID_NAMESPACE: string = "cloud-resource-id";
const FENCE_NAMESPACE: string = "otel-maintenance-fence";

const APP_RUNNER_GROUP: string =
  "/aws/apprunner/storefront/8a7b6c5d4e3f/application";
const BEANSTALK_GROUP: string =
  "/aws/elasticbeanstalk/storefront-prod/var/log/web.stdout.log";
const ECS_TASK_GROUP: string = "/ecs/checkout-api";
const ECS_INSIGHTS_GROUP: string =
  "/aws/ecs/containerinsights/production/performance";
const LAMBDA_GROUP: string = "/aws/lambda/checkout";

/* eslint-disable @typescript-eslint/no-explicit-any */
const logsService: Record<string, any> =
  OtelLogsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

let rowsByTarget: Map<FanInInsertTarget, Array<JSONObject>>;
let cachedEntityIds: Map<string, string>;
let heldFences: Set<string>;
// The environments found or made, by key: what a row of each looks like.
let environments: Map<string, CloudResource>;
let findOrCreate: jest.SpiedFunction<
  typeof CloudResourceService.findOrCreateByResourceIdentifier
>;
let recordApp: jest.SpiedFunction<typeof CloudAppService.recordApp>;
let findAppId: jest.SpiedFunction<typeof CloudAppService.findAppId>;
let recordRevision: jest.SpiedFunction<
  typeof CloudAppRevisionService.recordRevision
>;
let recordInstance: jest.SpiedFunction<
  typeof CloudResourceInstanceService.recordInstance
>;

function serviceMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: SERVICE_NAME,
    primaryEntityId: ObjectID.generate(),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  } as unknown as TelemetryServiceMetadata;
}

function logRows(): Array<JSONObject> {
  return rowsByTarget.get(LogService) || [];
}

function rowsOf(logGroup: string): Array<JSONObject> {
  return logRows().filter((row: JSONObject): boolean => {
    return (
      (row["attributes"] as JSONObject)["resource.aws.log.group.name"] ===
      logGroup
    );
  });
}

function logRecord(logGroup: string, message: string): Buffer {
  return cloudWatchLogsRecord(
    cloudWatchLogsDocument({
      logGroup,
      logStream: "instance/1a2b3c4d5e6f",
      events: [{ id: "1", timestamp: MINUTE_START_MS + 1000, message }],
    }),
  );
}

async function deliver(records: Array<Buffer>): Promise<void> {
  const delivery: DecodedDelivery = await decodeFirehoseRecords({
    records: records.map((record: Buffer): string => {
      return record.toString("base64");
    }),
    serviceName: SERVICE_NAME,
    connectionId: CONNECTION_ID,
    region: REGION,
    now: new Date(MINUTE_START_MS + 90_000),
    budget: { bytesLeft: 32 * 1024 * 1024, perRecordBytes: 8 * 1024 * 1024 },
  });

  await OtelLogsIngestService.processLogsFromQueue({
    projectId: PROJECT_ID,
    body: {
      resourceLogs: delivery.resourceLogs.map(
        (delivered: { resource: JSONObject }) => {
          return delivered.resource;
        },
      ),
    },
    headers: {},
  } as unknown as TelemetryRequest);
}

// Whether the environment's Logs tab, as the Dashboard filters it, shows a row.
function isOnEnvironmentLogsTab(
  environment: CloudResourceScopeSource,
  row: JSONObject,
): boolean {
  const attributes: JSONObject = row["attributes"] as JSONObject;

  return (
    isCloudResourceScoped(environment) &&
    Object.entries(getCloudResourceAttributeFilters(environment)).every(
      ([key, value]: [string, string]): boolean => {
        return attributes[key] === value;
      },
    )
  );
}

function environment(key: string): CloudResource {
  const found: CloudResource | undefined = environments.get(key);

  expect({ key, found: Boolean(found) }).toEqual({ key, found: true });

  return found!;
}

beforeEach(() => {
  rowsByTarget = new Map();
  cachedEntityIds = new Map();
  heldFences = new Set();
  environments = new Map();
  OtelIngestBaseService.clearInProcessMemos();

  /*
   * Every discovery but the Cloud Environment's answers nothing: the
   * environment's is the one under test, run for real.
   */
  for (const method of Object.getOwnPropertyNames(OtelIngestBaseService)) {
    if (
      method.startsWith("autoDiscover") &&
      method !== "autoDiscoverCloudResource" &&
      typeof logsService[method] === "function"
    ) {
      jest.spyOn(logsService, method).mockResolvedValue(null);
    }
  }

  jest
    .spyOn(logsService, "resolveTelemetryResource")
    .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
      return serviceMetadata();
    });

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return namespace === ENTITY_ID_NAMESPACE
        ? cachedEntityIds.get(key) || null
        : null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        if (namespace === ENTITY_ID_NAMESPACE) {
          cachedEntityIds.set(key, value);
        }
      },
    );
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(async (namespace: string, key: string) => {
      if (namespace !== FENCE_NAMESPACE) {
        return true;
      }
      if (heldFences.has(key)) {
        return false;
      }
      heldFences.add(key);
      return true;
    });
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);

  // The environment row, as the service finds or makes it by its key.
  findOrCreate = jest
    .spyOn(CloudResourceService, "findOrCreateByResourceIdentifier")
    .mockImplementation(
      async (data: {
        resourceIdentifier: string;
        cloudPlatform?: string | undefined;
        cloudAccountId?: string | undefined;
        cloudRegion?: string | undefined;
      }): Promise<CloudResource> => {
        const row: CloudResource = new CloudResource();
        row._id = ObjectID.generate().toString();
        row.resourceIdentifier = data.resourceIdentifier;
        row.cloudPlatform = data.cloudPlatform;
        row.cloudAccountId = data.cloudAccountId;
        row.cloudRegion = data.cloudRegion;
        environments.set(data.resourceIdentifier, row);
        return row;
      },
    ) as typeof findOrCreate;
  jest
    .spyOn(CloudResourceService, "updateLastSeen")
    .mockResolvedValue(HEARTBEAT_ROW_PRESENT);
  recordInstance = jest
    .spyOn(CloudResourceInstanceService, "recordInstance")
    .mockResolvedValue(undefined);
  recordApp = jest
    .spyOn(CloudAppService, "recordApp")
    .mockResolvedValue(ObjectID.generate());
  findAppId = jest.spyOn(CloudAppService, "findAppId").mockResolvedValue(null);
  recordRevision = jest
    .spyOn(CloudAppRevisionService, "recordRevision")
    .mockResolvedValue({ change: null });
  jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockResolvedValue([]);

  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockResolvedValue([]);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        rowsByTarget.set(target, [
          ...(rowsByTarget.get(target) || []),
          ...batch,
        ]);
        return { flushed: Promise.resolve() };
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a stream's logs, through the real logs ingest and environment discovery", () => {
  test.each([
    {
      logGroup: APP_RUNNER_GROUP,
      key: `aws_app_runner|${ACCOUNT_ID}|${REGION}`,
      message: "GET /cart 200 12ms",
    },
    {
      logGroup: BEANSTALK_GROUP,
      key: `aws_elastic_beanstalk|${ACCOUNT_ID}|${REGION}`,
      message: "Nov  6 10:00:01 ip-10-0-1-23 web: GET /cart 200",
    },
    {
      logGroup: ECS_TASK_GROUP,
      key: `aws_ecs|${ACCOUNT_ID}|${REGION}`,
      message: "listening on :8080",
    },
    {
      logGroup: ECS_INSIGHTS_GROUP,
      key: `aws_ecs|${ACCOUNT_ID}|${REGION}`,
      message:
        '{"Type":"Task","ClusterName":"production","TaskDefinitionFamily":"checkout-api","CpuUtilized":12.5}',
    },
  ])(
    "$logGroup: on its environment's Logs tab, and no app or instance is made",
    async (example: { logGroup: string; key: string; message: string }) => {
      await deliver([logRecord(example.logGroup, example.message)]);

      const rows: Array<JSONObject> = rowsOf(example.logGroup);
      const found: CloudResource = environment(example.key);

      expect(rows).toHaveLength(1);
      expect(rows[0]!["body"]).toBe(example.message);
      expect(isOnEnvironmentLogsTab(found, rows[0]!)).toBe(true);
      // The connection's telemetry service is the rows' service, as before.
      expect(
        (rows[0]!["attributes"] as JSONObject)["resource.service.name"],
      ).toBe(SERVICE_NAME);

      expect(findOrCreate).toHaveBeenCalledTimes(1);
      expect(recordApp).not.toHaveBeenCalled();
      expect(findAppId).not.toHaveBeenCalled();
      expect(recordRevision).not.toHaveBeenCalled();
      expect(recordInstance).not.toHaveBeenCalled();
    },
  );

  test("one delivery of every kind: each group's rows on its own environment's tab, and on no other's", async () => {
    await deliver([
      logRecord(APP_RUNNER_GROUP, "GET /cart 200"),
      logRecord(BEANSTALK_GROUP, "GET /cart 200"),
      logRecord(ECS_TASK_GROUP, "listening on :8080"),
      logRecord(ECS_INSIGHTS_GROUP, '{"Type":"Cluster"}'),
      logRecord(LAMBDA_GROUP, "START RequestId: 1 Version: $LATEST"),
    ]);

    const appRunner: CloudResource = environment(
      `aws_app_runner|${ACCOUNT_ID}|${REGION}`,
    );
    const beanstalk: CloudResource = environment(
      `aws_elastic_beanstalk|${ACCOUNT_ID}|${REGION}`,
    );
    const ecs: CloudResource = environment(`aws_ecs|${ACCOUNT_ID}|${REGION}`);

    // Three environments, ECS's found once for its two groups; no function's.
    expect([...environments.keys()].sort()).toEqual(
      [
        `aws_app_runner|${ACCOUNT_ID}|${REGION}`,
        `aws_ecs|${ACCOUNT_ID}|${REGION}`,
        `aws_elastic_beanstalk|${ACCOUNT_ID}|${REGION}`,
      ].sort(),
    );

    const tabsOf: (row: JSONObject) => Array<string> = (
      row: JSONObject,
    ): Array<string> => {
      return [
        ["App Runner", appRunner],
        ["Elastic Beanstalk", beanstalk],
        ["ECS", ecs],
      ]
        .filter(([, found]: Array<string | CloudResource>): boolean => {
          return isOnEnvironmentLogsTab(found as CloudResource, row);
        })
        .map(([name]: Array<string | CloudResource>): string => {
          return name as string;
        });
    };

    expect(rowsOf(APP_RUNNER_GROUP).map(tabsOf)).toEqual([["App Runner"]]);
    expect(rowsOf(BEANSTALK_GROUP).map(tabsOf)).toEqual([
      ["Elastic Beanstalk"],
    ]);
    expect(rowsOf(ECS_TASK_GROUP).map(tabsOf)).toEqual([["ECS"]]);
    expect(rowsOf(ECS_INSIGHTS_GROUP).map(tabsOf)).toEqual([["ECS"]]);
    // A function's logs are Serverless's: no App Platforms environment's.
    expect(rowsOf(LAMBDA_GROUP).map(tabsOf)).toEqual([[]]);

    expect(recordApp).not.toHaveBeenCalled();
    expect(recordInstance).not.toHaveBeenCalled();
  });

  test("an App Runner service's, a Beanstalk environment's and an ECS cluster's rows stay on the resource's own Logs tab in Cloud", async () => {
    await deliver([
      logRecord(APP_RUNNER_GROUP, "GET /cart 200"),
      logRecord(BEANSTALK_GROUP, "GET /cart 200"),
      logRecord(ECS_INSIGHTS_GROUP, '{"Type":"Cluster"}'),
    ]);

    for (const logGroup of [
      APP_RUNNER_GROUP,
      BEANSTALK_GROUP,
      ECS_INSIGHTS_GROUP,
    ]) {
      const resourceId: string = getAwsLogGroupResource({
        logGroup,
        accountId: ACCOUNT_ID,
        region: REGION,
      })!.resource.providerResourceId;

      expect({
        logGroup,
        resourceIds: rowsOf(logGroup).map((row: JSONObject) => {
          return (row["attributes"] as JSONObject)[
            STORED_CLOUD_RESOURCE_ID_ATTRIBUTE
          ];
        }),
      }).toEqual({ logGroup, resourceIds: [resourceId] });
    }
  });

  test("an ECS task's rows can be narrowed to its family, and a Container Insights row to its cluster", async () => {
    await deliver([
      logRecord(ECS_TASK_GROUP, "listening on :8080"),
      logRecord(ECS_INSIGHTS_GROUP, '{"Type":"Cluster"}'),
    ]);

    expect(rowsOf(ECS_TASK_GROUP)[0]!["attributes"]).toEqual(
      expect.objectContaining({
        "resource.aws.ecs.task.family": "checkout-api",
        "resource.cloud.platform": "aws_ecs",
      }),
    );
    expect(rowsOf(ECS_INSIGHTS_GROUP)[0]!["attributes"]).toEqual(
      expect.objectContaining({
        "resource.aws.ecs.cluster.arn": `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:cluster/production`,
        "resource.cloud.platform": "aws_ecs",
      }),
    );
  });

  test("the app's own logs in that environment still make its app, beside the stream's, on the same tab", async () => {
    await deliver([logRecord(APP_RUNNER_GROUP, "GET /cart 200")]);

    // The app's own SDK sends its logs, set up as Other Cloud Platforms says.
    await OtelLogsIngestService.processLogsFromQueue({
      projectId: PROJECT_ID,
      body: {
        resourceLogs: [
          {
            resource: {
              attributes: [
                ["service.name", "storefront"],
                ["service.version", "1.4.2"],
                ["cloud.provider", "aws"],
                ["cloud.platform", "aws_app_runner"],
                ["cloud.region", REGION],
                ["cloud.account.id", ACCOUNT_ID],
                ["host.name", "ip-169-254-172-2"],
              ].map(([key, value]: Array<string>): JSONObject => {
                return { key: key!, value: { stringValue: value! } };
              }),
            },
            scopeLogs: [
              {
                scope: { name: "storefront" },
                logRecords: [
                  {
                    timeUnixNano: `${MINUTE_START_MS + 2000}000000`,
                    severityNumber: 9,
                    severityText: "INFO",
                    body: { stringValue: "cart loaded" },
                  },
                ],
              },
            ],
          },
        ],
      },
      headers: {},
    } as unknown as TelemetryRequest);

    const found: CloudResource = environment(
      `aws_app_runner|${ACCOUNT_ID}|${REGION}`,
    );

    // One environment for both: the second batch found it in the id cache.
    expect(findOrCreate).toHaveBeenCalledTimes(1);
    expect(recordApp).toHaveBeenCalledTimes(1);
    expect(recordApp).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({ name: "storefront" }),
      }),
    );
    expect(recordInstance).toHaveBeenCalledTimes(1);

    expect(logRows()).toHaveLength(2);
    for (const row of logRows()) {
      expect(isOnEnvironmentLogsTab(found, row)).toBe(true);
    }
  });
});
