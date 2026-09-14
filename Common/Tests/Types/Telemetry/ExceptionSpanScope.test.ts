import {
  EXCEPTION_SPAN_SCOPE_MAX_FINGERPRINT_LENGTH,
  EXCEPTION_SPAN_SCOPE_QUERY_KEY,
  parseExceptionSpanScope,
} from "../../../Types/Telemetry/ExceptionSpanScope";
import { describe, expect, test } from "@jest/globals";

const FINGERPRINT: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";

describe("parseExceptionSpanScope", () => {
  test("uses a stable synthetic query key", () => {
    expect(EXCEPTION_SPAN_SCOPE_QUERY_KEY).toBe("exceptionScope");
  });

  test("accepts a fingerprint alone", () => {
    expect(parseExceptionSpanScope({ fingerprint: FINGERPRINT })).toEqual({
      fingerprint: FINGERPRINT,
    });
  });

  test("accepts a fingerprint with a service id, trimming both", () => {
    expect(
      parseExceptionSpanScope({
        fingerprint: `  ${FINGERPRINT} `,
        primaryEntityId: ` ${SERVICE_ID} `,
      }),
    ).toEqual({ fingerprint: FINGERPRINT, primaryEntityId: SERVICE_ID });
  });

  test("accepts a serialized ObjectID for the service", () => {
    expect(
      parseExceptionSpanScope({
        fingerprint: FINGERPRINT,
        primaryEntityId: { _type: "ObjectID", value: SERVICE_ID },
      }),
    ).toEqual({ fingerprint: FINGERPRINT, primaryEntityId: SERVICE_ID });
  });

  test.each([
    ["null", null],
    ["a string", FINGERPRINT],
    ["an array", [FINGERPRINT]],
    ["an object without a fingerprint", { primaryEntityId: SERVICE_ID }],
    ["a numeric fingerprint", { fingerprint: 42 }],
    ["a blank fingerprint", { fingerprint: "   " }],
    [
      "an oversized fingerprint",
      { fingerprint: "a".repeat(EXCEPTION_SPAN_SCOPE_MAX_FINGERPRINT_LENGTH + 1) },
    ],
    [
      "a service id that is not a UUID",
      { fingerprint: FINGERPRINT, primaryEntityId: "' OR 1=1 --" },
    ],
    [
      "a numeric service id",
      { fingerprint: FINGERPRINT, primaryEntityId: 7 },
    ],
  ])("rejects %s", (_name: string, value: unknown) => {
    expect(parseExceptionSpanScope(value)).toBeNull();
  });

  test("treats an empty or null service id as absent", () => {
    expect(
      parseExceptionSpanScope({ fingerprint: FINGERPRINT, primaryEntityId: "" }),
    ).toEqual({ fingerprint: FINGERPRINT });
    expect(
      parseExceptionSpanScope({
        fingerprint: FINGERPRINT,
        primaryEntityId: null,
      }),
    ).toEqual({ fingerprint: FINGERPRINT });
  });

  test("accepts a fingerprint exactly at the length limit", () => {
    const fingerprint: string = "b".repeat(
      EXCEPTION_SPAN_SCOPE_MAX_FINGERPRINT_LENGTH,
    );

    expect(parseExceptionSpanScope({ fingerprint })?.fingerprint).toBe(
      fingerprint,
    );
  });
});
