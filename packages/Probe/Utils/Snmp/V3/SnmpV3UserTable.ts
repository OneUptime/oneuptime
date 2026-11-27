import UsmCrypto, { UsmPrivacyKey } from "./UsmCrypto";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpTrapReceiverUtil, {
  SnmpTrapReceiverUser,
} from "Common/Types/Probe/SnmpTrapReceiver";
import IpCanonicalUtil from "Common/Utils/IpCanonicalUtil";
import OldestKeyMap from "Common/Utils/OldestKeyMap";
import crypto from "crypto";

/*
 * THE SNMPv3 USERS THE PROBE'S TRAP RECEIVER ACCEPTS: the users of the
 * devices assigned to the probe, as OneUptime hands them over every thirty
 * seconds (Jobs/SnmpTrap/SyncSnmpTrapReceiver). replace() swaps the whole
 * table at once, so a message is checked against one complete set, and the
 * receiver never stops listening while it changes.
 *
 * WHAT IS KEPT, AND HOW LONG. A user's passphrases are turned into Ku - the
 * slow, engine-independent half of RFC 3414's password-to-key - the first
 * time a message needs them, and then only Ku is kept: the passphrase is
 * dropped. Ku survives a replace() for as long as the user does (it is
 * keyed by a fingerprint of the user's whole credential, so a changed
 * passphrase is a new user and a removed one leaves with its keys). Keys
 * localized to an engine are kept for the most recent MAX_LOCALIZED_KEYS
 * user and engine pairs. Nothing here is written anywhere or logged.
 *
 * ONE NAME, SEVERAL KEYS. Two devices may well share a user name and not
 * their passphrases, so a name maps to every user that has it. A message is
 * tried against the users of the devices at its source address first, then
 * the rest, at most MAX_CANDIDATES_PER_MESSAGE of them: the digest says
 * which, if any, signed it.
 */

export const MAX_CANDIDATES_PER_MESSAGE: number = 64;
export const MAX_LOCALIZED_KEYS: number = 10000;

export interface UsmUser {
  // A hash of the whole credential: this user's identity while it is kept.
  readonly fingerprint: string;
  readonly userName: string;
  readonly securityLevel: SnmpSecurityLevel;
  readonly authProtocol?: SnmpAuthProtocol | undefined;
  readonly privProtocol?: SnmpPrivProtocol | undefined;
  readonly addresses: ReadonlySet<string>;
}

// A user's keys localized to one engine.
export interface UsmLocalizedKeys {
  authKey?: Buffer | undefined;
  privacyKey?: UsmPrivacyKey | undefined;
}

interface UsmUserSecrets {
  // Until Ku is derived; dropped once it is.
  authPassphrase?: string | undefined;
  privPassphrase?: string | undefined;
  authKu?: Buffer | undefined;
  privKu?: Buffer | undefined;
}

export default class SnmpV3UserTable {
  // By the user name's octets, as hex.
  private usersByName: Map<string, Array<UsmUser>> = new Map();
  private secretsByFingerprint: Map<string, UsmUserSecrets> = new Map();
  // Least recently used first, answered in constant time.
  private readonly localizedKeys: OldestKeyMap<string, UsmLocalizedKeys> =
    new OldestKeyMap();
  private userCount: number = 0;
  private hasBeenLoaded: boolean = false;

