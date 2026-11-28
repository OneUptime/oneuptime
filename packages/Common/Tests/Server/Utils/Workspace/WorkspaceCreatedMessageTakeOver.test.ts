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
import type LoggerType from "../../../../Server/Utils/Logger";
import type WorkspaceCreatedMessageFirstType from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import type WorkspaceCreatedMessageLineType from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageLine";
import type { StoredLinePost } from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageLine";
import { WorkspaceRecord } from "../../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import getTestRedisConnectionOptions from "../../TestingUtils/Redis/TestRedisOptions";
import type { Mock } from "jest-mock";

/*
 * A SERVER KILLED OUTRIGHT LOSES NONE OF THE MESSAGES IT HELD (#11235).
 *
 * While a record is being created, every other message about it waits in
 * a line in Valkey for its Created message, on whichever App server it is
 * made (WorkspaceCreatedMessageFirst, WorkspaceCreatedMessageLine, #11198),
 * and each server posts its own in their turn. The messages themselves
 * were in the memory of the server that made them: one killed outright - an
 * OOM kill, a lost node, SIGKILL - lost them all, and the line passed its
 * turns over after STALLED_AFTER_MS.
 *
 * Now each waits with what it says, and another server posts it, in its
 * turn and once: the one that claims a message first is the one that posts
 * it. Here, the line's side of that against a real Valkey: the one the
 * Common suites run against (TestRedisOptions; CI's test-setup.sh starts it
 * on localhost:6310), or another named by VALKEY_HOST and VALKEY_PORT. Each
 * server is its own copy of the modules with its own Valkey connection, as
 * a process has, and a server can be frozen: every command it sends waits,
 * unanswered, until it is thawed - a server that stops answering, alive,
 * and then goes on. Frozen for good, it is a server that was killed. Two
 * real processes, killed and frozen for real, are in
 * WorkspaceCreatedMessageFirstReplicas.test.ts.
 *
 * Every key this run makes has a prefix of its own, deleted after each test.
 */

jest.mock("../../../../Server/Utils/Logger");

jest.setTimeout(60_000);

const KEY_PREFIX: string = `workspace-created-message-first:take-over-test-${ObjectID.generate().toString()}:`;

/*
 * A server's connection to Valkey, which can be frozen: every command it
 * sends waits, unanswered, until it is thawed.
 */
class FreezableValkey {
  public readonly client: RedisClient;

  // Every script the server sent, with its keys and arguments.
  public sent: Array<Array<unknown>> = [];

  /*
   * The next answer to a script this matches is lost on its way back: the
   * script ran in Valkey, and the server is told it could not ask.
   */
  public losingAnswerTo: ((script: string) => boolean) | null = null;

  private isFrozen: boolean = false;
  private thawWaiters: Array<() => void> = [];
  private readonly frozenClient: RedisClient;

  public constructor(client: RedisClient) {
    this.client = client;

    const evaluate: (...args: Array<unknown>) => Promise<unknown> = async (
      ...args: Array<unknown>
    ): Promise<unknown> => {
      this.sent.push(args);

      while (this.isFrozen) {
        await new Promise<void>((resolve: () => void) => {
          this.thawWaiters.push(resolve);
        });
      }

      const answer: unknown = await (
        client.eval as unknown as (
          ...evalArgs: Array<unknown>
        ) => Promise<unknown>
      ).apply(client, args);

      if (this.losingAnswerTo?.(String(args[0]))) {
        this.losingAnswerTo = null;
        throw new Error(
          "the connection dropped before Valkey's answer came back",
        );
      }

      return answer;
    };

    this.frozenClient = { eval: evaluate } as unknown as RedisClient;
  }

  public asClient(): RedisClient {
    return this.frozenClient;
  }

  public freeze(): void {
    this.isFrozen = true;
  }

  public thaw(): void {
    this.isFrozen = false;

    const waiters: Array<() => void> = this.thawWaiters;
    this.thawWaiters = [];

    for (const resolve of waiters) {
      resolve();
    }
  }
}

interface Server {
  name: string;
  redis: typeof RedisType;
  logger: typeof LoggerType;
  first: typeof WorkspaceCreatedMessageFirstType;
  line: typeof WorkspaceCreatedMessageLineType;
  valkey: FreezableValkey;
}

interface Times {
  heldForAtMostMs?: number | undefined;
  releasedForAtMostMs?: number | undefined;
  stalledAfterMs?: number | undefined;
}

// What a channel heard: each message, and the server that posted it.
interface Heard {
  name: string;
  by: string;
}

/*
 * The channel the messages reach, as Slack would receive them: each message
 * once it is posted, with the server that posted it.
 */
class Channel {
  public readonly heard: Array<Heard> = [];
  private waiters: Array<() => void> = [];

  public posts(): Array<string> {
    return this.heard.map((heard: Heard): string => {
      return heard.name;
    });
  }

  // Each post as "<server that posted it>: <message>".
  public postedBy(): Array<string> {
    return this.heard.map((heard: Heard): string => {
      return `${heard.by} posted ${heard.name}`;
    });
  }

  public hear(name: string, by: string): void {
    this.heard.push({ name: name, by: by });

    const waiters: Array<() => void> = this.waiters;
    this.waiters = [];

    for (const waiter of waiters) {
      waiter();
    }
  }

  /*
   * A message about `record` made on `server`: posted by that server in its
   * turn, and stored with what another server posts it from.
   */
  public keep(
    server: Server,
    record: WorkspaceRecord,
    name: string,
    options: { stored?: boolean; post?: () => Promise<void> } = {},
  ): Promise<boolean> {
    return server.first.keep({
      record: record,
      post:
        options.post ||
        (async (): Promise<void> => {
          this.hear(name, server.name);
        }),
      ...(options.stored === false
        ? {}
        : {
            stored: (): JSONObject => {
              return { name: name };
            },
          }),
    });
  }

  // How `server` posts a message it took over: from what was stored of it.
  public poster(server: Server): StoredLinePost {
    return async (stored: JSONObject): Promise<void> => {
      this.hear(String(stored["name"]), server.name);
    };
  }

