/*
 * The slice of BER (ITU-T X.690) that SNMP messages are written in, read
 * from and written to Buffers, for the probe's SNMPv3 trap receiver
 * (SnmpV3NotificationProcessor).
 *
 * net-snmp parses SNMP for the probe everywhere else, but its message
 * parser is internal to the library, and the receiver has to read an
 * SNMPv3 message in two passes - its header and security parameters before
 * anything is authenticated, its scoped PDU only after - and to know the
 * exact offset of the authentication parameters in the datagram, which the
 * digest is computed over. So this reads exactly what SNMP uses:
 *
 *   - one-octet tags (SNMP's are all below 31), definite lengths in the
 *     short form or the long form up to four octets - never the indefinite
 *     form, which SNMP does not allow;
 *   - INTEGER, OCTET STRING, NULL, OBJECT IDENTIFIER, SEQUENCE, the SMI's
 *     application types and the context-specific PDU tags.
 *
 * Everything read here arrives in a datagram from whoever can reach the
 * probe's port, so every length is checked against what is left, nothing
 * is read past the end of its parent, and anything this does not expect
 * throws a BerError the receiver counts as malformed - never a crash, never
 * an unbounded loop.
 */

export class BerError extends Error {}

export const BerTag: {
  Boolean: number;
  Integer: number;
  BitString: number;
  OctetString: number;
  Null: number;
  Oid: number;
  Sequence: number;
  IpAddress: number;
  Counter32: number;
  Gauge32: number;
  TimeTicks: number;
  Opaque: number;
  Counter64: number;
  NoSuchObject: number;
  NoSuchInstance: number;
  EndOfMibView: number;
  GetRequestPdu: number;
  GetNextRequestPdu: number;
  ResponsePdu: number;
  SetRequestPdu: number;
  TrapV1Pdu: number;
  GetBulkRequestPdu: number;
  InformRequestPdu: number;
  TrapV2Pdu: number;
  ReportPdu: number;
} = {
  Boolean: 0x01,
  Integer: 0x02,
  BitString: 0x03,
  OctetString: 0x04,
  Null: 0x05,
  Oid: 0x06,
  Sequence: 0x30,
  IpAddress: 0x40,
  Counter32: 0x41,
  Gauge32: 0x42,
  TimeTicks: 0x43,
  Opaque: 0x44,
  Counter64: 0x46,
  NoSuchObject: 0x80,
  NoSuchInstance: 0x81,
  EndOfMibView: 0x82,
  GetRequestPdu: 0xa0,
  GetNextRequestPdu: 0xa1,
  ResponsePdu: 0xa2,
  SetRequestPdu: 0xa3,
  TrapV1Pdu: 0xa4,
  GetBulkRequestPdu: 0xa5,
  InformRequestPdu: 0xa6,
  TrapV2Pdu: 0xa7,
  ReportPdu: 0xa8,
};

// An OBJECT IDENTIFIER longer than this is not one any MIB defines (RFC 2578: 128).
const MAX_OID_SUBIDENTIFIERS: number = 128;

// The most octets an INTEGER read as a number may have: 32 bits and a sign octet.
const MAX_INTEGER_OCTETS: number = 5;

export interface BerElement {
  tag: number;
  // Where its tag octet is, and where its value starts and ends (exclusive).
  start: number;
  valueStart: number;
  valueEnd: number;
}

export class BerReader {
  private offset: number;

  public constructor(
    private readonly buffer: Buffer,
    start: number = 0,
    private readonly end: number = buffer.length,
  ) {
    if (start < 0 || end > buffer.length || start > end) {
      throw new BerError("BER reader bounds are outside the buffer");
    }

    this.offset = start;
  }

  public hasMore(): boolean {
    return this.offset < this.end;
  }

  public getOffset(): number {
    return this.offset;
  }

  // The buffer the element offsets this reader hands out point into.
  public getBuffer(): Buffer {
    return this.buffer;
  }

  public peekTag(): number | null {
    return this.offset < this.end ? this.buffer[this.offset]! : null;
  }

