import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorLabelRuleEngineService from "../../../Server/Services/MonitorLabelRuleEngineService";
import MonitorOwnerRuleEngineService from "../../../Server/Services/MonitorOwnerRuleEngineService";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import StatusPageMonitorRuleEngineService from "../../../Server/Services/StatusPageMonitorRuleEngineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

/*
 * Contract under test - the create-side half of the status page monitor rule
 * trigger, which is how monitors normally arrive on a status page. A rule that
 * only ever noticed EDITS would leave every newly created monitor off the page
 * until somebody happened to touch it again.
 *
 * MonitorService.onCreateSuccess runs its slow work on a detached promise
 * chain (the create response must not wait for it), so these tests call the
 * hook and then wait for the effect rather than awaiting the hook alone.
 *
 * Ordering matters as much as the call itself: the sync has to run AFTER
 * MonitorLabelRuleEngineService, because a monitor created with no labels of
 * its own can still earn them from a label rule, and those labels are exactly
 * what a status page rule is likely to match on.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_STATUS_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
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

function createdMonitor(): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
    name: "Checkout API",
    description: "tier-1",
    // Manual monitors take no probes, which keeps the inline probe step out.
    monitorType: MonitorType.Manual,
    currentMonitorStatusId: MONITOR_STATUS_ID,
  } as unknown as Monitor;
}

function onCreate(): OnCreate<Monitor> {
  return {
    createBy: {
      data: createdMonitor(),
      props: { isRoot: true, tenantId: PROJECT_ID },
    } as unknown as CreateBy<Monitor>,
    carryForward: null,
  };
}

/**
 * The chain is detached, so poll for the effect instead of awaiting the hook.
 * Returns as soon as the predicate holds, or gives up after ~2s so a genuine
 * regression fails loudly rather than hanging the suite.
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 200; attempt++) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }
}

describe("MonitorService.onCreateSuccess - putting a new monitor on the status pages that want it", () => {
  let syncRulesForMonitorSpy: jest.SpyInstance;
  let applyLabelRulesSpy: jest.SpyInstance;
  const callOrder: Array<string> = [];

  beforeEach(() => {
    callOrder.length = 0;

    applyLabelRulesSpy = jest
      .spyOn(MonitorLabelRuleEngineService, "applyRulesToMonitor")
      .mockImplementation(async () => {
        callOrder.push("labelRules");
      });

    syncRulesForMonitorSpy = jest
      .spyOn(StatusPageMonitorRuleEngineService, "syncRulesForMonitor")
      .mockImplementation(async () => {
        callOrder.push("statusPageRules");
        return [];
      });

    jest
      .spyOn(MonitorOwnerRuleEngineService, "applyRulesToMonitor")
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncSlosForMonitor",
      )
      .mockResolvedValue([]);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(createdMonitor());
    /*
     * Private/protected members of the service under test, spied so the hook
     * never reaches the network or the database. Billing is not stubbed: the
     * step is gated on IsBillingEnabled, which is off in tests.
     */
    const service: never = MonitorService as never;

    jest
      .spyOn(service, "handleWorkspaceOperationsAsync" as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service, "refreshMonitorProbeStatus" as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service, "changeMonitorStatus" as never)
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs the status page monitor rules for a monitor that was just created", async () => {
    await callHook(
      MonitorService,
      "onCreateSuccess",
      onCreate(),
      createdMonitor(),
    );

    await waitFor(() => {
      return syncRulesForMonitorSpy.mock.calls.length > 0;
    });

    expect(syncRulesForMonitorSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
    });
  });

  /*
   * A monitor created with no labels can be given some by a MonitorLabelRule.
   * Running the status page rules first would evaluate them against a monitor
   * that has not earned its labels yet, and it would land on no page at all.
   */
  it("runs them after the label rules, so rule-added labels are visible", async () => {
    await callHook(
      MonitorService,
      "onCreateSuccess",
      onCreate(),
      createdMonitor(),
    );

    await waitFor(() => {
      return callOrder.includes("statusPageRules");
    });

    expect(callOrder.indexOf("labelRules")).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf("statusPageRules")).toBeGreaterThan(
      callOrder.indexOf("labelRules"),
    );
  });

  it("does not fail the monitor create when the sync throws", async () => {
    syncRulesForMonitorSpy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook(MonitorService, "onCreateSuccess", onCreate(), createdMonitor()),
    ).resolves.toBeDefined();

    await waitFor(() => {
      return syncRulesForMonitorSpy.mock.calls.length > 0;
    });

    expect(syncRulesForMonitorSpy).toHaveBeenCalled();
  });

  /*
   * The label rule step is wrapped in its own try/catch that returns early on
   * failure. If that early return also skipped the status page sync, a project
   * with a broken label rule would quietly stop putting new monitors on its
   * status pages.
   */
  it("still runs them when the label rules step fails", async () => {
    applyLabelRulesSpy.mockRejectedValue(new Error("label rules down"));

    await callHook(
      MonitorService,
      "onCreateSuccess",
      onCreate(),
      createdMonitor(),
    );

    await waitFor(() => {
      return syncRulesForMonitorSpy.mock.calls.length > 0;
    });

    expect(syncRulesForMonitorSpy).toHaveBeenCalled();
  });
});
