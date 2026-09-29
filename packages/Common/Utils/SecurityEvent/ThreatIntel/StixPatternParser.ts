import { ThreatIntelIndicatorType } from "../../../Types/SecurityEvent/ThreatIntelConstants";

/*
 * Parser for the subset of the STIX 2.1 pattern language that maps onto
 * plain IOC equality — the shape the overwhelming majority of TAXII
 * indicator feeds actually publish:
 *
 *   [ipv4-addr:value = '198.51.100.7']
 *   [domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']
 *   [file:hashes.'SHA-256' = 'aa...ff'] OR [url:value = 'http://evil.example/x']
 *
 * Supported: single-comparison and OR-combined equality comparisons over
 * ipv4-addr/ipv6-addr/domain-name/url/email-addr values and file hashes
 * (SHA-256, SHA-1, MD5), including multiple []-observation expressions
 * joined by OR.
 *
 * Everything else — AND, FOLLOWEDBY, temporal qualifiers, negation, LIKE
 * or MATCHES or set operators, and any other object path — returns null,
 * deliberately all-or-nothing: a partially-translated AND pattern would
 * match far MORE than its author intended, which for a detection feed is
 * the dangerous direction. Callers count nulls and surface them as
 * "unsupported patterns" on the feed instead of guessing.
 *
 * Pure and isomorphic (no server imports) so tests and any future UI
 * validation share the exact implementation.
 */

export interface ParsedIndicatorValue {
  type: ThreatIntelIndicatorType;
  /*
   * Canonical form: trimmed and lowercased. Observables are matched
   * case-insensitively platform-wide (buildObservables dedupes case-
   * insensitively), so indicators store the lowercase form once instead
   * of every reader lowercasing per comparison.
   */
  value: string;
}

/*
 * Pattern-language words whose presence (outside string literals) makes a
 * pattern unsupported. NOT catches negation; the comparison regex already
 * rejects operators like != or LIKE that attach without whitespace.
 */
const UNSUPPORTED_WORDS_REGEX: RegExp =
  /\b(AND|FOLLOWEDBY|WITHIN|REPEATS|START|STOP|NOT|LIKE|MATCHES|ISSUBSET|ISSUPERSET|IN|EXISTS)\b/i;

const OR_WORD_REGEX: RegExp = /\bOR\b/gi;

// A between-groups connector must be exactly the word OR.
const OR_CONNECTOR_REGEX: RegExp = /^OR$/i;

