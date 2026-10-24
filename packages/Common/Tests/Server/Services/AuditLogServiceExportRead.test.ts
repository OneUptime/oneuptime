import { describe, expect, test } from "@jest/globals";
import {
  AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS,
  AuditLogService,
} from "../../../Server/Services/AuditLogService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { AUDIT_LOG_EXPORT_SOURCE_COLUMNS } from "../../../Types/AuditLog/Export/AuditLogExportRecord";
import ObjectID from "../../../Types/ObjectID";

/*
 * The read an audit log export sends from: every entry after the export's
 * cursor - (createdAt, _id), so entries recorded in the same second are
 * neither skipped nor sent twice - from Export From up to a minute ago, in
 * that order, its project's only (or every project's for the instance's
 * export). Every value is a bound parameter.
 *
 * The same statement runs against a real ClickHouse in App's
 * Tests/Telemetry/AuditLogExportReadClickhouse.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8ba7b811-9dad-41d1-80b4-00c04fd43101",
);
const CURSOR_ID: ObjectID = new ObjectID(
  "0192f5a1-7c2e-7b1a-9c3d-4e5f60718293",
);

const build: (data: {
  projectId: ObjectID | null;
  after: { createdAt: Date; id: ObjectID } | null;
  limit?: number | undefined;
}) => Statement = (data: {
  projectId: ObjectID | null;
  after: { createdAt: Date; id: ObjectID } | null;
  limit?: number | undefined;
}): Statement => {
  return AuditLogService.toExportReadStatement({
    databaseName: "oneuptime",
    tableName: "AuditLog",
    projectId: data.projectId,
    startsAt: new Date("2026-10-01T00:00:00.000Z"),
    until: new Date("2026-10-24T09:14:03.000Z"),
    after: data.after,
    limit: data.limit ?? 500,
  });
};

const oneLine: (statement: Statement) => string = (
  statement: Statement,
): string => {
  return statement.query.split("\n").join(" ");
};

describe("AuditLogService.toExportReadStatement", () => {
  test("reads the record columns from the audit table, oldest first, then by id", () => {
    const query: string = oneLine(build({ projectId: null, after: null }));

    expect(
      query.startsWith(
        `SELECT ${AUDIT_LOG_EXPORT_SOURCE_COLUMNS.join(", ")} FROM oneuptime.AuditLog WHERE `,
      ),
    ).toBe(true);
    expect(query).toContain(" ORDER BY createdAt ASC, _id ASC LIMIT ");
  });

  test("from Export From up to until, both bound as DateTime", () => {
    const statement: Statement = build({ projectId: null, after: null });

    expect(oneLine(statement)).toContain(
      "createdAt >= {p0:DateTime} AND createdAt <= {p1:DateTime}",
    );
    expect(statement.query_params["p0"]).toBe("2026-10-01 00:00:00");
    expect(statement.query_params["p1"]).toBe("2026-10-24 09:14:03");
  });

  test("an instance export reads every project: no project filter at all", () => {
    expect(oneLine(build({ projectId: null, after: null }))).not.toContain(
      "projectId =",
    );
  });

  test("a project's export reads that project only", () => {
    const statement: Statement = build({ projectId: PROJECT_ID, after: null });

    expect(oneLine(statement)).toContain("AND projectId = {p2:String}");
    expect(statement.query_params["p2"]).toBe(PROJECT_ID.toString());
  });

  test("after the cursor: a later second, or the same second with a later id", () => {
    const statement: Statement = build({
      projectId: PROJECT_ID,
      after: {
        createdAt: new Date("2026-10-23T10:00:05.000Z"),
        id: CURSOR_ID,
      },
    });

    expect(oneLine(statement)).toContain(
      "AND (createdAt > {p3:DateTime} OR (createdAt = {p4:DateTime} AND _id > {p5:String}))",
    );
    expect(statement.query_params["p3"]).toBe("2026-10-23 10:00:05");
    expect(statement.query_params["p4"]).toBe("2026-10-23 10:00:05");
    expect(statement.query_params["p5"]).toBe(CURSOR_ID.toString());
  });

  test("the first read of a new export has no cursor condition", () => {
    expect(
      oneLine(build({ projectId: PROJECT_ID, after: null })),
    ).not.toContain("_id >");
  });

  test("the limit is a whole number of at least one", () => {
    const limitOf: (limit: number) => unknown = (limit: number): unknown => {
      const statement: Statement = build({
        projectId: null,
        after: null,
        limit,
      });
      const params: Record<string, unknown> = statement.query_params;
      const keys: Array<string> = Object.keys(params);

      return params[keys[keys.length - 1]!];
    };

    expect(limitOf(500)).toBe(500);
    expect(limitOf(12.9)).toBe(12);
    expect(limitOf(0)).toBe(1);
    expect(limitOf(-5)).toBe(1);
  });

  test("is held to a time limit the server answers before the client gives up", () => {
    expect(AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS).toBeLessThan(58);
    expect(oneLine(build({ projectId: null, after: null }))).toContain(
      `SETTINGS max_execution_time = ${AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS}`,
    );
  });

  // A sorted read cut short answers rows that are not the first ones: the cursor would skip entries.
  test("fails at the limit rather than breaking off with some rows", () => {
    const query: string = oneLine(build({ projectId: null, after: null }));

    expect(query).toContain("timeout_overflow_mode = 'throw'");
    expect(query).not.toContain("'break'");
  });

  test("no value is written into the query text", () => {
    const query: string = oneLine(
      build({
        projectId: PROJECT_ID,
        after: { createdAt: new Date("2026-10-23T10:00:05Z"), id: CURSOR_ID },
      }),
    );

    expect(query).not.toContain(PROJECT_ID.toString());
    expect(query).not.toContain(CURSOR_ID.toString());
    expect(query).not.toContain("2026-");
  });
});
