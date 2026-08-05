import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveMonitorRuleEngineService, {
  SloMonitorSyncResult,
} from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

/*
 * Contract under test - the SLO monitor label rule.
 *
 * An SLO can say "measure every monitor labelled Production" instead of
 * naming monitors one by one. That promise has two halves, and both have to
 * hold or the SLO quietly measures the wrong thing:
 *
 *   - a monitor that starts matching gets attached (whether the rule moved or
 *     the monitor's labels did), and a monitor that stops matching gets
 *     detached again;
 *
 *   - a monitor a human attached by hand is never touched. It is not adopted
 *     into the rule when it happens to match, and - the case that would
 *     actually lose someone's configuration - it is never detached when it
 *     stops matching, or when the rule is deleted outright.
 *
 * The second half is what ServiceLevelObjective.autoAddedMonitors exists for,
 * so most of what follows is about that boundary.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);
const MONITOR_A_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const MONITOR_C_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const LABEL_PRODUCTION_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const LABEL_TIER1_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);
const LABEL_STAGING_ID: ObjectID = new ObjectID(
  "ffffffff-ffff-4fff-8fff-ffffffffffff",
);

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as unknown as Label;
}

function fakeMonitor(id: ObjectID): Monitor {
  return { id: id, _id: id.toString() } as unknown as Monitor;
}

function fakeSlo(fields: {
  id?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  monitorLabels?: Array<ObjectID> | undefined;
  monitors?: Array<ObjectID> | undefined;
  autoAddedMonitors?: Array<ObjectID> | undefined;
}): ServiceLevelObjective {
  const id: ObjectID = fields.id || SLO_ID;

  return {
    id: id,
    _id: id.toString(),
    projectId:
      fields.projectId === undefined ? PROJECT_ID : fields.projectId || null,
    monitorLabels: (fields.monitorLabels || []).map(fakeLabel),
    monitors: (fields.monitors || []).map(fakeMonitor),
    autoAddedMonitors: (fields.autoAddedMonitors || []).map(fakeMonitor),
  } as unknown as ServiceLevelObjective;
}

function fakeMonitorWithLabels(
  labelIds: Array<ObjectID>,
  overrides?: {
    id?: ObjectID | undefined;
    projectId?: ObjectID | null | undefined;
  },
): Monitor {
  return {
    id: overrides?.id || MONITOR_A_ID,
    _id: (overrides?.id || MONITOR_A_ID).toString(),
    projectId:
      overrides?.projectId === undefined ? PROJECT_ID : overrides.projectId,
    labels: labelIds.map(fakeLabel),
  } as unknown as Monitor;
}

/**
 * The ids the engine wrote to one of the two monitor relations, sorted so
 * assertions do not depend on Set iteration order.
 */
function writtenIds(
  updateOneByIdSpy: jest.SpyInstance,
  relation: "monitors" | "autoAddedMonitors",
  callIndex: number = 0,
): Array<string> {
  const call: { data: Record<string, Array<Monitor>> } = updateOneByIdSpy.mock
    .calls[callIndex]![0] as {
    data: Record<string, Array<Monitor>>;
  };

  return (call.data[relation] || [])
    .map((monitor: Monitor) => {
      return monitor.id?.toString() || "";
    })
    .sort();
}

function writtenSloId(
  updateOneByIdSpy: jest.SpyInstance,
  callIndex: number = 0,
): string {
  const call: { id: ObjectID } = updateOneByIdSpy.mock.calls[callIndex]![0] as {
    id: ObjectID;
  };

  return call.id.toString();
}

