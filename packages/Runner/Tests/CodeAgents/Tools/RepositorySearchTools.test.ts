/*
 * Finding things in a repository (issue #6441): search_files (lines, by a
 * regular expression or plain text, with globs and context), find_files
 * (files by name or glob) and list_directory (as deep as asked). All of
 * them see the repository as git does - tracked files and new ones, never
 * what .gitignore leaves out - so a search is about the code, not about
 * node_modules, and none of them leaves the workspace.
 */

import RepositorySearchTools from "../../../CodeAgents/Tools/RepositorySearchTools";
import {
  CodeAgentToolContext,
  ToolExecution,
} from "../../../CodeAgents/Tools/CodeAgentToolTypes";
import {
  makeContext,
  makeRepository,
  makeTemporaryDirectory,
  removeTemporaryDirectories,
  writeFile,
} from "./ToolTestRepository";
import fs from "fs";
import path from "path";

jest.setTimeout(60000);

afterAll(() => {
  removeTemporaryDirectories();
});

function search(
  context: CodeAgentToolContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  return RepositorySearchTools.searchFiles(context, args as never);
}

function find(
  context: CodeAgentToolContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  return RepositorySearchTools.findFiles(context, args as never);
}

function list(
  context: CodeAgentToolContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  return RepositorySearchTools.listDirectory(context, args as never);
}

function makeProject(): string {
  const root: string = makeRepository({
    ".gitignore": "node_modules/\ndist/\n*.log\n",
    "src/checkout.ts":
      "export function checkout(cart: Cart): number {\n  return applyDiscount(cart.total);\n}\n",
    "src/discount.ts":
      "export function applyDiscount(total: number): number {\n  return total * 0.9;\n}\n",
    "src/checkout.test.ts":
      "import { checkout } from './checkout';\ntest('checkout', () => {});\n",
    "src/views/Cart.tsx": "export const Cart = (): null => { return null; };\n",
    "docs/Guide.md": "# Guide\nCall applyDiscount(total) to discount.\n",
    "app/[id]/page.tsx":
      "export default function Page(): null { return null; }\n",
  });

  // Ignored: never searched, never listed.
  writeFile(root, "node_modules/lib/index.js", "function applyDiscount() {}\n");
  writeFile(root, "dist/bundle.js", "applyDiscount();\n");
  writeFile(root, "debug.log", "applyDiscount failed\n");

  return root;
}

