/*
 * read_file (issue #6441): a file of any length, as numbered lines, a window
 * at a time. The tool it replaced returned a file's first 20,000 characters
 * and nothing more, so a change past them - deep in a customer's 2,055-line
 * file - could not be made at all. These pin that every line of every file
 * can be reached, and that every partial read says where to read on.
 */

import FileReadTool from "../../../CodeAgents/Tools/FileReadTool";
import {
  CodeAgentToolContext,
  ToolExecution,
} from "../../../CodeAgents/Tools/CodeAgentToolTypes";
import {
  READ_FILE_DEFAULT_LINES,
  READ_FILE_MAX_LINE_CHARS,
  READ_FILE_MAX_WINDOW_CHARS,
} from "../../../CodeAgents/Tools/CodeAgentToolLimits";
import {
  makeContext,
  makeRepository,
  makeTemporaryDirectory,
  numberedLines,
  removeTemporaryDirectories,
  writeFile,
} from "./ToolTestRepository";
import fs from "fs";
import path from "path";

jest.setTimeout(60000);

afterAll(() => {
  removeTemporaryDirectories();
});

async function read(
  context: CodeAgentToolContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  return FileReadTool.read(context, args as never);
}

describe("read_file shows a file as numbered lines", () => {
  test("a short file is shown whole: each line after its number and a tab, nothing after the last", async () => {
    const root: string = makeRepository({
      "src/checkout.ts":
        "export function checkout(): number {\n  return 1;\n}\n",
    });
    const context: CodeAgentToolContext = makeContext(root);

    const result: ToolExecution = await read(context, {
      path: "src/checkout.ts",
    });

    expect(result.output).toBe(
      [
        "     1\texport function checkout(): number {",
        "     2\t  return 1;",
        "     3\t}",
      ].join("\n"),
    );
    expect(result.narration).toBe("read src/checkout.ts");
  });

  test("a file without a final newline reads the same", async () => {
    const root: string = makeRepository({ "a.txt": "one\ntwo" });

    const result: ToolExecution = await read(makeContext(root), {
      path: "a.txt",
    });

    expect(result.output).toBe("     1\tone\n     2\ttwo");
  });

  test("a file with Windows line endings is shown without the carriage returns", async () => {
    const root: string = makeRepository({ "win.txt": "one\r\ntwo\r\n" });

    const result: ToolExecution = await read(makeContext(root), {
      path: "win.txt",
    });

    expect(result.output).toBe("     1\tone\n     2\ttwo");
    expect(result.output).not.toContain("\r");
  });

  test("spaces at the ends of lines and blank lines are kept as they are", async () => {
    const root: string = makeRepository({ "a.txt": "x  \n\n\ty\n" });

    const result: ToolExecution = await read(makeContext(root), {
      path: "a.txt",
    });

    expect(result.output).toBe("     1\tx  \n     2\t\n     3\t\ty");
  });

  test("an empty file says so", async () => {
    const root: string = makeRepository({ "empty.txt": "" });

    const result: ToolExecution = await read(makeContext(root), {
      path: "empty.txt",
    });

    expect(result.output).toBe("(empty.txt is empty)");
  });

  test("reading a file lets write_file replace it later in the task", async () => {
    const root: string = makeRepository({ "a.txt": "a\n" });
    const context: CodeAgentToolContext = makeContext(root);

    expect(context.changes.hasSeen("a.txt")).toBe(false);
    await read(context, { path: "a.txt" });
    expect(context.changes.hasSeen("a.txt")).toBe(true);
  });
});

