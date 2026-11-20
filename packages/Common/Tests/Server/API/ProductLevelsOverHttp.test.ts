jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("isolated-vm", () => {
  return {};
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CephClusterService from "../../../Server/Services/CephClusterService";
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import CloudAppService from "../../../Server/Services/CloudAppService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import DashboardService from "../../../Server/Services/DashboardService";
import DataCheckService from "../../../Server/Services/DataCheckService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import FormService from "../../../Server/Services/FormService";
import HostService from "../../../Server/Services/HostService";
import InventoryItemService from "../../../Server/Services/InventoryItemService";
import IoTFleetService from "../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import LlmObservabilityConnectionService from "../../../Server/Services/LlmObservabilityConnectionService";
import MessageQueueService from "../../../Server/Services/MessageQueueService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import ServerlessFunctionService from "../../../Server/Services/ServerlessFunctionService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import ServiceService from "../../../Server/Services/ServiceService";
import StorageArrayService from "../../../Server/Services/StorageArrayService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  getLevelsOfProduct,
  getProductLevelPermission,
  PRODUCTS_WITH_LEVELS,
  ProductLevel,
  ROLE_FOLLOWED_BY_LEVEL,
} from "../../../Types/Product/ProductLevels";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONE PRODUCT, AT A LEVEL, THROUGH THE ROUTES THE APP SERVES (#10289).
 *
 * "Admin of Cloud, view-only on Network Monitoring, nothing on App
 * Platforms, and not a project administrator." A product level is a
 * project-wide role kept to one product's records (Types/Product/
 * ProductLevels). Here every request goes over HTTP through Express's body
 * parser, the CRUD routes the App mounts for each product's main record
 * (BaseAPI), the permission layer and the error handler, into tables held in
 * memory (DashboardRequestsOverHttp, InMemoryRepository). For every product
 * that has levels:
 *
 *   - each level lists, creates, changes and deletes the product's records
 *     exactly as the project-wide role it follows does - the same answer,
 *     word for word, whether it is let through or refused;
 *   - no level of another product does any of it, nor a member of the
 *     project with no level at all: they are refused alike.
 *
 * ProductLevelsEscalationOverHttp.test.ts holds a product's admin away from
 * the project's own records and from handing on more than they hold.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10289000-0000-4000-8000-000000000001",
);
const ROW_ID: string = "10289000-0000-4000-8000-0000000000a1";

interface ProductRecords {
  product: ProductKey;
  // The product's main record: the one its first page lists.
  path: string;
  service: DatabaseService<BaseModel>;
}

const asService: (service: unknown) => DatabaseService<BaseModel> = (
  service: unknown,
): DatabaseService<BaseModel> => {
  return service as DatabaseService<BaseModel>;
};

