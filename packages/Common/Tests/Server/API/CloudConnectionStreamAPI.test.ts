import CloudConnectionAPI from "../../../Server/API/CloudConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import CloudStreamAuthenticator from "../../../Server/Utils/CloudConnection/CloudStreamAuthentication";
import CloudStreamKeys from "../../../Server/Utils/CloudConnection/CloudStreamKeys";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
  CloudStreamKeyHashes,
  parseCloudStreamKey,
  readCloudStreamKeyHashes,
} from "../../../Types/CloudConnection/CloudStream";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * The two routes behind Stream metrics and logs: a new stream key for an
 * AWS connection of the caller's project - answered this once, kept only as
 * its SHA-256, the key it replaces working a day more - and Stop streaming,
 * after which no key of the connection works. Project owners and admins
 * only; never another project's connection, nor another cloud's. `jest` is
 * the global one.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;
const recordedRoutes: Array<{
  method: string;
  uri: string;
  handlers: Array<Handler>;
}> = [];

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      const record: (
        method: string,
      ) => (uri: string, ...handlers: Array<Handler>) => void = (
        method: string,
      ) => {
        return (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ method, uri, handlers });
        };
      };

      return {
        post: record("post"),
        get: record("get"),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

let props: DatabaseCommonInteractionProps;
let streamKeyHandler: Handler;
let stopHandler: Handler;
let next: jest.Mock;
let accessible: CloudConnection | null;
let stored: CloudConnection;
let writes: Array<JSONObject>;
const res: ExpressResponse = {} as ExpressResponse;

function setPermission(permission: Permission): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  };
}

function route(method: string, uri: string): { handlers: Array<Handler> } {
  const found: { handlers: Array<Handler> } | undefined = recordedRoutes.find(
    (item: { method: string; uri: string }) => {
      return item.method === method && item.uri === uri;
    },
  );
  expect(found).toBeDefined();
  return found!;
}

function request(params: JSONObject): ExpressRequest {
  return { body: {}, params } as unknown as ExpressRequest;
}

function sent(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0]![2] as JSONObject;
}

