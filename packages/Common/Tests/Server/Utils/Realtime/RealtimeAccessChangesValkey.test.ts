import RealtimeAccessChangesType, {
  RealtimeAccessChangeKind,
} from "../../../../Server/Utils/Realtime/RealtimeAccessChanges";
import type RealtimeReadersType from "../../../../Server/Utils/Realtime/RealtimeReaders";
import type RealtimeSessionsType from "../../../../Server/Utils/Realtime/RealtimeSessions";
import type { RealtimeSessionSocket } from "../../../../Server/Utils/Realtime/RealtimeSessions";
import type RedisType from "../../../../Server/Infrastructure/Redis";
import ObjectID from "../../../../Types/ObjectID";
import getTestRedisConnectionOptions from "../../TestingUtils/Redis/TestRedisOptions";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { Redis as RedisClient } from "ioredis";

/*
 * TWO SERVERS, ONE VALKEY: a change announced on one server reaches the
 * sockets the other one holds.
 *
 * Each "server" is its own copy of the realtime modules (jest.isolateModules),
 * with its own Valkey connection - as two app servers have - and the Valkey
 * the Common suites run against (TestRedisOptions; set
 * REALTIME_ACCESS_CHANGES_TEST_REDIS_URL to use another). Server A signs a
 * session out; server B, which holds the socket that joined with it, ends
 * its live updates. A server never applies its own announcement twice.
 */

const mockForgetTeamIdsForUser: jest.Mock = jest.fn();

jest.mock("../../../../Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      forgetTeamIdsForUser: (...args: Array<unknown>): unknown => {
        return mockForgetTeamIdsForUser(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      forgetBlockedStatus: jest.fn(),
    },
  };
});

interface Server {
  changes: typeof RealtimeAccessChangesType;
  sessions: typeof RealtimeSessionsType;
  readers: typeof RealtimeReadersType;
  client: RedisClient;
}

const redisUrl: string | undefined =
  process.env["REALTIME_ACCESS_CHANGES_TEST_REDIS_URL"];

function connection(): RedisClient {
  return redisUrl
    ? new RedisClient(redisUrl, { lazyConnect: true })
    : new RedisClient(getTestRedisConnectionOptions());
}

async function startServer(): Promise<Server> {
  let server: Server | null = null;

  jest.isolateModules((): void => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const redis: typeof RedisType =
      require("../../../../Server/Infrastructure/Redis").default;
    const changes: typeof RealtimeAccessChangesType =
      require("../../../../Server/Utils/Realtime/RealtimeAccessChanges").default;
    const sessions: typeof RealtimeSessionsType =
      require("../../../../Server/Utils/Realtime/RealtimeSessions").default;
    const readers: typeof RealtimeReadersType =
      require("../../../../Server/Utils/Realtime/RealtimeReaders").default;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    const client: RedisClient = connection();

    jest
      .spyOn(redis, "getClient")
      .mockReturnValue(client as unknown as ReturnType<typeof redis.getClient>);
    jest.spyOn(redis, "isConnected").mockReturnValue(true);

    server = { changes, sessions, readers, client };
  });

  await server!.client.connect();
  await server!.changes.listen();

  return server!;
}

let nextSocket: number = 1;

class SessionSocket implements RealtimeSessionSocket {
  public id: string = `valkey-socket-${nextSocket++}`;
  public data: unknown = undefined;
  public rooms: Set<string> = new Set<string>([this.id, "a-room"]);
  public told: Array<string> = [];

  public leave(room: string): void {
    this.rooms.delete(room);
  }

  public emit(event: string): boolean {
    this.told.push(event);
    return true;
  }

  public on(): unknown {
    return this;
  }
}

async function eventually(
  condition: () => boolean,
  timeoutMs: number = 5000,
): Promise<boolean> {
  const startedAt: number = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return true;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  }

  return condition();
}

describe("access changes reach every server through Valkey", () => {
  let serverA: Server;
  let serverB: Server;

  beforeAll(async () => {
    serverA = await startServer();
    serverB = await startServer();
  }, 30_000);

  afterAll(async () => {
    for (const server of [serverA, serverB]) {
      if (!server) {
        continue;
      }

      await server.changes.stopListening();
      server.sessions.clear();
      server.client.disconnect();
    }

    jest.restoreAllMocks();
  });

  test("signing out on one server ends the session's sockets on the other", async () => {
    const sessionId: string = ObjectID.generate().toString();
    const otherSessionId: string = ObjectID.generate().toString();
    const userId: string = ObjectID.generate().toString();

    const onB: SessionSocket = new SessionSocket();
    const otherOnB: SessionSocket = new SessionSocket();

    serverB.sessions.begin(onB, {
      userId: userId,
      isMasterAdmin: false,
      sessionId: sessionId,
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });
    serverB.sessions.begin(otherOnB, {
      userId: userId,
      isMasterAdmin: false,
      sessionId: otherSessionId,
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });

    serverA.changes.announce({
      kind: RealtimeAccessChangeKind.SessionsEnded,
      sessionIds: [sessionId],
    });

    await expect(
      eventually((): boolean => {
        return serverB.sessions.getSession(onB) === null;
      }),
    ).resolves.toBe(true);

    expect(onB.rooms.has("a-room")).toBe(false);
    expect(onB.told).toEqual(["AuthenticationRequired"]);
    expect(serverB.sessions.getSession(otherOnB)).not.toBeNull();
    // Server B remembers it too, so a join with that session is refused there.
    expect(
      serverB.sessions.wasEnded({
        userId: userId,
        sessionId: sessionId,
        issuedAtMs: Date.now(),
      }),
    ).toBe(true);
  });

  test("a permission change on one server makes the other read the person again", async () => {
    const userId: string = ObjectID.generate().toString();
    const projectId: string = ObjectID.generate().toString();
    const forgetUser: jest.SpyInstance = jest.spyOn(
      serverB.readers,
      "forgetUser",
    );

    serverA.changes.announce({
      kind: RealtimeAccessChangeKind.PermissionsChanged,
      userId: userId,
      projectId: projectId,
    });

    await expect(
      eventually((): boolean => {
        return forgetUser.mock.calls.some((call: Array<unknown>): boolean => {
          return call[0] === userId && call[1] === projectId;
        });
      }),
    ).resolves.toBe(true);

    expect(mockForgetTeamIdsForUser).toHaveBeenCalledWith(
      new ObjectID(userId),
      new ObjectID(projectId),
    );
  });

  test("a server applies its own announcement once, not again when Valkey echoes it", async () => {
    const userId: string = ObjectID.generate().toString();
    const endWhereOnA: jest.SpyInstance = jest.spyOn(
      serverA.sessions,
      "endWhere",
    );
    const endWhereOnB: jest.SpyInstance = jest.spyOn(
      serverB.sessions,
      "endWhere",
    );

    serverA.changes.announce({
      kind: RealtimeAccessChangeKind.SessionsEnded,
      userId: userId,
    });

    await expect(
      eventually((): boolean => {
        return endWhereOnB.mock.calls.length > 0;
      }),
    ).resolves.toBe(true);

    // Give A's own copy time to come back from Valkey.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 200);
    });

    expect(
      endWhereOnA.mock.calls.filter((call: Array<unknown>): boolean => {
        return (call[0] as { userId?: string }).userId === userId;
      }),
    ).toHaveLength(1);
  });
});
