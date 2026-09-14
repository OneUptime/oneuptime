import { describe, expect, test } from "@jest/globals";
import {
  SPAN_ID_KEYS,
  TRACE_ID_KEYS,
  findCorrelationValue,
  findHexCorrelationValue,
  isEmptyHexId,
  normalizeHexIdFromLabel,
} from "../../FeatureSet/Telemetry/Utils/ProfileCorrelation";
import Dictionary from "Common/Types/Dictionary";

/*
 * Profile → trace correlation key resolution. Shared by the OTLP profiles path
 * and the Pyroscope path so a `trace_id` label means the same thing regardless
 * of wire format. Two behaviours are load-bearing and pinned here:
 *
 *   - findCorrelationValue keeps any non-empty, non-all-zero value (the OTLP
 *     link-table fallback, where the value is already an id), so a malformed
 *     value it accepts CAN shadow a later well-formed one.
 *   - findHexCorrelationValue validates each candidate as a 16/32-char hex id
 *     and SKIPS the ones that fail, so `trace_id: "garbage"` cannot shadow a
 *     well-formed `traceId` label. Labels are operator-typed text, so this path
 *     must never base64-decode a junk tag into bytes that "correlate" with
 *     nothing.
 */

const TRACE_32: string = "0123456789abcdef0123456789abcdef";
const SPAN_16: string = "0123456789abcdef";

describe("ProfileCorrelation.isEmptyHexId", () => {
  test("an empty string is empty", () => {
    expect(isEmptyHexId("")).toBe(true);
  });

  test("all-zeros of any length is the OTel 'unset' convention", () => {
    expect(isEmptyHexId("0")).toBe(true);
    expect(isEmptyHexId("0".repeat(16))).toBe(true);
    expect(isEmptyHexId("0".repeat(32))).toBe(true);
  });

  test("any non-zero digit makes it non-empty", () => {
    expect(isEmptyHexId(TRACE_32)).toBe(false);
    expect(isEmptyHexId("0000000000000001")).toBe(false);
    // isEmptyHexId only screens all-zeros/empty — junk is 'non-empty' here.
    expect(isEmptyHexId("garbage")).toBe(false);
  });
});

describe("ProfileCorrelation.findCorrelationValue", () => {
  test("first usable key in order wins", () => {
    const source: Dictionary<unknown> = {
      traceId: "second",
      "trace.id": "third",
      trace_id: "first",
    };
    // trace_id precedes traceId in TRACE_ID_KEYS.
    expect(findCorrelationValue(source, TRACE_ID_KEYS)).toBe("first");
  });

  test("empty and all-zero values are skipped for the next candidate", () => {
    const source: Dictionary<unknown> = {
      trace_id: "",
      traceId: "0".repeat(32),
      "trace.id": TRACE_32,
    };
    expect(findCorrelationValue(source, TRACE_ID_KEYS)).toBe(TRACE_32);
  });

  test("numbers and bigints are coerced to strings", () => {
    expect(findCorrelationValue({ span_id: 42 }, SPAN_ID_KEYS)).toBe("42");
    expect(
      findCorrelationValue({ span_id: BigInt(9000000000) }, SPAN_ID_KEYS),
    ).toBe("9000000000");
  });

  test("a non-string, non-number value contributes nothing", () => {
    const source: Dictionary<unknown> = {
      trace_id: { nested: true },
      traceId: TRACE_32,
    };
    expect(findCorrelationValue(source, TRACE_ID_KEYS)).toBe(TRACE_32);
  });

  test("returns empty string when no key holds a usable value", () => {
    expect(findCorrelationValue({}, TRACE_ID_KEYS)).toBe("");
    expect(findCorrelationValue({ unrelated: "x" }, TRACE_ID_KEYS)).toBe("");
  });

  test("this lenient path CAN return a malformed value (contrast with hex)", () => {
    // Documents the deliberate difference from findHexCorrelationValue.
    expect(findCorrelationValue({ trace_id: "not-hex" }, TRACE_ID_KEYS)).toBe(
      "not-hex",
    );
  });
});

describe("ProfileCorrelation.normalizeHexIdFromLabel", () => {
  test("lower-cases a valid 32-char trace id", () => {
    expect(normalizeHexIdFromLabel(TRACE_32.toUpperCase())).toBe(TRACE_32);
  });

  test("lower-cases a valid 16-char span id", () => {
    expect(normalizeHexIdFromLabel(SPAN_16.toUpperCase())).toBe(SPAN_16);
  });

  test("trims surrounding whitespace before validating", () => {
    expect(normalizeHexIdFromLabel(`  ${TRACE_32}  `)).toBe(TRACE_32);
  });

  test("rejects wrong-length ids (no partial/loose ids)", () => {
    expect(normalizeHexIdFromLabel("abc")).toBe("");
    expect(normalizeHexIdFromLabel("0".repeat(31))).toBe("");
    expect(normalizeHexIdFromLabel("0".repeat(33))).toBe("");
  });

  test("rejects non-hex characters (never base64-decodes a label)", () => {
    // 32 chars but 'z'/'-' are outside the hex alphabet.
    expect(normalizeHexIdFromLabel("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(
      "",
    );
    expect(normalizeHexIdFromLabel("SGVsbG8gV29ybGQhIQ==")).toBe("");
  });

  test("rejects an all-zero id even at a valid length", () => {
    expect(normalizeHexIdFromLabel("0".repeat(32))).toBe("");
    expect(normalizeHexIdFromLabel("0".repeat(16))).toBe("");
  });
});

describe("ProfileCorrelation.findHexCorrelationValue", () => {
  test("a malformed earlier value does not shadow a valid later one", () => {
    const source: Dictionary<unknown> = {
      trace_id: "garbage",
      traceId: TRACE_32.toUpperCase(),
    };
    // trace_id is scanned first but fails hex validation, so the scan continues.
    expect(findHexCorrelationValue(source, TRACE_ID_KEYS)).toBe(TRACE_32);
  });

  test("first VALID candidate wins and is normalized to lowercase", () => {
    const upper: string = "ABCDEF0123456789ABCDEF0123456789";
    expect(findHexCorrelationValue({ trace_id: upper }, TRACE_ID_KEYS)).toBe(
      upper.toLowerCase(),
    );
  });

  test("coerces a numeric candidate before validating", () => {
    // A number that isn't a 16/32-char hex string yields nothing.
    expect(findHexCorrelationValue({ span_id: 42 }, SPAN_ID_KEYS)).toBe("");
  });

  test("returns empty string when every candidate is invalid or absent", () => {
    expect(findHexCorrelationValue({}, SPAN_ID_KEYS)).toBe("");
    expect(
      findHexCorrelationValue(
        { span_id: "nope", spanId: "0".repeat(16) },
        SPAN_ID_KEYS,
      ),
    ).toBe("");
  });
});
