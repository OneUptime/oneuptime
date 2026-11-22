import {
  CloudflareAccessRulesReason,
  CloudflareRuleState,
} from "Common/Types/SecurityBlocklist/CloudflareBlocking";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF BLOCKING AT CLOUDFLARE (#10343): the Block Addresses dialog
 * of a Cloudflare connection - the opt-in, its write permissions, how
 * blocking is set up and how it stands - and the connection's row. Each is
 * an en.json key, looked up where it is drawn. The permissions are named as
 * Cloudflare's token form names them, and stay as written in every
 * language; what Cloudflare and OneUptime's server say (a check's message,
 * an error) is drawn as written.
 *
 * React-free, so the words are pinned in a plain test.
 */

// ---------- The connection's row ----------

export const BLOCK_ADDRESSES_ACTION: string = translationKey("Block Addresses");
export const BLOCK_ADDRESSES_ACTION_TOOLTIP: string = translationKey(
  "Enforce your blocklist at Cloudflare, with an IP list and one custom rule per action.",
);
export const BLOCKING_ON_DETAIL: string = translationKey("Blocks addresses");
export const BLOCKING_ATTENTION_DETAIL: string = translationKey(
  "Blocking needs attention",
);

// ---------- The dialog ----------

export const BLOCKING_DIALOG_TITLE: string = translationKey(
  "Block Addresses at Cloudflare",
);
export const BLOCKING_DIALOG_DESCRIPTION: string = translationKey(
  "OneUptime adds each address you block to its own IP lists in your Cloudflare account, and one custom rule per list in each zone, first in its rules.",
);

export const PERMISSIONS_HEADING: string = translationKey(
  "The API token needs these permissions",
);
export const LIST_PERMISSION_USE: string = translationKey(
  "For OneUptime's lists.",
);
export const WAF_PERMISSION_USE: string = translationKey(
  "On each zone to block in.",
);
export const ACCESS_RULES_PERMISSION_USE: string = translationKey(
  "Only on a plan without a list or a custom rule to spare.",
);

export const ZONES_FIELD_TITLE: string = translationKey("Zones");
export const ZONES_FIELD_DESCRIPTION: string = translationKey(
  "Leave empty to block in every zone the connection reads.",
);
export const ZONES_FIELD_PLACEHOLDER: string = translationKey("All zones");
export const ZONES_NOT_READ: string = translationKey(
  "OneUptime could not list the zones. Blocking is on in every zone the connection reads unless you choose some.",
);

export const NEW_TOKEN_FIELD_TITLE: string = translationKey("New API Token");
export const NEW_TOKEN_FIELD_DESCRIPTION: string = translationKey(
  "Paste a token with these permissions, or leave this empty once you have added them to the current token.",
);

export const CHECK_PERMISSIONS_BUTTON: string =
  translationKey("Check Permissions");
export const TURN_ON_BUTTON: string = translationKey("Turn On Blocking");
export const SAVE_ZONES_BUTTON: string = translationKey("Save Zones");
export const TURN_OFF_BUTTON: string = translationKey("Turn Off Blocking");
export const PUT_IT_BACK_BUTTON: string = translationKey("Put It Back");
export const PROTECT_ADDRESSES_BUTTON: string = translationKey(
  "Protect These Addresses",
);

export const CHECKING_PERMISSIONS: string = translationKey(
  "Checking the API token's permissions…",
);
export const NOT_TURNED_ON: string = translationKey(
  "Blocking stays off. Fix what failed below, then try again.",
);
export const TURNED_ON_TOAST: string = translationKey(
  "Blocking is on. OneUptime is setting up Cloudflare.",
);
export const ZONES_SAVED_TOAST: string = translationKey(
  "Zones saved. OneUptime is setting them up in Cloudflare.",
);
export const PUTTING_BACK_TOAST: string = translationKey(
  "OneUptime is putting your rule back.",
);

// ---------- How it stands ----------

export const SETTING_UP_NOTICE: string = translationKey(
  "OneUptime is setting up Cloudflare. This takes a minute.",
);
export const LAST_ERROR_TITLE: string = translationKey(
  "The last change or check of Cloudflare failed.",
);

