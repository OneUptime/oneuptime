import CacheGenerations from "../../Infrastructure/CacheGenerations";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageUptimeTimezone from "../../../Utils/StatusPage/StatusPageUptimeTimezone";
import logger from "../Logger";
import StatusPageSharedReads, { SharedRead } from "./StatusPageSharedReads";

/*
 * The status page overview, cached for a few seconds - and something a
 * status page stops showing is gone from it at once.
 *
 * The overview (StatusPageAPI) is the busiest read a status page makes: every
 * visitor, every refresh. Each process keeps the response it built for a page
 * for TTL_MS, and builds it once for requests that arrive together. Who may
 * read the page is checked on every request before this is asked; the
 * response is the same for everyone who may.
 *
 * And one process builds it for all of them: an overview built anywhere is
 * kept in Redis for the rest of its TTL_MS, and so is each zone's uptime
 * history cut for it (StatusPageSharedReads), so a page is built once per
 * TTL_MS however many pods serve it - not once per pod. An overview read
 * from Redis is kept until the TTL_MS of its build runs out, never longer,
 * so a visitor sees one no older than before. While Redis cannot be
 * reached each process builds its own, as before.
 *
 * Something that stops being shown must not stay on the page until the entry
 * runs out. Every write that can take something off a status page starts a
 * new generation of its project's overviews (afterUpdate, afterDelete):
 *
 *   - an incident, an episode or a scheduled maintenance event hidden from
 *     status pages, made private, its postmortem taken off, limited to some
 *     pages, moved off pages or monitors, or - an event - given a later
 *     publish time (HIDING_WRITES);
 *   - an announcement moved off pages or monitors, or its dates changed;
 *   - any of those deleted, a public note, an incident's place in an
 *     episode, a monitor, a monitor group or a monitor's place in one - a
 *     delete the database carries on to the page's resources itself
 *     (SHOWN_RECORD_TABLES);
 *   - a write or delete of a page's own settings, groups, resources or
 *     monitor rules (STATUS_PAGE_CONFIGURATION_TABLES), but for the
 *     bookkeeping OneUptime writes as it works, which no visitor sees
 *     (UNSHOWN_CONFIGURATION_COLUMNS).
 *
 * A write that can only show more - a switch turned on, Private turned off -
 * starts none, and neither does an edit that leaves a record shown (a title,
 * a note's text): they are seen when the entry runs out. So is an event
 * whose publish time comes, or an announcement whose time to be shown does:
 * no write marks that moment, and the page shows it within TTL_MS.
 *
 * Each entry is kept under the generation its project had when its build
 * started (CacheGenerations, which OnCallCalendarFeedCache keeps its feeds
 * by too), so once the generation changes the page is built again rather
 * than served from before. A change made here takes effect here at once,
 * whatever Redis says - and stays in effect when Redis did not take it, once
 * Redis answers again; one made elsewhere is seen once this process reads
 * Redis again, within SHARED_GENERATION_READ_TTL_MS.
 *
 * When Redis cannot be reached, a change made here still takes effect here
 * at once, and elsewhere once Redis answers again, or within TTL_MS. When a
 * page's project cannot be read, its overview is kept for TTL_MS alone, as
 * before there were generations.
 */

export const STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE: string =
  "status-page-overview";

/*
 * What a page's uptime history - its day buckets - is built from, read
 * once with the rest of the overview and kept beside it, so a visitor in
 * another zone costs the history's two queries and nothing else.
 */
export interface StatusPageUptimeHistoryInputs {
  // each resource's own monitor, and every monitor of a group, that shows its history or uptime.
  monitorIds: Array<ObjectID>;
  // every monitor group whose resource shows its history or uptime, with its monitors.
  monitorGroups: Array<{
    monitorGroupId: ObjectID;
    monitorIds: Array<ObjectID>;
  }>;
  // the project's statuses in the order a group's day is merged by, worst last.
  rankedMonitorStatusIds: Array<string>;
  // the window of the overview this history belongs to.
  startDate: Date;
  endDate: Date;
}

/*
 * A page's overview without its uptime history (the same for every
 * visitor), and what the history is built from. The response is shared
 * between requests and must not be changed.
 */
export interface StatusPageOverviewBase {
  response: JSONObject;
  uptimeHistory: StatusPageUptimeHistoryInputs;
}

