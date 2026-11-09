import { readNumber, readString } from "./LlmConversationApi";
import {
  ALL_LLM_USAGE_DIMENSIONS,
  LlmUsageDimension,
  readLlmUsageDimension,
} from "./LlmUsageApi";

/*
 * The contract of POST /telemetry/llm/metric-usage: what the GenAI metrics
 * of a time range add up to - the tokens and cost the coding assistants
 * (Claude Code, Codex, Gemini CLI, Copilot, Cursor) and the SDKs that send
 * metrics without spans report - in total and by person, team, model,
 * provider or service. The Usage tab reads POST /telemetry/llm/usage
 * (LlmUsageApi), which counts these beside the AI calls.
 *
 * Counted the way a counter counts (LlmMetricUsageReader): a delta series'
 * points are added up, a cumulative series counts what it grew by inside the
 * range, step by step in time order, a drop read as a restart from zero.
 * Adding up a cumulative series' points - each one the running total since
 * the process started - counts every token and dollar once per export: a
 * session exporting every minute for a day read as 1,440 days of use.
 *
 * Both sides read the body defensively: a server mid-rollout or a hand-made
 * request degrades to "nothing", never to a crash.
 */

export const LLM_METRIC_USAGE_ROUTE: string = "/telemetry/llm/metric-usage";

// What the figures are grouped by: the Usage tab's dimensions.
export { LlmUsageDimension as LlmMetricUsageDimension };

export const ALL_LLM_METRIC_USAGE_DIMENSIONS: Array<LlmUsageDimension> =
  ALL_LLM_USAGE_DIMENSIONS;

export interface LlmMetricUsageRequestBody {
  startTime: string;
  endTime: string;
  dimension: LlmUsageDimension;
}

export interface LlmMetricUsageFigures {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  // A cost metric had points in the range (their sum can still be 0).
  hasCost: boolean;
  // A token metric had points of a counted token type in the range.
  hasTokens: boolean;
}

export interface LlmMetricUsageGroup extends LlmMetricUsageFigures {
  // The person, team, model, provider or service; "" when the points named none.
  key: string;
}

export interface LlmMetricUsageResponse {
  totals: LlmMetricUsageFigures;
  // Largest cost first; empty for the "none" dimension.
  groups: Array<LlmMetricUsageGroup>;
  // More rows than one read returns: the figures leave some out.
  truncated: boolean;
}

export function emptyLlmMetricUsageFigures(): LlmMetricUsageFigures {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    hasCost: false,
    hasTokens: false,
  };
}

export function readLlmMetricUsageDimension(value: unknown): LlmUsageDimension {
  return readLlmUsageDimension(value);
}

function readFigures(value: unknown): LlmMetricUsageFigures {
  const object: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    inputTokens: Math.max(0, readNumber(object["inputTokens"])),
    outputTokens: Math.max(0, readNumber(object["outputTokens"])),
    costUsd: readNumber(object["costUsd"]),
    hasCost: object["hasCost"] === true,
    hasTokens: object["hasTokens"] === true,
  };
}

// The response as the server sent it, every list made safe to map over.
export function readLlmMetricUsageResponse(
  value: unknown,
): LlmMetricUsageResponse {
  const object: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const groups: Array<LlmMetricUsageGroup> = Array.isArray(object["groups"])
    ? (object["groups"] as Array<unknown>)
        .filter((group: unknown): boolean => {
          return Boolean(group) && typeof group === "object";
        })
        .map((group: unknown): LlmMetricUsageGroup => {
          return {
            ...readFigures(group),
            key: readString((group as Record<string, unknown>)["key"]),
          };
        })
    : [];

  return {
    totals: readFigures(object["totals"]),
    groups: groups,
    truncated: object["truncated"] === true,
  };
}
