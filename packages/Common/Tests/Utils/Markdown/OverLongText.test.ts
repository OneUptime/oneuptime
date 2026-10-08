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
