import SecurityCaseStepCheckState from "../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { PluralTemplate, translationKey } from "../../../Types/Translator";

/*
 * The words of OneUptime's own checks of a case's Response Plan steps
 * (#10340): what the card says beside a step OneUptime checked, and every
 * sentence a check's evidence is written in. The server keeps each as its
 * English key in the check's evidence (SecurityCaseStepCheck.evidence), with
 * its values as written - an address, a user, a product's name - and its
 * figures and times, worded where it is drawn, in the reader's language and
 * on their clock.
 */

// ---------- Beside a checked step ----------

// The chip that says what OneUptime found, distinct from a person's tick.
export const STEP_CHECK_STATE_LABELS: Record<
  SecurityCaseStepCheckState,
  string
> = {
  [SecurityCaseStepCheckState.Verified]: translationKey("Checked by OneUptime"),
  [SecurityCaseStepCheckState.LooksDone]: translationKey("Looks Done"),
  [SecurityCaseStepCheckState.NotDone]: translationKey("Not Done Yet"),
  [SecurityCaseStepCheckState.CannotTell]: translationKey(
    "OneUptime Cannot Tell",
  ),
  [SecurityCaseStepCheckState.Regressed]: translationKey("Stopped Holding"),
  [SecurityCaseStepCheckState.NotNeeded]: translationKey("Not Needed So Far"),
};

// The progress line, once OneUptime has checked any step itself.
export const RESPONSE_PROGRESS_CHECKED: PluralTemplate = {
  one: "{{done}} of {{total}} done, {{count}} checked by OneUptime",
  other: "{{done}} of {{total}} done, {{count}} checked by OneUptime",
};

// The fold that holds what else OneUptime saw, and where the evidence is.
export const STEP_CHECK_HOW_WE_KNOW: string = translationKey("How We Know");
export const STEP_CHECK_HIDE_HOW_WE_KNOW: string =
  translationKey("Hide How We Know");
export const STEP_CHECK_CHECKED_AT: string = translationKey(
  "OneUptime checked this {{time}}.",
);

// A step that looks done: a person confirms it, which ticks it off as theirs.
export const STEP_CHECK_CONFIRM: string = translationKey("Confirm");
export const STEP_CHECK_CONFIRM_TOOLTIP: string = translationKey(
  "Confirm {{step}} is done: it is kept on the case's tasks as yours.",
);

// Ticking a step OneUptime does not see done.
export const STEP_CHECK_DONE_ANYWAY: string = translationKey(
  "Mark {{step}} done anyway",
);

// A step OneUptime verified itself: nobody ticks it.
export const STEP_CHECK_DONE_BY_CHECK: string = translationKey(
  "OneUptime checked this step itself, so it is not ticked by hand.",
);

// Where a step OneUptime cannot tell about says how to let it.
export const STEP_CHECK_DOCS_LINK: string = translationKey(
  "How to let OneUptime check this",
);

// The links of a check's evidence.
export const STEP_CHECK_OPEN_TRACES: string = translationKey("Open Traces");
export const STEP_CHECK_OPEN_EVENTS: string = translationKey("Open Events");
export const STEP_CHECK_OPEN_PROVIDER: string = translationKey(
  "Open in {{provider}}",
);

// The checks could not be read: the plan still works, without them.
export const STEP_CHECKS_NOT_READ: string = translationKey(
  "OneUptime's checks of these steps could not be read. The plan is shown without them.",
);

// ---------- Block an address (contain:block-ip) ----------

export const CHECK_BLOCK_QUIET: PluralTemplate = {
  one: "No request from {{address}} has reached your app since {{since}}. It sent {{count}} in the hour before.",
  other:
    "No request from {{address}} has reached your app since {{since}}. It sent {{count}} in the hour before.",
};
export const CHECK_BLOCK_STILL_REACHING: PluralTemplate = {
  one: "{{address}} still reaches your app: {{count}} request in the last 30 minutes, the latest at {{latest}}.",
  other:
    "{{address}} still reaches your app: {{count}} requests in the last 30 minutes, the latest at {{latest}}.",
};
export const CHECK_BLOCK_REGRESSED: string = translationKey(
  "{{address}} got through again at {{time}}: the block is not holding.",
);
export const CHECK_BLOCK_SINCE_AGAIN: PluralTemplate = {
  one: "{{count}} request from {{address}} has reached your app since {{time}}.",
  other:
    "{{count}} requests from {{address}} have reached your app since {{time}}.",
};
export const CHECK_BLOCK_QUIET_SINCE: string = translationKey(
  "No request from {{address}} has reached your app since {{since}}.",
);
export const CHECK_BLOCK_NOT_PROOF: string = translationKey(
  "An address that goes quiet may have been blocked, or may simply have stopped: OneUptime cannot tell which.",
);
// AWS WAF's own word that a block holds: requests its rule turned away, from those it sampled (#10344).
export const CHECK_BLOCK_AWS_WAF_SAMPLED: string = translationKey(
  "AWS WAF blocked requests from {{address}} at {{webAcl}} (sampled).",
);
export const CHECK_CHALLENGE_AWS_WAF_SAMPLED: string = translationKey(
  "AWS WAF challenged requests from {{address}} at {{webAcl}} (sampled).",
);

