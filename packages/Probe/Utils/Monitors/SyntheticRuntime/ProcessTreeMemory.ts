import { execFile } from "child_process";
import fs from "fs";

/*
 * How much memory a synthetic check's process tree holds, for the watchdog
 * that stops a check at PROBE_SYNTHETIC_MONITOR_MAX_PROCESS_TREE_RSS_BYTES.
 *
 * Summing each process's VmRSS is not that number. Chromium runs a check as a
 * dozen processes -- browser, GPU, zygotes, network and storage services, a
 * renderer per site plus a spare -- and every one of them maps the same browser
 * binary, so its pages are counted once per process: about 100 MB more for
 * every renderer. Chromium's shared-memory buffers (screenshots, compositor
 * frames, canvases) are mapped by a renderer and the GPU process and counted
 * twice. On an ordinary Desktop login check the sum reads roughly twice what
 * the tree holds, which is how checks using 0.8-0.9 GB failed a 1.5 GiB limit.
 *
 * The proportional set size (PSS) divides every shared page among the
 * processes mapping it, so the tree's PSS adds up to what it actually holds:
 * the browser's code once, shared buffers once, and everything a page can
 * grow -- JavaScript heaps, in-memory web storage, canvases -- in full. It is
 * the number the limit means.
 *
 * PSS is read from /proc/<pid>/smaps_rollup, which is more expensive to read
 * than /proc/<pid>/status and which a root supervisor without CAP_SYS_PTRACE
 * cannot open for a check running under its own uid. So the watchdog works in
 * two steps. It sums VmRSS first, from /proc/<pid>/status, which anyone can
 * read. A process's PSS never exceeds its RSS, so a tree under the limit by
 * that sum is under it, and nothing else is read. Only a tree over it is
 * measured again by PSS, through Native/synthetic-process-memory.c, and is
 * stopped only if its PSS is over the limit too.
 *
 * A process whose PSS cannot be read -- it made itself non-dumpable, or the
 * image has no helper -- counts at its VmRSS as read at that moment, as every
 * process did before; one that has exited since the first step holds nothing
 * and counts at nothing. A check cannot lower its total by hiding from the
 * second step, only fall back to the first. A reading that failed as a whole
 * -- the helper timed out or exited, or answered for fewer processes than it
 * was asked about -- is not a reading at all; see isComplete.
 */

export const PROCESS_MEMORY_HELPER_PATH: string =
  "/usr/lib/oneuptime-probe/synthetic-process-memory";

/*
 * Kept below the helper's own MAX_PIDS. A larger tree than this is not
 * measured by PSS at all and counts at its VmRSS.
 */
export const PROCESS_MEMORY_HELPER_MAX_PIDS: number = 4096;

/*
 * smaps_rollup walks a process's page tables, so reading a tree takes about
 * 25 ms for an ordinary check and a few hundred for one holding gigabytes --
 * seconds, on a probe whose CPUs are busy. A reading slower than this is
 * abandoned and reported incomplete.
 */
export const PROCESS_MEMORY_READ_TIMEOUT_IN_MS: number = 5_000;

// "<pid> <kB>" or "<pid> -" for each of up to 4096 pids.
const PROCESS_MEMORY_HELPER_MAX_OUTPUT_BYTES: number = 256 * 1024;

const KILOBYTE: number = 1024;

export interface ProcessMemoryIdentity {
  readonly uid: number;
  readonly gid: number;
}

export type ResidentBytesReader = (pid: number) => number | null;

export interface ProportionalMemoryReading {
  /*
   * The tree's total: each process at its PSS where that was read, at its
   * current VmRSS where it was not, and at nothing once it has exited.
   */
  readonly observedBytes: number;
  readonly processCount: number;
  // Processes counted at their VmRSS because their PSS could not be read.
  readonly residentFallbackCount: number;
  /*
   * False when the reading failed as a whole: the helper timed out, exited,
   * could not start or answered for fewer processes than it was asked about,
   * or the direct reads ran out of time. Every process whose PSS is missing
   * then counts at its VmRSS in observedBytes, but the watchdog should read
   * again rather than judge the tree by it.
   */
  readonly isComplete: boolean;
  // Why the reading is incomplete, for the probe's log; null when complete.
  readonly failure: string | null;
}

interface ProportionalBytesRead {
  readonly proportionalBytesByPid: Map<number, number>;
  readonly failure: string | null;
}

