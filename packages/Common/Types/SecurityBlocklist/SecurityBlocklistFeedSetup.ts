import {
  SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES,
  SecurityBlocklistFeedFamily,
  SecurityBlocklistFeedFirewall,
} from "./SecurityBlocklistFeed";
import {
  SECURITY_BLOCKLIST_FEED_COMMENTS_QUERY,
  SECURITY_BLOCKLIST_FEED_FILE_NAMES,
  SECURITY_BLOCKLIST_FEED_MD5_SUFFIX,
  SecurityBlocklistFeedFormat,
} from "./SecurityBlocklistFeedFormat";
import { renderSecurityBlocklistFeedSnippet } from "./SecurityBlocklistFeedSnippets";

/*
 * HOW EACH FIREWALL AND PROXY READS A BLOCKLIST FEED (#10345): the file it
 * fetches, how it sends the secret, how often to have it fetch, and the
 * steps in its own console, each checked against the vendor's own
 * documentation (the URL beside each). The feed's page shows these, and
 * the docs page says the same at length (telemetry/blocklist-feeds).
 *
 * How the secret is sent follows what each firewall documents: a username
 * and password (basic auth) where it takes them - Palo Alto (over HTTPS
 * only), FortiGate, Check Point - a bearer token from a host's script, and
 * the secret in the URL's path for the firewalls that document no way to
 * send one: Cisco's management center, OPNsense and pfSense.
 *
 * The steps are English sentences the Dashboard looks up in the reader's
 * language, with {{url}}, {{md5Url}}, {{username}} and {{minutes}} filled
 * in. A firewall's own menu names stay as its console writes them.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales, as
 * SecurityBlock.ts does: the extractor reads this file for what it marks.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

export enum SecurityBlocklistFeedAuthentication {
  // A username and the secret as its password (RFC 7617).
  Basic = "Basic",
  // Authorization: Bearer <secret>.
  Bearer = "Bearer",
  // The secret in the URL's path.
  PathSecret = "PathSecret",
}

/*
 * The username a firewall sends with the secret. OneUptime reads only the
 * password, so any name works; this one says whose list it is.
 */
export const SECURITY_BLOCKLIST_FEED_BASIC_USERNAME: string = "oneuptime";

// What stands in for a secret OneUptime no longer shows: in a URL, a script, a password field.
export const SECURITY_BLOCKLIST_FEED_SECRET_PLACEHOLDER: string =
  "YOUR_FEED_SECRET";

export interface SecurityBlocklistFeedSetup {
  firewall: SecurityBlocklistFeedFirewall;
  format: SecurityBlocklistFeedFormat;
  // The plain list with a "# " line of why before each entry.
  withComments: boolean;
  // Cisco's MD5 URL too.
  withMd5: boolean;
  authentication: SecurityBlocklistFeedAuthentication;
  // What a feed for it serves, when its maker documents one family only.
  family: SecurityBlocklistFeedFamily;
  /*
   * How often to have it fetch the feed, in minutes - or null when it
   * cannot fetch that often, which its note says.
   */
  refreshInMinutes: number | null;
  steps: Array<string>;
  // What it cannot do that matters for blocks during an attack, when anything.
  note: string | null;
  // The vendor's documentation the steps follow.
  documentationUrl: string;
  // The section of the docs page for it.
  docsAnchor: string;
  // Whether a script on a host applies it (SecurityBlocklistFeedSnippets).
  hasSnippet: boolean;
}

export const SECURITY_BLOCKLIST_FEED_SETUPS: Readonly<
  Record<SecurityBlocklistFeedFirewall, SecurityBlocklistFeedSetup>