// What each action's mechanism is: a list, or IP Access Rules and why.
export const LIST_MECHANISM: string = translationKey(
  "List {{list}}, with a custom rule in each zone",
);
export const ACCESS_RULES_MECHANISMS: Record<
  CloudflareAccessRulesReason,
  string
> = {
  [CloudflareAccessRulesReason.NoListLeft]: translationKey(
    "IP Access Rules: your Cloudflare plan has no list to spare",
  ),
  [CloudflareAccessRulesReason.NoRuleLeft]: translationKey(
    "IP Access Rules: {{zone}} has no custom rule to spare ({{used}} of {{limit}} used)",
  ),
};

export const ADDRESSES_HELD: string = translationKey(
  "Addresses held: {{used}} of {{limit}}",
);
export const ADDRESSES_HELD_NO_LIMIT: string = translationKey(
  "Addresses held: {{used}}",
);

// A zone's rule that does not enforce, as the connection says it.
export const RULE_PROBLEMS: Record<
  Exclude<CloudflareRuleState, CloudflareRuleState.Enforcing>,
  string
> = {
  [CloudflareRuleState.TurnedOff]: translationKey(
    "Your rule in {{zone}} was turned off: blocks there are not enforced",
  ),
  [CloudflareRuleState.Deleted]: translationKey(
    "Your rule in {{zone}} was deleted: blocks there are not enforced",
  ),
  [CloudflareRuleState.Changed]: translationKey(
    "Your rule in {{zone}} was changed: blocks there are not enforced",
  ),
  [CloudflareRuleState.NotSetUp]: translationKey(
    "Your rule in {{zone}} is not set up yet: blocks there are not enforced",
  ),
};

// On a Free zone, how many of its five custom rules OneUptime's take.
export const FREE_PLAN_RULES: PluralTemplate = {
  one: "OneUptime's rule takes {{count}} of the {{limit}} custom rules of {{zone}}.",
  other:
    "OneUptime's rules take {{count}} of the {{limit}} custom rules of {{zone}}.",
};

export const SKIP_ADDRESSES_NOTICE: string = translationKey(
  "Your skip rules let {{addresses}} through. OneUptime's rules run first, so a block of one of them would hold.",
);
export const ADDRESSES_PROTECTED_TOAST: PluralTemplate = {
  one: "{{count}} address protected.",
  other: "{{count}} addresses protected.",
};
export const SKIP_ADDRESS_DESCRIPTION: string = translationKey(
  "Let through by a skip rule in Cloudflare.",
);

export const REMOVING_NOTICE: string = translationKey(
  "OneUptime is removing its lists and rules from Cloudflare.",
);

// ---------- Turning it off ----------

export const TURN_OFF_TITLE: string = translationKey("Turn Off Blocking");
export const TURN_OFF_DESCRIPTION: string = translationKey(
  "Your blocks are no longer enforced at Cloudflare.",
);
export const REMOVE_FROM_CLOUDFLARE_TITLE: string = translationKey(
  "Remove OneUptime's lists and rules from Cloudflare",
);
export const REMOVE_FROM_CLOUDFLARE_DESCRIPTION: string = translationKey(
  "Removes everything OneUptime added, and nothing else. Kept, they stay in Cloudflare and go on blocking what they hold.",
);
export const TURNED_OFF_TOAST: string = translationKey("Blocking is off.");
export const TURNED_OFF_REMOVING_TOAST: string = translationKey(
  "Blocking is off. OneUptime is removing its lists and rules from Cloudflare.",
);

// ---------- Deleting a connection that blocks ----------

export const DELETE_WHILE_BLOCKING: string = translationKey(
  "{{name}} blocks addresses at Cloudflare. Turn blocking off first: OneUptime then asks whether to remove its lists and rules from Cloudflare.",
);

export const CLOUDFLARE_BLOCKING_TEST_IDS: {
  dialog: string;
  permissions: string;
  checks: string;
  status: string;
  zoneProblem: string;
  skipAddresses: string;
  removeCheckbox: string;
} = {
  dialog: "cloudflare-blocking-dialog",
  permissions: "cloudflare-blocking-permissions",
  checks: "cloudflare-blocking-checks",
  status: "cloudflare-blocking-status",
  zoneProblem: "cloudflare-blocking-zone-problem",
  skipAddresses: "cloudflare-blocking-skip-addresses",
  removeCheckbox: "cloudflare-blocking-remove",
};
