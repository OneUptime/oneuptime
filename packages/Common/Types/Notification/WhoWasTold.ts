import CallStatus from "../Call/CallStatus";
import MailStatus from "../Mail/MailStatus";
import OnCallDutyExecutionLogTimelineStatus from "../OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { OnCallPageChannel } from "../OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageDeliveryStatus,
  OnCallTestPageRecordKind,
  OnCallTestPageStepStatus,
} from "../OnCallDutyPolicy/OnCallTestPage";
import PushStatus from "../PushNotification/PushStatus";
import SmsStatus from "../SmsStatus";
import StatusPageSubscriberNotificationStatus from "../StatusPage/StatusPageSubscriberNotificationStatus";
import TelegramStatus from "../TelegramStatus";
import WebhookStatus from "../WebhookStatus";
import WhatsAppStatus from "../WhatsAppStatus";
import WorkspaceNotificationStatus from "../Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../Workspace/WorkspaceType";

/*
 * WHO WAS TOLD ABOUT AN INCIDENT OR AN ALERT, AS IT HAPPENED (#7075, part 2
 * of #6810).
 *
 * A monitor's "When this goes down" says who WOULD be told (Types/Monitor
 * /WhoIsTold, a prediction from the records). Once an incident or an alert
 * is open, the question is who WAS told: whom the on-call policies paged and
 * at which level, who was emailed or messaged and by what, what went out,
 * what failed and why, who was skipped and why, which Slack, Microsoft
 * Teams or Mattermost channels and webhooks were posted to, whether status
 * page subscribers heard, and who acknowledged it - in order of time.
 *
 * The answer is read from what happened, never worked out: the record's
 * on-call runs (OnCallDutyPolicyExecutionLog) and their steps
 * (OnCallDutyPolicyExecutionLogTimeline: who a level paged, or the target
 * that reached nobody, and the channels a page went out by), and its
 * notification logs - every email, SMS, call, push, WhatsApp, Telegram,
 * webhook and workspace message OneUptime sent about it. A step's lines and
 * a person's statuses are the ones a test page's result reads
 * (OnCallTestPage: OnCallTestPageStepStatus, OnCallTestPageDeliveryStatus),
 * so the Dashboard words them as it words a test page's chain.
 *
 * AS ITS READER MAY READ IT. The server reads every row as the person asking
 * (Server/Services/WhoWasToldService): the record's own read rule first - a
 * private incident's who-was-told is its owners', Project Owners' and
 * Project Admins' alone, as its logs are (#8913) - then each kind of row by
 * its own rules. What they may not read is never named: it is counted
 * (hiddenNotificationCount, hiddenRunCount), as the AI Logs pages count the
 * commands they leave out (#9155).
 *
 * Grouped by person, then by channel, each with one status; the details -
 * each page and each notification, in order of time - folded under it, so a
 * busy incident's answer stays readable. Pure, with no server or browser
 * APIs: the server hands it the rows (buildWhoWasTold), where a test can
 * hand it any.
 */

// The kinds of notification log a record's notifications are written to.
export enum WhoWasToldLogKind {
  Email = "Email",
  SMS = "SMS",
  Call = "Call",
  Push = "Push",
  WhatsApp = "WhatsApp",
  Telegram = "Telegram",
  Webhook = "Webhook",
  Workspace = "Workspace",
}

export const WHO_WAS_TOLD_LOG_KINDS: ReadonlyArray<WhoWasToldLogKind> = [
  WhoWasToldLogKind.Email,
  WhoWasToldLogKind.SMS,
  WhoWasToldLogKind.Call,
  WhoWasToldLogKind.Push,
  WhoWasToldLogKind.WhatsApp,
  WhoWasToldLogKind.Telegram,
  WhoWasToldLogKind.Webhook,
  WhoWasToldLogKind.Workspace,
];

/*
 * The most rows of one kind one answer reads: the latest, which an incident
 * that pages and emails dozens of people stays well under. More are said to
 * be left out (isTruncated), with the record's Notification Logs for all.
 */
export const WHO_WAS_TOLD_ROWS_PER_KIND: number = 500;

/*
 * How often an open incident's or alert's answer is read again while its
 * page is looked at: a page, its SMS's delivery and a call's answer come in
 * over the first minutes.
 */
export const WHO_WAS_TOLD_REFRESH_INTERVAL_IN_MS: number = 15 * 1000;

// Where a person, a channel or the subscribers stand.
export enum WhoWasToldStatus {
  // They acknowledged a page about it.
  Acknowledged = "Acknowledged",
  // Something reached them: a notification went out, or a page did.
  Told = "Told",
  // Nothing has gone out yet, and something is on its way.
  Sending = "Sending",
  // Nothing went out, and something failed: the reason says why.
  Failed = "Failed",
  // Not paged on purpose (opted out, away, not a member): the step says why.
  Skipped = "Skipped",
}

