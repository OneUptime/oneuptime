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
import type RedisType from "../../../../Server/Infrastructure/Redis";
import type WorkspaceCreatedMessageFirstType from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import type { KeptPost } from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import type WorkspaceCreatedMessageLineType from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageLine";
import { WorkspaceRecord } from "../../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import ObjectID from "../../../../Types/ObjectID";
import getTestRedisConnectionOptions from "../../TestingUtils/Redis/TestRedisOptions";

/*
 * A NEW RECORD'S OTHER MESSAGES WAIT FOR ITS CREATED MESSAGE ON EVERY APP
 * SERVER, THROUGH THE VALKEY THEY SHARE (#11198).
 *
 * While an incident (an alert, an episode, a maintenance event, a monitor)
 * is being created, every other message about it is held and posted right
 * after its Created message (WorkspaceCreatedMessageFirst, #11146). The
 * hold lived in the memory of the server whose create chain ran, so a
 * message made on another server - the Incident Commander role the
 * Dashboard gives the declarer as the page opens - went out at once, and
 * could reach a channel before "Incident Created".
 *
 * Two App servers here, each its own copy of the modules and its own
 * Valkey connection, as two processes have, against a real Valkey: the one
 * the Common suites run against (TestRedisOptions; CI's test-setup.sh starts
 * it on localhost:6310), or another named by VALKEY_HOST and VALKEY_PORT.
 * Two real processes are in WorkspaceCreatedMessageFirstReplicas.test.ts.
 * Every record is new to each test, and its line is deleted after it.
 */

jest.mock("../../../../Server/Utils/Logger");

jest.setTimeout(60_000);

interface Server {
  name: string;
  redis: typeof RedisType;
  first: typeof WorkspaceCreatedMessageFirstType;
  /*
   * The line every server shares, when the code has it: this suite runs on
   * the code from before it too, to show what it fixed.
   */
  line: typeof WorkspaceCreatedMessageLineType | null;
  client: RedisClient;
}

// What the code before the shared line had of the hold: no shutdown of its own.
interface HoldOnShutdown {
  postEverythingHeldHere?: (() => Promise<void>) | undefined;
}

// What waits on a server goes now, as it does when the server shuts down.
async function shutDown(server: Server): Promise<void> {
  await (server.first as unknown as HoldOnShutdown).postEverythingHeldHere?.();
}

const LINE_KEY_PREFIX: string = "workspace-created-message-first:";

let serverA: Server;
let serverB: Server;
let inspector: RedisClient;

// The records a test used, by their line's key in Valkey.
let lineKeys: Array<string> = [];

// The times a test set, with what each was, to set back after it.
let tunedTimes: Array<{
  statics: Record<string, unknown>;
  name: string;
  was: unknown;
}> = [];

// Sets one of a server's times for the test (a static of the class).
function tune(target: unknown, name: string, value: number): void {
  const statics: Record<string, unknown> = target as Record<string, unknown>;

  tunedTimes.push({ statics: statics, name: name, was: statics[name] });
  statics[name] = value;
}

function untune(): void {
  for (const tuned of tunedTimes.reverse()) {
    tuned.statics[tuned.name] = tuned.was;
  }

  tunedTimes = [];
}

function connection(): RedisClient {
  return new RedisClient({
    ...getTestRedisConnectionOptions(),
    ...(process.env["VALKEY_HOST"] ? { host: process.env["VALKEY_HOST"] } : {}),
    ...(process.env["VALKEY_PORT"]
      ? { port: Number(process.env["VALKEY_PORT"]) }
      : {}),
  });
}

