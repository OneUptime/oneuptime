import { SecurityPlaybookActionType } from "../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { getSecurityPlaybookActionTitleWords } from "../../Types/SecurityPlaybook/SecurityPlaybookActionWords";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import SecurityEventRequestOutcome, {
  SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER,
} from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  TemplateValues,
  Translator,
  formatList,
  translationKey,
} from "../../Types/Translator";
import OneUptimeDate from "../../Types/Date";
import FeedMarkdown, { MarkdownText } from "../Markdown/FeedMarkdown";

/*
 * A STEP THAT WAITS FOR A PERSON'S APPROVAL, AS THE PERSON IS ASKED.
 *
 * Containment waits for a person: a playbook's containment step, and any
 * step marked "needs approval", holds its run until somebody approves or
 * rejects it (SecurityPlaybookEngine). The person is usually in Slack or
 * Microsoft Teams, so that is where they are asked - with the evidence, so
 * nobody approves blind (#10341). This is what the question says, whoever
 * asks it and wherever it is read:
 *
 *   - what will be done, to what: the action, the connection it acts
 *     through, and each target with why it is one - or why it is left
 *     alone;
 *   - who or what asked: a playbook that started on its own, a person who
 *     ran one, an automatic response policy, or OneUptime AI;
 *   - the evidence: how far the requests behind the case got, what threat
 *     intel knows, that nothing it acts on is protected, that an address is
 *     not one of the project's, that no signed-in user used it;
 *   - what can be undone, and how;
 *   - once somebody decided: who, when, and what came of it - each target's
 *     outcome, and its undo.
 *
 * An approval is the playbook engine's, whoever asks for it: a person's
 * block from a case (#10342), an automatic response (#10350) and OneUptime
 * AI (#10352, #10353) all contain through a playbook run, so their asks are
 * made of the same parts - a source of their own, and the evidence they
 * hold. Pure: the server reads the run into an ask
 * (Server/Utils/SecurityPlaybook/SecurityPlaybookApprovalReader), and each chat
 * lays the wording out as it draws a message (WorkspaceSecurityPlaybook
 * Approval); the email takes the plain text.
 *
 * Every sentence is OneUptime's own words, in the reader's language
 * (Common/Server/Locales): a person's own direct message in the language on
 * their account (Types/UserLanguage), a channel's post in English, as every
 * channel post is. What the project or an attacker wrote - a case's title, a
 * playbook's name, a user name a brute force tried - goes in as text and is
 * never Markdown: a target is code, a name is escaped (FeedMarkdown).
 */

// Who or what asked for the step: what the message says asked.
export enum SecurityPlaybookApprovalSourceKind {
  // A playbook that started on its own: when the case opened, say.
  Playbook = "Playbook",
  // A person who ran a playbook, or asked for the action, by hand.
  Person = "Person",
  // An automatic response policy (#10350).
  AutomaticResponse = "Automatic Response",
  // OneUptime AI, working the case (#10352).
  OneUptimeAi = "OneUptime AI",
}

export interface SecurityPlaybookApprovalSource {
  kind: SecurityPlaybookApprovalSourceKind;
  /*
   * The playbook the step is part of; "" for a person's one-step run from
   * a case (#10342), which has none.
   */
  playbookName: string;
  // A playbook that started on its own: what started it.
  trigger?: SecurityPlaybookTrigger | undefined;
  // A person: their name.
  personName?: string | undefined;
  // An automatic response: the policy's name.
  policyName?: string | undefined;
}

// What the evidence the message carries is about.
export enum SecurityPlaybookApprovalEvidenceKind {
  // How far the requests behind the case got, as their traces show.
  Requests = "Requests",
  // The values the project's threat intel knows.
  ThreatIntel = "Threat Intel",
  // Nothing the step acts on is on the project's protected list.
  NotProtected = "Not Protected",
  // Addresses that are not the project's own (a block, #10342).
  NotOwnAddress = "Not Own Address",
  // Addresses no signed-in user used (a block, #10342).
  NoSignedInUser = "No Signed-In User",
}

export interface SecurityPlaybookApprovalRequestsEvidence {
  kind: SecurityPlaybookApprovalEvidenceKind.Requests;
  // How many requests reached each outcome (SecurityEventRequestOutcome).
  outcomes: Partial<Record<SecurityEventRequestOutcome, number>>;
}

export interface SecurityPlaybookApprovalValuesEvidence {
  kind:
    | SecurityPlaybookApprovalEvidenceKind.ThreatIntel
    | SecurityPlaybookApprovalEvidenceKind.NotOwnAddress
    | SecurityPlaybookApprovalEvidenceKind.NoSignedInUser;
  values: Array<string>;
}

export interface SecurityPlaybookApprovalNotProtectedEvidence {
  kind: SecurityPlaybookApprovalEvidenceKind.NotProtected;
}

export type SecurityPlaybookApprovalEvidence =
  | SecurityPlaybookApprovalRequestsEvidence
  | SecurityPlaybookApprovalValuesEvidence
  | SecurityPlaybookApprovalNotProtectedEvidence;

