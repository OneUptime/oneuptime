import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import VMwareResourceAPI from "../../../Server/API/VMwareResourceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import VMwareResourceService, {
  VMwareInventorySummary,
} from "../../../Server/Services/VMwareResourceService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * POST /vmware-resource/inventory-summary/:vcenterId
 *
 * The one custom route the VMware inventory API adds on top of the generic
 * CRUD router. The Dashboard's per-vCenter layout posts an empty body to it
 * and reads the counts back for the sidebar badges (hosts, virtual machines,
 * datastores, clusters, resource pools).
 *
 * The route runs behind UserMiddleware only, so it has to prove its own
 * authorisation: it resolves the vCenter through VMwareVCenterService with
 * the caller's DatabaseCommonInteractionProps, which means the VMwareVCenter
 * model ACL (Permission.ReadVMwareVCenter and friends) decides whether the
 * row is visible at all. A vCenter that is missing and one the caller may
 * not read both come back as the same NotFound — the route must never let a
 * caller enumerate which ids exist.
 *
 * The services are stubbed at their public seams; what is under test is the
 * wiring: which id is parsed, which service is asked, with which props, and
 * what shape is written back.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const INVENTORY_SUMMARY_ROUTE: string =
  "/vmware-resource/inventory-summary/:vcenterId";

const SUMMARY: VMwareInventorySummary = {
  countsByKind: {
    Datacenter: 1,
    Cluster: 2,
    Host: 6,
    VirtualMachine: 43,
    Datastore: 4,
    ResourcePool: 3,
  },
  datacenterCount: 1,
  clusterCount: 2,
  hostCount: 6,
  virtualMachineCount: 40,
  poweredOnVirtualMachineCount: 31,
  virtualMachineTemplateCount: 3,
  datastoreCount: 4,
  resourcePoolCount: 3,
};

interface RouteCall {
  thrown: unknown;
  nextCallCount: number;
}

