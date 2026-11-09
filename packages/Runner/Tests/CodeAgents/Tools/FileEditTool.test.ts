/*
 * edit_file (issue #6441): change a file by replacing exact text. Before
 * it, the only way to change a file was write_file with the whole file -
 * on a file of thousands of lines, more than the model could write in one
 * answer, and every line it did not mean to touch at risk. These pin that
 * an edit changes exactly the text it names and nothing else, that a set of
 * edits lands all or none, and that a miss says how to get it right.
 */

import FileEditTool, {
  FileEditsApplied,
} from "../../../CodeAgents/Tools/FileEditTool";
import {
  CodeAgentToolContext,
  ToolExecution,
} from "../../../CodeAgents/Tools/CodeAgentToolTypes";
import { MAX_WRITE_FILE_CHARS } from "Common/Server/Utils/AI/CodeFix/CodeAgentWorkspaceGuard";
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

const CHECKOUT: string = [
  "export function total(items: Array<number>): number {",
  "  let sum: number = 0;",
  "  for (const item of items) {",
  "    sum += item;",
  "  }",
  "  return sum;",
  "}",
  "",
  "export function count(items: Array<number>): number {",
  "  return items.length;",
  "}",
  "",
].join("\n");

async function edit(
  context: CodeAgentToolContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  return FileEditTool.edit(context, args as never);
}

describe("edit_file replaces exact text", () => {
  test("one edit changes that text, and only it, and shows the lines around it as they now read", async () => {
    const root: string = makeRepository({ "src/checkout.ts": CHECKOUT });
    const context: CodeAgentToolContext = makeContext(root);

    const result: ToolExecution = await edit(context, {
      path: "src/checkout.ts",
      old_text: "    sum += item;",
      new_text: "    sum += item * 2;",
    });

    expect(readFile(root, "src/checkout.ts")).toBe(
      CHECKOUT.replace("    sum += item;", "    sum += item * 2;"),
    );
    expect(result.output).toBe(
      [
        "Edited src/checkout.ts: 1 replacement. The changed lines now read:",
        "     1\texport function total(items: Array<number>): number {",
        "     2\t  let sum: number = 0;",
        "     3\t  for (const item of items) {",
        "     4\t    sum += item * 2;",
        "     5\t  }",
        "     6\t  return sum;",
        "     7\t}",
      ].join("\n"),
    );
    expect(result.narration).toBe("edited src/checkout.ts (1 replacement)");
    // The model's own change: always staged, never taken for build output.
    expect(context.changes.writtenPaths.has("src/checkout.ts")).toBe(true);
  });

  test("the model's own aliases for the arguments are read too", async () => {
    const root: string = makeRepository({ "a.ts": "const a = 1;\n" });

    await edit(makeContext(root), {
      file_path: "a.ts",
      old_string: "const a = 1;",
      new_string: "const a = 2;",
    });

    expect(readFile(root, "a.ts")).toBe("const a = 2;\n");
  });

  test("an empty new_text removes the text", async () => {
    const root: string = makeRepository({
      "a.ts": "keep\nremove me\nkeep too\n",
    });

    await edit(makeContext(root), {
      path: "a.ts",
      old_text: "remove me\n",
      new_text: "",
    });

    expect(readFile(root, "a.ts")).toBe("keep\nkeep too\n");
  });

  /*
   * The customer's case (issue #6441): a change near the end of a file of
   * 2,055 lines - every other line byte for byte as it was.
   */
  test("an edit deep in a 2,055-line file changes that one line and no other", async () => {
    const lines: Array<string> = Array.from(
      { length: 2055 },
      (_: unknown, index: number) => {
        return `  public handler${index + 1}(): number { return ${index + 1}; }`;
      },
    );
    const root: string = makeRepository({
      "src/Service.ts": `${lines.join("\n")}\n`,
    });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/Service.ts",
      old_text: "  public handler1900(): number { return 1900; }",
      new_text: "  public handler1900(): number { return 19000; }",
    });

    expect(result.output).toContain(
      "  1900\t  public handler1900(): number { return 19000; }",
    );
    expect(result.output).toContain("  1897\t");
    expect(result.output).toContain("  1903\t");

    const after: Array<string> = readFile(root, "src/Service.ts").split("\n");
    expect(after).toHaveLength(2056);

    after.slice(0, 2055).forEach((line: string, index: number) => {
      expect(line).toBe(
        index === 1899
          ? "  public handler1900(): number { return 19000; }"
          : lines[index],
      );
    });

    expect(git(root, ["diff", "--numstat"]).trim()).toBe(
      "1\t1\tsrc/Service.ts",
    );
  });

  test("an edit keeps the file's mode: an executable script stays executable", async () => {
    const root: string = makeRepository({ "run.sh": "#!/bin/sh\necho one\n" });
    fs.chmodSync(path.join(root, "run.sh"), 0o755);

    await edit(makeContext(root), {
      path: "run.sh",
      old_text: "echo one",
      new_text: "echo two",
    });

    expect(fs.statSync(path.join(root, "run.sh")).mode & 0o777).toBe(0o755);
  });

  test("an edit through a link inside the workspace changes the file it points at", async () => {
    const root: string = makeRepository({ "README.md": "# app\n" });
    fs.symlinkSync("README.md", path.join(root, "ALIAS.md"));
    const context: CodeAgentToolContext = makeContext(root);

    const result: ToolExecution = await edit(context, {
      path: "ALIAS.md",
      old_text: "# app",
      new_text: "# the app",
    });

    expect(readFile(root, "README.md")).toBe("# the app\n");
    expect(fs.lstatSync(path.join(root, "ALIAS.md")).isSymbolicLink()).toBe(
      true,
    );
    expect(result.output).toContain("Edited README.md");
    expect(context.changes.writtenPaths.has("README.md")).toBe(true);
  });
});

