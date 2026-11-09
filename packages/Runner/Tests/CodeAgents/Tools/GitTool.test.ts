/*
 * The git tool (issue #6441): read-only git as a tool of the agent's own -
 * what it has changed (status, diff) and the history behind the code it is
 * changing (log, show, blame) - on every Runner, a global one included,
 * because the model only picks an action and fills in values, each checked.
 * These pin what each action shows, that nothing it does writes to the
 * repository, and that no value becomes an option or leaves the workspace.
 */

import GitTool from "../../../CodeAgents/Tools/GitTool";
import {
  CodeAgentToolContext,
  ToolExecution,
} from "../../../CodeAgents/Tools/CodeAgentToolTypes";
import {
  git,
  makeContext,
  makeRepository,
  makeTemporaryDirectory,
  removeTemporaryDirectories,
  snapshotGitMetadata,
  writeFile,
} from "./ToolTestRepository";
import fs from "fs";
import path from "path";

jest.setTimeout(60000);

afterAll(() => {
  removeTemporaryDirectories();
});

function run(
  context: CodeAgentToolContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  return GitTool.run(context, args as never);
}

// A repository with a short history: three commits that each change a file.
function makeHistory(): string {
  const root: string = makeRepository({
    "src/price.ts": "export const price = 10;\nexport const tax = 1;\n",
    "README.md": "# shop\n",
  });

  writeFile(
    root,
    "src/price.ts",
    "export const price = 12;\nexport const tax = 1;\n",
  );
  git(root, ["commit", "-q", "-am", "Raise the price"]);
  writeFile(root, "README.md", "# shop\n\nSells things.\n");
  git(root, ["commit", "-q", "-am", "Describe the shop"]);

  return root;
}

