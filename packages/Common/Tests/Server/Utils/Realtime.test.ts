import IO, { Socket } from "../../../Server/Infrastructure/SocketIO";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import CookieUtil from "../../../Server/Utils/Cookie";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Realtime, {
  ListenToModelEventOutcome,
} from "../../../Server/Utils/Realtime";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import DatabaseType from "../../../Types/BaseDatabase/DatabaseType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import EventName from "../../../Types/Realtime/EventName";
import ListenToModelEventJSON from "../../../Types/Realtime/ListenToModelEventJSON";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import RealtimeUtil from "../../../Utils/Realtime";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import jwt from "jsonwebtoken";

/*
 * Contract under test - what the server does with a ListenToModelEvent whose
 * socket has no usable session.
 *
 * Each subscription is authorized with the access-token cookie from the
 * socket's HANDSHAKE, which is not re-read for the life of the connection. The
 * dashboard's access token lives 15 minutes, so a tab left open longer sends
 * every new subscription on a socket whose token no longer decodes. The decode
 * used to throw inside the async socket listener: an unhandled rejection, no
 * room joined, and nothing sent back, so the client could not know it had to
 * refresh and reconnect.
 *
 * Now a missing or expired token is answered with EventName.AuthenticationRequired
 * (carrying the refused subscription), nothing escapes the listener, and an
 * authorized subscription joins its room exactly as before.
 */

jest.mock("../../../Server/Infrastructure/SocketIO", () => {
  return {
    __esModule: true,
    default: {
      getSocketServer: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/UserPermission/UserPermission", () => {
  return {
    __esModule: true,
    default: {
      getUserGlobalAccessPermissionFromCache: jest.fn(),
      getUserTenantAccessPermissionFromCache: jest.fn(),
    },
  };
});

// Model permissions are looked up by name; the tests stub that lookup instead.
jest.mock("../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
    getModelTypeByName: (): null => {
      return null;
    },
  };
});

jest.mock("../../../Models/AnalyticsModels/Index", () => {
  return {
    __esModule: true,
    default: [],
    getModelTypeByName: (): null => {
      return null;
    },
  };
});

type Listener = (...args: Array<unknown>) => unknown;

interface EmittedEvent {
  event: string;
  data: unknown;
}

// Just enough of a server-side socket.io Socket.
class FakeServerSocket {
  public handshake: { headers: { cookie?: string | undefined } };
  public emitted: Array<EmittedEvent> = [];
  public joinedRooms: Array<string> = [];
  public listeners: Map<string, Listener> = new Map();

  public constructor(cookie?: string) {
    this.handshake = { headers: { cookie: cookie } };
  }

  public on(event: string, listener: Listener): FakeServerSocket {
    this.listeners.set(event, listener);
    return this;
  }

  public emit(event: string, data: unknown): boolean {
    this.emitted.push({ event: event, data: data });
    return true;
  }

  public async join(roomId: string): Promise<void> {
    this.joinedRooms.push(roomId);
  }

  public asSocket(): Socket {
    return this as unknown as Socket;
  }

  public authenticationRequiredEvents(): Array<unknown> {
    return this.emitted
      .filter((emitted: EmittedEvent) => {
        return emitted.event === EventName.AuthenticationRequired;
      })
      .map((emitted: EmittedEvent) => {
        return emitted.data;
      });
  }
}

const TENANT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TENANT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const REQUEST: ListenToModelEventJSON = {
  eventType: ModelEventType.Create,
  modelType: DatabaseType.Database,
  modelName: "Incident",
  tenantId: TENANT_ID,
};

const ROOM_ID: string = RealtimeUtil.getRoomId(
  TENANT_ID,
  "Incident",
  ModelEventType.Create,
);

type TokenFunction = (claims?: JSONObject) => string;

const validToken: TokenFunction = (claims: JSONObject = {}): string => {
  return JSONWebToken.signJsonPayload(
    {
      userId: USER_ID,
      email: "realtime-test@oneuptime.com",
      name: "Realtime Test",
      isMasterAdmin: false,
      ...claims,
    },
    15 * 60,
  );
};

const expiredToken: TokenFunction = (): string => {
  return jwt.sign(
    {
      userId: USER_ID,
      email: "realtime-test@oneuptime.com",
      name: "Realtime Test",
      isMasterAdmin: false,
      exp: Math.floor(Date.now() / 1000) - 60,
    },
    EncryptionSecret.toString(),
  );
};

type CookieFunction = (token: string) => string;

const cookieWith: CookieFunction = (token: string): string => {
  return `some-other-cookie=1; ${CookieUtil.getUserTokenKey()}=${token}`;
};

const getGlobalPermission: jest.Mock =
  UserPermissionUtil.getUserGlobalAccessPermissionFromCache as unknown as jest.Mock;
const getTenantPermission: jest.Mock =
  UserPermissionUtil.getUserTenantAccessPermissionFromCache as unknown as jest.Mock;

type MemberOfFunction = (projectIds: Array<string>) => void;

const memberOf: MemberOfFunction = (projectIds: Array<string>): void => {
  getGlobalPermission.mockResolvedValue({
    projectIds: projectIds.map((projectId: string) => {
      return new ObjectID(projectId);
    }),
    globalPermissions: [],
    isMasterAdmin: false,
    _type: "UserGlobalAccessPermission",
  } as unknown as UserGlobalAccessPermission);

  getTenantPermission.mockResolvedValue({
    projectId: new ObjectID(TENANT_ID),
    permissions: [],
    isBlockPermissionsEnabled: false,
    _type: "UserTenantAccessPermission",
  } as unknown as UserTenantAccessPermission);
};

