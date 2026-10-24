import SnmpOid from "../../Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil, {
  MAX_OID_NAME_LENGTH,
} from "../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import {
  SnmpTableColumn,
  SnmpTableDefinition,
} from "../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";

/*
 * Names for the OIDs an SNMP walk reads (issue #5184), from the MIBs
 * OneUptime knows: the standard MIBs nearly every agent implements (system,
 * interfaces, IP, TCP, UDP, SNMP, bridge, host resources, entity, entity
 * sensors, LLDP, Net-SNMP's UCD MIB), and the vendor health templates the
 * product ships, whose OIDs are named and described where they are defined.
 *
 * "1.3.6.1.2.1.2.2.1.2.3" reads as `ifDescr.3` (IF-MIB), and
 * "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1" as the Cisco template's "CPU 5-min %".
 * An OID no known object covers is named after the nearest group it sits
 * in - `enterprises.9.9.48.1.1.1.5.1`, with the vendor the enterprise
 * number belongs to - the way snmpwalk names an OID whose MIB it lacks.
 *
 * Pure data and string work, shared by the dashboard (the walk's results)
 * and anything else that wants a readable name for an OID.
 */

export interface SnmpOidDescription {
  // The OID as a MIB names it: "ifDescr.3", "sysUpTime.0".
  name?: string | undefined;
  // The MIB module the name comes from: "IF-MIB".
  module?: string | undefined;
  // The object's name without its instance: "ifDescr".
  objectName?: string | undefined;
  // What follows the object's OID: the row index of a column, 0 of a scalar.
  instance?: string | undefined;
  /*
   * True when no known object covers the OID and the name is the nearest
   * known group's, followed by the arcs under it ("enterprises.9.9.48...").
   */
  isGroupName?: boolean | undefined;
  /*
   * A vendor health template that collects this exact OID: the name the
   * template gives the value ("CPU 5-min %"), and the template.
   */
  templateValueName?: string | undefined;
  templateLabel?: string | undefined;
  /*
   * A vendor template that walks this OID's column as an SNMP table: the
   * table's and the column's names.
   */
  templateTableName?: string | undefined;
  templateColumnName?: string | undefined;
  // Who the enterprise number of an OID under enterprises belongs to.
  vendorName?: string | undefined;
}

interface KnownObject {
  oid: string;
  name: string;
  module: string;
  // A group (a subtree of objects), named only for OIDs nothing closer names.
  isGroup: boolean;
}

interface TemplateValue {
  name: string;
  templateLabel: string;
}

interface TemplateColumn {
  tableName: string;
  columnName: string;
  templateLabel: string;
}

const ENTERPRISES_OID: string = "1.3.6.1.4.1";

function objects(
  module: string,
  base: string,
  names: Record<number, string>,
): Array<KnownObject> {
  return Object.keys(names).map((arc: string): KnownObject => {
    return {
      oid: `${base}.${arc}`,
      name: names[Number(arc)]!,
      module: module,
      isGroup: false,
    };
  });
}

function group(module: string, oid: string, name: string): KnownObject {
  return { oid: oid, name: name, module: module, isGroup: true };
}

/*
 * Groups first: the subtrees whose name stands in for OIDs no object below
 * names. Objects after: scalars and table columns, which name an OID with
 * its instance. Tables and their entries are groups too - a walk never
 * returns their OIDs, but the arcs under an unknown column read better as
 * `ifEntry.25.3` than as `interfaces.2.1.25.3`.
 */
