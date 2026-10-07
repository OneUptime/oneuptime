import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import ProxmoxResourceAPI from "../../../Server/API/ProxmoxResourceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProxmoxResourceService, {
  ProxmoxInventorySummary,
  ProxmoxRemoveNodeResult,
} from "../../../Server/Services/ProxmoxResourceService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
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
import Exception from "../../../Types/Exception/Exception";
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
 * The per-row check (the team block list) needs every label on the
 * cluster. The scoped lookup is narrowed to the caller's permitted labels
 * when the grant is label-scoped, so labels loaded through it would hide a
 * label the caller's team is blocked on. The row check therefore loads the
 * cluster again as root, labels unfiltered (ProxmoxClusterService
 * .findOneById), the way updateOneById does. It loads it once per request,
 * though under a labelled grant and a labelled block the block check and
 * the allow check both ask for it, and never reuses one request's load in
 * the next. A cluster deleted between the scoped lookup and that load
 * answers the same NotFound as a missing one.
 *
 * The removal itself is ProxmoxResourceService.removeOfflineNode, which
 * only ever deletes a native-push Node row that is not up, and says why
 * when it deletes nothing: "not-found" answers 404, "not-native" (an agent
 * node) and "still-reporting" answer 400 with an explanation, "removed"
 * answers 200. Anything else — an unknown string, or a boolean from a
 * stale mock of the old boolean contract — answers 400, never 200.
 *
 * The services are stubbed at their public seams; the permission check is
 * stubbed in most tests and run for real in "real update permission check",
 * where the scoped lookup is stubbed to serve the row the way the database
 * would serve it through the label predicate the real check adds.
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

const NODE_NOT_FOUND_MESSAGE: string =
  "This node is not in the cluster's inventory. It may already have been removed.";

const NOT_NATIVE_MESSAGE: string =
  "Only a node that reports over Proxmox VE's built-in metric push can be removed here. With the Proxmox Agent, a node leaves OneUptime on its own once the cluster no longer lists it.";

const CONTROL_CHARACTER_MESSAGE: string =
  "Node name must not contain control characters";

const REMOVED: ProxmoxRemoveNodeResult = "removed";

// How the per-row check must load the cluster: every label, as root.
const UNFILTERED_LOAD_SELECT: JSONObject = {
  _id: true,
  projectId: true,
  labels: { _id: true },
};

interface RouteCall {
  thrown: unknown;
  nextCallCount: number;
}

type PermissionGrant = {
  permission: Permission;
  isBlockPermission?: boolean | undefined;
  labelIds?: Array<ObjectID> | undefined;
};

// What the route hands the per-row update check.
type ByModelCheckInput = Parameters<
  typeof ModelPermission.checkUpdatePermissionByModel
>[0];

type FetchedForCheck = ReturnType<
  ByModelCheckInput["fetchModelWithAccessControlIds"]
>;

