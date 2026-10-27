/*
 * ---------------------------------------------------------------------------
 * The code agent's file tools touch only the repository's working tree.
 *
 * On a global Runner the file tools are the agent's whole surface: it runs
 * no shell there (see GlobalRunnerCommandSafety.test.ts).
 * So the rule those tools enforce is the boundary itself:
 *
 *   - read_file, list_directory and search_files never return anything from
 *     outside the workspace, including through a link the repository
 *     carries; and
 *   - write_file never writes outside the working tree: not outside the
 *     workspace (links included), and never into the repository's git
 *     metadata (the pipeline owns the repository's git state).
 *
 * The rule is the same on a project's own Runner, so every case runs on
 * both. Like the other tool suites, these drive the REAL agent with a
 * scripted model against a REAL git repository on disk, and assert on what
 * ended up on disk and on what the model was shown.
 * ---------------------------------------------------------------------------
 */

import type InHouseCodeAgentType from "../../CodeAgents/InHouseCodeAgent";
import type {
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/CodeAgentInterface";
import type { LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

jest.setTimeout(120000);

const llmCompletionMock: jest.Mock = jest.fn();

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
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const OUTSIDE_MARKER: string = "outside-the-workspace-marker-7f3c";
const ORIGINAL_SOURCE: string =
  "export function checkout(): number {\n  return 1;\n}\n";

const temporaryPaths: Array<string> = [];

function makeTemporaryDirectory(prefix: string): string {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(dir);
  return dir;
}

function git(dir: string, args: Array<string>): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

interface Fixture {
  workspace: string;
  outsideDir: string;
  outsideFile: string;
}

/*
 * A repository that carries links, committed like any other file: one to a
 * file outside the workspace, one to a directory outside it, one to the
 * repository's own git metadata, one dangling, and one that stays inside the
 * working tree (a legitimate alias).
 */
function makeFixture(): Fixture {
  const outsideDir: string = makeTemporaryDirectory("agent-outside-");
  const outsideFile: string = path.join(outsideDir, "settings.txt");
  fs.writeFileSync(outsideFile, `${OUTSIDE_MARKER}\n`);

  const workspace: string = makeTemporaryDirectory("agent-workspace-");

  git(workspace, ["init", "-q", "-b", "main", "."]);
  git(workspace, ["config", "user.email", "tests@oneuptime.com"]);
  git(workspace, ["config", "user.name", "Runner Tests"]);
  git(workspace, ["config", "commit.gpgsign", "false"]);

  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "checkout.ts"), ORIGINAL_SOURCE);
  fs.writeFileSync(path.join(workspace, "README.md"), "# app\n");

  fs.symlinkSync(outsideFile, path.join(workspace, "linked-file.txt"));
  fs.symlinkSync(outsideDir, path.join(workspace, "linked-dir"));
  fs.symlinkSync(".git", path.join(workspace, "linked-meta"));
  fs.symlinkSync(
    path.join(outsideDir, "does-not-exist-yet.txt"),
    path.join(workspace, "dangling.txt"),
  );
  fs.symlinkSync("README.md", path.join(workspace, "ALIAS.md"));

  git(workspace, ["add", "-A"]);
  git(workspace, ["commit", "-q", "-m", "baseline"]);

  return { workspace, outsideDir, outsideFile };
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  index: number,
): LLMToolCall {
  return {
    id: `call-${index}-${name}`,
    name,
    arguments: args,
  } as unknown as LLMToolCall;
}

function scriptToolsThenSummary(calls: Array<LLMToolCall>): void {
  llmCompletionMock.mockReset();
  llmCompletionMock.mockResolvedValueOnce({
    content: "",
    toolCalls: calls,
    stopReason: "tool_use",
    budget: {
      completionCallsUsed: 1,
      maxCompletionCalls: 40,
      outputTokensUsed: 100,
      maxOutputTokens: 100_000,
    },
  });
  llmCompletionMock.mockResolvedValue({
    content: "Done.",
    toolCalls: [],
    stopReason: "stop",
    budget: {
      completionCallsUsed: 2,
      maxCompletionCalls: 40,
      outputTokensUsed: 200,
      maxOutputTokens: 100_000,
    },
  });
}

/*
 * What the model was shown for each tool call, in order: the `tool`
 * messages of the second completion request.
 */
