import SnmpAuthProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpTrap from "../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import { SnmpTrapReceiverUser } from "../../../Types/Probe/SnmpTrapReceiver";

/*
 * RECORDED SNMP TRAPS FROM SENDERS THAT ARE NOT DEVICES YET (OneUptime
 * issue #11407).
 *
 * Sent by Net-SNMP 5.9.4's own snmptrap (Alpine 3.22, net-snmp-tools), each
 * from a loopback address of its own (--clientaddr), and captured as the
 * datagrams arrived:
 *
 *   snmptrap -v 2c -c public --clientaddr=127.0.12.20 127.0.0.1:<port> '' \
 *     1.3.6.1.4.1.1588.2.1.1.1.0.3 \
 *     1.3.6.1.4.1.1588.2.1.1.1.6.2.1.4.5 i 2 \
 *     1.3.6.1.4.1.1588.2.1.1.1.6.2.1.36.5 s port5
 *   snmptrap -v 2c -c public --clientaddr=127.0.12.21 127.0.0.1:<port> '' \
 *     1.3.6.1.6.3.1.1.5.3 1.3.6.1.2.1.2.2.1.1.7 i 7
 *   snmptrap -v 3 -u branch-default -l authPriv -a SHA -A branch-default-auth-passphrase \
 *     -x AES -X branch-default-priv-passphrase -e 800000090300AABBCC120022 \
 *     --clientaddr=127.0.12.22 127.0.0.1:<port> '' 1.3.6.1.4.1.9.9.43.2.0.1 \
 *     1.3.6.1.4.1.9.9.43.1.1.6.1.3.7 i 1 1.3.6.1.4.1.9.9.43.1.1.6.1.4.7 i 3 \
 *     1.3.6.1.4.1.9.9.43.1.1.6.1.5.7 i 4
 *
 * Three senders a project has not added yet: a Brocade switch's port state
 * change (SW-MIB swFCPortScn) - an enterprise trap, which is no event, so it
 * is in Logs only - a linkDown, which is an event, and a Cisco router's
 * configuration change (CISCO-CONFIG-MAN-MIB ciscoConfigManEvent) signed
 * with its site's default SNMPv3 credentials. The probe's
 * SnmpTrapReceiverUnknownSenders replays them into a real receiver; the
 * server's ProcessSnmpTrapUnknownSenders hands what the probe forwards to
 * the real trap ingest and the real trap log writer, and the Events page's
 * card lists each sender from those logs, with Add as device.
 */

export const UNKNOWN_SENDER_PROJECT_ID: string =
  "11407000-0000-4000-8000-00000000ac0e";
export const UNKNOWN_SENDER_SITE_ID: string =
  "11407000-0000-4000-8000-000000000501";

export type UnknownSenderKey = "brocadePortChange" | "linkDown" | "ciscoConfig";

export interface RecordedUnknownSenderTrap {
  key: UnknownSenderKey;
  // The loopback address it was sent from.
  source: string;
  datagram: string;
}

// The datagrams as they arrived, in the order sent.
export const RECORDED_UNKNOWN_SENDER_TRAPS: Array<RecordedUnknownSenderTrap> = [
  {
    key: "brocadePortChange",
    source: "127.0.12.20",
    datagram:
      "307c02010104067075626c6963a76f020441435ffd0201000201003061301006082b06010201010300430406d0eec0301b060a2b060106030101040100060d2b060104018c34020101010003301506102b060104018c34020101010602010405020102301906102b060104018c340201010106020124050405706f727435",
  },
  {
    key: "linkDown",
    source: "127.0.12.21",
    datagram:
      "305702010104067075626c6963a74a020478873ccf020100020100303c301006082b06010201010300430406d0eee23017060a2b06010603010104010006092b0601060301010503300f060a2b060102010202010107020107",
  },
  {
    key: "ciscoConfig",
    source: "127.0.12.22",
    datagram:
      "3081f002010330110204490e6254020300ffe30401030201030441303f040c800000090300aabbcc120022020101020406d0ef04040e6272616e63682d64656661756c74040cc7e9be540dd43127ec27aaf90408bdfdd03b8b96c6320481949f2578e877999f0740e723724c2f5781316e778dc2eea99cd9faa5e28085f943f654f1d688c2ad774785dd8930a268ad966b734f9f64baf29b9987a095aaad1a5b0647aa575365d65b2a26edaaf92c5ad2494cc16f638595eca23ee8e5926621604f38ec320459923a42b372f8d5517d3a3ecb0fec79ab565eb854e31754e2260609a30b77230380de59f5549ce020e8238fc3dd",
  },
];

