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
  SCAN_READ_TEMPLATE,
  SCAN_READ_UNNAMED_TEMPLATE,
  SNMP_POLL_TEMPLATE,
  getAssetFactDifferenceLine,
  getAssetFactExactTime,
  getAssetFactSourceLine,
  getAssetFactSourceText,
  getCollectorLine,
  getFoundByLine,
  getOtherMachineIdentity,
  getOtherMachineLine,
  getScanReadLine,
  getSharedAssetFactSource,
  getSharedSourceLine,
  getSnmpPollLine,
  isNativeAssetFactSource,
  isSameAssetFactSource,
  isSightingSaidBySharedSource,
  isUndisputedSavedValue,
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
    [
      AssetFactSourceKind.Classified,
      "Worked out from its name and what it reports",
    ],
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

  test("a machine's own source is its collector or its own poll", () => {
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

  test("the line said once follows its source", () => {
    expect(
      getSharedSourceLine(
        { kind: AssetFactSourceKind.Collector, readAt: THREE_MINUTES_AGO },
        english,
        NOW,
      ),
    ).toBe("Reported by its collector, 3 minutes ago.");
    expect(
      getSharedSourceLine(
        { kind: AssetFactSourceKind.SnmpPoll, readAt: THREE_MINUTES_AGO },
        english,
        NOW,
      ),
    ).toBe("Read over SNMP by its probe, 3 minutes ago.");
    // A device its own poll has not read: the scan that read it over SNMP.
    expect(
      getSharedSourceLine(
        discovered(
          NetworkDeviceDiscoveryMethod.Snmp,
          "Store subnets",
          TWO_HOURS_AGO,
        ),
        english,
        NOW,
      ),
    ).toBe("Read over SNMP by discovery scan Store subnets, 2 hours ago.");
    expect(
      getSharedSourceLine(
        discovered(NetworkDeviceDiscoveryMethod.Snmp, undefined, TWO_HOURS_AGO),
        english,
        NOW,
      ),
    ).toBe("Read over SNMP by a discovery scan, 2 hours ago.");
    // One detail's source is said under it, never once below.
    expect(
      getSharedSourceLine(
        discovered(
          NetworkDeviceDiscoveryMethod.ReverseDns,
          "Store subnets",
          TWO_HOURS_AGO,
        ),
        english,
        NOW,
      ),
    ).toBeUndefined();
    expect(
      getSharedSourceLine({ kind: AssetFactSourceKind.Saved }, english, NOW),
    ).toBeUndefined();
    expect(getSharedSourceLine(undefined, english, NOW)).toBeUndefined();
  });

  test("a scan's reading, said once, with when", () => {
    const scan: AssetFactSource = discovered(
      NetworkDeviceDiscoveryMethod.Snmp,
      "Store subnets",
      TWO_HOURS_AGO,
    );

    expect(getScanReadLine(scan.readBy, TWO_HOURS_AGO, english, NOW)).toBe(
      "Read over SNMP by discovery scan Store subnets, 2 hours ago.",
    );
    // With no time there is nothing worth saying once.
    expect(getScanReadLine(scan.readBy, undefined, english, NOW)).toBe(
      undefined,
    );
    expect(getScanReadLine(scan.readBy, "soon", english, NOW)).toBe(undefined);
  });
});

/*
 * The source a card says ONCE, below its details: the reading most of them
 * came from (UI review of #5185). Under each of a ping-only switch's seven
 * details, "Discovery scan Store subnets (SNMP) · 2 hours ago" said the same
 * thing seven times and buried the one detail that came from elsewhere.
 */
