import {
  SNMP_WALK_START_POINTS,
  SNMP_WALK_UPTIME_RESTART_THRESHOLD,
  SnmpWalkAlertThreshold,
  SnmpWalkStartPoint,
  getSnmpWalkAlertCriteria,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkViewModel";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { readPage } from "./DocsContentSupport";
import {
  NETWORK_DEVICE_PAGE,
  anchorInLanguage,
  drawnNetworkLabel,
  sectionInLanguage,
} from "./NetworkDocsLabels";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import { NETWORK_DEVICE_DIAGNOSTIC_RETENTION_IN_DAYS } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import {
  SNMP_WALK_MAX_OIDS,
  SNMP_WALK_TIME_BUDGET_IN_MS,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5184: the Network Device guide's section on a device's SNMP Walk
 * page, held to the code that makes it true - the walk's bounds, the
 * starting points the page offers, where the page sits in the device's
 * menu, what Alert on it sets up and who may walk - and present, with its
 * troubleshooting link, in every docs language. NetworkDocsTranslations
 * holds the translations to the English page line for line and their bold
 * labels to the Dashboard's locales.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const HEADING: string = "### Finding OIDs with an SNMP Walk";
const ANCHOR: string = "finding-oids-with-an-snmp-walk";

const NUMBER_WORDS: Record<number, string> = {
  2: "two",
  10: "ten",
};

function readSource(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

const ENGLISH: string = readPage("en", NETWORK_DEVICE_PAGE);
const SECTION: string = sectionInLanguage("en", NETWORK_DEVICE_PAGE, HEADING);

describe("the English section on the SNMP Walk page", () => {
  it("sits after Custom OIDs, where a reader looks for OIDs to add, and before SNMP Tables", () => {
    const lines: Array<string> = ENGLISH.split("\n");
    const custom: number = lines.indexOf("### Custom OIDs");
    const walk: number = lines.indexOf(HEADING);
    const tables: number = lines.indexOf("### SNMP Tables");

    expect(custom).toBeGreaterThan(0);
    expect(walk).toBeGreaterThan(custom);
    expect(tables).toBeGreaterThan(walk);
  });

  it("states the walk's bounds as the probe is handed them", () => {
    expect(SNMP_WALK_MAX_OIDS).toBe(1000);
    expect(SNMP_WALK_TIME_BUDGET_IN_MS).toBe(45000);

    const oids: string = SNMP_WALK_MAX_OIDS.toLocaleString("en-US");

    expect(SECTION).toContain(
      `at most ${oids} OIDs in at most ${SNMP_WALK_TIME_BUDGET_IN_MS / 1000} seconds`,
    );
    expect(SECTION).toContain(`reads the next ${oids} from where it stopped`);
  });

  it("says the probe picks the walk up on its ten-second diagnostics fetch", () => {
    expect(
      readSource("Probe/Jobs/NetworkDevice/FetchDiagnostics.ts"),
    ).toContain("schedule: EVERY_TEN_SECONDS,");
    expect(SECTION).toContain(
      `picks the walk up within ${NUMBER_WORDS[10]} seconds`,
    );
  });

  it("keeps walks as long as the service keeps every diagnostic", () => {
    expect(SECTION).toContain(
      `its walks are kept for ${NUMBER_WORDS[NETWORK_DEVICE_DIAGNOSTIC_RETENTION_IN_DAYS]} days`,
    );
  });

  it("lists the page's starting points, in the page's order", () => {
    const labels: Array<string> = SNMP_WALK_START_POINTS.map(
      (point: SnmpWalkStartPoint): string => {
        return `**${point.label}**`;
      },
    );

    expect(labels.length).toBe(5);
    expect(SECTION).toContain(
      `or press one of the starting points below it: ${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}.`,
    );
  });

  /*
   * "Common starting points" names the buttons' group for a screen reader
   * only: nobody sees it, so the page does not write it as a label to look
   * for (issue #5215).
   */
  it("does not send a reader looking for a name only a screen reader hears", () => {
    const card: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkCard.tsx",
    );

    expect(card).toContain(
      'aria-label={translator.translateText("Common starting points")}',
    );
    expect(card.split('"Common starting points"').length - 1).toBe(1);

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const section: string = sectionInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        HEADING,
      );

      expect({
        language,
        named: section.includes(
          `**${drawnNetworkLabel(language, "Common starting points")}**`,
        ),
      }).toEqual({ language, named: false });
    }
  });

  it("finds the page under More in the device's menu", () => {
    const menu: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/SideMenu.tsx",
    );
    const more: number = menu.indexOf('<SideMenuSection title="More"');
    const walk: number = menu.indexOf('title: "SNMP Walk"');

    expect(more).toBeGreaterThan(-1);
    expect(walk).toBeGreaterThan(more);
    expect(SECTION).toContain(
      "A device's **SNMP Walk** page, under **More** in its menu,",
    );
  });

  it("names the page's controls as the page draws them", () => {
    const page: string = [
      "App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkCard.tsx",
      "App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkResults.tsx",
    ]
      .map(readSource)
      .join("\n");

    for (const label of [
      "Start at OID",
      "Walk",
      "Continue walking",
      "Collect",
      "Alert on it",
      "Copy OID",
      "Download",
      "snmpwalk text (.txt)",
      "CSV spreadsheet (.csv)",
    ]) {
      expect({ label, drawn: page.includes(`"${label}"`) }).toEqual({
        label,
        drawn: true,
      });
      expect({ label, named: SECTION.includes(`**${label}**`) }).toEqual({
        label,
        named: true,
      });
    }
  });

  it("offers Alert on it once the OID is collected, as the results do", () => {
    const results: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkResults.tsx",
    ).replace(/\s+/g, " ");

    expect(results).toContain(
      "const alertRoute: Route | undefined = isCollected ? actions.getAlertRoute?.(row) : undefined;",
    );
    expect(SECTION).toContain(
      "- **Alert on it**, once the OID is collected, opens a new Network Device monitor",
    );
  });

  /*
   * Issue #5215: a counter only grows, so it starts on its rate; a gauge on
   * its value; both above a threshold the person sets (none is prefilled).
   * An uptime alerts below ten minutes, and anything else when it changes
   * from the walked value.
   */
  it("describes the criteria Alert on it starts with, for each kind of value", () => {
    for (const type of [SnmpDataType.Counter32, SnmpDataType.Counter64]) {
      expect(getSnmpWalkAlertCriteria(type)).toEqual({
        checkOn: CheckOn.SnmpOidRatePerSecond,
        filterType: FilterType.GreaterThan,
        threshold: SnmpWalkAlertThreshold.None,
      });
    }

    expect(getSnmpWalkAlertCriteria(SnmpDataType.Gauge32)).toEqual({
      checkOn: CheckOn.SnmpOidValue,
      filterType: FilterType.GreaterThan,
      threshold: SnmpWalkAlertThreshold.None,
    });
    expect(getSnmpWalkAlertCriteria(SnmpDataType.TimeTicks)).toEqual({
      checkOn: CheckOn.SnmpOidValue,
      filterType: FilterType.LessThan,
      threshold: SnmpWalkAlertThreshold.RecentRestart,
    });
    // Hundredths of a second: ten minutes.
    expect(SNMP_WALK_UPTIME_RESTART_THRESHOLD).toBe(10 * 60 * 100);
    expect(getSnmpWalkAlertCriteria(SnmpDataType.OctetString)).toEqual({
      checkOn: CheckOn.SnmpOidValue,
      filterType: FilterType.NotEqualTo,
      threshold: SnmpWalkAlertThreshold.WalkedValue,
    });

    expect(SECTION).toContain(
      `with one criteria on the OID. A counter starts on **${CheckOn.SnmpOidRatePerSecond}** and a gauge on **${CheckOn.SnmpOidValue}**, each above a threshold you set; an uptime alerts below ${NUMBER_WORDS[10]} minutes (the device restarted), and anything else when it changes from the walked value.`,
    );
  });

  it("lists the counter rate among the criteria, with no verdict on a poll that walked nothing", () => {
    expect(ENGLISH).toContain(
      `| ${CheckOn.SnmpOidRatePerSecond} | How fast a counter OID grew, per second, since the previous poll: a counter only grows, so alert on this, not on its value. No verdict until it has been read twice. | Not evaluated |`,
    );
    expect(ENGLISH).toContain(
      `the **${CheckOn.SnmpOidValue}**, **${CheckOn.SnmpOidExists}** and **${CheckOn.SnmpOidRatePerSecond}** criteria alert on them.`,
    );

    const rows: Array<string> = ENGLISH.split("\n");
    const exists: number = rows.findIndex((row: string): boolean => {
      return row.startsWith(`| ${CheckOn.SnmpOidExists} |`);
    });

    expect(rows[exists + 1]).toContain(`| ${CheckOn.SnmpOidRatePerSecond} |`);
  });

  /*
   * #5281: Download saves the walk as a file, in either format the card's
   * menu offers, as SnmpWalkExport writes it - every OID the walk read,
   * whatever the filter shows - for anyone who can read the walk.
   */
  it("says what Download saves, as SnmpWalkExport writes it", () => {
    const exporter: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkExport.ts",
    );
    const card: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkCard.tsx",
    );

    // The CSV's columns, and the text file's numeric OIDs from a leading dot.
    expect(exporter).toContain(
      'export const SNMP_WALK_CSV_COLUMNS: ReadonlyArray<string> = [\n  "OID",\n  "Name",\n  "MIB",\n  "Type",\n  "Value",\n];',
    );
    expect(exporter).toContain('return normalized ? `.${normalized}` : "";');
    expect(SECTION).toContain(
      "**CSV spreadsheet (.csv)**, with each OID's name, MIB, type and value.",
    );
    expect(SECTION).toContain(
      "**snmpwalk text (.txt)**, one OID a line as `snmpwalk -On` prints it",
    );

    // Every row the walk read, not the filtered ones the page shows.
    expect(card).toContain(
      "const file: SnmpWalkExportFile = buildSnmpWalkExport({\n      rows: rows,",
    );
    expect(SECTION).toContain(
      "The file holds every OID the walk read, continued walks included, whatever the filter shows,",
    );

    // Named after the device, the subtree and the time.
    expect(exporter).toContain(
      "return `${device}-snmp-walk-${root}-${time}.${EXTENSIONS[data.format]}`;",
    );
    expect(SECTION).toContain(
      "and is named after the device, the subtree and the time it was saved.",
    );

    // Offered whenever the walk read something, whoever may walk.
    expect(card).toContain("{rows.length > 0 ? getDownloadMenu() : <></>}");
    expect(SECTION).toContain(
      "Anyone who can read the device's last walk can download it.",
    );
  });

  it("names the permission walking needs as the role editor does", () => {
    expect(SECTION).toContain(
      `Walking needs the **${PermissionHelper.getTitle(Permission.CreateNetworkDeviceDiagnostic)}** permission`,
    );
  });

  it("points the SNMP testing entry of Troubleshooting at the section", () => {
    const testing: string = ENGLISH.slice(
      ENGLISH.indexOf(":::details Testing SNMP from the probe's network"),
    );

    expect(testing).toContain(
      `its **SNMP Walk** page runs that test for you from the probe`,
    );
    expect(testing).toContain(`](#${ANCHOR})`);
  });
});

describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
  "the %s Network Device guide",
  (language: string) => {
    const guide: string = readPage(language, NETWORK_DEVICE_PAGE);

    it("has the section where the English page has it, and links to it from Troubleshooting", () => {
      const anchor: string | null = anchorInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        ANCHOR,
      );

      expect(anchor).not.toBeNull();
      expect(guide).toContain(`](#${anchor})`);
    });

    it("names the page as this language's Dashboard draws it, and shows the snmpwalk it replaces", () => {
      const section: string = sectionInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        HEADING,
      );

      expect(section).toContain(
        `**${drawnNetworkLabel(language, "SNMP Walk")}**`,
      );
      expect(section).toContain("`snmpwalk`");

      // Download, and the two files it saves, as the card draws them (#5281).
      for (const label of [
        "Download",
        "snmpwalk text (.txt)",
        "CSV spreadsheet (.csv)",
      ]) {
        expect({
          language,
          label,
          named: section.includes(`**${drawnNetworkLabel(language, label)}**`),
        }).toEqual({ language, label, named: true });
      }
      expect(section).toContain("`snmpwalk -On`");
      expect(section).toContain(
        `**${PermissionHelper.getTitle(Permission.CreateNetworkDeviceDiagnostic)}**`,
      );
    });
  },
);
