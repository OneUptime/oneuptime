import SnmpOid from "./SnmpOid";
import SnmpOidListUtil from "./SnmpOidListUtil";
import {
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableValueType,
} from "./SnmpTable";
import { MAX_SNMP_TABLE_MAX_ROWS } from "./SnmpTableListUtil";

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
  /*
   * SNMP tables the platform exposes - IPsec tunnels, radios, fans, power
   * supplies, routing neighbours - walked whole on every poll, so a row that
   * appears, moves or disappears is followed rather than pinned by index.
   */
  tables?: Array<SnmpTableDefinition> | undefined;
}

/*
 * hrProcessorLoad as a table, one row per core. Several platforms (Sophos
 * SFOS among them) number their processors from 196608 rather than 1, so
 * the scalar "hrProcessorLoad.1" the older templates pin returns nothing
 * there; walking the column works whatever the numbering.
 */
const HOST_RESOURCES_CPU_TABLE: SnmpTableDefinition = {
  key: "cpu_cores",
  name: "CPU Cores",
  description: "hrProcessorLoad - one row per processor core.",
  kind: SnmpTableKind.Hardware,
  columns: [
    {
      oid: "1.3.6.1.2.1.25.3.3.1.2",
      name: "Load",
      unit: "%",
      description: "hrProcessorLoad - average load over the last minute.",
    },
  ],
  maxRows: 128,
};

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

/*
 * ENTITY-MIB's entPhysicalName, read by each FRU row's own index
 * (rowLabelsByIndex): the name the switch gives a power supply, a fan tray
 * or a module ("PowerSupply-1", "Fan Module-2"). A director has a thousand
 * entities, of which these tables need a handful.
 */
const ENTITY_PHYSICAL_NAME_OID: string = "1.3.6.1.2.1.47.1.1.1.1.7";

/*
 * Brocade Fabric OS SAN switches and directors (SW-MIB under
 * 1.3.6.1.4.1.1588.2.1.1.1, HA-MIB under 1.3.6.1.4.1.1588.2.1.2 and the
 * Fibre Alliance FCMGMT-MIB under 1.3.6.1.3.94). Checked against SW-MIB,
 * HA-MIB and FCMGMT-MIB as Fabric OS ships them, and against recorded
 * walks of real switches.
 *
 * Each port's Fibre Channel errors and its optics are not here: they are
 * read with the interfaces (FibreChannelPortWalker, TransceiverWalker), so
 * they land on the port's row of the Interfaces page and its Transceivers
 * card, whether or not this template is applied.
 *
 * The FCMGMT-MIB parts (switch status, and the port statistics and optics
 * read with the interfaces) answer only once the FA-MIB is turned on with
 * `snmpconfig --set mibCapability`.
 */
const BROCADE_FOS: SnmpVendorTemplate = {
  id: "brocade-fos",
  label: "Brocade Fabric OS (SAN switches)",
  description:
    "Switch status, firmware, CPU and memory, every sensor and field-replaceable unit, and the switch's overall health from SW-MIB, HA-MIB and FCMGMT-MIB. Port errors and optics come with the interfaces.",
  oids: [
    {
      oid: "1.3.6.1.4.1.1588.2.1.1.1.1.7.0",
      name: "Switch State",
      description: "swOperStatus - 1 online, 2 offline, 3 testing, 4 faulty.",
    },
    {
      oid: "1.3.6.1.4.1.1588.2.1.1.1.1.6.0",
      name: "Firmware Version",
      description: "swFirmwareVersion - the Fabric OS version running.",
    },
    {
      oid: "1.3.6.1.4.1.1588.2.1.1.1.26.1.0",
      name: "CPU %",
      description: "swCpuUsage - CPU utilization.",
    },
    {
      oid: "1.3.6.1.4.1.1588.2.1.1.1.26.6.0",
      name: "Memory %",
      description: "swMemUsage - memory utilization.",
    },
  ],
  tables: [
    {
      key: "switch_status",
      name: "Switch Status",
      description:
        "connUnitTable (FCMGMT-MIB): the switch's own overall status. Needs the FA-MIB turned on.",
      kind: SnmpTableKind.Hardware,
      rowLabelColumnOids: ["1.3.6.1.3.94.1.6.1.20"],
      columns: [
        {
          oid: "1.3.6.1.3.94.1.6.1.6",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "1": "unknown",
            "2": "unused",
            "3": "ok",
            "4": "warning",
            "5": "failed",
          },
          healthyValues: ["3"],
        },
      ],
      maxRows: 8,
    },
    {
      key: "sensors",
      name: "Sensors",
      description:
        "swSensorTable: temperature, fan and power supply sensors. A sensor whose slot is empty reads absent.",
      kind: SnmpTableKind.Hardware,
      rowLabelColumnOids: ["1.3.6.1.4.1.1588.2.1.1.1.1.22.1.5"],
      columns: [
        {
          oid: "1.3.6.1.4.1.1588.2.1.1.1.1.22.1.2",
          name: "Type",
          valueLabels: { "1": "temperature", "2": "fan", "3": "power supply" },
        },
        {
          oid: "1.3.6.1.4.1.1588.2.1.1.1.1.22.1.3",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "1": "unknown",
            "2": "faulty",
            "3": "below minimum",
            "4": "nominal",
            "5": "above maximum",
            "6": "absent",
          },
          healthyValues: ["4", "6"],
        },
        {
          oid: "1.3.6.1.4.1.1588.2.1.1.1.1.22.1.4",
          name: "Value",
          description:
            "Degrees C for a temperature sensor, RPM for a fan; a power supply reads 1 when it is on.",
          noReadingValues: ["-2147483648"],
        },
      ],
      maxRows: 64,
    },
    {
      key: "frus",
      name: "Field-Replaceable Units",
      description:
        "fruTable (HA-MIB): blades, power supplies, fans and WWN cards, named by the switch's entity names.",
      kind: SnmpTableKind.Hardware,
      rowLabelColumnOids: [ENTITY_PHYSICAL_NAME_OID],
      rowLabelsByIndex: true,
      columns: [
        {
          oid: "1.3.6.1.4.1.1588.2.1.2.1.5.1.1",
          name: "Type",
          valueLabels: {
            "1": "other",
            "2": "unknown",
            "3": "chassis",
            "4": "control processor",
            "5": "other control processor",
            "6": "switch blade",
            "7": "WWN card",
            "8": "power supply",
            "9": "fan",
            "10": "core blade",
            "11": "application blade",
          },
        },
        {
          oid: "1.3.6.1.4.1.1588.2.1.2.1.5.1.2",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "1": "other",
            "2": "unknown",
            "3": "on",
            "4": "off",
            "5": "faulty",
          },
          healthyValues: ["3"],
        },
      ],
      maxRows: 64,
    },
  ],
};

/*
 * Cisco MDS 9000 SAN switches and directors (NX-OS). Its own template
 * rather than cisco-ios's: MDS answers few of the IOS OIDs, and keeps its
 * CPU and memory in CISCO-SYSTEM-EXT-MIB, its power supplies, modules and
 * fan trays in CISCO-ENTITY-FRU-CONTROL-MIB and its VSANs in
 * CISCO-VSAN-MIB. Checked against Cisco's MIB files and its support list
 * for NX-OS 9.4(4) on MDS.
 *
 * As for Brocade, each interface's Fibre Channel errors (CISCO-FC-FE-MIB)
 * and its optics (CISCO-ENTITY-SENSOR-MIB) are read with the interfaces.
 */
