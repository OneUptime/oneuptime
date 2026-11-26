import {
  BerElement,
  BerError,
  BerReader,
  BerTag,
  decodeInteger,
  decodeOid,
  decodeUnsigned32,
  encodeConstructed,
  encodeInteger,
  encodeOctetString,
} from "./SnmpBer";

/*
 * An SNMPv3 message (RFC 3412 section 6, RFC 3414 section 2.4), read in the
 * two passes its security needs and written for the two answers a trap
 * receiver sends: an inform's Response and a Report.
 *
 *   SNMPv3Message ::= SEQUENCE {
 *       msgVersion            INTEGER (3),
 *       msgGlobalData         SEQUENCE { msgID, msgMaxSize, msgFlags, msgSecurityModel },
 *       msgSecurityParameters OCTET STRING  -- holds UsmSecurityParameters
 *       msgData               ScopedPDU | OCTET STRING (encrypted)
 *   }
 *   UsmSecurityParameters ::= SEQUENCE {
 *       msgAuthoritativeEngineID, msgAuthoritativeEngineBoots,
 *       msgAuthoritativeEngineTime, msgUserName,
 *       msgAuthenticationParameters, msgPrivacyParameters
 *   }
 *
 * parseV3Message reads only what can be read before authentication: the
 * header, the security parameters - with the offset of the authentication
 * parameters, which the digest is computed over with them zeroed - and the
 * scoped PDU's bytes, encrypted or not. parseScopedPdu reads the PDU once
 * the message is authentic (and decrypted).
 */

export const SNMP_V3: number = 3;

// The User-based Security Model's number (RFC 3411).
export const USM_SECURITY_MODEL: number = 3;

// The largest message the probe accepts or announces: one UDP datagram.
export const MAX_SNMP_MESSAGE_SIZE: number = 65507;

const FLAG_AUTH: number = 0x01;
const FLAG_PRIV: number = 0x02;
const FLAG_REPORTABLE: number = 0x04;

export interface SnmpV3MessageFlags {
  isAuthenticated: boolean;
  isEncrypted: boolean;
  isReportable: boolean;
}

export interface ParsedSnmpV3Message {
  // The whole datagram, which the digest is computed over.
  datagram: Buffer;
  msgId: number;
  msgMaxSize: number;
  flags: SnmpV3MessageFlags;
  securityModel: number;
  engineId: Buffer;
  engineBoots: number;
  engineTime: number;
  userName: Buffer;
  authParameters: Buffer;
  // Where the authentication parameters' octets start in the datagram.
  authParametersOffset: number;
  privParameters: Buffer;
  // The plaintext scoped PDU (a whole SEQUENCE), when it is not encrypted.
  scopedPdu?: Buffer | undefined;
  // The encrypted scoped PDU's octets, when it is.
  encryptedScopedPdu?: Buffer | undefined;
}

export interface SnmpVarbindValue {
  oid: string;
  // The value's BER tag, which is net-snmp's ObjectType number for it.
  type: number;
  /*
   * As net-snmp's decoder hands values over, so one renderer reads both: a
   * number, a dotted OID or IP address, a Buffer of octets (an OCTET
   * STRING, an Opaque, a Counter64's big-endian octets) or null.
   */
  value: number | string | Buffer | boolean | null;
}

export interface ScopedPdu {
  contextEngineId: Buffer;
  contextName: Buffer;
  pduType: number;
  requestId: number;
  errorStatus: number;
  errorIndex: number;
  // The varbind list's whole encoding, echoed as it came in an inform's Response.
  varbindList: Buffer;
  varbinds: Array<SnmpVarbindValue>;
}

/*
 * Whether a datagram is an SNMPv3 message: a SEQUENCE whose first element
 * is the INTEGER 3. Cheap, and false for anything that does not parse that
 * far - which net-snmp then parses as v1 or v2c, or refuses.
 */
export function isSnmpV3Message(buffer: Buffer): boolean {
  try {
    const message: BerReader = new BerReader(buffer).readConstructed();
    return message.readInteger() === SNMP_V3;
  } catch {
    return false;
  }
}

