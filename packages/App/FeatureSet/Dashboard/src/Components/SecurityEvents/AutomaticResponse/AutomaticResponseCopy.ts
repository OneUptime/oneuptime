import { SecurityBlockDuration } from "Common/Types/SecurityBlocklist/SecurityBlock";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of Security Events > Playbooks > Automatic Response (#10350):
 * each policy's card - whether it is on, where its trial run stands and
 * what it would have done, what it acts on, its guardrails and its time to
 * block - the dialog that makes or changes a project's own policy, and
 * what the page says when the hour's automatic blocks are used up. Each is
 * an en.json key, looked up where it is drawn. The ready policies' names
 * and descriptions, and what is wrong with a project's own, are the shared
 * rules' sentences (Types/SecurityAutomaticResponse), keys too.
 *
 * React-free, so the words are pinned in a plain test.
 */

export const AUTOMATIC_RESPONSE_TITLE: string =
  translationKey("Automatic Response");

// ---------- Where a policy stands ----------

// The chip beside each policy's switch.
export const MODE_OFF: string = translationKey("Off");
export const MODE_TRIAL_RUN: string = translationKey("Trial Run");
export const MODE_TRIAL_FINISHED: string = translationKey("Trial Finished");
export const MODE_ON: string = translationKey("On");

// The switch, for a screen reader: the card's title says which policy.
export const SWITCH_LABEL: string = translationKey(
  "Turn on the {{name}} policy",
);

// Off, with no week of trial run behind it: turning it on starts one.
export const STATE_OFF: string = translationKey(
  "Turn it on to start a 7-day trial run. It records what it would have done, and touches no traffic.",
);

// Off, after a whole week of trial run: turning it on puts it to work.
export const STATE_OFF_TRIAL_FINISHED: string = translationKey(
  "Its trial run finished {{date}}, so turning it on puts it to work straight away.",
);

// In its trial run.
export const STATE_TRIAL_RUNNING: PluralTemplate = {
  one: "Trial run: {{count}} day left. It records what it would have done, and touches no traffic.",
  other:
    "Trial run: {{count}} days left. It records what it would have done, and touches no traffic.",
};

// On.
export const STATE_ON: string = translationKey("On since {{date}}.");
export const STATE_ON_BY: string = translationKey(
  "On since {{date}}, turned on by {{name}}.",
);

// ---------- What it would have done, and did ----------

/*
 * A finished trial run: "In 7 days this would have challenged 1,283
 * addresses. None had signed-in users, and none were yours. Turn it on?"
 */
export const TRIAL_WOULD_HAVE_CHALLENGED: PluralTemplate = {
  one: "In 7 days this would have challenged {{count}} address.",
  other: "In 7 days this would have challenged {{count}} addresses.",
};
export const TRIAL_WOULD_HAVE_BLOCKED: PluralTemplate = {
  one: "In 7 days this would have blocked {{count}} address.",
  other: "In 7 days this would have blocked {{count}} addresses.",
};

// A trial run still going: what it would have done so far.
export const SO_FAR_WOULD_HAVE_CHALLENGED: PluralTemplate = {
  one: "So far it would have challenged {{count}} address.",
  other: "So far it would have challenged {{count}} addresses.",
};
export const SO_FAR_WOULD_HAVE_BLOCKED: PluralTemplate = {
  one: "So far it would have blocked {{count}} address.",
  other: "So far it would have blocked {{count}} addresses.",
};

// What its guardrails left alone.
export const SPARED_NONE: string = translationKey(
  "None had signed-in users, and none were yours.",
);
export const SPARED_NO_SIGNED_IN: string = translationKey(
  "None had signed-in users.",
);
export const SPARED_NONE_YOURS: string = translationKey("None were yours.");
export const SPARED_SIGNED_IN: PluralTemplate = {
  one: "It left {{count}} address alone because signed-in users had used it.",
  other:
    "It left {{count}} addresses alone because signed-in users had used them.",
};
export const SPARED_PROTECTED: PluralTemplate = {
  one: "It left {{count}} of your own addresses alone.",
  other: "It left {{count}} of your own addresses alone.",
};
export const SPARED_CANNOT_TELL: PluralTemplate = {
  one: "It could not tell whether signed-in users had used {{count}} address, so it left it for a person.",
  other:
    "It could not tell whether signed-in users had used {{count}} addresses, so it left them for a person.",
};
export const WOULD_HAVE_LIFTED: PluralTemplate = {
  one: "A signed-in user was seen later from {{count}} of them, so it would have lifted that block.",
  other:
    "A signed-in user was seen later from {{count}} of them, so it would have lifted those blocks.",
};
export const WOULD_HAVE_STOPPED: PluralTemplate = {
  one: "It would have reached the hourly limit of automatic blocks once, and paged your security owners.",
  other:
    "It would have reached the hourly limit of automatic blocks {{count}} times, and paged your security owners.",
};
export const TURN_IT_ON_QUESTION: string = translationKey("Turn it on?");

// On: what it did in the last week.
export const LAST_WEEK_CHALLENGED: PluralTemplate = {
  one: "In the last 7 days it challenged {{count}} address.",
  other: "In the last 7 days it challenged {{count}} addresses.",
};
export const LAST_WEEK_BLOCKED: PluralTemplate = {
  one: "In the last 7 days it blocked {{count}} address.",
  other: "In the last 7 days it blocked {{count}} addresses.",
};
export const LAST_WEEK_SPARED: PluralTemplate = {
  one: "Its guardrails left {{count}} address alone.",
  other: "Its guardrails left {{count}} addresses alone.",
};

// ---------- Turning it on ----------

export const TURN_ON: string = translationKey("Turn On");
export const TURN_ON_WITHOUT_TRIAL: string = translationKey(
  "Turn On Without a Trial Run",
);
export const TURN_ON_WITHOUT_TRIAL_DESCRIPTION: string = translationKey(
  "Skips the 7-day trial run: the policy acts from now on, without the week that shows what it would do to your traffic.",
);
export const TURN_ON_WITHOUT_TRIAL_QUESTION: string = translationKey(
  "{{name}} starts acting now, without the week that shows what it would have done. Its guardrails still apply.",
);

export const TRIAL_STARTED_TOAST: string = translationKey(
  "{{name}} started its 7-day trial run.",
);
export const TURNED_ON_TOAST: string = translationKey("{{name}} is on.");
export const TURNED_OFF_TOAST: string = translationKey("{{name}} is off.");

// Only a Security Admin, a Project Admin or a Project Owner turns a policy on.
export const NEEDS_ADMIN_TOOLTIP: string = translationKey(
  "Only a Security Admin, a Project Admin or a Project Owner can change a policy: its blocks need nobody's approval.",
);

// ---------- What it acts on ----------

export const ACTS_ON_TITLE: string = translationKey("Acts On");

// The rules a ready policy acts on, and where each stands.
export const RULE_REAL_TIME: string = translationKey("Real time");
export const RULE_SCHEDULED: string = translationKey("On a schedule");
export const RULE_OFF: string = translationKey("Turned off");
export const RULE_MISSING: string = translationKey("Not added yet");
export const RULE_SCHEDULED_TOOLTIP: string = translationKey(
  "Your project already runs 50 rules in real time, so this one runs on its schedule, and the policy acts minutes later.",
);
export const RULE_OFF_TOOLTIP: string = translationKey(
  "Someone turned this rule off, so the policy never acts on it. Turn it on under Detection Rules.",
);
export const RULE_MISSING_TOOLTIP: string = translationKey(
  "Added from the Rule Library, to run in real time, when you turn the policy on.",
);

// The conditions besides techniques and rules.
export const ACTS_ON_TECHNIQUES: string = translationKey(
  "Detections with these ATT&CK techniques:",
);
export const ACTS_ON_RULES: PluralTemplate = {
  one: "Detections made by {{count}} detection rule.",
  other: "Detections made by one of {{count}} detection rules.",
};
export const ACTS_ON_THREAT_INTEL: string = translationKey(
  "Only addresses your threat intel lists.",
);
export const ACTS_ON_THREAT_INTEL_ANY: string = translationKey(
  "Any detection about an address your threat intel lists.",
);
export const ACTS_ON_TURNED_AWAY: string = translationKey(
  "Only while every request from the address was turned away.",
);

/*
 * A challenge where a destination cannot challenge: held as a block there,
 * for the same time.
 */
export const CHALLENGE_HELD_AS_BLOCK: string = translationKey(
  "{{destinations}} cannot challenge, so this policy blocks the address there for the same time.",
);

// ---------- Its guardrails ----------

export const GUARDRAILS_TITLE: string = translationKey("Guardrails");
export const GUARDRAIL_PROTECTED: string = translationKey(
  "Never touches your own or protected addresses.",
);
export const GUARDRAIL_SIGNED_IN: string = translationKey(
  "Never touches an address a signed-in user used in the last 30 days.",
);
// How long its blocks last, by its first length.
export const GUARDRAIL_LADDER: Record<
  | SecurityBlockDuration.OneHour
  | SecurityBlockDuration.OneDay
  | SecurityBlockDuration.SevenDays,
  string
> = {
  [SecurityBlockDuration.OneHour]: translationKey(
    "Lasts 1 hour, then 24 hours and 7 days for an address that comes back within 30 days.",
  ),
  [SecurityBlockDuration.OneDay]: translationKey(
    "Lasts 24 hours, then 7 days for an address that comes back within 30 days.",
  ),
  [SecurityBlockDuration.SevenDays]: translationKey("Lasts 7 days each time."),
};
export const GUARDRAIL_LIMIT: PluralTemplate = {
  one: "Stops after {{count}} automatic block an hour across your policies, and pages your security owners.",
  other:
    "Stops after {{count}} automatic blocks an hour across your policies, and pages your security owners.",
};
export const GUARDRAIL_UNDO: string = translationKey(
  "Lifts its block, and tells your security owners, if a signed-in user is seen from the address.",
);

// ---------- Time to block ----------

export const TIME_TO_BLOCK_TITLE: string = translationKey("Time to Block");
export const TIME_TO_BLOCK_DESCRIPTION: string = translationKey(
  "From an address's first request to the block holding at your edge, over the last 30 days.",
);
export const TIME_TO_BLOCK_EMPTY: string = translationKey(
  "Shows here once the policy has blocked an address.",
);
// The two percentiles, as the chart's legend and its figures name them.
export const P50_LABEL: string = translationKey("P50");
export const P95_LABEL: string = translationKey("P95");
export const TIME_TO_BLOCK_FIGURES: PluralTemplate = {
  one: "P50 {{p50}}, P95 {{p95}}, over {{count}} block.",
  other: "P50 {{p50}}, P95 {{p95}}, over {{count}} blocks.",
};
export const SECONDS_AXIS: string = translationKey("Seconds");

// ---------- The page ----------

// The hour's automatic blocks are used up: the policies stopped.
export const LIMIT_REACHED: PluralTemplate = {
  one: "Your policies made {{count}} automatic block in the last hour, so they stopped and paged your security owners. They start again as the hour's blocks age out.",
  other:
    "Your policies made {{count}} automatic blocks in the last hour, so they stopped and paged your security owners. They start again as the hour's blocks age out.",
};

export const OWN_POLICIES_TITLE: string = translationKey("Your Own Policy");
export const OWN_POLICIES_DESCRIPTION: string = translationKey(
  "Challenge or block on the ATT&CK techniques, detection rules or threat intel you choose, under the same guardrails and trial run.",
);

export const READ_FAILED: string = translationKey(
  "OneUptime could not read your automatic response policies. Try again in a minute.",
);

// ---------- A project's own policy ----------

export const CREATE_POLICY: string = translationKey("Create Policy");
export const EDIT_POLICY: string = translationKey("Edit Policy");
export const DELETE_POLICY: string = translationKey("Delete Policy");
export const POLICY_FORM_DESCRIPTION: string = translationKey(
  "Challenges or blocks the address a detection is about, under the ready policies' guardrails. It starts off: turning it on starts its trial run.",
);
export const NAME_FIELD_PLACEHOLDER: string = translationKey(
  "Bots on the sign-in API",
);
export const TECHNIQUES_FIELD_TITLE: string =
  translationKey("ATT&CK Techniques");
export const TECHNIQUES_FIELD_DESCRIPTION: string = translationKey(
  "Separated by commas. A technique covers its sub-techniques: T1110 covers T1110.003.",
);
export const TECHNIQUES_FIELD_PLACEHOLDER: string =
  translationKey("T1110, T1190");
export const NOT_A_TECHNIQUE: string = translationKey(
  "{{value}} is not an ATT&CK technique. Write it as T1110 or T1110.003.",
);
export const ACTION_FIELD_DESCRIPTION: string = translationKey(
  "A challenge lets people through a check, and turns scripts and bots away.",
);
export const FIRST_BLOCK_FIELD_TITLE: string =
  translationKey("First Block Lasts");
export const FIRST_BLOCK_FIELD_DESCRIPTION: string = translationKey(
  "An address that comes back within 30 days is blocked for longer.",
);
export const RULES_FIELD_DESCRIPTION: string = translationKey(
  "Or acts on a detection made by one of these rules.",
);
export const THREAT_INTEL_FIELD_TITLE: string = translationKey(
  "Only Addresses Your Threat Intel Lists",
);
export const TURNED_AWAY_FIELD_TITLE: string = translationKey(
  "Only While Every Request Was Turned Away",
);
export const TURNED_AWAY_FIELD_DESCRIPTION: string = translationKey(
  "Acts only while none of the address's requests reached your app.",
);

export const POLICY_SAVED_TOAST: string = translationKey("{{name}} saved.");
export const POLICY_DELETE_DESCRIPTION: string = translationKey(
  "Its blocks stay on your Blocklist until they expire.",
);

// ---------- Elsewhere: the Blocklist, a case ----------

// Who made a block, on the Blocklist: "Scanners policy".
export const BLOCKED_BY_POLICY: string = translationKey("{{name}} policy");

// Under a case's Time to Contain.
export const CASE_TIME_TO_BLOCK: string = translationKey(
  "Blocked automatically {{time}} after its first request",
);

export const AUTOMATIC_RESPONSE_TEST_IDS: {
  page: string;
  card: string;
  modeChip: string;
  toggle: string;
  stateLine: string;
  summary: string;
  turnOn: string;
  turnOnWithoutTrial: string;
  rule: string;
  heldAsBlock: string;
  guardrails: string;
  timeToBlock: string;
  limitNotice: string;
  readFailed: string;
  createPolicy: string;
} = {
  page: "automatic-response-page",
  card: "automatic-response-policy",
  modeChip: "automatic-response-mode",
  toggle: "automatic-response-toggle",
  stateLine: "automatic-response-state",
  summary: "automatic-response-summary",
  turnOn: "automatic-response-turn-on",
  turnOnWithoutTrial: "automatic-response-turn-on-without-trial",
  rule: "automatic-response-rule",
  heldAsBlock: "automatic-response-held-as-block",
  guardrails: "automatic-response-guardrails",
  timeToBlock: "automatic-response-time-to-block",
  limitNotice: "automatic-response-limit",
  readFailed: "automatic-response-read-failed",
  createPolicy: "automatic-response-create-policy",
};
