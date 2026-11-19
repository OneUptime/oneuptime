import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { And, FindOperator, In } from "typeorm";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataCheckService from "../../../../Server/Services/DataCheckService";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import DataObservabilityReadScope, {
  DataObservabilityScope,
  isWholeProjectQuery,
  readsAsOneUptime,
  withConditions,
} from "../../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";

/*
 * WHAT A CALLER MAY READ, FOR DATA OBSERVABILITY'S OWN ROUTES (#6553).
 *
 * Its routes read as OneUptime, for the names, states and times only they
 * hand back, and narrow each read of tables, checks and pipelines by the
 * caller's grants, as the generic routes do: the read-permission pipeline
 * works the caller's query out, and the route reads with it. A caller it
 * narrows nothing for reads exactly what the routes read before.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");
const TABLE_OWNED: string = "88888888-8888-4888-8888-000000000001";
const TABLE_NOT_OWNED: string = "88888888-8888-4888-8888-000000000002";
const CHECK: string = "88888888-8888-4888-8888-000000000011";

const OWNED_ONLY: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: MEMBER,
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ReadDataAsset,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  },
};

let checkedModels: Array<string>;

function narrowWith(queries: Record<string, Record<string, unknown>>): void {
  jest
    .spyOn(ModelPermission, "checkReadQueryPermission")
    .mockImplementation((async (modelType: { name: string }) => {
      checkedModels.push(modelType.name);
      return {
        query: queries[modelType.name] || { projectId: PROJECT },
        select: null,
        relationSelect: null,
      };
    }) as never);
}

beforeEach(() => {
  checkedModels = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who is narrowed", () => {
  test("OneUptime's own reads, a master admin and a call no one made read the whole project", () => {
    expect(readsAsOneUptime({ isRoot: true })).toBe(true);
    expect(readsAsOneUptime({ isMasterAdmin: true, userId: MEMBER })).toBe(
      true,
    );
    expect(readsAsOneUptime({})).toBe(true);
    expect(readsAsOneUptime(undefined)).toBe(true);
    expect(readsAsOneUptime(null)).toBe(true);
    expect(readsAsOneUptime(OWNED_ONLY)).toBe(false);
    expect(readsAsOneUptime({ apiKeyId: new ObjectID(CHECK) })).toBe(false);
  });

  test("a query of nothing but the project is the whole project's", () => {
    expect(isWholeProjectQuery({ projectId: PROJECT })).toBe(true);
    expect(isWholeProjectQuery({ projectId: PROJECT, _id: "x" })).toBe(false);
    expect(isWholeProjectQuery({})).toBe(false);
    expect(isWholeProjectQuery(null)).toBe(false);
    expect(isWholeProjectQuery([])).toBe(false);
  });
});

describe("the caller's reads (get)", () => {
  test("OneUptime reads the whole project, and no permission is asked", async () => {
    narrowWith({});

    const scope: DataObservabilityScope = await DataObservabilityReadScope.get(
      PROJECT,
      { isRoot: true },
    );

    expect(scope).toEqual(DataObservabilityReadScope.wholeProject(PROJECT));
    expect(checkedModels).toEqual([]);
  });

  test("a person the pipeline narrows nothing for reads the whole project", async () => {
    narrowWith({});

    const scope: DataObservabilityScope = await DataObservabilityReadScope.get(
      PROJECT,
      OWNED_ONLY,
    );

    expect(scope.isWholeProject).toBe(true);
    expect(checkedModels.sort()).toEqual(
      [DataAsset.name, DataCheck.name, DataPipeline.name].sort(),
    );
  });

  test("a person limited to what they own reads the tables, checks and pipelines the pipeline narrows to", async () => {
    const owned: FindOperator<unknown> = QueryHelper.any([TABLE_OWNED]);

    narrowWith({
      [DataAsset.name]: { projectId: PROJECT, _id: owned },
      [DataCheck.name]: { projectId: PROJECT, dataAssetId: owned },
    });

    const scope: DataObservabilityScope = await DataObservabilityReadScope.get(
      PROJECT,
      OWNED_ONLY,
    );

    expect(scope.isWholeProject).toBe(false);
    expect(scope.assetQuery).toEqual({ projectId: PROJECT, _id: owned });
    expect(scope.checkQuery).toEqual({
      projectId: PROJECT,
      dataAssetId: owned,
    });
    expect(scope.pipelineQuery).toEqual({ projectId: PROJECT });
  });

  test("a caller who may not read tables at all is refused, as the generic routes refuse them", async () => {
    jest
      .spyOn(ModelPermission, "checkReadQueryPermission")
      .mockRejectedValue(new Error("You do not have permission.") as never);

    await expect(
      DataObservabilityReadScope.get(PROJECT, OWNED_ONLY),
    ).rejects.toThrow("You do not have permission.");
  });
});

describe("a route's own conditions, added to the caller's (withConditions)", () => {
  test("a column the caller's grants leave alone takes the route's condition", () => {
    expect(
      withConditions<DataAsset>({ projectId: PROJECT }, { isDropped: false }),
    ).toEqual({ projectId: PROJECT, isDropped: false });
  });

  test("a column the grants narrow is AND-ed, never widened to what the route asks", () => {
    const owned: FindOperator<string> = In([TABLE_OWNED]);
    const asked: FindOperator<string> = In([TABLE_OWNED, TABLE_NOT_OWNED]);
    // TypeORM's own operators, as the read-permission pipeline writes them.
    const combined: Record<string, unknown> = withConditions<DataAsset>(
      { projectId: PROJECT, _id: owned as never },
      { _id: asked as never },
    ) as unknown as Record<string, unknown>;

    expect(combined["_id"]).toEqual(And(owned, asked));
    expect(combined["projectId"]).toEqual(PROJECT);
  });
});

describe("one record a route is about", () => {
  test("its ids the caller may read, asked with their reads", async () => {
    const owned: FindOperator<string> = In([TABLE_OWNED]);
    const reads: Array<Record<string, unknown>> = [];

    jest.spyOn(DataAssetService, "findBy").mockImplementation((async (findBy: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }) => {
      reads.push(findBy.query);
      expect(findBy.props).toEqual({ isRoot: true });

      const row: DataAsset = new DataAsset();
      row.id = new ObjectID(TABLE_OWNED);
      return [row];
    }) as never);

    const readable: Set<string> =
      await DataObservabilityReadScope.getReadableIds({
        service: DataAssetService,
        query: { projectId: PROJECT, _id: owned as never },
        ids: [TABLE_OWNED, TABLE_NOT_OWNED],
      });

    expect([...readable]).toEqual([TABLE_OWNED]);
    // The owned scope's ids, AND-ed with the ones asked for.
    expect((reads[0]!["_id"] as FindOperator<unknown>).type).toBe("and");
  });

  test("no ids: nothing read", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAssetService,
      "findBy",
    );

    expect([
      ...(await DataObservabilityReadScope.getReadableIds({
        service: DataAssetService,
        query: { projectId: PROJECT },
        ids: [],
      })),
    ]).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("a table a narrowed caller does not own is not theirs to ask about", async () => {
    narrowWith({
      [DataAsset.name]: { projectId: PROJECT, _id: In([TABLE_OWNED]) },
    });
    jest.spyOn(DataAssetService, "findBy").mockResolvedValue([] as never);

    expect(
      await DataObservabilityReadScope.canReadTable({
        projectId: PROJECT,
        dataAssetId: new ObjectID(TABLE_NOT_OWNED),
        props: OWNED_ONLY,
      }),
    ).toBe(false);
  });

  test("a table they own is", async () => {
    narrowWith({
      [DataAsset.name]: { projectId: PROJECT, _id: In([TABLE_OWNED]) },
    });
    const row: DataAsset = new DataAsset();
    row.id = new ObjectID(TABLE_OWNED);
    jest.spyOn(DataAssetService, "findBy").mockResolvedValue([row] as never);

    expect(
      await DataObservabilityReadScope.canReadTable({
        projectId: PROJECT,
        dataAssetId: new ObjectID(TABLE_OWNED),
        props: OWNED_ONLY,
      }),
    ).toBe(true);
  });

  test("OneUptime may read any table, and nothing is asked", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAssetService,
      "findBy",
    );

    expect(
      await DataObservabilityReadScope.canReadTable({
        projectId: PROJECT,
        dataAssetId: new ObjectID(TABLE_NOT_OWNED),
        props: { isRoot: true },
      }),
    ).toBe(true);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("a check is changed only as a change of it would be narrowed: the update pipeline decides", async () => {
    const updateChecks: Array<Record<string, unknown>> = [];

    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation((async (
        modelType: { name: string },
        query: Record<string, unknown>,
      ) => {
        updateChecks.push({ model: modelType.name, ...query });
        return { ...query, dataAssetId: In([TABLE_OWNED]) };
      }) as never);
    jest.spyOn(DataCheckService, "findBy").mockResolvedValue([] as never);

    expect(
      await DataObservabilityReadScope.canChangeCheck({
        projectId: PROJECT,
        dataCheckId: new ObjectID(CHECK),
        props: OWNED_ONLY,
      }),
    ).toBe(false);
    expect(updateChecks[0]).toMatchObject({
      model: DataCheck.name,
      projectId: PROJECT,
    });
  });
});

/*
 * WHAT NOBODY IN PARTICULAR MAY READ (#9562): what OneUptime writes for
 * everyone who may see an alert - its investigation's report - reads only
 * the tables and pipelines no owner or label sets apart. Each condition is
 * the one the owners filter and the label rules write (QueryHelper.ownedBy,
 * QueryHelper.noEntitiesInManyToMany), read here as Postgres reads it.
 */
