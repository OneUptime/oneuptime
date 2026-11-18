"use strict";

/**
 * backup.sh / restore.sh coherence.
 *
 * backup.sh used to write two uncompressed artifacts per run — db-DD.sql
 * (--format=plain, which pg_restore cannot read at all) and db-DD.tar — while
 * restore.sh fed pg_restore a file named by DATABASE_RESTORE_FILENAME, whose
 * shipped default is db-31.backup. Nothing ever produced a .backup file, so on
 * a stock install the restore path failed on a missing file.
 *
 * backup.sh now emits a single custom-format (-Fc) dump named db-DD.backup.
 * These tests pin the flags AND assert end-to-end that the name backup.sh
 * writes is the name restore.sh reads, so the pair cannot drift apart again.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BACKUP_PATH = path.join(REPO_ROOT, "backup.sh");
const RESTORE_PATH = path.join(REPO_ROOT, "restore.sh");
const CONFIG_EXAMPLE_PATH = path.join(REPO_ROOT, "config.example.env");

const CONTAINER_DATA_DIR = "/var/lib/postgresql/data";

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

/** Strips full-line `#` comments so assertions never match documentation prose. */
function executableLines(source) {
  return source
    .split("\n")
    .filter((line) => {
      return !/^\s*#/.test(line);
    })
    .join("\n");
}

function readEnvExample(name) {
  const line = read(CONFIG_EXAMPLE_PATH)
    .split("\n")
    .find((candidate) => {
      return candidate.startsWith(`${name}=`);
    });
  return line === undefined ? undefined : line.slice(name.length + 1).trim();
}

/**
 * Matches a `--file=` argument. The alternation is needed because the path
 * can hold a command substitution with a space in it — `db-$(date +%d).backup`
 * — so a plain `\S+` would stop at "db-$(date".
 */
const FILE_ARGUMENT = /--file=((?:\$\([^)]*\)|\S)+)/;

/*
 * The dump's name, worked out once before pg_dump runs (#7026): a backup
 * that runs past midnight is written, measured and reported under one name.
 */
const FILE_NAME_ASSIGNMENT = /^BACKUP_FILE_NAME="([^"]+)"$/m;

/**
 * `--file="/var/lib/postgresql/data/$BACKUP_FILE_NAME"`, with
 * `BACKUP_FILE_NAME="db-$(date +%d).backup"` -> the name's template.
 */
function backupArtifactTemplate(source) {
  const match = FILE_ARGUMENT.exec(source);

  if (match === null) {
    return undefined;
  }

  const name = path.posix.basename(match[1].replace(/^"|"$/g, ""));

  if (name === "$BACKUP_FILE_NAME") {
    const assignment = FILE_NAME_ASSIGNMENT.exec(source);
    return assignment === null ? undefined : assignment[1];
  }

  return name;
}

const backupSource = read(BACKUP_PATH);
const restoreSource = read(RESTORE_PATH);
const backupCode = executableLines(backupSource);
const restoreCode = executableLines(restoreSource);

