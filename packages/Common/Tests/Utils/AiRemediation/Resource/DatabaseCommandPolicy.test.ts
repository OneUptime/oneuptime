import DatabaseCommandPolicy, {
  databaseSessionTarget,
  getDatabaseReadCommandGuide as reExportedReadGuide,
  getDatabaseWriteCommandGuide as reExportedWriteGuide,
} from "../../../../Utils/AiRemediation/Resource/DatabaseCommandPolicy";
import {
  DATABASE_DIAGNOSTIC_OPERATIONS,
  DatabaseOperationSpec,
  getDatabaseReadCommandGuide,
  getDatabaseWriteCommandGuide,
} from "../../../../Utils/AiRemediation/Resource/DatabaseDiagnosticCatalog";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  MAX_RESOURCE_COMMAND_TOKENS,
  RESOURCE_SHELL_SYNTAX_RULE,
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  AiRemediationCommandPolicyVerdict,
  MAX_COMMAND_LENGTH_CHARS,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — DatabaseCommandPolicy, the tier of every `db`
 * command OneUptime AI composes for a database server.
 *
 * - The grammar: `db <operation> [argument] [--flag value|--flag=value]`,
 *   the operation first and spelled exactly, long flags only, every flag a
 *   typed value that never swallows a flag-looking word, "--" ending the
 *   flags, no duplicates, no unknown or connection flags.
 * - Read: every catalog diagnostic. SafeWrite: `db cancel-query ID`.
 *   RiskyWrite: `db terminate-session ID`. The target is `session:ID`.
 * - Denied: free SQL / commands / scripts, every other change, unknown
 *   operations and flags, bad values, look-alike characters, shell syntax,
 *   the wrong program — each with a reason that says what IS available.
 * - The args and displayCommand are the canonical argv, a fixed point.
 * - Totality, and the dispatcher's ladder / allowlist / write scope and
 *   guides for DatabaseServer.
 */

const DATABASE: AiResourceType = AiResourceType.DatabaseServer;

function db(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: DATABASE,
    command,
  });
}

function direct(argv: unknown): ResourceCommandPolicyResult {
  return DatabaseCommandPolicy.evaluateArgv(argv as Array<string>);
}

function autoExecution(
  command: string,
  options: { allowlistPatterns?: Array<string>; bypassApproval?: boolean } = {},
): ResourceAutoExecutionVerdict {
  return ResourceCommandPolicy.evaluateForAutoExecution({
    resourceType: DATABASE,
    command,
    allowlistPatterns: options.allowlistPatterns || [],
    bypassApproval: options.bypassApproval === true,
  });
}

function expectDenied(command: string, mentions: string): void {
  const result: ResourceCommandPolicyResult = db(command);

  expect(result.tier).toBe(ResourceCommandTier.Denied);
  expect(result.targets).toEqual([]);
  expect(result.reason).toContain(mentions);
  expect(
    ResourceCommandPolicy.isReadOnly({ resourceType: DATABASE, command }),
  ).toBe(false);
}

describe("the db tool policy", () => {
  test("is the DatabaseServer policy, named db, running only db", () => {
    expect(ResourceCommandPolicy.getToolPolicy(DATABASE)).toBe(
      DatabaseCommandPolicy,
    );
    expect(DatabaseCommandPolicy.name).toBe("db");
    expect([...DatabaseCommandPolicy.programs]).toEqual(["db"]);
    expect([...DatabaseCommandPolicy.programs]).toEqual([
      ...AI_RESOURCE_TYPE_INFO[DATABASE].programs,
    ]);
  });

  test("Test connection runs only Read commands", () => {
    for (const command of AI_RESOURCE_TYPE_INFO[DATABASE].testCommands) {
      expect(db(command).tier).toBe(ResourceCommandTier.Read);
      expect(
        ResourceCommandPolicy.isReadOnly({ resourceType: DATABASE, command }),
      ).toBe(true);
    }
  });

  test("session targets are session:ID", () => {
    expect(databaseSessionTarget(42)).toBe("session:42");
    expect(databaseSessionTarget("7")).toBe("session:7");
  });
});

