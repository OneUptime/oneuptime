import { BSONError, BSONTypeError } from './error';
import type { EJSONOptions } from './extended_json';

function alphabetize(str: string): string {
  return str.split('').sort().join('');
}

/** @public */
export interface BSONRegExpExtendedLegacy {
  $regex: string | BSONRegExp;
  $options: string;
}

/** @public */
export interface BSONRegExpExtended {
  $regularExpression: {
    pattern: string;
    options: string;
  };
}

/**
 * A class representation of the BSON RegExp type.
 * @public
 */
export class BSONRegExp {
  _bsontype!: 'BSONRegExp';

  pattern!: string;
  options!: string;
  /**
   * @param pattern - The regular expression pattern to match
   * @param options - The regular expression options
   */
  constructor(pattern: string, options?: string) {
    if (!(this instanceof BSONRegExp)) return new BSONRegExp(pattern, options);

    this.pattern = pattern;
    this.options = alphabetize(options ?? '');

    if (this.pattern.indexOf('\x00') !== -1) {
      throw new BSONError(
        `BSON Regex patterns cannot contain null bytes, found: ${JSON.stringify(this.pattern)}`
      );
    }
    if (this.options.indexOf('\x00') !== -1) {
      throw new BSONError(
        `BSON Regex options cannot contain null bytes, found: ${JSON.stringify(this.options)}`
      );
    }

    // Validate options
    for (let i = 0; i < this.options.length; i++) {
      if (
        !(
          this.options[i] === 'i' ||
          this.options[i] === 'm' ||
          this.options[i] === 'x' ||
          this.options[i] === 'l' ||
          this.options[i] === 's' ||
          this.options[i] === 'u'
        )
      ) {
        throw new BSONError(`The regular expression option [${this.options[i]}] is not supported`);
      }
    }
  }

  static parseOptions(options?: string): string {
    return options ? options.split('').sort().join('') : '';
  }

  /** @internal */
  toExtendedJSON(options?: EJSONOptions): BSONRegExpExtendedLegacy | BSONRegExpExtended {
    options = options || {};
    if (options.legacy) {
      return { $regex: this.pattern, $options: this.options };
    }
    return { $regularExpression: { pattern: this.pattern, options: this.options } };
  }

  /** @internal */
  static fromExtendedJSON(doc: BSONRegExpExtendedLegacy | BSONRegExpExtended): BSONRegExp {
    if ('$regex' in doc) {
      if (typeof doc.$regex !== 'string') {
        // This is for $regex query operators that have extended json values.
        if (doc.$regex._bsontype === 'BSONRegExp') {
          return doc as unknown as BSONRegExp;
        }
      } else {
        return new BSONRegExp(doc.$regex, BSONRegExp.parseOptions(doc.$options));
      }
    }
    if ('$regularExpression' in doc) {
      return new BSONRegExp(
        doc.$regularExpression.pattern,
        BSONRegExp.parseOptions(doc.$regularExpression.options)
      );
    }
    throw new BSONTypeError(`Unexpected BSONRegExp EJSON object form: ${JSON.stringify(doc)}`);
  }
}

Object.defineProperty(BSONRegExp.prototype, '_bsontype', { value: 'BSONRegExp' });
