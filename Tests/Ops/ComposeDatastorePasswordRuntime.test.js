"use strict";

/**
 * The ClickHouse and Valkey docker-compose.yml runs, taking a new password on
 * an existing install, for real.
 *
 * npm start's install step (Scripts/Install/ReplacePlaceholderSecrets.js)
 * gives a CLICKHOUSE_PASSWORD or VALKEY_PASSWORD still at its
 * config.example.env placeholder a random value on ANY start, not only a new
 * install's, while config.env points at the datastores Docker Compose runs.
 * That is safe only because both take their password from the environment
 * every time their container starts: the clickhouse-server image writes it
 * into the server's users config at each start, outside the data volume, and
 * Valkey is started with --requirepass and keeps nothing on disk. This runs
 * exactly what an upgraded install goes through:
 *
 *   1. ClickHouse and Valkey started from docker-compose.yml with the
 *      placeholders, as an install from before this step ran them, and a row
 *      written to ClickHouse;
 *   2. the real step run on that install's config.env;
 *   3. the datastores started again from the new config.env, as npm start
 *      goes on to do.
 *
 * Then the new passwords sign in, the placeholders no longer do, the row is
 * still there, and a further start changes nothing.
 *
 * Needs Docker, and pulls the ClickHouse and Valkey images docker-compose.yml
 * runs. Ops Config Test runs it with RUN_COMPOSE_DATABASE_RUNTIME_TESTS=1;
 * without it the suite is skipped. The project has a name of its own and is
 * removed with its volume; neither datastore publishes a port.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { REPO_ROOT } = require("./Utils/ComposePorts");
const ReplacePlaceholderSecrets = require("../../Scripts/Install/ReplacePlaceholderSecrets");

const RUN = process.env.RUN_COMPOSE_DATABASE_RUNTIME_TESTS === "1";
const describeRuntime = RUN ? describe : describe.skip;

const PLACEHOLDER = "please-change-this-to-random-value";
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);
const SCRIPT = path.join(
  REPO_ROOT,
  "Scripts",
  "Install",
  "ReplacePlaceholderSecrets.js",
);
const RANDOM_PASSWORD = /^[0-9a-f]{64}$/;

jest.setTimeout(10 * 60 * 1000);

function docker(args, options) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 8 * 60 * 1000,
    ...(options || {}),
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

describeRuntime(
  "ClickHouse and Valkey from docker-compose.yml take npm start's new passwords on an existing install",
  () => {
    const project = `oneuptime-ops-datastores-${process.pid}-${crypto
      .randomBytes(3)
      .toString("hex")}`;
    let directory;
    let configFile;
    let before;
    let after;
    let containersBefore;
    let containersAfter;
    let stepOutput;

    // config.env as `npm start` exports it, over this process's environment.
    function env() {
      return {
        ...process.env,
        ...Object.fromEntries(
          ReplacePlaceholderSecrets.readSettings(
            fs.readFileSync(configFile, "utf8"),
          ),
        ),
      };
    }

    // `docker compose` on the repository's docker-compose.yml, as npm start runs it.
    function compose(args) {
      return docker(
        [
          "compose",
          "--project-directory",
          REPO_ROOT,
          "-f",
          path.join(REPO_ROOT, "docker-compose.yml"),
          ...args,
        ],
        { cwd: REPO_ROOT, env: env() },
      );
    }

    function start() {
      const up = compose([
        "up",
        "-d",
        "--wait",
        "--wait-timeout",
        "300",
        "clickhouse",
        "valkey",
      ]);

      if (up.status !== 0) {
        throw new Error(`compose up failed: ${up.output}`);
      }
    }

    function containerIds() {
      const ps = compose(["ps", "-q", "clickhouse", "valkey"]);

      return ps.stdout.trim().split("\n").sort();
    }

    function clickhouse(password, query) {
      return compose([
        "exec",
        "-T",
        "clickhouse",
        "clickhouse-client",
        "--user",
        "default",
        "--password",
        password,
        "--query",
        query,
      ]);
    }

    function valkeyPing(password) {
      return compose([
        "exec",
        "-T",
        "valkey",
        "valkey-cli",
        "--no-auth-warning",
        "-a",
        password,
        "ping",
      ]).stdout.trim();
    }

    beforeAll(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-ops-ds-"));
      configFile = path.join(directory, "config.env");
      // An install from before the step: config.example.env as the README copied it.
      fs.writeFileSync(
        configFile,
        `${TEMPLATE}\nCOMPOSE_PROJECT_NAME=${project}\n`,
      );
      before = ReplacePlaceholderSecrets.readSettings(
        fs.readFileSync(configFile, "utf8"),
      );

      start();
      containersBefore = containerIds();

      const created = clickhouse(
        before.get("CLICKHOUSE_PASSWORD"),
        "CREATE TABLE oneuptime.kept_across_the_upgrade (n UInt8) ENGINE = MergeTree ORDER BY n",
      );
      if (created.status !== 0) {
        throw new Error(`create table failed: ${created.output}`);
      }
      const inserted = clickhouse(
        before.get("CLICKHOUSE_PASSWORD"),
        "INSERT INTO oneuptime.kept_across_the_upgrade VALUES (7)",
      );
      if (inserted.status !== 0) {
        throw new Error(`insert failed: ${inserted.output}`);
      }

      // npm start's step, then the start it goes on to.
      const step = spawnSync(process.execPath, [SCRIPT], {
        cwd: directory,
        encoding: "utf8",
      });
      stepOutput = `${step.stdout}${step.stderr}`;
      if (step.status !== 0) {
        throw new Error(`the step failed: ${stepOutput}`);
      }

      after = ReplacePlaceholderSecrets.readSettings(
        fs.readFileSync(configFile, "utf8"),
      );

      start();
      containersAfter = containerIds();
    });

    afterAll(() => {
      if (configFile && fs.existsSync(configFile)) {
        compose(["down", "-v", "--remove-orphans"]);
      }
      docker(["volume", "rm", "-f", `${project}_clickhouse`]);
      docker(["network", "rm", `${project}_oneuptime`]);
      if (directory) {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    test("they started with the placeholders, as an install from before the step did", () => {
      expect(before.get("CLICKHOUSE_PASSWORD")).toBe(PLACEHOLDER);
      expect(before.get("VALKEY_PASSWORD")).toBe(PLACEHOLDER);
      expect(containersBefore).toHaveLength(2);
    });

    test("the step gave each a random password of its own, and said so", () => {
      expect(after.get("CLICKHOUSE_PASSWORD")).toMatch(RANDOM_PASSWORD);
      expect(after.get("VALKEY_PASSWORD")).toMatch(RANDOM_PASSWORD);
      expect(after.get("CLICKHOUSE_PASSWORD")).not.toBe(
        after.get("VALKEY_PASSWORD"),
      );
      expect(stepOutput).toContain(
        "The bundled ClickHouse and Valkey take their new password",
      );
    });

    test("the next start recreated both", () => {
      expect(containersAfter).toHaveLength(2);
      for (const id of containersAfter) {
        expect(containersBefore).not.toContain(id);
      }
    });

    test("ClickHouse signs in with the new password, and kept what it held", () => {
      const counted = clickhouse(
        after.get("CLICKHOUSE_PASSWORD"),
        "SELECT count(), sum(n) FROM oneuptime.kept_across_the_upgrade",
      );

      expect(counted.status).toBe(0);
      expect(counted.stdout.trim()).toBe("1\t7");
    });

    test("ClickHouse refuses the placeholder", () => {
      const refused = clickhouse(PLACEHOLDER, "SELECT 1");

      expect(refused.status).not.toBe(0);
      expect(refused.output).toContain("Authentication failed");
    });

    test("Valkey answers the new password, and refuses the placeholder", () => {
      expect(valkeyPing(after.get("VALKEY_PASSWORD"))).toBe("PONG");
      expect(valkeyPing(PLACEHOLDER)).not.toContain("PONG");
    });

    test("neither publishes a port on the server", () => {
      for (const id of containersAfter) {
        // Every port a container publishes, as Docker itself reports it.
        const published = docker(["port", id]);

        expect(published.status).toBe(0);
        expect(published.stdout.trim()).toBe("");
      }
    });

    test("a further start changes nothing: the step keeps its values, and nothing is recreated", () => {
      const again = spawnSync(process.execPath, [SCRIPT], {
        cwd: directory,
        encoding: "utf8",
      });

      expect(again.status).toBe(0);
      expect(again.stdout).toBe("");
      expect(
        ReplacePlaceholderSecrets.readSettings(
          fs.readFileSync(configFile, "utf8"),
        ),
      ).toEqual(after);

      start();
      expect(containerIds()).toEqual(containersAfter);
      expect(valkeyPing(after.get("VALKEY_PASSWORD"))).toBe("PONG");
    });
  },
);
