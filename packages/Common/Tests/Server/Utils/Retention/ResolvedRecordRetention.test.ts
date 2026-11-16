import ResolvedRecordRetention, {
  DueRecordsCount,
  DueRetentionProjectsPage,
  MAX_RETENTION_BATCHES_PER_PROJECT,
  RETENTION_BATCH_SIZE,
  RETENTION_COUNT_TIMEOUT_MS,
  RETENTION_COUNT_UP_TO,
  RETENTION_PROJECTS_PER_PAGE,
  RETENTION_TIME_BUDGET_MS,
  ResolvedRecordRetentionResult,
  ResolvedRecordRetentionStatement,
  ResolvedRecordRetentionSummary,
  buildDueEpisodesStatement,
  buildDueProjectsStatement,
  buildDueRecordsCountStatement,
  buildDueRecordsStatement,
  buildEpisodesOfRecordsStatement,
  buildProjectsReachedByMaximumStatement,
  getRetentionCutoff,
} from "../../../../Server/Utils/Retention/ResolvedRecordRetention";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentPostmortemStatusService from "../../../../Server/Services/IncidentPostmortemStatusService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import IncidentPostmortemStatus from "../../../../Models/DatabaseModels/IncidentPostmortemStatus";
import ObjectID from "../../../../Types/ObjectID";
import {
  MIN_RESOLVED_RECORD_RETENTION_IN_DAYS,
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  ResolvedRecordKind,
  ResolvedRecordRetentionServerLimits,
} from "../../../../Types/Retention/ResolvedRecordRetention";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * DELETING THE RESOLVED INCIDENTS AND ALERTS A PROJECT NO LONGER KEEPS
 * (issue #6903): Server/Utils/Retention/ResolvedRecordRetention, which the
 * Workers jobs Incident:DeleteResolvedIncidents and Alert:DeleteResolvedAlerts
 * run every hour.
 *
 * Here, without a database: the statements it reads with (what they ask
 * for, that nothing a caller gives is written into their text), and how a
 * run walks the projects and their batches - over an in-memory stand-in
 * that answers its statements and its deletes. What the statements select
 * from real rows, and what a delete takes with it, is
 * ResolvedRecordRetentionPostgres.test.ts's, against a migrated Postgres.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-11T12:00:00.000Z");

const KINDS: Array<ResolvedRecordKind> = [
  ResolvedRecordKind.Incident,
  ResolvedRecordKind.Alert,
];

// A valid id, told apart by its number: uuid(7) is ...-000000000007.
function uuid(n: number, prefix: string = "a6903000"): string {
  return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

const PROJECT_ID: string = uuid(1, "b6903000");
const RESOLVED_STATE_IDS: Array<string> = [
  uuid(1, "c6903000"),
  uuid(2, "c6903000"),
];
const COMPLETED_STATUS_ID: string = uuid(1, "d6903000");

// The values a Raw "IN" filter (QueryHelper.any) carries.
function inValues(filter: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (filter as FindOperator<unknown>).objectLiteralParameters || {};

  return Object.values(parameters)[0] as Array<string>;
}

// Whitespace folded, so a statement is read as words.
function words(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("getRetentionCutoff", () => {
  test.each(RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS)(
    "%p days before now, to the millisecond",
    (days: number) => {
      expect(
        getRetentionCutoff({ now: NOW, retentionInDays: days }).getTime(),
      ).toBe(NOW.getTime() - days * DAY_MS);
    },
  );

  test("does not move the clock it is given", () => {
    const now: Date = new Date(NOW.getTime());

    getRetentionCutoff({ now, retentionInDays: 30 });

    expect(now.getTime()).toBe(NOW.getTime());
  });
});

describe("buildDueProjectsStatement: the projects that keep resolved records for a while", () => {
  test("incidents: live projects at the shortest choice or more, in id order, with whether completed postmortems stay", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueProjectsStatement({
        kind: ResolvedRecordKind.Incident,
        limit: 100,
      });

    expect(words(statement.sql)).toBe(
      words(`SELECT p."_id"::text AS "projectId", p."incidentRetentionInDays" AS "retentionInDays", p."keepIncidentsWithCompletedPostmortem" AS "keepCompletedPostmortems", p."keepIncidentsInPostmortemStatusIds" AS "keptPostmortemStatusIds"
FROM "Project" p
WHERE p."deletedAt" IS NULL
  AND p."incidentRetentionInDays" >= $1
ORDER BY p."_id" ASC
LIMIT $2`),
    );
    expect(statement.params).toEqual([
      MIN_RESOLVED_RECORD_RETENTION_IN_DAYS,
      100,
    ]);
  });

  test("alerts: their own setting, and no postmortem to keep", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueProjectsStatement({
        kind: ResolvedRecordKind.Alert,
        limit: 100,
      });

    expect(statement.sql).toContain(`p."alertRetentionInDays" >= $1`);
    expect(statement.sql).toContain(`false AS "keepCompletedPostmortems"`);
    expect(statement.sql).toContain(`NULL::jsonb AS "keptPostmortemStatusIds"`);
    expect(statement.sql).not.toContain("incidentRetentionInDays");
    expect(statement.sql).not.toContain("keepIncidentsWithCompletedPostmortem");
    expect(statement.sql).not.toContain("keepIncidentsInPostmortemStatusIds");
  });

  test("a page after the first starts after the last project read, the id a parameter", () => {
    const after: string = uuid(99, "b6903000");
    const statement: ResolvedRecordRetentionStatement =
      buildDueProjectsStatement({
        kind: ResolvedRecordKind.Incident,
        afterProjectId: after,
        limit: 100,
      });

    expect(statement.sql).toContain(`p."_id" > $2::uuid`);
    expect(statement.sql).toContain("LIMIT $3");
    expect(statement.params).toEqual([30, after, 100]);
    expect(statement.sql).not.toContain(after);
  });

  test("a project at 0 - Never - is never due: the floor is the shortest choice", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueProjectsStatement({
        kind: ResolvedRecordKind.Alert,
        limit: 1,
      });

    expect(statement.params[0]).toBe(30);
    expect(statement.params[0]).toBeGreaterThan(0);
  });

  test.each([
    [0, 1],
    [-5, 1],
    [2.9, 2],
    [100, 100],
  ])("a limit of %p reads %p", (limit: number, expected: number) => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueProjectsStatement({ kind: ResolvedRecordKind.Incident, limit });

    expect(statement.params[statement.params.length - 1]).toBe(expected);
  });
});

describe("buildDueRecordsStatement: one batch of a project's records due", () => {
  const cutoff: Date = new Date(NOW.getTime() - 90 * DAY_MS);

  test("incidents: resolved, opened and last moved before the cut-off, in no episode still kept, without a completed postmortem", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueRecordsStatement({
        kind: ResolvedRecordKind.Incident,
        projectId: PROJECT_ID,
        resolvedStateIds: RESOLVED_STATE_IDS,
        cutoff,
        keptPostmortemStatusIds: [COMPLETED_STATUS_ID],
        limit: RETENTION_BATCH_SIZE,
      });

    expect(words(statement.sql)).toBe(
      words(`SELECT r."_id"::text AS "id"
FROM "Incident" r
WHERE r."projectId" = $1::uuid
  AND r."deletedAt" IS NULL
  AND r."currentIncidentStateId" = ANY($2::uuid[])
  AND r."createdAt" < $3::timestamptz
  AND NOT EXISTS (
    SELECT 1
    FROM "IncidentStateTimeline" t
    WHERE t."incidentId" = r."_id"
      AND t."deletedAt" IS NULL
      AND t."startsAt" >= $3::timestamptz
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "IncidentEpisodeMember" m
    JOIN "IncidentEpisode" e ON e."_id" = m."incidentEpisodeId"
    WHERE m."incidentId" = r."_id"
      AND m."deletedAt" IS NULL
      AND e."deletedAt" IS NULL
      AND (e."resolvedAt" IS NULL OR e."resolvedAt" >= $3::timestamptz)
  )
  AND (r."postmortemStatusId" IS NULL OR NOT (r."postmortemStatusId" = ANY($4::uuid[])))
LIMIT $5`),
    );
    expect(statement.params).toEqual([
      PROJECT_ID,
      RESOLVED_STATE_IDS,
      cutoff,
      [COMPLETED_STATUS_ID],
      RETENTION_BATCH_SIZE,
    ]);
  });

  test("incidents: with no postmortem status kept, a postmortem keeps nothing", () => {
    for (const kept of [undefined, []]) {
      const statement: ResolvedRecordRetentionStatement =
        buildDueRecordsStatement({
          kind: ResolvedRecordKind.Incident,
          projectId: PROJECT_ID,
          resolvedStateIds: RESOLVED_STATE_IDS,
          cutoff,
          keptPostmortemStatusIds: kept,
          limit: 10,
        });

      expect(statement.sql).not.toContain("postmortemStatusId");
      expect(statement.params).toEqual([
        PROJECT_ID,
        RESOLVED_STATE_IDS,
        cutoff,
        10,
      ]);
    }
  });

  test("alerts: their own tables, and an alert linked to a live incident stays", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueRecordsStatement({
        kind: ResolvedRecordKind.Alert,
        projectId: PROJECT_ID,
        resolvedStateIds: RESOLVED_STATE_IDS,
        cutoff,
        // Never asked for alerts; a stray one must change nothing.
        keptPostmortemStatusIds: [COMPLETED_STATUS_ID],
        limit: RETENTION_BATCH_SIZE,
      });

    const sql: string = words(statement.sql);

    expect(sql).toContain(`FROM "Alert" r`);
    expect(sql).toContain(`r."currentAlertStateId" = ANY($2::uuid[])`);
    expect(sql).toContain(
      `FROM "AlertStateTimeline" t WHERE t."alertId" = r."_id"`,
    );
    expect(sql).toContain(
      `FROM "AlertEpisodeMember" m JOIN "AlertEpisode" e ON e."_id" = m."alertEpisodeId" WHERE m."alertId" = r."_id"`,
    );
    expect(sql).toContain(
      `NOT EXISTS ( SELECT 1 FROM "IncidentAlert" l JOIN "Incident" i ON i."_id" = l."incidentId" WHERE l."alertId" = r."_id" AND l."deletedAt" IS NULL AND i."deletedAt" IS NULL )`,
    );
    expect(sql).not.toContain("postmortem");
    expect(sql).not.toContain(`"Incident" r`);
    expect(statement.params).toEqual([
      PROJECT_ID,
      RESOLVED_STATE_IDS,
      cutoff,
      RETENTION_BATCH_SIZE,
    ]);
  });

  test("an id that is not one is left out of the parameters, and nothing given is written into the text", () => {
    const hostile: string = `x'); DELETE FROM "Incident"; --`;
    const statement: ResolvedRecordRetentionStatement =
      buildDueRecordsStatement({
        kind: ResolvedRecordKind.Incident,
        projectId: PROJECT_ID,
        resolvedStateIds: [RESOLVED_STATE_IDS[0]!, hostile],
        cutoff,
        keptPostmortemStatusIds: [hostile, new ObjectID(COMPLETED_STATUS_ID)],
        limit: 5,
      });

    expect(statement.params[1]).toEqual([RESOLVED_STATE_IDS[0]]);
    expect(statement.params[3]).toEqual([COMPLETED_STATUS_ID]);
    expect(statement.sql).not.toContain(hostile);
    expect(statement.sql).not.toContain(PROJECT_ID);
    expect(statement.sql).not.toContain(RESOLVED_STATE_IDS[0]!);
    expect(statement.sql).not.toContain(cutoff.toISOString());
  });

  test("ObjectIDs and texts are read alike", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueRecordsStatement({
        kind: ResolvedRecordKind.Alert,
        projectId: PROJECT_ID,
        resolvedStateIds: RESOLVED_STATE_IDS.map((id: string) => {
          return new ObjectID(id);
        }),
        cutoff,
        limit: 5,
      });

    expect(statement.params[1]).toEqual(RESOLVED_STATE_IDS);
  });
});