  // Settles once `count` messages are in, or fails after `withinMs`.
  public async waitFor(
    count: number,
    withinMs: number = 10_000,
  ): Promise<void> {
    if (this.heard.length >= count) {
      return;
    }

    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          reject(
            new Error(
              `Expected ${count} posts within ${withinMs} ms, got ${JSON.stringify(this.postedBy())}`,
            ),
          );
        }, withinMs);

        const check: () => void = (): void => {
          if (this.heard.length >= count) {
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
}

/*
 * A Slack that takes its time with one post: it has started once `started`
 * settles, and finishes once `finish` is called - by the test, or after it,
 * so a test that fails half way leaves nothing waiting on it.
 */
interface SlowSlack {
  start: () => void;
  started: Promise<void>;
  finished: Promise<void>;
  finish: () => void;
}

let unfinished: Array<() => void> = [];

function slowSlack(): SlowSlack {
  let start: () => void = (): void => {};
  let finish: () => void = (): void => {};
  const started: Promise<void> = new Promise<void>((resolve: () => void) => {
    start = resolve;
  });
  const finished: Promise<void> = new Promise<void>((resolve: () => void) => {
    finish = resolve;
  });

  unfinished.push(finish);

  return {
    start: start,
    started: started,
    finished: finished,
    finish: finish,
  };
}

// A message that is still being posted until `finish` is called.
interface SlowPost {
  post: () => Promise<void>;
  started: Promise<void>;
  finish: () => void;
}

function slowPost(channel: Channel, name: string, by: string): SlowPost {
  const slack: SlowSlack = slowSlack();

  return {
    post: async (): Promise<void> => {
      slack.start();
      await slack.finished;
      channel.hear(name, by);
    },
    started: slack.started,
    finish: slack.finish,
  };
}

// A server's poster for what it takes over, posting into `channel` slowly.
function slowPoster(
  channel: Channel,
  server: Server,
): { post: StoredLinePost; slack: SlowSlack } {
  const slack: SlowSlack = slowSlack();

  return {
    post: async (stored: JSONObject): Promise<void> => {
      slack.start();
      await slack.finished;
      channel.hear(String(stored["name"]), server.name);
    },
    slack: slack,
  };
}

let serverA: Server;
let serverB: Server;
let serverC: Server;
let inspector: RedisClient;

// The times a test set, with what each was, to set back after it.
let tunedTimes: Array<{
  statics: Record<string, unknown>;
  name: string;
  was: unknown;
}> = [];

// Sets one of a server's times for the test (a static of the class).
function tune(target: unknown, name: string, value: unknown): void {
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
    loaded.logger = require("../../../../Server/Utils/Logger").default;
    loaded.first =
      require("../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst").default;
    loaded.line =
      require("../../../../Server/Utils/Workspace/WorkspaceCreatedMessageLine").default;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  const client: RedisClient = connection();
  await client.connect();

  return {
    ...(loaded as Server),
    name: name,
    valkey: new FreezableValkey(client),
  };
}

// Each server reads its own Valkey connection, with times short enough to test.
function connect(server: Server, times: Times = {}): void {
  jest
    .spyOn(server.redis, "getClient")
    .mockReturnValue(
      server.valkey.asClient() as ReturnType<typeof server.redis.getClient>,
    );
  jest.spyOn(server.redis, "isConnected").mockReturnValue(true);

  tune(server.first, "HELD_FOR_AT_MOST_MS", times.heldForAtMostMs ?? 60_000);
  tune(server.first, "SHUTDOWN_WAITS_AT_MOST_MS", 50);
  tune(
    server.line,
    "RELEASED_FOR_AT_MOST_MS",
    times.releasedForAtMostMs ?? 60_000,
  );
  tune(server.line, "ASKED_EVERY_MS", 10);
  tune(server.line, "STALLED_AFTER_MS", times.stalledAfterMs ?? 400);
  tune(server.line, "KEPT_EVERY_MS", 50);
  tune(server.line, "LOOKED_AFTER_EVERY_MS", 50);
  tune(server.line, "KEY_PREFIX", KEY_PREFIX);
}

// A server that can no longer reach Valkey at all.
function disconnect(server: Server): void {
  jest.spyOn(server.redis, "getClient").mockReturnValue(null);
  jest.spyOn(server.redis, "isConnected").mockReturnValue(false);
}

/*
 * The server posts the messages of servers that stopped, as App/Index.ts
 * starts it to: into the channel, or with a poster of the test's own.
 */
function takesOver(server: Server, poster: Channel | StoredLinePost): void {
  server.first.takeOverForStoppedServers(
    poster instanceof Channel ? poster.poster(server) : poster,
  );
}

// What waits on a server goes now, as it does when the server shuts down.
async function shutDown(server: Server): Promise<void> {
  await server.first.postEverythingHeldHere();
}

function newIncident(): WorkspaceRecord {
  return { incidentId: ObjectID.generate() };
}

function recordKeyOf(record: WorkspaceRecord): string {
  return `incidentId:${record.incidentId!.toString().toLowerCase()}`;
}

function lineKeyOf(record: WorkspaceRecord): string {
  return `${KEY_PREFIX}${recordKeyOf(record)}`;
}

function indexKey(): string {
  return `${KEY_PREFIX}lines-to-look-after`;
}

// The record's line, as its hash holds it: {} once it is gone.
async function theLine(
  record: WorkspaceRecord,
): Promise<Record<string, string>> {
  return await inspector.hgetall(lineKeyOf(record));
}

// The record's messages' claims: which server posts each, by message id.
async function theClaims(
  record: WorkspaceRecord,
): Promise<Record<string, string>> {
  const keys: Array<string> = await inspector.keys(
    `${lineKeyOf(record)}:claim:*`,
  );
  const claims: Record<string, string> = {};

  for (const key of keys) {
    claims[key.split(":claim:")[1]!] = (await inspector.get(key)) || "";
  }

  return claims;
}

// Valkey's own time, as the index reads it.
async function valkeyNow(): Promise<number> {
  // Seconds and microseconds, as Valkey answers TIME.
  const time: Array<number | string> = (await inspector.time()) as Array<
    number | string
  >;

  return Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000);
}

function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

// Settles once `isSo` is, asked every 20 ms, or fails after `withinMs`.
async function waitUntil(
  what: string,
  isSo: () => Promise<boolean> | boolean,
  withinMs: number = 10_000,
): Promise<void> {
  const until: number = Date.now() + withinMs;

  while (!(await isSo())) {
    if (Date.now() > until) {
      throw new Error(`Not so within ${withinMs} ms: ${what}`);
    }

    await pause(20);
  }
}

function errorsLoggedBy(server: Server): Array<string> {
  return (server.logger.error as unknown as Mock).mock.calls.map(
    (call: Array<unknown>): string => {
      return String(call[0]);
    },
  );
}

beforeAll(async () => {
  inspector = connection();
  await inspector.connect();

  serverA = await startServer("A");
  serverB = await startServer("B");
  serverC = await startServer("C");
});

afterAll(async () => {
  for (const server of [serverA, serverB, serverC]) {
    server.valkey.client.disconnect();
  }

  inspector.disconnect();
});

beforeEach(() => {
  // What each server logs is read by the tests that ask: this test's only.
  jest.clearAllMocks();
});

afterEach(async () => {
  // A server frozen for good goes on now, and whatever a test left waiting goes too.
  for (const finish of unfinished) {
    finish();
  }

  unfinished = [];

  for (const server of [serverA, serverB, serverC]) {
    server.valkey.thaw();
  }

  for (const server of [serverA, serverB, serverC]) {
    connect(server);
    await shutDown(server);
  }

  jest.restoreAllMocks();
  untune();

  const keys: Array<string> = await inspector.keys(`${KEY_PREFIX}*`);

  if (keys.length > 0) {
    await inspector.del(...keys);
  }
});