export default class ProcessTreeMemory {
  /**
   * What to warn the operator about at startup, or null. A root supervisor on
   * Linux gives every check its own uid and so can read a check's PSS only
   * through the helper; without it, checks are held to their processes'
   * summed RSS, which fails ordinary Chromium checks for memory they never
   * held.
   */
  public static getStartupWarning(
    data: {
      readonly platform?: NodeJS.Platform | undefined;
      readonly uid?: number | null | undefined;
      readonly helperPath?: string | undefined;
    } = {},
  ): string | null {
    const platform: NodeJS.Platform = data.platform ?? process.platform;
    const uid: number | null =
      data.uid !== undefined
        ? data.uid
        : typeof process.getuid === "function"
          ? process.getuid()
          : null;
    const helperPath: string = data.helperPath ?? PROCESS_MEMORY_HELPER_PATH;

    if (platform !== "linux" || uid !== 0 || fs.existsSync(helperPath)) {
      return null;
    }

    return `Synthetic monitor memory helper ${helperPath} is missing, so synthetic checks are held to their browser processes' summed RSS, which counts the browser's shared pages once per process and can stop ordinary checks well below the memory limit. Use the official probe image, which builds it from Utils/Monitors/SyntheticRuntime/Native/synthetic-process-memory.c.`;
  }

  /**
   * A process's VmRSS in bytes, read from /proc now, or null if it holds no
   * memory this can see: it has exited, or it is a zombie.
   *
   * A process whose main thread has exited while its other threads run on
   * reports no memory at all in /proc/<pid>/status: the kernel reaches the
   * address space through that thread. Every remaining thread shares it and
   * reports it in its own status, so a process cannot drop out of the total
   * by ending its main thread.
   */
  public static readResidentBytes(pid: number): number | null {
    const residentBytes: number | null = this.readStatusResidentBytes(
      `/proc/${pid}/status`,
    );
    if (residentBytes !== null) {
      return residentBytes;
    }

    try {
      for (const taskId of fs.readdirSync(`/proc/${pid}/task`)) {
        // eslint-disable-next-line wrap-regex -- Parentheses conflict with Prettier.
        if (!/^\d+$/.test(taskId) || taskId === String(pid)) {
          continue;
        }

        const threadResidentBytes: number | null = this.readStatusResidentBytes(
          `/proc/${pid}/task/${taskId}/status`,
        );
        if (threadResidentBytes !== null) {
          return threadResidentBytes;
        }
      }
    } catch {
      // The process exited while its threads were being listed.
    }

    return null;
  }

  /**
   * VmRSS, in bytes, from the contents of a /proc/<pid>/status file, or null
   * if it has none: a kernel thread, a zombie, or a process whose main thread
   * has exited while its other threads run on.
   *
   * The kernel escapes the one line a process controls (Name), so an anchored
   * match cannot be fooled into reading a line the process wrote.
   */
  public static parseStatusResidentBytes(status: string): number | null {
    return this.parseKilobyteLine(status, /^VmRSS:\s+(\d+)\s+kB\s*$/m);
  }

  /**
   * PSS, in bytes, from the contents of a /proc/<pid>/smaps_rollup file, or
   * null if it has none. Only the "Pss:" line; not Pss_Anon, Pss_File,
   * Pss_Dirty or Pss_Shmem.
   */
  public static parseSmapsRollupProportionalBytes(
    smapsRollup: string,
  ): number | null {
    return this.parseKilobyteLine(smapsRollup, /^Pss:\s+(\d+)\s+kB\s*$/m);
  }

  /**
   * The PSS, in bytes, of each process the helper could read, keyed by pid,
   * and whether the helper answered for every process it was asked about.
   *
   * The helper prints exactly one line per pid, "<pid> <kB>" or "<pid> -".
   * A line for a pid that was not asked for, a second line for the same pid,
   * or a line in any other shape is ignored and that pid is left out -- to be
   * counted at its VmRSS -- and the answer is incomplete.
   */
  public static parseHelperOutput(data: {
    readonly output: string;
    readonly requestedPids: ReadonlySet<number>;
  }): { proportionalBytesByPid: Map<number, number>; isComplete: boolean } {
    const proportionalBytesByPid: Map<number, number> = new Map<
      number,
      number
    >();
    const answeredPids: Set<number> = new Set<number>();
    let isComplete: boolean = true;

    const lines: string[] = data.output.split("\n");
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }

    for (const line of lines) {
      const match: RegExpMatchArray | null = line.match(
        /^([1-9]\d{0,9}) (?:(\d{1,15})|-)$/,
      );
      const pid: number = match ? Number(match[1]) : NaN;
      if (!match || !data.requestedPids.has(pid)) {
        isComplete = false;
        continue;
      }

      if (answeredPids.has(pid)) {
        proportionalBytesByPid.delete(pid);
        isComplete = false;
        continue;
      }
      answeredPids.add(pid);

      if (match[2] === undefined) {
        continue;
      }

      const proportionalBytes: number = Number(match[2]) * KILOBYTE;
      if (Number.isSafeInteger(proportionalBytes)) {
        proportionalBytesByPid.set(pid, proportionalBytes);
      }
    }