describe("buildDueEpisodesStatement: one batch of a project's episodes due", () => {
  const cutoff: Date = new Date(NOW.getTime() - 30 * DAY_MS);

  test("incident episodes: resolved before the cut-off, not moved since, no member left, and no postmortem while those are kept", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueEpisodesStatement({
        kind: ResolvedRecordKind.Incident,
        projectId: PROJECT_ID,
        resolvedStateIds: RESOLVED_STATE_IDS,
        cutoff,
        keepEpisodesWithPostmortem: true,
        limit: RETENTION_BATCH_SIZE,
      });

    expect(words(statement.sql)).toBe(
      words(`SELECT e."_id"::text AS "id"
FROM "IncidentEpisode" e
WHERE e."projectId" = $1::uuid
  AND e."deletedAt" IS NULL
  AND e."currentIncidentStateId" = ANY($2::uuid[])
  AND e."resolvedAt" IS NOT NULL
  AND e."resolvedAt" < $3::timestamptz
  AND e."createdAt" < $3::timestamptz
  AND NOT EXISTS (
    SELECT 1
    FROM "IncidentEpisodeStateTimeline" t
    WHERE t."incidentEpisodeId" = e."_id"
      AND t."deletedAt" IS NULL
      AND t."startsAt" >= $3::timestamptz
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "IncidentEpisodeMember" m
    WHERE m."incidentEpisodeId" = e."_id"
      AND m."deletedAt" IS NULL
  )
  AND COALESCE(btrim(e."postmortemNote"), '') = ''
LIMIT $4`),
    );
    expect(statement.params).toEqual([
      PROJECT_ID,
      RESOLVED_STATE_IDS,
      cutoff,
      RETENTION_BATCH_SIZE,
    ]);
  });

  test("incident episodes: a postmortem keeps nothing once the project stops keeping them", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueEpisodesStatement({
        kind: ResolvedRecordKind.Incident,
        projectId: PROJECT_ID,
        resolvedStateIds: RESOLVED_STATE_IDS,
        cutoff,
        keepEpisodesWithPostmortem: false,
        limit: 3,
      });

    expect(statement.sql).not.toContain("postmortemNote");
  });

  test("alert episodes: their own tables, and no postmortem", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueEpisodesStatement({
        kind: ResolvedRecordKind.Alert,
        projectId: PROJECT_ID,
        resolvedStateIds: RESOLVED_STATE_IDS,
        cutoff,
        keepEpisodesWithPostmortem: true,
        limit: 3,
      });

    const sql: string = words(statement.sql);

    expect(sql).toContain(`FROM "AlertEpisode" e`);
    expect(sql).toContain(`e."currentAlertStateId" = ANY($2::uuid[])`);
    expect(sql).toContain(
      `FROM "AlertEpisodeStateTimeline" t WHERE t."alertEpisodeId" = e."_id"`,
    );
    expect(sql).toContain(
      `FROM "AlertEpisodeMember" m WHERE m."alertEpisodeId" = e."_id"`,
    );
    expect(sql).not.toContain("postmortem");
  });
});

describe("buildEpisodesOfRecordsStatement: the episodes a batch's records are in", () => {
  test.each([
    [
      ResolvedRecordKind.Incident,
      "IncidentEpisodeMember",
      "incidentEpisodeId",
      "incidentId",
    ],
    [
      ResolvedRecordKind.Alert,
      "AlertEpisodeMember",
      "alertEpisodeId",
      "alertId",
    ],
  ])(
    "%s: each episode once, from live memberships",
    (
      kind: ResolvedRecordKind,
      table: string,
      episodeColumn: string,
      recordColumn: string,
    ) => {
      const ids: Array<string> = [uuid(1), uuid(2)];
      const statement: ResolvedRecordRetentionStatement =
        buildEpisodesOfRecordsStatement({
          kind,
          recordIds: [...ids, "not-an-id"],
        });

      expect(words(statement.sql)).toBe(
        words(`SELECT DISTINCT m."${episodeColumn}"::text AS "episodeId"
FROM "${table}" m
WHERE m."${recordColumn}" = ANY($1::uuid[])
  AND m."deletedAt" IS NULL`),
      );
      expect(statement.params).toEqual([ids]);
    },
  );
});

/*
 * AN IN-MEMORY STAND-IN for what a run reads and deletes: the projects that
 * keep resolved records for a while, each project's records and episodes
 * due, and the episodes records are in. It answers the statements the
 * builders write, by what they read, and the deletes as the services would.
 */
interface FakeProjectRow {
  projectId: unknown;
  retentionInDays: unknown;
  keepCompletedPostmortems: unknown;
  keptPostmortemStatusIds?: unknown;
}

class FakeRetentionDatabase {
  public projectRows: Array<FakeProjectRow> = [];
  // A project's records due, in the order a read finds them.
  public dueRecords: Map<string, Array<string>> = new Map();
  public dueEpisodes: Map<string, Array<string>> = new Map();
  // The episodes a record is in.
  public episodesOf: Map<string, Array<string>> = new Map();
  // Records reopened after a read: the delete, held to resolved states, leaves them.
  public reopened: Set<string> = new Set();
  // Episodes a delete leaves for the same reason.
  public reopenedEpisodes: Set<string> = new Set();
  public statements: Array<ResolvedRecordRetentionStatement> = [];
  public deletedRecords: Array<Array<string>> = [];
  public deletedEpisodes: Array<Array<string>> = [];
  public refreshed: Array<string> = [];
  // Projects whose records cannot be read: the read throws.
  public failingProjects: Set<string> = new Set();

  public answer(
    sql: string,
    params: Array<unknown>,
  ): Array<Record<string, unknown>> {
    this.statements.push({ sql, params });
    const limit: number = params[params.length - 1] as number;

    if (sql.includes(`FROM "Project" p`)) {
      // The page starts after the id the statement names, wherever it is.
      const afterParam: RegExpExecArray | null = /p\."_id" > \$(\d+)::uuid/.exec(
        sql,
      );
      const after: string | undefined = afterParam
        ? (params[Number(afterParam[1]) - 1] as string)
        : undefined;

      return this.projectRows
        .filter((row: FakeProjectRow): boolean => {
          return !after || String(row.projectId) > after;
        })
        .sort((a: FakeProjectRow, b: FakeProjectRow): number => {
          return String(a.projectId).localeCompare(String(b.projectId));
        })
        .slice(0, limit) as unknown as Array<Record<string, unknown>>;
    }

    if (sql.includes("SELECT DISTINCT m.")) {
      const episodes: Set<string> = new Set();

      for (const recordId of params[0] as Array<string>) {
        for (const episodeId of this.episodesOf.get(recordId) || []) {
          episodes.add(episodeId);
        }
      }

      return Array.from(episodes).map((episodeId: string) => {
        return { episodeId };
      });
    }

    const projectId: string = params[0] as string;

    if (this.failingProjects.has(projectId)) {
      throw new Error(`could not read project ${projectId}`);
    }

    const due: Array<string> = sql.includes(`SELECT e."_id"`)
      ? this.dueEpisodes.get(projectId) || []
      : this.dueRecords.get(projectId) || [];

    return due.slice(0, limit).map((id: string) => {
      return { id };
    });
  }

  public deleteRecords(projectId: string, ids: Array<string>): number {
    return this.deleteFrom(
      this.dueRecords,
      this.reopened,
      projectId,
      ids,
      this.deletedRecords,
    );
  }

