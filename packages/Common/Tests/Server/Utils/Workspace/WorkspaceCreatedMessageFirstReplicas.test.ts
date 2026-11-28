import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ChildProcess, fork } from "child_process";
import { Redis as RedisClient } from "ioredis";
import path from "path";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import type {
  ReplicaAnswer,
  ReplicaCommand,
  ReplicaPaused,
  ReplicaReady,
  ReplicaSlackPost,
} from "../../TestingUtils/Replicas/WorkspaceReplica";
import getTestRedisConnectionOptions from "../../TestingUtils/Redis/TestRedisOptions";

/*
 * TWO APP SERVERS, TWO PROCESSES, ONE VALKEY (#11198).
 *
 * A new incident's create chain runs on one App server. While it runs,
 * every other message about the incident waits for "Incident Created" and
 * follows it, in the order it was made (WorkspaceCreatedMessageFirst,
 * #11146). The hold was kept in the memory of that server, so a message
 * made on another one went out at once: the Incident Commander role the
 * Dashboard gives the declarer as the incident's page opens - a request
 * that lands on whichever replica the load balancer picks - reached the
 * channel before "Incident Created".
 *
 * Here each server is a process of its own (ReplicaProcess.js running
 * WorkspaceReplica.ts), with its own memory and its own Valkey connection,
 * and the real IncidentService create chain, the real Incident Commander
 * role, rule matching and posting, against its own copy of the database. The
 * hold they share is the real one, in a real Valkey: the one the Common
 * suites run against (CI's test-setup.sh starts it on localhost:6310), or
 * another named by VALKEY_HOST and VALKEY_PORT. Slack is this test: each
 * server tells it of every post as the post goes out, and waits for it to
 * have it, so it hears the posts of both servers in the order Slack would.
 *
 * The messages themselves were in the memory of the server that made them,
 * so a server killed outright - an OOM kill, a lost node, SIGKILL - lost
 * every message waiting on it (#11235). Now each waits in Valkey with what
 * it says, and another server posts it, in its turn and once: here a server
 * is killed with SIGKILL while it holds messages, or frozen with SIGSTOP
 * and let go on with SIGCONT, to show nothing is lost and nothing is posted
 * twice.
 *
 * Every line this run makes in Valkey has a key prefix of its own, deleted
 * afterwards.
 */

jest.setTimeout(300_000);

const BOOTSTRAP: string = path.resolve(
  __dirname,
  "../../TestingUtils/Replicas/ReplicaProcess.js",
);
const REPLICA_MODULE: string =
  "Tests/Server/TestingUtils/Replicas/WorkspaceReplica.ts";

// Loading Common's services takes a process a while: longer on a busy runner.
const STARTS_WITHIN_MS: number = 240_000;

const KEY_PREFIX: string = `workspace-created-message-first:replicas-test-${ObjectID.generate().toString()}:`;

interface Post {
  replica: string;
  channel: string;
  text: string;
}

// The Slack channel both servers post to, as Slack hears them.
class Slack {
  public posts: Array<Post> = [];

  /*
   * The posts Slack hears but does not answer yet, as a slow Slack would
   * not: their server waits on them until released (Replica.releaseHeld).
   */
  public holding: ((post: Post) => boolean) | null = null;

  private waiters: Array<() => void> = [];

  public isHolding(post: ReplicaSlackPost): boolean {
    return Boolean(this.holding?.(post));
  }

  public hear(post: ReplicaSlackPost): void {
    this.posts.push({
      replica: post.replica,
      channel: post.channel,
      text: post.text,
    });

    const waiters: Array<() => void> = this.waiters;
    this.waiters = [];

    for (const waiter of waiters) {
      waiter();
    }
  }

  // What was posted, as "<server>: <kind of message>".
  public said(): Array<string> {
    return this.posts.map((post: Post): string => {
      return `${post.replica}: ${describePost(post.text)}`;
    });
  }

