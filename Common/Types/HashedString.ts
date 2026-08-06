import UUID from "../Utils/UUID";
import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import BadOperationException from "./Exception/BadOperationException";
import { JSONObject, ObjectType } from "./JSON";
import ObjectID from "./ObjectID";
import CryptoJS from "crypto-js";
import { FindOperator } from "typeorm";

/*
 * SHA-256 hashing for values that are ALREADY high-entropy: session refresh
 * tokens, email verification tokens, reset tokens, permission fingerprints.
 * Those are random values the server minted, so there is nothing to guess and
 * a fast hash is the right tool — it also keeps them searchable by hash,
 * which is how they are looked up.
 *
 * User passwords are NOT hashed here any more. A password is low-entropy and
 * guessable, so it goes through scrypt in Common/Server/Utils/PasswordHash,
 * which is deliberately slow and memory-hard. What remains in this class is
 * the two SHA-256 schemes passwords used to be stored under, kept so those
 * rows still verify (and are then upgraded) at their owner's next login:
 *
 *   no salt   `SHA256(secret + value)`, from before per-user salts existed.
 *   salted    `SHA256("v2:" + salt + ":" + secret + ":" + value)`.
 *
 * Neither records its scheme in the digest — it is a bare hex SHA-256 either
 * way — so they are told apart by whether the row carries a salt. The "v2"
 * prefix and the separators exist for domain separation: without them a
 * crafted salt could make a salted input collide with an unsalted one.
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
   * Adopt an already-computed digest.
   *
   * For hashes this class does not compute itself — user passwords go
   * through scrypt in Common/Server/Utils/PasswordHash, which is server-only
   * because this type is also bundled into the browser. The guard is the
   * same one hashValue() carries: a value is hashed once and never re-hashed
   * over the top of itself.
   */
  public setHashedValue(hashedValue: string): void {
    if (this.isHashed) {
      throw new BadOperationException("Value is already hashed");
    }

    this.isHashed = true;
    this.value = hashedValue;
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
