import NotificationRuleType from "../NotificationRule/NotificationRuleType";
import UserNotificationEventType from "../UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../UserNotification/UserNotificationStatus";
import {
  OnCallPageChannel,
  getOnCallPageChannelName,
} from "./OnCallPageChannel";

/*
 * A TEST PAGE: PROVE THAT A PAGE REACHES SOMEBODY, WITHOUT AN INCIDENT.
 *
 * People trust a pager after it has rung once. Until now the only way to
 * find out whether OneUptime would reach somebody was a real incident: a
 * fake outage declared on a monitor that is on a status page, which emails
 * its subscribers, or a wait for the real thing.
 *
 * A test page runs the real path and touches nothing else. It is an on-call
 * run like any other (OnCallDutyPolicyExecutionLog) - with a policy for
 * "Test this policy", without one for "Send me a test page" and an admin's
 * test page to a member - whose event type is UserNotificationEventType
 * .TestPage, and it has no incident, alert or episode behind it. So:
 *
 *   - WHAT IT REACHES IS WHAT A REAL PAGE REACHES. It stands in for a kind of
 *     record (an incident or an alert: OnCallTestPageRecordKind) and one of
 *     its severities, kept on the run, and each person is reached through
 *     their own On-Call Rules for exactly that kind and severity - the same
 *     rules, the same methods, the same order, the same user overrides,
 *     schedules and teams - without the waits: every rule for the severity
 *     runs at once, and a push does not repeat.
 *   - EVERY MESSAGE SAYS TEST in its first words, on every channel, in the
 *     person's language (OnCallTestPageWords), and that nothing is wrong.
 *   - NOTHING PUBLIC OR PERMANENT HAPPENS. With no record there is nothing for
 *     a status page, a subscriber, an SLO, uptime, a report, OneUptime AI, a
 *     workflow or a Slack or Microsoft Teams channel to read; a test run also
 *     starts none of the customer's workflows a run's create or update would,
 *     and is left out of the on-call counts (on-call reports count pages
 *     about records only).
 *   - ACKNOWLEDGING WORKS: from an email's, a text's or a chat message's
 *     link, or a call's 1. The run then says who
 *     acknowledged it, by what, and how long after their message went out
 *     ("Test page acknowledged by Ana Lopez by SMS after 14 seconds.").
 *   - IT ENDS ON ITS OWN: when somebody acknowledges it, or
 *     ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES after it started.
 *   - A POLICY'S TEST pages its first escalation level, unless it was asked
 *     to walk every level - each after ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN
 *     _MINUTES at most, and never repeating the policy.
 *   - IT IS LIMITED (ON_CALL_TEST_PAGE_*_LIMIT below) and follows the same
 *     plan, channel and balance rules as a real page: an SMS or a call on
 *     OneUptime Cloud is paid from the project's balance, and the Dashboard
 *     says so before it is sent.
 *
 * This file holds the rule, its timing and limits, the run's words and the
 * shape of a test's result - the chain as it happened, which the Dashboard
 * draws and the view of who would be told (#6810) reuses. Pure, with no
 * server or browser APIs.
 */

// The kind of record a test page stands in for.
export enum OnCallTestPageRecordKind {
  Incident = "Incident",
  Alert = "Alert",
}

export const ON_CALL_TEST_PAGE_RECORD_KINDS: ReadonlyArray<OnCallTestPageRecordKind> =
  [OnCallTestPageRecordKind.Incident, OnCallTestPageRecordKind.Alert];

export function isOnCallTestPageRecordKind(
  value: unknown,
): value is OnCallTestPageRecordKind {
  return ON_CALL_TEST_PAGE_RECORD_KINDS.includes(
    value as OnCallTestPageRecordKind,
  );
}

/*
 * The On-Call Rules a test page of this kind runs: a person's rules for
 * incidents, or for alerts - the ones a real page of that kind runs.
 */
export function getOnCallTestPageRuleType(
  kind: OnCallTestPageRecordKind,
): NotificationRuleType {
  return kind === OnCallTestPageRecordKind.Alert
    ? NotificationRuleType.ON_CALL_EXECUTED_ALERT
    : NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
}

// A run, or a log of one, read with its event type.
export interface OnCallTestPageRun {
  userNotificationEventType?: UserNotificationEventType | string | null;
}

// Whether a run (or one of its logs) is a test page.
export function isOnCallTestPage(
  run: OnCallTestPageRun | null | undefined,
): boolean {
  return Boolean(
    run && run.userNotificationEventType === UserNotificationEventType.TestPage,
  );
}

/*
 * HOW LONG A TEST WAITS TO BE ACKNOWLEDGED. Long enough to find a phone
 * across the room and open an email; short enough that a test nobody
 * answers is over while its sender still looks at its result.
 */
export const ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES: number = 15;

/*
 * The longest a policy's test waits between escalation levels when it
 * walks them all. A level whose own wait is shorter keeps it.
 */
export const ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES: number = 2;

