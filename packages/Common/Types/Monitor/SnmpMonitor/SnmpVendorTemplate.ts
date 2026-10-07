import SnmpOid from "./SnmpOid";
import SnmpOidListUtil from "./SnmpOidListUtil";
import {
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableValueType,
} from "./SnmpTable";

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

// Generic first (the safe default), then vendors alphabetically.
export const SnmpVendorTemplates: Array<SnmpVendorTemplate> = [
  HOST_RESOURCES,
  ARISTA,
  CAMBIUM_CNMATRIX,
  CAMBIUM_WIFI_AP,
  CISCO,
  DELL_FORCE10,
  EXTREME_EXOS,
  EXTREME_FABRIC_ENGINE,
  FORTINET,
  HPE_PROCURVE,
  HUAWEI,
  JUNIPER,
  MIKROTIK,
  PALO_ALTO,
  SOPHOS_SFOS,
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
  sysDescrPattern?: RegExp | undefined;
}

/*
 * Platforms an enterprise number alone cannot tell apart. Checked before the
 * enterprise map below, in order.
 */
const DEVICE_TEMPLATE_RULES: Array<DeviceTemplateRule> = [
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
    const sysObjectId: string = SnmpOidListUtil.normalizeOid(data.sysObjectId);
    const sysDescr: string = data.sysDescr || "";

    const enterpriseNumber: number | undefined =
      SnmpVendorTemplateUtil.getEnterpriseNumber(sysObjectId);

    if (enterpriseNumber === undefined) {
      return undefined;
    }

    for (const rule of DEVICE_TEMPLATE_RULES) {
      if (
        rule.enterprise !== undefined &&
        rule.enterprise !== enterpriseNumber
      ) {
        continue;
      }

      if (
        rule.sysObjectIdPrefix &&
        sysObjectId !== rule.sysObjectIdPrefix &&
        !sysObjectId.startsWith(`${rule.sysObjectIdPrefix}.`)
      ) {
        continue;
      }

      if (rule.sysDescrPattern && !rule.sysDescrPattern.test(sysDescr)) {
        continue;
      }

      return SnmpVendorTemplateUtil.getById(rule.templateId);
    }

    const templateId: string | undefined =
      ENTERPRISE_TEMPLATE_IDS[enterpriseNumber];

    return templateId ? SnmpVendorTemplateUtil.getById(templateId) : undefined;
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
