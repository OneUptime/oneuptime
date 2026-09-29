import fs from "fs";
import os from "os";
import path from "path";
import { ChildProcess, spawn } from "child_process";
import Logger, { AgentLogger } from "../Logger";
import { ExecResult, SpawnFunction } from "./ResourceExecutor";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import { redactResourceCommandOutput } from "../Common/Utils/AiRemediation/Resource/ResourceOutputRedactor";

/*
 * Runs ONE program as an argv — never through a shell — in a sandbox every
 * executor that spawns a CLI shares (docker, govc, ceph, nsenter). Lifted
 * from the Kubernetes AI agent's KubectlExecutor, minus everything kubectl:
 *
 *   - no shell: spawn(binary, args) with the argv exactly as given;
 *   - a CLOSED environment: exactly what the caller builds for this one
 *     command (buildEnv), nothing inherited from the agent — not its API
 *     key, not its proxy settings, not a stray DOCKER_HOST or CEPH_ARGS;
 *   - a private directory per command (0700, under a parent this process
 *     owns and nobody else can read), for HOME, the working directory and
 *     whatever the tool needs (an empty DOCKER_CONFIG, a govc session dir),
 *     removed when the command ends, swept at start-up (an OOM kill runs no
 *     finally block) and removed at shutdown;
 *   - no stdin, stdout capped at MAX_RESOURCE_AGENT_OUTPUT_BYTES, only the
 *     tail of stderr kept (the reason a tool failed is at the end),
 *     U+0000 replaced (a Postgres text column cannot hold it);
 *   - SIGKILL to the whole process group when the time budget runs out, so
 *     a tool that forked (nsenter does) cannot hold the job open;
 *   - output redacted with the Common copy's redactResourceCommandOutput
 *     before it is formatted, so no secret a tool prints leaves the agent.
 */

export const MAX_OUTPUT_BYTES: number = MAX_RESOURCE_AGENT_OUTPUT_BYTES;

/*
 * stderr carries a tool's reason for failing, and it comes after whatever
 * stdout already printed. It gets its own budget (its tail) and stdout gets
 * the rest, so a large partial listing can never push the reason out.
 */
export const STDERR_MAX_BYTES: number = 8 * 1024;

// The longest stderr excerpt carried on a failure's errorMessage.
const ERROR_REASON_MAX_CHARS: number = 500;

/*
 * Every command's private directory lives under one predictable parent so
 * an agent that died mid-command can find and remove what its previous
 * life left behind.
 */
export const JOB_DIR_PARENT_NAME: string = "oneuptime-resource-ai-agent";
const JOB_DIR_PREFIX: string = "job-";
const PRIVATE_DIR_MODE: number = 0o700;
const PRIVATE_FILE_MODE: number = 0o600;

// Inside each job directory: an empty HOME that is also the working directory.
export const JOB_HOME_DIR_NAME: string = "home";

/*
 * After the kill, how long to wait for the process to close its pipes. A
 * descendant that escaped the process group could hold them open forever;
 * the command's result must not wait for it.
 */
export const KILL_SETTLE_MS: number = 2_000;

// A standard PATH for tools spawned without one of the caller's.
export const DEFAULT_SPAWN_PATH: string =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

const STDOUT_HEADER: string = "[stdout]\n";
const STDERR_HEADER: string = "[stderr]\n";

// eslint-disable-next-line no-control-regex
const NUL_CHARACTER_PATTERN: RegExp = /\u0000/g;
export const NUL_REPLACEMENT: string = "�";

export function replaceNulCharacters(text: string): string {
  return text.replace(NUL_CHARACTER_PATTERN, NUL_REPLACEMENT);
}

function headBytes(s: string, maxBytes: number): string {
  return Buffer.from(s, "utf8")
    .subarray(0, Math.max(0, maxBytes))
    .toString("utf8");
}

function tailBytes(s: string, maxBytes: number): string {
  const buffer: Buffer = Buffer.from(s, "utf8");
  return buffer
    .subarray(Math.max(0, buffer.length - Math.max(0, maxBytes)))
    .toString("utf8");
}