describe("read_file reads a long file in windows", () => {
  test("a window names its lines and where to read on", async () => {
    const root: string = makeRepository({ "a.txt": numberedLines(50) });

    const result: ToolExecution = await read(makeContext(root), {
      path: "a.txt",
      start_line: 10,
      end_line: 12,
    });

    expect(result.output).toBe(
      [
        "    10\tline 10",
        "    11\tline 11",
        "    12\tline 12",
        "[a.txt: lines 10-12 of 50. Read on with start_line 13.]",
      ].join("\n"),
    );
    expect(result.narration).toBe("read a.txt:10-12");
  });

  test("the last window says it is the end of the file", async () => {
    const root: string = makeRepository({ "a.txt": numberedLines(50) });

    const result: ToolExecution = await read(makeContext(root), {
      path: "a.txt",
      start_line: 49,
      end_line: 80,
    });

    expect(result.output).toBe(
      [
        "    49\tline 49",
        "    50\tline 50",
        "[a.txt: lines 49-50 of 50. This is the end of the file.]",
      ].join("\n"),
    );
  });

  test(`with no end it shows ${READ_FILE_DEFAULT_LINES} lines`, async () => {
    const root: string = makeRepository({ "a.txt": numberedLines(2500) });

    const result: ToolExecution = await read(makeContext(root), {
      path: "a.txt",
    });

    expect(result.output).toContain("     1\tline 1\n");
    expect(result.output).toContain("  2000\tline 2000\n");
    expect(result.output).not.toContain("\tline 2001");
    expect(
      result.output.endsWith(
        "[a.txt: lines 1-2000 of 2500. Read on with start_line 2001.]",
      ),
    ).toBe(true);
  });

  test("a window stops at a whole line before its characters run out, and says so", async () => {
    const line: string = "x".repeat(199);
    const root: string = makeRepository({
      "wide.txt": `${Array.from({ length: 1000 }, () => {
        return line;
      }).join("\n")}\n`,
    });

    const result: ToolExecution = await read(makeContext(root), {
      path: "wide.txt",
    });

    // 7 characters of number and tab, the line, its newline: 207 a line.
    const linesShown: number = Math.floor(READ_FILE_MAX_WINDOW_CHARS / 207);

    expect(result.output).toContain(
      `[wide.txt: lines 1-${linesShown} of 1000 (a window holds about 60,000 characters). Read on with start_line ${
        linesShown + 1
      }.]`,
    );
    expect(result.output.length).toBeLessThan(READ_FILE_MAX_WINDOW_CHARS + 200);
  });

  test("offset and limit are read as the window's start and its number of lines", async () => {
    const root: string = makeRepository({ "a.txt": numberedLines(10) });

    const result: ToolExecution = await read(makeContext(root), {
      path: "a.txt",
      offset: 3,
      limit: 2,
    });

    expect(result.output).toBe(
      [
        "     3\tline 3",
        "     4\tline 4",
        "[a.txt: lines 3-4 of 10. Read on with start_line 5.]",
      ].join("\n"),
    );
  });

  test("line numbers sent as text are read as numbers", async () => {
    const root: string = makeRepository({ "a.txt": numberedLines(10) });

    const result: ToolExecution = await read(makeContext(root), {
      path: "a.txt",
      start_line: "9",
      end_line: "10",
    });

    expect(result.output).toContain("     9\tline 9\n    10\tline 10\n");
  });

  test("a start past the end, or an end before the start, is refused and says why", async () => {
    const root: string = makeRepository({ "a.txt": numberedLines(10) });
    const context: CodeAgentToolContext = makeContext(root);

    expect(
      (await read(context, { path: "a.txt", start_line: 11 })).output,
    ).toBe(
      "Error: start_line 11 is past the end of a.txt, which has 10 lines.",
    );
    expect(
      (await read(context, { path: "a.txt", start_line: 5, end_line: 4 }))
        .output,
    ).toBe("Error: end_line 4 comes before start_line 5.");
  });

  /*
   * The customer's case (issue #6441): a 2,055-line file far past 20,000
   * characters. Reading on where each window says reaches every line, once.
   */
  test("following the windows reaches every line of a 2,055-line file, each once", async () => {
    const content: string = Array.from(
      { length: 2055 },
      (_: unknown, index: number) => {
        return `  public handler${index + 1}(request: Request): Response { return this.respond(request, ${index + 1}); }`;
      },
    ).join("\n");
    const root: string = makeRepository({ "src/Service.ts": `${content}\n` });
    const context: CodeAgentToolContext = makeContext(root);

    expect(content.length).toBeGreaterThan(150_000);

    const seen: Array<number> = [];
    let startLine: number = 1;
    let reads: number = 0;

    while (reads < 20) {
      reads++;
      const result: ToolExecution = await read(context, {
        path: "src/Service.ts",
        start_line: startLine,
      });

      for (const match of result.output.matchAll(/^ *(\d+)\t/gm)) {
        seen.push(Number(match[1]));
      }

      expect(result.output.length).toBeLessThan(
        READ_FILE_MAX_WINDOW_CHARS + 300,
      );

      const readOn: RegExpMatchArray | null = result.output.match(
        /Read on with start_line (\d+)\.\]$/,
      );

      if (!readOn) {
        expect(result.output).toContain("This is the end of the file.]");
        break;
      }

      startLine = Number(readOn[1]);
    }

    expect(seen).toEqual(
      Array.from({ length: 2055 }, (_: unknown, index: number) => {
        return index + 1;
      }),
    );
    expect(reads).toBeGreaterThan(1);
  });
});

