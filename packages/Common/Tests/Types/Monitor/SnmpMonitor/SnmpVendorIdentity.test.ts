import { describe, expect, test } from "@jest/globals";
import SnmpOidListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import {
  SnmpVendorIdentity,
  SnmpVendorIdentityRead,
  getSnmpVendorIdentity,
  getSnmpVendorIdentityReads,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpVendorIdentity";

/*
 * Where a platform keeps its hardware identity when it is not in ENTITY-MIB
 * (issue #5384).
 *
 * The sysObjectIDs are real devices', as recorded for LibreNMS's test suite.
 * Who is NOT on the list matters as much as who is: an agent asked for an
 * object it does not have may simply not answer, and being listed is what
 * says a device is worth the extra GET. A Meraki device above all.
 */

const FORTIGATE_60F: string = "1.3.6.1.4.1.12356.101.1.644";
const JUNIPER_MX80: string = "1.3.6.1.4.1.2636.1.1.1.2.57";
const MIKROTIK: string = "1.3.6.1.4.1.14988.1";
const SOPHOS_FIREWALL: string = "1.3.6.1.4.1.2604.5";

function identityOf(sysObjectId: string): SnmpVendorIdentity {
  const identity: SnmpVendorIdentity | undefined =
    getSnmpVendorIdentity(sysObjectId);

  expect(identity).toBeDefined();

  return identity!;
}

function fieldsOf(reads: Array<SnmpVendorIdentityRead>): Array<string> {
  return reads.map((read: SnmpVendorIdentityRead): string => {
    return read.field;
  });
}

describe("which devices have a vendor identity to read", () => {
  test.each([
    ["a FortiGate", FORTIGATE_60F, "FortiOS"],
    ["a Juniper router", JUNIPER_MX80, undefined],
    ["a Juniper switch", "1.3.6.1.4.1.2636.1.1.1.4.131.2", undefined],
    ["a MikroTik router", MIKROTIK, "RouterOS"],
    ["a Sophos firewall", SOPHOS_FIREWALL, "Sophos Firewall OS"],
  ])("%s", (_name: string, sysObjectId: string, operatingSystem?: string) => {
    expect(identityOf(sysObjectId).operatingSystem).toBe(operatingSystem);
  });

  test("a leading dot, as some agents and tools spell an OID, changes nothing", () => {
    expect(getSnmpVendorIdentity(`.${FORTIGATE_60F}`)).toBe(
      getSnmpVendorIdentity(FORTIGATE_60F),
    );
  });

  test.each([
    // A Meraki device answers SNMPv2-MIB and IF-MIB; see SnmpVendorIdentity.
    ["a Meraki MX", "1.3.6.1.4.1.29671.2.111"],
    ["a Meraki access point", "1.3.6.1.4.1.29671.2.45"],
    ["a cloud-managed Catalyst", "1.3.6.1.4.1.29671.2.388"],
    // Net-SNMP's arc: a Synology NAS, a Check Point gateway, any Linux host.
    ["a Linux host", "1.3.6.1.4.1.8072.3.2.10"],
    // Fortinet's other product lines keep their identity elsewhere.
    ["a FortiSwitch", "1.3.6.1.4.1.12356.106.1.1"],
    ["a FortiAP", "1.3.6.1.4.1.12356.120.10.1"],
    // A Sophos UTM is another operating system on the same enterprise.
    ["a Sophos UTM", "1.3.6.1.4.1.2604.1.1"],
    ["a Cisco switch", "1.3.6.1.4.1.9.1.1208"],
  ])("not %s", (_name: string, sysObjectId: string) => {
    expect(getSnmpVendorIdentity(sysObjectId)).toBeUndefined();
    expect(
      getSnmpVendorIdentityReads({
        sysObjectId: sysObjectId,
        entityInfo: undefined,
      }),
    ).toEqual([]);
  });

  test("an arc that merely starts with the same digits is another enterprise", () => {
    expect(getSnmpVendorIdentity("1.3.6.1.4.1.26360")).toBeUndefined();
    expect(getSnmpVendorIdentity("1.3.6.1.4.1.149881.1")).toBeUndefined();
    expect(getSnmpVendorIdentity("1.3.6.1.4.1.12356.1012")).toBeUndefined();
  });

  test("no sysObjectID at all", () => {
    expect(getSnmpVendorIdentity(undefined)).toBeUndefined();
    expect(getSnmpVendorIdentity("")).toBeUndefined();
    expect(getSnmpVendorIdentity("   ")).toBeUndefined();
  });
});

describe("what a poll asks for", () => {
  test("a Juniper box answers ENTITY-MIB with nothing, so its serial number", () => {
    expect(
      fieldsOf(
        getSnmpVendorIdentityReads({
          sysObjectId: JUNIPER_MX80,
          entityInfo: undefined,
        }),
      ),
    ).toEqual(["serialNumber"]);
  });

  test("a FortiGate's ENTITY-MIB gives its serial number and model, so only its release", () => {
    const reads: Array<SnmpVendorIdentityRead> = getSnmpVendorIdentityReads({
      sysObjectId: FORTIGATE_60F,
      entityInfo: { serialNumber: "FGT60FTK00000000", model: "FGT_60F" },
    });

    expect(fieldsOf(reads)).toEqual(["firmwareVersion", "softwareVersion"]);
  });

  test("a device ENTITY-MIB told everything costs no request", () => {
    expect(
      getSnmpVendorIdentityReads({
        sysObjectId: SOPHOS_FIREWALL,
        entityInfo: {
          serialNumber: "C01001GF24TPDE1",
          model: "XGS2100",
          firmwareVersion: "21.0.1",
          softwareVersion: "21.0.1",
        },
      }),
    ).toEqual([]);
  });

  test("a blank ENTITY-MIB value is no value", () => {
    expect(
      fieldsOf(
        getSnmpVendorIdentityReads({
          sysObjectId: JUNIPER_MX80,
          entityInfo: { serialNumber: "" },
        }),
      ),
    ).toEqual(["serialNumber"]);
  });
});

describe("every object on the list", () => {
  const identities: Array<SnmpVendorIdentity> = [
    FORTIGATE_60F,
    JUNIPER_MX80,
    MIKROTIK,
    SOPHOS_FIREWALL,
  ].map(identityOf);

  test("is a scalar's instance a GET can ask for", () => {
    for (const identity of identities) {
      expect(identity.reads.length).toBeGreaterThan(0);

      for (const read of identity.reads) {
        expect(SnmpOidListUtil.isValidOid(read.oid)).toBe(true);
        expect(read.oid.endsWith(".0")).toBe(true);
      }
    }
  });

  test("sits under the vendor's enterprise, not under some other one's", () => {
    for (const identity of identities) {
      const enterprise: string = identity.sysObjectIdPrefix
        .split(".")
        .slice(0, 7)
        .join(".");

      for (const read of identity.reads) {
        expect(read.oid.startsWith(`${enterprise}.`)).toBe(true);
      }
    }
  });
});

describe("the OIDs themselves, as each vendor's MIB defines them", () => {
  function oidOf(sysObjectId: string, field: string): string | undefined {
    return identityOf(sysObjectId).reads.find(
      (read: SnmpVendorIdentityRead): boolean => {
        return read.field === field;
      },
    )?.oid;
  }

  test("Fortinet: fnSysSerial and fgSysVersion", () => {
    expect(oidOf(FORTIGATE_60F, "serialNumber")).toBe(
      "1.3.6.1.4.1.12356.100.1.1.1.0",
    );
    expect(oidOf(FORTIGATE_60F, "firmwareVersion")).toBe(
      "1.3.6.1.4.1.12356.101.4.1.1.0",
    );
  });

  test("Juniper: jnxBoxSerialNo", () => {
    expect(oidOf(JUNIPER_MX80, "serialNumber")).toBe(
      "1.3.6.1.4.1.2636.3.1.3.0",
    );
  });

  test("MikroTik: mtxrSerialNumber, mtxrFirmwareVersion, mtxrLicVersion, mtxrBoardName", () => {
    expect(oidOf(MIKROTIK, "serialNumber")).toBe("1.3.6.1.4.1.14988.1.1.7.3.0");
    expect(oidOf(MIKROTIK, "firmwareVersion")).toBe(
      "1.3.6.1.4.1.14988.1.1.7.4.0",
    );
    expect(oidOf(MIKROTIK, "softwareVersion")).toBe(
      "1.3.6.1.4.1.14988.1.1.4.4.0",
    );
    expect(oidOf(MIKROTIK, "model")).toBe("1.3.6.1.4.1.14988.1.1.7.9.0");
  });

  test("Sophos: sfosDeviceAppKey, sfosDeviceType, sfosDeviceFWVersion", () => {
    expect(oidOf(SOPHOS_FIREWALL, "serialNumber")).toBe(
      "1.3.6.1.4.1.2604.5.1.1.4.0",
    );
    expect(oidOf(SOPHOS_FIREWALL, "model")).toBe("1.3.6.1.4.1.2604.5.1.1.2.0");
    expect(oidOf(SOPHOS_FIREWALL, "firmwareVersion")).toBe(
      "1.3.6.1.4.1.2604.5.1.1.3.0",
    );
  });
});

describe("a FortiGate's release, out of what fgSysVersion says", () => {
  function release(text: string): string | undefined {
    const read: SnmpVendorIdentityRead | undefined = identityOf(
      FORTIGATE_60F,
    ).reads.find((item: SnmpVendorIdentityRead): boolean => {
      return item.field === "softwareVersion";
    });

    return read?.read?.(text);
  }

  test.each([
    ["v7.2.6,build1575,230926 (GA.F)", "7.2.6"],
    ["v6.4.8,build1914,211117 (GA)", "6.4.8"],
  ])("%s", (text: string, expected: string) => {
    expect(release(text)).toBe(expected);
  });

  test("anything else says nothing about it, rather than a guess", () => {
    expect(release("")).toBeUndefined();
    expect(release("unknown")).toBeUndefined();
    expect(release("v7")).toBeUndefined();
  });
});
