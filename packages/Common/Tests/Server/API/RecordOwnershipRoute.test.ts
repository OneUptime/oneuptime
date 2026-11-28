jest.mock("../../../Server/Utils/Logger");

jest.mock("isolated-vm", () => {
  return {};
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import RecordOwnershipRoute from "../../../Server/API/RecordOwnershipRoute";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DatabaseService from "../../../Server/Services/DatabaseService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import RecordOwnershipReader from "../../../Server/Utils/RecordAccess/RecordOwnershipReader";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { RecordOwners } from "../../../Types/LabelAccess/LabelAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import RecordOwnership, {
  RecordOwnershipResult,
} from "../../../Types/RecordAccess/RecordOwnership";
import UserType from "../../../Types/UserType";
import { tenantPermissionsFor } from "./PermissionRows";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * POST /<record>/record-ownership: WHO OWNS THE RECORDS A PAGE SHOWS
 * (#11436). Registered on the CRUD path of every kind with owner tables,
 * behind the session guards; it reads the records as the caller first, so
 * only those they may read are answered, and answers who owns each from the
 * Owned scope's own lookups (OwnedScopePermission.getOwnersOf), with the
 * tables and operations the owners decide. The answer is never cached.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11436000-0000-4000-8000-000000000a01",
);
const USER_ID: ObjectID = new ObjectID("11436000-0000-4000-8000-000000000a02");
const TEAM_ID: ObjectID = new ObjectID("11436000-0000-4000-8000-000000000a03");
const READABLE: string = "11436000-0000-4000-8000-000000000ac1";
const UNREADABLE: string = "11436000-0000-4000-8000-000000000ac2";

type RouteFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> | void;

const MEMBER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
  userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, [
    {
      _type: "UserPermission",
      permission: Permission.MonitorAdmin,
      labelIds: [],
      isBlockPermission: false,
      scope: PermissionScope.Owned,
      teamId: TEAM_ID,
    },
  ]),
};

afterEach(() => {
  jest.restoreAllMocks();
});

// The route's paths a router was handed, by method.
const routesOf: (router: ExpressRouter) => Array<string> = (
  router: ExpressRouter,
): Array<string> => {
  return (
    (
      router as unknown as {
        stack: Array<{
          route?: { path: string; methods: Record<string, boolean> };
        }>;
      }
    ).stack || []
  )
    .filter((layer: { route?: unknown }): boolean => {
      return Boolean(layer.route);
    })
    .map(
      (layer: {
        route?: { path: string; methods: Record<string, boolean> };
      }): string => {
        return `${Object.keys(layer.route!.methods).join(",").toUpperCase()} ${layer.route!.path}`;
      },
    );
};

describe("where the route is served", () => {
  it("on the CRUD path of a kind with owner tables, as a POST behind the session guards", () => {
    const routes: Array<string> = routesOf(
      new BaseAPI<Monitor, DatabaseService<BaseModel>>(
        Monitor,
        MonitorService as unknown as DatabaseService<BaseModel>,
      ).getRouter(),
    );

    expect(routes).toContain("POST /monitor/record-ownership");
  });

  it("not on a kind without owners", () => {
    const routes: Array<string> = routesOf(
      new BaseAPI<Label, DatabaseService<BaseModel>>(
        Label,
        LabelService as unknown as DatabaseService<BaseModel>,
      ).getRouter(),
    );

    expect(
      routes.some((route: string): boolean => {
        return route.includes("record-ownership");
      }),
    ).toBe(false);
  });

  it("registers the session guards before the handler", () => {
    const posts: Array<{ path: string; functions: Array<RouteFunction> }> = [];

    RecordOwnershipRoute.register({
      router: {
        post: (path: string, ...functions: Array<RouteFunction>) => {
          posts.push({ path: path, functions: functions });
        },
      } as unknown as ExpressRouter,
      apiPath: "/monitor",
      service: MonitorService as unknown as DatabaseService<BaseModel>,
    });

    expect(posts.length).toBe(1);
    expect(posts[0]!.path).toBe("/monitor/record-ownership");
    expect(posts[0]!.functions[0]).toBe(UserMiddleware.getUserMiddleware);
    expect(posts[0]!.functions[1]).toBe(
      UserMiddleware.requireUserAuthentication,
    );
  });
});

