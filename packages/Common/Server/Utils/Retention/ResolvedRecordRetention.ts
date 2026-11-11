import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import Query from "../../../Types/BaseDatabase/Query";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  MIN_RESOLVED_RECORD_RETENTION_IN_DAYS,
  ResolvedRecordKind,
  readResolvedRecordRetentionInDays,
} from "../../../Types/Retention/ResolvedRecordRetention";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentPostmortemStatusService from "../../Services/IncidentPostmortemStatusService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import ProjectService from "../../Services/ProjectService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * DELETING RESOLVED INCIDENTS AND ALERTS A PROJECT NO LONGER KEEPS (OneUptime
 * issue #6903).
 *
 * A project that picks a retention (Project.incidentRetentionInDays,
 * Project.alertRetentionInDays; Types/Retention/ResolvedRecordRetention) has
 * its incidents - or alerts - deleted once they have been resolved for
 * longer, a project at a time, a batch at a time, for the Workers jobs
 * Incident:DeleteResolvedIncidents and Alert:DeleteResolvedAlerts. A project
 * at 0, where every project starts, is never looked at.
 *
 * WHAT IS DELETED
 *
 * An incident (an alert) whose state counts as resolved
 * (Common/Utils/ResolvedState: the project's resolved state and any placed
 * after it), created before the cut-off, and with no move on its state
 * timeline since the cut-off - so the length runs from when it was resolved,
 * not from when it opened: one open for a year and resolved last week stays
 * another retention.
 *
 * WHAT STAYS, HOWEVER OLD IT IS
 *
 *   - Anything not resolved. Reopened, it is not resolved; resolved again,
 *     its length starts over.
 *   - An incident whose postmortem is completed - in a postmortem status
 *     flagged Completed - while the project keeps them
 *     (Project.keepIncidentsWithCompletedPostmortem, on by default). A
 *     drafted postmortem keeps nothing: OneUptime AI drafts one for every
 *     resolved incident where it is on, which would keep them all.
 *   - An incident (an alert) in an episode that is still open, or resolved
 *     within the retention: an episode's members go with it, never before
 *     it, so an episode is never left telling half its story.
 *   - An alert linked to an incident (IncidentAlert): it stays as long as
 *     the incident does, as the evidence the incident was declared from.
 *
 * EPISODES
 *
 * A resolved episode goes once it has been resolved for longer than the
 * retention, as its members do, and none of its members are left - its own
 * incidents (alerts) deleted just before it, or kept, which keeps it. While
 * the project keeps completed postmortems, an incident episode with a
 * postmortem written stays too (an episode's postmortem has no status; one
 * is only written when someone asks for it). An episode that stays after
 * losing members has its count - and a title written from it - updated.
 *
 * HOW
 *
 * The rows due are found here with plain reads; each batch is deleted
 * through its service's hardDeleteBy - the delete a retention purge makes:
 * the database's ON DELETE CASCADE takes everything the row carries (its
 * state timeline, feed, notes, owners, labels, notification logs, on-call
 * runs, SLA records, the links to monitors and other resources), the
 * service lets go of what the rows showed (status page caches, images
 * published on status pages, custom field files) and no person is notified:
 * workflows, live updates and notices are for what a person deletes. The
 * metrics an incident or alert wrote stay until their own retention: they
 * are the history a chart of incidents over time draws.
 *
 * Every batch is deleted by its ids and its state, so one reopened between
 * the read and the delete stays. Numbers are never given out again: they
 * come from the project's counters, not from the rows that are left.
 *
 * HOW MUCH, HOW OFTEN
 *
 * Hourly. The projects that keep resolved records for a while are read a
 * page at a time; each gets at most MAX_RETENTION_BATCHES_PER_PROJECT
 * batches of RETENTION_BATCH_SIZE a run, so a project turning retention on
 * with years of incidents drains over a few runs without holding up the
 * rest, and a run stops starting work once its time budget is spent. A
 * batch is any rows due, in no order: every one of them goes, and a read
 * that may stop at the batch's last row costs a project with a long history
 * far less than sorting all of it every batch.
 *
 * Every row a cascade reaches is found by an index - the columns that point
 * at an incident, an alert or an episode got the ones they lacked in
 * AddIndexesForIncidentAndAlertDeletes - so a batch reads the rows it
 * deletes, not whole tables.
 */

