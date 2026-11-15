import { jest } from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import timers from "timers";
import { Server as SocketIOServer, Socket as ServerSocket } from "socket.io";
import type RealtimeType from "../../../../Server/Utils/Realtime";
import type RealtimeAccessChangesType from "../../../../Server/Utils/Realtime/RealtimeAccessChanges";
import type RealtimeReadersType from "../../../../Server/Utils/Realtime/RealtimeReaders";
import type RealtimeSessionsType from "../../../../Server/Utils/Realtime/RealtimeSessions";
import type RedisType from "../../../../Server/Infrastructure/Redis";
import type * as SocketIOClusterModule from "../../../../Server/Infrastructure/SocketIOCluster";
import type {
  ClusterBusHandler,
  SocketIOClusterBus,
} from "../../../../Server/Infrastructure/SocketIOCluster";
import {
  RealtimeReadAccess,
  RealtimeReader,
} from "../../../../Server/Utils/Realtime/RealtimeReadAccess";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";

/*
 * SEVERAL APP SERVERS IN ONE TEST PROCESS (#8662).
 *
 * Each server is its own copy of the realtime modules (jest.isolateModules)
 * - its own Realtime, sessions, readers and cluster adapter, as each App
 * process has - with a real socket.io server on a port of its own, the
 * cluster adapter of production (SocketIOCluster) joining it to the others
 * over a bus: Valkey, or one in memory that can lose a member without a
 * word, as a crash does. A page is a real socket.io client connected to one
 * server; it is admitted to rooms as an allowed join admits it (a session
 * kept on the socket, the rooms joined), without the join's own checks,
 * which Realtime.test.ts and RealtimeJoinGuard.test.ts hold.
 */

/*
 * Common's jest environment is jsdom, which bends two things a socket.io
 * server needs:
 *
 *   - its timers are a browser's, a bare number without refresh() or
 *     unref() - the cluster adapter's heartbeat refreshes its own. A suite
 *     lends it Node's for its duration (useNodeTimers), as
 *     GracefulShutdown.test.ts does;
 *   - modules resolve as a browser's, so `ws` is its browser stub, which
 *     has no server. The server's WebSocket engine is loaded with Node's
 *     own require instead (the page's side is jsdom's WebSocket, as a
 *     browser's).
 */
const TIMER_NAMES: ReadonlyArray<string> = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
];

export function useNodeTimers(): () => void {
  const globals: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;
  const saved: Map<string, unknown> = new Map<string, unknown>();

  for (const name of TIMER_NAMES) {
    saved.set(name, globals[name]);
    globals[name] = (timers as unknown as Record<string, unknown>)[name];
  }

  return (): void => {
    for (const [name, timer] of saved) {
      globals[name] = timer;
    }
  };
}

// A WebSocket as a page's connection uses it.
interface NodeWebSocket {
  on(event: string, listener: (...args: Array<unknown>) => void): void;
  send(data: string): void;
  close(): void;
}

// ws's Node entry, by its file: the package's browser export is a stub.
const nodeWs: {
  WebSocketServer: unknown;
  WebSocket: new (url: string) => NodeWebSocket;
} =
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  require(
    path.join(path.dirname(require.resolve("ws/package.json")), "index.js"),
  );
const NodeWebSocketServer: unknown = nodeWs.WebSocketServer;
const NodeWebSocketClient: new (url: string) => NodeWebSocket =
  nodeWs.WebSocket;

export interface ClusterServer {
  name: string;
  realtime: typeof RealtimeType;
  sessions: typeof RealtimeSessionsType;
  readers: typeof RealtimeReadersType;
  changes: typeof RealtimeAccessChangesType;
  io: SocketIOServer;
  url: string;
  // Who the server's readers say are members of the project, as it builds them.
  members: Set<string>;
  stop: () => Promise<void>;
}

export interface Page {
  socket: NodeWebSocket;
  // Every event the page heard, by name.
  heard: Array<{ event: string; payload: unknown }>;
  close: () => void;
}

