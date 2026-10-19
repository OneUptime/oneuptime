import PageMap from "../../Utils/PageMap";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  CodeTaskBlockerType,
  CodeTaskContextType,
  CodeTaskFileStatus,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskStepKind,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words, marks and colours the Code pages use for tasks, in one place:
 * a task's state, its recipe, what started it, a step the AI took, the
 * context a person can add, and what to do about whatever stops AI working.
 * English keys (translationKey), translated where they are drawn. React-
 * free, so App's tests can read it.
 */

export interface CodeTaskStateCopy {
  label: string;
  // The badge: text and background, light and dark (Theme.css remaps them).
  badgeClassName: string;
  // The dot or mark beside a task in a list.
  dotClassName: string;
  icon: IconProp;
}

/*
 * "Working…", not "Working": the Dashboard's "Working" is a monitor that
 * works (German "Funktioniert"), and the AI at work is something else.
 */
export const CODE_TASK_STATE_COPY: Record<CodeTaskState, CodeTaskStateCopy> = {
  [CodeTaskState.Working]: {
    label: translationKey("Working…"),
    badgeClassName: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
    dotClassName: "bg-indigo-500",
    icon: IconProp.Spinner,
  },
  [CodeTaskState.WaitingForYou]: {
    label: translationKey("Waiting for you"),
    badgeClassName: "bg-amber-50 text-amber-800 ring-amber-600/20",
    dotClassName: "bg-amber-500",
    icon: IconProp.ChatBubbleLeft,
  },
  [CodeTaskState.Done]: {
    label: translationKey("Done"),
    badgeClassName: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    dotClassName: "bg-emerald-500",
    icon: IconProp.CheckCircle,
  },
  [CodeTaskState.Failed]: {
    label: translationKey("Failed"),
    badgeClassName: "bg-red-50 text-red-700 ring-red-600/20",
    dotClassName: "bg-red-500",
    icon: IconProp.ExclaimationCircle,
  },
  [CodeTaskState.Stopped]: {
    label: translationKey("Stopped"),
    badgeClassName: "bg-gray-100 text-gray-600 ring-gray-500/20",
    dotClassName: "bg-gray-400",
    icon: IconProp.StopCircle,
  },
};

// What a queued task says, instead of "Working": nobody has picked it up.
export const QUEUED_LABEL: string = translationKey("Queued");

/*
 * What a task's recipe is called, for a task nobody asked for in Code. A
 * request needs no label: its title is what was asked.
 */
export const CODE_TASK_RECIPE_LABELS: Record<string, string> = {
  [CodeFixTaskType.FixException]: translationKey("Fix Exception"),
  [CodeFixTaskType.WriteRegressionTest]: translationKey("Regression Test"),
  [CodeFixTaskType.ImproveExceptionHandling]: translationKey(
    "Improve Error Handling",
  ),
  [CodeFixTaskType.ImproveInstrumentation]: translationKey(
    "Improve Instrumentation",
  ),
  [CodeFixTaskType.ImproveLogging]: translationKey("Improve Logging"),
  [CodeFixTaskType.ImproveTracing]: translationKey("Improve Tracing"),
  [CodeFixTaskType.FixPerformance]: translationKey("Fix Performance"),
  [CodeFixTaskType.FixFromIncident]: translationKey("Fix from Incident"),
  [CodeFixTaskType.GitHubIssueFix]: translationKey("Fix GitHub Issue"),
  [CodeFixTaskType.GitHubPullRequestRevision]: translationKey(
    "Revise GitHub Pull Request",
  ),
  [CodeFixTaskType.GitHubPullRequestReview]: translationKey(
    "Review GitHub Pull Request",
  ),
  [CodeFixTaskType.CodeRequest]: translationKey("Request"),
};

export function getRecipeLabel(recipe: string | undefined): string {
  return (
    CODE_TASK_RECIPE_LABELS[recipe || CodeFixTaskType.FixException] ||
    recipe ||
    ""
  );
}

/*
 * How the conversation says a task OneUptime started began. `{{label}}` is
 * the record's own name (an exception's message, "#42: Checkout is down").
 */