describe("ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo", () => {
  let updateOneByIdSpy: jest.SpyInstance;
  let sloFindOneByIdSpy: jest.SpyInstance;
  let monitorFindBySpy: jest.SpyInstance;

  beforeEach(() => {
    updateOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);
    sloFindOneByIdSpy = jest.spyOn(ServiceLevelObjectiveService, "findOneById");
    monitorFindBySpy = jest.spyOn(MonitorService, "findBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("attaches every monitor in the project that carries a rule label", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID),
      fakeMonitor(MONITOR_B_ID),
    ]);

    const result: SloMonitorSyncResult =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: SLO_ID,
      });

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
    expect(writtenSloId(updateOneByIdSpy)).toBe(SLO_ID.toString());
    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual(
      [MONITOR_A_ID.toString(), MONITOR_B_ID.toString()].sort(),
    );
    expect(result.monitorIdsAdded.sort()).toEqual(
      [MONITOR_A_ID.toString(), MONITOR_B_ID.toString()].sort(),
    );
    expect(result.monitorIdsRemoved).toEqual([]);
  });

  it("records what it attached in autoAddedMonitors so it can undo it later", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([fakeMonitor(MONITOR_A_ID)]);

    await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
      serviceLevelObjectiveId: SLO_ID,
    });

    expect(writtenIds(updateOneByIdSpy, "autoAddedMonitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
  });

  it("writes as root - the rule is server-side and must not need the caller's permissions", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([fakeMonitor(MONITOR_A_ID)]);

    await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
      serviceLevelObjectiveId: SLO_ID,
    });

    const call: { props: Record<string, unknown> } = updateOneByIdSpy.mock
      .calls[0]![0] as { props: Record<string, unknown> };
    expect(call.props).toEqual({ isRoot: true });
  });

  it("matches on any of the rule's labels, not all of them", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({ monitorLabels: [LABEL_PRODUCTION_ID, LABEL_TIER1_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([fakeMonitor(MONITOR_A_ID)]);

    await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
      serviceLevelObjectiveId: SLO_ID,
    });

    const query: { projectId: ObjectID; labels: Array<ObjectID> } =
      monitorFindBySpy.mock.calls[0]![0]!.query;

    expect(query.projectId).toEqual(PROJECT_ID);
    expect(
      query.labels.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([LABEL_PRODUCTION_ID.toString(), LABEL_TIER1_ID.toString()]);
  });

  it("scopes the monitor lookup to the SLO's own project", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({
        projectId: OTHER_PROJECT_ID,
        monitorLabels: [LABEL_PRODUCTION_ID],
      }),
    );
    monitorFindBySpy.mockResolvedValue([]);

    await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
      serviceLevelObjectiveId: SLO_ID,
    });

    expect(monitorFindBySpy.mock.calls[0]![0]!.query.projectId).toEqual(
      OTHER_PROJECT_ID,
    );
  });

  it("leaves a hand-attached monitor out of autoAddedMonitors even when it matches the rule", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [MONITOR_A_ID],
        autoAddedMonitors: [],
      }),
    );
    // Monitor A matches the rule, but a human put it there first.
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID),
      fakeMonitor(MONITOR_B_ID),
    ]);

    const result: SloMonitorSyncResult =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: SLO_ID,
      });

    expect(result.monitorIdsAdded).toEqual([MONITOR_B_ID.toString()]);
    expect(writtenIds(updateOneByIdSpy, "autoAddedMonitors")).toEqual([
      MONITOR_B_ID.toString(),
    ]);
    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual(
      [MONITOR_A_ID.toString(), MONITOR_B_ID.toString()].sort(),
    );
  });

  it("detaches a monitor it had attached once the monitor stops matching", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [MONITOR_A_ID, MONITOR_B_ID],
        autoAddedMonitors: [MONITOR_A_ID, MONITOR_B_ID],
      }),
    );
    monitorFindBySpy.mockResolvedValue([fakeMonitor(MONITOR_A_ID)]);

    const result: SloMonitorSyncResult =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: SLO_ID,
      });

    expect(result.monitorIdsRemoved).toEqual([MONITOR_B_ID.toString()]);
    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
    expect(writtenIds(updateOneByIdSpy, "autoAddedMonitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
  });

  it("never detaches a hand-attached monitor, however badly it fails the rule", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [MONITOR_A_ID, MONITOR_C_ID],
        autoAddedMonitors: [MONITOR_A_ID],
      }),
    );
    // Neither A nor C matches any more; only A is the rule's to take back.
    monitorFindBySpy.mockResolvedValue([]);

    const result: SloMonitorSyncResult =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: SLO_ID,
      });

    expect(result.monitorIdsRemoved).toEqual([MONITOR_A_ID.toString()]);
    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual([
      MONITOR_C_ID.toString(),
    ]);
    expect(writtenIds(updateOneByIdSpy, "autoAddedMonitors")).toEqual([]);
  });

  it("gives back every rule-attached monitor when the rule is cleared, and keeps the manual ones", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({
        monitorLabels: [],
        monitors: [MONITOR_A_ID, MONITOR_B_ID, MONITOR_C_ID],
        autoAddedMonitors: [MONITOR_A_ID, MONITOR_B_ID],
      }),
    );

    const result: SloMonitorSyncResult =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: SLO_ID,
      });

    // No rule means nothing to look up - the monitor query must not even run.
    expect(monitorFindBySpy).not.toHaveBeenCalled();
    expect(result.monitorIdsRemoved.sort()).toEqual(
      [MONITOR_A_ID.toString(), MONITOR_B_ID.toString()].sort(),
    );
    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual([
      MONITOR_C_ID.toString(),
    ]);
    expect(writtenIds(updateOneByIdSpy, "autoAddedMonitors")).toEqual([]);
  });

  it("writes nothing when the rule already agrees with the SLO", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [MONITOR_A_ID, MONITOR_C_ID],
        autoAddedMonitors: [MONITOR_A_ID],
      }),
    );
    monitorFindBySpy.mockResolvedValue([fakeMonitor(MONITOR_A_ID)]);

    const result: SloMonitorSyncResult =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: SLO_ID,
      });

    expect(updateOneByIdSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ monitorIdsAdded: [], monitorIdsRemoved: [] });
  });

  it("writes nothing for an SLO with neither a rule nor anything it attached", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({ monitorLabels: [], monitors: [MONITOR_C_ID] }),
    );

    await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
      serviceLevelObjectiveId: SLO_ID,
    });

    expect(updateOneByIdSpy).not.toHaveBeenCalled();
  });

  it("re-attaches a monitor that is recorded as rule-attached but has gone missing from the list", async () => {
    /*
     * Bookkeeping drift, e.g. a monitor removed straight out of the Monitors
     * picker while the rule still claims it. The sync is authoritative and
     * repairs it rather than leaving the two relations disagreeing.
     */
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [],
        autoAddedMonitors: [MONITOR_A_ID],
      }),
    );
    monitorFindBySpy.mockResolvedValue([fakeMonitor(MONITOR_A_ID)]);

    const result: SloMonitorSyncResult =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: SLO_ID,
      });

    expect(result.monitorIdsAdded).toEqual([MONITOR_A_ID.toString()]);
    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
  });

  it("does nothing for an SLO it cannot read", async () => {
    sloFindOneByIdSpy.mockResolvedValue(null);

    const result: SloMonitorSyncResult =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: SLO_ID,
      });

    expect(monitorFindBySpy).not.toHaveBeenCalled();
    expect(updateOneByIdSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ monitorIdsAdded: [], monitorIdsRemoved: [] });
  });

  it("does nothing for an SLO with no project - there is no tenant to scope the lookup to", async () => {
    sloFindOneByIdSpy.mockResolvedValue(
      fakeSlo({ projectId: null as unknown as ObjectID }),
    );

    await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
      serviceLevelObjectiveId: SLO_ID,
    });

    expect(monitorFindBySpy).not.toHaveBeenCalled();
    expect(updateOneByIdSpy).not.toHaveBeenCalled();
  });

  it("reads the relations it needs to decide - the rule, the list, and the bookkeeping", async () => {
    sloFindOneByIdSpy.mockResolvedValue(fakeSlo({ monitorLabels: [] }));

    await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
      serviceLevelObjectiveId: SLO_ID,
    });

    const select: Record<string, unknown> =
      sloFindOneByIdSpy.mock.calls[0]![0]!.select;

    expect(Object.keys(select).sort()).toEqual([
      "_id",
      "autoAddedMonitors",
      "monitorLabels",
      "monitors",
      "projectId",
    ]);
  });
});

