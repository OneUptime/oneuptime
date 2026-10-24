import { describe, expect, test } from "@jest/globals";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil, {
  MAX_OID_NAME_LENGTH,
} from "../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import SnmpOidNameUtil, {
  SnmpOidDescription,
} from "../../../Utils/NetworkDevice/SnmpOidNameUtil";

/*
 * The names an SNMP walk's results show (issue #5184): the standard MIB
 * objects nearly every agent implements, the vendor templates' values and
 * table columns, and the vendor an enterprise OID belongs to - and the
 * name a walked OID gets when it becomes a health OID.
 */

describe("standard MIB objects", () => {
  test.each([
    ["1.3.6.1.2.1.1.1.0", "sysDescr.0", "SNMPv2-MIB"],
    ["1.3.6.1.2.1.1.3.0", "sysUpTime.0", "SNMPv2-MIB"],
    ["1.3.6.1.2.1.1.5.0", "sysName.0", "SNMPv2-MIB"],
    ["1.3.6.1.2.1.2.1.0", "ifNumber.0", "IF-MIB"],
    ["1.3.6.1.2.1.2.2.1.2.3", "ifDescr.3", "IF-MIB"],
    ["1.3.6.1.2.1.2.2.1.8.10101", "ifOperStatus.10101", "IF-MIB"],
    ["1.3.6.1.2.1.31.1.1.1.6.2", "ifHCInOctets.2", "IF-MIB"],
    ["1.3.6.1.2.1.31.1.1.1.18.2", "ifAlias.2", "IF-MIB"],
    ["1.3.6.1.2.1.4.20.1.1.10.0.0.1", "ipAdEntAddr.10.0.0.1", "IP-MIB"],
    ["1.3.6.1.2.1.6.9.0", "tcpCurrEstab.0", "TCP-MIB"],
    [
      "1.3.6.1.2.1.25.3.3.1.2.196608",
      "hrProcessorLoad.196608",
      "HOST-RESOURCES-MIB",
    ],
    ["1.3.6.1.2.1.25.2.3.1.6.1", "hrStorageUsed.1", "HOST-RESOURCES-MIB"],
    ["1.3.6.1.2.1.47.1.1.1.1.11.1", "entPhysicalSerialNum.1", "ENTITY-MIB"],
    ["1.3.6.1.2.1.99.1.1.1.4.7", "entPhySensorValue.7", "ENTITY-SENSOR-MIB"],
    ["1.0.8802.1.1.2.1.4.1.1.9.0.3.1", "lldpRemSysName.0.3.1", "LLDP-MIB"],
    [
      "1.3.6.1.2.1.17.7.1.2.2.1.2.1.0.26.43.60.77.94",
      "dot1qTpFdbPort.1.0.26.43.60.77.94",
      "Q-BRIDGE-MIB",
    ],
    ["1.3.6.1.4.1.2021.4.6.0", "memAvailReal.0", "UCD-SNMP-MIB"],
    ["1.3.6.1.4.1.2021.10.1.3.1", "laLoad.1", "UCD-SNMP-MIB"],
    ["1.3.6.1.6.3.10.2.1.3.0", "snmpEngineTime.0", "SNMP-FRAMEWORK-MIB"],
  ])("%s is %s (%s)", (oid: string, name: string, module: string) => {
    const description: SnmpOidDescription = SnmpOidNameUtil.describe(oid);

    expect(description.name).toBe(name);
    expect(description.module).toBe(module);
    expect(description.isGroupName).toBeUndefined();
  });

  test("an object's name and instance are told apart", () => {
    expect(SnmpOidNameUtil.describe("1.3.6.1.2.1.2.2.1.2.3")).toMatchObject({
      objectName: "ifDescr",
      instance: "3",
    });
  });

  test("an object asked for by its own OID has no instance", () => {
    expect(SnmpOidNameUtil.describe("1.3.6.1.2.1.1.3")).toMatchObject({
      name: "sysUpTime",
      objectName: "sysUpTime",
      instance: undefined,
    });
  });

  test("a leading dot is the same OID", () => {
    expect(SnmpOidNameUtil.describe(".1.3.6.1.2.1.1.5.0").name).toBe(
      "sysName.0",
    );
  });

  /*
   * Arc by arc, never by text: sysORLastChange (…1.1.8) must not lend its
   * name to an OID under …1.1.80, nor sysDescr (…1.1.1) to …1.1.10.
   */
  test("names are matched arc by arc, never as text", () => {
    expect(SnmpOidNameUtil.describe("1.3.6.1.2.1.1.10.0").name).toBe(
      "system.10.0",
    );
    expect(SnmpOidNameUtil.describe("1.3.6.1.2.1.1.80.0").name).toBe(
      "system.80.0",
    );
  });
});