const CISCO_MDS: SnmpVendorTemplate = {
  id: "cisco-mds",
  label: "Cisco MDS 9000 (SAN switches)",
  description:
    "CPU and memory, power supplies, modules and fan trays, and every VSAN with its state, from the CISCO-SYSTEM-EXT, CISCO-ENTITY-FRU-CONTROL and CISCO-VSAN MIBs. Interface errors and optics come with the interfaces.",
  oids: [
    {
      oid: "1.3.6.1.4.1.9.9.305.1.1.1.0",
      name: "CPU %",
      description: "cseSysCPUUtilization - the active supervisor's CPU.",
    },
    {
      oid: "1.3.6.1.4.1.9.9.305.1.1.2.0",
      name: "Memory %",
      description: "cseSysMemoryUtilization - the active supervisor's memory.",
    },
  ],
  tables: [
    {
      key: "power_supplies",
      name: "Power Supplies",
      description: "cefcFRUPowerStatusTable, named by the switch's entity names.",
      kind: SnmpTableKind.Hardware,
      rowLabelColumnOids: [ENTITY_PHYSICAL_NAME_OID],
      rowLabelsByIndex: true,
      columns: [
        {
          oid: "1.3.6.1.4.1.9.9.117.1.1.2.1.2",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "1": "off (other)",
            "2": "on",
            "3": "off (admin)",
            "4": "off (denied)",
            "5": "off (power)",
            "6": "off (temperature)",
            "7": "off (fan)",
            "8": "failed",
            "9": "on, fan failed",
            "10": "off (cooling)",
            "11": "off (connector rating)",
            "12": "on, inline power failed",
          },
          healthyValues: ["2"],
        },
      ],
      maxRows: 16,
    },
    {
      key: "modules",
      name: "Modules",
      description:
        "cefcModuleTable: supervisors and line cards, named by the switch's entity names.",
      kind: SnmpTableKind.Hardware,
      rowLabelColumnOids: [ENTITY_PHYSICAL_NAME_OID],
      rowLabelsByIndex: true,
      columns: [
        {
          oid: "1.3.6.1.4.1.9.9.117.1.2.1.1.2",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "1": "unknown",
            "2": "ok",
            "3": "disabled",
            "4": "ok, diagnostics failed",
            "5": "booting",
            "6": "self test",
            "7": "failed",
            "8": "missing",
            "9": "mismatch with parent",
            "10": "mismatch with configuration",
            "11": "diagnostics failed",
            "12": "dormant",
            "13": "out of service (admin)",
            "14": "out of service (temperature)",
            "15": "powered down",
            "16": "powered up",
            "17": "power denied",
            "18": "power cycled",
            "19": "ok, power over warning",
            "20": "ok, power over critical",
            "21": "synchronizing",
            "22": "upgrading",
            "23": "ok, authentication failed",
            "24": "minimum disruption restart",
            "25": "firmware mismatch",
            "26": "firmware download succeeded",
            "27": "firmware download failed",
          },
          healthyValues: ["2"],
        },
      ],
      maxRows: 32,
    },
    {
      key: "fan_trays",
      name: "Fan Trays",
      description: "cefcFanTrayStatusTable, named by the switch's entity names.",
      kind: SnmpTableKind.Hardware,
      rowLabelColumnOids: [ENTITY_PHYSICAL_NAME_OID],
      rowLabelsByIndex: true,
      columns: [
        {
          oid: "1.3.6.1.4.1.9.9.117.1.4.1.1.1",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "1": "unknown",
            "2": "up",
            "3": "down",
            "4": "warning",
          },
          healthyValues: ["2"],
        },
      ],
      maxRows: 32,
    },
    {
      /*
       * Informational: no healthy values, so no "row unhealthy" alert. A
       * VSAN with no interface up in it is operationally down by design,
       * and so are the isolated VSANs (4079, 4094) every MDS keeps.
       */
      key: "vsans",
      name: "VSANs",
      description:
        "vsanTable: every VSAN with its name and state. A VSAN with no interface up in it is down by design.",
      kind: SnmpTableKind.Generic,
      rowLabelColumnOids: ["1.3.6.1.4.1.9.9.282.1.1.3.1.2"],
      columns: [
        {
          oid: "1.3.6.1.4.1.9.9.282.1.1.3.1.4",
          name: "Admin State",
          valueLabels: { "1": "active", "2": "suspended" },
        },
        {
          oid: "1.3.6.1.4.1.9.9.282.1.1.3.1.8",
          name: "State",
          valueLabels: { "1": "up", "2": "down" },
        },
      ],
      maxRows: MAX_SNMP_TABLE_MAX_ROWS,
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
  label: "Ubiquiti EdgeOS / EdgeSwitch / UniFi Switches",
  description:
    "CPU load and memory usage via the standard Host Resources and UCD MIBs — Ubiquiti publishes no vendor health MIB for its routers and switches, but EdgeOS, EdgeSwitch and UniFi switches answer these. UniFi access points have a template of their own, with their radios and SSIDs.",
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
  tables: [HOST_RESOURCES_CPU_TABLE],
};

const CAMBIUM_WIFI_AP: SnmpVendorTemplate = {
  id: "cambium-wifi-ap",
  label: "Cambium Networks Enterprise Wi-Fi (cnPilot, XV, XE, XH)",
  description:
    "AP CPU, memory and client count, plus every radio's band, channel, channel width, transmit power, clients, noise floor and airtime, and every SSID's clients, from the CAMBIUM-MIB (enterprise 17713.22). SNMP is enabled per AP Group in cnMaestro.",
  oids: [
    {
      oid: "1.3.6.1.4.1.17713.22.1.1.1.6.0",
      name: "CPU %",
      description: "cambiumAPCPUUtilization.",
    },
    {
      oid: "1.3.6.1.4.1.17713.22.1.1.1.7.0",
      name: "Memory Free",
      description: "cambiumAPMemoryFree.",
    },
    {
      oid: "1.3.6.1.4.1.17713.22.1.1.1.14.0",
      name: "Wi-Fi Clients",
      description:
        "cambiumAPTotalClients - clients on every radio. Reported as 0 before firmware 6.5.3.",
    },
    {
      oid: "1.3.6.1.4.1.17713.22.1.1.1.12.0",
      name: "cnMaestro Connection",
      description: "cambiumAPCnmConstaus - the AP's connection to cnMaestro.",
    },
  ],
  tables: [
    {
      key: "wifi_radios",
      name: "Wi-Fi Radios",
      description:
        "cambiumRadioTable - one row per radio. Channel, width and noise floor arrive as text and are read as numbers.",
      kind: SnmpTableKind.WifiRadio,
      rowLabelColumnOids: ["1.3.6.1.4.1.17713.22.1.2.1.3"],
      columns: [
        {
          oid: "1.3.6.1.4.1.17713.22.1.2.1.3",
          name: "Band",
          role: SnmpTableColumnRole.Band,
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.2.1.6",
          name: "Channel",
          role: SnmpTableColumnRole.Channel,
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.2.1.7",
          name: "Channel Width",
          unit: "MHz",
          role: SnmpTableColumnRole.ChannelWidth,
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.2.1.8",
          name: "TX Power",
          unit: "dBm",
          role: SnmpTableColumnRole.TxPower,
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.2.1.5",
          name: "Clients",
          role: SnmpTableColumnRole.Clients,
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.2.1.16",
          name: "Noise Floor",
          unit: "dBm",
          role: SnmpTableColumnRole.NoiseFloor,
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.2.1.18",
          name: "Airtime",
          unit: "%",
          role: SnmpTableColumnRole.Utilization,
          description:
            "Reported as total/tx/rx/busy; the first number, total airtime, is what is charted.",
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.2.1.13",
          name: "State",
          role: SnmpTableColumnRole.Status,
          valueType: SnmpTableValueType.Text,
          valueLabels: { ON: "On", OFF: "Off" },
          healthyValues: ["ON"],
        },
      ],
      maxRows: 8,
    },
    {
      key: "wifi_ssids",
      name: "SSIDs",
      description: "The WLAN table - one row per SSID on each band.",
      kind: SnmpTableKind.WifiSsid,
      rowLabelColumnOids: [
        "1.3.6.1.4.1.17713.22.1.4.1.2",
        "1.3.6.1.4.1.17713.22.1.4.1.3",
      ],
      columns: [
        {
          oid: "1.3.6.1.4.1.17713.22.1.4.1.2",
          name: "SSID",
          role: SnmpTableColumnRole.Ssid,
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.4.1.3",
          name: "Band",
          role: SnmpTableColumnRole.Band,
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.4.1.4",
          name: "VLAN",
        },
        {
          oid: "1.3.6.1.4.1.17713.22.1.4.1.7",
          name: "Clients",
          role: SnmpTableColumnRole.Clients,
        },
      ],
      maxRows: 64,
    },
  ],
};

const CAMBIUM_CNMATRIX: SnmpVendorTemplate = {
  id: "cambium-cnmatrix",
  label: "Cambium Networks cnMatrix",
  description:
    "CPU, RAM, flash, temperature and supply voltage from the ARICENT-ISS MIB that cnMatrix switches implement, plus fans, per-port PoE draw and the redundant power supply.",
  oids: [
    {
      oid: "1.3.6.1.4.1.2076.81.1.68.0",
      name: "CPU %",
      description: "issSwitchCurrentCpuThreshold - CPU utilization.",
    },
    {
      oid: "1.3.6.1.4.1.2076.81.1.73.0",
      name: "RAM %",
      description: "issSwitchCurrentRAMUsage - memory utilization.",
    },
    {
      oid: "1.3.6.1.4.1.2076.81.1.75.0",
      name: "Flash %",
      description: "issSwitchCurrentFlashUsage - flash utilization.",
    },
    {
      oid: "1.3.6.1.4.1.2076.81.1.66.0",
      name: "Temperature (C)",
      description: "issSwitchCurrentTemperature.",
    },
    {
      oid: "1.3.6.1.4.1.2076.81.1.71.0",
      name: "Power Supply (V)",
      description: "issSwitchCurrentPowerSupply - supply voltage.",
    },
  ],
  tables: [
    {
      key: "fans",
      name: "Fans",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.2076.81.13.1.1.2",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: { "1": "up", "2": "down" },
          healthyValues: ["1"],
        },
      ],
      maxRows: 16,
    },
    {
      key: "poe_ports",
      name: "PoE Ports",
      description: "Per-port PoE draw, indexed by group and port.",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.2076.103.1.3.1.5",
          name: "Power",
          unit: "mW",
        },
        {
          oid: "1.3.6.1.4.1.2076.103.1.3.1.3",
          name: "Current",
          unit: "mA",
        },
        {
          oid: "1.3.6.1.4.1.2076.103.1.3.1.4",
          name: "Voltage",
          unit: "dV",
        },
      ],
      maxRows: 64,
    },
    {
      key: "redundant_power",
      name: "Redundant Power Supply",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.17713.24.6.1.1.5",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: { "1": "ok", "2": "error", "3": "not present" },
          healthyValues: ["1", "3"],
        },
      ],
      maxRows: 4,
    },
  ],
};

