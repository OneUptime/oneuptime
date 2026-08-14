import { ChildProcess, ForkOptions, execFileSync, fork } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import ConcurrencyLimiter from "./ConcurrencyLimiter";
import {
  SyntheticWorkerResultEnvelope,
  createWorkerNonce,
  createWorkerStartEnvelope,
  isWorkerResultEnvelope,
} from "./WorkerProtocol";

const MINIMUM_SANDBOX_IDENTITY: number = 20_000;
const MAXIMUM_SANDBOX_IDENTITY: number = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES: number = 64 * 1024;
const DEFAULT_TERMINATION_GRACE_IN_MS: number = 1000;
const DEFAULT_KILL_WAIT_IN_MS: number = 1000;
const DEFAULT_MAX_OLD_SPACE_SIZE_IN_MB: number = 256;
const RUN_DIRECTORY_BASE_PREFIX: string = "oneuptime-synthetic-runtime-";
const RUN_DIRECTORY_FORMAT_VERSION: string = "v2";
const RUN_DIRECTORY_PROCESS_TOKEN: string = randomBytes(16).toString("hex");
const CURRENT_RUN_DIRECTORY_PREFIX: string = `${RUN_DIRECTORY_BASE_PREFIX}${RUN_DIRECTORY_FORMAT_VERSION}-${process.pid}-${RUN_DIRECTORY_PROCESS_TOKEN}-`;
const RUN_DIRECTORY_NAME_PATTERN: RegExp =
  /^oneuptime-synthetic-runtime-v2-([1-9]\d*)-([a-f0-9]{32})-([A-Za-z0-9]{6})$/;
const LEGACY_RUN_DIRECTORY_MINIMUM_AGE_IN_MS: number = 24 * 60 * 60 * 1000;
const RUN_DIRECTORY_SCAVENGE_INTERVAL_IN_MS: number = 5 * 60 * 1000;
const PROCESS_TREE_POLL_INTERVAL_IN_MS: number = 50;
const PROCESS_TABLE_MAX_BYTES: number = 5 * 1024 * 1024;
const PROCESS_TABLE_TIMEOUT_IN_MS: number = 1000;
const MAXIMUM_EXECUTION_TIMEOUT_IN_MS: number = 2_147_483_647;
const DEFAULT_MAX_PROCESS_TREE_RSS_BYTES: number = 1536 * 1024 * 1024;
const DEFAULT_RSS_POLL_INTERVAL_IN_MS: number = 250;
const DEFAULT_MAX_DISK_BYTES: number = 256 * 1024 * 1024;
const DEFAULT_MAX_DISK_ENTRIES: number = 10_000;
const DEFAULT_DISK_POLL_INTERVAL_IN_MS: number = 250;
const FILE_SYSTEM_BLOCK_SIZE_IN_BYTES: number = 512;

const ALLOWED_CHILD_ENVIRONMENT_KEYS: ReadonlyArray<string> = [
  "PATH",
  "NODE_ENV",
  "PLAYWRIGHT_BROWSERS_PATH",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY_URL",
  "HTTPS_PROXY_URL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "TZ",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
];

const DEFAULT_PATH: string =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

type ResultValidator<Result> = (value: unknown) => value is Result;

interface ChildExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface ProcessRecord {
  readonly pid: number;
  readonly parentPid: number;
  readonly processGroupId: number;
  readonly rssBytes: number | null;
}

interface ProcessTreeSnapshot {
  readonly records: Map<number, ProcessRecord>;
  readonly callerProcessGroupId: number | null;
}

interface RunDirectoryDiskUsage {
  readonly bytes: number;
  readonly entries: number;
}

interface TrackedProcessTree {
  readonly descendantPids: Set<number>;
  readonly processGroupIds: Set<number>;
  callerProcessGroupId: number | null;
}

interface ParsedRunDirectoryName {
  readonly ownerPid: number;
  readonly processToken: string;
}

interface RunDirectoryScavengeState {
  inFlight: Promise<boolean> | null;
  lastCompletedAtInMs: number | null;
}

interface AllocatedChildIdentity {
  readonly uid: number;
  readonly gid: number;
  readonly release: () => void;
  readonly retain: () => void;
}

const activeChildUids: Set<number> = new Set<number>();
const activeChildGids: Set<number> = new Set<number>();
const runDirectoryScavengeStates: Map<string, RunDirectoryScavengeState> =
  new Map<string, RunDirectoryScavengeState>();

class ChildIdentityAllocator {
  private nextUid: number;
  private nextGid: number;

  public constructor(data: { initialUid: number; initialGid: number }) {
    this.nextUid = data.initialUid;
    this.nextGid = data.initialGid;
  }

  public acquire(): AllocatedChildIdentity {
    const identityCount: number =
      MAXIMUM_SANDBOX_IDENTITY - MINIMUM_SANDBOX_IDENTITY + 1;

    for (let attempt: number = 0; attempt < identityCount; attempt++) {
      const uid: number = this.nextUid;
      const gid: number = this.nextGid;
      this.nextUid = this.incrementIdentity(this.nextUid);
      this.nextGid = this.incrementIdentity(this.nextGid);

      if (activeChildUids.has(uid) || activeChildGids.has(gid)) {
        continue;
      }

      activeChildUids.add(uid);
      activeChildGids.add(gid);
      let hasReleased: boolean = false;
      let shouldRetain: boolean = false;

      return {
        uid,
        gid,
        retain: (): void => {
          shouldRetain = true;
        },
        release: (): void => {
          if (hasReleased || shouldRetain) {
            return;
          }

          hasReleased = true;
          activeChildUids.delete(uid);
          activeChildGids.delete(gid);
        },
      };
    }

    throw new Error("No synthetic runtime sandbox identities are available.");
  }

  private incrementIdentity(identity: number): number {
    return identity >= MAXIMUM_SANDBOX_IDENTITY
      ? MINIMUM_SANDBOX_IDENTITY
      : identity + 1;
  }
}

export interface ProcessRunnerOptions {
  readonly workerEntryPath: string;
  readonly concurrencyLimit: number;
  readonly childUid?: number | undefined;
  readonly childGid?: number | undefined;
  readonly workingDirectory?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly maxPendingCount?: number | undefined;
  readonly maxProcessTreeRssBytes?: number | undefined;
  readonly rssPollIntervalInMs?: number | undefined;
  readonly maxDiskBytes?: number | undefined;
  readonly maxDiskEntries?: number | undefined;
  readonly diskPollIntervalInMs?: number | undefined;
  readonly maxOutputBytes?: number | undefined;
  readonly terminationGraceInMs?: number | undefined;
  readonly killWaitInMs?: number | undefined;
  readonly maxOldSpaceSizeInMb?: number | undefined;
}

export interface ProcessRunOptions<Config, Result> {
  readonly payload: Config;
  readonly timeoutInMs: number;
  readonly queueTimeoutInMs?: number | undefined;
  readonly validateResult?: ResultValidator<Result> | undefined;
}

export interface ProcessRunResult<Result> {
  readonly result: Result;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export class SyntheticProcessRunnerError extends Error {
  public readonly stdout: string;
  public readonly stderr: string;
  public readonly stdoutTruncated: boolean;
  public readonly stderrTruncated: boolean;

  public constructor(data: {
    message: string;
    stdout: BoundedOutput;
    stderr: BoundedOutput;
  }) {
    super(data.message);
    this.name = "SyntheticProcessRunnerError";
    this.stdout = data.stdout.toString();
    this.stderr = data.stderr.toString();
    this.stdoutTruncated = data.stdout.isTruncated;
    this.stderrTruncated = data.stderr.isTruncated;
  }
}

class BoundedOutput {
  private readonly maxBytes: number;
  private buffer: Buffer = Buffer.alloc(0);
  private truncated: boolean = false;

