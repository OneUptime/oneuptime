import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Redis as RedisClient } from "ioredis";
import Incident from "../../../../Models/DatabaseModels/Incident";
import type * as SocketIOClusterModule from "../../../../Server/Infrastructure/SocketIOCluster";
import { RealtimeAccessChangeKind } from "../../../../Server/Utils/Realtime/RealtimeAccessChanges";
import ObjectID from "../../../../Types/ObjectID";
import ModelEventType from "../../../../Types/Realtime/ModelEventType";
import RealtimeUtil from "../../../../Utils/Realtime";
import {
  ClusterServer,
  FakeReadAccess,
  Page,
  eventually,
  heardIds,
  openPage,
  settle,
  startClusterServer,
  useNodeTimers,
} from "../../TestingUtils/Realtime/RealtimeClusterHarness";
import getTestRedisConnectionOptions from "../../TestingUtils/Redis/TestRedisOptions";

/*
 * SEVERAL APP SERVERS, ONE VALKEY (#8662).
 *
 * RealtimeCluster.test.ts's scenarios over a real Valkey, as production
 * runs them: each server has its own Valkey connection, and the cluster
 * adapter of production (SocketIOCluster's ValkeySocketIOClusterBus) joins
 * their socket.io servers over it. The Valkey the Common suites run
 * against (TestRedisOptions; set REALTIME_CLUSTER_TEST_REDIS_URL to use
 * another, a throwaway container say). Each run has a cluster channel of
 * its own, so runs sharing a Valkey stay apart.
 */

jest.mock("../../../../Server/Utils/Logger");

const TENANT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const READER: string = "11111111-1111-4111-8111-111111111111";
const MEMBER_WHO_MAY_NOT: string = "33333333-3333-4333-8333-333333333333";

const RECORD_A: string = "a0000000-0000-4000-8000-00000000000a";
const RECORD_B: string = "b0000000-0000-4000-8000-00000000000b";

const CREATE_ROOM: string = RealtimeUtil.getRoomId(
  TENANT_ID,
  "Incident",
  ModelEventType.Create,
);

const QUIET_MS: number = 300;

const redisUrl: string | undefined =
  process.env["REALTIME_CLUSTER_TEST_REDIS_URL"];

function connection(): RedisClient {
  return redisUrl
    ? new RedisClient(redisUrl, { lazyConnect: true })
    : new RedisClient(getTestRedisConnectionOptions());
}

const CHANNEL: string = `oneuptime:realtime:cluster:test:${ObjectID.generate().toString()}`;

let servers: Array<ClusterServer>;
let pages: Array<Page>;
let clients: Array<RedisClient>;
let access: FakeReadAccess;
// Everything put on the run's cluster channels, as Valkey carried it.
let traffic: Array<string>;
let listener: RedisClient;
let restoreTimers: () => void = (): void => {};

async function start(name: string): Promise<ClusterServer> {
  const client: RedisClient = connection();
  await client.connect();
  clients.push(client);

  const server: ClusterServer = await startClusterServer({
    name: name,
    members: new Set<string>([READER, MEMBER_WHO_MAY_NOT]),
    redisClient: client,
    channel: CHANNEL,
    bus: (cluster: typeof SocketIOClusterModule) => {
      return new cluster.ValkeySocketIOClusterBus();
    },
  });

  servers.push(server);
  await settle(20);

  return server;
}

async function page(
  server: ClusterServer,
  userId: string,
  rooms: Array<string> = [CREATE_ROOM],
  cookie?: string,
): Promise<Page> {
  const opened: Page = await openPage(server, {
    userId: userId,
    rooms: rooms,
    ...(cookie ? { cookie: cookie } : {}),
  });

  pages.push(opened);

  return opened;
}

async function write(
  server: ClusterServer,
  recordIds: Array<string>,
): Promise<void> {
  for (const recordId of recordIds) {
    await server.realtime.emitModelEvent({
      tenantId: TENANT_ID,
      eventType: ModelEventType.Create,
      modelId: new ObjectID(recordId),
      modelType: Incident,
      access: access,
    });
  }

  await server.realtime.waitForPendingDeliveries();
}

beforeAll(async () => {
  restoreTimers = useNodeTimers();

  listener = connection();
  await listener.connect();
  listener.on(
    "pmessage",
    (_pattern: string, _channel: string, message: string) => {
      traffic.push(message);
    },
  );
  await listener.psubscribe(`${CHANNEL}*`);
}, 30_000);

