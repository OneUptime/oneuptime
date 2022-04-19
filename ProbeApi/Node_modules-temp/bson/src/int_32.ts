import type { EJSONOptions } from './extended_json';

/** @public */
export interface Int32Extended {
  $numberInt: string;
}

/**
 * A class representation of a BSON Int32 type.
 * @public
 */
export class Int32 {
  _bsontype!: 'Int32';

  value!: number;
  /**
   * Create an Int32 type
   *
   * @param value - the number we want to represent as an int32.
   */
  constructor(value: number | string) {
    if (!(this instanceof Int32)) return new Int32(value);

    if ((value as unknown) instanceof Number) {
      value = value.valueOf();
    }

    this.value = +value | 0;
  }

  /**
   * Access the number value.
   *
   * @returns returns the wrapped int32 number.
   */
  valueOf(): number {
    return this.value;
  }

  toString(radix?: number): string {
    return this.value.toString(radix);
  }

  toJSON(): number {
    return this.value;
  }

  /** @internal */
  toExtendedJSON(options?: EJSONOptions): number | Int32Extended {
    if (options && (options.relaxed || options.legacy)) return this.value;
    return { $numberInt: this.value.toString() };
  }

  /** @internal */
  static fromExtendedJSON(doc: Int32Extended, options?: EJSONOptions): number | Int32 {
    return options && options.relaxed ? parseInt(doc.$numberInt, 10) : new Int32(doc.$numberInt);
  }

  /** @internal */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.inspect();
  }

  inspect(): string {
    return `new Int32(${this.valueOf()})`;
  }
}

Object.defineProperty(Int32.prototype, '_bsontype', { value: 'Int32' });
