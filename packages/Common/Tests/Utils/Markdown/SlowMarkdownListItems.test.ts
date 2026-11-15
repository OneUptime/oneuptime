import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { Lexer, Tokenizer, Tokens } from "marked";
import {
  MARKED_LIST_LINE_SHARE,
  SLOW_MARKDOWN_MAX_INLINE_WORK,
  SLOW_MARKDOWN_MAX_NESTING_DEPTH,
  SlowMarkdownHolder,
  SlowMarkdownLimits,
  SlowMarkdownRun,
  holdBackSlowMarkdown,
  measureSlowMarkdownRuns,
} from "../../../Utils/Markdown/SlowMarkdown";

/*
 * ISSUE #7598: A LIST ITEM OF THOUSANDS OF LINES.
 *
 * marked reads a list item's text with blockTokens(text, top = false), where
 * each line is a block of its own, and before each it tries its rule for a
 * setext heading, whose lazy loop reads on through the rest of the item for
 * an underline: an item of N lines cost marked N looks through it. 6,000
 * lines of "aaa bbb" in one item took an email 4.4 s where V8 compiles
 * regular expressions unoptimized, four such items 16 s - and the guard
 * before marked (Utils/Markdown/SlowMarkdown) held none of them back, as
 * it took marked to read lists in linear time.
 *
 * Now the emails count each line of a list item marked reads as a line of
 * text as a look through half of the item (MARKED_LIST_LINE_SHARE), the
 * lines of a loose item's later paragraphs too, and what marked reads whole
 * - quotes, headings, fenced code - as nothing more. These pin the count,
 * hold the slow shapes back and the ordinary ones not, and hold what
 * reaches marked to what its setext heading rule reads there - counted in
 * marked itself, so the bound says the same on any machine.
 */

// The emails' limits (Server/Types/Markdown EMAIL_SLOW_MARKDOWN_LIMITS).
const EMAIL_LIMITS: SlowMarkdownLimits = {
  maxInlineWork: SLOW_MARKDOWN_MAX_INLINE_WORK,
  maxRunLines: Number.POSITIVE_INFINITY,
  maxLines: Number.POSITIVE_INFINITY,
  maxUnitLines: Number.POSITIVE_INFINITY,
  maxUnitLength: Number.POSITIVE_INFINITY,
  maxNestingDepth: SLOW_MARKDOWN_MAX_NESTING_DEPTH,
  maxCellsPerLine: Number.POSITIVE_INFINITY,
  holdBackCodeBlockContent: false,
  countUrlLiterals: false,
  countWordUnderscores: false,
  countAsMarked: true,
};

// What marked is given of `text`: each stretch held back as a token.
const givenToMarked: (text: string) => { text: string; held: number } = (
  text: string,
): { text: string; held: number } => {
  let held: number = 0;
  const holder: SlowMarkdownHolder = {
    holdLines: (): string => {
      held++;
      return `${held}`;
    },
    holdCode: (): string => {
      held++;
      return `${held}`;
    },
  };

  return { text: holdBackSlowMarkdown(text, holder, EMAIL_LIMITS), held: held };
};

const isHeldBack: (text: string) => boolean = (text: string): boolean => {
  return givenToMarked(text).held > 0;
};

// The inline work of `text`'s runs, counted as for marked, each run's.
const runWork: (text: string) => Array<number> = (
  text: string,
): Array<number> => {
  return measureSlowMarkdownRuns(text, { countAsMarked: true }).map(
    (run: SlowMarkdownRun): number => {
      return run.inlineWork;
    },
  );
};

const lines: (count: number, line: string) => string = (
  count: number,
  line: string,
): string => {
  return `${line}\n`.repeat(count);
};

/*
 * WHAT MARKED'S SETEXT HEADING RULE READS IN LIST ITEMS. Each time marked
 * tries it inside a list item (state.top false), its lazy loop reads on
 * from the line it is tried at to the first line break before a blank line
 * or a line that starts a block - a bullet, four spaces of indentation, a
 * fence, a quote, a heading or HTML (marked 12's `lheading`, block.normal)
 * - and the work is that many characters. A line that starts such a block
 * itself is no setext heading: nothing is read.
 */
const SETEXT_STOP: RegExp =
  /\n(?=[ \t]*\n|(?:[*+-]|\d{1,9}[.)]) | {4}| {0,3}(?:`{3,}|~{3,})| {0,3}>| {0,3}#{1,6}| {0,3}<[^\n>]+>\n)/;
const BLOCK_START: RegExp =
  /^(?:(?:[*+-]|\d{1,9}[.)]) | {4}| {0,3}(?:`{3,}|~{3,})| {0,3}>| {0,3}#{1,6}| {0,3}<[^\n>]+>\n)/;

