import CloudConnectionAPI from "../../../Server/API/CloudConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import AuditLogService from "../../../Server/Services/AuditLogService";
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
 * The routes behind streaming: a new stream key for an AWS or a Google
 * Cloud connection of the caller's project - answered this once, kept only
 * as its SHA-256, the key it replaces working a day more, a Google Cloud
 * key kept with the push service account its pushes must be signed for -
 * reading turned on for an Azure connection's event hubs, and Stop
 * streaming, after which no key of the connection works and no event hub
 * of it is read. Project owners and admins only; never another project's
 * connection, nor a cloud the route is not for. `jest` is the global one.
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
let startHandler: Handler;
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

function request(params: JSONObject, body: JSONObject = {}): ExpressRequest {
  return { body, params } as unknown as ExpressRequest;
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
  startHandler = route(
    "post",
    "/cloud-connection/:connectionId/start-streaming",
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

      if ("streamKeyHashes" in data.data) {
        stored.streamKeyHashes = data.data["streamKeyHashes"] as JSONObject;
      }

      if ("streamState" in data.data) {
        stored.streamState = data.data["streamState"] as JSONObject;
      }

      if ("streamKeyCreatedAt" in data.data) {
        stored.streamKeyCreatedAt = data.data["streamKeyCreatedAt"] as Date;
      }
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
    ["post", "/cloud-connection/:connectionId/start-streaming"],
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

  test("an Azure connection takes no key: OneUptime reads it, nothing of it pushes", async () => {
    accessible!.provider = CloudProvider.Azure;

    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect((next.mock.calls[0]![0] as Error).message).toContain(
      "only AWS and Google Cloud with a stream key",
    );
    expect(writes).toHaveLength(0);
  });

  test("a Google Cloud key is kept with the push service account of its own service account's project", async () => {
    accessible!.provider = CloudProvider.GCP;
    stored.provider = CloudProvider.GCP;
    stored.config = {
      keyProjectId: "acme-prod-1",
      clientEmail: "oneuptime-read@acme-prod-1.iam.gserviceaccount.com",
    };

    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();

    const answer: JSONObject = sent();
    const pusher: string =
      "oneuptime-push-33333333@acme-prod-1.iam.gserviceaccount.com";

    expect(answer["pushServiceAccount"]).toBe(pusher);
    expect(
      readCloudStreamKeyHashes(writes[0]!["streamKeyHashes"])
        .pushServiceAccount,
    ).toBe(pusher);
  });

  test("a Google Cloud connection that says no project gets no key: its pushes could be checked against no one", async () => {
    accessible!.provider = CloudProvider.GCP;
    stored.provider = CloudProvider.GCP;
    stored.config = {};

    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect((next.mock.calls[0]![0] as Error).message).toContain(
      "does not say which project its service account is from",
    );
    expect(writes).toHaveLength(0);
  });

  test("an AWS key answers no push service account", async () => {
    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(sent()["pushServiceAccount"]).toBeNull();
    expect(
      readCloudStreamKeyHashes(writes[0]!["streamKeyHashes"])
        .pushServiceAccount,
    ).toBeUndefined();
  });
});

