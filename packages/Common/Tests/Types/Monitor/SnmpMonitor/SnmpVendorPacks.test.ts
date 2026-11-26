import SnmpVendorTemplateUtil, {
  CISCO_MDS_CHASSIS_SYS_OBJECT_IDS,
  SnmpVendorTemplate,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import {
  SnmpTableColumn,
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableSnapshot,
  SnmpTableWalkRequest,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil, {
  MAX_DEVICE_SPECIFIC_TABLES,
  MAX_SNMP_TABLE_MAX_ROWS,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpOidListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import SnmpOid from "../../../../Types/Monitor/SnmpMonitor/SnmpOid";
import { classifyDeviceRole } from "../../../../Utils/Monitor/NetworkDeviceRoleUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * The vendor packs for the platforms a customer runs: Extreme EXOS and
 * Fabric Engine switches, Cambium cnMatrix switches and Enterprise Wi-Fi
 * access points, and Sophos firewalls. Each is a template of health OIDs
 * plus SNMP tables, applied by sysObjectID (and, where an enterprise arc
 * hosts two operating systems, by sysDescr).
 */

const NEW_PACK_IDS: Array<string> = [
  "cambium-cnmatrix",
  "cambium-wifi-ap",
  "extreme-exos",
  "extreme-fabric-engine",
  "sophos-sfos",
];

function pack(id: string): SnmpVendorTemplate {
  const template: SnmpVendorTemplate | undefined =
    SnmpVendorTemplateUtil.getById(id);
  expect(template).toBeDefined();
  return template!;
}

function tableOf(id: string, key: string): SnmpTableDefinition {
  const table: SnmpTableDefinition | undefined = pack(id).tables?.find(
    (candidate: SnmpTableDefinition) => {
      return candidate.key === key;
    },
  );
  expect(table).toBeDefined();
  return table!;
}

describe("vendor packs are well-formed", () => {
  it.each(
    SnmpVendorTemplateUtil.getAll().map((t: SnmpVendorTemplate) => {
      return [t.id];
    }),
  )("%s: every OID is numeric and unique", (id: string) => {
    const oids: Array<string> = pack(id).oids.map((oid: SnmpOid) => {
      return oid.oid;
    });

    for (const oid of oids) {
      expect(SnmpOidListUtil.isValidOid(oid)).toBe(true);
    }

    expect(new Set(oids).size).toBe(oids.length);
  });

  it.each(
    SnmpVendorTemplateUtil.getAll().map((t: SnmpVendorTemplate) => {
      return [t.id];
    }),
  )(
    "%s: its tables pass the same validation a saved device's tables do",
    (id: string) => {
      const tables: Array<SnmpTableDefinition> = pack(id).tables || [];

      /*
       * Auto-apply writes these onto a device's own table list, which is
       * validated and capped on save - a pack that does not fit would fail
       * the poll's inventory write.
       */
      expect(tables.length).toBeLessThanOrEqual(MAX_DEVICE_SPECIFIC_TABLES);

      const validated: Array<SnmpTableDefinition> =
        SnmpTableListUtil.validateTableList(tables, {
          max: MAX_DEVICE_SPECIFIC_TABLES,
          label: id,
        });

      expect(
        validated.map((table: SnmpTableDefinition) => {
          return table.key;
        }),
      ).toEqual(
        tables.map((table: SnmpTableDefinition) => {
          return table.key;
        }),
      );
    },
  );

  it("ships the five new packs, each with tables", () => {
    for (const id of NEW_PACK_IDS) {
      expect((pack(id).tables || []).length).toBeGreaterThan(0);
    }
  });

  it("gives every status column the values that mean healthy", () => {
    for (const id of NEW_PACK_IDS) {
      for (const table of pack(id).tables || []) {
        for (const column of table.columns) {
          if (column.role === "Status") {
            expect((column.healthyValues || []).length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("SnmpVendorTemplateUtil.matchDevice", () => {
  it.each([
    [
      "1.3.6.1.4.1.1916.2.175",
      "ExtremeXOS (X440G2-24p-10G4) version 31.7.1.4",
      "extreme-exos",
    ],
    [
      "1.3.6.1.4.1.1916.2.473",
      "7520-48Y-8C-FabricEngine (9.0.4.0)",
      "extreme-fabric-engine",
    ],
    [
      "1.3.6.1.4.1.1916.2.358",
      "5520-24T-VOSS (8.10.0.0)",
      "extreme-fabric-engine",
    ],
    ["1.3.6.1.4.1.1916.2.337", "XA1440 (8.3.0.0)", "extreme-fabric-engine"],
    ["1.3.6.1.4.1.2272.202", "VSP-4850GTS (6.0.1.0)", "extreme-fabric-engine"],
    [
      "1.3.6.1.4.1.17713.22",
      "Cambium cnPilot E500 Access Point",
      "cambium-wifi-ap",
    ],
    [
      ".1.3.6.1.4.1.17713.22.8",
      "Cambium XV3-8 Access Point",
      "cambium-wifi-ap",
    ],
    [
      "1.3.6.1.4.1.17713.24",
      "Cambium Networks cnMatrix TX1012-P-DC Ethernet Switch",
      "cambium-cnmatrix",
    ],
    ["1.3.6.1.4.1.2604.5", "Sophos Firewall", "sophos-sfos"],
    ["1.3.6.1.4.1.9.1.1208", "Cisco IOS Software", "cisco-ios"],
  ])("%s (%s) -> %s", (sysObjectId: string, sysDescr: string, id: string) => {
    expect(
      SnmpVendorTemplateUtil.matchDevice({
        sysObjectId: sysObjectId,
        sysDescr: sysDescr,
      })?.id,
    ).toBe(id);
  });

  it("does not mistake an arc that merely shares digits for the Cambium AP arc", () => {
    expect(
      SnmpVendorTemplateUtil.matchDevice({
        sysObjectId: "1.3.6.1.4.1.17713.220",
      }),
    ).toBeUndefined();
    // cnMaestro and PMP radios live elsewhere under Cambium's arc.
    expect(
      SnmpVendorTemplateUtil.matchDevice({
        sysObjectId: "1.3.6.1.4.1.17713.23",
      }),
    ).toBeUndefined();
  });

  it("reads EXOS when an Extreme switch reports no sysDescr", () => {
    expect(
      SnmpVendorTemplateUtil.matchDevice({
        sysObjectId: "1.3.6.1.4.1.1916.2.473",
      })?.id,
    ).toBe("extreme-exos");
  });

  it("matches nothing outside the enterprises arc or without a sysObjectID", () => {
    expect(
      SnmpVendorTemplateUtil.matchDevice({ sysObjectId: "1.3.6.1.2.1.1" }),
    ).toBeUndefined();
    expect(SnmpVendorTemplateUtil.matchDevice({})).toBeUndefined();
  });

  it("keeps matchBySysObjectId working for callers without a sysDescr", () => {
    expect(
      SnmpVendorTemplateUtil.matchBySysObjectId("1.3.6.1.4.1.2604.5")?.id,
    ).toBe("sophos-sfos");
    expect(
      SnmpVendorTemplateUtil.matchBySysObjectId("1.3.6.1.4.1.2272.212")?.id,
    ).toBe("extreme-fabric-engine");
  });
});

describe("vendor names for the new enterprises", () => {
  it.each([
    ["1.3.6.1.4.1.2604.5", "Sophos"],
    ["1.3.6.1.4.1.21067.2", "Sophos"],
    ["1.3.6.1.4.1.17713.22", "Cambium Networks"],
    ["1.3.6.1.4.1.2272.202", "Extreme Networks"],
    ["1.3.6.1.4.1.1916.2.175", "Extreme Networks"],
  ])("%s -> %s", (sysObjectId: string, vendor: string) => {
    expect(SnmpVendorTemplateUtil.getVendorNameBySysObjectId(sysObjectId)).toBe(
      vendor,
    );
  });
});

describe("SnmpVendorTemplateUtil.mergeTables", () => {
  it("adds a pack's tables once, keeping what is already there", () => {
    const once: Array<SnmpTableDefinition> = SnmpVendorTemplateUtil.mergeTables(
      [],
      "sophos-sfos",
    );
    const twice: Array<SnmpTableDefinition> =
      SnmpVendorTemplateUtil.mergeTables(once, "sophos-sfos");

    expect(once.length).toBe(pack("sophos-sfos").tables!.length);
    expect(twice).toEqual(once);

    const custom: SnmpTableDefinition = {
      key: "ipsec_tunnels",
      name: "My own tunnels",
      columns: [{ oid: "1.3.6.1.4.1.9.1", name: "x" }],
    };

    expect(SnmpVendorTemplateUtil.mergeTables([custom], "sophos-sfos")[0]).toBe(
      custom,
    );
  });

  it("is a no-op for a pack without tables or an unknown id", () => {
    expect(SnmpVendorTemplateUtil.mergeTables([], "cisco-ios")).toEqual([]);
    expect(SnmpVendorTemplateUtil.mergeTables([], "nope")).toEqual([]);
  });
});

describe("the generic template reads CPU whatever the processor numbering", () => {
  it("walks hrProcessorLoad as a table", () => {
    const table: SnmpTableDefinition = tableOf(
      "host-resources-mib",
      "cpu_cores",
    );

    expect(table.columns[0]!.oid).toBe("1.3.6.1.2.1.25.3.3.1.2");
  });

  it("is what Sophos uses too, since SFOS numbers its cores from 196608", () => {
    const snapshot: SnmpTableSnapshot = SnmpTableListUtil.materialize({
      tables: [tableOf("sophos-sfos", "cpu_cores")],
      results: [
        {
          key: "cpu_cores",
          rows: [
            { index: "196608", values: { "1.3.6.1.2.1.25.3.3.1.2": 12 } },
            { index: "196609", values: { "1.3.6.1.2.1.25.3.3.1.2": 31 } },
          ],
        },
      ],
    })[0]!;

    expect(
      snapshot.rows.map((row: SnmpTableSnapshot["rows"][number]) => {
        return row.cells["1.3.6.1.2.1.25.3.3.1.2"]!.numeric;
      }),
    ).toEqual([12, 31]);
  });
});

describe("pack tables read real-shaped walks", () => {
  it("Sophos: names tunnels and marks the ones that are not active", () => {
    const table: SnmpTableDefinition = tableOf("sophos-sfos", "ipsec_tunnels");
    expect(table.kind).toBe(SnmpTableKind.VpnTunnel);

    const snapshot: SnmpTableSnapshot = SnmpTableListUtil.materialize({
      tables: [table],
      results: [
        {
          key: "ipsec_tunnels",
          rows: [
            {
              index: "1",
              values: {
                "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.2": "HQ-Branch1",
                "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9": 1,
                "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.10": 1,
                "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.6": 2,
              },
            },
            {
              index: "2",
              values: {
                "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.2": "HQ-Branch2",
                "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9": 0,
                "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.10": 1,
                "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.6": 3,
              },
            },
          ],
        },
      ],
    })[0]!;

    const second: SnmpTableSnapshot["rows"][number] = snapshot.rows[1]!;
    expect(second.label).toBe("HQ-Branch2");
    expect(second.cells["1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9"]).toEqual({
      raw: 0,
      display: "inactive",
      numeric: 0,
      isHealthy: false,
    });
    expect(second.cells["1.3.6.1.4.1.2604.5.1.6.1.1.1.1.6"]!.display).toBe(
      "tunnel interface",
    );
  });

  it("Cambium: names radios by band and reads channel and width out of text", () => {
    const table: SnmpTableDefinition = tableOf(
      "cambium-wifi-ap",
      "wifi_radios",
    );
    expect(table.kind).toBe(SnmpTableKind.WifiRadio);

    const snapshot: SnmpTableSnapshot = SnmpTableListUtil.materialize({
      tables: [table],
      results: [
        {
          key: "wifi_radios",
          rows: [
            {
              index: "2",
              values: {
                "1.3.6.1.4.1.17713.22.1.2.1.3": "5GHz",
                "1.3.6.1.4.1.17713.22.1.2.1.6": "36",
                "1.3.6.1.4.1.17713.22.1.2.1.7": "80MHz",
                "1.3.6.1.4.1.17713.22.1.2.1.8": 21,
                "1.3.6.1.4.1.17713.22.1.2.1.5": 14,
                "1.3.6.1.4.1.17713.22.1.2.1.16": "-92",
                "1.3.6.1.4.1.17713.22.1.2.1.18": "37/20/17/0",
                "1.3.6.1.4.1.17713.22.1.2.1.13": "ON",
              },
            },
          ],
        },
      ],
    })[0]!;

    const radio: SnmpTableSnapshot["rows"][number] = snapshot.rows[0]!;
    expect(radio.label).toBe("5GHz");
    expect(radio.cells["1.3.6.1.4.1.17713.22.1.2.1.6"]!.numeric).toBe(36);
    expect(radio.cells["1.3.6.1.4.1.17713.22.1.2.1.7"]!.numeric).toBe(80);
    expect(radio.cells["1.3.6.1.4.1.17713.22.1.2.1.16"]!.numeric).toBe(-92);
    expect(radio.cells["1.3.6.1.4.1.17713.22.1.2.1.18"]!.numeric).toBe(37);
    expect(
      radio.cells["1.3.6.1.4.1.17713.22.1.2.1.3"]!.numeric,
    ).toBeUndefined();
    expect(radio.cells["1.3.6.1.4.1.17713.22.1.2.1.13"]).toEqual({
      raw: "ON",
      display: "On",
      isHealthy: true,
    });
  });

  it("Fabric Engine: names IS-IS adjacencies by the neighbour's host name", () => {
    const table: SnmpTableDefinition = tableOf(
      "extreme-fabric-engine",
      "isis_adjacencies",
    );
    expect(table.kind).toBe(SnmpTableKind.RoutingAdjacency);

    const snapshot: SnmpTableSnapshot = SnmpTableListUtil.materialize({
      tables: [table],
      results: [
        {
          key: "isis_adjacencies",
          rows: [
            {
              index: "1.1",
              values: {
                "1.3.6.1.4.1.2272.1.63.10.1.3": "core-b",
                "1.3.6.1.3.37.1.6.1.1.2": 3,
              },
            },
            {
              index: "2.1",
              values: {
                "1.3.6.1.4.1.2272.1.63.10.1.3": "dist-7",
                "1.3.6.1.3.37.1.6.1.1.2": 2,
              },
            },
          ],
        },
      ],
    })[0]!;

    expect(
      snapshot.rows.map((row: SnmpTableSnapshot["rows"][number]) => {
        return `${row.label}:${row.cells["1.3.6.1.3.37.1.6.1.1.2"]!.display}:${row.cells["1.3.6.1.3.37.1.6.1.1.2"]!.isHealthy}`;
      }),
    ).toEqual(["core-b:up:true", "dist-7:initializing:false"]);
  });
});

describe("device roles for the new platforms", () => {
  it.each([
    ["1.3.6.1.4.1.17713.22", "wirelessAccessPoint"],
    ["1.3.6.1.4.1.17713.24", "switch"],
    ["1.3.6.1.4.1.1916.2.175", "switch"],
    ["1.3.6.1.4.1.2272.202", "switch"],
    ["1.3.6.1.4.1.2604.5", "firewall"],
  ])("%s -> %s", (sysObjectId: string, role: string) => {
    expect(classifyDeviceRole({ sysObjectId: sysObjectId })).toBe(role);
  });
});

/*
 * The SAN switch packs (#11014, #11015): Brocade Fabric OS and Cisco MDS
 * 9000. Each is matched by itself, from the switch's sysObjectID (and an
 * MDS's sysDescr), reads the switch's health and its hardware as tables,
 * and changes no other device's template: a Brocade VDX or SLX, a Nexus,
 * an IOS or IOS-XE switch stays where it was.
 */
describe("SAN switch packs", () => {
  const ENT_PHYSICAL_NAME: string = "1.3.6.1.2.1.47.1.1.1.1.7";

  const SAN_PACKS: Array<string> = ["brocade-fos", "cisco-mds"];

  function walkRequest(id: string, key: string): SnmpTableWalkRequest {
    return SnmpTableListUtil.toWalkRequests([tableOf(id, key)])[0]!;
  }

  describe("are well-formed", () => {
    it.each(SAN_PACKS)("%s ships health OIDs and tables", (id: string) => {
      expect(pack(id).oids.length).toBeGreaterThan(0);
      expect((pack(id).tables || []).length).toBeGreaterThan(0);
    });

    it("Brocade: switch state, firmware, CPU and memory from SW-MIB", () => {
      expect(
        pack("brocade-fos").oids.map((oid: SnmpOid) => {
          return [oid.name, oid.oid];
        }),
      ).toEqual([
        ["Switch State", "1.3.6.1.4.1.1588.2.1.1.1.1.7.0"],
        ["Firmware Version", "1.3.6.1.4.1.1588.2.1.1.1.1.6.0"],
        ["CPU %", "1.3.6.1.4.1.1588.2.1.1.1.26.1.0"],
        ["Memory %", "1.3.6.1.4.1.1588.2.1.1.1.26.6.0"],
      ]);
    });

    it("MDS: CPU and memory from CISCO-SYSTEM-EXT-MIB", () => {
      expect(
        pack("cisco-mds").oids.map((oid: SnmpOid) => {
          return oid.oid;
        }),
      ).toEqual(["1.3.6.1.4.1.9.9.305.1.1.1.0", "1.3.6.1.4.1.9.9.305.1.1.2.0"]);
    });

    it.each([
      // connUnitStatus ok(3).
      ["brocade-fos", "switch_status", ["3"]],
      // swSensorStatus nominal(4), absent(6).
      ["brocade-fos", "sensors", ["4", "6"]],
      // fruStatus on(3).
      ["brocade-fos", "frus", ["3"]],
      // cefcFRUPowerOperStatus on(2).
      ["cisco-mds", "power_supplies", ["2"]],
      // cefcModuleOperStatus ok(2).
      ["cisco-mds", "modules", ["2"]],
      // cefcFanTrayOperStatus up(2).
      ["cisco-mds", "fan_trays", ["2"]],
    ])(
      "%s %s: its status column knows what healthy is (%j)",
      (id: string, key: string, healthy: Array<string>) => {
        const statuses: Array<Array<string> | undefined> = tableOf(
          id,
          key,
        )
          .columns.filter((column: SnmpTableColumn) => {
            return column.role === SnmpTableColumnRole.Status;
          })
          .map((column: SnmpTableColumn) => {
            return column.healthyValues;
          });

        expect(statuses).toEqual([healthy]);
      },
    );

    it("MDS VSANs are informational: an empty or isolated VSAN is down by design", () => {
      for (const column of tableOf("cisco-mds", "vsans").columns) {
        expect(column.healthyValues || []).toEqual([]);
      }
    });

    it("a Brocade sensor's -2147483648 is no reading, not minus two billion", () => {
      const value: SnmpTableColumn | undefined = tableOf(
        "brocade-fos",
        "sensors",
      ).columns.find((column: SnmpTableColumn) => {
        return column.name === "Value";
      });

      expect(value?.noReadingValues).toEqual(["-2147483648"]);
      expect(SnmpTableListUtil.buildCell(value!, -2147483648)).toEqual({
        raw: -2147483648,
        display: "",
      });
      expect(SnmpTableListUtil.buildCell(value!, 41).display).toBe("41");
    });

    it.each([
      ["brocade-fos", "frus"],
      ["cisco-mds", "power_supplies"],
      ["cisco-mds", "modules"],
      ["cisco-mds", "fan_trays"],
    ])(
      "%s %s: named by entPhysicalName, read row by row rather than walking the entity table",
      (id: string, key: string) => {
        const table: SnmpTableDefinition = tableOf(id, key);

        expect(table.rowLabelsByIndex).toBe(true);
        expect(table.rowLabelColumnOids).toEqual([ENT_PHYSICAL_NAME]);
        // Kept through the validation a device's saved tables go through.
        expect(
          SnmpTableListUtil.validateTable(table, id)
            .rowLabelsByIndex,
        ).toBe(true);

        const request: SnmpTableWalkRequest = walkRequest(id, key);

        expect(request.labelOids).toEqual([ENT_PHYSICAL_NAME]);
        expect(request.columnOids).not.toContain(ENT_PHYSICAL_NAME);
      },
    );

    it("tables named by a column of their own walk it as before", () => {
      const request: SnmpTableWalkRequest = walkRequest(
        "brocade-fos",
        "sensors",
      );

      expect(request.labelOids).toBeUndefined();
      expect(request.columnOids).toContain(
        "1.3.6.1.4.1.1588.2.1.1.1.1.22.1.5",
      );
    });

    it("the VSAN table reads as many rows as a table may: an MDS has up to 256 VSANs", () => {
      expect(walkRequest("cisco-mds", "vsans").maxRows).toBe(
        MAX_SNMP_TABLE_MAX_ROWS,
      );
    });
  });

  describe("are matched by themselves", () => {
    it.each([
      ["1.3.6.1.4.1.1588.2.1.1.1", "Fibre Channel Switch."],
      // Newer models report themselves under fcSwitch.
      ["1.3.6.1.4.1.1588.2.1.1.162", "G620"],
      ["1.3.6.1.4.1.1588.2.1.1.1", undefined],
    ])(
      "Brocade Fabric OS: %s",
      (sysObjectId: string, sysDescr: string | undefined) => {
        expect(
          SnmpVendorTemplateUtil.matchDevice({
            sysObjectId: sysObjectId,
            sysDescr: sysDescr,
          })?.id,
        ).toBe("brocade-fos");
      },
    );

    it.each([
      // Brocade VDX (Network OS) and SLX are Ethernet switches.
      ["1.3.6.1.4.1.1588.2.2.1.1.1.5", "Brocade VDX Switch."],
      ["1.3.6.1.4.1.1588.3.3.1.131", "SLX-OS Software"],
      // Not under fcSwitch, however it starts.
      ["1.3.6.1.4.1.1588.2.1.10", "Fibre Channel Switch."],
      ["1.3.6.1.4.1.1588.2.1", "Fibre Channel Switch."],
      ["1.3.6.1.4.1.15880.1", "Fibre Channel Switch."],
    ])("not Brocade Fabric OS: %s", (sysObjectId: string, sysDescr: string) => {
      expect(
        SnmpVendorTemplateUtil.matchDevice({
          sysObjectId: sysObjectId,
          sysDescr: sysDescr,
        })?.id,
      ).not.toBe("brocade-fos");
    });

    it.each([
      [1326, "9250i"],
      [1327, "9710"],
      [1420, "9706"],
      [1491, "9148S"],
      [1660, "9396S"],
      [1683, "9718"],
      [1894, "9132T"],
      [1895, "9232U"],
      [2054, "9148T"],
      [2055, "9396T"],
      [2402, "9220i"],
      [2513, "9148V"],
      [2514, "9124V"],
      [2549, "9396V"],
    ])("MDS by its chassis sysObjectID alone: .%s (MDS %s)", (model: number) => {
      const sysObjectId: string = `1.3.6.1.4.1.9.12.3.1.3.${model}`;

      expect(CISCO_MDS_CHASSIS_SYS_OBJECT_IDS.has(sysObjectId)).toBe(true);
      expect(
        SnmpVendorTemplateUtil.matchDevice({ sysObjectId: sysObjectId })?.id,
      ).toBe("cisco-mds");
    });

    it.each([
      "Cisco NX-OS(tm) m9100, Software (m9100-s6ek9-mz), Version 8.4(2c), RELEASE SOFTWARE Copyright (c) 2002-2020 by Cisco Systems, Inc.",
      "Cisco NX-OS(tm) m9300, Software (m9300-s1ek9-mz), Version 9.4(1a), RELEASE SOFTWARE",
      "Cisco NX-OS(tm) m9700, Software (m9700-sf3ek9-mz), Version 8.4(2c)",
      "Cisco NX-OS(tm) m9250i, Software (m9250-s5ek9-mz), Version 8.4(2e)",
      "Cisco NX-OS(tm) m9148t, Software (m9148-s8ek9-mz), Version 9.3(2)",
      "Cisco SAN-OS(tm) m9200, Software (m9200-ek9-mz), Version 3.3(1c)",
    ])(
      "MDS by its sysDescr, for a model the list does not have: %s",
      (sysDescr: string) => {
        expect(
          SnmpVendorTemplateUtil.matchDevice({
            sysObjectId: "1.3.6.1.4.1.9.12.3.1.3.9999",
            sysDescr: sysDescr,
          })?.id,
        ).toBe("cisco-mds");
      },
    );

    it.each([
      // Nexus shares the chassis arc, and never says m9.
      [
        "1.3.6.1.4.1.9.12.3.1.3.1084",
        "Cisco NX-OS(tm) n9000, Software (n9000-dk9), Version 9.3(8), RELEASE SOFTWARE",
      ],
      [
        "1.3.6.1.4.1.9.12.3.1.3.1409",
        "Cisco NX-OS(tm) n5000, Software (n5000-uk9), Version 7.3(8)N1(1)",
      ],
      ["1.3.6.1.4.1.9.12.3.1.3.612", "Cisco NX-OS(tm) n7000, Software"],
      [
        "1.3.6.1.4.1.9.1.2494",
        "Cisco IOS Software [Bengaluru], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.6.4",
      ],
      [
        "1.3.6.1.4.1.9.1.1208",
        "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E8",
      ],
      // A name that mentions MDS is not an MDS's sysDescr.
      ["1.3.6.1.4.1.9.1.1208", "Cisco IOS Software, for the MDS 9148 lab"],
      ["1.3.6.1.4.1.9.1.1208", "Cisco NX-OS(tm) m91, Software"],
    ])("stays on cisco-ios: %s, %s", (sysObjectId: string, sysDescr: string) => {
      expect(
        SnmpVendorTemplateUtil.matchDevice({
          sysObjectId: sysObjectId,
          sysDescr: sysDescr,
        })?.id,
      ).toBe("cisco-ios");
    });

    it("no Nexus chassis is in the MDS list", () => {
      for (const nexus of [612, 777, 932, 1084, 1147, 1409, 1410]) {
        expect(
          CISCO_MDS_CHASSIS_SYS_OBJECT_IDS.has(
            `1.3.6.1.4.1.9.12.3.1.3.${nexus}`,
          ),
        ).toBe(false);
      }
    });

    it("the MDS list holds chassis OIDs only", () => {
      for (const sysObjectId of CISCO_MDS_CHASSIS_SYS_OBJECT_IDS) {
        expect(sysObjectId.startsWith("1.3.6.1.4.1.9.12.3.1.3.")).toBe(true);
        expect(SnmpOidListUtil.isValidOid(sysObjectId)).toBe(true);
      }
    });

    it("an MDS sysDescr on another maker's arc is not an MDS", () => {
      expect(
        SnmpVendorTemplateUtil.matchDevice({
          sysObjectId: "1.3.6.1.4.1.2636.1.1.1.2.29",
          sysDescr: "Cisco NX-OS(tm) m9100, Software",
        })?.id,
      ).not.toBe("cisco-mds");
    });
  });

  describe("device roles", () => {
    it.each([
      ["1.3.6.1.4.1.1588.2.1.1.1", "Fibre Channel Switch."],
      ["1.3.6.1.4.1.1588.2.1.1.162", undefined],
      ["1.3.6.1.4.1.9.12.3.1.3.1660", undefined],
      [
        "1.3.6.1.4.1.9.12.3.1.3.9999",
        "Cisco NX-OS(tm) m9100, Software (m9100-s6ek9-mz), Version 8.4(2c)",
      ],
    ])(
      "%s is a switch, though its description never says so",
      (sysObjectId: string, sysDescr: string | undefined) => {
        expect(
          classifyDeviceRole({ sysObjectId: sysObjectId, sysDescr: sysDescr }),
        ).toBe("switch");
      },
    );
  });
});