describe("what the git tool shows", () => {
  test("status lists what changed in the working tree, new files included", async () => {
    const root: string = makeHistory();
    writeFile(
      root,
      "src/price.ts",
      "export const price = 15;\nexport const tax = 1;\n",
    );
    writeFile(root, "src/new/discount.ts", "export const discount = 0;\n");

    const result: ToolExecution = await run(makeContext(root), {
      action: "status",
    });

    expect(result.output).toBe(
      ["## main", " M src/price.ts", "?? src/new/discount.ts"].join("\n"),
    );
    expect(result.narration).toBe("ran git status");
  });

  test("diff shows the change against HEAD, and names the new files a diff leaves out", async () => {
    const root: string = makeHistory();
    writeFile(
      root,
      "src/price.ts",
      "export const price = 15;\nexport const tax = 1;\n",
    );
    writeFile(root, "src/discount.ts", "export const discount = 0;\n");

    const result: ToolExecution = await run(makeContext(root), {
      action: "diff",
    });

    expect(result.output).toContain(
      "-export const price = 12;\n+export const price = 15;",
    );
    expect(result.output).toContain(
      "New files git does not track yet (diff leaves them out; read_file reads them):\n  src/discount.ts",
    );
  });

  test("diff with stat, and with no change at all", async () => {
    const root: string = makeHistory();
    const context: CodeAgentToolContext = makeContext(root);

    expect((await run(context, { action: "diff" })).output).toBe("No changes.");

    writeFile(root, "README.md", "# shop!\n");

    expect(
      (await run(context, { action: "diff", stat: true })).output,
    ).toContain("README.md | 4 +---");
  });

  test("diff against a revision, limited to a path", async () => {
    const root: string = makeHistory();

    const result: ToolExecution = await run(makeContext(root), {
      action: "diff",
      revision: "HEAD~2",
      path: "src",
    });

    expect(result.output).toContain(
      "-export const price = 10;\n+export const price = 12;",
    );
    expect(result.output).not.toContain("README.md");
    expect(result.narration).toBe("ran git diff HEAD~2 -- src");
  });

  test("log lists commits, newest first, as many as asked, for a path", async () => {
    const root: string = makeHistory();
    const context: CodeAgentToolContext = makeContext(root);

    const all: Array<string> = (
      await run(context, { action: "log" })
    ).output.split("\n");
    expect(all).toHaveLength(3);
    expect(all[0]).toMatch(
      /^[0-9a-f]{7,} \d{4}-\d{2}-\d{2} Runner Tests: Describe the shop$/,
    );
    expect(all[2]).toMatch(/ Runner Tests: baseline$/);

    expect(
      (await run(context, { action: "log", max_count: 1 })).output.split("\n"),
    ).toHaveLength(1);

    const forPrice: string = (
      await run(context, { action: "log", path: "src/price.ts" })
    ).output;
    expect(forPrice).toContain("Raise the price");
    expect(forPrice).not.toContain("Describe the shop");

    const withPatch: string = (
      await run(context, {
        action: "log",
        max_count: 1,
        patch: true,
        path: "src/price.ts",
      })
    ).output;
    expect(withPatch).toContain("+export const price = 12;");
  });

  test("show shows a commit, or a file as it was at a revision", async () => {
    const root: string = makeHistory();
    const context: CodeAgentToolContext = makeContext(root);

    const commit: string = (
      await run(context, { action: "show", revision: "HEAD~1" })
    ).output;
    expect(commit).toContain("Raise the price");
    expect(commit).toContain("+export const price = 12;");

    expect(
      (await run(context, { action: "show", revision: "HEAD~2:src/price.ts" }))
        .output,
    ).toBe("export const price = 10;\nexport const tax = 1;");
  });

  test("show with a path shows only that file's change in the commit", async () => {
    const root: string = makeHistory();
    writeFile(
      root,
      "src/price.ts",
      "export const price = 14;\nexport const tax = 1;\n",
    );
    writeFile(root, "README.md", "# shop\n\nSells more things.\n");
    git(root, ["commit", "-q", "-am", "Raise the price and say so"]);
    const context: CodeAgentToolContext = makeContext(root);

    const whole: string = (await run(context, { action: "show" })).output;
    expect(whole).toContain("+export const price = 14;");
    expect(whole).toContain("+Sells more things.");

    const result: ToolExecution = await run(context, {
      action: "show",
      path: "src/price.ts",
    });
    expect(result.output).toContain("Raise the price and say so");
    expect(result.output).toContain("+export const price = 14;");
    expect(result.output).not.toContain("README.md");
    expect(result.output).not.toContain("Sells more things.");
    expect(result.narration).toBe("ran git show -- src/price.ts");

    // A file at a revision is that file, whatever path says.
    expect(
      (
        await run(context, {
          action: "show",
          revision: "HEAD~3:src/price.ts",
          path: "src/price.ts",
        })
      ).output,
    ).toBe("export const price = 10;\nexport const tax = 1;");
  });

  test("blame says who last changed each line, for the lines asked", async () => {
    const root: string = makeHistory();

    const result: ToolExecution = await run(makeContext(root), {
      action: "blame",
      path: "src/price.ts",
      start_line: 1,
      end_line: 1,
    });

    expect(result.output.split("\n")).toHaveLength(1);
    expect(result.output).toMatch(
      /Runner Tests \d{4}-\d{2}-\d{2} +1\) export const price = 12;$/,
    );
  });

  test("a long answer is kept to read on with read_tool_output", async () => {
    const lines: Array<string> = Array.from(
      { length: 4000 },
      (_: unknown, index: number) => {
        return `export const value${index} = ${index};`;
      },
    );
    const root: string = makeRepository({ "big.ts": "" });
    writeFile(root, "big.ts", `${lines.join("\n")}\n`);
    const context: CodeAgentToolContext = makeContext(root);

    const result: ToolExecution = await run(context, { action: "diff" });

    expect(result.output).toMatch(
      /\[out-1: lines 1-\d+ of \d+ shown\. read_tool_output with output_id "out-1"/,
    );
    expect(
      context.outputs.read({ output_id: "out-1", pattern: "value3999 " })
        .output,
    ).toContain("+export const value3999 = 3999;");
  });
});