export type ResolvedRecordRetentionQueryRunner = (
  sql: string,
  params: Array<unknown>,
) => Promise<Array<Record<string, unknown>>>;

export interface ResolvedRecordRetentionStatement {
  sql: string;
  params: Array<unknown>;
}

export interface DueRetentionProject {
  projectId: string;
  retentionInDays: number;
  // Incidents only: whether incidents with a completed postmortem stay.
  keepCompletedPostmortems: boolean;
}

export interface DueRetentionProjectsPage {
  projects: Array<DueRetentionProject>;
  // Where the next page starts; undefined when this one was the last.
  nextAfterProjectId?: string | undefined;
}

export interface ResolvedRecordRetentionResult {
  // Incidents (alerts) deleted.
  records: number;
  // Their episodes deleted.
  episodes: number;
}

export interface ResolvedRecordRetentionSummary
  extends ResolvedRecordRetentionResult {
  // Projects that keep resolved records for a while, and were worked on.
  projects: number;
  // Projects whose work failed: logged, and tried again next run.
  failedProjects: number;
  // The time budget ran out before every project was worked on.
  isCutShort: boolean;
}

/*
 * The tables and columns a kind's statements name: fixed here, never taken
 * from a caller.
 */
interface RetentionTables {
  retentionColumn: string;
  recordTable: string;
  stateColumn: string;
  timelineTable: string;
  timelineRecordColumn: string;
  memberTable: string;
  memberRecordColumn: string;
  memberEpisodeColumn: string;
  episodeTable: string;
  episodeStateColumn: string;
  episodeTimelineTable: string;
  episodeTimelineColumn: string;
}

const TABLES: Record<ResolvedRecordKind, RetentionTables> = {
  [ResolvedRecordKind.Incident]: {
    retentionColumn: "incidentRetentionInDays",
    recordTable: "Incident",
    stateColumn: "currentIncidentStateId",
    timelineTable: "IncidentStateTimeline",
    timelineRecordColumn: "incidentId",
    memberTable: "IncidentEpisodeMember",
    memberRecordColumn: "incidentId",
    memberEpisodeColumn: "incidentEpisodeId",
    episodeTable: "IncidentEpisode",
    episodeStateColumn: "currentIncidentStateId",
    episodeTimelineTable: "IncidentEpisodeStateTimeline",
    episodeTimelineColumn: "incidentEpisodeId",
  },
  [ResolvedRecordKind.Alert]: {
    retentionColumn: "alertRetentionInDays",
    recordTable: "Alert",
    stateColumn: "currentAlertStateId",
    timelineTable: "AlertStateTimeline",
    timelineRecordColumn: "alertId",
    memberTable: "AlertEpisodeMember",
    memberRecordColumn: "alertId",
    memberEpisodeColumn: "alertEpisodeId",
    episodeTable: "AlertEpisode",
    episodeStateColumn: "currentAlertStateId",
    episodeTimelineTable: "AlertEpisodeStateTimeline",
    episodeTimelineColumn: "alertEpisodeId",
  },
};

const DAY_MS: number = 24 * 60 * 60 * 1000;

/*
 * Rows one delete takes, at most: each takes its timeline, feed, notes and
 * notification logs with it, and a synthetic monitor's timeline rows carry
 * screenshots, so a batch is kept small.
 */
export const RETENTION_BATCH_SIZE: number = 100;

// Batches one project gets in one run, at most, of records and of episodes each.
export const MAX_RETENTION_BATCHES_PER_PROJECT: number = 50;

// Projects read at a time.
export const RETENTION_PROJECTS_PER_PAGE: number = 100;

/*
 * What a run may spend starting work; the job's own timeout is longer, so a
 * delete already running finishes.
 */
export const RETENTION_TIME_BUDGET_MS: number = 10 * 60 * 1000;

// Collects a statement's parameters, numbering them as Postgres does.
class StatementParams {
  public readonly values: Array<unknown> = [];

  public add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function toIdTexts(ids: Array<ObjectID | string>): Array<string> {
  return ids
    .map((id: ObjectID | string): string => {
      return id.toString();
    })
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });
}

function toBatchLimit(limit: number): number {
  return Math.max(1, Math.floor(limit));
}

