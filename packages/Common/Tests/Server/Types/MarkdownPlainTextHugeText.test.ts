import { describe, expect, test } from "@jest/globals";
import Markdown from "../../../Server/Types/Markdown";

/*
 * PLAIN TEXT OF ANY LENGTH: convertToPlainText, for SMS, calls, push
 * notifications, email subjects and preheaders.
 *
 * convertToPlainText runs regular expressions over the Markdown, and a
 * quantifier that took a few million characters in one match - a long URL,
 * a run of spaces, a minified JSON body (its "[" opening a link that never
 * closes), an unclosed tag - ran out of V8's backtracking stack once a
 * process compiled regular expressions unoptimized. Now the middle of every
 * line over 64 KB is held back first, as literal text, a quantifier that
 * can cross lines takes at most 65536 characters, and sentinels and
 * whitespace are collapsed with loops. HugeTextInLongRunningProcess.test.ts
 * runs sixteen megabytes where the old code ran out of stack; this file
 * pins what comes out.
 */

const MIB: number = 1024 * 1024;

const repeatTo: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("Markdown.convertToPlainText - text over 64 KB", () => {
  test.each([
    ["a line of JSON", `HEAD {"items":[${repeatTo('{"id":1},', 16 * MIB)}]} TAIL`],
    ["a long address", `HEAD https://example.com/${"a".repeat(16 * MIB)} TAIL`],
    ["a run of spaces", `HEAD ${" ".repeat(16 * MIB)} TAIL`],
    ["an unclosed tag", `HEAD <${"a".repeat(16 * MIB)} TAIL`],
    ["a run of underscores", `HEAD ${"_".repeat(16 * MIB)} TAIL`],
    ["a run of backticks", `HEAD ${"`".repeat(16 * MIB)} TAIL`],
    ["a run of sentinel characters", `HEAD ${"\uE000".repeat(16 * MIB)} TAIL`],
  ])(
    "sixteen megabytes on one line come through: %s",
    (_label: string, line: string) => {
      const text: string = Markdown.convertToPlainText(
        `Before\n\n${line}\n\nAfter`,
      );

      expect(text.startsWith("Before\nHEAD")).toBe(true);
      expect(text.endsWith("TAIL\nAfter")).toBe(true);
    },
  );

  test("sixteen megabytes of lines come through, each line kept", () => {
    const lines: string = repeatTo(
      "2026-10-08T10:00:00Z INFO **request** served in 12 ms\n",
      16 * MIB,
    );
    const text: string = Markdown.convertToPlainText(
      `Before\n\n${lines.slice(0, lines.lastIndexOf("\n"))}\n\nAfter`,
    );

    expect(text.startsWith("Before\n2026-10-08T10:00:00Z INFO request")).toBe(
      true,
    );
    expect(text.endsWith("served in 12 ms\nAfter")).toBe(true);
    // Lines this short are converted as always: their bold is gone.
    expect(text.includes("**")).toBe(false);
  });

  test("an over-long line is converted at its start and end, and reads as written in between", () => {
    const words: string = "word ".repeat(15000);
    const text: string = Markdown.convertToPlainText(
      `**Response:** ${words}**bold** ${words}_end_`,
    );

    expect(text.startsWith("Response: word word")).toBe(true);
    expect(text.endsWith("word end")).toBe(true);
    expect(text.includes(" **bold** ")).toBe(true);
  });

  test("a line of at most 64 KB is converted all through, as before", () => {
    const words: string = "word ".repeat(6000);
    const text: string = Markdown.convertToPlainText(
      `**Response:** ${words}**bold** ${words}_end_`,
    );

    expect(text.includes("**")).toBe(false);
    expect(text.includes(" bold ")).toBe(true);
    expect(text.endsWith("word end")).toBe(true);
  });

  test("emphasis spanning more than 65536 characters is left as written", () => {
    const lines: string = repeatTo("long line of words\n", 70000);

    const text: string = Markdown.convertToPlainText(`**${lines}end**`);

    expect(text.startsWith("**long line")).toBe(true);
    expect(text.endsWith("end**")).toBe(true);

    const shorter: string = Markdown.convertToPlainText(
      `**${repeatTo("long line of words\n", 60000)}end**`,
    );

    expect(shorter.startsWith("long line")).toBe(true);
    expect(shorter.endsWith("end")).toBe(true);
  });
});

describe("Markdown.convertToPlainText - the loops that replaced regular expressions", () => {
  /*
   * Seeded, so every run checks the same strings and a failure
   * reproduces. The strings are made of what the replaced patterns read:
   * spaces, tabs, line breaks, other whitespace, and the sentinel
   * characters.
   */
  function makeRandom(seed: number): () => number {
    let state: number = seed >>> 0;

    return (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 4294967296;
    };
  }

  function randomString(random: () => number, alphabet: Array<string>): string {
    let text: string = "";
    const length: number = Math.floor(random() * 40);

    for (let index: number = 0; index < length; index++) {
      text += alphabet[Math.floor(random() * alphabet.length)]!;
    }

    return text;
  }

  test("collapseWhitespace does what the two regular expressions did, for 5000 strings", () => {
    const random: () => number = makeRandom(1601);
    const collapse: (text: string) => string = Markdown["collapseWhitespace"];
    const alphabet: Array<string> = [
      " ",
      "  ",
      "\t",
      "\n",
      "\n\n",
      "\r",
      " ",
      " ",
      "　",
      "﻿",
      "\v",
      "a",
      "b",
      "_",
    ];

    for (let run: number = 0; run < 5000; run++) {
      const text: string = randomString(random, alphabet);
      const expected: string = text
        .replace(/\n\s*\n/g, "\n")
        .replace(/[ \t]+/g, " ");

      expect([run, JSON.stringify(collapse(text))]).toEqual([
        run,
        JSON.stringify(expected),
      ]);
    }
  });

  test("holdInputSentinels holds back what the regular expression did, for 5000 strings", () => {
    const random: () => number = makeRandom(1602);
    const holdSentinels: (
      text: string,
      hold: (value: string) => string,
    ) => string = Markdown["holdInputSentinels"];
    const alphabet: Array<string> = [
      "\uE000",
      "\uE001",
      "\uE002",
      "\uE003",
      "\uE004",
      "\uE005",
      "\uDFFF",
      "a",
      "0",
      " ",
    ];

    for (let run: number = 0; run < 5000; run++) {
      const text: string = randomString(random, alphabet);
      const heldByLoop: Array<string> = [];
      const heldByPattern: Array<string> = [];

      const byLoop: string = holdSentinels(text, (value: string): string => {
        heldByLoop.push(value);
        return `<${heldByLoop.length - 1}>`;
      });
      const byPattern: string = text.replace(
        /[\uE000-\uE004]+/g,
        (value: string): string => {
          heldByPattern.push(value);
          return `<${heldByPattern.length - 1}>`;
        },
      );

      expect([run, byLoop, heldByLoop]).toEqual([run, byPattern, heldByPattern]);
    }
  });
});
