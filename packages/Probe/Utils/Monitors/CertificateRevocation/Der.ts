/*
 * The few pieces of DER (ITU-T X.690) the certificate revocation check needs:
 * reading the certificates a TLS peer sends, the OCSP responses and CRLs an
 * issuer publishes, and writing one small OCSP request.
 *
 * Every byte read here came from the network - from the monitored server, or
 * from whatever answers at the address its certificate names - so nothing is
 * trusted to be well formed. Each element's length is checked against the
 * bytes actually there and against the element that contains it, so a
 * malformed input fails with a DerParseError and can neither read past its
 * buffer nor loop. Only what DER allows is accepted: no indefinite lengths,
 * and no high tag numbers (X.509, OCSP and CRLs never use them).
 */

export class DerParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DerParseError";
  }
}

// Identifier octets this code reads or writes.
export const DerTag: {
  readonly Boolean: number;
  readonly Integer: number;
  readonly BitString: number;
  readonly OctetString: number;
  readonly Null: number;
  readonly ObjectIdentifier: number;
  readonly Enumerated: number;
  readonly Utf8String: number;
  readonly PrintableString: number;
  readonly Ia5String: number;
  readonly UtcTime: number;
  readonly GeneralizedTime: number;
  readonly Sequence: number;
  readonly Set: number;
} = {
  Boolean: 0x01,
  Integer: 0x02,
  BitString: 0x03,
  OctetString: 0x04,
  Null: 0x05,
  ObjectIdentifier: 0x06,
  Enumerated: 0x0a,
  Utf8String: 0x0c,
  PrintableString: 0x13,
  Ia5String: 0x16,
  UtcTime: 0x17,
  GeneralizedTime: 0x18,
  Sequence: 0x30,
  Set: 0x31,
};

const CONSTRUCTED_BIT: number = 0x20;
const CONTEXT_SPECIFIC_CLASS: number = 0x80;
const CLASS_MASK: number = 0xc0;
const TAG_NUMBER_MASK: number = 0x1f;

/*
 * The most children read from one element into an array. Only CRL entries
 * come in larger numbers, and those are walked with forEachChild instead.
 */
const MAX_CHILDREN: number = 4096;

// Longer than any time value DER can hold; refused before it is looked at.
const MAX_TIME_LENGTH: number = 32;

/*
 * YYMMDDHHMM[SS]Z and YYYYMMDDHHMMSS[.fff]Z. Fixed-width and anchored, and
 * only ever run on at most MAX_TIME_LENGTH characters.
 */
const UTC_TIME_PATTERN: RegExp =
  /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/;
const GENERALIZED_TIME_PATTERN: RegExp =
  /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[.,](\d{1,9}))?Z$/;

export interface DerElement {
  // The identifier octet: class, constructed bit and tag number.
  readonly tag: number;
  // Offset of the identifier octet in buffer.
  readonly start: number;
  // Offset of the first content octet.
  readonly valueStart: number;
  // Offset just past the last content octet.
  readonly end: number;
  readonly buffer: Buffer;
}

export default class Der {
  /*
   * Reads the element whose identifier octet is at offset. limit is the end
   * of whatever contains it: the element must end at or before it.
   */
  public static readElement(
    buffer: Buffer,
    offset: number = 0,
    limit: number = buffer.length,
  ): DerElement {
    if (limit > buffer.length || offset < 0 || offset + 2 > limit) {
      throw new DerParseError("Truncated DER element.");
    }

    const tag: number = buffer[offset] as number;

    if ((tag & TAG_NUMBER_MASK) === TAG_NUMBER_MASK) {
      throw new DerParseError("DER high tag numbers are not supported.");
    }

    let cursor: number = offset + 1;
    const firstLengthOctet: number = buffer[cursor] as number;
    cursor++;

    let length: number = firstLengthOctet;

    if (firstLengthOctet & 0x80) {
      const lengthOctets: number = firstLengthOctet & 0x7f;

      if (lengthOctets === 0) {
        throw new DerParseError("Indefinite lengths are not allowed in DER.");
      }

      // Four octets is already 4 GiB, far beyond anything read here.
      if (lengthOctets > 4) {
        throw new DerParseError("DER length is too long.");
      }

      if (cursor + lengthOctets > limit) {
        throw new DerParseError("Truncated DER length.");
      }

      length = 0;
      for (let index: number = 0; index < lengthOctets; index++) {
        length = length * 256 + (buffer[cursor + index] as number);
      }
      cursor += lengthOctets;
    }

    const end: number = cursor + length;

    if (end > limit) {
      throw new DerParseError(
        "DER element runs past the end of what contains it.",
      );
    }

    return { tag, start: offset, valueStart: cursor, end, buffer };
  }

