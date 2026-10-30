import {
  AIFixReadiness,
  AIFixReadinessCheck,
  AIFixReadinessCheckId,
} from "Common/Types/AI/AIFixReadiness";
import AIRunStatus, { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import FixProductionStatus, {
  FixProductionStatusHelper,
} from "Common/Types/AI/FixProductionStatus";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "./PageMap";

/*
 * Pure state for the exception AI Assistance page. The page shows one card
 * per task type; everything that decides what a card says and which button
 * it offers lives here so every status can be tested without rendering.
 */

/*
 * The exception's latest AI attempt per task type. AI tasks are CodeFix
 * AIRuns now, so `status` carries AIRunStatus strings (Queued / Running /
 * WaitingForApproval / Completed / NoFixFound / Error / Cancelled / Stale);
 * the endpoint keeps its legacy JSON keys and adds `taskType` per task.
 */
export interface AIAgentTaskInfo {
  _id: string;
  status: AIRunStatus;
  statusMessage: string | undefined;
  statusTitle: string;
  statusDescription: string;
  createdAt: Date;
  taskType: string;
  // Whether the task's merged fix fixed the exception in production.
  production?: AIFixProductionInfo | undefined;
}

/*
 * What production showed about a merged fix (FixProductionVerifier on the
 * server): waiting for the deploy that ships it, watching it, or decided.
 */
export interface AIFixProductionInfo {
  status: FixProductionStatus;
  summary: string | undefined;
  deployedVersion: string | undefined;
  deployedCommitSha: string | undefined;
  deployedAt: Date | undefined;
  statusAt: Date | undefined;
}

// An exception fix's words; FixProduction.ts has every kind of fix's.
export const FIX_PRODUCTION_LABELS: Record<FixProductionStatus, string> = {
  [FixProductionStatus.AwaitingDeploy]: translationKey(
    "Merged, waiting for a deploy",
  ),
  [FixProductionStatus.Watching]: translationKey(
    "Deployed, watching in production",
  ),
  [FixProductionStatus.Verified]: translationKey("Fixed in production"),
  [FixProductionStatus.Regressed]: translationKey(
    "Still happening after the fix",
  ),
  [FixProductionStatus.Unverifiable]: translationKey(
    "Not verified in production",
  ),
};

export function getFixProductionTone(status: FixProductionStatus): AITaskTone {
  switch (status) {
    case FixProductionStatus.Verified:
      return "success";
    case FixProductionStatus.Regressed:
      return "danger";
    case FixProductionStatus.Unverifiable:
      return "neutral";
    default:
      return "info";
  }
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return undefined;
  }

  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/*
 * A task's production verdict as the server sends it, or undefined - for a
 * task without one, an older server, or a status this dashboard does not
 * know.
 */
export function parseFixProduction(
  value: unknown,
): AIFixProductionInfo | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const json: JSONObject = value as JSONObject;
  const status: FixProductionStatus | undefined =
    FixProductionStatusHelper.fromDatabaseValue(json["status"]);

  if (!status) {
    return undefined;
  }

  return {
    status,
    summary:
      typeof json["summary"] === "string" && json["summary"]
        ? json["summary"]
        : undefined,
    deployedVersion:
      typeof json["deployedVersion"] === "string" && json["deployedVersion"]
        ? json["deployedVersion"]
        : undefined,
    deployedCommitSha:
      typeof json["deployedCommitSha"] === "string" && json["deployedCommitSha"]
        ? json["deployedCommitSha"]
        : undefined,
    deployedAt: parseDate(json["deployedAt"]),
    statusAt: parseDate(json["statusAt"]),
  };
}

// The task types this page can start (FixException is the legacy default).
export type ExceptionAITaskType =
  | CodeFixTaskType.FixException
  | CodeFixTaskType.WriteRegressionTest
  | CodeFixTaskType.ImproveExceptionHandling;

export interface AITaskPresentation {
  taskType: ExceptionAITaskType;
  title: string;
  description: string;
  icon: IconProp;
  startActionName: string;
  restartActionName: string;
  retryActionName: string;
}

