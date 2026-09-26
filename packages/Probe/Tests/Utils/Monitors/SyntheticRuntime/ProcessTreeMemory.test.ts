import * as childProcess from "child_process";
import { ExecFileOptions } from "child_process";
import fs from "fs";
import ProcessTreeMemory, {
  PROCESS_MEMORY_HELPER_MAX_PIDS,
  PROCESS_MEMORY_HELPER_PATH,
  PROCESS_MEMORY_READ_TIMEOUT_IN_MS,
  ProportionalMemoryReading,
  ResidentBytesReader,
} from "../../../../Utils/Monitors/SyntheticRuntime/ProcessTreeMemory";

jest.mock("child_process", () => {
  const actual: typeof import("child_process") =
    jest.requireActual("child_process");
  return {
    ...actual,
    execFile: jest.fn(),
  };
});

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

interface ExecFileCall {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly options: ExecFileOptions & { signal?: AbortSignal };
}

const MEGABYTE: number = 1024 * 1024;
const KILOBYTE: number = 1024;

// The production default, and the value the customer's checks were held to.
const DEFAULT_LIMIT_BYTES: number = 1536 * MEGABYTE;

function getExecFileMock(): jest.Mock {
  return childProcess.execFile as unknown as jest.Mock;
}

/*
 * Makes the helper answer with `output`, or fail with `error`, and records
 * every call.
 */
function mockHelper(result: {
  output?: string;
  error?: Error;
}): ExecFileCall[] {
  const calls: ExecFileCall[] = [];
  getExecFileMock().mockImplementation(
    (
      file: string,
      args: ReadonlyArray<string>,
      options: ExecFileCall["options"],
      callback: ExecFileCallback,
    ): void => {
      calls.push({ file, args, options });
      global.setImmediate(() => {
        callback(result.error ?? null, result.output ?? "", "");
      });
    },
  );
  return calls;
}

function mockHelperPresent(present: boolean): void {
  const realExistsSync: typeof fs.existsSync = fs.existsSync;
  jest.spyOn(fs, "existsSync").mockImplementation((candidate: fs.PathLike) => {
    if (candidate === PROCESS_MEMORY_HELPER_PATH) {
      return present;
    }
    return realExistsSync(candidate);
  });
}

function statusFile(data: {
  name?: string;
  anonKb: number;
  fileKb: number;
  shmemKb: number;
}): string {
  const vmRssKb: number = data.anonKb + data.fileKb + data.shmemKb;
  return [
    `Name:\t${data.name ?? "chrome"}`,
    "Umask:\t0022",
    "State:\tS (sleeping)",
    "Tgid:\t4242",
    "Pid:\t4242",
    "PPid:\t4241",
    "Uid:\t20001\t20001\t20001\t20001",
    "Gid:\t20001\t20001\t20001\t20001",
    "VmPeak:\t 1386520 kB",
    "VmSize:\t 1386520 kB",
    `VmHWM:\t ${vmRssKb} kB`,
    `VmRSS:\t ${vmRssKb} kB`,
    `RssAnon:\t ${data.anonKb} kB`,
    `RssFile:\t ${data.fileKb} kB`,
    `RssShmem:\t ${data.shmemKb} kB`,
    "VmData:\t  402048 kB",
    "VmPTE:\t     812 kB",
    "Threads:\t19",
    "",
  ].join("\n");
}

// The shape of /proc/<pid>/smaps_rollup on a 6.x kernel.
function smapsRollupFile(data: {
  rssKb: number;
  pssKb: number;
  pssAnonKb?: number;
}): string {
  return [
    "55d5a1b43000-7ffd4e3f1000 ---p 00000000 00:00 0                          [rollup]",
    `Rss:              ${data.rssKb} kB`,
    `Pss:              ${data.pssKb} kB`,
    `Pss_Dirty:        ${data.pssAnonKb ?? 0} kB`,
    `Pss_Anon:         ${data.pssAnonKb ?? 0} kB`,
    "Pss_File:          91234 kB",
    "Pss_Shmem:             0 kB",
    "Shared_Clean:      98512 kB",
    "Shared_Dirty:       2264 kB",
    "Private_Clean:     11388 kB",
    "Private_Dirty:     47352 kB",
    "Referenced:       159516 kB",
    "Anonymous:         49616 kB",
    "LazyFree:              0 kB",
    "AnonHugePages:         0 kB",
    "ShmemPmdMapped:        0 kB",
    "FilePmdMapped:         0 kB",
    "Shared_Hugetlb:        0 kB",
    "Private_Hugetlb:       0 kB",
    "Swap:                  0 kB",
    "SwapPss:               0 kB",
    "Locked:                0 kB",
    "",
  ].join("\n");
}

/*
 * A Desktop Chromium check shaped like the ones the customer's monitors ran:
 * the worker, the browser, two zygotes, the GPU, network and storage
 * services, and five renderers. Every Chromium process maps the same browser
 * binary, so its VmRSS is mostly shared file pages; the sum reaches the
 * observed 1,612,525,568 bytes while the tree's PSS is about half that.
 */