// One user, host or address the step acts on - or leaves alone.
export interface SecurityPlaybookApprovalTarget {
  value: string;
  // Why it is a target: what puts it on the attacker's side.
  reason?: SecurityPlaybookTargetReason | undefined;
  state: SecurityPlaybookTargetState;
  // What the product said of it, as it said it: "suspended".
  detail?: string | undefined;
  // A protected one: the entry on the protected list it matches.
  protectedBy?: string | undefined;
  // An undone one: who released it, and when.
  undoneByName?: string | undefined;
  undoneAt?: Date | undefined;
}

// Where an approval stands now.
export enum SecurityPlaybookApprovalStandingKind {
  // Nobody has decided: the run waits.
  Waiting = "Waiting",
  Approved = "Approved",
  Rejected = "Rejected",
  // The run stopped waiting without a decision: cancelled, say.
  NoLongerWaiting = "No Longer Waiting",
}

// How an approved step went since.
export enum SecurityPlaybookApprovalProgress {
  // Queued, or running: it has not finished.
  Running = "Running",
  Done = "Done",
  Failed = "Failed",
  // The run was cancelled before the step ran.
  CancelledBeforeRun = "Cancelled Before Run",
  // The run ended otherwise before the step ran: it failed, say.
  StoppedBeforeRun = "Stopped Before Run",
}

export interface SecurityPlaybookApprovalStanding {
  kind: SecurityPlaybookApprovalStandingKind;
  // Approved or rejected: by whom, and when.
  deciderName?: string | undefined;
  decidedAt?: Date | undefined;
  // Approved: how the step went since, and when it finished.
  progress?: SecurityPlaybookApprovalProgress | undefined;
  completedAt?: Date | undefined;
  // A step that failed: why, as the step said.
  error?: string | undefined;
  // No longer waiting: because the run was cancelled.
  isRunCancelled?: boolean | undefined;
}

// Everything the message says, read from the run as it is now.
export interface SecurityPlaybookApprovalAsk {
  // The case: "SEC-12", its title, and the approval on it in OneUptime.
  caseNumber: string;
  caseTitle: string;
  caseUrl: string;
  action: SecurityPlaybookActionType;
  // The connection the step acts through, by its name.
  connectionName?: string | undefined;
  /*
   * What the step acts on, for a step that acts on users, hosts or
   * addresses: proposed ones, and the protected ones it leaves alone.
   * Empty for a step that acts on nobody in particular.
   */
  targets: Array<SecurityPlaybookApprovalTarget>;
  source: SecurityPlaybookApprovalSource;
  evidence: Array<SecurityPlaybookApprovalEvidence>;
  // The action that undoes it, when there is one.
  undoAction?: SecurityPlaybookActionType | undefined;
  standing: SecurityPlaybookApprovalStanding;
}

/*
 * One line of the message, both ways: Markdown for a chat, where every
 * value is placed as text; plain text for an email, a notification and a
 * log, every value as it is.
 */
export interface SecurityPlaybookApprovalLine {
  markdown: MarkdownText;
  text: string;
}

// A moment, as the reader is shown it: in their own time where a chat can.
export interface SecurityPlaybookApprovalTime {
  markdown: MarkdownText;
  text: string;
}

export interface SecurityPlaybookApprovalWording {
  // "Approval needed on SEC-12: ...", or who decided and when.
  headline: SecurityPlaybookApprovalLine;
  // An approved step: how it is going.
  progress?: SecurityPlaybookApprovalLine | undefined;
  // "Suspend the user in Okta, through Okta (acme)".
  action: SecurityPlaybookApprovalLine;
  targets: Array<SecurityPlaybookApprovalLine>;
  source: SecurityPlaybookApprovalLine;
  evidence: Array<SecurityPlaybookApprovalLine>;
  undo: SecurityPlaybookApprovalLine;
  // While it waits: what each button does.
  note?: SecurityPlaybookApprovalLine | undefined;
}

// What the message's buttons say.
export interface SecurityPlaybookApprovalButtonWords {
  approve: string;
  approveSome: string;
  reject: string;
  openCase: string;
}

// What Approve Some's form says.
export interface SecurityPlaybookApprovalFormWords {
  title: string;
  intro: string;
  submit: string;
  cancel: string;
}

// What a press is answered with, only to whoever pressed.
export enum SecurityPlaybookApprovalAnswerKind {
  Approved = "Approved",
  Rejected = "Rejected",
  AlreadyApproved = "Already Approved",
  AlreadyRejected = "Already Rejected",
  NoLongerWaiting = "No Longer Waiting",
  StartedTheRun = "Started The Run",
  Changed = "Changed",
  NotReadable = "Not Readable",
  CouldNotCheck = "Could Not Check",
  KeepAtLeastOne = "Keep At Least One",
}

/*
 * The sentences, by their English: each language's wording is in
 * Common/Server/Locales, looked up by it.
 */
