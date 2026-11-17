import StoredCheckEvidence, {
  EVIDENCE_TRUNCATED_FIELD,
} from "../../../Utils/Monitor/StoredCheckEvidence";
import { describe, expect, test } from "@jest/globals";

/*
 * Whether a stored check (createdStateLog, stateChangeLog, statusChangeLog)
 * was cut to its size limit: what View Logs reads to say so (#9189). Rows
 * written before the limit carry no marker, and read as whole.
 */
describe("StoredCheckEvidence.isTrimmed", () => {
  test("is true for a check that carries the marker, as JSON or as its text", () => {
    const log: Record<string, unknown> = {
      responseCode: 200,
      [EVIDENCE_TRUNCATED_FIELD]: true,
    };

    expect(StoredCheckEvidence.isTrimmed(log)).toBe(true);
    expect(StoredCheckEvidence.isTrimmed(JSON.stringify(log))).toBe(true);
  });

  test.each([
    ["a check kept whole", { responseCode: 200 }],
    ["an older row with the whole evaluation", { seriesBreakdown: [{}] }],
    ["a marker that is not true", { [EVIDENCE_TRUNCATED_FIELD]: "true" }],
    ["no log", undefined],
    ["null", null],
    ["text that is not JSON", "No logs for this status event."],
    ["a list", [{ [EVIDENCE_TRUNCATED_FIELD]: true }]],
  ])("is false for %s", (_name: string, log: unknown) => {
    expect(StoredCheckEvidence.isTrimmed(log)).toBe(false);
  });
});
