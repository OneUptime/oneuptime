"use strict";

/**
 * The root scripts a developer runs on the machine itself reach the stack's
 * PostgreSQL where docker-compose.yml and the dev stack publish it:
 * DATABASE_PUBLISHED_PORT, 5400 unless config.env moves it.
 *
 *   - `npm run ai-eval` pointed DATABASE_PORT at 5400 whatever config.env
 *     said (#5324's follow-ups). It now reads DATABASE_PUBLISHED_PORT once
 *     Scripts/Install/WithConfig.sh has loaded config.env.
 *   - `npm run check-postgres-schema-drift` (Scripts/Postgres/CheckSchemaDrift.sh)
 *     and `npm run generate-postgres-migration` take DATABASE_MIGRATIONS_PORT
 *     first, then DATABASE_PUBLISHED_PORT, then 5400. config.example.env
 *     leaves DATABASE_MIGRATIONS_PORT empty, so a new config.env follows the
 *     published port. (The generator's half is Common's
 *     Tests/Server/Infrastructure/Postgres/HostPostgresPort.test.ts.)
 *
 * These run the scripts' own lines - the package.json script as npm runs it,
 * the drift check's config.env loader and port line as bash runs them - with
 * a stand-in node that prints what it was started with.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROOT_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
const AI_EVAL = ROOT_PACKAGE.scripts["ai-eval"];
const DRIFT_SCRIPT = fs.readFileSync(
  path.join(REPO_ROOT, "Scripts", "Postgres", "CheckSchemaDrift.sh"),
  "utf8",
);
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);

// A shell this machine can run npm's script line with, by its command.
const SHELLS = [
  ["sh", ["sh"]],
  ["dash", ["dash"]],
  ["bash", ["bash"]],
  ["busybox sh", ["busybox", "sh"]],
].filter(([, command]) => {
  return (
    spawnSync(command[0], [...command.slice(1), "-c", "exit 0"], {
      encoding: "utf8",
    }).status === 0
  );
});

// A node that prints its environment's database settings and its arguments.
const STAND_IN_NODE = [
  "#!/bin/sh",
  'printf "DATABASE_HOST=%s\\n" "$DATABASE_HOST"',
  'printf "DATABASE_PORT=%s\\n" "$DATABASE_PORT"',
  'printf "RUN_DATABASE_MIGRATIONS_ON_BOOT=%s\\n" "$RUN_DATABASE_MIGRATIONS_ON_BOOT"',
  'printf "DATABASE_MIGRATION_WAIT_TIMEOUT_MS=%s\\n" "$DATABASE_MIGRATION_WAIT_TIMEOUT_MS"',
  'for argument in "$@"; do printf "ARG=%s\\n" "$argument"; done',
  "",
].join("\n");

/*
 * Runs the ai-eval script line, as npm would with `npm run ai-eval --
 * <extra>`, in a throwaway folder holding config.env (none when null) and
 * the real WithConfig.sh, with the stand-in node first on the PATH.
 */
