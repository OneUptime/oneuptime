import DataAssetService from "../../../Server/Services/DataAssetService";
import DataCheckService from "../../../Server/Services/DataCheckService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import logger from "../../../Server/Utils/Logger";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataAssetColumn } from "../../../Types/DataObservability/DataAssetColumn";
import { DataCheckType } from "../../../Types/DataObservability/DataCheckType";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A DATA CHECK'S WRITES, THROUGH THE WHOLE CREATE AND UPDATE.
 *
 * A check is validated against its table's catalog as it is saved, and runs
 * at the store's next collection once saved or changed. Three things the
 * check's hooks did wrong, each a way the checks validated were not the
 * checks written:
 *
 *   - its next run was stamped in onBeforeUpdate. nextRunAt is OneUptime's
 *     (create: [], update: []), and DatabaseService holds what that hook
 *     leaves to the caller's column permissions, so every change of what a
 *     check runs was refused - for the project owner too ("User is not
 *     allowed to update on nextRunAt column of Data Check"). It is stamped
 *     in onUpdatePermitted now, once the change has passed every check.
 *   - an update's checks were read by its own query, as root, ten of them:
 *     the eleventh was written unvalidated, and a dbt test was looked for
 *     in rows the caller may not write. They are the rows the update
 *     writes now, read with findRowsAndHoldUpdateToThem, every one.
 *   - a create read its table under dataAssetId alone, while a write that
 *     names it under both names is stored with the relation's: a check
 *     could be validated against one table and saved on another. Both
 *     names are read now, and must agree.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: string = "33333333-3333-4333-8333-333333333333";
// A table with an email column, and one without.
const ORDERS_ID: string = "44444444-4444-4444-8444-444444444444";
const EVENTS_ID: string = "55555555-5555-4555-8555-555555555555";
const CHECK_ID: string = "22222222-2222-4222-8222-222222222222";

const DBT_TEST_REFUSAL: string =
  "A dbt test is defined in your dbt project and comes from its artifacts: here it is only turned off or on, and alerted on.";

function column(name: string, position: number): DataAssetColumn {
  return {
    name: name,
    dataType: "text",
    isNullable: true,
    position: position,
  };
}

const TABLE_COLUMNS: Record<string, Array<DataAssetColumn>> = {
  [ORDERS_ID]: [column("id", 1), column("email", 2), column("status", 3)],
  [EVENTS_ID]: [column("id", 1), column("status", 2)],
};

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
}

function checkRow(
  id: string,
  dataAssetId: string,
  more: StoredRow = {},
): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    dataAssetId: dataAssetId,
    dataStoreId: STORE_ID,
    name: `Check ${id}`,
    checkType: DataCheckType.NullPercent,
    columnName: "status",
    intervalInMinutes: 60,
    isEnabled: true,
    version: 1,
    ...more,
  };
}

// The tables of the store, as the catalog the collection saw.
let assetReads: SpyInstance<typeof DataAssetService.findOneBy>;

function stubCatalog(): void {
  assetReads = jest
    .spyOn(DataAssetService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: { _id?: unknown };
    }): Promise<DataAsset | null> => {
      const id: string = String(findOneBy.query._id || "").toLowerCase();
      const columns: Array<DataAssetColumn> | undefined = TABLE_COLUMNS[id];

      if (!columns) {
        return null;
      }

      const asset: DataAsset = new DataAsset();
      asset._id = id;
      asset.dataStoreId = new ObjectID(STORE_ID);
      asset.columns = columns;
      asset.isDropped = false;

      return asset;
    }) as never);

  // No check here refers to another table.
  jest.spyOn(DataAssetService, "findBy").mockResolvedValue([] as never);

  jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async () => {
    const store: DataStore = new DataStore();
    store._id = STORE_ID;
    store.kind = DataStoreKind.Snowflake;

    return store;
  }) as never);
}

// The tables the checks were validated against, in order.
function tablesRead(): Array<string> {
  return assetReads.mock.calls.map(
    (call: Parameters<typeof DataAssetService.findOneBy>): string => {
      return String(call[0].query._id);
    },
  );
}

// The update's hooks, reached through a cast as every service suite does.
interface UpdateHooks {
  onBeforeUpdate(updateBy: UpdateBy<DataCheck>): Promise<OnUpdate<DataCheck>>;
  onUpdatePermitted(updateBy: UpdateBy<DataCheck>): Promise<void>;
}

