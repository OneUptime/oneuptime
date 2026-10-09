import { describe, expect, test } from "@jest/globals";
import {
  SLOW_MARKDOWN_MAX_INLINE_WORK,
  SLOW_MARKDOWN_MAX_NESTING_DEPTH,
  SLOW_MARKDOWN_MIN_LENGTH,
  SlowMarkdownHolder,
  SlowMarkdownLimits,
  SlowMarkdownRun,
  getInlineCharacterCount,
  getWordPunctuationWork,
  holdBackSlowMarkdown,
  measureSlowMarkdownCodeBlocks,
  measureSlowMarkdownRuns,
} from "../../../Utils/Markdown/SlowMarkdown";

/*
 * MARKDOWN OF A SHAPE A PARSER READS SLOWLY (Utils/Markdown/SlowMarkdown).
 *
 * What a run of lines costs a parser, which runs are held back, and that
 * what is held back always comes back exactly as it was written. How fast
 * the parsers then are is measured where they run as a long-running server
 * runs them, in HugeTextInLongRunningProcess.test.ts.
 */

// Limits that hold nothing back, for one kind of limit to be set at a time.
const NO_LIMITS: SlowMarkdownLimits = {
  maxInlineWork: Number.POSITIVE_INFINITY,
  maxRunLines: Number.POSITIVE_INFINITY,
  maxLines: Number.POSITIVE_INFINITY,
  maxUnitLines: Number.POSITIVE_INFINITY,
  maxUnitLength: Number.POSITIVE_INFINITY,
  maxNestingDepth: Number.POSITIVE_INFINITY,
  maxCellsPerLine: Number.POSITIVE_INFINITY,
  holdBackCodeBlockContent: false,
  countUrlLiterals: false,
  countWordUnderscores: false,
};

interface Recorded {
  // The text with each held-back piece as "<L0>" (lines) or "<C0>" (code).
  result: string;
  lines: Array<string>;
  code: Array<string>;
}

// Holds back as the callers do, with tokens a test can read.
function holdBack(text: string, limits: Partial<SlowMarkdownLimits>): Recorded {
  const lines: Array<string> = [];
  const code: Array<string> = [];

  const holder: SlowMarkdownHolder = {
    holdLines: (held: string): string => {
      lines.push(held);
      return `<L${lines.length - 1}>`;
    },
    holdCode: (held: string): string => {
      code.push(held);
      return `<C${code.length - 1}>`;
    },
  };

  return {
    result: holdBackSlowMarkdown(text, holder, { ...NO_LIMITS, ...limits }),
    lines: lines,
    code: code,
  };
}

// The recorded result with every token replaced by what it holds.
function putBack(recorded: Recorded): string {
  return recorded.result.replace(
    /<([LC])(\d+)>/g,
    (_token: string, kind: string, index: string): string => {
      return (kind === "L" ? recorded.lines : recorded.code)[Number(index)]!;
    },
  );
}

// Plain words, long enough that the text is measured (over the minimum).
const FILLER: string = `${"lorem ipsum dolor sit amet ".repeat(100).trim()}\n\n`;

describe("getInlineCharacterCount - what makes a parser look ahead", () => {
  test("emphasis delimiters that can open or close count, whitespace on both sides does not", () => {
    expect(getInlineCharacterCount("*a *b", 0, 5)).toBe(2);
    expect(getInlineCharacterCount("a * b * c", 0, 9)).toBe(0);
    expect(getInlineCharacterCount("**bold**", 0, 8)).toBe(4);
    expect(getInlineCharacterCount("~~gone~~", 0, 8)).toBe(4);
    // The start and the end of the text count as whitespace.
    expect(getInlineCharacterCount("*", 0, 1)).toBe(0);
  });

  test("an underscore inside a word counts only where the parser reads it (remark)", () => {
    expect(getInlineCharacterCount("snake_case_name", 0, 15)).toBe(0);
    expect(
      getInlineCharacterCount("snake_case_name", 0, 15, {
        countWordUnderscores: true,
      }),
    ).toBe(2);
    // An underscore at a word's edge can open or close: it always counts.
    expect(getInlineCharacterCount("_a b_", 0, 5)).toBe(2);
    // A word in any script.
    expect(getInlineCharacterCount("ошибка_сети", 0, 11)).toBe(0);
    expect(getInlineCharacterCount("😀_😀", 0, 5)).toBe(1);
  });

  test("code spans, brackets, tags, escapes and entities count", () => {
    expect(
      getInlineCharacterCount("`a` [b](c) <d> \\* &amp; &#38;", 0, 29),
    ).toBe(9);
    // What starts nothing does not.
    expect(getInlineCharacterCount("a < b, c & d, e \\ f", 0, 19)).toBe(0);
  });

  test("where an address can start counts only where the parser reads it (remark)", () => {
    const text: string = "www.example.com http://a.b x@y.z";

    expect(getInlineCharacterCount(text, 0, text.length)).toBe(0);
    expect(
      getInlineCharacterCount(text, 0, text.length, {
        countUrlLiterals: true,
      }),
    ).toBe(3);
  });

  test("only the given range is read", () => {
    expect(getInlineCharacterCount("**a** [b]", 6, 9)).toBe(2);
  });
});