/*
 * One zone's uptime history, kept on the overview it belongs to: the JSON
 * the response carries (uptimeDailyAggregate and
 * monitorGroupUptimeDailyAggregate) and the zone its days were cut in.
 */
interface UptimeHistoryEntry {
  history: Promise<{ json: JSONObject; cutIn: string }>;
}

/*
 * What is kept on one overview: its histories by zone key, and the whole
 * response by the zone each visitor asked for, so a visitor who asks again
 * is handed the very object they were handed before.
 */
interface OverviewHistories {
  byZoneKey: Map<string, UptimeHistoryEntry>;
  responsesByTimezone: Map<string, Promise<JSONObject>>;
}

/*
 * Where an overview kept in Redis keeps its histories too, and when it runs
 * out - the same moment in every process that read it.
 */
interface SharedOverview {
  key: string;
  expiresAt: number;
}

// How a value is written to Redis and read back (StatusPageSharedReads).
export interface SharedForm<T> {
  toJSON: (value: T) => unknown;
  fromJSON: (json: unknown) => T;
}

// The ids of a list read back from JSON; throws for anything else.
const toObjectIDs: (json: unknown) => Array<ObjectID> = (
  json: unknown,
): Array<ObjectID> => {
  if (!Array.isArray(json)) {
    throw new Error("Not a list of ids");
  }

  return json.map((id: unknown): ObjectID => {
    return new ObjectID(String(id));
  });
};

/*
 * An overview as it is kept in Redis: its response is the JSON it is sent
 * as; what its uptime history is built from - ids and dates - is written out
 * and read back as they were. Anything else read back is not an overview,
 * and is built again.
 */
export const STATUS_PAGE_OVERVIEW_BASE_FORM: SharedForm<StatusPageOverviewBase> =
  {
    toJSON: (overview: StatusPageOverviewBase): unknown => {
      return {
        response: overview.response,
        uptimeHistory: {
          monitorIds: overview.uptimeHistory.monitorIds.map(
            (id: ObjectID): string => {
              return id.toString();
            },
          ),
          monitorGroups: overview.uptimeHistory.monitorGroups.map(
            (group: {
              monitorGroupId: ObjectID;
              monitorIds: Array<ObjectID>;
            }) => {
              return {
                monitorGroupId: group.monitorGroupId.toString(),
                monitorIds: group.monitorIds.map((id: ObjectID): string => {
                  return id.toString();
                }),
              };
            },
          ),
          rankedMonitorStatusIds: overview.uptimeHistory.rankedMonitorStatusIds,
          startDate: overview.uptimeHistory.startDate.toISOString(),
          endDate: overview.uptimeHistory.endDate.toISOString(),
        },
      };
    },
    fromJSON: (json: unknown): StatusPageOverviewBase => {
      const overview: Record<string, unknown> = (json || {}) as Record<
        string,
        unknown
      >;
      const response: unknown = overview["response"];
      const history: Record<string, unknown> = (overview["uptimeHistory"] ||
        {}) as Record<string, unknown>;

      if (!response || typeof response !== "object") {
        throw new Error("Not an overview");
      }

      const startDate: Date = new Date(String(history["startDate"]));
      const endDate: Date = new Date(String(history["endDate"]));

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error("Not an overview's window");
      }

      if (!Array.isArray(history["monitorGroups"])) {
        throw new Error("Not an overview's monitor groups");
      }

      if (!Array.isArray(history["rankedMonitorStatusIds"])) {
        throw new Error("Not an overview's statuses");
      }

      return {
        response: response as JSONObject,
        uptimeHistory: {
          monitorIds: toObjectIDs(history["monitorIds"]),
          monitorGroups: (history["monitorGroups"] as Array<unknown>).map(
            (group: unknown) => {
              const value: Record<string, unknown> = (group || {}) as Record<
                string,
                unknown
              >;

              return {
                monitorGroupId: new ObjectID(String(value["monitorGroupId"])),
                monitorIds: toObjectIDs(value["monitorIds"]),
              };
            },
          ),
          rankedMonitorStatusIds: (
            history["rankedMonitorStatusIds"] as Array<unknown>
          ).map((id: unknown): string => {
            return String(id);
          }),
          startDate: startDate,
          endDate: endDate,
        },
      };
    },
  };

/*
 * The key a page's reads are kept under: the page and its project's current
 * generation - or the page alone when its project cannot be read (there is
 * no such page, or the read failed): hasProject. isShared is whether that
 * generation was read from Redis, so a change made in another process is in
 * it (CacheGenerations.isSharedGeneration).
 */