describe("what nobody in particular may read (nobodyInParticular)", () => {
  const TABLE_ID: string = '"DataAsset"."_id"';
  const UNOWNED_TABLE: string =
    '(NOT EXISTS (SELECT 1 FROM "DataAssetOwnerUser" WHERE "DataAssetOwnerUser"."dataAssetId" = "DataAsset"."_id" AND "DataAssetOwnerUser"."deletedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "DataAssetOwnerTeam" WHERE "DataAssetOwnerTeam"."dataAssetId" = "DataAsset"."_id" AND "DataAssetOwnerTeam"."deletedAt" IS NULL))';
  const UNLABELLED_TABLE: string =
    '("DataAsset"."_id" NOT IN (SELECT "DataAssetLabel"."dataAssetId" FROM "DataAssetLabel" WHERE "DataAssetLabel"."dataAssetId" IS NOT NULL))';

  function sqlOf(condition: unknown, alias: string): string {
    expect(condition).toBeInstanceOf(FindOperator);

    return (condition as FindOperator<unknown>).getSql!(alias);
  }

  test("a table with no owner, person or team, and no label: never the whole project, and no grant asked", () => {
    narrowWith({});

    const scope: DataObservabilityScope =
      DataObservabilityReadScope.nobodyInParticular(PROJECT);

    expect(scope.isWholeProject).toBe(false);
    expect(Object.keys(scope.assetQuery).sort()).toEqual(["_id", "projectId"]);
    expect(scope.assetQuery.projectId).toBe(PROJECT);
    expect(sqlOf(scope.assetQuery._id, TABLE_ID)).toBe(
      `(${UNOWNED_TABLE} AND ${UNLABELLED_TABLE})`,
    );
    // Nobody in particular has no grants to ask about.
    expect(checkedModels).toEqual([]);
  });

  test("a pipeline with no owner, person or team (a pipeline carries no labels)", () => {
    const scope: DataObservabilityScope =
      DataObservabilityReadScope.nobodyInParticular(PROJECT);

    expect(Object.keys(scope.pipelineQuery).sort()).toEqual([
      "_id",
      "projectId",
    ]);
    expect(sqlOf(scope.pipelineQuery._id, '"DataPipeline"."_id"')).toBe(
      '(NOT EXISTS (SELECT 1 FROM "DataPipelineOwnerUser" WHERE "DataPipelineOwnerUser"."dataPipelineId" = "DataPipeline"."_id" AND "DataPipelineOwnerUser"."deletedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "DataPipelineOwnerTeam" WHERE "DataPipelineOwnerTeam"."dataPipelineId" = "DataPipeline"."_id" AND "DataPipelineOwnerTeam"."deletedAt" IS NULL))',
    );
  });

  test("a check of a table nobody set apart, by its table", () => {
    const scope: DataObservabilityScope =
      DataObservabilityReadScope.nobodyInParticular(PROJECT);
    const sql: string = sqlOf(
      scope.checkQuery.dataAssetId,
      '"DataCheck"."dataAssetId"',
    );
    // The table's own alias in the subquery, so its id is never the check's.
    const recordAlias: RegExp = /FROM "DataAsset" "(record\w+)"/;
    const record: string = recordAlias.exec(sql)![1]!;
    const unmarked: string = `(${UNOWNED_TABLE} AND ${UNLABELLED_TABLE})`
      .split(TABLE_ID)
      .join(`"${record}"."_id"`);

    expect(sql).toBe(
      `("DataCheck"."dataAssetId" IN (SELECT "${record}"."_id" FROM "DataAsset" "${record}" WHERE ${unmarked}))`,
    );
  });

  test("a read of some tables keeps its condition beside theirs, and leaves the scope as it was", async () => {
    const scope: DataObservabilityScope =
      DataObservabilityReadScope.nobodyInParticular(PROJECT);
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetService, "findBy")
      .mockResolvedValue([] as never);

    await DataObservabilityReadScope.getReadableIds({
      service: DataAssetService,
      query: scope.assetQuery,
      ids: [TABLE_OWNED, TABLE_NOT_OWNED],
    });

    const read: { query: Record<string, unknown>; props: unknown } = findBy.mock
      .calls[0]![0] as { query: Record<string, unknown>; props: unknown };
    const id: FindOperator<unknown> = read.query[
      "_id"
    ] as FindOperator<unknown>;

    // AND-ed, never one in the other's place.
    expect(id).toBeInstanceOf(FindOperator);
    expect(id.type).toBe("and");

    const [nobody, asked] = id.value as unknown as [
      FindOperator<unknown>,
      FindOperator<unknown>,
    ];

    expect(nobody).toBe(scope.assetQuery._id);
    expect(asked.getSql!(TABLE_ID)).toMatch(
      /^\("DataAsset"\."_id" IN \(:\.\.\.\w+\)\)$/,
    );
    expect(Object.values(asked.objectLiteralParameters || {})).toEqual([
      [TABLE_OWNED, TABLE_NOT_OWNED],
    ]);
    expect(read.props).toEqual({ isRoot: true });
    expect(Object.keys(scope.assetQuery).sort()).toEqual(["_id", "projectId"]);
  });
});

