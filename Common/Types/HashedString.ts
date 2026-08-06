import UUID from "../Utils/UUID";
import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import BadOperationException from "./Exception/BadOperationException";
import { JSONObject, ObjectType } from "./JSON";
import ObjectID from "./ObjectID";
import CryptoJS from "crypto-js";
import { FindOperator } from "typeorm";

/*
 * Hashing scheme marker for salted hashes.
 *
 * Values hashed before per-user salts existed are `SHA256(secret + value)`.
 * Salted values are `SHA256("v2:" + salt + ":" + secret + ":" + value)`. The
 * scheme is NOT recorded in the digest itself (it is a bare hex SHA-256
 * either way) — the caller knows which one to use because the salted scheme
 * is exactly the case where a salt was stored alongside the hash. The prefix
 * and separators exist for domain separation: without them a crafted salt
 * could make a salted input collide with a legacy one.
 */
const SALTED_HASH_SCHEME_VERSION: string = "v2";

export default class HashedString extends DatabaseProperty {
  private isHashed: boolean = false;

  private _value: string = "";
  public get value(): string {
    return this._value;
  }
  public set value(v: string) {
    this._value = v;
  }

  public constructor(value: string, isValueHashed: boolean = false) {
    super();
    this.value = value;
    this.isHashed = isValueHashed;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.HashedString,
      value: (this as HashedString).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): HashedString {
    if (json["_type"] === ObjectType.HashedString) {
      return new HashedString((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public override toString(): string {
    return this.value;
  }

  public static generate(): HashedString {
    return new this(UUID.generate());
  }

  protected static override toDatabase(
    value: HashedString | FindOperator<HashedString>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new HashedString(value);
      }

      return value.toString();
    }

    return null;
  }

  public isValueHashed(): boolean {
    return this.isHashed;
  }

  /**
   * A fresh, cryptographically random salt: 64 hex characters (two UUIDv4s
   * worth of randomness, ~244 bits) — comfortably above the 128 bits
   * recommended for a salt, and short enough to fit a ShortText column.
   *
   * A salt is not a secret. Its job is to be UNIQUE per record, so that one
   * precomputed table (or one cracked password) cannot be reused against any
   * other record, and so that two accounts sharing a password do not share a
   * stored hash.
   */
  public static generateSalt(): string {
    return (UUID.generate() + UUID.generate()).replace(/-/g, "");
  }

  /**
   * The exact byte string fed to SHA-256.
   *
   * The unsalted branch MUST stay byte-for-byte identical forever: every
   * password hashed before per-user salts existed is verified through it.
   */
  private static buildValueToHash(
    value: string,
    encryptionSecret: ObjectID | null,
    salt: string | null,
  ): string {
    if (!salt) {
      return (encryptionSecret || "") + value;
    }

    return `${SALTED_HASH_SCHEME_VERSION}:${salt}:${
      encryptionSecret || ""
    }:${value}`;
  }

  public static computeHash(
    value: string,
    encryptionSecret: ObjectID | null,
    salt?: string | null,
  ): string {
    if (!value) {
      return "";
    }

    return CryptoJS.SHA256(
      HashedString.buildValueToHash(value, encryptionSecret, salt || null),
    ).toString();
  }

  public async hashValue(
    encryptionSecret: ObjectID | null,
    salt?: string | null,
  ): Promise<string> {
    if (!this.value) {
      return "";
    }

    if (this.isHashed) {
      throw new BadOperationException("Value is already hashed");
    }

    this.isHashed = true;

    this.value = HashedString.computeHash(
      this.value,
      encryptionSecret,
      salt || null,
    );
    return this.value;
  }

  public static async hashValue(
    value: string,
    encryptionSecret: ObjectID | null,
    salt?: string | null,
  ): Promise<string> {
    const hashstring: HashedString = new HashedString(value, false);
    return await hashstring.hashValue(encryptionSecret, salt || null);
  }

  /**
   * Compare two already-hashed values without leaking, through timing, how
   * many leading characters matched. Comparing digests with `===` lets an
   * attacker who can measure response time recover a stored hash one
   * character at a time; recovering the hash is what makes offline cracking
   * possible in the first place.
   *
   * Lengths are compared up front. Digests here are always the same length,
   * so an early exit only happens on malformed input, where the length is
   * not the secret.
   */
  public static isEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let difference: number = 0;

    for (let i: number = 0; i < a.length; i++) {
      difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return difference === 0;
  }

  /**
   * Verify a plaintext value against a stored hash.
   *
   * Pass the salt stored alongside the hash. Pass null/undefined for records
   * written before per-user salts existed — those verify against the legacy
   * unsalted scheme, and the caller should re-hash them with a fresh salt
   * once the value is known to be correct.
   */
  public static async verifyValue(data: {
    plainValue: string;
    hashedValue: string;
    encryptionSecret: ObjectID | null;
    salt?: string | null | undefined;
  }): Promise<boolean> {
    if (!data.plainValue || !data.hashedValue) {
      return false;
    }

    return HashedString.isEqual(
      HashedString.computeHash(
        data.plainValue,
        data.encryptionSecret,
        data.salt || null,
      ),
      data.hashedValue,
    );
  }

  protected static override fromDatabase(_value: string): HashedString | null {
    if (_value) {
      return new HashedString(_value, true);
    }

    return null;
  }

  public static fromString(value: string): HashedString {
    return new HashedString(value, false);
  }
}