describe("OIDs no known object covers", () => {
  test("are named after the nearest known group, and say so", () => {
    expect(SnmpOidNameUtil.describe("1.3.6.1.2.1.2.2.1.30.1")).toEqual({
      module: "IF-MIB",
      name: "ifEntry.30.1",
      isGroupName: true,
    });
  });

  test("under enterprises, name the vendor the enterprise number belongs to", () => {
    expect(
      SnmpOidNameUtil.describe("1.3.6.1.4.1.9.9.48.1.1.1.5.1"),
    ).toMatchObject({
      name: "enterprises.9.9.48.1.1.1.5.1",
      isGroupName: true,
      vendorName: "Cisco",
    });
    expect(
      SnmpOidNameUtil.describe("1.3.6.1.4.1.2604.5.1.2.5.2.0").vendorName,
    ).toBe("Sophos");
  });

  test("an enterprise number OneUptime does not know names no vendor", () => {
    expect(
      SnmpOidNameUtil.describe("1.3.6.1.4.1.999999.1.0").vendorName,
    ).toBeUndefined();
  });

  test("an OID outside every known tree is described by nothing", () => {
    expect(SnmpOidNameUtil.describe("2.25.1.2.3")).toEqual({});
  });

  test("what is not an OID is described by nothing", () => {
    expect(SnmpOidNameUtil.describe("ifDescr.3")).toEqual({});
    expect(SnmpOidNameUtil.describe("")).toEqual({});
  });
});

describe("the vendor templates OneUptime ships", () => {
  test("a template's health OID is named as the template names it", () => {
    expect(
      SnmpOidNameUtil.describe("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1"),
    ).toMatchObject({
      templateValueName: "CPU 5-min %",
      templateLabel: "Cisco IOS / IOS-XE",
      vendorName: "Cisco",
    });
  });

  test("a standard object a template collects keeps both names", () => {
    const description: SnmpOidDescription = SnmpOidNameUtil.describe(
      "1.3.6.1.4.1.2021.4.6.0",
    );

    expect(description.name).toBe("memAvailReal.0");
    expect(description.templateValueName).toBeDefined();
  });

  test("a cell of a template's SNMP table is named by its table and column", () => {
    const sophos: SnmpVendorTemplate | undefined =
      SnmpVendorTemplateUtil.getById("sophos-sfos");
    const tunnelStatus: string | undefined = sophos?.tables?.[0]?.columns.find(
      (column: { name: string }) => {
        return column.name === "Status";
      },
    )?.oid;

    expect(tunnelStatus).toBeDefined();

    const description: SnmpOidDescription = SnmpOidNameUtil.describe(
      `${tunnelStatus!}.4`,
    );

    expect(description.templateTableName).toBe(sophos!.tables![0]!.name);
    expect(description.templateColumnName).toBe("Status");
    expect(description.templateLabel).toBe(sophos!.label);
  });

  test("a column's own OID is not one of its cells", () => {
    const sophos: SnmpVendorTemplate | undefined =
      SnmpVendorTemplateUtil.getById("sophos-sfos");
    const column: string = sophos!.tables![0]!.columns[0]!.oid;

    expect(SnmpOidNameUtil.describe(column).templateColumnName).toBeUndefined();
  });

  test("every health OID of every template has a name the walk can show", () => {
    for (const template of SnmpVendorTemplateUtil.getAll()) {
      for (const oid of template.oids) {
        if (!oid.name) {
          continue;
        }

        expect(
          SnmpOidNameUtil.describe(oid.oid).templateValueName,
        ).toBeDefined();
      }
    }
  });
});

describe("the name a walked OID gets as a health OID", () => {
  test("is the template's name for it when a template names it", () => {
    expect(
      SnmpOidNameUtil.toHealthOid("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1"),
    ).toEqual({ oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", name: "CPU 5-min %" });
  });

  test("is its MIB name with its instance otherwise", () => {
    expect(
      SnmpOidNameUtil.toHealthOid("1.3.6.1.2.1.25.3.3.1.2.196608"),
    ).toEqual({
      oid: "1.3.6.1.2.1.25.3.3.1.2.196608",
      name: "hrProcessorLoad.196608",
    });
  });

  test("is no name for an OID only a group covers: the OID says as much", () => {
    expect(SnmpOidNameUtil.toHealthOid("1.3.6.1.4.1.9.9.999.1.0")).toEqual({
      oid: "1.3.6.1.4.1.9.9.999.1.0",
    });
  });

  test("keeps the OID as a health OID stores it, leading dot dropped", () => {
    const healthOid: SnmpOid =
      SnmpOidNameUtil.toHealthOid(".1.3.6.1.2.1.1.5.0");

    expect(healthOid).toEqual({ oid: "1.3.6.1.2.1.1.5.0", name: "sysName.0" });
    expect(SnmpOidListUtil.isValidOid(healthOid.oid)).toBe(true);
  });

  test("is never longer than a health OID's name may be", () => {
    const longIndex: string = Array.from({ length: 60 }, () => {
      return "255";
    }).join(".");
    const name: string | undefined = SnmpOidNameUtil.suggestedHealthOidName(
      `1.3.6.1.2.1.2.2.1.2.${longIndex}`,
    );

    expect(name).toBeDefined();
    expect(name!.length).toBeLessThanOrEqual(MAX_OID_NAME_LENGTH);
  });
});
