import Alert from "../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import ColumnRefusalMessage from "../../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import { CheckReadPermissionType } from "../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import LinkedTo, {
  LINKED_TO_QUERY_KEY,
  LinkedToMatch,
} from "../../../../Types/BaseDatabase/LinkedTo";
import OwnedBy from "../../../../Types/BaseDatabase/OwnedBy";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A FILTER BY LINKED RECORDS ON ITS WAY TO THE DATABASE (#11073):
 * QueryUtil.serializeQuery turns `linkedTo` into one condition on the
 * records' ids - a subquery on each many-to-many relation's join table, a
 * comparison of the column beside the id for a relation held in a column
 * (an alert's monitorId) - OR'd for AnyOf, each one's opposite AND'd for
 * NoneOf, beside whatever else the query asks of the id. QueryPermission
 * holds each relation it names to the caller's read of that column, as a
 * filter on the column itself is held.
 *
 * The join tables are stood in for here (the relation metadata a database
 * gives); AffectedResourceFilterPostgres runs the same SQL on migrated
 * Postgres.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CHECKOUT_MONITOR: string = "6b1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const API_MONITOR: string = "7c2e3f40-5b6c-4d7e-9f80-1b2c3d4e5f60";
const WEB_HOST: string = "8d3f4051-6c7d-4e8f-a091-2c3d4e5f6071";
const INCIDENT_A: string = "9e405162-7d8e-4f90-b1a2-3d4e5f607182";

type Serialized = Record<string, any>;

// The SQL of a serialized condition on the id, as a SELECT on `table` runs it.
const sqlOf: (condition: FindOperator<any>, table: string) => string = (
  condition: FindOperator<any>,
  table: string,
): string => {
  if (condition.type === "and") {
    return (condition.value as unknown as Array<FindOperator<any>>)
      .map((child: FindOperator<any>): string => {
        return sqlOf(child, table);
      })
      .join(" AND ");
  }

  return condition.getSql!(`${table}._id`);
};

// Every value a serialized condition binds, however deep.
const parametersOf: (condition: FindOperator<any>) => Array<unknown> = (
  condition: FindOperator<any>,
): Array<unknown> => {
  if (condition.type === "and") {
    return (condition.value as unknown as Array<FindOperator<any>>).flatMap(
      parametersOf,
    );
  }

  return Object.values(condition.objectLiteralParameters || {});
};

// Each many-to-many relation's join table, as the database's metadata names it.
const JOIN_TABLES: Record<
  string,
  { joinTableName: string; ownerColumnName: string; relationColumnName: string }
> = {
  monitors: {
    joinTableName: "IncidentMonitor",
    ownerColumnName: "incidentId",
    relationColumnName: "monitorId",
  },
  hosts: {
    joinTableName: "IncidentHost",
    ownerColumnName: "incidentId",
    relationColumnName: "hostId",
  },
};

const RELATED_TABLES: Record<string, string> = {
  monitors: "Monitor",
  hosts: "Host",
};

const errorOf: (run: () => unknown) => Error | undefined = (
  run: () => unknown,
): Error | undefined => {
  try {
    run();
  } catch (error) {
    return error as Error;
  }

  return undefined;
};

const serialize: <T extends BaseModel>(
  modelType: { new (): T },
  query: Record<string, unknown>,
) => Serialized = <T extends BaseModel>(
  modelType: { new (): T },
  query: Record<string, unknown>,
): Serialized => {
  return QueryUtil.serializeQuery(modelType, query as Query<T>);
};

describe("QueryUtil.serializeQuery - a filter by linked records (#11073)", () => {
  beforeEach(() => {
    jest.spyOn(QueryUtil, "getManyToManyRelationMetadata").mockImplementation(((
      _modelType: unknown,
      relation: string,
    ) => {
      return JOIN_TABLES[relation] || null;
    }) as never);
    jest.spyOn(QueryUtil, "getManyToManyRelatedTable").mockImplementation(((
      _modelType: unknown,
      relation: string,
    ) => {
      return RELATED_TABLES[relation]
        ? {
            tableName: RELATED_TABLES[relation]!,
            columnName: "_id",
            deleteDateColumnName: "deletedAt",
          }
        : null;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is no column: the key goes, and the records' ids carry the condition", () => {
    const result: Serialized = serialize(Incident, {
      projectId: PROJECT_ID,
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        relations: { monitors: [CHECKOUT_MONITOR] },
      }),
    });

    expect(result[LINKED_TO_QUERY_KEY]).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(["_id", "projectId"]);
    expect(result["_id"].type).toBe("and");
    expect(sqlOf(result["_id"], "Incident")).toMatch(
      /^\(\(Incident\._id IN \(SELECT "IncidentMonitor"\."incidentId" FROM "IncidentMonitor" WHERE "IncidentMonitor"\."monitorId" IN \(SELECT "Monitor"\."_id" FROM "Monitor" WHERE "Monitor"\."_id" IN \(:\.\.\.\w+\) AND "Monitor"\."deletedAt" IS NULL\)\)\)\)$/,
    );
    expect(parametersOf(result["_id"])).toEqual([[CHECKOUT_MONITOR]]);
  });

  test("AnyOf: a record linked to any of them, through any relation named, OR'd", () => {
    const result: Serialized = serialize(Incident, {
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        relations: {
          monitors: [CHECKOUT_MONITOR, API_MONITOR],
          hosts: [WEB_HOST],
        },
      }),
    });

    const sql: string = sqlOf(result["_id"], "Incident");

    expect(sql.split(" OR ")).toHaveLength(2);
    expect(sql).toContain('FROM "IncidentMonitor"');
    expect(sql).toContain('FROM "IncidentHost"');
    expect(sql).not.toContain(" AND Incident._id");
    expect(parametersOf(result["_id"])).toEqual([
      [CHECKOUT_MONITOR, API_MONITOR],
      [WEB_HOST],
    ]);
  });

  test("NoneOf: linked to none of them through any relation - each relation's opposite, AND'd", () => {
    const result: Serialized = serialize(Incident, {
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        match: LinkedToMatch.NoneOf,
        relations: { monitors: [CHECKOUT_MONITOR], hosts: [WEB_HOST] },
      }),
    });

    const sql: string = sqlOf(result["_id"], "Incident");

    expect(sql).toMatch(
      /^\(\(Incident\._id NOT IN \(SELECT "IncidentMonitor"\."incidentId" FROM "IncidentMonitor" WHERE "IncidentMonitor"\."monitorId" IN \(SELECT "Monitor"\."_id" FROM "Monitor" WHERE "Monitor"\."_id" IN \(:\.\.\.\w+\) AND "Monitor"\."deletedAt" IS NULL\)\)\) AND \(Incident\._id NOT IN \(SELECT "IncidentHost"\."incidentId"/,
    );
    expect(sql).not.toContain(" OR ");
  });

  test("a relation held in a column (an alert's monitor) compares that column", () => {
    const anyOf: Serialized = serialize(Alert, {
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        relations: { monitorId: [CHECKOUT_MONITOR] },
      }),
    });

    expect(sqlOf(anyOf["_id"], "Alert")).toMatch(
      /^\(\("Alert"\."monitorId" IN \(:\.\.\.\w+\)\)\)$/,
    );
    expect(parametersOf(anyOf["_id"])).toEqual([[CHECKOUT_MONITOR]]);

    // An alert with no monitor is linked to none of them.
    const noneOf: Serialized = serialize(Alert, {
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        match: LinkedToMatch.NoneOf,
        relations: { monitorId: [CHECKOUT_MONITOR] },
      }),
    });

    expect(sqlOf(noneOf["_id"], "Alert")).toMatch(
      /^\(\("Alert"\."monitorId" NOT IN \(:\.\.\.\w+\) or "Alert"\."monitorId" IS NULL\)\)$/,
    );
  });

  test("a column and a join table together, on an alert", () => {
    jest.spyOn(QueryUtil, "getManyToManyRelationMetadata").mockReturnValue({
      joinTableName: "AlertHost",
      ownerColumnName: "alertId",
      relationColumnName: "hostId",
    });

    const result: Serialized = serialize(Alert, {
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        relations: { monitorId: [CHECKOUT_MONITOR], hosts: [WEB_HOST] },
      }),
    });

    const sql: string = sqlOf(result["_id"], "Alert");

    expect(sql).toContain('"Alert"."monitorId" IN (');
    expect(sql).toContain(' OR (Alert._id IN (SELECT "AlertHost"."alertId"');
  });

  describe.each(["before", "after"])(
    "beside an id filter and owners placed %s it",
    (position: string) => {
      test("all of them hold", () => {
        const linkedTo: LinkedTo = new LinkedTo({
          relations: { monitorId: [CHECKOUT_MONITOR] },
        });
        const ids: Includes = new Includes([INCIDENT_A]);
        const owners: OwnedBy = new OwnedBy({
          userIds: ["0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60"],
        });
        const query: Record<string, unknown> =
          position === "before"
            ? { _id: ids, [LINKED_TO_QUERY_KEY]: linkedTo, owners: owners }
            : { owners: owners, [LINKED_TO_QUERY_KEY]: linkedTo, _id: ids };

        const result: Serialized = serialize(Alert, query);
        const sql: string = sqlOf(result["_id"], "Alert");

        expect(result["_id"].type).toBe("and");
        expect(result["_id"].value).toHaveLength(3);
        // The list of ids first, then owners and the linked records.
        expect(sql).toMatch(/^\(Alert\._id IN \(:\.\.\.\w+\)\) AND /);
        expect(sql).toContain('"AlertOwnerUser"');
        expect(sql).toContain('"Alert"."monitorId" IN (');
      });
    },
  );

  test("goes under linkedTo, and nowhere else", () => {
    const error: Error | undefined = errorOf(() => {
      return serialize(Incident, {
        affectedResources: new LinkedTo({
          relations: { monitors: [CHECKOUT_MONITOR] },
        }),
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      `A filter by linked records goes under "linkedTo", not "affectedResources".`,
    );
  });

  test.each([
    ["a column it does not have", "nothingHere"],
    ["a column that links nothing (a date)", "createdAt"],
    ["a relation to one record, which is filtered by its id column", "monitor"],
    ["a many-to-many relation the database cannot follow", "labels"],
  ])("refuses %s", (_case: string, relation: string) => {
    const error: Error | undefined = errorOf(() => {
      return serialize(Alert, {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { [relation]: [CHECKOUT_MONITOR] },
        }),
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      `"${relation}" is not a relation "linkedTo" can filter Alerts by: a list of linked records (such as "monitors") or the ID of one (such as "monitorId").`,
    );
  });

  test("is refused inside a filter on a related record", () => {
    const error: Error | undefined = errorOf(() => {
      return serialize(Alert, {
        monitor: {
          [LINKED_TO_QUERY_KEY]: new LinkedTo({
            relations: { labels: [CHECKOUT_MONITOR] },
          }),
        },
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain("is by linked records");
  });
});

describe("QueryPermission - each relation a LinkedTo names is a column the caller reads", () => {
  const caller: (
    permissions: Array<Permission>,
  ) => DatabaseCommonInteractionProps = (
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps => {
    return {
      ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
      ...ON_HIGHEST_PLAN,
    };
  };

  const checkRead: (
    modelType: { new (): BaseModel },
    query: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ) => Promise<CheckReadPermissionType<BaseModel>> = async (
    modelType: { new (): BaseModel },
    query: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<CheckReadPermissionType<BaseModel>> => {
    return await ModelPermission.checkReadQueryPermission<BaseModel>(
      modelType,
      query as Query<BaseModel>,
      { _id: true },
      props,
    );
  };

  const refusalOf: (
    modelType: { new (): BaseModel },
    query: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ) => Promise<Error | null> = async (
    modelType: { new (): BaseModel },
    query: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Error | null> => {
    try {
      await checkRead(modelType, query, props);
      return null;
    } catch (error) {
      return error as Error;
    }
  };

  test("a reader of alerts filters them by their monitor, and the read carries the condition", async () => {
    const result: CheckReadPermissionType<BaseModel> = await checkRead(
      Alert,
      {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { monitorId: [CHECKOUT_MONITOR] },
        }),
      },
      caller([Permission.ReadAlert]),
    );

    const query: Record<string, unknown> = result.query as Record<
      string,
      unknown
    >;

    expect(query[LINKED_TO_QUERY_KEY]).toBeUndefined();
    expect(sqlOf(query["_id"] as FindOperator<any>, "Alert")).toContain(
      '"Alert"."monitorId" IN (',
    );
    // The tenant's own records, still.
    expect(query["projectId"]).toBeDefined();
  });

  test("a column the caller may not read is refused, in the words a filter on it gets", async () => {
    const error: Error | null = await refusalOf(
      Incident,
      {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { aiInvestigationWaitUntil: [CHECKOUT_MONITOR] },
        }),
      },
      caller([Permission.ReadProjectIncident]),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error?.message).toBe(
      ColumnRefusalMessage.getQueryRefusal({
        column: "aiInvestigationWaitUntil",
        permissions: [],
      }),
    );
  });

  test("a column the record does not have is refused as one", async () => {
    const error: Error | null = await refusalOf(
      Incident,
      {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { nothingHere: [CHECKOUT_MONITOR] },
        }),
      },
      caller([Permission.ReadProjectIncident]),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      "Invalid column on Incident - nothingHere. Column does not exist.",
    );
  });

  test("a filter under another key is refused before anything is read", async () => {
    const error: Error | null = await refusalOf(
      Alert,
      {
        affectedResources: new LinkedTo({
          relations: { monitorId: [CHECKOUT_MONITOR] },
        }),
      },
      caller([Permission.ReadAlert]),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      `A filter by linked records goes under "linkedTo", not "affectedResources".`,
    );
  });

  test("whoever may not read the records is refused them, filter or not", async () => {
    const error: Error | null = await refusalOf(
      Alert,
      {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { monitorId: [CHECKOUT_MONITOR] },
        }),
      },
      caller([Permission.ReadProjectIncident]),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });
});
