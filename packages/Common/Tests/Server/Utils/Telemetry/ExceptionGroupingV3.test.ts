import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import {
  EXCEPTION_GROUPING_V3_VERSION,
  ExceptionGroupingBasis,
  ExceptionGroupingKey,
  getExceptionGroupingKey,
  getExceptionGroupingKeyV3,
  getExceptionGroupingText,
  isChangedOnlyWhereFolded,
} from "../../../../Server/Utils/Telemetry/ExceptionGrouping";
import {
  foldSeparatedNumbers,
  normalizeExceptionText,
} from "../../../../Server/Utils/Telemetry/ExceptionSanitizer";
import {
  SCRUB_RULE_BUILT_IN_PATTERNS,
  scrubRegExpFromBuiltIn,
} from "../../../../Types/Telemetry/ScrubRule";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";

/*
 * ---------------------------------------------------------------------------
 * GROUPING V3: A CARD NUMBER IN GROUPS, A SOCIAL SECURITY NUMBER OR A PHONE
 * NUMBER IN A MESSAGE NO LONGER MAKES ONE EXCEPTION PER VALUE (#10620).
 *
 * An exception with no stack trace is grouped by its message, with the
 * values that change from call to call taken out (normalizeExceptionText).
 * That leaves in the numbers people write with separators, so "Invalid SSN
 * 123-45-6789" and "Invalid SSN 987-65-4321" were two exceptions. Grouping v3
 * takes them out too, for new exceptions: v2's key, with the message folded
 * (getExceptionGroupingKeyV3), and v2's key itself wherever that folds
 * nothing. The older versions stay byte for byte what they were: every
 * existing exception is found by them.
 * ---------------------------------------------------------------------------
 */

const PROJECT: string = "0192f1a0-0000-7000-8000-000000010620";
const SERVICE: string = "0192f1a0-0000-7000-8000-000000010621";

function keyOf(message: string, stackTrace?: string): ExceptionGroupingKey {
  return getExceptionGroupingKey({
    exceptionType: "PaymentDeclinedError",
    message,
    stackTrace,
  });
}

function v3TextOf(message: string, stackTrace?: string): string {
  return getExceptionGroupingText({
    projectId: PROJECT,
    primaryEntityId: SERVICE,
    key: getExceptionGroupingKeyV3(keyOf(message, stackTrace)),
  });
}

