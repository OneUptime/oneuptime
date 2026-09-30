import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  DatabaseSettings,
  DatabaseSettingsResult,
  DatabaseTlsMode,
  describeDatabaseSystem,
  describeUnsupportedDatabaseSystem,
  formatDatabaseEndpoint,
  parseDatabaseEndpoint,
  resolveDatabaseSettings,
  unescapeCollectorValue,
} from "../Executors/Database/DatabaseSettings";
import { DatabaseEngine } from "../Common/Utils/AiRemediation/Resource/DatabaseDiagnosticCatalog";

/*
 * How the Database AI agent reads its connection from the .env it shares
 * with the Database Agent's collector: every variable with the collector's
 * meaning (the $$ escaping of the login, the TLS switches, the endpoint in
 * both spellings), the agent's own login and options, and a problem an
 * operator can act on for everything it cannot use.
 */

function settingsOf(env: NodeJS.ProcessEnv): DatabaseSettings {
  const result: DatabaseSettingsResult = resolveDatabaseSettings(env);
  assert.strictEqual(
    result.problem,
    null,
    `expected settings, got: ${String(result.problem)}`,
  );
  return result.settings as DatabaseSettings;
}

function problemOf(env: NodeJS.ProcessEnv): string {
  const result: DatabaseSettingsResult = resolveDatabaseSettings(env);
  assert.strictEqual(result.settings, null, "expected a problem");
  return String(result.problem);
}

const POSTGRES: NodeJS.ProcessEnv = {
  DATABASE_SYSTEM: "postgresql",
  DATABASE_ENDPOINT: "db.internal:5432",
  DATABASE_USERNAME: "oneuptime_monitor",
  DATABASE_PASSWORD: "pw",
};

describe("the engine", () => {
  test("every DATABASE_SYSTEM spelling of a supported family is read as that family", () => {
    const cases: Array<[string, DatabaseEngine, string]> = [
      ["postgresql", DatabaseEngine.PostgreSQL, "PostgreSQL"],
      ["Postgres", DatabaseEngine.PostgreSQL, "PostgreSQL"],
      ["mysql", DatabaseEngine.MySQL, "MySQL"],
      ["mariadb", DatabaseEngine.MySQL, "MariaDB"],
      ["percona", DatabaseEngine.MySQL, "Percona Server"],
      ["redis", DatabaseEngine.Redis, "Redis"],
      ["valkey", DatabaseEngine.Redis, "Valkey"],
      ["keydb", DatabaseEngine.Redis, "KeyDB"],
      ["dragonfly", DatabaseEngine.Redis, "Dragonfly"],
      ["mongodb", DatabaseEngine.MongoDB, "MongoDB"],
    ];

    for (const [system, engine, name] of cases) {
      const settings: DatabaseSettings = settingsOf({
        ...POSTGRES,
        DATABASE_SYSTEM: ` ${system} `,
      });

      assert.strictEqual(settings.engine, engine, system);
      assert.strictEqual(settings.system, system.toLowerCase(), system);
      assert.strictEqual(settings.serverName, name, system);
    }
  });

  test("DATABASE_SYSTEM unset is a problem naming the variable", () => {
    assert.match(
      problemOf({ ...POSTGRES, DATABASE_SYSTEM: "" }),
      /^DATABASE_SYSTEM is not set\. Set it in the \.env file the AI agent shares with the Database Agent/,
    );
  });

  test("an engine without a catalog is refused as not supported for AI diagnostics yet", () => {
    for (const [system, name] of [
      ["microsoft.sql_server", "Microsoft SQL Server"],
      ["oracle.db", "Oracle Database"],
      ["elasticsearch", "Elasticsearch"],
      ["opensearch", "OpenSearch"],
      ["memcached", "Memcached"],
      ["cockroachdb", '"cockroachdb"'],
    ] as Array<[string, string]>) {
      const problem: string = problemOf({
        ...POSTGRES,
        DATABASE_SYSTEM: system,
      });

      assert.strictEqual(problem, describeUnsupportedDatabaseSystem(system));
      assert.ok(
        problem.startsWith(
          `DATABASE_SYSTEM="${system}": the Database AI agent does not support ${name} for AI diagnostics yet.`,
        ),
        problem,
      );
      assert.match(
        problem,
        /It runs its diagnostics on PostgreSQL, MySQL\/MariaDB, Redis, MongoDB/,
      );
    }
  });

  test("describeDatabaseSystem names what an operator knows", () => {
    assert.strictEqual(describeDatabaseSystem("mssql"), "Microsoft SQL Server");
    assert.strictEqual(describeDatabaseSystem("PG"), "PostgreSQL");
    assert.strictEqual(describeDatabaseSystem("nothing"), '"nothing"');
  });
});

