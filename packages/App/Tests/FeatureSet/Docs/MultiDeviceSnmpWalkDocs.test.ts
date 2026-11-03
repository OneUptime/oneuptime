import {
  MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
  MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/MultiDeviceSnmpWalkViewModel";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { readPage } from "./DocsContentSupport";
import {
  NETWORK_DEVICE_PAGE,
  anchorInLanguage,
  sectionInLanguage,
} from "./NetworkDocsLabels";
import { NETWORK_DEVICE_DIAGNOSTIC_RETENTION_IN_DAYS } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import { SNMP_WALK_MAX_OIDS } from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5548: the Network Device guide's section on walking many devices
 * at once, held to the code that makes it true - how many devices a walk
 * takes and how many OIDs each, how long the page waits, how long walks are
 * kept, the ways to the page, and the labels it names - and present in
 * every docs language, where the bulk actions' overview points at it.
 * NetworkDocsTranslations holds the translations to the English page line
 * for line and their bold labels to the Dashboard's locales.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const HEADING: string = "### Walking Many Devices at Once";
const ANCHOR: string = "walking-many-devices-at-once";

const NUMBER_WORDS: Record<number, string> = {
  2: "two",
  5: "five",
};

function readSource(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

const ENGLISH: string = readPage("en", NETWORK_DEVICE_PAGE);
const SECTION: string = sectionInLanguage("en", NETWORK_DEVICE_PAGE, HEADING);

const CARD: string = readSource(
  "App/FeatureSet/Dashboard/src/Components/NetworkDevice/MultiDeviceSnmpWalkCard.tsx",
);
const RESULTS: string = readSource(
  "App/FeatureSet/Dashboard/src/Components/NetworkDevice/MultiDeviceSnmpWalkResults.tsx",
);

describe("the English section on walking many devices", () => {
  it("follows a device's own SNMP Walk, which it builds on, and comes before SNMP Tables", () => {
    const lines: Array<string> = ENGLISH.split("\n");
    const deviceWalk: number = lines.indexOf(
      "### Finding OIDs with an SNMP Walk",
    );
    const many: number = lines.indexOf(HEADING);
    const tables: number = lines.indexOf("### SNMP Tables");

    expect(deviceWalk).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(deviceWalk);
    expect(tables).toBeGreaterThan(many);
  });

  it("states how many devices one walk takes, and how many OIDs each, as the page does", () => {
    expect(MULTI_DEVICE_SNMP_WALK_MAX_DEVICES).toBe(50);
    expect(SNMP_WALK_MAX_OIDS).toBe(1000);
    expect(SECTION).toContain(
      `Up to ${MULTI_DEVICE_SNMP_WALK_MAX_DEVICES} devices are walked at a time.`,
    );
    expect(SECTION).toContain(
      `at most ${SNMP_WALK_MAX_OIDS.toLocaleString("en-US")} OIDs a device`,
    );
  });

  it("says how long the page waits, and how long the walks are kept", () => {
    const waitInMinutes: number = MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS / 60000;

    expect(SECTION).toContain(
      `the page waits up to ${NUMBER_WORDS[waitInMinutes]} minutes for the slowest probe`,
    );
    expect(SECTION).toContain(
      `the walks are kept for ${NUMBER_WORDS[NETWORK_DEVICE_DIAGNOSTIC_RETENTION_IN_DAYS]} days`,
    );
  });

  it("names the three ways to the page, as the product offers them", () => {
    expect(SECTION).toContain("use **SNMP Walk** in **Bulk Actions**");
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkSnmpWalk.tsx",
      ),
    ).toContain('title: "SNMP Walk"');

    expect(SECTION).toContain("press **Compare with other devices**");
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkResults.tsx",
      ),
    ).toContain('translator.translateText("Compare with other devices")');

    expect(SECTION).toContain("**Network → Advanced → SNMP Walk**");

    const menu: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/Network/NetworkSideMenu.tsx",
    );

    expect(menu.indexOf('title: "SNMP Walk"')).toBeGreaterThan(
      menu.indexOf('title: "Advanced"'),
    );
  });

  it("names the results' labels the way the page draws them", () => {
    expect(SECTION).toContain("- **Answered by** says how many");
    expect(RESULTS).toContain('translator.translateText("Answered by")');

    expect(SECTION).toContain("- **Only OIDs some devices do not answer**");
    expect(RESULTS).toContain('title="Only OIDs some devices do not answer"');

    expect(SECTION).toContain("- **Collect on 12 devices** adds the OID");
    expect(RESULTS).toContain('other: "Collect on {{count}} devices"');

    expect(SECTION).toContain("**Download CSV** saves every OID");
    expect(CARD).toContain('title="Download CSV"');
  });

  it("never claims a device without an OID when its walk stopped before it", () => {
    expect(SECTION).toContain(
      "A device whose walk stopped at its limit before the OID is never counted as a device without it.",
    );
  });

  it("is where the bulk actions' overview sends a reader for SNMP Walk", () => {
    const bulk: string = sectionInLanguage(
      "en",
      NETWORK_DEVICE_PAGE,
      "## Changing Many Devices at Once",
    );

    expect(bulk).toContain(
      `**SNMP Walk** under [Walking Many Devices at Once](#${ANCHOR})`,
    );
  });
});

describe("the section in every docs language", () => {
  it("has a heading of its own in each language, on the English heading's line, with SNMP Tables moved down after it", () => {
    const englishLines: Array<string> = ENGLISH.split("\n");
    const englishLine: number = englishLines.indexOf(HEADING);
    const tablesLine: number = englishLines.indexOf("### SNMP Tables");

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const lines: Array<string> = readPage(
        language,
        NETWORK_DEVICE_PAGE,
      ).split("\n");
      const line: string = lines[englishLine] || "";
      const tables: string = lines[tablesLine] || "";

      expect({
        language,
        isHeading: line.startsWith("### "),
        isTablesHeading: tables.startsWith("### "),
        // Only the section's own heading sits between them.
        headingsBetween: lines
          .slice(englishLine + 1, tablesLine)
          .filter((text: string): boolean => {
            return text.startsWith("#");
          }).length,
      }).toEqual({
        language,
        isHeading: true,
        isTablesHeading: true,
        headingsBetween: 0,
      });
      expect(anchorInLanguage(language, NETWORK_DEVICE_PAGE, ANCHOR)).not.toBe(
        null,
      );
    }
  });

  it("is linked from each language's bulk actions overview, at the heading in that language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const anchor: string | null = anchorInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        ANCHOR,
      );
      const bulk: string = sectionInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        "## Changing Many Devices at Once",
      );

      expect({ language, linked: bulk.includes(`(#${anchor})`) }).toEqual({
        language,
        linked: true,
      });
    }
  });

  it("states the fifty devices and the thousand OIDs in each language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const section: string = sectionInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        HEADING,
      );
      // Digits as the language writes them: 1,000, 1.000, 1 000, ۱۰۰۰.
      const latin: string = section
        .replace(/[۰-۹]/g, (digit: string): string => {
          return String(digit.charCodeAt(0) - 0x06f0);
        })
        .replace(/[०-९]/g, (digit: string): string => {
          return String(digit.charCodeAt(0) - 0x0966);
        })
        .replace(/(\d)[\s  .,'٬](\d{3})(?!\d)/g, "$1$2");

      expect({ language, devices: latin.includes("50") }).toEqual({
        language,
        devices: true,
      });
      expect({ language, oids: latin.includes("1000") }).toEqual({
        language,
        oids: true,
      });
    }
  });
});
