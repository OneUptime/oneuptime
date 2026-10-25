import { ChildProcess, execFile, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable, Writable } from "stream";
import { PostgresConnectionTarget } from "Common/Server/Infrastructure/Postgres/PostgresAdminConnection";

/*
 * PostgreSQL's own tools - pg_dump and pg_restore - which the Enterprise
 * image carries (packages/App/Dockerfile.tpl installs PostgreSQL 16, 17 and
 * 18's clients in the enterprise stage only). pg_dump must be at least as
 * new as the server it dumps, so the tools are found for each server: the
 * oldest set at least as new as the server's major version, which also
 * writes an archive every newer pg_restore reads.
 *
 * Looked for, in order: BACKUP_POSTGRES_BIN_DIR (one directory, for an
 * installation that carries its own), Alpine's /usr/libexec/postgresql<N>,
 * Debian's and Ubuntu's /usr/lib/postgresql/<N>/bin, then PATH.
 *
 * The tools run with the app's own connection settings in their
 * environment (PGHOST, PGPASSWORD...), never on the command line, and with
 * nothing else of the app's environment: a child process sees no secret
 * it does not need.
 */

export interface PostgresToolSet {
  directory: string;
  major: number;
  // As pg_dump --version prints it: "16.4".
  version: string;
  pgDump: string;
  pgRestore: string;
}

export const BACKUP_POSTGRES_BIN_DIR_ENV: string = "BACKUP_POSTGRES_BIN_DIR";

// The majors looked for in the distribution layouts.
const SEARCHED_MAJORS: Array<number> = [
  12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
];

// The most of a tool's error output kept for its message.
const MAX_STDERR_IN_BYTES: number = 64 * 1024;

// "pg_dump (PostgreSQL) 16.4 (Debian 16.4-1.pgdg120+2)" -> { major: 16, version: "16.4" }.
export function parsePostgresToolVersion(
  output: string,
): { major: number; version: string } | null {
  const marker: string = "(PostgreSQL)";
  const at: number = output.indexOf(marker);

  if (at < 0) {
    return null;
  }

  const rest: string = output.slice(at + marker.length).trim();
  const version: string = rest.split(" ")[0] || "";
  const major: number = parseInt(version.split(".")[0] || "", 10);

  if (!Number.isInteger(major) || major <= 0) {
    return null;
  }

  return { major, version };
}

// server_version_num 150004 -> 15; 90624 -> 9.
export function getPostgresMajor(serverVersionNum: number): number {
  return Math.floor(serverVersionNum / 10000);
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function candidateDirectories(): Array<string> {
  const directories: Array<string> = [];
  const fromEnv: string = (
    process.env[BACKUP_POSTGRES_BIN_DIR_ENV] || ""
  ).trim();

  if (fromEnv) {
    directories.push(fromEnv);
  }

  for (const major of SEARCHED_MAJORS) {
    directories.push(`/usr/libexec/postgresql${major}`);
    directories.push(`/usr/lib/postgresql/${major}/bin`);
  }

  for (const entry of (process.env["PATH"] || "").split(path.delimiter)) {
    if (entry) {
      directories.push(entry);
    }
  }

  return Array.from(new Set<string>(directories));
}

function probeVersion(binary: string): Promise<string> {
  return new Promise<string>(
    (resolve: (value: string) => void, reject: (error: unknown) => void) => {
      execFile(
        binary,
        ["--version"],
        { timeout: 15000, env: getToolProcessBaseEnvironment() },
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(stdout);
        },
      );
    },
  );
}

/*
 * Every set of tools on this server - one per directory that holds both
 * pg_dump and pg_restore and answers --version - one per major (the first
 * found wins), oldest first.
 */
export async function findPostgresToolSets(): Promise<Array<PostgresToolSet>> {
  const byMajor: Map<number, PostgresToolSet> = new Map<
    number,
    PostgresToolSet
  >();

  for (const directory of candidateDirectories()) {
    const pgDump: string = path.join(directory, "pg_dump");
    const pgRestore: string = path.join(directory, "pg_restore");

    if (!isExecutable(pgDump) || !isExecutable(pgRestore)) {
      continue;
    }

    let parsed: { major: number; version: string } | null = null;

    try {
      parsed = parsePostgresToolVersion(await probeVersion(pgDump));
    } catch {
      parsed = null;
    }

    if (!parsed || byMajor.has(parsed.major)) {
      continue;
    }

    byMajor.set(parsed.major, {
      directory,
      major: parsed.major,
      version: parsed.version,
      pgDump,
      pgRestore,
    });
  }

  return Array.from(byMajor.values()).sort(
    (a: PostgresToolSet, b: PostgresToolSet): number => {
      return a.major - b.major;
    },
  );
}

/*
 * The tools for a server: the oldest set at least as new as it. None is
 * an error that says which versions are here and what to do.
 */
export function pickPostgresToolSet(data: {
  toolSets: Array<PostgresToolSet>;
  serverMajor: number;
  // For a restore: pg_restore must also read the archive's own version.
  atLeastMajor?: number | undefined;
}): PostgresToolSet {
  const needed: number = Math.max(data.serverMajor, data.atLeastMajor || 0);
  const picked: PostgresToolSet | undefined = data.toolSets.find(
    (set: PostgresToolSet): boolean => {
      return set.major >= needed;
    },
  );

  if (picked) {
    return picked;
  }

  if (data.toolSets.length === 0) {
    throw new Error(
      "pg_dump and pg_restore are not installed where OneUptime runs. The Enterprise image carries them; on another image, install the PostgreSQL client tools or set BACKUP_POSTGRES_BIN_DIR.",
    );
  }

  const newest: PostgresToolSet = data.toolSets[data.toolSets.length - 1]!;

  throw new Error(
    `PostgreSQL ${needed} needs pg_dump ${needed} or newer, and the newest here is ${newest.version}. Update OneUptime, or set BACKUP_POSTGRES_BIN_DIR to newer PostgreSQL client tools.`,
  );
}

