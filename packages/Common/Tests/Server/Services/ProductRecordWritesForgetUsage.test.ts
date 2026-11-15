import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ProjectUsageCache, {
  ProjectUsage,
} from "../../../Server/Utils/ProjectProducts/ProjectUsageCache";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import ProductKey from "../../../Types/Product/ProductKey";
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

jest.mock("../../../Server/Utils/Logger");

/*
 * EVERY WRITE OF A PRODUCT'S MAIN RECORD TELLS THE PRODUCTS MENU (#7465).
 *
 * The products menu said "Not set up" on Monitors and On-Call Duty for
 * minutes after the guided setup made the project's first monitor and
 * policy: what a project uses was kept five minutes, and no create told it.
 * Telling it from one service's hook would miss every create that skips the
 * hooks - an import, a workflow's, OneUptime's own - so it is done where
 * every create and delete goes: DatabaseService hands the row it wrote to
 * ProjectUsageCache.afterCreate once the INSERT is done, and the rows it
 * deleted to ProjectUsageCache.afterDelete once the DELETE is done. Pinned
 * here for create, deleteBy and hardDeleteBy, with hooks and without, and
 * end to end: the usage kept before the create is read again after it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-00000000b001",
);
const RECORD_ID: string = "6b000000-0000-4000-8000-00000000b001";

interface FakeRepository {
  save: (entity: unknown) => Promise<unknown>;
  find: () => Promise<Array<BaseModel>>;
  delete: () => Promise<{ affected: number }>;
  manager: { query: () => Promise<Array<unknown>> };
}

// A service of the model whose database is a list of rows in memory.
function serviceOf<TModel extends BaseModel>(
  model: { new (): TModel },
  rows: Array<TModel> = [],
  options: { saveFails?: boolean; deleteFails?: boolean } = {},
): DatabaseService<TModel> {
  const service: DatabaseService<TModel> = new DatabaseService<TModel>(model);

  const repository: FakeRepository = {
    save: async (entity: unknown): Promise<unknown> => {
      if (options.saveFails) {
        throw new Error("The database could not write the row");
      }

      const saved: BaseModel = entity as BaseModel;

      if (!saved._id) {
        saved._id = RECORD_ID;
      }

      return saved;
    },
    find: async (): Promise<Array<BaseModel>> => {
      return rows;
    },
    delete: async (): Promise<{ affected: number }> => {
      if (options.deleteFails) {
        throw new Error("The database could not delete the row");
      }

      return { affected: rows.length };
    },
    manager: {
      query: async (): Promise<Array<unknown>> => {
        return [];
      },
    },
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(repository as never);
  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(service, "checkRequiredFields").mockImplementation(((
    data: unknown,
  ) => {
    return data;
  }) as never);
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "autoOwnerOnCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "_findBy").mockResolvedValue(rows as never);
  getJestSpyOn(service, "readRowsShowingImages").mockImplementation((async (
    items: Array<TModel>,
  ) => {
    return items;
  }) as never);
  getJestSpyOn(service, "readRowsDeletedWith").mockResolvedValue([] as never);
  getJestSpyOn(service, "keepRowsCallerMayWrite").mockResolvedValue(
    true as never,
  );
  getJestSpyOn(service, "getRealtimeAccessBeforeDelete").mockResolvedValue(
    new Map() as never,
  );

  return service;
}

function rootProps(
  extra?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  return { isRoot: true, tenantId: PROJECT_ID, ...extra };
}

function monitor(): Monitor {
  const item: Monitor = new Monitor();
  item.name = "checkout-api";
  item.projectId = PROJECT_ID;
  return item;
}

function storedMonitor(): Monitor {
  const item: Monitor = monitor();
  item._id = RECORD_ID;
  return item;
}

function policy(): OnCallDutyPolicy {
  const item: OnCallDutyPolicy = new OnCallDutyPolicy();
  item.name = "Primary on-call";
  item.projectId = PROJECT_ID;
  return item;
}

function label(): Label {
  const item: Label = new Label();
  item.name = "production";
  item.color = "#000000" as never;
  item.projectId = PROJECT_ID;
  return item;
}

beforeEach(() => {
  ProjectUsageCache.clear();

  jest
    .spyOn(ModelPermission, "checkDeleteQueryPermission")
    .mockImplementation((async (_type: unknown, query: unknown) => {
      return query;
    }) as never);
  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordDelete")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  ProjectUsageCache.clear();
  jest.restoreAllMocks();
});

describe("a create hands the row it wrote to ProjectUsageCache", () => {
  let afterCreate: SpyInstance<typeof ProjectUsageCache.afterCreate>;

  beforeEach(() => {
    afterCreate = jest
      .spyOn(ProjectUsageCache, "afterCreate")
      .mockResolvedValue(undefined as never);
  });

  test("a monitor: its table, and the row with its project", async () => {
    const service: DatabaseService<Monitor> = serviceOf(Monitor);

    await service.create({ data: monitor(), props: rootProps() });

    expect(afterCreate).toHaveBeenCalledTimes(1);
    const handed: { tableName: string | null | undefined; row: unknown } =
      afterCreate.mock.calls[0]![0];
    expect(handed.tableName).toBe("Monitor");
    expect(String((handed.row as { projectId?: ObjectID }).projectId)).toBe(
      PROJECT_ID.toString(),
    );
    expect(String((handed.row as { _id?: string })._id)).toBe(RECORD_ID);
  });

  test("an on-call policy too", async () => {
    const service: DatabaseService<OnCallDutyPolicy> =
      serviceOf(OnCallDutyPolicy);

    await service.create({ data: policy(), props: rootProps() });

    expect(afterCreate).toHaveBeenCalledTimes(1);
    expect(afterCreate.mock.calls[0]![0].tableName).toBe("OnCallDutyPolicy");
  });

  test("a create that skips the hooks tells it too - an import, a workflow's", async () => {
    const service: DatabaseService<Monitor> = serviceOf(Monitor);

    await service.create({
      data: monitor(),
      props: rootProps({ ignoreHooks: true }),
    });

    expect(afterCreate).toHaveBeenCalledTimes(1);
  });

  test("any table is handed over: ProjectUsageCache says which are a product's", async () => {
    const service: DatabaseService<Label> = serviceOf(Label);

    await service.create({ data: label(), props: rootProps() });

    expect(afterCreate).toHaveBeenCalledTimes(1);
    expect(afterCreate.mock.calls[0]![0].tableName).toBe("Label");
  });

  test("a create the database refuses tells it nothing", async () => {
    const service: DatabaseService<Monitor> = serviceOf(Monitor, [], {
      saveFails: true,
    });

    await expect(
      service.create({ data: monitor(), props: rootProps() }),
    ).rejects.toThrow();

    expect(afterCreate).not.toHaveBeenCalled();
  });
});

describe("a delete hands the rows it deleted to ProjectUsageCache", () => {
  let afterDelete: SpyInstance<typeof ProjectUsageCache.afterDelete>;

  beforeEach(() => {
    afterDelete = jest
      .spyOn(ProjectUsageCache, "afterDelete")
      .mockResolvedValue(undefined as never);
  });

  test("deleteBy: the table, and the rows with their project", async () => {
    const service: DatabaseService<Monitor> = serviceOf(Monitor, [
      storedMonitor(),
    ]);

    await service.deleteBy({
      query: { _id: RECORD_ID },
      limit: 1,
      skip: 0,
      props: rootProps(),
    });

    expect(afterDelete).toHaveBeenCalledTimes(1);
    const handed: {
      tableName: string | null | undefined;
      rows: Array<unknown>;
    } = afterDelete.mock.calls[0]![0];
    expect(handed.tableName).toBe("Monitor");
    expect(handed.rows).toHaveLength(1);
    expect(String((handed.rows[0] as { projectId?: ObjectID }).projectId)).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a delete that skips the hooks tells it too", async () => {
    const service: DatabaseService<Monitor> = serviceOf(Monitor, [
      storedMonitor(),
    ]);

    await service.deleteBy({
      query: { _id: RECORD_ID },
      limit: 1,
      skip: 0,
      props: rootProps({ ignoreHooks: true }),
    });

    expect(afterDelete).toHaveBeenCalledTimes(1);
  });

  test("hardDeleteBy tells it too - the retention purge", async () => {
    const service: DatabaseService<Monitor> = serviceOf(Monitor, [
      storedMonitor(),
    ]);

    await service.hardDeleteBy({
      query: { _id: RECORD_ID },
      limit: 1,
      skip: 0,
      props: rootProps(),
    });

    expect(afterDelete).toHaveBeenCalledTimes(1);
    expect(afterDelete.mock.calls[0]![0].tableName).toBe("Monitor");
  });

  test("a delete the database refuses, or one that found nothing, tells it nothing", async () => {
    await expect(
      serviceOf(Monitor, [storedMonitor()], { deleteFails: true }).deleteBy({
        query: { _id: RECORD_ID },
        limit: 1,
        skip: 0,
        props: rootProps(),
      }),
    ).rejects.toThrow();

    await serviceOf(Monitor, []).deleteBy({
      query: { _id: RECORD_ID },
      limit: 1,
      skip: 0,
      props: rootProps(),
    });

    expect(afterDelete).not.toHaveBeenCalled();
  });
});

describe("end to end: the usage kept before a write is read again after it", () => {
  let stored: ProjectUsage;
  let reads: number;

  const usage: () => Promise<ProjectUsage> =
    async (): Promise<ProjectUsage> => {
      return await ProjectUsageCache.getUsage({
        projectId: PROJECT_ID,
        read: async (): Promise<ProjectUsage> => {
          reads++;
          return { ...stored };
        },
      });
    };

  beforeEach(() => {
    stored = { [ProductKey.Monitors]: false, [ProductKey.OnCall]: false };
    reads = 0;
  });

  test("the project's first monitor is in use at once, not five minutes later", async () => {
    expect((await usage())[ProductKey.Monitors]).toBe(false);

    stored = { ...stored, [ProductKey.Monitors]: true };
    await serviceOf(Monitor).create({ data: monitor(), props: rootProps() });

    expect((await usage())[ProductKey.Monitors]).toBe(true);
  });

  test("the project's first on-call policy is in use at once", async () => {
    await usage();

    stored = { ...stored, [ProductKey.OnCall]: true };
    await serviceOf(OnCallDutyPolicy).create({
      data: policy(),
      props: rootProps(),
    });

    expect((await usage())[ProductKey.OnCall]).toBe(true);
  });

  test("the last monitor deleted is not set up again at once", async () => {
    stored = { [ProductKey.Monitors]: true };
    await usage();

    stored = { [ProductKey.Monitors]: false };
    await serviceOf(Monitor, [storedMonitor()]).deleteBy({
      query: { _id: RECORD_ID },
      limit: 1,
      skip: 0,
      props: rootProps(),
    });

    expect((await usage())[ProductKey.Monitors]).toBe(false);
  });

  test("a label created changes nothing: the usage kept is served", async () => {
    await usage();

    await serviceOf(Label).create({ data: label(), props: rootProps() });
    await usage();

    expect(reads).toBe(1);
  });
});
