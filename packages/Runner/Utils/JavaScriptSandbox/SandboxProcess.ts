import { ChildProcess, spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { Readable, Writable } from "stream";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import { JavaScriptStepOutcome } from "./JavaScriptStepResult";
import {
  LAUNCHER_EXIT_NO_PRIVILEGE,
  OWN_USER_REMEDY,
  SANDBOX_LAUNCHER_PATH,
  SandboxIdentityPool,
  SandboxIsolation,
  SandboxIsolationDecision,
  callLauncher,
  decideSandboxIsolation,
  hasLiveProcessOfUser,
} from "./SandboxIdentity";
import {
  MAX_SANDBOX_REPLY_BYTES,
  SANDBOX_PROTOCOL_VERSION,
  SandboxEgressPolicy,
  SandboxReply,
  SandboxRequest,
  parseSandboxReply,
} from "./SandboxProtocol";

/*
 * A GLOBAL RUNNER'S JAVASCRIPT STEP, IN A PROCESS OF ITS OWN.
 *
 * A global Runner runs every project's JavaScript steps beside the AI code
 * fixes it takes, with its own key and, during a fix, a repository's token.
 * Each step used to run in an isolated-vm isolate inside the Runner's own
 * process, so the isolate was all that stood between a step and those. Now
 * each step runs in a process started for it alone (SandboxWorker), in the
 * same kind of isolate, with the same limits - 128 MB, the step's time limit
 * (five minutes at most on a global Runner), HTTP to public addresses only -
 * and around it:
 *
 *   - a user of its own where the container allows it (SandboxIdentity):
 *     the kernel then keeps the process from the Runner's environment,
 *     memory, signals and private files, and from every other step's;
 *   - none of the Runner's environment: the process gets a PATH and a few
 *     names that are not the Runner's (getSandboxEnvironment), never its
 *     key or settings;
 *   - none of its files: it starts in /, and under Node's permission model
 *     it may read only the code it runs, write nothing, and start no process
 *     or worker; where it has a user of its own, it can also write no byte
 *     to a file and dump no core;
 *   - a hard end: the process is killed when the step's time is up (plus
 *     the isolate's own grace and its start-up), and with it, through the
 *     launcher, anything it started;
 *   - bounded answers: one reply of at most MAX_SANDBOX_REPLY_BYTES, cut to
 *     the Runner's output limit, and at most SANDBOX_LOG_BYTES of anything
 *     else it prints, which only the Runner's own log sees.
 *
 * Per step this costs a process start (about 0.3 s from the image's bundle)
 * and the memory of a Node.js process (about 130 MB while the step runs).
 * A project's own Runner runs its JavaScript steps in its own process as
 * before: they are its project's own, as its Bash steps are.
 */

// The worker's bundle, which the Runner's image builds (Dockerfile.tpl).
export const SANDBOX_WORKER_BUNDLE_PATH: string =
  "/usr/lib/oneuptime-runner/javascript-sandbox-worker.js";

// The worker run from its TypeScript, for a Runner run from its sources.
export const SANDBOX_WORKER_SOURCE_PATH: string = path.join(
  __dirname,
  "SandboxWorkerFromSource.js",
);

// The worker's own heap; the step's isolate has its own 128 MB.
export const SANDBOX_MAX_OLD_SPACE_MB: number = 256;

/*
 * How long past the step's time limit its process may live: the isolate's
 * own grace (VMRunner allows 5 s past the limit for I/O) and the process's
 * start-up.
 */
export const SANDBOX_DEADLINE_GRACE_MS: number = 15_000;

// What else the step's process may print, kept for the Runner's own log.
export const SANDBOX_LOG_BYTES: number = 64 * 1024;

export const DEFAULT_SANDBOX_PATH: string =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/*
 * Of the Runner's environment, only these reach the step's process, and
 * only for what they say about the host (time zone, certificates). The
 * launcher holds the step to the same list.
 */
export const PASSED_THROUGH_ENVIRONMENT: ReadonlyArray<string> = [
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "TZ",
];

export const STEP_RAN_OUT_OF_TIME_MESSAGE: string =
  "The JavaScript step ran past its time limit and was stopped.";

export const STEP_ENDED_WITHOUT_RESULT_MESSAGE: string =
  "The JavaScript step's sandbox ended without a result";

export const STEP_REPLY_TOO_LARGE_MESSAGE: string =
  "The JavaScript step's sandbox sent more than a result may hold, so it was stopped.";

export const STEP_NO_PRIVILEGE_MESSAGE: string =
  "This global Runner could not start the JavaScript step as a user of its own (its container no longer lets it switch users), so the step was not run.";

export interface SandboxWorkerEntry {
  path: string;
  // The image's bundle, or the worker's TypeScript through ts-node.
  kind: "bundle" | "source";
}

export interface SandboxStepRequest {
  script: string;
  args: JSONObject;
  timeoutInMs: number;
  maxOutputBytes: number;
  policy: SandboxEgressPolicy;
}

export interface SandboxRunOptions {
  isolation: SandboxIsolationDecision;
  identities: SandboxIdentityPool | null;
  launcherPath: string;
  workerEntry: SandboxWorkerEntry;
  deadlineGraceMs: number;
}

// What one finished process left behind.
interface ProcessEnd {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reply: string;
  replyTooLarge: boolean;
  timedOut: boolean;
  log: string;
}

// Collects a stream up to a byte limit; past it, the rest is dropped.
class BoundedCollector {
  private readonly chunks: Array<Buffer> = [];
  private total: number = 0;
  public isOverLimit: boolean = false;

  public constructor(private readonly limit: number) {}

  public append(chunk: unknown): void {
    const buffer: Buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), "utf8");

    if (this.total + buffer.length > this.limit) {
      const room: number = Math.max(0, this.limit - this.total);
      if (room > 0) {
        this.chunks.push(buffer.subarray(0, room));
        this.total += room;
      }
      this.isOverLimit = true;
      return;
    }

    this.chunks.push(buffer);
    this.total += buffer.length;
  }

  public text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

