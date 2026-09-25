import { normalizeReverseDnsName } from "./ReverseDnsNameUtil";

/*
 * What a NetBIOS name is allowed to become, shared by the probe that asks for
 * it and by every reader of the value it stored (OneUptime issue #3677).
 *
 * The problem this solves: a discovered host with no PTR record and no SNMP
 * has nothing to be called but its address, and on a Windows-heavy estate
 * that is most of the Review dialog. A NetBIOS node status (NBSTAT) query to
 * UDP 137 is the one naming method that works across routed networks and from
 * a probe on Kubernetes pod networking, so the probe asks it.
 *
 * The answer is SELF-REPORTED by the scanned host. Unlike a PTR record, which
 * is at least published by whoever runs DNS for the subnet, a NetBIOS name is
 * whatever the machine on the other end of the datagram chooses to say — and
 * a discovery scan is routinely pointed at a subnet nobody in the project
 * administers. The value goes on to be rendered in the Review dialog and to
 * become a NetworkDevice's name and slug, so it is normalised HERE, by one pure
 * function both sides call, and trusted nowhere else.
 *
 * Both sides, for the same reason as ReverseDnsNameUtil: `discoveredDevices`
 * is jsonb written verbatim from the probe's payload, so the server's copy of
 * these rules is what protects results stored by a probe of a different
 * version, and rows written through the API by hand.
 */

/*
 * RFC 1001/1002: a NetBIOS name is 16 bytes, the last of which is the service
 * suffix (<00> workstation, <20> file server, ...). Fifteen is what is left for
 * the name the operator would recognise.
 */
export const MAX_NETBIOS_NAME_LENGTH: number = 15;

/*
 * The browser-election pseudo-name. On the wire it is "\x01\x02__MSBROWSE__\x02"
 * registered as a GROUP name with suffix <01>, and it names no machine at all:
 * every master browser on a segment registers it. The control bytes already
 * fail the label rule below; the bare spelling is refused explicitly as well,
 * because a responder that strips the control bytes would otherwise hand us a
 * perfectly label-shaped "__MSBROWSE__" to name a device after.
 */
const BROWSER_ELECTION_PSEUDO_NAME: string = "__msbrowse__";

// Letters are what separate a name from a restated number (see below).
const LETTER_PATTERN: RegExp = /[A-Za-z]/;

/*
 * Padding a NetBIOS responder may leave on the end of the 15-byte field.
 * RFC 1001 pads with spaces; some embedded stacks pad with NULs instead, and a
 * few mix the two. Any other whitespace counts too, so "HOST\u0000\t" is
 * treated the same as "HOST \u0000" rather than failing on the order of its
 * junk. Removed from the END only (leading whitespace is trimmed separately):
 * a NUL or space in the MIDDLE of the field means the bytes were not a name,
 * and the label rule refuses them.
 */
function isTrailingPadding(character: string): boolean {
  return character === "\u0000" || character.trim() === "";
}

/*
 * A manual scan rather than a `/[ \0]+$/` replace. The regex form backtracks
 * quadratically on a long run of padding followed by one non-padding
 * character, and on the server side this function reads jsonb values of any
 * length — a hostile row must not be able to turn a render into a busy loop.
 */
function stripTrailingPadding(value: string): string {
  let end: number = value.length;

  while (end > 0 && isTrailingPadding(value.charAt(end - 1))) {
    end--;
  }

  return value.substring(0, end);
}

/**
 * The name a NetBIOS answer may be stored and displayed as, or undefined when
 * the answer is not usable as one.
 *
 * Accepts `unknown` rather than `string` on purpose: on the server the input is
 * read out of a jsonb column, and "the probe sent a number" has to return
 * undefined rather than throw inside a render.
 *
 * The LABEL rule is exactly ReverseDnsNameUtil's — letters, digits, underscore
 * and hyphen, with no leading or trailing hyphen — and is applied by calling
 * that normaliser on a value already known to contain no dot, rather than by a
 * second copy of the pattern. Two copies of a validation regex drift; one
 * called twice cannot. A single dot-free label that passes
 * normalizeReverseDnsName unchanged is precisely one label that passes
 * LABEL_PATTERN and is not all digits.
 *
 * Case is DISCARDED, unlike a PTR name's. NetBIOS upper-cases names on the
 * wire, so "WORKSTATION01" says nothing about how its owner writes it;
 * lower case matches the DNS names the rest of the estate shows, and device
 * name uniqueness ignores case anyway.
 */
