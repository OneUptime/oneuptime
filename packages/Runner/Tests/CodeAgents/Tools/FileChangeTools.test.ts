/*
 * write_file, delete_file and move_file (issue #6441). A change that needs
 * a file deleted or moved used to need a shell, which a global Runner never
 * runs - so it could not be made there at all. And write_file replaced a
 * file whole even when the model had never read it: a model writing a large
 * file again from memory deletes every line it forgot. These pin what each
 * tool does to the working tree, what the pipeline then stages, and the
 * places none of them may go.
 */

import FileChangeTools from "../../../CodeAgents/Tools/FileChangeTools";
import FileEditTool from "../../../CodeAgents/Tools/FileEditTool";
import FileReadTool from "../../../CodeAgents/Tools/FileReadTool";
import {
  CodeAgentToolContext,
  ToolExecution,
} from "../../../CodeAgents/Tools/CodeAgentToolTypes";
import {
  git,
  makeContext,
  makeRepository,
  makeTemporaryDirectory,
  readFile,
  removeTemporaryDirectories,
  snapshotGitMetadata,
} from "./ToolTestRepository";
import fs from "fs";
import path from "path";

jest.setTimeout(60000);

afterAll(() => {
  removeTemporaryDirectories();
});

function call(
  tool: (context: CodeAgentToolContext, args: never) => Promise<ToolExecution>,
  context: CodeAgentToolContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  return tool(context, args as never);
}

// The paths git would stage with `git add --all -- <paths>`, and how.
function stagedChanges(root: string, paths: Array<string>): string {
  git(root, ["add", "--all", "--", ...paths]);
  return git(root, ["diff", "--cached", "--name-status", "-M"]).trim();
}

describe("write_file", () => {
  test("creates a new file and its folders", async () => {
    const root: string = makeRepository({ "a.txt": "a\n" });
    const context: CodeAgentToolContext = makeContext(root);

    const result: ToolExecution = await call(
      FileChangeTools.writeFile,
      context,
      {
        path: "src/deep/new.ts",
        content: "export const x = 1;\n",
      },
    );

    expect(result.output).toBe(
      "Wrote 20 characters to src/deep/new.ts (a new file).",
    );
    expect(readFile(root, "src/deep/new.ts")).toBe("export const x = 1;\n");
    expect(context.changes.writtenPaths.has("src/deep/new.ts")).toBe(true);
  });

  /*
   * A file the model never read is a file it would be writing from memory:
   * every line it does not remember is deleted. It reads it first, and
   * changes it with edit_file.
   */
  test("an existing file the task has not read is not replaced, and the model is told what to do", async () => {
    const root: string = makeRepository({
      "src/big.ts": "line 1\nline 2\nline 3\n",
    });

    const result: ToolExecution = await call(
      FileChangeTools.writeFile,
      makeContext(root),
      { path: "src/big.ts", content: "line 1\n" },
    );

    expect(result.output).toBe(
      "Error: src/big.ts already exists, and you have not read it in this task. write_file replaces a whole file: read it first with read_file, and change it with edit_file, which replaces only the text you name.",
    );
    expect(readFile(root, "src/big.ts")).toBe("line 1\nline 2\nline 3\n");
  });

  test("an existing file the task has read may be replaced whole", async () => {
    const root: string = makeRepository({ "a.ts": "old\n" });
    const context: CodeAgentToolContext = makeContext(root);

    await call(FileReadTool.read, context, { path: "a.ts" });
    const result: ToolExecution = await call(
      FileChangeTools.writeFile,
      context,
      {
        path: "a.ts",
        content: "new\n",
      },
    );

    expect(result.output).toBe("Wrote 4 characters to a.ts.");
    expect(readFile(root, "a.ts")).toBe("new\n");
  });

  test("a file the task changed with edit_file, or wrote, may be written again", async () => {
    const root: string = makeRepository({ "a.ts": "old\n" });
    const context: CodeAgentToolContext = makeContext(root);

    await call(FileEditTool.edit, context, {
      path: "a.ts",
      old_text: "old",
      new_text: "edited",
    });
    await call(FileChangeTools.writeFile, context, {
      path: "a.ts",
      content: "again\n",
    });
    await call(FileChangeTools.writeFile, context, {
      path: "b.ts",
      content: "b\n",
    });
    await call(FileChangeTools.writeFile, context, {
      path: "b.ts",
      content: "b2\n",
    });

    expect(readFile(root, "a.ts")).toBe("again\n");
    expect(readFile(root, "b.ts")).toBe("b2\n");
  });

  test("a folder is never written as a file", async () => {
    const root: string = makeRepository({ "src/a.ts": "a\n" });

    const result: ToolExecution = await call(
      FileChangeTools.writeFile,
      makeContext(root),
      { path: "src", content: "x" },
    );

    expect(result.output).toBe("Error: src is a directory.");
  });
});

