import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { Lexer, Token, TokensList, marked } from "marked";
import {
  MARKED_MASKED_ITEM_SHARE,
  MARKED_TAIL_READING_SHARE,
  MAX_MARKED_LABEL_LENGTH,
  MarkedLineWork,
  SLOW_MARKDOWN_MAX_INLINE_WORK,
  SLOW_MARKDOWN_MAX_NESTING_DEPTH,
  SlowMarkdownHolder,
  SlowMarkdownLimits,
  SlowMarkdownRun,
  getInlineCharacterCount,
  getMarkedDefinitionAddressStart,
  getMarkedLineWork,
  getMarkedLinkEnd,
  getWordPunctuationWork,
  holdBackSlowMarkdown,
  measureSlowMarkdownRuns,
} from "../../../Utils/Markdown/SlowMarkdown";

/*
 * MARKDOWN AS MARKED READS IT (Utils/Markdown/SlowMarkdown, #7228).
 *
 * The emails hold back Markdown that marked would read slowly. A paragraph
 * of 280 references, or a link to an address with a long query, was held
 * back as if marked looked through the rest of the paragraph from each of
 * their brackets and each punctuation character of the address - and the
 * email showed their Markdown, where marked reads them in milliseconds.
 * Now the emails count a line as marked reads it (counting.countAsMarked):
 * a link or a reference whose label closes is a copy of its unit, what a
 * link's parentheses or a definition hold is read once, and a "&" and a "]"
 * cost nothing - while what marked does read slowly is still held back, and
 * a run of an email address's characters before an "@" now is too. The
 * dashboard and Slack count as they did.
 *
 * Where the count reads a link's end or a definition, marked must agree
 * exactly: what the count reads once, marked must never read as inline
 * Markdown. The generated tests below hold it to marked's own lexer.
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

// The same, counted as before: what the emails held back until now.
const EMAIL_LIMITS_BEFORE: SlowMarkdownLimits = {
  ...EMAIL_LIMITS,
  countAsMarked: false,
};

// The lines of the text held back, each held piece in order.
function heldBack(text: string, limits: SlowMarkdownLimits): Array<string> {
  const held: Array<string> = [];
  const holder: SlowMarkdownHolder = {
    holdLines: (lines: string): string => {
      held.push(lines);
      return `\uE005${held.length - 1}\uE006`;
    },
    holdCode: (code: string): string => {
      held.push(code);
      return `\uE005${held.length - 1}\uE006`;
    },
  };

  holdBackSlowMarkdown(text, holder, limits);

  return held;
}

// What the whole of `text` costs marked, as one line.
function lineWork(text: string): MarkedLineWork {
  return getMarkedLineWork(text, 0, text.length);
}

// The inline work of all the runs of `text`, counted as marked reads it.
function markedWork(text: string): number {
  return measureSlowMarkdownRuns(text, { countAsMarked: true }).reduce(
    (sum: number, run: SlowMarkdownRun): number => {
      return sum + run.inlineWork;
    },
    0,
  );
}

/*
 * References, images and links in turn, one on each line (or joined by
 * `joiner`), then their definition: the issue's paragraph.
 */
function references(count: number, joiner: string = "\n"): string {
  const lines: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    lines.push(index % 2 === 0 ? `![Shot ${index}][s]` : `[Run ${index}][s]`);
  }

  return `${lines.join(joiner)}\n\n[s]: https://example.com/a.png`;
}

/*
 * A screenshot of each of `count` runs, one on each line, and each one's
 * definition, one on each line of a block of its own.
 */
function runScreenshots(count: number): string {
  const shots: Array<string> = [];
  const definitions: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    shots.push(`![Run ${index}][s${index}]`);
    definitions.push(
      `[s${index}]: https://ci.example.com/runs/${index}/screenshot.png`,
    );
  }

  return `${shots.join("\n")}\n\n${definitions.join("\n")}`;
}

// A dashboard's address with a query at least `length` characters long.
function queryAddress(length: number): string {
  let address: string = "https://grafana.example.com/d/abc/checkout?";

  for (let index: number = 0; address.length < length; index++) {
    address += `${index === 0 ? "" : "&"}k${index}=v${index}`;
  }

  return address;
}

