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
    {
      /*
       * First row of ciscoEnvMonFanStatusTable. State is an enum, not a
       * gauge — criteria should alert when the value is anything but 1.
       */
      oid: "1.3.6.1.4.1.9.9.13.1.4.1.3.1",
      name: "Fan State",
      description: "ciscoEnvMonFanState — first fan; 1 = normal.",
    },
    {
      // First row of ciscoEnvMonSupplyStatusTable — same enum as fan state.
      oid: "1.3.6.1.4.1.9.9.13.1.5.1.3.1",
      name: "PSU State",
      description: "ciscoEnvMonSupplyState — first power supply; 1 = normal.",
    },
  ],
};

const JUNIPER: SnmpVendorTemplate = {
  id: "juniper-junos",
  label: "Juniper Junos",
  description:
    "Routing Engine CPU, memory buffer, and temperature from the Juniper jnxOperatingTable (Junos routers, switches, and firewalls).",
  oids: [
    {
      /*
       * jnxOperatingTable rows are indexed by chassis position; 9.1.0.0 is
       * the documented first Routing Engine (RE0) row on most Junos
       * platforms. Adjust the index for multi-RE chassis.
       */
      oid: "1.3.6.1.4.1.2636.3.1.13.1.8.9.1.0.0",
      name: "CPU %",
      description: "jnxOperatingCPU — Routing Engine CPU utilization.",
    },
    {
      oid: "1.3.6.1.4.1.2636.3.1.13.1.11.9.1.0.0",
      name: "Memory Buffer %",
      description: "jnxOperatingBuffer — Routing Engine memory utilization.",
    },
    {
      oid: "1.3.6.1.4.1.2636.3.1.13.1.7.9.1.0.0",
      name: "Temperature (C)",
      description: "jnxOperatingTemp — Routing Engine temperature.",
    },
  ],
};

