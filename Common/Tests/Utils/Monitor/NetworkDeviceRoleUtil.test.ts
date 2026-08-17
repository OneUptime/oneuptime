import { describe, expect, test } from "@jest/globals";
import { NetworkTopologyDeviceRole } from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  DEVICE_ROLES_IN_LEGEND_ORDER,
  DEVICE_ROLE_LABELS,
  DeviceRoleSignals,
  classifyDeviceRole,
  classifyEndpointRole,
  labelForDeviceRole,
  parseDeviceRoleOverride,
  resolveDeviceRole,
} from "../../../Utils/Monitor/NetworkDeviceRoleUtil";

/*
 * The role classifier decides what shape every node on the topology map is
 * drawn as, so these tests are written as a catalogue of real hardware
 * strings — the ones SNMP actually returns — rather than as coverage of
 * the regexes. The interesting cases are the collisions: vendors reuse
 * each other's model prefixes (Juniper MX960 vs Meraki MX64), reuse their
 * OWN prefixes across roles (Catalyst 2960 / 8300 / 9800), and put a
 * Linux kernel in the sysDescr of things that are emphatically not
 * servers.
 */

describe("classifyDeviceRole — switches", () => {
  test("Cisco Catalyst and Nexus families", () => {
    expect(classifyDeviceRole({ deviceModel: "Catalyst 2960X-48TS-L" })).toBe(
      "switch",
    );
    expect(classifyDeviceRole({ deviceModel: "WS-C3850-48P" })).toBe("switch");
    expect(classifyDeviceRole({ deviceModel: "Nexus 9336C-FX2" })).toBe(
      "switch",
    );
    expect(classifyDeviceRole({ deviceModel: "C9300-24T" })).toBe("switch");
  });

  test("Juniper EX and QFX", () => {
    expect(
      classifyDeviceRole({
        vendor: "Juniper Networks",
        deviceModel: "EX4300-48T",
      }),
    ).toBe("switch");
    expect(
      classifyDeviceRole({
        vendor: "Juniper Networks",
        deviceModel: "QFX5120",
      }),
    ).toBe("switch");
  });

  test("other switching families", () => {
    expect(classifyDeviceRole({ deviceModel: "DCS-7050SX3-48YC8" })).toBe(
      "switch",
    );
    expect(classifyDeviceRole({ deviceModel: "FortiSwitch-124E" })).toBe(
      "switch",
    );
    expect(classifyDeviceRole({ deviceModel: "ProCurve J9085A" })).toBe(
      "switch",
    );
    expect(classifyDeviceRole({ deviceModel: "PowerConnect 5548" })).toBe(
      "switch",
    );
    expect(classifyDeviceRole({ deviceModel: "USW-24-PoE" })).toBe("switch");
  });

  test("MikroTik CRS is a switch even though MikroTik reads as a router", () => {
    expect(
      classifyDeviceRole({ sysDescr: "MikroTik RouterOS CRS326-24G-2S+" }),
    ).toBe("switch");
  });
});

describe("classifyDeviceRole — routers", () => {
  test("Cisco ISR and ASR", () => {
    expect(classifyDeviceRole({ deviceModel: "ISR4331/K9" })).toBe("router");
    expect(classifyDeviceRole({ deviceModel: "ASR1001-X" })).toBe("router");
  });

  test("Juniper MX only when the vendor evidence says Juniper", () => {
    expect(
      classifyDeviceRole({ vendor: "Juniper Networks", deviceModel: "MX960" }),
    ).toBe("router");
    expect(
      classifyDeviceRole({ sysDescr: "Juniper Networks, Inc. mx240 JUNOS" }),
    ).toBe("router");
  });

  test("MikroTik and other router families", () => {
    expect(classifyDeviceRole({ sysDescr: "RouterOS CCR1036-8G-2S+" })).toBe(
      "router",
    );
    expect(classifyDeviceRole({ deviceModel: "EdgeRouter 4" })).toBe("router");
  });
});

describe("classifyDeviceRole — the Catalyst collision", () => {
  test("Catalyst names three different roles and each wins its own", () => {
    expect(classifyDeviceRole({ deviceModel: "Catalyst 2960X" })).toBe(
      "switch",
    );
    expect(classifyDeviceRole({ deviceModel: "Catalyst 8300-1N1S-4T2X" })).toBe(
      "router",
    );
    expect(
      classifyDeviceRole({ deviceModel: "Catalyst 9800-40 Wireless" }),
    ).toBe("wirelessAccessPoint");
  });

  test("the bare model codes collide the same way and resolve the same way", () => {
    expect(classifyDeviceRole({ deviceModel: "C9300L-24P" })).toBe("switch");
    expect(classifyDeviceRole({ deviceModel: "C8500-12X" })).toBe("router");
    expect(classifyDeviceRole({ deviceModel: "C9800-CL" })).toBe(
      "wirelessAccessPoint",
    );
  });
});

