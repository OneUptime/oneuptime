import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  compileCustomDataType,
  CustomDataTypeValidator,
} from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import BUILT_IN_DETECTORS, {
  getBuiltInDetectorsOf,
} from "../../../Utils/DataSecurity/Detectors/Index";
import {
  containsWord,
  findSensitiveValues,
  MAX_SCANNED_TEXT_LENGTH,
  resolveOverlaps,
  ScanDetector,
  TextMatch,
  WINDOW_LEAD,
  WINDOW_OVERLAP,
  WINDOW_SIZE,
} from "../../../Utils/DataSecurity/TextScanner";
import { luhn } from "../../../Utils/DataSecurity/Validators";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * HOW TEXT IS SCANNED: WINDOWS, OVERLAPS AND THE WORDS AROUND A VALUE.
 *
 * Long text is read in windows of WINDOW_SIZE characters that overlap by
 * WINDOW_OVERLAP, each also reading WINDOW_LEAD characters before its own
 * part for context. These tests place values on and around every boundary
 * to show each is found exactly once, judged by the same words as anywhere
 * else; then how two types claiming the same characters are settled, how
 * context and negative words move confidence, and what the project's
 * settings (disabled types, allowed values, its own types) change.
 */

const STEP: number = WINDOW_SIZE - WINDOW_OVERLAP;

const CARD: string = "4539148803436467";
const CARD_GROUPED: string = "4539 1488 0343 6467";

// Filler that no detector reads anything into: words, spaces and full stops.
function filler(length: number): string {
  const sentence: string = "the quick brown fox jumps over a lazy dog. ";

  return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
}

// `value`, set apart by spaces, starting at `start` in filler `length` long.
function placed(value: string, start: number, length: number): string {
  return (
    filler(start - 1) +
    " " +
    value +
    " " +
    filler(length - start - value.length - 1)
  );
}

function matchesOf(
  text: string,
  dataTypeId: string,
  detectors?: ReadonlyArray<ScanDetector>,
): Array<TextMatch> {
  return findSensitiveValues(text, detectors ? { detectors } : {}).filter(
    (match: TextMatch) => {
      return match.dataTypeId === dataTypeId;
    },
  );
}

function summary(
  text: string,
  options: Parameters<typeof findSensitiveValues>[1] = {},
): Array<[string, string, DataConfidence]> {
  return findSensitiveValues(text, options).map((match: TextMatch) => {
    return [
      match.dataTypeId,
      text.slice(match.start, match.end),
      match.confidence,
    ];
  });
}

