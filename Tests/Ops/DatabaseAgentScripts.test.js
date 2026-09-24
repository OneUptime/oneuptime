"use strict";

/**
 * The Database Agent's install.sh and troubleshoot.sh, run for real in a
 * scratch directory with `docker` and `curl` replaced by recording stubs.
 *
 * DatabaseAgentConfigs.test.js pins what the scripts SAY; this runs them,
 * because the bugs that matter here are in what they DO with a user's
 * values:
 *
 *  - the collector expands `$` inside the values it reads once more (`$$`
 *    becomes `$`, `${NAME}` another variable), so the login must reach the
 *    container with every `$` doubled — and a re-run must not double it
 *    again, while an .env from an older install.sh (values as typed) must be
 *    read as typed;
 *  - Compose gives exported variables precedence over .env, so the first
 *    start must run from .env alone, exactly like every later restart;
 *  - a re-run (the upgrade path) replaces the compose file and config, so a
 *    copy the user edited must be kept and named, not silently discarded;
 *  - a fork runs its family's config and still reports its own engine;
 *  - the diagnostic must not read a failed EXPLAIN (or a table called
 *    `certificates` in the query text) as a grant or TLS problem, and must
 *    never put the ingestion key on a command line.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "DatabaseAgent");
const INSTALL = path.join(AGENT_DIR, "install.sh");
const TROUBLESHOOT = path.join(AGENT_DIR, "troubleshoot.sh");
const MARKER =
  "# DATABASE_USERNAME and DATABASE_PASSWORD are escaped for the collector: every $ is written as $$.";

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-agent-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

/*
 * `curl` serves the agent's files from this checkout (and records each
 * URL); `docker` succeeds and records its arguments and — for
 * `compose up` — whether the login reached it through the environment.
 */
function installStubs(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  writeExecutable(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
url=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$STUB_DIR/curl.log"
rel="\${url#https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/}"
[ -f "${AGENT_DIR}/$rel" ] || exit 22
cp "${AGENT_DIR}/$rel" "$out"
`,
  );
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/docker.log"
if [ "$1" = "compose" ] && [ "$2" = "up" ]; then
  printf 'DATABASE_PASSWORD=%s\\n' "\${DATABASE_PASSWORD-<unset>}" >> "$STUB_DIR/compose-env.log"
  printf 'DATABASE_ENDPOINT=%s\\n' "\${DATABASE_ENDPOINT-<unset>}" >> "$STUB_DIR/compose-env.log"
fi
exit 0
`,
  );
  return bin;
}

function runInstall(dir, env) {
  const bin = fs.existsSync(path.join(dir, "bin"))
    ? path.join(dir, "bin")
    : installStubs(dir);
  const installDir = path.join(dir, "agent");
  const result = spawnSync("bash", [INSTALL], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      STUB_DIR: dir,
      INSTALL_DIR: installDir,
      ...env,
    },
    input: "",
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    installDir,
    envFile: () => {
      return fs.readFileSync(path.join(installDir, ".env"), "utf8");
    },
    envLine: (name) => {
      const line = fs
        .readFileSync(path.join(installDir, ".env"), "utf8")
        .split("\n")
        .find((text) => {
          return text.startsWith(`${name}=`);
        });
      return line === undefined ? undefined : line.substring(name.length + 1);
    },
  };
}

const BASE = {
  ONEUPTIME_URL: "https://oneuptime.example.com/",
  ONEUPTIME_TELEMETRY_INGESTION_KEY: "ingest-key",
  DATABASE_SERVER_ADDRESS: "db.example.com",
  DATABASE_TLS_INSECURE: "true",
  DATABASE_QUERY_EVENTS: "false",
};

