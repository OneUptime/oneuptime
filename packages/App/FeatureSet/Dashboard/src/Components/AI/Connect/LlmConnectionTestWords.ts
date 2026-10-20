import {
  LlmConnectionDefinition,
  LlmConnectionKind,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestCounts,
  LlmConnectionTestResult,
} from "Common/Types/LlmObservability/LlmConnectionTest";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { formatLlmCost } from "../../LlmConversations/LlmConversationFormat";

/*
 * What a connection test says, in the dashboard's own words: a headline
 * from the status and the failure kind, what to do about a failure, and
 * what the test found as labelled figures. The provider's own message is
 * kept apart, as the details of a failure - it is English, and it is the
 * provider's, not ours.
 *
 * Every string here is an English translation key; the panel translates
 * them when it draws them.
 */

export interface LlmConnectionTestWords {
  headline: string;
  // What to do next; absent when there is nothing to do.
  advice?: string | undefined;
  // The provider's or the server's own words, for a failure.
  details?: string | undefined;
}

export interface LlmConnectionTestFigure {
  key: string;
  label: string;
  value: string;
}

const FAILURE_WORDS: Record<
  LlmConnectionFailureKind,
  { headline: string; advice: string }
> = {
  [LlmConnectionFailureKind.Authentication]: {
    headline: translationKey("The key or secret was not accepted."),
    advice: translationKey(
      "Check that you copied all of it, that it has not been revoked, and that it is the kind this connection asks for.",
    ),
  },
  [LlmConnectionFailureKind.Permission]: {
    headline: translationKey(
      "The credential works, but it may not read what this connection needs.",
    ),
    advice: translationKey(
      "Give it the role or scope the setup guide names, then test again.",
    ),
  },
  [LlmConnectionFailureKind.RateLimited]: {
    headline: translationKey("The provider asked OneUptime to slow down."),
    advice: translationKey(
      "Nothing is wrong with the settings. Test again in a minute.",
    ),
  },
  [LlmConnectionFailureKind.Unavailable]: {
    headline: translationKey("The provider could not be reached."),
    advice: translationKey(
      "Test again in a few minutes. If it keeps failing, check that your OneUptime server can reach the provider.",
    ),
  },
  [LlmConnectionFailureKind.Settings]: {
    headline: translationKey("A setting is not right."),
    advice: translationKey("Fix the setting named below, then test again."),
  },
  [LlmConnectionFailureKind.Other]: {
    headline: translationKey("The provider refused the test."),
    advice: translationKey(
      "Its answer is below. Check the settings, then test again.",
    ),
  },
};

export function getLlmConnectionTestWords(data: {
  result: LlmConnectionTestResult;
  definition: LlmConnectionDefinition;
}): LlmConnectionTestWords {
  const isTool: boolean =
    data.definition.kind === LlmConnectionKind.CompanyTool;

  /*
   * "It works", never "Connected": a test in the form runs before anything
   * is saved, and the connection is made only by the Connect button.
   */
  if (data.result.status === "pass") {
    return {
      headline: isTool
        ? translationKey("It works. Here is what the first read will bring in.")
        : translationKey(
            "It works. Here is what the account used in the last 7 days.",
          ),
    };
  }

  if (data.result.status === "warn") {
    return {
      headline: isTool
        ? translationKey("It works, but nobody has used it in the last 7 days.")
        : translationKey(
            "It works, but the account has no usage in the last 7 days.",
          ),
      advice: isTool
        ? translationKey(
            "Conversations show up as soon as people use it. If they do use it, check that the credential belongs to the right organization or tenant.",
          )
        : translationKey(
            "Usage shows up as soon as there is some. If the account is in use, check that the key belongs to the right organization.",
          ),
    };
  }

  const words: { headline: string; advice: string } =
    FAILURE_WORDS[data.result.failureKind || LlmConnectionFailureKind.Other] ||
    FAILURE_WORDS[LlmConnectionFailureKind.Other];

  return {
    headline: words.headline,
    advice: words.advice,
    details: data.result.message || undefined,
  };
}

function formatWhole(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 10_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return Math.round(value).toLocaleString("en-US");
}

/*
 * What each provider calls the grouping its usage is reported by: an
 * OpenAI project, an Anthropic workspace, an Azure resource, an AWS or
 * Google Cloud Region.
 */
export function getLlmProviderGroupingLabel(
  provider: LlmConnectionProvider | string | undefined,
): string {
  switch (provider) {
    case LlmConnectionProvider.Anthropic:
      return translationKey("Workspaces");
    case LlmConnectionProvider.AzureOpenAI:
      return translationKey("Resources");
    case LlmConnectionProvider.AwsBedrock:
    case LlmConnectionProvider.GoogleVertexAI:
      return translationKey("Regions");
    default:
      return translationKey("Projects");
  }
}

/*
 * What the test found, as figures: only those the provider reports (a
 * Bedrock test has no cost, a Copilot test no models), and none at all for
 * a failure.
 */
export function getLlmConnectionTestFigures(
  result: LlmConnectionTestResult,
  provider?: LlmConnectionProvider | string | undefined,
): Array<LlmConnectionTestFigure> {
  if (result.status === "fail" || !result.counts) {
    return [];
  }

  const counts: LlmConnectionTestCounts = result.counts;
  const figures: Array<LlmConnectionTestFigure> = [];

  const add: (key: string, label: string, value: string) => void = (
    key: string,
    label: string,
    value: string,
  ): void => {
    figures.push({ key, label, value });
  };

  if (counts.costUsd !== undefined && counts.costUsd > 0) {
    // Money as the AI pages write it: "$1,204.50", not "$1204.50".
    add("cost", translationKey("Cost"), formatLlmCost(counts.costUsd));
  }

  const tokens: number = (counts.inputTokens || 0) + (counts.outputTokens || 0);

  if (tokens > 0) {
    add("tokens", translationKey("Tokens"), formatWhole(tokens));
  }

  if (counts.requests !== undefined && counts.requests > 0) {
    add("requests", translationKey("Requests"), formatWhole(counts.requests));
  }

  if (counts.models !== undefined && counts.models > 0) {
    add("models", translationKey("Models"), formatWhole(counts.models));
  }

  if (counts.conversations !== undefined) {
    add(
      "conversations",
      translationKey("Conversations"),
      formatWhole(counts.conversations),
    );
  }

  if (counts.people !== undefined && counts.people > 0) {
    add("people", translationKey("People"), formatWhole(counts.people));
  }

  if (counts.apiKeys !== undefined && counts.apiKeys > 0) {
    add("apiKeys", translationKey("API keys"), formatWhole(counts.apiKeys));
  }

  if (counts.projects !== undefined && counts.projects > 0) {
    add(
      "projects",
      getLlmProviderGroupingLabel(provider || result.provider),
      formatWhole(counts.projects),
    );
  }

  return figures;
}
