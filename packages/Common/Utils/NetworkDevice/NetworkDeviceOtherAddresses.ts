import IP from "../../Types/IP/IP";
import IpCanonicalUtil from "../IpCanonicalUtil";

/*
 * A device's "Other Addresses" (NetworkDevice.otherAddresses): the IP
 * addresses it sends traps, syslog and flow records from besides its
 * hostname, kept as one comma-separated text so it reads and edits like an
 * address - in the form, the API and Terraform alike.
 *
 * What people type is generous - commas, spaces, semicolons or new lines
 * between addresses, IPv6 in any spelling - and what is stored is not:
 * canonical addresses (IpCanonicalUtil), each once, in the order typed,
 * joined by ", ". Matching compares canonical forms, so "2001:DB8::1" typed
 * here matches a datagram from 2001:db8::1.
 */

// More than this is not "a loopback and an interface or two".
export const MAX_OTHER_ADDRESSES: number = 10;

// The column's length (ColumnLength.LongText).
export const MAX_OTHER_ADDRESSES_LENGTH: number = 500;

const SEPARATORS: RegExp = /[\s,;]+/;

export interface ParsedOtherAddresses {
  // Canonical, each once, in the order given.
  addresses: Array<string>;
  // Entries that are not IP addresses, as typed.
  invalid: Array<string>;
}

export default class NetworkDeviceOtherAddressesUtil {
  public static parse(value: string | null | undefined): ParsedOtherAddresses {
    const addresses: Array<string> = [];
    const invalid: Array<string> = [];

    for (const entry of (value || "").split(SEPARATORS)) {
      const trimmed: string = entry.trim();

      if (!trimmed) {
        continue;
      }

      if (!IP.isIP(trimmed)) {
        invalid.push(trimmed);
        continue;
      }

      const canonical: string = IpCanonicalUtil.canonicalize(trimmed);

      if (!addresses.includes(canonical)) {
        addresses.push(canonical);
      }
    }

    return { addresses: addresses, invalid: invalid };
  }

  // The text a list of addresses is stored as; null for none.
  public static format(addresses: Array<string>): string | null {
    return addresses.length > 0 ? addresses.join(", ") : null;
  }

  /*
   * What a write stores: the canonical text, or null to clear. Throws a
   * plain Error naming what is wrong - the service turns it into the
   * refusal the person sees.
   */
  public static normalize(value: string | null | undefined): string | null {
    const parsed: ParsedOtherAddresses =
      NetworkDeviceOtherAddressesUtil.parse(value);

    if (parsed.invalid.length > 0) {
      throw new Error(
        `Other Addresses takes IP addresses only, separated by commas. Not an IP address: ${parsed.invalid.join(", ")}.`,
      );
    }

    if (parsed.addresses.length > MAX_OTHER_ADDRESSES) {
      throw new Error(
        `Other Addresses takes up to ${MAX_OTHER_ADDRESSES} addresses.`,
      );
    }

    const formatted: string | null = NetworkDeviceOtherAddressesUtil.format(
      parsed.addresses,
    );

    if (formatted && formatted.length > MAX_OTHER_ADDRESSES_LENGTH) {
      throw new Error(
        `Other Addresses is longer than ${MAX_OTHER_ADDRESSES_LENGTH} characters.`,
      );
    }

    return formatted;
  }

  // Whether the stored text names this address (in any spelling).
  public static includes(
    value: string | null | undefined,
    address: string,
  ): boolean {
    if (!IP.isIP(address.trim())) {
      return false;
    }

    return NetworkDeviceOtherAddressesUtil.parse(value).addresses.includes(
      IpCanonicalUtil.canonicalize(address),
    );
  }

  // The stored text with one more address (unchanged when already there).
  public static add(value: string | null | undefined, address: string): string {
    const parsed: ParsedOtherAddresses =
      NetworkDeviceOtherAddressesUtil.parse(value);
    const canonical: string = IpCanonicalUtil.canonicalize(address);

    if (!parsed.addresses.includes(canonical)) {
      parsed.addresses.push(canonical);
    }

    return NetworkDeviceOtherAddressesUtil.format(parsed.addresses)!;
  }
}
