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
import Incident from "../../../../Models/DatabaseModels/Incident";
import { LISTENERS_REQUEST_EVENT } from "../../../../Server/Utils/Realtime";
import ObjectID from "../../../../Types/ObjectID";
import EventName from "../../../../Types/Realtime/EventName";
import ModelEventType from "../../../../Types/Realtime/ModelEventType";
import RealtimeUtil from "../../../../Utils/Realtime";
import {
  ClusterServer,
  FakeReadAccess,
  InMemoryClusterBus,
  InMemoryClusterHub,
  Page,
  TEST_HEARTBEAT_TIMEOUT_MS,
  eventually,
  heardIds,
  openPage,
  settle,
  startClusterServer,
  useNodeTimers,
} from "../../TestingUtils/Realtime/RealtimeClusterHarness";

/*
 * A RECORD'S LIVE UPDATE REACHES EVERY READER, WHICHEVER APP SERVER WROTE
 * IT (#8662).
 *
 * A record written on one App process used to be heard only by the pages
 * connected to that process: with two replicas, or a worker opening the
 * incident, the others heard nothing until they reloaded. Every process's
 * socket.io server is now a member of one cluster (SocketIOCluster), and
 * the writer works out who may hear each record over every member's
 * listeners, with the same checks as before (RealtimeAudience, the
 * record's own read, a session that lasts).
 *
 * Here, several servers in one process, joined by a bus in memory (the
 * same scenarios run over a real Valkey in RealtimeClusterValkey.test.ts):
 *
 *   - a write on A reaches a reader on B, and on A;
 *   - a reader on B who may not read the record hears nothing, and one who
 *     may read only some of the records hears only those;
 *   - a worker's write (a server with no pages of its own) reaches them;
 *   - a delete, decided before the write, reaches who could read it on
 *     every server, and nobody else;
 *   - one person with a page on A and one on B hears each record once on
 *     each page;
 *   - a server that restarts, or goes without a word, holds nobody up,
 *     and its pages hear again once they are back;
 *   - no handshake (no cookie, no token) ever crosses the bus;
 *   - what every server is told anyway (a project's usage changing), and
 *     an access recheck, stay with each server's own sockets.
 */

jest.mock("../../../../Server/Utils/Logger");

const TENANT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const READER: string = "11111111-1111-4111-8111-111111111111";
const PARTIAL_READER: string = "22222222-2222-4222-8222-222222222222";
const MEMBER_WHO_MAY_NOT: string = "33333333-3333-4333-8333-333333333333";
const FORMER_MEMBER: string = "44444444-4444-4444-8444-444444444444";

const RECORD_A: string = "a0000000-0000-4000-8000-00000000000a";
const RECORD_B: string = "b0000000-0000-4000-8000-00000000000b";

const CREATE_ROOM: string = RealtimeUtil.getRoomId(
  TENANT_ID,
  "Incident",
  ModelEventType.Create,
);
const DELETE_ROOM: string = RealtimeUtil.getRoomId(
  TENANT_ID,
  "Incident",
  ModelEventType.Delete,
);

// How long a page is given to hear something it must not.
const QUIET_MS: number = 300;

let hub: InMemoryClusterHub;
let servers: Array<ClusterServer>;
let pages: Array<Page>;
let buses: Map<string, InMemoryClusterBus>;
let access: FakeReadAccess;

async function start(name: string): Promise<ClusterServer> {
  const server: ClusterServer = await startClusterServer({
    name: name,
    members: new Set<string>([READER, PARTIAL_READER, MEMBER_WHO_MAY_NOT]),
    bus: (): InMemoryClusterBus => {
      const bus: InMemoryClusterBus = hub.bus();
      buses.set(name, bus);
      return bus;
    },
  });

  servers.push(server);
  // Every member has heard of the others.
  await settle(10);

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
  options?: {
    eventType?: ModelEventType;
    access?:
      | FakeReadAccess
      | Awaited<ReturnType<ClusterServer["realtime"]["snapshotReadAccess"]>>;
  },
): Promise<void> {
  for (const recordId of recordIds) {
    await server.realtime.emitModelEvent({
      tenantId: TENANT_ID,
      eventType: options?.eventType || ModelEventType.Create,
      modelId: new ObjectID(recordId),
      modelType: Incident,
      access: options?.access || access,
    });
  }

  await server.realtime.waitForPendingDeliveries();
}