export interface StatusPageCacheKey {
  key: string;
  hasProject: boolean;
  isShared: boolean;
}

/*
 * How a write of one column of a record can take it off a status page:
 *
 *   - "off": a switch that must be on for the record to be shown (Visible
 *     on Status Page) - written as anything but on, it may hide the record;
 *   - "on": a switch that hides the record when on (Private, limiting an
 *     incident to some pages) - written as anything but off, it may;
 *   - "any": a column any write of which may - the pages or monitors the
 *     record is shown for, an announcement's dates, an event's publish time
 *     (moved later, it takes a published event off until then).
 */
export type HidingWrite = "off" | "on" | "any";

/*
 * The columns, by table, a write of which can take a record off a status
 * page, and how (HidingWrite). Visible on Status Page, Private and Show
 * Postmortem are every switch status pages show these records by
 * (StatusPageVisibility, PublishedImages).
 */
export const HIDING_WRITES: Readonly<
  Record<string, Readonly<Record<string, HidingWrite>>>
> = {
  Incident: {
    isVisibleOnStatusPage: "off",
    showPostmortemOnStatusPage: "off",
    isPrivate: "on",
    isScopedToStatusPages: "on",
    statusPages: "any",
    monitors: "any",
  },
  IncidentEpisode: {
    isVisibleOnStatusPage: "off",
    isPrivate: "on",
  },
  ScheduledMaintenance: {
    isVisibleOnStatusPage: "off",
    publishOnStatusPageAt: "any",
    statusPages: "any",
    monitors: "any",
  },
  StatusPageAnnouncement: {
    showAnnouncementAt: "any",
    endAnnouncementAt: "any",
    statusPages: "any",
    monitors: "any",
  },
};

/*
 * A status page's own configuration: the page, its groups, its resources
 * and the rules that add monitors to it, and what its header, footer and
 * sign-in page show - its links and its single sign-on (the page's settings,
 * StatusPageReadCache, are kept by the same generation). Any write or delete
 * of it may take something off the page - but for
 * UNSHOWN_CONFIGURATION_COLUMNS.
 */
export const STATUS_PAGE_CONFIGURATION_TABLES: ReadonlyArray<string> = [
  "StatusPage",
  "StatusPageGroup",
  "StatusPageResource",
  "StatusPageMonitorRule",
  "StatusPageHeaderLink",
  "StatusPageIncidentCategory",
  "StatusPageFooterLink",
  "StatusPageSSO",
];

/*
 * The columns of a page's configuration that nothing a visitor is shown
 * depends on: bookkeeping OneUptime writes as it works (that the owners
 * heard of the page, when its next report goes out). A write of only these
 * takes nothing off.
 */
export const UNSHOWN_CONFIGURATION_COLUMNS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  StatusPage: ["isOwnerNotifiedOfResourceCreation", "sendNextReportBy"],
};

/*
 * The records whose delete takes something off a status page: those above,
 * the public notes shown with them, an incident's place in an episode (an
 * episode reaches a page through its incidents), a page's own
 * configuration, and the monitors a page shows - a monitor, a monitor group,
 * a monitor's place in a group - whose delete the database carries on to
 * the page's resources and the incidents' monitors by itself.
 */
export const SHOWN_RECORD_TABLES: ReadonlyArray<string> = [
  ...Object.keys(HIDING_WRITES),
  "IncidentPublicNote",
  "IncidentEpisodePublicNote",
  "ScheduledMaintenancePublicNote",
  "IncidentEpisodeMember",
  ...STATUS_PAGE_CONFIGURATION_TABLES,
  "Monitor",
  "MonitorGroup",
  "MonitorGroupResource",
];

/*
 * A generation outlives every entry kept under it many times over, so one
 * that expires can only ever be read as the default by entries long gone.
 */
const GENERATION_TTL_SECONDS: number = 24 * 60 * 60;

// The project of each page, which never changes, kept per process.
const PROJECT_OF_PAGE_TTL_MS: number = 60 * 60 * 1000;

// A row as a read hands it over: its columns by name.
type Row = Record<string, unknown>;

export default class StatusPageOverviewCache {
  // How long a page's overview is kept, at most.
  public static readonly TTL_MS: number = 15_000;