describe("each message waits in the line with what it says", () => {
  beforeEach(() => {
    connect(serverA);
    connect(serverB);
  });

  test("a kept message waits with what it says, its own id and the server that made it", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    expect(
      await channel.keep(
        serverB,
        incident,
        "B: Added Valeria as Incident Commander",
      ),
    ).toBe(true);

    const line: Record<string, string> = await theLine(incident);

    expect(JSON.parse(line["message:1"]!)).toEqual({
      name: "B: Added Valeria as Incident Commander",
    });
    expect(line["id:1"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(line["by:1"]).toBe(serverB.line.SERVER_ID);
    expect(serverA.line.SERVER_ID).not.toBe(serverB.line.SERVER_ID);

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);
  });

  test("every message has an id of its own, and each server's are its own", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);

    for (const [server, name] of [
      [serverA, "A: first"],
      [serverB, "B: second"],
      [serverA, "A: third"],
      [serverB, "B: fourth"],
    ] as Array<[Server, string]>) {
      await channel.keep(server, incident, name);
    }

    const line: Record<string, string> = await theLine(incident);
    const ids: Array<string> = [1, 2, 3, 4].map((ticket: number): string => {
      return line[`id:${ticket}`]!;
    });

    expect(new Set(ids).size).toBe(4);
    expect(
      [1, 2, 3, 4].map((ticket: number) => {
        return line[`by:${ticket}`];
      }),
    ).toEqual([
      serverA.line.SERVER_ID,
      serverB.line.SERVER_ID,
      serverA.line.SERVER_ID,
      serverB.line.SERVER_ID,
    ]);

    await serverA.first.postHeld(incident);
    await channel.waitFor(4);

    expect(channel.posts()).toEqual([
      "A: first",
      "B: second",
      "A: third",
      "B: fourth",
    ]);
  });

  test("a message about a record nobody is creating sends Valkey its one ask, as before: what it says is not even written", async () => {
    const posted: Array<string> = [];
    const stored: Mock<() => JSONObject> = jest.fn<() => JSONObject>(() => {
      return { name: "B: Changed Incident State to Acknowledged" };
    });

    serverB.valkey.sent = [];

    expect(
      await serverB.first.keep({
        record: newIncident(),
        post: async (): Promise<void> => {
          posted.push("posted by its caller");
        },
        stored: stored,
      }),
    ).toBe(false);

    expect(stored).not.toHaveBeenCalled();
    expect(serverB.valkey.sent).toHaveLength(1);
    expect(JSON.stringify(serverB.valkey.sent)).not.toContain(
      "Changed Incident State",
    );
  });

  test("what a message says is stored once it has its ticket, and only with that ticket", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: SlowPost = slowPost(channel, "A: second", "A");

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: first");
    await channel.keep(serverA, incident, "A: second", { post: slow.post });

    const line: Record<string, string> = await theLine(incident);

    // Not another message's ticket, and not a ticket that is not taken.
    expect(
      await serverB.line.store(recordKeyOf(incident), {
        ticket: 1,
        messageId: "00000000-0000-4000-8000-000000000009",
        stored: JSON.stringify({ name: "another message" }),
      }),
    ).toBe(false);
    expect(
      await serverB.line.store(recordKeyOf(incident), {
        ticket: 3,
        messageId: line["id:1"]!,
        stored: JSON.stringify({ name: "a ticket nobody took" }),
      }),
    ).toBe(false);
    expect(JSON.parse((await theLine(incident))["message:1"]!)).toEqual({
      name: "B: first",
    });

    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.started;

    // Nor once its ticket is served, while the line goes on.
    expect((await theLine(incident))["served"]).toBe("1");
    expect(
      await serverB.line.store(recordKeyOf(incident), {
        ticket: 1,
        messageId: line["id:1"]!,
        stored: JSON.stringify({ name: "too late" }),
      }),
    ).toBe(false);
    expect((await theLine(incident))["message:1"]).toBeUndefined();

    slow.finish();
    await letGo;
    await channel.waitFor(2);

    // Nor once its line is gone.
    expect(await inspector.exists(lineKeyOf(incident))).toBe(0);
    expect(
      await serverA.line.store(recordKeyOf(incident), {
        ticket: 2,
        messageId: line["id:2"]!,
        stored: JSON.stringify({ name: "too late" }),
      }),
    ).toBe(false);
    expect(await inspector.exists(lineKeyOf(incident))).toBe(0);
  });

  test("a message with nothing to store waits without it, and its server still posts it", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: not stored", { stored: false });

    const line: Record<string, string> = await theLine(incident);

    expect(line["message:1"]).toBeUndefined();
    expect(line["id:1"]).toBeDefined();
    expect(line["by:1"]).toBe(serverB.line.SERVER_ID);

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    expect(channel.postedBy()).toEqual(["B posted B: not stored"]);
  });

  test("a message larger than MAX_STORED_MESSAGE_BYTES waits without it, on its own server", async () => {
    tune(serverB.first, "MAX_STORED_MESSAGE_BYTES", 64);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const long: string = `B: ${"a note with a screenshot in it ".repeat(4)}`;

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: short");
    await channel.keep(serverB, incident, long);

    const line: Record<string, string> = await theLine(incident);

    expect(JSON.parse(line["message:1"]!)).toEqual({ name: "B: short" });
    expect(line["message:2"]).toBeUndefined();

    await serverA.first.postHeld(incident);
    await channel.waitFor(2);

    expect(channel.posts()).toEqual(["B: short", long]);
  });

  test("a message whose stored form cannot be written is logged, waits without it, and is still posted by its server", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await serverB.first.keep({
      record: incident,
      post: async (): Promise<void> => {
        channel.hear("B: kept", "B");
      },
      stored: (): JSONObject => {
        throw new Error("a circular structure");
      },
    });

    expect((await theLine(incident))["message:1"]).toBeUndefined();
    expect(errorsLoggedBy(serverB).join("\n")).toContain(
      "could not be stored: Error: a circular structure",
    );

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    expect(channel.posts()).toEqual(["B: kept"]);
  });

  test("what a ticket waits with goes once it is served, and the line with all of it once everything is out", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: SlowPost = slowPost(channel, "A: a slow Slack", "A");

    await serverA.first.hold(incident);
    await channel.keep(serverA, incident, "A: slow", { post: slow.post });
    await channel.keep(serverB, incident, "B: next");

    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.started;

    // The first is being posted: what both wait with is still there.
    expect(Object.keys(await theLine(incident))).toEqual(
      expect.arrayContaining([
        "message:1",
        "message:2",
        "id:1",
        "id:2",
        "by:1",
        "by:2",
      ]),
    );

    slow.finish();
    await letGo;
    await channel.waitFor(2);
    await serverB.line.drained(recordKeyOf(incident));

    expect(await inspector.exists(lineKeyOf(incident))).toBe(0);
    expect(await inspector.zscore(indexKey(), lineKeyOf(incident))).toBeNull();
  });

  test("the first ticket served takes what it waited with along, while the next still waits", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: SlowPost = slowPost(channel, "B: a slow Slack", "B");

    await serverA.first.hold(incident);
    await channel.keep(serverA, incident, "A: first");
    await channel.keep(serverB, incident, "B: second", { post: slow.post });

    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.started;

    const line: Record<string, string> = await theLine(incident);

    expect(line["served"]).toBe("1");
    expect(line["message:1"]).toBeUndefined();
    expect(line["id:1"]).toBeUndefined();
    expect(line["by:1"]).toBeUndefined();
    expect(line["message:2"]).toBeDefined();
    // The second is claimed for the server posting it.
    expect(line["posting:2"]).toBe(serverB.line.SERVER_ID);

    slow.finish();
    await letGo;
    await channel.waitFor(2);
  });

  test("each message's claim names the server that posted it, and lasts as long as a line can", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await channel.keep(serverA, incident, "A: first");
    await channel.keep(serverB, incident, "B: second");

    const line: Record<string, string> = await theLine(incident);

    await serverA.first.postHeld(incident);
    await channel.waitFor(2);
    await serverB.line.drained(recordKeyOf(incident));

    expect(await theClaims(incident)).toEqual({
      [line["id:1"]!]: serverA.line.SERVER_ID,
      [line["id:2"]!]: serverB.line.SERVER_ID,
    });

    for (const id of [line["id:1"]!, line["id:2"]!]) {
      const left: number = await inspector.pttl(
        `${lineKeyOf(incident)}:claim:${id}`,
      );

      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThanOrEqual(
        serverA.line.livesAtMostMs(serverA.first.HELD_FOR_AT_MOST_MS),
      );
    }
  });
});

describe("the index of lines to look after", () => {
  beforeEach(() => {
    connect(serverA, { heldForAtMostMs: 30_000, stalledAfterMs: 5_000 });
    connect(serverB, { heldForAtMostMs: 30_000, stalledAfterMs: 5_000 });
  });

  test("REGRESSION (#11314): a held line is looked at once its holder could have stopped - pushed on each time it says it still holds it - not once its hold could run out; a released one once its turn could stall; one that is over, never", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: SlowPost = slowPost(channel, "B: slow", "B");

    const heldAt: number = await valkeyNow();
    await serverA.first.hold(incident);

    const whenHeld: number = Number(
      await inspector.zscore(indexKey(), lineKeyOf(incident)),
    );

    // STALLED_AFTER_MS (5 s here) from now, long before its hold runs out (30 s).
    expect(whenHeld).toBeGreaterThanOrEqual(heldAt + 5_000 - 1000);
    expect(whenHeld).toBeLessThanOrEqual((await valkeyNow()) + 5_000);

    // Its holder says it still holds it: the look is pushed on with it.
    await pause(200);
    const saidAt: number = await valkeyNow();
    await serverA.line.keepHeld();

    const whenSaid: number = Number(
      await inspector.zscore(indexKey(), lineKeyOf(incident)),
    );

    expect(whenSaid).toBeGreaterThanOrEqual(saidAt + 5_000 - 1000);
    expect(whenSaid).toBeGreaterThan(whenHeld);
    expect(whenSaid).toBeLessThanOrEqual((await valkeyNow()) + 5_000);

    await channel.keep(serverB, incident, "B: slow", { post: slow.post });

    const releasedAt: number = await valkeyNow();
    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.started;

    const whenReleased: number = Number(
      await inspector.zscore(indexKey(), lineKeyOf(incident)),
    );

    expect(whenReleased).toBeGreaterThanOrEqual(releasedAt + 5_000 - 1000);
    expect(whenReleased).toBeLessThanOrEqual((await valkeyNow()) + 5_000);

    slow.finish();
    await letGo;
    await channel.waitFor(1);
    await serverB.line.drained(recordKeyOf(incident));

    expect(await inspector.zscore(indexKey(), lineKeyOf(incident))).toBeNull();
  });

  test("a hold that runs out before its holder could have stopped is looked at once it runs out, as before", async () => {
    connect(serverA, { heldForAtMostMs: 2_000, stalledAfterMs: 5_000 });

    const incident: WorkspaceRecord = newIncident();

    const heldAt: number = await valkeyNow();
    await serverA.first.hold(incident);

    const whenHeld: number = Number(
      await inspector.zscore(indexKey(), lineKeyOf(incident)),
    );

    expect(whenHeld).toBeGreaterThanOrEqual(heldAt + 2_000 - 1000);
    expect(whenHeld).toBeLessThanOrEqual((await valkeyNow()) + 2_000);

    await serverA.first.postHeld(incident);
  });

  test("the index lives no longer than the lines in it can", async () => {
    const incident: WorkspaceRecord = newIncident();

    await serverA.first.hold(incident);

    const indexLeft: number = await inspector.pttl(indexKey());
    const lineLeft: number = await inspector.pttl(lineKeyOf(incident));

    expect(indexLeft).toBeGreaterThan(0);
    expect(indexLeft).toBeGreaterThanOrEqual(lineLeft - 1000);
    expect(indexLeft).toBeLessThanOrEqual(
      serverA.line.livesAtMostMs(serverA.first.HELD_FOR_AT_MOST_MS),
    );

    await serverA.first.postHeld(incident);
  });

  test("a line that is gone from Valkey is taken out of the index by the first server that looks at it", async () => {
    const channel: Channel = new Channel();
    const incident: WorkspaceRecord = newIncident();

    await serverA.first.hold(incident);

    // Gone - an eviction, a restart - while the index still names it, due now.
    await inspector.del(lineKeyOf(incident));
    await inspector.zadd(indexKey(), 0, lineKeyOf(incident));

    takesOver(serverB, channel);
    await waitUntil("the index no longer names the line", async () => {
      return (await inspector.zscore(indexKey(), lineKeyOf(incident))) === null;
    });

    expect(channel.posts()).toEqual([]);

    await serverA.first.postHeld(incident);
  });
});