describe("several edits in one call", () => {
  test("apply in order, each to the text the one before it left", async () => {
    const root: string = makeRepository({ "src/checkout.ts": CHECKOUT });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/checkout.ts",
      edits: [
        {
          old_text: "let sum: number = 0;",
          new_text: "let total: number = 0;",
        },
        { old_text: "    sum += item;", new_text: "    total += item;" },
        { old_text: "  return sum;", new_text: "  return total;" },
        {
          old_text: "  return items.length;",
          new_text: "  return items.filter(Boolean).length;",
        },
      ],
    });

    expect(readFile(root, "src/checkout.ts")).toBe(
      CHECKOUT.replace("let sum: number = 0;", "let total: number = 0;")
        .replace("    sum += item;", "    total += item;")
        .replace("  return sum;", "  return total;")
        .replace(
          "  return items.length;",
          "  return items.filter(Boolean).length;",
        ),
    );
    expect(result.output).toContain("Edited src/checkout.ts: 4 replacements.");
    // Both changed places are shown: they are near enough to read as one.
    expect(result.output).toContain("     2\t  let total: number = 0;");
    expect(result.output).toContain(
      "    10\t  return items.filter(Boolean).length;",
    );
  });

  test("land all or none: a later edit that does not match leaves the file as it was", async () => {
    const root: string = makeRepository({ "src/checkout.ts": CHECKOUT });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/checkout.ts",
      edits: [
        {
          old_text: "let sum: number = 0;",
          new_text: "let total: number = 0;",
        },
        { old_text: "this text is not in the file", new_text: "x" },
      ],
    });

    expect(readFile(root, "src/checkout.ts")).toBe(CHECKOUT);
    expect(
      result.output.startsWith(
        "Error: Edit 2 of 2: old_text is not in src/checkout.ts (as the edits before this one left it).",
      ),
    ).toBe(true);
    expect(result.output.endsWith("Nothing was changed.")).toBe(true);
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });

  test("changed places far apart are shown apart", async () => {
    const lines: Array<string> = Array.from(
      { length: 100 },
      (_: unknown, index: number) => {
        return `line ${index + 1}`;
      },
    );
    const root: string = makeRepository({ "a.txt": `${lines.join("\n")}\n` });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "a.txt",
      edits: [
        { old_text: "line 10\n", new_text: "line ten\n" },
        { old_text: "line 90\n", new_text: "line ninety\n" },
      ],
    });

    expect(result.output).toBe(
      [
        "Edited a.txt: 2 replacements. The changed lines now read:",
        "     7\tline 7",
        "     8\tline 8",
        "     9\tline 9",
        "    10\tline ten",
        "    11\tline 11",
        "    12\tline 12",
        "    13\tline 13",
        "...",
        "    87\tline 87",
        "    88\tline 88",
        "    89\tline 89",
        "    90\tline ninety",
        "    91\tline 91",
        "    92\tline 92",
        "    93\tline 93",
      ].join("\n"),
    );
  });

  test("more edits than one call may make are refused", async () => {
    const root: string = makeRepository({ "a.txt": "a\n" });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "a.txt",
      edits: Array.from({ length: 51 }, (_: unknown, index: number) => {
        return { old_text: `x${index}`, new_text: `y${index}` };
      }),
    });

    expect(result.output).toBe(
      "Error: one call may make at most 50 edits; split them over several calls.",
    );
  });
});