async function startServer(name: string): Promise<Server> {
  const loaded: Partial<Server> = {};

  jest.isolateModules((): void => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    loaded.redis = require("../../../../Server/Infrastructure/Redis").default;
    loaded.first =
      require("../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst").default;
    try {
      loaded.line =
        require("../../../../Server/Utils/Workspace/WorkspaceCreatedMessageLine").default;
    } catch {
      loaded.line = null;
    }
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  const client: RedisClient = connection();
  await client.connect();

  return { ...(loaded as Server), name: name, client: client };
}

// Each server reads its own Valkey connection, with times short enough to test.
function connect(
  server: Server,
  times: {
    heldForAtMostMs?: number;
    releasedForAtMostMs?: number;
    stalledAfterMs?: number;
  } = {},
): void {
  jest
    .spyOn(server.redis, "getClient")
    .mockReturnValue(
      server.client as ReturnType<typeof server.redis.getClient>,
    );
  jest.spyOn(server.redis, "isConnected").mockReturnValue(true);

  tune(server.first, "HELD_FOR_AT_MOST_MS", times.heldForAtMostMs ?? 60_000);
  tune(server.first, "SHUTDOWN_WAITS_AT_MOST_MS", 50);

  if (server.line) {
    tune(
      server.line,
      "RELEASED_FOR_AT_MOST_MS",
      times.releasedForAtMostMs ?? 60_000,
    );
    tune(server.line, "ASKED_EVERY_MS", 10);
    tune(server.line, "STALLED_AFTER_MS", times.stalledAfterMs ?? 30_000);
    tune(server.line, "KEPT_EVERY_MS", 50);
  }
}

// A server that can no longer reach Valkey, as one that stopped.
function disconnect(server: Server): void {
  jest.spyOn(server.redis, "getClient").mockReturnValue(null);
  jest.spyOn(server.redis, "isConnected").mockReturnValue(false);
}

function newIncident(): WorkspaceRecord {
  const id: ObjectID = ObjectID.generate();
  lineKeys.push(`${LINE_KEY_PREFIX}incidentId:${id.toString().toLowerCase()}`);
  return { incidentId: id };
}

function lineKeyOf(record: WorkspaceRecord): string {
  return `${LINE_KEY_PREFIX}incidentId:${record.incidentId!.toString().toLowerCase()}`;
}

/*
 * The channel the messages reach, as Slack would receive them: each
 * message once it is posted, in the order posts arrive.
 */
class Channel {
  public readonly posts: Array<string> = [];
  private waiters: Array<() => void> = [];

  public message(name: string): KeptPost {
    return async (): Promise<void> => {
      this.posts.push(name);
      this.tell();
    };
  }

  // A message that is still being posted until `finish` is called.
  public slowMessage(name: string): {
    post: KeptPost;
    started: Promise<void>;
    finish: () => void;
  } {
    let finish: () => void = (): void => {};
    let markStarted: () => void = (): void => {};
    const started: Promise<void> = new Promise<void>((resolve: () => void) => {
      markStarted = resolve;
    });
    const finished: Promise<void> = new Promise<void>((resolve: () => void) => {
      finish = resolve;
    });

    return {
      post: async (): Promise<void> => {
        markStarted();
        await finished;
        this.posts.push(name);
        this.tell();
      },
      started: started,
      finish: (): void => {
        finish();
      },
    };
  }

  // Settles once `count` messages are in, or fails after `withinMs`.
  public async waitFor(
    count: number,
    withinMs: number = 10_000,
  ): Promise<void> {
    if (this.posts.length >= count) {
      return;
    }

    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          reject(
            new Error(
              `Expected ${count} posts within ${withinMs} ms, got ${JSON.stringify(this.posts)}`,
            ),
          );
        }, withinMs);

        const check: () => void = (): void => {
          if (this.posts.length >= count) {
            clearTimeout(timer);
            resolve();
            return;
          }

          this.waiters.push(check);
        };

        check();
      },
    );
  }

  private tell(): void {
    const waiters: Array<() => void> = this.waiters;
    this.waiters = [];

    for (const waiter of waiters) {
      waiter();
    }
  }
}

function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

beforeAll(async () => {
  inspector = connection();
  await inspector.connect();

  serverA = await startServer("A");
  serverB = await startServer("B");
});

afterAll(async () => {
  for (const server of [serverA, serverB]) {
    server.client.disconnect();
  }

  inspector.disconnect();
});

beforeEach(() => {
  lineKeys = [];
});

afterEach(async () => {
  // Whatever a test left waiting goes, so nothing reaches the next one.
  for (const server of [serverA, serverB]) {
    connect(server);
    await shutDown(server);
  }

  jest.restoreAllMocks();
  untune();

  if (lineKeys.length > 0) {
    // Each line, its messages' claims (#11235), and its place in the index of lines to look after.
    const claims: Array<string> = [];

    for (const lineKey of lineKeys) {
      claims.push(...(await inspector.keys(`${lineKey}:claim:*`)));
    }

    await inspector.del(...lineKeys, ...claims);
    await inspector.zrem(`${LINE_KEY_PREFIX}lines-to-look-after`, ...lineKeys);
  }
});

