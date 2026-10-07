import IO, { Socket } from "../../../Server/Infrastructure/SocketIO";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import UserService from "../../../Server/Services/UserService";
import CookieUtil from "../../../Server/Utils/Cookie";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Realtime, {
  ListenToModelEventOutcome,
} from "../../../Server/Utils/Realtime";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import RealtimeSessions from "../../../Server/Utils/Realtime/RealtimeSessions";
import DatabaseType from "../../../Types/BaseDatabase/DatabaseType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../Types/Permission";
import EventName from "../../../Types/Realtime/EventName";
import ListenToModelEventJSON from "../../../Types/Realtime/ListenToModelEventJSON";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
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
 * Contract under test - what the server does with a ListenToModelEvent.
 *
 * Each subscription is decided as an API request of the same session is
 * (RealtimeJoinAccess): the access token the socket's HANDSHAKE carried,
 * read by UserMiddleware.readRequestSession, and the project's access check
 * every request makes, UserMiddleware.getUserTenantAccessPermissionWithTenantId.
 * The services those checks read are mocked here; the checks are the real
 * ones.
 *
 * The handshake is not re-read for the life of the connection. The
 * dashboard's access token lives 15 minutes, so a tab left open longer sends
 * every new subscription on a socket whose token no longer decodes: that is
 * answered with EventName.AuthenticationRequired (carrying the refused
 * subscription), so the client refreshes and reconnects. A project that
 * requires an SSO sign-in the handshake does not carry is answered with
 * EventName.SsoAuthorizationRequired. An allowed join keeps the session on
 * the socket, and the socket hears live updates only while that session
 * lasts.
 */

