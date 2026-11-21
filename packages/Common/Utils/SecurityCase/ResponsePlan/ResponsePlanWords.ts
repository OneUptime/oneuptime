import { PluralTemplate, translationKey } from "../../../Types/Translator";
import { ResponsePhase } from "./ResponsePlanTypes";

/*
 * The words of a case's Response Plan: what to do about the case now -
 * confirm it, contain it, fix what let it happen, close it (#9557). Each is
 * an en.json key of the Dashboard's locales (its extractor reads this
 * folder), looked up where it is drawn; a step's values (an address, a
 * user, a playbook's name) go into it as written. Shared by every reader of
 * the plan (#10340): the server keeps a step's key, never its words.
 */

export const RESPONSE_TITLE: string = translationKey("Response Plan");

export const RESPONSE_DESCRIPTION: string = translationKey(
  "What to do about this case now, most urgent first. Tick a step off when it is done, and it is kept on the case's tasks.",
);

export const RESPONSE_PROGRESS: string = translationKey(
  "{{done}} of {{total}} done",
);

export const RESPONSE_PHASE_TITLES: Record<ResponsePhase, string> = {
  [ResponsePhase.Confirm]: translationKey("Confirm it is real"),
  [ResponsePhase.Contain]: translationKey("Contain it"),
  [ResponsePhase.Fix]: translationKey("Fix what let it happen"),
  [ResponsePhase.Close]: translationKey("Close the case"),
};

// Beside a step OneUptime cannot do for you.
export const RESPONSE_BY_HAND: string = translationKey("Outside OneUptime");
export const RESPONSE_BY_HAND_TOOLTIP: string = translationKey(
  "OneUptime cannot do this for you: do it where you run it, then tick it off here.",
);

export const RESPONSE_MARK_DONE: string = translationKey("Mark {{step}} done");
export const RESPONSE_MARK_NOT_DONE: string = translationKey(
  "Mark {{step}} not done",
);
export const RESPONSE_DONE_BY: string = translationKey(
  "Done by {{name}} {{time}}",
);
export const RESPONSE_DONE_AT: string = translationKey("Done {{time}}");
// A step the case itself says is done: nobody ticked it off.
export const RESPONSE_DONE_BY_CASE: string = translationKey(
  "The case says when this step is done, so it is not ticked by hand.",
);

// Under a playbook's step, while no run of it has succeeded on the case.
export const STEP_RUN_WAITING: string = translationKey(
  "Its run is waiting for approval on the case's Playbooks page.",
);
export const STEP_RUN_RUNNING: string = translationKey(
  "Its run has not finished yet.",
);
export const STEP_RUN_FAILED: string = translationKey(
  "Its last run failed. See why on the case's Playbooks page.",
);

export const RESPONSE_READY_TO_CONTAIN: string = translationKey(
  "Every containment step is done. Mark the case Contained, so its time to contain is recorded.",
);

export const RESPONSE_AI_VERDICT: string = translationKey(
  "OneUptime AI reads this case as {{verdict}}.",
);
export const RESPONSE_AI_HEADING: string = translationKey(
  "From OneUptime AI's triage",
);
export const RESPONSE_AI_SHOW: PluralTemplate = {
  one: "Show the step OneUptime AI suggests",
  other: "Show the {{count}} steps OneUptime AI suggests",
};
export const RESPONSE_AI_HIDE: string = translationKey(
  "Hide the steps OneUptime AI suggests",
);

export const RESPONSE_RULE_FALSE_POSITIVES: string = translationKey(
  "The rule says it can also fire on:",
);

// How far the requests a detection matched got (the Why Opened card says them too).
export const REQUESTS_ALL_TURNED_AWAY: PluralTemplate = {
  one: "The request was turned away.",
  other: "All {{count}} requests were turned away.",
};
export const REQUESTS_GOT_THROUGH: PluralTemplate = {
  one: "{{through}} of {{count}} request got past the app's checks.",
  other: "{{through}} of {{count}} requests got past the app's checks.",
};

