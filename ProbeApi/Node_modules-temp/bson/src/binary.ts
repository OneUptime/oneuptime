import { Buffer } from 'buffer';
import { ensureBuffer } from './ensure_buffer';
import { uuidHexStringToBuffer } from './uuid_utils';
import { UUID, UUIDExtended } from './uuid';
import type { EJSONOptions } from './extended_json';
import { BSONError, BSONTypeError } from './error';

/** @public */
export type BinarySequence = Uint8Array | Buffer | number[];

/** @public */
export interface BinaryExtendedLegacy {
  $type: string;
  $binary: string;
}

/** @public */
export interface BinaryExtended {
  $binary: {
    subType: string;
    base64: string;
  };
}

/**
 * A class representation of the BSON Binary type.
 * @public
 */
export class Binary {
  _bsontype!: 'Binary';

  /**
   * Binary default subtype
   * @internal
   */
  private static readonly BSON_BINARY_SUBTYPE_DEFAULT = 0;

  /** Initial buffer default size */
  static readonly BUFFER_SIZE = 256;
  /** Default BSON type */
  static readonly SUBTYPE_DEFAULT = 0;
  /** Function BSON type */
  static readonly SUBTYPE_FUNCTION = 1;
  /** Byte Array BSON type */
  static readonly SUBTYPE_BYTE_ARRAY = 2;
  /** Deprecated UUID BSON type @deprecated Please use SUBTYPE_UUID */
  static readonly SUBTYPE_UUID_OLD = 3;
  /** UUID BSON type */
  static readonly SUBTYPE_UUID = 4;
  /** MD5 BSON type */
  static readonly SUBTYPE_MD5 = 5;
  /** Encrypted BSON type */
  static readonly SUBTYPE_ENCRYPTED = 6;
  /** Column BSON type */
  static readonly SUBTYPE_COLUMN = 7;
  /** User BSON type */
  static readonly SUBTYPE_USER_DEFINED = 128;

  buffer!: Buffer;
  sub_type!: number;
  position!: number;

  /**
   * @param buffer - a buffer object containing the binary data.
   * @param subType - the option binary type.
   */
  constructor(buffer?: string | BinarySequence, subType?: number) {
    if (!(this instanceof Binary)) return new Binary(buffer, subType);

    if (
      !(buffer == null) &&
      !(typeof buffer === 'string') &&
      !ArrayBuffer.isView(buffer) &&
      !(buffer instanceof ArrayBuffer) &&
      !Array.isArray(buffer)
    ) {
      throw new BSONTypeError(
        'Binary can only be constructed from string, Buffer, TypedArray, or Array<number>'
      );
    }

    this.sub_type = subType ?? Binary.BSON_BINARY_SUBTYPE_DEFAULT;

    if (buffer == null) {
      // create an empty binary buffer
      this.buffer = Buffer.alloc(Binary.BUFFER_SIZE);
      this.position = 0;
    } else {
      if (typeof buffer === 'string') {
        // string
        this.buffer = Buffer.from(buffer, 'binary');
      } else if (Array.isArray(buffer)) {
        // number[]
        this.buffer = Buffer.from(buffer);
      } else {
        // Buffer | TypedArray | ArrayBuffer
        this.buffer = ensureBuffer(buffer);
      }

      this.position = this.buffer.byteLength;
    }
  }

  /**
   * Updates this binary with byte_value.
   *
   * @param byteValue - a single byte we wish to write.
   */
  put(byteValue: string | number | Uint8Array | Buffer | number[]): void {
    // If it's a string and a has more than one character throw an error
    if (typeof byteValue === 'string' && byteValue.length !== 1) {
      throw new BSONTypeError('only accepts single character String');
    } else if (typeof byteValue !== 'number' && byteValue.length !== 1)
      throw new BSONTypeError('only accepts single character Uint8Array or Array');

    // Decode the byte value once
    let decodedByte: number;
    if (typeof byteValue === 'string') {
      decodedByte = byteValue.charCodeAt(0);
    } else if (typeof byteValue === 'number') {
      decodedByte = byteValue;
    } else {
      decodedByte = byteValue[0];
    }

    if (decodedByte < 0 || decodedByte > 255) {
      throw new BSONTypeError('only accepts number in a valid unsigned byte range 0-255');
    }

    if (this.buffer.length > this.position) {
      this.buffer[this.position++] = decodedByte;
    } else {
      const buffer = Buffer.alloc(Binary.BUFFER_SIZE + this.buffer.length);
      // Combine the two buffers together
      this.buffer.copy(buffer, 0, 0, this.buffer.length);
      this.buffer = buffer;
      this.buffer[this.position++] = decodedByte;
    }
  }

