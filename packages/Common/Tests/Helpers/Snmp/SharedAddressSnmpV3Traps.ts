import SnmpAuthProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpTrap from "../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import { SnmpTrapReceiverUser } from "../../../Types/Probe/SnmpTrapReceiver";

/*
 * RECORDED SNMPv3 TRAPS FROM FOUR DEVICES THAT SHARE ONE ADDRESS (OneUptime
 * issue #11172).
 *
 * Sent by Net-SNMP 5.9.4's own snmptrap (Alpine 3.22, net-snmp-tools), the
 * stack most network gear's agents are built on or tested against, all from
 * 127.0.0.1 - the one address they share, as devices behind a NAT or blades
 * behind their chassis do - and captured as the datagrams arrived:
 *
 *   snmptrap -v 3 -u blade-1-monitor -l authPriv -a SHA -A blade-1-auth-passphrase \
 *     -x AES -X blade-1-priv-passphrase -e 800000090300AABBCC000001 \
 *     127.0.0.1:<port> '' 1.3.6.1.6.3.1.1.5.3 1.3.6.1.2.1.2.2.1.1.3 i 3
 *   snmptrap -v 3 -u blade-2-monitor -l authPriv -a SHA-256 -A blade-2-auth-passphrase \
 *     -x AES-256 -X blade-2-priv-passphrase -e 800000090300AABBCC000002 \
 *     127.0.0.1:<port> '' 1.3.6.1.6.3.1.1.5.3 1.3.6.1.2.1.2.2.1.1.4 i 4
 *   snmptrap -v 3 -u site-default -l authPriv -a SHA -A site-default-auth-passphrase \
 *     -x AES -X site-default-priv-passphrase -e 800000090300AABBCC000003 \
 *     127.0.0.1:<port> '' 1.3.6.1.6.3.1.1.5.3 1.3.6.1.2.1.2.2.1.1.5 i 5
 *   (the same for site-switch-2, with -e 800000090300AABBCC000004 and ifIndex 6)
 *
 * Two blades signed by users of their own, and two switches that share
 * their site's default credential and are told apart by their engines
 * alone. The probe's suites replay the datagrams into a real receiver
 * (SnmpTrapReceiverSharedAddress); the server's feed what the probe
 * forwards for them to the trap ingest (ProcessSnmpTrapSharedAddress), which
 * must put each on its own device - where matching by address alone put all
 * four on every device at the address.
 */

export const SHARED_ADDRESS: string = "127.0.0.1";

export const SHARED_ADDRESS_PROJECT_ID: string =
  "11720000-0000-4000-8000-00000000ac0e";

export const SHARED_ADDRESS_SITE_ID: string =
  "11720000-0000-4000-8000-000000000501";

export type SharedAddressDeviceKey =
  | "blade1"
  | "blade2"
  | "siteSwitch1"
  | "siteSwitch2";

export interface SharedAddressDevice {
  id: string;
  name: string;
  // The engine its agent sends as, and its SNMPv3 polls read.
  engineId: string;
  userName: string;
  // The interface its recorded linkDown names.
  ifIndex: number;
}

export const SHARED_ADDRESS_DEVICES: Record<
  SharedAddressDeviceKey,
  SharedAddressDevice
> = {
  blade1: {
    id: "11720000-0000-4000-8000-000000000b01",
    name: "chassis-1 blade 1",
    engineId: "800000090300AABBCC000001",
    userName: "blade-1-monitor",
    ifIndex: 3,
  },
  blade2: {
    id: "11720000-0000-4000-8000-000000000b02",
    name: "chassis-1 blade 2",
    engineId: "800000090300AABBCC000002",
    userName: "blade-2-monitor",
    ifIndex: 4,
  },
  siteSwitch1: {
    id: "11720000-0000-4000-8000-000000000c01",
    name: "branch switch 1",
    engineId: "800000090300AABBCC000003",
    userName: "site-default",
    ifIndex: 5,
  },
  siteSwitch2: {
    id: "11720000-0000-4000-8000-000000000c02",
    name: "branch switch 2",
    engineId: "800000090300AABBCC000004",
    userName: "site-default",
    ifIndex: 6,
  },
};

