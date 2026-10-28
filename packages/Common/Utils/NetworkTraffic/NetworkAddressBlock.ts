import IP from "../../Types/IP/IP";
import IpCanonicalUtil from "../IpCanonicalUtil";

/*
 * AN ADDRESS, OR A SUBNET OF THEM - what an Address Name names (issue
 * #5340): "10.0.0.5" is one address, "10.18.167.0/24" every address from
 * 10.18.167.0 to 10.18.167.255, and the same for IPv6 ("2001:db8:1::/48").
 *
 * Written one way whatever way it was typed, so two spellings of one block
 * are one block: an IPv6 address compressed and in lowercase (RFC 5952), a
 * subnet as its first address and its length - "10.18.167.35/24" is kept as
 * "10.18.167.0/24", the subnet the person meant. An IPv4 address an IPv6
 * one maps (::ffff:10.0.0.5) is that IPv4 address.
 *
 * Pure, with no regular expression over the text: the server checks what
 * is saved with it, and the dashboard what is typed.
 */

export interface NetworkAddressBlock {
  family: 4 | 6;
  // The block's first address as groups of 16 bits: 2 for IPv4, 8 for IPv6.
  groups: Array<number>;
  // How many leading bits every address of the block shares (32 or 128: one address).
  prefixLength: number;
  // As it is kept and shown.
  text: string;
}

// The longest text a block is read from (an IPv6 subnet is at most 49 characters).
export const MAX_NETWORK_ADDRESS_BLOCK_TEXT_LENGTH: number = 100;

interface AddressGroups {
  family: 4 | 6;
  groups: Array<number>;
}

function isDigits(text: string): boolean {
  if (!text) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

function readIpv4Groups(text: string): Array<number> | null {
  const parts: Array<string> = text.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const octets: Array<number> = [];

  for (const part of parts) {
    if (!isDigits(part) || part.length > 3) {
      return null;
    }

    const octet: number = Number(part);

    if (octet > 255) {
      return null;
    }

    octets.push(octet);
  }

  return [octets[0]! * 256 + octets[1]!, octets[2]! * 256 + octets[3]!];
}

function isHexDigits(text: string): boolean {
  if (!text || text.length > 4) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const isHex: boolean =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 70) ||
      (code >= 97 && code <= 102);

    if (!isHex) {
      return false;
    }
  }

  return true;
}

// The eight groups of an IPv6 literal IP.isIP accepted (no zone), or null.
function readIpv6Groups(text: string): Array<number> | null {
  const halves: Array<string> = text.split("::");

  if (halves.length > 2) {
    return null;
  }

  const readHalf: (half: string) => Array<number> | null = (
    half: string,
  ): Array<number> | null => {
    if (!half) {
      return [];
    }

    const pieces: Array<string> = half.split(":");
    const groups: Array<number> = [];

    for (let index: number = 0; index < pieces.length; index++) {
      const piece: string = pieces[index]!;

      // An embedded IPv4 address ends the address: ::ffff:10.0.0.5.
      if (index === pieces.length - 1 && piece.includes(".")) {
        const ipv4: Array<number> | null = readIpv4Groups(piece);

        if (!ipv4) {
          return null;
        }

        groups.push(...ipv4);
        continue;
      }

      if (!isHexDigits(piece)) {
        return null;
      }

      groups.push(parseInt(piece, 16));
    }

    return groups;
  };

  const head: Array<number> | null = readHalf(halves[0] || "");

  if (halves.length === 1) {
    return head && head.length === 8 ? head : null;
  }

  const tail: Array<number> | null = readHalf(halves[1] || "");

  if (!head || !tail || head.length + tail.length > 7) {
    return null;
  }

  return [
    ...head,
    ...new Array<number>(8 - head.length - tail.length).fill(0),
    ...tail,
  ];
}

function groupsToIpv4Text(groups: Array<number>): string {
  return [
    Math.floor(groups[0]! / 256),
    groups[0]! % 256,
    Math.floor(groups[1]! / 256),
    groups[1]! % 256,
  ].join(".");
}

function groupsToIpv6Text(groups: Array<number>): string {
  return IpCanonicalUtil.canonicalize(
    groups
      .map((group: number): string => {
        return group.toString(16);
      })
      .join(":"),
  );
}

function isIpv4Mapped(groups: Array<number>): boolean {
  return (
    groups.slice(0, 5).every((group: number): boolean => {
      return group === 0;
    }) && groups[5] === 0xffff
  );
}

// The first `prefixLength` bits of the groups kept, the rest cleared.
function maskGroups(groups: Array<number>, prefixLength: number): Array<number> {
  return groups.map((group: number, index: number): number => {
    const bitsBefore: number = index * 16;

    if (prefixLength >= bitsBefore + 16) {
      return group;
    }

    if (prefixLength <= bitsBefore) {
      return 0;
    }

    const kept: number = prefixLength - bitsBefore;
    const mask: number = (0xffff << (16 - kept)) & 0xffff;

    return group & mask;
  });
}

