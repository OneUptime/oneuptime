import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import {
  EXCEPTION_GROUPING_V3_VERSION,
  EXCEPTION_GROUPING_V4_VERSION,
  ExceptionGroupingBasis,
  ExceptionGroupingKey,
  FOLDED_VALUE_PLACEHOLDERS,
  getExceptionGroupingKey,
  getExceptionGroupingKeyV3,
  getExceptionGroupingKeyV4,
  getExceptionGroupingText,
  isChangedOnlyWhereFolded,
} from "../../../../Server/Utils/Telemetry/ExceptionGrouping";
import {
  foldSeparatedNumbers,
  foldSeparatedNumbersV4,
  isInternationalPhoneNumber,
  normalizeExceptionText,
} from "../../../../Server/Utils/Telemetry/ExceptionSanitizer";
import {
  SCRUB_RULE_BUILT_IN_PATTERNS,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
} from "../../../../Types/Telemetry/ScrubRule";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { fastestRun } from "../../../Helpers/FastestRun";
// International phone numbers, as people write them in each country.
import { INTERNATIONAL_PHONE_NUMBERS } from "../../../Helpers/InternationalPhoneNumbers";

/*
 * ---------------------------------------------------------------------------
 * GROUPING V4: AN INTERNATIONAL PHONE NUMBER, A 15-DIGIT AMERICAN EXPRESS
 * CARD OR A 19-DIGIT CARD IN A MESSAGE NO LONGER MAKES ONE EXCEPTION PER
 * VALUE (#10898).
 *
 * Grouping v3 (#10620) takes out of a message what Data Security's Credit
 * Card, SSN and Phone Number rules find: a card written 4-4-4-4, a US Social
 * Security number, a US phone number. Every other number people write with
 * separators still made one exception per value: "call +44 20 7946 0958
 * failed" and "call +44 20 7946 0123 failed" were two, and so were two
 * American Express cards. Grouping v4 reads what v3 left and takes those out
 * too (foldSeparatedNumbersV4), for new exceptions; v1, v2 and v3 stay byte
 * for byte what they were, and every exception made under them keeps its
 * fingerprint (App's ExceptionFingerprintsRecorded.test.ts).
 * ---------------------------------------------------------------------------
 */

const PROJECT: string = "0192f1a0-0000-7000-8000-000000010898";
const SERVICE: string = "0192f1a0-0000-7000-8000-000000010899";

function keyOf(
  message: string,
  stackTrace?: string,
  exceptionType: string = "CallError",
): ExceptionGroupingKey {
  return getExceptionGroupingKey({ exceptionType, message, stackTrace });
}

function textOf(key: ExceptionGroupingKey): string {
  return getExceptionGroupingText({
    projectId: PROJECT,
    primaryEntityId: SERVICE,
    key,
  });
}

function v3TextOf(
  message: string,
  stackTrace?: string,
  exceptionType?: string,
): string {
  return textOf(
    getExceptionGroupingKeyV3(keyOf(message, stackTrace, exceptionType)),
  );
}

function v4TextOf(
  message: string,
  stackTrace?: string,
  exceptionType?: string,
): string {
  return textOf(
    getExceptionGroupingKeyV4(
      getExceptionGroupingKeyV3(keyOf(message, stackTrace, exceptionType)),
    ),
  );
}

// What v4 makes of a message: the normalizer's, v3's, then v4's folds.
function v4MessageOf(message: string): string {
  return foldSeparatedNumbersV4(
    foldSeparatedNumbers(normalizeExceptionText(message)),
  );
}