// Whether a test that started at `startedAt` has waited all it waits.
export function hasOnCallTestPageAnswerWindowPassed(data: {
  startedAt: Date | string | null | undefined;
  at: Date;
}): boolean {
  if (!data.startedAt) {
    return true;
  }

  const startedAt: number = new Date(data.startedAt).getTime();

  if (Number.isNaN(startedAt)) {
    return true;
  }

  return (
    data.at.getTime() - startedAt >=
    ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES * 60 * 1000
  );
}

// When a test that started at `startedAt` ends, unanswered.
export function getOnCallTestPageEndsAt(startedAt: Date): Date {
  return new Date(
    startedAt.getTime() +
      ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES * 60 * 1000,
  );
}

/*
 * A level's wait in a test that walks every level: its own, cut to
 * ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES.
 */
export function getOnCallTestPageEscalationWaitInMinutes(
  levelWaitInMinutes: number | null | undefined,
): number {
  const wait: number =
    typeof levelWaitInMinutes === "number" && levelWaitInMinutes > 0
      ? levelWaitInMinutes
      : 0;

  return Math.min(wait, ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES);
}

/*
 * HOW OFTEN A TEST CAN BE SENT. A test page rings real phones and spends
 * real money on OneUptime Cloud, and anyone who may send one may send it
 * again in a second:
 *
 *   - one test page to a person every two minutes, whoever sends it, so a
 *     double click or an impatient admin does not ring a phone twice;
 *   - one test of a policy every five minutes;
 *   - twenty tests in a project an hour, all kinds together.
 */
export const ON_CALL_TEST_PAGE_PERSON_INTERVAL_IN_SECONDS: number = 120;
export const ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS: number = 300;
export const ON_CALL_TEST_PAGES_PER_PROJECT_PER_HOUR: number = 20;

