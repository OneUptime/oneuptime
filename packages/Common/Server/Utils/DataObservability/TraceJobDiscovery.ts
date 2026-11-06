import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "../../../Types/Date";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SpanService from "../../Services/SpanService";
import { Results } from "../../Services/AnalyticsDatabaseService";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import { getClickhouseDatabaseName } from "../AnalyticsDatabase/ClusterConfig";
import logger from "../Logger";
import { OpenLineageRunEvent, OpenLineageRunState } from "./OpenLineageEvent";
import OpenLineageIngest, { ProjectCatalog } from "./OpenLineageIngest";
import { readClickhouseDate, usageColumns } from "./TableUsageDiscovery";
import {
  matchSpanTableUsage,
  SpanTableUsageRow,
  TableUsageMatch,
} from "./TableUsageMatching";
import { ResponseJSON } from "@clickhouse/client";

/*
 * JOBS THAT NEVER SAID THEY WERE JOBS.
 *
 * A lot of pipelines are a Kubernetes CronJob, or a function on a timer, with
 * no scheduler to send lineage. Their traces say it all the same: which job
 * ran, when it started and ended, whether it failed, and which tables its
 * database calls read and wrote. Every fifteen minutes the last half hour of
 * a project's spans is read that way and fed through the same path as an
 * OpenLineage event (OpenLineageIngest), so each job gets run history, a
 * learned schedule and the Failed, Late and Unusually Long alerts, and a table
 * it stopped writing points at the job that should have written it.
 *
 *  - A run of a CronJob is its Kubernetes Job: my-export-28394110.
 *  - A run of a function is its invocation, and only a function on a timer or
 *    a data source counts: one behind HTTP is a service, not a job.
 *  - Anything else with a Job's name is that Job, one run.
 *
 * The window overlaps the last one, so a run seen again is the same run. A
 * run is only called over once nothing has come from it for a few minutes.
 */

export const TRACE_JOB_WINDOW_IN_MINUTES: number = 30;

// A run still sending spans this recently has not ended, whatever it says so far.
const RUN_QUIET_IN_MILLISECONDS: number = 3 * 60 * 1000;

const MAX_RUNS_PER_PROJECT: number = 2000;
const MAX_TABLE_ROWS_PER_PROJECT: number = 10_000;

// The most runs of one job taken from a window: enough for a job every two minutes.
export const MAX_RUNS_PER_JOB: number = 15;

const MAX_NAME_LENGTH: number = 200;
// What a run's id fits in.
const MAX_RUN_KEY_LENGTH: number = 100;
const MAX_ERROR_LENGTH: number = 2000;

export const TRACE_JOB_NAMESPACE_PREFIXES: {
  kubernetes: string;
  function: string;
} = {
  kubernetes: "kubernetes://",
  function: "function://",
};

// One run of one job, as its spans say.
export interface TraceJobRun {
  jobNamespace: string;
  jobName: string;
  runKey: string;
  startedAt: Date;
  endedAt: Date;
  failedRootCount: number;
  errorMessage: string | null;
  traceId: string | null;
}

// One table a run touched, as its database spans name it.
export interface TraceJobTableRow extends SpanTableUsageRow {
  jobNamespace: string;
  jobName: string;
  runKey: string;
}

/*
 * Which job a span is part of, and which of its runs. The Kubernetes attributes
 * come from a resource, the function's trigger and invocation from the span.
 */
function jobColumns(): Statement {
  return SQL`multiIf(attributes['resource.k8s.cronjob.name'] != '', attributes['resource.k8s.cronjob.name'], attributes['resource.k8s.job.name'] != '', attributes['resource.k8s.job.name'], attributes['resource.faas.name'] != '' AND attributes['faas.trigger'] IN ('timer', 'datasource'), attributes['resource.faas.name'], '') AS jobName, multiIf(attributes['resource.k8s.cronjob.name'] != '' OR attributes['resource.k8s.job.name'] != '', concat('kubernetes://', attributes['resource.k8s.cluster.name'], '/', attributes['resource.k8s.namespace.name']), concat('function://', attributes['resource.cloud.provider'])) AS jobNamespace, multiIf(attributes['resource.k8s.job.name'] != '', attributes['resource.k8s.job.name'], attributes['faas.invocation_id'] != '', attributes['faas.invocation_id'], traceId) AS runKey`;
}

