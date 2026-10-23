import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  COLLECTOR_TEMPLATE,
  DIFFERENT_VALUE_TEMPLATE,
  FOUND_BY_TEMPLATE,
  FOUND_BY_UNNAMED_TEMPLATE,
  OTHER_MACHINE_TEMPLATE,
  OTHER_MACHINE_UNNAMED_TEMPLATE,
  SNMP_POLL_TEMPLATE,
  getAssetFactDifferenceLine,
  getAssetFactSourceLine,
  getAssetFactSourceText,
  getCollectorLine,
  getFoundByLine,
  getNativeSourceLine,
  getOtherMachineIdentity,
  getOtherMachineLine,
  getSnmpPollLine,
  isNativeAssetFactSource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/AssetFactSourceText";
import {
  NetworkDeviceDiscoveryMethod,
  NetworkDeviceDiscoveryReaderType,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  AssetFactSource,
  AssetFactSourceKind,
} from "../../../Utils/Inventory/AssetFactSource";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * Where an asset detail came from, and when, in words (OneUptime issue
 * #5185). Each source reads as one short sentence under the value - or, for
 * the source a machine's details come from unless they say otherwise, once
 * below them - in the reader's language, with the time in the reader's own
 * words. A scan's, router's or probe's name goes in as it is; a reader with no
 * recorded name gets a sentence without one.
 *
 * Every function takes `now`, so each sentence is pinned at a fixed time.
 */

const NOW: Date = new Date("2026-10-23T12:00:00.000Z");
const TWO_HOURS_AGO: string = "2026-10-23T10:00:00.000Z";
const THREE_MINUTES_AGO: string = "2026-10-23T11:57:00.000Z";

const english: Translator = createTranslator(undefined, "en");

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function translatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);
  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];
    return typeof value === "string" ? value : undefined;
  }, code);
}

function discovered(
  method: NetworkDeviceDiscoveryMethod,
  name?: string | undefined,
  readAt?: string | undefined,
): AssetFactSource {
  const type: NetworkDeviceDiscoveryReaderType =
    method === NetworkDeviceDiscoveryMethod.ArpTable
      ? NetworkDeviceDiscoveryReaderType.NetworkDevice
      : method === NetworkDeviceDiscoveryMethod.Dns
        ? NetworkDeviceDiscoveryReaderType.Probe
        : NetworkDeviceDiscoveryReaderType.DiscoveryScan;

  return {
    kind: AssetFactSourceKind.Discovered,
    method: method,
    readBy: {
      type: type,
      id: "80000000-0000-4000-8000-000000000001",
      ...(name === undefined ? {} : { name: name }),
    },
    readAt: readAt,
  };
}