export const AI_TASK_PRESENTATION: {
  [key in ExceptionAITaskType]: AITaskPresentation;
} = {
  [CodeFixTaskType.FixException]: {
    taskType: CodeFixTaskType.FixException,
    title: "Fix this exception with AI",
    description:
      "AI will analyze this exception, identify the root cause, and submit a Pull Request with the fix to your code repository.",
    icon: IconProp.Bolt,
    startActionName: "Fix with AI",
    restartActionName: "Fix Again",
    retryActionName: "Retry Fix",
  },
  [CodeFixTaskType.WriteRegressionTest]: {
    taskType: CodeFixTaskType.WriteRegressionTest,
    title: "Generate Regression Test",
    description:
      "AI will write a failing test that reproduces this exception and open a Pull Request with it. This does not fix the bug — the test should fail until the bug is fixed.",
    icon: IconProp.Beaker,
    startActionName: "Generate Regression Test",
    restartActionName: "Generate Again",
    retryActionName: "Retry Regression Test",
  },
  [CodeFixTaskType.ImproveExceptionHandling]: {
    taskType: CodeFixTaskType.ImproveExceptionHandling,
    title: "Improve Error Handling",
    description:
      "For expected errors (invalid user input, intentional denials): AI will open a Pull Request that parameterizes messages leaking user data, validates input earlier with an actionable error, and marks the error as handled in telemetry — without changing behavior.",
    icon: IconProp.ShieldCheck,
    startActionName: "Improve Error Handling",
    restartActionName: "Improve Again",
    retryActionName: "Retry Error Handling",
  },
};

// The order the cards render in.
export const EXCEPTION_AI_TASK_TYPES: ReadonlyArray<ExceptionAITaskType> = [
  CodeFixTaskType.FixException,
  CodeFixTaskType.WriteRegressionTest,
  CodeFixTaskType.ImproveExceptionHandling,
];

// A task still making progress (not in a terminal status).
export function isAITaskActive(task: AIAgentTaskInfo): boolean {
  return !AIRunStatusHelper.isTerminalStatus(task.status);
}

/*
 * Failed attempts (agent errored, or stopped reporting progress and went
 * Stale) stay visible with a retry.
 */
export function isAITaskFailed(task: AIAgentTaskInfo): boolean {
  return (
    !isAITaskActive(task) &&
    (task.status === AIRunStatus.Error || task.status === AIRunStatus.Stale)
  );
}

/*
 * The attempt ran to completion but proposed nothing. Not a failure, but it
 * offers a retry too — a repeat run can succeed where one before it found
 * nothing.
 */
export function isAITaskNoFixFound(task: AIAgentTaskInfo): boolean {
  return !isAITaskActive(task) && task.status === AIRunStatus.NoFixFound;
}

// Any terminal attempt that produced no pull request.
export function isAITaskUnsuccessful(task: AIAgentTaskInfo): boolean {
  return isAITaskFailed(task) || isAITaskNoFixFound(task);
}

export function isAITaskCompleted(task: AIAgentTaskInfo): boolean {
  return !isAITaskActive(task) && task.status === AIRunStatus.Completed;
}

export function parseAIAgentTask(taskData: JSONObject): AIAgentTaskInfo {
  return {
    _id: String(taskData["_id"] || ""),
    status: taskData["status"] as AIRunStatus,
    statusMessage: (taskData["statusMessage"] as string) || undefined,
    statusTitle: (taskData["statusTitle"] as string) || "",
    statusDescription: (taskData["statusDescription"] as string) || "",
    createdAt: new Date(taskData["createdAt"] as string),
    // Older servers omit taskType — every task they know about is a fix.
    taskType: (taskData["taskType"] as string) || CodeFixTaskType.FixException,
    production: parseFixProduction(taskData["production"]),
  };
}

/*
 * The get-ai-agent-task endpoint returns the LATEST task per task type, of
 * ANY status (terminal tasks included, so failed attempts stay visible).
 * Older servers only send the single latest task as `aiAgentTask`, which is
 * implicitly a fix task.
 */
