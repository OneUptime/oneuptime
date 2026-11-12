import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ClickhouseDatabase from "../../../Server/Infrastructure/ClickhouseDatabase";
import {
  AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS,
  AuditLogService,
} from "../../../Server/Services/AuditLogService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { AUDIT_LOG_EXPORT_SOURCE_COLUMNS } from "../../../Types/AuditLog/Export/AuditLogExportRecord";
import { JSONObject } from "../../../Types/JSON";
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
 *
 * So does the read a failing export makes of when the first of the entries
 * it has not sent is deleted: the soonest retentionDate stamped on the same
 * entries (#6563), below.
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

const CURSOR: { createdAt: Date; id: ObjectID } = {
  createdAt: new Date("2026-10-23T10:00:05.000Z"),
  id: CURSOR_ID,
};

const buildSoonest: (data: {
  projectId: ObjectID | null;
  after: { createdAt: Date; id: ObjectID } | null;
}) => Statement = (data: {
  projectId: ObjectID | null;
  after: { createdAt: Date; id: ObjectID } | null;
}): Statement => {
  return AuditLogService.toSoonestRetentionDateStatement({
    databaseName: "oneuptime",
    tableName: "AuditLog",
    projectId: data.projectId,
    startsAt: new Date("2026-10-01T00:00:00.000Z"),
    until: new Date("2026-10-24T09:14:03.000Z"),
    after: data.after,
  });
};

// Every window an export reads: either export, with or without a cursor.
const WINDOWS: Array<{
  name: string;
  projectId: ObjectID | null;
  after: { createdAt: Date; id: ObjectID } | null;
}> = [
  { name: "the instance's export, first read", projectId: null, after: null },
  {
    name: "the instance's export, after its cursor",
    projectId: null,
    after: CURSOR,
  },
  {
    name: "a project's export, first read",
    projectId: PROJECT_ID,
    after: null,
  },
  {
    name: "a project's export, after its cursor",
    projectId: PROJECT_ID,
    after: CURSOR,
  },
];

describe("AuditLogService.toSoonestRetentionDateStatement", () => {
  test("counts the entries waiting and reads the soonest stamp among them, as whole seconds since 1970, from the audit table", () => {
    const query: string = oneLine(
      buildSoonest({ projectId: null, after: null }),
    );

    expect(
      query.startsWith(
        "SELECT count() AS waiting, toUnixTimestamp(min(retentionDate)) AS soonest FROM oneuptime.AuditLog WHERE ",
      ),
    ).toBe(true);
  });

  test.each(WINDOWS)(
    "$name: the same entries the export read pages through, with the same bound values",
    (window: {
      projectId: ObjectID | null;
      after: { createdAt: Date; id: ObjectID } | null;
    }) => {
      const read: Statement = build({ ...window });
      const soonest: Statement = buildSoonest(window);
      const whereOf: (query: string, end: string) => string = (
        query: string,
        end: string,
      ): string => {
        return query.split(" WHERE ")[1]!.split(end)[0]!;
      };

      expect(whereOf(oneLine(soonest), " SETTINGS ")).toBe(
        whereOf(oneLine(read), " ORDER BY "),
      );

      // The export read's values, but for its limit (its last).
      const readParams: Record<string, unknown> = { ...read.query_params };
      const keys: Array<string> = Object.keys(readParams);

      delete readParams[keys[keys.length - 1]!];

      expect(soonest.query_params).toEqual(readParams);
    },
  );

  test("a project's export reads that project only; the instance's every project", () => {
    const project: Statement = buildSoonest({
      projectId: PROJECT_ID,
      after: null,
    });

    expect(oneLine(project)).toContain("AND projectId = {p2:String}");
    expect(project.query_params["p2"]).toBe(PROJECT_ID.toString());
    expect(
      oneLine(buildSoonest({ projectId: null, after: null })),
    ).not.toContain("projectId =");
  });

  test("after the cursor: a later second, or the same second with a later id - never an entry already sent", () => {
    const statement: Statement = buildSoonest({
      projectId: PROJECT_ID,
      after: CURSOR,
    });

    expect(oneLine(statement)).toContain(
      "AND (createdAt > {p3:DateTime} OR (createdAt = {p4:DateTime} AND _id > {p5:String}))",
    );
    expect(statement.query_params["p3"]).toBe("2026-10-23 10:00:05");
    expect(statement.query_params["p4"]).toBe("2026-10-23 10:00:05");
    expect(statement.query_params["p5"]).toBe(CURSOR_ID.toString());
    expect(
      oneLine(buildSoonest({ projectId: PROJECT_ID, after: null })),
    ).not.toContain("_id >");
  });

  test("one row: it sorts nothing, has no limit, and reads no column an export sends", () => {
    const query: string = oneLine(
      buildSoonest({ projectId: PROJECT_ID, after: CURSOR }),
    );
    const selected: string = query.split(" FROM ")[0]!;

    expect(query).not.toContain("ORDER BY");
    expect(query).not.toContain("LIMIT");
    expect(query).not.toContain("GROUP BY");
    expect(selected).toBe(
      "SELECT count() AS waiting, toUnixTimestamp(min(retentionDate)) AS soonest",
    );
    expect(AUDIT_LOG_EXPORT_SOURCE_COLUMNS).not.toContain("retentionDate");
  });

  // Stopped part way, the soonest of some entries can be later than the real one: the email would come late.
  test("held to the export read's time limit, and fails at it rather than answering for some of the entries", () => {
    const query: string = oneLine(
      buildSoonest({ projectId: null, after: null }),
    );

    expect(query).toContain(
      `SETTINGS max_execution_time = ${AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS}`,
    );
    expect(query).toContain("timeout_overflow_mode = 'throw'");
    expect(query).not.toContain("'break'");
  });

  test("no value is written into the query text", () => {
    const query: string = oneLine(
      buildSoonest({ projectId: PROJECT_ID, after: CURSOR }),
    );

    expect(query).not.toContain(PROJECT_ID.toString());
    expect(query).not.toContain(CURSOR_ID.toString());
    expect(query).not.toContain("2026-");
  });
});

describe("AuditLogService.readSoonestRetentionDate", () => {
  // 2026-10-31T12:59:00Z.
  const SECONDS: number = Date.parse("2026-10-31T12:59:00.000Z") / 1000;

  test("the soonest stamp, from whole seconds since 1970, whatever the server's zone", () => {
    expect(
      AuditLogService.readSoonestRetentionDate([
        { waiting: "3", soonest: SECONDS },
      ])!.toISOString(),
    ).toBe("2026-10-31T12:59:00.000Z");
  });

  test("count() comes as text (a UInt64) and either value may: both are read as the numbers they are", () => {
    for (const row of [
      { waiting: "1", soonest: SECONDS },
      { waiting: 1, soonest: SECONDS },
      { waiting: "12000", soonest: String(SECONDS) },
    ] as Array<JSONObject>) {
      expect(
        AuditLogService.readSoonestRetentionDate([row])!.toISOString(),
      ).toBe("2026-10-31T12:59:00.000Z");
    }
  });

  // ClickHouse answers min() of no rows as 1970 (0): that is no stamp, never an entry lost in 1970.
  test("nothing waiting is null: no row, a count of 0, or the 1970 ClickHouse answers for none", () => {
    expect(AuditLogService.readSoonestRetentionDate([])).toBeNull();
    expect(
      AuditLogService.readSoonestRetentionDate([{ waiting: "0", soonest: 0 }]),
    ).toBeNull();
    expect(
      AuditLogService.readSoonestRetentionDate([
        { waiting: "0", soonest: SECONDS },
      ]),
    ).toBeNull();
    expect(
      AuditLogService.readSoonestRetentionDate([{ waiting: "4", soonest: 0 }]),
    ).toBeNull();
  });

  test("an answer that is not a stamp is null, never a date that is wrong: the exporter then reckons without it", () => {
    for (const row of [
      {},
      { waiting: "2" },
      { soonest: SECONDS },
      { waiting: "2", soonest: null },
      { waiting: "2", soonest: "soon" },
      { waiting: "2", soonest: -60 },
      { waiting: "2", soonest: Number.POSITIVE_INFINITY },
      { waiting: "2", soonest: 1e16 },
      { waiting: "many", soonest: SECONDS },
      { waiting: "-1", soonest: SECONDS },
    ] as Array<JSONObject>) {
      expect({
        row,
        read: AuditLogService.readSoonestRetentionDate([row]),
      }).toEqual({ row, read: null });
    }
  });
});

/*
 * The read as the exporter calls it: the statement above, run once on the
 * service's own database and table, and its answer read by the reader
 * above. A read ClickHouse refuses (its time limit, a dropped connection)
 * is thrown to the exporter, which then reckons from the retention as it
 * is now (AuditLogExporter.findSoonestRetentionDate).
 */
describe("AuditLogService.findSoonestRetentionDateForExport", () => {
  // The service on a database that is never connected: only its name is read.
  const newService: () => AuditLogService = (): AuditLogService => {
    const service: AuditLogService = new AuditLogService();

    service.database = {
      getDatasourceOptions: (): { database: string } => {
        return { database: "audit_test" };
      },
    } as unknown as ClickhouseDatabase;

    return service;
  };

  const WINDOW: {
    projectId: ObjectID | null;
    startsAt: Date;
    until: Date;
    after: { createdAt: Date; id: ObjectID } | null;
  } = {
    projectId: PROJECT_ID,
    startsAt: new Date("2026-10-01T00:00:00.000Z"),
    until: new Date("2026-10-24T09:14:03.000Z"),
    after: CURSOR,
  };

  // 2026-10-31T12:59:00Z, as ClickHouse answers it.
  const STAMP_SECONDS: number = Date.parse("2026-10-31T12:59:00.000Z") / 1000;

  // A service whose every read answers `answer`, and the statements it ran.
  const answering: (answer: { data?: Array<JSONObject> }) => {
    service: AuditLogService;
    ran: Array<Statement | string>;
  } = (answer: {
    data?: Array<JSONObject>;
  }): { service: AuditLogService; ran: Array<Statement | string> } => {
    const service: AuditLogService = newService();
    const ran: Array<Statement | string> = [];

    jest
      .spyOn(service, "executeQuery")
      .mockImplementation((statement: Statement | string) => {
        ran.push(statement);

        return Promise.resolve({
          json: () => {
            return Promise.resolve(answer);
          },
        } as never);
      });

    return { service, ran };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("runs the soonest-stamp read once, on the service's own database and audit log table, and answers the stamp", async () => {
    const { service, ran } = answering({
      data: [{ waiting: "2", soonest: STAMP_SECONDS }],
    });

    const soonest: Date | null =
      await service.findSoonestRetentionDateForExport(WINDOW);

    expect(soonest!.toISOString()).toBe("2026-10-31T12:59:00.000Z");
    expect(ran).toHaveLength(1);

    const expected: Statement = AuditLogService.toSoonestRetentionDateStatement(
      {
        databaseName: "audit_test",
        tableName: AnalyticsTableName.AuditLog,
        ...WINDOW,
      },
    );
    const statement: Statement = ran[0] as Statement;

    expect(statement.query).toBe(expected.query);
    expect(statement.query_params).toEqual(expected.query_params);
    expect(oneLine(statement)).toContain(
      ` FROM audit_test.${AnalyticsTableName.AuditLog} WHERE `,
    );
  });

  test("an answer with no rows, or with none waiting, is null: the exporter then reckons without it", async () => {
    for (const answer of [
      {},
      { data: [] },
      { data: [{ waiting: "0", soonest: 0 }] },
      { data: [{ waiting: 0, soonest: 0 }] },
    ] as Array<{ data?: Array<JSONObject> }>) {
      const { service } = answering(answer);

      expect({
        answer,
        soonest: await service.findSoonestRetentionDateForExport(WINDOW),
      }).toEqual({ answer, soonest: null });
    }
  });

  test("a read ClickHouse refuses is thrown, never answered as no stamp", async () => {
    const service: AuditLogService = newService();

    jest
      .spyOn(service, "executeQuery")
      .mockRejectedValue(new Error("Timeout exceeded: elapsed 45 seconds"));

    await expect(
      service.findSoonestRetentionDateForExport(WINDOW),
    ).rejects.toThrow("Timeout exceeded: elapsed 45 seconds");
  });
});