describe("a server killed before its message's turn", () => {
  test("its message is posted by another server, from what it stored, in its turn, once", async () => {
    connect(serverA, { stalledAfterMs: 400 });
    connect(serverB, { stalledAfterMs: 400 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);
    takesOver(serverB, channel);

    await serverA.first.hold(incident);
    await channel.keep(
      serverB,
      incident,
      "B: Added Valeria as Incident Commander",
    );
    await channel.keep(
      serverA,
      incident,
      "A: Added team Platform as the owner",
    );

    // Killed outright: it never says anything again.
    serverB.valkey.freeze();

    channel.hear("A: Incident INC-42 Created", "A");
    await serverA.first.postHeld(incident);
    await channel.waitFor(3);
    await pause(300);

    expect(channel.postedBy()).toEqual([
      "A posted A: Incident INC-42 Created",
      "A posted B: Added Valeria as Incident Commander",
      "A posted A: Added team Platform as the owner",
    ]);

    /*
     * Its claim names the take-over by the server that took it over; the
     * other's, the server that made it and posted it in its turn.
     */
    const claims: Array<string> = Object.values(await theClaims(incident));

    expect(claims).toHaveLength(2);
    expect(claims).toContain(serverA.line.SERVER_ID);
    expect(
      claims.filter((claim: string): boolean => {
        return claim.startsWith(`over:${serverA.line.SERVER_ID}:`);
      }),
    ).toHaveLength(1);
  });

  test("its message is claimed for TAKEN_OVER_CLAIMED_FOR_MS - far longer than any line lives - so its server finds the claim however late it comes back", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");

    const messageId: string = (await theLine(incident))["id:1"]!;

    serverB.valkey.freeze();
    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    const left: number = await inspector.pttl(
      `${lineKeyOf(incident)}:claim:${messageId}`,
    );

    expect(serverA.line.TAKEN_OVER_CLAIMED_FOR_MS).toBe(60 * 60 * 1000);
    expect(left).toBeGreaterThan(
      serverA.line.livesAtMostMs(serverA.first.HELD_FOR_AT_MOST_MS),
    );
    expect(left).toBeLessThanOrEqual(serverA.line.TAKEN_OVER_CLAIMED_FOR_MS);

    // The take-over's, by the server that took it over: never read as the claim of the server that made it.
    const claim: string =
      (await inspector.get(`${lineKeyOf(incident)}:claim:${messageId}`)) || "";

    expect(claim.startsWith(`over:${serverA.line.SERVER_ID}:`)).toBe(true);
    expect(claim).not.toBe(serverB.line.SERVER_ID);
  });

  test("not before its turn has stalled", async () => {
    connect(serverA, { stalledAfterMs: 1500 });
    connect(serverB, { stalledAfterMs: 1500 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");
    serverB.valkey.freeze();

    const releasedAt: number = Date.now();
    await serverA.first.postHeld(incident);

    await pause(700);
    expect(channel.posts()).toEqual([]);

    await channel.waitFor(1, 10_000);

    expect(Date.now() - releasedAt).toBeGreaterThanOrEqual(1500 - 200);
    expect(channel.postedBy()).toEqual(["A posted B: kept"]);
  });

  test("the messages it held between another server's are posted in the order they were made, each once", async () => {
    connect(serverA, { stalledAfterMs: 400 });
    connect(serverB, { stalledAfterMs: 400 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "1: B");
    await channel.keep(serverA, incident, "2: A");
    await channel.keep(serverB, incident, "3: B");
    await channel.keep(serverA, incident, "4: A");
    await channel.keep(serverB, incident, "5: B");
    serverB.valkey.freeze();

    await serverA.first.postHeld(incident);
    await channel.waitFor(5);
    await pause(300);

    expect(channel.postedBy()).toEqual([
      "A posted 1: B",
      "A posted 2: A",
      "A posted 3: B",
      "A posted 4: A",
      "A posted 5: B",
    ]);
  });

  test("once one of its messages is taken over, its next ones in that line are taken over as their turns come, without another stalled turn", async () => {
    const STALLED_MS: number = 1500;
    connect(serverA, { stalledAfterMs: STALLED_MS });
    connect(serverB, { stalledAfterMs: STALLED_MS });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const heardAt: Array<number> = [];

    takesOver(serverA, async (stored: JSONObject): Promise<void> => {
      heardAt.push(Date.now());
      channel.hear(String(stored["name"]), "A");
    });

    await serverA.first.hold(incident);

    for (const name of ["B: first", "B: second", "B: third"]) {
      await channel.keep(serverB, incident, name);
    }

    serverB.valkey.freeze();

    const releasedAt: number = Date.now();
    await serverA.first.postHeld(incident);
    await channel.waitFor(3, 15_000);

    expect(channel.posts()).toEqual(["B: first", "B: second", "B: third"]);
    expect(heardAt[0]! - releasedAt).toBeGreaterThanOrEqual(STALLED_MS - 200);
    // Not three stalled turns: the next two right after the first.
    expect(heardAt[2]! - heardAt[0]!).toBeLessThan(STALLED_MS);
  });

  test("a line nobody else waits in is still looked after: its messages are posted by a server with none of its own there", async () => {
    connect(serverA, { stalledAfterMs: 400 });
    connect(serverB, { stalledAfterMs: 400 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: first");
    await channel.keep(serverB, incident, "B: second");
    serverB.valkey.freeze();

    // Nothing of its own waits: the holder goes on at once.
    await serverA.first.postHeld(incident);
    expect(serverA.line.isAnyWaitingHere()).toBe(false);

    await channel.waitFor(2);

    expect(channel.postedBy()).toEqual([
      "A posted B: first",
      "A posted B: second",
    ]);
  });

  test("REGRESSION (#11314): the server holding the record is killed before its Created message: once it has said nothing for STALLED_AFTER_MS - long before its hold runs out - another server posts its messages, in order, each once", async () => {
    const HELD_MS: number = 60_000;
    const STALLED_MS: number = 400;
    connect(serverA, { heldForAtMostMs: HELD_MS, stalledAfterMs: STALLED_MS });
    connect(serverB, { heldForAtMostMs: HELD_MS, stalledAfterMs: STALLED_MS });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverB, channel);

    await serverA.first.hold(incident);
    await channel.keep(
      serverA,
      incident,
      "A: Added team Platform as the owner",
    );
    await channel.keep(serverA, incident, "A: Added Jane as an owner");

    // Killed with its chain half way: no "Incident Created", and no word.
    serverA.valkey.freeze();
    const killedAt: number = Date.now();

    await channel.waitFor(2, 10_000);
    const postedAfter: number = Date.now() - killedAt;
    await pause(300);

    expect(channel.postedBy()).toEqual([
      "B posted A: Added team Platform as the owner",
      "B posted A: Added Jane as an owner",
    ]);

    /*
     * Not before it could have stopped saying it holds the line - it said
     * so KEPT_EVERY_MS (50 ms here) before it was killed at the most - and
     * nowhere near the hold's longest.
     */
    expect(postedAfter).toBeGreaterThanOrEqual(STALLED_MS - 100);
    expect(postedAfter).toBeLessThan(HELD_MS / 10);

    // The line is over, each message claimed by the take-over that posted it.
    expect(await theLine(incident)).toEqual({});

    const claims: Array<string> = Object.values(await theClaims(incident));

    expect(claims).toHaveLength(2);
    expect(
      claims.every((claim: string): boolean => {
        return claim.startsWith(`over:${serverB.line.SERVER_ID}:`);
      }),
    ).toBe(true);
  });

  test("two servers looking after the same line: the message is taken over by one of them, and posted once", async () => {
    connect(serverA, { stalledAfterMs: 400 });
    connect(serverB, { stalledAfterMs: 400 });
    connect(serverC, { stalledAfterMs: 400 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);
    takesOver(serverC, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: first");
    await channel.keep(serverA, incident, "A: second");
    await channel.keep(serverB, incident, "B: third");
    serverB.valkey.freeze();

    await serverA.first.postHeld(incident);
    await channel.waitFor(3);

    // And nothing more, however long they look.
    await pause(1000);

    expect(channel.posts()).toEqual(["B: first", "A: second", "B: third"]);
  });

  test("the server that takes a message over keeps its turn while it posts it: no third server takes it over too", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });
    connect(serverC, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    // The server taking it over posts slowly: a Slack that takes its time.
    const slow: { post: StoredLinePost; slack: SlowSlack } = slowPoster(
      channel,
      serverA,
    );
    takesOver(serverA, slow.post);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");
    serverB.valkey.freeze();

    await serverA.first.postHeld(incident);
    await slow.slack.started;

    // The third server looks after the line too, for three times a stalled turn.
    takesOver(serverC, channel);
    await pause(900);
    expect(channel.posts()).toEqual([]);

    slow.slack.finish();
    await channel.waitFor(1);
    await pause(300);

    expect(channel.postedBy()).toEqual(["A posted B: kept"]);
  });

  test("a message the taking server fails to post is logged, and the line moves on", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, async (): Promise<void> => {
      throw new Error("Slack is down");
    });

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: lost to Slack");
    await channel.keep(serverA, incident, "A: after it");
    serverB.valkey.freeze();

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    expect(channel.postedBy()).toEqual(["A posted A: after it"]);
    expect(errorsLoggedBy(serverA).join("\n")).toContain("Slack is down");
  });

  test("a stored message that cannot be read is logged, and the line moves on", async () => {
    connect(serverA, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);

    // A server took the first place in the line with something that is not JSON, then stopped.
    expect(await inspector.hincrby(lineKeyOf(incident), "tickets", 1)).toBe(1);
    await inspector.hset(
      lineKeyOf(incident),
      "id:1",
      "00000000-0000-4000-8000-000000000001",
      "by:1",
      "a server that stopped",
      "message:1",
      "{not json",
    );

    await channel.keep(serverA, incident, "A: after it");

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    expect(channel.posts()).toEqual(["A: after it"]);
    expect(errorsLoggedBy(serverA).join("\n")).toContain(
      "Posting a message held for a record's Created message failed",
    );
  });
});

describe("a server passed over as stopped, that comes back", () => {
  test("its message, taken over while the line was there, is never posted by it: while the other server posts it, and after", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: { post: StoredLinePost; slack: SlowSlack } = slowPoster(
      channel,
      serverA,
    );

    takesOver(serverA, slow.post);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");
    await channel.keep(serverA, incident, "A: after it");

    // Alive, but frozen for longer than a turn may stall.
    serverB.valkey.freeze();

    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.slack.started;

    // Back while its message is being posted for it.
    serverB.valkey.thaw();
    await serverB.line.drained(recordKeyOf(incident));
    expect(channel.posts()).toEqual([]);

    slow.slack.finish();
    await letGo;
    await channel.waitFor(2);
    await pause(300);

    expect(channel.postedBy()).toEqual([
      "A posted B: kept",
      "A posted A: after it",
    ]);
  });

  test("its message, taken over before its line was gone, is never posted by it once the line is gone", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");
    serverB.valkey.freeze();

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);
    await waitUntil("the line is over", async () => {
      return (await inspector.exists(lineKeyOf(incident))) === 0;
    });

    // Back once the line is gone: it asks, and the claim answers.
    serverB.valkey.thaw();
    await serverB.line.drained(recordKeyOf(incident));
    await pause(200);

    expect(channel.postedBy()).toEqual(["A posted B: kept"]);
  });

  test("it asks about its message: it has not stopped, and its next message is its own to post", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: SlowPost = slowPost(channel, "A: slow", "A");

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: first");
    await channel.keep(serverA, incident, "A: slow", { post: slow.post });
    await channel.keep(serverB, incident, "B: third");
    serverB.valkey.freeze();

    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.started;

    // Its first was taken over, and it is known to have stopped.
    expect((await theLine(incident))[`dead:${serverB.line.SERVER_ID}`]).toBe(
      "1",
    );

    // It comes back while the server before it posts, and asks about its first.
    serverB.valkey.thaw();
    await waitUntil("it is not known to have stopped any more", async () => {
      return (
        (await theLine(incident))[`dead:${serverB.line.SERVER_ID}`] ===
        undefined
      );
    });

    slow.finish();
    await letGo;
    await channel.waitFor(3);
    await serverB.line.drained(recordKeyOf(incident));

    // Its third waits for it, not for the server that took its first over.
    expect(channel.postedBy()).toEqual([
      "A posted B: first",
      "A posted A: slow",
      "B posted B: third",
    ]);
  });

  test("it takes a ticket for a new message: it has not stopped", async () => {
    connect(serverA);
    connect(serverB);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);

    // Known to have stopped in this line, as a server that took one of its messages over says.
    await inspector.hset(
      lineKeyOf(incident),
      `dead:${serverB.line.SERVER_ID}`,
      1,
    );

    await channel.keep(serverB, incident, "B: new");

    expect(
      (await theLine(incident))[`dead:${serverB.line.SERVER_ID}`],
    ).toBeUndefined();

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    expect(channel.postedBy()).toEqual(["B posted B: new"]);
  });

  test("its message, overdue by its own clock as it comes back, is not posted when it was taken over", async () => {
    const times: Times = {
      heldForAtMostMs: 400,
      releasedForAtMostMs: 400,
      stalledAfterMs: 200,
    };
    connect(serverA, times);
    connect(serverB, times);

    // It asks seldom: by its next ask its line could have lived out its 800 ms.
    tune(serverB.line, "ASKED_EVERY_MS", 1500);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");
    serverB.valkey.freeze();

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    // Awake again, it finds its message overdue, and claims it to post it out of turn.
    await pause(1800);
    serverB.valkey.thaw();
    await serverB.line.drained(recordKeyOf(incident));
    await pause(100);

    expect(channel.postedBy()).toEqual(["A posted B: kept"]);
  });

  test("shut down - a deploy - it does not post what another server took over", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    // It asks seldom: its message still waits on it when it shuts down.
    tune(serverB.line, "ASKED_EVERY_MS", 2000);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");
    serverB.valkey.freeze();

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    serverB.valkey.thaw();
    expect(serverB.line.isAnyWaitingHere()).toBe(true);

    await shutDown(serverB);
    await pause(100);

    expect(serverB.line.isAnyWaitingHere()).toBe(false);
    expect(channel.postedBy()).toEqual(["A posted B: kept"]);
  });
});