// One notification, as the answer lists it.
export interface WhoWasToldNotification {
  // Its log's id.
  id: string;
  kind: WhoWasToldLogKind;
  channel: OnCallPageChannel;
  status: OnCallTestPageDeliveryStatus;
  /*
   * Why it did not go out, or how a call ended, as its log says it: the
   * provider's or OneUptime's English, which may name an address - so it is
   * only ever handed to a reader who may read the log itself.
   */
  statusMessage?: string | undefined;
  // A workspace message's: which workspace said no, for its refusal's words.
  workspaceType?: WorkspaceType | undefined;
  // When it was written, as an ISO date.
  sentAt: string;
  // Sent by an on-call page, rather than as an owner or a subscriber is told.
  isOnCallPage: boolean;
}

// One step of an on-call run that paged a person: who, through what, and how it went.
export interface WhoWasToldPage {
  // Its line of the run's timeline.
  id: string;
  runId: string;
  // The policy that paged them; empty for a direct page, which has none.
  policyName: string;
  isDirectPage: boolean;
  levelOrder?: number | undefined;
  levelName?: string | undefined;
  // Why them: the team, the schedule, the person they cover for.
  teamName?: string | undefined;
  scheduleName?: string | undefined;
  isNextInRotation?: boolean | undefined;
  coveringForName?: string | undefined;
  status: OnCallTestPageStepStatus;
  // What the step's line says, in English, for the Dashboard to word.
  statusMessage: string;
  // The run's event type: a test page's lines are worded as its own.
  userNotificationEventType?: string | undefined;
  // The channels the page went out to them by, as the step keeps them.
  channels: Array<OnCallPageChannel>;
  pagedAt: string;
  acknowledgedAt?: string | undefined;
}

// A person who was told, or paged, or skipped.
export interface WhoWasToldPerson {
  userId: string;
  // Empty when the reader may not read their name.
  name: string;
  status: WhoWasToldStatus;
  // When they were first paged or told, and the last time anything was.
  firstAt: string;
  lastAt: string;
  acknowledgedAt?: string | undefined;
  // Each page of theirs, in order of time.
  pages: Array<WhoWasToldPage>;
  // Each notification to them, in order of time.
  notifications: Array<WhoWasToldNotification>;
  // The notifications that did not go out.
  failedCount: number;
}

// A target of an on-call level that reached nobody, and why.
export interface WhoWasToldTarget {
  id: string;
  runId: string;
  policyName: string;
  isDirectPage: boolean;
  levelOrder?: number | undefined;
  levelName?: string | undefined;
  teamName?: string | undefined;
  scheduleName?: string | undefined;
  isNextInRotation?: boolean | undefined;
  // What the step's line says, in English, for the Dashboard to word.
  statusMessage: string;
  userNotificationEventType?: string | undefined;
  at: string;
}

/*
 * A channel that was posted to, rather than a person: a Slack, Microsoft
 * Teams or Mattermost channel, a webhook, an email address no person in the
 * project has.
 */
export interface WhoWasToldChannelGroup {
  // What makes two notifications the same channel's.
  key: string;
  channel: OnCallPageChannel;
  // "#incidents", "hooks.example.com", "ops@example.com" - as written.
  name: string;
  workspaceType?: WorkspaceType | undefined;
  status: WhoWasToldStatus;
  firstAt: string;
  lastAt: string;
  notifications: Array<WhoWasToldNotification>;
  failedCount: number;
}

// One on-call run about the record, as the reader may read it.
export interface WhoWasToldRun {
  id: string;
  // Empty for a direct page, which runs no policy.
  policyId?: string | undefined;
  policyName: string;
  isDirectPage: boolean;
  // The run's own status and line, in English, for the Dashboard to word.
  status: string;
  statusMessage: string;
  userNotificationEventType?: string | undefined;
  startedAt: string;
  acknowledgedAt?: string | undefined;
  acknowledgedByName?: string | undefined;
}

// An incident's status page subscribers: counted, never listed.
export interface WhoWasToldSubscribers {
  /*
   * The record's own "created" notification to its status pages'
   * subscribers, as the incident keeps it, and why when it was not sent.
   */
  status?: StatusPageSubscriberNotificationStatus | undefined;
  statusMessage?: string | undefined;
  /*
   * The notifications to subscribers the reader may read, every one the
   * record sent - its creation, its public notes, its state changes - by
   * the channels counted.
   */
  sentCount: number;
  failedCount: number;
  // Whether the reader may read the counted logs at all.
  areCountsReadable: boolean;
}

