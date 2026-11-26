import {
  SecurityCaseAiArea,
  SecurityCaseAiMode,
} from "Common/Types/SecurityCase/SecurityCaseAi";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * SECURITY EVENTS -> AI -> SETTINGS: WHAT ONEUPTIME AI MAY DO ON A CASE
 * (#10352). One row per kind of action, each Off, Ask first or On its own,
 * in plain words: what the kind covers, and what each choice means for it -
 * so nobody has to guess what On its own lets OneUptime AI do.
 *
 * The modes are stored as Types/SecurityCase/SecurityCaseAi says
 * (Off / Ask / OnItsOwn); "Ask first" is how the page words Ask, so it never
 * reads as a question.
 *
 * React-free, so the card and its tests read these exact strings; every
 * sentence goes through translationKey() so npm run i18n:extract finds it.
 */

export interface SecurityCaseAiAreaCopy {
  title: string;
  // What the kind of action covers.
  description: string;
  // What Ask first and On its own mean for it (Off means the same for every kind).
  ask: string;
  onItsOwn: string;
}

export const SECURITY_CASE_AI_AREA_COPY: Readonly<
  Record<SecurityCaseAiArea, SecurityCaseAiAreaCopy>
> = {
  [SecurityCaseAiArea.Case]: {
    title: translationKey("Work the case"),
    description: translationKey(
      "Take the case, raise its priority, mark steps done with their evidence, and move it to Contained.",
    ),
    ask: translationKey(
      "OneUptime AI asks on the case before it takes it, raises its priority or marks a step done.",
    ),
    onItsOwn: translationKey(
      "OneUptime AI takes the case and works it, and says so on the case's timeline.",
    ),
  },
  [SecurityCaseAiArea.Edge]: {
    title: translationKey("Block addresses"),
    description: translationKey(
      "Block the address a case's requests came from at your edge, for 24 hours.",
    ),
    ask: translationKey(
      "OneUptime AI asks before it blocks an address. Approve it in one tap, on the case or in Slack or Microsoft Teams.",
    ),
    onItsOwn: translationKey(
      "OneUptime AI blocks the address for 24 hours without asking. Lift the block in one click on the case.",
    ),
  },
  [SecurityCaseAiArea.Accounts]: {
    title: translationKey("Contain accounts"),
    description: translationKey(
      "Suspend a case's user or end their sessions, through your identity provider.",
    ),
    ask: translationKey(
      "OneUptime AI asks before it suspends a user or ends their sessions.",
    ),
    onItsOwn: translationKey(
      "OneUptime AI suspends the user or ends their sessions without asking. Undo it on the case.",
    ),
  },
  [SecurityCaseAiArea.Hosts]: {
    title: translationKey("Contain hosts"),
    description: translationKey(
      "Contain or isolate a case's host, through your EDR.",
    ),
    ask: translationKey(
      "OneUptime AI asks before it contains or isolates a host.",
    ),
    onItsOwn: translationKey(
      "OneUptime AI contains or isolates the host without asking. Release it on the case.",
    ),
  },
  [SecurityCaseAiArea.Code]: {
    title: translationKey("Fix the code"),
    description: translationKey(
      "Have Fix With AI open a pull request that fixes the route an attack reached.",
    ),
    ask: translationKey(
      "OneUptime AI asks before it has Fix With AI open a pull request.",
    ),
    onItsOwn: translationKey(
      "OneUptime AI has Fix With AI open the pull request. Only a person merges it.",
    ),
  },
  [SecurityCaseAiArea.Close]: {
    title: translationKey("Close the case"),
    description: translationKey(
      "Close the case with a verdict and a closing report, once every step is done and it has been quiet for 24 hours.",
    ),
    ask: translationKey(
      "OneUptime AI writes the closing report and asks a person to close the case.",
    ),
    onItsOwn: translationKey(
      "OneUptime AI closes the case with its closing report. Reopen the case to take it back.",
    ),
  },
};

// The three choices, as the picker names them.
export const SECURITY_CASE_AI_MODE_LABELS: Readonly<
  Record<SecurityCaseAiMode, string>
> = {
  [SecurityCaseAiMode.Off]: translationKey("Off"),
  [SecurityCaseAiMode.Ask]: translationKey("Ask first"),
  [SecurityCaseAiMode.OnItsOwn]: translationKey("On its own"),
};

// Off means the same for every kind.
export const SECURITY_CASE_AI_OFF_MEANING: string = translationKey(
  "OneUptime AI leaves this to a person, and says so on the case.",
);

// What a choice means for a kind, in a sentence.
export function getSecurityCaseAiModeMeaning(
  area: SecurityCaseAiArea,
  mode: SecurityCaseAiMode,
): string {
  if (mode === SecurityCaseAiMode.Ask) {
    return SECURITY_CASE_AI_AREA_COPY[area].ask;
  }

  if (mode === SecurityCaseAiMode.OnItsOwn) {
    return SECURITY_CASE_AI_AREA_COPY[area].onItsOwn;
  }

  return SECURITY_CASE_AI_OFF_MEANING;
}

export const SecurityCaseAiLimitsCopy: {
  cardTitle: string;
  cardDescription: string;
  // While Work cases end to end is off: the rows do nothing yet.
  offLine: string;
  limitsLine: string;
  // Block addresses' On its own: a Security Admin confirms it.
  edgeConfirmTitle: string;
  edgeConfirmDescription: string;
  edgeConfirmButton: string;
  edgeConfirmedOn: string;
  edgeNotConfirmed: string;
  edgeConfirmNowButton: string;
} = {
  cardTitle: translationKey("What OneUptime AI may do on a case"),
  cardDescription: translationKey(
    "For each kind of step: leave it to a person, ask first, or let OneUptime AI do it on its own. Everything it does shows on the case and can be undone.",
  ),
  offLine: translationKey(
    "Work cases end to end is off, so these take effect once it is turned on.",
  ),
  limitsLine: translationKey(
    "It never acts on protected entities, takes at most 10 actions an hour on its own, and hands a case to people when unsure.",
  ),
  edgeConfirmTitle: translationKey("Block addresses without asking?"),
  edgeConfirmDescription: translationKey(
    "OneUptime AI will block a case's address for 24 hours with nobody asked first, never a protected one. You confirm this as a Security Admin.",
  ),
  edgeConfirmButton: translationKey("Confirm and Turn On"),
  edgeConfirmedOn: translationKey(
    "A Security Admin confirmed this on {{date}}.",
  ),
  edgeNotConfirmed: translationKey(
    "No Security Admin has confirmed this yet, so OneUptime AI asks until one does.",
  ),
  edgeConfirmNowButton: translationKey("Confirm"),
};

export const SECURITY_CASE_AI_LIMITS_TEST_ID: string =
  "security-case-ai-limits";

// The data-testid of a kind's row; its picker is `${id}-picker`.
export function getSecurityCaseAiLimitRowTestId(
  area: SecurityCaseAiArea,
): string {
  return `security-case-ai-limit-${area}`;
}