describe("a record held on one server", () => {
  beforeEach(() => {
    connect(serverA);
    connect(serverB);
  });

  test("REGRESSION (#11198): a message made on another server waits for the Created message, and follows it", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);

    // The Incident Commander role, given on the other server as the page opens.
    expect(
      await serverB.first.keep({
        record: incident,
        post: channel.message("B: Added Valeria as Incident Commander"),
      }),
    ).toBe(true);

    await pause(150);
    expect(channel.posts).toEqual([]);

    // The holder's chain: "Incident Created" goes out, then what waited.
    await channel.message("A: Incident INC-42 Created")();
    await serverA.first.postHeld(incident);
    await channel.waitFor(2);

    expect(channel.posts).toEqual([
      "A: Incident INC-42 Created",
      "B: Added Valeria as Incident Commander",
    ]);
  });

  test("messages made on both servers go out after it in the order they were made, each once", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);

    await serverA.first.keep({
      record: incident,
      post: channel.message("A: declared from 1 alert"),
    });
    await serverB.first.keep({
      record: incident,
      post: channel.message("B: Added Valeria as Incident Commander"),
    });
    await serverA.first.keep({
      record: incident,
      post: channel.message("A: Added team Platform as the owner"),
    });
    await serverB.first.keep({
      record: incident,
      post: channel.message("B: Valeria posted a note"),
    });

    await channel.message("A: Incident INC-42 Created")();
    await serverA.first.postHeld(incident);
    await channel.waitFor(5);
    await pause(100);

    expect(channel.posts).toEqual([
      "A: Incident INC-42 Created",
      "A: declared from 1 alert",
      "B: Added Valeria as Incident Commander",
      "A: Added team Platform as the owner",
      "B: Valeria posted a note",
    ]);
  });

  test.each([
    [
      "the server holding it",
      (): Server => {
        return serverA;
      },
    ],
    [
      "another server",
      (): Server => {
        return serverB;
      },
    ],
  ])(
    "messages made one right after the other on %s take their places in the order they were made",
    async (_where: string, server: () => Server) => {
      const incident: WorkspaceRecord = newIncident();
      const channel: Channel = new Channel();

      await serverA.first.hold(incident);

      // Not awaited one by one: each asks for its place before the next is made.
      await Promise.all(
        ["first", "second", "third", "fourth"].map(
          (name: string): Promise<boolean> => {
            return server().first.keep({
              record: incident,
              post: channel.message(name),
            });
          },
        ),
      );

      await serverA.first.postHeld(incident);
      await channel.waitFor(4);

      expect(channel.posts).toEqual(["first", "second", "third", "fourth"]);
    },
  );

  test("one after the other across servers: a message is posted only once the one before it is", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: { post: KeptPost; started: Promise<void>; finish: () => void } =
      channel.slowMessage("A: Added team Platform as the owner");

    await serverA.first.hold(incident);
    await serverA.first.keep({ record: incident, post: slow.post });
    await serverB.first.keep({
      record: incident,
      post: channel.message("B: Added Valeria as Incident Commander"),
    });

    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.started;
    await pause(200);

    // The first is still being posted: the other server's waits for it.
    expect(channel.posts).toEqual([]);

    slow.finish();
    await letGo;
    await channel.waitFor(2);

    expect(channel.posts).toEqual([
      "A: Added team Platform as the owner",
      "B: Added Valeria as Incident Commander",
    ]);
  });

  test("a message made on another server while the held ones are posted joins the end of the line", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await serverA.first.keep({
      record: incident,
      post: async (): Promise<void> => {
        channel.posts.push("A: Added team Platform as the owner");

        // Something else about the incident is said meanwhile, elsewhere.
        expect(
          await serverB.first.keep({
            record: incident,
            post: channel.message("B: made meanwhile"),
          }),
        ).toBe(true);
      },
    });
    await serverA.first.keep({
      record: incident,
      post: channel.message("A: Added Jane as an owner"),
    });

    await serverA.first.postHeld(incident);
    await channel.waitFor(3);

    expect(channel.posts).toEqual([
      "A: Added team Platform as the owner",
      "A: Added Jane as an owner",
      "B: made meanwhile",
    ]);
  });

  test("the holder goes on once its own messages are out, and what it says next still follows the other server's", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: { post: KeptPost; started: Promise<void>; finish: () => void } =
      channel.slowMessage("B: Added Valeria as Incident Commander");

    await serverA.first.hold(incident);
    await serverB.first.keep({ record: incident, post: slow.post });

    // Nothing of its own waits: the holder's chain goes on to its pages.
    await serverA.first.postHeld(incident);
    expect(serverA.first.isHeld(incident)).toBe(false);
    await slow.started;

    expect(
      await serverA.first.keep({
        record: incident,
        post: channel.message("A: paged the on-call"),
      }),
    ).toBe(true);

    slow.finish();
    await channel.waitFor(2);

    expect(channel.posts).toEqual([
      "B: Added Valeria as Incident Commander",
      "A: paged the on-call",
    ]);
  });

  test("once the line is empty it is gone from Valkey, and a message goes out at once again", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    expect(await inspector.exists(lineKeyOf(incident))).toBe(1);

    await serverB.first.keep({
      record: incident,
      post: channel.message("B: kept"),
    });
    await serverA.first.postHeld(incident);
    await channel.waitFor(1);
    await pause(50);

    expect(await inspector.exists(lineKeyOf(incident))).toBe(0);
    expect(
      await serverB.first.keep({
        record: incident,
        post: channel.message("B: later"),
      }),
    ).toBe(false);
  });

  test("a record held with nothing said about it meanwhile leaves no line behind", async () => {
    const incident: WorkspaceRecord = newIncident();

    await serverA.first.hold(incident);
    await serverA.first.postHeld(incident);

    expect(await inspector.exists(lineKeyOf(incident))).toBe(0);
  });

  test("its line lives at most as long as a hold and the time to post what waited", async () => {
    const incident: WorkspaceRecord = newIncident();

    await serverA.first.hold(incident);

    const left: number = await inspector.pttl(lineKeyOf(incident));

    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(
      serverA.first.HELD_FOR_AT_MOST_MS +
        (serverA.line?.RELEASED_FOR_AT_MOST_MS || 0),
    );

    await serverA.first.postHeld(incident);
  });

  test("records are told apart: another record of the other server goes out at once", async () => {
    const incident: WorkspaceRecord = newIncident();
    const other: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);

    expect(
      await serverB.first.keep({
        record: other,
        post: channel.message("about another incident"),
      }),
    ).toBe(false);
    expect(
      await serverB.first.keep({
        record: { alertId: incident.incidentId! },
        post: channel.message("about an alert with the same id"),
      }),
    ).toBe(false);

    await serverA.first.postHeld(incident);
  });
});