  public deleteEpisodes(projectId: string, ids: Array<string>): number {
    return this.deleteFrom(
      this.dueEpisodes,
      this.reopenedEpisodes,
      projectId,
      ids,
      this.deletedEpisodes,
    );
  }

  public statementsReading(
    fragment: string,
  ): Array<ResolvedRecordRetentionStatement> {
    return this.statements.filter(
      (statement: ResolvedRecordRetentionStatement) => {
        return statement.sql.includes(fragment);
      },
    );
  }

  private deleteFrom(
    store: Map<string, Array<string>>,
    reopened: Set<string>,
    projectId: string,
    ids: Array<string>,
    log: Array<Array<string>>,
  ): number {
    const deleted: Array<string> = ids.filter((id: string) => {
      return !reopened.has(id);
    });

    store.set(
      projectId,
      (store.get(projectId) || []).filter((id: string) => {
        return !deleted.includes(id);
      }),
    );
    log.push(deleted);

    return deleted.length;
  }
}

function ids(count: number, prefix: string, from: number = 1): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return uuid(from + index, prefix);
  });
}

type Seams = Pick<
  typeof ResolvedRecordRetention,
  | "runQuery"
  | "runCountQuery"
  | "now"
  | "getServerLimits"
  | "getResolvedStateIds"
  | "getCompletedPostmortemStatusIds"
  | "deleteRecords"
  | "deleteEpisodes"
  | "refreshEpisodeCount"
>;

const ORIGINAL_SEAMS: Seams = {
  runQuery: ResolvedRecordRetention.runQuery,
  runCountQuery: ResolvedRecordRetention.runCountQuery,
  now: ResolvedRecordRetention.now,
  getServerLimits: ResolvedRecordRetention.getServerLimits,
  getResolvedStateIds: ResolvedRecordRetention.getResolvedStateIds,
  getCompletedPostmortemStatusIds:
    ResolvedRecordRetention.getCompletedPostmortemStatusIds,
  deleteRecords: ResolvedRecordRetention.deleteRecords,
  deleteEpisodes: ResolvedRecordRetention.deleteEpisodes,
  refreshEpisodeCount: ResolvedRecordRetention.refreshEpisodeCount,
};

let database: FakeRetentionDatabase;
let clock: number;
// The server's limits the fakes answer with, and every kind they were read for.
let serverLimits: ResolvedRecordRetentionServerLimits;
let limitReads: Array<ResolvedRecordKind>;
// What a count's statement answers, and every count statement run.
let countAnswer: Array<Record<string, unknown>>;
let countStatements: Array<ResolvedRecordRetentionStatement>;
let statusReads: Array<string>;
let stateReads: Array<{ kind: ResolvedRecordKind; projectId: string }>;
let deleteCalls: Array<{
  kind: ResolvedRecordKind;
  projectId: string;
  ids: Array<string>;
  resolvedStateIds: Array<string>;
}>;
let errorLog: SpyInstance<typeof logger.error>;

function installFakes(): void {
  ResolvedRecordRetention.runQuery = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    return database.answer(sql, params);
  };
  ResolvedRecordRetention.now = (): Date => {
    return new Date(clock);
  };
  ResolvedRecordRetention.getServerLimits = async (
    kind: ResolvedRecordKind,
  ): Promise<ResolvedRecordRetentionServerLimits> => {
    limitReads.push(kind);
    return { ...serverLimits };
  };
  ResolvedRecordRetention.runCountQuery = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    countStatements.push({ sql, params });
    return countAnswer;
  };
  ResolvedRecordRetention.getResolvedStateIds = async (data: {
    kind: ResolvedRecordKind;
    projectId: ObjectID;
  }): Promise<Array<ObjectID>> => {
    stateReads.push({ kind: data.kind, projectId: data.projectId.toString() });
    return RESOLVED_STATE_IDS.map((id: string) => {
      return new ObjectID(id);
    });
  };
  ResolvedRecordRetention.getCompletedPostmortemStatusIds = async (
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> => {
    statusReads.push(projectId.toString());
    return [new ObjectID(COMPLETED_STATUS_ID)];
  };
  ResolvedRecordRetention.deleteRecords = async (data: {
    kind: ResolvedRecordKind;
    projectId: ObjectID;
    ids: Array<string>;
    resolvedStateIds: Array<ObjectID>;
  }): Promise<number> => {
    deleteCalls.push({
      kind: data.kind,
      projectId: data.projectId.toString(),
      ids: data.ids,
      resolvedStateIds: data.resolvedStateIds.map((id: ObjectID) => {
        return id.toString();
      }),
    });
    return database.deleteRecords(data.projectId.toString(), data.ids);
  };
  ResolvedRecordRetention.deleteEpisodes = async (data: {
    kind: ResolvedRecordKind;
    projectId: ObjectID;
    ids: Array<string>;
    resolvedStateIds: Array<ObjectID>;
  }): Promise<number> => {
    return database.deleteEpisodes(data.projectId.toString(), data.ids);
  };
  ResolvedRecordRetention.refreshEpisodeCount = async (data: {
    kind: ResolvedRecordKind;
    episodeId: ObjectID;
  }): Promise<void> => {
    database.refreshed.push(data.episodeId.toString());
  };
}

function restoreSeams(): void {
  Object.assign(ResolvedRecordRetention, ORIGINAL_SEAMS);
}

beforeEach(() => {
  database = new FakeRetentionDatabase();
  clock = NOW.getTime();
  serverLimits = { maximumInDays: undefined, defaultInDays: 0 };
  limitReads = [];
  countAnswer = [{ count: 0 }];
  countStatements = [];
  statusReads = [];
  stateReads = [];
  deleteCalls = [];
  errorLog = jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  installFakes();
});

afterEach(() => {
  restoreSeams();
  jest.restoreAllMocks();
});

async function purge(
  overrides: Partial<{
    kind: ResolvedRecordKind;
    retentionInDays: number;
    keepCompletedPostmortems: boolean;
    isOutOfTime: () => boolean;
  }> = {},
): Promise<ResolvedRecordRetentionResult> {
  return await ResolvedRecordRetention.purgeProject({
    kind: overrides.kind || ResolvedRecordKind.Incident,
    projectId: PROJECT_ID,
    retentionInDays: overrides.retentionInDays ?? 90,
    keepCompletedPostmortems: overrides.keepCompletedPostmortems ?? true,
    isOutOfTime: overrides.isOutOfTime,
  });
}

