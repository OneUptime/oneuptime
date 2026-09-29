import fs from "fs";
import os from "os";

/*
 * Treat an absurdly large cgroup limit as "unlimited". Must be `2 ** 60`, not
 * `1 << 60`: JavaScript's `<<` truncates to 32 bits and takes the shift count
 * mod 32, so `1 << 60` is `1 << 28` = 256 MiB. That made every container with
 * a limit of 256 MiB or more look unlimited, so getCgroupAvailableMemoryInBytes
 * returned null and the container-aware helper silently fell back to the whole
 * host's free memory — the exact OOM-kill case it exists to prevent.
 */
const UNLIMITED_CGROUP_THRESHOLD_BYTES: number = 2 ** 60;

export default class MemoryUtil {
  public static getHostFreeMemoryInBytes(): number {
    return os.freemem();
  }

  public static getContainerAwareAvailableMemoryInBytes(): number {
    const hostFreeMemory: number = this.getHostFreeMemoryInBytes();
    const cgroupAvailableMemory: number | null =
      this.getCgroupAvailableMemoryInBytes();

    if (cgroupAvailableMemory === null) {
      return hostFreeMemory;
    }

    // Be conservative: never exceed container-available memory.
    return Math.min(hostFreeMemory, cgroupAvailableMemory);
  }

  public static getCgroupAvailableMemoryInBytes(): number | null {
    // cgroup v2
    const v2Limit: number | null = this.readNumericFile(
      "/sys/fs/cgroup/memory.max",
    );
    const v2Usage: number | null = this.readNumericFile(
      "/sys/fs/cgroup/memory.current",
    );

    if (
      v2Limit &&
      v2Usage !== null &&
      v2Limit > 0 &&
      v2Limit < UNLIMITED_CGROUP_THRESHOLD_BYTES
    ) {
      return Math.max(v2Limit - v2Usage, 0);
    }

    // cgroup v1
    const v1Limit: number | null = this.readNumericFile(
      "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    );
    const v1Usage: number | null = this.readNumericFile(
      "/sys/fs/cgroup/memory/memory.usage_in_bytes",
    );

    if (
      v1Limit &&
      v1Usage !== null &&
      v1Limit > 0 &&
      v1Limit < UNLIMITED_CGROUP_THRESHOLD_BYTES
    ) {
      return Math.max(v1Limit - v1Usage, 0);
    }

    return null;
  }

  private static readNumericFile(path: string): number | null {
    try {
      const rawValue: string = fs.readFileSync(path, "utf8").trim();

      if (!rawValue || rawValue === "max") {
        return null;
      }

      const value: number = Number(rawValue);

      if (!Number.isFinite(value) || value <= 0) {
        return null;
      }

      return value;
    } catch {
      return null;
    }
  }
}
