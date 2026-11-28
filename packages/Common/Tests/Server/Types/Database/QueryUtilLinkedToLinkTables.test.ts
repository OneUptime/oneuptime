import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import UserSMS from "../../../../Models/DatabaseModels/UserSMS";
import LinkedToLinkTables, {
  LinkTableRelation,
} from "../../../../Server/Types/Database/LinkedToLinkTables";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import ColumnRefusalMessage from "../../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import { CheckReadPermissionType } from "../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LinkedTo, {
  LINKED_TO_QUERY_KEY,
  LinkedToMatch,
} from "../../../../Types/BaseDatabase/LinkedTo";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A TEAM'S MEMBERS AS A LINKEDTO RELATION (#11211).
 *
 * The Teams list's Member chip read the teams of the people picked first -
 * the first 10,000 memberships - and filtered the list by those team ids.
 * A team's members are rows of TeamMember, so LinkedTo reads them through
 * that table (LinkedToLinkTables): one subquery, `members` OR'd with any
 * other relation the filter names, NoneOf its opposite. Filtering through
 * it reads TeamMember, so it is held to TeamMember's read, never through
 * CurrentUser alone, which reads only the caller's own memberships.
 *
 * ListFiltersPastTheCapPostgres runs the same SQL on migrated Postgres,
 * with a person in 10,050 teams.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ALICE: string = "6b1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const BOB: string = "7c2e3f40-5b6c-4d7e-9f80-1b2c3d4e5f60";

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

describe("LinkedToLinkTables - the relations kept in a table of their own", () => {
  test("a team's members are TeamMember's rows, by team and by person", () => {
    expect(LinkedToLinkTables.get(Team, "members")).toEqual({
      modelType: TeamMember,
      recordColumnName: "teamId",
      linkedColumnName: "userId",
    });
  });

  test("names nothing else: another relation, or members of another kind", () => {
    expect(LinkedToLinkTables.get(Team, "owners")).toBeNull();
    expect(LinkedToLinkTables.get(Team, "teamId")).toBeNull();
    expect(LinkedToLinkTables.get(Monitor, "members")).toBeNull();
  });

  test.each(LinkedToLinkTables.getAll())(
    "$relation of $recordModelType.name: the link table names the record and what it is linked to, by id",
    (
      entry: LinkTableRelation & {
        recordModelType: { new (): BaseModel };
        relation: string;
      },
    ) => {
      const linkModel: BaseModel = new entry.modelType();
      const record: BaseModel = new entry.recordModelType();

      // No column of the record shares the relation's name: it would be read as that column.
      expect(record.getTableColumnMetadata(entry.relation)).toBeFalsy();

      for (const columnName of [
        entry.recordColumnName,
        entry.linkedColumnName,
      ]) {
        const column: TableColumnMetadata | undefined =
          linkModel.getTableColumnMetadata(columnName);

        expect(column?.type).toBe(TableColumnType.ObjectID);
      }

      // The record column is the key of the link table's relation to the record.
      const relationToRecord: Array<string> = linkModel
        .getTableColumns()
        .columns.filter((columnName: string): boolean => {
          const column: TableColumnMetadata | undefined =
            linkModel.getTableColumnMetadata(columnName);

          return (
            column?.type === TableColumnType.Entity &&
            column.manyToOneRelationColumn === entry.recordColumnName
          );
        });

      expect(relationToRecord).toHaveLength(1);
      expect(
        new (linkModel.getTableColumnMetadata(relationToRecord[0]!)!
          .modelType as { new (): BaseModel })().tableName,
      ).toBe(record.tableName);
    },
  );
});