export const SECURITY_PLAYBOOK_APPROVAL_WORDS: {
  headlineWaiting: string;
  headlineApproved: string;
  headlineRejected: string;
  headlineCancelled: string;
  headlineNoLongerWaiting: string;
  progressRunning: string;
  progressDone: string;
  progressFailed: string;
  progressCancelledBeforeRun: string;
  progressStoppedBeforeRun: string;
  actionThrough: string;
  targetGroupedOn: string;
  targetThreatIntel: string;
  targetOnTheCase: string;
  targetProtected: string;
  targetProtectedBy: string;
  targetProtectedOwn: string;
  targetLeftOut: string;
  targetDone: string;
  targetAlreadyDone: string;
  targetNotFound: string;
  targetFailed: string;
  targetUndoneBy: string;
  targetUndone: string;
  sourceCaseOpened: string;
  sourceDetectionAdded: string;
  sourceTriaged: string;
  sourceByHand: string;
  sourcePerson: string;
  sourcePersonOnCase: string;
  sourceAutomaticResponse: string;
  sourceOneUptimeAi: string;
  outcomeRejected: string;
  outcomeReachedApp: string;
  outcomeErrored: string;
  outcomeReachedDatabase: string;
  threatIntel: string;
  notProtected: string;
  notOwnAddress: string;
  noSignedInUser: string;
  undoEach: string;
  undoNone: string;
  noteApprove: string;
  noteApproveSome: string;
  buttonApprove: string;
  buttonApproveSome: string;
  buttonReject: string;
  buttonOpenCase: string;
  formTitle: string;
  formIntro: string;
  formCancel: string;
  answerApproved: string;
  answerRejected: string;
  answerAlreadyApproved: string;
  answerAlreadyRejected: string;
  answerNoLongerWaiting: string;
  answerStartedTheRun: string;
  answerChanged: string;
  answerNotReadable: string;
  answerCouldNotCheck: string;
  answerKeepAtLeastOne: string;
} = {
  headlineWaiting: translationKey("Approval needed on {{case}}: {{title}}"),
  headlineApproved: translationKey("Approved by {{person}} at {{time}}"),
  headlineRejected: translationKey(
    "Rejected by {{person}} at {{time}}. Nothing was done.",
  ),
  headlineCancelled: translationKey(
    "No longer waiting for approval: the run was cancelled.",
  ),
  headlineNoLongerWaiting: translationKey("No longer waiting for approval."),
  progressRunning: translationKey("Running now."),
  progressDone: translationKey("Done at {{time}}."),
  progressFailed: translationKey("Failed at {{time}}: {{error}}"),
  progressCancelledBeforeRun: translationKey(
    "The run was cancelled before this step ran.",
  ),
  progressStoppedBeforeRun: translationKey(
    "The run stopped before this step ran.",
  ),
  actionThrough: translationKey("{{action}}, through {{connection}}"),
  targetGroupedOn: translationKey("{{target}}: the case is grouped on it"),
  targetThreatIntel: translationKey("{{target}}: known to threat intel"),
  targetOnTheCase: translationKey("{{target}}: one of the case's addresses"),
  targetProtected: translationKey(
    "{{target}}: on your protected list, so it is never acted on",
  ),
  targetProtectedBy: translationKey(
    "{{target}}: matches {{entry}} on your protected list, so it is never acted on",
  ),
  targetProtectedOwn: translationKey(
    "{{target}}: one of your own addresses, so it is never blocked",
  ),
  targetLeftOut: translationKey("{{target}}: left out by the approver"),
  targetDone: translationKey("{{target}}: done"),
  targetAlreadyDone: translationKey(
    "{{target}}: it already was, before the step ran",
  ),
  targetNotFound: translationKey("{{target}}: not found"),
  targetFailed: translationKey("{{target}}: failed"),
  targetUndoneBy: translationKey(
    "{{target}}: undone by {{person}} at {{time}}",
  ),
  targetUndone: translationKey("{{target}}: undone at {{time}}"),
  sourceCaseOpened: translationKey(
    "Asked by playbook {{playbook}}, which started when the case opened.",
  ),
  sourceDetectionAdded: translationKey(
    "Asked by playbook {{playbook}}, which started for a new detection.",
  ),
  sourceTriaged: translationKey(
    "Asked by playbook {{playbook}}, which started when {{ai}} triaged the case as likely malicious.",
  ),
  sourceByHand: translationKey(
    "Asked by playbook {{playbook}}, which was started by hand.",
  ),
  sourcePerson: translationKey(
    "Asked by {{person}}, who started playbook {{playbook}} by hand.",
  ),
  sourcePersonOnCase: translationKey("Asked by {{person}}, on the case."),
  sourceAutomaticResponse: translationKey(
    "Asked by the automatic response policy {{policy}}.",
  ),
  sourceOneUptimeAi: translationKey(
    "Asked by {{ai}}, which is working the case.",
  ),
  outcomeRejected: translationKey("Turned away: {{count}}"),
  outcomeReachedApp: translationKey("Reached the app: {{count}}"),
  outcomeErrored: translationKey("Errored: {{count}}"),
  outcomeReachedDatabase: translationKey("Reached the database: {{count}}"),
  threatIntel: translationKey("Known to threat intel: {{values}}"),
  notProtected: translationKey("Nothing it acts on is on your protected list."),
  notOwnAddress: translationKey("Not one of your addresses: {{values}}"),
  noSignedInUser: translationKey("No signed-in user used it: {{values}}"),
  undoEach: translationKey(
    "Can be undone: each one, with {{undo}} on the case.",
  ),
  undoNone: translationKey("Cannot be undone from {{product}}."),
  noteApprove: translationKey(
    "Approve runs this step now, as you. Reject ends the run.",
  ),
  noteApproveSome: translationKey(
    "Approve runs this step now, as you. Approve Some lets you leave some out. Reject ends the run.",
  ),
  buttonApprove: translationKey("Approve"),
  buttonApproveSome: translationKey("Approve Some…"),
  buttonReject: translationKey("Reject"),
  buttonOpenCase: translationKey("Open Case"),
  formTitle: translationKey("Approve Some"),
  formIntro: translationKey(
    "Untick anything the step should leave alone. It acts on the rest, as you.",
  ),
  formCancel: translationKey("Cancel"),
  answerApproved: translationKey(
    "You approved it. The step is running now, and this message shows how it goes.",
  ),
  answerRejected: translationKey(
    "You rejected it. The run has ended, and nothing was done.",
  ),
  answerAlreadyApproved: translationKey(
    "Already approved by {{person}} at {{time}}, so nothing more was done.",
  ),
  answerAlreadyRejected: translationKey(
    "Already rejected by {{person}} at {{time}}, so nothing was done.",
  ),
  answerNoLongerWaiting: translationKey(
    "This step no longer waits for approval, so nothing was done. Open the case in {{product}} to see where its run is.",
  ),
  answerStartedTheRun: translationKey(
    "You started this run, so someone else must approve its steps.",
  ),
  answerChanged: translationKey(
    "This approval changed after the message was sent, so nothing was done. Open the case in {{product}} to decide there.",
  ),
  answerNotReadable: translationKey(
    "This button does not name an approval {{product}} can check, so nothing was done. Open the case in {{product}} to decide there.",
  ),
  answerCouldNotCheck: translationKey(
    "{{product}} could not check this approval, so nothing was done. Open the case in {{product}} to decide there.",
  ),
  answerKeepAtLeastOne: translationKey(
    "Keep at least one ticked to approve the step, or reject it.",
  ),
};

