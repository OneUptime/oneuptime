import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Form from "../../../Models/DatabaseModels/Form";
import Host from "../../../Models/DatabaseModels/Host";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  getLevelsOfProduct,
  getProductLevelPermission,
  PRODUCTS_WITH_LEVELS,
  ProductLevel,
  ROLE_FOLLOWED_BY_LEVEL,
} from "../../../Types/Product/ProductLevels";

/*
 * WHAT THE DASHBOARD OFFERS SOMEONE GIVEN A PRODUCT'S LEVEL (#10289).
 *
 * A page decides which buttons it offers by the permissions the reader
 * holds against the model's own lists (PermissionGate), the lists the
 * server checks, product levels and all. So for every product's main
 * record a level is offered exactly what the project-wide role it follows
 * is offered - and locked where that role is locked - and another
 * product's level is locked out of all of it, saying what it takes.
 */

type ModelType = { new (): BaseModel };

const MAIN_RECORDS: Array<[ProductKey, ModelType]> = [
  [ProductKey.Slos, ServiceLevelObjective],
  [ProductKey.Llm, LlmObservabilityConnection],
  [ProductKey.DataObservability, DataCheck],
  [ProductKey.Code, CodeRepository],
  [ProductKey.Inventory, InventoryItem],
  [ProductKey.Services, Service],
  [ProductKey.Databases, DatabaseServer],
  [ProductKey.Queues, MessageQueue],
  [ProductKey.Rum, RumApplication],
  [ProductKey.Hosts, Host],
  [ProductKey.Kubernetes, KubernetesCluster],
  [ProductKey.Docker, DockerHost],
  [ProductKey.DockerSwarm, DockerSwarmCluster],
  [ProductKey.Podman, PodmanHost],
  [ProductKey.Proxmox, ProxmoxCluster],
  [ProductKey.OpenStack, OpenStackCloud],
  [ProductKey.VMware, VMwareVCenter],
  [ProductKey.Ceph, CephCluster],
  [ProductKey.StorageArrays, StorageArray],
  [ProductKey.Network, NetworkDevice],
  [ProductKey.IoT, IoTFleet],
  [ProductKey.Cloud, CloudAccount],
  [ProductKey.AppPlatforms, CloudApp],
  [ProductKey.Serverless, ServerlessFunction],
  [ProductKey.Dashboards, Dashboard],
  [ProductKey.Forms, Form],
];

const ACTIONS: Array<ModelAction> = [
  ModelAction.Read,
  ModelAction.Create,
  ModelAction.Update,
  ModelAction.Delete,
];

function checkAs(
  permissions: Array<Permission>,
  modelType: ModelType,
  action: ModelAction,
): PermissionGateResult {
  permissionsForTest = permissions;
  PermissionGate.clearPermissionPropsCache();

  return PermissionGate.check(new modelType(), action);
}

beforeEach(() => {
  permissionsForTest = [];
  PermissionGate.clearPermissionPropsCache();
});

describe("a page offers a product's level what it offers the role the level follows", () => {
  test("every product with levels is here", () => {
    expect(
      MAIN_RECORDS.map(([product]: [ProductKey, ModelType]): ProductKey => {
        return product;
      }),
    ).toEqual([...PRODUCTS_WITH_LEVELS]);
  });

  test.each(
    MAIN_RECORDS.flatMap(
      ([product, modelType]: [ProductKey, ModelType]): Array<
        [string, ModelType, ProductLevel, Permission]
      > => {
        return getLevelsOfProduct(product).map(
          (
            level: ProductLevel,
          ): [string, ModelType, ProductLevel, Permission] => {
            const permission: Permission = getProductLevelPermission(
              product,
              level,
            )!;

            return [
              PermissionHelper.getTitle(permission),
              modelType,
              level,
              permission,
            ];
          },
        );
      },
    ),
  )(
    "%s",
    (
      _title: string,
      modelType: ModelType,
      level: ProductLevel,
      permission: Permission,
    ) => {
      for (const action of ACTIONS) {
        expect({
          action,
          isAllowed: checkAs([permission], modelType, action).isAllowed,
        }).toEqual({
          action,
          isAllowed: checkAs([ROLE_FOLLOWED_BY_LEVEL[level]], modelType, action)
            .isAllowed,
        });
      }

      // A level reads its product's records, whatever the level.
      expect(checkAs([permission], modelType, ModelAction.Read).isAllowed).toBe(
        true,
      );
    },
  );
});

describe("a page locks a product's level out of everything else", () => {
  test("Cloud Admin is offered nothing on Network's devices, and is told what it takes", () => {
    for (const action of ACTIONS) {
      const result: PermissionGateResult = checkAs(
        [Permission.CloudAdmin],
        NetworkDevice,
        action,
      );

      expect({ action, isAllowed: result.isAllowed }).toEqual({
        action,
        isAllowed: false,
      });
      expect(result.disabledReason || "").not.toBe("");
    }
  });

  test("Network Viewer reads devices, and Add, Edit and Delete are locked", () => {
    expect(
      checkAs([Permission.NetworkViewer], NetworkDevice, ModelAction.Read)
        .isAllowed,
    ).toBe(true);

    for (const action of [
      ModelAction.Create,
      ModelAction.Update,
      ModelAction.Delete,
    ]) {
      expect({
        action,
        isAllowed: checkAs([Permission.NetworkViewer], NetworkDevice, action)
          .isAllowed,
      }).toEqual({ action, isAllowed: false });
    }
  });

  test("Cloud Admin connects a cloud; Cloud Member works with accounts and is locked out of connections", () => {
    expect(
      checkAs([Permission.CloudAdmin], CloudConnection, ModelAction.Create)
        .isAllowed,
    ).toBe(true);
    expect(
      checkAs([Permission.CloudMember], CloudConnection, ModelAction.Create)
        .isAllowed,
    ).toBe(false);
    expect(
      checkAs([Permission.CloudMember], CloudAccount, ModelAction.Create)
        .isAllowed,
    ).toBe(true);
  });

  test("no product's level is offered a product without levels, or the project's own permissions", () => {
    const everyLevel: Array<Permission> = PRODUCTS_WITH_LEVELS.flatMap(
      (product: ProductKey): Array<Permission> => {
        return getLevelsOfProduct(product).map(
          (level: ProductLevel): Permission => {
            return getProductLevelPermission(product, level)!;
          },
        );
      },
    );

    for (const modelType of [Monitor, TeamPermission]) {
      for (const action of ACTIONS) {
        expect({
          model: new modelType().tableName,
          action,
          isAllowed: checkAs(everyLevel, modelType, action).isAllowed,
        }).toEqual({
          model: new modelType().tableName,
          action,
          isAllowed: false,
        });
      }
    }
  });
});
