import {
  ALL_DATABASE_ENGINES,
  DATABASE_DEFAULT_ROW_LIMIT,
  DATABASE_DIAGNOSTIC_OPERATIONS,
  DATABASE_ENGINE_DISPLAY_NAMES,
  DATABASE_MAX_ROW_LIMIT,
  DATABASE_OPERATION_NAMES,
  DATABASE_PROGRAM,
  DatabaseCommandParse,
  DatabaseEngine,
  DatabaseOperationSpec,
  DatabaseParamKind,
  DatabaseParamSpec,
  MONGODB_SERVER_STATUS_SECTIONS,
  ParsedDatabaseCommand,
  REDIS_INFO_SECTIONS,
  describeDatabaseOperationUsage,
  getDatabaseEngineRefusal,
  getDatabaseOperation,
  getDatabaseOperationsForEngine,
  getDatabaseReadCommandGuide,
  getDatabaseWriteCommandGuide,
  isDatabaseCredentialSettingName,
  parseDatabaseCommand,
  parseDatabaseEngine,
} from "../../../../Utils/AiRemediation/Resource/DatabaseDiagnosticCatalog";
import { tokenizeResourceCommand } from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — DatabaseDiagnosticCatalog, the closed set of `db`
 * operations the Database AI agent's executor imports.
 *
 * - The catalog is well formed: unique lowercase-dash names, every
 *   operation on at least one engine with an implementation for each, only
 *   cancel-query (SafeWrite) and terminate-session (RiskyWrite) change
 *   anything, and both take a required session id.
 * - parseDatabaseCommand hands the executor typed values (numbers for
 *   limits and ids) and a canonical argv that re-parses to itself.
 * - Engine support: parseDatabaseEngine reads DATABASE_SYSTEM spellings,
 *   getDatabaseEngineRefusal refuses what an engine lacks, and the guides
 *   can be written for one engine.
 */

function parse(command: string): DatabaseCommandParse {
  return parseDatabaseCommand(tokenizeResourceCommand(command).argv);
}

function parsed(command: string): ParsedDatabaseCommand {
  const result: DatabaseCommandParse = parse(command);

  if (!result.ok) {
    throw new Error(`${command} did not parse: ${result.errorMessage}`);
  }

  return result.command;
}

