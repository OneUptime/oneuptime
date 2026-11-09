import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_LOG_PREFILTER,
  SecurityLogPrefilterGroup,
  matchesSecurityLogPrefilter,
} from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  SECURITY_SCAN_WORDS,
  holdsSecurityScanWord,
} from "../../../Utils/SecurityEvent/SecurityScanWords";
import {
  CLOUD_METADATA_MARKERS,
  PROMPT_INJECTION_PHRASES,
  squashWhiteSpace,
} from "../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * The words OneUptime's own security scans look for. A query that holds one
 * as written gets it written down by the database - ClickHouse's error
 * line and query_log, a proxy's access log of the URL - and that line,
 * shipped back as a log, read as the attack the word names (issue #6419).
 * So a statement sends any text that holds one in hex (Statement), and
 * this is what decides which texts those are.
 */
describe("SECURITY_SCAN_WORDS", () => {
  test("is every word the log and trace scans look for, lowercased, each once", () => {
    const expected: Set<string> = new Set<string>(
      [
        ...SECURITY_LOG_PREFILTER.anyOf,
        ...CLOUD_METADATA_MARKERS,
        ...PROMPT_INJECTION_PHRASES,
      ].map((word: string): string => {
        return word.toLowerCase();
      }),
    );

    expect(new Set<string>(SECURITY_SCAN_WORDS)).toEqual(expected);
    expect(SECURITY_SCAN_WORDS).toHaveLength(expected.size);

    for (const word of SECURITY_SCAN_WORDS) {
      expect(word).toBe(word.toLowerCase());
      expect(word.length).toBeGreaterThan(0);
    }
  });

  test("holds the words of issue #6419's line", () => {
    for (const word of [
      "failed password",
      "accepted publickey",
      "invalid user ",
      "; command=",
      "${jndi:",
      "%24%7bjndi",
      "union select",
      "../../",
      "169.254.169.254",
      "ignore previous instructions",
    ]) {
      expect({ word, held: SECURITY_SCAN_WORDS.includes(word) }).toEqual({
        word,
        held: true,
      });
    }
  });
});

describe("holdsSecurityScanWord", () => {
  test.each(
    SECURITY_SCAN_WORDS.map((word: string): [string] => {
      return [word];
    }),
  )("%s, however it is cased and wherever it is", (word: string) => {
    expect(holdsSecurityScanWord(word)).toBe(true);
    expect(holdsSecurityScanWord(word.toUpperCase())).toBe(true);
    expect(holdsSecurityScanWord(`body = 'x ${word} y'`)).toBe(true);
    expect(holdsSecurityScanWord(`${word}${word}`)).toBe(true);
  });

  test("a word spread over other white space, as the trace scan squashes it", () => {
    expect(holdsSecurityScanWord("IGNORE  previous\n\tinstructions")).toBe(
      true,
    );
    expect(holdsSecurityScanWord("x union\nselect y")).toBe(true);
    expect(holdsSecurityScanWord("Failed   password for root")).toBe(true);
  });

  test("a text that holds a word only once it is in a URL's query", () => {
    // What @clickhouse/client puts in the URL, and a proxy in front of the database logs.
    for (const text of ["../", "${jndi", "${", "' or 1=1", "union select"]) {
      const inUrl: string = new URLSearchParams([["param_p0", text]])
        .toString()
        .toLowerCase();
      const urlHoldsWord: boolean = SECURITY_SCAN_WORDS.some(
        (word: string): boolean => {
          return inUrl.includes(word);
        },
      );

      expect({ text, held: holdsSecurityScanWord(text) }).toEqual({
        text,
        held: urlHoldsWord || holdsSecurityScanWord(text),
      });
    }

    expect(holdsSecurityScanWord("../")).toBe(true);
    // "..%2Fa" in the URL holds the path traversal marker "..%2f".
    expect(holdsSecurityScanWord("../a")).toBe(true);
    expect(holdsSecurityScanWord("${jndi")).toBe(true);
    expect(holdsSecurityScanWord("x/../y")).toBe(true);
  });

  test("a line the prefilter reads for its groups, though it holds no single word", () => {
    const lines: ReadonlyArray<string> = [
      "CEF:0|Vendor|Firewall|1.0|100|Connection blocked|10|src=203.0.113.9",
      '{"kind":"Event","apiVersion":"audit.k8s.io/v1","responseStatus":{"code":403}}',
      '{"eventSource":"iam.amazonaws.com","eventName":"CreateUser","readOnly":false}',
    ];

    for (const line of lines) {
      expect(matchesSecurityLogPrefilter(line)).toBe(true);
      expect(holdsSecurityScanWord(line)).toBe(true);
    }
  });

  test("an ordinary text holds none", () => {
    for (const text of [
      "",
      "0192f1a0-0000-7000-8000-000000006419",
      "SELECT",
      "service-name",
      "GET /items?page=2",
      "checkout-service",
      "2026-11-09 13:10:14",
      "probe-6419-plain",
      "%",
      "a/b/c",
      "./",
      ".. /",
      "user_id",
      "error",
      "Failed to connect",
      "previous instructions",
    ]) {
      expect({ text, held: holdsSecurityScanWord(text) }).toEqual({
        text,
        held: false,
      });
    }

    expect(holdsSecurityScanWord(undefined as unknown as string)).toBe(false);
  });

  test("texts made of other characters hold none, and any one of them with a word does", () => {
    // No "/": "../" is a word of its own in a URL.
    const alphabet: ReadonlyArray<string> = [
      "a",
      "b",
      "1",
      " ",
      "-",
      "_",
      "é",
      "日本",
      ".",
      ":",
      "=",
    ];
    const texts: Array<string> = generatedTexts(1000, 6419, alphabet, 12);

    for (const text of texts) {
      expect({ text, held: holdsSecurityScanWord(text) }).toEqual({
        text,
        held: false,
      });

      const word: string =
        SECURITY_SCAN_WORDS[text.length % SECURITY_SCAN_WORDS.length]!;

      expect({
        text,
        word,
        held: holdsSecurityScanWord(`${text}${word}${text}`),
      }).toEqual({ text, word, held: true });
    }
  });

  test("a plain text is read through its own words alone, to the same answer as the whole reading", () => {
    // Every form at once, as the reading was before plain texts had their own path.
    const holdsInAnyForm: (text: string) => boolean = (
      text: string,
    ): boolean => {
      const lower: string = text.toLowerCase();
      const forms: Array<string> = [
        lower,
        squashWhiteSpace(lower),
        new URLSearchParams([["v", text]]).toString().slice(2).toLowerCase(),
      ];

      return (
        forms.some((form: string): boolean => {
          return SECURITY_SCAN_WORDS.some((word: string): boolean => {
            return form.includes(word);
          });
        }) || matchesSecurityLogPrefilter(text)
      );
    };
    const plainWord: RegExp = /^[a-z0-9._-]+$/i;
    const isPlain: (word: string) => boolean = (word: string): boolean => {
      return plainWord.test(word);
    };
    // The plain words, the prefilter groups' plain words, pieces of them and other plain text.
    const groupWords: Array<string> = SECURITY_LOG_PREFILTER.groups.flatMap(
      (group: SecurityLogPrefilterGroup): Array<string> => {
        return [
          group.requires,
          ...group.anyOf,
          ...(group.noneOf || []),
          ...(group.unlessAnyOf || []),
        ];
      },
    );
    const plainWords: Array<string> = [
      ...SECURITY_SCAN_WORDS,
      ...groupWords,
    ].filter(isPlain);
    const plainAlphabet: Array<string> = [
      ...plainWords,
      ...plainWords.map((word: string): string => {
        return word.slice(0, Math.ceil(word.length / 2)).toUpperCase();
      }),
      ...plainWords.map((word: string): string => {
        return word.slice(Math.ceil(word.length / 2));
      }),
      "a",
      "Z",
      "0",
      "-",
      "_",
      ".",
      "0192f1a0",
      "service.name",
    ];

    expect(plainWords).toContain("information_schema");
    expect(plainWords).toContain("169.254.169.254");

    for (const text of generatedTexts(3000, 6419, plainAlphabet, 5)) {
      expect({ text, held: holdsSecurityScanWord(text) }).toEqual({
        text,
        held: holdsInAnyForm(text),
      });
    }

    // And texts that are not plain, which go the whole way.
    const otherAlphabet: Array<string> = [
      ...plainAlphabet,
      ...SECURITY_SCAN_WORDS,
      ...groupWords,
      " ",
      "\n",
      "/",
      "'",
      '"',
      "%",
      "$",
      "{",
      ":",
    ];

    for (const text of generatedTexts(3000, 6420, otherAlphabet, 5)) {
      expect({ text, held: holdsSecurityScanWord(text) }).toEqual({
        text,
        held: holdsInAnyForm(text),
      });
    }
  });

  test("400,000 characters take time in line with them", () => {
    const texts: ReadonlyArray<string> = [
      "a".repeat(400000),
      " ".repeat(400000),
      "%".repeat(400000),
      "../".repeat(133333),
      "union ".repeat(66666),
    ];

    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        let held: number = 0;

        for (const text of texts) {
          held += holdsSecurityScanWord(text) ? 1 : 0;
        }

        return held;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(run.result).toBe(1);
  });
});