describe("search_files", () => {
  test("finds lines by a regular expression, as path:line:text, in tracked and new files - never ignored ones", async () => {
    const root: string = makeProject();
    // A file the task just created, not yet tracked.
    writeFile(root, "src/new.ts", "export const value = applyDiscount(10);\n");

    const result: ToolExecution = await search(makeContext(root), {
      pattern: "applyDiscount\\(\\w+",
    });

    expect(result.output.split("\n").sort()).toEqual(
      [
        "docs/Guide.md:2:Call applyDiscount(total) to discount.",
        "src/checkout.ts:2:  return applyDiscount(cart.total);",
        "src/discount.ts:1:export function applyDiscount(total: number): number {",
        "src/new.ts:1:export const value = applyDiscount(10);",
      ].sort(),
    );
    expect(result.narration).toBe('searched files for "applyDiscount\\(\\w+"');
  });

  test("a new file is searched too", async () => {
    const root: string = makeProject();
    writeFile(root, "src/new.ts", "export const value = applyDiscount(10);\n");

    const result: ToolExecution = await search(makeContext(root), {
      pattern: "value = applyDiscount",
    });

    expect(result.output).toBe(
      "src/new.ts:1:export const value = applyDiscount(10);",
    );
  });

  test("literal searches for the text as written: characters a pattern would read are plain", async () => {
    const root: string = makeProject();

    const result: ToolExecution = await search(makeContext(root), {
      pattern: "applyDiscount(total)",
      literal: true,
    });

    expect(result.output).toBe(
      "docs/Guide.md:2:Call applyDiscount(total) to discount.",
    );
  });

  test("a pattern that is not a valid regular expression says to search for it as text", async () => {
    const root: string = makeProject();

    const result: ToolExecution = await search(makeContext(root), {
      pattern: "applyDiscount(",
    });

    expect(result.output.startsWith("Error: the search failed: ")).toBe(true);
    expect(
      result.output.endsWith(
        ". If the pattern is meant as plain text, set literal.",
      ),
    ).toBe(true);
  });

  test("a pattern that starts with a dash is a pattern, never an option", async () => {
    const root: string = makeRepository({ "a.txt": "flag --verbose here\n" });

    const result: ToolExecution = await search(makeContext(root), {
      pattern: "--verbose",
    });

    expect(result.output).toBe("a.txt:1:flag --verbose here");
  });

  test("case_insensitive ignores case", async () => {
    const root: string = makeProject();

    const result: ToolExecution = await search(makeContext(root), {
      pattern: "APPLYDISCOUNT\\(TOTAL",
      case_insensitive: true,
    });

    expect(result.output.split("\n").sort()).toEqual([
      "docs/Guide.md:2:Call applyDiscount(total) to discount.",
      "src/discount.ts:1:export function applyDiscount(total: number): number {",
    ]);
  });

  test("glob limits the files searched: by name anywhere, or by path", async () => {
    const root: string = makeProject();
    const context: CodeAgentToolContext = makeContext(root);

    expect(
      (await search(context, { pattern: "applyDiscount", glob: "*.md" }))
        .output,
    ).toBe("docs/Guide.md:2:Call applyDiscount(total) to discount.");
    expect(
      (await search(context, { pattern: "export", glob: "src/**/*.tsx" }))
        .output,
    ).toBe(
      "src/views/Cart.tsx:1:export const Cart = (): null => { return null; };",
    );
  });

  test("path limits the search to a folder or a file - even one named like a pattern", async () => {
    const root: string = makeProject();
    const context: CodeAgentToolContext = makeContext(root);

    expect(
      (await search(context, { pattern: "export", path: "src/views" })).output,
    ).toBe(
      "src/views/Cart.tsx:1:export const Cart = (): null => { return null; };",
    );
    expect(
      (await search(context, { pattern: "export", path: "app/[id]" })).output,
    ).toBe(
      "app/[id]/page.tsx:1:export default function Page(): null { return null; }",
    );
    expect(
      (await search(context, { pattern: "return", path: "src/discount.ts" }))
        .output,
    ).toBe("src/discount.ts:2:  return total * 0.9;");
  });

  test("context_lines shows the lines around each match", async () => {
    const root: string = makeProject();

    const result: ToolExecution = await search(makeContext(root), {
      pattern: "total \\* 0.9",
      context_lines: 1,
    });

    expect(result.output).toBe(
      [
        "src/discount.ts-1-export function applyDiscount(total: number): number {",
        "src/discount.ts:2:  return total * 0.9;",
        "src/discount.ts-3-}",
      ].join("\n"),
    );
  });

  test("files_only lists the files that match", async () => {
    const root: string = makeProject();

    const result: ToolExecution = await search(makeContext(root), {
      pattern: "applyDiscount",
      files_only: true,
    });

    expect(result.output.split("\n").sort()).toEqual([
      "docs/Guide.md",
      "src/checkout.ts",
      "src/discount.ts",
    ]);
  });

  test("no match says so, and never repeats the pattern back", async () => {
    const root: string = makeProject();
    const context: CodeAgentToolContext = makeContext(root);

    expect((await search(context, { pattern: "zz-not-there-zz" })).output).toBe(
      "No matches found (the pattern is read as a regular expression; set literal to search for the text as written).",
    );
    expect(
      (await search(context, { pattern: "zz-not-there-zz", literal: true }))
        .output,
    ).toBe("No matches found.");
  });

  test("a search that finds a lot shows the start and keeps the rest to read on", async () => {
    const lines: Array<string> = Array.from(
      { length: 3000 },
      (_: unknown, index: number) => {
        return `const item${index} = "needle number ${index}";`;
      },
    );
    const root: string = makeRepository({ "big.ts": `${lines.join("\n")}\n` });
    const context: CodeAgentToolContext = makeContext(root);

    const result: ToolExecution = await search(context, { pattern: "needle" });

    expect(result.output).toContain(
      'big.ts:1:const item0 = "needle number 0";',
    );
    expect(result.output).toMatch(
      /\[out-1: lines 1-\d+ of 3000 shown\. read_tool_output with output_id "out-1" and start_line \d+ reads on, or finds the lines that hold a text \(pattern\)\.\]$/,
    );
    expect(context.outputs.has("out-1")).toBe(true);
    expect(
      context.outputs.read({ output_id: "out-1", start_line: 3000 }).output,
    ).toContain('big.ts:3000:const item2999 = "needle number 2999";');
  });

  test("no pattern, or a glob that leaves the folder, is refused", async () => {
    const root: string = makeProject();
    const context: CodeAgentToolContext = makeContext(root);

    expect((await search(context, {})).output).toBe(
      "Error: a search pattern is required.",
    );
    expect(
      (await search(context, { pattern: "x", glob: "../**/*.ts" })).output,
    ).toBe(
      "Error: glob matches paths inside the folder searched: no .. and no leading /.",
    );
  });

  test("never searches outside the workspace, through a link or by path", async () => {
    const outside: string = makeTemporaryDirectory("search-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside-marker-81f2\n");
    const root: string = makeRepository({ "a.txt": "a\n" });
    fs.symlinkSync(
      path.join(outside, "secret.txt"),
      path.join(root, "linked.txt"),
    );
    fs.symlinkSync(outside, path.join(root, "linked-dir"));
    const context: CodeAgentToolContext = makeContext(root);

    expect(
      (await search(context, { pattern: "outside-marker" })).output,
    ).not.toContain("outside-marker-81f2");

    await expect(
      search(context, { pattern: "outside-marker", path: "linked-dir" }),
    ).rejects.toThrow("leads outside the workspace");
    await expect(
      search(context, { pattern: "outside-marker", path: "../" }),
    ).rejects.toThrow();
  });
});

