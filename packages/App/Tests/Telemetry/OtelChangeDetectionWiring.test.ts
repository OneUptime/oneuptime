import { ExpressRequest } from "Common/Server/Utils/Express";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryChangeDetector from "Common/Server/Utils/Telemetry/ChangeDetection/TelemetryChangeDetector";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";

/*
 * Every resource block the ingest workers resolve is handed to the change
 * detector - with what the block resolved to, its raw attributes, its
 * cluster and when it arrived - and resolving never waits for the
 * detector, nor fails with it. TelemetryChangeDetector.test.ts covers what
 * the detector records.
 */

jest.mock("Common/Server/Utils/Telemetry/EntityRegistry", () => {
  return {
    __esModule: true,
    reconcileEntityRegistryThrottled: jest.fn(),
  };
});

jest.mock("Common/Server/Services/OpenTelemetryIngestService", () => {
  return {
    __esModule: true,
    emptyScalarEntityKeys: jest.fn(() => {
      return {
        serviceEntityKey: "",
        hostEntityKey: "",
        k8sPodEntityKey: "",
        k8sNodeEntityKey: "",
        k8sClusterEntityKey: "",
        containerEntityKey: "",
      };
    }),
    default: {
      telemetryServiceFromName: jest.fn(),
      buildResourceMetadataForNonService: jest.fn(),
    },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "checkout",
  primaryEntityId: ObjectID.generate(),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

function stringAttributes(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(([key, stringValue]: [string, string]) => {
    return {
      key,
      value: { stringValue } as JSONObject,
    } as JSONObject;
  });
}

class IngestProbe extends OtelIngestBaseService {
  public static resolve(data: {
    attributes: JSONArray;
    req?: JSONObject;
    kubernetesClusterId?: ObjectID | null;
  }): Promise<TelemetryServiceMetadata> {
    return this.resolveTelemetryResource({
      req: (data.req || {}) as unknown as ExpressRequest,
      projectId: PROJECT_ID,
      attributes: data.attributes,
      kubernetesClusterId: data.kubernetesClusterId ?? null,
    });
  }
}

let observeSpy: jest.SpiedFunction<
  typeof TelemetryChangeDetector.observeResource
>;

beforeEach(() => {
  jest.clearAllMocks();
  (OTelIngestService.telemetryServiceFromName as jest.Mock).mockResolvedValue({
    ...SERVICE_METADATA,
  } as never);
  observeSpy = jest
    .spyOn(TelemetryChangeDetector, "observeResource")
    .mockImplementation(() => {
      return undefined;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OtelIngestBaseService change detection wiring", () => {
  test("hands every resolved block to the change detector", async () => {
    const attributes: JSONArray = stringAttributes({
      "service.name": "checkout",
      "service.version": "2.3.1",
      "k8s.deployment.name": "checkout",
      "k8s.replicaset.name": "checkout-7d4f9c",
    });
    const receivedAt: Date = new Date("2026-10-19T09:58:30.000Z");

    const resolved: TelemetryServiceMetadata = await IngestProbe.resolve({
      attributes,
      req: { receivedAt } as unknown as JSONObject,
      kubernetesClusterId: CLUSTER_ID,
    });

    expect(observeSpy).toHaveBeenCalledTimes(1);
    const call: Parameters<typeof TelemetryChangeDetector.observeResource>[0] =
      observeSpy.mock.calls[0]![0];

    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.metadata).toBe(resolved);
    expect(call.metadata.primaryEntityId).toBe(
      SERVICE_METADATA.primaryEntityId,
    );
    expect(call.attributes).toBe(attributes);
    expect(call.kubernetesClusterId).toBe(CLUSTER_ID);
    expect(call.observedAt).toBe(receivedAt);
  });

  test("a queue worker's string arrival time is passed on as it is", async () => {
    await IngestProbe.resolve({
      attributes: stringAttributes({ "service.name": "checkout" }),
      req: { receivedAt: "2026-10-19T09:58:30.000Z" },
    });

    expect(observeSpy.mock.calls[0]![0].observedAt).toBe(
      "2026-10-19T09:58:30.000Z",
    );
  });

  test("a request with no arrival time passes none, and no cluster", async () => {
    await IngestProbe.resolve({
      attributes: stringAttributes({ "service.name": "checkout" }),
    });

    expect(observeSpy.mock.calls[0]![0].observedAt).toBeUndefined();
    expect(observeSpy.mock.calls[0]![0].kubernetesClusterId).toBeNull();
  });

  test("resolving never waits for, nor fails with, the detector", async () => {
    observeSpy.mockRestore();
    const observe: jest.SpiedFunction<typeof TelemetryChangeDetector.observe> =
      jest.spyOn(TelemetryChangeDetector, "observe").mockImplementation(() => {
        // Never settles: resolving must not be waiting on it.
        return new Promise<void>((): void => {
          // Never resolved.
        });
      });

    await expect(
      IngestProbe.resolve({
        attributes: stringAttributes({
          "service.name": "checkout",
          "service.version": "2.3.1",
        }),
      }),
    ).resolves.toMatchObject({ serviceName: "checkout" });
    expect(observe).toHaveBeenCalledTimes(1);

    observe.mockRejectedValue(new Error("Redis is down") as never);

    await expect(
      IngestProbe.resolve({
        attributes: stringAttributes({ "service.name": "checkout" }),
      }),
    ).resolves.toMatchObject({ serviceName: "checkout" });
  });
});