export default class NetworkAddressBlockUtil {
  /*
   * An address as groups, or null when it is not one. Surrounding white
   * space is forgiven; anything else - a zone ("fe80::1%eth0"), a port, a
   * name - is not an address.
   */
  public static readAddress(value: unknown): AddressGroups | null {
    if (typeof value !== "string") {
      return null;
    }

    const text: string = value.trim();

    if (
      !text ||
      text.length > MAX_NETWORK_ADDRESS_BLOCK_TEXT_LENGTH ||
      text.includes("%") ||
      !IP.isIP(text)
    ) {
      return null;
    }

    const ipv4: Array<number> | null = readIpv4Groups(text);

    if (ipv4) {
      return { family: 4, groups: ipv4 };
    }

    const ipv6: Array<number> | null = readIpv6Groups(text.toLowerCase());

    if (!ipv6) {
      return null;
    }

    if (isIpv4Mapped(ipv6)) {
      return { family: 4, groups: ipv6.slice(6, 8) };
    }

    return { family: 6, groups: ipv6 };
  }

  // An address written the one way blocks are, or null when it is not one.
  public static canonicalAddress(value: unknown): string | null {
    const address: AddressGroups | null =
      NetworkAddressBlockUtil.readAddress(value);

    if (!address) {
      return null;
    }

    return address.family === 4
      ? groupsToIpv4Text(address.groups)
      : groupsToIpv6Text(address.groups);
  }

  /*
   * "10.0.0.5", "10.18.167.0/24", "2001:db8::/32" as a block, or null when
   * the text is neither an address nor a subnet. A subnet's length is a
   * whole number of bits the family has (0 to 32, or 0 to 128).
   */
  public static parse(value: unknown): NetworkAddressBlock | null {
    if (typeof value !== "string") {
      return null;
    }

    const text: string = value.trim();

    if (!text || text.length > MAX_NETWORK_ADDRESS_BLOCK_TEXT_LENGTH) {
      return null;
    }

    const slash: number = text.indexOf("/");

    if (slash !== -1 && slash !== text.lastIndexOf("/")) {
      return null;
    }

    const addressText: string = slash === -1 ? text : text.slice(0, slash);
    const prefixText: string | null =
      slash === -1 ? null : text.slice(slash + 1).trim();

    // A mapped address with a length is an IPv6 subnet, read as one.
    const isMappedSubnet: boolean =
      prefixText !== null && addressText.trim().toLowerCase().includes("::ffff:");

    let address: AddressGroups | null =
      NetworkAddressBlockUtil.readAddress(addressText);

    if (address && isMappedSubnet && address.family === 4) {
      const ipv6: Array<number> | null = readIpv6Groups(
        addressText.trim().toLowerCase(),
      );
      address = ipv6 ? { family: 6, groups: ipv6 } : null;
    }

    if (!address) {
      return null;
    }

    const maxPrefix: number = address.family === 4 ? 32 : 128;
    let prefixLength: number = maxPrefix;

    if (prefixText !== null) {
      if (!isDigits(prefixText) || prefixText.length > 3) {
        return null;
      }

      prefixLength = Number(prefixText);

      if (prefixLength > maxPrefix) {
        return null;
      }
    }

    const groups: Array<number> = maskGroups(address.groups, prefixLength);
    const addressPart: string =
      address.family === 4
        ? groupsToIpv4Text(groups)
        : groupsToIpv6Text(groups);

    return {
      family: address.family,
      groups: groups,
      prefixLength: prefixLength,
      text:
        prefixLength === maxPrefix
          ? addressPart
          : `${addressPart}/${prefixLength}`,
    };
  }

  // Whether the block is one address rather than a subnet.
  public static isSingleAddress(block: NetworkAddressBlock): boolean {
    return block.prefixLength === (block.family === 4 ? 32 : 128);
  }

  // Whether an address is in the block (of the same family; IPv4-mapped is IPv4).
  public static contains(block: NetworkAddressBlock, address: string): boolean {
    const read: AddressGroups | null =
      NetworkAddressBlockUtil.readAddress(address);

    if (!read || read.family !== block.family) {
      return false;
    }

    const masked: Array<number> = maskGroups(read.groups, block.prefixLength);

    return masked.every((group: number, index: number): boolean => {
      return group === block.groups[index];
    });
  }

  /*
   * Of these items, the one whose block holds the address most narrowly
   * (the longest subnet): a /24 named "Mumbai office" says more about
   * 10.18.167.35 than a /8 named "Corporate". The first such item on a tie.
   */
  public static mostSpecific<T>(
    address: string,
    items: ReadonlyArray<T>,
    readBlock: (item: T) => NetworkAddressBlock | null,
  ): T | null {
    let best: T | null = null;
    let bestPrefix: number = -1;

    for (const item of items) {
      const block: NetworkAddressBlock | null = readBlock(item);

      if (
        block &&
        block.prefixLength > bestPrefix &&
        NetworkAddressBlockUtil.contains(block, address)
      ) {
        best = item;
        bestPrefix = block.prefixLength;
      }
    }

    return best;
  }
}