  // Settles once `count` posts are in, or fails after `withinMs`.
  public async waitFor(
    count: number,
    withinMs: number = 30_000,
  ): Promise<void> {
    if (this.posts.length >= count) {
      return;
    }

    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          reject(
            new Error(
              `Expected ${count} posts within ${withinMs} ms, heard ${JSON.stringify(this.said())}`,
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

  public reset(): void {
    this.posts = [];
    this.holding = null;
  }
}

// What a post is, from its text.
function describePost(text: string): string {
  if (text.includes("Incident INC-42 Created")) {
    return "Incident Created";
  }

  // A maintenance event's and an on-call policy's (#11223, #11224).
  if (text.includes("Scheduled Maintenance SM-5 Created")) {
    return "Maintenance Created";
  }

  if (text.includes("On-Call Policy Created")) {
    return "Policy Created";
  }

  if (text.includes("Incident Commander")) {
    return "Incident Commander";
  }

  if (text.includes("Added team") && text.includes("Platform")) {
    return "Platform added";
  }

  // A person made an owner: the record's creator, or someone on another server.
  if (text.includes("Added") && text.includes("as the owner")) {
    return "owner added";
  }

  if (text.includes("Valeria posted a note")) {
    return "a note";
  }

  return text.slice(0, 80);
}

// The times an App server runs with, as it says once set up.
interface ReplicaTimes {
  heldForAtMostMs: number;
  stalledAfterMs: number;
  keptEveryMs: number;
  lookedAfterEveryMs: number;
  askedEveryMs: number;
}

// An App server: a process of its own, asked over its IPC channel.
class Replica {
  public stderr: string = "";
  public exited: Promise<number | null>;
  public heardAt: Array<number> = [];
  public times: ReplicaTimes | null = null;

  private nextId: number = 1;
  private answers: Map<
    number,
    { resolve: (result: JSONObject) => void; reject: (error: Error) => void }
  > = new Map();
  private pausedWaiters: Array<() => void> = [];
  private readyWaiters: Array<() => void> = [];
  private isReady: boolean = false;
  private hasPaused: boolean = false;

  // The posts of this server Slack heard and holds its answer to.
  private heldAnswers: Array<number> = [];

  public constructor(
    public readonly name: string,
    private readonly child: ChildProcess,
    slack: Slack,
  ) {
    this.exited = new Promise<number | null>(
      (resolve: (code: number | null) => void) => {
        child.on("exit", (code: number | null) => {
          for (const [, answer] of this.answers) {
            answer.reject(
              new Error(
                `${name} exited (${code}): ${this.stderr.slice(-4000)}`,
              ),
            );
          }

          this.answers.clear();
          resolve(code);
        });
      },
    );

    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });

    child.on(
      "message",
      (
        message:
          | ReplicaAnswer
          | ReplicaSlackPost
          | ReplicaPaused
          | ReplicaReady,
      ) => {
        if ("event" in message) {
          if (message.event === "slack") {
            this.heardAt.push(Date.now());
            slack.hear(message);

            if (slack.isHolding(message)) {
              // Slack has it, and is slow to say so: the server waits on it.
              this.heldAnswers.push(message.seq);
              return;
            }

            // Slack has it: the server may go on.
            child.send({ ack: message.seq });
          } else if (message.event === "paused") {
            this.hasPaused = true;
            this.tell(this.pausedWaiters);
            this.pausedWaiters = [];
          } else if (message.event === "ready") {
            this.isReady = true;
            this.tell(this.readyWaiters);
            this.readyWaiters = [];
          }

          return;
        }

        const answer:
          | {
              resolve: (result: JSONObject) => void;
              reject: (error: Error) => void;
            }
          | undefined = this.answers.get(message.id);

        this.answers.delete(message.id);

        if (!answer) {
          return;
        }

        if (message.ok) {
          answer.resolve(message.result || {});
        } else {
          answer.reject(new Error(`${name}: ${message.error}`));
        }
      },
    );
  }

  public static start(name: string, slack: Slack): Replica {
    const child: ChildProcess = fork(BOOTSTRAP, [], {
      cwd: path.resolve(__dirname, "../../../.."),
      env: {
        ...process.env,
        REPLICA_NAME: name,
        REPLICA_MODULE: REPLICA_MODULE,
      },
      execArgv: ["--enable-source-maps"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    return new Replica(name, child, slack);
  }

  public ready(): Promise<void> {
    return this.waitOn(
      this.isReady,
      this.readyWaiters,
      STARTS_WITHIN_MS,
      "ready",
    );
  }

  public paused(): Promise<void> {
    return this.waitOn(this.hasPaused, this.pausedWaiters, 30_000, "paused");
  }

  public ask(
    command: ReplicaCommand["command"],
    args: JSONObject = {},
  ): Promise<JSONObject> {
    const id: number = this.nextId++;

    if (command === "createIncident") {
      this.hasPaused = false;
    }

    return new Promise<JSONObject>(
      (
        resolve: (result: JSONObject) => void,
        reject: (error: Error) => void,
      ) => {
        this.answers.set(id, { resolve, reject });
        this.child.send({ id: id, command: command, args: args });
      },
    );
  }

  // Stops it without a word, as a crash or an OOM kill does.
  public async kill(): Promise<void> {
    this.child.kill("SIGKILL");
    await this.exited;
  }

  // Stops it as a deploy does: SIGTERM, then its shutdown handlers run.
  public async terminate(): Promise<void> {
    this.child.kill("SIGTERM");
    await this.exited;
  }

  /*
   * Freezes it, alive, as a node that stops answering does - a long pause,
   * a frozen VM - until resume: it says nothing, and does nothing.
   */
  public freeze(): void {
    this.child.kill("SIGSTOP");
  }

  // It goes on from where it was frozen.
  public resume(): void {
    this.child.kill("SIGCONT");
  }

  // Slack answers the posts of this server it held.
  public releaseHeld(): void {
    const held: Array<number> = this.heldAnswers;
    this.heldAnswers = [];

    for (const seq of held) {
      this.child.send({ ack: seq });
    }
  }

  public isRunning(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  private waitOn(
    done: boolean,
    waiters: Array<() => void>,
    withinMs: number,
    what: string,
  ): Promise<void> {
    if (done) {
      return Promise.resolve();
    }

    return new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          reject(
            new Error(
              `${this.name} was not ${what} within ${withinMs} ms: ${this.stderr.slice(-4000)}`,
            ),
          );
        }, withinMs);

        waiters.push((): void => {
          clearTimeout(timer);
          resolve();
        });
      },
    );
  }

  private tell(waiters: Array<() => void>): void {
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

function connection(): RedisClient {
  return new RedisClient({
    ...getTestRedisConnectionOptions(),
    ...(process.env["VALKEY_HOST"] ? { host: process.env["VALKEY_HOST"] } : {}),
    ...(process.env["VALKEY_PORT"]
      ? { port: Number(process.env["VALKEY_PORT"]) }
      : {}),
  });
}

const slack: Slack = new Slack();
let inspector: RedisClient;
let replicas: Array<Replica> = [];

// Starts the servers a test runs on, each set up with the hold's times.
async function startServers(
  names: Array<string>,
  times: JSONObject = {},
): Promise<Array<Replica>> {
  const started: Array<Replica> = names.map((name: string): Replica => {
    return Replica.start(name, slack);
  });

  replicas.push(...started);

  await Promise.all(
    started.map((replica: Replica): Promise<void> => {
      return replica.ready();
    }),
  );

  await Promise.all(
    started.map(async (replica: Replica): Promise<void> => {
      const setUp: JSONObject = await replica.ask("setUp", {
        keyPrefix: KEY_PREFIX,
        ...times,
      });

      replica.times = (setUp["times"] as unknown as ReplicaTimes) || null;
    }),
  );

  return started;
}

async function deleteTheLines(): Promise<void> {
  const keys: Array<string> = await inspector.keys(`${KEY_PREFIX}*`);

  if (keys.length > 0) {
    await inspector.del(...keys);
  }
}

/*
 * A record's line in Valkey, as its hash holds it: {} once it is gone. The
 * incident's, or another kind's by the field that names it.
 */
async function theLine(
  field: string = "incidentId",
): Promise<Record<string, string>> {
  const lines: Array<string> = (
    await inspector.keys(`${KEY_PREFIX}${field}:*`)
  ).filter((key: string): boolean => {
    return !key.includes(":claim:");
  });

  return lines[0] ? await inspector.hgetall(lines[0]) : {};
}

// The claims of a record's messages: which server posts each.
async function theClaims(field: string = "incidentId"): Promise<Array<string>> {
  const claims: Array<string> = await inspector.keys(
    `${KEY_PREFIX}${field}:*:claim:*`,
  );

  return claims.length > 0
    ? ((await inspector.mget(...claims)) as Array<string>)
    : [];
}

// Settles once `isSo` is, asked every 50 ms, or fails after `withinMs`.
async function waitUntil(
  what: string,
  isSo: () => Promise<boolean>,
  withinMs: number = 20_000,
): Promise<void> {
  const until: number = Date.now() + withinMs;

  while (!(await isSo())) {
    if (Date.now() > until) {
      throw new Error(`Not so within ${withinMs} ms: ${what}`);
    }

    await pause(50);
  }
}

beforeAll(async () => {
  inspector = connection();
  await inspector.connect();
});

afterEach(async () => {
  for (const replica of replicas) {
    if (replica.isRunning()) {
      // A frozen process takes SIGKILL too.
      await replica.kill();
    }
  }

  replicas = [];
  slack.reset();
  await deleteTheLines();
});

afterAll(async () => {
  inspector.disconnect();
});

describe("an incident created on one server, while another speaks of it", () => {
  test("REGRESSION (#11198): the Incident Commander role given on another server reaches the channel after Incident Created, each once", async () => {
    const [creating, other] = await startServers(["A", "B"]);

    // A's create chain runs, and waits at its first state.
    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    // The page opens on the other server, which gives the declarer the role.
    await other!.ask("assignCommander");

    await pause(500);
    expect(slack.said()).toEqual([]);

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3);
    await other!.ask("drained");
    await pause(200);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "B: Incident Commander",
      "A: Platform added",
    ]);
    expect(
      slack.posts.every((post: Post): boolean => {
        return post.channel === "C0EXIST";
      }),
    ).toBe(true);
  });

  test("REGRESSION (#11198): everything said on both servers follows Incident Created in the order it was said, each once", async () => {
    const [creating, other] = await startServers(["A", "B"]);

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    await other!.ask("assignCommander");
    await other!.ask("postAboutIncident", {
      markdown: "📝 Valeria posted a note on Incident INC-42.",
    });

    await pause(300);
    expect(slack.said()).toEqual([]);

    await creating!.ask("resume");
    await created;
    await slack.waitFor(4);
    await other!.ask("drained");
    await pause(200);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "B: Incident Commander",
      "B: a note",
      "A: Platform added",
    ]);
  });
});

