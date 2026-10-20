import BadDataException from "../../../Types/Exception/BadDataException";
import { LlmUsageRecord } from "../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestCounts,
  LlmConnectionTestResult,
} from "../../../Types/LlmObservability/LlmConnectionTest";
import LlmProviderError from "./LlmProviderError";

/*
 * How every connector words a test's answer, so the dashboard reads one
 * shape. The message is English for the API and the logs; the dashboard
 * words its own sentence from the status, the counts and the failure kind,
 * and shows the provider's message as the details of a failure.
 */

// How far back a test reads.
export const LLM_CONNECTION_TEST_DAYS: number = 7;

export default class LlmConnectorTestResults {
  public static countUsage(
    records: Array<LlmUsageRecord>,
    days: number,
  ): LlmConnectionTestCounts {
    const models: Set<string> = new Set<string>();
    const people: Set<string> = new Set<string>();
    const apiKeys: Set<string> = new Set<string>();
    const projects: Set<string> = new Set<string>();
    let inputTokens: number = 0;
    let outputTokens: number = 0;
    let requests: number = 0;
    let costUsd: number = 0;

    for (const record of records) {
      /*
       * A model is one that was used: a cost line kept whole (web search,
       * code execution) names what was bought, not a model.
       */
      const used: boolean =
        (record.inputTokens || 0) + (record.outputTokens || 0) > 0 ||
        (record.requests || 0) > 0;

      if (record.model && used) {
        models.add(record.model);
      }

      if (record.person) {
        people.add(record.person);
      }

      if (record.apiKey) {
        apiKeys.add(record.apiKey);
      }

      if (record.project) {
        projects.add(record.project);
      }

      inputTokens += record.inputTokens || 0;
      outputTokens += record.outputTokens || 0;
      requests += record.requests || 0;
      costUsd += record.costUsd || 0;
    }

    return {
      days: days,
      models: models.size,
      people: people.size,
      apiKeys: apiKeys.size,
      projects: projects.size,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      requests: requests,
      costUsd: Math.round(costUsd * 100) / 100,
    };
  }

  /*
   * A working usage read. With no usage at all it is a warning, not a
   * pass: the key works, but either the account was idle or the key sees
   * another organization than the one meant.
   */
  public static fromUsage(data: {
    provider: string;
    records: Array<LlmUsageRecord>;
    days: number;
    durationMs: number;
  }): LlmConnectionTestResult {
    const counts: LlmConnectionTestCounts = LlmConnectorTestResults.countUsage(
      data.records,
      data.days,
    );
    const hasUsage: boolean =
      (counts.inputTokens || 0) + (counts.outputTokens || 0) > 0 ||
      (counts.requests || 0) > 0 ||
      (counts.costUsd || 0) > 0;

    return {
      provider: data.provider,
      status: hasUsage ? "pass" : "warn",
      message: hasUsage
        ? `Connected. Found usage in the last ${data.days} days.`
        : `Connected, but there is no usage in the last ${data.days} days. Usage will show up as soon as there is some.`,
      counts: counts,
      durationMs: data.durationMs,
    };
  }

  public static fromChats(data: {
    provider: string;
    conversations: number;
    people: number;
    days: number;
    durationMs: number;
  }): LlmConnectionTestResult {
    const hasChats: boolean = data.conversations > 0;

    return {
      provider: data.provider,
      status: hasChats ? "pass" : "warn",
      message: hasChats
        ? `Connected. Found conversations in the last ${data.days} days.`
        : `Connected, but there are no conversations in the last ${data.days} days.`,
      counts: {
        days: data.days,
        conversations: data.conversations,
        people: data.people,
      },
      durationMs: data.durationMs,
    };
  }

  public static fromError(data: {
    provider: string;
    error: unknown;
    secretValues: Array<string>;
    durationMs: number;
  }): LlmConnectionTestResult {
    // A setting the connector refused before calling anyone: say it as is.
    if (data.error instanceof BadDataException) {
      return {
        provider: data.provider,
        status: "fail",
        message: LlmProviderError.redact(data.error.message, data.secretValues),
        failureKind: LlmConnectionFailureKind.Settings,
        durationMs: data.durationMs,
      };
    }

    const error: LlmProviderError = LlmProviderError.from({
      error: data.error,
      step: "test",
      providerTitle: data.provider,
      secretValues: data.secretValues,
    });

    return {
      provider: data.provider,
      status: "fail",
      message: error.message,
      failureKind: error.kind || LlmConnectionFailureKind.Other,
      durationMs: data.durationMs,
    };
  }
}
