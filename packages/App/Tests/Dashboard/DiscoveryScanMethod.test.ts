import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DISCOVERY_SCAN_ICMP_OPTION_DESCRIPTION,
  DISCOVERY_SCAN_ICMP_OPTION_TITLE,
  DISCOVERY_SCAN_METHOD_BADGE_TEXT,
  DISCOVERY_SCAN_METHOD_FIELD_DESCRIPTION,
  DISCOVERY_SCAN_METHOD_FIELD_TITLE,
  DISCOVERY_SCAN_METHOD_LABELS,
  DISCOVERY_SCAN_METHOD_OPTIONS,
  DISCOVERY_SCAN_SNMP_OPTION_DESCRIPTION,
  DISCOVERY_SCAN_SNMP_OPTION_TITLE,
  DiscoveryScanMethod,
  DiscoveryScanMethodBadge,
  NEW_DISCOVERY_SCAN_FORM_VALUES,
  NEW_DISCOVERY_SCAN_METHOD,
  getDiscoveryScanMethod,
  getDiscoveryScanMethodBadge,
  getDiscoveryScanMethodOption,
  isSnmpEnabledForMethod,
  readDiscoveryScanMethod,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/DiscoveryScanMethod";
import {
  isIcmpOnlyScan,
  isSnmpStepNeeded,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/DiscoveryScanFormValidation";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import IconProp from "Common/Types/Icon/IconProp";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ScanModeUtil, {
  ScanMethodLabel,
} from "Common/Utils/NetworkDiscovery/ScanModeUtil";

/*
 * A discovery scan's method: ICMP or SNMP, two cards on the Start Scan form.
 *
 * The maintainer's ask, word for word: "Shouldnt this be two buttons - ICMP
 * or SNMP with ICMP to make it easier for people to understand whats going
 * on. ICMP selected by default." It replaced a switch, "Check SNMP on hosts
 * that answer", on by default, with five lines of help under it.
 *
 * These tests hold the React-free half: which method a stored value means,
 * what a pick stores, what a new scan starts on, and the words on the cards
 * and the scan list's badge - in English and in every language the
 * dashboard ships.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function readLocale(fileName: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, fileName), "utf8"),
  ) as Record<string, string>;
}

const OTHER_LOCALES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string): boolean => {
    return fileName.endsWith(".json") && fileName !== "en.json";
  })
  .sort();

describe("the two methods", () => {
  test("are ICMP and SNMP, stored by these values", () => {
    expect(DiscoveryScanMethod.Icmp).toBe("icmp");
    expect(DiscoveryScanMethod.Snmp).toBe("snmp");
  });

  test("a pick of SNMP stores true, a pick of ICMP stores false", () => {
    expect(isSnmpEnabledForMethod(DiscoveryScanMethod.Snmp)).toBe(true);
    expect(isSnmpEnabledForMethod(DiscoveryScanMethod.Icmp)).toBe(false);
  });

  test("what a pick stores reads back as the same method", () => {
    for (const method of [DiscoveryScanMethod.Icmp, DiscoveryScanMethod.Snmp]) {
      expect(
        getDiscoveryScanMethod({
          isSnmpEnabled: isSnmpEnabledForMethod(method),
        }),
      ).toBe(method);
    }
  });

  test("a stored false is ICMP and a stored true is SNMP", () => {
    expect(getDiscoveryScanMethod({ isSnmpEnabled: false })).toBe(
      DiscoveryScanMethod.Icmp,
    );
    expect(getDiscoveryScanMethod({ isSnmpEnabled: true })).toBe(
      DiscoveryScanMethod.Snmp,
    );
  });

  /*
   * Absent is SNMP: every scan stored before the column was an SNMP sweep,
   * and the probe and the form's step list read an absent value the same
   * way. Only a new scan starts on ICMP, from the create form's values.
   */
  test("an absent value is SNMP, as ScanModeUtil reads it everywhere", () => {
    for (const scan of [
      undefined,
      null,
      {},
      { isSnmpEnabled: undefined },
      { isSnmpEnabled: null },
      new NetworkDeviceDiscoveryScan(),
    ]) {
      expect(getDiscoveryScanMethod(scan)).toBe(DiscoveryScanMethod.Snmp);
      expect(ScanModeUtil.isSnmpEnabled(scan)).toBe(true);
    }
  });

  test("a scan model with the column false is ICMP", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.isSnmpEnabled = false;

    expect(getDiscoveryScanMethod(scan)).toBe(DiscoveryScanMethod.Icmp);
  });

  test("a card's value reads back as its method, and nothing else does", () => {
    expect(readDiscoveryScanMethod("icmp")).toBe(DiscoveryScanMethod.Icmp);
    expect(readDiscoveryScanMethod("snmp")).toBe(DiscoveryScanMethod.Snmp);

    for (const value of [
      "ICMP",
      "SNMP",
      "ping",
      "",
      " icmp",
      true,
      false,
      0,
      1,
      null,
      undefined,
      {},
      ["icmp"],
    ]) {
      expect(readDiscoveryScanMethod(value)).toBeNull();
    }
  });
});

