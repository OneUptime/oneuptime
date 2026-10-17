import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DISCOVERY_SCAN_ICMP_OPTION_TITLE,
  DISCOVERY_SCAN_METHOD_FIELD_TITLE,
  DISCOVERY_SCAN_SNMP_OPTION_TITLE,
  DiscoveryScanMethod,
  NEW_DISCOVERY_SCAN_METHOD,
} from "../../../FeatureSet/Dashboard/src/Pages/NetworkDevice/DiscoveryScanMethod";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { drawnActionLabel } from "./DocsDashboardLabels";
import { NETWORK_DEVICE_PAGE, sectionInLanguage } from "./NetworkDocsLabels";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { AutoImportRuleMatcher } from "Common/Utils/NetworkDiscovery/AutoImportRuleMatcher";

/*
 * The Network Device Monitor page on a discovery scan's method: ICMP (ping)
 * or SNMP, two cards on Start New Scan, ICMP for a new scan.
 *
 * The page used to describe a switch, "Check SNMP on hosts that answer", on
 * by default, chosen when the scan was created "and fixed after that" - which
 * was not even true: a scan's Edit has changed it since scans gained an edit
 * form, running the scan again. These tests hold the page to the product:
 *
 *   - it names the method as the form does, the cards in their order, and
 *     says a new scan starts on ICMP because Start New Scan does;
 *   - it says the method can be changed and that the scan then runs again,
 *     because the method is one of the columns that retire a scan's run;
 *   - it says an ICMP scan's hosts reach an auto import rule only with
 *     Include Ping-Only Hosts on, because the rule matcher holds them back
 *     otherwise;
 *   - and no language still names the old switch.
 */

const REPOSITORY_PACKAGES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
);

function readSource(relative: string): string {
  return fs.readFileSync(path.join(REPOSITORY_PACKAGES, relative), "utf8");
}

const ENGLISH: string = readPage("en", NETWORK_DEVICE_PAGE);

const DISCOVERY_SECTION: string = sectionInLanguage(
  "en",
  NETWORK_DEVICE_PAGE,
  "## Discovering Devices with a Network Scan",
);

const ICMP_SECTION: string = sectionInLanguage(
  "en",
  NETWORK_DEVICE_PAGE,
  "### ICMP Scans",
);

// The table row the page gives a field, by the field's name in its first cell.
function fieldRow(markdown: string, field: string): string | undefined {
  return markdown.split("\n").find((line: string): boolean => {
    return line.startsWith(`| ${field} |`);
  });
}