const PRODUCT_RECORDS: Array<ProductRecords> = [
  {
    product: ProductKey.Slos,
    path: "/service-level-objective",
    service: asService(ServiceLevelObjectiveService),
  },
  {
    product: ProductKey.Llm,
    path: "/llm-observability-connection",
    service: asService(LlmObservabilityConnectionService),
  },
  {
    product: ProductKey.DataObservability,
    path: "/data-check",
    service: asService(DataCheckService),
  },
  {
    product: ProductKey.Code,
    path: "/code-repository",
    service: asService(CodeRepositoryService),
  },
  {
    product: ProductKey.Inventory,
    path: "/inventory-item",
    service: asService(InventoryItemService),
  },
  {
    product: ProductKey.Services,
    path: "/service",
    service: asService(ServiceService),
  },
  {
    product: ProductKey.Databases,
    path: "/database-server",
    service: asService(DatabaseServerService),
  },
  {
    product: ProductKey.Queues,
    path: "/message-queue",
    service: asService(MessageQueueService),
  },
  {
    product: ProductKey.Rum,
    path: "/rum-application",
    service: asService(RumApplicationService),
  },
  { product: ProductKey.Hosts, path: "/host", service: asService(HostService) },
  {
    product: ProductKey.Kubernetes,
    path: "/kubernetes-cluster",
    service: asService(KubernetesClusterService),
  },
  {
    product: ProductKey.Docker,
    path: "/docker-host",
    service: asService(DockerHostService),
  },
  {
    product: ProductKey.DockerSwarm,
    path: "/docker-swarm-cluster",
    service: asService(DockerSwarmClusterService),
  },
  {
    product: ProductKey.Podman,
    path: "/podman-host",
    service: asService(PodmanHostService),
  },
  {
    product: ProductKey.Proxmox,
    path: "/proxmox-cluster",
    service: asService(ProxmoxClusterService),
  },
  {
    product: ProductKey.OpenStack,
    path: "/openstack-cloud",
    service: asService(OpenStackCloudService),
  },
  {
    product: ProductKey.VMware,
    path: "/vmware-vcenter",
    service: asService(VMwareVCenterService),
  },
  {
    product: ProductKey.Ceph,
    path: "/ceph-cluster",
    service: asService(CephClusterService),
  },
  {
    product: ProductKey.StorageArrays,
    path: "/storage-array",
    service: asService(StorageArrayService),
  },
  {
    product: ProductKey.Network,
    path: "/network-device",
    service: asService(NetworkDeviceService),
  },
  {
    product: ProductKey.IoT,
    path: "/iot-fleet",
    service: asService(IoTFleetService),
  },
  {
    product: ProductKey.Cloud,
    path: "/cloud-account",
    service: asService(CloudAccountService),
  },
  {
    product: ProductKey.AppPlatforms,
    path: "/cloud-app",
    service: asService(CloudAppService),
  },
  {
    product: ProductKey.Serverless,
    path: "/serverless-function",
    service: asService(ServerlessFunctionService),
  },
  {
    product: ProductKey.Dashboards,
    path: "/dashboard",
    service: asService(DashboardService),
  },
  { product: ProductKey.Forms, path: "/form", service: asService(FormService) },
];

type Operation = "list" | "create" | "update" | "delete";

const OPERATIONS: Array<Operation> = ["list", "create", "update", "delete"];

// The answer a request got: its status, and what a refusal said.
interface Answer {
  status: number;
  said: string;
}

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function answerOf(sent: SentRequest): Answer {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;

  return {
    status: sent.status,
    said:
      sent.status === 200
        ? ""
        : String(answer["error"] || answer["message"] || ""),
  };
}

// One request, as `permissions`, against a table holding one row of its own.
async function sendAs(
  permissions: Array<Permission>,
  records: ProductRecords,
  operation: Operation,
): Promise<Answer> {
  caller = callerWith(permissions);

  useInMemoryTable(records.service, [
    {
      _id: ROW_ID,
      projectId: PROJECT_ID.toString(),
      name: "the row",
    },
  ]);

  switch (operation) {
    case "list":
      return answerOf(
        await server.request("POST", `/api${records.path}/get-list`, {
          query: {},
          select: { _id: true },
          limit: 10,
          skip: 0,
        }),
      );
    case "create":
      return answerOf(
        await server.request("POST", `/api${records.path}`, {
          data: { projectId: PROJECT_ID.toString(), name: "a new one" },
        }),
      );
    case "update":
      return answerOf(
        await server.request("PUT", `/api${records.path}/${ROW_ID}`, {
          data: { name: "renamed" },
        }),
      );
    case "delete":
      return answerOf(
        await server.request("DELETE", `/api${records.path}/${ROW_ID}`),
      );
    default:
      throw new Error(`No operation ${operation}`);
  }
}

// A refusal of the permission layer: the record is not touched.
const REFUSED: number = 422;

