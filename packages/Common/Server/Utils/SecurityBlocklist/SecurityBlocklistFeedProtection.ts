import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityProtectedAddresses, {
  SecurityProtectionSnapshot,
} from "./SecurityProtectedAddresses";
import ObjectID from "../../../Types/ObjectID";
import OldestKeyMap from "../../../Utils/OldestKeyMap";
import {
  SecurityBlocklistFeedEntry,
  SecurityBlocklistFeedWithheldEntry,
  filterProtectedSecurityBlocklistFeedEntries,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import { SecurityAddressProtection } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";

/*
 * NO PROTECTED ADDRESS IS EVER SERVED BY A BLOCKLIST FEED (#10345).
 *
 * A block is refused when it would touch one of the project's own or
 * protected addresses (SecurityBlockService), but an address can become one
 * after it was blocked: a host that comes up on it, an entry added to
 * Protected Entities. So a feed holds every entry to everything the project
 * protects, as it serves it:
 *
 *   - the project's Protected Entities list, read afresh on every fetch, so
 *     an address someone protects is gone from the very next one;
 *   - everything OneUptime protects by itself (SecurityProtectedAddresses.
 *     readAllProtections: its hosts, nodes, cloud resources, load
 *     balancers, probes, network devices, Address Names, the edge in front
 *     of it, the ranges not on the internet), read whole and kept a minute
 *     per project on each server: a firewall polls every few minutes, and
 *     these change when infrastructure does.
 *
 * Fail toward a person: when a source cannot be read, the feed serves
 * nothing new (unreadable: true): it answers that it cannot be read now,
 * the firewall keeps the list it has, and its blocks stop being confirmed
 * rather than a list going out unchecked. A source with more rows than one
 * read takes is held to what was read; the rest were checked when each
 * block was made.
 */

// How long each server keeps what a project protects, besides its Protected Entities list.
export const SECURITY_BLOCKLIST_FEED_PROTECTION_CACHE_IN_MS: number = 60 * 1000;

// The most rows each source is read for: as many as a feed has entries.
export const SECURITY_BLOCKLIST_FEED_PROTECTION_ROWS_PER_SOURCE: number = 20000;

// The most projects whose protections one server keeps.
const CACHED_PROJECTS: number = 1000;

export interface SecurityBlocklistFeedProtectionCheck {
  // False when something that would protect an entry could not be read: nothing new is served.
  isReadable: boolean;
  served: Array<SecurityBlocklistFeedEntry>;
  withheld: Array<SecurityBlocklistFeedWithheldEntry>;
}

interface CachedSnapshot {
  snapshot: SecurityProtectionSnapshot;
  readAt: number;
}

export default class SecurityBlocklistFeedProtection {
  private static cache: OldestKeyMap<string, CachedSnapshot> =
    new OldestKeyMap<string, CachedSnapshot>();

  // For tests: forget what every project protects.
  public static clearCache(): void {
    this.cache.clear();
  }

  /*
   * The entries a feed may serve now, and those it holds back with what
   * protects them. Never throws: a source that cannot be read makes the
   * check unreadable.
   */
  @CaptureSpan()
  public static async check(data: {
    projectId: ObjectID;
    entries: ReadonlyArray<SecurityBlocklistFeedEntry>;
    now: Date;
  }): Promise<SecurityBlocklistFeedProtectionCheck> {
    if (data.entries.length === 0) {
      return { isReadable: true, served: [], withheld: [] };
    }

    let snapshot: SecurityProtectionSnapshot;
    let listed: Array<SecurityAddressProtection>;

    try {
      [snapshot, listed] = await Promise.all([
        this.readSnapshot(data.projectId, data.now),
        this.readProtectedEntities(data.projectId),
      ]);
    } catch (error) {
      logger.warn(
        `SecurityBlocklistFeedProtection: could not read what project ${data.projectId.toString()} protects; its feeds serve nothing new until it can be read. ${String(error)}`,
      );

      return { isReadable: false, served: [], withheld: [] };
    }

    if (snapshot.unreadSources.length > 0) {
      // Read again on the next fetch, not a minute later.
      this.cache.delete(data.projectId.toString());

      return { isReadable: false, served: [], withheld: [] };
    }

    if (snapshot.incompleteSources.length > 0) {
      logger.debug(
        `SecurityBlocklistFeedProtection: project ${data.projectId.toString()} holds more than ${SECURITY_BLOCKLIST_FEED_PROTECTION_ROWS_PER_SOURCE} rows of ${snapshot.incompleteSources.join(", ")}; its feeds hold their entries to the rows read, and every block was checked against all of them when it was made.`,
      );
    }

    const filtered: {
      served: Array<SecurityBlocklistFeedEntry>;
      withheld: Array<SecurityBlocklistFeedWithheldEntry>;
    } = filterProtectedSecurityBlocklistFeedEntries({
      entries: data.entries,
      protections: [...listed, ...snapshot.protections],
    });

    return { isReadable: true, ...filtered };
  }

  // What OneUptime protects of the project by itself, kept a minute.
  private static async readSnapshot(
    projectId: ObjectID,
    now: Date,
  ): Promise<SecurityProtectionSnapshot> {
    const key: string = projectId.toString();
    const cached: CachedSnapshot | undefined = this.cache.get(key);

    if (
      cached &&
      now.getTime() - cached.readAt <
        SECURITY_BLOCKLIST_FEED_PROTECTION_CACHE_IN_MS &&
      now.getTime() >= cached.readAt
    ) {
      return cached.snapshot;
    }

    const snapshot: SecurityProtectionSnapshot =
      await SecurityProtectedAddresses.readAllProtections({
        projectId,
        limitPerSource: SECURITY_BLOCKLIST_FEED_PROTECTION_ROWS_PER_SOURCE,
      });

    if (snapshot.unreadSources.length === 0) {
      if (this.cache.size >= CACHED_PROJECTS && !this.cache.has(key)) {
        const oldest: string | undefined = this.cache.oldestKey();

        if (oldest !== undefined) {
          this.cache.delete(oldest);
        }
      }

      this.cache.set(key, { snapshot, readAt: now.getTime() });
    }

    return snapshot;
  }

  // The project's Protected Entities list, read afresh: what someone protects is never served again.
  private static async readProtectedEntities(
    projectId: ObjectID,
  ): Promise<Array<SecurityAddressProtection>> {
    return (
      await SecurityProtectedAddresses.readProtectedEntities(projectId, {
        isRoot: true,
      })
    ).protections;
  }
}
