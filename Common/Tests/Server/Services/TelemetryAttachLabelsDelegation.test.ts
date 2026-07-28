import * as TelemetryAutoLabels from "../../../Server/Utils/Telemetry/TelemetryAutoLabels";
import CephClusterService from "../../../Server/Services/CephClusterService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../Server/Services/HostService";
import IoTFleetService from "../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import ServerlessFunctionService from "../../../Server/Services/ServerlessFunctionService";
import ServiceService from "../../../Server/Services/ServiceService";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../../Models/DatabaseModels/Service";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach, jest } from "@jest/globals";

/*
 * `attachLabels` was copy-pasted, byte for byte, into twelve services. The
 * label-removal bug therefore existed twelve times over, and a fix applied to
 * one of them would have silently left the other eleven broken.
 *
 * The implementation now lives once in TelemetryAutoLabels. These tests pin
 * every service to that single implementation so a future edit cannot quietly
 * re-inline a divergent copy into one of them.
 */

interface ServiceUnderTest {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attach: (resourceId: ObjectID, labelIds: Array<ObjectID>) => Promise<void>;
  modelType: { new (): BaseModel };
}

const RESOURCE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const LABEL_IDS: Array<ObjectID> = [
  new ObjectID("11111111-1111-4111-8111-111111111111"),
];

const SERVICES: Array<ServiceUnderTest> = [
  {
    name: "HostService",
    modelType: Host,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return HostService.attachLabels({ hostId: id, labelIds: labelIds });
    },
  },
  {
    name: "ServiceService",
    modelType: Service,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return ServiceService.attachLabels({ serviceId: id, labelIds: labelIds });
    },
  },
  {
    name: "DockerHostService",
    modelType: DockerHost,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return DockerHostService.attachLabels({
        dockerHostId: id,
        labelIds: labelIds,
      });
    },
  },
  {
    name: "PodmanHostService",
    modelType: PodmanHost,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return PodmanHostService.attachLabels({
        podmanHostId: id,
        labelIds: labelIds,
      });
    },
  },
  {
    name: "KubernetesClusterService",
    modelType: KubernetesCluster,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return KubernetesClusterService.attachLabels({
        kubernetesClusterId: id,
        labelIds: labelIds,
      });
    },
  },
  {
    name: "ProxmoxClusterService",
    modelType: ProxmoxCluster,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return ProxmoxClusterService.attachLabels({
        proxmoxClusterId: id,
        labelIds: labelIds,
      });
    },
  },
  {
    name: "IoTFleetService",
    modelType: IoTFleet,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return IoTFleetService.attachLabels({
        iotFleetId: id,
        labelIds: labelIds,
      });
    },
  },
  {
    name: "DockerSwarmClusterService",
    modelType: DockerSwarmCluster,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return DockerSwarmClusterService.attachLabels({
        dockerSwarmClusterId: id,
        labelIds: labelIds,
      });
    },
  },
  {
    name: "CephClusterService",
    modelType: CephCluster,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return CephClusterService.attachLabels({
        cephClusterId: id,
        labelIds: labelIds,
      });
    },
  },
  {
    name: "ServerlessFunctionService",
    modelType: ServerlessFunction,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return ServerlessFunctionService.attachLabels({
        serverlessFunctionId: id,
        labelIds: labelIds,
      });
    },
  },
  {
    name: "CloudResourceService",
    modelType: CloudResource,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return CloudResourceService.attachLabels({
        cloudResourceId: id,
        labelIds: labelIds,
      });
    },
  },
  {
    name: "RumApplicationService",
    modelType: RumApplication,
    attach: (id: ObjectID, labelIds: Array<ObjectID>) => {
      return RumApplicationService.attachLabels({
        rumApplicationId: id,
        labelIds: labelIds,
      });
    },
  },
];

describe("telemetry attachLabels delegation", () => {
  test("every telemetry resource type is covered", () => {
    expect(SERVICES).toHaveLength(12);
  });

  describe.each(SERVICES)("$name", (serviceUnderTest: ServiceUnderTest) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let spy: any;

    beforeEach(() => {
      jest.restoreAllMocks();
      spy = jest
        .spyOn(TelemetryAutoLabels, "default")
        .mockResolvedValue(undefined as never);
    });

    test("delegates to the shared attach-once implementation", async () => {
      await serviceUnderTest.attach(RESOURCE_ID, LABEL_IDS);

      expect(spy).toHaveBeenCalledTimes(1);

      const callArgs: {
        modelType: { new (): BaseModel };
        resourceId: ObjectID;
        labelIds: Array<ObjectID>;
      } = spy.mock.calls[0][0];

      expect(callArgs.modelType).toBe(serviceUnderTest.modelType);
      expect(callArgs.resourceId.toString()).toBe(RESOURCE_ID.toString());
      expect(callArgs.labelIds).toBe(LABEL_IDS);
    });
  });

  describe("model support", () => {
    test.each(
      SERVICES.map((serviceUnderTest: ServiceUnderTest) => {
        return [serviceUnderTest.name, serviceUnderTest.modelType] as [
          string,
          { new (): BaseModel },
        ];
      }),
    )(
      "%s's model has the telemetryAppliedLabelIds memo column",
      (_name: string, modelType: { new (): BaseModel }) => {
        const model: BaseModel = new modelType();

        expect(model.getTableColumns().columns).toContain(
          "telemetryAppliedLabelIds",
        );
      },
    );

    test.each(
      SERVICES.map((serviceUnderTest: ServiceUnderTest) => {
        return [serviceUnderTest.name, serviceUnderTest.modelType] as [
          string,
          { new (): BaseModel },
        ];
      }),
    )(
      "%s's memo column is server-managed and not writable over the API",
      (_name: string, modelType: { new (): BaseModel }) => {
        const model: BaseModel = new modelType();
        const accessControl: {
          create: Array<unknown>;
          update: Array<unknown>;
        } = model.getColumnAccessControlFor(
          "telemetryAppliedLabelIds",
        ) as unknown as { create: Array<unknown>; update: Array<unknown> };

        expect(accessControl.create).toHaveLength(0);
        expect(accessControl.update).toHaveLength(0);
      },
    );
  });
});
