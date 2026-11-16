import { ChildProcess, spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { Readable, Writable } from "stream";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import {
  GLOBAL_RUNNER_SANDBOX_HOST_INFO_KEY,
  GlobalRunnerSandboxReport,
  GlobalRunnerStepNetwork,
  GlobalRunnerStepNetworkReason,
  GlobalRunnerStepUser,
  GlobalRunnerStepUserReason,
} from "Common/Types/Runner/GlobalRunnerSandbox";
import { JavaScriptStepOutcome } from "./JavaScriptStepResult";
import SandboxHttpChannel from "./SandboxHttp";
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
  NO_NETWORK_EXIT_NO_FILTER,
  NO_NETWORK_REMEDY,
  SANDBOX_NO_NETWORK_PATH,
  SandboxNetwork,
  SandboxNetworkDecision,
  decideSandboxNetwork,
} from "./SandboxNetwork";
import {
  MAX_SANDBOX_HTTP_CALL_BYTES,
  MAX_SANDBOX_HTTP_CHANNEL_BYTES,
  MAX_SANDBOX_REPLY_BYTES,
  SANDBOX_HTTP_FD,
  SANDBOX_PROTOCOL_VERSION,
  SANDBOX_RESULT_FD,
  SandboxEgressPolicy,
  SandboxLineReader,
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
 *   - no network where the kernel allows it (SandboxNetwork): a seccomp
 *     filter lets the process open no socket, so it reaches nothing by
 *     itself - not the cluster's or Compose's network, not the Kubernetes
 *     API, not a cloud metadata endpoint. The isolate's HTTP goes through
 *     the Runner instead (SandboxHttp), on the step's HTTP channel, and the
 *     Runner makes it through VMRunner's SSRF guard with its own policy for
 *     the step, which the process is never told;
 *   - none of the Runner's environment: the process gets a PATH and a few
 *     names that are not the Runner's (getSandboxEnvironment), never its
 *     key or settings;
 *   - none of its files: it starts in /, and under Node's permission model
 *     it may read only the code it runs, write nothing, start no process or
 *     worker and use no network API; where it has a user of its own, it can
 *     also write no byte to a file and dump no core;
 *   - a hard end: the process is killed when the step's time is up (plus
 *     the isolate's own grace and its start-up), and with it, through the
 *     launcher, anything it started; every HTTP call it left in flight is
 *     aborted;
 *   - bounded answers: one reply of at most MAX_SANDBOX_REPLY_BYTES, cut to
 *     the Runner's output limit, HTTP calls within the run's limits, and at
 *     most SANDBOX_LOG_BYTES of anything else it prints, which only the
 *     Runner's own log sees.
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

export const STEP_HTTP_CHANNEL_MISUSED_MESSAGE: string =
  "The JavaScript step's sandbox sent the Runner something other than its HTTP requests, or more of them than a step may send, so it was stopped.";

export const STEP_NO_PRIVILEGE_MESSAGE: string =
  "This global Runner could not start the JavaScript step as a user of its own (its container no longer lets it switch users), so the step was not run.";

export const STEP_NO_NETWORK_FILTER_MESSAGE: string =
  "This global Runner could not start the JavaScript step without a network (its container no longer lets it filter the step's system calls), so the step was not run.";

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
  // Applied by the Runner to the step's HTTP; never handed to the step.
  policy: SandboxEgressPolicy;
}

export interface SandboxRunOptions {
  isolation: SandboxIsolationDecision;
  identities: SandboxIdentityPool | null;
  launcherPath: string;
  // Whether the step's process may open no socket, and the filter that does it.
  network: SandboxNetworkDecision;
  noNetworkPath: string;
  workerEntry: SandboxWorkerEntry;
  deadlineGraceMs: number;
}