const EXTREME_EXOS: SnmpVendorTemplate = {
  id: "extreme-exos",
  label: "Extreme Networks EXOS / Switch Engine",
  description:
    "CPU, temperature, the over-temperature alarm and the system power state, plus power supplies, fans, memory per slot and stack members, from the EXTREME-SYSTEM, -SOFTWARE-MONITOR and -STACKING MIBs.",
  oids: [
    {
      oid: "1.3.6.1.4.1.1916.1.32.1.2.0",
      name: "CPU %",
      description: "extremeCpuMonitorTotalUtilization.",
    },
    {
      oid: "1.3.6.1.4.1.1916.1.1.1.8.0",
      name: "Temperature (C)",
      description: "extremeCurrentTemperature.",
    },
    {
      oid: "1.3.6.1.4.1.1916.1.1.1.7.0",
      name: "Over-Temperature Alarm",
      description: "extremeOverTemperatureAlarm - 1 = alarm, 2 = normal.",
    },
    {
      oid: "1.3.6.1.4.1.1916.1.1.1.36.0",
      name: "Power State",
      description:
        "extremeSystemPowerState - 1 computing, 2 sufficient but not redundant, 3 redundant, 4 insufficient.",
    },
  ],
  tables: [
    {
      key: "power_supplies",
      name: "Power Supplies",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.1916.1.1.1.27.1.2",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "1": "not present",
            "2": "present, OK",
            "3": "present, not OK",
            "4": "present, powered off",
          },
          healthyValues: ["1", "2"],
        },
      ],
      maxRows: 16,
    },
    {
      key: "fans",
      name: "Fans",
      description:
        "extremeFanStatusTable - rows are numbered tray * 100 + fan.",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.1916.1.1.1.9.1.2",
          name: "Operational",
          role: SnmpTableColumnRole.Status,
          valueLabels: { "1": "yes", "2": "no" },
          healthyValues: ["1"],
        },
        {
          oid: "1.3.6.1.4.1.1916.1.1.1.9.1.4",
          name: "Speed",
          unit: "RPM",
        },
      ],
      maxRows: 64,
    },
    {
      key: "memory",
      name: "Memory",
      description: "extremeMemoryMonitorSystemTable - one row per slot.",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.1916.1.32.2.2.1.2",
          name: "Total",
          unit: "KB",
        },
        {
          oid: "1.3.6.1.4.1.1916.1.32.2.2.1.3",
          name: "Free",
          unit: "KB",
        },
      ],
      maxRows: 16,
    },
    {
      key: "stack_members",
      name: "Stack Members",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.1916.1.33.2.1.3",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: { "1": "up", "2": "down", "3": "mismatch" },
          healthyValues: ["1"],
        },
        {
          oid: "1.3.6.1.4.1.1916.1.33.2.1.4",
          name: "Role",
          valueLabels: { "1": "master", "2": "slave", "3": "backup" },
        },
      ],
      maxRows: 8,
    },
  ],
};

const EXTREME_FABRIC_ENGINE: SnmpVendorTemplate = {
  id: "extreme-fabric-engine",
  label: "Extreme Networks Fabric Engine / VOSS",
  description:
    "CPU and memory per slot, temperature sensors, fans and power supplies from the RAPID-CITY MIB, the vIST session, the I-SID count, and every Fabric Connect (IS-IS) adjacency with its neighbour's name.",
  oids: [
    {
      oid: "1.3.6.1.4.1.2272.1.211.1.0",
      name: "vIST Session",
      description: "rcVirtualIstSessionStatus - 1 = up, 2 = down.",
    },
    {
      oid: "1.3.6.1.4.1.2272.1.87.1.0",
      name: "I-SIDs",
      description: "rcIsidNumIsids - fabric services configured.",
    },
  ],
  tables: [
    {
      key: "isis_adjacencies",
      name: "Fabric Adjacencies (IS-IS)",
      description:
        "isisISAdjTable (experimental ISIS-MIB 1.3.6.1.3.37, which Fabric Engine implements), named by rcIsisAdjHostName.",
      kind: SnmpTableKind.RoutingAdjacency,
      rowLabelColumnOids: ["1.3.6.1.4.1.2272.1.63.10.1.3"],
      columns: [
        {
          oid: "1.3.6.1.3.37.1.6.1.1.2",
          name: "State",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "1": "down",
            "2": "initializing",
            "3": "up",
            "4": "failed",
          },
          healthyValues: ["3"],
        },
      ],
      maxRows: 128,
    },
    {
      key: "cpu_memory",
      name: "CPU and Memory",
      description: "rcKhiSlotPerfTable - one row per slot.",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.2272.1.85.10.1.1.2",
          name: "CPU",
          unit: "%",
        },
        {
          oid: "1.3.6.1.4.1.2272.1.85.10.1.1.3",
          name: "CPU 5-min Average",
          unit: "%",
        },
        {
          oid: "1.3.6.1.4.1.2272.1.85.10.1.1.8",
          name: "Memory",
          unit: "%",
        },
      ],
      maxRows: 16,
    },
    {
      key: "temperature",
      name: "Temperature Sensors",
      kind: SnmpTableKind.Hardware,
      rowLabelColumnOids: ["1.3.6.1.4.1.2272.1.101.1.1.2.1.2"],
      columns: [
        {
          oid: "1.3.6.1.4.1.2272.1.101.1.1.2.1.3",
          name: "Temperature",
          unit: "C",
        },
        {
          oid: "1.3.6.1.4.1.2272.1.101.1.1.2.1.6",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: { "1": "normal", "2": "warning", "3": "critical" },
          healthyValues: ["1"],
        },
      ],
      maxRows: 32,
    },
    {
      key: "fans",
      name: "Fans",
      description: "Rows are numbered tray.fan.",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.2272.1.101.1.1.4.1.4",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "1": "unknown",
            "2": "up",
            "3": "down",
            "4": "not present",
          },
          healthyValues: ["2", "4"],
        },
      ],
      maxRows: 32,
    },
    {
      key: "power_supplies",
      name: "Power Supplies",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.2272.1.4.8.1.1.2",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: { "1": "unknown", "2": "empty", "3": "up", "4": "down" },
          healthyValues: ["2", "3"],
        },
      ],
      maxRows: 8,
    },
  ],
};

const SOPHOS_SFOS: SnmpVendorTemplate = {
  id: "sophos-sfos",
  label: "Sophos Firewall (SFOS / XGS)",
  description:
    "Every IPsec tunnel's status (SFOS v20 and later), CPU per core, memory, disk and swap, HA state and the IPsec service, from SFOS-FIREWALL-MIB (enterprise 2604). Sophos does not publish gateway or SD-WAN health over SNMP - send its syslog to the probe for those.",
  oids: [
    {
      oid: "1.3.6.1.4.1.2604.5.1.2.5.2.0",
      name: "Memory %",
      description: "sfosMemoryPercentUsage.",
    },
    {
      oid: "1.3.6.1.4.1.2604.5.1.2.4.2.0",
      name: "Disk %",
      description: "sfosDiskPercentUsage.",
    },
    {
      oid: "1.3.6.1.4.1.2604.5.1.2.5.4.0",
      name: "Swap %",
      description: "sfosSwapPercentUsage.",
    },
    {
      oid: "1.3.6.1.4.1.2604.5.1.4.4.0",
      name: "HA State",
      description:
        "sfosDeviceCurrentHAState - 0 n/a, 1 auxiliary, 2 standalone, 3 primary, 4 faulty, 5 ready.",
    },
    {
      oid: "1.3.6.1.4.1.2604.5.1.4.5.0",
      name: "HA Peer State",
      description: "sfosDevicePeerHAState - same values as HA State.",
    },
    {
      oid: "1.3.6.1.4.1.2604.5.1.3.15.0",
      name: "IPsec Service",
      description:
        "sfosIPSecVpnService - 0 untouched, 1 stopped, 3 running, 5 dead.",
    },
    {
      oid: "1.3.6.1.4.1.2604.5.1.9.2.0",
      name: "CPU Temperature (0.1 C)",
      description:
        "sfosXGSystemHealth CPU temperature in tenths of a degree (SFOS v22 and later).",
    },
  ],
  tables: [
    {
      key: "ipsec_tunnels",
      name: "IPsec Tunnels",
      description:
        "sfosIPSecVpnTunnelTable - one row per IPsec connection. Status needs SFOS v20 or later; 'active' means the tunnel's security associations are up, so pair it with a ping across the tunnel to prove traffic flows.",
      kind: SnmpTableKind.VpnTunnel,
      rowLabelColumnOids: ["1.3.6.1.4.1.2604.5.1.6.1.1.1.1.2"],
      columns: [
        {
          oid: "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9",
          name: "Status",
          role: SnmpTableColumnRole.Status,
          valueLabels: {
            "0": "inactive",
            "1": "active",
            "2": "partially active",
          },
          healthyValues: ["1"],
        },
        {
          oid: "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.10",
          name: "Enabled",
          valueLabels: { "0": "no", "1": "yes" },
        },
        {
          oid: "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.6",
          name: "Type",
          valueLabels: {
            "1": "host-to-host",
            "2": "site-to-site",
            "3": "tunnel interface",
          },
        },
      ],
      maxRows: 250,
    },
    HOST_RESOURCES_CPU_TABLE,
  ],
};

