/*
 * Contract under test — WHERE the Network Alert Policy engine is called from,
 * and with what.
 *
 * NetworkAlertPolicyEngineService.test.ts pins what the engine does once it
 * is running. This file pins the seams, because every one of them is a place
 * where a wrong condition means monitors that silently never appear, or a
 * request that hangs for minutes, or a policy row deleted while the monitors
 * it explained stay behind and keep being billed:
 *
 *   - A DEVICE WRITE reconciles inline only for a HANDFUL of devices. One
 *     device is a few queries; a bulk write ("move 1,200 devices into this
 *     site", "archive the warehouse") matches thousands of rows, and
 *     reconciling thousands inside the request would turn one statement into
 *     an hour of monitor provisioning with the caller still waiting. Past the
 *     threshold the write returns and the five-minute sweep converges.
 *   - A DEVICE WRITE reconciles for the SCOPE AXES and for PROVISIONABILITY —
 *     site, role, labels, isArchived, monitoringMethod, probeId — and for
 *     nothing else. A poll writing sysName every five minutes must not start
 *     a reconciliation per device per cycle.
 *   - A DEVICE CREATE reconciles LAST in its out-of-band chain, after the
 *     label and site rules have run. A policy can be scoped by label, and a
 *     discovery import arrives with no labels at all: asking first would
 *     provision nothing and leave the device uncovered until the sweep.
 *   - A POLICY SAVE hands the work over DETACHED. Provisioning a warehouse is
 *     hundreds of monitor creates; doing it inside the save would time out.
 *   - A POLICY DELETE does NOT detach: the monitors go before the row does,
 *     or nothing is left that knows they were the policy's.
 *   - DISABLING pauses, ENABLING resumes, and neither fires when the payload
 *     merely re-sends the value the row already had — the settings form does
 *     that on every save, and it would be a write per monitor each time.
 *   - A TEMPLATE A POLICY USES CANNOT BE DELETED. Both foreign keys are SET
 *     NULL, so without the guard the delete succeeds and the policy quietly
 *     stops covering anything new.
 */

jest.mock("../../../Server/Services/NetworkAlertPolicyEngineService", () => {
  return {
    __esModule: true,
    MAX_INLINE_RECONCILE_DEVICES: 5,
    MAX_MONITORS_PER_POLICY_SYNC: 500,
    default: {
      reconcileDevice: jest.fn(),
      reconcileDevices: jest.fn(),
      syncPolicy: jest.fn(),
      deleteMonitorsOwnedByPolicy: jest.fn(),
      deletePolicyMonitorsForDevices: jest.fn(),
      setPolicyMonitorsPaused: jest.fn(),
      onMonitorTemplateSynced: jest.fn(),
      createRunContext: jest.fn(),
    },
  };
});

import NetworkAlertPolicyEngineService from "../../../Server/Services/NetworkAlertPolicyEngineService";
import NetworkAlertPolicyService from "../../../Server/Services/NetworkAlertPolicyService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkDeviceLabelRuleEngineService from "../../../Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceOwnerRuleEngineService from "../../../Server/Services/NetworkDeviceOwnerRuleEngineService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "../../../Server/Types/Database/Query";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const POLICY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const reconcileDeviceMock: jest.Mock =
  NetworkAlertPolicyEngineService.reconcileDevice as unknown as jest.Mock;
const syncPolicyMock: jest.Mock =
  NetworkAlertPolicyEngineService.syncPolicy as unknown as jest.Mock;
const deletePolicyMonitorsMock: jest.Mock =
  NetworkAlertPolicyEngineService.deleteMonitorsOwnedByPolicy as unknown as jest.Mock;
const setPausedMock: jest.Mock =
  NetworkAlertPolicyEngineService.setPolicyMonitorsPaused as unknown as jest.Mock;

/*
 * The device create and the policy update hand their work to the engine
 * DETACHED, so the assertions have to wait for the microtask chain to drain.
 */
