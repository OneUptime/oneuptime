import WifiInternalNetworkUtil, {
  EXTREME_WLAN_ENTRY_OID,
  EXTREME_WLAN_SERVICE_TYPE_OID,
  UNIFI_VAP_ENTRY_OID,
  UNIFI_VAP_ESSID_OID,
  UNIFI_VAP_NAME_OID,
  UNIFI_VAP_USAGE_OID,
  WIFI_INTERNAL_NETWORK_RULES,
  WifiInternalNetworkKind,
  WifiInternalNetworkRule,
  WifiRowValueReader,
} from "../../../../Types/Monitor/SnmpMonitor/WifiInternalNetwork";
import SnmpOidListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import {
  SnmpTableColumn,
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpVendorTemplateUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, it } from "@jest/globals";

/*
 * Which rows of an SSID table are networks an access point runs for itself
 * (issue #4730): UniFi's wireless mesh link and device adoption network,
 * and an Extreme controller's WDS and mesh WLAN services. The MIB says it
 * wherever it can - a VAP's usage, its interface name, a WLAN's service
 * type - and a name is read only for UniFi's adoption network, which
 * reports what any network of the customer's reports. Names, ids and
 * values below are invented, in the shape the agents answer with.
 */

// A row as the walk hands it over: raw values by column OID.
function reader(
  values: Record<string, string | number | null | undefined>,
): WifiRowValueReader {
  return (columnOid: string): string | number | null | undefined => {
    return values[columnOid];
  };
}

// A UniFi VAP: what UniFi reports for a network of the customer's, unless told otherwise.
function unifiVap(
  overrides: Record<string, string | number | null | undefined> = {},
): WifiRowValueReader {
  return reader({
    [UNIFI_VAP_ESSID_OID]: "DEMO",
    [UNIFI_VAP_NAME_OID]: "ath0",
    [UNIFI_VAP_USAGE_OID]: "user",
    ...overrides,
  });
}

const MESH_LINK_ESSID: string = "vwire-0c9f31a77e2b54d8";
const ADOPTION_ESSID: string = "element-6e1d08b3a4f297c5";

describe("UniFi's wireless mesh link", () => {
  it.each(["downlink", "uplink", "DOWNLINK", " downlink ", "Uplink"])(
    "is told by its usage, %p",
    (usage: string) => {
      expect(
        WifiInternalNetworkUtil.getKind(
          unifiVap({
            [UNIFI_VAP_USAGE_OID]: usage,
            [UNIFI_VAP_ESSID_OID]: "Mesh",
          }),
        ),
      ).toBe(WifiInternalNetworkKind.MeshLink);
    },
  );

  it.each(["vwire8", "vwire2", "vwireap0", "vwiresta1", "VWIRE3"])(
    "is told by its interface, %p",
    (name: string) => {
      expect(
        WifiInternalNetworkUtil.getKind(
          unifiVap({
            [UNIFI_VAP_NAME_OID]: name,
            [UNIFI_VAP_ESSID_OID]: "Mesh",
          }),
        ),
      ).toBe(WifiInternalNetworkKind.MeshLink);
    },
  );

  it("is told by the name UniFi gives it, when nothing else is walked", () => {
    // A table copied before the interface column was added walks no name.
    expect(
      WifiInternalNetworkUtil.getKind(
        reader({ [UNIFI_VAP_ESSID_OID]: MESH_LINK_ESSID }),
      ),
    ).toBe(WifiInternalNetworkKind.MeshLink);
  });

  it("is told on every signal at once, as an agent reports it", () => {
    expect(
      WifiInternalNetworkUtil.getKind(
        unifiVap({
          [UNIFI_VAP_ESSID_OID]: MESH_LINK_ESSID,
          [UNIFI_VAP_NAME_OID]: "vwire4",
          [UNIFI_VAP_USAGE_OID]: "downlink",
        }),
      ),
    ).toBe(WifiInternalNetworkKind.MeshLink);
  });
});

