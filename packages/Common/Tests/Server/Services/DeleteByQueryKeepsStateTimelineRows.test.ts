import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import NetworkSiteStatusTimelineService from "../../../Server/Services/NetworkSiteStatusTimelineService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import StateTimelineRowsKept from "../../../Server/Utils/Database/StateTimelineRowsKept";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { KEPT_STATUS_HISTORY_DAYS } from "../../../Types/StateTimeline/RowsKeptOnDelete";
import UserType from "../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  RowsCallerMayWriteRead,
  stubRowsCallerMayDelete,
} from "../TestingUtils/RowsCallerMayWrite";
import { FindOperator } from "typeorm";

/*
 * EVERY DELETE BY QUERY OF A STATE TIMELINE LEAVES WHAT THE TABLE KEEPS, AND
 * IS NARROWED BEFORE ANY OF ITS ROWS IS READ.
 *
 * A service declares the rows a clean-up must never take
 * (DatabaseService.keepRowsOnDeleteByQuery): each record's current row, and a
 * status timeline's last 90 days. Through every public delete - deleteBy,
 * hardDeleteBy, deleteOneBy - a delete that names its rows by a query is
 * narrowed to the rows outside them:
 *
 *   - for OneUptime and a master admin, before the hooks read the rows;
 *   - for a teammate, before the read of the rows they may delete
 *     (keepRowsCallerMayWrite), so a row that stays never takes a place in
 *     that window and a delete run again and again reaches every row it may
 *     take - the trap of a narrowing applied to a window already read;
 *
 * while a delete of one row by its id, and one that skips the hooks, are
 * left as they are, and a table that keeps nothing is never narrowed. What
 * the SQL keeps on real rows is proved on Postgres in
 * StateTimelineRowsKeptPostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9a000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "9c000000-0000-4000-8000-000000000001",
);
const ROW_ID: string = "9b000000-0000-4000-8000-00000000000a";

const TEAMMATE: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("9f000000-0000-4000-8000-000000000001"),
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      projectId: PROJECT_ID,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectAdmin,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  },
  ...ON_HIGHEST_PLAN,
};

interface Timeline {
  name: string;
  tableName: string;
  service: DatabaseService<DatabaseBaseModel>;
  parentColumn: string;
}

function asService<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
): DatabaseService<DatabaseBaseModel> {
  return service as unknown as DatabaseService<DatabaseBaseModel>;
}

const TIMELINES: Array<Timeline> = [
  {
    name: "MonitorStatusTimelineService",
    tableName: "MonitorStatusTimeline",
    service: asService(MonitorStatusTimelineService),
    parentColumn: "monitorId",
  },
  {
    name: "NetworkSiteStatusTimelineService",
    tableName: "NetworkSiteStatusTimeline",
    service: asService(NetworkSiteStatusTimelineService),
    parentColumn: "siteId",
  },
  {
    name: "IncidentStateTimelineService",
    tableName: "IncidentStateTimeline",
    service: asService(IncidentStateTimelineService),
    parentColumn: "incidentId",
  },
  {
    name: "AlertStateTimelineService",
    tableName: "AlertStateTimeline",
    service: asService(AlertStateTimelineService),
    parentColumn: "alertId",
  },
  {
    name: "ScheduledMaintenanceStateTimelineService",
    tableName: "ScheduledMaintenanceStateTimeline",
    service: asService(ScheduledMaintenanceStateTimelineService),
    parentColumn: "scheduledMaintenanceId",
  },
  {
    name: "IncidentEpisodeStateTimelineService",
    tableName: "IncidentEpisodeStateTimeline",
    service: asService(IncidentEpisodeStateTimelineService),
    parentColumn: "incidentEpisodeId",
  },
  {
    name: "AlertEpisodeStateTimelineService",
    tableName: "AlertEpisodeStateTimeline",
    service: asService(AlertEpisodeStateTimelineService),
    parentColumn: "alertEpisodeId",
  },
];

// Stops a delete once its hook was handed the query.
class Stopped extends Error {}

// The SQL a condition on the id holds, "and"s spelled out, for a table's id column.
function sqlOf(condition: unknown, columnPath: string): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<FindOperator<unknown>>)
      .map((each: FindOperator<unknown>): string => {
        return sqlOf(each, columnPath);
      })
      .join(" AND ");
  }

  return (operator.getSql as (columnPath: string) => string)(columnPath);
}

// The values a condition on the id binds, "and"s spelled out.
function parametersOf(condition: unknown): Array<unknown> {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<FindOperator<unknown>>).flatMap(
      (each: FindOperator<unknown>): Array<unknown> => {
        return parametersOf(each);
      },
    );
  }

  return Object.values(operator.objectLiteralParameters || {});
}

// The name a binding gives the oldest moment kept: a fresh one each delete.
const BOUND_PARAMETER_NAME: RegExp = /keptHistoryFrom[A-Za-z]{10}/g;

/*
 * The SQL a row that stays meets, for the table's id as TypeORM names it, with
 * the binding's parameter name written as `:from`.
 */
