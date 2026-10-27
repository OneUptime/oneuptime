import { redactDatabaseOutput } from "../../../../Utils/AiRemediation/Resource/DatabaseQueryRedactor";
import { redactResourceCommandOutput } from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { namedPattern } from "../../../Helpers/SourcePatterns";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A DATABASE'S OUTPUT IS REDACTED IN TIME IN LINE WITH ITS LENGTH, AND
 * LOSES EXACTLY WHAT IT LOST BEFORE.
 *
 * What a `db` command prints - rows, statements, settings - is redacted
 * before it leaves the Database AI agent and again on the server, before it
 * is stored or a model reads it. Rows are whatever anybody wrote into the
 * database. Three of the rules that look for a credential in it read the
 * same white space again and again: a password phrase's separator, the
 * spaces and tabs before an AUTH, and the white space after AUTH's
 * arguments. Each now reads it once.
 * ---------------------------------------------------------------------------
 */

const REDACTOR_FILE: string =
  "packages/Common/Utils/AiRemediation/Resource/DatabaseQueryRedactor.ts";

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const redact: (text: string) => string = (text: string): string => {
  return redactDatabaseOutput({
    resourceType: AiResourceType.DatabaseServer,
    program: "db",
    text,
  }).text;
};

const WORST_CASES: Array<[string, string]> = [
  [
    "a password phrase, then line breaks",
    "PASSWORD=" + repeat("\n", LENGTH) + "N",
  ],
  ["a password phrase, then spaces", "PASSWORD =" + repeat(" ", LENGTH) + "N"],
  ["a run of tabs", repeat("\t", LENGTH) + "'"],
  ["tabs and spaces", repeat("\t ", LENGTH) + "'"],
  ["AUTH, then a word and white space", "auth x" + repeat(" ", LENGTH) + "y"],
  ["AUTH after tabs, then white space", "\tAUTH x" + repeat(" \t", LENGTH)],
];

describe("database output is redacted in time in line with its length", () => {
  test.each(WORST_CASES)("%s", (_label: string, text: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        redact(text);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });

  // The whole of a resource command's redaction: this hook, then the generic rules.
  test.each(WORST_CASES)(
    "%s, through a resource command's redaction",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          redactResourceCommandOutput({
            resourceType: AiResourceType.DatabaseServer,
            program: "db",
            text,
          });
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});

describe("the credentials are found where they were found before", () => {
  test.each([
    [
      "ALTER USER app PASSWORD = 'hunter2'",
      "ALTER USER app PASSWORD = '[redacted]'",
    ],
    [
      "ALTER USER app PASSWORD =( 'hunter2')",
      "ALTER USER app PASSWORD =( '[redacted]')",
    ],
    ["IDENTIFIED BY 'hunter2';", "IDENTIFIED BY '[redacted]';"],
    ["AUTH hunter2", "AUTH [redacted]"],
    ["\t\tAUTH hunter2", "\t\tAUTH [redacted]"],
    ["x \t AUTH hunter2  ", "x \t AUTH [redacted]  "],
    ["(\t\tauth default hunter2", "(\t\tauth [redacted]"],
  ])("%p", (text: string, expected: string) => {
    expect(redact(text)).toBe(expected);
  });

  test("tabs no AUTH follows are left as they are", () => {
    expect(redact("a\t\t\tb")).toBe("a\t\t\tb");
    expect(redact("\t \t")).toBe("\t \t");
  });
});

/*
 * The rules as they were - the reference the rules the redactor runs (read
 * from its source) must agree with, match for match, on texts drawn from
 * the pieces they react to.
 */
const PASSWORD_PHRASE_BEFORE: RegExp =
  /\b((?:IDENTIFIED\s+(?:WITH\s+[A-Za-z0-9_$]+\s+)?(?:BY|AS)(?:\s+PASSWORD)?)|(?:(?:UN)?ENCRYPTED\s+)?PASSWORD)(\s*=\s*\(?\s*|\s*\(\s*|\s+)('(?:[^'\\\n]|\\.|'')*'?|"(?:[^"\\\n]|\\.|"")*"?)/gi;

const REDIS_AUTH_BEFORE: RegExp =
  /(^|[[("'\t)]|[:=|] )([ \t]*)(auth)([ \t]+)((?:[^"\\\]\n]|\\.)+)/gim;

// Every match with its place and groups, as one text.
const matchesOf: (pattern: RegExp, text: string) => string = (
  pattern: RegExp,
  text: string,
): string => {
  return text.replace(
    new RegExp(pattern.source, pattern.flags),
    (...args: Array<unknown>): string => {
      const offset: number = args[args.length - 2] as number;
      const groups: Array<unknown> = args.slice(1, -2);

      // The last alternative of the AUTH rule: spaces and tabs put back as they were.
      if (groups.length >= 3 && groups[2] === undefined) {
        return args[0] as string;
      }

      return `<${offset}|${groups.map(String).join("|")}>`;
    },
  );
};

interface Mismatch {
  text: string;
  now: string;
  before: string;
}

describe("each rule matches exactly what it matched before", () => {
  test("the password phrase, on forty thousand drawn texts", () => {
    const now: RegExp = namedPattern(REDACTOR_FILE, "PASSWORD_PHRASE_REGEX");
    const mismatches: Array<Mismatch> = [];
    let matched: number = 0;

    for (const text of generatedTexts(
      40000,
      3030,
      [
        "PASSWORD",
        "PASSWORD",
        "password",
        "IDENTIFIED BY",
        "IDENTIFIED",
        "BY",
        "AS",
        "WITH",
        "plug",
        "ENCRYPTED",
        "UN",
        " ",
        " ",
        "\t",
        "\n",
        "=",
        "(",
        "'",
        "'",
        '"',
        "\\",
        "x",
        "''",
      ],
      16,
    )) {
      const before: string = matchesOf(PASSWORD_PHRASE_BEFORE, text);
      const after: string = matchesOf(now, text);

      if (before !== text) {
        matched++;
      }

      if (after !== before) {
        mismatches.push({ text, now: after, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    // The drawn texts hold phrases in every arrangement, not just none.
    expect(matched).toBeGreaterThan(1000);
  });

  test("the AUTH rule, on forty thousand drawn texts", () => {
    const now: RegExp = namedPattern(REDACTOR_FILE, "REDIS_AUTH_REGEX");
    const mismatches: Array<Mismatch> = [];
    let matched: number = 0;

    for (const text of generatedTexts(
      40000,
      4040,
      [
        "auth",
        "AUTH",
        " ",
        " ",
        "\t",
        "\t",
        "\n",
        "[",
        "(",
        "'",
        '"',
        ")",
        ": ",
        "= ",
        "| ",
        "]",
        "\\",
        "x",
        "pw",
      ],
      16,
    )) {
      const before: string = matchesOf(REDIS_AUTH_BEFORE, text);
      const after: string = matchesOf(now, text);

      if (before !== text) {
        matched++;
      }

      if (after !== before) {
        mismatches.push({ text, now: after, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(matched).toBeGreaterThan(3000);
  });

  test("the white space after AUTH's arguments: trimEnd takes off exactly what \\s* before the end did", () => {
    for (const text of generatedTexts(
      20000,
      5050,
      [
        "x",
        " ",
        "\t",
        "\n",
        "\r",
        "\u00a0",
        "\u2028",
        "\u3000",
        "\ufeff",
        "\u200b",
        "\u0085",
      ],
      12,
    )) {
      expect({ text, trimmed: text.trimEnd() }).toEqual({
        text,
        trimmed: text.replace(/\s*$/, ""),
      });
    }
  });
});