describe("where a detail came from", () => {
  test.each([
    [
      NetworkDeviceDiscoveryMethod.Snmp,
      "Store subnets",
      "Discovery scan Store subnets (SNMP)",
    ],
    [
      NetworkDeviceDiscoveryMethod.ReverseDns,
      "Store subnets",
      "Discovery scan Store subnets (reverse DNS)",
    ],
    [
      NetworkDeviceDiscoveryMethod.Netbios,
      "Store subnets",
      "Discovery scan Store subnets (NetBIOS)",
    ],
    [
      NetworkDeviceDiscoveryMethod.ArpTable,
      "core-rtr-01",
      "ARP table of core-rtr-01",
    ],
    /*
     * The probe's name in brackets: probes are usually named "... probe",
     * and "DNS lookup by probe Frankfurt probe" says it twice.
     */
    [
      NetworkDeviceDiscoveryMethod.Dns,
      "Frankfurt DC2 probe",
      "DNS lookup by its probe (Frankfurt DC2 probe)",
    ],
  ])(
    "read by %s, with its reader named",
    (method: NetworkDeviceDiscoveryMethod, name: string, expected: string) => {
      expect(getAssetFactSourceText(discovered(method, name), english)).toBe(
        expected,
      );
    },
  );

  test.each([
    [NetworkDeviceDiscoveryMethod.Snmp, "A discovery scan (SNMP)"],
    [NetworkDeviceDiscoveryMethod.ReverseDns, "A discovery scan (reverse DNS)"],
    [NetworkDeviceDiscoveryMethod.Netbios, "A discovery scan (NetBIOS)"],
    [NetworkDeviceDiscoveryMethod.ArpTable, "A router's ARP table"],
    [NetworkDeviceDiscoveryMethod.Dns, "DNS lookup by its probe"],
  ])(
    "read by %s, its reader's name never recorded",
    (method: NetworkDeviceDiscoveryMethod, expected: string) => {
      expect(getAssetFactSourceText(discovered(method), english)).toBe(
        expected,
      );
      // A blank name is no name: never "Discovery scan  (SNMP)".
      expect(getAssetFactSourceText(discovered(method, "   "), english)).toBe(
        expected,
      );
    },
  );

  test.each([
    [AssetFactSourceKind.SnmpPoll, "Its SNMP poll"],
    [AssetFactSourceKind.LearnedFromArp, "A router's ARP table"],
    [AssetFactSourceKind.Saved, "Saved on this device"],
    [AssetFactSourceKind.PolledAddress, "The address its probe polls"],
    [AssetFactSourceKind.AssignedRole, "Its assigned role"],
    [AssetFactSourceKind.Site, "Its site"],
    [AssetFactSourceKind.Classified, "Worked out from what it reports"],
    [AssetFactSourceKind.Collector, "Its collector"],
    [AssetFactSourceKind.CloudPlacement, "Its cloud zone"],
  ])("%s", (kind: AssetFactSourceKind, expected: string) => {
    expect(
      getAssetFactSourceText({ kind: kind } as AssetFactSource, english),
    ).toBe(expected);
  });
});

describe("and when", () => {
  test("a discovered value says what read it, and how long ago", () => {
    expect(
      getAssetFactSourceLine(
        discovered(
          NetworkDeviceDiscoveryMethod.Snmp,
          "Store subnets",
          TWO_HOURS_AGO,
        ),
        english,
        NOW,
      ),
    ).toBe("Discovery scan Store subnets (SNMP) · 2 hours ago");
  });

  test("a source with no time, or a time that does not parse, is the source alone", () => {
    expect(
      getAssetFactSourceLine({ kind: AssetFactSourceKind.Saved }, english, NOW),
    ).toBe("Saved on this device");
    expect(
      getAssetFactSourceLine(
        discovered(NetworkDeviceDiscoveryMethod.Snmp, "Store subnets", "soon"),
        english,
        NOW,
      ),
    ).toBe("Discovery scan Store subnets (SNMP)");
  });

  test("what discovery read that differs from the saved value", () => {
    expect(
      getAssetFactDifferenceLine(
        {
          value: "00-1B-54-C2-7A-02",
          source: discovered(
            NetworkDeviceDiscoveryMethod.ArpTable,
            "core-rtr-01",
            "2026-10-23T09:00:00.000Z",
          ),
        },
        english,
        NOW,
      ),
    ).toBe("ARP table of core-rtr-01 says 00-1B-54-C2-7A-02 · 3 hours ago");

    expect(
      getAssetFactDifferenceLine(
        {
          value: "00-1B-54-C2-7A-02",
          source: discovered(NetworkDeviceDiscoveryMethod.ArpTable),
        },
        english,
        NOW,
      ),
    ).toBe("A router's ARP table says 00-1B-54-C2-7A-02");
  });
});