jest.mock("../../../Server/Infrastructure/SocketIO", () => {
  return {
    __esModule: true,
    default: {
      getSocketServer: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");
jest.mock("../../../Server/Services/AccessTokenService");
jest.mock("../../../Server/Services/GlobalConfigService");
jest.mock("../../../Server/Services/ProjectService");
jest.mock("../../../Server/Services/ProjectSsoService");
jest.mock("../../../Server/Services/ProjectOidcService");
jest.mock("../../../Server/Services/TeamMemberService");
jest.mock("../../../Server/Services/UserService");
/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it; nothing password-related is under
 * test here, so it is replaced with a factory (see UserAuthorization.test.ts).
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
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

let nextSocketId: number = 1;

// Just enough of a server-side socket.io Socket.
class FakeServerSocket {
  public id: string;
  public handshake: { headers: Record<string, string | undefined> };
  public emitted: Array<EmittedEvent> = [];
  public joinedRooms: Array<string> = [];
  public rooms: Set<string>;
  public data: unknown = undefined;
  public listeners: Map<string, Array<Listener>> = new Map();

  public constructor(cookie?: string, headers?: Record<string, string>) {
    this.id = `socket-${nextSocketId++}`;
    this.rooms = new Set<string>([this.id]);
    this.handshake = { headers: { cookie: cookie, ...(headers || {}) } };
  }

  public on(event: string, listener: Listener): FakeServerSocket {
    const existing: Array<Listener> = this.listeners.get(event) || [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  public listener(event: string): Listener | undefined {
    return (this.listeners.get(event) || [])[0];
  }

  public emit(event: string, data: unknown): boolean {
    this.emitted.push({ event: event, data: data });
    return true;
  }

  public async join(roomId: string): Promise<void> {
    this.joinedRooms.push(roomId);
    this.rooms.add(roomId);
  }

  public async leave(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
  }

  // Test side: the client went away.
  public disconnect(): void {
    for (const listener of this.listeners.get("disconnect") || []) {
      listener("transport close");
    }
  }

  public asSocket(): Socket {
    return this as unknown as Socket;
  }

  public eventsNamed(name: string): Array<unknown> {
    return this.emitted
      .filter((emitted: EmittedEvent) => {
        return emitted.event === name;
      })
      .map((emitted: EmittedEvent) => {
        return emitted.data;
      });
  }

  public authenticationRequiredEvents(): Array<unknown> {
    return this.eventsNamed(EventName.AuthenticationRequired);
  }

  public ssoRequiredEvents(): Array<unknown> {
    return this.eventsNamed(EventName.SsoAuthorizationRequired);
  }

  // The rooms it is in, other than its own.
  public subscribedRooms(): Array<string> {
    return Array.from(this.rooms).filter((room: string): boolean => {
      return room !== this.id;
    });
  }
}

const TENANT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TENANT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_USER_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SESSION_ID: string = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const OTHER_SESSION_ID: string = "99999999-9999-4999-8999-999999999999";

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

type TokenFunction = (claims?: JSONObject, expiresInSeconds?: number) => string;

const validToken: TokenFunction = (
  claims: JSONObject = {},
  expiresInSeconds: number = 15 * 60,
): string => {
  return JSONWebToken.signJsonPayload(
    {
      userId: USER_ID,
      email: "realtime-test@oneuptime.com",
      name: "Realtime Test",
      isMasterAdmin: false,
      sessionId: SESSION_ID,
      ...claims,
    },
    expiresInSeconds,
  );
};

const expiredToken: () => string = (): string => {
  return jwt.sign(
    {
      userId: USER_ID,
      email: "realtime-test@oneuptime.com",
      name: "Realtime Test",
      isMasterAdmin: false,
      sessionId: SESSION_ID,
      exp: Math.floor(Date.now() / 1000) - 60,
    },
    EncryptionSecret.toString(),
  );
};

// The project SAML provider the SSO sign-ins below were given by.
const SSO_PROVIDER_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_SSO_PROVIDER_ID: string = "12121212-1212-4121-8121-121212121212";

// A project SSO sign-in, as the SSO routes set it (CookieUtil.setSSOCookie).
const ssoToken: (data: {
  projectId: string;
  userId?: string | undefined;
  expiresInSeconds?: number | undefined;
  providerId?: string | undefined;
}) => string = (data: {
  projectId: string;
  userId?: string | undefined;
  expiresInSeconds?: number | undefined;
  providerId?: string | undefined;
}): string => {
  return JSONWebToken.signJsonPayload(
    {
      userId: data.userId || USER_ID,
      projectId: data.projectId,
      email: "realtime-test@oneuptime.com",
      name: "Realtime Test",
      isMasterAdmin: false,
      ssoProviderId: data.providerId || SSO_PROVIDER_ID,
      ssoProviderType: SsoProviderType.ProjectSSO,
    },
    data.expiresInSeconds !== undefined ? data.expiresInSeconds : 30 * 60,
  );
};

type CookieFunction = (token: string, ...more: Array<string>) => string;

const cookieWith: CookieFunction = (
  token: string,
  ...more: Array<string>
): string => {
  return [
    "some-other-cookie=1",
    `${CookieUtil.getUserTokenKey()}=${token}`,
    ...more,
  ].join("; ");
};

const ssoCookie: (projectId: string, token: string) => string = (
  projectId: string,
  token: string,
): string => {
  return `${CookieUtil.getUserSSOKey(new ObjectID(projectId))}=${token}`;
};

const tenantPermissionLookup: jest.Mock =
  AccessTokenService.getUserTenantAccessPermission as unknown as jest.Mock;
const globalPermissionLookup: jest.Mock =
  AccessTokenService.getUserGlobalAccessPermission as unknown as jest.Mock;
const projectRequiresSso: jest.Mock =
  ProjectService.getRequireSsoForLogin as unknown as jest.Mock;
const projectRequiredProvider: jest.Mock =
  ProjectService.getRequireSsoWithSsoProviderId as unknown as jest.Mock;
const instanceRequiresSso: jest.Mock =
  GlobalConfigService.getRequireSsoForLogin as unknown as jest.Mock;
const userBlocked: jest.Mock =
  UserService.isUserBlocked as unknown as jest.Mock;
const samlProviderStanding: jest.Mock =
  ProjectSsoService.getSignInStanding as unknown as jest.Mock;
const oidcProviderStanding: jest.Mock =
  ProjectOidcService.getSignInStanding as unknown as jest.Mock;

/*
 * These project SAML providers are on, and were never turned off: the
 * sign-ins they gave count. Every other provider is not there.
 */
let providersOn: Array<string> = [];

const providerStanding: (data: { providerId: ObjectID }) => Promise<{
  isOn: boolean;
  signInsEndedAtMs: number | null;
}> = async (data: {
  providerId: ObjectID;
}): Promise<{ isOn: boolean; signInsEndedAtMs: number | null }> => {
  return {
    isOn: providersOn.includes(data.providerId.toString()),
    signInsEndedAtMs: null,
  };
};

type MemberOfFunction = (projectIds: Array<string>) => void;

// The person is a member of these projects, and of no other.
const memberOf: MemberOfFunction = (projectIds: Array<string>): void => {
  tenantPermissionLookup.mockImplementation(
    async (
      _userId: ObjectID,
      projectId: ObjectID,
    ): Promise<UserTenantAccessPermission | null> => {
      if (!projectIds.includes(projectId.toString())) {
        return null;
      }

      return {
        projectId: projectId,
        permissions: [],
        _type: "UserTenantAccessPermission",
      } as unknown as UserTenantAccessPermission;
    },
  );
};

type ListenFunction = (
  socket: FakeServerSocket,
  request?: ListenToModelEventJSON,
) => Promise<ListenToModelEventOutcome>;

const listen: ListenFunction = async (
  socket: FakeServerSocket,
  request: ListenToModelEventJSON = REQUEST,
): Promise<ListenToModelEventOutcome> => {
  return await Realtime.handleListenToModelEventRequest(
    socket.asSocket(),
    request as unknown as JSONObject,
  );
};

// The sockets the fake server holds, as a recheck reads them (fetchSockets).
let heldSockets: Array<FakeServerSocket> = [];

// Lets a recheck started by an announcement run to its end.
const settle: () => Promise<void> = async (): Promise<void> => {
  for (let index: number = 0; index < 20; index++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
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
      fetchSockets: async (): Promise<Array<Socket>> => {
        return heldSockets.map((socket: FakeServerSocket): Socket => {
          return socket.asSocket();
        });
      },
    });

    await Realtime.init();

    // There is no Valkey here: the server stops trying to listen to it.
    await RealtimeAccessChanges.stopListening();
  });

  beforeEach(() => {
    RealtimeSessions.clear();
    heldSockets = [];
    tenantPermissionLookup.mockReset();
    globalPermissionLookup.mockReset();
    globalPermissionLookup.mockResolvedValue(null);
    memberOf([]);
    projectRequiresSso.mockReset();
    projectRequiresSso.mockResolvedValue(false);
    projectRequiredProvider.mockReset();
    projectRequiredProvider.mockResolvedValue(null);
    instanceRequiresSso.mockReset();
    instanceRequiresSso.mockResolvedValue(false);
    userBlocked.mockReset();
    userBlocked.mockResolvedValue(false);
    providersOn = [SSO_PROVIDER_ID, OTHER_SSO_PROVIDER_ID];
    samlProviderStanding.mockReset();
    samlProviderStanding.mockImplementation(providerStanding);
    oidcProviderStanding.mockReset();
    oidcProviderStanding.mockImplementation(providerStanding);
    jest.spyOn(Realtime, "hasPermissionsByModelName").mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    RealtimeSessions.clear();
  });

  describe("a socket without a usable session", () => {
    test("no access-token cookie in the handshake: no room, and the client is told authentication is required", async () => {
      const socket: FakeServerSocket = new FakeServerSocket();

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.AuthenticationRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
    });

    test("a cookie header without the access token counts as no token", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        "some-other-cookie=1",
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.AuthenticationRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
    });

    test("an expired access token (a tab open past 15 minutes): the decode failure does not escape, no room, client told", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(expiredToken()),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.AuthenticationRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
      expect(tenantPermissionLookup).not.toHaveBeenCalled();
    });

    test("a token that is not a JWT at all is treated the same way", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith("not-a-jwt"),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.AuthenticationRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
    });

    test("a blocked user's token is refused as the API refuses it, and the client is told", async () => {
      memberOf([TENANT_ID]);
      userBlocked.mockResolvedValue(true);

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.AuthenticationRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([REQUEST]);
      expect(tenantPermissionLookup).not.toHaveBeenCalled();
      expect(RealtimeSessions.size()).toBe(0);
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

      const listener: Listener | undefined = socket.listener(
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

    test("a tenant that is not an id is a malformed request: nothing is looked up", async () => {
      memberOf([TENANT_ID]);

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(
        listen(socket, { ...REQUEST, tenantId: "not-a-project" }),
      ).resolves.toBe(ListenToModelEventOutcome.InvalidRequest);

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.emitted).toEqual([]);
      expect(projectRequiresSso).not.toHaveBeenCalled();
      expect(tenantPermissionLookup).not.toHaveBeenCalled();
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

  describe("a socket with a valid session", () => {
    test("a project member with read permission joins the room, and nothing is sent back", async () => {
      memberOf([TENANT_ID]);

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );

      expect(socket.joinedRooms).toEqual([ROOM_ID]);
      expect(socket.emitted).toEqual([]);
      expect(Realtime.hasPermissionsByModelName).toHaveBeenCalledWith(
        expect.anything(),
        "Incident",
      );
    });

    test("a bearer token in the handshake is read as the API reads it", async () => {
      memberOf([TENANT_ID]);

      const socket: FakeServerSocket = new FakeServerSocket(undefined, {
        authorization: `Bearer ${validToken()}`,
      });

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );
    });

    /*
     * Joining is not hearing about every record in the room: each event is
     * checked against its record's read, as the person the socket joined
     * as (RealtimeDelivery.test.ts), while their session lasts. The socket
     * keeps who that is, which sign-in, and when its access token expires.
     */
    test("a joined socket keeps who it joined as, its sign-in, and when its access token expires", async () => {
      memberOf([TENANT_ID]);

      const token: string = validToken();
      const expiresAtMs: number =
        (JSONWebToken.decodeJsonPayload(token)["exp"] as number) * 1000;

      const socket: FakeServerSocket = new FakeServerSocket(cookieWith(token));

      await listen(socket);

      expect(socket.data).toEqual({
        realtimeReader: {
          userId: USER_ID,
          isMasterAdmin: false,
          sessionId: SESSION_ID,
          expiresAtMs: expiresAtMs,
        },
      });
      expect(RealtimeSessions.getSession(socket)).toEqual({
        userId: USER_ID,
        isMasterAdmin: false,
        sessionId: SESSION_ID,
        expiresAtMs: expiresAtMs,
      });
      expect(RealtimeSessions.size()).toBe(1);
    });

    test("a master admin's socket keeps that it is one", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({ isMasterAdmin: true })),
      );

      await listen(socket);

      expect(RealtimeSessions.getSession(socket)).toEqual(
        expect.objectContaining({ userId: USER_ID, isMasterAdmin: true }),
      );
    });

    test("a refused socket is not given anyone to hear as", async () => {
      memberOf([OTHER_TENANT_ID]);

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await listen(socket);

      expect(socket.data).toBeUndefined();
      expect(RealtimeSessions.size()).toBe(0);
    });

    test("a master admin joins any project's room, as their requests pass its permission checks", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({ isMasterAdmin: true })),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );

      expect(socket.joinedRooms).toEqual([ROOM_ID]);
      expect(Realtime.hasPermissionsByModelName).not.toHaveBeenCalled();
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

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.NotAuthorized,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.emitted).toEqual([]);
    });

    test("an unknown project: no room, and no signal", async () => {
      memberOf([TENANT_ID]);
      projectRequiresSso.mockRejectedValue(
        new BadDataException("Project not found"),
      );

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({ isMasterAdmin: true })),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.NotAuthorized,
      );

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

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.NotAuthorized,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.emitted).toEqual([]);
      expect(RealtimeSessions.size()).toBe(0);
    });

    test("a failing permission lookup (the cache is down) is contained: no room, no signal, no rejection", async () => {
      tenantPermissionLookup.mockRejectedValue(new Error("Redis is down"));

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Failed,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.emitted).toEqual([]);
    });

    test("a blocked-user lookup that fails is an error, not a pass: no room", async () => {
      memberOf([TENANT_ID]);
      userBlocked.mockRejectedValue(new Error("database down"));

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Failed,
      );

      expect(socket.joinedRooms).toEqual([]);
    });
  });

  /*
   * The project's Require SSO rule - and the instance-wide one - apply to
   * live updates as they apply to requests: the join runs the API's own
   * project access check against the handshake's cookies.
   */
  describe("a project that requires SSO", () => {
    beforeEach(() => {
      memberOf([TENANT_ID]);
      projectRequiresSso.mockResolvedValue(true);
    });

    test("without the project's SSO sign-in: no room, and the client is told which project asks for it", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.SsoRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.ssoRequiredEvents()).toEqual([REQUEST]);
      expect(socket.authenticationRequiredEvents()).toEqual([]);
      expect(socket.data).toBeUndefined();
      expect(RealtimeSessions.size()).toBe(0);
    });

    test("with the project's SSO sign-in: the room is joined", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(TENANT_ID, ssoToken({ projectId: TENANT_ID })),
        ),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );

      expect(socket.joinedRooms).toEqual([ROOM_ID]);
      expect(socket.emitted).toEqual([]);
    });

    test("an SSO sign-in to another project does not count", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(OTHER_TENANT_ID, ssoToken({ projectId: OTHER_TENANT_ID })),
        ),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.SsoRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
    });

    test("someone else's SSO sign-in does not count", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(
            TENANT_ID,
            ssoToken({ projectId: TENANT_ID, userId: OTHER_USER_ID }),
          ),
        ),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.SsoRequired,
      );
    });

    test("an SSO sign-in that has expired does not count", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(
            TENANT_ID,
            ssoToken({ projectId: TENANT_ID, expiresInSeconds: -60 }),
          ),
        ),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.SsoRequired,
      );
    });

    test("a project that pins a provider takes only that provider's sign-in", async () => {
      const pinned: ObjectID = ObjectID.generate();
      projectRequiredProvider.mockResolvedValue(pinned);

      const otherProvider: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(TENANT_ID, ssoToken({ projectId: TENANT_ID })),
        ),
      );

      await expect(listen(otherProvider)).resolves.toBe(
        ListenToModelEventOutcome.SsoRequired,
      );

      providersOn.push(pinned.toString());

      const pinnedToken: string = ssoToken({
        projectId: TENANT_ID,
        providerId: pinned.toString(),
      });

      const pinnedProvider: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken(), ssoCookie(TENANT_ID, pinnedToken)),
      );

      await expect(listen(pinnedProvider)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );
    });

    test("a server admin is held to the project's own requirement, as their requests are", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({ isMasterAdmin: true })),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.SsoRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
    });

    test("an SSO sign-in whose provider has been turned off or deleted does not count", async () => {
      providersOn = [];

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(TENANT_ID, ssoToken({ projectId: TENANT_ID })),
        ),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.SsoRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.ssoRequiredEvents()).toEqual([REQUEST]);
      // The provider the sign-in names was asked, for this project.
      expect(samlProviderStanding).toHaveBeenCalled();
      expect(
        (
          samlProviderStanding.mock.calls[0]![0] as { projectId: ObjectID }
        ).projectId.toString(),
      ).toBe(TENANT_ID);
    });

    test("a lookup of the provider that fails is a failed join, not a refusal and not a pass", async () => {
      samlProviderStanding.mockRejectedValue(new Error("database unavailable"));

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(TENANT_ID, ssoToken({ projectId: TENANT_ID })),
        ),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Failed,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(socket.emitted).toEqual([]);
    });

    test("the SSO sign-in of the mobile app's header counts too", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
        {
          "x-sso-tokens": JSON.stringify({
            [TENANT_ID]: ssoToken({ projectId: TENANT_ID }),
          }),
        },
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );
    });
  });

  describe("the instance-wide Require SSO", () => {
    beforeEach(() => {
      memberOf([TENANT_ID]);
      instanceRequiresSso.mockResolvedValue(true);
    });

    test("refuses a member without an SSO sign-in", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.SsoRequired,
      );
    });

    test("lets a member with the project's SSO sign-in through", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(TENANT_ID, ssoToken({ projectId: TENANT_ID })),
        ),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );
    });

    test("leaves server admins out, as the API does, so a broken provider cannot lock them out", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({ isMasterAdmin: true })),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );
    });
  });

  /*
   * A socket hears live updates only while the session it joined with
   * lasts. Signing out or a revoked session (RealtimeAccessChanges
   * SessionsEnded, which the session service announces) and the access
   * token's expiry (a timer per socket) end them: the socket leaves every
   * room, is no longer anyone, joins nothing more, and is told, so the
   * client refreshes and reconnects - or is sent to sign in.
   */
  /*
   * A project's sign-in rules change after a socket joined: the socket is
   * asked again, as its join was, with the rules as they are now, on every
   * server (RealtimeAccessChanges). One no longer let in leaves the
   * project's rooms and is told why; the rest are left alone.
   */
  describe("a project's sign-in rules change after a socket joined", () => {
    const OTHER_ROOM_ID: string = RealtimeUtil.getRoomId(
      OTHER_TENANT_ID,
      "Incident",
      ModelEventType.Create,
    );

    type JoinBothFunction = (socket: FakeServerSocket) => Promise<void>;

    // A socket listening to both projects, held by this server.
    const joinBoth: JoinBothFunction = async (
      socket: FakeServerSocket,
    ): Promise<void> => {
      heldSockets.push(socket);

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );
      await expect(
        listen(socket, { ...REQUEST, tenantId: OTHER_TENANT_ID }),
      ).resolves.toBe(ListenToModelEventOutcome.Joined);
    };

    type RequireSsoOfFunction = (projectIds: Array<string>) => void;

    // From now on these projects require an SSO sign-in.
    const requireSsoOf: RequireSsoOfFunction = (
      projectIds: Array<string>,
    ): void => {
      projectRequiresSso.mockImplementation(
        async (projectId: ObjectID): Promise<boolean> => {
          return projectIds.includes(projectId.toString());
        },
      );
    };

    beforeEach(() => {
      memberOf([TENANT_ID, OTHER_TENANT_ID]);
    });

    test("Require SSO turned on: a socket without the project's SSO sign-in leaves its rooms at once and is told; its other project's rooms stay", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await joinBoth(socket);

      requireSsoOf([TENANT_ID]);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
        projectId: TENANT_ID,
      });
      await settle();

      expect(socket.subscribedRooms()).toEqual([OTHER_ROOM_ID]);
      expect(socket.ssoRequiredEvents()).toEqual([{ tenantId: TENANT_ID }]);
      // Its session goes on, for the project that still lets it in.
      expect(RealtimeSessions.getSession(socket)).not.toBeNull();
      expect(socket.authenticationRequiredEvents()).toEqual([]);
      // The rules were read again before it was asked.
      expect(ProjectService.forgetSignInRules).toHaveBeenCalled();
    });

    test("Require SSO turned on: a socket with the project's SSO sign-in stays", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(TENANT_ID, ssoToken({ projectId: TENANT_ID })),
        ),
      );

      await joinBoth(socket);

      requireSsoOf([TENANT_ID]);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
        projectId: TENANT_ID,
      });
      await settle();

      expect(socket.subscribedRooms()).toEqual([ROOM_ID, OTHER_ROOM_ID]);
      expect(socket.emitted).toEqual([]);
    });

    test("the provider a socket signed in with is turned off: it leaves the project's rooms at once and is told; a socket signed in by another provider stays", async () => {
      requireSsoOf([TENANT_ID]);

      const signedInWithIt: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(TENANT_ID, ssoToken({ projectId: TENANT_ID })),
        ),
      );
      const signedInWithAnother: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(
            TENANT_ID,
            ssoToken({
              projectId: TENANT_ID,
              providerId: OTHER_SSO_PROVIDER_ID,
            }),
          ),
        ),
      );

      for (const socket of [signedInWithIt, signedInWithAnother]) {
        heldSockets.push(socket);

        await expect(listen(socket)).resolves.toBe(
          ListenToModelEventOutcome.Joined,
        );
      }

      // Turned off (ProjectSsoProviderChanges announces it for the project).
      providersOn = [OTHER_SSO_PROVIDER_ID];

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
        projectId: TENANT_ID,
      });
      await settle();

      expect(signedInWithIt.subscribedRooms()).toEqual([]);
      expect(signedInWithIt.ssoRequiredEvents()).toEqual([
        { tenantId: TENANT_ID },
      ]);
      // Signed out of nothing else: the session goes on.
      expect(RealtimeSessions.getSession(signedInWithIt)).not.toBeNull();
      expect(signedInWithIt.authenticationRequiredEvents()).toEqual([]);

      expect(signedInWithAnother.subscribedRooms()).toEqual([ROOM_ID]);
      expect(signedInWithAnother.emitted).toEqual([]);
    });

    test("a socket asked again while its provider is still on stays: nothing about the sign-in changed", async () => {
      requireSsoOf([TENANT_ID]);

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken(),
          ssoCookie(TENANT_ID, ssoToken({ projectId: TENANT_ID })),
        ),
      );

      heldSockets.push(socket);

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
        projectId: TENANT_ID,
      });
      await settle();

      expect(socket.subscribedRooms()).toEqual([ROOM_ID]);
      expect(socket.emitted).toEqual([]);
    });

    test("another project's rules changing leaves this project's sockets alone", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await joinBoth(socket);

      // Only TENANT requires SSO, but the change named the other project.
      requireSsoOf([TENANT_ID]);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
        projectId: OTHER_TENANT_ID,
      });
      await settle();

      expect(socket.subscribedRooms()).toEqual([ROOM_ID, OTHER_ROOM_ID]);
      expect(socket.emitted).toEqual([]);
    });

    test("the instance-wide rule turned on: a member without SSO leaves every project's rooms; a server admin stays", async () => {
      const member: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );
      const admin: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({ isMasterAdmin: true })),
      );

      await joinBoth(member);
      await joinBoth(admin);

      instanceRequiresSso.mockResolvedValue(true);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
      });
      await settle();

      expect(member.subscribedRooms()).toEqual([]);
      expect(member.ssoRequiredEvents()).toEqual([
        { tenantId: TENANT_ID },
        { tenantId: OTHER_TENANT_ID },
      ]);
      expect(admin.subscribedRooms()).toEqual([ROOM_ID, OTHER_ROOM_ID]);
      expect(admin.emitted).toEqual([]);
      expect(GlobalConfigService.forgetSignInRules).toHaveBeenCalled();
    });

    test("a socket that cannot be asked again (a lookup fails) is left as it is: its renewal asks again", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await joinBoth(socket);

      tenantPermissionLookup.mockRejectedValue(
        new Error("the permission cache is down"),
      );

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
        projectId: TENANT_ID,
      });
      await settle();

      // A passing failure does not end every session on the server at once.
      expect(socket.subscribedRooms()).toEqual([ROOM_ID, OTHER_ROOM_ID]);
      expect(socket.emitted).toEqual([]);
      expect(RealtimeSessions.hasEnded(socket)).toBe(false);
    });

    test("sockets are asked RECHECK_CONCURRENCY at a time, and every one is asked", async () => {
      const sockets: Array<FakeServerSocket> = [];

      for (
        let index: number = 0;
        index < Realtime.RECHECK_CONCURRENCY + 5;
        index++
      ) {
        const socket: FakeServerSocket = new FakeServerSocket(
          cookieWith(validToken()),
        );

        heldSockets.push(socket);
        await listen(socket);
        sockets.push(socket);
      }

      let inFlight: number = 0;
      let mostInFlight: number = 0;
      let asked: number = 0;

      tenantPermissionLookup.mockImplementation(
        async (
          _userId: ObjectID,
          projectId: ObjectID,
        ): Promise<UserTenantAccessPermission> => {
          inFlight++;
          asked++;
          mostInFlight = Math.max(mostInFlight, inFlight);

          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 5);
          });

          inFlight--;

          return {
            projectId: projectId,
            permissions: [],
            _type: "UserTenantAccessPermission",
          } as unknown as UserTenantAccessPermission;
        },
      );

      await Realtime.recheckSignInRules(TENANT_ID);

      expect(asked).toBe(sockets.length);
      expect(mostInFlight).toBeLessThanOrEqual(Realtime.RECHECK_CONCURRENCY);
      expect(mostInFlight).toBeGreaterThan(1);
    });

    test("a socket whose session has ended is not asked again", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await joinBoth(socket);

      RealtimeSessions.end(socket);
      socket.emitted = [];
      tenantPermissionLookup.mockClear();

      requireSsoOf([TENANT_ID]);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
        projectId: TENANT_ID,
      });
      await settle();

      expect(tenantPermissionLookup).not.toHaveBeenCalled();
      expect(socket.emitted).toEqual([]);
    });
  });

  describe("live updates end with the session", () => {
    beforeEach(() => {
      memberOf([TENANT_ID]);
    });

    test("signing out ends the session's live updates at once: rooms left, the client told, and the handshake joins nothing more", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );
      const otherSession: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({ sessionId: OTHER_SESSION_ID })),
      );

      await listen(socket);
      await listen(otherSession);

      expect(socket.subscribedRooms()).toEqual([ROOM_ID]);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        sessionIds: [SESSION_ID],
      });

      expect(socket.subscribedRooms()).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([{}]);
      expect(RealtimeSessions.getSession(socket)).toBeNull();

      // The other sign-in of the same person is not touched.
      expect(otherSession.subscribedRooms()).toEqual([ROOM_ID]);
      expect(otherSession.emitted).toEqual([]);
      expect(RealtimeSessions.getSession(otherSession)).not.toBeNull();

      // The same handshake cannot join again; the client must reconnect.
      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.AuthenticationRequired,
      );
      expect(socket.subscribedRooms()).toEqual([]);
    });

    test("a new connection with an access token of the ended session joins nothing", async () => {
      const first: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await listen(first);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        sessionIds: [SESSION_ID],
      });

      const reconnected: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(listen(reconnected)).resolves.toBe(
        ListenToModelEventOutcome.AuthenticationRequired,
      );
      expect(reconnected.joinedRooms).toEqual([]);
    });

    test("every session of a person ending (blocked, deleted) ends all of their sockets, and nobody else's", async () => {
      const firstTab: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );
      const otherDevice: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({ sessionId: OTHER_SESSION_ID })),
      );
      const someoneElse: FakeServerSocket = new FakeServerSocket(
        cookieWith(
          validToken({ userId: OTHER_USER_ID, sessionId: OTHER_SESSION_ID }),
        ),
      );

      await listen(firstTab);
      await listen(otherDevice);
      await listen(someoneElse);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        userId: USER_ID,
      });

      expect(firstTab.subscribedRooms()).toEqual([]);
      expect(otherDevice.subscribedRooms()).toEqual([]);
      expect(someoneElse.subscribedRooms()).toEqual([ROOM_ID]);
      expect(RealtimeSessions.size()).toBe(1);
    });

    test("a token issued before every session of the person ended opens nothing; one issued after does", async () => {
      jest.useFakeTimers({ now: Date.now(), doNotFake: ["nextTick"] });

      const before: string = validToken();

      jest.setSystemTime(Date.now() + 2000);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        userId: USER_ID,
      });

      jest.setSystemTime(Date.now() + 2000);

      const after: string = validToken({ sessionId: OTHER_SESSION_ID });

      await expect(
        listen(new FakeServerSocket(cookieWith(before))),
      ).resolves.toBe(ListenToModelEventOutcome.AuthenticationRequired);

      await expect(
        listen(new FakeServerSocket(cookieWith(after))),
      ).resolves.toBe(ListenToModelEventOutcome.Joined);
    });

    test("a session that ends while its join is being decided is refused", async () => {
      tenantPermissionLookup.mockImplementation(
        async (): Promise<UserTenantAccessPermission> => {
          // Signed out while the project's permissions were being read.
          RealtimeAccessChanges.announce({
            kind: RealtimeAccessChangeKind.SessionsEnded,
            sessionIds: [SESSION_ID],
          });

          return {
            projectId: new ObjectID(TENANT_ID),
            permissions: [],
            _type: "UserTenantAccessPermission",
          } as unknown as UserTenantAccessPermission;
        },
      );

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.AuthenticationRequired,
      );

      expect(socket.joinedRooms).toEqual([]);
      expect(RealtimeSessions.size()).toBe(0);
    });

    test("the access token expiring ends the socket's live updates when it expires, and tells the client", async () => {
      jest.useFakeTimers({ now: Date.now(), doNotFake: ["nextTick"] });

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({}, 120)),
      );

      await expect(listen(socket)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );

      jest.advanceTimersByTime(119_000);

      expect(socket.subscribedRooms()).toEqual([ROOM_ID]);
      expect(socket.authenticationRequiredEvents()).toEqual([]);

      jest.advanceTimersByTime(1_500);

      expect(socket.subscribedRooms()).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([{}]);
      expect(RealtimeSessions.getSession(socket)).toBeNull();
      expect(RealtimeSessions.size()).toBe(0);
    });

    test("a minute before the access token expires the page is asked to renew, and the socket still hears until it does", async () => {
      jest.useFakeTimers({ now: Date.now(), doNotFake: ["nextTick"] });

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({}, 120)),
      );

      await listen(socket);

      // The token says when it expires in whole seconds: up to a second early.
      jest.advanceTimersByTime(59_000);

      expect(socket.emitted).toEqual([]);

      jest.advanceTimersByTime(1_500);

      expect(socket.eventsNamed(EventName.SessionExpiring)).toEqual([{}]);
      expect(socket.subscribedRooms()).toEqual([ROOM_ID]);
      expect(RealtimeSessions.getSession(socket)).not.toBeNull();
      expect(socket.authenticationRequiredEvents()).toEqual([]);
    });

    test("the page renewing in time (its socket goes, a new one joins) ends nothing", async () => {
      jest.useFakeTimers({ now: Date.now(), doNotFake: ["nextTick"] });

      const renewing: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({}, 120)),
      );

      await listen(renewing);
      jest.advanceTimersByTime(61_000);

      expect(renewing.eventsNamed(EventName.SessionExpiring)).toEqual([{}]);

      renewing.disconnect();

      const renewed: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );

      await expect(listen(renewed)).resolves.toBe(
        ListenToModelEventOutcome.Joined,
      );

      jest.advanceTimersByTime(120_000);

      expect(renewing.authenticationRequiredEvents()).toEqual([]);
      expect(renewed.subscribedRooms()).toEqual([ROOM_ID]);
      expect(renewed.emitted).toEqual([]);
    });

    test("a socket that goes away takes its timer and its session with it", async () => {
      jest.useFakeTimers({ now: Date.now(), doNotFake: ["nextTick"] });

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({}, 120)),
      );

      await listen(socket);

      expect(RealtimeSessions.size()).toBe(1);

      socket.disconnect();

      expect(RealtimeSessions.size()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);

      jest.advanceTimersByTime(200_000);

      expect(socket.emitted).toEqual([]);
    });

    test("several joins on one handshake read the access token's times once", async () => {
      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken()),
      );
      const verify: jest.SpyInstance = jest.spyOn(
        JSONWebToken,
        "decodeJsonPayload",
      );

      await listen(socket);

      const afterFirstJoin: number = verify.mock.calls.length;

      await listen(socket, {
        ...REQUEST,
        modelName: "Alert",
        eventType: ModelEventType.Update,
      });

      // The second join verifies the session, as every request does, and no more.
      expect(verify.mock.calls.length - afterFirstJoin).toBe(1);
      expect(socket.subscribedRooms()).toHaveLength(2);
    });

    test("several joins on one handshake keep one session, one timer and one disconnect listener", async () => {
      jest.useFakeTimers({ now: Date.now(), doNotFake: ["nextTick"] });

      const socket: FakeServerSocket = new FakeServerSocket(
        cookieWith(validToken({}, 120)),
      );

      await listen(socket);
      await listen(socket, {
        ...REQUEST,
        modelName: "Alert",
        eventType: ModelEventType.Update,
      });

      expect(socket.subscribedRooms()).toHaveLength(2);
      expect(RealtimeSessions.size()).toBe(1);
      expect(jest.getTimerCount()).toBe(1);
      expect(socket.listeners.get("disconnect")).toHaveLength(1);

      jest.advanceTimersByTime(121_000);

      expect(socket.subscribedRooms()).toEqual([]);
      expect(socket.authenticationRequiredEvents()).toEqual([{}]);
    });
  });
});