// How often the per-row check asked for the cluster with its labels.
interface LabelAsks {
  count: number;
}

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
      .mockResolvedValue(REMOVED);
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

  function labelIdsOf(cluster: unknown): Array<string> {
    return ((cluster as ProxmoxCluster).labels || []).map(
      (label: Label): string => {
        return String(label.id);
      },
    );
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

    test.each([
      ["a NUL", "pve\u00001"],
      ["a leading NUL, which trim() keeps", "\u0000pve1"],
      ["a tab inside the name", "pve\t1"],
      ["a newline inside the name", "pve\n1"],
      ["a carriage return inside the name", "pve\r1"],
      ["an ANSI escape", "pve1\u001b[31m"],
      ["U+001F, the last C0 control", "pve\u001f1"],
      ["DEL (U+007F)", "pve\u007f1"],
    ] as Array<[string, string]>)(
      "answers 400 for a name with %s, before any lookup",
      async (_label: string, nodeName: string) => {
        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName,
        });

        expect(call.nextCallCount).toBe(1);
        expect(call.thrown).toBeInstanceOf(BadDataException);
        expect((call.thrown as Exception).code).toBe(400);
        expect((call.thrown as BadDataException).message).toBe(
          CONTROL_CHARACTER_MESSAGE,
        );
        expect(
          CommonAPI.getDatabaseCommonInteractionProps,
        ).not.toHaveBeenCalled();
        expect(findOneBy).not.toHaveBeenCalled();
        expectNothingDone();
      },
    );

    test("a name with both a slash and a control character is refused for the slash", async () => {
      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve/\u00001",
      });

      expect((call.thrown as BadDataException).message).toBe(
        "Node name must not contain a slash",
      );
      expectNothingDone();
    });

    test.each([
      ["a space (U+0020, the first printable)", "pve 1", "node/pve 1"],
      [
        "a tilde (U+007E, the last printable before DEL)",
        "pve~1",
        "node/pve~1",
      ],
      ["surrounding whitespace, which is trimmed", "\t pve1 \r\n", "node/pve1"],
    ] as Array<[string, string, string]>)(
      "accepts a name with %s",
      async (_label: string, nodeName: string, externalId: string) => {
        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName,
        });

        expect(call.nextCallCount).toBe(0);
        expect(removeArgs()["externalId"]).toBe(externalId);
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
      /*
       * No labels through this lookup: under a label-scoped grant they
       * would come back narrowed to the permitted ones and hide a blocked
       * label from the per-row check below.
       */
      expect(findArgs["select"]).toEqual({
        _id: true,
        projectId: true,
      });

      /*
       * Never the read-access lookup the inventory-summary route uses;
       * with the per-row check stubbed, nothing asks for the root load.
       */
      expect(findOneById).not.toHaveBeenCalled();
    });

    test("then runs the per-row update check on the cluster loaded as root with every label, with the caller's props", async () => {
      findOneBy.mockResolvedValue(clusterRow());
      const withEveryLabel: ProxmoxCluster = clusterRow([
        ObjectID.generate(),
        ObjectID.generate(),
      ]);
      findOneById.mockResolvedValue(withEveryLabel);

      await callRoute(clusterId.toString(), { nodeName: "pve1" });

      expect(checkUpdatePermissionByModel).toHaveBeenCalledTimes(1);
      const byModelArgs: {
        modelType: unknown;
        props: unknown;
        fetchModelWithAccessControlIds: () => Promise<unknown>;
      } = checkUpdatePermissionByModel.mock.calls[0]![0];

      expect(byModelArgs.modelType).toBe(ProxmoxCluster);
      expect(byModelArgs.props).toBe(props);

      expect(await byModelArgs.fetchModelWithAccessControlIds()).toBe(
        withEveryLabel,
      );
      expect(findOneById).toHaveBeenCalledTimes(1);
      const loadArgs: JSONObject = findOneById.mock.calls[0]![0] as JSONObject;
      expect(Object.keys(loadArgs).sort()).toEqual(["id", "props", "select"]);
      expect((loadArgs["id"] as ObjectID).toString()).toBe(
        clusterId.toString(),
      );
      expect(loadArgs["select"]).toEqual(UNFILTERED_LOAD_SELECT);
      // Unfiltered: root, never the caller's (label-scoped) props.
      expect(loadArgs["props"]).toEqual({ isRoot: true });
      expect(loadArgs["props"]).not.toBe(props);
      // Not through the scoped query, which still ran exactly once.
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

    test("the per-row check sees the labels the scoped lookup would have hidden", async () => {
      const permittedLabel: ObjectID = ObjectID.generate();
      const blockedLabel: ObjectID = ObjectID.generate();
      /*
       * What a label-scoped lookup that also selected labels returns: only
       * the permitted one. The root load has both.
       */
      findOneBy.mockResolvedValue(clusterRow([permittedLabel]));
      findOneById.mockResolvedValue(clusterRow([permittedLabel, blockedLabel]));

      await callRoute(clusterId.toString(), { nodeName: "pve1" });

      const fetchModel: () => Promise<unknown> = (
        checkUpdatePermissionByModel.mock.calls[0]![0] as {
          fetchModelWithAccessControlIds: () => Promise<unknown>;
        }
      ).fetchModelWithAccessControlIds;

      expect(labelIdsOf(await fetchModel())).toEqual([
        permittedLabel.toString(),
        blockedLabel.toString(),
      ]);
    });

    test("loads the cluster with every label once per request, however often the per-row check asks", async () => {
      findOneBy.mockResolvedValue(clusterRow());
      const loaded: ProxmoxCluster = clusterRow([ObjectID.generate()]);
      findOneById.mockResolvedValue(loaded);

      // The block check and the allow check both ask; ask a third time too.
      const answers: Array<unknown> = [];
      checkUpdatePermissionByModel.mockImplementation(
        async (data: ByModelCheckInput): Promise<void> => {
          answers.push(await data.fetchModelWithAccessControlIds());
          answers.push(await data.fetchModelWithAccessControlIds());
          answers.push(await data.fetchModelWithAccessControlIds());
        },
      );

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(0);
      expect(findOneById).toHaveBeenCalledTimes(1);
      expect(answers).toEqual([loaded, loaded, loaded]);
      for (const answer of answers) {
        expect(answer).toBe(loaded);
      }
      expect(sentBody()).toEqual({ removed: true });
    });

    test("never reuses one request's labels load in the next request", async () => {
      findOneBy.mockResolvedValue(clusterRow());
      const first: ProxmoxCluster = clusterRow([ObjectID.generate()]);
      const second: ProxmoxCluster = clusterRow([
        ObjectID.generate(),
        ObjectID.generate(),
      ]);
      findOneById.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

      const answers: Array<unknown> = [];
      checkUpdatePermissionByModel.mockImplementation(
        async (data: ByModelCheckInput): Promise<void> => {
          answers.push(await data.fetchModelWithAccessControlIds());
          answers.push(await data.fetchModelWithAccessControlIds());
        },
      );

      await callRoute(clusterId.toString(), { nodeName: "pve1" });
      await callRoute(clusterId.toString(), { nodeName: "pve1" });

      // One load per request: labels changed in between are seen.
      expect(findOneById).toHaveBeenCalledTimes(2);
      expect(answers).toHaveLength(4);
      expect(answers[0]).toBe(first);
      expect(answers[1]).toBe(first);
      expect(answers[2]).toBe(second);
      expect(answers[3]).toBe(second);
    });

    test("answers the same NotFound for a cluster deleted between the scoped lookup and the labels load", async () => {
      // Found by the scoped lookup, gone by the time its labels are loaded.
      findOneBy.mockResolvedValue(clusterRow());
      findOneById.mockResolvedValue(null);
      // Like the real check: it asks for the row before deciding.
      checkUpdatePermissionByModel.mockImplementation(
        async (data: ByModelCheckInput): Promise<void> => {
          await data.fetchModelWithAccessControlIds();
        },
      );

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
      expect((call.thrown as Exception).code).toBe(404);
      expect(findOneById).toHaveBeenCalledTimes(1);
    });

    test("hands a failure of the labels load to next() unchanged", async () => {
      findOneBy.mockResolvedValue(clusterRow());
      const failure: Error = new Error("postgres is away");
      findOneById.mockRejectedValue(failure);
      checkUpdatePermissionByModel.mockImplementation(
        async (data: ByModelCheckInput): Promise<void> => {
          await data.fetchModelWithAccessControlIds();
        },
      );

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBe(failure);
      expectNothingDone();
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

      /*
       * The cluster's label join table, as the database would describe it:
       * a team's block with labels narrows the lookup itself, with a
       * condition on the cluster's id against this table.
       */
      jest
        .spyOn(QueryUtil, "getManyToManyRelationMetadata")
        .mockImplementation((modelType: unknown, column: string) => {
          if (modelType !== ProxmoxCluster || column !== "labels") {
            return null;
          }

          return {
            joinTableName: "ProxmoxClusterLabel",
            ownerColumnName: "proxmoxClusterId",
            relationColumnName: "labelId",
          };
        });
    });

    /*
     * What a lookup's condition on the cluster's id says: the id it names,
     * and the labels a team's block leaves out (the "NOT IN" condition the
     * label rule adds), whatever the shape - a plain id, or the id and the
     * block's condition together.
     */
    function idConditions(idFilter: unknown): {
      id: string | null;
      blockedLabelIds: Array<string>;
    } {
      if (typeof idFilter === "string") {
        return { id: idFilter, blockedLabelIds: [] };
      }

      const parts: Array<FindOperator<unknown>> = [];
      const walk: (operator: FindOperator<unknown>) => void = (
        operator: FindOperator<unknown>,
      ): void => {
        if (operator.type === "and") {
          for (const part of operator.value as unknown as Array<
            FindOperator<unknown>
          >) {
            walk(part);
          }
          return;
        }
        parts.push(operator);
      };

      if (idFilter instanceof FindOperator) {
        walk(idFilter);
      }

      let id: string | null = null;
      const blockedLabelIds: Array<string> = [];

      for (const part of parts) {
        if (part.type === "equal") {
          id = String(part.value);
          continue;
        }

        const sql: string = part.getSql ? part.getSql("id") : "";
        const values: Array<unknown> = Object.values(
          part.objectLiteralParameters || {},
        ).flat();

        if (sql.includes("NOT IN (SELECT")) {
          blockedLabelIds.push(
            ...values.map((value: unknown): string => {
              return String(value);
            }),
          );
        } else if (values.length === 1) {
          id = String(values[0]);
        }
      }

      return { id, blockedLabelIds };
    }

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
      return idConditions(
        ((findOneBy.mock.calls[0]![0] as JSONObject)["query"] as JSONObject)[
          "_id"
        ],
      ).id;
    }

    // The labels a team's block leaves out of the lookup.
    function scopedBlockedLabelIds(): Array<string> {
      expect(findOneBy).toHaveBeenCalledTimes(1);
      return idConditions(
        ((findOneBy.mock.calls[0]![0] as JSONObject)["query"] as JSONObject)[
          "_id"
        ],
      ).blockedLabelIds;
    }

    /*
     * The labels a lookup query is narrowed to, or null when it is not.
     * The real check adds { labels: { _id: <operator over the permitted
     * ids> } } for a label-scoped grant.
     */
    function permittedLabelIds(query: JSONObject): Array<string> | null {
      const predicate: unknown = query["labels"];
      if (predicate === undefined || predicate === null) {
        return null;
      }

      const idFilter: unknown = (predicate as JSONObject)["_id"];
      if (!(idFilter instanceof FindOperator)) {
        throw new Error(
          `Unexpected label predicate: ${JSON.stringify(predicate)}`,
        );
      }

      let ids: Array<string> = [];
      for (const value of Object.values(
        idFilter.objectLiteralParameters || {},
      )) {
        const values: Array<unknown> = Array.isArray(value) ? value : [value];
        ids = ids.concat(
          values.map((id: unknown): string => {
            return String(id);
          }),
        );
      }
      return ids;
    }

    function scopedLabelIds(): Array<string> | null {
      expect(findOneBy).toHaveBeenCalledTimes(1);
      return permittedLabelIds(
        (findOneBy.mock.calls[0]![0] as JSONObject)["query"] as JSONObject,
      );
    }

    /*
     * The cluster as the database holds it, served the way each lookup
     * would serve it. The scoped lookup (findOneBy) applies the label
     * predicate the real check adds: it finds the row only when one of
     * its labels is permitted, and labels selected through it come back
     * narrowed to the permitted ones, as with a filtered join. That
     * narrowing is what once hid a blocked label from the per-row check,
     * so it is kept here. The root load (findOneById) has every label.
     */
    function storeCluster(labelIds: Array<ObjectID>): void {
      findOneBy.mockImplementation(
        async (args: unknown): Promise<ProxmoxCluster | null> => {
          const findArgs: JSONObject = args as JSONObject;
          const query: JSONObject = findArgs["query"] as JSONObject;
          const conditions: { id: string | null; blockedLabelIds: Array<string> } =
            idConditions(query["_id"]);
          if (conditions.id !== clusterId.toString()) {
            return null;
          }

          // A team's block with labels leaves out a cluster carrying one.
          if (
            labelIds.some((labelId: ObjectID): boolean => {
              return conditions.blockedLabelIds.includes(labelId.toString());
            })
          ) {
            return null;
          }

          const permitted: Array<string> | null = permittedLabelIds(query);
          const visible: Array<ObjectID> =
            permitted === null
              ? labelIds
              : labelIds.filter((labelId: ObjectID): boolean => {
                  return permitted.includes(labelId.toString());
                });
          if (permitted !== null && visible.length === 0) {
            return null;
          }

          const select: JSONObject =
            (findArgs["select"] as JSONObject | undefined) || {};
          if (select["labels"]) {
            return clusterRow(visible);
          }
          const row: ProxmoxCluster = new ProxmoxCluster();
          row.id = clusterId;
          row.projectId = projectId;
          return row;
        },
      );

      findOneById.mockImplementation(
        async (args: unknown): Promise<ProxmoxCluster | null> => {
          const loadArgs: JSONObject = args as JSONObject;
          if (String(loadArgs["id"]) !== clusterId.toString()) {
            return null;
          }
          return clusterRow(labelIds);
        },
      );
    }

    function expectLabelsLoadedUnfiltered(): void {
      // Once per request, however many of the checks asked.
      expect(findOneById).toHaveBeenCalledTimes(1);
      for (const loadCall of findOneById.mock.calls) {
        const loadArgs: JSONObject = loadCall[0] as JSONObject;
        expect((loadArgs["id"] as ObjectID).toString()).toBe(
          clusterId.toString(),
        );
        expect(loadArgs["select"]).toEqual(UNFILTERED_LOAD_SELECT);
        expect(loadArgs["props"]).toEqual({ isRoot: true });
      }
      // After the scoped lookup found the row, never instead of it.
      expect(findOneBy.mock.invocationCallOrder[0]!).toBeLessThan(
        findOneById.mock.invocationCallOrder[0]!,
      );
    }

    /*
     * Runs the real per-row check, counting how often it asks for the
     * cluster with its labels: the block check asks under a labelled block
     * on the edit permission, the allow check under a label-scoped grant.
     */
    function countLabelAsks(): LabelAsks {
      const asks: LabelAsks = { count: 0 };
      const realCheck: (data: ByModelCheckInput) => Promise<void> =
        ModelPermission.checkUpdatePermissionByModel.bind(ModelPermission);

      checkUpdatePermissionByModel = jest.spyOn(
        ModelPermission,
        "checkUpdatePermissionByModel",
      );
      checkUpdatePermissionByModel.mockImplementation(
        async (data: ByModelCheckInput): Promise<void> => {
          return realCheck({
            ...data,
            fetchModelWithAccessControlIds: (): FetchedForCheck => {
              asks.count++;
              return data.fetchModelWithAccessControlIds();
            },
          });
        },
      );

      return asks;
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
      storeCluster([ObjectID.generate(), blockedLabel]);

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expectRefusedAsNotFound(call);
      // A project-wide grant: the lookup is not label-scoped...
      expect(scopedLabelIds()).toBeNull();
      // ...but the block leaves the cluster out of it, as an update's would.
      expect(scopedBlockedLabelIds()).toEqual([blockedLabel.toString()]);
      expect(scopedClusterId()).toBe(clusterId.toString());
      // Never found, so nothing is loaded and nothing removed.
      expect(findOneById).not.toHaveBeenCalled();
      expect(removeOfflineNode).not.toHaveBeenCalled();
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
      storeCluster([ObjectID.generate()]);

      const call: RouteCall = await callRoute(clusterId.toString(), {
        nodeName: "pve1",
      });

      expect(call.nextCallCount).toBe(0);
      expect(sentBody()).toEqual({ removed: true });
      expectLabelsLoadedUnfiltered();
    });

    describe("a label-scoped edit grant and a team block on another label of the same cluster", () => {
      /*
       * The caller may edit (and read) clusters labelled A; the caller's
       * team blocks editing clusters labelled B. A cluster carrying both
       * is found by the label-A-scoped lookup, so only the per-row block
       * check can refuse it, and only if it sees label B. Labels loaded
       * through the scoped lookup would carry A alone.
       */
      let labelA: ObjectID;
      let labelB: ObjectID;

      beforeEach(() => {
        labelA = ObjectID.generate();
        labelB = ObjectID.generate();
        props = propsWith([
          { permission: Permission.EditProxmoxCluster, labelIds: [labelA] },
          { permission: Permission.ReadProxmoxCluster, labelIds: [labelA] },
          {
            permission: Permission.EditProxmoxCluster,
            isBlockPermission: true,
            labelIds: [labelB],
          },
        ]);
      });

      test("a cluster carrying A and B is refused with the same NotFound, and nothing is removed", async () => {
        storeCluster([labelA, labelB]);

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expectRefusedAsNotFound(call);
        expect((call.thrown as Exception).code).toBe(404);
        expect(removeOfflineNode).not.toHaveBeenCalled();

        // The lookup really was narrowed to label A, and leaves out B...
        expect(scopedLabelIds()).toEqual([labelA.toString()]);
        expect(scopedBlockedLabelIds()).toEqual([labelB.toString()]);
        expect(scopedClusterId()).toBe(clusterId.toString());
        expect(scopedProjectIds()).toEqual([projectId.toString()]);
        expect((findOneBy.mock.calls[0]![0] as JSONObject)["select"]).toEqual({
          _id: true,
          projectId: true,
        });
        // ...so the cluster is never found, and nothing is loaded.
        expect(findOneById).not.toHaveBeenCalled();
      });

      test("the order of the labels on the cluster does not matter", async () => {
        storeCluster([labelB, labelA]);

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expectRefusedAsNotFound(call);
      });

      test("a cluster carrying only A may have a node removed", async () => {
        storeCluster([labelA]);

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expect(call.nextCallCount).toBe(0);
        expect(scopedLabelIds()).toEqual([labelA.toString()]);
        expectLabelsLoadedUnfiltered();
        expect(removeArgs()["externalId"]).toBe("node/pve1");
        expect(sentBody()).toEqual({ removed: true });
      });

      test("a cluster carrying A and an unblocked label C may have a node removed", async () => {
        storeCluster([labelA, ObjectID.generate()]);

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expect(call.nextCallCount).toBe(0);
        expect(sentBody()).toEqual({ removed: true });
      });

      test("a cluster carrying only B is never found, so nothing is loaded or removed", async () => {
        storeCluster([labelB]);

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expectRefusedAsNotFound(call);
        expect(findOneById).not.toHaveBeenCalled();
      });

      test("without the block the same caller may remove a node on a cluster carrying A and B", async () => {
        props = propsWith([
          { permission: Permission.EditProxmoxCluster, labelIds: [labelA] },
          { permission: Permission.ReadProxmoxCluster, labelIds: [labelA] },
        ]);
        storeCluster([labelA, labelB]);

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expect(call.nextCallCount).toBe(0);
        expectLabelsLoadedUnfiltered();
        expect(sentBody()).toEqual({ removed: true });
      });

      test.each([
        ["only A", false],
        ["A and an unblocked label C", true],
      ] as Array<[string, boolean]>)(
        "on a cluster carrying %s both checks ask for its labels, and it is loaded once",
        async (_label: string, withUnblockedLabel: boolean) => {
          storeCluster(
            withUnblockedLabel ? [labelA, ObjectID.generate()] : [labelA],
          );
          const asks: LabelAsks = countLabelAsks();

          const call: RouteCall = await callRoute(clusterId.toString(), {
            nodeName: "pve1",
          });

          expect(call.nextCallCount).toBe(0);
          // The block check (B is not on it) and then the allow check (A is).
          expect(asks.count).toBe(2);
          expect(findOneById).toHaveBeenCalledTimes(1);
          expectLabelsLoadedUnfiltered();
          expect(sentBody()).toEqual({ removed: true });
        },
      );

      test("on a cluster carrying A and B the lookup leaves it out: no check asks, and nothing is loaded", async () => {
        storeCluster([labelA, labelB]);
        const asks: LabelAsks = countLabelAsks();

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expectRefusedAsNotFound(call);
        expect(asks.count).toBe(0);
        expect(findOneById).not.toHaveBeenCalled();
      });

      test("a cluster deleted between the scoped lookup and the labels load answers 404 with the editable-cluster message", async () => {
        storeCluster([labelA]);
        // Found through the label-A-scoped lookup; gone when loaded as root.
        findOneById.mockResolvedValue(null);
        const asks: LabelAsks = countLabelAsks();

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        /*
         * Not the real check's own "ProxmoxCluster not found." (a 400),
         * which would tell a missing cluster apart from a forbidden one.
         */
        expectRefusedAsNotFound(call);
        expect((call.thrown as Exception).code).toBe(404);
        expect(call.thrown).not.toBeInstanceOf(BadDataException);
        expect(scopedLabelIds()).toEqual([labelA.toString()]);
        // The block check asked first and got the refusal; nothing asked again.
        expect(asks.count).toBe(1);
        expectLabelsLoadedUnfiltered();
      });

      test("the labels are loaded afresh for every request: a block label added after one removal refuses the next", async () => {
        storeCluster([labelA]);
        const asks: LabelAsks = countLabelAsks();

        const first: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });
        expect(first.nextCallCount).toBe(0);
        expect(sentBody()).toEqual({ removed: true });

        // Label B is put on the cluster before the next request.
        storeCluster([labelA, labelB]);

        const second: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve2",
        });

        expect(second.nextCallCount).toBe(1);
        expect(second.thrown).toBeInstanceOf(NotFoundException);
        expect((second.thrown as NotFoundException).message).toBe(
          NOT_FOUND_MESSAGE,
        );
        /*
         * The first request loaded the labels once, for both checks; the
         * second never found the cluster (the block on B leaves it out of
         * the lookup), so it loaded nothing and no check asked.
         */
        expect(findOneById).toHaveBeenCalledTimes(1);
        expect(asks.count).toBe(2);
        // Only the first request removed anything.
        expect(removeOfflineNode).toHaveBeenCalledTimes(1);
        expect(
          (removeOfflineNode.mock.calls[0]![0] as JSONObject)["externalId"],
        ).toBe("node/pve1");
        expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
      });
    });

    test.each([
      ["a label-scoped grant alone (only the allow check asks)", false, true],
      [
        "a project-wide grant and a labelled block (only the block check asks)",
        true,
        false,
      ],
    ] as Array<[string, boolean, boolean]>)(
      "a cluster deleted before the labels load answers the same 404 under %s",
      async (_label: string, withBlock: boolean, labelScoped: boolean) => {
        const labelA: ObjectID = ObjectID.generate();
        const grants: Array<PermissionGrant> = labelScoped
          ? [
              { permission: Permission.EditProxmoxCluster, labelIds: [labelA] },
              { permission: Permission.ReadProxmoxCluster, labelIds: [labelA] },
            ]
          : [{ permission: Permission.ProjectMember }];
        if (withBlock) {
          grants.push({
            permission: Permission.EditProxmoxCluster,
            isBlockPermission: true,
            labelIds: [ObjectID.generate()],
          });
        }
        props = propsWith(grants);
        storeCluster([labelA]);
        findOneById.mockResolvedValue(null);
        const asks: LabelAsks = countLabelAsks();

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expectRefusedAsNotFound(call);
        expect((call.thrown as Exception).code).toBe(404);
        expect(asks.count).toBe(1);
        expectLabelsLoadedUnfiltered();
      },
    );

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

    test("answers 200 with removed: true when the service removed the node", async () => {
      removeOfflineNode.mockResolvedValue(REMOVED);

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

    test.each([
      [
        "not-found",
        "404: the node is not in the inventory (it may already be gone)",
        NotFoundException,
        404,
        NODE_NOT_FOUND_MESSAGE,
      ],
      [
        "not-native",
        "400: an agent node, which leaves on its own",
        BadDataException,
        400,
        NOT_NATIVE_MESSAGE,
      ],
      [
        "still-reporting",
        "400: the node is still up and would come back",
        BadDataException,
        400,
        STILL_REPORTING_MESSAGE,
      ],
    ] as Array<
      [
        ProxmoxRemoveNodeResult,
        string,
        new (message: string) => Exception,
        number,
        string,
      ]
    >)(
      "answers %s as %s",
      async (
        result: ProxmoxRemoveNodeResult,
        _meaning: string,
        exceptionType: new (message: string) => Exception,
        status: number,
        message: string,
      ) => {
        removeOfflineNode.mockResolvedValue(result);

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expect(call.nextCallCount).toBe(1);
        expect(call.thrown).toBeInstanceOf(exceptionType);
        expect((call.thrown as Exception).code).toBe(status);
        expect((call.thrown as Exception).message).toBe(message);
        expect(removeOfflineNode).toHaveBeenCalledTimes(1);
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["a boolean true from a stale mock of the old boolean contract", true],
      ["a boolean false", false],
      ["an unknown string", "deleted"],
      ["an empty string", ""],
      ["the right word in the wrong case", "Removed"],
      ["the right word padded", " removed "],
      ["a known reason in the wrong case", "Not-Found"],
      ["a number", 1],
      ["null", null],
      ["undefined", undefined],
      ["an object claiming success", { removed: true }],
      ["an array holding the right word", ["removed"]],
    ] as Array<[string, unknown]>)(
      "answers 400, never 200, when the service returns %s",
      async (_label: string, unexpected: unknown) => {
        removeOfflineNode.mockResolvedValue(unexpected);

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        expect(removeOfflineNode).toHaveBeenCalledTimes(1);
        expect(call.nextCallCount).toBe(1);
        expect(call.thrown).toBeInstanceOf(BadDataException);
        expect((call.thrown as Exception).code).toBe(400);
        // The conservative explanation: not claimed removed, not claimed missing.
        expect((call.thrown as Exception).message).toBe(
          STILL_REPORTING_MESSAGE,
        );
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
        expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
        expect(Response.sendEntityResponse).not.toHaveBeenCalled();
      },
    );

    test('only the exact result "removed" answers 200', async () => {
      const results: Array<unknown> = [
        true,
        "Removed",
        "removed",
        "not-found",
        "not-native",
        "still-reporting",
        "unknown",
      ];
      const answeredOk: Array<unknown> = [];

      for (const result of results) {
        jest.clearAllMocks();
        removeOfflineNode.mockResolvedValue(result);

        const call: RouteCall = await callRoute(clusterId.toString(), {
          nodeName: "pve1",
        });

        if (call.nextCallCount === 0) {
          answeredOk.push(result);
        }
      }

      expect(answeredOk).toEqual(["removed"]);
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
