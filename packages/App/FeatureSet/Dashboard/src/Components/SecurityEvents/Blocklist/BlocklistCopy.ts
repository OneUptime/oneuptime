import {
  SecurityBlockDuration,
  SecurityBlockSource,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockEnforcementView } from "Common/Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of Security Events > Playbooks > Blocklist (#10338): the list of
 * what the project blocks, where each block is enforced, the Block Address
 * dialog and a block's Lift, Extend and Make Permanent. Each is an en.json
 * key, looked up where it is drawn. What is wrong with a value, and what
 * protects an address, are the shared rules' own sentences
 * (Types/SecurityBlocklist), keys too, which the server answers an API
 * client with in English.
 *
 * React-free, so the words are pinned in a plain test.
 */

// ---------- The list ----------

export const BLOCKLIST_TABLE_TITLE: string = translationKey("Blocklist");

export const BLOCKLIST_TABLE_DESCRIPTION: string = translationKey(
  "What your project blocks: why, until when, and where each block is enforced.",
);

export const BLOCKLIST_EMPTY_TITLE: string = translationKey(
  "Nothing is blocked yet",
);

export const BLOCKLIST_EMPTY_DESCRIPTION: string = translationKey(
  "Block an address that attacks your app. Every block expires unless someone keeps it, and your own addresses are never blocked.",
);

// A row is one address or range: "Block Address", "Showing 1-3 of 3 addresses".
export const BLOCK_SINGULAR: string = translationKey("Address");
export const BLOCK_PLURAL: string = translationKey("Addresses");
export const BLOCK_VERB: string = translationKey("Block");

/*
 * The other tabs (#10346): a domain or a URL, and a file - each a row of
 * its own kind, blocked on every machine.
 */
export const DOMAIN_SINGULAR: string = translationKey("Domain or URL");
export const DOMAIN_PLURAL: string = translationKey("Domains and URLs");
export const FILE_SINGULAR: string = translationKey("File");
export const FILE_PLURAL: string = translationKey("Files");

export const DOMAINS_EMPTY_DESCRIPTION: string = translationKey(
  "Block a domain or a URL your machines must not reach. Every block expires unless someone keeps it, and your own domains are never blocked.",
);
export const FILES_EMPTY_DESCRIPTION: string = translationKey(
  "Block a file your machines must not run. Every block expires unless someone keeps it, and the files you protect are never blocked.",
);

// The columns.
export const ADDRESS_COLUMN_TITLE: string = translationKey("Address");
export const DOMAIN_COLUMN_TITLE: string = translationKey("Domain or URL");
export const FILE_COLUMN_TITLE: string = translationKey("File Hash");
export const ACTION_COLUMN_TITLE: string = translationKey("Action");
export const ENFORCED_AT_COLUMN_TITLE: string = translationKey("Enforced At");
export const EXPIRES_COLUMN_TITLE: string = translationKey("Expires");
export const CASE_COLUMN_TITLE: string = translationKey("Case");
export const ADDED_BY_COLUMN_TITLE: string = translationKey("Added By");

// The filters.
export const STATE_FILTER_TITLE: string = translationKey("State");

// What each row's action says it does.
export const BLOCKED_LABEL: string = translationKey("Blocked");
export const CHALLENGED_LABEL: string = translationKey("Challenged");
export const QUARANTINED_LABEL: string = translationKey(
  "Blocked and quarantined",
);

// An address blocked everywhere, beside it (#10346).
export const EVERY_MACHINE_LABEL: string = translationKey("On every machine");
export const EVERY_MACHINE_TOOLTIP: string = translationKey(
  "Blocked at the edge and on every machine, through Microsoft Defender.",
);

// An ended block, in the Expires column.
export const LIFTED_LABEL: string = translationKey("Lifted");
export const EXPIRED_LABEL: string = translationKey("Expired (block)");
export const UNTIL_LIFTED_LABEL: string = translationKey("Until lifted");

// Who made a block that no person made.
export const SOURCE_LABELS: Record<
  Exclude<SecurityBlockSource, SecurityBlockSource.Person>,
  string
> = {
  [SecurityBlockSource.Playbook]: translationKey("Playbook"),
  [SecurityBlockSource.AutomaticResponse]: translationKey("Automatic Response"),
  [SecurityBlockSource.OneUptimeAi]: translationKey("OneUptime AI"),
  [SecurityBlockSource.Api]: translationKey("API Key"),
};

// ---------- Where it is enforced ----------

export const NOT_ENFORCED_LABEL: string = translationKey("Not enforced");

export const NOT_ENFORCED_TOOLTIP: string = translationKey(
  "Nothing holds this block yet, so it is not blocked anywhere.",
);

/*
 * One destination's chip says the destination; its hover tip says where
 * the block stands there.
 */
export const ENFORCEMENT_TOOLTIPS: Record<
  SecurityBlockEnforcementView,
  string