export function parseV3Message(buffer: Buffer): ParsedSnmpV3Message {
  if (buffer.length > MAX_SNMP_MESSAGE_SIZE) {
    throw new BerError("The message is larger than one UDP datagram");
  }

  const message: BerReader = new BerReader(buffer).readConstructed();

  if (message.readInteger() !== SNMP_V3) {
    throw new BerError("Not an SNMPv3 message");
  }

  const header: BerReader = message.readConstructed();
  const msgId: number = header.readInteger();
  const msgMaxSize: number = header.readInteger();
  const flagOctets: Buffer = header.readOctetString();
  const securityModel: number = header.readInteger();

  if (flagOctets.length !== 1) {
    throw new BerError("msgFlags is one octet");
  }

  if (msgId < 0 || msgMaxSize < 484) {
    throw new BerError("msgID or msgMaxSize is out of range");
  }

  const flagOctet: number = flagOctets[0]!;

  const flags: SnmpV3MessageFlags = {
    isAuthenticated: (flagOctet & FLAG_AUTH) !== 0,
    isEncrypted: (flagOctet & FLAG_PRIV) !== 0,
    isReportable: (flagOctet & FLAG_REPORTABLE) !== 0,
  };

  // The security parameters: an OCTET STRING holding a SEQUENCE.
  const securityParametersElement: BerElement = message.readElement(
    BerTag.OctetString,
  );
  const securityParameters: BerReader = new BerReader(
    buffer,
    securityParametersElement.valueStart,
    securityParametersElement.valueEnd,
  ).readConstructed();

  const engineId: Buffer = securityParameters.readOctetString();
  const engineBoots: number = securityParameters.readInteger();
  const engineTime: number = securityParameters.readInteger();
  const userName: Buffer = securityParameters.readOctetString();
  const authParametersElement: BerElement = securityParameters.readElement(
    BerTag.OctetString,
  );
  const privParameters: Buffer = securityParameters.readOctetString();

  if (engineBoots < 0 || engineTime < 0) {
    throw new BerError("Engine boots and time are never negative");
  }

  const parsed: ParsedSnmpV3Message = {
    datagram: buffer,
    msgId: msgId,
    msgMaxSize: msgMaxSize,
    flags: flags,
    securityModel: securityModel,
    engineId: engineId,
    engineBoots: engineBoots,
    engineTime: engineTime,
    userName: userName,
    authParameters: buffer.subarray(
      authParametersElement.valueStart,
      authParametersElement.valueEnd,
    ),
    authParametersOffset: authParametersElement.valueStart,
    privParameters: privParameters,
  };

  if (message.peekTag() === BerTag.OctetString) {
    parsed.encryptedScopedPdu = message.readOctetString();
  } else {
    const scopedPduElement: BerElement = message.readElement(BerTag.Sequence);
    parsed.scopedPdu = buffer.subarray(
      scopedPduElement.start,
      scopedPduElement.valueEnd,
    );
  }

  return parsed;
}

/*
 * The scoped PDU of an authentic message. A decrypted one may end in the
 * cipher's padding: only the first SEQUENCE is read.
 */
export function parseScopedPdu(bytes: Buffer): ScopedPdu {
  const scoped: BerReader = new BerReader(bytes).readConstructed();
  const contextEngineId: Buffer = scoped.readOctetString();
  const contextName: Buffer = scoped.readOctetString();

  const pduType: number | null = scoped.peekTag();

  if (pduType === null || pduType < 0xa0 || pduType > 0xa8) {
    throw new BerError("The scoped PDU holds no SNMP PDU");
  }

  const pdu: BerReader = scoped.readConstructed(pduType);
  const requestId: number = pdu.readInteger();
  const errorStatus: number = pdu.readInteger();
  const errorIndex: number = pdu.readInteger();

  const varbindListElement: BerElement = pdu.readElement(BerTag.Sequence);
  const varbindList: Buffer = bytes.subarray(
    varbindListElement.start,
    varbindListElement.valueEnd,
  );

  return {
    contextEngineId: contextEngineId,
    contextName: contextName,
    pduType: pduType,
    requestId: requestId,
    errorStatus: errorStatus,
    errorIndex: errorIndex,
    varbindList: varbindList,
    varbinds: parseVarbindList(
      new BerReader(
        bytes,
        varbindListElement.valueStart,
        varbindListElement.valueEnd,
      ),
    ),
  };
}

function parseVarbindList(list: BerReader): Array<SnmpVarbindValue> {
  const varbinds: Array<SnmpVarbindValue> = [];

  while (list.hasMore()) {
    const varbind: BerReader = list.readConstructed();
    const oid: string = varbind.readOid();
    const valueElement: BerElement = varbind.readElement();

    varbinds.push({
      oid: oid,
      type: valueElement.tag,
      value: readVarbindValue(varbind, valueElement),
    });
  }

  return varbinds;
}

/*
 * A value as net-snmp's readVarbindValue hands it over, so a v3 trap's
 * varbinds render exactly as a v2c trap's. A tag net-snmp does not know is
 * kept as its octets rather than refused: one odd varbind must not lose
 * the trap.
 */
