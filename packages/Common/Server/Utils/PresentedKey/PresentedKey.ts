import { EncryptionSecret } from "../../EnvironmentConfig";
import SecretKeyComparison from "../SecretKeyComparison";
import TableColumnType from "../../../Types/Database/TableColumnType";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import crypto from "crypto";

// How a key kept only as its hash begins, as PasswordHash's "scrypt$" does.
export const STORED_HASH_PREFIX: string = "sha256$";

// A key kept as its hash: the prefix and 64 lower-case hex digits.
export const STORED_HASH_PATTERN: RegExp = /^sha256\$[0-9a-f]{64}$/;

/*
 * A KEY OR A TOKEN PRESENTED TO ONEUPTIME, KEPT ENCRYPTED AT REST (#9012).
 *
 * A probe's, a Runner's or an AI agent's key, a telemetry ingestion key, a
 * monitor's or a workflow's secret key, a badge's token: each is presented
 * to OneUptime by something outside it, and the people who may read it see
 * it again - in a setup command, a URL, an address. So it is kept encrypted
 * (TableColumnMetadata.presentedKey, encrypted: true), and a key presented
 * is checked against the one stored, decrypted, in constant time (matches).
 *
 * A request that names its record by the key alone - a monitor's heartbeat
 * URL, an ingestion key - finds it by the key's lookup hash (hash), kept in
 * a column beside it (TableColumnMetadata.lookupHashColumn): a ciphertext
 * differs on every write, so no query could find the key itself. The hash
 * is the SHA-256 of the key with the server's ENCRYPTION_SECRET
 * (HashedString), as an API key's is (HashedApiKey): a dump or a backup that
 * holds it holds nothing that lets anyone in.
 *
 * A key is compared as its column compared it before it was encrypted: a key
 * kept in what was a uuid column (an ObjectID column: a monitor's keys, an
 * ingestion key) whatever the case of its hex digits, as Postgres compared
 * uuids, and any other key exactly as written.
 *
 * A key nobody needs to read again - a SCIM bearer token, pasted once into
 * the identity provider - is kept only as its hash instead (toStoredHash),
 * and shown once, when it is made.
 */
export default class PresentedKey {
  /*
   * The key as it is hashed and compared, or null for no key at all: an
   * ObjectID column's key trimmed and in lower case, any other as written.
   */
  public static normalize(
    value: string | ObjectID | null | undefined,
    columnType: TableColumnType,
  ): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const text: string = value.toString();

    if (columnType === TableColumnType.ObjectID) {
      const normalized: string = text.trim().toLowerCase();
      return normalized || null;
    }

    return text || null;
  }

  /*
   * The key's lookup hash: what its lookup hash column holds, and what a
   * request's key is looked up by. Null for no key.
   */
  public static hash(
    value: string | ObjectID | null | undefined,
    columnType: TableColumnType,
  ): string | null {
    const normalized: string | null = PresentedKey.normalize(value, columnType);

    if (!normalized) {
      return null;
    }

    return HashedString.computeHash(normalized, EncryptionSecret);
  }

  /*
   * Whether a key a request presents is the key stored, as read (decrypted,
   * or a key stored before its column was encrypted). In constant time: both
   * sides are hashed to a digest of one length first
   * (SecretKeyComparison), so how long it takes says nothing of either.
   * Never throws; no key matches no key.
   */
  public static matches(data: {
    presented: string | ObjectID | null | undefined;
    stored: string | ObjectID | null | undefined;
    columnType: TableColumnType;
  }): boolean {
    const presented: string | null = PresentedKey.normalize(
      data.presented,
      data.columnType,
    );
    const stored: string | null = PresentedKey.normalize(
      data.stored,
      data.columnType,
    );

    /*
     * Compared whatever the inputs, so a missing key costs what a wrong one
     * does; only then is a missing one refused.
     */
    const isEqual: boolean = SecretKeyComparison.timingSafeEqual(
      presented || "",
      stored || "",
    );

    return Boolean(presented) && Boolean(stored) && isEqual;
  }

  /*
   * A new key, made by OneUptime: 256 bits from the server's secure random
   * source, as 64 hex digits - what the Dashboard makes for a SCIM bearer
   * token too (TightenOnlyUpdates.generateScimBearerToken).
   */
  public static generate(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /*
   * A KEY KEPT ONLY AS ITS HASH: a SCIM bearer token. Nobody needs to read
   * one again - it is pasted once into the identity provider - so it is
   * kept as STORED_HASH_PREFIX and its hash, and shown once, when it is
   * made. The prefix tells a hash from a token stored as written before
   * (a token the Dashboard made was 64 hex digits, as a SHA-256 digest is),
   * so a hash can never be presented as the token it hashes.
   */
  public static toStoredHash(value: string): string {
    return `${STORED_HASH_PREFIX}${HashedString.computeHash(value, EncryptionSecret)}`;
  }

  // Whether a stored value is a key's hash (toStoredHash), not a key.
  public static isStoredHash(value: string | null | undefined): boolean {
    return STORED_HASH_PATTERN.test(value || "");
  }
}
