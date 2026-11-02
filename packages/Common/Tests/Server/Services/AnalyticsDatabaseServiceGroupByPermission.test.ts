import "../TestingUtils/Init";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import ColumnRefusalMessage from "../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import Log from "../../../Models/AnalyticsModels/Log";
import RumSession from "../../../Models/AnalyticsModels/RumSession";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A telemetry read's group by is what the read returns: a list grouped by a
 * column selects that column in place of its select (toFindStatement), an
 * aggregate carries it on every row, and a count counts its distinct
 * values. So a group by is held to the rule a select is: a column the caller
 * may not read is refused with the refusal a select gets, before any
 * statement is built.
 *
 * These run the real read check (AnalyticsDatabase/ModelPermission) for a
 * project member; only ClickHouse is answered here. Log's retentionDate is
 * the column: it has no read permissions, so nobody may read it through the
 * API, and a select of it has always been refused.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

const RETENTION_DATE_REFUSAL: string = ColumnRefusalMessage.getSelectRefusal({
  column: "retentionDate",
  permissions: [],
});

// Identifiers are bound as parameters; put them back to read the SQL.
const IDENTIFIER_PARAMETER: RegExp = /\{(p\d+(?:_[tc])?):Identifier\}/g;

function sqlOf(statement: Statement): string {
  const params: Record<string, unknown> = statement.query_params;

  return statement.query.replace(
    IDENTIFIER_PARAMETER,
    (_match: string, name: string): string => {
      return String(params[name]);
    },
  );
}

