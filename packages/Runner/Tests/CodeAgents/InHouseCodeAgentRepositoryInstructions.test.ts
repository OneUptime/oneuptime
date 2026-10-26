/*
 * ---------------------------------------------------------------------------
 * The code agent learns how to set up, build and test a repository from the
 * repository itself: its AGENTS.md (or CLAUDE.md), read before it starts and
 * quoted into its system prompt, with - for a change, on a Runner of the
 * project's own - the instruction to build and test that way with
 * run_command. That replaced the Setup, Build and Test commands Code's
 * repository settings used to ask for.
 *
 * These drive the REAL agent over a REAL git repository on disk with the
 * server's completion endpoint stubbed, and read the system prompt the agent
 * actually sent. Runner scope is decided at import time
 * (Config.IS_CLUSTER_SCOPED), so each scope reloads the modules, as
 * SharedRunnerCommandSafety.test.ts does.
 * ---------------------------------------------------------------------------
 */

import type InHouseCodeAgentType from "../../CodeAgents/InHouseCodeAgent";
import type {
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/CodeAgentInterface";
import type { LLMMessage } from "Common/Server/Utils/LLM/LLMService";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

jest.setTimeout(120000);

const llmCompletionMock: jest.Mock = jest.fn();
const infoMock: jest.Mock = jest.fn();

jest.mock("../../Utils/BackendAPI", () => {
  return {
    __esModule: true,
    default: class {
      public async llmCompletion(...args: Array<unknown>): Promise<unknown> {
        return llmCompletionMock(...args);
      }
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: (...args: Array<unknown>): void => {
        infoMock(...args);
      },
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const AGENTS_MD: string = [
  "# Contributing with an agent",
  "",
  "Install with `npm ci`, build with `npm run compile` and test with `npm run test:unit`.",
].join("\n");

const temporaryPaths: Array<string> = [];

function makeRepository(files: Record<string, string>): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-agent-instructions-"),
  );
  temporaryPaths.push(dir);

  const run: (args: Array<string>) => void = (args: Array<string>): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };

  run(["init", "-q", "-b", "main", "."]);
  run(["config", "user.email", "tests@oneuptime.com"]);
  run(["config", "user.name", "Runner Tests"]);
  run(["config", "commit.gpgsign", "false"]);

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const a = 1;\n");

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }

  run(["add", "-A"]);
  run(["commit", "-q", "-m", "baseline"]);

  return dir;
}

const savedSecret: string | undefined = process.env["ONEUPTIME_SECRET"];

function loadAgent(clusterKey: string | null): typeof InHouseCodeAgentType {
  jest.resetModules();

  if (clusterKey === null) {
    delete process.env["ONEUPTIME_SECRET"];
  } else {
    process.env["ONEUPTIME_SECRET"] = clusterKey;
  }

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  return (
    require("../../CodeAgents/InHouseCodeAgent") as {
      default: typeof InHouseCodeAgentType;
    }
  ).default;
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
}

// Runs one task whose model answers at once, and returns its system prompt.
async function systemPromptFor(data: {
  clusterKey: string | null;
  repository: string;
  task?: Partial<CodeAgentTask>;
}): Promise<{ prompt: string; tools: Array<string> }> {
  llmCompletionMock.mockReset();
  llmCompletionMock.mockResolvedValue({
    content: "Done.",
    toolCalls: [],
    stopReason: "stop",
    budget: {
      completionCallsUsed: 1,
      maxCompletionCalls: 40,
      outputTokensUsed: 100,
      maxOutputTokens: 100_000,
    },
  });

  const InHouseCodeAgent: typeof InHouseCodeAgentType = loadAgent(
    data.clusterKey,
  );
  const agent: InHouseCodeAgentType = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const result: CodeAgentResult = await agent.executeTask({
    workingDirectory: data.repository,
    prompt: "Fix the checkout total.",
    timeoutMs: 60_000,
    ...(data.task || {}),
  });
  await agent.cleanup();

  expect(result.success).toBe(true);

  const request: {
    messages: Array<LLMMessage>;
    tools?: Array<{ name: string }>;
  } = llmCompletionMock.mock.calls[0]![0];

  return {
    prompt: String(request.messages[0]!.content),
    tools: (request.tools || []).map((tool: { name: string }): string => {
      return tool.name;
    }),
  };
}

afterEach(() => {
  jest.resetModules();
});

afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env["ONEUPTIME_SECRET"];
  } else {
    process.env["ONEUPTIME_SECRET"] = savedSecret;
  }

  for (const dir of temporaryPaths) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const CLUSTER_KEY: string = "a-long-random-cluster-key-for-the-test";