describe("what is never posted twice, nor posted where it should not be", () => {
  test("a server killed while it posted its message is passed over: it may have gone out, so nobody posts it again", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: SlowPost = slowPost(channel, "B: being posted", "B");

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: being posted", {
      post: slow.post,
    });
    await channel.keep(serverA, incident, "A: after it");

    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.started;

    // Killed half way through posting it: it says it still is no more.
    serverB.valkey.freeze();

    await letGo;
    await channel.waitFor(1, 10_000);
    await pause(300);

    expect(channel.postedBy()).toEqual(["A posted A: after it"]);
  });

  test("a message nothing was stored of, from a server that stopped, is passed over as before", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: not stored", { stored: false });
    await channel.keep(serverA, incident, "A: after it");
    serverB.valkey.freeze();

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);
    await pause(300);

    expect(channel.postedBy()).toEqual(["A posted A: after it"]);
  });

  test("a ticket a server running the code from before took - no id, nothing stored - is passed over after its turn stalls, as before", async () => {
    connect(serverA, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    expect(await inspector.hincrby(lineKeyOf(incident), "tickets", 1)).toBe(1);
    await channel.keep(serverA, incident, "A: after it");

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    expect(channel.postedBy()).toEqual(["A posted A: after it"]);
  });

  test("a server that takes nothing over passes a stopped server's unstored message over, as before, and leaves a stored one for a server that takes it over", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });
    connect(serverC, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: not stored", { stored: false });
    await channel.keep(serverB, incident, "B: stored");
    await channel.keep(serverA, incident, "A: after them");
    serverB.valkey.freeze();

    // A server shutting down, say: it takes nothing over.
    const letGo: Promise<void> = serverA.first.postHeld(incident);

    // Three times a stalled turn: the first is passed over, the second waits.
    await pause(1000);
    expect(channel.posts()).toEqual([]);
    expect((await theLine(incident))["served"]).toBe("1");

    // A server that takes over finds it.
    takesOver(serverC, channel);
    await letGo;
    await channel.waitFor(2);
    await pause(200);

    expect(channel.postedBy()).toEqual([
      "C posted B: stored",
      "A posted A: after them",
    ]);
  });

  test("a server shutting down takes nothing over from the moment it starts to", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });
    connect(serverC, { stalledAfterMs: 300 });

    // It has a hold of its own to let go, so its shutdown waits a while.
    tune(serverA.first, "SHUTDOWN_WAITS_AT_MOST_MS", 1500);

    const incident: WorkspaceRecord = newIncident();
    const another: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");
    serverB.valkey.freeze();
    await serverA.first.hold(another);

    await serverA.first.postHeld(incident);
    const shuttingDown: Promise<void> = shutDown(serverA);

    // Its turn stalls three times over: the server shutting down takes nothing.
    await pause(1000);
    expect(channel.posts()).toEqual([]);

    takesOver(serverC, channel);
    await channel.waitFor(1);
    await shuttingDown;

    expect(channel.postedBy()).toEqual(["C posted B: kept"]);
  });

  test("a server shutting down that cannot ask Valkey whether its stored message was taken over does not post it blind: another server posts it, once", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");
    expect((await theLine(incident))["message:1"]).toBeDefined();

    // It shuts down just as Valkey stops answering it.
    disconnect(serverB);
    const leaving: Promise<void> = shutDown(serverB);

    await serverA.first.postHeld(incident);
    await channel.waitFor(1);

    // Valkey answers it again: its message was taken over, so it is not posted here.
    connect(serverB, { stalledAfterMs: 300 });
    await leaving;
    await pause(200);

    expect(channel.postedBy()).toEqual(["A posted B: kept"]);
  });

  test("a server never takes over a message of its own: it posts those itself", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverC, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);

    // The first place in the line is this server's own, stored, and stalled - as while it is busy posting another.
    expect(await inspector.hincrby(lineKeyOf(incident), "tickets", 1)).toBe(1);
    await inspector.hset(
      lineKeyOf(incident),
      "id:1",
      "00000000-0000-4000-8000-000000000011",
      "by:1",
      serverA.line.SERVER_ID,
      "message:1",
      JSON.stringify({ name: "A: its own" }),
    );
    await channel.keep(serverA, incident, "A: after it");
    const letGo: Promise<void> = serverA.first.postHeld(incident);

    // Three times a stalled turn: it does not take its own over.
    await pause(1000);
    expect(channel.posts()).toEqual([]);
    expect(
      await serverA.line.takeOver({
        recordKey: recordKeyOf(incident),
        ticket: 1,
        messageId: "00000000-0000-4000-8000-000000000011",
        heldForAtMostMs: serverA.first.HELD_FOR_AT_MOST_MS,
      }),
    ).toBe(false);
    expect(
      await inspector.exists(
        `${lineKeyOf(incident)}:claim:00000000-0000-4000-8000-000000000011`,
      ),
    ).toBe(0);

    // Another server may.
    takesOver(serverC, channel);
    await letGo;
    await channel.waitFor(2);
    await pause(200);

    // Each once, in order: the next is A's own, or C's should C reach it first.
    expect(channel.posts()).toEqual(["A: its own", "A: after it"]);
    expect(channel.postedBy()[0]).toBe("C posted A: its own");
  });

  test("a take-over's claim is never read as the claim of the server that made the message: that server does not post it", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");

    // Claimed by a take-over in its name, as a take-over's claim is written.
    const messageId: string = (await theLine(incident))["id:1"]!;
    await inspector.set(
      `${lineKeyOf(incident)}:claim:${messageId}`,
      `over:${serverB.line.SERVER_ID}:an-attempt`,
      "PX",
      60_000,
    );

    await channel.keep(serverA, incident, "A: after it");
    await serverA.first.postHeld(incident);
    await serverB.line.drained(recordKeyOf(incident));
    await channel.waitFor(1);
    await pause(200);

    // The claim, not a post of its own: the turn is passed over once it stalls.
    expect(channel.postedBy()).toEqual(["A posted A: after it"]);
  });

  test("a take-over whose answer is lost on the way back is the same take-over when asked again: the message is posted, once", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");
    await channel.keep(serverA, incident, "A: after it");
    serverB.valkey.freeze();

    // The take-over runs in Valkey, and its answer never reaches the server that asked.
    serverA.valkey.losingAnswerTo = (script: string): boolean => {
      return script.includes("if claim and claim == ARGV[6] and message then");
    };

    await serverA.first.postHeld(incident);
    await channel.waitFor(2);
    await pause(300);

    expect(serverA.valkey.losingAnswerTo).toBeNull();
    expect(channel.postedBy()).toEqual([
      "A posted B: kept",
      "A posted A: after it",
    ]);
  });

  test("while every server is up, nothing is taken over: each posts its own, however many look after the line", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });
    connect(serverC, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);
    takesOver(serverB, channel);
    takesOver(serverC, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: first");
    await channel.keep(serverA, incident, "A: second");
    await channel.keep(serverB, incident, "B: third");

    await serverA.first.postHeld(incident);
    await channel.waitFor(3);
    await serverB.line.drained(recordKeyOf(incident));
    await pause(500);

    expect(channel.postedBy()).toEqual([
      "B posted B: first",
      "A posted A: second",
      "B posted B: third",
    ]);
  });

  test("a slow message keeps its turn on its own server: nobody takes it over while it posts", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: SlowPost = slowPost(channel, "B: a slow Slack", "B");

    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: a slow Slack", {
      post: slow.post,
    });
    await channel.keep(serverA, incident, "A: after it");

    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await slow.started;

    // Three times as long as a stalled turn.
    await pause(900);
    expect(channel.posts()).toEqual([]);

    slow.finish();
    await letGo;
    await channel.waitFor(2);

    expect(channel.postedBy()).toEqual([
      "B posted B: a slow Slack",
      "A posted A: after it",
    ]);
  });

  test("a shutting-down server finishes the message it is posting for another, and takes over nothing more", async () => {
    connect(serverA, { stalledAfterMs: 300 });
    connect(serverB, { stalledAfterMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();
    const slow: { post: StoredLinePost; slack: SlowSlack } = slowPoster(
      channel,
      serverA,
    );

    takesOver(serverA, slow.post);

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: first");
    await channel.keep(serverB, incident, "B: second");
    serverB.valkey.freeze();

    // A has nothing of its own waiting: what it takes over, it takes over looking after the line.
    await serverA.first.postHeld(incident);
    await slow.slack.started;

    const shuttingDown: Promise<void> = shutDown(serverA);
    await pause(100);
    slow.slack.finish();
    await shuttingDown;
    await pause(500);

    // The one under way is out; the next is not taken over by a server shutting down.
    expect(channel.postedBy()).toEqual(["A posted B: first"]);
    expect((await theLine(incident))["served"]).toBe("1");
  });
});