describe("Read: every diagnostic in the catalog", () => {
  test.each([
    ["db ping", "ping", "db ping"],
    ["db version", "version", "db version"],
    ["db sessions", "sessions", "db sessions"],
    ["db sessions --limit 10", "sessions", "db sessions --limit 10"],
    ["db sessions --limit=10", "sessions", "db sessions --limit 10"],
    ["db sessions --limit 1", "sessions", "db sessions --limit 1"],
    ["db sessions --limit 200", "sessions", "db sessions --limit 200"],
    ["db sessions --state active", "sessions", "db sessions --state active"],
    ["db sessions --state=idle", "sessions", "db sessions --state idle"],
    [
      "db sessions --state idle-in-transaction",
      "sessions",
      "db sessions --state idle-in-transaction",
    ],
    [
      "db sessions --user app_user --database orders",
      "sessions",
      "db sessions --user app_user --database orders",
    ],
    ["db sessions --database 0", "sessions", "db sessions --database 0"],
    [
      "db sessions --user svc.reporting$1 --database my-db",
      "sessions",
      "db sessions --user 'svc.reporting$1' --database my-db",
    ],
    [
      "db sessions --database=orders --limit 200 --state idle --user bob",
      "sessions",
      "db sessions --limit 200 --state idle --user bob --database orders",
    ],
    ["db current-ops", "sessions", "db sessions"],
    ["db current-ops --limit 5", "sessions", "db sessions --limit 5"],
    ["db long-queries", "long-queries", "db long-queries"],
    [
      "db long-queries --min-seconds 30",
      "long-queries",
      "db long-queries --min-seconds 30",
    ],
    [
      "db long-queries --limit 1 --min-seconds=0",
      "long-queries",
      "db long-queries --min-seconds 0 --limit 1",
    ],
    [
      "db long-queries --min-seconds 86400",
      "long-queries",
      "db long-queries --min-seconds 86400",
    ],
    ["db blocking", "blocking", "db blocking"],
    ["db blocking --limit 20", "blocking", "db blocking --limit 20"],
    ["db locks", "locks", "db locks"],
    ["db locks --limit=200", "locks", "db locks --limit 200"],
    ["db replication", "replication", "db replication"],
    ["db connections", "connections", "db connections"],
    ["db database-sizes", "database-sizes", "db database-sizes"],
    ["db table-sizes", "table-sizes", "db table-sizes"],
    [
      "db table-sizes --limit 25 --database app",
      "table-sizes",
      "db table-sizes --database app --limit 25",
    ],
    ["db top-statements", "top-statements", "db top-statements"],
    [
      "db top-statements --limit 20",
      "top-statements",
      "db top-statements --limit 20",
    ],
    ["db settings", "settings", "db settings"],
    ["db settings work_mem", "settings", "db settings work_mem"],
    ["db settings max_connections", "settings", "db settings max_connections"],
    [
      "db settings maxmemory-policy",
      "settings",
      "db settings maxmemory-policy",
    ],
    [
      "db settings maxIncomingConnections",
      "settings",
      "db settings maxIncomingConnections",
    ],
    [
      "db settings pg_stat_statements.max",
      "settings",
      "db settings pg_stat_statements.max",
    ],
    ["db settings -- work_mem", "settings", "db settings work_mem"],
    ["db slowlog", "slowlog", "db slowlog"],
    ["db slowlog --limit 10", "slowlog", "db slowlog --limit 10"],
    ["db info", "info", "db info"],
    ["db info memory", "info", "db info memory"],
    ["db info commandstats", "info", "db info commandstats"],
    ["db info globalLock", "info", "db info globalLock"],
    ["db info wiredTiger", "info", "db info wiredTiger"],
    ["db innodb-status", "innodb-status", "db innodb-status"],
    ["db memory", "memory", "db memory"],
    ["db keyspace", "keyspace", "db keyspace"],
    ["db ping --", "ping", "db ping"],
    ["db 'sessions' '--limit' '5'", "sessions", "db sessions --limit 5"],
    ['db "settings" "work_mem"', "settings", "db settings work_mem"],
  ])("%s", (command: string, verb: string, display: string) => {
    const result: ResourceCommandPolicyResult = db(command);

    expect(result.tier).toBe(ResourceCommandTier.Read);
    expect(result.verb).toBe(verb);
    expect(result.program).toBe("db");
    expect(result.displayCommand).toBe(display);
    expect(result.args).toEqual(
      tokenizeResourceCommand(display).argv!.slice(1),
    );
    expect(result.targets).toEqual([]);
    expect(result.requiresHuman).toBeUndefined();
    expect(result.reason).toContain("read-only");
    expect(
      ResourceCommandPolicy.isReadOnly({ resourceType: DATABASE, command }),
    ).toBe(true);
  });

  test.each(
    DATABASE_DIAGNOSTIC_OPERATIONS.filter(
      (operation: DatabaseOperationSpec): boolean => {
        return operation.tier === ResourceCommandTier.Read;
      },
    ).map((operation: DatabaseOperationSpec): [string] => {
      return [operation.name];
    }),
  )("db %s with no argument is Read", (name: string) => {
    const result: ResourceCommandPolicyResult = db(`db ${name}`);

    expect(result.tier).toBe(ResourceCommandTier.Read);
    expect(result.verb).toBe(name);
  });
});