describe("backup.sh", () => {
  test("runs pg_dump exactly once", () => {
    // The run itself; the lines that say how it went name it in words.
    const invocations = backupCode.match(/\/usr\/bin\/pg_dump\b/g) || [];
    expect(invocations).toHaveLength(1);
    expect(
      backupCode.split("\n").filter((line) => {
        return /\bpg_dump\b/.test(line) && !/^\s*echo /.test(line);
      }),
    ).toHaveLength(1);
  });

  test("dumps in custom format", () => {
    expect(backupCode).toMatch(/pg_dump[^\n]*(--format=custom|-Fc)\b/);
  });

  test("no longer emits the plain-SQL or tar dumps", () => {
    expect(backupCode).not.toMatch(/--format=plain/);
    expect(backupCode).not.toMatch(/--format=tar/);
    expect(backupCode).not.toMatch(/\.sql\b/);
    expect(backupCode).not.toMatch(/\.tar\b/);
  });

  test("writes exactly one artifact, into the mounted data directory, named once", () => {
    const files = backupCode.match(new RegExp(FILE_ARGUMENT.source, "g")) || [];
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`--file="${CONTAINER_DATA_DIR}/$BACKUP_FILE_NAME"`);

    // The day of the month is read once, before pg_dump runs.
    expect(backupCode.match(/\$\(date \+%d\)/g)).toHaveLength(1);
    expect(
      backupCode.match(new RegExp(FILE_NAME_ASSIGNMENT.source, "gm")),
    ).toEqual(['BACKUP_FILE_NAME="db-$(date +%d).backup"']);
  });

  test("does not pass --clean/--create, which pg_dump ignores for archive formats", () => {
    // Passing them here would be a silent no-op and would hide the fact that the
    // restore is the place that has to drop objects. See restore.sh.
    expect(backupCode).not.toMatch(/pg_dump[^\n]*--clean\b/);
    expect(backupCode).not.toMatch(/pg_dump[^\n]*--create\b/);
  });

  test("still dumps ownership and ACLs (no --no-owner / --no-acl regression)", () => {
    expect(backupCode).not.toMatch(/--no-owner\b/);
    expect(backupCode).not.toMatch(/--no-acl\b/);
    expect(backupCode).not.toMatch(/--no-privileges\b/);
  });

  test("still names the day-of-month so 30 days are retained by rotation", () => {
    expect(backupArtifactTemplate(backupCode)).toBe("db-$(date +%d).backup");
  });

  test("still reads the DATABASE_BACKUP_* connection settings", () => {
    for (const variable of [
      "DATABASE_BACKUP_USERNAME",
      "DATABASE_BACKUP_PASSWORD",
      "DATABASE_BACKUP_HOST",
      "DATABASE_BACKUP_PORT",
      "DATABASE_BACKUP_NAME",
      "DATABASE_BACKUP_DIRECTORY",
    ]) {
      expect(backupCode).toContain(variable);
    }
  });
});

describe("restore.sh", () => {
  test("uses pg_restore, not psql", () => {
    expect(restoreCode).toMatch(/pg_restore/);
    expect(restoreCode).not.toMatch(/\bpsql\b/);
  });

  test("passes --clean --if-exists, since pg_dump can no longer carry --clean", () => {
    expect(restoreCode).toMatch(/pg_restore[^\n]*--clean\b/);
    expect(restoreCode).toMatch(/pg_restore[^\n]*--if-exists\b/);
  });

  test("reads the artifact out of the same container directory backup.sh writes to", () => {
    expect(restoreCode).toContain(
      `${CONTAINER_DATA_DIR}/$DATABASE_RESTORE_FILENAME`,
    );
    expect(restoreCode).toContain(`:${CONTAINER_DATA_DIR}`);
    expect(backupCode).toContain(`:${CONTAINER_DATA_DIR}`);
  });
});

