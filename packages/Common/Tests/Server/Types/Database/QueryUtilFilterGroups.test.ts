import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import Incident from "../../../../Models/DatabaseModels/Incident";
import UserSMS from "../../../../Models/DatabaseModels/UserSMS";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import ColumnRefusalMessage from "../../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import { CheckReadPermissionType } from "../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import FilterGroups, {
  FILTER_GROUPS_QUERY_KEY,
  FilterGroup,
  FilterGroupsMatch,
} from "../../../../Types/BaseDatabase/FilterGroups";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNoneOrNull from "../../../../Types/BaseDatabase/IncludesNoneOrNull";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LinkedTo, {
  LINKED_TO_QUERY_KEY,
} from "../../../../Types/BaseDatabase/LinkedTo";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "../../../../Types/BaseDatabase/NotEqualOrNull";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import OwnedBy from "../../../../Types/BaseDatabase/OwnedBy";
import TableAccessControl from "../../../../Types/Database/AccessControl/TableAccessControl";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A FILTER OF SEVERAL GROUPS ON ITS WAY TO THE DATABASE (#11211):
 * QueryUtil.serializeQuery turns `filterGroups` into one condition on the
 * row - each group's conditions on the record's own columns ANDed, as each
 * is written on its own, the groups OR'd for AnyOf, and for NoneOf the
 * records the groups are not true of, an empty column's included. The
 * Databases list's Engine Metrics chip and All Environments' Status chip
 * write it: a status read from two columns. QueryPermission holds each
 * column a group names to the caller's read of it, as a filter on the
 * column itself is held.
 *
 * ListFiltersPastTheCapPostgres runs the same SQL on migrated Postgres.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: string = "6b1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const DATABASE_ID: string = "7c2e3f40-5b6c-4d7e-9f80-1b2c3d4e5f60";

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

  return condition.getSql!(`"${table}"."_id"`);
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

/*
 * The SQL with each bound parameter written as its value, so a test reads
 * the condition the way Postgres is handed it.
 */
const boundSqlOf: (condition: FindOperator<any>, table: string) => string = (
  condition: FindOperator<any>,
  table: string,
): string => {
  const parameters: Record<string, unknown> = {};

  const collect: (operator: FindOperator<any>) => void = (
    operator: FindOperator<any>,
  ): void => {
    if (operator.type === "and") {
      for (const child of operator.value as unknown as Array<
        FindOperator<any>
      >) {
        collect(child);
      }

      return;
    }

    Object.assign(parameters, operator.objectLiteralParameters || {});
  };

  collect(condition);

  return sqlOf(condition, table).replace(
    /:(\.\.\.)?(\w+)/g,
    (match: string, spread: string | undefined, name: string): string => {
      if (!(name in parameters)) {
        return match;
      }

      const value: unknown = parameters[name];

      if (!Array.isArray(value)) {
        return `'${String(value)}'`;
      }

      // `:...name` is spread into the parentheses the SQL already has.
      const list: string = value
        .map((item: unknown): string => {
          return `'${String(item)}'`;
        })
        .join(", ");

      return spread ? list : `(${list})`;
    },
  );
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

// A database's three engine-metrics statuses, as the Databases chip writes them.
const CONNECTED: FilterGroup = { otelCollectorStatus: "connected" };
const DISCONNECTED: FilterGroup = {
  otelCollectorStatus: new NotEqualOrNull("connected"),
  collectorLastSeenAt: new NotNull(),
};
const NOT_CONNECTED: FilterGroup = {
  otelCollectorStatus: new NotEqualOrNull("connected"),
  collectorLastSeenAt: new IsNull(),
};

describe("QueryUtil.serializeQuery - a filter of several groups (#11211)", () => {
  test("is no column: the key goes, and the records' rows carry the condition", () => {
    const result: Serialized = serialize(DatabaseServer, {
      projectId: PROJECT_ID,
      [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({ groups: [CONNECTED] }),
    });

    expect(result[FILTER_GROUPS_QUERY_KEY]).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(["_id", "projectId"]);
    expect(result["_id"].type).toBe("and");
    expect(sqlOf(result["_id"], "DatabaseServer")).toMatch(
      /^\(\(\("DatabaseServer"\."otelCollectorStatus" = :\w+\)\)\)$/,
    );
    expect(parametersOf(result["_id"])).toEqual(["connected"]);
  });

  test("AnyOf: each group's conditions ANDed, the groups OR'd", () => {
    const result: Serialized = serialize(DatabaseServer, {
      [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
        groups: [CONNECTED, NOT_CONNECTED],
      }),
    });

    expect(boundSqlOf(result["_id"], "DatabaseServer")).toBe(
      `((("DatabaseServer"."otelCollectorStatus" = 'connected')) OR (("DatabaseServer"."otelCollectorStatus" != 'connected' OR "DatabaseServer"."otelCollectorStatus" IS NULL) AND ("DatabaseServer"."collectorLastSeenAt" IS NULL)))`,
    );
  });

  test("NoneOf: the records no group is true of - an empty column's kept, never dropped as NULL", () => {
    const result: Serialized = serialize(DatabaseServer, {
      [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
        match: FilterGroupsMatch.NoneOf,
        groups: [CONNECTED],
      }),
    });

    /*
     * NOT of `status = 'connected'` is NULL for a row with no status, and
     * a NULL condition drops the row: IS NOT TRUE keeps it.
     */
    expect(boundSqlOf(result["_id"], "DatabaseServer")).toBe(
      `(((("DatabaseServer"."otelCollectorStatus" = 'connected'))) IS NOT TRUE)`,
    );
  });

  test("NoneOf of several groups: not any of them", () => {
    const result: Serialized = serialize(DatabaseServer, {
      [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
        match: FilterGroupsMatch.NoneOf,
        groups: [DISCONNECTED, NOT_CONNECTED],
      }),
    });

    const sql: string = boundSqlOf(result["_id"], "DatabaseServer");

    expect(sql.startsWith("((")).toBe(true);
    expect(sql.endsWith(") IS NOT TRUE)")).toBe(true);
    expect(sql).toContain(") OR (");
    expect(sql).toContain(`"DatabaseServer"."collectorLastSeenAt" IS NOT NULL`);
    expect(sql).toContain(`"DatabaseServer"."collectorLastSeenAt" IS NULL`);
  });

  test.each([
    [
      "text, as the column holding it",
      { dbSystem: "postgresql" },
      `"DatabaseServer"."dbSystem" = 'postgresql'`,
    ],
    [
      "a number",
      { serverPort: 5432 },
      `"DatabaseServer"."serverPort" = '5432'`,
    ],
    [
      "a switch",
      { isArchived: false },
      `"DatabaseServer"."isArchived" = 'false'`,
    ],
    [
      "an id",
      { kubernetesClusterId: new ObjectID(CLUSTER_ID) },
      `"DatabaseServer"."kubernetesClusterId" = '${CLUSTER_ID}'`,
    ],
    [
      "EqualTo",
      { dbSystem: new EqualTo("mysql") },
      `"DatabaseServer"."dbSystem" = 'mysql'`,
    ],
    [
      "EqualToOrNull",
      { otelCollectorStatus: new EqualToOrNull("disconnected") },
      `"DatabaseServer"."otelCollectorStatus" = 'disconnected' or "DatabaseServer"."otelCollectorStatus" IS NULL`,
    ],
    [
      "NotEqual",
      { otelCollectorStatus: new NotEqual("connected") },
      `"DatabaseServer"."otelCollectorStatus" != 'connected'`,
    ],
    [
      "NotEqualOrNull",
      { otelCollectorStatus: new NotEqualOrNull("connected") },
      `"DatabaseServer"."otelCollectorStatus" != 'connected' OR "DatabaseServer"."otelCollectorStatus" IS NULL`,
    ],
    [
      "IsNull",
      { collectorLastSeenAt: new IsNull() },
      `"DatabaseServer"."collectorLastSeenAt" IS NULL`,
    ],
    [
      "NotNull",
      { collectorLastSeenAt: new NotNull() },
      `"DatabaseServer"."collectorLastSeenAt" IS NOT NULL`,
    ],
    [
      "Includes",
      { dbSystem: new Includes(["postgresql", "mysql"]) },
      `"DatabaseServer"."dbSystem" IN ('postgresql', 'mysql')`,
    ],
    [
      "IncludesNoneOrNull",
      { dbSystem: new IncludesNoneOrNull(["redis"]) },
      `"DatabaseServer"."dbSystem" NOT IN ('redis') or "DatabaseServer"."dbSystem" IS NULL`,
    ],
  ])(
    "writes %s as a filter on that column alone writes it",
    (_case: string, group: Record<string, unknown>, condition: string) => {
      const result: Serialized = serialize(DatabaseServer, {
        [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
          groups: [group as FilterGroup],
        }),
      });

      expect(boundSqlOf(result["_id"], "DatabaseServer")).toContain(condition);
    },
  );

  test("an id column holds an id: anything else is refused, as a filter on the column is", () => {
    const error: Error | undefined = errorOf(() => {
      return serialize(DatabaseServer, {
        [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
          groups: [{ kubernetesClusterId: "checkout-cluster" }],
        }),
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
  });

  test("an id written in capitals is still an id, bound as it was written", () => {
    // Postgres reads a uuid in either case as the same uuid.
    const result: Serialized = serialize(DatabaseServer, {
      [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
        groups: [{ kubernetesClusterId: CLUSTER_ID.toUpperCase() }],
      }),
    });

    expect(parametersOf(result["_id"])).toEqual([CLUSTER_ID.toUpperCase()]);
  });

  test("a date is bound as the instant it is", () => {
    const seenAt: Date = new Date("2026-11-27T10:15:30.123Z");

    const result: Serialized = serialize(DatabaseServer, {
      [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
        groups: [{ collectorLastSeenAt: new EqualTo(seenAt) }],
      }),
    });

    const [bound] = parametersOf(result["_id"]) as [unknown];

    expect(new Date(bound as string).toISOString()).toBe(seenAt.toISOString());
  });

  describe.each(["before", "after"])(
    "beside an id filter, owners and linked records placed %s it",
    (position: string) => {
      test("all of them hold", () => {
        const groups: FilterGroups = new FilterGroups({
          groups: [CONNECTED, NOT_CONNECTED],
        });
        const ids: Includes = new Includes([DATABASE_ID]);
        const owners: OwnedBy = new OwnedBy({
          userIds: ["0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60"],
        });
        const query: Record<string, unknown> =
          position === "before"
            ? { _id: ids, [FILTER_GROUPS_QUERY_KEY]: groups, owners: owners }
            : { owners: owners, [FILTER_GROUPS_QUERY_KEY]: groups, _id: ids };

        const result: Serialized = serialize(DatabaseServer, query);
        const sql: string = sqlOf(result["_id"], "DatabaseServer");

        expect(result["_id"].type).toBe("and");
        expect(result["_id"].value).toHaveLength(3);
        // The list of ids first, then the owners and the groups.
        expect(sql).toMatch(
          /^\("DatabaseServer"\."_id" IN \(:\.\.\.\w+\)\) AND /,
        );
        expect(sql).toContain('"DatabaseServerOwnerUser"');
        expect(sql).toContain(`"DatabaseServer"."otelCollectorStatus" = :`);
      });
    },
  );

  test("beside the record's own filters, which stay as they were", () => {
    const result: Serialized = serialize(DatabaseServer, {
      projectId: PROJECT_ID,
      isArchived: false,
      [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({ groups: [CONNECTED] }),
    });

    expect(result["isArchived"]).toBe(false);
    expect(result["projectId"]).toBeDefined();
  });

  test("goes under filterGroups, and nowhere else", () => {
    const error: Error | undefined = errorOf(() => {
      return serialize(DatabaseServer, {
        engineMetrics: new FilterGroups({ groups: [CONNECTED] }),
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      `A filter of several groups goes under "filterGroups", not "engineMetrics".`,
    );
  });

  test("refuses a column the record does not have", () => {
    const error: Error | undefined = errorOf(() => {
      return serialize(DatabaseServer, {
        [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
          groups: [{ nothingHere: "x" }],
        }),
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      `"nothingHere" is not a column "filterGroups" can filter Databases by.`,
    );
  });

  test.each([
    ["a related record", "project", new ObjectID(PROJECT_ID)],
    ["a list of related records", "labels", new IsNull()],
    ["a JSON column", "engineReadings", new IsNull()],
  ])("refuses %s", (_case: string, column: string, value: unknown) => {
    const error: Error | undefined = errorOf(() => {
      return serialize(DatabaseServer, {
        [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
          groups: [{ [column]: value as never }],
        }),
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      `"${column}" is not a column "filterGroups" can filter Databases by: a group compares the record's own columns, never related records or JSON.`,
    );
  });

  test("is refused inside a filter on a related record", () => {
    const error: Error | undefined = errorOf(() => {
      return serialize(DatabaseServer, {
        kubernetesCluster: {
          [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
            groups: [{ name: "checkout" }],
          }),
        },
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain("is one of several filters");
  });

  test("leaves the filter it was handed as it was", () => {
    const groups: FilterGroups = new FilterGroups({
      groups: [CONNECTED, DISCONNECTED],
    });

    serialize(DatabaseServer, { [FILTER_GROUPS_QUERY_KEY]: groups });
    serialize(DatabaseServer, { [FILTER_GROUPS_QUERY_KEY]: groups });

    expect(groups.groups[0]).toEqual({ otelCollectorStatus: "connected" });
    expect(groups.groups[1]!["otelCollectorStatus"]).toBeInstanceOf(
      NotEqualOrNull,
    );
    expect(groups.groups[1]!["collectorLastSeenAt"]).toBeInstanceOf(NotNull);
  });

  test("two filters of the same groups bind their values under names of their own", () => {
    const result: Serialized = serialize(DatabaseServer, {
      [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
        groups: [CONNECTED, { otelCollectorStatus: "connected" }],
      }),
    });

    const names: Array<string> = Object.keys(
      (result["_id"].value as Array<FindOperator<any>>)[0]!
        .objectLiteralParameters || {},
    );

    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });
});

/*
 * UserSMS with its table readable by a project admin: the column a group
 * names is a person's phone, which only a read pinned to its owner may
 * filter by (OwnerOnlyColumnPermission, route 4).
 */
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser, Permission.ProjectAdmin],
  update: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
})
class AdminReadableUserSMS extends UserSMS {}

describe("QueryPermission - each column a group names is a column the caller reads", () => {
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

  test("a reader of databases filters them by their engine-metrics status, and the read carries the condition", async () => {
    const result: CheckReadPermissionType<BaseModel> = await checkRead(
      DatabaseServer,
      {
        [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
          groups: [CONNECTED, NOT_CONNECTED],
        }),
      },
      caller([Permission.ReadDatabaseServer]),
    );

    const query: Record<string, unknown> = result.query as Record<
      string,
      unknown
    >;

    expect(query[FILTER_GROUPS_QUERY_KEY]).toBeUndefined();
    expect(
      sqlOf(query["_id"] as FindOperator<any>, "DatabaseServer"),
    ).toContain(`"DatabaseServer"."collectorLastSeenAt" IS NULL`);
    // The tenant's own records, still.
    expect(query["projectId"]).toBeDefined();
  });

  test("a column the caller may not read is refused, in the words a filter on it gets", async () => {
    const error: Error | null = await refusalOf(
      Incident,
      {
        [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
          groups: [
            { title: "Checkout is down" },
            { aiInvestigationWaitUntil: new IsNull() },
          ],
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
      DatabaseServer,
      {
        [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
          groups: [CONNECTED, { nothingHere: "x" }],
        }),
      },
      caller([Permission.ReadDatabaseServer]),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      "Invalid column on Database - nothingHere. Column does not exist.",
    );
  });

  test("a filter under another key is refused before anything is read", async () => {
    const error: Error | null = await refusalOf(
      DatabaseServer,
      { engineMetrics: new FilterGroups({ groups: [CONNECTED] }) },
      caller([Permission.ReadDatabaseServer]),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      `A filter of several groups goes under "filterGroups", not "engineMetrics".`,
    );
  });

  test("whoever may not read the records is refused them, filter or not", async () => {
    const error: Error | null = await refusalOf(
      DatabaseServer,
      { [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({ groups: [CONNECTED] }) },
      caller([Permission.ReadProjectIncident]),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });

  test("beside linked records, each is held to its own read", async () => {
    const result: CheckReadPermissionType<BaseModel> = await checkRead(
      DatabaseServer,
      {
        [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({ groups: [CONNECTED] }),
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { kubernetesClusterId: [CLUSTER_ID] },
        }),
      },
      caller([Permission.ReadDatabaseServer]),
    );

    const sql: string = sqlOf(
      (result.query as Record<string, unknown>)["_id"] as FindOperator<any>,
      "DatabaseServer",
    );

    expect(sql).toContain(`"DatabaseServer"."otelCollectorStatus" = :`);
    expect(sql).toContain(`"DatabaseServer"."kubernetesClusterId" IN (`);
  });

  describe("a column only its owner may filter by", () => {
    const ownerUserId: ObjectID = ObjectID.generate();
    const adminUserId: ObjectID = ObjectID.generate();

    const adminProps: () => DatabaseCommonInteractionProps =
      (): DatabaseCommonInteractionProps => {
        return {
          userId: adminUserId,
          tenantId: PROJECT_ID,
          userTenantAccessPermission: {
            [PROJECT_ID.toString()]: {
              projectId: PROJECT_ID,
              permissions: [
                {
                  permission: Permission.ProjectAdmin,
                  labelIds: [],
                  isBlockPermission: false,
                  _type: "UserPermission",
                },
              ],
              _type: "UserTenantAccessPermission",
            },
          },
        };
      };

    const phoneGroups: () => FilterGroups = (): FilterGroups => {
      return new FilterGroups({
        groups: [{ isVerified: true }, { phone: "+15550100" }],
      });
    };

    test("is refused to an admin probing everyone's rows with it", async () => {
      const error: Error | null = await refusalOf(
        AdminReadableUserSMS,
        { [FILTER_GROUPS_QUERY_KEY]: phoneGroups() },
        adminProps(),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toContain("phone");
    });

    test("is refused to an admin probing another person's rows with it", async () => {
      const error: Error | null = await refusalOf(
        AdminReadableUserSMS,
        {
          userId: ownerUserId,
          [FILTER_GROUPS_QUERY_KEY]: phoneGroups(),
        },
        adminProps(),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
    });

    test("is let through on a read pinned to the caller's own rows", async () => {
      await expect(
        checkRead(
          AdminReadableUserSMS,
          {
            userId: adminUserId,
            [FILTER_GROUPS_QUERY_KEY]: phoneGroups(),
          },
          adminProps(),
        ),
      ).resolves.toBeDefined();
    });

    test("is let through to the owner, whose read is their own", async () => {
      await expect(
        checkRead(
          UserSMS,
          { [FILTER_GROUPS_QUERY_KEY]: phoneGroups() },
          { userId: ownerUserId, tenantId: PROJECT_ID },
        ),
      ).resolves.toBeDefined();
    });
  });
});
