import IP from "../../Types/IP/IP";

/*
 * WHAT A DISCOVERED DEVICE IS CALLED, AND HOW IT IS FOUND (OneUptime issue
 * #5775).
 *
 * A device a switch's forwarding table or a Meraki client list found - an
 * endpoint - has up to four things to be told apart by: what a person
 * classified it as, the name its controller gives it, its IP address and
 * its MAC. Its maker (the MAC's OUI) is NOT one of them: every register in
 * a store shares one, so a map of twenty "Verifone" boxes says nothing.
 * The map used to fall back to the maker before the address, and that is
 * exactly what the issue showed: a field of identical vendor names.
 *
 * So a discovered device is named by the first of classification,
 * controller name, IP address and MAC that it has, and the maker is only
 * ever the line under a name - beside an address, never instead of one.
 * The map's labels, its search, the Discovered Devices list and the import
 * that adds them to monitoring all read these rules, so they cannot
 * disagree about what a device is called.
 */

export interface DiscoveredDeviceIdentityFields {
  classification?: string | null | undefined;
  hostname?: string | null | undefined;
  ipAddress?: string | null | undefined;
  macAddress?: string | null | undefined;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * True for an IPv4 or IPv6 literal, as written. A name that happens to be
 * an address is drawn whole (an address split over two lines is two
 * meaningless halves) and is never repeated under itself.
 */
export function isIpAddressLiteral(value: string | null | undefined): boolean {
  const text: string = clean(value);

  if (!text || text.length > 45) {
    return false;
  }

  return IP.isIP(text);
}

/*
 * The name a discovered device goes by: what a person classified it as,
 * what its controller calls it, its IP address, its MAC - the first it has.
 * Empty only when it has none of them, which a stored endpoint (always a
 * MAC) never is.
 */
export function getDiscoveredDeviceName(
  fields: DiscoveredDeviceIdentityFields,
): string {
  return (
    clean(fields.classification) ||
    clean(fields.hostname) ||
    clean(fields.ipAddress) ||
    clean(fields.macAddress)
  );
}

/*
 * The line under a discovered device's name: its IP address when the name
 * is something else, else its maker - so a device with no name of its own
 * reads "10.0.0.5" over "Verifone", and one with a name reads
 * "Front register" over "10.0.0.5". Empty when there is nothing to add.
 */
export function getDiscoveredDeviceSecondaryLine(
  fields: DiscoveredDeviceIdentityFields & {
    vendor?: string | null | undefined;
  },
): string {
  const name: string = getDiscoveredDeviceName(fields);
  const ipAddress: string = clean(fields.ipAddress);
  const vendor: string = clean(fields.vendor);

  if (ipAddress && ipAddress !== name) {
    return ipAddress;
  }

  if (vendor && vendor !== name) {
    return vendor;
  }

  return "";
}

const MAC_SEPARATORS: RegExp = /[:\-.\s]/g;
const HEX_ONLY: RegExp = /^[0-9a-f]+$/;
const HAS_HEX_LETTER: RegExp = /[a-f]/;
// Pairs of hex digits joined by colons or dashes: "aa:bb", "00-1A-2b-".
const COLON_OR_DASH_PAIRS: RegExp = /^[0-9a-f]{1,2}([:-][0-9a-f]{0,2})+$/;

/*
 * The hex digits a search names when it reads as (part of) a MAC address,
 * in the form MACs are stored in once their separators are gone - or null
 * when it does not.
 *
 * A MAC is written four ways ("AA-BB-CC", "aa:bb:cc", "aabb.cc", "aabbcc"),
 * and a person pastes whichever their switch printed. A search in any of
 * them finds the stored "aa:bb:cc:..." form. What does NOT read as a MAC is
 * what reads as an address: "10.0.0" or "1000" is the start of an IP far
 * more often than a run of a MAC, so digits only count as one when they are
 * written with a MAC's own separators (":" or "-" between pairs).
 */
export function getMacSearchHex(
  search: string | null | undefined,
): string | null {
  const text: string = clean(search).toLowerCase();

  if (!text || text.length > 64) {
    return null;
  }

  const hex: string = text.replace(MAC_SEPARATORS, "");

  if (hex.length < 2 || hex.length > 12 || !HEX_ONLY.test(hex)) {
    return null;
  }

  if (COLON_OR_DASH_PAIRS.test(text)) {
    return hex;
  }

  // Bare hex, or Cisco's dotted form: only with a letter, else an address.
  if (hex.length >= 4 && HAS_HEX_LETTER.test(hex)) {
    return hex;
  }

  return null;
}

/*
 * Whether a MAC, as stored ("aa:bb:cc:dd:ee:ff") or as any switch prints it,
 * holds the hex digits a search names.
 */
export function macMatchesSearchHex(
  macAddress: string | null | undefined,
  searchHex: string | null,
): boolean {
  if (!searchHex) {
    return false;
  }

  const hex: string = clean(macAddress)
    .toLowerCase()
    .replace(MAC_SEPARATORS, "");

  return hex.length > 0 && hex.includes(searchHex);
}