async function flushDetachedWork(): Promise<void> {
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
}

function deviceRow(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = DEVICE_ID;
  device.projectId = PROJECT_ID;
  device.monitoringMethod = NetworkDeviceMonitoringMethod.Probe;
  Object.assign(device, overrides);

  return device;
}

afterEach(() => {
  jest.restoreAllMocks();
  /*
   * reset, not clear. The engine's methods are jest.fn()s from the module
   * factory rather than spies, so restoreAllMocks does not touch them and a
   * mockRejectedValue set by one case would still be in place for the next —
   * where it would abort a loop and make an assertion pass for entirely the
   * wrong reason.
   */
  jest.resetAllMocks();
});

describe("NetworkDeviceService.onCreateSuccess hands the new device to the engine", () => {
  function silenceTheRestOfTheChain(): void {
    jest
      .spyOn(NetworkDeviceLabelRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkDeviceOwnerRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);
  }

  it("reconciles the created device", async () => {
    silenceTheRestOfTheChain();

    await (NetworkDeviceService as any).onCreateSuccess(
      { createBy: { data: {}, props: {} }, carryForward: null },
      deviceRow(),
    );
    await flushDetachedWork();

    expect(reconcileDeviceMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });
  });

  /*
   * ORDER MATTERS. A policy can be scoped by LABEL, and a discovery import
   * creates a device with none — the label rules in this same chain are what
   * put them on. Reconciling before them would evaluate the device against a
   * scope it does not match yet, provision nothing, and leave it uncovered
   * until the five-minute sweep noticed.
   */
  it("reconciles only after the label rules have run", async () => {
    const order: Array<string> = [];

    jest
      .spyOn(NetworkDeviceLabelRuleEngineService, "applyRulesToNetworkDevice")
      .mockImplementation(async (): Promise<void> => {
        order.push("labels");
      });
    jest
      .spyOn(NetworkDeviceOwnerRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockImplementation(async (): Promise<void> => {
        order.push("site");
      });
    reconcileDeviceMock.mockImplementation(async (): Promise<void> => {
      order.push("policies");
    });

    await (NetworkDeviceService as any).onCreateSuccess(
      { createBy: { data: {}, props: {} }, carryForward: null },
      deviceRow(),
    );
    await flushDetachedWork();

    expect(order).toEqual(["labels", "site", "policies"]);
  });

  /*
   * Detached, so a policy that cannot provision — a deleted template, Redis
   * down — must never turn into a failed device import.
   */
  it("does not fail the create when the engine throws", async () => {
    silenceTheRestOfTheChain();
    reconcileDeviceMock.mockRejectedValue(new Error("engine is unhappy"));

    await expect(
      (NetworkDeviceService as any).onCreateSuccess(
        { createBy: { data: {}, props: {} }, carryForward: null },
        deviceRow(),
      ),
    ).resolves.toBeDefined();
    await flushDetachedWork();
  });
});

