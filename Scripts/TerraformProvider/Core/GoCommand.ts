import { ChildProcess, ExecException, exec } from "child_process";
import fs from "fs";
import path from "path";

/*
 * How the generators run Go: with a soft memory limit, and a report of the
 * memory each command took.
 *
 * The provider's generated resources and data sources used to be one Go
 * package, internal/provider, some 1,000 files and 64 MB of Go, and
 * compiling it took more memory than anything else CI does. Go's default
 * garbage collection lets the heap grow to twice what is live, and the
 * compiler peaked at about 15 GB, for `go build` and for the test binary
 * `go test` builds alike, while the Node.js process that runs the generator
 * held another 1.5 GB: more than the 16 GB of a GitHub-hosted runner, which
 * stopped answering, and GitHub marked the job lost (#7559). They are split
 * into packages of a few dozen files now (Core/ProviderShards.ts, #7591),
 * and a compile of one holds under 1 GiB: Go compiles four at a time, and
 * the build held 1.7 GiB at most.
 *
 * GOMEMLIMIT stays, as the guard rail it was: as Go's memory nears it, Go
 * collects garbage more often instead of letting the heap double. It does
 * nothing to a compile far below it, and it changes how Go manages its
 * memory, not what it builds: the provider is byte for byte the same. With
 * the one package, 10 GiB was about what the compiler held live, so it
 * peaked at about 11 GB instead of 15; a lower limit bought nothing, as what
 * is live cannot be collected.
 *
 * A caller's own GOMEMLIMIT wins ("off" turns the limit off). The workflows
 * that compile the provider set this value for their own Go steps, and
 * publish-terraform-provider.sh for the Go it runs:
 * Tests/Ops/TerraformProviderGoMemoryLimit.test.js holds them to it.
 */
export const GO_MEMORY_LIMIT: string = "10GiB";

/*
 * What a compile holds grows with the provider: as one package, the compiler
 * peaked at 10.6 GiB on 2026-11-13 and 11.3 GiB a week later, above the
 * limit.
 * So runGoCommand reports the most each Go command took, and when that, with
 * the generator's own Node.js, is above this, it is a warning in the CI run:
 * a 16 GB runner then has under 3 GB left for the system and the runner
 * itself. checkShardSizes (Core/ProviderShards.ts) stops a shard from
 * growing that far long before.
 */
export const GO_MEMORY_WARNING_BYTES: number = 13 * 1024 ** 3;

// How often the memory of a Go command's processes is read.
const SAMPLE_INTERVAL_MS: number = 1000;

const PROC: string = "/proc";

// A process's folder in /proc is its pid.
const PROCESS_FOLDER: RegExp = /^\d+$/;

// `environment` with Go's memory limit, unless it sets one of its own.
export function goEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    GOMEMLIMIT: environment["GOMEMLIMIT"] || GO_MEMORY_LIMIT,
  };
}

// The most a Go command took, read from /proc while it ran.
export interface GoMemoryPeak {
  /*
   * The most its processes and this Node.js process held at once: what the
   * machine had to find room for.
   */
  totalBytes: number;
  // Its process that held the most, by name, and the most it held.
  largestProcess: string;
  largestBytes: number;
}

export interface GoCommandResult {
  stdout: string;
  stderr: string;
  // Null where there is no /proc to read it from, as on macOS.
  memory: GoMemoryPeak | null;
}

export interface GoCommandOptions {
  // Where the line on the command's memory goes; standard output by default.
  report?: (line: string) => void;
  // Above how many bytes that line is a warning (GO_MEMORY_WARNING_BYTES).
  warnAboveBytes?: number;
}

// One process's memory, from its /proc/<pid>/status.
export interface ProcessMemory {
  name: string;
  // VmRSS: what it holds now.
  residentBytes: number;
  // VmHWM: the most it has held, kept by the kernel.
  peakBytes: number;
}

// Reads /proc/<pid>/status. Null for a process without memory (a zombie).
export function parseProcessStatus(status: string): ProcessMemory | null {
  const field: (name: string) => string | undefined = (
    name: string,
  ): string | undefined => {
    const match: RegExpMatchArray | null = status.match(
      new RegExp(`^${name}:\\s*(.*)$`, "m"),
    );
    return match ? match[1]!.trim() : undefined;
  };
  const kibibytes: (name: string) => number | null = (
    name: string,
  ): number | null => {
    const match: RegExpMatchArray | null = (field(name) || "").match(
      /^(\d+) kB$/,
    );
    return match ? Number(match[1]) * 1024 : null;
  };

  const residentBytes: number | null = kibibytes("VmRSS");
  if (residentBytes === null) {
    return null;
  }

  return {
    name: field("Name") || "",
    residentBytes,
    peakBytes: Math.max(kibibytes("VmHWM") ?? 0, residentBytes),
  };
}

/*
 * `root` and every process under it, by pid, read from <proc>/<pid>/stat.
 * Empty when `root` is gone.
 */