describe("SafeWrite and RiskyWrite: one named session", () => {
  test.each([
    ["db cancel-query 42", ResourceCommandTier.SafeWrite, "cancel-query", "42"],
    ["db cancel-query 1", ResourceCommandTier.SafeWrite, "cancel-query", "1"],
    [
      "db cancel-query 999999999999999",
      ResourceCommandTier.SafeWrite,
      "cancel-query",
      "999999999999999",
    ],
    [
      "db cancel-query -- 42",
      ResourceCommandTier.SafeWrite,
      "cancel-query",
      "42",
    ],
    [
      "db 'cancel-query' '42'",
      ResourceCommandTier.SafeWrite,
      "cancel-query",
      "42",
    ],
    [
      "db terminate-session 42",
      ResourceCommandTier.RiskyWrite,
      "terminate-session",
      "42",
    ],
    [
      "db terminate-session 123456",
      ResourceCommandTier.RiskyWrite,
      "terminate-session",
      "123456",
    ],
    [
      "db terminate-session -- 9",
      ResourceCommandTier.RiskyWrite,
      "terminate-session",
      "9",
    ],
  ])(
    "%s",
    (command: string, tier: ResourceCommandTier, verb: string, id: string) => {
      const result: ResourceCommandPolicyResult = db(command);

      expect(result.tier).toBe(tier);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual([`session:${id}`]);
      expect(result.args).toEqual([verb, id]);
      expect(result.displayCommand).toBe(`db ${verb} ${id}`);
      expect(result.requiresHuman).toBeUndefined();
      expect(result.reason).toContain(`session:${id}`);
      expect(
        ResourceCommandPolicy.isReadOnly({ resourceType: DATABASE, command }),
      ).toBe(false);
    },
  );

  test("the reasons say what each change does", () => {
    expect(db("db cancel-query 42").reason).toContain("stays connected");
    expect(db("db terminate-session 42").reason).toContain("rolling back");
    expect(db("db terminate-session 42").reason).toContain("cannot be undone");
  });
});

describe("Denied: free SQL, database commands and scripts", () => {
  test.each([
    ["db sql 'select 1'"],
    ["db query 'SELECT * FROM users'"],
    ["db exec x"],
    ["db execute 'DROP TABLE users'"],
    ["db eval 'return 1' 0"],
    ["db evalsha abc 0"],
    ["db script load x"],
    ["db select 1"],
    ["db explain 'select 1'"],
    ["db run x"],
    ["db shell"],
    ["db raw 'FLUSHALL'"],
    ["db command '{\"dropDatabase\": 1}'"],
    ["db psql -c x"],
    ["db mysql"],
    ["db mongosh"],
    ["db redis-cli"],
    ["db aggregate x"],
    ["db find users"],
  ])("%s", (command: string) => {
    expectDenied(command, "never runs SQL");
  });
});

describe("Denied: every change but the two session changes", () => {
  test.each([
    ["db config set maxmemory 1gb"],
    ["db config-set maxmemory 1gb"],
    ["db set work_mem 64MB"],
    ["db alter-system x"],
    ["db flushall"],
    ["db flushdb"],
    ["db shutdown"],
    ["db restart"],
    ["db drop table users"],
    ["db truncate users"],
    ["db delete users"],
    ["db del key"],
    ["db insert x"],
    ["db update x"],
    ["db create index x"],
    ["db grant all"],
    ["db revoke all"],
    ["db vacuum"],
    ["db analyze"],
    ["db reindex x"],
    ["db optimize x"],
    ["db bgsave"],
    ["db replicaof no one"],
    ["db failover"],
    ["db client kill id 5"],
    ["db acl setuser x"],
    ["db debug sleep 10"],
    ["db compact users"],
  ])("%s", (command: string) => {
    expectDenied(
      command,
      "the only changes db makes are cancel-query and terminate-session",
    );
  });

  test.each([
    ["db kill 42"],
    ["db killop 42"],
    ["db kill-query 42"],
    ["db cancel 42"],
    ["db terminate 42"],
    ["db pg_cancel_backend 42"],
    ["db pg_terminate_backend 42"],
    ["db kill-session 42"],
    ["db disconnect 42"],
  ])("%s points at cancel-query and terminate-session", (command: string) => {
    const result: ResourceCommandPolicyResult = db(command);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toContain("db cancel-query ID");
    expect(result.reason).toContain("db terminate-session ID");
  });
});

