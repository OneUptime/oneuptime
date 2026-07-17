import SnmpOid from "./SnmpOid";

/*
 * Prebuilt SNMP health-OID profiles for common network vendors. Applying a
 * template appends its OIDs (CPU, memory, temperature) to a Network Device
 * monitor so those values are collected and alertable without the user
 * having to look up MIBs. OIDs are the ".0" / indexed scalar instances that
 * these platforms actually expose; users can prune or extend the list after
 * applying.
 */
export interface SnmpVendorTemplate {
  id: string;
  label: string;
  description: string;
  oids: Array<SnmpOid>;
}

const CISCO: SnmpVendorTemplate = {
  id: "cisco-ios",
  label: "Cisco IOS / IOS-XE",
  description:
    "CPU (5-min average), memory pool used/free, and chassis temperature for Cisco IOS and IOS-XE devices.",
  oids: [
    {
      oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
      name: "CPU 5-min %",
      description: "cpmCPUTotal5minRev — 5-minute CPU utilization.",
    },
    {
      oid: "1.3.6.1.4.1.9.9.48.1.1.1.5.1",
      name: "Memory Used (bytes)",
      description: "ciscoMemoryPoolUsed — processor pool bytes in use.",
    },
    {
      oid: "1.3.6.1.4.1.9.9.48.1.1.1.6.1",
      name: "Memory Free (bytes)",
      description: "ciscoMemoryPoolFree — processor pool bytes free.",
    },
    {
      oid: "1.3.6.1.4.1.9.9.13.1.3.1.3.1",
      name: "Temperature (C)",
      description: "ciscoEnvMonTemperatureValue — first temperature sensor.",
    },
  ],
};

const MIKROTIK: SnmpVendorTemplate = {
  id: "mikrotik-routeros",
  label: "MikroTik RouterOS",
  description:
    "CPU load, board temperature, and voltage from the MikroTik health MIB, plus standard Host Resources CPU.",
  oids: [
    {
      oid: "1.3.6.1.2.1.25.3.3.1.2.1",
      name: "CPU Load %",
      description: "hrProcessorLoad — first processor.",
    },
    {
      // .10.0 is mtxrHlTemperature (board temp); processor temp is .11.0.
      oid: "1.3.6.1.4.1.14988.1.1.3.10.0",
      name: "Temperature (C)",
      description: "mtxrHlTemperature — system/board temperature.",
    },
    {
      oid: "1.3.6.1.4.1.14988.1.1.3.8.0",
      name: "Voltage (dV)",
      description: "mtxrHlVoltage — decivolts.",
    },
  ],
};

const UBIQUITI: SnmpVendorTemplate = {
  id: "ubiquiti-edgeos",
  label: "Ubiquiti EdgeOS / UniFi",
  description:
    "CPU load and memory usage via the standard Host Resources MIB, which Ubiquiti EdgeOS and UniFi expose.",
  oids: [
    {
      oid: "1.3.6.1.2.1.25.3.3.1.2.1",
      name: "CPU Load %",
      description: "hrProcessorLoad — first processor.",
    },
    {
      oid: "1.3.6.1.4.1.2021.4.5.0",
      name: "Total RAM (KB)",
      description: "memTotalReal — UCD-SNMP-MIB.",
    },
    {
      oid: "1.3.6.1.4.1.2021.4.6.0",
      name: "Available RAM (KB)",
      description: "memAvailReal — UCD-SNMP-MIB.",
    },
  ],
};

const HOST_RESOURCES: SnmpVendorTemplate = {
  id: "host-resources-mib",
  label: "Generic (Host Resources MIB)",
  description:
    "Vendor-neutral CPU load and memory from HOST-RESOURCES-MIB — works on most Linux/BSD-based network appliances (pfSense, OPNsense, and many others).",
  oids: [
    {
      oid: "1.3.6.1.2.1.25.3.3.1.2.1",
      name: "CPU Load %",
      description: "hrProcessorLoad — first processor.",
    },
    {
      oid: "1.3.6.1.4.1.2021.4.5.0",
      name: "Total RAM (KB)",
      description: "memTotalReal — UCD-SNMP-MIB.",
    },
    {
      oid: "1.3.6.1.4.1.2021.4.6.0",
      name: "Available RAM (KB)",
      description: "memAvailReal — UCD-SNMP-MIB.",
    },
    {
      oid: "1.3.6.1.4.1.2021.10.1.3.1",
      name: "Load Average (1 min)",
      description: "laLoad.1 — UCD-SNMP-MIB.",
    },
  ],
};

export const SnmpVendorTemplates: Array<SnmpVendorTemplate> = [
  HOST_RESOURCES,
  CISCO,
  MIKROTIK,
  UBIQUITI,
];