// What every wording is told besides the ask.
export interface SecurityPlaybookApprovalWordingContext {
  translator: Translator;
  // "OneUptime", or the name a self-hosted install brands itself with.
  productName: string;
  // A moment, as the place the message is read in shows it.
  formatTime: (date: Date) => SecurityPlaybookApprovalTime;
}

// A value as a sentence takes it: placed as text in Markdown, as it is in text.
interface ApprovalValue {
  markdown: string;
  text: string;
}

const asText: (value: string) => ApprovalValue = (
  value: string,
): ApprovalValue => {
  return { markdown: FeedMarkdown.textInLine(value).toString(), text: value };
};

const asCode: (value: string) => ApprovalValue = (
  value: string,
): ApprovalValue => {
  return { markdown: FeedMarkdown.code(value).toString(), text: value };
};

const asBold: (value: string) => ApprovalValue = (
  value: string,
): ApprovalValue => {
  const escaped: string = FeedMarkdown.textInLine(value).toString();

  return { markdown: escaped ? `**${escaped}**` : "", text: value };
};

const asTime: (time: SecurityPlaybookApprovalTime) => ApprovalValue = (
  time: SecurityPlaybookApprovalTime,
): ApprovalValue => {
  return { markdown: time.markdown.toString(), text: time.text };
};

// A sentence of the reader's language, filled both ways.
const say: (
  context: SecurityPlaybookApprovalWordingContext,
  template: string,
  values?: Record<string, ApprovalValue>,
) => SecurityPlaybookApprovalLine = (
  context: SecurityPlaybookApprovalWordingContext,
  template: string,
  values: Record<string, ApprovalValue> = {},
): SecurityPlaybookApprovalLine => {
  const markdownValues: TemplateValues = {};
  const textValues: TemplateValues = {};

  for (const key of Object.keys(values)) {
    markdownValues[key] = values[key]!.markdown;
    textValues[key] = values[key]!.text;
  }

  return {
    markdown: FeedMarkdown.asMarkdown(
      context.translator.translateTemplate(template, markdownValues),
    ),
    text: context.translator.translateTemplate(template, textValues),
  };
};

// The product's name, as a sentence takes it.
const product: (context: SecurityPlaybookApprovalWordingContext) => {
  product: ApprovalValue;
} = (
  context: SecurityPlaybookApprovalWordingContext,
): { product: ApprovalValue } => {
  return { product: asText(context.productName) };
};

/*
 * The product's AI by its name, "OneUptime AI" or a self-hosted install's
 * "<brand> AI": one value, written as it is in every language, as the name
 * of a product is - never a word a translation words as its own (#10341).
 */
const productAi: (context: SecurityPlaybookApprovalWordingContext) => {
  ai: ApprovalValue;
} = (
  context: SecurityPlaybookApprovalWordingContext,
): { ai: ApprovalValue } => {
  return { ai: asText(`${context.productName} AI`) };
};

// Values joined as the reader's language joins a list, each as code.
const asCodeList: (
  context: SecurityPlaybookApprovalWordingContext,
  values: Array<string>,
) => ApprovalValue = (
  context: SecurityPlaybookApprovalWordingContext,
  values: Array<string>,
): ApprovalValue => {
  return {
    markdown: formatList(
      values.map((value: string): string => {
        return FeedMarkdown.code(value).toString();
      }),
      context.translator,
    ),
    text: formatList(values, context.translator),
  };
};

