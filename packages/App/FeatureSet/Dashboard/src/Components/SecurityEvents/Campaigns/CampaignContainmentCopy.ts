import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF CAMPAIGNS' ACTIONS (#10354): the Campaigns page's selection
 * and Block Addresses, Group by Network and its rows, Challenge This
 * Network, and a case's repeat-offender line and Block the Whole Campaign.
 * English keys of the Dashboard's locales; each count goes through the
 * reader's plural forms.
 */

// ---------- The page ----------

export const GROUP_BY_NETWORK: string = translationKey("Group by network");
export const GROUP_BY_NETWORK_DESCRIPTION: string = translationKey(
  "One row per network: by ASN where Cloudflare's events name one, else by /24 or /48.",
);

export const SELECT_ADDRESS_LABEL: string =
  translationKey("Select {{address}}");
export const SELECT_ALL_LABEL: string = translationKey(
  "Select every address that can be blocked",
);

export const ADDRESSES_SELECTED: PluralTemplate = {
  one: translationKey("{{count}} address selected"),
  other: translationKey("{{count}} addresses selected"),
};

export const BLOCK_ADDRESSES: string = translationKey("Block Addresses");
export const CLEAR_SELECTION: string = translationKey("Clear Selection");
export const SELECT_TO_BLOCK_HINT: string = translationKey(
  "Select addresses to block them in one go.",
);

export const NETWORKS_LABEL: string = translationKey("Networks");

/*
 * A row the Blocklist holds now: its pill, and when it ends. {{until}} is
 * the moment with its own words (Common/Utils/MomentPhrases, #10932):
 * "until 14:25" today, "until 27 Nov at 14:25" on another day.
 */
export const ROW_BLOCKED: string = translationKey("Blocked");
export const ROW_CHALLENGED: string = translationKey("Challenged");
export const ROW_BLOCKED_UNTIL: string = translationKey("Blocked {{until}}");
export const ROW_CHALLENGED_UNTIL: string = translationKey(
  "Challenged {{until}}",
);
// Beside the pill, when a range or a network holds the row: what does.
export const ROW_HELD_BY: string = translationKey("By {{value}}");

// ---------- Network rows ----------

export const NETWORK_ADDRESS_COUNT: PluralTemplate = {
  one: translationKey("{{count}} address"),
  other: translationKey("{{count}} addresses"),
};

// The addresses a row names, and how many more it holds.
export const NETWORK_MORE_ADDRESSES: PluralTemplate = {
  one: translationKey("{{addresses}} and {{count}} more"),
  other: translationKey("{{addresses}} and {{count}} more"),
};

export const NETWORK_RANGES: PluralTemplate = {
  one: translationKey("Sent from {{count}} range: {{ranges}}"),
  other: translationKey("Sent from {{count}} ranges: {{ranges}}"),
};

export const CHALLENGE_THIS_NETWORK: string = translationKey(
  "Challenge This Network",
);

export const NETWORKS_TRUNCATED: string = translationKey(
  "Grouped from the {{count}} most serious addresses in this window.",
);

// ---------- Block Addresses ----------

export const BLOCK_ADDRESSES_DESCRIPTION: string = translationKey(
  "Blocks each selected campaign's address in one go, at every edge that enforces your blocklist.",
);

export const WILL_BLOCK: PluralTemplate = {
  one: translationKey("Blocks {{count}} address for {{duration}}."),
  other: translationKey("Blocks {{count}} addresses for {{duration}}."),
};

export const WILL_CHALLENGE: PluralTemplate = {
  one: translationKey("Challenges {{count}} address for {{duration}}."),
  other: translationKey("Challenges {{count}} addresses for {{duration}}."),
};

export const LEFT_OUT_HEADING: PluralTemplate = {
  one: translationKey("{{count}} address is left out:"),
  other: translationKey("{{count}} addresses are left out:"),
};

export const NOTHING_TO_BLOCK: string = translationKey(
  "Every selected address is left out, so nothing will be blocked.",
);