/*
 * --- Wi-Fi vendors ---
 *
 * Each reads what the vendor's own MIB says about its radios and SSIDs -
 * and, for a controller, the access points it manages - into tables of the
 * Wi-Fi kinds, so the device's Wi-Fi tab, its criteria and its charts work
 * the same whichever vendor it is. Every OID below is taken from the MIB
 * definition named next to it. What a vendor does not report over SNMP
 * (Juniper Mist reports nothing; TP-Link Omada access points only their
 * client count) is written up in the docs' Wi-Fi vendor table.
 */

/*
 * How UniFi names a radio's band in unifiRadioRadio and unifiVapRadio:
 * the 802.11 mode its radio runs - "ng" on 2.4 GHz, "na" on 5 GHz - and
 * "6e" on 6 GHz.
 */
const UNIFI_BAND_LABELS: Record<string, string> = {
  ng: "2.4 GHz",
  na: "5 GHz",
  "6e": "6 GHz",
};

const UBIQUITI_UNIFI_AP: SnmpVendorTemplate = {
  id: "ubiquiti-unifi-ap",
  label: "Ubiquiti UniFi Access Points",
  description:
    "Every radio's band and airtime, and every SSID's band, channel, clients and transmit power, from the UBNT-UniFi-MIB, plus CPU per core, memory and load. A radio's channel, power and clients are read from the SSIDs it broadcasts, which is where UniFi reports them. UniFi's own hidden networks - its wireless mesh link and its device adoption network - are not SSIDs and are left out. Turn on SNMP in the UniFi Network application.",
  oids: [
    {
      oid: "1.3.6.1.4.1.41112.1.6.3.2.0",
      name: "Isolated",
      description:
        "unifiApSystemIsolated - TruthValue: 1 = isolated, 2 = not isolated.",
    },
    {
      oid: "1.3.6.1.4.1.2021.10.1.3.1",
      name: "Load Average (1 min)",
      description: "laLoad.1 - UCD-SNMP-MIB.",
    },
    {
      oid: "1.3.6.1.4.1.2021.4.5.0",
      name: "Total RAM (KB)",
      description: "memTotalReal - UCD-SNMP-MIB.",
    },
    {
      oid: "1.3.6.1.4.1.2021.4.6.0",
      name: "Available RAM (KB)",
      description: "memAvailReal - UCD-SNMP-MIB.",
    },
  ],
  tables: [
    {
      key: "wifi_radios",
      name: "Wi-Fi Radios",
      description:
        "unifiRadioTable - one row per radio: its band and how busy its channel is. Channel, transmit power and clients are on the SSIDs table.",
      kind: SnmpTableKind.WifiRadio,
      // "2.4 GHz / wifi0": the band, then the radio's interface.
      rowLabelColumnOids: [
        "1.3.6.1.4.1.41112.1.6.1.1.1.3",
        "1.3.6.1.4.1.41112.1.6.1.1.1.2",
      ],
      columns: [
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.1.1.3",
          name: "Band",
          description: "unifiRadioRadio - ng, na or 6e.",
          role: SnmpTableColumnRole.Band,
          valueType: SnmpTableValueType.Text,
          valueLabels: UNIFI_BAND_LABELS,
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.1.1.2",
          name: "Interface",
          description: "unifiRadioName.",
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.1.1.6",
          name: "Airtime",
          unit: "%",
          role: SnmpTableColumnRole.Utilization,
          description:
            "unifiRadioCuTotal - how much of the time the channel is busy, with any traffic.",
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.1.1.7",
          name: "Receive Airtime",
          unit: "%",
          description:
            "unifiRadioCuSelfRx - the share of airtime this radio spends receiving.",
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.1.1.8",
          name: "Transmit Airtime",
          unit: "%",
          description:
            "unifiRadioCuSelfTx - the share of airtime this radio spends transmitting.",
        },
      ],
      maxRows: 8,
    },
    {
      key: "wifi_ssids",
      name: "SSIDs",
      description:
        "unifiVapTable - one row per SSID on each radio, with that radio's channel and transmit power. UniFi's own hidden networks are VAPs too, and are left out: its wireless mesh link (vwire-..., usage downlink, interface vwire...) and its device adoption network (element-...).",
      kind: SnmpTableKind.WifiSsid,
      rowLabelColumnOids: [
        "1.3.6.1.4.1.41112.1.6.1.2.1.6",
        "1.3.6.1.4.1.41112.1.6.1.2.1.9",
      ],
      columns: [
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.2.1.6",
          name: "SSID",
          description: "unifiVapEssId.",
          role: SnmpTableColumnRole.Ssid,
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.2.1.9",
          name: "Band",
          description: "unifiVapRadio - ng, na or 6e.",
          role: SnmpTableColumnRole.Band,
          valueType: SnmpTableValueType.Text,
          valueLabels: UNIFI_BAND_LABELS,
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.2.1.7",
          name: "Interface",
          description:
            "unifiVapName - the SSID's interface (ath0, ath1 ...), as the device's Interfaces page names it.",
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.2.1.4",
          name: "Channel",
          description: "unifiVapChannel.",
          role: SnmpTableColumnRole.Channel,
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.2.1.8",
          name: "Clients",
          description: "unifiVapNumStations.",
          role: SnmpTableColumnRole.Clients,
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.2.1.21",
          name: "TX Power",
          unit: "dBm",
          description: "unifiVapTxPower.",
          role: SnmpTableColumnRole.TxPower,
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.2.1.3",
          name: "Connection Quality",
          unit: "%",
          description:
            "unifiVapCcq - client connection quality, reported in tenths of a percent.",
          scale: 0.1,
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.2.1.22",
          name: "Up",
          description: "unifiVapUp - TruthValue: 1 = up, 2 = down.",
          valueLabels: { "1": "up", "2": "down" },
        },
        {
          oid: "1.3.6.1.4.1.41112.1.6.1.2.1.23",
          name: "Usage",
          description:
            "unifiVapUsage - user or guest. The mesh link's downlink (or uplink) is left out.",
          valueType: SnmpTableValueType.Text,
        },
      ],
      maxRows: 64,
    },
    HOST_RESOURCES_CPU_TABLE,
  ],
};

const ARUBA_UP_DOWN_LABELS: Record<string, string> = {
  "1": "up",
  "2": "down",
};