  // The single element a buffer holds. Bytes after it are ignored.
  public static parse(buffer: Buffer): DerElement {
    return Der.readElement(buffer, 0, buffer.length);
  }

  public static isConstructed(element: DerElement): boolean {
    return (element.tag & CONSTRUCTED_BIT) !== 0;
  }

  // [tagNumber], context-specific, primitive or constructed.
  public static isContextTag(element: DerElement, tagNumber: number): boolean {
    return (
      (element.tag & CLASS_MASK) === CONTEXT_SPECIFIC_CLASS &&
      (element.tag & TAG_NUMBER_MASK) === tagNumber
    );
  }

  public static children(element: DerElement): Array<DerElement> {
    const children: Array<DerElement> = [];

    Der.forEachChild(element, (child: DerElement) => {
      if (children.length >= MAX_CHILDREN) {
        throw new DerParseError("DER element has too many children.");
      }
      children.push(child);
    });

    return children;
  }

  /*
   * Walks the children of a constructed element without collecting them,
   * for the one place there can be very many: the entries of a CRL.
   */
  public static forEachChild(
    element: DerElement,
    visit: (child: DerElement) => void,
  ): void {
    if (!Der.isConstructed(element)) {
      throw new DerParseError("Expected a constructed DER element.");
    }

    let cursor: number = element.valueStart;

    // Every element is at least two octets long, so this always advances.
    while (cursor < element.end) {
      const child: DerElement = Der.readElement(
        element.buffer,
        cursor,
        element.end,
      );
      visit(child);
      cursor = child.end;
    }
  }

  // The content octets.
  public static value(element: DerElement): Buffer {
    return element.buffer.subarray(element.valueStart, element.end);
  }

  // The whole element, identifier and length included: what gets signed.
  public static encoded(element: DerElement): Buffer {
    return element.buffer.subarray(element.start, element.end);
  }

  public static expectTag(
    element: DerElement | undefined,
    tag: number,
    what: string,
  ): DerElement {
    if (!element) {
      throw new DerParseError(`${what} is missing.`);
    }

    if (element.tag !== tag) {
      throw new DerParseError(
        `${what} has DER tag 0x${element.tag.toString(16)}, expected 0x${tag.toString(16)}.`,
      );
    }

    return element;
  }

  public static readObjectIdentifier(element: DerElement): string {
    Der.expectTag(element, DerTag.ObjectIdentifier, "Object identifier");

    const content: Buffer = Der.value(element);

    if (content.length === 0) {
      throw new DerParseError("Empty object identifier.");
    }

    const arcs: Array<number> = [];
    let accumulator: number = 0;
    let isFirst: boolean = true;

    for (let index: number = 0; index < content.length; index++) {
      const octet: number = content[index] as number;

      // Keeps the arithmetic exact: one more 7-bit shift stays below 2^53.
      if (accumulator > 0x3fffffffffff) {
        throw new DerParseError("Object identifier arc is too large.");
      }

      accumulator = accumulator * 128 + (octet & 0x7f);

      if (octet & 0x80) {
        if (index === content.length - 1) {
          throw new DerParseError("Truncated object identifier.");
        }
        continue;
      }

      if (isFirst) {
        // The first subidentifier holds the first two arcs.
        if (accumulator < 40) {
          arcs.push(0, accumulator);
        } else if (accumulator < 80) {
          arcs.push(1, accumulator - 40);
        } else {
          arcs.push(2, accumulator - 80);
        }
        isFirst = false;
      } else {
        arcs.push(accumulator);
      }

      accumulator = 0;
    }

    return arcs.join(".");
  }

  /*
   * An INTEGER's content octets in their shortest two's-complement form, so
   * the same number compares equal however it was padded. Serial numbers are
   * compared this way: the certificate, the OCSP response and the CRL each
   * encode the serial themselves.
   */
  public static readInteger(element: DerElement): Buffer {
    Der.expectTag(element, DerTag.Integer, "Integer");

    const content: Buffer = Der.value(element);

    if (content.length === 0) {
      throw new DerParseError("Empty integer.");
    }

    let start: number = 0;

    while (start < content.length - 1) {
      const current: number = content[start] as number;
      const next: number = content[start + 1] as number;

      const isRedundantZero: boolean = current === 0x00 && (next & 0x80) === 0;
      const isRedundantOnes: boolean = current === 0xff && (next & 0x80) !== 0;

      if (!isRedundantZero && !isRedundantOnes) {
        break;
      }

      start++;
    }

    return content.subarray(start);
  }