// Where Common is, as require() finds it (its node_modules hold isolated-vm).
export function getCommonPackageDirectory(): string {
  return fs.realpathSync(path.dirname(require.resolve("Common/package.json")));
}

export function getRunnerPackageDirectory(): string {
  return path.resolve(__dirname, "..", "..");
}

export function getDefaultWorkerEntry(
  bundleExists: (bundlePath: string) => boolean = fs.existsSync,
): SandboxWorkerEntry {
  return bundleExists(SANDBOX_WORKER_BUNDLE_PATH)
    ? { path: SANDBOX_WORKER_BUNDLE_PATH, kind: "bundle" }
    : { path: SANDBOX_WORKER_SOURCE_PATH, kind: "source" };
}

/*
 * What the step's process may read: the code it runs and nothing else.
 * node-gyp-build, which loads isolated-vm, asks whether /etc/alpine-release
 * exists; it is not there on the image, and without leave to ask it fails.
 */
export function getReadableRoots(entry: SandboxWorkerEntry): Array<string> {
  const commonDirectory: string = getCommonPackageDirectory();

  if (entry.kind === "bundle") {
    return [
      path.dirname(entry.path),
      path.join(commonDirectory, "node_modules"),
      "/etc/alpine-release",
    ];
  }

  return [getRunnerPackageDirectory(), commonDirectory, "/etc/alpine-release"];
}

// Whether the Runner trusts the system's certificate store, as the image does.
export function usesOpenSslCertificateStore(
  execArgv: Array<string> = process.execArgv,
  nodeOptions: string | undefined = process.env["NODE_OPTIONS"],
): boolean {
  return (
    execArgv.includes("--use-openssl-ca") ||
    (nodeOptions || "").split(/\s+/).includes("--use-openssl-ca")
  );
}

export function getSandboxNodeArguments(
  entry: SandboxWorkerEntry,
): Array<string> {
  return [
    "--no-node-snapshot",
    `--max-old-space-size=${SANDBOX_MAX_OLD_SPACE_MB}`,
    ...(usesOpenSslCertificateStore() ? ["--use-openssl-ca"] : []),
    "--permission",
    // isolated-vm is a native addon; the step's code never sees Node.
    "--allow-addons",
    // The isolate's axios bridge, held to the SSRF guard's policy.
    "--allow-net",
    ...getReadableRoots(entry).map((root: string): string => {
      return `--allow-fs-read=${root}`;
    }),
    "--disable-warning=SecurityWarning",
    "--disable-warning=ExperimentalWarning",
    entry.path,
  ];
}

/*
 * The step's whole environment: a PATH, a language, and the few host
 * settings PASSED_THROUGH_ENVIRONMENT names - never the Runner's key, its
 * id, its server or any other setting of its own. The bundle finds
 * isolated-vm through NODE_PATH.
 */