describe("backup.sh and restore.sh agree on the artifact name", () => {
  const producedTemplate = backupArtifactTemplate(backupCode);
  const restoreDefault = readEnvExample("DATABASE_RESTORE_FILENAME");

  test("config.example.env ships a DATABASE_RESTORE_FILENAME default", () => {
    expect(restoreDefault).toBeDefined();
  });

  test("the shipped restore default is a name backup.sh can actually produce", () => {
    // backup.sh writes db-$(date +%d).backup; turn that into a matcher and check
    // the shipped default is one of the 31 names it can emit. This is the
    // assertion that was failing in spirit before: backup.sh wrote db-DD.sql /
    // db-DD.tar while the default here was db-31.backup.
    const pattern = new RegExp(
      `^${producedTemplate
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace("\\$\\(date \\+%d\\)", "(0[1-9]|[12][0-9]|3[01])")}$`,
    );
    expect(
      pattern.test(restoreDefault)
        ? restoreDefault
        : `DATABASE_RESTORE_FILENAME=${restoreDefault} can never be produced by backup.sh, which writes ${producedTemplate}`,
    ).toBe(restoreDefault);
  });

  test("extensions match exactly", () => {
    expect(path.posix.extname(restoreDefault)).toBe(
      path.posix.extname(producedTemplate),
    );
    expect(path.posix.extname(producedTemplate)).toBe(".backup");
  });

  test("prefixes match exactly", () => {
    expect(restoreDefault.split("-")[0]).toBe(producedTemplate.split("-")[0]);
  });

  test(".gitignore keeps the produced artifact out of git", () => {
    const ignored = read(path.join(REPO_ROOT, ".gitignore"));
    expect(ignored).toContain(
      `Backups/*${path.posix.extname(producedTemplate)}`,
    );
  });

  test("the backup directory the artifact lands in is the one restore reads", () => {
    expect(readEnvExample("DATABASE_BACKUP_DIRECTORY")).toBe(
      readEnvExample("DATABASE_RESTORE_DIRECTORY"),
    );
  });
});

/**
 * Actually executes backup.sh or restore.sh in a throwaway directory, with
 * `sudo` and `git` stubbed onto PATH. `sudo docker run …` is the only line that
 * reaches a database, so a stub that records its arguments tells us whether the
 * dump or the restore was really attempted — no Docker, no Postgres and no root
 * required. The `git` stub records its arguments the same way.
 *
 * The scripts read config.env through Scripts/Install/WithConfig.sh, so the
 * copy has it too, where the repository keeps it. `config` replaces the
 * config.env lines below.
 *
 * backup.sh then tells the server how it went with `node
 * ./Scripts/Install/BackupScriptRun.js` (#7026): `node` is stubbed too, and
 * records its arguments; STUB_NODE_EXIT in `env` sets its exit code, and
 * `withoutNode` runs the script on a server without Node.js. STUB_DUMP in
 * `env` makes the dump fail ("fail") or come out empty ("empty").
 *
 * @param {string} scriptPath
 * @param {{input?: string, env?: object, config?: Array<string>, withoutNode?: boolean}} [options]
 */