/*
 * THE SERVER HOLDING A RECORD SAYS IT STILL HOLDS ITS LINE (#11314).
 *
 * The server running a record's create chain holds the record's line until
 * its Created message is out. Killed outright before then, it held every
 * other message about the record until its hold ran out: five minutes. Now
 * it says it still holds the line every KEPT_EVERY_MS, on a timer of its
 * own, and once it has said nothing for STALLED_AFTER_MS the next server to
 * ask about the line, or to look after it, moves it on, in order, and posts
 * what the stopped server stored as its turns come, once. A server that is
 * only slow, or frozen for less than that, keeps its line.
 */
describe("the server holding a record says it still holds its line (#11314)", () => {
  const STALLED_MS: number = 600;
  const HELD_MS: number = 60_000;

  beforeEach(() => {
    for (const server of [serverA, serverB, serverC]) {
      connect(server, { heldForAtMostMs: HELD_MS, stalledAfterMs: STALLED_MS });
    }
  });

  // A script this server sent that says it still holds its lines.
  function saysItHolds(sent: Array<unknown>): boolean {
    return String(sent[0]).includes("kept[i - 1] = 1");
  }

  function keepHeldAsks(server: Server): Array<Array<unknown>> {
    return server.valkey.sent.filter(saysItHolds);
  }

  test("its line names it as its holder and when it last said so, which it says again every KEPT_EVERY_MS until it lets the line go", async () => {
    const incident: WorkspaceRecord = newIncident();

    await serverA.first.hold(incident);

    const opened: Record<string, string> = await theLine(incident);

    expect(opened["heldBy"]).toBe(serverA.line.SERVER_ID);
    expect(Number(opened["heldSince"])).toBeGreaterThan(0);
    expect(serverA.line.linesHeldHere()).toBe(1);

    // heldSince is the line's lifetime as it was then: each renewal, a lower one.
    await waitUntil(
      "its holder says again that it holds the line",
      async () => {
        return (
          Number((await theLine(incident))["heldSince"]) <
          Number(opened["heldSince"]) - 100
        );
      },
    );

    await serverA.first.postHeld(incident);

    expect(serverA.line.linesHeldHere()).toBe(0);

    // Let go, it says nothing more of the line.
    const asked: number = keepHeldAsks(serverA).length;
    await pause(300);
    expect(keepHeldAsks(serverA).length).toBe(asked);
  });

  test("REGRESSION (#11314): killed before its Created message, with another server's message waiting between its own: that server moves the line on once the holder has said nothing for STALLED_AFTER_MS, and posts all three, in the order made, each once", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverB, channel);

    await serverA.first.hold(incident);
    await channel.keep(
      serverA,
      incident,
      "A: Added team Platform as the owner",
    );
    await channel.keep(
      serverB,
      incident,
      "B: Added Valeria as Incident Commander",
    );
    await channel.keep(serverA, incident, "A: Added Jane as an owner");

    serverA.valkey.freeze();
    const killedAt: number = Date.now();

    await channel.waitFor(3);
    const postedAfter: number = Date.now() - killedAt;
    await pause(300);

    expect(channel.postedBy()).toEqual([
      "B posted A: Added team Platform as the owner",
      "B posted B: Added Valeria as Incident Commander",
      "B posted A: Added Jane as an owner",
    ]);
    expect(postedAfter).toBeGreaterThanOrEqual(STALLED_MS - 100);
    expect(postedAfter).toBeLessThan(HELD_MS / 10);
    expect(await theLine(incident)).toEqual({});
  });

  test("REGRESSION (#11314): its line moved on, the holder is known to have stopped there: what it stored is taken over at once, without another stalled turn", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverB, channel);

    await serverA.first.hold(incident);
    await channel.keep(
      serverA,
      incident,
      "A: Added team Platform as the owner",
    );
    await channel.keep(serverA, incident, "A: Added Jane as an owner");

    serverA.valkey.freeze();
    const killedAt: number = Date.now();

    await channel.waitFor(2);

    // Both within one stall of the kill: neither waited for its own turn to stall.
    expect(Date.now() - killedAt).toBeLessThan(STALLED_MS * 2);
    expect(channel.postedBy()).toEqual([
      "B posted A: Added team Platform as the owner",
      "B posted A: Added Jane as an owner",
    ]);
  });

  test("a holder that keeps saying it holds its line is never moved on, however long its chain takes: its Created message comes first", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverB, channel);
    takesOver(serverC, channel);

    await serverA.first.hold(incident);
    await channel.keep(
      serverB,
      incident,
      "B: Added Valeria as Incident Commander",
    );

    // Three times as long as a holder may say nothing: its chain is only slow.
    await pause(STALLED_MS * 3);

    const line: Record<string, string> = await theLine(incident);

    expect(channel.posts()).toEqual([]);
    expect(line["released"]).toBe("0");
    expect(line[`dead:${serverA.line.SERVER_ID}`]).toBeUndefined();

    channel.hear("A: Incident INC-42 Created", "A");
    await serverA.first.postHeld(incident);
    await channel.waitFor(2);
    await serverB.line.drained(recordKeyOf(incident));

    expect(channel.postedBy()).toEqual([
      "A posted A: Incident INC-42 Created",
      "B posted B: Added Valeria as Incident Commander",
    ]);
  });

  test("a holder frozen for less than STALLED_AFTER_MS keeps its line: thawed, it says it holds it again, and its Created message comes first", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverB, channel);

    await serverA.first.hold(incident);
    await channel.keep(
      serverB,
      incident,
      "B: Added Valeria as Incident Commander",
    );

    // Frozen - a long pause - for a third of what its line allows, then back.
    serverA.valkey.freeze();
    await pause(STALLED_MS / 3);
    serverA.valkey.thaw();

    // Well past when it would have stopped, had it not said so again.
    await pause(STALLED_MS * 2);

    const line: Record<string, string> = await theLine(incident);

    expect(channel.posts()).toEqual([]);
    expect(line["released"]).toBe("0");
    expect(line[`dead:${serverA.line.SERVER_ID}`]).toBeUndefined();

    channel.hear("A: Incident INC-42 Created", "A");
    await serverA.first.postHeld(incident);
    await channel.waitFor(2);
    await serverB.line.drained(recordKeyOf(incident));

    expect(channel.postedBy()).toEqual([
      "A posted A: Incident INC-42 Created",
      "B posted B: Added Valeria as Incident Commander",
    ]);
  });

  test("a holder frozen past STALLED_AFTER_MS comes back to find its line moved on: what it stored was posted for it, once, it posts none of it again, and its Created message comes after", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverB, channel);

    await serverA.first.hold(incident);
    await channel.keep(
      serverA,
      incident,
      "A: Added team Platform as the owner",
    );
    await channel.keep(
      serverB,
      incident,
      "B: Added Valeria as Incident Commander",
    );

    serverA.valkey.freeze();
    await channel.waitFor(2);

    expect(channel.postedBy()).toEqual([
      "B posted A: Added team Platform as the owner",
      "B posted B: Added Valeria as Incident Commander",
    ]);

    // It comes back, and its chain goes on to its Created message.
    serverA.valkey.thaw();
    channel.hear("A: Incident INC-42 Created", "A");
    await serverA.first.postHeld(incident);
    await serverA.line.drained(recordKeyOf(incident));
    await pause(300);

    expect(channel.postedBy()).toEqual([
      "B posted A: Added team Platform as the owner",
      "B posted B: Added Valeria as Incident Commander",
      "A posted A: Incident INC-42 Created",
    ]);
    expect(serverA.line.linesHeldHere()).toBe(0);
  });

  test("a holder that let its hold go while Valkey could not hear it: its own message, asking, moves the line on at once - not once it has stalled", async () => {
    const LONG_STALL_MS: number = 30_000;
    connect(serverA, {
      heldForAtMostMs: HELD_MS,
      stalledAfterMs: LONG_STALL_MS,
    });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await channel.keep(
      serverA,
      incident,
      "A: Added team Platform as the owner",
    );

    // Its Created message goes out; Valkey does not hear it let the hold go.
    channel.hear("A: Incident INC-42 Created", "A");
    disconnect(serverA);
    const letGo: Promise<void> = serverA.first.postHeld(incident);
    await pause(100);

    expect((await theLine(incident))["released"]).toBe("0");

    // Valkey can be asked again: its message asks, and goes in its turn.
    connect(serverA, {
      heldForAtMostMs: HELD_MS,
      stalledAfterMs: LONG_STALL_MS,
    });
    const askedAt: number = Date.now();
    await letGo;
    await channel.waitFor(2);

    expect(Date.now() - askedAt).toBeLessThan(LONG_STALL_MS / 10);
    expect(channel.postedBy()).toEqual([
      "A posted A: Incident INC-42 Created",
      "A posted A: Added team Platform as the owner",
    ]);
    expect(await theLine(incident)).toEqual({});
  });

  test("a holder that let its hold go while Valkey could not hear it, with nothing of its own in the line: another server moves the line on once the holder has said nothing for STALLED_AFTER_MS", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverB, channel);

    await serverA.first.hold(incident);
    await channel.keep(
      serverB,
      incident,
      "B: Added Valeria as Incident Commander",
    );

    channel.hear("A: Incident INC-42 Created", "A");
    disconnect(serverA);
    await serverA.first.postHeld(incident);
    connect(serverA, { heldForAtMostMs: HELD_MS, stalledAfterMs: STALLED_MS });

    // It said it holds the line no more as it let it go.
    expect(serverA.line.linesHeldHere()).toBe(0);

    await channel.waitFor(2);

    expect(channel.postedBy()).toEqual([
      "A posted A: Incident INC-42 Created",
      "B posted B: Added Valeria as Incident Commander",
    ]);
  });

  test("its line opened though Valkey's answer was lost on its way back: it says it holds the line all the same, so another server's message waits for its Created message, and the line goes with its hold", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverB, channel);

    // The line is opened; the answer never reaches the holder.
    serverA.valkey.losingAnswerTo = (script: string): boolean => {
      return script.includes("'heldBy', ARGV[4]");
    };

    await serverA.first.hold(incident);

    expect((await theLine(incident))["heldBy"]).toBe(serverA.line.SERVER_ID);
    expect(serverA.line.linesHeldHere()).toBe(1);

    await channel.keep(
      serverB,
      incident,
      "B: Added Valeria as Incident Commander",
    );
    await channel.keep(
      serverA,
      incident,
      "A: Added team Platform as the owner",
    );

    // Long past when a holder that said nothing would have stopped.
    await pause(STALLED_MS * 3);

    expect(channel.posts()).toEqual([]);
    expect((await theLine(incident))["released"]).toBe("0");

    channel.hear("A: Incident INC-42 Created", "A");
    await serverA.first.postHeld(incident);
    await channel.waitFor(3);
    await serverB.line.drained(recordKeyOf(incident));

    // Its own message waited on it alone, as with no Valkey: both follow Created.
    expect(channel.posts()[0]).toBe("A: Incident INC-42 Created");
    expect(channel.posts().slice(1).sort()).toEqual([
      "A: Added team Platform as the owner",
      "B: Added Valeria as Incident Commander",
    ]);
    expect(serverA.line.linesHeldHere()).toBe(0);
    expect(await theLine(incident)).toEqual({});
  });

  test("the holder, looking after its own line, has not stopped: it leaves the line for the next server that looks", async () => {
    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    // It holds the line, says nothing of it - and looks after the lines.
    jest.spyOn(serverA.line, "keepHeld").mockResolvedValue(undefined);
    takesOver(serverA, channel);

    await serverA.first.hold(incident);
    await channel.keep(
      serverA,
      incident,
      "A: Added team Platform as the owner",
    );

    await pause(STALLED_MS * 3);

    const line: Record<string, string> = await theLine(incident);

    expect(line["released"]).toBe("0");
    expect(line[`dead:${serverA.line.SERVER_ID}`]).toBeUndefined();
    expect(channel.posts()).toEqual([]);

    // Another server looks after the line: it moves it on, and posts what the holder stored.
    takesOver(serverB, channel);
    await channel.waitFor(1);

    expect(channel.postedBy()).toEqual([
      "B posted A: Added team Platform as the owner",
    ]);
  });

  test("a line opened by a server running the code from before - no holder named, never said held - waits as long as its hold lasts, as before", async () => {
    const SHORT_HOLD_MS: number = 2_000;

    for (const server of [serverA, serverB]) {
      connect(server, {
        heldForAtMostMs: SHORT_HOLD_MS,
        stalledAfterMs: STALLED_MS,
      });
    }

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverB, channel);

    await serverA.first.hold(incident);

    // As the code from before opened it: no holder, and nothing said.
    await inspector.hdel(lineKeyOf(incident), "heldBy", "heldSince");
    const heldAt: number = Date.now();

    await channel.keep(
      serverB,
      incident,
      "B: Added Valeria as Incident Commander",
    );
    serverA.valkey.freeze();

    await pause(STALLED_MS * 2);
    expect(channel.posts()).toEqual([]);

    await channel.waitFor(1, 10_000);

    expect(channel.postedBy()).toEqual([
      "B posted B: Added Valeria as Incident Commander",
    ]);
    expect(Date.now() - heldAt).toBeGreaterThanOrEqual(SHORT_HOLD_MS - 500);
  });

  test("what it costs Valkey is bounded: one ask for every LINES_KEPT_AT_A_TIME lines held, none while one is unanswered, none once nothing is held", async () => {
    tune(serverA.line, "LINES_KEPT_AT_A_TIME", 2);
    // Its timer out of the way: each round here is asked for.
    tune(serverA.line, "KEPT_EVERY_MS", 60_000);

    const incidents: Array<WorkspaceRecord> = [];

    for (let i: number = 0; i < 5; i++) {
      const incident: WorkspaceRecord = newIncident();
      incidents.push(incident);
      await serverA.first.hold(incident);
    }

    expect(serverA.line.linesHeldHere()).toBe(5);

    // One round: two lines, two lines, one line - each ask naming the index first.
    const before: number = keepHeldAsks(serverA).length;
    await serverA.line.keepHeld();

    expect(
      keepHeldAsks(serverA)
        .slice(before)
        .map((sent: Array<unknown>): unknown => {
          // eval(script, the number of keys, ...)
          return sent[1];
        }),
    ).toEqual([3, 3, 2]);

    // Unanswered, a round is not asked again.
    serverA.valkey.freeze();
    const frozenBefore: number = keepHeldAsks(serverA).length;
    const first: Promise<void> = serverA.line.keepHeld();
    const second: Promise<void> = serverA.line.keepHeld();
    await pause(200);

    expect(keepHeldAsks(serverA).length - frozenBefore).toBe(1);

    serverA.valkey.thaw();
    await first;
    await second;

    // Nothing held, nothing asked.
    for (const incident of incidents) {
      await serverA.first.postHeld(incident);
    }

    expect(serverA.line.linesHeldHere()).toBe(0);

    const idleBefore: number = keepHeldAsks(serverA).length;
    await serverA.line.keepHeld();

    expect(keepHeldAsks(serverA).length).toBe(idleBefore);
  });

  test("a line Valkey says is no longer its holder's - moved on, held by another, or gone - is said held no more, and nothing of it is renewed", async () => {
    tune(serverA.line, "KEPT_EVERY_MS", 60_000);

    const moved: WorkspaceRecord = newIncident();
    const another: WorkspaceRecord = newIncident();
    const gone: WorkspaceRecord = newIncident();

    for (const incident of [moved, another, gone]) {
      await serverA.first.hold(incident);
    }

    await inspector.hset(lineKeyOf(moved), "released", "1");
    await inspector.hset(lineKeyOf(another), "heldBy", serverB.line.SERVER_ID);
    await inspector.del(lineKeyOf(gone));

    const heldSince: Array<string | undefined> = [
      (await theLine(moved))["heldSince"],
      (await theLine(another))["heldSince"],
    ];

    await serverA.line.keepHeld();

    expect(serverA.line.linesHeldHere()).toBe(0);
    expect([
      (await theLine(moved))["heldSince"],
      (await theLine(another))["heldSince"],
    ]).toEqual(heldSince);
    expect(await theLine(gone)).toEqual({});
  });
});