function keptSqlOf(timeline: Timeline, condition: unknown): string {
  return sqlOf(condition, `${timeline.tableName}._id`).replace(
    BOUND_PARAMETER_NAME,
    "from",
  );
}

function expectedKeptSql(timeline: Timeline): string {
  return StateTimelineRowsKept.forTable(timeline.tableName)
    .bind()
    .sqlForRowKept(`"${timeline.tableName}"`)
    .replace(BOUND_PARAMETER_NAME, "from");
}

// The query a service's onBeforeDelete is handed, for one delete.
async function queryTheHookIsHanded(
  timeline: Timeline,
  run: () => Promise<number>,
): Promise<JSONObject> {
  const handed: Array<JSONObject> = [];

  jest
    .spyOn(
      timeline.service as unknown as {
        onBeforeDelete: (deleteBy: DeleteBy<DatabaseBaseModel>) => unknown;
      },
      "onBeforeDelete",
    )
    .mockImplementation(
      async (deleteBy: DeleteBy<DatabaseBaseModel>): Promise<never> => {
        handed.push({ ...(deleteBy.query as JSONObject) });
        throw new Stopped();
      },
    );

  await expect(run()).rejects.toBeDefined();
  expect(handed.length).toBe(1);

  return handed[0]!;
}

describe.each(TIMELINES)("$name", (timeline: Timeline) => {
  const service: DatabaseService<DatabaseBaseModel> = timeline.service;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("declares the rule of its table", () => {
    expect(service.getRowsKeptOnDeleteByQuery()?.tableName).toBe(
      timeline.tableName,
    );
  });

  test("OneUptime's delete by query reaches its hook narrowed to the rows outside what the table keeps", async () => {
    const asked: JSONObject = {
      [timeline.parentColumn]: RECORD_ID,
      startsAt: QueryHelper.lessThan(new Date()),
    };

    const query: JSONObject = await queryTheHookIsHanded(timeline, () => {
      return service.deleteBy({
        query: { ...asked },
        props: { isRoot: true },
        limit: 100,
        skip: 0,
      });
    });

    // The rest of the query as it was asked.
    expect(query[timeline.parentColumn]).toBe(RECORD_ID);
    expect(query["startsAt"]).toBe(asked["startsAt"]);

    // And the rows that stay left out.
    expect(keptSqlOf(timeline, query["_id"])).toBe(
      `NOT ${expectedKeptSql(timeline)}`,
    );
  });

  test("the retention job's hardDeleteBy is narrowed the same way", async () => {
    const query: JSONObject = await queryTheHookIsHanded(timeline, () => {
      return service.hardDeleteBy({
        query: { startsAt: QueryHelper.lessThan(new Date()) } as never,
        props: { isRoot: true },
        limit: 100,
        skip: 0,
      });
    });

    expect(keptSqlOf(timeline, query["_id"])).toBe(
      `NOT ${expectedKeptSql(timeline)}`,
    );
  });

  test("a delete of one row by a query is narrowed: it is a clean-up, not a correction", async () => {
    const query: JSONObject = await queryTheHookIsHanded(timeline, () => {
      return service.deleteOneBy({
        query: { [timeline.parentColumn]: RECORD_ID },
        props: { isRoot: true },
      });
    });

    expect(keptSqlOf(timeline, query["_id"])).toBe(
      `NOT ${expectedKeptSql(timeline)}`,
    );
  });

  test("keeps a condition the query already put on the id beside its own", async () => {
    const askedIds: unknown = QueryHelper.any([ROW_ID]);

    const query: JSONObject = await queryTheHookIsHanded(timeline, () => {
      return service.deleteBy({
        query: { _id: askedIds as never },
        props: { isRoot: true },
        limit: 100,
        skip: 0,
      });
    });

    const both: FindOperator<unknown> = query[
      "_id"
    ] as unknown as FindOperator<unknown>;
    expect(both.type).toBe("and");
    expect((both.value as unknown as Array<unknown>)[0]).toBe(askedIds);
    expect(keptSqlOf(timeline, both)).toContain(
      `NOT ${expectedKeptSql(timeline)}`,
    );
  });

  test("leaves a delete of one row by its id to the service's hook", async () => {
    for (const id of [ROW_ID, new ObjectID(ROW_ID)]) {
      const query: JSONObject = await queryTheHookIsHanded(timeline, () => {
        return service.deleteOneBy({
          query: { _id: id as never },
          props: { isRoot: true },
        });
      });

      expect(query).toEqual({ _id: id });
      jest.restoreAllMocks();
    }
  });

  test("a teammate's delete by query is narrowed before the read of the rows they may delete", async () => {
    const reads: Array<RowsCallerMayWriteRead> = [];

    stubRowsCallerMayDelete(service, (read: RowsCallerMayWriteRead) => {
      reads.push(read);
      return [];
    });

    // None of their rows may go: the delete removes nothing, and no hook runs.
    expect(
      await service.deleteBy({
        query: { [timeline.parentColumn]: RECORD_ID },
        props: { ...TEAMMATE },
        limit: 10,
        skip: 0,
      }),
    ).toBe(0);

    expect(reads.length).toBe(1);
    expect(reads[0]!.limit).toBe(10);
    expect(keptSqlOf(timeline, reads[0]!.query["_id"])).toBe(
      `NOT ${expectedKeptSql(timeline)}`,
    );
  });

  test("leaves a delete that skips the hooks as it is: OneUptime's own write past every rule", async () => {
    const lookups: Array<JSONObject> = [];

    jest
      .spyOn(service as unknown as { _findBy: () => unknown }, "_findBy")
      .mockImplementation((async (findBy: {
        query: JSONObject;
      }): Promise<Array<unknown>> => {
        lookups.push({ ...findBy.query });
        return [];
      }) as never);

    expect(
      await service.deleteBy({
        query: { [timeline.parentColumn]: RECORD_ID },
        props: { isRoot: true, ignoreHooks: true },
        limit: 100,
        skip: 0,
      }),
    ).toBe(0);

    expect(lookups.length).toBe(1);
    expect(lookups[0]!["_id"]).toBeUndefined();
  });

  test("counts the rows of a query that a delete by it leaves, as the caller reads them", async () => {
    const counts: Array<{
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }> = [];

    jest.spyOn(service, "countBy").mockImplementation((async (countBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }): Promise<PositiveNumber> => {
      counts.push({ query: countBy.query, props: countBy.props });
      return new PositiveNumber(4);
    }) as never);

    expect(
      await service.countRowsKeptOnDeleteByQuery({
        query: { [timeline.parentColumn]: RECORD_ID },
        props: TEAMMATE,
      }),
    ).toBe(4);

    expect(counts.length).toBe(1);
    expect(counts[0]!.props).toBe(TEAMMATE);
    expect(counts[0]!.query[timeline.parentColumn]).toBe(RECORD_ID);
    expect(keptSqlOf(timeline, counts[0]!.query["_id"])).toBe(
      expectedKeptSql(timeline),
    );
  });

  test("counts nothing for a query that names one row by its id", async () => {
    const countBy: jest.SpyInstance = jest.spyOn(service, "countBy");

    expect(
      await service.countRowsKeptOnDeleteByQuery({
        query: { _id: ROW_ID } as never,
        props: TEAMMATE,
      }),
    ).toBeNull();
    expect(countBy).not.toHaveBeenCalled();
  });
});