/*
 * What every tool process starts from: the PATH it is found on, a locale,
 * and the library path a test's own tools need - nothing else of the app's
 * environment.
 */
export function getToolProcessBaseEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] || "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };

  if (process.env["LD_LIBRARY_PATH"]) {
    environment["LD_LIBRARY_PATH"] = process.env["LD_LIBRARY_PATH"];
  }

  if (process.env["HOME"]) {
    environment["HOME"] = process.env["HOME"];
  }

  return environment;
}

export interface PostgresToolEnvironment {
  env: NodeJS.ProcessEnv;
  // Removes the TLS files written for the tools.
  cleanUp: () => void;
}

/*
 * The libpq environment of a connection target: the server, the user and
 * the password, and TLS as the app speaks it - verify-full when the app
 * checks the certificate, require when it only encrypts - with the
 * certificates written to files only this process may read, removed by
 * cleanUp.
 */
export function buildPostgresToolEnvironment(
  target: PostgresConnectionTarget,
): PostgresToolEnvironment {
  const env: NodeJS.ProcessEnv = {
    ...getToolProcessBaseEnvironment(),
    PGHOST: target.host,
    PGPORT: String(target.port),
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGDATABASE: target.database,
    PGAPPNAME: "oneuptime-backup",
    PGCONNECT_TIMEOUT: "30",
  };

  let directory: string | null = null;

  if (target.ssl) {
    env["PGSSLMODE"] = target.ssl.rejectUnauthorized
      ? "verify-full"
      : "require";

    const files: Array<[string, string | undefined]> = [
      ["PGSSLROOTCERT", target.ssl.ca],
      ["PGSSLCERT", target.ssl.cert],
      ["PGSSLKEY", target.ssl.key],
    ];

    for (const [name, content] of files) {
      if (!content) {
        continue;
      }

      if (!directory) {
        directory = fs.mkdtempSync(
          path.join(os.tmpdir(), "oneuptime-backup-tls-"),
        );
        fs.chmodSync(directory, 0o700);
      }

      const file: string = path.join(directory, name.toLowerCase());
      fs.writeFileSync(file, content, { mode: 0o600 });
      env[name] = file;
    }
  }

  return {
    env,
    cleanUp: (): void => {
      if (directory) {
        fs.rmSync(directory, { recursive: true, force: true });
        directory = null;
      }
    },
  };
}

export interface ToolRun {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  // The end of what the tool wrote to stderr.
  stderr: string;
}

/*
 * The last line of what a tool said that is its own error ("pg_dump:
 * error: ..."), or the last line it wrote - for a sentence that says why
 * it stopped, without the password it never prints.
 */
export function summarizeToolError(stderr: string): string {
  const lines: Array<string> = stderr
    .split("\n")
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return Boolean(line);
    });

  const errorLine: string | undefined = lines.find((line: string): boolean => {
    return line.includes("error:") || line.includes("FATAL:");
  });

  return (errorLine || lines[lines.length - 1] || "").slice(0, 2000);
}

export interface StartedTool {
  process: ChildProcess;
  stdout: Readable | null;
  stdin: Writable | null;
  // Resolves once the tool has exited and its stderr is read.
  done: Promise<ToolRun>;
}

/*
 * Starts a tool with its stdio piped: its stdout is the caller's to read,
 * its stdin the caller's to write; stderr is kept (the end of it) for the
 * message. An AbortSignal stops it (SIGTERM, then SIGKILL).
 */
export function startPostgresTool(data: {
  binary: string;
  args: Array<string>;
  env: NodeJS.ProcessEnv;
  stdin: "pipe" | "ignore";
  stdout: "pipe" | "ignore";
  signal?: AbortSignal | undefined;
}): StartedTool {
  const child: ChildProcess = spawn(data.binary, data.args, {
    env: data.env,
    stdio: [data.stdin, data.stdout, "pipe"],
  });

  let stderr: string = "";

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");

    if (stderr.length > MAX_STDERR_IN_BYTES) {
      stderr = stderr.slice(stderr.length - MAX_STDERR_IN_BYTES);
    }
  });

  const onAbort: () => void = (): void => {
    child.kill("SIGTERM");

    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 5000).unref();
  };

  if (data.signal) {
    if (data.signal.aborted) {
      onAbort();
    } else {
      data.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const done: Promise<ToolRun> = new Promise<ToolRun>(
    (resolve: (value: ToolRun) => void) => {
      child.on("error", (error: Error) => {
        stderr += `\n${data.binary}: error: ${error.message}`;
      });

      child.on(
        "close",
        (code: number | null, signal: NodeJS.Signals | null) => {
          data.signal?.removeEventListener("abort", onAbort);
          resolve({ exitCode: code, signal, stderr });
        },
      );
    },
  );

  return {
    process: child,
    stdout: child.stdout,
    stdin: child.stdin,
    done,
  };
}