  public constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  public get isTruncated(): boolean {
    return this.truncated;
  }

  public append(chunk: unknown): void {
    const incoming: Buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), "utf8");

    if (incoming.length >= this.maxBytes) {
      this.buffer = incoming.subarray(incoming.length - this.maxBytes);
      this.truncated = true;
      return;
    }

    const bytesToKeepFromExisting: number = Math.max(
      0,
      this.maxBytes - incoming.length,
    );

    if (this.buffer.length > bytesToKeepFromExisting) {
      this.buffer = this.buffer.subarray(
        this.buffer.length - bytesToKeepFromExisting,
      );
      this.truncated = true;
    }

    this.buffer = Buffer.concat([this.buffer, incoming]);
  }

  public toString(): string {
    const text: string = this.buffer.toString("utf8");
    return this.truncated ? `[output truncated]\n${text}` : text;
  }
}

export default class ProcessRunner {
  private readonly options: ProcessRunnerOptions;
  private readonly concurrencyLimiter: ConcurrencyLimiter;
  private readonly maxOutputBytes: number;
  private readonly terminationGraceInMs: number;
  private readonly killWaitInMs: number;
  private readonly maxOldSpaceSizeInMb: number;
  private readonly maxProcessTreeRssBytes: number;
  private readonly rssPollIntervalInMs: number;
  private readonly maxDiskBytes: number;
  private readonly maxDiskEntries: number;
  private readonly diskPollIntervalInMs: number;
  private readonly childIdentityAllocator: ChildIdentityAllocator;

  public constructor(options: ProcessRunnerOptions) {
    if (!options.workerEntryPath.trim()) {
      throw new Error("Synthetic worker entry path is required.");
    }

    this.assertPositiveInteger(
      options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      "maximum output bytes",
    );
    this.assertNonNegativeInteger(
      options.terminationGraceInMs ?? DEFAULT_TERMINATION_GRACE_IN_MS,
      "termination grace period",
    );
    this.assertNonNegativeInteger(
      options.killWaitInMs ?? DEFAULT_KILL_WAIT_IN_MS,
      "kill wait period",
    );
    this.assertPositiveInteger(
      options.maxOldSpaceSizeInMb ?? DEFAULT_MAX_OLD_SPACE_SIZE_IN_MB,
      "maximum old-space size",
    );
    this.assertPositiveInteger(
      options.maxProcessTreeRssBytes ?? DEFAULT_MAX_PROCESS_TREE_RSS_BYTES,
      "maximum process-tree RSS bytes",
    );
    this.assertTimerInterval(
      options.rssPollIntervalInMs ?? DEFAULT_RSS_POLL_INTERVAL_IN_MS,
      "RSS poll interval",
    );
    this.assertPositiveInteger(
      options.maxDiskBytes ?? DEFAULT_MAX_DISK_BYTES,
      "maximum disk bytes",
    );
    this.assertPositiveInteger(
      options.maxDiskEntries ?? DEFAULT_MAX_DISK_ENTRIES,
      "maximum disk entries",
    );
    this.assertTimerInterval(
      options.diskPollIntervalInMs ?? DEFAULT_DISK_POLL_INTERVAL_IN_MS,
      "disk poll interval",
    );

    if (options.childUid !== undefined) {
      this.assertSandboxIdentity(options.childUid, "child uid");
    }

    if (options.childGid !== undefined) {
      this.assertSandboxIdentity(options.childGid, "child gid");
    }

    this.options = options;
    this.concurrencyLimiter =
      options.maxPendingCount === undefined
        ? new ConcurrencyLimiter(options.concurrencyLimit)
        : new ConcurrencyLimiter(
            options.concurrencyLimit,
            options.maxPendingCount,
          );
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.terminationGraceInMs =
      options.terminationGraceInMs ?? DEFAULT_TERMINATION_GRACE_IN_MS;
    this.killWaitInMs = options.killWaitInMs ?? DEFAULT_KILL_WAIT_IN_MS;
    this.maxOldSpaceSizeInMb =
      options.maxOldSpaceSizeInMb ?? DEFAULT_MAX_OLD_SPACE_SIZE_IN_MB;
    this.maxProcessTreeRssBytes =
      options.maxProcessTreeRssBytes ?? DEFAULT_MAX_PROCESS_TREE_RSS_BYTES;
    this.rssPollIntervalInMs =
      options.rssPollIntervalInMs ?? DEFAULT_RSS_POLL_INTERVAL_IN_MS;
    this.maxDiskBytes = options.maxDiskBytes ?? DEFAULT_MAX_DISK_BYTES;
    this.maxDiskEntries = options.maxDiskEntries ?? DEFAULT_MAX_DISK_ENTRIES;
    this.diskPollIntervalInMs =
      options.diskPollIntervalInMs ?? DEFAULT_DISK_POLL_INTERVAL_IN_MS;
    this.childIdentityAllocator = new ChildIdentityAllocator({
      initialUid: options.childUid ?? MINIMUM_SANDBOX_IDENTITY,
      initialGid: options.childGid ?? MINIMUM_SANDBOX_IDENTITY,
    });
  }

  public get activeCount(): number {
    return this.concurrencyLimiter.activeCount;
  }

  public get pendingCount(): number {
    return this.concurrencyLimiter.pendingCount;
  }

  public get pendingLimit(): number {
    return this.concurrencyLimiter.pendingLimit;
  }

  public async run<Config, Result>(
    data: ProcessRunOptions<Config, Result>,
  ): Promise<ProcessRunResult<Result>> {
    this.assertExecutionTimeout(data.timeoutInMs);
    if (data.queueTimeoutInMs !== undefined) {
      this.assertTimerInterval(data.queueTimeoutInMs, "queue timeout");
    }

    const sharedDeadlineAtInMs: number | null =
      data.queueTimeoutInMs === undefined
        ? Date.now() + data.timeoutInMs
        : null;

    return this.concurrencyLimiter.run(() => {
      const deadlineAtInMs: number =
        sharedDeadlineAtInMs ?? Date.now() + data.timeoutInMs;
      return this.runWithAcquiredSlot({ ...data, deadlineAtInMs });
    }, data.queueTimeoutInMs ?? data.timeoutInMs);
  }

  private async runWithAcquiredSlot<Config, Result>(
    data: ProcessRunOptions<Config, Result> & {
      readonly deadlineAtInMs: number;
    },
  ): Promise<ProcessRunResult<Result>> {
    this.throwIfExecutionDeadlineExpired(data);
    const temporaryRootDirectory: string = os.tmpdir();
    await this.maybeScavengeRunDirectories({
      temporaryRootDirectory,
      deadlineAtInMs: data.deadlineAtInMs,
      timeoutInMs: data.timeoutInMs,
    });
    this.throwIfExecutionDeadlineExpired(data);
    const runDirectory: string = await fs.promises.mkdtemp(
      path.join(temporaryRootDirectory, CURRENT_RUN_DIRECTORY_PREFIX),
    );

    let identity: AllocatedChildIdentity | null = null;

    try {
      this.throwIfExecutionDeadlineExpired(data);
      await fs.promises.chmod(runDirectory, 0o700);
      this.throwIfExecutionDeadlineExpired(data);

      identity = this.allocateChildIdentity();

      if (identity) {
        await fs.promises.chown(runDirectory, identity.uid, identity.gid);
        this.throwIfExecutionDeadlineExpired(data);
      }

      return await this.executeChild({
        ...data,
        runDirectory,
        identity,
      });
    } finally {
      try {
        await fs.promises.rm(runDirectory, {
          recursive: true,
          force: true,
        });
      } finally {
        identity?.release();
      }
    }
  }