describe("NetworkDeviceService.onUpdateSuccess reconciles the right writes", () => {
  function runUpdateSuccess(
    data: Record<string, unknown>,
    updatedItemIds: Array<ObjectID>,
    previousDevices: Array<NetworkDevice> = [deviceRow()],
  ): Promise<unknown> {
    return (NetworkDeviceService as any).onUpdateSuccess(
      {
        updateBy: { data: data, query: {}, props: { tenantId: PROJECT_ID } },
        carryForward: { previousDevices: previousDevices },
      },
      updatedItemIds,
    );
  }

  it.each([
    ["siteId", { siteId: ObjectID.generate() }],
    ["the site relation", { site: { _id: ObjectID.generate().toString() } }],
    ["networkDeviceRoleId", { networkDeviceRoleId: ObjectID.generate() }],
    ["labels", { labels: [] }],
    ["isArchived", { isArchived: true }],
    [
      "monitoringMethod",
      { monitoringMethod: NetworkDeviceMonitoringMethod.Monitor },
    ],
    ["probeId", { probeId: ObjectID.generate() }],
  ])(
    "reconciles when the write touches %s",
    async (_name: string, data: Record<string, unknown>) => {
      await runUpdateSuccess(data, [DEVICE_ID]);

      expect(reconcileDeviceMock).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        deviceId: DEVICE_ID,
      });
    },
  );

  /*
   * Every successful SNMP walk rewrites sysName and the poll columns. If
   * those started a reconciliation, an 80,000-device fleet would run 80,000
   * policy passes every five-minute cycle for no change at all.
   */
  it.each([
    ["sysName", { sysName: "core-sw-1" }],
    ["poll columns", { lastPolledAt: new Date(), isReachable: true }],
    ["the name", { name: "Renamed" }],
  ])(
    "does not reconcile for a write that only touches %s",
    async (_name: string, data: Record<string, unknown>) => {
      await runUpdateSuccess(data, [DEVICE_ID]);

      expect(reconcileDeviceMock).not.toHaveBeenCalled();
    },
  );

  /*
   * THE THRESHOLD. Five devices is a form save or a small bulk action and is
   * worth doing inline, so the monitor is there by the next page load. Six is
   * a bulk action whose size nobody bounded, and reconciling it inline is how
   * a one-statement update becomes a request that never returns.
   */
  it("reconciles inline for up to five devices", async () => {
    const deviceIds: Array<ObjectID> = [1, 2, 3, 4, 5].map((): ObjectID => {
      return ObjectID.generate();
    });

    await runUpdateSuccess({ isArchived: true }, deviceIds, []);

    expect(reconcileDeviceMock).toHaveBeenCalledTimes(5);
  });

  it("leaves a larger bulk write entirely to the sweep", async () => {
    const deviceIds: Array<ObjectID> = [1, 2, 3, 4, 5, 6].map((): ObjectID => {
      return ObjectID.generate();
    });

    await runUpdateSuccess({ isArchived: true }, deviceIds, []);

    expect(reconcileDeviceMock).not.toHaveBeenCalled();
  });

  /*
   * The project comes from the pre-write snapshot, not from props: a root
   * caller (a worker, a data migration) has no tenant and its update can
   * legitimately span projects, so using props.tenantId alone would
   * reconcile a device against the wrong project's policies.
   */
  it("takes each device's project from the pre-write snapshot", async () => {
    const foreignDevice: NetworkDevice = deviceRow({
      projectId: OTHER_PROJECT_ID,
    });

    await (NetworkDeviceService as any).onUpdateSuccess(
      {
        updateBy: { data: { isArchived: true }, query: {}, props: {} },
        carryForward: { previousDevices: [foreignDevice] },
      },
      [DEVICE_ID],
    );

    expect(reconcileDeviceMock).toHaveBeenCalledWith({
      projectId: OTHER_PROJECT_ID,
      deviceId: DEVICE_ID,
    });
  });

  /*
   * ...and a device the hook cannot attribute to any project is skipped
   * rather than guessed at. The sweep starts from the policies and will
   * reach it.
   */
  it("skips a device whose project it cannot determine", async () => {
    await (NetworkDeviceService as any).onUpdateSuccess(
      {
        updateBy: { data: { isArchived: true }, query: {}, props: {} },
        carryForward: { previousDevices: [] },
      },
      [DEVICE_ID],
    );

    expect(reconcileDeviceMock).not.toHaveBeenCalled();
  });

  it("does not fail the update when the engine throws", async () => {
    reconcileDeviceMock.mockRejectedValue(new Error("engine is unhappy"));

    await expect(
      runUpdateSuccess({ isArchived: true }, [DEVICE_ID]),
    ).resolves.toBeDefined();
  });
});