describe("windows", () => {
  test("have the sizes the scanner documents", () => {
    expect(WINDOW_SIZE).toBe(65_536);
    expect(WINDOW_OVERLAP).toBe(4_096);
    expect(WINDOW_LEAD).toBeLessThan(WINDOW_OVERLAP);
    expect(MAX_SCANNED_TEXT_LENGTH).toBe(4 * 1024 * 1024);
  });

  test("find a value straddling the 65,536th character exactly once", () => {
    const email: string = "jane.doe@acme.io";

    for (
      let start: number = WINDOW_SIZE - email.length;
      start <= WINDOW_SIZE;
      start++
    ) {
      const text: string = placed(email, start, WINDOW_SIZE * 2);
      const found: Array<TextMatch> = matchesOf(text, "email-address");

      expect([
        start,
        found.map((match: TextMatch) => {
          return match.start;
        }),
      ]).toEqual([start, [start]]);
    }
  });

  test("find a value straddling where the next window starts exactly once", () => {
    for (
      let start: number = STEP - CARD.length - 2;
      start <= STEP + 2;
      start++
    ) {
      const text: string = placed(CARD, start, WINDOW_SIZE * 2);
      const found: Array<TextMatch> = matchesOf(text, "credit-card-number");

      expect([
        start,
        found.map((match: TextMatch) => {
          return match.start;
        }),
      ]).toEqual([start, [start]]);
    }
  });

  test("count every value in the overlap once, in every window of a long text", () => {
    const random: SeededRandom = seededRandom(6144);
    const length: number = STEP * 5 + WINDOW_SIZE;
    let text: string = filler(length);
    const starts: Array<number> = [];

    // Emails in each overlap and in the parts only one window reads.
    for (let window: number = 1; window <= 5; window++) {
      for (const offset of [-3000, -40, 10, 2000, 4000, 9000]) {
        const start: number = window * STEP + offset + random(20);
        const email: string = `user${window}x${starts.length}@acme.io`;

        text =
          text.slice(0, start) +
          ` ${email} ` +
          text.slice(start + email.length + 2);
        starts.push(start + 1);
      }
    }

    const found: Array<number> = matchesOf(text, "email-address").map(
      (match: TextMatch) => {
        return match.start;
      },
    );

    expect(found).toEqual(
      [...starts].sort((a: number, b: number) => {
        return a - b;
      }),
    );
  });

  test("read the context just before a window, so a card there keeps its card words", () => {
    // "card: " ends where the second window's own part begins.
    const text: string = placed(`card: ${CARD}`, STEP - 6, WINDOW_SIZE * 2);

    expect(matchesOf(text, "credit-card-number")).toEqual([
      expect.objectContaining({ start: STEP, confidence: DataConfidence.High }),
    ]);
  });

  test("read the negative words just before a window, too", () => {
    const text: string = placed(`order ${CARD}`, STEP - 6, WINDOW_SIZE * 2);

    expect(matchesOf(text, "credit-card-number")).toEqual([
      expect.objectContaining({ start: STEP, confidence: DataConfidence.Low }),
    ]);
  });

  test("find a type that needs its words when the words sit before the window", () => {
    const text: string = placed(
      "routing number 021000021",
      STEP - 10,
      WINDOW_SIZE * 2,
    );

    expect(matchesOf(text, "us-bank-routing-number")).toEqual([
      expect.objectContaining({
        start: STEP + 5,
        confidence: DataConfidence.High,
      }),
    ]);
  });

  test("never find a card inside a longer run of digits that crosses a window's start", () => {
    // A 17-digit token whose last 16 digits are a valid card.
    const text: string = placed(`9${CARD}`, STEP - 1, WINDOW_SIZE * 2);

    expect(luhn(CARD)).toBe(true);
    expect(matchesOf(text, "credit-card-number")).toEqual([]);
  });

  test("read no further than MAX_SCANNED_TEXT_LENGTH", () => {
    const text: string =
      filler(MAX_SCANNED_TEXT_LENGTH - 100) +
      " near.end@acme.io " +
      filler(200) +
      " past.end@acme.io";
    const found: Array<string> = matchesOf(text, "email-address").map(
      (match: TextMatch) => {
        return text.slice(match.start, match.end);
      },
    );

    expect(found).toEqual(["near.end@acme.io"]);
  });

  test("find nothing in empty text", () => {
    expect(findSensitiveValues("")).toEqual([]);
  });
});

describe("overlapping candidates", () => {
  type Candidate = TextMatch & { score: number };

  function candidate(
    dataTypeId: string,
    start: number,
    end: number,
    score: number,
  ): Candidate {
    return {
      dataTypeId,
      start,
      end,
      normalized: dataTypeId,
      confidence: DataConfidence.Medium,
      isTestValue: false,
      score,
    };
  }

  function kept(candidates: Array<Candidate>): Array<string> {
    return resolveOverlaps(candidates).map((match: TextMatch) => {
      return match.dataTypeId;
    });
  }

  test("keep the higher score, then the longer match, and every one that overlaps nothing", () => {
    expect(kept([candidate("a", 0, 10, 13), candidate("b", 2, 8, 23)])).toEqual(
      ["b"],
    );
    expect(kept([candidate("a", 0, 10, 13), candidate("b", 2, 8, 13)])).toEqual(
      ["a"],
    );
    expect(kept([candidate("a", 0, 5, 13), candidate("b", 5, 9, 1)])).toEqual([
      "a",
      "b",
    ]);
  });

  test("keep both ends of a chain when the link between them loses", () => {
    expect(
      kept([
        candidate("left", 0, 10, 23),
        candidate("middle", 8, 22, 3),
        candidate("right", 20, 30, 22),
      ]),
    ).toEqual(["left", "right"]);
  });

  test("return the matches in the order they appear, without their scores", () => {
    const resolved: Array<TextMatch> = resolveOverlaps([
      candidate("late", 40, 50, 1),
      candidate("early", 0, 5, 1),
    ]);

    expect(
      resolved.map((match: TextMatch) => {
        return match.dataTypeId;
      }),
    ).toEqual(["early", "late"]);
    expect(resolved[0]).not.toHaveProperty("score");
  });

  test("give a card number to the card type when another shape claims the same digits less surely", () => {
    // A loose custom type that reads any 16 digits, Low on its own.
    const loose: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:sixteen-digits",
      pattern: "[0-9]{16}",
    })!;

    expect(
      summary(`charged ${CARD} today`, {
        detectors: [...BUILT_IN_DETECTORS, loose],
      }),
    ).toEqual([["credit-card-number", CARD, DataConfidence.Medium]]);

    // A health plan's member ID reads it too, but card words make the card surer.
    expect(summary(`card member id ${CARD}`)).toEqual([
      ["credit-card-number", CARD, DataConfidence.High],
    ]);
  });

  test("give the same digits to the type its own words confirm, when both are as sure", () => {
    // Medium on its checksum alone, and more specific ...
    const checked: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:checked-number",
      pattern: "[0-9]{10}",
      validator: CustomDataTypeValidator.Luhn,
    })!;
    // ... and Medium only because its word is next to the value.
    const named: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:named-number",
      pattern: "[0-9]{10}",
      keywords: ["cpr"],
    })!;
    const detectors: Array<ScanDetector> = [checked, named];

    expect(luhn("0000000018")).toBe(true);
    expect(summary("cpr 0000000018", { detectors })).toEqual([
      ["custom:named-number", "0000000018", DataConfidence.Medium],
    ]);
    expect(summary("ref 0000000018", { detectors })).toEqual([
      ["custom:checked-number", "0000000018", DataConfidence.Medium],
    ]);
  });

  test("give a URL's credentials to password-in-url, not to the email-shaped text inside it", () => {
    const url: string = [
      "postgres://",
      "admin",
      ":",
      "Xk7Qz2Lp9Xw4",
      "@db.acme.io",
    ].join("");

    expect(getBuiltInDetectorsOf("password-in-url").length).toBeGreaterThan(0);
    expect(
      summary(`DATABASE_URL=${url}:5432/app`).map(
        (found: [string, string, DataConfidence]) => {
          return found[0];
        },
      ),
    ).toEqual(["password-in-url"]);

    // With that type turned off, what it hid is found.
    expect(
      summary(`DATABASE_URL=${url}:5432/app`, {
        disabledDataTypeIds: new Set(["password-in-url"]),
      }),
    ).toEqual([
      ["email-address", "Xk7Qz2Lp9Xw4@db.acme.io", DataConfidence.High],
    ]);
  });
});

