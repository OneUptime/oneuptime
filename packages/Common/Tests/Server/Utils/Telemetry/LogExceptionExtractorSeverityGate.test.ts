import LogExceptionExtractor, {
  ExtractedLogException,
} from "../../../../Server/Utils/Telemetry/LogExceptionExtractor";
import { describe, expect, test } from "@jest/globals";

/*
 * The body scan (Path B) runs only for ERROR (17-20) and FATAL (21-24) logs.
 * GH#3978: the gate used to be `severityNumber < 17 -> skip`, and `NaN < 17`
 * is false, so a NaN severity - which is what OtelLogsIngestService produced
 * for every OTLP severity name it did not know, e.g. SEVERITY_NUMBER_WARN2 -
 * was scanned as if it were an error. Ingest now never produces NaN, but the
 * gate must not depend on that: anything that is not a finite ERROR/FATAL
 * number skips the scan.
 */

const JAVA_TRACE: string = [
  "java.lang.IllegalStateException: gate probe",
  "\tat com.example.billing.Invoice.settle(Invoice.java:42)",
  "\tat com.example.billing.Main.main(Main.java:7)",
].join("\n");

function scan(severityNumber: number): ExtractedLogException | null {
  return LogExceptionExtractor.extractFromLogRecord({
    body: JAVA_TRACE,
    attributes: {},
    severityNumber,
    hasTraceAndSpan: false,
  });
}

describe("LogExceptionExtractor — Path B severity gate", () => {
  const everySeverityNumber: Array<[number, boolean]> = [];
  for (let severityNumber: number = 0; severityNumber <= 24; severityNumber++) {
    everySeverityNumber.push([severityNumber, severityNumber >= 17]);
  }

  test.each(everySeverityNumber)(
    "severityNumber %i: body scanned = %s",
    (severityNumber: number, scanned: boolean) => {
      const extracted: ExtractedLogException | null = scan(severityNumber);
      if (scanned) {
        expect(extracted).not.toBeNull();
        expect(extracted!.exceptionType).toBe(
          "java.lang.IllegalStateException",
        );
        expect(extracted!.message).toBe("gate probe");
      } else {
        expect(extracted).toBeNull();
      }
    },
  );

  test.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["past FATAL4 (25)", 25],
    ["fractional (17.5)", 17.5],
    ["negative (-17)", -17],
  ])("%s is not scanned", (_label: string, severityNumber: number) => {
    expect(scan(severityNumber)).toBeNull();
  });

  test.each([
    ["an enum name", "SEVERITY_NUMBER_ERROR2"],
    ["a numeric string", "18"],
    ["undefined", undefined],
    ["null", null],
  ])(
    "a non-number that reaches it untyped (%s) is not scanned",
    (_label: string, severityNumber: unknown) => {
      expect(scan(severityNumber as number)).toBeNull();
    },
  );

  test("Path A (explicit exception.* attributes) is not gated by severity", () => {
    const extracted: ExtractedLogException | null =
      LogExceptionExtractor.extractFromLogRecord({
        body: "",
        attributes: {
          "exception.type": "TimeoutError",
          "exception.message": "upstream timed out",
        },
        severityNumber: NaN,
        hasTraceAndSpan: false,
      });
    expect(extracted).not.toBeNull();
    expect(extracted!.exceptionType).toBe("TimeoutError");
  });
});
