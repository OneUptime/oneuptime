import {
  MAX_TRACE_STEPS,
  MAX_TRACE_VALUE_LENGTH,
  TRUNCATED_VALUE_SUFFIX,
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  appendTraceStep,
  emptyTrace,
  getStepPortTitle,
  parseTrace,
  truncateTraceValue,
  truncateTraceValues,
} from "../../../Types/Workflow/StepTrace";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

type MakeEntryFunction = (
  overrides?: Partial<WorkflowStepTraceEntry> | undefined,
) => WorkflowStepTraceEntry;

const makeEntry: MakeEntryFunction = (
  overrides?: Partial<WorkflowStepTraceEntry> | undefined,
): WorkflowStepTraceEntry => {
  return {
    componentId: "api-get-1",
    metadataId: "api-get",
    title: "API Get",
    status: WorkflowStepStatus.Success,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationInMs: 1000,
    argumentValues: {},
    returnValues: {},
    executedPort: "success",
    ...overrides,
  };
};

describe("truncateTraceValue", () => {
  test("leaves a short string alone", () => {
    expect(truncateTraceValue("hello")).toBe("hello");
  });

  test("leaves a string exactly at the limit alone", () => {
    const atLimit: string = "a".repeat(MAX_TRACE_VALUE_LENGTH);

    expect(truncateTraceValue(atLimit)).toBe(atLimit);
  });

  test("cuts a string past the limit and says so", () => {
    const tooLong: string = "a".repeat(MAX_TRACE_VALUE_LENGTH + 100);
    const result: string = truncateTraceValue(tooLong) as string;

    expect(result.endsWith(TRUNCATED_VALUE_SUFFIX)).toBe(true);
    expect(result.length).toBe(
      MAX_TRACE_VALUE_LENGTH + TRUNCATED_VALUE_SUFFIX.length,
    );
  });

  test("leaves small structured values as structure, not text", () => {
    const value: JSONObject = { a: 1, b: "two" };

    expect(truncateTraceValue(value)).toEqual(value);
  });

  /*
   * Half a serialized object looks like data but cannot be parsed, so a large
   * object is replaced wholesale rather than cut in the middle.
   */
  test("replaces a large object with cut text rather than half an object", () => {
    const big: JSONObject = { body: "x".repeat(MAX_TRACE_VALUE_LENGTH + 500) };
    const result: unknown = truncateTraceValue(big);

    expect(typeof result).toBe("string");
    expect((result as string).endsWith(TRUNCATED_VALUE_SUFFIX)).toBe(true);
  });

  test("leaves primitives of other types alone", () => {
    expect(truncateTraceValue(42)).toBe(42);
    expect(truncateTraceValue(true)).toBe(true);
    expect(truncateTraceValue(null)).toBeNull();
  });

  test("says so rather than throwing on a circular value", () => {
    const circular: JSONObject = {};
    (circular as unknown as { self: unknown }).self = circular;

    expect(truncateTraceValue(circular)).toBe("[value could not be recorded]");
  });

  test("keeps a large array as text rather than dropping it", () => {
    const bigArray: Array<string> = new Array(2000).fill("abcdefghij");
    const result: unknown = truncateTraceValue(
      bigArray as unknown as JSONObject,
    );

    expect(typeof result).toBe("string");
  });
});

describe("truncateTraceValues", () => {
  test("truncates each value independently", () => {
    const values: JSONObject = {
      small: "ok",
      big: "x".repeat(MAX_TRACE_VALUE_LENGTH + 10),
    };

    const result: JSONObject = truncateTraceValues(values);

    expect(result["small"]).toBe("ok");
    expect((result["big"] as string).endsWith(TRUNCATED_VALUE_SUFFIX)).toBe(
      true,
    );
  });

  test("copes with an empty object", () => {
    expect(truncateTraceValues({})).toEqual({});
  });

  test("keeps a redaction marker exactly as it is", () => {
    expect(truncateTraceValues({ token: "[REDACTED]" })["token"]).toBe(
      "[REDACTED]",
    );
  });
});

