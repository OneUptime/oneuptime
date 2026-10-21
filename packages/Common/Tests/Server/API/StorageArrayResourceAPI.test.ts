import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import StorageArrayResourceAPI from "../../../Server/API/StorageArrayResourceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import StorageArrayResourceService, {
  StorageArrayInventorySummary,
} from "../../../Server/Services/StorageArrayResourceService";
import StorageArrayService from "../../../Server/Services/StorageArrayService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
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
 * POST /storage-array-resource/inventory-summary/:storageArrayId
 *
 * The one custom route the storage array inventory API adds on top of the
 * generic CRUD router. The Dashboard's per-array layout posts an empty body
 * to it and reads the counts back for the sidebar badges (volumes, hosts,
 * pods, hardware, directories, file systems, buckets).
 *
 * The route runs behind UserMiddleware only, so it has to prove its own
 * authorisation: it resolves the array through StorageArrayService with the
 * caller's DatabaseCommonInteractionProps, which means the StorageArray
 * model ACL (Permission.ReadStorageArray and friends) decides whether the
 * row is visible at all. An array that is missing and one the caller may
 * not read both come back as the same NotFound — the route must never let
 * a caller enumerate which ids exist.
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
  "/storage-array-resource/inventory-summary/:storageArrayId";

const SUMMARY: StorageArrayInventorySummary = {
  countsByKind: {
    Volume: 120,
    Host: 14,
    Pod: 3,
    Hardware: 41,
    Drive: 20,
    Controller: 2,
    NetworkInterface: 16,
    Directory: 5,
  },
  unhealthyHardwareCount: 2,
};

interface RouteCall {
  thrown: unknown;
  nextCallCount: number;
}