beforeAll(async () => {
  // The session guards, as a signed-in member passes them.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);

  server = new DashboardRequestsOverHttp();
  await server.start(
    PRODUCT_RECORDS.map((records: ProductRecords) => {
      return new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
        records.service.modelType as { new (): BaseModel },
        records.service,
      ).getRouter();
    }),
  );
});

afterAll(async () => {
  await server.stop();
  jest.restoreAllMocks();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectOwner]);

  stubProjectDirectory({});
  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
});

afterEach(() => {
  jest.restoreAllMocks();

  // The session guards stay as the routers were built with them.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
});

describe("the products this suite reaches", () => {
  test("are every product with levels, each through its main record's own route", () => {
    expect(
      PRODUCT_RECORDS.map((records: ProductRecords): ProductKey => {
        return records.product;
      }),
    ).toEqual([...PRODUCTS_WITH_LEVELS]);

    for (const records of PRODUCT_RECORDS) {
      expect(records.service.getModel().getCrudApiPath()?.toString()).toBe(
        records.path,
      );
    }
  });
});

// Every product's every level, against the role it follows.
const LEVEL_CASES: Array<[string, ProductRecords, ProductLevel, Permission]> =
  PRODUCT_RECORDS.flatMap(
    (
      records: ProductRecords,
    ): Array<[string, ProductRecords, ProductLevel, Permission]> => {
      return getLevelsOfProduct(records.product).map(
        (
          level: ProductLevel,
        ): [string, ProductRecords, ProductLevel, Permission] => {
          const permission: Permission = getProductLevelPermission(
            records.product,
            level,
          )!;

          return [
            PermissionHelper.getTitle(permission),
            records,
            level,
            permission,
          ];
        },
      );
    },
  );

describe("a product's level does on its records what the role it follows does", () => {
  test.each(LEVEL_CASES)(
    "%s lists, creates, changes and deletes them as the project-wide role does",
    async (
      _title: string,
      records: ProductRecords,
      level: ProductLevel,
      permission: Permission,
    ) => {
      for (const operation of OPERATIONS) {
        const asLevel: Answer = await sendAs([permission], records, operation);
        const asRole: Answer = await sendAs(
          [ROLE_FOLLOWED_BY_LEVEL[level]],
          records,
          operation,
        );

        expect({ operation, answer: asLevel }).toEqual({
          operation,
          answer: asRole,
        });
      }
    },
  );

  test.each(
    PRODUCT_RECORDS.map(
      (records: ProductRecords): [ProductKey, ProductRecords] => {
        return [records.product, records];
      },
    ),
  )(
    "%s's Viewer lists its records, and creates, changes and deletes none",
    async (_product: ProductKey, records: ProductRecords) => {
      const viewer: Permission = getProductLevelPermission(
        records.product,
        ProductLevel.Viewer,
      )!;

      const listed: Answer = await sendAs([viewer], records, "list");

      expect(listed).toEqual({ status: 200, said: "" });
      expect(
        (
          (server.requests[server.requests.length - 1]!.answer as JSONObject)[
            "data"
          ] as Array<JSONObject>
        ).map((row: JSONObject): unknown => {
          return row["_id"];
        }),
      ).toEqual([ROW_ID]);

      for (const operation of [
        "create",
        "update",
        "delete",
      ] as Array<Operation>) {
        const answer: Answer = await sendAs([viewer], records, operation);

        expect({ operation, status: answer.status }).toEqual({
          operation,
          status: REFUSED,
        });
      }
    },
  );
});

