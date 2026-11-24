/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it. Nothing here touches password hashing.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestAttribution, {
  TelemetryIngestAttributionResource,
} from "Common/Server/Utils/Telemetry/TelemetryIngestAttribution";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A batch's attribution in the logs ingest (issues #6355, #6386): each
 * resource is offered to it once filed under its service, with how many
 * log records it sent; a resource whose team's or label's budget is used
 * up has its records skipped - none reaches the writer - while the rest of
 * the batch is stored; and the batch is settled once, after its records.
 *
 * Drives the real OTLP walk (processLogsFromQueue) with every backend
 * touchpoint mocked, as OtelLogsDropFilterDeferral does.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CHECKOUT_ID: ObjectID = ObjectID.generate();
const CART_ID: ObjectID = ObjectID.generate();
const TIME_NANO: string = `${Date.UTC(2026, 10, 9, 12, 0, 0, 0)}000000`;

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

function resourceLog(serviceName: string, bodies: Array<string>): JSONObject {
  return {
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: serviceName } },
      ],
    },
    scopeLogs: [
      {
        scope: { name: "otel-lib" },
        logRecords: bodies.map((body: string) => {
          return {
            timeUnixNano: TIME_NANO,
            severityNumber: 9,
            body: { stringValue: body },
            attributes: [],
          };
        }),
      },
    ],
  };
}

// An attribution that drops one service, as a used-up budget would.
class StubAttribution {
  public offered: Array<TelemetryIngestAttributionResource> = [];
  public settled: number = 0;

  public constructor(private readonly dropped: string) {}

  public async admitResource(
    resource: TelemetryIngestAttributionResource,
  ): Promise<boolean> {
    this.offered.push(resource);
    return resource.name !== this.dropped;
  }

  public async settle(): Promise<void> {
    this.settled++;
  }
}

function setupIngestMocks(): Array<JSONObject> {
  const capturedRows: Array<JSONObject> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelLogsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(async (...args: Array<unknown>) => {
      // The resource's own attributes name its service.
      const attributes: Array<JSONObject> = ((
        (args[0] || {}) as { attributes?: Array<JSONObject> }
      ).attributes || []) as Array<JSONObject>;
      const serviceAttribute: JSONObject | undefined = attributes.find(
        (attribute: JSONObject) => {
          return attribute["key"] === "service.name";
        },
      );
      const name: string = String(
        (serviceAttribute?.["value"] as JSONObject | undefined)?.[
          "stringValue"
        ] || "",
      );

      return {
        serviceName: name,
        primaryEntityId: name === "checkout" ? CHECKOUT_ID : CART_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    });

  jest
    .spyOn(service, "submitLogsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      capturedRows.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });
  jest
    .spyOn(service, "submitExceptionsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.splice(0, rows.length);
      return Promise.resolve();
    });

  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);

  return capturedRows;
}

function request(attribution: StubAttribution | null): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceLogs: [
        resourceLog("checkout", ["paid", "shipped", "refunded"]),
        resourceLog("cart", ["added"]),
      ],
    },
    headers: {},
    telemetryIngestAttribution:
      attribution as unknown as TelemetryIngestAttribution | null,
  } as unknown as TelemetryRequest;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the logs ingest and a batch's attribution", () => {
  test("offers each resource with its record count, and settles the batch once", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();
    const attribution: StubAttribution = new StubAttribution("none");

    await OtelLogsIngestService.processLogsFromQueue(request(attribution));

    expect(
      attribution.offered.map(
        (resource: TelemetryIngestAttributionResource) => {
          return [
            resource.name,
            resource.primaryEntityId.toString(),
            resource.primaryEntityType,
            resource.records,
          ];
        },
      ),
    ).toEqual([
      ["checkout", CHECKOUT_ID.toString(), ServiceType.OpenTelemetry, 3],
      ["cart", CART_ID.toString(), ServiceType.OpenTelemetry, 1],
    ]);
    expect(attribution.settled).toBe(1);
    expect(rows).toHaveLength(4);
  });

  test("skips every record of a resource a used-up budget drops, and stores the rest", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();
    const attribution: StubAttribution = new StubAttribution("checkout");

    await OtelLogsIngestService.processLogsFromQueue(request(attribution));

    expect(
      rows.map((row: JSONObject) => {
        return [row["primaryEntityId"], row["body"]];
      }),
    ).toEqual([[CART_ID.toString(), "added"]]);
    expect(attribution.settled).toBe(1);
  });

  test("stores the whole batch, as before, for a project that needs no attribution", async () => {
    const rows: Array<JSONObject> = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(request(null));

    expect(rows).toHaveLength(4);
  });
});