// The moment before which a record must have been resolved to be deleted.
export function getRetentionCutoff(data: {
  now: Date;
  retentionInDays: number;
}): Date {
  return new Date(data.now.getTime() - data.retentionInDays * DAY_MS);
}

/*
 * Projects that keep the kind's resolved records for a while - at least the
 * shortest choice; 0 keeps every one - after `afterProjectId`, in id order.
 */
export function buildDueProjectsStatement(data: {
  kind: ResolvedRecordKind;
  afterProjectId?: string | undefined;
  limit: number;
}): ResolvedRecordRetentionStatement {
  const tables: RetentionTables = TABLES[data.kind];
  const params: StatementParams = new StatementParams();
  const minDays: string = params.add(MIN_RESOLVED_RECORD_RETENTION_IN_DAYS);

  const filters: Array<string> = [
    `p."deletedAt" IS NULL`,
    `p."${tables.retentionColumn}" >= ${minDays}`,
  ];

  if (data.afterProjectId) {
    filters.push(`p."_id" > ${params.add(data.afterProjectId)}::uuid`);
  }

  const keepColumn: string =
    data.kind === ResolvedRecordKind.Incident
      ? `p."keepIncidentsWithCompletedPostmortem"`
      : `false`;

  const limit: string = params.add(toBatchLimit(data.limit));

  return {
    sql: `SELECT p."_id"::text AS "projectId", p."${tables.retentionColumn}" AS "retentionInDays", ${keepColumn} AS "keepCompletedPostmortems"
FROM "Project" p
WHERE ${filters.join("\n  AND ")}
ORDER BY p."_id" ASC
LIMIT ${limit}`,
    params: params.values,
  };
}

/*
 * One batch of a project's records due: resolved, created
 * before the cut-off, nothing on their state timeline since, in no episode
 * still open or resolved since the cut-off - and, for incidents, without a
 * completed postmortem while the project keeps those; for alerts, linked to
 * no incident.
 */
export function buildDueRecordsStatement(data: {
  kind: ResolvedRecordKind;
  projectId: string;
  resolvedStateIds: Array<ObjectID | string>;
  cutoff: Date;
  // Incidents only: postmortems in these statuses keep their incident.
  keptPostmortemStatusIds?: Array<ObjectID | string> | undefined;
  limit: number;
}): ResolvedRecordRetentionStatement {
  const tables: RetentionTables = TABLES[data.kind];
  const params: StatementParams = new StatementParams();
  const project: string = params.add(data.projectId);
  const resolved: string = params.add(toIdTexts(data.resolvedStateIds));
  const cutoff: string = params.add(data.cutoff);

  const filters: Array<string> = [
    `r."projectId" = ${project}::uuid`,
    `r."deletedAt" IS NULL`,
    `r."${tables.stateColumn}" = ANY(${resolved}::uuid[])`,
    `r."createdAt" < ${cutoff}::timestamptz`,
    `NOT EXISTS (
    SELECT 1
    FROM "${tables.timelineTable}" t
    WHERE t."${tables.timelineRecordColumn}" = r."_id"
      AND t."deletedAt" IS NULL
      AND t."startsAt" >= ${cutoff}::timestamptz
  )`,
    `NOT EXISTS (
    SELECT 1
    FROM "${tables.memberTable}" m
    JOIN "${tables.episodeTable}" e ON e."_id" = m."${tables.memberEpisodeColumn}"
    WHERE m."${tables.memberRecordColumn}" = r."_id"
      AND m."deletedAt" IS NULL
      AND e."deletedAt" IS NULL
      AND (e."resolvedAt" IS NULL OR e."resolvedAt" >= ${cutoff}::timestamptz)
  )`,
  ];

  if (data.kind === ResolvedRecordKind.Incident) {
    const keptStatusIds: Array<string> = toIdTexts(
      data.keptPostmortemStatusIds || [],
    );

    if (keptStatusIds.length > 0) {
      const kept: string = params.add(keptStatusIds);
      filters.push(
        `(r."postmortemStatusId" IS NULL OR NOT (r."postmortemStatusId" = ANY(${kept}::uuid[])))`,
      );
    }
  }

  if (data.kind === ResolvedRecordKind.Alert) {
    filters.push(`NOT EXISTS (
    SELECT 1
    FROM "IncidentAlert" l
    JOIN "Incident" i ON i."_id" = l."incidentId"
    WHERE l."alertId" = r."_id"
      AND l."deletedAt" IS NULL
      AND i."deletedAt" IS NULL
  )`);
  }

  const limit: string = params.add(toBatchLimit(data.limit));

  return {
    sql: `SELECT r."_id"::text AS "id"
FROM "${tables.recordTable}" r
WHERE ${filters.join("\n  AND ")}
LIMIT ${limit}`,
    params: params.values,
  };
}

