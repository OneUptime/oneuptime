/*
 * The long tool outputs of a task (issue #6441). A long output used to be
 * cut at 20,000 characters, its end - where a test run says what failed -
 * gone for good. Now the model is shown a part, says which, and reads the
 * rest with read_tool_output. These pin what each shape shows, that every
 * line can still be read, and that the store stays bounded.
 */

import ToolOutputStore, {
  LongOutputShape,
} from "../../../CodeAgents/Tools/ToolOutputStore";
import { ToolExecution } from "../../../CodeAgents/Tools/CodeAgentToolTypes";
import {
  READ_FILE_MAX_LINE_CHARS,
  TOOL_OUTPUT_INLINE_CHARS,
} from "../../../CodeAgents/Tools/CodeAgentToolLimits";

function lines(count: number, prefix: string = "output line"): string {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return `${prefix} ${index + 1}`;
  }).join("\n");
}

function read(
  store: ToolOutputStore,
  args: Record<string, unknown>,
): ToolExecution {
  return store.read(args as never);
}

describe("presenting an output", () => {
  test("a short output is shown whole, and nothing is kept", () => {
    const store: ToolOutputStore = new ToolOutputStore();

    expect(
      store.present({
        label: "x",
        text: "all of it",
        shape: LongOutputShape.StartAndEnd,
      }),
    ).toBe("all of it");
    expect(store.has("out-1")).toBe(false);
  });

  test("a long command output shows its start and its end, and says which lines it left out", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    const text: string = `${lines(5000)}\nFAILED: 3 tests failed`;

    const shown: string = store.present({
      label: "run_command npm test",
      text,
      shape: LongOutputShape.StartAndEnd,
    });

    expect(shown.startsWith("output line 1\noutput line 2\n")).toBe(true);
    // The end, where a test run says what failed, is always shown.
    expect(shown.endsWith("output line 5000\nFAILED: 3 tests failed")).toBe(
      true,
    );
    expect(shown).toMatch(
      /\n\.\.\. \[out-1: lines (\d+)-(\d+) of 5001 are left out here\. read_tool_output with output_id "out-1" reads them \(start_line \1\), or finds the lines that hold a text \(pattern\)\.\] \.\.\.\n/,
    );
    expect(shown.length).toBeLessThan(TOOL_OUTPUT_INLINE_CHARS + 500);
  });

  test("the lines left out of a long output can all be read back", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    const text: string = lines(5000);
    const shown: string = store.present({
      label: "run_command make",
      text,
      shape: LongOutputShape.StartAndEnd,
    });

    const leftOut: RegExpMatchArray = shown.match(
      /lines (\d+)-(\d+) of 5000 are left out/,
    )!;
    const from: number = Number(leftOut[1]);
    const to: number = Number(leftOut[2]);

    // Page by page, each saying where to read on, up to the last line left out.
    const seen: Array<number> = [];
    let startLine: number = from;

    while (startLine <= to) {
      const page: ToolExecution = read(store, {
        output_id: "out-1",
        start_line: startLine,
        end_line: to,
      });

      for (const match of page.output.matchAll(
        /^ *(\d+)\toutput line (\d+)$/gm,
      )) {
        expect(match[1]).toBe(match[2]);
        seen.push(Number(match[1]));
      }

      const footer: RegExpMatchArray = page.output.match(
        /\[out-1 \(run_command make\): lines (\d+)-(\d+) of 5000\. Read on with start_line (\d+)\.\]$/,
      )!;

      expect(Number(footer[1])).toBe(startLine);
      expect(page.narration).toBe(
        `read out-1:${footer[1]}-${footer[2]} (run_command make)`,
      );
      startLine = Number(footer[3]);
    }

    expect(seen).toEqual(
      Array.from({ length: to - from + 1 }, (_: unknown, index: number) => {
        return from + index;
      }),
    );
  });

  test("a long search shows its start and how to read on", () => {
    const store: ToolOutputStore = new ToolOutputStore();

    const shown: string = store.present({
      label: "search_files TODO",
      text: lines(5000, "src/a.ts:1:TODO"),
      shape: LongOutputShape.Start,
    });

    expect(shown.startsWith("src/a.ts:1:TODO 1\n")).toBe(true);
    expect(shown).toMatch(
      /\[out-1: lines 1-(\d+) of 5000 shown\. read_tool_output with output_id "out-1" and start_line (\d+) reads on, or finds the lines that hold a text \(pattern\)\.\]$/,
    );
  });

  test("a line too long to show is cut, and says how to read it", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    const long: string = "j".repeat(TOOL_OUTPUT_INLINE_CHARS + 10);

    const shown: string = store.present({
      label: "run_command cat data.json",
      text: long,
      shape: LongOutputShape.StartAndEnd,
    });

    expect(shown).toBe(
      `${"j".repeat(READ_FILE_MAX_LINE_CHARS)} [... ${(
        long.length - READ_FILE_MAX_LINE_CHARS
      ).toLocaleString(
        "en-US",
      )} more characters on this line; read_tool_output with output_id "out-1", start_line and end_line 1 shows more of it]`,
    );
    expect(
      read(store, { output_id: "out-1", start_line: 1, end_line: 1 }).output,
    ).toContain("j".repeat(30_000));
  });

  test("each output gets an id of its own", () => {
    const store: ToolOutputStore = new ToolOutputStore();

    store.present({
      label: "a",
      text: lines(5000),
      shape: LongOutputShape.Start,
    });
    store.present({
      label: "b",
      text: lines(5000),
      shape: LongOutputShape.Start,
    });

    expect(store.has("out-1")).toBe(true);
    expect(store.has("out-2")).toBe(true);
  });
});