/*
 * The output shipped back to the server: `[stdout]` then `[stderr]`, within
 * maxOutputBytes plus the truncation markers. stderr is budgeted first (its
 * last STDERR_MAX_BYTES) and is never cut to make room for stdout; stdout
 * gets whatever is left and says so when it was cut.
 * `stdoutTruncated`/`stderrTruncated` report that the capture itself already
 * dropped bytes. Executors that do not spawn (an HTTPS API, a database
 * driver) format their output with this too.
 */
export function formatResourceOutput(data: {
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean | undefined;
  stderrTruncated?: boolean | undefined;
  maxOutputBytes?: number | undefined;
}): string {
  const maxOutputBytes: number = data.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  let stderr: string = data.stderr;
  let stderrCut: boolean = data.stderrTruncated === true;

  if (Buffer.byteLength(stderr, "utf8") > STDERR_MAX_BYTES) {
    stderr = tailBytes(stderr, STDERR_MAX_BYTES);
    stderrCut = true;
  }

  const stderrSection: string = stderr
    ? `${STDERR_HEADER}${stderrCut ? "... [earlier stderr truncated]\n" : ""}${stderr}`
    : "";

  let stdoutSection: string = "";

  if (data.stdout) {
    const budget: number =
      maxOutputBytes -
      Buffer.byteLength(stderrSection, "utf8") -
      (stderrSection ? 1 : 0) -
      STDOUT_HEADER.length;

    let stdout: string = data.stdout;
    let stdoutCut: boolean = data.stdoutTruncated === true;

    if (Buffer.byteLength(stdout, "utf8") > budget) {
      stdout = headBytes(stdout, budget);
      stdoutCut = true;
    }

    stdoutSection = `${STDOUT_HEADER}${stdout}${
      stdoutCut
        ? `\n... [output truncated: stdout cut at ${Buffer.byteLength(stdout, "utf8")} bytes${stderrSection ? "; stderr follows" : ""}]`
        : ""
    }`;
  }

  return [stdoutSection, stderrSection].filter(Boolean).join("\n");
}

/*
 * A tool's reason for a failure: the last non-empty stderr line, capped.
 * Carried on the errorMessage so it survives any later cap on the output.
 */
export function lastStderrLine(stderr: string): string {
  const lines: Array<string> = stderr
    .split(/\r?\n/)
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    });

  const last: string = lines[lines.length - 1] || "";

  return last.length > ERROR_REASON_MAX_CHARS
    ? `${last.slice(0, ERROR_REASON_MAX_CHARS)}...`
    : last;
}

/*
 * A kill on timeout. With output, the output says what the tool was doing.
 * With none at all, the tool never heard back from the resource — say what
 * that usually means for this tool (silenceHint), or that it is probably
 * unreachable.
 */
export function describeKill(data: {
  timeoutInMs: number;
  producedOutput: boolean;
  program: string;
  silenceHint?: string | undefined;
}): string {
  const killed: string = `Killed (timeout ${data.timeoutInMs}ms)`;

  if (data.producedOutput) {
    return killed;
  }

  return `${killed}: ${data.program} produced no output at all, so ${
    data.silenceHint ||
    "the resource is probably unreachable from this agent (check the address, the network between them, and that the service is up)"
  }.`;
}

// The binary is not in this container.
export function describeMissingBinary(data: {
  program: string;
  binary: string;
  hint?: string | undefined;
}): string {
  return `${data.program} is not installed in this container (${data.binary} was not found). Use the ${RESOURCE_AI_AGENT_IMAGE_REPOSITORY} image, which includes it.${
    data.hint ? ` ${data.hint}` : ""
  }`;
}

// Redact a tool's text with the policy copy's redactor; never throws.
export function redactOutput(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): string {
  if (!data.text) {
    return "";
  }

  try {
    return redactResourceCommandOutput(data);
  } catch {
    // Better to send nothing than something the redactor could not read.
    return "[output withheld: it could not be checked for secrets]";
  }
}

