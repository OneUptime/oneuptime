/*
 * ---------------------------------------------------------------------------
 * The code agent benchmark's tasks (issue #6531): each task's check tells a
 * fixed repository from an unfixed one. Every task's repository is written
 * out and committed as the benchmark does it; its check fails there, and
 * passes once the fix a person would make is in. The check is never in the
 * repository, and a fix that weakens the test it should satisfy fails.
 * No model is called.
 * ---------------------------------------------------------------------------
 */

import CodeAgentBenchmark from "../../Benchmark/CodeAgentBenchmark";
import {
  CODE_AGENT_BENCHMARK_TASKS,
  CodeAgentBenchmarkCheck,
  CodeAgentBenchmarkShape,
  CodeAgentBenchmarkTask,
  SLOW_SUITE_TESTS,
  SLOW_SUITE_WAIT_MS,
  runNode,
  slowSuiteWith,
} from "../../Benchmark/CodeAgentBenchmarkTasks";
import { DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS } from "../../Utils/AgentCommandLimits";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

jest.setTimeout(240000);

const repositories: Array<string> = [];

function prepare(task: CodeAgentBenchmarkTask): string {
  const repositoryPath: string = CodeAgentBenchmark.prepareRepository(task);
  repositories.push(repositoryPath);
  return repositoryPath;
}

function taskOf(shape: CodeAgentBenchmarkShape): CodeAgentBenchmarkTask {
  return CODE_AGENT_BENCHMARK_TASKS.find(
    (task: CodeAgentBenchmarkTask): boolean => {
      return task.shape === shape;
    },
  )!;
}

afterAll(() => {
  for (const repositoryPath of repositories) {
    fs.rmSync(repositoryPath, { recursive: true, force: true });
  }
});

describe("the tasks", () => {
  test("are the four shapes the issue names, each once, each with its own id", () => {
    expect(
      CODE_AGENT_BENCHMARK_TASKS.map((task: CodeAgentBenchmarkTask) => {
        return task.shape;
      }).sort(),
    ).toEqual(Object.values(CodeAgentBenchmarkShape).sort());
    expect(
      new Set(
        CODE_AGENT_BENCHMARK_TASKS.map((task: CodeAgentBenchmarkTask) => {
          return task.id;
        }),
      ).size,
    ).toBe(CODE_AGENT_BENCHMARK_TASKS.length);
  });

  test.each(
    CODE_AGENT_BENCHMARK_TASKS.map((task: CodeAgentBenchmarkTask) => {
      return [task.id, task];
    }),
  )(
    "%s is a committed repository with a test script, and nothing to say how it is checked",
    (_id: string, task: CodeAgentBenchmarkTask) => {
      const repositoryPath: string = prepare(task);

      expect(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: repositoryPath,
          encoding: "utf8",
        }),
      ).toBe("");
      expect(
        JSON.parse(
          fs.readFileSync(path.join(repositoryPath, "package.json"), "utf8"),
        ).scripts.test,
      ).toBe("node --test test/");

      const everything: string = Object.values(task.files()).join("\n");

      expect(everything).not.toContain("check.js");
      expect(task.prompt.length).toBeGreaterThan(40);
    },
  );
});

/*
 * THE ISSUE'S TEST: each task's check tells a fixed repository from an
 * unfixed one.
 */
describe.each(
  CODE_AGENT_BENCHMARK_TASKS.map((task: CodeAgentBenchmarkTask) => {
    return [task.id, task];
  }),
)("%s", (_id: string, task: CodeAgentBenchmarkTask) => {
  test("its check fails on the repository as the task finds it", async () => {
    const check: CodeAgentBenchmarkCheck = await task.check(prepare(task));

    expect(check.passed).toBe(false);
    expect(check.detail.length).toBeGreaterThan(0);
  });

  test("its check passes once the fix is made", async () => {
    const repositoryPath: string = prepare(task);

    task.solve(repositoryPath);

    expect(await task.check(repositoryPath)).toEqual({
      passed: true,
      detail: "",
    });
  });
});

