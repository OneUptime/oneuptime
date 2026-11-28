import SnmpAuthProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "../../../Types/Probe/SnmpTrapReceiver";

/*
 * RECORDED SNMPv3 TRAPS A PROBE REFUSES, FROM DEVICES NAMED BY DNS NAMES
 * (OneUptime issue #11406).
 *
 * Sent by Net-SNMP 5.9.4's own snmptrap (Alpine 3.22, net-snmp-tools), each
 * from a loopback address of its own (--clientaddr), and captured as the
 * datagrams arrived:
 *
 *   snmptrap -v 3 -u acme-core -l authPriv -a SHA -A acme-core-auth-passphrase \
 *     -x AES -X acme-core-priv-passphrase -e 800000090300AABBCC110006 \
 *     --clientaddr=127.0.11.6 127.0.0.1:<port> '' \
 *     1.3.6.1.6.3.1.1.5.3 1.3.6.1.2.1.2.2.1.1.3 i 3
 *   snmptrap -v 3 -u acme-edge -l authPriv -a SHA-256 -A acme-edge-old-auth-passphrase \
 *     -x AES-256 -X acme-edge-priv-passphrase -e 800000090300AABBCC110007 \
 *     --clientaddr=127.0.11.7 ... ifIndex 4
 *   (globex-dist from 127.0.11.8, nat-member from 127.0.11.9 and scanner
 *   from 127.0.11.10 the same way as acme-core, each with its own engine)
 *
 * The probe is handed one of these users only: Acme's edge firewall's, with
 * the passphrase Acme typed in since (DNS_NAMED_RECEIVER_USERS) - the
 * firewall still signs with the old one. So the probe refuses all five: the
 * edge firewall's with a wrong digest, the rest as unknown users
 * (RECORDED_DNS_NAMED_REFUSALS). The probe's SnmpTrapReceiverDnsNamedDevices
 * replays them into a real receiver; the server's suites hand what the probe
 * then reports to the report route (ProbeIngestSnmpTrapReceiverDnsNames),
 * which must find each refusal's devices by their DNS names - and give a
 * refusal from an address two projects use to nobody.
 */

export const DNS_NAMED_ACME_PROJECT_ID: string =
  "11406000-0000-4000-8000-00000000ac0e";
export const DNS_NAMED_GLOBEX_PROJECT_ID: string =
  "11406000-0000-4000-8000-000000060be8";

export type DnsNamedDeviceKey =
  | "acmeCore"
  | "acmeEdge"
  | "globexDist"
  | "acmeBranch"
  | "globexNat"
  | "acmeLab"
  | "globexLab";

export interface DnsNamedDevice {
  id: string;
  projectId: string;
  name: string;
  // As it was added: a DNS name, or an address typed in.
  hostname: string;
  // What its DNS name resolves to; none for an address typed in.
  resolvesTo: Array<string>;
}

/*
 * The devices on the global probe the five come to, two projects' (each
 * suite picks those it needs):
 *
 *   - Acme's core switch and edge firewall, added by their DNS names, which
 *     resolve to the addresses they send from (127.0.11.6, 127.0.11.7);
 *   - Globex's distribution switch, added by its DNS name (127.0.11.8);
 *   - Acme's branch router, added by the address 127.0.11.9 - which
 *     Globex's NAT name resolves to as well: an address two projects use;
 *   - Acme's and Globex's lab switches, whose names both resolve to
 *     127.0.11.10: two projects' names for one address.
 */