// One command's private directory, as a caller shapes and uses it.
export interface SandboxJobDirectory {
  // The job's private directory (0700).
  path: string;
  // <path>/home: empty and private; HOME and the working directory by default.
  homeDir: string;
  // Create a private (0700) directory inside the job directory; returns its path.
  makePrivateDir: (name: string) => string;
  // Write a private (0600) file inside the job directory; returns its path.
  writePrivateFile: (name: string, content: string) => string;
}

export interface SandboxCaptureRequest {
  /*
   * What to start: a bare program name (looked up on the PATH buildEnv
   * returns) or an absolute path.
   */
  binary: string;
  // The arguments, exactly as they reach the program.
  args: Array<string>;
  /*
   * The program's COMPLETE environment, built for this command from its
   * job directory. Nothing else is inherited.
   */
  buildEnv: (jobDir: SandboxJobDirectory) => Record<string, string>;
  timeoutInMs: number;
  // Shape the job directory before the program starts (a config file, a dir).
  prepareJobDir?: ((jobDir: SandboxJobDirectory) => void) | undefined;
  // The working directory; the job's home by default.
  cwd?: ((jobDir: SandboxJobDirectory) => string) | undefined;
  // Overrides the sandbox's stdout cap for this command.
  maxOutputBytes?: number | undefined;
}

// What one spawned program did, before any formatting.
export interface SandboxCapture {
  // NUL-replaced, NOT redacted.
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  // The sandbox killed it when the time budget ran out.
  timedOut: boolean;
  // The program could not be started (ENOENT, EACCES, ...).
  spawnError: { code: string | null; message: string } | null;
  // The job directory could not be prepared; nothing was started.
  setupError: string | null;
}

export interface SandboxRunRequest extends SandboxCaptureRequest {
  resourceType: AiResourceType;
  // The policy program the output belongs to ("docker", "ceph", ...).
  program: string;
  // Added to the "not installed" message.
  missingBinaryHint?: string | undefined;
  // What silence until the kill means for this tool (describeKill).
  silenceHint?: string | undefined;
}

export interface SpawnSandboxOptions {
  // The parent of the job directories' parent; os.tmpdir() by default.
  tmpDir?: string | undefined;
  spawnImpl?: SpawnFunction | undefined;
  logger?: AgentLogger | undefined;
  maxOutputBytes?: number | undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A name for an entry inside the job directory: one path segment, nothing more.
function assertEntryName(name: string): void {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(`"${name}" is not a plain file or directory name.`);
  }
}

export default class SpawnSandbox {
  // Job directories of commands running right now.
  private readonly activeJobDirs: Set<string> = new Set<string>();
  private readonly spawnImpl: SpawnFunction;
  private readonly usesRealSpawn: boolean;
  private readonly logger: AgentLogger;

  public constructor(private readonly options: SpawnSandboxOptions = {}) {
    this.spawnImpl = options.spawnImpl || spawn;
    this.usesRealSpawn = !options.spawnImpl;
    this.logger = options.logger || Logger;
  }

  public getJobDirParent(): string {
    return path.join(this.options.tmpDir || os.tmpdir(), JOB_DIR_PARENT_NAME);
  }

  // Test seam: which job directories are in flight right now.
  public getActiveJobDirs(): Array<string> {
    return Array.from(this.activeJobDirs);
  }

  public getMaxOutputBytes(): number {
    return this.options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  }

  /*
   * Remove every job directory no command running in this process owns. At
   * start-up nothing is active, so this is "everything a previous life left
   * behind". Best effort: a directory that cannot be removed is logged.
   */
  public sweepOrphanedJobDirs(): number {
    const parent: string = this.getJobDirParent();
    let removed: number = 0;

    let entries: Array<string>;
    try {
      entries = fs.readdirSync(parent);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      const dir: string = path.join(parent, entry);

      if (this.activeJobDirs.has(dir)) {
        continue;
      }

      try {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
      } catch (err: unknown) {
        this.logger.warn("Could not remove an abandoned job directory", {
          dir,
          error: errorMessage(err),
        });
      }
    }

    return removed;
  }