describe("the lines said once, below the details", () => {
  test("the scan that last found the device at its address", () => {
    expect(
      getFoundByLine(
        {
          readBy: {
            type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
            id: "scan-1",
            name: "Store subnets",
          },
          readAt: TWO_HOURS_AGO,
        },
        english,
        NOW,
      ),
    ).toBe(
      "Last found at its address by discovery scan Store subnets, 2 hours ago.",
    );

    expect(
      getFoundByLine(
        {
          readBy: {
            type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
            id: "scan-1",
          },
          readAt: TWO_HOURS_AGO,
        },
        english,
        NOW,
      ),
    ).toBe("Last found at its address by a discovery scan, 2 hours ago.");
  });

  test("a scan that found another machine at the address, and what it said it was", () => {
    expect(
      getOtherMachineLine(
        {
          readBy: {
            type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
            id: "scan-1",
            name: "Store subnets",
          },
          readAt: TWO_HOURS_AGO,
          netbiosName: "LAPTOP-12",
        },
        english,
        NOW,
      ),
    ).toBe(
      "Discovery scan Store subnets found another machine at this address 2 hours ago (LAPTOP-12), so nothing it read there is used.",
    );

    expect(
      getOtherMachineLine(
        {
          readBy: {
            type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
            id: "scan-1",
          },
          readAt: TWO_HOURS_AGO,
          sysName: "printer-02",
        },
        english,
        NOW,
      ),
    ).toBe(
      "A discovery scan found another machine at this address 2 hours ago (printer-02), so nothing it read there is used.",
    );
  });

  test("the other machine is named by the most telling thing it said", () => {
    const readBy: {
      type: NetworkDeviceDiscoveryReaderType;
      id: string;
    } = { type: NetworkDeviceDiscoveryReaderType.DiscoveryScan, id: "scan-1" };

    expect(
      getOtherMachineIdentity({
        readBy: readBy,
        readAt: TWO_HOURS_AGO,
        sysName: "printer-02",
        netbiosName: "PRN02",
        dnsName: "printer-02.acme.example",
        sysObjectId: "1.3.6.1.4.1.11.2.3.9.1",
      }),
    ).toBe("printer-02");
    expect(
      getOtherMachineIdentity({
        readBy: readBy,
        readAt: TWO_HOURS_AGO,
        netbiosName: "PRN02",
        dnsName: "printer-02.acme.example",
      }),
    ).toBe("PRN02");
    expect(
      getOtherMachineIdentity({
        readBy: readBy,
        readAt: TWO_HOURS_AGO,
        dnsName: "printer-02.acme.example",
        sysObjectId: "1.3.6.1.4.1.11.2.3.9.1",
      }),
    ).toBe("printer-02.acme.example");
    expect(
      getOtherMachineIdentity({
        readBy: readBy,
        readAt: TWO_HOURS_AGO,
        sysObjectId: "1.3.6.1.4.1.11.2.3.9.1",
      }),
    ).toBe("1.3.6.1.4.1.11.2.3.9.1");
  });

  test("a host's collector and a device's own poll, each with when", () => {
    expect(getCollectorLine(THREE_MINUTES_AGO, english, NOW)).toBe(
      "Reported by its collector, 3 minutes ago.",
    );
    expect(getSnmpPollLine(THREE_MINUTES_AGO, english, NOW)).toBe(
      "Read over SNMP by its probe, 3 minutes ago.",
    );
    // With no time there is nothing worth saying once.
    expect(getCollectorLine(undefined, english, NOW)).toBeUndefined();
    expect(getSnmpPollLine("not a time", english, NOW)).toBeUndefined();
  });

  test("only a collector and a device's own poll are said once", () => {
    for (const kind of Object.values(AssetFactSourceKind)) {
      const isNative: boolean =
        kind === AssetFactSourceKind.Collector ||
        kind === AssetFactSourceKind.SnmpPoll;

      expect({
        kind,
        native: isNativeAssetFactSource({ kind } as AssetFactSource),
      }).toEqual({ kind, native: isNative });
    }
    expect(isNativeAssetFactSource(undefined)).toBe(false);
  });

  test("the native line follows its source", () => {
    expect(
      getNativeSourceLine(
        { kind: AssetFactSourceKind.Collector, readAt: THREE_MINUTES_AGO },
        english,
        NOW,
      ),
    ).toBe("Reported by its collector, 3 minutes ago.");
    expect(
      getNativeSourceLine(
        { kind: AssetFactSourceKind.SnmpPoll, readAt: THREE_MINUTES_AGO },
        english,
        NOW,
      ),
    ).toBe("Read over SNMP by its probe, 3 minutes ago.");
    expect(
      getNativeSourceLine(
        discovered(
          NetworkDeviceDiscoveryMethod.Snmp,
          "Store subnets",
          TWO_HOURS_AGO,
        ),
        english,
        NOW,
      ),
    ).toBeUndefined();
    expect(getNativeSourceLine(undefined, english, NOW)).toBeUndefined();
  });
});

