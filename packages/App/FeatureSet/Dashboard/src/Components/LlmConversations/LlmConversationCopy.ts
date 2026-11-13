import IconProp from "Common/Types/Icon/IconProp";
import { LlmAnswerIssue } from "Common/Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind } from "Common/Types/Telemetry/LlmCallKind";
import { LlmConversationSort } from "Common/Types/Telemetry/LlmConversationApi";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words and colours the AI pages use for what went wrong with an
 * answer, what a call did and how a list is sorted - one table each, so the
 * list's chips, a row's badges, the replay's answer bubbles and the alert
 * cards say the same thing the same way.
 *
 * The English lives in Common/Types/Telemetry/LlmAnswerIssue.ts and
 * LlmCallKind.ts too (the server writes it into alert descriptions); the
 * labels here are wrapped in translationKey() so the Dashboard's extractor
 * finds them, and LlmConversationCopy.test.ts holds the two to the same
 * words.
 *
 * Every colour class has a dark-theme rule in Theme.css
 * (LlmConversationsDarkMode.test.ts holds the folder to that).
 */

export interface LlmIssueStyle {
  // A label for a chip, a badge or a filter: "Refused".
  title: string;
  // A count of calls with the issue: "2 refusals".
  countLabel: PluralTemplate;
  // One sentence on what it means.
  description: string;
  icon: IconProp;
  // Badge and chip.
  badgeClassName: string;
  // The small round dot of a list row.
  dotClassName: string;
}

export const LLM_ISSUE_STYLES: Record<LlmAnswerIssue, LlmIssueStyle> = {
  [LlmAnswerIssue.Failed]: {
    title: translationKey("Failed"),
    countLabel: {
      one: "{{count}} failed call",
      other: "{{count}} failed calls",
    },
    description: translationKey(
      "The AI call ended in an error, so no answer was delivered.",
    ),
    icon: IconProp.Error,
    badgeClassName: "bg-red-50 text-red-700 ring-red-200",
    dotClassName: "bg-red-500",
  },
  [LlmAnswerIssue.Refused]: {
    title: translationKey("Refused"),
    countLabel: {
      one: "{{count}} refusal",
      other: "{{count}} refusals",
    },
    description: translationKey(
      "The AI declined to answer, or a safety filter blocked its answer.",
    ),
    icon: IconProp.Stop,
    badgeClassName: "bg-amber-50 text-amber-700 ring-amber-200",
    dotClassName: "bg-amber-500",
  },
  [LlmAnswerIssue.CutOff]: {
    title: translationKey("Cut off"),
    countLabel: {
      one: "{{count}} cut-off answer",
      other: "{{count}} cut-off answers",
    },
    description: translationKey(
      "The answer stopped because it reached the token limit.",
    ),
    icon: IconProp.Scissors,
    badgeClassName: "bg-orange-50 text-orange-700 ring-orange-200",
    dotClassName: "bg-orange-500",
  },
  [LlmAnswerIssue.Empty]: {
    title: translationKey("Empty"),
    countLabel: {
      one: "{{count}} empty answer",
      other: "{{count}} empty answers",
    },
    description: translationKey(
      "The AI answered with no text and no tool call.",
    ),
    icon: IconProp.EmptyCircle,
    badgeClassName: "bg-gray-100 text-gray-700 ring-gray-200",
    dotClassName: "bg-gray-400",
  },
  [LlmAnswerIssue.Flagged]: {
    title: translationKey("Flagged"),
    countLabel: {
      one: "{{count}} flagged answer",
      other: "{{count}} flagged answers",
    },
    description: translationKey(
      "An evaluation your app sent (a guardrail, an eval or a thumbs-down) marked the answer as bad.",
    ),
    icon: IconProp.HandThumbDown,
    badgeClassName: "bg-violet-50 text-violet-700 ring-violet-200",
    dotClassName: "bg-violet-500",
  },
};

// The dot of a conversation with no issue.
export const LLM_HEALTHY_DOT_CLASS_NAME: string = "bg-emerald-500";

