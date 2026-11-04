"use strict";

/**
 * The bundled PostgreSQL's health check, which Docker runs every ten seconds
 * for as long as the container runs (issue #5779).
 *
 *   - It names a role and a database. `pg_isready` on its own connects as the
 *     operating system's user, and Docker runs a check as root. The check
 *     still passes - any answer from the server counts as up - but the image
 *     trusts connections from inside the container, so this one gets as far as
 *     looking the role up, and the server logs FATAL: role "root" does not
 *     exist. That is about 8,600 errors a day on a server with nothing wrong
 *     with it, burying the ones that matter. Naming only the role moves the
 *     error to the database of that name on any install that sets its own
 *     DATABASE_USERNAME.
 *   - It reads both from the container's environment when it runs: the names
 *     the image created them from, whatever config.env says, and with no
 *     quoting for a value to break out of.
 *   - It connects over TCP. While it creates a new database the image runs a
 *     temporary server that listens only on its socket, so a check over the
 *     socket says healthy before the server other containers connect to has
 *     started.
 *
 * These run the check's real command through a real shell, with a stand-in for
 * pg_isready, so they need no database. ComposeDatabaseRuntime.test.js runs it
 * for real and reads the server's log.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const {
  REPO_ROOT,
  hasDockerCompose,
  readCompose,
  renderCompose,
} = require("./Utils/ComposePorts");

// pg_isready's own exit codes: accepting, rejecting, no response, no attempt made.
const PG_ISREADY_EXIT_CODES = [0, 1, 2, 3];

// A variable Compose reads from the machine it runs on, not one left for the container's shell.
const COMPOSE_INTERPOLATION = /(^|[^$])\$(?!\$)/;

// Where a repository command that probes a PostgreSQL it started can be.
const PROBING_FILE =
  /(?:^|\/)(?:docker-)?compose[^/]*\.ya?ml$|^\.github\/workflows\/|^HelmChart\/Public\/.*\/templates\/|^Scripts\/.*\.(?:sh|js)$|^\.oss-scanner\/.*\.sh$/;
const SHELL_OR_YAML_COMMENT = /^\s*#/;
const PG_ISREADY = /\bpg_isready\b/;
const NAMES_ITS_ROLE = /\s-U\s/;

const STUB_SCRIPT = `#!/bin/sh
for argument in "$@"; do
  printf '%s\\n' "$argument"
done > "$PG_ISREADY_ARGUMENTS_FILE"
exit "$PG_ISREADY_EXIT_CODE"
`;

const baseCompose = readCompose("docker-compose.base.yml");
const postgresService = baseCompose.services.postgres;
const [checkKind, checkCommand] = postgresService.healthcheck.test;

function asTheContainerRunsIt(command) {
  // Compose's only rewrite of a value with no variable of its own to read.
  return command.split("$$").join("$");
}

describe("the check's command, run through a shell", () => {
  let stubDirectory;

  beforeAll(() => {
    stubDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-ops-pg-isready-"),
    );
    fs.writeFileSync(path.join(stubDirectory, "pg_isready"), STUB_SCRIPT, {
      mode: 0o755,
    });
  });

  afterAll(() => {
    fs.rmSync(stubDirectory, { recursive: true, force: true });
  });

  function runCheck(data) {
    const argumentsFile = path.join(stubDirectory, "arguments");

    fs.rmSync(argumentsFile, { force: true });

    const result = spawnSync("sh", ["-c", asTheContainerRunsIt(checkCommand)], {
      encoding: "utf8",
      env: {
        PATH: `${stubDirectory}${path.delimiter}${process.env.PATH}`,
        PG_ISREADY_ARGUMENTS_FILE: argumentsFile,
        PG_ISREADY_EXIT_CODE: String(data.exitCode || 0),
        POSTGRES_USER: data.user,
        POSTGRES_DB: data.database,
      },
    });

    return {
      status: result.status,
      arguments: fs
        .readFileSync(argumentsFile, "utf8")
        .split("\n")
        .slice(0, -1),
    };
  }

  test.each([
    ["the names config.example.env ships", "postgres", "oneuptimedb"],
    ["a role with no database of its name", "oneuptime_owner", "status"],
    ["names with spaces in them", "on call", "status pages"],
    ["names a shell would read", '$(id) "x"', "a;b`c`"],
  ])(
    "%s: it connects over TCP as that role, to that database",
    (_name, user, database) => {
      expect(runCheck({ user, database }).arguments).toEqual([
        "-h",
        "127.0.0.1",
        "-p",
        "5432",
        "-U",
        user,
        "-d",
        database,
      ]);
    },
  );

  test.each(PG_ISREADY_EXIT_CODES)(
    "pg_isready exits %i: so does the check, which is all Docker reads",
    (exitCode) => {
      expect(
        runCheck({ user: "postgres", database: "oneuptimedb", exitCode })
          .status,
      ).toBe(exitCode);
    },
  );
});

describe("the check as the compose files write it", () => {
  test("it runs in a shell, which is what reads the container's variables", () => {
    expect(checkKind).toBe("CMD-SHELL");
  });

  test("Compose reads no variable from the machine it runs on", () => {
    /*
     * A single $ here would be Compose's to fill in, from a machine that does
     * not set POSTGRES_USER: the role would quietly be empty, and the error
     * this check exists to avoid would be back.
     */
    expect(checkCommand).not.toMatch(COMPOSE_INTERPOLATION);
  });

  test("the check's names are the ones the image creates", () => {
    expect(postgresService.environment.POSTGRES_USER).toBe(
      "${DATABASE_USERNAME}",
    );
    expect(postgresService.environment.POSTGRES_DB).toBe("${DATABASE_NAME}");
    expect(asTheContainerRunsIt(checkCommand)).toContain("$POSTGRES_USER");
    expect(asTheContainerRunsIt(checkCommand)).toContain("$POSTGRES_DB");
  });

  test("the check over the socket that says healthy too early is not what runs", () => {
    expect(checkCommand).toContain("-h 127.0.0.1");
  });

  test.each(["docker-compose.yml", "Scripts/Dev/docker-compose.dev.yml"])(
    "%s takes the check from docker-compose.base.yml, and does not replace it",
    (file) => {
      const postgres = readCompose(file).services.postgres;

      expect(postgres.extends.service).toBe("postgres");
      expect(postgres.healthcheck).toBeUndefined();
    },
  );
});