describe("purgeProject: one project's records, then its episodes", () => {
  test.each(KINDS)(
    "%s: deletes every record due, a batch at a time, until a batch comes up short",
    async (kind: ResolvedRecordKind) => {
      database.dueRecords.set(
        PROJECT_ID,
        ids(RETENTION_BATCH_SIZE * 2 + 37, "e6903000"),
      );

      const result: ResolvedRecordRetentionResult = await purge({ kind });

      expect(result).toEqual({
        records: RETENTION_BATCH_SIZE * 2 + 37,
        episodes: 0,
      });
      expect(
        deleteCalls.map((call: { ids: Array<string> }): number => {
          return call.ids.length;
        }),
      ).toEqual([RETENTION_BATCH_SIZE, RETENTION_BATCH_SIZE, 37]);
      expect(database.dueRecords.get(PROJECT_ID)).toEqual([]);
      for (const call of deleteCalls) {
        expect(call.kind).toBe(kind);
        expect(call.projectId).toBe(PROJECT_ID);
        // Every delete is held to the states that count as resolved.
        expect(call.resolvedStateIds).toEqual(RESOLVED_STATE_IDS);
      }
    },
  );

  test("reads with the cut-off the retention puts before now, and the project's resolved states", async () => {
    database.dueRecords.set(PROJECT_ID, ids(3, "e6903000"));

    await purge({ retentionInDays: 365 });

    const [read] = database.statementsReading(`SELECT r."_id"`);

    expect(read!.params[0]).toBe(PROJECT_ID);
    expect(read!.params[1]).toEqual(RESOLVED_STATE_IDS);
    expect((read!.params[2] as Date).getTime()).toBe(
      NOW.getTime() - 365 * DAY_MS,
    );
    expect(read!.params[read!.params.length - 1]).toBe(RETENTION_BATCH_SIZE);
    expect(stateReads).toEqual([
      { kind: ResolvedRecordKind.Incident, projectId: PROJECT_ID },
    ]);
  });

  test("a full batch is followed by one more read, which finds nothing: the loop ends", async () => {
    database.dueRecords.set(PROJECT_ID, ids(RETENTION_BATCH_SIZE, "e6903000"));

    const result: ResolvedRecordRetentionResult = await purge();

    expect(result.records).toBe(RETENTION_BATCH_SIZE);
    expect(database.statementsReading(`SELECT r."_id"`)).toHaveLength(2);
    expect(deleteCalls).toHaveLength(1);
  });

  test("does at most MAX_RETENTION_BATCHES_PER_PROJECT batches a run: years of incidents drain over several runs", async () => {
    const total: number =
      RETENTION_BATCH_SIZE * (MAX_RETENTION_BATCHES_PER_PROJECT + 3);
    database.dueRecords.set(PROJECT_ID, ids(total, "e6903000"));

    const first: ResolvedRecordRetentionResult = await purge();

    expect(first.records).toBe(
      RETENTION_BATCH_SIZE * MAX_RETENTION_BATCHES_PER_PROJECT,
    );
    expect(database.dueRecords.get(PROJECT_ID)).toHaveLength(
      RETENTION_BATCH_SIZE * 3,
    );

    const second: ResolvedRecordRetentionResult = await purge();

    expect(second.records).toBe(RETENTION_BATCH_SIZE * 3);
    expect(database.dueRecords.get(PROJECT_ID)).toEqual([]);
  });

  test("a batch every record of which was reopened since the read deletes nothing, and is not read again", async () => {
    const due: Array<string> = ids(RETENTION_BATCH_SIZE, "e6903000");
    database.dueRecords.set(PROJECT_ID, due);
    for (const id of due) {
      database.reopened.add(id);
    }

    const result: ResolvedRecordRetentionResult = await purge();

    expect(result.records).toBe(0);
    expect(database.statementsReading(`SELECT r."_id"`)).toHaveLength(1);
  });

  test("a batch some of which was reopened deletes the rest and goes on", async () => {
    const due: Array<string> = ids(RETENTION_BATCH_SIZE + 10, "e6903000");
    database.dueRecords.set(PROJECT_ID, due);
    database.reopened.add(due[0]!);

    const result: ResolvedRecordRetentionResult = await purge();

    // The reopened one is read again with the next batch, and left again.
    expect(result.records).toBe(RETENTION_BATCH_SIZE + 9);
    expect(database.dueRecords.get(PROJECT_ID)).toEqual([due[0]]);
  });

  test("ids that are not ids are never handed to a delete", async () => {
    database.dueRecords.set(PROJECT_ID, [
      uuid(1, "e6903000"),
      "",
      "nope",
      "1 OR 1=1",
    ]);

    await purge();

    expect(
      deleteCalls.map((call: { ids: Array<string> }): Array<string> => {
        return call.ids;
      }),
    ).toEqual([[uuid(1, "e6903000")]]);
  });

  test("stops between batches once the run is out of time, after the first", async () => {
    database.dueRecords.set(
      PROJECT_ID,
      ids(RETENTION_BATCH_SIZE * 5, "e6903000"),
    );
    database.dueEpisodes.set(PROJECT_ID, ids(3, "f6903000"));

    const result: ResolvedRecordRetentionResult = await purge({
      isOutOfTime: () => {
        return true;
      },
    });

    expect(result).toEqual({ records: RETENTION_BATCH_SIZE, episodes: 0 });
    // Episodes wait for a run with time left.
    expect(database.statementsReading(`SELECT e."_id"`)).toHaveLength(0);
  });

  test("with nothing due, reads once and deletes nothing", async () => {
    const result: ResolvedRecordRetentionResult = await purge();

    expect(result).toEqual({ records: 0, episodes: 0 });
    expect(deleteCalls).toEqual([]);
  });

  test.each([0, 7, 14, 29, -30])(
    "a retention of %p - Never, or below the shortest choice - deletes nothing and reads nothing",
    async (days: number) => {
      database.dueRecords.set(PROJECT_ID, ids(5, "e6903000"));

      const result: ResolvedRecordRetentionResult = await purge({
        retentionInDays: days,
      });

      expect(result).toEqual({ records: 0, episodes: 0 });
      expect(database.statements).toEqual([]);
      expect(stateReads).toEqual([]);
    },
  );

  test("a project with no state that counts as resolved has nothing to delete", async () => {
    database.dueRecords.set(PROJECT_ID, ids(5, "e6903000"));
    ResolvedRecordRetention.getResolvedStateIds = async (): Promise<
      Array<ObjectID>
    > => {
      return [];
    };

    const result: ResolvedRecordRetentionResult = await purge();

    expect(result).toEqual({ records: 0, episodes: 0 });
    expect(database.statements).toEqual([]);
  });

  test("incidents, while completed postmortems are kept: the statuses flagged Completed keep their incidents", async () => {
    database.dueRecords.set(PROJECT_ID, ids(2, "e6903000"));

    await purge({ keepCompletedPostmortems: true });

    const [read] = database.statementsReading(`SELECT r."_id"`);

    expect(statusReads).toEqual([PROJECT_ID]);
    expect(read!.sql).toContain(`"postmortemStatusId"`);
    expect(read!.params[3]).toEqual([COMPLETED_STATUS_ID]);
  });

  test("incidents, once the project stops keeping them: no status is read, and a postmortem keeps nothing", async () => {
    database.dueRecords.set(PROJECT_ID, ids(2, "e6903000"));

    await purge({ keepCompletedPostmortems: false });

    const [read] = database.statementsReading(`SELECT r."_id"`);

    expect(statusReads).toEqual([]);
    expect(read!.sql).not.toContain("postmortemStatusId");
  });

  test("alerts never read a postmortem status", async () => {
    database.dueRecords.set(PROJECT_ID, ids(2, "e6903000"));

    await purge({
      kind: ResolvedRecordKind.Alert,
      keepCompletedPostmortems: true,
    });

    expect(statusReads).toEqual([]);
    expect(stateReads).toEqual([
      { kind: ResolvedRecordKind.Alert, projectId: PROJECT_ID },
    ]);
  });

  test("then deletes the episodes due, a batch at a time", async () => {
    database.dueEpisodes.set(
      PROJECT_ID,
      ids(RETENTION_BATCH_SIZE + 4, "f6903000"),
    );

    const result: ResolvedRecordRetentionResult = await purge();

    expect(result).toEqual({ records: 0, episodes: RETENTION_BATCH_SIZE + 4 });
    expect(
      database.deletedEpisodes.map((batch: Array<string>) => {
        return batch.length;
      }),
    ).toEqual([RETENTION_BATCH_SIZE, 4]);

    const [read] = database.statementsReading(`SELECT e."_id"`);

    expect((read!.params[2] as Date).getTime()).toBe(
      NOW.getTime() - 90 * DAY_MS,
    );
    // Incident episodes with a postmortem written stay while postmortems are kept.
    expect(read!.sql).toContain("postmortemNote");
  });

  test("episodes with a postmortem are deleted too once the project stops keeping postmortems", async () => {
    database.dueEpisodes.set(PROJECT_ID, ids(1, "f6903000"));

    await purge({ keepCompletedPostmortems: false });

    const [read] = database.statementsReading(`SELECT e."_id"`);

    expect(read!.sql).not.toContain("postmortemNote");
  });

  test("an episode that lost members and stays is counted again; one deleted is not", async () => {
    const [kept, gone, other] = ids(3, "f6903000");
    const records: Array<string> = ids(3, "e6903000");
    database.dueRecords.set(PROJECT_ID, records);
    database.episodesOf.set(records[0]!, [kept!]);
    database.episodesOf.set(records[1]!, [kept!, gone!]);
    database.episodesOf.set(records[2]!, [other!]);
    // The episode emptied by the delete is then due itself.
    database.dueEpisodes.set(PROJECT_ID, [gone!]);

    const result: ResolvedRecordRetentionResult = await purge();

    expect(result).toEqual({ records: 3, episodes: 1 });
    expect(database.refreshed.sort()).toEqual([kept!, other!].sort());
  });

  test("an episode is counted again once, however many of its members went", async () => {
    const [episode] = ids(1, "f6903000");
    const records: Array<string> = ids(RETENTION_BATCH_SIZE + 5, "e6903000");
    database.dueRecords.set(PROJECT_ID, records);
    for (const record of records) {
      database.episodesOf.set(record, [episode!]);
    }

    await purge();

    expect(database.refreshed).toEqual([episode]);
  });

  test("a count that cannot be written is logged, and the other episodes are still counted", async () => {
    const [first, second] = ids(2, "f6903000");
    const records: Array<string> = ids(2, "e6903000");
    database.dueRecords.set(PROJECT_ID, records);
    database.episodesOf.set(records[0]!, [first!]);
    database.episodesOf.set(records[1]!, [second!]);
    ResolvedRecordRetention.refreshEpisodeCount = async (data: {
      kind: ResolvedRecordKind;
      episodeId: ObjectID;
    }): Promise<void> => {
      if (data.episodeId.toString() === first) {
        throw new Error("episode is locked");
      }

      database.refreshed.push(data.episodeId.toString());
    };

    const result: ResolvedRecordRetentionResult = await purge();

    expect(result.records).toBe(2);
    expect(database.refreshed).toEqual([second]);
    expect(errorLog).toHaveBeenCalledWith(
      `Incident retention: counting the members of episode ${first} again failed.`,
    );
  });

  test("an episode reopened between its read and its delete stays, and is not read again this run", async () => {
    const due: Array<string> = ids(RETENTION_BATCH_SIZE, "f6903000");
    database.dueEpisodes.set(PROJECT_ID, due);
    for (const id of due) {
      database.reopenedEpisodes.add(id);
    }

    const result: ResolvedRecordRetentionResult = await purge();

    expect(result.episodes).toBe(0);
    expect(database.statementsReading(`SELECT e."_id"`)).toHaveLength(1);
  });
});

function projectRow(
  n: number,
  retentionInDays: unknown,
  keepCompletedPostmortems: unknown = true,
): FakeProjectRow {
  return {
    projectId: uuid(n, "b6903000"),
    retentionInDays,
    keepCompletedPostmortems,
  };
}

