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
 * contains a command substitution with a space in it — `db-$(date +%d).backup`
 * — so a plain `\S+` would stop at "db-$(date".
 */
const FILE_ARGUMENT = /--file=((?:\$\([^)]*\)|\S)+)/;

/** `--file=/var/lib/postgresql/data/db-$(date +%d).backup` -> the basename. */
function backupArtifactTemplate(source) {
  const match = FILE_ARGUMENT.exec(source);
  return match === null ? undefined : path.posix.basename(match[1]);
}

const backupSource = read(BACKUP_PATH);
const restoreSource = read(RESTORE_PATH);
const backupCode = executableLines(backupSource);
const restoreCode = executableLines(restoreSource);

describe("backup.sh", () => {
  test("runs pg_dump exactly once", () => {
    const invocations = backupCode.match(/pg_dump/g) || [];
    expect(invocations).toHaveLength(1);
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

  test("writes exactly one artifact, into the mounted data directory", () => {
    const files = backupCode.match(new RegExp(FILE_ARGUMENT.source, "g")) || [];
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`--file=${CONTAINER_DATA_DIR}/db-$(date +%d).backup`);
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
 * Actually executes restore.sh in a throwaway directory, with `sudo` and `git`
 * stubbed onto PATH. `sudo docker run …` is the only line that reaches a
 * database, so a stub that records its arguments tells us whether the restore
 * was really attempted — no Docker, no Postgres and no root required.
 *
 * @param {{input?: string, env?: object}} options
 */
function runRestoreScript(options) {
  const settings = options || {};
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-restore-"),
  );

  try {
    fs.copyFileSync(RESTORE_PATH, path.join(directory, "restore.sh"));
    fs.writeFileSync(
      path.join(directory, "config.env"),
      [
        "DATABASE_RESTORE_USERNAME=postgres",
        "DATABASE_RESTORE_PASSWORD=notarealpassword",
        "DATABASE_RESTORE_HOST=localhost",
        "DATABASE_RESTORE_PORT=5432",
        "DATABASE_RESTORE_NAME=oneuptimedb",
        "DATABASE_RESTORE_DIRECTORY=/Backups",
        "DATABASE_RESTORE_FILENAME=db-31.backup",
        "",
      ].join("\n"),
    );

    const binDirectory = path.join(directory, "bin");
    fs.mkdirSync(binDirectory);
    const marker = path.join(directory, "restore-attempted.log");

    fs.writeFileSync(
      path.join(binDirectory, "sudo"),
      `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(binDirectory, "git"), "#!/bin/bash\nexit 0\n", {
      mode: 0o755,
    });

    const result = spawnSync("bash", ["restore.sh"], {
      cwd: directory,
      encoding: "utf8",
      input: settings.input === undefined ? "" : settings.input,
      env: Object.assign(
        {},
        process.env,
        { PATH: `${binDirectory}:${process.env.PATH}` },
        settings.env || {},
      ),
    });

    const attempted = fs.existsSync(marker);

    return {
      status: result.status,
      stdout: result.stdout || "",
      restoreAttempted: attempted,
      restoreCommand: attempted ? fs.readFileSync(marker, "utf8") : "",
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
    const run = runRestoreScript({ input: "n\n" });
    expect(run.stdout).toMatch(/DESTRUCTIVE/);
    expect(run.stdout).toMatch(/--clean --if-exists/);
    expect(run.stdout).toContain("oneuptimedb");
  });

  test("declining aborts before the database is touched, with a non-zero status", () => {
    const run = runRestoreScript({ input: "n\n" });
    expect(run.restoreAttempted).toBe(false);
    expect(run.status).not.toBe(0);
  });

  test("a non-interactive run (EOF on stdin) aborts instead of restoring", () => {
    // The dangerous failure mode for a cron or CI caller: a prompt that reads
    // EOF as "yes" would wipe the database unattended, and one that aborted with
    // status 0 would make a no-op restore look like a success.
    const run = runRestoreScript({ input: "" });
    expect(run.restoreAttempted).toBe(false);
    expect(run.status).not.toBe(0);
  });

  test("confirming runs pg_restore --clean --if-exists against the configured dump", () => {
    const run = runRestoreScript({ input: "y\n" });
    expect(run.restoreAttempted).toBe(true);
    expect(run.restoreCommand).toMatch(/pg_restore\b[^\n]*--clean\b/);
    expect(run.restoreCommand).toMatch(/pg_restore\b[^\n]*--if-exists\b/);
    expect(run.restoreCommand).toContain("db-31.backup");
    expect(run.status).toBe(0);
  });

  test("DATABASE_RESTORE_ASSUME_YES=1 skips the prompt for unattended restores", () => {
    const run = runRestoreScript({
      input: "",
      env: { DATABASE_RESTORE_ASSUME_YES: "1" },
    });
    expect(run.restoreAttempted).toBe(true);
    expect(run.status).toBe(0);
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