function toolResultsShownToModel(): Array<string> {
  const secondCall: Array<unknown> | undefined =
    llmCompletionMock.mock.calls[1];
  const payload: { messages?: Array<{ role: string; content: string }> } =
    (secondCall?.[0] as {
      messages?: Array<{ role: string; content: string }>;
    }) || {};

  return (payload.messages || [])
    .filter((message: { role: string }) => {
      return message.role === "tool";
    })
    .map((message: { content: string }) => {
      return message.content;
    });
}

/*
 * A fresh copy of the agent, on a Runner the server called global or not
 * (GlobalRunnerMode, set on the same copy of the modules).
 */
function loadAgent(isGlobalRunner: boolean): typeof InHouseCodeAgentType {
  jest.resetModules();

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  (
    require("../../Utils/GlobalRunnerMode") as {
      default: { setFromServer: (isGlobalRunner: boolean) => void };
    }
  ).default.setFromServer(isGlobalRunner);

  return (
    require("../../CodeAgents/InHouseCodeAgent") as {
      default: typeof InHouseCodeAgentType;
    }
  ).default;
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
}

async function runAgent(
  InHouseCodeAgent: typeof InHouseCodeAgentType,
  workspace: string,
  calls: Array<LLMToolCall>,
): Promise<{ result: CodeAgentResult; shown: Array<string> }> {
  scriptToolsThenSummary(calls);

  const agent: InHouseCodeAgentType = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const task: CodeAgentTask = {
    workingDirectory: workspace,
    prompt: "Fix the bug.",
    timeoutMs: 60_000,
  };

  const result: CodeAgentResult = await agent.executeTask(task);
  await agent.cleanup();

  return { result, shown: toolResultsShownToModel() };
}

function snapshotGitMetadata(workspace: string): Map<string, string> {
  const snapshot: Map<string, string> = new Map<string, string>();
  const gitDir: string = path.join(workspace, ".git");

  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else {
        snapshot.set(
          path.relative(gitDir, full),
          fs.readFileSync(full).toString("base64"),
        );
      }
    }
  };

  walk(gitDir);
  return snapshot;
}

afterEach(() => {
  jest.resetModules();
});

