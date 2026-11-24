import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { ScrubRegExp } from "../../../Types/Telemetry/ScrubRule";
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
