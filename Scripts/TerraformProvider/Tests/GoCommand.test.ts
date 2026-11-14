/*
 * The generators run Go with a soft memory limit (Core/GoCommand.ts).
 *
 * Compiling the provider's internal/provider, one Go package of some 985
 * files, took the compiler to about 15 GB, for `go build` and for the test
 * binary `go test` builds alike, with Go's default garbage collection: with
 * the Node.js generator beside it, more than a 16 GB CI runner has, and jobs
 * lost their runner in "Generate Terraform provider" (#7559). GOMEMLIMIT
 * makes Go collect garbage more often as its memory nears the limit.
 *
 * These run runGoCommand against a `go` of their own on PATH, which prints
 * what it was run with: its arguments, the directory, GOMEMLIMIT and the
 * variable the docs step sets on its command line.
 */

import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import {
  GO_MEMORY_LIMIT,
  goEnvironment,
  runGoCommand,
} from "../Core/GoCommand";

const FAKE_GO: string = [
  "#!/bin/sh",
  'if [ "$1" = fail ]; then',
  '  echo "go: the build failed" >&2',
  "  exit 1",
  "fi",
  'echo "args=$*"',
  'echo "cwd=$(pwd)"',
  'echo "GOMEMLIMIT=${GOMEMLIMIT-unset}"',
  'echo "ONEUPTIME_PROVIDER_SCHEMA_OUT=${ONEUPTIME_PROVIDER_SCHEMA_OUT-unset}"',
  "",
].join("\n");

let fakeBin: string;
let workDir: string;
const original: Record<string, string | undefined> = {
  PATH: process.env["PATH"],
  GOMEMLIMIT: process.env["GOMEMLIMIT"],
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
  const { stdout } = await runGoCommand(command, workDir);
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
    await expect(runGoCommand("go fail", workDir)).rejects.toMatchObject({
      stderr: "go: the build failed\n",
    });
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
