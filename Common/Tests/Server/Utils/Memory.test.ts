import MemoryUtil from "../../../Server/Utils/Memory";
import fs from "fs";
import os from "os";

/*
 * MemoryUtil decides how much memory a process may assume it has. On a host
 * it is os.freemem(); inside a container it must be the cgroup headroom,
 * because os.freemem() reports the whole node and would happily let a
 * container allocate its way to an OOM kill.
 *
 * The cgroup files do not exist on the dev machines these tests run on, so
 * fs.readFileSync is stubbed per-path. That is the only way to exercise the
 * v2 -> v1 -> null fallback chain and the "max"/unlimited handling at all.
 */

const CGROUP_V2_LIMIT: string = "/sys/fs/cgroup/memory.max";
const CGROUP_V2_USAGE: string = "/sys/fs/cgroup/memory.current";
const CGROUP_V1_LIMIT: string = "/sys/fs/cgroup/memory/memory.limit_in_bytes";
const CGROUP_V1_USAGE: string = "/sys/fs/cgroup/memory/memory.usage_in_bytes";

type StubCgroupFilesFunction = (files: Record<string, string>) => void;

/*
 * Makes readFileSync answer only for the given paths and throw ENOENT for
 * everything else, which is what the real filesystem does when a cgroup
 * version is not in use.
 */
const stubCgroupFiles: StubCgroupFilesFunction = (
  files: Record<string, string>,
): void => {
  jest
    .spyOn(fs, "readFileSync")
    .mockImplementation((path: fs.PathOrFileDescriptor): string => {
      const value: string | undefined = files[String(path)];

      if (value === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }

      return value;
    });
};

describe("MemoryUtil", () => {
  const hostFreeMemory: number = 8 * 1024 * 1024 * 1024;

  beforeEach(() => {
    jest.spyOn(os, "freemem").mockReturnValue(hostFreeMemory);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getHostFreeMemoryInBytes", () => {
    test("should report what the os reports", () => {
      expect(MemoryUtil.getHostFreeMemoryInBytes()).toEqual(hostFreeMemory);
    });
  });

  describe("getCgroupAvailableMemoryInBytes", () => {
    test("should return null when no cgroup files exist", () => {
      stubCgroupFiles({});

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toBeNull();
    });

    test("should return limit minus usage for cgroup v2", () => {
      stubCgroupFiles({
        [CGROUP_V2_LIMIT]: "1000",
        [CGROUP_V2_USAGE]: "400",
      });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toEqual(600);
    });

    test("should tolerate trailing whitespace in the cgroup files", () => {
      stubCgroupFiles({
        [CGROUP_V2_LIMIT]: "1000\n",
        [CGROUP_V2_USAGE]: " 400 \n",
      });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toEqual(600);
    });

    test("should never report negative headroom", () => {
      // Usage above the limit happens transiently; clamp at zero.
      stubCgroupFiles({
        [CGROUP_V2_LIMIT]: "1000",
        [CGROUP_V2_USAGE]: "1500",
      });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toEqual(0);
    });

    test("should fall back to cgroup v1 when v2 says 'max'", () => {
      /*
       * "max" is how cgroup v2 spells "no limit", so it must not be read as a
       * number and must not stop the v1 lookup.
       */
      stubCgroupFiles({
        [CGROUP_V2_LIMIT]: "max",
        [CGROUP_V2_USAGE]: "400",
        [CGROUP_V1_LIMIT]: "2000",
        [CGROUP_V1_USAGE]: "500",
      });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toEqual(1500);
    });

    test("should fall back to cgroup v1 when v2 files are absent", () => {
      stubCgroupFiles({
        [CGROUP_V1_LIMIT]: "2000",
        [CGROUP_V1_USAGE]: "500",
      });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toEqual(1500);
    });

    test("should ignore an absurdly large limit as 'unlimited'", () => {
      /*
       * This is the literal sentinel an unconstrained cgroup v1 reports
       * (PAGE_COUNTER_MAX, just under 2^63). It means "no limit", not "you
       * have exabytes free".
       */
      const unlimited: string = "9223372036854771712";

      stubCgroupFiles({
        [CGROUP_V1_LIMIT]: unlimited,
        [CGROUP_V1_USAGE]: "500",
      });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toBeNull();
    });

    test("should honour a realistic multi-gigabyte container limit", () => {
      /*
       * Regression guard for the unlimited threshold. It must be large enough
       * that ordinary container limits fall below it — a 2 GiB limit is a
       * real limit, not the "no limit" sentinel, and treating it as unlimited
       * silently disables container awareness for essentially every
       * deployment.
       */
      const twoGiB: number = 2 * 1024 * 1024 * 1024;
      const oneGiB: number = 1 * 1024 * 1024 * 1024;

      stubCgroupFiles({
        [CGROUP_V2_LIMIT]: String(twoGiB),
        [CGROUP_V2_USAGE]: String(oneGiB),
      });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toEqual(oneGiB);
    });

    test("should return null when the limit is present but usage is not", () => {
      stubCgroupFiles({ [CGROUP_V2_LIMIT]: "1000" });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toBeNull();
    });

    test("should return null for a non-numeric limit", () => {
      stubCgroupFiles({
        [CGROUP_V2_LIMIT]: "not-a-number",
        [CGROUP_V2_USAGE]: "400",
      });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toBeNull();
    });

    test("should return null for a zero or negative limit", () => {
      stubCgroupFiles({
        [CGROUP_V2_LIMIT]: "0",
        [CGROUP_V2_USAGE]: "0",
      });

      expect(MemoryUtil.getCgroupAvailableMemoryInBytes()).toBeNull();
    });
  });

  describe("getContainerAwareAvailableMemoryInBytes", () => {
    test("should use host free memory when there is no cgroup limit", () => {
      stubCgroupFiles({});

      expect(MemoryUtil.getContainerAwareAvailableMemoryInBytes()).toEqual(
        hostFreeMemory,
      );
    });

    test("should never exceed the container's headroom", () => {
      /*
       * This is the whole point of the helper: the host has 8GB free but the
       * container may only use 600 bytes more.
       */
      stubCgroupFiles({
        [CGROUP_V2_LIMIT]: "1000",
        [CGROUP_V2_USAGE]: "400",
      });

      expect(MemoryUtil.getContainerAwareAvailableMemoryInBytes()).toEqual(600);
    });

    test("should use host free memory when it is the smaller of the two", () => {
      jest.spyOn(os, "freemem").mockReturnValue(100);

      stubCgroupFiles({
        [CGROUP_V2_LIMIT]: "1000",
        [CGROUP_V2_USAGE]: "0",
      });

      expect(MemoryUtil.getContainerAwareAvailableMemoryInBytes()).toEqual(100);
    });
  });
});