> = {
  [SecurityBlocklistFeedFirewall.PaloAlto]: {
    firewall: SecurityBlocklistFeedFirewall.PaloAlto,
    format: SecurityBlocklistFeedFormat.Plain,
    // Palo Alto documents a comment only after an address, never a line of its own.
    withComments: false,
    withMd5: false,
    authentication: SecurityBlocklistFeedAuthentication.Basic,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES,
    steps: [
      translationKey(
        "In the web interface, go to Objects > External Dynamic Lists and click Add.",
      ),
      translationKey("Set Type to IP List and Source to {{url}}."),
      translationKey(
        "Turn on Client Authentication, with Username {{username}} and the feed's secret as the Password.",
      ),
      translationKey(
        "Set Check for updates to Every Five Minutes, click OK and commit.",
      ),
      translationKey(
        "In Policies > Security, add a rule with the list as its Source Address and the action Deny, and commit.",
      ),
    ],
    note: translationKey(
      "Palo Alto holds 30 custom lists at most, and 50,000 addresses in all (150,000 on the PA-3200, PA-5200 and PA-7000 Series).",
    ),
    documentationUrl:
      "https://docs.paloaltonetworks.com/pan-os/11-1/pan-os-admin/policy/use-an-external-dynamic-list-in-policy/configure-the-firewall-to-access-an-external-dynamic-list",
    docsAnchor: "palo-alto-networks",
    hasSnippet: false,
  },
  [SecurityBlocklistFeedFirewall.FortiGate]: {
    firewall: SecurityBlocklistFeedFirewall.FortiGate,
    format: SecurityBlocklistFeedFormat.Plain,
    withComments: true,
    withMd5: false,
    authentication: SecurityBlocklistFeedAuthentication.Basic,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES,
    steps: [
      translationKey(
        "Go to Security Fabric > External Connectors, click Create New and choose IP Address under Threat Feeds.",
      ),
      translationKey("Set URL of external resource to {{url}}."),
      translationKey(
        "Turn on HTTP basic authentication, with Username {{username}} and the feed's secret as the Password.",
      ),
      translationKey("Set Refresh Rate to {{minutes}} minutes and click OK."),
      translationKey(
        "In Policy & Objects > Firewall Policy, use the feed as a policy's Source and set Action to DENY.",
      ),
    ],
    note: translationKey(
      "FortiGate holds 300,000 addresses at most, across all its threat feeds.",
    ),
    documentationUrl:
      "https://docs.fortinet.com/document/fortigate/7.6.0/administration-guide/891236/ip-address-threat-feed",
    docsAnchor: "fortigate",
    hasSnippet: false,
  },
  [SecurityBlocklistFeedFirewall.CheckPoint]: {
    firewall: SecurityBlocklistFeedFirewall.CheckPoint,
    format: SecurityBlocklistFeedFormat.Plain,
    // A Network Feed ignores lines that start with "#" by default.
    withComments: true,
    withMd5: false,
    authentication: SecurityBlocklistFeedAuthentication.Basic,
    // Check Point documents IPv4 addresses for a network feed, and no IPv6.
    family: SecurityBlocklistFeedFamily.IPv4,
    refreshInMinutes: SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES,
    steps: [
      translationKey(
        "In SmartConsole, open the Object Explorer and choose New > More > Network Object > Network Feed.",
      ),
      translationKey(
        "Set Feed URL to {{url}}, Format to Flat list and Data type to IP Address.",
      ),
      translationKey(
        "Under Advanced Settings, enter Username {{username}} and the feed's secret as the password for Authentication.",
      ),
      translationKey(
        "Set Check feed interval to {{minutes}} minutes, click Test Feed, then OK.",
      ),
      translationKey(
        "Use the feed as the Source of an Access Control rule whose action is Drop, and install the policy.",
      ),
    ],
    note: translationKey(
      "Check Point documents IPv4 addresses for a network feed, so a feed for it serves IPv4. It holds 50,000 addresses at most.",
    ),
    documentationUrl:
      "https://sc1.checkpoint.com/documents/R82/WebAdminGuides/EN/CP_R82_SecurityManagement_AdminGuide/Content/Topics-SECMG/Network_Feed.htm",
    docsAnchor: "check-point",
    hasSnippet: false,
  },
  [SecurityBlocklistFeedFirewall.Cisco]: {
    firewall: SecurityBlocklistFeedFirewall.Cisco,
    format: SecurityBlocklistFeedFormat.Plain,
    withComments: true,
    withMd5: true,
    // Cisco documents no way to send credentials with a custom feed.
    authentication: SecurityBlocklistFeedAuthentication.PathSecret,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES,
    steps: [
      translationKey(
        "In the management center, choose Objects > Security Intelligence and click Add Network Lists and Feeds.",
      ),
      translationKey(
        "Set Type to Feed, Feed URL to {{url}} and MD5 URL to {{md5Url}}.",
      ),
      translationKey("Set Update Frequency to {{minutes}} minutes and save."),
      translationKey(
        "In your access control policy, open Security Intelligence > Networks, add the feed to the Block List, then save and deploy.",
      ),
    ],
    note: translationKey(
      "Cisco's managed devices take updates from the management center every 30 minutes, so a block reaches them up to 30 minutes after the feed is fetched.",
    ),
    documentationUrl:
      "https://docs.manage.security.cisco.com/cdfmc/t_creating_security_intelligence_feeds.html",
    docsAnchor: "cisco-secure-firewall",
    hasSnippet: false,
  },
  [SecurityBlocklistFeedFirewall.OPNsense]: {
    firewall: SecurityBlocklistFeedFirewall.OPNsense,
    format: SecurityBlocklistFeedFormat.Plain,
    withComments: true,
    withMd5: false,
    // OPNsense's docs document no credentials for a URL table.
    authentication: SecurityBlocklistFeedAuthentication.PathSecret,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: null,
    steps: [
      translationKey(
        "Go to Firewall > Aliases and add an alias of type URL Table (IPs).",
      ),
      translationKey(
        "Set Content to {{url}} and Refresh Frequency to 0 days and 1 hour.",
      ),
      translationKey(
        "Save and Apply, then in Firewall > Rules add a rule that blocks traffic whose Source is the alias.",
      ),
    ],
    note: translationKey(
      "OPNsense fetches a URL table every hour at most, so OneUptime confirms its blocks only for ten minutes after each fetch. It still blocks them in between.",
    ),
    documentationUrl: "https://docs.opnsense.org/manual/aliases.html",
    docsAnchor: "opnsense",
    hasSnippet: false,
  },
  [SecurityBlocklistFeedFirewall.PfSense]: {
    firewall: SecurityBlocklistFeedFirewall.PfSense,
    format: SecurityBlocklistFeedFormat.Plain,
    withComments: false,
    withMd5: false,
    // pfSense documents no credentials for a URL table.
    authentication: SecurityBlocklistFeedAuthentication.PathSecret,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: null,
    steps: [
      translationKey(
        "Go to Firewall > Aliases, click Add and choose URL Table (IPs).",
      ),
      translationKey("Enter {{url}} and set it to refresh every 1 day."),
      translationKey(
        "Save and Apply Changes, then in Firewall > Rules add a rule with the alias as its Source and the action Block.",
      ),
    ],
    note: translationKey(
      "pfSense fetches a URL table once a day at most: too slow to block an attack while it happens. Use it for long blocks, beside a firewall that fetches every few minutes.",
    ),
    documentationUrl:
      "https://docs.netgate.com/pfsense/en/latest/firewall/aliases-types.html",
    docsAnchor: "pfsense",
    hasSnippet: false,
  },
  [SecurityBlocklistFeedFirewall.Nftables]: {
    firewall: SecurityBlocklistFeedFirewall.Nftables,
    format: SecurityBlocklistFeedFormat.Nftables,
    withComments: false,
    withMd5: false,
    authentication: SecurityBlocklistFeedAuthentication.Bearer,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: 1,
    steps: [
      translationKey(
        "As root, run the commands below once: they make a table with two sets, the rule that drops what they hold, and a script.",
      ),
      translationKey(
        "The script runs every minute from cron and loads the feed only when the list changed, in one transaction.",
      ),
    ],
    note: null,
    documentationUrl: "https://wiki.nftables.org/wiki-nftables/index.php/Sets",
    docsAnchor: "nftables",
    hasSnippet: true,
  },
  [SecurityBlocklistFeedFirewall.Ipset]: {
    firewall: SecurityBlocklistFeedFirewall.Ipset,
    format: SecurityBlocklistFeedFormat.Plain,
    withComments: false,
    withMd5: false,
    authentication: SecurityBlocklistFeedAuthentication.Bearer,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: 1,
    steps: [
      translationKey(
        "As root, run the commands below once: they make two sets, the iptables and ip6tables rules in the raw table that drop what they hold, and a script.",
      ),
      translationKey(
        "The script runs every minute from cron, fills new sets when the list changed and swaps them in, so the rules never see a set half full.",
      ),
    ],
    note: null,
    documentationUrl: "https://ipset.netfilter.org/ipset.man.html",
    docsAnchor: "ipset-and-iptables",
    hasSnippet: true,
  },
  [SecurityBlocklistFeedFirewall.Nginx]: {
    firewall: SecurityBlocklistFeedFirewall.Nginx,
    format: SecurityBlocklistFeedFormat.Nginx,
    withComments: false,
    withMd5: false,
    authentication: SecurityBlocklistFeedAuthentication.Bearer,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: 1,
    steps: [
      translationKey(
        "Add the include line to the server block of the site to protect, then run the commands below once, as root.",
      ),
      translationKey(
        "The script runs every minute from cron and, when the list changed, checks the configuration and reloads nginx.",
      ),
    ],
    note: null,
    documentationUrl:
      "https://nginx.org/en/docs/http/ngx_http_access_module.html",
    docsAnchor: "nginx",
    hasSnippet: true,
  },
  [SecurityBlocklistFeedFirewall.HAProxy]: {
    firewall: SecurityBlocklistFeedFirewall.HAProxy,
    format: SecurityBlocklistFeedFormat.Plain,
    withComments: false,
    withMd5: false,
    authentication: SecurityBlocklistFeedAuthentication.Bearer,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: 1,
    steps: [
      translationKey(
        "As root, create the list file, add the two lines shown to haproxy.cfg and reload HAProxy once: its Runtime API updates only a list HAProxy already reads.",
      ),
      translationKey(
        "Then run the rest of the commands. The script runs every minute from cron and, when the list changed, writes the file and updates HAProxy through its Runtime API, with no reload.",
      ),
    ],
    note: null,
    documentationUrl: "https://docs.haproxy.org/3.4/management.html#9.3",
    docsAnchor: "haproxy",
    hasSnippet: true,
  },
  [SecurityBlocklistFeedFirewall.WindowsFirewall]: {
    firewall: SecurityBlocklistFeedFirewall.WindowsFirewall,
    format: SecurityBlocklistFeedFormat.Plain,
    withComments: false,
    withMd5: false,
    authentication: SecurityBlocklistFeedAuthentication.Bearer,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: 1,
    steps: [
      translationKey(
        "In PowerShell as an administrator, run the commands below once: they save a script and register a task that runs it every minute.",
      ),
      translationKey(
        "The script keeps inbound rules that block every address on the list, 1,000 to a rule: OneUptime blocklist 0, OneUptime blocklist 1 and on.",
      ),
    ],
    note: null,
    documentationUrl:
      "https://learn.microsoft.com/en-us/powershell/module/netsecurity/set-netfirewallrule",
    docsAnchor: "windows-firewall",
    hasSnippet: true,
  },
  [SecurityBlocklistFeedFirewall.Other]: {
    firewall: SecurityBlocklistFeedFirewall.Other,
    format: SecurityBlocklistFeedFormat.Plain,
    withComments: false,
    withMd5: false,
    authentication: SecurityBlocklistFeedAuthentication.Basic,
    family: SecurityBlocklistFeedFamily.Both,
    refreshInMinutes: SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES,
    steps: [
      translationKey(
        "Point your firewall or proxy at {{url}}: one address or range a line.",
      ),
      translationKey(
        "Send the feed's secret as the password of basic auth, with any username, or as a bearer token.",
      ),
      translationKey(
        "Have it fetch the list every {{minutes}} minutes or more often: a block counts as enforced there for ten minutes after each fetch.",
      ),
    ],
    note: null,
    documentationUrl: "https://datatracker.ietf.org/doc/html/rfc7617",
    docsAnchor: "other-firewalls",
    hasSnippet: false,
  },
};