export const CODE_TASK_ORIGIN_SENTENCES: Record<CodeTaskOriginType, string> = {
  [CodeTaskOriginType.Request]: translationKey("{{label}} asked"),
  [CodeTaskOriginType.Exception]: translationKey(
    "OneUptime started this task from an exception: {{label}}",
  ),
  [CodeTaskOriginType.Incident]: translationKey(
    "OneUptime started this task from incident {{label}}",
  ),
  [CodeTaskOriginType.Alert]: translationKey(
    "OneUptime started this task from alert {{label}}",
  ),
  [CodeTaskOriginType.Trace]: translationKey(
    "OneUptime started this task from a slow trace in {{label}}",
  ),
  [CodeTaskOriginType.Service]: translationKey(
    "OneUptime started this task for the service {{label}}",
  ),
  [CodeTaskOriginType.Insight]: translationKey(
    "OneUptime started this task from an AI insight",
  ),
  [CodeTaskOriginType.GitHubIssue]: translationKey(
    "Started from GitHub issue {{label}}",
  ),
  [CodeTaskOriginType.GitHubPullRequest]: translationKey(
    "Started from GitHub pull request {{label}}",
  ),
  [CodeTaskOriginType.Unknown]: translationKey("OneUptime started this task"),
};

/*
 * Who asked, in a list row's meta line. A task OneUptime started is named
 * by its kind there ("Fix Exception"); its title already names the record.
 */
export const CODE_TASK_ASKED_BY: string = translationKey("Asked by {{name}}");

// A step the AI took, as the conversation words it.
export const CODE_TASK_STEP_SENTENCES: Record<CodeTaskStepKind, string> = {
  [CodeTaskStepKind.Read]: translationKey("Read {{subject}}"),
  [CodeTaskStepKind.Edited]: translationKey("Edited {{subject}}"),
  [CodeTaskStepKind.Listed]: translationKey("Looked in {{subject}}"),
  [CodeTaskStepKind.Searched]: translationKey("Searched for {{subject}}"),
  [CodeTaskStepKind.Ran]: translationKey("Ran {{subject}}"),
  [CodeTaskStepKind.PullRequest]: translationKey("{{subject}}"),
  [CodeTaskStepKind.Note]: translationKey("{{subject}}"),
};

export const CODE_TASK_STEP_ICONS: Record<CodeTaskStepKind, IconProp> = {
  [CodeTaskStepKind.Read]: IconProp.DocumentText,
  [CodeTaskStepKind.Edited]: IconProp.PencilSquare,
  [CodeTaskStepKind.Listed]: IconProp.Folder,
  [CodeTaskStepKind.Searched]: IconProp.MagnifyingGlass,
  [CodeTaskStepKind.Ran]: IconProp.CommandLine,
  [CodeTaskStepKind.PullRequest]: IconProp.GitHub,
  [CodeTaskStepKind.Note]: IconProp.Circle,
};

export interface CodeTaskContextKindCopy {
  label: string;
  // The title of the dialog that adds one.
  addTitle: string;
  icon: IconProp;
  // Whether it is read from OneUptime (shown under that heading).
  isRecord: boolean;
}

// What a person can add to a request, in the order the menu lists it.
export const CODE_TASK_CONTEXT_KINDS: Record<
  CodeTaskContextType,
  CodeTaskContextKindCopy
> = {
  [CodeTaskContextType.File]: {
    label: translationKey("File or folder"),
    addTitle: translationKey("Add a file or folder"),
    icon: IconProp.DocumentText,
    isRecord: false,
  },
  [CodeTaskContextType.Note]: {
    label: translationKey("Note"),
    addTitle: translationKey("Add a note"),
    icon: IconProp.ChatBubbleLeft,
    isRecord: false,
  },
  [CodeTaskContextType.Link]: {
    label: translationKey("Link"),
    addTitle: translationKey("Add a link"),
    icon: IconProp.Link,
    isRecord: false,
  },
  [CodeTaskContextType.Incident]: {
    label: translationKey("Incident"),
    addTitle: translationKey("Add an incident"),
    icon: IconProp.Alert,
    isRecord: true,
  },
  [CodeTaskContextType.Alert]: {
    label: translationKey("Alert"),
    addTitle: translationKey("Add an alert"),
    icon: IconProp.BellRinging,
    isRecord: true,
  },
  [CodeTaskContextType.Exception]: {
    label: translationKey("Exception"),
    addTitle: translationKey("Add an exception"),
    icon: IconProp.Bug,
    isRecord: true,
  },
  [CodeTaskContextType.Monitor]: {
    label: translationKey("Monitor"),
    addTitle: translationKey("Add a monitor"),
    icon: IconProp.Heartbeat,
    isRecord: true,
  },
  [CodeTaskContextType.Trace]: {
    label: translationKey("Trace"),
    addTitle: translationKey("Add a trace"),
    icon: IconProp.Waterfall,
    isRecord: true,
  },
  [CodeTaskContextType.Logs]: {
    label: translationKey("Logs"),
    addTitle: translationKey("Add logs"),
    icon: IconProp.Logs,
    isRecord: true,
  },
};