// Plain words, long enough that a text is measured.
const FILLER: string = `${"lorem ipsum dolor sit amet ".repeat(100).trim()}\n\n`;

describe("getMarkedLineWork - a link or a reference whose label closes", () => {
  test.each([
    ["a link", "[Run](https://example.com/run)", 1],
    ["an image", "![Shot](https://example.com/a.png)", 1],
    ["a link with a title", '[Run](https://example.com/run "Run it")', 1],
    ["a link with its address in <>", "[Run](<https://example.com/a b>)", 1],
    ["a full reference", "[Run][s]", 1],
    ["an image's full reference", "![Shot][s]", 1],
    ["a collapsed reference", "[s][]", 1],
    ["a shortcut reference", "[s]", 1],
    ["an empty label", "[](https://example.com)", 1],
    // The escape is masked too.
    ["an escaped bracket in the label", "[a\\]b](https://example.com)", 2],
  ])(
    "is a masked item, not a look through the unit: %s",
    (_name: string, text: string, maskedItems: number) => {
      expect(lineWork(text)).toMatchObject({
        characters: 0,
        maskedItems: maskedItems,
      });
      // The other parsers look ahead from each of its brackets.
      expect(getInlineCharacterCount(text, 0, text.length)).toBeGreaterThan(1);
    },
  );

  test("a reference's text and label are one item; the next pair is another", () => {
    expect(lineWork("[a][b][c][d]").maskedItems).toBe(2);
    expect(lineWork("[a][b] [c][d] [e]").maskedItems).toBe(3);
    expect(lineWork("[a](b)[c]").maskedItems).toBe(2);
    expect(lineWork("[a](b)[c](d)").maskedItems).toBe(2);
  });

  test("a label up to its longest closes; one character more does not", () => {
    const longest: string = `[${"a".repeat(MAX_MARKED_LABEL_LENGTH)}]`;
    const longer: string = `[${"a".repeat(MAX_MARKED_LABEL_LENGTH + 1)}]`;

    expect(lineWork(longest)).toMatchObject({ characters: 0, maskedItems: 1 });
    expect(lineWork(longer)).toMatchObject({ characters: 1, maskedItems: 0 });
  });

  test("what the label holds is read: its emphasis is a look through", () => {
    expect(lineWork("[*Run* now][s]")).toMatchObject({
      characters: 2,
      maskedItems: 1,
    });
  });
});

describe("getMarkedLineWork - a bracket or an address that does not close", () => {
  test.each([
    ["a label that never closes", "[a", 1, 0],
    ["a label with a bracket in it", "[a [b] c", 1, 1],
    ["a label with a code span in it", "[a `b]", 2, 0],
    ["an address that never closes", "[a](b", 1, 0],
    ["an address with white space in it", "[a](b c)", 1, 0],
    ["a title that never closes", '[a](b "c)', 1, 0],
    ["an address in <> that never closes", "[a](<b)", 2, 0],
    ["a parenthesis left open", "[a](b(c)", 1, 0],
    ["white space before an address a ) ends", "[a]( b)", 1, 0],
    ["link openers", "[a]([a]([a](", 3, 0],
  ])(
    "is a look through the rest of its unit, as for every parser: %s",
    (_name: string, text: string, characters: number, maskedItems: number) => {
      expect(lineWork(text)).toMatchObject({
        characters: characters,
        maskedItems: maskedItems,
      });
    },
  );
});

/*
 * A link tail that does not close is read again by each tail inside it, so
 * a line's tails read MARKED_TAIL_READING_SHARE times the line at most:
 * past that, a tail counts as one that does not close. Before, 64 KB of
 * "[a](" took the count 2.9 s, and a megabyte of such lines 40 s.
 */
