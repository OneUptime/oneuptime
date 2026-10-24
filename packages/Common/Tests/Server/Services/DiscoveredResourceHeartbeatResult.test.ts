jest.mock("../../../Server/Utils/PasswordHash", () => {
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

import CephClusterService from "../../../Server/Services/CephClusterService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../Server/Services/HostService";
import IoTFleetService from "../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import ServerlessFunctionService from "../../../Server/Services/ServerlessFunctionService";
import StorageArrayService from "../../../Server/Services/StorageArrayService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import ResourceHeartbeat, {
  ResourceHeartbeatResult,
} from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../../Types/ObjectID";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudMonitoredResource,
  CloudMonitoringSource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { afterEach, describe, expect, test } from "@jest/globals";

const AZURE_WEB_APP: CloudMonitoredResource = {
  provider: CloudProvider.Azure,
  source: CloudMonitoringSource.AzureMonitor,
  resourceType: "Microsoft.Web/sites",
  name: "web-01",
  providerResourceId:
    "/subscriptions/1/resourceGroups/rg/providers/Microsoft.Web/sites/web-01",
  accountId: "1",
  region: "westeurope",
  resourceGroup: "rg",
  identityKey:
    "/subscriptions/1/resourcegroups/rg/providers/microsoft.web/sites/web-01",
  telemetryAttributes: {},
};

/*
 * EVERY DISCOVERED KIND'S HEARTBEAT SAYS WHEN ITS ROW IS GONE (issue #5214).
 *
 * ResourceHeartbeat tells a write that found no row apart from one another
 * writer held; the ingest path can act on it only if each kind's heartbeat
 * writer hands it back. Pinned for every one of them, both ways: what the
 * heartbeat found is what the caller gets, unchanged.
 */

type HeartbeatCall = (id: ObjectID) => Promise<ResourceHeartbeatResult>;

const HEARTBEATS: Array<[string, HeartbeatCall]> = [
  [
    "KubernetesClusterService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return KubernetesClusterService.updateLastSeen(id);
    },
  ],
  [
    "ProxmoxClusterService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return ProxmoxClusterService.updateLastSeen(id);
    },
  ],
  [
    "VMwareVCenterService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return VMwareVCenterService.updateLastSeen(id);
    },
  ],
  [
    "IoTFleetService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return IoTFleetService.updateLastSeen(id);
    },
  ],
  [
    "DockerSwarmClusterService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return DockerSwarmClusterService.updateLastSeen(id);
    },
  ],
  [
    "CephClusterService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return CephClusterService.updateLastSeen(id);
    },
  ],
  [
    "StorageArrayService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return StorageArrayService.updateLastSeen(id);
    },
  ],
  [
    "ServerlessFunctionService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return ServerlessFunctionService.updateLastSeen(id);
    },
  ],
  [
    "CloudResourceService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return CloudResourceService.updateLastSeen(id);
    },
  ],
  [
    "CloudResourceService.recordMonitoredResourceSighting",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return CloudResourceService.recordMonitoredResourceSighting({
        cloudResourceId: id,
        resource: AZURE_WEB_APP,
      });
    },
  ],
  [
    "RumApplicationService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return RumApplicationService.updateLastSeen(id);
    },
  ],
  [
    "DockerHostService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return DockerHostService.updateLastSeen(id);
    },
  ],
  [
    "PodmanHostService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return PodmanHostService.updateLastSeen(id);
    },
  ],
  [
    "HostService.updateLastSeen",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return HostService.updateLastSeen(id);
    },
  ],
  [
    "DatabaseServerService.recordCollectorHeartbeat",
    (id: ObjectID): Promise<ResourceHeartbeatResult> => {
      return DatabaseServerService.recordCollectorHeartbeat(id);
    },
  ],
];

describe("each discovered kind's heartbeat hands back what it found", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(HEARTBEATS)(
    "%s: a row that is gone",
    async (_name: string, heartbeat: HeartbeatCall) => {
      const write: jest.SpyInstance = jest
        .spyOn(ResourceHeartbeat, "write")
        .mockResolvedValue({ isRowGone: true });
      const id: ObjectID = ObjectID.generate();

      await expect(heartbeat(id)).resolves.toEqual({ isRowGone: true });

      expect(write).toHaveBeenCalledTimes(1);
      expect((write.mock.calls[0]![0] as { id: ObjectID }).id.toString()).toBe(
        id.toString(),
      );
    },
  );

  test.each(HEARTBEATS)(
    "%s: a row that is there",
    async (_name: string, heartbeat: HeartbeatCall) => {
      jest
        .spyOn(ResourceHeartbeat, "write")
        .mockResolvedValue({ isRowGone: false });
      jest
        .spyOn(
          DatabaseServerService as unknown as {
            reconcileAfterHeartbeat: () => Promise<void>;
          },
          "reconcileAfterHeartbeat",
        )
        .mockResolvedValue(undefined);

      await expect(heartbeat(ObjectID.generate())).resolves.toEqual({
        isRowGone: false,
      });
    },
  );

  test("a database whose row is gone is not reconciled - there is nothing to reconcile", async () => {
    jest.spyOn(ResourceHeartbeat, "write").mockResolvedValue({
      isRowGone: true,
    });
    const reconcile: jest.SpyInstance = jest
      .spyOn(
        DatabaseServerService as unknown as {
          reconcileAfterHeartbeat: () => Promise<void>;
        },
        "reconcileAfterHeartbeat",
      )
      .mockResolvedValue(undefined);

    await DatabaseServerService.recordCollectorHeartbeat(ObjectID.generate());

    expect(reconcile).not.toHaveBeenCalled();
  });

  test("a database whose row is there is reconciled as before", async () => {
    jest.spyOn(ResourceHeartbeat, "write").mockResolvedValue({
      isRowGone: false,
    });
    const reconcile: jest.SpyInstance = jest
      .spyOn(
        DatabaseServerService as unknown as {
          reconcileAfterHeartbeat: () => Promise<void>;
        },
        "reconcileAfterHeartbeat",
      )
      .mockResolvedValue(undefined);

    await DatabaseServerService.recordCollectorHeartbeat(ObjectID.generate(), {
      dbSystem: "postgresql",
    });

    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
