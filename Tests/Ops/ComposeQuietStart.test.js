"use strict";

/**
 * Compose says nothing about config.env's settings on a new install.
 *
 * Every compose command of a Docker Compose install (`npm start`,
 * `npm run update`, `npm run ps`, `npm run logs`, the database check
 * `npm start` makes first) interpolates the compose files with config.env
 * exported. Compose warns, once per use, about every variable it reads that
 * is not set at all:
 *
 *   The "REDIS_IP_FAMILY" variable is not set. Defaulting to a blank string.
 *
 * The Valkey settings fall back to their old REDIS_* names
 * (`${VALKEY_IP_FAMILY:-${REDIS_IP_FAMILY}}`), and config.example.env ships
 * VALKEY_IP_FAMILY and VALKEY_TLS_CA empty, so Compose read the old names,
 * which a new config.env never sets: twenty lines of that warning, twice,
 * were the first thing a newcomer's `npm start` printed. The old name's own
 * `:-` (`${VALKEY_IP_FAMILY:-${REDIS_IP_FAMILY:-}}`) gives the same value
 * without the warning.
 *
 * These tests hold every nested fallback of every compose file to that form,
 * and, with docker's compose plugin on PATH (no daemon needed), render each
 * stack OneUptime starts from config.example.env and expect not one warning.
 * Ops Config Test sets RUN_COMPOSE_DATABASE_RUNTIME_TESTS, so there the
 * rendering fails rather than skips when docker is missing.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  REPO_ROOT,
  configExampleSettings,
  hasDockerCompose,
  trackedComposeFiles,
} = require("./Utils/ComposePorts");

// `${OUTER:-${INNER}}`: a fallback to a variable that has no default of its own.
const FALLBACK_WITHOUT_DEFAULT = /\$\{([A-Z0-9_]+):?-\$\{([A-Z0-9_]+)\}\}/g;
// `${OUTER:-${INNER:-...}}`: the form every nested fallback takes.
const FALLBACK_WITH_DEFAULT = /\$\{([A-Z0-9_]+):?-\$\{([A-Z0-9_]+):-[^}]*\}\}/g;
const NOT_SET_WARNING = "variable is not set";

// The stacks OneUptime starts, as `npm start`, `npm run dev` and CI's e2e jobs name them.
const STACKS = [
  { name: "npm start", files: ["docker-compose.yml"] },
  { name: "npm run dev", files: ["Scripts/Dev/docker-compose.dev.yml"] },
  {
    name: "the e2e stack",
    files: [
      "docker-compose.yml",
      "packages/E2E/docker-compose.billing.yml",
      "packages/E2E/docker-compose.e2e-clickhouse.yml",
    ],
  },
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

describe("nested fallbacks in the compose files", () => {
  const files = trackedComposeFiles();

  test("there are compose files to read, the base among them", () => {
    expect(files).toEqual(expect.arrayContaining(["docker-compose.base.yml"]));
  });

  test.each(files)(
    "%s gives every variable it falls back to a default of its own",
    (file) => {
      const bare = [...read(file).matchAll(FALLBACK_WITHOUT_DEFAULT)].map(
        (match) => {
          return match[0];
        },
      );

      expect(bare).toEqual([]);
    },
  );

  test("the Valkey settings still fall back to their REDIS_ names, to nothing beyond them", () => {
    const base = read("docker-compose.base.yml");
    const fallbacks = [...base.matchAll(FALLBACK_WITH_DEFAULT)].map((match) => {
      return `${match[1]} -> ${match[2]}`;
    });

    for (const suffix of [
      "USERNAME",
      "PASSWORD",
      "HOST",
      "PORT",
      "DB",
      "IP_FAMILY",
      "TLS_CA",
      "TLS_SENTINEL_MODE",
    ]) {
      expect(fallbacks).toContain(`VALKEY_${suffix} -> REDIS_${suffix}`);
      expect(base).toContain(
        `VALKEY_${suffix}: \${VALKEY_${suffix}:-\${REDIS_${suffix}:-}}`,
      );
    }
  });

  test("config.example.env leaves the settings that made Compose warn empty, and never sets an old name", () => {
    const settings = configExampleSettings();

    expect(settings.get("VALKEY_IP_FAMILY")).toBe("");
    expect(settings.get("VALKEY_TLS_CA")).toBe("");
    expect(
      [...settings.keys()].filter((key) => {
        return key.startsWith("REDIS_");
      }),
    ).toEqual([]);
  });

  test("the check finds the form that warned, and passes the one that does not", () => {
    const warned = "VALKEY_TLS_CA: ${VALKEY_TLS_CA:-${REDIS_TLS_CA}}";
    const quiet = "VALKEY_TLS_CA: ${VALKEY_TLS_CA:-${REDIS_TLS_CA:-}}";

    expect([...warned.matchAll(FALLBACK_WITHOUT_DEFAULT)]).toHaveLength(1);
    expect([...quiet.matchAll(FALLBACK_WITHOUT_DEFAULT)]).toHaveLength(0);
    expect([...quiet.matchAll(FALLBACK_WITH_DEFAULT)]).toHaveLength(1);
  });
});

const REQUIRE_DOCKER = process.env.RUN_COMPOSE_DATABASE_RUNTIME_TESTS === "1";
const describeWithCompose =
  REQUIRE_DOCKER || hasDockerCompose() ? describe : describe.skip;

describeWithCompose("as Compose renders a new install's stacks", () => {
  /*
   * `docker compose config`, with config.example.env as the whole
   * environment (as `npm start` exports a new config.env), and what it
   * printed to stderr.
   */
  function warningsOf(files) {
    const env = Object.assign(
      { PATH: process.env.PATH, HOME: process.env.HOME || "" },
      Object.fromEntries(configExampleSettings()),
    );
    const args = ["compose", "--project-directory", REPO_ROOT];

    for (const file of files) {
      args.push("-f", path.join(REPO_ROOT, file));
    }

    args.push("config", "--quiet");

    const result = spawnSync("docker", args, {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
    });

    return { status: result.status, stderr: result.stderr || "" };
  }

  test("docker compose is available", () => {
    expect(hasDockerCompose()).toBe(true);
  });

  test.each(STACKS)("$name renders without a warning", ({ files }) => {
    const result = warningsOf(files);

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
  });

  test("without the defaults, the same stack warns about the old names", () => {
    const directory = fs.mkdtempSync(
      path.join(require("os").tmpdir(), "oneuptime-compose-quiet-"),
    );

    try {
      // The base as it was: the old names' fallbacks without a default.
      const before = read("docker-compose.base.yml").replace(
        /:-\$\{(REDIS_[A-Z_]+):-\}\}/g,
        ":-${$1}}",
      );

      fs.writeFileSync(path.join(directory, "docker-compose.base.yml"), before);
      fs.copyFileSync(
        path.join(REPO_ROOT, "docker-compose.yml"),
        path.join(directory, "docker-compose.yml"),
      );

      const env = Object.assign(
        { PATH: process.env.PATH, HOME: process.env.HOME || "" },
        Object.fromEntries(configExampleSettings()),
      );
      const result = spawnSync(
        "docker",
        [
          "compose",
          "--project-directory",
          directory,
          "-f",
          path.join(directory, "docker-compose.yml"),
          "config",
          "--quiet",
        ],
        { cwd: directory, env, encoding: "utf8" },
      );

      expect(result.stderr).toContain(NOT_SET_WARNING);
      expect(result.stderr).toContain("REDIS_IP_FAMILY");
      expect(result.stderr).toContain("REDIS_TLS_CA");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