/*
 * A record's read, as a test describes it: which records each person may
 * read. Records every question, as RealtimeDelivery.test.ts's does.
 */
export class FakeReadAccess implements RealtimeReadAccess {
  public readableByUser: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();
  public questions: Array<string> = [];

  public async readsEveryRecord(): Promise<boolean> {
    return false;
  }

  public async getReadableIds(
    reader: RealtimeReader,
    modelIds: Array<ObjectID>,
  ): Promise<Array<string>> {
    const userId: string = reader.props.userId!.toString();
    this.questions.push(userId);

    const readable: Set<string> =
      this.readableByUser.get(userId) || new Set<string>();

    return modelIds
      .map((id: ObjectID): string => {
        return id.toString();
      })
      .filter((id: string): boolean => {
        return readable.has(id);
      });
  }
}

/*
 * The members' bus in memory: what one publishes, every member hears, a
 * tick later, as on Valkey. A member can lose the bus without a word
 * (crash) - it neither hears nor is heard - and come back.
 */
export class InMemoryClusterHub {
  public members: Set<InMemoryClusterBus> = new Set<InMemoryClusterBus>();
  public published: Array<{
    channel: string;
    message: string;
    from: InMemoryClusterBus;
  }> = [];

  public bus(): InMemoryClusterBus {
    return new InMemoryClusterBus(this);
  }
}

export class InMemoryClusterBus implements SocketIOClusterBus {
  private handlers: Map<string, Set<ClusterBusHandler>> = new Map<
    string,
    Set<ClusterBusHandler>
  >();
  private isUp: boolean = false;
  private againListeners: Array<() => void> = [];

  public constructor(private readonly hub: InMemoryClusterHub) {}

  public async publish(channel: string, message: string): Promise<void> {
    if (!this.isUp) {
      throw new Error("The bus is down.");
    }

    this.hub.published.push({ channel: channel, message: message, from: this });

    for (const member of Array.from(this.hub.members)) {
      setTimeout((): void => {
        member.deliver(channel, message);
      }, 0);
    }
  }

  public async subscribe(
    channels: Array<string>,
    onMessage: ClusterBusHandler,
  ): Promise<void> {
    for (const channel of channels) {
      const handlers: Set<ClusterBusHandler> =
        this.handlers.get(channel) || new Set<ClusterBusHandler>();
      handlers.add(onMessage);
      this.handlers.set(channel, handlers);
    }

    this.isUp = true;
    this.hub.members.add(this);
  }

  public async unsubscribe(
    channels: Array<string>,
    onMessage: ClusterBusHandler,
  ): Promise<void> {
    for (const channel of channels) {
      this.handlers.get(channel)?.delete(onMessage);
    }
  }

  public isListening(): boolean {
    return this.isUp;
  }

  public onListeningAgain(listener: () => void): void {
    this.againListeners.push(listener);
  }

  // The member loses the bus without a word: a crash, a network gone.
  public lose(): void {
    this.isUp = false;
    this.hub.members.delete(this);
  }

  // The bus is back.
  public regain(): void {
    this.isUp = true;
    this.hub.members.add(this);

    for (const listener of this.againListeners) {
      listener();
    }
  }

  public deliver(channel: string, message: string): void {
    if (!this.isUp) {
      return;
    }

    for (const handler of Array.from(this.handlers.get(channel) || [])) {
      handler(channel, message);
    }
  }
}

// The heartbeats the tests' clusters keep: short, so a lost member goes soon.
export const TEST_HEARTBEAT_INTERVAL_MS: number = 100;
export const TEST_HEARTBEAT_TIMEOUT_MS: number = 400;