describe("a new scan", () => {
  test("starts on ICMP", () => {
    expect(NEW_DISCOVERY_SCAN_METHOD).toBe(DiscoveryScanMethod.Icmp);
  });

  test("starts the create form with the column false, and nothing else", () => {
    expect(NEW_DISCOVERY_SCAN_FORM_VALUES).toEqual({ isSnmpEnabled: false });
  });

  /*
   * ICMP is the simpler choice because it asks nothing more: the create
   * form's starting values need no credentials step.
   */
  test("asks for no credentials: no SNMP step, an ICMP-only scan", () => {
    const values: FormValues<NetworkDeviceDiscoveryScan> = {
      ...NEW_DISCOVERY_SCAN_FORM_VALUES,
    };

    expect(isSnmpStepNeeded(values)).toBe(false);
    expect(isIcmpOnlyScan(values)).toBe(true);
  });

  test("picking SNMP brings the credentials step", () => {
    const values: FormValues<NetworkDeviceDiscoveryScan> = {
      ...NEW_DISCOVERY_SCAN_FORM_VALUES,
      isSnmpEnabled: isSnmpEnabledForMethod(DiscoveryScanMethod.Snmp),
    };

    expect(isSnmpStepNeeded(values)).toBe(true);
    expect(isIcmpOnlyScan(values)).toBe(false);
  });

  /*
   * The FORM starts on ICMP; the COLUMN keeps its default of SNMP, for the
   * scans stored before the choice, for API and Terraform callers that never
   * send it, and for a probe that polls a server too old to select it.
   */
  test("leaves the column's own default at SNMP", () => {
    const metadata: TableColumnMetadata =
      new NetworkDeviceDiscoveryScan().getTableColumnMetadata("isSnmpEnabled");

    expect(metadata.defaultValue).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
  });
});

describe("the two cards", () => {
  test("are ICMP first, then SNMP", () => {
    expect(
      DISCOVERY_SCAN_METHOD_OPTIONS.map((option: CardSelectOption): string => {
        return option.value;
      }),
    ).toEqual([DiscoveryScanMethod.Icmp, DiscoveryScanMethod.Snmp]);
  });

  test("say what each method does, in a line each", () => {
    expect(getDiscoveryScanMethodOption(DiscoveryScanMethod.Icmp)).toEqual({
      value: "icmp",
      title: "ICMP (ping)",
      description: "Finds the devices that answer ping. No credentials needed.",
      icon: IconProp.Signal,
    });
    expect(getDiscoveryScanMethodOption(DiscoveryScanMethod.Snmp)).toEqual({
      value: "snmp",
      title: "SNMP",
      description:
        "Also reads each device's name and vendor. Needs SNMP credentials.",
      icon: IconProp.Key,
    });
  });

  test("tell the methods apart by what they need", () => {
    expect(DISCOVERY_SCAN_ICMP_OPTION_DESCRIPTION).toContain(
      "No credentials needed",
    );
    expect(DISCOVERY_SCAN_SNMP_OPTION_DESCRIPTION).toContain(
      "Needs SNMP credentials",
    );
  });

  /*
   * The sweep reads the SNMP system group - a name and a vendor. A device's
   * model and interfaces come later, from its own polls, so the card does not
   * promise them.
   */
  test("SNMP promises only what the sweep reads", () => {
    expect(DISCOVERY_SCAN_SNMP_OPTION_DESCRIPTION).not.toMatch(
      /interface|model|health|inventory/i,
    );
  });

  test("each line is short: one line on a card, nothing about a switch", () => {
    for (const option of DISCOVERY_SCAN_METHOD_OPTIONS) {
      expect(option.description.length).toBeLessThanOrEqual(80);
      expect(option.description).not.toMatch(/turn (it )?(on|off)|switch/i);
    }
  });

  test("the field asks for a scan method, and says the choice is not final", () => {
    expect(DISCOVERY_SCAN_METHOD_FIELD_TITLE).toBe("Scan method");
    expect(DISCOVERY_SCAN_METHOD_FIELD_DESCRIPTION).toBe(
      "You can change this at any time.",
    );
  });
});