  /*
   * Shutdown: remove the directories of commands still running as well as
   * any orphans.
   */
  public removeAllJobDirs(): number {
    let removed: number = 0;

    for (const dir of Array.from(this.activeJobDirs)) {
      this.releaseJobDir(dir);
      removed++;
    }

    return removed + this.sweepOrphanedJobDirs();
  }

  /*
   * A fresh private directory for one command, under a parent this process
   * owns and nobody else can read. The parent is checked on every use: a
   * pre-existing directory owned by another user would let that user rename
   * or replace entries under it, so it is refused outright. Throws when the
   * directory cannot be made private; release it with releaseJobDir.
   */
  public createJobDir(): SandboxJobDirectory {
    const parent: string = this.getJobDirParent();

    fs.mkdirSync(parent, { recursive: true, mode: PRIVATE_DIR_MODE });

    const stat: fs.Stats = fs.lstatSync(parent);

    if (!stat.isDirectory()) {
      throw new Error(
        `${parent} exists but is not a directory (a symlink or file is in its place).`,
      );
    }

    const uid: number | undefined = process.getuid?.();
    if (uid !== undefined && stat.uid !== uid) {
      throw new Error(
        `${parent} is owned by another user (uid ${stat.uid}); refusing to use it.`,
      );
    }

    // mkdir's mode is subject to the umask; make the directory private regardless.
    if ((stat.mode & 0o077) !== 0) {
      fs.chmodSync(parent, PRIVATE_DIR_MODE);
    }

    const dir: string = fs.mkdtempSync(path.join(parent, JOB_DIR_PREFIX));
    this.activeJobDirs.add(dir);

    try {
      fs.chmodSync(dir, PRIVATE_DIR_MODE);
      fs.mkdirSync(path.join(dir, JOB_HOME_DIR_NAME), {
        mode: PRIVATE_DIR_MODE,
      });
    } catch (err: unknown) {
      this.releaseJobDir(dir);
      throw err;
    }

    return {
      path: dir,
      homeDir: path.join(dir, JOB_HOME_DIR_NAME),
      makePrivateDir: (name: string): string => {
        assertEntryName(name);
        const target: string = path.join(dir, name);
        fs.mkdirSync(target, { mode: PRIVATE_DIR_MODE });
        fs.chmodSync(target, PRIVATE_DIR_MODE);
        return target;
      },
      writePrivateFile: (name: string, content: string): string => {
        assertEntryName(name);
        const target: string = path.join(dir, name);
        fs.writeFileSync(target, content, {
          mode: PRIVATE_FILE_MODE,
          flag: "wx",
        });
        return target;
      },
    };
  }