describe("getMarkedLineWork - what the link tails of a line read", () => {
  // `piece` again and again, to `length` characters.
  const repeatTo: (piece: string, length: number) => string = (
    piece: string,
    length: number,
  ): string => {
    return piece.repeat(Math.ceil(length / piece.length)).slice(0, length);
  };

  // Lines of 64 KB of `piece`, to a megabyte.
  const linesOf: (piece: string) => string = (piece: string): string => {
    return repeatTo(`${repeatTo(piece, 64 * 1024 - 1)}\n`, 1024 * 1024);
  };

  test("a tail past what the line's tails may read counts as one that does not close", () => {
    /*
     * Each "[a](" reads to the space after the last: the ninth is past
     * eight times the line, and the link after the space reads as not
     * closing too.
     */
    expect(lineWork(`${"[a](".repeat(100)} [b](c)`)).toMatchObject({
      characters: 101,
      maskedItems: 0,
    });
    // Three read within it, and the link after them closes.
    expect(lineWork(`${"[a](".repeat(3)} [b](c)`)).toMatchObject({
      characters: 3,
      maskedItems: 1,
    });
    expect(MARKED_TAIL_READING_SHARE).toBe(8);
  });

  test("8,000 links that close on one line are each read once, within it", () => {
    expect(lineWork("[a](b) ".repeat(8000))).toMatchObject({
      characters: 0,
      maskedItems: 8000,
    });
    expect(
      lineWork(
        `${"[a](b) ".repeat(4000)}[q](${queryAddress(32 * 1024)} "Run")`,
      ),
    ).toMatchObject({ characters: 0, maskedItems: 4001 });
  });

  test.each([
    ["a megabyte of lines of link openers", linesOf("[a](")],
    ["a megabyte of lines of image openers", linesOf("![a](")],
    ["a line of 256 KB of link openers", repeatTo("[a](", 256 * 1024)],
    ["a megabyte of lines of titles in () left open", linesOf("[a](x (")],
    [
      "a megabyte of lines of parentheses left open, then links",
      repeatTo(
        `${repeatTo("[a](x(", 32 * 1024)}${repeatTo("[b](y)", 32 * 1024 - 1)}\n`,
        1024 * 1024,
      ),
    ],
    ["a megabyte of lines of addresses in <> left open", linesOf("[a](<x")],
    ["a megabyte of lines of titles in quotes left open", linesOf('[a](x "')],
  ])(
    "%s: held back, and counted in time that grows with it",
    (_name: string, text: string) => {
      const timed: FastestRun<Array<string>> = fastestRun({
        run: (): Array<string> => {
          return heldBack(text, EMAIL_LIMITS);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
      expect(timed.result.join("\n").length).toBeGreaterThan(text.length / 2);
    },
  );
});

describe("getMarkedLineWork - what marked reads once", () => {
  test("a link's address and title: counted once, never as inline Markdown", () => {
    const text: string = `[a](${queryAddress(512)}&q=*x*&r=_y_&s=a!b!c "Run *now*, \`twice\`")`;
    const tail: number = text.length - "[a]".length;
    const work: number = tail + 2 * text.length;

    expect(lineWork(text)).toEqual({
      characters: 0,
      maskedItems: 1,
      // The tail once, and the label's two brackets times the word's length.
      work: work,
      isDefinition: false,
    });
    // Before: every punctuation character times the word's length.
    expect(getWordPunctuationWork(text, 0, text.length)).toBeGreaterThan(
      20 * work,
    );
  });

  test("an address of 32 KB of query costs about its length, not its square", () => {
    const address: string = queryAddress(32 * 1024);
    const text: string = `See [the dashboard](${address}) for the run.`;

    expect(lineWork(text).work).toBeLessThan(4 * text.length);
    expect(getWordPunctuationWork(text, 0, text.length)).toBeGreaterThan(
      1000 * address.length,
    );
  });

  test("a definition is read once, its label too", () => {
    const address: string = queryAddress(4096);
    const text: string = `[d]: ${address} "Checkout"`;

    expect(lineWork(text)).toEqual({
      characters: 0,
      // marked's block rule takes the line whole: none of it is inline.
      maskedItems: 0,
      work: text.length,
      isDefinition: true,
    });
  });

  test.each([
    ["emphasis", "[*Run* now]: /a"],
    ["a tag", "[<b>Run</b>]: /a"],
    ["an escape", "[Run\\*]: /a"],
    ["an email address", "[ops@example.com]: mailto:ops@example.com"],
  ])(
    "what a definition's label holds is not inline Markdown either: %s",
    (_name: string, text: string) => {
      expect(lineWork(text)).toEqual({
        characters: 0,
        maskedItems: 0,
        work: text.length,
        isDefinition: true,
      });
      // marked takes the line as a definition, and reads nothing inline.
      const tokens: TokensList = marked.lexer(text);

      expect([Object.keys(tokens.links).length, tokens.length]).toEqual([1, 0]);
    },
  );

  test.each([
    ["an address", "[d]: https://example.com/a", 5],
    ["an address and a title", '[d]: https://example.com/a "Shot"', 5],
    ["a title in single quotes", "[d]: /a 'Shot'", 5],
    ["a title in parentheses", "[d]: /a (Shot)", 5],
    ["an address in <>", "[d]: <https://example.com/a b> 'Shot'", 5],
    ["no space after the colon", "[d]:/a", 4],
    ["spaces before the address and after the title", '[d]:   /a "t"   ', 7],
    ["a label of words", "[Run log]: /a", 11],
  ])(
    "a definition marked takes whole: %s",
    (_name: string, text: string, addressStart: number) => {
      expect(getMarkedDefinitionAddressStart(text, 0, text.length)).toBe(
        addressStart,
      );
    },
  );

  test.each([
    ["words after the address", "[d]: /a b"],
    ["a tab before the title", '[d]: /a\t"t"'],
    ["a title that never closes", '[d]: /a "t'],
    ["words after the title", '[d]: /a "t" b'],
    ["a label of white space alone", "[ ]: /a"],
    ["no address on the line", "[d]:"],
    ["an address in <> that never closes", "[d]: <a b"],
    ["a parenthesis in a title in parentheses", "[d]: /a (t(t)"],
    ["no colon", "[d] /a"],
    ["a label with a code span", "[`d`]: /a"],
  ])(
    "a line marked does not take as a definition: %s",
    (_name: string, text: string) => {
      expect(getMarkedDefinitionAddressStart(text, 0, text.length)).toBe(-1);
    },
  );
});

describe("getMarkedLineWork - what costs marked nothing, and what costs it more", () => {
  test('a "&" and a "]" cost nothing; the other parsers look ahead from them', () => {
    const text: string = "&amp; &#38; &copy; a] b]";

    expect(lineWork(text)).toMatchObject({ characters: 0, maskedItems: 0 });
    expect(getInlineCharacterCount(text, 0, text.length)).toBe(5);
  });

  test('a "<...>" marked masks is one masked item; a tag is a look through', () => {
    expect(lineWork("< b >")).toMatchObject({
      characters: 0,
      maskedItems: 1,
    });
    expect(lineWork("<1> <2>").maskedItems).toBe(2);
    expect(lineWork("<b>")).toMatchObject({ characters: 1, maskedItems: 0 });
    expect(lineWork("a < b")).toMatchObject({ characters: 0, maskedItems: 0 });
    expect(lineWork("a > b")).toMatchObject({ characters: 0, maskedItems: 0 });
  });

  test("a < on one line and a > on a later line of the unit are one masked item", () => {
    const text: string = `${FILLER}${"a <\nb > c\n".repeat(100)}end`;
    const unitLength: number = text.length - FILLER.length + 1;
    const run: SlowMarkdownRun = measureSlowMarkdownRuns(text, {
      countAsMarked: true,
    })[1]!;
    let words: number = 0;

    for (const line of text.slice(FILLER.length).split("\n")) {
      words += getWordPunctuationWork(line, 0, line.length);
    }

    expect(run.inlineWork).toBe(
      Math.ceil((100 * unitLength) / MARKED_MASKED_ITEM_SHARE) + words,
    );
  });

  test.each([
    ["ASCII punctuation", "\\*", 1],
    ["a symbol", "\\€", 1],
    ["punctuation of another script", "\\«", 1],
    ["a symbol outside the first plane", "\\😀", 1],
    ["a letter, which it does not escape", "\\a", 0],
  ])(
    "an escape is one masked item: %s",
    (_name: string, text: string, maskedItems: number) => {
      expect(lineWork(text)).toMatchObject({
        characters: 0,
        maskedItems: maskedItems,
      });
    },
  );

  test("an escaped delimiter is no delimiter; one after an escaped backslash is", () => {
    expect(lineWork("\\*a*").characters).toBe(1);
    expect(lineWork("\\\\*a*")).toMatchObject({
      characters: 2,
      maskedItems: 1,
    });
  });

  test('a run before an "@" costs itself times itself and the domain after it', () => {
    const cases: Array<[string, number]> = [
      ["x aaaa@", 4 * 4],
      ["aaaa@bbb.cc", 4 * (4 + 6)],
      ["a.b+c-d@e", 7 * (7 + 1)],
      // Each "@" ends the run before the next.
      ["a@a@a@", 1 * 2 + 1 * 2 + 1 * 1],
      // An escaped "@" is no "@" an address can end at.
      ["aaaa\\@", 0],
      ["@mention", 0],
    ];

    for (const [text, runs] of cases) {
      expect([text, lineWork(text).work]).toEqual([
        text,
        getWordPunctuationWork(text, 0, text.length) + runs,
      ]);
    }
  });

  test('64 KB of letters before an "@" is past the limit; the other parsers count it linear', () => {
    const text: string = `x ${"a".repeat(64 * 1024)}@`;

    expect(lineWork(text).work).toBeGreaterThan(SLOW_MARKDOWN_MAX_INLINE_WORK);
    expect(getWordPunctuationWork(text, 0, text.length)).toBeLessThan(
      2 * text.length,
    );
  });
});

describe("measureSlowMarkdownRuns - a unit's references in their share", () => {
  test("1,000 references cost a sixteenth of a copy of their paragraph each", () => {
    const text: string = references(1000);
    const paragraph: string = text.slice(0, text.indexOf("\n\n"));
    const run: SlowMarkdownRun = measureSlowMarkdownRuns(text, {
      countAsMarked: true,
    })[0]!;
    let words: number = 0;

    for (const line of paragraph.split("\n")) {
      words += getWordPunctuationWork(line, 0, line.length);
    }

    expect(run.inlineWork).toBe(
      Math.ceil((1000 * (paragraph.length + 1)) / MARKED_MASKED_ITEM_SHARE) +
        words,
    );
    expect(run.inlineWork).toBeLessThan(SLOW_MARKDOWN_MAX_INLINE_WORK / 4);
  });

  test("a definition is read once as the first line of its unit, or after definitions", () => {
    const address: string = queryAddress(4096);

    // After a blank line, in a list item, in a quote, after definitions.
    for (const text of [
      `See [d].\n\n[d]: ${address}`,
      `- [d]: ${address}`,
      `> [d]: ${address}`,
      `1. [d]: ${address}`,
      `[a]: /a\n[b]: /b\n[d]: ${address}`,
    ]) {
      expect([text.slice(0, 12), markedWork(text) < 4 * text.length]).toEqual([
        text.slice(0, 12),
        true,
      ]);
      // marked takes it.
      expect(Object.keys(marked.lexer(text).links)).toContain("d");
    }
  });

  test("a definition after a paragraph's line is the paragraph's text to marked, and counted so", () => {
    // Read as a word, its punctuation times its length passes the limit.
    const address: string = queryAddress(8192);

    for (const text of [
      `See [d].\n[d]: ${address}`,
      `[a]: /a\nText\n[d]: ${address}`,
      `> See [d].\n> [d]: ${address}`,
    ]) {
      expect([
        text.slice(0, 12),
        markedWork(text) > SLOW_MARKDOWN_MAX_INLINE_WORK,
      ]).toEqual([text.slice(0, 12), true]);
      // marked reads no definition there.
      expect(Object.keys(marked.lexer(text).links)).not.toContain("d");
    }
  });
});

describe("holdBackSlowMarkdown - what the emails hold back", () => {
  test.each([
    ["270 references, one on each line", references(270)],
    ["280 references, one on each line", references(280)],
    ["1,000 references, one on each line", references(1000)],
    ["1,000 references on one line", references(1000, " ")],
    [
      "a link to 350 query pairs",
      `See [the dashboard](${queryAddress(3400)}) for the run.`,
    ],
    [
      "a link to 400 query pairs",
      `See [the dashboard](${queryAddress(3900)}) for the run.`,
    ],
    [
      "a link to a 4 KB query",
      `See [the dashboard](${queryAddress(4096)}) for the run.`,
    ],
    [
      "a link to a 32 KB query",
      `See [the dashboard](${queryAddress(32 * 1024)}) for the run.`,
    ],
    [
      "a link to a 32 KB query, with a title",
      `See [the dashboard](${queryAddress(32 * 1024)} "Checkout") for the run.`,
    ],
    [
      "a definition of a 4 KB query",
      `See [the dashboard][d] for the run.\n\n[d]: ${queryAddress(4096)}`,
    ],
    [
      "a definition of a 32 KB query",
      `See [the dashboard][d] for the run.\n\n[d]: ${queryAddress(32 * 1024)}`,
    ],
    ["entities", `${FILLER}${"Tom &amp; Jerry &copy; 2026 ".repeat(400)}`],
    ["bracketed words", `${FILLER}${"[INFO] served a] ".repeat(400)}`],
    [
      "1,000 runs' screenshots, each with a definition of its own",
      runScreenshots(1000),
    ],
    [
      "a block of 20,000 definitions",
      `See [the run][s1].\n\n${runScreenshots(20000).split("\n\n")[1]}`,
    ],
  ])(
    "no longer holds back what marked reads in good time: %s",
    (_name: string, text: string) => {
      expect(text.length).toBeGreaterThan(2048);
      expect(heldBack(text, EMAIL_LIMITS)).toEqual([]);
    },
  );

  test("the references and query links were held back before", () => {
    for (const text of [
      references(280),
      references(1000),
      `See [the dashboard](${queryAddress(3900)}) for the run.`,
      `See [the dashboard][d] for the run.\n\n[d]: ${queryAddress(7800)}`,
    ]) {
      expect(heldBack(text, EMAIL_LIMITS_BEFORE).length).toBeGreaterThan(0);
    }
  });

  test.each([
    ["unclosed brackets", "[".repeat(4096)],
    ["unclosed brackets with words", "[a ".repeat(1400)],
    ["emphasis that never closes", "*a ".repeat(1400)],
    ["code spans that never close", "`a".repeat(2048)],
    ["link openers", "[a](".repeat(1024)],
    ["image openers", "![a](".repeat(820)],
    ["links glued into one word", "[a](b)".repeat(700)],
    ["underscores in a word", "_a".repeat(2048)],
    ["a word of punctuation", "a!".repeat(2048)],
    ["letters before an @", `x ${"a".repeat(4096)}@`],
    ["a dotted run before an @", `x ${"a.".repeat(2048)}@`],
    ["references whose labels hold emphasis", "[*a*][s] ".repeat(600)],
    [
      "a definition read as a paragraph's text",
      `See [d].\n[d]: ${"a!".repeat(2048)}`,
    ],
    ["a bare address ending in dots", `http://x.com${".".repeat(4096)}`],
    ["2,500 references, one on each line", references(2500)],
    ["angle pairs", "< b > ".repeat(4000)],
    ["escaped symbols", "\\€ ".repeat(6000)],
  ])(
    "still holds back what marked reads slowly: %s",
    (_name: string, shape: string) => {
      const text: string = `${FILLER}${shape}`;
      const held: Array<string> = heldBack(text, EMAIL_LIMITS);

      expect(held.length).toBeGreaterThan(0);
      // The shape is what is held back, not the words before it.
      expect(held.join("").includes(shape.slice(0, 200))).toBe(true);
    },
  );

  test("the dashboard and Slack count as they did: references and query links are held back for them", () => {
    const remark: SlowMarkdownLimits = {
      ...EMAIL_LIMITS,
      countUrlLiterals: true,
      countWordUnderscores: true,
      countAsMarked: false,
    };

    expect(heldBack(references(1000), remark).length).toBeGreaterThan(0);
    expect(
      heldBack(
        `See [the dashboard](${queryAddress(32 * 1024)}) for the run.`,
        remark,
      ).length,
    ).toBeGreaterThan(0);
  });
});

/*
 * What the count reads once, marked must never read as inline Markdown: so
 * where it reads a link's end, marked's link ends there too, and where it
 * reads a definition, marked takes the line as one. Where the count says a
 * link or a definition does not close, marked may still read one: that only
 * makes the line look costlier.
 */
describe("the count reads links and definitions where marked does", () => {
  const TAIL_PIECES: ReadonlyArray<string> = [
    "a",
    "b",
    "x/y",
    "?q=1&r=2",
    " ",
    "  ",
    "\t",
    "(",
    ")",
    "((",
    "))",
    "<",
    ">",
    "\\",
    "\\)",
    "\\(",
    "\\>",
    '"',
    "'",
    '"t"',
    "'t'",
    "(t)",
    "!",
    "_",
    "*",
    "[",
    "]",
    "\u0001",
    " ",
    "　",
    "`",
    "@",
    "&amp;",
    "https://example.com/a_b",
  ];

  const LABEL_PIECES: ReadonlyArray<string> = [
    "a",
    "b c",
    "\\]",
    "\\[",
    "*a*",
    "!",
    "&",
    "@",
    " ",
    "€",
  ];

  const pieces: (
    random: SeededRandom,
    from: ReadonlyArray<string>,
    count: number,
  ) => string = (
    random: SeededRandom,
    from: ReadonlyArray<string>,
    count: number,
  ): string => {
    let text: string = "";

    for (let index: number = 0; index < count; index++) {
      text += from[random(from.length)];
    }

    return text;
  };

  test("a link's end, for 6,000 generated links", () => {
    const random: SeededRandom = seededRandom(7228);
    let marksLinks: number = 0;
    let readTheSame: number = 0;

    for (let index: number = 0; index < 6000; index++) {
      const text: string = `${random(2) === 0 ? "!" : ""}[${pieces(random, LABEL_PIECES, random(3))}](${pieces(random, TAIL_PIECES, 1 + random(7))} z`;
      const open: number = text.indexOf("[");
      const end: number = getMarkedLinkEnd(text, open, text.length);
      const first: Token | undefined = Lexer.lexInline(text)[0];
      const isLink: boolean =
        first !== undefined &&
        (first.type === "link" || first.type === "image");

      if (isLink) {
        marksLinks++;
      }

      if (end !== -1) {
        readTheSame++;
        // The text, so a failure says which.
        expect([text, isLink, isLink ? first!.raw.length : -1]).toEqual([
          text,
          true,
          end,
        ]);
      }
    }

    /*
     * Many links marked reads are read the same (910 of 1,897). The rest -
     * white space before an address a ")" ends, a "<" in "<...>", a title
     * that does not close - read as not closing, and only look costlier.
     */
    expect(marksLinks).toBeGreaterThan(1500);
    expect(readTheSame).toBeGreaterThan(marksLinks / 3);
  });

  test("a definition, for 6,000 generated lines", () => {
    const random: SeededRandom = seededRandom(7230);
    const labels: ReadonlyArray<string> = ["a", " ", "b c", "\\]", "`", "!"];
    const addresses: ReadonlyArray<string> = [
      "/a",
      "https://example.com/x?y=1&z=2",
      "<a b>",
      "<a",
      "<>",
      "a<b",
      "a>b",
      "\\",
      "!",
      "_",
    ];
    const titles: ReadonlyArray<string> = [
      '"t"',
      "'t'",
      "(t)",
      '"t',
      "'t\\'",
      "(t(",
      '"a\\"b"',
      "'a\\'b'",
      "(a\\)b)",
      "x",
      "",
    ];
    const gaps: ReadonlyArray<string> = ["", " ", "  ", "\t", " \t"];
    let taken: number = 0;
    let readTheSame: number = 0;

    for (let index: number = 0; index < 6000; index++) {
      const line: string = `[${pieces(random, labels, 1 + random(2))}]:${pieces(random, gaps, 1)}${pieces(random, addresses, 1 + random(2))}${pieces(random, gaps, 1)}${pieces(random, titles, 1)}${pieces(random, gaps, 1)}`;
      const addressStart: number = getMarkedDefinitionAddressStart(
        line,
        0,
        line.length,
      );
      const tokens: TokensList = marked.lexer(`${line}\n`);
      const isTaken: boolean =
        Object.keys(tokens.links).length === 1 &&
        !tokens.some((token: Token): boolean => {
          return token.type === "paragraph" || token.type === "code";
        });

      if (isTaken) {
        taken++;
      }

      if (addressStart !== -1) {
        readTheSame++;
        expect([line, isTaken]).toEqual([line, true]);
      }
    }

    expect(taken).toBeGreaterThan(500);
    expect(readTheSame).toBeGreaterThan(taken / 2);
  });
});