describe("the catalog is well formed", () => {
  test("operation names and aliases are unique lowercase words joined by dashes", () => {
    const seen: Array<string> = [];

    for (const operation of DATABASE_DIAGNOSTIC_OPERATIONS) {
      for (const name of [operation.name, ...operation.aliases]) {
        expect(name).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
        expect(seen).not.toContain(name);
        seen.push(name);
      }
    }

    expect(DATABASE_OPERATION_NAMES).toEqual(
      DATABASE_DIAGNOSTIC_OPERATIONS.map((operation: DatabaseOperationSpec) => {
        return operation.name;
      }),
    );
  });

  test("pins the operations and their tiers", () => {
    const tiers: Record<string, ResourceCommandTier> = {};

    for (const operation of DATABASE_DIAGNOSTIC_OPERATIONS) {
      tiers[operation.name] = operation.tier;
    }

    expect(tiers).toEqual({
      ping: ResourceCommandTier.Read,
      version: ResourceCommandTier.Read,
      sessions: ResourceCommandTier.Read,
      "long-queries": ResourceCommandTier.Read,
      blocking: ResourceCommandTier.Read,
      locks: ResourceCommandTier.Read,
      replication: ResourceCommandTier.Read,
      connections: ResourceCommandTier.Read,
      "database-sizes": ResourceCommandTier.Read,
      "table-sizes": ResourceCommandTier.Read,
      "top-statements": ResourceCommandTier.Read,
      settings: ResourceCommandTier.Read,
      slowlog: ResourceCommandTier.Read,
      info: ResourceCommandTier.Read,
      "innodb-status": ResourceCommandTier.Read,
      memory: ResourceCommandTier.Read,
      keyspace: ResourceCommandTier.Read,
      "cancel-query": ResourceCommandTier.SafeWrite,
      "terminate-session": ResourceCommandTier.RiskyWrite,
    });
    expect(getDatabaseOperation("current-ops")!.name).toBe("sessions");
  });

  test.each(
    DATABASE_DIAGNOSTIC_OPERATIONS.map(
      (operation: DatabaseOperationSpec): [string, DatabaseOperationSpec] => {
        return [operation.name, operation];
      },
    ),
  )("%s", (_name: string, operation: DatabaseOperationSpec) => {
    expect(operation.engines.length).toBeGreaterThan(0);
    expect(Object.keys(operation.implementation).sort()).toEqual(
      [...operation.engines].sort(),
    );
    expect(operation.summary.length).toBeGreaterThan(10);
    expect(operation.summary.endsWith(".")).toBe(false);

    const flagNames: Array<string> = operation.flags.map(
      (flag: DatabaseParamSpec): string => {
        return flag.name;
      },
    );

    expect(new Set(flagNames).size).toBe(flagNames.length);

    for (const flag of operation.flags) {
      expect(flag.name).toMatch(/^[a-z]+(?:-[a-z]+)*$/);

      for (const engine of flag.engines || []) {
        expect(operation.engines).toContain(engine);
      }

      if (flag.kind === DatabaseParamKind.Integer) {
        expect(flag.minimum).toBeLessThanOrEqual(flag.defaultValue!);
        expect(flag.defaultValue).toBeLessThanOrEqual(flag.maximum!);
      }
    }

    if (operation.tier === ResourceCommandTier.Read) {
      expect(operation.argument === null || !operation.argument.required).toBe(
        true,
      );
    } else {
      expect(operation.argument).not.toBeNull();
      expect(operation.argument!.required).toBe(true);
      expect(operation.argument!.kind).toBe(DatabaseParamKind.SessionId);
      expect(operation.flags).toEqual([]);
    }

    if (operation.argument && operation.argument.choicesByEngine) {
      for (const engine of Object.keys(operation.argument.choicesByEngine)) {
        expect(operation.engines).toContain(engine);
      }
    }
  });

  test("the program is db", () => {
    expect(DATABASE_PROGRAM).toBe("db");
  });

  test("row limits are bounded", () => {
    expect(DATABASE_MAX_ROW_LIMIT).toBe(200);
    expect(DATABASE_DEFAULT_ROW_LIMIT).toBeLessThanOrEqual(
      DATABASE_MAX_ROW_LIMIT,
    );
  });

  test("the info sections hold no catch-all", () => {
    for (const all of ["all", "everything", "default"]) {
      expect(REDIS_INFO_SECTIONS).not.toContain(all);
    }

    expect(MONGODB_SERVER_STATUS_SECTIONS).not.toContain("security");
  });
});

describe("getDatabaseOperation", () => {
  test.each([
    ["sessions", "sessions"],
    ["current-ops", "sessions"],
    ["cancel-query", "cancel-query"],
    ["Sessions", null],
    ["cancel_query", null],
    ["", null],
    ["constructor", null],
    ["__proto__", null],
  ])("%p", (word: string, expected: string | null) => {
    const operation: DatabaseOperationSpec | null = getDatabaseOperation(word);

    expect(operation ? operation.name : null).toBe(expected);
  });

  test("a non-string is no operation", () => {
    expect(getDatabaseOperation(null)).toBeNull();
    expect(getDatabaseOperation(42)).toBeNull();
    expect(getDatabaseOperation(["sessions"])).toBeNull();
  });
});

