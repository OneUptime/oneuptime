import { Buffer } from 'buffer';
import { ensureBuffer } from './ensure_buffer';
import { BSONTypeError } from './error';
import { deprecate, isUint8Array, randomBytes } from './parser/utils';

// Regular expression that checks for hex value
const checkForHexRegExp = new RegExp('^[0-9a-fA-F]{24}$');

// Unique sequence for the current process (initialized on first use)
let PROCESS_UNIQUE: Uint8Array | null = null;

/** @public */
export interface ObjectIdLike {
  id: string | Buffer;
  __id?: string;
  toHexString(): string;
}

/** @public */
export interface ObjectIdExtended {
  $oid: string;
}

const kId = Symbol('id');

/**
 * A class representation of the BSON ObjectId type.
 * @public
 */
export class ObjectId {
  _bsontype!: 'ObjectId';

  /** @internal */
  static index = Math.floor(Math.random() * 0xffffff);

  static cacheHexString: boolean;

  /** ObjectId Bytes @internal */
  private [kId]: Buffer;
  /** ObjectId hexString cache @internal */
  private __id?: string;

  /**
   * Create an ObjectId type
   *
   * @param inputId - Can be a 24 character hex string, 12 byte binary Buffer, or a number.
   */
  constructor(inputId?: string | number | ObjectId | ObjectIdLike | Buffer | Uint8Array) {
    if (!(this instanceof ObjectId)) return new ObjectId(inputId);

    // workingId is set based on type of input and whether valid id exists for the input
    let workingId;
    if (typeof inputId === 'object' && inputId && 'id' in inputId) {
      if (typeof inputId.id !== 'string' && !ArrayBuffer.isView(inputId.id)) {
        throw new BSONTypeError(
          'Argument passed in must have an id that is of type string or Buffer'
        );
      }
      if ('toHexString' in inputId && typeof inputId.toHexString === 'function') {
        workingId = Buffer.from(inputId.toHexString(), 'hex');
      } else {
        workingId = inputId.id;
      }
    } else {
      workingId = inputId;
    }

    // the following cases use workingId to construct an ObjectId
    if (workingId == null || typeof workingId === 'number') {
      // The most common use case (blank id, new objectId instance)
      // Generate a new id
      this[kId] = ObjectId.generate(typeof workingId === 'number' ? workingId : undefined);
    } else if (ArrayBuffer.isView(workingId) && workingId.byteLength === 12) {
      this[kId] = ensureBuffer(workingId);
    } else if (typeof workingId === 'string') {
      if (workingId.length === 12) {
        const bytes = Buffer.from(workingId);
        if (bytes.byteLength === 12) {
          this[kId] = bytes;
        } else {
          throw new BSONTypeError('Argument passed in must be a string of 12 bytes');
        }
      } else if (workingId.length === 24 && checkForHexRegExp.test(workingId)) {
        this[kId] = Buffer.from(workingId, 'hex');
      } else {
        throw new BSONTypeError(
          'Argument passed in must be a string of 12 bytes or a string of 24 hex characters'
        );
      }
    } else {
      throw new BSONTypeError('Argument passed in does not match the accepted types');
    }
    // If we are caching the hex string
    if (ObjectId.cacheHexString) {
      this.__id = this.id.toString('hex');
    }
  }

  /**
   * The ObjectId bytes
   * @readonly
   */
  get id(): Buffer {
    return this[kId];
  }

  set id(value: Buffer) {
    this[kId] = value;
    if (ObjectId.cacheHexString) {
      this.__id = value.toString('hex');
    }
  }

  /**
   * The generation time of this ObjectId instance
   * @deprecated Please use getTimestamp / createFromTime which returns an int32 epoch
   */
  get generationTime(): number {
    return this.id.readInt32BE(0);
  }

  set generationTime(value: number) {
    // Encode time into first 4 bytes
    this.id.writeUInt32BE(value, 0);
  }

  /** Returns the ObjectId id as a 24 character hex string representation */
  toHexString(): string {
    if (ObjectId.cacheHexString && this.__id) {
      return this.__id;
    }

    const hexString = this.id.toString('hex');

    if (ObjectId.cacheHexString && !this.__id) {
      this.__id = hexString;
    }

    return hexString;
  }

  /**
   * Update the ObjectId index
   * @privateRemarks
   * Used in generating new ObjectId's on the driver
   * @internal
   */
  static getInc(): number {
    return (ObjectId.index = (ObjectId.index + 1) % 0xffffff);
  }

  /**
   * Generate a 12 byte id buffer used in ObjectId's
   *
   * @param time - pass in a second based timestamp.
   */
  static generate(time?: number): Buffer {
    if ('number' !== typeof time) {
      time = Math.floor(Date.now() / 1000);
    }

    const inc = ObjectId.getInc();
    const buffer = Buffer.alloc(12);

    // 4-byte timestamp
    buffer.writeUInt32BE(time, 0);

    // set PROCESS_UNIQUE if yet not initialized
    if (PROCESS_UNIQUE === null) {
      PROCESS_UNIQUE = randomBytes(5);
    }

    // 5-byte process unique
    buffer[4] = PROCESS_UNIQUE[0];
    buffer[5] = PROCESS_UNIQUE[1];
    buffer[6] = PROCESS_UNIQUE[2];
    buffer[7] = PROCESS_UNIQUE[3];
    buffer[8] = PROCESS_UNIQUE[4];

    // 3-byte counter
    buffer[11] = inc & 0xff;
    buffer[10] = (inc >> 8) & 0xff;
    buffer[9] = (inc >> 16) & 0xff;

    return buffer;
  }