let setextSpy: SpyInstance | null = null;

afterEach(() => {
  setextSpy?.mockRestore();
  setextSpy = null;
});

// The characters marked's setext heading rule reads in list items, lexing `text`.
const setextReadingIn: (text: string) => number = (text: string): number => {
  let read: number = 0;
  const original: Tokenizer["lheading"] = Tokenizer.prototype.lheading;

  setextSpy = jest
    .spyOn(Tokenizer.prototype, "lheading")
    .mockImplementation(function (
      this: Tokenizer,
      src: string,
    ): Tokens.Heading | undefined {
      if (!this.lexer.state.top && !BLOCK_START.test(src)) {
        const stop: number = src.search(SETEXT_STOP);

        read += stop === -1 ? src.length : stop;
      }

      return original.call(this, src);
    });

  try {
    new Lexer({ gfm: true, breaks: false, pedantic: false }).lex(text);
  } finally {
    setextSpy.mockRestore();
    setextSpy = null;
  }

  return read;
};

describe("measureSlowMarkdownRuns - a list item's lines, as marked reads them (#7598)", () => {
  test("each line of text in an item is a look through half of it", () => {
    // Three lines of text, 12 characters: 3 * 12 / 2.
    expect(MARKED_LIST_LINE_SHARE).toBe(2);
    expect(runWork("- a\n  b\n  c")).toEqual([18]);
    // An ordered item, and a lazy line.
    expect(runWork("1. a\n   b\nc")).toEqual([Math.ceil((3 * 12) / 2)]);
  });

  test("an item's work grows with the square of its lines; a paragraph's, a quote's and a list's of one-line items do not", () => {
    const item: (count: number) => number = (count: number): number => {
      return runWork(`- start\n${lines(count, "  aaa bbb")}`)[0]!;
    };

    expect(item(2000) / item(1000)).toBeGreaterThan(3.9);
    expect(runWork(lines(3000, "aaa bbb"))).toEqual([0]);
    expect(runWork(lines(3000, "> aaa bbb"))).toEqual([0]);

    // Each one-line item is a line of text in an item of its own.
    expect(runWork(lines(3000, "- aaa bbb"))[0]).toBe(3000 * 5);
  });

  test.each([
    ["a quote in the item", "  > aaa bbb", 0],
    // Each "#aaa" a word with one punctuation character (getWordPunctuationWork).
    ["lines of hashes in the item", "  #aaa bbb", 4],
  ])(
    "%s cost nothing more",
    (_name: string, line: string, punctuationWork: number) => {
      // The item's first line alone is text: one look through the item.
      const text: string = `- start\n${lines(3000, line)}`;

      expect(runWork(text)).toEqual([
        Math.ceil(text.length / 2) + 3000 * punctuationWork,
      ]);
    },
  );

  test("headings in the item cost nothing more: each is a unit of its own", () => {
    /*
     * "- start" is a line of text of 8 characters; each heading none, but
     * its "#", a word of one punctuation character.
     */
    expect(runWork(`- start\n${lines(3000, "  # aaa bbb")}`)).toEqual([
      4 + 3000,
    ]);
  });

  test("fenced code costs nothing more where the item's text is known to start", () => {
    const fenced: string = `- Error\n  \`\`\`\n${lines(3000, "  const value compute input")}  \`\`\`\n  done`;
    const known: number = runWork(fenced)[0]!;

    /*
     * "Error" and "done", two lines of text, and the fences' six backticks,
     * which marked can read a code span from: each a look through. And each
     * fence a word of three punctuation characters (getWordPunctuationWork).
     */
    expect(known).toBe((6 + 1) * (fenced.length + 1) + 2 * 3 * 3);

    // Two spaces after the marker: where its text starts is not known.
    expect(runWork(fenced.replace("- Error", "-  Error"))[0]).toBeGreaterThan(
      100 * known,
    );
  });

  test("a loose item's later paragraphs are its lines too, run after run", () => {
    const work: Array<number> = runWork(
      `- start\n\n${lines(1000, "  aaa bbb")}\n${lines(1000, "    aaa bbb")}`,
    );

    expect(work).toHaveLength(3);
    expect(work[1]).toBe(Math.ceil((1000 * 10000) / 2));
    expect(work[2]).toBe(Math.ceil((1000 * 12000) / 2));

    // Not indented as far as the item's text: a paragraph after the list.
    expect(runWork(`- start\n\n${lines(1000, " aaa bbb")}`)[1]).toBe(0);
    // Not after a list: an indented paragraph.
    expect(runWork(`para\n\n${lines(1000, "  aaa bbb")}`)[1]).toBe(0);
  });

  test("the dashboard and Slack count a list item as they did", () => {
    const item: string = `- start\n${lines(3000, "  aaa bbb")}`;

    expect(measureSlowMarkdownRuns(item)[0]!.inlineWork).toBe(0);
    expect(
      measureSlowMarkdownRuns(item, {
        countUrlLiterals: true,
        countWordUnderscores: true,
      })[0]!.inlineWork,
    ).toBe(0);
  });
});

