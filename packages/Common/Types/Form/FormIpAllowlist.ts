import IP from "../IP/IP";
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";

/*
 * A form's IP allowlist: the networks its public page can be opened and
 * submitted from, one entry per line.
 *
 * The public routes check a visitor against it with IP.isInWhitelist, the
 * same matcher the dashboards' and status pages' allowlists use, and that
 * matcher understands exactly three kinds of entry: an IPv4 address, an
 * IPv6 address (matched exactly), and an IPv4 range in CIDR notation. An
 * IPv6 range, a range of /0 (which it matches as the one address, not as
 * every network) or two addresses on one line never match anyone - and the
 * check fails closed, so such an entry would lock everybody on that network
 * out without a word to the admin who saved it. Nor does an IPv4 address
 * written as an IPv6 one ("::ffff:203.0.113.7", as a dual-stack listener
 * logs it): the routes see an IPv4 visitor as the IPv4 address
 * (resolveClientIp unwraps that spelling), never as the IPv6 one. So a list
 * is refused, naming each line, at the write that would store it: on create
 * and update, whoever writes it (the dashboard, the API, Terraform, a
 * workflow). The value is never rewritten, only accepted or refused, so a
 * client that compares what it sent with what it reads back sees no drift.
 *
 * Pure, with no database or React imports, so the dashboard can check the
 * same rules before it saves.
 */

// Each line of the list, trimmed, blank lines left out.
export type GetFormIpAllowlistEntriesFunction = (
  value: string | null | undefined,
) => Array<string>;

export const getFormIpAllowlistEntries: GetFormIpAllowlistEntriesFunction = (
  value: string | null | undefined,
): Array<string> => {
  return (value || "")
    .split(/\r?\n/)
    .map((entry: string): string => {
      return entry.trim();
    })
    .filter((entry: string): boolean => {
      return entry.length > 0;
    });
};

const MAX_LISTED_PROBLEMS: number = 5;
const MAX_QUOTED_LENGTH: number = 80;

const HINT: string =
  "Put one IPv4 or IPv6 address, or one IPv4 range such as 10.0.0.0/8, on each line.";

// "a.b.c.d/n" or "x::y/n": the address, then the prefix length.
const RANGE_PATTERN: RegExp = /^([^/]+)\/([^/]*)$/;
const PREFIX_PATTERN: RegExp = /^\d{1,2}$/;

type QuoteFunction = (value: string) => string;

const quote: QuoteFunction = (value: string): string => {
  return `"${
    value.length > MAX_QUOTED_LENGTH
      ? `${value.slice(0, MAX_QUOTED_LENGTH)}...`
      : value
  }"`;
};

type IsVersionFunction = (value: string) => boolean;

const isIPv4Address: IsVersionFunction = (value: string): boolean => {
  return IP.isIP(value) && new IP(value).isIPv4();
};

const isIPv6Address: IsVersionFunction = (value: string): boolean => {
  return IP.isIP(value) && new IP(value).isIPv6();
};

/*
 * An IPv4-mapped IPv6 address (RFC 4291 2.5.5.2) as IpCanonicalUtil spells
 * every one of them - "::ffff:203.0.113.7", "::FFFF:cb00:7107" and
 * "0:0:0:0:0:ffff:cb00:7107" all come out as "::ffff:cb00:7107" - with its
 * two groups, the IPv4 address's high and low halves.
 */
const IPV4_MAPPED_PATTERN: RegExp = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

export type GetIpv4OfMappedAddressFunction = (value: string) => string | null;

/**
 * The IPv4 address an IPv4-mapped IPv6 address stands for - "203.0.113.7"
 * for "::ffff:203.0.113.7" or "::ffff:cb00:7107", however it is written -
 * or null for anything else, an IPv4 address included.
 */
export const getIpv4OfMappedAddress: GetIpv4OfMappedAddressFunction = (
  value: string,
): string | null => {
  const address: string = value.trim();

  if (!isIPv6Address(address)) {
    return null;
  }

  const mapped: RegExpExecArray | null = IPV4_MAPPED_PATTERN.exec(
    IpCanonicalUtil.canonicalize(address),
  );

  if (!mapped) {
    return null;
  }

  const high: number = parseInt(mapped[1]!, 16);
  const low: number = parseInt(mapped[2]!, 16);

  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
};

type GetEntryProblemFunction = (entry: string) => string | null;

// What is wrong with one entry, or null when the matcher understands it.
const getEntryProblem: GetEntryProblemFunction = (
  entry: string,
): string | null => {
  if (IP.isIP(entry)) {
    const ipv4: string | null = getIpv4OfMappedAddress(entry);

    /*
     * The routes see an IPv4 visitor as its IPv4 address, whichever way a
     * dual-stack listener or a proxy wrote it, so this spelling of it would
     * never be matched: the admin is told the one that will be.
     */
    if (ipv4) {
      return `is an IPv4 address written as an IPv6 address - write it as ${ipv4}`;
    }

    return null;
  }

  const range: RegExpExecArray | null = RANGE_PATTERN.exec(entry);

  if (range) {
    const address: string = range[1]!;
    const prefix: string = range[2]!;

    if (isIPv6Address(address)) {
      return "is an IPv6 range, and only IPv4 ranges are supported - list each IPv6 address on a line of its own";
    }

    if (isIPv4Address(address) && PREFIX_PATTERN.test(prefix)) {
      const length: number = parseInt(prefix, 10);

      if (length === 0) {
        return "is a /0 range, which would match only its own address rather than every network - leave the list empty to allow every network";
      }

      if (length <= 32) {
        return null;
      }
    }
  }

  return "is not an IP address or an IPv4 range";
};

export type ValidateFormIpAllowlistFunction = (value: unknown) => string | null;

/**
 * Null when every line of the list is an entry the public routes can match
 * (or the list is empty, or not set); otherwise one message naming each
 * problem line, the first five of them.
 */
export const validateFormIpAllowlist: ValidateFormIpAllowlistFunction = (
  value: unknown,
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return `IP Allowlist must be text. ${HINT}`;
  }

  const problems: Array<string> = [];

  value.split(/\r?\n/).forEach((line: string, index: number): void => {
    const entry: string = line.trim();

    if (!entry) {
      return;
    }

    const problem: string | null = getEntryProblem(entry);

    if (problem) {
      problems.push(`line ${index + 1} (${quote(entry)}) ${problem}`);
    }
  });

  if (problems.length === 0) {
    return null;
  }

  const more: number = problems.length - MAX_LISTED_PROBLEMS;

  return `IP Allowlist: ${problems.slice(0, MAX_LISTED_PROBLEMS).join("; ")}${
    more > 0
      ? `; and ${more} more ${more === 1 ? "line is" : "lines are"} not valid either`
      : ""
  }. ${HINT}`;
};