describe("nothing waits for good, across servers", () => {
  test("REGRESSION (#11198): the server running the create chain stops without a word: the other server's message waits for the hold to run out, then goes", async () => {
    const HELD_MS: number = 4000;
    const [creating, other] = await startServers(["A", "B"], {
      heldForAtMostMs: HELD_MS,
      releasedForAtMostMs: 10_000,
    });

    void creating!
      .ask("createIncident", { pauseAtFirstState: true })
      .catch((): void => {
        // It is stopped below.
      });
    await creating!.paused();
    const heldFrom: number = Date.now();

    await other!.ask("assignCommander");

    // Gone, with its chain half way and its hold in Valkey.
    await creating!.kill();

    await pause(1000);
    expect(slack.said()).toEqual([]);

    await slack.waitFor(1, 30_000);

    expect(slack.said()).toEqual(["B: Incident Commander"]);
    // Not before the hold had lasted its longest.
    expect(other!.heardAt[0]! - heldFrom).toBeGreaterThanOrEqual(
      HELD_MS - 1000,
    );
  });

  test("a deploy stops the other server while its message waits: it is posted as the server stops, not lost, and the line goes on at once", async () => {
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: 60_000,
    });

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    await other!.ask("assignCommander");

    // SIGTERM: its shutdown handlers run, and post what still waits on it.
    await other!.terminate();
    await slack.waitFor(1, 30_000);

    expect(slack.said()).toEqual(["B: Incident Commander"]);

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3, 20_000);

    expect(slack.said()).toEqual([
      "B: Incident Commander",
      "A: Incident Created",
      "A: Platform added",
    ]);
  });

  test("the create chain fails before Incident Created: its .catch lets every server's waiting messages go", async () => {
    const [creating, other] = await startServers(["A", "B"]);

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
      failBeforeCreated: true,
    });
    await creating!.paused();

    await other!.ask("assignCommander");

    await pause(300);
    expect(slack.said()).toEqual([]);

    await creating!.ask("resume");
    await created;
    await slack.waitFor(2, 30_000);
    await other!.ask("drained");
    await pause(200);

    expect(slack.said()).toEqual([
      "B: Incident Commander",
      "A: Platform added",
    ]);
  });
});