function runScript(scriptPath, options) {
  const settings = options || {};
  const script = path.basename(scriptPath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-script-"));

  try {
    fs.copyFileSync(scriptPath, path.join(directory, script));
    fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(REPO_ROOT, "Scripts", "Install", "WithConfig.sh"),
      path.join(directory, "Scripts", "Install", "WithConfig.sh"),
    );
    fs.writeFileSync(
      path.join(directory, "config.env"),
      (
        settings.config || [
          "DATABASE_BACKUP_USERNAME=postgres",
          "DATABASE_BACKUP_PASSWORD=notarealpassword",
          "DATABASE_BACKUP_HOST=localhost",
          "DATABASE_BACKUP_PORT=5432",
          "DATABASE_BACKUP_NAME=oneuptimedb",
          "DATABASE_BACKUP_DIRECTORY=/Backups",
          "DATABASE_RESTORE_USERNAME=postgres",
          "DATABASE_RESTORE_PASSWORD=notarealpassword",
          "DATABASE_RESTORE_HOST=localhost",
          "DATABASE_RESTORE_PORT=5432",
          "DATABASE_RESTORE_NAME=oneuptimedb",
          "DATABASE_RESTORE_DIRECTORY=/Backups",
          "DATABASE_RESTORE_FILENAME=db-31.backup",
          "",
        ]
      ).join("\n"),
    );

    const binDirectory = path.join(directory, "bin");
    fs.mkdirSync(binDirectory);

    // Puts a `command` on PATH that appends its arguments to a log, runs
    // `then` (bash), and returns a reader for that log ("" when the command
    // never ran).
    const stub = (command, then) => {
      const log = path.join(directory, `${command}.log`);
      // Each argument on its own, NUL-ended, to tell one argument from two.
      const argumentsLog = path.join(directory, `${command}.arguments`);
      fs.writeFileSync(
        path.join(binDirectory, command),
        `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nprintf '%s\\0' "$@" >> ${JSON.stringify(argumentsLog)}\n${then || ""}\n`,
        { mode: 0o755 },
      );
      return {
        log: () => {
          return fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
        },
        arguments: () => {
          return fs.existsSync(argumentsLog)
            ? fs.readFileSync(argumentsLog, "utf8").split("\0").slice(0, -1)
            : [];
        },
      };
    };

    /*
     * `sudo docker run ... pg_dump --file=...` writes the dump into the
     * mounted folder, as the container would, unless STUB_DUMP says it
     * fails ("fail") or writes nothing ("empty").
     */
    const sudoLog = stub(
      "sudo",
      [
        'volume=""; file=""',
        'for argument in "$@"; do',
        '  case "$argument" in',
        '    --volume=*) volume="${argument#--volume=}"; volume="${volume%%:/var/lib/postgresql/data}" ;;',
        '    --file=*) file="${argument#--file=}" ;;',
        "  esac",
        "done",
        'if [ -n "$file" ] && [ -n "$volume" ]; then',
        '  case "${STUB_DUMP:-write}" in',
        "    fail) exit 1 ;;",
        '    empty) : > "$volume/${file##*/}" ;;',
        "    *) printf 'PGDMP' > \"$volume/${file##*/}\" ;;",
        "  esac",
        "fi",
      ].join("\n"),
    );
    const gitLog = stub("git");
    // The report to the server (#7026), which exits STUB_NODE_EXIT.
    const nodeLog = stub("node", 'exit "${STUB_NODE_EXIT:-0}"');

    /*
     * A server without Node.js: PATH holds the stubs but node, and what the
     * scripts and WithConfig.sh run besides their shells' own commands.
     */
    let pathValue = `${binDirectory}:${process.env.PATH}`;

    if (settings.withoutNode) {
      fs.rmSync(path.join(binDirectory, "node"));

      for (const command of ["bash", "sh", "mkdir", "date"]) {
        const found = spawnSync("bash", ["-c", `command -v ${command}`], {
          encoding: "utf8",
        }).stdout.trim();
        fs.symlinkSync(found, path.join(binDirectory, command));
      }

      pathValue = binDirectory;
    }

    const result = spawnSync("bash", [script], {
      cwd: directory,
      encoding: "utf8",
      input: settings.input === undefined ? "" : settings.input,
      env: Object.assign(
        {},
        process.env,
        { PATH: pathValue },
        settings.env || {},
      ),
    });

    return {
      status: result.status,
      stdout: result.stdout || "",
      directory: directory,
      databaseCommand: sudoLog.log(),
      databaseArguments: sudoLog.arguments(),
      gitCommand: gitLog.log(),
      nodeArguments: nodeLog.arguments(),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * restore.sh gained `pg_restore --clean --if-exists`, which is a real change in
 * blast radius: it DROPs every object in the dump from the target database
 * before recreating it. Previously the restore ran without --clean, so aiming it
 * at a populated or wrong database failed noisily on the pre-existing objects
 * and destroyed nothing. --clean is correct now (pg_dump ignores --clean for the
 * archive format backup.sh writes, so the drop has to happen at restore time),
 * so the guard is a confirmation prompt rather than dropping the flag.
 */
describe("restore.sh will not silently drop a database", () => {
  test("warns that the restore is destructive and names the target database", () => {
    const run = runScript(RESTORE_PATH, { input: "n\n" });
    expect(run.stdout).toMatch(/DESTRUCTIVE/);
    expect(run.stdout).toMatch(/--clean --if-exists/);
    expect(run.stdout).toContain("oneuptimedb");
  });

  test("declining aborts before the database is touched, with a non-zero status", () => {
    const run = runScript(RESTORE_PATH, { input: "n\n" });
    expect(run.databaseCommand).toBe("");
    expect(run.status).not.toBe(0);
  });

  test("a non-interactive run (EOF on stdin) aborts instead of restoring", () => {
    // The dangerous failure mode for a cron or CI caller: a prompt that reads
    // EOF as "yes" would wipe the database unattended, and one that aborted with
    // status 0 would make a no-op restore look like a success.
    const run = runScript(RESTORE_PATH, { input: "" });
    expect(run.databaseCommand).toBe("");
    expect(run.status).not.toBe(0);
  });

  test("confirming runs pg_restore --clean --if-exists against the configured dump", () => {
    const run = runScript(RESTORE_PATH, { input: "y\n" });
    expect(run.databaseCommand).toMatch(/pg_restore\b[^\n]*--clean\b/);
    expect(run.databaseCommand).toMatch(/pg_restore\b[^\n]*--if-exists\b/);
    expect(run.databaseCommand).toContain("db-31.backup");
    expect(run.status).toBe(0);
  });

  test("DATABASE_RESTORE_ASSUME_YES=1 skips the prompt for unattended restores", () => {
    const run = runScript(RESTORE_PATH, {
      input: "",
      env: { DATABASE_RESTORE_ASSUME_YES: "1" },
    });
    expect(run.databaseCommand).toMatch(/pg_restore\b/);
    expect(run.status).toBe(0);
  });
});

/**
 * Both scripts used to start with `git pull`, so every backup — once a day, as
 * the guide asks — moved the checkout to the branch's latest commit without
 * `npm run update`, and the next backup ran whatever backup.sh it had pulled.
 * Updating OneUptime is a step of its own: neither script touches the
 * checkout it runs from.
 */
describe("backup.sh and restore.sh leave the checkout alone", () => {
  test("backup.sh dumps the database without running git", () => {
    const run = runScript(BACKUP_PATH);
    expect(run.databaseCommand).toMatch(/pg_dump\b[^\n]*--format=custom\b/);
    expect(run.gitCommand).toBe("");
    expect(run.status).toBe(0);
  });

  test("restore.sh restores the database without running git", () => {
    const run = runScript(RESTORE_PATH, { input: "y\n" });
    expect(run.databaseCommand).toMatch(/pg_restore\b/);
    expect(run.gitCommand).toBe("");
    expect(run.status).toBe(0);
  });

  test.each([
    ["backup.sh", backupCode],
    ["restore.sh", restoreCode],
  ])("%s runs git on no path, taken or not", (_name, code) => {
    expect(code).not.toMatch(/\bgit\b/);
  });
});

/*
 * Both scripts read config.env the way npm start does (WithConfig.sh). They
 * used to `export $(grep -v '^#' config.env | xargs)`, which split a value at
 * its spaces and expanded a * into the folder's file names.
 */
describe("backup.sh and restore.sh read config.env's values as written", () => {
  const BACKUP_SETTINGS = [
    "DATABASE_BACKUP_USERNAME=postgres",
    'DATABASE_BACKUP_PASSWORD="two words*"',
    "DATABASE_BACKUP_HOST=localhost",
    "DATABASE_BACKUP_NAME=oneuptimedb",
    "DATABASE_BACKUP_DIRECTORY=/Backups",
  ];

  test("a password with a space and a * reaches pg_dump as one argument, nothing expanded", () => {
    const run = runScript(BACKUP_PATH, {
      config: [...BACKUP_SETTINGS, "DATABASE_BACKUP_PORT=5432", ""],
    });

    expect(run.status).toBe(0);
    expect(run.databaseArguments).toContain(
      "--dbname=postgresql://postgres:two words*@localhost:5432/oneuptimedb",
    );
  });

  test("a backup folder with a space in it is one volume argument", () => {
    const run = runScript(BACKUP_PATH, {
      config: [
        "DATABASE_BACKUP_USERNAME=postgres",
        "DATABASE_BACKUP_PASSWORD=notarealpassword",
        "DATABASE_BACKUP_HOST=localhost",
        "DATABASE_BACKUP_NAME=oneuptimedb",
        "DATABASE_BACKUP_DIRECTORY=/My Backups",
        "",
      ],
    });
    const volume = run.databaseArguments.find((argument) => {
      return argument.startsWith("--volume=");
    });

    expect(run.status).toBe(0);
    expect(volume).toMatch(/\/My Backups:\/var\/lib\/postgresql\/data$/);
  });

  test("an empty DATABASE_BACKUP_PORT is the port PostgreSQL is published on, 5400 unless DATABASE_PUBLISHED_PORT moves it", () => {
    const shipped = runScript(BACKUP_PATH, {
      config: [...BACKUP_SETTINGS, "DATABASE_BACKUP_PORT=", ""],
    });
    const moved = runScript(BACKUP_PATH, {
      config: [
        ...BACKUP_SETTINGS,
        "DATABASE_PUBLISHED_PORT=5401",
        "DATABASE_BACKUP_PORT=",
        "",
      ],
    });
    const own = runScript(BACKUP_PATH, {
      config: [
        ...BACKUP_SETTINGS,
        "DATABASE_PUBLISHED_PORT=5401",
        "DATABASE_BACKUP_PORT=6543",
        "",
      ],
    });

    expect(shipped.databaseCommand).toContain("@localhost:5400/oneuptimedb");
    expect(moved.databaseCommand).toContain("@localhost:5401/oneuptimedb");
    expect(own.databaseCommand).toContain("@localhost:6543/oneuptimedb");
  });

  test("restore.sh's port follows DATABASE_PUBLISHED_PORT the same way, and says so before it asks", () => {
    const run = runScript(RESTORE_PATH, {
      input: "y\n",
      config: [
        "DATABASE_RESTORE_USERNAME=postgres",
        "DATABASE_RESTORE_PASSWORD=notarealpassword",
        "DATABASE_RESTORE_HOST=host.docker.internal",
        "DATABASE_PUBLISHED_PORT=5401",
        "DATABASE_RESTORE_PORT=",
        "DATABASE_RESTORE_NAME=oneuptimedb",
        "DATABASE_RESTORE_DIRECTORY=/Backups",
        "DATABASE_RESTORE_FILENAME=db-31.backup",
        "",
      ],
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      "Target database : oneuptimedb on host.docker.internal:5401",
    );
    expect(run.databaseCommand).toContain(
      "@host.docker.internal:5401/oneuptimedb",
    );
  });

  test.each([
    ["backup.sh", backupCode],
    ["restore.sh", restoreCode],
  ])("%s no longer exports config.env with xargs", (_name, code) => {
    expect(code).not.toContain("xargs");
    expect(code).toContain(
      'exec sh ./Scripts/Install/WithConfig.sh bash "$0" "$@"',
    );
  });
});

describe("shell syntax", () => {
  test.each([
    ["backup.sh", BACKUP_PATH],
    ["restore.sh", RESTORE_PATH],
  ])("%s parses under bash -n", (_name, filePath) => {
    const result = spawnSync("bash", ["-n", filePath], { encoding: "utf8" });
    expect(result.stderr.trim()).toBe("");
    expect(result.status).toBe(0);
  });

  const hasShellcheck = (() => {
    try {
      execFileSync("shellcheck", ["--version"], { stdio: "ignore" });
      return true;
    } catch (error) {
      return false;
    }
  })();

  // shellcheck is not installed everywhere; skip rather than fail when absent.
  const maybe = hasShellcheck ? test.each : test.skip.each;

  maybe([
    ["backup.sh", BACKUP_PATH],
    ["restore.sh", RESTORE_PATH],
  ])("%s has no shellcheck errors", (_name, filePath) => {
    // Severity "error" only: these scripts predate shellcheck and are full of
    // pre-existing style/info warnings (SC2046 word splitting on $(pwd), etc.)
    // that are out of scope here.
    const result = spawnSync(
      "shellcheck",
      ["--severity=error", "--shell=bash", filePath],
      { encoding: "utf8" },
    );
    expect(`${result.stdout}${result.stderr}`.trim()).toBe("");
    expect(result.status).toBe(0);
  });
});

/*
 * #7026: once pg_dump is done, backup.sh tells OneUptime how it went, so
 * Server Setup measures the server's backups. A backup is a dump pg_dump
 * finished that is not empty: the script used to say "Backup completed
 * successfully!" and exit 0 whatever pg_dump did. Telling the server never
 * changes how the backup went, whatever the server answers, and a server
 * without Node.js is told why it was not told.
 */
describe("backup.sh tells OneUptime how it went", () => {
  const DUMP_NAME = /\/Backups\/db-(0[1-9]|[12][0-9]|3[01])\.backup$/;

  test("a dump pg_dump finished: said, reported as 0 with the dump, and the script ends well", () => {
    const run = runScript(BACKUP_PATH);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Backup completed successfully:");
    expect(run.nodeArguments.slice(0, 2)).toEqual([
      "./Scripts/Install/BackupScriptRun.js",
      "0",
    ]);
    expect(run.nodeArguments[2]).toMatch(DUMP_NAME);
    expect(run.nodeArguments).toHaveLength(3);
  });

  test("pg_dump failed: said, reported with its exit status, and the script ends with an error", () => {
    const run = runScript(BACKUP_PATH, { env: { STUB_DUMP: "fail" } });

    expect(run.status).toBe(1);
    expect(run.stdout).not.toContain("Backup completed successfully");
    expect(run.stdout).toContain("Backup failed: pg_dump exited with 1.");
    expect(run.nodeArguments[1]).toBe("1");
  });

  test("pg_dump exited 0 but wrote an empty dump: no backup, and the script ends with an error", () => {
    const run = runScript(BACKUP_PATH, { env: { STUB_DUMP: "empty" } });

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("Backup failed: pg_dump exited with 0.");
    // The tool measures the dump itself: an empty one is no backup there either.
    expect(run.nodeArguments[1]).toBe("0");
  });

  test("whatever the report answers, the backup's own exit status stands", () => {
    const told = runScript(BACKUP_PATH, { env: { STUB_NODE_EXIT: "1" } });
    const failedAndUntold = runScript(BACKUP_PATH, {
      env: { STUB_DUMP: "fail", STUB_NODE_EXIT: "1" },
    });

    expect(told.status).toBe(0);
    expect(failedAndUntold.status).toBe(1);
  });

  test("on a server without Node.js the backup still runs, and says the server was not told", () => {
    const run = runScript(BACKUP_PATH, { withoutNode: true });

    expect(run.status).toBe(0);
    expect(run.databaseCommand).toMatch(/pg_dump\b/);
    expect(run.stdout).toContain(
      "OneUptime was not told about this backup: Node.js is not installed on this server.",
    );
  });

  test("the dump reported is the one written, under the name worked out before pg_dump ran", () => {
    const run = runScript(BACKUP_PATH);
    const file = run.databaseArguments.find((argument) => {
      return argument.startsWith("--file=");
    });

    expect(file).toMatch(
      /^--file=\/var\/lib\/postgresql\/data\/db-(0[1-9]|[12][0-9]|3[01])\.backup$/,
    );
    expect(path.posix.basename(run.nodeArguments[2])).toBe(
      path.posix.basename(file),
    );
  });

  test("the report reads nothing of the key or the database password from the command line", () => {
    expect(backupCode).toContain(
      'node ./Scripts/Install/BackupScriptRun.js "$BACKUP_STATUS" "$BACKUP_FOLDER/$BACKUP_FILE_NAME" || true',
    );

    const reportLine = backupCode.split("\n").find((line) => {
      return line.includes("BackupScriptRun.js");
    });

    expect(reportLine).not.toMatch(/SECRET|PASSWORD|clusterkey/i);
  });
});
