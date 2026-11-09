import {
  MIN_DISCOVERED_DEVICE_RETENTION_IN_DAYS,
  readDiscoveredDeviceRetentionInDays,
} from "../../../Types/NetworkDevice/DiscoveredDeviceRetention";
import ObjectID from "../../../Types/ObjectID";
import NetworkEndpointService from "../../Services/NetworkEndpointService";
import logger from "../Logger";
import {
  DiscoveredDeviceStatement,
  StatementParams,
} from "./DiscoveredDeviceQuery";

/*
 * REMOVING DISCOVERED DEVICES NOTHING SEES ANY MORE (OneUptime issue #6389).
 *
 * The Discovered Devices list is every NetworkEndpoint row of a project, and
 * a row used to stay for good: a guest phone, a laptop that left, a printer
 * that was replaced. This removes the ones not seen for the project's
 * Project.discoveredDeviceRetentionInDays (30 days unless a Project Owner or
 * Admin picked another, 0 for never), a project at a time, a batch at a
 * time, for the Workers job NetworkDeviceDiscovery:AgeOutDiscoveredDevices.
 *
 * WHAT STAYS, HOWEVER LONG IT IS NOT SEEN
 *
 *   - A monitored device: a live, unarchived NetworkDevice of the project
 *     has its MAC, compared as twelve hex digits - the list's own "monitored
 *     by MAC" (DiscoveredDeviceQuery). By address it never is: the list
 *     matches by address only while a sighting is current, and one past the
 *     retention never is. A device added to monitoring from the list carries
 *     the endpoint's MAC, so it stays.
 *   - A classified device (what a person said it is), one a person added or
 *     changed (NetworkEndpoint.editedAt, createdByUserId), and one never
 *     seen at all (lastSeenAt empty: nothing to count from).
 *   - A device whose switch, router or access point has seen nothing for a
 *     day while it is still in OneUptime: its probe is down, its credentials
 *     broke, or the whole installation was stopped for a while. Its devices
 *     were not looked for, so they are not called gone; they wait until it
 *     reports again. A device whose observer was deleted or archived is no
 *     longer looked for at all, so it ages as the rest.
 *
 * HOW A DEVICE IS REMOVED
 *
 * Soft deleted (deletedAt), as a person's Delete is, so every read already
 * leaves it out: the list, its counts, its search and its select-all, the
 * topology map, the Network overview's count, a discovery import's lookup of
 * the rows it was given (the import copies what it needs when it starts).
 * The unique (projectId, macAddress) index covers live rows only, so a device
 * seen again is a new row - first seen now, nothing stale carried with it -
 * and the next walk's upsert finds no live row to update. Its map
 * suppression (a Hide from map) goes in the same statement: it names the
 * removed row's id, which nothing will draw again, so a device that comes
 * back is on the map again. Soft deleted rows are purged with every other
 * model's on OneUptime Cloud (HardDelete).
 *
 * The statement re-checks on the row it writes what made it due - still
 * live, still not seen since, still unclassified and unedited - so a walk or
 * a person that got there first wins, without a lock.
 *
 * HOW MUCH, HOW OFTEN
 *
 * Hourly. The projects due are found a page at a time by the index on
 * (projectId, lastSeenAt) of live rows; each project gets at most
 * MAX_BATCHES_PER_PROJECT batches of BATCH_SIZE a run, the oldest first, so
 * one project with a long backlog drains over a few runs without holding
 * up the rest, and a run stops starting work once its time budget is spent.
 */

export type DiscoveredDeviceAgeOutQueryRunner = (
  sql: string,
  params: Array<unknown>,
) => Promise<Array<Record<string, unknown>>>;

export interface DueDiscoveredDeviceProject {
  projectId: string;
  retentionInDays: number;
}

export interface DueDiscoveredDeviceProjectsPage {
  projects: Array<DueDiscoveredDeviceProject>;
  // Where the next page starts; undefined when this one was the last.
  nextAfterProjectId?: string | undefined;
}

export interface DiscoveredDeviceAgeOutResult {
  // Devices removed from the list.
  removed: number;
  // Hide from map preferences removed with them.
  unhidden: number;
}