// ---------- The steps ----------

export const STEP_TAKE: string = translationKey(
  "Take the case, so the team knows who is on it.",
);
export const STEP_REQUESTS_THROUGH: string = translationKey(
  "Find out what the requests that got through reached: open their traces.",
);
export const STEP_REQUESTS_TURNED_AWAY: string = translationKey(
  "Check that nothing else from {{value}} got through.",
);
export const STEP_REQUESTS_UNKNOWN: string = translationKey(
  "Check whether any of the requests got through: open their traces.",
);
export const STEP_FALSE_POSITIVE_VALUE: string = translationKey(
  "Rule out a false positive: is {{value}} a scanner, a test or a job your team runs?",
);
export const STEP_FALSE_POSITIVE: string = translationKey(
  "Rule out a false positive: is this something your team does on purpose?",
);
export const STEP_AI_PLAYBOOK: string = translationKey(
  "Run {{playbook}}, the playbook OneUptime AI suggests.",
);

export const STEP_BLOCK_PUBLIC_IP: string = translationKey(
  "Block {{value}} at your firewall, WAF or load balancer.",
);
/*
 * Where the project's blocklist is enforced (#10342): the step names where
 * the block would hold - "Block 35.205.11.131 at Cloudflare, AWS WAF." -
 * and blocks it in one click.
 */
export const STEP_BLOCK_AT_DESTINATIONS: string = translationKey(
  "Block {{value}} at {{destinations}}.",
);
// Under the block step, while a block of the address from the case has not been made.
export const STEP_BLOCK_WAITING: string = translationKey(
  "The block is waiting for someone else's approval on the case's Playbooks page.",
);
export const STEP_BLOCK_RUNNING: string = translationKey(
  "Blocking it now.",
);
export const STEP_BLOCK_FAILED: string = translationKey(
  "The last block did not finish. See why on the case's Playbooks page.",
);
export const STEP_ISOLATE_PRIVATE_IP: string = translationKey(
  "Find the machine at {{value}}, and take it off the network if it is compromised.",
);
export const STEP_CONTAIN_USER_PLAYBOOK: string = translationKey(
  "If {{value}}'s account is compromised, suspend it and end its sessions with {{playbook}}.",
);
export const STEP_CONTAIN_USER: string = translationKey(
  "If {{value}}'s account is compromised, suspend it and end its sessions in your identity provider.",
);
export const STEP_CONTAIN_HOST_PLAYBOOK: string = translationKey(
  "If {{value}} is compromised, cut it off the network with {{playbook}}.",
);
export const STEP_CONTAIN_HOST: string = translationKey(
  "If {{value}} is compromised, take it off the network until it has been checked.",
);
export const STEP_BLOCK_DOMAIN: string = translationKey(
  "Block {{value}} at your DNS filter or web proxy.",
);
export const STEP_QUARANTINE_FILE: string = translationKey(
  "Find the file {{value}} on your machines and quarantine it.",
);
/*
 * Where the plan would say to block the address, but a scrub rule hid it
 * from every event of the case (#10397): find it where the requests came
 * in, and the line under it says which rule hid it. The Dashboard's
 * HiddenClientAddressCopy re-exports these, with ACTION_OPEN_SCRUB_RULES,
 * for its other pages about a hidden address.
 */
export const STEP_FIND_HIDDEN_ADDRESS: string = translationKey(
  "Find the address these requests came from in your load balancer's or firewall's logs, and block it there.",
);
export const ADDRESS_HIDDEN_FROM_CASE: string = translationKey(
  "A scrub rule hid it from every event of this case.",
);
export const ADDRESS_HIDDEN_FROM_CASE_BY_RULE: string = translationKey(
  "The scrub rule {{rule}} hid it from every event of this case.",
);
/*
 * Under the same step when the case's requests only claimed an address
 * (#10416): the sender wrote it, so it is said as claimed, never blocked.
 * The Dashboard's ClaimedClientAddressCopy re-exports these for an event's
 * fields and What happened next.
 */