// An action's title, in the reader's language.
export function getSecurityPlaybookApprovalActionTitle(data: {
  translator: Translator;
  action: SecurityPlaybookActionType | string;
}): string {
  const english: string = getSecurityPlaybookActionTitleWords(data.action);

  return data.translator.translateText(english) || english;
}

// What the buttons of a waiting approval say.
export function getSecurityPlaybookApprovalButtonWords(
  translator: Translator,
): SecurityPlaybookApprovalButtonWords {
  const words: typeof SECURITY_PLAYBOOK_APPROVAL_WORDS =
    SECURITY_PLAYBOOK_APPROVAL_WORDS;

  return {
    approve: translator.translateTemplate(words.buttonApprove),
    approveSome: translator.translateTemplate(words.buttonApproveSome),
    reject: translator.translateTemplate(words.buttonReject),
    openCase: translator.translateTemplate(words.buttonOpenCase),
  };
}

// What Approve Some's form says.
export function getSecurityPlaybookApprovalFormWords(
  translator: Translator,
): SecurityPlaybookApprovalFormWords {
  const words: typeof SECURITY_PLAYBOOK_APPROVAL_WORDS =
    SECURITY_PLAYBOOK_APPROVAL_WORDS;

  return {
    title: translator.translateTemplate(words.formTitle),
    intro: translator.translateTemplate(words.formIntro),
    submit: translator.translateTemplate(words.buttonApprove),
    cancel: translator.translateTemplate(words.formCancel),
  };
}

// The targets an approver may leave out: the proposed ones.
export function getProposedTargets(
  ask: Pick<SecurityPlaybookApprovalAsk, "targets">,
): Array<SecurityPlaybookApprovalTarget> {
  return ask.targets.filter(
    (target: SecurityPlaybookApprovalTarget): boolean => {
      return target.state === SecurityPlaybookTargetState.Proposed;
    },
  );
}

/*
 * Whether Approve Some is offered: a step that waits on two or more proposed
 * targets. With one, leaving it out leaves nothing to approve.
 */
export function offersApproveSome(
  ask: Pick<SecurityPlaybookApprovalAsk, "targets">,
): boolean {
  return getProposedTargets(ask).length > 1;
}

function wordHeadline(
  ask: SecurityPlaybookApprovalAsk,
  context: SecurityPlaybookApprovalWordingContext,
): SecurityPlaybookApprovalLine {
  const words: typeof SECURITY_PLAYBOOK_APPROVAL_WORDS =
    SECURITY_PLAYBOOK_APPROVAL_WORDS;
  const standing: SecurityPlaybookApprovalStanding = ask.standing;

  if (
    standing.kind === SecurityPlaybookApprovalStandingKind.Approved ||
    standing.kind === SecurityPlaybookApprovalStandingKind.Rejected
  ) {
    const decided: Record<string, ApprovalValue> = {
      person: asText(standing.deciderName || ""),
      time: asTime(
        context.formatTime(
          standing.decidedAt || OneUptimeDate.getCurrentDate(),
        ),
      ),
    };

    return say(
      context,
      standing.kind === SecurityPlaybookApprovalStandingKind.Approved
        ? words.headlineApproved
        : words.headlineRejected,
      decided,
    );
  }

  if (standing.kind === SecurityPlaybookApprovalStandingKind.NoLongerWaiting) {
    return say(
      context,
      standing.isRunCancelled
        ? words.headlineCancelled
        : words.headlineNoLongerWaiting,
    );
  }

  return say(context, words.headlineWaiting, {
    case: {
      markdown: ask.caseUrl
        ? FeedMarkdown.link(ask.caseNumber, ask.caseUrl).toString()
        : FeedMarkdown.textInLine(ask.caseNumber).toString(),
      text: ask.caseNumber,
    },
    title: asText(ask.caseTitle),
  });
}

function wordProgress(
  ask: SecurityPlaybookApprovalAsk,
  context: SecurityPlaybookApprovalWordingContext,
): SecurityPlaybookApprovalLine | undefined {
  const words: typeof SECURITY_PLAYBOOK_APPROVAL_WORDS =
    SECURITY_PLAYBOOK_APPROVAL_WORDS;
  const standing: SecurityPlaybookApprovalStanding = ask.standing;

  if (standing.kind !== SecurityPlaybookApprovalStandingKind.Approved) {
    return undefined;
  }

  const completedAt: SecurityPlaybookApprovalTime = context.formatTime(
    standing.completedAt || OneUptimeDate.getCurrentDate(),
  );

  switch (standing.progress) {
    case SecurityPlaybookApprovalProgress.Done:
      return say(context, words.progressDone, { time: asTime(completedAt) });
    case SecurityPlaybookApprovalProgress.Failed:
      return say(context, words.progressFailed, {
        time: asTime(completedAt),
        error: asText(standing.error || ""),
      });
    case SecurityPlaybookApprovalProgress.CancelledBeforeRun:
      return say(context, words.progressCancelledBeforeRun);
    case SecurityPlaybookApprovalProgress.StoppedBeforeRun:
      return say(context, words.progressStoppedBeforeRun);
    default:
      return say(context, words.progressRunning);
  }
}

