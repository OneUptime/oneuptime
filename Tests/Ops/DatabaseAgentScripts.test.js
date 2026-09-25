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
 *    again, whether install.sh or a person following the docs wrote the
 *    .env;
 *  - Compose gives exported variables precedence over .env, so the first
 *    start must run from .env alone, exactly like every later restart;
 *  - a re-run (the upgrade path) replaces the compose file and config, so a
 *    copy the user edited must be kept and named, not silently discarded —
 *    and a file nobody edited is replaced without a word, however much the
 *    new version changed;
 *  - the SQL Server receiver builds an unquoted connection string from the
 *    login, so what that string cannot carry is refused up front;
 *  - a fork runs its family's config and still reports its own engine;
 *  - the diagnostic must not read a failed EXPLAIN (or a table called
 *    `certificates` in the query text) as a grant or TLS problem, must not
 *    answer "No problems found" over a receiver error it does not
 *    recognise, and must never put the ingestion key on a command line.
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
 * `curl` serves the agent's files from this checkout — or from SERVE_DIR,
 * a copy standing in for a newer upstream — and records each URL; `docker`
 * succeeds and records its arguments and — for `compose up` — whether the
 * login reached it through the environment, and the config it would start.
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
served="\${SERVE_DIR:-${AGENT_DIR}}"
[ -f "$served/$rel" ] || exit 22
cp "$served/$rel" "$out"
`,
  );
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/docker.log"
if [ "$1" = "compose" ] && [ "$2" = "up" ]; then
  printf 'DATABASE_PASSWORD=%s\\n' "\${DATABASE_PASSWORD-<unset>}" >> "$STUB_DIR/compose-env.log"
  printf 'DATABASE_ENDPOINT=%s\\n' "\${DATABASE_ENDPOINT-<unset>}" >> "$STUB_DIR/compose-env.log"
  cp otel-collector-config.yaml "$STUB_DIR/config-at-up.yaml" 2>/dev/null || true
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

  /*
   * Regression: install.sh only trusted an .env carrying its marker line,
   * and read any other as holding the login as typed. The .env the docs
   * and the README tell people to write — every `$` already doubled — had
   * no marker, so re-running install.sh (the documented upgrade) doubled
   * every `$` a second time and the database rejected the password.
   */
  test("the README's hand-written .env (every $ doubled) is not escaped a second time on a re-run", () => {
    const dir = scratch();
    const installDir = path.join(dir, "agent");
    const readme = fs.readFileSync(path.join(AGENT_DIR, "README.md"), "utf8");
    const section = readme.substring(
      readme.indexOf("## Quick Start — Docker Compose"),
    );
    const sample = section.match(/```bash\n([\s\S]*?)\n```/)[1];

    // The sample says what it holds, in install.sh's own words.
    expect(sample.split("\n")[0]).toBe(MARKER);

    // pa$word and mon$tor, written by the docs' rule.
    const handWritten = sample
      .replace(/^DATABASE_PASSWORD=.*$/m, "DATABASE_PASSWORD='pa$$word'")
      .replace(/^DATABASE_USERNAME=.*$/m, "DATABASE_USERNAME=mon$$tor");
    fs.mkdirSync(installDir);
    fs.writeFileSync(path.join(installDir, ".env"), `${handWritten}\n`);

    const run = runInstall(dir, {});

    expect(run.status).toBe(0);
    expect(run.envLine("DATABASE_PASSWORD")).toBe("'pa$$word'");
    expect(run.envLine("DATABASE_USERNAME")).toBe("'mon$$tor'");
    expect(run.envFile().split("\n")[0]).toBe(MARKER);

    // Without the marker line it is the same file, read the same way.
    const unmarked = scratch();
    fs.mkdirSync(path.join(unmarked, "agent"));
    fs.writeFileSync(
      path.join(unmarked, "agent", ".env"),
      `${handWritten.split("\n").slice(1).join("\n")}\n`,
    );
    const again = runInstall(unmarked, {});

    expect(again.status).toBe(0);
    expect(again.envLine("DATABASE_PASSWORD")).toBe("'pa$$word'");
    expect(again.envLine("DATABASE_USERNAME")).toBe("'mon$$tor'");
  });

  test("a lone $ a hand-written .env forgot to double stands for itself, and is escaped on the re-run", () => {
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
    // The variables the file did not have are written now.
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
    expect(again.output).toContain("you had edited");
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

  /*
   * Regression: a re-run compared the new download with the installed
   * file, not with what install.sh had installed, so every upgrade that
   * changed a file upstream — a collector pin bump changes the compose
   * file and every config — backed up files nobody had touched and told
   * the user to re-apply edits they never made.
   */
  test("a re-run replaces a file nobody edited without a backup, however much the new version changed", () => {
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

    // A newer upstream: the pin bump touches the compose file and the config.
    const upstream = path.join(scratch(), "upstream");
    fs.cpSync(AGENT_DIR, upstream, { recursive: true });
    const bump = (relative) => {
      const file = path.join(upstream, relative);
      fs.writeFileSync(
        file,
        fs.readFileSync(file, "utf8").split("0.161.0").join("0.999.0"),
      );
    };
    bump("docker-compose.yml");
    bump(path.join("configs", "redis.yaml"));

    const upgraded = runInstall(dir, { ...env, SERVE_DIR: upstream });
    const backups = () => {
      return fs.readdirSync(first.installDir).filter((file) => {
        return file.includes(".bak.");
      });
    };

    expect(upgraded.status).toBe(0);
    expect(backups()).toEqual([]);
    expect(upgraded.output).not.toContain("NOTE:");
    expect(
      fs.readFileSync(
        path.join(first.installDir, "docker-compose.yml"),
        "utf8",
      ),
    ).toContain("opentelemetry-collector-contrib:0.999.0");
    expect(
      fs.readFileSync(
        path.join(first.installDir, "otel-collector-config.yaml"),
        "utf8",
      ),
    ).toBe(
      fs.readFileSync(path.join(upstream, "configs", "redis.yaml"), "utf8"),
    );

    /*
     * An install directory without the record (one an install.sh from
     * before it was kept set up) cannot tell an edit from an upstream
     * change: it keeps both copies and says only that they differed.
     */
    fs.rmSync(path.join(first.installDir, ".agent-files.sha256"));
    const unknown = runInstall(dir, env);

    expect(unknown.status).toBe(0);
    expect(backups().sort()).toEqual([
      expect.stringMatching(/^docker-compose\.yml\.bak\.\d{14}$/),
      expect.stringMatching(/^otel-collector-config\.yaml\.bak\.\d{14}$/),
    ]);
    expect(unknown.output).toContain("differ from the new versions");
    expect(unknown.output).not.toContain("you had edited");
    expect(
      fs.existsSync(path.join(first.installDir, ".agent-files.sha256")),
    ).toBe(true);
  });

  /*
   * Regression (live re-verification): a re-run downloaded the new
   * otel-collector-config.yaml and then ran a plain `docker compose up -d`.
   * Compose recreates a running container only when its service definition
   * or environment changed — the content of a bind-mounted file is not part
   * of that — and the collector reads its config only when it starts, so
   * the agent kept running the old config (MySQL query events kept arriving
   * as `{}`) until someone restarted it by hand. The advice printed after
   * replacing an edited file said the same plain `up -d`.
   */
  test("a re-run recreates the agent on the new config, and every `compose up` it advises does too", () => {
    const dir = scratch();
    const env = {
      ...BASE,
      DATABASE_SYSTEM: "mysql",
      DATABASE_ENDPOINT: "db.example.com",
      DATABASE_USERNAME: "monitor",
      DATABASE_PASSWORD: "secret",
    };
    const first = runInstall(dir, env);
    expect(first.status).toBe(0);

    // A newer upstream changes the config only: docker-compose.yml and .env
    // stay byte-for-byte the same, so Compose alone would keep the container.
    const upstream = path.join(scratch(), "upstream");
    fs.cpSync(AGENT_DIR, upstream, { recursive: true });
    const upstreamConfig = path.join(upstream, "configs", "mysql.yaml");
    fs.writeFileSync(
      upstreamConfig,
      `${fs.readFileSync(upstreamConfig, "utf8")}# a newer config\n`,
    );
    // And the user had edited the compose file, so the edit advice prints.
    const compose = path.join(first.installDir, "docker-compose.yml");
    fs.writeFileSync(
      compose,
      fs
        .readFileSync(compose, "utf8")
        .replace("# network_mode: host", "network_mode: host"),
    );
    const composeBefore = fs.readFileSync(
      path.join(upstream, "docker-compose.yml"),
      "utf8",
    );
    const envBefore = first.envFile();

    const upgraded = runInstall(dir, { ...env, SERVE_DIR: upstream });

    expect(upgraded.status).toBe(0);
    expect(fs.readFileSync(compose, "utf8")).toBe(composeBefore);
    expect(upgraded.envFile()).toBe(envBefore);
    // The container is recreated, and from the config just downloaded.
    const composeUps = fs
      .readFileSync(path.join(dir, "docker.log"), "utf8")
      .split("\n")
      .filter((line) => {
        return line.startsWith("compose up");
      });
    expect(composeUps).toEqual([
      "compose up -d --force-recreate",
      "compose up -d --force-recreate",
    ]);
    expect(fs.readFileSync(path.join(dir, "config-at-up.yaml"), "utf8")).toBe(
      fs.readFileSync(upstreamConfig, "utf8"),
    );
    expect(upgraded.output).toContain("Re-apply your edits");

    // Without the record, the "may hold edits" advice prints instead.
    fs.writeFileSync(
      compose,
      fs
        .readFileSync(compose, "utf8")
        .replace("# network_mode: host", "network_mode: host"),
    );
    fs.rmSync(path.join(first.installDir, ".agent-files.sha256"));
    const unrecorded = runInstall(dir, { ...env, SERVE_DIR: upstream });
    expect(unrecorded.status).toBe(0);
    expect(unrecorded.output).toContain("differ from the new versions");

    for (const run of [first, upgraded, unrecorded]) {
      const advice = run.output.split("\n").filter((line) => {
        return line.includes("docker compose up");
      });
      expect(advice.length).toBeGreaterThan(0);
      for (const line of advice) {
        expect(line).toMatch(/docker compose up -d --force-recreate$/);
      }
    }
    expect(first.output).toContain(
      `To apply edits:   cd ${first.installDir} && docker compose up -d --force-recreate`,
    );
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

  /*
   * Regression: the receiver builds `server=…;user id=…;password=…;port=…`
   * without quoting, and its driver treats every `"` as the start or end of
   * a quoted value and trims the spaces around each value. A password with
   * a `"` (or a leading or trailing space) was accepted here, written
   * correctly, and then failed every login with 18456 — for a reason
   * nothing named.
   */
  test.each([
    ["DATABASE_PASSWORD", 'Qu0te"Pass!9', "a double quote"],
    ["DATABASE_PASSWORD", "Trail_Pass!9 ", "a leading or trailing space"],
    ["DATABASE_PASSWORD", " Lead_Pass!9", "a leading or trailing space"],
    ["DATABASE_USERNAME", "mon;itor", "a semicolon"],
    ["DATABASE_USERNAME", 'mon"itor', "a double quote"],
  ])(
    "SQL Server: %s with %j is refused, naming what the connection string cannot carry",
    (name, value, what) => {
      const run = runInstall(scratch(), {
        ...BASE,
        DATABASE_SYSTEM: "sqlserver",
        DATABASE_ENDPOINT: "sql.example.com",
        DATABASE_USERNAME: "oneuptime_monitor",
        DATABASE_PASSWORD: "S3cret!",
        [name]: value,
      });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain(`${name} cannot contain ${what}`);
      expect(run.output).not.toContain(value.trim());
      expect(fs.existsSync(path.join(run.installDir, ".env"))).toBe(false);
    },
  );

  test("SQL Server: $, ' and spaces inside the password are fine", () => {
    const run = runInstall(scratch(), {
      ...BASE,
      DATABASE_SYSTEM: "sqlserver",
      DATABASE_ENDPOINT: "sql.example.com",
      DATABASE_USERNAME: "oneuptime_monitor",
      DATABASE_PASSWORD: "it's a $ecret",
    });

    expect(run.status).toBe(0);
    expect(run.envLine("DATABASE_PASSWORD")).toBe('"it\'s a $$$$ecret"');
  });

  /*
   * Regression: the in-app guide put a SQL Server named instance
   * (`host\instance`) on the install command line unquoted — the shell ate
   * the backslash — and a backslash typed at the endpoint prompt reached
   * the receiver with the default instance's port 1433 appended.
   */
  test.each([["DATABASE_ENDPOINT"], ["DATABASE_SERVER_ADDRESS"]])(
    "a named instance (host\\instance) in %s is refused, asking for its TCP port",
    (name) => {
      const run = runInstall(scratch(), {
        ...BASE,
        DATABASE_SYSTEM: "sqlserver",
        DATABASE_ENDPOINT: "sql1.example.com:14330",
        DATABASE_USERNAME: "oneuptime_monitor",
        DATABASE_PASSWORD: "S3cret!",
        [name]: "sql1.example.com\\INST01",
      });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain("named instance");
      expect(run.output).toContain("local_tcp_port");
    },
  );

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

  /*
   * Regression: the warning fired for every `$` in an .env without
   * install.sh's marker line — including the hand-written .env the docs
   * describe, whose `$` were correctly doubled — and advised doubling them
   * again or re-running install.sh, which (then) did.
   */
  test("warns about a $ in the login only when it is not doubled, marker line or not", () => {
    const withPassword = (password) => {
      return POSTGRES_ENV.map((line) => {
        return line.startsWith("DATABASE_PASSWORD=")
          ? `DATABASE_PASSWORD=${password}`
          : line;
      });
    };
    const unmarked = "DATABASE_SYSTEM=postgresql\n";

    // The container holds what the collector reads: pa$word, escaped.
    for (const envFile of [unmarked, undefined]) {
      const doubled = runTroubleshoot({
        config: "postgresql",
        env: withPassword("pa$$word$${x}"),
        logs: [],
        envFile,
      });
      expect(doubled.output).not.toContain("contains a $");
      expect(doubled.status).toBe(0);
    }

    // A lone $ is expanded by the collector: the password reaching the
    // database is not the one written.
    for (const password of ["pa$word", "pa$$$word", "${HOME}x"]) {
      const lone = runTroubleshoot({
        config: "postgresql",
        env: withPassword(password),
        logs: [],
        envFile: unmarked,
      });
      expect(lone.output).toContain(
        "DATABASE_PASSWORD contains a $ that is not doubled",
      );
      expect(lone.output).not.toContain(password);
      expect(lone.output).not.toContain("re-run install.sh");
    }
  });

  /*
   * Regression: receiver errors that matched none of the fixed patterns —
   * MySQL / MariaDB's 1227 for a missing PROCESS or SLAVE MONITOR grant,
   * Oracle's ORA-12514 for a service the listener does not know — were
   * dropped, and the verdict said "No problems found".
   */
  test.each([
    [
      "Error 1227 (42000): Access denied; you need (at least one of) the SLAVE MONITOR privilege(s) for this operation",
      "missing privileges",
    ],
    [
      "Error 1227 (42000): Access denied; you need (at least one of) the PROCESS privilege(s) for this operation",
      "missing privileges",
    ],
    [
      "ORA-12514: TNS:listener does not currently know of service requested in connect descriptor",
      "DATABASE_ORACLE_SERVICE",
    ],
    ["ORA-28000: The account is locked.", "locked or its password expired"],
  ])("%s is diagnosed as %s", (error, diagnosis) => {
    const run = runTroubleshoot({
      config: "postgresql",
      env: POSTGRES_ENV,
      logs: [receiverLine("Failed to fetch InnoDB stats", { error })],
    });

    expect(run.output).toContain(diagnosis);
    expect(run.output).not.toContain("REJECTING the login");
    expect(run.output).not.toContain("No problems found");
    expect(run.status).toBe(1);
  });

  test("a receiver error no check recognises is still reported, with the password redacted", () => {
    const env = POSTGRES_ENV.map((line) => {
      return line.startsWith("DATABASE_PASSWORD=")
        ? "DATABASE_PASSWORD=Sup3r$$ecret"
        : line;
    });
    const odd = receiverLine("Error scraping metrics", {
      error: "driver: bad connection to Sup3r$ecret@db.example.com",
    });
    const run = runTroubleshoot({
      config: "postgresql",
      env,
      logs: [
        odd,
        receiverLine("Error scraping metrics", {
          error: "context deadline exceeded",
        }),
        odd,
      ],
    });

    expect(run.output).toContain("an error no check above recognises");
    // The most frequent one, and how many distinct errors there were.
    expect(run.output).toContain(
      "driver: bad connection to <DATABASE_PASSWORD>@db.example.com",
    );
    expect(run.output).toContain("2 distinct");
    expect(run.output).not.toContain("Sup3r");
    expect(run.output).not.toContain("No problems found");
    expect(run.status).toBe(1);
  });

  test("the other EXPLAIN failures of a top query are plans, not errors", () => {
    const run = runTroubleshoot({
      config: "postgresql",
      env: POSTGRES_ENV,
      logs: [
        receiverLine("failed to prepare statement for EXPLAIN", {
          error:
            "pq: function generate_series(unknown, unknown) is not unique at column 164 (42725)",
        }),
        receiverLine("failed to explain query", {
          query: "INSERT INTO orders(email,total) SELECT $1",
          error:
            "pq: function generate_series(unknown, unknown) is not unique at column 164 (42725)",
        }),
        receiverLine("failed to look up prepared statement parameter count", {
          error: "pq: canceling statement due to statement timeout",
        }),
        receiverLine("failed to obfuscate explain plan", {
          error: "unexpected token",
        }),
      ],
    });

    expect(run.output).not.toContain("no check above recognises");
    expect(run.status).toBe(0);
  });

  /*
   * The SQL Server receiver cannot carry a `;` or `"` in the login, nor
   * spaces around it; a login that does fails with a plain "Login failed",
   * so the diagnostic names the cause instead of the $$ advice.
   */
  test('SQL Server: a " in the password is named as the cause, not the $ advice', () => {
    const env = [
      "DATABASE_SYSTEM=microsoft.sql_server",
      "DATABASE_ENDPOINT=sql.example.com:1433",
      "DATABASE_SERVER_ADDRESS=sql.example.com",
      "DATABASE_SERVER_PORT=1433",
      "DATABASE_USERNAME=oneuptime_monitor",
      'DATABASE_PASSWORD=Qu0te"Pass!9',
      "ONEUPTIME_URL=https://oneuptime.example.com",
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${TOKEN}`,
    ];
    const run = runTroubleshoot({
      config: "sqlserver",
      env,
      logs: [
        receiverLine("Error scraping metrics", {
          error:
            "sqlServerScraperHelper: mssql: Login failed for user 'oneuptime_monitor'. (18456)",
        }),
      ],
    });

    expect(run.output).toContain("DATABASE_PASSWORD contains a double quote");
    expect(run.output).not.toContain("Qu0te");
    expect(run.status).toBe(1);

    const plain = runTroubleshoot({
      config: "sqlserver",
      env: env.map((line) => {
        return line.startsWith("DATABASE_PASSWORD=")
          ? "DATABASE_PASSWORD=Plain_Pass!9"
          : line;
      }),
      logs: [],
    });
    expect(plain.output).not.toContain("connection string");
    expect(plain.status).toBe(0);
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