  /**
   * Writes a buffer or string to the binary.
   *
   * @param sequence - a string or buffer to be written to the Binary BSON object.
   * @param offset - specify the binary of where to write the content.
   */
  write(sequence: string | BinarySequence, offset: number): void {
    offset = typeof offset === 'number' ? offset : this.position;

    // If the buffer is to small let's extend the buffer
    if (this.buffer.length < offset + sequence.length) {
      const buffer = Buffer.alloc(this.buffer.length + sequence.length);
      this.buffer.copy(buffer, 0, 0, this.buffer.length);

      // Assign the new buffer
      this.buffer = buffer;
    }

    if (ArrayBuffer.isView(sequence)) {
      this.buffer.set(ensureBuffer(sequence), offset);
      this.position =
        offset + sequence.byteLength > this.position ? offset + sequence.length : this.position;
    } else if (typeof sequence === 'string') {
      this.buffer.write(sequence, offset, sequence.length, 'binary');
      this.position =
        offset + sequence.length > this.position ? offset + sequence.length : this.position;
    }
  }

  /**
   * Reads **length** bytes starting at **position**.
   *
   * @param position - read from the given position in the Binary.
   * @param length - the number of bytes to read.
   */
  read(position: number, length: number): BinarySequence {
    length = length && length > 0 ? length : this.position;

    // Let's return the data based on the type we have
    return this.buffer.slice(position, position + length);
  }

  /**
   * Returns the value of this binary as a string.
   * @param asRaw - Will skip converting to a string
   * @remarks
   * This is handy when calling this function conditionally for some key value pairs and not others
   */
  value(asRaw?: boolean): string | BinarySequence {
    asRaw = !!asRaw;

    // Optimize to serialize for the situation where the data == size of buffer
    if (asRaw && this.buffer.length === this.position) {
      return this.buffer;
    }

    // If it's a node.js buffer object
    if (asRaw) {
      return this.buffer.slice(0, this.position);
    }
    return this.buffer.toString('binary', 0, this.position);
  }

  /** the length of the binary sequence */
  length(): number {
    return this.position;
  }

  toJSON(): string {
    return this.buffer.toString('base64');
  }

  toString(format?: string): string {
    return this.buffer.toString(format);
  }

  /** @internal */
  toExtendedJSON(options?: EJSONOptions): BinaryExtendedLegacy | BinaryExtended {
    options = options || {};
    const base64String = this.buffer.toString('base64');

    const subType = Number(this.sub_type).toString(16);
    if (options.legacy) {
      return {
        $binary: base64String,
        $type: subType.length === 1 ? '0' + subType : subType
      };
    }
    return {
      $binary: {
        base64: base64String,
        subType: subType.length === 1 ? '0' + subType : subType
      }
    };
  }

  toUUID(): UUID {
    if (this.sub_type === Binary.SUBTYPE_UUID) {
      return new UUID(this.buffer.slice(0, this.position));
    }

    throw new BSONError(
      `Binary sub_type "${this.sub_type}" is not supported for converting to UUID. Only "${Binary.SUBTYPE_UUID}" is currently supported.`
    );
  }

  /** @internal */
  static fromExtendedJSON(
    doc: BinaryExtendedLegacy | BinaryExtended | UUIDExtended,
    options?: EJSONOptions
  ): Binary {
    options = options || {};
    let data: Buffer | undefined;
    let type;
    if ('$binary' in doc) {
      if (options.legacy && typeof doc.$binary === 'string' && '$type' in doc) {
        type = doc.$type ? parseInt(doc.$type, 16) : 0;
        data = Buffer.from(doc.$binary, 'base64');
      } else {
        if (typeof doc.$binary !== 'string') {
          type = doc.$binary.subType ? parseInt(doc.$binary.subType, 16) : 0;
          data = Buffer.from(doc.$binary.base64, 'base64');
        }
      }
    } else if ('$uuid' in doc) {
      type = 4;
      data = uuidHexStringToBuffer(doc.$uuid);
    }
    if (!data) {
      throw new BSONTypeError(`Unexpected Binary Extended JSON format ${JSON.stringify(doc)}`);
    }
    return new Binary(data, type);
  }

  /** @internal */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.inspect();
  }

  inspect(): string {
    const asBuffer = this.value(true);
    return `new Binary(Buffer.from("${asBuffer.toString('hex')}", "hex"), ${this.sub_type})`;
  }
}

Object.defineProperty(Binary.prototype, '_bsontype', { value: 'Binary' });
