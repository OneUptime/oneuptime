import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE MONITORS OF ISSUE #10819, AS ROWS (the probe dispatch benchmark).
 *
 * A self-hosted install with 39,800 enabled monitor assignments - about
 * 28,200 checked every minute and 11,500 every five - spread over some
 * probes. Each assignment is a MonitorProbe row (a monitor on one probe),
 * with its Monitor (a Website check, the steps the Dashboard makes for one)
 * and its Project. Written straight into a schema of their own, on copies
 * of the migrated Project, Monitor, MonitorProbe and MonitorTest tables, so
 * the real claim statements read exactly the indexes they read in
 * production and nothing else in the database is touched.
 *
 * Two schedules:
 *   - "due": every assignment due when the run starts (its next check a
 *     second to a minute ago): a backlog, to measure how fast the probes
 *     are handed monitors at most;
 *   - "scheduled": as a running install has them - every one-minute
 *     monitor due at the next minute, every five-minute monitor at the next
 *     multiple of five minutes, as the claim schedules them (cron), so each
 *     minute starts with the whole minute's monitors due at once.
 */

export interface ProbeDispatchFleetOptions {
  oneMinuteAssignments: number;
  fiveMinuteAssignments: number;
  // Probes (probe keys) the assignments are spread over, round robin.
  probes: number;
  projects: number;
  schedule: "due" | "scheduled";
}

// The issue's install.
export const ISSUE_10819_FLEET: ProbeDispatchFleetOptions = {
  oneMinuteAssignments: 28_200,
  fiveMinuteAssignments: 11_500,
  probes: 4,
  projects: 40,
  schedule: "due",
};

export const ONE_MINUTE_INTERVAL: string = "* * * * *";
export const FIVE_MINUTE_INTERVAL: string = "*/5 * * * *";

// The tables the dispatch path reads and writes, copied into the schema.
export const PROBE_DISPATCH_TABLES: Array<string> = [
  "Project",
  "Monitor",
  "MonitorProbe",
  "MonitorTest",
];

export interface SeededFleet {
  schema: string;
  probeIds: Array<string>;
  assignments: number;
  // One-minute checks a minute, plus a fifth of the five-minute ones.
  checksPerMinute: number;
}

// What runs one statement; the harness's Postgres pool or data source.
export type RunSql = (
  sql: string,
  parameters?: Array<unknown>,
) => Promise<Array<Record<string, unknown>>>;

// A schema name of the benchmark's own: never one anyone else uses.
export function benchmarkSchemaName(): string {
  return `probe_dispatch_${ObjectID.generate().toString().replace(/-/g, "")}`;
}

// A Website monitor's steps, as the Dashboard makes them, as stored.
export function websiteMonitorStepsAsStored(index: number): unknown {
  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    defaultMonitorStatusId: ObjectID.generate(),
    monitorType: MonitorType.Website,
    monitorName: `Website ${index}`,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });

  const step:
    | { data?: { monitorDestination?: unknown } | undefined }
    | undefined = steps.data?.monitorStepsInstanceArray[0];

  if (step?.data) {
    step.data.monitorDestination = URL.fromString(
      `https://service-${index}.example.com/health`,
    );
  }

  return MonitorSteps.getDatabaseTransformer().to(steps);
}

/*
 * Copies the migrated tables' structure - columns, defaults, indexes - into
 * `schema`. Foreign keys are not copied (LIKE never does), and a fixture
 * names only the columns the dispatch path reads, so the rest may be NULL.
 */
export async function createFleetSchema(
  sql: RunSql,
  schema: string,
): Promise<void> {
  await sql(`CREATE SCHEMA "${schema}"`);

  /*
   * An App process waits, as it connects, until every migration it knows
   * is applied (SchemaMigrationWait), and TypeORM looks for the migrations
   * table in the first schema of the search path: this one.
   */
  await sql(
    `CREATE VIEW "${schema}"."migrations" AS SELECT * FROM public."migrations"`,
  );

  for (const table of PROBE_DISPATCH_TABLES) {
    await sql(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
    );

    const columns: Array<Record<string, unknown>> = await sql(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'
         AND column_name NOT IN ('_id', 'isEnabled')`,
      [schema, table],
    );

    for (const column of columns) {
      await sql(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${String(column["column_name"])}" DROP NOT NULL`,
      );
    }
  }
}

