import {
  ChildProcess,
  SpawnSyncReturns,
  spawn,
  spawnSync,
} from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ProcessTreeMemory, {
  PROCESS_MEMORY_HELPER_MAX_PIDS,
} from "../../../../Utils/Monitors/SyntheticRuntime/ProcessTreeMemory";

/*
 * The process-memory helper against a real kernel.
 *
 * The synthetic memory watchdog holds a check to its PSS, which it reads
 * through Native/synthetic-process-memory.c because the root supervisor may
 * not open a check's smaps_rollup itself. ProcessTreeMemory.test.ts pins what
 * the TypeScript does with the helper's answers against a fake, and
 * Tests/Build/ProbeProcessMemoryHelper.test.ts pins the image step and the
 * source. Neither can see a helper that misparses a real smaps_rollup, prints
 * something ProcessTreeMemory does not read, or reads what it should not.
 * This test compiles the source with the image's flags and runs it.
 *
 * Run as root -- as the probe does in its image -- it measures processes
 * running under a sandbox uid, which root without CAP_SYS_PTRACE cannot read
 * directly. Run as any other user -- as CI does -- it measures the user's own
 * processes, and checks it cannot take on anyone else's identity.
 */

const HELPER_SOURCE_PATH: string = path.resolve(
  __dirname,
  "../../../../Utils/Monitors/SyntheticRuntime/Native/synthetic-process-memory.c",
);

// The flags of the Dockerfile.tpl step, which ProbeProcessMemoryHelper.test.ts pins.
const GCC_ARGUMENTS: string[] = ["-O2", "-Wall", "-Wextra", "-Werror"];

// A process that makes its memory unreadable to everyone without CAP_SYS_PTRACE.
const NON_DUMPABLE_SOURCE: string = `
#include <sys/prctl.h>
#include <unistd.h>

int main(void) {
  if (prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0) {
    return 1;
  }
  if (write(1, "ready\\n", 6) != 6) {
    return 1;
  }
  pause();
  return 0;
}
`;

// The identity root measures, as the probe measures a check's.
const SANDBOX_IDENTITY: number = 20_001;

const COMPILE_TIMEOUT_IN_MS: number = 60_000;
const HELPER_TIMEOUT_IN_MS: number = 10_000;
const KILOBYTE: number = 1024;

function findExecutableOnPath(name: string): string | null {
  const directories: string[] = [
    ...(process.env["PATH"] || "").split(path.delimiter),
    "/usr/bin",
    "/bin",
  ];

  for (const directory of directories) {
    if (!directory) {
      continue;
    }
    const candidate: string = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }

  return null;
}

function isCi(): boolean {
  const value: string = (process.env["CI"] || "").trim().toLowerCase();
  return value !== "" && value !== "false" && value !== "0";
}

const GCC_PATH: string | null = findExecutableOnPath("gcc");
const SLEEP_PATH: string | null = findExecutableOnPath("sleep");

function getUnavailableReason(): string | null {
  if (process.platform !== "linux") {
    return `smaps_rollup and setresuid are Linux-only and this is ${process.platform}`;
  }
  if (!GCC_PATH) {
    return "gcc is not installed";
  }
  if (!SLEEP_PATH) {
    return "sleep is not installed";
  }
  return null;
}

const UNAVAILABLE_REASON: string | null = getUnavailableReason();
const IS_ROOT: boolean =
  typeof process.getuid === "function" && process.getuid() === 0;

describe("Process-memory helper tooling", () => {
  test("has gcc on Linux, or says why the real-kernel helper test is skipped", () => {
    if (UNAVAILABLE_REASON === null) {
      return;
    }

    /*
     * Locally a missing tool skips the suite below, with the reason in its
     * title. On CI it must not: a regression guard that quietly skips is no
     * guard.
     */
    if (isCi()) {
      throw new Error(
        `The real-kernel process-memory helper test needs Linux and gcc and must not be skipped on CI: ${UNAVAILABLE_REASON}. Install gcc on the runner (see .github/workflows/test.probe.yaml).`,
      );
    }
  });
});

