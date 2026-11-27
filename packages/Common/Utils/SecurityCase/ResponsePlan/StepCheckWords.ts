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
 *
 * A moment - {{time}}, {{since}}, {{until}}, {{ended}}, {{latest}},
 * {{confirmed}} - comes with its own words (#10622, Utils/MomentPhrases):
 * "at 14:25" today and "on 27 Nov at 14:25" on another day, "since ...",
 * "until ...". So a sentence writes no preposition before one, and in a
 * language whose letters have a case it never starts with one.
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
  one: "No request from {{address}} has reached your app {{since}}. It sent {{count}} in the hour before.",
  other:
    "No request from {{address}} has reached your app {{since}}. It sent {{count}} in the hour before.",
};
export const CHECK_BLOCK_STILL_REACHING: PluralTemplate = {
  one: "{{address}} still reaches your app: {{count}} request in the last 30 minutes, the latest {{latest}}.",
  other:
    "{{address}} still reaches your app: {{count}} requests in the last 30 minutes, the latest {{latest}}.",
};
export const CHECK_BLOCK_REGRESSED: string = translationKey(
  "{{address}} got through again {{time}}: the block is not holding.",
);
export const CHECK_BLOCK_SINCE_AGAIN: PluralTemplate = {
  one: "{{count}} request from {{address}} has reached your app {{since}}.",
  other: "{{count}} requests from {{address}} have reached your app {{since}}.",
};
export const CHECK_BLOCK_QUIET_SINCE: string = translationKey(
  "No request from {{address}} has reached your app {{since}}.",
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

/*
 * The project's Blocklist holds the address (#10562): where a destination
 * applied the block and read it back, and since when. A range that holds
 * it names the range.
 */
export const CHECK_BLOCK_ENFORCED_AT: string = translationKey(
  "{{address}} is blocked at {{destination}} {{since}}, last confirmed {{confirmed}}.",
);
export const CHECK_BLOCK_CHALLENGED_AT: string = translationKey(
  "{{address}} is challenged at {{destination}} {{since}}, last confirmed {{confirmed}}.",
);
export const CHECK_BLOCK_RANGE_ENFORCED_AT: string = translationKey(
  "{{range}}, which holds {{address}}, is blocked at {{destination}} {{since}}, last confirmed {{confirmed}}.",
);
export const CHECK_BLOCK_RANGE_CHALLENGED_AT: string = translationKey(
  "{{range}}, which holds {{address}}, is challenged at {{destination}} {{since}}, last confirmed {{confirmed}}.",
);

/*
 * What Cloudflare's rule for the block did with the address since it was
 * applied there (#10343): the requests from it OneUptime's rule blocked or
 * challenged, counted from the firewall events the connection imports.
 * Cloudflare samples a busy zone's events, so a count read from sampled
 * ones says about.
 */
export const CHECK_BLOCK_CLOUDFLARE_STOPPED: PluralTemplate = {
  one: "Cloudflare has stopped {{count}} request from {{address}} since the block {{time}}.",
  other:
    "Cloudflare has stopped {{count}} requests from {{address}} since the block {{time}}.",
};
export const CHECK_BLOCK_CLOUDFLARE_STOPPED_ABOUT: PluralTemplate = {
  one: "Cloudflare has stopped about {{count}} request from {{address}} since the block {{time}}.",
  other:
    "Cloudflare has stopped about {{count}} requests from {{address}} since the block {{time}}.",
};
export const CHECK_BLOCK_CLOUDFLARE_CHALLENGED: PluralTemplate = {
  one: "Cloudflare has challenged {{count}} request from {{address}} since the challenge {{time}}.",
  other:
    "Cloudflare has challenged {{count}} requests from {{address}} since the challenge {{time}}.",
};
export const CHECK_BLOCK_CLOUDFLARE_CHALLENGED_ABOUT: PluralTemplate = {
  one: "Cloudflare has challenged about {{count}} request from {{address}} since the challenge {{time}}.",
  other:
    "Cloudflare has challenged about {{count}} requests from {{address}} since the challenge {{time}}.",
};

// A block on the Blocklist that no destination holds: never read as blocked.
export const CHECK_BLOCK_NOT_ENFORCED: string = translationKey(
  "{{value}} is on your Blocklist, but no destination enforces it yet, so it is not blocked anywhere.",
);

// The link of the evidence to the block on the Blocklist.
export const STEP_CHECK_OPEN_BLOCKLIST: string =
  translationKey("Open Blocklist");

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
  "Counted {{since}}, when the case's first detection began.",
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
  "{{user}} is suspended in {{provider}} ({{since}}).",
);
export const CHECK_USER_SUSPENDED: string = translationKey(
  "{{user}} is suspended in {{provider}}.",
);
export const CHECK_USER_DISABLED_SIGNED_OUT: string = translationKey(
  "{{user}} is disabled in {{provider}}, and their sessions were ended {{time}}.",
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

/*
 * ---------- Block on every machine (contain:block-domain,
 * contain:quarantine-file, contain:block-ip-everywhere, #10346) ----------
 *
 * Read from the blocklist: an active block of the value, held - applied
 * and read back - by Microsoft Defender or CrowdStrike Falcon.
 */
export const CHECK_BLOCKED_EVERYWHERE: string = translationKey(
  "{{value}} is blocked on every machine with {{destination}} {{since}}, {{until}}.",
);
export const CHECK_BLOCKED_EVERYWHERE_UNTIL_LIFTED: string = translationKey(
  "{{value}} is blocked on every machine with {{destination}} {{since}}, until someone lifts it.",
);
export const CHECK_BLOCK_NOT_HELD: string = translationKey(
  "{{value}} is on the blocklist, but nothing blocks it on your machines yet.",
);
export const CHECK_BLOCK_NOT_HELD_AT: string = translationKey(
  "Not blocked by {{destination}}: {{reason}}",
);
export const CHECK_BLOCK_NONE: string = translationKey(
  "{{value}} is not blocked on your machines.",
);
export const CHECK_BLOCK_ENDED: string = translationKey(
  "The block on {{value}} ended {{time}}, so your machines no longer block it.",
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

// ---------- Fix the route (fix:public-app, #10347) ----------

/*
 * {{change}} names what shipped as written: its version ("2.4.1"), else the
 * fix's pull request ("#123"), revision or commit. {{time}} is when it
 * shipped and {{until}} until when OneUptime watches: each brings its words.
 */
export const CHECK_FIX_ROUTE_TURNED_AWAY: PluralTemplate = {
  one: "Since {{change}} shipped {{time}}, the {{count}} attack request to {{route}} was turned away.",
  other:
    "Since {{change}} shipped {{time}}, all {{count}} attack requests to {{route}} were turned away.",
};
export const CHECK_FIX_ROUTE_KEPT_OUT: PluralTemplate = {
  one: "Since {{change}} shipped {{time}}, the {{count}} attack request to {{route}} did not reach the database.",
  other:
    "Since {{change}} shipped {{time}}, none of the {{count}} attack requests to {{route}} reached the database.",
};
export const CHECK_FIX_ROUTE_NO_ATTEMPTS: string = translationKey(
  "No attempts on {{route}} since {{change}} shipped {{time}}.",
);
export const CHECK_FIX_ROUTE_STILL_THROUGH: PluralTemplate = {
  one: "{{through}} of the {{count}} attack request to {{route}} since {{change}} shipped {{time}} got past your app's checks.",
  other:
    "{{through}} of the {{count}} attack requests to {{route}} since {{change}} shipped {{time}} got past your app's checks.",
};
export const CHECK_FIX_ROUTE_STILL_DATABASE: PluralTemplate = {
  one: "{{through}} of the {{count}} attack request to {{route}} since {{change}} shipped {{time}} reached the database.",
  other:
    "{{through}} of the {{count}} attack requests to {{route}} since {{change}} shipped {{time}} reached the database.",
};
export const CHECK_FIX_ROUTE_REGRESSED: string = translationKey(
  "An attack request to {{route}} got past your app's checks {{time}}, after {{change}} shipped: the fix is not holding.",
);
export const CHECK_FIX_ROUTE_REGRESSED_DATABASE: string = translationKey(
  "An attack request to {{route}} reached the database {{time}}, after {{change}} shipped: the fix is not holding.",
);
export const CHECK_FIX_NOTHING_SHIPPED: string = translationKey(
  "No new version of {{service}} has shipped since the case opened.",
);
export const CHECK_FIX_PULL_REQUEST_OPEN: string = translationKey(
  "OneUptime AI's fix {{pullRequest}} is waiting for review.",
);
// A pull request a person linked to the case (#10604), not merged yet.
export const CHECK_FIX_LINKED_PULL_REQUEST_OPEN: string = translationKey(
  "The fix {{pullRequest}} linked to this case has not merged yet.",
);
export const CHECK_FIX_PULL_REQUEST_NOT_SHIPPED: string = translationKey(
  "The fix {{pullRequest}} merged {{time}}, but OneUptime has seen no deploy of it yet.",
);
export const CHECK_FIX_CANNOT_NO_DEPLOYS: string = translationKey(
  "OneUptime records no deploys of {{service}}, so it cannot tell when a fix ships.",
);
export const CHECK_FIX_CANNOT_NO_SERVICE: string = translationKey(
  "OneUptime cannot tell which service answers {{route}}, so it cannot tell when a fix ships.",
);
export const CHECK_FIX_CANNOT_NOT_FOLLOWED: PluralTemplate = {
  one: "OneUptime cannot tell how far the {{count}} attack request to {{route}} since {{change}} shipped got: it could not be followed into your app's traces or logs.",
  other:
    "OneUptime cannot tell how far the {{count}} attack requests to {{route}} since {{change}} shipped got: none could be followed into your app's traces or logs.",
};

// What else OneUptime saw: the How We Know fold.
export const CHECK_FIX_FACT_BEFORE_THROUGH: PluralTemplate = {
  one: "Before it, {{through}} of {{count}} attack request got past your app's checks.",
  other:
    "Before it, {{through}} of {{count}} attack requests got past your app's checks.",
};
export const CHECK_FIX_FACT_BEFORE_DATABASE: PluralTemplate = {
  one: "Before it, {{through}} of {{count}} attack request reached the database.",
  other:
    "Before it, {{through}} of {{count}} attack requests reached the database.",
};
/*
 * How much evidence counts as proof, said where it is used: how many
 * attacks must be turned away before OneUptime calls the fix verified
 * (FixRouteStepCheck's getNeededProof).
 */
export const CHECK_FIX_FACT_WATCHING: PluralTemplate = {
  one: "Watching {{route}} {{until}}: verified once {{count}} attack request is turned away.",
  other:
    "Watching {{route}} {{until}}: verified once {{count}} attack requests are turned away.",
};
export const CHECK_FIX_FACT_WATCHING_DATABASE: PluralTemplate = {
  one: "Watching {{route}} {{until}}: verified once {{count}} attack request is kept out of the database.",
  other:
    "Watching {{route}} {{until}}: verified once {{count}} attack requests are kept out of the database.",
};
export const CHECK_FIX_FACT_WATCH_ENDED: string = translationKey(
  "OneUptime watched {{route}} {{until}}, and too few attacks came to verify the fix.",
);
export const CHECK_FIX_FACT_NONE_BEFORE: string = translationKey(
  "Before it, no attack request to {{route}} got past your app's checks either, so the attacks cannot show the fix worked.",
);
export const CHECK_FIX_FACT_TOO_FEW_BEFORE: string = translationKey(
  "Before it, so few attack requests to {{route}} got through that the attacks since cannot show the fix worked.",
);
export const CHECK_FIX_FACT_EDGE_STOPPED: PluralTemplate = {
  one: "Since then, {{count}} attack request to {{route}} was stopped at the edge and never reached your app, so it says nothing of the fix.",
  other:
    "Since then, {{count}} attack requests to {{route}} were stopped at the edge and never reached your app, so they say nothing of the fix.",
};
export const CHECK_FIX_FACT_UNFOLLOWED: PluralTemplate = {
  one: "{{count}} more attack request since could not be followed into your app's traces or logs.",
  other:
    "{{count}} more attack requests since could not be followed into your app's traces or logs.",
};

// ---------- Reset the password (fix:credentials, #10347) ----------

export const CHECK_FIX_PASSWORD_RESET: string = translationKey(
  "{{user}}'s password was changed in {{provider}} {{time}}, and their sessions were ended {{ended}}.",
);
export const CHECK_FIX_PASSWORD_SESSIONS_OPEN: string = translationKey(
  "{{user}}'s password was changed in {{provider}} {{time}}, but their sessions were not ended after the case opened.",
);
export const CHECK_FIX_PASSWORD_NOT_RESET: string = translationKey(
  "{{user}}'s password has not changed in {{provider}} since the case opened.",
);
export const CHECK_FIX_PASSWORD_GOOGLE_CANNOT_TELL: string = translationKey(
  "Google Workspace does not say when {{user}}'s password last changed, so OneUptime cannot tell whether it was reset.",
);

// ---------- MFA on the accounts it went after (fix:brute-force, #10347) ----------

export const CHECK_FIX_MFA_ALL: PluralTemplate = {
  one: "The {{count}} account the attack went after has MFA set up.",
  other: "All {{count}} accounts the attack went after have MFA set up.",
};
// Counted by the accounts without MFA, of {{total}} the attack went after.
export const CHECK_FIX_MFA_MISSING: PluralTemplate = {
  one: "{{user}}, {{count}} of the {{total}} accounts the attack went after, has no MFA set up.",
  other:
    "{{count}} of the {{total}} accounts the attack went after have no MFA set up, {{user}} among them.",
};
export const CHECK_FIX_FACT_MFA_ON: string = translationKey(
  "{{user}} has MFA set up in {{provider}}.",
);
export const CHECK_FIX_FACT_MFA_OFF: string = translationKey(
  "{{user}} has no MFA set up in {{provider}}.",
);

/*
 * ---------- Undo what changed on the account (fix:account-changes, #10603) ----------
 *
 * What the attack changed on accounts, from the case's events - a role, a
 * group, an app, an MFA device, a key, an account it made - each read back
 * in the product it was made in (Okta, Microsoft Entra ID, Google
 * Workspace). {{account}} and {{object}} are as the product names them,
 * {{provider}} is the product's own name.
 */
export const CHECK_ACCOUNT_CHANGES_STILL_THERE: PluralTemplate = {
  one: "{{count}} change the attack made to an account is still there.",
  other: "{{count}} changes the attack made to accounts are still there.",
};
export const CHECK_ACCOUNT_CHANGES_BACK: PluralTemplate = {
  one: "{{count}} change the attack made to an account is back: the undo is not holding.",
  other:
    "{{count}} changes the attack made to accounts are back: the undo is not holding.",
};
// Looks done, never checked: a change made another way may not be in the case's events.
export const CHECK_ACCOUNT_CHANGES_ALL_UNDONE: PluralTemplate = {
  one: "The change the attack made to an account is undone.",
  other: "All {{count}} changes the attack made to accounts are undone.",
};
// Counted by the changes OneUptime cannot read back, which a person confirms.
export const CHECK_ACCOUNT_CHANGES_CONFIRM_REST: PluralTemplate = {
  one: "What OneUptime could read back is undone. Confirm the other change yourself: OneUptime cannot read it back.",
  other:
    "What OneUptime could read back is undone. Confirm the other {{count}} changes yourself: OneUptime cannot read them back.",
};
export const CHECK_ACCOUNT_CHANGES_CANNOT_READ: PluralTemplate = {
  one: "OneUptime cannot read back the change the attack made to an account, so confirm it yourself.",
  other:
    "OneUptime cannot read back the {{count}} changes the attack made to accounts, so confirm each yourself.",
};
export const CHECK_ACCOUNT_CHANGES_NONE_FOUND: string = translationKey(
  "OneUptime found no change to an account in this case's events, so it cannot tell what to undo.",
);

// Each change, as it stands: still there.
export const CHECK_ACCOUNT_CHANGE_ROLE_STILL: string = translationKey(
  "{{account}} still holds the admin role {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_POLICY_STILL: string = translationKey(
  "{{account}} still has the policy {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_PASSWORD_STILL: string = translationKey(
  "The password the attack set for {{account}} still works in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_GROUP_STILL: string = translationKey(
  "{{account}} is still in the group {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_APP_STILL: string = translationKey(
  "{{account}} still has access to {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_MFA_STILL: string = translationKey(
  "The MFA device the attack added to {{account}} is still set up in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_KEY_STILL: string = translationKey(
  "The key {{object}} the attack made for {{account}} still works in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_ACCOUNT_STILL: string = translationKey(
  "The account {{account}} the attack made is still active in {{provider}}.",
);

// Undone.
export const CHECK_ACCOUNT_CHANGE_ROLE_UNDONE: string = translationKey(
  "{{account}} no longer holds the admin role {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_POLICY_UNDONE: string = translationKey(
  "{{account}} no longer has the policy {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_PASSWORD_UNDONE: string = translationKey(
  "The password the attack set for {{account}} no longer works in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_GROUP_UNDONE: string = translationKey(
  "{{account}} is no longer in the group {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_APP_UNDONE: string = translationKey(
  "{{account}} no longer has access to {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_MFA_UNDONE: string = translationKey(
  "The MFA device the attack added to {{account}} is gone from {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_KEY_UNDONE: string = translationKey(
  "The key {{object}} the attack made for {{account}} no longer works in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_ACCOUNT_UNDONE: string = translationKey(
  "The account {{account}} the attack made is gone or disabled in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_ACCOUNT_GONE: string = translationKey(
  "{{account}} no longer exists in {{provider}}, so nothing the attack gave it is left.",
);

// What a person confirms: OneUptime cannot read it back.
export const CHECK_ACCOUNT_CHANGE_ROLE_CONFIRM: string = translationKey(
  "Confirm {{account}} no longer holds the admin role {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_POLICY_CONFIRM: string = translationKey(
  "Confirm {{account}} no longer has the policy {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_PASSWORD_CONFIRM: string = translationKey(
  "Confirm the password the attack set for {{account}} no longer works in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM: string = translationKey(
  "Confirm {{account}} is no longer in the group {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_APP_CONFIRM: string = translationKey(
  "Confirm {{account}} no longer has access to {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_MFA_CONFIRM: string = translationKey(
  "Confirm the MFA device the attack added to {{account}} is gone from {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_KEY_CONFIRM: string = translationKey(
  "Confirm the key {{object}} the attack made for {{account}} no longer works in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_ACCOUNT_CONFIRM: string = translationKey(
  "Confirm the account {{account}} the attack made is gone or disabled in {{provider}}.",
);

/*
 * An IAM role's changes (#11038): {{account}} is the role's name. A role
 * the attack made - a backdoor, often trusting an account outside - a
 * trust policy it set, and a policy it gave the role more power with. A
 * role is never "an account": its words say it is a role.
 */
export const CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL: string = translationKey(
  "The role {{account}} the attack made is still in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_ROLE_MADE_UNDONE: string = translationKey(
  "The role {{account}} the attack made is gone from {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_ROLE_MADE_CONFIRM: string = translationKey(
  "Confirm the role {{account}} the attack made is gone from {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_TRUST_STILL: string = translationKey(
  "The role {{account}} still has the trust policy the attack set in {{provider}}.",
);
// Undone: it trusts none of the outside accounts any trust policy the attack set trusted.
export const CHECK_ACCOUNT_CHANGE_TRUST_UNDONE: string = translationKey(
  "The role {{account}} in {{provider}} no longer trusts the outside accounts the attack's trust policy let in.",
);
export const CHECK_ACCOUNT_CHANGE_TRUST_CONFIRM: string = translationKey(
  "Confirm the role {{account}} in {{provider}} trusts only whom you expect: the attack changed its trust policy.",
);
export const CHECK_ACCOUNT_CHANGE_ROLE_POLICY_STILL: string = translationKey(
  "The role {{account}} still has the policy {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_ROLE_POLICY_UNDONE: string = translationKey(
  "The role {{account}} no longer has the policy {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_ROLE_POLICY_CONFIRM: string = translationKey(
  "Confirm the role {{account}} no longer has the policy {{object}} in {{provider}}.",
);
export const CHECK_ACCOUNT_CHANGE_ROLE_GONE: string = translationKey(
  "The role {{account}} no longer exists in {{provider}}, so nothing the attack gave it is left.",
);

/*
 * Whom a role trusts outside the AWS account it is in (#11038), as its
 * trust policy says now: the line under the role's, unmarked, naming what
 * a person checks. {{trusted}} is an account's 12 digits, {{cloudAccount}}
 * the role's own account. Several are counted, one named.
 */
export const CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNT: string = translationKey(
  "The role {{account}} trusts {{trusted}}, an AWS account outside {{cloudAccount}}.",
);
export const CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNTS: PluralTemplate = {
  one: "The role {{account}} trusts {{count}} AWS account outside {{cloudAccount}}: {{trusted}}.",
  other:
    "The role {{account}} trusts {{count}} AWS accounts outside {{cloudAccount}}, {{trusted}} among them.",
};
// Its trust policy trusts "*": every AWS account.
export const CHECK_ACCOUNT_CHANGE_TRUSTS_EVERY_ACCOUNT: string =
  translationKey(
    "Anyone in AWS may assume the role {{account}}: its trust policy trusts every AWS account.",
  );

// Why OneUptime cannot read the changes in a product back, said once for it.
export const CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION: string = translationKey(
  "OneUptime has no connection to {{provider}}, so it cannot read the changes there back.",
);
/*
 * What a step checked before #10900 said of AWS: kept, so a case closed
 * since still reads it in its reader's language. No check writes it now.
 */
export const CHECK_ACCOUNT_CHANGES_FACT_AWS: string = translationKey(
  "OneUptime does not read changes in AWS IAM back yet.",
);
// AWS: no AWS cloud connection of the project reads the account the change was made in (#10900).
export const CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION: string =
  translationKey(
    "No AWS connection reads the account {{cloudAccount}}, so OneUptime cannot read its IAM back. Connect it under Cloud → Connect, with Security case checks on.",
  );
// AWS: a connection reaches the account, but may not read its IAM: Security case checks are off (#10900).
export const CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED: string =
  translationKey(
    "To read IAM back in the account {{cloudAccount}}, edit its AWS connection under Cloud → Connect, turn on Security case checks, and run the command it shows.",
  );
/*
 * AWS: the connection's Security case checks are on, and AWS refused the
 * read all the same: its command was not run again since the setting came
 * to grant more - the role reads (#11038) - or what it granted was removed.
 */
export const CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN: string =
  translationKey(
    "AWS refused OneUptime's read of IAM in the account {{cloudAccount}}, though its AWS connection has Security case checks on. Edit the connection under Cloud → Connect and run the command it shows again.",
  );
/*
 * The links after the lines that say what to change (#11039): the AWS
 * connection's form on Cloud → Connect, for a reader who may change it, or
 * Cloud → Connect itself, for one who may only see it.
 */
export const CHECK_ACCOUNT_CHANGES_EDIT_CONNECTION: string =
  translationKey("Edit Connection");
export const CHECK_ACCOUNT_CHANGES_OPEN_CLOUD_CONNECTIONS: string =
  translationKey("Open Cloud Connections");
// Google Workspace: the connection may not read groups: its delegation lacks the group member scope (#10901).
export const CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS: string = translationKey(
  "To read Google Workspace groups back, add the scope {{scope}} to the connection's domain-wide delegation, for an administrator who may read groups.",
);
export const CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH: string =
  translationKey(
    "{{provider}} says {{account}} still has something of the kind the attack gave, but not whether it is that one.",
  );
