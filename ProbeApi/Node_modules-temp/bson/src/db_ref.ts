import type { Document } from './bson';
import type { EJSONOptions } from './extended_json';
import type { ObjectId } from './objectid';
import { isObjectLike } from './parser/utils';

/** @public */
export interface DBRefLike {
  $ref: string;
  $id: ObjectId;
  $db?: string;
}

/** @internal */
export function isDBRefLike(value: unknown): value is DBRefLike {
  return (
    isObjectLike(value) &&
    value.$id != null &&
    typeof value.$ref === 'string' &&
    (value.$db == null || typeof value.$db === 'string')
  );
}

/**
 * A class representation of the BSON DBRef type.
 * @public
 */
export class DBRef {
  _bsontype!: 'DBRef';

  collection!: string;
  oid!: ObjectId;
  db?: string;
  fields!: Document;

  /**
   * @param collection - the collection name.
   * @param oid - the reference ObjectId.
   * @param db - optional db name, if omitted the reference is local to the current db.
   */
  constructor(collection: string, oid: ObjectId, db?: string, fields?: Document) {
    if (!(this instanceof DBRef)) return new DBRef(collection, oid, db, fields);

    // check if namespace has been provided
    const parts = collection.split('.');
    if (parts.length === 2) {
      db = parts.shift();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      collection = parts.shift()!;
    }

    this.collection = collection;
    this.oid = oid;
    this.db = db;
    this.fields = fields || {};
  }

  // Property provided for compatibility with the 1.x parser
  // the 1.x parser used a "namespace" property, while 4.x uses "collection"

  /** @internal */
  get namespace(): string {
    return this.collection;
  }

  set namespace(value: string) {
    this.collection = value;
  }

  toJSON(): DBRefLike & Document {
    const o = Object.assign(
      {
        $ref: this.collection,
        $id: this.oid
      },
      this.fields
    );

    if (this.db != null) o.$db = this.db;
    return o;
  }

  /** @internal */
  toExtendedJSON(options?: EJSONOptions): DBRefLike {
    options = options || {};
    let o: DBRefLike = {
      $ref: this.collection,
      $id: this.oid
    };

    if (options.legacy) {
      return o;
    }

    if (this.db) o.$db = this.db;
    o = Object.assign(o, this.fields);
    return o;
  }

  /** @internal */
  static fromExtendedJSON(doc: DBRefLike): DBRef {
    const copy = Object.assign({}, doc) as Partial<DBRefLike>;
    delete copy.$ref;
    delete copy.$id;
    delete copy.$db;
    return new DBRef(doc.$ref, doc.$id, doc.$db, copy);
  }

  /** @internal */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.inspect();
  }

  inspect(): string {
    // NOTE: if OID is an ObjectId class it will just print the oid string.
    const oid =
      this.oid === undefined || this.oid.toString === undefined ? this.oid : this.oid.toString();
    return `new DBRef("${this.namespace}", new ObjectId("${oid}")${
      this.db ? `, "${this.db}"` : ''
    })`;
  }
}

Object.defineProperty(DBRef.prototype, '_bsontype', { value: 'DBRef' });