const KNOWN_OBJECTS: Array<KnownObject> = [
  group("SNMPv2-SMI", "1.3.6.1", "internet"),
  group("SNMPv2-SMI", "1.3.6.1.2.1", "mib-2"),
  group("SNMPv2-SMI", "1.3.6.1.2.1.10", "transmission"),
  group("SNMPv2-SMI", ENTERPRISES_OID, "enterprises"),
  group("SNMPv2-SMI", "1.3.6.1.6.3", "snmpModules"),

  // SNMPv2-MIB: system
  group("SNMPv2-MIB", "1.3.6.1.2.1.1", "system"),
  ...objects("SNMPv2-MIB", "1.3.6.1.2.1.1", {
    1: "sysDescr",
    2: "sysObjectID",
    3: "sysUpTime",
    4: "sysContact",
    5: "sysName",
    6: "sysLocation",
    7: "sysServices",
    8: "sysORLastChange",
  }),
  group("SNMPv2-MIB", "1.3.6.1.2.1.1.9", "sysORTable"),
  group("SNMPv2-MIB", "1.3.6.1.2.1.1.9.1", "sysOREntry"),
  ...objects("SNMPv2-MIB", "1.3.6.1.2.1.1.9.1", {
    1: "sysORIndex",
    2: "sysORID",
    3: "sysORDescr",
    4: "sysORUpTime",
  }),

  // IF-MIB: interfaces and ifTable
  group("IF-MIB", "1.3.6.1.2.1.2", "interfaces"),
  ...objects("IF-MIB", "1.3.6.1.2.1.2", { 1: "ifNumber" }),
  group("IF-MIB", "1.3.6.1.2.1.2.2", "ifTable"),
  group("IF-MIB", "1.3.6.1.2.1.2.2.1", "ifEntry"),
  ...objects("IF-MIB", "1.3.6.1.2.1.2.2.1", {
    1: "ifIndex",
    2: "ifDescr",
    3: "ifType",
    4: "ifMtu",
    5: "ifSpeed",
    6: "ifPhysAddress",
    7: "ifAdminStatus",
    8: "ifOperStatus",
    9: "ifLastChange",
    10: "ifInOctets",
    11: "ifInUcastPkts",
    12: "ifInNUcastPkts",
    13: "ifInDiscards",
    14: "ifInErrors",
    15: "ifInUnknownProtos",
    16: "ifOutOctets",
    17: "ifOutUcastPkts",
    18: "ifOutNUcastPkts",
    19: "ifOutDiscards",
    20: "ifOutErrors",
    21: "ifOutQLen",
    22: "ifSpecific",
  }),

  // RFC1213-MIB: at
  group("RFC1213-MIB", "1.3.6.1.2.1.3", "at"),
  group("RFC1213-MIB", "1.3.6.1.2.1.3.1", "atTable"),
  group("RFC1213-MIB", "1.3.6.1.2.1.3.1.1", "atEntry"),
  ...objects("RFC1213-MIB", "1.3.6.1.2.1.3.1.1", {
    1: "atIfIndex",
    2: "atPhysAddress",
    3: "atNetAddress",
  }),

  // IP-MIB: ip
  group("IP-MIB", "1.3.6.1.2.1.4", "ip"),
  ...objects("IP-MIB", "1.3.6.1.2.1.4", {
    1: "ipForwarding",
    2: "ipDefaultTTL",
    3: "ipInReceives",
    4: "ipInHdrErrors",
    5: "ipInAddrErrors",
    6: "ipForwDatagrams",
    7: "ipInUnknownProtos",
    8: "ipInDiscards",
    9: "ipInDelivers",
    10: "ipOutRequests",
    11: "ipOutDiscards",
    12: "ipOutNoRoutes",
    13: "ipReasmTimeout",
    14: "ipReasmReqds",
    15: "ipReasmOKs",
    16: "ipReasmFails",
    17: "ipFragOKs",
    18: "ipFragFails",
    19: "ipFragCreates",
    23: "ipRoutingDiscards",
  }),
  group("IP-MIB", "1.3.6.1.2.1.4.20", "ipAddrTable"),
  group("IP-MIB", "1.3.6.1.2.1.4.20.1", "ipAddrEntry"),
  ...objects("IP-MIB", "1.3.6.1.2.1.4.20.1", {
    1: "ipAdEntAddr",
    2: "ipAdEntIfIndex",
    3: "ipAdEntNetMask",
    4: "ipAdEntBcastAddr",
    5: "ipAdEntReasmMaxSize",
  }),
  group("RFC1213-MIB", "1.3.6.1.2.1.4.21", "ipRouteTable"),
  group("RFC1213-MIB", "1.3.6.1.2.1.4.21.1", "ipRouteEntry"),
  ...objects("RFC1213-MIB", "1.3.6.1.2.1.4.21.1", {
    1: "ipRouteDest",
    2: "ipRouteIfIndex",
    3: "ipRouteMetric1",
    4: "ipRouteMetric2",
    5: "ipRouteMetric3",
    6: "ipRouteMetric4",
    7: "ipRouteNextHop",
    8: "ipRouteType",
    9: "ipRouteProto",
    10: "ipRouteAge",
    11: "ipRouteMask",
    12: "ipRouteMetric5",
    13: "ipRouteInfo",
  }),
  group("IP-MIB", "1.3.6.1.2.1.4.22", "ipNetToMediaTable"),
  group("IP-MIB", "1.3.6.1.2.1.4.22.1", "ipNetToMediaEntry"),
  ...objects("IP-MIB", "1.3.6.1.2.1.4.22.1", {
    1: "ipNetToMediaIfIndex",
    2: "ipNetToMediaPhysAddress",
    3: "ipNetToMediaNetAddress",
    4: "ipNetToMediaType",
  }),
  group("IP-FORWARD-MIB", "1.3.6.1.2.1.4.24", "ipForward"),
  group("IP-MIB", "1.3.6.1.2.1.4.31", "ipTrafficStats"),
  group("IP-MIB", "1.3.6.1.2.1.4.34", "ipAddressTable"),
  group("IP-MIB", "1.3.6.1.2.1.4.35", "ipNetToPhysicalTable"),

  // IP-MIB: icmp
  group("IP-MIB", "1.3.6.1.2.1.5", "icmp"),
  ...objects("IP-MIB", "1.3.6.1.2.1.5", {
    1: "icmpInMsgs",
    2: "icmpInErrors",
    3: "icmpInDestUnreachs",
    4: "icmpInTimeExcds",
    5: "icmpInParmProbs",
    6: "icmpInSrcQuenchs",
    7: "icmpInRedirects",
    8: "icmpInEchos",
    9: "icmpInEchoReps",
    10: "icmpInTimestamps",
    11: "icmpInTimestampReps",
    12: "icmpInAddrMasks",
    13: "icmpInAddrMaskReps",
    14: "icmpOutMsgs",
    15: "icmpOutErrors",
    16: "icmpOutDestUnreachs",
    17: "icmpOutTimeExcds",
    18: "icmpOutParmProbs",
    19: "icmpOutSrcQuenchs",
    20: "icmpOutRedirects",
    21: "icmpOutEchos",
    22: "icmpOutEchoReps",
    23: "icmpOutTimestamps",
    24: "icmpOutTimestampReps",
    25: "icmpOutAddrMasks",
    26: "icmpOutAddrMaskReps",
  }),

  // TCP-MIB: tcp
  group("TCP-MIB", "1.3.6.1.2.1.6", "tcp"),
  ...objects("TCP-MIB", "1.3.6.1.2.1.6", {
    1: "tcpRtoAlgorithm",
    2: "tcpRtoMin",
    3: "tcpRtoMax",
    4: "tcpMaxConn",
    5: "tcpActiveOpens",
    6: "tcpPassiveOpens",
    7: "tcpAttemptFails",
    8: "tcpEstabResets",
    9: "tcpCurrEstab",
    10: "tcpInSegs",
    11: "tcpOutSegs",
    12: "tcpRetransSegs",
    14: "tcpInErrs",
    15: "tcpOutRsts",
    17: "tcpHCInSegs",
    18: "tcpHCOutSegs",
  }),
  group("TCP-MIB", "1.3.6.1.2.1.6.13", "tcpConnTable"),
  group("TCP-MIB", "1.3.6.1.2.1.6.13.1", "tcpConnEntry"),
  ...objects("TCP-MIB", "1.3.6.1.2.1.6.13.1", {
    1: "tcpConnState",
    2: "tcpConnLocalAddress",
    3: "tcpConnLocalPort",
    4: "tcpConnRemAddress",
    5: "tcpConnRemPort",
  }),
  group("TCP-MIB", "1.3.6.1.2.1.6.19", "tcpConnectionTable"),
  group("TCP-MIB", "1.3.6.1.2.1.6.20", "tcpListenerTable"),

  // UDP-MIB: udp
  group("UDP-MIB", "1.3.6.1.2.1.7", "udp"),
  ...objects("UDP-MIB", "1.3.6.1.2.1.7", {
    1: "udpInDatagrams",
    2: "udpNoPorts",
    3: "udpInErrors",
    4: "udpOutDatagrams",
    8: "udpHCInDatagrams",
    9: "udpHCOutDatagrams",
  }),
  group("UDP-MIB", "1.3.6.1.2.1.7.5", "udpTable"),
  group("UDP-MIB", "1.3.6.1.2.1.7.5.1", "udpEntry"),
  ...objects("UDP-MIB", "1.3.6.1.2.1.7.5.1", {
    1: "udpLocalAddress",
    2: "udpLocalPort",
  }),
  group("UDP-MIB", "1.3.6.1.2.1.7.7", "udpEndpointTable"),

  // EtherLike-MIB: dot3StatsTable
  group("EtherLike-MIB", "1.3.6.1.2.1.10.7", "dot3"),
  group("EtherLike-MIB", "1.3.6.1.2.1.10.7.2", "dot3StatsTable"),
  group("EtherLike-MIB", "1.3.6.1.2.1.10.7.2.1", "dot3StatsEntry"),
  ...objects("EtherLike-MIB", "1.3.6.1.2.1.10.7.2.1", {
    1: "dot3StatsIndex",
    2: "dot3StatsAlignmentErrors",
    3: "dot3StatsFCSErrors",
    4: "dot3StatsSingleCollisionFrames",
    5: "dot3StatsMultipleCollisionFrames",
    6: "dot3StatsSQETestErrors",
    7: "dot3StatsDeferredTransmissions",
    8: "dot3StatsLateCollisions",
    9: "dot3StatsExcessiveCollisions",
    10: "dot3StatsInternalMacTransmitErrors",
    11: "dot3StatsCarrierSenseErrors",
    13: "dot3StatsFrameTooLongs",
    16: "dot3StatsInternalMacReceiveErrors",
    18: "dot3StatsSymbolErrors",
    19: "dot3StatsDuplexStatus",
  }),

  // SNMPv2-MIB: snmp
  group("SNMPv2-MIB", "1.3.6.1.2.1.11", "snmp"),
  ...objects("SNMPv2-MIB", "1.3.6.1.2.1.11", {
    1: "snmpInPkts",
    2: "snmpOutPkts",
    3: "snmpInBadVersions",
    4: "snmpInBadCommunityNames",
    5: "snmpInBadCommunityUses",
    6: "snmpInASNParseErrs",
    8: "snmpInTooBigs",
    9: "snmpInNoSuchNames",
    10: "snmpInBadValues",
    11: "snmpInReadOnlys",
    12: "snmpInGenErrs",
    13: "snmpInTotalReqVars",
    14: "snmpInTotalSetVars",
    15: "snmpInGetRequests",
    16: "snmpInGetNexts",
    17: "snmpInSetRequests",
    18: "snmpInGetResponses",
    19: "snmpInTraps",
    20: "snmpOutTooBigs",
    21: "snmpOutNoSuchNames",
    22: "snmpOutBadValues",
    24: "snmpOutGenErrs",
    25: "snmpOutGetRequests",
    26: "snmpOutGetNexts",
    27: "snmpOutSetRequests",
    28: "snmpOutGetResponses",
    29: "snmpOutTraps",
    30: "snmpEnableAuthenTraps",
    31: "snmpSilentDrops",
    32: "snmpProxyDrops",
  }),

  // BRIDGE-MIB and Q-BRIDGE-MIB
  group("BRIDGE-MIB", "1.3.6.1.2.1.17", "dot1dBridge"),
  group("BRIDGE-MIB", "1.3.6.1.2.1.17.1", "dot1dBase"),
  ...objects("BRIDGE-MIB", "1.3.6.1.2.1.17.1", {
    1: "dot1dBaseBridgeAddress",
    2: "dot1dBaseNumPorts",
    3: "dot1dBaseType",
  }),
  group("BRIDGE-MIB", "1.3.6.1.2.1.17.1.4", "dot1dBasePortTable"),
  group("BRIDGE-MIB", "1.3.6.1.2.1.17.1.4.1", "dot1dBasePortEntry"),
  ...objects("BRIDGE-MIB", "1.3.6.1.2.1.17.1.4.1", {
    1: "dot1dBasePort",
    2: "dot1dBasePortIfIndex",
    3: "dot1dBasePortCircuit",
    4: "dot1dBasePortDelayExceededDiscards",
    5: "dot1dBasePortMtuExceededDiscards",
  }),
  group("BRIDGE-MIB", "1.3.6.1.2.1.17.2", "dot1dStp"),
  ...objects("BRIDGE-MIB", "1.3.6.1.2.1.17.2", {
    1: "dot1dStpProtocolSpecification",
    2: "dot1dStpPriority",
    3: "dot1dStpTimeSinceTopologyChange",
    4: "dot1dStpTopChanges",
    5: "dot1dStpDesignatedRoot",
    6: "dot1dStpRootCost",
    7: "dot1dStpRootPort",
  }),
  group("BRIDGE-MIB", "1.3.6.1.2.1.17.2.15", "dot1dStpPortTable"),
  group("BRIDGE-MIB", "1.3.6.1.2.1.17.2.15.1", "dot1dStpPortEntry"),
  ...objects("BRIDGE-MIB", "1.3.6.1.2.1.17.2.15.1", {
    1: "dot1dStpPort",
    2: "dot1dStpPortPriority",
    3: "dot1dStpPortState",
    4: "dot1dStpPortEnable",
    5: "dot1dStpPortPathCost",
  }),
  group("BRIDGE-MIB", "1.3.6.1.2.1.17.4", "dot1dTp"),
  ...objects("BRIDGE-MIB", "1.3.6.1.2.1.17.4", {
    1: "dot1dTpLearnedEntryDiscards",
    2: "dot1dTpAgingTime",
  }),
  group("BRIDGE-MIB", "1.3.6.1.2.1.17.4.3", "dot1dTpFdbTable"),
  group("BRIDGE-MIB", "1.3.6.1.2.1.17.4.3.1", "dot1dTpFdbEntry"),
  ...objects("BRIDGE-MIB", "1.3.6.1.2.1.17.4.3.1", {
    1: "dot1dTpFdbAddress",
    2: "dot1dTpFdbPort",
    3: "dot1dTpFdbStatus",
  }),
  group("Q-BRIDGE-MIB", "1.3.6.1.2.1.17.7", "qBridgeMIB"),
  group("Q-BRIDGE-MIB", "1.3.6.1.2.1.17.7.1.2.2", "dot1qTpFdbTable"),
  group("Q-BRIDGE-MIB", "1.3.6.1.2.1.17.7.1.2.2.1", "dot1qTpFdbEntry"),
  ...objects("Q-BRIDGE-MIB", "1.3.6.1.2.1.17.7.1.2.2.1", {
    1: "dot1qTpFdbAddress",
    2: "dot1qTpFdbPort",
    3: "dot1qTpFdbStatus",
  }),
  group("Q-BRIDGE-MIB", "1.3.6.1.2.1.17.7.1.4.3", "dot1qVlanStaticTable"),
  group("Q-BRIDGE-MIB", "1.3.6.1.2.1.17.7.1.4.3.1", "dot1qVlanStaticEntry"),
  ...objects("Q-BRIDGE-MIB", "1.3.6.1.2.1.17.7.1.4.3.1", {
    1: "dot1qVlanStaticName",
    2: "dot1qVlanStaticEgressPorts",
    3: "dot1qVlanForbiddenEgressPorts",
    4: "dot1qVlanStaticUntaggedPorts",
    5: "dot1qVlanStaticRowStatus",
  }),

  // HOST-RESOURCES-MIB
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25", "host"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.1", "hrSystem"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.1", {
    1: "hrSystemUptime",
    2: "hrSystemDate",
    3: "hrSystemInitialLoadDevice",
    4: "hrSystemInitialLoadParameters",
    5: "hrSystemNumUsers",
    6: "hrSystemProcesses",
    7: "hrSystemMaxProcesses",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.2", "hrStorage"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.2", {
    2: "hrMemorySize",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.2.3", "hrStorageTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.2.3.1", "hrStorageEntry"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.2.3.1", {
    1: "hrStorageIndex",
    2: "hrStorageType",
    3: "hrStorageDescr",
    4: "hrStorageAllocationUnits",
    5: "hrStorageSize",
    6: "hrStorageUsed",
    7: "hrStorageAllocationFailures",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3", "hrDevice"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.2", "hrDeviceTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.2.1", "hrDeviceEntry"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.2.1", {
    1: "hrDeviceIndex",
    2: "hrDeviceType",
    3: "hrDeviceDescr",
    4: "hrDeviceID",
    5: "hrDeviceStatus",
    6: "hrDeviceErrors",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.3", "hrProcessorTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.3.1", "hrProcessorEntry"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.3.1", {
    1: "hrProcessorFrwID",
    2: "hrProcessorLoad",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.4", "hrNetworkTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.4.1", "hrNetworkEntry"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.4.1", {
    1: "hrNetworkIfIndex",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.6", "hrDiskStorageTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.6.1", "hrDiskStorageEntry"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.6.1", {
    1: "hrDiskStorageAccess",
    2: "hrDiskStorageMedia",
    3: "hrDiskStorageRemoveble",
    4: "hrDiskStorageCapacity",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.7", "hrPartitionTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.3.8", "hrFSTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.4", "hrSWRun"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.4", { 1: "hrSWOSIndex" }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.4.2", "hrSWRunTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.4.2.1", "hrSWRunEntry"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.4.2.1", {
    1: "hrSWRunIndex",
    2: "hrSWRunName",
    3: "hrSWRunID",
    4: "hrSWRunPath",
    5: "hrSWRunParameters",
    6: "hrSWRunType",
    7: "hrSWRunStatus",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.5", "hrSWRunPerf"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.5.1", "hrSWRunPerfTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.5.1.1", "hrSWRunPerfEntry"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.5.1.1", {
    1: "hrSWRunPerfCPU",
    2: "hrSWRunPerfMem",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.6", "hrSWInstalled"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.6", {
    1: "hrSWInstalledLastChange",
    2: "hrSWInstalledLastUpdateTime",
  }),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.6.3", "hrSWInstalledTable"),
  group("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.6.3.1", "hrSWInstalledEntry"),
  ...objects("HOST-RESOURCES-MIB", "1.3.6.1.2.1.25.6.3.1", {
    1: "hrSWInstalledIndex",
    2: "hrSWInstalledName",
    3: "hrSWInstalledID",
    4: "hrSWInstalledType",
    5: "hrSWInstalledDate",
  }),

  // IF-MIB: ifMIB (ifXTable and friends)
  group("IF-MIB", "1.3.6.1.2.1.31", "ifMIB"),
  group("IF-MIB", "1.3.6.1.2.1.31.1", "ifMIBObjects"),
  ...objects("IF-MIB", "1.3.6.1.2.1.31.1", {
    5: "ifTableLastChange",
    6: "ifStackLastChange",
  }),
  group("IF-MIB", "1.3.6.1.2.1.31.1.1", "ifXTable"),
  group("IF-MIB", "1.3.6.1.2.1.31.1.1.1", "ifXEntry"),
  ...objects("IF-MIB", "1.3.6.1.2.1.31.1.1.1", {
    1: "ifName",
    2: "ifInMulticastPkts",
    3: "ifInBroadcastPkts",
    4: "ifOutMulticastPkts",
    5: "ifOutBroadcastPkts",
    6: "ifHCInOctets",
    7: "ifHCInUcastPkts",
    8: "ifHCInMulticastPkts",
    9: "ifHCInBroadcastPkts",
    10: "ifHCOutOctets",
    11: "ifHCOutUcastPkts",
    12: "ifHCOutMulticastPkts",
    13: "ifHCOutBroadcastPkts",
    14: "ifLinkUpDownTrapEnable",
    15: "ifHighSpeed",
    16: "ifPromiscuousMode",
    17: "ifConnectorPresent",
    18: "ifAlias",
    19: "ifCounterDiscontinuityTime",
  }),
  group("IF-MIB", "1.3.6.1.2.1.31.1.2", "ifStackTable"),
  group("IF-MIB", "1.3.6.1.2.1.31.1.2.1", "ifStackEntry"),
  ...objects("IF-MIB", "1.3.6.1.2.1.31.1.2.1", { 3: "ifStackStatus" }),

  // ENTITY-MIB
  group("ENTITY-MIB", "1.3.6.1.2.1.47", "entityMIB"),
  group("ENTITY-MIB", "1.3.6.1.2.1.47.1.1.1", "entPhysicalTable"),
  group("ENTITY-MIB", "1.3.6.1.2.1.47.1.1.1.1", "entPhysicalEntry"),
  ...objects("ENTITY-MIB", "1.3.6.1.2.1.47.1.1.1.1", {
    1: "entPhysicalIndex",
    2: "entPhysicalDescr",
    3: "entPhysicalVendorType",
    4: "entPhysicalContainedIn",
    5: "entPhysicalClass",
    6: "entPhysicalParentRelPos",
    7: "entPhysicalName",
    8: "entPhysicalHardwareRev",
    9: "entPhysicalFirmwareRev",
    10: "entPhysicalSoftwareRev",
    11: "entPhysicalSerialNum",
    12: "entPhysicalMfgName",
    13: "entPhysicalModelName",
    14: "entPhysicalAlias",
    15: "entPhysicalAssetID",
    16: "entPhysicalIsFRU",
    17: "entPhysicalMfgDate",
    18: "entPhysicalUris",
  }),
  ...objects("ENTITY-MIB", "1.3.6.1.2.1.47.1.4", { 1: "entLastChangeTime" }),

  // ENTITY-SENSOR-MIB
  group("ENTITY-SENSOR-MIB", "1.3.6.1.2.1.99", "entitySensorMIB"),
  group("ENTITY-SENSOR-MIB", "1.3.6.1.2.1.99.1.1", "entPhySensorTable"),
  group("ENTITY-SENSOR-MIB", "1.3.6.1.2.1.99.1.1.1", "entPhySensorEntry"),
  ...objects("ENTITY-SENSOR-MIB", "1.3.6.1.2.1.99.1.1.1", {
    1: "entPhySensorType",
    2: "entPhySensorScale",
    3: "entPhySensorPrecision",
    4: "entPhySensorValue",
    5: "entPhySensorOperStatus",
    6: "entPhySensorUnitsDisplay",
    7: "entPhySensorValueTimeStamp",
    8: "entPhySensorValueUpdateRate",
  }),

  // LLDP-MIB
  group("LLDP-MIB", "1.0.8802.1.1.2", "lldpMIB"),
  group("LLDP-MIB", "1.0.8802.1.1.2.1.3", "lldpLocalSystemData"),
  ...objects("LLDP-MIB", "1.0.8802.1.1.2.1.3", {
    1: "lldpLocChassisIdSubtype",
    2: "lldpLocChassisId",
    3: "lldpLocSysName",
    4: "lldpLocSysDesc",
    5: "lldpLocSysCapSupported",
    6: "lldpLocSysCapEnabled",
  }),
  group("LLDP-MIB", "1.0.8802.1.1.2.1.3.7", "lldpLocPortTable"),
  group("LLDP-MIB", "1.0.8802.1.1.2.1.3.7.1", "lldpLocPortEntry"),
  ...objects("LLDP-MIB", "1.0.8802.1.1.2.1.3.7.1", {
    1: "lldpLocPortNum",
    2: "lldpLocPortIdSubtype",
    3: "lldpLocPortId",
    4: "lldpLocPortDesc",
  }),
  group("LLDP-MIB", "1.0.8802.1.1.2.1.4", "lldpRemoteSystemsData"),
  group("LLDP-MIB", "1.0.8802.1.1.2.1.4.1", "lldpRemTable"),
  group("LLDP-MIB", "1.0.8802.1.1.2.1.4.1.1", "lldpRemEntry"),
  ...objects("LLDP-MIB", "1.0.8802.1.1.2.1.4.1.1", {
    1: "lldpRemTimeMark",
    2: "lldpRemLocalPortNum",
    3: "lldpRemIndex",
    4: "lldpRemChassisIdSubtype",
    5: "lldpRemChassisId",
    6: "lldpRemPortIdSubtype",
    7: "lldpRemPortId",
    8: "lldpRemPortDesc",
    9: "lldpRemSysName",
    10: "lldpRemSysDesc",
    11: "lldpRemSysCapSupported",
    12: "lldpRemSysCapEnabled",
  }),
  group("LLDP-MIB", "1.0.8802.1.1.2.1.4.2", "lldpRemManAddrTable"),

  // SNMP engine and USM statistics
  group("SNMP-FRAMEWORK-MIB", "1.3.6.1.6.3.10.2.1", "snmpEngine"),
  ...objects("SNMP-FRAMEWORK-MIB", "1.3.6.1.6.3.10.2.1", {
    1: "snmpEngineID",
    2: "snmpEngineBoots",
    3: "snmpEngineTime",
    4: "snmpEngineMaxMessageSize",
  }),
  ...objects("SNMP-MPD-MIB", "1.3.6.1.6.3.11.2.1", {
    1: "snmpUnknownSecurityModels",
    2: "snmpInvalidMsgs",
    3: "snmpUnknownPDUHandlers",
  }),
  group("SNMP-USER-BASED-SM-MIB", "1.3.6.1.6.3.15.1.1", "usmStats"),
  ...objects("SNMP-USER-BASED-SM-MIB", "1.3.6.1.6.3.15.1.1", {
    1: "usmStatsUnsupportedSecLevels",
    2: "usmStatsNotInTimeWindows",
    3: "usmStatsUnknownUserNames",
    4: "usmStatsUnknownEngineIDs",
    5: "usmStatsWrongDigests",
    6: "usmStatsDecryptionErrors",
  }),

  // UCD-SNMP-MIB (Net-SNMP agents: Linux hosts, many appliances)
  group("UCD-SNMP-MIB", "1.3.6.1.4.1.2021", "ucdavis"),
  group("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.4", "memory"),
  ...objects("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.4", {
    1: "memIndex",
    2: "memErrorName",
    3: "memTotalSwap",
    4: "memAvailSwap",
    5: "memTotalReal",
    6: "memAvailReal",
    11: "memTotalFree",
    12: "memMinimumSwap",
    13: "memShared",
    14: "memBuffer",
    15: "memCached",
    100: "memSwapError",
    101: "memSwapErrorMsg",
  }),
  group("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.9", "dskTable"),
  group("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.9.1", "dskEntry"),
  ...objects("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.9.1", {
    1: "dskIndex",
    2: "dskPath",
    3: "dskDevice",
    4: "dskMinimum",
    5: "dskMinPercent",
    6: "dskTotal",
    7: "dskAvail",
    8: "dskUsed",
    9: "dskPercent",
    10: "dskPercentNode",
    100: "dskErrorFlag",
    101: "dskErrorMsg",
  }),
  group("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.10", "laTable"),
  group("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.10.1", "laEntry"),
  ...objects("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.10.1", {
    1: "laIndex",
    2: "laNames",
    3: "laLoad",
    4: "laConfig",
    5: "laLoadInt",
    6: "laLoadFloat",
    100: "laErrorFlag",
    101: "laErrMessage",
  }),
  group("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.11", "systemStats"),
  ...objects("UCD-SNMP-MIB", "1.3.6.1.4.1.2021.11", {
    1: "ssIndex",
    2: "ssErrorName",
    3: "ssSwapIn",
    4: "ssSwapOut",
    5: "ssIOSent",
    6: "ssIOReceive",
    7: "ssSysInterrupts",
    8: "ssSysContext",
    9: "ssCpuUser",
    10: "ssCpuSystem",
    11: "ssCpuIdle",
    50: "ssCpuRawUser",
    51: "ssCpuRawNice",
    52: "ssCpuRawSystem",
    53: "ssCpuRawIdle",
    54: "ssCpuRawWait",
    55: "ssCpuRawKernel",
    56: "ssCpuRawInterrupt",
    57: "ssIORawSent",
    58: "ssIORawReceived",
    59: "ssRawInterrupts",
    60: "ssRawContexts",
    61: "ssCpuRawSoftIRQ",
    62: "ssRawSwapIn",
    63: "ssRawSwapOut",
  }),
  group("NET-SNMP-MIB", "1.3.6.1.4.1.8072", "netSnmp"),
];

const OBJECTS_BY_OID: Map<string, KnownObject> = new Map(
  KNOWN_OBJECTS.map((entry: KnownObject): [string, KnownObject] => {
    return [entry.oid, entry];
  }),
);

/*
 * Built on first use: the vendor templates' values and table columns, by
 * OID. The first template to name an OID names it.
 */
let templateValuesByOid: Map<string, TemplateValue> | undefined = undefined;
let templateColumnsByOid: Map<string, TemplateColumn> | undefined = undefined;

function loadTemplates(): void {
  if (templateValuesByOid && templateColumnsByOid) {
    return;
  }

  const values: Map<string, TemplateValue> = new Map();
  const columns: Map<string, TemplateColumn> = new Map();

  for (const template of SnmpVendorTemplateUtil.getAll()) {
    for (const oid of template.oids) {
      const normalized: string = SnmpOidListUtil.normalizeOid(oid.oid);

      if (oid.name && !values.has(normalized)) {
        values.set(normalized, {
          name: oid.name,
          templateLabel: template.label,
        });
      }
    }

    for (const table of template.tables || []) {
      addTableColumns(columns, template, table);
    }
  }

  templateValuesByOid = values;
  templateColumnsByOid = columns;
}

function addTableColumns(
  columns: Map<string, TemplateColumn>,
  template: SnmpVendorTemplate,
  table: SnmpTableDefinition,
): void {
  for (const column of table.columns as Array<SnmpTableColumn>) {
    const normalized: string = SnmpOidListUtil.normalizeOid(column.oid);

    if (!columns.has(normalized)) {
      columns.set(normalized, {
        tableName: table.name,
        columnName: column.name,
        templateLabel: template.label,
      });
    }
  }
}

/*
 * The longest prefix of `oid` (including `oid` itself) for which `lookup`
 * answers, and what follows it. OIDs are matched arc by arc, so
 * "1.3.6.1.2.1.1.10" is never read as under "1.3.6.1.2.1.1.1".
 */
function longestKnownPrefix<T>(
  oid: string,
  lookup: (prefix: string) => T | undefined,
): { entry: T; prefix: string; rest: string } | undefined {
  const arcs: Array<string> = oid.split(".");

  for (let length: number = arcs.length; length > 0; length--) {
    const prefix: string = arcs.slice(0, length).join(".");
    const entry: T | undefined = lookup(prefix);

    if (entry !== undefined) {
      return {
        entry: entry,
        prefix: prefix,
        rest: arcs.slice(length).join("."),
      };
    }
  }

  return undefined;
}

export default class SnmpOidNameUtil {
  /*
   * Everything OneUptime knows about an OID. An OID it knows nothing about
   * (outside every group above) gets an empty description: the walk shows
   * it by its number alone.
   */
  public static describe(oid: string): SnmpOidDescription {
    const normalized: string = SnmpOidListUtil.normalizeOid(oid);

    if (!SnmpOidListUtil.isValidOid(normalized)) {
      return {};
    }

    const description: SnmpOidDescription = {};

    const known:
      | { entry: KnownObject; prefix: string; rest: string }
      | undefined = longestKnownPrefix(normalized, (prefix: string) => {
      return OBJECTS_BY_OID.get(prefix);
    });

    if (known) {
      description.module = known.entry.module;

      if (known.entry.isGroup) {
        description.isGroupName = true;
        description.name = known.rest
          ? `${known.entry.name}.${known.rest}`
          : known.entry.name;
      } else {
        description.objectName = known.entry.name;
        description.instance = known.rest || undefined;
        description.name = known.rest
          ? `${known.entry.name}.${known.rest}`
          : known.entry.name;
      }
    }

    loadTemplates();

    const templateValue: TemplateValue | undefined =
      templateValuesByOid!.get(normalized);

    if (templateValue) {
      description.templateValueName = templateValue.name;
      description.templateLabel = templateValue.templateLabel;
    }

    const templateColumn: { entry: TemplateColumn } | undefined =
      longestKnownPrefix(normalized, (prefix: string) => {
        // A column names the cells under it, never itself.
        return prefix === normalized
          ? undefined
          : templateColumnsByOid!.get(prefix);
      });

    if (templateColumn) {
      description.templateTableName = templateColumn.entry.tableName;
      description.templateColumnName = templateColumn.entry.columnName;
      description.templateLabel =
        description.templateLabel || templateColumn.entry.templateLabel;
    }

    if (normalized.startsWith(`${ENTERPRISES_OID}.`)) {
      const vendorName: string | undefined =
        SnmpVendorTemplateUtil.getVendorNameBySysObjectId(normalized);

      if (vendorName) {
        description.vendorName = vendorName;
      }
    }

    return description;
  }

  /*
   * The name an OID gets when it is added to a device's health OIDs from a
   * walk: the vendor template's name for the value when one names it ("CPU
   * 5-min %"), else its MIB name with its instance ("hrProcessorLoad.1"),
   * else none - a group's name ("enterprises.9.9...") says nothing the OID
   * does not. Kept within the health OID name limit.
   */
  public static suggestedHealthOidName(oid: string): string | undefined {
    const description: SnmpOidDescription = SnmpOidNameUtil.describe(oid);

    const name: string | undefined =
      description.templateValueName ||
      (description.isGroupName ? undefined : description.name);

    return name ? name.substring(0, MAX_OID_NAME_LENGTH) : undefined;
  }

  /*
   * The health OID a walk's row becomes: the OID, and the suggested name
   * when there is one.
   */
  public static toHealthOid(oid: string): SnmpOid {
    const normalized: string = SnmpOidListUtil.normalizeOid(oid);
    const name: string | undefined =
      SnmpOidNameUtil.suggestedHealthOidName(normalized);

    return name ? { oid: normalized, name: name } : { oid: normalized };
  }
}