export interface WhoWasToldResult {
  recordKind: OnCallTestPageRecordKind;
  recordId: string;
  // When it was read, as an ISO date.
  checkedAt: string;
  // Each person, in the order they were first paged or told.
  people: Array<WhoWasToldPerson>;
  // Each channel, in the order it was first posted to.
  channels: Array<WhoWasToldChannelGroup>;
  // Each target that reached nobody, in order of time.
  notPaged: Array<WhoWasToldTarget>;
  // Each run, in order of time; the Dashboard says the ones that paged nobody.
  runs: Array<WhoWasToldRun>;
  // An incident's status page subscribers; absent for an alert, never public.
  subscribers?: WhoWasToldSubscribers | undefined;
  /*
   * Notifications to people and channels the reader may not read, and runs
   * of policies they may not read: counted, never named.
   */
  hiddenNotificationCount: number;
  hiddenRunCount: number;
  // More rows of some kind than one answer reads: the latest are listed.
  isTruncated: boolean;
}

/*
 * A notification log's row, as the server reads it into this shape: what
 * kind, its own status and line, to whom or where.
 */
export interface WhoWasToldLogRow {
  id: string;
  kind: WhoWasToldLogKind;
  // The log's own status (SmsStatus, MailStatus, CallStatus, ...).
  status: string;
  statusMessage?: string | undefined;
  createdAt: string;
  // The person it went to, when it went to one.
  userId?: string | undefined;
  userName?: string | undefined;
  // Written by an on-call page: it names a policy, a level or a page.
  isOnCallPage: boolean;
  // Where it went, when not to a person: an address, a host, a channel.
  address?: string | undefined;
  workspaceType?: WorkspaceType | undefined;
  channelId?: string | undefined;
  channelName?: string | undefined;
}

// A step of a run's timeline, as the server reads it into this shape.
export interface WhoWasToldStepRow {
  id: string;
  runId: string;
  userId?: string | undefined;
  userName?: string | undefined;
  status: string;
  statusMessage: string;
  userNotificationEventType?: string | undefined;
  createdAt: string;
  isAcknowledged?: boolean | undefined;
  acknowledgedAt?: string | undefined;
  levelOrder?: number | undefined;
  levelName?: string | undefined;
  teamName?: string | undefined;
  scheduleName?: string | undefined;
  isNextInRotation?: boolean | undefined;
  coveringForName?: string | undefined;
  channels: Array<OnCallPageChannel>;
}

// The statuses each kind of log says went out, and that failed; the rest are on their way.
const OUT_STATUSES: Readonly<Record<WhoWasToldLogKind, ReadonlyArray<string>>> =
  {
    [WhoWasToldLogKind.Email]: [MailStatus.Success],
    [WhoWasToldLogKind.SMS]: [SmsStatus.Success, SmsStatus.Sent],
    [WhoWasToldLogKind.Call]: [CallStatus.Success],
    [WhoWasToldLogKind.Push]: [PushStatus.Success],
    [WhoWasToldLogKind.WhatsApp]: [WhatsAppStatus.Success, WhatsAppStatus.Sent],
    [WhoWasToldLogKind.Telegram]: [TelegramStatus.Success, TelegramStatus.Sent],
    [WhoWasToldLogKind.Webhook]: [WebhookStatus.Success],
    [WhoWasToldLogKind.Workspace]: [WorkspaceNotificationStatus.Success],
  };

const DELIVERED_STATUSES: Readonly<
  Record<WhoWasToldLogKind, ReadonlyArray<string>>
> = {
  [WhoWasToldLogKind.Email]: [],
  [WhoWasToldLogKind.SMS]: [SmsStatus.Delivered],
  [WhoWasToldLogKind.Call]: [],
  [WhoWasToldLogKind.Push]: [],
  [WhoWasToldLogKind.WhatsApp]: [WhatsAppStatus.Delivered, WhatsAppStatus.Read],
  [WhoWasToldLogKind.Telegram]: [TelegramStatus.Delivered, TelegramStatus.Read],
  [WhoWasToldLogKind.Webhook]: [],
  [WhoWasToldLogKind.Workspace]: [],
};

const SENDING_STATUSES: Readonly<
  Record<WhoWasToldLogKind, ReadonlyArray<string>>
> = {
  [WhoWasToldLogKind.Email]: [],
  [WhoWasToldLogKind.SMS]: [SmsStatus.Sending],
  [WhoWasToldLogKind.Call]: [],
  [WhoWasToldLogKind.Push]: [],
  [WhoWasToldLogKind.WhatsApp]: [WhatsAppStatus.Queued],
  [WhoWasToldLogKind.Telegram]: [TelegramStatus.Queued],
  [WhoWasToldLogKind.Webhook]: [],
  [WhoWasToldLogKind.Workspace]: [],
};