function sha(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

describe("grouping v4 takes the numbers v3 left out of a message", () => {
  test.each([
    [
      "an international phone number, however it is written",
      INTERNATIONAL_PHONE_NUMBERS.map((phone: string): string => {
        return `call ${phone} failed`;
      }),
      "call <PHONE> failed",
    ],
    [
      "the issue's own examples",
      ["call +44 20 7946 0958 failed", "call +49 30 123456 failed"],
      "call <PHONE> failed",
    ],
    [
      "a 15-digit American Express card, written 4-6-5",
      [
        "card 3782 822463 10005 declined",
        "card 3714 496353 98431 declined",
        "card 3782-822463-10005 declined",
        "card 3400 000000 00009 declined",
      ],
      "card <CARD> declined",
    ],
    [
      "a 19-digit card, written 4-4-4-4-3",
      [
        "card 6011 1111 1111 1111 117 declined",
        "card 6250 9460 0000 0016 117 declined",
        "card 4111-1111-1111-1111-003 declined",
      ],
      "card <CARD> declined",
    ],
    [
      "and every card v3 already folded, one with them",
      [
        "card 4111-1111-1111-1234 declined",
        "card 5500 0000 0000 0004 declined",
        "card 3782 822463 10005 declined",
        "card 6011 1111 1111 1111 117 declined",
      ],
      "card <CARD> declined",
    ],
  ])(
    "%s: every value is one exception",
    (_name: string, messages: Array<string>, folded: string) => {
      const texts: Set<string> = new Set<string>(
        messages.map((message: string): string => {
          return v4TextOf(message);
        }),
      );

      expect(texts.size).toBe(1);
      expect(Array.from(texts)[0]).toBe(
        [
          "grouping-v4",
          PROJECT,
          SERVICE,
          "CallError",
          ExceptionGroupingBasis.Message,
          folded,
        ].join("\n"),
      );
    },
  );

  test("v3 kept each of these values apart: one exception per value", () => {
    for (const [first, second] of [
      ["call +44 20 7946 0958 failed", "call +44 20 7946 0123 failed"],
      ["call +49 30 123456 failed", "call +49 30 654321 failed"],
      ["card 3782 822463 10005 declined", "card 3714 496353 98431 declined"],
      [
        "card 6011 1111 1111 1111 117 declined",
        "card 6011 1111 1111 1111 118 declined",
      ],
    ] as Array<[string, string]>) {
      expect(v3TextOf(first)).not.toBe(v3TextOf(second));
      expect(v4TextOf(first)).toBe(v4TextOf(second));
    }
  });

  test("a phone number in a sentence: at its end, in brackets, after a colon, on a line of its own, twice", () => {
    expect(v4MessageOf("Invalid phone number: +44 20 7946 0958.")).toBe(
      "Invalid phone number: <PHONE>.",
    );
    expect(v4MessageOf("Invalid phone number: +44 20 7946 0958")).toBe(
      "Invalid phone number: <PHONE>",
    );
    expect(v4MessageOf("call the office (+44 20 7946 0958) failed")).toBe(
      "call the office (<PHONE>) failed",
    );
    expect(v4MessageOf("tel:+49-30-123456 unreachable")).toBe(
      "tel:<PHONE> unreachable",
    );
    expect(v4MessageOf("phone=+49 30 123456, retry=3")).toBe(
      "phone=<PHONE>, retry=3",
    );
    expect(v4MessageOf("call failed:\n+44 20 7946 0958\nretrying")).toBe(
      "call failed:\n<PHONE>\nretrying",
    );
    expect(
      v4MessageOf("forward +44 20 7946 0958 to +49 30 123456 failed"),
    ).toBe("forward <PHONE> to <PHONE> failed");
    expect(
      v4MessageOf("card 3782 822463 10005 of +33 1 23 45 67 89 declined"),
    ).toBe("card <CARD> of <PHONE> declined");
  });

  test("leaves every value v3 folded as v3 folded it", () => {
    for (const [message, folded] of [
      ["call 555-123-4567 failed", "call <PHONE> failed"],
      ["call (555) 123-4567 failed", "call <PHONE> failed"],
      ["Invalid SSN 123-45-6789 on file", "Invalid SSN <SSN> on file"],
      ["card 4111-1111-1111-1234 declined", "card <CARD> declined"],
      [
        "Order id=1042 not found for ada@example.com",
        "Order id=<ID> not found for <EMAIL>",
      ],
    ] as Array<[string, string]>) {
      expect(foldSeparatedNumbers(normalizeExceptionText(message))).toBe(
        folded,
      );
      expect(v4MessageOf(message)).toBe(folded);
    }
  });
});

/*
 * What no fold may take: a value that is no phone number and no card. Each
 * stays in the message as v3 left it, so two messages that differ in it are
 * still two exceptions.
 */
describe("never folds what is not a phone number or a card", () => {
  const NEAR_MISSES: ReadonlyArray<[string, string]> = [
    // Order numbers.
    ["order numbers", "order ORD-2024-000123 failed"],
    ["order numbers", "order #12345 failed"],
    ["order numbers", "order 1234 5678 failed"],
    ["order numbers", "order 123 456 789 failed"],
    ["order numbers", "order 12-34-56-78 failed"],
    ["order numbers", "order 1234-567890-1234 failed"],
    // Timestamps and timezones.
    ["timestamps", "at 2026-11-24 10:15:00 +0000 failed"],
    ["timestamps", "at Sat Nov 24 10:15:00 +0100 2026 failed"],
    ["timestamps", "at 10:15:00 +05:30 failed"],
    ["timestamps", "at UTC+1 failed"],
    ["timestamps", "at UTC +1 2026 failed"],
    ["timestamps", "at GMT +12 2026-11-24 failed"],
    ["timestamps", "at +0000 failed"],
    ["timestamps", "offset +05 30 failed"],
    // Version strings.
    ["version strings", "build v1.2.3+build.5 failed"],
    ["version strings", "node 18.19.0+1 failed"],
    ["version strings", "upgrade to +1.2.3 failed"],
    ["version strings", "upgrade to version +2.3.4.5 failed"],
    ["version strings", "release 2.10.3 failed"],
    ["version strings", "semver 1.0.0-rc.1+20261124 failed"],
    // Ids.
    ["ids", "user 42 of 1000 failed"],
    ["ids", "tenant t_8812 shard 3 failed"],
    ["ids", "job 2026 attempt 3 of 5 failed"],
    ["ids", "HTTP 503 after 3 retries"],
    // Decimals, amounts that are no phone number, coordinates.
    ["decimals", "delta +51.507217 out of range"],
    ["decimals", "delta +12.345678 out of range"],
    ["decimals", "balance +1 000 000 left"],
    // Almost a phone number.
    ["almost a phone number", "call +0044 20 7946 0958 failed"],
    ["almost a phone number", "call a+44 20 7946 0958 failed"],
    ["almost a phone number", "call ++44 20 7946 0958 failed"],
    ["almost a phone number", "call +44 failed"],
    ["almost a phone number", "call +44 20 failed"],
    ["almost a phone number", "call +44 2079 failed"],
    ["almost a phone number", "call +1 2 3 4 5 6 7 8 failed"],
    ["almost a phone number", "call +44 20 7946 0958 12 34 failed"],
    ["almost a phone number", "call +44 20 7946 0958abc failed"],
    ["almost a phone number", "call +44.20.7946.0958 failed"],
    ["almost a phone number", "call +44 20 1234567x failed"],
    ["almost a phone number", "call +1-800-FLOWERS failed"],
    ["almost a phone number", "call 020 7946 0958 failed"],
    // Almost a card.
    ["almost a card", "card 3782 822463 1000 declined"],
    ["almost a card", "card 3782 82246 310005 declined"],
    ["almost a card", "card 3782.822463.10005 declined"],
    ["almost a card", "card 4111 1111 1111 1111 1234 declined"],
  ];

  test.each(NEAR_MISSES)("%s: %s", (_kind: string, message: string) => {
    const v3: string = foldSeparatedNumbers(normalizeExceptionText(message));

    expect(foldSeparatedNumbersV4(v3)).toBe(v3);
  });

  test("the near misses stay two exceptions when they differ", () => {
    for (const [first, second] of [
      ["order 1234 5678 failed", "order 8765 4321 failed"],
      ["at UTC +1 2026 failed", "at UTC +2 2026 failed"],
      ["upgrade to +1.2.3 failed", "upgrade to +1.2.4 failed"],
      ["delta +51.507217 out of range", "delta +48.856613 out of range"],
      ["call +44 20 failed", "call +49 30 failed"],
      ["call +44 2079 failed", "call +44 2080 failed"],
    ] as Array<[string, string]>) {
      expect(v4TextOf(first)).not.toBe(v4TextOf(second));
    }
  });

  test("messages that differ in more than such a number stay apart", () => {
    expect(v4TextOf("call +44 20 7946 0958 failed")).not.toBe(
      v4TextOf("call +44 20 7946 0958 timed out"),
    );
    expect(v4TextOf("card 3782 822463 10005 declined")).not.toBe(
      v4TextOf("card 3782 822463 10005 expired"),
    );
    expect(v4TextOf("call +44 20 7946 0958 failed")).not.toBe(
      v4TextOf("call +44 20 7946 0958 failed", undefined, "SmsError"),
    );
  });

  test("a number with a plus sign and its groups is taken as a phone number whatever it counts: a signed amount of eight digits or more too", () => {
    /*
     * "+61 412 345 678" is an Australian mobile number written as people
     * write it, and "+10 000 000" a signed amount written the same way: no
     * reading of the text tells them apart. Both fold; a message that
     * differs only in such an amount is one exception, as one that differs
     * in a phone number is.
     */
    expect(v4MessageOf("call +61 412 345 678 failed")).toBe(
      "call <PHONE> failed",
    );
    expect(v4MessageOf("balance +10 000 000 left")).toBe(
      "balance <PHONE> left",
    );
  });
});

describe("what makes a whole international phone number", () => {
  test.each([
    ["+44 20 7946 0958", "", true],
    ["+44 20 7946 0958", " ", true],
    ["+44 20 7946 0958", ".", true],
    ["+44 20 7946 0958", ")", true],
    ["+44 20 7946 0958", "a", false],
    ["+44 20 7946 0958", "7", false],
    ["+44 20 7946 0958", "_", false],
    ["+44 20 7946 0958", "<", false],
    ["+44 <PHONE>", "", true],
    ["+44 <NUMBER>", "", true],
    ["+44 <HEX_ID>", "", true],
    ["+44 20 <NUMBER>", "", true],
    ["+44 <NUMBER> 12", "", false],
    ["+44 <PHONE> 12", "", false],
    ["+1 2 3 4 5 6 7 8", "", false],
    ["+33 1 23 45 67 89", "", true],
    ["+44 (0) 20 7946 0958", "", true],
    ["(+44) 20 7946 0958", "", true],
    ["+44 20 7946", "", true],
    ["+44 2079", "", false],
    ["+4 2 7946", "", false],
    ["+44 20 7946 0958 12 34", "", false],
    ["+999 <HEX_ID> 1", "", false],
    ["+123 4567 <HEX_ID>", "", true],
    ["+123 45678 <HEX_ID>", "", false],
    ["+12 345 <NUMBER>", "", true],
    ["+123 456789 <NUMBER>", "", false],
    ["+44", "", false],
  ])(
    "%s, followed by %j: %s",
    (candidate: string, next: string, expected: boolean) => {
      expect(isInternationalPhoneNumber(candidate, next)).toBe(expected);
    },
  );
});

describe("grouping v4's key and text", () => {
  test("a message names grouping v4 though it holds none of these numbers, so what a rule left of it is read the same way", () => {
    const plain: ExceptionGroupingKey = getExceptionGroupingKeyV3(
      keyOf("Order id=1042 not found"),
    );

    expect(getExceptionGroupingKeyV4(plain)).toEqual({
      ...plain,
      version: EXCEPTION_GROUPING_V4_VERSION,
    });
    expect(v4TextOf("Order id=1042 not found")).toMatch(/^grouping-v4\n/);
  });

  test("is grouping v3's key, text and fingerprint for an exception grouped by its frames, which are v2's", () => {
    const stackTrace: string = [
      "TypeError: no code sent to +44 20 7946 0958",
      "    at sendCode (/app/src/notify/sms.ts:42:17)",
    ].join("\n");
    const framed: ExceptionGroupingKey = getExceptionGroupingKeyV3(
      keyOf("no code sent to +44 20 7946 0958", stackTrace),
    );

    expect(framed.basis).toBe(ExceptionGroupingBasis.InAppFrames);
    // Its message is not read.
    expect(getExceptionGroupingKeyV4(framed)).toBe(framed);
    expect(v4TextOf("no code sent to +44 20 7946 0958", stackTrace)).toBe(
      v3TextOf("no code sent to +44 20 7946 0958", stackTrace),
    );
    expect(v4TextOf("no code sent to +44 20 7946 0958", stackTrace)).toMatch(
      /^grouping-v2\n/,
    );
  });

  test("names its own version, so a v4 fingerprint never equals a v3 one", () => {
    const key: ExceptionGroupingKey = getExceptionGroupingKeyV4(
      getExceptionGroupingKeyV3(keyOf("call +44 20 7946 0958 failed")),
    );

    expect(key.version).toBe(EXCEPTION_GROUPING_V4_VERSION);
    expect(EXCEPTION_GROUPING_V4_VERSION).not.toBe(
      EXCEPTION_GROUPING_V3_VERSION,
    );
    // A message that says "<PHONE>" itself is grouped by v3, under another text.
    expect(v4TextOf("call +44 20 7946 0958 failed")).not.toBe(
      v3TextOf("call <PHONE> failed"),
    );
    expect(sha(v4TextOf("call +44 20 7946 0958 failed"))).not.toBe(
      sha(v3TextOf("call <PHONE> failed")),
    );
  });

  test("brings no placeholder of its own: a rule's hidden value is told apart from a folded one as for v3", () => {
    for (const placeholder of ["<PHONE>", "<CARD>"]) {
      expect(FOLDED_VALUE_PLACEHOLDERS).toContain(placeholder);
    }
  });

  test("an international number a rule hid reaches no v4 fingerprint: the texts differ only where it was folded", () => {
    // Hidden whole.
    expect(
      isChangedOnlyWhereFolded(
        v4TextOf("call +44 20 7946 0958 failed"),
        v4TextOf("call [REDACTED] failed"),
      ),
    ).toBe(true);
    // Masked.
    expect(
      isChangedOnlyWhereFolded(
        v4TextOf("call +49 30 123456 failed"),
        v4TextOf("call +49 ** ****56 failed"),
      ),
    ).toBe(true);
    // The US Phone Number rule hides the last ten digits of "+44 207 946 0958".
    const usRule: ScrubRegExp = scrubRegExpFromBuiltIn(
      SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.PhoneNumber]!,
    );
    const scrubbed: string = usRule.replace(
      "call +44 207 946 0958 failed",
      (): string => {
        return "[REDACTED]";
      },
    );
    expect(scrubbed).toBe("call +44 [REDACTED] failed");
    expect(
      isChangedOnlyWhereFolded(
        v4TextOf("call +44 207 946 0958 failed"),
        v4TextOf(scrubbed),
      ),
    ).toBe(true);
    // A card the Credit Card rule hid the first 16 digits of.
    expect(
      isChangedOnlyWhereFolded(
        v4TextOf("card 6011 1111 1111 1111 117 declined"),
        v4TextOf("card [REDACTED] 117 declined"),
      ),
    ).toBe(true);
    // Its v3 fingerprint holds the number.
    expect(
      isChangedOnlyWhereFolded(
        v3TextOf("call +44 20 7946 0958 failed"),
        v3TextOf("call [REDACTED] failed"),
      ),
    ).toBe(false);
    // And a name a rule hid is in v4's text as it was in v3's.
    expect(
      isChangedOnlyWhereFolded(
        v4TextOf("call Ada at +44 20 7946 0958 failed"),
        v4TextOf("call [REDACTED] at +44 20 7946 0958 failed"),
      ),
    ).toBe(false);
  });
});