describe("getWordPunctuationWork - what a parser reads from a word's punctuation", () => {
  test("spoken text costs next to nothing", () => {
    const text: string = "The API is down, again. Restart it!";

    expect(getWordPunctuationWork(text, 0, text.length)).toBe(
      // "down," "again." "it!": one punctuation character each.
      5 + 6 + 3,
    );
  });

  test("one long word of punctuation costs the square of its length", () => {
    const text: string = "a.".repeat(500);

    expect(getWordPunctuationWork(text, 0, text.length)).toBe(500 * 1000);
  });

  test("spaces and tabs end a word; other characters do not", () => {
    expect(getWordPunctuationWork("a.b c.d\te.f", 0, 11)).toBe(3 + 3 + 3);
    expect(getWordPunctuationWork("a.b\u00A0c.d", 0, 7)).toBe(2 * 7);
  });
});

describe("measureSlowMarkdownRuns - what a run costs", () => {
  test("a run is lines with no blank line between them", () => {
    const runs: Array<SlowMarkdownRun> = measureSlowMarkdownRuns(
      "one\ntwo\n\nthree\n   \nfour",
    );

    expect(
      runs.map((run: SlowMarkdownRun): number => {
        return run.lines;
      }),
    ).toEqual([2, 1, 1]);
  });

  test("a paragraph's inline work grows with its length; list items each count alone", () => {
    const paragraph: string = "*a ".repeat(100);
    const asOneParagraph: SlowMarkdownRun = measureSlowMarkdownRuns(
      `${paragraph}\n${paragraph}`,
    )[0]!;
    const asListItems: SlowMarkdownRun = measureSlowMarkdownRuns(
      `- ${paragraph}\n- ${paragraph}`,
    )[0]!;

    /*
     * 200 delimiters over a unit of two lines of 301 characters, against
     * 100 over each item of 303; and each word's punctuation, "*a" two (a
     * list marker is not text).
     */
    expect(asOneParagraph.inlineWork).toBe(200 * 602 + 200 * 2);
    expect(asListItems.inlineWork).toBe(2 * 100 * 303 + 200 * 2);
    expect(asOneParagraph.longestUnitLines).toBe(2);
    expect(asListItems.longestUnitLines).toBe(1);
  });

  test("a numbered item other than 1 starts a unit only after one of its kind", () => {
    const afterParagraph: SlowMarkdownRun = measureSlowMarkdownRuns(
      "a paragraph\n2. continues it",
    )[0]!;
    const inAList: SlowMarkdownRun = measureSlowMarkdownRuns(
      "1. first\n2. second",
    )[0]!;

    expect(afterParagraph.longestUnitLines).toBe(2);
    expect(inAList.longestUnitLines).toBe(1);
  });

  test("nesting, table cells and lines are measured", () => {
    const run: SlowMarkdownRun = measureSlowMarkdownRuns(
      "> > - a\n| a | b | c |\nplain",
    )[0]!;

    expect(run.nestingDepth).toBe(3);
    expect(run.cellsPerLine).toBe(4);
    expect(run.lines).toBe(3);
  });

  test("a thematic break is not a nested list", () => {
    expect(measureSlowMarkdownRuns("* * * * * * *")[0]!.nestingDepth).toBe(0);
  });
});