function memberProps(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

describe("A telemetry group by is held to the column permissions of a select", () => {
  let service: AnalyticsDatabaseService<Log>;
  let statements: Array<Statement>;
  let rows: Array<JSONObject>;

  beforeEach(() => {
    service = new AnalyticsDatabaseService<Log>({ modelType: Log });
    statements = [];
    rows = [];

    jest
      .spyOn(service, "executeQuery")
      .mockImplementation((statement: Statement | string) => {
        statements.push(statement as Statement);

        return Promise.resolve({
          json: () => {
            return Promise.resolve({ data: rows });
          },
        } as never);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a list", () => {
    test("a select of a column the member may not read is refused", async () => {
      await expect(
        service.findBy({
          query: {},
          select: { retentionDate: true },
          limit: 10,
          skip: 0,
          props: memberProps(),
        }),
      ).rejects.toThrow(new NotAuthorizedException(RETENTION_DATE_REFUSAL));

      expect(statements).toHaveLength(0);
    });

    test("a group by of that column is refused the same way, before any statement runs", async () => {
      rows = [{ retentionDate: "2026-12-01" }];

      await expect(
        service.findBy({
          query: {},
          select: { severityText: true },
          groupBy: { retentionDate: true },
          limit: 10,
          skip: 0,
          props: memberProps(),
        }),
      ).rejects.toThrow(new NotAuthorizedException(RETENTION_DATE_REFUSAL));

      expect(statements).toHaveLength(0);
    });

    test("a group by with no select is refused too", async () => {
      await expect(
        service.findBy({
          query: {},
          groupBy: { retentionDate: true },
          limit: 10,
          skip: 0,
          props: memberProps(),
        }),
      ).rejects.toThrow(new NotAuthorizedException(RETENTION_DATE_REFUSAL));

      expect(statements).toHaveLength(0);
    });

    test("one unreadable column among readable ones refuses the group by", async () => {
      await expect(
        service.findBy({
          query: {},
          groupBy: { severityText: true, retentionDate: true },
          limit: 10,
          skip: 0,
          props: memberProps(),
        }),
      ).rejects.toThrow(new NotAuthorizedException(RETENTION_DATE_REFUSAL));

      expect(statements).toHaveLength(0);
    });

    test("a member who may not read Logs at all is refused before the columns are looked at", async () => {
      await expect(
        service.findBy({
          query: {},
          groupBy: { severityText: true },
          limit: 10,
          skip: 0,
          props: memberProps([Permission.ReadProjectIncident]),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);

      expect(statements).toHaveLength(0);
    });

    test("a group by of columns the member may read selects and groups by them", async () => {
      rows = [{ severityText: "Error" }, { severityText: "Info" }];

      const logs: Array<Log> = await service.findBy({
        query: {},
        select: { body: true },
        groupBy: { severityText: true },
        limit: 10,
        skip: 0,
        props: memberProps(),
      });

      expect(statements).toHaveLength(1);

      const sql: string = sqlOf(statements[0]!);
      expect(sql).toContain("SELECT severityText FROM");
      expect(sql).toContain("GROUP BY severityText");
      expect(sql).not.toContain("retentionDate FROM");

      expect(
        logs.map((log: Log): string | undefined => {
          return log.severityText;
        }),
      ).toEqual(["Error", "Info"]);
    });

    test("ids and creation times stay readable to a group by, as to a select", async () => {
      await service.findBy({
        query: {},
        groupBy: { _id: true, createdAt: true },
        limit: 10,
        skip: 0,
        props: memberProps(),
      });

      expect(statements).toHaveLength(1);
      expect(sqlOf(statements[0]!)).toContain("GROUP BY _id, createdAt");
    });

    test("a key that is not a column is refused with the error it always got", async () => {
      const refusal: Promise<Array<Log>> = service.findBy({
        query: {},
        groupBy: { notAColumn: true } as never,
        limit: 10,
        skip: 0,
        props: memberProps(),
      });

      await expect(refusal).rejects.toThrow(
        new BadDataException("Unknown column: notAColumn"),
      );
      expect(statements).toHaveLength(0);
    });

    test("the server itself still groups by any column", async () => {
      rows = [{ retentionDate: "2026-12-01" }];

      await service.findBy({
        query: { projectId: PROJECT_ID },
        groupBy: { retentionDate: true },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      });

      expect(statements).toHaveLength(1);
      expect(sqlOf(statements[0]!)).toContain("GROUP BY retentionDate");
    });
  });

  describe("a count", () => {
    test("a count of the distinct values of a column the member may not read is refused", async () => {
      rows = [{ count: 3 }];

      await expect(
        service.countBy({
          query: {},
          groupBy: { retentionDate: true },
          props: memberProps(),
        }),
      ).rejects.toThrow(new NotAuthorizedException(RETENTION_DATE_REFUSAL));

      expect(statements).toHaveLength(0);
    });

    test("a count of the distinct values of a column the member may read runs", async () => {
      rows = [{ count: 3 }];

      const count: number = (
        await service.countBy({
          query: {},
          groupBy: { severityText: true },
          props: memberProps(),
        })
      ).toNumber();

      expect(count).toBe(3);
      expect(statements).toHaveLength(1);
      expect(sqlOf(statements[0]!)).toContain("count(DISTINCT severityText)");
    });

    test("a count without a group by reads no column and is not refused", async () => {
      rows = [{ count: 12 }];

      const count: number = (
        await service.countBy({
          query: {},
          props: memberProps(),
        })
      ).toNumber();

      expect(count).toBe(12);
      expect(statements).toHaveLength(1);
    });
  });

  describe("an aggregate", () => {
    const aggregateOf: (
      groupBy: JSONObject | undefined,
      props: DatabaseCommonInteractionProps,
    ) => Parameters<AnalyticsDatabaseService<Log>["aggregateBy"]>[0] = (
      groupBy: JSONObject | undefined,
      props: DatabaseCommonInteractionProps,
    ): Parameters<AnalyticsDatabaseService<Log>["aggregateBy"]>[0] => {
      return {
        query: {},
        aggregationType: AggregationType.Count,
        aggregateColumnName: "severityNumber",
        aggregationTimestampColumnName: "time",
        startTimestamp: new Date("2026-11-01T00:00:00.000Z"),
        endTimestamp: new Date("2026-11-02T00:00:00.000Z"),
        groupBy: groupBy as never,
        limit: 10,
        skip: 0,
        props: props,
      };
    };

    test("an aggregate grouped by a column the member may not read is refused", async () => {
      rows = [
        {
          time: "2026-11-01T00:00:00.000Z",
          severityNumber: 4,
          retentionDate: "2026-12-01",
        },
      ];

      await expect(
        service.aggregateBy(
          aggregateOf({ retentionDate: true }, memberProps()),
        ),
      ).rejects.toThrow(new NotAuthorizedException(RETENTION_DATE_REFUSAL));

      expect(statements).toHaveLength(0);
    });

    test("an aggregate grouped by a column the member may read carries it on every row", async () => {
      rows = [
        {
          time: "2026-11-01T00:00:00.000Z",
          severityNumber: 4,
          severityText: "Error",
        },
      ];

      const result: Awaited<
        ReturnType<AnalyticsDatabaseService<Log>["aggregateBy"]>
      > = await service.aggregateBy(
        aggregateOf({ severityText: true }, memberProps()),
      );

      expect(statements).toHaveLength(1);
      expect(sqlOf(statements[0]!)).toContain(", severityText FROM");
      expect(result.data[0]!["severityText"]).toBe("Error");
    });
  });
});

// A service whose ClickHouse answers every read with no rows.
function serviceWithNoRows<TBaseModel extends AnalyticsBaseModel>(modelType: {
  new (): TBaseModel;
}): AnalyticsDatabaseService<TBaseModel> {
  const service: AnalyticsDatabaseService<TBaseModel> =
    new AnalyticsDatabaseService<TBaseModel>({ modelType: modelType });

  jest.spyOn(service, "executeQuery").mockResolvedValue({
    json: () => {
      return Promise.resolve({ data: [] });
    },
  } as never);

  return service;
}

// What a read was refused with, or null when it ran.
async function refusalOf(read: Promise<unknown>): Promise<string | null> {
  try {
    await read;
    return null;
  } catch (error) {
    return `${(error as Error).constructor.name}: ${(error as Error).message}`;
  }
}

describe("A column a role may not read is refused to its group by", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a Telemetry Admin may group sessions by browser, not by the person they belong to", async () => {
    const service: AnalyticsDatabaseService<RumSession> =
      serviceWithNoRows(RumSession);
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.TelemetryAdmin,
    ]);

    await expect(
      service.findBy({
        query: {},
        groupBy: { browserName: true },
        limit: 10,
        skip: 0,
        props: props,
      }),
    ).resolves.toEqual([]);

    await expect(
      service.findBy({
        query: {},
        groupBy: { identifiedUserLabel: true },
        limit: 10,
        skip: 0,
        props: props,
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        ColumnRefusalMessage.getSelectRefusal({
          column: "identifiedUserLabel",
          permissions: new RumSession().getTableColumn("identifiedUserLabel")!
            .accessControl!.read,
        }),
      ),
    );
  });
});

/*
 * The rule on every telemetry table, for every role its table lets read it:
 * a group by of a column is refused exactly when a select of the column is,
 * with the same refusal. It holds for the columns a table has now and for
 * the ones it gets later.
 */
describe("Every telemetry table refuses a group by exactly where it refuses a select", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(
    AnalyticsModels.map(
      (modelType: AnalyticsBaseModelType): [string, AnalyticsBaseModelType] => {
        return [new modelType().tableName, modelType];
      },
    ),
  )("%s", async (_tableName: string, modelType: AnalyticsBaseModelType) => {
    const model: AnalyticsBaseModel = new modelType();
    const service: AnalyticsDatabaseService<AnalyticsBaseModel> =
      serviceWithNoRows(modelType);

    for (const permission of model.accessControl?.read || []) {
      const props: DatabaseCommonInteractionProps = memberProps([permission]);
      let selectsThatRan: number = 0;

      for (const column of model.getTableColumns()) {
        const selected: string | null = await refusalOf(
          service.findBy({
            query: {},
            select: { [column.key]: true },
            limit: 1,
            skip: 0,
            props: props,
          }),
        );

        const grouped: string | null = await refusalOf(
          service.findBy({
            query: {},
            groupBy: { [column.key]: true },
            limit: 1,
            skip: 0,
            props: props,
          }),
        );

        expect({ permission, column: column.key, refusal: grouped }).toEqual({
          permission,
          column: column.key,
          refusal: selected,
        });

        if (selected === null) {
          selectsThatRan++;
        }
      }

      // The role reads the table, so the sweep compared reads that ran.
      expect({ permission, selectsThatRan: selectsThatRan > 0 }).toEqual({
        permission,
        selectsThatRan: true,
      });
    }
  });
});