/*
 * Whatever v3 makes one value, v4 keeps one value: v4 reads v3's folded
 * message. Drawn from a seeded stream: messages that v3 folds to the same
 * text - US phone numbers, cards and SSNs, written every way v3 reads -
 * beside international numbers and cards v4 folds.
 */
describe("whatever grouping v3 groups as one, v4 groups as one", () => {
  const random: SeededRandom = seededRandom(10898);

  function digits(count: number): string {
    let out: string = "";

    for (let index: number = 0; index < count; index++) {
      out += String(random(10));
    }

    return out;
  }

  function pick<T>(items: ReadonlyArray<T>): T {
    return items[random(items.length)]!;
  }

  const separators: ReadonlyArray<string> = ["-", " ", ".", ""];
  const values: Array<() => string> = [
    (): string => {
      const separator: string = pick(separators);
      return `${pick(["2", "3", "4", "5", "6", "7", "8", "9"])}${digits(2)}${separator}${digits(3)}${separator}${digits(4)}`;
    },
    (): string => {
      return `(${pick(["2", "5", "8"])}${digits(2)}) ${digits(3)}-${digits(4)}`;
    },
    (): string => {
      const separator: string = pick(["-", " "]);
      return `4${digits(3)}${separator}${digits(4)}${separator}${digits(4)}${separator}${digits(4)}`;
    },
    (): string => {
      return `${digits(3)}-${digits(2)}-${digits(4)}`;
    },
    (): string => {
      return `+${pick(["44", "49", "33", "91", "81", "353"])} ${pick(["20", "30", "1", "3"])} ${digits(4)} ${digits(4)}`;
    },
    (): string => {
      const separator: string = pick(["-", " "]);
      return `37${digits(2)}${separator}${digits(6)}${separator}${digits(5)}`;
    },
  ];
  const templates: ReadonlyArray<string> = [
    "call {{value}} failed",
    "{{value}}",
    "Invalid value: {{value}}.",
    "card {{value}} declined at {{value}}",
  ];

  test("for 4,000 messages drawn from a seeded stream", () => {
    const v4ByV3: Map<string, string> = new Map<string, string>();
    let groupedByV3: number = 0;

    for (let index: number = 0; index < 4000; index++) {
      const template: string = pick(templates);
      const message: string = template
        .split("{{value}}")
        .map((part: string, at: number): string => {
          return at === 0 ? part : `${pick(values)()}${part}`;
        })
        .join("");
      const v3: string = v3TextOf(message);
      const v4: string = v4TextOf(message);
      const seen: string | undefined = v4ByV3.get(v3);

      if (seen !== undefined) {
        groupedByV3++;
        expect({ message, v4 }).toEqual({ message, v4: seen });
      }

      v4ByV3.set(v3, v4);
    }

    // Enough messages share a v3 text for the check to say something.
    expect(groupedByV3).toBeGreaterThan(1000);
  });
});

