/*
 * SNMPv3 ENGINE DISCOVERY, AS NET-SNMP 5.9.4 DOES IT (OneUptime issue
 * #11405).
 *
 * Recorded on Alpine 3.22 (net-snmp, net-snmp-tools):
 *
 *   - NET_SNMP_DISCOVERY_REQUEST: the first datagram Net-SNMP's own
 *     `snmpget -v3 -u nobody -l noAuthNoPriv <agent> sysName.0` sends - its
 *     engine discovery (RFC 3414 section 4), captured as it left;
 *   - NET_SNMP_DISCOVERY_REPORT: what Net-SNMP's snmpd answered when that
 *     datagram was sent to it, with the agent configured as
 *
 *       exactEngineID 0x80001F8803AABBCC114050
 *       rocommunity public 127.0.0.1
 *       rocommunity restricted 127.0.0.1 -V systemonly
 *
 *     a Report of usmStatsUnknownEngineIDs, from its own engine.
 *
 * The same agent answered snmpEngineID.0 over v2c `public` with
 * 80 00 1F 88 03 AA BB CC 11 40 50, over v2c `restricted` with No Such
 * Object (in the same response as sysName.0), and over v1 `restricted` with
 * a whole-PDU noSuchName: why the probe asks for it in a GET of its own.
 */

export const NET_SNMP_AGENT_ENGINE_ID: string = "80001F8803AABBCC114050";

export const NET_SNMP_DISCOVERY_MSG_ID: number = 0x6e2ebab6;
export const NET_SNMP_DISCOVERY_REQUEST_ID: number = 0x49dd11d7;

export const NET_SNMP_DISCOVERY_REQUEST: string =
  "303e020103301102046e2ebab6020300ffe30401040201030410300e0400020100020100040004000400301404000400a00e020449dd11d70201000201003000";

export const NET_SNMP_DISCOVERY_REPORT: string =
  "3065020103301102046e2ebab6020300ffe3040100020103041b3019040b80001f8803aabbcc1140500201010201190400040004003030040b80001f8803aabbcc1140500400a81f020449dd11d70201000201003011300f060a2b060106030f01010400410102";