describe("an edit that does not match says why, and changes nothing", () => {
  test("text in the file more than once is refused, naming every place it is", async () => {
    const root: string = makeRepository({ "src/checkout.ts": CHECKOUT });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/checkout.ts",
      old_text: "): number {",
      new_text: "): Promise<number> {",
    });

    expect(result.output).toBe(
      "Error: old_text is in src/checkout.ts 2 times (at lines 1, 9). Include more of the lines around it so it matches one place only, or set replace_all to change every one.\nNothing was changed.",
    );
    expect(readFile(root, "src/checkout.ts")).toBe(CHECKOUT);
  });

  test("replace_all changes every place", async () => {
    const root: string = makeRepository({ "src/checkout.ts": CHECKOUT });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/checkout.ts",
      old_text: "Array<number>",
      new_text: "ReadonlyArray<number>",
      replace_all: true,
    });

    expect(readFile(root, "src/checkout.ts")).toBe(
      CHECKOUT.split("Array<number>").join("ReadonlyArray<number>"),
    );
    expect(result.output).toContain("2 replacements");
  });

  test("old_text copied with read_file's line numbers says to leave them out", async () => {
    const root: string = makeRepository({ "src/checkout.ts": CHECKOUT });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/checkout.ts",
      old_text: "     4\t    sum += item;\n     5\t  }",
      new_text: "    sum += item * 2;\n  }",
    });

    expect(result.output).toBe(
      "Error: old_text is not in src/checkout.ts: its lines start with the line numbers read_file shows. Leave them out - the number and the tab after it are not part of the file.\nNothing was changed.",
    );
  });

  test("text that differs only in its indentation is found, and shown as it reads", async () => {
    const root: string = makeRepository({ "src/checkout.ts": CHECKOUT });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/checkout.ts",
      old_text: "for (const item of items) {\n  sum += item;\n}",
      new_text: "for (const item of items) {\n  sum += 2 * item;\n}",
    });

    expect(result.output).toBe(
      [
        "Error: old_text is not in src/checkout.ts exactly as written, but lines 3-5 match it apart from whitespace (indentation, tabs or spaces at the ends of lines). Copy them exactly as they read here:",
        "     3\t  for (const item of items) {",
        "     4\t    sum += item;",
        "     5\t  }",
        "Nothing was changed.",
      ].join("\n"),
    );
  });

  test("text whose first line is in the file but not the rest shows where that line is", async () => {
    const root: string = makeRepository({ "src/checkout.ts": CHECKOUT });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/checkout.ts",
      old_text: "  let sum: number = 0;\n  for (const entry of items) {",
      new_text: "  let sum = 0;",
    });

    expect(result.output).toBe(
      [
        "Error: old_text is not in src/checkout.ts. Its first line is at line 2, but the lines after it differ from old_text. Lines 2-5 read:",
        "     2\t  let sum: number = 0;",
        "     3\t  for (const item of items) {",
        "     4\t    sum += item;",
        "     5\t  }",
        "Nothing was changed.",
      ].join("\n"),
    );
  });

  test("text nowhere in the file says to read it again", async () => {
    const root: string = makeRepository({ "src/checkout.ts": CHECKOUT });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/checkout.ts",
      old_text: "nothing like this",
      new_text: "x",
    });

    expect(result.output).toBe(
      "Error: old_text is not in src/checkout.ts. Read the lines you mean to change again with read_file - the file may have changed since you read it - and copy them exactly, without the line numbers.\nNothing was changed.",
    );
  });

  test.each([
    [
      { old_text: "", new_text: "x" },
      "Error: old_text is required and may not be empty: the exact text to replace. To create a file, use write_file.",
    ],
    [
      { old_text: "a" },
      "Error: new_text is required: what old_text becomes (an empty string removes it).",
    ],
    [
      { old_text: "a", new_text: "a" },
      "Error: old_text and new_text are the same, so this edit changes nothing.",
    ],
    [
      {},
      "Error: edit_file needs old_text (the exact text to replace) and new_text (what it becomes), or edits: a list of them.",
    ],
    [
      { edits: ["a"] },
      "Error: each entry of edits must be an object with old_text and new_text.",
    ],
    [
      {
        edits: [
          { old_text: "a", new_text: "b" },
          { old_text: "b", new_text: "b" },
        ],
      },
      "Error: edit 2 of 2: old_text and new_text are the same, so this edit changes nothing.",
    ],
  ])(
    "arguments %j are refused: %s",
    async (args: Record<string, unknown>, expected: string) => {
      const root: string = makeRepository({ "a.txt": "a\n" });

      const result: ToolExecution = await edit(makeContext(root), {
        path: "a.txt",
        ...args,
      });

      expect(result.output).toBe(expected);
      expect(readFile(root, "a.txt")).toBe("a\n");
    },
  );
});

