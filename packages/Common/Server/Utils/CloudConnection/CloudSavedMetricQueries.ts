import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import DashboardService from "../../Services/DashboardService";
import MonitorService from "../../Services/MonitorService";
import ServiceLevelObjectiveService from "../../Services/ServiceLevelObjectiveService";

/*
 * WHICH OF A PROJECT'S MONITORS, DASHBOARDS AND SLOS MAY READ A METRIC.
 *
 * A Metrics monitor keeps its queries in its steps, a dashboard in its
 * widgets, an SLO in its metric: JSON whose text names each metric it reads
 * by its stored name. So the rows that may read one are found by a LIKE on
 * that text - wide on purpose, a few patterns at once - and the queries
 * themselves are read out of them by SavedMetricQueryReads, which says
 * which really do. Rows deleted, an archived SLO and a monitor of another
 * type are never read; at most `limit` of each.
 *
 * Read as the server, to find them: a caller that shows them to a person
 * reads them again as that person (CloudAddedMetricReaders).
 *
 * Two callers: what keeps a deprecated metric read (CloudRetiredMetricReads,
 * #10011), and what a resource's added metric is read by before it is
 * removed (#9807).
 */

export interface SavedMetricQueryRow {
  id: string;
  name: string;
  // The JSON the queries are in: a monitor's steps, a dashboard's view config, an SLO's metric.
  json: unknown;
}

export interface SavedMetricQueryRows {
  monitors: Array<SavedMetricQueryRow>;
  dashboards: Array<SavedMetricQueryRow>;
  slos: Array<SavedMetricQueryRow>;
}

/*
 * A LIKE pattern that finds `text` anywhere in a row's JSON, case aside:
 * its own "%", "_" and "\" are themselves.
 */
export function getContainsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character: string): string => {
    return `\\${character}`;
  })}%`;
}

function readJSON(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toRows(
  rows: Array<Record<string, unknown>> | null | undefined,
  column: string,
): Array<SavedMetricQueryRow> {
  return (rows || []).map(
    (row: Record<string, unknown>): SavedMetricQueryRow => {
      return {
        id: row["_id"] ? String(row["_id"]) : "",
        name: typeof row["name"] === "string" ? row["name"] : "",
        json: readJSON(row[column]),
      };
    },
  );
}

/*
 * `column`::text ILIKE $n OR ... for each pattern, numbered from `first`:
 * a row that names any of them.
 */
function anyPattern(data: {
  column: string;
  patterns: Array<string>;
  first: number;
}): string {
  return `(${data.patterns
    .map((_pattern: string, index: number): string => {
      return `"${data.column}"::text ILIKE $${data.first + index}`;
    })
    .join(" OR ")})`;
}

export async function findSavedMetricQueryRows(data: {
  projectId: ObjectID;
  // LIKE patterns, case aside: a row whose JSON matches none is not read.
  namePatterns: Array<string>;
  // Rows of each kind at most.
  limit: number;
  // Whether SLOs are read too.
  includeSlos?: boolean | undefined;
}): Promise<SavedMetricQueryRows> {
  const found: SavedMetricQueryRows = {
    monitors: [],
    dashboards: [],
    slos: [],
  };

  if (data.namePatterns.length === 0) {
    return found;
  }

  const project: string = data.projectId.toString();
  const patterns: Array<string> = data.namePatterns;

  found.monitors = toRows(
    (await MonitorService.getRepository().manager.query(
      `SELECT "monitorSteps", "_id", "name" FROM "Monitor" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "monitorType" = $2 AND "monitorSteps" IS NOT NULL AND ${anyPattern(
        { column: "monitorSteps", patterns, first: 3 },
      )} LIMIT $${3 + patterns.length}`,
      [project, MonitorType.Metrics, ...patterns, data.limit],
    )) as Array<Record<string, unknown>>,
    "monitorSteps",
  );

  found.dashboards = toRows(
    (await DashboardService.getRepository().manager.query(
      `SELECT "dashboardViewConfig", "_id", "name" FROM "Dashboard" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "dashboardViewConfig" IS NOT NULL AND ${anyPattern(
        { column: "dashboardViewConfig", patterns, first: 2 },
      )} LIMIT $${2 + patterns.length}`,
      [project, ...patterns, data.limit],
    )) as Array<Record<string, unknown>>,
    "dashboardViewConfig",
  );

  if (data.includeSlos) {
    found.slos = toRows(
      (await ServiceLevelObjectiveService.getRepository().manager.query(
        `SELECT "metricQueryConfig", "_id", "name" FROM "ServiceLevelObjective" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "isArchived" IS NOT TRUE AND "metricQueryConfig" IS NOT NULL AND ${anyPattern(
          { column: "metricQueryConfig", patterns, first: 2 },
        )} LIMIT $${2 + patterns.length}`,
        [project, ...patterns, data.limit],
      )) as Array<Record<string, unknown>>,
      "metricQueryConfig",
    );
  }

  return found;
}
