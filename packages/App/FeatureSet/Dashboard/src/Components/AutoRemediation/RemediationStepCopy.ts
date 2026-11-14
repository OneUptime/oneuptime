import {
  REMEDIATION_TRY_AGAIN_REFUSALS,
  RemediationTryAgainRefusal,
  RemediationTryAgainResult,
  RemediationTryAgainSignal,
} from "Common/Types/AutoRemediation/RemediationTryAgain";
import {
  REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED,
  REMEDIATION_ROUND_TRY_AGAIN_REFUSALS,
  RemediationRoundTryAgainRefusal,
} from "Common/Types/AutoRemediation/RemediationRound";
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
 * What declines a fix that waits for approval, or one still being worked
 * out: a key of its own. The shared "Dismiss" reads as each language's word
 * for Hide since #5512 - a notice put away - and declining a fix is not
 * hiding it: it is never run, and the fix says it was dismissed. Each
 * language words it as its "Dismissed" status does, which is what pressing
 * it leaves the fix showing.
 */
export const REMEDIATION_FIX_DISMISS: string = translationKey("Dismiss fix");

/*
 * The server's refusal of Dismiss fix, word for word
 * (Types/Runbook/RunbookRunPermissions' FIX_DISMISS_REFUSED_MESSAGE), so it
 * reads in the reader's language under the buttons: dismissing asks what
 * approving asks, as the fix's Slack and Microsoft Teams buttons do.
 */
export const REMEDIATION_FIX_DISMISS_REFUSED: string = translationKey(
  "You do not have permission to dismiss this fix. Dismissing a fix needs the same permission as approving one: starting runbook executions in this project.",
);

/*
 * TWO PEOPLE APPROVE A RISKIER FIX (#6148's follow-up): where the project
 * asks two people to approve a fix that holds a riskier change
 * (Project.requireTwoApprovalsForRiskierFixes), the fix waits after its
 * first approval for a second from someone else, which runs it
 * (Common/Types/AutoRemediation/RemediationApprovals). The step says who
 * approved it first - a step of its own, in the order it happened - and that
 * a second person is needed; the person who approved first reads why
 * approving again does nothing, and is offered no Approve.
 */
export const REMEDIATION_TWO_APPROVALS_COPY: {
  // The approval step's title once a first approval is in, and the pill's.
  needsSecondApproval: string;
  // Where the fix stands, beside its name.
  waitingForSecondApproval: string;
  // Under the approval step, to a reader who may approve: theirs is first.
  yoursIsTheFirst: string;
  // ... after someone else approved it first: theirs runs it.
  yoursRunsIt: string;
  // ... to the reader who approved it first.
  youApprovedFirst: string;
  // ... to a reader who may not approve it.
  twoPeopleMustApprove: string;
  /*
   * Over the press of a first approval, which runs nothing: what pressing
   * it does, read before the press (the UI review: "Your approval is
   * recorded" said it had happened already).
   */
  firstApprovalNote: string;
  /*
   * The one line a first approver's press the server refused reads: their
   * approval stands, so it is no failure - the steps above say the rest.
   */
  alreadyApprovedTitle: string;
} = {
  needsSecondApproval: translationKey("Needs a second approval"),
  waitingForSecondApproval: translationKey("Waiting for a second approval"),
  yoursIsTheFirst: translationKey(
    "Two people must approve this riskier fix. Yours is the first.",
  ),
  yoursRunsIt: translationKey(
    "Two people must approve this riskier fix. Your approval runs it.",
  ),
  youApprovedFirst: translationKey(
    "You approved it first. It runs once someone else approves it too.",
  ),
  twoPeopleMustApprove: translationKey(
    "Two people must approve this riskier fix.",
  ),
  firstApprovalNote: translationKey(
    "Your approval alone runs nothing: the fix runs once someone else approves it too.",
  ),
  alreadyApprovedTitle: translationKey("You already approved this fix"),
};

/*
 * The server's refusal of the first approver's second press, word for word
 * (Common/Types/AutoRemediation/RemediationApprovals'
 * ALREADY_APPROVED_FIRST_MESSAGE): how the card tells that refusal from
 * every other one, and what it says, in the reader's language, on the rare
 * card that cannot show the reader's first approval itself.
 */