  /**
   * Converts the id into a 24 character hex string for printing
   *
   * @param format - The Buffer toString format parameter.
   */
  toString(format?: string): string {
    // Is the id a buffer then use the buffer toString method to return the format
    if (format) return this.id.toString(format);
    return this.toHexString();
  }

  /** Converts to its JSON the 24 character hex string representation. */
  toJSON(): string {
    return this.toHexString();
  }

  /**
   * Compares the equality of this ObjectId with `otherID`.
   *
   * @param otherId - ObjectId instance to compare against.
   */
  equals(otherId: string | ObjectId | ObjectIdLike): boolean {
    if (otherId === undefined || otherId === null) {
      return false;
    }

    if (otherId instanceof ObjectId) {
      return this.toString() === otherId.toString();
    }

    if (
      typeof otherId === 'string' &&
      ObjectId.isValid(otherId) &&
      otherId.length === 12 &&
      isUint8Array(this.id)
    ) {
      return otherId === Buffer.prototype.toString.call(this.id, 'latin1');
    }

    if (typeof otherId === 'string' && ObjectId.isValid(otherId) && otherId.length === 24) {
      return otherId.toLowerCase() === this.toHexString();
    }

    if (typeof otherId === 'string' && ObjectId.isValid(otherId) && otherId.length === 12) {
      return Buffer.from(otherId).equals(this.id);
    }

    if (
      typeof otherId === 'object' &&
      'toHexString' in otherId &&
      typeof otherId.toHexString === 'function'
    ) {
      return otherId.toHexString() === this.toHexString();
    }

    return false;
  }

  /** Returns the generation date (accurate up to the second) that this ID was generated. */
  getTimestamp(): Date {
    const timestamp = new Date();
    const time = this.id.readUInt32BE(0);
    timestamp.setTime(Math.floor(time) * 1000);
    return timestamp;
  }

  /** @internal */
  static createPk(): ObjectId {
    return new ObjectId();
  }

  /**
   * Creates an ObjectId from a second based number, with the rest of the ObjectId zeroed out. Used for comparisons or sorting the ObjectId.
   *
   * @param time - an integer number representing a number of seconds.
   */
  static createFromTime(time: number): ObjectId {
    const buffer = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Encode time into first 4 bytes
    buffer.writeUInt32BE(time, 0);
    // Return the new objectId
    return new ObjectId(buffer);
  }

  /**
   * Creates an ObjectId from a hex string representation of an ObjectId.
   *
   * @param hexString - create a ObjectId from a passed in 24 character hexstring.
   */
  static createFromHexString(hexString: string): ObjectId {
    // Throw an error if it's not a valid setup
    if (typeof hexString === 'undefined' || (hexString != null && hexString.length !== 24)) {
      throw new BSONTypeError(
        'Argument passed in must be a single String of 12 bytes or a string of 24 hex characters'
      );
    }

    return new ObjectId(Buffer.from(hexString, 'hex'));
  }

  /**
   * Checks if a value is a valid bson ObjectId
   *
   * @param id - ObjectId instance to validate.
   */
  static isValid(id: string | number | ObjectId | ObjectIdLike | Buffer | Uint8Array): boolean {
    if (id == null) return false;

    try {
      new ObjectId(id);
      return true;
    } catch {
      return false;
    }
  }

  /** @internal */
  toExtendedJSON(): ObjectIdExtended {
    if (this.toHexString) return { $oid: this.toHexString() };
    return { $oid: this.toString('hex') };
  }

  /** @internal */
  static fromExtendedJSON(doc: ObjectIdExtended): ObjectId {
    return new ObjectId(doc.$oid);
  }

  /**
   * Converts to a string representation of this Id.
   *
   * @returns return the 24 character hex string representation.
   * @internal
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.inspect();
  }

  inspect(): string {
    return `new ObjectId("${this.toHexString()}")`;
  }
}

// Deprecated methods
Object.defineProperty(ObjectId.prototype, 'generate', {
  value: deprecate(
    (time: number) => ObjectId.generate(time),
    'Please use the static `ObjectId.generate(time)` instead'
  )
});

Object.defineProperty(ObjectId.prototype, 'getInc', {
  value: deprecate(() => ObjectId.getInc(), 'Please use the static `ObjectId.getInc()` instead')
});

Object.defineProperty(ObjectId.prototype, 'get_inc', {
  value: deprecate(() => ObjectId.getInc(), 'Please use the static `ObjectId.getInc()` instead')
});

Object.defineProperty(ObjectId, 'get_inc', {
  value: deprecate(() => ObjectId.getInc(), 'Please use the static `ObjectId.getInc()` instead')
});

Object.defineProperty(ObjectId.prototype, '_bsontype', { value: 'ObjectID' });
