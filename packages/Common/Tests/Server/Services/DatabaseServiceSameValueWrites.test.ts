import DatabaseService from "../../../Server/Services/DatabaseService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WRITING THE VALUE A RECORD ALREADY HOLDS IS NOT A CHANGE.
 *
 * DatabaseService._updateBy decides whether an update changed a row with
 * hasSameValues, and that one answer gates the model's on-update workflow,
 * its live update (and, before the write, who could read the row: see
 * DatabaseServiceRealtimeReadAccess) and its audit entry.
 *
 * It read the row through getColumnValue, which answers null for every falsy
 * value - so a switch that was off, a count of 0 and an empty text all read
 * as "nothing", and writing false over false, 0 over 0 or "" over "" counted
 * as a change: every save of a form that sends its switches back started the
 * record's workflows again. Now each column is compared as it is stored:
 * false with false, null with null (and with a column the read did not
 * load), a switch as the boolean the database stores, a time as the instant
 * it names, and a column the update sends as undefined - which writes
 * nothing - is no change at all.
 *
 * No Postgres: the repository and the before-row read are stubbed, and the
 * real update path runs in between, as DatabaseServiceAuditRelationDiff
 * drives it.
 */

jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: (): Promise<void> => {
        return Promise.resolve();
      },
      recordUpdate: (): Promise<void> => {
        return Promise.resolve();
      },
      recordDelete: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

type StubbedRepository = {
  save: jest.Mock;
  update: jest.Mock;
  find: jest.Mock;
};

interface UpdateHarness {
  repository: StubbedRepository;
  workflow: jest.SpyInstance;
  realtime: jest.SpyInstance;
  recordUpdate: jest.SpyInstance;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "5a3e0000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "5a3e0000-0000-4000-8000-0000000000a1",
);

function setUpUpdate<TModel extends BaseModel>(
  service: DatabaseService<TModel>,
  before: TModel,
): UpdateHarness {
  const repository: StubbedRepository = {
    save: jest.fn((item: unknown) => {
      return Promise.resolve(item);
    }),
    update: jest.fn(() => {
      return Promise.resolve({ affected: 1 });
    }),
    find: jest.fn(() => {
      return Promise.resolve([]);
    }),
  };

  jest.spyOn(service, "getRepository").mockReturnValue(repository as never);

  const workflow: jest.SpyInstance = jest
    .spyOn(service, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  const realtime: jest.SpyInstance = jest
    .spyOn(service, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
  const recordUpdate: jest.SpyInstance = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(ModelPermission, "checkUpdatePermissionByModel")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);

  jest
    .spyOn(
      service as unknown as { _findBy: () => Promise<Array<BaseModel>> },
      "_findBy",
    )
    .mockResolvedValue([before] as never);

  return { repository, workflow, realtime, recordUpdate };
}

// A monitor as the read before the write returns it: `columns` and its ids.
function monitorBefore(columns: Record<string, unknown>): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;

  for (const [column, value] of Object.entries(columns)) {
    (monitor as unknown as Record<string, unknown>)[column] = value;
  }

  return monitor;
}

async function updateMonitor(
  before: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<UpdateHarness> {
  const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
    Monitor,
  );
  const harness: UpdateHarness = setUpUpdate(service, monitorBefore(before));

  await service.updateOneById({
    id: MONITOR_ID,
    data: data as never,
    props: { isRoot: true },
  });

  return harness;
}

function expectChangeReported(harness: UpdateHarness): void {
  expect(harness.workflow).toHaveBeenCalledTimes(1);
  expect(harness.workflow.mock.calls[0]![1]).toEqual(PROJECT_ID);
  expect(harness.workflow.mock.calls[0]![2]).toBe("on-update");
  expect(harness.realtime).toHaveBeenCalledTimes(1);
  expect(harness.recordUpdate).toHaveBeenCalledTimes(1);
}

function expectNoChangeReported(harness: UpdateHarness): void {
  expect(harness.workflow).not.toHaveBeenCalled();
  expect(harness.realtime).not.toHaveBeenCalled();
  expect(harness.recordUpdate).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a switch written back as it stands is not a change", () => {
  test("false over false fires no workflow, no live update and no audit entry", async () => {
    const harness: UpdateHarness = await updateMonitor(
      { disableActiveMonitoring: false },
      { disableActiveMonitoring: false },
    );

    expectNoChangeReported(harness);
    // The write itself still goes through: it is the write's side effects that follow a real change.
    expect(harness.repository.update).toHaveBeenCalledTimes(1);
  });

  test("true over true is not a change either", async () => {
    expectNoChangeReported(
      await updateMonitor(
        { disableActiveMonitoring: true },
        { disableActiveMonitoring: true },
      ),
    );
  });

  test.each([
    ['"false"', "false"],
    ['"no"', "no"],
    ['"off"', "off"],
    ['"0"', "0"],
    ["0", 0],
  ] as Array<[string, unknown]>)(
    "false written as %s over false is not a change",
    async (_label: string, value: unknown) => {
      expectNoChangeReported(
        await updateMonitor({ isArchived: false }, { isArchived: value }),
      );
    },
  );

  test.each([
    ['"true"', "true"],
    ['"yes"', "yes"],
    ['"on"', "on"],
    ["1", 1],
  ] as Array<[string, unknown]>)(
    "true written as %s over true is not a change",
    async (_label: string, value: unknown) => {
      expectNoChangeReported(
        await updateMonitor({ isArchived: true }, { isArchived: value }),
      );
    },
  );

  test("a whole form saved back as it stands - several switches, all as they are - is not a change", async () => {
    expectNoChangeReported(
      await updateMonitor(
        {
          disableActiveMonitoring: false,
          isArchived: false,
          isOwnerNotifiedOfResourceCreation: true,
        },
        {
          disableActiveMonitoring: false,
          isArchived: "false",
          isOwnerNotifiedOfResourceCreation: true,
        },
      ),
    );
  });
});

