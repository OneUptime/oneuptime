import SnmpEntityInfo from "./SnmpEntityInfo";
import SnmpOidListUtil from "./SnmpOidListUtil";

/*
 * Where a platform keeps its hardware identity when it is not in ENTITY-MIB
 * (OneUptime issue #5384).
 *
 * ENTITY-MIB is the standard place for a device's serial number, firmware and
 * software release, and the poll has only ever read that. A Juniper box does
 * not implement it at all: every one of them read Unknown for its serial
 * number, although jnxBoxSerialNo holds it. A FortiGate has a serial number in
 * ENTITY-MIB and a firmware release only in its own MIB, and sends a blank
 * sysDescr, so nothing named its operating system either.
 *
 * WHEN IT IS READ. Once a poll, in one GET, only for a device the sysObjectID
 * says is one of these platforms, and only for what ENTITY-MIB left empty - a
 * device with nothing to fill costs nothing. Being listed here is what makes
 * the GET safe, and it is why this is a list and not a guess at every vendor
 * OID there is: an agent asked for an object it does not have may simply not
 * answer ("When polled for some unsupported OIDs, the MS/MR fails to respond",
 * Meraki's SNMP guide), and the walk would wait out a timeout on every poll.
 *
 * A Cisco Meraki device is deliberately not here. Polled directly it answers
 * SNMPv2-MIB and IF-MIB; its serial number sits in
 * MERAKI-CLOUD-CONTROLLER-MIB, which only the dashboard answers. The Meraki
 * dashboard connection reads that (NetworkControllerInventory).
 *
 * Everything below was checked against the vendor's MIB and against what a
 * real device of the platform sends. A device whose sysObjectID is not the
 * platform's is not read: a Synology NAS and a Check Point gateway answer with
 * Net-SNMP's arc, which every Linux host shares.
 *
 * What these read is written where ENTITY-MIB's values are, so it is the
 * device's own poll speaking, and every reader of those columns sees it. Pure,
 * so the facts and the probe read the same list.
 */

export type SnmpVendorIdentityField = keyof Pick<
  SnmpEntityInfo,
  "model" | "serialNumber" | "firmwareVersion" | "softwareVersion"
>;

export interface SnmpVendorIdentityRead {
  field: SnmpVendorIdentityField;
  // The scalar's instance, with its ".0".
  oid: string;
  /*
   * What the object's text says about this field, when it is not the whole
   * text. Undefined for an answer that says nothing about it.
   */
  read?: ((text: string) => string | undefined) | undefined;
}

export interface SnmpVendorIdentity {
  // The arc a device's sysObjectID must equal or sit under.
  sysObjectIdPrefix: string;
  /*
   * The operating system every device of the platform runs, for a platform
   * whose sysDescr does not name it: a FortiGate's is blank, and a Sophos
   * firewall's calls it Linux.
   */
  operatingSystem?: string | undefined;
  reads: ReadonlyArray<SnmpVendorIdentityRead>;
}

// "v7.2.6,build1575,230926 (GA.F)": the release is the part a CMDB compares.
const FORTIOS_RELEASE: RegExp = /^v?(\d{1,4}\.\d{1,4}\.\d{1,4})\b/;

function readFortiOsRelease(text: string): string | undefined {
  return FORTIOS_RELEASE.exec(text)?.[1];
}

const FORTIGATE: SnmpVendorIdentity = {
  sysObjectIdPrefix: "1.3.6.1.4.1.12356.101",
  operatingSystem: "FortiOS",
  reads: [
    // FORTINET-CORE-MIB fnSysSerial.
    { field: "serialNumber", oid: "1.3.6.1.4.1.12356.100.1.1.1.0" },
    // FORTINET-FORTIGATE-MIB fgSysVersion.
    { field: "firmwareVersion", oid: "1.3.6.1.4.1.12356.101.4.1.1.0" },
    {
      field: "softwareVersion",
      oid: "1.3.6.1.4.1.12356.101.4.1.1.0",
      read: readFortiOsRelease,
    },
  ],
};