export interface DiscoveredDeviceAgeOutSummary
  extends DiscoveredDeviceAgeOutResult {
  // Projects that had devices due, and were worked on.
  projects: number;
  // Projects whose work failed: logged, and tried again next run.
  failedProjects: number;
  // The time budget ran out before every project due was worked on.
  isCutShort: boolean;
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

// Rows one statement removes, at most.
export const AGE_OUT_BATCH_SIZE: number = 1000;

// Statements one project gets in one run, at most.
export const MAX_AGE_OUT_BATCHES_PER_PROJECT: number = 20;

// Projects read at a time.
export const AGE_OUT_PROJECTS_PER_PAGE: number = 100;

/*
 * How lately a device must have seen anything for the devices it saw to be
 * aged: a walk reports every few minutes and a network controller's client
 * list every two hours, so a day of silence is an outage, not a quiet hour.
 */
export const AGE_OUT_REPORTING_WINDOW_MS: number = DAY_MS;

/*
 * What a run may spend starting work; the job's own timeout is longer, so a
 * statement already running finishes.
 */
export const AGE_OUT_TIME_BUDGET_MS: number = 8 * 60 * 1000;

// Twelve hex digits of a MAC however it is written, as the list compares them.
function macKey(column: string): string {
  return `regexp_replace(lower(COALESCE(${column}, '')), '[^0-9a-f]', '', 'g')`;
}

/*
 * Projects that remove devices and hold at least one live device last seen
 * before their own cut-off, after `afterProjectId`, in id order.
 */
export function buildDueProjectsStatement(data: {
  now: Date;
  afterProjectId?: string | undefined;
  limit: number;
}): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const now: string = params.add(data.now);
  const minDays: string = params.add(MIN_DISCOVERED_DEVICE_RETENTION_IN_DAYS);
  const filters: Array<string> = [
    `p."deletedAt" IS NULL`,
    `p."discoveredDeviceRetentionInDays" >= ${minDays}`,
  ];

  if (data.afterProjectId) {
    filters.push(`p."_id" > ${params.add(data.afterProjectId)}::uuid`);
  }

  const limit: string = params.add(Math.max(1, Math.floor(data.limit)));

  return {
    sql: `SELECT p."_id"::text AS "projectId", p."discoveredDeviceRetentionInDays" AS "retentionInDays"
FROM "Project" p
WHERE ${filters.join("\n  AND ")}
  AND EXISTS (
    SELECT 1
    FROM "NetworkEndpoint" e
    WHERE e."projectId" = p."_id"
      AND e."deletedAt" IS NULL
      AND e."lastSeenAt" < ${now}::timestamptz - make_interval(days => p."discoveredDeviceRetentionInDays")
  )
ORDER BY p."_id" ASC
LIMIT ${limit}`,
    params: params.values,
  };
}

// The devices of a project that saw any of its endpoints at or after `since`.
export function buildReportingDevicesStatement(data: {
  projectId: string;
  since: Date;
}): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const project: string = params.add(data.projectId);
  const since: string = params.add(data.since);

  return {
    sql: `SELECT DISTINCT e."attachedNetworkDeviceId"::text AS "deviceId"
FROM "NetworkEndpoint" e
WHERE e."projectId" = ${project}::uuid
  AND e."deletedAt" IS NULL
  AND e."lastSeenAt" >= ${since}::timestamptz`,
    params: params.values,
  };
}

/*
 * One batch of a project's devices due, removed: the oldest first, with
 * their Hide from map preferences. Answers how many of each, through a
 * SELECT over the writes' RETURNING rows (TypeORM's Postgres driver answers
 * a bare UPDATE or DELETE with [rows, rowCount], not the rows).
 */
