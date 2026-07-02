import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import IoTDeviceService from "Common/Server/Services/IoTDeviceService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { describe, expect, test } from "@jest/globals";

/*
 * The IoT snapshot buffering must run AFTER the metric pipeline rules:
 * a datapoint the user drops (Drop/Filter/Sample rule) must not keep
 * mutating the IoTDevice inventory or the IoTFleet count columns.
 * Regression guard for the ordering in processMetricsAsync — buffering
 * used to happen before applyRules, so dropped metrics still wrote to
 * Postgres.
 *
 * Everything that would touch a real backend (auto-discovery, service
 * resolution, ClickHouse flush, Postgres writebacks) is mocked; the
 * OTLP walk, the rule engine and the IoT fold/flush logic run for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const FLEET_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
];

function noRules(): MetricRulesForProject {
  return { projectRules: [], rulesByServiceId: new Map() };
}

function dropEverythingRules(): MetricRulesForProject {
  // A Drop rule with no filters matches (and drops) every datapoint.
  const rule: MetricPipelineRule = new MetricPipelineRule();
  rule.ruleType = MetricPipelineRuleType.Drop;
  rule.filters = [];
  return { projectRules: [rule], rulesByServiceId: new Map() };
}

function iotMetricsRequest(): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "iot_device_up",
                  unit: "1",
                  gauge: {
                    dataPoints: [
                      {
                        asInt: 1,
                        timeUnixNano: `${Date.now()}000000`,
                        attributes: [
                          {
                            key: "device.id",
                            value: { stringValue: "sensor-1" },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

function setupIngestMocks(rules: MetricRulesForProject): {
  bulkUpsert: jest.SpyInstance;
  bulkUpdateLatestMetrics: jest.SpyInstance;
  updateLastSeen: jest.SpyInstance;
} {
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest.spyOn(service, "flushMetricsBuffer").mockResolvedValue(undefined);

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  jest.spyOn(service, "autoDiscoverIoTFleet").mockResolvedValue(FLEET_ID);

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "iot-gateway",
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue(rules);
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as any);

  const bulkUpsert: jest.SpyInstance = jest
    .spyOn(IoTDeviceService, "bulkUpsert")
    .mockResolvedValue(undefined);
  const bulkUpdateLatestMetrics: jest.SpyInstance = jest
    .spyOn(IoTDeviceService, "bulkUpdateLatestMetrics")
    .mockResolvedValue(undefined);
  const updateLastSeen: jest.SpyInstance = jest
    .spyOn(IoTFleetService, "updateLastSeen")
    .mockResolvedValue(undefined as any);

  return { bulkUpsert, bulkUpdateLatestMetrics, updateLastSeen };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IoT snapshot buffering vs metric pipeline rules", () => {
  test("a dropped datapoint does not mutate the device inventory", async () => {
    const spies: ReturnType<typeof setupIngestMocks> = setupIngestMocks(
      dropEverythingRules(),
    );

    await OtelMetricsIngestService.processMetricsFromQueue(iotMetricsRequest());

    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.bulkUpdateLatestMetrics).not.toHaveBeenCalled();
    expect(spies.updateLastSeen).not.toHaveBeenCalled();
  });

  test("a kept datapoint still reaches the device inventory and fleet counts", async () => {
    const spies: ReturnType<typeof setupIngestMocks> =
      setupIngestMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(iotMetricsRequest());

    expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
    const upsertArgs: {
      projectId: ObjectID;
      iotFleetId: ObjectID;
      devices: Array<{ externalId: string; isUp: boolean | null }>;
    } = spies.bulkUpsert.mock.calls[0]![0];

    expect(upsertArgs.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(upsertArgs.iotFleetId.toString()).toBe(FLEET_ID.toString());
    expect(upsertArgs.devices).toHaveLength(1);
    expect(upsertArgs.devices[0]!.externalId).toBe("sensor-1");
    expect(upsertArgs.devices[0]!.isUp).toBe(true);

    // iot_device_up carries identity → the fleet count columns write too.
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(spies.updateLastSeen.mock.calls[0]![1]).toEqual({
      deviceCount: 1,
      onlineDeviceCount: 1,
    });
  });
});