export const CODE_TASK_CONTEXT_MENU_ORDER: Array<CodeTaskContextType> = [
  CodeTaskContextType.File,
  CodeTaskContextType.Note,
  CodeTaskContextType.Link,
  CodeTaskContextType.Incident,
  CodeTaskContextType.Alert,
  CodeTaskContextType.Exception,
  CodeTaskContextType.Monitor,
  CodeTaskContextType.Trace,
  CodeTaskContextType.Logs,
];

// The record a context chip opens, by its kind.
export const CODE_TASK_CONTEXT_RECORD_PAGES: Partial<
  Record<CodeTaskContextType, PageMap>
> = {
  [CodeTaskContextType.Incident]: PageMap.INCIDENT_VIEW,
  [CodeTaskContextType.Alert]: PageMap.ALERT_VIEW,
  [CodeTaskContextType.Exception]: PageMap.EXCEPTIONS_VIEW,
  [CodeTaskContextType.Monitor]: PageMap.MONITOR_VIEW,
};

// A file's change, as a letter (the way git and editors mark them).
export const CODE_TASK_FILE_STATUS_MARKS: Record<CodeTaskFileStatus, string> = {
  [CodeTaskFileStatus.Added]: "A",
  [CodeTaskFileStatus.Modified]: "M",
  [CodeTaskFileStatus.Deleted]: "D",
  [CodeTaskFileStatus.Renamed]: "R",
};

export const CODE_TASK_FILE_STATUS_LABELS: Record<CodeTaskFileStatus, string> =
  {
    [CodeTaskFileStatus.Added]: translationKey("Added"),
    [CodeTaskFileStatus.Modified]: translationKey("Modified"),
    [CodeTaskFileStatus.Deleted]: translationKey("Deleted"),
    [CodeTaskFileStatus.Renamed]: translationKey("Renamed"),
  };

/*
 * What stops AI working in a repository, in the reader's language. The
 * server says the same in English when it refuses (CodeTaskGate); a limit
 * that names numbers and a time is said in the server's words, since only
 * it knows them.
 */
export const CODE_TASK_BLOCKER_SENTENCES: Partial<
  Record<CodeTaskBlockerType, string>
> = {
  [CodeTaskBlockerType.NoPermission]: translationKey(
    "You can read this repository's tasks. Asking AI to work in it takes permission to edit the repository - ask a project admin for it.",
  ),
  [CodeTaskBlockerType.PlanRequired]: translationKey(
    "AI in Code needs the Growth plan or above.",
  ),
  [CodeTaskBlockerType.SubscriptionUnpaid]: translationKey(
    "This project's subscription is unpaid, so AI cannot run.",
  ),
  [CodeTaskBlockerType.AiDisabled]: translationKey(
    "AI is turned off for this project.",
  ),
  [CodeTaskBlockerType.RepositoryNotConnected]: translationKey(
    "AI can only work in a GitHub repository connected through the GitHub App, and this one is not connected.",
  ),
  [CodeTaskBlockerType.NoLlmProvider]: translationKey(
    "AI needs an LLM provider for this project.",
  ),
  [CodeTaskBlockerType.NoAiCredits]: translationKey(
    "This project's AI credits are used up.",
  ),
  [CodeTaskBlockerType.NoAgent]: translationKey(
    "No Runner is online to do the work. AI works in your code through a Runner with Runs AI Code Fixes turned on.",
  ),
};