export function processTree(root: number, proc: string = PROC): Array<number> {
  const children: Map<number, Array<number>> = new Map();
  let found: boolean = false;

  for (const entry of fs.readdirSync(proc)) {
    if (!PROCESS_FOLDER.test(entry)) {
      continue;
    }

    let stat: string;
    try {
      stat = fs.readFileSync(path.join(proc, entry, "stat"), "utf-8");
    } catch {
      // It ended while the folder was read.
      continue;
    }

    // "<pid> (<name>) <state> <ppid> ...": the name can hold spaces and ")".
    const fields: Array<string> = stat
      .slice(stat.lastIndexOf(")") + 2)
      .split(" ");
    const pid: number = Number(entry);
    const parent: number = Number(fields[1]);
    found = found || pid === root;
    children.set(parent, [...(children.get(parent) || []), pid]);
  }

  if (!found) {
    return [];
  }

  const tree: Array<number> = [];
  const todo: Array<number> = [root];
  while (todo.length > 0) {
    const pid: number = todo.pop()!;
    tree.push(pid);
    todo.push(...(children.get(pid) || []));
  }
  return tree;
}

// Reads the memory of a Go command's processes while it runs, from /proc.
class GoMemoryMonitor {
  private readonly root: number;
  private readonly timer: NodeJS.Timeout;
  private peak: GoMemoryPeak | null = null;

  public constructor(root: number) {
    this.root = root;
    this.sample();
    this.timer = setInterval(() => {
      this.sample();
    }, SAMPLE_INTERVAL_MS);
    // A command that has finished must not wait for the next reading.
    this.timer.unref();
  }

  public stop(): GoMemoryPeak | null {
    clearInterval(this.timer);
    return this.peak;
  }

  private sample(): void {
    let pids: Array<number>;
    try {
      pids = processTree(this.root);
    } catch {
      return;
    }

    let totalBytes: number = process.memoryUsage.rss();
    let largest: ProcessMemory | null = null;
    let readAny: boolean = false;
    for (const pid of pids) {
      let memory: ProcessMemory | null;
      try {
        memory = parseProcessStatus(
          fs.readFileSync(path.join(PROC, String(pid), "status"), "utf-8"),
        );
      } catch {
        continue;
      }
      if (!memory) {
        continue;
      }
      readAny = true;
      totalBytes += memory.residentBytes;
      if (!largest || memory.peakBytes > largest.peakBytes) {
        largest = memory;
      }
    }

    if (!readAny || !largest) {
      return;
    }

    const peak: GoMemoryPeak = this.peak || {
      totalBytes: 0,
      largestProcess: "",
      largestBytes: 0,
    };
    peak.totalBytes = Math.max(peak.totalBytes, totalBytes);
    if (largest.peakBytes > peak.largestBytes) {
      peak.largestProcess = largest.name;
      peak.largestBytes = largest.peakBytes;
    }
    this.peak = peak;
  }
}

// A size as people read it: "11.3 GiB", and "41 MiB" below a GiB.
function gibibytes(bytes: number): string {
  if (bytes < 1024 ** 3) {
    return `${Math.round(bytes / 1024 ** 2)} MiB`;
  }
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/*
 * The lines that report what a Go command took: one that says it, and a
 * warning when the total is above `warnAboveBytes` - as a GitHub Actions
 * annotation in a CI run, which the run's summary shows.
 */
export function goMemoryReport(
  command: string,
  peak: GoMemoryPeak,
  warnAboveBytes: number = GO_MEMORY_WARNING_BYTES,
  environment: NodeJS.ProcessEnv = process.env,
): Array<string> {
  const lines: Array<string> = [
    `📈 ${command}: ${gibibytes(peak.totalBytes)} at most, with the generator (largest process: ${peak.largestProcess}, ${gibibytes(peak.largestBytes)})`,
  ];

  if (peak.totalBytes > warnAboveBytes) {
    const message: string = `${command} took ${gibibytes(peak.totalBytes)} with the generator, more than the ${gibibytes(warnAboveBytes)} a 16 GB CI runner can spare. Compiling the provider takes more memory with each resource it gains: see Scripts/TerraformProvider/Core/GoCommand.ts.`;
    lines.push(
      environment["GITHUB_ACTIONS"] === "true"
        ? `::warning title=The Terraform provider's compile is near the runner's memory::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`
        : `⚠️ ${message}`,
    );
  }

  return lines;
}

/*
 * Runs a Go command - a shell line, such as `go build -o <file>` - in `cwd`,
 * with this process's environment and Go's memory limit, and reports the most
 * it took (goMemoryReport), whether it passed or failed. Its memory is read
 * once a second, so a command over before the first reading - quicker than
 * any of the provider's - is not reported, and neither is one where there is
 * no /proc to read it from. A command that fails rejects with the error
 * `exec` gives, its stdout and stderr on it.
 */
export async function runGoCommand(
  command: string,
  cwd: string,
  options: GoCommandOptions = {},
): Promise<GoCommandResult> {
  const report: (line: string) => void =
    options.report ||
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const measure: boolean = fs.existsSync(path.join(PROC, "self", "status"));

  return await new Promise(
    (
      resolve: (result: GoCommandResult) => void,
      reject: (error: Error) => void,
    ) => {
      let monitor: GoMemoryMonitor | null = null;
      const child: ChildProcess = exec(
        command,
        { cwd, env: goEnvironment(process.env) },
        (error: ExecException | null, stdout: string, stderr: string) => {
          const memory: GoMemoryPeak | null = monitor ? monitor.stop() : null;
          if (memory) {
            for (const line of goMemoryReport(
              command,
              memory,
              options.warnAboveBytes,
            )) {
              report(line);
            }
          }

          if (error) {
            reject(Object.assign(error, { stdout, stderr }));
            return;
          }
          resolve({ stdout, stderr, memory });
        },
      );

      if (measure && child.pid !== undefined) {
        monitor = new GoMemoryMonitor(child.pid);
      }
    },
  );
}
