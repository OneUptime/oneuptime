import IP from "Common/Types/IP/IP";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * An IP allowlist: the ipWhitelist column a status page and a dashboard
 * each have, one entry a line, edited under Advanced on the page that says
 * who can see them (a status page's Access, a dashboard's Sharing).
 *
 * The server enforces it whenever the column holds anything at all
 * (StatusPageService.hasReadAccess, DashboardService.hasReadAccess, both
 * through IP.isInWhitelist), and lets a visitor in whose address is one of
 * its lines or falls in one of its IPv4 ranges. It skips blank lines, and
 * lines it cannot read. These read the column the same way, so both pages
 * refuse what the server would quietly skip.
 *
 * Kept free of React, so the pages and the tests share these exact
 * strings. Every sentence is wrapped in translationKey() so
 * npm run i18n:extract finds it.
 */

export const IpAllowlistCopy: {
  title: string;
  editButton: string;
  fieldDescription: string;
  blank: string;
  invalidEntry: string;
} = {
  title: translationKey("IP Allowlist"),
  editButton: translationKey("Edit IP Allowlist"),
  fieldDescription: translationKey(
    "One per line: an IPv4 or IPv6 address, or an IPv4 range, for example 203.0.113.7 or 10.0.0.0/8.",
  ),
  blank: translationKey(
    "Enter at least one IP address or range, or clear the list to allow every address.",
  ),
  invalidEntry: translationKey(
    "{{entry}} is not an IP address or an IPv4 range such as 10.0.0.0/8.",
  ),
};

// The column both models keep the list in.
export const IP_ALLOWLIST_COLUMN: string = "ipWhitelist";

// Whether the server enforces the list: the column holds anything at all.
export const isIpAllowlistInForce: (
  ipAllowlist: string | null | undefined,
) => boolean = (ipAllowlist: string | null | undefined): boolean => {
  return Boolean(ipAllowlist && ipAllowlist.length > 0);
};

// The list's entries as the server reads them: trimmed, blank lines left out.
export const getIpAllowlistEntries: (
  ipAllowlist: string | null | undefined,
) => Array<string> = (
  ipAllowlist: string | null | undefined,
): Array<string> => {
  return (ipAllowlist || "")
    .split("\n")
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    });
};

const IPV4_PREFIX_PATTERN: RegExp = /^\d{1,2}$/;

/*
 * Whether the server can match an entry: an IPv4 or IPv6 address, or an IPv4
 * range with a /0 to /32 prefix. It has no IPv6 ranges.
 */
export const isIpAllowlistEntryValid: (entry: string) => boolean = (
  entry: string,
): boolean => {
  if (IP.isIP(entry)) {
    return true;
  }

  const parts: Array<string> = entry.split("/");

  if (parts.length !== 2) {
    return false;
  }

  const network: string = parts[0] || "";
  const prefix: string = parts[1] || "";

  if (
    !IP.isIP(network) ||
    !IP.fromString(network).isIPv4() ||
    !IPV4_PREFIX_PATTERN.test(prefix)
  ) {
    return false;
  }

  return parseInt(prefix, 10) <= 32;
};

/*
 * Why the list cannot be saved as typed, in the reader's language, or null.
 * The server skips a line it cannot read, so a typo would quietly leave an
 * address out, and a list of blank lines would let nobody in at all.
 */
export const getIpAllowlistProblem: (
  ipAllowlist: string | null | undefined,
) => string | null = (
  ipAllowlist: string | null | undefined,
): string | null => {
  if (!isIpAllowlistInForce(ipAllowlist)) {
    return null;
  }

  const entries: Array<string> = getIpAllowlistEntries(ipAllowlist);

  if (entries.length === 0) {
    return translateTemplate(IpAllowlistCopy.blank);
  }

  const invalid: string | undefined = entries.find((entry: string): boolean => {
    return !isIpAllowlistEntryValid(entry);
  });

  if (invalid !== undefined) {
    return translateTemplate(IpAllowlistCopy.invalidEntry, {
      entry: invalid,
    });
  }

  return null;
};

export default IpAllowlistCopy;