export function getSecurityBlocklistFeedSetup(
  firewall: SecurityBlocklistFeedFirewall | string | null | undefined,
): SecurityBlocklistFeedSetup {
  return (
    SECURITY_BLOCKLIST_FEED_SETUPS[firewall as SecurityBlocklistFeedFirewall] ||
    SECURITY_BLOCKLIST_FEED_SETUPS[SecurityBlocklistFeedFirewall.Other]
  );
}

// What a feed made for a firewall serves: the family its maker documents, or both.
export function getSecurityBlocklistFeedDefaultFamily(
  firewall: SecurityBlocklistFeedFirewall | string | null | undefined,
): SecurityBlocklistFeedFamily {
  return getSecurityBlocklistFeedSetup(firewall).family;
}

// The name a feed made for a firewall gets when nobody gives one: "FortiGate feed".
export function getSecurityBlocklistFeedDefaultName(
  firewall: SecurityBlocklistFeedFirewall | string | null | undefined,
  firewallNames: Readonly<Record<SecurityBlocklistFeedFirewall, string>>,
): string {
  const setup: SecurityBlocklistFeedSetup =
    getSecurityBlocklistFeedSetup(firewall);

  return setup.firewall === SecurityBlocklistFeedFirewall.Other
    ? "Blocklist feed"
    : `${firewallNames[setup.firewall]} feed`;
}