describe("a server killed outright loses none of the messages it held (#11235)", () => {
  test("REGRESSION (#11235): the other server is killed while its message waits: the creating server posts it, in its turn, once", async () => {
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: STALLED_MS,
    });

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    // Its message takes the first place in the line - then it is gone, as an OOM kill leaves it.
    await other!.ask("assignCommander");
    await other!.kill();

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3, 30_000);
    await creating!.ask("drained");
    await pause(500);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "A: Incident Commander",
      "A: Platform added",
    ]);

    // Posted for the killed server once its turn had stalled, not before.
    expect(
      creating!.heardAt[1]! - creating!.heardAt[0]!,
    ).toBeGreaterThanOrEqual(STALLED_MS - 500);
  });

  test("REGRESSION (#11235, #11314): the server running the create chain is killed while its own message waits: the other server posts it once the killed server has said nothing for STALLED_AFTER_MS, long before the hold runs out", async () => {
    const HELD_MS: number = 120_000;
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      heldForAtMostMs: HELD_MS,
      releasedForAtMostMs: 30_000,
      stalledAfterMs: STALLED_MS,
    });

    void creating!
      .ask("createIncident", { pauseBeforeCreated: true })
      .catch((): void => {
        // It is killed below.
      });
    await creating!.paused();

    // "Added team Platform to the Incident as the owner" has its place in the line.
    await waitUntil("the owner message has its ticket", async () => {
      return Number((await theLine())["tickets"] || 0) >= 1;
    });

    // Killed with its chain half way, before "Incident Created".
    await creating!.kill();
    const killedAt: number = Date.now();

    await slack.waitFor(1, 40_000);
    await pause(1000);

    // The other server, with no message of its own in the line, posts it.
    expect(slack.said()).toEqual(["B: Platform added"]);

    // Once its holder could have stopped saying it holds the line, not after the hold.
    const postedAfter: number = other!.heardAt[0]! - killedAt;

    expect(postedAfter).toBeGreaterThanOrEqual(
      STALLED_MS - creating!.times!.keptEveryMs - 500,
    );
    expect(postedAfter).toBeLessThan(HELD_MS / 10);
  });

  test("the other server is killed while its message waits last in the line: the creating server posts it, with nothing of its own left waiting", async () => {
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: STALLED_MS,
    });

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseBeforeCreated: true,
    });
    await creating!.paused();

    // After "Platform added": the Incident Commander role, then the server is gone.
    await other!.ask("assignCommander");
    await other!.kill();

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3, 30_000);
    await pause(500);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "A: Platform added",
      "A: Incident Commander",
    ]);
  });

  test("every message the killed server held goes out, in the order made, each once - the next one without another stalled turn", async () => {
    const STALLED_MS: number = 2000;
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: STALLED_MS,
    });

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    await other!.ask("assignCommander");
    await other!.ask("postAboutIncident", {
      markdown: "📝 Valeria posted a note on Incident INC-42.",
    });
    await other!.kill();

    await creating!.ask("resume");
    await created;
    await slack.waitFor(4, 30_000);
    await pause(500);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "A: Incident Commander",
      "A: a note",
      "A: Platform added",
    ]);

    // The first waited for the killed server's turn to stall; the second did not wait again.
    expect(
      creating!.heardAt[1]! - creating!.heardAt[0]!,
    ).toBeGreaterThanOrEqual(STALLED_MS - 500);
    expect(creating!.heardAt[2]! - creating!.heardAt[1]!).toBeLessThan(
      STALLED_MS - 500,
    );
  });

  test("a server passed over as stopped, that comes back, posts nothing twice: what it held was posted for it", async () => {
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: STALLED_MS,
    });

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    await other!.ask("assignCommander");

    // Alive, but frozen: it does not answer for longer than a turn may stall.
    other!.freeze();

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3, 30_000);

    // It comes back, and goes on asking about its message.
    other!.resume();
    await other!.ask("drained");
    await pause(1500);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "A: Incident Commander",
      "A: Platform added",
    ]);
  });

  test("a server that comes back while its message is being posted for it posts nothing twice", async () => {
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: STALLED_MS,
    });

    // Slack is slow to answer the message posted for the frozen server.
    slack.holding = (post: Post): boolean => {
      return (
        post.replica === "A" && describePost(post.text) === "Incident Commander"
      );
    };

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    await other!.ask("assignCommander");
    other!.freeze();

    await creating!.ask("resume");
    await slack.waitFor(2, 30_000);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "A: Incident Commander",
    ]);

    // Back while its message is still being posted for it.
    other!.resume();
    await other!.ask("drained");
    await pause(1000);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "A: Incident Commander",
    ]);

    creating!.releaseHeld();
    await created;
    await slack.waitFor(3, 20_000);
    await pause(500);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "A: Incident Commander",
      "A: Platform added",
    ]);
  });

  test("a waiting message is stored with what it says and nothing more, and once everything is out only its claims are left, each naming the server that posted it", async () => {
    const [creating, other] = await startServers(["A", "B"]);

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    await other!.ask("assignCommander");

    const line: Record<string, string> = await theLine();
    const stored: JSONObject = JSON.parse(line["message:1"] || "{}");

    expect(Object.keys(stored)).toEqual(["workspaceMarkdownNotification"]);

    const message: JSONObject = stored[
      "workspaceMarkdownNotification"
    ] as JSONObject;

    // The record, its project, its words and how it is posted: no token, no tenant's secret.
    expect(Object.keys(message).sort()).toEqual([
      "feedInfoInMarkdown",
      "notificationFor",
      "projectId",
      "workspaceNotification",
    ]);
    expect(String(message["feedInfoInMarkdown"])).toContain(
      "Incident Commander",
    );
    expect(line["message:1"]).not.toMatch(/xox[abpe]-|token|secret|password/i);

    // The message's own id, and the server that made it.
    expect(line["id:1"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(line["by:1"]).toMatch(/^[0-9a-f-]{36}$/);

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3);
    await other!.ask("drained");
    await pause(300);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "B: Incident Commander",
      "A: Platform added",
    ]);

    // The line, and what it stored, are gone with it.
    expect(await theLine()).toEqual({});

    // Each message's claim: the Incident Commander's by the server that made it, "Platform added" by the other.
    const claims: Array<string> = await theClaims();

    expect(claims).toHaveLength(2);
    expect(claims).toContain(line["by:1"]);
    expect(new Set(claims).size).toBe(2);
  });
});

