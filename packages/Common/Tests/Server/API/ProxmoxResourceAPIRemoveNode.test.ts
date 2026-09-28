import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import ProxmoxResourceAPI from "../../../Server/API/ProxmoxResourceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProxmoxResourceService, {
  ProxmoxInventorySummary,
} from "../../../Server/Services/ProxmoxResourceService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Label from "../../../Models/DatabaseModels/Label";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
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
import { FindOperator } from "typeorm";

/*
 * POST /proxmox-resource/remove-node/:clusterId   { nodeName }
 *
 * On the Proxmox VE native push every node reports only itself, and a node
 * that stops reporting is reported as down by its live siblings. A node
 * taken out of the Proxmox cluster for good looks exactly the same, so the
 * Dashboard lets a user remove it. This route is that button's server side.
 *
 * It runs behind UserMiddleware only, so it proves its own authorisation:
 * the caller must be allowed to UPDATE the ProxmoxCluster (the inventory
 * table has no user write access at all). The update permission check
 * scopes the cluster lookup the way an update of that row would be scoped,
 * and the row is then read as root. A cluster that does not exist, one in
 * another project and one the caller may not edit all come back as the
 * same NotFound, so the route cannot be used to probe for ids.
 *
 * The removal itself is ProxmoxResourceService.removeOfflineNode, which
 * only ever deletes a Node row that is not up. When it deletes nothing the
 * route answers 400 with an explanation instead of pretending it worked.
 *
 * The services are stubbed at their public seams; the permission check is
 * stubbed in most tests and run for real in "real update permission check".
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

const REMOVE_NODE_ROUTE: string = "/proxmox-resource/remove-node/:clusterId";
const INVENTORY_SUMMARY_ROUTE: string =
  "/proxmox-resource/inventory-summary/:clusterId";

const NOT_FOUND_MESSAGE: string =
  "Proxmox Cluster not found, or you do not have permission to edit it. Removing a node needs permission to edit its cluster.";

const STILL_REPORTING_MESSAGE: string =
  "Only a node that has stopped reporting can be removed. A node that is still reporting would come back on its next report.";

interface RouteCall {
  thrown: unknown;
  nextCallCount: number;
}

type PermissionGrant = {
  permission: Permission;
  isBlockPermission?: boolean | undefined;
  labelIds?: Array<ObjectID> | undefined;
};

describe("ProxmoxResourceAPI remove-node", () => {
  let clusterId: ObjectID;
  let projectId: ObjectID;
  let props: DatabaseCommonInteractionProps;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let findOneBy: jest.SpyInstance;
  let findOneById: jest.SpyInstance;
  let removeOfflineNode: jest.SpyInstance;
  let getInventorySummary: jest.SpyInstance;
  let checkUpdateQueryPermissions: jest.SpyInstance;
  let checkUpdatePermissionByModel: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new ProxmoxResourceAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    clusterId = ObjectID.generate();
    projectId = ObjectID.generate();
    props = {
      isRoot: false,
      userId: ObjectID.generate(),
      tenantId: projectId,
    } as DatabaseCommonInteractionProps;

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
        return props;
      });

    /*
     * The caller may edit the cluster unless a test says otherwise; the
     * query comes back as it went in. "real update permission check"
     * restores the real check.
     */
    checkUpdateQueryPermissions = jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(async (_modelType: unknown, query: unknown) => {
        return query as never;
      });
    checkUpdatePermissionByModel = jest
      .spyOn(ModelPermission, "checkUpdatePermissionByModel")
      .mockResolvedValue(undefined);

    // Nothing here may reach Postgres.
    findOneBy = jest
      .spyOn(ProxmoxClusterService, "findOneBy")
      .mockResolvedValue(null);
    findOneById = jest
      .spyOn(ProxmoxClusterService, "findOneById")
      .mockResolvedValue(null);
    removeOfflineNode = jest
      .spyOn(ProxmoxResourceService, "removeOfflineNode")
      .mockResolvedValue(true);
    getInventorySummary = jest
      .spyOn(ProxmoxResourceService, "getInventorySummary")
      .mockRejectedValue(new Error("the summary is not part of remove-node"));

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

  function clusterRow(labelIds: Array<ObjectID> = []): ProxmoxCluster {
    const cluster: ProxmoxCluster = new ProxmoxCluster();
    cluster.id = clusterId;
    cluster.projectId = projectId;
    cluster.labels = labelIds.map((labelId: ObjectID): Label => {
      const label: Label = new Label();
      label.id = labelId;
      return label;
    });
    return cluster;
  }

  function buildRequest(
    clusterIdParam: string | undefined,
    body: unknown,
  ): ExpressRequest {
    return {
      params: clusterIdParam === undefined ? {} : { clusterId: clusterIdParam },
      body: body,
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;
  }

  async function callRoute(
    clusterIdParam: string | undefined,
    body: unknown,
  ): Promise<RouteCall> {
    await mockRouter
      .match("post", REMOVE_NODE_ROUTE)
      .handlerFunction(
        buildRequest(clusterIdParam, body),
        mockResponse,
        nextFunction,
      );

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

  function removeArgs(): JSONObject {
    expect(removeOfflineNode).toHaveBeenCalledTimes(1);
    return removeOfflineNode.mock.calls[0]![0] as JSONObject;
  }

  function expectNothingDone(): void {
    expect(removeOfflineNode).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  function expectRefusedAsNotFound(call: RouteCall): void {
    expect(call.nextCallCount).toBe(1);
    expect(call.thrown).toBeInstanceOf(NotFoundException);
    expect((call.thrown as NotFoundException).message).toBe(NOT_FOUND_MESSAGE);
    expectNothingDone();
  }

  describe("registration", () => {
    test("derives the route from the model's CRUD path and mounts it as POST", () => {
      expect(new ProxmoxResource().getCrudApiPath()?.toString()).toBe(
        "/proxmox-resource",
      );

      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        REMOVE_NODE_ROUTE,
      );
      expect(route.method).toBe("POST");

      for (const method of ["get", "put", "delete"]) {
        expect(() => {
          return mockRouter.match(method, REMOVE_NODE_ROUTE);
        }).toThrow();
      }
    });

    test("is mounted behind UserMiddleware.getUserMiddleware only", () => {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        REMOVE_NODE_ROUTE,
      );
      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    });

    test("keeps the inventory-summary route next to it", () => {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        INVENTORY_SUMMARY_ROUTE,
      );
      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    });

    test("does not collide with the generic CRUD routes BaseAPI registers", () => {
      /*
       * BaseAPI mounts POST /proxmox-resource/:id/get-item and friends; the
       * custom route has a literal second segment, so an id never matches it
       * and it never matches them.
       */
      const genericPostRoutes: Array<string> = mockRouter.routes
        .filter((route: { method: string; uri: string }) => {
          return route.method === "POST";
        })
        .map((route: { uri: string }) => {
          return route.uri;
        });

      expect(genericPostRoutes).toContain("/proxmox-resource/:id/get-item");
      expect(
        genericPostRoutes.filter((uri: string) => {
          return uri === REMOVE_NODE_ROUTE;
        }),
      ).toHaveLength(1);
    });
  });

  describe("cluster id validation", () => {
    test("rejects a missing id before touching any service", async () => {
      const call: RouteCall = await callRoute(undefined, { nodeName: "pve1" });

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "Cluster ID is required",
      );
      expect(
        CommonAPI.getDatabaseCommonInteractionProps,
      ).not.toHaveBeenCalled();
      expect(findOneBy).not.toHaveBeenCalled();
      expectNothingDone();
    });

    test("rejects an empty id", async () => {
      const call: RouteCall = await callRoute("", { nodeName: "pve1" });

      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "Cluster ID is required",
      );
      expectNothingDone();
    });

    test.each(["not-an-id", "1", "' OR 1=1 --", `${"a".repeat(36)}`])(
      "rejects the malformed id %p before it reaches a uuid column",
      async (malformed: string) => {
        const call: RouteCall = await callRoute(malformed, {
          nodeName: "pve1",
        });

        expect(call.nextCallCount).toBe(1);
        expect(call.thrown).toBeInstanceOf(BadDataException);
        expect((call.thrown as BadDataException).message).toBe(
          "Invalid Cluster ID",
        );
        expect(findOneBy).not.toHaveBeenCalled();
        expectNothingDone();
      },
    );
  });

  describe("node name validation", () => {
    beforeEach(() => {
      findOneBy.mockResolvedValue(clusterRow());
    });

    test.each([
      ["no body", undefined],
      ["a null body", null],
      ["a string body", "pve1"],
      ["no nodeName", {}],
      ["a null nodeName", { nodeName: null }],
      ["a numeric nodeName", { nodeName: 1 }],
      ["a boolean nodeName", { nodeName: true }],
      ["an array nodeName", { nodeName: ["pve1"] }],
      ["an object nodeName", { nodeName: { name: "pve1" } }],
      ["an empty nodeName", { nodeName: "" }],
      ["a blank nodeName", { nodeName: "   " }],
      ["a whitespace-only nodeName", { nodeName: "\t\n " }],
    ] as Array<[string, unknown]>)(
      "answers 400 for %s",
      async (_label: string, body: unknown) => {
        const call: RouteCall = await callRoute(clusterId.toString(), body);

        expect(call.nextCallCount).toBe(1);
        expect(call.thrown).toBeInstanceOf(BadDataException);
        expect((call.thrown as BadDataException).message).toBe(
          "Node name is required",
        );
        expect(findOneBy).not.toHaveBeenCalled();
        expectNothingDone();
      },
    );

    test.each([
      "node/pve1",
      "pve1/",
      "/pve1",
      "qemu/100",
      "storage/pve1/local",
      "../pve1",
      " pve1/x ",
    ])(
      "answers 400 for %p, which is not a single node name",
      async (nodeName: string) => {
        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName,
        });

        expect(call.nextCallCount).toBe(1);
        expect(call.thrown).toBeInstanceOf(BadDataException);
        expect((call.thrown as BadDataException).message).toBe(
          "Node name must not contain a slash",
        );
        expect(findOneBy).not.toHaveBeenCalled();
        expectNothingDone();
      },
    );

    test("trims the name before building the externalId", async () => {
      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "  pve1 \n",
      });

      expect(call.nextCallCount).toBe(0);
      expect(removeArgs()["externalId"]).toBe("node/pve1");
    });

    test("keeps the name's own case and punctuation", async () => {
      /*
       * Node names are hostnames and are matched as-is against the
       * inventory's externalId; nothing is lowercased or slugified.
       */
      await callRoute(clusterId.toString(), { nodeName: "PVE-Node_02.lab" });

      expect(removeArgs()["externalId"]).toBe("node/PVE-Node_02.lab");
    });

    test("ignores any other body fields, including a caller-supplied externalId or project", async () => {
      const otherProject: ObjectID = ObjectID.generate();

      await callRoute(clusterId.toString(), {
        nodeName: "pve1",
        externalId: "qemu/100",
        projectId: otherProject.toString(),
        proxmoxClusterId: ObjectID.generate().toString(),
      });

      const args: JSONObject = removeArgs();
      expect(args["externalId"]).toBe("node/pve1");
      expect((args["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((args["proxmoxClusterId"] as ObjectID).toString()).toBe(
        clusterId.toString(),
      );
    });
  });

  describe("authorisation (update permission check stubbed)", () => {
    const SCOPED_QUERY_MARKER: string = "scoped-by-permission-check";

    beforeEach(() => {
      // Stands in for the label / Owned predicates the real check adds.
      checkUpdateQueryPermissions.mockImplementation(
        async (_modelType: unknown, query: unknown) => {
          return {
            ...(query as JSONObject),
            labels: SCOPED_QUERY_MARKER,
          } as never;
        },
      );
    });

    test("asks whether the caller may UPDATE this cluster in the caller's own project", async () => {
      findOneBy.mockResolvedValue(clusterRow());

      await callRoute(clusterId.toString(), { nodeName: "pve1" });

      expect(CommonAPI.getDatabaseCommonInteractionProps).toHaveBeenCalledTimes(
        1,
      );
      expect(checkUpdateQueryPermissions).toHaveBeenCalledTimes(1);
      const [modelType, query, data, checkedProps] = checkUpdateQueryPermissions
        .mock.calls[0]! as [unknown, JSONObject, JSONObject, unknown];

      expect(modelType).toBe(ProxmoxCluster);
      expect(query["_id"]).toBe(clusterId.toString());
      expect((query["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect(Object.keys(query).sort()).toEqual(["_id", "projectId"]);
      expect(data).toEqual({});
      expect(checkedProps).toBe(props);
    });

    test("reads the cluster as root through exactly the query the permission check returned", async () => {
      findOneBy.mockResolvedValue(clusterRow());

      await callRoute(clusterId.toString(), { nodeName: "pve1" });

      expect(findOneBy).toHaveBeenCalledTimes(1);
      const findArgs: JSONObject = findOneBy.mock.calls[0]![0] as JSONObject;
      const query: JSONObject = findArgs["query"] as JSONObject;

      expect(query["labels"]).toBe(SCOPED_QUERY_MARKER);
      expect(query["_id"]).toBe(clusterId.toString());
      expect((query["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect(findArgs["props"]).toEqual({ isRoot: true });
      // The labels ride along for the block-list check below.
      expect(findArgs["select"]).toEqual({
        _id: true,
        projectId: true,
        labels: { _id: true },
      });

      // Never the read-access lookup the inventory-summary route uses.
      expect(findOneById).not.toHaveBeenCalled();
    });

    test("then runs the per-row update check on the row it found, with the caller's props", async () => {
      const cluster: ProxmoxCluster = clusterRow();
      findOneBy.mockResolvedValue(cluster);

      await callRoute(clusterId.toString(), { nodeName: "pve1" });

      expect(checkUpdatePermissionByModel).toHaveBeenCalledTimes(1);
      const byModelArgs: {
        modelType: unknown;
        props: unknown;
        fetchModelWithAccessControlIds: () => Promise<unknown>;
      } = checkUpdatePermissionByModel.mock.calls[0]![0];

      expect(byModelArgs.modelType).toBe(ProxmoxCluster);
      expect(byModelArgs.props).toBe(props);
      // The row already read (with its labels): no second lookup.
      expect(await byModelArgs.fetchModelWithAccessControlIds()).toBe(cluster);
      expect(findOneBy).toHaveBeenCalledTimes(1);

      // Both checks pass before anything is removed.
      const queryCheckOrder: number =
        checkUpdateQueryPermissions.mock.invocationCallOrder[0]!;
      const byModelOrder: number =
        checkUpdatePermissionByModel.mock.invocationCallOrder[0]!;
      const removeOrder: number =
        removeOfflineNode.mock.invocationCallOrder[0]!;
      expect(queryCheckOrder).toBeLessThan(byModelOrder);
      expect(byModelOrder).toBeLessThan(removeOrder);
    });

    test("answers the same NotFound when the per-row check refuses (a team block list)", async () => {
      findOneBy.mockResolvedValue(clusterRow());
      checkUpdatePermissionByModel.mockRejectedValue(
        new NotAuthorizedException(
          "You are not authorized to update this Proxmox Cluster because EditProxmoxCluster is in your team's permission block list.",
        ),
      );

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      // The block-list wording would confirm the cluster exists.
      expectRefusedAsNotFound(call);
    });

    test("passes any other per-row failure through unchanged", async () => {
      findOneBy.mockResolvedValue(clusterRow());
      const failure: Error = new Error("label lookup failed");
      checkUpdatePermissionByModel.mockRejectedValue(failure);

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.thrown).toBe(failure);
      expectNothingDone();
    });

    test("answers NotFound for a cluster that does not exist", async () => {
      findOneBy.mockResolvedValue(null);

      const call: RouteCall = await callRoute(ObjectID.generate().toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
      // Nothing to run the per-row check on.
      expect(checkUpdatePermissionByModel).not.toHaveBeenCalled();
    });

    test("answers the same NotFound for a cluster the caller may not edit", async () => {
      checkUpdateQueryPermissions.mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to update Proxmox Cluster.",
        ),
      );

      const forbidden: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(forbidden);
      // The permission refusal never falls through to a read.
      expect(findOneBy).not.toHaveBeenCalled();
      expect(checkUpdatePermissionByModel).not.toHaveBeenCalled();
    });

    test("forbidden and missing are indistinguishable to the caller", async () => {
      checkUpdateQueryPermissions.mockRejectedValue(
        new NotAuthorizedException("nope"),
      );
      const forbidden: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      jest.clearAllMocks();
      checkUpdateQueryPermissions.mockImplementation(
        async (_modelType: unknown, query: unknown) => {
          return query as never;
        },
      );
      findOneBy.mockResolvedValue(null);
      const missing: RouteCall = await callRoute(
        ObjectID.generate().toString(),
        { nodeName: "pve1" },
      );

      expect(forbidden.thrown).toBeInstanceOf(NotFoundException);
      expect(missing.thrown).toBeInstanceOf(NotFoundException);
      expect((forbidden.thrown as NotFoundException).message).toBe(
        (missing.thrown as NotFoundException).message,
      );
    });

    test("answers NotFound for a caller with no project, without checking anything", async () => {
      props = {
        isRoot: false,
        userId: ObjectID.generate(),
      } as DatabaseCommonInteractionProps;

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
      expect(checkUpdateQueryPermissions).not.toHaveBeenCalled();
      expect(findOneBy).not.toHaveBeenCalled();
    });

    test("answers NotFound when the row came back without a project", async () => {
      const orphan: ProxmoxCluster = new ProxmoxCluster();
      orphan.id = clusterId;
      findOneBy.mockResolvedValue(orphan);

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
    });

    test("lets an anonymous refusal through as-is so the client can sign in again", async () => {
      const refusal: NotAuthenticatedException = new NotAuthenticatedException(
        "Please sign in",
      );
      checkUpdateQueryPermissions.mockRejectedValue(refusal);

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBe(refusal);
      expect(findOneBy).not.toHaveBeenCalled();
      expectNothingDone();
    });

    test("passes any other permission failure through unchanged", async () => {
      const failure: BadDataException = new BadDataException(
        "isMultiTenantRequest not allowed on Proxmox Cluster",
      );
      checkUpdateQueryPermissions.mockRejectedValue(failure);

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.thrown).toBe(failure);
      expectNothingDone();
    });

    test("hands a lookup failure to next() instead of answering", async () => {
      const failure: Error = new Error("postgres is away");
      findOneBy.mockRejectedValue(failure);

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBe(failure);
      expectNothingDone();
    });
  });

  describe("real update permission check", () => {
    /*
     * The permission check is not stubbed here: what the caller holds in
     * the project decides whether the cluster lookup ever runs. A plain
     * (non-Owned, unlabelled) grant needs no database.
     */
    beforeEach(() => {
      checkUpdateQueryPermissions.mockRestore();
      checkUpdatePermissionByModel.mockRestore();
    });

    /*
     * The real check hands the tenant predicate on as a TypeORM operator
     * whose parameter is the project id; a stubbed one hands the ObjectID
     * on as-is. Either way this is the project the lookup is scoped to.
     */
    function scopedProjectIds(): Array<string> {
      expect(findOneBy).toHaveBeenCalledTimes(1);
      const query: JSONObject = (findOneBy.mock.calls[0]![0] as JSONObject)[
        "query"
      ] as JSONObject;
      const value: unknown = query["projectId"];

      if (value instanceof FindOperator) {
        return Object.values(value.objectLiteralParameters || {}).map(
          (parameter: unknown) => {
            return String(parameter);
          },
        );
      }

      return [String(value)];
    }

    function scopedClusterId(): unknown {
      return (
        (findOneBy.mock.calls[0]![0] as JSONObject)["query"] as JSONObject
      )["_id"];
    }

    function propsWith(
      grants: Array<PermissionGrant>,
      grantedInProject: ObjectID = projectId,
    ): DatabaseCommonInteractionProps {
      const permissions: Array<UserPermission> = grants.map(
        (grant: PermissionGrant): UserPermission => {
          return {
            _type: "UserPermission",
            permission: grant.permission,
            labelIds: grant.labelIds || [],
            isBlockPermission: Boolean(grant.isBlockPermission),
          };
        },
      );

      const permissionMap: Dictionary<UserTenantAccessPermission> = {};
      permissionMap[grantedInProject.toString()] = {
        _type: "UserTenantAccessPermission",
        projectId: grantedInProject,
        permissions: permissions,
      };

      return {
        tenantId: projectId,
        userId: ObjectID.generate(),
        userType: UserType.User,
        userTenantAccessPermission: permissionMap,
      };
    }

    test.each([
      [[Permission.ProjectOwner]],
      [[Permission.ProjectAdmin]],
      [[Permission.ProjectMember]],
      [[Permission.SettingsAdmin]],
      [[Permission.SettingsMember]],
      // A custom role: the dedicated edit permission plus the read it rides on.
      [[Permission.EditProxmoxCluster, Permission.ReadProxmoxCluster]],
    ] as Array<[Array<Permission>]>)(
      "a caller holding %p may remove a node",
      async (permissions: Array<Permission>) => {
        props = propsWith(
          permissions.map((permission: Permission): PermissionGrant => {
            return { permission };
          }),
        );
        findOneBy.mockResolvedValue(clusterRow());

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expect(call.nextCallCount).toBe(0);
        expect(scopedClusterId()).toBe(clusterId.toString());
        expect(scopedProjectIds()).toEqual([projectId.toString()]);
        expect((findOneBy.mock.calls[0]![0] as JSONObject)["props"]).toEqual({
          isRoot: true,
        });
        expect(removeArgs()["externalId"]).toBe("node/pve1");
        expect(sentBody()).toEqual({ removed: true });
      },
    );

    test("EditProxmoxCluster without any read grant is refused, as the CRUD update would be", async () => {
      /*
       * The update check also asks for read access to the columns the
       * lookup filters on (projectId), exactly as it does for the generic
       * update endpoint, so an edit-only role cannot use either.
       */
      props = propsWith([{ permission: Permission.EditProxmoxCluster }]);
      findOneBy.mockResolvedValue(clusterRow());

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
      expect(findOneBy).not.toHaveBeenCalled();
    });

    test.each([
      Permission.ReadProxmoxCluster,
      Permission.Viewer,
      Permission.SettingsViewer,
      Permission.DeleteProxmoxCluster,
      Permission.CreateProxmoxCluster,
    ])(
      "a caller holding only %s gets NotFound and nothing is read",
      async (permission: Permission) => {
        props = propsWith([{ permission }]);
        findOneBy.mockResolvedValue(clusterRow());

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expectRefusedAsNotFound(call);
        expect(findOneBy).not.toHaveBeenCalled();
      },
    );

    test("a caller with no permissions at all gets NotFound", async () => {
      props = propsWith([]);
      findOneBy.mockResolvedValue(clusterRow());

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
      expect(findOneBy).not.toHaveBeenCalled();
    });

    test("an unlabelled block on the edit permission overrides the grant", async () => {
      props = propsWith([
        { permission: Permission.EditProxmoxCluster },
        { permission: Permission.ReadProxmoxCluster },
        { permission: Permission.EditProxmoxCluster, isBlockPermission: true },
      ]);
      findOneBy.mockResolvedValue(clusterRow());

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
      expect(removeOfflineNode).not.toHaveBeenCalled();
    });

    test("a block on the edit permission for one of the cluster's labels refuses it", async () => {
      const blockedLabel: ObjectID = ObjectID.generate();
      props = propsWith([
        { permission: Permission.ProjectMember },
        {
          permission: Permission.EditProxmoxCluster,
          isBlockPermission: true,
          labelIds: [blockedLabel],
        },
      ]);
      findOneBy.mockResolvedValue(
        clusterRow([ObjectID.generate(), blockedLabel]),
      );

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
    });

    test("a block for a label the cluster does not carry leaves it editable", async () => {
      props = propsWith([
        { permission: Permission.ProjectMember },
        {
          permission: Permission.EditProxmoxCluster,
          isBlockPermission: true,
          labelIds: [ObjectID.generate()],
        },
      ]);
      findOneBy.mockResolvedValue(clusterRow([ObjectID.generate()]));

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(0);
      expect(sentBody()).toEqual({ removed: true });
    });

    test("an edit grant in another project does not count in this one", async () => {
      props = propsWith(
        [
          { permission: Permission.EditProxmoxCluster },
          { permission: Permission.ReadProxmoxCluster },
          { permission: Permission.ProjectOwner },
        ],
        ObjectID.generate(),
      );
      findOneBy.mockResolvedValue(clusterRow());

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
      expect(findOneBy).not.toHaveBeenCalled();
    });

    test("a master admin passes the check and the lookup stays scoped to the request's project", async () => {
      props = {
        tenantId: projectId,
        userId: ObjectID.generate(),
        userType: UserType.MasterAdmin,
        isMasterAdmin: true,
      };
      findOneBy.mockResolvedValue(clusterRow());

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(0);
      expect(scopedClusterId()).toBe(clusterId.toString());
      expect(scopedProjectIds()).toEqual([projectId.toString()]);
      expect(sentBody()).toEqual({ removed: true });
    });

    test("a master admin without a project on the request gets NotFound", async () => {
      props = {
        userId: ObjectID.generate(),
        userType: UserType.MasterAdmin,
        isMasterAdmin: true,
      };
      findOneBy.mockResolvedValue(clusterRow());

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      /*
       * Without a project the lookup would not be scoped to one at all
       * (the master-admin check adds no tenant predicate), so it never runs.
       */
      expectRefusedAsNotFound(call);
      expect(findOneBy).not.toHaveBeenCalled();
    });
  });

  describe("removal", () => {
    beforeEach(() => {
      findOneBy.mockResolvedValue(clusterRow());
    });

    test("removes node/<name> in the cluster's own project and cluster", async () => {
      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(0);
      const args: JSONObject = removeArgs();
      expect(Object.keys(args).sort()).toEqual([
        "externalId",
        "projectId",
        "proxmoxClusterId",
      ]);
      expect(args["externalId"]).toBe("node/pve1");
      expect((args["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((args["proxmoxClusterId"] as ObjectID).toString()).toBe(
        clusterId.toString(),
      );
    });

    test("answers 200 with removed: true", async () => {
      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(0);
      expect(sentBody()).toEqual({ removed: true });
      const responseCall: Array<unknown> = (
        Response.sendJsonObjectResponse as jest.Mock
      ).mock.calls[0] as Array<unknown>;
      expect(responseCall[1]).toBe(mockResponse);
    });

    test("answers 400 with an explanation when the node is still up (or not there)", async () => {
      removeOfflineNode.mockResolvedValue(false);

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        STILL_REPORTING_MESSAGE,
      );
      expect(removeOfflineNode).toHaveBeenCalledTimes(1);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("never touches the inventory summary", async () => {
      await callRoute(clusterId.toString(), { nodeName: "pve1" });

      expect(getInventorySummary).not.toHaveBeenCalled();
    });

    test("hands a service failure to next() instead of answering", async () => {
      const failure: Error = new Error("postgres is away");
      removeOfflineNode.mockRejectedValue(failure);

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBe(failure);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("removes only the named node, once per request", async () => {
      await callRoute(clusterId.toString(), { nodeName: "pve1" });
      await callRoute(clusterId.toString(), { nodeName: "pve2" });

      expect(removeOfflineNode).toHaveBeenCalledTimes(2);
      expect(
        (removeOfflineNode.mock.calls[0]![0] as JSONObject)["externalId"],
      ).toBe("node/pve1");
      expect(
        (removeOfflineNode.mock.calls[1]![0] as JSONObject)["externalId"],
      ).toBe("node/pve2");
    });
  });

  describe("inventory-summary, next to it, is unchanged", () => {
    /*
     * The two routes share the cluster id parsing. The summary still only
     * needs READ access to the cluster, looked up with the caller's props.
     */
    const SUMMARY: ProxmoxInventorySummary = {
      countsByKind: { Node: 3, Guest: 12, Storage: 4 },
      nodeOnlineCount: 2,
      guestRunningCount: 9,
    };

    async function callSummary(
      clusterIdParam: string | undefined,
    ): Promise<RouteCall> {
      await mockRouter
        .match("post", INVENTORY_SUMMARY_ROUTE)
        .handlerFunction(
          buildRequest(clusterIdParam, {}),
          mockResponse,
          nextFunction,
        );

      const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
        .calls as Array<Array<unknown>>;

      return {
        thrown: calls[0]?.[0],
        nextCallCount: calls.length,
      };
    }

    test("still rejects a missing id", async () => {
      const call: RouteCall = await callSummary(undefined);

      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "Cluster ID is required",
      );
      expect(findOneById).not.toHaveBeenCalled();
    });

    test("still resolves the cluster with the caller's props and answers NotFound when unreadable", async () => {
      findOneById.mockResolvedValue(null);

      const call: RouteCall = await callSummary(clusterId.toString());

      expect(call.thrown).toBeInstanceOf(NotFoundException);
      expect((call.thrown as NotFoundException).message).toBe(
        "Proxmox Cluster not found",
      );
      const findArgs: JSONObject = findOneById.mock.calls[0]![0] as JSONObject;
      expect((findArgs["id"] as ObjectID).toString()).toBe(
        clusterId.toString(),
      );
      expect(findArgs["props"]).toBe(props);
      // The summary needs read access only, never the update check.
      expect(checkUpdateQueryPermissions).not.toHaveBeenCalled();
      expect(getInventorySummary).not.toHaveBeenCalled();
    });

    test("still returns the counts plus the convenience fields", async () => {
      findOneById.mockResolvedValue(clusterRow());
      getInventorySummary.mockResolvedValue(SUMMARY);

      const call: RouteCall = await callSummary(clusterId.toString());

      expect(call.nextCallCount).toBe(0);
      expect(sentBody()).toEqual({
        countsByKind: { Node: 3, Guest: 12, Storage: 4 },
        nodeCount: 3,
        guestCount: 12,
        storageCount: 4,
        nodeOnlineCount: 2,
        guestRunningCount: 9,
      });
      expect(removeOfflineNode).not.toHaveBeenCalled();
    });
  });

  describe("App/FeatureSet/BaseAPI/Index.ts", () => {
    /*
     * Common tests cannot import App, so the mount is checked as text, the
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

    test("mounts ProxmoxResourceAPI exactly once, so remove-node is reachable", () => {
      expect(source).toContain(
        'import ProxmoxResourceAPI from "Common/Server/API/ProxmoxResourceAPI";',
      );

      const mounts: Array<string> =
        source.match(/new ProxmoxResourceAPI\(\)\.getRouter\(\)/g) || [];
      expect(mounts).toHaveLength(1);

      expect(source).toMatch(
        /app\.use\(\s*`\/\$\{APP_NAME\.toLocaleLowerCase\(\)\}`,\s*new ProxmoxResourceAPI\(\)\.getRouter\(\),?\s*\)/,
      );
    });
  });
});
