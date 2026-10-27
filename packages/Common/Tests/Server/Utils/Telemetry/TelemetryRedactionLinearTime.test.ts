import ToolResultSerializer from "../../../../Server/Utils/AI/Toolbox/Serializer";
import {
  normalizeExceptionText,
  sanitizeExceptionMessage,
} from "../../../../Server/Utils/Telemetry/ExceptionSanitizer";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * REDACTION READS INGESTED TEXT IN TIME IN LINE WITH ITS LENGTH.
 *
 * Both of these run at ingest, over text a project's own application writes:
 *
 *  - ToolResultSerializer.redact scrubs AI tool results before they reach the
 *    model (and the LlmLog preview);
 *  - normalizeExceptionText fingerprints every exception, and
 *    sanitizeExceptionMessage scrubs the message that reaches an LLM, a PR or
 *    a commit.
 *
 * The address patterns they use are bounded to the sizes a real address has,
 * and a token is looked for once per run of the characters it is made of
 * (JsonWebTokenRedactionLinearTime has the token's own cases), so a long body
 * - even one built to be awkward - is read once in well under two seconds,
 * while a real address or token is still found and redacted exactly as
 * before.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const WORST_CASES: Array<[string, string]> = [
  ["letters", repeat("a", LENGTH)],
  ["letters and dots", repeat("a.", LENGTH)],
  ["an address then dotted labels", repeat("a@a.", LENGTH)],
  ["dots then a tail", repeat(".", LENGTH) + "-.aa"],
  [
    "dotted capitals and hyphens",
    repeat("A.", LENGTH / 2) + repeat("-.", LENGTH / 2),
  ],
  ["a token header over and over", repeat("eyJ", LENGTH)],
  ["a token header with separators", repeat("-eyJ-", LENGTH)],
  ["a token header run together", repeat("eyJeeeeeeeeee", LENGTH)],
];

describe("ToolResultSerializer.redact reads in time in line with length", () => {
  test.each(WORST_CASES)(
    "decides %s quickly",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          ToolResultSerializer.redact(text);
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  test("still redacts a real address and a real token", () => {
    const jwt: string =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const redacted: string = ToolResultSerializer.redact(
      `mail bob.smith@example.com token ${jwt} done`,
    ).text;

    expect(redacted).toContain("[redacted-email]");
    expect(redacted).toContain("[redacted-jwt]");
    expect(redacted).not.toContain("bob.smith@example.com");
    expect(redacted).not.toContain(
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
  });
});

describe("normalizeExceptionText reads in time in line with length", () => {
  test.each(WORST_CASES)(
    "decides %s quickly",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          normalizeExceptionText(text);
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  test("still fingerprints a real address and a real token the same way", () => {
    const jwt: string =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJ";
    expect(
      normalizeExceptionText("send to jane.roe@example.co.uk failed"),
    ).toContain("<EMAIL>");
    expect(normalizeExceptionText(`bearer ${jwt} rejected`)).toContain("<JWT>");
  });
});

describe("sanitizeExceptionMessage reads in time in line with length", () => {
  test.each(WORST_CASES)(
    "decides %s quickly",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          sanitizeExceptionMessage(text);
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});
