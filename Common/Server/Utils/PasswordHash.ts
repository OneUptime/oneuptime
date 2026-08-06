import { EncryptionSecret } from "../EnvironmentConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import HashedString from "../../Types/HashedString";
import crypto from "crypto";

/*
 * Password hashing for user credentials.
 *
 * WHY THIS IS NOT A PLAIN HASH
 *
 * SHA-256 is designed to be fast, and that is exactly wrong for a password.
 * A commodity GPU computes billions of SHA-256 digests per second, so a
 * leaked User table is a dictionary attack that finishes over lunch — a
 * per-user salt stops the attacker amortising that work across accounts, but
 * it does nothing to slow down any single guess.
 *
 * scrypt is deliberately expensive in BOTH time and memory. The memory cost
 * is the important half: it is what stops an attacker buying a thousandfold
 * speedup with GPUs or custom silicon, because memory bandwidth is the one
 * thing that hardware cannot cheaply parallelise.
 *
 * THE CONSTRUCTION
 *
 *   input   = HMAC-SHA256(key = EncryptionSecret, message = password)
 *   derived = scrypt(input, salt, 32 bytes, { N, r, p })
 *
 * The HMAC step carries the instance-wide EncryptionSecret as a "pepper".
 * The pepper lives in configuration, not in the database, so a dump of
 * Postgres alone is not enough to start guessing — the attacker also needs
 * the deployment's secret. It also normalises the password to a fixed 32
 * bytes before scrypt sees it, which sidesteps every question about very
 * long or oddly-encoded inputs.
 *
 * THE STORED FORMAT
 *
 *   scrypt$N=16384,r=8,p=1$<64 hex characters>
 *
 * The hash carries the algorithm and the cost parameters it was produced
 * with. That is what makes raising the cost later a non-event: old hashes
 * keep verifying against the parameters recorded in them, and each user's
 * hash is re-derived at their next successful login. Nothing about a cost
 * bump requires a migration or a forced password reset.
 *
 * The salt is NOT in this string — it lives in the row's own salt column
 * (see TableColumn.hashSaltColumn), which is where the previous scheme put
 * it and where the write path keeps it in step with the hash.
 */

/*
 * N is the CPU/memory cost. Memory used is 128 * N * r bytes, so the values
 * below cost 16 MiB and roughly 50ms per hash on current server hardware.
 *
 * That is a deliberate middle: enough to make offline guessing expensive,
 * cheap enough that a burst of logins does not exhaust the libuv thread pool
 * or the box's memory. Raising N is a one-line change — bump it here, and
 * every user is migrated to the new cost as they log in.
 */
const CURRENT_PARAMS: ScryptParams = {
  N: 16384,
  r: 8,
  p: 1,
};

/** Bytes of derived key. 32 bytes = the 64 hex characters stored. */
const KEY_LENGTH_IN_BYTES: number = 32;

const SCHEME_NAME: string = "scrypt";

/*
 * Refuse absurd parameters read back out of the database. Stored values are
 * ours, not an attacker's, but a corrupted row must fail the login rather
 * than ask Node to allocate gigabytes.
 */
const MAX_N: number = 1048576; // 2^20
const MAX_R: number = 32;
const MAX_P: number = 16;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

interface ParsedPasswordHash {
  params: ScryptParams;
  derivedKey: string;
}

