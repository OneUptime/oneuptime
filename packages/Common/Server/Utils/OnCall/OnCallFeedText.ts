import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { readAwayUntil } from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import {
  ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
  isOnCallPolicyRunEverybodyPassedOnMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import {
  getOnCallPassOnLevelCount,
  getOnCallPassOnLevelName,
  isOnCallPagePassedOnStatusMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  ON_CALL_POLICY_RUN_ENDED_WHILE_WAITING_MESSAGE_START,
  isOnCallPolicyRunEndedWhileWaiting,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import {
  describeOnCallAcknowledgementTimeout,
  getOnCallPageAgainPlaceWithLast,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import ProductBrandingText from "../ProductBrandingText";

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
 *   On-call policy PolicyX paged Nitin Kumar at First line (Level 1 of 3,
 *     schedule Primary). Notification sent by SMS.
 *   On-call policy PolicyX paged nobody at Night shift (Level 3 of 3): this
 *     escalation rule has no responders.
 *   On-call policy PolicyX stopped paging because the incident is
 *     acknowledged or resolved.
 *
 * A level is named as the Escalate dialog and the run's Slack and Teams
 * message name it (OnCallPagePassOn): its name, then its place - or its
 * place alone, "Level 2 of 3", when it has no name of its own. The
 * schedule the person was paged from shares the place's brackets, so a
 * line never reads "(Level 1 of 3) (schedule Primary)". A step whose
 * level's place is not known is named as before: "escalation rule first
 * (schedule Primary)".
 *
 * A rule that pages the next person in a schedule's rotation - the backup
 * after whoever is on call - says that is why:
 *
 *   On-call policy PolicyX paged Sam Lee at Level 2 of 3 (next in the
 *     Primary rotation).
 *   On-call policy PolicyX paged nobody at Level 2 of 3: nobody was next in
 *     the Primary rotation.
 *
 * The record the run is for is not named: the entries are only ever written
 * to that record's own feed, where a link to it is a link to the page it is
 * on.
 *
 * Feed only, never chat: Slack and Teams hear of the run through its one
 * message, edited as it goes.
 *
 * A DIRECT PAGE - people, a team or a schedule paged with no policy behind
 * the page (Types/OnCallDutyPolicy/OnCallDirectPage) - reads the same way,
 * with whoever started it where the policy is, and no escalation rule:
 *
 *   Workflow Page the on-call engineer paged Nitin Kumar, on call in
 *     schedule Primary. Notification sent by SMS.
 *   Workflow Page the on-call engineer paged nobody: nobody was on call in
 *     schedule Secondary.
 *   Workflow Page the on-call engineer stopped paging because the incident
 *     is acknowledged or resolved.
 *
 * A page a PERSON started - from Slack or Microsoft Teams - ends as their
 * page ending, not as the person doing something, as its chat message says
 * "so paging stopped": "The page from Simon Lee stopped because the alert
 * is acknowledged or resolved." ("Simon Lee stopped paging" read as if he
 * had called it off.)
 *
 * Somebody who cannot take a page can escalate it (OnCallPagePassOn). That
 * is one entry, in their name, and the entries after it say what the run
 * did next - paged the next level, or stopped:
 *
 *   Ana Lopez escalated the page from on-call policy PolicyX at Level 1
 *     of 3.
 *   On-call policy PolicyX paged Sam Lee at Level 2 of 3.
 *   On-call policy PolicyX stopped paging: everybody it paged escalated it,
 *     and nobody was left to page.
 *
 * Runs whose people escalated before the action was renamed from "Pass it
 * on" wrote their messages in those words; they are read back the same.
 */
export interface OnCallStepFeedTextInput {
  status: OnCallDutyExecutionLogTimelineStatus;
  // The policy, as a link to it in the Dashboard: [PolicyX](...).
  policyLink: MarkdownText;
  // The escalation rule that ran, as typed. "Unnamed Rule" when it has none.
  ruleName?: string | undefined;
  /*
   * Its place in the policy, and how many levels the policy has: "Level 2
   * of 3". Unknown, the rule is named by its name alone.
   */
  ruleOrder?: number | undefined;
  ruleCount?: number | undefined;
  // The schedule the person was on call in, as typed.
  scheduleName?: string | undefined;
  /*
   * The person was paged as the next in that schedule's rotation - the
   * backup after whoever is on call - not as its on-call person; with nobody
   * paged, nobody was next.
   */
  isNextInRotation?: boolean | undefined;
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

/*
 * Who started a direct page, as its feed entries name them: the workflow
 * whose step started it, by the name it had then, or the person who did,
 * as a link to them. With neither, the product itself is named.
 */
export interface OnCallDirectPagePager {
  workflowName?: string | undefined;
  startedByUser?: MarkdownText | undefined;
}

export interface OnCallDirectPageStepFeedTextInput {
  status: OnCallDutyExecutionLogTimelineStatus;
  pager: OnCallDirectPagePager;
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

export interface OnCallDirectPageStatusFeedTextInput {
  status: OnCallDutyPolicyStatus;
  pager: OnCallDirectPagePager;
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
 * A level, as the Escalate dialog names it, in two parts: what is said in
 * bold - its name, "**First line**", or its place when it has no name of
 * its own, "**Level 1 of 3**" - and the place to say in brackets after a
 * name ("Level 1 of 3"). The place reads "Level 1" when the policy's
 * levels could not be counted. A step whose level's place is not known is
 * named as it always was: "escalation rule **first**", with no place.
 */
interface LevelParts {
  lead: MarkdownText;
  place?: string | undefined;
}

const getLevelParts: (input: OnCallStepFeedTextInput) => LevelParts = (
  input: OnCallStepFeedTextInput,
): LevelParts => {
  const order: number = Number(input.ruleOrder);

  if (!Number.isInteger(order) || order < 1) {
    return {
      lead: mdText`escalation rule **${getRuleName(input.ruleName)}**`,
    };
  }

  const rule: { order: number; name?: string | undefined } = {
    order: order,
    name: input.ruleName,
  };
  const count: number = Number(input.ruleCount);
  const place: string =
    Number.isInteger(count) && count > 0
      ? `Level ${order} of ${getOnCallPassOnLevelCount(rule, count)}`
      : `Level ${order}`;
  const name: string | undefined = getOnCallPassOnLevelName(rule);

  return name
    ? { lead: mdText`**${name}**`, place: place }
    : { lead: mdText`**${place}**` };
};

/*
 * The level on its own: "**First line** (Level 1 of 3)", or "**Level 1 of
 * 3**" when it has no name of its own.
 */
const getLevel: (input: OnCallStepFeedTextInput) => MarkdownText = (
  input: OnCallStepFeedTextInput,
): MarkdownText => {
  const level: LevelParts = getLevelParts(input);

  return level.place ? mdText`${level.lead} (${level.place})` : level.lead;
};

/*
 * Where the rule sits, with the schedule the person was paged from in the
 * same brackets as the level's place - "**First line** (Level 1 of 3,
 * schedule **Primary**)", "**Level 2 of 3** (next in the **Primary**
 * rotation)" for the backup after whoever is on call - then the team the
 * person was paged as a member of.
 */
const getRuleClause: (input: OnCallStepFeedTextInput) => MarkdownText = (
  input: OnCallStepFeedTextInput,
): MarkdownText => {
  const scheduleName: string = (input.scheduleName || "").trim();
  const teamName: string = (input.teamName || "").trim();
  const level: LevelParts = getLevelParts(input);

  const inBrackets: Array<MarkdownText> = [];

  if (level.place) {
    inBrackets.push(mdText`${level.place}`);
  }

  if (scheduleName) {
    inBrackets.push(
      input.isNextInRotation
        ? mdText`next in the **${scheduleName}** rotation`
        : mdText`schedule **${scheduleName}**`,
    );
  }

  const brackets: MarkdownText =
    inBrackets.length > 0
      ? mdText` (${FeedMarkdown.join(inBrackets, ", ")})`
      : FeedMarkdown.empty();

  return mdText`${level.lead}${brackets}${teamName ? mdText`, as a member of **${teamName}**` : FeedMarkdown.empty()}`;
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
 * writes it in. A page escalated says so in its headline already.
 */
const getStepMessageSentence: (
  statusMessage: string | undefined,
) => MarkdownText = (statusMessage: string | undefined): MarkdownText => {
  const message: string = (statusMessage || "").trim();

  if (!message || isOnCallPagePassedOnStatusMessage(message)) {
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
    const reason: MarkdownText = !scheduleName
      ? mdText`this escalation rule has no responders`
      : input.isNextInRotation
        ? mdText`nobody was next in the **${scheduleName}** rotation`
        : mdText`nobody was on call in schedule **${scheduleName}**`;

    return mdText`${policy} paged nobody at ${getLevel(input)}: ${reason}.`;
  }

  const recipient: MarkdownText = mdText`**${input.recipient!}**`;
  const rule: MarkdownText = getRuleClause(input);

  switch (input.status) {
    case OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged:
      return mdText`${recipient} acknowledged the page from ${getPolicy(
        input.policyLink,
        { isInSentence: true },
      )} at ${rule}.`;
    // They could not take it, and escalated it (OnCallPagePassOn).
    case OnCallDutyExecutionLogTimelineStatus.PassedOn:
      return mdText`${recipient} escalated the page from ${getPolicy(
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
    // It pages nobody yet; its message says why and until when.
    case OnCallDutyPolicyStatus.Waiting:
      return [mdText`${policy} is not paging yet.`, ...messageSentences];
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

      /*
       * It waited to page, and its record was handled first: it never
       * paged, so it did not "stop" (OnCallDutyPolicyRunWait).
       */
      if (isOnCallPolicyRunEndedWhileWaiting(message)) {
        const why: string = message
          .slice(ON_CALL_POLICY_RUN_ENDED_WHILE_WAITING_MESSAGE_START.length)
          .trim();

        return [
          mdText`${policy} did not page anyone because the ${asSentence(why)}`,
        ];
      }

      // Nobody was left: everybody it paged escalated it.
      if (isOnCallPolicyRunEverybodyPassedOnMessage(message)) {
        return [
          mdText`${policy} stopped paging: everybody it paged escalated it, and nobody was left to page.`,
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

/*
 * Who started a direct page, where a policy's run names the policy:
 * "Workflow **Page SRE**", the person, or the product.
 */
const getDirectPagePager: (
  pager: OnCallDirectPagePager,
  options?: { isInSentence?: boolean | undefined } | undefined,
) => MarkdownText = (
  pager: OnCallDirectPagePager,
  options?: { isInSentence?: boolean | undefined } | undefined,
): MarkdownText => {
  const workflowName: string = (pager.workflowName || "").trim();

  if (workflowName) {
    return options?.isInSentence
      ? mdText`workflow **${workflowName}**`
      : mdText`Workflow **${workflowName}**`;
  }

  if (hasMarkdown(pager.startedByUser)) {
    return mdText`**${pager.startedByUser!}**`;
  }

  return mdText`${ProductBrandingText.getProductName()}`;
};

/*
 * Whether a person started a direct page - from a chat - rather than a
 * workflow, or the product with nobody named (getDirectPagePager's order).
 */
const isDirectPageStartedByPerson: (pager: OnCallDirectPagePager) => boolean = (
  pager: OnCallDirectPagePager,
): boolean => {
  return !(pager.workflowName || "").trim() && hasMarkdown(pager.startedByUser);
};

/*
 * Why the person was among those paged: ", on call in schedule **Primary**"
 * or ", as a member of **Platform**". Nothing for a person named themselves.
 */
const getDirectPageVia: (
  input: OnCallDirectPageStepFeedTextInput,
) => MarkdownText = (
  input: OnCallDirectPageStepFeedTextInput,
): MarkdownText => {
  const scheduleName: string = (input.scheduleName || "").trim();
  const teamName: string = (input.teamName || "").trim();

  if (scheduleName) {
    return mdText`, on call in schedule **${scheduleName}**`;
  }

  if (teamName) {
    return mdText`, as a member of **${teamName}**`;
  }

  return FeedMarkdown.empty();
};

// Who a direct page paged, or did not, and through what.
const getDirectPageStepHeadline: (
  input: OnCallDirectPageStepFeedTextInput,
) => MarkdownText = (
  input: OnCallDirectPageStepFeedTextInput,
): MarkdownText => {
  const pager: MarkdownText = getDirectPagePager(input.pager);

  if (!hasMarkdown(input.recipient)) {
    const scheduleName: string = (input.scheduleName || "").trim();
    const teamName: string = (input.teamName || "").trim();

    if (scheduleName) {
      return mdText`${pager} paged nobody: nobody was on call in schedule **${scheduleName}**.`;
    }

    if (teamName) {
      return mdText`${pager} paged nobody: team **${teamName}** has no members.`;
    }

    return mdText`${pager} paged nobody.`;
  }

  const recipient: MarkdownText = mdText`**${input.recipient!}**`;
  const via: MarkdownText = getDirectPageVia(input);

  switch (input.status) {
    case OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged:
      return mdText`${recipient} acknowledged the page from ${getDirectPagePager(
        input.pager,
        { isInSentence: true },
      )}.`;
    // They could not take it, and escalated it (OnCallPagePassOn).
    case OnCallDutyExecutionLogTimelineStatus.PassedOn:
      return mdText`${recipient} escalated the page from ${getDirectPagePager(
        input.pager,
        { isInSentence: true },
      )}.`;
    case OnCallDutyExecutionLogTimelineStatus.Error:
      return mdText`${pager} could not page ${recipient}${via}.`;
    case OnCallDutyExecutionLogTimelineStatus.Skipped:
      return mdText`${pager} did not page ${recipient}${via}.`;
    case OnCallDutyExecutionLogTimelineStatus.NotificationSent:
      return mdText`${pager} paged ${recipient}${via}.`;
    default:
      return mdText`${pager} is paging ${recipient}${via}.`;
  }
};

/*
 * How a direct page that ended says so, read back from the fixed words its
 * run was given as it ended (OnCallDutyPolicyRunEnding, OnCallDirectPage).
 */
const getDirectPageStatusSentences: (
  input: OnCallDirectPageStatusFeedTextInput,
) => Array<MarkdownText> = (
  input: OnCallDirectPageStatusFeedTextInput,
): Array<MarkdownText> => {
  const pager: MarkdownText = getDirectPagePager(input.pager);
  const message: string = (input.statusMessage || "").trim();
  const messageSentences: Array<MarkdownText> = message
    ? [asSentence(message)]
    : [];

  /*
   * What stopped: "Workflow **Page SRE** stopped paging" - or, for a page a
   * person started, "The page from **Simon Lee** stopped" (see the header).
   */
  const isStartedByPerson: boolean = isDirectPageStartedByPerson(input.pager);
  const stopped: MarkdownText = isStartedByPerson
    ? mdText`The page from ${pager} stopped`
    : mdText`${pager} stopped paging`;

  switch (input.status) {
    case OnCallDutyPolicyStatus.Scheduled:
      return [mdText`${pager} is about to page.`];
    case OnCallDutyPolicyStatus.Started:
      return [mdText`${pager} started paging.`];
    case OnCallDutyPolicyStatus.Executing:
      return [mdText`${pager} is paging.`, ...messageSentences];
    case OnCallDutyPolicyStatus.Completed: {
      // Everybody's notifications went out, and nobody acknowledged.
      if (message === ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE) {
        return [mdText`${stopped}: nobody acknowledged.`];
      }

      // Nobody was left: everybody it paged escalated it.
      if (isOnCallPolicyRunEverybodyPassedOnMessage(message)) {
        return [
          mdText`${stopped}: everybody it paged escalated it, and nobody was left to page.`,
        ];
      }

      if (
        message.indexOf(ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START) === 0
      ) {
        const why: string = message
          .slice(ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START.length)
          .trim();

        return [mdText`${stopped} because the ${asSentence(why)}`];
      }

      return [mdText`${stopped}.`, ...messageSentences];
    }
    // Each target's own entry says why it was not paged.
    case OnCallDutyPolicyStatus.CompletedWithNoNotifications:
      return [mdText`${pager} paged nobody.`];
    case OnCallDutyPolicyStatus.Error:
      return [
        isStartedByPerson
          ? mdText`The page from ${pager} stopped with an error.`
          : mdText`${pager} stopped with an error.`,
        ...messageSentences,
      ];
    default:
      return [
        mdText`${pager} is now **${input.status}**.`,
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
   * Started by a workflow's step, it names the workflow ("Workflow Page SRE
   * started on-call policy PolicyX"). A run that waited for working hours
   * and started before they began says why (WaitingRunsOnRecordChange):
   * "On-call policy PolicyX started paging early. The alert now matches
   * on-call rule "P1 alerts", which pages right away."
   */
  public static getRunStartedMarkdown(data: {
    policyLink: MarkdownText;
    isStartedBySomeone: boolean;
    startedByWorkflowName?: string | undefined;
    startedEarlyReason?: string | undefined;
  }): string {
    if (data.isStartedBySomeone) {
      return mdText`started on-call policy **${data.policyLink}**.`.toString();
    }

    const workflowName: string = (data.startedByWorkflowName || "").trim();

    if (workflowName) {
      return mdText`Workflow **${workflowName}** started on-call policy **${data.policyLink}**.`.toString();
    }

    const startedEarlyReason: string = (data.startedEarlyReason || "").trim();

    if (startedEarlyReason) {
      return FeedMarkdown.join(
        [
          mdText`${getPolicy(data.policyLink)} started paging early.`,
          asSentence(startedEarlyReason),
        ],
        " ",
      ).toString();
    }

    return mdText`${getPolicy(data.policyLink)} started paging.`.toString();
  }

  /*
   * A page again (OnCallAcknowledgementTimeout), as it starts: the record
   * stayed acknowledged without being resolved, so the policy pages again.
   *
   *   On-call policy PolicyX is paging again (1 of 5): the incident is still
   *     not resolved 30 minutes after Ana Lopez acknowledged it.
   *
   * Without anybody to name - acknowledged through the API, say - "after it
   * was acknowledged". The last page again says it is the last.
   */
  public static getRunPagedAgainMarkdown(data: {
    policyLink: MarkdownText;
    pageAgainNumber: number;
    minutes: number;
    // "incident", "alert", "incident episode" or "alert episode".
    recordKind: string;
    // Who acknowledged it last, as a link to them, when somebody did.
    acknowledgedBy?: MarkdownText | undefined;
  }): string {
    const place: string = getOnCallPageAgainPlaceWithLast(data.pageAgainNumber);
    const after: string = describeOnCallAcknowledgementTimeout(data.minutes);
    const recordKind: string = (data.recordKind || "").trim() || "record";

    const acknowledged: MarkdownText = hasMarkdown(data.acknowledgedBy)
      ? mdText`**${data.acknowledgedBy!}** acknowledged it`
      : mdText`it was acknowledged`;

    return mdText`${getPolicy(data.policyLink)} is paging again (${place}): the ${recordKind} is still not resolved ${after} after ${acknowledged}.`.toString();
  }

  /*
   * A run that waits to page (OnCallDutyPolicyRunWait), as it is created:
   * "On-call policy PolicyX is not paging yet. Waiting for working hours:
   * paging starts at 09:00 (Europe/London)." The second sentence is the
   * run's status message, the words its Execution Logs row shows too.
   * Started by a person or a workflow, it reads as a start does, then says
   * it waits.
   */
  public static getRunWaitingMarkdown(data: {
    policyLink: MarkdownText;
    isStartedBySomeone: boolean;
    startedByWorkflowName?: string | undefined;
    waitingMessage?: string | undefined;
  }): string {
    const message: string = (data.waitingMessage || "").trim();
    const sentences: Array<MarkdownText> = [];
    const workflowName: string = (data.startedByWorkflowName || "").trim();

    if (data.isStartedBySomeone) {
      sentences.push(
        mdText`started on-call policy **${data.policyLink}**. It is not paging yet.`,
      );
    } else if (workflowName) {
      sentences.push(
        mdText`Workflow **${workflowName}** started on-call policy **${data.policyLink}**. It is not paging yet.`,
      );
    } else {
      sentences.push(mdText`${getPolicy(data.policyLink)} is not paging yet.`);
    }

    if (message) {
      sentences.push(asSentence(message));
    }

    return FeedMarkdown.join(sentences, " ").toString();
  }

  /*
   * One step of a direct page: a person paged, acknowledged, skipped or
   * failed, or a team or a schedule it found nobody in.
   */
  public static getDirectPageStepMarkdown(
    input: OnCallDirectPageStepFeedTextInput,
  ): string {
    const sentences: Array<MarkdownText> = [getDirectPageStepHeadline(input)];

    // A line about nobody says why in its own words.
    if (!hasMarkdown(input.recipient)) {
      return FeedMarkdown.join(sentences, "\n\n").toString();
    }

    if (hasMarkdown(input.overriddenUser)) {
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

  // Where a direct page stands now: stopped and why, paged nobody, failed.
  public static getDirectPageStatusMarkdown(
    input: OnCallDirectPageStatusFeedTextInput,
  ): string {
    return FeedMarkdown.join(
      getDirectPageStatusSentences(input),
      "\n\n",
    ).toString();
  }

  /*
   * Whether a run's new status is news for the record's feed. A run says it
   * started when it is created (getRunStartedMarkdown), and every page it
   * sends is an entry of its own (getStepMarkdown), so the statuses it
   * passes through on the way - scheduled, started, executing - only said
   * "started paging" twice and "is paging" once more, on every run. How the
   * run ended is news: it stopped, paged nobody, or failed. A run that waits
   * to page says so as it is created (getRunWaitingMarkdown), and that it
   * started paging once it does (OnCallDutyPolicyExecutionLogService
   * .startWaitingRun).
   */
  public static isRunStatusFeedNews(
    status: OnCallDutyPolicyStatus | undefined,
  ): boolean {
    if (!status) {
      return false;
    }

    return (
      status !== OnCallDutyPolicyStatus.Waiting &&
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
