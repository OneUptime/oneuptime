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
  AzureDiagnosticDecoded,
  decodeAzureDiagnosticEvents,
} from "../../FeatureSet/Telemetry/Utils/AzureEventHubs/AzureDiagnosticRecords";
import {
  CloudLoggingEntry,
  buildCloudLoggingResourceLogs,
  readCloudLoggingEntry,
} from "../../FeatureSet/Telemetry/Utils/GcpPubSub/CloudLoggingEntries";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import {
  buildMetricsPayloads,
  connectionResourceAttributes,
  resolveCloudResourceOf,
  stringAttribute,
} from "Common/Server/Utils/CloudConnection/CloudMetricPayload";
import { MetricPointType } from "Common/Models/AnalyticsModels/Metric";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  CONNECTION_ID,
  MINUTE_MS,
  SUBSCRIPTION,
  VAULT_ID,
  VM_ID,
  eventOf,
  metricRecord,
  streamContext,
  vaultAuditRecord,
} from "./Helpers/AzureDiagnosticEvents";
import {
  PROJECT,
  cloudFunctionEntry,
  cloudRunRequestEntry,
  computeSyslogEntry,
} from "./Helpers/FakePubSub";

/*
 * AZURE'S AND GOOGLE CLOUD'S STREAMS THROUGH THE REAL INGEST.
 *
 * What the Azure reader queues (AzureDiagnosticRecords) and what the
 * Pub/Sub endpoint queues (CloudLoggingEntries) go through the ingest a
 * queued OTLP export goes through - OtelMetricsIngestService and
 * OtelLogsIngestService, their walks and row builders, with only
 * discovery, service resolution, rule loads and the writer replaced - and
 * land as:
 *
 *   - an Azure key metric's rows in the very series the connection's read
 *     writes for the resource - their name, point type and attributes -
 *     filed under the very Cloud Resource the read files it under;
 *   - log rows carrying their resource's id (resource.cloud.resource_id,
 *     what a resource's Logs page filters on), its subscription or project
 *     and region, and their severity; a Google Cloud entry's trace and span
 *     too, and a Cloud Functions function's logs the function's in
 *     Serverless.
 *
 * `jest` is the global one.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

let rowsByTarget: Map<FanInInsertTarget, Array<JSONObject>>;
let discoveredResources: Array<CloudMonitoredResource>;
let serverlessAttributes: Array<JSONArray>;

function serviceMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: "Production Azure",
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

async function ingestMetrics(
  resourceMetrics: Array<JSONObject>,
): Promise<void> {
  await OtelMetricsIngestService.processMetricsFromQueue({
    projectId: PROJECT_ID,
    body: { resourceMetrics },
    headers: {},
  } as unknown as TelemetryRequest);
}

async function ingestLogs(resourceLogs: Array<JSONObject>): Promise<void> {
  await OtelLogsIngestService.processLogsFromQueue({
    projectId: PROJECT_ID,
    body: { resourceLogs },
    headers: {},
  } as unknown as TelemetryRequest);
}

function decodeAzure(records: Array<JSONObject>): AzureDiagnosticDecoded {
  return decodeAzureDiagnosticEvents({
    records: [{ offset: 0, timestampMs: MINUTE_MS, value: eventOf(records) }],
    context: streamContext(),
    namespaceRegion: "eastus",
    observedAtMs: MINUTE_MS + 120_000,
  });
}

function gcpResourceLogs(entry: JSONObject): JSONObject {
  const read: CloudLoggingEntry = readCloudLoggingEntry(entry)!;

  return buildCloudLoggingResourceLogs({
    entry: read,
    serviceName: "Production Google Cloud",
    connectionId: "44444444-4444-4444-8444-444444444444",
    observedAtMs: MINUTE_MS + 120_000,
  }).resourceLogs;
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

// The read's own export of the VM's CPU, in the azure_monitor receiver's shape.
function readVmCpu(value: number): Array<JSONObject> {
  return buildMetricsPayloads([
    {
      resourceAttributes: [
        ...connectionResourceAttributes({
          serviceName: "Production Azure",
          connectionId: CONNECTION_ID.toString(),
          cloudProvider: CloudProvider.Azure,
        }),
        stringAttribute("azuremonitor.subscription_id", SUBSCRIPTION),
      ],
      metrics: [
        {
          name: "azure_percentage_cpu_average",
          unit: "Percent",
          datapointSets: [
            {
              attributes: [
                stringAttribute("azuremonitor.resource_id", VM_ID),
                stringAttribute("name", "web-01"),
                stringAttribute("type", "Microsoft.Compute/virtualMachines"),
                stringAttribute("resource_group", "rg-Prod"),
                stringAttribute("location", "eastus"),
                stringAttribute("timegrain", "PT1M"),
              ],
              points: [{ timeMs: MINUTE_MS - 60_000, value: value }],
            },
          ],
        },
      ],
    },
  ]);
}

describe("Azure's streamed metrics, through the real metrics ingest", () => {
  test("a streamed key metric and the read's are one series: its name, point type and attributes, the same resource", async () => {
    await ingestMetrics(
      readVmCpu(9)[0]!["resourceMetrics"] as Array<JSONObject>,
    );
    const readResources: number = discoveredResources.length;

    await ingestMetrics(
      decodeAzure([
        metricRecord({
          resourceId: VM_ID,
          metricName: "Percentage CPU",
          total: 50,
          count: 4,
          minimum: 10,
          maximum: 20,
        }),
      ]).resourceMetrics.map((delivered: { resource: JSONObject }) => {
        return delivered.resource;
      }),
    );

    const [read, streamed] = rowsFor(MetricService) as [JSONObject, JSONObject];
    const seriesOf: (row: JSONObject) => JSONObject = (
      row: JSONObject,
    ): JSONObject => {
      const attributes: JSONObject = { ...(row["attributes"] as JSONObject) };

      // Each ingest call's own service id, and which writer wrote it: never which series it is.
      delete attributes["oneuptime.service.id"];
      delete attributes["scope.name"];
      delete attributes["scope.version"];

      return {
        name: row["name"],
        metricPointType: row["metricPointType"],
        attributes,
      };
    };

    expect(seriesOf(streamed)).toEqual(seriesOf(read));
    expect(streamed["metricPointType"]).toBe(MetricPointType.Gauge);
    expect([read["value"], streamed["value"]]).toEqual([9, 12.5]);

    // Filed under the very resource the read files the VM under.
    const polled: CloudMonitoredResource = resolveCloudResourceOf({
      metricName: "azure_percentage_cpu_average",
      resourceAttributes: [
        stringAttribute("azuremonitor.subscription_id", SUBSCRIPTION),
      ],
      datapointAttributes: [stringAttribute("azuremonitor.resource_id", VM_ID)],
    })!;
    expect(
      discoveredResources
        .slice(readResources)
        .map((resource: CloudMonitoredResource) => {
          return buildCloudMonitoredResourceIdentifier(resource);
        }),
    ).toEqual([buildCloudMonitoredResourceIdentifier(polled)]);
  });
});

describe("streamed logs, through the real logs ingest", () => {
  test("an Azure resource log's row is its resource's, with its subscription, region, category and severity", async () => {
    await ingestLogs(
      decodeAzure([vaultAuditRecord()]).resourceLogs.map(
        (delivered: { resource: JSONObject }) => {
          return delivered.resource;
        },
      ),
    );

    const rows: Array<JSONObject> = rowsFor(LogService);
    expect(rows).toHaveLength(1);
    // The ingest says each level in its own word.
    expect(rows[0]!["severityText"]).toBe("Information");
    expect(rows[0]!["body"]).toBe("SecretGet: Success (OK)");
    expect(rows[0]!["attributes"]).toEqual(
      expect.objectContaining({
        "resource.cloud.resource_id": VAULT_ID,
        "resource.cloud.account.id": SUBSCRIPTION,
        "resource.cloud.region": "westeurope",
        "resource.cloud.provider": "azure",
        "azure.category": "AuditEvent",
        "azure.operation.name": "SecretGet",
      }),
    );
  });

  test("a Google Cloud entry's row is its resource's, with its project, region and severity", async () => {
    await ingestLogs([gcpResourceLogs(computeSyslogEntry())]);

    const rows: Array<JSONObject> = rowsFor(LogService);
    const vm: CloudMonitoredResource = resolveCloudResourceOf({
      metricName: "x",
      resourceAttributes: [
        stringAttribute("gcp.resource_type", "gce_instance"),
        stringAttribute("instance_id", "4876543210987654321"),
        stringAttribute("project_id", PROJECT),
        stringAttribute("zone", "us-central1-a"),
      ],
      datapointAttributes: [],
    })!;

    expect(rows).toHaveLength(1);
    expect(rows[0]!["severityText"]).toBe("Error");
    expect(rows[0]!["body"]).toBe(
      "kernel: Out of memory: Killed process 1234 (java)",
    );
    expect(rows[0]!["attributes"]).toEqual(
      expect.objectContaining({
        "resource.cloud.resource_id": vm.providerResourceId,
        "resource.cloud.account.id": PROJECT,
        "resource.cloud.region": "us-central1",
        "resource.gcp.resource_type": "gce_instance",
        "gcp.log.id": "syslog",
      }),
    );
  });

  test("a Google Cloud entry's trace and span are its row's, so it lines up with the trace", async () => {
    await ingestLogs([gcpResourceLogs(cloudRunRequestEntry())]);

    const rows: Array<JSONObject> = rowsFor(LogService);

    expect(rows).toHaveLength(1);
    expect(rows[0]!["traceId"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(rows[0]!["spanId"]).toBe("a1b2c3d4e5f60718");
    expect(rows[0]!["attributes"]).toEqual(
      expect.objectContaining({
        "http.request.method": "GET",
        "resource.gcp.resource_type": "cloud_run_revision",
      }),
    );
    // A Cloud Run log names no platform: no app is made up from the connection's service.
    expect(
      (rows[0]!["attributes"] as JSONObject)["resource.cloud.platform"],
    ).toBeUndefined();
  });

  test("a Cloud Functions function's logs are the function's in Serverless", async () => {
    await ingestLogs([gcpResourceLogs(cloudFunctionEntry())]);

    expect(serverlessAttributes).toHaveLength(1);

    const attributes: Record<string, string> = {};
    for (const attribute of serverlessAttributes[0] as Array<JSONObject>) {
      attributes[attribute["key"] as string] = (
        attribute["value"] as JSONObject
      )["stringValue"] as string;
    }

    expect(attributes["cloud.platform"]).toBe("gcp_cloud_functions");
    expect(attributes["faas.name"]).toBe("charge-card");
    expect(rowsFor(LogService)[0]!["severityText"]).toBe("Warning");
  });
});
