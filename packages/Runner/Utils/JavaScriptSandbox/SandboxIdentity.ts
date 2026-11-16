import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import logger from "Common/Server/Utils/Logger";

/*
 * WHO A GLOBAL RUNNER'S JAVASCRIPT STEP RUNS AS.
 *
 * Each step runs in a process of its own (SandboxProcess). Where the
 * container lets it, that process is also a user of its own: the Runner's
 * image installs the javascript-sandbox launcher (Native/javascript-sandbox.c)
 * setuid root, runnable by the Runner's group alone, and the launcher
 * switches the step's process to a user number from SANDBOX_IDENTITY_MIN to
 * SANDBOX_IDENTITY_MAX - one that owns nothing, is in no group, and is no
 * other step's while the step runs. The kernel then keeps the step's process
 * from the Runner's: it may not read the Runner's environment
 * (/proc/<pid>/environ) or memory, signal it, or read its private files (a
 * code fix's workspace, its Git credentials), and it may not read another
 * step's.
 *
 * Where the container forbids switching users (no-new-privileges, or
 * Kubernetes' allowPrivilegeEscalation: false, or SETUID and SETGID dropped),
 * or the launcher is not there (a Runner run from its sources), the step
 * still runs in a process of its own, with none of the Runner's environment
 * and under Node's permission model, but as the Runner's own user. The
 * Runner says so once, with what to change.
 */

// The same path as the Dockerfile's, and the same range as the launcher's.
export const SANDBOX_LAUNCHER_PATH: string =
  "/usr/lib/oneuptime-runner/javascript-sandbox";

export const SANDBOX_IDENTITY_MIN: number = 61000;
export const SANDBOX_IDENTITY_MAX: number = 64999;

// The launcher's exit codes (Native/javascript-sandbox.c).
export const LAUNCHER_EXIT_USAGE: number = 64;
export const LAUNCHER_EXIT_IDENTITY_OUT_OF_RANGE: number = 65;
export const LAUNCHER_EXIT_REFUSED_CALLER: number = 66;
export const LAUNCHER_EXIT_INTERNAL: number = 70;
export const LAUNCHER_EXIT_NO_PRIVILEGE: number = 71;

const LAUNCHER_CALL_TIMEOUT_MS: number = 10_000;

// A /proc entry that is a process.
const PROCESS_ID_PATTERN: RegExp = /^\d+$/;

export enum SandboxIsolation {
  // A process of its own, as a user of its own.
  OwnUser = "own-user",
  // A process of its own, as the Runner's user.
  OwnProcess = "own-process",
}

export interface SandboxIsolationDecision {
  isolation: SandboxIsolation;
  // Why a step does not get a user of its own; null when it does.
  reason: string | null;
}

export const NO_PRIVILEGE_REASON: string =
  "the container does not let the Runner switch users (no-new-privileges is set, Kubernetes' allowPrivilegeEscalation is false, or the SETUID and SETGID capabilities are dropped)";

export const LAUNCHER_MISSING_REASON: string =
  "the JavaScript sandbox launcher is not installed (a Runner run from its sources rather than its image)";

export const LAUNCHER_NOT_RUNNABLE_REASON: string =
  "the Runner's user may not run the JavaScript sandbox launcher (the Runner runs as a user outside the image's node group)";

/*
 * What a Runner whose steps cannot get a user of their own is told to
 * change, after the reason.
 */
export const OWN_USER_REMEDY: string =
  "To give each step a user of its own, run the Runner's image as its own user (node) and let it switch users: keep allowPrivilegeEscalation and no-new-privileges at their defaults and the SETUID and SETGID capabilities in the container (the Helm chart's global Runner does both).";

export interface LauncherCallResult {
  // The exit code, or null when the launcher could not be run or was killed.
  exitCode: number | null;
  // The spawn error's code (ENOENT, EACCES), when it could not be run.
  errorCode: string | null;
}

export type LauncherCaller = (
  launcherPath: string,
  args: Array<string>,
) => Promise<LauncherCallResult>;

export const callLauncher: LauncherCaller = (
  launcherPath: string,
  args: Array<string>,
): Promise<LauncherCallResult> => {
  return new Promise<LauncherCallResult>(
    (resolve: (result: LauncherCallResult) => void) => {
      execFile(
        launcherPath,
        args,
        {
          env: {},
          cwd: "/",
          timeout: LAUNCHER_CALL_TIMEOUT_MS,
          killSignal: "SIGKILL",
          maxBuffer: 64 * 1024,
        },
        (error: (Error & { code?: unknown; signal?: unknown }) | null) => {
          if (!error) {
            resolve({ exitCode: 0, errorCode: null });
            return;
          }

          if (typeof error.code === "number") {
            resolve({ exitCode: error.code, errorCode: null });
            return;
          }

          resolve({
            exitCode: null,
            errorCode: typeof error.code === "string" ? error.code : null,
          });
        },
      );
    },
  );
};

/*
 * Whether a step gets a user of its own here: what the launcher's check
 * says, or why it is not asked.
 */