// What one finished process left behind.
interface ProcessEnd {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reply: string;
  replyTooLarge: boolean;
  httpChannelMisused: boolean;
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

/*
 * Node's permission model, with leave to load isolated-vm (a native addon;
 * the step's code never sees Node) and to read the code it runs - and no
 * leave to use the network: the isolate's HTTP goes through the Runner, so
 * the process needs none, and Node refuses it every connection, listener
 * and DNS lookup even where the kernel's filter cannot be set.
 */
export function getSandboxNodeArguments(
  entry: SandboxWorkerEntry,
): Array<string> {
  return [
    "--no-node-snapshot",
    `--max-old-space-size=${SANDBOX_MAX_OLD_SPACE_MB}`,
    ...(usesOpenSslCertificateStore() ? ["--use-openssl-ca"] : []),
    "--permission",
    "--allow-addons",
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

/*
 * The program the step's process runs, and what it runs it with: the worker
 * under Node, behind the no-network filter where the step gets no network.
 * Through the launcher, it is what the launcher runs as the step's user.
 */
export function getSandboxProgram(data: {
  network: SandboxNetworkDecision;
  noNetworkPath: string;
  nodeArguments: Array<string>;
}): Array<string> {
  return [
    ...(data.network.network === SandboxNetwork.None
      ? [data.noNetworkPath]
      : []),
    process.execPath,
    ...data.nodeArguments,
  ];
}

function describeEnd(end: ProcessEnd): string {
  return end.signal
    ? `signal ${end.signal}`
    : `exit code ${end.exitCode === null ? "none" : end.exitCode}`;
}

/*
 * Starts one step's process and waits for it to end, however it ends: a
 * reply, an exit without one, a reply too large, a misused HTTP channel, or
 * its deadline. While it runs, the Runner makes its HTTP calls.
 */
function runProcess(data: {
  command: string;
  args: Array<string>;
  environment: NodeJS.ProcessEnv;
  ownProcessGroup: boolean;
  request: SandboxRequest;
  policy: SandboxEgressPolicy;
  deadlineMs: number;
}): Promise<ProcessEnd> {
  return new Promise<ProcessEnd>((resolve: (end: ProcessEnd) => void) => {
    const reply: BoundedCollector = new BoundedCollector(
      MAX_SANDBOX_REPLY_BYTES,
    );
    const log: BoundedCollector = new BoundedCollector(SANDBOX_LOG_BYTES);
    const httpLines: SandboxLineReader = new SandboxLineReader({
      maxLineBytes: MAX_SANDBOX_HTTP_CALL_BYTES,
      maxTotalBytes: MAX_SANDBOX_HTTP_CHANNEL_BYTES,
    });
    let timedOut: boolean = false;
    let replyTooLarge: boolean = false;
    let httpChannelMisused: boolean = false;
    let isDone: boolean = false;

    const child: ChildProcess = spawn(data.command, data.args, {
      cwd: "/",
      env: data.environment,
      // Standard input, output and error, the result and the HTTP channel.
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
      detached: data.ownProcessGroup,
    });

    const input: Writable | null = child.stdin;

    // The Runner's answers to the step's HTTP, on its standard input.
    const http: SandboxHttpChannel = new SandboxHttpChannel({
      policy: data.policy,
      send: (line: string): void => {
        if (input && input.writable && !isDone) {
          input.write(line);
        }
      },
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
      http.close();
      input?.end();

      // Whatever the group still holds goes with it.
      if (data.ownProcessGroup) {
        kill();
      }

      resolve({
        exitCode,
        signal,
        reply: reply.text(),
        replyTooLarge,
        httpChannelMisused,
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

    const replyStream: Readable | null =
      (child.stdio[SANDBOX_RESULT_FD] as Readable) || null;

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

    const httpStream: Readable | null =
      (child.stdio[SANDBOX_HTTP_FD] as Readable) || null;

    // A process that writes anything but the step's calls is stopped.
    const misused: () => void = (): void => {
      if (!httpChannelMisused) {
        httpChannelMisused = true;
        http.close();
        kill();
      }
    };

    httpStream?.on("data", (chunk: Buffer | string) => {
      if (httpChannelMisused) {
        return;
      }

      let lines: Array<string>;

      try {
        lines = httpLines.push(chunk);
      } catch {
        misused();
        return;
      }

      for (const line of lines) {
        if (!http.handle(line)) {
          misused();
          return;
        }
      }
    });

    httpStream?.on("error", () => {
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

    input?.on("error", () => {
      // It ended before it read what it was sent; 'close' reports how.
    });

    // The request, as the first line; stdin stays open for the answers.
    input?.write(`${JSON.stringify(data.request)}\n`);
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

  if (end.httpChannelMisused) {
    return {
      success: false,
      output: "",
      errorMessage: STEP_HTTP_CHANNEL_MISUSED_MESSAGE,
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

  if (end.exitCode === NO_NETWORK_EXIT_NO_FILTER) {
    return {
      success: false,
      output: "",
      errorMessage: STEP_NO_NETWORK_FILTER_MESSAGE,
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
  };

  const program: Array<string> = getSandboxProgram({
    network: options.network,
    noNetworkPath: options.noNetworkPath,
    nodeArguments: getSandboxNodeArguments(options.workerEntry),
  });
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
            args: ["run", String(uid), ...program],
            environment,
            ownProcessGroup: false,
            request,
            policy: step.policy,
            deadlineMs,
          })
        : await runProcess({
            command: program[0]!,
            args: program.slice(1),
            environment,
            ownProcessGroup: true,
            request,
            policy: step.policy,
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

// How the Runner keeps its steps apart, decided once.
export interface SandboxDecision {
  isolation: SandboxIsolationDecision;
  network: SandboxNetworkDecision;
}

/*
 * The decision as the heartbeat says it (Common/Types/Runner/
 * GlobalRunnerSandbox): who a step's process runs as, what it may reach,
 * and why when it gets less than a user of its own and no network.
 */
export function toSandboxReport(
  decision: SandboxDecision,
): GlobalRunnerSandboxReport {
  const report: GlobalRunnerSandboxReport = {
    user:
      decision.isolation.isolation === SandboxIsolation.OwnUser
        ? GlobalRunnerStepUser.OwnUser
        : GlobalRunnerStepUser.RunnerUser,
    network:
      decision.network.network === SandboxNetwork.None
        ? GlobalRunnerStepNetwork.None
        : GlobalRunnerStepNetwork.Shared,
  };

  if (report.user === GlobalRunnerStepUser.RunnerUser) {
    report.userReason =
      decision.isolation.reasonCode || GlobalRunnerStepUserReason.CheckFailed;
  }

  if (report.network === GlobalRunnerStepNetwork.Shared) {
    report.networkReason =
      decision.network.reasonCode || GlobalRunnerStepNetworkReason.CheckFailed;
  }

  return report;
}

// What the Runner's log says of the decision, once.
export function logSandboxDecision(decision: SandboxDecision): void {
  const ownUser: boolean =
    decision.isolation.isolation === SandboxIsolation.OwnUser;
  const noNetwork: boolean = decision.network.network === SandboxNetwork.None;

  if (ownUser && noNetwork) {
    logger.info(
      "JavaScript steps run each in a process of its own, as a user of its own, with no network and none of this Runner's environment or files.",
    );
    return;
  }

  if (!ownUser) {
    logger.warn(
      `JavaScript steps run each in a process of its own, with none of this Runner's environment, but as this Runner's own user: ${decision.isolation.reason}. ${OWN_USER_REMEDY}`,
    );
  }

  if (noNetwork) {
    logger.info(
      "JavaScript steps run each with no network: their processes may open no socket, and this Runner makes their HTTP requests, to public addresses only.",
    );
  } else {
    logger.warn(
      `JavaScript steps' processes share this Runner's network: ${decision.network.reason}. ${NO_NETWORK_REMEDY}`,
    );
  }
}

/*
 * The Runner's own sandbox: the isolation decided once - at the first step,
 * or as soon as the server says this is a global Runner (prepare) - and said
 * once in the Runner's log, then on every heartbeat (getReport).
 */
export default class JavaScriptSandbox {
  private static decision: Promise<SandboxDecision> | null = null;
  private static decided: SandboxDecision | null = null;
  private static identities: SandboxIdentityPool | null = null;

  public static getDecision(): Promise<SandboxDecision> {
    if (!JavaScriptSandbox.decision) {
      JavaScriptSandbox.decision = Promise.all([
        decideSandboxIsolation({
          launcherPath: SANDBOX_LAUNCHER_PATH,
          call: callLauncher,
          platform: process.platform,
          launcherExists: fs.existsSync,
        }),
        decideSandboxNetwork({
          noNetworkPath: SANDBOX_NO_NETWORK_PATH,
          call: callLauncher,
          platform: process.platform,
          exists: fs.existsSync,
        }),
      ]).then(
        ([isolation, network]: [
          SandboxIsolationDecision,
          SandboxNetworkDecision,
        ]): SandboxDecision => {
          const decision: SandboxDecision = { isolation, network };

          logSandboxDecision(decision);
          JavaScriptSandbox.decided = decision;
          return decision;
        },
      );
    }

    return JavaScriptSandbox.decision;
  }

  // Decides now, before the first step, so the first heartbeat can say.
  public static async prepare(): Promise<void> {
    await JavaScriptSandbox.getDecision();
  }

  /*
   * What the heartbeat says, under its hostInfo's
   * GLOBAL_RUNNER_SANDBOX_HOST_INFO_KEY: the decision, once made; nothing
   * before.
   */
  public static getHostInfo(): JSONObject {
    if (!JavaScriptSandbox.decided) {
      return {};
    }

    return {
      [GLOBAL_RUNNER_SANDBOX_HOST_INFO_KEY]: toSandboxReport(
        JavaScriptSandbox.decided,
      ) as unknown as JSONObject,
    };
  }

  public static async runStep(
    step: SandboxStepRequest,
  ): Promise<JavaScriptStepOutcome> {
    const decision: SandboxDecision = await JavaScriptSandbox.getDecision();

    if (decision.isolation.isolation === SandboxIsolation.OwnUser) {
      JavaScriptSandbox.identities =
        JavaScriptSandbox.identities ||
        new SandboxIdentityPool({
          launcherPath: SANDBOX_LAUNCHER_PATH,
          call: callLauncher,
          hasLiveProcess: hasLiveProcessOfUser,
        });
    }

    return await runSandboxedStep(step, {
      isolation: decision.isolation,
      identities: JavaScriptSandbox.identities,
      launcherPath: SANDBOX_LAUNCHER_PATH,
      network: decision.network,
      noNetworkPath: SANDBOX_NO_NETWORK_PATH,
      workerEntry: getDefaultWorkerEntry(),
      deadlineGraceMs: SANDBOX_DEADLINE_GRACE_MS,
    });
  }

  // For tests: decide again on the next step.
  public static reset(): void {
    JavaScriptSandbox.decision = null;
    JavaScriptSandbox.decided = null;
    JavaScriptSandbox.identities = null;
  }
}
