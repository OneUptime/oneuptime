import { EncryptionSecret } from "../../EnvironmentConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import crypto from "crypto";

/*
 * AN API KEY, STORED HASHED: the server's master API key (#7901) and every
 * project's API keys (#8902).
 *
 * A request names its key in its ApiKey header, so a key is looked up by
 * value - which is why it cannot be encrypted as the server's other
 * credentials are (#7739): a ciphertext differs on every write. It is kept
 * the way the server keeps the other high-entropy values it mints (session
 * refresh tokens, verification and reset tokens): as the SHA-256 of the key
 * with the server's ENCRYPTION_SECRET (HashedString), so a database dump or
 * a backup holds nothing that lets anyone in.
 *
 * A key is a random version 4 uuid, made on the server (generate), and
 * shown once, when it is made: nothing can read it back. What is kept
 * beside its hash is its hint - its last four characters - so a person can
 * tell one key from another, and match a key they hold against it. Four hex
 * digits of a 122-bit random key leave 106 bits to guess: the hint is never
 * enough to use the key.
 *
 * What this decides, in one place for the writers (GlobalConfigService,
 * ApiKeyService), the lookups (ProjectAuthorization.isMasterApiKey,
 * ApiKeyService.findApiKey) and the data migrations that hash the keys
 * stored before (HashMasterApiKey, HashProjectApiKeys):
 *
 *   normalize  the key as it is hashed: trimmed and lower-cased. A uuid's
 *              hex digits are its value whatever their case - Postgres
 *              matched an upper-case key against the uuid column it was
 *              stored in - so a key keeps working however a client writes
 *              it. Anything that is not a uuid is no key at all.
 *   hash       the digest stored.
 *   getHint    the last four characters, shown in place of the key.
 *   matches    whether a key a request presents is the one stored,
 *              compared in constant time (HashedString.isEqual): the
 *              digest of the key presented against the digest stored - or,
 *              for a key stored before it was hashed and not hashed yet
 *              (isStoredAsWritten), the key against the key. A digest is 64
 *              hex digits and never a uuid, so the two never mix up.
 */

// A SHA-256 digest, as HashedString writes it: 64 lower-case hex digits.
export const API_KEY_HASH_PATTERN: RegExp = /^[0-9a-f]{64}$/;

// A key's hint: its last four characters, lower-case hex.
export const API_KEY_HINT_PATTERN: RegExp = /^[0-9a-f]{4}$/;

export const API_KEY_HINT_LENGTH: number = 4;

export default class HashedApiKey {
  // A new key: a random version 4 uuid from the server's own random source.
  public static generate(): string {
    return crypto.randomUUID();
  }

  /*
   * The key as it is hashed and compared: trimmed and lower-cased. Null for
   * a value that is not a uuid, which no API key ever was.
   */
  public static normalize(
    key: string | ObjectID | null | undefined,
  ): string | null {
    const text: string = (key ? key.toString() : "").trim().toLowerCase();

    return ObjectID.isValidUUID(text) ? text : null;
  }

  // The digest a key is stored as: SHA-256 of the key with ENCRYPTION_SECRET.
  public static hash(key: string | ObjectID): string {
    const normalized: string | null = HashedApiKey.normalize(key);

    if (!normalized) {
      throw new BadDataException("An API key is a uuid.");
    }

    return HashedString.computeHash(normalized, EncryptionSecret);
  }

  /*
   * The key's hint: its last four characters, which the pages show in place
   * of the key ("ends in 2b34"). Never enough to use it.
   */
  public static getHint(key: string | ObjectID): string {
    const normalized: string | null = HashedApiKey.normalize(key);

    if (!normalized) {
      throw new BadDataException("An API key is a uuid.");
    }

    return normalized.slice(-API_KEY_HINT_LENGTH);
  }

  // Whether a value is a key's digest, as hash writes it.
  public static isHash(value: string | null | undefined): boolean {
    return API_KEY_HASH_PATTERN.test(value || "");
  }

  /*
   * Whether a value stored is a key as it was written, before the key was
   * stored hashed: a uuid. A digest never is one.
   */
  public static isStoredAsWritten(storedValue: string): boolean {
    return ObjectID.isValidUUID(storedValue.trim());
  }

  // Whether a key a request presents is the key stored. Never throws.
  public static matches(data: {
    presentedKey: string | ObjectID | null | undefined;
    storedValue: string | null | undefined;
  }): boolean {
    const presentedKey: string | null = HashedApiKey.normalize(
      data.presentedKey,
    );
    const storedValue: string = (data.storedValue || "").trim();

    if (!presentedKey || !storedValue) {
      return false;
    }

    if (HashedApiKey.isStoredAsWritten(storedValue)) {
      return HashedString.isEqual(presentedKey, storedValue.toLowerCase());
    }

    return HashedString.isEqual(
      HashedString.computeHash(presentedKey, EncryptionSecret),
      storedValue,
    );
  }
}