  /*
   * How long this process goes by the shared generation it read from Redis
   * before it asks again: a change made in another process is seen here
   * within it, and Redis is asked at most once per project in it - not on
   * every request.
   */
  public static readonly SHARED_GENERATION_READ_TTL_MS: number =
    CacheGenerations.SHARED_READ_TTL_MS;

  // The overviews, by page and the generation they were built in.
  private static responses: InMemoryTTLCache<unknown> =
    new InMemoryTTLCache<unknown>(500);

  /*
   * Builds under way, by the same key, so requests that miss together share
   * one build instead of each reading the database.
   */
  private static inFlight: Map<string, Promise<unknown>> = new Map();

  /*
   * Each overview's uptime history, by zone key
   * (StatusPageUptimeTimezone.getZoneKey), kept on the overview itself: it
   * lives exactly as long as the overview it was cut for, is built once per
   * clock however many visitors ask, and goes with the overview when that
   * runs out or a new generation starts.
   */
  private static uptimeHistories: WeakMap<
    StatusPageOverviewBase,
    OverviewHistories
  > = new WeakMap<StatusPageOverviewBase, OverviewHistories>();

  /*
   * The overviews kept in Redis too, by the object this process serves:
   * where their uptime histories are kept there, and when both run out.
   */
  private static sharedOverviews: WeakMap<
    StatusPageOverviewBase,
    SharedOverview
  > = new WeakMap<StatusPageOverviewBase, SharedOverview>();

  /*
   * Each project's generation: the shared one, from Redis, and this
   * process's own (CacheGenerations).
   */
  private static generations: CacheGenerations = new CacheGenerations({
    namespace: STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE,
    ttlSeconds: GENERATION_TTL_SECONDS,
    maxKeys: 10_000,
    description: "status page overviews",
  });

  // The project of each page.
  private static projectOfPage: InMemoryTTLCache<string> =
    new InMemoryTTLCache<string>(10_000);

  /*
   * The overview of a page: the one kept for it in its project's current
   * generation, else one built now by `build` (shared with any other request
   * for it that arrives meanwhile) and kept. A failed build is never kept.
   * The response is shared between requests and must not be changed.
   */
  public static async getOrBuild<T = JSONObject>(data: {
    statusPageId: ObjectID;
    // The page's project; null when it cannot be read.
    readProjectId: () => Promise<ObjectID | null>;
    build: () => Promise<T>;
    /*
     * How the overview is written to Redis and read back, so one process
     * builds it for every process (StatusPageSharedReads) while the page's
     * generation is read from Redis. Left out, each process builds its own.
     */
    shared?: SharedForm<T> | undefined;
  }): Promise<T> {
    const cacheKey: StatusPageCacheKey = await this.getPageKey(data);
    const key: string = cacheKey.key;

    const kept: unknown = this.responses.get(key);

    if (kept) {
      return kept as T;
    }

    let building: Promise<unknown> | undefined = this.inFlight.get(key);

    if (!building) {
      const sharedKey: string | null =
        data.shared && cacheKey.isShared ? `overview|${key}` : null;

      const read: Promise<SharedRead<T>> = sharedKey
        ? StatusPageSharedReads.getOrBuild<T>({
            key: sharedKey,
            ttlMs: this.TTL_MS,
            build: data.build,
            toJSON: data.shared!.toJSON,
            fromJSON: data.shared!.fromJSON,
          })
        : this.buildHere(data.build);

      const built: Promise<T> = read.then((shared: SharedRead<T>): T => {
        const lifetime: number = shared.expiresAt - Date.now();

        if (lifetime > 0) {
          this.responses.set(key, shared.value, lifetime);
        }

        if (sharedKey && shared.value && typeof shared.value === "object") {
          this.sharedOverviews.set(
            shared.value as unknown as StatusPageOverviewBase,
            {
              key: sharedKey,
              expiresAt: shared.expiresAt,
            },
          );
        }

        return shared.value;
      });

      building = built;
      this.inFlight.set(key, built);

      built
        .catch(() => {
          // A failed build is never kept; the next request builds again.
        })
        .finally(() => {
          this.inFlight.delete(key);
        });
    }

    return (await building) as T;
  }

  // A build in this process alone, kept for TTL_MS from when it started.
  private static async buildHere<T>(
    build: () => Promise<T>,
  ): Promise<SharedRead<T>> {
    const startedAt: number = Date.now();

    return { value: await build(), expiresAt: startedAt + this.TTL_MS };
  }