export const DNS_NAMED_DEVICES: Record<DnsNamedDeviceKey, DnsNamedDevice> = {
  acmeCore: {
    id: "11406000-0000-4000-8000-000000000a01",
    projectId: DNS_NAMED_ACME_PROJECT_ID,
    name: "acme core switch",
    hostname: "core-sw-01.acme.example",
    resolvesTo: ["127.0.11.6"],
  },
  acmeEdge: {
    id: "11406000-0000-4000-8000-000000000a02",
    projectId: DNS_NAMED_ACME_PROJECT_ID,
    name: "acme edge firewall",
    hostname: "edge-fw.acme.example",
    resolvesTo: ["127.0.11.7"],
  },
  globexDist: {
    id: "11406000-0000-4000-8000-000000000b01",
    projectId: DNS_NAMED_GLOBEX_PROJECT_ID,
    name: "globex distribution switch",
    hostname: "dist-sw.globex.example",
    resolvesTo: ["127.0.11.8"],
  },
  acmeBranch: {
    id: "11406000-0000-4000-8000-000000000a03",
    projectId: DNS_NAMED_ACME_PROJECT_ID,
    name: "acme branch router",
    hostname: "127.0.11.9",
    resolvesTo: [],
  },
  globexNat: {
    id: "11406000-0000-4000-8000-000000000b02",
    projectId: DNS_NAMED_GLOBEX_PROJECT_ID,
    name: "globex nat",
    hostname: "nat.globex.example",
    resolvesTo: ["127.0.11.9"],
  },
  acmeLab: {
    id: "11406000-0000-4000-8000-000000000a04",
    projectId: DNS_NAMED_ACME_PROJECT_ID,
    name: "acme lab switch",
    hostname: "lab-sw.acme.example",
    resolvesTo: ["127.0.11.10"],
  },
  globexLab: {
    id: "11406000-0000-4000-8000-000000000b03",
    projectId: DNS_NAMED_GLOBEX_PROJECT_ID,
    name: "globex lab switch",
    hostname: "lab.globex.example",
    resolvesTo: ["127.0.11.10"],
  },
};

// The one user the probe is handed: Acme's edge firewall's, as Acme set it now.
export const DNS_NAMED_RECEIVER_USERS: Array<SnmpTrapReceiverUser> = [
  {
    userName: "acme-edge",
    securityLevel: SnmpSecurityLevel.AuthPriv,
    authProtocol: SnmpAuthProtocol.SHA256,
    authKey: "acme-edge-auth-passphrase",
    privProtocol: SnmpPrivProtocol.AES256,
    privKey: "acme-edge-priv-passphrase",
    addresses: [],
    heldBy: {
      projectIds: [DNS_NAMED_ACME_PROJECT_ID],
      deviceIds: [DNS_NAMED_DEVICES.acmeEdge.id],
      siteIds: [],
    },
  },
];

export interface RecordedRefusedTrap {
  // The loopback address it was sent from.
  source: string;
  userName: string;
  // Why the probe refuses it, with DNS_NAMED_RECEIVER_USERS.
  reason: SnmpTrapRefusalReason;
  datagram: string;
}

