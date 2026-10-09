import {
  DeviceNameSource,
  readDeviceNameSource,
} from "../../Types/NetworkDevice/DeviceNameSource";
import {
  MAX_NETBIOS_NAME_LENGTH,
  normalizeNetbiosName,
} from "../NetworkDiscovery/NetbiosNameUtil";
import { normalizeReverseDnsName } from "../NetworkDiscovery/ReverseDnsNameUtil";
import { getShortHostname } from "../NetworkDiscovery/ShortHostnameUtil";

/*
 * What a network device is called: ONE rule, used everywhere a device gets a
 * name it was not typed (OneUptime issue #4518).
 *
 * The rule, best first:
 *
 *   1. The device's own name — the name the people who run it use:
 *        a. its SNMP system name (sysName), configured on the device;
 *        b. its NetBIOS name, the computer name a Windows or Samba host
 *           reports for itself.
 *   2. Its DNS name — the reverse-DNS (PTR) record for its address, cut to
 *      its first label when short names are asked for.
 *   3. Its IP address.
 *
 * The address and the DNS name are never lost by not being the name: a device
 * keeps the address it is polled at, and the DNS name, as attributes of their
 * own (NetworkDevice.hostname and NetworkDevice.dnsName).
 *
 * WHY THE DEVICE'S OWN NAME BEATS DNS. Issue #4518 is a Windows estate whose
 * kitchen displays are called WB0024KDS03 by everyone who runs them, while
 * their reverse zone says wb-0024-kds03.wbhq.com: two names for one machine,
 * and only one of them is the machine's. A PTR record is a name someone
 * published for an ADDRESS — on a DHCP range it follows the lease, not the
 * machine, and a stale zone keeps naming a machine that moved — while the
 * device's own name is what it answers to wherever it is. Before #4518 a
 * NetBIOS name ranked below the PTR name, so a host DNS named never showed
 * the name its owners use, and the probe never even asked it.
 *
 * WHY SNMP BEFORE NETBIOS. Both are the device's own, but a sysName is
 * configured on purpose by whoever runs the device, and is not cut to fifteen
 * characters; on a Windows host with an SNMP agent the two are the same name
 * anyway.
 *
 * ONE EXCEPTION, AND IT IS NOT A JUDGEMENT CALL. NetBIOS truncates a computer
 * name to fifteen characters, so "wb-0024-kitchen-display-03" answers NBSTAT
 * as WB-0024-KITCHEN. A fifteen-character NetBIOS name that is the start of
 * the DNS name's first label is that very name with its end cut off, and the
 * DNS name is used instead (isNetbiosNameCutFromDnsName).
 *
 * CASE. Every name keeps the case its source gave it: a sysName as
 * configured, a PTR name as its zone was written, a NetBIOS name as the host
 * reported it — upper case, for Windows, which is how Windows shows its
 * computer names and how its SNMP agent reports them, so a list of Windows
 * hosts reads the same whichever way each one was named. Device names are
 * unique whatever their case, so nothing here can make two names collide that
 * did not already.
 *
 * Pure, and in Common, so the Review dialog, both import paths, the rename of
 * names a later scan improves, and the Inventory all name a device the same
 * way. Every input is `unknown`: these values come out of jsonb and API rows,
 * and "the probe sent a number" has to read as "no name", never as a throw
 * inside a render.
 */

/*
 * What is known about a device's names. Every field is optional and read
 * defensively; a missing or unusable one simply does not name the device.
 */
export interface DeviceNameFacts {
  // The name the device reports over SNMP (sysName).
  systemName?: unknown;
  // The NetBIOS name a Windows or Samba host reports for itself.
  netbiosName?: unknown;
  // The reverse-DNS (PTR) name of its address, normally fully qualified.
  dnsName?: unknown;
  // The address it is reached at.
  address?: unknown;
}

export interface DeviceNameOptions {
  /*
   * Cut a fully qualified name to its first label (OneUptime issue #3678).
   * ON only when exactly `true`: the value comes out of a database row or an
   * API payload, and "true" or 1 must not quietly rename a project's devices.
   */
  useShortNames?: boolean | null | undefined;
}

