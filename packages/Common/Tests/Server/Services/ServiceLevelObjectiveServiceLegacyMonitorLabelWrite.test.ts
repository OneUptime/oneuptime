import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveMonitorRuleService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import SloLegacyMonitorLabelAdoption from "../../../Server/Utils/Slo/SloLegacyMonitorLabelAdoption";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - a write of the deprecated
 * ServiceLevelObjective.monitorLabels column ("Auto-Add Monitors With
 * Labels").
 *
 * The column is still writable - a dashboard tab opened before the upgrade
 * sends it on every save, and so can an API client or a workflow - but nothing
 * on this release read it, so the SLO silently kept measuring something else.
 * Now:
 *
 *   - an SLO with no monitor rule row gets the list as a rule and is re-synced
 *     at once, so its monitors reflect the list immediately; a cleared list
 *     adopts nothing and the sync releases what it attached;
 *   - an SLO that already has monitor rules (enabled or disabled) ignores the
 *     list - with a warning when it changed - and is not synced;
 *   - a CHANGED list is adopted without evidence; the same list re-submitted
 *     by an out-of-date form only with rule-attached monitors as evidence, so
 *     re-saving that form cannot bring back a converted rule the user deleted;
 *   - a create carrying a list gets it as a rule before its first sync;
 *   - none of it can fail the write, and an SLO whose adoption failed is not
 *     synced (the sync would release the list's monitors).
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
const THIRD_SLO_ID: ObjectID = new ObjectID(
  "1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const LABEL_PRODUCTION_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LABEL_STAGING_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MONITOR_A_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MONITOR_B_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Model = ServiceLevelObjective;

interface AdoptionCall {
  projectId: ObjectID;
  serviceLevelObjectiveIds: Array<ObjectID | string>;
  requireRuleAttachedMonitors?: boolean | undefined;
}

// Calls a protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(ServiceLevelObjectiveService, args);
}

function makeSloRow(id: ObjectID, projectId: ObjectID = PROJECT_ID): Model {
  return {
    id: id,
    _id: id.toString(),
    projectId: projectId,
  } as unknown as Model;
}

function sloId(id: ObjectID): string {
  return id.toString().toLowerCase();
}

// `{ _id }` stubs, the shape an old dashboard form and the REST API send.
function labelStubs(ids: Array<string>): Array<{ _id: string }> {
  return ids.map((id: string) => {
    return { _id: id };
  });
}

function makeOnUpdate(data: {
  payload: Record<string, unknown>;
  labelIdsBeforeUpdate?: Dictionary<Array<string>> | null | undefined;
  props?: Record<string, unknown> | undefined;
}): OnUpdate<Model> {
  return {
    updateBy: {
      query: { _id: SLO_ID.toString() },
      data: data.payload,
      props: data.props || { tenantId: PROJECT_ID, userId: USER_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Model>,
    carryForward: {
      feedSnapshot: null,
      monitorLabelIdsBeforeUpdate:
        data.labelIdsBeforeUpdate === undefined
          ? null
          : data.labelIdsBeforeUpdate,
    },
  };
}

interface LegacyWriteSpies {
  sloFindBy: jest.SpyInstance;
  sloIdsWithAnyRule: jest.SpyInstance;
  adoption: jest.SpyInstance;
  sync: jest.SpyInstance;
  warn: jest.SpyInstance;
  error: jest.SpyInstance;
}

function installSpies(): LegacyWriteSpies {
  // Nothing in these payloads disables, archives or re-evaluates the SLO.
  jest
    .spyOn(ServiceLevelObjectiveService, "updateOneById")
    .mockResolvedValue(1);
  jest
    .spyOn(ServiceLevelObjectiveService, "findOneById")
    .mockResolvedValue(null);

  return {
    sloFindBy: jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([makeSloRow(SLO_ID)]),
    sloIdsWithAnyRule: jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleService,
        "findServiceLevelObjectiveIdsWithAnyRule",
      )
      .mockResolvedValue(new Set<string>()),
    adoption: jest
      .spyOn(SloLegacyMonitorLabelAdoption, "adoptLegacyMonitorLabels")
      .mockResolvedValue([]),
    sync: jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncMonitorsForSlo",
      )
      .mockResolvedValue({ monitorIdsAdded: [], monitorIdsRemoved: [] }),
    warn: jest.spyOn(logger, "warn").mockImplementation((() => {
      return undefined;
    }) as never),
    error: jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never),
  };
}

function syncedSloIds(syncSpy: jest.SpyInstance): Array<string> {
  return syncSpy.mock.calls.map((call: Array<unknown>): string => {
    return (
      call[0] as { serviceLevelObjectiveId: ObjectID }
    ).serviceLevelObjectiveId
      .toString()
      .toLowerCase();
  });
}

describe("ServiceLevelObjectiveService.onUpdateSuccess - a write of the deprecated monitorLabels list", () => {
  let spies: LegacyWriteSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("an SLO with no monitor rules gets a changed list as a rule - no evidence needed - and is then re-synced", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: {
          monitorLabels: labelStubs([LABEL_STAGING_ID, LABEL_PRODUCTION_ID]),
        },
        labelIdsBeforeUpdate: { [sloId(SLO_ID)]: [LABEL_PRODUCTION_ID] },
      }),
      [SLO_ID],
    );

    expect(spies.adoption).toHaveBeenCalledTimes(1);
    expect(spies.adoption.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      serviceLevelObjectiveIds: [sloId(SLO_ID)],
      requireRuleAttachedMonitors: false,
    });

    expect(syncedSloIds(spies.sync)).toEqual([sloId(SLO_ID)]);
    expect(spies.adoption.mock.invocationCallOrder[0]!).toBeLessThan(
      spies.sync.mock.invocationCallOrder[0]!,
    );
  });

  it("the same list re-submitted by an out-of-date form (in any id case or order) is adopted only with rule-attached monitors as evidence", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: {
          monitorLabels: labelStubs([
            LABEL_STAGING_ID.toUpperCase(),
            LABEL_PRODUCTION_ID,
          ]),
        },
        labelIdsBeforeUpdate: {
          [sloId(SLO_ID)]: [LABEL_PRODUCTION_ID, LABEL_STAGING_ID],
        },
      }),
      [SLO_ID],
    );

    expect(
      (spies.adoption.mock.calls[0]![0] as AdoptionCall)
        .requireRuleAttachedMonitors,
    ).toBe(true);
    expect(syncedSloIds(spies.sync)).toEqual([sloId(SLO_ID)]);
  });

  it("a list whose before-state could not be read counts as re-submitted - the reading that cannot bring a deleted rule back", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: { monitorLabels: labelStubs([LABEL_PRODUCTION_ID]) },
        labelIdsBeforeUpdate: {},
      }),
      [SLO_ID],
    );

    expect(
      (spies.adoption.mock.calls[0]![0] as AdoptionCall)
        .requireRuleAttachedMonitors,
    ).toBe(true);
  });

  it("a list cleared to empty adopts nothing, and the re-sync releases the monitors it attached", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: { monitorLabels: [] },
        labelIdsBeforeUpdate: { [sloId(SLO_ID)]: [LABEL_PRODUCTION_ID] },
      }),
      [SLO_ID],
    );

    expect(spies.adoption).not.toHaveBeenCalled();
    expect(syncedSloIds(spies.sync)).toEqual([sloId(SLO_ID)]);
  });

  it("an SLO that already has monitor rules ignores a changed list, says so in the log, and is not touched", async () => {
    spies.sloIdsWithAnyRule.mockResolvedValue(new Set<string>([sloId(SLO_ID)]));

    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: { monitorLabels: labelStubs([LABEL_STAGING_ID]) },
        labelIdsBeforeUpdate: { [sloId(SLO_ID)]: [LABEL_PRODUCTION_ID] },
      }),
      [SLO_ID],
    );

    expect(spies.adoption).not.toHaveBeenCalled();
    expect(spies.sync).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.warn.mock.calls[0]![0]).toContain(sloId(SLO_ID));
    expect(spies.warn.mock.calls[0]![0]).toContain("monitor rules");
    expect(spies.warn.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID.toString(),
      serviceLevelObjectiveId: sloId(SLO_ID),
    });
  });

  it("an SLO with rules ignores a re-submitted or cleared list silently - an out-of-date form re-sends it on every save", async () => {
    spies.sloIdsWithAnyRule.mockResolvedValue(new Set<string>([sloId(SLO_ID)]));

    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: { monitorLabels: labelStubs([LABEL_PRODUCTION_ID]) },
        labelIdsBeforeUpdate: { [sloId(SLO_ID)]: [LABEL_PRODUCTION_ID] },
      }),
      [SLO_ID],
    );

    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: { monitorLabels: [] },
        labelIdsBeforeUpdate: {},
      }),
      [SLO_ID],
    );

    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.adoption).not.toHaveBeenCalled();
    expect(spies.sync).not.toHaveBeenCalled();
  });

  it("asks about rules of any kind for exactly the SLOs the write changed, reading their projects as root by id", async () => {
    spies.sloFindBy.mockResolvedValue([
      makeSloRow(SLO_ID),
      makeSloRow(OTHER_SLO_ID),
    ]);

    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ payload: { monitorLabels: [] } }),
      [SLO_ID, OTHER_SLO_ID],
    );

    const findByArgs: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = spies.sloFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(JSON.stringify(findByArgs.query["_id"])).toContain(
      SLO_ID.toString(),
    );
    expect(JSON.stringify(findByArgs.query["_id"])).toContain(
      OTHER_SLO_ID.toString(),
    );
    expect(findByArgs.select).toEqual({ _id: true, projectId: true });
    expect(findByArgs.props).toEqual({ isRoot: true });

    expect(spies.sloIdsWithAnyRule).toHaveBeenCalledWith([
      SLO_ID,
      OTHER_SLO_ID,
    ]);
  });

  it("adopts once per project and per evidence answer, and syncs every SLO without rules", async () => {
    spies.sloFindBy.mockResolvedValue([
      makeSloRow(SLO_ID),
      makeSloRow(OTHER_SLO_ID),
      makeSloRow(THIRD_SLO_ID, OTHER_PROJECT_ID),
    ]);

    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: { monitorLabels: labelStubs([LABEL_PRODUCTION_ID]) },
        labelIdsBeforeUpdate: {
          [sloId(SLO_ID)]: [],
          [sloId(OTHER_SLO_ID)]: [LABEL_PRODUCTION_ID],
          [sloId(THIRD_SLO_ID)]: [LABEL_STAGING_ID],
        },
      }),
      [SLO_ID, OTHER_SLO_ID, THIRD_SLO_ID],
    );

    const calls: Array<AdoptionCall> = spies.adoption.mock.calls.map(
      (call: Array<unknown>): AdoptionCall => {
        return call[0] as AdoptionCall;
      },
    );

    expect(calls).toHaveLength(3);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          projectId: PROJECT_ID,
          serviceLevelObjectiveIds: [sloId(SLO_ID)],
          requireRuleAttachedMonitors: false,
        },
        {
          projectId: PROJECT_ID,
          serviceLevelObjectiveIds: [sloId(OTHER_SLO_ID)],
          requireRuleAttachedMonitors: true,
        },
        {
          projectId: OTHER_PROJECT_ID,
          serviceLevelObjectiveIds: [sloId(THIRD_SLO_ID)],
          requireRuleAttachedMonitors: false,
        },
      ]),
    );

    expect(syncedSloIds(spies.sync).sort()).toEqual(
      [sloId(SLO_ID), sloId(OTHER_SLO_ID), sloId(THIRD_SLO_ID)].sort(),
    );
  });

  it("a failed adoption leaves those SLOs unsynced - the sync would release the list's monitors - and still syncs the rest", async () => {
    spies.sloFindBy.mockResolvedValue([
      makeSloRow(SLO_ID),
      makeSloRow(OTHER_SLO_ID, OTHER_PROJECT_ID),
    ]);
    spies.adoption.mockImplementation((async (
      data: AdoptionCall,
    ): Promise<Array<string>> => {
      if (data.projectId === PROJECT_ID) {
        throw new Error("connection terminated");
      }

      return [];
    }) as never);

    await expect(
      callHook(
        "onUpdateSuccess",
        makeOnUpdate({
          payload: { monitorLabels: labelStubs([LABEL_PRODUCTION_ID]) },
        }),
        [SLO_ID, OTHER_SLO_ID],
      ),
    ).resolves.toBeDefined();

    expect(syncedSloIds(spies.sync)).toEqual([sloId(OTHER_SLO_ID)]);
    expect(spies.error).toHaveBeenCalledWith(
      expect.stringContaining("not re-syncing their monitors"),
      { projectId: PROJECT_ID.toString() },
    );
  });

  it("a failed sync is logged, never fails the update, and does not cost the next SLO its sync", async () => {
    spies.sloFindBy.mockResolvedValue([
      makeSloRow(SLO_ID),
      makeSloRow(OTHER_SLO_ID),
    ]);
    spies.sync.mockRejectedValueOnce(new Error("db down"));

    await expect(
      callHook(
        "onUpdateSuccess",
        makeOnUpdate({ payload: { monitorLabels: [] } }),
        [SLO_ID, OTHER_SLO_ID],
      ),
    ).resolves.toBeDefined();

    expect(syncedSloIds(spies.sync)).toEqual([
      sloId(SLO_ID),
      sloId(OTHER_SLO_ID),
    ]);
    expect(spies.error).toHaveBeenCalledWith(
      expect.stringContaining(`Error applying the monitor rules of SLO`),
    );
  });

  it("never fails the update when even the projects cannot be read", async () => {
    spies.sloFindBy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook(
        "onUpdateSuccess",
        makeOnUpdate({ payload: { monitorLabels: [] } }),
        [SLO_ID],
      ),
    ).resolves.toBeDefined();

    expect(spies.sync).not.toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalledWith(
      expect.stringContaining("deprecated SLO monitor label list"),
    );
  });

  it("handles a root write too - a workflow writes as root", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: { monitorLabels: labelStubs([LABEL_PRODUCTION_ID]) },
        props: { isRoot: true },
      }),
      [SLO_ID],
    );

    expect(spies.adoption).toHaveBeenCalledTimes(1);
    expect(syncedSloIds(spies.sync)).toEqual([sloId(SLO_ID)]);
  });

  it("does none of this for an update that does not write the list, or that matched nothing", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ payload: { name: "Checkout API" } }),
      [SLO_ID],
    );

    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ payload: { monitorLabels: [] } }),
      [],
    );

    expect(spies.sloFindBy).not.toHaveBeenCalled();
    expect(spies.adoption).not.toHaveBeenCalled();
    expect(spies.sync).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveService.onBeforeUpdate - the label list before the write", () => {
  let sloFindBySpy: jest.SpyInstance;

  beforeEach(() => {
    // The feed takes its own snapshot in this hook; it has its own tests.
    jest
      .spyOn(
        ServiceLevelObjectiveService as never,
        "readFeedSnapshotBeforeUpdate" as never,
      )
      .mockResolvedValue(null as never);
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    sloFindBySpy = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([
        {
          id: new ObjectID(SLO_ID.toString().toUpperCase()),
          _id: SLO_ID.toString(),
          monitorLabels: [
            { _id: LABEL_STAGING_ID.toUpperCase() },
            { _id: LABEL_PRODUCTION_ID },
          ] as unknown as Array<Label>,
        } as unknown as Model,
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeUpdateBy(
    payload: Record<string, unknown>,
    props?: Record<string, unknown> | undefined,
  ): UpdateBy<Model> {
    return {
      query: { _id: SLO_ID.toString() },
      data: payload,
      props: props || { tenantId: PROJECT_ID, userId: USER_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Model>;
  }

  it("carries each SLO's list forward, lower-cased and sorted, read as root through the caller's query pinned to the caller's project", async () => {
    const onUpdate: OnUpdate<Model> = (await callHook(
      "onBeforeUpdate",
      makeUpdateBy({ monitorLabels: labelStubs([LABEL_PRODUCTION_ID]) }),
    )) as OnUpdate<Model>;

    expect(onUpdate.carryForward.monitorLabelIdsBeforeUpdate).toEqual({
      [sloId(SLO_ID)]: [LABEL_PRODUCTION_ID, LABEL_STAGING_ID],
    });

    const findByArgs: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = sloFindBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(findByArgs.query).toEqual({
      _id: SLO_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(findByArgs.select).toEqual({
      _id: true,
      monitorLabels: { _id: true },
    });
    expect(findByArgs.props).toEqual({ isRoot: true });
  });

  it("costs no read for an update that does not write the list", async () => {
    const onUpdate: OnUpdate<Model> = (await callHook(
      "onBeforeUpdate",
      makeUpdateBy({ name: "Checkout API" }),
    )) as OnUpdate<Model>;

    expect(onUpdate.carryForward.monitorLabelIdsBeforeUpdate).toBeNull();
    expect(sloFindBySpy).not.toHaveBeenCalled();
  });

  it("never blocks the update when the read fails - every SLO then counts as re-submitting its list", async () => {
    sloFindBySpy.mockRejectedValue(new Error("db down"));

    const onUpdate: OnUpdate<Model> = (await callHook(
      "onBeforeUpdate",
      makeUpdateBy({ monitorLabels: [] }),
    )) as OnUpdate<Model>;

    expect(onUpdate.carryForward.monitorLabelIdsBeforeUpdate).toEqual({});
  });
});

describe("ServiceLevelObjectiveService.onCreateSuccess - a create carrying the deprecated monitorLabels list", () => {
  let adoptionSpy: jest.SpyInstance;
  let syncSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    adoptionSpy = jest
      .spyOn(SloLegacyMonitorLabelAdoption, "adoptLegacyMonitorLabels")
      .mockResolvedValue([sloId(SLO_ID)]);
    syncSpy = jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncMonitorsForSlo",
      )
      .mockResolvedValue({ monitorIdsAdded: [], monitorIdsRemoved: [] });
    errorSpy = jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);
    jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "create")
      .mockResolvedValue(new ServiceLevelObjectiveBurnRateRule());
    jest
      .spyOn(
        ServiceLevelObjectiveService as never,
        "writeSloCreatedFeed" as never,
      )
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeCreated(monitorLabels: unknown): Model {
    return {
      id: SLO_ID,
      _id: SLO_ID.toString(),
      projectId: PROJECT_ID,
      name: "Checkout",
      targetPercentage: 99.9,
      monitorLabels: monitorLabels,
    } as unknown as Model;
  }

  function makeOnCreate(createdItem: Model): OnCreate<Model> {
    return {
      createBy: {
        data: createdItem,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      },
      carryForward: null,
    };
  }

  it("gets the list as a rule - no evidence needed for a brand-new SLO - before the SLO's first sync", async () => {
    const createdItem: Model = makeCreated(labelStubs([LABEL_PRODUCTION_ID]));

    await expect(
      callHook("onCreateSuccess", makeOnCreate(createdItem), createdItem),
    ).resolves.toBe(createdItem);

    expect(adoptionSpy).toHaveBeenCalledTimes(1);
    expect(adoptionSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      serviceLevelObjectiveIds: [SLO_ID],
      requireRuleAttachedMonitors: false,
    });

    expect(syncSpy).toHaveBeenCalledWith({ serviceLevelObjectiveId: SLO_ID });
    expect(adoptionSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      syncSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("adopts nothing for a create without the list, or with an empty one", async () => {
    for (const monitorLabels of [undefined, []]) {
      const createdItem: Model = makeCreated(monitorLabels);

      await callHook("onCreateSuccess", makeOnCreate(createdItem), createdItem);
    }

    expect(adoptionSpy).not.toHaveBeenCalled();
    expect(syncSpy).toHaveBeenCalledTimes(2);
  });

  it("a failed adoption is logged and the create still succeeds, with its sync", async () => {
    adoptionSpy.mockRejectedValue(new Error("connection terminated"));

    const createdItem: Model = makeCreated(labelStubs([LABEL_PRODUCTION_ID]));

    await expect(
      callHook("onCreateSuccess", makeOnCreate(createdItem), createdItem),
    ).resolves.toBe(createdItem);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("deprecated monitor label list of new SLO"),
      { projectId: PROJECT_ID.toString() },
    );
  });
});

/*
 * End to end through the REAL rule engine: a dashboard tab opened before the
 * upgrade saves an SLO that has no monitor rules with labels. Only the
 * database is faked; the adoption follows its SQL's conditions, which
 * SloLegacyMonitorLabelAdoption.test.ts pins.
 */
describe("an out-of-date dashboard tab saving labels on an SLO with no monitor rules", () => {
  let rules: Array<ServiceLevelObjectiveMonitorRule>;
  let attachedMonitorIds: Array<string>;

  function toMonitorStubs(ids: Array<string>): Array<Monitor> {
    return ids.map((id: string): Monitor => {
      return { id: new ObjectID(id), _id: id } as unknown as Monitor;
    });
  }

  beforeEach(() => {
    rules = [];
    attachedMonitorIds = [];

    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);

    jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([makeSloRow(SLO_ID)]);
    jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleService,
        "findServiceLevelObjectiveIdsWithAnyRule",
      )
      .mockImplementation((async (): Promise<Set<string>> => {
        return new Set<string>(
          rules.length > 0 ? [sloId(SLO_ID)] : ([] as Array<string>),
        );
      }) as never);

    jest
      .spyOn(SloLegacyMonitorLabelAdoption, "adoptLegacyMonitorLabels")
      .mockImplementation((async (
        data: AdoptionCall,
      ): Promise<Array<string>> => {
        // Label rows were just written; no rule row; evidence waived.
        if (rules.length > 0 || data.requireRuleAttachedMonitors !== false) {
          return [];
        }

        rules.push({
          id: new ObjectID("44444444-4444-4444-8444-444444444444"),
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          name: "Auto-add monitors with labels",
          isEnabled: true,
          monitorLabels: [
            { id: new ObjectID(LABEL_PRODUCTION_ID), _id: LABEL_PRODUCTION_ID },
          ],
          criteria: undefined,
        } as unknown as ServiceLevelObjectiveMonitorRule);

        return [sloId(SLO_ID)];
      }) as never);

    jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockImplementation((async (): Promise<
        Array<ServiceLevelObjectiveMonitorRule>
      > => {
        return rules;
      }) as never);
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockImplementation((async (): Promise<Model> => {
        return {
          id: SLO_ID,
          _id: SLO_ID.toString(),
          projectId: PROJECT_ID,
          name: "Checkout",
          monitors: toMonitorStubs(attachedMonitorIds),
          autoAddedMonitors: toMonitorStubs(attachedMonitorIds),
        } as unknown as Model;
      }) as never);
    jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockImplementation((async (args: {
        data: Record<string, unknown>;
      }): Promise<number> => {
        if (args.data["monitors"] !== undefined) {
          attachedMonitorIds = (args.data["monitors"] as Array<Monitor>)
            .map((monitor: Monitor): string => {
              return monitor.id!.toString();
            })
            .sort();
        }

        return 1;
      }) as never);
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([
      {
        id: new ObjectID(MONITOR_A_ID),
        _id: MONITOR_A_ID,
        name: "api-a",
        labels: [
          { id: new ObjectID(LABEL_PRODUCTION_ID), _id: LABEL_PRODUCTION_ID },
        ],
      } as unknown as Monitor,
      {
        id: new ObjectID(MONITOR_B_ID),
        _id: MONITOR_B_ID,
        name: "api-b",
        labels: [],
      } as unknown as Monitor,
    ]);
    jest
      .spyOn(
        ServiceLevelObjectiveFeedService,
        "createServiceLevelObjectiveFeedItem",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
      .mockResolvedValue("[SLO Checkout](https://oneuptime.test/slos/1)");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("measures the labelled monitors as soon as the save lands, through a visible rule", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({
        payload: { monitorLabels: labelStubs([LABEL_PRODUCTION_ID]) },
        labelIdsBeforeUpdate: { [sloId(SLO_ID)]: [] },
      }),
      [SLO_ID],
    );

    expect(attachedMonitorIds).toEqual([MONITOR_A_ID]);
    expect(
      rules.map((rule: ServiceLevelObjectiveMonitorRule): string => {
        return rule.name!;
      }),
    ).toEqual(["Auto-add monitors with labels"]);
  });
});