describe("findDueProjects: a page of the projects that keep resolved records for a while", () => {
  test("reads each project's own setting, and whether completed postmortems stay", async () => {
    database.projectRows = [
      projectRow(1, 90, true),
      projectRow(2, "365", false),
      projectRow(3, 30, "f"),
      projectRow(4, 1095, "false"),
      projectRow(5, 60, null),
      projectRow(6, 180, "t"),
    ];

    const page: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Incident,
      });

    expect(page).toEqual({
      projects: [
        {
          projectId: uuid(1, "b6903000"),
          retentionInDays: 90,
          keepCompletedPostmortems: true,
        },
        {
          projectId: uuid(2, "b6903000"),
          retentionInDays: 365,
          keepCompletedPostmortems: false,
        },
        {
          projectId: uuid(3, "b6903000"),
          retentionInDays: 30,
          keepCompletedPostmortems: false,
        },
        {
          projectId: uuid(4, "b6903000"),
          retentionInDays: 1095,
          keepCompletedPostmortems: false,
        },
        // A value that cannot be read never deletes a written-up incident.
        {
          projectId: uuid(5, "b6903000"),
          retentionInDays: 60,
          keepCompletedPostmortems: true,
        },
        {
          projectId: uuid(6, "b6903000"),
          retentionInDays: 180,
          keepCompletedPostmortems: true,
        },
      ],
      nextAfterProjectId: undefined,
    });
  });

  test("a row whose setting is not a choice, or whose id is not one, deletes nothing", async () => {
    database.projectRows = [
      projectRow(1, 0),
      projectRow(2, 45),
      projectRow(3, 7),
      projectRow(4, "soon"),
      projectRow(5, null),
      {
        projectId: "not-an-id",
        retentionInDays: 90,
        keepCompletedPostmortems: true,
      },
      projectRow(6, 90),
    ];

    const page: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Alert,
      });

    expect(page.projects).toEqual([
      {
        projectId: uuid(6, "b6903000"),
        retentionInDays: 90,
        keepCompletedPostmortems: false,
      },
    ]);
  });

  test("alerts keep nothing for a postmortem", async () => {
    database.projectRows = [projectRow(1, 90, false)];

    const page: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Alert,
      });

    expect(page.projects[0]!.keepCompletedPostmortems).toBe(false);
  });

  test("a full page says where the next starts: after its last row, worked on or not", async () => {
    database.projectRows = Array.from(
      { length: RETENTION_PROJECTS_PER_PAGE + 1 },
      (_v: unknown, index: number): FakeProjectRow => {
        // The last row of the first page has a setting that deletes nothing.
        return projectRow(
          index + 1,
          index === RETENTION_PROJECTS_PER_PAGE - 1 ? 45 : 90,
        );
      },
    );

    const first: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Incident,
      });

    expect(first.projects).toHaveLength(RETENTION_PROJECTS_PER_PAGE - 1);
    expect(first.nextAfterProjectId).toBe(
      uuid(RETENTION_PROJECTS_PER_PAGE, "b6903000"),
    );

    const second: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Incident,
        afterProjectId: first.nextAfterProjectId,
      });

    expect(second).toEqual({
      projects: [
        {
          projectId: uuid(RETENTION_PROJECTS_PER_PAGE + 1, "b6903000"),
          retentionInDays: 90,
          keepCompletedPostmortems: true,
        },
      ],
      nextAfterProjectId: undefined,
    });
  });
});

describe("run: every project, as far as the time budget goes", () => {
  test("works on each project that keeps resolved records for a while, and adds up what went", async () => {
    database.projectRows = [
      projectRow(1, 90),
      projectRow(2, 30),
      projectRow(3, 365),
    ];
    database.dueRecords.set(uuid(1, "b6903000"), ids(3, "e6903000"));
    database.dueRecords.set(
      uuid(3, "b6903000"),
      ids(RETENTION_BATCH_SIZE + 1, "e6903001"),
    );
    database.dueEpisodes.set(uuid(2, "b6903000"), ids(2, "f6903000"));

    const summary: ResolvedRecordRetentionSummary =
      await ResolvedRecordRetention.run({
        kind: ResolvedRecordKind.Incident,
      });

    expect(summary).toEqual({
      projects: 3,
      failedProjects: 0,
      records: 3 + RETENTION_BATCH_SIZE + 1,
      episodes: 2,
      isCutShort: false,
    });
    expect(
      stateReads.map((read: { projectId: string }): string => {
        return read.projectId;
      }),
    ).toEqual([uuid(1, "b6903000"), uuid(2, "b6903000"), uuid(3, "b6903000")]);
  });

  test("each project with its own retention", async () => {
    database.projectRows = [projectRow(1, 30), projectRow(2, 1095)];
    database.dueRecords.set(uuid(1, "b6903000"), ids(1, "e6903000"));
    database.dueRecords.set(uuid(2, "b6903000"), ids(1, "e6903001"));

    await ResolvedRecordRetention.run({ kind: ResolvedRecordKind.Alert });

    const cutoffs: Array<number> = database
      .statementsReading(`SELECT r."_id"`)
      .map((statement: ResolvedRecordRetentionStatement) => {
        return (statement.params[2] as Date).getTime();
      });

    expect(cutoffs).toEqual([
      NOW.getTime() - 30 * DAY_MS,
      NOW.getTime() - 1095 * DAY_MS,
    ]);
  });

  test("reads every page of projects", async () => {
    database.projectRows = Array.from(
      { length: RETENTION_PROJECTS_PER_PAGE * 2 + 5 },
      (_v: unknown, index: number): FakeProjectRow => {
        return projectRow(index + 1, 90);
      },
    );

    const summary: ResolvedRecordRetentionSummary =
      await ResolvedRecordRetention.run({
        kind: ResolvedRecordKind.Incident,
      });

    expect(summary.projects).toBe(RETENTION_PROJECTS_PER_PAGE * 2 + 5);
    expect(database.statementsReading(`FROM "Project" p`)).toHaveLength(3);
  });

  test("one project's failure is logged, counted and tried again next run; the rest go on", async () => {
    database.projectRows = [
      projectRow(1, 90),
      projectRow(2, 90),
      projectRow(3, 90),
    ];
    database.failingProjects.add(uuid(2, "b6903000"));
    database.dueRecords.set(uuid(3, "b6903000"), ids(4, "e6903000"));

    const summary: ResolvedRecordRetentionSummary =
      await ResolvedRecordRetention.run({
        kind: ResolvedRecordKind.Alert,
      });

    expect(summary).toEqual({
      projects: 3,
      failedProjects: 1,
      records: 4,
      episodes: 0,
      isCutShort: false,
    });
    expect(errorLog).toHaveBeenCalledWith(
      `Alert retention: deleting the resolved alerts project ${uuid(2, "b6903000")} no longer keeps failed. It is tried again next run.`,
    );
  });

  test("stops starting projects once the time budget is spent, and says it was cut short", async () => {
    database.projectRows = [
      projectRow(1, 90),
      projectRow(2, 90),
      projectRow(3, 90),
    ];
    database.dueRecords.set(uuid(1, "b6903000"), ids(1, "e6903000"));
    database.dueRecords.set(uuid(2, "b6903000"), ids(1, "e6903001"));

    // Each project's work takes a minute.
    const resolvedStates: typeof ResolvedRecordRetention.getResolvedStateIds =
      ResolvedRecordRetention.getResolvedStateIds;
    ResolvedRecordRetention.getResolvedStateIds = async (data: {
      kind: ResolvedRecordKind;
      projectId: ObjectID;
    }): Promise<Array<ObjectID>> => {
      clock += 60 * 1000;
      return await resolvedStates(data);
    };

    const summary: ResolvedRecordRetentionSummary =
      await ResolvedRecordRetention.run({
        kind: ResolvedRecordKind.Incident,
        timeBudgetMs: 90 * 1000,
      });

    expect(summary).toEqual({
      projects: 2,
      failedProjects: 0,
      records: 2,
      episodes: 0,
      isCutShort: true,
    });
  });

  test("its time budget is ten minutes unless told otherwise", () => {
    expect(RETENTION_TIME_BUDGET_MS).toBe(10 * 60 * 1000);
  });

  test("with no project keeping resolved records for a while, does nothing", async () => {
    const summary: ResolvedRecordRetentionSummary =
      await ResolvedRecordRetention.run({
        kind: ResolvedRecordKind.Incident,
      });

    expect(summary).toEqual({
      projects: 0,
      failedProjects: 0,
      records: 0,
      episodes: 0,
      isCutShort: false,
    });
    expect(database.statements).toHaveLength(1);
  });
});