describe("parseDatabaseCommand hands the executor typed values", () => {
  test("numbers are numbers, names are strings, the canonical argv is ordered", () => {
    const command: ParsedDatabaseCommand = parsed(
      "db sessions --user=bob --state idle --limit 7",
    );

    expect(command.operation.name).toBe("sessions");
    expect(command.argument).toBeNull();
    expect(command.flags).toEqual({ limit: 7, state: "idle", user: "bob" });
    expect(command.canonicalArgs).toEqual([
      "sessions",
      "--limit",
      "7",
      "--state",
      "idle",
      "--user",
      "bob",
    ]);
  });

  test("a session id is a number", () => {
    const command: ParsedDatabaseCommand = parsed("db cancel-query 123");

    expect(command.argument).toBe(123);
    expect(command.flags).toEqual({});
    expect(command.canonicalArgs).toEqual(["cancel-query", "123"]);
  });

  test("the largest id is exact as a number", () => {
    expect(parsed("db terminate-session 999999999999999").argument).toBe(
      999999999999999,
    );
    expect(Number.isSafeInteger(999999999999999)).toBe(true);
  });

  test("a choice argument is a string", () => {
    expect(parsed("db info globalLock").argument).toBe("globalLock");
    expect(parsed("db settings work_mem").argument).toBe("work_mem");
  });

  test("an alias parses to its operation", () => {
    expect(parsed("db current-ops --limit 3").operation.name).toBe("sessions");
    expect(parsed("db current-ops --limit 3").canonicalArgs).toEqual([
      "sessions",
      "--limit",
      "3",
    ]);
  });

  test.each([
    ["db sessions --limit 5 --state active --user bob --database app"],
    ["db long-queries --min-seconds 0 --limit 200"],
    ["db table-sizes --database app --limit 1"],
    ["db settings maxmemory-policy"],
    ["db info opcountersRepl"],
    ["db cancel-query 5"],
  ])("%s re-parses to itself", (command: string) => {
    const first: ParsedDatabaseCommand = parsed(command);
    const second: ParsedDatabaseCommand = parsed(
      ["db", ...first.canonicalArgs].join(" "),
    );

    expect(second).toEqual(first);
  });

  test.each([
    [null],
    [undefined],
    [[]],
    ["db ping"],
    [["db", 5]],
    [["sql", "ping"]],
  ])("%p is refused, not thrown", (argv: unknown) => {
    const result: DatabaseCommandParse = parseDatabaseCommand(argv);

    expect(result.ok).toBe(false);
  });
});

describe("parseDatabaseEngine", () => {
  test.each([
    ["postgresql", DatabaseEngine.PostgreSQL],
    ["PostgreSQL", DatabaseEngine.PostgreSQL],
    [" postgres ", DatabaseEngine.PostgreSQL],
    ["pg", DatabaseEngine.PostgreSQL],
    ["pgsql", DatabaseEngine.PostgreSQL],
    ["mysql", DatabaseEngine.MySQL],
    ["mariadb", DatabaseEngine.MySQL],
    ["percona", DatabaseEngine.MySQL],
    ["redis", DatabaseEngine.Redis],
    ["valkey", DatabaseEngine.Redis],
    ["keydb", DatabaseEngine.Redis],
    ["dragonfly", DatabaseEngine.Redis],
    ["mongodb", DatabaseEngine.MongoDB],
    ["mongo", DatabaseEngine.MongoDB],
    ["microsoft.sql_server", null],
    ["oracle.db", null],
    ["elasticsearch", null],
    ["memcached", null],
    ["", null],
    ["constructor", null],
    ["__proto__", null],
    [null, null],
    [5, null],
  ])("%p", (value: unknown, expected: DatabaseEngine | null) => {
    expect(parseDatabaseEngine(value)).toBe(expected);
  });

  test("every engine has a display name", () => {
    expect(ALL_DATABASE_ENGINES.length).toBe(4);

    for (const engine of ALL_DATABASE_ENGINES) {
      expect(DATABASE_ENGINE_DISPLAY_NAMES[engine].length).toBeGreaterThan(0);
    }
  });
});