describe("the endpoint", () => {
  test("host:port, a bare host (the engine's default port) and IPv6 in both forms", () => {
    const cases: Array<[string, string, string, number]> = [
      ["postgresql", "db.internal:6543", "db.internal", 6543],
      ["postgresql", "db.internal", "db.internal", 5432],
      ["mysql", "10.0.0.5", "10.0.0.5", 3306],
      ["redis", "cache", "cache", 6379],
      ["mongodb", "mongo-0.mongo.svc", "mongo-0.mongo.svc", 27017],
      ["postgresql", "[2001:db8::1]:5433", "2001:db8::1", 5433],
      ["postgresql", "[2001:db8::1]", "2001:db8::1", 5432],
      ["postgresql", "2001:db8::1", "2001:db8::1", 5432],
      ["postgresql", "host.docker.internal:5432", "host.docker.internal", 5432],
    ];

    for (const [system, endpoint, host, port] of cases) {
      const settings: DatabaseSettings = settingsOf({
        ...POSTGRES,
        DATABASE_SYSTEM: system,
        DATABASE_USERNAME: "u",
        DATABASE_ENDPOINT: endpoint,
      });

      assert.strictEqual(settings.host, host, endpoint);
      assert.strictEqual(settings.port, port, endpoint);
      assert.strictEqual(settings.endpointSource, "DATABASE_ENDPOINT");
      assert.strictEqual(
        settings.endpoint,
        formatDatabaseEndpoint(host, port),
        endpoint,
      );
    }

    assert.strictEqual(
      settingsOf({ ...POSTGRES, DATABASE_ENDPOINT: "[::1]:5432" }).endpoint,
      "[::1]:5432",
    );
  });

  test("DATABASE_ENDPOINT_HOST and _PORT are used when DATABASE_ENDPOINT is empty", () => {
    const settings: DatabaseSettings = settingsOf({
      ...POSTGRES,
      DATABASE_ENDPOINT: "",
      DATABASE_ENDPOINT_HOST: "db2.internal",
      DATABASE_ENDPOINT_PORT: "6000",
    });

    assert.strictEqual(settings.host, "db2.internal");
    assert.strictEqual(settings.port, 6000);
    assert.strictEqual(
      settings.endpointSource,
      "DATABASE_ENDPOINT_HOST+DATABASE_ENDPOINT_PORT",
    );

    const v6: DatabaseSettings = settingsOf({
      ...POSTGRES,
      DATABASE_ENDPOINT: "",
      DATABASE_ENDPOINT_HOST: "fd00::7",
      DATABASE_ENDPOINT_PORT: "",
    });

    assert.strictEqual(v6.host, "fd00::7");
    assert.strictEqual(v6.port, 5432);

    assert.match(
      problemOf({
        ...POSTGRES,
        DATABASE_ENDPOINT: "",
        DATABASE_ENDPOINT_HOST: "db2",
        DATABASE_ENDPOINT_PORT: "http",
      }),
      /^DATABASE_ENDPOINT_PORT="http" is not a port/,
    );
  });

  test("DATABASE_ENDPOINT wins over the separate host and port", () => {
    const settings: DatabaseSettings = settingsOf({
      ...POSTGRES,
      DATABASE_ENDPOINT: "primary:5432",
      DATABASE_ENDPOINT_HOST: "other",
      DATABASE_ENDPOINT_PORT: "1",
    });

    assert.strictEqual(settings.endpoint, "primary:5432");
  });

  test("a missing, URL-shaped or malformed endpoint is a problem, and a login in it is never echoed", () => {
    assert.match(
      problemOf({ ...POSTGRES, DATABASE_ENDPOINT: "" }),
      /^DATABASE_ENDPOINT is not set\. .*e\.g\. db\.internal:5432, or host\.docker\.internal:5432/,
    );
    assert.match(
      problemOf({ ...POSTGRES, DATABASE_ENDPOINT: "postgres://db:5432/app" }),
      /is a URL, but the Database AI agent connects to host:port/,
    );

    const withLogin: string = problemOf({
      ...POSTGRES,
      DATABASE_ENDPOINT: "user:hunter2@db:5432",
    });
    assert.match(withLogin, /holds an "@", as if it carried a login/);
    assert.ok(!withLogin.includes("hunter2"));

    for (const bad of [
      "db:5432/app",
      "db:abc",
      "db:70000",
      "db:0",
      "-db:5432",
      "[notv6]:5432",
      "db 5432",
    ]) {
      const problem: string = problemOf({
        ...POSTGRES,
        DATABASE_ENDPOINT: bad,
      });
      assert.match(
        problem,
        /DATABASE_ENDPOINT="[^"]*" (is not host:port|names a port|has brackets)/,
        bad,
      );
    }
  });

  test("parseDatabaseEndpoint names the variable it reads", () => {
    assert.match(
      String(
        parseDatabaseEndpoint("a b", {
          variable: "DATABASE_ENDPOINT_HOST",
          defaultPort: 1,
        }),
      ),
      /^DATABASE_ENDPOINT_HOST=/,
    );
  });
});