const ARUBA_INSTANT: SnmpVendorTemplate = {
  id: "aruba-instant",
  label: "HPE Aruba Instant (AOS 8)",
  description:
    "Every access point of the Instant cluster (status, CPU, memory), every radio (channel, transmit power, noise floor, utilization, clients, status) named by its access point, and every SSID with its clients, from AI-AP-MIB. Add the cluster's virtual controller address; it answers for every access point.",
  oids: [
    {
      oid: "1.3.6.1.4.1.14823.2.3.3.1.1.2.0",
      name: "Cluster Name",
      description: "aiVirtualControllerName.",
    },
    {
      oid: "1.3.6.1.4.1.14823.2.3.3.1.1.4.0",
      name: "Firmware Version",
      description:
        "aiVirtualControllerVersion - alert on a change to see upgrades.",
    },
    {
      oid: "1.3.6.1.4.1.14823.2.3.3.1.1.6.0",
      name: "Conductor IP",
      description:
        "aiMasterIPAddress - the access point running the virtual controller; it changes when another takes over.",
    },
  ],
  tables: [
    {
      key: "wifi_access_points",
      name: "Access Points",
      description:
        "aiAccessPointTable - one row per access point in the cluster.",
      kind: SnmpTableKind.WifiAccessPoint,
      rowLabelColumnOids: ["1.3.6.1.4.1.14823.2.3.3.1.2.1.1.2"],
      columns: [
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.1.1.11",
          name: "Status",
          description: "aiAPStatus.",
          role: SnmpTableColumnRole.Status,
          valueLabels: ARUBA_UP_DOWN_LABELS,
          healthyValues: ["1"],
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.1.1.6",
          name: "Model",
          description: "aiAPModelName.",
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.1.1.3",
          name: "IP Address",
          description: "aiAPIPAddress.",
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.1.1.4",
          name: "Serial Number",
          description: "aiAPSerialNum.",
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.1.1.7",
          name: "CPU",
          unit: "%",
          description: "aiAPCPUUtilization.",
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.1.1.8",
          name: "Memory Free",
          unit: "bytes",
          description: "aiAPMemoryFree.",
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.1.1.10",
          name: "Memory Total",
          unit: "bytes",
          description: "aiAPTotalMemory.",
        },
      ],
      maxRows: MAX_SNMP_TABLE_MAX_ROWS,
    },
    {
      key: "wifi_radios",
      name: "Wi-Fi Radios",
      description:
        "aiRadioTable - one row per radio of every access point, named by its access point (aiAPName). Aruba writes the channel with its width (36E is channel 36 at 80 MHz) and the noise floor without its sign.",
      kind: SnmpTableKind.WifiRadio,
      rowLabelColumnOids: [
        "1.3.6.1.4.1.14823.2.3.3.1.2.1.1.2",
        "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.2",
      ],
      // The access points' rows only name their radios.
      skipNameOnlyRows: true,
      columns: [
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.2",
          name: "Radio",
          description: "aiRadioIndex - the radio number.",
          valueType: SnmpTableValueType.Text,
          valueLabels: {
            "0": "Radio 0",
            "1": "Radio 1",
            "2": "Radio 2",
            "3": "Radio 3",
          },
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.4",
          name: "Channel",
          description: "aiRadioChannel.",
          role: SnmpTableColumnRole.Channel,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.5",
          name: "TX Power",
          unit: "dBm",
          description: "aiRadioTransmitPower.",
          role: SnmpTableColumnRole.TxPower,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.6",
          name: "Noise Floor",
          unit: "dBm",
          description:
            "aiRadioNoiseFloor - reported without its sign (94 for -94 dBm) and read as negative.",
          role: SnmpTableColumnRole.NoiseFloor,
          scale: -1,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.8",
          name: "Utilization",
          unit: "%",
          description:
            "aiRadioUtilization64 - channel utilization, averaged over 64 seconds.",
          role: SnmpTableColumnRole.Utilization,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.21",
          name: "Clients",
          description: "aiRadioClientNum.",
          role: SnmpTableColumnRole.Clients,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.20",
          name: "Status",
          description: "aiRadioStatus.",
          role: SnmpTableColumnRole.Status,
          valueLabels: ARUBA_UP_DOWN_LABELS,
          healthyValues: ["1"],
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.22",
          name: "Mode",
          description: "aiRadioMode - access or monitor.",
          valueType: SnmpTableValueType.Text,
        },
      ],
      maxRows: MAX_SNMP_TABLE_MAX_ROWS,
    },
    {
      key: "wifi_ssids",
      name: "SSIDs",
      description: "aiWlanSSIDTable - one row per SSID the cluster broadcasts.",
      kind: SnmpTableKind.WifiSsid,
      rowLabelColumnOids: ["1.3.6.1.4.1.14823.2.3.3.1.1.7.1.2"],
      columns: [
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.1.7.1.2",
          name: "SSID",
          description: "aiSSID.",
          role: SnmpTableColumnRole.Ssid,
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.1.7.1.4",
          name: "Clients",
          description: "aiSSIDClientNum.",
          role: SnmpTableColumnRole.Clients,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.1.7.1.3",
          name: "Status",
          description: "aiSSIDStatus.",
          valueLabels: { "0": "enabled", "1": "disabled" },
        },
        {
          oid: "1.3.6.1.4.1.14823.2.3.3.1.1.7.1.5",
          name: "Hidden",
          description: "aiSSIDHide.",
          valueLabels: { "0": "no", "1": "yes" },
        },
      ],
      maxRows: 32,
    },
  ],
};

/*
 * ArubaPhyType, the radio type wlanAPRadioType reports: dot11a(1) runs on
 * 5 GHz, dot11b(2) and dot11g(3) on 2.4 GHz; dot11ag(4) names no one band.
 */
const ARUBA_RADIO_TYPE_LABELS: Record<string, string> = {
  "1": "5 GHz",
  "2": "2.4 GHz",
  "3": "2.4 GHz",
  "4": "802.11a/g",
};

const ARUBA_MOBILITY_CONTROLLER: SnmpVendorTemplate = {
  id: "aruba-mobility-controller",
  label: "HPE Aruba Mobility Controller (AOS 8)",
  description:
    "The controller's role, CPU and memory, its access point and client counts, every access point it manages (status), every radio (band, channel, transmit power, utilization, clients) named by its access point, and every SSID with its clients, from the WLSX-SWITCH and WLSX-WLAN MIBs.",
  oids: [
    {
      oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.1.0",
      name: "Access Points",
      description:
        "wlsxWlanTotalNumAccessPoints - access points connected to the controller.",
    },
    {
      oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.2.0",
      name: "Wi-Fi Clients",
      description:
        "wlsxWlanTotalNumStationsAssociated - clients associated to the controller.",
    },
    {
      oid: "1.3.6.1.4.1.14823.2.2.1.1.1.4.0",
      name: "Controller Role",
      description:
        "wlsxSwitchRole - 1 master, 2 local, 3 standby master, 4 branch, 5 managed device.",
    },
  ],
  tables: [
    {
      key: "wifi_access_points",
      name: "Access Points",
      description:
        "wlsxWlanAPTable - one row per access point the controller manages.",
      kind: SnmpTableKind.WifiAccessPoint,
      rowLabelColumnOids: ["1.3.6.1.4.1.14823.2.2.1.5.2.1.4.1.3"],
      columns: [
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.4.1.19",
          name: "Status",
          description: "wlanAPStatus.",
          role: SnmpTableColumnRole.Status,
          valueLabels: ARUBA_UP_DOWN_LABELS,
          healthyValues: ["1"],
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.4.1.13",
          name: "Model",
          description: "wlanAPModelName.",
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.4.1.2",
          name: "IP Address",
          description: "wlanAPIpAddress.",
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.4.1.4",
          name: "AP Group",
          description: "wlanAPGroupName.",
          valueType: SnmpTableValueType.Text,
        },
      ],
      maxRows: MAX_SNMP_TABLE_MAX_ROWS,
    },
    {
      key: "wifi_radios",
      name: "Wi-Fi Radios",
      description:
        "wlsxWlanRadioTable - one row per radio of every access point, named by its access point (wlanAPRadioAPName) and band.",
      kind: SnmpTableKind.WifiRadio,
      rowLabelColumnOids: [
        "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1.16",
        "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1.2",
      ],
      columns: [
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1.2",
          name: "Band",
          description: "wlanAPRadioType - the radio's PHY type.",
          role: SnmpTableColumnRole.Band,
          valueType: SnmpTableValueType.Text,
          valueLabels: ARUBA_RADIO_TYPE_LABELS,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1.3",
          name: "Channel",
          description: "wlanAPRadioChannel.",
          role: SnmpTableColumnRole.Channel,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1.4",
          name: "TX Power",
          unit: "dBm",
          description:
            "wlanAPRadioTransmitPower - reported doubled (38 for 19 dBm) and read as dBm.",
          role: SnmpTableColumnRole.TxPower,
          scale: 0.5,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1.6",
          name: "Utilization",
          unit: "%",
          description:
            "wlanAPRadioUtilization - utilization as a percentage of the radio's capacity.",
          role: SnmpTableColumnRole.Utilization,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1.7",
          name: "Clients",
          description: "wlanAPRadioNumAssociatedClients.",
          role: SnmpTableColumnRole.Clients,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1.5",
          name: "Mode",
          description: "wlanAPRadioMode.",
          valueLabels: {
            "1": "air monitor",
            "2": "access point",
            "3": "access point and monitor",
            "4": "mesh portal",
            "5": "mesh point",
            "6": "RFprotect sensor",
            "7": "spectrum sensor",
          },
        },
      ],
      maxRows: MAX_SNMP_TABLE_MAX_ROWS,
    },
    {
      key: "wifi_ssids",
      name: "SSIDs",
      description:
        "wlsxWlanESSIDTable - one row per SSID, indexed by the SSID itself, with its clients and how many of its access points are up and down.",
      kind: SnmpTableKind.WifiSsid,
      rowIndexIsText: true,
      columns: [
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.8.1.2",
          name: "Clients",
          description: "wlanESSIDNumStations.",
          role: SnmpTableColumnRole.Clients,
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.8.1.3",
          name: "Access Points Up",
          description: "wlanESSIDNumAccessPointsUp.",
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.5.2.1.8.1.4",
          name: "Access Points Down",
          description: "wlanESSIDNumAccessPointsDown.",
        },
      ],
      maxRows: 64,
    },
    {
      key: "cpu_processors",
      name: "Processors",
      description: "wlsxSysXProcessorTable - one row per processor.",
      kind: SnmpTableKind.Hardware,
      rowLabelColumnOids: ["1.3.6.1.4.1.14823.2.2.1.1.1.9.1.2"],
      columns: [
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.1.1.9.1.3",
          name: "Load",
          unit: "%",
          description:
            "sysXProcessorLoad - average over the last minute of the time the processor was not idle.",
        },
      ],
      maxRows: 32,
    },
    {
      key: "memory",
      name: "Memory",
      description: "wlsxSysXMemoryTable - the control plane's memory.",
      kind: SnmpTableKind.Hardware,
      columns: [
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.1.1.11.1.2",
          name: "Total",
          unit: "KB",
          description: "sysXMemorySize.",
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.1.1.11.1.3",
          name: "Used",
          unit: "KB",
          description: "sysXMemoryUsed.",
        },
        {
          oid: "1.3.6.1.4.1.14823.2.2.1.1.1.11.1.4",
          name: "Free",
          unit: "KB",
          description: "sysXMemoryFree.",
        },
      ],
      maxRows: 8,
    },
  ],
};