describe("UniFi's device adoption network", () => {
  it("is told by the name UniFi gives it, though it reports what a network of the customer's does", () => {
    // Usage "user", an athN interface: only the name says what it is.
    expect(
      WifiInternalNetworkUtil.getKind(
        unifiVap({ [UNIFI_VAP_ESSID_OID]: ADOPTION_ESSID }),
      ),
    ).toBe(WifiInternalNetworkKind.DeviceAdoption);
  });

  it("is told with surrounding blanks trimmed, as every value is", () => {
    expect(
      WifiInternalNetworkUtil.getKind(
        unifiVap({ [UNIFI_VAP_ESSID_OID]: ` ${ADOPTION_ESSID} ` }),
      ),
    ).toBe(WifiInternalNetworkKind.DeviceAdoption);
  });

  it.each([
    "element",
    "element-",
    "element-guest",
    "element-6e1d08b3a4f297c",
    "element-6e1d08b3a4f297c51",
    "element-6E1D08B3A4F297C5",
    "Element-6e1d08b3a4f297c5",
    "element_6e1d08b3a4f297c5",
    "element-6e1d08b3a4f297g5",
    "element-6e1d08b3a4f297c5-2",
    "my-element-6e1d08b3a4f297c5",
    "element 6e1d08b3a4f297c5",
  ])("never takes a network named %p for it", (essid: string) => {
    expect(
      WifiInternalNetworkUtil.getKind(
        unifiVap({ [UNIFI_VAP_ESSID_OID]: essid }),
      ),
    ).toBeUndefined();
  });
});

describe("a network of the customer's", () => {
  it.each([
    ["an SSID", "DEMO", "ath0", "user"],
    ["a hidden SSID", "CorpHidden", "ath3", "user"],
    ["a guest SSID", "Visitors", "ath1", "guest"],
    ["an SSID named like a usage", "downlink", "ath2", "user"],
    ["an SSID named like the mesh link's interface", "vwire", "ath4", "user"],
    ["an SSID named like the mesh link", "vwire-mesh", "ath5", "user"],
    ["an SSID whose usage is not reported", "Office", "ath6", undefined],
    ["an SSID whose interface is not reported", "Office", undefined, "user"],
  ])(
    "is kept: %s",
    (
      _what: string,
      essid: string,
      name: string | undefined,
      usage: string | undefined,
    ) => {
      expect(
        WifiInternalNetworkUtil.getKind(
          reader({
            [UNIFI_VAP_ESSID_OID]: essid,
            [UNIFI_VAP_NAME_OID]: name,
            [UNIFI_VAP_USAGE_OID]: usage,
          }),
        ),
      ).toBeUndefined();
    },
  );

  it("is never hidden for a name, unless it is exactly the name UniFi generates", () => {
    /*
     * Thousands of names built from the pieces the patterns are made of -
     * the prefixes, hex digits of both cases, letters and punctuation - each
     * judged against an oracle that knows no pattern: a prefix, then exactly
     * sixteen lowercase hex digits.
     */
    const HEX: string = "0123456789abcdef";

    const isGenerated: (essid: string, prefix: string) => boolean = (
      essid: string,
      prefix: string,
    ): boolean => {
      if (!essid.startsWith(prefix)) {
        return false;
      }

      const rest: string = essid.substring(prefix.length);

      return (
        rest.length === 16 &&
        rest.split("").every((character: string): boolean => {
          return HEX.includes(character);
        })
      );
    };

    const names: Array<string> = generatedTexts(6000, 4730, [
      "vwire-",
      "element-",
      "vwire",
      "element",
      ..."0123456789abcdef".split(""),
      "A",
      "F",
      "g",
      "-",
      " ",
      "DEMO",
      "_",
    ]);

    let generatedCount: number = 0;

    for (const essid of names) {
      const kind: WifiInternalNetworkKind | undefined =
        WifiInternalNetworkUtil.getKind(
          unifiVap({ [UNIFI_VAP_ESSID_OID]: essid }),
        );

      const expected: WifiInternalNetworkKind | undefined = isGenerated(
        essid,
        "vwire-",
      )
        ? WifiInternalNetworkKind.MeshLink
        : isGenerated(essid, "element-")
          ? WifiInternalNetworkKind.DeviceAdoption
          : undefined;

      if (expected) {
        generatedCount++;
      }

      expect([essid, kind]).toEqual([essid, expected]);
    }

    // Random pieces seldom make the exact form: the sweep is of near misses.
    expect(generatedCount).toBeLessThan(names.length / 10);
  });

  it("is hidden for every name UniFi generates, whatever its sixteen digits", () => {
    const random: SeededRandom = seededRandom(2025);
    const HEX: string = "0123456789abcdef";

    for (let draw: number = 0; draw < 500; draw++) {
      let id: string = "";

      for (let digit: number = 0; digit < 16; digit++) {
        id += HEX[random(HEX.length)];
      }

      expect(
        WifiInternalNetworkUtil.getKind(
          unifiVap({ [UNIFI_VAP_ESSID_OID]: `vwire-${id}` }),
        ),
      ).toBe(WifiInternalNetworkKind.MeshLink);
      expect(
        WifiInternalNetworkUtil.getKind(
          unifiVap({ [UNIFI_VAP_ESSID_OID]: `element-${id}` }),
        ),
      ).toBe(WifiInternalNetworkKind.DeviceAdoption);
    }
  });
});