// "2 minutes", "45 seconds": how long to wait, in a refusal.
export function describeOnCallTestPageWait(seconds: number): string {
  const whole: number = Math.max(1, Math.ceil(seconds));

  if (whole >= 60) {
    const minutes: number = Math.ceil(whole / 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  return `${whole} ${whole === 1 ? "second" : "seconds"}`;
}

export function getOnCallTestPagePersonTooSoonMessage(
  waitInSeconds: number,
): string {
  return `A test page was sent to this person a moment ago. Wait ${describeOnCallTestPageWait(waitInSeconds)}, then send another.`;
}

export function getOnCallTestPagePolicyTooSoonMessage(
  waitInSeconds: number,
): string {
  return `This policy was tested a moment ago. Wait ${describeOnCallTestPageWait(waitInSeconds)}, then test it again.`;
}

export const ON_CALL_TEST_PAGE_PROJECT_LIMIT_MESSAGE: string = `This project has sent ${ON_CALL_TEST_PAGES_PER_PROJECT_PER_HOUR} test pages in the last hour, the most it may. Try again later.`;

/*
 * Said when how often tests are sent cannot be read (the cache is down): a
 * test is refused rather than sent unlimited.
 */
export const ON_CALL_TEST_PAGE_LIMIT_UNREADABLE_MESSAGE: string =
  "Test pages can't be sent right now, because OneUptime can't check how often they are sent. Try again in a minute.";

/*
 * A test page is started only where who may send it and how often are
 * checked (OnCallTestPageService): never by writing an execution log.
 */
export const ON_CALL_TEST_PAGE_STARTED_ELSEWHERE_MESSAGE: string =
  "A test page is sent with Send test page or Test this policy, which check who may send it and how often. It can't be created as an execution log.";

/*
 * THE RUN'S WORDS - its status message, as every run's is written: in
 * English, on the run, for its Execution Logs and its result.
 */
export function getOnCallTestPagePagingMessage(pagedCount: number): string {
  return pagedCount === 1
    ? "Test page sent to 1 person. Waiting for them to acknowledge it."
    : `Test page sent to ${pagedCount} people. Waiting for one of them to acknowledge it.`;
}

export const ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE: string =
  "Test page reached nobody. Each person's line says why.";

export const ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE: string =
  "Test page sent to the first escalation level. Waiting for somebody to acknowledge it.";

export const ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE: string =
  "Test ended: the first escalation level reached nobody. Each person's line says why.";

export const ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE: string = `Test ended: nobody acknowledged it within ${ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES} minutes.`;

export const ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE: string =
  "Test ended: it went through every escalation level and nobody acknowledged it.";

/*
 * A person's own log of a test page, once every one of their rules for its
 * severity has run - at once, as a test runs them.
 */
export const ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE: string =
  "Test page: every rule for this severity ran at once.";

// A test page's run that does not say which kind and severity it stands in for.
export const ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE: string =
  "This test page does not say which kind of page and severity it tests, so nothing was sent.";

/*
 * A person's rules in the order a real page reaches them: the immediate
 * ones first, then "after 5 minutes", then "after 10" - rules with the same
 * wait in the order they were read. A test page runs them in this order,
 * at once.
 */
export function sortRulesAsAPageReachesThem<
  T extends { notifyAfterMinutes?: number | null | undefined },
>(rules: ReadonlyArray<T>): Array<T> {
  return rules
    .map((rule: T, index: number): { rule: T; index: number } => {
      return { rule: rule, index: index };
    })
    .sort(
      (
        a: { rule: T; index: number },
        b: { rule: T; index: number },
      ): number => {
        return (
          (a.rule.notifyAfterMinutes || 0) - (b.rule.notifyAfterMinutes || 0) ||
          a.index - b.index
        );
      },
    )
    .map((entry: { rule: T; index: number }): T => {
      return entry.rule;
    });
}

// "after 14 seconds", "after 3 minutes": how long acknowledging took.
export function describeOnCallTestPageAnswerTime(seconds: number): string {
  const whole: number = Math.max(0, Math.round(seconds));

  if (whole < 120) {
    return `${whole} ${whole === 1 ? "second" : "seconds"}`;
  }

  const minutes: number = Math.round(whole / 60);
  return `${minutes} minutes`;
}

/*
 * "Test page acknowledged by Ana Lopez (ana@example.com) by SMS after 14
 * seconds." - the run's status message once somebody acknowledges it. The
 * channel and the time are left out when they are not known: an answer
 * from somewhere no message of the test records.
 */
export function getOnCallTestPageAcknowledgedMessage(data: {
  userName?: string | null | undefined;
  userEmail?: string | null | undefined;
  channel?: OnCallPageChannel | null | undefined;
  afterSeconds?: number | null | undefined;
}): string {
  const name: string = (data.userName || "").trim();
  const email: string = (data.userEmail || "").trim();

  let who: string = name || email || "a member";

  if (name && email) {
    who = `${name} (${email})`;
  }

  const by: string = data.channel
    ? ` by ${getOnCallPageChannelName(data.channel)}`
    : "";

  const after: string =
    typeof data.afterSeconds === "number" && data.afterSeconds >= 0
      ? ` after ${describeOnCallTestPageAnswerTime(data.afterSeconds)}`
      : "";

  return `Test page acknowledged by ${who}${by}${after}.`;
}

/*
 * THE CHANNELS A TEST PAGE CAN BE ACKNOWLEDGED FROM: every one whose message
 * carries a link or a call's 1. The others still prove the message arrives:
 *
 *   - a push is answered in the mobile app by acknowledging the record it is
 *     about, and a test has none (a browser's push opens the link);
 *   - WhatsApp's words are a template Meta approved, with no link for a test;
 *   - a webhook and a custom channel get the documented test event, with
 *     nothing to act on, so a tool built for pages needs nothing new.
 */
export const ON_CALL_TEST_PAGE_ACKNOWLEDGEABLE_CHANNELS: ReadonlyArray<OnCallPageChannel> =
  [
    OnCallPageChannel.Call,
    OnCallPageChannel.SMS,
    OnCallPageChannel.Telegram,
    OnCallPageChannel.Email,
    OnCallPageChannel.Slack,
    OnCallPageChannel.MicrosoftTeams,
    OnCallPageChannel.Mattermost,
  ];

export function canAcknowledgeOnCallTestPageBy(
  channel: OnCallPageChannel,
): boolean {
  return ON_CALL_TEST_PAGE_ACKNOWLEDGEABLE_CHANNELS.includes(channel);
}

/*
 * THE PAGE A TEST'S LINK OPENS (UserOnCallLogTimelineAPI), in English as
 * every page a link opens is: what it is, and Acknowledge - or, once the
 * person acknowledged it, that it works.
 */
export const ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE: string =
  "Acknowledge test page";

export const ON_CALL_TEST_PAGE_ACKNOWLEDGE_MESSAGE: string =
  "This is a test page. Nothing is wrong: acknowledge it to show that on-call pages reach you.";

export const ON_CALL_TEST_PAGE_ANSWERED_TITLE: string =
  "Test page acknowledged";

export const ON_CALL_TEST_PAGE_ANSWERED_MESSAGE: string =
  "You acknowledged this test page. It works: on-call pages reach you. You can close this page.";

// A message of a test page, once the person acknowledged the test from it.
export const ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE: string =
  "Test page acknowledged.";

/*
 * THE RESULT OF A TEST: THE CHAIN AS IT HAPPENED.
 *
 * Who was paged, through which level and why them - and each message that
 * went to them: by what, to where, and what became of it, with the reason
 * the log gives when it did not go out and where to fix that. The
 * Dashboard draws it as the test runs (OnCallTestPageResult), and the view
 * of who a monitor's failure would reach (#6810) draws its own chain with
 * the same shape.
 */

// Who a test was for.
export enum OnCallTestPageKind {
  // "Send me a test page": the person who sent it.
  Self = "Self",
  // An admin's test page to a member, from On-Call > Readiness.
  Member = "Member",
  // "Test this policy": its escalation levels.
  Policy = "Policy",
}

// Where a test stands.
export enum OnCallTestPageStatus {
  // Its messages are going out, or it waits for somebody to acknowledge it.
  Paging = "Paging",
  // Somebody acknowledged it.
  Acknowledged = "Acknowledged",
  // It ended with nobody acknowledging it.
  Ended = "Ended",
  // It could not run: the run says why.
  Failed = "Failed",
}

// What became of one message of a test.
export enum OnCallTestPageDeliveryStatus {
  // Handed to its sender; nothing has come back yet.
  Sending = "Sending",
  // Its provider took it. An email's, a push's or a chat message's last word.
  Sent = "Sent",
  // Its provider says it reached the phone: an SMS.
  Delivered = "Delivered",
  // A call that rang out, or met a busy line.
  NotAnswered = "Not Answered",
  // The person acknowledged the test from it.
  Acknowledged = "Acknowledged",
  // It did not go out, or its provider gave up on it: the reason says why.
  Failed = "Failed",
}

/*
 * Where a message that did not go out can be put right - a page of the
 * Dashboard, named, for the result to link.
 */
export enum OnCallTestPageFix {
  // A method that is not verified, a device that stopped receiving.
  NotificationMethods = "NotificationMethods",
  // No rule for the severity, a rule that names a method of somebody else.
  OnCallRules = "OnCallRules",
  // A channel switched off in the project.
  ProjectNotificationSettings = "ProjectNotificationSettings",
  // The project's SMS and call balance.
  ProjectBalance = "ProjectBalance",
  // The project's own Twilio account, or none.
  ProjectCallAndSms = "ProjectCallAndSms",
  // The project's Slack, Microsoft Teams or Mattermost connection.
  ProjectWorkspaceConnections = "ProjectWorkspaceConnections",
}

/*
 * The words of a reason that say where it is fixed, most specific first.
 * The reasons are the ones the senders write on a message's log
 * (UserNotificationRuleService, the Notification service's senders).
 */
const FIX_BY_REASON: ReadonlyArray<{
  words: ReadonlyArray<string>;
  fix: OnCallTestPageFix;
}> = [
  {
    words: ["balance"],
    fix: OnCallTestPageFix.ProjectBalance,
  },
  {
    words: ["is off in this project", "are off in this project"],
    fix: OnCallTestPageFix.ProjectNotificationSettings,
  },
  {
    words: ["twilio"],
    fix: OnCallTestPageFix.ProjectCallAndSms,
  },
  {
    words: [
      "not connected to slack",
      "not connected to microsoft teams",
      "not connected to mattermost",
      "workspace",
    ],
    fix: OnCallTestPageFix.ProjectWorkspaceConnections,
  },
  {
    words: ["belongs to a different user", "no notification rule"],
    fix: OnCallTestPageFix.OnCallRules,
  },
  {
    words: [
      "not verified",
      "no longer receives",
      "register it again",
      "no verified notification method",
      "open the app",
    ],
    fix: OnCallTestPageFix.NotificationMethods,
  },
];

// Where the reason a message did not go out says it is fixed, or null.
export function getOnCallTestPageFix(
  reason: string | null | undefined,
): OnCallTestPageFix | null {
  const text: string = (reason || "").toLowerCase();

  if (!text) {
    return null;
  }

  for (const entry of FIX_BY_REASON) {
    if (
      entry.words.some((word: string): boolean => {
        return text.includes(word);
      })
    ) {
      return entry.fix;
    }
  }

  return null;
}

/*
 * What became of a message, from its row of the person's on-call timeline
 * (UserOnCallLogTimeline) and, for an SMS, whether its provider said it was
 * delivered (its SmsLog).
 */
export function getOnCallTestPageDeliveryStatus(data: {
  status: UserNotificationStatus | string | null | undefined;
  isAcknowledged?: boolean | null | undefined;
  isDelivered?: boolean | null | undefined;
}): OnCallTestPageDeliveryStatus {
  if (
    data.isAcknowledged ||
    data.status === UserNotificationStatus.Acknowledged
  ) {
    return OnCallTestPageDeliveryStatus.Acknowledged;
  }

  switch (data.status) {
    case UserNotificationStatus.Error:
    case UserNotificationStatus.Skipped:
      return OnCallTestPageDeliveryStatus.Failed;
    case UserNotificationStatus.NotAnswered:
      return OnCallTestPageDeliveryStatus.NotAnswered;
    case UserNotificationStatus.Sent:
    case UserNotificationStatus.PassedOn:
      return data.isDelivered
        ? OnCallTestPageDeliveryStatus.Delivered
        : OnCallTestPageDeliveryStatus.Sent;
    default:
      return OnCallTestPageDeliveryStatus.Sending;
  }
}

/*
 * WHAT A RESULT'S LINE SAYS, AS A CODE (#7260). A message that did not go
 * out, a person or target that was not paged, and how the test ended are
 * written on the run's rows in English, for every reader of the execution
 * logs. The result reads the lines it knows back into a code with the
 * values it names (OnCallTestPageLine.ts), so the Dashboard words it in the
 * reader's language. Each line keeps its English `statusMessage`: for other
 * readers of the API, for a Dashboard that does not know a code yet, and
 * for a line no code stands for - a provider's own error, which is shown
 * as written.
 */
export enum OnCallTestPageLineCode {
  /*
   * A MESSAGE'S LINE. Its method is not verified - a custom channel: turned
   * off - so the test did not use it. `channel`.
   */
  MethodNotVerified = "MethodNotVerified",
  // Its channel is switched off in the project. `channel`.
  ChannelOff = "ChannelOff",
  /*
   * Its push device, or browser, no longer receives push notifications.
   * `isMobileApp`: a phone's app rather than a browser.
   */
  PushDeviceNoLongerReceives = "PushDeviceNoLongerReceives",

  // A PERSON'S, OR A TARGET'S, LINE. They opted out of pages of this severity.
  OptedOut = "OptedOut",
  // No rule covers the severity, and the project does not fall back.
  NoRuleNoFallback = "NoRuleNoFallback",
  // No rule covers the severity: their verified methods were paged instead.
  NoRuleFallsBack = "NoRuleFallsBack",
  // No rule covers the severity, and they have no verified method. `name`.
  NoVerifiedMethod = "NoVerifiedMethod",
  // No rule covers the severity, and paging their verified methods failed.
  FallbackFailed = "FallbackFailed",
  // They are not a member of the project. `name`.
  NotProjectMember = "NotProjectMember",
  // They are away, and nobody covers for them. `name`, `awayUntil`.
  AwayWithNobodyCovering = "AwayWithNobodyCovering",
  // A team the level names has no members. `name`: the team's.
  TeamHasNoMembers = "TeamHasNoMembers",
  // A schedule it pages by rotation has nobody next. `name`: the schedule's.
  NobodyNextInRotation = "NobodyNextInRotation",
  // A schedule it names has nobody on call. `name`: the schedule's.
  NobodyOnCall = "NobodyOnCall",
  // The level names nobody: the run moved on at once.
  LevelHasNoResponders = "LevelHasNoResponders",
  // The level named somebody and paged nobody: the run moved on at once.
  LevelPagedNobody = "LevelPagedNobody",
  // Paged already by this test, so not paged again.
  AlreadyPaged = "AlreadyPaged",
  // Being paged: their messages are on their way.
  SendingToPerson = "SendingToPerson",
  // Every rule for the severity ran.
  RulesRan = "RulesRan",
  // The test does not say which kind and severity it tests.
  RunUnreadable = "RunUnreadable",

  // THE TEST'S OWN LINE, once it ended or failed. It reached nobody.
  NobodyPaged = "NobodyPaged",
  // Its first level reached nobody.
  FirstLevelReachedNobody = "FirstLevelReachedNobody",
  // Nobody acknowledged it in time. `minutes`.
  EndedUnanswered = "EndedUnanswered",
  // It went through every level, and nobody acknowledged it.
  WentThroughEveryLevel = "WentThroughEveryLevel",
  // The policy has no escalation levels.
  PolicyHasNoLevels = "PolicyHasNoLevels",
}

export interface OnCallTestPageLine {
  code: OnCallTestPageLineCode;
  // MethodNotVerified, ChannelOff.
  channel?: OnCallPageChannel | undefined;
  // PushDeviceNoLongerReceives.
  isMobileApp?: boolean | undefined;
  // The person's, the team's or the schedule's name, by the code.
  name?: string | undefined;
  // AwayWithNobodyCovering: when they are back, as an ISO date.
  awayUntil?: string | undefined;
  // EndedUnanswered.
  minutes?: number | undefined;
}

// One message of a test, as its result shows it.
export interface OnCallTestPageDelivery {
  // Its row of the person's on-call timeline.
  id: string;
  // By what. Null for a row that names no method: a rule that sent nothing.
  channel: OnCallPageChannel | null;
  // Where to: the method's address or name, when the person may see it.
  address?: string | undefined;
  status: OnCallTestPageDeliveryStatus;
  // What its log says: why it did not go out, the provider's id, and so on.
  statusMessage: string;
  // What `statusMessage` says, as a code, when it is a line the result knows.
  statusMessageCode?: OnCallTestPageLine | undefined;
  // Where a message that did not go out is fixed.
  fix?: OnCallTestPageFix | undefined;
  // Whether the test can be acknowledged from it.
  canAcknowledge: boolean;
  // When it was written, and when it was acknowledged from, as ISO dates.
  sentAt: string;
  acknowledgedAt?: string | undefined;
}

// What became of one person, or one target, of a test.
export enum OnCallTestPageStepStatus {
  Paged = "Paged",
  Acknowledged = "Acknowledged",
  // Not paged on purpose: away, not a member, opted out, nobody on call.
  Skipped = "Skipped",
  Failed = "Failed",
}

// One line of the chain: a person paged, or a target that reached nobody.
export interface OnCallTestPageStep {
  // Its line of the run's timeline.
  id: string;
  // The escalation level, for a policy's test.
  levelOrder?: number | undefined;
  levelName?: string | undefined;
  // The person paged, when there was one.
  userId?: string | undefined;
  userName?: string | undefined;
  // Why them: the team or the schedule they were paged through.
  teamName?: string | undefined;
  scheduleName?: string | undefined;
  // The person whose page an override sent to them.
  coveringForName?: string | undefined;
  status: OnCallTestPageStepStatus;
  // What the run's line says.
  statusMessage: string;
  // What `statusMessage` says, as a code, when it is a line the result knows.
  statusMessageCode?: OnCallTestPageLine | undefined;
  deliveries: Array<OnCallTestPageDelivery>;
}

export interface OnCallTestPageResult {
  executionLogId: string;
  kind: OnCallTestPageKind;
  policyId?: string | undefined;
  policyName?: string | undefined;
  recordKind: OnCallTestPageRecordKind;
  severityName: string;
  walksEscalation: boolean;
  status: OnCallTestPageStatus;
  statusMessage: string;
  // What `statusMessage` says, as a code, when it is a line the result knows.
  statusMessageCode?: OnCallTestPageLine | undefined;
  startedAt: string;
  // When it ends unless somebody acknowledges it first.
  endsAt: string;
  acknowledgedByName?: string | undefined;
  acknowledgedChannel?: OnCallPageChannel | undefined;
  acknowledgedAfterSeconds?: number | undefined;
  steps: Array<OnCallTestPageStep>;
}

/*
 * Whether a result is final: a test that was acknowledged, ended or failed
 * changes no more, so whoever shows it stops asking.
 */
export function isOnCallTestPageResultFinal(
  result: Pick<OnCallTestPageResult, "status"> | null | undefined,
): boolean {
  return Boolean(result && result.status !== OnCallTestPageStatus.Paging);
}

/*
 * WHAT A TEST WILL SEND, BEFORE IT IS SENT: who it pages, by which of their
 * methods and in what order, and what it costs. The dialog shows it before
 * the Send button, so nobody is surprised by a call at their desk or an
 * SMS on the project's bill.
 */

/*
 * One method a person's rules for the test's severity page them by - or,
 * for a person with no rule for it, one the project's fallback pages them
 * by (isFallback, #7262).
 */
export interface OnCallTestPagePreviewMethod {
  channel: OnCallPageChannel;
  // Where to: shown to the person themselves only.
  address?: string | undefined;
  // "After 5 minutes" on a real page; a test sends it at once.
  notifyAfterMinutes: number;
  isVerified: boolean;
  canAcknowledge: boolean;
  /*
   * No rule of theirs covers the severity, and a real page - so the test -
   * falls back to this method: the fallback's own pick of their methods
   * (UserNotificationRuleService.getFallbackRules). Absent for a method a
   * rule names, and from an older server's preview, which listed no
   * method for a person with no rule.
   */
  isFallback?: boolean | undefined;
}

/*
 * WHAT A PREVIEW SAYS, AS CODES (#7015). Every warning, every target that
 * reaches nobody and every "why them" comes with a code and the values it
 * names, so the Dashboard words it in the reader's language. Each carries
 * its English sentence too (`message`), and the preview keeps the English
 * lists it always had (`warnings`, `notPaged`, `reachedThrough`): for other
 * readers of the API, and for a Dashboard that does not know a code yet.
 */

// Why a policy's test pages a person.
export enum OnCallTestPageReachedThroughCode {
  // A member of a team the level names: "Team Platform".
  Team = "Team",
  // On call in a schedule the level names: "Schedule Primary".
  Schedule = "Schedule",
  // Next in the rotation of a schedule the level pages that way.
  ScheduleNextInRotation = "ScheduleNextInRotation",
  // Covering for somebody the level names who is away: "Covering for Ana".
  CoveringFor = "CoveringFor",
}

export interface OnCallTestPageReachedThrough {
  code: OnCallTestPageReachedThroughCode;
  // The team's or the schedule's name, or the name of who they cover for.
  name: string;
}

// What a preview warns about one person before anything is sent.
export enum OnCallTestPageWarningCode {
  // They opted out of pages of this severity: the test sends them nothing.
  OptedOut = "OptedOut",
  // No rule covers the severity, and the project does not fall back.
  NoRuleNoFallback = "NoRuleNoFallback",
  /*
   * No rule covers the severity: the test goes to every verified method.
   * Said by a preview that does not read what the fallback picks; one that
   * does says one of the two below instead (#7262).
   */
  NoRuleFallsBack = "NoRuleFallsBack",
  /*
   * No rule covers the severity: like a real page, the test falls back to
   * the methods listed for the person - the ones the fallback picks.
   */
  NoRuleFallsBackToListed = "NoRuleFallsBackToListed",
  /*
   * No rule covers the severity, and the fallback has no method it may use
   * (none verified, or only ones on channels the project turned off): the
   * test sends the person nothing.
   */
  NoRuleNothingToFallBackTo = "NoRuleNothingToFallBackTo",
  // A channel a rule of theirs uses is switched off in the project.
  ChannelOff = "ChannelOff",
  // A method a rule of theirs uses is not verified (a custom channel: off).
  MethodNotVerified = "MethodNotVerified",
}

export interface OnCallTestPageWarning {
  code: OnCallTestPageWarningCode;
  // The channel it is about: ChannelOff and MethodNotVerified.
  channel?: OnCallPageChannel | undefined;
  // The sentence, in English.
  message: string;
}

// Why a target of a policy's level reaches nobody.
export enum OnCallTestPageNotPagedCode {
  // The policy has no escalation levels.
  PolicyHasNoLevels = "PolicyHasNoLevels",
  // The level names no team, person or schedule.
  LevelNamesNobody = "LevelNamesNobody",
  // A team it names has no members.
  TeamHasNoMembers = "TeamHasNoMembers",
  // A schedule it pages by rotation has nobody next.
  NobodyNextInRotation = "NobodyNextInRotation",
  // A schedule it names has nobody on call now.
  NobodyOnCall = "NobodyOnCall",
  // Somebody it names is away, and nobody covers for them.
  AwayWithNobodyCovering = "AwayWithNobodyCovering",
  // Somebody it names is not a member of the project.
  NotProjectMember = "NotProjectMember",
}

export interface OnCallTestPageNotPaged {
  code: OnCallTestPageNotPagedCode;
  // The level it is about (LevelNamesNobody): 1 for the first.
  levelOrder?: number | undefined;
  // TeamHasNoMembers.
  teamName?: string | undefined;
  // NobodyNextInRotation, NobodyOnCall.
  scheduleName?: string | undefined;
  // AwayWithNobodyCovering, NotProjectMember.
  userName?: string | undefined;
  // AwayWithNobodyCovering: when they are back, as an ISO date.
  awayUntil?: string | undefined;
  // The sentence, in English.
  message: string;
}

// One person a test will page.
export interface OnCallTestPagePreviewPerson {
  userId: string;
  userName: string;
  // Why them, for a policy's test: "Team Platform", "Schedule Primary".
  reachedThrough?: string | undefined;
  // The same, as a code (#7015). Absent from an older server's preview.
  reachedThroughCode?: OnCallTestPageReachedThrough | undefined;
  methods: Array<OnCallTestPagePreviewMethod>;
  /*
   * No rule of theirs covers the test's severity: a real page - and so the
   * test - falls back to their verified methods (listed in `methods`, each
   * isFallback, since #7262), or reaches nobody when the project turned the
   * fallback off or they opted out of it.
   */
  hasNoRule: boolean;
  isOptedOut: boolean;
  // A channel switched off in the project, and the like: said before sending.
  warnings: Array<string>;
  // The same, as codes, one for each (#7015). Absent from an older server's preview.
  warningCodes?: Array<OnCallTestPageWarning> | undefined;
}

// What a test costs on OneUptime Cloud, from the project's balance.
export interface OnCallTestPageCost {
  // Whether anything it sends is paid from the project's balance.
  isPaid: boolean;
  // What it sends, by channel - whoever pays for it.
  smsCount: number;
  callCount: number;
  whatsAppCount: number;
  telegramCount: number;
  /*
   * What of that the project's balance pays for (#7263): nothing where
   * billing is off, and no SMS or call the project's own Twilio account
   * sends. WhatsApp and Telegram are paid wherever billing is on. Absent
   * from an older server's preview, whose counts were all read as paid.
   */
  paidSmsCount?: number | undefined;
  paidCallCount?: number | undefined;
  paidWhatsAppCount?: number | undefined;
  paidTelegramCount?: number | undefined;
  // About how much, in US cents; absent when the prices are not known.
  estimatedCostInUSDCents?: number | undefined;
}

/*
 * One level after the first that a policy's test reaches when it walks
 * every level and nobody acknowledges it (#7016).
 */
export interface OnCallTestPagePreviewLevel {
  // Its order in the policy: 2 for the second level.
  order: number;
  // When the walk pages it at the earliest, in minutes after the test is sent.
  startsAfterMinutes: number;
  people: Array<OnCallTestPagePreviewPerson>;
  notPaged: Array<string>;
  notPagedCodes: Array<OnCallTestPageNotPaged>;
}

export interface OnCallTestPagePreview {
  kind: OnCallTestPageKind;
  people: Array<OnCallTestPagePreviewPerson>;
  // Targets of a policy's first level that will reach nobody, and why.
  notPaged: Array<string>;
  // The same, as codes, one for each (#7015). Absent from an older server's preview.
  notPagedCodes?: Array<OnCallTestPageNotPaged> | undefined;
  // How many escalation levels the policy has.
  levelCount?: number | undefined;
  // What a test of the first level only costs: a test of people, or a policy's.
  cost: OnCallTestPageCost;
  /*
   * A policy's test that walks every level (#7016): the levels after the
   * first it reaches before it ends, nobody acknowledging it
   * (getOnCallTestPageWalkStart), and how many it never reaches.
   */
  walkLevels?: Array<OnCallTestPagePreviewLevel> | undefined;
  walkUnreachedLevelCount?: number | undefined;
  /*
   * What a test that walks every level costs at most: the first level and
   * every level in walkLevels. Absent from an older server's preview.
   */
  walkCost?: OnCallTestPageCost | undefined;
}

/*
 * WHEN A TEST THAT WALKS EVERY LEVEL PAGES THE NEXT ONE (#7016), nobody
 * acknowledging it: the level before it started `previousStartsAfterMinutes`
 * after the test was sent, and waits its own wait cut to a test's short one
 * (getOnCallTestPageEscalationWaitInMinutes) - none when it pages nobody, as
 * a run moves past such a level at once (OnCallEscalationAdvance). The worker
 * moves a run on at its first tick once a wait is over, so a level starts
 * then or a little later, never sooner.
 */
export function getOnCallTestPageWalkStart(data: {
  previousStartsAfterMinutes: number;
  previousWaitInMinutes: number | null | undefined;
  previousPagesAnybody: boolean;
}): number {
  return (
    data.previousStartsAfterMinutes +
    (data.previousPagesAnybody
      ? getOnCallTestPageEscalationWaitInMinutes(data.previousWaitInMinutes)
      : 0)
  );
}

/*
 * Whether a level a walk would page `startsAfterMinutes` after the test was
 * sent is paged at all: the test ends ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN
 * _MINUTES after it started, before it moves on again.
 */
export function isOnCallTestPageWalkLevelReached(
  startsAfterMinutes: number,
): boolean {
  return startsAfterMinutes < ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES;
}

/*
 * What a test costs, from what each person's methods are - the ones their
 * rules name, or the ones the fallback picks for a person with no rule
 * (#7262): each verified one is sent. A project's own Twilio account pays
 * for its SMS and calls itself; WhatsApp and Telegram are always paid from
 * the balance where billing is on. It counts what is sent, and beside it
 * what the balance pays for (#7263): a sentence that says "paid from this
 * project's SMS and call balance" lists only that.
 */
export function getOnCallTestPageCost(data: {
  people: ReadonlyArray<Pick<OnCallTestPagePreviewPerson, "methods">>;
  isBillingEnabled: boolean;
  hasOwnTwilioForSms: boolean;
  hasOwnTwilioForCalls: boolean;
  prices?:
    | {
        smsInCents: number;
        callPerMinuteInCents: number;
        whatsAppInCents: number;
        telegramInCents: number;
      }
    | undefined;
}): OnCallTestPageCost {
  let smsCount: number = 0;
  let callCount: number = 0;
  let whatsAppCount: number = 0;
  let telegramCount: number = 0;

  for (const person of data.people) {
    for (const method of person.methods) {
      if (!method.isVerified) {
        continue;
      }

      if (method.channel === OnCallPageChannel.SMS) {
        smsCount++;
      } else if (method.channel === OnCallPageChannel.Call) {
        callCount++;
      } else if (method.channel === OnCallPageChannel.WhatsApp) {
        whatsAppCount++;
      } else if (method.channel === OnCallPageChannel.Telegram) {
        telegramCount++;
      }
    }
  }

  const paidSms: number =
    data.isBillingEnabled && !data.hasOwnTwilioForSms ? smsCount : 0;
  const paidCalls: number =
    data.isBillingEnabled && !data.hasOwnTwilioForCalls ? callCount : 0;
  const paidWhatsApp: number = data.isBillingEnabled ? whatsAppCount : 0;
  const paidTelegram: number = data.isBillingEnabled ? telegramCount : 0;

  const isPaid: boolean = paidSms + paidCalls + paidWhatsApp + paidTelegram > 0;

  const cost: OnCallTestPageCost = {
    isPaid: isPaid,
    smsCount: smsCount,
    callCount: callCount,
    whatsAppCount: whatsAppCount,
    telegramCount: telegramCount,
    paidSmsCount: paidSms,
    paidCallCount: paidCalls,
    paidWhatsAppCount: paidWhatsApp,
    paidTelegramCount: paidTelegram,
  };

  if (isPaid && data.prices) {
    // A test call is a short one: a minute.
    const estimate: number =
      paidSms * data.prices.smsInCents +
      paidCalls * data.prices.callPerMinuteInCents +
      paidWhatsApp * data.prices.whatsAppInCents +
      paidTelegram * data.prices.telegramInCents;

    if (estimate > 0) {
      cost.estimatedCostInUSDCents = estimate;
    }
  }

  return cost;
}
