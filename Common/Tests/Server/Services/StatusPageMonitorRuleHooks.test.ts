import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageMonitorRule from "../../../Models/DatabaseModels/StatusPageMonitorRule";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import LabelService from "../../../Server/Services/LabelService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import StatusPageMonitorRuleEngineService from "../../../Server/Services/StatusPageMonitorRuleEngineService";
import StatusPageMonitorRuleService from "../../../Server/Services/StatusPageMonitorRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

/*
 * Contract under test - the places that have to notice a status page monitor
 * rule became stale, plus the guardrails on writing one. The engine itself is
 * covered separately; what matters here is that something actually calls it,
 * and that a half-filled form is refused rather than silently interpreted.
 *
 *   - MonitorService, when a monitor is created, and when its labels, name or
 *     description change. All three are match criteria, so all three can pull
 *     a monitor onto a status page or push it off one.
 *
 *   - LabelService, when a label is deleted. Postgres cascades the rule's join
 *     rows away without any service hook firing, so a rule that used that
 *     label would otherwise keep monitors nothing explains.
 *
 *   - StatusPageMonitorRuleService itself, on create, update and delete.
 *
 * Every sync is best-effort: it must never fail the write that triggered it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const LABEL_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_RULE_ID: ObjectID = new ObjectID(
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

function ruleCreate(
  data: Record<string, unknown>,
): CreateBy<StatusPageMonitorRule> {
  return {
    data: data,
    props: { isRoot: true, tenantId: PROJECT_ID },
  } as unknown as CreateBy<StatusPageMonitorRule>;
}

function ruleUpdate(
  data: Record<string, unknown>,
): OnUpdate<StatusPageMonitorRule> {
  return {
    updateBy: {
      query: { _id: RULE_ID.toString() },
      data: data,
      props: { isRoot: true, tenantId: PROJECT_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<StatusPageMonitorRule>,
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

function fakeRuleRow(id: ObjectID): StatusPageMonitorRule {
  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    statusPageId: STATUS_PAGE_ID,
  } as unknown as StatusPageMonitorRule;
}

describe("MonitorService.onUpdateSuccess - keeping status page monitor rules honest", () => {
  let syncRulesForMonitorSpy: jest.SpyInstance;

  beforeEach(() => {
    syncRulesForMonitorSpy = jest
      .spyOn(StatusPageMonitorRuleEngineService, "syncRulesForMonitor")
      .mockResolvedValue([]);

    jest
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

  it("re-runs the rules when a monitor gains a label", async () => {
    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ labels: [{ _id: LABEL_ID.toString() }] }),
      [MONITOR_ID],
    );

    expect(syncRulesForMonitorSpy).toHaveBeenCalledTimes(1);
    expect(syncRulesForMonitorSpy).toHaveBeenCalledWith({
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

    expect(syncRulesForMonitorSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * Name and description are match criteria for these rules even though they
   * are not for SLO rules, so a rename genuinely can move a monitor between
   * status pages.
   */
  it("re-runs them when a monitor is renamed", async () => {
    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ name: "api-checkout" }),
      [MONITOR_ID],
    );

    expect(syncRulesForMonitorSpy).toHaveBeenCalledTimes(1);
  });

  it("re-runs them when a monitor's description changes", async () => {
    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ description: "now tier-1" }),
      [MONITOR_ID],
    );

    expect(syncRulesForMonitorSpy).toHaveBeenCalledTimes(1);
  });

  it("re-runs them for every monitor a bulk edit touched", async () => {
    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ labels: [{ _id: LABEL_ID.toString() }] }),
      [MONITOR_ID, OTHER_MONITOR_ID],
    );

    expect(syncRulesForMonitorSpy).toHaveBeenCalledTimes(2);
    expect(syncRulesForMonitorSpy).toHaveBeenNthCalledWith(2, {
      monitorId: OTHER_MONITOR_ID,
      projectId: PROJECT_ID,
    });
  });

  it("does not run them for an edit that cannot change what a rule matches", async () => {
    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ disableActiveMonitoring: true }),
      [MONITOR_ID],
    );

    expect(syncRulesForMonitorSpy).not.toHaveBeenCalled();
  });

  it("does not fail the monitor update when the sync throws", async () => {
    syncRulesForMonitorSpy.mockRejectedValue(new Error("db down"));

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
    syncRulesForMonitorSpy
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce([]);

    await callHook(
      MonitorService,
      "onUpdateSuccess",
      monitorUpdate({ labels: [] }),
      [MONITOR_ID, OTHER_MONITOR_ID],
    );

    expect(syncRulesForMonitorSpy).toHaveBeenCalledTimes(2);
  });
});