describe("the seams' own work: the services they call", () => {
  beforeEach(() => {
    restoreSeams();
  });

  const projectId: ObjectID = new ObjectID(PROJECT_ID);
  const resolved: Array<ObjectID> = RESOLVED_STATE_IDS.map((id: string) => {
    return new ObjectID(id);
  });

  test.each([
    [ResolvedRecordKind.Incident, "currentIncidentStateId"],
    [ResolvedRecordKind.Alert, "currentAlertStateId"],
  ])(
    "%s: deleteRecords hard-deletes by project, id and resolved state, as root, and says how many went",
    async (kind: ResolvedRecordKind, stateColumn: string) => {
      const service: typeof IncidentService | typeof AlertService =
        kind === ResolvedRecordKind.Incident ? IncidentService : AlertService;
      const hardDelete: SpyInstance<typeof IncidentService.hardDeleteBy> = jest
        .spyOn(service as typeof IncidentService, "hardDeleteBy")
        .mockResolvedValue(2 as never);
      const recordIds: Array<string> = ids(2, "e6903000");

      const deleted: number = await ResolvedRecordRetention.deleteRecords({
        kind,
        projectId,
        ids: recordIds,
        resolvedStateIds: resolved,
      });

      expect(deleted).toBe(2);
      expect(hardDelete).toHaveBeenCalledTimes(1);

      const call: Record<string, unknown> = hardDelete.mock
        .calls[0]![0] as unknown as Record<string, unknown>;
      const query: Record<string, unknown> = call["query"] as Record<
        string,
        unknown
      >;

      expect(query["projectId"]).toBe(projectId);
      expect(inValues(query["_id"])).toEqual(recordIds);
      expect(inValues(query[stateColumn])).toEqual(RESOLVED_STATE_IDS);
      expect(Object.keys(query).sort()).toEqual(
        ["_id", "projectId", stateColumn].sort(),
      );
      expect(call["limit"]).toBe(2);
      expect(call["skip"]).toBe(0);
      expect(call["props"]).toEqual({ isRoot: true });
    },
  );

  test.each([
    [ResolvedRecordKind.Incident, "currentIncidentStateId"],
    [ResolvedRecordKind.Alert, "currentAlertStateId"],
  ])(
    "%s: deleteEpisodes hard-deletes by project, id and resolved state, as root",
    async (kind: ResolvedRecordKind, stateColumn: string) => {
      const service:
        | typeof IncidentEpisodeService
        | typeof AlertEpisodeService =
        kind === ResolvedRecordKind.Incident
          ? IncidentEpisodeService
          : AlertEpisodeService;
      const hardDelete: SpyInstance<
        typeof IncidentEpisodeService.hardDeleteBy
      > = jest
        .spyOn(service as typeof IncidentEpisodeService, "hardDeleteBy")
        .mockResolvedValue(1 as never);
      const episodeIds: Array<string> = ids(1, "f6903000");

      expect(
        await ResolvedRecordRetention.deleteEpisodes({
          kind,
          projectId,
          ids: episodeIds,
          resolvedStateIds: resolved,
        }),
      ).toBe(1);

      const call: Record<string, unknown> = hardDelete.mock
        .calls[0]![0] as unknown as Record<string, unknown>;
      const query: Record<string, unknown> = call["query"] as Record<
        string,
        unknown
      >;

      expect(query["projectId"]).toBe(projectId);
      expect(inValues(query["_id"])).toEqual(episodeIds);
      expect(inValues(query[stateColumn])).toEqual(RESOLVED_STATE_IDS);
      expect(call["props"]).toEqual({ isRoot: true });
    },
  );

  test("a delete with no ids, or no resolved state, deletes nothing and calls nothing", async () => {
    const spies: Array<SpyInstance<typeof IncidentService.hardDeleteBy>> = [
      jest.spyOn(IncidentService, "hardDeleteBy"),
      jest.spyOn(
        AlertService as unknown as typeof IncidentService,
        "hardDeleteBy",
      ),
      jest.spyOn(
        IncidentEpisodeService as unknown as typeof IncidentService,
        "hardDeleteBy",
      ),
      jest.spyOn(
        AlertEpisodeService as unknown as typeof IncidentService,
        "hardDeleteBy",
      ),
    ];

    for (const kind of KINDS) {
      for (const data of [
        { ids: [], resolvedStateIds: resolved },
        { ids: ids(1, "e6903000"), resolvedStateIds: [] },
      ]) {
        expect(
          await ResolvedRecordRetention.deleteRecords({
            kind,
            projectId,
            ...data,
          }),
        ).toBe(0);
        expect(
          await ResolvedRecordRetention.deleteEpisodes({
            kind,
            projectId,
            ...data,
          }),
        ).toBe(0);
      }
    }

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  test("the resolved states are the kind's own", async () => {
    const incidentStates: SpyInstance<
      typeof IncidentStateService.getResolvedIncidentStateIds
    > = jest
      .spyOn(IncidentStateService, "getResolvedIncidentStateIds")
      .mockResolvedValue([resolved[0]!] as never);
    const alertStates: SpyInstance<
      typeof AlertStateService.getResolvedAlertStateIds
    > = jest
      .spyOn(AlertStateService, "getResolvedAlertStateIds")
      .mockResolvedValue([resolved[1]!] as never);

    expect(
      await ResolvedRecordRetention.getResolvedStateIds({
        kind: ResolvedRecordKind.Incident,
        projectId,
      }),
    ).toEqual([resolved[0]]);
    expect(
      await ResolvedRecordRetention.getResolvedStateIds({
        kind: ResolvedRecordKind.Alert,
        projectId,
      }),
    ).toEqual([resolved[1]]);
    expect(incidentStates).toHaveBeenCalledWith(projectId);
    expect(alertStates).toHaveBeenCalledWith(projectId);
  });

  test("the postmortem statuses that keep an incident are the project's flagged Completed", async () => {
    const completed: IncidentPostmortemStatus = new IncidentPostmortemStatus();
    completed.id = new ObjectID(COMPLETED_STATUS_ID);
    const find: SpyInstance<typeof IncidentPostmortemStatusService.findBy> =
      jest
        .spyOn(IncidentPostmortemStatusService, "findBy")
        .mockResolvedValue([
          completed,
          new IncidentPostmortemStatus(),
        ] as never);

    const statusIds: Array<ObjectID> =
      await ResolvedRecordRetention.getCompletedPostmortemStatusIds(projectId);

    expect(
      statusIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([COMPLETED_STATUS_ID]);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId, isCompletedStatus: true },
        select: { _id: true },
        props: { isRoot: true },
      }),
    );
  });

  test("an episode is counted again by its own service", async () => {
    const incidentCount: SpyInstance<
      typeof IncidentEpisodeService.updateIncidentCount
    > = jest
      .spyOn(IncidentEpisodeService, "updateIncidentCount")
      .mockResolvedValue(undefined as never);
    const alertCount: SpyInstance<typeof AlertEpisodeService.updateAlertCount> =
      jest
        .spyOn(AlertEpisodeService, "updateAlertCount")
        .mockResolvedValue(undefined as never);
    const episodeId: ObjectID = new ObjectID(uuid(1, "f6903000"));

    await ResolvedRecordRetention.refreshEpisodeCount({
      kind: ResolvedRecordKind.Incident,
      episodeId,
    });
    await ResolvedRecordRetention.refreshEpisodeCount({
      kind: ResolvedRecordKind.Alert,
      episodeId,
    });

    expect(incidentCount).toHaveBeenCalledWith(episodeId);
    expect(alertCount).toHaveBeenCalledWith(episodeId);
  });

  test("statements run on the database's own connection, with their parameters", async () => {
    const query: Mock<() => Promise<Array<{ id: string }>>> = jest.fn(
      async () => {
        return [{ id: uuid(1) }];
      },
    );
    jest.spyOn(ProjectService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);

    const rows: Array<Record<string, unknown>> =
      await ResolvedRecordRetention.runQuery("SELECT $1", [1]);

    expect(rows).toEqual([{ id: uuid(1) }]);
    expect(query).toHaveBeenCalledWith("SELECT $1", [1]);
  });

  test("the clock is the real one", () => {
    const before: number = Date.now();
    const now: number = ResolvedRecordRetention.now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

/*
 * THE SERVER'S MAXIMUM (issue #6941): with one, every live project keeps
 * resolved records at most that long - one set to Never, or to longer,
 * included - and a project's own setting is never rewritten: the maximum is
 * applied as the projects are read.
 */
describe("buildDueProjectsStatement under the server's maximum", () => {
  test("reads every live project, Never included: the floor is dropped, the setting is read as it is", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildDueProjectsStatement({
        kind: ResolvedRecordKind.Incident,
        limit: 100,
        maximumInDays: 365,
      });

    expect(words(statement.sql)).toBe(
      words(`SELECT p."_id"::text AS "projectId", p."incidentRetentionInDays" AS "retentionInDays", p."keepIncidentsWithCompletedPostmortem" AS "keepCompletedPostmortems", p."keepIncidentsInPostmortemStatusIds" AS "keptPostmortemStatusIds"
FROM "Project" p
WHERE p."deletedAt" IS NULL
ORDER BY p."_id" ASC
LIMIT $1`),
    );
    expect(statement.params).toEqual([100]);
  });

  test("a later page starts after the last project read, the id a parameter", () => {
    const after: string = uuid(7, "b6903000");
    const statement: ResolvedRecordRetentionStatement =
      buildDueProjectsStatement({
        kind: ResolvedRecordKind.Alert,
        limit: 100,
        afterProjectId: after,
        maximumInDays: 90,
      });

    expect(statement.sql).toContain(`p."_id" > $1::uuid`);
    expect(statement.sql).toContain("LIMIT $2");
    expect(statement.params).toEqual([after, 100]);
    expect(statement.sql).not.toContain(after);
    expect(statement.sql).not.toContain(">= $");
  });
});

describe("findDueProjects under the server's maximum", () => {
  test("Never and longer lengths are held to the maximum, shorter ones keep their own", async () => {
    database.projectRows = [
      projectRow(1, 0),
      projectRow(2, 1095),
      projectRow(3, 365),
      projectRow(4, 90),
      projectRow(5, "730"),
    ];

    const page: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Alert,
        maximumInDays: 365,
      });

    expect(
      page.projects.map((project: { retentionInDays: number }) => {
        return project.retentionInDays;
      }),
    ).toEqual([365, 365, 365, 90, 365]);
  });

  test("a setting that cannot be read deletes nothing, even under the maximum", async () => {
    database.projectRows = [
      projectRow(1, 45),
      projectRow(2, null),
      projectRow(3, "soon"),
      projectRow(4, 30),
    ];

    const page: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Incident,
        maximumInDays: 365,
      });

    expect(page.projects).toEqual([
      {
        projectId: uuid(4, "b6903000"),
        retentionInDays: 30,
        keepCompletedPostmortems: true,
        keptPostmortemStatusIds: undefined,
      },
    ]);
  });

  test("with no maximum, a project at Never is still left alone", async () => {
    database.projectRows = [projectRow(1, 0), projectRow(2, 60)];

    const page: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Incident,
      });

    expect(
      page.projects.map((project: { projectId: string }) => {
        return project.projectId;
      }),
    ).toEqual([uuid(2, "b6903000")]);
  });

  test("a full page under the maximum says where the next one starts", async () => {
    database.projectRows = Array.from(
      { length: RETENTION_PROJECTS_PER_PAGE + 1 },
      (_: unknown, index: number): FakeProjectRow => {
        return projectRow(index + 1, 0);
      },
    );

    const first: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Alert,
        maximumInDays: 30,
      });

    expect(first.projects).toHaveLength(RETENTION_PROJECTS_PER_PAGE);
    expect(first.nextAfterProjectId).toBe(
      uuid(RETENTION_PROJECTS_PER_PAGE, "b6903000"),
    );

    const second: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Alert,
        afterProjectId: first.nextAfterProjectId,
        maximumInDays: 30,
      });

    expect(second.projects).toEqual([
      {
        projectId: uuid(RETENTION_PROJECTS_PER_PAGE + 1, "b6903000"),
        retentionInDays: 30,
        keepCompletedPostmortems: false,
        keptPostmortemStatusIds: undefined,
      },
    ]);
    expect(second.nextAfterProjectId).toBeUndefined();
  });
});

