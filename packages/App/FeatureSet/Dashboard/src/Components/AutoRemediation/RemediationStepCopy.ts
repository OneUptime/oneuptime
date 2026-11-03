import {
  REMEDIATION_TRY_AGAIN_REFUSALS,
  RemediationTryAgainRefusal,
  RemediationTryAgainResult,
  RemediationTryAgainSignal,
} from "Common/Types/AutoRemediation/RemediationTryAgain";
import { AutomaticCodeFixBlocker } from "Common/Utils/Suggestions/InvestigationCodeFixSuggestion";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF THE AI CARD'S REMEDIATION STEP (block 43), as English
 * translation keys, so i18n:extract finds each one and every locale words
 * it whole. React-free: App's docs tests read them.
 */

export const REMEDIATION_STEP_TITLE: string = translationKey("Remediation");

export const REMEDIATION_STEP_STATUS_LABEL: string =
  translationKey("Remediation status");

// What the step says while it waits for the investigation.
export const REMEDIATION_STEP_WAITING: Record<
  RemediationTryAgainSignal,
  string
> = {
  incident: translationKey(
    "OneUptime AI decides how to fix this incident once the investigation is done, so it can act on the root cause.",
  ),
  alert: translationKey(
    "OneUptime AI decides how to fix this alert once the investigation is done, so it can act on the root cause.",
  ),
};

// What the step says when nothing was ever decided about the record.
export const REMEDIATION_STEP_NOT_TRIED: Record<
  RemediationTryAgainSignal,
  string
> = {
  incident: translationKey("OneUptime AI has not tried to fix this incident."),
  alert: translationKey("OneUptime AI has not tried to fix this alert."),
};

// Try again: the button, what it does, and that it worked.
export const REMEDIATION_TRY_AGAIN_BUTTON: string = translationKey("Try again");

export const REMEDIATION_TRY_AGAIN_HINT: Record<
  RemediationTryAgainSignal,
  string
> = {
  incident: translationKey(
    "Checks this incident again with the project's settings as they are now.",
  ),
  alert: translationKey(
    "Checks this alert again with the project's settings as they are now.",
  ),
};

export const REMEDIATION_TRY_AGAIN_FAILED: string = translationKey(
  "OneUptime AI could not check again",
);

/*
 * The server's refusals of Try again (RemediationTryAgain), as keys: the
 * step shows the server's sentence, and these let each locale word it.
 */
export const REMEDIATION_TRY_AGAIN_REFUSAL_KEYS: Record<
  RemediationTryAgainRefusal,
  Record<RemediationTryAgainSignal, string>
> = {
  [RemediationTryAgainResult.Resolved]: {
    incident: translationKey(
      "This incident is resolved, so OneUptime AI does not try to fix it.",
    ),
    alert: translationKey(
      "This alert is resolved, so OneUptime AI does not try to fix it.",
    ),
  },
  [RemediationTryAgainResult.WaitingForInvestigation]: {
    incident: translationKey(
      "OneUptime AI decides how to fix this incident as soon as its investigation is done.",
    ),
    alert: translationKey(
      "OneUptime AI decides how to fix this alert as soon as its investigation is done.",
    ),
  },
  [RemediationTryAgainResult.FixInProgress]: {
    incident: translationKey(
      "A fix for this incident is being worked out or waits for approval. Approve or dismiss it first.",
    ),
    alert: translationKey(
      "A fix for this alert is being worked out or waits for approval. Approve or dismiss it first.",
    ),
  },
  [RemediationTryAgainResult.TooSoon]: {
    incident: translationKey(
      "OneUptime AI has just checked this incident. Try again in a moment.",
    ),
    alert: translationKey(
      "OneUptime AI has just checked this alert. Try again in a moment.",
    ),
  },
  [RemediationTryAgainResult.Busy]: {
    incident: translationKey(
      "OneUptime AI is checking this incident right now. Try again in a moment.",
    ),
    alert: translationKey(
      "OneUptime AI is checking this alert right now. Try again in a moment.",
    ),
  },
};

// The server's sentences and these keys are the same words (a test holds it).
export const REMEDIATION_TRY_AGAIN_SERVER_SENTENCES: typeof REMEDIATION_TRY_AGAIN_REFUSALS =
  REMEDIATION_TRY_AGAIN_REFUSALS;

/*
 * The fix in the code the investigation recommends
 * (InvestigationCodeFixSuggestion), in the step's words.
 */
