import {
  EXCLUDED_LOG_MESSAGE_WORDS_FIELD,
  LOG_MESSAGE_WORDS_FIELD,
  LOG_MESSAGE_WORD_CHIP_KEY,
  LOG_MESSAGE_WORD_COLUMN,
  LogMessageWordMatch,
  MAX_LOG_MESSAGE_WORDS,
  MAX_LOG_MESSAGE_WORD_LENGTH,
  RE2_CASE_INSENSITIVE_FLAG,
  getLogMessageWordChipFields,
  getLogMessageWordMatch,
  getLogMessageWordNeedles,
  getLogMessageWordPattern,
  getLogMessageWordSpellings,
  getShortIpv6Address,
  hasLogMessageWords,
  isIpv6AddressWord,
  isLogMessageWord,
  readLogMessageWords,
} from "../../../Utils/Telemetry/LogMessageWord";
import { MAX_URL_LENGTH } from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * "Word in message": a word a log line's message holds WHOLE.
 *
 * The Logs explorer's message search is a substring search, so a
 * Connected Signals "In the message" link that opened it on 10.0.0.1 also
 * listed 10.0.0.12 and 110.0.0.1, lines the count beside the link never
 * counted. The explorer now has the count's reading as a chip of its own,
 * and both read a word through the functions here.
 *
 * The pattern runs in ClickHouse's RE2. The part after its case flag is
 * also JavaScript's - a class, an alternation, ^ and $ - so these hold it to
 * real lines through a RegExp of the same pattern, with JavaScript's case
 * flag. App's LogMessageWordsClickhouse runs the same words in a real
 * ClickHouse.
 */

// Whether a message holds a word whole, as the server's two steps read it.
function holds(word: string, message: string): boolean {
  const match: LogMessageWordMatch | null = getLogMessageWordMatch(word);

  expect(match).not.toBeNull();
  expect(match!.pattern.startsWith(RE2_CASE_INSENSITIVE_FLAG)).toBe(true);

  const lower: string = message.toLowerCase();
  const prefiltered: boolean = match!.needles.some(
    (needle: string): boolean => {
      return lower.includes(needle);
    },
  );

  return (
    prefiltered &&
    new RegExp(
      match!.pattern.slice(RE2_CASE_INSENSITIVE_FLAG.length),
      "i",
    ).test(message)
  );
}

describe("the names a filter goes by", () => {
  test("a chip, a query key and a request field for each way, read on the message", () => {
    expect(LOG_MESSAGE_WORD_CHIP_KEY).toBe("bodyWord");
    expect(LOG_MESSAGE_WORDS_FIELD).toBe("bodyWords");
    expect(EXCLUDED_LOG_MESSAGE_WORDS_FIELD).toBe("excludedBodyWords");
    expect(LOG_MESSAGE_WORD_COLUMN).toBe("body");
  });

  test("at most ten words, each as long as a URL Connected Signals searches for", () => {
    expect(MAX_LOG_MESSAGE_WORDS).toBe(10);
    expect(MAX_LOG_MESSAGE_WORD_LENGTH).toBe(MAX_URL_LENGTH);
  });
});

describe("an address word, held whole", () => {
  test.each([
    ["from 10.0.0.1:52144 accepted", true],
    ["10.0.0.1", true],
    ["peer=10.0.0.1, retry", true],
    ["connect to [10.0.0.1]", true],
    ["ends with 10.0.0.1.", true],
    ["10.0.0.12 is another host", false],
    ["110.0.0.1 is another host", false],
    ["10.0.0.1.5 is a version", false],
    ["host-10.0.0.1 runs on", false],
    ["10.0.0.1_backup", false],
    ["nothing here", false],
  ])("10.0.0.1 in %p: %p", (message: string, expected: boolean) => {
    expect(holds("10.0.0.1", message)).toBe(expected);
  });

  test("an IPv6 address runs on through a colon too", () => {
    expect(holds("2001:db8::7", "src [2001:db8::7]:443")).toBe(true);
    expect(holds("2001:db8::7", "src 2001:db8::7:1")).toBe(false);
    expect(isIpv6AddressWord("2001:db8::7")).toBe(true);
    expect(isIpv6AddressWord("10.0.0.1")).toBe(false);
  });

  test("an IPv6 address a case writes in full finds the lines that log its short form", () => {
    expect(getLogMessageWordSpellings("2001:0DB8:0:0:0:0:0:7")).toEqual([
      "2001:0DB8:0:0:0:0:0:7",
      "2001:0db8:0:0:0:0:0:7",
      "2001:db8::7",
    ]);
    expect(holds("2001:0DB8:0:0:0:0:0:7", "login from 2001:db8::7")).toBe(true);
    expect(getShortIpv6Address("2001:db8:0:0:0:0:0:7")).toBe("2001:db8::7");
  });

  test("an IPv4 address is read in its one spelling too", () => {
    expect(getLogMessageWordNeedles("10.0.0.1")).toEqual(["10.0.0.1"]);
  });
});

