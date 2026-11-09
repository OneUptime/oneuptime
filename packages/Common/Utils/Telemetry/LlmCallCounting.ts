import { LlmCallKind } from "../../Types/Telemetry/LlmCallKind";

/*
 * EACH MODEL CALL COUNTED ONCE.
 *
 * An AI call's tokens and cost can be on more than one span:
 *
 *   - An agent, workflow or chain run (LlmCallKind.Agent) often carries the
 *     totals of the calls it made. The GenAI conventions recommend the
 *     gen_ai.usage.* attributes on invoke_agent, and Pydantic AI's agent run
 *     and Strands' invoke_agent carry them; OpenInference's and the OpenAI
 *     Agents SDK's agent spans usually carry none.
 *   - Two instrumentations of one call: OpenInference's or OpenLLMetry's
 *     LangChain span with the OpenAI or Anthropic SDK's span under it, each
 *     with the call's tokens and cost.
 *
 * Adding every span up counts those calls twice or more. So a span's
 * figure - its tokens, or its cost, each on its own - is NOT counted when
 * the calls inside it report that figure:
 *
 *   (a) a span with a direct child AI call that reports the figure (any
 *       kind: the wrapped call, or a nested agent run that carries it);
 *   (b) an agent run with a call that is not an agent run, reports the
 *       figure, and starts within the run's time in the same request
 *       (trace) - found through any number of spans in between (a tool run,
 *       a framework's own span).
 *
 * Everything else is counted, so an agent run keeps its own figures when no
 * call inside it reports them: a remote agent, a framework that records
 * only the run. Tokens and cost are decided apart: a run whose calls report
 * tokens but no cost (a model with no price) keeps its cost.
 *
 * What it cannot tell: an agent run with figures of its own that runs
 * beside another agent run in the same request, whose calls start within
 * its time, is taken to wrap them. Rows stored before the call kind was
 * recorded ("") are never taken for agent runs; (a) still applies to them.
 *
 * The server applies the same rule in ClickHouse (LlmCountedCallsSql) for
 * the Usage tab, the budgets and the conversation list; this is the rule
 * for calls already read (one conversation's transcript).
 */

export interface LlmCountableCall {
  spanId: string;
  traceId: string;
  // "" for a span with no parent.
  parentSpanId: string;
  kind: LlmCallKind | undefined;
  startMs: number;
  endMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number | undefined;
  costUsd: number;
}

// Whether a call's own figures are counted.
export interface LlmCountedFigures {
  tokens: boolean;
  cost: boolean;
}

export interface LlmCountedTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

function positive(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// Trace and span ids are hex, so a slash cannot be part of either.
function callKey(traceId: string, spanId: string): string {
  return `${traceId}/${spanId}`;
}

export default class LlmCallCountingUtil {
  public static carriesTokens(call: LlmCountableCall): boolean {
    return (
      positive(call.inputTokens) ||
      positive(call.outputTokens) ||
      positive(call.totalTokens)
    );
  }

  public static carriesCost(call: LlmCountableCall): boolean {
    return positive(call.costUsd);
  }

  /*
   * For each call, keyed by getKey(traceId, spanId), whether its tokens and
   * its cost are counted.
   */
  public static getCounted(
    calls: Array<LlmCountableCall>,
  ): Map<string, LlmCountedFigures> {
    // (a): the spans that have a direct child reporting each figure.
    const parentsOfTokens: Set<string> = new Set<string>();
    const parentsOfCost: Set<string> = new Set<string>();
    // (b): per request, when the calls (not agent runs) reporting each started.
    const tokenStarts: Map<string, Array<number>> = new Map<
      string,
      Array<number>
    >();
    const costStarts: Map<string, Array<number>> = new Map<
      string,
      Array<number>
    >();

    for (const call of calls) {
      const tokens: boolean = LlmCallCountingUtil.carriesTokens(call);
      const cost: boolean = LlmCallCountingUtil.carriesCost(call);

      // A span that names itself as its parent wraps nothing.
      if (call.parentSpanId && call.parentSpanId !== call.spanId) {
        const parent: string = callKey(call.traceId, call.parentSpanId);

        if (tokens) {
          parentsOfTokens.add(parent);
        }

        if (cost) {
          parentsOfCost.add(parent);
        }
      }

      if (call.kind !== LlmCallKind.Agent) {
        if (tokens) {
          const starts: Array<number> = tokenStarts.get(call.traceId) || [];
          starts.push(call.startMs);
          tokenStarts.set(call.traceId, starts);
        }

        if (cost) {
          const starts: Array<number> = costStarts.get(call.traceId) || [];
          starts.push(call.startMs);
          costStarts.set(call.traceId, starts);
        }
      }
    }

    const startsWithin: (
      starts: Array<number> | undefined,
      call: LlmCountableCall,
    ) => boolean = (
      starts: Array<number> | undefined,
      call: LlmCountableCall,
    ): boolean => {
      return (starts || []).some((start: number): boolean => {
        return start >= call.startMs && start <= call.endMs;
      });
    };

    const counted: Map<string, LlmCountedFigures> = new Map<
      string,
      LlmCountedFigures
    >();

    for (const call of calls) {
      const key: string = callKey(call.traceId, call.spanId);
      const isAgentRun: boolean = call.kind === LlmCallKind.Agent;

      counted.set(key, {
        tokens: !(
          parentsOfTokens.has(key) ||
          (isAgentRun && startsWithin(tokenStarts.get(call.traceId), call))
        ),
        cost: !(
          parentsOfCost.has(key) ||
          (isAgentRun && startsWithin(costStarts.get(call.traceId), call))
        ),
      });
    }

    return counted;
  }

  public static getKey(traceId: string, spanId: string): string {
    return callKey(traceId, spanId);
  }

  // The calls' tokens and cost, each model call once.
  public static countTotals(calls: Array<LlmCountableCall>): LlmCountedTotals {
    const counted: Map<string, LlmCountedFigures> =
      LlmCallCountingUtil.getCounted(calls);
    const totals: LlmCountedTotals = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };

    for (const call of calls) {
      const figures: LlmCountedFigures | undefined = counted.get(
        callKey(call.traceId, call.spanId),
      );

      if (!figures) {
        continue;
      }

      if (figures.tokens) {
        totals.inputTokens += positive(call.inputTokens) ? call.inputTokens : 0;
        totals.outputTokens += positive(call.outputTokens)
          ? call.outputTokens
          : 0;
        totals.totalTokens += positive(call.totalTokens)
          ? call.totalTokens!
          : (positive(call.inputTokens) ? call.inputTokens : 0) +
            (positive(call.outputTokens) ? call.outputTokens : 0);
      }

      if (figures.cost) {
        totals.costUsd += positive(call.costUsd) ? call.costUsd : 0;
      }
    }

    return totals;
  }
}