/*
 * One batch of a project's episodes due: resolved before
 * the cut-off, nothing on their state timeline since, with no members left
 * - and, for incident episodes while the project keeps completed
 * postmortems, no postmortem written.
 */
export function buildDueEpisodesStatement(data: {
  kind: ResolvedRecordKind;
  projectId: string;
  resolvedStateIds: Array<ObjectID | string>;
  cutoff: Date;
  keepEpisodesWithPostmortem: boolean;
  limit: number;
}): ResolvedRecordRetentionStatement {
  const tables: RetentionTables = TABLES[data.kind];
  const params: StatementParams = new StatementParams();
  const project: string = params.add(data.projectId);
  const resolved: string = params.add(toIdTexts(data.resolvedStateIds));
  const cutoff: string = params.add(data.cutoff);

  const filters: Array<string> = [
    `e."projectId" = ${project}::uuid`,
    `e."deletedAt" IS NULL`,
    `e."${tables.episodeStateColumn}" = ANY(${resolved}::uuid[])`,
    `e."resolvedAt" IS NOT NULL`,
    `e."resolvedAt" < ${cutoff}::timestamptz`,
    `e."createdAt" < ${cutoff}::timestamptz`,
    `NOT EXISTS (
    SELECT 1
    FROM "${tables.episodeTimelineTable}" t
    WHERE t."${tables.episodeTimelineColumn}" = e."_id"
      AND t."deletedAt" IS NULL
      AND t."startsAt" >= ${cutoff}::timestamptz
  )`,
    `NOT EXISTS (
    SELECT 1
    FROM "${tables.memberTable}" m
    WHERE m."${tables.memberEpisodeColumn}" = e."_id"
      AND m."deletedAt" IS NULL
  )`,
  ];

  if (
    data.kind === ResolvedRecordKind.Incident &&
    data.keepEpisodesWithPostmortem
  ) {
    filters.push(`COALESCE(btrim(e."postmortemNote"), '') = ''`);
  }

  const limit: string = params.add(toBatchLimit(data.limit));

  return {
    sql: `SELECT e."_id"::text AS "id"
FROM "${tables.episodeTable}" e
WHERE ${filters.join("\n  AND ")}
LIMIT ${limit}`,
    params: params.values,
  };
}

// The episodes records are members of: the ones that lose members when they go.
export function buildEpisodesOfRecordsStatement(data: {
  kind: ResolvedRecordKind;
  recordIds: Array<ObjectID | string>;
}): ResolvedRecordRetentionStatement {
  const tables: RetentionTables = TABLES[data.kind];
  const params: StatementParams = new StatementParams();
  const records: string = params.add(toIdTexts(data.recordIds));

  return {
    sql: `SELECT DISTINCT m."${tables.memberEpisodeColumn}"::text AS "episodeId"
FROM "${tables.memberTable}" m
WHERE m."${tables.memberRecordColumn}" = ANY(${records}::uuid[])
  AND m."deletedAt" IS NULL`,
    params: params.values,
  };
}

// The ids a statement answered with, valid ones only.
function readIds(
  rows: Array<Record<string, unknown>>,
  column: string,
): Array<string> {
  const ids: Array<string> = [];

  for (const row of rows) {
    const id: string = String(row[column] || "");

    if (ObjectID.isValidUUID(id)) {
      ids.push(id);
    }
  }

  return ids;
}

// A switch read from a row as a clear "off": false as Postgres or text says it.
function isClearNo(value: unknown): boolean {
  return value === false || value === "false" || value === "f";
}