describe("classifyDeviceRole — the MX collision", () => {
  test("Meraki MX is a firewall, Juniper MX is a router", () => {
    expect(
      classifyDeviceRole({ vendor: "Cisco Meraki", deviceModel: "MX68" }),
    ).toBe("firewall");
    expect(
      classifyDeviceRole({ vendor: "Juniper Networks", deviceModel: "MX204" }),
    ).toBe("router");
  });

  test("the Meraki rule reads the platform string, not just the vendor column", () => {
    expect(classifyDeviceRole({ platform: "Meraki MX250 Cloud Managed" })).toBe(
      "firewall",
    );
  });

  test("an MX with no vendor evidence at all stays unknown rather than guessing", () => {
    expect(classifyDeviceRole({ deviceModel: "MX100" })).toBe("unknown");
  });
});

describe("classifyDeviceRole — firewalls", () => {
  test("the major firewall families", () => {
    expect(classifyDeviceRole({ deviceModel: "FortiGate-60F" })).toBe(
      "firewall",
    );
    expect(classifyDeviceRole({ deviceModel: "PA-3220" })).toBe("firewall");
    expect(classifyDeviceRole({ deviceModel: "SRX345" })).toBe("firewall");
    expect(
      classifyDeviceRole({ sysDescr: "Cisco Adaptive Security Appliance" }),
    ).toBe("firewall");
    expect(classifyDeviceRole({ deviceModel: "ASA5516-X" })).toBe("firewall");
    expect(classifyDeviceRole({ sysDescr: "Firepower Threat Defense" })).toBe(
      "firewall",
    );
    expect(classifyDeviceRole({ sysDescr: "SonicWALL NSa 2700" })).toBe(
      "firewall",
    );
    expect(classifyDeviceRole({ sysDescr: "pfSense 2.7.0-RELEASE" })).toBe(
      "firewall",
    );
  });

  test("Sophos SG is a firewall and does not fall into the SG switch rule", () => {
    expect(classifyDeviceRole({ deviceModel: "Sophos SG 210" })).toBe(
      "firewall",
    );
    expect(classifyDeviceRole({ deviceModel: "SG350-28P" })).toBe("switch");
  });
});

describe("classifyDeviceRole — wireless, load balancers, storage, servers", () => {
  test("access points and controllers", () => {
    expect(classifyDeviceRole({ deviceModel: "AIR-CAP3702I-A-K9" })).toBe(
      "wirelessAccessPoint",
    );
    expect(classifyDeviceRole({ sysDescr: "Cisco Aironet 1852i" })).toBe(
      "wirelessAccessPoint",
    );
    expect(classifyDeviceRole({ deviceModel: "FortiAP-231F" })).toBe(
      "wirelessAccessPoint",
    );
    expect(
      classifyDeviceRole({ vendor: "Cisco Meraki", deviceModel: "MR46" }),
    ).toBe("wirelessAccessPoint");
    expect(classifyDeviceRole({ deviceModel: "AP-515" })).toBe(
      "wirelessAccessPoint",
    );
  });

  test("load balancers", () => {
    expect(classifyDeviceRole({ sysDescr: "BIG-IP 4000s" })).toBe(
      "loadBalancer",
    );
    expect(classifyDeviceRole({ sysDescr: "NetScaler MPX 8905" })).toBe(
      "loadBalancer",
    );
    expect(classifyDeviceRole({ deviceModel: "Thunder 3030S" })).toBe(
      "unknown",
    );
    expect(classifyDeviceRole({ deviceModel: "A10 Thunder 3030S" })).toBe(
      "loadBalancer",
    );
  });

  test("storage", () => {
    expect(
      classifyDeviceRole({ vendor: "NetApp", sysDescr: "NetApp Release 9.9" }),
    ).toBe("storage");
    expect(classifyDeviceRole({ deviceModel: "Synology DS1819+" })).toBe(
      "storage",
    );
  });

  test("servers and hypervisors", () => {
    expect(classifyDeviceRole({ sysDescr: "VMware ESXi 7.0.3" })).toBe(
      "server",
    );
    expect(classifyDeviceRole({ deviceModel: "PowerEdge R740" })).toBe(
      "server",
    );
    expect(classifyDeviceRole({ sysDescr: "HPE iLO 5" })).toBe("server");
  });

  test("printers, cameras and phones that speak SNMP", () => {
    expect(classifyDeviceRole({ deviceModel: "HP LaserJet M607" })).toBe(
      "printer",
    );
    expect(
      classifyDeviceRole({ sysDescr: "AXIS P3245-LVE Network Camera" }),
    ).toBe("camera");
    expect(classifyDeviceRole({ sysDescr: "Cisco IP Phone 7961" })).toBe(
      "phone",
    );
  });
});