describe("NetworkAlertPolicyService hands its own writes to the engine", () => {
  function createdPolicy(): NetworkAlertPolicy {
    const created: NetworkAlertPolicy = new NetworkAlertPolicy();
    created.id = POLICY_ID;
    created.projectId = PROJECT_ID;

    return created;
  }

  it("syncs a newly created policy", async () => {
    const created: NetworkAlertPolicy = createdPolicy();

    await (NetworkAlertPolicyService as any).onCreateSuccess(
      { createBy: { data: created, props: { tenantId: PROJECT_ID } } },
      created,
    );
    await flushDetachedWork();

    expect(syncPolicyMock).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      /*
       * A brand new policy has no monitors, so every monitor its first pass
       * makes comes from the template it names — which is what
       * templateSyncedAt claims.
       */
      stampTemplateSyncedOnCleanPass: true,
    });
  });

  /*
   * ...and the save does not WAIT for it. Provisioning a warehouse is
   * hundreds of monitor creates; holding the operator's request open for that
   * would time out. The engine here never finishes, and the hook still
   * returns.
   */
  it("does not hold the save open while the engine provisions", async () => {
    let releaseEngine: () => void = (): void => {
      return undefined;
    };

    syncPolicyMock.mockImplementation((): Promise<null> => {
      return new Promise<null>((resolve: (value: null) => void): void => {
        releaseEngine = (): void => {
          return resolve(null);
        };
      });
    });

    const created: NetworkAlertPolicy = createdPolicy();

    await expect(
      (NetworkAlertPolicyService as any).onCreateSuccess(
        { createBy: { data: created, props: { tenantId: PROJECT_ID } } },
        created,
      ),
    ).resolves.toBe(created);

    releaseEngine();
  });

  it("does not fail the save when the engine throws", async () => {
    syncPolicyMock.mockRejectedValue(new Error("engine is unhappy"));

    const created: NetworkAlertPolicy = createdPolicy();

    await expect(
      (NetworkAlertPolicyService as any).onCreateSuccess(
        { createBy: { data: created, props: { tenantId: PROJECT_ID } } },
        created,
      ),
    ).resolves.toBe(created);
    await flushDetachedWork();
  });

  function previousPolicy(
    overrides: Partial<NetworkAlertPolicy> = {},
  ): NetworkAlertPolicy {
    const policy: NetworkAlertPolicy = new NetworkAlertPolicy();
    policy.id = POLICY_ID;
    policy.projectId = PROJECT_ID;
    policy.isEnabled = true;
    policy.monitorTemplateId = TEMPLATE_ID;
    Object.assign(policy, overrides);

    return policy;
  }

  async function runPolicyUpdateSuccess(
    data: Record<string, unknown>,
    previousPolicies: Array<NetworkAlertPolicy>,
  ): Promise<void> {
    await (NetworkAlertPolicyService as any).onUpdateSuccess(
      {
        updateBy: { data: data, query: {}, props: { tenantId: PROJECT_ID } },
        carryForward: { previousPolicies: previousPolicies },
      },
      [POLICY_ID],
    );
    await flushDetachedWork();
  }

  it("does no engine work for a rename", async () => {
    await runPolicyUpdateSuccess({ name: "New name" }, [previousPolicy()]);

    expect(syncPolicyMock).not.toHaveBeenCalled();
    expect(setPausedMock).not.toHaveBeenCalled();
  });

  it("syncs after a scope change", async () => {
    await runPolicyUpdateSuccess({ scope: { siteIds: [] } }, [
      previousPolicy(),
    ]);

    expect(syncPolicyMock).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      stampTemplateSyncedOnCleanPass: false,
    });
  });

  it("pauses the policy's monitors when it is really disabled", async () => {
    await runPolicyUpdateSuccess({ isEnabled: false }, [previousPolicy()]);

    expect(setPausedMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      policyId: POLICY_ID,
      isPaused: true,
    });
  });

  /*
   * The settings form re-sends `isEnabled` on every save. Treating that as a
   * transition would be one write per monitor every time somebody fixed a
   * typo in the policy's description.
   */
  it("does not re-pause a policy that was already disabled", async () => {
    await runPolicyUpdateSuccess({ isEnabled: false }, [
      previousPolicy({ isEnabled: false }),
    ]);

    expect(setPausedMock).not.toHaveBeenCalled();
  });

  it("resumes the monitors when a disabled policy is enabled again", async () => {
    await runPolicyUpdateSuccess({ isEnabled: true }, [
      previousPolicy({ isEnabled: false }),
    ]);

    expect(setPausedMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      policyId: POLICY_ID,
      isPaused: false,
    });
    expect(syncPolicyMock).toHaveBeenCalled();
  });

  /*
   * Resume BEFORE the sync, so a monitor that was paused when the policy went
   * off is running again by the time the sync counts the fleet as covered.
   */
  it("resumes before it syncs", async () => {
    const order: Array<string> = [];
    setPausedMock.mockImplementation(async (): Promise<number> => {
      order.push("resume");

      return 0;
    });
    syncPolicyMock.mockImplementation(async (): Promise<null> => {
      order.push("sync");

      return null;
    });

    await runPolicyUpdateSuccess({ isEnabled: true }, [
      previousPolicy({ isEnabled: false }),
    ]);

    expect(order).toEqual(["resume", "sync"]);
  });

  it("asks for a template stamp only when the template really changed", async () => {
    await runPolicyUpdateSuccess({ monitorTemplateId: ObjectID.generate() }, [
      previousPolicy(),
    ]);

    expect(syncPolicyMock).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      stampTemplateSyncedOnCleanPass: true,
    });
  });

  /*
   * Re-saving the SAME template has re-synced nothing. Stamping "Template
   * Synced" for it would tell an operator their criteria edit had landed on
   * the fleet when it had not.
   */
  it("does not ask for a template stamp when the same template is re-sent", async () => {
    await runPolicyUpdateSuccess({ monitorTemplateId: TEMPLATE_ID }, [
      previousPolicy(),
    ]);

    expect(syncPolicyMock).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      stampTemplateSyncedOnCleanPass: false,
    });
  });
});