const EXTREME_IQ_ENGINE_AP: SnmpVendorTemplate = {
  id: "extreme-iq-engine-ap",
  label: "Extreme Networks IQ Engine (HiveOS) Access Points",
  description:
    "CPU, memory, Wi-Fi clients and temperature, every radio's channel, transmit power and noise floor, and every SSID, from the Aerohive AH-SYSTEM and AH-INTERFACE MIBs that IQ Engine (HiveOS) access points implement. Turn on SNMP in the network policy ExtremeCloud IQ pushes to the access points.",
  oids: [
    {
      oid: "1.3.6.1.4.1.26928.1.2.3.0",
      name: "CPU %",
      description: "ahCpuUtilization.",
    },
    {
      oid: "1.3.6.1.4.1.26928.1.2.4.0",
      name: "Memory %",
      description: "ahMemUtilization.",
    },
    {
      oid: "1.3.6.1.4.1.26928.1.2.9.0",
      name: "Wi-Fi Clients",
      description: "ahClientCount - devices connected to the access point.",
    },
    {
      oid: "1.3.6.1.4.1.26928.1.2.10.0",
      name: "Temperature (C)",
      description: "ahEnvirmentTemp.",
    },
  ],
  tables: [
    {
      key: "wifi_radios",
      name: "Wi-Fi Radios",
      description:
        "ahRadioAttributeTable - one row per radio, named by its interface (ahIfName). The band follows from the channel.",
      kind: SnmpTableKind.WifiRadio,
      rowLabelColumnOids: ["1.3.6.1.4.1.26928.1.1.1.2.1.1.1.1"],
      // ahIfName names every interface; only the radios are rows here.
      skipNameOnlyRows: true,
      columns: [
        {
          oid: "1.3.6.1.4.1.26928.1.1.1.2.1.5.1.1",
          name: "Channel",
          description: "ahRadioChannel.",
          role: SnmpTableColumnRole.Channel,
        },
        {
          oid: "1.3.6.1.4.1.26928.1.1.1.2.1.5.1.2",
          name: "TX Power",
          unit: "dBm",
          description: "ahRadioTxPower.",
          role: SnmpTableColumnRole.TxPower,
        },
        {
          oid: "1.3.6.1.4.1.26928.1.1.1.2.1.5.1.3",
          name: "Noise Floor",
          unit: "dBm",
          description:
            "ahRadioNoiseFloor - reported plus 256 (161 for -95 dBm) and read as dBm.",
          role: SnmpTableColumnRole.NoiseFloor,
          offset: -256,
        },
      ],
      maxRows: 8,
    },
    {
      key: "wifi_ssids",
      name: "SSIDs",
      description:
        "ahXIfTable - every interface with the SSID it broadcasts. Interfaces that broadcast none - every interface not in access mode, the mesh backhaul included, reports N/A - are left out.",
      kind: SnmpTableKind.WifiSsid,
      rowLabelColumnOids: [
        "1.3.6.1.4.1.26928.1.1.1.2.1.1.1.2",
        "1.3.6.1.4.1.26928.1.1.1.2.1.1.1.1",
      ],
      columns: [
        {
          oid: "1.3.6.1.4.1.26928.1.1.1.2.1.1.1.2",
          name: "SSID",
          description: "ahSSIDName.",
          role: SnmpTableColumnRole.Ssid,
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.26928.1.1.1.2.1.1.1.1",
          name: "Interface",
          description: "ahIfName - the radio's wifi0 broadcasts on wifi0.1 ...",
          valueType: SnmpTableValueType.Text,
        },
      ],
      maxRows: 64,
    },
  ],
};

/*
 * dot11ExtRadioType, the radio's configured 802.11 mode: a, a/n, a/n strict,
 * j and a/c run on 5 GHz; b, g, b/g, g/n, b/g/n and g/n strict on 2.4 GHz.
 */
const EXTREME_RADIO_TYPE_LABELS: Record<string, string> = {
  "0": "off",
  "1": "5 GHz",
  "2": "5 GHz",
  "3": "5 GHz",
  "4": "2.4 GHz",
  "5": "2.4 GHz",
  "6": "2.4 GHz",
  "7": "2.4 GHz",
  "8": "2.4 GHz",
  "9": "2.4 GHz",
  "10": "5 GHz",
  "11": "5 GHz",
  "12": "5 GHz",
};

const EXTREME_WIRELESS_CONTROLLER: SnmpVendorTemplate = {
  id: "extreme-wireless-controller",
  label: "Extreme Networks Wireless Controller (XIQ-C, ExtremeWireless)",
  description:
    "Access point and client counts, every access point it manages (active or not, clients), every radio (band, channel, width, noise floor, busy airtime) named by its access point, and every WLAN with its clients, from the HIPATH-WIRELESS MIBs that ExtremeCloud IQ Controller (formerly Extreme Campus Controller) and ExtremeWireless controllers implement.",
  oids: [
    {
      oid: "1.3.6.1.4.1.4329.15.3.5.1.1.0",
      name: "Access Points",
      description: "apCount - access points configured on the controller.",
    },
    {
      oid: "1.3.6.1.4.1.4329.15.3.5.2.1.0",
      name: "Active Access Points",
      description: "apActiveCount - access points connected to it now.",
    },
    {
      oid: "1.3.6.1.4.1.4329.15.3.6.1.0",
      name: "Wi-Fi Clients",
      description: "mobileUnitCount - clients associated through it.",
    },
  ],
  tables: [
    {
      key: "wifi_access_points",
      name: "Access Points",
      description:
        "apTable - one row per configured access point, with its clients from apStatsTable.",
      kind: SnmpTableKind.WifiAccessPoint,
      rowLabelColumnOids: ["1.3.6.1.4.1.4329.15.3.5.1.2.1.2"],
      columns: [
        {
          oid: "1.3.6.1.4.1.4329.15.3.5.1.2.1.22",
          name: "State",
          description:
            "apState - active while the access point is connected to this controller.",
          role: SnmpTableColumnRole.Status,
          valueLabels: { "1": "active", "2": "inactive" },
          healthyValues: ["1"],
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.5.2.2.1.14",
          name: "Clients",
          description: "apStatsMuCounts.",
          role: SnmpTableColumnRole.Clients,
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.5.1.2.1.14",
          name: "IP Address",
          description: "apIPAddress.",
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.5.1.2.1.4",
          name: "Serial Number",
          description: "apSerialNumber.",
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.5.1.2.1.7",
          name: "Software Version",
          description: "apSoftwareVersion.",
          valueType: SnmpTableValueType.Text,
        },
      ],
      maxRows: MAX_SNMP_TABLE_MAX_ROWS,
    },
    {
      key: "wifi_radios",
      name: "Wi-Fi Radios",
      description:
        "apRadioStatusTable and dot11ExtRadioStatsTable - one row per radio of every active access point, named by its interface (ifName: the access point's name, the radio and its mode). The controller reports the channel as its frequency in MHz; the channel width as 1, 2 or 4 times 20 MHz.",
      kind: SnmpTableKind.WifiRadio,
      rowLabelColumnOids: ["1.3.6.1.2.1.31.1.1.1.1"],
      // ifName names every interface of the controller; only radios are rows here.
      skipNameOnlyRows: true,
      columns: [
        {
          oid: "1.3.6.1.4.1.4329.15.3.1.4.3.1.1",
          name: "Band",
          description: "dot11ExtRadioType - the radio's 802.11 mode.",
          role: SnmpTableColumnRole.Band,
          valueType: SnmpTableValueType.Text,
          valueLabels: EXTREME_RADIO_TYPE_LABELS,
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.5.2.4.1.1",
          name: "Channel",
          description:
            "apRadioStatusChannel - the lowest 20 MHz channel in use; 0 when the radio is off.",
          role: SnmpTableColumnRole.Channel,
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.5.2.4.1.2",
          name: "Channel Width",
          unit: "MHz",
          description:
            "apRadioStatusChannelWidth - 1, 2 or 4 channels of 20 MHz, read as MHz.",
          role: SnmpTableColumnRole.ChannelWidth,
          scale: 20,
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.1.4.3.1.31",
          name: "Noise Floor",
          unit: "dBm",
          description:
            "dot11ExtRadioAvgNfCount - average over the last 30 seconds.",
          role: SnmpTableColumnRole.NoiseFloor,
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.1.4.3.1.39",
          name: "Busy Airtime",
          unit: "%",
          description:
            "dot11ExtRadioAvgBusyChPercentage - the time the channel was busy, averaged over the last 100 seconds.",
          role: SnmpTableColumnRole.Utilization,
        },
      ],
      maxRows: MAX_SNMP_TABLE_MAX_ROWS,
    },
    {
      key: "wifi_ssids",
      name: "WLANs",
      description:
        "wlanTable and wlanStatsTable - one row per WLAN service, with its SSID and clients. WDS and mesh services carry traffic between access points rather than clients' networks, and are left out.",
      kind: SnmpTableKind.WifiSsid,
      rowLabelColumnOids: ["1.3.6.1.4.1.4329.15.3.3.4.4.1.4"],
      columns: [
        {
          oid: "1.3.6.1.4.1.4329.15.3.3.4.4.1.5",
          name: "SSID",
          description: "wlanSSID.",
          role: SnmpTableColumnRole.Ssid,
          valueType: SnmpTableValueType.Text,
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.3.4.5.1.2",
          name: "Clients",
          description: "wlanStatsAssociatedClients.",
          role: SnmpTableColumnRole.Clients,
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.3.4.4.1.7",
          name: "Enabled",
          description: "wlanEnabled - TruthValue: 1 = yes, 2 = no.",
          valueLabels: { "1": "yes", "2": "no" },
        },
        {
          oid: "1.3.6.1.4.1.4329.15.3.3.4.4.1.3",
          name: "Service Type",
          description:
            "wlanServiceType - standard, third-party or remote. WDS (3) and mesh (6) services are left out. Text: a kind of service, not a number to chart.",
          valueType: SnmpTableValueType.Text,
          valueLabels: {
            "0": "standard",
            "3": "WDS",
            "4": "third-party",
            "5": "remote",
            "6": "mesh",
          },
        },
      ],
      maxRows: 64,
    },
  ],
};

