import {
  CompiledGrokPattern,
  compileGrokPattern,
  MAX_GROK_INPUT_LENGTH,
  matchGrokPattern,
  parseWithGrokPattern,
} from "../../../Utils/Grok/Grok";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A GROK PATTERN TAKES TIME IN LINE WITH THE LINE IT READS.
 *
 * A grok pattern is a project's own regular expression with named parts,
 * run on every log line the project sends, on ingest every project shares.
 * Raw regex in it - or library parts strung together, such as three
 * %{DATA} in a row - ran on JavaScript's RegExp, where a pattern such as
 * (a+)+$ takes time that doubles with every character it does not match.
 * Grok now runs on the linear-time matcher: the same fields from the same
 * lines, in time in line with each line.
 *
 * PATTERN_TEXT_LENGTH shortens the lines, so this suite can be run against
 * the old code and fail rather than never end.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = Math.min(
  Number(process.env["PATTERN_TEXT_LENGTH"] || 30000),
  MAX_GROK_INPUT_LENGTH - 10,
);
const BUDGET_IN_MS: number = 2000;

// The work's result, once its fastest attempt (Tests/Helpers/FastestRun) is in budget.
function timed<T>(work: () => T): T {
  const run: FastestRun<T> = fastestRun({
    run: work,
    limitInMs: BUDGET_IN_MS,
  });

  expect(run.inMs).toBeLessThan(BUDGET_IN_MS);

  return run.result;
}

describe("grok patterns JavaScript never finishes on", () => {
  test.each([
    [
      "raw regex with a nested repeat",
      "%{WORD:verb} (a+)+$",
      `GET ${"a".repeat(LENGTH)}!`,
    ],
    [
      "library parts strung together",
      "%{DATA:a}%{DATA:b}%{DATA:c}%{DATA:d}x",
      "a".repeat(LENGTH),
    ],
    [
      "a repeated group of library parts",
      "(?:%{WORD} ?)+:%{NUMBER:n}",
      "word ".repeat(LENGTH / 5),
    ],
  ])(
    "%s answers quickly, and does not match",
    (_name: string, pattern: string, line: string) => {
      const compiled: CompiledGrokPattern = compileGrokPattern(pattern);

      expect(
        timed((): unknown => {
          return matchGrokPattern(compiled, line);
        }),
      ).toBeNull();
    },
  );

  test("the same patterns still parse a line they match", () => {
    expect(parseWithGrokPattern("%{WORD:verb} (a+)+$", "GET aaa")).toEqual({
      verb: "GET",
    });
    expect(
      parseWithGrokPattern("(?:%{WORD} ?)+:%{NUMBER:n:int}", "a b c :42"),
    ).toEqual({ n: 42 });
  });

  test("look-arounds in a pattern still work, as the library's IPv4 needs", () => {
    expect(
      parseWithGrokPattern(
        "(?<=user=)%{WORD:user}(?= )",
        "login user=ada from 10.0.0.7",
      ),
    ).toEqual({ user: "ada" });
    expect(parseWithGrokPattern("%{IPV4:ip}", "client=10.0.0.7:443")).toEqual({
      ip: "10.0.0.7",
    });
    // A longer run of digits is not an address.
    expect(parseWithGrokPattern("%{IPV4:ip}", "v=1.2.3.4567")).toBeNull();
  });

  test("two email addresses in one pattern compile, and parse", () => {
    expect(
      parseWithGrokPattern(
        "from %{EMAILADDRESS:from} to %{EMAILADDRESS:to}",
        "mail from ada@example.com to bob@example.org sent",
      ),
    ).toEqual({ from: "ada@example.com", to: "bob@example.org" });
  });
});

describe("what a grok pattern can no longer hold, and what it is told", () => {
  function refusalOf(pattern: string): string {
    try {
      compileGrokPattern(pattern);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadDataException);
      return (error as Error).message;
    }

    return "";
  }

  test("a back-reference", () => {
    expect(refusalOf("%{WORD:a} (\\w)\\1")).toBe(
      "This grok pattern refers back to what an earlier group matched (\\1 or \\k<name>). Patterns are run in time that grows only in line with the text they read, which a back-reference cannot do. Write the pattern without it.",
    );
  });

  test("a capturing group inside a look-around", () => {
    expect(refusalOf("(?=(x))%{WORD:a}")).toBe(
      "This grok pattern captures a group inside a look-ahead or look-behind. Use a non-capturing group (?:...) there.",
    );
  });

  test("more parts than a pattern may compile to", () => {
    expect(
      refusalOf("%{EMAILADDRESS:a} %{EMAILADDRESS:b} %{EMAILADDRESS:c}"),
    ).toBe(
      "This grok pattern is too large to run. Shorten it, or repeat its parts fewer times.",
    );
  });

  test("and still: what is not a regular expression", () => {
    expect(refusalOf("%{WORD:a} (unclosed")).toMatch(
      /^This grok pattern is not valid: Invalid regular expression/,
    );
  });
});
