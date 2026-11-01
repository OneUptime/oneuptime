import { describe, expect, test } from "@jest/globals";
import {
  EXCEPTION_AI_EXPLANATION_VERSION,
  ExceptionAIExplanation,
  ExceptionExplanationCategory,
  ExceptionExplanationConfidence,
  MAX_NEXT_STEPS,
  MAX_ROOT_CAUSE_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_SUSPECT_FRAMES,
  readExceptionAIExplanation,
} from "../../../Types/Telemetry/ExceptionAIExplanation";

/*
 * An explanation is JSON a model wrote, read back by the server as it is
 * written and by the Dashboard as it is shown: every field is checked and
 * bounded, so a long, partial or malformed answer never reaches a page as
 * it came.
 */

describe("reading an explanation", () => {
  test("a complete answer is read as written", () => {
    const explanation: ExceptionAIExplanation | null =
      readExceptionAIExplanation({
        summary: "Checkout fails when the cart is empty.",
        rootCause: "`cart.items` is undefined in `checkout()`.",
        suggestedFix: "Return early when the cart has no items.",
        confidence: "high",
        category: "code",
        suspectFrames: [
          { file: "src/cart.ts", line: 42, function: "checkout" },
        ],
        nextSteps: ["Add a test for an empty cart."],
      });

    expect(explanation).toEqual({
      version: EXCEPTION_AI_EXPLANATION_VERSION,
      summary: "Checkout fails when the cart is empty.",
      rootCause: "`cart.items` is undefined in `checkout()`.",
      suggestedFix: "Return early when the cart has no items.",
      confidence: ExceptionExplanationConfidence.High,
      category: ExceptionExplanationCategory.Code,
      suspectFrames: [{ file: "src/cart.ts", line: 42, function: "checkout" }],
      nextSteps: ["Add a test for an empty cart."],
    });
  });

  test("no summary, or not an object, is no explanation", () => {
    expect(readExceptionAIExplanation({ rootCause: "x" })).toBeNull();
    expect(readExceptionAIExplanation({ summary: "   " })).toBeNull();
    expect(readExceptionAIExplanation(null)).toBeNull();
    expect(readExceptionAIExplanation("summary")).toBeNull();
    expect(readExceptionAIExplanation([{ summary: "x" }])).toBeNull();
  });

  test("an unknown confidence or category reads as low and unknown", () => {
    const explanation: ExceptionAIExplanation | null =
      readExceptionAIExplanation({
        summary: "s",
        confidence: "certain",
        category: "cosmic rays",
      });

    expect(explanation?.confidence).toBe(ExceptionExplanationConfidence.Low);
    expect(explanation?.category).toBe(ExceptionExplanationCategory.Unknown);
  });

  test("long fields are cut, and lists are held to their size", () => {
    const explanation: ExceptionAIExplanation | null =
      readExceptionAIExplanation({
        summary: "s".repeat(10000),
        rootCause: "r".repeat(100000),
        suspectFrames: Array.from({ length: 20 }, (_: unknown, i: number) => {
          return { file: `src/f${i}.ts`, line: i + 1 };
        }),
        nextSteps: Array.from({ length: 20 }, (_: unknown, i: number) => {
          return `step ${i}`;
        }),
      });

    expect(explanation!.summary.length).toBe(MAX_SUMMARY_LENGTH);
    expect(explanation!.summary.endsWith("…")).toBe(true);
    expect(explanation!.rootCause.length).toBe(MAX_ROOT_CAUSE_LENGTH);
    expect(explanation!.suspectFrames).toHaveLength(MAX_SUSPECT_FRAMES);
    expect(explanation!.nextSteps).toHaveLength(MAX_NEXT_STEPS);
  });

  test("a frame without a file, or with a line that is not a line, is cleaned", () => {
    const explanation: ExceptionAIExplanation | null =
      readExceptionAIExplanation({
        summary: "s",
        suspectFrames: [
          { line: 3 },
          "src/a.ts:3",
          { file: "src/b.ts", line: -4, function: "" },
          { file: "src/c.ts", line: 2.5 },
        ],
        nextSteps: ["", 42, "  keep me  "],
      });

    expect(explanation!.suspectFrames).toEqual([
      { file: "src/b.ts" },
      { file: "src/c.ts" },
    ]);
    expect(explanation!.nextSteps).toEqual(["keep me"]);
  });

  test("missing text fields read as empty, not undefined", () => {
    const explanation: ExceptionAIExplanation | null =
      readExceptionAIExplanation({ summary: "s", rootCause: 7 });

    expect(explanation!.rootCause).toBe("");
    expect(explanation!.suggestedFix).toBe("");
    expect(explanation!.suspectFrames).toEqual([]);
    expect(explanation!.nextSteps).toEqual([]);
  });
});