describe("a bug in a long file", () => {
  const task: CodeAgentBenchmarkTask = taskOf(CodeAgentBenchmarkShape.LongFile);

  test("the file is about 2,000 lines, and the stack trace names its lines", () => {
    const text: string = task.files()["src/billing.js"]!;
    const lines: Array<string> = text.split("\n");

    expect(lines.length).toBeGreaterThanOrEqual(1_900);
    expect(lines.length).toBeLessThanOrEqual(2_300);

    const throwPattern: RegExp = /assertNonNegative \(src\/billing\.js:(\d+):/;
    const callPattern: RegExp = /createInvoice \(src\/billing\.js:(\d+):/;
    const throwAt: number = Number(throwPattern.exec(task.prompt)![1]);
    const callAt: number = Number(callPattern.exec(task.prompt)![1]);

    expect(lines[throwAt - 1]).toContain("throw new Error(");
    expect(lines[callAt - 1]).toContain("assertNonNegative(total)");
  });

  test("the cause is far from where it throws: the trace does not name it", () => {
    expect(task.prompt).not.toContain("applyDiscount");
  });
});

describe("a failing test", () => {
  const task: CodeAgentBenchmarkTask = taskOf(
    CodeAgentBenchmarkShape.FailingTest,
  );

  test("the repository's own tests fail as the task finds it", async () => {
    const result: { exitCode: number; output: string } = await runNode(
      ["--test", "test/"],
      prepare(task),
    );

    expect(result.exitCode).not.toBe(0);
  });

  test("weakening the test to pass fails the check", async () => {
    const repositoryPath: string = prepare(task);

    fs.writeFileSync(
      path.join(repositoryPath, "test/slugify.test.js"),
      'require("node:test")("nothing", () => {});\n',
    );

    const check: CodeAgentBenchmarkCheck = await task.check(repositoryPath);

    expect(check.passed).toBe(false);
    expect(check.detail).toContain(
      "the test was changed: test/slugify.test.js",
    );
  });

  test("hard-coding the test's cases fails the check's own", async () => {
    const repositoryPath: string = prepare(task);

    fs.writeFileSync(
      path.join(repositoryPath, "src/slugify.js"),
      [
        'const KNOWN = { "Hello World": "hello-world", "  Hello, World!  ": "hello-world", "Crème brûlée": "creme-brulee" };',
        "function slugify(title) { return KNOWN[title]; }",
        "module.exports = { slugify };",
        "",
      ].join("\n"),
    );

    expect((await task.check(repositoryPath)).passed).toBe(false);
  });
});

describe("a change across files", () => {
  const task: CodeAgentBenchmarkTask = taskOf(
    CodeAgentBenchmarkShape.ManyFiles,
  );

  test("half the fix is no fix", async () => {
    const repositoryPath: string = prepare(task);

    for (const file of ["src/views/profile.js", "src/views/header.js"]) {
      const full: string = path.join(repositoryPath, file);
      fs.writeFileSync(
        full,
        fs.readFileSync(full, "utf8").replace("fullName", "displayName"),
      );
    }

    const check: CodeAgentBenchmarkCheck = await task.check(repositoryPath);

    expect(check.passed).toBe(false);
    expect(check.detail).toContain("src/email/welcome.js");
    expect(check.detail).toContain("src/email/digest.js");
  });
});

describe("a slow test suite", () => {
  const task: CodeAgentBenchmarkTask = taskOf(
    CodeAgentBenchmarkShape.SlowTests,
  );

  test("runs longer than a command gets unless it asks for more", () => {
    expect((SLOW_SUITE_TESTS * SLOW_SUITE_WAIT_MS) / 1000).toBeGreaterThan(
      DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS,
    );
    expect(task.files()["test/retryQueue.test.js"]).toBe(
      slowSuiteWith(SLOW_SUITE_WAIT_MS),
    );
  });

  test("catches the bug, and passes once it is fixed (its waits cut short here)", async () => {
    const repositoryPath: string = prepare(task);
    const suite: string = path.join(repositoryPath, "test/retryQueue.test.js");

    fs.writeFileSync(suite, slowSuiteWith(1));

    expect(
      (await runNode(["--test", "test/"], repositoryPath)).exitCode,
    ).not.toBe(0);

    task.solve(repositoryPath);

    expect((await runNode(["--test", "test/"], repositoryPath)).exitCode).toBe(
      0,
    );
  });

  test("weakening the suite fails the check", async () => {
    const repositoryPath: string = prepare(task);

    task.solve(repositoryPath);
    fs.writeFileSync(
      path.join(repositoryPath, "test/retryQueue.test.js"),
      slowSuiteWith(1),
    );

    const check: CodeAgentBenchmarkCheck = await task.check(repositoryPath);

    expect(check.passed).toBe(false);
    expect(check.detail).toContain("the suite was changed");
  });
});