describe("measureSlowMarkdownCodeBlocks - fenced code, read as every parser reads it", () => {
  test("a fence at the start of the text or after a blank line opens a code block", () => {
    const text: string =
      "```\ncode *a *a\n```\n\ntext\n\n~~~js\nmore\nlines\n~~~";

    expect(measureSlowMarkdownCodeBlocks(text)).toEqual([
      { start: 0, end: 18, contentLines: 1 },
      { start: 26, end: text.length, contentLines: 2 },
    ]);
    // What a code block holds is not a run.
    expect(
      measureSlowMarkdownRuns(text).map((run: SlowMarkdownRun): number => {
        return run.inlineWork;
      }),
    ).toEqual([0]);
  });

  test("a fence never closed runs to the end of the text", () => {
    // Its lines and the empty one after the last line break.
    expect(measureSlowMarkdownCodeBlocks("```\na\nb\n")).toEqual([
      { start: 0, end: 8, contentLines: 3 },
    ]);
  });

  test("a closing fence must be as long, of the same character, with nothing after it", () => {
    const text: string = "````\na\n```\n~~~~\nb\n````  \nafter";

    expect(measureSlowMarkdownCodeBlocks(text)).toEqual([
      { start: 0, end: 24, contentLines: 4 },
    ]);
    expect(measureSlowMarkdownRuns(text)).toHaveLength(1);
  });

  test("a backtick fence with a backtick after it is a code span, not a fence", () => {
    expect(measureSlowMarkdownCodeBlocks("```a`b```\ntext")).toEqual([]);
  });

  test("after a fence some parser reads another way, nothing more is read as code", () => {
    for (const text of [
      // After a paragraph's line: marked can read it into a heading.
      "a paragraph\n```\ncode\n```\n\n```\nskipped *a *a\n```",
      // Indented, or in a quote or a list item: it closes on another line.
      "  ```\ncode\n```\n\n```\nskipped *a *a\n```",
      "> ```\ncode\n\n```\nskipped *a *a\n```",
      "- ```\ncode\n\n```\nskipped *a *a\n```",
      // A line one parser closes on and another does not.
      "```\ncode\n```~~\nskipped *a *a\n```\n\n```\nalso skipped *a\n```",
    ]) {
      const runs: Array<SlowMarkdownRun> = measureSlowMarkdownRuns(text);
      const measured: number = runs.reduce(
        (sum: number, run: SlowMarkdownRun): number => {
          return sum + run.inlineWork;
        },
        0,
      );

      // The "*a" lines after it are measured as Markdown.
      expect([text, measured > 0]).toEqual([text, true]);
    }
  });

  test("a fence inside an HTML block that runs past blank lines is HTML, not code", () => {
    const text: string = "<!--\n\n```\n*a *a\n-->\n\n```\ncode\n```";

    expect(measureSlowMarkdownCodeBlocks(text)).toEqual([]);
  });

  test("a fence right after a closing fence opens a block", () => {
    expect(measureSlowMarkdownCodeBlocks("```\na\n```\n```\nb\n```")).toEqual([
      { start: 0, end: 9, contentLines: 1 },
      { start: 10, end: 19, contentLines: 1 },
    ]);
  });
});