// ---------- Check nothing else got through (confirm:requests) ----------

export const CHECK_REQUESTS_ALL_TURNED_AWAY: PluralTemplate = {
  one: "The request from {{address}} was turned away by your app.",
  other:
    "All {{count}} requests from {{address}} were turned away by your app.",
};
export const CHECK_REQUESTS_GOT_THROUGH: PluralTemplate = {
  one: "{{through}} of {{count}} request from {{address}} got past your app's checks.",
  other:
    "{{through}} of {{count}} requests from {{address}} got past your app's checks.",
};
export const CHECK_REQUESTS_SOME_UNREAD: PluralTemplate = {
  one: "{{rejected}} of the {{count}} request from {{address}} was turned away. OneUptime could not read your app's answer to the rest.",
  other:
    "{{rejected}} of the {{count}} requests from {{address}} were turned away. OneUptime could not read your app's answer to the rest.",
};
export const CHECK_REQUESTS_SINCE: string = translationKey(
  "Counted since {{time}}, when the case's first detection began.",
);

// ---------- Rule out a false positive (confirm:false-positive) ----------

export const CHECK_FALSE_POSITIVE_JUDGEMENT: string = translationKey(
  "Only you can rule this out.",
);
export const CHECK_FACT_OWN_ADDRESS: string = translationKey(
  "It is one of your addresses: {{name}} has it.",
);
export const CHECK_FACT_NOT_OWN_ADDRESS: string = translationKey(
  "None of your records in OneUptime has this address.",
);
export const CHECK_FACT_THREAT_INTEL: PluralTemplate = {
  one: "Listed by {{count}} threat intel feed.",
  other: "Listed by {{count}} threat intel feeds.",
};
export const CHECK_FACT_NO_THREAT_INTEL: string = translationKey(
  "No threat intel feed lists it.",
);
export const CHECK_FACT_SIGNED_IN_USERS: PluralTemplate = {
  one: "{{count}} signed-in user has used it: {{user}}.",
  other: "{{count}} signed-in users have used it, {{user}} among them.",
};
export const CHECK_FACT_NO_SIGNED_IN_USERS: string = translationKey(
  "No signed-in user has used it in the last 30 days.",
);

// ---------- Suspend a user, contain a host (contain:user, contain:host) ----------