describe("the scan list's badge", () => {
  test("is the method's word, the same word Common uses everywhere", () => {
    expect(DISCOVERY_SCAN_METHOD_BADGE_TEXT).toEqual({
      icmp: "ICMP",
      snmp: "SNMP",
    });

    for (const method of [DiscoveryScanMethod.Icmp, DiscoveryScanMethod.Snmp]) {
      expect(DISCOVERY_SCAN_METHOD_BADGE_TEXT[method]).toBe(
        DISCOVERY_SCAN_METHOD_LABELS[method],
      );
    }

    expect(DISCOVERY_SCAN_METHOD_LABELS).toEqual({
      icmp: ScanMethodLabel.Icmp,
      snmp: ScanMethodLabel.Snmp,
    });
  });

  test("names each scan's method, with its card's line as the tooltip", () => {
    const icmp: DiscoveryScanMethodBadge = getDiscoveryScanMethodBadge({
      isSnmpEnabled: false,
    });
    const snmp: DiscoveryScanMethodBadge = getDiscoveryScanMethodBadge({
      isSnmpEnabled: true,
    });

    expect(icmp).toEqual({
      text: "ICMP",
      description: DISCOVERY_SCAN_ICMP_OPTION_DESCRIPTION,
    });
    expect(snmp).toEqual({
      text: "SNMP",
      description: DISCOVERY_SCAN_SNMP_OPTION_DESCRIPTION,
    });
  });

  test("names a scan stored without the column SNMP", () => {
    expect(getDiscoveryScanMethodBadge({}).text).toBe("SNMP");
    expect(getDiscoveryScanMethodBadge(null).text).toBe("SNMP");
  });
});

describe("the words, in every language", () => {
  const WORDS: Array<string> = [
    DISCOVERY_SCAN_METHOD_FIELD_TITLE,
    DISCOVERY_SCAN_METHOD_FIELD_DESCRIPTION,
    DISCOVERY_SCAN_ICMP_OPTION_TITLE,
    DISCOVERY_SCAN_ICMP_OPTION_DESCRIPTION,
    DISCOVERY_SCAN_SNMP_OPTION_TITLE,
    DISCOVERY_SCAN_SNMP_OPTION_DESCRIPTION,
    DISCOVERY_SCAN_METHOD_BADGE_TEXT[DiscoveryScanMethod.Icmp],
    DISCOVERY_SCAN_METHOD_BADGE_TEXT[DiscoveryScanMethod.Snmp],
  ];

  // Sentences and the label: protocol names may read the same everywhere.
  const TRANSLATED: Array<string> = [
    DISCOVERY_SCAN_METHOD_FIELD_TITLE,
    DISCOVERY_SCAN_METHOD_FIELD_DESCRIPTION,
    DISCOVERY_SCAN_ICMP_OPTION_DESCRIPTION,
    DISCOVERY_SCAN_SNMP_OPTION_DESCRIPTION,
  ];

  test("are English keys the dashboard can look up", () => {
    const english: Record<string, string> = readLocale("en.json");

    for (const word of WORDS) {
      expect(english[word]).toBe(word);
    }
  });

  test("ships sixteen other languages", () => {
    expect(OTHER_LOCALES).toHaveLength(16);
  });

  test.each(OTHER_LOCALES)("%s has every word", (fileName: string) => {
    const locale: Record<string, string> = readLocale(fileName);

    for (const word of WORDS) {
      expect(typeof locale[word]).toBe("string");
      expect(locale[word]!.trim().length).toBeGreaterThan(0);
    }

    for (const sentence of TRANSLATED) {
      expect(locale[sentence]).not.toBe(sentence);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s keeps the protocol names in the card titles",
    (fileName: string) => {
      const locale: Record<string, string> = readLocale(fileName);

      expect(locale[DISCOVERY_SCAN_ICMP_OPTION_TITLE]).toContain("ICMP");
      expect(locale[DISCOVERY_SCAN_SNMP_OPTION_TITLE]).toBe("SNMP");
      expect(locale[DISCOVERY_SCAN_SNMP_OPTION_DESCRIPTION]).toContain("SNMP");
    },
  );

  // The old switch is gone from every language.
  test.each(["en.json", ...OTHER_LOCALES])(
    "%s no longer carries the old switch",
    (fileName: string) => {
      const locale: Record<string, string> = readLocale(fileName);

      expect(locale["Check SNMP on hosts that answer"]).toBeUndefined();
    },
  );
});