describe("when Valkey cannot be asked", () => {
  test("a server that cannot reach Valkey once its message is overdue posts it anyway, rather than never", async () => {
    connect(serverA, { heldForAtMostMs: 300, releasedForAtMostMs: 300 });
    connect(serverB, { heldForAtMostMs: 300, releasedForAtMostMs: 300 });

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    await serverA.first.hold(incident);
    await channel.keep(serverB, incident, "B: kept");

    // Valkey is gone, for every server: nobody could have taken it over.
    disconnect(serverA);
    disconnect(serverB);

    await channel.waitFor(1, 5000);
    await pause(200);

    expect(channel.postedBy()).toEqual(["B posted B: kept"]);
  });

  test("takeOverForStoppedServers on a server with no Valkey looks after nothing, and holds still work", async () => {
    disconnect(serverA);

    const incident: WorkspaceRecord = newIncident();
    const channel: Channel = new Channel();

    takesOver(serverA, channel);
    await serverA.line.lookAfterLines();

    await serverA.first.hold(incident);
    expect(await channel.keep(serverA, incident, "A: kept here")).toBe(true);

    channel.hear("A: Incident INC-42 Created", "A");
    await serverA.first.postHeld(incident);

    expect(channel.posts()).toEqual([
      "A: Incident INC-42 Created",
      "A: kept here",
    ]);
  });
});