  private async maybeScavengeRunDirectories(data: {
    readonly temporaryRootDirectory: string;
    readonly deadlineAtInMs: number;
    readonly timeoutInMs: number;
  }): Promise<void> {
    const stateKey: string = path.resolve(data.temporaryRootDirectory);
    let state: RunDirectoryScavengeState | undefined =
      runDirectoryScavengeStates.get(stateKey);
    if (!state) {
      state = {
        inFlight: null,
        lastCompletedAtInMs: null,
      };
      runDirectoryScavengeStates.set(stateKey, state);
    }

    if (state.inFlight) {
      await this.waitForScavengeWithinDeadline({
        scavenge: state.inFlight,
        deadlineAtInMs: data.deadlineAtInMs,
        timeoutInMs: data.timeoutInMs,
      });
      return;
    }

    const nowInMs: number = Date.now();
    if (
      state.lastCompletedAtInMs !== null &&
      nowInMs >= state.lastCompletedAtInMs &&
      nowInMs - state.lastCompletedAtInMs <
        RUN_DIRECTORY_SCAVENGE_INTERVAL_IN_MS
    ) {
      return;
    }

    const scavenge: Promise<boolean> = this.scavengeRunDirectories(data);
    state.inFlight = scavenge;
    void scavenge.then(
      (didComplete: boolean): void => {
        if (didComplete) {
          state.lastCompletedAtInMs = Date.now();
        }
        if (state.inFlight === scavenge) {
          state.inFlight = null;
        }
      },
      (): void => {
        /*
         * Scavenging is maintenance. An unreadable or changing temp directory
         * is preserved rather than making execution depend on cleanup.
         */
        if (state.inFlight === scavenge) {
          state.inFlight = null;
        }
      },
    );

    await this.waitForScavengeWithinDeadline({
      scavenge,
      deadlineAtInMs: data.deadlineAtInMs,
      timeoutInMs: data.timeoutInMs,
    });
  }