/*
 * WHAT EVERYONE WHO MAY SEE A DATA ALERT MAY READ (#9576): nobody in
 * particular, made exact for a project that narrows nobody. An
 * investigation knows which kinds some team, custom role or API key reads
 * only by owner or label (ReadAudience): tables and pipelines nobody is
 * narrowed on are read whole, and the others by the owners or the labels
 * that narrow somebody, beside what the alert names itself.
 */
describe("what everyone who may see a data alert may read (forAudience)", () => {
  const TABLE_ID: string = '"DataAsset"."_id"';
  const UNOWNED_TABLE: string =
    '(NOT EXISTS (SELECT 1 FROM "DataAssetOwnerUser" WHERE "DataAssetOwnerUser"."dataAssetId" = "DataAsset"."_id" AND "DataAssetOwnerUser"."deletedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "DataAssetOwnerTeam" WHERE "DataAssetOwnerTeam"."dataAssetId" = "DataAsset"."_id" AND "DataAssetOwnerTeam"."deletedAt" IS NULL))';
  const UNLABELLED_TABLE: string =
    '("DataAsset"."_id" NOT IN (SELECT "DataAssetLabel"."dataAssetId" FROM "DataAssetLabel" WHERE "DataAssetLabel"."dataAssetId" IS NOT NULL))';

  function sqlOf(condition: unknown, alias: string): string {
    expect(condition).toBeInstanceOf(FindOperator);

    return (condition as FindOperator<unknown>).getSql!(alias);
  }

  function audience(data: Partial<ReadAudience>): ReadAudience {
    return {
      _type: "ReadAudience",
      projectId: PROJECT.toString(),
      ownedOnlyPermissions: [],
      labelledPermissions: [],
      named: {},
      telemetryBlockedIds: [],
      ...data,
    };
  }

  test("a project whose roles narrow nobody reads every table and pipeline, as before #9562", () => {
    expect(DataObservabilityReadScope.forAudience(audience({}))).toEqual(
      DataObservabilityReadScope.wholeProject(PROJECT),
    );
  });

  test("tables read only for some labels: as the label rule weighs a table, by its database's labels; pipelines whole", () => {
    const scope: DataObservabilityScope =
      DataObservabilityReadScope.forAudience(
        audience({ labelledPermissions: [Permission.ReadDataAsset] }),
      );
    const sql: string = sqlOf(scope.assetQuery._id, TABLE_ID);

    expect(scope.isWholeProject).toBe(false);
    /*
     * A table carries no labels of its own for the label rule: a grant
     * limited to labels reaches it through the database it is in.
     */
    expect(sql).toContain(
      '"DataAsset"."dataStoreId" IS NULL OR "DataAsset"."dataStoreId" NOT IN (SELECT',
    );
    expect(sql).toContain('FROM "DataStore" "record');
    expect(sql).toContain('NOT IN (SELECT "DataStoreLabel"."dataStoreId"');
    expect(sql).not.toContain(UNLABELLED_TABLE);
    expect(scope.pipelineQuery).toEqual({ projectId: PROJECT });
  });

  test("tables read only by owner: none an owner sets apart, whatever labels they carry", () => {
    const scope: DataObservabilityScope =
      DataObservabilityReadScope.forAudience(
        audience({ ownedOnlyPermissions: [Permission.ReadDataAsset] }),
      );

    expect(sqlOf(scope.assetQuery._id, TABLE_ID)).toContain(UNOWNED_TABLE);
    expect(
      sqlOf(scope.checkQuery.dataAssetId, '"DataCheck"."dataAssetId"'),
    ).toContain('FROM "DataAsset" "record');
  });

  test("the alert's own table is read whoever owns it", () => {
    const scope: DataObservabilityScope =
      DataObservabilityReadScope.forAudience(
        audience({
          ownedOnlyPermissions: [Permission.ReadDataAsset],
          named: { DataAsset: [TABLE_OWNED] },
        }),
      );

    expect(sqlOf(scope.assetQuery._id, TABLE_ID)).toContain(
      '"DataAsset"."_id" IN (:...',
    );
  });

  test("a run of OneUptime's own reads for its audience when it carries one, else as nobody in particular", () => {
    expect(
      DataObservabilityReadScope.forRootRun(PROJECT, {
        isRoot: true,
        readAudience: audience({}),
      }),
    ).toEqual(DataObservabilityReadScope.wholeProject(PROJECT));
    expect(
      DataObservabilityReadScope.forRootRun(PROJECT, { isRoot: true })
        .isWholeProject,
    ).toBe(false);
  });
});