describe("install.sh", () => {
  test("escapes every $ of the login for the collector, and quotes it for Compose", () => {
    const dir = scratch();
    const run = runInstall(dir, {
      ...BASE,
      DATABASE_SYSTEM: "MariaDB",
      DATABASE_ENDPOINT: "maria.example.com",
      DATABASE_USERNAME: "mon$tor",
      DATABASE_PASSWORD: "My$$pa${ss}word$",
    });

    expect(run.status).toBe(0);
    expect(run.envFile().split("\n")[0]).toBe(MARKER);
    // Compose reads single quotes literally; the collector then halves $$.
    expect(run.envLine("DATABASE_PASSWORD")).toBe("'My$$$$pa$${ss}word$$'");
    expect(run.envLine("DATABASE_USERNAME")).toBe("'mon$$tor'");
  });

  test("a value Compose cannot single-quote is double-quoted, escaped for the collector first", () => {
    const run = runInstall(scratch(), {
      ...BASE,
      DATABASE_SYSTEM: "postgresql",
      DATABASE_ENDPOINT: "db.example.com:5432",
      DATABASE_USERNAME: "monitor",
      DATABASE_PASSWORD: "it's$x",
    });

    expect(run.status).toBe(0);
    // Collector: $ → $$; Compose (double quotes): each $ → $$ again.
    expect(run.envLine("DATABASE_PASSWORD")).toBe('"it\'s$$$$x"');
  });

  test("starts the agent from .env alone, never from the exported (unescaped) values", () => {
    const dir = scratch();
    const run = runInstall(dir, {
      ...BASE,
      DATABASE_SYSTEM: "postgresql",
      DATABASE_ENDPOINT: "db.example.com",
      DATABASE_USERNAME: "monitor",
      DATABASE_PASSWORD: "pa$$word",
    });

    expect(run.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "compose-env.log"), "utf8")).toBe(
      "DATABASE_PASSWORD=<unset>\nDATABASE_ENDPOINT=<unset>\n",
    );
  });

  test("a re-run reuses the escaped login as the value it stands for — no second escaping", () => {
    const dir = scratch();
    const first = runInstall(dir, {
      ...BASE,
      DATABASE_SYSTEM: "postgresql",
      DATABASE_ENDPOINT: "db.example.com",
      DATABASE_USERNAME: "monitor",
      DATABASE_PASSWORD: "a$$b${c}",
    });
    const before = first.envFile();

    const again = runInstall(dir, {});

    expect(again.status).toBe(0);
    expect(again.output).toContain("reusing it");
    expect(again.envFile()).toBe(before);
    expect(again.envLine("DATABASE_PASSWORD")).toBe("'a$$$$b$${c}'");
  });

  test("an .env from an older install.sh holds the login as typed, and is escaped on the re-run", () => {
    const dir = scratch();
    const installDir = path.join(dir, "agent");
    fs.mkdirSync(installDir);
    fs.writeFileSync(
      path.join(installDir, ".env"),
      [
        "ONEUPTIME_URL='https://oneuptime.example.com'",
        "ONEUPTIME_TELEMETRY_INGESTION_KEY='ingest-key'",
        "DATABASE_SYSTEM=postgresql",
        "DATABASE_ENDPOINT='db.example.com:5432'",
        "DATABASE_SERVER_ADDRESS='db.example.com'",
        "DATABASE_SERVER_PORT=5432",
        "DATABASE_USERNAME='monitor'",
        "DATABASE_PASSWORD='pa$word'",
        "DATABASE_TLS_INSECURE=true",
        "DATABASE_TLS_INSECURE_SKIP_VERIFY=false",
        "DATABASE_COLLECTION_INTERVAL=30s",
        "DATABASE_QUERY_EVENTS=false",
        "DATABASE_SERVER_ID=''",
        "",
      ].join("\n"),
    );

    const run = runInstall(dir, {});

    expect(run.status).toBe(0);
    expect(run.envLine("DATABASE_PASSWORD")).toBe("'pa$$word'");
    expect(run.envFile().split("\n")[0]).toBe(MARKER);
    // The variables that did not exist then are written now.
    expect(run.envLine("DATABASE_ENDPOINT_HOST")).toBe("'db.example.com'");
    expect(run.envLine("DATABASE_ENDPOINT_PORT")).toBe("5432");
  });

  test("a re-run keeps a copy of every file the user edited, names it, and leaves untouched files alone", () => {
    const dir = scratch();
    const env = {
      ...BASE,
      DATABASE_SYSTEM: "redis",
      DATABASE_ENDPOINT: "cache.example.com",
      DATABASE_USERNAME: "",
      DATABASE_PASSWORD: "secret",
    };
    const first = runInstall(dir, env);
    expect(first.status).toBe(0);

    const compose = path.join(first.installDir, "docker-compose.yml");
    const edited = fs
      .readFileSync(compose, "utf8")
      .replace("# network_mode: host", "network_mode: host");
    fs.writeFileSync(compose, edited);

    const again = runInstall(dir, env);
    const backups = fs.readdirSync(first.installDir).filter((file) => {
      return file.includes(".bak.");
    });

    expect(again.status).toBe(0);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^docker-compose\.yml\.bak\.\d{14}$/);
    expect(
      fs.readFileSync(path.join(first.installDir, backups[0]), "utf8"),
    ).toBe(edited);
    expect(again.output).toContain(backups[0]);
    expect(again.output).toContain("Re-apply your edits");
    // The new file is the shipped one, readable by the collector's user.
    expect(fs.readFileSync(compose, "utf8")).toBe(
      fs.readFileSync(path.join(AGENT_DIR, "docker-compose.yml"), "utf8"),
    );
    expect(
      fs.statSync(path.join(first.installDir, "otel-collector-config.yaml"))
        .mode & 0o777,
    ).toBe(0o644);

    // A third run with nothing edited keeps nothing.
    const third = runInstall(dir, env);
    expect(third.output).not.toContain("Re-apply your edits");
  });

  test.each([
    ["MariaDB", "mariadb", "mysql"],
    ["percona", "mysql", "mysql"],
    ["valkey", "valkey", "redis"],
    ["dragonflydb", "dragonfly", "redis"],
    ["keydb", "keydb", "redis"],
    ["mongo", "mongodb", "mongodb"],
    ["opensearch", "opensearch", "elasticsearch"],
  ])(
    "%s is written as %s and runs configs/%s.yaml",
    (typed, system, config) => {
      const dir = scratch();
      const run = runInstall(dir, {
        ...BASE,
        DATABASE_SYSTEM: typed,
        DATABASE_ENDPOINT: "db.example.com:1234",
        DATABASE_USERNAME: "monitor",
        DATABASE_PASSWORD: "secret",
      });

      expect(run.status).toBe(0);
      expect(run.envLine("DATABASE_SYSTEM")).toBe(system);
      expect(
        fs.readFileSync(
          path.join(run.installDir, "otel-collector-config.yaml"),
          "utf8",
        ),
      ).toBe(
        fs.readFileSync(
          path.join(AGENT_DIR, "configs", `${config}.yaml`),
          "utf8",
        ),
      );
    },
  );

  test("SQL Server: the host and port are written apart, and a password with a semicolon is refused", () => {
    const ok = runInstall(scratch(), {
      ...BASE,
      DATABASE_SYSTEM: "mssql",
      DATABASE_ENDPOINT: "sql.example.com",
      DATABASE_SERVER_ADDRESS: "sql.example.com",
      DATABASE_USERNAME: "oneuptime_monitor",
      DATABASE_PASSWORD: "S3cret!",
    });

    expect(ok.status).toBe(0);
    expect(ok.envLine("DATABASE_SYSTEM")).toBe("microsoft.sql_server");
    expect(ok.envLine("DATABASE_ENDPOINT")).toBe("'sql.example.com:1433'");
    expect(ok.envLine("DATABASE_ENDPOINT_HOST")).toBe("'sql.example.com'");
    expect(ok.envLine("DATABASE_ENDPOINT_PORT")).toBe("1433");

    const refused = runInstall(scratch(), {
      ...BASE,
      DATABASE_SYSTEM: "sqlserver",
      DATABASE_ENDPOINT: "sql.example.com",
      DATABASE_USERNAME: "oneuptime_monitor",
      DATABASE_PASSWORD: "a;b",
    });

    expect(refused.status).not.toBe(0);
    expect(refused.output).toContain("cannot contain a semicolon");
  });

  test("Oracle needs the service to connect to", () => {
    const missing = runInstall(scratch(), {
      ...BASE,
      DATABASE_SYSTEM: "oracle",
      DATABASE_ENDPOINT: "ora.example.com",
      DATABASE_USERNAME: "oneuptime_monitor",
      DATABASE_PASSWORD: "secret",
    });

    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("DATABASE_ORACLE_SERVICE is required");

    const given = runInstall(scratch(), {
      ...BASE,
      DATABASE_SYSTEM: "oracle",
      DATABASE_ENDPOINT: "ora.example.com",
      DATABASE_ORACLE_SERVICE: "FREEPDB1",
      DATABASE_USERNAME: "oneuptime_monitor",
      DATABASE_PASSWORD: "secret",
    });

    expect(given.status).toBe(0);
    expect(given.envLine("DATABASE_SYSTEM")).toBe("oracle.db");
    expect(given.envLine("DATABASE_ENDPOINT")).toBe("'ora.example.com:1521'");
    expect(given.envLine("DATABASE_ORACLE_SERVICE")).toBe("'FREEPDB1'");
  });

  test("Elasticsearch / OpenSearch get a URL, and https:// turns TLS on", () => {
    const tls = runInstall(scratch(), {
      ONEUPTIME_URL: BASE.ONEUPTIME_URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: BASE.ONEUPTIME_TELEMETRY_INGESTION_KEY,
      DATABASE_SERVER_ADDRESS: "search.example.com",
      DATABASE_SYSTEM: "elasticsearch",
      DATABASE_ENDPOINT: "https://search.example.com",
      DATABASE_USERNAME: "",
      DATABASE_PASSWORD: "",
    });

    expect(tls.status).toBe(0);
    expect(tls.envLine("DATABASE_ENDPOINT")).toBe(
      "'https://search.example.com:9200'",
    );
    expect(tls.envLine("DATABASE_TLS_INSECURE")).toBe("false");
    expect(tls.envLine("DATABASE_SERVER_PORT")).toBe("9200");

    const plain = runInstall(scratch(), {
      ...BASE,
      DATABASE_SYSTEM: "opensearch",
      DATABASE_ENDPOINT: "search.example.com:9201",
      DATABASE_USERNAME: "",
      DATABASE_PASSWORD: "",
    });

    expect(plain.status).toBe(0);
    expect(plain.envLine("DATABASE_ENDPOINT")).toBe(
      "'http://search.example.com:9201'",
    );
  });

  test("Memcached installs without asking for a login or TLS it cannot use", () => {
    const run = runInstall(scratch(), {
      ONEUPTIME_URL: BASE.ONEUPTIME_URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: BASE.ONEUPTIME_TELEMETRY_INGESTION_KEY,
      DATABASE_SERVER_ADDRESS: "cache.example.com",
      DATABASE_SYSTEM: "memcached",
      DATABASE_ENDPOINT: "cache.example.com",
      // Ignored: the receiver has no login.
      DATABASE_PASSWORD: "unused",
    });

    expect(run.status).toBe(0);
    expect(run.output).not.toMatch(/Monitoring user|Password for|over TLS/);
    expect(run.envLine("DATABASE_ENDPOINT")).toBe("'cache.example.com:11211'");
    expect(run.envLine("DATABASE_USERNAME")).toBe("''");
    expect(run.envLine("DATABASE_PASSWORD")).toBe("''");
    expect(run.envLine("DATABASE_TLS_INSECURE")).toBe("true");
  });

  test("an engine without a config is refused with the list it does have", () => {
    const run = runInstall(scratch(), {
      ...BASE,
      DATABASE_SYSTEM: "cassandra",
      DATABASE_ENDPOINT: "db.example.com",
    });

    expect(run.status).toBe(1);
    expect(run.output).toContain("not an engine this agent ships a config for");
    expect(run.output).toContain("sqlserver, oracle, elasticsearch");
  });
});