export const SIGNED_IN_UNKNOWN: string = translationKey(
  "OneUptime could not check whether a signed-in user used these addresses, so none is left out for that.",
);

export const LEFT_OUT_SIGNED_IN: string = translationKey(
  "{{names}} signed in from it in the last 30 days.",
);

export const CHALLENGE_INSTEAD_DESCRIPTION: string = translationKey(
  "People pass a challenge; scripts and API clients do not.",
);

export const BLOCKED_ADDRESSES_TOAST: PluralTemplate = {
  one: translationKey("Blocked {{count}} address."),
  other: translationKey("Blocked {{count}} addresses."),
};

export const CHALLENGED_ADDRESSES_TOAST: PluralTemplate = {
  one: translationKey("Challenged {{count}} address."),
  other: translationKey("Challenged {{count}} addresses."),
};

export const LEFT_OUT_TOAST: PluralTemplate = {
  one: translationKey("{{count}} was left out."),
  other: translationKey("{{count}} were left out."),
};

export const CHECK_ADDRESSES_FAILED: string = translationKey(
  "The addresses could not be checked.",
);

// ---------- Challenge This Network ----------

export const CHALLENGE_NETWORK_TITLE: string = translationKey(
  "Challenge {{network}}",
);

export const CHALLENGE_NETWORK_DOES: string = translationKey(
  "Every request from {{network}} is asked to pass a challenge at {{destinations}} for {{duration}}. People pass it; scripts and API clients do not.",
);

export const WHAT_TO_CHALLENGE: string = translationKey("What to challenge");

export const CHALLENGE_WHOLE_ASN: string = translationKey(
  "The whole network, {{network}}",
);

export const CHALLENGE_ONE_RANGE: PluralTemplate = {
  one: translationKey("{{range}} only, {{count}} of its addresses"),
  other: translationKey("{{range}} only, {{count}} of its addresses"),
};

export const NETWORK_SIGNED_IN: string = translationKey(
  "OneUptime will not challenge {{network}}: {{names}} signed in from it in the last 30 days.",
);

export const NETWORK_PROTECTED: string = translationKey(
  "OneUptime will not challenge {{network}}.",
);

export const NETWORK_NOT_HELD_RANGE: string = translationKey(
  "Nothing you have connected can challenge {{network}}. Turn on Block Addresses on your Cloudflare connection, or connect AWS WAF.",
);

export const NETWORK_NOT_HELD_ASN: string = translationKey(
  "Nothing you have connected challenges a network by its ASN. Turn on Block Addresses on your Cloudflare connection, or challenge one of its ranges.",
);

export const NETWORK_UNCHECKED: string = translationKey(
  "OneUptime cannot tell whether a signed-in user used {{network}}.",
);

export const NETWORK_UNCHECKED_ASN: PluralTemplate = {
  one: translationKey(
    "OneUptime cannot tell who uses {{network}}: it knows only the {{count}} address it saw attack from it. Your own servers and your users may be in it too.",
  ),
  other: translationKey(
    "OneUptime cannot tell who uses {{network}}: it knows only the {{count}} addresses it saw attack from it. Your own servers and your users may be in it too.",
  ),
};

export const NETWORK_UNCHECKED_NEEDS_ADMIN: string = translationKey(
  "Only a Security Admin, a Project Admin or a Project Owner can challenge it anyway.",
);

export const NETWORK_ACKNOWLEDGE: string = translationKey(
  "I know OneUptime cannot check who uses this network",
);

// {{until}}: the moment the challenge ends, with its own words (#10932).
export const CHALLENGED_NETWORK_TOAST: string = translationKey(
  "Challenged {{network}} {{until}}.",
);
// A challenge that ends when someone lifts it.
export const CHALLENGED_NETWORK_UNTIL_LIFTED_TOAST: string = translationKey(
  "Challenged {{network}}.",
);