interface ChromiumProcessShape {
  readonly pid: number;
  readonly residentBytes: number;
  readonly proportionalBytes: number;
}

const CUSTOMER_TREE: ReadonlyArray<ChromiumProcessShape> = [
  // worker (node)
  { pid: 50_001, residentBytes: 158_937_088, proportionalBytes: 150_994_944 },
  // browser
  { pid: 50_002, residentBytes: 205_520_896, proportionalBytes: 118_489_088 },
  // zygotes
  { pid: 50_003, residentBytes: 64_487_424, proportionalBytes: 12_582_912 },
  { pid: 50_004, residentBytes: 64_487_424, proportionalBytes: 9_437_184 },
  // gpu-process
  { pid: 50_005, residentBytes: 177_209_344, proportionalBytes: 90_177_536 },
  // network and storage services
  { pid: 50_006, residentBytes: 107_479_040, proportionalBytes: 29_360_128 },
  { pid: 50_007, residentBytes: 51_052_544, proportionalBytes: 8_388_608 },
  // renderers: the page, one mid-navigation, the spare and two iframes
  { pid: 50_008, residentBytes: 400_556_032, proportionalBytes: 298_844_160 },
  { pid: 50_009, residentBytes: 145_752_064, proportionalBytes: 47_185_920 },
  { pid: 50_010, residentBytes: 70_254_592, proportionalBytes: 14_680_064 },
  { pid: 50_011, residentBytes: 83_361_792, proportionalBytes: 20_971_520 },
  { pid: 50_012, residentBytes: 83_427_328, proportionalBytes: 20_971_520 },
];

function sumOf(
  shapes: ReadonlyArray<ChromiumProcessShape>,
  key: "residentBytes" | "proportionalBytes",
): number {
  return shapes.reduce((total: number, shape: ChromiumProcessShape) => {
    return total + shape[key];
  }, 0);
}

function pidsOf(shapes: ReadonlyArray<ChromiumProcessShape>): number[] {
  return shapes.map((shape: ChromiumProcessShape) => {
    return shape.pid;
  });
}

/*
 * Reads VmRSS the way /proc would now: each process at its shape's value,
 * except those that have exited since.
 */
function residentReader(
  shapes: ReadonlyArray<ChromiumProcessShape>,
  exitedPids: ReadonlySet<number> = new Set<number>(),
): ResidentBytesReader {
  return (pid: number): number | null => {
    if (exitedPids.has(pid)) {
      return null;
    }
    const shape: ChromiumProcessShape | undefined = shapes.find(
      (candidate: ChromiumProcessShape) => {
        return candidate.pid === pid;
      },
    );
    return shape ? shape.residentBytes : null;
  };
}

function shapeOf(pid: number): ChromiumProcessShape {
  return CUSTOMER_TREE.find((shape: ChromiumProcessShape) => {
    return shape.pid === pid;
  }) as ChromiumProcessShape;
}

function helperOutputFor(
  shapes: ReadonlyArray<ChromiumProcessShape>,
  unreadablePids: ReadonlySet<number> = new Set<number>(),
): string {
  return (
    shapes
      .map((shape: ChromiumProcessShape) => {
        return unreadablePids.has(shape.pid)
          ? `${shape.pid} -`
          : `${shape.pid} ${shape.proportionalBytes / KILOBYTE}`;
      })
      .join("\n") + "\n"
  );
}