describe("LabelService delete hooks - a deleted label must not strand resources", () => {
  let syncResourcesForRuleSpy: jest.SpyInstance;
  let ruleFindBySpy: jest.SpyInstance;

  beforeEach(() => {
    syncResourcesForRuleSpy = jest
      .spyOn(StatusPageMonitorRuleEngineService, "syncResourcesForRule")
      .mockResolvedValue({
        monitorIdsAdded: [],
        statusPageResourceIdsRemoved: [],
      });

    jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncMonitorsForSlo",
      )
      .mockResolvedValue({ monitorIdsAdded: [], monitorIdsRemoved: [] });
    jest.spyOn(ServiceLevelObjectiveService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(LabelService, "findBy")
      .mockResolvedValue([fakeLabelRow(LABEL_ID)]);
    ruleFindBySpy = jest
      .spyOn(StatusPageMonitorRuleService, "findBy")
      .mockResolvedValue([fakeRuleRow(RULE_ID), fakeRuleRow(OTHER_RULE_ID)]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("notes down the rules that used the label while it still exists", async () => {
    const onDelete: OnDelete<Label> = (await callHook(
      LabelService,
      "onBeforeDelete",
      { query: { _id: LABEL_ID.toString() }, props: { isRoot: true } },
    )) as OnDelete<Label>;

    expect(ruleFindBySpy).toHaveBeenCalledTimes(1);
    expect(
      (
        onDelete.carryForward as {
          statusPageMonitorRuleIds: Array<ObjectID>;
        }
      ).statusPageMonitorRuleIds,
    ).toEqual([RULE_ID, OTHER_RULE_ID]);
  });

  it("re-runs each of those rules once the label is gone", async () => {
    await callHook(LabelService, "onDeleteSuccess", {
      deleteBy: {} as unknown as DeleteBy<Label>,
      carryForward: {
        serviceLevelObjectiveIds: [],
        statusPageMonitorRuleIds: [RULE_ID, OTHER_RULE_ID],
      },
    } as OnDelete<Label>);

    expect(syncResourcesForRuleSpy).toHaveBeenCalledTimes(2);
    expect(syncResourcesForRuleSpy).toHaveBeenNthCalledWith(1, {
      statusPageMonitorRuleId: RULE_ID,
    });
  });

  it("does not fail the label delete when a rule sync throws", async () => {
    syncResourcesForRuleSpy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook(LabelService, "onDeleteSuccess", {
        deleteBy: {} as unknown as DeleteBy<Label>,
        carryForward: { statusPageMonitorRuleIds: [RULE_ID] },
      } as OnDelete<Label>),
    ).resolves.toBeDefined();
  });

  it("still deletes the label when collecting the affected rules throws", async () => {
    ruleFindBySpy.mockRejectedValue(new Error("db down"));

    const onDelete: OnDelete<Label> = (await callHook(
      LabelService,
      "onBeforeDelete",
      { query: { _id: LABEL_ID.toString() }, props: { isRoot: true } },
    )) as OnDelete<Label>;

    expect(
      (
        onDelete.carryForward as {
          statusPageMonitorRuleIds: Array<ObjectID>;
        }
      ).statusPageMonitorRuleIds,
    ).toEqual([]);
  });
});

describe("StatusPageMonitorRuleService.onBeforeCreate - refusing an ambiguous rule", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses a rule with no match criteria rather than claiming every monitor", async () => {
    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onBeforeCreate",
        ruleCreate({ statusPageId: STATUS_PAGE_ID, name: "Everything" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("names the escape hatch in the error, so the refusal is actionable", async () => {
    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onBeforeCreate",
        ruleCreate({ statusPageId: STATUS_PAGE_ID, name: "Everything" }),
      ),
    ).rejects.toThrow(/\.\*/);
  });

  it("accepts a rule that only names labels", async () => {
    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onBeforeCreate",
        ruleCreate({
          statusPageId: STATUS_PAGE_ID,
          name: "Production",
          monitorLabels: [fakeLabelRow(LABEL_ID)],
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("accepts a rule that only names a name pattern", async () => {
    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onBeforeCreate",
        ruleCreate({
          statusPageId: STATUS_PAGE_ID,
          name: "APIs",
          monitorNamePattern: "^api",
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("accepts a rule that only names a description pattern", async () => {
    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onBeforeCreate",
        ruleCreate({
          statusPageId: STATUS_PAGE_ID,
          name: "Tier 1",
          monitorDescriptionPattern: "tier-1",
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("requires a status page - a rule with nowhere to add monitors is meaningless", async () => {
    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onBeforeCreate",
        ruleCreate({ name: "Orphan", monitorNamePattern: ".*" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * An invalid regex would otherwise be accepted and then silently match
   * nothing forever, which reads as "the rule is broken" with no clue why.
   */
  it("rejects a name pattern that is not a valid regex", async () => {
    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onBeforeCreate",
        ruleCreate({
          statusPageId: STATUS_PAGE_ID,
          name: "Broken",
          monitorNamePattern: "([unclosed",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a description pattern that is not a valid regex", async () => {
    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onBeforeCreate",
        ruleCreate({
          statusPageId: STATUS_PAGE_ID,
          name: "Broken",
          monitorDescriptionPattern: "*nope",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("StatusPageMonitorRuleService write hooks - running the rule", () => {
  let syncResourcesForRuleSpy: jest.SpyInstance;
  let removeResourcesSpy: jest.SpyInstance;
  let ruleFindBySpy: jest.SpyInstance;

  beforeEach(() => {
    syncResourcesForRuleSpy = jest
      .spyOn(StatusPageMonitorRuleEngineService, "syncResourcesForRule")
      .mockResolvedValue({
        monitorIdsAdded: [],
        statusPageResourceIdsRemoved: [],
      });
    removeResourcesSpy = jest
      .spyOn(StatusPageMonitorRuleEngineService, "removeResourcesAddedByRule")
      .mockResolvedValue([]);
    ruleFindBySpy = jest
      .spyOn(StatusPageMonitorRuleService, "findBy")
      .mockResolvedValue([fakeRuleRow(RULE_ID)]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Backfill. A rule that only applied to monitors created after it would be
   * useless for the case the feature exists for - a project that already has
   * dozens of monitors.
   */
  it("runs a new rule against the monitors that already exist", async () => {
    await callHook(
      StatusPageMonitorRuleService,
      "onCreateSuccess",
      {
        createBy: ruleCreate({}),
        carryForward: null,
      } as OnCreate<StatusPageMonitorRule>,
      fakeRuleRow(RULE_ID),
    );

    expect(syncResourcesForRuleSpy).toHaveBeenCalledWith({
      statusPageMonitorRuleId: RULE_ID,
    });
  });

  it("does not fail the create when the backfill throws", async () => {
    syncResourcesForRuleSpy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onCreateSuccess",
        {
          createBy: ruleCreate({}),
          carryForward: null,
        } as OnCreate<StatusPageMonitorRule>,
        fakeRuleRow(RULE_ID),
      ),
    ).resolves.toBeDefined();
  });

  it("re-runs the rule after it is edited", async () => {
    await callHook(
      StatusPageMonitorRuleService,
      "onUpdateSuccess",
      ruleUpdate({ monitorNamePattern: "^api" }),
      [RULE_ID],
    );

    expect(syncResourcesForRuleSpy).toHaveBeenCalledWith({
      statusPageMonitorRuleId: RULE_ID,
    });
  });

  it("re-runs every rule a bulk edit touched", async () => {
    await callHook(
      StatusPageMonitorRuleService,
      "onUpdateSuccess",
      ruleUpdate({ isEnabled: false }),
      [RULE_ID, OTHER_RULE_ID],
    );

    expect(syncResourcesForRuleSpy).toHaveBeenCalledTimes(2);
  });

  it("does not fail the edit when the re-run throws", async () => {
    syncResourcesForRuleSpy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook(
        StatusPageMonitorRuleService,
        "onUpdateSuccess",
        ruleUpdate({ isEnabled: false }),
        [RULE_ID],
      ),
    ).resolves.toBeDefined();
  });

  it("rejects an edit that would leave an invalid regex on the rule", async () => {
    await expect(
      callHook(StatusPageMonitorRuleService, "onBeforeUpdate", {
        query: { _id: RULE_ID.toString() },
        data: { monitorNamePattern: "([unclosed" },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * An edit can empty a rule out as easily as a create can. The check has to
   * run against the merged rule, not just the fields the edit mentions.
   */
  it("rejects an edit that would strip the rule's last match criterion", async () => {
    ruleFindBySpy.mockResolvedValue([
      {
        ...fakeRuleRow(RULE_ID),
        monitorLabels: [fakeLabelRow(LABEL_ID)],
      } as unknown as StatusPageMonitorRule,
    ]);

    await expect(
      callHook(StatusPageMonitorRuleService, "onBeforeUpdate", {
        query: { _id: RULE_ID.toString() },
        data: { monitorLabels: [] },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("allows clearing the labels when a stored name pattern still matches monitors", async () => {
    ruleFindBySpy.mockResolvedValue([
      {
        ...fakeRuleRow(RULE_ID),
        monitorLabels: [fakeLabelRow(LABEL_ID)],
        monitorNamePattern: "^api",
      } as unknown as StatusPageMonitorRule,
    ]);

    await expect(
      callHook(StatusPageMonitorRuleService, "onBeforeUpdate", {
        query: { _id: RULE_ID.toString() },
        data: { monitorLabels: [] },
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();
  });

  it("allows swapping one criterion for another in a single edit", async () => {
    ruleFindBySpy.mockResolvedValue([
      {
        ...fakeRuleRow(RULE_ID),
        monitorLabels: [fakeLabelRow(LABEL_ID)],
      } as unknown as StatusPageMonitorRule,
    ]);

    await expect(
      callHook(StatusPageMonitorRuleService, "onBeforeUpdate", {
        query: { _id: RULE_ID.toString() },
        data: { monitorLabels: [], monitorNamePattern: "^api" },
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();
  });

  it("does not read the rule back for an edit that cannot touch the criteria", async () => {
    await callHook(StatusPageMonitorRuleService, "onBeforeUpdate", {
      query: { _id: RULE_ID.toString() },
      data: { isEnabled: false },
      props: { isRoot: true },
    });

    expect(ruleFindBySpy).not.toHaveBeenCalled();
  });

  /*
   * Deleting a rule has to undo it. The removal runs while the rule row still
   * exists so it goes through StatusPageResourceService rather than through
   * the foreign key's cascade.
   */
  it("removes the resources a rule added before the rule is deleted", async () => {
    await callHook(StatusPageMonitorRuleService, "onBeforeDelete", {
      query: { _id: RULE_ID.toString() },
      props: { isRoot: true },
    } as DeleteBy<StatusPageMonitorRule>);

    expect(removeResourcesSpy).toHaveBeenCalledWith({
      statusPageMonitorRuleId: RULE_ID,
    });
  });

  it("undoes every rule a bulk delete covers", async () => {
    ruleFindBySpy.mockResolvedValue([
      fakeRuleRow(RULE_ID),
      fakeRuleRow(OTHER_RULE_ID),
    ]);

    await callHook(StatusPageMonitorRuleService, "onBeforeDelete", {
      query: { statusPageId: STATUS_PAGE_ID },
      props: { isRoot: true },
    } as DeleteBy<StatusPageMonitorRule>);

    expect(removeResourcesSpy).toHaveBeenCalledTimes(2);
  });

  it("still deletes the rule when the cleanup throws", async () => {
    removeResourcesSpy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook(StatusPageMonitorRuleService, "onBeforeDelete", {
        query: { _id: RULE_ID.toString() },
        props: { isRoot: true },
      } as DeleteBy<StatusPageMonitorRule>),
    ).resolves.toBeDefined();
  });
});