/*
 * A MAINTENANCE EVENT'S OWNER LINES (#11223) AND A NEW ON-CALL POLICY'S
 * CREATOR (#11224), ACROSS SERVERS.
 *
 * A maintenance event's owner changes are posted now, and an on-call
 * policy is announced once its create has returned, after its creator is
 * its owner. Their lines take their place in the same line in Valkey as an
 * incident's messages: whichever server makes them, they follow the
 * record's Created message in the order they were made, each once, and a
 * server killed outright loses none of them (#11198, #11235).
 */
describe("a maintenance event's and an on-call policy's owner lines, across servers (#11223, #11224)", () => {
  const MAINTENANCE_LINE: string = "scheduledMaintenanceId";
  const POLICY_LINE: string = "onCallDutyPolicyId";

  test("REGRESSION (#11223): an owner added on another server while a maintenance event is created follows Scheduled Maintenance Created, as do the owners its form picked, each once", async () => {
    const [creating, other] = await startServers(["A", "B"], {
      eventType: NotificationRuleEventType.ScheduledMaintenance,
    });

    // A's create chain runs, and waits at its first state.
    const created: Promise<JSONObject> = creating!.ask(
      "createScheduledMaintenance",
      { pauseAtFirstState: true },
    );
    await creating!.paused();

    // Ravi is made an owner on the other server, as the event's page opens there.
    await other!.ask("addOwner", { kind: "scheduledMaintenance" });

    await pause(500);
    expect(slack.said()).toEqual([]);

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3);
    await other!.ask("drained", { kind: "scheduledMaintenance" });
    await pause(200);

    expect(slack.said()).toEqual([
      "A: Maintenance Created",
      "B: owner added",
      "A: Platform added",
    ]);
    expect(
      slack.posts.every((post: Post): boolean => {
        return post.channel === "C0EXIST";
      }),
    ).toBe(true);
    expect(await theLine(MAINTENANCE_LINE)).toEqual({});
  });

  test("REGRESSION (#11223): the other server is killed while its maintenance owner line waits: the creating server posts it, in its turn, once", async () => {
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      eventType: NotificationRuleEventType.ScheduledMaintenance,
      stalledAfterMs: STALLED_MS,
    });

    const created: Promise<JSONObject> = creating!.ask(
      "createScheduledMaintenance",
      { pauseAtFirstState: true },
    );
    await creating!.paused();

    // Its line takes the first place in the line, with what it says - then it is gone.
    await other!.ask("addOwner", { kind: "scheduledMaintenance" });
    expect((await theLine(MAINTENANCE_LINE))["message:1"]).toContain(
      "as the owner",
    );
    await other!.kill();

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3, 30_000);
    await creating!.ask("drained", { kind: "scheduledMaintenance" });
    await pause(500);

    expect(slack.said()).toEqual([
      "A: Maintenance Created",
      "A: owner added",
      "A: Platform added",
    ]);
  });

  test("REGRESSION (#11224): an on-call policy's creator, made its owner as the create returns, and an owner added on another server meanwhile, follow On-Call Policy Created, each once", async () => {
    const [creating, other] = await startServers(["A", "B"], {
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
    });

    /*
     * A's create returns, and its announcement waits for the owners added
     * outside its rules: it pauses there, before "On-Call Policy Created".
     */
    const created: Promise<JSONObject> = creating!.ask("createOnCallPolicy", {
      pauseBeforeCreated: true,
    });
    await creating!.paused();

    // The create has returned: its creator is its owner, and their line has its place.
    await waitUntil("the creator's line has its ticket", async () => {
      return Number((await theLine(POLICY_LINE))["tickets"] || 0) >= 1;
    });

    // Then Ravi is made an owner on the other server.
    await other!.ask("addOwner", { kind: "onCallPolicy" });

    await pause(500);
    expect(slack.said()).toEqual([]);

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3);
    await other!.ask("drained", { kind: "onCallPolicy" });
    await pause(200);

    expect(slack.said()).toEqual([
      "A: Policy Created",
      "A: owner added",
      "B: owner added",
    ]);
    expect(await theLine(POLICY_LINE)).toEqual({});
  });

  test("REGRESSION (#11224, #11314): the server announcing an on-call policy is killed while its creator's line waits: the other server posts it once the killed server has said nothing for STALLED_AFTER_MS, long before the hold runs out", async () => {
    const HELD_MS: number = 120_000;
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      heldForAtMostMs: HELD_MS,
      releasedForAtMostMs: 30_000,
      stalledAfterMs: STALLED_MS,
    });

    void creating!
      .ask("createOnCallPolicy", { pauseBeforeCreated: true })
      .catch((): void => {
        // It is killed below.
      });
    await creating!.paused();

    // The creator's line has its place in the line, with what it says.
    await waitUntil(
      "the creator's line is stored with its ticket",
      async () => {
        return Boolean((await theLine(POLICY_LINE))["message:1"]);
      },
    );

    // Killed with the policy unannounced: "On-Call Policy Created" never goes out.
    await creating!.kill();
    const killedAt: number = Date.now();

    await slack.waitFor(1, 40_000);
    await pause(1000);

    // The other server, with no message of its own in the line, posts it.
    expect(slack.said()).toEqual(["B: owner added"]);

    const postedAfter: number = other!.heardAt[0]! - killedAt;

    expect(postedAfter).toBeGreaterThanOrEqual(
      STALLED_MS - creating!.times!.keptEveryMs - 500,
    );
    expect(postedAfter).toBeLessThan(HELD_MS / 10);
  });
});

