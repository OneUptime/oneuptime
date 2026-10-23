import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import {
  SNMP_WALK_MAX_VALUE_LENGTH,
  SnmpWalkRow,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import SnmpWalkResultUtil from "Common/Utils/NetworkDevice/SnmpWalkResultUtil";
import snmp from "net-snmp";

/*
 * One varbind of an SNMP walk as the walk's results show it (issue #5184):
 * its type in words, and its value the way `snmpwalk` would print it.
 *
 *   - Integers, gauges, 32-bit counters and timeticks are numbers.
 *   - A Counter64 is its decimal text: net-snmp hands it over as a
 *     big-endian buffer, and past 2^53 a JavaScript number would drop its
 *     last digits.
 *   - An OCTET STRING is text when it is text - UTF-8 with no control
 *     characters, trailing NULs dropped as agents pad with them - and its
 *     octets in hex ("00 1A 2B 3C 4D 5E") when it is not: MAC addresses,
 *     bitmaps, vendor blobs. jsonb cannot store a NUL, and mojibake helps
 *     nobody.
 *   - An OBJECT IDENTIFIER is its dotted OID, an IpAddress its dotted quad.
 *   - Anything longer than SNMP_WALK_MAX_VALUE_LENGTH is cut, and says so.
 */

// A byte as hex plus the space after it: three characters.
const HEX_CHARACTERS_PER_BYTE: number = 3;

function cutText(text: string): { value: string; isCut: boolean } {
  if (text.length <= SNMP_WALK_MAX_VALUE_LENGTH) {
    return { value: text, isCut: false };
  }

  return { value: text.substring(0, SNMP_WALK_MAX_VALUE_LENGTH), isCut: true };
}

function toHex(bytes: Buffer): { value: string; isCut: boolean } {
  const maxBytes: number = Math.floor(
    (SNMP_WALK_MAX_VALUE_LENGTH + 1) / HEX_CHARACTERS_PER_BYTE,
  );

  return {
    value: SnmpWalkResultUtil.toHex(bytes.subarray(0, maxBytes)),
    isCut: bytes.length > maxBytes,
  };
}

/*
 * The octets as text, or undefined when they are not text. Trailing NULs
 * are padding, not content; any other control character but tab and line
 * breaks says the octets are binary.
 */
function decodeText(bytes: Buffer): string | undefined {
  let end: number = bytes.length;

  while (end > 0 && bytes[end - 1] === 0) {
    end--;
  }

  // Nothing but NULs is a value of zeros (a blank MAC address), not text.
  if (end === 0 && bytes.length > 0) {
    return undefined;
  }

  const content: Buffer = bytes.subarray(0, end);

  for (const byte of content) {
    const isControl: boolean = byte < 0x20 || byte === 0x7f;
    const isAllowedWhitespace: boolean =
      byte === 0x09 || byte === 0x0a || byte === 0x0d;

    if (isControl && !isAllowedWhitespace) {
      return undefined;
    }
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}

function toBigIntText(value: unknown): string | undefined {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }

  if (Buffer.isBuffer(value)) {
    let accumulator: bigint = BigInt(0);
    const eight: bigint = BigInt(8);

    for (const byte of value) {
      accumulator = (accumulator << eight) | BigInt(byte);
    }

    return accumulator.toString();
  }

  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Buffer.isBuffer(value) && value.length > 0 && value.length <= 6) {
    return value.readUIntBE(0, value.length);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function getSnmpWalkDataType(
  type: snmp.ObjectType | undefined,
): SnmpDataType {
  switch (type) {
    case snmp.ObjectType.Integer:
      return SnmpDataType.Integer;
    case snmp.ObjectType.OctetString:
      return SnmpDataType.OctetString;
    case snmp.ObjectType.OID:
      return SnmpDataType.ObjectIdentifier;
    case snmp.ObjectType.IpAddress:
      return SnmpDataType.IpAddress;
    case snmp.ObjectType.Counter32:
      return SnmpDataType.Counter32;
    case snmp.ObjectType.Gauge32:
      return SnmpDataType.Gauge32;
    case snmp.ObjectType.TimeTicks:
      return SnmpDataType.TimeTicks;
    case snmp.ObjectType.Opaque:
      return SnmpDataType.Opaque;
    case snmp.ObjectType.Counter64:
      return SnmpDataType.Counter64;
    case snmp.ObjectType.Null:
      return SnmpDataType.Null;
    case snmp.ObjectType.Boolean:
      return SnmpDataType.Boolean;
    case snmp.ObjectType.NoSuchObject:
      return SnmpDataType.NoSuchObject;
    case snmp.ObjectType.NoSuchInstance:
      return SnmpDataType.NoSuchInstance;
    case snmp.ObjectType.EndOfMibView:
      return SnmpDataType.EndOfMibView;
    default:
      return SnmpDataType.Unknown;
  }
}

export function toSnmpWalkRow(varbind: snmp.Varbind): SnmpWalkRow {
  const type: SnmpDataType = getSnmpWalkDataType(varbind.type);
  const row: SnmpWalkRow = { oid: varbind.oid, type: type, value: null };
  const value: unknown = varbind.value;

  if (value === null || value === undefined) {
    return row;
  }

  switch (type) {
    case SnmpDataType.Integer:
    case SnmpDataType.Counter32:
    case SnmpDataType.Gauge32:
    case SnmpDataType.TimeTicks:
      row.value = toNumber(value);
      return row;
    case SnmpDataType.Counter64:
      row.value = toBigIntText(value) ?? null;
      return row;
    case SnmpDataType.Boolean:
      row.value = value ? "true" : "false";
      return row;
    case SnmpDataType.Null:
      return row;
    default:
      break;
  }

  if (Buffer.isBuffer(value)) {
    const text: string | undefined =
      type === SnmpDataType.Opaque ? undefined : decodeText(value);

    if (text !== undefined) {
      const cut: { value: string; isCut: boolean } = cutText(text);
      row.value = cut.value;

      if (cut.isCut) {
        row.isCut = true;
      }

      return row;
    }

    const hex: { value: string; isCut: boolean } = toHex(value);
    row.value = hex.value;
    row.isHex = true;

    if (hex.isCut) {
      row.isCut = true;
    }

    return row;
  }

  const cut: { value: string; isCut: boolean } = cutText(String(value));
  row.value = cut.value;

  if (cut.isCut) {
    row.isCut = true;
  }

  return row;
}