describe("the English page", () => {
  it("names the scan method as the form does, with its two cards", () => {
    const row: string | undefined = fieldRow(
      DISCOVERY_SECTION,
      DISCOVERY_SCAN_METHOD_FIELD_TITLE,
    );

    expect(row).toBeDefined();
    expect(row).toContain(`**${DISCOVERY_SCAN_ICMP_OPTION_TITLE}**`);
    expect(row).toContain(`**${DISCOVERY_SCAN_SNMP_OPTION_TITLE}**`);
    // ICMP first, as the cards are.
    expect(row!.indexOf(DISCOVERY_SCAN_ICMP_OPTION_TITLE)).toBeLessThan(
      row!.indexOf(`**${DISCOVERY_SCAN_SNMP_OPTION_TITLE}**`),
    );
  });

  it("says a new scan starts on ICMP, because Start New Scan does", () => {
    expect(NEW_DISCOVERY_SCAN_METHOD).toBe(DiscoveryScanMethod.Icmp);
    expect(
      fieldRow(DISCOVERY_SECTION, DISCOVERY_SCAN_METHOD_FIELD_TITLE),
    ).toContain(`A new scan starts on **${DISCOVERY_SCAN_ICMP_OPTION_TITLE}**`);
    expect(DISCOVERY_SECTION).toContain(
      `pick the **${DISCOVERY_SCAN_METHOD_FIELD_TITLE}**: **${DISCOVERY_SCAN_ICMP_OPTION_TITLE}**, which a new scan starts on, or **SNMP**.`,
    );
  });

  it("asks for credentials only on an SNMP scan", () => {
    expect(DISCOVERY_SECTION).toContain(
      "Only an SNMP scan asks for credentials: picking **SNMP** adds the **SNMP Credentials** step",
    );
    expect(fieldRow(DISCOVERY_SECTION, "Credentials to try")).toContain(
      "| When the method is SNMP |",
    );
  });

  /*
   * Changing the method retires the scan's run: the service lists it among
   * the columns that decide what a sweep asks, and the Edit dialog's warning
   * names it.
   */
  it("says the method can be changed on Edit, and that the scan then runs again", () => {
    const service: string = readSource(
      "Common/Server/Services/NetworkDeviceDiscoveryScanService.ts",
    );
    const sweepColumns: string =
      service
        .split("const SWEEP_COLUMNS: Array<string> = [")[1]
        ?.split("];")[0] || "";

    expect(sweepColumns).toContain('"isSnmpEnabled"');
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery.tsx",
      ),
    ).toContain(
      "Changing the target, probe, scan method or credentials runs the scan again",
    );

    expect(ICMP_SECTION).toContain(
      "You can change the method later, on the scan's **Edit**. A changed method runs the scan again: the hosts its last run found are cleared, and devices you already imported stay as they are.",
    );
    expect(ENGLISH).not.toContain(
      "cannot be changed: a scan created ping-only",
    );
    expect(ENGLISH).not.toContain("fixed after that");
  });

  /*
   * An ICMP scan reports every host as ping-only, and an import rule claims
   * a ping-only host only with Include Ping-Only Hosts on.
   */
  it("says an ICMP scan's hosts reach an auto import rule only with Include Ping-Only Hosts on", () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.5",
      snmpReachable: false,
    } as DiscoveredNetworkDevice;

    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { ipMatchTarget: "10.0.0.0/24" },
        host,
      ),
    ).toBe(false);
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { ipMatchTarget: "10.0.0.0/24", includePingOnlyHosts: true },
        host,
      ),
    ).toBe(true);

    expect(ENGLISH).toContain(
      "A rule with **Include Ping-Only Hosts** on also imports the hosts that answered ping only, every host an [ICMP scan](#icmp-scans) finds among them",
    );
  });

  it("calls the section ICMP Scans, and the scan an ICMP scan", () => {
    const headings: Array<string> = scanMarkdown(ENGLISH).headings.map(
      (heading: DocsHeading): string => {
        return heading.text;
      },
    );

    expect(headings).toContain("ICMP Scans");
    expect(headings).not.toContain("Ping-Only Scans");
    expect(ENGLISH).not.toMatch(/ping-only scan/i);
  });

  it("draws the decision as the scan method, with an arrow for each card", () => {
    const diagram: string = DISCOVERY_SECTION.split("```mermaid")[1] || "";

    expect(diagram).toContain('Check{"Scan method?"}');
    expect(diagram).toContain('Check -->|"SNMP"| Read');
    expect(diagram).toContain('Check -->|"ICMP"| Found');
  });

  it("tells an empty ICMP scan to switch to SNMP, not to turn a switch on", () => {
    expect(ICMP_SECTION).toContain(
      `change its **${DISCOVERY_SCAN_METHOD_FIELD_TITLE}** to **SNMP**.`,
    );
  });
});

describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])("%s", (language: string) => {
  const page: string = readPage(language, NETWORK_DEVICE_PAGE);

  it("no longer names the old switch", () => {
    expect(page).not.toContain("Check SNMP on hosts that answer");
    expect(page).not.toContain("Check SNMP on<br/>");
  });

  it("names the scan method and both cards as its Dashboard draws them", () => {
    const methodLabel: string = drawnActionLabel(
      language,
      DISCOVERY_SCAN_METHOD_FIELD_TITLE,
    );
    const row: string | undefined = fieldRow(page, methodLabel);

    expect(row).toBeDefined();
    expect(row).toContain(
      `**${drawnActionLabel(language, DISCOVERY_SCAN_ICMP_OPTION_TITLE)}**`,
    );
    expect(row).toContain(
      `**${drawnActionLabel(language, DISCOVERY_SCAN_SNMP_OPTION_TITLE)}**`,
    );
    expect(row).toContain(`**${drawnActionLabel(language, "Edit")}**`);
  });

  it("names Include Ping-Only Hosts as its Dashboard draws it", () => {
    expect(page).toContain(
      `**${drawnActionLabel(language, "Include Ping-Only Hosts")}**`,
    );
  });
});