describe("in the reader's language", () => {
  test("German: the sentence and the time are both German", () => {
    const german: Translator = translatorFor("de");

    expect(
      getAssetFactSourceLine(
        discovered(
          NetworkDeviceDiscoveryMethod.Snmp,
          "Store subnets",
          TWO_HOURS_AGO,
        ),
        german,
        NOW,
      ),
    ).toBe("Erkennungsscan Store subnets (SNMP) · vor 2 Stunden");
    expect(
      getFoundByLine(
        {
          readBy: {
            type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
            id: "scan-1",
            name: "Store subnets",
          },
          readAt: TWO_HOURS_AGO,
        },
        german,
        NOW,
      ),
    ).toBe(
      "Zuletzt von Erkennungsscan Store subnets unter seiner Adresse gefunden, vor 2 Stunden.",
    );
  });

  test("Japanese: the names stay as they are", () => {
    const japanese: Translator = translatorFor("ja");

    expect(
      getAssetFactSourceLine(
        discovered(
          NetworkDeviceDiscoveryMethod.ArpTable,
          "core-rtr-01",
          TWO_HOURS_AGO,
        ),
        japanese,
        NOW,
      ),
    ).toBe("core-rtr-01 の ARP テーブル · 2 時間前");
    expect(getSnmpPollLine(THREE_MINUTES_AGO, japanese, NOW)).toBe(
      "プローブが SNMP で読み取りました (3 分前)。",
    );
  });

  /*
   * Every sentence is a whole template, so every language has its own
   * wording for it - never English inside a German page.
   */
  test("every sentence is in every language", () => {
    const templates: Array<string> = [
      "Discovery scan {{name}} (SNMP)",
      "Discovery scan {{name}} (reverse DNS)",
      "Discovery scan {{name}} (NetBIOS)",
      "ARP table of {{name}}",
      "DNS lookup by its probe ({{name}})",
      "A discovery scan (SNMP)",
      "A discovery scan (reverse DNS)",
      "A discovery scan (NetBIOS)",
      "A router's ARP table",
      "DNS lookup by its probe",
      "Its SNMP poll",
      "Saved on this device",
      "The address its probe polls",
      "Its assigned role",
      "Its site",
      "Worked out from what it reports",
      "Its collector",
      "Its cloud zone",
      DIFFERENT_VALUE_TEMPLATE,
      FOUND_BY_TEMPLATE,
      FOUND_BY_UNNAMED_TEMPLATE,
      OTHER_MACHINE_TEMPLATE,
      OTHER_MACHINE_UNNAMED_TEMPLATE,
      COLLECTOR_TEMPLATE,
      SNMP_POLL_TEMPLATE,
    ];

    for (const code of LANGUAGES) {
      const locale: Record<string, unknown> = readLocale(code);

      for (const template of templates) {
        const translated: unknown = locale[template];

        expect({ code, template, isText: typeof translated }).toEqual({
          code,
          template,
          isText: "string",
        });

        // The same placeholders, so no name or time is ever lost.
        const placeholders: (text: string) => Array<string> = (
          text: string,
        ): Array<string> => {
          return (text.match(/\{\{\w+\}\}/g) || []).sort();
        };

        expect({
          code,
          template,
          kept: placeholders(translated as string),
        }).toEqual({
          code,
          template,
          kept: placeholders(template),
        });
      }
    }
  });
});
