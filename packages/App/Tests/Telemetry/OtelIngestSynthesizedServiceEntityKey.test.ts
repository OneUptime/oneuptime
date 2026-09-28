import { ExpressRequest } from "Common/Server/Utils/Express";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { reconcileEntityRegistryThrottled } from "Common/Server/Utils/Telemetry/EntityRegistry";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { keyForService } from "Common/Utils/Telemetry/EntityKey";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A batch whose Service comes from the `x-oneuptime-service-name` header or
 * from a Docker / Podman container name has no `service.name` in its
 * resource, so the heuristic Service resolver cannot see it. The row still
 * belongs to that Service — `primaryEntityId` points at it — so the entity
 * columns have to agree: an empty `serviceEntityKey` hides the row from
 * every per-service read there is.
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

function stringAttributes(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(([key, stringValue]: [string, string]) => {
    return {
      key,
      value: { stringValue } as JSONObject,
    } as JSONObject;
  });
}

/*
 * Echo the name the ladder resolved, exactly as the real
 * `telemetryServiceFromName` does — the assertions below key off it rather
 * than off a hardcoded string, so container-name normalization stays the
 * resolver's business.
 */
function serviceMetadataFor(serviceName: string): TelemetryServiceMetadata {
  return {
    serviceName: serviceName,
    primaryEntityId: ObjectID.generate(),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

class IngestProbe extends OtelIngestBaseService {
  public static resolve(data: {
    req?: ExpressRequest | undefined;
    attributes: JSONArray;
    entityRefs?:
      | Array<{
          type?: string | undefined;
          idKeys?: Array<string> | undefined;
        }>
      | undefined;
  }): Promise<TelemetryServiceMetadata> {
    return this.resolveTelemetryResource({
      req: data.req ?? ({ headers: {} } as unknown as ExpressRequest),
      projectId: PROJECT_ID,
      attributes: data.attributes,
      ...(data.entityRefs ? { entityRefs: data.entityRefs } : {}),
    });
  }
}

function resolvedServiceName(): string {
  const calls: Array<Array<unknown>> = (
    OTelIngestService.telemetryServiceFromName as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls.length).toBe(1);

  return (calls[0]![0] as { serviceName: string }).serviceName;
}

beforeEach(() => {
  jest.clearAllMocks();
  (OTelIngestService.telemetryServiceFromName as jest.Mock).mockImplementation(
    (data: unknown): Promise<TelemetryServiceMetadata> => {
      return Promise.resolve(
        serviceMetadataFor((data as { serviceName: string }).serviceName),
      );
    },
  );
  (reconcileEntityRegistryThrottled as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("service entity key for a Service the resource never names", () => {
  test("a Docker Agent batch is keyed to the container's Service", async () => {
    const metadata: TelemetryServiceMetadata = await IngestProbe.resolve({
      attributes: stringAttributes({
        "container.runtime": "docker",
        "container.name": "elasticsearch-ve-frt-elk2",
        "container.id": "9f2c1b7a4e51",
        "host.name": "h556",
      }),
    });

    const expectedKey: string = keyForService(
      PROJECT_ID.toString(),
      resolvedServiceName(),
    );

    expect(metadata.scalarEntityKeys?.serviceEntityKey).toBe(expectedKey);
    expect(metadata.entityKeys).toContain(expectedKey);

    // The host and container entities it already got are untouched.
    expect(metadata.scalarEntityKeys?.hostEntityKey).toBeTruthy();
    expect(metadata.scalarEntityKeys?.containerEntityKey).toBeTruthy();
  });

  test("an x-oneuptime-service-name batch is keyed to that Service", async () => {
    const metadata: TelemetryServiceMetadata = await IngestProbe.resolve({
      req: {
        headers: { "x-oneuptime-service-name": "checkout" },
      } as unknown as ExpressRequest,
      attributes: stringAttributes({ "host.name": "h556" }),
    });

    expect(metadata.scalarEntityKeys?.serviceEntityKey).toBe(
      keyForService(PROJECT_ID.toString(), "checkout"),
    );
  });

  test("an explicit service.name still wins over the header", async () => {
    const metadata: TelemetryServiceMetadata = await IngestProbe.resolve({
      req: {
        headers: { "x-oneuptime-service-name": "from-header" },
      } as unknown as ExpressRequest,
      attributes: stringAttributes({
        "service.name": "from-resource",
        "host.name": "h556",
      }),
    });

    expect(resolvedServiceName()).toBe("from-resource");
    expect(metadata.scalarEntityKeys?.serviceEntityKey).toBe(
      keyForService(PROJECT_ID.toString(), "from-resource"),
    );
  });

  /*
   * entity_refs are an authority boundary: a producer that declares its
   * entities owns the set, and a synthesized name must not add to it.
   */
  test("entity_refs keep their authority over the synthesized name", async () => {
    const metadata: TelemetryServiceMetadata = await IngestProbe.resolve({
      req: {
        headers: { "x-oneuptime-service-name": "checkout" },
      } as unknown as ExpressRequest,
      attributes: stringAttributes({ "host.name": "h556" }),
      entityRefs: [{ type: "host", idKeys: ["host.name"] }],
    });

    expect(metadata.scalarEntityKeys?.serviceEntityKey).toBe("");
    expect(metadata.entityKeys).not.toContain(
      keyForService(PROJECT_ID.toString(), "checkout"),
    );
  });
});