describe("what the route answers", () => {
  const RESULT: RecordOwnershipResult = {
    tableName: "Monitor",
    tables: [{ tableName: "Monitor", key: "_id", operations: ["update"] }],
    records: { [READABLE]: { isOwnedByCaller: true, teamIds: [] } },
  };

  const ask: (
    body: unknown,
    props?: DatabaseCommonInteractionProps,
  ) => Promise<{
    sent: ReturnType<typeof jest.spyOn>;
    noCache: ReturnType<typeof jest.spyOn>;
    read: ReturnType<typeof jest.spyOn>;
  }> = async (
    body: unknown,
    props: DatabaseCommonInteractionProps = MEMBER,
  ) => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
    const sent: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation((() => {
        return undefined;
      }) as never);
    const noCache: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Response, "setNoCacheHeaders")
      .mockImplementation((() => {
        return undefined;
      }) as never);
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(RecordOwnershipReader, "read")
      .mockResolvedValue(RESULT);

    await RecordOwnershipRoute.handle(
      { body: body } as unknown as ExpressRequest,
      {} as ExpressResponse,
      MonitorService as unknown as DatabaseService<BaseModel>,
    );

    return { sent: sent, noCache: noCache, read: read };
  };

  it("who owns the records asked about, as JSON, never cached", async () => {
    const answer: Awaited<ReturnType<typeof ask>> = await ask({
      ids: [READABLE.toUpperCase()],
    });

    expect(answer.noCache).toHaveBeenCalledTimes(1);
    expect(answer.sent.mock.calls[0]![2]).toEqual(
      RecordOwnership.toJSON(RESULT),
    );
    expect(
      (answer.read.mock.calls[0]![0] as { ids: Array<string> }).ids,
    ).toEqual([READABLE]);
  });

  it("refuses a body that names no records, saying what to send", async () => {
    await expect(ask({ monitorIds: [READABLE] })).rejects.toThrow(
      BadDataException,
    );
    await expect(ask(undefined)).rejects.toThrow(
      'Name the records to ask about by their IDs: { "ids": ["<record ID>"] }.',
    );
  });

  it("refuses a caller in no project", async () => {
    await expect(
      ask({ ids: [READABLE] }, { ...MEMBER, tenantId: undefined }),
    ).rejects.toThrow();
  });
});

describe("the reader: only what the caller may read, by the scope's own lookups", () => {
  it("reads the records as the caller, and answers who owns the ones they may read", async () => {
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([{ _id: READABLE.toUpperCase() } as never]);
    const ownersOf: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OwnedScopePermission, "getOwnersOf")
      .mockResolvedValue(
        new Map<string, RecordOwners>([
          [READABLE, { isOwnedByCaller: false, teamIds: [TEAM_ID.toString()] }],
        ]),
      );

    const result: RecordOwnershipResult = await RecordOwnershipReader.read({
      service: MonitorService as unknown as DatabaseService<BaseModel>,
      ids: [READABLE, UNREADABLE],
      props: MEMBER,
    });

    // Read as the caller: the read rule every page's read follows.
    expect((find.mock.calls[0]![0] as { props: unknown }).props).toBe(MEMBER);
    expect(
      JSON.stringify((find.mock.calls[0]![0] as { query: unknown }).query),
    ).toContain(UNREADABLE);

    // Owners looked up for the readable record alone, with the caller's Owned grants' teams.
    const asked: { resourceIds: Array<string>; teamIds: Array<ObjectID> } =
      ownersOf.mock.calls[0]![0] as never;
    expect(asked.resourceIds).toEqual([READABLE]);
    expect(
      asked.teamIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([TEAM_ID.toString()]);

    expect(result.records).toEqual({
      [READABLE]: { isOwnedByCaller: false, teamIds: [TEAM_ID.toString()] },
    });
    expect(result.tableName).toBe("Monitor");
    expect(result.tables[0]).toEqual({
      tableName: "Monitor",
      key: "_id",
      operations: ["read", "update", "delete"],
    });
  });

  it("asks nothing for no records", async () => {
    const find: ReturnType<typeof jest.spyOn> = jest.spyOn(
      MonitorService,
      "findBy",
    );
    jest
      .spyOn(OwnedScopePermission, "getOwnersOf")
      .mockResolvedValue(new Map());

    const result: RecordOwnershipResult = await RecordOwnershipReader.read({
      service: MonitorService as unknown as DatabaseService<BaseModel>,
      ids: [],
      props: MEMBER,
    });

    expect(find).not.toHaveBeenCalled();
    expect(result.records).toEqual({});
  });
});