/*
 * WHAT BECAME OF ONE NOTIFICATION, from its log's own status, in the words a
 * test page's result says it: sent (its provider took it), delivered (the
 * provider says it reached the phone, or it was read), not answered (a call
 * that rang out, met a busy line or went to voicemail: it reached the
 * phone, so it is no failure), sending, or failed - an error, a low balance, an undelivered
 * SMS, a method not verified. A status this does not know is failed rather
 * than said to have gone out.
 */
export function getWhoWasToldDeliveryStatus(data: {
  kind: WhoWasToldLogKind;
  status: string | null | undefined;
}): OnCallTestPageDeliveryStatus {
  const status: string = data.status || "";

  if (DELIVERED_STATUSES[data.kind].includes(status)) {
    return OnCallTestPageDeliveryStatus.Delivered;
  }

  if (OUT_STATUSES[data.kind].includes(status)) {
    return OnCallTestPageDeliveryStatus.Sent;
  }

  if (
    data.kind === WhoWasToldLogKind.Call &&
    (status === CallStatus.MissedCall ||
      status === CallStatus.Busy ||
      status === CallStatus.Voicemail)
  ) {
    return OnCallTestPageDeliveryStatus.NotAnswered;
  }

  if (SENDING_STATUSES[data.kind].includes(status)) {
    return OnCallTestPageDeliveryStatus.Sending;
  }

  return OnCallTestPageDeliveryStatus.Failed;
}

// Whether a notification reached its person or channel: it went out.
export function isWhoWasToldDeliveryOut(
  status: OnCallTestPageDeliveryStatus,
): boolean {
  return (
    status === OnCallTestPageDeliveryStatus.Sent ||
    status === OnCallTestPageDeliveryStatus.Delivered ||
    status === OnCallTestPageDeliveryStatus.NotAnswered ||
    status === OnCallTestPageDeliveryStatus.Acknowledged
  );
}

// The channel a log's notification went out by.
export function getWhoWasToldChannel(
  row: Pick<WhoWasToldLogRow, "kind" | "workspaceType">,
): OnCallPageChannel {
  switch (row.kind) {
    case WhoWasToldLogKind.Email:
      return OnCallPageChannel.Email;
    case WhoWasToldLogKind.SMS:
      return OnCallPageChannel.SMS;
    case WhoWasToldLogKind.Call:
      return OnCallPageChannel.Call;
    case WhoWasToldLogKind.Push:
      return OnCallPageChannel.Push;
    case WhoWasToldLogKind.WhatsApp:
      return OnCallPageChannel.WhatsApp;
    case WhoWasToldLogKind.Telegram:
      return OnCallPageChannel.Telegram;
    case WhoWasToldLogKind.Webhook:
      return OnCallPageChannel.Webhook;
    case WhoWasToldLogKind.Workspace:
      if (row.workspaceType === WorkspaceType.MicrosoftTeams) {
        return OnCallPageChannel.MicrosoftTeams;
      }

      if (row.workspaceType === WorkspaceType.Mattermost) {
        return OnCallPageChannel.Mattermost;
      }

      return OnCallPageChannel.Slack;
  }
}

/*
 * What became of one step: acknowledged, not paged on purpose (skipped),
 * failed, or paged - a page sent, on its way, passed on by them, or one
 * another policy's page about the same record stood for.
 */
export function getWhoWasToldStepStatus(
  status: string | null | undefined,
): OnCallTestPageStepStatus {
  switch (status) {
    case OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged:
      return OnCallTestPageStepStatus.Acknowledged;
    case OnCallDutyExecutionLogTimelineStatus.Skipped:
      return OnCallTestPageStepStatus.Skipped;
    case OnCallDutyExecutionLogTimelineStatus.Error:
      return OnCallTestPageStepStatus.Failed;
    default:
      return OnCallTestPageStepStatus.Paged;
  }
}

/*
 * A step on its way: started or executing, with nothing out by it yet. Its
 * person's notifications are being sent.
 */
function isStepUnderWay(row: { status: string }): boolean {
  return (
    row.status === OnCallDutyExecutionLogTimelineStatus.Started ||
    row.status === OnCallDutyExecutionLogTimelineStatus.Executing
  );
}