describe("getDatabaseEngineRefusal", () => {
  test.each([
    ["db sessions", "redis", null],
    ["db sessions --limit 5 --user bob", "redis", null],
    [
      "db sessions --state idle",
      "redis",
      "--state is not available for db sessions on Redis",
    ],
    ["db sessions --state idle", "postgresql", null],
    ["db keyspace", "postgresql", "db keyspace is not available on PostgreSQL"],
    ["db keyspace", "valkey", null],
    ["db innodb-status", "mariadb", null],
    ["db innodb-status", "mongodb", "not available on MongoDB"],
    ["db top-statements", "mongodb", "not available on MongoDB"],
    ["db long-queries", "redis", "not available on Redis"],
    ["db info memory", "redis", null],
    ["db info", "redis", null],
    ["db info globalLock", "redis", "is not a SECTION on Redis"],
    ["db info mem", "mongodb", null],
    ["db info memory", "mongodb", "is not a SECTION on MongoDB"],
    ["db info memory", "postgresql", "not available on PostgreSQL"],
    ["db cancel-query 5", "postgresql", null],
    ["db cancel-query 5", "mongodb", null],
    ["db cancel-query 5", "redis", "not available on Redis"],
    ["db terminate-session 5", "redis", null],
    ["db terminate-session 5", "mysql", null],
    ["db terminate-session 5", "mongodb", "not available on MongoDB"],
    ["db slowlog", "redis", null],
    ["db slowlog", "postgresql", "not available on PostgreSQL"],
    ["db ping", "oracle.db", "does not know the engine"],
    ["db ping", "", "does not know the engine"],
  ])("%s on %s", (command: string, engine: string, refusal: string | null) => {
    const described: string | null = getDatabaseEngineRefusal(
      parsed(command),
      engine,
    );

    if (refusal === null) {
      expect(described).toBeNull();
    } else {
      expect(described).toContain(refusal);
    }
  });

  test("a refusal lists what the engine does have", () => {
    const described: string = getDatabaseEngineRefusal(
      parsed("db keyspace"),
      "postgresql",
    )!;

    for (const operation of getDatabaseOperationsForEngine(
      DatabaseEngine.PostgreSQL,
    )) {
      expect(described).toContain(operation.name);
    }
  });

  test("a missing engine or command is refused, not thrown", () => {
    expect(getDatabaseEngineRefusal(parsed("db ping"), undefined)).toContain(
      "does not know the engine",
    );
    expect(
      getDatabaseEngineRefusal(
        null as unknown as ParsedDatabaseCommand,
        "postgresql",
      ),
    ).toContain("could not be read");
  });

  test("every engine has the health checks Test connection runs", () => {
    for (const engine of ALL_DATABASE_ENGINES) {
      expect(getDatabaseEngineRefusal(parsed("db ping"), engine)).toBeNull();
      expect(getDatabaseEngineRefusal(parsed("db version"), engine)).toBeNull();
    }
  });
});

describe("isDatabaseCredentialSettingName", () => {
  test.each([
    ["requirepass", true],
    ["masterauth", true],
    // Valkey 8+ names masterauth primaryauth (and CONFIG GET * lists both)
    ["primaryauth", true],
    ["PRIMARYAUTH", true],
    ["sentinel-masterauth", true],
    ["password_encryption", true],
    ["tls-key-file-pass", true],
    ["ssl_key_file", true],
    ["security.keyFile", true],
    ["client_secret", true],
    ["api_token", true],
    ["work_mem", false],
    ["max_connections", false],
    ["maxmemory-policy", false],
    ["ssl_cert_file", false],
    [null, false],
    [7, false],
  ])("%p: %p", (name: unknown, expected: boolean) => {
    expect(isDatabaseCredentialSettingName(name)).toBe(expected);
  });
});