export async function startClusterServer(data: {
  name: string;
  members: Set<string>;
  // The bus, from this server's own modules (Valkey) or a hub's (memory).
  bus: (cluster: typeof SocketIOClusterModule) => SocketIOClusterBus;
  // This server's own Valkey connection, for the Valkey bus and the channel.
  redisClient?: unknown;
  // The cluster's channel: one of a run's own, so runs sharing a Valkey stay apart.
  channel?: string | undefined;
}): Promise<ClusterServer> {
  const holder: { io: SocketIOServer | null } = { io: null };
  let modules: {
    realtime: typeof RealtimeType;
    sessions: typeof RealtimeSessionsType;
    readers: typeof RealtimeReadersType;
    changes: typeof RealtimeAccessChangesType;
    cluster: typeof SocketIOClusterModule;
    redis: typeof RedisType;
  } | null = null;

  jest.isolateModules((): void => {
    jest.doMock("../../../../Server/Infrastructure/SocketIO", () => {
      return {
        __esModule: true,
        default: {
          getSocketServer: (): SocketIOServer | null => {
            return holder.io;
          },
        },
      };
    });

    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    modules = {
      redis: require("../../../../Server/Infrastructure/Redis").default,
      cluster: require("../../../../Server/Infrastructure/SocketIOCluster"),
      realtime: require("../../../../Server/Utils/Realtime").default,
      sessions: require("../../../../Server/Utils/Realtime/RealtimeSessions")
        .default,
      readers: require("../../../../Server/Utils/Realtime/RealtimeReaders")
        .default,
      changes:
        require("../../../../Server/Utils/Realtime/RealtimeAccessChanges")
          .default,
    };
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  const loaded: NonNullable<typeof modules> = modules!;

  if (data.redisClient) {
    jest
      .spyOn(loaded.redis, "getClient")
      .mockReturnValue(
        data.redisClient as ReturnType<typeof loaded.redis.getClient>,
      );
    jest.spyOn(loaded.redis, "isConnected").mockReturnValue(true);
  }

  // Members read as members, as their permissions are built.
  jest
    .spyOn(loaded.readers, "buildProps")
    .mockImplementation(
      async (
        identity: { userId: string; isMasterAdmin: boolean },
        projectId: string,
      ): Promise<DatabaseCommonInteractionProps | null> => {
        if (!data.members.has(identity.userId) && !identity.isMasterAdmin) {
          return null;
        }

        return {
          userId: new ObjectID(identity.userId),
          userType: UserType.User,
          tenantId: new ObjectID(projectId),
          isMasterAdmin: identity.isMasterAdmin,
        } as DatabaseCommonInteractionProps;
      },
    );

  const httpServer: http.Server = http.createServer();
  await new Promise<void>((resolve: () => void): void => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const io: SocketIOServer = new SocketIOServer(httpServer, {
    wsEngine: NodeWebSocketServer as never,
    adapter: loaded.cluster.createSocketIOClusterAdapter({
      bus: data.bus(loaded.cluster),
      channel: data.channel,
      heartbeatInterval: TEST_HEARTBEAT_INTERVAL_MS,
      heartbeatTimeout: TEST_HEARTBEAT_TIMEOUT_MS,
    }) as never,
  });
  holder.io = io;

  // An allowed join, as far as this harness needs one: see the top.
  io.on("connection", (socket: ServerSocket): void => {
    const auth: Record<string, unknown> = (socket.handshake.auth ||
      {}) as Record<string, unknown>;
    const userId: string = String(auth["userId"] || "");
    const rooms: Array<string> = (auth["rooms"] as Array<string>) || [];

    if (!userId) {
      return;
    }

    /*
     * The cookie a page's handshake carries (a browser's WebSocket cannot
     * set one itself): the access token, as every handshake has it.
     */
    if (typeof auth["cookie"] === "string") {
      socket.handshake.headers["cookie"] = auth["cookie"];
    }

    loaded.sessions.begin(socket as never, {
      userId: userId,
      isMasterAdmin: auth["isMasterAdmin"] === true,
      sessionId: ObjectID.generate().toString(),
      expiresAtMs: Date.now() + 60 * 60 * 1000,
    });

    void Promise.all(
      rooms.map(async (room: string): Promise<void> => {
        await socket.join(room);
      }),
    ).then((): void => {
      socket.emit("test:admitted", {});
    });
  });

  await loaded.realtime.init();

  if (!data.redisClient) {
    // No Valkey: the server stops trying to listen to it.
    await loaded.changes.stopListening();
  }

  // The cluster heard: the server's first heartbeat is out.
  await settle(5);

  const port: number = (httpServer.address() as AddressInfo).port;

  return {
    name: data.name,
    realtime: loaded.realtime,
    sessions: loaded.sessions,
    readers: loaded.readers,
    changes: loaded.changes,
    io: io,
    url: `http://127.0.0.1:${port}`,
    members: data.members,
    stop: async (): Promise<void> => {
      await loaded.changes.stopListening();
      loaded.sessions.clear();
      await new Promise<void>((resolve: () => void): void => {
        io.close((): void => {
          resolve();
        });
      });
    },
  };
}

/*
 * A page connected to `server`, admitted to `rooms` as `userId`: a
 * WebSocket speaking socket.io's protocol (engine.io 4) as a browser's
 * client does - open, connect to the main namespace with its auth, answer
 * pings, hear events. socket.io-client's browser build does not connect
 * under jsdom, so the page speaks it itself.
 */
export async function openPage(
  server: ClusterServer,
  data: { userId: string; rooms: Array<string>; cookie?: string },
): Promise<Page> {
  const socket: NodeWebSocket = new NodeWebSocketClient(
    `${server.url.replace("http://", "ws://")}/socket.io/?EIO=4&transport=websocket`,
  );

  const heard: Array<{ event: string; payload: unknown }> = [];
  const auth: Record<string, unknown> = {
    userId: data.userId,
    rooms: data.rooms,
    ...(data.cookie ? { cookie: data.cookie } : {}),
  };

  await new Promise<void>(
    (resolve: () => void, reject: (err: Error) => void): void => {
      const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
        reject(new Error(`A page on ${server.name} was not admitted.`));
      }, 5000);

      socket.on("error", (err: unknown): void => {
        clearTimeout(timer);
        reject(err as Error);
      });

      socket.on("message", (raw: unknown): void => {
        const packet: string = String(raw);

        // Opened: connect to the main namespace, with the page's auth.
        if (packet.startsWith("0")) {
          socket.send(`40${JSON.stringify(auth)}`);
          return;
        }

        // A ping: answered, or the server lets the page go.
        if (packet === "2") {
          socket.send("3");
          return;
        }

        // An event: 42["name", payload].
        if (packet.startsWith("42")) {
          const [event, payload]: [string, unknown] = JSON.parse(
            packet.slice(2),
          ) as [string, unknown];

          if (event === "test:admitted") {
            clearTimeout(timer);
            resolve();
            return;
          }

          heard.push({ event: event, payload: payload });
        }
      });
    },
  );

  return {
    socket: socket,
    heard: heard,
    close: (): void => {
      socket.close();
    },
  };
}

// The events of `name` a page heard, as the model ids they carried.
export function heardIds(page: Page, name: string): Array<string> {
  return page.heard
    .filter((heard: { event: string }): boolean => {
      return heard.event === name;
    })
    .map((heard: { payload: unknown }): string => {
      return String(
        (heard.payload as Record<string, unknown> | null)?.["modelId"] ?? "",
      );
    });
}

// Lets timers, messages and sockets run, `rounds` times a tick.
export async function settle(rounds: number = 20): Promise<void> {
  for (let round: number = 0; round < rounds; round++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 5);
    });
  }
}

// Waits until `condition`, or `timeoutMs`; says which came first.
export async function eventually(
  condition: () => boolean,
  timeoutMs: number = 5000,
): Promise<boolean> {
  const startedAt: number = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return true;
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }

  return condition();
}