/*
 * WHERE A PERSON STANDS, from their pages and notifications:
 *
 *   - Acknowledged, once a page of theirs is;
 *   - Told, once anything reached them - a notification that went out, or a
 *     page that did (the step keeps the channels it went out by, and one
 *     passed on, or stood for by another policy's page, reached them too);
 *   - Sending, while nothing has and something is on its way;
 *   - Failed, when nothing went out and something failed;
 *   - Skipped, when every page of theirs was skipped on purpose.
 */
export function getWhoWasToldPersonStatus(data: {
  pages: ReadonlyArray<Pick<WhoWasToldPage, "status" | "channels">>;
  notifications: ReadonlyArray<Pick<WhoWasToldNotification, "status">>;
  pagesUnderWay?: number | undefined;
}): WhoWasToldStatus {
  if (
    data.pages.some(
      (page: Pick<WhoWasToldPage, "status" | "channels">): boolean => {
        return page.status === OnCallTestPageStepStatus.Acknowledged;
      },
    )
  ) {
    return WhoWasToldStatus.Acknowledged;
  }

  const isAnyOut: boolean =
    data.notifications.some(
      (notification: Pick<WhoWasToldNotification, "status">): boolean => {
        return isWhoWasToldDeliveryOut(notification.status);
      },
    ) ||
    data.pages.some(
      (page: Pick<WhoWasToldPage, "status" | "channels">): boolean => {
        return (
          page.status === OnCallTestPageStepStatus.Paged &&
          page.channels.length > 0
        );
      },
    );

  if (isAnyOut) {
    return WhoWasToldStatus.Told;
  }

  const isAnySending: boolean =
    (data.pagesUnderWay || 0) > 0 ||
    data.notifications.some(
      (notification: Pick<WhoWasToldNotification, "status">): boolean => {
        return notification.status === OnCallTestPageDeliveryStatus.Sending;
      },
    );

  if (isAnySending) {
    return WhoWasToldStatus.Sending;
  }

  const isAnyFailed: boolean =
    data.notifications.some(
      (notification: Pick<WhoWasToldNotification, "status">): boolean => {
        return notification.status === OnCallTestPageDeliveryStatus.Failed;
      },
    ) ||
    data.pages.some(
      (page: Pick<WhoWasToldPage, "status" | "channels">): boolean => {
        return page.status === OnCallTestPageStepStatus.Failed;
      },
    );

  if (isAnyFailed) {
    return WhoWasToldStatus.Failed;
  }

  if (
    data.pages.length > 0 &&
    data.pages.every(
      (page: Pick<WhoWasToldPage, "status" | "channels">): boolean => {
        return page.status === OnCallTestPageStepStatus.Skipped;
      },
    )
  ) {
    return WhoWasToldStatus.Skipped;
  }

  /*
   * Paged, with no channel kept and no notification the reader may read
   * (a step written before steps kept their channels): it was sent.
   */
  return data.pages.length > 0
    ? WhoWasToldStatus.Told
    : WhoWasToldStatus.Sending;
}

/*
 * Where a channel stands: told once a notification went out, sending while
 * one is on its way, failed when all of them failed.
 */
export function getWhoWasToldChannelStatus(
  notifications: ReadonlyArray<Pick<WhoWasToldNotification, "status">>,
): WhoWasToldStatus {
  return getWhoWasToldPersonStatus({ pages: [], notifications: notifications });
}

function byTime<T>(getTime: (item: T) => string): (a: T, b: T) => number {
  return (a: T, b: T): number => {
    return new Date(getTime(a)).getTime() - new Date(getTime(b)).getTime() || 0;
  };
}

/*
 * By time, and two of the same millisecond by a text that does not change
 * between reads. A rule that posts to Slack and calls a webhook in one
 * request tells both within a millisecond: the database keeps microseconds,
 * a Date does not, and the logs arrive latest first - so without the text,
 * the two would swap places from one read to the next.
 */
function byTimeThenText<T>(
  getTime: (item: T) => string,
  getText: (item: T) => string,
): (a: T, b: T) => number {
  const time: (a: T, b: T) => number = byTime(getTime);

  return (a: T, b: T): number => {
    const byWhen: number = time(a, b);

    if (byWhen !== 0) {
      return byWhen;
    }

    const first: string = getText(a);
    const second: string = getText(b);

    return first < second ? -1 : first > second ? 1 : 0;
  };
}

function earliest(times: ReadonlyArray<string>): string {
  return (
    [...times].sort(
      byTime((time: string): string => {
        return time;
      }),
    )[0] || ""
  );
}

function latest(times: ReadonlyArray<string>): string {
  const sorted: Array<string> = [...times].sort(
    byTime((time: string): string => {
      return time;
    }),
  );

  return sorted[sorted.length - 1] || "";
}