> = {
  [SecurityBlockEnforcementView.Enforced]: translationKey(
    "{{destination}} holds this block. Last confirmed {{time}}.",
  ),
  [SecurityBlockEnforcementView.Unconfirmed]: translationKey(
    "{{destination}} last held this block {{time}}, and has not been read back since.",
  ),
  [SecurityBlockEnforcementView.Pending]: translationKey(
    "Waiting for {{destination}} to hold this block.",
  ),
  [SecurityBlockEnforcementView.NotApplied]: translationKey(
    "{{destination}} does not hold this block. {{reason}}",
  ),
  [SecurityBlockEnforcementView.Removing]: translationKey(
    "Removing this block from {{destination}}.",
  ),
  [SecurityBlockEnforcementView.Removed]: translationKey(
    "Removed from {{destination}}.",
  ),
};

// The list says so once, above it, while nothing enforces the blocklist.
export const NOTHING_ENFORCES_TITLE: string = translationKey(
  "Nothing enforces these blocks yet.",
);

export const NOTHING_ENFORCES_DESCRIPTION: string = translationKey(
  "Connect Cloudflare, AWS WAF, Azure WAF, Cloud Armor or a firewall that reads a list, or turn on blocking on a Microsoft Defender or CrowdStrike connection. Until then, blocking here records it, and blocks it nowhere.",
);

export const OPEN_SECURITY_CONNECTIONS: string = translationKey(
  "Security Connections",
);
export const OPEN_CLOUD_CONNECTIONS: string =
  translationKey("Cloud Connections");

export const CANNOT_TELL_ENFORCEMENT: string = translationKey(
  "OneUptime could not read where your blocks are enforced. Try again in a minute.",
);

// ---------- Block Address ----------

export const BLOCK_ADDRESS_TITLE: string = translationKey("Block Address");

export const BLOCK_ADDRESS_DESCRIPTION: string = translationKey(
  "Blocks an address or a range at every destination that enforces your blocklist.",
);

export const ADDRESS_FIELD_TITLE: string = translationKey("Address or Range");
export const ADDRESS_FIELD_DESCRIPTION: string = translationKey(
  "An IPv4 or IPv6 address, or a range written as an address and a length.",
);
export const ADDRESS_FIELD_PLACEHOLDER: string = translationKey(
  "e.g. 203.0.113.7 or 203.0.113.0/24",
);

export const EXPIRES_FIELD_TITLE: string = translationKey("Expires In");
export const REASON_FIELD_TITLE: string = translationKey("Reason");
export const REASON_FIELD_DESCRIPTION: string = translationKey(
  "Why it is blocked, for whoever reads the list later.",
);

export const ACTION_FIELD_TITLE: string = translationKey("Action");
export const ACTION_FIELD_DESCRIPTION: string = translationKey(
  "People pass a challenge; scripts and API clients do not.",
);
export const ACTION_BLOCK_OPTION: string = translationKey("Block");
export const ACTION_CHALLENGE_OPTION: string = translationKey("Challenge");
export const ACTION_QUARANTINE_OPTION: string = translationKey(
  "Block and Quarantine",
);

// Block Address's More fields (#10346): the address on every machine too.
export const EVERY_MACHINE_FIELD_TITLE: string = translationKey(
  "Block on Every Machine Too",
);
export const EVERY_MACHINE_FIELD_DESCRIPTION: string = translationKey(
  "Through Microsoft Defender, for a command-and-control server: what matters there is your machines reaching out.",
);

// ---------- Block Domain or URL, Block File (#10346) ----------

export const BLOCK_DOMAIN_TITLE: string = translationKey("Block Domain or URL");
export const BLOCK_DOMAIN_DESCRIPTION: string = translationKey(
  "Blocks a domain, and the names under it, or a URL on every machine, through Microsoft Defender.",
);
export const DOMAIN_FIELD_TITLE: string = translationKey("Domain or URL");
export const DOMAIN_FIELD_DESCRIPTION: string = translationKey(
  "A domain such as evil.example, or a URL that starts with http:// or https://.",
);
export const DOMAIN_FIELD_PLACEHOLDER: string = translationKey(
  "e.g. evil.example or https://evil.example/login",
);
export const NOT_A_DOMAIN_OR_URL: string = translationKey(
  "Enter a domain such as evil.example, or a URL that starts with http:// or https://.",
);

export const BLOCK_FILE_TITLE: string = translationKey("Block File");
export const BLOCK_FILE_DESCRIPTION: string = translationKey(
  "Blocks a file on every machine by its hash, through Microsoft Defender or CrowdStrike Falcon.",
);
export const FILE_FIELD_TITLE: string = translationKey("File Hash");
export const FILE_FIELD_DESCRIPTION: string = translationKey(
  "The file's MD5, SHA-1 or SHA-256 hash.",
);
export const FILE_FIELD_PLACEHOLDER: string = translationKey(
  "e.g. 44d88612fea8a8f36de82e1278abb02f",
);
export const NOT_A_FILE_HASH: string = translationKey(
  "Enter the file's MD5, SHA-1 or SHA-256 hash.",
);
export const QUARANTINE_FIELD_TITLE: string = translationKey("Quarantine It");
export const QUARANTINE_FIELD_DESCRIPTION: string = translationKey(
  "Microsoft Defender quarantines the copies it finds. CrowdStrike Falcon blocks the file, and quarantines it as your prevention policy says.",
);