describe("classifyDeviceRole — evidence precedence", () => {
  test("the model beats a sysDescr that says something else", () => {
    /*
     * The box is a switch; its sysDescr is the vendor's boilerplate about
     * the software image, which mentions routing.
     */
    expect(
      classifyDeviceRole({
        deviceModel: "Catalyst 2960X",
        sysDescr: "Cisco IOS Software, IP Routing Base",
      }),
    ).toBe("switch");
  });

  test("sysDescr beats sysObjectId", () => {
    expect(
      classifyDeviceRole({
        sysDescr: "FortiSwitch-148F",
        // Fortinet's arc on its own would say firewall.
        sysObjectId: "1.3.6.1.4.1.12356.106.1.1",
      }),
    ).toBe("switch");
  });

  test("sysObjectId beats the generic words in sysDescr", () => {
    expect(
      classifyDeviceRole({
        sysDescr: "Linux-based security gateway appliance",
        sysObjectId: "1.3.6.1.4.1.3375.2.1.3.4.10",
      }),
    ).toBe("loadBalancer");
  });

  test("a generic word in sysDescr beats the hostname convention", () => {
    expect(
      classifyDeviceRole({
        sysDescr: "24-port Gigabit Switch",
        name: "edge-fw01",
      }),
    ).toBe("switch");
  });

  test("sysName is preferred to name when the two disagree", () => {
    expect(
      classifyDeviceRole({ sysName: "core-rtr-1", name: "core-sw-1" }),
    ).toBe("router");
  });

  test("the hostname beats a Linux kernel in sysDescr", () => {
    /*
     * The regression this ordering exists for: plenty of network gear
     * announces "Linux ...", and calling every one of them a server would
     * shape the whole map wrong.
     */
    expect(
      classifyDeviceRole({
        sysDescr: "Linux gw-1 5.4.0-91-generic x86_64",
        name: "gw-1",
      }),
    ).toBe("router");
    expect(
      classifyDeviceRole({
        sysDescr: "Linux fw-edge-1 5.15.0 x86_64",
        name: "fw-edge-1",
      }),
    ).toBe("firewall");
  });

  test("the hostname also beats a generic SNMP agent OID", () => {
    expect(
      classifyDeviceRole({
        sysObjectId: "1.3.6.1.4.1.8072.3.2.10",
        name: "core-sw-2",
      }),
    ).toBe("switch");
  });

  test("a Linux box with an uninformative name is still a server", () => {
    expect(
      classifyDeviceRole({
        sysDescr: "Linux app-3 5.4.0-91-generic x86_64",
        name: "app-3",
      }),
    ).toBe("server");
  });
});

describe("classifyDeviceRole — sysObjectId arcs", () => {
  test("single-role vendor arcs", () => {
    expect(
      classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.25461.2.3.18" }),
    ).toBe("firewall");
    expect(classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.789.2.5" })).toBe(
      "storage",
    );
    expect(
      classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.30065.1.3011" }),
    ).toBe("switch");
    expect(classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.14988.1" })).toBe(
      "router",
    );
  });

  test("a leading dot, which many agents emit, is tolerated", () => {
    expect(classifyDeviceRole({ sysObjectId: ".1.3.6.1.4.1.3375.2.1.3" })).toBe(
      "loadBalancer",
    );
  });

  test("an exact arc with no children matches", () => {
    expect(classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.789" })).toBe(
      "storage",
    );
  });

  test("matching is on dotted boundaries, so a longer arc is not a prefix", () => {
    /*
     * ".11" (HP) must not swallow ".1124", and the printer arc under HP
     * must not claim every HP switch.
     */
    expect(classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.7890.1" })).toBe(
      "unknown",
    );
    expect(classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.11.2.3.7.11" })).toBe(
      "unknown",
    );
    expect(classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.11.2.3.9.1" })).toBe(
      "printer",
    );
  });

  test("a mixed-catalogue vendor's arc says nothing on its own", () => {
    // Cisco and Juniper make every kind of box; their arcs are no evidence.
    expect(classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.9.1.1745" })).toBe(
      "unknown",
    );
    expect(classifyDeviceRole({ sysObjectId: "1.3.6.1.4.1.2636.1.1.1" })).toBe(
      "unknown",
    );
  });
});

describe("classifyDeviceRole — hostname conventions", () => {
  test("the common abbreviations, as whole tokens", () => {
    const expectations: Array<[string, NetworkTopologyDeviceRole]> = [
      ["core-rtr-1", "router"],
      ["dc1-gw01", "router"],
      ["idf2-sw-3", "switch"],
      ["spine-01", "switch"],
      ["edge-fw01", "firewall"],
      ["bldg-a-ap-12", "wirelessAccessPoint"],
      ["prod-lb-2", "loadBalancer"],
      ["srv-db-1", "server"],
      ["nas-backup", "storage"],
      ["lobby-cam-4", "camera"],
    ];
    for (const [name, role] of expectations) {
      expect(classifyDeviceRole({ name: name })).toBe(role);
    }
  });

  test("separators other than the hyphen work too", () => {
    expect(classifyDeviceRole({ name: "core.sw.1" })).toBe("switch");
    expect(classifyDeviceRole({ name: "core_fw_1" })).toBe("firewall");
    expect(classifyDeviceRole({ name: "CORE SW 1" })).toBe("switch");
  });

  test("substrings never match — this is the whole point of tokenizing", () => {
    expect(classifyDeviceRole({ name: "swansea-office" })).toBe("unknown");
    expect(classifyDeviceRole({ name: "apex-1" })).toBe("unknown");
    expect(classifyDeviceRole({ name: "lbrary-node" })).toBe("unknown");
    expect(classifyDeviceRole({ name: "greatwall" })).toBe("unknown");
  });

  test("a token with a trailing index still matches", () => {
    expect(classifyDeviceRole({ name: "sw01" })).toBe("switch");
    expect(classifyDeviceRole({ name: "fw2.example.com" })).toBe("firewall");
  });
});

