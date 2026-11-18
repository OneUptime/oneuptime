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
    expect(scope.checkQuery).toEqual({ projectId: PROJECT, dataAssetId: owned });
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
    const owned: FindOperator<unknown> = In([TABLE_OWNED]);
    const asked: FindOperator<unknown> = In([TABLE_OWNED, TABLE_NOT_OWNED]);
    const combined: Record<string, unknown> = withConditions<DataAsset>(
      { projectId: PROJECT, _id: owned },
      { _id: asked },
    ) as unknown as Record<string, unknown>;

    expect(combined["_id"]).toEqual(And(owned, asked));
    expect(combined["projectId"]).toEqual(PROJECT);
  });
});

describe("one record a route is about", () => {
  test("its ids the caller may read, asked with their reads", async () => {
    const owned: FindOperator<unknown> = In([TABLE_OWNED]);
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
        query: { projectId: PROJECT, _id: owned },
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

    expect(
      [
        ...(await DataObservabilityReadScope.getReadableIds({
          service: DataAssetService,
          query: { projectId: PROJECT },
          ids: [],
        })),
      ],
    ).toEqual([]);
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