describe("appendTraceStep", () => {
  test("adds a step to an empty trace", () => {
    const trace: WorkflowStepTrace = appendTraceStep(emptyTrace(), makeEntry());

    expect(trace.steps).toHaveLength(1);
    expect(trace.truncated).toBeFalsy();
  });

  test("keeps steps in the order they ran", () => {
    let trace: WorkflowStepTrace = emptyTrace();

    trace = appendTraceStep(trace, makeEntry({ componentId: "first" }));
    trace = appendTraceStep(trace, makeEntry({ componentId: "second" }));

    expect(
      trace.steps.map((step: WorkflowStepTraceEntry) => {
        return step.componentId;
      }),
    ).toEqual(["first", "second"]);
  });

  test("does not mutate the trace it was given", () => {
    const original: WorkflowStepTrace = emptyTrace();

    appendTraceStep(original, makeEntry());

    expect(original.steps).toHaveLength(0);
  });

  test("holds exactly the cap without flagging truncation", () => {
    let trace: WorkflowStepTrace = emptyTrace();

    for (let i: number = 0; i < MAX_TRACE_STEPS; i++) {
      trace = appendTraceStep(trace, makeEntry({ componentId: `step-${i}` }));
    }

    expect(trace.steps).toHaveLength(MAX_TRACE_STEPS);
    expect(trace.truncated).toBeFalsy();
  });

  /*
   * A failed run is read from the end — the step that broke it is the last
   * one — so the cap drops the oldest steps, not the newest.
   */
  test("drops the oldest steps past the cap and keeps the newest", () => {
    let trace: WorkflowStepTrace = emptyTrace();

    for (let i: number = 0; i < MAX_TRACE_STEPS + 5; i++) {
      trace = appendTraceStep(trace, makeEntry({ componentId: `step-${i}` }));
    }

    expect(trace.steps).toHaveLength(MAX_TRACE_STEPS);
    expect(trace.truncated).toBe(true);
    expect(trace.steps[trace.steps.length - 1]?.componentId).toBe(
      `step-${MAX_TRACE_STEPS + 4}`,
    );
    expect(trace.steps[0]?.componentId).toBe("step-5");
  });

  test("stays flagged as truncated once it has been", () => {
    let trace: WorkflowStepTrace = emptyTrace();

    for (let i: number = 0; i < MAX_TRACE_STEPS + 2; i++) {
      trace = appendTraceStep(trace, makeEntry());
    }

    trace = appendTraceStep(trace, makeEntry());

    expect(trace.truncated).toBe(true);
  });
});

