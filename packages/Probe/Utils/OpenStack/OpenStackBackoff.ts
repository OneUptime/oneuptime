import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";
import OldestKeyMap from "Common/Utils/OldestKeyMap";

/*
 * How monitoring stays out of the way of a cloud that is struggling. Two scales:
 *
 *   - within a collection, one request that was answered 429 or a server error is
 *     tried again a little later, as Retry-After says when it says so, and not at
 *     all when there is no time left to wait;
 *   - across collections, a Keystone or a service that keeps failing is asked less
 *     and less often, up to half an hour apart. A Keystone outage is exactly when a
 *     login every two minutes from every monitoring tool makes it worse. A refused
 *     credential waits longer than that from the start, because repeating one is
 *     what locks an account (lockout_failure_attempts).
 *
 * A jitter on every wait, so many clouds behind one Keystone, or many probes, do not
 * all come back at the same moment.
 */

export const MAX_ATTEMPTS_PER_REQUEST: number = 3;

// The first retry of a request waits about this, the next about twice it.
export const RETRY_BASE_DELAY_IN_MS: number = 1000;

// However long Retry-After asks for, a collection only holds still for so long.
export const MAX_RETRY_DELAY_IN_MS: number = 30_000;

export const BACKOFF_BASE_IN_MS: number = 60_000;
export const REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS: number = 5 * 60_000;
export const MAX_BACKOFF_IN_MS: number = 30 * 60_000;
export const MAX_REFUSED_CREDENTIAL_BACKOFF_IN_MS: number = 60 * 60_000;

const JITTER_FRACTION: number = 0.2;
const MAX_REMEMBERED: number = 2000;

/*
 * Retry-After is seconds, or an HTTP date. The delay it asks for in milliseconds, or
 * null when it says nothing usable.
 */
export function parseRetryAfter(
  value: string | Array<string> | undefined,
  now: number,
): number | null {
  const text: string | undefined = Array.isArray(value) ? value[0] : value;

  if (!text || !text.trim()) {
    return null;
  }

  const seconds: number = Number(text.trim());

  if (Number.isFinite(seconds)) {
    return seconds < 0 ? null : seconds * 1000;
  }

  const date: number = Date.parse(text.trim());

  if (Number.isNaN(date)) {
    return null;
  }

  return Math.max(0, date - now);
}

/*
 * How long to wait before trying one request again. What the service asked for wins,
 * up to the most a collection holds still for. Otherwise doubling, with full jitter
 * on the upper half so retries spread out.
 */
export function computeRetryDelayInMs(data: {
  attempt: number;
  retryAfter: string | Array<string> | undefined;
  now: number;
  random: number;
}): number {
  const asked: number | null = parseRetryAfter(data.retryAfter, data.now);

  if (asked !== null) {
    return Math.min(asked, MAX_RETRY_DELAY_IN_MS);
  }

  const ceiling: number = Math.min(
    RETRY_BASE_DELAY_IN_MS * Math.pow(2, Math.max(0, data.attempt - 1)),
    MAX_RETRY_DELAY_IN_MS,
  );

  return Math.round(ceiling / 2 + (ceiling / 2) * data.random);
}

// How long to leave something alone after this many failures in a row.
export function computeBackoffInMs(data: {
  failures: number;
  baseInMs: number;
  maxInMs: number;
  random: number;
}): number {
  const exponent: number = Math.min(Math.max(0, data.failures - 1), 20);
  const delay: number = Math.min(
    data.baseInMs * Math.pow(2, exponent),
    data.maxInMs,
  );
  const jitter: number =
    1 - JITTER_FRACTION + 2 * JITTER_FRACTION * data.random;

  return Math.round(delay * jitter);
}

export interface OpenStackBackoffEntry {
  failures: number;
  nextTryAt: number;
  // What the last try found, so a report that does not try can still say why.
  code: OpenStackCollectionErrorCode;
  message: string;
  presentedCertificate?: OpenStackPresentedCertificate | undefined;
}

/*
 * What failed lately, in memory, by a key that includes the credential's hash: a
 * corrected credential or a newly trusted certificate is tried at once.
 */
export class OpenStackBackoffMemory {
  private readonly entries: OldestKeyMap<string, OpenStackBackoffEntry> =
    new OldestKeyMap();

  // What is holding this back now, or null when it may be tried.
  public check(key: string, now: number): OpenStackBackoffEntry | null {
    const entry: OpenStackBackoffEntry | undefined = this.entries.get(key);

    if (!entry || entry.nextTryAt <= now) {
      return null;
    }

    return entry;
  }

  public recordFailure(
    key: string,
    data: {
      now: number;
      random: number;
      baseInMs: number;
      maxInMs: number;
      code: OpenStackCollectionErrorCode;
      message: string;
      presentedCertificate?: OpenStackPresentedCertificate | undefined;
    },
  ): OpenStackBackoffEntry {
    const failures: number = (this.entries.get(key)?.failures || 0) + 1;

    const entry: OpenStackBackoffEntry = {
      failures: failures,
      nextTryAt:
        data.now +
        computeBackoffInMs({
          failures: failures,
          baseInMs: data.baseInMs,
          maxInMs: data.maxInMs,
          random: data.random,
        }),
      code: data.code,
      message: data.message,
      presentedCertificate: data.presentedCertificate,
    };

    this.entries.delete(key);
    this.entries.set(key, entry);

    while (this.entries.size > MAX_REMEMBERED) {
      const oldest: string | undefined = this.entries.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.entries.delete(oldest);
    }

    return entry;
  }

  public recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}