function readable(userId: string, ...recordIds: Array<string>): void {
  access.readableByUser.set(userId, new Set<string>(recordIds));
}

let restoreTimers: () => void = (): void => {};

beforeAll(() => {
  restoreTimers = useNodeTimers();
});

afterAll(() => {
  restoreTimers();
});

beforeEach(() => {
  hub = new InMemoryClusterHub();
  servers = [];
  pages = [];
  buses = new Map<string, InMemoryClusterBus>();
  access = new FakeReadAccess();
});

afterEach(async () => {
  for (const opened of pages) {
    opened.close();
  }

  for (const server of servers) {
    await server.stop();
  }

  jest.restoreAllMocks();
}, 20_000);

describe("a record written on one server reaches every reader who may read it", () => {
  test("a write on A reaches the reader whose page is on B, and the one on A", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A);

    const onA: Page = await page(serverA, READER);
    const onB: Page = await page(serverB, READER);

    await write(serverA, [RECORD_A]);

    expect(
      await eventually((): boolean => {
        return heardIds(onB, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
    expect(heardIds(onB, CREATE_ROOM)).toEqual([RECORD_A]);
    expect(heardIds(onA, CREATE_ROOM)).toEqual([RECORD_A]);
  });

  test("and the other way round: a write on B reaches the reader on A", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A);

    const onA: Page = await page(serverA, READER);

    await write(serverB, [RECORD_A]);

    expect(
      await eventually((): boolean => {
        return heardIds(onA, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
  });

  test("a reader on B who may not read the record hears nothing; one who may read only some hears only those", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A, RECORD_B);
    readable(PARTIAL_READER, RECORD_B);
    readable(MEMBER_WHO_MAY_NOT);

    const reader: Page = await page(serverB, READER);
    const partial: Page = await page(serverB, PARTIAL_READER);
    const mayNot: Page = await page(serverB, MEMBER_WHO_MAY_NOT);
    const former: Page = await page(serverB, FORMER_MEMBER);

    await write(serverA, [RECORD_A, RECORD_B]);

    expect(
      await eventually((): boolean => {
        return heardIds(reader, CREATE_ROOM).length === 2;
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);

    expect(heardIds(reader, CREATE_ROOM).sort()).toEqual(
      [RECORD_A, RECORD_B].sort(),
    );
    expect(heardIds(partial, CREATE_ROOM)).toEqual([RECORD_B]);
    expect(heardIds(mayNot, CREATE_ROOM)).toEqual([]);
    expect(heardIds(former, CREATE_ROOM)).toEqual([]);
    // A former member is not even asked about the records: they read nothing there.
    expect(access.questions).not.toContain(FORMER_MEMBER);
  });

  test("a worker's write - a server with no pages of its own - reaches the reader on B", async () => {
    const worker: ClusterServer = await start("worker");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A);

    const onB: Page = await page(serverB, READER);

    await write(worker, [RECORD_A]);

    expect(
      await eventually((): boolean => {
        return heardIds(onB, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
  });

  test("a page that listens to the record alone, on B, hears it in the record's own room", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A);

    const recordRoom: string = RealtimeUtil.getRecordRoomId(
      TENANT_ID,
      "Incident",
      RECORD_A,
    );
    const onB: Page = await page(serverB, READER, [recordRoom]);

    await write(serverA, [RECORD_A, RECORD_B], {
      eventType: ModelEventType.Update,
    });

    expect(
      await eventually((): boolean => {
        return heardIds(onB, recordRoom).length === 1;
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);
    expect(heardIds(onB, recordRoom)).toEqual([RECORD_A]);
  });
});

describe("a delete, decided before the write", () => {
  test("reaches who could read the record on every server, and nobody else", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A);
    readable(MEMBER_WHO_MAY_NOT);

    const reader: Page = await page(serverB, READER, [DELETE_ROOM]);
    const mayNot: Page = await page(serverB, MEMBER_WHO_MAY_NOT, [DELETE_ROOM]);

    // Before the delete, while its read still finds the row.
    const before: Awaited<
      ReturnType<ClusterServer["realtime"]["snapshotReadAccess"]>
    > = await serverA.realtime.snapshotReadAccess({
      tenantId: TENANT_ID,
      modelType: Incident,
      modelIds: [new ObjectID(RECORD_A)],
      access: access,
    });

    // The row is gone: its read finds nothing any more.
    access.readableByUser.clear();

    await write(serverA, [RECORD_A], {
      eventType: ModelEventType.Delete,
      access: before,
    });

    expect(
      await eventually((): boolean => {
        return heardIds(reader, DELETE_ROOM).length === 1;
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);
    expect(heardIds(mayNot, DELETE_ROOM)).toEqual([]);
  });
});

describe("once per page", () => {
  test("a person with a page on A and one on B hears each record once on each", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A, RECORD_B);

    const onA: Page = await page(serverA, READER);
    const onB: Page = await page(serverB, READER);
    const secondOnB: Page = await page(serverB, READER);

    await write(serverA, [RECORD_A]);
    await write(serverB, [RECORD_B]);

    expect(
      await eventually((): boolean => {
        return [onA, onB, secondOnB].every((opened: Page): boolean => {
          return heardIds(opened, CREATE_ROOM).length >= 2;
        });
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);

    for (const opened of [onA, onB, secondOnB]) {
      expect(heardIds(opened, CREATE_ROOM).sort()).toEqual(
        [RECORD_A, RECORD_B].sort(),
      );
    }

    // One person, one answer: their permissions were asked once per batch.
    expect(
      access.questions.filter((userId: string): boolean => {
        return userId === READER;
      }),
    ).toHaveLength(2);
  });

  test("three servers: each page hears it once, whichever server wrote", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    const serverC: ClusterServer = await start("C");
    readable(READER, RECORD_A);

    const opened: Array<Page> = [
      await page(serverA, READER),
      await page(serverB, READER),
      await page(serverC, READER),
    ];

    await write(serverB, [RECORD_A]);

    expect(
      await eventually((): boolean => {
        return opened.every((one: Page): boolean => {
          return heardIds(one, CREATE_ROOM).length === 1;
        });
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);

    for (const one of opened) {
      expect(heardIds(one, CREATE_ROOM)).toEqual([RECORD_A]);
    }
  });
});

describe("a server that restarts, or goes without a word", () => {
  test("restarting: while it is down the others hear at once, and its pages, back, hear again", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A, RECORD_B);

    const onA: Page = await page(serverA, READER);
    const onB: Page = await page(serverB, READER);

    // B shuts down: it tells the cluster, and its pages are gone with it.
    onB.close();
    await serverB.stop();
    servers.splice(servers.indexOf(serverB), 1);

    const startedAt: number = Date.now();
    await write(serverA, [RECORD_A]);

    // Nobody waits for B.
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(
      await eventually((): boolean => {
        return heardIds(onA, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);

    // B is back, and its page with it.
    const restarted: ClusterServer = await start("B again");
    const backOnB: Page = await page(restarted, READER);

    await write(serverA, [RECORD_B]);

    expect(
      await eventually((): boolean => {
        return heardIds(backOnB, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
    expect(heardIds(backOnB, CREATE_ROOM)).toEqual([RECORD_B]);
  });

  test("gone without a word (a crash): the others are held up no longer than the heartbeat, and hear on", async () => {
    const serverA: ClusterServer = await start("A");
    await start("B");
    const serverC: ClusterServer = await start("C");
    readable(READER, RECORD_A);

    const onA: Page = await page(serverA, READER);
    const onC: Page = await page(serverC, READER);

    buses.get("B")!.lose();

    const startedAt: number = Date.now();
    await write(serverA, [RECORD_A]);

    // Let go within the heartbeat's timeout (and the once-a-second sweep).
    expect(Date.now() - startedAt).toBeLessThan(
      TEST_HEARTBEAT_TIMEOUT_MS + 2_000,
    );
    expect(
      await eventually((): boolean => {
        return (
          heardIds(onA, CREATE_ROOM).length === 1 &&
          heardIds(onC, CREATE_ROOM).length === 1
        );
      }),
    ).toBe(true);
  }, 20_000);

  test("a server whose bus is down publishes nothing, so no one waits for it, and its own pages still hear", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A);

    const onA: Page = await page(serverA, READER);
    const onB: Page = await page(serverB, READER);

    const lostBus: InMemoryClusterBus = buses.get("B")!;
    lostBus.lose();
    const publishedBefore: number = hub.published.length;

    const startedAt: number = Date.now();
    await write(serverB, [RECORD_A]);

    // B asks no one, so it waits for no one...
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    // ...and its own page hears what is written there.
    expect(
      await eventually((): boolean => {
        return heardIds(onB, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);
    expect(heardIds(onA, CREATE_ROOM)).toEqual([]);

    // Not a heartbeat, not a question: nothing B says is put on the bus.
    expect(
      hub.published
        .slice(publishedBefore)
        .filter((published: { from: InMemoryClusterBus }): boolean => {
          return published.from === lostBus;
        }),
    ).toEqual([]);

    // B is back: the others hear of it, and what it writes reaches them again.
    lostBus.regain();
    await settle(20);
    readable(READER, RECORD_A, RECORD_B);
    await write(serverB, [RECORD_B]);

    expect(
      await eventually((): boolean => {
        return heardIds(onA, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
  }, 20_000);
});

describe("what crosses the bus", () => {
  test("no handshake: not a cookie, not a token, of any page", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    readable(READER, RECORD_A);

    const secret: string = `oneuptime-access-token=${ObjectID.generate().toString()}`;
    const onB: Page = await page(serverB, READER, [CREATE_ROOM], secret);

    await write(serverA, [RECORD_A]);

    expect(
      await eventually((): boolean => {
        return heardIds(onB, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);

    const traffic: string = hub.published
      .map((published: { message: string }): string => {
        return published.message;
      })
      .join("\n");

    // The listeners were asked about, and answered...
    expect(traffic).toContain(LISTENERS_REQUEST_EVENT);
    // ...with nothing of the page's handshake.
    expect(traffic).not.toContain(secret);
    expect(traffic).not.toContain("handshake");
  });

  test("a server alone in the cluster asks no one", async () => {
    const serverA: ClusterServer = await start("A");
    readable(READER, RECORD_A);

    const onA: Page = await page(serverA, READER);

    await write(serverA, [RECORD_A]);

    expect(
      await eventually((): boolean => {
        return heardIds(onA, CREATE_ROOM).length === 1;
      }),
    ).toBe(true);
    expect(
      hub.published.some((published: { message: string }): boolean => {
        return published.message.includes(LISTENERS_REQUEST_EVENT);
      }),
    ).toBe(false);
  });
});

describe("what each server does for its own sockets alone", () => {
  test("a project's usage changing - told to every server - is heard once per page", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");
    const usageRoom: string = RealtimeUtil.getProjectUsageRoomId(TENANT_ID);

    const onA: Page = await page(serverA, READER, [usageRoom]);
    const onB: Page = await page(serverB, READER, [usageRoom]);

    // The channel (RealtimeAccessChanges) reaches each server; each tells its own.
    await serverA.realtime.deliverProjectUsageChanged(TENANT_ID);
    await serverB.realtime.deliverProjectUsageChanged(TENANT_ID);

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

  test("a project's access rechecked on A asks A's sockets, not B's", async () => {
    const serverA: ClusterServer = await start("A");
    const serverB: ClusterServer = await start("B");

    // Neither handshake carries an access token: a recheck ends its session.
    const onA: Page = await page(serverA, READER);
    const onB: Page = await page(serverB, READER);

    await serverA.realtime.recheckProjectAccess(TENANT_ID);

    expect(
      await eventually((): boolean => {
        return heardIds(onA, EventName.AuthenticationRequired).length === 1;
      }),
    ).toBe(true);
    await settle(QUIET_MS / 5);
    expect(heardIds(onB, EventName.AuthenticationRequired)).toEqual([]);
  });
});