describe("a real change still fires all three", () => {
  test("false to true", async () => {
    expectChangeReported(
      await updateMonitor(
        { disableActiveMonitoring: false },
        { disableActiveMonitoring: true },
      ),
    );
  });

  test("true to false", async () => {
    expectChangeReported(
      await updateMonitor(
        { disableActiveMonitoring: true },
        { disableActiveMonitoring: false },
      ),
    );
  });

  test('true to false, written as "false"', async () => {
    const harness: UpdateHarness = await updateMonitor(
      { disableActiveMonitoring: true },
      { disableActiveMonitoring: "false" },
    );

    expectChangeReported(harness);

    // The workflow and the audit entry are told the value the database stores.
    const updatedFields: JSONObject = (
      harness.workflow.mock.calls[0]![3] as { updatedFields: JSONObject }
    ).updatedFields;
    expect(updatedFields["disableActiveMonitoring"]).toBe(false);
    expect(
      (
        harness.recordUpdate.mock.calls[0]![0] as {
          updatedFields: JSONObject;
        }
      ).updatedFields["disableActiveMonitoring"],
    ).toBe(false);
  });

  test("one switch of several really changing is a change", async () => {
    expectChangeReported(
      await updateMonitor(
        { disableActiveMonitoring: false, isArchived: false },
        { disableActiveMonitoring: false, isArchived: true },
      ),
    );
  });
});

describe("no value, and a value not written, deliberately", () => {
  test("null over null is not a change", async () => {
    expectNoChangeReported(
      await updateMonitor({ description: null }, { description: null }),
    );
  });

  test("null over a column the read did not load is not a change", async () => {
    expectNoChangeReported(await updateMonitor({}, { description: null }));
  });

  test("a switch set to no value (null) where it was off is a change: the stored value is different", async () => {
    expectChangeReported(
      await updateMonitor(
        { disableActiveMonitoring: false },
        { disableActiveMonitoring: null },
      ),
    );
  });

  test("a switch turned off where it held no value is a change", async () => {
    expectChangeReported(
      await updateMonitor(
        { disableActiveMonitoring: null },
        { disableActiveMonitoring: false },
      ),
    );
  });

  test("a column sent as undefined writes nothing, so it is never a change", async () => {
    expectNoChangeReported(
      await updateMonitor(
        { description: "Checks checkout", disableActiveMonitoring: false },
        { description: undefined, disableActiveMonitoring: false },
      ),
    );
  });
});

describe("the other values that read as nothing", () => {
  test("0 over 0 is not a change", async () => {
    expectNoChangeReported(
      await updateMonitor(
        { minimumProbeAgreement: 0 },
        { minimumProbeAgreement: 0 },
      ),
    );
  });

  test("0 over 1 is", async () => {
    expectChangeReported(
      await updateMonitor(
        { minimumProbeAgreement: 1 },
        { minimumProbeAgreement: 0 },
      ),
    );
  });

  test('"" over "" is not a change', async () => {
    expectNoChangeReported(
      await updateMonitor({ description: "" }, { description: "" }),
    );
  });

  test('"" over a text is', async () => {
    expectChangeReported(
      await updateMonitor(
        { description: "Checks checkout" },
        { description: "" },
      ),
    );
  });
});

describe("a time is the instant it names", () => {
  const AT: Date = new Date("2026-10-07T09:15:00.250Z");

  test("the same instant written back as a Date is not a change", async () => {
    expectNoChangeReported(
      await updateMonitor(
        { telemetryMonitorNextMonitorAt: AT },
        { telemetryMonitorNextMonitorAt: new Date(AT.getTime()) },
      ),
    );
  });

  test("the same instant written as an ISO string - a workflow, an API client - is not a change", async () => {
    expectNoChangeReported(
      await updateMonitor(
        { telemetryMonitorNextMonitorAt: AT },
        { telemetryMonitorNextMonitorAt: "2026-10-07T11:15:00.250+02:00" },
      ),
    );
  });

  test("a time a quarter of a second later is a change, though it reads the same to the second", async () => {
    expectChangeReported(
      await updateMonitor(
        { telemetryMonitorNextMonitorAt: AT },
        {
          telemetryMonitorNextMonitorAt: new Date(AT.getTime() + 250),
        },
      ),
    );
  });
});