export default class ResolvedRecordRetention {
  // Seams for tests: the statement runner, the clock and the service calls.
  public static runQuery: ResolvedRecordRetentionQueryRunner = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    return (await ProjectService.getRepository().manager.query(
      sql,
      params,
    )) as Array<Record<string, unknown>>;
  };

  public static now: () => Date = (): Date => {
    return new Date();
  };

  // The project's states that count as resolved, for the kind.
  public static getResolvedStateIds: (data: {
    kind: ResolvedRecordKind;
    projectId: ObjectID;
  }) => Promise<Array<ObjectID>> = async (data: {
    kind: ResolvedRecordKind;
    projectId: ObjectID;
  }): Promise<Array<ObjectID>> => {
    if (data.kind === ResolvedRecordKind.Incident) {
      return await IncidentStateService.getResolvedIncidentStateIds(
        data.projectId,
      );
    }

    return await AlertStateService.getResolvedAlertStateIds(data.projectId);
  };

  // The project's postmortem statuses flagged Completed.
  public static getCompletedPostmortemStatusIds: (
    projectId: ObjectID,
  ) => Promise<Array<ObjectID>> = async (
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> => {
    const statuses: Array<IncidentPostmortemStatus> =
      await IncidentPostmortemStatusService.findBy({
        query: {
          projectId: projectId,
          isCompletedStatus: true,
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    return statuses
      .map((status: IncidentPostmortemStatus): ObjectID | undefined => {
        return status.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });
  };

  /*
   * Deletes records by their ids, held to the states that count as
   * resolved: one reopened since it was read stays. Answers how many went.
   */
  public static deleteRecords: (data: {
    kind: ResolvedRecordKind;
    projectId: ObjectID;
    ids: Array<string>;
    resolvedStateIds: Array<ObjectID>;
  }) => Promise<number> = async (data: {
    kind: ResolvedRecordKind;
    projectId: ObjectID;
    ids: Array<string>;
    resolvedStateIds: Array<ObjectID>;
  }): Promise<number> => {
    if (data.ids.length === 0 || data.resolvedStateIds.length === 0) {
      return 0;
    }

    if (data.kind === ResolvedRecordKind.Incident) {
      return await IncidentService.hardDeleteBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(data.ids),
          currentIncidentStateId: QueryHelper.any(data.resolvedStateIds),
        } as Query<Incident>,
        limit: data.ids.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    return await AlertService.hardDeleteBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(data.ids),
        currentAlertStateId: QueryHelper.any(data.resolvedStateIds),
      } as Query<Alert>,
      limit: data.ids.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  };

  // Deletes episodes by their ids, held to the states that count as resolved.
  public static deleteEpisodes: (data: {
    kind: ResolvedRecordKind;
    projectId: ObjectID;
    ids: Array<string>;
    resolvedStateIds: Array<ObjectID>;
  }) => Promise<number> = async (data: {
    kind: ResolvedRecordKind;
    projectId: ObjectID;
    ids: Array<string>;
    resolvedStateIds: Array<ObjectID>;
  }): Promise<number> => {
    if (data.ids.length === 0 || data.resolvedStateIds.length === 0) {
      return 0;
    }

    if (data.kind === ResolvedRecordKind.Incident) {
      return await IncidentEpisodeService.hardDeleteBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(data.ids),
          currentIncidentStateId: QueryHelper.any(data.resolvedStateIds),
        } as Query<IncidentEpisode>,
        limit: data.ids.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    return await AlertEpisodeService.hardDeleteBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(data.ids),
        currentAlertStateId: QueryHelper.any(data.resolvedStateIds),
      } as Query<AlertEpisode>,
      limit: data.ids.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  };

  /*
   * An episode that lost members and stays: its count - and a title or
   * description written from it - as its members now are.
   */
  public static refreshEpisodeCount: (data: {
    kind: ResolvedRecordKind;
    episodeId: ObjectID;
  }) => Promise<void> = async (data: {
    kind: ResolvedRecordKind;
    episodeId: ObjectID;
  }): Promise<void> => {
    if (data.kind === ResolvedRecordKind.Incident) {
      await IncidentEpisodeService.updateIncidentCount(data.episodeId);
      return;
    }

    await AlertEpisodeService.updateAlertCount(data.episodeId);
  };

  /*
   * Every project that keeps the kind's resolved records for a while, as far
   * as the time budget goes. One project's failure is logged and the rest
   * go on: it is tried again next run.
   */
  public static async run(data: {
    kind: ResolvedRecordKind;
    timeBudgetMs?: number | undefined;
  }): Promise<ResolvedRecordRetentionSummary> {
    const budgetMs: number = data.timeBudgetMs ?? RETENTION_TIME_BUDGET_MS;
    const startedAt: number = this.now().getTime();

    const summary: ResolvedRecordRetentionSummary = {
      projects: 0,
      failedProjects: 0,
      records: 0,
      episodes: 0,
      isCutShort: false,
    };

    const isOutOfTime: () => boolean = (): boolean => {
      return this.now().getTime() - startedAt >= budgetMs;
    };

    let afterProjectId: string | undefined = undefined;
    let isLastPage: boolean = false;

    while (!isLastPage) {
      const page: DueRetentionProjectsPage = await this.findDueProjects({
        kind: data.kind,
        afterProjectId: afterProjectId,
      });

      for (const project of page.projects) {
        if (isOutOfTime()) {
          summary.isCutShort = true;
          return summary;
        }

        summary.projects += 1;

        try {
          const result: ResolvedRecordRetentionResult = await this.purgeProject(
            {
              kind: data.kind,
              projectId: project.projectId,
              retentionInDays: project.retentionInDays,
              keepCompletedPostmortems: project.keepCompletedPostmortems,
              isOutOfTime: isOutOfTime,
            },
          );

          summary.records += result.records;
          summary.episodes += result.episodes;
        } catch (error) {
          summary.failedProjects += 1;
          logger.error(
            `${data.kind} retention: deleting the resolved ${data.kind === ResolvedRecordKind.Incident ? "incidents" : "alerts"} project ${project.projectId} no longer keeps failed. It is tried again next run.`,
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
   * One page of the projects that keep the kind's resolved records for a
   * while, and where the next page starts: after the last project the page
   * read, whether or not it is worked on, or nowhere when the page was not
   * full.
   */
  public static async findDueProjects(data: {
    kind: ResolvedRecordKind;
    afterProjectId?: string | undefined;
  }): Promise<DueRetentionProjectsPage> {
    const statement: ResolvedRecordRetentionStatement =
      buildDueProjectsStatement({
        kind: data.kind,
        afterProjectId: data.afterProjectId,
        limit: RETENTION_PROJECTS_PER_PAGE,
      });

    const rows: Array<Record<string, unknown>> = await this.runQuery(
      statement.sql,
      statement.params,
    );

    const projects: Array<DueRetentionProject> = [];

    for (const row of rows) {
      const projectId: string = String(row["projectId"] || "");
      const retentionInDays: number | undefined =
        readResolvedRecordRetentionInDays(row["retentionInDays"]);

      // Only a project's own setting, one of the choices, deletes anything.
      if (
        !ObjectID.isValidUUID(projectId) ||
        !retentionInDays ||
        retentionInDays < MIN_RESOLVED_RECORD_RETENTION_IN_DAYS
      ) {
        continue;
      }

      projects.push({
        projectId: projectId,
        retentionInDays: retentionInDays,
        /*
         * Incidents: anything but a clear "no" keeps them - a value that
         * cannot be read must never delete a written-up incident. Alerts
         * have no postmortem.
         */
        keepCompletedPostmortems:
          data.kind === ResolvedRecordKind.Incident &&
          !isClearNo(row["keepCompletedPostmortems"]),
      });
    }

    const lastProjectId: string = String(
      rows[rows.length - 1]?.["projectId"] || "",
    );

    return {
      projects: projects,
      nextAfterProjectId:
        rows.length >= RETENTION_PROJECTS_PER_PAGE &&
        ObjectID.isValidUUID(lastProjectId)
          ? lastProjectId
          : undefined,
    };
  }

  /*
   * One project's records due, a batch at a time, then its episodes due -
   * up to MAX_RETENTION_BATCHES_PER_PROJECT batches of each - then the
   * count of every episode that lost members and stays.
   */
  public static async purgeProject(data: {
    kind: ResolvedRecordKind;
    projectId: string;
    retentionInDays: number;
    keepCompletedPostmortems: boolean;
    isOutOfTime?: (() => boolean) | undefined;
  }): Promise<ResolvedRecordRetentionResult> {
    const result: ResolvedRecordRetentionResult = { records: 0, episodes: 0 };

    if (data.retentionInDays < MIN_RESOLVED_RECORD_RETENTION_IN_DAYS) {
      return result;
    }

    const projectId: ObjectID = new ObjectID(data.projectId);

    const resolvedStateIds: Array<ObjectID> = await this.getResolvedStateIds({
      kind: data.kind,
      projectId: projectId,
    });

    // A project with no resolved state has nothing resolved to delete.
    if (resolvedStateIds.length === 0) {
      return result;
    }

    const keptPostmortemStatusIds: Array<ObjectID> =
      data.kind === ResolvedRecordKind.Incident && data.keepCompletedPostmortems
        ? await this.getCompletedPostmortemStatusIds(projectId)
        : [];

    const cutoff: Date = getRetentionCutoff({
      now: this.now(),
      retentionInDays: data.retentionInDays,
    });

    // Episodes that lost members, to count again if they stay.
    const touchedEpisodeIds: Set<string> = new Set<string>();

    for (
      let batch: number = 0;
      batch < MAX_RETENTION_BATCHES_PER_PROJECT;
      batch++
    ) {
      if (batch > 0 && data.isOutOfTime?.()) {
        break;
      }

      const statement: ResolvedRecordRetentionStatement =
        buildDueRecordsStatement({
          kind: data.kind,
          projectId: data.projectId,
          resolvedStateIds: resolvedStateIds,
          cutoff: cutoff,
          keptPostmortemStatusIds: keptPostmortemStatusIds,
          limit: RETENTION_BATCH_SIZE,
        });

      const ids: Array<string> = readIds(
        await this.runQuery(statement.sql, statement.params),
        "id",
      );

      if (ids.length === 0) {
        break;
      }

      const episodesStatement: ResolvedRecordRetentionStatement =
        buildEpisodesOfRecordsStatement({
          kind: data.kind,
          recordIds: ids,
        });

      for (const episodeId of readIds(
        await this.runQuery(episodesStatement.sql, episodesStatement.params),
        "episodeId",
      )) {
        touchedEpisodeIds.add(episodeId);
      }

      const deleted: number = await this.deleteRecords({
        kind: data.kind,
        projectId: projectId,
        ids: ids,
        resolvedStateIds: resolvedStateIds,
      });

      result.records += deleted;

      /*
       * A batch short of full leaves nothing due behind it; one that
       * deleted nothing (every row reopened since it was read) would read
       * the same rows again.
       */
      if (ids.length < RETENTION_BATCH_SIZE || deleted === 0) {
        break;
      }
    }

    const deletedEpisodeIds: Set<string> = new Set<string>();

    for (
      let batch: number = 0;
      batch < MAX_RETENTION_BATCHES_PER_PROJECT;
      batch++
    ) {
      if (data.isOutOfTime?.()) {
        break;
      }

      const statement: ResolvedRecordRetentionStatement =
        buildDueEpisodesStatement({
          kind: data.kind,
          projectId: data.projectId,
          resolvedStateIds: resolvedStateIds,
          cutoff: cutoff,
          keepEpisodesWithPostmortem: data.keepCompletedPostmortems,
          limit: RETENTION_BATCH_SIZE,
        });

      const ids: Array<string> = readIds(
        await this.runQuery(statement.sql, statement.params),
        "id",
      );

      if (ids.length === 0) {
        break;
      }

      const deleted: number = await this.deleteEpisodes({
        kind: data.kind,
        projectId: projectId,
        ids: ids,
        resolvedStateIds: resolvedStateIds,
      });

      result.episodes += deleted;

      for (const id of ids) {
        deletedEpisodeIds.add(id);
      }

      if (ids.length < RETENTION_BATCH_SIZE || deleted === 0) {
        break;
      }
    }

    for (const episodeId of touchedEpisodeIds) {
      if (deletedEpisodeIds.has(episodeId)) {
        continue;
      }

      try {
        await this.refreshEpisodeCount({
          kind: data.kind,
          episodeId: new ObjectID(episodeId),
        });
      } catch (error) {
        // A count left behind is put right by the episode's next change.
        logger.error(
          `${data.kind} retention: counting the members of episode ${episodeId} again failed.`,
        );
        logger.error(error);
      }
    }

    return result;
  }
}