export function parseAIAgentTasksResponse(
  data: JSONObject | null | undefined,
): Array<AIAgentTaskInfo> {
  if (!data || typeof data !== "object") {
    return [];
  }

  const tasksJson: unknown = data["aiAgentTasks"];

  if (Array.isArray(tasksJson) && tasksJson.length > 0) {
    return (tasksJson as JSONArray)
      .filter((task: unknown): boolean => {
        return Boolean(task) && typeof task === "object";
      })
      .map((task: unknown): AIAgentTaskInfo => {
        return parseAIAgentTask(task as JSONObject);
      });
  }

  if (data["aiAgentTask"] && typeof data["aiAgentTask"] === "object") {
    return [parseAIAgentTask(data["aiAgentTask"] as JSONObject)];
  }

  return [];
}

export function parseAIFixReadinessResponse(
  data: JSONObject | null | undefined,
): AIFixReadiness {
  const checksJson: unknown = data?.["checks"];

  return {
    ready: Boolean(data?.["ready"]),
    checks: (Array.isArray(checksJson) ? (checksJson as JSONArray) : [])
      .filter((check: unknown): boolean => {
        return Boolean(check) && typeof check === "object";
      })
      .map((check: unknown): AIFixReadinessCheck => {
        const record: JSONObject = check as JSONObject;

        return {
          id: record["id"] as AIFixReadinessCheckId,
          ok: Boolean(record["ok"]),
          title: (record["title"] as string) || "",
          detail: (record["detail"] as string) || "",
        };
      }),
  };
}

export function findLatestAITask(
  tasks: ReadonlyArray<AIAgentTaskInfo>,
  taskType: ExceptionAITaskType,
): AIAgentTaskInfo | undefined {
  return tasks.find((task: AIAgentTaskInfo): boolean => {
    return task.taskType === taskType;
  });
}

// A deep link that takes the user to the page where a failing check is fixed.
export interface ReadinessCheckLink {
  title: string;
  pageMap: PageMap;
}

export function getReadinessCheckLink(
  checkId: AIFixReadinessCheckId,
): ReadinessCheckLink | null {
  if (checkId === "llmProvider") {
    return {
      title: "Configure LLM Providers",
      pageMap: PageMap.SETTINGS_AI_LLM_PROVIDERS,
    };
  }

  /*
   * The server reports the repository check as "repositoryConnected" (GitHub
   * App) today and "repositoryResolved" on older releases; both are fixed in
   * Code, where the repositories are connected.
   */
  if (checkId === "repositoryResolved" || checkId === "repositoryConnected") {
    return {
      title: "Connect a Code Repository",
      pageMap: PageMap.CODE,
    };
  }

  if (checkId === "agentAvailable") {
    return {
      title: "Set up a Runner",
      pageMap: PageMap.RUNBOOKS_RUNNERS,
    };
  }

  return null;
}

export interface AIReadinessProgress {
  total: number;
  passed: number;
  percent: number;
}

export function getAIReadinessProgress(
  readiness: AIFixReadiness | undefined,
): AIReadinessProgress {
  const total: number = readiness?.checks.length || 0;
  const passed: number = (readiness?.checks || []).filter(
    (check: AIFixReadinessCheck): boolean => {
      return check.ok;
    },
  ).length;

  return {
    total,
    passed,
    percent: total === 0 ? 0 : Math.round((passed / total) * 100),
  };
}

export type AITaskTone = "neutral" | "info" | "success" | "warning" | "danger";

// How each tone is drawn: a tinted background, its text, and a hairline ring.
export const AI_TASK_TONE_CLASS_NAMES: Record<AITaskTone, string> = {
  neutral: "bg-gray-50 text-gray-600 ring-gray-500/20",
  info: "bg-sky-50 text-sky-700 ring-sky-600/20",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  danger: "bg-red-50 text-red-700 ring-red-600/20",
};

export type AITaskPrimaryActionKind = "start" | "restart" | "retry";

export interface AITaskPrimaryAction {
  kind: AITaskPrimaryActionKind;
  label: string;
  isDisabled: boolean;
  disabledReason: string | undefined;
}

export interface AITaskCardState {
  tone: AITaskTone;
  statusLabel: string;
  // Extra detail under the status: the agent's own message when it sent one.
  message: string | undefined;
  isActive: boolean;
  canViewTask: boolean;
  primaryAction: AITaskPrimaryAction | null;
}