describe("an Extreme controller's WLAN services", () => {
  it.each([
    [3, WifiInternalNetworkKind.MeshLink],
    ["3", WifiInternalNetworkKind.MeshLink],
    [6, WifiInternalNetworkKind.MeshLink],
    ["6", WifiInternalNetworkKind.MeshLink],
    [0, undefined],
    [4, undefined],
    [5, undefined],
    [null, undefined],
    [undefined, undefined],
  ])(
    "of service type %p are %p",
    (
      serviceType: string | number | null | undefined,
      kind: WifiInternalNetworkKind | undefined,
    ) => {
      expect(
        WifiInternalNetworkUtil.getKind(
          reader({ [EXTREME_WLAN_SERVICE_TYPE_OID]: serviceType }),
        ),
      ).toBe(kind);
    },
  );
});

describe("a rule reads its own vendor's column, and no other", () => {
  const CAMBIUM_WLAN_SSID: string = "1.3.6.1.4.1.17713.22.1.4.1.2";
  const ARUBA_INSTANT_SSID: string = "1.3.6.1.4.1.14823.2.3.3.1.1.7.1.2";

  it("keeps another vendor's network named like UniFi's", () => {
    expect(
      WifiInternalNetworkUtil.getKind(
        reader({
          [CAMBIUM_WLAN_SSID]: MESH_LINK_ESSID,
          [ARUBA_INSTANT_SSID]: ADOPTION_ESSID,
        }),
      ),
    ).toBeUndefined();
  });

  it("keeps a UniFi network whose usage reads like an Extreme service type", () => {
    expect(
      WifiInternalNetworkUtil.getKind(unifiVap({ [UNIFI_VAP_USAGE_OID]: "3" })),
    ).toBeUndefined();
  });

  it("keeps an Extreme WLAN whose service type reads like a UniFi usage", () => {
    expect(
      WifiInternalNetworkUtil.getKind(
        reader({ [EXTREME_WLAN_SERVICE_TYPE_OID]: "downlink" }),
      ),
    ).toBeUndefined();
  });

  it("finds nothing in a row with no values", () => {
    expect(WifiInternalNetworkUtil.getKind(reader({}))).toBeUndefined();
  });
});

describe("WifiInternalNetworkUtil.isNetworkName", () => {
  it.each(["N/A", "n/a", "-", "---", "", "   ", undefined])(
    "reads %p as no network",
    (name: string | undefined) => {
      expect(WifiInternalNetworkUtil.isNetworkName(name)).toBe(false);
    },
  );

  it.each(["NA", "none", "N/A Guest", "Office", "-Lab-", "DEMO"])(
    "reads %p as a network",
    (name: string) => {
      expect(WifiInternalNetworkUtil.isNetworkName(name)).toBe(true);
    },
  );
});

describe("WifiInternalNetworkUtil.isJoinableNetwork", () => {
  it("is a network people join: named, and run for nobody but them", () => {
    expect(
      WifiInternalNetworkUtil.isJoinableNetwork({
        ssid: "DEMO",
        read: unifiVap(),
      }),
    ).toBe(true);
  });

  it("is not a row that names no network", () => {
    expect(
      WifiInternalNetworkUtil.isJoinableNetwork({
        ssid: "N/A",
        read: reader({}),
      }),
    ).toBe(false);
  });

  it("is not a network the access point runs for itself", () => {
    expect(
      WifiInternalNetworkUtil.isJoinableNetwork({
        ssid: MESH_LINK_ESSID,
        read: unifiVap({ [UNIFI_VAP_ESSID_OID]: MESH_LINK_ESSID }),
      }),
    ).toBe(false);
  });

  it("judges a table with no SSID column by its values alone", () => {
    expect(
      WifiInternalNetworkUtil.isJoinableNetwork({
        ssid: undefined,
        read: reader({ [EXTREME_WLAN_SERVICE_TYPE_OID]: 0 }),
      }),
    ).toBe(true);
    expect(
      WifiInternalNetworkUtil.isJoinableNetwork({
        ssid: undefined,
        read: reader({ [EXTREME_WLAN_SERVICE_TYPE_OID]: 3 }),
      }),
    ).toBe(false);
  });
});