export const CHECK_NETWORK_FAILED: string = translationKey(
  "The network could not be checked.",
);

// ---------- Repeat offenders ----------

/*
 * "Blocked twice before, last on 12 Nov (case CASE-812)": once and twice
 * read as words, and more as a count in the reader's plural forms. A block
 * made for no case leaves the case out.
 */
export const REPEAT_ONCE: string = translationKey(
  "Blocked once before, last on {{date}} (case {{caseNumber}}).",
);
export const REPEAT_TWICE: string = translationKey(
  "Blocked twice before, last on {{date}} (case {{caseNumber}}).",
);
export const REPEAT_MANY: PluralTemplate = {
  one: translationKey(
    "Blocked {{count}} time before, last on {{date}} (case {{caseNumber}}).",
  ),
  other: translationKey(
    "Blocked {{count}} times before, last on {{date}} (case {{caseNumber}}).",
  ),
};
export const REPEAT_ONCE_NO_CASE: string = translationKey(
  "Blocked once before, last on {{date}}.",
);
export const REPEAT_TWICE_NO_CASE: string = translationKey(
  "Blocked twice before, last on {{date}}.",
);
export const REPEAT_MANY_NO_CASE: PluralTemplate = {
  one: translationKey("Blocked {{count}} time before, last on {{date}}."),
  other: translationKey("Blocked {{count}} times before, last on {{date}}."),
};

// ---------- A case's Block the Whole Campaign ----------

export const CAMPAIGN_OF_ADDRESS_LINE: PluralTemplate = {
  one: translationKey(
    "{{count}} more address sent the same requests with the same tools over the last {{days}} days.",
  ),
  other: translationKey(
    "{{count}} more addresses sent the same requests with the same tools over the last {{days}} days.",
  ),
};

export const BLOCK_WHOLE_CAMPAIGN: string = translationKey(
  "Block the Whole Campaign",
);

export const BLOCK_WHOLE_CAMPAIGN_DESCRIPTION: string = translationKey(
  "{{address}} and the addresses that sent the same requests with the same tools, in one block that waits for one approval when yours needs one.",
);

export const WHOLE_CAMPAIGN_STARTED_TOAST: PluralTemplate = {
  one: translationKey("Blocking {{count}} address."),
  other: translationKey("Blocking {{count}} addresses."),
};

export const WHOLE_CAMPAIGN_ASKED_TOAST: PluralTemplate = {
  one: translationKey("Asked for approval to block {{count}} address."),
  other: translationKey("Asked for approval to block {{count}} addresses."),
};

export const LOAD_CAMPAIGN_FAILED: string = translationKey(
  "The campaign could not be loaded.",
);

export const SECURITY_CAMPAIGN_TEST_IDS: {
  selectAll: string;
  selectRow: string;
  selectionBar: string;
  blockAddresses: string;
  clearSelection: string;
  groupByNetwork: string;
  networkRow: string;
  challengeNetwork: string;
  rowBlock: string;
  checklist: string;
  checklistItem: string;
  repeatLine: string;
  campaignLine: string;
  blockWholeCampaign: string;
  networkStanding: string;
  acknowledge: string;
} = {
  selectAll: "security-campaigns-select-all",
  selectRow: "security-campaign-select",
  selectionBar: "security-campaigns-selection",
  blockAddresses: "security-campaigns-block-addresses",
  clearSelection: "security-campaigns-clear-selection",
  groupByNetwork: "security-campaigns-group-by-network",
  networkRow: "security-attack-network",
  challengeNetwork: "security-attack-network-challenge",
  rowBlock: "security-campaign-row-block",
  checklist: "security-campaign-checklist",
  checklistItem: "security-campaign-checklist-item",
  repeatLine: "security-case-repeat-offender",
  campaignLine: "security-case-campaign-line",
  blockWholeCampaign: "security-case-block-whole-campaign",
  networkStanding: "security-network-challenge-standing",
  acknowledge: "security-network-challenge-acknowledge",
};