describe("run under the server's maximum", () => {
  test("reads the maximum once a run, and works on every project held to it", async () => {
    serverLimits = { maximumInDays: 180, defaultInDays: 0 };
    database.projectRows = [projectRow(1, 0), projectRow(2, 30)];
    database.dueRecords.set(uuid(1, "b6903000"), ids(2, "e6903000"));

    const summary: ResolvedRecordRetentionSummary =
      await ResolvedRecordRetention.run({ kind: ResolvedRecordKind.Alert });

    expect(limitReads).toEqual([ResolvedRecordKind.Alert]);
    expect(summary.projects).toBe(2);
    expect(summary.records).toBe(2);

    // The project at Never was read for records resolved before the maximum's cut-off.
    const cutoffs: Array<number> = database
      .statementsReading(`SELECT r."_id"`)
      .map((statement: ResolvedRecordRetentionStatement): number => {
        return (statement.params[2] as Date).getTime();
      });

    expect(cutoffs).toContain(NOW.getTime() - 180 * DAY_MS);
    expect(cutoffs).toContain(NOW.getTime() - 30 * DAY_MS);
  });

  test("with no maximum, nothing changes: a project at Never is not read", async () => {
    database.projectRows = [projectRow(1, 0)];

    const summary: ResolvedRecordRetentionSummary =
      await ResolvedRecordRetention.run({ kind: ResolvedRecordKind.Incident });

    expect(limitReads).toEqual([ResolvedRecordKind.Incident]);
    expect(summary.projects).toBe(0);
    expect(stateReads).toEqual([]);
  });
});

/*
 * WHICH POSTMORTEM STATUSES KEEP AN INCIDENT (issue #6945): the ones the
 * project chose, or with none chosen its Completed status, while it keeps
 * completed postmortems at all.
 */
describe("the postmortem statuses a project chose", () => {
  const CHOSEN: Array<string> = [uuid(7, "d6945000"), uuid(8, "d6945000")];

  test("findDueProjects reads them for incidents, as the purge reads the project's", async () => {
    database.projectRows = [
      { ...projectRow(1, 90), keptPostmortemStatusIds: CHOSEN },
      { ...projectRow(2, 90), keptPostmortemStatusIds: [] },
      { ...projectRow(3, 90), keptPostmortemStatusIds: null },
    ];

    const page: DueRetentionProjectsPage =
      await ResolvedRecordRetention.findDueProjects({
        kind: ResolvedRecordKind.Incident,
      });

    expect(
      page.projects.map(
        (project: { keptPostmortemStatusIds?: Array<string> | undefined }) => {
          return project.keptPostmortemStatusIds;
        },
      ),
    ).toEqual([CHOSEN, undefined, undefined]);
  });

  test("purgeProject keeps incidents in the chosen statuses, and does not read the Completed one", async () => {
    await ResolvedRecordRetention.purgeProject({
      kind: ResolvedRecordKind.Incident,
      projectId: PROJECT_ID,
      retentionInDays: 90,
      keepCompletedPostmortems: true,
      keptPostmortemStatusIds: CHOSEN,
    });

    const read: ResolvedRecordRetentionStatement =
      database.statementsReading(`SELECT r."_id"`)[0]!;

    expect(read.params[3]).toEqual(CHOSEN);
    expect(read.sql).toContain(
      `(r."postmortemStatusId" IS NULL OR NOT (r."postmortemStatusId" = ANY($4::uuid[])))`,
    );
    expect(statusReads).toEqual([]);
  });

  test("with none chosen, the Completed status keeps them, as before", async () => {
    await ResolvedRecordRetention.purgeProject({
      kind: ResolvedRecordKind.Incident,
      projectId: PROJECT_ID,
      retentionInDays: 90,
      keepCompletedPostmortems: true,
    });

    const read: ResolvedRecordRetentionStatement =
      database.statementsReading(`SELECT r."_id"`)[0]!;

    expect(read.params[3]).toEqual([COMPLETED_STATUS_ID]);
    expect(statusReads).toEqual([PROJECT_ID]);
  });

  test("once the project stops keeping completed postmortems, the chosen statuses keep nothing", async () => {
    await ResolvedRecordRetention.purgeProject({
      kind: ResolvedRecordKind.Incident,
      projectId: PROJECT_ID,
      retentionInDays: 90,
      keepCompletedPostmortems: false,
      keptPostmortemStatusIds: CHOSEN,
    });

    const read: ResolvedRecordRetentionStatement =
      database.statementsReading(`SELECT r."_id"`)[0]!;

    expect(read.sql).not.toContain("postmortemStatusId");
    expect(read.params).toHaveLength(4);
  });

  test("run hands each project's chosen statuses to its purge", async () => {
    database.projectRows = [
      { ...projectRow(1, 90), keptPostmortemStatusIds: CHOSEN },
    ];
    database.dueRecords.set(uuid(1, "b6903000"), ids(1, "e6903000"));

    await ResolvedRecordRetention.run({ kind: ResolvedRecordKind.Incident });

    expect(database.statementsReading(`SELECT r."_id"`)[0]!.params[3]).toEqual(
      CHOSEN,
    );
  });

  test.each([
    [ResolvedRecordKind.Alert, true, CHOSEN, []],
    [ResolvedRecordKind.Incident, false, CHOSEN, []],
    [ResolvedRecordKind.Incident, true, CHOSEN, CHOSEN],
    [ResolvedRecordKind.Incident, true, [], [COMPLETED_STATUS_ID]],
    [ResolvedRecordKind.Incident, true, undefined, [COMPLETED_STATUS_ID]],
  ])(
    "getKeptPostmortemStatusIds(%s, keep %p, chosen %p) is %p",
    async (
      kind: ResolvedRecordKind,
      keep: boolean,
      chosen: Array<string> | undefined,
      expected: Array<string>,
    ) => {
      const kept: Array<ObjectID | string> =
        await ResolvedRecordRetention.getKeptPostmortemStatusIds({
          kind,
          projectId: new ObjectID(PROJECT_ID),
          keepCompletedPostmortems: keep,
          chosenStatusIds: chosen,
        });

      expect(
        kept.map((id: ObjectID | string): string => {
          return id.toString();
        }),
      ).toEqual(expected);
    },
  );
});

/*
 * HOW MANY A SETTING DELETES NOW (issue #6943): the purge's own filters,
 * counted no further than RETENTION_COUNT_UP_TO.
 */
describe("buildDueRecordsCountStatement: one builder with the purge", () => {
  test.each(KINDS)(
    "%s: the same filters and parameters as a batch's read, counted up to a bound",
    (kind: ResolvedRecordKind) => {
      const query: Parameters<typeof buildDueRecordsStatement>[0] = {
        kind,
        projectId: PROJECT_ID,
        resolvedStateIds: RESOLVED_STATE_IDS,
        cutoff: new Date(NOW.getTime() - 90 * DAY_MS),
        keptPostmortemStatusIds: [COMPLETED_STATUS_ID],
        limit: RETENTION_BATCH_SIZE,
      };

      const batch: ResolvedRecordRetentionStatement =
        buildDueRecordsStatement(query);
      const count: ResolvedRecordRetentionStatement =
        buildDueRecordsCountStatement({ ...query, upTo: 10000 });

      const whereOf: (sql: string) => string = (sql: string): string => {
        const folded: string = words(sql);
        return folded.slice(
          folded.indexOf("WHERE "),
          folded.lastIndexOf(" LIMIT "),
        );
      };

      expect(whereOf(count.sql)).toBe(whereOf(batch.sql));
      expect(count.params.slice(0, -1)).toEqual(batch.params.slice(0, -1));
      expect(count.params[count.params.length - 1]).toBe(10000);
      expect(words(count.sql)).toMatch(
        /^SELECT COUNT\(\*\)::int AS "count" FROM \( SELECT 1 FROM "(Incident|Alert)" r WHERE .* LIMIT \$\d+ \) due$/,
      );
    },
  );

  test("the bound is a parameter, never written into the text", () => {
    const count: ResolvedRecordRetentionStatement =
      buildDueRecordsCountStatement({
        kind: ResolvedRecordKind.Alert,
        projectId: PROJECT_ID,
        resolvedStateIds: RESOLVED_STATE_IDS,
        cutoff: NOW,
        upTo: 12345,
      });

    expect(count.sql).not.toContain("12345");
    expect(count.params).toContain(12345);
  });
});