describe("the login", () => {
  test("the collector's login is read with every $$ halved, the password untrimmed", () => {
    const settings: DatabaseSettings = settingsOf({
      ...POSTGRES,
      DATABASE_USERNAME: " mon$$tor ",
      DATABASE_PASSWORD: " My$$$$pa$${ss}word$$ ",
    });

    assert.strictEqual(settings.username, "mon$tor");
    assert.strictEqual(settings.password, " My$$pa${ss}word$ ");
    assert.strictEqual(
      settings.credentialSource,
      "DATABASE_USERNAME/DATABASE_PASSWORD",
    );
    assert.strictEqual(settings.isAgentLogin, false);
  });

  test("unescapeCollectorValue undoes exactly one level", () => {
    assert.strictEqual(unescapeCollectorValue("a$$b"), "a$b");
    assert.strictEqual(unescapeCollectorValue("a$$$$b"), "a$$b");
    assert.strictEqual(unescapeCollectorValue("a$b"), "a$b");
    assert.strictEqual(unescapeCollectorValue("$$$"), "$$");
  });

  test("the agent's own login wins when either of its variables is set, read verbatim", () => {
    const settings: DatabaseSettings = settingsOf({
      ...POSTGRES,
      ONEUPTIME_AI_DATABASE_USERNAME: "oneuptime_ai",
      ONEUPTIME_AI_DATABASE_PASSWORD: "p$$w",
    });

    assert.strictEqual(settings.username, "oneuptime_ai");
    assert.strictEqual(settings.password, "p$$w");
    assert.strictEqual(
      settings.credentialSource,
      "ONEUPTIME_AI_DATABASE_USERNAME/ONEUPTIME_AI_DATABASE_PASSWORD",
    );
    assert.strictEqual(settings.isAgentLogin, true);

    // A requirepass-only Redis: the agent's own password alone.
    const redis: DatabaseSettings = settingsOf({
      ...POSTGRES,
      DATABASE_SYSTEM: "redis",
      DATABASE_USERNAME: "collector",
      ONEUPTIME_AI_DATABASE_PASSWORD: "agent-secret",
    });

    assert.strictEqual(redis.username, "");
    assert.strictEqual(redis.password, "agent-secret");
    assert.strictEqual(redis.isAgentLogin, true);
  });

  test("PostgreSQL and MySQL need a user; the problem names both logins", () => {
    for (const system of ["postgresql", "mariadb"]) {
      const problem: string = problemOf({
        ...POSTGRES,
        DATABASE_SYSTEM: system,
        DATABASE_USERNAME: "",
      });

      assert.match(problem, /^DATABASE_USERNAME is not set\./);
      assert.match(
        problem,
        /set DATABASE_USERNAME and DATABASE_PASSWORD \(the collector's monitoring login\) or ONEUPTIME_AI_DATABASE_USERNAME and ONEUPTIME_AI_DATABASE_PASSWORD/,
      );
    }
  });

  test("Redis and MongoDB run without a login, but not with a user and no password", () => {
    for (const system of ["redis", "mongodb"]) {
      const open: DatabaseSettings = settingsOf({
        ...POSTGRES,
        DATABASE_SYSTEM: system,
        DATABASE_USERNAME: "",
        DATABASE_PASSWORD: "",
      });

      assert.strictEqual(open.username, "");
      assert.strictEqual(open.password, "");

      assert.match(
        problemOf({
          ...POSTGRES,
          DATABASE_SYSTEM: system,
          DATABASE_PASSWORD: "",
        }),
        /^DATABASE_USERNAME is set but DATABASE_PASSWORD is empty\./,
      );
    }

    assert.match(
      problemOf({
        ...POSTGRES,
        DATABASE_SYSTEM: "redis",
        DATABASE_PASSWORD: "",
      }),
      /a requirepass-only server needs DATABASE_PASSWORD alone/,
    );
  });
});

describe("TLS and the agent's options", () => {
  test("the collector's two switches, with the collector's defaults", () => {
    assert.strictEqual(settingsOf(POSTGRES).tls, DatabaseTlsMode.Off);
    assert.strictEqual(
      settingsOf({ ...POSTGRES, DATABASE_TLS_INSECURE: "true" }).tls,
      DatabaseTlsMode.Off,
    );
    assert.strictEqual(
      settingsOf({ ...POSTGRES, DATABASE_TLS_INSECURE: "FALSE" }).tls,
      DatabaseTlsMode.Verify,
    );
    assert.strictEqual(
      settingsOf({
        ...POSTGRES,
        DATABASE_TLS_INSECURE: "false",
        DATABASE_TLS_INSECURE_SKIP_VERIFY: "true",
      }).tls,
      DatabaseTlsMode.NoVerify,
    );
    assert.strictEqual(
      settingsOf({
        ...POSTGRES,
        DATABASE_TLS_INSECURE: "0",
        DATABASE_TLS_INSECURE_SKIP_VERIFY: "0",
      }).tls,
      DatabaseTlsMode.Verify,
    );
  });

  test("a switch that is neither true nor false is a problem, never a guess", () => {
    assert.match(
      problemOf({ ...POSTGRES, DATABASE_TLS_INSECURE: "yes" }),
      /^DATABASE_TLS_INSECURE="yes" is not true or false\./,
    );
    assert.match(
      problemOf({ ...POSTGRES, DATABASE_TLS_INSECURE_SKIP_VERIFY: "maybe" }),
      /^DATABASE_TLS_INSECURE_SKIP_VERIFY="maybe" is not true or false\./,
    );
  });

  test("the CA file and database name are read, and checked", () => {
    const settings: DatabaseSettings = settingsOf({
      ...POSTGRES,
      ONEUPTIME_AI_DATABASE_CA_FILE: " /etc/oneuptime/db-ca.pem ",
      ONEUPTIME_AI_DATABASE_NAME: " app ",
    });

    assert.strictEqual(settings.caFile, "/etc/oneuptime/db-ca.pem");
    assert.strictEqual(settings.database, "app");
    assert.strictEqual(settingsOf(POSTGRES).caFile, null);
    assert.strictEqual(settingsOf(POSTGRES).database, null);

    assert.match(
      problemOf({ ...POSTGRES, ONEUPTIME_AI_DATABASE_NAME: "x".repeat(129) }),
      /^ONEUPTIME_AI_DATABASE_NAME is not a database name/,
    );
    assert.match(
      problemOf({ ...POSTGRES, ONEUPTIME_AI_DATABASE_NAME: "a\nb" }),
      /^ONEUPTIME_AI_DATABASE_NAME is not a database name/,
    );
    assert.match(
      problemOf({ ...POSTGRES, ONEUPTIME_AI_DATABASE_CA_FILE: "/a\u0000b" }),
      /^ONEUPTIME_AI_DATABASE_CA_FILE is not a file path/,
    );
  });

  test("only the given environment is read, never process.env", () => {
    const saved: string | undefined = process.env["DATABASE_PASSWORD"];
    process.env["DATABASE_PASSWORD"] = "from-process-env";

    try {
      assert.strictEqual(
        settingsOf({ ...POSTGRES, DATABASE_PASSWORD: "given" }).password,
        "given",
      );
      assert.strictEqual(
        settingsOf({ ...POSTGRES, DATABASE_PASSWORD: undefined }).password,
        "",
      );
    } finally {
      if (saved === undefined) {
        delete process.env["DATABASE_PASSWORD"];
      } else {
        process.env["DATABASE_PASSWORD"] = saved;
      }
    }
  });
});
