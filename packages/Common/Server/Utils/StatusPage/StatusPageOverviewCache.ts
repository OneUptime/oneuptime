import GlobalCache from "../../Infrastructure/GlobalCache";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import { randomBytes } from "crypto";

/*
 * The status page overview, cached for a few seconds - and a record a status
 * page stops showing is gone from it at once.
 *
 * The overview (StatusPageAPI) is the busiest read a status page makes: every
 * visitor, every refresh. Each process keeps the response it built for a page
 * for TTL_MS, and builds it once for requests that arrive together. Who may
 * read the page is checked on every request before this is asked; the
 * response is the same for everyone who may.
 *
 * A record that stops being shown must not stay on the page until the entry
 * runs out: an incident, an episode or a scheduled maintenance event made
 * private, hidden from status pages, its postmortem taken off, or deleted
 * (SHOWN_RECORD_SWITCHES). Each such write starts a new generation of its
 * project's overviews: a random token in Redis, shared by every process, and
 * kept in this process too. Every entry is kept under the generation its
 * project had when its build started, so once the token changes no request,
 * on any process, is served an entry built before - it builds the page again.
 * A build that read the record before the write is kept under the old
 * generation, which nobody asks for any more. (OnCallCalendarFeedCache
 * invalidates its feeds the same way.)
 *
 * When Redis cannot be reached, the generation is this process's own copy: a
 * change made here takes effect here at once, and elsewhere within TTL_MS.
 * When a page's project cannot be read, its overview is kept for TTL_MS
 * alone, as before there were generations.
 */

export const STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE: string =
  "status-page-overview";

/*
 * The switches of each record a status page shows that decide whether it
 * does (StatusPageVisibility, PublishedImages): a write of any of them, or a
 * delete of the record, starts a new generation of its project's overviews.
 */
export const SHOWN_RECORD_SWITCHES: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  Incident: ["isVisibleOnStatusPage", "isPrivate", "showPostmortemOnStatusPage"],
  IncidentEpisode: ["isVisibleOnStatusPage", "isPrivate"],
  ScheduledMaintenance: ["isVisibleOnStatusPage"],
};

// What a generation reads as before any write started one.
const DEFAULT_GENERATION: string = "0";

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

  // The overviews, by page and the generation they were built in.
  private static responses: InMemoryTTLCache<JSONObject> =
    new InMemoryTTLCache<JSONObject>(500);

  /*
   * Builds under way, by the same key, so requests that miss together share
   * one build instead of each reading the database.
   */
  private static inFlight: Map<string, Promise<JSONObject>> = new Map();

  // Each project's generation as this process last set it.
  private static generations: InMemoryTTLCache<string> =
    new InMemoryTTLCache<string>(10_000);

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
   * After records are updated: a write of a switch that decides whether a
   * status page shows them (SHOWN_RECORD_SWITCHES) starts a new generation
   * of their projects' overviews. Best-effort: never fails the write.
   */
  public static async afterUpdate(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
    written: unknown;
  }): Promise<void> {
    const switches: ReadonlyArray<string> = this.getSwitches(data.tableName);

    if (switches.length === 0 || data.rows.length === 0) {
      return;
    }

    const written: Row = (data.written || {}) as Row;

    const writesASwitch: boolean = switches.some((column: string): boolean => {
      return written[column] !== undefined;
    });

    if (!writesASwitch) {
      return;
    }

    await this.forgetProjects(this.getProjectIds(data.rows));
  }

  /*
   * After records are deleted: a deleted record a status page may show
   * starts a new generation of its project's overviews. Best-effort: never
   * fails the delete.
   */
  public static async afterDelete(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
  }): Promise<void> {
    if (
      this.getSwitches(data.tableName).length === 0 ||
      data.rows.length === 0
    ) {
      return;
    }

    await this.forgetProjects(this.getProjectIds(data.rows));
  }

  // The switches of a table's records that decide whether a page shows them.
  public static getSwitches(
    tableName: string | null | undefined,
  ): ReadonlyArray<string> {
    if (
      !tableName ||
      !Object.prototype.hasOwnProperty.call(SHOWN_RECORD_SWITCHES, tableName)
    ) {
      return [];
    }

    return SHOWN_RECORD_SWITCHES[tableName] || [];
  }

  /*
   * Starts a new generation of these projects' overviews, here and - through
   * Redis - in every other process: nothing built before is served again.
   * Never throws.
   */
  public static async forgetProjects(
    projectIds: Array<ObjectID | string>,
  ): Promise<void> {
    for (const projectId of new Set<string>(
      projectIds.map((id: ObjectID | string): string => {
        return id.toString().toLowerCase();
      }),
    )) {
      // A value nobody can predict never meets one kept before.
      const generation: string = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;

      this.generations.set(
        projectId,
        generation,
        GENERATION_TTL_SECONDS * 1000,
      );

      try {
        await GlobalCache.setString(
          STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE,
          this.generationKey(projectId),
          generation,
          { expiresInSeconds: GENERATION_TTL_SECONDS },
        );
      } catch (err) {
        logger.error(
          `Status page overviews of project ${projectId} are refreshed in this process only: ${String(err)}`,
        );
      }
    }
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

    return `${statusPageId}|${await this.getGeneration(projectId)}`;
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

  /*
   * Redis first: another process may have started a generation since this
   * one did. This process's own copy only when Redis cannot be reached.
   */
  private static async getGeneration(projectId: string): Promise<string> {
    try {
      return (
        (await GlobalCache.getString(
          STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE,
          this.generationKey(projectId),
        )) || DEFAULT_GENERATION
      );
    } catch {
      return this.generations.get(projectId) || DEFAULT_GENERATION;
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