describe("countDueRecords: what a setting deletes now", () => {
  async function count(
    overrides: Partial<
      Parameters<typeof ResolvedRecordRetention.countDueRecords>[0]
    > = {},
  ): Promise<DueRecordsCount> {
    return await ResolvedRecordRetention.countDueRecords({
      kind: ResolvedRecordKind.Incident,
      projectId: new ObjectID(PROJECT_ID),
      retentionInDays: 90,
      keepCompletedPostmortems: true,
      ...overrides,
    });
  }

  test("counts with the purge's statement, for the length's cut-off and the project's resolved states", async () => {
    countAnswer = [{ count: 4512 }];

    expect(await count()).toEqual({ count: 4512, isAtLeast: false });
    expect(countStatements).toHaveLength(1);

    const statement: ResolvedRecordRetentionStatement = countStatements[0]!;

    expect(statement.params[0]).toBe(PROJECT_ID);
    expect(statement.params[1]).toEqual(RESOLVED_STATE_IDS);
    expect((statement.params[2] as Date).getTime()).toBe(
      NOW.getTime() - 90 * DAY_MS,
    );
    expect(statement.params[3]).toEqual([COMPLETED_STATUS_ID]);
    expect(statement.params[4]).toBe(RETENTION_COUNT_UP_TO);
    // Through the count's own runner, with its timeout - never the purge's.
    expect(database.statements).toEqual([]);
  });

  test("a count that reaches the bound says at least that many", async () => {
    countAnswer = [{ count: RETENTION_COUNT_UP_TO }];

    expect(await count()).toEqual({
      count: RETENTION_COUNT_UP_TO,
      isAtLeast: true,
    });
  });

  test("Never with no maximum deletes nothing, and reads nothing", async () => {
    expect(await count({ retentionInDays: 0 })).toEqual({
      count: 0,
      isAtLeast: false,
    });
    expect(countStatements).toEqual([]);
    expect(stateReads).toEqual([]);
  });

  test("under the server's maximum, Never and longer lengths are counted for the maximum", async () => {
    await count({ retentionInDays: 0, maximumInDays: 365 });
    await count({ retentionInDays: 1095, maximumInDays: 365 });
    await count({ retentionInDays: 60, maximumInDays: 365 });

    expect(
      countStatements.map((statement: ResolvedRecordRetentionStatement) => {
        return (
          (NOW.getTime() - (statement.params[2] as Date).getTime()) / DAY_MS
        );
      }),
    ).toEqual([365, 365, 60]);
  });

  test("counts with the statuses the setting would keep: chosen ones, Completed, or none", async () => {
    const chosen: Array<string> = [uuid(9, "d6945000")];

    await count({ keptPostmortemStatusIds: chosen });
    await count({ keepCompletedPostmortems: false });
    await count({
      kind: ResolvedRecordKind.Alert,
      keptPostmortemStatusIds: chosen,
    });

    expect(countStatements[0]!.params[3]).toEqual(chosen);
    expect(countStatements[1]!.sql).not.toContain("postmortemStatusId");
    expect(countStatements[2]!.sql).not.toContain("postmortemStatusId");
    expect(countStatements[2]!.sql).toContain(`FROM "Alert" r`);
  });

  test("a project with no resolved state has nothing to count", async () => {
    ResolvedRecordRetention.getResolvedStateIds = async (): Promise<
      Array<ObjectID>
    > => {
      return [];
    };

    expect(await count()).toEqual({ count: 0, isAtLeast: false });
    expect(countStatements).toEqual([]);
  });

  test("an answer that is not a count reads as 0, never as a negative or a fraction", async () => {
    for (const answer of [[], [{ count: null }], [{ count: -3 }], [{}]]) {
      countAnswer = answer as Array<Record<string, unknown>>;
      expect((await count()).count).toBe(0);
    }

    countAnswer = [{ count: "17" }];
    expect((await count()).count).toBe(17);
  });

  test("a failing count fails: the route answers it with no count", async () => {
    ResolvedRecordRetention.runCountQuery = async (): Promise<
      Array<Record<string, unknown>>
    > => {
      throw new Error("canceling statement due to statement timeout");
    };

    await expect(count()).rejects.toThrow("statement timeout");
  });
});

describe("buildProjectsReachedByMaximumStatement: what a new maximum reaches", () => {
  test("with no maximum yet: every project at Never, and every one longer than the new maximum", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildProjectsReachedByMaximumStatement({
        kind: ResolvedRecordKind.Incident,
        maximumInDays: 365,
      });

    expect(words(statement.sql)).toBe(
      words(`SELECT COUNT(*)::int AS "count"
FROM "Project" p
WHERE p."deletedAt" IS NULL
  AND COALESCE(CASE WHEN p."incidentRetentionInDays" >= $1 THEN p."incidentRetentionInDays" END, $2 + 1) > $2`),
    );
    expect(statement.params).toEqual([30, 365]);
  });

  test("under a maximum already: each project as long as it keeps them now", () => {
    const statement: ResolvedRecordRetentionStatement =
      buildProjectsReachedByMaximumStatement({
        kind: ResolvedRecordKind.Alert,
        maximumInDays: 90,
        currentMaximumInDays: 730,
      });

    expect(words(statement.sql)).toBe(
      words(`SELECT COUNT(*)::int AS "count"
FROM "Project" p
WHERE p."deletedAt" IS NULL
  AND COALESCE(CASE WHEN p."alertRetentionInDays" >= $1 AND p."alertRetentionInDays" <= $3 THEN p."alertRetentionInDays" ELSE $3 END, $2 + 1) > $2`),
    );
    expect(statement.params).toEqual([30, 90, 730]);
  });
});

describe("countProjectsReachedByMaximum", () => {
  test("weighs the new maximum against the one the server has now", async () => {
    serverLimits = { maximumInDays: 730, defaultInDays: 0 };
    database.answer = (
      sql: string,
      params: Array<unknown>,
    ): Array<Record<string, unknown>> => {
      database.statements.push({ sql, params });
      return [{ count: 12 }];
    };

    expect(
      await ResolvedRecordRetention.countProjectsReachedByMaximum({
        kind: ResolvedRecordKind.Alert,
        maximumInDays: 90,
      }),
    ).toBe(12);
    expect(limitReads).toEqual([ResolvedRecordKind.Alert]);
    expect(database.statements[0]!.params).toEqual([30, 90, 730]);
  });
});

describe("the server's limits and the count's runner, as they run", () => {
  test("getServerLimits reads the kind's two columns of the one config row, as OneUptime", async () => {
    restoreSeams();

    const findOneById: SpyInstance<typeof GlobalConfigService.findOneById> =
      jest
        .spyOn(GlobalConfigService, "findOneById")
        .mockResolvedValue(
          GlobalConfig.fromJSON(
            { maxAlertRetentionInDays: 365, defaultAlertRetentionInDays: "90" },
            GlobalConfig,
          ) as GlobalConfig,
        );

    expect(
      await ResolvedRecordRetention.getServerLimits(ResolvedRecordKind.Alert),
    ).toEqual({ maximumInDays: 365, defaultInDays: 90 });

    const call: Parameters<typeof GlobalConfigService.findOneById>[0] =
      findOneById.mock.calls[0]![0];

    expect(call.id.toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(call.select).toEqual({
      maxAlertRetentionInDays: true,
      defaultAlertRetentionInDays: true,
    });
    expect(call.props).toEqual({ isRoot: true });
  });

  test("getServerLimits: no config row, or values that cannot be read, is no maximum and Never", async () => {
    restoreSeams();

    jest.spyOn(GlobalConfigService, "findOneById").mockResolvedValueOnce(null);

    expect(
      await ResolvedRecordRetention.getServerLimits(
        ResolvedRecordKind.Incident,
      ),
    ).toEqual({ maximumInDays: undefined, defaultInDays: 0 });

    jest
      .spyOn(GlobalConfigService, "findOneById")
      .mockResolvedValueOnce(
        GlobalConfig.fromJSON(
          {
            maxIncidentRetentionInDays: 45,
            defaultIncidentRetentionInDays: -1,
          },
          GlobalConfig,
        ) as GlobalConfig,
      );

    expect(
      await ResolvedRecordRetention.getServerLimits(
        ResolvedRecordKind.Incident,
      ),
    ).toEqual({ maximumInDays: undefined, defaultInDays: 0 });
  });

  function fakeRunner(failOn?: string): {
    runner: Record<string, unknown>;
    calls: Array<string>;
  } {
    const calls: Array<string> = [];
    const runner: Record<string, unknown> = {
      isTransactionActive: false,
      connect: async (): Promise<void> => {
        calls.push("connect");
      },
      startTransaction: async (): Promise<void> => {
        calls.push("begin");
        runner["isTransactionActive"] = true;
      },
      query: async (sql: string): Promise<Array<Record<string, unknown>>> => {
        calls.push(sql);

        if (failOn && sql.includes(failOn)) {
          throw new Error("canceling statement due to statement timeout");
        }

        return [{ count: 3 }];
      },
      commitTransaction: async (): Promise<void> => {
        calls.push("commit");
        runner["isTransactionActive"] = false;
      },
      rollbackTransaction: async (): Promise<void> => {
        calls.push("rollback");
        runner["isTransactionActive"] = false;
      },
      release: async (): Promise<void> => {
        calls.push("release");
      },
    };

    return { runner, calls };
  }

  function useRunner(runner: Record<string, unknown>): void {
    jest.spyOn(ProjectService, "getRepository").mockReturnValue({
      manager: {
        connection: {
          createQueryRunner: (): unknown => {
            return runner;
          },
        },
      },
    } as never);
  }

  test("runCountQuery: a transaction of its own, its statement timeout set first, then released", async () => {
    restoreSeams();
    const { runner, calls } = fakeRunner();
    useRunner(runner);

    expect(
      await ResolvedRecordRetention.runCountQuery(`SELECT COUNT(*)`, [1]),
    ).toEqual([{ count: 3 }]);
    expect(calls).toEqual([
      "connect",
      "begin",
      `SET LOCAL statement_timeout = ${RETENTION_COUNT_TIMEOUT_MS}`,
      "SELECT COUNT(*)",
      "commit",
      "release",
    ]);
  });

  test("runCountQuery: a count that times out is rolled back, released and thrown", async () => {
    restoreSeams();
    const { runner, calls } = fakeRunner("COUNT");
    useRunner(runner);

    await expect(
      ResolvedRecordRetention.runCountQuery(`SELECT COUNT(*)`, []),
    ).rejects.toThrow("statement timeout");
    expect(calls.slice(-2)).toEqual(["rollback", "release"]);
    expect(calls).not.toContain("commit");
  });

  test("a count is given a few seconds, and stops at ten thousand", () => {
    expect(RETENTION_COUNT_TIMEOUT_MS).toBe(5000);
    expect(RETENTION_COUNT_UP_TO).toBe(10000);
  });
});