function wordAction(
  ask: SecurityPlaybookApprovalAsk,
  context: SecurityPlaybookApprovalWordingContext,
): SecurityPlaybookApprovalLine {
  const title: ApprovalValue = asBold(
    getSecurityPlaybookApprovalActionTitle({
      translator: context.translator,
      action: ask.action,
    }),
  );

  if (!ask.connectionName) {
    return {
      markdown: FeedMarkdown.asMarkdown(title.markdown),
      text: title.text,
    };
  }

  return say(context, SECURITY_PLAYBOOK_APPROVAL_WORDS.actionThrough, {
    action: title,
    connection: asText(ask.connectionName),
  });
}

function wordTarget(
  target: SecurityPlaybookApprovalTarget,
  context: SecurityPlaybookApprovalWordingContext,
): SecurityPlaybookApprovalLine {
  const words: typeof SECURITY_PLAYBOOK_APPROVAL_WORDS =
    SECURITY_PLAYBOOK_APPROVAL_WORDS;
  const value: ApprovalValue = asCode(target.value);

  // What the product said of it, after OneUptime's words: as it said it.
  const withDetail: (
    line: SecurityPlaybookApprovalLine,
  ) => SecurityPlaybookApprovalLine = (
    line: SecurityPlaybookApprovalLine,
  ): SecurityPlaybookApprovalLine => {
    const detail: string = (target.detail || "").trim();

    if (!detail) {
      return line;
    }

    return {
      markdown: FeedMarkdown.asMarkdown(
        `${line.markdown.toString()} · ${FeedMarkdown.textInLine(detail).toString()}`,
      ),
      text: `${line.text} · ${detail}`,
    };
  };

  switch (target.state) {
    case SecurityPlaybookTargetState.Protected:
      /*
       * One of the project's own addresses (#10342): the blocklist said
       * what it is - a host's, a load balancer's - which the line carries.
       */
      if ((target.detail || "").trim()) {
        return withDetail(
          say(context, words.targetProtectedOwn, { target: value }),
        );
      }

      return target.protectedBy &&
        target.protectedBy.toLowerCase() !== target.value.toLowerCase()
        ? say(context, words.targetProtectedBy, {
            target: value,
            entry: asCode(target.protectedBy),
          })
        : say(context, words.targetProtected, { target: value });
    case SecurityPlaybookTargetState.LeftOut:
      return say(context, words.targetLeftOut, { target: value });
    case SecurityPlaybookTargetState.Done:
      return withDetail(say(context, words.targetDone, { target: value }));
    case SecurityPlaybookTargetState.AlreadyDone:
      return withDetail(
        say(context, words.targetAlreadyDone, { target: value }),
      );
    case SecurityPlaybookTargetState.NotFound:
      return withDetail(say(context, words.targetNotFound, { target: value }));
    case SecurityPlaybookTargetState.Failed:
      return withDetail(say(context, words.targetFailed, { target: value }));
    case SecurityPlaybookTargetState.Undone: {
      const undoneAt: ApprovalValue = asTime(
        context.formatTime(target.undoneAt || OneUptimeDate.getCurrentDate()),
      );

      return target.undoneByName
        ? say(context, words.targetUndoneBy, {
            target: value,
            person: asText(target.undoneByName),
            time: undoneAt,
          })
        : say(context, words.targetUndone, { target: value, time: undoneAt });
    }
    default:
      return say(
        context,
        target.reason === SecurityPlaybookTargetReason.ThreatIntel
          ? words.targetThreatIntel
          : target.reason === SecurityPlaybookTargetReason.OnTheCase
            ? words.targetOnTheCase
            : words.targetGroupedOn,
        { target: value },
      );
  }
}

function wordSource(
  ask: SecurityPlaybookApprovalAsk,
  context: SecurityPlaybookApprovalWordingContext,
): SecurityPlaybookApprovalLine {
  const words: typeof SECURITY_PLAYBOOK_APPROVAL_WORDS =
    SECURITY_PLAYBOOK_APPROVAL_WORDS;
  const source: SecurityPlaybookApprovalSource = ask.source;
  const playbook: ApprovalValue = asBold(source.playbookName);

  switch (source.kind) {
    case SecurityPlaybookApprovalSourceKind.Person:
      // A person's one-step block from the case (#10342): no playbook to name.
      if (!source.playbookName) {
        return say(context, words.sourcePersonOnCase, {
          person: asText(source.personName || ""),
        });
      }

      return say(context, words.sourcePerson, {
        person: asText(source.personName || ""),
        playbook,
      });
    case SecurityPlaybookApprovalSourceKind.AutomaticResponse:
      return say(context, words.sourceAutomaticResponse, {
        policy: asBold(source.policyName || ""),
      });
    case SecurityPlaybookApprovalSourceKind.OneUptimeAi:
      return say(context, words.sourceOneUptimeAi, productAi(context));
    default:
      break;
  }

  switch (source.trigger) {
    case SecurityPlaybookTrigger.CaseOpened:
      return say(context, words.sourceCaseOpened, { playbook });
    case SecurityPlaybookTrigger.DetectionAdded:
      return say(context, words.sourceDetectionAdded, { playbook });
    case SecurityPlaybookTrigger.TriagedAsLikelyMalicious:
      return say(context, words.sourceTriaged, {
        playbook,
        ...productAi(context),
      });
    default:
      return say(context, words.sourceByHand, { playbook });
  }
}

