import {
  OVER_LONG_GROUP_MIN_LENGTH,
  OVER_LONG_LINE_KEPT_LENGTH,
  OVER_LONG_LINE_LENGTH,
  OVER_LONG_RUN_LENGTH,
  cutToLength,
  hasOverLongLine,
  holdBackOverLongLines,
  holdBackOverLongRuns,
  holdBackOverLongText,
  isContinuationLine,
  mayHoldBack,
} from "../../../Utils/Markdown/OverLongText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * What is held back from a Markdown parser because it is too long for it
 * (Utils/Markdown/OverLongText): the middle of a line over 64 KB, and the
 * plain lines of a run of lines over 64 KB. Every consumer (the email
 * renderer, plain text, the dashboard's viewer) relies on three promises:
 *
 *   - nothing is held back from a text of at most 64 KB;
 *   - putting every token back gives the text exactly as it was written;
 *   - what stays in place keeps the text's structure - a line keeps its
 *     start and end, a run the lines that start or end something, and a
 *     token never starts a block, splits a word that the cut could avoid,
 *     or splits an emoji.
 */

// A hold function that keeps what it is given, by index.
interface Holder {
  held: Array<string>;
  hold: (text: string) => string;
  putBack: (text: string) => string;
}

function makeHolder(): Holder {
  const held: Array<string> = [];

  const putBack: (text: string) => string = (text: string): string => {
    return text.replace(
      /\uE005(\d+)\uE006/g,
      (_match: string, index: string) => {
        return held[Number(index)] ?? "";
      },
    );
  };

  return {
    held: held,
    hold: (text: string): string => {
      held.push(putBack(text));
      return `\uE005${held.length - 1}\uE006`;
    },
    putBack: putBack,
  };
}

const repeatTo: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("OverLongText - the limits", () => {
  test("a line, and a run, over 64 KB is over-long; the line keeps 1 KB at each end", () => {
    expect(OVER_LONG_LINE_LENGTH).toBe(65536);
    expect(OVER_LONG_RUN_LENGTH).toBe(65536);
    expect(OVER_LONG_LINE_KEPT_LENGTH).toBe(1024);
  });

  test("only a text over 64 KB can hold anything back", () => {
    expect(mayHoldBack("")).toBe(false);
    expect(mayHoldBack("a".repeat(65536))).toBe(false);
    expect(mayHoldBack("a".repeat(65537))).toBe(true);
    expect(mayHoldBack(42 as unknown as string)).toBe(false);
  });

  test("hasOverLongLine finds a line over 64 KB, and nothing else", () => {
    expect(hasOverLongLine("a".repeat(65536))).toBe(false);
    expect(hasOverLongLine(`${"a".repeat(65536)}\n${"b".repeat(65536)}`)).toBe(
      false,
    );
    expect(hasOverLongLine(`x\n${"a".repeat(65537)}\ny`)).toBe(true);
  });
});

describe("OverLongText - over-long lines", () => {
  test("a text of at most 64 KB comes back as it is, holding nothing", () => {
    const holder: Holder = makeHolder();
    const text: string = `# Title\n\n${"word ".repeat(13000)}`;

    expect(holdBackOverLongLines(text, holder.hold)).toBe(text);
    expect(holdBackOverLongText(text, holder.hold)).toBe(text);
    expect(holder.held).toEqual([]);
  });

  test("a long text of short lines holds no line back", () => {
    const holder: Holder = makeHolder();
    const text: string = repeatTo("short line\n", 200000);

    expect(holdBackOverLongLines(text, holder.hold)).toBe(text);
    expect(holder.held).toEqual([]);
  });

  test("an over-long line keeps its start and end, and the middle comes back as it was", () => {
    const holder: Holder = makeHolder();
    const line: string = `- HEAD ${"lorem ipsum ".repeat(8334)} TAIL`;
    const text: string = `Before\n${line}\nAfter`;

    const held: string = holdBackOverLongLines(text, holder.hold);

    expect(holder.held).toHaveLength(1);
    expect(held.startsWith("Before\n- HEAD lorem ipsum")).toBe(true);
    expect(held.endsWith("ipsum  TAIL\nAfter")).toBe(true);
    expect(held.length).toBeLessThan(2 * OVER_LONG_LINE_KEPT_LENGTH + 64);
    expect(holder.putBack(held) === text).toBe(true);
  });

  test("the cut is made right after a space near it, so no word is split", () => {
    const holder: Holder = makeHolder();
    const line: string = repeatTo("a_b c*d ", 100000);

    const held: string = holdBackOverLongLines(line, holder.hold);
    const token: number = held.indexOf("\uE005");

    expect(held.charAt(token - 1)).toBe(" ");
    expect(held.charAt(held.indexOf("\uE006") + 1)).toBe("a");
    expect(holder.held[0]!.endsWith(" ")).toBe(true);
    // The kept start is no shorter than 64 characters below 1 KB.
    expect(token).toBeGreaterThanOrEqual(OVER_LONG_LINE_KEPT_LENGTH - 64);
    expect(token).toBeLessThanOrEqual(OVER_LONG_LINE_KEPT_LENGTH);
    expect(holder.putBack(held) === line).toBe(true);
  });

  test("with no space near, the cut is exactly 1 KB from each end", () => {
    const holder: Holder = makeHolder();
    const line: string = repeatTo("abcdefgh", 100000);

    const held: string = holdBackOverLongLines(line, holder.hold);

    expect(held.indexOf("\uE005")).toBe(OVER_LONG_LINE_KEPT_LENGTH);
    expect(held.length - held.indexOf("\uE006") - 1).toBe(
      OVER_LONG_LINE_KEPT_LENGTH,
    );
    expect(holder.held[0]!.length).toBe(
      100000 - 2 * OVER_LONG_LINE_KEPT_LENGTH,
    );
  });

  test.each([
    ["the cut at the start falls inside an emoji", "a😀"],
    ["the cut at the end falls inside an emoji", "😀a"],
    ["every cut falls between emoji", "😀"],
  ])("an emoji is never split: %s", (_label: string, unit: string) => {
    const holder: Holder = makeHolder();
    const line: string = unit.repeat(Math.ceil(100000 / unit.length));

    const held: string = holdBackOverLongLines(line, holder.hold);
    const loneSurrogate: RegExp =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    expect(loneSurrogate.test(held)).toBe(false);
    expect(loneSurrogate.test(holder.held[0]!)).toBe(false);
    expect(holder.putBack(held) === line).toBe(true);
  });

  test("every over-long line is held back on its own; the lines between stay", () => {
    const holder: Holder = makeHolder();
    const first: string = repeatTo("x ", 70000);
    const second: string = repeatTo("y ", 70000);
    const text: string = `${first}\nshort\n${second}\n`;

    const held: string = holdBackOverLongLines(text, holder.hold);

    expect(holder.held).toHaveLength(2);
    expect(held.split("\n")[1]).toBe("short");
    expect(held.endsWith("\n")).toBe(true);
    expect(holder.putBack(held) === text).toBe(true);
  });

  test("a line break written as \\r\\n stays where it was", () => {
    const holder: Holder = makeHolder();
    const text: string = `${repeatTo("z ", 70000)}\r\nnext`;

    const held: string = holdBackOverLongLines(text, holder.hold);

    expect(held.endsWith("\r\nnext")).toBe(true);
    expect(holder.putBack(held) === text).toBe(true);
  });
});

/*
 * ISSUE #7229: A LINK ACROSS THE START OF A LINE'S MIDDLE.
 *
 * A link whose address is longer than the kept start, with a title that
 * takes its line over 64 KB, was held back in one piece from the address
 * to the title: the parser read one address with no space, no title and no
 * ")", and no link - an email showed "[Run](" and a link to the address and
 * the whole title, percent-encoded. Now the rest of the address and the
 * rest of the title are held back apart, and what parts them stays in view.
 */
describe("OverLongText - a link across the start of a line's middle (#7229)", () => {
  // The issue's title: 68 KB, so each of its rows is a line over 64 KB.
  const TITLE: string = "Checkout failed. ".repeat(4000);
  const ADDRESS: string = `https://example.com/${"a".repeat(2000)}`;
  const WORDS: string = repeatTo("lorem ipsum ", 70000).trim();

  // A token, in the text a parser reads.
  const TOKEN: RegExp = /\uE005\d+\uE006/;

  /*
   * Where a line is cut near `position` when no link goes on across it:
   * right after the last space in the 64 characters before it.
   */
  const cutAfterSpace: (line: string, position: number) => number = (
    line: string,
    position: number,
  ): number => {
    const space: number = line.lastIndexOf(" ", position - 1);

    return space >= position - 64 ? space + 1 : position;
  };

  interface HeldLine {
    // What the parser reads of the line, between the tokens.
    inView: Array<string>;
    // What each token stands for, in order.
    held: Array<string>;
  }

  // `line` held back, read apart - and always put back together exactly.
  const holdBackLine: (line: string) => HeldLine = (line: string): HeldLine => {
    const holder: Holder = makeHolder();
    const heldText: string = holdBackOverLongLines(line, holder.hold);

    expect(holder.putBack(heldText) === line).toBe(true);

    return { inView: heldText.split(TOKEN), held: holder.held };
  };

  test.each([
    ["a link", `[Run](${ADDRESS} "${TITLE}")`, " ", ' "', '")'],
    ["an image", `![Shot](${ADDRESS}.png "${TITLE}")`, " ", ' "', '")'],
    [
      "a link reference definition",
      `[s]: ${ADDRESS} "${TITLE}"`,
      " ",
      ' "',
      '"',
    ],
    ["a definition in a quote", `> [s]: ${ADDRESS} "${TITLE}"`, " ", ' "', '"'],
    [
      "a definition in a list item",
      `- [s]: ${ADDRESS} "${TITLE}"`,
      " ",
      ' "',
      '"',
    ],
    [
      "an address in angle brackets",
      `[Run](<${ADDRESS}> "${TITLE}")`,
      ">",
      '> "',
      '")',
    ],
    [
      "a title in single quotes",
      `[Run](${ADDRESS} '${TITLE}')`,
      " ",
      " '",
      "')",
    ],
    ["a title in parentheses", `[Run](${ADDRESS} (${TITLE}))`, " ", " (", "))"],
    [
      "a tab before the title",
      `[Run](${ADDRESS}\t"${TITLE}")`,
      "\t",
      '\t"',
      '")',
    ],
  ])(
    "%s: the rest of its address and of its title are held back apart, with what parts them in view",
    (
      _label: string,
      line: string,
      addressEnd: string,
      between: string,
      end: string,
    ) => {
      const heldLine: HeldLine = holdBackLine(line);
      const addressEndIndex: number = line.indexOf(
        addressEnd,
        OVER_LONG_LINE_KEPT_LENGTH,
      );
      const keptEnd: string = heldLine.inView[2]!;

      expect(line.length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
      // The kept start ends exactly 1 KB in: there is no space near.
      expect(heldLine.inView).toEqual([
        line.slice(0, OVER_LONG_LINE_KEPT_LENGTH),
        between,
        keptEnd,
      ]);
      expect(heldLine.held).toEqual([
        line.slice(OVER_LONG_LINE_KEPT_LENGTH, addressEndIndex),
        line.slice(
          addressEndIndex + between.length,
          line.length - keptEnd.length,
        ),
      ]);
      expect(TITLE.startsWith(heldLine.held[1]!)).toBe(true);
      expect(keptEnd.endsWith(end)).toBe(true);
      // The end is cut right after a space in the title, at most 64 before.
      expect(keptEnd.length).toBeGreaterThan(OVER_LONG_LINE_KEPT_LENGTH);
      expect(keptEnd.length).toBeLessThanOrEqual(
        OVER_LONG_LINE_KEPT_LENGTH + 64,
      );
      expect(keptEnd.startsWith("failed")).toBe(true);
    },
  );

  test("the issue's 500-character row: the address ends in the kept start, and the middle is one piece, as before", () => {
    const line: string = `[Run](https://example.com/${"a".repeat(500)} "${TITLE}")`;

    const heldLine: HeldLine = holdBackLine(line);
    // Both cuts are right after a space in the title, as they always were.
    const middleStart: number = cutAfterSpace(line, OVER_LONG_LINE_KEPT_LENGTH);
    const middleEnd: number = cutAfterSpace(
      line,
      line.length - OVER_LONG_LINE_KEPT_LENGTH,
    );

    expect(heldLine.inView).toEqual([
      line.slice(0, middleStart),
      line.slice(middleEnd),
    ]);
    expect(heldLine.held).toEqual([line.slice(middleStart, middleEnd)]);
  });

  test("an address of more than 64 KB with a title: its rest and the title are held back apart", () => {
    const longAddress: string = `https://example.com/${"a".repeat(70000)}`;
    const line: string = `[Run](${longAddress} "${TITLE}")`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView.slice(0, 2)).toEqual([
      line.slice(0, OVER_LONG_LINE_KEPT_LENGTH),
      ' "',
    ]);
    expect(heldLine.held[0]).toBe(
      longAddress.slice(OVER_LONG_LINE_KEPT_LENGTH - "[Run](".length),
    );
    expect(heldLine.held).toHaveLength(2);
  });

  test("an address of more than 64 KB with nothing after it is one piece, as before", () => {
    const line: string = `[Run](https://example.com/${"a".repeat(70000)})`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.held).toHaveLength(1);
    expect(heldLine.inView[1]!.endsWith("a)")).toBe(true);
  });

  test("a title that ends in the middle: its quote, the ')' and the space after stay in view, and the rest is held back", () => {
    const line: string = `[Run](${ADDRESS} "Checkout failed") and then ${WORDS}`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView.slice(0, 3)).toEqual([
      line.slice(0, OVER_LONG_LINE_KEPT_LENGTH),
      ' "',
      '") ',
    ]);
    expect(heldLine.held.slice(1, 2)).toEqual(["Checkout failed"]);
    expect(heldLine.held).toHaveLength(3);
    expect(heldLine.held[2]!.startsWith("and then lorem")).toBe(true);
  });

  test("a link that ends in the middle: its ')' and what follows up to a space stay in view", () => {
    const line: string = `[Run](${ADDRESS}), then ${WORDS}`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView.slice(0, 2)).toEqual([
      line.slice(0, OVER_LONG_LINE_KEPT_LENGTH),
      "), ",
    ]);
    expect(heldLine.held[0]).toBe(
      ADDRESS.slice(OVER_LONG_LINE_KEPT_LENGTH - "[Run](".length),
    );
    expect(heldLine.held[1]!.startsWith("then lorem")).toBe(true);
  });

  test("a title the cut is inside of that ends in the middle: the rest of the title is one piece, and what follows another", () => {
    const line: string = `[Run](https://example.com/x "${"Checkout failed. ".repeat(200)}") then ${WORDS}`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView[0]!.endsWith("Checkout ")).toBe(true);
    expect(heldLine.inView[1]).toBe('") ');
    expect(heldLine.held[0]!.endsWith("Checkout failed. ")).toBe(true);
    expect(heldLine.held[1]!.startsWith("then lorem")).toBe(true);
  });

  test.each([
    [
      "balanced parentheses in the middle",
      `[Run](${ADDRESS}_(v2) "${TITLE}")`,
      `${"a".repeat(1000 + "[Run](https://example.com/".length - (OVER_LONG_LINE_KEPT_LENGTH - 1000))}_(v2)`,
    ],
    [
      "a '(' in the kept start that a ')' in the middle closes",
      `[Run](https://example.com/(${"a".repeat(2000)})x "${TITLE}")`,
      `${"a".repeat(2000 + "[Run](https://example.com/(".length - OVER_LONG_LINE_KEPT_LENGTH)})x`,
    ],
    [
      "an escaped ')'",
      `[Run](${ADDRESS}\\)x "${TITLE}")`,
      `${"a".repeat(2000 + "[Run](https://example.com/".length - OVER_LONG_LINE_KEPT_LENGTH)}\\)x`,
    ],
  ])(
    "an address with %s ends at the white space, not at a ')'",
    (_label: string, line: string, addressRest: string) => {
      const heldLine: HeldLine = holdBackLine(line);

      expect(heldLine.held[0]).toBe(addressRest);
      expect(heldLine.inView[1]).toBe(' "');
    },
  );

  test("a ')' that closes more parentheses than the address opened ends it, and the link", () => {
    const line: string = `[Run](${ADDRESS})) ${WORDS}`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView[1]).toBe(")) ");
  });

  test("a bare address the cut is inside of is held back to its end, and the '.' after it stays in view", () => {
    const line: string = `See ${ADDRESS}. Then ${WORDS}`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView.slice(0, 2)).toEqual([
      line.slice(0, OVER_LONG_LINE_KEPT_LENGTH),
      ". ",
    ]);
    expect(heldLine.held[0]).toBe(
      ADDRESS.slice(OVER_LONG_LINE_KEPT_LENGTH - "See ".length),
    );
    expect(heldLine.held[1]!.startsWith("Then lorem")).toBe(true);
  });

  test("an autolink the cut is inside of keeps its '>'", () => {
    const line: string = `See <${ADDRESS}> and ${WORDS}`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView.slice(0, 2)).toEqual([
      line.slice(0, OVER_LONG_LINE_KEPT_LENGTH),
      "> ",
    ]);
    expect(heldLine.held[1]!.startsWith("and lorem")).toBe(true);
  });

  test("a word the cut is inside of that runs over the whole middle is one piece, as before", () => {
    const line: string = `See ${"a".repeat(70000)} then`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.held).toHaveLength(1);
  });

  test("white space too long to keep between the address and the title: 64 characters of it stay, and the rest is held back with the title", () => {
    const line: string = `[Run](${ADDRESS}${" ".repeat(100)}"${TITLE}")`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView[1]).toBe(" ".repeat(64));
    expect(heldLine.held[1]!.startsWith(`${" ".repeat(36)}"Checkout`)).toBe(
      true,
    );
  });

  test("a '](' the cut parts keeps its '(' in view", () => {
    // "]" is the kept start's last character, "(" the middle's first.
    const line: string = `${"x".repeat(OVER_LONG_LINE_KEPT_LENGTH - 5)}[Run](${ADDRESS} "${TITLE}")`;

    expect(line.charAt(OVER_LONG_LINE_KEPT_LENGTH - 1)).toBe("]");

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView[0]!.endsWith("[Run](")).toBe(true);
    expect(heldLine.held[0]).toBe(ADDRESS);
    expect(heldLine.inView[1]).toBe(' "');
  });

  test("a character a backslash in the kept start escapes stays in view, escaped", () => {
    const start: string = '[Run](https://example.com/x "';
    // The backslash is the kept start's last character, the quote the middle's first.
    const line: string = `${start}${"b".repeat(OVER_LONG_LINE_KEPT_LENGTH - start.length - 1)}\\"${"b".repeat(2000)}") then ${WORDS}`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView[0]!.endsWith('b\\"')).toBe(true);
    expect(heldLine.held[0]).toBe("b".repeat(2000));
    expect(heldLine.inView[1]).toBe('") ');
  });

  // An emoji: one character, two halves of a surrogate pair.
  const EMOJI: string = String.fromCodePoint(0x1f600);

  // Whether `text` holds one half of a surrogate pair without the other.
  const hasLoneSurrogate: (text: string) => boolean = (
    text: string,
  ): boolean => {
    for (let index: number = 0; index < text.length; index++) {
      const code: number = text.charCodeAt(index);

      if (code >= 0xdc00 && code <= 0xdfff) {
        return true;
      }

      if (code >= 0xd800 && code <= 0xdbff) {
        const next: number = text.charCodeAt(index + 1);

        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          return true;
        }

        index++;
      }
    }

    return false;
  };

  test.each([
    [
      "a title",
      '[Run](https://example.com/x "',
      `") then ${WORDS}`,
      "b".repeat(2000),
    ],
    [
      "an address",
      "[Run](https://example.com/",
      ` "${TITLE}")`,
      "b".repeat(2000),
    ],
    [
      "an address in angle brackets",
      "[Run](<https://example.com/",
      `> "${TITLE}")`,
      "b".repeat(2000),
    ],
  ])(
    "an emoji a backslash in the kept start escapes, in %s, stays whole and in view: no piece starts or ends between its halves",
    (_label: string, start: string, end: string, heldFirst: string) => {
      // The backslash is the kept start's last character, the emoji the middle's first.
      const line: string = `${start}${"b".repeat(OVER_LONG_LINE_KEPT_LENGTH - start.length - 1)}\\${EMOJI}${"b".repeat(2000)}${end}`;

      expect(line.charAt(OVER_LONG_LINE_KEPT_LENGTH - 1)).toBe("\\");

      const heldLine: HeldLine = holdBackLine(line);

      expect(heldLine.inView[0]!.endsWith(`b\\${EMOJI}`)).toBe(true);
      expect(heldLine.held[0]).toBe(heldFirst);
      expect(heldLine.inView.filter(hasLoneSurrogate)).toEqual([]);
      expect(heldLine.held.filter(hasLoneSurrogate)).toEqual([]);
    },
  );

  test("lines of links, escapes and emoji, drawn at random, never part an emoji between what is in view and what is held back", () => {
    const random: SeededRandom = seededRandom(72290);
    const fragments: Array<string> = [
      "[Run](",
      "[Run](<",
      "[s]: ",
      ">",
      " ",
      '"',
      "'",
      "(",
      ")",
      "\\",
      `\\${EMOJI}`,
      EMOJI,
      "word",
      "a".repeat(300),
    ];
    let parted: number = 0;

    for (let attempt: number = 0; attempt < 300; attempt++) {
      let line: string = "";

      while (line.length < OVER_LONG_LINE_LENGTH + 200) {
        line += fragments[random(fragments.length)]!;
      }

      const heldLine: HeldLine = holdBackLine(line);

      if (
        heldLine.inView.some(hasLoneSurrogate) ||
        heldLine.held.some(hasLoneSurrogate)
      ) {
        parted++;
      }
    }

    expect(parted).toBe(0);
  });

  test("what the kept start shows of a link in a code span or after a backslash is read as written", () => {
    // "\](" opens nothing: the cut is inside a word, held back to its end.
    const escaped: HeldLine = holdBackLine(`[Run\\](${ADDRESS} "${TITLE}")`);

    expect(escaped.inView[1]).toBe(" ");
    expect(escaped.held[1]!.startsWith('"Checkout')).toBe(true);
  });

  test("lines of every shape, drawn at random, are always put back exactly, with few pieces in view", () => {
    const random: SeededRandom = seededRandom(7229);
    const fragments: Array<string> = [
      "[Run](",
      "![Shot](",
      "](",
      "[s]: ",
      "> ",
      "- ",
      "<https:",
      "<",
      ">",
      " ",
      "  ",
      "\t",
      '"',
      "'",
      "(",
      ")",
      "\\",
      "word",
      ".",
      "a".repeat(300),
      "Checkout failed. ",
    ];

    for (let attempt: number = 0; attempt < 300; attempt++) {
      let line: string = "";

      while (line.length < OVER_LONG_LINE_LENGTH + 200) {
        line += fragments[random(fragments.length)]!;
      }

      const heldLine: HeldLine = holdBackLine(line);
      const inViewLength: number = heldLine.inView.join("").length;

      /*
       * At most an address and a title for a link across the middle's
       * start; then what follows it, up to a link across the middle's end,
       * and that link's text, address, title and white space too long to
       * keep: seven pieces. In view, besides both kept ends: what parts
       * them, at most 64 characters a run, and a link's text of at most
       * 1 KB.
       */
      expect(heldLine.held.length).toBeLessThanOrEqual(7);
      expect(inViewLength).toBeLessThanOrEqual(
        3 * OVER_LONG_LINE_KEPT_LENGTH + 8 * 64,
      );
    }
  });

  test("a megabyte line of such links is held back in time in line with its length: the first and the last keep their parts in view", () => {
    const link: string = `[Run](${ADDRESS} "Checkout failed: the payment step timed out") `;
    const line: string = repeatTo(link, 1024 * 1024);
    let heldLine: HeldLine | null = null;

    const run: FastestRun<HeldLine> = fastestRun({
      run: (): HeldLine => {
        heldLine = holdBackLine(line);

        return heldLine;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    /*
     * The first link's address and title, the links between, and the
     * part of the last link's address the middle holds: the last one's
     * address runs on into the kept end, so its "[Run](" stays in view.
     */
    expect(heldLine!.held).toHaveLength(4);
    expect(heldLine!.inView.slice(1, 4)).toEqual([' "', '") ', "[Run]("]);
  });

  test.each([
    ["a line of '](' ", repeatTo("](", 1024 * 1024)],
    ["a line of '[a](b \"' ", repeatTo('[a](b "', 1024 * 1024)],
    ["a line of backslashes", repeatTo("\\", 1024 * 1024)],
    ["a line of '<a:' ", repeatTo("<ab:", 1024 * 1024)],
    ["a title that never ends", `[a](b "${repeatTo("c", 1024 * 1024)}`],
    ["a line of '['", repeatTo("[", 1024 * 1024)],
    ["a line of '![a](' ", repeatTo("![a](", 1024 * 1024)],
    ["a line of '[a] ' ", repeatTo("[a] ", 1024 * 1024)],
    ["a line of '!' ", repeatTo("!", 1024 * 1024)],
  ])(
    "%s is read once: held back in time in line with its length",
    (_label: string, line: string) => {
      const run: FastestRun<HeldLine> = fastestRun({
        run: (): HeldLine => {
          return holdBackLine(line);
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    },
  );
});

/*
 * The other end of the middle: a link or an image that starts in the
 * middle and goes on into the line's kept end - a long address at the end
 * of a long log line. Held back in one piece with the rest of the middle,
 * its "[text](" went into the token and the parser read what the kept end
 * holds of the address as text: an email showed "[Run](https://..." as
 * text. Now its "[" and "](" stay in view, its address is held back apart.
 */
describe("OverLongText - a link across the end of a line's middle (#7229)", () => {
  const ADDRESS: string = `https://example.com/${"a".repeat(2000)}`;
  const WORDS: string = repeatTo("lorem ipsum ", 70000).trim();
  const TOKEN: RegExp = /\uE005\d+\uE006/;

  interface HeldLine {
    // What the parser reads of the line, between the tokens.
    inView: Array<string>;
    // What each token stands for, in order.
    held: Array<string>;
  }

  // `line` held back, read apart - and always put back together exactly.
  const holdBackLine: (line: string) => HeldLine = (line: string): HeldLine => {
    const holder: Holder = makeHolder();
    const heldText: string = holdBackOverLongLines(line, holder.hold);

    expect(holder.putBack(heldText) === line).toBe(true);

    return { inView: heldText.split(TOKEN), held: holder.held };
  };

  // Where the kept start ends: right after a space of the words.
  const middleStartOf: (line: string) => number = (line: string): number => {
    return line.lastIndexOf(" ", OVER_LONG_LINE_KEPT_LENGTH - 1) + 1;
  };

  test.each([
    ["a link", `[Run](${ADDRESS}) now`, "[Run]("],
    ["a link with a title", `[Run](${ADDRESS} "Checkout failed")`, "[Run]("],
    ["an image", `![Shot](${ADDRESS}.png) now`, "![Shot]("],
    [
      "an image with a title",
      `![Shot](${ADDRESS}.png "Home page")`,
      "![Shot](",
    ],
    ["an address in angle brackets", `[Run](<${ADDRESS}> "t")`, "[Run](<"],
    ["a text with emphasis", `[**Run 42**](${ADDRESS}) now`, "[**Run 42**]("],
    ["a text with brackets in it", `[a [b] c](${ADDRESS}) now`, "[a [b] c]("],
    ["an autolink", `<${ADDRESS}> now`, "<https:"],
  ])(
    "%s whose address runs into the kept end keeps its opening in view, and what the middle holds of its address is held back alone",
    (_label: string, link: string, opening: string) => {
      const line: string = `${WORDS} see ${link}`;
      const heldLine: HeldLine = holdBackLine(line);
      const linkAt: number = line.lastIndexOf(" see ") + " see ".length;
      // No space near the end's cut: it is exactly 1 KB before the end.
      const middleEnd: number = line.length - OVER_LONG_LINE_KEPT_LENGTH;
      const middleStart: number = middleStartOf(line);

      expect(line.length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
      expect(heldLine.inView).toEqual([
        line.slice(0, middleStart),
        opening,
        line.slice(middleEnd),
      ]);
      expect(heldLine.held).toEqual([
        line.slice(middleStart, linkAt),
        line.slice(linkAt + opening.length, middleEnd),
      ]);
    },
  );

  test("a link's text over 1 KB is held back between its '[' and its '](', which stay in view", () => {
    const text: string = "run ".repeat(300);
    const line: string = `${WORDS} see [${text}](${ADDRESS}) now`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView.slice(1, 3)).toEqual(["[", "]("]);
    expect(heldLine.held[1]).toBe(text);
    expect(heldLine.held[2]!.startsWith("https://example.com/aaa")).toBe(true);
  });

  test("a title the middle ends inside of: the address and the rest of the title the middle holds are held back apart", () => {
    const title: string = "Checkout failed. ".repeat(100);
    const line: string = `${WORDS} see [Run](https://example.com/x "${title}") now`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView.slice(1, 3)).toEqual(["[Run](", ' "']);
    expect(heldLine.held[1]).toBe("https://example.com/x");
    expect(title.startsWith(heldLine.held[2]!)).toBe(true);

    // The end is cut right after a space in the title, as it always was.
    const cut: number = line.length - OVER_LONG_LINE_KEPT_LENGTH;
    const middleEnd: number = line.lastIndexOf(" ", cut - 1) + 1;

    expect(cut - middleEnd).toBeLessThanOrEqual(64);
    expect(heldLine.inView[3]).toBe(line.slice(middleEnd));
  });

  test("a link across each end of the middle keeps both in view", () => {
    const line: string = `[Run](${ADDRESS} "Checkout failed") ${WORDS} see [Again](${ADDRESS}) now`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView.slice(1, 4)).toEqual([' "', '") ', "[Again]("]);
    expect(heldLine.held[1]).toBe("Checkout failed");
    expect(heldLine.held).toHaveLength(4);
  });

  test.each([
    ["a '](' that no '[' opened", `${WORDS} see x](${ADDRESS}) now`],
    ["an escaped '['", `${WORDS} see \\[Run](${ADDRESS}) now`],
    [
      "a label opened deeper than MAX_OPEN_LABELS",
      `${WORDS} see ${"[".repeat(1100)}Run](${ADDRESS}) now`,
    ],
    [
      "a link that ends in the middle",
      `${WORDS} see [Run](https://example.com/x) ${"a".repeat(1100)}`,
    ],
    ["a bare address", `${WORDS} see ${ADDRESS} now`],
  ])(
    "%s: the middle is one piece, as before",
    (_label: string, line: string) => {
      const heldLine: HeldLine = holdBackLine(line);

      expect(heldLine.held).toHaveLength(1);
      expect(heldLine.inView).toHaveLength(2);
    },
  );

  test("after white space too long to keep before a title, nothing in that title is read as a link across the end", () => {
    // 64 spaces and the title's quote: one character more than is kept.
    const line: string = `[Run](${ADDRESS}${" ".repeat(64)}"${WORDS} see [Again](${ADDRESS}) now")`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView[1]).toBe(" ".repeat(64));
    expect(heldLine.held).toHaveLength(2);
    expect(heldLine.held[1]!.startsWith(`"${WORDS.slice(0, 20)}`)).toBe(true);
  });

  test("after white space too long to keep before a link's ')', a link across the end still keeps its opening in view", () => {
    // 64 spaces and the ")": one character more than is kept.
    const line: string = `[Run](${ADDRESS}${" ".repeat(64)}) ${WORDS} see [Again](${ADDRESS}) now`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView.slice(1, 3)).toEqual([" ".repeat(64), "[Again]("]);
    expect(heldLine.held).toHaveLength(3);
    expect(heldLine.held[1]!.startsWith(`) ${WORDS.slice(0, 20)}`)).toBe(true);
    expect(heldLine.held[1]!.endsWith(" see ")).toBe(true);
  });

  test("an escaped '!' before the '[' opens a link, not an image: the '!' stays in the middle's piece", () => {
    const line: string = `${WORDS} see \\![Run](${ADDRESS}) now`;

    const heldLine: HeldLine = holdBackLine(line);

    expect(heldLine.inView[1]).toBe("[Run](");
    expect(heldLine.held[0]!.endsWith("see \\!")).toBe(true);
  });

  test("lines of links near their end, drawn at random, are always put back exactly, and a link that runs into the kept end keeps its '](' in view", () => {
    const random: SeededRandom = seededRandom(72291);
    const fragments: Array<string> = [
      "[Run](",
      "![Shot](",
      "[",
      "]",
      "](",
      "<https:",
      "<",
      ">",
      " ",
      '"',
      "(",
      ")",
      "\\",
      "!",
      "word",
      "a".repeat(300),
    ];
    let linksInView: number = 0;

    for (let attempt: number = 0; attempt < 300; attempt++) {
      let line: string = `${WORDS} `;

      while (line.length < WORDS.length + 3 * OVER_LONG_LINE_KEPT_LENGTH) {
        line += fragments[random(fragments.length)]!;
      }

      const heldLine: HeldLine = holdBackLine(line);

      // The words up to the link, its text, address and title, and white space too long to keep.
      expect(heldLine.held.length).toBeLessThanOrEqual(5);

      if (
        heldLine.inView.some((piece: string): boolean => {
          return piece.endsWith("](");
        })
      ) {
        linksInView++;
      }
    }

    // The fragments make such links often enough to be read.
    expect(linksInView).toBeGreaterThan(30);
  });
});