export const REMEDIATION_CODE_FIX_COPY: {
  inProgressAutomatic: string;
  inProgress: string;
  opened: string;
  nothingToChange: string;
  waitingForYou: string;
  recommended: string;
  noRepository: string;
  viewProgress: string;
  viewPullRequest: string;
  viewTask: string;
  answerInCode: string;
  connectRepository: string;
  openPullRequest: string;
  createFailed: string;
} = {
  inProgressAutomatic: translationKey(
    "OneUptime AI is writing a pull request that fixes the code.",
  ),
  inProgress: translationKey(
    "A pull request that fixes the code is being written.",
  ),
  opened: translationKey(
    "OneUptime AI opened a pull request that fixes the code.",
  ),
  nothingToChange: translationKey(
    "OneUptime AI read the code and found nothing to change.",
  ),
  waitingForYou: translationKey(
    "The pull request that fixes the code waits for your answer.",
  ),
  recommended: translationKey("The investigation found the cause in the code."),
  noRepository: translationKey(
    "The investigation found the cause in the code, but no code repository is connected.",
  ),
  viewProgress: translationKey("View progress"),
  viewPullRequest: translationKey("View pull request"),
  viewTask: translationKey("View task"),
  answerInCode: translationKey("Answer in Code"),
  connectRepository: translationKey("Connect a repository"),
  openPullRequest: translationKey("Open fix pull request"),
  createFailed: translationKey("Could not open the pull request"),
};

/*
 * Why OneUptime AI did not open the fix pull request on its own, under the
 * offer to open it. Null: nothing worth saying beside the offer (no
 * repository at all - the offer itself says so).
 */
export const REMEDIATION_CODE_FIX_AUTOMATIC_REASONS: Record<
  AutomaticCodeFixBlocker,
  Record<RemediationTryAgainSignal, string> | null
> = {
  [AutomaticCodeFixBlocker.AiOff]: null,
  [AutomaticCodeFixBlocker.FixOff]: {
    incident: translationKey(
      'OneUptime AI opens one on its own only while "Fix new incidents automatically" is on.',
    ),
    alert: translationKey(
      'OneUptime AI opens one on its own only while "Fix new alerts automatically" is on.',
    ),
  },
  [AutomaticCodeFixBlocker.RulesUnreadable]: {
    incident: translationKey(
      "OneUptime AI could not read this project's AI rules, so it did not open one on its own.",
    ),
    alert: translationKey(
      "OneUptime AI could not read this project's AI rules, so it did not open one on its own.",
    ),
  },
  [AutomaticCodeFixBlocker.NoMatchingRule]: {
    incident: translationKey(
      "None of this project's AI rules that fix matches this incident, so OneUptime AI did not open one on its own.",
    ),
    alert: translationKey(
      "None of this project's AI rules that fix matches this alert, so OneUptime AI did not open one on its own.",
    ),
  },
  [AutomaticCodeFixBlocker.PullRequestOff]: {
    incident: translationKey(
      "The AI rules that match this incident have fix pull requests turned off.",
    ),
    alert: translationKey(
      "The AI rules that match this alert have fix pull requests turned off.",
    ),
  },
  [AutomaticCodeFixBlocker.NoRepository]: {
    incident: translationKey(
      "None of the repositories this project's AI rules allow is connected, so OneUptime AI did not open one on its own.",
    ),
    alert: translationKey(
      "None of the repositories this project's AI rules allow is connected, so OneUptime AI did not open one on its own.",
    ),
  },
  [AutomaticCodeFixBlocker.DailyLimit]: {
    incident: translationKey(
      "OneUptime AI already opened its share of fix pull requests today.",
    ),
    alert: translationKey(
      "OneUptime AI already opened its share of fix pull requests today.",
    ),
  },
  [AutomaticCodeFixBlocker.ChangedSince]: {
    incident: translationKey(
      "OneUptime AI opens one on its own only when an investigation finishes, so open this one yourself.",
    ),
    alert: translationKey(
      "OneUptime AI opens one on its own only when an investigation finishes, so open this one yourself.",
    ),
  },
};

// The reasons a link to the AI settings or rules page goes with.
export const REMEDIATION_CODE_FIX_REASONS_WITH_SETTINGS_LINK: ReadonlyArray<AutomaticCodeFixBlocker> =
  [
    AutomaticCodeFixBlocker.FixOff,
    AutomaticCodeFixBlocker.NoMatchingRule,
    AutomaticCodeFixBlocker.PullRequestOff,
  ];

// How many of a fix's commands or changes failed, beside where it stands.
export const REMEDIATION_FIX_FAILED_COUNT: PluralTemplate = {
  one: translationKey("{{count}} failed"),
  other: translationKey("{{count}} failed"),
};

/*
 * What opens the plan of a fix that waits for approval - its reasoning and
 * each command, with Approve & Run under it - and closes it again: the
 * press its message in Slack and Microsoft Teams names too.
 */
export const REMEDIATION_FIX_REVIEW_AND_APPROVE: string =
  translationKey("Review and approve");
export const REMEDIATION_FIX_HIDE_DETAILS: string =
  translationKey("Hide details");

