import {
  BerTag,
  encodeConstructed,
  encodeInteger,
  encodeOctetString,
  encodeOid,
  encodeUnsigned32,
} from "../../Utils/Snmp/V3/SnmpBer";
import {
  buildScopedPdu,
  buildV3Message,
} from "../../Utils/Snmp/V3/SnmpV3Message";
import UsmCrypto, { UsmPrivacyKey } from "../../Utils/Snmp/V3/UsmCrypto";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";

/*
 * SNMPv3 notifications built the way a device's stack builds them, for
 * tests that need what net-snmp's Session and Net-SNMP's tools will not
 * send: any engine boots and time, a wrong key on purpose, flags no sender
 * should set, a PDU type the receiver must not take. Keys are derived with
 * UsmCrypto, which UsmCrypto.test holds to net-snmp byte for byte.
 */

export const SYS_UP_TIME_OID: string = "1.3.6.1.2.1.1.3.0";
export const SNMP_TRAP_OID_OID: string = "1.3.6.1.6.3.1.1.4.1.0";
export const LINK_DOWN_OID: string = "1.3.6.1.6.3.1.1.5.3";

export interface TestCredential {
  userName: string;
  authProtocol?: SnmpAuthProtocol | undefined;
  authPassphrase?: string | undefined;
  privProtocol?: SnmpPrivProtocol | undefined;
  privPassphrase?: string | undefined;
}

export interface TestVarbind {
  oid: string;
  // The whole encoded value, tag and all.
  value: Buffer;
}

export function integerValue(value: number): Buffer {
  return encodeInteger(value);
}

export function oidValue(oid: string): Buffer {
  return encodeOid(oid);
}

export function textValue(text: string | Buffer): Buffer {
  return encodeOctetString(text);
}

export function timeTicksValue(value: number): Buffer {
  return encodeUnsigned32(value, BerTag.TimeTicks);
}

export function linkDownVarbinds(ifIndex: number = 3): Array<TestVarbind> {
  return [
    { oid: SYS_UP_TIME_OID, value: timeTicksValue(4242) },
    { oid: SNMP_TRAP_OID_OID, value: oidValue(LINK_DOWN_OID) },
    { oid: "1.3.6.1.2.1.2.2.1.1." + ifIndex, value: integerValue(ifIndex) },
  ];
}

export function encodeVarbindList(varbinds: Array<TestVarbind>): Buffer {
  return encodeConstructed(
    varbinds.map((varbind: TestVarbind): Buffer => {
      return encodeConstructed([encodeOid(varbind.oid), varbind.value]);
    }),
  );
}

export function buildTestV3Message(data: {
  credential: TestCredential;
  // The authoritative engine: the sender's for a trap, the receiver's for an inform.
  engineId: Buffer;
  engineBoots?: number | undefined;
  engineTime?: number | undefined;
  level?: SnmpSecurityLevel | undefined;
  pduType?: number | undefined;
  isReportable?: boolean | undefined;
  msgId?: number | undefined;
  requestId?: number | undefined;
  contextEngineId?: Buffer | undefined;
  contextName?: string | undefined;
  varbinds?: Array<TestVarbind> | undefined;
  salt?: Buffer | undefined;
}): Buffer {
  const credential: TestCredential = data.credential;
  const level: SnmpSecurityLevel =
    data.level ||
    (credential.privProtocol
      ? SnmpSecurityLevel.AuthPriv
      : credential.authProtocol
        ? SnmpSecurityLevel.AuthNoPriv
        : SnmpSecurityLevel.NoAuthNoPriv);
  const pduType: number = data.pduType ?? BerTag.TrapV2Pdu;
  const engineBoots: number = data.engineBoots ?? 1;
  const engineTime: number = data.engineTime ?? 100;

  const scopedPdu: Buffer = buildScopedPdu({
    contextEngineId: data.contextEngineId || data.engineId,
    contextName: Buffer.from(data.contextName || "", "utf8"),
    pduType: pduType,
    requestId: data.requestId ?? 4711,
    varbindList: encodeVarbindList(data.varbinds || linkDownVarbinds()),
  });

  const isAuthenticated: boolean = level !== SnmpSecurityLevel.NoAuthNoPriv;
  const isEncrypted: boolean = level === SnmpSecurityLevel.AuthPriv;

  const authKey: Buffer | undefined =
    isAuthenticated && credential.authProtocol && credential.authPassphrase
      ? UsmCrypto.localizeKey(
          credential.authProtocol,
          UsmCrypto.passwordToKu(
            credential.authProtocol,
            credential.authPassphrase,
          ),
          data.engineId,
        )
      : undefined;

  const privacyKey: UsmPrivacyKey | undefined =
    isEncrypted &&
    credential.authProtocol &&
    credential.privProtocol &&
    credential.privPassphrase
      ? UsmCrypto.localizePrivacyKey({
          authProtocol: credential.authProtocol,
          privProtocol: credential.privProtocol,
          privKu: UsmCrypto.passwordToKu(
            credential.authProtocol,
            credential.privPassphrase,
          ),
          engineId: data.engineId,
        })
      : undefined;

  return buildV3Message({
    msgId: data.msgId ?? 90210,
    msgMaxSize: 65507,
    flags: {
      isAuthenticated: isAuthenticated,
      isEncrypted: isEncrypted,
      isReportable:
        data.isReportable ?? pduType === BerTag.InformRequestPdu,
    },
    engineId: data.engineId,
    engineBoots: engineBoots,
    engineTime: engineTime,
    userName: Buffer.from(credential.userName, "utf8"),
    scopedPdu: scopedPdu,
    authenticate:
      authKey && credential.authProtocol
        ? {
            macLength: UsmCrypto.getMacLength(credential.authProtocol),
            computeMac: (messageWithZeroedMac: Buffer): Buffer => {
              return UsmCrypto.computeMac(
                credential.authProtocol!,
                authKey,
                messageWithZeroedMac,
              );
            },
          }
        : undefined,
    encrypt: privacyKey
      ? (plaintext: Buffer): { encrypted: Buffer; privParameters: Buffer } => {
          return UsmCrypto.encrypt({
            privacyKey: privacyKey,
            engineBoots: engineBoots,
            engineTime: engineTime,
            salt: data.salt || Buffer.from("0011223344556677", "hex"),
            scopedPdu: plaintext,
          });
        }
      : undefined,
  });
}

// An engine discovery probe, as Net-SNMP and net-snmp send it: no engine ID, no user, GetRequest.
export function buildDiscoveryProbe(msgId: number = 1234): Buffer {
  return buildV3Message({
    msgId: msgId,
    msgMaxSize: 65507,
    flags: { isAuthenticated: false, isEncrypted: false, isReportable: true },
    engineId: Buffer.alloc(0),
    engineBoots: 0,
    engineTime: 0,
    userName: Buffer.alloc(0),
    scopedPdu: buildScopedPdu({
      contextEngineId: Buffer.alloc(0),
      contextName: Buffer.alloc(0),
      pduType: BerTag.GetRequestPdu,
      requestId: 777,
      varbindList: encodeConstructed([]),
    }),
  });
}