describe("describeDatabaseOperationUsage", () => {
  test.each([
    ["ping", null, "db ping"],
    ["cancel-query", null, "db cancel-query ID"],
    ["settings", null, "db settings [NAME]"],
    ["info", null, "db info [SECTION]"],
    [
      "sessions",
      null,
      "db sessions [--limit N] [--state active|idle|idle-in-transaction] [--user NAME] [--database NAME]",
    ],
    [
      "sessions",
      DatabaseEngine.Redis,
      "db sessions [--limit N] [--user NAME] [--database NAME]",
    ],
  ])(
    "%s on %p",
    (name: string, engine: DatabaseEngine | null, expected: string) => {
      expect(
        describeDatabaseOperationUsage(getDatabaseOperation(name)!, engine),
      ).toBe(expected);
    },
  );
});

describe("the guides", () => {
  function bullets(guide: string): Array<string> {
    return guide.split("\n");
  }

  test("every line is a markdown bullet", () => {
    for (const guide of [
      getDatabaseReadCommandGuide(),
      getDatabaseWriteCommandGuide(),
      getDatabaseReadCommandGuide("redis"),
      getDatabaseWriteCommandGuide("mongodb"),
    ]) {
      for (const line of bullets(guide)) {
        expect(line.startsWith("- ")).toBe(true);
      }
    }
  });

  test("the read guide names every read operation and no change", () => {
    const guide: string = getDatabaseReadCommandGuide();

    for (const operation of DATABASE_DIAGNOSTIC_OPERATIONS) {
      if (operation.tier === ResourceCommandTier.Read) {
        expect(guide).toContain(`\`db ${operation.name}`);
      } else {
        expect(guide).not.toContain(operation.name);
      }
    }

    expect(guide).toContain("never SQL");
    expect(guide).toContain("--limit=20");
    expect(guide).toContain("db current-ops");
    expect(guide).toContain("(Redis)");
  });

  test.each([
    [
      "postgresql",
      ["db long-queries", "db top-statements", "--state"],
      ["db keyspace", "db innodb-status", "db info", "db slowlog", "db memory"],
    ],
    [
      "mariadb",
      ["db innodb-status", "db slowlog", "db top-statements"],
      ["db keyspace", "db info", "db memory"],
    ],
    [
      "redis",
      ["db keyspace", "db info [SECTION]", "db slowlog", "commandstats"],
      ["db long-queries", "--state", "db blocking", "globalLock"],
    ],
    [
      "mongodb",
      ["db info [SECTION]", "globalLock", "db memory", "--state"],
      ["db keyspace", "commandstats", "db top-statements"],
    ],
  ])(
    "the read guide for %s",
    (engine: string, present: Array<string>, absent: Array<string>) => {
      const guide: string = getDatabaseReadCommandGuide(engine);

      for (const text of present) {
        expect(guide).toContain(text);
      }

      for (const text of absent) {
        expect(guide).not.toContain(text);
      }

      // Written for one engine: no engine tags.
      expect(guide).not.toContain("(PostgreSQL, MySQL/MariaDB");
    },
  );

  test("an unknown engine gets the full guide", () => {
    expect(getDatabaseReadCommandGuide("oracle.db")).toBe(
      getDatabaseReadCommandGuide(),
    );
    expect(getDatabaseWriteCommandGuide(undefined)).toBe(
      getDatabaseWriteCommandGuide(),
    );
  });

  test.each([
    [undefined, ["cancel-query", "terminate-session"]],
    ["postgresql", ["cancel-query", "terminate-session"]],
    ["mysql", ["cancel-query", "terminate-session"]],
    ["redis", ["terminate-session"]],
    ["mongodb", ["cancel-query"]],
  ])(
    "the write guide for %p",
    (engine: string | undefined, operations: Array<string>) => {
      const guide: string = getDatabaseWriteCommandGuide(engine);

      for (const name of ["cancel-query", "terminate-session"]) {
        if (operations.includes(name)) {
          expect(guide).toContain(`\`db ${name} ID\``);
        } else {
          expect(guide).not.toContain(name);
        }
      }

      expect(guide).toContain("session:ID");
      expect(guide).toContain("Nothing else changes the database");
    },
  );
});