export function buildAgeOutStatement(data: {
  projectId: string;
  // Devices last seen before this are due.
  seenBefore: Date;
  // Devices that reported lately (buildReportingDevicesStatement).
  reportingDeviceIds: Array<string>;
  limit: number;
  removedAt: Date;
}): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const project: string = params.add(data.projectId);
  const seenBefore: string = params.add(data.seenBefore);
  const reporting: string = params.add(data.reportingDeviceIds);
  const limit: string = params.add(Math.max(1, Math.floor(data.limit)));
  const removedAt: string = params.add(data.removedAt);

  return {
    sql: `WITH monitored AS (
  SELECT DISTINCT ${macKey(`d."macAddress"`)} AS "macKey"
  FROM "NetworkDevice" d
  WHERE d."projectId" = ${project}::uuid
    AND d."deletedAt" IS NULL
    AND COALESCE(d."isArchived", false) = false
    AND length(${macKey(`d."macAddress"`)}) = 12
),
due AS (
  SELECT e."_id"
  FROM "NetworkEndpoint" e
  LEFT JOIN "NetworkDevice" o ON o."_id" = e."attachedNetworkDeviceId"
  WHERE e."projectId" = ${project}::uuid
    AND e."deletedAt" IS NULL
    AND e."lastSeenAt" < ${seenBefore}::timestamptz
    AND COALESCE(btrim(e."classification"), '') = ''
    AND e."editedAt" IS NULL
    AND e."createdByUserId" IS NULL
    AND (
      o."_id" IS NULL
      OR o."deletedAt" IS NOT NULL
      OR COALESCE(o."isArchived", false) = true
      OR e."attachedNetworkDeviceId" = ANY(${reporting}::uuid[])
    )
    AND NOT EXISTS (
      SELECT 1 FROM monitored m
      WHERE m."macKey" = ${macKey(`e."macAddress"`)}
    )
  ORDER BY e."lastSeenAt" ASC, e."_id" ASC
  LIMIT ${limit}
),
removed AS (
  UPDATE "NetworkEndpoint" t
  SET "deletedAt" = ${removedAt}::timestamptz, "updatedAt" = ${removedAt}::timestamptz
  FROM due
  WHERE t."_id" = due."_id"
    AND t."deletedAt" IS NULL
    AND t."lastSeenAt" < ${seenBefore}::timestamptz
    AND COALESCE(btrim(t."classification"), '') = ''
    AND t."editedAt" IS NULL
    AND t."createdByUserId" IS NULL
  RETURNING t."_id"
),
unhidden AS (
  DELETE FROM "NetworkTopologySuppression" s
  USING removed r
  WHERE s."projectId" = ${project}::uuid
    AND s."nodeKey" = 'endpoint:' || r."_id"::text
  RETURNING s."_id"
)
SELECT
  (SELECT COUNT(*) FROM removed)::int AS "removed",
  (SELECT COUNT(*) FROM unhidden)::int AS "unhidden"`,
    params: params.values,
  };
}

