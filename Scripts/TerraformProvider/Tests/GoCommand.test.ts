/*
 * The generators run Go with a soft memory limit, and report what each Go
 * command took (Core/GoCommand.ts).
 *
 * Compiling the provider's internal/provider, one Go package of some 985
 * files, took the compiler to about 15 GB, for `go build` and for the test
 * binary `go test` builds alike, with Go's default garbage collection: with
 * the Node.js generator beside it, more than a 16 GB CI runner has, and jobs
 * lost their runner in "Generate Terraform provider" (#7559). GOMEMLIMIT
 * makes Go collect garbage more often as its memory nears the limit. What is
 * live in the compiler still grows with every resource, so each Go command's
 * peak is reported, and is a warning in CI when it nears a runner's memory
 * (#7592).
 *
 * These run runGoCommand against a `go` of their own on PATH, which prints
 * what it was run with: its arguments, the directory, GOMEMLIMIT and the
 * variable the docs step sets on its command line - or, as `go allocate`,
 * starts a process that holds 256 MiB for a while.
 */

import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import {
  GO_MEMORY_LIMIT,
  GO_MEMORY_WARNING_BYTES,
  GoCommandResult,
  GoMemoryPeak,
  goEnvironment,
  goMemoryReport,
  parseProcessStatus,
  processTree,
  runGoCommand,
} from "../Core/GoCommand";

const MiB: number = 1024 ** 2;
const GiB: number = 1024 ** 3;

// What `go allocate` holds: filled, so all of it is resident.
const ALLOCATED_BYTES: number = 256 * MiB;

/*
 * FAKE_GO_SLEEP makes it take a while first: a command over before its
 * memory is first read is not reported, and every Go command the generators
 * run takes longer than that.
 */
const FAKE_GO: string = [
  "#!/bin/sh",
  'if [ -n "${FAKE_GO_SLEEP-}" ]; then',
  '  sleep "$FAKE_GO_SLEEP"',
  "fi",
  'if [ "$1" = fail ]; then',
  '  echo "go: the build failed" >&2',
  "  exit 1",
  "fi",
  'if [ "$1" = allocate ]; then',
  `  exec node -e 'const held = Buffer.alloc(${ALLOCATED_BYTES}, 1); setTimeout(() => { process.stdout.write(String(held.length)); }, 2500);'`,
  "fi",
  'echo "args=$*"',
  'echo "cwd=$(pwd)"',
  'echo "GOMEMLIMIT=${GOMEMLIMIT-unset}"',
  'echo "ONEUPTIME_PROVIDER_SCHEMA_OUT=${ONEUPTIME_PROVIDER_SCHEMA_OUT-unset}"',
  "",
].join("\n");

// The memory report reads /proc, which Linux has (CI runs on Linux).
const HAS_PROC: boolean = fs.existsSync("/proc/self/status");
const onLinux: jest.It = HAS_PROC ? test : test.skip;

let fakeBin: string;
let workDir: string;
const original: Record<string, string | undefined> = {
  PATH: process.env["PATH"],
  GOMEMLIMIT: process.env["GOMEMLIMIT"],
  FAKE_GO_SLEEP: process.env["FAKE_GO_SLEEP"],
};

// What the fake `go` printed, as name -> value.
function seen(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line: string): [string, string] => {
        const index: number = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

async function runFakeGo(command: string): Promise<Record<string, string>> {
  const { stdout } = await runGoCommand(command, workDir, {
    report: (): void => {},
  });
  return seen(stdout);
}

beforeEach(() => {
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-go-bin-"));
  workDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "fake-go-provider-")),
  );
  fs.writeFileSync(path.join(fakeBin, "go"), FAKE_GO, { mode: 0o755 });
  process.env["PATH"] = [fakeBin, original["PATH"]].join(path.delimiter);
  delete process.env["GOMEMLIMIT"];
  delete process.env["FAKE_GO_SLEEP"];
});

