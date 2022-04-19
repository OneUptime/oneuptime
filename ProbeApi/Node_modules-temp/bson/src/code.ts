import type { Document } from './bson';

/** @public */
export interface CodeExtended {
  $code: string | Function;
  $scope?: Document;
}

/**
 * A class representation of the BSON Code type.
 * @public
 */
export class Code {
  _bsontype!: 'Code';

  code!: string | Function;
  scope?: Document;
  /**
   * @param code - a string or function.
   * @param scope - an optional scope for the function.
   */
  constructor(code: string | Function, scope?: Document) {
    if (!(this instanceof Code)) return new Code(code, scope);

    this.code = code;
    this.scope = scope;
  }

  toJSON(): { code: string | Function; scope?: Document } {
    return { code: this.code, scope: this.scope };
  }

  /** @internal */
  toExtendedJSON(): CodeExtended {
    if (this.scope) {
      return { $code: this.code, $scope: this.scope };
    }

    return { $code: this.code };
  }

  /** @internal */
  static fromExtendedJSON(doc: CodeExtended): Code {
    return new Code(doc.$code, doc.$scope);
  }

  /** @internal */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.inspect();
  }

  inspect(): string {
    const codeJson = this.toJSON();
    return `new Code("${codeJson.code}"${
      codeJson.scope ? `, ${JSON.stringify(codeJson.scope)}` : ''
    })`;
  }
}

Object.defineProperty(Code.prototype, '_bsontype', { value: 'Code' });