export function normalizeNetbiosName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const candidate: string = stripTrailingPadding(value).trim();

  if (!candidate || candidate.length > MAX_NETBIOS_NAME_LENGTH) {
    return undefined;
  }

  /*
   * NetBIOS names have no dots. Refused BEFORE the label check, which would
   * otherwise accept "host.corp" as a two-label DNS name — and silently strip a
   * trailing root dot off "HOST." into a name the host never reported.
   */
  if (candidate.includes(".")) {
    return undefined;
  }

  /*
   * Must come back UNCHANGED. normalizeReverseDnsName trims and drops a root
   * dot; neither can apply here (already trimmed, no dots), so any difference
   * at all means the value was rewritten, and a rewritten name is an invented
   * one.
   */
  if (normalizeReverseDnsName(candidate) !== candidate) {
    return undefined;
  }

  /*
   * At least one LETTER, which is stricter than the DNS rule's "not every label
   * numeric": "10-18-167" and "____" are single labels that pass it but read
   * as an address or as nothing, and a name is only worth showing when it is
   * more useful than the address it replaces.
   */
  if (!LETTER_PATTERN.test(candidate)) {
    return undefined;
  }

  const lowerCased: string = candidate.toLowerCase();

  if (lowerCased === BROWSER_ELECTION_PSEUDO_NAME) {
    return undefined;
  }

  return lowerCased;
}

/*
 * One octet of a dotted quad in the only spelling the probe's sweep reports:
 * ASCII digits, no leading zero. The 0-255 bound is checked on the number.
 */
const IPV4_OCTET_PATTERN: RegExp = /^(?:0|[1-9][0-9]{0,2})$/;

/**
 * True exactly for the addresses the probe's NetBIOS lookup would send a
 * query to: a strict dotted-quad IPv4 literal in 10.0.0.0/8, 172.16.0.0/12,
 * 192.168.0.0/16 or the 100.64.0.0/10 CGNAT range (OneUptime issue #3916).
 *
 * The probe's own rule is isNetbiosQueryAddressAllowed
 * (Probe/Utils/Discovery/NetbiosNameResolver.ts), which refuses every other
 * address whoever asks. This is the dashboard's copy of it, for the Review
 * dialog: an unnamed host on a scan with NetBIOS off used to be told that
 * "NetBIOS lookup asks Windows hosts for their own name" whatever its
 * address, so an operator scanning public space turned NetBIOS on, rescanned,
 * and got "not asked. Only private addresses are asked." — advice whose only
 * effect was a different way of saying no name.
 *
 * A copy rather than an import, because Common is bundled into the dashboard
 * and the probe's rule leans on Node's `net.isIPv4`. The strict form below is
 * what `net.isIPv4` accepts (no leading zeros, no whitespace, no IPv6 or
 * IPv4-mapped IPv6). The probe's NetbiosEligibilityParity test holds the two
 * to the same answer on every range edge, on a sweep of every first and
 * second octet, and on the malformed spellings, so changing one without the
 * other fails it.
 *
 * `unknown`, like normalizeNetbiosName, because the dashboard reads the
 * address out of jsonb.
 */
export function isNetbiosQueryableIPv4Address(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const parts: Array<string> = value.split(".");

  if (parts.length !== 4) {
    return false;
  }

  const octets: Array<number> = [];

  for (const part of parts) {
    if (!IPV4_OCTET_PATTERN.test(part)) {
      return false;
    }

    const octet: number = parseInt(part, 10);

    if (octet > 255) {
      return false;
    }

    octets.push(octet);
  }

  const first: number = octets[0]!;
  const second: number = octets[1]!;

  return (
    // 10.0.0.0/8, RFC 1918.
    first === 10 ||
    // 172.16.0.0/12, RFC 1918: second octet 16-31.
    (first === 172 && second >= 16 && second <= 31) ||
    // 192.168.0.0/16, RFC 1918.
    (first === 192 && second === 168) ||
    // 100.64.0.0/10, RFC 6598 shared/CGNAT space: second octet 64-127.
    (first === 100 && second >= 64 && second <= 127)
  );
}

export default normalizeNetbiosName;
