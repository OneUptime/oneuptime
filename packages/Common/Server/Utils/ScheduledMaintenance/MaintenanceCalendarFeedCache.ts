import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import { CALENDAR_RESPONSE_MAX_AGE_SECONDS } from "../Response";
import { JSONObject } from "../../../Types/JSON";

/*
 * The rendered maintenance calendars, kept for as long as a calendar app is
 * told it may keep one (CALENDAR_RESPONSE_MAX_AGE_SECONDS, 300 s), so an app
 * that comes back sooner - or a hundred apps subscribed to one popular
 * status page - costs one Redis read rather than a render.
 *
 * Simpler than the on-call feeds' cache (OnCallCalendarFeedCache), because a
 * maintenance calendar is cheap: a handful of indexed reads, no rotation to
 * expand. What it keeps:
 *
 *   - Each calendar under a key its caller builds from everything the body
 *     depends on that must take effect at once: the link's token (a
 *     regenerated link is a new key), a status page's project generation (a
 *     record taken off the page is a new key, StatusPageOverviewCache).
 *     Anything else - an event edited, one added - is seen when the entry
 *     runs out, well before a calendar app polls again (Google Calendar:
 *     every 12 to 24 hours).
 *   - Who may read a calendar is never kept here: each route checks it on
 *     every request before it asks (a link turned off, a private page).
 *   - Renders that start together share one (inFlight), so a burst of polls
 *     on a cold key reads the database once in this process.
 *
 * Redis down: every request renders, still coalesced, and nothing is kept;
 * logged once a minute. A body over MAX_CACHED_MAINTENANCE_CALENDAR_BYTES is
 * rendered on every request rather than pushed into a Redis that also backs
 * the job queues.
 */

export const MAINTENANCE_CALENDAR_CACHE_NAMESPACE: string =
  "maintenance-calendar";

export const MAINTENANCE_CALENDAR_CACHE_TTL_SECONDS: number =
  CALENDAR_RESPONSE_MAX_AGE_SECONDS;

export const MAX_CACHED_MAINTENANCE_CALENDAR_BYTES: number = 2 * 1024 * 1024;

const UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

// A calendar as the response helper wants it.
export interface RenderedMaintenanceCalendar {
  body: string;
  etag: string;
  // When the body was rendered: what If-Modified-Since is compared against.
  lastModified: Date;
  eventCount: number;
}

export interface MaintenanceCalendarCacheResult {
  calendar: RenderedMaintenanceCalendar;
  cacheHit: boolean;
}

export default class MaintenanceCalendarFeedCache {
  private static inFlight: Map<string, Promise<RenderedMaintenanceCalendar>> =
    new Map();

  private static unavailableLoggedAt: number = 0;

  /*
   * The calendar kept under `key`, else one rendered now by `render` -
   * shared with any other request for the key that arrives meanwhile - and
   * kept. A failed render is never kept: it throws to every request that
   * shared it, and the next one renders again.
   */
  public static async getOrRender(data: {
    key: string;
    render: () => Promise<RenderedMaintenanceCalendar>;
  }): Promise<MaintenanceCalendarCacheResult> {
    const kept: RenderedMaintenanceCalendar | null =
      await MaintenanceCalendarFeedCache.read(data.key);

    if (kept) {
      return { calendar: kept, cacheHit: true };
    }

    let rendering: Promise<RenderedMaintenanceCalendar> | undefined =
      MaintenanceCalendarFeedCache.inFlight.get(data.key);

    if (!rendering) {
      rendering = data.render();
      MaintenanceCalendarFeedCache.inFlight.set(data.key, rendering);

      rendering
        .then((calendar: RenderedMaintenanceCalendar): Promise<void> => {
          return MaintenanceCalendarFeedCache.write(data.key, calendar);
        })
        .catch(() => {
          // A failed render is never kept; the next request renders again.
        })
        .finally(() => {
          MaintenanceCalendarFeedCache.inFlight.delete(data.key);
        });
    }

    return { calendar: await rendering, cacheHit: false };
  }

  // Forgets the renders under way. For tests.
  public static clearInFlight(): void {
    MaintenanceCalendarFeedCache.inFlight.clear();
  }

  public static serialize(calendar: RenderedMaintenanceCalendar): string {
    return JSON.stringify({
      body: calendar.body,
      etag: calendar.etag,
      lastModified: calendar.lastModified.toISOString(),
      eventCount: calendar.eventCount,
    });
  }

  // A kept calendar, or null for anything that is not one.
  public static deserialize(
    raw: string | null,
  ): RenderedMaintenanceCalendar | null {
    if (!raw) {
      return null;
    }

    try {
      const json: JSONObject = JSON.parse(raw) as JSONObject;

      const lastModified: Date = new Date(String(json["lastModified"]));

      if (
        typeof json["body"] !== "string" ||
        typeof json["etag"] !== "string" ||
        Number.isNaN(lastModified.getTime())
      ) {
        return null;
      }

      return {
        body: json["body"],
        etag: json["etag"],
        lastModified: lastModified,
        eventCount:
          typeof json["eventCount"] === "number" ? json["eventCount"] : 0,
      };
    } catch {
      return null;
    }
  }

  private static async read(
    key: string,
  ): Promise<RenderedMaintenanceCalendar | null> {
    try {
      return MaintenanceCalendarFeedCache.deserialize(
        await GlobalCache.getString(MAINTENANCE_CALENDAR_CACHE_NAMESPACE, key),
      );
    } catch (err) {
      MaintenanceCalendarFeedCache.logUnavailable(err);
      return null;
    }
  }

  private static async write(
    key: string,
    calendar: RenderedMaintenanceCalendar,
  ): Promise<void> {
    if (
      Buffer.byteLength(calendar.body, "utf8") >
      MAX_CACHED_MAINTENANCE_CALENDAR_BYTES
    ) {
      return;
    }

    try {
      await GlobalCache.setString(
        MAINTENANCE_CALENDAR_CACHE_NAMESPACE,
        key,
        MaintenanceCalendarFeedCache.serialize(calendar),
        { expiresInSeconds: MAINTENANCE_CALENDAR_CACHE_TTL_SECONDS },
      );
    } catch (err) {
      MaintenanceCalendarFeedCache.logUnavailable(err);
    }
  }

  private static logUnavailable(err: unknown): void {
    const now: number = Date.now();

    if (
      now - MaintenanceCalendarFeedCache.unavailableLoggedAt <
      UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return;
    }

    MaintenanceCalendarFeedCache.unavailableLoggedAt = now;

    logger.warn(
      "MaintenanceCalendarFeedCache: the cache is unavailable; maintenance calendars are rendered on every request until it is back.",
    );
    logger.warn(err);
  }
}
