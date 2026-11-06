import { OpenStackBackoffMemory } from "./OpenStackBackoff";
import { OpenStackToken } from "./OpenStackKeystone";
import { NovaServerRecord } from "./OpenStackInventory";
import OldestKeyMap from "Common/Utils/OldestKeyMap";
import { OpenStackCredential } from "Common/Types/OpenStack/OpenStackProbeCollection";
import crypto from "crypto";

/*
 * What the probe keeps between collections of a cloud, in memory and nowhere else:
 *
 *   - the token, so a collection does not log in again while the last login is good.
 *     A login is the costliest thing it can ask of a Keystone, and it appears in the
 *     audit log every time;
 *   - what failed lately, so it is asked less often;
 *   - when each service was last read, for those read less often than the collection
 *     runs;
 *   - the instance list, so instances can be read by what changed.
 *
 * Everything is keyed by a hash of the address, the credential and the trusted
 * certificates. So a changed secret or certificate starts clean, a token bought with
 * the old one is never reused, and the secret itself is not what the map holds. A
 * probe restart loses all of it, and that is fine: the next collection reads in full
 * and logs in again.
 */

// A token this close to its end is not worth starting a collection with.
export const TOKEN_EXPIRY_MARGIN_IN_MS: number = 5 * 60_000;

// A token that names no end is kept for about as long as Keystone's default.
export const TOKEN_UNKNOWN_EXPIRY_IN_MS: number = 30 * 60_000;

const MAX_CACHED_SESSIONS: number = 500;

// A cloud not collected for this long moved to another probe, or was removed.
export const INSTANCE_STATE_IDLE_TIMEOUT_IN_MS: number = 60 * 60_000;

// Each can hold a whole cloud's instances, so far fewer of these than of tokens.
const MAX_CACHED_INSTANCE_STATES: number = 32;

const MAX_REMEMBERED_VALUES: number = 2000;

export function getOpenStackCredentialKey(data: {
  openStackCloudId: string;
  authUrl: string;
  credential: OpenStackCredential;
  trustedFingerprints: ReadonlyArray<string>;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        data.openStackCloudId,
        data.authUrl,
        data.credential,
        [...data.trustedFingerprints].sort(),
      ]),
    )
    .digest("hex");
}

export interface OpenStackCachedSession {
  token: OpenStackToken;
  refusedReads: Set<string>;
  validUntil: number;
}

export interface OpenStackInstanceState {
  servers: Map<string, NovaServerRecord>;
  lastFullReadAt: number;
  // The changes-since to ask from next, by Nova's own clock.
  cursor: string;
  // Whether this credential may read every project's, or only its own.
  isOwnProjectOnly: boolean;
  lastUsedAt: number;
}

interface RememberedValue {
  value: unknown;
  rememberedAt: number;
}

export default class OpenStackCollectorMemory {
  public readonly backoff: OpenStackBackoffMemory =
    new OpenStackBackoffMemory();

  private readonly sessions: OldestKeyMap<string, OpenStackCachedSession> =
    new OldestKeyMap();
  private readonly instanceStates: OldestKeyMap<
    string,
    OpenStackInstanceState
  > = new OldestKeyMap();
  private readonly values: OldestKeyMap<string, RememberedValue> =
    new OldestKeyMap();

  public getSession(key: string, now: number): OpenStackCachedSession | null {
    const session: OpenStackCachedSession | undefined = this.sessions.get(key);

    if (!session) {
      return null;
    }

    if (now >= session.validUntil) {
      this.sessions.delete(key);
      return null;
    }

    return session;
  }

  public setSession(data: {
    key: string;
    token: OpenStackToken;
    refusedReads: Set<string>;
    now: number;
  }): void {
    this.sessions.delete(data.key);
    this.sessions.set(data.key, {
      token: data.token,
      refusedReads: data.refusedReads,
      validUntil:
        data.token.expiresAt === null
          ? data.now + TOKEN_UNKNOWN_EXPIRY_IN_MS
          : data.token.expiresAt - TOKEN_EXPIRY_MARGIN_IN_MS,
    });

    while (this.sessions.size > MAX_CACHED_SESSIONS) {
      const oldest: string | undefined = this.sessions.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.sessions.delete(oldest);
    }
  }

  public forgetSession(key: string): void {
    this.sessions.delete(key);
  }

  public getInstanceState(
    key: string,
    now: number,
  ): OpenStackInstanceState | null {
    const state: OpenStackInstanceState | undefined =
      this.instanceStates.get(key);

    if (!state) {
      return null;
    }

    if (now - state.lastUsedAt > INSTANCE_STATE_IDLE_TIMEOUT_IN_MS) {
      this.instanceStates.delete(key);
      return null;
    }

    return state;
  }

  public setInstanceState(key: string, state: OpenStackInstanceState): void {
    this.instanceStates.delete(key);
    this.instanceStates.set(key, state);

    while (this.instanceStates.size > MAX_CACHED_INSTANCE_STATES) {
      const oldest: string | undefined = this.instanceStates.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.instanceStates.delete(oldest);
    }
  }

  // A small fact worth not asking for again for a while, such as Neutron's extensions.
  public remember(key: string, value: unknown, now: number): void {
    this.values.delete(key);
    this.values.set(key, { value: value, rememberedAt: now });

    while (this.values.size > MAX_REMEMBERED_VALUES) {
      const oldest: string | undefined = this.values.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.values.delete(oldest);
    }
  }

  public recall<T>(
    key: string,
    maxAgeInMs: number,
    now: number,
  ): T | undefined {
    const remembered: RememberedValue | undefined = this.values.get(key);

    if (!remembered || now - remembered.rememberedAt > maxAgeInMs) {
      return undefined;
    }

    return remembered.value as T;
  }

  // Exported for tests.
  public clear(): void {
    this.backoff.clear();
    this.sessions.clear();
    this.instanceStates.clear();
    this.values.clear();
  }

  public sessionCount(): number {
    return this.sessions.size;
  }
}