const JUNIPER: SnmpVendorIdentity = {
  sysObjectIdPrefix: "1.3.6.1.4.1.2636",
  reads: [
    // JUNIPER-MIB jnxBoxSerialNo. Its sysDescr names the model and the release.
    { field: "serialNumber", oid: "1.3.6.1.4.1.2636.3.1.3.0" },
  ],
};

const MIKROTIK: SnmpVendorIdentity = {
  sysObjectIdPrefix: "1.3.6.1.4.1.14988",
  operatingSystem: "RouterOS",
  reads: [
    // MIKROTIK-MIB mtxrSerialNumber. A Cloud Hosted Router has none.
    { field: "serialNumber", oid: "1.3.6.1.4.1.14988.1.1.7.3.0" },
    // mtxrFirmwareVersion: the board's RouterBOOT, not RouterOS.
    { field: "firmwareVersion", oid: "1.3.6.1.4.1.14988.1.1.7.4.0" },
    // mtxrLicVersion: the RouterOS release.
    { field: "softwareVersion", oid: "1.3.6.1.4.1.14988.1.1.4.4.0" },
    // mtxrBoardName, for a sysDescr someone replaced with their own text.
    { field: "model", oid: "1.3.6.1.4.1.14988.1.1.7.9.0" },
  ],
};

const SOPHOS_FIREWALL: SnmpVendorIdentity = {
  sysObjectIdPrefix: "1.3.6.1.4.1.2604.5",
  operatingSystem: "Sophos Firewall OS",
  reads: [
    // SFOS-FIREWALL-MIB sfosDeviceAppKey: the key the box is registered under.
    { field: "serialNumber", oid: "1.3.6.1.4.1.2604.5.1.1.4.0" },
    // sfosDeviceType.
    { field: "model", oid: "1.3.6.1.4.1.2604.5.1.1.2.0" },
    // sfosDeviceFWVersion: "18.0.1 MR-1-Build396". The firmware is the OS.
    { field: "firmwareVersion", oid: "1.3.6.1.4.1.2604.5.1.1.3.0" },
    { field: "softwareVersion", oid: "1.3.6.1.4.1.2604.5.1.1.3.0" },
  ],
};

const VENDOR_IDENTITIES: ReadonlyArray<SnmpVendorIdentity> = [
  FORTIGATE,
  JUNIPER,
  MIKROTIK,
  SOPHOS_FIREWALL,
];

/**
 * The platform a device's sysObjectID says it is, or undefined for every
 * other device.
 */
export function getSnmpVendorIdentity(
  sysObjectId: string | undefined,
): SnmpVendorIdentity | undefined {
  const normalized: string = SnmpOidListUtil.normalizeOid(sysObjectId);

  if (!normalized) {
    return undefined;
  }

  return VENDOR_IDENTITIES.find((identity: SnmpVendorIdentity): boolean => {
    return (
      normalized === identity.sysObjectIdPrefix ||
      normalized.startsWith(`${identity.sysObjectIdPrefix}.`)
    );
  });
}

/**
 * What a poll still has to ask a device for: the platform's reads for every
 * field `entityInfo` left empty. Empty for a device that is not one of these
 * platforms, and for one ENTITY-MIB already told everything.
 */
export function getSnmpVendorIdentityReads(data: {
  sysObjectId: string | undefined;
  entityInfo: SnmpEntityInfo | undefined;
}): Array<SnmpVendorIdentityRead> {
  const identity: SnmpVendorIdentity | undefined = getSnmpVendorIdentity(
    data.sysObjectId,
  );

  return (identity?.reads || []).filter(
    (read: SnmpVendorIdentityRead): boolean => {
      return !data.entityInfo?.[read.field];
    },
  );
}
