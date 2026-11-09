import { describe, expect, test } from "@jest/globals";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";
import LlmCallCountingUtil, {
  LlmCountableCall,
  LlmCountedFigures,
  LlmCountedTotals,
} from "../../../Utils/Telemetry/LlmCallCounting";

/*
 * EACH MODEL CALL COUNTED ONCE.
 *
 * An agent run that carries its calls' totals, and two instrumentations of
 * one call (LangChain's span over the OpenAI SDK's), put the same tokens and
 * cost on more than one span. These pin the rule that leaves the repeats out
 * - a span whose direct child reports the figure, an agent run with a call
 * inside its time in the same trace - and that keeps an agent run's own
 * figures when nothing inside it reports them. The server applies the same
 * rule in ClickHouse (LlmCountedCallsSql), which
 * App/Tests/Telemetry/LlmUsageCountingClickhouse.test.ts runs against these
 * same shapes.
 */

const TRACE: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const OTHER_TRACE: string = "0af7651916cd43dd8448eb211c80319c";

function call(
  spanId: string,
  overrides: Partial<LlmCountableCall> = {},
): LlmCountableCall {
  return {
    spanId: spanId,
    traceId: TRACE,
    parentSpanId: "",
    kind: LlmCallKind.Answer,
    startMs: 1000,
    endMs: 2000,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ...overrides,
  };
}

function counted(
  calls: Array<LlmCountableCall>,
): Record<string, LlmCountedFigures> {
  const result: Record<string, LlmCountedFigures> = {};

  for (const [key, figures] of LlmCallCountingUtil.getCounted(calls)) {
    result[key.split("/")[1]!] = figures;
  }

  return result;
}

const BOTH: LlmCountedFigures = { tokens: true, cost: true };
const NEITHER: LlmCountedFigures = { tokens: false, cost: false };

describe("a call on its own", () => {
  test("counts its tokens and its cost", () => {
    expect(
      counted([call("a1", { inputTokens: 10, outputTokens: 5, costUsd: 1 })]),
    ).toEqual({ a1: BOTH });
  });

  test("the totals of calls that wrap nothing are their sum", () => {
    expect(
      LlmCallCountingUtil.countTotals([
        call("a1", { inputTokens: 10, outputTokens: 5, costUsd: 1 }),
        call("a2", { inputTokens: 20, outputTokens: 5, costUsd: 2 }),
      ]),
    ).toEqual({
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
      costUsd: 3,
    });
  });

  test("a span that names itself as its parent wraps nothing", () => {
    expect(
      counted([
        call("a1", { parentSpanId: "a1", inputTokens: 10, costUsd: 1 }),
      ]),
    ).toEqual({ a1: BOTH });
  });
});

describe("(a) a span whose direct child reports the figure", () => {
  /*
   * OpenInference's or OpenLLMetry's LangChain span over the OpenAI SDK's
   * span: both report the call's tokens and cost.
   */
  test("two instrumentations of one call count once, from the inner span", () => {
    const calls: Array<LlmCountableCall> = [
      call("chain", {
        kind: LlmCallKind.Other,
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.5,
      }),
      call("sdk", {
        parentSpanId: "chain",
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.5,
      }),
    ];

    expect(counted(calls)).toEqual({ chain: NEITHER, sdk: BOTH });
    expect(LlmCallCountingUtil.countTotals(calls)).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      costUsd: 0.5,
    });
  });

  test("tokens and cost are decided apart: a child with tokens and no price leaves the parent's cost", () => {
    expect(
      counted([
        call("wrapper", {
          kind: LlmCallKind.Other,
          inputTokens: 100,
          costUsd: 0.25,
        }),
        call("inner", { parentSpanId: "wrapper", inputTokens: 100 }),
      ]),
    ).toEqual({
      wrapper: { tokens: false, cost: true },
      inner: BOTH,
    });
  });

  test("a child that reports nothing covers nothing", () => {
    expect(
      counted([
        call("parent", { inputTokens: 100, costUsd: 0.25 }),
        call("child", { parentSpanId: "parent", kind: LlmCallKind.Tool }),
      ]),
    ).toEqual({ parent: BOTH, child: BOTH });
  });

  test("a child in another trace is not this span's child", () => {
    expect(
      counted([
        call("parent", { inputTokens: 100 }),
        call("child", {
          traceId: OTHER_TRACE,
          parentSpanId: "parent",
          inputTokens: 100,
        }),
      ]),
    ).toEqual({ parent: BOTH, child: BOTH });
  });

  // Rows stored before the call kind was recorded are never agent runs.
  test("a span of no kind is covered by its direct children only", () => {
    // A call deeper inside its time: not a run, so kept.
    expect(
      counted([
        call("old", { kind: undefined, inputTokens: 100, endMs: 9000 }),
        call("tool", { parentSpanId: "old", kind: LlmCallKind.Tool }),
        call("deep", {
          parentSpanId: "tool",
          inputTokens: 60,
          startMs: 3000,
        }),
      ])["old"],
    ).toEqual(BOTH);

    // A direct child reporting tokens: its tokens are the child's.
    expect(
      counted([
        call("old", { kind: undefined, inputTokens: 100, endMs: 9000 }),
        call("direct", { parentSpanId: "old", inputTokens: 40 }),
      ])["old"],
    ).toEqual({ tokens: false, cost: true });
  });
});