describe("holdBackSlowMarkdown - which runs are held back", () => {
  test("a text of at most the minimum length is given to the parser as it is", () => {
    const text: string = `${"*a ".repeat(Math.floor(SLOW_MARKDOWN_MIN_LENGTH / 3))}`;

    expect(text.length).toBeLessThanOrEqual(SLOW_MARKDOWN_MIN_LENGTH);
    expect(holdBack(text, { maxInlineWork: 1 }).result === text).toBe(true);
  });

  test("...but a line nested deeper than the parsers take is held back even there", () => {
    const deep: string = `${"> ".repeat(SLOW_MARKDOWN_MAX_NESTING_DEPTH + 1)}a`;
    const recorded: Recorded = holdBack(`Before\n\n${deep}\n\nAfter`, {
      maxNestingDepth: SLOW_MARKDOWN_MAX_NESTING_DEPTH,
    });

    expect(recorded.result).toBe("Before\n\n<L0>\n\nAfter");
    expect(recorded.lines).toEqual([deep]);
  });

  test("a run that costs more inline work than the limit is held back whole", () => {
    const costly: string = "*a ".repeat(1000).trim();
    const text: string = `${FILLER}${costly}\n\nAfter *this*`;

    const recorded: Recorded = holdBack(text, { maxInlineWork: 10000 });

    expect(recorded.result).toBe(`${FILLER}<L0>\n\nAfter *this*`);
    expect(recorded.lines).toEqual([costly]);
  });

  test("the costliest runs go first, until the rest fit", () => {
    const cheap: string = "*a ".repeat(30).trim();
    const dear: string = "*a ".repeat(300).trim();
    const text: string = `${cheap}\n\n${dear}\n\n${FILLER}${cheap}`;

    const recorded: Recorded = holdBack(text, { maxInlineWork: 100000 });

    expect(recorded.lines).toEqual([dear]);
    expect(putBack(recorded) === text).toBe(true);
  });

  test("a word of punctuation is costly however few the delimiters", () => {
    const word: string = "a.".repeat(2000);
    const recorded: Recorded = holdBack(`${FILLER}${word}`, {
      maxInlineWork: SLOW_MARKDOWN_MAX_INLINE_WORK,
    });

    expect(recorded.lines).toEqual([word]);
  });

  test("snake_case words are costly only where the parser reads them", () => {
    const log: string = "foo_bar_baz qux_quux ".repeat(4000);

    expect(
      holdBack(log, { maxInlineWork: SLOW_MARKDOWN_MAX_INLINE_WORK }).lines,
    ).toEqual([]);
    expect(
      holdBack(log, {
        maxInlineWork: SLOW_MARKDOWN_MAX_INLINE_WORK,
        countWordUnderscores: true,
      }).lines,
    ).toEqual([log]);
  });

  test("runs over a line limit, a unit over its length or lines, and wide rows are held back", () => {
    const list: string = "- item\n".repeat(50).trimEnd();
    const paragraph: string = "word ".repeat(1000).trim();
    const row: string = `|${" a |".repeat(200)}`;

    expect(holdBack(`${FILLER}${list}`, { maxRunLines: 49 }).lines).toEqual([
      list,
    ]);
    expect(
      holdBack(`${FILLER}${paragraph}`, { maxUnitLength: 4096 }).lines,
    ).toEqual([paragraph]);
    expect(
      holdBack(`${FILLER}${"line\n".repeat(300).trimEnd()}`, {
        maxUnitLines: 256,
      }).lines,
    ).toHaveLength(1);
    expect(holdBack(`${FILLER}${row}`, { maxCellsPerLine: 128 }).lines).toEqual(
      [row],
    );
  });

  test("over the lines of a whole text, the later of equal runs go first and neighbours become one token", () => {
    const run: string = "one\ntwo";
    const text: string = `${FILLER}${[run, run, run, run].join("\n\n")}`;

    // The filler is one line; eight lines of runs.
    const recorded: Recorded = holdBack(text, { maxLines: 5 });

    expect(recorded.result).toBe(`${FILLER}${run}\n\n${run}\n\n<L0>`);
    expect(recorded.lines).toEqual([`${run}\n\n${run}`]);
  });

  test("code blocks count toward the lines of a text, and are held back whole when there are too many", () => {
    const block: string = "```\na\nb\nc\n```";
    const text: string = `${FILLER}${[block, block, block].join("\n\n")}`;

    const recorded: Recorded = holdBack(text, { maxLines: 12 });

    // The filler's line and two blocks of five lines each fit.
    expect(recorded.result).toBe(`${FILLER}${block}\n\n${block}\n\n<L0>`);
    expect(recorded.lines).toEqual([block]);
  });

  test("the content of fenced code is held back as one token where its lines would hold back more", () => {
    const content: string = "line *a\nline [b";
    const text: string = `${FILLER}\`\`\`js\n${content}\n\`\`\`\n\nafter`;

    /*
     * The filler, the code block's three lines and "after" make five; with
     * its two lines of content it is six. Held to five lines, the content
     * is held back as one token, and the code block stays a code block...
     */
    const recorded: Recorded = holdBack(text, {
      holdBackCodeBlockContent: true,
      maxLines: 5,
    });

    expect(recorded.result).toBe(`${FILLER}\`\`\`js\n<C0>\n\`\`\`\n\nafter`);
    expect(recorded.code).toEqual([content]);
    expect(recorded.lines).toEqual([]);

    // ...where a parser that does not ask for it has the block held back whole.
    expect(
      holdBack(text, { holdBackCodeBlockContent: false, maxLines: 5 }).lines,
    ).toEqual([`\`\`\`js\n${content}\n\`\`\``]);
  });

  test("fenced code within the lines a text may have stays as it was written", () => {
    const content: string = "line *a\nline [b";
    const text: string = `${FILLER}\`\`\`js\n${content}\n\`\`\`\n\nafter`;

    for (const maxLines of [6, 2048, Number.POSITIVE_INFINITY]) {
      const recorded: Recorded = holdBack(text, {
        holdBackCodeBlockContent: true,
        maxLines: maxLines,
      });

      expect([maxLines, recorded.result === text]).toEqual([maxLines, true]);
      expect(recorded.code).toEqual([]);
    }
  });

  test("code held back as tokens only when that keeps a run from being held back as text", () => {
    const block: string = "```\na\nb\nc\nd\n```";
    const text: string = `${FILLER}${block}\n\nlast words`;

    // Seven lines as written; five with the block's content as one token.
    const recorded: Recorded = holdBack(text, {
      holdBackCodeBlockContent: true,
      maxLines: 5,
    });

    expect(recorded.result).toBe(`${FILLER}\`\`\`\n<C0>\n\`\`\`\n\nlast words`);
    expect(recorded.code).toEqual(["a\nb\nc\nd"]);
    expect(putBack(recorded)).toBe(text);
  });

  test("a text in which nothing is costly comes back exactly as it was", () => {
    const text: string = `${FILLER}# Title\n\nSome *emphasis*, a [link](https://example.com) and \`code\`.\n\n- one\n- two\n`;

    const recorded: Recorded = holdBack(text, {
      maxInlineWork: SLOW_MARKDOWN_MAX_INLINE_WORK,
      maxLines: 2048,
      maxRunLines: 1024,
    });

    expect(recorded.result).toBe(text);
    expect(recorded.lines).toEqual([]);
  });

  test("a line break written as \\r\\n is a line break", () => {
    const costly: string = "*a ".repeat(500).trim();
    const text: string = `${FILLER.replace(/\n/g, "\r\n")}${costly}\r\n\r\nafter`;

    const recorded: Recorded = holdBack(text, { maxInlineWork: 1000 });

    expect(recorded.lines).toEqual([costly]);
    expect(putBack(recorded) === text).toBe(true);
  });
});

