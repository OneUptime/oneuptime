import EvalCorpus, {
  CorpusEventInput,
  GoldenCaseEvent,
} from "../../../../Server/Utils/AI/Eval/EvalCorpus";
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import { describe, expect, test } from "@jest/globals";

/*
 * Golden-case stat derivation from recorded AIRunEvent trails. Under test:
 * the deterministic evidence stats (citationsMinted / dataBearingToolCalls /
 * toolCallsTotal / toolCallsFailed) computed from synthetic event lists, the
 * shared "data-bearing" definition (the SAME helper the live confidence floor
 * uses — the two must never drift), and the skeletal event projection.
 */

function toolCompleted(data?: {
  rowCount?: number | undefined;
  citationId?: string | undefined;
  toolName?: string | undefined;
  sequence?: number | undefined;
}): CorpusEventInput {
  return {
    sequence: data?.sequence,
    eventType: AIRunEventType.ToolCallCompleted,
    toolName: data?.toolName || "search_logs",
    citationId: data?.citationId,
    resultSummary:
      data?.rowCount === undefined ? undefined : { rowCount: data.rowCount },
  };
}

function toolFailed(toolName?: string): CorpusEventInput {
  return {
    eventType: AIRunEventType.ToolCallFailed,
    toolName: toolName || "query_metrics",
    resultSummary: { errorMessage: "boom" },
  };
}

function lifecycleEvent(eventType: AIRunEventType): CorpusEventInput {
  return { eventType };
}

describe("AIConfidenceSignal.isDataBearingRowCount (the shared definition)", () => {
  test("rowCount > 0 is data-bearing; 0 / null / undefined are not", () => {
    expect(AIConfidenceSignal.isDataBearingRowCount(1)).toBe(true);
    expect(AIConfidenceSignal.isDataBearingRowCount(250)).toBe(true);
    expect(AIConfidenceSignal.isDataBearingRowCount(0)).toBe(false);
    expect(AIConfidenceSignal.isDataBearingRowCount(null)).toBe(false);
    expect(AIConfidenceSignal.isDataBearingRowCount(undefined)).toBe(false);
  });
});

describe("EvalCorpus.deriveConfidenceStats", () => {
  test("an empty trail yields all zeros", () => {
    expect(EvalCorpus.deriveConfidenceStats([])).toEqual({
      citationsMinted: 0,
      dataBearingToolCalls: 0,
      toolCallsTotal: 0,
      toolCallsFailed: 0,
    });
  });

  test("a realistic trail: lifecycle events do not count as tool calls", () => {
    const events: Array<CorpusEventInput> = [
      lifecycleEvent(AIRunEventType.RunStarted),
      lifecycleEvent(AIRunEventType.LlmCallStarted),
      lifecycleEvent(AIRunEventType.LlmCallCompleted),
      toolCompleted({ rowCount: 12, citationId: "C1" }),
      toolCompleted({ rowCount: 0, citationId: "C2" }),
      toolFailed(),
      lifecycleEvent(AIRunEventType.RunCompleted),
    ];

    expect(EvalCorpus.deriveConfidenceStats(events)).toEqual({
      citationsMinted: 2,
      dataBearingToolCalls: 1,
      toolCallsTotal: 3,
      toolCallsFailed: 1,
    });
  });

  test("data-bearing means rowCount > 0 — a successful call with 0 rows (proof of absence) is counted as a call but not as data-bearing", () => {
    const events: Array<CorpusEventInput> = [
      toolCompleted({ rowCount: 0, citationId: "C1" }),
      toolCompleted({ rowCount: 0, citationId: "C2" }),
    ];

    expect(EvalCorpus.deriveConfidenceStats(events)).toEqual({
      citationsMinted: 2,
      dataBearingToolCalls: 0,
      toolCallsTotal: 2,
      toolCallsFailed: 0,
    });
  });

  test("a completed call with NO recorded resultSummary is not data-bearing (unknown is not evidence)", () => {
    expect(EvalCorpus.deriveConfidenceStats([toolCompleted({})])).toEqual({
      citationsMinted: 0,
      dataBearingToolCalls: 0,
      toolCallsTotal: 1,
      toolCallsFailed: 0,
    });
  });

  test("ToolCallStarted is deliberately not counted — a call that never finished has no outcome to score", () => {
    const events: Array<CorpusEventInput> = [
      { eventType: AIRunEventType.ToolCallStarted, toolName: "search_logs" },
      toolCompleted({ rowCount: 3, citationId: "C1" }),
      // Started but the pod died before completion.
      { eventType: AIRunEventType.ToolCallStarted, toolName: "query_metrics" },
    ];

    expect(EvalCorpus.deriveConfidenceStats(events)).toEqual({
      citationsMinted: 1,
      dataBearingToolCalls: 1,
      toolCallsTotal: 1,
      toolCallsFailed: 0,
    });
  });

  test("failed calls count toward the total and the failure count, and mint nothing", () => {
    const events: Array<CorpusEventInput> = [
      toolFailed(),
      toolFailed(),
      toolCompleted({ rowCount: 5, citationId: "C1" }),
    ];

    expect(EvalCorpus.deriveConfidenceStats(events)).toEqual({
      citationsMinted: 1,
      dataBearingToolCalls: 1,
      toolCallsTotal: 3,
      toolCallsFailed: 2,
    });
  });

  test("citationsMinted counts citationId presence wherever it appears (defensive — the engine only mints on tool calls)", () => {
    const events: Array<CorpusEventInput> = [
      { eventType: AIRunEventType.LlmCallCompleted, citationId: "C1" },
      toolCompleted({ rowCount: 1, citationId: "C2" }),
      // Empty string is NOT a minted citation.
      toolCompleted({ rowCount: 1, citationId: "" }),
    ];

    expect(EvalCorpus.deriveConfidenceStats(events).citationsMinted).toBe(2);
  });
});

describe("EvalCorpus.toGoldenCaseEvents", () => {
  test("tool outcomes map to ok true/false; everything else stays undefined", () => {
    const events: Array<GoldenCaseEvent> = EvalCorpus.toGoldenCaseEvents([
      {
        sequence: 0,
        eventType: AIRunEventType.RunStarted,
      },
      {
        sequence: 1,
        eventType: AIRunEventType.ToolCallCompleted,
        toolName: "search_logs",
        resultSummary: { rowCount: 4 },
      },
      {
        sequence: 2,
        eventType: AIRunEventType.ToolCallFailed,
        toolName: "query_metrics",
      },
      {
        sequence: 3,
        eventType: AIRunEventType.RunCompleted,
      },
    ]);

    expect(events).toEqual([
      {
        sequence: 0,
        eventType: "RunStarted",
        toolName: undefined,
        ok: undefined,
      },
      {
        sequence: 1,
        eventType: "ToolCallCompleted",
        toolName: "search_logs",
        ok: true,
      },
      {
        sequence: 2,
        eventType: "ToolCallFailed",
        toolName: "query_metrics",
        ok: false,
      },
      {
        sequence: 3,
        eventType: "RunCompleted",
        toolName: undefined,
        ok: undefined,
      },
    ]);
  });

  test("a missing sequence defaults to 0 (defensive — the engine always writes one)", () => {
    expect(
      EvalCorpus.toGoldenCaseEvents([
        { eventType: AIRunEventType.RunStarted },
      ])[0]!.sequence,
    ).toBe(0);
  });
});