export interface DeviceNameChoice {
  // The name: shortened when asked for. Never clamped to a column's length.
  name: string;
  // The same name before shortening. Equal to `name` when nothing was cut.
  fullName: string;
  // Where the name came from.
  source: DeviceNameSource;
}

/*
 * Names that name nothing. Agents report these when the device was never
 * given a name of its own — net-snmp on a host whose hostname is unset, the
 * kernel's "(none)", a placeholder an embedded agent fills the field with —
 * and a hundred devices called "localhost" are worse than a hundred devices
 * called by their DNS names or addresses. Compared without case. Kept short
 * and unambiguous on purpose: a factory-default name that IS a name of sorts
 * ("Switch", "Router") is left alone, because a device that has nothing better
 * is easier to find under it than under an address.
 */
const PLACEHOLDER_SYSTEM_NAMES: ReadonlySet<string> = new Set<string>([
  "localhost",
  "localhost.localdomain",
  "localhost4",
  "localhost4.localdomain4",
  "localhost6",
  "localhost6.localdomain6",
  "ip6-localhost",
  "ip6-loopback",
  "(none)",
  "none",
  "(unknown)",
  "unknown",
  "(null)",
  "null",
  "n/a",
  "-",
]);

/*
 * A dotted-quad IPv4 address. A sysName that is an address says nothing the
 * address does not, so the next source gets to name the device instead.
 */
const IPV4_ADDRESS_PATTERN: RegExp = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/*
 * The longest an address can be spelled: an IPv6 address with an IPv4 tail
 * ("ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255") is 45 characters. Checked
 * first, so nothing longer is ever scanned as one.
 */
const MAX_ADDRESS_LITERAL_LENGTH: number = 45;

const IPV6_ADDRESS_CHARACTERS: ReadonlySet<string> = new Set<string>(
  "0123456789abcdefABCDEF:.".split(""),
);

/*
 * True for an IPv4 address, or for something spelled like an IPv6 one: hex
 * digits, colons and dots (an IPv4 tail), with at least two colons. Loose is
 * enough — it only has to recognise that a value is an address, never to
 * validate one. A character scan rather than a pattern with three unbounded
 * runs in it, which would backtrack on a long string of colons.
 */
function isAddressLiteral(value: string): boolean {
  if (value.length > MAX_ADDRESS_LITERAL_LENGTH) {
    return false;
  }

  if (IPV4_ADDRESS_PATTERN.test(value)) {
    return true;
  }

  let colonCount: number = 0;

  for (const character of value) {
    if (!IPV6_ADDRESS_CHARACTERS.has(character)) {
      return false;
    }

    if (character === ":") {
      colonCount++;
    }
  }

  return colonCount >= 2;
}

/*
 * Trailing padding an SNMP agent may leave on a DisplayString: spaces, and
 * NULs from agents that copy a fixed-size buffer. Removed with a manual scan
 * rather than a `/[\s\0]+$/` replace, which backtracks quadratically on a
 * long run of padding followed by one other character; on the server these
 * values are read out of jsonb of any length.
 */
function stripTrailingPadding(value: string): string {
  let end: number = value.length;

  while (end > 0) {
    const character: string = value.charAt(end - 1);

    if (character !== "\u0000" && character.trim() !== "") {
      break;
    }

    end--;
  }

  return value.substring(0, end);
}

/*
 * Any C0 or C1 control character, DEL included. One left in a name after the
 * padding is gone means the bytes were not a name: it would render as a box,
 * break a slug, and could carry a line break into a log.
 */
function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }

  return false;
}

/**
 * The SNMP system name a device may be named by, or undefined when it does
 * not name the device: not text, blank, padding only, carrying a control
 * character, a placeholder such as "localhost", or an IP address.
 *
 * Case is kept, and so is anything else a person may have typed into the
 * device's configuration — spaces, non-ASCII letters, punctuation. A sysName
 * is a display name, not a hostname, and "Büro Switch 2" is a perfectly good
 * one. It is not clamped here: the device builder clamps every name to what
 * the name column and its slug can hold.
 */