/*
 * troubleshoot.sh against a fake agent: `docker` answers from files the
 * test writes (the container's environment, its log) and records every
 * command line and what was piped to it.
 */
function troubleshootStubs(dir, { env, logs }) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, "container.env"), `${env.join("\n")}\n`);
  fs.writeFileSync(path.join(dir, "container.log"), `${logs.join("\n")}\n`);
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/argv.log"
case "$1" in
  info) exit 0 ;;
  compose) printf 'cid123\\n'; exit 0 ;;
  inspect)
    case "$*" in
      *State.Status*) printf 'running restarting=false restarts=0\\n' ;;
      *Config.Env*) cat "$STUB_DIR/container.env" ;;
    esac
    exit 0 ;;
  logs) cat "$STUB_DIR/container.log"; exit 0 ;;
  run)
    stdin="$(cat)"
    if [ -n "$stdin" ]; then printf '%s\\n' "$stdin" >> "$STUB_DIR/stdin.log"; fi
    case "$*" in
      *telnet://*) printf '* Connected to db (10.0.0.5) port 5432\\n' ;;
      */otlp/v1/validate*) printf '200' ;;
    esac
    exit 0 ;;
esac
exit 0
`,
  );
  return bin;
}

function runTroubleshoot({ config, env, logs, envFile }) {
  const dir = scratch();
  const bin = troubleshootStubs(dir, { env, logs });
  const installDir = path.join(dir, "agent");
  fs.mkdirSync(installDir);
  fs.copyFileSync(
    path.join(AGENT_DIR, "docker-compose.yml"),
    path.join(installDir, "docker-compose.yml"),
  );
  fs.copyFileSync(
    path.join(AGENT_DIR, "configs", `${config}.yaml`),
    path.join(installDir, "otel-collector-config.yaml"),
  );
  fs.writeFileSync(
    path.join(installDir, ".env"),
    envFile === undefined ? `${MARKER}\n` : envFile,
  );
  const result = spawnSync(
    "bash",
    [TROUBLESHOOT, "-d", installDir, "--no-color"],
    {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir },
      encoding: "utf8",
    },
  );
  const read = (file) => {
    const target = path.join(dir, file);
    return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  };
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    argv: read("argv.log"),
    stdin: read("stdin.log"),
  };
}

const TOKEN = 'tok"en\\with$pecial';
const POSTGRES_ENV = [
  "DATABASE_SYSTEM=postgresql",
  "DATABASE_ENDPOINT=db.example.com:5432",
  "DATABASE_SERVER_ADDRESS=db.example.com",
  "DATABASE_SERVER_PORT=5432",
  "DATABASE_USERNAME=oneuptime_monitor",
  "DATABASE_PASSWORD=secret",
  "ONEUPTIME_URL=https://oneuptime.example.com",
  `ONEUPTIME_TELEMETRY_INGESTION_KEY=${TOKEN}`,
];

function receiverLine(message, fields) {
  return `2026-09-24T20:14:56.356Z\terror\tpostgresqlreceiver@v0.161.0/scraper.go:521\t${message}\t${JSON.stringify(
    {
      resource: { "service.name": "otelcol-contrib" },
      "otelcol.component.id": "postgresql",
      "otelcol.component.kind": "receiver",
      ...fields,
    },
  ).replace(/":/g, '": ')}`;
}

describe("troubleshoot.sh", () => {
  /*
   * Regression: with the documented pg_monitor grant and query events on,
   * every top query whose EXPLAIN needs table access logged `permission
   * denied`, and a table named `certificates` in the query text read as a
   * TLS problem — the script told users to grant pg_monitor (which they
   * had) and to fix TLS (which was fine).
   */
  test("a failed EXPLAIN is a warning about plans, not a missing grant or a TLS problem", () => {
    const run = runTroubleshoot({
      config: "postgresql",
      env: POSTGRES_ENV,
      logs: [
        receiverLine("failed to explain statement", {
          query: "SELECT * FROM certificates WHERE email = $1",
          error: "pq: permission denied for table certificates (42501)",
        }),
        receiverLine("failed to explain query", {
          query: "SELECT * FROM certificates",
          error: "pq: permission denied for table certificates (42501)",
        }),
        "2026-09-24T20:14:50Z\tinfo\tservice@v0.161.0/service.go:256\tEverything is ready. Begin running and processing data.",
      ],
    });

    expect(run.output).toContain("2 top quer(y/ies) could not be EXPLAINed");
    expect(run.output).not.toContain("missing privileges");
    expect(run.output).not.toContain("TLS problem");
    expect(run.status).toBe(0);
  });

  test("a query that merely mentions a keyword is not an error, but the error field still counts", () => {
    const quiet = runTroubleshoot({
      config: "postgresql",
      env: POSTGRES_ENV,
      logs: [
        receiverLine("slow scrape", {
          query:
            "UPDATE certificates SET note = 'password authentication failed'",
          error: "context deadline exceeded",
        }),
      ],
    });

    expect(quiet.output).not.toContain("REJECTING the login");
    expect(quiet.output).not.toContain("TLS problem");

    const auth = runTroubleshoot({
      config: "postgresql",
      env: POSTGRES_ENV,
      logs: [
        receiverLine("Error scraping metrics", {
          error:
            'pq: password authentication failed for user "oneuptime_monitor"',
        }),
      ],
    });

    expect(auth.output).toContain("REJECTING the login");
    expect(auth.output).toContain("every $ must be written as $$");
    expect(auth.status).toBe(1);

    const grant = runTroubleshoot({
      config: "postgresql",
      env: POSTGRES_ENV,
      logs: [
        receiverLine("Error scraping metrics", {
          error: "pq: permission denied for view pg_stat_replication",
        }),
      ],
    });

    expect(grant.output).toContain("missing privileges");
  });

  test("the ingestion key reaches curl on stdin, never on any command line, through the pinned image", () => {
    const run = runTroubleshoot({
      config: "postgresql",
      env: POSTGRES_ENV,
      logs: [],
    });
    const script = fs.readFileSync(TROUBLESHOOT, "utf8");
    const image = script.match(/^CURL_IMAGE="([^"]+)"$/m);

    expect(image).not.toBeNull();
    expect(image[1]).toMatch(
      /^curlimages\/curl:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/,
    );
    expect(run.output).toContain("ingestion key is VALID");
    expect(run.argv).not.toContain("tok");
    expect(run.argv).toContain(image[1]);
    expect(run.argv).toMatch(/--config - .*\/otlp\/v1\/validate/);
    // Curl config quoting: \ and " escaped inside the double quotes.
    expect(run.stdin).toContain(
      'header = "x-oneuptime-token: tok\\"en\\\\with$pecial"',
    );
  });

  test("a fork's engine is checked against its family's config", () => {
    const mariadbEnv = POSTGRES_ENV.map((line) => {
      return line.startsWith("DATABASE_SYSTEM=")
        ? "DATABASE_SYSTEM=mariadb"
        : line;
    });

    const matching = runTroubleshoot({
      config: "mysql",
      env: mariadbEnv,
      logs: [],
    });
    expect(matching.output).toContain("Engine: mariadb (configs/mysql.yaml)");
    expect(matching.output).toContain(
      "otel-collector-config.yaml is the mysql config",
    );

    const mismatched = runTroubleshoot({
      config: "postgresql",
      env: mariadbEnv,
      logs: [],
    });
    expect(mismatched.output).toContain(
      "otel-collector-config.yaml is not the mysql config",
    );
    expect(mismatched.status).toBe(1);
  });

  test("warns when a $ in the password was written before install.sh escaped it", () => {
    const env = POSTGRES_ENV.map((line) => {
      return line.startsWith("DATABASE_PASSWORD=")
        ? "DATABASE_PASSWORD=pa$$word"
        : line;
    });

    const old = runTroubleshoot({
      config: "postgresql",
      env,
      logs: [],
      envFile: "DATABASE_SYSTEM=postgresql\n",
    });
    expect(old.output).toContain("DATABASE_PASSWORD contains $");
    expect(old.output).not.toContain("pa$$word");

    const escaped = runTroubleshoot({ config: "postgresql", env, logs: [] });
    expect(escaped.output).not.toContain("DATABASE_PASSWORD contains $");
  });

  test("probes an Elasticsearch URL endpoint by its host and port", () => {
    const env = [
      "DATABASE_SYSTEM=opensearch",
      "DATABASE_ENDPOINT=https://search.example.com:9200",
      "DATABASE_SERVER_ADDRESS=search.example.com",
      "DATABASE_SERVER_PORT=9200",
      "ONEUPTIME_URL=https://oneuptime.example.com",
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${TOKEN}`,
    ];

    const run = runTroubleshoot({ config: "elasticsearch", env, logs: [] });

    expect(run.argv).toContain("telnet://search.example.com:9200");
    expect(run.output).toContain(
      "Engine: opensearch (configs/elasticsearch.yaml)",
    );
  });
});