describe("nothing of a product reaches another product's records", () => {
  /*
   * Each product's records against the Admin of the next product in the
   * menu (the last against the first's): the strongest level, of a product
   * that is not this one.
   */
  const OTHER_PRODUCT_CASES: Array<
    [string, string, ProductRecords, Permission]
  > = PRODUCT_RECORDS.map(
    (
      records: ProductRecords,
      index: number,
    ): [string, string, ProductRecords, Permission] => {
      const other: ProductRecords =
        PRODUCT_RECORDS[(index + 1) % PRODUCT_RECORDS.length]!;
      const admin: Permission = getProductLevelPermission(
        other.product,
        ProductLevel.Admin,
      )!;

      return [
        PermissionHelper.getTitle(admin),
        records.product,
        records,
        admin,
      ];
    },
  );

  test.each(OTHER_PRODUCT_CASES)(
    "%s is refused on %s's records, as a member with no level is",
    async (
      _title: string,
      _product: string,
      records: ProductRecords,
      admin: Permission,
    ) => {
      for (const operation of OPERATIONS) {
        const asOtherAdmin: Answer = await sendAs([admin], records, operation);
        const asMemberWithNoLevel: Answer = await sendAs(
          [Permission.ProjectUser],
          records,
          operation,
        );

        expect({ operation, status: asOtherAdmin.status }).toEqual({
          operation,
          status: REFUSED,
        });
        expect({ operation, answer: asOtherAdmin }).toEqual({
          operation,
          answer: asMemberWithNoLevel,
        });
      }
    },
  );

  test("every product's every level at once reaches no product's records but those levels' own", async () => {
    const cloud: ProductRecords = PRODUCT_RECORDS.find(
      (records: ProductRecords): boolean => {
        return records.product === ProductKey.Cloud;
      },
    )!;
    const everyOtherLevel: Array<Permission> = PRODUCT_RECORDS.filter(
      (records: ProductRecords): boolean => {
        return records.product !== ProductKey.Cloud;
      },
    ).flatMap((records: ProductRecords): Array<Permission> => {
      return getLevelsOfProduct(records.product).map(
        (level: ProductLevel): Permission => {
          return getProductLevelPermission(records.product, level)!;
        },
      );
    });

    for (const operation of OPERATIONS) {
      expect({
        operation,
        status: (await sendAs(everyOtherLevel, cloud, operation)).status,
      }).toEqual({ operation, status: REFUSED });
    }
  });
});

describe("what #10289 asks for: Admin of Cloud, view-only on Network, nothing on App Platforms", () => {
  const recordsOf: (product: ProductKey) => ProductRecords = (
    product: ProductKey,
  ): ProductRecords => {
    return PRODUCT_RECORDS.find((records: ProductRecords): boolean => {
      return records.product === product;
    })!;
  };

  const PERSON: Array<Permission> = [
    Permission.CloudAdmin,
    Permission.NetworkViewer,
  ];

  test("they list, create, change and delete Cloud's accounts", async () => {
    for (const operation of OPERATIONS) {
      const answer: Answer = await sendAs(
        PERSON,
        recordsOf(ProductKey.Cloud),
        operation,
      );

      expect({ operation, answer }).toEqual({
        operation,
        answer: await sendAs(
          [Permission.ProjectAdmin],
          recordsOf(ProductKey.Cloud),
          operation,
        ),
      });
      expect({ operation, refused: answer.status === REFUSED }).toEqual({
        operation,
        refused: false,
      });
    }
  });

  test("they read Network's devices and change none of them", async () => {
    expect(
      (await sendAs(PERSON, recordsOf(ProductKey.Network), "list")).status,
    ).toBe(200);

    for (const operation of [
      "create",
      "update",
      "delete",
    ] as Array<Operation>) {
      expect({
        operation,
        status: (await sendAs(PERSON, recordsOf(ProductKey.Network), operation))
          .status,
      }).toEqual({ operation, status: REFUSED });
    }
  });

  test("they read nothing of App Platforms', nor of any other product", async () => {
    for (const product of PRODUCTS_WITH_LEVELS) {
      if (product === ProductKey.Cloud || product === ProductKey.Network) {
        continue;
      }

      expect({
        product,
        status: (await sendAs(PERSON, recordsOf(product), "list")).status,
      }).toEqual({ product, status: REFUSED });
    }
  });
});
