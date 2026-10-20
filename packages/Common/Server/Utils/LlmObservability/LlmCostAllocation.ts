import { LlmUsageRecord } from "../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmProviderTokenType } from "../../../Types/LlmObservability/LlmProviderUsageMetrics";

/*
 * WHO SPENT THE MONEY, WHEN THE BILL ONLY SAYS WHAT IT WAS SPENT ON.
 *
 * OpenAI and Anthropic report cost by project (or workspace) and line item -
 * "gpt-4o-2024-08-06, input", "Claude Opus 5.5 Usage - Output Tokens" - but
 * not by key or person. Their usage reports do say which key and which
 * person used how many tokens of each model in each project. So each cost
 * line is shared among the day's usage of the same model in the same project,
 * in proportion to the tokens of the kind the line charges for (an output
 * line by output tokens, a cache-read line by cache reads).
 *
 * The shares add up to the line exactly, so the totals stay the bill to the
 * cent; only the split between keys and people is derived. A line no usage
 * matches (web search, code execution, a model the usage report names
 * differently) is kept whole, with no key or person.
 */

export interface LlmCostLine {
  day: Date;
  // "" when the line is not tied to a project or workspace.
  project: string;
  // The model the line charges for; "" when it is not a model's tokens.
  model: string;
  // Which tokens the line charges for; null for anything else.
  tokenType: LlmProviderTokenType | null;
  costUsd: number;
  // Shown as the model for a line that matched no usage and names no model.
  description: string;
}

/*
 * Which tokens a cost line's words charge for. Cached and cache-read input
 * before input; cache writes before both; output on its own.
 */
export function tokenTypeOfCostLine(
  text: string | null | undefined,
): LlmProviderTokenType | null {
  const lower: string = (text || "").toLowerCase();

  if (!lower) {
    return null;
  }

  if (lower.includes("output")) {
    return LlmProviderTokenType.Output;
  }

  if (
    lower.includes("cache_creation") ||
    lower.includes("cache creation") ||
    lower.includes("cache write") ||
    lower.includes("cache_write")
  ) {
    return LlmProviderTokenType.CacheWrite;
  }

  if (
    lower.includes("cache_read") ||
    lower.includes("cache read") ||
    lower.includes("cached")
  ) {
    return LlmProviderTokenType.CacheRead;
  }

  if (lower.includes("input")) {
    return LlmProviderTokenType.Input;
  }

  return null;
}

function normalizeModel(model: string): string {
  return (model || "").trim().toLowerCase();
}

// The tokens of a record that a line of this type is shared by.
function weightOf(
  record: LlmUsageRecord,
  tokenType: LlmProviderTokenType | null,
): number {
  const uncachedInput: number = Math.max(
    0,
    record.inputTokens - record.cacheReadTokens - record.cacheWriteTokens,
  );

  switch (tokenType) {
    case LlmProviderTokenType.Output:
      return record.outputTokens;
    case LlmProviderTokenType.CacheRead:
      return record.cacheReadTokens;
    case LlmProviderTokenType.CacheWrite:
      return record.cacheWriteTokens;
    case LlmProviderTokenType.Input:
      return uncachedInput > 0 ? uncachedInput : record.inputTokens;
    default:
      return record.inputTokens + record.outputTokens;
  }
}

export default class LlmCostAllocation {
  /*
   * The usage records with each cost line shared among them, plus a record
   * of its own for every line no usage matched. The records passed in are
   * not changed.
   */
  public static allocate(data: {
    usage: Array<LlmUsageRecord>;
    costLines: Array<LlmCostLine>;
  }): Array<LlmUsageRecord> {
    const records: Array<LlmUsageRecord> = data.usage.map(
      (record: LlmUsageRecord): LlmUsageRecord => {
        return { ...record, costUsd: null };
      },
    );
    const extra: Array<LlmUsageRecord> = [];

    for (const line of data.costLines) {
      if (!Number.isFinite(line.costUsd) || line.costUsd === 0) {
        continue;
      }

      const model: string = normalizeModel(line.model);

      const candidates: Array<LlmUsageRecord> = model
        ? records.filter((record: LlmUsageRecord): boolean => {
            return (
              record.day.getTime() === line.day.getTime() &&
              normalizeModel(record.model) === model &&
              (!line.project || record.project === line.project)
            );
          })
        : [];

      let weights: Array<number> = candidates.map(
        (record: LlmUsageRecord): number => {
          return weightOf(record, line.tokenType);
        },
      );
      let total: number = weights.reduce((sum: number, weight: number) => {
        return sum + weight;
      }, 0);

      /*
       * The kind of tokens the line charges for was not reported (a cache
       * line for usage that names no cache): share it by all tokens.
       */
      if (total <= 0 && candidates.length > 0) {
        weights = candidates.map((record: LlmUsageRecord): number => {
          return weightOf(record, null);
        });
        total = weights.reduce((sum: number, weight: number) => {
          return sum + weight;
        }, 0);
      }

      if (total <= 0) {
        extra.push({
          day: line.day,
          model: line.model || line.description,
          person: "",
          project: line.project,
          apiKey: "",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          requests: null,
          costUsd: line.costUsd,
        });
        continue;
      }

      /*
       * Every share but the last is proportional; the last takes what is
       * left, so the shares add up to the line exactly despite rounding.
       */
      let allocated: number = 0;
      let lastIndex: number = -1;

      weights.forEach((weight: number, index: number) => {
        if (weight > 0) {
          lastIndex = index;
        }
      });

      candidates.forEach((record: LlmUsageRecord, index: number) => {
        const weight: number = weights[index] || 0;

        if (weight <= 0) {
          return;
        }

        const share: number =
          index === lastIndex
            ? line.costUsd - allocated
            : (line.costUsd * weight) / total;

        allocated += share;
        record.costUsd = (record.costUsd || 0) + share;
      });
    }

    return [...records, ...extra];
  }
}
