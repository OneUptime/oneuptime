import { getJavaScriptStepOutcome } from "../../../Utils/JavaScriptSandbox/JavaScriptStepResult";
import {
  TRUNCATED_OUTPUT_MARKER,
  truncateToBytes,
} from "../../../Utils/OutputTruncation";

/*
 * One reading of a JavaScript step's result, whichever process ran it, so a
 * step reports the same on a project's Runner (in its process) and on a
 * global Runner (in a process of its own).
 */

describe("getJavaScriptStepOutcome", () => {
  test("logged lines, then the returned text", () => {
    expect(
      getJavaScriptStepOutcome(
        {
          logMessages: ["one", "two"],
          returnValue: "done",
          capturedMetrics: [],
        },
        1_000,
      ),
    ).toEqual({ success: true, output: "one\ntwo\nReturn: done" });
  });

  test("a returned object as indented JSON", () => {
    expect(
      getJavaScriptStepOutcome(
        { logMessages: [], returnValue: { a: 1 }, capturedMetrics: [] },
        1_000,
      ).output,
    ).toBe('Return: {\n  "a": 1\n}');
  });

  test("nothing returned, nothing added", () => {
    expect(
      getJavaScriptStepOutcome(
        { logMessages: ["only"], returnValue: undefined, capturedMetrics: [] },
        1_000,
      ),
    ).toEqual({ success: true, output: "only" });
  });

  test("a script that threw fails with its message, and keeps its lines", () => {
    expect(
      getJavaScriptStepOutcome(
        {
          logMessages: ["before"],
          returnValue: undefined,
          capturedMetrics: [],
          scriptError: new Error("Script execution timed out."),
        },
        1_000,
      ),
    ).toEqual({
      success: false,
      output: "before",
      errorMessage: "Script execution timed out.",
    });
  });

  test("output past the limit is cut, and says so", () => {
    const output: string = getJavaScriptStepOutcome(
      {
        logMessages: ["x".repeat(50)],
        returnValue: undefined,
        capturedMetrics: [],
      },
      10,
    ).output;

    expect(output).toBe(`${"x".repeat(10)}${TRUNCATED_OUTPUT_MARKER}`);
  });
});

describe("truncateToBytes", () => {
  test("text within the limit is left as it is", () => {
    expect(truncateToBytes("short", 10)).toBe("short");
    expect(truncateToBytes("exactly10!", 10)).toBe("exactly10!");
  });

  test("counts bytes of UTF-8, not characters", () => {
    // Each é is two bytes.
    expect(truncateToBytes("éééé", 4)).toBe(`éé${TRUNCATED_OUTPUT_MARKER}`);
  });
});