/*
 * IANA private-enterprise numbers → vendor display names, for the vendors
 * that actually show up on monitored networks. Used to derive a vendor from
 * sysObjectID (1.3.6.1.4.1.<enterprise>...) when the device does not
 * implement ENTITY-MIB. Not exhaustive by design — unknown enterprises just
 * leave the vendor blank.
 */
const ENTERPRISE_VENDOR_NAMES: Record<number, string> = {
  9: "Cisco",
  11: "HPE",
  43: "3Com",
  171: "D-Link",
  207: "Allied Telesis",
  674: "Dell",
  1588: "Brocade",
  1916: "Extreme Networks",
  2011: "Huawei",
  2021: "Net-SNMP",
  2636: "Juniper",
  3224: "NetScreen",
  3375: "F5",
  4526: "Netgear",
  6027: "Force10",
  6486: "Alcatel-Lucent",
  6574: "Synology",
  8072: "Net-SNMP",
  9303: "PacketFront",
  10002: "Frogfoot",
  11863: "TP-Link",
  12325: "pfSense",
  12356: "Fortinet",
  14823: "Aruba",
  14988: "MikroTik",
  17163: "Riverbed",
  22610: "Vyatta",
  24681: "QNAP",
  25461: "Palo Alto Networks",
  25506: "H3C",
  26543: "Yamaha",
  30065: "Arista",
  35098: "PICA8",
  41112: "Ubiquiti",
  47196: "OPNsense",
};

// sysObjectID template routing: enterprise number → vendor template id.
const ENTERPRISE_TEMPLATE_IDS: Record<number, string> = {
  9: "cisco-ios",
  14988: "mikrotik-routeros",
  41112: "ubiquiti-edgeos",
};

export default class SnmpVendorTemplateUtil {
  public static getAll(): Array<SnmpVendorTemplate> {
    return SnmpVendorTemplates;
  }

  public static getById(id: string): SnmpVendorTemplate | undefined {
    return SnmpVendorTemplates.find((template: SnmpVendorTemplate) => {
      return template.id === id;
    });
  }

  /*
   * Extracts the IANA private-enterprise number from a sysObjectID value
   * ("1.3.6.1.4.1.<enterprise>...", with or without a leading dot). Returns
   * undefined for OIDs outside the enterprises arc (e.g. the mib-2 values
   * some appliances report).
   */
  public static getEnterpriseNumber(
    sysObjectId: string | undefined,
  ): number | undefined {
    if (!sysObjectId) {
      return undefined;
    }

    const normalized: string = sysObjectId.trim().replace(/^\./, "");
    const enterprisesPrefix: string = "1.3.6.1.4.1.";

    if (!normalized.startsWith(enterprisesPrefix)) {
      return undefined;
    }

    const enterprisePart: string | undefined = normalized
      .substring(enterprisesPrefix.length)
      .split(".")[0];

    const enterpriseNumber: number = parseInt(enterprisePart || "", 10);
    return isNaN(enterpriseNumber) ? undefined : enterpriseNumber;
  }

  public static getVendorNameBySysObjectId(
    sysObjectId: string | undefined,
  ): string | undefined {
    const enterpriseNumber: number | undefined =
      SnmpVendorTemplateUtil.getEnterpriseNumber(sysObjectId);

    if (enterpriseNumber === undefined) {
      return undefined;
    }

    return ENTERPRISE_VENDOR_NAMES[enterpriseNumber];
  }

  /*
   * Suggests the vendor OID template matching a device's sysObjectID.
   * Returns undefined when no vendor-specific template exists — callers can
   * fall back to the generic Host Resources template, which most
   * Linux-based appliances answer.
   */
  public static matchBySysObjectId(
    sysObjectId: string | undefined,
  ): SnmpVendorTemplate | undefined {
    const enterpriseNumber: number | undefined =
      SnmpVendorTemplateUtil.getEnterpriseNumber(sysObjectId);

    if (enterpriseNumber === undefined) {
      return undefined;
    }

    const templateId: string | undefined =
      ENTERPRISE_TEMPLATE_IDS[enterpriseNumber];

    return templateId ? SnmpVendorTemplateUtil.getById(templateId) : undefined;
  }

  /*
   * Merges a template's OIDs into an existing list, skipping any OID already
   * present so applying a template twice (or applying two overlapping ones)
   * never duplicates rows.
   */
  public static mergeOids(
    existing: Array<SnmpOid>,
    templateId: string,
  ): Array<SnmpOid> {
    const template: SnmpVendorTemplate | undefined =
      SnmpVendorTemplateUtil.getById(templateId);

    if (!template) {
      return existing;
    }

    const seen: Set<string> = new Set(
      existing.map((oid: SnmpOid) => {
        return oid.oid;
      }),
    );

    const merged: Array<SnmpOid> = [...existing];
    for (const oid of template.oids) {
      if (!seen.has(oid.oid)) {
        merged.push(oid);
        seen.add(oid.oid);
      }
    }
    return merged;
  }
}