export default class PasswordHash {
  /**
   * A fresh, cryptographically random salt: 32 bytes as 64 hex characters.
   *
   * A salt is not a secret — its one job is to be UNIQUE per user, so that no
   * precomputed table and no cracked password is ever worth anything against
   * a second account.
   */
  public static generateSalt(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /** The `algorithm$params$` prefix that hashes written today carry. */
  public static getCurrentPrefix(): string {
    return `${SCHEME_NAME}$${PasswordHash.encodeParams(CURRENT_PARAMS)}$`;
  }

  public static getCurrentParams(): ScryptParams {
    return { ...CURRENT_PARAMS };
  }

  private static encodeParams(params: ScryptParams): string {
    return `N=${params.N},r=${params.r},p=${params.p}`;
  }

  /**
   * Pull the parameters and derived key back out of a stored value.
   *
   * Returns null for anything that is not one of our scrypt hashes — which
   * includes every password written before this scheme existed. Callers use
   * null to mean "fall back to the legacy comparison", so this must never
   * throw on unrecognised input.
   */
  private static parse(storedValue: string): ParsedPasswordHash | null {
    const parts: Array<string> = storedValue.split("$");

    if (parts.length !== 3 || parts[0] !== SCHEME_NAME) {
      return null;
    }

    const match: RegExpMatchArray | null = (parts[1] as string).match(
      /^N=(\d+),r=(\d+),p=(\d+)$/,
    );

    if (!match) {
      return null;
    }

    const params: ScryptParams = {
      N: Number(match[1]),
      r: Number(match[2]),
      p: Number(match[3]),
    };

    const isSane: boolean =
      params.N > 1 &&
      params.N <= MAX_N &&
      (params.N & (params.N - 1)) === 0 && // scrypt requires a power of two
      params.r > 0 &&
      params.r <= MAX_R &&
      params.p > 0 &&
      params.p <= MAX_P;

    if (!isSane || !parts[2]) {
      return null;
    }

    return { params: params, derivedKey: parts[2] };
  }

  /**
   * The pepper step. Keyed with the instance's EncryptionSecret, so the
   * database alone cannot be attacked offline.
   */
  private static applyPepper(plainValue: string): Buffer {
    return crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(plainValue, "utf8")
      .digest();
  }

  private static derive(data: {
    plainValue: string;
    salt: string;
    params: ScryptParams;
  }): Promise<string> {
    const { N, r, p } = data.params;

    return new Promise<string>(
      (resolve: (value: string) => void, reject: (error: Error) => void) => {
        crypto.scrypt(
          PasswordHash.applyPepper(data.plainValue),
          data.salt,
          KEY_LENGTH_IN_BYTES,
          {
            N: N,
            r: r,
            p: p,
            /*
             * Node rejects the call outright when 128 * N * r exceeds
             * maxmem, and its default is a flat 32 MiB. Scale the ceiling
             * with the parameters instead, so raising N does not silently
             * become "Invalid scrypt params" at runtime.
             */
            maxmem: 128 * N * r * 2,
          },
          (error: Error | null, derivedKey: Buffer): void => {
            if (error) {
              return reject(error);
            }

            return resolve(derivedKey.toString("hex"));
          },
        );
      },
    );
  }

  /**
   * Hash a password for storage, at today's cost parameters.
   *
   * The returned string records the algorithm and the parameters used, so it
   * stays verifiable after those parameters change.
   */
  public static async hash(data: {
    plainValue: string;
    salt: string;
  }): Promise<string> {
    if (!data.plainValue) {
      return "";
    }

    if (!data.salt) {
      throw new BadDataException("A salt is required to hash a password.");
    }

    const derivedKey: string = await PasswordHash.derive({
      plainValue: data.plainValue,
      salt: data.salt,
      params: CURRENT_PARAMS,
    });

    return `${PasswordHash.getCurrentPrefix()}${derivedKey}`;
  }

  /**
   * Check a password against a stored value, whichever scheme wrote it.
   *
   * Three schemes are in circulation and all three have to keep working, or
   * the change that introduced the next one locks people out:
   *
   *   scrypt$...   this one. Verified at the parameters recorded in the hash.
   *   salted SHA   `SHA256("v2:" + salt + ":" + secret + ":" + password)`.
   *   bare SHA     `SHA256(secret + password)`, from before salts existed.
   *
   * The last two are told apart by whether the row has a salt, which is the
   * same rule they were written under. Anything not carrying a recognised
   * scheme prefix is one of them.
   */
  public static async verify(data: {
    plainValue: string;
    storedValue: string;
    salt?: string | null | undefined;
  }): Promise<boolean> {
    if (!data.plainValue || !data.storedValue) {
      return false;
    }

    const parsed: ParsedPasswordHash | null = PasswordHash.parse(
      data.storedValue,
    );

    if (!parsed) {
      return await HashedString.verifyValue({
        plainValue: data.plainValue,
        hashedValue: data.storedValue,
        encryptionSecret: EncryptionSecret,
        salt: data.salt || null,
      });
    }

    /*
     * A scrypt hash is meaningless without the salt it was derived with.
     * Reaching here without one means the caller did not select the salt
     * column, which would otherwise look exactly like a wrong password.
     */
    if (!data.salt) {
      throw new BadDataException(
        "Cannot verify a salted password hash without its salt. Select the salt column alongside the hash.",
      );
    }

    const derivedKey: string = await PasswordHash.derive({
      plainValue: data.plainValue,
      salt: data.salt,
      params: parsed.params,
    });

    return HashedString.isEqual(derivedKey, parsed.derivedKey);
  }

  /**
   * Should this stored value be re-hashed the next time the password is
   * known to be correct?
   *
   * True for every hash that is not exactly what `hash()` writes today: the
   * two SHA-256 schemes that came before, and any scrypt hash carrying
   * parameters that are no longer current. This is the whole upgrade
   * mechanism — raising the cost above is enough to start migrating users.
   */
  public static needsUpgrade(storedValue: string): boolean {
    if (!storedValue) {
      return false;
    }

    return !storedValue.startsWith(PasswordHash.getCurrentPrefix());
  }
}