describe("SyntheticRuntime ProcessTreeMemory", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    getExecFileMock().mockReset();
  });

  test("the customer-shaped tree is over the limit by summed VmRSS and well under it by PSS", () => {
    // The fixture itself: what the watchdog used to report, and what is held.
    expect(sumOf(CUSTOMER_TREE, "residentBytes")).toBe(1_612_525_568);
    expect(sumOf(CUSTOMER_TREE, "residentBytes")).toBeGreaterThan(
      DEFAULT_LIMIT_BYTES,
    );
    expect(sumOf(CUSTOMER_TREE, "proportionalBytes")).toBeLessThan(
      DEFAULT_LIMIT_BYTES * 0.6,
    );
  });

  describe("parseStatusResidentBytes", () => {
    test("reads VmRSS in bytes", () => {
      expect(
        ProcessTreeMemory.parseStatusResidentBytes(
          statusFile({ anonKb: 30_000, fileKb: 150_000, shmemKb: 512 }),
        ),
      ).toBe(180_512 * KILOBYTE);
    });

    test("returns null for a status with no memory lines", () => {
      // A zombie, a kernel thread, or a process whose main thread exited.
      const status: string = [
        "Name:\tchrome",
        "State:\tZ (zombie)",
        "Tgid:\t4242",
        "Threads:\t1",
        "",
      ].join("\n");

      expect(ProcessTreeMemory.parseStatusResidentBytes(status)).toBeNull();
    });

    test("cannot be fooled by a process name that spells out a VmRSS line", () => {
      /*
       * The kernel escapes a newline in the name as the two characters "\n",
       * so the name stays on its own line and an anchored match skips it.
       */
      const forgedName: string = "x\\nVmRSS:\t1 kB";

      expect(
        ProcessTreeMemory.parseStatusResidentBytes(
          [`Name:\t${forgedName}`, "State:\tZ (zombie)", ""].join("\n"),
        ),
      ).toBeNull();
      expect(
        ProcessTreeMemory.parseStatusResidentBytes(
          statusFile({
            name: forgedName,
            anonKb: 900_000,
            fileKb: 100_000,
            shmemKb: 0,
          }),
        ),
      ).toBe(1_000_000 * KILOBYTE);
    });

    test("does not mistake RssAnon, RssFile or VmHWM for VmRSS", () => {
      const status: string = [
        "Name:\tchrome",
        "VmHWM:\t 999999 kB",
        "RssAnon:\t 100 kB",
        "RssFile:\t 200 kB",
        "RssShmem:\t 300 kB",
        "",
      ].join("\n");

      expect(ProcessTreeMemory.parseStatusResidentBytes(status)).toBeNull();
    });

    test("rejects a value it cannot represent or a unit it does not expect", () => {
      expect(
        ProcessTreeMemory.parseStatusResidentBytes(
          "VmRSS:\t 99999999999999999999 kB\n",
        ),
      ).toBeNull();
      expect(
        ProcessTreeMemory.parseStatusResidentBytes("VmRSS:\t 1024 MB\n"),
      ).toBeNull();
      expect(
        ProcessTreeMemory.parseStatusResidentBytes("VmRSS:\t -5 kB\n"),
      ).toBeNull();
    });
  });

  describe("parseSmapsRollupProportionalBytes", () => {
    test("reads the Pss line in bytes", () => {
      expect(
        ProcessTreeMemory.parseSmapsRollupProportionalBytes(
          smapsRollupFile({ rssKb: 205_000, pssKb: 115_712 }),
        ),
      ).toBe(115_712 * KILOBYTE);
    });

    test("never reads Pss_Anon, Pss_File, Pss_Dirty or Pss_Shmem instead", () => {
      const withoutPss: string = smapsRollupFile({
        rssKb: 205_000,
        pssKb: 115_712,
        pssAnonKb: 42_000,
      })
        .split("\n")
        .filter((line: string) => {
          return !line.startsWith("Pss:");
        })
        .join("\n");

      expect(
        ProcessTreeMemory.parseSmapsRollupProportionalBytes(withoutPss),
      ).toBeNull();
    });

    test("finds Pss wherever it appears among the other Pss lines", () => {
      const reordered: string = [
        "Pss_Anon:          42000 kB",
        "Pss_File:          91234 kB",
        "Pss:              133234 kB",
        "",
      ].join("\n");

      expect(
        ProcessTreeMemory.parseSmapsRollupProportionalBytes(reordered),
      ).toBe(133_234 * KILOBYTE);
    });

    test("returns null for an empty or malformed rollup", () => {
      expect(ProcessTreeMemory.parseSmapsRollupProportionalBytes("")).toBe(
        null,
      );
      expect(
        ProcessTreeMemory.parseSmapsRollupProportionalBytes("Pss: lots kB\n"),
      ).toBeNull();
    });
  });

  describe("parseHelperOutput", () => {
    test("maps each readable pid to its PSS in bytes, leaves unreadable ones out, and is complete", () => {
      const parsed: {
        proportionalBytesByPid: Map<number, number>;
        isComplete: boolean;
      } = ProcessTreeMemory.parseHelperOutput({
        output: "101 2048\n102 -\n103 0\n",
        requestedPids: new Set<number>([101, 102, 103]),
      });

      expect([...parsed.proportionalBytesByPid.entries()]).toEqual([
        [101, 2048 * KILOBYTE],
        [103, 0],
      ]);
      expect(parsed.isComplete).toBe(true);
    });

    test("is incomplete when a pid was not answered for", () => {
      const parsed: {
        proportionalBytesByPid: Map<number, number>;
        isComplete: boolean;
      } = ProcessTreeMemory.parseHelperOutput({
        output: "101 2048\n",
        requestedPids: new Set<number>([101, 102]),
      });

      expect([...parsed.proportionalBytesByPid.keys()]).toEqual([101]);
      expect(parsed.isComplete).toBe(false);
    });

    test("is incomplete for no output at all", () => {
      // What a helper killed before it printed anything leaves behind.
      const parsed: {
        proportionalBytesByPid: Map<number, number>;
        isComplete: boolean;
      } = ProcessTreeMemory.parseHelperOutput({
        output: "",
        requestedPids: new Set<number>([101]),
      });

      expect(parsed.proportionalBytesByPid.size).toBe(0);
      expect(parsed.isComplete).toBe(false);
    });

    test("ignores a pid that was not asked about, and is then incomplete", () => {
      const parsed: {
        proportionalBytesByPid: Map<number, number>;
        isComplete: boolean;
      } = ProcessTreeMemory.parseHelperOutput({
        output: "101 2048\n999 1\n",
        requestedPids: new Set<number>([101]),
      });

      expect([...parsed.proportionalBytesByPid.keys()]).toEqual([101]);
      expect(parsed.isComplete).toBe(false);
    });

    test("drops a pid reported twice rather than choosing between the answers", () => {
      const parsed: {
        proportionalBytesByPid: Map<number, number>;
        isComplete: boolean;
      } = ProcessTreeMemory.parseHelperOutput({
        output: "101 1\n101 2048\n101 4\n102 8\n",
        requestedPids: new Set<number>([101, 102]),
      });

      expect([...parsed.proportionalBytesByPid.entries()]).toEqual([
        [102, 8 * KILOBYTE],
      ]);
      expect(parsed.isComplete).toBe(false);
    });

    test.each<[string, string]>([
      ["a leading space", " 101 2048"],
      ["a trailing space", "101 2048 "],
      ["a tab separator", "101\t2048"],
      ["a fraction", "101 20.5"],
      ["a negative value", "101 -2048"],
      ["pid zero", "0 2048"],
      ["a leading zero", "0101 2048"],
      ["a unit", "101 2048 kB"],
      ["words", "pid 101 pss 2048"],
      ["an absurd value", "101 9999999999999999"],
      ["a blank line", ""],
    ])(
      "ignores a line with %s, and is then incomplete",
      (_description: string, line: string) => {
        const parsed: {
          proportionalBytesByPid: Map<number, number>;
          isComplete: boolean;
        } = ProcessTreeMemory.parseHelperOutput({
          output: `${line}\n101 -\n`,
          requestedPids: new Set<number>([101]),
        });

        expect(parsed.proportionalBytesByPid.size).toBe(0);
        expect(parsed.isComplete).toBe(false);
      },
    );

    test("leaves out a value too large to add up safely", () => {
      const parsed: {
        proportionalBytesByPid: Map<number, number>;
        isComplete: boolean;
      } = ProcessTreeMemory.parseHelperOutput({
        output: "101 999999999999999\n",
        requestedPids: new Set<number>([101]),
      });

      expect(parsed.proportionalBytesByPid.size).toBe(0);
    });
  });

  describe("sumProportionalBytes", () => {
    test("counts each process at its PSS where it was read and at its current VmRSS where not", () => {
      const residentReads: number[] = [];

      expect(
        ProcessTreeMemory.sumProportionalBytes({
          pids: [1, 2, 3],
          proportionalBytesByPid: new Map<number, number>([
            [1, 40],
            [3, 90],
          ]),
          readResidentBytes: (pid: number): number | null => {
            residentReads.push(pid);
            return pid * 100;
          },
        }),
      ).toEqual({ observedBytes: 40 + 200 + 90, residentFallbackCount: 1 });
      // VmRSS is read only for the process whose PSS is missing.
      expect(residentReads).toEqual([2]);
    });

    test("counts nothing for a process that has exited", () => {
      expect(
        ProcessTreeMemory.sumProportionalBytes({
          pids: [1, 2],
          proportionalBytesByPid: new Map<number, number>([[1, 40]]),
          readResidentBytes: (): null => {
            return null;
          },
        }),
      ).toEqual({ observedBytes: 40, residentFallbackCount: 0 });
    });

    test("saturates instead of overflowing", () => {
      expect(
        ProcessTreeMemory.sumProportionalBytes({
          pids: [1, 2],
          proportionalBytesByPid: new Map<number, number>([
            [1, Number.MAX_SAFE_INTEGER],
          ]),
          readResidentBytes: (): number => {
            return 4096;
          },
        }).observedBytes,
      ).toBe(Number.MAX_SAFE_INTEGER);
    });

    test("is zero for an empty tree", () => {
      expect(
        ProcessTreeMemory.sumProportionalBytes({
          pids: [],
          proportionalBytesByPid: new Map<number, number>(),
          readResidentBytes: (): number => {
            return 4096;
          },
        }),
      ).toEqual({ observedBytes: 0, residentFallbackCount: 0 });
    });
  });

  describe("readResidentBytes", () => {
    function mockProc(files: Record<string, string>, tasks: string[]): void {
      const realReadFileSync: typeof fs.readFileSync = fs.readFileSync;
      jest.spyOn(fs, "readFileSync").mockImplementation(((
        filePath: fs.PathOrFileDescriptor,
        options?: unknown,
      ): string | Buffer => {
        const pathText: string = String(filePath);
        if (!pathText.startsWith("/proc/")) {
          return realReadFileSync(
            filePath,
            options as Parameters<typeof fs.readFileSync>[1],
          );
        }
        const contents: string | undefined = files[pathText];
        if (contents === undefined) {
          throw Object.assign(new Error(`ENOENT: ${pathText}`), {
            code: "ENOENT",
          });
        }
        return contents;
      }) as typeof fs.readFileSync);
      jest.spyOn(fs, "readdirSync").mockImplementation(((
        directory: fs.PathLike,
      ): string[] => {
        if (String(directory) === "/proc/4242/task") {
          return tasks;
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }) as unknown as typeof fs.readdirSync);
    }

    test("reads VmRSS from the process's status", () => {
      mockProc(
        {
          "/proc/4242/status": statusFile({
            anonKb: 1000,
            fileKb: 2000,
            shmemKb: 0,
          }),
        },
        ["4242"],
      );

      expect(ProcessTreeMemory.readResidentBytes(4242)).toBe(3000 * KILOBYTE);
    });

    test("reads it from a remaining thread once the main thread has exited", () => {
      mockProc(
        {
          "/proc/4242/status": "Name:\tchrome\nState:\tZ (zombie)\n",
          "/proc/4242/task/4243/status": statusFile({
            anonKb: 500_000,
            fileKb: 100_000,
            shmemKb: 0,
          }),
        },
        ["4242", "4243"],
      );

      expect(ProcessTreeMemory.readResidentBytes(4242)).toBe(
        600_000 * KILOBYTE,
      );
    });

    test("is null for a process that has exited", () => {
      mockProc({}, []);

      expect(ProcessTreeMemory.readResidentBytes(4242)).toBeNull();
    });

    test("is null for a zombie with no thread left", () => {
      mockProc({ "/proc/4242/status": "Name:\tchrome\nState:\tZ (zombie)\n" }, [
        "4242",
      ]);

      expect(ProcessTreeMemory.readResidentBytes(4242)).toBeNull();
    });
  });

  describe("measureProportionalBytes through the helper", () => {
    const identity: { uid: number; gid: number } = { uid: 20_001, gid: 20_002 };

    function measure(
      overrides: Partial<
        Parameters<typeof ProcessTreeMemory.measureProportionalBytes>[0]
      > = {},
    ): Promise<ProportionalMemoryReading> {
      return ProcessTreeMemory.measureProportionalBytes({
        pids: pidsOf(CUSTOMER_TREE),
        identity,
        readResidentBytes: residentReader(CUSTOMER_TREE),
        ...overrides,
      });
    }

    test("asks the helper for the check's identity and every pid, and sums the PSS it reports", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({
        output: helperOutputFor(CUSTOMER_TREE),
      });

      const reading: ProportionalMemoryReading = await measure();

      expect(reading).toEqual({
        observedBytes: sumOf(CUSTOMER_TREE, "proportionalBytes"),
        processCount: CUSTOMER_TREE.length,
        residentFallbackCount: 0,
        proportionalBytesByPid: expect.any(Map),
        isComplete: true,
        failure: null,
      });
      expect(reading.observedBytes).toBeLessThan(DEFAULT_LIMIT_BYTES);
      expect([...reading.proportionalBytesByPid.entries()]).toEqual(
        CUSTOMER_TREE.map((shape: ChromiumProcessShape) => {
          return [shape.pid, shape.proportionalBytes];
        }),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.file).toBe(PROCESS_MEMORY_HELPER_PATH);
      expect(calls[0]?.args).toEqual([
        "20001",
        "20002",
        ...pidsOf(CUSTOMER_TREE).map(String),
      ]);
    });

    test("runs the helper bounded in time and output, with an empty environment", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({ output: "" });

      await measure();

      expect(calls[0]?.options).toEqual(
        expect.objectContaining({
          env: {},
          timeout: PROCESS_MEMORY_READ_TIMEOUT_IN_MS,
          killSignal: "SIGKILL",
        }),
      );
      expect(calls[0]?.options.maxBuffer).toBeGreaterThanOrEqual(
        PROCESS_MEMORY_HELPER_MAX_PIDS * "1073741823 999999999999999\n".length,
      );
    });

    test("asks about each pid once", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({ output: "7 4\n" });

      const reading: ProportionalMemoryReading = await measure({
        pids: [7, 7],
        readResidentBytes: (): number => {
          return 10 * KILOBYTE;
        },
      });

      expect(calls[0]?.args).toEqual(["20001", "20002", "7"]);
      expect(reading.observedBytes).toBe(4 * KILOBYTE);
      expect(reading.processCount).toBe(1);
    });

    test("counts a process the helper could not read at its VmRSS as read now", async () => {
      mockHelperPresent(true);
      const hiddenPid: number = 50_008;
      mockHelper({
        output: helperOutputFor(CUSTOMER_TREE, new Set<number>([hiddenPid])),
      });
      const grownResidentBytes: number = 700 * MEGABYTE;

      const reading: ProportionalMemoryReading = await measure({
        readResidentBytes: (pid: number): number | null => {
          return pid === hiddenPid
            ? grownResidentBytes
            : shapeOf(pid).residentBytes;
        },
      });

      expect(reading.observedBytes).toBe(
        sumOf(CUSTOMER_TREE, "proportionalBytes") -
          shapeOf(hiddenPid).proportionalBytes +
          grownResidentBytes,
      );
      expect(reading.residentFallbackCount).toBe(1);
      expect(reading.isComplete).toBe(true);
    });

    test("counts nothing for processes that exited before the helper reached them", async () => {
      /*
       * Renderers come and go as a script navigates and closes pages. One
       * that exits between the VmRSS snapshot and the helper's read holds
       * nothing, and counting it at its old VmRSS brought back the very
       * over-count this measurement exists to avoid.
       */
      mockHelperPresent(true);
      const exitedPids: Set<number> = new Set<number>([50_008, 50_009, 50_010]);
      mockHelper({ output: helperOutputFor(CUSTOMER_TREE, exitedPids) });

      const reading: ProportionalMemoryReading = await measure({
        readResidentBytes: residentReader(CUSTOMER_TREE, exitedPids),
      });

      const survivors: ChromiumProcessShape[] = CUSTOMER_TREE.filter(
        (shape: ChromiumProcessShape) => {
          return !exitedPids.has(shape.pid);
        },
      );
      expect(reading.observedBytes).toBe(sumOf(survivors, "proportionalBytes"));
      expect(reading.residentFallbackCount).toBe(0);
      expect(reading.isComplete).toBe(true);
    });

    test.each<[string, Error, RegExp]>([
      [
        "exits non-zero",
        Object.assign(new Error("exit 3"), { code: 3 }),
        /exited with code 3/,
      ],
      [
        "times out",
        Object.assign(new Error("timed out"), {
          killed: true,
          signal: "SIGKILL",
        }),
        /did not finish within 5000 ms/,
      ],
      [
        "floods its output",
        Object.assign(new Error("stdout maxBuffer length exceeded"), {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        }),
        /ERR_CHILD_PROCESS_STDIO_MAXBUFFER/,
      ],
      [
        "cannot be started",
        Object.assign(new Error("spawn EACCES"), { code: "EACCES" }),
        /EACCES/,
      ],
    ])(
      "is incomplete, counting every process at its VmRSS, when the helper %s",
      async (_description: string, error: Error, failure: RegExp) => {
        mockHelperPresent(true);
        mockHelper({ output: helperOutputFor(CUSTOMER_TREE), error });

        const reading: ProportionalMemoryReading = await measure();

        expect(reading.isComplete).toBe(false);
        expect(reading.failure).toMatch(failure);
        expect(reading.observedBytes).toBe(
          sumOf(CUSTOMER_TREE, "residentBytes"),
        );
        expect(reading.residentFallbackCount).toBe(CUSTOMER_TREE.length);
      },
    );

    test("is incomplete when the helper reports success with nothing read", async () => {
      /*
       * Node can kill an already-exited helper when the event loop stalls
       * past the timeout, and then report success with empty output.
       */
      mockHelperPresent(true);
      mockHelper({ output: "" });

      const reading: ProportionalMemoryReading = await measure();

      expect(reading.isComplete).toBe(false);
      expect(reading.failure).toContain("answered for fewer than the 12");
    });

    test("is incomplete when the helper answers for only some of the processes", async () => {
      mockHelperPresent(true);
      mockHelper({ output: helperOutputFor(CUSTOMER_TREE.slice(0, 5)) });

      const reading: ProportionalMemoryReading = await measure();

      expect(reading.isComplete).toBe(false);
      // What was read is still used; the rest count at their VmRSS.
      expect(reading.observedBytes).toBe(
        sumOf(CUSTOMER_TREE.slice(0, 5), "proportionalBytes") +
          sumOf(CUSTOMER_TREE.slice(5), "residentBytes"),
      );
    });

    test("is incomplete when starting the helper throws", async () => {
      mockHelperPresent(true);
      getExecFileMock().mockImplementation(() => {
        throw new Error("spawn failed synchronously");
      });

      const reading: ProportionalMemoryReading = await measure();

      expect(reading.isComplete).toBe(false);
      expect(reading.observedBytes).toBe(sumOf(CUSTOMER_TREE, "residentBytes"));
    });

    test("counts every process at its VmRSS, without trying, when the image has no helper", async () => {
      // Nothing changes by trying again, so this reading is complete.
      mockHelperPresent(false);
      const calls: ExecFileCall[] = mockHelper({
        output: helperOutputFor(CUSTOMER_TREE),
      });

      const reading: ProportionalMemoryReading = await measure();

      expect(reading).toEqual({
        observedBytes: sumOf(CUSTOMER_TREE, "residentBytes"),
        processCount: CUSTOMER_TREE.length,
        residentFallbackCount: CUSTOMER_TREE.length,
        proportionalBytesByPid: expect.any(Map),
        isComplete: true,
        failure: null,
      });
      expect(calls).toHaveLength(0);
    });

    test("counts every process at its VmRSS, without trying, for a tree larger than the helper accepts", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({ output: "" });
      const pids: number[] = Array.from(
        { length: PROCESS_MEMORY_HELPER_MAX_PIDS + 1 },
        (_value: unknown, index: number) => {
          return 100_000 + index;
        },
      );

      const reading: ProportionalMemoryReading = await measure({
        pids,
        readResidentBytes: (): number => {
          return MEGABYTE;
        },
      });

      expect(reading.observedBytes).toBe(
        (PROCESS_MEMORY_HELPER_MAX_PIDS + 1) * MEGABYTE,
      );
      expect(reading.isComplete).toBe(true);
      expect(calls).toHaveLength(0);
    });

    test("does not start the helper once the reading is abandoned", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({
        output: helperOutputFor(CUSTOMER_TREE),
      });
      const abandoned: AbortController = new AbortController();
      abandoned.abort();

      const reading: ProportionalMemoryReading = await measure({
        signal: abandoned.signal,
      });

      expect(reading.isComplete).toBe(false);
      expect(calls).toHaveLength(0);
    });

    test("hands the helper the abort signal and its timeout", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({ output: "" });
      const reading: AbortController = new AbortController();

      await measure({ signal: reading.signal, timeoutInMs: 1234 });

      expect(calls[0]?.options.signal).toBe(reading.signal);
      expect(calls[0]?.options.timeout).toBe(1234);
    });

    test("reports an abandoned reading as abandoned", async () => {
      mockHelperPresent(true);
      mockHelper({
        output: "",
        error: Object.assign(new Error("The operation was aborted"), {
          name: "AbortError",
          code: "ABORT_ERR",
        }),
      });

      const reading: ProportionalMemoryReading = await measure();

      expect(reading.isComplete).toBe(false);
      expect(reading.failure).toBe("the reading was abandoned");
    });

    test("uses an explicitly given helper path", async () => {
      const calls: ExecFileCall[] = mockHelper({ output: "" });

      await measure({ helperPath: __filename });

      expect(calls[0]?.file).toBe(__filename);
    });

    test("measures an empty tree as zero without starting the helper", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({ output: "" });

      const reading: ProportionalMemoryReading = await measure({ pids: [] });

      expect(reading).toEqual({
        observedBytes: 0,
        processCount: 0,
        residentFallbackCount: 0,
        proportionalBytesByPid: expect.any(Map),
        isComplete: true,
        failure: null,
      });
      expect(calls).toHaveLength(0);
    });
  });

  describe("measureProportionalBytes without a separate identity", () => {
    function mockSmapsRollups(
      contentsByPid: ReadonlyMap<number, string | Error>,
      options: { readonly neverAnswer?: ReadonlySet<number> } = {},
    ): string[] {
      const readPaths: string[] = [];
      jest.spyOn(fs.promises, "readFile").mockImplementation((async (
        filePath: fs.PathLike,
      ): Promise<string> => {
        const pathText: string = String(filePath);
        readPaths.push(pathText);
        const match: RegExpMatchArray | null = pathText.match(
          /^\/proc\/(\d+)\/smaps_rollup$/,
        );
        const pid: number = match ? Number(match[1]) : NaN;
        if (options.neverAnswer?.has(pid)) {
          return new Promise<string>(() => {});
        }
        const contents: string | Error | undefined = contentsByPid.get(pid);
        if (contents === undefined) {
          throw Object.assign(new Error(`ENOENT: ${pathText}`), {
            code: "ENOENT",
          });
        }
        if (contents instanceof Error) {
          throw contents;
        }
        return contents;
      }) as unknown as typeof fs.promises.readFile);
      return readPaths;
    }

    function rollupsFor(
      shapes: ReadonlyArray<ChromiumProcessShape>,
    ): Map<number, string> {
      return new Map<number, string>(
        shapes.map((shape: ChromiumProcessShape) => {
          return [
            shape.pid,
            smapsRollupFile({
              rssKb: shape.residentBytes / KILOBYTE,
              pssKb: shape.proportionalBytes / KILOBYTE,
            }),
          ];
        }),
      );
    }

    test("reads every process's smaps_rollup itself, one at a time, and never starts the helper", async () => {
      const calls: ExecFileCall[] = mockHelper({ output: "" });
      let concurrentReads: number = 0;
      let maximumConcurrentReads: number = 0;
      const readPaths: string[] = [];
      const rollups: Map<number, string> = rollupsFor(CUSTOMER_TREE);
      jest.spyOn(fs.promises, "readFile").mockImplementation((async (
        filePath: fs.PathLike,
      ): Promise<string> => {
        readPaths.push(String(filePath));
        concurrentReads++;
        maximumConcurrentReads = Math.max(
          maximumConcurrentReads,
          concurrentReads,
        );
        await new Promise<void>((resolve: () => void) => {
          global.setImmediate(resolve);
        });
        concurrentReads--;
        const pid: number = Number(String(filePath).split("/")[2]);
        return rollups.get(pid) as string;
      }) as unknown as typeof fs.promises.readFile);

      const reading: ProportionalMemoryReading =
        await ProcessTreeMemory.measureProportionalBytes({
          pids: pidsOf(CUSTOMER_TREE),
          identity: null,
          readResidentBytes: residentReader(CUSTOMER_TREE),
        });

      expect(reading.observedBytes).toBe(
        sumOf(CUSTOMER_TREE, "proportionalBytes"),
      );
      expect(reading.isComplete).toBe(true);
      expect(calls).toHaveLength(0);
      // The probe's DNS lookups share the same four libuv threads.
      expect(maximumConcurrentReads).toBe(1);
      expect(readPaths).toEqual(
        pidsOf(CUSTOMER_TREE).map((pid: number) => {
          return `/proc/${pid}/smaps_rollup`;
        }),
      );
    });

    test("counts a process it may not read at its current VmRSS, and one that exited at nothing", async () => {
      mockSmapsRollups(
        new Map<number, string | Error>([
          [1, smapsRollupFile({ rssKb: 100, pssKb: 40 })],
          [2, Object.assign(new Error("EACCES"), { code: "EACCES" })],
          [3, "not a rollup\n"],
        ]),
      );

      const reading: ProportionalMemoryReading =
        await ProcessTreeMemory.measureProportionalBytes({
          pids: [1, 2, 3, 4],
          identity: null,
          readResidentBytes: (pid: number): number | null => {
            // Process 4 has exited.
            return pid === 4 ? null : pid * 100 * KILOBYTE;
          },
        });

      expect(reading.observedBytes).toBe((40 + 200 + 300) * KILOBYTE);
      expect(reading.residentFallbackCount).toBe(2);
      expect(reading.isComplete).toBe(true);
    });

    test("is incomplete when the reads run out of time", async () => {
      mockSmapsRollups(rollupsFor(CUSTOMER_TREE), {
        neverAnswer: new Set<number>([50_005]),
      });

      const reading: ProportionalMemoryReading =
        await ProcessTreeMemory.measureProportionalBytes({
          pids: pidsOf(CUSTOMER_TREE),
          identity: null,
          timeoutInMs: 20,
          readResidentBytes: residentReader(CUSTOMER_TREE),
        });

      expect(reading.isComplete).toBe(false);
      expect(reading.failure).toContain("longer than 20 ms");
      expect(reading.observedBytes).toBe(sumOf(CUSTOMER_TREE, "residentBytes"));
    });
  });

  describe("getStartupWarning", () => {
    const missingHelperPath: string = "/nonexistent/synthetic-process-memory";

    test("warns a root supervisor on Linux that has no helper", () => {
      const warning: string | null = ProcessTreeMemory.getStartupWarning({
        platform: "linux",
        uid: 0,
        helperPath: missingHelperPath,
      });

      expect(warning).toContain(missingHelperPath);
      expect(warning).toContain("summed RSS");
    });

    test("names the image's helper path by default", () => {
      mockHelperPresent(false);

      expect(
        ProcessTreeMemory.getStartupWarning({ platform: "linux", uid: 0 }),
      ).toContain(PROCESS_MEMORY_HELPER_PATH);
    });

    test.each<[string, NodeJS.Platform, number | null, string]>([
      ["the helper is there", "linux", 0, __filename],
      [
        "the checks run as the supervisor, which reads their PSS itself",
        "linux",
        1000,
        missingHelperPath,
      ],
      [
        "the host has no /proc to read PSS from",
        "darwin",
        0,
        missingHelperPath,
      ],
      ["the process has no uid", "linux", null, missingHelperPath],
    ])(
      "says nothing when %s",
      (
        _description: string,
        platform: NodeJS.Platform,
        uid: number | null,
        helperPath: string,
      ) => {
        expect(
          ProcessTreeMemory.getStartupWarning({ platform, uid, helperPath }),
        ).toBeNull();
      },
    );
  });

  const linuxOnly: jest.It = process.platform === "linux" ? test : test.skip;

  linuxOnly(
    "measures a real process by PSS no larger than its VmRSS",
    async () => {
      const residentBytes: number | null =
        ProcessTreeMemory.parseStatusResidentBytes(
          await fs.promises.readFile(`/proc/${process.pid}/status`, "utf8"),
        );
      expect(residentBytes).not.toBeNull();

      const reading: ProportionalMemoryReading =
        await ProcessTreeMemory.measureProportionalBytes({
          pids: [process.pid],
          identity: null,
        });
      const observedBytes: number = reading.observedBytes;
      expect(reading.isComplete).toBe(true);
      expect(reading.residentFallbackCount).toBe(0);

      expect(observedBytes).toBeGreaterThan(0);
      // Allow for the heap growing between the two reads.
      expect(observedBytes).toBeLessThanOrEqual(
        (residentBytes as number) + 64 * MEGABYTE,
      );
      const directlyRead: number | null =
        ProcessTreeMemory.parseSmapsRollupProportionalBytes(
          await fs.promises.readFile(
            `/proc/${process.pid}/smaps_rollup`,
            "utf8",
          ),
        );
      expect(directlyRead).not.toBeNull();
    },
  );
});