describe("context words", () => {
  test("containsWord finds a word, not part of one", () => {
    expect(containsWord("card pan: 4111", "pan")).toBe(true);
    expect(containsWord("company 4111", "pan")).toBe(false);
    expect(containsWord("panel", "pan")).toBe(false);
    expect(containsWord("pan", "pan")).toBe(true);
    expect(containsWord("expanded pan", "pan")).toBe(true);
    expect(containsWord("cc=4111", "cc")).toBe(true);
    expect(containsWord("accent", "cc")).toBe(false);
  });

  test("containsWord takes words that start or end with punctuation", () => {
    expect(containsWord("reply-to:jane", "to:")).toBe(true);
    expect(containsWord("a/c 1234", "a/c")).toBe(true);
    expect(containsWord("date of birth: x", "date of birth")).toBe(true);
    expect(containsWord("date of birthday", "date of birth")).toBe(false);
  });

  test("raise a value's confidence a level, to High at most", () => {
    expect(summary(CARD)).toEqual([
      ["credit-card-number", CARD, DataConfidence.Medium],
    ]);
    expect(summary(`pan: ${CARD}`)).toEqual([
      ["credit-card-number", CARD, DataConfidence.High],
    ]);
    expect(summary(`company ${CARD}`)).toEqual([
      ["credit-card-number", CARD, DataConfidence.Medium],
    ]);
  });

  test("count only as far as the detector looks", () => {
    // A routing number's words count within 28 characters before it.
    expect(summary("routing number 021000021")).toEqual([
      ["us-bank-routing-number", "021000021", DataConfidence.High],
    ]);
    expect(
      summary(
        `routing number ${"is below, see the next line ".repeat(2)}021000021`,
      ),
    ).toEqual([]);
  });

  test("let a field's name stand in for the words", () => {
    expect(summary("021000021")).toEqual([]);
    expect(
      summary("021000021", {
        hintedDataTypeIds: new Set(["us-bank-routing-number"]),
      }),
    ).toEqual([["us-bank-routing-number", "021000021", DataConfidence.High]]);
  });
});

describe("negative keywords", () => {
  test("lower a value's confidence a level", () => {
    expect(summary(`order ${CARD}`)).toEqual([
      ["credit-card-number", CARD, DataConfidence.Low],
    ]);
    expect(summary(`tracking ${CARD}`)).toEqual([
      ["credit-card-number", CARD, DataConfidence.Low],
    ]);
  });

  test("weigh against context words when both are there", () => {
    expect(summary(`card order ${CARD}`)).toEqual([
      ["credit-card-number", CARD, DataConfidence.Medium],
    ]);
  });
});