  /**
   * A page's whole overview for a visitor in `timezone`: the overview every
   * visitor shares, with its uptime history cut in their zone
   * (getOrBuildUptimeHistory). Kept on the overview per zone asked for, so
   * a visitor who asks again within its life is handed the very same
   * object. Must not be changed.
   */
  public static async getOrBuildOverviewInZone(data: {
    overview: StatusPageOverviewBase;
    timezone: string;
    build: () => Promise<{ json: JSONObject; cutIn: string }>;
  }): Promise<JSONObject> {
    const histories: OverviewHistories = this.getHistories(data.overview);

    let response: Promise<JSONObject> | undefined =
      histories.responsesByTimezone.get(data.timezone);

    if (!response) {
      const built: Promise<JSONObject> = this.getOrBuildUptimeHistory({
        overview: data.overview,
        timezone: data.timezone,
        startDate: data.overview.uptimeHistory.startDate,
        endDate: data.overview.uptimeHistory.endDate,
        build: data.build,
      }).then((history: JSONObject): JSONObject => {
        return { ...data.overview.response, ...history };
      });

      response = built;
      histories.responsesByTimezone.set(data.timezone, built);

      built.catch(() => {
        // A failed build is never kept; the next request builds again.
        if (histories.responsesByTimezone.get(data.timezone) === built) {
          histories.responsesByTimezone.delete(data.timezone);
        }
      });
    }

    return await response;
  }

  /**
   * An overview's uptime history in one zone: the one kept on `overview`
   * for the zone's key, else one built now by `build` (shared with any
   * request for the same key that arrives meanwhile) and kept on it.
   *
   * Zones with the same key cut the same days over the overview's window
   * (StatusPageUptimeTimezone.getZoneKey), so a history built for one is
   * served to the others, labelled with the zone each visitor asked for.
   * One that fell back to UTC keeps saying UTC. A failed build is never
   * kept. The JSON is shared between requests and must not be changed.
   */
  public static async getOrBuildUptimeHistory(data: {
    overview: StatusPageOverviewBase;
    timezone: string;
    startDate: Date;
    endDate: Date;
    build: () => Promise<{ json: JSONObject; cutIn: string }>;
  }): Promise<JSONObject> {
    const zoneKey: string = StatusPageUptimeTimezone.getZoneKey({
      timezone: data.timezone,
      startDate: data.startDate,
      endDate: data.endDate,
    });

    const byZoneKey: Map<string, UptimeHistoryEntry> = this.getHistories(
      data.overview,
    ).byZoneKey;

    let entry: UptimeHistoryEntry | undefined = byZoneKey.get(zoneKey);

    if (!entry) {
      const built: Promise<{ json: JSONObject; cutIn: string }> =
        this.buildUptimeHistoryOnce({
          overview: data.overview,
          zoneKey: zoneKey,
          startDate: data.startDate,
          build: data.build,
        });
      const thisEntry: UptimeHistoryEntry = { history: built };

      entry = thisEntry;
      byZoneKey.set(zoneKey, thisEntry);

      built.catch(() => {
        // A failed build is never kept; the next request builds again.
        if (byZoneKey.get(zoneKey) === thisEntry) {
          byZoneKey.delete(zoneKey);
        }
      });
    }

    const history: { json: JSONObject; cutIn: string } = await entry.history;

    if (history.cutIn === data.timezone) {
      return history.json;
    }

    // a history cut in another zone than this visitor's own key: as it is.
    if (
      StatusPageUptimeTimezone.getZoneKey({
        timezone: history.cutIn,
        startDate: data.startDate,
        endDate: data.endDate,
      }) !== zoneKey
    ) {
      return history.json;
    }

    return this.labelUptimeHistory(history.json, data.timezone);
  }