  // Remove one job directory; best effort (the start-up sweep retries).
  public releaseJobDir(dir: SandboxJobDirectory | string | null): void {
    if (!dir) {
      return;
    }

    const target: string = typeof dir === "string" ? dir : dir.path;
    this.activeJobDirs.delete(target);

    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // Best effort — the start-up sweep gets a second chance at it.
    }
  }

  /*
   * Spawn the program in a fresh job directory and collect what it did,
   * unformatted and unredacted — for posture probes, whose output is
   * parsed rather than shown. Never throws. The job directory is removed
   * before this resolves.
   */
  public async capture(
    request: SandboxCaptureRequest,
  ): Promise<SandboxCapture> {
    let jobDir: SandboxJobDirectory | null = null;
    let env: Record<string, string>;
    let cwd: string;

    try {
      jobDir = this.createJobDir();

      if (request.prepareJobDir) {
        request.prepareJobDir(jobDir);
      }

      env = SpawnSandbox.closeEnvironment(request.buildEnv(jobDir));
      cwd = request.cwd ? request.cwd(jobDir) : jobDir.homeDir;
    } catch (err: unknown) {
      this.releaseJobDir(jobDir);
      return {
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        spawnError: null,
        setupError: errorMessage(err),
      };
    }

    try {
      return await this.spawnAndCollect({
        binary: request.binary,
        args: request.args,
        env,
        cwd,
        timeoutInMs: request.timeoutInMs,
        maxOutputBytes: request.maxOutputBytes ?? this.getMaxOutputBytes(),
      });
    } finally {
      this.releaseJobDir(jobDir);
    }
  }

  /*
   * Spawn the program and report what it did as a job result: output
   * redacted, then formatted and capped; the exit code; and a reason on
   * failure. Never throws.
   */
  public async run(request: SandboxRunRequest): Promise<ExecResult> {
    const captured: SandboxCapture = await this.capture(request);

    return SpawnSandbox.toExecResult(captured, {
      resourceType: request.resourceType,
      program: request.program,
      binary: request.binary,
      timeoutInMs: request.timeoutInMs,
      maxOutputBytes: request.maxOutputBytes ?? this.getMaxOutputBytes(),
      missingBinaryHint: request.missingBinaryHint,
      silenceHint: request.silenceHint,
    });
  }

  /*
   * A capture as the job result the server stores: stdout and stderr each
   * redacted, then formatted within the output budget.
   */
  public static toExecResult(
    captured: SandboxCapture,
    data: {
      resourceType: AiResourceType;
      program: string;
      binary: string;
      timeoutInMs: number;
      maxOutputBytes?: number | undefined;
      missingBinaryHint?: string | undefined;
      silenceHint?: string | undefined;
    },
  ): ExecResult {
    if (captured.setupError !== null) {
      return {
        success: false,
        output: "",
        errorMessage: `Could not prepare a private directory for ${data.program}: ${captured.setupError}`,
      };
    }

    if (captured.spawnError !== null) {
      return {
        success: false,
        output: "",
        errorMessage:
          captured.spawnError.code === "ENOENT"
            ? describeMissingBinary({
                program: data.program,
                binary: data.binary,
                hint: data.missingBinaryHint,
              })
            : `Could not start ${data.program}: ${captured.spawnError.message}`,
      };
    }

    const stdout: string = redactOutput({
      resourceType: data.resourceType,
      program: data.program,
      text: captured.stdout,
    });
    const stderr: string = redactOutput({
      resourceType: data.resourceType,
      program: data.program,
      text: captured.stderr,
    });
    const output: string = formatResourceOutput({
      stdout,
      stderr,
      stdoutTruncated: captured.stdoutTruncated,
      stderrTruncated: captured.stderrTruncated,
      maxOutputBytes: data.maxOutputBytes,
    });

    if (captured.timedOut || captured.signal === "SIGKILL") {
      return {
        success: false,
        output,
        errorMessage: describeKill({
          timeoutInMs: data.timeoutInMs,
          producedOutput: stdout.trim() !== "" || stderr.trim() !== "",
          program: data.program,
          silenceHint: data.silenceHint,
        }),
      };
    }

    if (captured.signal !== null) {
      return {
        success: false,
        output,
        errorMessage: `${data.program} was terminated by ${captured.signal}`,
      };
    }

    if (captured.exitCode === 0) {
      return { success: true, output, exitCode: 0 };
    }

    const reason: string = lastStderrLine(stderr);

    return {
      success: false,
      output,
      ...(captured.exitCode === null ? {} : { exitCode: captured.exitCode }),
      errorMessage: `Exit code ${captured.exitCode ?? "?"}${reason ? `: ${reason}` : ""}`,
    };
  }

  /*
   * The environment exactly as the caller built it, with anything that is
   * not a string value dropped: nothing of the agent's own environment is
   * ever merged in.
   */
  public static closeEnvironment(
    env: Record<string, string>,
  ): Record<string, string> {
    const closed: Record<string, string> = {};

    for (const [name, value] of Object.entries(env || {})) {
      if (typeof value === "string" && name && !name.includes("=")) {
        closed[name] = value;
      }
    }

    return closed;
  }

  private spawnAndCollect(data: {
    binary: string;
    args: Array<string>;
    env: Record<string, string>;
    cwd: string;
    timeoutInMs: number;
    maxOutputBytes: number;
  }): Promise<SandboxCapture> {
    return new Promise<SandboxCapture>(
      (resolve: (value: SandboxCapture) => void): void => {
        const stdoutChunks: Array<Buffer> = [];
        let stdoutBytes: number = 0;
        let stdoutTruncated: boolean = false;
        // Only the tail of stderr is kept: a tool's error is at the end.
        let stderrTail: Buffer = Buffer.alloc(0);
        let stderrTruncated: boolean = false;
        let timedOut: boolean = false;
        let settled: boolean = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let settleTimer: ReturnType<typeof setTimeout> | null = null;

        const finish: (
          exitCode: number | null,
          signal: NodeJS.Signals | null,
          spawnError: { code: string | null; message: string } | null,
        ) => void = (
          exitCode: number | null,
          signal: NodeJS.Signals | null,
          spawnError: { code: string | null; message: string } | null,
        ): void => {
          if (settled) {
            return;
          }
          settled = true;

          if (timer) {
            clearTimeout(timer);
          }

          if (settleTimer) {
            clearTimeout(settleTimer);
          }

          resolve({
            stdout: replaceNulCharacters(
              Buffer.concat(stdoutChunks).toString("utf8"),
            ),
            stderr: replaceNulCharacters(stderrTail.toString("utf8")),
            stdoutTruncated,
            stderrTruncated,
            exitCode,
            signal,
            timedOut,
            spawnError,
            setupError: null,
          });
        };

        let child: ChildProcess;

        try {
          child = this.spawnImpl(data.binary, data.args, {
            // No stdin: a tool must never wait for input.
            stdio: ["ignore", "pipe", "pipe"],
            env: data.env,
            cwd: data.cwd,
            // Its own process group, so the kill reaches whatever it forked.
            detached: this.usesRealSpawn,
            shell: false,
            windowsHide: true,
          });
        } catch (err: unknown) {
          const code: unknown =
            err && typeof err === "object"
              ? (err as Record<string, unknown>)["code"]
              : undefined;
          finish(null, null, {
            code: typeof code === "string" ? code : null,
            message: errorMessage(err),
          });
          return;
        }

        child.stdout?.on("data", (chunk: Buffer): void => {
          if (stdoutBytes < data.maxOutputBytes) {
            stdoutChunks.push(chunk);
            stdoutBytes += chunk.length;
          } else {
            stdoutTruncated = true;
          }
        });

        child.stderr?.on("data", (chunk: Buffer): void => {
          stderrTail = Buffer.concat([stderrTail, chunk]);

          if (stderrTail.length > STDERR_MAX_BYTES * 2) {
            stderrTail = stderrTail.subarray(
              stderrTail.length - STDERR_MAX_BYTES,
            );
            stderrTruncated = true;
          }
        });

        child.on("error", (err: Error & { code?: string }): void => {
          finish(null, null, {
            code: typeof err.code === "string" ? err.code : null,
            message: err.message,
          });
        });

        child.on(
          "close",
          (code: number | null, signal: NodeJS.Signals | null): void => {
            finish(code, signal, null);
          },
        );

        timer = setTimeout(
          (): void => {
            timedOut = true;
            this.kill(child);

            // Whatever still holds the pipes, the result does not wait for it.
            settleTimer = setTimeout((): void => {
              child.stdout?.destroy();
              child.stderr?.destroy();
              finish(null, "SIGKILL", null);
            }, KILL_SETTLE_MS);
          },
          Math.max(1, Math.floor(data.timeoutInMs)),
        );
      },
    );
  }

  private kill(child: ChildProcess): void {
    const pid: number | undefined = child.pid;

    if (this.usesRealSpawn && typeof pid === "number" && pid > 0) {
      try {
        // The whole group: the program and anything it forked.
        process.kill(-pid, "SIGKILL");
        return;
      } catch {
        // Already gone, or not a group leader: kill the process itself.
      }
    }

    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
}