/*
 * Long items marked reads slowly, and ordinary ones it reads in good time -
 * each checked against marked's own reading of it here: the setext heading
 * rule reads far more than the budget in every slow one, and next to
 * nothing in the others.
 */
const code: (count: number, indentation: string) => string = (
  count: number,
  indentation: string,
): string => {
  return lines(count, `${indentation}const value = compute(input, 42);`);
};

const SLOW_ITEMS: ReadonlyArray<[string, string]> = [
  ["one item of 3,000 lines", `- start\n${lines(3000, "  aaa bbb")}`],
  ["an ordered item", `1. start\n${lines(3000, "   aaa bbb")}`],
  ["lazy lines", `- start\n${lines(3000, "aaa bbb")}`],
  ["an item in a quote", `> - start\n${lines(3000, ">   aaa bbb")}`],
  ["an item in an item", `- a\n  - start\n${lines(3000, "    aaa bbb")}`],
  ["a loose item", `- start\n\n${lines(3000, "  aaa bbb")}`],
  ["a loose item, indented four", `- start\n\n${lines(3000, "    aaa bbb")}`],
  [
    "an empty fence, then text",
    `- a\n  \`\`\`\n  \`\`\`\n${lines(3000, "  aaa bbb")}`,
  ],
  [
    "a fence indented as code, then text",
    `- a\n      \`\`\`\n${lines(3000, "  aaa bbb")}`,
  ],
  [
    "white space after the marker",
    `-     a\n      \`\`\`\n${lines(3000, "  aaa bbb")}`,
  ],
  [
    "a nested item's fence, then its text",
    `- a\n    - b\n      \`\`\`\n      \`\`\`\n${lines(3000, "      aaa bbb")}`,
  ],
  ["a heading in the item", `- a\n  # h\n${lines(3000, "  aaa bbb")}`],
  ["a heading in a loose item", `- a\n\n  # h\n${lines(3000, "  aaa bbb")}`],
  [
    "a fence closed past a blank line, then text",
    `- a\n  \`\`\`\n${code(100, "  ")}\n  \`\`\`\n${lines(3000, "  aaa bbb")}`,
  ],
  [
    "a fence closed only three columns in, then text",
    `- \`\`\`\n      \`\`\`\n      \`\`\`\n  \`\`\`\`\n${lines(3000, "   aaa bbb")}`,
  ],
  [
    "a fence in HTML, then text",
    `- a\n  <div>\n  \`\`\`\n\n${lines(3000, "  aaa bbb")}`,
  ],
  ["an empty item's lines", `-\n${lines(3000, "  aaa bbb")}`],
  ["an ordered item past ten", `10) a\n${lines(3000, " aaa bbb")}`],
];

const ORDINARY_ITEMS: ReadonlyArray<[string, string]> = [
  [
    "fenced code in an item",
    `- Error:\n  \`\`\`\n${code(2000, "  ")}  \`\`\`\n`,
  ],
  [
    "fenced code in a loose item",
    `- Error:\n\n  \`\`\`\n${code(2000, "  ")}  \`\`\`\n`,
  ],
  [
    "fenced code with a blank line, in a loose item",
    `- Error:\n\n  \`\`\`\n${code(1000, "  ")}\n${code(1000, "  ")}  \`\`\`\n\n  done\n`,
  ],
  [
    "fenced code in an ordered item",
    `1. Step\n   \`\`\`\n${code(2000, "   ")}   \`\`\`\n`,
  ],
  ["a tilde fence", `- Error:\n  ~~~\n${code(2000, "  ")}  ~~~\n`],
  [
    "fenced code in an item in a quote",
    `> - Error:\n>   \`\`\`\n${code(2000, ">   ")}>   \`\`\`\n`,
  ],
  [
    "items each with code",
    `- Step\n  \`\`\`\n${code(50, "  ")}  \`\`\`\n`.repeat(40),
  ],
  ["a quote in an item", `- Note:\n${lines(2000, "  > aaa bbb")}`],
  ["nested one-line items", `- a\n${lines(2000, "  - aaa bbb")}`],
  ["3,600 one-line items", lines(3600, "- aaa bbb")],
  ["a paragraph of 3,600 lines", lines(3600, "aaa bbb")],
  ["a quote of 3,600 lines", lines(3600, "> aaa bbb")],
  [
    "an item of 300 lines of words",
    `- a\n${lines(300, `  ${"word ".repeat(7)}`)}`,
  ],
  [
    "a release note",
    `## Changes\n\n${`- Fixed a bug in the probe\n  that dropped a check.\n`.repeat(300)}`,
  ],
];