// The words of each request outcome, least to most serious.
const OUTCOME_WORDS: Readonly<Record<SecurityEventRequestOutcome, string>> = {
  [SecurityEventRequestOutcome.Rejected]:
    SECURITY_PLAYBOOK_APPROVAL_WORDS.outcomeRejected,
  [SecurityEventRequestOutcome.ReachedApp]:
    SECURITY_PLAYBOOK_APPROVAL_WORDS.outcomeReachedApp,
  [SecurityEventRequestOutcome.Errored]:
    SECURITY_PLAYBOOK_APPROVAL_WORDS.outcomeErrored,
  [SecurityEventRequestOutcome.ReachedDatabase]:
    SECURITY_PLAYBOOK_APPROVAL_WORDS.outcomeReachedDatabase,
};

// A count, as the reader's language writes a number.
const asCount: (
  context: SecurityPlaybookApprovalWordingContext,
  count: number,
) => ApprovalValue = (
  context: SecurityPlaybookApprovalWordingContext,
  count: number,
): ApprovalValue => {
  const written: string = context.translator.formatNumber(count);

  return { markdown: written, text: written };
};

/*
 * The requests behind the case, by how far they got: the most serious last,
 * as the case's Overview ranks them. Undefined when no request behind the
 * case was followed - a connected product's sign-in names none.
 */
function wordRequests(
  evidence: SecurityPlaybookApprovalRequestsEvidence,
  context: SecurityPlaybookApprovalWordingContext,
): SecurityPlaybookApprovalLine | undefined {
  const parts: Array<SecurityPlaybookApprovalLine> = [];
  let total: number = 0;

  for (const outcome of SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER) {
    const count: number = Math.max(
      0,
      Math.trunc(Number(evidence.outcomes[outcome]) || 0),
    );

    if (count === 0) {
      continue;
    }

    total += count;
    parts.push(
      say(context, OUTCOME_WORDS[outcome], {
        count: asCount(context, count),
      }),
    );
  }

  if (total === 0) {
    return undefined;
  }

  const outcomes: ApprovalValue = {
    markdown: formatList(
      parts.map((part: SecurityPlaybookApprovalLine): string => {
        return part.markdown.toString();
      }),
      context.translator,
    ),
    text: formatList(
      parts.map((part: SecurityPlaybookApprovalLine): string => {
        return part.text;
      }),
      context.translator,
    ),
  };

  const fill: (values: TemplateValues) => string = (
    values: TemplateValues,
  ): string => {
    return context.translator.translatePlural(
      {
        one: "{{count}} request behind the case: {{outcomes}}",
        other: "{{count}} requests behind the case: {{outcomes}}",
      },
      total,
      values,
    );
  };

  const count: string = context.translator.formatNumber(total);

  return {
    markdown: FeedMarkdown.asMarkdown(
      fill({ count, outcomes: outcomes.markdown }),
    ),
    text: fill({ count, outcomes: outcomes.text }),
  };
}

function wordEvidence(
  ask: SecurityPlaybookApprovalAsk,
  context: SecurityPlaybookApprovalWordingContext,
): Array<SecurityPlaybookApprovalLine> {
  const words: typeof SECURITY_PLAYBOOK_APPROVAL_WORDS =
    SECURITY_PLAYBOOK_APPROVAL_WORDS;
  const lines: Array<SecurityPlaybookApprovalLine> = [];

  for (const evidence of ask.evidence) {
    switch (evidence.kind) {
      case SecurityPlaybookApprovalEvidenceKind.Requests: {
        const line: SecurityPlaybookApprovalLine | undefined = wordRequests(
          evidence,
          context,
        );

        if (line) {
          lines.push(line);
        }
        break;
      }
      case SecurityPlaybookApprovalEvidenceKind.NotProtected:
        lines.push(say(context, words.notProtected));
        break;
      case SecurityPlaybookApprovalEvidenceKind.ThreatIntel:
      case SecurityPlaybookApprovalEvidenceKind.NotOwnAddress:
      case SecurityPlaybookApprovalEvidenceKind.NoSignedInUser: {
        if (evidence.values.length === 0) {
          break;
        }

        const template: string =
          evidence.kind === SecurityPlaybookApprovalEvidenceKind.ThreatIntel
            ? words.threatIntel
            : evidence.kind ===
                SecurityPlaybookApprovalEvidenceKind.NotOwnAddress
              ? words.notOwnAddress
              : words.noSignedInUser;

        lines.push(
          say(context, template, {
            values: asCodeList(context, evidence.values),
          }),
        );
        break;
      }
    }
  }

  return lines;
}

function wordUndo(
  ask: SecurityPlaybookApprovalAsk,
  context: SecurityPlaybookApprovalWordingContext,
): SecurityPlaybookApprovalLine {
  if (!ask.undoAction) {
    return say(
      context,
      SECURITY_PLAYBOOK_APPROVAL_WORDS.undoNone,
      product(context),
    );
  }

  return say(context, SECURITY_PLAYBOOK_APPROVAL_WORDS.undoEach, {
    undo: asBold(
      getSecurityPlaybookApprovalActionTitle({
        translator: context.translator,
        action: ask.undoAction,
      }),
    ),
  });
}