/*
 * A FIX, STEP BY STEP (issue #5598): "Ideally it should be in steps where
 * you have step by step sections on what AI did and why, and when I expand
 * the step - it shows me more context into why, commands ran, outputs."
 * Each fix reads as the steps it went through (RemediationFixSteps) -
 * planned, approved, ran, recovered or not, rolled back - and these are
 * their words: what OneUptime AI did, in a few words each.
 *
 * None says what the fact beside the fix's name already says in the same
 * words ("Waiting for approval", "Auto-executed", "Verified fixed"): a step
 * says what happened, the fact where the fix stands.
 */
export const REMEDIATION_FIX_STEP_COPY: {
  // plan: what OneUptime AI worked out, or that it found nothing.
  planCommands: PluralTemplate;
  planChanges: PluralTemplate;
  planRunbook: string;
  planUnreadable: string;
  composing: string;
  pickingRunbook: string;
  noSafeFix: string;
  noRunbook: string;
  // approval: the reader's, a person's, or not needed.
  waitingForApproval: string;
  cannotBeApproved: string;
  approved: string;
  approvedBy: string;
  approvedAutomatically: string;
  dismissed: string;
  dismissedBy: string;
  // run: what ran, and how it went.
  runningCommands: PluralTemplate;
  ranCommands: PluralTemplate;
  commandFailed: string;
  commandsFailed: PluralTemplate;
  makingChanges: PluralTemplate;
  madeChanges: PluralTemplate;
  changeFailed: string;
  changesFailed: PluralTemplate;
  runbookStarted: string;
  // verify: whether the incident or alert recovered.
  watching: string;
  watchingFor: PluralTemplate;
  verified: string;
  notRecovered: string;
  verificationSkipped: string;
  // rollback: what ran, undone because it did not work.
  rollingBack: string;
  rolledBack: string;
  rolledBackCommands: PluralTemplate;
  rollbackFailed: string;
  rollbackFailedSummary: string;
  notRolledBack: string;
  notRolledBackSummary: string;
  alreadyPutBackSummary: string;
} = {
  planCommands: {
    one: translationKey("Planned {{count}} command on {{targets}}"),
    other: translationKey("Planned {{count}} commands on {{targets}}"),
  },
  planChanges: {
    one: translationKey("Planned {{count}} change through {{servers}}"),
    other: translationKey("Planned {{count}} changes through {{servers}}"),
  },
  planRunbook: translationKey("Picked this runbook"),
  planUnreadable: translationKey("Planned a fix"),
  composing: translationKey("Working out a fix…"),
  pickingRunbook: translationKey("Picking a runbook…"),
  noSafeFix: translationKey("Found no safe fix"),
  noRunbook: translationKey("Found no runbook that applies"),
  waitingForApproval: translationKey("Needs your approval"),
  cannotBeApproved: translationKey("Approval blocked"),
  approved: translationKey("Approved"),
  approvedBy: translationKey("Approved by {{name}}"),
  approvedAutomatically: translationKey("Approved automatically"),
  dismissed: translationKey("Dismissed, so nothing ran"),
  dismissedBy: translationKey("Dismissed by {{name}}"),
  runningCommands: {
    one: translationKey("Running {{count}} command…"),
    other: translationKey("Running {{count}} commands…"),
  },
  ranCommands: {
    one: translationKey("Ran {{count}} command"),
    other: translationKey("Ran {{count}} commands"),
  },
  commandFailed: translationKey("The command failed"),
  commandsFailed: {
    one: translationKey("{{failed}} of {{count}} command failed"),
    other: translationKey("{{failed}} of {{count}} commands failed"),
  },
  makingChanges: {
    one: translationKey("Making {{count}} change…"),
    other: translationKey("Making {{count}} changes…"),
  },
  madeChanges: {
    one: translationKey("Made {{count}} change"),
    other: translationKey("Made {{count}} changes"),
  },
  changeFailed: translationKey("The change failed"),
  changesFailed: {
    one: translationKey("{{failed}} of {{count}} change failed"),
    other: translationKey("{{failed}} of {{count}} changes failed"),
  },
  runbookStarted: translationKey("Started the runbook"),
  watching: translationKey("Watching for recovery…"),
  watchingFor: {
    one: translationKey(
      "OneUptime checks for up to {{count}} minute whether it recovers.",
    ),
    other: translationKey(
      "OneUptime checks for up to {{count}} minutes whether it recovers.",
    ),
  },
  verified: translationKey("Recovered"),
  notRecovered: translationKey("Did not recover"),
  verificationSkipped: translationKey("Recovery not checked"),
  rollingBack: translationKey("Rolling back…"),
  rolledBack: translationKey("Rolled back"),
  rolledBackCommands: {
    one: translationKey("Rolled back {{count}} command"),
    other: translationKey("Rolled back {{count}} commands"),
  },
  rollbackFailed: translationKey("Rollback failed"),
  rollbackFailedSummary: translationKey(
    "Undo the change by hand if it is still needed.",
  ),
  notRolledBack: translationKey("Not rolled back"),
  notRolledBackSummary: translationKey("None of its commands has an undo."),
  alreadyPutBackSummary: translationKey(
    "The cluster had already put back what it changed.",
  ),
};