describe("read_tool_output", () => {
  test("pages through an output, 500 lines at a time when no end is named", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    store.present({
      label: "x",
      text: lines(5000),
      shape: LongOutputShape.Start,
    });

    const page: ToolExecution = read(store, {
      output_id: "out-1",
      start_line: 1001,
    });

    expect(page.output).toContain("  1001\toutput line 1001\n");
    expect(page.output).toContain("  1500\toutput line 1500\n");
    expect(page.output).not.toContain("output line 1501\n");
    expect(
      page.output.endsWith(
        "[out-1 (x): lines 1001-1500 of 5000. Read on with start_line 1501.]",
      ),
    ).toBe(true);
  });

  test("the last page says it is the end", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    store.present({
      label: "x",
      text: lines(5000),
      shape: LongOutputShape.Start,
    });

    expect(
      read(store, { output_id: "out-1", start_line: 4999 }).output.endsWith(
        "[out-1 (x): lines 4999-5000 of 5000. This is its end.]",
      ),
    ).toBe(true);
  });

  test("finds the lines that hold a text, case ignored, with their numbers", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    const text: string = `${lines(3000)}\nError: expected 2 but got 3\n${lines(3000)}\nerror: second failure`;
    store.present({
      label: "run_command npm test",
      text,
      shape: LongOutputShape.StartAndEnd,
    });

    const found: ToolExecution = read(store, {
      output_id: "out-1",
      pattern: "ERROR:",
    });

    expect(found.output).toBe(
      [
        "  3001\tError: expected 2 but got 3",
        "  6002\terror: second failure",
        '[2 lines of out-1 (run_command npm test) hold "ERROR:".]',
      ].join("\n"),
    );
    expect(found.narration).toBe(
      'searched out-1 for "ERROR:" (run_command npm test)',
    );
  });

  test("a text in very many lines shows the first of them, and says so", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    store.present({
      label: "x",
      text: lines(5000),
      shape: LongOutputShape.Start,
    });

    const found: ToolExecution = read(store, {
      output_id: "out-1",
      pattern: "output",
    });

    expect(
      found.output.endsWith(
        '[5,000 lines of out-1 (x) hold "output"; the first 400 are shown. Read around a line with start_line and end_line.]',
      ),
    ).toBe(true);
  });

  test("a text in no line says so", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    store.present({
      label: "x",
      text: lines(5000),
      shape: LongOutputShape.Start,
    });

    expect(read(store, { output_id: "out-1", pattern: "nowhere" }).output).toBe(
      'No line of out-1 (x, 5,000 lines) holds "nowhere" (case ignored).',
    );
  });

  test("an id it does not have names the ones it has", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    store.present({
      label: "x",
      text: lines(5000),
      shape: LongOutputShape.Start,
    });

    expect(read(store, { output_id: "out-9" }).output).toBe(
      'Error: there is no kept output "out-9". The outputs kept now are out-1. An older output may have been let go to make room: run the tool again.',
    );
    expect(read(store, {}).output).toBe(
      "Error: output_id is required: the id a shortened tool output gave, such as out-3.",
    );
  });

  test("lines past the end, or an end before the start, are refused", () => {
    const store: ToolOutputStore = new ToolOutputStore();
    store.present({
      label: "x",
      text: lines(5000),
      shape: LongOutputShape.Start,
    });

    expect(read(store, { output_id: "out-1", start_line: 5001 }).output).toBe(
      "Error: start_line 5001 is past the end of out-1, which has 5,000 lines.",
    );
    expect(
      read(store, { output_id: "out-1", start_line: 10, end_line: 9 }).output,
    ).toBe("Error: end_line 9 comes before start_line 10.");
  });
});

describe("the store stays bounded", () => {
  test("past its size the oldest outputs are let go - the newest always kept", () => {
    const text: string = lines(5000);
    const store: ToolOutputStore = new ToolOutputStore(text.length * 2 + 10);

    store.present({ label: "a", text, shape: LongOutputShape.Start });
    store.present({ label: "b", text, shape: LongOutputShape.Start });
    store.present({ label: "c", text, shape: LongOutputShape.Start });

    expect(store.has("out-1")).toBe(false);
    expect(store.has("out-2")).toBe(true);
    expect(store.has("out-3")).toBe(true);
    expect(read(store, { output_id: "out-1" }).output).toContain(
      "An older output may have been let go to make room: run the tool again.",
    );

    // One output larger than the whole store is still kept, alone.
    const tiny: ToolOutputStore = new ToolOutputStore(10);
    tiny.present({ label: "big", text, shape: LongOutputShape.Start });
    expect(tiny.has("out-1")).toBe(true);
  });
});