interface CreateHooks {
  onBeforeCreate(createBy: CreateBy<DataCheck>): Promise<unknown>;
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
  stubCatalog();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("changing a check, as each person the table lets edit one", () => {
  let table: InMemoryTable;

  function stored(id: string, name: string): unknown {
    return table.get(id)?.[name];
  }

  async function change(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    await DataCheckService.updateOneById({
      id: new ObjectID(CHECK_ID),
      data: data as never,
      props: props,
    });
  }

  // Who may edit a check: the model's update list.
  const EDITORS: Array<[string, Array<Permission>]> = [
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    ["a project member", [Permission.ProjectMember]],
    ["a telemetry admin", [Permission.TelemetryAdmin]],
    ["a telemetry member", [Permission.TelemetryMember]],
    [
      "someone holding Edit Data Asset",
      [Permission.EditDataAsset, Permission.ReadDataAsset],
    ],
  ];

  beforeEach(() => {
    table = useInMemoryTable(DataCheckService, [checkRow(CHECK_ID, ORDERS_ID)]);
  });

  test("the editors are exactly the table's update list", () => {
    expect(
      EDITORS.map((editor: [string, Array<Permission>]): Permission => {
        return editor[1][0]!;
      }).sort(),
    ).toEqual([...(new DataCheck().updateRecordPermissions || [])].sort());
  });

  test.each(EDITORS)(
    "%s changes the column it reads, and it runs at the store's next collection",
    async (_who: string, permissions: Array<Permission>) => {
      await change({ columnName: "email" }, member(permissions));

      expect(stored(CHECK_ID, "columnName")).toBe("email");
      expect(stored(CHECK_ID, "nextRunAt")).toBeInstanceOf(Date);
      // Validated against the check's own table.
      expect(tablesRead()).toEqual([ORDERS_ID]);
    },
  );

  test.each(EDITORS)(
    "%s changes its alert threshold, a change of what it runs too",
    async (_who: string, permissions: Array<Permission>) => {
      await change({ alertThreshold: 5 }, member(permissions));

      expect(Number(stored(CHECK_ID, "alertThreshold"))).toBe(5);
      expect(stored(CHECK_ID, "nextRunAt")).toBeInstanceOf(Date);
    },
  );

  test("a rename is no change of what it runs: it is not run again, nor its table read", async () => {
    await change(
      { name: "Statuses present" },
      member([Permission.ProjectOwner]),
    );

    expect(stored(CHECK_ID, "name")).toBe("Statuses present");
    expect(stored(CHECK_ID, "nextRunAt")).toBeUndefined();
    expect(tablesRead()).toEqual([]);
  });

  test("a column the table does not have is refused, and nothing changes", async () => {
    const error: unknown = await refusalOf(
      change(
        { columnName: "missing" },
        member([Permission.EditDataAsset, Permission.ReadDataAsset]),
      ),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe('The table has no column "missing".');
    expect(stored(CHECK_ID, "columnName")).toBe("status");
    expect(stored(CHECK_ID, "nextRunAt")).toBeUndefined();
  });

  test("nextRunAt is still OneUptime's: a member who sends it is refused, and nothing changes", async () => {
    const error: unknown = await refusalOf(
      change(
        { columnName: "email", nextRunAt: new Date() },
        member([Permission.ProjectOwner]),
      ),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe("nextRunAt");
    expect((error as Error).message).toContain(
      "User is not allowed to update on nextRunAt column of Data Check",
    );
    expect(stored(CHECK_ID, "columnName")).toBe("status");
  });

  test("a viewer may not change it, and nothing changes", async () => {
    await refusalOf(
      change(
        { columnName: "email" },
        member([Permission.Viewer, Permission.ReadDataAsset]),
      ),
    );

    expect(stored(CHECK_ID, "columnName")).toBe("status");
    expect(stored(CHECK_ID, "nextRunAt")).toBeUndefined();
  });

  test("OneUptime itself changes it the same way", async () => {
    await change({ columnName: "email" }, { isRoot: true });

    expect(stored(CHECK_ID, "columnName")).toBe("email");
    expect(stored(CHECK_ID, "nextRunAt")).toBeInstanceOf(Date);
  });
});

describe("an update of many checks", () => {
  let table: InMemoryTable;

  // Eleven checks on the table with an email column, the twelfth on one without.
  const IDS: Array<string> = Array.from(
    { length: 12 },
    (_value: unknown, index: number): string => {
      return `66666666-6666-4666-8666-${String(index + 1).padStart(12, "0")}`;
    },
  );

  beforeEach(() => {
    table = useInMemoryTable(
      DataCheckService,
      IDS.map((id: string, index: number): StoredRow => {
        return checkRow(id, index === IDS.length - 1 ? EVENTS_ID : ORDERS_ID);
      }),
    );
  });

  test("validates every check it writes: one that cannot run refuses them all, past the tenth too", async () => {
    const error: unknown = await refusalOf(
      DataCheckService.updateBy({
        query: { projectId: PROJECT_ID },
        data: { columnName: "email" } as never,
        limit: 50,
        skip: 0,
        props: member([Permission.EditDataAsset, Permission.ReadDataAsset]),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe('The table has no column "email".');
    expect(tablesRead()).toHaveLength(IDS.length);

    for (const id of IDS) {
      expect(table.get(id)?.["columnName"]).toBe("status");
    }
  });

  test("writes all of them when each can run, and each runs again", async () => {
    await DataCheckService.updateBy({
      query: { projectId: PROJECT_ID, dataAssetId: new ObjectID(ORDERS_ID) },
      data: { columnName: "email" } as never,
      limit: 50,
      skip: 0,
      props: member([Permission.EditDataAsset, Permission.ReadDataAsset]),
    });

    for (const id of IDS.slice(0, -1)) {
      expect(table.get(id)?.["columnName"]).toBe("email");
      expect(table.get(id)?.["nextRunAt"]).toBeInstanceOf(Date);
    }

    // The one the update does not name is neither read nor written.
    expect(tablesRead()).toHaveLength(IDS.length - 1);
    expect(table.get(IDS[IDS.length - 1]!)?.["columnName"]).toBe("status");
  });
});

describe("a dbt test's check", () => {
  let table: InMemoryTable;
  const DBT_CHECK_ID: string = "77777777-7777-4777-8777-777777777777";

  beforeEach(() => {
    table = useInMemoryTable(DataCheckService, [
      checkRow(CHECK_ID, ORDERS_ID),
      checkRow(DBT_CHECK_ID, ORDERS_ID, {
        checkType: DataCheckType.DbtTest,
        externalId: "test.shop.not_null_orders_status",
      }),
    ]);
  });

  test("a person switches it off and sets its alert", async () => {
    await DataCheckService.updateOneById({
      id: new ObjectID(DBT_CHECK_ID),
      data: { isEnabled: false, alertThreshold: 1 } as never,
      props: member([Permission.EditDataAsset, Permission.ReadDataAsset]),
    });

    expect(table.get(DBT_CHECK_ID)?.["isEnabled"]).toBe(false);
    expect(Number(table.get(DBT_CHECK_ID)?.["alertThreshold"])).toBe(1);
  });

  test("a person may not change what it reads, and nothing changes", async () => {
    const error: unknown = await refusalOf(
      DataCheckService.updateOneById({
        id: new ObjectID(DBT_CHECK_ID),
        data: { columnName: "email" } as never,
        props: member([Permission.ProjectOwner]),
      }),
    );

    expect((error as Error).message).toBe(DBT_TEST_REFUSAL);
    expect(table.get(DBT_CHECK_ID)?.["columnName"]).toBe("status");
  });

  test("an update over several checks that holds one is refused whole", async () => {
    const error: unknown = await refusalOf(
      DataCheckService.updateBy({
        query: { projectId: PROJECT_ID },
        data: { description: "Owned by the shop team" } as never,
        limit: 50,
        skip: 0,
        props: member([Permission.ProjectOwner]),
      }),
    );

    expect((error as Error).message).toBe(DBT_TEST_REFUSAL);
    expect(table.get(CHECK_ID)?.["description"]).toBeUndefined();
  });

  test("a check is never made one by a person", async () => {
    const error: unknown = await refusalOf(
      DataCheckService.updateOneById({
        id: new ObjectID(CHECK_ID),
        data: { checkType: DataCheckType.DbtTest } as never,
        props: member([Permission.ProjectOwner]),
      }),
    );

    expect((error as Error).message).toBe(DBT_TEST_REFUSAL);
    expect(table.get(CHECK_ID)?.["checkType"]).toBe(DataCheckType.NullPercent);
  });

  test("a description of a check that is no dbt test's is changed as before", async () => {
    await DataCheckService.updateOneById({
      id: new ObjectID(CHECK_ID),
      data: { description: "Orders must carry a status" } as never,
      props: member([Permission.ProjectOwner]),
    });

    expect(table.get(CHECK_ID)?.["description"]).toBe(
      "Orders must carry a status",
    );
  });
});

describe("the order of the update's hooks", () => {
  const hooks: UpdateHooks = DataCheckService as unknown as UpdateHooks;

  beforeEach(() => {
    useInMemoryTable(DataCheckService, [checkRow(CHECK_ID, ORDERS_ID)]);
  });

  function updateOf(data: Record<string, unknown>): UpdateBy<DataCheck> {
    return {
      query: { _id: CHECK_ID },
      data: data,
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<DataCheck>;
  }

  test("onBeforeUpdate, which runs before the permission checks, writes no nextRunAt", async () => {
    const updateBy: UpdateBy<DataCheck> = updateOf({ columnName: "email" });

    await hooks.onBeforeUpdate(updateBy);

    expect(
      (updateBy.data as unknown as Record<string, unknown>)["nextRunAt"],
    ).toBeUndefined();
  });

  test("onUpdatePermitted writes it, for the update onBeforeUpdate found to change the run - and once", async () => {
    const updateBy: UpdateBy<DataCheck> = updateOf({ columnName: "email" });
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    await hooks.onBeforeUpdate(updateBy);
    await hooks.onUpdatePermitted(updateBy);

    expect(data["nextRunAt"]).toBeInstanceOf(Date);

    // A second ask for the same update finds nothing left to do.
    delete data["nextRunAt"];
    await hooks.onUpdatePermitted(updateBy);

    expect(data["nextRunAt"]).toBeUndefined();
  });

  test("onUpdatePermitted leaves an update it was not told about alone", async () => {
    const rename: UpdateBy<DataCheck> = updateOf({ name: "Statuses" });
    const unmarked: UpdateBy<DataCheck> = updateOf({ columnName: "email" });

    await hooks.onBeforeUpdate(rename);
    await hooks.onUpdatePermitted(rename);
    await hooks.onUpdatePermitted(unmarked);

    expect(
      (rename.data as unknown as Record<string, unknown>)["nextRunAt"],
    ).toBeUndefined();
    expect(
      (unmarked.data as unknown as Record<string, unknown>)["nextRunAt"],
    ).toBeUndefined();
  });

  test("onBeforeUpdate reads the checks it judges as the rows the update writes, once", async () => {
    const held: SpyInstance<
      typeof DataCheckService.findRowsAndHoldUpdateToThem
    > = jest.spyOn(DataCheckService, "findRowsAndHoldUpdateToThem");
    const countBy: SpyInstance<typeof DataCheckService.countBy> = jest.spyOn(
      DataCheckService,
      "countBy",
    );
    const updateBy: UpdateBy<DataCheck> = updateOf({ description: "x" });

    // Root changes a description: nothing to judge, nothing read.
    await hooks.onBeforeUpdate(updateBy);
    expect(held).not.toHaveBeenCalled();

    const change: UpdateBy<DataCheck> = updateOf({ columnName: "email" });

    await hooks.onBeforeUpdate(change);

    expect(held).toHaveBeenCalledTimes(1);
    expect(held.mock.calls[0]![0]).toBe(change);
    expect(countBy).not.toHaveBeenCalled();
  });
});

describe("the table a new check reads", () => {
  const hooks: CreateHooks = DataCheckService as unknown as CreateHooks;

  function createOf(data: Record<string, unknown>): CreateBy<DataCheck> {
    const check: DataCheck = new DataCheck();

    for (const [name, value] of Object.entries({
      projectId: PROJECT_ID,
      name: "Emails present",
      checkType: DataCheckType.NullPercent,
      columnName: "email",
      ...data,
    })) {
      (check as unknown as Record<string, unknown>)[name] = value;
    }

    return {
      data: check,
      props: { isRoot: true, tenantId: PROJECT_ID },
    } as CreateBy<DataCheck>;
  }

  test("named by its ID column, it is the table validated, and its store's", async () => {
    const createBy: CreateBy<DataCheck> = createOf({
      dataAssetId: new ObjectID(ORDERS_ID),
    });

    await hooks.onBeforeCreate(createBy);

    expect(tablesRead()).toEqual([ORDERS_ID]);
    expect(createBy.data.dataStoreId?.toString()).toBe(STORE_ID);
    expect(createBy.data.nextRunAt).toBeInstanceOf(Date);
  });

  test("named by the relation alone, it is read the same, and kept in the ID column", async () => {
    const createBy: CreateBy<DataCheck> = createOf({
      dataAsset: { _id: ORDERS_ID },
    });

    await hooks.onBeforeCreate(createBy);

    expect(tablesRead()).toEqual([ORDERS_ID]);
    expect(createBy.data.dataAssetId?.toString()).toBe(ORDERS_ID);
  });

  test("named twice, differently, it is refused before any table is read", async () => {
    const error: unknown = await refusalOf(
      hooks.onBeforeCreate(
        createOf({
          dataAssetId: new ObjectID(EVENTS_ID),
          dataAsset: { _id: ORDERS_ID },
        }),
      ),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      "Conflicting Data Asset references were provided",
    );
    expect(tablesRead()).toEqual([]);
  });

  test("named twice, the same, it is read once", async () => {
    await hooks.onBeforeCreate(
      createOf({
        dataAssetId: new ObjectID(ORDERS_ID),
        dataAsset: { _id: ORDERS_ID },
      }),
    );

    expect(tablesRead()).toEqual([ORDERS_ID]);
  });

  test("not named, it is refused", async () => {
    const error: unknown = await refusalOf(hooks.onBeforeCreate(createOf({})));

    expect((error as Error).message).toBe("A check needs the table it reads.");
  });
});
