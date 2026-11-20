import IP from "../../Types/IP/IP";
import {
  ScrubRegExp,
  scrubRegExpFromRanges,
} from "../../Types/Telemetry/ScrubRule";
import { DataTypeDetector } from "../DataSecurity/Detector";
import { IP_ADDRESS_DETECTORS } from "../DataSecurity/Detectors/ContactDetectors";
import IpCanonicalUtil from "../IpCanonicalUtil";

/*
 * WHAT AN IP ADDRESS SCRUB RULE HIDES: EXACTLY WHAT DATA SECURITY CALLS AN
 * IP ADDRESS (#10393).
 *
 * Log and trace scrub rules (App/FeatureSet/Telemetry/Services/
 * LogScrubRuleService.ts, TraceScrubRuleService.ts, and session replays
 * through the log rules) hid every dotted quad and nothing else, with
 * /\b(?:\d{1,3}\.){3}\d{1,3}\b/. Data Security's IP address type is "a
 * public IPv4 or IPv6 address, which GDPR treats as personal data", and its
 * coverage counted any IP Address rule as covering any IP address finding.
 * So the two disagreed both ways:
 *
 *  - an IPv6 address was never hidden, while its finding showed as
 *    scrubbed - old data waiting for its retention - and new addresses kept
 *    arriving in the clear;
 *  - a private, loopback or link-local address, which is no one's personal
 *    data and which people need to read their own infrastructure, was
 *    hidden - and 169.254.169.254 inside a request's URL with it, the very
 *    text Security Events finds server-side request forgery by
 *    (CLOUD_METADATA_MARKERS, Utils/SecurityEvent/TelemetryScan/
 *    TraceSignals.ts).
 *
 * Now the rule finds its matches with the type's own detectors
 * (IP_ADDRESS_DETECTORS): their patterns, quick checks and validators, run
 * as Data Security's scanner runs them (DataSecurity/TextScanner.ts). A
 * candidate is hidden when a detector accepts it - a public address, or a
 * documentation one (203.0.113.5, 2001:db8::1), so a test shows the rule
 * working - and left as it is when it does not. Both detectors read every
 * text, and what either accepts is hidden: an IPv4 address written as IPv6
 * (::ffff:8.8.8.8) is found by both, and hidden whole.
 *
 * In line with the text's length: each detector's pattern is bounded and
 * cannot start inside a longer run of its characters
 * (ScrubIpAddressLinearTime.test.ts reads megabyte-long adversarial texts).
 */

export type ScrubIpAddressRange = [number, number];

// What Mask leaves of an IPv4 address, and of an IPv6 one: no digit of it.
export const IPV4_ADDRESS_MASK: string = "***.***.***.***";
export const IPV6_ADDRESS_MASK: string =
  "****:****:****:****:****:****:****:****";

// What the pattern reads, as a RegExp's source would say it.
const SCRUB_IP_ADDRESS_SOURCE: string = IP_ADDRESS_DETECTORS.map(
  (detector: DataTypeDetector): string => {
    return `(?:${detector.pattern.source})`;
  },
).join("|");

// Where one detector's accepted candidates are, as the scanner reads them.
function acceptedRanges(
  detector: DataTypeDetector,
  text: string,
  ranges: Array<ScrubIpAddressRange>,
): void {
  if (
    detector.quickCheck &&
    !detector.quickCheck(
      detector.quickCheckLowerCase ? text.toLowerCase() : text,
    )
  ) {
    return;
  }

  const pattern: RegExp = detector.pattern;

  pattern.lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const group: number = detector.valueGroup || 0;
    const value: string | undefined = match[group];

    if (value === undefined || match.index === undefined || value === "") {
      continue;
    }

    const offset: number = group === 0 ? 0 : match[0].indexOf(value);
    const start: number = match.index + Math.max(0, offset);
    const normalized: string = detector.normalize
      ? detector.normalize(value)
      : value;

    if (detector.validate && !detector.validate(normalized, value)) {
      continue;
    }

    ranges.push([start, start + value.length]);
  }
}

export default class ScrubIpAddress {
  /*
   * Where the IP addresses Data Security counts are in a text: [start, end)
   * ranges, left to right, none overlapping. Ranges two detectors share -
   * an IPv4 address and the IPv6 one it is written as - are one range, so
   * an address is hidden whole.
   */
  public static findRanges(text: string): Array<ScrubIpAddressRange> {
    if (!text) {
      return [];
    }

    const found: Array<ScrubIpAddressRange> = [];

    for (const detector of IP_ADDRESS_DETECTORS) {
      acceptedRanges(detector, text, found);
    }

    if (found.length < 2) {
      return found;
    }

    found.sort((a: ScrubIpAddressRange, b: ScrubIpAddressRange): number => {
      return a[0] - b[0] || b[1] - a[1];
    });

    const merged: Array<ScrubIpAddressRange> = [found[0]!];

    for (let index: number = 1; index < found.length; index++) {
      const range: ScrubIpAddressRange = found[index]!;
      const last: ScrubIpAddressRange = merged[merged.length - 1]!;

      if (range[0] < last[1]) {
        last[1] = Math.max(last[1], range[1]);
      } else {
        merged.push(range);
      }
    }

    return merged;
  }

  /*
   * The pattern an IP Address scrub rule runs with: the matches findRanges
   * finds, for replace, matchRanges and test alike.
   */
  public static toScrubRegExp(): ScrubRegExp {
    return scrubRegExpFromRanges({
      source: SCRUB_IP_ADDRESS_SOURCE,
      flags: "g",
      findRanges: ScrubIpAddress.findRanges,
    });
  }

  /*
   * An address as one spelling for every way it is written, so the same
   * address always makes the same Hash token (Server/Utils/Telemetry/
   * ScrubHashToken.ts): an IPv4 address as it is, the IPv4 address an
   * IPv4-mapped one stands for ("::ffff:8.8.8.8" and "::ffff:808:808" are
   * "8.8.8.8", the address a dual-stack server saw), and any other IPv6
   * address in RFC 5952's form ("2001:DB8:0:0:0:0:0:1" is "2001:db8::1").
   * Text that is no address comes back as it is.
   */
  public static canonicalize(address: string): string {
    const trimmed: string = address.trim();

    if (!IP.isIP(trimmed)) {
      return address;
    }

    return (
      IpCanonicalUtil.getIpv4OfMappedAddress(trimmed) ||
      IpCanonicalUtil.canonicalize(trimmed)
    );
  }

  /*
   * What Mask leaves of an address: its shape, and none of its digits -
   * an IPv4 address's four parts, or an IPv6 address's eight groups. An
   * IPv4-mapped address is an IPv4 address.
   */
  public static mask(address: string): string {
    return ScrubIpAddress.canonicalize(address).includes(":")
      ? IPV6_ADDRESS_MASK
      : IPV4_ADDRESS_MASK;
  }
}
