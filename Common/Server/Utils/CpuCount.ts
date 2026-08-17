import fs from "fs";
import os from "os";

/*
 * Effective CPU count for THIS process — cgroup-aware.
 *
 * Node's os.availableParallelism() / os.cpus() report the HOST's cores.
 * Inside a Kubernetes pod (or any cgroup-limited container) that number
 * is a lie for sizing purposes: a pod with `limits.cpu: "2"` on a
 * 64-core node sees 64 from Node but is throttled to 2 cores of actual
 * runtime by the CFS quota. Anything that sizes a thread/worker pool
 * from the host count therefore oversubscribes small pods on big nodes
 * — more threads means more context switching and more memory for LESS
 * throughput once the quota kicks in.
 *
 * This helper answers "how many cores can this process actually burn?"
 * by preferring the cgroup CPU quota over the host count:
 *
 *   1. cgroup v2: /sys/fs/cgroup/cpu.max, containing "<quota> <period>"
 *      in microseconds, or "max <period>" when unlimited. (cgroup v2 is
 *      the default on all current Kubernetes/containerd and systemd
 *      hosts.)
 *   2. cgroup v1: /sys/fs/cgroup/cpu/cpu.cfs_quota_us and
 *      cpu.cfs_period_us; quota -1 means unlimited. (Older hosts.)
 *   3. Host fallback: os.availableParallelism() (os.cpus().length on
 *      Node versions that predate it) when there is no readable limit —
 *      bare metal, macOS/Windows dev machines, or an unlimited cgroup.
 *
 * A limited quota is converted with ceil(quota / period): a pod limited
 * to 2.5 CPUs can genuinely run 3 threads' worth of bursts, and ceil
 * also guarantees the result is never rounded down to 0 for fractional
 * limits (0.5 CPU -> 1).
 *
 * Guarantees:
 *   - NEVER throws. Absent files (non-Linux, no cgroups), unreadable
 *     files, and garbage contents all fall through to the next source;
 *     if everything fails the answer is 1 — the most conservative value
 *     (callers sizing "extra" capacity from it will size zero extra).
 *   - Always returns an integer >= 1.
 *
 * The file/host reads are injectable so unit tests can exercise every
 * branch deterministically on any machine (see EffectiveCpuCountReads).
 */

export type ReadFileUtf8Function = (filePath: string) => string;
export type HostParallelismFunction = () => number;

export interface EffectiveCpuCountReads {
  /*
   * Must behave like fs.readFileSync(path, "utf-8"): return the file's
   * contents, or THROW when the file is absent/unreadable.
   */
  readFileUtf8?: ReadFileUtf8Function;
  // Must behave like os.availableParallelism(): the host's core count.
  hostParallelism?: HostParallelismFunction;
}

const CGROUP_V2_CPU_MAX_PATH: string = "/sys/fs/cgroup/cpu.max";
const CGROUP_V1_CPU_QUOTA_PATH: string =
  "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const CGROUP_V1_CPU_PERIOD_PATH: string =
  "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

export default class CpuCount {
  public static getEffectiveCpuCount(reads?: EffectiveCpuCountReads): number {
    /*
     * Outer guard: this function is used to compute config DEFAULTS at
     * module load, where an exception would take the whole process down
     * — so even a throwing injected override must not escape.
     */
    try {
      const readFileUtf8: ReadFileUtf8Function =
        reads?.readFileUtf8 ||
        ((filePath: string): string => {
          return fs.readFileSync(filePath, "utf-8");
        });

      const cgroupLimit: number | null = this.readCgroupCpuLimit(readFileUtf8);
      if (cgroupLimit !== null) {
        return cgroupLimit;
      }

      const hostParallelism: HostParallelismFunction =
        reads?.hostParallelism || CpuCount.defaultHostParallelism;

      return this.sanitizeCount(hostParallelism());
    } catch {
      return 1;
    }
  }

  /*
   * The cgroup quota, as a whole number of CPUs — or null when there is
   * no limit to honor (unlimited, files absent, or contents garbage),
   * in which case the caller falls back to the host count.
   */
  private static readCgroupCpuLimit(
    readFileUtf8: ReadFileUtf8Function,
  ): number | null {
    // cgroup v2 first — it is what current container runtimes use.
    let v2Content: string | null = null;
    try {
      v2Content = readFileUtf8(CGROUP_V2_CPU_MAX_PATH);
    } catch {
      v2Content = null; // File absent: not a v2 host (or not Linux).
    }

    if (v2Content !== null) {
      const tokens: Array<string> = v2Content.trim().split(/\s+/);
      if (tokens[0] === "max") {
        /*
         * Explicitly unlimited. The v2 file existing means the v2
         * hierarchy governs this process, so do NOT consult the v1
         * files — go straight to the host count.
         */
        return null;
      }
      const quotaUs: number = Number(tokens[0]);
      const periodUs: number = Number(tokens[1]);
      if (
        Number.isFinite(quotaUs) &&
        Number.isFinite(periodUs) &&
        quotaUs > 0 &&
        periodUs > 0
      ) {
        return Math.max(1, Math.ceil(quotaUs / periodUs));
      }
      /*
       * Garbage v2 contents: fall through and give v1 a chance rather
       * than trusting a file we could not parse.
       */
    }

    // cgroup v1 (older hosts).
    let quotaUs: number = NaN;
    try {
      quotaUs = Number(readFileUtf8(CGROUP_V1_CPU_QUOTA_PATH).trim());
    } catch {
      return null; // File absent/unreadable: no v1 limit either.
    }

    if (!Number.isFinite(quotaUs) || quotaUs <= 0) {
      // -1 is v1's documented "unlimited"; garbage is treated the same.
      return null;
    }

    let periodUs: number = NaN;
    try {
      periodUs = Number(readFileUtf8(CGROUP_V1_CPU_PERIOD_PATH).trim());
    } catch {
      return null;
    }

    if (!Number.isFinite(periodUs) || periodUs <= 0) {
      /*
       * A positive quota with an unreadable period cannot be converted
       * to a CPU count — never guess a period; fall back to the host.
       */
      return null;
    }

    return Math.max(1, Math.ceil(quotaUs / periodUs));
  }

  private static defaultHostParallelism(): number {
    /*
     * availableParallelism() (Node >= 18.14) already accounts for
     * process CPU affinity masks; cpus().length is the fallback for
     * older runtimes. Accessed through a structural type because the
     * repo's pinned @types/node predates the API even though the
     * runtime Node has it — a plain os.availableParallelism reference
     * fails to compile.
     */
    const osModule: typeof os & { availableParallelism?: () => number } =
      os as typeof os & { availableParallelism?: () => number };
    if (typeof osModule.availableParallelism === "function") {
      return osModule.availableParallelism();
    }
    return os.cpus().length;
  }

  // Clamp anything odd (NaN, 0, negatives, floats) to an integer >= 1.
  private static sanitizeCount(count: number): number {
    if (!Number.isFinite(count) || count < 1) {
      return 1;
    }
    return Math.floor(count);
  }
}
