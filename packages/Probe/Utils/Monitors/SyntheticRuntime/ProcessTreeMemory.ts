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
 * Any process whose PSS cannot be read -- the helper is missing, failed or
 * timed out, the process made itself non-dumpable, it exited -- counts at its
 * VmRSS, as every process did before. A check cannot lower its total by hiding
 * from the second step, only fall back to the first.
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
 * 25 ms for an ordinary check and a few hundred for one holding gigabytes.
 * Anything slower than this is treated as unreadable, which counts the tree at
 * its VmRSS -- over the limit, since only such a tree is measured -- so a tree
 * cannot hold off its own measurement.
 */
export const PROCESS_MEMORY_HELPER_TIMEOUT_IN_MS: number = 2_000;

// "<pid> <kB>" or "<pid> -" for each of up to 4096 pids.
const PROCESS_MEMORY_HELPER_MAX_OUTPUT_BYTES: number = 256 * 1024;

const KILOBYTE: number = 1024;

export interface ProcessMemoryIdentity {
  readonly uid: number;
  readonly gid: number;
}

export interface ResidentProcessMemory {
  readonly pid: number;
  // VmRSS in bytes, or null when it could not be read.
  readonly residentBytes: number | null;
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
   * The PSS, in bytes, of each process the helper could read, keyed by pid.
   * A line for a pid that was not asked for, a second line for the same pid,
   * or a line in any other shape is ignored, and that pid is left out -- to be
   * counted at its VmRSS.
   */
  public static parseHelperOutput(data: {
    readonly output: string;
    readonly requestedPids: ReadonlySet<number>;
  }): Map<number, number> {
    const proportionalBytesByPid: Map<number, number> = new Map<
      number,
      number
    >();
    const seenPids: Set<number> = new Set<number>();

    for (const line of data.output.split("\n")) {
      const match: RegExpMatchArray | null = line.match(
        /^([1-9]\d{0,9}) (?:(\d{1,15})|-)$/,
      );
      if (!match) {
        continue;
      }

      const pid: number = Number(match[1]);
      if (!data.requestedPids.has(pid)) {
        continue;
      }

      if (seenPids.has(pid)) {
        proportionalBytesByPid.delete(pid);
        continue;
      }
      seenPids.add(pid);

      if (match[2] === undefined) {
        continue;
      }

      const proportionalBytes: number = Number(match[2]) * KILOBYTE;
      if (Number.isSafeInteger(proportionalBytes)) {
        proportionalBytesByPid.set(pid, proportionalBytes);
      }
    }

    return proportionalBytesByPid;
  }

  /**
   * The tree's total: each process at its PSS where that was read, and at its
   * VmRSS where it was not. A process with neither holds nothing this can see
   * and adds nothing. Saturates rather than overflowing.
   */
  public static sumProportionalBytes(data: {
    readonly processes: ReadonlyArray<ResidentProcessMemory>;
    readonly proportionalBytesByPid: ReadonlyMap<number, number>;
  }): number {
    let totalBytes: number = 0;

    for (const processMemory of data.processes) {
      totalBytes +=
        data.proportionalBytesByPid.get(processMemory.pid) ??
        processMemory.residentBytes ??
        0;

      if (!Number.isSafeInteger(totalBytes)) {
        return Number.MAX_SAFE_INTEGER;
      }
    }

    return totalBytes;
  }

  /**
   * Measures the tree by PSS, counting every process that cannot be read at
   * its VmRSS. Never rejects.
   *
   * `identity` is the uid and gid the check runs under, when the supervisor
   * gave it one. Its PSS is then read through the helper, because the
   * supervisor cannot open the check's smaps_rollup files itself. Without one
   * the check runs as the supervisor, which reads them directly.
   */
  public static async measureProportionalBytes(data: {
    readonly processes: ReadonlyArray<ResidentProcessMemory>;
    readonly identity: ProcessMemoryIdentity | null;
    readonly signal?: AbortSignal | undefined;
    readonly helperPath?: string | undefined;
  }): Promise<number> {
    let proportionalBytesByPid: Map<number, number> = new Map<number, number>();

    try {
      proportionalBytesByPid = await this.readProportionalBytes(data);
    } catch {
      // Every process then counts at its VmRSS.
    }

    return this.sumProportionalBytes({
      processes: data.processes,
      proportionalBytesByPid,
    });
  }

  private static async readProportionalBytes(data: {
    readonly processes: ReadonlyArray<ResidentProcessMemory>;
    readonly identity: ProcessMemoryIdentity | null;
    readonly signal?: AbortSignal | undefined;
    readonly helperPath?: string | undefined;
  }): Promise<Map<number, number>> {
    const pids: number[] = [
      ...new Set<number>(
        data.processes.map((processMemory: ResidentProcessMemory): number => {
          return processMemory.pid;
        }),
      ),
    ];

    if (pids.length === 0 || data.signal?.aborted) {
      return new Map<number, number>();
    }

    if (data.identity) {
      return this.readThroughHelper({
        pids,
        identity: data.identity,
        signal: data.signal,
        helperPath: data.helperPath ?? PROCESS_MEMORY_HELPER_PATH,
      });
    }

    return this.readDirectly(pids);
  }

  private static async readThroughHelper(data: {
    readonly pids: ReadonlyArray<number>;
    readonly identity: ProcessMemoryIdentity;
    readonly signal?: AbortSignal | undefined;
    readonly helperPath: string;
  }): Promise<Map<number, number>> {
    if (
      data.pids.length > PROCESS_MEMORY_HELPER_MAX_PIDS ||
      !fs.existsSync(data.helperPath)
    ) {
      return new Map<number, number>();
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
            timeout: PROCESS_MEMORY_HELPER_TIMEOUT_IN_MS,
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

    return this.parseHelperOutput({
      output,
      requestedPids: new Set<number>(data.pids),
    });
  }

  private static async readDirectly(
    pids: ReadonlyArray<number>,
  ): Promise<Map<number, number>> {
    const proportionalBytesByPid: Map<number, number> = new Map<
      number,
      number
    >();

    await Promise.all(
      pids.map(async (pid: number): Promise<void> => {
        try {
          const smapsRollup: string = await fs.promises.readFile(
            `/proc/${pid}/smaps_rollup`,
            "utf8",
          );
          const proportionalBytes: number | null =
            this.parseSmapsRollupProportionalBytes(smapsRollup);
          if (proportionalBytes !== null) {
            proportionalBytesByPid.set(pid, proportionalBytes);
          }
        } catch {
          // Exited, or not ours to read: it counts at its VmRSS.
        }
      }),
    );

    return proportionalBytesByPid;
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
