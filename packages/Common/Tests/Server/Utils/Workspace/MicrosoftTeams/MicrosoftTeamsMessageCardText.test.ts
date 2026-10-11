import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { isDeepStrictEqual } from "util";
import {
  MessageCardFact,
  MessageCardLink,
  findFact,
  findMessageCardLinks,
  withLinksAsText,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageCardText";

/*
 * THE LINKS AND FACTS OF AN INCOMING WEBHOOK'S MESSAGE CARD.
 *
 * They were read with two regular expressions that looked from every "["
 * and "**" through the rest of the line: a line of "[[[" took 16 s on
 * 64 KB. findMessageCardLinks and findFact read the same in one pass; here
 * they are held to what the expressions read, on hand-written and generated
 * lines, and timed on lines that took the expressions seconds.
 */

const OLD_LINK_PATTERN: RegExp =
  /(?<!(?:^|[^\\])(?:\\\\)*\\)\[((?:[^\]\\]|\\.)+)\]\(([^)]+)\)/g;

const OLD_FACT_PATTERN: RegExp = /\*\*(.*?):\*\*\s*(.*)/;

function oldLinks(line: string): Array<MessageCardLink> {
  const pattern: RegExp = new RegExp(OLD_LINK_PATTERN);
  const links: Array<MessageCardLink> = [];

  for (
    let match: RegExpExecArray | null = pattern.exec(line);
    match !== null;
    match = pattern.exec(line)
  ) {
    links.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1]!,
      url: match[2]!,
    });
  }

  return links;
}

function oldFact(line: string): MessageCardFact | null {
  const match: RegExpExecArray | null = OLD_FACT_PATTERN.exec(line);

  return match ? { name: match[1]!, value: match[2]! } : null;
}

// A line of up to 15 pieces, drawn from the suites' seeded generator.
function randomLine(next: SeededRandom, pieces: ReadonlyArray<string>): string {
  const count: number = next(16);
  let line: string = "";

  for (let index: number = 0; index < count; index++) {
    line += pieces[next(pieces.length)];
  }

  return line;
}

describe("findMessageCardLinks", () => {
  test("finds a link's text and address, left to right", () => {
    expect(
      findMessageCardLinks("See [the incident](https://a.b/i/1) and [x](y)."),
    ).toEqual([
      { start: 4, end: 35, text: "the incident", url: "https://a.b/i/1" },
      { start: 40, end: 46, text: "x", url: "y" },
    ]);
  });

  test("an escaped bracket opens or ends nothing; an escaped backslash does not escape", () => {
    expect(findMessageCardLinks("\\[a](b)")).toEqual([]);
    expect(findMessageCardLinks("[a\\](b)")).toEqual([]);
    expect(findMessageCardLinks("\\\\[a](b)")).toEqual([
      { start: 2, end: 8, text: "a", url: "b" },
    ]);
    expect(findMessageCardLinks("[a \\] b](c)")).toEqual([
      { start: 0, end: 11, text: "a \\] b", url: "c" },
    ]);
  });

  test("an empty text or address is no link", () => {
    expect(findMessageCardLinks("[](b) [a]()")).toEqual([]);
  });

  test("withLinksAsText leaves each link's text in its place", () => {
    const line: string = "See [the incident](https://a.b/i/1) now, $& [x](y)";

    expect(withLinksAsText(line, findMessageCardLinks(line))).toBe(
      "See the incident now, $& x",
    );
  });

  test("reads what the old expression read, for 20000 lines", () => {
    const next: SeededRandom = seededRandom(4566);
    const PIECES: ReadonlyArray<string> = [
      "[",
      "]",
      "(",
      ")",
      "\\",
      "a",
      "b ",
      "](",
      "[a](b)",
      "\r",
      "\u2028",
      "!",
    ];
    let found: number = 0;
    const differences: Array<[string, Array<MessageCardLink>]> = [];

    for (let index: number = 0; index < 20000; index++) {
      const line: string = randomLine(next, PIECES);
      const expected: Array<MessageCardLink> = oldLinks(line);
      const read: Array<MessageCardLink> = findMessageCardLinks(line);

      found += expected.length;

      if (!isDeepStrictEqual(read, expected)) {
        differences.push([line, read]);
      }
    }

    // Gathered and checked once: an expect per line is most of the cost.
    expect(differences.slice(0, 5)).toEqual([]);
    expect(found).toBeGreaterThan(1000);
  });

  test("reads a line of 64 KB of brackets in good time", () => {
    for (const unit of ["[", "[a](", "\\[", "[a]("]) {
      const line: string = unit.repeat(Math.ceil(65536 / unit.length));
      const started: number = Date.now();

      findMessageCardLinks(line);

      expect([unit, Date.now() - started < 500]).toEqual([unit, true]);
    }
  });
});

describe("findFact", () => {
  test("reads a label and a value", () => {
    expect(findFact("**Severity:** High")).toEqual({
      name: "Severity",
      value: "High",
    });
    expect(findFact("Text **State:**   Down **Not:** a fact")).toEqual({
      name: "State",
      value: "Down **Not:** a fact",
    });
    expect(findFact("no fact here")).toBeNull();
  });

  test("reads what the old expression read, for 20000 lines", () => {
    const next: SeededRandom = seededRandom(4567);
    const PIECES: ReadonlyArray<string> = [
      "**",
      ":",
      ":**",
      "*",
      "a",
      " ",
      "\t",
      "\n",
      "\r",
      "\u2028",
      "\u00A0",
      "Label",
      "value",
    ];
    let found: number = 0;
    const differences: Array<[string, MessageCardFact | null]> = [];

    for (let index: number = 0; index < 20000; index++) {
      const line: string = randomLine(next, PIECES);
      const expected: MessageCardFact | null = oldFact(line);
      const read: MessageCardFact | null = findFact(line);

      if (expected) {
        found++;
      }

      if (!isDeepStrictEqual(read, expected)) {
        differences.push([line, read]);
      }
    }

    expect(differences.slice(0, 5)).toEqual([]);
    expect(found).toBeGreaterThan(1000);
  });

  test("reads a line of 64 KB of asterisks in good time", () => {
    for (const unit of ["*", "**a", "**:"]) {
      const line: string = unit.repeat(Math.ceil(65536 / unit.length));
      const started: number = Date.now();

      findFact(line);

      expect([unit, Date.now() - started < 500]).toEqual([unit, true]);
    }
  });
});
