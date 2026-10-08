import FeedMarkdown, { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import { describe, expect, test } from "@jest/globals";

/*
 * FEED TEXT OF ANY LENGTH (FeedMarkdown).
 *
 * multilineText places each line of a text as a value of its own. Reading
 * the template looked for each line's values by scanning every value, and
 * the check for a backslash before a value read the end of the whole output
 * each time - copying all of it: a log of two hundred thousand lines took
 * minutes. Now a line's values are found by halving, and the output's
 * trailing backslashes are counted as it is written.
 * HugeTextInLongRunningProcess.test.ts runs the same log where V8 compiles
 * regular expressions unoptimized.
 */

const LINE_COUNT: number = 200000;

describe("FeedMarkdown.multilineText - a text of many lines", () => {
  test("two hundred thousand lines come out escaped, each as it does on its own", () => {
    const lines: Array<string> = Array.from(
      { length: LINE_COUNT },
      (_: unknown, index: number): string => {
        return index % 3 === 0
          ? `# heading ${index}`
          : index % 3 === 1
            ? `2026-10-08T10:00:00Z INFO request ${index} [x](https://evil.example)`
            : `- item ${index} ends in a backslash \\`;
      },
    );

    const output: Array<string> = FeedMarkdown.multilineText(lines.join("\n"))
      .toString()
      .split("\n");

    expect(output).toHaveLength(LINE_COUNT);

    for (const index of [0, 1, 2, 3, 99999, 100000, 100001, LINE_COUNT - 1]) {
      expect([index, output[index]]).toEqual([
        index,
        FeedMarkdown.multilineText(lines[index]!).toString(),
      ]);
    }
  });
});

describe("FeedMarkdown - the markers before a value on its line", () => {
  /*
   * Whether a value starts its line is read from the template's text before
   * it. That text was read with a pattern that could split a run of tabs
   * after a list marker two ways, so every "\t\t*" in a text that does not
   * start the line doubled the time: these twenty-eight took most of a
   * minute.
   */
  const MARKERS: number = 28;
  const BUDGET_IN_MS: number = 1000;
  const VALUE: string = "# heading";

  const placeAfter: (prefix: string) => { text: string; tookMs: number } = (
    prefix: string,
  ): { text: string; tookMs: number } => {
    // A template made at run time, as the tag is called with one.
    const literals: TemplateStringsArray = Object.assign([prefix, ""], {
      raw: [prefix, ""],
    });
    const started: number = performance.now();
    const text: string = mdText(literals, VALUE).toString();

    return { text: text, tookMs: performance.now() - started };
  };

  test("after markers and then a word, the value is read at once, inside the line", () => {
    const prefix: string = `*${"\t\t*".repeat(MARKERS)}x `;
    const placed: { text: string; tookMs: number } = placeAfter(prefix);

    expect(placed.text).toBe(`${prefix}${VALUE}`);
    expect(placed.tookMs).toBeLessThan(BUDGET_IN_MS);
  });

  test("after markers only, the value is read at once and starts the line", () => {
    const prefix: string = `*${"\t\t*".repeat(MARKERS)}\t`;
    const placed: { text: string; tookMs: number } = placeAfter(prefix);

    expect(placed.text).toBe(`${prefix}\\${VALUE}`);
    expect(placed.tookMs).toBeLessThan(BUDGET_IN_MS);
  });
});

describe("FeedMarkdown - backslashes a template ends in before a value", () => {
  const VALUE: string = "[x](https://evil.example)";
  const ESCAPED_VALUE: string = "\\[x\\](https://evil.example)";

  test("an odd run would escape the value, so a word joiner goes between", () => {
    expect(mdText`C:\\${VALUE}`.toString()).toBe(
      `C:\\${WORD_JOINER}${ESCAPED_VALUE}`,
    );
    expect(mdText`C:\\\\\\${VALUE}`.toString()).toBe(
      `C:\\\\\\${WORD_JOINER}${ESCAPED_VALUE}`,
    );
  });

  test("an even run escapes itself, so nothing goes between", () => {
    expect(mdText`C:\\\\${VALUE}`.toString()).toBe(`C:\\\\${ESCAPED_VALUE}`);
    expect(mdText`C:\\\\\\\\${VALUE}`.toString()).toBe(
      `C:\\\\\\\\${ESCAPED_VALUE}`,
    );
  });

  test("backslashes a value ends in count too", () => {
    // The first value is placed escaped: its backslash becomes two.
    expect(mdText`${"a\\"}${VALUE}`.toString()).toBe(`a\\\\${ESCAPED_VALUE}`);
  });
});