describe("ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor", () => {
  let updateOneByIdSpy: jest.SpyInstance;
  let sloFindBySpy: jest.SpyInstance;
  let monitorFindOneByIdSpy: jest.SpyInstance;

  beforeEach(() => {
    updateOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);
    sloFindBySpy = jest.spyOn(ServiceLevelObjectiveService, "findBy");
    monitorFindOneByIdSpy = jest.spyOn(MonitorService, "findOneById");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("attaches the monitor to an SLO whose rule its new labels satisfy", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_PRODUCTION_ID]),
    );
    sloFindBySpy.mockResolvedValue([
      fakeSlo({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    ]);

    const results: Array<SloMonitorSyncResult> =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
    expect(writtenIds(updateOneByIdSpy, "autoAddedMonitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]!.monitorIdsAdded).toEqual([MONITOR_A_ID.toString()]);
  });

  it("detaches the monitor once its last matching label is taken away", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_STAGING_ID]),
    );
    sloFindBySpy.mockResolvedValue([
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [MONITOR_A_ID],
        autoAddedMonitors: [MONITOR_A_ID],
      }),
    ]);

    const results: Array<SloMonitorSyncResult> =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual([]);
    expect(writtenIds(updateOneByIdSpy, "autoAddedMonitors")).toEqual([]);
    expect(results[0]!.monitorIdsRemoved).toEqual([MONITOR_A_ID.toString()]);
  });

  it("detaches the monitor when every label is cleared at once", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(fakeMonitorWithLabels([]));
    sloFindBySpy.mockResolvedValue([
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [MONITOR_A_ID],
        autoAddedMonitors: [MONITOR_A_ID],
      }),
    ]);

    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: MONITOR_A_ID,
    });

    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual([]);
  });

  it("leaves the other monitors an SLO's rule attached exactly where they are", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_STAGING_ID]),
    );
    sloFindBySpy.mockResolvedValue([
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [MONITOR_A_ID, MONITOR_B_ID, MONITOR_C_ID],
        autoAddedMonitors: [MONITOR_A_ID, MONITOR_B_ID],
      }),
    ]);

    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: MONITOR_A_ID,
    });

    /*
     * Only monitor A's membership was in question. B keeps its rule-attached
     * status without the engine re-checking B's labels, and the manual C is
     * untouched.
     */
    expect(writtenIds(updateOneByIdSpy, "monitors")).toEqual(
      [MONITOR_B_ID.toString(), MONITOR_C_ID.toString()].sort(),
    );
    expect(writtenIds(updateOneByIdSpy, "autoAddedMonitors")).toEqual([
      MONITOR_B_ID.toString(),
    ]);
  });

  it("never touches an SLO with no label rule - that list is curated by hand", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_PRODUCTION_ID]),
    );
    sloFindBySpy.mockResolvedValue([
      fakeSlo({ monitorLabels: [], monitors: [] }),
    ]);

    const results: Array<SloMonitorSyncResult> =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(updateOneByIdSpy).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("does not detach a monitor a human attached to a rule-driven SLO", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_STAGING_ID]),
    );
    sloFindBySpy.mockResolvedValue([
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [MONITOR_A_ID],
        autoAddedMonitors: [],
      }),
    ]);

    const results: Array<SloMonitorSyncResult> =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(updateOneByIdSpy).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("does not adopt a hand-attached monitor into the rule when it starts matching", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_PRODUCTION_ID]),
    );
    sloFindBySpy.mockResolvedValue([
      fakeSlo({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitors: [MONITOR_A_ID],
        autoAddedMonitors: [],
      }),
    ]);

    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: MONITOR_A_ID,
    });

    // Already attached and still manual: nothing to write, nothing to adopt.
    expect(updateOneByIdSpy).not.toHaveBeenCalled();
  });

  it("applies every rule in the project, not just the first one that matches", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_PRODUCTION_ID]),
    );
    sloFindBySpy.mockResolvedValue([
      fakeSlo({ id: SLO_ID, monitorLabels: [LABEL_PRODUCTION_ID] }),
      fakeSlo({ id: OTHER_SLO_ID, monitorLabels: [LABEL_PRODUCTION_ID] }),
    ]);

    const results: Array<SloMonitorSyncResult> =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(2);
    expect(writtenSloId(updateOneByIdSpy, 0)).toBe(SLO_ID.toString());
    expect(writtenSloId(updateOneByIdSpy, 1)).toBe(OTHER_SLO_ID.toString());
    expect(results).toHaveLength(2);
  });

  it("carries on with the remaining SLOs when one of them fails to write", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_PRODUCTION_ID]),
    );
    sloFindBySpy.mockResolvedValue([
      fakeSlo({ id: SLO_ID, monitorLabels: [LABEL_PRODUCTION_ID] }),
      fakeSlo({ id: OTHER_SLO_ID, monitorLabels: [LABEL_PRODUCTION_ID] }),
    ]);
    updateOneByIdSpy
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(1);

    const results: Array<SloMonitorSyncResult> =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });

  it("looks up the SLOs of the monitor's own project", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_PRODUCTION_ID], {
        projectId: OTHER_PROJECT_ID,
      }),
    );
    sloFindBySpy.mockResolvedValue([]);

    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: MONITOR_A_ID,
      projectId: PROJECT_ID,
    });

    // The monitor row wins over the caller's hint - it cannot be stale.
    expect(sloFindBySpy.mock.calls[0]![0]!.query.projectId).toEqual(
      OTHER_PROJECT_ID,
    );
  });

  it("falls back to the caller's project when the monitor row does not carry one", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_PRODUCTION_ID], { projectId: null }),
    );
    sloFindBySpy.mockResolvedValue([]);

    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: MONITOR_A_ID,
      projectId: PROJECT_ID,
    });

    expect(sloFindBySpy.mock.calls[0]![0]!.query.projectId).toEqual(PROJECT_ID);
  });

  it("does nothing for a monitor that no longer exists", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(null);

    const results: Array<SloMonitorSyncResult> =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
        monitorId: MONITOR_A_ID,
        projectId: PROJECT_ID,
      });

    expect(sloFindBySpy).not.toHaveBeenCalled();
    expect(updateOneByIdSpy).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("does nothing when no project can be determined at all", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitorWithLabels([LABEL_PRODUCTION_ID], { projectId: null }),
    );

    const results: Array<SloMonitorSyncResult> =
      await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(sloFindBySpy).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});

describe("ServiceLevelObjectiveMonitorRuleEngineService.doesLabelSetMatchRule", () => {
  const cases: Array<{
    label: string;
    labelIds: Array<string>;
    ruleLabelIds: Array<string>;
    expected: boolean;
  }> = [
    {
      label: "one shared label is enough",
      labelIds: ["a", "b"],
      ruleLabelIds: ["b", "c"],
      expected: true,
    },
    {
      label: "no overlap does not match",
      labelIds: ["a"],
      ruleLabelIds: ["b"],
      expected: false,
    },
    {
      label: "a monitor with no labels never matches",
      labelIds: [],
      ruleLabelIds: ["a"],
      expected: false,
    },
    {
      label: "an empty rule matches nothing, not everything",
      labelIds: ["a"],
      ruleLabelIds: [],
      expected: false,
    },
    {
      label: "both empty is still no match",
      labelIds: [],
      ruleLabelIds: [],
      expected: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.label, () => {
      expect(
        ServiceLevelObjectiveMonitorRuleEngineService.doesLabelSetMatchRule({
          labelIds: new Set(testCase.labelIds),
          ruleLabelIds: new Set(testCase.ruleLabelIds),
        }),
      ).toBe(testCase.expected);
    });
  }
});