function appendWindow(
  statement: Statement,
  data: { projectId: ObjectID; since: Date; until: Date },
): void {
  statement.append(`${getClickhouseDatabaseName()}.${AnalyticsTableName.Span}`);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND startTime >= ${{
      type: TableColumnType.Date,
      value: data.since,
    }} AND startTime < ${{
      type: TableColumnType.Date,
      value: data.until,
    }}`,
  );
}

export function buildTraceJobRunsStatement(data: {
  projectId: ObjectID;
  since: Date;
  until: Date;
}): Statement {
  const statement: Statement = SQL`SELECT jobNamespace, jobName, runKey, min(startTime) AS startedAt, max(endTime) AS endedAt, countIf(isRootSpan = 1 AND statusCode = 2) AS failedRootCount, anyIf(statusMessage, isRootSpan = 1 AND statusCode = 2) AS errorMessage, any(traceId) AS traceId FROM (SELECT traceId, startTime, endTime, statusCode, statusMessage, isRootSpan, `;

  statement.append(jobColumns());
  statement.append(` FROM `);
  appendWindow(statement, data);
  statement.append(
    SQL`) WHERE jobName != '' GROUP BY jobNamespace, jobName, runKey ORDER BY startedAt DESC LIMIT ${{
      type: TableColumnType.Number,
      value: MAX_RUNS_PER_PROJECT,
    }}`,
  );
  statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

  return statement;
}

export function buildTraceJobTablesStatement(data: {
  projectId: ObjectID;
  since: Date;
  until: Date;
}): Statement {
  const statement: Statement = SQL`SELECT jobNamespace, jobName, runKey, serviceId, dbSystem, dbNamespace, serverAddress, collection, operation, count() AS callCount, countIf(statusCode = 2) AS errorCount, max(startTime) AS lastSeenAt FROM (SELECT statusCode, startTime, traceId, `;

  statement.append(jobColumns());
  statement.append(`, `);
  statement.append(usageColumns());
  statement.append(` FROM `);
  appendWindow(statement, data);
  statement.append(
    SQL` AND kind = ${{
      type: TableColumnType.Text,
      value: SpanKind.Client,
    }}) WHERE jobName != '' AND dbSystem != '' AND collection != '' GROUP BY jobNamespace, jobName, runKey, serviceId, dbSystem, dbNamespace, serverAddress, collection, operation LIMIT ${{
      type: TableColumnType.Number,
      value: MAX_TABLE_ROWS_PER_PROJECT,
    }}`,
  );
  statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

  return statement;
}

function readName(value: unknown, maxLength: number = MAX_NAME_LENGTH): string {
  const text: string = String(value ?? "").trim();

  return text.length <= maxLength ? text : "";
}

export function readTraceJobRun(row: JSONObject): TraceJobRun | null {
  const jobName: string = readName(row["jobName"]);
  const runKey: string = readName(row["runKey"], MAX_RUN_KEY_LENGTH);
  const startedAt: Date | null = readClickhouseDate(row["startedAt"]);
  const endedAt: Date | null = readClickhouseDate(row["endedAt"]);

  if (!jobName || !runKey || !startedAt || !endedAt) {
    return null;
  }

  return {
    jobNamespace: readName(row["jobNamespace"]),
    jobName,
    runKey,
    startedAt,
    endedAt,
    failedRootCount: Number(row["failedRootCount"]) || 0,
    errorMessage:
      String(row["errorMessage"] || "").slice(0, MAX_ERROR_LENGTH) || null,
    traceId: readName(row["traceId"]) || null,
  };
}

function getRunKey(item: {
  jobNamespace: string;
  jobName: string;
  runKey: string;
}): string {
  return `${item.jobNamespace}|${item.jobName}|${item.runKey}`;
}

/*
 * A run as OpenLineage events: its start, and its end once it has gone quiet.
 * A run with no span from the top of its trace in the window has no failure to
 * report: the job's own root span is what says a job failed, and a call that
 * failed and was retried inside it does not.
 */
export function toTraceJobEvents(data: {
  runs: ReadonlyArray<TraceJobRun>;
  tables: ReadonlyArray<TraceJobTableRow>;
  catalog: ProjectCatalog;
  now: Date;
}): Array<OpenLineageRunEvent> {
  const inputs: Map<string, Set<string>> = new Map();
  const outputs: Map<string, Set<string>> = new Map();

  for (const row of data.tables) {
    const match: TableUsageMatch | null = matchSpanTableUsage({
      row,
      stores: data.catalog.stores,
      assets: data.catalog.assets,
    });

    if (!match) {
      continue;
    }

    const into: Map<string, Set<string>> = match.accessKind ===
    DataAssetAccessKind.Write
      ? outputs
      : inputs;
    const key: string = getRunKey(row);

    into.set(
      key,
      (into.get(key) || new Set<string>()).add(match.asset.dataAssetId),
    );
  }

  const seenPerJob: Map<string, number> = new Map();
  const events: Array<OpenLineageRunEvent> = [];

  // Newest first, as the read returns them: a busy job keeps its latest runs.
  for (const run of data.runs) {
    const jobKey: string = `${run.jobNamespace}|${run.jobName}`;
    const seen: number = seenPerJob.get(jobKey) || 0;

    if (seen >= MAX_RUNS_PER_JOB) {
      continue;
    }

    seenPerJob.set(jobKey, seen + 1);

    const key: string = getRunKey(run);
    const shared: Omit<
      OpenLineageRunEvent,
      "eventType" | "eventTime" | "errorMessage"
    > = {
      runId: run.runKey,
      jobNamespace: run.jobNamespace,
      jobName: run.jobName,
      scheduledAt: null,
      inputs: [],
      outputs: [],
      inputDataAssetIds: [...(inputs.get(key) || [])],
      outputDataAssetIds: [...(outputs.get(key) || [])],
      traceId: run.traceId,
    };

    events.push({
      ...shared,
      eventType: OpenLineageRunState.Start,
      eventTime: run.startedAt,
      errorMessage: null,
    });

    if (
      data.now.getTime() - run.endedAt.getTime() >=
      RUN_QUIET_IN_MILLISECONDS
    ) {
      const failed: boolean = run.failedRootCount > 0;

      events.push({
        ...shared,
        eventType: failed
          ? OpenLineageRunState.Fail
          : OpenLineageRunState.Complete,
        eventTime: run.endedAt,
        errorMessage: failed ? run.errorMessage : null,
      });
    }
  }

  return events;
}

export default class TraceJobDiscovery {
  public static async discoverProject(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<number> {
    const window: { projectId: ObjectID; since: Date; until: Date } = {
      projectId: data.projectId,
      since: OneUptimeDate.addRemoveMinutes(
        data.now,
        -TRACE_JOB_WINDOW_IN_MINUTES,
      ),
      until: data.now,
    };
    const runs: Array<TraceJobRun> = [];

    for (const row of await this.read(buildTraceJobRunsStatement(window))) {
      const run: TraceJobRun | null = readTraceJobRun(row);

      if (run) {
        runs.push(run);
      }
    }

    if (runs.length === 0) {
      return 0;
    }

    const catalog: ProjectCatalog = await OpenLineageIngest.readCatalog(
      data.projectId,
    );
    const tables: Array<TraceJobTableRow> = [];

    try {
      for (const row of await this.read(buildTraceJobTablesStatement(window))) {
        const lastSeenAt: Date | null = readClickhouseDate(row["lastSeenAt"]);

        if (lastSeenAt) {
          tables.push({
            jobNamespace: readName(row["jobNamespace"]),
            jobName: readName(row["jobName"]),
            runKey: readName(row["runKey"], MAX_RUN_KEY_LENGTH),
            serviceId: String(row["serviceId"] || ""),
            dbSystem: String(row["dbSystem"] || ""),
            dbNamespace: String(row["dbNamespace"] || ""),
            serverAddress: String(row["serverAddress"] || ""),
            collection: String(row["collection"] || ""),
            operation: String(row["operation"] || ""),
            callCount: Number(row["callCount"]) || 0,
            errorCount: Number(row["errorCount"]) || 0,
            lastSeenAt,
          });
        }
      }
    } catch (error) {
      // Extra to the runs: a job with no tables is still a job.
      logger.error(
        `Data Observability: could not read which tables the jobs of project ${data.projectId.toString()} touch.`,
      );
      logger.error(error);
    }

    return await OpenLineageIngest.ingest({
      projectId: data.projectId,
      events: toTraceJobEvents({ runs, tables, catalog, now: data.now }),
      now: data.now,
      catalog,
    });
  }

  private static async read(statement: Statement): Promise<Array<JSONObject>> {
    const result: Results = await SpanService.executeQuery(statement);
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    return (response.data || []) as Array<JSONObject>;
  }
}