  private async waitForScavengeWithinDeadline(data: {
    readonly scavenge: Promise<boolean>;
    readonly deadlineAtInMs: number;
    readonly timeoutInMs: number;
  }): Promise<void> {
    const remainingTimeInMs: number = this.getRemainingTimeInMs(
      data.deadlineAtInMs,
    );
    if (remainingTimeInMs <= 0) {
      throw this.createExecutionTimeoutError(data.timeoutInMs);
    }

    let didTimeOut: boolean = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      data.scavenge.then(
        (): void => {},
        (): void => {},
      ),
      new Promise<void>((resolve: () => void) => {
        timeoutHandle = global.setTimeout(() => {
          didTimeOut = true;
          resolve();
        }, remainingTimeInMs);
        timeoutHandle.unref?.();
      }),
    ]);

    if (timeoutHandle) {
      global.clearTimeout(timeoutHandle);
    }
    if (didTimeOut) {
      throw this.createExecutionTimeoutError(data.timeoutInMs);
    }
  }

  private async scavengeRunDirectories(data: {
    readonly temporaryRootDirectory: string;
    readonly deadlineAtInMs: number;
  }): Promise<boolean> {
    if (this.getRemainingTimeInMs(data.deadlineAtInMs) <= 0) {
      return false;
    }

    let temporaryRoot: fs.Dir;
    try {
      temporaryRoot = await fs.promises.opendir(data.temporaryRootDirectory);
    } catch {
      return false;
    }

    if (this.getRemainingTimeInMs(data.deadlineAtInMs) <= 0) {
      await temporaryRoot.close().catch((): void => {});
      return false;
    }

    try {
      for await (const entry of temporaryRoot) {
        if (this.getRemainingTimeInMs(data.deadlineAtInMs) <= 0) {
          return false;
        }

        if (!entry.name.startsWith(RUN_DIRECTORY_BASE_PREFIX)) {
          continue;
        }

        const candidatePath: string = path.join(
          data.temporaryRootDirectory,
          entry.name,
        );
        let candidateStats: fs.Stats;
        try {
          candidateStats = await fs.promises.lstat(candidatePath);
        } catch {
          continue;
        }

        if (
          candidateStats.isSymbolicLink() ||
          !candidateStats.isDirectory() ||
          !this.shouldDeleteRunDirectory({
            directoryName: entry.name,
            stats: candidateStats,
            nowInMs: Date.now(),
          })
        ) {
          continue;
        }

        let confirmedStats: fs.Stats;
        try {
          confirmedStats = await fs.promises.lstat(candidatePath);
        } catch {
          continue;
        }

        if (
          confirmedStats.isSymbolicLink() ||
          !confirmedStats.isDirectory() ||
          confirmedStats.dev !== candidateStats.dev ||
          confirmedStats.ino !== candidateStats.ino ||
          !this.shouldDeleteRunDirectory({
            directoryName: entry.name,
            stats: confirmedStats,
            nowInMs: Date.now(),
          }) ||
          this.getRemainingTimeInMs(data.deadlineAtInMs) <= 0
        ) {
          continue;
        }

        try {
          await fs.promises.rm(candidatePath, {
            recursive: true,
            force: false,
          });
        } catch {
          /*
           * A directory can disappear or become inaccessible while scanning.
           * Preserve uncertain paths and retry them on a future pass.
           */
        }
      }
    } catch {
      return false;
    }

    return this.getRemainingTimeInMs(data.deadlineAtInMs) > 0;
  }

  private shouldDeleteRunDirectory(data: {
    readonly directoryName: string;
    readonly stats: fs.Stats;
    readonly nowInMs: number;
  }): boolean {
    const parsed: ParsedRunDirectoryName | null = this.parseRunDirectoryName(
      data.directoryName,
    );
    if (parsed) {
      if (parsed.processToken === RUN_DIRECTORY_PROCESS_TOKEN) {
        return false;
      }

      if (!this.isPermittedRunDirectoryOwner(data.stats)) {
        return false;
      }

      if (parsed.ownerPid === process.pid) {
        return true;
      }

      /*
       * PID 1 is normally a live init process and is intentionally excluded
       * from signalling. Only a supervisor that itself runs as PID 1 may
       * classify a token-mismatched PID-1 directory as a reused-PID leftover.
       */
      if (parsed.ownerPid === 1) {
        return false;
      }

      return !this.isPidAlive(parsed.ownerPid);
    }

    if (!this.isPermittedRunDirectoryOwner(data.stats)) {
      return false;
    }

    const ageInMs: number = data.nowInMs - data.stats.mtimeMs;
    return (
      Number.isFinite(ageInMs) &&
      ageInMs >= LEGACY_RUN_DIRECTORY_MINIMUM_AGE_IN_MS
    );
  }

  private parseRunDirectoryName(
    directoryName: string,
  ): ParsedRunDirectoryName | null {
    const match: RegExpExecArray | null =
      RUN_DIRECTORY_NAME_PATTERN.exec(directoryName);
    if (!match) {
      return null;
    }

    const ownerPid: number = Number(match[1]);
    const processToken: string | undefined = match[2];
    if (!Number.isSafeInteger(ownerPid) || ownerPid < 1 || !processToken) {
      return null;
    }

    return { ownerPid, processToken };
  }

  private isPermittedRunDirectoryOwner(stats: fs.Stats): boolean {
    if (typeof process.getuid !== "function") {
      return true;
    }

    const supervisorUid: number = process.getuid();
    if (supervisorUid !== 0) {
      return stats.uid === supervisorUid;
    }

    return (
      stats.uid === 0 ||
      (stats.uid >= MINIMUM_SANDBOX_IDENTITY &&
        stats.uid <= MAXIMUM_SANDBOX_IDENTITY)
    );
  }

  private async executeChild<Config, Result>(data: {
    payload: Config;
    timeoutInMs: number;
    deadlineAtInMs: number;
    validateResult?: ResultValidator<Result> | undefined;
    runDirectory: string;
    identity: AllocatedChildIdentity | null;
  }): Promise<ProcessRunResult<Result>> {
    const nonce: string = createWorkerNonce();
    const stdout: BoundedOutput = new BoundedOutput(this.maxOutputBytes);
    const stderr: BoundedOutput = new BoundedOutput(this.maxOutputBytes);
    this.throwIfExecutionDeadlineExpired(data);
    const forkOptions: ForkOptions = {
      cwd: this.options.workingDirectory || process.cwd(),
      detached: true,
      env: this.buildChildEnvironment(data.runDirectory),
      execArgv: this.buildChildExecArgv(),
      serialization: "advanced",
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    };

    if (data.identity) {
      forkOptions.uid = data.identity.uid;
      forkOptions.gid = data.identity.gid;
    }

    const child: ChildProcess = fork(
      path.resolve(this.options.workerEntryPath),
      [],
      forkOptions,
    );

    const onStdout: (chunk: unknown) => void = (chunk: unknown): void => {
      stdout.append(chunk);
    };
    const onStderr: (chunk: unknown) => void = (chunk: unknown): void => {
      stderr.append(chunk);
    };

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);

    let hasExited: boolean = false;
    let resolveExit: (exit: ChildExit) => void = (): void => {};
    const exitPromise: Promise<ChildExit> = new Promise<ChildExit>(
      (resolve: (exit: ChildExit) => void) => {
        resolveExit = resolve;
      },
    );

    let hasCompleted: boolean = false;
    let messageCount: number = 0;
    let protocolError: Error | undefined;
    let resolveCompletion: (
      envelope: SyntheticWorkerResultEnvelope<Result>,
    ) => void = (): void => {};
    let rejectCompletion: (error: Error) => void = (): void => {};
    const completionPromise: Promise<SyntheticWorkerResultEnvelope<Result>> =
      new Promise<SyntheticWorkerResultEnvelope<Result>>(
        (
          resolve: (envelope: SyntheticWorkerResultEnvelope<Result>) => void,
          reject: (error: Error) => void,
        ) => {
          resolveCompletion = resolve;
          rejectCompletion = reject;
        },
      );

    const completeWithError: (error: Error) => void = (error: Error): void => {
      if (hasCompleted) {
        return;
      }
      hasCompleted = true;
      rejectCompletion(error);
    };

    const onMessage: (message: unknown) => void = (message: unknown): void => {
      messageCount++;

      if (messageCount > 1) {
        protocolError = new Error(
          "Synthetic worker sent more than one result message.",
        );
        completeWithError(protocolError);
        return;
      }

      const validation: {
        value: unknown;
        expectedNonce: string;
        validateResult?: ResultValidator<Result> | undefined;
      } = {
        value: message,
        expectedNonce: nonce,
        validateResult: data.validateResult,
      };

      if (!isWorkerResultEnvelope<Result>(validation)) {
        protocolError = new Error(
          "Synthetic worker sent an invalid result envelope.",
        );
        completeWithError(protocolError);
        return;
      }

      hasCompleted = true;
      resolveCompletion(validation.value);
    };

    const onError: (error: Error) => void = (error: Error): void => {
      completeWithError(error);
    };

    const onExit: (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => void = (code: number | null, signal: NodeJS.Signals | null): void => {
      hasExited = true;
      resolveExit({ code, signal });

      if (!hasCompleted) {
        completeWithError(
          new Error(
            `Synthetic worker exited before returning a result (code: ${
              code === null ? "null" : code
            }, signal: ${signal || "none"}).`,
          ),
        );
      }
    };

    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);

    const trackedTree: TrackedProcessTree = this.createTrackedProcessTree(
      child.pid,
    );

    const stopRssWatchdog: () => void = child.pid
      ? this.startProcessTreeRssWatchdog({
          rootPid: child.pid,
          trackedTree,
          onLimitExceeded: (observedRssBytes: number): void => {
            completeWithError(
              new Error(
                `Synthetic worker process tree exceeded RSS limit of ${this.maxProcessTreeRssBytes} bytes (observed ${observedRssBytes} bytes).`,
              ),
            );
          },
        })
      : (): void => {};
    const stopDiskWatchdog: () => Promise<void> =
      this.startRunDirectoryDiskWatchdog({
        runDirectory: data.runDirectory,
        deadlineAtInMs: data.deadlineAtInMs,
        onLimitExceeded: (observedDiskBytes: number): void => {
          completeWithError(
            new Error(
              `Synthetic worker run directory exceeded disk limit of ${this.maxDiskBytes} bytes (observed ${observedDiskBytes} bytes).`,
            ),
          );
        },
        onEntryLimitExceeded: (observedDiskEntries: number): void => {
          completeWithError(
            new Error(
              `Synthetic worker run directory exceeded entry limit of ${this.maxDiskEntries} entries (observed ${observedDiskEntries} entries).`,
            ),
          );
        },
        onMeasurementError: (): void => {
          completeWithError(
            new Error(
              "Synthetic worker run directory disk usage could not be measured safely.",
            ),
          );
        },
      });

    const remainingTimeInMs: number = this.getRemainingTimeInMs(
      data.deadlineAtInMs,
    );
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (remainingTimeInMs <= 0) {
      completeWithError(this.createExecutionTimeoutError(data.timeoutInMs));
    } else {
      timeoutHandle = global.setTimeout(() => {
        completeWithError(this.createExecutionTimeoutError(data.timeoutInMs));
      }, remainingTimeInMs);
    }

    try {
      let envelope: SyntheticWorkerResultEnvelope<Result> | undefined;
      try {
        if (remainingTimeInMs > 0 && !hasCompleted) {
          child.send(
            createWorkerStartEnvelope({ nonce, config: data.payload }),
            (error: Error | null): void => {
              if (error) {
                completeWithError(error);
              }
            },
          );
        }

        envelope = await completionPromise;
      } catch (error: unknown) {
        /*
         * A synchronous IPC send failure occurs before completionPromise is
         * awaited. Mark the attempt complete so a later exit event cannot
         * reject that otherwise-unobserved promise.
         */
        hasCompleted = true;
        throw this.createRunnerError({
          message:
            error instanceof Error
              ? error.message
              : "Synthetic worker failed unexpectedly.",
          stdout,
          stderr,
        });
      } finally {
        if (timeoutHandle) {
          global.clearTimeout(timeoutHandle);
        }
        stopRssWatchdog();
        await stopDiskWatchdog();
        const didTerminate: boolean = await this.terminateChild({
          child,
          exitPromise,
          trackedTree,
          hasExited: (): boolean => {
            return hasExited;
          },
        });

        if (!didTerminate) {
          data.identity?.retain();
        }
      }

      if (!envelope) {
        throw this.createRunnerError({
          message: "Synthetic worker did not return a result.",
          stdout,
          stderr,
        });
      }

      if (protocolError) {
        throw this.createRunnerError({
          message: protocolError.message,
          stdout,
          stderr,
        });
      }

      if (!envelope.ok) {
        const remoteStack: string = envelope.error.stack
          ? `\n${envelope.error.stack}`
          : "";
        throw this.createRunnerError({
          message: `${envelope.error.message}${remoteStack}`,
          stdout,
          stderr,
        });
      }

      return {
        result: envelope.result,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        stdoutTruncated: stdout.isTruncated,
        stderrTruncated: stderr.isTruncated,
      };
    } finally {
      if (timeoutHandle) {
        global.clearTimeout(timeoutHandle);
      }
      stopRssWatchdog();
      await stopDiskWatchdog();
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.stdout?.removeListener("data", onStdout);
      child.stderr?.removeListener("data", onStderr);
    }
  }

  private buildChildEnvironment(runDirectory: string): NodeJS.ProcessEnv {
    const source: NodeJS.ProcessEnv = this.options.environment || process.env;
    const environment: NodeJS.ProcessEnv = {};

    for (const key of ALLOWED_CHILD_ENVIRONMENT_KEYS) {
      const value: string | undefined = source[key];
      if (typeof value === "string") {
        environment[key] = value;
      }
    }

    this.mapProxyUrlToConventionalEnvironment({
      environment,
      proxyUrlKey: "HTTP_PROXY_URL",
      conventionalKeys: ["HTTP_PROXY", "http_proxy"],
    });
    this.mapProxyUrlToConventionalEnvironment({
      environment,
      proxyUrlKey: "HTTPS_PROXY_URL",
      conventionalKeys: ["HTTPS_PROXY", "https_proxy"],
    });

    environment["PATH"] = environment["PATH"] || DEFAULT_PATH;
    environment["HOME"] = runDirectory;
    environment["TMPDIR"] = runDirectory;
    environment["TMP"] = runDirectory;
    environment["TEMP"] = runDirectory;
    environment["XDG_CACHE_HOME"] = runDirectory;
    environment["XDG_CONFIG_HOME"] = runDirectory;
    environment["XDG_DATA_HOME"] = runDirectory;
    environment["XDG_RUNTIME_DIR"] = runDirectory;
    environment["CHROME_CONFIG_HOME"] = runDirectory;
    environment["CHROME_USER_DATA_DIR"] = runDirectory;
    environment["USERPROFILE"] = runDirectory;
    environment["LOCALAPPDATA"] = runDirectory;
    environment["APPDATA"] = runDirectory;
    return environment;
  }

  private mapProxyUrlToConventionalEnvironment(data: {
    environment: NodeJS.ProcessEnv;
    proxyUrlKey: "HTTP_PROXY_URL" | "HTTPS_PROXY_URL";
    conventionalKeys: readonly [string, string];
  }): void {
    const hasConventionalValue: boolean = data.conventionalKeys.some(
      (key: string): boolean => {
        return typeof data.environment[key] === "string";
      },
    );

    if (hasConventionalValue) {
      return;
    }

    const proxyUrl: string | undefined = data.environment[data.proxyUrlKey];
    if (typeof proxyUrl !== "string") {
      return;
    }

    for (const key of data.conventionalKeys) {
      data.environment[key] = proxyUrl;
    }
  }

  private buildChildExecArgv(): string[] {
    const childExecArgv: string[] = [];

    /*
     * Never inherit arbitrary parent flags. In particular, forwarding -e/-p
     * would execute the Probe's parent command instead of the worker module,
     * while --require/--loader hooks would inject host code into the boundary.
     */
    // eslint-disable-next-line wrap-regex -- Parentheses conflict with Prettier.
    if (/\.tsx?$/i.test(this.options.workerEntryPath)) {
      childExecArgv.push("--require", "ts-node/register/transpile-only");
    }

    childExecArgv.push("--no-node-snapshot");
    childExecArgv.push(`--max-old-space-size=${this.maxOldSpaceSizeInMb}`);
    return childExecArgv;
  }

  private allocateChildIdentity(): AllocatedChildIdentity | null {
    if (typeof process.getuid !== "function" || process.getuid() !== 0) {
      return null;
    }

    return this.childIdentityAllocator.acquire();
  }

  private createTrackedProcessTree(
    rootPid: number | undefined,
  ): TrackedProcessTree {
    const processGroupIds: Set<number> = new Set<number>();

    /*
     * A detached POSIX child is the leader of a new process group whose PGID
     * is its PID. Retain that guaranteed target even if the Node group leader
     * exits and its browser descendants are reparented before final cleanup.
     */
    if (
      process.platform !== "win32" &&
      rootPid !== undefined &&
      this.isSafeSignalTarget(rootPid)
    ) {
      processGroupIds.add(rootPid);
    }

    return {
      descendantPids: new Set<number>(),
      processGroupIds,
      callerProcessGroupId: null,
    };
  }

  private async terminateChild(data: {
    child: ChildProcess;
    exitPromise: Promise<ChildExit>;
    trackedTree: TrackedProcessTree;
    hasExited: () => boolean;
  }): Promise<boolean> {
    if (!data.child.pid) {
      return data.hasExited();
    }

    this.refreshTrackedProcessTree(data.child.pid, data.trackedTree);

    if (!this.isTrackedProcessTreeAlive(data, data.trackedTree)) {
      return true;
    }

    this.signalTrackedProcessTree({
      ...data,
      signal: "SIGTERM",
    });
    if (
      await this.waitForTrackedProcessTreeExit({
        ...data,
        signalForNewProcesses: "SIGTERM",
        timeoutInMs: this.terminationGraceInMs,
      })
    ) {
      return true;
    }

    this.refreshTrackedProcessTree(data.child.pid, data.trackedTree);
    this.signalTrackedProcessTree({
      ...data,
      signal: "SIGKILL",
    });
    return await this.waitForTrackedProcessTreeExit({
      ...data,
      signalForNewProcesses: "SIGKILL",
      timeoutInMs: this.killWaitInMs,
    });
  }

  private signalTrackedProcessTree(data: {
    child: ChildProcess;
    hasExited: () => boolean;
    trackedTree: TrackedProcessTree;
    signal: NodeJS.Signals;
    onlyPids?: ReadonlySet<number> | undefined;
    onlyProcessGroupIds?: ReadonlySet<number> | undefined;
  }): void {
    const processGroupIds: ReadonlySet<number> =
      data.onlyProcessGroupIds || data.trackedTree.processGroupIds;
    const descendantPids: ReadonlySet<number> =
      data.onlyPids || data.trackedTree.descendantPids;

    for (const processGroupId of processGroupIds) {
      this.signalPid(-processGroupId, data.signal);
    }

    for (const pid of descendantPids) {
      this.signalPid(pid, data.signal);
    }

    if (!data.hasExited()) {
      try {
        data.child.kill(data.signal);
      } catch {
        // Best effort: an already-exited process needs no further cleanup.
      }
    }
  }

  private signalPid(pid: number, signal: NodeJS.Signals): void {
    if (!this.isSafeSignalTarget(pid)) {
      return;
    }

    try {
      process.kill(pid, signal);
    } catch {
      // Processes can exit between discovery and signalling.
    }
  }

  private async waitForExitOrTimeout(
    exitPromise: Promise<ChildExit>,
    timeoutInMs: number,
  ): Promise<void> {
    if (timeoutInMs === 0) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      let hasResolved: boolean = false;
      const finish: () => void = (): void => {
        if (hasResolved) {
          return;
        }
        hasResolved = true;
        global.clearTimeout(timer);
        resolve();
      };
      const timer: ReturnType<typeof setTimeout> = global.setTimeout(
        finish,
        timeoutInMs,
      );
      exitPromise.then(finish).catch(finish);
    });
  }

  private isTrackedProcessTreeAlive(
    data: {
      child: ChildProcess;
      hasExited: () => boolean;
    },
    trackedTree: TrackedProcessTree,
  ): boolean {
    if (!data.hasExited()) {
      return true;
    }

    for (const pid of trackedTree.descendantPids) {
      if (this.isPidAlive(pid)) {
        return true;
      }
    }

    for (const processGroupId of trackedTree.processGroupIds) {
      if (this.isPidAlive(-processGroupId)) {
        return true;
      }
    }

    return false;
  }

  private isPidAlive(pid: number): boolean {
    if (!this.isSafeSignalTarget(pid)) {
      return false;
    }

    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      return !(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      );
    }
  }

  private isSafeSignalTarget(pid: number): boolean {
    const absolutePid: number = Math.abs(pid);
    return (
      Number.isInteger(pid) && absolutePid > 1 && absolutePid !== process.pid
    );
  }

  private async waitForTrackedProcessTreeExit(data: {
    child: ChildProcess;
    exitPromise: Promise<ChildExit>;
    hasExited: () => boolean;
    trackedTree: TrackedProcessTree;
    signalForNewProcesses: NodeJS.Signals;
    timeoutInMs: number;
  }): Promise<boolean> {
    if (process.platform === "win32") {
      await this.waitForExitOrTimeout(data.exitPromise, data.timeoutInMs);
      return !this.isTrackedProcessTreeAlive(data, data.trackedTree);
    }

    const deadline: number = Date.now() + data.timeoutInMs;

    while (true) {
      const newTargets: {
        readonly pids: Set<number>;
        readonly processGroupIds: Set<number>;
      } = this.refreshTrackedProcessTree(
        data.child.pid as number,
        data.trackedTree,
      );

      if (newTargets.pids.size > 0 || newTargets.processGroupIds.size > 0) {
        this.signalTrackedProcessTree({
          ...data,
          signal: data.signalForNewProcesses,
          onlyPids: newTargets.pids,
          onlyProcessGroupIds: newTargets.processGroupIds,
        });
      }

      if (!this.isTrackedProcessTreeAlive(data, data.trackedTree)) {
        return true;
      }

      const remainingInMs: number = deadline - Date.now();
      if (remainingInMs <= 0) {
        return false;
      }

      await new Promise<void>((resolve: () => void) => {
        global.setTimeout(
          resolve,
          Math.min(remainingInMs, PROCESS_TREE_POLL_INTERVAL_IN_MS),
        );
      });
    }
  }

  private refreshTrackedProcessTree(
    rootPid: number,
    trackedTree: TrackedProcessTree,
  ): {
    readonly pids: Set<number>;
    readonly processGroupIds: Set<number>;
  } {
    const seedPids: Set<number> = new Set<number>([
      rootPid,
      ...trackedTree.descendantPids,
    ]);
    const snapshot: ProcessTreeSnapshot = this.getProcessTreeSnapshot(seedPids);
    return this.mergeProcessTreeSnapshot(rootPid, trackedTree, snapshot);
  }

  private mergeProcessTreeSnapshot(
    rootPid: number,
    trackedTree: TrackedProcessTree,
    snapshot: ProcessTreeSnapshot,
  ): {
    readonly pids: Set<number>;
    readonly processGroupIds: Set<number>;
  } {
    const newPids: Set<number> = new Set<number>();
    const newProcessGroupIds: Set<number> = new Set<number>();

    if (snapshot.callerProcessGroupId !== null) {
      trackedTree.callerProcessGroupId = snapshot.callerProcessGroupId;
    }

    for (const record of snapshot.records.values()) {
      if (
        record.pid !== rootPid &&
        !trackedTree.descendantPids.has(record.pid) &&
        this.isSafeSignalTarget(record.pid)
      ) {
        trackedTree.descendantPids.add(record.pid);
        newPids.add(record.pid);
      }
    }

    if (trackedTree.callerProcessGroupId === null) {
      return { pids: newPids, processGroupIds: newProcessGroupIds };
    }

    for (const record of snapshot.records.values()) {
      const processGroupId: number = record.processGroupId;
      const groupLeader: ProcessRecord | undefined =
        snapshot.records.get(processGroupId);

      if (
        processGroupId <= 1 ||
        processGroupId === trackedTree.callerProcessGroupId ||
        processGroupId === process.pid ||
        !groupLeader ||
        groupLeader.processGroupId !== processGroupId ||
        (groupLeader.pid !== rootPid &&
          !trackedTree.descendantPids.has(groupLeader.pid)) ||
        trackedTree.processGroupIds.has(processGroupId)
      ) {
        continue;
      }

      trackedTree.processGroupIds.add(processGroupId);
      newProcessGroupIds.add(processGroupId);
    }

    return { pids: newPids, processGroupIds: newProcessGroupIds };
  }

  private getProcessTreeSnapshot(
    seedPids: ReadonlySet<number>,
  ): ProcessTreeSnapshot {
    if (process.platform === "linux") {
      const linuxSnapshot: ProcessTreeSnapshot | null =
        this.getLinuxProcessTreeSnapshot(seedPids);
      if (linuxSnapshot) {
        return linuxSnapshot;
      }
    }

    return this.getPortableProcessTreeSnapshot(seedPids);
  }

  private getLinuxProcessTreeSnapshot(
    seedPids: ReadonlySet<number>,
  ): ProcessTreeSnapshot | null {
    if (!fs.existsSync("/proc/self/stat")) {
      return null;
    }

    const records: Map<number, ProcessRecord> = new Map<
      number,
      ProcessRecord
    >();
    const pendingPids: number[] = [...seedPids];
    const visitedPids: Set<number> = new Set<number>();

    while (pendingPids.length > 0) {
      const pid: number | undefined = pendingPids.shift();
      if (!pid || visitedPids.has(pid)) {
        continue;
      }
      visitedPids.add(pid);

      const record: ProcessRecord | null = this.readLinuxProcessRecord(pid);
      if (!record) {
        continue;
      }
      records.set(pid, record);

      for (const childPid of this.readLinuxDirectChildPids(pid)) {
        if (!visitedPids.has(childPid)) {
          pendingPids.push(childPid);
        }
      }
    }

    const callerRecord: ProcessRecord | null = this.readLinuxProcessRecord(
      process.pid,
    );
    if (records.size === 0) {
      return null;
    }

    return {
      records,
      callerProcessGroupId: callerRecord?.processGroupId ?? null,
    };
  }

  private readLinuxDirectChildPids(pid: number): number[] {
    const childPids: Set<number> = new Set<number>();

    try {
      const taskDirectory: string = `/proc/${pid}/task`;
      const taskIds: string[] = fs.readdirSync(taskDirectory);

      for (const taskId of taskIds) {
        // eslint-disable-next-line wrap-regex -- Parentheses conflict with Prettier.
        if (!/^\d+$/.test(taskId)) {
          continue;
        }

        try {
          const contents: string = fs.readFileSync(
            path.join(taskDirectory, taskId, "children"),
            "utf8",
          );
          for (const value of contents.trim().split(/\s+/)) {
            const childPid: number = Number(value);
            if (Number.isSafeInteger(childPid) && childPid > 1) {
              childPids.add(childPid);
            }
          }
        } catch {
          // A thread or child can exit while /proc is being traversed.
        }
      }
    } catch {
      // The process can exit before its task directory is read.
    }

    return [...childPids];
  }

  private readLinuxProcessRecord(pid: number): ProcessRecord | null {
    try {
      const stat: string = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const commandEndIndex: number = stat.lastIndexOf(")");
      if (commandEndIndex < 0) {
        return null;
      }

      const fields: string[] = stat
        .substring(commandEndIndex + 1)
        .trim()
        .split(/\s+/);
      const parentPid: number = Number(fields[1]);
      const processGroupId: number = Number(fields[2]);
      if (
        !Number.isSafeInteger(parentPid) ||
        parentPid < 0 ||
        !Number.isSafeInteger(processGroupId) ||
        processGroupId < 1
      ) {
        return null;
      }

      return {
        pid,
        parentPid,
        processGroupId,
        rssBytes: this.readLinuxRssBytes(pid),
      };
    } catch {
      return null;
    }
  }

  private readLinuxRssBytes(pid: number): number | null {
    try {
      const status: string = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const match: RegExpMatchArray | null = status.match(
        /^VmRSS:\s+(\d+)\s+kB\s*$/m,
      );
      if (!match) {
        return null;
      }

      const rssInKilobytes: number = Number(match[1]);
      const rssBytes: number = rssInKilobytes * 1024;
      return Number.isSafeInteger(rssBytes) ? rssBytes : null;
    } catch {
      // A process can exit between reading its stat and status files.
      return null;
    }
  }

  private getPortableProcessTreeSnapshot(
    seedPids: ReadonlySet<number>,
  ): ProcessTreeSnapshot {
    const allRecords: Map<number, ProcessRecord> = new Map<
      number,
      ProcessRecord
    >();

    try {
      const processTable: string = execFileSync(
        "ps",
        ["-axo", "pid=,ppid=,pgid=,rss="],
        {
          encoding: "utf8",
          maxBuffer: PROCESS_TABLE_MAX_BYTES,
          timeout: PROCESS_TABLE_TIMEOUT_IN_MS,
        },
      );

      for (const line of processTable.split("\n")) {
        const match: RegExpMatchArray | null = line.match(
          /^\s*(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?\s*$/,
        );
        if (!match) {
          continue;
        }

        const pid: number = Number(match[1]);
        const parentPid: number = Number(match[2]);
        const processGroupId: number = Number(match[3]);
        const rssInKilobytes: number | null = match[4]
          ? Number(match[4])
          : null;
        const rssBytes: number | null =
          rssInKilobytes === null ? null : rssInKilobytes * 1024;
        if (
          !Number.isSafeInteger(pid) ||
          pid < 1 ||
          !Number.isSafeInteger(parentPid) ||
          parentPid < 0 ||
          !Number.isSafeInteger(processGroupId) ||
          processGroupId < 1 ||
          (rssBytes !== null && !Number.isSafeInteger(rssBytes))
        ) {
          continue;
        }

        allRecords.set(pid, {
          pid,
          parentPid,
          processGroupId,
          rssBytes,
        });
      }
    } catch {
      return {
        records: new Map<number, ProcessRecord>(),
        callerProcessGroupId: null,
      };
    }

    const childrenByParentPid: Map<number, number[]> = new Map<
      number,
      number[]
    >();
    for (const record of allRecords.values()) {
      const children: number[] =
        childrenByParentPid.get(record.parentPid) || [];
      children.push(record.pid);
      childrenByParentPid.set(record.parentPid, children);
    }

    const records: Map<number, ProcessRecord> = new Map<
      number,
      ProcessRecord
    >();
    const pendingPids: number[] = [...seedPids];
    const visitedPids: Set<number> = new Set<number>();
    while (pendingPids.length > 0) {
      const pid: number | undefined = pendingPids.shift();
      if (!pid || visitedPids.has(pid)) {
        continue;
      }
      visitedPids.add(pid);

      const record: ProcessRecord | undefined = allRecords.get(pid);
      if (!record) {
        continue;
      }
      records.set(pid, record);
      pendingPids.push(...(childrenByParentPid.get(pid) || []));
    }

    return {
      records,
      callerProcessGroupId: allRecords.get(process.pid)?.processGroupId ?? null,
    };
  }

  private startProcessTreeRssWatchdog(data: {
    readonly rootPid: number;
    readonly trackedTree: TrackedProcessTree;
    readonly onLimitExceeded: (observedRssBytes: number) => void;
  }): () => void {
    let isStopped: boolean = false;
    let pollHandle: ReturnType<typeof setTimeout> | undefined;

    const poll: () => void = (): void => {
      if (isStopped) {
        return;
      }

      let observedRssBytes: number | null = null;
      try {
        observedRssBytes = this.getProcessTreeRssBytes(
          data.rootPid,
          data.trackedTree,
        );
      } catch {
        /*
         * Process enumeration is best effort. A later poll can recover after a
         * transient /proc or process-table read failure.
         */
      }
      if (
        observedRssBytes !== null &&
        observedRssBytes > this.maxProcessTreeRssBytes
      ) {
        isStopped = true;
        data.onLimitExceeded(observedRssBytes);
        return;
      }

      pollHandle = global.setTimeout(poll, this.rssPollIntervalInMs);
      pollHandle.unref?.();
    };

    poll();

    return (): void => {
      if (isStopped) {
        return;
      }

      isStopped = true;
      if (pollHandle) {
        global.clearTimeout(pollHandle);
      }
    };
  }

  private getProcessTreeRssBytes(
    rootPid: number,
    trackedTree: TrackedProcessTree,
  ): number | null {
    const snapshot: ProcessTreeSnapshot = this.getProcessTreeSnapshot(
      new Set<number>([rootPid, ...trackedTree.descendantPids]),
    );
    this.mergeProcessTreeSnapshot(rootPid, trackedTree, snapshot);
    let observedRssBytes: number = 0;
    let hasRssMeasurement: boolean = false;

    for (const record of snapshot.records.values()) {
      if (record.rssBytes === null) {
        continue;
      }

      hasRssMeasurement = true;
      observedRssBytes += record.rssBytes;
      if (!Number.isSafeInteger(observedRssBytes)) {
        return Number.MAX_SAFE_INTEGER;
      }
    }

    return hasRssMeasurement ? observedRssBytes : null;
  }

  private startRunDirectoryDiskWatchdog(data: {
    readonly runDirectory: string;
    readonly deadlineAtInMs: number;
    readonly onLimitExceeded: (observedDiskBytes: number) => void;
    readonly onEntryLimitExceeded: (observedDiskEntries: number) => void;
    readonly onMeasurementError: () => void;
  }): () => Promise<void> {
    let isStopped: boolean = false;
    let pollHandle: ReturnType<typeof setTimeout> | undefined;
    let inFlightPoll: Promise<void> | null = null;

    const poll: () => Promise<void> = async (): Promise<void> => {
      if (isStopped || this.getRemainingTimeInMs(data.deadlineAtInMs) <= 0) {
        return;
      }

      let observedDiskUsage: RunDirectoryDiskUsage | null;
      try {
        observedDiskUsage = await this.getRunDirectoryDiskUsage({
          runDirectory: data.runDirectory,
          stopAfterBytes: this.maxDiskBytes,
          stopAfterEntries: this.maxDiskEntries,
          shouldStop: (): boolean => {
            return isStopped;
          },
        });
      } catch {
        if (!isStopped) {
          isStopped = true;
          data.onMeasurementError();
        }
        return;
      }

      if (isStopped || observedDiskUsage === null) {
        return;
      }

      if (observedDiskUsage.entries > this.maxDiskEntries) {
        isStopped = true;
        data.onEntryLimitExceeded(observedDiskUsage.entries);
        return;
      }

      if (observedDiskUsage.bytes > this.maxDiskBytes) {
        isStopped = true;
        data.onLimitExceeded(observedDiskUsage.bytes);
        return;
      }

      const remainingTimeInMs: number = this.getRemainingTimeInMs(
        data.deadlineAtInMs,
      );
      if (remainingTimeInMs <= 0) {
        return;
      }

      pollHandle = global.setTimeout(
        runPoll,
        Math.min(this.diskPollIntervalInMs, remainingTimeInMs),
      );
      pollHandle.unref?.();
    };

    const runPoll: () => void = (): void => {
      if (isStopped) {
        return;
      }

      const currentPoll: Promise<void> = poll();
      inFlightPoll = currentPoll;
      void currentPoll.then(
        (): void => {
          if (inFlightPoll === currentPoll) {
            inFlightPoll = null;
          }
        },
        (): void => {
          if (inFlightPoll === currentPoll) {
            inFlightPoll = null;
          }
        },
      );
    };

    runPoll();

    return async (): Promise<void> => {
      isStopped = true;
      if (pollHandle) {
        global.clearTimeout(pollHandle);
      }

      const currentPoll: Promise<void> | null = inFlightPoll;
      if (currentPoll) {
        await currentPoll.catch((): void => {});
      }
    };
  }

  private async getRunDirectoryDiskUsage(data: {
    readonly runDirectory: string;
    readonly stopAfterBytes: number;
    readonly stopAfterEntries: number;
    readonly shouldStop: () => boolean;
  }): Promise<RunDirectoryDiskUsage | null> {
    let rootStats: fs.Stats;
    try {
      rootStats = await fs.promises.lstat(data.runDirectory);
    } catch {
      throw new Error("Synthetic runtime directory is unavailable.");
    }

    if (!rootStats.isDirectory()) {
      throw new Error("Synthetic runtime directory is not a directory.");
    }

    let observedDiskBytes: number = this.getStatDiskUsageBytes(rootStats);
    if (observedDiskBytes > data.stopAfterBytes) {
      return { bytes: observedDiskBytes, entries: 0 };
    }

    let observedDiskEntries: number = 0;
    const pendingDirectories: string[] = [data.runDirectory];
    while (pendingDirectories.length > 0) {
      if (data.shouldStop()) {
        return null;
      }

      const currentDirectory: string | undefined = pendingDirectories.pop();
      if (!currentDirectory) {
        continue;
      }

      let currentStats: fs.Stats;
      try {
        currentStats = await fs.promises.lstat(currentDirectory);
      } catch (error: unknown) {
        if (
          currentDirectory !== data.runDirectory &&
          this.isMissingFileSystemPath(error)
        ) {
          continue;
        }
        throw error;
      }
      if (!currentStats.isDirectory()) {
        if (currentDirectory === data.runDirectory) {
          throw new Error("Synthetic runtime directory is not a directory.");
        }
        continue;
      }

      let directory: fs.Dir;
      try {
        directory = await fs.promises.opendir(currentDirectory);
      } catch (error: unknown) {
        if (
          currentDirectory !== data.runDirectory &&
          this.isMissingFileSystemPath(error)
        ) {
          continue;
        }
        throw error;
      }

      for await (const entry of directory) {
        if (data.shouldStop()) {
          return null;
        }

        observedDiskEntries++;
        if (observedDiskEntries > data.stopAfterEntries) {
          return {
            bytes: observedDiskBytes,
            entries: observedDiskEntries,
          };
        }

        const entryPath: string = path.join(currentDirectory, entry.name);
        let entryStats: fs.Stats;
        try {
          entryStats = await fs.promises.lstat(entryPath);
        } catch (error: unknown) {
          if (this.isMissingFileSystemPath(error)) {
            continue;
          }
          throw error;
        }

        observedDiskBytes = this.addDiskUsageBytes(
          observedDiskBytes,
          this.getStatDiskUsageBytes(entryStats),
        );
        if (observedDiskBytes > data.stopAfterBytes) {
          return {
            bytes: observedDiskBytes,
            entries: observedDiskEntries,
          };
        }

        if (entryStats.isDirectory()) {
          pendingDirectories.push(entryPath);
        }
      }
    }

    return {
      bytes: observedDiskBytes,
      entries: observedDiskEntries,
    };
  }

  private getStatDiskUsageBytes(stats: fs.Stats): number {
    const logicalBytes: number =
      Number.isSafeInteger(stats.size) && stats.size >= 0 ? stats.size : 0;
    const allocatedBytes: number =
      Number.isSafeInteger(stats.blocks) &&
      stats.blocks >= 0 &&
      Number.isSafeInteger(stats.blocks * FILE_SYSTEM_BLOCK_SIZE_IN_BYTES)
        ? stats.blocks * FILE_SYSTEM_BLOCK_SIZE_IN_BYTES
        : 0;
    return Math.max(logicalBytes, allocatedBytes);
  }

  private addDiskUsageBytes(current: number, addition: number): number {
    if (addition > Number.MAX_SAFE_INTEGER - current) {
      return Number.MAX_SAFE_INTEGER;
    }
    return current + addition;
  }

  private isMissingFileSystemPath(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR"),
    );
  }

  private getRemainingTimeInMs(deadlineAtInMs: number): number {
    return Math.max(0, deadlineAtInMs - Date.now());
  }

  private throwIfExecutionDeadlineExpired(data: {
    readonly deadlineAtInMs: number;
    readonly timeoutInMs: number;
  }): void {
    if (this.getRemainingTimeInMs(data.deadlineAtInMs) > 0) {
      return;
    }

    throw this.createExecutionTimeoutError(data.timeoutInMs);
  }

  private createExecutionTimeoutError(timeoutInMs: number): Error {
    return new Error(`Synthetic worker timed out after ${timeoutInMs}ms.`);
  }

  private createRunnerError(data: {
    message: string;
    stdout: BoundedOutput;
    stderr: BoundedOutput;
  }): SyntheticProcessRunnerError {
    return new SyntheticProcessRunnerError(data);
  }

  private assertPositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Synthetic runtime ${label} must be a positive integer.`);
    }
  }

  private assertExecutionTimeout(timeoutInMs: number): void {
    if (
      !Number.isSafeInteger(timeoutInMs) ||
      timeoutInMs < 1 ||
      timeoutInMs > MAXIMUM_EXECUTION_TIMEOUT_IN_MS
    ) {
      throw new Error(
        `Synthetic runtime execution timeout must be an integer between 1 and ${MAXIMUM_EXECUTION_TIMEOUT_IN_MS}.`,
      );
    }
  }

  private assertTimerInterval(value: number, label: string): void {
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAXIMUM_EXECUTION_TIMEOUT_IN_MS
    ) {
      throw new Error(
        `Synthetic runtime ${label} must be an integer between 1 and ${MAXIMUM_EXECUTION_TIMEOUT_IN_MS}.`,
      );
    }
  }

  private assertNonNegativeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `Synthetic runtime ${label} must be a non-negative integer.`,
      );
    }
  }

  private assertSandboxIdentity(value: number, label: string): void {
    if (
      !Number.isInteger(value) ||
      value < MINIMUM_SANDBOX_IDENTITY ||
      value > MAXIMUM_SANDBOX_IDENTITY
    ) {
      throw new Error(
        `Synthetic runtime ${label} must be an integer between ${MINIMUM_SANDBOX_IDENTITY} and ${MAXIMUM_SANDBOX_IDENTITY}.`,
      );
    }
  }
}