// Everything the message says, in the reader's language.
export function wordSecurityPlaybookApproval(data: {
  ask: SecurityPlaybookApprovalAsk;
  context: SecurityPlaybookApprovalWordingContext;
}): SecurityPlaybookApprovalWording {
  const { ask, context } = data;
  const isWaiting: boolean =
    ask.standing.kind === SecurityPlaybookApprovalStandingKind.Waiting;

  return {
    headline: wordHeadline(ask, context),
    progress: wordProgress(ask, context),
    action: wordAction(ask, context),
    targets: ask.targets.map(
      (
        target: SecurityPlaybookApprovalTarget,
      ): SecurityPlaybookApprovalLine => {
        return wordTarget(target, context);
      },
    ),
    source: wordSource(ask, context),
    evidence: wordEvidence(ask, context),
    undo: wordUndo(ask, context),
    note: isWaiting
      ? say(
          context,
          offersApproveSome(ask)
            ? SECURITY_PLAYBOOK_APPROVAL_WORDS.noteApproveSome
            : SECURITY_PLAYBOOK_APPROVAL_WORDS.noteApprove,
        )
      : undefined,
  };
}

// What a press is answered with, in the presser's language.
export function wordSecurityPlaybookApprovalAnswer(data: {
  kind: SecurityPlaybookApprovalAnswerKind;
  context: SecurityPlaybookApprovalWordingContext;
  // Already decided: by whom, and when.
  deciderName?: string | undefined;
  decidedAt?: Date | undefined;
}): SecurityPlaybookApprovalLine {
  const words: typeof SECURITY_PLAYBOOK_APPROVAL_WORDS =
    SECURITY_PLAYBOOK_APPROVAL_WORDS;
  const context: SecurityPlaybookApprovalWordingContext = data.context;

  switch (data.kind) {
    case SecurityPlaybookApprovalAnswerKind.Approved:
      return say(context, words.answerApproved);
    case SecurityPlaybookApprovalAnswerKind.Rejected:
      return say(context, words.answerRejected);
    case SecurityPlaybookApprovalAnswerKind.AlreadyApproved:
    case SecurityPlaybookApprovalAnswerKind.AlreadyRejected:
      return say(
        context,
        data.kind === SecurityPlaybookApprovalAnswerKind.AlreadyApproved
          ? words.answerAlreadyApproved
          : words.answerAlreadyRejected,
        {
          person: asText(data.deciderName || ""),
          time: asTime(
            context.formatTime(
              data.decidedAt || OneUptimeDate.getCurrentDate(),
            ),
          ),
        },
      );
    case SecurityPlaybookApprovalAnswerKind.NoLongerWaiting:
      return say(context, words.answerNoLongerWaiting, product(context));
    case SecurityPlaybookApprovalAnswerKind.StartedTheRun:
      return say(context, words.answerStartedTheRun);
    case SecurityPlaybookApprovalAnswerKind.Changed:
      return say(context, words.answerChanged, product(context));
    case SecurityPlaybookApprovalAnswerKind.NotReadable:
      return say(context, words.answerNotReadable, product(context));
    case SecurityPlaybookApprovalAnswerKind.KeepAtLeastOne:
      return say(context, words.answerKeepAtLeastOne);
    default:
      return say(context, words.answerCouldNotCheck, product(context));
  }
}

/*
 * The approval as plain lines, for what is not a chat message: an email's
 * rows, the mobile app's approval card. The same words as every chat copy:
 * who decided, what the step does and through what, each target with why,
 * what it leaves alone, who asked, the evidence and the undo.
 */
export interface SecurityPlaybookApprovalText {
  headline: string;
  // An approved step: how it is going.
  progress?: string | undefined;
  action: string;
  // The ones it acts on - or acted on - each with why, or how it went.
  targets: Array<string>;
  // The protected ones, which the step never acts on.
  leftAlone: Array<string>;
  source: string;
  evidence: Array<string>;
  undo: string;
}

export function getSecurityPlaybookApprovalText(data: {
  ask: SecurityPlaybookApprovalAsk;
  context: SecurityPlaybookApprovalWordingContext;
}): SecurityPlaybookApprovalText {
  const wording: SecurityPlaybookApprovalWording =
    wordSecurityPlaybookApproval(data);

  const linesOf: (isProtected: boolean) => Array<string> = (
    isProtected: boolean,
  ): Array<string> => {
    return data.ask.targets
      .map((target: SecurityPlaybookApprovalTarget, index: number): string => {
        return (target.state === SecurityPlaybookTargetState.Protected) ===
          isProtected
          ? wording.targets[index]?.text || ""
          : "";
      })
      .filter((line: string): boolean => {
        return Boolean(line);
      });
  };

  return {
    headline: wording.headline.text,
    ...(wording.progress ? { progress: wording.progress.text } : {}),
    action: wording.action.text,
    targets: linesOf(false),
    leftAlone: linesOf(true),
    source: wording.source.text,
    evidence: wording.evidence.map(
      (line: SecurityPlaybookApprovalLine): string => {
        return line.text;
      },
    ),
    undo: wording.undo.text,
  };
}
