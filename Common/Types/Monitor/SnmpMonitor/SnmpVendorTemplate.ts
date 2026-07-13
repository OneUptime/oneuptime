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
    "CPU load, CPU temperature, and voltage from the MikroTik health MIB, plus standard Host Resources CPU.",
  oids: [
    {
      oid: "1.3.6.1.2.1.25.3.3.1.2.1",
      name: "CPU Load %",
      description: "hrProcessorLoad — first processor.",
    },
    {
      oid: "1.3.6.1.4.1.14988.1.1.3.10.0",
      name: "CPU Temperature (C)",
      description: "mtxrHlProcessorTemperature.",
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
