import { SnmpTableDefinition } from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "Common/Types/ObjectID";
import {
  WIFI_VENDORS_DOCS_PATH,
  WifiAdvice,
  WifiAdviceDeviceFacts,
  WifiAdviceKind,
  getWifiAdvice,
  getWifiTemplates,
  hasWifiTables,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/WifiTemplateAdvice";
import { describe, expect, test } from "@jest/globals";

/*
 * What the Wi-Fi tab of a device that reports no Wi-Fi yet tells its
 * reader to do. The one obvious next step is the vendor's template, so the
 * tab matches the device exactly as the first poll and "Apply Vendor
 * Template" match it, and offers that template with one click - or says
 * why it cannot (not identified yet, a monitor polls it, an OID Collection
 * Template holds its tables, no template reads Wi-Fi for its vendor).
 */

const UNIFI: Partial<WifiAdviceDeviceFacts> = {
  sysObjectId: "1.3.6.1.4.1.41112",
  sysDescr: "U6-Pro 6.5.28.14491",
};

function device(
  overrides: Partial<WifiAdviceDeviceFacts> = {},
): WifiAdviceDeviceFacts {
  return {
    monitoringMethod: "Probe",
    oidTemplateId: null,
    sysObjectId: undefined,
    sysDescr: undefined,
    snmpTables: [],
    ...overrides,
  };
}

function template(id: string): SnmpVendorTemplate {
  return SnmpVendorTemplateUtil.getById(id)!;
}

function templateOf(advice: WifiAdvice): string | undefined {
  return "template" in advice ? advice.template.id : undefined;
}

describe("the Wi-Fi tab's advice", () => {
  test("offers the access point's own template when it walks none of its tables", () => {
    const advice: WifiAdvice = getWifiAdvice(device(UNIFI));

    expect(advice.kind).toBe(WifiAdviceKind.ApplyTemplate);
    expect(templateOf(advice)).toBe("ubiquiti-unifi-ap");
  });

  test.each([
    [
      "1.3.6.1.4.1.14823.1.2.59",
      "ArubaOS (MODEL: 225), Version 8.4.0.0-8.4.0.0",
      "aruba-instant",
    ],
    [
      "1.3.6.1.4.1.14823.1.1.32",
      "ArubaOS (MODEL: Aruba7210), Version 8.2.0.2 (62929)",
      "aruba-mobility-controller",
    ],
    [
      "1.3.6.1.4.1.26928.1",
      "AP230, HiveOS 8.1r2a build-178408",
      "extreme-iq-engine-ap",
    ],
    [
      "1.3.6.1.4.1.4329.15.1.1.13",
      "Extreme Networks Wireless Controller - V2110 Medium",
      "extreme-wireless-controller",
    ],
    ["1.3.6.1.4.1.17713.22.8", "Cambium XV3-8", "cambium-wifi-ap"],
  ])(
    "offers %s (%s) the %s template",
    (sysObjectId: string, sysDescr: string, id: string) => {
      const advice: WifiAdvice = getWifiAdvice(
        device({ sysObjectId: sysObjectId, sysDescr: sysDescr }),
      );

      expect(advice.kind).toBe(WifiAdviceKind.ApplyTemplate);
      expect(templateOf(advice)).toBe(id);
    },
  );

  test("waits for the next poll once the device has every Wi-Fi table of its template", () => {
    const advice: WifiAdvice = getWifiAdvice(
      device({
        ...UNIFI,
        snmpTables: template("ubiquiti-unifi-ap").tables,
      }),
    );

    expect(advice.kind).toBe(WifiAdviceKind.WaitForPoll);
    expect(templateOf(advice)).toBe("ubiquiti-unifi-ap");
  });

  test("still offers the template while one of its Wi-Fi tables is missing", () => {
    const radiosOnly: Array<SnmpTableDefinition> = template(
      "ubiquiti-unifi-ap",
    ).tables!.filter((table: SnmpTableDefinition) => {
      return table.key === "wifi_radios";
    });

    expect(
      getWifiAdvice(device({ ...UNIFI, snmpTables: radiosOnly })).kind,
    ).toBe(WifiAdviceKind.ApplyTemplate);
  });

  test("counts a table saved without a key by the key its name gives it", () => {
    const tables: Array<SnmpTableDefinition> = template(
      "ubiquiti-unifi-ap",
    ).tables!.map((table: SnmpTableDefinition) => {
      return { ...table, key: "" };
    });

    expect(
      getWifiAdvice(device({ ...UNIFI, snmpTables: tables })).kind,
    ).toBe(WifiAdviceKind.ApplyTemplate);

    // "WiFi Radios" is saved as wifi_radios, the key the template's radio table has.
    const named: Array<SnmpTableDefinition> = [
      { key: "", name: "WiFi Radios", columns: [] },
      { key: "wifi_ssids", name: "SSIDs", columns: [] },
    ];

    expect(
      getWifiAdvice(device({ ...UNIFI, snmpTables: named })).kind,
    ).toBe(WifiAdviceKind.WaitForPoll);
  });

  test("says a monitor-backed device is not walked, whatever it is", () => {
    expect(
      getWifiAdvice(device({ ...UNIFI, monitoringMethod: "Monitor" })).kind,
    ).toBe(WifiAdviceKind.MonitorBacked);
  });

  test("sends a device linked to an OID Collection Template to that template", () => {
    expect(
      getWifiAdvice(
        device({
          ...UNIFI,
          oidTemplateId: new ObjectID("33333333-3333-4333-8333-333333333333"),
        }),
      ).kind,
    ).toBe(WifiAdviceKind.LinkedToOidTemplate);
  });

  test("waits for the first SNMP read of a device it cannot identify yet", () => {
    expect(getWifiAdvice(device()).kind).toBe(WifiAdviceKind.NotIdentified);
    expect(getWifiAdvice(device({ sysObjectId: "  " })).kind).toBe(
      WifiAdviceKind.NotIdentified,
    );
  });

  test.each([
    // A template that reads no Wi-Fi.
    ["1.3.6.1.4.1.9.1.1208", "Cisco IOS Software"],
    // No template at all.
    ["1.3.6.1.4.1.987654.1", "Something"],
    // TP-Link Omada: only a client count, no radios to read.
    ["1.3.6.1.4.1.11863.1.1.3", "TL-SG3428"],
  ])(
    "lists the supported vendors for %s (%s), which no Wi-Fi template reads",
    (sysObjectId: string, sysDescr: string) => {
      expect(
        getWifiAdvice(device({ sysObjectId: sysObjectId, sysDescr: sysDescr }))
          .kind,
      ).toBe(WifiAdviceKind.NoWifiTemplate);
    },
  );
});

describe("the Wi-Fi templates", () => {
  test("are every template with an access point, radio or SSID table, in the template list's order", () => {
    expect(
      getWifiTemplates().map((entry: SnmpVendorTemplate) => {
        return entry.id;
      }),
    ).toEqual([
      "cambium-wifi-ap",
      "extreme-iq-engine-ap",
      "extreme-wireless-controller",
      "aruba-instant",
      "aruba-mobility-controller",
      "ubiquiti-unifi-ap",
    ]);
  });

  test("leave out TP-Link Omada, which reports no radios, and every wired template", () => {
    expect(hasWifiTables(template("tplink-omada-eap"))).toBe(false);
    expect(hasWifiTables(template("sophos-sfos"))).toBe(false);
    expect(hasWifiTables(template("cisco-ios"))).toBe(false);
  });

  test("are explained in the network device guide's supported vendors section", () => {
    expect(WIFI_VENDORS_DOCS_PATH).toBe(
      "/monitor/network-device-monitor#supported-wi-fi-vendors",
    );
  });
});