describe("on a Runner of the project's own", () => {
  test("the agent is told the repository's AGENTS.md, then to build and test its change that way", async () => {
    const repository: string = makeRepository({ "AGENTS.md": AGENTS_MD });

    const { prompt, tools } = await systemPromptFor({
      clusterKey: null,
      repository,
    });

    // The recipe's task first, then how the repository says to work in it.
    expect(prompt.startsWith("Fix the checkout total.")).toBe(true);
    expect(prompt).toContain(
      `<repository-instructions file="AGENTS.md">\n${AGENTS_MD}\n</repository-instructions>`,
    );
    expect(prompt).toContain("## Check your change before you finish");
    expect(prompt).toContain("its AGENTS.md above");
    // The tool it checks with is there, and says what it is for.
    expect(tools).toContain("run_command");
    expect(prompt).toContain(
      "set up, build and run the tests the way the repository says to.",
    );
    expect(prompt.indexOf("Fix the checkout total.")).toBeLessThan(
      prompt.indexOf("<repository-instructions"),
    );
    expect(prompt.indexOf("<repository-instructions")).toBeLessThan(
      prompt.indexOf("You are working inside a cloned git repository."),
    );
  });

  test("CLAUDE.md is read when the repository has no AGENTS.md", async () => {
    const repository: string = makeRepository({ "CLAUDE.md": AGENTS_MD });

    const { prompt } = await systemPromptFor({
      clusterKey: null,
      repository,
    });

    expect(prompt).toContain('<repository-instructions file="CLAUDE.md">');
    expect(prompt).toContain("its CLAUDE.md above");
  });

  test("no AGENTS.md: the agent is told where else to find how it is built and tested", async () => {
    const repository: string = makeRepository({ "README.md": "# app\n" });

    const { prompt } = await systemPromptFor({
      clusterKey: null,
      repository,
    });

    expect(prompt).not.toContain("<repository-instructions");
    expect(prompt).toContain("## Check your change before you finish");
    expect(prompt).toContain("It has no AGENTS.md");
    expect(prompt).toContain("CONTRIBUTING.md");
    expect(prompt).toContain("package.json");
  });

  test("a review (or a regression test) reads the conventions, but is not told to build or test a change", async () => {
    const repository: string = makeRepository({ "AGENTS.md": AGENTS_MD });

    const { prompt } = await systemPromptFor({
      clusterKey: null,
      repository,
      task: { skipsChangeChecks: true },
    });

    expect(prompt).toContain(AGENTS_MD);
    expect(prompt).not.toContain("## Check your change before you finish");
  });

  test("an AGENTS.md that is a link out of the repository is never read into the prompt", async () => {
    const outside: string = makeRepository({
      "notes.md": "THE-RUNNER-HOST-FILE",
    });
    const repository: string = makeRepository({});
    fs.symlinkSync(
      path.join(outside, "notes.md"),
      path.join(repository, "AGENTS.md"),
    );

    const { prompt } = await systemPromptFor({
      clusterKey: null,
      repository,
    });

    expect(prompt).not.toContain("THE-RUNNER-HOST-FILE");
    expect(prompt).not.toContain("<repository-instructions");
  });

  test("the run's log says the agent follows the repository's AGENTS.md", async () => {
    infoMock.mockReset();
    const repository: string = makeRepository({ "AGENTS.md": AGENTS_MD });

    await systemPromptFor({ clusterKey: null, repository });

    const logged: string = infoMock.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .join("\n");

    expect(logged).toContain(
      "Following the repository's AGENTS.md for how to work in it",
    );
  });
});

describe("on the shared Runner, which runs no command", () => {
  test("the agent follows the repository's conventions, and is never told to run a command", async () => {
    const repository: string = makeRepository({ "AGENTS.md": AGENTS_MD });

    const { prompt, tools } = await systemPromptFor({
      clusterKey: CLUSTER_KEY,
      repository,
    });

    expect(prompt).toContain(AGENTS_MD);
    expect(prompt).not.toContain("## Check your change before you finish");
    expect(tools).not.toContain("run_command");
    expect(prompt).toContain("There is no command-running tool on this Runner");
  });
});