describe("the project's settings", () => {
  const text: string = `jane.doe@acme.io paid with ${CARD_GROUPED}`;

  test("a disabled type is not looked for, and the others still are", () => {
    expect(
      summary(text, { disabledDataTypeIds: new Set(["email-address"]) }),
    ).toEqual([["credit-card-number", CARD_GROUPED, DataConfidence.High]]);
  });

  test("an allowed value is not a finding, by its normalized lower-case form", () => {
    expect(
      summary(`Jane.Doe@Acme.io and john@acme.io`, {
        allowedValues: new Set(["jane.doe@acme.io"]),
      }),
    ).toEqual([["email-address", "john@acme.io", DataConfidence.High]]);
    expect(summary(text, { allowedValues: new Set([CARD]) })).toEqual([
      ["email-address", "jane.doe@acme.io", DataConfidence.High],
    ]);
  });

  test("a custom type runs beside the built-in ones, through LinearRegExp", () => {
    const employeeId: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:employee-id",
      pattern: "EMP-[0-9]{6}",
      keywords: ["Employee"],
    })!;

    expect(
      summary(`jane.doe@acme.io is EMP-104233`, {
        detectors: [...BUILT_IN_DETECTORS, employeeId],
      }),
    ).toEqual([
      ["email-address", "jane.doe@acme.io", DataConfidence.High],
      ["custom:employee-id", "EMP-104233", DataConfidence.Low],
    ]);
    expect(summary("employee EMP-104233", { detectors: [employeeId] })).toEqual(
      [["custom:employee-id", "EMP-104233", DataConfidence.Medium]],
    );
  });

  test("a custom type's Luhn validator keeps only the numbers that pass it", () => {
    const loyalty: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:loyalty-card",
      pattern: "LOY-[0-9]{12}",
      keywords: ["loyalty"],
      validator: CustomDataTypeValidator.Luhn,
    })!;
    const passing: string = "LOY-000000000018";
    const failing: string = "LOY-000000000019";

    expect(luhn("000000000018")).toBe(true);
    expect(summary(`${passing} ${failing}`, { detectors: [loyalty] })).toEqual([
      ["custom:loyalty-card", passing, DataConfidence.Medium],
    ]);
    expect(summary(`loyalty ${passing}`, { detectors: [loyalty] })).toEqual([
      ["custom:loyalty-card", passing, DataConfidence.High],
    ]);
  });

  test("a custom type that needs its keyword is found only beside it, in any case when asked", () => {
    const employeeId: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:employee-id",
      pattern: "EMP-[0-9]{6}",
      keywords: [" Employee "],
      requiresKeyword: true,
      ignoreCase: true,
    })!;

    expect(summary("emp-104233 joined", { detectors: [employeeId] })).toEqual(
      [],
    );
    expect(
      summary("Employee emp-104233 joined", { detectors: [employeeId] }),
    ).toEqual([["custom:employee-id", "emp-104233", DataConfidence.Medium]]);
  });
});

describe("a long text", () => {
  test("of 4 MB, with emails and cards scattered through it, is scanned whole within its budget", () => {
    const random: SeededRandom = seededRandom(4096);
    const pieces: Array<string> = generatedTexts(4000, 4097, [
      "GET /api/v1/items ",
      "200 ",
      "took 3.5 s ",
      "retry=3 ",
      "pod-7f9c ",
      "2026-10-27T10:15:02Z ",
      "INFO ",
      '{"ok":true} ',
      "\n",
      "the ",
      "user id=42 ",
    ]);
    const parts: Array<string> = [];
    let length: number = 0;
    let emails: number = 0;
    let cards: number = 0;

    while (length < MAX_SCANNED_TEXT_LENGTH - 256) {
      const piece: string = pieces[random(pieces.length)]!;

      parts.push(piece);
      length += piece.length;

      if (random(40) === 0) {
        const email: string = ` user${emails}@acme.io `;

        parts.push(email);
        length += email.length;
        emails++;
      } else if (random(60) === 0) {
        const card: string = ` card ${CARD_GROUPED} `;

        parts.push(card);
        length += card.length;
        cards++;
      }
    }

    const text: string = parts.join("");

    expect(text.length).toBeLessThanOrEqual(MAX_SCANNED_TEXT_LENGTH);
    expect(text.length).toBeGreaterThan(4_000_000);

    const scanned: FastestRun<Array<TextMatch>> = fastestRun({
      run: (): Array<TextMatch> => {
        return findSensitiveValues(text);
      },
      limitInMs: 20_000,
    });
    const counts: Record<string, number> = {};

    for (const match of scanned.result) {
      counts[match.dataTypeId] = (counts[match.dataTypeId] || 0) + 1;
    }

    expect(counts).toEqual({
      "email-address": emails,
      "credit-card-number": cards,
    });
    expect(scanned.inMs).toBeLessThan(20_000);
  });
});
