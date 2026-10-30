import { describe, expect, test } from "@jest/globals";
import {
  DuplicateVerdictKind,
  MAX_SIMILAR_EXCEPTIONS,
  MAX_SIMILAR_MESSAGE_LENGTH,
  readDuplicateVerdicts,
  readSimilarExceptions,
  SimilarExceptionReason,
} from "../../../Types/Telemetry/SimilarExceptions";

/*
 * Similar exceptions and OneUptime AI's verdicts as the Dashboard reads
 * them back: checked, bounded, each exception once, at most five.
 */

describe("readSimilarExceptions", () => {
  test("reads each similar exception, checked and bounded", () => {
    expect(
      readSimilarExceptions([
        {
          telemetryExceptionId: "a",
          exceptionType: "TypeError",
          message: "m".repeat(MAX_SIMILAR_MESSAGE_LENGTH + 20),
          occurrenceCount: 12.7,
          lastSeenAt: "2026-10-30T12:00:00.000Z",
          isResolved: true,
          isArchived: "yes",
          reason: SimilarExceptionReason.SameMessage,
        },
      ]),
    ).toEqual([
      {
        telemetryExceptionId: "a",
        exceptionType: "TypeError",
        message: `${"m".repeat(MAX_SIMILAR_MESSAGE_LENGTH - 1)}…`,
        occurrenceCount: 12,
        lastSeenAt: "2026-10-30T12:00:00.000Z",
        isResolved: true,
        isArchived: false,
        reason: SimilarExceptionReason.SameMessage,
      },
    ]);
  });

  test("leaves out what it cannot show, each exception once, at most five", () => {
    const read: Array<{ telemetryExceptionId: string }> = readSimilarExceptions(
      [
        { telemetryExceptionId: "a", reason: "same-message" },
        { telemetryExceptionId: "a", reason: "same-message" },
        { telemetryExceptionId: "b", reason: "looks-alike" },
        { telemetryExceptionId: 3, reason: "same-message" },
        {
          telemetryExceptionId: "c",
          reason: "similar-message",
          lastSeenAt: "never",
        },
        ...Array.from({ length: 10 }, (_value: unknown, index: number) => {
          return {
            telemetryExceptionId: `d${index}`,
            reason: "same-code-location",
          };
        }),
      ],
    );

    expect(
      read.map((entry: { telemetryExceptionId: string }) => {
        return entry.telemetryExceptionId;
      }),
    ).toEqual(["a", "c", "d0", "d1", "d2"]);
    expect(read).toHaveLength(MAX_SIMILAR_EXCEPTIONS);
    expect(readSimilarExceptions("nope")).toEqual([]);
  });
});

describe("readDuplicateVerdicts", () => {
  test("reads each verdict, a verdict it does not know or a second one about an exception left out", () => {
    expect(
      readDuplicateVerdicts([
        {
          telemetryExceptionId: "a",
          verdict: "duplicate",
          reason: " Same frame. ",
        },
        { telemetryExceptionId: "a", verdict: "different", reason: "x" },
        { telemetryExceptionId: "b", verdict: "maybe", reason: "x" },
        { telemetryExceptionId: "c", verdict: "related" },
      ]),
    ).toEqual([
      {
        telemetryExceptionId: "a",
        verdict: DuplicateVerdictKind.Duplicate,
        reason: "Same frame.",
      },
      {
        telemetryExceptionId: "c",
        verdict: DuplicateVerdictKind.Related,
        reason: "",
      },
    ]);
    expect(readDuplicateVerdicts(null)).toEqual([]);
  });
});