const describeWithTools: jest.Describe =
  UNAVAILABLE_REASON === null ? describe : describe.skip;

describeWithTools(
  UNAVAILABLE_REASON === null
    ? "Process-memory helper on this kernel"
    : `Process-memory helper on this kernel (skipped: ${UNAVAILABLE_REASON})`,
  () => {
    let workDirectory: string;
    let helperPath: string;
    let nonDumpablePath: string;
    const startedProcesses: ChildProcess[] = [];

    // Root measures a sandbox identity; anyone else measures their own.
    const identity: { uid: number; gid: number } = IS_ROOT
      ? { uid: SANDBOX_IDENTITY, gid: SANDBOX_IDENTITY }
      : {
          uid: (process.getuid as () => number)(),
          gid: (process.getgid as () => number)(),
        };

    function compile(sourcePath: string, outputPath: string): void {
      const result: SpawnSyncReturns<string> = spawnSync(
        GCC_PATH as string,
        [...GCC_ARGUMENTS, "-o", outputPath, sourcePath],
        { encoding: "utf8", timeout: COMPILE_TIMEOUT_IN_MS },
      );
      if (result.status !== 0) {
        throw new Error(
          `gcc failed (exit ${result.status}): ${result.stderr || result.error?.message}`,
        );
      }
    }

    function runHelper(args: string[]): SpawnSyncReturns<string> {
      return spawnSync(helperPath, args, {
        encoding: "utf8",
        timeout: HELPER_TIMEOUT_IN_MS,
        env: {},
      });
    }

    function identityArguments(): string[] {
      return [String(identity.uid), String(identity.gid)];
    }

    async function startUnderIdentity(
      executable: string,
      args: string[],
      readyOutput?: string,
    ): Promise<number> {
      const started: ChildProcess = spawn(executable, args, {
        stdio: ["ignore", "pipe", "ignore"],
        ...(IS_ROOT ? { uid: identity.uid, gid: identity.gid } : {}),
      });
      startedProcesses.push(started);

      await new Promise<void>(
        (resolve: () => void, reject: (error: Error) => void): void => {
          let output: string = "";
          const onData: (chunk: Buffer) => void = (chunk: Buffer): void => {
            output += chunk.toString("utf8");
            if (readyOutput === undefined || output.includes(readyOutput)) {
              started.stdout?.removeListener("data", onData);
              resolve();
            }
          };
          started.once("error", reject);
          started.once("exit", (code: number | null) => {
            reject(new Error(`${executable} exited early (code ${code}).`));
          });
          if (readyOutput === undefined) {
            global.setImmediate(resolve);
            return;
          }
          started.stdout?.on("data", onData);
        },
      );

      const pid: number = started.pid as number;
      // Wait for exec, so what is measured is the program and not a forked Node.
      const programName: string = path.basename(executable);
      for (let attempt: number = 0; attempt < 200; attempt++) {
        const commandLine: string = fs
          .readFileSync(`/proc/${pid}/cmdline`, "utf8")
          .split("\0")[0] as string;
        if (path.basename(commandLine) === programName) {
          return pid;
        }
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 10);
        });
      }
      throw new Error(`${executable} never started.`);
    }

    function findUnusedPid(): number {
      const pidMax: number = Number(
        fs.readFileSync("/proc/sys/kernel/pid_max", "utf8").trim(),
      );
      for (let pid: number = pidMax - 1; pid > 1; pid--) {
        if (!fs.existsSync(`/proc/${pid}`)) {
          return pid;
        }
      }
      throw new Error("Every pid is in use.");
    }

    function readProportionalKbDirectly(pid: number): number | null {
      try {
        const bytes: number | null =
          ProcessTreeMemory.parseSmapsRollupProportionalBytes(
            fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"),
          );
        return bytes === null ? null : bytes / KILOBYTE;
      } catch {
        return null;
      }
    }

    beforeAll(() => {
      workDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "oneuptime-process-memory-helper-"),
      );
      helperPath = path.join(workDirectory, "synthetic-process-memory");
      compile(HELPER_SOURCE_PATH, helperPath);

      const nonDumpableSourcePath: string = path.join(
        workDirectory,
        "non-dumpable.c",
      );
      fs.writeFileSync(nonDumpableSourcePath, NON_DUMPABLE_SOURCE);
      nonDumpablePath = path.join(workDirectory, "non-dumpable");
      compile(nonDumpableSourcePath, nonDumpablePath);
      // A sandbox uid runs it when root runs the test.
      fs.chmodSync(workDirectory, 0o755);
      fs.chmodSync(nonDumpablePath, 0o755);
    });

    afterEach(() => {
      for (const started of startedProcesses.splice(0)) {
        started.kill("SIGKILL");
      }
    });

    afterAll(() => {
      fs.rmSync(workDirectory, { recursive: true, force: true });
    });

    test("prints its usage and exits 2 when given nothing to measure", () => {
      for (const args of [[], ["20001"], ["20001", "20001"]]) {
        const result: SpawnSyncReturns<string> = runHelper(args);

        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("usage:");
      }
    });

    test.each<[string, string[]]>([
      ["a uid of 0", ["0", "20001", "1"]],
      ["a gid of 0", ["20001", "0", "1"]],
      ["a uid that is not a number", ["root", "20001", "1"]],
      ["a signed uid", ["+20001", "20001", "1"]],
      ["a uid beyond 32 bits", ["4294967296", "20001", "1"]],
      ["a pid with trailing text", ["20001", "20001", "12x"]],
      ["a signed pid", ["20001", "20001", "+5"]],
      ["a negative pid", ["20001", "20001", "-5"]],
      ["a pid with a leading space", ["20001", "20001", " 5"]],
      ["a pid with a trailing space", ["20001", "20001", "5 "]],
      ["an empty pid", ["20001", "20001", ""]],
      ["a pid of 0", ["20001", "20001", "0"]],
      ["a pid beyond the kernel's range", ["20001", "20001", "1073741824"]],
      ["a path instead of a pid", ["20001", "20001", "../1"]],
    ])(
      "rejects %s before measuring anything",
      (_description: string, args: string[]) => {
        const result: SpawnSyncReturns<string> = runHelper(args);

        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
      },
    );

    test("rejects more pids than ProcessTreeMemory ever sends", () => {
      const pids: string[] = Array.from(
        { length: PROCESS_MEMORY_HELPER_MAX_PIDS + 1 },
        (_value: unknown, index: number) => {
          return String(index + 2);
        },
      );

      expect(runHelper([...identityArguments(), ...pids]).status).toBe(2);
      expect(
        runHelper([
          ...identityArguments(),
          ...pids.slice(0, PROCESS_MEMORY_HELPER_MAX_PIDS),
        ]).status,
      ).toBe(0);
    });

    test("reports each process's PSS in the order asked, and '-' for one that does not exist", async () => {
      const firstPid: number = await startUnderIdentity(SLEEP_PATH as string, [
        "60",
      ]);
      const secondPid: number = await startUnderIdentity(SLEEP_PATH as string, [
        "60",
      ]);
      const missingPid: number = findUnusedPid();

      const result: SpawnSyncReturns<string> = runHelper([
        ...identityArguments(),
        String(secondPid),
        String(missingPid),
        String(firstPid),
      ]);

      expect(result.status).toBe(0);
      const lines: string[] = result.stdout.trimEnd().split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatch(new RegExp(`^${secondPid} [1-9]\\d*$`));
      expect(lines[1]).toBe(`${missingPid} -`);
      expect(lines[2]).toMatch(new RegExp(`^${firstPid} [1-9]\\d*$`));
    });

    test("reads the same PSS the kernel shows a reader allowed to see it", async () => {
      const pid: number = await startUnderIdentity(SLEEP_PATH as string, [
        "60",
      ]);

      const result: SpawnSyncReturns<string> = runHelper([
        ...identityArguments(),
        String(pid),
      ]);
      const reportedKb: number = Number(result.stdout.trim().split(" ")[1]);

      expect(result.status).toBe(0);
      expect(reportedKb).toBeGreaterThan(0);

      const directKb: number | null = readProportionalKbDirectly(pid);
      if (directKb !== null) {
        /*
         * A sleeping process's PSS moves only when another process maps or
         * unmaps a library page it shares.
         */
        expect(Math.abs(reportedKb - directKb)).toBeLessThanOrEqual(1024);
      }
    });

    test("reports '-' for a process that made itself non-dumpable", async () => {
      const pid: number = await startUnderIdentity(
        nonDumpablePath,
        [],
        "ready",
      );

      const result: SpawnSyncReturns<string> = runHelper([
        ...identityArguments(),
        String(pid),
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`${pid} -\n`);
    });

    test("hands ProcessTreeMemory what it reads, and a hidden process counts at its VmRSS", async () => {
      const readablePid: number = await startUnderIdentity(
        SLEEP_PATH as string,
        ["60"],
      );
      const hiddenPid: number = await startUnderIdentity(
        nonDumpablePath,
        [],
        "ready",
      );
      const hiddenResidentBytes: number = 777 * KILOBYTE;

      const observedBytes: number =
        await ProcessTreeMemory.measureProportionalBytes({
          processes: [
            { pid: readablePid, residentBytes: 999_999 * KILOBYTE },
            { pid: hiddenPid, residentBytes: hiddenResidentBytes },
          ],
          identity,
          helperPath,
        });

      const helperOutput: string = runHelper([
        ...identityArguments(),
        String(readablePid),
      ]).stdout;
      const readableKb: number = Number(helperOutput.trim().split(" ")[1]);
      expect(readableKb).toBeGreaterThan(0);
      expect(
        Math.abs(observedBytes - (readableKb * KILOBYTE + hiddenResidentBytes)),
      ).toBeLessThanOrEqual(1024 * KILOBYTE);
      // Nowhere near the VmRSS it was given for the readable process.
      expect(observedBytes).toBeLessThan(999_999 * KILOBYTE);
    });

    (IS_ROOT ? test : test.skip)(
      "as root, reads a sandbox uid's process that root itself may not open",
      async () => {
        const pid: number = await startUnderIdentity(SLEEP_PATH as string, [
          "60",
        ]);
        const effectiveCapabilities: string =
          fs
            .readFileSync("/proc/self/status", "utf8")
            .match(/^CapEff:\s+([0-9a-f]+)$/m)?.[1] || "0";
        // CAP_SYS_PTRACE is bit 19, in the low 32 bits of the mask.
        const canPtraceAnyone: boolean =
          (Number.parseInt(effectiveCapabilities.slice(-8), 16) & (1 << 19)) !==
          0;

        if (!canPtraceAnyone) {
          // The probe's own situation: root without CAP_SYS_PTRACE.
          expect(() => {
            fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
          }).toThrow(/EACCES|EPERM/);
        }

        const result: SpawnSyncReturns<string> = runHelper([
          ...identityArguments(),
          String(pid),
        ]);

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(new RegExp(`^${pid} [1-9]\\d*\\n$`));
      },
    );

    (IS_ROOT ? test : test.skip)(
      "as root, reports '-' for a process of another sandbox uid",
      async () => {
        const pid: number = await startUnderIdentity(SLEEP_PATH as string, [
          "60",
        ]);

        const result: SpawnSyncReturns<string> = runHelper([
          String(identity.uid + 1),
          String(identity.gid + 1),
          String(pid),
        ]);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`${pid} -\n`);
      },
    );

    (IS_ROOT ? test.skip : test)(
      "without CAP_SETUID, refuses an identity it cannot take on",
      async () => {
        const pid: number = await startUnderIdentity(SLEEP_PATH as string, [
          "60",
        ]);

        const result: SpawnSyncReturns<string> = runHelper([
          String(identity.uid + 1),
          String(identity.gid),
          String(pid),
        ]);

        expect(result.status).toBe(3);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(
          "could not switch the effective identity",
        );
      },
    );
  },
);