describe("the oldest moment a status timeline keeps", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is bound when the delete runs: 90 days before now", async () => {
    const before: number = Date.now();

    const query: JSONObject = await queryTheHookIsHanded(TIMELINES[0]!, () => {
      return MonitorStatusTimelineService.deleteBy({
        query: { monitorId: RECORD_ID },
        props: { isRoot: true },
        limit: 100,
        skip: 0,
      });
    });

    const bound: Array<unknown> = parametersOf(query["_id"]);
    expect(bound.length).toBe(1);

    const from: number = (bound[0] as Date).getTime();
    const span: number = KEPT_STATUS_HISTORY_DAYS * 24 * 60 * 60 * 1000;

    // Within the test's own run of the clock, and an hour for a daylight saving change.
    expect(from).toBeGreaterThanOrEqual(before - span - 60 * 60 * 1000);
    expect(from).toBeLessThanOrEqual(Date.now() - span + 60 * 60 * 1000);
  });
});

describe("a table that keeps nothing from a delete", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("declares no rule, is never narrowed and counts nothing", async () => {
    expect(MonitorFeedService.getRowsKeptOnDeleteByQuery()).toBeNull();

    const lookups: Array<JSONObject> = [];

    jest
      .spyOn(
        MonitorFeedService as unknown as { _findBy: () => unknown },
        "_findBy",
      )
      .mockImplementation((async (findBy: {
        query: JSONObject;
      }): Promise<Array<unknown>> => {
        lookups.push({ ...findBy.query });
        return [];
      }) as never);

    await MonitorFeedService.deleteBy({
      query: { monitorId: RECORD_ID },
      props: { isRoot: true, ignoreHooks: true },
      limit: 100,
      skip: 0,
    });

    expect(lookups[0]!["_id"]).toBeUndefined();

    expect(
      await MonitorFeedService.countRowsKeptOnDeleteByQuery({
        query: { monitorId: RECORD_ID },
        props: TEAMMATE,
      }),
    ).toBeNull();
  });
});