describe("line endings and encodings", () => {
  test("a file with Windows line endings keeps them, for an edit written with plain newlines", async () => {
    const root: string = makeRepository({
      "win.txt": "one\r\ntwo\r\nthree\r\n",
    });

    await edit(makeContext(root), {
      path: "win.txt",
      old_text: "two\nthree",
      new_text: "2\n3\n3.5",
    });

    expect(readFile(root, "win.txt")).toBe("one\r\n2\r\n3\r\n3.5\r\n");
  });

  test("a file that mixes line endings still takes an edit written as it was read", async () => {
    // Mostly CRLF, with one plain line ending where the edit is.
    const root: string = makeRepository({ "mixed.txt": "a\r\nb\r\nc\nd\r\n" });

    await edit(makeContext(root), {
      path: "mixed.txt",
      old_text: "c\nd",
      new_text: "C\nD",
    });

    expect(readFile(root, "mixed.txt")).toBe("a\r\nb\r\nC\nD\r\n");
  });

  test("a file that is not UTF-8 is left as it is", async () => {
    const latin1: Buffer = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    const root: string = makeRepository({ "menu.txt": latin1 });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "menu.txt",
      old_text: "caf",
      new_text: "bar",
    });

    expect(result.output).toContain("is not UTF-8 text");
    expect(fs.readFileSync(path.join(root, "menu.txt")).equals(latin1)).toBe(
      true,
    );
  });

  test("a binary file is refused", async () => {
    const root: string = makeRepository({
      "logo.png": Buffer.from([0x89, 0x50, 0x00, 0x47]),
    });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "logo.png",
      old_text: "P",
      new_text: "Q",
    });

    expect(result.output).toBe(
      "Error: logo.png is a binary file; edit_file changes text files only.",
    );
  });
});

describe("where edit_file may not go", () => {
  test("a file that does not exist points at write_file", async () => {
    const root: string = makeRepository({ "a.txt": "a\n" });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "src/new.ts",
      old_text: "a",
      new_text: "b",
    });

    expect(result.output).toBe(
      "Error: src/new.ts does not exist. write_file creates a new file.",
    );
  });

  test("the repository's git metadata is never edited, directly or through a link", async () => {
    const root: string = makeRepository({ "a.txt": "a\n" });
    fs.symlinkSync(".git", path.join(root, "meta"));
    const before: Map<string, string> = snapshotGitMetadata(root);

    for (const target of [
      ".git/config",
      "meta/config",
      "src/../.git/HEAD",
      ".GIT/config",
    ]) {
      await expect(
        edit(makeContext(root), {
          path: target,
          old_text: "[core]",
          new_text: "[core]\n\thooksPath = /tmp",
        }),
      ).rejects.toThrow("git metadata");
    }

    expect(snapshotGitMetadata(root)).toEqual(before);
  });

  test("a file outside the workspace is never edited through a link", async () => {
    const outside: string = makeTemporaryDirectory("edit-outside-");
    fs.writeFileSync(path.join(outside, "settings.txt"), "value = 1\n");
    const root: string = makeRepository({ "a.txt": "a\n" });
    fs.symlinkSync(
      path.join(outside, "settings.txt"),
      path.join(root, "linked.txt"),
    );
    fs.symlinkSync(outside, path.join(root, "linked-dir"));

    for (const target of [
      "linked.txt",
      "linked-dir/settings.txt",
      "../settings.txt",
    ]) {
      await expect(
        edit(makeContext(root), {
          path: target,
          old_text: "value = 1",
          new_text: "value = 2",
        }),
      ).rejects.toThrow();
    }

    expect(fs.readFileSync(path.join(outside, "settings.txt"), "utf-8")).toBe(
      "value = 1\n",
    );
  });

  test("an edit that would make the file larger than a file may be is refused", async () => {
    const root: string = makeRepository({ "a.txt": "seed\n" });

    const result: ToolExecution = await edit(makeContext(root), {
      path: "a.txt",
      old_text: "seed",
      new_text: "x".repeat(MAX_WRITE_FILE_CHARS),
    });

    expect(result.output).toContain(
      "past the 2,000,000 a file may have. Nothing was changed.",
    );
    expect(readFile(root, "a.txt")).toBe("seed\n");
  });
});

describe("FileEditTool.applyEdits (pure)", () => {
  test("an edit inside text an earlier edit wrote applies to it", () => {
    const applied: FileEditsApplied = FileEditTool.applyEdits({
      content: "alpha\n",
      edits: [
        { oldText: "alpha", newText: "alpha beta", replaceAll: false },
        { oldText: "beta", newText: "gamma", replaceAll: false },
      ],
      relativePath: "a.txt",
    });

    expect(applied).toEqual({
      ok: true,
      content: "alpha gamma\n",
      regions: expect.any(Array),
      replacements: 2,
    });
  });

  test("text containing $ patterns is written as it is, never read as a replacement pattern", () => {
    const applied: FileEditsApplied = FileEditTool.applyEdits({
      content: "price\n",
      edits: [
        { oldText: "price", newText: "$& costs $$1 $1", replaceAll: false },
      ],
      relativePath: "a.txt",
    });

    expect(applied.ok && applied.content).toBe("$& costs $$1 $1\n");
  });
});