describe("find_files", () => {
  test("a glob without a folder matches file names anywhere", async () => {
    const root: string = makeProject();

    const result: ToolExecution = await find(makeContext(root), {
      pattern: "*.test.ts",
    });

    expect(result.output).toBe("1 file matches:\nsrc/checkout.test.ts");
    expect(result.narration).toBe('searched file names for "*.test.ts"');
  });

  test("a glob with folders, ** and braces matches the path", async () => {
    const root: string = makeProject();

    const result: ToolExecution = await find(makeContext(root), {
      pattern: "src/**/*.{ts,tsx}",
    });

    expect(result.output).toBe(
      [
        "4 files match:",
        "src/checkout.test.ts",
        "src/checkout.ts",
        "src/discount.ts",
        "src/views/Cart.tsx",
      ].join("\n"),
    );
  });

  test("plain text matches any part of the path, case ignored", async () => {
    const root: string = makeProject();

    const result: ToolExecution = await find(makeContext(root), {
      pattern: "CHECKOUT",
    });

    expect(result.output).toBe(
      "2 files match:\nsrc/checkout.test.ts\nsrc/checkout.ts",
    );
  });

  test("a glob that matches nothing as written is tried again ignoring case, and says so", async () => {
    const root: string = makeProject();

    const globResult: ToolExecution = await find(makeContext(root), {
      pattern: "*.MD",
    });

    expect(globResult.output).toBe(
      "1 file matches (ignoring case):\ndocs/Guide.md",
    );
  });

  test("lists new files, never ignored ones nor deleted ones", async () => {
    const root: string = makeProject();
    writeFile(root, "src/added.ts", "export {};\n");
    fs.unlinkSync(path.join(root, "src", "discount.ts"));

    const result: ToolExecution = await find(makeContext(root), {
      pattern: "*.{ts,js}",
    });

    expect(result.output).toBe(
      [
        "3 files match:",
        "src/added.ts",
        "src/checkout.test.ts",
        "src/checkout.ts",
      ].join("\n"),
    );
  });

  test("path limits it to a folder - even one named like a pattern", async () => {
    const root: string = makeProject();
    const context: CodeAgentToolContext = makeContext(root);

    expect(
      (await find(context, { pattern: "*.tsx", path: "src" })).output,
    ).toBe("1 file matches:\nsrc/views/Cart.tsx");
    expect(
      (await find(context, { pattern: "page", path: "app/[id]" })).output,
    ).toBe("1 file matches:\napp/[id]/page.tsx");
  });

  test("nothing found, and no pattern, say so", async () => {
    const root: string = makeProject();
    const context: CodeAgentToolContext = makeContext(root);

    expect((await find(context, { pattern: "**/*.py" })).output).toBe(
      'No file matches "**/*.py". A pattern without / matches file names anywhere; one with / matches the path.',
    );
    expect(
      (await find(context, { pattern: "*.ts", path: "docs" })).output,
    ).toBe(
      'No file under docs matches "*.ts". A pattern without / matches file names anywhere; one with / matches the path.',
    );
    expect((await find(context, {})).output).toBe(
      "Error: a pattern is required: a file name, part of a path, or a glob such as **/*.test.ts.",
    );
  });

  test("never lists a folder outside the workspace", async () => {
    const outside: string = makeTemporaryDirectory("find-outside-");
    fs.writeFileSync(path.join(outside, "secret.ts"), "x\n");
    const root: string = makeRepository({ "a.ts": "a\n" });
    fs.symlinkSync(outside, path.join(root, "linked-dir"));
    const context: CodeAgentToolContext = makeContext(root);

    expect((await find(context, { pattern: "secret" })).output).toBe(
      'No file matches "secret".',
    );
    await expect(
      find(context, { pattern: "*.ts", path: "linked-dir" }),
    ).rejects.toThrow("leads outside the workspace");
  });
});