    return {
      proportionalBytesByPid,
      isComplete: isComplete && answeredPids.size === data.requestedPids.size,
    };
  }

  /**
   * The tree's total: each process at its PSS where that was read, at its
   * VmRSS as `readResidentBytes` reads it now where it was not, and at
   * nothing if that finds it gone. Saturates rather than overflowing.
   */
  public static sumProportionalBytes(data: {
    readonly pids: ReadonlyArray<number>;
    readonly proportionalBytesByPid: ReadonlyMap<number, number>;
    readonly readResidentBytes: ResidentBytesReader;
  }): { observedBytes: number; residentFallbackCount: number } {
    let observedBytes: number = 0;
    let residentFallbackCount: number = 0;

    for (const pid of data.pids) {
      const proportionalBytes: number | undefined =
        data.proportionalBytesByPid.get(pid);
      if (proportionalBytes !== undefined) {
        observedBytes += proportionalBytes;
      } else {
        const residentBytes: number | null = data.readResidentBytes(pid);
        if (residentBytes !== null) {
          residentFallbackCount++;
          observedBytes += residentBytes;
        }
      }

      if (!Number.isSafeInteger(observedBytes)) {
        return {
          observedBytes: Number.MAX_SAFE_INTEGER,
          residentFallbackCount,
        };
      }
    }

    return { observedBytes, residentFallbackCount };
  }

  /**
   * Measures the tree by PSS. Never rejects.
   *
   * `identity` is the uid and gid the check runs under, when the supervisor
   * gave it one. Its PSS is then read through the helper, because the
   * supervisor cannot open the check's smaps_rollup files itself. Without one
   * the check runs as the supervisor, which reads them directly.
   */
  public static async measureProportionalBytes(data: {
    readonly pids: ReadonlyArray<number>;
    readonly identity: ProcessMemoryIdentity | null;
    readonly signal?: AbortSignal | undefined;
    readonly helperPath?: string | undefined;
    readonly timeoutInMs?: number | undefined;
    readonly readResidentBytes?: ResidentBytesReader | undefined;
  }): Promise<ProportionalMemoryReading> {
    const pids: number[] = [...new Set<number>(data.pids)];

    let read: ProportionalBytesRead;
    try {
      read = await this.readProportionalBytes({ ...data, pids });
    } catch (error: unknown) {
      read = {
        proportionalBytesByPid: new Map<number, number>(),
        failure: this.describeFailure(
          error,
          data.timeoutInMs ?? PROCESS_MEMORY_READ_TIMEOUT_IN_MS,
        ),
      };
    }

    const sum: { observedBytes: number; residentFallbackCount: number } =
      this.sumProportionalBytes({
        pids,
        proportionalBytesByPid: read.proportionalBytesByPid,
        readResidentBytes:
          data.readResidentBytes ??
          ((pid: number): number | null => {
            return this.readResidentBytes(pid);
          }),
      });

    return {
      observedBytes: sum.observedBytes,
      processCount: pids.length,
      residentFallbackCount: sum.residentFallbackCount,
      isComplete: read.failure === null,
      failure: read.failure,
    };
  }

  private static async readProportionalBytes(data: {
    readonly pids: ReadonlyArray<number>;
    readonly identity: ProcessMemoryIdentity | null;
    readonly signal?: AbortSignal | undefined;
    readonly helperPath?: string | undefined;
    readonly timeoutInMs?: number | undefined;
  }): Promise<ProportionalBytesRead> {
    const timeoutInMs: number =
      data.timeoutInMs ?? PROCESS_MEMORY_READ_TIMEOUT_IN_MS;

    if (data.pids.length === 0) {
      return {
        proportionalBytesByPid: new Map<number, number>(),
        failure: null,
      };
    }

    if (data.signal?.aborted) {
      return {
        proportionalBytesByPid: new Map<number, number>(),
        failure: "the reading was abandoned",
      };
    }

    if (data.identity) {
      return this.readThroughHelper({
        pids: data.pids,
        identity: data.identity,
        signal: data.signal,
        helperPath: data.helperPath ?? PROCESS_MEMORY_HELPER_PATH,
        timeoutInMs,
      });
    }

    return this.readDirectly({
      pids: data.pids,
      signal: data.signal,
      timeoutInMs,
    });
  }

  /*
   * A missing helper, or a tree too large for it, is not a failed reading:
   * nothing will change by trying again. Every process then counts at its
   * VmRSS, as before the helper existed.
   */
  private static async readThroughHelper(data: {
    readonly pids: ReadonlyArray<number>;
    readonly identity: ProcessMemoryIdentity;
    readonly signal?: AbortSignal | undefined;
    readonly helperPath: string;
    readonly timeoutInMs: number;
  }): Promise<ProportionalBytesRead> {
    if (
      data.pids.length > PROCESS_MEMORY_HELPER_MAX_PIDS ||
      !fs.existsSync(data.helperPath)
    ) {
      return {
        proportionalBytesByPid: new Map<number, number>(),
        failure: null,
      };
    }

    const output: string = await new Promise<string>(
      (
        resolve: (output: string) => void,
        reject: (error: Error) => void,
      ): void => {
        execFile(
          data.helperPath,
          [
            String(data.identity.uid),
            String(data.identity.gid),
            ...data.pids.map((pid: number): string => {
              return String(pid);
            }),
          ],
          {
            encoding: "utf8",
            env: {},
            maxBuffer: PROCESS_MEMORY_HELPER_MAX_OUTPUT_BYTES,
            timeout: data.timeoutInMs,
            killSignal: "SIGKILL",
            ...(data.signal ? { signal: data.signal } : {}),
          },
          (error: Error | null, stdout: string): void => {
            if (error) {
              reject(error);
              return;
            }
            resolve(stdout);
          },
        );
      },
    );

    /*
     * Also catches the helper that finished but whose output never arrived:
     * when the probe's event loop stalls past the timeout, Node can kill the
     * already-exited helper and report success with nothing read.
     */
    const parsed: {
      proportionalBytesByPid: Map<number, number>;
      isComplete: boolean;
    } = this.parseHelperOutput({
      output,
      requestedPids: new Set<number>(data.pids),
    });

    return {
      proportionalBytesByPid: parsed.proportionalBytesByPid,
      failure: parsed.isComplete
        ? null
        : `the helper answered for fewer than the ${data.pids.length} processes it was asked about`,
    };
  }

  /*
   * One at a time: each read walks a process's page tables in a libuv
   * threadpool thread, and the probe's DNS lookups and file I/O wait for the
   * same four threads.
   */
  private static async readDirectly(data: {
    readonly pids: ReadonlyArray<number>;
    readonly signal?: AbortSignal | undefined;
    readonly timeoutInMs: number;
  }): Promise<ProportionalBytesRead> {
    const proportionalBytesByPid: Map<number, number> = new Map<
      number,
      number
    >();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hasTimedOut: boolean = false;

    const readAll: Promise<void> = (async (): Promise<void> => {
      for (const pid of data.pids) {
        if (hasTimedOut || data.signal?.aborted) {
          return;
        }

        try {
          const smapsRollup: string = await fs.promises.readFile(
            `/proc/${pid}/smaps_rollup`,
            "utf8",
          );
          const proportionalBytes: number | null =
            this.parseSmapsRollupProportionalBytes(smapsRollup);
          if (proportionalBytes !== null && !hasTimedOut) {
            proportionalBytesByPid.set(pid, proportionalBytes);
          }
        } catch {
          // Exited, or not ours to read: it counts at its VmRSS.
        }
      }
    })();

    try {
      await Promise.race([
        readAll,
        new Promise<void>((resolve: () => void): void => {
          timer = setTimeout(() => {
            hasTimedOut = true;
            resolve();
          }, data.timeoutInMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    if (hasTimedOut) {
      return {
        proportionalBytesByPid: new Map<number, number>(),
        failure: `reading the processes' smaps_rollup took longer than ${data.timeoutInMs} ms`,
      };
    }

    if (data.signal?.aborted) {
      return {
        proportionalBytesByPid: new Map<number, number>(),
        failure: "the reading was abandoned",
      };
    }

    return { proportionalBytesByPid, failure: null };
  }

  private static describeFailure(error: unknown, timeoutInMs: number): string {
    if (!(error instanceof Error)) {
      return "the helper failed";
    }

    const details: Record<string, unknown> = error as unknown as Record<
      string,
      unknown
    >;
    if (details["name"] === "AbortError") {
      return "the reading was abandoned";
    }
    if (details["killed"] === true) {
      return `the helper did not finish within ${timeoutInMs} ms`;
    }
    if (typeof details["code"] === "number") {
      return `the helper exited with code ${details["code"]}`;
    }
    if (typeof details["code"] === "string") {
      return `the helper failed: ${details["code"]}`;
    }
    return `the helper failed: ${error.message}`;
  }

  private static readStatusResidentBytes(statusPath: string): number | null {
    try {
      return this.parseStatusResidentBytes(fs.readFileSync(statusPath, "utf8"));
    } catch {
      // The process exited, or has not got that far.
      return null;
    }
  }

  private static parseKilobyteLine(
    contents: string,
    pattern: RegExp,
  ): number | null {
    const match: RegExpMatchArray | null = contents.match(pattern);
    if (!match) {
      return null;
    }

    const bytes: number = Number(match[1]) * KILOBYTE;
    return Number.isSafeInteger(bytes) ? bytes : null;
  }
}