const TPLINK_OMADA_EAP: SnmpVendorTemplate = {
  id: "tplink-omada-eap",
  label: "TP-Link Omada Access Points (EAP)",
  description:
    "The number of connected Wi-Fi clients, from TP-Link's EAP-CLIENT-MIB - the one Wi-Fi value Omada access points report over SNMP, and only on firmware that implements that MIB. Their radios, channels and SSIDs are only in the Omada Controller.",
  oids: [
    {
      oid: "1.3.6.1.4.1.11863.10.1.1.1.0",
      name: "Wi-Fi Clients",
      description: "clientCount - clients connected to the access point.",
    },
  ],
};

// Generic first (the safe default), then vendors alphabetically.
export const SnmpVendorTemplates: Array<SnmpVendorTemplate> = [
  HOST_RESOURCES,
  ARISTA,
  BROCADE_FOS,
  CAMBIUM_CNMATRIX,
  CAMBIUM_WIFI_AP,
  CISCO,
  CISCO_MDS,
  DELL_FORCE10,
  EXTREME_EXOS,
  EXTREME_FABRIC_ENGINE,
  EXTREME_IQ_ENGINE_AP,
  EXTREME_WIRELESS_CONTROLLER,
  FORTINET,
  HPE_PROCURVE,
  ARUBA_INSTANT,
  ARUBA_MOBILITY_CONTROLLER,
  HUAWEI,
  JUNIPER,
  MIKROTIK,
  PALO_ALTO,
  SOPHOS_SFOS,
  TPLINK_OMADA_EAP,
  UBIQUITI,
  UBIQUITI_UNIFI_AP,
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
  // Avaya/Nortel's RAPID-CITY arc, reported by older VSP / VOSS switches.
  2272: "Extreme Networks",
  2604: "Sophos",
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
  // Cyberoam, the arc Sophos firewalls reported before SFOS v18.
  21067: "Sophos",
  14823: "Aruba",
  14988: "MikroTik",
  17163: "Riverbed",
  17713: "Cambium Networks",
  22610: "Vyatta",
  24681: "QNAP",
  25461: "Palo Alto Networks",
  25506: "H3C",
  26543: "Yamaha",
  // Aerohive's arc, which Extreme's IQ Engine (HiveOS) access points report.
  26928: "Extreme Networks",
  /*
   * Meraki's arc: MX appliances, MS switches and MR access points polled
   * locally answer with it, and implement no ENTITY-MIB that could name their
   * maker instead (issue #4569).
   */
  29671: "Cisco Meraki",
  30065: "Arista",
  35098: "PICA8",
  41112: "Ubiquiti",
  47196: "OPNsense",
};

interface DeviceTemplateRule {
  templateId: string;
  enterprise?: number | undefined;
  // A sysObjectID arc the device's sysObjectID must equal or sit under.
  sysObjectIdPrefix?: string | undefined;
  /*
   * sysObjectIDs the device's must equal exactly: product models in an arc
   * other products share, as Cisco's cevChassis arc holds MDS, Nexus and
   * Catalyst chassis alike.
   */
  sysObjectIds?: ReadonlySet<string> | undefined;
  sysDescrPattern?: RegExp | undefined;
  /*
   * Who makes a device this rule matches, when its enterprise number says
   * something else (or nothing): older UniFi firmware answers with
   * Net-SNMP's arc, Extreme's wireless controllers with Siemens'.
   */
  vendorName?: string | undefined;
}

/*
 * A UniFi access point's sysDescr: its model, then its firmware version -
 * "UAP-nanoHD 6.0.21.13673", "U6-Pro 6.6.50.15098", "UK-Ultra 6.6.65.15248",
 * "U-LTE-Pro-EU 6.5.62.14789", "E7 *21". The version is required, so a host
 * whose description merely starts with "UK" is not taken for one.
 */
const UNIFI_ACCESS_POINT_SYS_DESCR: RegExp =
  /^(?:UAP|U6|U7|UK|U-LTE|E7)[A-Za-z0-9+-]* +[\d*]/;

/*
 * An IQ Engine (HiveOS) access point's sysDescr: "AP230, HiveOS 8.2r1
 * build-190112", "HiveAP330, HiveOS 6.5r8b ...", "AP4000, IQ Engine 10.7r1".
 * Aerohive's switches share the arc and the OS name ("SR2024P, HiveOS ..."),
 * and have no radios.
 */
const HIVEOS_ACCESS_POINT_SYS_DESCR: RegExp =
  /^(?:Hive)?AP[\w-]*, (?:HiveOS|IQ Engine)\b/;

/*
 * Cisco MDS 9000 chassis, as their sysObjectIDs report them: cevChassis
 * (1.3.6.1.4.1.9.12.3.1.3) values from CISCO-ENTITY-VENDORTYPE-OID-MIB. The
 * arc holds Nexus and Catalyst chassis too (a Catalyst 9400 is .1913), so
 * only these exact models are taken for MDS. A model newer than the list
 * is still recognised by its sysDescr (MDS_SYS_DESCR).
 */
const CISCO_CHASSIS_ARC: string = "1.3.6.1.4.1.9.12.3.1.3";

export const CISCO_MDS_CHASSIS_SYS_OBJECT_IDS: ReadonlySet<string> = new Set(
  [
    // MDS 9500 directors, and the 9200, 9100 and 9000 switches of SAN-OS.
    375, // MDS 9506
    376, // MDS 9509
    377, // MDS 9513
    380, // MDS 9216
    411, // MDS 9140
    414, // MDS 9120
    442, // MDS 9216A
    462, // MDS 9132 (DS-X9132-K9)
    463, // MDS 9116 (DS-X9116-K9)
    472, // MDS 9216i
    514, // MDS 9020
    587, // MDS 9124
    601, // Cisco 4Gb Fibre Channel Switch Module for IBM BladeCenter
    616, // MDS 9134
    651, // MDS 9222i
    // Current MDS 9000 switches and directors.
    1326, // MDS 9250i
    1327, // MDS 9710
    1420, // MDS 9706
    1491, // MDS 9148S
    1660, // MDS 9396S
    1683, // MDS 9718
    1894, // MDS 9132T
    1895, // MDS 9232U
    2054, // MDS 9148T
    2055, // MDS 9396T
    2402, // MDS 9220i
    2513, // MDS 9148V
    2514, // MDS 9124V
    2549, // MDS 9396V
    // IBM c-type: MDS sold as IBM Storage Networking.
    2173, // IBM SAN192C-6 (MDS 9706)
    2174, // IBM SAN384C-6 (MDS 9710)
    2175, // IBM SAN768C-6 (MDS 9718)
    2176, // IBM SAN50C-R (MDS 9250i)
    2177, // IBM SAN32C-6 (MDS 9132T)
    2257, // IBM SAN48C (MDS 9148T)
  ].map((model: number): string => {
    return `${CISCO_CHASSIS_ARC}.${model}`;
  }),
);

/*
 * An MDS's sysDescr names its platform after the OS: "Cisco NX-OS(tm)
 * m9100, Software (m9100-s6ek9-mz), Version 8.4(2c), ..." - m9100, m9200,
 * m9250, m9300, m9700 - and "SAN-OS(tm)" before NX-OS. Nexus says n9000,
 * n7000 or nothing of the kind, and never m9.
 */