beforeAll(() => {
  new CloudConnectionAPI();
  streamKeyHandler = route(
    "post",
    "/cloud-connection/:connectionId/stream-key",
  ).handlers.slice(-1)[0]!;
  stopHandler = route(
    "post",
    "/cloud-connection/:connectionId/stop-streaming",
  ).handlers.slice(-1)[0]!;
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermission(Permission.ProjectAdmin);
  next = jest.fn();
  writes = [];

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  accessible = new CloudConnection();
  accessible.id = CONNECTION;
  accessible.projectId = PROJECT;
  accessible.provider = CloudProvider.AWS;

  stored = new CloudConnection();
  stored.id = CONNECTION;
  stored.provider = CloudProvider.AWS;

  jest
    .spyOn(CloudConnectionService, "findOneBy")
    .mockImplementation((async () => {
      return accessible;
    }) as never);
  jest
    .spyOn(CloudConnectionService, "findOneById")
    .mockImplementation((async () => {
      return stored;
    }) as never);
  jest
    .spyOn(CloudConnectionService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: JSONObject }) => {
      writes.push(data.data);
      stored.streamKeyHashes = data.data["streamKeyHashes"] as JSONObject;
    }) as never);
  // A new key is written only over the hashes it was rotated from, as Postgres would.
  jest
    .spyOn(CloudConnectionService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      data: JSONObject;
      expectedData: JSONObject;
    }) => {
      if (
        JSON.stringify(stored.streamKeyHashes ?? null) !==
        JSON.stringify(data.expectedData["streamKeyHashes"] ?? null)
      ) {
        return false;
      }

      writes.push(data.data);
      stored.streamKeyHashes = data.data["streamKeyHashes"] as JSONObject;
      return true;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("route registration", () => {
  test.each([
    ["post", "/cloud-connection/:connectionId/stream-key"],
    ["post", "/cloud-connection/:connectionId/stop-streaming"],
  ])(
    "%s %s resolves the user and requires authentication before its handler",
    (method: string, uri: string) => {
      expect(route(method, uri).handlers.slice(0, 2)).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
      expect(route(method, uri).handlers).toHaveLength(3);
    },
  );
});

describe("POST /cloud-connection/:connectionId/stream-key", () => {
  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s gets a new key for the connection, shown once and kept only as its hash",
    async (permission: Permission) => {
      setPermission(permission);
      const forget: jest.SpyInstance = jest.spyOn(
        CloudStreamAuthenticator,
        "forget",
      );

      await streamKeyHandler(
        request({ connectionId: CONNECTION.toString() }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();

      const answer: JSONObject = sent();
      const streamKey: string = answer["streamKey"] as string;

      expect(parseCloudStreamKey(streamKey)?.connectionId).toBe(
        CONNECTION.toString(),
      );
      expect(answer["previousKeyWorksUntil"]).toBeNull();
      expect(typeof answer["createdAt"]).toBe("string");

      // What is stored is the hash: never the key, never its secret.
      expect(writes).toHaveLength(1);
      expect(JSON.stringify(writes[0])).not.toContain(streamKey.split("_")[2]!);

      const hashes: CloudStreamKeyHashes = readCloudStreamKeyHashes(
        writes[0]!["streamKeyHashes"],
      );

      expect(hashes.current?.hash).toBe(CloudStreamKeys.hash(streamKey));
      expect(writes[0]!["streamKeyCreatedAt"]).toEqual(
        new Date(answer["createdAt"] as string),
      );
      // This process takes the new key at once.
      expect(forget).toHaveBeenCalledWith(CONNECTION);
    },
  );

  test("a second key leaves the first working for a day", async () => {
    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );
    const first: string = sent()["streamKey"] as string;
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();

    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );
    const answer: JSONObject = sent();
    const hashes: CloudStreamKeyHashes = readCloudStreamKeyHashes(
      writes[1]!["streamKeyHashes"],
    );

    expect(answer["streamKey"]).not.toBe(first);
    expect(hashes.current?.hash).toBe(
      CloudStreamKeys.hash(answer["streamKey"] as string),
    );
    expect(hashes.previous?.[0]?.hash).toBe(CloudStreamKeys.hash(first));
    expect(
      Date.parse(hashes.previous![0]!.expiresAt) -
        Date.parse(answer["createdAt"] as string),
    ).toBe(CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS);
    expect(answer["previousKeyWorksUntil"]).toBe(
      hashes.previous![0]!.expiresAt,
    );
  });

  test("a key made twice before the command ran leaves the streams' first key working", async () => {
    const keys: Array<string> = [];

    for (let index: number = 0; index < 3; index++) {
      await streamKeyHandler(
        request({ connectionId: CONNECTION.toString() }),
        res,
        next,
      );
      keys.push(sent()["streamKey"] as string);
      (Response.sendJsonObjectResponse as jest.Mock).mockClear();
    }

    const hashes: CloudStreamKeyHashes = readCloudStreamKeyHashes(
      writes[2]!["streamKeyHashes"],
    );

    expect(hashes.current?.hash).toBe(CloudStreamKeys.hash(keys[2]!));
    expect(
      (hashes.previous || []).map((item: { hash: string }) => {
        return item.hash;
      }),
    ).toEqual([CloudStreamKeys.hash(keys[1]!), CloudStreamKeys.hash(keys[0]!)]);
  });

  test.each([
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadCloudResource,
  ])("%s may not make a key", async (permission: Permission) => {
    setPermission(permission);

    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(writes).toHaveLength(0);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("another project's connection, or no id, is refused", async () => {
    accessible = null;

    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );
    await streamKeyHandler(request({ connectionId: "x" }), res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(0);
  });

  test("an Azure or Google Cloud connection does not stream through Firehose", async () => {
    accessible!.provider = CloudProvider.Azure;

    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect((next.mock.calls[0]![0] as Error).message).toContain(
      "Only AWS connections stream",
    );
    expect(writes).toHaveLength(0);
  });
});

describe("POST /cloud-connection/:connectionId/stop-streaming", () => {
  test("stops every key of the connection at once", async () => {
    const forget: jest.SpyInstance = jest.spyOn(
      CloudStreamAuthenticator,
      "forget",
    );

    await stopHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(sent()).toEqual({ stopped: true });
    expect(writes).toEqual([
      { streamKeyHashes: null, streamKeyCreatedAt: null },
    ]);
    expect(forget).toHaveBeenCalledWith(CONNECTION);
  });

  test("a member may not stop it", async () => {
    setPermission(Permission.ProjectMember);

    await stopHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(writes).toHaveLength(0);
  });
});