describe("nothing waits for good", () => {
  test("the holder's chain stops short of its Created message: what it lets go as it stops goes, on every server", async () => {
    connect(serverA);
    connect(serverB);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await serverB.first.keep({
      record: incident,
      post: channel.message("B: Added Valeria as Incident Commander"),
    });

    // The chain's .catch: no "Incident Created", and the held messages go.
    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    expect(channel.posts).toEqual(["B: Added Valeria as Incident Commander"]);
  });

  test("the holder stops without a word: once a hold has lasted its longest, every other server's messages go, in order", async () => {
    connect(serverA, { heldForAtMostMs: 800, releasedForAtMostMs: 3000 });
    connect(serverB, { heldForAtMostMs: 800, releasedForAtMostMs: 3000 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);

    // The server holding it can no longer say anything.
    disconnect(serverA);

    await serverB.first.keep({
      record: incident,
      post: channel.message("B: first"),
    });
    await serverB.first.keep({
      record: incident,
      post: channel.message("B: second"),
    });

    await pause(300);
    expect(channel.posts).toEqual([]);

    await channel.waitFor(2, 5000);

    expect(channel.posts).toEqual(["B: first", "B: second"]);
  });

  test("a hold nobody lets go is let go by its server after HELD_FOR_AT_MOST_MS, and every server's messages follow", async () => {
    connect(serverA, { heldForAtMostMs: 500 });
    connect(serverB, { heldForAtMostMs: 500 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await serverA.first.keep({
      record: incident,
      post: channel.message("A: kept"),
    });
    await serverB.first.keep({
      record: incident,
      post: channel.message("B: kept"),
    });

    await pause(200);
    expect(channel.posts).toEqual([]);

    await channel.waitFor(2, 5000);

    expect(channel.posts).toEqual(["A: kept", "B: kept"]);
    expect(serverA.first.isHeld(incident)).toBe(false);
  });

  test("a server that stops while it is a message's turn is passed over after STALLED_AFTER_MS", async () => {
    connect(serverA, { stalledAfterMs: 400 });
    connect(serverB, { stalledAfterMs: 400 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);

    // A server took the first place in the line, then stopped.
    expect(await inspector.hincrby(lineKeyOf(incident), "tickets", 1)).toBe(1);

    await serverB.first.keep({
      record: incident,
      post: channel.message("B: after the server that stopped"),
    });

    await serverA.first.postHeld(incident);

    await pause(200);
    expect(channel.posts).toEqual([]);

    await channel.waitFor(1, 5000);

    expect(channel.posts).toEqual(["B: after the server that stopped"]);
  });

  test("a message that takes longer than STALLED_AFTER_MS to post keeps its turn: its server says it still is", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: { post: KeptPost; started: Promise<void>; finish: () => void } =
      channel.slowMessage("A: a slow Slack");

    await serverA.first.hold(incident);
    await serverA.first.keep({ record: incident, post: slow.post });
    await serverB.first.keep({
      record: incident,
      post: channel.message("B: next"),
    });

    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.started;

    // Three times as long as a stalled turn: still its turn.
    await pause(900);
    expect(channel.posts).toEqual([]);

    slow.finish();
    await letGo;
    await channel.waitFor(2);

    expect(channel.posts).toEqual(["A: a slow Slack", "B: next"]);
  });

  test("a server shutting down posts what still waits on it rather than losing it, and the line goes on without a pause", async () => {
    connect(serverA, { stalledAfterMs: 20_000 });
    connect(serverB, { stalledAfterMs: 20_000 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await serverB.first.keep({
      record: incident,
      post: channel.message("B: Added Valeria as Incident Commander"),
    });
    await serverA.first.keep({
      record: incident,
      post: channel.message("A: Added team Platform as the owner"),
    });

    // The other server is shut down - a deploy - before the Created message.
    await shutDown(serverB);

    expect(channel.posts).toEqual(["B: Added Valeria as Incident Commander"]);

    // The line passes its place by: the holder's goes as soon as it lets go.
    await channel.message("A: Incident INC-42 Created")();
    await serverA.first.postHeld(incident);
    await channel.waitFor(3, 2000);

    expect(channel.posts).toEqual([
      "B: Added Valeria as Incident Commander",
      "A: Incident INC-42 Created",
      "A: Added team Platform as the owner",
    ]);
  });

  test("the server holding it shuts down: its hold is let go and everything waiting goes", async () => {
    connect(serverA);
    connect(serverB);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await serverA.first.keep({
      record: incident,
      post: channel.message("A: Added team Platform as the owner"),
    });
    await serverB.first.keep({
      record: incident,
      post: channel.message("B: Added Valeria as Incident Commander"),
    });

    await shutDown(serverA);
    await channel.waitFor(2, 3000);

    expect(channel.posts).toEqual([
      "A: Added team Platform as the owner",
      "B: Added Valeria as Incident Commander",
    ]);
    expect(serverA.first.isHeld(incident)).toBe(false);
  });

  test("a message that fails to post is logged and the line moves on", async () => {
    connect(serverA);
    connect(serverB);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await serverB.first.keep({
      record: incident,
      post: async (): Promise<void> => {
        throw new Error("Slack is down");
      },
    });
    await serverA.first.keep({
      record: incident,
      post: channel.message("A: after the one that failed"),
    });

    await serverA.first.postHeld(incident);
    await channel.waitFor(1, 3000);

    expect(channel.posts).toEqual(["A: after the one that failed"]);
  });
});

describe("when Valkey cannot be asked", () => {
  test("a server with no Valkey holds its own messages alone, and another server's go at once", async () => {
    disconnect(serverA);
    connect(serverB);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    expect(await inspector.exists(lineKeyOf(incident))).toBe(0);

    expect(
      await serverA.first.keep({
        record: incident,
        post: channel.message("A: kept here"),
      }),
    ).toBe(true);
    expect(
      await serverB.first.keep({
        record: incident,
        post: channel.message("B: not held"),
      }),
    ).toBe(false);

    await serverA.first.postHeld(incident);

    expect(channel.posts).toEqual(["A: kept here"]);
  });

  test("Valkey loses the line before the Created message: the holder keeps its own messages behind it", async () => {
    connect(serverA);
    connect(serverB);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await serverA.first.keep({
      record: incident,
      post: channel.message("A: taken before"),
    });

    // A restart, an eviction.
    await inspector.del(lineKeyOf(incident));

    expect(
      await serverA.first.keep({
        record: incident,
        post: channel.message("A: kept here"),
      }),
    ).toBe(true);

    await pause(100);
    expect(channel.posts).toEqual([]);

    await channel.message("A: Incident INC-42 Created")();
    await serverA.first.postHeld(incident);
    await channel.waitFor(3, 3000);

    expect(channel.posts).toEqual([
      "A: Incident INC-42 Created",
      "A: taken before",
      "A: kept here",
    ]);
  });

  test("the holder loses Valkey after holding: what it makes meanwhile is kept behind the Created message", async () => {
    connect(serverA);
    connect(serverB);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);

    disconnect(serverA);

    expect(
      await serverA.first.keep({
        record: incident,
        post: channel.message("A: kept here"),
      }),
    ).toBe(true);

    await channel.message("A: Incident INC-42 Created")();
    await serverA.first.postHeld(incident);

    expect(channel.posts).toEqual([
      "A: Incident INC-42 Created",
      "A: kept here",
    ]);
  });
});