describe("Realtime (server) ListenToModelEvent", () => {
  let connectionListener: (socket: Socket) => void = (): void => {};

  beforeAll(async () => {
    (IO.getSocketServer as unknown as jest.Mock).mockReturnValue({
      on: (event: string, listener: (socket: Socket) => void): void => {
        if (event === "connection") {
          connectionListener = listener;
        }
      },
    });

    await Realtime.init();
  });

  beforeEach(() => {
    getGlobalPermission.mockReset();
    getTenantPermission.mockReset();
    getGlobalPermission.mockResolvedValue(null);
    getTenantPermission.mockResolvedValue(null);
    jest.spyOn(Realtime, "hasPermissionsByModelName").mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a socket without a usable session", () => {
    test("no access-token cookie in the handshake: no room, and the client is told authentication is required", async () => {
      const socket: FakeServerSocket = new FakeServerSocket();

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          REQUEST as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.AuthenticationRequired);

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
    });

    test("a cookie header without the access token counts as no token", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        "some-other-cookie=1",
      );

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          REQUEST as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.AuthenticationRequired);

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
    });

    test("an expired access token (a tab open past 15 minutes): the decode failure does not escape, no room, client told", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(expiredToken()),
      );

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          REQUEST as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.AuthenticationRequired);

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
      expect(getGlobalPermission).not.toHaveBeenCalled();
    });

    test("a token that is not a JWT at all is treated the same way", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith("not-a-jwt"),
      );

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          REQUEST as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.AuthenticationRequired);

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
    });

    test("listenToModelEvent itself reports the outcome and signals the client", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(expiredToken()),
      );

      await expect(
        Realtime.listenToModelEvent(socket.asSocket(), REQUEST),
      ).resolves.toBe(ListenToModelEventOutcome.AuthenticationRequired);

      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
    });
  });

  describe("the socket listener", () => {
    type FlushFunction = () => Promise<void>;

    const flush: FlushFunction = async (): Promise<void> => {
      for (let i: number = 0; i < 5; i++) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      }
    };

    type ListenerForFunction = (socket: FakeServerSocket) => Listener;

    const listenerFor: ListenerForFunction = (
      socket: FakeServerSocket,
    ): Listener => {
      connectionListener(socket.asSocket());

      const listener: Listener | undefined = socket.listeners.get(
        EventName.ListenToModalEvent,
      );

      expect(listener).toBeDefined();

      return listener!;
    };

    /*
     * socket.io discards what a listener returns. The old listener was async,
     * so an expired token made it return a promise that rejected, and nobody
     * was listening for that rejection.
     */
    test("an expired token: the listener hands socket.io nothing that can reject, and the client is told", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(expiredToken()),
      );

      const returned: unknown = listenerFor(socket)(REQUEST);

      await expect(Promise.resolve(returned)).resolves.toBeUndefined();

      await flush();

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
    });

    test("a malformed request is refused without a rejection and without an authentication signal", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      const returned: unknown = listenerFor(socket)({
        ...REQUEST,
        eventType: 42,
      });

      await expect(Promise.resolve(returned)).resolves.toBeUndefined();

      await flush();

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.emitted).toEqual([]);

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          undefined as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.InvalidRequest);
    });

    test("a valid session joins the room through the listener", async () => {
      memberOf([TENANT_ID]);

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      listenerFor(socket)(REQUEST);

      await flush();

      expect(socket.joinedRooms).toEqual([ROOM_ID]);
      expect(socket.emitted).toEqual([]);
    });
  });

  describe("a socket with a valid session (unchanged)", () => {
    test("a project member with read permission joins the room, and nothing is sent back", async () => {
      memberOf([TENANT_ID]);

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          REQUEST as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.Joined);

      expect(socket.joinedRooms).toEqual([ROOM_ID]);
      expect(socket.emitted).toEqual([]);
      expect(Realtime.hasPermissionsByModelName).toHaveBeenCalledWith(
        expect.anything(),
        "Incident",
      );
    });

    test("a master admin joins the room", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({ isMasterAdmin: true })),
      );

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          REQUEST as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.Joined);

      expect(socket.joinedRooms).toEqual([ROOM_ID]);
    });

    /*
     * Authorization-denied keeps its old behaviour: no room and no message. A
     * fresh session would not change the answer, so the client must not be
     * sent into a refresh-and-reconnect for it.
     */
    test("not a member of the project: no room, and no authentication signal", async () => {
      memberOf([OTHER_TENANT_ID]);

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          REQUEST as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.NotAuthorized);

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.emitted).toEqual([]);
    });

    test("a member without read permission on the model: no room, and no authentication signal", async () => {
      memberOf([TENANT_ID]);
      (
        Realtime.hasPermissionsByModelName as unknown as jest.Mock
      ).mockReturnValue(false);

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          REQUEST as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.NotAuthorized);

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.emitted).toEqual([]);
    });

    test("a failing permission lookup (the cache is down) is contained: no room, no signal, no rejection", async () => {
      getGlobalPermission.mockRejectedValue(new Error("Redis is down"));

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(
        Realtime.handleListenToModelEventRequest(
          socket.asSocket(),
          REQUEST as unknown as JSONObject,
        ),
      ).resolves.toBe(ListenToModelEventOutcome.Failed);

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.emitted).toEqual([]);
    });
  });
});