describe("VMwareResourceAPI", () => {
  let vcenterId: ObjectID;
  let projectId: ObjectID;
  let props: DatabaseCommonInteractionProps;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let findOneById: jest.SpyInstance;
  let getInventorySummary: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new VMwareResourceAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    vcenterId = ObjectID.generate();
    projectId = ObjectID.generate();
    props = {
      isRoot: false,
      userId: ObjectID.generate(),
      tenantId: projectId,
    } as DatabaseCommonInteractionProps;

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);

    findOneById = jest.spyOn(VMwareVCenterService, "findOneById");
    getInventorySummary = jest
      .spyOn(VMwareResourceService, "getInventorySummary")
      .mockResolvedValue(SUMMARY);

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function readableVCenter(): VMwareVCenter {
    const vcenter: VMwareVCenter = new VMwareVCenter();
    vcenter.id = vcenterId;
    vcenter.projectId = projectId;
    return vcenter;
  }

  async function callRoute(
    vcenterIdParam: string | undefined,
  ): Promise<RouteCall> {
    const request: ExpressRequest = {
      params: vcenterIdParam === undefined ? {} : { vcenterId: vcenterIdParam },
      body: {},
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", INVENTORY_SUMMARY_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);

    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    return {
      thrown: calls[0]?.[0],
      nextCallCount: calls.length,
    };
  }

  function sentBody(): JSONObject {
    const calls: Array<Array<unknown>> = (
      Response.sendJsonObjectResponse as jest.Mock
    ).mock.calls as Array<Array<unknown>>;
    expect(calls.length).toBe(1);
    return calls[0]![2] as JSONObject;
  }

  describe("registration", () => {
    test("derives the route from the model's CRUD path and mounts it as POST", () => {
      expect(new VMwareResource().getCrudApiPath()?.toString()).toBe(
        "/vmware-resource",
      );

      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        INVENTORY_SUMMARY_ROUTE,
      );
      expect(route.method).toBe("POST");

      // Not a GET: the UI posts an empty body through ModelAPI headers.
      expect(() => {
        return mockRouter.match("get", INVENTORY_SUMMARY_ROUTE);
      }).toThrow();
    });

    test("is mounted behind UserMiddleware.getUserMiddleware only", () => {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        INVENTORY_SUMMARY_ROUTE,
      );
      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    });

    test("does not keep a Proxmox-shaped cluster route around", () => {
      for (const proxmoxShaped of [
        "/vmware-resource/inventory-summary/:clusterId",
        "/proxmox-resource/inventory-summary/:clusterId",
        "/vmware-vcenter/inventory-summary/:vcenterId",
      ]) {
        expect(() => {
          return mockRouter.match("post", proxmoxShaped);
        }).toThrow();
      }
    });
  });

  describe("vCenter id validation", () => {
    test("rejects a missing id before touching any service", async () => {
      const call: RouteCall = await callRoute(undefined);

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "vCenter ID is required",
      );
      expect(findOneById).not.toHaveBeenCalled();
      expect(getInventorySummary).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("rejects an empty id", async () => {
      const call: RouteCall = await callRoute("");

      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "vCenter ID is required",
      );
      expect(findOneById).not.toHaveBeenCalled();
    });

    test("looks a malformed id up with the caller's props and answers NotFound", async () => {
      /*
       * ObjectID accepts any string, so a malformed id cannot be rejected
       * up front; what matters is that it never reaches the summary query
       * and that the lookup that rejects it runs under the caller's ACL,
       * not as root.
       */
      for (const malformed of ["not-an-id", "1", "' OR 1=1 --"]) {
        jest.clearAllMocks();
        findOneById.mockResolvedValue(null);

        const call: RouteCall = await callRoute(malformed);

        expect(call.nextCallCount).toBe(1);
        expect(call.thrown).toBeInstanceOf(NotFoundException);
        expect(findOneById).toHaveBeenCalledTimes(1);
        const findArgs: JSONObject = findOneById.mock
          .calls[0]![0] as JSONObject;
        expect((findArgs["id"] as ObjectID).toString()).toBe(malformed);
        expect(findArgs["props"]).toBe(props);
        expect(getInventorySummary).not.toHaveBeenCalled();
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      }
    });
  });

  describe("authorisation", () => {
    test("resolves the vCenter with the caller's props so the model ACL applies", async () => {
      findOneById.mockResolvedValue(readableVCenter());

      await callRoute(vcenterId.toString());

      expect(CommonAPI.getDatabaseCommonInteractionProps).toHaveBeenCalledTimes(
        1,
      );
      expect(findOneById).toHaveBeenCalledTimes(1);
      const findArgs: JSONObject = findOneById.mock.calls[0]![0] as JSONObject;
      expect((findArgs["id"] as ObjectID).toString()).toBe(
        vcenterId.toString(),
      );
      expect(findArgs["props"]).toBe(props);
      // Never runs the lookup as root — that is the whole point.
      expect((findArgs["props"] as DatabaseCommonInteractionProps).isRoot).toBe(
        false,
      );
      // Only what is needed to scope the summary is selected.
      expect(findArgs["select"]).toEqual({ _id: true, projectId: true });
    });

    test("answers NotFound for a vCenter that does not exist", async () => {
      findOneById.mockResolvedValue(null);

      const call: RouteCall = await callRoute(vcenterId.toString());

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBeInstanceOf(NotFoundException);
      expect((call.thrown as NotFoundException).message).toBe(
        "vCenter not found",
      );
      expect(getInventorySummary).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("answers the same NotFound for a vCenter the caller may not read", async () => {
      /*
       * The ACL filters unreadable rows out of the read, so an unauthorised
       * caller sees exactly what a caller of a nonexistent id sees.
       */
      findOneById.mockResolvedValue(null);
      const unreadable: RouteCall = await callRoute(vcenterId.toString());

      jest.clearAllMocks();
      findOneById.mockResolvedValue(null);
      const missing: RouteCall = await callRoute(
        ObjectID.generate().toString(),
      );

      expect(unreadable.thrown).toBeInstanceOf(NotFoundException);
      expect(missing.thrown).toBeInstanceOf(NotFoundException);
      expect((unreadable.thrown as NotFoundException).message).toBe(
        (missing.thrown as NotFoundException).message,
      );
    });

    test("answers NotFound when the row came back without a project", async () => {
      const orphan: VMwareVCenter = new VMwareVCenter();
      orphan.id = vcenterId;
      findOneById.mockResolvedValue(orphan);

      const call: RouteCall = await callRoute(vcenterId.toString());

      expect(call.thrown).toBeInstanceOf(NotFoundException);
      expect(getInventorySummary).not.toHaveBeenCalled();
    });
  });

  describe("summary", () => {
    test("scopes the summary to the vCenter's own project, not a caller-supplied one", async () => {
      findOneById.mockResolvedValue(readableVCenter());

      await callRoute(vcenterId.toString());

      expect(getInventorySummary).toHaveBeenCalledTimes(1);
      const summaryArgs: JSONObject = getInventorySummary.mock
        .calls[0]![0] as JSONObject;
      expect((summaryArgs["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((summaryArgs["vmwareVCenterId"] as ObjectID).toString()).toBe(
        vcenterId.toString(),
      );
      expect(Object.keys(summaryArgs).sort()).toEqual([
        "projectId",
        "vmwareVCenterId",
      ]);
    });

    test("returns the per-kind counts plus the convenience fields the layout reads", async () => {
      findOneById.mockResolvedValue(readableVCenter());

      const call: RouteCall = await callRoute(vcenterId.toString());

      expect(call.nextCallCount).toBe(0);
      expect(sentBody()).toEqual({
        countsByKind: {
          Datacenter: 1,
          Cluster: 2,
          Host: 6,
          VirtualMachine: 43,
          Datastore: 4,
          ResourcePool: 3,
        },
        datacenterCount: 1,
        clusterCount: 2,
        hostCount: 6,
        virtualMachineCount: 40,
        poweredOnVirtualMachineCount: 31,
        virtualMachineTemplateCount: 3,
        datastoreCount: 4,
        resourcePoolCount: 3,
      });
    });

    test("uses the VMware kind vocabulary, never Proxmox's", async () => {
      findOneById.mockResolvedValue(readableVCenter());

      await callRoute(vcenterId.toString());

      const body: JSONObject = sentBody();
      for (const proxmoxOnly of [
        "nodeCount",
        "guestCount",
        "storageCount",
        "nodeOnlineCount",
        "guestRunningCount",
      ]) {
        expect(body[proxmoxOnly]).toBeUndefined();
      }
      expect(Object.keys(body["countsByKind"] as JSONObject)).toEqual(
        expect.arrayContaining([
          "Datacenter",
          "Cluster",
          "Host",
          "VirtualMachine",
          "Datastore",
          "ResourcePool",
        ]),
      );
    });

    test("reports zeros for an empty vCenter rather than omitting fields", async () => {
      findOneById.mockResolvedValue(readableVCenter());
      getInventorySummary.mockResolvedValue({
        countsByKind: {},
        datacenterCount: 0,
        clusterCount: 0,
        hostCount: 0,
        virtualMachineCount: 0,
        poweredOnVirtualMachineCount: 0,
        virtualMachineTemplateCount: 0,
        datastoreCount: 0,
        resourcePoolCount: 0,
      } satisfies VMwareInventorySummary);

      await callRoute(vcenterId.toString());

      expect(sentBody()).toEqual({
        countsByKind: {},
        datacenterCount: 0,
        clusterCount: 0,
        hostCount: 0,
        virtualMachineCount: 0,
        poweredOnVirtualMachineCount: 0,
        virtualMachineTemplateCount: 0,
        datastoreCount: 0,
        resourcePoolCount: 0,
      });
    });

    test("hands a service failure to next() instead of answering", async () => {
      findOneById.mockResolvedValue(readableVCenter());
      const failure: Error = new Error("postgres is away");
      getInventorySummary.mockRejectedValue(failure);

      const call: RouteCall = await callRoute(vcenterId.toString());

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBe(failure);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("App/FeatureSet/BaseAPI/Index.ts", () => {
    /*
     * Common tests cannot import App, so the mount is checked as text — the
     * same way OnCallCalendarAPI.test.ts pins its own registration.
     */
    const indexPath: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "App",
      "FeatureSet",
      "BaseAPI",
      "Index.ts",
    );

    const source: string = fs.readFileSync(indexPath, "utf8");

    test("mounts VMwareResourceAPI exactly once", () => {
      expect(source).toContain(
        'import VMwareResourceAPI from "Common/Server/API/VMwareResourceAPI";',
      );

      const mounts: Array<string> =
        source.match(/new VMwareResourceAPI\(\)\.getRouter\(\)/g) || [];
      expect(mounts).toHaveLength(1);

      // Mounted under the app prefix like every other resource API.
      expect(source).toMatch(
        /app\.use\(\s*`\/\$\{APP_NAME\.toLocaleLowerCase\(\)\}`,\s*new VMwareResourceAPI\(\)\.getRouter\(\),?\s*\)/,
      );
    });

    test("mounts the generic CRUD of the six VMware vCenter models once each", () => {
      const models: Array<string> = [
        "VMwareVCenter",
        "VMwareVCenterFeed",
        "VMwareVCenterOwnerRule",
        "VMwareVCenterLabelRule",
        "VMwareVCenterOwnerTeam",
        "VMwareVCenterOwnerUser",
      ];

      for (const model of models) {
        expect(source).toContain(
          `import ${model} from "Common/Models/DatabaseModels/${model}";`,
        );
        expect(source).toContain(
          `import ${model}Service, {\n  Service as ${model}ServiceType,\n} from "Common/Server/Services/${model}Service";`,
        );

        /*
         * One BaseAPI mount per model. Prettier wraps the generic differently
         * per name length, so match on the constructor arguments, which are
         * always `(Model, ModelService)`, optionally split across lines.
         */
        const mount: RegExp = new RegExp(
          `new BaseAPI<\\s*${model},\\s*${model}ServiceType\\s*>\\(\\s*${model},\\s*${model}Service,?\\s*\\)\\.getRouter\\(\\)`,
          "g",
        );

        expect(source.match(mount) || []).toHaveLength(1);
      }
    });

    test("does not mount VMwareResource through a second generic BaseAPI", () => {
      /*
       * VMwareResourceAPI already extends BaseAPI<VMwareResource>; a second
       * generic mount would register the CRUD routes twice.
       */
      expect(source).not.toMatch(
        /new BaseAPI<\s*VMwareResource,\s*VMwareResourceServiceType\s*>/,
      );
    });
  });
});
