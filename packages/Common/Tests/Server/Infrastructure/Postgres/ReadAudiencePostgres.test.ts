import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { Client } from "pg";
import { FindOperator } from "typeorm";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ReadAudiencePermission from "../../../../Server/Types/Database/Permissions/ReadAudiencePermission";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

/*
 * WHAT EVERY READER OF A SUBJECT MAY READ, READ BY POSTGRES (#9576).
 *
 * The conditions an investigation's reads are narrowed by
 * (ReadAudiencePermission) run here as Postgres runs them, on the tables
 * they read - a kind's owner and label tables, a record read through
 * another, a private kind - with rows that tell every case apart: a
 * monitor an owner sets apart, one a label does, one whose only owner row
 * was deleted, one the subject names; the status timelines of each; a
 * private incident, and the subject's own private incident; their notes.
 *
 * Opt in with RUN_POSTGRES_READ_AUDIENCE_TESTS=true against any Postgres
 * (READ_AUDIENCE_TEST_DATABASE_HOST, _PORT, _NAME; DATABASE_USERNAME,
 * DATABASE_PASSWORD): the tables are made, with the columns the conditions
 * read, in a schema of the test's own, and dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_READ_AUDIENCE_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT: string = "99999999-9999-4999-8999-999999999999";
const MONITOR_NOBODY_SET_APART: string = "00000000-0000-4000-8000-000000000001";
const MONITOR_OWNED: string = "00000000-0000-4000-8000-000000000002";
const MONITOR_LABELLED: string = "00000000-0000-4000-8000-000000000003";
const MONITOR_NAMED_OWNED: string = "00000000-0000-4000-8000-000000000004";
const INCIDENT_OPEN: string = "00000000-0000-4000-8000-000000000011";
const INCIDENT_PRIVATE: string = "00000000-0000-4000-8000-000000000012";
const INCIDENT_SUBJECT_PRIVATE: string = "00000000-0000-4000-8000-000000000013";

// A condition's SQL for a column, its parameters written in as literals.
function sqlOf(condition: unknown, alias: string): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;
  let sql: string = operator.getSql!(alias);

  for (const [key, value] of Object.entries(
    (operator.objectLiteralParameters || {}) as Record<string, unknown>,
  )) {
    const literal: string = (Array.isArray(value) ? value : [value])
      .map((each: unknown): string => {
        return `'${String(each).replace(/'/g, "''")}'`;
      })
      .join(", ");

    sql = sql.split(`:...${key}`).join(literal).split(`:${key}`).join(literal);
  }

  return sql;
}

describePostgres("what every reader of a subject may read, on Postgres", () => {
  const schema: string = `read_audience_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;
  let client: Client;

  // Somebody reads every kind only by owner and by label; the subject names one monitor and itself.
  const narrowed: ReadAudience = {
    _type: "ReadAudience",
    projectId: PROJECT,
    ownedOnlyPermissions: [Permission.ProjectMember],
    labelledPermissions: [Permission.ProjectMember],
    named: {
      Monitor: [MONITOR_NAMED_OWNED],
      Incident: [INCIDENT_SUBJECT_PRIVATE],
    },
    telemetryBlockedIds: [],
  };

  async function idsOf(data: {
    table: string;
    column: string;
    condition: unknown;
  }): Promise<Array<string | null>> {
    // In the project, as every read is held to its tenant.
    const result: { rows: Array<Record<string, string | null>> } =
      await client.query(
        `SELECT "${data.table}"."${data.column}" AS "value" FROM "${data.table}" WHERE "${data.table}"."projectId" = '${PROJECT}' AND ${sqlOf(data.condition, `"${data.table}"."_id"`)} ORDER BY 1 NULLS LAST`,
      );

    return result.rows.map((row: Record<string, string | null>) => {
      return row["value"] || null;
    });
  }

  beforeAll(async () => {
    client = new Client({
      host: process.env["READ_AUDIENCE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["READ_AUDIENCE_TEST_DATABASE_PORT"] || "5400"),
      user: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["READ_AUDIENCE_TEST_DATABASE_NAME"] || "postgres",
    });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Monitor" ("_id" uuid PRIMARY KEY, "projectId" uuid);
      CREATE TABLE "MonitorOwnerUser" ("monitorId" uuid, "userId" uuid, "deletedAt" timestamptz);
      CREATE TABLE "MonitorOwnerTeam" ("monitorId" uuid, "teamId" uuid, "deletedAt" timestamptz);
      CREATE TABLE "MonitorLabel" ("monitorId" uuid, "labelId" uuid);
      CREATE TABLE "MonitorStatusTimeline" ("_id" uuid PRIMARY KEY, "monitorId" uuid, "projectId" uuid);
      CREATE TABLE "Incident" ("_id" uuid PRIMARY KEY, "projectId" uuid, "isPrivate" boolean);
      CREATE TABLE "IncidentLabel" ("incidentId" uuid, "labelId" uuid);
      CREATE TABLE "IncidentOwnerUser" ("incidentId" uuid, "userId" uuid, "deletedAt" timestamptz);
      CREATE TABLE "IncidentOwnerTeam" ("incidentId" uuid, "teamId" uuid, "deletedAt" timestamptz);
      CREATE TABLE "IncidentInternalNote" ("_id" uuid PRIMARY KEY, "incidentId" uuid, "projectId" uuid);

      INSERT INTO "Monitor" VALUES
        ('${MONITOR_NOBODY_SET_APART}', '${PROJECT}'),
        ('${MONITOR_OWNED}', '${PROJECT}'),
        ('${MONITOR_LABELLED}', '${PROJECT}'),
        ('${MONITOR_NAMED_OWNED}', '${PROJECT}'),
        (gen_random_uuid(), '${OTHER_PROJECT}');
      INSERT INTO "MonitorOwnerTeam" VALUES
        ('${MONITOR_OWNED}', gen_random_uuid(), NULL),
        ('${MONITOR_NAMED_OWNED}', gen_random_uuid(), NULL);
      -- An owner who was removed owns nothing.
      INSERT INTO "MonitorOwnerUser" VALUES ('${MONITOR_NOBODY_SET_APART}', gen_random_uuid(), now());
      INSERT INTO "MonitorLabel" VALUES ('${MONITOR_LABELLED}', gen_random_uuid());
      INSERT INTO "MonitorStatusTimeline" VALUES
        (gen_random_uuid(), '${MONITOR_NOBODY_SET_APART}', '${PROJECT}'),
        (gen_random_uuid(), '${MONITOR_OWNED}', '${PROJECT}'),
        (gen_random_uuid(), '${MONITOR_LABELLED}', '${PROJECT}'),
        (gen_random_uuid(), '${MONITOR_NAMED_OWNED}', '${PROJECT}'),
        (gen_random_uuid(), NULL, '${PROJECT}');
      INSERT INTO "Incident" VALUES
        ('${INCIDENT_OPEN}', '${PROJECT}', false),
        ('${INCIDENT_PRIVATE}', '${PROJECT}', true),
        ('${INCIDENT_SUBJECT_PRIVATE}', '${PROJECT}', true);
      INSERT INTO "IncidentInternalNote" VALUES
        (gen_random_uuid(), '${INCIDENT_OPEN}', '${PROJECT}'),
        (gen_random_uuid(), '${INCIDENT_PRIVATE}', '${PROJECT}'),
        (gen_random_uuid(), '${INCIDENT_SUBJECT_PRIVATE}', '${PROJECT}');
    `);
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  test("monitors: none an owner or a label sets apart, and the one the subject names whoever owns it", async () => {
    expect(
      await idsOf({
        table: "Monitor",
        column: "_id",
        condition: ReadAudiencePermission.getConditions(Monitor, narrowed)[0]!
          .condition,
      }),
    ).toEqual([MONITOR_NOBODY_SET_APART, MONITOR_NAMED_OWNED]);
  });

  test("a status timeline goes with its monitor; one of no monitor stays", async () => {
    expect(
      await idsOf({
        table: "MonitorStatusTimeline",
        column: "monitorId",
        condition: ReadAudiencePermission.getConditions(
          MonitorStatusTimeline,
          narrowed,
        )[0]!.condition,
      }),
    ).toEqual([MONITOR_NOBODY_SET_APART, MONITOR_NAMED_OWNED, null]);
  });

  test("incidents: never a private one but the subject", async () => {
    expect(
      await idsOf({
        table: "Incident",
        column: "_id",
        condition: ReadAudiencePermission.getConditions(Incident, narrowed)[0]!
          .condition,
      }),
    ).toEqual([INCIDENT_OPEN, INCIDENT_SUBJECT_PRIVATE]);
  });

  test("an incident's notes go with a private incident", async () => {
    expect(
      await idsOf({
        table: "IncidentInternalNote",
        column: "incidentId",
        condition: ReadAudiencePermission.getConditions(
          IncidentInternalNote,
          narrowed,
        )[0]!.condition,
      }),
    ).toEqual([INCIDENT_OPEN, INCIDENT_SUBJECT_PRIVATE]);
  });

  test("what it leaves out: those set apart, of its own project only", async () => {
    expect(
      await idsOf({
        table: "Monitor",
        column: "_id",
        condition: ReadAudiencePermission.getSetApartCondition(
          Monitor,
          narrowed,
        ),
      }),
    ).toEqual([MONITOR_OWNED, MONITOR_LABELLED]);
  });

  test("a project whose roles narrow nobody reads every monitor", async () => {
    expect(
      ReadAudiencePermission.getConditions(Monitor, {
        ...narrowed,
        ownedOnlyPermissions: [],
        labelledPermissions: [],
      }),
    ).toEqual([]);
  });
});