export async function dropFleetSchema(
  sql: RunSql,
  schema: string,
): Promise<void> {
  await sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

/*
 * Writes the fleet. Monitors share one steps document per hundred (the
 * claim and the read never look inside it, and a probe is handed each as
 * its own row), so the seeding takes seconds, not minutes.
 */
export async function seedFleet(
  sql: RunSql,
  schema: string,
  options: ProbeDispatchFleetOptions,
): Promise<SeededFleet> {
  const probeIds: Array<string> = [];

  for (let probe: number = 0; probe < options.probes; probe++) {
    probeIds.push(ObjectID.generate().toString());
  }

  const projectIds: Array<string> = [];

  for (let project: number = 0; project < options.projects; project++) {
    projectIds.push(ObjectID.generate().toString());
  }

  await sql(
    `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked", "version")
     SELECT id, 'Project ' || ordinality, false, 1
     FROM unnest($1::uuid[]) WITH ORDINALITY AS project(id, ordinality)`,
    [projectIds],
  );

  const stepsDocuments: Array<string> = [];

  for (let document: number = 0; document < 100; document++) {
    stepsDocuments.push(JSON.stringify(websiteMonitorStepsAsStored(document)));
  }

  const total: number =
    options.oneMinuteAssignments + options.fiveMinuteAssignments;

  /*
   * One monitor per assignment: the n-th is on probe n mod probes, in
   * project n mod projects, checked every minute for the first
   * oneMinuteAssignments and every five minutes after.
   */
  await sql(
    `INSERT INTO "${schema}"."Monitor"
       ("_id", "projectId", "name", "monitorType", "monitoringInterval",
        "monitorSteps", "isArchived", "disableActiveMonitoring",
        "disableActiveMonitoringBecauseOfManualIncident",
        "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
        "version")
     SELECT
       gen_random_uuid(),
       ($2::uuid[])[1 + (n % $3)],
       'Website ' || n,
       'Website',
       CASE WHEN n < $4 THEN $5 ELSE $6 END,
       ($7::jsonb[])[1 + (n % 100)],
       false, false, false, false, 1
     FROM generate_series(0, $1 - 1) AS n`,
    [
      total,
      projectIds,
      options.projects,
      options.oneMinuteAssignments,
      ONE_MINUTE_INTERVAL,
      FIVE_MINUTE_INTERVAL,
      stepsDocuments,
    ],
  );

  await sql(
    `INSERT INTO "${schema}"."MonitorProbe"
       ("_id", "projectId", "probeId", "monitorId", "isEnabled", "nextPingAt",
        "version")
     SELECT gen_random_uuid(), x."projectId",
       ($1::uuid[])[1 + (x.position % $2)], x."_id", true, now(), 1
     FROM (
       SELECT m."_id", m."projectId",
         (row_number() OVER (ORDER BY m."_id"))::int AS position
       FROM "${schema}"."Monitor" m
     ) x`,
    [probeIds, options.probes],
  );

  await scheduleFleet(sql, schema, options.schedule);

  await sql(`ANALYZE "${schema}"."Project"`);
  await sql(`ANALYZE "${schema}"."Monitor"`);
  await sql(`ANALYZE "${schema}"."MonitorTest"`);

  return {
    schema: schema,
    probeIds: probeIds,
    assignments: total,
    checksPerMinute:
      options.oneMinuteAssignments + options.fiveMinuteAssignments / 5,
  };
}

/*
 * Sets every assignment's next check, from now: due, a second to a minute
 * ago; scheduled, the next minute or the next multiple of five minutes, as
 * cron puts them. Called again right before the probes start, so the App
 * replicas' start-up does not age the backlog.
 */
export async function scheduleFleet(
  sql: RunSql,
  schema: string,
  schedule: ProbeDispatchFleetOptions["schedule"],
): Promise<void> {
  const nextPingAt: string =
    schedule === "due"
      ? `now() - (1 + random() * 59) * INTERVAL '1 second'`
      : `CASE WHEN m."monitoringInterval" = '${ONE_MINUTE_INTERVAL}'
           THEN date_trunc('minute', now()) + INTERVAL '1 minute'
           ELSE date_trunc('hour', now())
             + (floor(date_part('minute', now()) / 5) * 5 + 5) * INTERVAL '1 minute'
         END`;

  await sql(
    `UPDATE "${schema}"."MonitorProbe" mp
     SET "nextPingAt" = ${nextPingAt}, "lastPingAt" = NULL
     FROM "${schema}"."Monitor" m
     WHERE m."_id" = mp."monitorId"`,
  );

  await sql(`VACUUM ANALYZE "${schema}"."MonitorProbe"`);
}

/*
 * A "Test monitor" run, as the Dashboard writes one: a Website check of one
 * step, in the queue for `probeId`. Returns its id.
 */
export async function createMonitorTest(
  sql: RunSql,
  schema: string,
  data: { probeId: string; projectId: string },
): Promise<string> {
  const id: string = ObjectID.generate().toString();

  await sql(
    `INSERT INTO "${schema}"."MonitorTest"
       ("_id", "projectId", "probeId", "monitorType", "monitorSteps",
        "isInQueue", "version")
     VALUES ($1, $2, $3, 'Website', $4::jsonb, true, 1)`,
    [
      id,
      data.projectId,
      data.probeId,
      JSON.stringify(websiteMonitorStepsAsStored(0)),
    ],
  );

  return id;
}

export function describeFleet(options: ProbeDispatchFleetOptions): JSONObject {
  return {
    oneMinuteAssignments: options.oneMinuteAssignments,
    fiveMinuteAssignments: options.fiveMinuteAssignments,
    probes: options.probes,
    projects: options.projects,
    schedule: options.schedule,
  };
}