const MDS_SYS_DESCR: RegExp = /\b(?:NX-OS|SAN-OS)\(tm\) m9\d{3}\b/i;

/*
 * Platforms an enterprise number alone cannot tell apart. Checked before the
 * enterprise map below, in order.
 */
const DEVICE_TEMPLATE_RULES: Array<DeviceTemplateRule> = [
  /*
   * Brocade's Fibre Channel switches and directors (fcSwitch,
   * 1.3.6.1.4.1.1588.2.1.1): Fabric OS, in switch or Access Gateway mode -
   * most report the bare 1588.2.1.1.1, newer ones their model under it.
   * Never the whole of 1588: VDX (1588.2.2) and SLX (1588.3.3) are Ethernet
   * switches with none of these MIBs.
   */
  {
    templateId: "brocade-fos",
    sysObjectIdPrefix: "1.3.6.1.4.1.1588.2.1.1",
  },
  // Cisco MDS 9000, matched before cisco-ios by its exact models...
  {
    templateId: "cisco-mds",
    sysObjectIds: CISCO_MDS_CHASSIS_SYS_OBJECT_IDS,
  },
  // ...and by its sysDescr, for a model newer than the list.
  {
    templateId: "cisco-mds",
    enterprise: 9,
    sysDescrPattern: MDS_SYS_DESCR,
  },
  {
    templateId: "extreme-fabric-engine",
    enterprise: 1916,
    sysDescrPattern: /fabric\s*engine|\bvoss\b|\bvsp\b|\bxa14[48]0\b/i,
  },
  {
    templateId: "cambium-wifi-ap",
    sysObjectIdPrefix: "1.3.6.1.4.1.17713.22",
  },
  {
    templateId: "cambium-cnmatrix",
    sysObjectIdPrefix: "1.3.6.1.4.1.17713.24",
  },
  /*
   * UniFi access points report Ubiquiti's bare arc (1.3.6.1.4.1.41112) on
   * current firmware and Net-SNMP's Linux arc (1.3.6.1.4.1.8072.3.2.10) on
   * older; only the sysDescr says it is an access point rather than an
   * EdgeRouter, or any other Linux host.
   */
  {
    templateId: "ubiquiti-unifi-ap",
    enterprise: 41112,
    sysDescrPattern: UNIFI_ACCESS_POINT_SYS_DESCR,
  },
  {
    templateId: "ubiquiti-unifi-ap",
    enterprise: 8072,
    sysDescrPattern: UNIFI_ACCESS_POINT_SYS_DESCR,
    vendorName: "Ubiquiti",
  },
  // Aruba's apProducts arc: Instant access points (their virtual controller answers).
  {
    templateId: "aruba-instant",
    sysObjectIdPrefix: "1.3.6.1.4.1.14823.1.2",
  },
  // Aruba's switchProducts arc: Mobility Controllers, Conductors and gateways.
  {
    templateId: "aruba-mobility-controller",
    sysObjectIdPrefix: "1.3.6.1.4.1.14823.1.1",
  },
  {
    templateId: "extreme-iq-engine-ap",
    enterprise: 26928,
    sysDescrPattern: HIVEOS_ACCESS_POINT_SYS_DESCR,
  },
  /*
   * HIPATH-WIRELESS-PRODUCTS: the wireless controllers Extreme took over
   * from Enterasys, still under Siemens' enterprise number - ExtremeCloud
   * IQ Controller ("Extreme Networks Wireless Controller - V2110 ...") and
   * ExtremeWireless.
   */
  {
    templateId: "extreme-wireless-controller",
    sysObjectIdPrefix: "1.3.6.1.4.1.4329.15",
    vendorName: "Extreme Networks",
  },
];

/*
 * sysObjectID template routing: enterprise number → vendor template id.
 * Name-only vendors (e.g. Dell 674, F5 3375) deliberately have no entry —
 * their platforms need MIBs we do not ship a template for yet, and callers
 * fall back to the generic Host Resources template.
 */
const ENTERPRISE_TEMPLATE_IDS: Record<number, string> = {
  9: "cisco-ios",
  11: "hpe-procurve",
  // EXOS by default; Fabric Engine on the same arc is told apart by sysDescr.
  1916: "extreme-exos",
  2272: "extreme-fabric-engine",
  2604: "sophos-sfos",
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
  // Routers and switches; UniFi access points are told apart by sysDescr.
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
   * Who makes a device, from its sysObjectID and sysDescr: the vendor a
   * device rule names when one matches (a UniFi access point answering
   * with Net-SNMP's arc is Ubiquiti's), otherwise the enterprise number's.
   */
  public static getVendorName(data: {
    sysObjectId?: string | undefined;
    sysDescr?: string | undefined;
  }): string | undefined {
    const rule: DeviceTemplateRule | undefined =
      SnmpVendorTemplateUtil.findDeviceRule(data);

    return (
      rule?.vendorName ||
      SnmpVendorTemplateUtil.getVendorNameBySysObjectId(data.sysObjectId)
    );
  }

  /*
   * Suggests the vendor OID template matching a device's sysObjectID.
   * Returns undefined when no vendor-specific template exists — callers can
   * fall back to the generic Host Resources template, which most
   * Linux-based appliances answer.
   *
   * Prefer matchDevice when the sysDescr is known: some platforms share an
   * enterprise arc with a different OS and can only be told apart by it.
   */
  public static matchBySysObjectId(
    sysObjectId: string | undefined,
  ): SnmpVendorTemplate | undefined {
    return SnmpVendorTemplateUtil.matchDevice({ sysObjectId: sysObjectId });
  }

  /*
   * The vendor template for a device, from its sysObjectID and - where an
   * enterprise arc hosts more than one platform - its sysDescr. Rules are
   * tried first, most specific first; the enterprise number is the
   * fallback.
   *
   * Fabric Engine is the case the rules exist for: on universal hardware it
   * reports enterprise 1916 exactly as EXOS does on the same switch model,
   * and only its sysDescr ("7520-48Y-8C-FabricEngine (9.0.4.0)") says which
   * OS is running. Its health objects live in the RAPID-CITY MIB either way,
   * so walking it with the EXOS template would collect nothing.
   */
  public static matchDevice(data: {
    sysObjectId?: string | undefined;
    sysDescr?: string | undefined;
  }): SnmpVendorTemplate | undefined {
    const enterpriseNumber: number | undefined =
      SnmpVendorTemplateUtil.getEnterpriseNumber(
        SnmpOidListUtil.normalizeOid(data.sysObjectId),
      );

    if (enterpriseNumber === undefined) {
      return undefined;
    }

    const rule: DeviceTemplateRule | undefined =
      SnmpVendorTemplateUtil.findDeviceRule(data);

    if (rule) {
      return SnmpVendorTemplateUtil.getById(rule.templateId);
    }

    const templateId: string | undefined =
      ENTERPRISE_TEMPLATE_IDS[enterpriseNumber];

    return templateId ? SnmpVendorTemplateUtil.getById(templateId) : undefined;
  }

  // The first device rule a device matches; the rules are ordered most specific first.
  private static findDeviceRule(data: {
    sysObjectId?: string | undefined;
    sysDescr?: string | undefined;
  }): DeviceTemplateRule | undefined {
    const sysObjectId: string = SnmpOidListUtil.normalizeOid(data.sysObjectId);
    const sysDescr: string = data.sysDescr || "";

    const enterpriseNumber: number | undefined =
      SnmpVendorTemplateUtil.getEnterpriseNumber(sysObjectId);

    if (enterpriseNumber === undefined) {
      return undefined;
    }

    return DEVICE_TEMPLATE_RULES.find((rule: DeviceTemplateRule): boolean => {
      if (
        rule.enterprise !== undefined &&
        rule.enterprise !== enterpriseNumber
      ) {
        return false;
      }

      if (
        rule.sysObjectIdPrefix &&
        sysObjectId !== rule.sysObjectIdPrefix &&
        !sysObjectId.startsWith(`${rule.sysObjectIdPrefix}.`)
      ) {
        return false;
      }

      if (rule.sysObjectIds && !rule.sysObjectIds.has(sysObjectId)) {
        return false;
      }

      return !rule.sysDescrPattern || rule.sysDescrPattern.test(sysDescr);
    });
  }

  /*
   * Merges a template's tables into an existing list by key, skipping any
   * key already present - the table twin of mergeOids.
   */
  public static mergeTables(
    existing: Array<SnmpTableDefinition>,
    templateId: string,
  ): Array<SnmpTableDefinition> {
    const template: SnmpVendorTemplate | undefined =
      SnmpVendorTemplateUtil.getById(templateId);

    if (!template || !template.tables) {
      return existing;
    }

    const seen: Set<string> = new Set(
      existing.map((table: SnmpTableDefinition) => {
        return table.key;
      }),
    );

    const merged: Array<SnmpTableDefinition> = [...existing];

    for (const table of template.tables) {
      if (!seen.has(table.key)) {
        merged.push(table);
        seen.add(table.key);
      }
    }

    return merged;
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