export async function decideSandboxIsolation(data: {
  launcherPath: string;
  call: LauncherCaller;
  platform: NodeJS.Platform;
  launcherExists: (launcherPath: string) => boolean;
}): Promise<SandboxIsolationDecision> {
  if (data.platform !== "linux" || !data.launcherExists(data.launcherPath)) {
    return {
      isolation: SandboxIsolation.OwnProcess,
      reason: LAUNCHER_MISSING_REASON,
    };
  }

  const result: LauncherCallResult = await data.call(data.launcherPath, [
    "check",
  ]);

  if (result.exitCode === 0) {
    return { isolation: SandboxIsolation.OwnUser, reason: null };
  }

  if (result.errorCode === "EACCES") {
    return {
      isolation: SandboxIsolation.OwnProcess,
      reason: LAUNCHER_NOT_RUNNABLE_REASON,
    };
  }

  if (result.errorCode === "ENOENT") {
    return {
      isolation: SandboxIsolation.OwnProcess,
      reason: LAUNCHER_MISSING_REASON,
    };
  }

  if (result.exitCode === LAUNCHER_EXIT_NO_PRIVILEGE) {
    return {
      isolation: SandboxIsolation.OwnProcess,
      reason: NO_PRIVILEGE_REASON,
    };
  }

  return {
    isolation: SandboxIsolation.OwnProcess,
    reason: `the JavaScript sandbox launcher's check failed (${
      result.exitCode === null
        ? result.errorCode || "it did not finish"
        : `exit code ${result.exitCode}`
    })`,
  };
}

/*
 * Whether any process of this user is still alive here, read from /proc
 * (every process's status is readable by every user). A zombie is dead: it
 * runs nothing and holds nothing but its entry.
 */
export type LiveProcessReader = (uid: number) => boolean;

export const hasLiveProcessOfUser: LiveProcessReader = (
  uid: number,
): boolean => {
  let entries: Array<string>;

  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!PROCESS_ID_PATTERN.test(entry)) {
      continue;
    }

    let status: string;

    try {
      status = fs.readFileSync(path.join("/proc", entry, "status"), "utf8");
    } catch {
      continue;
    }

    if (isLiveProcessOfUser(status, uid)) {
      return true;
    }
  }

  return false;
};

// From one /proc/<pid>/status: whether it is a live process of this user.
export function isLiveProcessOfUser(status: string, uid: number): boolean {
  let isOfUser: boolean = false;
  let isDead: boolean = false;

  for (const line of status.split("\n")) {
    if (line.startsWith("Uid:")) {
      isOfUser = line
        .slice("Uid:".length)
        .trim()
        .split(/\s+/)
        .some((value: string): boolean => {
          return Number(value) === uid;
        });
    }

    if (line.startsWith("State:")) {
      const state: string = line.slice("State:".length).trim().charAt(0);
      isDead = state === "Z" || state === "X";
    }
  }

  return isOfUser && !isDead;
}

/*
 * The user numbers the steps run as. Each running step holds one no other
 * step holds; when the step ends, whatever its user left running is killed
 * (the launcher's reap) before the number goes to another step, and a
 * number that still has a live process is never given out again.
 */
export class SandboxIdentityPool {
  private readonly inUse: Set<number> = new Set<number>();
  private readonly quarantined: Set<number> = new Set<number>();
  private next: number;

  public constructor(
    private readonly options: {
      launcherPath: string;
      call: LauncherCaller;
      hasLiveProcess: LiveProcessReader;
      min?: number | undefined;
      max?: number | undefined;
    },
  ) {
    this.next = this.min;
  }

  private get min(): number {
    return this.options.min ?? SANDBOX_IDENTITY_MIN;
  }

  private get max(): number {
    return this.options.max ?? SANDBOX_IDENTITY_MAX;
  }

  public get activeCount(): number {
    return this.inUse.size;
  }

  public isQuarantined(uid: number): boolean {
    return this.quarantined.has(uid);
  }

  public acquire(): number {
    const size: number = this.max - this.min + 1;

    for (let attempt: number = 0; attempt < size; attempt++) {
      const uid: number = this.next;
      this.next = uid >= this.max ? this.min : uid + 1;

      if (this.inUse.has(uid) || this.quarantined.has(uid)) {
        continue;
      }

      this.inUse.add(uid);
      return uid;
    }

    throw new Error(
      "Every JavaScript sandbox user is in use, so this step was not run. Try again once a step has finished.",
    );
  }

  /*
   * The step is over: kill what its user left behind, and give the number
   * back only once nothing of it is alive.
   */
  public async release(uid: number): Promise<void> {
    try {
      const result: LauncherCallResult = await this.options.call(
        this.options.launcherPath,
        ["reap", String(uid)],
      );

      if (result.exitCode !== 0) {
        logger.warn(
          `The JavaScript sandbox launcher could not clear user ${uid} after a step (${
            result.exitCode === null
              ? result.errorCode || "it did not finish"
              : `exit code ${result.exitCode}`
          }).`,
        );
      }

      if (this.options.hasLiveProcess(uid)) {
        this.quarantined.add(uid);
        logger.warn(
          `A JavaScript step's user (${uid}) still has a process after the step ended, so no other step will run as it.`,
        );
      }
    } finally {
      this.inUse.delete(uid);
    }
  }
}
