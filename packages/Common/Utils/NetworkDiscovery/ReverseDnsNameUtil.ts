/*
 * What a PTR record is allowed to become, shared by the probe that performs
 * the lookup and by every reader of the name it stored (OneUptime issue
 * #3529).
 *
 * A discovered host's `dnsHostname` is the ONLY field in a scan result whose
 * value is chosen by the scanned network rather than by OneUptime or by the
 * operator: it is whatever a PTR record on some resolver says, and a
 * discovery scan is routinely pointed at a subnet nobody in the project
 * administers. That value then becomes a NetworkDevice's name, its slug, and
 * a line in the Review dialog — so it is normalised HERE, once, by a pure
 * function both sides call, rather than trusted anywhere.
 *
 * Normalising on the probe alone would not be enough. `discoveredDevices` is
 * jsonb written verbatim from the probe's payload (ProbeIngest/
 * DiscoveryScan.ts), so the server's own copy of these rules is what holds
 * for results stored by a probe running a different version, and for rows
 * hand-written through the API. Normalising on the server alone would not be
 * enough either: the probe should not spend a scan's storage on names it
 * knows will be discarded. Both call this.
 */

/*
 * A DNS name is at most 255 octets on the wire; the presentation form tops
 * out at 253 characters once the length prefixes and root label are removed.
 * NetworkDevice.name is varchar(100) and DiscoveredDeviceBuilder clamps to 80
 * for the slug's sake, so this ceiling never decides a device name on its own
 * — it is here to reject a value that was never a DNS name to begin with.
 */
export const MAX_REVERSE_DNS_NAME_LENGTH: number = 253;

// RFC 1035 section 2.3.4: labels are 63 octets or fewer.
export const MAX_REVERSE_DNS_LABEL_LENGTH: number = 63;

/*
 * One label: letters, digits, hyphen — plus underscore, which is not legal in
 * a hostname but IS common in the wild (Windows/DHCP-registered names, and
 * plenty of hand-authored reverse zones), and rejecting it would throw away
 * real names for a standards point nothing here depends on. A hyphen may not
 * lead or trail.
 *
 * Everything else is refused, and the refusals are the point: a name is
 * rendered in the dashboard, slugified into a URL, and written to a varchar.
 * Whitespace, quotes, angle brackets, slashes, control characters and
 * non-ASCII all mean the answer was not a hostname, and a scan of an
 * untrusted subnet is exactly where that shows up.
 */
const LABEL_PATTERN: RegExp = /^[A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?$/;

/*
 * The reverse-lookup zones themselves. A resolver that echoes the query name
 * back — some do, on certain failure modes — hands us
 * "51.166.18.10.in-addr.arpa", which passes every other rule here and is a
 * strictly worse device name than the address it was derived from.
 */
const REVERSE_LOOKUP_ZONES: Array<string> = ["in-addr.arpa", "ip6.arpa"];

/*
 * True when every label is digits — "10.18.166.51", but also "51" and "1.2".
 *
 * This is what keeps a PTR that merely restates the address out of the name
 * field. It matters more than it looks: the whole point of the feature is
 * that a name is more useful than an address, so a "name" that IS the address
 * must fall through to the address rather than be presented as a resolved
 * hostname the operator can trust. Checked as "all labels numeric" rather
 * than as a dotted-quad regex so "51" and "10.18" are caught too.
 */
const NUMERIC_LABEL_PATTERN: RegExp = /^[0-9]+$/;

function isAllNumericLabels(labels: Array<string>): boolean {
  return labels.every((label: string) => {
    return NUMERIC_LABEL_PATTERN.test(label);
  });
}

/**
 * The hostname a PTR answer may be stored and displayed as, or undefined when
 * the answer is not usable as one.
 *
 * Accepts `unknown` rather than `string` on purpose: on the server side the
 * input is a value read out of a jsonb column, and "the probe sent a number"
 * is a case that has to return undefined rather than throw inside a render.
 *
 * Case is PRESERVED. It is whatever the reverse zone was authored with, which
 * is as close to the operator's intent as this data gets, and DNS's own
 * case-insensitivity is not a reason to discard it.
 */
export function normalizeReverseDnsName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed: string = value.trim();

  if (!trimmed) {
    return undefined;
  }

  /*
   * Exactly ONE trailing dot is dropped — the root label of a fully qualified
   * name, which some resolvers include and some do not. A second one leaves
   * an empty final label, which the per-label check below refuses; that is
   * deliberate, because "foo.." is malformed rather than "foo." with a typo,
   * and silently repairing it would be inventing a name.
   */
  const withoutRootLabel: string = trimmed.endsWith(".")
    ? trimmed.substring(0, trimmed.length - 1)
    : trimmed;

  if (!withoutRootLabel) {
    return undefined;
  }

  if (withoutRootLabel.length > MAX_REVERSE_DNS_NAME_LENGTH) {
    return undefined;
  }

  const lowerCased: string = withoutRootLabel.toLowerCase();

  for (const zone of REVERSE_LOOKUP_ZONES) {
    /*
     * The apex is checked as well as the suffix. `in-addr.arpa` on its own is
     * a legal hostname string that passes every other rule here, and it is
     * what a resolver echoing a truncated query name hands back — a strictly
     * worse label for a device than the address it was derived from.
     */
    if (lowerCased === zone || lowerCased.endsWith(`.${zone}`)) {
      return undefined;
    }
  }

  const labels: Array<string> = withoutRootLabel.split(".");

  for (const label of labels) {
    if (!label || label.length > MAX_REVERSE_DNS_LABEL_LENGTH) {
      return undefined;
    }

    if (!LABEL_PATTERN.test(label)) {
      return undefined;
    }
  }

  if (isAllNumericLabels(labels)) {
    return undefined;
  }

  return withoutRootLabel;
}

export default normalizeReverseDnsName;
