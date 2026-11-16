import { EncryptionSecret } from "../EnvironmentConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import crypto from "crypto";

/*
 * THE SERVER'S MASTER API KEY, STORED HASHED (#7901).
 *
 * The master API key (Admin Dashboard > Settings > API Key) has root access
 * to every project on the server. A request names it in its ApiKey header,
 * so it is looked up by value - which is why it cannot be encrypted as the
 * server's other credentials are (#7739): a ciphertext differs on every
 * write. It is kept the way the server keeps the other high-entropy values
 * it mints (session refresh tokens, verification and reset tokens): as the
 * SHA-256 of the key with the server's ENCRYPTION_SECRET (HashedString), so
 * a database dump or a backup holds nothing that lets anyone in.
 *
 * The key is a random version 4 uuid, made on the server (generate), and
 * shown once, when it is made: nothing can read it back.
 *
 * What this decides, in one place for the writer (GlobalConfigService), the
 * lookup (ProjectAuthorization.isMasterApiKey) and the data migration that
 * hashes the key stored before (HashMasterApiKey):
 *
 *   normalize  the key as it is hashed: trimmed and lower-cased. A uuid's
 *              hex digits are its value whatever their case - Postgres
 *              matched an upper-case key against the uuid column it was
 *              stored in - so a key keeps working however a client writes
 *              it. Anything that is not a uuid is no key at all.
 *   hash       the digest stored.
 *   matches    whether a key a request presents is the one stored,
 *              compared in constant time (HashedString.isEqual): the
 *              digest of the key presented against the digest stored - or,
 *              for a key stored before it was hashed and not hashed yet
 *              (isStoredAsWritten), the key against the key. A digest is 64
 *              hex digits and never a uuid, so the two never mix up.
 */
export default class MasterApiKey {
  // A new key: a random version 4 uuid from the server's own random source.
  public static generate(): string {
    return crypto.randomUUID();
  }

  /*
   * The key as it is hashed and compared: trimmed and lower-cased. Null for
   * a value that is not a uuid, which no master API key ever was.
   */
  public static normalize(
    key: string | ObjectID | null | undefined,
  ): string | null {
    const text: string = (key ? key.toString() : "").trim().toLowerCase();

    return ObjectID.isValidUUID(text) ? text : null;
  }

  // The digest a key is stored as: SHA-256 of the key with ENCRYPTION_SECRET.
  public static hash(key: string | ObjectID): string {
    const normalized: string | null = MasterApiKey.normalize(key);

    if (!normalized) {
      throw new BadDataException("A master API key is a uuid.");
    }

    return HashedString.computeHash(normalized, EncryptionSecret);
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
    const presentedKey: string | null = MasterApiKey.normalize(
      data.presentedKey,
    );
    const storedValue: string = (data.storedValue || "").trim();

    if (!presentedKey || !storedValue) {
      return false;
    }

    if (MasterApiKey.isStoredAsWritten(storedValue)) {
      return HashedString.isEqual(presentedKey, storedValue.toLowerCase());
    }

    return HashedString.isEqual(
      HashedString.computeHash(presentedKey, EncryptionSecret),
      storedValue,
    );
  }
}