describe("the rules", () => {
  it("each say how they match exactly one way", () => {
    for (const rule of WIFI_INTERNAL_NETWORK_RULES) {
      const ways: number = [rule.values, rule.prefix, rule.pattern].filter(
        (way: unknown): boolean => {
          return way !== undefined;
        },
      ).length;

      expect([rule.column, ways]).toEqual([rule.column, 1]);
    }
  });

  it("compare values as the matcher lowercases them", () => {
    for (const rule of WIFI_INTERNAL_NETWORK_RULES) {
      for (const value of rule.values || []) {
        expect(value).toBe(value.trim().toLowerCase());
      }
    }
  });

  it("match a name whole, never a part of one", () => {
    for (const rule of WIFI_INTERNAL_NETWORK_RULES) {
      if (rule.pattern) {
        expect(rule.pattern.source.startsWith("^")).toBe(true);
        expect(rule.pattern.source.endsWith("$")).toBe(true);
        expect(rule.pattern.flags).toBe("");
      }
    }
  });

  it("read numeric column OIDs in the MIB's numbering", () => {
    expect(UNIFI_VAP_ESSID_OID).toBe(`${UNIFI_VAP_ENTRY_OID}.6`);
    expect(UNIFI_VAP_NAME_OID).toBe(`${UNIFI_VAP_ENTRY_OID}.7`);
    expect(UNIFI_VAP_USAGE_OID).toBe(`${UNIFI_VAP_ENTRY_OID}.23`);
    expect(EXTREME_WLAN_SERVICE_TYPE_OID).toBe(`${EXTREME_WLAN_ENTRY_OID}.3`);

    for (const rule of WIFI_INTERNAL_NETWORK_RULES) {
      expect(SnmpOidListUtil.isValidOid(rule.columnOid)).toBe(true);
      expect(SnmpOidListUtil.normalizeOid(rule.columnOid)).toBe(rule.columnOid);
    }
  });

  it("read only columns their vendor's template walks in its SSID table", () => {
    /*
     * A rule on a column the template does not walk would never see a value
     * on a device set up from the template.
     */
    const TEMPLATE_OF_VENDOR: Record<string, string> = {
      "Ubiquiti UniFi": "ubiquiti-unifi-ap",
      "Extreme Networks": "extreme-wireless-controller",
    };

    for (const rule of WIFI_INTERNAL_NETWORK_RULES) {
      const templateId: string | undefined = TEMPLATE_OF_VENDOR[rule.vendor];

      expect([rule.vendor, templateId]).toEqual([
        rule.vendor,
        expect.any(String),
      ]);

      const ssidTable: SnmpTableDefinition | undefined =
        SnmpVendorTemplateUtil.getById(templateId!)?.tables?.find(
          (table: SnmpTableDefinition): boolean => {
            return table.kind === SnmpTableKind.WifiSsid;
          },
        );

      expect(
        ssidTable?.columns.map((column: SnmpTableColumn): string => {
          return column.oid;
        }),
      ).toContain(rule.columnOid);
    }
  });

  it("name UniFi's ESSID column as the one its template reads SSIDs from", () => {
    const ssidColumn: SnmpTableColumn | undefined =
      SnmpVendorTemplateUtil.getById("ubiquiti-unifi-ap")
        ?.tables?.find((table: SnmpTableDefinition): boolean => {
          return table.key === "wifi_ssids";
        })
        ?.columns.find((column: SnmpTableColumn): boolean => {
          return column.role === SnmpTableColumnRole.Ssid;
        });

    expect(ssidColumn?.oid).toBe(UNIFI_VAP_ESSID_OID);

    const nameRules: Array<WifiInternalNetworkRule> =
      WIFI_INTERNAL_NETWORK_RULES.filter(
        (rule: WifiInternalNetworkRule): boolean => {
          return rule.pattern !== undefined;
        },
      );

    // Names are read only from UniFi's ESSID column.
    expect(
      nameRules.map((rule: WifiInternalNetworkRule): string => {
        return rule.columnOid;
      }),
    ).toEqual([UNIFI_VAP_ESSID_OID, UNIFI_VAP_ESSID_OID]);
  });
});