export interface AITaskCardStateArgs {
  task: AIAgentTaskInfo | undefined;
  presentation: AITaskPresentation;
  isResolved: boolean;
  isArchived: boolean;
  isTasksLoading: boolean;
  isBlockedBySetup: boolean;
  /*
   * Why this person may not start a task (they may not edit the
   * repository it would work in - PermissionGate's words), first: nothing
   * else on the card is theirs to change.
   */
  startRefusedReason?: string | undefined;
}

export const AI_TASKS_PAUSED_REASON: string = translationKey(
  "Reopen and unarchive this exception to start AI tasks.",
);

export const AI_TASKS_SETUP_REASON: string = translationKey(
  "Finish the setup checklist above to start AI tasks.",
);

export const AI_TASKS_LOADING_REASON: string = translationKey(
  "Checking for tasks that are already running.",
);

/*
 * The first sentence of why a person may not start an AI task: the task
 * works in the exception's repository, and the server asks for permission
 * to edit it (TelemetryExceptionService.createCodeFixRunForException).
 * PermissionGate adds what would allow it.
 */
export const AI_TASKS_NOT_ALLOWED_SENTENCE: string = translationKey(
  "AI tasks work in this exception's repository, so starting one takes permission to edit it.",
);

function getStatusDisplay(task: AIAgentTaskInfo | undefined): {
  tone: AITaskTone;
  label: string;
} {
  if (!task) {
    return { tone: "neutral", label: "Not started" };
  }

  switch (task.status) {
    case AIRunStatus.Queued:
      return { tone: "info", label: "Queued" };
    case AIRunStatus.Running:
      return { tone: "info", label: "In progress" };
    case AIRunStatus.WaitingForApproval:
      return { tone: "warning", label: "Waiting for approval" };
    case AIRunStatus.Completed:
      return { tone: "success", label: "Completed" };
    // Nothing went wrong — the agent just had nothing to propose.
    case AIRunStatus.NoFixFound:
      return { tone: "neutral", label: "No change proposed" };
    case AIRunStatus.Error:
      return { tone: "danger", label: "Failed" };
    case AIRunStatus.Stale:
      return { tone: "danger", label: "Stopped responding" };
    case AIRunStatus.Cancelled:
      return { tone: "neutral", label: "Cancelled" };
    default:
      return { tone: "neutral", label: task.statusTitle || "Unknown" };
  }
}

/*
 * What one task card shows. The gates mirror the server: it refuses new
 * tasks for resolved or archived exceptions and while a task of the same
 * type is still active, and it re-checks readiness on create.
 */
export function getAITaskCardState(args: AITaskCardStateArgs): AITaskCardState {
  const { task, presentation } = args;
  const status: { tone: AITaskTone; label: string } = getStatusDisplay(task);
  const isActive: boolean = Boolean(task && isAITaskActive(task));

  const message: string | undefined = task
    ? task.statusMessage || task.statusDescription || undefined
    : undefined;

  let primaryAction: AITaskPrimaryAction | null = null;

  if (!isActive) {
    let kind: AITaskPrimaryActionKind = "start";
    let label: string = presentation.startActionName;

    if (task && isAITaskUnsuccessful(task)) {
      kind = "retry";
      label = presentation.retryActionName;
    } else if (task && isAITaskCompleted(task)) {
      kind = "restart";
      label = presentation.restartActionName;
    }

    let disabledReason: string | undefined = undefined;

    if (args.startRefusedReason) {
      disabledReason = args.startRefusedReason;
    } else if (args.isResolved || args.isArchived) {
      disabledReason = AI_TASKS_PAUSED_REASON;
    } else if (args.isBlockedBySetup) {
      disabledReason = AI_TASKS_SETUP_REASON;
    } else if (args.isTasksLoading) {
      disabledReason = AI_TASKS_LOADING_REASON;
    }

    primaryAction = {
      kind,
      label,
      isDisabled: Boolean(disabledReason),
      disabledReason,
    };
  }

  return {
    tone: status.tone,
    statusLabel: status.label,
    message,
    isActive,
    canViewTask: Boolean(task && task._id),
    primaryAction,
  };
}