export function normalizeSystemName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const candidate: string = stripTrailingPadding(value).trim();

  if (!candidate) {
    return undefined;
  }

  if (hasControlCharacter(candidate)) {
    return undefined;
  }

  if (PLACEHOLDER_SYSTEM_NAMES.has(candidate.toLowerCase())) {
    return undefined;
  }

  if (isAddressLiteral(candidate)) {
    return undefined;
  }

  return candidate;
}

/**
 * True when `netbiosName` is `dnsName`'s first label cut off at NetBIOS's
 * fifteen characters — the same name, with its end missing.
 *
 * Windows derives a computer's NetBIOS name from its hostname by upper-casing
 * it and keeping the first fifteen characters, so a host whose name is longer
 * than that answers NBSTAT with a stump. Only a name exactly fifteen long can
 * be a stump, and only one the DNS label starts with (ignoring case) and runs
 * past. A shorter NetBIOS name is a whole name, even when DNS spells the host
 * differently — that difference is exactly what issue #4518 is about.
 */
export function isNetbiosNameCutFromDnsName(
  netbiosName: string,
  dnsName: string,
): boolean {
  if (netbiosName.length !== MAX_NETBIOS_NAME_LENGTH) {
    return false;
  }

  const firstLabel: string = dnsName.split(".")[0] || "";

  return (
    firstLabel.length > netbiosName.length &&
    firstLabel.toLowerCase().startsWith(netbiosName.toLowerCase())
  );
}

/*
 * The address as text: trimmed, and empty when there is none. Read the same
 * way the device's hostname is (String() of whatever was stored), so the name
 * of an address-named device is exactly its hostname.
 */
function readAddress(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function choose(
  fullName: string,
  source: DeviceNameSource,
  options: DeviceNameOptions | undefined,
): DeviceNameChoice {
  /*
   * Shortening changes how a name reads, never WHICH source names the
   * device. getShortHostname declines anything that is not a fully qualified
   * hostname — a NetBIOS name (one label), "Core Switch", "ubuntu-22.04", an
   * address — so only a dotted name with a real top-level label is cut.
   */
  const name: string =
    options?.useShortNames === true
      ? getShortHostname(fullName) || fullName
      : fullName;

  return { name: name, fullName: fullName, source: source };
}

/**
 * The name a device is called by, and where it came from — or undefined when
 * nothing names it, not even an address.
 *
 * See the header for the order and the reasons behind it.
 */
export function chooseDeviceName(
  facts: DeviceNameFacts,
  options?: DeviceNameOptions | undefined,
): DeviceNameChoice | undefined {
  const systemName: string | undefined = normalizeSystemName(facts.systemName);

  if (systemName) {
    return choose(systemName, DeviceNameSource.SystemName, options);
  }

  const dnsName: string | undefined = normalizeReverseDnsName(facts.dnsName);
  const netbiosName: string | undefined = normalizeNetbiosName(
    facts.netbiosName,
  );

  if (
    netbiosName &&
    !(dnsName && isNetbiosNameCutFromDnsName(netbiosName, dnsName))
  ) {
    return choose(netbiosName, DeviceNameSource.NetbiosName, options);
  }

  if (dnsName) {
    return choose(dnsName, DeviceNameSource.DnsName, options);
  }

  const address: string = readAddress(facts.address);

  if (address) {
    return choose(address, DeviceNameSource.Address, options);
  }

  return undefined;
}

/**
 * True when a device is still called by the name discovery gave it: it has a
 * readable source, and its name is EXACTLY the name discovery recorded,
 * case included, once surrounding spaces are ignored.
 *
 * This is what "never overwrite a name a person typed" rests on, and it needs
 * no record of who wrote the name: any rename at all — on the Settings page,
 * through the API, by the Shorten Names to Hostname action, even one that only
 * changes the case — leaves the name different from the one discovery
 * recorded, and the device is a person's to name from then on.
 */
export function isDeviceStillNamedByDiscovery(device: {
  name?: unknown;
  discoveredName?: unknown;
  discoveredNameSource?: unknown;
}): boolean {
  if (!readDeviceNameSource(device.discoveredNameSource)) {
    return false;
  }

  if (
    typeof device.name !== "string" ||
    typeof device.discoveredName !== "string"
  ) {
    return false;
  }

  const name: string = device.name.trim();

  return Boolean(name) && name === device.discoveredName.trim();
}

export default chooseDeviceName;
