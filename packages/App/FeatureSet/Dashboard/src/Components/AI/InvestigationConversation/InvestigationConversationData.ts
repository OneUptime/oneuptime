import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
} from "Common/Types/AI/AIChatPermissionMode";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
} from "Common/Types/AI/AIChatTypes";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { AIInvestigationStage } from "../AIInvestigationStatus";

/*
 * The AI Investigation card's conversation, as data: parsing the thread the
 * API returns, and the small decisions the view makes about it (who is
 * asking, whether the viewer can send, what to suggest, how much of a long
 * thread to open with). Pure, so the rules read in one place and are tested
 * without rendering anything.
 */

export type InvestigationConversationSubjectType = "incident" | "alert";

// How often the box re-reads the thread.
export const THREAD_POLL_BUSY_MS: number = 1500;
export const THREAD_POLL_IDLE_MS: number = 8000;
export const THREAD_POLL_HIDDEN_MS: number = 30_000;

// The longest question the server accepts.
export const MAX_THREAD_QUESTION_LENGTH: number = 8000;

/*
 * The thread is part of the card, not a scrolling box inside it, so a long
 * one opens on its newest messages with the rest one click away. It only
 * folds once it is clearly longer than what it would keep: hiding a single
 * exchange behind a button saves nothing.
 */
export const THREAD_TAIL_LENGTH: number = 6;
export const THREAD_FOLD_ABOVE_LENGTH: number = 8;

// Where the viewer's last chosen permission mode is remembered.
export const THREAD_PERMISSION_MODE_STORAGE_KEY: string =
  "oneuptime.investigationConversation.permissionMode";

/*
 * The mode a question runs in until the viewer picks another: act on a
 * clear request straight away, within the asker's own permissions.
 */
export const DEFAULT_THREAD_PERMISSION_MODE: AIChatPermissionMode =
  AIChatPermissionMode.AutoRun;

export const AI_DISPLAY_NAME: string = "OneUptime AI";

export interface ThreadAuthor {
  userId: string | null;
  name: string;
}

export interface ThreadMessage {
  id: string;
  role: AIChatMessageRole;
  content: string;
  status: AIChatMessageStatus;
  citations: Array<AIChatCitation>;
  widgets: Array<AIChatWidget>;
  toolActions: Array<AIChatToolAction>;
  errorMessage: string | null;
  aiRunId: string | null;
  createdAt: Date | null;
  author: ThreadAuthor;
  // A question shown before the server confirmed it.
  isOptimistic?: boolean | undefined;
}

export interface ThreadActiveRun {
  aiRunId: string;
  assistantMessageId: string | null;
  status: AIRunStatus | null;
  startedAt: Date | null;
  events: Array<AIRunEvent>;
}

export interface ThreadView {
  conversationId: string | null;
  messages: Array<ThreadMessage>;
  activeRun: ThreadActiveRun | null;
  isBusy: boolean;
  viewerUserId: string | null;
}

export interface SuggestedPrompt {
  label: string;
  prompt: string;
  /*
   * A request to CHANGE something. It is placed in the composer for the
   * responder to send, never sent on click — a question can be asked in one
   * click, an action is always a deliberate send.
   */
  isAction?: boolean | undefined;
}

