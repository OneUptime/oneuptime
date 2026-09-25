import * as childProcess from "child_process";
import { ExecFileOptions } from "child_process";
import fs from "fs";
import ProcessTreeMemory, {
  PROCESS_MEMORY_HELPER_MAX_PIDS,
  PROCESS_MEMORY_HELPER_PATH,
  PROCESS_MEMORY_HELPER_TIMEOUT_IN_MS,
  ResidentProcessMemory,
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

function residentProcesses(
  shapes: ReadonlyArray<ChromiumProcessShape>,
): ResidentProcessMemory[] {
  return shapes.map((shape: ChromiumProcessShape) => {
    return { pid: shape.pid, residentBytes: shape.residentBytes };
  });
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
    test("maps each readable pid to its PSS in bytes and leaves unreadable ones out", () => {
      const parsed: Map<number, number> = ProcessTreeMemory.parseHelperOutput({
        output: "101 2048\n102 -\n103 0\n",
        requestedPids: new Set<number>([101, 102, 103]),
      });

      expect([...parsed.entries()]).toEqual([
        [101, 2048 * KILOBYTE],
        [103, 0],
      ]);
    });

    test("ignores a pid that was not asked about", () => {
      const parsed: Map<number, number> = ProcessTreeMemory.parseHelperOutput({
        output: "101 2048\n999 1\n",
        requestedPids: new Set<number>([101]),
      });

      expect([...parsed.keys()]).toEqual([101]);
    });

    test("drops a pid reported twice rather than choosing between the answers", () => {
      const parsed: Map<number, number> = ProcessTreeMemory.parseHelperOutput({
        output: "101 1\n101 2048\n101 4\n102 8\n",
        requestedPids: new Set<number>([101, 102]),
      });

      expect([...parsed.entries()]).toEqual([[102, 8 * KILOBYTE]]);
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
    ])("ignores a line with %s", (_description: string, line: string) => {
      const parsed: Map<number, number> = ProcessTreeMemory.parseHelperOutput({
        output: `${line}\n`,
        requestedPids: new Set<number>([101]),
      });

      expect(parsed.size).toBe(0);
    });

    test("leaves out a value too large to add up safely", () => {
      const parsed: Map<number, number> = ProcessTreeMemory.parseHelperOutput({
        output: "101 999999999999999\n",
        requestedPids: new Set<number>([101]),
      });

      expect(parsed.size).toBe(0);
    });

    test("returns nothing for no output", () => {
      expect(
        ProcessTreeMemory.parseHelperOutput({
          output: "",
          requestedPids: new Set<number>([101]),
        }).size,
      ).toBe(0);
    });
  });

  describe("sumProportionalBytes", () => {
    test("counts each process at its PSS where it was read and at its VmRSS where not", () => {
      expect(
        ProcessTreeMemory.sumProportionalBytes({
          processes: [
            { pid: 1, residentBytes: 100 },
            { pid: 2, residentBytes: 200 },
            { pid: 3, residentBytes: 300 },
          ],
          proportionalBytesByPid: new Map<number, number>([
            [1, 40],
            [3, 90],
          ]),
        }),
      ).toBe(40 + 200 + 90);
    });

    test("uses a PSS reading that is newer and larger than the VmRSS reading", () => {
      // The tree kept growing between the two reads.
      expect(
        ProcessTreeMemory.sumProportionalBytes({
          processes: [{ pid: 1, residentBytes: 100 }],
          proportionalBytesByPid: new Map<number, number>([[1, 150]]),
        }),
      ).toBe(150);
    });

    test("adds nothing for a process with neither reading", () => {
      expect(
        ProcessTreeMemory.sumProportionalBytes({
          processes: [
            { pid: 1, residentBytes: null },
            { pid: 2, residentBytes: 200 },
          ],
          proportionalBytesByPid: new Map<number, number>(),
        }),
      ).toBe(200);
    });

    test("saturates instead of overflowing", () => {
      expect(
        ProcessTreeMemory.sumProportionalBytes({
          processes: [
            { pid: 1, residentBytes: Number.MAX_SAFE_INTEGER },
            { pid: 2, residentBytes: 4096 },
          ],
          proportionalBytesByPid: new Map<number, number>(),
        }),
      ).toBe(Number.MAX_SAFE_INTEGER);
    });

    test("is zero for an empty tree", () => {
      expect(
        ProcessTreeMemory.sumProportionalBytes({
          processes: [],
          proportionalBytesByPid: new Map<number, number>(),
        }),
      ).toBe(0);
    });
  });

  describe("measureProportionalBytes through the helper", () => {
    const identity: { uid: number; gid: number } = { uid: 20_001, gid: 20_002 };

    test("asks the helper for the check's identity and every pid, and sums the PSS it reports", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({
        output: helperOutputFor(CUSTOMER_TREE),
      });

      const observedBytes: number =
        await ProcessTreeMemory.measureProportionalBytes({
          processes: residentProcesses(CUSTOMER_TREE),
          identity,
        });

      expect(observedBytes).toBe(sumOf(CUSTOMER_TREE, "proportionalBytes"));
      expect(observedBytes).toBeLessThan(DEFAULT_LIMIT_BYTES);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.file).toBe(PROCESS_MEMORY_HELPER_PATH);
      expect(calls[0]?.args).toEqual([
        "20001",
        "20002",
        ...CUSTOMER_TREE.map((shape: ChromiumProcessShape) => {
          return String(shape.pid);
        }),
      ]);
    });

    test("runs the helper bounded in time and output, with an empty environment", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({ output: "" });

      await ProcessTreeMemory.measureProportionalBytes({
        processes: residentProcesses(CUSTOMER_TREE),
        identity,
      });

      expect(calls[0]?.options).toEqual(
        expect.objectContaining({
          env: {},
          timeout: PROCESS_MEMORY_HELPER_TIMEOUT_IN_MS,
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

      const observedBytes: number =
        await ProcessTreeMemory.measureProportionalBytes({
          processes: [
            { pid: 7, residentBytes: 10 * KILOBYTE },
            { pid: 7, residentBytes: 10 * KILOBYTE },
          ],
          identity,
        });

      expect(calls[0]?.args).toEqual(["20001", "20002", "7"]);
      // The duplicate record still counts; the tree snapshot never has one.
      expect(observedBytes).toBe(8 * KILOBYTE);
    });

    test("counts a process the helper could not read at its VmRSS", async () => {
      mockHelperPresent(true);
      const hiddenPid: number = 50_008;
      mockHelper({
        output: helperOutputFor(CUSTOMER_TREE, new Set<number>([hiddenPid])),
      });

      const observedBytes: number =
        await ProcessTreeMemory.measureProportionalBytes({
          processes: residentProcesses(CUSTOMER_TREE),
          identity,
        });

      const hidden: ChromiumProcessShape = CUSTOMER_TREE.find(
        (shape: ChromiumProcessShape) => {
          return shape.pid === hiddenPid;
        },
      ) as ChromiumProcessShape;
      expect(observedBytes).toBe(
        sumOf(CUSTOMER_TREE, "proportionalBytes") -
          hidden.proportionalBytes +
          hidden.residentBytes,
      );
    });

    test("counts a process the helper left out entirely at its VmRSS", async () => {
      mockHelperPresent(true);
      mockHelper({ output: helperOutputFor(CUSTOMER_TREE.slice(1)) });

      const observedBytes: number =
        await ProcessTreeMemory.measureProportionalBytes({
          processes: residentProcesses(CUSTOMER_TREE),
          identity,
        });

      expect(observedBytes).toBe(
        sumOf(CUSTOMER_TREE.slice(1), "proportionalBytes") +
          (CUSTOMER_TREE[0] as ChromiumProcessShape).residentBytes,
      );
    });

    test.each<[string, Error]>([
      ["exits non-zero", Object.assign(new Error("exit 3"), { code: 3 })],
      [
        "times out",
        Object.assign(new Error("timed out"), {
          killed: true,
          signal: "SIGKILL",
        }),
      ],
      [
        "floods its output",
        Object.assign(new Error("stdout maxBuffer length exceeded"), {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        }),
      ],
      [
        "cannot be started",
        Object.assign(new Error("spawn EACCES"), { code: "EACCES" }),
      ],
    ])(
      "falls back to summed VmRSS when the helper %s",
      async (_description: string, error: Error) => {
        mockHelperPresent(true);
        mockHelper({ output: helperOutputFor(CUSTOMER_TREE), error });

        await expect(
          ProcessTreeMemory.measureProportionalBytes({
            processes: residentProcesses(CUSTOMER_TREE),
            identity,
          }),
        ).resolves.toBe(sumOf(CUSTOMER_TREE, "residentBytes"));
      },
    );

    test("falls back to summed VmRSS when starting the helper throws", async () => {
      mockHelperPresent(true);
      getExecFileMock().mockImplementation(() => {
        throw new Error("spawn failed synchronously");
      });

      await expect(
        ProcessTreeMemory.measureProportionalBytes({
          processes: residentProcesses(CUSTOMER_TREE),
          identity,
        }),
      ).resolves.toBe(sumOf(CUSTOMER_TREE, "residentBytes"));
    });

    test("falls back to summed VmRSS, without trying, when the image has no helper", async () => {
      mockHelperPresent(false);
      const calls: ExecFileCall[] = mockHelper({
        output: helperOutputFor(CUSTOMER_TREE),
      });

      await expect(
        ProcessTreeMemory.measureProportionalBytes({
          processes: residentProcesses(CUSTOMER_TREE),
          identity,
        }),
      ).resolves.toBe(sumOf(CUSTOMER_TREE, "residentBytes"));
      expect(calls).toHaveLength(0);
    });

    test("falls back to summed VmRSS, without trying, for a tree larger than the helper accepts", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({ output: "" });
      const processes: ResidentProcessMemory[] = Array.from(
        { length: PROCESS_MEMORY_HELPER_MAX_PIDS + 1 },
        (_value: unknown, index: number) => {
          return { pid: 100_000 + index, residentBytes: MEGABYTE };
        },
      );

      await expect(
        ProcessTreeMemory.measureProportionalBytes({ processes, identity }),
      ).resolves.toBe((PROCESS_MEMORY_HELPER_MAX_PIDS + 1) * MEGABYTE);
      expect(calls).toHaveLength(0);
    });

    test("does not start the helper once the measurement is abandoned", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({
        output: helperOutputFor(CUSTOMER_TREE),
      });
      const abandoned: AbortController = new AbortController();
      abandoned.abort();

      await expect(
        ProcessTreeMemory.measureProportionalBytes({
          processes: residentProcesses(CUSTOMER_TREE),
          identity,
          signal: abandoned.signal,
        }),
      ).resolves.toBe(sumOf(CUSTOMER_TREE, "residentBytes"));
      expect(calls).toHaveLength(0);
    });

    test("hands the helper the abort signal, so an abandoned measurement stops it", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({ output: "" });
      const measurement: AbortController = new AbortController();

      await ProcessTreeMemory.measureProportionalBytes({
        processes: residentProcesses(CUSTOMER_TREE),
        identity,
        signal: measurement.signal,
      });

      expect(calls[0]?.options.signal).toBe(measurement.signal);
    });

    test("uses an explicitly given helper path", async () => {
      const calls: ExecFileCall[] = mockHelper({ output: "" });

      await ProcessTreeMemory.measureProportionalBytes({
        processes: residentProcesses(CUSTOMER_TREE),
        identity,
        helperPath: __filename,
      });

      expect(calls[0]?.file).toBe(__filename);
    });

    test("measures an empty tree as zero without starting the helper", async () => {
      mockHelperPresent(true);
      const calls: ExecFileCall[] = mockHelper({ output: "" });

      await expect(
        ProcessTreeMemory.measureProportionalBytes({ processes: [], identity }),
      ).resolves.toBe(0);
      expect(calls).toHaveLength(0);
    });
  });

  describe("measureProportionalBytes without a separate identity", () => {
    function mockSmapsRollups(
      contentsByPid: ReadonlyMap<number, string | Error>,
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
        const contents: string | Error | undefined = match
          ? contentsByPid.get(Number(match[1]))
          : undefined;
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

    test("reads every process's smaps_rollup itself and never starts the helper", async () => {
      const calls: ExecFileCall[] = mockHelper({ output: "" });
      const readPaths: string[] = mockSmapsRollups(
        new Map<number, string>(
          CUSTOMER_TREE.map((shape: ChromiumProcessShape) => {
            return [
              shape.pid,
              smapsRollupFile({
                rssKb: shape.residentBytes / KILOBYTE,
                pssKb: shape.proportionalBytes / KILOBYTE,
              }),
            ];
          }),
        ),
      );

      await expect(
        ProcessTreeMemory.measureProportionalBytes({
          processes: residentProcesses(CUSTOMER_TREE),
          identity: null,
        }),
      ).resolves.toBe(sumOf(CUSTOMER_TREE, "proportionalBytes"));
      expect(calls).toHaveLength(0);
      expect(readPaths.sort()).toEqual(
        CUSTOMER_TREE.map((shape: ChromiumProcessShape) => {
          return `/proc/${shape.pid}/smaps_rollup`;
        }).sort(),
      );
    });

    test("counts a process it may not read, or that exited, at its VmRSS", async () => {
      mockSmapsRollups(
        new Map<number, string | Error>([
          [1, smapsRollupFile({ rssKb: 100, pssKb: 40 })],
          [
            2,
            Object.assign(new Error("EACCES"), {
              code: "EACCES",
            }),
          ],
          [3, "not a rollup\n"],
        ]),
      );

      await expect(
        ProcessTreeMemory.measureProportionalBytes({
          processes: [
            { pid: 1, residentBytes: 100 * KILOBYTE },
            { pid: 2, residentBytes: 200 * KILOBYTE },
            { pid: 3, residentBytes: 300 * KILOBYTE },
            { pid: 4, residentBytes: 400 * KILOBYTE },
          ],
          identity: null,
        }),
      ).resolves.toBe((40 + 200 + 300 + 400) * KILOBYTE);
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

      const observedBytes: number =
        await ProcessTreeMemory.measureProportionalBytes({
          processes: [{ pid: process.pid, residentBytes }],
          identity: null,
        });

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