describe("Denied: the operation must be exact", () => {
  test.each([
    ["db foo", "is not a db operation"],
    ["db status", "is not a db operation"],
    ["db help", "is not a db operation"],
    ["db health", "is not a db operation"],
    ["db PING", 'write "db ping"'],
    ["db Sessions", 'write "db sessions"'],
    ["db cancel_query 42", 'write "db cancel-query"'],
    ["db CANCEL-QUERY 42", 'write "db cancel-query"'],
    ["db top_statements", 'write "db top-statements"'],
    ["db Current-Ops", 'write "db sessions"'],
    ["db", "name an operation"],
    ["db ''", "name an operation"],
    ["db --limit 5 sessions", "the operation comes right after"],
    ["db -- ping", "the operation comes right after"],
    ["db --help", "the operation comes right after"],
    ["db -h", "the operation comes right after"],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("an unknown operation lists what is available", () => {
    const reason: string = db("db foo").reason;

    for (const operation of DATABASE_DIAGNOSTIC_OPERATIONS) {
      expect(reason).toContain(operation.name);
    }
  });
});

describe("Denied: flags", () => {
  test.each([
    ["db sessions -l 5", "long flags only"],
    ["db sessions -h", "long flags only"],
    ["db sessions -abc", "long flags only"],
    ["db sessions -5", "long flags only"],
    ["db ping -v", "long flags only"],
    ["db sessions --limit 5 -s idle", "long flags only"],
    [
      "db sessions --verbose",
      "db sessions takes --limit, --state, --user and --database, not --verbose",
    ],
    ["db ping --limit 5", "db ping takes no flags"],
    ["db cancel-query 42 --force", "db cancel-query takes no flags"],
    ["db terminate-session 42 --all", "db terminate-session takes no flags"],
    ["db sessions --sql 'select 1'", "not --sql"],
    ["db settings --all", "db settings takes no flags"],
    ["db long-queries --state idle", "not --state"],
    ["db sessions --=5", "is not a flag db knows"],
    ["db sessions ---limit 5", "is not a flag db knows"],
    ["db sessions --limit_x 5", "is not a flag db knows"],
    ["db sessions '--limit 5'", "is not a flag db knows"],
    ["db sessions --LIMIT 5", "write --limit"],
    ["db sessions --Limit=5", "write --limit"],
    ["db long-queries --min_seconds 5", "write --min-seconds"],
    ["db sessions --host db.example.com", "connects to its own database"],
    ["db ping --password hunter2", "connects to its own database"],
    ["db ping --port=5432", "connects to its own database"],
    ["db sessions --uri postgres://x", "connects to its own database"],
    ["db ping --tls", "connects to its own database"],
    ["db ping --dsn x", "connects to its own database"],
    ["db ping --config /etc/x", "connects to its own database"],
    [
      "db sessions --defaults-file=/root/.my.cnf",
      "connects to its own database",
    ],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test.each([
    ["db sessions --limit"],
    ["db sessions --limit="],
    ["db sessions --user"],
    ["db sessions --user ''"],
    ["db sessions --limit --state idle"],
    ["db sessions --user --sql"],
    ["db sessions --user -- x"],
    ["db sessions --state -x"],
    ["db sessions --limit -1"],
    ["db long-queries --min-seconds --limit 5"],
  ])(
    "%s: a value-taking flag never swallows a flag-looking word",
    (command: string) => {
      expectDenied(command, "needs a value");
    },
  );

  test.each([
    ["db sessions --limit 5 --limit 6"],
    ["db sessions --limit 5 --limit=5"],
    ["db sessions --state idle --state=active"],
    ["db table-sizes --database a --database b"],
  ])("%s: each flag once", (command: string) => {
    expectDenied(command, "more than once");
  });

  test.each([
    ["db sessions --limit 0", "from 1 to 200"],
    ["db sessions --limit 201", "from 1 to 200"],
    ["db sessions --limit 05", "without leading zeros"],
    ["db sessions --limit=-1", "whole number"],
    ["db sessions --limit 1.5", "whole number"],
    ["db sessions --limit 1e2", "whole number"],
    ["db sessions --limit ten", "whole number"],
    ["db sessions --limit ５", "whole number"],
    ["db sessions --limit 99999999999", "whole number"],
    ["db sessions '--limit=5 --sql'", "whole number"],
    ["db sessions --limit=5=6", "whole number"],
    ["db long-queries --min-seconds 86401", "from 0 to 86400"],
    [
      "db sessions --state running",
      "must be one of active, idle, idle-in-transaction",
    ],
    ["db sessions --state ACTIVE", 'write "active"'],
    ["db sessions --user 'bob smith'", "must be a name"],
    ["db sessions --user=-bob", "must be a name"],
    ["db sessions --database 'a;b'", "must be a name"],
    ["db sessions --user 'bob​'", "must be a name"],
    ["db sessions --user 'bоb'", "must be a name"],
    [`db sessions --user ${"a".repeat(129)}`, "must be a name"],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("a 128-character name is accepted", () => {
    expect(db(`db sessions --user ${"a".repeat(128)}`).tier).toBe(
      ResourceCommandTier.Read,
    );
  });
});

describe("Denied: arguments", () => {
  test.each([
    ["db ping now", "db ping takes no argument"],
    ["db sessions all", "db sessions takes no argument"],
    ["db sessions ''", "db sessions takes no argument"],
    ["db sessions -- --limit 5", "db sessions takes no argument"],
    ["db settings work_mem shared_buffers", "takes one NAME"],
    ["db settings 'work mem'", "no wildcards"],
    ["db settings 'work_mem*'", "no wildcards"],
    ["db settings '%'", "no wildcards"],
    ["db settings ''", "no wildcards"],
    ["db settings -- -work_mem", "no wildcards"],
    ["db settings .hidden", "no wildcards"],
    [`db settings ${"a".repeat(65)}`, "no wildcards"],
    ["db settings requirepass", "credential setting"],
    ["db settings masterauth", "credential setting"],
    ["db settings password_encryption", "credential setting"],
    ["db settings ssl_key_file", "credential setting"],
    ["db settings security.keyFile", "credential setting"],
    ["db info Memory", 'write "memory"'],
    ["db info globallock", 'write "globalLock"'],
    ["db info everything", "must be one of"],
    ["db info all", "must be one of"],
    ["db info memory stats", "takes one SECTION"],
    ["db cancel-query", "db cancel-query needs ID"],
    ["db terminate-session", "db terminate-session needs ID"],
    ["db cancel-query 0", "numeric session id"],
    ["db cancel-query 042", "numeric session id"],
    ["db cancel-query 4.2", "numeric session id"],
    ["db cancel-query abc", "numeric session id"],
    ["db cancel-query 1234567890123456", "numeric session id"],
    ["db cancel-query ４２", "numeric session id"],
    ["db cancel-query ' 42'", "numeric session id"],
    ["db cancel-query 0x2A", "numeric session id"],
    ["db terminate-session 1e3", "numeric session id"],
    ["db terminate-session -- -1", "numeric session id"],
    ["db cancel-query session:42", 'write "42"'],
    ["db terminate-session session:42", 'write "42"'],
    ["db cancel-query 42 43", "takes one ID"],
    ["db terminate-session 42 -- 43", "takes one ID"],
    ["db terminate-session -1", "long flags only"],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("a 64-character setting name is accepted", () => {
    expect(db(`db settings ${"a".repeat(64)}`).tier).toBe(
      ResourceCommandTier.Read,
    );
  });
});

describe("Denied: look-alike and invisible characters", () => {
  test.each([
    ["db ѕessions", "is not a db operation"],
    ["db sessions —limit 5", "db sessions takes no argument"],
    ["db sessions ‐‐limit 5", "db sessions takes no argument"],
    ["db sessions －－limit 5", "db sessions takes no argument"],
    ["db sessions --lіmit 5", "is not a flag db knows"],
    ["db cancel‐query 42", "is not a db operation"],
    ["db 'ping​'", "is not a db operation"],
    ["db 'ping '", "is not a db operation"],
    ["db 'sessions --limit 5'", "is not a db operation"],
    ["db terminate-session '42 '", "numeric session id"],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("a look-alike program is not db", () => {
    expectDenied("ｄｂ ping", "is not a program the Database AI agent runs");
    expectDenied("DB ping", "is not a program the Database AI agent runs");
    expectDenied("/usr/bin/db ping", "without a path");
  });
});

describe("Denied before the policy: shell syntax, privilege, the wrong program, size", () => {
  test.each([
    ["db sessions | grep idle"],
    ["db sessions; db flushall"],
    ["db sessions && db flushall"],
    ["db ping > /tmp/out"],
    ["db ping < /etc/passwd"],
    ["db ping $(id)"],
    ["db ping `id`"],
    ['db ping "$(id)"'],
  ])("%s", (command: string) => {
    expectDenied(command, RESOURCE_SHELL_SYNTAX_RULE);
  });

  test.each([
    ["sudo db ping", "its own permissions only"],
    ["psql -c 'select 1'", "is not a program the Database AI agent runs"],
    ["mysql -e 'select 1'", "is not a program the Database AI agent runs"],
    ["redis-cli FLUSHALL", "is not a program the Database AI agent runs"],
    ["mongosh --eval x", "is not a program the Database AI agent runs"],
    ["kubectl get pods", "is not a program the Database AI agent runs"],
    ["db ping\ndb flushall", "single line"],
    [
      `db sessions --user ${"a".repeat(MAX_COMMAND_LENGTH_CHARS)}`,
      `${MAX_COMMAND_LENGTH_CHARS}-character limit`,
    ],
    [
      `db sessions${" --limit 5".repeat(MAX_RESOURCE_COMMAND_TOKENS)}`,
      `at most ${MAX_RESOURCE_COMMAND_TOKENS} words`,
    ],
    ["", "Empty command"],
    ["   ", "Empty command"],
  ])("%p", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });
});

describe("displayCommand and args", () => {
  test.each([
    ["db sessions --state idle --limit 5 --user bob"],
    ["db current-ops --database=orders"],
    ["db long-queries --limit=3 --min-seconds=10"],
    ["db settings -- work_mem"],
    ["db cancel-query -- 42"],
    ["db terminate-session 7"],
    ["db info globalLock"],
    ["db sessions --user 'svc$1'"],
  ])("%s is canonical and evaluates to itself", (command: string) => {
    const first: ResourceCommandPolicyResult = db(command);
    const second: ResourceCommandPolicyResult = db(first.displayCommand);

    expect(first.tier).not.toBe(ResourceCommandTier.Denied);
    expect(second).toEqual(first);
    expect(
      ResourceCommandPolicy.evaluateArgv({
        resourceType: DATABASE,
        argv: ["db", ...first.args],
      }),
    ).toEqual(first);
    expect(tokenizeResourceCommand(first.displayCommand).argv).toEqual([
      "db",
      ...first.args,
    ]);
  });

  test("a Denied command is shown as written, quoted to round-trip", () => {
    const result: ResourceCommandPolicyResult = db("db sql 'select 1'");

    expect(result.displayCommand).toBe("db sql 'select 1'");
    expect(result.args).toEqual(["sql", "select 1"]);
    expect(result.verb).toBe("");
  });

  test("the reason for a refused word quotes it safely, cut when long", () => {
    const reason: string = db(`db ${"x".repeat(300)}`).reason;

    expect(reason).toContain(`"${"x".repeat(64)}..."`);
    expect(reason).not.toContain("x".repeat(65));
    expect(db("db 'a\"b'").reason).toContain('"a\\"b"');
  });
});

describe("totality", () => {
  test.each([
    [null],
    [undefined],
    [[]],
    [{}],
    ["db ping"],
    [42],
    [[1, 2]],
    [["db", null]],
    [["db", "ping", 7]],
    [["db", {}]],
    [["psql", "ping"]],
    [[""]],
  ])("argv %p is Denied without throwing", (argv: unknown) => {
    const result: ResourceCommandPolicyResult = direct(argv);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.targets).toEqual([]);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test("a direct call reads the argv exactly like the dispatcher", () => {
    expect(direct(["db", "ping"]).tier).toBe(ResourceCommandTier.Read);
    expect(direct(["db", "cancel-query", "5"]).targets).toEqual(["session:5"]);
    expect(direct(["db", "sessions", "--limit", "5"]).args).toEqual([
      "sessions",
      "--limit",
      "5",
    ]);
    expect(direct(["db", ""]).reason).toContain("name an operation");
    expect(direct(["db", "sessions", ""]).reason).toContain(
      "takes no argument",
    );
  });

  test("an argv that throws when read is Denied, not thrown", () => {
    const hostile: Array<string> = new Proxy(["db", "ping"], {
      get(): never {
        throw new Error("hostile argv");
      },
    });

    const result: ResourceCommandPolicyResult = direct(hostile);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.program).toBe("db");
    expect(result.targets).toEqual([]);
  });

  test("the caller's argv is never changed", () => {
    const argv: Array<string> = Object.freeze([
      "db",
      "sessions",
      "--limit=5",
    ]) as unknown as Array<string>;

    expect(direct(argv).tier).toBe(ResourceCommandTier.Read);
    expect(argv).toEqual(["db", "sessions", "--limit=5"]);
  });

  test("the returned args are a copy", () => {
    const first: ResourceCommandPolicyResult = direct(["db", "ping"]);
    first.args.push("--oops");

    expect(direct(["db", "ping"]).args).toEqual(["ping"]);
  });
});

describe("the auto-execution ladder for DatabaseServer", () => {
  test.each([
    [
      "db sessions",
      [],
      false,
      AiRemediationCommandPolicyVerdict.AutoApproved,
      ResourceCommandTier.Read,
    ],
    [
      "db cancel-query 42",
      [],
      false,
      AiRemediationCommandPolicyVerdict.AutoApproved,
      ResourceCommandTier.SafeWrite,
    ],
    [
      "db terminate-session 42",
      [],
      false,
      AiRemediationCommandPolicyVerdict.RequiresApproval,
      ResourceCommandTier.RiskyWrite,
    ],
    [
      "db terminate-session 42",
      ["db terminate-session *"],
      false,
      AiRemediationCommandPolicyVerdict.AutoApproved,
      ResourceCommandTier.RiskyWrite,
    ],
    [
      "db terminate-session 42",
      ["db terminate-session 42"],
      false,
      AiRemediationCommandPolicyVerdict.AutoApproved,
      ResourceCommandTier.RiskyWrite,
    ],
    [
      "db terminate-session 42",
      ["db terminate-session 43"],
      false,
      AiRemediationCommandPolicyVerdict.RequiresApproval,
      ResourceCommandTier.RiskyWrite,
    ],
    [
      "db terminate-session 42",
      [],
      true,
      AiRemediationCommandPolicyVerdict.AutoApproved,
      ResourceCommandTier.RiskyWrite,
    ],
    [
      "db terminate-session -- 42",
      ["db terminate-session *"],
      false,
      AiRemediationCommandPolicyVerdict.RequiresApproval,
      ResourceCommandTier.RiskyWrite,
    ],
    [
      "db terminate-session 42",
      ["db sessions"],
      false,
      AiRemediationCommandPolicyVerdict.RequiresApproval,
      ResourceCommandTier.RiskyWrite,
    ],
    [
      "db sql 'select 1'",
      ["db sql *"],
      true,
      AiRemediationCommandPolicyVerdict.Denied,
      ResourceCommandTier.Denied,
    ],
    [
      "db flushall",
      [],
      true,
      AiRemediationCommandPolicyVerdict.Denied,
      ResourceCommandTier.Denied,
    ],
    [
      "db terminate-session session:42",
      ["db terminate-session *"],
      true,
      AiRemediationCommandPolicyVerdict.Denied,
      ResourceCommandTier.Denied,
    ],
  ])(
    "%s (allowlist %p, bypass %p)",
    (
      command: string,
      allowlistPatterns: Array<string>,
      bypassApproval: boolean,
      verdict: AiRemediationCommandPolicyVerdict,
      tier: ResourceCommandTier,
    ) => {
      const result: ResourceAutoExecutionVerdict = autoExecution(command, {
        allowlistPatterns,
        bypassApproval,
      });

      expect(result.verdict).toBe(verdict);
      expect(result.tier).toBe(tier);
      expect(result.requiresHuman).toBeUndefined();
    },
  );

  test("an allowlisted change says so; a Denied one says it never runs", () => {
    expect(
      autoExecution("db terminate-session 42", {
        allowlistPatterns: ["db terminate-session *"],
      }).reason,
    ).toBe("Matched the resource's command allowlist.");
    expect(autoExecution("db flushall").reason).toContain(
      "cannot run even with human approval",
    );
  });
});

describe("the allowlist for DatabaseServer", () => {
  test.each([
    ["db terminate-session 42", ["db terminate-session *"], true],
    ["db terminate-session 42", ["db terminate-session 42"], true],
    ["db terminate-session 42", ["db terminate-session 4"], false],
    ["db terminate-session 42", ["db terminate-session 4*"], false],
    ["db cancel-query 42", ["db cancel-query *"], true],
    ["db cancel-query 42", ["db terminate-session *"], false],
    ["db terminate-session 42", ["db * 42"], false],
    ["db terminate-session 42", ["db *"], false],
    ["db terminate-session 42", ["psql *"], false],
    ["db sessions", ["db sessions"], false],
    ["db sessions --limit 5", ["db sessions --limit *"], false],
  ])(
    "%s against %p",
    (command: string, patterns: Array<string>, expected: boolean) => {
      expect(
        ResourceCommandPolicy.matchesAllowlist({
          resourceType: DATABASE,
          command,
          patterns,
        }),
      ).toBe(expected);
    },
  );

  test.each([
    ["db terminate-session *", null],
    ["db terminate-session 42", null],
    ["db cancel-query *", null],
    ["db cancel-query 7", null],
    ["db sessions --limit *", "read-only"],
    ["db info *", "can never match a command that runs"],
    ["db ping *", "can never match a command that runs"],
    ["db sql *", "can never match a command that runs"],
    ["db flushall *", "can never match a command that runs"],
    ["db *", "fewer than two words"],
    ["db terminate-session", "fewer than two words"],
    ["db * 42", "has a * where the command goes"],
    ["psql -c *", "does not start with a program"],
    ["", "cannot be blank"],
    ["db terminate-session *; db flushall", "cannot be read as one command"],
  ])("entry %p", (pattern: string, problem: string | null) => {
    const described: string | null =
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: DATABASE,
        pattern,
      });

    if (problem === null) {
      expect(described).toBeNull();
    } else {
      expect(described).toContain(problem);
    }
  });

  test.each([
    ["db terminate-session *", true],
    ["db cancel-query *", true],
    ["db terminate-session 42", false],
    ["db cancel-query 7", false],
    ["db sessions --limit *", false],
    ["db sql *", false],
  ])("%s is broad: %p", (pattern: string, broad: boolean) => {
    expect(
      ResourceCommandPolicy.isBroadAllowlistPattern({
        resourceType: DATABASE,
        pattern,
      }),
    ).toBe(broad);
  });

  test("the allowlist as a whole", () => {
    expect(
      ResourceCommandPolicy.describeAllowlistProblems({
        resourceType: DATABASE,
        patterns: ["db terminate-session *", "db cancel-query *"],
      }),
    ).toBeNull();
    expect(
      ResourceCommandPolicy.describeAllowlistProblems({
        resourceType: DATABASE,
        patterns: ["db terminate-session *", "db sessions"],
      }),
    ).toContain("fewer than two words");
  });
});

describe("the agent's write scope for DatabaseServer", () => {
  function scope(
    command: string,
    posture: {
      allowWrites?: boolean;
      writeTargets?: Array<string>;
      protectedTargets?: Array<string>;
    } = {},
  ): string | null {
    return ResourceCommandPolicy.getWriteScopeRefusal({
      result: db(command),
      allowWrites: posture.allowWrites !== false,
      writeTargets: posture.writeTargets || [],
      protectedTargets: posture.protectedTargets || [],
      resourceType: DATABASE,
    });
  }

  test("a read is never refused, even by a read-only agent", () => {
    expect(scope("db sessions", { allowWrites: false })).toBeNull();
    expect(
      scope("db long-queries", {
        allowWrites: false,
        writeTargets: ["session:1"],
        protectedTargets: ["session:*"],
      }),
    ).toBeNull();
  });

  test("a read-only agent refuses both changes, naming the switch", () => {
    for (const command of ["db cancel-query 42", "db terminate-session 42"]) {
      const refusal: string | null = scope(command, { allowWrites: false });

      expect(refusal).toContain(`${RESOURCE_AI_ALLOW_WRITES_ENV}=true`);
      expect(refusal).toContain("Database AI agent");
    }
  });

  test("a writable agent without scope runs a session change", () => {
    expect(scope("db cancel-query 42")).toBeNull();
    expect(scope("db terminate-session 42")).toBeNull();
  });

  test("the agent's own session is protected", () => {
    expect(
      scope("db terminate-session 42", { protectedTargets: ["session:42"] }),
    ).toContain("protects");
    expect(
      scope("db cancel-query 42", { protectedTargets: ["session:4*"] }),
    ).toContain("protects");
    expect(
      scope("db cancel-query 42", { protectedTargets: ["session:43"] }),
    ).toBeNull();
  });

  test("ONEUPTIME_AI_WRITE_TARGETS bounds which sessions change", () => {
    expect(
      scope("db terminate-session 12", { writeTargets: ["session:1*"] }),
    ).toBeNull();

    const refusal: string | null = scope("db terminate-session 42", {
      writeTargets: ["session:1*"],
    });

    expect(refusal).toContain("session:42");
    expect(refusal).toContain(RESOURCE_AI_WRITE_TARGETS_ENV);
  });

  test("a Denied command never runs", () => {
    expect(scope("db flushall")).toContain("denied by the command policy");
  });
});

describe("the guides", () => {
  test("come from the catalog, through the dispatcher and the re-exports", () => {
    expect(DatabaseCommandPolicy.readCommandGuide).toBe(
      getDatabaseReadCommandGuide(),
    );
    expect(DatabaseCommandPolicy.writeCommandGuide).toBe(
      getDatabaseWriteCommandGuide(),
    );
    expect(ResourceCommandPolicy.getReadCommandGuide(DATABASE)).toBe(
      DatabaseCommandPolicy.readCommandGuide,
    );
    expect(ResourceCommandPolicy.getWriteCommandGuide(DATABASE)).toBe(
      DatabaseCommandPolicy.writeCommandGuide,
    );
    expect(reExportedReadGuide).toBe(getDatabaseReadCommandGuide);
    expect(reExportedWriteGuide).toBe(getDatabaseWriteCommandGuide);
  });

  test("every command a guide shows is the tier it claims", () => {
    const usageRegex: RegExp = /^- `(db [a-z-]+)[ `]/;

    for (const line of DatabaseCommandPolicy.readCommandGuide.split("\n")) {
      const usage: RegExpExecArray | null = usageRegex.exec(line);

      if (usage && usage[1] !== "db <operation>") {
        expect(db(usage[1]!).tier).toBe(ResourceCommandTier.Read);
      }
    }

    expect(DatabaseCommandPolicy.writeCommandGuide).toContain(
      "`db cancel-query ID` (safe",
    );
    expect(db("db cancel-query 1").tier).toBe(ResourceCommandTier.SafeWrite);
    expect(DatabaseCommandPolicy.writeCommandGuide).toContain(
      "`db terminate-session ID` (risky",
    );
    expect(db("db terminate-session 1").tier).toBe(
      ResourceCommandTier.RiskyWrite,
    );
  });
});