export const CLAIMED_NOT_VERIFIED: string = translationKey(
  "Claimed by the request, not verified",
);
export const CLAIMED_ADDRESS_NOT_VERIFIED: string = translationKey(
  "Claimed by the request, not verified: {{address}}",
);
export const STEP_DECLARE_INCIDENT: string = translationKey(
  "Declare an incident if customers or production are affected.",
);
export const STEP_MARK_CONTAINED: string = translationKey(
  "Mark the case Contained once the threat can no longer do harm.",
);

export const STEP_FIX_PUBLIC_APP_ROUTE: string = translationKey(
  "Fix how {{route}} handles what it is sent, and patch the software behind it.",
);
export const STEP_FIX_PUBLIC_APP: string = translationKey(
  "Patch the public-facing software the requests went to, and check how it handles what it is sent.",
);
export const STEP_FIX_BRUTE_FORCE: string = translationKey(
  "Make sure the accounts it went after use MFA, and lock out repeated failed sign-ins.",
);
export const STEP_FIX_CREDENTIALS_VALUE: string = translationKey(
  "Reset {{value}}'s password, and revoke their keys and tokens.",
);
export const STEP_FIX_CREDENTIALS: string = translationKey(
  "Rotate the passwords, keys and tokens that may have been exposed.",
);
export const STEP_FIX_ACCOUNT_CHANGES: string = translationKey(
  "Undo what changed on the account that you did not expect: roles, keys and MFA devices.",
);
export const STEP_FIX_EXECUTION: string = translationKey(
  "Find out what ran the command, remove it, and check it has not come back.",
);
export const STEP_FIX_PERSISTENCE: string = translationKey(
  "Remove anything set to run again: new accounts, keys, scheduled tasks or services.",
);
export const STEP_FIX_PRIVILEGE: string = translationKey(
  "Take back any access that was raised, and find out how it was raised.",
);
export const STEP_FIX_DEFENSES: string = translationKey(
  "Turn back on what was switched off: logging, an agent or a security setting.",
);
export const STEP_FIX_DISCOVERY: string = translationKey(
  "Find out what the scan could reach, and close what should not be reachable.",
);
export const STEP_FIX_LATERAL: string = translationKey(
  "Check the other machines the attacker could reach from here.",
);
export const STEP_FIX_DATA: string = translationKey(
  "Find out what data left and where it went, and rotate any secrets it held.",
);
export const STEP_FIX_C2: string = translationKey(
  "Find every machine that talked to the same address, and clean each one.",
);
export const STEP_FIX_IMPACT: string = translationKey(
  "Restore what was deleted or encrypted from backups you trust.",
);
export const STEP_FIX_GENERAL: string = translationKey(
  "Fix what let this happen, so the next attempt fails.",
);

export const STEP_CLOSE: string = translationKey(
  "Close the case with a verdict once it is fixed.",
);

// ---------- What a step's button says ----------

export const ACTION_ASSIGN_TO_ME: string = translationKey("Assign to Me");
export const ACTION_OPEN_TRACES: string = translationKey("Open Their Traces");
export const ACTION_OPEN_EVENTS: string = translationKey("Open Events");
export const ACTION_OPEN_SCRUB_RULES: string =
  translationKey("Open Scrub Rules");
export const ACTION_ADD_EXCEPTION: string = translationKey("Add Exception");
export const ACTION_RUN_PLAYBOOK: string = translationKey("Run Playbook");
export const ACTION_DECLARE_INCIDENT: string =
  translationKey("Declare Incident");
export const ACTION_MARK_CONTAINED: string =
  translationKey("Mark as Contained");
export const ACTION_CLOSE_CASE: string = translationKey("Close Case");
export const ACTION_COPY: string = translationKey("Copy");
// One click blocks the address for a day; the menu beside it holds the rest (#10342).
export const ACTION_BLOCK_FOR_A_DAY: string =
  translationKey("Block for 24 Hours");