describe("a name, a URL and other words, held whole whatever their case", () => {
  test.each([
    ["https://evil.example/login", true],
    ["visit EVIL.EXAMPLE now", true],
    ["evil.example.net is not it", false],
    ["sub.evil.example is not it", false],
    ["evil.examples is not it", false],
  ])("evil.example in %p: %p", (message: string, expected: boolean) => {
    expect(holds("evil.example", message)).toBe(expected);
  });

  test("a word ending in a slash has no edge there: every longer URL under it holds it", () => {
    expect(
      holds("https://evil.example/", "GET https://evil.example/login 200"),
    ).toBe(true);
    expect(
      holds("https://evil.example/login", "GET https://evil.example/logins"),
    ).toBe(false);
  });

  test("a plain word: Cart holds in Cart loaded, never in Cartography or Card", () => {
    expect(holds("Cart", "Cart loaded")).toBe(true);
    expect(holds("Cart", "cart CACHE hit")).toBe(true);
    expect(holds("Cart", "Cartography")).toBe(false);
    expect(holds("Car", "Card processor slow to answer")).toBe(false);
    expect(holds("Car", "Cart loaded")).toBe(false);
  });

  test("the needles are each spelling once, in lower case, for the cheap first read", () => {
    expect(getLogMessageWordNeedles("Evil.Example")).toEqual(["evil.example"]);
    expect(getLogMessageWordPattern("Evil.Example")).toBe(
      getLogMessageWordMatch("Evil.Example")!.pattern,
    );
  });

  test("every character a pattern would read as its own is escaped: the word means itself", () => {
    expect(holds("a+b", "sum a+b done")).toBe(true);
    expect(holds("a+b", "sum aab done")).toBe(false);
    expect(holds("(x)", "call (x) now")).toBe(true);
    expect(holds("a.b", "aXb")).toBe(false);
  });
});

describe("what a filter takes as a word", () => {
  test("text with something besides white space, no control character, at most a URL long", () => {
    expect(isLogMessageWord("10.0.0.1")).toBe(true);
    expect(isLogMessageWord("  two words  ")).toBe(true);
    expect(isLogMessageWord("")).toBe(false);
    expect(isLogMessageWord("   ")).toBe(false);
    expect(isLogMessageWord("a\u0000b")).toBe(false);
    expect(isLogMessageWord("a\nb")).toBe(false);
    expect(isLogMessageWord("x".repeat(MAX_LOG_MESSAGE_WORD_LENGTH))).toBe(
      true,
    );
    expect(isLogMessageWord("x".repeat(MAX_LOG_MESSAGE_WORD_LENGTH + 1))).toBe(
      false,
    );
    expect(isLogMessageWord(42)).toBe(false);
    expect(isLogMessageWord(null)).toBe(false);
    expect(getLogMessageWordMatch("   ")).toBeNull();
  });

  test("a query's, a request's or a link's words: trimmed, once whatever their case, at most ten", () => {
    expect(readLogMessageWords([" 10.0.0.1 ", "Cart", "cart", "", 7])).toEqual([
      "10.0.0.1",
      "Cart",
    ]);
    expect(readLogMessageWords("lone word")).toEqual(["lone word"]);
    expect(readLogMessageWords(undefined)).toEqual([]);
    expect(readLogMessageWords(null)).toEqual([]);
    expect(readLogMessageWords({ word: "x" })).toEqual([]);
    expect(
      readLogMessageWords(
        Array.from({ length: 30 }, (_value: unknown, index: number) => {
          return `word-${index}`;
        }),
      ),
    ).toHaveLength(MAX_LOG_MESSAGE_WORDS);
  });
});

describe("the chips' words, as the list query and the requests hold them", () => {
  test("a chip that keeps words and one that leaves them out", () => {
    expect(
      getLogMessageWordChipFields(
        new Map<string, Set<string>>([
          ["bodyWord", new Set(["10.0.0.1", " Cart "])],
          ["!bodyWord", new Set(["healthcheck"])],
          ["severityText", new Set(["Error"])],
        ]),
      ),
    ).toEqual({
      bodyWords: ["10.0.0.1", "Cart"],
      excludedBodyWords: ["healthcheck"],
    });
  });

  test("no word, no field: a chip of blanks filters nothing", () => {
    expect(
      getLogMessageWordChipFields(
        new Map<string, Set<string>>([["bodyWord", new Set(["", "  "])]]),
      ),
    ).toEqual({});
    expect(getLogMessageWordChipFields(new Map())).toEqual({});
  });

  test("whether a query holds a word to keep or to leave out", () => {
    expect(hasLogMessageWords({ bodyWords: ["x"] })).toBe(true);
    expect(hasLogMessageWords({ excludedBodyWords: ["x"] })).toBe(true);
    expect(hasLogMessageWords({ bodyWords: [""] })).toBe(false);
    expect(hasLogMessageWords({})).toBe(false);
    expect(hasLogMessageWords(undefined)).toBe(false);
  });
});

/*
 * A message is text somebody outside wrote. The pattern runs in RE2 on the
 * server, whose time grows in line with the text; held here through
 * JavaScript's engine, it still reads 400,000 characters of its worst case
 * - a word that almost starts again at every character - in line with them.
 */
describe("time in line with the text", () => {
  test("400,000 characters of near misses are read within two seconds", () => {
    let attempt: number = 0;
    const read: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        // A text of its own each attempt, so every attempt reads it again.
        attempt++;
        const message: string = `${"10.0.0.".repeat(57000)}x${attempt}`;

        return holds("10.0.0.1", message);
      },
      limitInMs: 2000,
    });

    expect(read.result).toBe(false);
    expect(read.inMs).toBeLessThan(2000);
  });

  test("and a word of a URL's length is read within them too", () => {
    let attempt: number = 0;
    const read: FastestRun<LogMessageWordMatch | null> = fastestRun({
      run: (): LogMessageWordMatch | null => {
        attempt++;

        return getLogMessageWordMatch(
          `${"a.".repeat(MAX_LOG_MESSAGE_WORD_LENGTH / 2 - 1)}${attempt}`,
        );
      },
      limitInMs: 2000,
    });

    expect(read.result).not.toBeNull();
    expect(read.inMs).toBeLessThan(2000);
  });
});
