import { Buffer } from 'buffer';
import { ensureBuffer } from './ensure_buffer';
import { Binary } from './binary';
import { bufferToUuidHexString, uuidHexStringToBuffer, uuidValidateString } from './uuid_utils';
import { isUint8Array, randomBytes } from './parser/utils';
import { BSONTypeError } from './error';

/** @public */
export type UUIDExtended = {
  $uuid: string;
};

const BYTE_LENGTH = 16;

const kId = Symbol('id');

/**
 * A class representation of the BSON UUID type.
 * @public
 */
export class UUID {
  // This property is not meant for direct serialization, but simply an indication that this type originates from this package.
  _bsontype!: 'UUID';

  static cacheHexString: boolean;

  /** UUID Bytes @internal */
  private [kId]: Buffer;
  /** UUID hexString cache @internal */
  private __id?: string;

  /**
   * Create an UUID type
   *
   * @param input - Can be a 32 or 36 character hex string (dashes excluded/included) or a 16 byte binary Buffer.
   */
  constructor(input?: string | Buffer | UUID) {
    if (typeof input === 'undefined') {
      // The most common use case (blank id, new UUID() instance)
      this.id = UUID.generate();
    } else if (input instanceof UUID) {
      this[kId] = Buffer.from(input.id);
      this.__id = input.__id;
    } else if (ArrayBuffer.isView(input) && input.byteLength === BYTE_LENGTH) {
      this.id = ensureBuffer(input);
    } else if (typeof input === 'string') {
      this.id = uuidHexStringToBuffer(input);
    } else {
      throw new BSONTypeError(
        'Argument passed in UUID constructor must be a UUID, a 16 byte Buffer or a 32/36 character hex string (dashes excluded/included, format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).'
      );
    }
  }

  /**
   * The UUID bytes
   * @readonly
   */
  get id(): Buffer {
    return this[kId];
  }

  set id(value: Buffer) {
    this[kId] = value;

    if (UUID.cacheHexString) {
      this.__id = bufferToUuidHexString(value);
    }
  }

  /**
   * Generate a 16 byte uuid v4 buffer used in UUIDs
   */

  /**
   * Returns the UUID id as a 32 or 36 character hex string representation, excluding/including dashes (defaults to 36 character dash separated)
   * @param includeDashes - should the string exclude dash-separators.
   * */
  toHexString(includeDashes = true): string {
    if (UUID.cacheHexString && this.__id) {
      return this.__id;
    }

    const uuidHexString = bufferToUuidHexString(this.id, includeDashes);

    if (UUID.cacheHexString) {
      this.__id = uuidHexString;
    }

    return uuidHexString;
  }

  /**
   * Converts the id into a 36 character (dashes included) hex string, unless a encoding is specified.
   */
  toString(encoding?: string): string {
    return encoding ? this.id.toString(encoding) : this.toHexString();
  }

  /**
   * Converts the id into its JSON string representation.
   * A 36 character (dashes included) hex string in the format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   */
  toJSON(): string {
    return this.toHexString();
  }

  /**
   * Compares the equality of this UUID with `otherID`.
   *
   * @param otherId - UUID instance to compare against.
   */
  equals(otherId: string | Buffer | UUID): boolean {
    if (!otherId) {
      return false;
    }

    if (otherId instanceof UUID) {
      return otherId.id.equals(this.id);
    }

    try {
      return new UUID(otherId).id.equals(this.id);
    } catch {
      return false;
    }
  }

  /**
   * Creates a Binary instance from the current UUID.
   */
  toBinary(): Binary {
    return new Binary(this.id, Binary.SUBTYPE_UUID);
  }

  /**
   * Generates a populated buffer containing a v4 uuid
   */
  static generate(): Buffer {
    const bytes = randomBytes(BYTE_LENGTH);

    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    // Kindly borrowed from https://github.com/uuidjs/uuid/blob/master/src/v4.js
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return Buffer.from(bytes);
  }

  /**
   * Checks if a value is a valid bson UUID
   * @param input - UUID, string or Buffer to validate.
   */
  static isValid(input: string | Buffer | UUID): boolean {
    if (!input) {
      return false;
    }

    if (input instanceof UUID) {
      return true;
    }

    if (typeof input === 'string') {
      return uuidValidateString(input);
    }

    if (isUint8Array(input)) {
      // check for length & uuid version (https://tools.ietf.org/html/rfc4122#section-4.1.3)
      if (input.length !== BYTE_LENGTH) {
        return false;
      }

      try {
        // get this byte as hex:             xxxxxxxx-xxxx-XXxx-xxxx-xxxxxxxxxxxx
        // check first part as uuid version: xxxxxxxx-xxxx-Xxxx-xxxx-xxxxxxxxxxxx
        return parseInt(input[6].toString(16)[0], 10) === Binary.SUBTYPE_UUID;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Creates an UUID from a hex string representation of an UUID.
   * @param hexString - 32 or 36 character hex string (dashes excluded/included).
   */
  static createFromHexString(hexString: string): UUID {
    const buffer = uuidHexStringToBuffer(hexString);
    return new UUID(buffer);
  }

  /**
   * Converts to a string representation of this Id.
   *
   * @returns return the 36 character hex string representation.
   * @internal
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.inspect();
  }

  inspect(): string {
    return `new UUID("${this.toHexString()}")`;
  }
}

Object.defineProperty(UUID.prototype, '_bsontype', { value: 'UUID' });
