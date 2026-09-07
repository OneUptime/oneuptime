jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import VMwareTelemetryIngestService from "../../FeatureSet/Telemetry/Services/VMwareTelemetryIngestService";
import VMwareSourceService from "Common/Server/Services/VMwareSourceService";
import VMwareResourceService from "Common/Server/Services/VMwareResourceService";
import OpenTelemetryIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONArray, JSONObject } from "Common/Types/JSON";

const PROJECT: ObjectID = ObjectID.generate();
const SOURCE: ObjectID = ObjectID.generate();
const TIME: string = String((Date.now() - 60000) * 1e6);
function payload(sourceId: string = "prod"): JSONArray {
  return [
    {
      resource: {
        attributes: [
          {
            key: "oneuptime.vmware.source.id",
            value: { stringValue: sourceId },
          },
          {
            key: "oneuptime.vmware.resource.id",
            value: { stringValue: "vm-uuid" },
          },
          {
            key: "oneuptime.vmware.resource.type",
            value: { stringValue: "vm" },
          },
          {
            key: "oneuptime.vmware.resource.name",
            value: { stringValue: "api" },
          },
          {
            key: "oneuptime.vmware.resource.observed",
            value: { boolValue: true },
          },
          {
            key: "service.name",
            value: { stringValue: "collector-should-not-create-a-service" },
          },
          {
            key: "host.name",
            value: { stringValue: "parent-esxi-not-a-generic-host" },
          },
        ],
      },
      scopeMetrics: [
        {
          metrics: [
            {
              name: "oneuptime.vmware.resource.state",
              unit: "1",
              gauge: { dataPoints: [{ timeUnixNano: TIME, asDouble: 1 }] },
            },
            {
              name: "oneuptime.vmware.vm.cpu.utilization",
              unit: "%",
              gauge: { dataPoints: [{ timeUnixNano: TIME, asDouble: 0 }] },
            },
          ],
        },
      ],
    },
  ];
}
function mockPersistence(archived: boolean = false): void {
  jest
    .spyOn(VMwareSourceService, "ingestSnapshot")
    .mockResolvedValue({ id: SOURCE, isArchived: archived });
  jest.spyOn(VMwareResourceService, "bulkUpsert").mockResolvedValue(undefined);
  jest
    .spyOn(OpenTelemetryIngestService, "buildResourceMetadataForNonService")
    .mockResolvedValue({
      serviceName: "vmware/prod",
      primaryEntityId: SOURCE,
      primaryEntityType: ServiceType.VMwareSource,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });
}
afterEach(() => {
  jest.restoreAllMocks();
});

describe("VMware OTLP ingestion integration", () => {
  it("writes once per source and batch and keeps the authenticated project", async () => {
    mockPersistence();
    const data: JSONArray = [...payload(), ...payload()];
    const result: Map<string, TelemetryServiceMetadata> =
      await VMwareTelemetryIngestService.ingest(PROJECT, data);
    expect(VMwareSourceService.ingestSnapshot).toHaveBeenCalledTimes(1);
    expect(VMwareSourceService.ingestSnapshot).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ sourceIdentifier: "prod" }),
    );
    expect(VMwareResourceService.bulkUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        sourceId: SOURCE,
        resources: [expect.objectContaining({ resourceIdentifier: "vm-uuid" })],
      }),
    );
    expect(result.get("prod")?.primaryEntityId).toEqual(SOURCE);
  });
  it("does not mutate archived inventory or resurrect a deleted source", async () => {
    mockPersistence(true);
    await VMwareTelemetryIngestService.ingest(PROJECT, payload());
    expect(VMwareResourceService.bulkUpsert).not.toHaveBeenCalled();
    jest.mocked(VMwareSourceService.ingestSnapshot).mockResolvedValue(null);
    expect(
      (await VMwareTelemetryIngestService.ingest(PROJECT, payload())).size,
    ).toBe(0);
  });
  it("keeps routing mappings independent when different collectors share resource IDs", async () => {
    mockPersistence();
    await VMwareTelemetryIngestService.ingest(PROJECT, [
      ...payload("prod"),
      ...payload("secondary"),
    ]);
    expect(VMwareSourceService.ingestSnapshot).toHaveBeenCalledTimes(2);
  });
  it("does no inventory work for unrelated OTLP", async () => {
    mockPersistence();
    const result: Map<string, TelemetryServiceMetadata> =
      await VMwareTelemetryIngestService.ingest(PROJECT, [
        { resource: { attributes: [] }, scopeMetrics: [] },
      ]);
    expect(result.size).toBe(0);
    expect(VMwareSourceService.ingestSnapshot).not.toHaveBeenCalled();
  });
  it("drives the real ingest loop without phantom services/hosts and preserves native metric values/attributes", async () => {
    mockPersistence();
    const captured: Array<JSONObject> = [];
    const ingest: any = OtelMetricsIngestService;
    const discovery: Array<string> = [
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
      "autoDiscoverIoTFleet",
      "resolveTelemetryResource",
    ];
    for (const method of discovery) {
      jest.spyOn(ingest, method).mockResolvedValue(null);
    }
    jest
      .spyOn(ingest, "submitMetricsBuffer")
      .mockImplementation((...args: Array<unknown>): Promise<void> => {
        const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
        captured.push(...rows.splice(0, rows.length));
        return Promise.resolve();
      });
    jest
      .spyOn(MetricPipelineRuleService, "loadRules")
      .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as any);
    await OtelMetricsIngestService.processMetricsFromQueue({
      projectId: PROJECT,
      headers: {},
      body: { resourceMetrics: payload() },
    } as unknown as TelemetryRequest);
    expect(captured).toHaveLength(2);
    expect(captured[1]!["value"]).toBe(0);
    for (const row of captured) {
      expect(row["projectId"]).toBe(PROJECT.toString());
      expect(row["primaryEntityId"]).toBe(SOURCE.toString());
      expect(row["primaryEntityType"]).toBe(ServiceType.VMwareSource);
      expect(
        (row["attributes"] as JSONObject)[
          "resource.oneuptime.vmware.resource.id"
        ],
      ).toBe("vm-uuid");
    }
    for (const method of discovery) {
      expect(ingest[method]).not.toHaveBeenCalled();
    }
  });
});
