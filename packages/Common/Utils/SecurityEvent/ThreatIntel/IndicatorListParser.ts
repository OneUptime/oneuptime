import {
  SecurityEntityType,
  inferSecurityEntityType,
  isIpAddress,
} from "../../../Types/SecurityCase/SecurityEntity";
import { ThreatIntelIndicatorType } from "../../../Types/SecurityEvent/ThreatIntelConstants";
import { ParsedIndicatorValue } from "./StixPatternParser";

/*
 * A list of indicators, as the free blocklists publish them -> indicator
 * values: one a line, the first thing on the line, anything after a space,
 * a tab, a comma or a semicolon left out, and comment lines (#, ;, //)
 * skipped. Each value is typed by its shape - an IP address (a port after
 * it dropped), a URL, a file hash by its length, an email address or a
 * domain - and lowercased, as STIX values are, so a list's indicators match
 * events the way a TAXII collection's do. A range (CIDR) is not one
 * address, and is counted as unsupported.
 *
 * A list is text somebody else wrote: it is read in one pass, character by
 * character, and a line longer than any indicator is skipped unread past
 * that length. Only a value already cut to an indicator's length is shown to
 * the typing checks.
 */

// No indicator is longer: a URL longer than this is not one a list holds.
export const INDICATOR_LIST_MAX_VALUE_LENGTH: number = 2048;

export interface IndicatorListParseResult {
  values: Array<ParsedIndicatorValue>;
  // Lines that were not empty or a comment.
  lines: number;
  // The same value again.
  duplicates: number;
  // Values of no type OneUptime matches (a range, a word, a line too long).
  unsupported: number;
  // Values past `maxValues`, left out.
  overLimit: number;
}

const SEPARATORS: string = " \t,;";
const HEX: string = "0123456789abcdef";
const DIGITS: string = "0123456789";

function isHex(value: string): boolean {
  for (const char of value) {
    if (!HEX.includes(char)) {
      return false;
    }
  }

  return value.length > 0;
}

function isDigits(value: string): boolean {
  for (const char of value) {
    if (!DIGITS.includes(char)) {
      return false;
    }
  }

  return value.length > 0;
}

function isCommentLine(line: string): boolean {
  return line.startsWith("#") || line.startsWith(";") || line.startsWith("//");
}

// The line's first value: up to the first separator, without quotes around it.
function firstValueOf(line: string): string {
  let end: number = 0;

  while (end < line.length && !SEPARATORS.includes(line.charAt(end))) {
    end++;
  }

  let value: string = line.slice(0, end);

  if (
    value.length >= 2 &&
    (value.startsWith('"') || value.startsWith("'")) &&
    value.endsWith(value.charAt(0))
  ) {
    value = value.slice(1, -1);
  }

  return value.trim();
}

/*
 * The type of one value, and the value as it is matched, or null for a
 * value of no type OneUptime matches.
 */
export function classifyIndicatorValue(
  raw: string,
): ParsedIndicatorValue | null {
  const value: string = raw.trim().toLowerCase();

  if (!value || value.length > INDICATOR_LIST_MAX_VALUE_LENGTH) {
    return null;
  }

  if (value.includes("://")) {
    return { type: ThreatIntelIndicatorType.Url, value };
  }

  // A range is many addresses: not one indicator.
  if (value.includes("/")) {
    return null;
  }

  if (isHex(value)) {
    if (value.length === 32) {
      return { type: ThreatIntelIndicatorType.FileHashMd5, value };
    }

    if (value.length === 40) {
      return { type: ThreatIntelIndicatorType.FileHashSha1, value };
    }

    if (value.length === 64) {
      return { type: ThreatIntelIndicatorType.FileHashSha256, value };
    }
  }

  // "[2001:db8::7]:443": the address inside the brackets, without its port.
  if (value.startsWith("[")) {
    const close: number = value.indexOf("]");
    const inner: string = close > 1 ? value.slice(1, close) : "";
    const after: string = close > 1 ? value.slice(close + 1) : "";

    if (
      inner.includes(":") &&
      isIpAddress(inner) &&
      (after === "" || (after.startsWith(":") && isDigits(after.slice(1))))
    ) {
      return { type: ThreatIntelIndicatorType.Ipv6Address, value: inner };
    }

    return null;
  }

  // "203.0.113.7:443": the address (or domain), without its port.
  const colon: number = value.lastIndexOf(":");
  const withoutPort: string =
    colon > 0 &&
    value.indexOf(":") === colon &&
    isDigits(value.slice(colon + 1))
      ? value.slice(0, colon)
      : value;

  if (isIpAddress(withoutPort)) {
    return {
      type: withoutPort.includes(":")
        ? ThreatIntelIndicatorType.Ipv6Address
        : ThreatIntelIndicatorType.Ipv4Address,
      value: withoutPort,
    };
  }

  const at: number = value.indexOf("@");

  if (at !== -1) {
    // A mailbox at a domain: "payroll@evil.example".
    return at > 0 &&
      at <= 64 &&
      at === value.lastIndexOf("@") &&
      inferSecurityEntityType(value.slice(at + 1)) === SecurityEntityType.Domain
      ? { type: ThreatIntelIndicatorType.EmailAddress, value }
      : null;
  }

  // "evil.example", or "evil.example:8080" without its port.
  if (inferSecurityEntityType(withoutPort) === SecurityEntityType.Domain) {
    return { type: ThreatIntelIndicatorType.DomainName, value: withoutPort };
  }

  return null;
}

export default class IndicatorListParser {
  public static parse(
    text: string,
    options: { maxValues: number },
  ): IndicatorListParseResult {
    const result: IndicatorListParseResult = {
      values: [],
      lines: 0,
      duplicates: 0,
      unsupported: 0,
      overLimit: 0,
    };

    const seen: Set<string> = new Set<string>();
    let start: number = 0;

    while (start <= text.length) {
      let end: number = text.indexOf("\n", start);

      if (end === -1) {
        end = text.length;
      }

      // Never more of a line than an indicator can be (plus room to see its end).
      const line: string = text
        .slice(
          start,
          Math.min(end, start + INDICATOR_LIST_MAX_VALUE_LENGTH + 1),
        )
        .trim();
      const lineIsLong: boolean =
        end - start > INDICATOR_LIST_MAX_VALUE_LENGTH + 1;

      start = end + 1;

      if (!line || isCommentLine(line)) {
        continue;
      }

      result.lines++;

      const value: string = firstValueOf(line);
      const parsed: ParsedIndicatorValue | null =
        lineIsLong && value.length > INDICATOR_LIST_MAX_VALUE_LENGTH
          ? null
          : classifyIndicatorValue(value);

      if (!parsed) {
        result.unsupported++;
        continue;
      }

      const key: string = `${parsed.type}|${parsed.value}`;

      if (seen.has(key)) {
        result.duplicates++;
        continue;
      }

      if (result.values.length >= options.maxValues) {
        result.overLimit++;
        continue;
      }

      seen.add(key);
      result.values.push(parsed);
    }

    return result;
  }
}
