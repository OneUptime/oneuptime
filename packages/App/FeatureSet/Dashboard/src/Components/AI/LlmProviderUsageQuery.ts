import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import {
  LlmConnectionCatalog,
  LlmConnectionDefinition,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import {
  LLM_CONNECTION_NAME_ATTRIBUTE,
  LLM_PROVIDER_API_KEY_ATTRIBUTE,
  LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
  LLM_PROVIDER_MODEL_ATTRIBUTE,
  LLM_PROVIDER_NAME_ATTRIBUTE,
  LLM_PROVIDER_PERSON_ATTRIBUTE,
  LLM_PROVIDER_PROJECT_ATTRIBUTE,
  LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
  LlmProviderTokenType,
} from "Common/Types/LlmObservability/LlmProviderUsageMetrics";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Usage > Provider accounts: what the connected provider accounts report,
 * read from the three metrics a connection keeps (oneuptime.llm.provider.*),
 * grouped by one of the attributes the providers fill in.
 *
 * Provider figures are daily totals stamped at the start of their UTC day,
 * so a range is widened to start at its first day's midnight: a range
 * "from 14:00 three days ago" still counts that whole day.
 *
 * Pure: the component asks with these queries and folds the answers with
 * foldProviderUsage.
 */

export type LlmProviderUsageDimensionKey =
  | "model"
  | "person"
  | "provider"
  | "project"
  | "apiKey"
  | "connection";

export interface LlmProviderUsageDimension {
  key: LlmProviderUsageDimensionKey;
  label: string;
  attributeKey: string;
}

export const LLM_PROVIDER_USAGE_DIMENSIONS: Array<LlmProviderUsageDimension> = [
  {
    key: "model",
    label: translationKey("Model"),
    attributeKey: LLM_PROVIDER_MODEL_ATTRIBUTE,
  },
  {
    key: "person",
    label: translationKey("Person"),
    attributeKey: LLM_PROVIDER_PERSON_ATTRIBUTE,
  },
  {
    key: "provider",
    label: translationKey("Provider"),
    attributeKey: LLM_PROVIDER_NAME_ATTRIBUTE,
  },
  {
    key: "project",
    label: translationKey("Project or resource"),
    attributeKey: LLM_PROVIDER_PROJECT_ATTRIBUTE,
  },
  {
    key: "apiKey",
    label: translationKey("API key"),
    attributeKey: LLM_PROVIDER_API_KEY_ATTRIBUTE,
  },
  {
    key: "connection",
    label: translationKey("Connection"),
    attributeKey: LLM_CONNECTION_NAME_ATTRIBUTE,
  },
];

export function getProviderUsageDimension(
  key: LlmProviderUsageDimensionKey,
): LlmProviderUsageDimension {
  return (
    LLM_PROVIDER_USAGE_DIMENSIONS.find(
      (dimension: LlmProviderUsageDimension): boolean => {
        return dimension.key === key;
      },
    ) || LLM_PROVIDER_USAGE_DIMENSIONS[0]!
  );
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

// One provider metric over a range, for the project.
export function buildProviderMetricQuery(data: {
  projectId: ObjectID;
  metricName: string;
  startTime: Date;
  endTime: Date;
}): Query<Metric> {
  return {
    projectId: data.projectId,
    name: data.metricName,
    time: new InBetween(startOfUtcDay(data.startTime), data.endTime),
  } as Query<Metric>;
}

export interface LlmProviderUsageRow {
  // The group's value; "" when the provider did not name it.
  key: string;
  costUsd: number;
  // Whether some of the cost is OneUptime's estimate from the tokens.
  costIncludesEstimate: boolean;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface LlmProviderUsageSummary {
  rows: Array<LlmProviderUsageRow>;
  totals: LlmProviderUsageRow;
}

function readAttribute(row: AggregatedModel, key: string): string {
  const attributes: JSONObject =
    (row["attributes"] as JSONObject | undefined) || {};
  const value: unknown = attributes[key];

  return value === null || value === undefined ? "" : String(value).trim();
}

function readValue(row: AggregatedModel): number {
  const value: number = Number(row.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/*
 * The three metrics' grouped rows as one row per group, biggest cost
 * first (then most tokens). Totals are over every group.
 */
export function foldProviderUsage(data: {
  dimension: LlmProviderUsageDimension;
  costRows: Array<AggregatedModel>;
  tokenRows: Array<AggregatedModel>;
  requestRows: Array<AggregatedModel>;
}): LlmProviderUsageSummary {
  const groups: Map<string, LlmProviderUsageRow> = new Map();

  const groupOf: (key: string) => LlmProviderUsageRow = (
    key: string,
  ): LlmProviderUsageRow => {
    let row: LlmProviderUsageRow | undefined = groups.get(key);

    if (!row) {
      row = {
        key,
        costUsd: 0,
        costIncludesEstimate: false,
        inputTokens: 0,
        outputTokens: 0,
        requests: 0,
      };
      groups.set(key, row);
    }

    return row;
  };

  for (const row of data.costRows) {
    const group: LlmProviderUsageRow = groupOf(
      readAttribute(row, data.dimension.attributeKey),
    );
    const value: number = readValue(row);
    group.costUsd += value;

    if (
      value !== 0 &&
      readAttribute(row, LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE) === "true"
    ) {
      group.costIncludesEstimate = true;
    }
  }

  for (const row of data.tokenRows) {
    const group: LlmProviderUsageRow = groupOf(
      readAttribute(row, data.dimension.attributeKey),
    );
    const tokenType: string = readAttribute(
      row,
      LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
    );

    // Input counts cached tokens too, so cache reads and writes add nothing.
    if (tokenType === LlmProviderTokenType.Input) {
      group.inputTokens += readValue(row);
    } else if (tokenType === LlmProviderTokenType.Output) {
      group.outputTokens += readValue(row);
    }
  }

  for (const row of data.requestRows) {
    groupOf(readAttribute(row, data.dimension.attributeKey)).requests +=
      readValue(row);
  }

  const rows: Array<LlmProviderUsageRow> = Array.from(groups.values())
    .map((row: LlmProviderUsageRow): LlmProviderUsageRow => {
      // A provider's corrections can never leave a group below nothing.
      return {
        ...row,
        costUsd: Math.max(0, Math.round(row.costUsd * 1e6) / 1e6),
        inputTokens: Math.max(0, Math.round(row.inputTokens)),
        outputTokens: Math.max(0, Math.round(row.outputTokens)),
        requests: Math.max(0, Math.round(row.requests)),
      };
    })
    .filter((row: LlmProviderUsageRow): boolean => {
      return (
        row.costUsd > 0 ||
        row.inputTokens > 0 ||
        row.outputTokens > 0 ||
        row.requests > 0
      );
    })
    .sort((a: LlmProviderUsageRow, b: LlmProviderUsageRow): number => {
      return (
        b.costUsd - a.costUsd ||
        b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) ||
        a.key.localeCompare(b.key)
      );
    });

  const totals: LlmProviderUsageRow = {
    key: "",
    costUsd: 0,
    costIncludesEstimate: false,
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
  };

  for (const row of rows) {
    totals.costUsd += row.costUsd;
    totals.costIncludesEstimate =
      totals.costIncludesEstimate || row.costIncludesEstimate;
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.requests += row.requests;
  }

  totals.costUsd = Math.round(totals.costUsd * 100) / 100;

  return { rows, totals };
}

// A provider's GenAI name ("aws.bedrock") as the product names it.
export function getProviderLabel(genAiProviderName: string): string {
  const definition: LlmConnectionDefinition | undefined =
    LlmConnectionCatalog.find((item: LlmConnectionDefinition): boolean => {
      return item.genAiProviderName === genAiProviderName;
    });

  return definition?.title || genAiProviderName;
}
