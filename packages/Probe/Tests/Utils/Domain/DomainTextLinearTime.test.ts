// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import DomainNameUtil from "../../../Utils/Domain/DomainName";
import { DomainRecordUtil } from "../../../Utils/Domain/DomainRecord";
import { buildHostNamingNote } from "../../../Jobs/Discovery/FetchScans";
import { SubnetScanResult } from "../../../Utils/Discovery/SubnetScanner";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import { namedPattern } from "Common/Tests/Helpers/SourcePatterns";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A DOMAIN'S NAME AND DATES, AND A REASON, ARE TRIMMED IN TIME IN LINE WITH
 * THEIR LENGTH - EXACTLY AS BEFORE.
 *
 * A domain monitor's name is whatever a project typed (it is checked only
 * for being there), a registration date is whatever a registry's or a
 * registrar's server sent, and both are read on probes that run every
 * project's monitors. The patterns that trimmed their ends - the root
 * label's trailing dots, a record id after a date - were tried again from
 * every character of a long run that did not end the text, each try
 * reading on to the end of the run: 64,000 characters took seconds,
 * 256,000 a minute. Each is now tried only where its run starts, which
 * takes exactly the run that ends the text, as before.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  const startedAt: number = Date.now();
  run();
  return Date.now() - startedAt;
};

const DOMAIN_NAME_FILE: string = "packages/Probe/Utils/Domain/DomainName.ts";
const DOMAIN_RECORD_FILE: string = "packages/Probe/Utils/Domain/DomainRecord.ts";
const FETCH_SCANS_FILE: string = "packages/Probe/Jobs/Discovery/FetchScans.ts";

describe("text built to be slow is trimmed quickly", () => {
  test.each([
    ["a run of dots that does not end the name", repeat(".", LENGTH) + "\u0000."],
    ["dots between letters", repeat("a.", LENGTH) + "x"],
    ["a pasted address with a long run of dots", "https://" + repeat(".", LENGTH) + "x/"],
  ])("a domain name of %s", (_label: string, name: string) => {
    expect(
      timeOf(() => {
        DomainNameUtil.normalize(name);
      }),
    ).toBeLessThan(2000);
  });

  test.each([
    ["a run of tabs before a record id that does not end it", "x" + repeat("\t", LENGTH) + "\u0000\t#\u0000 x"],
    ["spaces before a hash", "2026-01-01" + repeat(" ", LENGTH) + "#x y"],
    ["record ids over and over", repeat(" #1", LENGTH)],
  ])("a registration date of %s", (_label: string, date: string) => {
    expect(
      timeOf(() => {
        DomainRecordUtil.normalizeDate(date);
      }),
    ).toBeLessThan(2000);
  });

  test("a reverse DNS failure reason with a long run of full stops", () => {
    const reason: string = "lookup failed" + repeat(". ", LENGTH) + "x";
    let note: string = "";

    expect(
      timeOf(() => {
        note = buildHostNamingNote({
          reverseDnsOutcome: {
            resolvedCount: 0,
            addressCount: 10,
            namedAddressCount: 0,
            isTimeBudgetExhausted: false,
            isReverseDnsAvailable: true,
            error: reason,
          },
        } as unknown as SubnetScanResult);
      }),
    ).toBeLessThan(2000);
    expect(note).toContain("Reverse DNS lookups failed on this probe (");
  });
});

describe("what is trimmed is what the patterns trimmed", () => {
  test.each([
    [DOMAIN_NAME_FILE, "TRAILING_DOTS_PATTERN", /\.+$/, [".", "a", "\u0000", "..", "-"]],
    [
      DOMAIN_RECORD_FILE,
      "TRAILING_RECORD_ID_PATTERN",
      /\s+#\S+$/,
      [" ", "\t", "\n", "\u00a0", "#", "#1", "x", "1", "\u0000"],
    ],
    [
      FETCH_SCANS_FILE,
      "TRAILING_STOPS_PATTERN",
      /[.\s]+$/,
      [".", " ", "\t", "\n", "\u2028", "x", "..", ". "],
    ],
  ])(
    "%s: %s, on forty thousand drawn texts",
    (
      file: string,
      name: string,
      before: RegExp,
      alphabet: ReadonlyArray<string>,
    ) => {
      const pattern: RegExp = namedPattern(file, name);
      const differences: Array<string> = [];

      for (const text of generatedTexts(40000, 2357, alphabet, 14)) {
        if (text.replace(pattern, "") !== text.replace(before, "")) {
          differences.push(JSON.stringify(text));
        }
      }

      expect(differences).toEqual([]);
    },
  );

  test("the names, dates and reasons they are written for", () => {
    expect(DomainNameUtil.normalize("Example.COM.")).toBe("example.com");
    expect(DomainNameUtil.normalize("example.com...")).toBe("example.com");
    expect(DomainNameUtil.normalize("https://user@example.com:8080/x")).toBe(
      "example.com",
    );
    expect(DomainRecordUtil.normalizeDate("19960424 #7137")).toBe(
      "1996-04-24T00:00:00.000Z",
    );
    expect(DomainRecordUtil.normalizeDate("2026-01-01T00:00:00Z")).toBe(
      "2026-01-01T00:00:00.000Z",
    );

    const note: string = buildHostNamingNote({
      reverseDnsOutcome: {
        resolvedCount: 0,
        addressCount: 10,
        namedAddressCount: 0,
        isTimeBudgetExhausted: false,
        isReverseDnsAvailable: true,
        error: "The UDP socket did not bind in time.",
      },
    } as unknown as SubnetScanResult);

    expect(note).toContain("(The UDP socket did not bind in time)");
  });
});