describe("what the git tool refuses", () => {
  test("an action that is not read-only", async () => {
    const root: string = makeHistory();

    for (const action of [
      "commit",
      "push",
      "checkout",
      "reset",
      "config",
      "",
    ]) {
      const result: ToolExecution = await run(makeContext(root), { action });

      expect(result.output).toBe(
        "Error: action must be one of status, diff, log, show, blame. Only read-only git is available: the pipeline commits, branches and pushes your change.",
      );
    }
  });

  test.each([
    "--output=/tmp/x",
    "-p",
    "HEAD --all",
    "HEAD;rm -rf .",
    "$(id)",
    "x".repeat(201),
  ])(
    "a revision that is not one (%s) never reaches git",
    async (revision: string) => {
      const root: string = makeHistory();

      const result: ToolExecution = await run(makeContext(root), {
        action: "log",
        revision,
      });

      expect(result.output).toContain(
        "is not a revision: a commit, a branch or tag, HEAD~3, a range like main..HEAD, or HEAD:path/to/file.",
      );
    },
  );

  test("a revision that does not exist reports git's answer", async () => {
    const root: string = makeHistory();

    const result: ToolExecution = await run(makeContext(root), {
      action: "show",
      revision: "no-such-branch",
    });

    expect(
      result.output.startsWith(
        "Error: git show failed: fatal: ambiguous argument 'no-such-branch'",
      ),
    ).toBe(true);
  });

  test("blame needs a file", async () => {
    const root: string = makeHistory();

    expect((await run(makeContext(root), { action: "blame" })).output).toBe(
      "Error: blame needs path: the file whose lines to explain.",
    );
  });

  test("a path that leaves the workspace through a link is refused", async () => {
    const outside: string = makeTemporaryDirectory("git-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "x\n");
    const root: string = makeHistory();
    fs.symlinkSync(outside, path.join(root, "linked-dir"));

    await expect(
      run(makeContext(root), { action: "log", path: "linked-dir/secret.txt" }),
    ).rejects.toThrow("leads outside the workspace");
    await expect(
      run(makeContext(root), { action: "blame", path: "../secret.txt" }),
    ).rejects.toThrow();
  });

  test("no action runs a program the git configuration names to show a file (a textconv filter)", async () => {
    const root: string = makeHistory();
    const scratch: string = makeTemporaryDirectory("git-textconv-");
    const marker: string = path.join(scratch, "textconv-ran");
    const filter: string = path.join(scratch, "textconv.sh");
    fs.writeFileSync(filter, `#!/bin/sh\ntouch '${marker}'\ncat "$1"\n`);
    fs.chmodSync(filter, 0o755);
    git(root, ["config", "diff.shout.textconv", filter]);
    writeFile(root, ".gitattributes", "*.ts diff=shout\n");
    git(root, ["add", ".gitattributes"]);
    git(root, ["commit", "-q", "-m", "Name a diff driver"]);
    writeFile(
      root,
      "src/price.ts",
      "export const price = 16;\nexport const tax = 1;\n",
    );

    // The filter works: git runs it when asked to.
    git(root, ["blame", "--textconv", "--", "src/price.ts"]);
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker);

    const context: CodeAgentToolContext = makeContext(root);
    const actions: Array<Record<string, unknown>> = [
      { action: "blame", path: "src/price.ts" },
      { action: "blame", path: "src/price.ts", revision: "HEAD~1" },
      { action: "log", path: "src/price.ts", stat: true },
      { action: "log", path: "src/price.ts", patch: true },
      { action: "show", revision: "HEAD~2" },
      { action: "show", revision: "HEAD~2", stat: true },
      { action: "diff" },
      { action: "diff", stat: true },
    ];

    for (const action of actions) {
      const result: ToolExecution = await run(context, action);

      // Each action on its own: a failure names the one that ran it.
      expect({
        action,
        failed: result.output.startsWith("Error"),
        filterRan: fs.existsSync(marker),
      }).toEqual({ action, failed: false, filterRan: false });
    }
  });

  test("nothing it does writes to the repository: not the index, not a ref, not a lock", async () => {
    const root: string = makeHistory();
    writeFile(
      root,
      "src/price.ts",
      "export const price = 99;\nexport const tax = 1;\n",
    );
    /*
     * A file whose index entry is stale (its time changed, not its text):
     * a plain git status, or any git diff, would write the index to
     * refresh it.
     */
    const future: Date = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(root, "README.md"), future, future);
    const before: Map<string, string> = snapshotGitMetadata(root);
    const context: CodeAgentToolContext = makeContext(root);
    const actions: Array<Record<string, unknown>> = [
      { action: "status" },
      { action: "diff" },
      { action: "diff", stat: true },
      { action: "log", patch: true },
      { action: "show" },
      { action: "blame", path: "README.md" },
    ];

    for (const action of actions) {
      await run(context, action);

      // Each action on its own: a failure names the one that wrote.
      expect({
        action,
        metadataUnchanged: Array.from(snapshotGitMetadata(root)).every(
          ([file, bytes]: [string, string]) => {
            return before.get(file) === bytes;
          },
        ),
        noLockLeft: !fs.existsSync(path.join(root, ".git", "index.lock")),
      }).toEqual({ action, metadataUnchanged: true, noLockLeft: true });
    }

    expect(snapshotGitMetadata(root)).toEqual(before);
  });
});
