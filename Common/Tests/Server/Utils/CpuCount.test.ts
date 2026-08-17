import CpuCount, {
  EffectiveCpuCountReads,
} from "../../../Server/Utils/CpuCount";
import { describe, expect, test } from "@jest/globals";

/*
 * CpuCount.getEffectiveCpuCount is used to compute config DEFAULTS at
 * module load (the telemetry decode thread pool sizes itself from it),
 * so its contract has two load-bearing halves:
 *
 *   - it must prefer the cgroup CPU quota over the host core count,
 *     because inside a Kubernetes pod the host count is a lie for
 *     sizing purposes (a 2-CPU-limited pod on a 64-core node sees 64
 *     from Node), and
 *   - it must NEVER throw and always return an integer >= 1, because a
 *     throw here would take the process down during import.
 *
 * Every branch is exercised through the injectable reads, so these
 * tests are deterministic on any machine — including ones that ARE
 * inside a cgroup.
 */

const V2_PATH: string = "/sys/fs/cgroup/cpu.max";
const V1_QUOTA_PATH: string = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const V1_PERIOD_PATH: string = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

/*
 * Simulated filesystem: paths present in `files` return their contents;
 * everything else throws, exactly like fs.readFileSync on ENOENT.
 */
function makeReads(
  files: Record<string, string>,
  hostParallelism: number = 16,
): EffectiveCpuCountReads {
  return {
    readFileUtf8: (filePath: string): string => {
      if (Object.prototype.hasOwnProperty.call(files, filePath)) {
        return files[filePath] as string;
      }
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    },
    hostParallelism: (): number => {
      return hostParallelism;
    },
  };
}

describe("CpuCount.getEffectiveCpuCount — cgroup v2", () => {
  test("a v2 quota wins over the host count: '200000 100000' -> 2", () => {
    expect(
      CpuCount.getEffectiveCpuCount(makeReads({ [V2_PATH]: "200000 100000" })),
    ).toBe(2);
  });

  test("fractional quotas round UP (never down to 0): '50000 100000' -> 1, '250000 100000' -> 3", () => {
    expect(
      CpuCount.getEffectiveCpuCount(makeReads({ [V2_PATH]: "50000 100000" })),
    ).toBe(1);
    expect(
      CpuCount.getEffectiveCpuCount(makeReads({ [V2_PATH]: "250000 100000" })),
    ).toBe(3);
  });

  test("trailing newline (how the kernel actually serves the file) parses fine", () => {
    expect(
      CpuCount.getEffectiveCpuCount(
        makeReads({ [V2_PATH]: "400000 100000\n" }),
      ),
    ).toBe(4);
  });

  test("'max <period>' (unlimited) falls back to the host count", () => {
    expect(
      CpuCount.getEffectiveCpuCount(
        makeReads({ [V2_PATH]: "max 100000" }, 12),
      ),
    ).toBe(12);
  });

  test("an unlimited v2 hierarchy does NOT consult v1 files", () => {
    /*
     * If the v2 file exists, the v2 hierarchy governs — stale/foreign
     * v1 files on the same box must not override "unlimited".
     */
    expect(
      CpuCount.getEffectiveCpuCount(
        makeReads(
          {
            [V2_PATH]: "max 100000",
            [V1_QUOTA_PATH]: "100000",
            [V1_PERIOD_PATH]: "100000",
          },
          8,
        ),
      ),
    ).toBe(8);
  });

  test("garbage v2 contents fall through to v1 rather than being trusted", () => {
    expect(
      CpuCount.getEffectiveCpuCount(
        makeReads(
          {
            [V2_PATH]: "bananas",
            [V1_QUOTA_PATH]: "200000",
            [V1_PERIOD_PATH]: "100000",
          },
          16,
        ),
      ),
    ).toBe(2);
  });
});

describe("CpuCount.getEffectiveCpuCount — cgroup v1", () => {
  test("a v1 quota/period pair is honored: 300000/100000 -> 3", () => {
    expect(
      CpuCount.getEffectiveCpuCount(
        makeReads(
          { [V1_QUOTA_PATH]: "300000\n", [V1_PERIOD_PATH]: "100000\n" },
          16,
        ),
      ),
    ).toBe(3);
  });

  test("quota -1 (v1's 'unlimited') falls back to the host count", () => {
    expect(
      CpuCount.getEffectiveCpuCount(
        makeReads(
          { [V1_QUOTA_PATH]: "-1", [V1_PERIOD_PATH]: "100000" },
          10,
        ),
      ),
    ).toBe(10);
  });

  test("a readable quota with an unreadable period falls back (never guess a period)", () => {
    expect(
      CpuCount.getEffectiveCpuCount(makeReads({ [V1_QUOTA_PATH]: "200000" }, 6)),
    ).toBe(6);
  });

  test("garbage v1 contents fall back to the host count", () => {
    expect(
      CpuCount.getEffectiveCpuCount(
        makeReads(
          { [V1_QUOTA_PATH]: "not-a-number", [V1_PERIOD_PATH]: "100000" },
          7,
        ),
      ),
    ).toBe(7);
  });
});

describe("CpuCount.getEffectiveCpuCount — fallbacks and the never-throw guarantee", () => {
  test("no cgroup files at all (macOS/Windows/bare Linux): host count", () => {
    expect(CpuCount.getEffectiveCpuCount(makeReads({}, 8))).toBe(8);
  });

  test("a nonsensical host count is clamped to >= 1", () => {
    expect(CpuCount.getEffectiveCpuCount(makeReads({}, 0))).toBe(1);
    expect(CpuCount.getEffectiveCpuCount(makeReads({}, -3))).toBe(1);
    expect(CpuCount.getEffectiveCpuCount(makeReads({}, NaN))).toBe(1);
  });

  test("a fractional host count is floored (integers only)", () => {
    expect(CpuCount.getEffectiveCpuCount(makeReads({}, 6.9))).toBe(6);
  });

  test("even a THROWING host-parallelism read cannot escape: returns 1", () => {
    expect(
      CpuCount.getEffectiveCpuCount({
        readFileUtf8: (): string => {
          throw new Error("ENOENT");
        },
        hostParallelism: (): number => {
          throw new Error("os is broken");
        },
      }),
    ).toBe(1);
  });

  test("with no overrides (real fs + real os) it still returns an integer >= 1", () => {
    /*
     * Environment-dependent by nature, so only the invariants are
     * pinned — this is the exact call Config.ts makes at import time.
     */
    const count: number = CpuCount.getEffectiveCpuCount();
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