afterAll(() => {
  for (const dir of temporaryPaths) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const SCOPES: Array<{ name: string; isGlobalRunner: boolean }> = [
  { name: "a global Runner", isGlobalRunner: true },
  { name: "a project's own Runner", isGlobalRunner: false },
];

describe.each(SCOPES)(
  "$name: the code agent's file tools stay inside the repository's working tree",
  ({ isGlobalRunner }: { name: string; isGlobalRunner: boolean }) => {
    test("read_file never returns a file outside the workspace through a link", async () => {
      const InHouseCodeAgent: typeof InHouseCodeAgentType =
        loadAgent(isGlobalRunner);
      const fixture: Fixture = makeFixture();

      const { shown } = await runAgent(InHouseCodeAgent, fixture.workspace, [
        toolCall("read_file", { path: "linked-file.txt" }, 1),
        toolCall("read_file", { path: "linked-dir/settings.txt" }, 2),
      ]);

      expect(shown).toHaveLength(2);

      for (const output of shown) {
        expect(output).not.toContain(OUTSIDE_MARKER);
        expect(output).toContain("outside the workspace");
      }
    });

    test("list_directory never lists a directory outside the workspace through a link", async () => {
      const InHouseCodeAgent: typeof InHouseCodeAgentType =
        loadAgent(isGlobalRunner);
      const fixture: Fixture = makeFixture();

      const { shown } = await runAgent(InHouseCodeAgent, fixture.workspace, [
        toolCall("list_directory", { path: "linked-dir" }, 1),
      ]);

      expect(shown).toHaveLength(1);
      expect(shown[0]).not.toContain("settings.txt");
      expect(shown[0]).toContain("outside the workspace");
    });

    test("search_files never searches a file outside the workspace through a link", async () => {
      const InHouseCodeAgent: typeof InHouseCodeAgentType =
        loadAgent(isGlobalRunner);
      const fixture: Fixture = makeFixture();

      const { shown } = await runAgent(InHouseCodeAgent, fixture.workspace, [
        toolCall("search_files", { pattern: OUTSIDE_MARKER }, 1),
        toolCall(
          "search_files",
          { pattern: OUTSIDE_MARKER, path: "linked-file.txt" },
          2,
        ),
      ]);

      expect(shown).toHaveLength(2);

      for (const output of shown) {
        expect(output).not.toContain(OUTSIDE_MARKER);
      }
    });

    test("write_file never writes outside the workspace through a link", async () => {
      const InHouseCodeAgent: typeof InHouseCodeAgentType =
        loadAgent(isGlobalRunner);
      const fixture: Fixture = makeFixture();

      const { shown } = await runAgent(InHouseCodeAgent, fixture.workspace, [
        toolCall(
          "write_file",
          { path: "linked-file.txt", content: "overwritten" },
          1,
        ),
        toolCall(
          "write_file",
          { path: "linked-dir/new-file.txt", content: "created" },
          2,
        ),
        toolCall(
          "write_file",
          { path: "dangling.txt", content: "created through a dangling link" },
          3,
        ),
      ]);

      expect(shown).toHaveLength(3);

      for (const output of shown) {
        expect(output).toContain("outside the workspace");
      }

      // Nothing outside the workspace changed or appeared.
      expect(fs.readFileSync(fixture.outsideFile, "utf-8")).toBe(
        `${OUTSIDE_MARKER}\n`,
      );
      expect(fs.readdirSync(fixture.outsideDir).sort()).toEqual([
        "settings.txt",
      ]);
    });

    test("write_file never writes the repository's git metadata, directly or through a link", async () => {
      const InHouseCodeAgent: typeof InHouseCodeAgentType =
        loadAgent(isGlobalRunner);
      const fixture: Fixture = makeFixture();
      const before: Map<string, string> = snapshotGitMetadata(
        fixture.workspace,
      );

      const { shown } = await runAgent(InHouseCodeAgent, fixture.workspace, [
        toolCall("write_file", { path: ".git/config", content: "[core]\n" }, 1),
        toolCall(
          "write_file",
          { path: ".git/info/attributes", content: "* text\n" },
          2,
        ),
        toolCall(
          "write_file",
          { path: "src/../.git/description", content: "changed" },
          3,
        ),
        toolCall("write_file", { path: ".GIT/config", content: "[core]\n" }, 4),
        toolCall(
          "write_file",
          { path: "linked-meta/config", content: "[core]\n" },
          5,
        ),
        toolCall(
          "write_file",
          {
            path: path.join(fixture.workspace, ".git", "HEAD"),
            content: "ref: refs/heads/other\n",
          },
          6,
        ),
      ]);

      expect(shown).toHaveLength(6);

      for (const output of shown) {
        expect(output).toContain("git metadata");
      }

      // The git metadata is byte-for-byte what it was before the agent ran.
      expect(snapshotGitMetadata(fixture.workspace)).toEqual(before);
      // By its exact name: a disk that ignores case (macOS) finds .git there.
      expect(fs.readdirSync(fixture.workspace)).not.toContain(".GIT");
    });

    test("the file tools still work inside the working tree (no regression)", async () => {
      const InHouseCodeAgent: typeof InHouseCodeAgentType =
        loadAgent(isGlobalRunner);
      const fixture: Fixture = makeFixture();

      const { result, shown } = await runAgent(
        InHouseCodeAgent,
        fixture.workspace,
        [
          toolCall("read_file", { path: "src/checkout.ts" }, 1),
          toolCall("read_file", { path: "ALIAS.md" }, 2),
          toolCall("list_directory", { path: "." }, 3),
          toolCall(
            "write_file",
            {
              path: "src/checkout.ts",
              content: "export function checkout(): number {\n  return 2;\n}\n",
            },
            4,
          ),
          toolCall(
            "write_file",
            { path: "src/new/deep/helper.ts", content: "export {};\n" },
            5,
          ),
          toolCall(
            "write_file",
            { path: ".github/workflows/ci.yml", content: "name: ci\n" },
            6,
          ),
          toolCall("search_files", { pattern: "return 2" }, 7),
        ],
      );

      expect(shown).toHaveLength(7);
      expect(shown[0]).toBe(ORIGINAL_SOURCE);
      // A link that stays inside the working tree reads its target.
      expect(shown[1]).toBe("# app\n");
      expect(shown[2]).toContain("src/");
      expect(shown[2]).toContain(".git/");

      expect(
        fs.readFileSync(path.join(fixture.workspace, "src", "checkout.ts"), {
          encoding: "utf-8",
        }),
      ).toContain("return 2");
      expect(
        fs.existsSync(
          path.join(fixture.workspace, "src", "new", "deep", "helper.ts"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(fixture.workspace, ".github", "workflows", "ci.yml"),
        ),
      ).toBe(true);

      expect(result.success).toBe(true);
      expect(result.filesModified).toEqual(
        expect.arrayContaining([
          "src/checkout.ts",
          "src/new/deep/helper.ts",
          ".github/workflows/ci.yml",
        ]),
      );
    });
  },
);