// The host a webhook went to: its address's path can carry a key.
export function getWhoWasToldWebhookHost(
  url: string | null | undefined,
): string {
  const text: string = (url || "").trim();

  if (!text) {
    return "";
  }

  try {
    return new URL(text).host || text;
  } catch {
    // Not a whole address: say what was written, up to its first slash.
    return text.replace(/^[a-z]+:\/\//i, "").split("/")[0] || "";
  }
}

// What makes two notifications to no person the same channel's.
function getChannelKey(row: WhoWasToldLogRow): string {
  const channel: OnCallPageChannel = getWhoWasToldChannel(row);

  if (row.kind === WhoWasToldLogKind.Workspace) {
    return [
      channel,
      (row.channelId || row.channelName || "").toLowerCase(),
    ].join("|");
  }

  return [channel, (row.address || "").toLowerCase()].join("|");
}

function toNotification(row: WhoWasToldLogRow): WhoWasToldNotification {
  const status: OnCallTestPageDeliveryStatus = getWhoWasToldDeliveryStatus({
    kind: row.kind,
    status: row.status,
  });

  const notification: WhoWasToldNotification = {
    id: row.id,
    kind: row.kind,
    channel: getWhoWasToldChannel(row),
    status: status,
    sentAt: row.createdAt,
    isOnCallPage: row.isOnCallPage,
  };

  // Why it did not go out, or how a call ended: never a sent one's provider id.
  if (
    row.statusMessage &&
    (status === OnCallTestPageDeliveryStatus.Failed ||
      status === OnCallTestPageDeliveryStatus.NotAnswered)
  ) {
    notification.statusMessage = row.statusMessage;
  }

  if (row.workspaceType) {
    notification.workspaceType = row.workspaceType;
  }

  return notification;
}

function toPage(
  row: WhoWasToldStepRow,
  run: WhoWasToldRun | undefined,
): WhoWasToldPage {
  const page: WhoWasToldPage = {
    id: row.id,
    runId: row.runId,
    policyName: run?.policyName || "",
    isDirectPage: Boolean(run?.isDirectPage),
    status:
      row.isAcknowledged ||
      row.status ===
        OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged
        ? OnCallTestPageStepStatus.Acknowledged
        : getWhoWasToldStepStatus(row.status),
    statusMessage: row.statusMessage || "",
    channels: [...row.channels],
    pagedAt: row.createdAt,
  };

  for (const key of [
    "levelOrder",
    "levelName",
    "teamName",
    "scheduleName",
    "isNextInRotation",
    "coveringForName",
    "userNotificationEventType",
    "acknowledgedAt",
  ] as const) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      (page as unknown as Record<string, unknown>)[key] = row[key];
    }
  }

  return page;
}

/*
 * THE ANSWER, FROM ITS ROWS: each person with their pages and notifications,
 * each channel with its notifications, each target that reached nobody, in
 * order of time. A run's steps name the people it paged; a log names the
 * person it went to, or the channel it was posted to. A person a page and
 * an email both reached is one person, with both.
 */