afterAll(async () => {
  listener?.disconnect();
  restoreTimers();
});

beforeEach(() => {
  servers = [];
  pages = [];
  clients = [];
  traffic = [];
  access = new FakeReadAccess();
});

afterEach(async () => {
  for (const opened of pages) {
    opened.close();
  }

  for (const server of servers) {
    await server.stop();
  }

  for (const client of clients) {
    client.disconnect();
  }

  jest.restoreAllMocks();
}, 30_000);

describe("live record updates across servers, over Valkey", () => {
  test("a write on A reaches the reader on B; a member on B who may not read it hears nothing", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    access.readableByUser.set(READER, new Set<string>([RECORD_A]));

    const reader: Page = await page(serverB, READER);
    const mayNot: Page = await page(serverB, MEMBER_WHO_MAY_NOT);

    await write(serverA, [RECORD_A]);

    expect(
      await eventually((): boolean => {
        return heardIds(reader, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);
    expect(heardIds(reader, CREATE_ROOM)).toEqual([RECORD_A]);
    expect(heardIds(mayNot, CREATE_ROOM)).toEqual([]);
  });

  test("a worker's write - no pages of its own - reaches the reader on B", async () => {
    const worker: ClusterServer = await start("worker");
    const serverB: ClusterServer = await start("B");
    access.readableByUser.set(READER, new Set<string>([RECORD_A]));

    const reader: Page = await page(serverB, READER);

    await write(worker, [RECORD_A]);

    expect(
      await eventually((): boolean => {
        return heardIds(reader, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
  });

  test("a person with a page on A and one on B hears each record once on each", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    access.readableByUser.set(READER, new Set<string>([RECORD_A, RECORD_B]));

    const onA: Page = await page(serverA, READER);
    const onB: Page = await page(serverB, READER);

    await write(serverA, [RECORD_A]);
    await write(serverB, [RECORD_B]);

    expect(
      await eventually((): boolean => {
        return (
          heardIds(onA, CREATE_ROOM).length >= 2 &&
          heardIds(onB, CREATE_ROOM).length >= 2
        );
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);

    for (const opened of [onA, onB]) {
      expect(heardIds(opened, CREATE_ROOM).sort()).toEqual(
        [RECORD_A, RECORD_B].sort(),
      );
    }
  });

  test("one server restarting: the others hear at once meanwhile, and its pages, back, hear again", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    access.readableByUser.set(READER, new Set<string>([RECORD_A, RECORD_B]));

    const onA: Page = await page(serverA, READER);
    const onB: Page = await page(serverB, READER);

    onB.close();
    await serverB.stop();
    servers.splice(servers.indexOf(serverB), 1);

    const startedAt: number = Date.now();
    await write(serverA, [RECORD_A]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(
      await eventually((): boolean => {
        return heardIds(onA, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);

    const restarted: ClusterServer = await start("B again");
    const backOnB: Page = await page(restarted, READER);

    await write(serverA, [RECORD_B]);

    expect(
      await eventually((): boolean => {
        return heardIds(backOnB, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
  });

  test("nothing of a page's handshake crosses Valkey", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    access.readableByUser.set(READER, new Set<string>([RECORD_A]));

    const secret: string = `oneuptime-access-token=${ObjectID.generate().toString()}`;
    const reader: Page = await page(serverB, READER, [CREATE_ROOM], secret);

    await write(serverA, [RECORD_A]);

    expect(
      await eventually((): boolean => {
        return heardIds(reader, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);

    const carried: string = traffic.join("\n");
    expect(carried.length).toBeGreaterThan(0);
    expect(carried).not.toContain(secret);
    expect(carried).not.toContain("handshake");
  });

  test("a project's usage changing, announced on A, is heard once by each page, on every server", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    const usageRoom: string = RealtimeUtil.getProjectUsageRoomId(TENANT_ID);

    const onA: Page = await page(serverA, READER, [usageRoom]);
    const onB: Page = await page(serverB, READER, [usageRoom]);

    serverA.changes.announce({
      kind: RealtimeAccessChangeKind.ProjectUsageChanged,
      projectId: TENANT_ID,
    });

    expect(
      await eventually((): boolean => {
        return (
          heardIds(onA, usageRoom).length === 1 &&
          heardIds(onB, usageRoom).length === 1
        );
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);

    expect(heardIds(onA, usageRoom)).toHaveLength(1);
    expect(heardIds(onB, usageRoom)).toHaveLength(1);
  });
});
