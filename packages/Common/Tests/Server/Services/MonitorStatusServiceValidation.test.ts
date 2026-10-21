import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindAllBy from "../../../Server/Types/Database/FindAllBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import type { SpyInstance } from "jest-mock";
import { stubRowsCallerMayDeleteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * MonitorStatusService's create/update/delete hooks. A project's monitor
 * statuses are a drag-ordered list (@ListOrderColumn, kept by
 * DatabaseService): from the healthiest down to the worst. On top of that the
 * service
 *
 *   - puts a new status that has no priority just above the offline status,
 *     so an outage still shows as the worst thing on a status page;
 *   - lets a signed-in caller move a status (it used to refuse every
 *     priority change: "delete and recreate it");
 *   - never lets a signed-in delete take away the project's last
 *     operational or offline status.
 *
 * No database: the list reads are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const OPERATIONAL_ID: string = "22222222-2222-4222-8222-222222222222";
const DEGRADED_ID: string = "33333333-3333-4333-8333-333333333333";
const OFFLINE_ID: string = "44444444-4444-4444-8444-444444444444";
const SECOND_OPERATIONAL_ID: string = "55555555-5555-4555-8555-555555555555";

type StatusRow = {
  _id: string;
  name: string;
  priority: number;
  isOperationalState?: boolean;
  isOfflineState?: boolean;
};

const status: (row: StatusRow) => MonitorStatus = (
  row: StatusRow,
): MonitorStatus => {
  const model: MonitorStatus = new MonitorStatus();
  model._id = row._id;
  model.name = row.name;
  model.priority = row.priority;
  model.projectId = PROJECT_ID;
  model.isOperationalState = Boolean(row.isOperationalState);
  model.isOfflineState = Boolean(row.isOfflineState);
  return model;
};

const SEEDED: Array<StatusRow> = [
  {
    _id: OPERATIONAL_ID,
    name: "Operational",
    priority: 1,
    isOperationalState: true,
  },
  { _id: DEGRADED_ID, name: "Degraded", priority: 2 },
  { _id: OFFLINE_ID, name: "Offline", priority: 3, isOfflineState: true },
];

let listRows: Array<StatusRow>;
let listQueries: Array<Record<string, unknown>>;
let targetQueries: Array<Record<string, unknown>>;

beforeEach(() => {
  jest.restoreAllMocks();

  listRows = SEEDED;
  listQueries = [];
  targetQueries = [];

  // The project's whole list, as StateOrderGuard reads it.
  jest.spyOn(MonitorStatusService, "findAllBy").mockImplementation(((
    findAllBy: FindAllBy<MonitorStatus>,
  ) => {
    listQueries.push(findAllBy.query as Record<string, unknown>);
    return Promise.resolve(listRows.map(status));
  }) as never);

  // The rows a write targets.
  const findBy: SpyInstance<typeof MonitorStatusService.findBy> = jest
    .spyOn(MonitorStatusService, "findBy")
    .mockImplementation(((findBy: FindBy<MonitorStatus>) => {
      const query: Record<string, unknown> = findBy.query as Record<
        string,
        unknown
      >;
      targetQueries.push(query);

      return Promise.resolve(
        listRows
          .filter((row: StatusRow) => {
            return !query["_id"] || row._id === query["_id"]?.toString();
          })
          .map(status),
      );
    }) as never);

  // A teammate may delete the statuses the same read reaches in the project.
  stubRowsCallerMayDeleteLikeFindBy(MonitorStatusService, findBy);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const runOnBeforeCreate: (
  model: MonitorStatus,
  isRoot?: boolean,
) => Promise<void> = async (
  model: MonitorStatus,
  isRoot: boolean = false,
): Promise<void> => {
  const createBy: CreateBy<MonitorStatus> = {
    data: model,
    props: { isRoot: isRoot, tenantId: PROJECT_ID },
  } as CreateBy<MonitorStatus>;

  await (
    MonitorStatusService as unknown as {
      onBeforeCreate: (c: CreateBy<MonitorStatus>) => Promise<unknown>;
    }
  ).onBeforeCreate(createBy);
};

const runOnBeforeUpdate: (
  data: Partial<MonitorStatus>,
  isRoot: boolean,
) => Promise<unknown> = (
  data: Partial<MonitorStatus>,
  isRoot: boolean,
): Promise<unknown> => {
  const updateBy: UpdateBy<MonitorStatus> = {
    data: data,
    query: { _id: DEGRADED_ID },
    limit: 1,
    skip: 0,
    props: { isRoot: isRoot, tenantId: PROJECT_ID },
  } as unknown as UpdateBy<MonitorStatus>;

  return (
    MonitorStatusService as unknown as {
      onBeforeUpdate: (u: UpdateBy<MonitorStatus>) => Promise<unknown>;
    }
  ).onBeforeUpdate(updateBy);
};

const runOnBeforeDelete: (
  id: string | undefined,
  isRoot?: boolean,
) => Promise<unknown> = (
  id: string | undefined,
  isRoot: boolean = false,
): Promise<unknown> => {
  const deleteBy: DeleteBy<MonitorStatus> = {
    query: id ? { _id: id } : {},
    limit: 1,
    skip: 0,
    props: { isRoot: isRoot, tenantId: PROJECT_ID },
  } as unknown as DeleteBy<MonitorStatus>;

  return (
    MonitorStatusService as unknown as {
      onBeforeDelete: (d: DeleteBy<MonitorStatus>) => Promise<unknown>;
    }
  ).onBeforeDelete(deleteBy);
};

describe("MonitorStatusService.onBeforeCreate", () => {
  test("a status created without a priority goes just above the offline status", async () => {
    const model: MonitorStatus = new MonitorStatus();
    model.name = "Maintenance";
    model.projectId = PROJECT_ID;

    await runOnBeforeCreate(model);

    // Offline's place: the offline status steps down one (DatabaseService).
    expect(model.priority).toBe(3);
    expect(listQueries).toHaveLength(1);
    expect(listQueries[0]!["projectId"]?.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("with no offline status it is left to DatabaseService, which puts it at the end", async () => {
    listRows = SEEDED.filter((row: StatusRow) => {
      return !row.isOfflineState;
    });

    const model: MonitorStatus = new MonitorStatus();
    model.name = "Maintenance";
    model.projectId = PROJECT_ID;

    await runOnBeforeCreate(model);

    expect(model.priority).toBeUndefined();
  });

  test("a status created with a priority keeps it, and costs no list read", async () => {
    const model: MonitorStatus = new MonitorStatus();
    model.name = "Terraform Status";
    model.priority = 99;
    model.projectId = PROJECT_ID;

    await runOnBeforeCreate(model);

    expect(model.priority).toBe(99);
    expect(listQueries).toHaveLength(0);
  });

  test("an operational status may be created anywhere: the list keeps no order between its built-ins", async () => {
    const model: MonitorStatus = new MonitorStatus();
    model.name = "Second Operational";
    model.priority = 99;
    model.isOperationalState = true;
    model.projectId = PROJECT_ID;

    await expect(runOnBeforeCreate(model)).resolves.toBeUndefined();
    expect(model.priority).toBe(99);
  });

  test("seeding (root) is placed the same way", async () => {
    const model: MonitorStatus = new MonitorStatus();
    model.name = "Maintenance";
    model.projectId = PROJECT_ID;

    await runOnBeforeCreate(model, true);

    expect(model.priority).toBe(3);
  });

  test("rejects a status created without a projectId", async () => {
    const model: MonitorStatus = new MonitorStatus();
    model.priority = 1;

    await expect(runOnBeforeCreate(model)).rejects.toThrow(BadDataException);
    await expect(runOnBeforeCreate(model)).rejects.toThrow(
      "Monitor Status projectId is required",
    );
  });
});

describe("MonitorStatusService.onBeforeUpdate", () => {
  test("a signed-in caller can move a status - the dashboard drags it", async () => {
    await expect(runOnBeforeUpdate({ priority: 3 }, false)).resolves.toEqual(
      expect.objectContaining({
        updateBy: expect.objectContaining({ data: { priority: 3 } }),
      }),
    );
  });

  test("a root priority update is allowed too", async () => {
    await expect(
      runOnBeforeUpdate({ priority: 3 }, true),
    ).resolves.toBeDefined();
  });

  test("an update that does not touch the priority is untouched", async () => {
    await expect(
      runOnBeforeUpdate({ name: "Renamed" }, false),
    ).resolves.toBeDefined();
    expect(listQueries).toHaveLength(0);
  });
});

describe("MonitorStatusService.onBeforeDelete", () => {
  test("rejects a non-root delete that does not target a specific _id", async () => {
    await expect(runOnBeforeDelete(undefined)).rejects.toThrow(
      "_id should be present when deleting Monitor Status",
    );
  });

  test("refuses to delete the project's only operational status, and says why", async () => {
    await expect(runOnBeforeDelete(OPERATIONAL_ID)).rejects.toThrow(
      '"Operational" is the operational status of this project, and monitors need one. It can be renamed, but not deleted.',
    );
  });

  test("refuses to delete the project's only offline status", async () => {
    await expect(runOnBeforeDelete(OFFLINE_ID)).rejects.toThrow(
      '"Offline" is the offline status of this project',
    );
  });

  test("deletes a status the project added itself", async () => {
    jest
      .spyOn(
        MonitorStatusService as unknown as {
          clearDeletedMonitorReferences: () => Promise<void>;
        },
        "clearDeletedMonitorReferences",
      )
      .mockImplementation((() => {
        return Promise.resolve();
      }) as never);

    await expect(runOnBeforeDelete(DEGRADED_ID)).resolves.toBeDefined();
  });

  test("deletes an operational status while another one remains", async () => {
    listRows = [
      ...SEEDED,
      {
        _id: SECOND_OPERATIONAL_ID,
        name: "TF Operational",
        priority: 99,
        isOperationalState: true,
      },
    ];

    jest
      .spyOn(
        MonitorStatusService as unknown as {
          clearDeletedMonitorReferences: () => Promise<void>;
        },
        "clearDeletedMonitorReferences",
      )
      .mockImplementation((() => {
        return Promise.resolve();
      }) as never);

    await expect(
      runOnBeforeDelete(SECOND_OPERATIONAL_ID),
    ).resolves.toBeDefined();
  });

  test("the rows to delete are read in the caller's project only", async () => {
    await expect(runOnBeforeDelete(OPERATIONAL_ID)).rejects.toThrow(
      BadDataException,
    );

    expect(targetQueries[0]!["projectId"]?.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a refused delete changes nothing: the dangling references are not touched", async () => {
    const clear: SpyInstance = jest
      .spyOn(
        MonitorStatusService as unknown as {
          clearDeletedMonitorReferences: () => Promise<void>;
        },
        "clearDeletedMonitorReferences",
      )
      .mockImplementation((() => {
        return Promise.resolve();
      }) as never);

    await expect(runOnBeforeDelete(OPERATIONAL_ID)).rejects.toThrow(
      BadDataException,
    );

    expect(clear).not.toHaveBeenCalled();
  });
});