describe("list_directory", () => {
  test("lists a folder: folders end with a slash, links say so", async () => {
    const root: string = makeProject();
    fs.symlinkSync("docs/Guide.md", path.join(root, "GUIDE.md"));

    const result: ToolExecution = await list(makeContext(root), {});

    expect(result.output).toBe(
      [
        ".git/",
        ".gitignore",
        "GUIDE.md (link)",
        "app/",
        "debug.log",
        "dist/",
        "docs/",
        "node_modules/",
        "src/",
      ].join("\n"),
    );
    expect(result.narration).toBe("listed .");
  });

  test("with depth it lists the folders inside, indented - and never walks into git metadata or ignored folders", async () => {
    const root: string = makeProject();

    const result: ToolExecution = await list(makeContext(root), {
      path: ".",
      depth: 3,
    });

    expect(result.output).toBe(
      [
        ".git/ (git metadata; not listed)",
        ".gitignore",
        "app/",
        "  [id]/",
        "    page.tsx",
        "debug.log",
        "dist/ (ignored by .gitignore; not listed)",
        "docs/",
        "  Guide.md",
        "node_modules/ (ignored by .gitignore; not listed)",
        "src/",
        "  checkout.test.ts",
        "  checkout.ts",
        "  discount.ts",
        "  views/",
        "    Cart.tsx",
      ].join("\n"),
    );
  });

  test("a folder inside, and a depth past the most, are listed as asked", async () => {
    const root: string = makeRepository({
      "a/b/c/d/e/f/g/h/deep.txt": "x\n",
    });

    const result: ToolExecution = await list(makeContext(root), {
      path: "a",
      depth: 99,
    });

    expect(result.output).toBe(
      ["b/", "  c/", "    d/", "      e/", "        f/", "          g/"].join(
        "\n",
      ),
    );
  });

  test("a file, a missing folder and an empty one say so", async () => {
    const root: string = makeProject();
    fs.mkdirSync(path.join(root, "empty"));
    const context: CodeAgentToolContext = makeContext(root);

    expect((await list(context, { path: "src/checkout.ts" })).output).toBe(
      "Error: src/checkout.ts is a file. read_file reads it.",
    );
    expect((await list(context, { path: "nope" })).output).toBe(
      "Error: nope does not exist.",
    );
    expect((await list(context, { path: "empty" })).output).toBe(
      "(empty directory)",
    );
  });

  test("a very large folder stops at its limit and says what to do", async () => {
    const root: string = makeRepository({});

    for (let index: number = 0; index < 2100; index++) {
      fs.writeFileSync(
        path.join(root, `file-${String(index).padStart(4, "0")}.txt`),
        "",
      );
    }

    const result: ToolExecution = await list(makeContext(root), {});

    expect(result.output).toContain("file-1998.txt");
    expect(result.output).not.toContain("file-2050.txt");
    expect(result.output).toContain(
      "[Stopped at 2,000 entries. List a folder inside it, or a smaller depth; find_files finds files by name.]",
    );
  });

  test("never lists a folder outside the workspace through a link", async () => {
    const outside: string = makeTemporaryDirectory("list-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "x\n");
    const root: string = makeRepository({ "a.ts": "a\n" });
    fs.symlinkSync(outside, path.join(root, "linked-dir"));
    const context: CodeAgentToolContext = makeContext(root);

    await expect(list(context, { path: "linked-dir" })).rejects.toThrow(
      "leads outside the workspace",
    );

    const deep: ToolExecution = await list(context, { depth: 4 });
    expect(deep.output).toBe(
      [".git/ (git metadata; not listed)", "a.ts", "linked-dir (link)"].join(
        "\n",
      ),
    );
  });
});
