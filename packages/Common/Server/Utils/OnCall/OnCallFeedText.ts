import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { readAwayUntil } from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import {
  ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * THE FEED ENTRIES OF AN ON-CALL RUN.
 *
 * Every on-call run for an incident, an alert or an episode writes to that
 * record's feed: the run starting, each page it sends - or does not send -
 * and the run ending. These entries used to read like a log ("[Incident
 * INC-8](...) On-Call Alert Notification Sent to Nitin. The on-call policy
 * PolicyX has been triggered. The escalation rule first were applied. Nitin
 * was alerted. The status of this alert is Notification Sent with the
 * message: ..."), once per person per rule. Now each is one sentence in the
 * words the run's Slack and Microsoft Teams message uses
 * (OnCallPolicyRunMessageView) - paged, paged nobody, acknowledged, stopped
 * paging - and the feed folds the entries of one run together
 * (FeedBurstKind.OnCall):
 *
 *   On-call policy PolicyX started paging.
 *   On-call policy PolicyX paged Nitin Kumar at escalation rule first.
 *     Notification sent by SMS.
 *   On-call policy PolicyX paged nobody at escalation rule third: this
 *     escalation rule has no responders.
 *   On-call policy PolicyX stopped paging because the incident is
 *     acknowledged or resolved.
 *
 * The record the run is for is not named: the entries are only ever written
 * to that record's own feed, where a link to it is a link to the page it is
 * on.
 *
 * Feed only, never chat: Slack and Teams hear of the run through its one
 * message, edited as it goes.
 */
export interface OnCallStepFeedTextInput {
  status: OnCallDutyExecutionLogTimelineStatus;
  // The policy, as a link to it in the Dashboard: [PolicyX](...).
  policyLink: MarkdownText;
  // The escalation rule that ran, as typed. "Unnamed Rule" when it has none.
  ruleName?: string | undefined;
  // The schedule the person was on call in, as typed.
  scheduleName?: string | undefined;
  // The team the person was paged as a member of, as typed.
  teamName?: string | undefined;
  // Who was paged, as a link to them; empty or unset when nobody was.
  recipient?: MarkdownText | undefined;
  // Who the page was meant for, when a user override sent it to someone else.
  overriddenUser?: MarkdownText | undefined;
  // What the step itself says: "Notification sent by SMS.", why it was skipped.
  statusMessage?: string | undefined;
}

export interface OnCallRunStatusFeedTextInput {
  status: OnCallDutyPolicyStatus;
  // The policy, as a link to it in the Dashboard: [PolicyX](...).
  policyLink: MarkdownText;
  // What the run says about where it stands: why it ended, the error.
  statusMessage?: string | undefined;
}

// A message that already ends its own sentence.
const SENTENCE_END_PATTERN: RegExp = /[.!?]$/;

const UNNAMED_RULE: string = "Unnamed Rule";

type HasMarkdownFunction = (value: MarkdownText | undefined) => boolean;

const hasMarkdown: HasMarkdownFunction = (
  value: MarkdownText | undefined,
): boolean => {
  return Boolean(value && value.toString().trim().length > 0);
};

// "On-call policy **PolicyX**", or "on-call policy ..." inside a sentence.
const getPolicy: (
  policyLink: MarkdownText,
  options?: { isInSentence?: boolean | undefined } | undefined,
) => MarkdownText = (
  policyLink: MarkdownText,
  options?: { isInSentence?: boolean | undefined } | undefined,
): MarkdownText => {
  return options?.isInSentence
    ? mdText`on-call policy **${policyLink}**`
    : mdText`On-call policy **${policyLink}**`;
};

const getRuleName: (ruleName: string | undefined) => string = (
  ruleName: string | undefined,
): string => {
  return (ruleName || "").trim() || UNNAMED_RULE;
};

/*
 * Where the rule sits: "escalation rule **first** (schedule **Primary**)",
 * with the team the person was paged as a member of.
 */
const getRuleClause: (input: OnCallStepFeedTextInput) => MarkdownText = (
  input: OnCallStepFeedTextInput,
): MarkdownText => {
  const scheduleName: string = (input.scheduleName || "").trim();
  const teamName: string = (input.teamName || "").trim();

  return mdText`escalation rule **${getRuleName(input.ruleName)}**${
    scheduleName
      ? mdText` (schedule **${scheduleName}**)`
      : FeedMarkdown.empty()
  }${teamName ? mdText`, as a member of **${teamName}**` : FeedMarkdown.empty()}`;
};

// A message as a sentence of its own, ending once.
const asSentence: (message: string) => MarkdownText = (
  message: string,
): MarkdownText => {
  return SENTENCE_END_PATTERN.test(message)
    ? mdText`${message}`
    : mdText`${message}.`;
};

/*
 * What a step said about itself, as its own sentence, or nothing. A person
 * away with nobody to cover gets their return time as a moment the
 * Dashboard shows in each reader's own zone, rather than the UTC the run
 * writes it in.
 */
const getStepMessageSentence: (
  statusMessage: string | undefined,
) => MarkdownText = (statusMessage: string | undefined): MarkdownText => {
  const message: string = (statusMessage || "").trim();

  if (!message) {
    return FeedMarkdown.empty();
  }

  const awayUntil: Date | null = readAwayUntil(message);

  if (awayUntil) {
    return mdText`Away until ${FeedMarkdown.code(awayUntil.toISOString())}, and nobody is named to cover for them.`;
  }

  return asSentence(message);
};

// Who was (or was not) paged, by which policy, at which rule.
const getStepHeadline: (input: OnCallStepFeedTextInput) => MarkdownText = (
  input: OnCallStepFeedTextInput,
): MarkdownText => {
  const policy: MarkdownText = getPolicy(input.policyLink);

  if (!hasMarkdown(input.recipient)) {
    const scheduleName: string = (input.scheduleName || "").trim();
    const reason: MarkdownText = scheduleName
      ? mdText`nobody was on call in schedule **${scheduleName}**`
      : mdText`this escalation rule has no responders`;

    return mdText`${policy} paged nobody at escalation rule **${getRuleName(input.ruleName)}**: ${reason}.`;
  }

  const recipient: MarkdownText = mdText`**${input.recipient!}**`;
  const rule: MarkdownText = getRuleClause(input);

  switch (input.status) {
    case OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged:
      return mdText`${recipient} acknowledged the page from ${getPolicy(
        input.policyLink,
        { isInSentence: true },
      )} at ${rule}.`;
    case OnCallDutyExecutionLogTimelineStatus.Error:
      return mdText`${policy} could not page ${recipient} at ${rule}.`;
    case OnCallDutyExecutionLogTimelineStatus.Skipped:
      return mdText`${policy} did not page ${recipient} at ${rule}.`;
    case OnCallDutyExecutionLogTimelineStatus.NotificationSent:
      return mdText`${policy} paged ${recipient} at ${rule}.`;
    default:
      return mdText`${policy} is paging ${recipient} at ${rule}.`;
  }
};

/*
 * How a run that ended says so. A run's ending is written by the worker in
 * fixed words (OnCallDutyPolicyRunEnding), read back here into a sentence;
 * any other message is kept as it is, after it.
 */
const getRunStatusSentences: (
  input: OnCallRunStatusFeedTextInput,
) => Array<MarkdownText> = (
  input: OnCallRunStatusFeedTextInput,
): Array<MarkdownText> => {
  const policy: MarkdownText = getPolicy(input.policyLink);
  const message: string = (input.statusMessage || "").trim();
  const messageSentences: Array<MarkdownText> = message
    ? [asSentence(message)]
    : [];

  switch (input.status) {
    case OnCallDutyPolicyStatus.Scheduled:
      return [mdText`${policy} is scheduled to start paging.`];
    case OnCallDutyPolicyStatus.Started:
      return [mdText`${policy} started paging.`];
    case OnCallDutyPolicyStatus.Executing:
      return [mdText`${policy} is paging.`, ...messageSentences];
    case OnCallDutyPolicyStatus.Completed: {
      if (message === ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE) {
        return [
          mdText`${policy} went through every escalation rule and stopped paging.`,
        ];
      }

      if (
        message.indexOf(ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START) === 0
      ) {
        const why: string = message
          .slice(ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START.length)
          .trim();

        return [
          mdText`${policy} stopped paging because the ${asSentence(why)}`,
        ];
      }

      return [mdText`${policy} stopped paging.`, ...messageSentences];
    }
    case OnCallDutyPolicyStatus.CompletedWithNoNotifications:
      return [
        mdText`${policy} went through every escalation rule and paged nobody.`,
        ...messageSentences,
      ];
    case OnCallDutyPolicyStatus.Error:
      return [mdText`${policy} stopped with an error.`, ...messageSentences];
    default:
      return [
        mdText`${policy} is now **${input.status}**.`,
        ...messageSentences,
      ];
  }
};

export default class OnCallFeedText {
  // One step of a run: a page sent, acknowledged, skipped or failed.
  public static getStepMarkdown(input: OnCallStepFeedTextInput): string {
    const sentences: Array<MarkdownText> = [getStepHeadline(input)];

    if (hasMarkdown(input.recipient) && hasMarkdown(input.overriddenUser)) {
      sentences.push(
        mdText`They are covering for ${input.overriddenUser!} (a user override).`,
      );
    }

    const messageSentence: MarkdownText = getStepMessageSentence(
      input.statusMessage,
    );

    if (hasMarkdown(messageSentence)) {
      sentences.push(messageSentence);
    }

    return FeedMarkdown.join(sentences, "\n\n").toString();
  }

  /*
   * A run starting. With the person who started it by hand, the sentence
   * follows their name in the feed ("Nitin started on-call policy PolicyX").
   */
  public static getRunStartedMarkdown(data: {
    policyLink: MarkdownText;
    isStartedBySomeone: boolean;
  }): string {
    if (data.isStartedBySomeone) {
      return mdText`started on-call policy **${data.policyLink}**.`.toString();
    }

    return mdText`${getPolicy(data.policyLink)} started paging.`.toString();
  }

  /*
   * Whether a run's new status is news for the record's feed. A run says it
   * started when it is created (getRunStartedMarkdown), and every page it
   * sends is an entry of its own (getStepMarkdown), so the statuses it
   * passes through on the way - scheduled, started, executing - only said
   * "started paging" twice and "is paging" once more, on every run. How the
   * run ended is news: it stopped, paged nobody, or failed.
   */
  public static isRunStatusFeedNews(
    status: OnCallDutyPolicyStatus | undefined,
  ): boolean {
    if (!status) {
      return false;
    }

    return (
      status !== OnCallDutyPolicyStatus.Scheduled &&
      status !== OnCallDutyPolicyStatus.Started &&
      status !== OnCallDutyPolicyStatus.Executing
    );
  }

  // Where a run stands now: started, paging, stopped and why, failed.
  public static getRunStatusMarkdown(
    input: OnCallRunStatusFeedTextInput,
  ): string {
    return FeedMarkdown.join(getRunStatusSentences(input), "\n\n").toString();
  }
}
