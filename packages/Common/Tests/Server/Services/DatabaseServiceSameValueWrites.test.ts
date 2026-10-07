import DatabaseService from "../../../Server/Services/DatabaseService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
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

describe("a switch that records who turned it", () => {
  const ARCHIVED_AT: Date = new Date("2026-10-01T08:00:00.000Z");

  test("written back as on, over a monitor archived already, fires nothing and keeps who archived it, and when", async () => {
    const harness: UpdateHarness = await updateMonitor(
      { isArchived: true, archivedAt: ARCHIVED_AT },
      { isArchived: true },
    );

    expectNoChangeReported(harness);

    // The write still goes through, without new stamps for this row.
    const written: Record<string, unknown> = harness.repository.update.mock
      .calls[0]![1] as Record<string, unknown>;
    expect(written["isArchived"]).toBe(true);
    expect(written["archivedAt"]).toBeUndefined();
  });

  test('written as "yes" over an archived monitor fires nothing either', async () => {
    expectNoChangeReported(
      await updateMonitor(
        { isArchived: true, archivedAt: ARCHIVED_AT },
        { isArchived: "yes" },
      ),
    );
  });

  test("archiving a monitor that was not archived is a change, and says when", async () => {
    const harness: UpdateHarness = await updateMonitor(
      { isArchived: false, archivedAt: null },
      { isArchived: true },
    );

    expectChangeReported(harness);

    const written: Record<string, unknown> = harness.repository.update.mock
      .calls[0]![1] as Record<string, unknown>;
    expect(written["archivedAt"]).toBeInstanceOf(Date);
  });
});

describe("relations and ids, written back as they are", () => {
  const LABEL_ID: string = "5a3e0000-0000-4000-8000-0000000000b1";
  const STATUS_ID: string = "5a3e0000-0000-4000-8000-0000000000c1";

  function labelWith(id: string): Label {
    const label: Label = new Label();
    label._id = id;
    return label;
  }

  test("labels written as null, where the monitor has none, are not a change", async () => {
    expectNoChangeReported(await updateMonitor({ labels: [] }, { labels: null }));
  });

  test("the same labels, sent as bare ids, are not a change", async () => {
    expectNoChangeReported(
      await updateMonitor(
        { labels: [labelWith(LABEL_ID)] },
        { labels: [LABEL_ID.toUpperCase()] },
      ),
    );
  });

  test("labels taken off, written as null, are a change", async () => {
    expectChangeReported(
      await updateMonitor({ labels: [labelWith(LABEL_ID)] }, { labels: null }),
    );
  });

  test("an id written back in capitals is the same id: not a change", async () => {
    expectNoChangeReported(
      await updateMonitor(
        { currentMonitorStatusId: new ObjectID(STATUS_ID) },
        { currentMonitorStatusId: STATUS_ID.toUpperCase() },
      ),
    );
  });
});

/*
 * What the workflow is told changed (updatedFields) is what its Listen on
 * filters by: the fields whose values changed, with their new values - not
 * every field the write carried.
 */
describe("the workflow is told the fields that changed", () => {
  function updatedFieldsOf(harness: UpdateHarness): JSONObject {
    expect(harness.workflow).toHaveBeenCalledTimes(1);
    return (harness.workflow.mock.calls[0]![3] as { updatedFields: JSONObject })
      .updatedFields;
  }

  test("a form saved with one field changed tells it only that field", async () => {
    const harness: UpdateHarness = await updateMonitor(
      {
        name: "Checkout API",
        description: "Checks checkout",
        disableActiveMonitoring: false,
      },
      {
        name: "Checkout API",
        description: "Checks the checkout API",
        disableActiveMonitoring: "false",
      },
    );

    expect(updatedFieldsOf(harness)).toEqual({
      description: "Checks the checkout API",
    });
  });

  test("a switch turned off is among them, as false", async () => {
    const harness: UpdateHarness = await updateMonitor(
      { disableActiveMonitoring: true, description: "Checks checkout" },
      { disableActiveMonitoring: "off", description: "Checks checkout" },
    );

    expect(updatedFieldsOf(harness)).toEqual({
      disableActiveMonitoring: false,
    });
  });

  test("a text cleared and a count set to 0 are among them too", async () => {
    const harness: UpdateHarness = await updateMonitor(
      { description: "Checks checkout", minimumProbeAgreement: 2 },
      { description: "", minimumProbeAgreement: 0 },
    );

    expect(updatedFieldsOf(harness)).toEqual({
      description: "",
      minimumProbeAgreement: 0,
    });
  });

  test("the audit entry is still handed every field written, and names the changed ones itself", async () => {
    const harness: UpdateHarness = await updateMonitor(
      { name: "Checkout API", description: "Checks checkout" },
      { name: "Checkout API", description: "Checks the checkout API" },
    );

    expect(
      (
        harness.recordUpdate.mock.calls[0]![0] as {
          updatedFields: JSONObject;
        }
      ).updatedFields,
    ).toEqual({
      name: "Checkout API",
      description: "Checks the checkout API",
    });
  });
});

describe("one write over several rows", () => {
  const OTHER_ID: ObjectID = new ObjectID(
    "5a3e0000-0000-4000-8000-0000000000a2",
  );

  test("only the rows it changes fire their workflow, live update and audit entry", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    const alreadyOff: Monitor = monitorBefore({
      disableActiveMonitoring: false,
    });
    const stillOn: Monitor = monitorBefore({ disableActiveMonitoring: true });
    stillOn._id = OTHER_ID.toString();

    const harness: UpdateHarness = setUpUpdate(service, alreadyOff);
    jest
      .spyOn(
        service as unknown as { _findBy: () => Promise<Array<BaseModel>> },
        "_findBy",
      )
      .mockResolvedValue([alreadyOff, stillOn] as never);

    await service.updateBy({
      query: { projectId: PROJECT_ID },
      data: { disableActiveMonitoring: "false" } as never,
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    // Both rows are written...
    expect(harness.repository.update).toHaveBeenCalledTimes(2);

    // ...but only the one that changed is heard about.
    expect(harness.workflow).toHaveBeenCalledTimes(1);
    expect(String(harness.workflow.mock.calls[0]![0])).toBe(
      OTHER_ID.toString(),
    );
    expect(harness.realtime).toHaveBeenCalledTimes(1);
    expect(String(harness.realtime.mock.calls[0]![0])).toBe(
      OTHER_ID.toString(),
    );
    expect(harness.recordUpdate).toHaveBeenCalledTimes(1);
    expect(
      String(
        (harness.recordUpdate.mock.calls[0]![0] as { itemId: ObjectID })
          .itemId,
      ),
    ).toBe(OTHER_ID.toString());
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