describe("delete_file", () => {
  test("deletes a file, and the deletion is part of the change the pipeline stages", async () => {
    const root: string = makeRepository({
      "src/old.ts": "old\n",
      "src/keep.ts": "keep\n",
    });
    const context: CodeAgentToolContext = makeContext(root);

    const result: ToolExecution = await call(
      FileChangeTools.deleteFile,
      context,
      {
        path: "src/old.ts",
      },
    );

    expect(result.output).toBe("Deleted src/old.ts.");
    expect(result.narration).toBe("deleted src/old.ts");
    expect(fs.existsSync(path.join(root, "src", "old.ts"))).toBe(false);
    expect(context.changes.writtenPaths.has("src/old.ts")).toBe(true);
    expect(stagedChanges(root, Array.from(context.changes.writtenPaths))).toBe(
      "D\tsrc/old.ts",
    );
  });

  test("a link is deleted as the link: the file it points at stays", async () => {
    const outside: string = makeTemporaryDirectory("delete-outside-");
    fs.writeFileSync(path.join(outside, "settings.txt"), "keep me\n");
    const root: string = makeRepository({ "a.txt": "a\n" });
    fs.symlinkSync(
      path.join(outside, "settings.txt"),
      path.join(root, "linked.txt"),
    );

    await call(FileChangeTools.deleteFile, makeContext(root), {
      path: "linked.txt",
    });

    expect(fs.existsSync(path.join(root, "linked.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(outside, "settings.txt"), "utf-8")).toBe(
      "keep me\n",
    );
  });

  test("a file outside the workspace is never deleted through a link to its folder", async () => {
    const outside: string = makeTemporaryDirectory("delete-outside-");
    fs.writeFileSync(path.join(outside, "settings.txt"), "keep me\n");
    const root: string = makeRepository({ "a.txt": "a\n" });
    fs.symlinkSync(outside, path.join(root, "linked-dir"));

    await expect(
      call(FileChangeTools.deleteFile, makeContext(root), {
        path: "linked-dir/settings.txt",
      }),
    ).rejects.toThrow("leads outside the workspace");
    await expect(
      call(FileChangeTools.deleteFile, makeContext(root), { path: "../a.txt" }),
    ).rejects.toThrow();

    expect(fs.existsSync(path.join(outside, "settings.txt"))).toBe(true);
  });

  test("the git metadata, the workspace itself and folders are never deleted", async () => {
    const root: string = makeRepository({ "src/a.ts": "a\n" });
    fs.symlinkSync(".git", path.join(root, "meta"));
    const before: Map<string, string> = snapshotGitMetadata(root);

    for (const target of [".git/config", ".git", "meta/HEAD", ".GIT/index"]) {
      await expect(
        call(FileChangeTools.deleteFile, makeContext(root), { path: target }),
      ).rejects.toThrow("git metadata");
    }

    await expect(
      call(FileChangeTools.deleteFile, makeContext(root), { path: "." }),
    ).rejects.toThrow("workspace root");

    expect(
      (
        await call(FileChangeTools.deleteFile, makeContext(root), {
          path: "src",
        })
      ).output,
    ).toBe(
      "Error: src is a directory; delete_file deletes one file at a time.",
    );
    expect(snapshotGitMetadata(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "src", "a.ts"))).toBe(true);
  });

  test("a file that is not there says so", async () => {
    const root: string = makeRepository({ "a.txt": "a\n" });

    expect(
      (
        await call(FileChangeTools.deleteFile, makeContext(root), {
          path: "b.txt",
        })
      ).output,
    ).toBe("Error: b.txt does not exist.");
    expect(
      (await call(FileChangeTools.deleteFile, makeContext(root), {})).output,
    ).toBe("Error: a path is required: the file to delete.");
  });
});

describe("move_file", () => {
  test("moves a file into folders it creates, and git stages it as a rename", async () => {
    const content: string = Array.from(
      { length: 30 },
      (_: unknown, index: number) => {
        return `export const value${index} = ${index};`;
      },
    ).join("\n");
    const root: string = makeRepository({ "src/old-name.ts": `${content}\n` });
    const context: CodeAgentToolContext = makeContext(root);

    const result: ToolExecution = await call(
      FileChangeTools.moveFile,
      context,
      {
        from: "src/old-name.ts",
        to: "src/lib/new-name.ts",
      },
    );

    expect(result.output).toBe("Moved src/old-name.ts to src/lib/new-name.ts.");
    expect(readFile(root, "src/lib/new-name.ts")).toBe(`${content}\n`);
    expect(fs.existsSync(path.join(root, "src", "old-name.ts"))).toBe(false);
    expect(Array.from(context.changes.writtenPaths).sort()).toEqual([
      "src/lib/new-name.ts",
      "src/old-name.ts",
    ]);
    expect(stagedChanges(root, Array.from(context.changes.writtenPaths))).toBe(
      "R100\tsrc/old-name.ts\tsrc/lib/new-name.ts",
    );
  });

  test("never moves a file over another one", async () => {
    const root: string = makeRepository({ "a.ts": "a\n", "b.ts": "b\n" });

    const result: ToolExecution = await call(
      FileChangeTools.moveFile,
      makeContext(root),
      {
        from: "a.ts",
        to: "b.ts",
      },
    );

    expect(result.output).toBe(
      "Error: b.ts already exists. Delete it first, or move the file somewhere else.",
    );
    expect(readFile(root, "a.ts")).toBe("a\n");
    expect(readFile(root, "b.ts")).toBe("b\n");
  });

  test("moves one file at a time, and says when there is none", async () => {
    const root: string = makeRepository({ "src/a.ts": "a\n" });

    expect(
      (
        await call(FileChangeTools.moveFile, makeContext(root), {
          from: "src",
          to: "lib",
        })
      ).output,
    ).toBe("Error: src is a directory; move_file moves one file at a time.");
    expect(
      (
        await call(FileChangeTools.moveFile, makeContext(root), {
          from: "x.ts",
          to: "y.ts",
        })
      ).output,
    ).toBe("Error: x.ts does not exist.");
    expect(
      (
        await call(FileChangeTools.moveFile, makeContext(root), {
          from: "src/a.ts",
        })
      ).output,
    ).toBe(
      "Error: move_file needs from (the file to move) and to (its new path).",
    );
  });

  test("never moves a file out of the workspace, into it from outside, or into or out of the git metadata", async () => {
    const outside: string = makeTemporaryDirectory("move-outside-");
    fs.writeFileSync(path.join(outside, "settings.txt"), "outside\n");
    const root: string = makeRepository({ "a.ts": "a\n" });
    fs.symlinkSync(outside, path.join(root, "linked-dir"));
    fs.symlinkSync(".git", path.join(root, "meta"));
    const before: Map<string, string> = snapshotGitMetadata(root);

    const attempts: Array<{ from: string; to: string }> = [
      { from: "a.ts", to: "../a.ts" },
      { from: "a.ts", to: "linked-dir/a.ts" },
      { from: "linked-dir/settings.txt", to: "settings.txt" },
      { from: "a.ts", to: ".git/hooks/pre-commit" },
      { from: "a.ts", to: "meta/hooks/post-checkout" },
      { from: ".git/config", to: "config" },
    ];

    for (const attempt of attempts) {
      await expect(
        call(FileChangeTools.moveFile, makeContext(root), attempt),
      ).rejects.toThrow();
    }

    expect(readFile(root, "a.ts")).toBe("a\n");
    expect(fs.readdirSync(outside).sort()).toEqual(["settings.txt"]);
    expect(snapshotGitMetadata(root)).toEqual(before);
  });
});
