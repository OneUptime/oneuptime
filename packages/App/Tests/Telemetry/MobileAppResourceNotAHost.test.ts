/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced - same idiom as
 * CollectorAgentVersionIngest.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Replaced WITH A FACTORY - an
 * automock would still require, and type-check, the real file.
 */
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
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { HEARTBEAT_ROW_PRESENT } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import InventoryItem, {
  ExtractedEntity,
} from "Common/Server/Utils/Telemetry/TelemetryEntity";
import Host from "Common/Models/DatabaseModels/Host";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import EntityType from "Common/Types/Telemetry/EntityType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A kiosk fleet puts each Android device in Inventory by naming it in
 * `host.name` on the app's resource (docs/rum/android-setup). The app's
 * telemetry must still be its RUM application's, and no Host may be minted
 * for the device:
 *
 *   - OpenTelemetry Android stamps `os.type=linux` on every resource, which
 *     is the very signal the phantom-host gate trusts, so a device that
 *     named itself in host.name became a Host - in the Hosts list, with no
 *     host metrics for its page to draw;
 *   - selectPrimaryEntity reads a hostId before a rumApplicationId, so that
 *     Host then owned the app's spans, logs and exceptions, and the RUM
 *     application's own pages went empty.
 *
 * Both host paths are covered - autoDiscoverHost (traces, logs and
 * metrics) and the metrics batch enrichment that writes a host's facts in
 * one UPDATE - and so is what must keep working: a machine's own resource
 * still makes a Host, make and model and all, and the kiosk still reaches
 * Inventory as a host entity with the facts its SDK reports.
 *
 * All Postgres/Redis access is mocked; the attribute walk runs for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();
const HOST_ROW_ID: ObjectID = ObjectID.generate();

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function attributes(pairs: Record<string, string>): JSONArray {
  return Object.entries(pairs).map(([key, value]: [string, string]) => {
    return stringAttribute(key, value);
  }) as JSONArray;
}

/*
 * The resource OpenTelemetry Android 1.8 builds for an app (its
 * AndroidResource, over the Java SDK's default resource), plus the two keys
 * a kiosk fleet adds: the device's name in host.name and a label for the
 * store it stands in.
 */
const KIOSK_APP_RESOURCE: Record<string, string> = {
  "service.name": "kiosk-ordering",
  "service.version": "4.2.0",
  "telemetry.sdk.name": "opentelemetry",
  "telemetry.sdk.language": "java",
  "telemetry.sdk.version": "1.8.1-alpha",
  "device.model.identifier": "Elo-i3-15",
  "device.model.name": "Elo-i3-15",
  "device.manufacturer": "Elo Touch Solutions",
  "os.name": "Android",
  "os.type": "linux",
  "os.version": "13",
  "os.build_id": "TQ3A.230901.001",
  "os.description": "Android Version 13 (Build TQ3A.230901.001 API level 33)",
  "android.os.api_level": "33",
  "app.installation.id": "0f5c8e2a-6a39-4f0e-9d0e-6c1b7f2a9e41",
  "host.name": "store-0412-kiosk-02",
  "oneuptime.label.store": "0412",
};

// A Windows machine's collector resource, make and model stamped on it.
const WINDOWS_HOST_RESOURCE: Record<string, string> = {
  "host.name": "pos-0412-01",
  "os.type": "windows",
  "device.manufacturer": "Dell Inc.",
  "device.model.name": "OptiPlex 7090",
  "host.serial_number": "7XYZ123",
};