const COMPARISON_REGEX: RegExp =
  /^([a-zA-Z0-9-]+):([A-Za-z0-9_.'"-]+)\s*=\s*'((?:\\.|[^'\\])*)'$/;

const HASH_KEY_TO_TYPE: Record<string, ThreatIntelIndicatorType> = {
  SHA256: ThreatIntelIndicatorType.FileHashSha256,
  SHA1: ThreatIntelIndicatorType.FileHashSha1,
  MD5: ThreatIntelIndicatorType.FileHashMd5,
};

export default class StixPatternParser {
  /*
   * Parse a STIX pattern into normalized indicator values, or null when
   * any part of the pattern falls outside the supported subset.
   */
  public static parse(pattern: string): Array<ParsedIndicatorValue> | null {
    const trimmed: string = (pattern || "").trim();

    if (!trimmed) {
      return null;
    }

    const masked: string | null = this.maskStringLiterals(trimmed);

    if (masked === null) {
      // Unterminated string literal.
      return null;
    }

    const groups: Array<string> | null = this.extractObservationExpressions(
      trimmed,
      masked,
    );

    if (groups === null) {
      return null;
    }

    const values: Array<ParsedIndicatorValue> = [];
    const seen: Set<string> = new Set<string>();

    for (const group of groups) {
      const groupValues: Array<ParsedIndicatorValue> | null =
        this.parseObservationExpression(group);

      if (groupValues === null) {
        return null;
      }

      for (const parsed of groupValues) {
        const dedupeKey: string = `${parsed.type}|${parsed.value}`;

        if (seen.has(dedupeKey)) {
          continue;
        }

        seen.add(dedupeKey);
        values.push(parsed);
      }
    }

    return values.length > 0 ? values : null;
  }

  /*
   * Replace the contents of every single-quoted literal with '#' so word
   * and bracket scanning cannot be fooled by values containing " OR " or
   * "]". Indexes are preserved (same length), so positions found on the
   * masked string address the original. Returns null on an unterminated
   * literal.
   */
  private static maskStringLiterals(input: string): string | null {
    const out: Array<string> = [];
    let inQuote: boolean = false;

    for (let i: number = 0; i < input.length; i++) {
      const char: string = input[i]!;

      if (!inQuote) {
        out.push(char);
        if (char === "'") {
          inQuote = true;
        }
        continue;
      }

      if (char === "\\") {
        // Escape sequence inside the literal: mask both characters.
        out.push("#");
        if (i + 1 < input.length) {
          out.push("#");
          i++;
        }
        continue;
      }

      if (char === "'") {
        out.push(char);
        inQuote = false;
        continue;
      }

      out.push("#");
    }

    return inQuote ? null : out.join("");
  }

  /*
   * Split the top level of the pattern into its []-observation
   * expressions, requiring every connector between them to be OR and
   * nothing but whitespace otherwise (no qualifiers, no parentheses
   * combining groups with AND). Returns the ORIGINAL (unmasked) bracket
   * contents.
   */
  private static extractObservationExpressions(
    original: string,
    masked: string,
  ): Array<string> | null {
    const groups: Array<string> = [];
    const connectors: Array<string> = [];
    let depth: number = 0;
    let groupStart: number = -1;
    let connectorStart: number = 0;

    for (let i: number = 0; i < masked.length; i++) {
      const char: string = masked[i]!;

      if (char === "[") {
        if (depth === 0) {
          connectors.push(masked.slice(connectorStart, i));
          groupStart = i + 1;
        }
        depth++;
        continue;
      }

      if (char === "]") {
        depth--;

        if (depth < 0) {
          return null;
        }

        if (depth === 0) {
          groups.push(original.slice(groupStart, i));
          connectorStart = i + 1;
        }
        continue;
      }
    }

    if (depth !== 0 || groups.length === 0) {
      return null;
    }

    connectors.push(masked.slice(connectorStart));

    for (let i: number = 0; i < connectors.length; i++) {
      const connector: string = connectors[i]!.trim();

      if (i === 0 || i === connectors.length - 1) {
        // Before the first group / after the last: whitespace only.
        if (connector !== "") {
          return null;
        }
        continue;
      }

      if (!OR_CONNECTOR_REGEX.test(connector)) {
        return null;
      }
    }

    return groups;
  }

  /*
   * Parse the inside of one [...] group: equality comparisons joined by
   * OR. Any unsupported word, operator, or object path fails the whole
   * pattern.
   */
  private static parseObservationExpression(
    group: string,
  ): Array<ParsedIndicatorValue> | null {
    const masked: string | null = this.maskStringLiterals(group);

    if (masked === null) {
      return null;
    }

    if (UNSUPPORTED_WORDS_REGEX.test(masked)) {
      return null;
    }

    // Split at top-level ORs, positions taken from the masked copy.
    const segments: Array<string> = [];
    let lastIndex: number = 0;

    OR_WORD_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null = OR_WORD_REGEX.exec(masked);

    while (match !== null) {
      segments.push(group.slice(lastIndex, match.index));
      lastIndex = match.index + match[0].length;
      match = OR_WORD_REGEX.exec(masked);
    }

    segments.push(group.slice(lastIndex));

    const values: Array<ParsedIndicatorValue> = [];

    for (const segment of segments) {
      const parsed: ParsedIndicatorValue | null = this.parseComparison(
        segment.trim(),
      );

      if (parsed === null) {
        return null;
      }

      values.push(parsed);
    }

    return values;
  }

  private static parseComparison(
    comparison: string,
  ): ParsedIndicatorValue | null {
    let unwrapped: string = comparison;

    // Tolerate redundant parentheses around a single comparison.
    while (
      unwrapped.startsWith("(") &&
      unwrapped.endsWith(")") &&
      this.isBalancedWrap(unwrapped)
    ) {
      unwrapped = unwrapped.slice(1, -1).trim();
    }

    const match: RegExpMatchArray | null = unwrapped.match(COMPARISON_REGEX);

    if (!match) {
      return null;
    }

    const objectType: string = match[1]!.toLowerCase();
    const propertyPath: string = match[2]!;
    const rawValue: string = match[3]!;

    const type: ThreatIntelIndicatorType | null = this.resolveIndicatorType(
      objectType,
      propertyPath,
    );

    if (type === null) {
      return null;
    }

    const value: string = this.unescapeLiteral(rawValue).trim().toLowerCase();

    if (!value) {
      return null;
    }

    return { type, value };
  }

  private static resolveIndicatorType(
    objectType: string,
    propertyPath: string,
  ): ThreatIntelIndicatorType | null {
    if (propertyPath === "value") {
      switch (objectType) {
        case "ipv4-addr":
          return ThreatIntelIndicatorType.Ipv4Address;
        case "ipv6-addr":
          return ThreatIntelIndicatorType.Ipv6Address;
        case "domain-name":
          return ThreatIntelIndicatorType.DomainName;
        case "url":
          return ThreatIntelIndicatorType.Url;
        case "email-addr":
          return ThreatIntelIndicatorType.EmailAddress;
        default:
          return null;
      }
    }

    if (objectType === "file") {
      // file:hashes.'SHA-256' / file:hashes."SHA-1" / file:hashes.MD5
      const hashMatch: RegExpMatchArray | null = propertyPath.match(
        /^hashes\.['"]?([A-Za-z0-9-]+)['"]?$/,
      );

      if (!hashMatch) {
        return null;
      }

      const hashKey: string = hashMatch[1]!.toUpperCase().replace(/-/g, "");

      return HASH_KEY_TO_TYPE[hashKey] || null;
    }

    return null;
  }

  /*
   * True when the leading "(" closes at the final character — i.e. the
   * parentheses wrap the whole string rather than two adjacent groups.
   */
  private static isBalancedWrap(input: string): boolean {
    let depth: number = 0;

    for (let i: number = 0; i < input.length; i++) {
      if (input[i] === "(") {
        depth++;
      } else if (input[i] === ")") {
        depth--;
        if (depth === 0) {
          return i === input.length - 1;
        }
      }
    }

    return false;
  }

  private static unescapeLiteral(value: string): string {
    return value.replace(/\\(.)/g, "$1");
  }
}