describe("(b) an agent run with a call inside its time", () => {
  /*
   * Pydantic AI's agent run and Strands' invoke_agent carry their calls'
   * totals, with tool spans between the run and the calls.
   */
  test("the run's repeat of its calls' figures is left out, through spans in between", () => {
    const calls: Array<LlmCountableCall> = [
      call("run", {
        kind: LlmCallKind.Agent,
        startMs: 1000,
        endMs: 9000,
        inputTokens: 300,
        outputTokens: 30,
        costUsd: 0.3,
      }),
      call("tool", {
        parentSpanId: "run",
        kind: LlmCallKind.Tool,
        startMs: 1500,
        endMs: 8000,
      }),
      call("first", {
        parentSpanId: "tool",
        startMs: 2000,
        inputTokens: 100,
        outputTokens: 10,
        costUsd: 0.1,
      }),
      call("second", {
        parentSpanId: "tool",
        startMs: 5000,
        inputTokens: 200,
        outputTokens: 20,
        costUsd: 0.2,
      }),
    ];

    // The tool span reports nothing: counted or not, it adds nothing.
    expect(counted(calls)).toEqual({
      run: NEITHER,
      tool: NEITHER,
      first: BOTH,
      second: BOTH,
    });
    expect(LlmCallCountingUtil.countTotals(calls).costUsd).toBeCloseTo(0.3, 10);
    expect(LlmCallCountingUtil.countTotals(calls).inputTokens).toBe(300);
  });

  // A remote agent, or a framework that records only the run.
  test("a run with no call inside that reports figures keeps its own", () => {
    expect(
      counted([
        call("run", {
          kind: LlmCallKind.Agent,
          endMs: 9000,
          inputTokens: 300,
          costUsd: 0.3,
        }),
        call("tool", {
          parentSpanId: "run",
          kind: LlmCallKind.Tool,
          startMs: 1500,
        }),
      ]),
    ).toEqual({ run: BOTH, tool: BOTH });
  });

  test("a run whose calls report tokens but no cost keeps its cost", () => {
    expect(
      counted([
        call("run", {
          kind: LlmCallKind.Agent,
          endMs: 9000,
          inputTokens: 300,
          costUsd: 0.3,
        }),
        call("inner", { startMs: 2000, inputTokens: 300 }),
      ]),
    ).toEqual({ run: { tokens: false, cost: true }, inner: BOTH });
  });

  test("a call that starts after the run ended was not made by it", () => {
    expect(
      counted([
        call("run", {
          kind: LlmCallKind.Agent,
          startMs: 1000,
          endMs: 2000,
          inputTokens: 300,
        }),
        call("later", { startMs: 2001, inputTokens: 100 }),
        call("before", { startMs: 999, inputTokens: 100 }),
      ]),
    ).toEqual({ run: BOTH, later: BOTH, before: BOTH });
  });

  test("a call at the run's very start or end is inside it", () => {
    expect(
      counted([
        call("run", {
          kind: LlmCallKind.Agent,
          startMs: 1000,
          endMs: 2000,
          inputTokens: 300,
        }),
        call("edge", { startMs: 2000, inputTokens: 100 }),
      ])["run"],
    ).toEqual({ tokens: false, cost: true });
  });

  test("a call in another trace is another request's", () => {
    expect(
      counted([
        call("run", {
          kind: LlmCallKind.Agent,
          endMs: 9000,
          inputTokens: 300,
        }),
        call("elsewhere", {
          traceId: OTHER_TRACE,
          startMs: 2000,
          inputTokens: 100,
        }),
      ])["run"],
    ).toEqual(BOTH);
  });

  // Another agent run inside is not a model call, so (b) looks past it.
  test("nested runs: only the calls count", () => {
    const calls: Array<LlmCountableCall> = [
      call("outer", {
        kind: LlmCallKind.Agent,
        endMs: 9000,
        inputTokens: 300,
        costUsd: 0.3,
      }),
      call("inner-run", {
        kind: LlmCallKind.Agent,
        parentSpanId: "outer",
        startMs: 1500,
        endMs: 8000,
        inputTokens: 300,
        costUsd: 0.3,
      }),
      call("model", {
        parentSpanId: "inner-run",
        startMs: 2000,
        inputTokens: 300,
        costUsd: 0.3,
      }),
    ];

    expect(counted(calls)).toEqual({
      outer: NEITHER,
      "inner-run": NEITHER,
      model: BOTH,
    });
    expect(LlmCallCountingUtil.countTotals(calls).inputTokens).toBe(300);
  });

  test("a run whose only inner span is another run that reports nothing keeps its own", () => {
    expect(
      counted([
        call("outer", {
          kind: LlmCallKind.Agent,
          endMs: 9000,
          inputTokens: 300,
        }),
        call("inner-run", {
          kind: LlmCallKind.Agent,
          parentSpanId: "outer",
          startMs: 1500,
        }),
      ])["outer"],
    ).toEqual(BOTH);
  });
});