function readVarbindValue(
  reader: BerReader,
  element: BerElement,
): number | string | Buffer | boolean | null {
  const buffer: Buffer = reader.getBuffer();
  const octets: Buffer = buffer.subarray(element.valueStart, element.valueEnd);

  switch (element.tag) {
    case BerTag.Boolean:
      return octets.length > 0 && octets[0] !== 0;
    case BerTag.Integer:
      return decodeInteger(buffer, element.valueStart, element.valueEnd);
    case BerTag.Counter32:
    case BerTag.Gauge32:
    case BerTag.TimeTicks:
      return decodeUnsigned32(buffer, element.valueStart, element.valueEnd);
    case BerTag.Oid:
      return decodeOid(buffer, element.valueStart, element.valueEnd);
    case BerTag.IpAddress:
      return octets.length === 4 ? Array.from(octets).join(".") : octets;
    case BerTag.Null:
    case BerTag.NoSuchObject:
    case BerTag.NoSuchInstance:
    case BerTag.EndOfMibView:
      return null;
    default:
      // OCTET STRING, Opaque, Counter64, BIT STRING and anything unknown.
      return octets;
  }
}

export function buildScopedPdu(data: {
  contextEngineId: Buffer;
  contextName: Buffer;
  pduType: number;
  requestId: number;
  errorStatus?: number | undefined;
  errorIndex?: number | undefined;
  varbindList: Buffer;
}): Buffer {
  return encodeConstructed([
    encodeOctetString(data.contextEngineId),
    encodeOctetString(data.contextName),
    encodeConstructed(
      [
        encodeInteger(data.requestId),
        encodeInteger(data.errorStatus || 0),
        encodeInteger(data.errorIndex || 0),
        data.varbindList,
      ],
      data.pduType,
    ),
  ]);
}

/*
 * A whole SNMPv3 message, ready to send. `authenticate` signs it: it is
 * handed the message with zeroed authentication parameters of `macLength`
 * octets and returns the digest, which is written into them. `encrypt`
 * turns the scoped PDU into the encrypted octets and the privacy parameters
 * the message carries.
 */
export function buildV3Message(data: {
  msgId: number;
  msgMaxSize: number;
  flags: SnmpV3MessageFlags;
  engineId: Buffer;
  engineBoots: number;
  engineTime: number;
  userName: Buffer;
  scopedPdu: Buffer;
  authenticate?:
    | {
        macLength: number;
        computeMac: (messageWithZeroedMac: Buffer) => Buffer;
      }
    | undefined;
  encrypt?:
    | ((scopedPdu: Buffer) => { encrypted: Buffer; privParameters: Buffer })
    | undefined;
}): Buffer {
  let msgData: Buffer = data.scopedPdu;
  let privParameters: Buffer = Buffer.alloc(0);

  if (data.flags.isEncrypted) {
    if (!data.encrypt || !data.flags.isAuthenticated) {
      throw new Error("An encrypted SNMPv3 message is also authenticated");
    }

    const encrypted: { encrypted: Buffer; privParameters: Buffer } =
      data.encrypt(data.scopedPdu);

    msgData = encodeOctetString(encrypted.encrypted);
    privParameters = encrypted.privParameters;
  }

  if (data.flags.isAuthenticated && !data.authenticate) {
    throw new Error("An authenticated SNMPv3 message needs its key");
  }

  const macLength: number = data.flags.isAuthenticated
    ? data.authenticate!.macLength
    : 0;

  const flagOctet: number =
    (data.flags.isAuthenticated ? FLAG_AUTH : 0) |
    (data.flags.isEncrypted ? FLAG_PRIV : 0) |
    (data.flags.isReportable ? FLAG_REPORTABLE : 0);

  const securityParameters: Buffer = encodeConstructed([
    encodeOctetString(data.engineId),
    encodeInteger(data.engineBoots),
    encodeInteger(data.engineTime),
    encodeOctetString(data.userName),
    encodeOctetString(Buffer.alloc(macLength)),
    encodeOctetString(privParameters),
  ]);

  const message: Buffer = encodeConstructed([
    encodeInteger(SNMP_V3),
    encodeConstructed([
      encodeInteger(data.msgId),
      encodeInteger(data.msgMaxSize),
      encodeOctetString(Buffer.from([flagOctet])),
      encodeInteger(USM_SECURITY_MODEL),
    ]),
    encodeOctetString(securityParameters),
    msgData,
  ]);

  if (!data.flags.isAuthenticated) {
    return message;
  }

  /*
   * The message is read back to find its authentication parameters, so the
   * digest lands exactly where a receiver will look for it.
   */
  const written: ParsedSnmpV3Message = parseV3Message(message);
  const mac: Buffer = data.authenticate!.computeMac(message);

  if (mac.length !== macLength) {
    throw new Error("The digest is not the length the message carries");
  }

  mac.copy(message, written.authParametersOffset);

  return message;
}