  public readElement(expectedTag?: number): BerElement {
    const start: number = this.offset;

    if (start >= this.end) {
      throw new BerError("Expected a BER element, found the end");
    }

    const tag: number = this.buffer[start]!;

    // A tag number of 31 or more (0x1f in the low bits) takes more octets: never SNMP's.
    if ((tag & 0x1f) === 0x1f) {
      throw new BerError("Multi-octet BER tags are not used by SNMP");
    }

    if (expectedTag !== undefined && tag !== expectedTag) {
      throw new BerError(
        `Expected BER tag 0x${expectedTag.toString(16)}, found 0x${tag.toString(16)}`,
      );
    }

    let cursor: number = start + 1;

    if (cursor >= this.end) {
      throw new BerError("BER element has no length");
    }

    const firstLengthOctet: number = this.buffer[cursor]!;
    cursor++;

    let length: number;

    if (firstLengthOctet < 0x80) {
      length = firstLengthOctet;
    } else {
      const lengthOctets: number = firstLengthOctet & 0x7f;

      if (lengthOctets === 0) {
        throw new BerError("Indefinite BER lengths are not allowed in SNMP");
      }

      if (lengthOctets > 4) {
        throw new BerError("BER length is longer than four octets");
      }

      if (cursor + lengthOctets > this.end) {
        throw new BerError("BER length runs past the end");
      }

      length = 0;

      for (let index: number = 0; index < lengthOctets; index++) {
        length = length * 256 + this.buffer[cursor + index]!;
      }

      cursor += lengthOctets;
    }

    const valueEnd: number = cursor + length;

    if (valueEnd > this.end) {
      throw new BerError("BER value runs past the end of its parent");
    }

    this.offset = valueEnd;

    return {
      tag: tag,
      start: start,
      valueStart: cursor,
      valueEnd: valueEnd,
    };
  }

  // A constructed element (a SEQUENCE, a PDU), as a reader over its contents.
  public readConstructed(expectedTag: number = BerTag.Sequence): BerReader {
    const element: BerElement = this.readElement(expectedTag);
    return new BerReader(this.buffer, element.valueStart, element.valueEnd);
  }

  public readInteger(expectedTag: number = BerTag.Integer): number {
    const element: BerElement = this.readElement(expectedTag);
    return decodeInteger(this.buffer, element.valueStart, element.valueEnd);
  }

  // An unsigned 32-bit value: Counter32, Gauge32, TimeTicks, or an INTEGER known to be one.
  public readUnsigned32(expectedTag: number): number {
    const element: BerElement = this.readElement(expectedTag);
    return decodeUnsigned32(this.buffer, element.valueStart, element.valueEnd);
  }

  // The octets themselves, as a view into the datagram.
  public readOctetString(expectedTag: number = BerTag.OctetString): Buffer {
    const element: BerElement = this.readElement(expectedTag);
    return this.buffer.subarray(element.valueStart, element.valueEnd);
  }

  public readNull(expectedTag: number = BerTag.Null): void {
    const element: BerElement = this.readElement(expectedTag);

    if (element.valueEnd !== element.valueStart) {
      throw new BerError("A BER NULL has a value");
    }
  }

  public readOid(): string {
    const element: BerElement = this.readElement(BerTag.Oid);
    return decodeOid(this.buffer, element.valueStart, element.valueEnd);
  }
}

export function decodeInteger(
  buffer: Buffer,
  start: number,
  end: number,
): number {
  const length: number = end - start;

  if (length < 1) {
    throw new BerError("A BER INTEGER has no octets");
  }

  if (length > MAX_INTEGER_OCTETS) {
    throw new BerError("A BER INTEGER is longer than SNMP allows");
  }

  return buffer.readIntBE(start, length);
}

export function decodeUnsigned32(
  buffer: Buffer,
  start: number,
  end: number,
): number {
  const length: number = end - start;

  if (length < 1) {
    throw new BerError("A BER unsigned value has no octets");
  }

  if (length > MAX_INTEGER_OCTETS) {
    throw new BerError("A BER unsigned value is longer than 32 bits");
  }

  // As net-snmp reads them: the two's complement value, taken as unsigned.
  return buffer.readIntBE(start, length) >>> 0;
}