describe("classifyDeviceRole — nothing to go on", () => {
  test("empty, blank and absent signals all come back unknown", () => {
    expect(classifyDeviceRole({})).toBe("unknown");
    expect(
      classifyDeviceRole({
        name: "",
        sysName: "   ",
        sysDescr: "",
        deviceModel: undefined,
        sysObjectId: "",
      }),
    ).toBe("unknown");
  });

  test("an unremarkable name is unknown, not a bad guess", () => {
    expect(classifyDeviceRole({ name: "device-42" })).toBe("unknown");
  });

  test("classification is case- and whitespace-insensitive", () => {
    expect(classifyDeviceRole({ deviceModel: "  CATALYST   2960X  " })).toBe(
      "switch",
    );
    expect(classifyDeviceRole({ deviceModel: "fortigate-60f" })).toBe(
      "firewall",
    );
  });
});

describe("classifyEndpointRole", () => {
  test("an endpoint with nothing said about it is a host", () => {
    expect(classifyEndpointRole({})).toBe("host");
    expect(classifyEndpointRole({ name: "aa:bb:cc:dd:ee:ff" })).toBe("host");
    expect(classifyEndpointRole({ classification: "POS terminal" })).toBe(
      "host",
    );
    expect(classifyEndpointRole({ classification: "Kiosk" })).toBe("host");
  });

  test("the human-typed classification is read first", () => {
    expect(classifyEndpointRole({ classification: "Camera" })).toBe("camera");
    expect(classifyEndpointRole({ classification: "printer" })).toBe("printer");
    expect(classifyEndpointRole({ classification: "IP phone" })).toBe("phone");
    expect(classifyEndpointRole({ classification: "Access point" })).toBe(
      "wirelessAccessPoint",
    );
  });

  test("the OUI vendor is the fallback when nobody classified it", () => {
    expect(
      classifyEndpointRole({ vendor: "Hikvision Digital Technology" }),
    ).toBe("camera");
    expect(classifyEndpointRole({ vendor: "Zebra Technologies" })).toBe(
      "printer",
    );
    expect(classifyEndpointRole({ vendor: "Polycom Inc" })).toBe("phone");
  });

  test("a classification wins over a vendor that disagrees", () => {
    expect(
      classifyEndpointRole({
        classification: "Camera",
        vendor: "Zebra Technologies",
      }),
    ).toBe("camera");
  });

  test("an unrecognised vendor leaves it a host", () => {
    expect(classifyEndpointRole({ vendor: "Intel Corporate" })).toBe("host");
  });

  test("the name is the last resort", () => {
    expect(classifyEndpointRole({ name: "warehouse-camera-3" })).toBe("camera");
  });
});