afterEach(() => {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  fs.rmSync(fakeBin, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("runGoCommand", () => {
  test("gives Go the memory limit when the environment sets none", async () => {
    const go: Record<string, string> = await runFakeGo(
      "go build -o terraform-provider-oneuptime",
    );

    expect(go["GOMEMLIMIT"]).toBe(GO_MEMORY_LIMIT);
    expect(go["args"]).toBe("build -o terraform-provider-oneuptime");
  });

  test("an empty GOMEMLIMIT counts as none", async () => {
    process.env["GOMEMLIMIT"] = "";

    expect((await runFakeGo("go build"))["GOMEMLIMIT"]).toBe(GO_MEMORY_LIMIT);
  });

  test.each(["12GiB", "off"])(
    "a caller's own GOMEMLIMIT wins: %s",
    async (limit: string) => {
      process.env["GOMEMLIMIT"] = limit;

      expect((await runFakeGo("go build"))["GOMEMLIMIT"]).toBe(limit);
    },
  );

  test("a variable set on the command line reaches Go too, beside the limit", async () => {
    // The docs step's command, as GenerateProvider.ts runs it.
    const go: Record<string, string> = await runFakeGo(
      `ONEUPTIME_PROVIDER_SCHEMA_OUT="/tmp/provider-schema.json" go test ./internal/provider -run '^TestWriteProviderSchemaForDocs$' -count=1`,
    );

    expect(go["ONEUPTIME_PROVIDER_SCHEMA_OUT"]).toBe(
      "/tmp/provider-schema.json",
    );
    expect(go["GOMEMLIMIT"]).toBe(GO_MEMORY_LIMIT);
    expect(go["args"]).toBe(
      "test ./internal/provider -run ^TestWriteProviderSchemaForDocs$ -count=1",
    );
  });

  test("runs in the directory it is given", async () => {
    expect((await runFakeGo("go mod tidy"))["cwd"]).toBe(workDir);
  });

  test("a command that fails rejects with what Go printed, for the generator to show", async () => {
    await expect(
      runGoCommand("go fail", workDir, { report: (): void => {} }),
    ).rejects.toMatchObject({
      stderr: "go: the build failed\n",
    });
  });
});

describe("runGoCommand's memory report", () => {
  onLinux(
    "reads the most the command's processes held, while they ran",
    async () => {
      const lines: Array<string> = [];
      const result: GoCommandResult = await runGoCommand(
        "go allocate",
        workDir,
        {
          report: (line: string): void => {
            lines.push(line);
          },
        },
      );

      expect(result.stdout).toBe(String(ALLOCATED_BYTES));
      // The largest process is the `node` the fake go became, with all it held.
      expect(result.memory).not.toBeNull();
      const memory: GoMemoryPeak = result.memory!;
      expect(memory.largestProcess).toMatch(/^node/);
      expect(memory.largestBytes).toBeGreaterThanOrEqual(ALLOCATED_BYTES);
      // The total counts this process too, beside the command's.
      expect(memory.totalBytes).toBeGreaterThan(
        ALLOCATED_BYTES + process.memoryUsage.rss() / 2,
      );
      expect(lines).toEqual(goMemoryReport("go allocate", memory));
    },
  );

  onLinux(
    "is a warning above the threshold it is given, as a CI run shows one",
    async () => {
      const lines: Array<string> = [];
      await runGoCommand("go allocate", workDir, {
        report: (line: string): void => {
          lines.push(line);
        },
        warnAboveBytes: ALLOCATED_BYTES / 2,
      });

      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatch(/^(::warning title=|⚠️ )/);
    },
  );

  onLinux(
    "is made for a command that fails too, before it rejects",
    async () => {
      process.env["FAKE_GO_SLEEP"] = "1.5";
      const lines: Array<string> = [];
      await expect(
        runGoCommand("go fail", workDir, {
          report: (line: string): void => {
            lines.push(line);
          },
        }),
      ).rejects.toMatchObject({ stderr: "go: the build failed\n" });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^📈 go fail: /);
    },
  );

  onLinux("goes to standard output unless the caller says where", async () => {
    process.env["FAKE_GO_SLEEP"] = "1.5";
    const written: Array<string> = [];
    const write: jest.SpyInstance = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(String(chunk));
        return true;
      });
    try {
      await runGoCommand("go mod tidy", workDir);
    } finally {
      write.mockRestore();
    }

    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(
      /^📈 go mod tidy: [0-9.]+ (MiB|GiB) at most, .*\n$/,
    );
  });

  test("is left out where there is no /proc to read, as on macOS", async () => {
    process.env["FAKE_GO_SLEEP"] = "1.5";
    const existsSync: typeof fs.existsSync = fs.existsSync;
    const exists: jest.SpyInstance = jest
      .spyOn(fs, "existsSync")
      .mockImplementation((file: fs.PathLike): boolean => {
        return String(file).startsWith("/proc") ? false : existsSync(file);
      });
    const lines: Array<string> = [];
    try {
      const result: GoCommandResult = await runGoCommand("go build", workDir, {
        report: (line: string): void => {
          lines.push(line);
        },
      });

      expect(result.memory).toBeNull();
      expect(seen(result.stdout)["args"]).toBe("build");
    } finally {
      exists.mockRestore();
    }
    expect(lines).toEqual([]);
  });
});