function sha(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

describe("grouping v3 takes the numbers people write with separators out of a message", () => {
  test.each([
    [
      "a card number in groups",
      [
        "card 4111-1111-1111-1234 declined",
        "card 5500-0000-0000-0004 declined",
        "card 4111 1111 1111 9876 declined",
      ],
      "card <CARD> declined",
    ],
    [
      "a Social Security number",
      ["Invalid SSN 123-45-6789 on file", "Invalid SSN 987-65-4321 on file"],
      "Invalid SSN <SSN> on file",
    ],
    [
      "a phone number with separators",
      [
        "call 555-123-4567 failed",
        "call 555.987.6543 failed",
        "call 555 222 3333 failed",
      ],
      "call <PHONE> failed",
    ],
  ])(
    "%s: every value is one exception",
    (_name: string, messages: Array<string>, folded: string) => {
      const texts: Set<string> = new Set<string>(
        messages.map((message: string): string => {
          return v3TextOf(message);
        }),
      );

      expect(texts.size).toBe(1);
      expect(Array.from(texts)[0]).toBe(
        [
          "grouping-v3",
          PROJECT,
          SERVICE,
          "PaymentDeclinedError",
          ExceptionGroupingBasis.Message,
          folded,
        ].join("\n"),
      );
    },
  );

  test("a phone number however it is written: its area code in parentheses, with a country code, is one exception", () => {
    for (const message of [
      "call 555-123-4567 failed",
      "call (555) 123-4567 failed",
      "call (555)123-4567 failed",
      "call 1-555-123-4567 failed",
      "call +1 555.123.4567 failed",
      "call +1 (555) 123 4567 failed",
    ]) {
      expect(foldSeparatedNumbers(normalizeExceptionText(message))).toBe(
        "call <PHONE> failed",
      );
    }
  });

  test("never folds part of a longer run of digits or words", () => {
    for (const message of [
      "order 1234555-123-45678 failed",
      "build a555-123-4567 failed",
      "ticket 555-123-45679 failed",
    ]) {
      expect(foldSeparatedNumbers(message)).not.toContain("<PHONE>");
    }
  });

  test("folds exactly what Data Security's Credit Card, SSN and Phone Number rules find", () => {
    const values: Array<string> = [
      "4111-1111-1111-1111",
      "4111 1111 1111 1111",
      "123-45-6789",
      "555-123-4567",
      "(555) 123-4567",
      "555.123.4567",
    ];

    for (const value of values) {
      const message: string = `rejected ${value} today`;
      const found: boolean = [
        LogScrubPatternType.CreditCard,
        LogScrubPatternType.SSN,
        LogScrubPatternType.PhoneNumber,
      ].some((patternType: string): boolean => {
        return scrubRegExpFromBuiltIn(
          SCRUB_RULE_BUILT_IN_PATTERNS[patternType]!,
        ).test(message);
      });

      expect(found).toBe(true);
      expect(
        foldSeparatedNumbers(normalizeExceptionText(message)),
      ).not.toContain(value.replace(/[()]/g, "").slice(-4));
    }
  });

  test("leaves the rest of the message alone: short numbers, versions, words", () => {
    for (const message of [
      "HTTP 500 from upstream",
      "step 2 of 3 failed",
      "release 1.2.3 is not supported",
      "timeout after 3000ms",
      "No cart for <EMAIL>",
    ]) {
      expect(foldSeparatedNumbers(message)).toBe(message);
    }
  });

  test("messages that differ in more than such a number stay apart", () => {
    expect(v3TextOf("card 4111-1111-1111-1234 declined")).not.toBe(
      v3TextOf("card 4111-1111-1111-1234 expired"),
    );
  });

  test("a message names grouping v3 though it holds none of these numbers, so what a rule left of it is read the same way", () => {
    const plain: ExceptionGroupingKey = keyOf("Order id=1042 not found");

    expect(getExceptionGroupingKeyV3(plain)).toEqual({
      ...plain,
      version: EXCEPTION_GROUPING_V3_VERSION,
    });
    expect(v3TextOf("Order id=1042 not found")).toMatch(/^grouping-v3\n/);
  });

  test("is grouping v2's key, text and fingerprint for an exception grouped by its frames", () => {
    // Its message is not read.
    const framed: ExceptionGroupingKey = keyOf(
      "no cart for 123-45-6789",
      [
        "TypeError: no cart for 123-45-6789",
        "    at checkout (/app/src/cart.ts:10:15)",
      ].join("\n"),
    );
    expect(framed.basis).toBe(ExceptionGroupingBasis.InAppFrames);
    expect(getExceptionGroupingKeyV3(framed)).toBe(framed);
    expect(
      v3TextOf(
        "no cart for 123-45-6789",
        "    at checkout (/app/src/cart.ts:10:15)",
      ),
    ).toMatch(/^grouping-v2\n/);
  });

  test("names its own version, so a v3 fingerprint never equals a v2 one", () => {
    const key: ExceptionGroupingKey = getExceptionGroupingKeyV3(
      keyOf("Invalid SSN 123-45-6789 on file"),
    );

    expect(key.version).toBe(EXCEPTION_GROUPING_V3_VERSION);
    // A message that says "<SSN>" itself is grouped by v2, under another text.
    expect(v3TextOf("Invalid SSN 123-45-6789 on file")).not.toBe(
      getExceptionGroupingText({
        projectId: PROJECT,
        primaryEntityId: SERVICE,
        key: keyOf("Invalid SSN <SSN> on file"),
      }),
    );
  });

  test("an SSN a rule hid reaches no v3 fingerprint: the texts differ only where it was folded", () => {
    expect(
      isChangedOnlyWhereFolded(
        v3TextOf("Invalid SSN 123-45-6789 on file"),
        v3TextOf("Invalid SSN [REDACTED] on file"),
      ),
    ).toBe(true);
    // Its v2 fingerprint holds it.
    expect(
      isChangedOnlyWhereFolded(
        getExceptionGroupingText({
          projectId: PROJECT,
          primaryEntityId: SERVICE,
          key: keyOf("Invalid SSN 123-45-6789 on file"),
        }),
        getExceptionGroupingText({
          projectId: PROJECT,
          primaryEntityId: SERVICE,
          key: keyOf("Invalid SSN [REDACTED] on file"),
        }),
      ),
    ).toBe(false);
  });
});

/*
 * What the normalizer, grouping v1 and grouping v2 make of messages that hold
 * the numbers v3 folds, pinned as they were before v3: every exception made
 * under v1 or v2 is found by exactly these.
 */
describe("the older grouping versions are unchanged byte for byte", () => {
  const goldens: Array<{
    type: string;
    message: string;
    stackTrace?: string;
    normalizedMessage: string;
    v1: string;
    v2: string;
  }> = [
    {
      type: "PaymentDeclinedError",
      message: "card 4111-1111-1111-1234 declined",
      normalizedMessage: "card 4111-1111-1111-1234 declined",
      v1: "2f0b458b37df347c5499556bf2ad66af6977b04a055061643f6f5bc8e92725c8",
      v2: "43926f80d9aab514b267e6f8ec9494bbba8d9876f1ccad0dd3ce508515902ba2",
    },
    {
      type: "PaymentDeclinedError",
      message: "card 4111 1111 1111 1234 declined",
      normalizedMessage: "card 4111 1111 1111 1234 declined",
      v1: "d88edd47ffad612882c71c1cca1e4dd435ea06cb76d36b04cf93d765e9ddee8e",
      v2: "f87314a0d8c6ca2162d2fc71243c427ba24802139cca8d14cf70ba597fed7f3f",
    },
    {
      type: "InvalidSsnError",
      message: "Invalid SSN 123-45-6789 on file",
      normalizedMessage: "Invalid SSN 123-45-6789 on file",
      v1: "f1e9762cf5fdc9c30bca8cb87f5a6283d92209a9b462aec75e7216062b5b6072",
      v2: "d3df703286f2461e3486d8027b9dff3af738141f2196aff04bee95574dba766d",
    },
    {
      type: "CallError",
      message: "call 555-123-4567 failed",
      normalizedMessage: "call 555-123-4567 failed",
      v1: "2dabf6328f8616cf7672277d106b100a90c6edf1a87e16092dce83a865e7b2e0",
      v2: "b2604d062c87228499f15faf34f35cbca2ca62b7b6fddc16b081c2961a7569a4",
    },
    {
      type: "CallError",
      message: "call (555) 123-4567 failed",
      normalizedMessage: "call (555) 123-4567 failed",
      v1: "a44d28be9d023c162413df607e1c791da051cb15891af3ea53127b23784be577",
      v2: "00747081b2794972fd5db7462df4298fa4b3b33b52700e7dc6265319a3321586",
    },
    {
      type: "CallError",
      message: "call +1 555.123.4567 failed",
      normalizedMessage: "call +1 555.123.4567 failed",
      v1: "d21c5d5b1897766598a813a3047747c672b74e925d4e6c7a82d68235057d7c97",
      v2: "a559083ac50695cdcd72881a7d812880af08d131237c314a64d3e495bd4cb6e1",
    },
    {
      type: "OrderError",
      message: "Order id=1042 not found for ada@example.com",
      normalizedMessage: "Order id=<ID> not found for <EMAIL>",
      v1: "96e77664b4a2010890ba0961d50a5aed8623870c62562fd0c7b1c1cb1451231b",
      v2: "9f676c31d9d8f95dfc7e8d5bd4edf593919f6c5f619784551ca43dbdab5eff87",
    },
    {
      type: "TypeError",
      message: "no cart for 123-45-6789",
      stackTrace: [
        "TypeError: no cart for 123-45-6789",
        "    at checkout (/app/src/cart.ts:10:15)",
        "    at reserve (/app/src/stock.ts:4:3)",
      ].join("\n"),
      normalizedMessage: "no cart for 123-45-6789",
      v1: "a827780b589ac77b976bdebc7884426eafa297999dbb05eeeba4af50d1e65c4d",
      v2: "3e382516a25c68c33b0909db7d0e2770be8b34d36105c951f38b059c196ba946",
    },
  ];

  test.each(goldens)("$message", (golden: (typeof goldens)[number]) => {
    expect(normalizeExceptionText(golden.message)).toBe(
      golden.normalizedMessage,
    );
    expect(
      sha(
        PROJECT +
          SERVICE +
          normalizeExceptionText(golden.message) +
          normalizeExceptionText(golden.stackTrace || "") +
          golden.type,
      ),
    ).toBe(golden.v1);
    expect(
      sha(
        getExceptionGroupingText({
          projectId: PROJECT,
          primaryEntityId: SERVICE,
          key: getExceptionGroupingKey({
            exceptionType: golden.type,
            message: golden.message,
            stackTrace: golden.stackTrace,
          }),
        }),
      ),
    ).toBe(golden.v2);
  });
});
