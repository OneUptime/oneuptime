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
  private waiters: Array<() => void> = [];

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
  }
}

// What a post is, from its text.
function describePost(text: string): string {
  if (text.includes("Incident INC-42 Created")) {
    return "Incident Created";
  }

  if (text.includes("Incident Commander")) {
    return "Incident Commander";
  }

  if (text.includes("Added team") && text.includes("Platform")) {
    return "Platform added";
  }

  if (text.includes("Valeria posted a note")) {
    return "a note";
  }

  return text.slice(0, 80);
}

// An App server: a process of its own, asked over its IPC channel.
class Replica {
  public stderr: string = "";
  public exited: Promise<number | null>;
  public heardAt: Array<number> = [];

  private nextId: number = 1;
  private answers: Map<
    number,
    { resolve: (result: JSONObject) => void; reject: (error: Error) => void }
  > = new Map();
  private pausedWaiters: Array<() => void> = [];
  private readyWaiters: Array<() => void> = [];
  private isReady: boolean = false;
  private hasPaused: boolean = false;

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
    started.map((replica: Replica): Promise<JSONObject> => {
      return replica.ask("setUp", { keyPrefix: KEY_PREFIX, ...times });
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

beforeAll(async () => {
  inspector = connection();
  await inspector.connect();
});

afterEach(async () => {
  for (const replica of replicas) {
    if (replica.isRunning()) {
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

  test("the other server stops while its message waits: the creating server's messages go on once its turn has stalled", async () => {
    const STALLED_MS: number = 1500;
    const [creating, other] = await startServers(["A", "B"], {
      stalledAfterMs: STALLED_MS,
    });

    const created: Promise<JSONObject> = creating!.ask("createIncident", {
      pauseAtFirstState: true,
    });
    await creating!.paused();

    // Its message takes the first place in the line - then it is gone.
    await other!.ask("assignCommander");
    await other!.kill();

    await creating!.ask("resume");
    await created;
    await slack.waitFor(2, 30_000);

    expect(slack.said()).toEqual(["A: Incident Created", "A: Platform added"]);

    // The owner waited for the stopped server's turn to stall.
    expect(
      creating!.heardAt[1]! - creating!.heardAt[0]!,
    ).toBeGreaterThanOrEqual(STALLED_MS - 500);
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