export interface SecurityBlocklistFeedUrls {
  // The URL the firewall reads.
  url: string;
  // Cisco's MD5 URL, for the setups that use one.
  md5Url: string | null;
}

/*
 * The URLs a firewall is given: the feed's file under the server's API
 * (https://oneuptime.com/api/blocklist-feed/<feed>/blocklist.txt), with
 * the secret in the path for a firewall that sends it no other way - or
 * the placeholder, once OneUptime no longer shows it.
 */
export function buildSecurityBlocklistFeedUrls(data: {
  apiUrl: string;
  feedId: string;
  setup: SecurityBlocklistFeedSetup;
  secret: string | null;
}): SecurityBlocklistFeedUrls {
  const base: string = `${data.apiUrl.replace(/\/+$/, "")}/blocklist-feed/${data.feedId}`;
  const secretSegment: string =
    data.setup.authentication === SecurityBlocklistFeedAuthentication.PathSecret
      ? `/${data.secret || SECURITY_BLOCKLIST_FEED_SECRET_PLACEHOLDER}`
      : "";
  const file: string = SECURITY_BLOCKLIST_FEED_FILE_NAMES[data.setup.format];
  const query: string = data.setup.withComments
    ? `?${SECURITY_BLOCKLIST_FEED_COMMENTS_QUERY}`
    : "";

  return {
    url: `${base}${secretSegment}/${file}${query}`,
    md5Url: data.setup.withMd5
      ? `${base}${secretSegment}/${file}${SECURITY_BLOCKLIST_FEED_MD5_SUFFIX}${query}`
      : null,
  };
}

// A setup's script, filled in for one feed; null for a firewall set up in its console.
export function buildSecurityBlocklistFeedSnippet(data: {
  setup: SecurityBlocklistFeedSetup;
  url: string;
  secret: string | null;
}): string | null {
  if (!data.setup.hasSnippet) {
    return null;
  }

  return renderSecurityBlocklistFeedSnippet({
    firewall: data.setup.firewall,
    url: data.url,
    secret: data.secret || SECURITY_BLOCKLIST_FEED_SECRET_PLACEHOLDER,
  });
}
