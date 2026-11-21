import {
  SecurityBlocklistFeedFamily,
  SecurityBlocklistFeedStatus,
} from "Common/Types/SecurityBlocklist/SecurityBlocklistFeed";
import { SecurityBlocklistFeedAuthentication } from "Common/Types/SecurityBlocklist/SecurityBlocklistFeedSetup";
import { SecurityBlockEnforcementView } from "Common/Types/SecurityBlocklist/SecurityBlockEnforcement";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of Security Events > Playbooks > Blocklist Feeds (#10345): the
 * list of feeds, a feed's page - its setup steps, its secret, its fetches -
 * and what the Blocklist says of a feed. Each is an en.json key, looked up
 * where it is drawn; the setup steps are the shared rules' own keys
 * (Types/SecurityBlocklist/SecurityBlocklistFeedSetup).
 *
 * React-free, so the words are pinned in a plain test.
 */

// ---------- The list ----------

export const FEEDS_TABLE_TITLE: string = translationKey("Blocklist Feeds");

export const FEEDS_TABLE_DESCRIPTION: string = translationKey(
  "Secret URLs your firewalls and proxies read the blocklist from. A block is enforced at a feed once a firewall has fetched it.",
);

export const FEEDS_EMPTY_TITLE: string = translationKey(
  "No blocklist feeds yet",
);

export const FEEDS_EMPTY_DESCRIPTION: string = translationKey(
  "Make a feed and paste its URL into Palo Alto, FortiGate, Check Point, Cisco, OPNsense or a host's firewall: it reads your blocklist every few minutes.",
);

export const FEED_SINGULAR: string = translationKey("Blocklist Feed");
export const FEED_PLURAL: string = translationKey("Blocklist Feeds");

export const NAME_COLUMN_TITLE: string = translationKey("Name");
export const STATUS_COLUMN_TITLE: string = translationKey("Status");
export const LAST_FETCHED_COLUMN_TITLE: string = translationKey("Last Fetched");
export const ENTRIES_COLUMN_TITLE: string = translationKey("Entries");

export const NEVER_FETCHED: string = translationKey("Never");

// ---------- The form ----------

export const FIREWALL_FIELD_TITLE: string = translationKey("Firewall");
export const FIREWALL_FIELD_DESCRIPTION: string = translationKey(
  "The firewall or proxy that reads the feed. Its page shows the steps for it.",
);
export const NAME_FIELD_TITLE: string = translationKey("Name");
export const NAME_FIELD_DESCRIPTION: string = translationKey(
  "What the Blocklist calls it where a block is enforced. Named after the firewall when left empty.",
);
export const FAMILY_FIELD_TITLE: string = translationKey("Serves");
export const FAMILY_FIELD_DESCRIPTION: string = translationKey(
  "Some firewalls take IPv4 and IPv6 addresses from lists of their own.",
);
export const ALLOWLIST_FIELD_TITLE: string = translationKey(
  "Allowed Source Addresses",
);
export const ALLOWLIST_FIELD_DESCRIPTION: string = translationKey(
  "Only these addresses and ranges may read the feed, one a line. Leave it empty for any address that has the secret.",
);
export const ALLOWLIST_PLACEHOLDER: string = "203.0.113.7\n198.51.100.0/24";

export const FAMILY_LABELS: Record<SecurityBlocklistFeedFamily, string> = {
  [SecurityBlocklistFeedFamily.Both]: translationKey("IPv4 and IPv6"),
  [SecurityBlocklistFeedFamily.IPv4]: translationKey("IPv4 only"),
  [SecurityBlocklistFeedFamily.IPv6]: translationKey("IPv6 only"),
};

// The firewall a feed is for, when none of the listed ones.
export const OTHER_FIREWALL_LABEL: string = translationKey(
  "Other (firewall or proxy)",
);

// ---------- Where a feed stands ----------

export const STATUS_LABELS: Record<SecurityBlocklistFeedStatus, string> = {
  [SecurityBlocklistFeedStatus.Reading]: translationKey("Reading"),
  [SecurityBlocklistFeedStatus.NotSetUp]: translationKey("Not fetched yet"),
  [SecurityBlocklistFeedStatus.StoppedReading]:
    translationKey("Stopped reading"),
  [SecurityBlocklistFeedStatus.Revoked]: translationKey("Secret revoked"),
};

export const STOPPED_READING_SENTENCE: string = translationKey(
  "Your firewall stopped reading this feed {{time}}, so blocks are not enforced there until it reads it again.",
);

export const STOPPED_READING_FEED_SENTENCE: string = translationKey(
  "Your firewall stopped reading {{feed}} {{time}}, so blocks are not enforced there until it reads it again.",
);

export const NOT_FETCHED_SENTENCE: string = translationKey(
  "No firewall has fetched this feed yet. Follow the steps below; its first fetch shows here.",
);

export const REVOKED_SENTENCE: string = translationKey(
  "This feed's secret was revoked, so no firewall can read it. Rotate Secret makes a new one.",
);

export const OPEN_FEED: string = translationKey("Open Feed");

// ---------- The secret ----------

export const SECRET_SHOWN_ONCE_TITLE: string = translationKey(
  "Copy the Feed's Secret",
);
export const SECRET_SHOWN_ONCE_DESCRIPTION: string = translationKey(
  "OneUptime keeps only its hash, so it is shown now and never again. The steps below hold it until you leave this page.",
);
export const SECRET_DONE: string = translationKey("Done");

export const ROTATE_SECRET: string = translationKey("Rotate Secret");
export const ROTATE_SECRET_DESCRIPTION: string = translationKey(
  "Makes a new secret, shown once. The current one keeps working for a day, so you can give every firewall the new one.",
);
export const SECRET_ROTATED: string = translationKey("Secret rotated");

export const REVOKE_SECRET: string = translationKey("Revoke Secret");
export const REVOKE_SECRET_DESCRIPTION: string = translationKey(
  "The feed's secret, and the one before it, stop working at once. Its firewalls keep the list they have and can no longer refresh it.",
);
export const SECRET_REVOKED: string = translationKey("Secret revoked");

export const SECRET_ENDS_IN: string = translationKey("Ends in {{hint}}");
export const PREVIOUS_SECRET_WORKS_UNTIL: string = translationKey(
  "The secret before this one works until {{time}}.",
);

// ---------- Setting up a firewall ----------

export const SETUP_CARD_TITLE: string = translationKey("Set Up Your Firewall");
export const SETUP_CARD_DESCRIPTION: string = translationKey(
  "Paste the feed into your firewall or proxy. The steps follow each maker's own documentation.",
);
export const URL_LABEL: string = translationKey("URL");
export const MD5_URL_LABEL: string = translationKey("MD5 URL");
export const USERNAME_LABEL: string = translationKey("Username");
export const PASSWORD_LABEL: string = translationKey("Password");
export const BEARER_TOKEN_LABEL: string = translationKey("Bearer token");
export const SCRIPT_LABEL: string = translationKey("Commands");
export const SCRIPT_SECRET_SENTENCE: string = translationKey(
  "Put the feed's secret where the commands say {{placeholder}}. OneUptime shows it only when it is made: Rotate Secret to see a new one.",
);
export const SECRET_PLACEHOLDER_SENTENCE: string = translationKey(
  "The feed's secret, which OneUptime shows only when it is made. Rotate Secret to see a new one.",
);
export const PATH_SECRET_SENTENCE: string = translationKey(
  "This URL holds the feed's secret, which OneUptime shows only when it is made. Rotate Secret for a URL with a new one.",
);
export const READ_THE_GUIDE: string = translationKey("Read the full guide");
export const CONFIRMATION_WINDOW_SENTENCE: string = translationKey(
  "A block counts as enforced at the feed for ten minutes after each fetch, so have the firewall fetch it every few minutes.",
);

// How each way of sending the secret is named in the fetch log.
export const AUTHENTICATION_LABELS: Record<
  SecurityBlocklistFeedAuthentication,
  string
> = {
  [SecurityBlocklistFeedAuthentication.Basic]: translationKey("Password"),
  [SecurityBlocklistFeedAuthentication.Bearer]: translationKey("Bearer token"),
  [SecurityBlocklistFeedAuthentication.PathSecret]:
    translationKey("Secret in the URL"),
};

// ---------- The feed's details ----------

export const DETAILS_CARD_TITLE: string = translationKey("Blocklist Feed");
export const FEED_NOT_FOUND: string = translationKey(
  "This blocklist feed was deleted, or is not yours to read.",
);
export const SECRET_FIELD_TITLE: string = translationKey("Secret");
export const ANY_ADDRESS: string = translationKey("Any address");
export const FETCHES_EVERY_FIELD_TITLE: string =
  translationKey("Fetched Every");
export const LAST_FETCHED_FIELD_TITLE: string = translationKey("Last Fetched");
export const ENTRIES_FIELD_TITLE: string = translationKey("Entries Held");
export const LAST_FETCHED_FROM: string = translationKey(
  "{{time}} from {{address}}",
);

// ---------- The fetch log ----------

export const FETCHES_TABLE_TITLE: string = translationKey("Fetches");
export const FETCHES_TABLE_DESCRIPTION: string = translationKey(
  "Each time a firewall fetched this feed in the last 30 days, and whether the list had changed.",
);
export const FETCHES_EMPTY_TITLE: string = translationKey("No fetches yet");
export const FETCHES_EMPTY_DESCRIPTION: string = translationKey(
  "A firewall's fetches of this feed show here, kept for 30 days.",
);
export const FETCH_SINGULAR: string = translationKey("Fetch");
export const FETCH_PLURAL: string = translationKey("Fetches");
export const FETCHED_AT_COLUMN_TITLE: string = translationKey("Fetched At");
export const FROM_COLUMN_TITLE: string = translationKey("From");
export const FETCHED_WITH_COLUMN_TITLE: string = translationKey("Fetched With");
export const FILE_COLUMN_TITLE: string = translationKey("File");
export const SECRET_SENT_AS_COLUMN_TITLE: string =
  translationKey("Secret Sent As");
export const ANSWER_COLUMN_TITLE: string = translationKey("Answer");
export const LIST_SENT: string = translationKey("List sent");
export const LIST_NOT_CHANGED: string = translationKey("Not changed");
export const LIST_CHANGED: string = translationKey("Changed");
export const PREVIOUS_SECRET_USED: string = translationKey("Previous secret");
export const PREVIOUS_SECRET_USED_TOOLTIP: string = translationKey(
  "This firewall still sends the secret a rotation replaced. Give it the new one before the old one stops working.",
);

// ---------- Where a block is enforced, at a feed ----------

/*
 * What a feed's chip on a block says: what a firewall fetched, and when -
 * the delay between the block and the fetch that first held it.
 */
export const FEED_ENFORCEMENT_TOOLTIPS: Partial<
  Record<SecurityBlockEnforcementView, string>
> = {
  [SecurityBlockEnforcementView.Enforced]: translationKey(
    "A firewall fetched this block from {{destination}} {{delay}} after it was made. Last fetched {{time}}.",
  ),
  [SecurityBlockEnforcementView.Unconfirmed]: translationKey(
    "A firewall last fetched this block from {{destination}} {{time}}, and has not fetched the feed since.",
  ),
  [SecurityBlockEnforcementView.Pending]: translationKey(
    "Waiting for a firewall to fetch {{destination}}.",
  ),
  [SecurityBlockEnforcementView.Removing]: translationKey(
    "Waiting for a firewall to fetch {{destination}} without this block.",
  ),
};

// The Blocklist's notice while nothing enforces it: where to make a feed.
export const OPEN_BLOCKLIST_FEEDS: string = translationKey("Blocklist Feeds");

export const BLOCKLIST_FEEDS_TEST_IDS: {
  table: string;
  setupCard: string;
  firewallPicker: string;
  url: string;
  md5Url: string;
  steps: string;
  script: string;
  statusNotice: string;
  stoppedNotice: string;
  fetchesTable: string;
} = {
  table: "blocklist-feeds-table",
  setupCard: "blocklist-feed-setup",
  firewallPicker: "blocklist-feed-firewall-picker",
  url: "blocklist-feed-url",
  md5Url: "blocklist-feed-md5-url",
  steps: "blocklist-feed-steps",
  script: "blocklist-feed-script",
  statusNotice: "blocklist-feed-status-notice",
  stoppedNotice: "blocklist-feeds-stopped-notice",
  fetchesTable: "blocklist-feed-fetches-table",
};