export function buildWhoWasTold(data: {
  recordKind: OnCallTestPageRecordKind;
  recordId: string;
  checkedAt: string;
  runs: ReadonlyArray<WhoWasToldRun>;
  steps: ReadonlyArray<WhoWasToldStepRow>;
  logs: ReadonlyArray<WhoWasToldLogRow>;
  subscribers?: WhoWasToldSubscribers | undefined;
  hiddenNotificationCount: number;
  hiddenRunCount: number;
  isTruncated: boolean;
}): WhoWasToldResult {
  const runsById: Map<string, WhoWasToldRun> = new Map<string, WhoWasToldRun>();

  for (const run of data.runs) {
    runsById.set(run.id, run);
  }

  interface PersonDraft {
    userId: string;
    name: string;
    pages: Array<WhoWasToldPage>;
    notifications: Array<WhoWasToldNotification>;
    pagesUnderWay: number;
  }

  const people: Map<string, PersonDraft> = new Map<string, PersonDraft>();

  const personOf: (userId: string, name: string | undefined) => PersonDraft = (
    userId: string,
    name: string | undefined,
  ): PersonDraft => {
    const key: string = userId.toLowerCase();
    let person: PersonDraft | undefined = people.get(key);

    if (!person) {
      person = {
        userId: userId,
        name: name || "",
        pages: [],
        notifications: [],
        pagesUnderWay: 0,
      };
      people.set(key, person);
    }

    if (!person.name && name) {
      person.name = name;
    }

    return person;
  };

  const notPaged: Array<WhoWasToldTarget> = [];

  for (const step of data.steps) {
    const run: WhoWasToldRun | undefined = runsById.get(step.runId);

    if (step.userId) {
      const person: PersonDraft = personOf(step.userId, step.userName);
      const page: WhoWasToldPage = toPage(step, run);

      person.pages.push(page);

      if (isStepUnderWay(step) && page.channels.length === 0) {
        person.pagesUnderWay++;
      }

      continue;
    }

    // A line that names nobody: a target that reached nobody, or a level's own.
    const target: WhoWasToldTarget = {
      id: step.id,
      runId: step.runId,
      policyName: run?.policyName || "",
      isDirectPage: Boolean(run?.isDirectPage),
      statusMessage: step.statusMessage || "",
      at: step.createdAt,
    };

    for (const key of [
      "levelOrder",
      "levelName",
      "teamName",
      "scheduleName",
      "isNextInRotation",
      "userNotificationEventType",
    ] as const) {
      if (step[key] !== undefined && step[key] !== null && step[key] !== "") {
        (target as unknown as Record<string, unknown>)[key] = step[key];
      }
    }

    notPaged.push(target);
  }

  interface ChannelDraft {
    key: string;
    channel: OnCallPageChannel;
    name: string;
    workspaceType?: WorkspaceType | undefined;
    notifications: Array<WhoWasToldNotification>;
  }

  const channels: Map<string, ChannelDraft> = new Map<string, ChannelDraft>();

  for (const row of data.logs) {
    const notification: WhoWasToldNotification = toNotification(row);

    if (row.userId) {
      personOf(row.userId, row.userName).notifications.push(notification);
      continue;
    }

    const key: string = getChannelKey(row);
    let channel: ChannelDraft | undefined = channels.get(key);

    if (!channel) {
      channel = {
        key: key,
        channel: notification.channel,
        name:
          row.kind === WhoWasToldLogKind.Workspace
            ? row.channelName || row.channelId || ""
            : row.address || "",
        notifications: [],
      };

      if (row.workspaceType) {
        channel.workspaceType = row.workspaceType;
      }

      channels.set(key, channel);
    }

    if (!channel.name && row.channelName) {
      channel.name = row.channelName;
    }

    channel.notifications.push(notification);
  }

  const peopleOut: Array<WhoWasToldPerson> = Array.from(people.values())
    .map((draft: PersonDraft): WhoWasToldPerson => {
      const pages: Array<WhoWasToldPage> = [...draft.pages].sort(
        byTime((page: WhoWasToldPage): string => {
          return page.pagedAt;
        }),
      );
      const notifications: Array<WhoWasToldNotification> = [
        ...draft.notifications,
      ].sort(
        byTime((notification: WhoWasToldNotification): string => {
          return notification.sentAt;
        }),
      );
      const times: Array<string> = [
        ...pages.map((page: WhoWasToldPage): string => {
          return page.pagedAt;
        }),
        ...notifications.map((notification: WhoWasToldNotification): string => {
          return notification.sentAt;
        }),
      ].filter(Boolean);
      const acknowledged: Array<string> = pages
        .map((page: WhoWasToldPage): string => {
          return page.acknowledgedAt || "";
        })
        .filter(Boolean);

      const person: WhoWasToldPerson = {
        userId: draft.userId,
        name: draft.name,
        status: getWhoWasToldPersonStatus({
          pages: pages,
          notifications: notifications,
          pagesUnderWay: draft.pagesUnderWay,
        }),
        firstAt: earliest(times),
        lastAt: latest(times),
        pages: pages,
        notifications: notifications,
        failedCount: notifications.filter(
          (notification: WhoWasToldNotification): boolean => {
            return notification.status === OnCallTestPageDeliveryStatus.Failed;
          },
        ).length,
      };

      if (acknowledged.length > 0) {
        person.acknowledgedAt = earliest(acknowledged);
      }

      return person;
    })
    .sort(
      byTimeThenText(
        (person: WhoWasToldPerson): string => {
          return person.firstAt;
        },
        (person: WhoWasToldPerson): string => {
          return `${person.name}\u0000${person.userId}`;
        },
      ),
    );

  const channelsOut: Array<WhoWasToldChannelGroup> = Array.from(
    channels.values(),
  )
    .map((draft: ChannelDraft): WhoWasToldChannelGroup => {
      const notifications: Array<WhoWasToldNotification> = [
        ...draft.notifications,
      ].sort(
        byTime((notification: WhoWasToldNotification): string => {
          return notification.sentAt;
        }),
      );
      const times: Array<string> = notifications.map(
        (notification: WhoWasToldNotification): string => {
          return notification.sentAt;
        },
      );

      const group: WhoWasToldChannelGroup = {
        key: draft.key,
        channel: draft.channel,
        name: draft.name,
        status: getWhoWasToldChannelStatus(notifications),
        firstAt: earliest(times),
        lastAt: latest(times),
        notifications: notifications,
        failedCount: notifications.filter(
          (notification: WhoWasToldNotification): boolean => {
            return notification.status === OnCallTestPageDeliveryStatus.Failed;
          },
        ).length,
      };

      if (draft.workspaceType) {
        group.workspaceType = draft.workspaceType;
      }

      return group;
    })
    .sort(
      byTimeThenText(
        (group: WhoWasToldChannelGroup): string => {
          return group.firstAt;
        },
        (group: WhoWasToldChannelGroup): string => {
          return `${group.name}\u0000${group.key}`;
        },
      ),
    );

  const result: WhoWasToldResult = {
    recordKind: data.recordKind,
    recordId: data.recordId,
    checkedAt: data.checkedAt,
    people: peopleOut,
    channels: channelsOut,
    notPaged: [...notPaged].sort(
      byTime((target: WhoWasToldTarget): string => {
        return target.at;
      }),
    ),
    runs: [...data.runs].sort(
      byTime((run: WhoWasToldRun): string => {
        return run.startedAt;
      }),
    ),
    hiddenNotificationCount: Math.max(0, data.hiddenNotificationCount),
    hiddenRunCount: Math.max(0, data.hiddenRunCount),
    isTruncated: data.isTruncated,
  };

  if (data.subscribers) {
    result.subscribers = data.subscribers;
  }

  return result;
}