describe("goMemoryReport", () => {
  const compile: GoMemoryPeak = {
    totalBytes: 12.4 * GiB,
    largestProcess: "compile",
    largestBytes: 11.3 * GiB,
  };

  test("says what the command took with the generator, and its largest process", () => {
    expect(
      goMemoryReport("go build -o terraform-provider-oneuptime", compile),
    ).toEqual([
      "📈 go build -o terraform-provider-oneuptime: 12.4 GiB at most, with the generator (largest process: compile, 11.3 GiB)",
    ]);
  });

  test("says a size below a GiB in MiB", () => {
    expect(
      goMemoryReport("go mod tidy", {
        totalBytes: 1.1 * GiB,
        largestProcess: "go",
        largestBytes: 41 * MiB,
      }),
    ).toEqual([
      "📈 go mod tidy: 1.1 GiB at most, with the generator (largest process: go, 41 MiB)",
    ]);
  });

  test("warns above 13 GiB, which leaves a 16 GB runner under 3 GB", () => {
    expect(GO_MEMORY_WARNING_BYTES).toBe(13 * GiB);

    expect(
      goMemoryReport(
        "go build",
        { ...compile, totalBytes: GO_MEMORY_WARNING_BYTES },
        GO_MEMORY_WARNING_BYTES,
        {},
      ),
    ).toHaveLength(1);
    expect(
      goMemoryReport(
        "go build",
        { ...compile, totalBytes: GO_MEMORY_WARNING_BYTES + MiB },
        GO_MEMORY_WARNING_BYTES,
        {},
      ),
    ).toHaveLength(2);
  });

  test("warns with a GitHub Actions annotation in a CI run", () => {
    const lines: Array<string> = goMemoryReport(
      "go build",
      { ...compile, totalBytes: 13.5 * GiB },
      GO_MEMORY_WARNING_BYTES,
      { GITHUB_ACTIONS: "true" },
    );

    expect(lines[1]).toBe(
      "::warning title=The Terraform provider's compile is near the runner's memory::go build took 13.5 GiB with the generator, more than the 13.0 GiB a 16 GB CI runner can spare. Compiling the provider takes more memory with each resource it gains: see Scripts/TerraformProvider/Core/GoCommand.ts.",
    );
  });

  test("warns in words elsewhere", () => {
    const lines: Array<string> = goMemoryReport(
      "go build",
      { ...compile, totalBytes: 13.5 * GiB },
      GO_MEMORY_WARNING_BYTES,
      {},
    );

    expect(lines[1]).toMatch(/^⚠️ go build took 13\.5 GiB with the generator/);
  });

  test("keeps a command's own % and line breaks from being read as an annotation's", () => {
    const lines: Array<string> = goMemoryReport(
      "go build -ldflags '-X main.v=100%'\nand more",
      { ...compile, totalBytes: 14 * GiB },
      GO_MEMORY_WARNING_BYTES,
      { GITHUB_ACTIONS: "true" },
    );

    expect(lines[1]).toContain("main.v=100%25'%0Aand more took 14.0 GiB");
    expect(lines[1]).not.toContain("\n");
  });
});

describe("parseProcessStatus", () => {
  // As /proc/<pid>/status has it: tab after the name, sizes in kB.
  const status: string = [
    "Name:\tcompile",
    "Umask:\t0002",
    "State:\tR (running)",
    "VmPeak:\t13510000 kB",
    "VmHWM:\t11849000 kB",
    "VmRSS:\t 9800000 kB",
    "Threads:\t9",
    "",
  ].join("\n");

  test("reads the process's name, what it holds and the most it held", () => {
    expect(parseProcessStatus(status)).toEqual({
      name: "compile",
      residentBytes: 9800000 * 1024,
      peakBytes: 11849000 * 1024,
    });
  });

  test("a process that holds no memory, as a zombie, is not read", () => {
    expect(parseProcessStatus("Name:\tgo\nState:\tZ (zombie)\n")).toBeNull();
  });

  test("never reports a peak below what it holds", () => {
    expect(parseProcessStatus("Name:\tgo\nVmRSS:\t2048 kB\n")?.peakBytes).toBe(
      2048 * 1024,
    );
  });
});