/*
 * What the normalizer, grouping v1, v2 and v3 make of messages that hold the
 * numbers v4 folds, pinned as they were before v4 (recorded on main's code):
 * every exception made under them is found by exactly these. v4's own are
 * pinned too, for the day v5 follows it.
 */
describe("byte for byte", () => {
  const goldens: Array<{
    type: string;
    message: string;
    normalizedMessage: string;
    v3Message: string;
    v4Message: string;
    v1: string;
    v2: string;
    v3: string;
    v4: string;
  }> = [
    {
      type: "CallError",
      message: "call +44 20 7946 0958 failed",
      normalizedMessage: "call +44 20 7946 0958 failed",
      v3Message: "call +44 20 7946 0958 failed",
      v4Message: "call <PHONE> failed",
      v1: "58bda91ddc9925b72a45077e60e7b7b6712b990255c4b4957df64a0f0605082a",
      v2: "73ee55e3d7d4f323ba340f6fe242973177b3e599be979a8e65850842784cdb0d",
      v3: "e29ac4949135cf3b521f84e91e2c0ba5f224e5843ecb2a43944c5cab33ad4185",
      v4: "183bdb7a81d58b03921d79c6cb06a1fa37273def44516c73fa256607a755b263",
    },
    {
      type: "CallError",
      message: "call +44 207 946 0958 failed",
      normalizedMessage: "call +44 207 946 0958 failed",
      v3Message: "call +44 <PHONE> failed",
      v4Message: "call <PHONE> failed",
      v1: "99ea31037ac0b93baf763398a263923448f595bf7c03142bc91ad13bf8f76e61",
      v2: "79889e695b7f66dbb4132d82f2b2a8cede1e53be83c62a35a6bb0f57c6897c6a",
      v3: "fde0a5c460ae8784dcfc2c9fd1d4df8c4714d53531af16660c2371ae5c724f09",
      v4: "183bdb7a81d58b03921d79c6cb06a1fa37273def44516c73fa256607a755b263",
    },
    {
      type: "CallError",
      message: "call +49 30 123456 failed",
      normalizedMessage: "call +49 30 123456 failed",
      v3Message: "call +49 30 123456 failed",
      v4Message: "call <PHONE> failed",
      v1: "113c22bef7cc9e9def7895c67c9e50d3523489a016bb69dc115a9c5c54d61fc1",
      v2: "96f28334ea5f8e54dab71fb74eb3e0fea869a1cc4ae1b30880d00d94ff020ebe",
      v3: "89b372af228e30a2ed8330b397ff215a3505a35bd6aa5c43e88430c448560a60",
      v4: "183bdb7a81d58b03921d79c6cb06a1fa37273def44516c73fa256607a755b263",
    },
    {
      type: "CallError",
      message: "call +91 9876543210 failed",
      normalizedMessage: "call +91 <HEX_ID> failed",
      v3Message: "call +91 <HEX_ID> failed",
      v4Message: "call <PHONE> failed",
      v1: "fabdd9423af74a16792b52b4d02febc81bee498041954e7d18b2110706f6726b",
      v2: "aa367fb3b9df08c29536e8e2d954d03657d2b3d26e4a6c9b6324766695f8b464",
      v3: "a8c14863166509cb7779ad275a0e665e0c5ef87f2d82ae89284922cfa78a9789",
      v4: "183bdb7a81d58b03921d79c6cb06a1fa37273def44516c73fa256607a755b263",
    },
    {
      type: "PaymentDeclinedError",
      message: "card 3782 822463 10005 declined",
      normalizedMessage: "card 3782 822463 10005 declined",
      v3Message: "card 3782 822463 10005 declined",
      v4Message: "card <CARD> declined",
      v1: "9be607d71a242523a058bafcb978a2ac5b85fc20a144359d0b1ed624c7ee5910",
      v2: "cb5c58d5c5a9ea6c1a62727631c65d5a29db41eb25de0cd2045c377f6b76236b",
      v3: "d6aa711a3dd17df9eeaf8520fbe9625cf6ce696dbc1f15da301c2ec7a7b2d634",
      v4: "811139420a38cd43d76abc237c9a72be044158faec74584761fcc2b31d89b105",
    },
    {
      type: "PaymentDeclinedError",
      message: "card 6011 1111 1111 1111 117 declined",
      normalizedMessage: "card 6011 1111 1111 1111 117 declined",
      v3Message: "card <CARD> 117 declined",
      v4Message: "card <CARD> declined",
      v1: "8dc5566e787b88803d32692af8f27bdda6b314c7daaa72ee7ba79f2f5768b0c7",
      v2: "f85e1a28d43279a908534180b03c4e5c36bb7cb7647267b92688b12f07f4f9bc",
      v3: "52046b786eebc18e25f4a2b365103e004c3853ad41cce2cd829c09a95ed89634",
      v4: "811139420a38cd43d76abc237c9a72be044158faec74584761fcc2b31d89b105",
    },
  ];

  test.each(goldens)("$message", (golden: (typeof goldens)[number]) => {
    const keyV2: ExceptionGroupingKey = getExceptionGroupingKey({
      exceptionType: golden.type,
      message: golden.message,
    });
    const keyV3: ExceptionGroupingKey = getExceptionGroupingKeyV3(keyV2);
    const keyV4: ExceptionGroupingKey = getExceptionGroupingKeyV4(keyV3);

    expect(normalizeExceptionText(golden.message)).toBe(
      golden.normalizedMessage,
    );
    expect(keyV2.parts).toEqual([golden.normalizedMessage]);
    expect(keyV3.parts).toEqual([golden.v3Message]);
    expect(keyV4.parts).toEqual([golden.v4Message]);
    // v1's text: the project, the service, the message, no stack trace, the type.
    expect(
      sha(
        [
          PROJECT,
          SERVICE,
          normalizeExceptionText(golden.message),
          normalizeExceptionText(""),
          golden.type,
        ].join(""),
      ),
    ).toBe(golden.v1);
    expect(sha(textOf(keyV2))).toBe(golden.v2);
    expect(sha(textOf(keyV3))).toBe(golden.v3);
    expect(sha(textOf(keyV4))).toBe(golden.v4);
  });

  test("v3's folds of the numbers v4 folds, as v3 shipped them", () => {
    for (const [message, normalized, v3] of [
      [
        "call +44 (0)20 7946 0958 failed",
        "call +44 (0)20 7946 0958 failed",
        "call +44 (0)20 7946 0958 failed",
      ],
      [
        "call +44 7911123456 failed",
        "call +44 <HEX_ID> failed",
        "call +44 <HEX_ID> failed",
      ],
      [
        "call (+44) 20 7946 0958 failed",
        "call (+44) 20 7946 0958 failed",
        "call (+44) 20 7946 0958 failed",
      ],
      [
        "call +49 30 12345678 failed",
        "call +49 30 <HEX_ID> failed",
        "call +49 30 <HEX_ID> failed",
      ],
      [
        "call +7 495 123 4567 failed",
        "call +7 495 123 4567 failed",
        "call +7 <PHONE> failed",
      ],
      [
        "call +86 13800138000 failed",
        "call +86 <TIMESTAMP> failed",
        "call +86 <TIMESTAMP> failed",
      ],
      [
        "call +254 20 1234567 failed",
        "call +254 20 <NUMBER> failed",
        "call +254 20 <NUMBER> failed",
      ],
      [
        "call +1 555 123 4567 failed",
        "call +1 555 123 4567 failed",
        "call <PHONE> failed",
      ],
      [
        "call +442079460958 failed",
        "call +<HEX_ID> failed",
        "call +<HEX_ID> failed",
      ],
      [
        "call +15551234567 failed",
        "call +<TIMESTAMP> failed",
        "call +<TIMESTAMP> failed",
      ],
      [
        "card 3782-822463-10005 declined",
        "card 3782-822463-10005 declined",
        "card 3782-822463-10005 declined",
      ],
      [
        "card 4111-1111-1111-1111-003 declined",
        "card 4111-1111-1111-1111-003 declined",
        "card <CARD>-003 declined",
      ],
      [
        "card 3056 930902 5904 declined",
        "card 3056 930902 5904 declined",
        "card 3056 <PHONE> declined",
      ],
    ] as Array<[string, string, string]>) {
      expect(normalizeExceptionText(message)).toBe(normalized);
      expect(foldSeparatedNumbers(normalized)).toBe(v3);
    }
  });

  test("not folded by v4 either: a number with no separator, a 14-digit Diners Club card, a number the normalizer read as a date", () => {
    for (const message of [
      "call +442079460958 failed",
      "call +15551234567 failed",
      "card 3056 930902 5904 declined",
      "call +86 13800138000 failed",
      // "44-20-7946" reads as a date (dd-dd-yyyy) before any fold.
      "tel:+44-20-7946-0958 unreachable",
    ]) {
      const v3: string = foldSeparatedNumbers(normalizeExceptionText(message));

      expect(foldSeparatedNumbersV4(v3)).toBe(v3);
    }
  });
});

describe("a message built to be slow is read quickly", () => {
  const LENGTH: number = 64 * 1024;

  const repeat: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH);
  };

  test.each([
    ["plus signs", repeat("+")],
    ["country codes", repeat("+44 ")],
    ["one group after another", "+44" + repeat(" 1")],
    ["groups in brackets", "+44" + repeat(" (0)")],
    ["placeholders", "+44" + repeat(" <PHONE>")],
    ["hyphens", "+44" + repeat("-12")],
    ["card groups", repeat("1234 123456 ")],
    ["card placeholders", repeat("<CARD> 123 ")],
  ])("%s", (_name: string, message: string) => {
    const run: () => string = (): string => {
      return foldSeparatedNumbersV4(message);
    };

    expect(fastestRun({ run: run, limitInMs: 2000 }).inMs).toBeLessThan(2000);
    expect(typeof run()).toBe("string");
  });
});
