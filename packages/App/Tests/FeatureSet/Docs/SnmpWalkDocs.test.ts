import {
  SNMP_WALK_START_POINTS,
  SnmpWalkStartPoint,
  getSnmpWalkAlertCondition,
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
      `**Common starting points**: ${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}.`,
    );
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
      "Common starting points",
      "Walk",
      "Continue walking",
      "Collect",
      "Alert on it",
      "Copy OID",
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

  it("describes the criteria Alert on it starts with, for each kind of value", () => {
    expect(CheckOn.SnmpOidValue).toBe("SNMP OID Value");
    expect(SECTION).toContain(
      `one **${CheckOn.SnmpOidValue}** criteria on the OID`,
    );

    // A counter or gauge alerts above the walked value.
    for (const type of [
      SnmpDataType.Counter32,
      SnmpDataType.Counter64,
      SnmpDataType.Gauge32,
    ]) {
      expect(getSnmpWalkAlertCondition(type)).toBe(FilterType.GreaterThan);
    }
    // An uptime alerts below it: the device restarted.
    expect(getSnmpWalkAlertCondition(SnmpDataType.TimeTicks)).toBe(
      FilterType.LessThan,
    );
    // Anything else, when it changes.
    expect(getSnmpWalkAlertCondition(SnmpDataType.OctetString)).toBe(
      FilterType.NotEqualTo,
    );
    expect(SECTION).toContain(
      "a counter or gauge alerts above it, an uptime below it (the device restarted), and anything else when it changes.",
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
      expect(section).toContain(
        `**${PermissionHelper.getTitle(Permission.CreateNetworkDeviceDiagnostic)}**`,
      );
    });
  },
);