describe("what a figure is", () => {
  test("only a positive, finite number reports a figure", () => {
    for (const value of [0, -5, NaN, Infinity]) {
      expect(
        LlmCallCountingUtil.carriesTokens(
          call("x", { inputTokens: value, outputTokens: value }),
        ),
      ).toBe(false);
      expect(
        LlmCallCountingUtil.carriesCost(call("x", { costUsd: value })),
      ).toBe(false);
    }

    expect(
      LlmCallCountingUtil.carriesTokens(call("x", { totalTokens: 7 })),
    ).toBe(true);
    expect(LlmCallCountingUtil.carriesCost(call("x", { costUsd: 0.01 }))).toBe(
      true,
    );
  });

  test("a child with a negative count covers nothing, and adds nothing", () => {
    const calls: Array<LlmCountableCall> = [
      call("parent", { inputTokens: 100 }),
      call("child", { parentSpanId: "parent", inputTokens: -100 }),
    ];

    expect(counted(calls)["parent"]).toEqual(BOTH);
    expect(LlmCallCountingUtil.countTotals(calls).inputTokens).toBe(100);
  });

  test("a total is the call's own when it reports one, else input + output", () => {
    const totals: LlmCountedTotals = LlmCallCountingUtil.countTotals([
      call("a", { inputTokens: 10, outputTokens: 5, totalTokens: 18 }),
      call("b", { inputTokens: 10, outputTokens: 5 }),
    ]);

    expect(totals.totalTokens).toBe(33);
  });

  test("a call is keyed by its trace and span", () => {
    expect(LlmCallCountingUtil.getKey(TRACE, "a1")).toBe(`${TRACE}/a1`);
    expect(
      LlmCallCountingUtil.getCounted([call("a1")]).has(
        LlmCallCountingUtil.getKey(TRACE, "a1"),
      ),
    ).toBe(true);
  });
});