describe("labels", () => {
  test("every role has a label", () => {
    const roles: Array<NetworkTopologyDeviceRole> = Object.keys(
      DEVICE_ROLE_LABELS,
    ) as Array<NetworkTopologyDeviceRole>;
    for (const role of roles) {
      expect(typeof DEVICE_ROLE_LABELS[role]).toBe("string");
      expect(DEVICE_ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });

  test("labelForDeviceRole falls back for an absent role", () => {
    expect(labelForDeviceRole("switch")).toBe("Switch");
    expect(labelForDeviceRole(undefined)).toBe(DEVICE_ROLE_LABELS.unknown);
  });

  test("the legend order lists every role except unknown, once each", () => {
    expect(DEVICE_ROLES_IN_LEGEND_ORDER).not.toContain("unknown");
    expect(new Set(DEVICE_ROLES_IN_LEGEND_ORDER).size).toBe(
      DEVICE_ROLES_IN_LEGEND_ORDER.length,
    );
    expect(DEVICE_ROLES_IN_LEGEND_ORDER.length).toBe(
      Object.keys(DEVICE_ROLE_LABELS).length - 1,
    );
  });
});

/*
 * The operator's override (NetworkDevice.deviceRole), from issue #3192.
 *
 * The classifier above only ever sees SNMP, so a device that answers
 * nothing but ping is unclassifiable forever — it is drawn "unknown" and
 * no amount of re-polling changes that. The override is the operator
 * saying what the box IS, which is the only statement about a role in the
 * system that is not an inference, so it has to beat every tier of
 * evidence. Everything below is about the two halves of that promise:
 * parseDeviceRoleOverride deciding whether a stored string is a
 * declaration at all, and resolveDeviceRole deciding who wins when it is.
 */

/*
 * A real switch, described by every tier at once: named product family in
 * the model, the vendor's boilerplate in sysDescr, Cisco's arc in the OID,
 * and a hostname that follows the convention. Nothing about this device is
 * ambiguous, which is exactly why it is the right device to point an
 * override at — if the override wins here it wins anywhere.
 */
const CATALYST_SWITCH_SIGNALS: DeviceRoleSignals = {
  vendor: "Cisco Systems",
  deviceModel: "WS-C2960X-48FPD-L",
  sysDescr: "Cisco IOS Software, C2960X Software, Catalyst 2960X switch",
  sysObjectId: "1.3.6.1.4.1.9.1.1745",
  sysName: "idf2-sw-3",
  name: "idf2-sw-3",
};

describe("parseDeviceRoleOverride — the values it accepts", () => {
  test("every role a legend can show round-trips through the column", () => {
    /*
     * The column is what the picker writes and what the topology builder
     * reads back, so the set it accepts has to be exactly the set the UI
     * offers. Looping the legend rather than listing the roles means a new
     * role cannot be added to the type without this test covering it.
     */
    for (const role of DEVICE_ROLES_IN_LEGEND_ORDER) {
      const parsed: NetworkTopologyDeviceRole | undefined =
        parseDeviceRoleOverride(role);
      expect(parsed).toBe(role);
    }
  });

  test("matching ignores the case the value was stored in", () => {
    /*
     * Values arrive from a form, an API caller and a seed script, and none
     * of them agree about casing.
     */
    expect(parseDeviceRoleOverride("switch")).toBe("switch");
    expect(parseDeviceRoleOverride("SWITCH")).toBe("switch");
    expect(parseDeviceRoleOverride("Switch")).toBe("switch");
    expect(parseDeviceRoleOverride("sWiTcH")).toBe("switch");
  });

  test("the camelCase roles survive every casing, which a one-sided compare would break", () => {
    /*
     * wirelessAccessPoint and loadBalancer are the only two role keys with
     * an internal capital, so they are the two a naive
     * `role === value.toLowerCase()` would silently drop — the stored value
     * would look valid, parse to undefined, and the classifier would
     * quietly overrule the operator. Both sides have to be lowercased.
     */
    expect(parseDeviceRoleOverride("wirelessAccessPoint")).toBe(
      "wirelessAccessPoint",
    );
    expect(parseDeviceRoleOverride("wirelessaccesspoint")).toBe(
      "wirelessAccessPoint",
    );
    expect(parseDeviceRoleOverride("WIRELESSACCESSPOINT")).toBe(
      "wirelessAccessPoint",
    );
    expect(parseDeviceRoleOverride("WirelessAccessPoint")).toBe(
      "wirelessAccessPoint",
    );

    expect(parseDeviceRoleOverride("loadBalancer")).toBe("loadBalancer");
    expect(parseDeviceRoleOverride("loadbalancer")).toBe("loadBalancer");
    expect(parseDeviceRoleOverride("LOADBALANCER")).toBe("loadBalancer");
    expect(parseDeviceRoleOverride("LoadBalancer")).toBe("loadBalancer");
  });

  test("surrounding whitespace is trimmed off before matching", () => {
    // Copy-paste into a text field is the normal way a stray space arrives.
    expect(parseDeviceRoleOverride(" router ")).toBe("router");
    expect(parseDeviceRoleOverride("\tswitch")).toBe("switch");
    expect(parseDeviceRoleOverride("firewall\n")).toBe("firewall");
    expect(parseDeviceRoleOverride("   loadBalancer   ")).toBe("loadBalancer");
    expect(parseDeviceRoleOverride("\n  wirelessaccesspoint \t ")).toBe(
      "wirelessAccessPoint",
    );
  });
});

describe("parseDeviceRoleOverride — the values it refuses", () => {
  test("absent, empty and blank all mean no override rather than a role", () => {
    /*
     * Undefined is the answer that lets the classifier run, so every way of
     * saying "the operator never filled this in" — a null column, an empty
     * string from a cleared form, a field containing only spaces — has to
     * land on it.
     */
    expect(parseDeviceRoleOverride(undefined)).toBeUndefined();
    expect(parseDeviceRoleOverride(null)).toBeUndefined();
    expect(parseDeviceRoleOverride("")).toBeUndefined();
    expect(parseDeviceRoleOverride("   ")).toBeUndefined();
    expect(parseDeviceRoleOverride("\t\n  ")).toBeUndefined();
  });

  test('"unknown" is deliberately refused even though it is a real role', () => {
    /*
     * This is the one refusal that is a design decision rather than a
     * validation failure. Empty already means "classify it", so storing
     * "unknown" could only mean the different and much less useful thing:
     * pin this device to the neutral shape and switch the classifier off
     * for good. An operator who does not know what a box is wants the
     * classifier to keep trying, not to be silenced — so "unknown" is not
     * in DEVICE_ROLES_IN_LEGEND_ORDER and parses as no override at all.
     */
    expect(parseDeviceRoleOverride("unknown")).toBeUndefined();
    expect(parseDeviceRoleOverride("Unknown")).toBeUndefined();
    expect(parseDeviceRoleOverride("UNKNOWN")).toBeUndefined();
    expect(parseDeviceRoleOverride("  unknown  ")).toBeUndefined();
  });

  test("unrecognised text is refused rather than partially matched", () => {
    /*
     * The match is whole-string equality on purpose: a prefix or substring
     * rule would let "rout" or "router-ish" mean router, and an override
     * that quietly means something adjacent to what was typed is worse
     * than one that does nothing.
     */
    expect(parseDeviceRoleOverride("banana")).toBeUndefined();
    expect(parseDeviceRoleOverride("rout")).toBeUndefined();
    expect(parseDeviceRoleOverride("router-ish")).toBeUndefined();
    expect(parseDeviceRoleOverride("routers")).toBeUndefined();
    expect(parseDeviceRoleOverride("sw")).toBeUndefined();
    expect(parseDeviceRoleOverride("core-sw-1")).toBeUndefined();
    expect(parseDeviceRoleOverride("42")).toBeUndefined();
  });

  test("only the surrounding whitespace is forgiven, never the internal kind", () => {
    /*
     * Trimming the ends is a paste artefact; rewriting the middle would be
     * guessing. "wireless access point" is prose, not the stored value, so
     * it is refused — while the same letters with only outer padding are
     * accepted (covered above).
     */
    expect(parseDeviceRoleOverride("wireless access point")).toBeUndefined();
    expect(parseDeviceRoleOverride("wireless  accesspoint")).toBeUndefined();
    expect(parseDeviceRoleOverride("wireless-access-point")).toBeUndefined();
    expect(parseDeviceRoleOverride("wireless_access_point")).toBeUndefined();
    expect(parseDeviceRoleOverride("load balancer")).toBeUndefined();
    expect(parseDeviceRoleOverride("load-balancer")).toBeUndefined();
  });

  test("the display labels are not storable values", () => {
    /*
     * DEVICE_ROLE_LABELS is what a human reads; the column holds the role
     * key. The multi-word labels are the ones that would break if a UI ever
     * wrote the label back, so they must not silently parse.
     */
    expect(
      parseDeviceRoleOverride(DEVICE_ROLE_LABELS.wirelessAccessPoint),
    ).toBe(undefined);
    expect(parseDeviceRoleOverride(DEVICE_ROLE_LABELS.loadBalancer)).toBe(
      undefined,
    );
    expect(parseDeviceRoleOverride(DEVICE_ROLE_LABELS.phone)).toBe(undefined);
    expect(parseDeviceRoleOverride(DEVICE_ROLE_LABELS.unknown)).toBe(undefined);
  });
});

describe("parseDeviceRoleOverride — determinism", () => {
  test("the same value parses the same way however many times it is asked", () => {
    /*
     * Cheap insurance against any future implementation that reaches for a
     * shared regex (whose lastIndex is stateful) or a memo keyed on
     * something mutable: the same input must not answer differently on the
     * second call, or a topology would depend on how many devices were
     * built before it.
     */
    const values: Array<string> = [
      "switch",
      "SWITCH",
      "unknown",
      "banana",
      "loadBalancer",
      "switch",
    ];
    const firstPass: Array<NetworkTopologyDeviceRole | undefined> = values.map(
      (value: string) => {
        return parseDeviceRoleOverride(value);
      },
    );
    const secondPass: Array<NetworkTopologyDeviceRole | undefined> = values.map(
      (value: string) => {
        return parseDeviceRoleOverride(value);
      },
    );

    expect(secondPass).toEqual(firstPass);
    expect(firstPass).toEqual([
      "switch",
      "switch",
      undefined,
      undefined,
      "loadBalancer",
      "switch",
    ]);
  });

  test("parsing the legend backwards gives the same answers as parsing it forwards", () => {
    /*
     * The order the caller happens to iterate in must not leak into the
     * result — the same guarantee the topology builder relies on when it
     * resolves devices in whatever order the database returned them.
     */
    const forwards: Array<NetworkTopologyDeviceRole | undefined> =
      DEVICE_ROLES_IN_LEGEND_ORDER.map((role: NetworkTopologyDeviceRole) => {
        return parseDeviceRoleOverride(role);
      });
    const backwards: Array<NetworkTopologyDeviceRole | undefined> = [
      ...DEVICE_ROLES_IN_LEGEND_ORDER,
    ]
      .reverse()
      .map((role: NetworkTopologyDeviceRole) => {
        return parseDeviceRoleOverride(role);
      });

    expect(backwards).toEqual([...forwards].reverse());
    expect(forwards).toEqual([...DEVICE_ROLES_IN_LEGEND_ORDER]);
  });
});

describe("resolveDeviceRole — a stored override outranks the evidence", () => {
  test("an override beats a sysDescr that names the product family outright", () => {
    /*
     * The device is unmistakably a Catalyst switch by every tier the
     * classifier has. The operator says it is a camera; the operator wins,
     * because the classifier is inferring and the operator is not. (In
     * practice this is a re-used chassis, a lab rig, or a device the
     * operator wants grouped with the cameras on the map.)
     */
    expect(resolveDeviceRole("camera", CATALYST_SWITCH_SIGNALS)).toBe("camera");
  });

  test("an override beats every tier of evidence, one role at a time", () => {
    /*
     * Exhaustive rather than illustrative: whichever role an operator
     * picks, that role is what gets drawn, even on the least ambiguous
     * device in these tests.
     */
    for (const role of DEVICE_ROLES_IN_LEGEND_ORDER) {
      expect(resolveDeviceRole(role, CATALYST_SWITCH_SIGNALS)).toBe(role);
    }
  });

  test("an override beats a matching vendor arc and a matching hostname too", () => {
    // Fortinet's arc plus a "fw" hostname would both say firewall.
    expect(
      resolveDeviceRole("loadBalancer", {
        sysObjectId: "1.3.6.1.4.1.12356.101.1.1",
        sysDescr: "FortiGate-60F v7.2.5",
        name: "edge-fw01",
      }),
    ).toBe("loadBalancer");
  });

  test("the override is honoured in whatever casing it was stored in", () => {
    expect(resolveDeviceRole("CAMERA", CATALYST_SWITCH_SIGNALS)).toBe("camera");
    expect(
      resolveDeviceRole("  wirelessaccesspoint  ", CATALYST_SWITCH_SIGNALS),
    ).toBe("wirelessAccessPoint");
  });
});

describe("resolveDeviceRole — the classifier runs when there is no override", () => {
  test("absent, null, empty and blank overrides all hand back to the classifier", () => {
    expect(resolveDeviceRole(undefined, CATALYST_SWITCH_SIGNALS)).toBe(
      "switch",
    );
    expect(resolveDeviceRole(null, CATALYST_SWITCH_SIGNALS)).toBe("switch");
    expect(resolveDeviceRole("", CATALYST_SWITCH_SIGNALS)).toBe("switch");
    expect(resolveDeviceRole("   ", CATALYST_SWITCH_SIGNALS)).toBe("switch");
  });

  test("an unrecognised override is ignored, not treated as a shrug", () => {
    /*
     * Garbage in the column must not disable the classifier — a typo or a
     * value written by an older client should degrade to the behaviour the
     * device had before the column existed.
     */
    expect(resolveDeviceRole("banana", CATALYST_SWITCH_SIGNALS)).toBe("switch");
    expect(resolveDeviceRole("rout", CATALYST_SWITCH_SIGNALS)).toBe("switch");
    expect(resolveDeviceRole("router-ish", CATALYST_SWITCH_SIGNALS)).toBe(
      "switch",
    );
  });

  test('a stored "unknown" leaves the classifier in charge — the refusal, seen end to end', () => {
    /*
     * The payoff of parseDeviceRoleOverride refusing "unknown": the device
     * is still classified as a switch rather than being pinned neutral.
     */
    expect(resolveDeviceRole("unknown", CATALYST_SWITCH_SIGNALS)).toBe(
      "switch",
    );
    /*
     * And on a device with nothing to go on, the classifier's own answer is
     * "unknown" anyway, so the two paths agree where it matters.
     */
    expect(resolveDeviceRole("unknown", {})).toBe("unknown");
  });

  test("the classifier's full precedence chain still applies underneath", () => {
    // A spot check that resolveDeviceRole is a wrapper, not a second opinion.
    expect(
      resolveDeviceRole(undefined, {
        sysDescr: "Linux gw-1 5.4.0-91-generic x86_64",
        name: "gw-1",
      }),
    ).toBe("router");
    expect(
      resolveDeviceRole("", { sysObjectId: "1.3.6.1.4.1.3375.2.1.3" }),
    ).toBe("loadBalancer");
  });
});

describe("resolveDeviceRole — the ping-only device from issue #3192", () => {
  test("a device with no signals and no override is unknown, as it always was", () => {
    /*
     * The starting position the issue describes: discovery imported a box
     * that answers ICMP and nothing else, so there is no sysDescr, no
     * sysObjectId, no model — and the map draws a neutral node.
     */
    expect(resolveDeviceRole(undefined, {})).toBe("unknown");
    expect(
      resolveDeviceRole(undefined, {
        sysDescr: "",
        sysObjectId: "",
        deviceModel: undefined,
        name: "10.20.30.40",
      }),
    ).toBe("unknown");
  });

  test("a device with no signals but an override is drawn as the operator declared", () => {
    /*
     * The whole point of the feature. Nothing SNMP could ever say about
     * this device will change, so the override is the only way it will ever
     * be anything other than an anonymous circle — and it works with an
     * entirely empty evidence bundle, which is the state a ping-only
     * device is permanently in.
     */
    expect(resolveDeviceRole("router", {})).toBe("router");
    expect(resolveDeviceRole("switch", {})).toBe("switch");
    expect(resolveDeviceRole("firewall", {})).toBe("firewall");
    expect(resolveDeviceRole("wirelessAccessPoint", {})).toBe(
      "wirelessAccessPoint",
    );
  });

  test("an override on a ping-only device survives an uninformative hostname", () => {
    /*
     * "device-42" and a bare IP are what these imports are usually called;
     * neither is a hostname convention the classifier can read, and neither
     * gets to argue with the declaration.
     */
    expect(resolveDeviceRole("router", { name: "device-42" })).toBe("router");
    expect(resolveDeviceRole("printer", { name: "10.20.30.40" })).toBe(
      "printer",
    );
  });

  test("an override still wins once the device later starts answering SNMP", () => {
    /*
     * A ping-only device that is given credentials later suddenly has
     * evidence. The declaration must not be quietly reversed by the first
     * successful walk — the operator has to be the one to change it.
     */
    expect(
      resolveDeviceRole("router", {
        sysDescr: "Cisco IOS Software, Catalyst 2960X switch",
        deviceModel: "WS-C2960X-48FPD-L",
      }),
    ).toBe("router");
  });
});

describe("resolveDeviceRole — determinism and totality", () => {
  test("the order the signal fields were assigned in does not change the answer", () => {
    /*
     * The builder assembles these objects field by field from several
     * sources, so the key insertion order differs between call sites. It
     * must not be observable.
     */
    const oneOrder: DeviceRoleSignals = {
      name: "idf2-sw-3",
      sysDescr: "Cisco IOS Software, Catalyst 2960X switch",
      vendor: "Cisco Systems",
      deviceModel: "WS-C2960X-48FPD-L",
    };
    const anotherOrder: DeviceRoleSignals = {
      deviceModel: "WS-C2960X-48FPD-L",
      vendor: "Cisco Systems",
      sysDescr: "Cisco IOS Software, Catalyst 2960X switch",
      name: "idf2-sw-3",
    };

    expect(resolveDeviceRole(undefined, oneOrder)).toBe(
      resolveDeviceRole(undefined, anotherOrder),
    );
    expect(resolveDeviceRole("camera", oneOrder)).toBe(
      resolveDeviceRole("camera", anotherOrder),
    );
  });

  test("resolving does not mutate the signals it was handed", () => {
    /*
     * The same signals object is read again when the node is rendered, so a
     * normalisation written back in place would make the second read differ
     * from the first.
     */
    const signals: DeviceRoleSignals = { ...CATALYST_SWITCH_SIGNALS };
    resolveDeviceRole("camera", signals);
    resolveDeviceRole(undefined, signals);

    expect(signals).toEqual(CATALYST_SWITCH_SIGNALS);
  });

  test("resolving the same device repeatedly, interleaved with others, is stable", () => {
    const overrides: Array<string | undefined | null> = [
      "camera",
      undefined,
      "unknown",
      null,
      "camera",
      "banana",
    ];
    const firstPass: Array<NetworkTopologyDeviceRole> = overrides.map(
      (override: string | undefined | null) => {
        return resolveDeviceRole(override, CATALYST_SWITCH_SIGNALS);
      },
    );
    const secondPass: Array<NetworkTopologyDeviceRole> = [...overrides]
      .reverse()
      .map((override: string | undefined | null) => {
        return resolveDeviceRole(override, CATALYST_SWITCH_SIGNALS);
      });

    expect(firstPass).toEqual([
      "camera",
      "switch",
      "switch",
      "switch",
      "camera",
      "switch",
    ]);
    expect(secondPass).toEqual([...firstPass].reverse());
  });

  test("it is total: every override and signal combination yields a known role", () => {
    /*
     * resolveDeviceRole feeds NetworkTopologyNode.role, which the map uses
     * to pick a shape and a legend entry, so it can never hand back
     * undefined or a string outside the union.
     */
    const knownRoles: Array<string> = Object.keys(DEVICE_ROLE_LABELS);
    const overrides: Array<string | undefined | null> = [
      undefined,
      null,
      "",
      "   ",
      "unknown",
      "banana",
      "switch",
      "loadBalancer",
      "WIRELESSACCESSPOINT",
    ];
    const bundles: Array<DeviceRoleSignals> = [
      {},
      { name: "device-42" },
      CATALYST_SWITCH_SIGNALS,
      { sysDescr: "Linux app-3 5.4.0-91-generic x86_64", name: "app-3" },
    ];

    for (const override of overrides) {
      for (const bundle of bundles) {
        const role: NetworkTopologyDeviceRole = resolveDeviceRole(
          override,
          bundle,
        );
        expect(knownRoles).toContain(role);
      }
    }
  });
});