export function getSandboxEnvironment(
  entry: SandboxWorkerEntry,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: DEFAULT_SANDBOX_PATH,
    LANG: "C.UTF-8",
  };

  for (const name of PASSED_THROUGH_ENVIRONMENT) {
    const value: string | undefined = base[name];

    if (typeof value === "string" && value !== "") {
      environment[name] = value;
    }
  }

  if (entry.kind === "bundle") {
    environment["NODE_PATH"] = path.join(
      getCommonPackageDirectory(),
      "node_modules",
    );
  }

  return environment;
}

function describeEnd(end: ProcessEnd): string {
  return end.signal
    ? `signal ${end.signal}`
    : `exit code ${end.exitCode === null ? "none" : end.exitCode}`;
}

/*
 * Starts one step's process and waits for it to end, however it ends: a
 * reply, an exit without one, a reply too large, or its deadline.
 */
function runProcess(data: {
  command: string;
  args: Array<string>;
  environment: NodeJS.ProcessEnv;
  ownProcessGroup: boolean;
  requestText: string;
  deadlineMs: number;
}): Promise<ProcessEnd> {
  return new Promise<ProcessEnd>((resolve: (end: ProcessEnd) => void) => {
    const reply: BoundedCollector = new BoundedCollector(
      MAX_SANDBOX_REPLY_BYTES,
    );
    const log: BoundedCollector = new BoundedCollector(SANDBOX_LOG_BYTES);
    let timedOut: boolean = false;
    let replyTooLarge: boolean = false;
    let isDone: boolean = false;

    const child: ChildProcess = spawn(data.command, data.args, {
      cwd: "/",
      env: data.environment,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      detached: data.ownProcessGroup,
    });

    // The process, and in its own group whatever it started.
    const kill: () => void = (): void => {
      if (child.pid === undefined) {
        return;
      }

      try {
        if (data.ownProcessGroup) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // Already gone.
      }
    };

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      timedOut = true;
      kill();
    }, data.deadlineMs);

    const finish: (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ) => void = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (isDone) {
        return;
      }

      isDone = true;
      clearTimeout(timer);

      // Whatever the group still holds goes with it.
      if (data.ownProcessGroup) {
        kill();
      }

      resolve({
        exitCode,
        signal,
        reply: reply.text(),
        replyTooLarge,
        timedOut,
        log: log.text(),
      });
    };

    child.stdout?.on("data", (chunk: unknown) => {
      log.append(chunk);
    });

    child.stderr?.on("data", (chunk: unknown) => {
      log.append(chunk);
    });

    const replyStream: Readable | null = (child.stdio[3] as Readable) || null;

    replyStream?.on("data", (chunk: unknown) => {
      reply.append(chunk);

      if (reply.isOverLimit && !replyTooLarge) {
        replyTooLarge = true;
        kill();
      }
    });

    replyStream?.on("error", () => {
      // The process ended; 'close' reports it.
    });

    child.once("error", (error: Error) => {
      log.append(`Could not start the step's process: ${error.message}`);
      finish(null, null);
    });

    // After the process exits and every stream it held has closed.
    child.once(
      "close",
      (code: number | null, signal: NodeJS.Signals | null) => {
        finish(code, signal);
      },
    );

    const input: Writable | null = child.stdin;

    input?.on("error", () => {
      // It ended before it read the request; 'close' reports how.
    });

    input?.end(data.requestText);
  });
}

export function toStepOutcome(data: {
  end: ProcessEnd;
  nonce: string;
  maxOutputBytes: number;
}): JavaScriptStepOutcome {
  const { end } = data;

  if (end.timedOut) {
    return {
      success: false,
      output: "",
      errorMessage: STEP_RAN_OUT_OF_TIME_MESSAGE,
    };
  }

  if (end.replyTooLarge) {
    return {
      success: false,
      output: "",
      errorMessage: STEP_REPLY_TOO_LARGE_MESSAGE,
    };
  }

  const reply: SandboxReply | null = parseSandboxReply({
    text: end.reply,
    nonce: data.nonce,
    maxOutputBytes: data.maxOutputBytes,
  });

  if (reply) {
    return {
      success: reply.success,
      output: reply.output,
      ...(reply.errorMessage !== undefined
        ? { errorMessage: reply.errorMessage }
        : {}),
    };
  }

  if (end.exitCode === LAUNCHER_EXIT_NO_PRIVILEGE) {
    return {
      success: false,
      output: "",
      errorMessage: STEP_NO_PRIVILEGE_MESSAGE,
    };
  }

  return {
    success: false,
    output: "",
    errorMessage: `${STEP_ENDED_WITHOUT_RESULT_MESSAGE} (${describeEnd(end)}).`,
  };
}