const ARISTA: SnmpVendorTemplate = {
  id: "arista-eos",
  label: "Arista EOS",
  description:
    "CPU load, load average, and memory via the standard Host Resources and UCD MIBs — Arista EOS exposes these rather than a vendor-specific CPU/memory MIB.",
  oids: [
    {
      oid: "1.3.6.1.2.1.25.3.3.1.2.1",
      name: "CPU Load %",
      description: "hrProcessorLoad — first processor.",
    },
    {
      oid: "1.3.6.1.4.1.2021.10.1.3.1",
      name: "Load Average (1 min)",
      description: "laLoad.1 — UCD-SNMP-MIB.",
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

const HPE_PROCURVE: SnmpVendorTemplate = {
  id: "hpe-procurve",
  label: "HPE / Aruba ProCurve",
  description:
    "CPU and global memory from the HP switch STATISTICS and NETSWITCH MIBs on ProCurve / ArubaOS-Switch devices.",
  oids: [
    {
      oid: "1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0",
      name: "CPU %",
      description: "hpSwitchCpuStat — CPU utilization.",
    },
    {
      // hpGlobalMemTable rows are per memory slot; index 1 is the first slot.
      oid: "1.3.6.1.4.1.11.2.14.11.5.1.1.2.2.1.1.5.1",
      name: "Memory Total (bytes)",
      description: "hpGlobalMemTotalBytes — first memory slot.",
    },
    {
      oid: "1.3.6.1.4.1.11.2.14.11.5.1.1.2.2.1.1.6.1",
      name: "Memory Free (bytes)",
      description: "hpGlobalMemFreeBytes — first memory slot.",
    },
  ],
};

const FORTINET: SnmpVendorTemplate = {
  id: "fortinet-fortigate",
  label: "Fortinet FortiGate",
  description:
    "System CPU, memory, and disk utilization percentages from the FORTINET-FORTIGATE-MIB fgSystemInfo scalars.",
  oids: [
    {
      oid: "1.3.6.1.4.1.12356.101.4.1.3.0",
      name: "CPU %",
      description: "fgSysCpuUsage — overall CPU utilization.",
    },
    {
      oid: "1.3.6.1.4.1.12356.101.4.1.4.0",
      name: "Memory %",
      description: "fgSysMemUsage — memory utilization.",
    },
    {
      oid: "1.3.6.1.4.1.12356.101.4.1.6.0",
      name: "Disk %",
      description: "fgSysDiskUsage — disk utilization.",
    },
  ],
};

const PALO_ALTO: SnmpVendorTemplate = {
  id: "paloalto-panos",
  label: "Palo Alto PAN-OS",
  description:
    "Management-plane CPU via the standard HOST-RESOURCES-MIB — Palo Alto's documented monitoring practice, PAN-OS has no vendor CPU OID — plus session load from PAN-COMMON-MIB.",
  oids: [
    {
      /*
       * PAN-OS exposes CPU only through hrProcessorLoad; index 1 is the
       * management plane on the platforms Palo Alto documents.
       */
      oid: "1.3.6.1.2.1.25.3.3.1.2.1",
      name: "Mgmt CPU %",
      description: "hrProcessorLoad — management-plane CPU.",
    },
    {
      oid: "1.3.6.1.4.1.25461.2.1.2.3.1.0",
      name: "Session Utilization %",
      description: "panSessionUtilization — session table utilization.",
    },
    {
      oid: "1.3.6.1.4.1.25461.2.1.2.3.3.0",
      name: "Active Sessions",
      description: "panSessionActive — total active sessions.",
    },
  ],
};

const HUAWEI: SnmpVendorTemplate = {
  id: "huawei-vrp",
  label: "Huawei VRP",
  description:
    "Mainboard CPU, memory, and temperature from the HUAWEI-ENTITY-EXTENT-MIB hwEntityStateTable.",
  oids: [
    {
      /*
       * hwEntityStateTable is indexed by ENTITY-MIB entPhysicalIndex;
       * 67108867 is the conventional mainboard index on most VRP devices —
       * walk the table and adjust if the device numbers entities differently.
       */
      oid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.67108867",
      name: "CPU %",
      description: "hwEntityCpuUsage — mainboard CPU utilization.",
    },
    {
      oid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.67108867",
      name: "Memory %",
      description: "hwEntityMemUsage — mainboard memory utilization.",
    },
    {
      oid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.11.67108867",
      name: "Temperature (C)",
      description: "hwEntityTemperature — mainboard temperature.",
    },
  ],
};

const DELL_FORCE10: SnmpVendorTemplate = {
  id: "dell-force10",
  label: "Dell Force10 / OS9",
  description:
    "Stack-unit CPU and memory utilization from the Dell Force10 S-series chassis MIB.",
  oids: [
    {
      // chStackUnitUtilTable first stack unit (index 1).
      oid: "1.3.6.1.4.1.6027.3.10.1.2.9.1.2.1",
      name: "CPU 5-sec %",
      description: "chStackUnitCpuUtil5Sec — first stack unit.",
    },
    {
      oid: "1.3.6.1.4.1.6027.3.10.1.2.9.1.5.1",
      name: "Memory %",
      description: "chStackUnitMemUsageUtil — first stack unit.",
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
  label: "Ubiquiti EdgeOS / EdgeSwitch / UniFi",
  description:
    "CPU load and memory usage via the standard Host Resources and UCD MIBs — Ubiquiti publishes no vendor health MIB, but EdgeOS, EdgeSwitch, and UniFi devices answer these.",
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

// Generic first (the safe default), then vendors alphabetically.
export const SnmpVendorTemplates: Array<SnmpVendorTemplate> = [
  HOST_RESOURCES,
  ARISTA,
  CISCO,
  DELL_FORCE10,
  FORTINET,
  HPE_PROCURVE,
  HUAWEI,
  JUNIPER,
  MIKROTIK,
  PALO_ALTO,
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
  // Ubiquiti EdgeSwitch firmware (Broadcom FASTPATH based) reports this arc.
  4413: "Broadcom",
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

/*
 * sysObjectID template routing: enterprise number → vendor template id.
 * Name-only vendors (e.g. Dell 674, F5 3375) deliberately have no entry —
 * their platforms need MIBs we do not ship a template for yet, and callers
 * fall back to the generic Host Resources template.
 */
const ENTERPRISE_TEMPLATE_IDS: Record<number, string> = {
  9: "cisco-ios",
  11: "hpe-procurve",
  2011: "huawei-vrp",
  2636: "juniper-junos",
  /*
   * Ubiquiti EdgeSwitch firmware reports Broadcom's FASTPATH arc (4413)
   * rather than Ubiquiti's own 41112. The template only contains standard
   * Host Resources / UCD OIDs, so routing the whole arc there is safe for
   * other FASTPATH-based switches too.
   */
  4413: "ubiquiti-edgeos",
  6027: "dell-force10",
  12356: "fortinet-fortigate",
  14988: "mikrotik-routeros",
  25461: "paloalto-panos",
  30065: "arista-eos",
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