describe("parseTrace", () => {
  test("reads back what was written", () => {
    const trace: WorkflowStepTrace = appendTraceStep(
      emptyTrace(),
      makeEntry({ componentId: "log-1" }),
    );

    const roundTripped: WorkflowStepTrace = parseTrace(
      JSON.parse(JSON.stringify(trace)),
    );

    expect(roundTripped.steps).toHaveLength(1);
    expect(roundTripped.steps[0]?.componentId).toBe("log-1");
  });

  test("carries the truncated flag back", () => {
    expect(parseTrace({ steps: [], truncated: true }).truncated).toBe(true);
  });

  /*
   * Rows written before the column existed, or by an older build, must read as
   * an empty trace so the viewer falls back to the raw log instead of throwing.
   */
  test("treats anything that is not a trace as empty", () => {
    expect(parseTrace(null).steps).toEqual([]);
    expect(parseTrace(undefined as never).steps).toEqual([]);
    expect(parseTrace("nonsense").steps).toEqual([]);
    expect(parseTrace(42).steps).toEqual([]);
    expect(parseTrace([]).steps).toEqual([]);
    expect(parseTrace({}).steps).toEqual([]);
    expect(parseTrace({ steps: "not an array" }).steps).toEqual([]);
  });

  test("an empty trace is not flagged truncated", () => {
    expect(parseTrace(null).truncated).toBeFalsy();
  });

  test("reads back everything a step now records", () => {
    const entry: WorkflowStepTraceEntry = makeEntry({
      componentId: "if-else-1",
      executedPort: "no",
      executedPortTitle: "No",
      executedPortDescription: "Runs when it does not hold.",
      nextSteps: [{ componentId: "log-1", title: "Log" }],
      argumentNames: [{ id: "input-1", name: "Input 1" }],
      returnValueNames: [],
      argumentTemplates: { "input-1": "{{local.variables.env}}" },
      warnings: [
        {
          message: "did not resolve",
          argumentId: "input-1",
          unresolvedReferences: ["{{local.variables.env}}"],
        },
      ],
    });

    const roundTripped: WorkflowStepTrace = parseTrace(
      JSON.parse(JSON.stringify(appendTraceStep(emptyTrace(), entry))),
    );

    expect(roundTripped.steps[0]).toEqual(entry);
  });

  test("carries back that the run tested one step", () => {
    expect(
      parseTrace({ steps: [], singleStepComponentId: "if-else-1" })
        .singleStepComponentId,
    ).toBe("if-else-1");
  });

  test("carries back why the run stopped", () => {
    expect(
      parseTrace({ steps: [], runErrorMessage: "timed out" }).runErrorMessage,
    ).toBe("timed out");
  });

  test("carries back when a sleeping run carries on", () => {
    expect(
      parseTrace({ steps: [], resumesAt: "2026-10-01T10:45:00.000Z" })
        .resumesAt,
    ).toBe("2026-10-01T10:45:00.000Z");
  });

  test("ignores run details that are not text", () => {
    const trace: WorkflowStepTrace = parseTrace({
      steps: [],
      singleStepComponentId: 42,
      runErrorMessage: { not: "text" },
      resumesAt: 1700000000000,
    });

    expect(trace.singleStepComponentId).toBeUndefined();
    expect(trace.runErrorMessage).toBeUndefined();
    expect(trace.resumesAt).toBeUndefined();
  });

  test("ignores a resume time that is not a time", () => {
    expect(
      parseTrace({ steps: [], resumesAt: "tomorrow-ish" }).resumesAt,
    ).toBeUndefined();
  });

  test("an older trace has neither", () => {
    const trace: WorkflowStepTrace = parseTrace({
      steps: [makeEntry()],
    } as never);

    expect(trace.singleStepComponentId).toBeUndefined();
    expect(trace.runErrorMessage).toBeUndefined();
  });

  /*
   * An entry that is not an object cannot be drawn as a step, and reading it
   * as one is what would throw in the viewer.
   */
  test("drops entries that are not steps", () => {
    const trace: WorkflowStepTrace = parseTrace({
      steps: [null, makeEntry({ componentId: "kept" }), "junk", 7, []],
    } as never);

    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]?.componentId).toBe("kept");
  });
});

describe("getStepPortTitle", () => {
  test("is the port's title when the trace kept it", () => {
    expect(
      getStepPortTitle({
        executedPort: "success",
        executedPortTitle: "Execute",
      }),
    ).toBe("Execute");
  });

  /*
   * Every built-in port's title is its id with a capital, so an older trace
   * still names the port the way the canvas did.
   */
  test("reads the id as a title in a trace that predates titles", () => {
    expect(getStepPortTitle({ executedPort: "no" })).toBe("No");
    expect(getStepPortTitle({ executedPort: "yes" })).toBe("Yes");
    expect(getStepPortTitle({ executedPort: "error" })).toBe("Error");
    expect(getStepPortTitle({ executedPort: "out" })).toBe("Out");
    expect(getStepPortTitle({ executedPort: "request-failed" })).toBe(
      "Request failed",
    );
  });

  test("ignores an empty title", () => {
    expect(
      getStepPortTitle({ executedPort: "no", executedPortTitle: "" }),
    ).toBe("No");
  });

  test("is null when the step took no port", () => {
    expect(getStepPortTitle({ executedPort: null })).toBeNull();
    expect(getStepPortTitle({ executedPort: "" })).toBeNull();
    expect(getStepPortTitle({ executedPort: "  " })).toBeNull();
    expect(
      getStepPortTitle({ executedPort: undefined as unknown as null }),
    ).toBeNull();
  });
});
