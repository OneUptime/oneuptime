/** @public */
export interface MaxKeyExtended {
  $maxKey: 1;
}

/**
 * A class representation of the BSON MaxKey type.
 * @public
 */
export class MaxKey {
  _bsontype!: 'MaxKey';

  constructor() {
    if (!(this instanceof MaxKey)) return new MaxKey();
  }

  /** @internal */
  toExtendedJSON(): MaxKeyExtended {
    return { $maxKey: 1 };
  }

  /** @internal */
  static fromExtendedJSON(): MaxKey {
    return new MaxKey();
  }

  /** @internal */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.inspect();
  }

  inspect(): string {
    return 'new MaxKey()';
  }
}

Object.defineProperty(MaxKey.prototype, '_bsontype', { value: 'MaxKey' });