/*
 * THE SERVER RUNNING A CREATE CHAIN SAYS IT STILL HOLDS THE RECORD'S LINE
 * (#11314).
 *
 * A server killed outright before its record's Created message used to
 * hold every other message about the record for the whole of its hold -
 * five minutes - before the other servers posted them. Now it says it
 * still holds the line every KEPT_EVERY_MS, on a timer of its own, and once
 * it has said nothing for STALLED_AFTER_MS another server moves the line on
 * and posts what it held, in order, once. Here with the times every App
 * server runs with (realTimes): about 15 seconds, at most the time a look
 * after the lines takes more. A server that is only slow, or frozen for
 * less than that and resumed, keeps its line.
 */
describe("the server running the create chain says it still holds the record's line (#11314)", () => {
  // How long after its holder was killed a line may move on at the earliest and at the latest.
  function window(times: ReplicaTimes): { from: number; to: number } {
    return {
      // It said it holds the line KEPT_EVERY_MS before it was killed, at the most.
      from: times.stalledAfterMs - times.keptEveryMs - 1000,
      // And the look that finds it stopped comes LOOKED_AFTER_EVERY_MS after, at the most.
      to: times.stalledAfterMs + times.lookedAfterEveryMs + 2000,
    };
  }

  test("REGRESSION (#11314): SIGKILLed before Incident Created, with the other server's message waiting: within about 15 seconds the other server posts the killed server's message and its own, in order, each once - not after five minutes", async () => {
    const [creating, other] = await startServers(["A", "B"], {
      realTimes: true,
    });
    const times: ReplicaTimes = other!.times!;

    // The times every App server runs with: a five-minute hold, fifteen seconds to stall.
    expect(times.heldForAtMostMs).toBe(5 * 60 * 1000);
    expect(times.stalledAfterMs).toBe(15 * 1000);

    void creating!
      .ask("createIncident", { pauseBeforeCreated: true })
      .catch((): void => {
        // It is killed below.
      });
    await creating!.paused();

    // "Added team Platform to the Incident as the owner" waits first, then the Incident Commander.
    await waitUntil("the owner message has its ticket", async () => {
      return Number((await theLine())["tickets"] || 0) >= 1;
    });
    await other!.ask("assignCommander");

    // Killed outright, its chain half way: no "Incident Created", and no word more.
    await creating!.kill();
    const killedAt: number = Date.now();

    await slack.waitFor(2, 60_000);
    await other!.ask("drained");
    await pause(1000);

    expect(slack.said()).toEqual([
      "B: Platform added",
      "B: Incident Commander",
    ]);

    const postedAfter: number = other!.heardAt[0]! - killedAt;

    expect(postedAfter).toBeGreaterThanOrEqual(window(times).from);
    expect(postedAfter).toBeLessThanOrEqual(window(times).to);

    // The line is over, and each message claimed once: the take-over's, and B's own.
    expect(await theLine()).toEqual({});
    expect(await theClaims()).toHaveLength(2);
  });

  test("REGRESSION (#11314): SIGKILLed before Incident Created with only its own message waiting: the other server, looking after the lines, posts it within about 15 to 20 seconds, once", async () => {
    const [creating, other] = await startServers(["A", "B"], {
      realTimes: true,
    });
    const times: ReplicaTimes = other!.times!;

    void creating!
      .ask("createIncident", { pauseBeforeCreated: true })
      .catch((): void => {
        // It is killed below.
      });
    await creating!.paused();

    await waitUntil("the owner message is stored with its ticket", async () => {
      return Boolean((await theLine())["message:1"]);
    });

    await creating!.kill();
    const killedAt: number = Date.now();

    await slack.waitFor(1, 60_000);
    await pause(1000);

    expect(slack.said()).toEqual(["B: Platform added"]);

    const postedAfter: number = other!.heardAt[0]! - killedAt;

    expect(postedAfter).toBeGreaterThanOrEqual(window(times).from);
    expect(postedAfter).toBeLessThanOrEqual(window(times).to);
    expect(await theLine()).toEqual({});
  });

  test("SIGSTOPped for less than STALLED_AFTER_MS and resumed, it keeps its line: Incident Created first, then what was said meanwhile, in order, each once", async () => {
    const STALLED_MS: number = 3000;
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: STALLED_MS,
    });

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    await other!.ask("assignCommander");

    // Frozen - a long pause, a stalled VM - for half of what its line allows, then back.
    creating!.freeze();
    await pause(STALLED_MS / 2);
    creating!.resume();

    // Well past when it would have stopped, had it not said so again.
    await pause(STALLED_MS * 2);

    expect(slack.said()).toEqual([]);
    expect((await theLine())["released"]).toBe("0");

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3);
    await other!.ask("drained");
    await pause(300);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "B: Incident Commander",
      "A: Platform added",
    ]);
  });

  test("a create chain that is only slow - alive, waiting three times as long as a holder may say nothing - is never cut short: Incident Created comes first", async () => {
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: STALLED_MS,
    });

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    await other!.ask("assignCommander");

    await pause(STALLED_MS * 3);

    expect(slack.said()).toEqual([]);
    expect((await theLine())["released"]).toBe("0");

    await creating!.ask("resume");
    await created;
    await slack.waitFor(3);
    await other!.ask("drained");
    await pause(300);

    expect(slack.said()).toEqual([
      "A: Incident Created",
      "B: Incident Commander",
      "A: Platform added",
    ]);
  });

  test("SIGSTOPped past STALLED_AFTER_MS: what it held is posted for it, in order, once; resumed, it posts none of it again, and its Incident Created comes after", async () => {
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: STALLED_MS,
    });

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseBeforeCreated: true,
    });
    await creating!.paused();

    await waitUntil("the owner message has its ticket", async () => {
      return Number((await theLine())["tickets"] || 0) >= 1;
    });
    await other!.ask("assignCommander");

    creating!.freeze();

    await slack.waitFor(2, 30_000);
    await other!.ask("drained");

    expect(slack.said()).toEqual([
      "B: Platform added",
      "B: Incident Commander",
    ]);

    // It comes back, and its chain goes on to Incident Created.
    creating!.resume();
    await creating!.ask("resume");
    await created;
    await slack.waitFor(3, 20_000);
    await creating!.ask("drained");
    await pause(1000);

    expect(slack.said()).toEqual([
      "B: Platform added",
      "B: Incident Commander",
      "A: Incident Created",
    ]);
  });
});