// With docker's compose plugin on PATH (no daemon needed); Ops Config Test requires it.
const REQUIRE_DOCKER = process.env.RUN_COMPOSE_DATABASE_RUNTIME_TESTS === "1";
const describeWithCompose =
  REQUIRE_DOCKER || hasDockerCompose() ? describe : describe.skip;

describeWithCompose("the check as Compose renders the stack", () => {
  test.each(["docker-compose.yml", "Scripts/Dev/docker-compose.dev.yml"])(
    "%s: the variables are still the container's to read",
    (file) => {
      const postgres = renderCompose([file]).services.postgres;

      expect(postgres.healthcheck.test).toEqual([
        "CMD-SHELL",
        'pg_isready -h 127.0.0.1 -p 5432 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"',
      ]);
      expect(postgres.environment.POSTGRES_USER).toBe("postgres");
      expect(postgres.environment.POSTGRES_DB).toBe("oneuptimedb");
    },
  );
});

describe("every other probe of a PostgreSQL this repository starts", () => {
  function trackedFiles() {
    return spawnSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    })
      .stdout.split("\0")
      .filter((file) => {
        return PROBING_FILE.test(file);
      });
  }

  function probes() {
    return trackedFiles().flatMap((file) => {
      return fs
        .readFileSync(path.join(REPO_ROOT, file), "utf8")
        .split("\n")
        .filter((line) => {
          return PG_ISREADY.test(line) && !SHELL_OR_YAML_COMMENT.test(line);
        })
        .map((line) => {
          return { file, line: line.trim() };
        });
    });
  }

  test("the search finds the probes it is there to hold", () => {
    expect(
      probes().map((probe) => {
        return probe.file;
      }),
    ).toEqual(
      expect.arrayContaining([
        ".github/workflows/postgres-schema-drift.yaml",
        ".oss-scanner/start-services.sh",
        "HelmChart/Public/oneuptime/templates/postgresql-statefulset.yaml",
        "Scripts/Perf/stack.sh",
        "docker-compose.base.yml",
      ]),
    );
  });

  test("each names its role: none connects as whoever happens to run it", () => {
    expect(
      probes().filter((probe) => {
        return !NAMES_ITS_ROLE.test(probe.line);
      }),
    ).toEqual([]);
  });

  test("the schema drift workflow's service is checked as the role and database it creates", () => {
    const workflow = yaml.load(
      fs.readFileSync(
        path.join(REPO_ROOT, ".github/workflows/postgres-schema-drift.yaml"),
        "utf8",
      ),
    );
    const services = Object.values(workflow.jobs)
      .map((job) => {
        return job.services && job.services.postgres;
      })
      .filter(Boolean);

    expect(services.length).toBeGreaterThan(0);

    for (const { env, options } of services) {
      expect(options).toContain(
        `--health-cmd "pg_isready -h 127.0.0.1 -U ${env.POSTGRES_USER} -d ${env.POSTGRES_DB}"`,
      );
    }
  });
});