// The datagrams as they arrived, in the order sent.
export const RECORDED_SHARED_ADDRESS_TRAPS: Array<{
  device: SharedAddressDeviceKey;
  datagram: string;
}> = [
  {
    device: "blade1",
    datagram:
      "3081bf0201033011020451937fd9020300ffe304010302010304423040040c800000090300aabbcc00000102010102040681538a040f626c6164652d312d6d6f6e69746f72040c06f4d4b3ccb92b1fa9e289bb040857fb78017a29c0e204636089d2e82d53160f695c8b273d90f1ec3a2027e575c16d928f625d7abfd6f3a180d4e0e260676b9970c761f53c18068e40763874027b53e898def155ce116444dd75f2064505a0d64f5a1a2140451832ff5b62a89b67778a583d9e6ee0a2927e4f3d27",
  },
  {
    device: "blade2",
    datagram:
      "3081cb0201033011020468b7fe60020300ffe3040103020103044e304c040c800000090300aabbcc0000020201010204068153b1040f626c6164652d322d6d6f6e69746f7204188de6bff3027d5e22b49a6ae98a5007b6f6211fb59e6356f80408719a63c0b9089d3104639370d47f59df7ee7b9c2d1b2fb79e42e0eed877e46b35d90d956deb869666577a1f20182442f999a0dab17a2ccaa1c24adce0bffb128fa0345b58df6a31bcde25bd75e7335f7d794a71e513f637507b893f5d0c38931ef5a76087785938270516e8aac",
  },
  {
    device: "siteSwitch1",
    datagram:
      "3081bc02010330110204270eef62020300ffe3040103020103043f303d040c800000090300aabbcc0000030201010204068153e3040c736974652d64656661756c74040c5b7e859667f5c341cc2c857704082514836b4c3792cd0463bec99de558036dcbbf31f9d85d0f0b756c9819d963fe2437a13ba8c1b859c087fe29f1aa52e880c621167be7381a8c34d7019964a1afa10735d27136aaf7849e006c852f7844cbe9e7c5d44f3e2602f48f2addb82fbe0a51fea73dc4c0183b8482a351",
  },
  {
    device: "siteSwitch2",
    datagram:
      "3081bc020103301102040b7e6dff020300ffe3040103020103043f303d040c800000090300aabbcc000004020101020406815409040c736974652d64656661756c74040cc47e139bf484f9dbd10b31ee0408acc1ee8026ee5df7046300725ee3057038905f154a8ae07a2dd5443b52005cf7248c7f93cdb20c4e27c7911f8633609d275d10f5abc9ad95b29e97300907196bf30d4f237c84ec4340fd17a1dcd5ad74dbdbf012592c0fdd26b4646faa5371ae22413cf30d0e20bbc0e28c85ed",
  },
];

/*
 * The users OneUptime hands the probe for these four: each blade's own, and
 * the site's default, which both switches carry and the site holds.
 */
export const SHARED_ADDRESS_RECEIVER_USERS: Array<SnmpTrapReceiverUser> = [
  {
    userName: "blade-1-monitor",
    securityLevel: SnmpSecurityLevel.AuthPriv,
    authProtocol: SnmpAuthProtocol.SHA,
    authKey: "blade-1-auth-passphrase",
    privProtocol: SnmpPrivProtocol.AES,
    privKey: "blade-1-priv-passphrase",
    addresses: [SHARED_ADDRESS],
    heldBy: {
      projectIds: [SHARED_ADDRESS_PROJECT_ID],
      deviceIds: [SHARED_ADDRESS_DEVICES.blade1.id],
      siteIds: [],
    },
  },
  {
    userName: "blade-2-monitor",
    securityLevel: SnmpSecurityLevel.AuthPriv,
    authProtocol: SnmpAuthProtocol.SHA256,
    authKey: "blade-2-auth-passphrase",
    privProtocol: SnmpPrivProtocol.AES256,
    privKey: "blade-2-priv-passphrase",
    addresses: [SHARED_ADDRESS],
    heldBy: {
      projectIds: [SHARED_ADDRESS_PROJECT_ID],
      deviceIds: [SHARED_ADDRESS_DEVICES.blade2.id],
      siteIds: [],
    },
  },
  {
    userName: "site-default",
    securityLevel: SnmpSecurityLevel.AuthPriv,
    authProtocol: SnmpAuthProtocol.SHA,
    authKey: "site-default-auth-passphrase",
    privProtocol: SnmpPrivProtocol.AES,
    privKey: "site-default-priv-passphrase",
    addresses: [SHARED_ADDRESS],
    heldBy: {
      projectIds: [SHARED_ADDRESS_PROJECT_ID],
      deviceIds: [
        SHARED_ADDRESS_DEVICES.siteSwitch1.id,
        SHARED_ADDRESS_DEVICES.siteSwitch2.id,
      ],
      siteIds: [SHARED_ADDRESS_SITE_ID],
    },
  },
];

// sysUpTime.0: snmptrap sends its host's own uptime, which no test fixes.
export const SYS_UP_TIME_OID: string = "1.3.6.1.2.1.1.3.0";

/*
 * What the probe forwards for a device's recorded trap - what OneUptime's
 * trap ingest is handed - but the time it was received and the sysUpTime
 * the sender read for itself.
 */
export function forwardedSharedAddressTrap(
  key: SharedAddressDeviceKey,
): Omit<SnmpTrap, "receivedAt"> {
  const device: SharedAddressDevice = SHARED_ADDRESS_DEVICES[key];
  const user: SnmpTrapReceiverUser = SHARED_ADDRESS_RECEIVER_USERS.find(
    (candidate: SnmpTrapReceiverUser): boolean => {
      return candidate.userName === device.userName;
    },
  )!;

  return {
    sourceIpAddress: SHARED_ADDRESS,
    trapOid: "1.3.6.1.6.3.1.1.5.3",
    snmpVersion: "3",
    varbinds: [
      { oid: "1.3.6.1.6.3.1.1.4.1.0", value: "1.3.6.1.6.3.1.1.5.3" },
      {
        oid: `1.3.6.1.2.1.2.2.1.1.${device.ifIndex}`,
        value: String(device.ifIndex),
      },
    ],
    isInform: false,
    securityName: device.userName,
    securityLevel: SnmpSecurityLevel.AuthPriv,
    engineId: device.engineId,
    signedBy: user.heldBy!,
  };
}