export const UNTIL_LIFTED_FIELD_TITLE: string =
  translationKey("Keep Until Lifted");
export const UNTIL_LIFTED_FIELD_DESCRIPTION: string = translationKey(
  "The block does not expire. It stays until someone lifts it.",
);
export const UNTIL_LIFTED_REFUSED: string = translationKey(
  "Only a Security Admin, a Project Admin or a Project Owner can keep a block until someone lifts it.",
);

// The lengths a block is made or extended for: "24 hours", "7 days".
export const HOURS_PLURAL: PluralTemplate = {
  one: "{{count}} hour",
  other: "{{count}} hours",
};
export const DAYS_PLURAL: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};

export const DURATION_COUNTS: Record<
  Exclude<SecurityBlockDuration, SecurityBlockDuration.UntilLifted>,
  { count: number; plural: PluralTemplate }
> = {
  [SecurityBlockDuration.OneHour]: { count: 1, plural: HOURS_PLURAL },
  [SecurityBlockDuration.OneDay]: { count: 24, plural: HOURS_PLURAL },
  [SecurityBlockDuration.SevenDays]: { count: 7, plural: DAYS_PLURAL },
  [SecurityBlockDuration.ThirtyDays]: { count: 30, plural: DAYS_PLURAL },
};

// Asked before a block that could hurt the person making it.
export const BLOCK_YOUR_ADDRESS_TITLE: string = translationKey(
  "Block Your Own Address?",
);
export const BLOCK_YOUR_ADDRESS_DESCRIPTION: string = translationKey(
  "{{address}} is the address you are using right now. Blocking it can lock you out of your own app.",
);
export const BLOCK_WIDE_RANGE_TITLE: string = translationKey(
  "Block a Wide Range?",
);
export const BLOCK_WIDE_RANGE_DESCRIPTION: string = translationKey(
  "{{value}} is wider than a {{largest}} and blocks a whole network, its people with it.",
);
export const BLOCK_ANYWAY: string = translationKey("Block Anyway");

// ---------- A row's actions ----------

export const LIFT_ACTION: string = translationKey("Lift");
export const LIFT_TITLE: string = translationKey("Lift Block");
export const LIFT_DESCRIPTION: string = translationKey(
  "{{value}} is no longer blocked once each destination drops the block.",
);
export const LIFT_REASON_FIELD_DESCRIPTION: string = translationKey(
  "Why it is lifted, for whoever reads the list later.",
);

export const LIFT_SELECTED_TITLE: string = translationKey("Lift Blocks");
export const LIFT_SELECTED_DESCRIPTION: string = translationKey(
  "What you selected is no longer blocked once each destination drops its block.",
);

export const EXTEND_ACTION: string = translationKey("Extend");
export const EXTEND_TITLE: string = translationKey("Extend Block");
export const EXTEND_DESCRIPTION: string = translationKey(
  "The block on {{value}} ends this long from now.",
);
export const EXTEND_FIELD_TITLE: string = translationKey("Ends In");

export const MAKE_PERMANENT_ACTION: string = translationKey("Make Permanent");
export const MAKE_PERMANENT_TITLE: string = translationKey(
  "Make Block Permanent",
);
export const MAKE_PERMANENT_DESCRIPTION: string = translationKey(
  "The block on {{value}} stays until someone lifts it. Blocks that never end pile up, and an address is often someone else's within days.",
);

export const ENDED_BLOCK_REASON: string = translationKey(
  "This block has ended. Block it again to block it once more.",
);

// What each change says once it is saved.
export const BLOCKED_TOAST: string = translationKey("{{value}} blocked.");
export const LIFTED_TOAST: string = translationKey(
  "The block on {{value}} is lifted.",
);
export const EXTENDED_TOAST: string = translationKey(
  "The block on {{value}} is extended.",
);
export const MADE_PERMANENT_TOAST: string = translationKey(
  "The block on {{value}} stays until someone lifts it.",
);

export const BLOCKLIST_TEST_IDS: {
  notice: string;
  addressCell: string;
  enforcedAtCell: string;
  notEnforced: string;
  expiresCell: string;
} = {
  notice: "blocklist-not-enforced-notice",
  addressCell: "blocklist-address",
  enforcedAtCell: "blocklist-enforced-at",
  notEnforced: "blocklist-not-enforced",
  expiresCell: "blocklist-expires",
};