describe("OverLongText - which lines only continue the block they are in", () => {
  const isContinuation: (line: string) => boolean = (line: string): boolean => {
    return isContinuationLine(line, 0, line.length);
  };

  test.each([
    "plain text",
    "  indented text",
    "\tindented with a tab",
    '    "id": 1,',
    "2026-10-08T10:00:00Z INFO request served in 12 ms",
    "10 kittens",
    "a - b + c * d _ e = f ~ g # h [i] ! j",
    "word]",
    "{",
    "},",
    "plain text\r",
  ])("continues: %j", (line: string) => {
    expect(isContinuation(line)).toBe(true);
  });

  test.each([
    ["blank", ""],
    ["spaces only", "   "],
    ["a heading", "# Title"],
    ["a quote", "> quoted"],
    ["a bullet", "- item"],
    ["a plus bullet", "+ item"],
    ["a star bullet or rule", "* item"],
    ["an underscore rule", "___"],
    ["a setext underline", "==="],
    ["a numbered item", "1. item"],
    ["a numbered item with a parenthesis", "12) item"],
    ["a fence", "```json"],
    ["a tilde fence", "~~~"],
    ["a table row", "| a | b |"],
    ["a table row without its outer pipes", "a | b"],
    ["HTML", "<div>"],
    ["the end of an HTML comment", "the end -->"],
    ["a link reference definition", "[label]: https://example.com"],
    ["an image", "see ![shot](https://example.com/a.png)"],
    ["code", "run `make` first"],
    ["a hard line break of two spaces", "line  "],
    ["a hard line break of a backslash", "line\\"],
  ])("does not continue: %s", (_label: string, line: string) => {
    expect(isContinuation(line)).toBe(false);
  });
});