describe("read_file and long lines", () => {
  test("a long line in a window of many lines is cut, and says how to see the rest", async () => {
    const long: string = "y".repeat(READ_FILE_MAX_LINE_CHARS + 500);
    const root: string = makeRepository({ "a.txt": `short\n${long}\nend\n` });

    const result: ToolExecution = await read(makeContext(root), {
      path: "a.txt",
    });

    expect(result.output).toContain(
      `     2\t${"y".repeat(READ_FILE_MAX_LINE_CHARS)} [... 500 more characters on this line; read this line alone (start_line and end_line 2) to see more of it]\n`,
    );
    expect(result.output).toContain("     3\tend");
  });

  test("the same line read alone is shown whole", async () => {
    const long: string = "y".repeat(READ_FILE_MAX_LINE_CHARS + 500);
    const root: string = makeRepository({ "a.txt": `short\n${long}\nend\n` });

    const result: ToolExecution = await read(makeContext(root), {
      path: "a.txt",
      start_line: 2,
      end_line: 2,
    });

    expect(result.output).toBe(
      `     2\t${long}\n[a.txt: lines 2-2 of 3. Read on with start_line 3.]`,
    );
  });

  test("a line longer than any window says what finds text in it", async () => {
    const huge: string = "z".repeat(READ_FILE_MAX_WINDOW_CHARS + 10);
    const root: string = makeRepository({ "bundle.min.js": `${huge}\n` });

    const result: ToolExecution = await read(makeContext(root), {
      path: "bundle.min.js",
    });

    expect(result.output).toContain(
      "[... 10 more characters on this line, more than one read shows; search_files finds text in it]",
    );
  });
});

describe("read_file says why it cannot read a path", () => {
  test("a path that does not exist names the files of that name elsewhere", async () => {
    const root: string = makeRepository({
      "src/lib/util.ts": "export {};\n",
      "test/util.ts": "export {};\n",
    });

    const result: ToolExecution = await read(makeContext(root), {
      path: "src/util.ts",
    });

    expect(result.output).toBe(
      "Error: src/util.ts does not exist. Files with that name: src/lib/util.ts, test/util.ts.",
    );
  });

  test("a path that does not exist, with no file of its name, points at find_files", async () => {
    const root: string = makeRepository({ "a.txt": "a\n" });

    const result: ToolExecution = await read(makeContext(root), {
      path: "nothing-like-it.ts",
    });

    expect(result.output).toBe(
      "Error: nothing-like-it.ts does not exist. find_files finds a file by its name.",
    );
  });

  test("a directory points at list_directory", async () => {
    const root: string = makeRepository({ "src/a.ts": "a\n" });

    const result: ToolExecution = await read(makeContext(root), {
      path: "src",
    });

    expect(result.output).toBe(
      "Error: src is a directory. list_directory shows what is in it.",
    );
  });

  test("a binary file is not shown", async () => {
    const root: string = makeRepository({
      "logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]),
    });

    const result: ToolExecution = await read(makeContext(root), {
      path: "logo.png",
    });

    expect(result.output).toBe(
      "Error: logo.png is a binary file (7 bytes). read_file shows text files only.",
    );
  });

  test("a file too large to read into memory points at search_files", async () => {
    const root: string = makeRepository({});
    // Sparse: 33 MB on paper, nothing on disk.
    const handle: number = fs.openSync(path.join(root, "dump.sql"), "w");
    fs.ftruncateSync(handle, 33 * 1024 * 1024);
    fs.closeSync(handle);

    const result: ToolExecution = await read(makeContext(root), {
      path: "dump.sql",
    });

    expect(result.output).toBe(
      "Error: dump.sql is 33.0 MB, too large to read here. search_files with this path finds the lines you need in it.",
    );
  });

  test("no path is refused", async () => {
    const root: string = makeRepository({ "a.txt": "a\n" });

    const result: ToolExecution = await read(makeContext(root), {});

    expect(result.output).toBe(
      "Error: a path is required: the file to read, relative to the repository root.",
    );
  });

  test("a path that leaves the workspace through a link is refused, whatever the tool is asked", async () => {
    const outside: string = makeTemporaryDirectory("read-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside-marker\n");
    const root: string = makeRepository({ "a.txt": "a\n" });
    fs.symlinkSync(
      path.join(outside, "secret.txt"),
      path.join(root, "link.txt"),
    );

    await expect(
      read(makeContext(root), { path: "link.txt", start_line: 1 }),
    ).rejects.toThrow("leads outside the workspace");
    await expect(
      read(makeContext(root), { path: "../secret.txt" }),
    ).rejects.toThrow();
  });

  test("a file the task created is read like any other", async () => {
    const root: string = makeRepository({});
    writeFile(root, "new/file.ts", "export const x = 1;\n");

    const result: ToolExecution = await read(makeContext(root), {
      path: "new/file.ts",
    });

    expect(result.output).toBe("     1\texport const x = 1;");
  });
});