describe("deleting a policy removes its monitors first", () => {
  it("deletes the monitors before the row, not after", async () => {
    const policy: NetworkAlertPolicy = new NetworkAlertPolicy();
    policy.id = POLICY_ID;
    policy.projectId = PROJECT_ID;

    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(
        async <TModel extends BaseModel>(
          _modelType: { new (): TModel },
          query: Query<TModel>,
        ): Promise<Query<TModel>> => {
          return query;
        },
      );
    jest.spyOn(NetworkAlertPolicyService, "findBy").mockResolvedValue([policy]);

    await (NetworkAlertPolicyService as any).onBeforeDelete({
      query: { _id: POLICY_ID.toString() },
      limit: 1,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    });

    /*
     * Already called by the time the hook returns — NOT detached. Deleting
     * them afterwards would leave a window, and after a crash a permanent
     * one, in which billable monitors exist whose owner is a soft-deleted
     * row nothing looks at.
     */
    expect(deletePolicyMonitorsMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      policyId: POLICY_ID,
    });
  });

  /*
   * Only policies the caller may actually delete. The hook runs before
   * DatabaseService permission-checks the query, so it re-applies the same
   * check first; otherwise a bulk delete the permission layer will trim could
   * still take another project's monitors with it on the way through.
   */
  it("cleans up only the rows the caller is authorized to delete", async () => {
    const permissionSpy: SpyInstance<
      typeof ModelPermission.checkDeleteQueryPermission
    > = jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockResolvedValue({ _id: POLICY_ID.toString() } as never);
    const findSpy: SpyInstance<typeof NetworkAlertPolicyService.findBy> = jest
      .spyOn(NetworkAlertPolicyService, "findBy")
      .mockResolvedValue([]);

    await (NetworkAlertPolicyService as any).onBeforeDelete({
      query: { projectId: PROJECT_ID },
      limit: 10,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    });

    expect(permissionSpy).toHaveBeenCalled();
    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: POLICY_ID.toString() },
      }),
    );
    expect(deletePolicyMonitorsMock).not.toHaveBeenCalled();
  });
});