describe("holdBackSlowMarkdown - the emails hold back the list items marked reads slowly (#7598)", () => {
  test.each(SLOW_ITEMS)("%s", (_name: string, text: string) => {
    expect(isHeldBack(text)).toBe(true);
    // And marked reads what it is given in good time.
    expect(setextReadingIn(givenToMarked(text).text)).toBeLessThan(
      SLOW_MARKDOWN_MAX_INLINE_WORK,
    );
  });

  test.each(ORDINARY_ITEMS)("not %s", (_name: string, text: string) => {
    expect(isHeldBack(text)).toBe(false);
    expect(setextReadingIn(text)).toBeLessThan(SLOW_MARKDOWN_MAX_INLINE_WORK);
  });

  test("marked's setext heading rule reads each slow one past the budget", () => {
    for (const [name, text] of SLOW_ITEMS) {
      expect({
        name: name,
        isPastTheBudget:
          setextReadingIn(text) > 4 * SLOW_MARKDOWN_MAX_INLINE_WORK,
      }).toEqual({
        name: name,
        isPastTheBudget: true,
      });
    }
  });
});

/*
 * Generated list items: a first line of every kind of marker, lines of
 * every kind of block after it, and a long body of lines at every
 * indentation, blank lines between some - where a fence, a heading, a
 * quote or a tab could make the count lose track of the item. What reaches
 * marked never costs its setext heading rule much more than the budget.
 */
const FIRST_LINES: ReadonlyArray<string> = [
  "- a",
  "* a",
  "1. a",
  "10) a",
  "-     a",
  "-\ta",
  "- - a",
  "- > a",
  "- 1. a",
  "> - a",
  "> > 1. a",
  "- ```",
  "-",
];

const MIDDLE_LINES: ReadonlyArray<string> = [
  "  ```",
  "  ~~~",
  "      ```",
  "```",
  "  # h",
  "# h",
  "  > q",
  "    - b",
  "  - b",
  "   - b",
  "\t```",
  "  \t```",
  "  <div>",
  "",
  ">",
  ">   ```",
  "  ````",
  "  ```js",
  "  ``` `",
  "   ```",
  "     ```",
  "  ```  ",
  "  ``` x",
  "  ```~~",
  "  [a]: /u '",
  "  '",
  "[a]: /u",
  "<!--",
  "  -->",
  "text",
];

const INDENTATIONS: ReadonlyArray<string> = [
  "",
  " ",
  "  ",
  "   ",
  "    ",
  "      ",
  "\t",
  "> ",
  ">   ",
];

const generatedItems: (count: number, seed: number) => Array<string> = (
  count: number,
  seed: number,
): Array<string> => {
  const random: SeededRandom = seededRandom(seed);
  const texts: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    const parts: Array<string> = [FIRST_LINES[random(FIRST_LINES.length)]!];

    for (let middle: number = random(6); middle > 0; middle--) {
      parts.push(MIDDLE_LINES[random(MIDDLE_LINES.length)]!);
    }

    const indentation: string = INDENTATIONS[random(INDENTATIONS.length)]!;
    const blankEvery: number = [0, 0, 500, 1000][random(4)]!;

    for (let line: number = 0; line < 2500; line++) {
      if (blankEvery > 0 && line > 0 && line % blankEvery === 0) {
        parts.push("");
      }

      if (line === 1200 && random(3) === 0) {
        parts.push(MIDDLE_LINES[random(MIDDLE_LINES.length)]!);
      }

      parts.push(`${indentation}aaa bbb`);
    }

    texts.push(parts.join("\n"));
  }

  return texts;
};

describe("What reaches marked of generated list items", () => {
  test("never costs marked's setext heading rule much more than the budget", () => {
    let slow: number = 0;

    for (const text of generatedItems(400, 75980)) {
      const reaching: string = givenToMarked(text).text;
      const read: number = setextReadingIn(reaching);

      if (reaching !== text) {
        slow++;
      }

      expect({
        text: text.slice(0, 80),
        read: read <= 2 * SLOW_MARKDOWN_MAX_INLINE_WORK,
      }).toEqual({
        text: text.slice(0, 80),
        read: true,
      });
    }

    // Most of them are slow, and held back.
    expect(slow).toBeGreaterThan(100);
  }, 300000);
});