describe("POST /cloud-connection/:connectionId/start-streaming", () => {
  const HOST: string = "11111111-aaaa-4aaa-8aaa-111111111111";
  const OTHER_HOST: string = "22222222-bbbb-4bbb-8bbb-222222222222";

  beforeEach(() => {
    accessible!.provider = CloudProvider.Azure;
    stored.provider = CloudProvider.Azure;
  });

  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s turns reading on for the event hubs in the subscription given",
    async (permission: Permission) => {
      setPermission(permission);

      await startHandler(
        request(
          { connectionId: CONNECTION.toString() },
          { hostSubscriptionId: HOST.toUpperCase() },
        ),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();

      const answer: JSONObject = sent();
      expect(typeof answer["startedAt"]).toBe("string");
      expect(writes).toEqual([
        {
          streamKeyCreatedAt: new Date(answer["startedAt"] as string),
          streamState: { hostSubscriptionId: HOST, offsets: {} },
        },
      ]);
    },
  );

  test("turned on again for the same subscription it keeps where the event hubs were read to, and when it started", async () => {
    const startedAt: Date = new Date("2026-11-05T08:00:00.000Z");
    stored.streamKeyCreatedAt = startedAt;
    stored.streamState = {
      hostSubscriptionId: HOST,
      offsets: { "oneuptime-33333333-eastus": { "0": 42 } },
    };

    await startHandler(
      request(
        { connectionId: CONNECTION.toString() },
        { hostSubscriptionId: HOST },
      ),
      res,
      next,
    );

    expect(writes[0]).toEqual({
      streamKeyCreatedAt: startedAt,
      streamState: {
        hostSubscriptionId: HOST,
        offsets: { "oneuptime-33333333-eastus": { "0": 42 } },
      },
    });
  });

  test("for another subscription it starts afresh", async () => {
    stored.streamState = {
      hostSubscriptionId: HOST,
      offsets: { "oneuptime-33333333-eastus": { "0": 42 } },
    };

    await startHandler(
      request(
        { connectionId: CONNECTION.toString() },
        { hostSubscriptionId: OTHER_HOST },
      ),
      res,
      next,
    );

    expect(writes[0]!["streamState"]).toEqual({
      hostSubscriptionId: OTHER_HOST,
      offsets: {},
    });
  });

  test.each([
    ["no subscription", {}],
    ["a subscription that is no ID", { hostSubscriptionId: "prod" }],
    ["a subscription that is not text", { hostSubscriptionId: 42 }],
  ])("%s is refused", async (_name: string, body: JSONObject) => {
    await startHandler(
      request({ connectionId: CONNECTION.toString() }, body),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(writes).toHaveLength(0);
  });

  test.each([CloudProvider.AWS, CloudProvider.GCP])(
    "a %s connection is not read from event hubs",
    async (provider: CloudProvider) => {
      accessible!.provider = provider;

      await startHandler(
        request(
          { connectionId: CONNECTION.toString() },
          { hostSubscriptionId: HOST },
        ),
        res,
        next,
      );

      expect((next.mock.calls[0]![0] as Error).message).toContain(
        "Only Azure connections are read from their event hubs",
      );
      expect(writes).toHaveLength(0);
    },
  );

  test("a member may not turn it on, nor anyone for another project's connection", async () => {
    setPermission(Permission.ProjectMember);
    await startHandler(
      request(
        { connectionId: CONNECTION.toString() },
        { hostSubscriptionId: HOST },
      ),
      res,
      next,
    );

    setPermission(Permission.ProjectAdmin);
    accessible = null;
    await startHandler(
      request(
        { connectionId: CONNECTION.toString() },
        { hostSubscriptionId: HOST },
      ),
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(2);
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

  test.each([CloudProvider.Azure, CloudProvider.GCP])(
    "a %s connection's streaming stops the same way - where its event hubs were read to kept",
    async (provider: CloudProvider) => {
      accessible!.provider = provider;
      stored.provider = provider;

      await stopHandler(
        request({ connectionId: CONNECTION.toString() }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(writes).toEqual([
        { streamKeyHashes: null, streamKeyCreatedAt: null },
      ]);
    },
  );

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

/*
 * Who made a stream key, turned reading on or stopped streaming, in the
 * project's audit log (issue #6276). The routes write round
 * DatabaseService's hooks, so the service records each change itself, with
 * the caller's props and the connection as it was read: the key hashes,
 * which nobody may read, and when the key was made or reading started -
 * columns only OneUptime writes, named as what the person did.
 */
describe("the audit log", () => {
  interface Recorded {
    model: unknown;
    before: CloudConnection;
    updatedFields: JSONObject;
    itemId: ObjectID;
    props: DatabaseCommonInteractionProps;
    includeColumns: Array<string>;
  }

  let recorded: Array<Recorded>;

  beforeEach(() => {
    recorded = [];

    jest.spyOn(AuditLogService, "recordUpdate").mockImplementation((async (
      data: Recorded,
    ) => {
      recorded.push(data);
    }) as never);

    // A read answers the row as it was then, as Postgres does.
    jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockImplementation((async () => {
        const copy: CloudConnection = new CloudConnection();
        Object.assign(copy, stored);
        return copy;
      }) as never);
  });

  test("a new stream key: by the caller, the key's hashes and when it was made", async () => {
    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);

    const entry: Recorded = recorded[0]!;

    expect(entry.model).toBeInstanceOf(CloudConnection);
    expect(entry.props).toBe(props);
    expect(entry.itemId.toString()).toBe(CONNECTION.toString());
    expect(entry.before.streamKeyHashes ?? null).toBeNull();
    expect(Object.keys(entry.updatedFields).sort()).toEqual([
      "streamKeyCreatedAt",
      "streamKeyHashes",
    ]);
    expect(entry.includeColumns.sort()).toEqual([
      "streamKeyCreatedAt",
      "streamKeyHashes",
    ]);
    // The key itself is answered once and recorded nowhere.
    expect(JSON.stringify(entry.updatedFields)).not.toContain(
      sent()["streamKey"] as string,
    );
  });

  test("a second key: the hashes it replaced are what the entry had before", async () => {
    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );
    const first: JSONObject = stored.streamKeyHashes!;
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();

    await streamKeyHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(recorded).toHaveLength(2);
    expect(recorded[1]!.before.streamKeyHashes).toEqual(first);
    expect(recorded[1]!.updatedFields["streamKeyHashes"]).toEqual(
      stored.streamKeyHashes,
    );
  });

  test("reading an Azure connection's event hubs turned on: what it reads, and since when", async () => {
    accessible!.provider = CloudProvider.Azure;
    stored.provider = CloudProvider.Azure;
    const subscription: string = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

    await startHandler(
      request(
        { connectionId: CONNECTION.toString() },
        { hostSubscriptionId: subscription },
      ),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.props).toBe(props);
    expect(recorded[0]!.updatedFields["streamState"]).toEqual({
      hostSubscriptionId: subscription,
      offsets: {},
    });
    expect(recorded[0]!.includeColumns.sort()).toEqual([
      "streamKeyCreatedAt",
      "streamState",
    ]);
  });

  test("streaming stopped: the hashes and when they were made, from what they were to none", async () => {
    stored.streamKeyHashes = {
      current: { hash: "h" },
    } as unknown as JSONObject;
    stored.streamKeyCreatedAt = new Date("2026-11-01T10:00:00.000Z");

    await stopHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);

    const entry: Recorded = recorded[0]!;

    expect(entry.props).toBe(props);
    expect(entry.before.streamKeyHashes).toEqual({ current: { hash: "h" } });
    expect(entry.before.streamKeyCreatedAt).toEqual(
      new Date("2026-11-01T10:00:00.000Z"),
    );
    expect(entry.updatedFields).toEqual({
      streamKeyHashes: null,
      streamKeyCreatedAt: null,
    });
    expect(entry.includeColumns.sort()).toEqual([
      "streamKeyCreatedAt",
      "streamKeyHashes",
    ]);
  });

  test("a refused request records nothing", async () => {
    setPermission(Permission.ProjectMember);

    for (const handler of [streamKeyHandler, stopHandler]) {
      await handler(
        request({ connectionId: CONNECTION.toString() }),
        res,
        next,
      );
    }

    expect(recorded).toHaveLength(0);
  });

  test("without a person, as OneUptime stops a connection's streams itself, nothing is recorded", async () => {
    await CloudConnectionService.stopStreaming(CONNECTION);

    expect(recorded).toHaveLength(0);
  });
});