  /*
   * A zone's uptime history for an overview: built here, or - for an
   * overview kept in Redis - built once for every process that serves it,
   * and kept there until the overview runs out (StatusPageSharedReads).
   */
  private static async buildUptimeHistoryOnce(data: {
    overview: StatusPageOverviewBase;
    zoneKey: string;
    startDate: Date;
    build: () => Promise<{ json: JSONObject; cutIn: string }>;
  }): Promise<{ json: JSONObject; cutIn: string }> {
    const shared: SharedOverview | undefined = this.sharedOverviews.get(
      data.overview,
    );

    if (!shared || shared.expiresAt <= Date.now()) {
      return await data.build();
    }

    return (
      await StatusPageSharedReads.getOrBuild<{
        json: JSONObject;
        cutIn: string;
      }>({
        key: `${shared.key}|history|${data.startDate.getTime()}|${data.zoneKey}`,
        ttlMs: this.TTL_MS,
        expiresAt: shared.expiresAt,
        build: data.build,
        toJSON: (history: { json: JSONObject; cutIn: string }): unknown => {
          return history;
        },
        fromJSON: (json: unknown): { json: JSONObject; cutIn: string } => {
          const history: { json?: unknown; cutIn?: unknown } = (json || {}) as {
            json?: unknown;
            cutIn?: unknown;
          };

          if (
            !history.json ||
            typeof history.json !== "object" ||
            typeof history.cutIn !== "string"
          ) {
            throw new Error("Not an uptime history");
          }

          return {
            json: history.json as JSONObject,
            cutIn: history.cutIn,
          };
        },
      })
    ).value;
  }

  // What is kept on an overview, made the first time it is asked for.
  private static getHistories(
    overview: StatusPageOverviewBase,
  ): OverviewHistories {
    let histories: OverviewHistories | undefined =
      this.uptimeHistories.get(overview);

    if (!histories) {
      histories = {
        byZoneKey: new Map<string, UptimeHistoryEntry>(),
        responsesByTimezone: new Map<string, Promise<JSONObject>>(),
      };
      this.uptimeHistories.set(overview, histories);
    }

    return histories;
  }

  /*
   * A history labelled with another zone of the same clock: new objects for
   * the two aggregates, sharing their buckets, so the kept JSON is not
   * changed.
   */
  private static labelUptimeHistory(
    json: JSONObject,
    timezone: string,
  ): JSONObject {
    const labelled: JSONObject = { ...json };

    for (const field of [
      "uptimeDailyAggregate",
      "monitorGroupUptimeDailyAggregate",
    ]) {
      const aggregate: unknown = json[field];

      if (aggregate && typeof aggregate === "object") {
        labelled[field] = {
          ...(aggregate as JSONObject),
          timezone: timezone,
        };
      }
    }

    return labelled;
  }

