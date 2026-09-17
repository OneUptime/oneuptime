import { ExpressRequest } from "Common/Server/Utils/Express";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import HostService from "Common/Server/Services/HostService";
import { reconcileEntityRegistryThrottled } from "Common/Server/Utils/Telemetry/EntityRegistry";
import { RetiredEntityIdentity } from "Common/Server/Utils/Telemetry/TelemetryEntity";
import ObjectID from "Common/Types/ObjectID";
import EntityType from "Common/Types/Telemetry/EntityType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { keyForHost } from "Common/Utils/Telemetry/EntityKey";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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

function metadata(): TelemetryServiceMetadata {
  return {
    serviceName: "checkout",
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
    attributes: JSONArray;
    entityRefs?:
      | Array<{
          type?: string | undefined;
          idKeys?: Array<string> | undefined;
        }>
      | undefined;
  }): Promise<TelemetryServiceMetadata> {
    return this.resolveTelemetryResource({
      req: {} as ExpressRequest,
      projectId: PROJECT_ID,
      attributes: data.attributes,
      ...(data.entityRefs ? { entityRefs: data.entityRefs } : {}),
    });
  }

  public static discoverHost(attributes: JSONArray): Promise<ObjectID | null> {
    return this.autoDiscoverHost({
      projectId: PROJECT_ID,
      attributes,
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  (OTelIngestService.telemetryServiceFromName as jest.Mock).mockResolvedValue(
    metadata(),
  );
  (reconcileEntityRegistryThrottled as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OtelIngestBaseService inventory retirement wiring", () => {
  test.each([
    ["pod name", "k8s.pod.name", "checkout-7d9f"],
    ["pod UID", "k8s.pod.uid", "pod-uid-1"],
    ["node name", "k8s.node.name", "worker-1"],
    ["node UID", "k8s.node.uid", "node-uid-1"],
    ["cluster name", "k8s.cluster.name", "prod-us"],
    ["namespace name", "k8s.namespace.name", "shop"],
    ["deployment name", "k8s.deployment.name", "checkout"],
  ])(
    "typed Host auto-discovery rejects a Kubernetes %s identity",
    async (_label: string, identityKey: string, identityValue: string) => {
      const createHostSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(HostService, "findOrCreateByHostIdentifier")
        .mockRejectedValue(new Error("typed Host creation must not run"));

      await expect(
        IngestProbe.discoverHost(
          stringAttributes({
            "host.name": "checkout-7d9f",
            "os.type": "linux",
            [identityKey]: identityValue,
          }),
        ),
      ).resolves.toBeNull();
      expect(createHostSpy).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["pod name", "k8s.pod.name", "checkout-7d9f"],
    ["pod UID", "k8s.pod.uid", "pod-uid-1"],
    ["node name", "k8s.node.name", "worker-1"],
    ["node UID", "k8s.node.uid", "node-uid-1"],
  ])(
    "forwards the exact suppressed Host key for a Kubernetes %s",
    async (_label: string, identityKey: string, identityValue: string) => {
      const hostName: string = "checkout-7d9f";

      const result: TelemetryServiceMetadata = await IngestProbe.resolve({
        attributes: stringAttributes({
          "service.name": "checkout",
          "host.name": hostName,
          [identityKey]: identityValue,
        }),
      });

      expect(result.scalarEntityKeys?.hostEntityKey).toBe("");
      const call: {
        projectId: ObjectID;
        entities: Array<{ entityType: EntityType }>;
        retiredEntities?: Array<RetiredEntityIdentity> | undefined;
      } = (reconcileEntityRegistryThrottled as jest.Mock).mock.calls[0]![0] as {
        projectId: ObjectID;
        entities: Array<{ entityType: EntityType }>;
        retiredEntities?: Array<RetiredEntityIdentity> | undefined;
      };

      expect(call.projectId).toBe(PROJECT_ID);
      expect(call.entities).not.toContainEqual(
        expect.objectContaining({ entityType: EntityType.Host }),
      );
      expect(call.retiredEntities).toEqual([
        {
          entityType: EntityType.Host,
          entityKey: keyForHost(PROJECT_ID.toString(), hostName),
          identifyingAttributes: { "host.name": hostName },
        },
      ]);
    },
  );

  test("does not request retirement for a standalone Host", async () => {
    await IngestProbe.resolve({
      attributes: stringAttributes({
        "service.name": "checkout",
        "host.name": "web-1",
        "os.type": "linux",
      }),
    });

    expect(reconcileEntityRegistryThrottled).toHaveBeenCalledWith(
      expect.objectContaining({
        retiredEntities: undefined,
        entities: expect.arrayContaining([
          expect.objectContaining({ entityType: EntityType.Host }),
        ]),
      }),
    );
  });

  test("does not retire an explicit Host entity_ref on Kubernetes", async () => {
    await IngestProbe.resolve({
      attributes: stringAttributes({
        "service.name": "checkout",
        "host.name": "checkout-7d9f",
        "k8s.pod.uid": "pod-uid-1",
      }),
      entityRefs: [{ type: "host", idKeys: ["host.name"] }],
    });

    expect(reconcileEntityRegistryThrottled).toHaveBeenCalledWith(
      expect.objectContaining({
        retiredEntities: undefined,
        entities: [
          expect.objectContaining({
            entityType: EntityType.Host,
            entityKey: keyForHost(PROJECT_ID.toString(), "checkout-7d9f"),
          }),
        ],
      }),
    );
  });

  test("does not infer retirement across any non-empty entity_refs boundary", async () => {
    await IngestProbe.resolve({
      attributes: stringAttributes({
        "service.name": "checkout",
        "host.name": "checkout-7d9f",
        "k8s.pod.uid": "pod-uid-1",
      }),
      entityRefs: [{ type: "service", idKeys: ["service.name"] }],
    });

    expect(reconcileEntityRegistryThrottled).toHaveBeenCalledWith(
      expect.objectContaining({ retiredEntities: undefined }),
    );
  });

  test("registry maintenance stays fire-and-forget", async () => {
    (reconcileEntityRegistryThrottled as jest.Mock).mockImplementation(
      (): Promise<void> => {
        return new Promise<void>(() => {});
      },
    );

    await expect(
      IngestProbe.resolve({
        attributes: stringAttributes({
          "service.name": "checkout",
          "host.name": "checkout-7d9f",
          "k8s.pod.uid": "pod-uid-1",
        }),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        serviceName: "checkout",
      }),
    );
  });
});
