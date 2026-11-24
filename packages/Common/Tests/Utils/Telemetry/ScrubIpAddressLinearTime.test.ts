import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { ScrubRegExp } from "../../../Types/Telemetry/ScrubRule";
import { IP_ADDRESS_DETECTORS } from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import ScrubIpAddress from "../../../Utils/Telemetry/ScrubIpAddress";

/*
 * ---------------------------------------------------------------------------
 * THE IP ADDRESS SCRUB PATTERN READS A TEXT IN TIME IN LINE WITH ITS LENGTH
 * (#10393).
 *
 * The pattern runs over every log body, span name and attribute of a
 * project with an IP Address rule, at ingest, over text the project's own
 * application writes - or an attacker writes for it. Each detector's
 * pattern is bounded and cannot start inside a longer run of its own
 * characters, so a text built to be awkward - colons and digits, dotted
 * runs, hex without end, a long run of almost-addresses - is read once.
 * 400,000 characters of each, under two seconds (Tests/Helpers/FastestRun).
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400_000;
const LIMIT_IN_MS: number = 2000;

function repeat(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

const WORST_CASES: Array<[string, string]> = [
  ["colons and digits", repeat("1:", LENGTH)],
  ["colons alone", repeat(":", LENGTH)],
  ["double colons and digits", repeat("1::", LENGTH)],
  ["hex without end", repeat("a", LENGTH)],
  ["digits without end", repeat("1", LENGTH)],
  ["dotted digits", repeat("1.", LENGTH)],
  ["an IPv4 tail that never ends", repeat("::ffff:1.", LENGTH)],
  ["groups then dotted digits", repeat("a:b:c:d:e:f:1.2.3.", LENGTH)],
  [
    "eight groups and one more, again and again",
    repeat("1:2:3:4:5:6:7:8:", LENGTH),
  ],
  ["mapped addresses back to back", repeat("::ffff:8.8.8.8", LENGTH)],
  ["public addresses back to back", repeat("2001:db8::1 8.8.8.8 ", LENGTH)],
  ["private addresses back to back", repeat("10.0.0.1 fe80::1 ", LENGTH)],
  ["a dotted run after a mapped prefix", "::ffff:" + repeat("1.", LENGTH)],
  // #10466: one group each side of "::", and what nearly is.
  ["one-group addresses back to back", repeat("2001::1 ", LENGTH)],
  ["one-group addresses glued together", repeat("2001::", LENGTH)],
  ["one-group addresses glued to letters", repeat("x2001::1x", LENGTH)],
  ["a global group and hex without end", "2a00::" + repeat("a", LENGTH)],
  ["global groups and double colons", repeat("2a00::2606::", LENGTH)],
  ["scopes of hex letters back to back", repeat("Abc::Def ", LENGTH)],
  // #10467: what an encoded text can be.
  ["encoded colons without end", repeat("%3A", LENGTH)],
  ["encoded colons and digits", repeat("1%3A", LENGTH)],
  ["percent signs without end", repeat("%", LENGTH)],
  ["half escapes without end", repeat("%3", LENGTH)],
  ["encoded colons escaped again", repeat("%253A", LENGTH)],
  ["encoded addresses back to back", repeat("2001%3A%3A1 ", LENGTH)],
  [
    "encoded URLs back to back",
    repeat("http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%3A443%2F ", LENGTH),
  ],
  ["encoded dotted quads back to back", repeat("8%2E8%2E8%2E8 ", LENGTH)],
  [
    "an encoded IPv4 tail that never ends",
    "%3A%3Affff%3A" + repeat("1%2E", LENGTH),
  ],
];

describe("the IP Address scrub pattern", () => {
  const regex: ScrubRegExp = ScrubIpAddress.toScrubRegExp();

  test.each(WORST_CASES)(
    "reads %s in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<string> = fastestRun({
        run: (): string => {
          return regex.replace(text, (): string => {
            return "[REDACTED]";
          });
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
      expect(typeof timed.result).toBe("string");
    },
  );

  test("still hides every address of a long text of them, and keeps the rest", () => {
    const text: string = repeat("2001:db8::1 10.0.0.1 ", 21 * 1000);
    const scrubbed: string = regex.replace(text, (): string => {
      return "[R]";
    });

    expect(scrubbed).toBe(repeat("[R] 10.0.0.1 ", 13 * 1000));
    expect(scrubbed).not.toContain("2001:db8::1");
  });
});

/*
 * #10467: Data Security's scanner reads a text with its percent-escapes
 * read for the IP address detectors, window by window, as the rule does:
 * an encoded text is read in time in line with its length there too, and
 * every encoded address of a long text of them is found once.
 */
describe("Data Security's scanner, reading an encoded text", () => {
  test.each(
    WORST_CASES.filter(([label]: [string, string]): boolean => {
      return ["encoded", "percent", "escape"].some((word: string): boolean => {
        return label.includes(word);
      });
    }),
  )(
    "reads %s in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return findSensitiveValues(text, {
            detectors: IP_ADDRESS_DETECTORS,
          }).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );

  test("finds every encoded address of a long text of them, across its windows", () => {
    // Fewer to a window than the scanner keeps of one detector there (512).
    const unit: string = `u=2606%3A%3A1 ${"x".repeat(300)} v=10%2E0%2E0%2E1 `;
    const text: string = repeat(unit, unit.length * 1000);
    const found: Array<TextMatch> = findSensitiveValues(text, {
      detectors: IP_ADDRESS_DETECTORS,
    });

    expect(found).toHaveLength(1000);
    expect(
      found.every((match: TextMatch): boolean => {
        return (
          text.slice(match.start, match.end) === "2606%3A%3A1" &&
          match.normalized === "2606::1"
        );
      }),
    ).toBe(true);
  });
});