  /*
   * After records are updated: a write that can take something off a status
   * page (mayTakeSomethingOff) starts a new generation of the rows'
   * projects' overviews. Best-effort: never fails the write.
   */
  public static async afterUpdate(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
    written: unknown;
  }): Promise<void> {
    if (
      data.rows.length === 0 ||
      !this.mayTakeSomethingOff(data.tableName, data.written)
    ) {
      return;
    }

    await this.forgetProjects(this.getProjectIds(data.rows));
  }

  /*
   * After records are deleted: a deleted record a status page may show
   * (SHOWN_RECORD_TABLES) starts a new generation of its project's
   * overviews. Best-effort: never fails the delete.
   */
  public static async afterDelete(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
  }): Promise<void> {
    if (data.rows.length === 0 || !this.forgetsOnDelete(data.tableName)) {
      return;
    }

    await this.forgetProjects(this.getProjectIds(data.rows));
  }

  /*
   * Whether a write to a table can take something off a status page: a
   * write of a page's own configuration, unless it writes only bookkeeping
   * no visitor sees (UNSHOWN_CONFIGURATION_COLUMNS), and a write of a column
   * of HIDING_WRITES as it may hide - a switch that shows a record written
   * as anything but on, one that hides it written as anything but off, or
   * any value of a column of "any". A write that can only show more cannot.
   */
  public static mayTakeSomethingOff(
    tableName: string | null | undefined,
    written: unknown,
  ): boolean {
    if (!tableName) {
      return false;
    }

    const row: Row = (written || {}) as Row;

    if (STATUS_PAGE_CONFIGURATION_TABLES.includes(tableName)) {
      const unshown: ReadonlyArray<string> =
        Object.prototype.hasOwnProperty.call(
          UNSHOWN_CONFIGURATION_COLUMNS,
          tableName,
        )
          ? UNSHOWN_CONFIGURATION_COLUMNS[tableName]!
          : [];

      return Object.entries(row).some(
        ([column, value]: [string, unknown]): boolean => {
          return value !== undefined && !unshown.includes(column);
        },
      );
    }

    if (!Object.prototype.hasOwnProperty.call(HIDING_WRITES, tableName)) {
      return false;
    }

    return Object.entries(HIDING_WRITES[tableName]!).some(
      ([column, hidingWrite]: [string, HidingWrite]): boolean => {
        const value: unknown = row[column];

        if (value === undefined) {
          return false;
        }

        if (hidingWrite === "off") {
          return value !== true;
        }

        if (hidingWrite === "on") {
          return value !== false && value !== null;
        }

        return true;
      },
    );
  }

  // Whether a delete of a table's rows starts a new generation.
  public static forgetsOnDelete(tableName: string | null | undefined): boolean {
    return Boolean(tableName) && SHOWN_RECORD_TABLES.includes(tableName!);
  }

  /*
   * Starts a new generation of these projects' overviews, here at once and -
   * through Redis - in every other process: nothing built before is served
   * again. Never throws.
   */
  public static async forgetProjects(
    projectIds: Array<ObjectID | string>,
  ): Promise<void> {
    // Every project's together, each once however its id was written.
    await this.generations.bump(
      projectIds.map((id: ObjectID | string): string => {
        return this.generationKey(id.toString().toLowerCase());
      }),
    );
  }

  /*
   * The current generation of a project's status page caches: what anything
   * else a status page serves from a cache keeps its entries under, so a
   * record taken off a page is gone from it at once there too - the page's
   * maintenance calendar does (StatusPageMaintenanceCalendarFeed). Never
   * throws (CacheGenerations).
   */
  public static async getProjectGeneration(
    projectId: ObjectID | string,
  ): Promise<string> {
    return await this.generations.get(
      this.generationKey(projectId.toString().toLowerCase()),
    );
  }

  // Drops everything this process keeps. For tests.
  public static clear(): void {
    this.responses.clear();
    this.inFlight.clear();
    this.uptimeHistories = new WeakMap<
      StatusPageOverviewBase,
      OverviewHistories
    >();
    this.sharedOverviews = new WeakMap<
      StatusPageOverviewBase,
      SharedOverview
    >();
    this.generations.clear();
    this.projectOfPage.clear();
  }

  /*
   * The key a page's reads are kept under: the page, and its project's
   * generation as it stands before the build - or the page alone when its
   * project cannot be read. Its overview is kept under it, and so is
   * everything else a page serves from a cache (StatusPageReadCache,
   * StatusPageImageCache), so a write that takes something off a page, or
   * changes its settings, is a new key for all of them at once. Never
   * throws.
   */
  public static async getPageKey(data: {
    statusPageId: ObjectID;
    readProjectId: () => Promise<ObjectID | null>;
  }): Promise<StatusPageCacheKey> {
    const statusPageId: string = data.statusPageId.toString().toLowerCase();
    const projectId: string | null = await this.getProjectOfPage(
      statusPageId,
      data.readProjectId,
    );

    if (!projectId) {
      return { key: statusPageId, hasProject: false, isShared: false };
    }

    const generation: string = await this.generations.get(
      this.generationKey(projectId),
    );

    return {
      key: `${statusPageId}|${generation}`,
      hasProject: true,
      isShared: CacheGenerations.isSharedGeneration(generation),
    };
  }

  private static async getProjectOfPage(
    statusPageId: string,
    readProjectId: () => Promise<ObjectID | null>,
  ): Promise<string | null> {
    const kept: string | undefined = this.projectOfPage.get(statusPageId);

    if (kept) {
      return kept;
    }

    try {
      const read: ObjectID | null = await readProjectId();
      const projectId: string = read ? read.toString().toLowerCase() : "";

      if (!ObjectID.isValidUUID(projectId)) {
        return null;
      }

      this.projectOfPage.set(statusPageId, projectId, PROJECT_OF_PAGE_TTL_MS);

      return projectId;
    } catch (err) {
      logger.error(
        `Could not read the project of status page ${statusPageId}; its overview is kept for a few seconds only: ${String(err)}`,
      );

      return null;
    }
  }

  private static generationKey(projectId: string): string {
    return `generation-${projectId}`;
  }

  // The projects of rows, each once; rows without one are left out.
  private static getProjectIds(rows: Array<unknown>): Array<string> {
    const projectIds: Set<string> = new Set<string>();

    for (const row of rows) {
      const value: unknown = ((row || {}) as Row)["projectId"];
      const projectId: string =
        value === undefined || value === null ? "" : String(value);

      if (ObjectID.isValidUUID(projectId)) {
        projectIds.add(projectId.toLowerCase());
      }
    }

    return Array.from(projectIds);
  }
}