  // A small non-negative INTEGER or ENUMERATED: a version, a status, a reason.
  public static readSmallNumber(element: DerElement, tag: number): number {
    Der.expectTag(element, tag, "Number");

    const content: Buffer = Der.value(element);

    if (content.length === 0 || content.length > 4) {
      throw new DerParseError("Number is empty or too large.");
    }

    if ((content[0] as number) & 0x80) {
      throw new DerParseError("Negative numbers are not expected here.");
    }

    let result: number = 0;
    for (const octet of content) {
      result = result * 256 + octet;
    }

    return result;
  }

  public static readBoolean(element: DerElement): boolean {
    Der.expectTag(element, DerTag.Boolean, "Boolean");

    const content: Buffer = Der.value(element);

    if (content.length !== 1) {
      throw new DerParseError("Boolean must be one octet.");
    }

    return content[0] !== 0;
  }

  /*
   * A BIT STRING's bits, as octets. Only whole octets are expected - keys
   * and signatures - so any unused bits are refused.
   */
  public static readBitString(element: DerElement): Buffer {
    Der.expectTag(element, DerTag.BitString, "Bit string");

    const content: Buffer = Der.value(element);

    if (content.length === 0) {
      throw new DerParseError("Empty bit string.");
    }

    if (content[0] !== 0) {
      throw new DerParseError("Bit string with unused bits is not expected.");
    }

    return content.subarray(1);
  }

  // The text of an IA5String, a URI or anything else read as plain text.
  public static readText(element: DerElement): string {
    return element.buffer.toString("latin1", element.valueStart, element.end);
  }

  // A UTCTime or GeneralizedTime, which DER requires to be in UTC ("Z").
  public static readTime(element: DerElement): Date {
    if (element.end - element.valueStart > MAX_TIME_LENGTH) {
      throw new DerParseError("Time value is too long.");
    }

    const text: string = Der.readText(element);

    let year: number;
    let fields: RegExpExecArray | null;

    if (element.tag === DerTag.UtcTime) {
      fields = UTC_TIME_PATTERN.exec(text);

      if (!fields) {
        throw new DerParseError(`Malformed UTCTime "${text}".`);
      }

      const twoDigitYear: number = Number(fields[1]);
      // RFC 5280 section 4.1.2.5.1: 50-99 are 19xx, 00-49 are 20xx.
      year = twoDigitYear >= 50 ? 1900 + twoDigitYear : 2000 + twoDigitYear;
    } else if (element.tag === DerTag.GeneralizedTime) {
      fields = GENERALIZED_TIME_PATTERN.exec(text);

      if (!fields) {
        throw new DerParseError(`Malformed GeneralizedTime "${text}".`);
      }

      year = Number(fields[1]);
    } else {
      throw new DerParseError(
        `Expected a time, got DER tag 0x${element.tag.toString(16)}.`,
      );
    }

    const month: number = Number(fields[2]);
    const day: number = Number(fields[3]);
    const hour: number = Number(fields[4]);
    const minute: number = Number(fields[5]);
    const second: number = fields[6] ? Number(fields[6]) : 0;
    const fraction: string | undefined =
      element.tag === DerTag.GeneralizedTime ? fields[7] : undefined;
    const milliseconds: number = fraction
      ? Math.floor(Number(`0.${fraction}`) * 1000)
      : 0;

    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 60
    ) {
      throw new DerParseError(`Time "${text}" is out of range.`);
    }

    return new Date(
      Date.UTC(year, month - 1, day, hour, minute, second, milliseconds),
    );
  }

  // Whether an element holds a time: UTCTime or GeneralizedTime.
  public static isTime(element: DerElement | undefined): boolean {
    return (
      element !== undefined &&
      (element.tag === DerTag.UtcTime || element.tag === DerTag.GeneralizedTime)
    );
  }

  public static encodeLength(length: number): Buffer {
    if (length < 0x80) {
      return Buffer.from([length]);
    }

    const octets: Array<number> = [];
    let remaining: number = length;

    while (remaining > 0) {
      octets.unshift(remaining % 256);
      remaining = Math.floor(remaining / 256);
    }

    return Buffer.from([0x80 | octets.length, ...octets]);
  }

  public static encode(tag: number, content: Buffer): Buffer {
    return Buffer.concat([
      Buffer.from([tag]),
      Der.encodeLength(content.length),
      content,
    ]);
  }

  public static encodeSequence(parts: Array<Buffer>): Buffer {
    return Der.encode(DerTag.Sequence, Buffer.concat(parts));
  }

  public static encodeOctetString(content: Buffer): Buffer {
    return Der.encode(DerTag.OctetString, content);
  }
}