function count(value: unknown): number {
  const number: number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export default class DiscoveredDeviceAgeOut {
  // Seams for tests: the statement runner and the clock.
  public static runQuery: DiscoveredDeviceAgeOutQueryRunner = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    return (await NetworkEndpointService.getRepository().manager.query(
      sql,
      params,
    )) as Array<Record<string, unknown>>;
  };

  public static now: () => Date = (): Date => {
    return new Date();
  };

  /*
   * Every project due, as far as the time budget goes. One project's
   * failure is logged and the rest go on: it is tried again next run.
   */
  public static async run(options?: {
    timeBudgetMs?: number | undefined;
  }): Promise<DiscoveredDeviceAgeOutSummary> {
    const budgetMs: number = options?.timeBudgetMs ?? AGE_OUT_TIME_BUDGET_MS;
    const startedAt: number = this.now().getTime();

    const summary: DiscoveredDeviceAgeOutSummary = {
      projects: 0,
      failedProjects: 0,
      removed: 0,
      unhidden: 0,
      isCutShort: false,
    };

    const isOutOfTime: () => boolean = (): boolean => {
      return this.now().getTime() - startedAt >= budgetMs;
    };

    let afterProjectId: string | undefined = undefined;
    let isLastPage: boolean = false;

    while (!isLastPage) {
      const page: DueDiscoveredDeviceProjectsPage = await this.findDueProjects({
        now: this.now(),
        afterProjectId: afterProjectId,
      });

      for (const project of page.projects) {
        if (isOutOfTime()) {
          summary.isCutShort = true;
          return summary;
        }

        summary.projects += 1;

        try {
          const result: DiscoveredDeviceAgeOutResult = await this.ageOutProject(
            {
              projectId: project.projectId,
              retentionInDays: project.retentionInDays,
              isOutOfTime: isOutOfTime,
            },
          );

          summary.removed += result.removed;
          summary.unhidden += result.unhidden;
        } catch (error) {
          summary.failedProjects += 1;
          logger.error(
            `Discovered devices: removing the devices project ${project.projectId} no longer sees failed. It is tried again next run.`,
          );
          logger.error(error);
        }
      }

      isLastPage = !page.nextAfterProjectId;
      afterProjectId = page.nextAfterProjectId;
    }

    return summary;
  }

  /*
   * One page of the projects due, and where the next page starts: after the
   * last project the page read, whether or not it is worked on, or nowhere
   * when the page was not full.
   */
  public static async findDueProjects(data: {
    now: Date;
    afterProjectId?: string | undefined;
  }): Promise<DueDiscoveredDeviceProjectsPage> {
    const statement: DiscoveredDeviceStatement = buildDueProjectsStatement({
      now: data.now,
      afterProjectId: data.afterProjectId,
      limit: AGE_OUT_PROJECTS_PER_PAGE,
    });

    const rows: Array<Record<string, unknown>> = await this.runQuery(
      statement.sql,
      statement.params,
    );

    const projects: Array<DueDiscoveredDeviceProject> = [];

    for (const row of rows) {
      const projectId: string = String(row["projectId"] || "");
      const retentionInDays: number | undefined =
        readDiscoveredDeviceRetentionInDays(row["retentionInDays"]);

      // Only a project's own setting, one of the choices, removes anything.
      if (
        !ObjectID.isValidUUID(projectId) ||
        !retentionInDays ||
        retentionInDays < MIN_DISCOVERED_DEVICE_RETENTION_IN_DAYS
      ) {
        continue;
      }

      projects.push({ projectId: projectId, retentionInDays: retentionInDays });
    }

    const lastProjectId: string = String(
      rows[rows.length - 1]?.["projectId"] || "",
    );

    return {
      projects: projects,
      nextAfterProjectId:
        rows.length >= AGE_OUT_PROJECTS_PER_PAGE &&
        ObjectID.isValidUUID(lastProjectId)
          ? lastProjectId
          : undefined,
    };
  }

  // One project's devices due, a batch at a time, up to MAX_AGE_OUT_BATCHES_PER_PROJECT.
  public static async ageOutProject(data: {
    projectId: string;
    retentionInDays: number;
    isOutOfTime?: (() => boolean) | undefined;
  }): Promise<DiscoveredDeviceAgeOutResult> {
    const result: DiscoveredDeviceAgeOutResult = { removed: 0, unhidden: 0 };

    if (data.retentionInDays < MIN_DISCOVERED_DEVICE_RETENTION_IN_DAYS) {
      return result;
    }

    const now: Date = this.now();
    const seenBefore: Date = new Date(
      now.getTime() - data.retentionInDays * DAY_MS,
    );

    const reportingStatement: DiscoveredDeviceStatement =
      buildReportingDevicesStatement({
        projectId: data.projectId,
        since: new Date(now.getTime() - AGE_OUT_REPORTING_WINDOW_MS),
      });

    const reportingDeviceIds: Array<string> = (
      await this.runQuery(reportingStatement.sql, reportingStatement.params)
    )
      .map((row: Record<string, unknown>): string => {
        return String(row["deviceId"] || "");
      })
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      });

    for (
      let batch: number = 0;
      batch < MAX_AGE_OUT_BATCHES_PER_PROJECT;
      batch++
    ) {
      if (batch > 0 && data.isOutOfTime?.()) {
        break;
      }

      const statement: DiscoveredDeviceStatement = buildAgeOutStatement({
        projectId: data.projectId,
        seenBefore: seenBefore,
        reportingDeviceIds: reportingDeviceIds,
        limit: AGE_OUT_BATCH_SIZE,
        removedAt: this.now(),
      });

      const answer: Record<string, unknown> | undefined = (
        await this.runQuery(statement.sql, statement.params)
      )[0];

      const removed: number = count(answer?.["removed"]);

      result.removed += removed;
      result.unhidden += count(answer?.["unhidden"]);

      // A batch short of full leaves nothing due behind it.
      if (removed < AGE_OUT_BATCH_SIZE) {
        break;
      }
    }

    return result;
  }
}