describe("A mobile app's resource never makes a Host", () => {
  let findOrCreateSpy: jest.SpiedFunction<
    typeof HostService.findOrCreateByHostIdentifier
  >;
  // How autoDiscoverHost finds or creates the Host row for a host.name.
  let resolveHostIdSpy: jest.SpiedFunction<
    (...args: Array<unknown>) => unknown
  >;

  beforeEach(() => {
    OtelIngestBaseService.clearInProcessMemos();

    const host: Host = new Host();
    host._id = HOST_ROW_ID.toString();
    host.projectId = PROJECT_ID;

    findOrCreateSpy = jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockResolvedValue(host);
    jest
      .spyOn(HostService, "updateLastSeen")
      .mockResolvedValue(HEARTBEAT_ROW_PRESENT);
    jest.spyOn(HostService, "attachLabels").mockResolvedValue(undefined);
    jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockResolvedValue([]);
    jest.spyOn(baseService, "shouldRunMaintenance").mockResolvedValue(false);
    resolveHostIdSpy = jest
      .spyOn(baseService, "resolveDiscoveredResourceId")
      .mockResolvedValue(HOST_ROW_ID.toString()) as jest.SpiedFunction<
      (...args: Array<unknown>) => unknown
    >;
    jest
      .spyOn(baseService, "tryLinkHostToProxmoxGuest")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OtelIngestBaseService.clearInProcessMemos();
  });

  describe("autoDiscoverHost", () => {
    test("a kiosk app that names its device in host.name gets no Host, though its SDK sets os.type", async () => {
      const hostId: ObjectID | null = await baseService["autoDiscoverHost"]({
        projectId: PROJECT_ID,
        attributes: attributes(KIOSK_APP_RESOURCE),
        hasInfraSignal: false,
      });

      expect(hostId).toBeNull();
      expect(resolveHostIdSpy).not.toHaveBeenCalled();
    });

    test("not even when the batch carries system.* metrics", async () => {
      const hostId: ObjectID | null = await baseService["autoDiscoverHost"]({
        projectId: PROJECT_ID,
        attributes: attributes(KIOSK_APP_RESOURCE),
        hasInfraSignal: true,
      });

      expect(hostId).toBeNull();
    });

    test.each([
      ["device.id", { "device.id": "b3f1c2d4-install" }],
      ["device.model.identifier", { "device.model.identifier": "SM-T510" }],
      ["browser.platform", { "browser.platform": "Windows" }],
    ])(
      "a client resource marked by %s with host.name and os.type gets no Host",
      async (_key: string, marker: Record<string, string>) => {
        const hostId: ObjectID | null = await baseService["autoDiscoverHost"]({
          projectId: PROJECT_ID,
          attributes: attributes({
            "service.name": "storefront",
            "host.name": "device-01",
            "os.type": "linux",
            ...marker,
          }),
          hasInfraSignal: false,
        });

        expect(hostId).toBeNull();
        expect(resolveHostIdSpy).not.toHaveBeenCalled();
      },
    );

    test("a machine's own resource still makes a Host, make and model and all", async () => {
      const hostId: ObjectID | null = await baseService["autoDiscoverHost"]({
        projectId: PROJECT_ID,
        attributes: attributes(WINDOWS_HOST_RESOURCE),
        hasInfraSignal: false,
      });

      expect(hostId?.toString()).toBe(HOST_ROW_ID.toString());
      expect(resolveHostIdSpy).toHaveBeenCalledTimes(1);
      expect(resolveHostIdSpy.mock.calls[0]![0]).toMatchObject({
        kindName: "Host",
        identity: "pos-0412-01",
      });
    });
  });

  describe("runBatchHostEnrichment", () => {
    function metricsResource(pairs: Record<string, string>): JSONObject {
      return {
        resource: { attributes: attributes(pairs) },
        scopeMetrics: [
          {
            metrics: [
              {
                name: "system.memory.usage",
                unit: "By",
                sum: {
                  dataPoints: [
                    {
                      asInt: "1073741824",
                      timeUnixNano: `${Date.now()}000000`,
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
    }

    test("a kiosk app's metrics write no Host", async () => {
      await metricsService["runBatchHostEnrichment"]({
        projectId: PROJECT_ID,
        resourceMetrics: [metricsResource(KIOSK_APP_RESOURCE)] as JSONArray,
      });

      expect(findOrCreateSpy).not.toHaveBeenCalled();
      expect(HostService.updateLastSeen).not.toHaveBeenCalled();
    });

    test("a machine's metrics still write its Host", async () => {
      await metricsService["runBatchHostEnrichment"]({
        projectId: PROJECT_ID,
        resourceMetrics: [metricsResource(WINDOWS_HOST_RESOURCE)] as JSONArray,
      });

      expect(findOrCreateSpy).toHaveBeenCalledTimes(1);
      expect(findOrCreateSpy.mock.calls[0]![0]).toMatchObject({
        hostIdentifier: "pos-0412-01",
      });
    });

    test("a machine and a kiosk app in one batch: only the machine is a Host", async () => {
      await metricsService["runBatchHostEnrichment"]({
        projectId: PROJECT_ID,
        resourceMetrics: [
          metricsResource(KIOSK_APP_RESOURCE),
          metricsResource(WINDOWS_HOST_RESOURCE),
        ] as JSONArray,
      });

      expect(findOrCreateSpy).toHaveBeenCalledTimes(1);
      expect(findOrCreateSpy.mock.calls[0]![0]).toMatchObject({
        hostIdentifier: "pos-0412-01",
      });
    });
  });
});

describe("A kiosk app's telemetry belongs to its RUM application", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    OtelIngestBaseService.clearInProcessMemos();
  });

  function request(): ExpressRequest {
    return { headers: {} } as unknown as ExpressRequest;
  }

  test("its batch is filed under the RUM application, not a Host", async () => {
    const metadata: TelemetryServiceMetadata = {
      serviceName: "kiosk-ordering",
      primaryEntityId: RUM_APPLICATION_ID,
      primaryEntityType: ServiceType.RealUserMonitor,
      dataRententionInDays: 15,
    } as TelemetryServiceMetadata;

    const buildSpy: jest.SpiedFunction<
      typeof OTelIngestService.buildResourceMetadataForNonService
    > = jest
      .spyOn(OTelIngestService, "buildResourceMetadataForNonService")
      .mockResolvedValue(metadata);

    /*
     * A Host row for the device's host.name exists, or would be created:
     * the lookup answers with one. Before the fix autoDiscoverHost handed
     * it on, and selectPrimaryEntity, which reads a hostId first, filed the
     * batch under it.
     */
    OtelIngestBaseService.clearInProcessMemos();
    jest
      .spyOn(baseService, "resolveDiscoveredResourceId")
      .mockResolvedValue(HOST_ROW_ID.toString());
    jest.spyOn(baseService, "shouldRunMaintenance").mockResolvedValue(false);

    // What the ingest walk hands selectPrimaryEntity for this resource.
    const hostId: ObjectID | null = await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: attributes(KIOSK_APP_RESOURCE),
      hasInfraSignal: false,
    });

    const selected: TelemetryServiceMetadata = await baseService[
      "selectPrimaryEntity"
    ]({
      req: request(),
      attributes: attributes(KIOSK_APP_RESOURCE),
      projectId: PROJECT_ID,
      hostId: hostId,
      rumApplicationId: RUM_APPLICATION_ID,
    });

    expect(hostId).toBeNull();
    expect(selected.primaryEntityType).toBe(ServiceType.RealUserMonitor);
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy.mock.calls[0]![0]).toMatchObject({
      resourceId: RUM_APPLICATION_ID,
      primaryEntityType: ServiceType.RealUserMonitor,
    });
  });

  test("the device still reaches Inventory as a host entity, with what its SDK reports", () => {
    const entities: Array<ExtractedEntity> = InventoryItem.extractEntities({
      projectId: PROJECT_ID.toString(),
      attributes: { ...KIOSK_APP_RESOURCE },
    });

    const host: ExtractedEntity | undefined = entities.find(
      (entity: ExtractedEntity): boolean => {
        return entity.entityType === EntityType.Host;
      },
    );

    expect(host).toBeDefined();
    expect(host!.identifyingAttributes).toEqual({
      "host.name": "store-0412-kiosk-02",
    });
    expect(host!.descriptiveAttributes).toMatchObject({
      "device.manufacturer": "Elo Touch Solutions",
      "device.model.name": "Elo-i3-15",
      "os.name": "Android",
      "os.version": "13",
      "os.type": "linux",
    });
  });
});