/*
 * The one SNMPv3 user the probe is handed for these: the site's default
 * credential profile, held by the site and its project - the site's own
 * Default Probe takes it before a device at the site is added (#11174).
 */
export const UNKNOWN_SENDER_RECEIVER_USERS: Array<SnmpTrapReceiverUser> = [
  {
    userName: "branch-default",
    securityLevel: SnmpSecurityLevel.AuthPriv,
    authProtocol: SnmpAuthProtocol.SHA,
    authKey: "branch-default-auth-passphrase",
    privProtocol: SnmpPrivProtocol.AES,
    privKey: "branch-default-priv-passphrase",
    addresses: [],
    heldBy: {
      projectIds: [UNKNOWN_SENDER_PROJECT_ID],
      deviceIds: [],
      siteIds: [UNKNOWN_SENDER_SITE_ID],
    },
  },
];

// sysUpTime.0: snmptrap sends its host's own uptime, which no test fixes.
export const SYS_UP_TIME_OID: string = "1.3.6.1.2.1.1.3.0";

const SNMP_TRAP_OID: string = "1.3.6.1.6.3.1.1.4.1.0";

/*
 * What the probe forwards for each recorded trap - what OneUptime's trap
 * ingest is handed - but the time it was received and the sysUpTime the
 * sender read for itself.
 */
export function forwardedUnknownSenderTrap(
  key: UnknownSenderKey,
): Omit<SnmpTrap, "receivedAt"> {
  switch (key) {
    case "brocadePortChange":
      return {
        sourceIpAddress: "127.0.12.20",
        trapOid: "1.3.6.1.4.1.1588.2.1.1.1.0.3",
        snmpVersion: "2c",
        varbinds: [
          { oid: SNMP_TRAP_OID, value: "1.3.6.1.4.1.1588.2.1.1.1.0.3" },
          { oid: "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.4.5", value: "2" },
          { oid: "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.36.5", value: "port5" },
        ],
        community: "public",
      };
    case "linkDown":
      return {
        sourceIpAddress: "127.0.12.21",
        trapOid: "1.3.6.1.6.3.1.1.5.3",
        snmpVersion: "2c",
        varbinds: [
          { oid: SNMP_TRAP_OID, value: "1.3.6.1.6.3.1.1.5.3" },
          { oid: "1.3.6.1.2.1.2.2.1.1.7", value: "7" },
        ],
        community: "public",
      };
    case "ciscoConfig":
      return {
        sourceIpAddress: "127.0.12.22",
        trapOid: "1.3.6.1.4.1.9.9.43.2.0.1",
        snmpVersion: "3",
        varbinds: [
          { oid: SNMP_TRAP_OID, value: "1.3.6.1.4.1.9.9.43.2.0.1" },
          { oid: "1.3.6.1.4.1.9.9.43.1.1.6.1.3.7", value: "1" },
          { oid: "1.3.6.1.4.1.9.9.43.1.1.6.1.4.7", value: "3" },
          { oid: "1.3.6.1.4.1.9.9.43.1.1.6.1.5.7", value: "4" },
        ],
        isInform: false,
        securityName: "branch-default",
        securityLevel: SnmpSecurityLevel.AuthPriv,
        engineId: "800000090300AABBCC120022",
        signedBy: UNKNOWN_SENDER_RECEIVER_USERS[0]!.heldBy!,
      };
  }
}
