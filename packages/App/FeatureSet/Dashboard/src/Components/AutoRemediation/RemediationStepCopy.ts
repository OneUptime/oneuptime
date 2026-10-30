import {
  REMEDIATION_TRY_AGAIN_REFUSALS,
  RemediationTryAgainRefusal,
  RemediationTryAgainResult,
  RemediationTryAgainSignal,
} from "Common/Types/AutoRemediation/RemediationTryAgain";
import { AutomaticCodeFixBlocker } from "Common/Utils/Suggestions/InvestigationCodeFixSuggestion";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

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