describe("holdBackSlowMarkdown - what is held back comes back as it was written", () => {
  const PIECES: ReadonlyArray<string> = [
    "a",
    "word ",
    "foo_bar",
    " ",
    "\n",
    "\n\n",
    "\r\n",
    "*",
    "_",
    "~~",
    "`",
    "```",
    "~~~",
    "[",
    "](",
    ")",
    "<a",
    "<!--",
    "-->",
    "> ",
    "- ",
    "1. ",
    "  ",
    "| a |",
    "|---|",
    "\\",
    "&amp;",
    "www.",
    "@",
    "a.b",
    "#",
    "😀",
  ];

  // A seeded generator, so a failure can be run again.
  function random(seed: number): () => number {
    let state: number = seed;

    return (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  test("for 300 texts and limits that hold much back", () => {
    const next: () => number = random(4566);
    let heldSomething: number = 0;

    for (let index: number = 0; index < 300; index++) {
      let text: string = "";
      const size: number = 2100 + Math.floor(next() * 6000);

      while (text.length < size) {
        text += PIECES[Math.floor(next() * PIECES.length)];
      }

      const recorded: Recorded = holdBack(text, {
        maxInlineWork: 200 + Math.floor(next() * 20000),
        maxRunLines: 2 + Math.floor(next() * 40),
        maxLines: 5 + Math.floor(next() * 80),
        maxUnitLength: 50 + Math.floor(next() * 500),
        maxNestingDepth: 1 + Math.floor(next() * 4),
        maxCellsPerLine: 1 + Math.floor(next() * 6),
        holdBackCodeBlockContent: next() < 0.5,
        countUrlLiterals: next() < 0.5,
        countWordUnderscores: next() < 0.5,
      });

      if (recorded.lines.length + recorded.code.length > 0) {
        heldSomething++;
      }

      // A boolean: a failure names the seed's case, not 8 KB of text.
      expect([index, putBack(recorded) === text]).toEqual([index, true]);
    }

    expect(heldSomething).toBeGreaterThan(200);
  });
});