export const EMPTY_THREAD_VIEW: ThreadView = {
  conversationId: null,
  messages: [],
  activeRun: null,
  isBusy: false,
  viewerUserId: null,
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function asArray<T>(value: unknown): Array<T> {
  return Array.isArray(value) ? (value as Array<T>) : [];
}

const MESSAGE_ROLES: Array<string> = Object.values(AIChatMessageRole);
const MESSAGE_STATUSES: Array<string> = Object.values(AIChatMessageStatus);
const RUN_STATUSES: Array<string> = Object.values(AIRunStatus);

export function parseThreadMessage(json: JSONObject): ThreadMessage | null {
  const id: string | null = asString(json["_id"]);
  const role: string | null = asString(json["role"]);
  const status: string | null = asString(json["status"]);

  if (
    !id ||
    !role ||
    !MESSAGE_ROLES.includes(role) ||
    !status ||
    !MESSAGE_STATUSES.includes(status)
  ) {
    return null;
  }

  const authorJson: JSONObject =
    json["author"] && typeof json["author"] === "object"
      ? (json["author"] as JSONObject)
      : {};

  return {
    id,
    role: role as AIChatMessageRole,
    content:
      typeof json["contentInMarkdown"] === "string"
        ? (json["contentInMarkdown"] as string)
        : "",
    status: status as AIChatMessageStatus,
    citations: asArray<AIChatCitation>(json["citations"]),
    widgets: asArray<AIChatWidget>(json["widgets"]),
    toolActions: asArray<AIChatToolAction>(json["toolActions"]),
    errorMessage: asString(json["errorMessage"]),
    aiRunId: asString(json["aiRunId"]),
    createdAt: asDate(json["createdAt"]),
    author: {
      userId: asString(authorJson["userId"]),
      name: asString(authorJson["name"]) || "A responder",
    },
  };
}

export function parseThreadView(
  json: JSONObject | null | undefined,
): ThreadView {
  if (!json || typeof json !== "object") {
    return EMPTY_THREAD_VIEW;
  }

  const messages: Array<ThreadMessage> = asArray<JSONObject>(json["messages"])
    .map((messageJson: JSONObject): ThreadMessage | null => {
      return messageJson && typeof messageJson === "object"
        ? parseThreadMessage(messageJson)
        : null;
    })
    .filter((message: ThreadMessage | null): message is ThreadMessage => {
      return message !== null;
    });

  const activeRunJson: JSONObject | null =
    json["activeRun"] && typeof json["activeRun"] === "object"
      ? (json["activeRun"] as JSONObject)
      : null;

  let activeRun: ThreadActiveRun | null = null;

  if (activeRunJson && asString(activeRunJson["aiRunId"])) {
    const runStatus: string | null = asString(activeRunJson["status"]);

    activeRun = {
      aiRunId: asString(activeRunJson["aiRunId"])!,
      assistantMessageId: asString(activeRunJson["assistantMessageId"]),
      status:
        runStatus && RUN_STATUSES.includes(runStatus)
          ? (runStatus as AIRunStatus)
          : null,
      startedAt: asDate(activeRunJson["startedAt"]),
      events: AIRunEvent.fromJSONArray(
        asArray<JSONObject>(activeRunJson["events"]) as JSONArray,
        AIRunEvent,
      ),
    };
  }

  return {
    conversationId: asString(json["conversationId"]),
    messages,
    activeRun,
    isBusy: json["isBusy"] === true,
    viewerUserId: asString(json["viewerUserId"]),
  };
}

/*
 * What changed, cheaply: the box re-renders only when the thread really
 * moved (a new message, a status, a new live step).
 */
export function getThreadSignature(view: ThreadView): string {
  return JSON.stringify({
    conversationId: view.conversationId,
    isBusy: view.isBusy,
    messages: view.messages.map((message: ThreadMessage): Array<unknown> => {
      return [
        message.id,
        message.status,
        message.content.length,
        message.toolActions.map((action: AIChatToolAction): string => {
          return `${action.id}:${action.status}`;
        }),
        message.citations.length,
        message.widgets.length,
        message.errorMessage,
      ];
    }),
    activeRun: view.activeRun
      ? [
          view.activeRun.aiRunId,
          view.activeRun.status,
          view.activeRun.events.length,
        ]
      : null,
  });
}

export function isViewer(
  author: ThreadAuthor,
  viewerUserId: string | null,
): boolean {
  return Boolean(viewerUserId && author.userId === viewerUserId);
}

// "You" for the viewer, the person's name for everyone else.
export function describeAuthor(
  author: ThreadAuthor,
  viewerUserId: string | null,
): string {
  return isViewer(author, viewerUserId) ? "You" : author.name;
}

// Possessive for the "working on …'s question" line.
export function describeAuthorPossessive(
  author: ThreadAuthor,
  viewerUserId: string | null,
): string {
  if (isViewer(author, viewerUserId)) {
    return "your";
  }

  const name: string = author.name.trim() || "a responder";

  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

export function getInitials(name: string): string {
  const parts: Array<string> = name
    .replace(/[^\p{L}\p{N}\s@._-]/gu, " ")
    .split(/[\s@._-]+/)
    .filter(Boolean);

  const first: string = parts[0]?.charAt(0) || "";
  const second: string = parts.length > 1 ? parts[1]!.charAt(0) : "";

  return (first + second).toUpperCase() || "?";
}

/*
 * Each responder keeps one avatar colour, derived from who they are. Every
 * tone here has a dark-theme rule in Theme.css; a tone without one (lime
 * used to be the eighth) stays a pale disc on the dark card.
 */
export const AVATAR_TONES: ReadonlyArray<string> = [
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-cyan-100 text-cyan-700",
];

export function getAvatarTone(seed: string): string {
  let hash: number = 0;

  for (let index: number = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }

  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}

// The assistant message still being written, if any.
export function findActiveAssistantMessage(
  view: ThreadView,
): ThreadMessage | undefined {
  return [...view.messages].reverse().find((message: ThreadMessage) => {
    return (
      message.role === AIChatMessageRole.Assistant &&
      (message.status === AIChatMessageStatus.InProgress ||
        message.status === AIChatMessageStatus.Pending ||
        message.status === AIChatMessageStatus.WaitingForApproval)
    );
  });
}

export function isThreadBusy(view: ThreadView): boolean {
  return view.isBusy || Boolean(findActiveAssistantMessage(view));
}

/*
 * One sentence on what the AI is doing right now, naming whose question it
 * is on — or null when it is idle.
 */
export function describeThreadActivity(view: ThreadView): string | null {
  const active: ThreadMessage | undefined = findActiveAssistantMessage(view);

  if (!active) {
    return null;
  }

  const whose: string = describeAuthorPossessive(
    active.author,
    view.viewerUserId,
  );

  if (active.status === AIChatMessageStatus.WaitingForApproval) {
    return `${AI_DISPLAY_NAME} is waiting for someone to approve an action on ${whose} request.`;
  }

  return `${AI_DISPLAY_NAME} is working on ${whose} question…`;
}

export function hasPendingApproval(message: ThreadMessage): boolean {
  return (
    message.status === AIChatMessageStatus.WaitingForApproval &&
    message.toolActions.some(isToolActionAwaitingApproval)
  );
}

/*
 * Why the viewer cannot send right now, or null when they can. Typing is
 * never blocked — only sending.
 */
export function getSendBlocker(data: {
  view: ThreadView;
  input: string;
  isSending: boolean;
}): string | null {
  if (data.isSending) {
    return "Sending…";
  }

  if (!data.input.trim()) {
    return "Type a question or a request.";
  }

  if (data.input.trim().length > MAX_THREAD_QUESTION_LENGTH) {
    return `Keep it under ${MAX_THREAD_QUESTION_LENGTH.toLocaleString("en-US")} characters.`;
  }

  if (isThreadBusy(data.view)) {
    return describeThreadActivity(data.view) || "OneUptime AI is busy.";
  }

  return null;
}

/*
 * Starting points for an empty thread: the questions responders actually
 * ask in the first minutes, and the requests that save them clicks.
 *
 * When the card above has no report to read (nothing ran, the run stopped,
 * or it finished without one) the first thing to ask is the question the
 * report would have answered, so it leads. It is not offered while an
 * investigation is still underway, or before the card knows.
 */
export function getSuggestedPrompts(
  subjectType: InvestigationConversationSubjectType,
  stage?: AIInvestigationStage | undefined,
): Array<SuggestedPrompt> {
  const prompts: Array<SuggestedPrompt> = [
    {
      label: "What should I do right now?",
      prompt: `What should I do right now to mitigate this ${subjectType}? Give me the next steps in order.`,
    },
    {
      label: "What changed just before this?",
      prompt: `What changed right before this ${subjectType} started — deploys, config, traffic, errors?`,
    },
    {
      label: "Is anything else affected?",
      prompt: `Is anything else affected by this ${subjectType}? Check related services, monitors and open ${subjectType}s.`,
    },
    {
      label: "Draft a status update",
      prompt: `Draft a short, customer-facing status update for this ${subjectType}. Don't post it yet.`,
    },
    {
      label: `Acknowledge this ${subjectType}`,
      prompt: `Acknowledge this ${subjectType}.`,
      isAction: true,
    },
  ];

  if (stage === "none") {
    prompts.unshift({
      label: "What is the root cause?",
      prompt: `What is the most likely root cause of this ${subjectType}? Investigate it and cite the evidence.`,
    });
  }

  return prompts;
}

/*
 * One line under the section's title: what the box is for, and that it is
 * shared. "Follow-up" only makes sense under a report.
 */
export function describeConversation(
  subjectType: InvestigationConversationSubjectType,
  stage?: AIInvestigationStage | undefined,
): string {
  const ask: string =
    stage === "reported"
      ? "Ask a follow-up question, or ask it to act."
      : `Ask a question about this ${subjectType}, or ask it to act.`;

  return `${ask} Everyone on this ${subjectType} sees this conversation.`;
}

export interface ThreadTail {
  // Earlier messages left out until the reader asks for them.
  hiddenCount: number;
  messages: Array<ThreadMessage>;
}

/*
 * The messages a thread opens with. An answer is never shown without the
 * question it is for: when the cut would start on an answer, it moves back
 * to that question.
 */
export function getThreadTail(
  messages: Array<ThreadMessage>,
  showAll: boolean,
): ThreadTail {
  if (showAll || messages.length <= THREAD_FOLD_ABOVE_LENGTH) {
    return { hiddenCount: 0, messages };
  }

  let start: number = messages.length - THREAD_TAIL_LENGTH;

  if (
    messages[start]!.role === AIChatMessageRole.Assistant &&
    messages[start - 1]!.role === AIChatMessageRole.User
  ) {
    start -= 1;
  }

  return { hiddenCount: start, messages: messages.slice(start) };
}

export interface ToolActionOutcome {
  icon: IconProp;
  // The mark's colour; the words stay in the card's own greys.
  iconClassName: string;
  label: string;
}

/*
 * How an action that is no longer waiting for anyone reads in the thread: a
 * mark and one word after its title.
 */
export function describeToolActionOutcome(
  status: AIChatToolActionStatus,
): ToolActionOutcome {
  switch (status) {
    case AIChatToolActionStatus.Executed:
      return {
        icon: IconProp.CheckCircle,
        iconClassName: "text-emerald-600",
        label: "Done",
      };
    case AIChatToolActionStatus.Approved:
      return {
        icon: IconProp.Check,
        iconClassName: "text-emerald-600",
        label: "Approved",
      };
    case AIChatToolActionStatus.Failed:
      return {
        icon: IconProp.Alert,
        iconClassName: "text-red-600",
        label: "Failed",
      };
    case AIChatToolActionStatus.Denied:
      return {
        icon: IconProp.Close,
        iconClassName: "text-gray-400",
        label: "Denied",
      };
    case AIChatToolActionStatus.Skipped:
      return {
        icon: IconProp.Close,
        iconClassName: "text-gray-400",
        label: "Skipped",
      };
    default:
      return {
        icon: IconProp.Clock,
        iconClassName: "text-gray-400",
        label: "Pending",
      };
  }
}

// An action the answer is paused on until someone decides.
export function isToolActionAwaitingApproval(
  action: AIChatToolAction,
): boolean {
  return (
    action.status === AIChatToolActionStatus.Pending && action.requiresApproval
  );
}

// The permission mode stored for the viewer, or the default.
export function parseStoredPermissionMode(
  value: string | null | undefined,
): AIChatPermissionMode {
  return AIChatPermissionModeHelper.isValid(value || undefined)
    ? (value as AIChatPermissionMode)
    : DEFAULT_THREAD_PERMISSION_MODE;
}

/*
 * What the chosen mode means, as the caption beside its picker in the
 * composer. The picker names the mode and the box is for asking OneUptime
 * AI, so the sentence does not say who acts again: without that it fits on
 * the picker's row in the two-thirds column of a 1280px page.
 */
export function describePermissionMode(mode: AIChatPermissionMode): string {
  switch (mode) {
    case AIChatPermissionMode.AutoRun:
      return "Acts on clear requests right away, within your permissions.";
    case AIChatPermissionMode.AskForApproval:
      return "Asks for approval before it changes anything.";
    case AIChatPermissionMode.ReadOnly:
      return "Only reads and answers. It never changes anything.";
    default:
      return "";
  }
}

/*
 * Widgets carry raw rows fetched under the ASKER's permissions, so the
 * shared thread shows them only to the person who asked; everyone else
 * reads the cited answer (the same trust model as the RCA note posted to
 * the incident timeline).
 */
export function getVisibleWidgets(
  message: ThreadMessage,
  viewerUserId: string | null,
): Array<AIChatWidget> {
  return isViewer(message.author, viewerUserId) ? message.widgets : [];
}

// A question the viewer just sent, shown before the server confirms it.
export function buildOptimisticQuestion(data: {
  content: string;
  viewerUserId: string | null;
  viewerName: string;
  now: Date;
}): ThreadMessage {
  return {
    id: `optimistic-${data.now.getTime()}`,
    role: AIChatMessageRole.User,
    content: data.content,
    status: AIChatMessageStatus.Completed,
    citations: [],
    widgets: [],
    toolActions: [],
    errorMessage: null,
    aiRunId: null,
    createdAt: data.now,
    author: { userId: data.viewerUserId, name: data.viewerName },
    isOptimistic: true,
  };
}