export const REMEDIATION_ALREADY_APPROVED_FIRST_REFUSED: string =
  translationKey(
    "You already approved this fix. It holds a riskier change, and this project asks two people to approve one, so it runs once someone else approves it too.",
  );

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
  // The same, to a reader who may not approve it (RemediationFixActGate).
  waitingForSomeonesApproval: string;
  cannotBeApproved: string;
  approved: string;
  approvedBy: string;
  // Approved from the fix's chat message, said beside who approved it.
  approvedInSlack: string;
  approvedByInSlack: string;
  approvedInTeams: string;
  approvedByInTeams: string;
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
  waitingForSomeonesApproval: translationKey("Needs approval"),
  cannotBeApproved: translationKey("Approval blocked"),
  approved: translationKey("Approved"),
  approvedBy: translationKey("Approved by {{name}}"),
  approvedInSlack: translationKey("Approved in Slack"),
  approvedByInSlack: translationKey("Approved by {{name}} in Slack"),
  approvedInTeams: translationKey("Approved in Microsoft Teams"),
  approvedByInTeams: translationKey("Approved by {{name}} in Microsoft Teams"),
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

/*
 * A ROUND OF AN AI FIX, EXPLAINED (issues #6436, #6487): "No safe fix
 * found, but it doesn't tell me anything about why ... What did you do ...
 * did you ask for an approval? What fix wasn't safe? What commands did you
 * run?" A fix OneUptime AI worked out says what its round did
 * (RemediationRoundDetails): that it stopped before it found a fix and
 * why - with Try again - or why it found none, each fix it ruled out with
 * why not, the commands it checked with, and that nothing ran and nobody
 * was asked to approve anything.
 */
export const REMEDIATION_ROUND_COPY: {
  // The plan step of a round that stopped without its answer.
  unfinishedFix: string;
  unfinishedRunbook: string;
  // The fact beside the fix's name, and the step's pill.
  didNotFinish: string;
  // The notice under the plan step: why it stopped, and what to do.
  whyItStopped: string;
  ruledOutHeading: string;
  checksHeading: string;
  otherChecks: PluralTemplate;
  // Each check's mark, as a screen reader says it.
  checkRan: string;
  checkFailed: string;
  checkUnknown: string;
  checkRunning: string;
  checkStopped: string;
  // Whether anything ran, and whether anyone was asked to approve it.
  nothingAskedNoFix: string;
  nothingAskedNoRunbook: string;
  nothingAskedUnfinished: string;
  nothingAskedUnfinishedRunbook: string;
  // Unfolds the AI's whole answer under the reason it gave, and folds it.
  showFullReasoning: string;
  showLessReasoning: string;
} = {
  unfinishedFix: translationKey("Stopped before it found a fix"),
  unfinishedRunbook: translationKey("Stopped before it picked a runbook"),
  didNotFinish: translationKey("Did not finish"),
  whyItStopped: translationKey("Why it stopped"),
  ruledOutHeading: translationKey("Fixes it ruled out"),
  checksHeading: translationKey("What it checked"),
  otherChecks: {
    one: "It also queried the project's telemetry {{count}} time.",
    other: "It also queried the project's telemetry {{count}} times.",
  },
  checkRan: translationKey("Ran"),
  checkFailed: translationKey("Failed"),
  checkUnknown: translationKey("Result unknown"),
  checkRunning: translationKey("Running"),
  checkStopped: translationKey("Stopped"),
  nothingAskedNoFix: translationKey(
    "No fix ran, and nobody was asked to approve one: OneUptime AI asks for approval only when it proposes a fix.",
  ),
  nothingAskedNoRunbook: translationKey(
    "No runbook ran, and nobody was asked to approve one.",
  ),
  /*
   * The step's title already says it stopped before it found one: the
   * line says only what did not happen.
   */
  nothingAskedUnfinished: translationKey(
    "No fix ran, and nobody was asked to approve one.",
  ),
  nothingAskedUnfinishedRunbook: translationKey(
    "No runbook ran, and nobody was asked to approve one.",
  ),
  showFullReasoning: translationKey("Show full reasoning"),
  showLessReasoning: translationKey("Show less"),
};

/*
 * The server's refusals of a round's Try again (RemediationRound), as
 * keys: the step shows the server's sentence, and these let each locale
 * word it. The same words as the server's (a test holds it).
 */
