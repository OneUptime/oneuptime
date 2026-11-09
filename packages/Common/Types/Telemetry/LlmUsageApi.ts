import { readNumber, readString } from "./LlmConversationApi";

/*
 * The contract of POST /telemetry/llm/usage: the calls, tokens and cost of a
 * time range on the AI / LLM Usage tab, in total and by person, team, model,
 * provider or service - counted from the AI calls the apps send (GenAI
 * spans) and from the usage metrics the coding tools send (GenAI metrics),
 * each service from one of the two, and each model call once
 * (LlmUsageReader, LlmUsageUtil).
 *
 * Both sides read the body defensively: a server mid-rollout or a
 * hand-made request degrades to "nothing", never to a crash.
 */

export const LLM_USAGE_ROUTE: string = "/telemetry/llm/usage";

// What the figures are grouped by; "none" reads the totals alone.
export enum LlmUsageDimension {
  None = "none",
  Employee = "employee",
  Team = "team",
  Model = "model",
  Provider = "provider",
  Service = "service",
}

export const ALL_LLM_USAGE_DIMENSIONS: Array<LlmUsageDimension> = [
  LlmUsageDimension.None,
  LlmUsageDimension.Employee,
  LlmUsageDimension.Team,
  LlmUsageDimension.Model,
  LlmUsageDimension.Provider,
  LlmUsageDimension.Service,
];

/*
 * Where a figure came from:
 *
 *   - calls: the AI calls the apps sent (GenAI spans);
 *   - metrics: the usage metrics a tool sent and no AI calls (GenAI
 *     metrics), such as a coding assistant;
 *   - both: some services' AI calls and other services' usage metrics,
 *     added together - never one service's both;
 *   - none: nothing reported the figure.
 */
export enum LlmUsageSource {
  None = "none",
  Calls = "calls",
  Metrics = "metrics",
  Both = "both",
}

export interface LlmUsageRequestBody {
  startTime: string;
  endTime: string;
  dimension: LlmUsageDimension;
}

export interface LlmUsageFigures {
  // AI calls: only spans count calls, so a metrics-only figure has none.
  calls: number;
  erroredCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  tokenSource: LlmUsageSource;
  costSource: LlmUsageSource;
}

export interface LlmUsageGroup extends LlmUsageFigures {
  // The person, team, model, provider or service id; "" when none was named.
  key: string;
}

/*
 * One service's figures. A service's token and cost sources are each
 * "calls", "metrics" or "none", never "both": that is the rule.
 */
export interface LlmUsageService extends LlmUsageFigures {
  serviceId: string;
}

export interface LlmUsageResponse {
  totals: LlmUsageFigures;
  // Largest cost first; empty for the "none" dimension.
  groups: Array<LlmUsageGroup>;
  // Every service with usage in the range, largest cost first.
  services: Array<LlmUsageService>;
  /*
   * The reader may not read metrics, so the usage metrics were left out:
   * the figures are the AI calls' alone.
   */
  metricsLeftOut: boolean;
  // More rows than one read returns: some groups are left out (never the totals).
  truncated: boolean;
}

export function emptyLlmUsageFigures(): LlmUsageFigures {
  return {
    calls: 0,
    erroredCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    tokenSource: LlmUsageSource.None,
    costSource: LlmUsageSource.None,
  };
}

export function emptyLlmUsageResponse(): LlmUsageResponse {
  return {
    totals: emptyLlmUsageFigures(),
    groups: [],
    services: [],
    metricsLeftOut: false,
    truncated: false,
  };
}

export function readLlmUsageDimension(value: unknown): LlmUsageDimension {
  return (
    ALL_LLM_USAGE_DIMENSIONS.find((dimension: LlmUsageDimension): boolean => {
      return dimension === value;
    }) || LlmUsageDimension.None
  );
}

export function readLlmUsageSource(value: unknown): LlmUsageSource {
  return (
    Object.values(LlmUsageSource).find((source: LlmUsageSource): boolean => {
      return source === value;
    }) || LlmUsageSource.None
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readFigures(value: unknown): LlmUsageFigures {
  const object: Record<string, unknown> = asObject(value);

  return {
    calls: Math.max(0, readNumber(object["calls"])),
    erroredCalls: Math.max(0, readNumber(object["erroredCalls"])),
    inputTokens: Math.max(0, readNumber(object["inputTokens"])),
    outputTokens: Math.max(0, readNumber(object["outputTokens"])),
    totalTokens: Math.max(0, readNumber(object["totalTokens"])),
    costUsd: Math.max(0, readNumber(object["costUsd"])),
    tokenSource: readLlmUsageSource(object["tokenSource"]),
    costSource: readLlmUsageSource(object["costSource"]),
  };
}

function readList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? (value as Array<unknown>)
        .filter((entry: unknown): boolean => {
          return (
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
          );
        })
        .map((entry: unknown): Record<string, unknown> => {
          return entry as Record<string, unknown>;
        })
    : [];
}

// The response as the server sent it, every list made safe to map over.
export function readLlmUsageResponse(value: unknown): LlmUsageResponse {
  const object: Record<string, unknown> = asObject(value);

  return {
    totals: readFigures(object["totals"]),
    groups: readList(object["groups"]).map(
      (group: Record<string, unknown>): LlmUsageGroup => {
        return { ...readFigures(group), key: readString(group["key"]) };
      },
    ),
    services: readList(object["services"]).map(
      (service: Record<string, unknown>): LlmUsageService => {
        return {
          ...readFigures(service),
          serviceId: readString(service["serviceId"]),
        };
      },
    ),
    metricsLeftOut: object["metricsLeftOut"] === true,
    truncated: object["truncated"] === true,
  };
}
