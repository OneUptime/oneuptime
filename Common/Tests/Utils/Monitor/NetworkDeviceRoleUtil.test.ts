import { describe, expect, test } from "@jest/globals";
import { NetworkTopologyDeviceRole } from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  DEVICE_ROLES_IN_LEGEND_ORDER,
  DEVICE_ROLE_LABELS,
  classifyDeviceRole,
  classifyEndpointRole,
  labelForDeviceRole,
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
