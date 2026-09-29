import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  DatabaseHarness,
  databaseHarness,
  runRead,
  runWrite,
  stdoutOf,
} from "./Helpers/DatabaseHarness";
import {
  FakeDrivers,
  FakeRedisConnection,
  driverError,
} from "./Helpers/FakeDatabase";
import {
  describeRedisError,
  parseRedisClientList,
  parseRedisInfo,
  redisPairs,
} from "../Executors/Database/RedisDiagnostics";
import { DATABASE_AI_AGENT_APPLICATION_NAME } from "../Executors/Database/DiagnosticTypes";
import {
  ExecResult,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";

/*
 * The db catalog on Redis and its drop-ins: exactly which commands each
 * operation sends (read commands only, arguments as separate words), what
 * prints, and CLIENT KILL with every check before it.
 */

type Replies = Record<string, unknown>;

const CLIENTS: string = [
  "id=3 addr=10.0.0.8:50000 laddr=10.0.0.2:6379 fd=8 name=worker age=900 idle=0 flags=b db=0 sub=0 psub=0 cmd=blpop user=app",
  "id=9 addr=10.0.0.9:50001 laddr=10.0.0.2:6379 fd=9 name= age=100 idle=50 flags=N db=2 sub=0 psub=0 cmd=get user=default",
  "id=11 addr=10.0.0.10:50002 laddr=10.0.0.2:6379 fd=10 name= age=10 idle=5 flags=S db=0 sub=0 psub=0 cmd=replconf user=repl",
  "id=12 addr=10.0.0.3:40000 laddr=10.0.0.2:6379 fd=11 name=oneuptime-database-ai-agent age=0 idle=0 flags=N db=0 sub=0 psub=0 cmd=client|list user=default",
  "",
].join("\n");

// A server that answers "NAME ARG ARG" lines from the table (a function per line, or a value).
function harness(
  replies: Replies = {},
  env: Record<string, string> = {},
  system: string = "redis",
): DatabaseHarness {
  const redis: FakeRedisConnection = new FakeRedisConnection(
    (name: string, args: ReadonlyArray<string>): unknown => {
      const line: string = [name, ...args].join(" ");

      if (Object.prototype.hasOwnProperty.call(replies, line)) {
        const reply: unknown = replies[line];
        return typeof reply === "function" ? (reply as () => unknown)() : reply;
      }

      if (line === "CLIENT ID") {
        return 12;
      }

      if (line === "CLIENT LIST") {
        return CLIENTS;
      }

      return "OK";
    },
  );

  return databaseHarness({
    engine: "redis",
    env: { DATABASE_SYSTEM: system, ...env },
    drivers: new FakeDrivers(undefined, redis),
  });
}

const WRITES_ON: Record<string, string> = { ONEUPTIME_AI_ALLOW_WRITES: "true" };

describe("each read", () => {
  test("ping and version", async () => {
    const h: DatabaseHarness = harness({
      PING: "PONG",
      "INFO server":
        "# Server\r\nredis_version:7.2.4\r\nredis_mode:standalone\r\nos:Linux\r\nrun_id:abc\r\nuptime_in_seconds:60\r\n",
    });

    assert.strictEqual(
      stdoutOf(await runRead(h, "db ping")),
      "status: ok (Redis answered PING with PONG)",
    );
    assert.strictEqual(
      stdoutOf(await runRead(h, "db version")),
      "redis_version:     7.2.4\nredis_mode:        standalone\nos:                Linux\nuptime_in_seconds: 60",
    );
    assert.deepStrictEqual(h.drivers.redis.lines(), ["PING", "INFO server"]);
  });

  test("sessions: CLIENT ID and CLIENT LIST; the agent's own left out, most recently active first", async () => {
    const h: DatabaseHarness = harness();
    const out: string = stdoutOf(await runRead(h, "db sessions"));

    assert.deepStrictEqual(h.drivers.redis.lines(), [
      "CLIENT ID",
      "CLIENT LIST",
    ]);
    assert.strictEqual(
      out,
      [
        "ID   ADDRESS           NAME     USER      DB   AGE_S   IDLE_S   FLAGS   LAST_COMMAND",
        "3    10.0.0.8:50000    worker   app       0    900     0        b       blpop",
        "11   10.0.0.10:50002   -        repl      0    10      5        S       replconf",
        "9    10.0.0.9:50001    -        default   2    100     50       N       get",
      ].join("\n"),
    );
  });

  test("sessions: --user, --database (a number) and --limit filter in the agent", async () => {
    const byUser: string = stdoutOf(
      await runRead(harness(), "db sessions --user default"),
    );
    assert.match(byUser, /^9 /m);
    assert.doesNotMatch(byUser, /^3 /m);

    const byDb: string = stdoutOf(
      await runRead(harness(), "db sessions --database 2"),
    );
    assert.strictEqual(byDb.split("\n").length, 2);

    const limited: string = stdoutOf(
      await runRead(harness(), "db sessions --limit 1"),
    );
    assert.match(
      limited,
      /\n\nShowing the first 1 rows; there are more\. Raise --limit \(at most 200\) or narrow with --user or --database\.$/,
    );
  });

  test("replication and info print what INFO says", async () => {
    const h: DatabaseHarness = harness({
      "INFO replication":
        "# Replication\r\nrole:master\r\nconnected_slaves:1\r\n",
      "INFO commandstats": "# Commandstats\r\ncmdstat_get:calls=10,usec=20\r\n",
      INFO: "# Server\r\nredis_version:7.2.4\r\n",
    });

    assert.strictEqual(
      stdoutOf(await runRead(h, "db replication")),
      "role:             master\nconnected_slaves: 1",
    );
    assert.strictEqual(
      stdoutOf(await runRead(h, "db info commandstats")),
      "# Commandstats\ncmdstat_get:calls=10,usec=20",
    );
    assert.strictEqual(
      stdoutOf(await runRead(h, "db info")),
      "# Server\nredis_version:7.2.4",
    );
  });

  test("connections: INFO clients, maxclients from CONFIG GET when INFO lacks it, clients grouped", async () => {
    const h: DatabaseHarness = harness({
      "INFO clients":
        "# Clients\r\nconnected_clients:4\r\nblocked_clients:1\r\n",
      "CONFIG GET maxclients": ["maxclients", "10000"],
    });
    const out: string = stdoutOf(await runRead(h, "db connections"));

    assert.deepStrictEqual(h.drivers.redis.lines(), [
      "INFO clients",
      "CONFIG GET maxclients",
      "CLIENT LIST",
    ]);
    assert.match(out, /^maxclients:\s+10000$/m);
    assert.match(
      out,
      /\n\nClients by user and database:\nUSER {6}DB {3}CONNECTIONS\napp {7}0 {4}1\ndefault {3}2 {4}1\ndefault {3}0 {4}1\nrepl {6}0 {4}1$/,
    );

    const denied: DatabaseHarness = harness({
      "INFO clients": "# Clients\r\nconnected_clients:4\r\n",
      "CONFIG GET maxclients": driverError(
        "NOPERM this user has no permissions to run the 'config|get' command",
      ),
    });
    assert.match(
      stdoutOf(await runRead(denied, "db connections")),
      /^maxclients:\s+\(unknown: this user may not run CONFIG GET\)$/m,
    );

    const current: DatabaseHarness = harness({
      "INFO clients": "# Clients\r\nconnected_clients:4\r\nmaxclients:500\r\n",
    });
    await runRead(current, "db connections");
    assert.ok(!current.drivers.redis.lines().includes("CONFIG GET maxclients"));
  });

  test("settings: CONFIG GET name as its own word; every one sorted, credentials never shown", async () => {
    const h: DatabaseHarness = harness({
      "CONFIG GET maxmemory-policy": ["maxmemory-policy", "allkeys-lru"],
      "CONFIG GET *": [
        "requirepass",
        "hunter2",
        "maxmemory",
        "0",
        "masterauth",
        "hunter3",
        "appendonly",
        "no",
      ],
      "CONFIG GET no-such": [],
    });

    assert.strictEqual(
      stdoutOf(await runRead(h, "db settings maxmemory-policy")),
      "name:  maxmemory-policy\nvalue: allkeys-lru",
    );

    const all: ExecResult = await runRead(h, "db settings");
    assert.strictEqual(
      stdoutOf(all),
      "NAME         VALUE\nappendonly   no\nmaxmemory    0\n\n2 credential parameter(s) are not shown.",
    );
    assert.ok(!all.output.includes("hunter"));

    const unknown: ExecResult = await runRead(h, "db settings no-such");
    assert.strictEqual(unknown.exitCode, 1);
    assert.strictEqual(
      unknown.errorMessage,
      'Redis has no parameter named "no-such" (db settings with no name prints every one).',
    );
  });

  test("slowlog: SLOWLOG GET N; arguments as a JSON array, so AUTH secrets and written values are masked", async () => {
    const h: DatabaseHarness = harness({
      "SLOWLOG GET 5": [
        [
          14,
          1790000000,
          15000,
          ["AUTH", "app", "hunter2"],
          "10.0.0.8:50000",
          "worker",
        ],
        [
          13,
          1790000000,
          2500,
          ["SET", "session:1", "eyJhbGciOiJIUzI1NiJ9.secret"],
          "10.0.0.8:50000",
          "",
        ],
        [12, 1790000000, 1200, ["KEYS", "*"], "10.0.0.9:1", ""],
      ],
    });
    const result: ExecResult = await runRead(h, "db slowlog --limit 5");
    const out: string = stdoutOf(result);

    assert.ok(!out.includes("hunter2"), out);
    assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9"), out);
    assert.match(
      out,
      /^14 {3}2026-09-21T14:13:20\.000Z {3}15\.000\s+10\.0\.0\.8:50000 {3}worker {3}\["AUTH","\[redacted\]","\[redacted\]"\]$/m,
    );
    assert.match(out, /\["SET","session:1","\[redacted\]"\]$/m);
    assert.match(out, /\["KEYS","\*"\]$/m);
  });

  test("memory: INFO memory and MEMORY STATS flattened; a server without MEMORY STATS says so", async () => {
    const h: DatabaseHarness = harness({
      "INFO memory": "# Memory\r\nused_memory:1024\r\nmaxmemory:0\r\n",
      "MEMORY STATS": [
        "peak.allocated",
        2048,
        "db.0",
        ["overhead.hashtable.main", 72, "overhead.hashtable.expires", 0],
        "fragmentation",
        "1.5",
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db memory"));

    assert.match(out, /^used_memory:\s+1024$/m);
    assert.match(
      out,
      /^MEMORY STATS:\npeak\.allocated:\s+2048\ndb\.0\.overhead\.hashtable\.main:\s+72$/m,
    );

    const dragonfly: DatabaseHarness = harness(
      {
        "INFO memory": "# Memory\r\nused_memory:1\r\n",
        "MEMORY STATS": driverError("ERR unknown subcommand 'STATS'"),
      },
      {},
      "dragonfly",
    );
    assert.match(
      stdoutOf(await runRead(dragonfly, "db memory")),
      // The quoted word reads as a literal to the redactor, and is masked.
      /MEMORY STATS is not available here \(ERR unknown subcommand '\?'\)\.$/,
    );
  });

  test("keyspace: each database's keys, expiring keys and average TTL, and DBSIZE", async () => {
    const h: DatabaseHarness = harness({
      "INFO keyspace":
        "# Keyspace\r\ndb0:keys=10,expires=2,avg_ttl=3000\r\ndb3:keys=1,expires=0,avg_ttl=0,subexpiry=0\r\n",
      DBSIZE: 10,
    });

    assert.strictEqual(
      stdoutOf(await runRead(h, "db keyspace")),
      [
        "DB    KEYS   EXPIRES   AVG_TTL_MS",
        "db0   10     2         3000",
        "db3   1      0         0",
        "",
        "DBSIZE of db0 (the database the agent connects to): 10 keys.",
      ].join("\n"),
    );
  });
});

describe("terminate-session", () => {
  test("its own id, the target by CLIENT LIST ID, CLIENT KILL ID with the id as its own word, a second look", async () => {
    let lookups: number = 0;
    const h: DatabaseHarness = harness(
      {
        "CLIENT LIST ID 3": (): string => {
          lookups++;
          return lookups === 1 ? (CLIENTS.split("\n")[0] as string) : "";
        },
        "CLIENT KILL ID 3": 1,
      },
      WRITES_ON,
    );
    const result: ExecResult = await runWrite(h, "db terminate-session 3");

    assert.deepStrictEqual(h.drivers.redis.lines(), [
      "CLIENT ID",
      "CLIENT LIST ID 3",
      "CLIENT KILL ID 3",
      "CLIENT LIST ID 3",
    ]);
    assert.deepStrictEqual(h.drivers.redis.commands[2], [
      "CLIENT",
      "KILL",
      "ID",
      "3",
    ]);
    assert.deepStrictEqual(h.sleeps, [250]);
    assert.strictEqual(
      stdoutOf(result),
      [
        "Disconnected client 3 (CLIENT KILL ID). A client that reconnects gets a new id.",
        "",
        "The client, before:",
        "id:           3",
        "address:      10.0.0.8:50000",
        "name:         worker",
        "user:         app",
        "db:           0",
        "age_s:        900",
        "idle_s:       0",
        "flags:        b",
        "last_command: blpop",
        "",
        "Client 3 is gone.",
      ].join("\n"),
    );
  });

  test("an older server without CLIENT LIST ID: the whole list is read instead", async () => {
    const h: DatabaseHarness = harness(
      {
        "CLIENT LIST ID 9": driverError("ERR syntax error"),
        "CLIENT KILL ID 9": 1,
      },
      WRITES_ON,
    );
    const result: ExecResult = await runWrite(h, "db terminate-session 9");

    assert.strictEqual(result.exitCode, 0);
    assert.deepStrictEqual(h.drivers.redis.lines(), [
      "CLIENT ID",
      "CLIENT LIST ID 9",
      "CLIENT LIST",
      "CLIENT KILL ID 9",
      "CLIENT LIST ID 9",
      "CLIENT LIST",
    ]);
    assert.match(
      stdoutOf(result),
      /Client 9 is still listed; Redis may take a moment to close it\.$/,
    );
  });

  test("never its own connection, another of the agent's, a replication link, or a client that is not there", async () => {
    const cases: Array<[Replies, string, string]> = [
      [
        { "CLIENT ID": 3 },
        "db terminate-session 3",
        "Refused by the Database AI agent: client 3 is the agent's own connection (session:3); it never kills itself.",
      ],
      [
        { "CLIENT LIST ID 12": CLIENTS.split("\n")[3] },
        "db terminate-session 12",
        `Refused by the Database AI agent: client 12 is another connection of the Database AI agent (${DATABASE_AI_AGENT_APPLICATION_NAME}); it never kills its own connections.`,
      ],
      [
        { "CLIENT LIST ID 11": CLIENTS.split("\n")[2] },
        "db terminate-session 11",
        "Refused by the Database AI agent: client 11 is a replication link (flags=S), not a client session: db terminate-session never breaks replication.",
      ],
      [
        { "CLIENT LIST ID 44": "" },
        "db terminate-session 44",
        "Redis has no client with id 44 (it may have disconnected already). Run db sessions to see the current ones; nothing was changed.",
      ],
    ];

    for (const [replies, command, message] of cases) {
      const h: DatabaseHarness = harness(
        { "CLIENT ID": 99, ...replies },
        WRITES_ON,
      );
      const result: ExecResult = await runWrite(h, command);

      assert.deepStrictEqual(result, {
        success: false,
        output: "",
        errorMessage: message,
      });
      assert.ok(
        !h.drivers.redis.lines().some((line: string): boolean => {
          return line.startsWith("CLIENT KILL");
        }),
        command,
      );
    }
  });

  test("a kill that disconnected nobody is a failure", async () => {
    const result: ExecResult = await runWrite(
      harness(
        { "CLIENT LIST ID 3": CLIENTS.split("\n")[0], "CLIENT KILL ID 3": 0 },
        WRITES_ON,
      ),
      "db terminate-session 3",
    );

    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.errorMessage,
      "Redis disconnected no client: client 3 ended before the kill arrived.",
    );
  });
});

describe("the posture and errors", () => {
  test("the version a fork reports: Valkey, Dragonfly; a user without INFO is still reachable", async () => {
    const valkey: DatabaseHarness = harness(
      {
        PING: "PONG",
        "INFO server":
          "# Server\r\nredis_version:7.2.4\r\nserver_name:valkey\r\nvalkey_version:8.0.1\r\nserver_mode:standalone\r\n",
      },
      {},
      "valkey",
    );
    const probe: ResourcePostureProbe = await valkey.executor.probePosture();
    assert.strictEqual(probe.toolVersion, "Valkey 8.0.1");
    assert.strictEqual(probe.details?.["redisMode"], "standalone");

    const noInfo: DatabaseHarness = harness({
      PING: "PONG",
      "INFO server": driverError(
        "NOPERM this user has no permissions to run the 'info' command",
      ),
    });
    const bare: ResourcePostureProbe = await noInfo.executor.probePosture();
    assert.strictEqual(bare.reachable, true);
    assert.strictEqual(bare.toolVersion, "Redis");
  });

  test("describeRedisError reads Redis's error words", () => {
    const data: {
      username: string;
      credentialSource: string;
      serverName: string;
    } = {
      username: "ai",
      credentialSource: "DATABASE_USERNAME/DATABASE_PASSWORD",
      serverName: "Redis",
    };
    const cases: Array<[string, RegExp]> = [
      [
        "NOAUTH Authentication required.",
        /^Redis needs a password .* Set DATABASE_USERNAME\/DATABASE_PASSWORD\.$/,
      ],
      [
        "WRONGPASS invalid username-password pair or user is disabled.",
        /^Redis refused the login "ai"/,
      ],
      ["ERR invalid password", /^Redis refused the login/],
      [
        "NOPERM this user has no permissions to run the 'client|kill' command",
        /\+client\|kill to end sessions\.$/,
      ],
      ["ERR unknown command 'MEMORY'", /does not have that command/],
      [
        "LOADING Redis is loading the dataset in memory",
        /is loading its dataset/,
      ],
    ];

    for (const [message, pattern] of cases) {
      assert.match(
        String(describeRedisError(new Error(message), data)),
        pattern,
        message,
      );
    }

    assert.strictEqual(
      describeRedisError(new Error("ERR something"), data),
      null,
    );
  });

  test("the parsers never throw and read what Redis prints", () => {
    assert.deepStrictEqual(
      parseRedisInfo("# Server\r\na:1\r\nb:x:y\r\n\r\n# Clients\r\nc:2"),
      {
        server: { a: "1", b: "x:y" },
        clients: { c: "2" },
      },
    );
    assert.deepStrictEqual(parseRedisInfo(null), {});
    assert.deepStrictEqual(
      parseRedisClientList("id=1 name= cmd=get\nnot a client\n"),
      [{ id: "1", name: "", cmd: "get" }],
    );
    assert.deepStrictEqual(redisPairs(["a", "1", "b"]), [["a", "1"]]);
    assert.deepStrictEqual(redisPairs({ a: 1 }), [["a", 1]]);
    assert.deepStrictEqual(redisPairs("x"), []);
  });
});