/*
 * The template delete guard. Both FKs pointing at MonitorTemplate are SET
 * NULL, so without this the delete succeeds and the damage is silent: a
 * policy loses its template and stops covering anything new, and an operator
 * finds out when the switch they added last month turns out never to have
 * been alerted on.
 */
describe("MonitorTemplateService refuses to delete a template in use", () => {
  function templateRow(): MonitorTemplate {
    const template: MonitorTemplate = new MonitorTemplate();
    template.id = TEMPLATE_ID;
    template.projectId = PROJECT_ID;
    template.templateName = "Reachability v1";

    return template;
  }

  function runDelete(
    props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
    },
  ): Promise<unknown> {
    return (MonitorTemplateService as any).onBeforeDelete({
      query: { _id: TEMPLATE_ID.toString() },
      limit: 1,
      skip: 0,
      props: props,
    });
  }

  function policiesUsingTemplate(
    names: Array<string>,
  ): Array<NetworkAlertPolicy> {
    return names.map((name: string): NetworkAlertPolicy => {
      const policy: NetworkAlertPolicy = new NetworkAlertPolicy();
      policy.id = ObjectID.generate();
      policy.name = name;

      return policy;
    });
  }

  it("names the policies that stand in the way", async () => {
    jest
      .spyOn(MonitorTemplateService, "findBy")
      .mockResolvedValue([templateRow()]);
    jest
      .spyOn(NetworkAlertPolicyService, "findBy")
      .mockResolvedValue(policiesUsingTemplate(["Warehouse switches"]));
    jest
      .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
      .mockResolvedValue([]);

    /*
     * The NAME, not just a count: the operator has to find the policy to
     * detach it, and "1 network alert policy" would send them hunting.
     */
    await expect(runDelete()).rejects.toThrow(
      /Reachability v1 is used by 1 network alert policy \(Warehouse switches\)/,
    );
  });

  it("counts and abbreviates when many policies use it", async () => {
    jest
      .spyOn(MonitorTemplateService, "findBy")
      .mockResolvedValue([templateRow()]);
    jest
      .spyOn(NetworkAlertPolicyService, "findBy")
      .mockResolvedValue(policiesUsingTemplate(["A", "B", "C", "D", "E"]));
    jest
      .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
      .mockResolvedValue([]);

    await expect(runDelete()).rejects.toThrow(/A, B, C and 2 more/);
  });

  it("refuses for an auto-import rule too", async () => {
    const rule: NetworkDeviceAutoImportRule = new NetworkDeviceAutoImportRule();
    rule.id = ObjectID.generate();
    rule.name = "Import warehouse switches";

    jest
      .spyOn(MonitorTemplateService, "findBy")
      .mockResolvedValue([templateRow()]);
    jest.spyOn(NetworkAlertPolicyService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
      .mockResolvedValue([rule]);

    await expect(runDelete()).rejects.toThrow(BadDataException);
    await expect(runDelete()).rejects.toThrow(/Import warehouse switches/);
  });

  it("allows the delete when nothing provisions from the template", async () => {
    jest
      .spyOn(MonitorTemplateService, "findBy")
      .mockResolvedValue([templateRow()]);
    jest.spyOn(NetworkAlertPolicyService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
      .mockResolvedValue([]);

    await expect(runDelete()).resolves.toBeDefined();
  });

  /*
   * The hook runs before DatabaseService permission-checks the query, so its
   * root read is re-scoped to the caller's tenant by hand. Without that, the
   * refusal message could name another project's policies.
   */
  it("reads the templates it is about to delete within the caller's tenant", async () => {
    const findSpy: SpyInstance<typeof MonitorTemplateService.findBy> = jest
      .spyOn(MonitorTemplateService, "findBy")
      .mockResolvedValue([]);

    await runDelete();

    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ projectId: PROJECT_ID }),
      }),
    );
  });
});