export const CHECK_USER_SUSPENDED_SINCE: string = translationKey(
  "{{user}} is suspended in {{provider}} (since {{since}}).",
);
export const CHECK_USER_SUSPENDED: string = translationKey(
  "{{user}} is suspended in {{provider}}.",
);
export const CHECK_USER_DISABLED_SIGNED_OUT: string = translationKey(
  "{{user}} is disabled in {{provider}}, and their sessions were ended at {{since}}.",
);
export const CHECK_USER_DISABLED_NOT_SIGNED_OUT: string = translationKey(
  "{{user}} is disabled in {{provider}}, but their sessions were not ended after the case opened.",
);
export const CHECK_USER_ACTIVE: string = translationKey(
  "{{user}} is active in {{provider}}.",
);
export const CHECK_USER_ACTIVE_AGAIN: string = translationKey(
  "{{user}} is active again in {{provider}}: the suspension is not holding.",
);
export const CHECK_USER_NOT_FOUND: string = translationKey(
  "OneUptime found {{user}} in none of the products it is connected to.",
);
export const CHECK_FACT_NO_ACCOUNT: string = translationKey(
  "{{provider}} has no account {{value}}.",
);
export const CHECK_USER_NO_CONNECTION: string = translationKey(
  "OneUptime has no connection to Okta, Microsoft Entra ID or Google Workspace to read {{user}} in.",
);
export const CHECK_HOST_CONTAINED: string = translationKey(
  "{{host}} is network-contained in {{provider}}.",
);
export const CHECK_HOST_ISOLATED: string = translationKey(
  "{{host}} is isolated in {{provider}}.",
);
export const CHECK_HOST_PENDING: string = translationKey(
  "{{host}} is waiting to be contained in {{provider}}.",
);
export const CHECK_HOST_NOT_CONTAINED: string = translationKey(
  "{{host}} is not contained in {{provider}}.",
);
export const CHECK_HOST_RELEASED_AGAIN: string = translationKey(
  "{{host}} is no longer contained in {{provider}}: the containment is not holding.",
);
export const CHECK_HOST_NOT_FOUND: string = translationKey(
  "OneUptime found {{host}} in none of the products it is connected to.",
);
export const CHECK_FACT_NO_DEVICE: string = translationKey(
  "{{provider}} has no device {{value}}.",
);
export const CHECK_HOST_NO_CONNECTION: string = translationKey(
  "OneUptime has no connection to CrowdStrike Falcon or Microsoft Defender to read {{host}} in.",
);
export const CHECK_PRODUCT_READ_FAILED: string = translationKey(
  "OneUptime could not read {{value}} in {{provider}} just now. It tries again in a few minutes.",
);
export const CHECK_PRODUCT_SAID: string = translationKey(
  "{{provider}} said: {{error}}",
);
export const CHECK_COULD_NOT_CHECK: string = translationKey(
  "OneUptime could not check this step just now. It tries again in a few minutes.",
);

// ---------- Declare an incident (contain:incident) ----------

export const CHECK_INCIDENT_NOT_NEEDED: string = translationKey(
  "Not needed so far: no request got past your app's checks, and its monitors stayed up.",
);
export const CHECK_INCIDENT_NOT_NEEDED_NO_MONITORS: string = translationKey(
  "Not needed so far: no request got past your app's checks.",
);
export const CHECK_INCIDENT_REQUESTS_THROUGH: PluralTemplate = {
  one: "{{count}} request got past your app's checks while the case was open.",
  other:
    "{{count}} requests got past your app's checks while the case was open.",
};
export const CHECK_INCIDENT_MONITOR_DOWN: string = translationKey(
  "{{monitor}} went down while the case was open.",
);
export const CHECK_INCIDENT_NOT_FOLLOWED: string = translationKey(
  "None of this case's requests could be followed into a trace, so OneUptime cannot tell whether any got past your app's checks.",
);

// ---------- Why OneUptime cannot see an address's requests ----------

export const CHECK_CANNOT_NO_TELEMETRY: string = translationKey(
  "OneUptime receives no traces or logs from your app, so it cannot see the requests from {{address}}.",
);
export const CHECK_CANNOT_NO_CLIENT_ADDRESS: string = translationKey(
  "Your app's traces do not say which address each request came from: set the client address on its server spans.",
);
export const CHECK_CANNOT_PROXY_ADDRESSES: string = translationKey(
  "Your app's traces carry Cloudflare's addresses, not your visitors': set the client address from CF-Connecting-IP.",
);
export const CHECK_CANNOT_LOAD_BALANCER_ADDRESSES: string = translationKey(
  "Your app's traces carry your load balancer's addresses, not your visitors': set the client address from X-Forwarded-For.",
);
export const CHECK_CANNOT_ADDRESS_IS_PROXY: string = translationKey(
  "{{address}} is one of Cloudflare's addresses: it is how your visitors reach your app, not who sent the requests.",
);
export const CHECK_CANNOT_NO_TRAFFIC: string = translationKey(
  "OneUptime has seen no request from {{address}} reach your app, so it cannot tell whether a block holds.",
);
export const CHECK_CANNOT_NO_TRAFFIC_REQUESTS: string = translationKey(
  "OneUptime has seen no request from {{address}} reach your app, so it cannot tell how far its requests got.",
);
export const CHECK_CANNOT_READ_FAILED: string = translationKey(
  "OneUptime could not read your app's requests just now. It tries again in a few minutes.",
);
export const CHECK_FACT_SEEN_ADDRESSES: PluralTemplate = {
  one: "In the last hour your app's traces carried {{count}} address as the client's, {{address}}.",
  other:
    "In the last hour your app's traces carried {{count}} addresses as the client's, {{address}} the most.",
};