export function decodeOid(buffer: Buffer, start: number, end: number): string {
  if (end <= start) {
    throw new BerError("A BER OBJECT IDENTIFIER has no octets");
  }

  const subidentifiers: Array<number> = [];
  let value: number = 0;
  let octetsInValue: number = 0;

  for (let index: number = start; index < end; index++) {
    const octet: number = buffer[index]!;

    // A subidentifier never starts with 0x80: that would be a leading zero.
    if (octetsInValue === 0 && octet === 0x80) {
      throw new BerError("An OBJECT IDENTIFIER subidentifier is padded");
    }

    value = value * 128 + (octet & 0x7f);
    octetsInValue++;

    if (value > 0xffffffff) {
      throw new BerError("An OBJECT IDENTIFIER subidentifier exceeds 32 bits");
    }

    if ((octet & 0x80) === 0) {
      if (subidentifiers.length === 0) {
        // The first subidentifier holds the first two arcs: 40 * X + Y.
        if (value < 40) {
          subidentifiers.push(0, value);
        } else if (value < 80) {
          subidentifiers.push(1, value - 40);
        } else {
          subidentifiers.push(2, value - 80);
        }
      } else {
        subidentifiers.push(value);
      }

      if (subidentifiers.length > MAX_OID_SUBIDENTIFIERS) {
        throw new BerError("An OBJECT IDENTIFIER is longer than SNMP allows");
      }

      value = 0;
      octetsInValue = 0;
    }
  }

  if (octetsInValue !== 0) {
    throw new BerError("An OBJECT IDENTIFIER ends inside a subidentifier");
  }

  return subidentifiers.join(".");
}

export function encodeLength(length: number): Buffer {
  if (length < 0 || !Number.isInteger(length)) {
    throw new BerError("A BER length must be a whole number");
  }

  if (length < 0x80) {
    return Buffer.from([length]);
  }

  const octets: Array<number> = [];
  let remaining: number = length;

  while (remaining > 0) {
    octets.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }

  return Buffer.from([0x80 | octets.length, ...octets]);
}

export function encodeTlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}

// A signed value in the fewest octets two's complement allows.
export function encodeInteger(
  value: number,
  tag: number = BerTag.Integer,
): Buffer {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new BerError("An SNMP INTEGER is a signed 32-bit whole number");
  }

  const octets: Array<number> = [];
  let remaining: number = value;

  do {
    octets.unshift(remaining & 0xff);
    remaining = remaining >> 8;
  } while (
    !(
      (remaining === 0 && (octets[0]! & 0x80) === 0) ||
      (remaining === -1 && (octets[0]! & 0x80) !== 0)
    )
  );

  return encodeTlv(tag, Buffer.from(octets));
}

// An unsigned 32-bit value (Counter32, Gauge32, TimeTicks), with a leading zero when its top bit is set.
export function encodeUnsigned32(value: number, tag: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new BerError("An unsigned SNMP value is a 32-bit whole number");
  }

  const octets: Array<number> = [];
  let remaining: number = value;

  do {
    octets.unshift(remaining % 256);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);

  if ((octets[0]! & 0x80) !== 0) {
    octets.unshift(0);
  }

  return encodeTlv(tag, Buffer.from(octets));
}

export function encodeOctetString(
  value: Buffer | string,
  tag: number = BerTag.OctetString,
): Buffer {
  return encodeTlv(
    tag,
    typeof value === "string" ? Buffer.from(value, "utf8") : value,
  );
}

export function encodeNull(): Buffer {
  return Buffer.from([BerTag.Null, 0x00]);
}

export function encodeOid(oid: string): Buffer {
  const parts: Array<number> = oid
    .trim()
    .replace(/^\./, "")
    .split(".")
    .map((part: string): number => {
      if (!/^\d+$/.test(part)) {
        throw new BerError(`"${oid}" is not an OBJECT IDENTIFIER`);
      }

      return Number(part);
    });

  if (parts.length < 2 || parts[0]! > 2 || (parts[0]! < 2 && parts[1]! > 39)) {
    throw new BerError(`"${oid}" is not an OBJECT IDENTIFIER`);
  }

  const subidentifiers: Array<number> = [
    parts[0]! * 40 + parts[1]!,
    ...parts.slice(2),
  ];
  const octets: Array<number> = [];

  for (const subidentifier of subidentifiers) {
    if (subidentifier > 0xffffffff) {
      throw new BerError(`"${oid}" has a subidentifier past 32 bits`);
    }

    const sevenBitGroups: Array<number> = [];
    let remaining: number = subidentifier;

    do {
      sevenBitGroups.unshift(remaining % 128);
      remaining = Math.floor(remaining / 128);
    } while (remaining > 0);

    for (let index: number = 0; index < sevenBitGroups.length; index++) {
      const isLast: boolean = index === sevenBitGroups.length - 1;
      octets.push(sevenBitGroups[index]! | (isLast ? 0 : 0x80));
    }
  }

  return encodeTlv(BerTag.Oid, Buffer.from(octets));
}

export function encodeConstructed(
  parts: Array<Buffer>,
  tag: number = BerTag.Sequence,
): Buffer {
  return encodeTlv(tag, Buffer.concat(parts));
}