function runAiEval({ config, extra, shell }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-eval-"));

  try {
    fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(REPO_ROOT, "Scripts", "Install", "WithConfig.sh"),
      path.join(directory, "Scripts", "Install", "WithConfig.sh"),
    );
    fs.mkdirSync(path.join(directory, "bin"));
    fs.writeFileSync(path.join(directory, "bin", "node"), STAND_IN_NODE, {
      mode: 0o755,
    });
    if (config !== null) {
      fs.writeFileSync(path.join(directory, "config.env"), config);
    }

    const runner = shell || ["sh"];
    const result = spawnSync(
      runner[0],
      [...runner.slice(1), "-c", `${AI_EVAL}${extra || ""}`],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          PATH: `${path.join(directory, "bin")}:${process.env.PATH}`,
        },
      },
    );

    const lines = (result.stdout || "").split("\n").filter(Boolean);
    const values = new Map();
    const args = [];
    for (const line of lines) {
      const at = line.indexOf("=");
      const name = line.slice(0, at);
      if (name === "ARG") {
        args.push(line.slice(at + 1));
      } else {
        values.set(name, line.slice(at + 1));
      }
    }

    return { status: result.status, stderr: result.stderr, values, args };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("npm run ai-eval reaches PostgreSQL where the stack publishes it", () => {
  test("the script names no port of its own: 5400 only as DATABASE_PUBLISHED_PORT's default", () => {
    expect(AI_EVAL).toContain("${DATABASE_PUBLISHED_PORT:-5400}");
    expect(AI_EVAL.split("5400")).toHaveLength(2);
    expect(AI_EVAL).not.toContain("DATABASE_PORT=5400");
    // config.env is loaded before the port is read.
    expect(AI_EVAL.startsWith("sh ./Scripts/Install/WithConfig.sh ")).toBe(
      true,
    );
  });

  test.each(SHELLS)(
    "under %s: config.env's DATABASE_PUBLISHED_PORT, the host's own address, and no migrations",
    (_name, shell) => {
      const run = runAiEval({
        config: [
          "DATABASE_HOST=postgres",
          "DATABASE_PORT=5432",
          "DATABASE_PUBLISHED_PORT=5411",
          "RUN_DATABASE_MIGRATIONS_ON_BOOT=true",
          "",
        ].join("\n"),
        shell,
      });

      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(Object.fromEntries(run.values)).toEqual({
        DATABASE_HOST: "localhost",
        DATABASE_PORT: "5411",
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
        DATABASE_MIGRATION_WAIT_TIMEOUT_MS: "0",
      });
      expect(run.args).toEqual([
        "--require",
        "ts-node/register",
        "./Scripts/AI/RunInvestigationEval.ts",
      ]);
    },
  );

  test("without DATABASE_PUBLISHED_PORT, or with it empty: 5400", () => {
    for (const config of [
      "DATABASE_HOST=postgres\n",
      "DATABASE_PUBLISHED_PORT=\n",
      null,
    ]) {
      const run = runAiEval({ config });

      expect({ config, status: run.status }).toEqual({ config, status: 0 });
      expect({ config, port: run.values.get("DATABASE_PORT") }).toEqual({
        config,
        port: "5400",
      });
    }
  });

  test("config.example.env, copied as the guide says: the port it publishes", () => {
    const published = TEMPLATE.split("\n").find((line) => {
      return line.startsWith("DATABASE_PUBLISHED_PORT=");
    });
    const run = runAiEval({ config: TEMPLATE });

    expect(run.status).toBe(0);
    expect(published).toBe("DATABASE_PUBLISHED_PORT=5400");
    expect(run.values.get("DATABASE_PORT")).toBe("5400");
  });

  test("what follows `npm run ai-eval --` reaches the eval as written", () => {
    // npm appends the arguments to the script line, each quoted.
    const run = runAiEval({
      config: "DATABASE_PUBLISHED_PORT=5412\n",
      extra: " '--project=5f8b9c0d1e2f3a4b5c6d7e8f' '--limit=5' 'two words'",
    });

    expect(run.status).toBe(0);
    expect(run.values.get("DATABASE_PORT")).toBe("5412");
    expect(run.args).toEqual([
      "--require",
      "ts-node/register",
      "./Scripts/AI/RunInvestigationEval.ts",
      "--project=5f8b9c0d1e2f3a4b5c6d7e8f",
      "--limit=5",
      "two words",
    ]);
  });
});

/*
 * The drift check's own lines: from loading config.env to choosing the
 * port, run by bash with REPO_ROOT a throwaway folder.
 */
function driftPortLines() {
  const lines = DRIFT_SCRIPT.split("\n");
  const start = lines.indexOf('if [ -f "${REPO_ROOT}/config.env" ]; then');
  const end = lines.findIndex((line) => {
    return line.startsWith("export DATABASE_MIGRATIONS_PORT=");
  });

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return lines.slice(start, end + 1).join("\n");
}

function runDriftPort({ config, env }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-drift-"));

  try {
    if (config !== null) {
      fs.writeFileSync(path.join(directory, "config.env"), config);
    }

    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -uo pipefail\nREPO_ROOT="$1"\n${driftPortLines()}\nprintf "%s" "$DATABASE_MIGRATIONS_HOST:$DATABASE_MIGRATIONS_PORT"`,
        "drift",
        directory,
      ],
      {
        encoding: "utf8",
        env: Object.assign({ PATH: process.env.PATH }, env || {}),
      },
    );

    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("npm run check-postgres-schema-drift reaches PostgreSQL where the stack publishes it", () => {
  test.each([
    ["no config.env and nothing exported: 5400", null, {}, "localhost:5400"],
    [
      "config.env's DATABASE_PUBLISHED_PORT",
      "DATABASE_PUBLISHED_PORT=5401\n",
      {},
      "localhost:5401",
    ],
    [
      "an empty DATABASE_MIGRATIONS_PORT, as config.example.env has it, follows the published port",
      "DATABASE_MIGRATIONS_PORT=\nDATABASE_PUBLISHED_PORT=5401\n",
      {},
      "localhost:5401",
    ],
    [
      "DATABASE_MIGRATIONS_PORT in config.env wins",
      "DATABASE_MIGRATIONS_PORT=5402\nDATABASE_PUBLISHED_PORT=5401\n",
      {},
      "localhost:5402",
    ],
    [
      "one exported for a throwaway database wins over config.env (the CI job, a one-off run)",
      "DATABASE_MIGRATIONS_PORT=5402\nDATABASE_PUBLISHED_PORT=5401\n",
      { DATABASE_MIGRATIONS_PORT: "55432" },
      "localhost:55432",
    ],
    ["config.example.env as it is", TEMPLATE, {}, "localhost:5400"],
  ])("%s", (_name, config, env, expected) => {
    const run = runDriftPort({ config, env });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(expected);
  });
});

describe("no root script reaches PostgreSQL on a port of its own", () => {
  test("every 5400 in package.json's scripts is DATABASE_PUBLISHED_PORT's default", () => {
    for (const [name, script] of Object.entries(ROOT_PACKAGE.scripts)) {
      const ports = script.split("5400").length - 1;
      const defaults =
        script.split("${DATABASE_PUBLISHED_PORT:-5400}").length - 1;

      expect({ name, ports }).toEqual({ name, ports: defaults });
    }
  });
});