describe("processTree", () => {
  let proc: string;

  // A /proc of its own: <pid>/stat for each, names with spaces and ")".
  function fakeProcess(pid: number, name: string, parent: number): void {
    fs.mkdirSync(path.join(proc, String(pid)));
    fs.writeFileSync(
      path.join(proc, String(pid), "stat"),
      `${pid} (${name}) S ${parent} ${pid} ${pid} 0 -1 4194304 0 0 0 0\n`,
    );
  }

  beforeEach(() => {
    proc = fs.mkdtempSync(path.join(os.tmpdir(), "fake-proc-"));
    fakeProcess(1, "systemd", 0);
    fakeProcess(100, "node", 1);
    fakeProcess(200, "sh", 100);
    fakeProcess(201, "go", 200);
    fakeProcess(300, "compile", 201);
    fakeProcess(301, "my (odd) tool", 201);
    fakeProcess(400, "other", 1);
    fs.mkdirSync(path.join(proc, "self"));
    fs.writeFileSync(path.join(proc, "uptime"), "1.0 1.0\n");
  });

  afterEach(() => {
    fs.rmSync(proc, { recursive: true, force: true });
  });

  test("is the process and everything under it", () => {
    expect(processTree(200, proc).sort()).toEqual([200, 201, 300, 301]);
  });

  test("leaves out the processes that are not under it", () => {
    expect(processTree(201, proc).sort()).toEqual([201, 300, 301]);
  });

  test("is empty once the process is gone", () => {
    expect(processTree(999, proc)).toEqual([]);
  });

  test("reads a real /proc", () => {
    if (!HAS_PROC) {
      return;
    }
    expect(processTree(process.pid)).toContain(process.pid);
  });
});

describe("goEnvironment", () => {
  test("adds the limit and keeps the rest of the environment, without changing it", () => {
    const environment: NodeJS.ProcessEnv = { PATH: "/usr/bin", GOFLAGS: "-x" };

    expect(goEnvironment(environment)).toEqual({
      PATH: "/usr/bin",
      GOFLAGS: "-x",
      GOMEMLIMIT: GO_MEMORY_LIMIT,
    });
    expect(environment).toEqual({ PATH: "/usr/bin", GOFLAGS: "-x" });
  });

  test("is a size Go reads", () => {
    expect(GO_MEMORY_LIMIT).toMatch(/^[1-9][0-9]*(B|KiB|MiB|GiB|TiB)$/);
  });
});

/*
 * GenerateProvider.ts compiles the provider twice - `go build`, then the
 * test binary of the docs step - and runs `go get` and `go mod tidy` before
 * that. Each goes through runGoCommand, and the file starts no process of its
 * own that could leave the limit out.
 */
describe("GenerateProvider.ts", () => {
  const file: string = path.join(__dirname, "..", "GenerateProvider.ts");
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
  );

  function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, (child: ts.Node) => {
      walk(child, visit);
    });
  }

  test("imports nothing that starts a process", () => {
    const modules: Array<string> = source.statements
      .filter(ts.isImportDeclaration)
      .map((declaration: ts.ImportDeclaration): string => {
        return (declaration.moduleSpecifier as ts.StringLiteral).text;
      });

    expect(modules).toContain("./Core/GoCommand");
    expect(modules).not.toContain("child_process");
    expect(modules).not.toContain("node:child_process");
  });

  test("runs go get, go mod tidy, go build and go test through runGoCommand", () => {
    const subcommands: Array<string> = [];
    walk(source, (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "runGoCommand"
      ) {
        // The command as written: a string, or a template with the docs path.
        const command: string = node.arguments[0]?.getText(source) || "";
        const match: RegExpMatchArray | null = command.match(/\bgo (\w+)/);
        if (match) {
          subcommands.push(match[1]!);
        }
      }
    });

    expect(subcommands).toEqual(
      expect.arrayContaining(["get", "mod", "build", "test"]),
    );
  });
});
