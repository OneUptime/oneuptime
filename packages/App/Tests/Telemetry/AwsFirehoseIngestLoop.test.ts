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
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import {
  DecodedDelivery,
  decodeFirehoseRecords,
} from "../../FeatureSet/Telemetry/Utils/AwsFirehose/FirehoseRecords";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import {
  OtlpAttribute,
  connectionResourceAttributes,
  kvlistAttribute,
  resolveCloudResourceOf,
  stringAttribute,
} from "Common/Server/Utils/CloudConnection/CloudMetricPayload";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { getAwsLogGroupResource } from "Common/Types/Cloud/CloudLogGroups";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  ACCOUNT_ID,
  MINUTE_START_MS,
  REGION,
  cloudWatchLogsDocument,
  cloudWatchLogsRecord,
  jsonMetricRecord,
  jsonMetricUpdate,
  openTelemetryMetric,
  openTelemetryRecord,
  openTelemetryRequest,
} from "./Helpers/FakeFirehose";

/*
 * A STREAMED DELIVERY THROUGH THE REAL INGEST.
 *
 * What the stream endpoint queues (decodeFirehoseRecords) goes through the
 * ingest a queued OTLP export goes through - OtelMetricsIngestService and
 * OtelLogsIngestService, their walks and row builders, with only discovery,
 * service resolution, rule loads and the writer replaced - and lands as:
 *
 *   - metric rows of a summary - count, sum, minimum and maximum - filed
 *     under the very Cloud Resource a connection's read files the same
 *     resource's polled metrics under (one row, whichever came first), in
 *     the OpenTelemetry 1.0 format and in JSON alike;
 *   - log rows carrying their resource's id (resource.cloud.resource_id,
 *     what a resource's Logs page filters on), its account and Region, the
 *     severity their message says, and - for a function - faas.name, which
 *     makes them the function's in Serverless.
 *
 * `jest` is the global one.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const SERVICE_NAME: string = "Production AWS";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

let rowsByTarget: Map<FanInInsertTarget, Array<JSONObject>>;
let discoveredResources: Array<CloudMonitoredResource>;
let serverlessAttributes: Array<JSONArray>;

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

function rowsFor(target: FanInInsertTarget): Array<JSONObject> {
  return rowsByTarget.get(target) || [];
}

async function decode(records: Array<Buffer>): Promise<DecodedDelivery> {
  return await decodeFirehoseRecords({
    records: records.map((record: Buffer): string => {
      return record.toString("base64");
    }),
    serviceName: SERVICE_NAME,
    connectionId: CONNECTION_ID,
    region: REGION,
    now: new Date(MINUTE_START_MS + 90_000),
    budget: { bytesLeft: 32 * 1024 * 1024, perRecordBytes: 8 * 1024 * 1024 },
  });
}

async function ingest(delivery: DecodedDelivery): Promise<void> {
  if (delivery.resourceMetrics.length > 0) {
    await OtelMetricsIngestService.processMetricsFromQueue({
      projectId: PROJECT_ID,
      body: {
        resourceMetrics: delivery.resourceMetrics.map(
          (delivered: { resource: JSONObject }) => {
            return delivered.resource;
          },
        ),
      },
      headers: {},
    } as unknown as TelemetryRequest);
  }

  if (delivery.resourceLogs.length > 0) {
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
}

beforeEach(() => {
  rowsByTarget = new Map();
  discoveredResources = [];
  serverlessAttributes = [];

  const discoveryMethods: Array<string> = Object.getOwnPropertyNames(
    OtelIngestBaseService,
  ).filter((property: string): boolean => {
    return (
      property.startsWith("autoDiscover") &&
      typeof baseService[property] === "function"
    );
  });

  // What each ingest service would discover, kept for the tests to read.
  const recordCloudResources: (
    ...args: Array<unknown>
  ) => Promise<number> = async (...args: Array<unknown>): Promise<number> => {
    const data: { resources: Array<CloudMonitoredResource> } = args[0] as {
      resources: Array<CloudMonitoredResource>;
    };
    discoveredResources.push(...data.resources);
    return data.resources.length;
  };
  const recordServerless: (...args: Array<unknown>) => Promise<null> = async (
    ...args: Array<unknown>
  ): Promise<null> => {
    serverlessAttributes.push(
      (args[0] as { attributes: JSONArray }).attributes,
    );
    return null;
  };

  for (const ingestService of [
    OtelLogsIngestService,
    OtelMetricsIngestService,
  ]) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const service: Record<string, any> = ingestService as unknown as Record<
      string,
      any
    >;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    for (const method of discoveryMethods) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }

    jest
      .spyOn(service, "autoDiscoverCloudMonitoredResources")
      .mockImplementation(recordCloudResources);
    jest
      .spyOn(service, "autoDiscoverServerless")
      .mockImplementation(recordServerless);
    jest
      .spyOn(service, "resolveTelemetryResource")
      .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
        return serviceMetadata();
      });

    if (ingestService === OtelMetricsIngestService) {
      jest
        .spyOn(service, "runBatchHostEnrichment")
        .mockResolvedValue(undefined);
    }
  }

  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockResolvedValue([]);
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        rowsByTarget.set(target, [...rowsFor(target), ...batch]);
        return { flushed: Promise.resolve() };
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The identity a connection's own read gives the instance from its polled CPU.
function polledInstance(): CloudMonitoredResource {
  const datapoint: Array<OtlpAttribute> = [
    stringAttribute("Namespace", "AWS/EC2"),
    stringAttribute("MetricName", "CPUUtilization"),
    kvlistAttribute("Dimensions", [
      stringAttribute("InstanceId", "i-0abc123def"),
    ]),
  ];

  return resolveCloudResourceOf({
    metricName: "amazonaws.com/AWS/EC2/CPUUtilization",
    resourceAttributes: [
      ...connectionResourceAttributes({
        serviceName: "",
        connectionId: "",
        cloudProvider: CloudProvider.AWS,
      }),
      stringAttribute("cloud.account.id", ACCOUNT_ID),
      stringAttribute("cloud.region", REGION),
    ],
    datapointAttributes: datapoint,
  }) as CloudMonitoredResource;
}

describe("streamed metrics, through the real metrics ingest", () => {
  test.each([
    {
      format: "OpenTelemetry 1.0",
      record: (): Buffer => {
        return openTelemetryRecord([
          openTelemetryRequest([
            openTelemetryMetric({
              namespace: "AWS/EC2",
              metricName: "CPUUtilization",
              dimensions: { InstanceId: "i-0abc123def" },
              count: 4,
              sum: 50,
              min: 10,
              max: 20,
            }),
          ]),
        ]);
      },
    },
    {
      format: "JSON",
      record: (): Buffer => {
        return jsonMetricRecord([
          jsonMetricUpdate({
            namespace: "AWS/EC2",
            metricName: "CPUUtilization",
            dimensions: { InstanceId: "i-0abc123def" },
            value: { max: 20, min: 10, sum: 50, count: 4 },
          }),
        ]);
      },
    },
  ])(
    "$format: one summary row, under the resource the read files the instance under",
    async (example: { format: string; record: () => Buffer }) => {
      await ingest(await decode([example.record()]));

      const rows: Array<JSONObject> = rowsFor(MetricService);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          name: "amazonaws.com/aws/ec2/cpuutilization",
          count: 4,
          sum: 50,
          // A summary's value is its sum; Avg reads sum / count.
          value: 50,
          summaryQuantiles: [0, 1],
          summaryValues: [10, 20],
        }),
      );
      expect(rows[0]!["attributes"]).toEqual(
        expect.objectContaining({
          Namespace: "AWS/EC2",
          "Dimensions.InstanceId": "i-0abc123def",
          "resource.cloud.account.id": ACCOUNT_ID,
          "resource.cloud.region": REGION,
          "resource.service.name": SERVICE_NAME,
          "resource.oneuptime.cloud.connection.id": CONNECTION_ID,
        }),
      );

      expect(
        discoveredResources.map((resource: CloudMonitoredResource) => {
          return buildCloudMonitoredResourceIdentifier(resource);
        }),
      ).toEqual([buildCloudMonitoredResourceIdentifier(polledInstance())]);
    },
  );
});

describe("streamed logs, through the real logs ingest", () => {
  test("rows carry the function's id, account, Region, severity and faas.name", async () => {
    await ingest(
      await decode([
        cloudWatchLogsRecord(
          cloudWatchLogsDocument({
            logGroup: "/aws/lambda/checkout",
            logStream: "2026/11/04/[$LATEST]abc",
            events: [
              {
                id: "1",
                timestamp: MINUTE_START_MS + 1000,
                message:
                  "2026-11-04T09:59:01.000Z\t0b1d2c3e-1111-2222-3333-444455556666\tERROR\tPayment failed",
              },
              {
                id: "2",
                timestamp: MINUTE_START_MS + 2000,
                message: "[INFO]\t2026-11-04T09:59:02.000Z\treq\tpaid",
              },
            ],
          }),
        ),
      ]),
    );

    const rows: Array<JSONObject> = rowsFor(LogService);
    const functionArn: string = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:checkout`;

    expect(rows).toHaveLength(2);
    expect(
      rows.map((row: JSONObject) => {
        return row["severityText"];
      }),
    ).toEqual(["Error", "Information"]);
    expect(rows[0]!["body"]).toContain("Payment failed");

    for (const row of rows) {
      expect(row["attributes"]).toEqual(
        expect.objectContaining({
          "resource.cloud.resource_id": functionArn,
          "resource.cloud.account.id": ACCOUNT_ID,
          "resource.cloud.region": REGION,
          "resource.aws.log.group.name": "/aws/lambda/checkout",
          "resource.faas.name": "checkout",
          "resource.cloud.platform": "aws_lambda",
          "aws.log.stream.name": "2026/11/04/[$LATEST]abc",
        }),
      );
    }

    // The function's id is its Cloud Resource's: what its Logs page filters on.
    expect(
      getAwsLogGroupResource({
        logGroup: "/aws/lambda/checkout",
        accountId: ACCOUNT_ID,
        region: REGION,
      })!.resource.providerResourceId,
    ).toBe(functionArn);

    // Serverless discovery is handed the function's identity.
    const identity: { functionIdentifier: string } | null = baseService[
      "resolveServerlessFunctionIdentity"
    ](serverlessAttributes[0]);

    expect(identity?.functionIdentifier).toBe("checkout");
  });
});
