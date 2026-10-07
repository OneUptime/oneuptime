import CacheGenerations from "../../Infrastructure/CacheGenerations";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

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
 * Something that stops being shown must not stay on the page until the entry
 * runs out. Every write that can take something off a status page starts a
 * new generation of its project's overviews (afterUpdate, afterDelete):
 *
 *   - an incident, an episode or a scheduled maintenance event hidden from
 *     status pages, made private, its postmortem taken off, limited to some
 *     pages, or moved off pages or monitors (HIDING_WRITES);
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
 * a note's text): they are seen when the entry runs out.
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
 * How a write of one column of a record can take it off a status page:
 *
 *   - "off": a switch that must be on for the record to be shown (Visible
 *     on Status Page) - written as anything but on, it may hide the record;
 *   - "on": a switch that hides the record when on (Private, limiting an
 *     incident to some pages) - written as anything but off, it may;
 *   - "any": a column any write of which may - the pages or monitors the
 *     record is shown for, an announcement's dates.
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
 * and the rules that add monitors to it. Any write or delete of it may take
 * something off the page - but for UNSHOWN_CONFIGURATION_COLUMNS.
 */
export const STATUS_PAGE_CONFIGURATION_TABLES: ReadonlyArray<string> = [
  "StatusPage",
  "StatusPageGroup",
  "StatusPageResource",
  "StatusPageMonitorRule",
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
  private static responses: InMemoryTTLCache<JSONObject> =
    new InMemoryTTLCache<JSONObject>(500);

  /*
   * Builds under way, by the same key, so requests that miss together share
   * one build instead of each reading the database.
   */
  private static inFlight: Map<string, Promise<JSONObject>> = new Map();

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
  public static async getOrBuild(data: {
    statusPageId: ObjectID;
    // The page's project; null when it cannot be read.
    readProjectId: () => Promise<ObjectID | null>;
    build: () => Promise<JSONObject>;
  }): Promise<JSONObject> {
    const key: string = await this.getKey(data);

    const kept: JSONObject | undefined = this.responses.get(key);

    if (kept) {
      return kept;
    }

    let building: Promise<JSONObject> | undefined = this.inFlight.get(key);

    if (!building) {
      building = data.build();
      this.inFlight.set(key, building);

      building
        .then((response: JSONObject) => {
          this.responses.set(key, response, this.TTL_MS);
        })
        .catch(() => {
          // A failed build is never kept; the next request builds again.
        })
        .finally(() => {
          this.inFlight.delete(key);
        });
    }

    return await building;
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

  // Drops everything this process keeps. For tests.
  public static clear(): void {
    this.responses.clear();
    this.inFlight.clear();
    this.generations.clear();
    this.projectOfPage.clear();
  }

  /*
   * The key a page's overview is kept under: the page, and its project's
   * generation as it stands before the build - or the page alone when its
   * project cannot be read.
   */
  private static async getKey(data: {
    statusPageId: ObjectID;
    readProjectId: () => Promise<ObjectID | null>;
  }): Promise<string> {
    const statusPageId: string = data.statusPageId.toString();
    const projectId: string | null = await this.getProjectOfPage(
      statusPageId,
      data.readProjectId,
    );

    if (!projectId) {
      return statusPageId;
    }

    return `${statusPageId}|${await this.generations.get(
      this.generationKey(projectId),
    )}`;
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