// The datagrams as they arrived, in the order sent.
export const RECORDED_DNS_NAMED_REFUSALS: Array<RecordedRefusedTrap> = [
  {
    source: "127.0.11.6",
    userName: "acme-core",
    reason: SnmpTrapRefusalReason.UnknownUser,
    datagram:
      "3081b9020103301102043426c1ef020300ffe3040103020103043c303a040c800000090300aabbcc110006020101020406d0ee17040961636d652d636f7265040cd0adb2a8b2eb31bb1ae592f104080fec0ac9eafa004b0463df4e22e4dcb1c161f1fddd9f6f92dacd473d88b91762cca83ba68b29b51717a99969ccdb71de386041e352820481be6f6163d8bdeb12936471dcb9a3fd2e45df52914384c3253c62f994796e0bec2a1ed86c31043a68ad2df0c3b17bdce18a34b49dfe",
  },
  {
    source: "127.0.11.7",
    userName: "acme-edge",
    reason: SnmpTrapRefusalReason.WrongDigest,
    datagram:
      "3081c50201033011020434eef0a2020300ffe304010302010304483046040c800000090300aabbcc110007020101020406d0ee39040961636d652d656467650418a28c3c7af00f1646898315d53c006c03ab29b502559144e10408e49efaf9e893281e046346ad0aeea186672dcf07c4fb1a135cc35a1517bf478e062f4402bb8e6efca381d62175219d37c5b750b251f00db2149568ebf491625817f32ed7b7dd4902e81e8e0bc771a9bfb6bbdcdf9ae445edc201bf4a073e1e67c22fbaeea1f93ca94847674028",
  },
  {
    source: "127.0.11.8",
    userName: "globex-dist",
    reason: SnmpTrapRefusalReason.UnknownUser,
    datagram:
      "3081bb0201033011020442f3c6cf020300ffe3040103020103043e303c040c800000090300aabbcc110008020101020406d0ee5b040b676c6f6265782d64697374040cd6634947f27d1cd7503122bd04082122723a931d748b0463245e82c86ee5f02c418eeca106088552403e9ebb9d1ecbb50f91a8424f96714196869cbef316b91cb829ea521335b2ad99f3c038f6243f5ec13b1128b3d9eb8f147fa4503edaa0cad5c21edc5a9c19a90f4d81b1ee8074b386d9bdd12b4208faeecd3d",
  },
  {
    source: "127.0.11.9",
    userName: "nat-member",
    reason: SnmpTrapRefusalReason.UnknownUser,
    datagram:
      "3081ba02010330110204271f20c8020300ffe3040103020103043d303b040c800000090300aabbcc110009020101020406d0ee7d040a6e61742d6d656d626572040cdfab8cb559fda5abf6daa7680408fa13ab7c92dba52c04630ff4d9b6e834573361d7eca23395e0244d126fe13c58228bd500f96550d2550468551a3c83d06534f63d8879ea84dd816f04dacf8ddc04d940a468fe8015a114403ea72b19f086612360d1ea69539acea8c1514cdfb38afea392598fba61f953dbd8be",
  },
  {
    source: "127.0.11.10",
    userName: "scanner",
    reason: SnmpTrapRefusalReason.UnknownUser,
    datagram:
      "3081b7020103301102042715ae2c020300ffe3040103020103043a3038040c800000090300aabbcc11000a020101020406d0ee9f04077363616e6e6572040cd86a3ef8fc7ce6814b58c3470408c454770f2073364804630717ab0d9c9ca8709f4b8ed8f8afdedf3f2aab12a4c843bb8200fd303918c8609d81f728daffa3274f48b1f7fe99b22311b63c7d0c66e639949edf669cdc41958fcc8a9397a5f9f6c4d3be61404c8597e3cc37900d7d705fc6c8e97980c1988eaa0f91",
  },
];

export const DNS_NAMED_REFUSALS_SEEN_AT: string = "2026-11-28T09:00:00.000Z";

/*
 * What the probe reports of the five, once each - as its receiver counts
 * them (SnmpTrapReceiverDnsNamedDevices holds the receiver to it) - seen at
 * one time, so a server suite can hand it over as the probe posts it.
 */
export function refusedDnsNamedTraps(): Array<SnmpTrapRefusal> {
  return RECORDED_DNS_NAMED_REFUSALS.map(
    (recorded: RecordedRefusedTrap): SnmpTrapRefusal => {
      return {
        sourceAddress: recorded.source,
        reason: recorded.reason,
        userName: recorded.userName,
        count: 1,
        firstSeenAt: DNS_NAMED_REFUSALS_SEEN_AT,
        lastSeenAt: DNS_NAMED_REFUSALS_SEEN_AT,
      };
    },
  );
}

export function dnsNamedProbeReport(): SnmpTrapReceiverReport {
  return {
    isEnabled: true,
    port: 162,
    engineId: "8000B98380A1B2C3D4E5F60718293A4B",
    userCount: DNS_NAMED_RECEIVER_USERS.length,
    refusals: refusedDnsNamedTraps(),
  };
}

// The address each device's DNS name resolves to, as a resolver would say it.
export function resolveDnsNamedDevice(hostname: string): Array<string> {
  const device: DnsNamedDevice | undefined = Object.values(
    DNS_NAMED_DEVICES,
  ).find((candidate: DnsNamedDevice): boolean => {
    return candidate.hostname.toLowerCase() === hostname.trim().toLowerCase();
  });

  if (!device) {
    const error: Error & { code?: string } = new Error(
      `getaddrinfo ENOTFOUND ${hostname}`,
    );
    error.code = "ENOTFOUND";
    throw error;
  }

  return [...device.resolvesTo];
}