export const REMEDIATION_ROUND_TRY_AGAIN_REFUSAL_KEYS: Record<
  RemediationRoundTryAgainRefusal,
  string
> = {
  [RemediationRoundTryAgainRefusal.NoRound]: translationKey(
    "OneUptime AI did not work this fix out, so there is nothing to try again.",
  ),
  [RemediationRoundTryAgainRefusal.StillWorking]: translationKey(
    "OneUptime AI is still working on this fix.",
  ),
  [RemediationRoundTryAgainRefusal.Finished]: translationKey(
    "OneUptime AI finished working on this fix, so there is nothing to try again.",
  ),
  [RemediationRoundTryAgainRefusal.PartlyApplied]: translationKey(
    "OneUptime AI made a change for this fix before it stopped, so it does not start the fix again: that could make the same change twice. Check what it changed, then finish the fix yourself.",
  ),
  [RemediationRoundTryAgainRefusal.IncidentResolved]: translationKey(
    "This incident is resolved, so OneUptime AI does not try to fix it.",
  ),
  [RemediationRoundTryAgainRefusal.AlertResolved]: translationKey(
    "This alert is resolved, so OneUptime AI does not try to fix it.",
  ),
  [RemediationRoundTryAgainRefusal.AlreadyStarted]: translationKey(
    "Someone has just started this fix again.",
  ),
  [RemediationRoundTryAgainRefusal.AiOff]: translationKey(
    "OneUptime AI is switched off for this project. A project owner or someone with Manage Billing can turn it on in Project Settings > AI > AI Features.",
  ),
  [RemediationRoundTryAgainRefusal.NoProvider]: translationKey(
    "This project has no LLM provider to work out a fix with. Add one in Project Settings > AI > LLM Providers, then try again.",
  ),
  [RemediationRoundTryAgainRefusal.CreditsUsedUp]: translationKey(
    "This project's AI credits are used up. A project owner or someone with Manage Billing can add AI credits in Project Settings > AI > AI Credits.",
  ),
  [RemediationRoundTryAgainRefusal.LimitReached]: translationKey(
    "The project reached its daily AI limit. OneUptime AI starts again at midnight UTC.",
  ),
  /*
   * The incident's (alert's) own daily AI token limit (#7157): a limit of
   * 0 pauses the work until someone raises it, so only a used-up limit
   * says midnight. The words of Types/AI/RecordAiTokenLimit.
   */
  [RemediationRoundTryAgainRefusal.IncidentTokenLimitPaused]: translationKey(
    "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents. Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
  ),
  [RemediationRoundTryAgainRefusal.IncidentTokenLimitUsedUp]: translationKey(
    "Automatic AI work for incidents used up today's Daily Incident AI Token Limit. Raise or clear it under Incidents → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
  ),
  [RemediationRoundTryAgainRefusal.AlertTokenLimitPaused]: translationKey(
    "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts. Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
  ),
  [RemediationRoundTryAgainRefusal.AlertTokenLimitUsedUp]: translationKey(
    "Automatic AI work for alerts used up today's Daily Alert AI Token Limit. Raise or clear it under Alerts → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
  ),
  [RemediationRoundTryAgainRefusal.NotStarted]: translationKey(
    "The fix could not start again. Try again in a few minutes.",
  ),
};

// The server's sentences and these keys are the same words (a test holds it).
export const REMEDIATION_ROUND_TRY_AGAIN_SERVER_SENTENCES: typeof REMEDIATION_ROUND_TRY_AGAIN_REFUSALS =
  REMEDIATION_ROUND_TRY_AGAIN_REFUSALS;

/*
 * The refusal of a reader who may not change the incident or alert: Try
 * again is not offered to them, but their permission may change while the
 * page is open. The server's words (REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED).
 */
export const REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED_KEYS: Record<
  "incident" | "alert",
  string
> = {
  incident: translationKey(
    "You do not have permission to change this incident, so you cannot ask OneUptime AI to try this fix again.",
  ),
  alert: translationKey(
    "You do not have permission to change this alert, so you cannot ask OneUptime AI to try this fix again.",
  ),
};

export const REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED_SERVER_SENTENCES: typeof REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED =
  REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED;