describe("OverLongText - over-long runs of lines", () => {
  const LOG_LINE: string =
    "2026-10-08T10:00:00Z INFO request served in 12 ms for web-01";

  test("a run of at most 64 KB comes back as it is", () => {
    const holder: Holder = makeHolder();
    const run: string = repeatTo(`${LOG_LINE}\n`, 60000);
    const text: string = `${run}\n\n${run}`;

    expect(text.length).toBeGreaterThan(OVER_LONG_RUN_LENGTH);
    expect(holdBackOverLongRuns(text, holder.hold)).toBe(text);
    expect(holder.held).toEqual([]);
  });

  test("an over-long paragraph of plain lines becomes one line, and comes back as it was", () => {
    const holder: Holder = makeHolder();
    const lines: string = Array.from({ length: 3000 }, () => {
      return LOG_LINE;
    }).join("\n");
    const text: string = `Before\n\n${lines}\n\nAfter`;

    const held: string = holdBackOverLongRuns(text, holder.hold);

    expect(held).toBe("Before\n\n\uE0050\uE006\n\nAfter");
    expect(holder.held).toEqual([lines]);
  });

  test("lines that start or end something stay in place, and split the groups", () => {
    const holder: Holder = makeHolder();
    const plain: string = Array.from({ length: 600 }, () => {
      return LOG_LINE;
    }).join("\n");
    const text: string = [
      "- first item",
      plain,
      "- second item",
      plain,
      "```",
      plain,
      "```",
      "| a | b |",
      plain,
    ].join("\n");

    const held: string = holdBackOverLongRuns(text, holder.hold);

    expect(held.split("\n")).toEqual([
      "- first item",
      "\uE0050\uE006",
      "- second item",
      "\uE0051\uE006",
      "```",
      "\uE0052\uE006",
      "```",
      "| a | b |",
      "\uE0053\uE006",
    ]);
    expect(holder.putBack(held) === text).toBe(true);
  });

  test("a group in a quote keeps the quote markers on its line, and holds back its lines without them", () => {
    const holder: Holder = makeHolder();
    const quoted: Array<string> = Array.from({ length: 1200 }, () => {
      return `> ${LOG_LINE}`;
    });
    const nested: Array<string> = Array.from({ length: 1200 }, () => {
      return `> > ${LOG_LINE}`;
    });
    const text: string = [...quoted, ...nested, LOG_LINE].join("\n");

    const held: string = holdBackOverLongRuns(text, holder.hold);

    expect(held.split("\n")).toEqual([
      "> \uE0050\uE006",
      "> > \uE0051\uE006",
      /*
       * A lazy line, in no quote of its own, is a group of its own - too
       * short to be worth holding back.
       */
      LOG_LINE,
    ]);
    expect(holder.held[0]).toBe(
      Array.from({ length: 1200 }, () => {
        return LOG_LINE;
      }).join("\n"),
    );
    expect(holder.held[1]).toBe(holder.held[0]);
    expect(holder.held).toHaveLength(2);
  });

  test("a group shorter than OVER_LONG_GROUP_MIN_LENGTH stays, Markdown and all; a longer one is held back", () => {
    const holder: Holder = makeHolder();
    const rows: string = Array.from({ length: 4000 }, () => {
      return "| web-01 | down |";
    }).join("\n");
    const shortGroup: string = "a **short** line between rows";
    const longGroup: Array<string> = Array.from(
      { length: Math.ceil(OVER_LONG_GROUP_MIN_LENGTH / LOG_LINE.length) },
      () => {
        return LOG_LINE;
      },
    );

    expect(rows.length).toBeGreaterThan(OVER_LONG_RUN_LENGTH);
    expect(longGroup.join("\n").length).toBeGreaterThanOrEqual(
      OVER_LONG_GROUP_MIN_LENGTH,
    );

    const held: string = holdBackOverLongRuns(
      [rows, shortGroup, rows, ...longGroup, rows].join("\n"),
      holder.hold,
    );

    expect(held).toBe(
      [rows, shortGroup, rows, "\uE0050\uE006", rows].join("\n"),
    );
    expect(holder.held).toEqual([longGroup.join("\n")]);
  });

  test("a group's line is indented as its first line was", () => {
    const holder: Holder = makeHolder();
    const lines: string = Array.from(
      { length: 4000 },
      (_: unknown, index: number) => {
        return `${index % 2 === 0 ? "    " : "  "}"key-${index}": "value",`;
      },
    ).join("\n");

    expect(lines.length).toBeGreaterThan(OVER_LONG_RUN_LENGTH);

    const held: string = holdBackOverLongRuns(`{\n${lines}\n}`, holder.hold);

    expect(held).toBe("\uE0050\uE006");
    expect(holder.held[0]!.startsWith('{\n    "key-0"')).toBe(true);

    // A run that starts indented - indented code - stays indented code.
    const indented: Holder = makeHolder();
    const run: string = `    ${lines.trimStart()}`;
    const heldRun: string = holdBackOverLongRuns(run, indented.hold);

    expect(heldRun).toBe("    \uE0050\uE006");
    expect(indented.putBack(heldRun) === run).toBe(true);
  });

  test("holdBackOverLongText holds back an over-long line's middle first, then the run it is in", () => {
    const holder: Holder = makeHolder();
    const longLine: string = repeatTo("lorem ipsum ", 100000);
    const lines: string = Array.from({ length: 1500 }, () => {
      return LOG_LINE;
    }).join("\n");
    const text: string = `${lines}\n${longLine}\n${lines}`;

    const held: string = holdBackOverLongText(text, holder.hold);

    // The whole run is one group: the long line, cut, is plain too.
    expect(held).toBe(`\uE005${holder.held.length - 1}\uE006`);
    expect(holder.putBack(held) === text).toBe(true);
  });
});

describe("OverLongText - cutToLength", () => {
  test("text that fits comes back as it is", () => {
    expect(cutToLength("abc\ndef", 7)).toBe("abc\ndef");
    expect(cutToLength("", 0)).toBe("");
  });

  test("a cut is made at the last line break in the second half of what fits", () => {
    expect(cutToLength("aaaa\nbbbb\ncccc", 12)).toBe("aaaa\nbbbb");
  });

  test("with no line break in the second half, the cut is made where the text stops fitting", () => {
    expect(cutToLength("a\nbbbbbbbbbbbbbbbbbbbbbbbb", 10)).toBe("a\nbbbbbbbb");
    expect(cutToLength("x".repeat(20), 8)).toBe("x".repeat(8));
  });

  test("an emoji at the cut is left out whole, never split", () => {
    expect(cutToLength("abc😀def", 4)).toBe("abc");
    expect(cutToLength("abc😀def", 5)).toBe("abc😀");
  });
});