export async function runSandboxedStep(
  step: SandboxStepRequest,
  options: SandboxRunOptions,
): Promise<JavaScriptStepOutcome> {
  const nonce: string = randomBytes(16).toString("hex");

  const request: SandboxRequest = {
    version: SANDBOX_PROTOCOL_VERSION,
    nonce,
    code: step.script,
    args: step.args,
    timeoutInMs: step.timeoutInMs,
    maxOutputBytes: step.maxOutputBytes,
    policy: step.policy,
  };

  const nodeArguments: Array<string> = getSandboxNodeArguments(
    options.workerEntry,
  );
  const environment: NodeJS.ProcessEnv = getSandboxEnvironment(
    options.workerEntry,
  );
  const deadlineMs: number = step.timeoutInMs + options.deadlineGraceMs;
  const ownUser: boolean =
    options.isolation.isolation === SandboxIsolation.OwnUser &&
    options.identities !== null;

  let uid: number | null = null;

  try {
    uid = ownUser ? options.identities!.acquire() : null;
  } catch (error: unknown) {
    return {
      success: false,
      output: "",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const end: ProcessEnd =
      uid !== null
        ? await runProcess({
            command: options.launcherPath,
            args: ["run", String(uid), process.execPath, ...nodeArguments],
            environment,
            ownProcessGroup: false,
            requestText: JSON.stringify(request),
            deadlineMs,
          })
        : await runProcess({
            command: process.execPath,
            args: nodeArguments,
            environment,
            ownProcessGroup: true,
            requestText: JSON.stringify(request),
            deadlineMs,
          });

    const outcome: JavaScriptStepOutcome = toStepOutcome({
      end,
      nonce,
      maxOutputBytes: step.maxOutputBytes,
    });

    if (!outcome.success && end.log.trim()) {
      logger.debug(
        `A JavaScript step's sandbox printed, as it ended (${describeEnd(end)}): ${end.log.slice(0, 2000)}`,
      );
    }

    return outcome;
  } finally {
    if (uid !== null) {
      await options.identities!.release(uid);
    }
  }
}

/*
 * The Runner's own sandbox: the isolation decided once, on the first step,
 * and said once in the Runner's log.
 */
export default class JavaScriptSandbox {
  private static decision: Promise<SandboxIsolationDecision> | null = null;
  private static identities: SandboxIdentityPool | null = null;

  public static getIsolation(): Promise<SandboxIsolationDecision> {
    if (!JavaScriptSandbox.decision) {
      JavaScriptSandbox.decision = decideSandboxIsolation({
        launcherPath: SANDBOX_LAUNCHER_PATH,
        call: callLauncher,
        platform: process.platform,
        launcherExists: fs.existsSync,
      }).then((decision: SandboxIsolationDecision) => {
        if (decision.isolation === SandboxIsolation.OwnUser) {
          logger.info(
            "JavaScript steps run each in a process of its own, as a user of its own, with none of this Runner's environment or files.",
          );
        } else {
          logger.warn(
            `JavaScript steps run each in a process of its own, with none of this Runner's environment, but as this Runner's own user: ${decision.reason}. ${OWN_USER_REMEDY}`,
          );
        }

        return decision;
      });
    }

    return JavaScriptSandbox.decision;
  }

  public static async runStep(
    step: SandboxStepRequest,
  ): Promise<JavaScriptStepOutcome> {
    const isolation: SandboxIsolationDecision =
      await JavaScriptSandbox.getIsolation();

    if (isolation.isolation === SandboxIsolation.OwnUser) {
      JavaScriptSandbox.identities =
        JavaScriptSandbox.identities ||
        new SandboxIdentityPool({
          launcherPath: SANDBOX_LAUNCHER_PATH,
          call: callLauncher,
          hasLiveProcess: hasLiveProcessOfUser,
        });
    }

    return await runSandboxedStep(step, {
      isolation,
      identities: JavaScriptSandbox.identities,
      launcherPath: SANDBOX_LAUNCHER_PATH,
      workerEntry: getDefaultWorkerEntry(),
      deadlineGraceMs: SANDBOX_DEADLINE_GRACE_MS,
    });
  }

  // For tests: decide again on the next step.
  public static reset(): void {
    JavaScriptSandbox.decision = null;
    JavaScriptSandbox.identities = null;
  }
}