// The runs that paged nobody, for the Dashboard to say why each did not.
export function getWhoWasToldRunsThatPagedNobody(
  result: Pick<WhoWasToldResult, "runs" | "people" | "notPaged">,
): Array<WhoWasToldRun> {
  const pagedRunIds: Set<string> = new Set<string>();

  for (const person of result.people) {
    for (const page of person.pages) {
      pagedRunIds.add(page.runId);
    }
  }

  return result.runs.filter((run: WhoWasToldRun): boolean => {
    return !pagedRunIds.has(run.id);
  });
}

// What the answer's first words count.
export interface WhoWasToldCounts {
  // People something reached, acknowledged or told.
  toldPeopleCount: number;
  // Channels something was posted to.
  toldChannelCount: number;
  // Notifications to people and channels that did not go out.
  failedCount: number;
  /*
   * Who acknowledged it first, and how long after its first page - the run
   * that was acknowledged first, by the person its run names.
   */
  firstAcknowledgement?:
    | {
        name: string;
        afterSeconds?: number | undefined;
      }
    | undefined;
}

export function getWhoWasToldCounts(
  result: Pick<WhoWasToldResult, "people" | "channels" | "runs">,
): WhoWasToldCounts {
  const isTold: (status: WhoWasToldStatus) => boolean = (
    status: WhoWasToldStatus,
  ): boolean => {
    return (
      status === WhoWasToldStatus.Told ||
      status === WhoWasToldStatus.Acknowledged
    );
  };

  const counts: WhoWasToldCounts = {
    toldPeopleCount: result.people.filter((person: WhoWasToldPerson) => {
      return isTold(person.status);
    }).length,
    toldChannelCount: result.channels.filter(
      (group: WhoWasToldChannelGroup) => {
        return isTold(group.status);
      },
    ).length,
    failedCount:
      result.people.reduce((sum: number, person: WhoWasToldPerson) => {
        return sum + person.failedCount;
      }, 0) +
      result.channels.reduce((sum: number, group: WhoWasToldChannelGroup) => {
        return sum + group.failedCount;
      }, 0),
  };

  const acknowledged: Array<WhoWasToldRun> = result.runs
    .filter((run: WhoWasToldRun): boolean => {
      return Boolean(run.acknowledgedAt);
    })
    .sort(
      byTime((run: WhoWasToldRun): string => {
        return run.acknowledgedAt || "";
      }),
    );

  const first: WhoWasToldRun | undefined = acknowledged[0];

  if (first) {
    // The first page of the record, whichever run sent it.
    const firstPagedAt: string = earliest(
      result.people
        .flatMap((person: WhoWasToldPerson): Array<string> => {
          return person.pages.map((page: WhoWasToldPage): string => {
            return page.pagedAt;
          });
        })
        .filter(Boolean),
    );
    const afterMs: number =
      new Date(first.acknowledgedAt || "").getTime() -
      new Date(firstPagedAt || first.startedAt).getTime();

    counts.firstAcknowledgement = {
      name: first.acknowledgedByName || "",
      ...(Number.isFinite(afterMs) && afterMs >= 0
        ? { afterSeconds: Math.round(afterMs / 1000) }
        : {}),
    };
  }

  return counts;
}