describe("the source said once, below the details", () => {
  const SCAN: AssetFactSource = discovered(
    NetworkDeviceDiscoveryMethod.Snmp,
    "Store subnets",
    TWO_HOURS_AGO,
  );
  const POLL: AssetFactSource = {
    kind: AssetFactSourceKind.SnmpPoll,
    readAt: THREE_MINUTES_AGO,
  };
  const ARP: AssetFactSource = discovered(
    NetworkDeviceDiscoveryMethod.ArpTable,
    "core-rtr-01",
    TWO_HOURS_AGO,
  );
  const REVERSE_DNS: AssetFactSource = discovered(
    NetworkDeviceDiscoveryMethod.ReverseDns,
    "Store subnets",
    TWO_HOURS_AGO,
  );
  const POLLED_ADDRESS: AssetFactSource = {
    kind: AssetFactSourceKind.PolledAddress,
  };
  const CLASSIFIED: AssetFactSource = {
    kind: AssetFactSourceKind.Classified,
  };

  // The same reading, as another detail carries it.
  function copyOf(source: AssetFactSource): AssetFactSource {
    return JSON.parse(JSON.stringify(source)) as AssetFactSource;
  }

  test("a ping-only switch: the scan that read its SNMP system group", () => {
    const shared: AssetFactSource | undefined = getSharedAssetFactSource([
      copyOf(SCAN), // hostname
      POLLED_ADDRESS, // IP address
      ARP, // MAC address
      undefined, // serial number: unknown
      copyOf(SCAN), // manufacturer
      copyOf(SCAN), // operating system
      copyOf(SCAN), // OS version
      CLASSIFIED, // device type
      copyOf(SCAN), // location
      REVERSE_DNS, // DNS name
      copyOf(SCAN), // system description
    ]);

    expect(shared).toEqual(SCAN);
    expect(isSameAssetFactSource(shared, copyOf(SCAN))).toBe(true);
    // Everything else still says where it came from.
    for (const other of [POLLED_ADDRESS, ARP, CLASSIFIED, REVERSE_DNS]) {
      expect(isSameAssetFactSource(other, shared)).toBe(false);
    }
  });

  test("a walked device: its own poll, even for a single detail", () => {
    expect(getSharedAssetFactSource([POLL, ARP, REVERSE_DNS])).toEqual(POLL);
  });

  test("a machine's own source wins a tie with a scan", () => {
    expect(
      getSharedAssetFactSource([
        copyOf(SCAN),
        copyOf(SCAN),
        copyOf(POLL),
        copyOf(POLL),
      ]),
    ).toEqual(POLL);
  });

  test("a scan that read more than the device's last poll is said once instead", () => {
    // A switch walked three days ago, scanned two hours ago.
    const oldPoll: AssetFactSource = {
      kind: AssetFactSourceKind.SnmpPoll,
      readAt: "2026-10-20T12:00:00.000Z",
    };

    expect(
      getSharedAssetFactSource([
        copyOf(SCAN),
        copyOf(SCAN),
        copyOf(SCAN),
        oldPoll,
        copyOf(oldPoll),
      ]),
    ).toEqual(SCAN);
  });

  test("a scan that gave one detail says so under it", () => {
    expect(getSharedAssetFactSource([SCAN, ARP, POLLED_ADDRESS])).toBe(
      undefined,
    );
  });

  test("a source that only ever gives one detail is never said once", () => {
    expect(
      getSharedAssetFactSource([
        ARP,
        copyOf(ARP),
        REVERSE_DNS,
        copyOf(REVERSE_DNS),
        POLLED_ADDRESS,
        POLLED_ADDRESS,
        CLASSIFIED,
        CLASSIFIED,
        { kind: AssetFactSourceKind.Saved },
        { kind: AssetFactSourceKind.Saved },
        { kind: AssetFactSourceKind.AssignedRole },
        { kind: AssetFactSourceKind.Site },
        { kind: AssetFactSourceKind.CloudPlacement },
      ]),
    ).toBe(undefined);
    expect(getSharedAssetFactSource([])).toBe(undefined);
    expect(getSharedAssetFactSource([undefined, undefined])).toBe(undefined);
  });

  test("two runs of one scan are two readings", () => {
    const earlier: AssetFactSource = discovered(
      NetworkDeviceDiscoveryMethod.Snmp,
      "Store subnets",
      "2026-10-22T10:00:00.000Z",
    );

    expect(isSameAssetFactSource(SCAN, earlier)).toBe(false);
    expect(getSharedAssetFactSource([SCAN, earlier])).toBe(undefined);
  });

  test("a reading is the same reading however its time is written", () => {
    expect(
      isSameAssetFactSource(
        discovered(
          NetworkDeviceDiscoveryMethod.Snmp,
          "Store subnets",
          "2026-10-23T10:00:00Z",
        ),
        discovered(
          NetworkDeviceDiscoveryMethod.Snmp,
          "Renamed since",
          "2026-10-23T10:00:00.000Z",
        ),
      ),
    ).toBe(true);
    expect(isSameAssetFactSource(SCAN, REVERSE_DNS)).toBe(false);
    expect(isSameAssetFactSource(SCAN, undefined)).toBe(false);
    expect(isSameAssetFactSource(undefined, undefined)).toBe(false);
  });

  test("the scan that found the device is not said again when its reading is", () => {
    const foundBy: {
      readBy: { type: NetworkDeviceDiscoveryReaderType; id: string };
      readAt: string;
    } = {
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
        id: SCAN.readBy!.id,
      },
      readAt: TWO_HOURS_AGO,
    };

    expect(isSightingSaidBySharedSource(foundBy, SCAN)).toBe(true);
    // Found again since, without reading it: worth saying.
    expect(
      isSightingSaidBySharedSource(
        { ...foundBy, readAt: THREE_MINUTES_AGO },
        SCAN,
      ),
    ).toBe(false);
    // Another scan, the device's own poll, nothing said once.
    expect(
      isSightingSaidBySharedSource(
        {
          ...foundBy,
          readBy: { ...foundBy.readBy, id: "another-scan" },
        },
        SCAN,
      ),
    ).toBe(false);
    expect(isSightingSaidBySharedSource(foundBy, POLL)).toBe(false);
    expect(isSightingSaidBySharedSource(foundBy, undefined)).toBe(false);
    expect(isSightingSaidBySharedSource(undefined, SCAN)).toBe(false);
  });

  test("a saved value nothing disputes, and only that, goes unsaid on the device's own page", () => {
    expect(
      isUndisputedSavedValue({ kind: AssetFactSourceKind.Saved }, false),
    ).toBe(true);
    expect(
      isUndisputedSavedValue({ kind: AssetFactSourceKind.Saved }, true),
    ).toBe(false);
    expect(isUndisputedSavedValue(SCAN, false)).toBe(false);
    expect(isUndisputedSavedValue(undefined, false)).toBe(false);
  });

  test("the exact time is offered on hover, when there is one", () => {
    const exact: string | undefined = getAssetFactExactTime(TWO_HOURS_AGO);

    expect(typeof exact).toBe("string");
    expect(exact).toContain("2026");
    expect(getAssetFactExactTime(undefined)).toBe(undefined);
    expect(getAssetFactExactTime("not a time")).toBe(undefined);
  });

  /*
   * The docs say it the way the card does: the source most facts share is
   * named once, below them, and every other source under its fact.
   */
  test("the Inventory docs say what the card does", () => {
    const overview: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Docs",
        "Content",
        "en",
        "inventory",
        "overview.md",
      ),
      "utf8",
    );

    expect(overview).toContain(
      "The source most facts share, such as a host's collector, a network device's own SNMP poll or the discovery scan that read it, is named once, below the facts. Any other source, such as a router's ARP table or a value saved on the device, is named under its fact.",
    );
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
    expect(
      getSharedSourceLine(
        discovered(
          NetworkDeviceDiscoveryMethod.Snmp,
          "Store subnets",
          TWO_HOURS_AGO,
        ),
        german,
        NOW,
      ),
    ).toBe(
      "Von Erkennungsscan Store subnets über SNMP gelesen, vor 2 Stunden.",
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
    expect(
      getSharedSourceLine(
        discovered(
          NetworkDeviceDiscoveryMethod.Snmp,
          "Store subnets",
          TWO_HOURS_AGO,
        ),
        japanese,
        NOW,
      ),
    ).toBe("検出スキャン Store subnets が SNMP で読み取りました (2 時間前)。");
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
      "Worked out from its name and what it reports",
      "Its collector",
      "Its cloud zone",
      DIFFERENT_VALUE_TEMPLATE,
      FOUND_BY_TEMPLATE,
      FOUND_BY_UNNAMED_TEMPLATE,
      OTHER_MACHINE_TEMPLATE,
      OTHER_MACHINE_UNNAMED_TEMPLATE,
      COLLECTOR_TEMPLATE,
      SNMP_POLL_TEMPLATE,
      SCAN_READ_TEMPLATE,
      SCAN_READ_UNNAMED_TEMPLATE,
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