export const LLM_CALL_KIND_TITLES: Record<LlmCallKind, string> = {
  [LlmCallKind.Answer]: translationKey("AI answer"),
  [LlmCallKind.Agent]: translationKey("Agent run"),
  [LlmCallKind.Tool]: translationKey("Tool"),
  [LlmCallKind.Embedding]: translationKey("Embedding"),
  /*
   * A noun, beside "Embedding" and "Tool": "Search" is the Search
   * button's verb in every other language (#7108).
   */
  [LlmCallKind.Retrieval]: translationKey("Retrieval"),
  [LlmCallKind.Other]: translationKey("Other"),
};

/*
 * What a quiet activity line in a conversation says the AI did.
 */
export const LLM_ACTIVITY_LABELS: Record<LlmCallKind, string> = {
  [LlmCallKind.Answer]: translationKey("Called the model"),
  [LlmCallKind.Agent]: translationKey("Ran an agent"),
  [LlmCallKind.Tool]: translationKey("Ran a tool"),
  [LlmCallKind.Embedding]: translationKey("Created embeddings"),
  [LlmCallKind.Retrieval]: translationKey("Searched for context"),
  [LlmCallKind.Other]: translationKey("Did some work"),
};

export interface LlmSortOption {
  sort: LlmConversationSort;
  label: string;
}

export const LLM_CONVERSATION_SORT_OPTIONS: Array<LlmSortOption> = [
  { sort: LlmConversationSort.Newest, label: translationKey("Newest first") },
  { sort: LlmConversationSort.Oldest, label: translationKey("Oldest first") },
  {
    sort: LlmConversationSort.MostExpensive,
    label: translationKey("Most expensive"),
  },
  {
    sort: LlmConversationSort.Slowest,
    label: translationKey("Slowest answers"),
  },
  { sort: LlmConversationSort.MostCalls, label: translationKey("Most calls") },
];

export function getLlmSortLabel(sort: LlmConversationSort): string {
  return (
    LLM_CONVERSATION_SORT_OPTIONS.find((option: LlmSortOption): boolean => {
      return option.sort === sort;
    })?.label || LLM_CONVERSATION_SORT_OPTIONS[0]!.label
  );
}

/*
 * What a conversation and a call's details say when the prompts and answers
 * an app sends as GenAI log events (rather than on its spans) are not shown:
 * the reader may not read that app's logs, or the logs could not be read
 * (LlmLogEventsRead). Shared by the conversation view and the span panel.
 *
 * Neither says the app sent any: a reader who may not read the logs cannot
 * be told whether they hold some (an app with content capture off sends
 * none), hence "any". Hidden for want of a permission is said the way the
 * product says it elsewhere ("Probes are hidden: you need permission to
 * read this monitor's probes."), and the app is "the app that sent them",
 * which is right for a conversation of one app or of several, some of
 * whose logs the reader may read.
 */
export const LLM_LOG_EVENTS_NOT_ALLOWED: string = translationKey(
  "Any prompts and answers sent as log events are hidden: you need permission to read the logs of the app that sent them.",
);

export const LLM_LOG_EVENTS_FAILED: string = translationKey(
  "The logs couldn't be read, so any prompts and answers sent as log events aren't shown.",
);

// Where a call's prompt and answer were read from, when not its span.
export const LLM_LOG_EVENTS_SOURCE: string = translationKey(
  "Read from this call's log events",
);

export const LLM_LOG_EVENTS_LOADING: string = translationKey(
  "Reading this call's log events…",
);

/*
 * An answer whose content is not on screen while the log events were not
 * read (LLM_LOG_EVENTS_NOT_ALLOWED, LLM_LOG_EVENTS_FAILED): it may well have
 * been recorded, so it is not said to be missing.
 */
export const LLM_SILENT_ANSWER_NOT_SHOWN: string = translationKey(
  "The AI answered. What it said isn't shown.",
);