describe("StorageArrayResourceAPI", () => {
  let storageArrayId: ObjectID;
  let projectId: ObjectID;
  let props: DatabaseCommonInteractionProps;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let findOneById: jest.SpyInstance;
  let getInventorySummary: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StorageArrayResourceAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    storageArrayId = ObjectID.generate();
    projectId = ObjectID.generate();
    props = {
      isRoot: false,
      userId: ObjectID.generate(),
      tenantId: projectId,
    } as DatabaseCommonInteractionProps;

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);

    findOneById = jest.spyOn(StorageArrayService, "findOneById");
    getInventorySummary = jest
      .spyOn(StorageArrayResourceService, "getInventorySummary")
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

  function readableArray(): StorageArray {
    const array: StorageArray = new StorageArray();
    array.id = storageArrayId;
    array.projectId = projectId;
    return array;
  }

  async function callRoute(
    storageArrayIdParam: string | undefined,
  ): Promise<RouteCall> {
    const request: ExpressRequest = {
      params:
        storageArrayIdParam === undefined
          ? {}
          : { storageArrayId: storageArrayIdParam },
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
      expect(new StorageArrayResource().getCrudApiPath()?.toString()).toBe(
        "/storage-array-resource",
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

    test("does not keep a Ceph-shaped cluster route around", () => {
      for (const cephShaped of [
        "/storage-array-resource/inventory-summary/:clusterId",
        "/ceph-resource/inventory-summary/:clusterId",
        "/storage-array/inventory-summary/:storageArrayId",
      ]) {
        expect(() => {
          return mockRouter.match("post", cephShaped);
        }).toThrow();
      }
    });
  });

  describe("storage array id validation", () => {
    test("rejects a missing id before touching any service", async () => {
      const call: RouteCall = await callRoute(undefined);

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "Storage Array ID is required",
      );
      expect(findOneById).not.toHaveBeenCalled();
      expect(getInventorySummary).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("rejects an empty id", async () => {
      const call: RouteCall = await callRoute("");

      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "Storage Array ID is required",
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
    test("resolves the array with the caller's props so the model ACL applies", async () => {
      findOneById.mockResolvedValue(readableArray());

      await callRoute(storageArrayId.toString());

      expect(CommonAPI.getDatabaseCommonInteractionProps).toHaveBeenCalledTimes(
        1,
      );
      expect(findOneById).toHaveBeenCalledTimes(1);
      const findArgs: JSONObject = findOneById.mock.calls[0]![0] as JSONObject;
      expect((findArgs["id"] as ObjectID).toString()).toBe(
        storageArrayId.toString(),
      );
      expect(findArgs["props"]).toBe(props);
      // Never runs the lookup as root — that is the whole point.
      expect((findArgs["props"] as DatabaseCommonInteractionProps).isRoot).toBe(
        false,
      );
      // Only what is needed to scope the summary is selected.
      expect(findArgs["select"]).toEqual({ _id: true, projectId: true });
    });

    test("answers NotFound for an array that does not exist", async () => {
      findOneById.mockResolvedValue(null);

      const call: RouteCall = await callRoute(storageArrayId.toString());

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBeInstanceOf(NotFoundException);
      expect((call.thrown as NotFoundException).message).toBe(
        "Storage Array not found",
      );
      expect(getInventorySummary).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("answers the same NotFound for an array the caller may not read", async () => {
      /*
       * The ACL filters unreadable rows out of the read, so an unauthorised
       * caller sees exactly what a caller of a nonexistent id sees.
       */
      findOneById.mockResolvedValue(null);
      const unreadable: RouteCall = await callRoute(storageArrayId.toString());

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
      const orphan: StorageArray = new StorageArray();
      orphan.id = storageArrayId;
      findOneById.mockResolvedValue(orphan);

      const call: RouteCall = await callRoute(storageArrayId.toString());

      expect(call.thrown).toBeInstanceOf(NotFoundException);
      expect(getInventorySummary).not.toHaveBeenCalled();
    });
  });

  describe("summary", () => {
    test("scopes the summary to the array's own project, not a caller-supplied one", async () => {
      findOneById.mockResolvedValue(readableArray());

      await callRoute(storageArrayId.toString());

      expect(getInventorySummary).toHaveBeenCalledTimes(1);
      const summaryArgs: JSONObject = getInventorySummary.mock
        .calls[0]![0] as JSONObject;
      expect((summaryArgs["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((summaryArgs["storageArrayId"] as ObjectID).toString()).toBe(
        storageArrayId.toString(),
      );
      expect(Object.keys(summaryArgs).sort()).toEqual([
        "projectId",
        "storageArrayId",
      ]);
    });

    test("returns the per-kind counts plus the convenience fields the layout reads", async () => {
      findOneById.mockResolvedValue(readableArray());

      const call: RouteCall = await callRoute(storageArrayId.toString());

      expect(call.nextCallCount).toBe(0);
      expect(sentBody()).toEqual({
        countsByKind: {
          Volume: 120,
          Host: 14,
          Pod: 3,
          Hardware: 41,
          Drive: 20,
          Controller: 2,
          NetworkInterface: 16,
          Directory: 5,
        },
        volumeCount: 120,
        hostCount: 14,
        podCount: 3,
        hardwareCount: 41,
        driveCount: 20,
        controllerCount: 2,
        networkInterfaceCount: 16,
        directoryCount: 5,
        // A FlashArray has no file systems or buckets — zero, not absent.
        fileSystemCount: 0,
        bucketCount: 0,
        unhealthyHardwareCount: 2,
      });
    });

    test("has a convenience count for every inventory kind there is", async () => {
      findOneById.mockResolvedValue(readableArray());

      await callRoute(storageArrayId.toString());

      /*
       * A kind added to StorageArrayResourceKind without a field here would
       * leave the layout reading countsByKind by hand for that one kind.
       */
      const body: JSONObject = sentBody();
      for (const kind of Object.values(StorageArrayResourceKind)) {
        const field: string = `${kind.charAt(0).toLowerCase()}${kind.slice(1)}Count`;
        expect(typeof body[field]).toBe("number");
      }
    });

    test("uses the storage array kind vocabulary, never Ceph's", async () => {
      findOneById.mockResolvedValue(readableArray());

      await callRoute(storageArrayId.toString());

      const body: JSONObject = sentBody();
      for (const cephOnly of [
        "osdCount",
        "poolCount",
        "monCount",
        "osdUpCount",
        "monInQuorumCount",
      ]) {
        expect(body[cephOnly]).toBeUndefined();
      }
    });

    test("reports a FlashBlade's file systems and buckets", async () => {
      findOneById.mockResolvedValue(readableArray());
      getInventorySummary.mockResolvedValue({
        countsByKind: { Hardware: 9, FileSystem: 12, Bucket: 30 },
        unhealthyHardwareCount: 1,
      } satisfies StorageArrayInventorySummary);

      await callRoute(storageArrayId.toString());

      expect(sentBody()).toMatchObject({
        hardwareCount: 9,
        fileSystemCount: 12,
        bucketCount: 30,
        volumeCount: 0,
        hostCount: 0,
        unhealthyHardwareCount: 1,
      });
    });

    test("reports zeros for an empty array rather than omitting fields", async () => {
      findOneById.mockResolvedValue(readableArray());
      getInventorySummary.mockResolvedValue({
        countsByKind: {},
        unhealthyHardwareCount: 0,
      } satisfies StorageArrayInventorySummary);

      await callRoute(storageArrayId.toString());

      expect(sentBody()).toEqual({
        countsByKind: {},
        volumeCount: 0,
        hostCount: 0,
        podCount: 0,
        hardwareCount: 0,
        driveCount: 0,
        controllerCount: 0,
        networkInterfaceCount: 0,
        directoryCount: 0,
        fileSystemCount: 0,
        bucketCount: 0,
        unhealthyHardwareCount: 0,
      });
    });

    test("hands a service failure to next() instead of answering", async () => {
      findOneById.mockResolvedValue(readableArray());
      const failure: Error = new Error("postgres is away");
      getInventorySummary.mockRejectedValue(failure);

      const call: RouteCall = await callRoute(storageArrayId.toString());

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBe(failure);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("App/FeatureSet/BaseAPI/Index.ts", () => {
    /*
     * Common tests cannot import App, so the mount is checked as text — the
     * same way VMwareResourceAPI.test.ts pins its own registration.
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

    test("mounts StorageArrayResourceAPI exactly once", () => {
      expect(source).toContain(
        'import StorageArrayResourceAPI from "Common/Server/API/StorageArrayResourceAPI";',
      );

      const mounts: Array<string> =
        source.match(/new StorageArrayResourceAPI\(\)\.getRouter\(\)/g) || [];
      expect(mounts).toHaveLength(1);

      // Mounted under the app prefix like every other resource API.
      expect(source).toMatch(
        /app\.use\(\s*`\/\$\{APP_NAME\.toLocaleLowerCase\(\)\}`,\s*new StorageArrayResourceAPI\(\)\.getRouter\(\),?\s*\)/,
      );
    });

    test("mounts the generic CRUD of the six storage array models once each", () => {
      const models: Array<string> = [
        "StorageArray",
        "StorageArrayFeed",
        "StorageArrayOwnerRule",
        "StorageArrayLabelRule",
        "StorageArrayOwnerTeam",
        "StorageArrayOwnerUser",
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

    test("does not mount StorageArrayResource through a second generic BaseAPI", () => {
      /*
       * StorageArrayResourceAPI already extends BaseAPI<StorageArrayResource>;
       * a second generic mount would register the CRUD routes twice.
       */
      expect(source).not.toMatch(
        /new BaseAPI<\s*StorageArrayResource,\s*StorageArrayResourceServiceType\s*>/,
      );
    });
  });
});