/*
 * What fixes each thing that stops AI working in a repository: the page and
 * the words on its link. No link where there is nothing the reader can open
 * (a permission they have to ask for, a limit that resets at midnight). AI
 * credits are not here: only a project owner or someone with Manage Billing
 * may add them, so CodeBlockerNotice asks first and links AI Credits only
 * for them (CODE_TASK_ADD_AI_CREDITS), telling everyone else who can. It
 * asks the same before linking the AI switch, LLM providers and Runners
 * (CODE_TASK_BLOCKER_WHO_CAN_FIX).
 */
export interface CodeTaskBlockerFix {
  pageMap: PageMap;
  title: string;
}

// The words on the AI Credits link, for someone who may add AI credits.
export const CODE_TASK_ADD_AI_CREDITS: string =
  translationKey("Add AI credits");

export const CODE_TASK_BLOCKER_FIXES: Partial<
  Record<CodeTaskBlockerType, CodeTaskBlockerFix>
> = {
  [CodeTaskBlockerType.PlanRequired]: {
    pageMap: PageMap.SETTINGS_BILLING,
    title: translationKey("Upgrade the plan"),
  },
  [CodeTaskBlockerType.SubscriptionUnpaid]: {
    pageMap: PageMap.SETTINGS_BILLING,
    title: translationKey("Update billing"),
  },
  [CodeTaskBlockerType.AiDisabled]: {
    pageMap: PageMap.SETTINGS_AI_FEATURES,
    title: translationKey("Turn AI on"),
  },
  [CodeTaskBlockerType.RepositoryNotConnected]: {
    pageMap: PageMap.CODE,
    title: translationKey("Connect GitHub"),
  },
  [CodeTaskBlockerType.NoLlmProvider]: {
    pageMap: PageMap.SETTINGS_AI_LLM_PROVIDERS,
    title: translationKey("Add an LLM provider"),
  },
  [CodeTaskBlockerType.NoAgent]: {
    pageMap: PageMap.RUNBOOKS_RUNNERS,
    title: translationKey("Set up a Runner"),
  },
};

/*
 * What someone who may not make a blocker's fix reads instead of its link:
 * who can, and where (CodeBlockerNotice asks who may). AI credits say it
 * with WHO_CAN_ADD_AI_CREDITS, as the AI Credits page does.
 */
export const CODE_TASK_BLOCKER_WHO_CAN_FIX: Partial<
  Record<CodeTaskBlockerType, string>
> = {
  [CodeTaskBlockerType.AiDisabled]: translationKey(
    "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI → AI Features.",
  ),
  [CodeTaskBlockerType.NoLlmProvider]: translationKey(
    "A project admin can add an LLM provider in Project Settings → AI → LLM Providers.",
  ),
  [CodeTaskBlockerType.NoAgent]: translationKey(
    "A project admin can set up a Runner in Runbooks → Runners.",
  ),
};

/*
 * What the Add context dialog says when a piece of context breaks the
 * shared rules (CodeTaskContextInputUtil, which the server reads it with
 * too). The rules write in English; these are the refusals a person can
 * reach from the dialog - an empty field cannot be added and every input is
 * capped at its limit - kept as keys so the dialog's alert draws them in the
 * reader's language. A test holds them to the rules' own words.
 */
export const CODE_CONTEXT_REFUSALS: Array<string> = [
  translationKey("A path must stay inside the repository (no '..')."),
  translationKey("A path cannot hold control characters."),
  translationKey(
    "A link must be a full web address, starting with https:// or http://.",
  ),
  translationKey(
    "A trace ID is 32 (or 16) hexadecimal characters, as it appears on the trace's page.",
  ),
];

// What a failed turn says above its reason: plain words, not "turn".
export const CODE_TURN_FAILED: string = translationKey("AI could not finish.");

/*
 * What a person can ask AI in a repository with no tasks yet. Each fills
 * the request box; none is sent until they send it.
 */
export const CODE_TASK_EXAMPLE_REQUESTS: Array<string> = [
  translationKey("Explain how this repository is organized"),
  translationKey("Find the cause of the most frequent error and fix it"),
  translationKey("Add tests for the code that has none"),
  translationKey("Add structured logging to the request handlers"),
];
