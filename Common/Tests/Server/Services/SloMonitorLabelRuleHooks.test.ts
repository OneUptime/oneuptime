import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import LabelService from "../../../Server/Services/LabelService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

/*
 * Contract under test - the three places that have to notice a label rule
 * became stale. The engine itself is covered separately; what matters here is
 * that something actually calls it.
 *
 *   - MonitorService, when a monitor's labels change. Keyed on the field
 *     being present rather than non-empty, because clearing every label
 *     arrives as `[]` and is exactly the edit that should detach the monitor
 *     from its rule-driven SLOs.
 *
 *   - LabelService, when a label is deleted. Postgres cascades the rule's
 *     join rows away without any service hook firing, so the SLOs that used
 *     that label would otherwise keep monitors nothing explains.
 *
 * Every one of them is best-effort: the sync must never fail the write that
 * triggered it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const LABEL_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);

// Calls a protected hook without widening the service's public surface.
function callHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = service as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(service, args);
}

function monitorUpdate(data: Record<string, unknown>): OnUpdate<Monitor> {
  return {
    updateBy: {
      query: { _id: MONITOR_ID.toString() },
      data: data,
      props: { isRoot: true, tenantId: PROJECT_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Monitor>,
    carryForward: null,
  };
}

function fakeMonitorRow(): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
    name: "API",
  } as unknown as Monitor;
}

function fakeLabelRow(id: ObjectID): Label {
  return { id: id, _id: id.toString(), name: "Production" } as unknown as Label;
}

function fakeSloRow(id: ObjectID): ServiceLevelObjective {
  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
  } as unknown as ServiceLevelObjective;
}

describe("MonitorService.onUpdateSuccess - keeping SLO label rules honest", () => {
  let syncSlosForMonitorSpy: jest.SpyInstance;

  beforeEach(() => {
    syncSlosForMonitorSpy = jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncSlosForMonitor",
      )
      .mockResolvedValue([]);

    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorRow());
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
    jest.spyOn(LabelService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(MonitorFeedService, "createMonitorFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("re-runs the SLO label rules when a monitor gains a label", async () => {
    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ labels: [{ _id: LABEL_ID.toString() }] }),
      [MONITOR_ID],
    );

    expect(syncSlosForMonitorSpy).toHaveBeenCalledTimes(1);
    expect(syncSlosForMonitorSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
    });
  });

  it("re-runs them when the last label is removed - `[]` is an edit, not an absence", async () => {
    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ labels: [] }),
      [MONITOR_ID],
    );

    expect(syncSlosForMonitorSpy).toHaveBeenCalledTimes(1);
  });

  it("re-runs them for every monitor a bulk label edit touched", async () => {
    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ labels: [{ _id: LABEL_ID.toString() }] }),
      [MONITOR_ID, OTHER_MONITOR_ID],
    );

    expect(syncSlosForMonitorSpy).toHaveBeenCalledTimes(2);
    expect(syncSlosForMonitorSpy).toHaveBeenNthCalledWith(2, {
      monitorId: OTHER_MONITOR_ID,
      projectId: PROJECT_ID,
    });
  });

  it("does not run them for an edit that cannot change SLO membership", async () => {
    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ description: "just a doc tweak" }),
      [MONITOR_ID],
    );

    expect(syncSlosForMonitorSpy).not.toHaveBeenCalled();
  });

  it("does not fail the monitor update when the sync throws", async () => {
    syncSlosForMonitorSpy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook(
        MonitorService,
        "onUpdateSuccess",
        monitorUpdate({ labels: [] }),
        [MONITOR_ID],
      ),
    ).resolves.toBeDefined();
  });

  it("keeps syncing the remaining monitors after one of them fails", async () => {
    syncSlosForMonitorSpy
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce([]);

    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ labels: [] }),
      [MONITOR_ID, OTHER_MONITOR_ID],
    );

    expect(syncSlosForMonitorSpy).toHaveBeenCalledTimes(2);
  });
});

describe("LabelService - a deleted label takes its SLO rule with it", () => {
  let syncMonitorsForSloSpy: jest.SpyInstance;
  let sloFindBySpy: jest.SpyInstance;
  let labelFindBySpy: jest.SpyInstance;

  beforeEach(() => {
    syncMonitorsForSloSpy = jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncMonitorsForSlo",
      )
      .mockResolvedValue({ monitorIdsAdded: [], monitorIdsRemoved: [] });
    sloFindBySpy = jest.spyOn(ServiceLevelObjectiveService, "findBy");
    labelFindBySpy = jest.spyOn(LabelService, "findBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function deleteBy(): DeleteBy<Label> {
    return {
      query: { _id: LABEL_ID.toString() },
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as unknown as DeleteBy<Label>;
  }

  it("notes down the SLOs whose rule uses the label, while the label still exists", async () => {
    labelFindBySpy.mockResolvedValue([fakeLabelRow(LABEL_ID)]);
    sloFindBySpy.mockResolvedValue([
      fakeSloRow(SLO_ID),
      fakeSloRow(OTHER_SLO_ID),
    ]);

    const onDelete: OnDelete<Label> = (await callHook(
      LabelService,
      "onBeforeDelete",
      deleteBy(),
    )) as OnDelete<Label>;

    const query: { monitorLabels: Array<ObjectID> } = sloFindBySpy.mock
      .calls[0]![0]!.query as { monitorLabels: Array<ObjectID> };

    expect(
      query.monitorLabels.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([LABEL_ID.toString()]);

    const carried: { serviceLevelObjectiveIds: Array<ObjectID> } =
      onDelete.carryForward as { serviceLevelObjectiveIds: Array<ObjectID> };

    expect(
      carried.serviceLevelObjectiveIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([SLO_ID.toString(), OTHER_SLO_ID.toString()]);
  });

  it("does not go looking for SLOs when the delete matched no labels", async () => {
    labelFindBySpy.mockResolvedValue([]);

    await callHook(LabelService, "onBeforeDelete", deleteBy());

    expect(sloFindBySpy).not.toHaveBeenCalled();
  });

  it("re-runs the now-smaller rule for each noted SLO once the label is gone", async () => {
    await callHook(
      LabelService,
      "onDeleteSuccess",
      {
        deleteBy: deleteBy(),
        carryForward: { serviceLevelObjectiveIds: [SLO_ID, OTHER_SLO_ID] },
      },
      [LABEL_ID],
    );

    expect(syncMonitorsForSloSpy).toHaveBeenCalledTimes(2);
    expect(syncMonitorsForSloSpy).toHaveBeenNthCalledWith(1, {
      serviceLevelObjectiveId: SLO_ID,
    });
    expect(syncMonitorsForSloSpy).toHaveBeenNthCalledWith(2, {
      serviceLevelObjectiveId: OTHER_SLO_ID,
    });
  });

  it("does nothing after deleting a label no SLO rule referenced", async () => {
    await callHook(
      LabelService,
      "onDeleteSuccess",
      { deleteBy: deleteBy(), carryForward: { serviceLevelObjectiveIds: [] } },
      [LABEL_ID],
    );

    expect(syncMonitorsForSloSpy).not.toHaveBeenCalled();
  });

  it("tolerates a delete that carried nothing forward", async () => {
    await expect(
      callHook(
        LabelService,
        "onDeleteSuccess",
        { deleteBy: deleteBy(), carryForward: null },
        [LABEL_ID],
      ),
    ).resolves.toBeDefined();

    expect(syncMonitorsForSloSpy).not.toHaveBeenCalled();
  });

  it("still deletes the label when the SLO lookup fails", async () => {
    labelFindBySpy.mockRejectedValue(new Error("db down"));

    const onDelete: OnDelete<Label> = (await callHook(
      LabelService,
      "onBeforeDelete",
      deleteBy(),
    )) as OnDelete<Label>;

    expect(
      (onDelete.carryForward as { serviceLevelObjectiveIds: Array<ObjectID> })
        .serviceLevelObjectiveIds,
    ).toEqual([]);
  });

  it("still reports the delete as done when re-running a rule fails", async () => {
    syncMonitorsForSloSpy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook(
        LabelService,
        "onDeleteSuccess",
        {
          deleteBy: deleteBy(),
          carryForward: { serviceLevelObjectiveIds: [SLO_ID] },
        },
        [LABEL_ID],
      ),
    ).resolves.toBeDefined();
  });
});