describe("QueryUtil.serializeQuery - a team's members, through TeamMember (#11211)", () => {
  test("AnyOf: the teams one of the people picked is in, in one subquery", () => {
    const result: Serialized = serialize(Team, {
      projectId: PROJECT_ID,
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        relations: { members: [ALICE, BOB] },
      }),
    });

    expect(result[LINKED_TO_QUERY_KEY]).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(["_id", "projectId"]);
    expect(sqlOf(result["_id"], "Team")).toMatch(
      /^\(\("Team"\."_id" IN \(SELECT "(link\w+)"\."teamId" FROM "TeamMember" "\1" WHERE "\1"\."userId" IN \(:\.\.\.\w+\) AND "\1"\."teamId" IS NOT NULL AND "\1"\."deletedAt" IS NULL\)\)\)$/,
    );
    expect(parametersOf(result["_id"])).toEqual([[ALICE, BOB]]);
  });

  test("NoneOf: the teams none of them is in, a team with nobody in it among them", () => {
    const result: Serialized = serialize(Team, {
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        match: LinkedToMatch.NoneOf,
        relations: { members: [ALICE] },
      }),
    });

    const sql: string = sqlOf(result["_id"], "Team");

    expect(sql).toMatch(
      /^\(\("Team"\."_id" NOT IN \(SELECT "(link\w+)"\."teamId" FROM "TeamMember" "\1" WHERE "\1"\."userId" IN \(:\.\.\.\w+\) AND "\1"\."teamId" IS NOT NULL AND "\1"\."deletedAt" IS NULL\)\)\)$/,
    );
  });

  test("OR'd with a relation held in a column of the team", () => {
    const result: Serialized = serialize(Team, {
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        relations: { members: [ALICE], createdByUserId: [BOB] },
      }),
    });

    const sql: string = sqlOf(result["_id"], "Team");

    expect(sql).toContain(`FROM "TeamMember"`);
    expect(sql).toContain(`"Team"."createdByUserId" IN (`);
    expect(sql).toContain(") OR (");
  });

  test("NoneOf with a column too: each relation's opposite, AND'd", () => {
    const result: Serialized = serialize(Team, {
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        match: LinkedToMatch.NoneOf,
        relations: { members: [ALICE], createdByUserId: [BOB] },
      }),
    });

    const sql: string = sqlOf(result["_id"], "Team");

    expect(sql).toContain(`"Team"."_id" NOT IN (SELECT`);
    expect(sql).toContain(`"Team"."createdByUserId" NOT IN (:...`);
    expect(sql).not.toContain(" OR (");
  });

  test("the people are bound in lower case, each once", () => {
    const result: Serialized = serialize(Team, {
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        relations: { members: [ALICE.toUpperCase(), ALICE, new ObjectID(BOB)] },
      }),
    });

    expect(parametersOf(result["_id"])).toEqual([[ALICE, BOB]]);
  });

  test("the link table's alias is the subquery's own, however many there are", () => {
    const first: string = sqlOf(
      serialize(Team, {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { members: [ALICE] },
        }),
      })["_id"],
      "Team",
    );
    const second: string = sqlOf(
      serialize(Team, {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { members: [ALICE] },
        }),
      })["_id"],
      "Team",
    );

    const aliasOf: (sql: string) => string | undefined = (
      sql: string,
    ): string | undefined => {
      const found: RegExpMatchArray | null = sql.match(
        /FROM "TeamMember" "(link\w+)"/,
      );

      return found?.[1];
    };

    expect(aliasOf(first)).toBeDefined();
    expect(aliasOf(first)).not.toBe(aliasOf(second));
  });

  test("a kind with no such relation is refused as before", () => {
    const error: Error | undefined = errorOf(() => {
      return serialize(Monitor, {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { members: [ALICE] },
        }),
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      `"members" is not a relation "linkedTo" can filter Monitors by: a list of linked records (such as "monitors") or the ID of one (such as "monitorId").`,
    );
  });
});

describe("QueryPermission - a team's members are TeamMember's to read", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  test.each([
    Permission.ReadProjectTeam,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsViewer,
    Permission.ProjectAdmin,
  ])(
    "a reader of teams by %s filters them by who is in them, and the read carries the subquery",
    async (permission: Permission) => {
      const result: CheckReadPermissionType<BaseModel> = await checkRead(
        Team,
        {
          [LINKED_TO_QUERY_KEY]: new LinkedTo({
            relations: { members: [ALICE] },
          }),
        },
        caller([permission]),
      );

      const query: Record<string, unknown> = result.query as Record<
        string,
        unknown
      >;

      expect(query[LINKED_TO_QUERY_KEY]).toBeUndefined();
      expect(sqlOf(query["_id"] as FindOperator<any>, "Team")).toContain(
        `FROM "TeamMember"`,
      );
      // The tenant's own teams, still.
      expect(query["projectId"]).toBeDefined();
    },
  );

  test("a link table whose columns the caller may not read is refused, naming the column", async () => {
    // A relation of teams kept, for this test, in a table nobody here may read.
    jest.spyOn(LinkedToLinkTables, "get").mockReturnValue({
      modelType: UserSMS,
      recordColumnName: "projectId",
      linkedColumnName: "userId",
    });

    const error: Error | null = await refusalOf(
      Team,
      {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { members: [ALICE] },
        }),
      },
      caller([Permission.ReadProjectTeam]),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });

  test("CurrentUser alone never reads the link table: it reads only the caller's own rows of it", async () => {
    /*
     * A list the caller reads as their own (their phone numbers), filtered
     * by a relation kept in TeamMember: every signed-in person holds
     * CurrentUser, which reads their own memberships only, so it does not
     * count as a read of anyone's.
     */
    jest.spyOn(LinkedToLinkTables, "get").mockImplementation(((
      modelType: { new (): BaseModel },
      relation: string,
    ): LinkTableRelation | null => {
      return modelType === UserSMS && relation === "members"
        ? {
            modelType: TeamMember,
            recordColumnName: "teamId",
            linkedColumnName: "userId",
          }
        : null;
    }) as never);

    const userId: ObjectID = ObjectID.generate();

    const error: Error | null = await refusalOf(
      UserSMS,
      {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { members: [ALICE] },
        }),
      },
      { userId: userId, tenantId: PROJECT_ID, ...ON_HIGHEST_PLAN },
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error?.message).toBe(
      ColumnRefusalMessage.getRelationQueryRefusal({
        column: "teamId",
        relatedModelName: "Team Member",
        relationColumn: "members",
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.ProjectUser,
          Permission.SettingsAdmin,
          Permission.SettingsMember,
          Permission.SettingsViewer,
          Permission.ReadProjectTeam,
        ],
      }),
    );
  });

  test("whoever may not read teams is refused them, filter or not", async () => {
    const error: Error | null = await refusalOf(
      Team,
      {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { members: [ALICE] },
        }),
      },
      caller([Permission.ReadProjectIncident]),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });

  test("a block on reading teams refuses the filter with the list", async () => {
    const error: Error | null = await refusalOf(
      Team,
      {
        [LINKED_TO_QUERY_KEY]: new LinkedTo({
          relations: { members: [ALICE] },
        }),
      },
      {
        ...customDomainCaller({
          permissions: [Permission.ReadProjectTeam],
          blocks: [Permission.ReadProjectTeam],
          projectId: PROJECT_ID,
        }),
        ...ON_HIGHEST_PLAN,
      },
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });
});