  public static getFingerprint(user: SnmpTrapReceiverUser): string {
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          user.userName,
          user.securityLevel,
          user.authProtocol || "",
          user.authKey || "",
          user.privProtocol || "",
          user.privKey || "",
        ]),
      )
      .digest("hex");
  }

  /*
   * The table becomes exactly these users. Users that were already here
   * keep the Ku derived for them; everything about a user no longer here
   * is let go.
   */
  public replace(users: Array<SnmpTrapReceiverUser>): void {
    const usersByFingerprint: Map<
      string,
      { user: SnmpTrapReceiverUser; addresses: Set<string> }
    > = new Map();

    for (const candidate of users) {
      // What the server sent is checked here too: a user the receiver cannot honour is left out.
      const user: SnmpTrapReceiverUser | null =
        SnmpTrapReceiverUtil.sanitizeUser(candidate);

      if (!user) {
        continue;
      }

      const fingerprint: string = SnmpV3UserTable.getFingerprint(user);
      const existing:
        | { user: SnmpTrapReceiverUser; addresses: Set<string> }
        | undefined = usersByFingerprint.get(fingerprint);

      if (existing) {
        for (const address of user.addresses) {
          existing.addresses.add(address);
        }
        continue;
      }

      usersByFingerprint.set(fingerprint, {
        user: user,
        addresses: new Set(
          user.addresses.map((address: string): string => {
            return IpCanonicalUtil.canonicalize(address);
          }),
        ),
      });
    }

    const usersByName: Map<string, Array<UsmUser>> = new Map();
    const secretsByFingerprint: Map<string, UsmUserSecrets> = new Map();

    for (const [fingerprint, entry] of usersByFingerprint) {
      const user: SnmpTrapReceiverUser = entry.user;
      const nameKey: string = SnmpV3UserTable.toNameKey(
        Buffer.from(user.userName, "utf8"),
      );

      const usmUser: UsmUser = {
        fingerprint: fingerprint,
        userName: user.userName,
        securityLevel: user.securityLevel,
        authProtocol: user.authProtocol,
        privProtocol: user.privProtocol,
        addresses: entry.addresses,
      };

      const named: Array<UsmUser> = usersByName.get(nameKey) || [];
      named.push(usmUser);
      usersByName.set(nameKey, named);

      secretsByFingerprint.set(
        fingerprint,
        this.secretsByFingerprint.get(fingerprint) || {
          authPassphrase: user.authKey,
          privPassphrase: user.privKey,
        },
      );
    }

    for (const key of Array.from(this.localizedKeys.keys())) {
      if (!secretsByFingerprint.has(key.split(":")[0]!)) {
        this.localizedKeys.delete(key);
      }
    }

    this.usersByName = usersByName;
    this.secretsByFingerprint = secretsByFingerprint;
    this.userCount = usersByFingerprint.size;
    this.hasBeenLoaded = true;
  }

  // Whether OneUptime has handed the table its users at least once.
  public isLoaded(): boolean {
    return this.hasBeenLoaded;
  }

  public getUserCount(): number {
    return this.userCount;
  }

  /*
   * The users a message sent as this user name may be from: those of the
   * devices at its source address first, at most MAX_CANDIDATES_PER_MESSAGE.
   */
  public getCandidates(
    userName: Buffer,
    sourceAddress: string,
  ): Array<UsmUser> {
    const named: Array<UsmUser> | undefined = this.usersByName.get(
      SnmpV3UserTable.toNameKey(userName),
    );

    if (!named || named.length === 0) {
      return [];
    }

    const source: string = IpCanonicalUtil.canonicalize(sourceAddress);
    const fromSource: Array<UsmUser> = [];
    const others: Array<UsmUser> = [];

    for (const user of named) {
      (user.addresses.has(source) ? fromSource : others).push(user);
    }

    return [...fromSource, ...others].slice(0, MAX_CANDIDATES_PER_MESSAGE);
  }

  // A user's keys localized to an engine: derived once, then kept for a while.
  public getLocalizedKeys(user: UsmUser, engineId: Buffer): UsmLocalizedKeys {
    const cacheKey: string = `${user.fingerprint}:${engineId.toString("hex")}`;
    const cached: UsmLocalizedKeys | undefined =
      this.localizedKeys.get(cacheKey);

    if (cached) {
      // Most recently used goes last.
      this.localizedKeys.delete(cacheKey);
      this.localizedKeys.set(cacheKey, cached);
      return cached;
    }

    const secrets: UsmUserSecrets | undefined = this.secretsByFingerprint.get(
      user.fingerprint,
    );

    if (!secrets || !user.authProtocol) {
      return {};
    }

    SnmpV3UserTable.deriveKu(user.authProtocol, secrets);

    const keys: UsmLocalizedKeys = {};

    if (secrets.authKu) {
      keys.authKey = UsmCrypto.localizeKey(
        user.authProtocol,
        secrets.authKu,
        engineId,
      );
    }

    if (secrets.privKu && user.privProtocol) {
      keys.privacyKey = UsmCrypto.localizePrivacyKey({
        authProtocol: user.authProtocol,
        privProtocol: user.privProtocol,
        privKu: secrets.privKu,
        engineId: engineId,
      });
    }

    this.localizedKeys.set(cacheKey, keys);

    while (this.localizedKeys.size > MAX_LOCALIZED_KEYS) {
      const oldest: string | undefined = this.localizedKeys.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.localizedKeys.delete(oldest);
    }

    return keys;
  }

  /*
   * Derives Ku for up to `limit` users that do not have it yet, so the
   * first trap of a large set does not pay for all of them. Returns how
   * many are still left.
   */
  public warmUp(limit: number): number {
    let derived: number = 0;
    let left: number = 0;

    for (const named of this.usersByName.values()) {
      for (const user of named) {
        const secrets: UsmUserSecrets | undefined =
          this.secretsByFingerprint.get(user.fingerprint);

        if (
          !secrets ||
          !user.authProtocol ||
          (!secrets.authPassphrase && !secrets.privPassphrase)
        ) {
          continue;
        }

        if (derived < limit) {
          SnmpV3UserTable.deriveKu(user.authProtocol, secrets);
          derived++;
        } else {
          left++;
        }
      }
    }

    return left;
  }

  private static deriveKu(
    authProtocol: SnmpAuthProtocol,
    secrets: UsmUserSecrets,
  ): void {
    if (secrets.authPassphrase) {
      secrets.authKu = UsmCrypto.passwordToKu(
        authProtocol,
        secrets.authPassphrase,
      );
      secrets.authPassphrase = undefined;
    }

    // RFC 3414 section 2.6: the privacy key is derived with the authentication protocol's hash.
    if (secrets.privPassphrase) {
      secrets.privKu = UsmCrypto.passwordToKu(
        authProtocol,
        secrets.privPassphrase,
      );
      secrets.privPassphrase = undefined;
    }
  }

  // A user name is octets: compared as octets.
  private static toNameKey(userName: Buffer): string {
    return userName.toString("hex");
  }
}
