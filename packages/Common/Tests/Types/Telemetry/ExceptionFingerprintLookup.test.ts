import { describe, expect, test } from "@jest/globals";
import {
  ExceptionOfFingerprint,
  MAX_EXCEPTION_FINGERPRINT_LENGTH,
  MAX_EXCEPTION_FINGERPRINT_LOOKUP,
  readExceptionsOfFingerprints,
} from "../../../Types/Telemetry/ExceptionFingerprintLookup";

/*
 * The answer of POST /telemetry-exception/by-fingerprints, as the Dashboard
 * reads it back: each entry a fingerprint asked about and an exception it
 * counts on, in the answer's order, and nothing it cannot match.
 */

describe("readExceptionsOfFingerprints", () => {
  test("reads each entry, a merged fingerprint's survivor included, in order", () => {
    const read: Array<ExceptionOfFingerprint> = readExceptionsOfFingerprints({
      exceptions: [
        {
          fingerprint: "fp-b",
          telemetryExceptionId: "id-a",
          exceptionType: "TypeError",
          message: "x is not a function",
        },
        {
          fingerprint: "fp-c",
          telemetryExceptionId: "id-c",
          exceptionType: null,
          message: null,
        },
      ],
    });

    expect(read).toEqual([
      {
        fingerprint: "fp-b",
        telemetryExceptionId: "id-a",
        exceptionType: "TypeError",
        message: "x is not a function",
      },
      {
        fingerprint: "fp-c",
        telemetryExceptionId: "id-c",
        exceptionType: null,
        message: null,
      },
    ]);
  });

  test("leaves out what it cannot match: no fingerprint, no exception, not an entry", () => {
    expect(
      readExceptionsOfFingerprints({
        exceptions: [
          { telemetryExceptionId: "id-a" },
          { fingerprint: "fp-b" },
          { fingerprint: "  ", telemetryExceptionId: "id-a" },
          { fingerprint: 7, telemetryExceptionId: "id-a" },
          null,
          "fp-b",
          { fingerprint: " fp-c ", telemetryExceptionId: " id-c ", message: 4 },
        ],
      }),
    ).toEqual([
      {
        fingerprint: "fp-c",
        telemetryExceptionId: "id-c",
        exceptionType: null,
        message: null,
      },
    ]);
  });

  test("an answer that is not one reads as nothing", () => {
    for (const value of [
      null,
      undefined,
      "exceptions",
      7,
      [],
      {},
      { exceptions: "fp-b" },
      { exceptions: { fingerprint: "fp-b" } },
    ]) {
      expect(readExceptionsOfFingerprints(value)).toEqual([]);
    }
  });

  test("a fingerprint ingest writes fits: a SHA-256 in hexadecimal", () => {
    expect(MAX_EXCEPTION_FINGERPRINT_LENGTH).toBeGreaterThanOrEqual(64);
    expect(MAX_EXCEPTION_FINGERPRINT_LOOKUP).toBeGreaterThan(0);
  });
});
