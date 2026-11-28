import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import MonitorCriteriaReplaced, {
  CriteriaReplacedBecause,
} from "../../../Server/Utils/Monitor/MonitorCriteriaReplaced";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import { MonitorTemplateChangeOutcome } from "../../../Types/Monitor/MonitorTemplateChange";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import MonitorCriteriaClear from "../../../Utils/Monitor/MonitorCriteriaClear";
import { MONITOR_NOT_LINKED_REFUSAL } from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * LINK EXISTING MONITORS AND UNLINK FROM TEMPLATE, WITH THE TWO CHOICES THE
 * PEOPLE MOVING A FLEET ASKED FOR (issues #11260, #11266).
 *
 *   - Link can bring the template's criteria, step settings, interval and
 *     probe agreement in the same write ("a confirmation warning that
 *     criteria will be replaced"), keeping the monitor's name, labels,
 *     owners, custom field values and history - and each device monitor's
 *     own device.
 *   - Unlink keeps the monitor's settings as its own, or clears the
 *     template's criteria ("Unlink and clear"), so a deleted template's
 *     criteria stop firing.
 *
 * Either way the open incidents and alerts the criteria the monitor lost
 * would have resolved on their own are resolved (MonitorCriteriaReplaced):
 * by the write's own hook, as for every write of a monitor's steps (#11453),
 * within a change the link or the unlink runs it in, which says why and
 * counts what was resolved. Here MonitorService's write is stood in for,
 * and its hook with it (theWriteResolvesAsItsHookDoes).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DESIGN_DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OLD_TEMPLATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const BETTER_TEMPLATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

function criteria(id: string): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = id;
  instance.data!.name = `Criteria ${id}`;
  // Its incident resolves on its own, as a template's offline criteria does.
  instance.data!.incidents = [
    {
      id: `${id}-incident`,
      title: `${id} is offline`,
      description: "",
      autoResolveIncident: true,
    },
  ];
  return instance;
}

function deviceSteps(
  deviceId: ObjectID,
  criteriaIds: Array<string>,
): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.data!.id = "step-1";
  step.data!.networkDeviceMonitor = {
    networkDeviceId: deviceId.toString(),
    monitorInterfaces: true,
    oids: [],
  };
  step.data!.monitorCriteria.data = {
    monitorCriteriaInstanceArray: criteriaIds.map(criteria),
  };
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = { monitorStepsInstanceArray: [step] };
  return steps;
}

function betterTemplate(): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate(BETTER_TEMPLATE_ID);
  template.projectId = PROJECT_ID;
  template.monitorType = MonitorType.NetworkDevice;
  template.templateName = "WB Ping Monitor Template v2";
  // The template's step names the device its editor picked, as every one does.
  template.monitorSteps = deviceSteps(DESIGN_DEVICE_ID, [
    "v2-offline",
    "v2-online",
  ]);
  template.monitoringInterval = "*/2 * * * *";
  template.minimumProbeAgreement = 2;
  return template;
}

function automaticMonitor(): Monitor {
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.NetworkDevice;
  monitor.name = "WB1500KSK02";
  monitor.monitorTemplateId = OLD_TEMPLATE_ID;
  monitor.autoProvisionedNetworkDeviceId = DEVICE_ID;
  monitor.monitorSteps = deviceSteps(DEVICE_ID, ["v1-offline", "v1-online"]);
  return monitor;
}

let updateSpy: SpyInstance<typeof MonitorService.updateOneById>;
let resolveSpy: SpyInstance<
  typeof MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen
>;

function reads(monitor: Monitor | null): void {
  jest
    .spyOn(MonitorTemplateService, "findOneById")
    .mockResolvedValue(betterTemplate());
  jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
}

/*
 * The write as MonitorService makes it, with its hook: once a write of the
 * monitor's steps is written, what it took off is resolved
 * (MonitorCriteriaReplaced.resolveAfterWrite, from onUpdateSuccess).
 */
function theWriteResolvesAsItsHookDoes(stored: Monitor): void {
  updateSpy.mockImplementation((async (write: {
    id: ObjectID;
    data: Record<string, unknown>;
  }): Promise<number> => {
    if (!("monitorSteps" in write.data)) {
      return 1;
    }

    await MonitorCriteriaReplaced.resolveAfterWrite({
      monitorId: write.id,
      projectId: PROJECT_ID,
      monitorName: stored.name || "",
      stepsBefore: stored.monitorSteps,
      stepsAfter: write.data["monitorSteps"] as MonitorSteps | undefined,
      templateIdBefore: stored.monitorTemplateId,
      writtenTemplate: {
        isWritten: "monitorTemplateId" in write.data,
        id: (write.data["monitorTemplateId"] as ObjectID | null) || null,
      },
      readTemplateName: async (): Promise<string> => {
        return "read by the hook";
      },
    });

    return 1;
  }) as never);
}

function writtenData(): Record<string, unknown> {
  expect(updateSpy).toHaveBeenCalledTimes(1);
  return (updateSpy.mock.calls[0]![0] as { data: Record<string, unknown> })
    .data;
}

beforeEach(() => {
  updateSpy = jest
    .spyOn(MonitorService, "updateOneById")
    .mockResolvedValue(1 as never);
  resolveSpy = jest
    .spyOn(MonitorCriteriaReplaced, "resolveWhatRemovedCriteriaLeftOpen")
    .mockResolvedValue({
      resolvedIncidentIds: ["i1", "i2"],
      resolvedAlertIds: ["a1"],
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Link Existing Monitors", () => {
  it("moves a monitor an import made to the better template, and keeps its settings until a sync, when asked nothing more", async () => {
    reads(automaticMonitor());

    const result: Awaited<
      ReturnType<typeof MonitorTemplateService.linkMonitor>
    > = await MonitorTemplateService.linkMonitor({
      monitorTemplateId: BETTER_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
    });

    expect(result).toEqual({
      outcome: MonitorTemplateChangeOutcome.Changed,
      resolvedIncidentCount: 0,
      resolvedAlertCount: 0,
    });
    expect(Object.keys(writtenData())).toEqual(["monitorTemplateId"]);
    expect(String(writtenData()["monitorTemplateId"])).toBe(
      BETTER_TEMPLATE_ID.toString(),
    );
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("brings the template's criteria, interval and probe agreement in the same write, on the monitor's own device", async () => {
    reads(automaticMonitor());

    await MonitorTemplateService.linkMonitor({
      monitorTemplateId: BETTER_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      applyTemplateSettings: true,
    });

    const data: Record<string, unknown> = writtenData();

    expect(Object.keys(data).sort()).toEqual([
      "minimumProbeAgreement",
      "monitorSteps",
      "monitorTemplateId",
      "monitoringInterval",
    ]);
    expect(data["monitoringInterval"]).toBe("*/2 * * * *");
    expect(data["minimumProbeAgreement"]).toBe(2);

    const steps: MonitorSteps = data["monitorSteps"] as MonitorSteps;
    const step: MonitorStep = steps.data!.monitorStepsInstanceArray[0]!;

    // The template's criteria, on this monitor's device - not the editor's.
    expect(step.data!.networkDeviceMonitor!.networkDeviceId).toBe(
      DEVICE_ID.toString(),
    );
    expect(
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.map(
        (instance: MonitorCriteriaInstance) => {
          return instance.data!.id;
        },
      ),
    ).toEqual(["v2-offline", "v2-online"]);
  });

  it("never writes the monitor's name, labels or custom field values", async () => {
    const template: MonitorTemplate = betterTemplate();
    template.labels = [new Label(ObjectID.generate())];
    template.customFields = { site: "Template site" };
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(automaticMonitor());

    await MonitorTemplateService.linkMonitor({
      monitorTemplateId: BETTER_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      applyTemplateSettings: true,
    });

    const data: Record<string, unknown> = writtenData();

    for (const kept of [
      "name",
      "description",
      "labels",
      "customFields",
      "monitorType",
    ]) {
      expect(kept in data).toBe(false);
    }
  });

  it("resolves what the monitor's old criteria left open, and counts it", async () => {
    const monitor: Monitor = automaticMonitor();
    reads(monitor);
    theWriteResolvesAsItsHookDoes(monitor);

    const result: Awaited<
      ReturnType<typeof MonitorTemplateService.linkMonitor>
    > = await MonitorTemplateService.linkMonitor({
      monitorTemplateId: BETTER_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      applyTemplateSettings: true,
    });

    expect(result.resolvedIncidentCount).toBe(2);
    expect(result.resolvedAlertCount).toBe(1);

    const asked: Parameters<
      typeof MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen
    >[0] = resolveSpy.mock.calls[0]![0];

    expect(asked.because).toBe(CriteriaReplacedBecause.LinkedToTemplate);
    // The change's own name for the template: none is read again.
    expect(await asked.getTemplateName()).toBe("WB Ping Monitor Template v2");
    expect(asked.monitorName).toBe("WB1500KSK02");
    // The template's criteria replaced both of the monitor's.
    expect(asked.templateIds).toEqual({
      incidents: {
        "v1-offline": ["v1-offline-incident"],
        "v1-online": ["v1-online-incident"],
      },
      alerts: {},
    });
    expect(writtenData()["monitorSteps"]).toBeDefined();
  });

  it("says a monitor linked already had its template's criteria synced to it", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.monitorTemplateId = BETTER_TEMPLATE_ID;
    reads(monitor);
    theWriteResolvesAsItsHookDoes(monitor);

    await MonitorTemplateService.linkMonitor({
      monitorTemplateId: BETTER_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      applyTemplateSettings: true,
    });

    expect(resolveSpy.mock.calls[0]![0].because).toBe(
      CriteriaReplacedBecause.SyncedFromTemplate,
    );
  });

  it("leaves a monitor linked already as it is, when asked nothing more", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.monitorTemplateId = BETTER_TEMPLATE_ID;
    reads(monitor);

    const result: Awaited<
      ReturnType<typeof MonitorTemplateService.linkMonitor>
    > = await MonitorTemplateService.linkMonitor({
      monitorTemplateId: BETTER_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
    });

    expect(result.outcome).toBe(MonitorTemplateChangeOutcome.Unchanged);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("brings the settings to a monitor linked already, without writing its link again", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.monitorTemplateId = BETTER_TEMPLATE_ID;
    reads(monitor);

    const result: Awaited<
      ReturnType<typeof MonitorTemplateService.linkMonitor>
    > = await MonitorTemplateService.linkMonitor({
      monitorTemplateId: BETTER_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      applyTemplateSettings: true,
    });

    expect(result.outcome).toBe(MonitorTemplateChangeOutcome.Changed);
    expect("monitorTemplateId" in writtenData()).toBe(false);
    expect("monitorSteps" in writtenData()).toBe(true);
  });

  it("reads the template once for a change of many monitors: one handed in is used as it is", async () => {
    const findTemplateSpy: SpyInstance<
      typeof MonitorTemplateService.findOneById
    > = jest.spyOn(MonitorTemplateService, "findOneById");
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(automaticMonitor());

    await MonitorTemplateService.linkMonitor({
      monitorTemplateId: BETTER_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      template: betterTemplate(),
    });

    expect(findTemplateSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * The write's hook never fails the save for a resolve that failed
   * (MonitorCriteriaRemovedResolvesOnUpdate): the link counts nothing then.
   */
  it("counts nothing when the write's hook resolved nothing", async () => {
    reads(automaticMonitor());

    const result: Awaited<
      ReturnType<typeof MonitorTemplateService.linkMonitor>
    > = await MonitorTemplateService.linkMonitor({
      monitorTemplateId: BETTER_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      applyTemplateSettings: true,
    });

    expect(result).toEqual({
      outcome: MonitorTemplateChangeOutcome.Changed,
      resolvedIncidentCount: 0,
      resolvedAlertCount: 0,
    });
  });
});

describe("Unlink from Template", () => {
  it("keeps the monitor's settings as its own by default: only the link goes", async () => {
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(automaticMonitor());

    const result: Awaited<
      ReturnType<typeof MonitorTemplateService.unlinkMonitor>
    > = await MonitorTemplateService.unlinkMonitor({
      monitorTemplateId: OLD_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
    });

    expect(result.outcome).toBe(MonitorTemplateChangeOutcome.Changed);
    expect(writtenData()).toEqual({ monitorTemplateId: null });
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("clears the template's criteria when asked, keeping what each step checks", async () => {
    const monitor: Monitor = automaticMonitor();
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    theWriteResolvesAsItsHookDoes(monitor);
    const oldTemplate: MonitorTemplate = new MonitorTemplate(OLD_TEMPLATE_ID);
    oldTemplate.templateName = "WB Ping Monitor Template - No Alert";
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(oldTemplate);

    const result: Awaited<
      ReturnType<typeof MonitorTemplateService.unlinkMonitor>
    > = await MonitorTemplateService.unlinkMonitor({
      monitorTemplateId: OLD_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      clearTemplateSettings: true,
    });

    const data: Record<string, unknown> = writtenData();
    const steps: MonitorSteps = data["monitorSteps"] as MonitorSteps;

    expect(data["monitorTemplateId"]).toBeNull();
    expect(MonitorCriteriaClear.hasCriteria(steps)).toBe(false);
    expect(
      steps.data!.monitorStepsInstanceArray[0]!.data!.networkDeviceMonitor!
        .networkDeviceId,
    ).toBe(DEVICE_ID.toString());

    const asked: Parameters<
      typeof MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen
    >[0] = resolveSpy.mock.calls[0]![0];

    expect(asked.because).toBe(CriteriaReplacedBecause.ClearedOnUnlink);
    expect(await asked.getTemplateName()).toBe(
      "WB Ping Monitor Template - No Alert",
    );
    expect(Object.keys(asked.templateIds.incidents).sort()).toEqual([
      "v1-offline",
      "v1-online",
    ]);
    expect(result.resolvedIncidentCount).toBe(2);
  });

  it("takes the template's name it is handed, read once by a change of many monitors", async () => {
    const monitor: Monitor = automaticMonitor();
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    theWriteResolvesAsItsHookDoes(monitor);
    const findTemplateSpy: SpyInstance<
      typeof MonitorTemplateService.findOneById
    > = jest.spyOn(MonitorTemplateService, "findOneById");

    await MonitorTemplateService.unlinkMonitor({
      monitorTemplateId: OLD_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      clearTemplateSettings: true,
      templateName: "Warehouse switches",
    });

    expect(findTemplateSpy).not.toHaveBeenCalled();
    expect(await resolveSpy.mock.calls[0]![0].getTemplateName()).toBe(
      "Warehouse switches",
    );
  });

  it("clears nothing on a monitor with no criteria left: only the link goes", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.monitorSteps = MonitorCriteriaClear.clearCriteria(
      monitor.monitorSteps!,
    );
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);

    await MonitorTemplateService.unlinkMonitor({
      monitorTemplateId: OLD_TEMPLATE_ID,
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      clearTemplateSettings: true,
    });

    expect(writtenData()).toEqual({ monitorTemplateId: null });
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("still refuses a monitor linked to another template than the one named", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.monitorTemplateId = BETTER_TEMPLATE_ID;
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);

    await expect(
      MonitorTemplateService.unlinkMonitor({
        monitorTemplateId: OLD_TEMPLATE_ID,
        monitorId: MONITOR_ID,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(MONITOR_NOT_LINKED_REFUSAL);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("naming no template, unlinks the monitor from whichever it is linked to", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.monitorTemplateId = BETTER_TEMPLATE_ID;
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);

    const result: Awaited<
      ReturnType<typeof MonitorTemplateService.unlinkMonitor>
    > = await MonitorTemplateService.unlinkMonitor({
      monitorId: MONITOR_ID,
      props: { isRoot: true },
    });

    expect(result.outcome).toBe(MonitorTemplateChangeOutcome.Changed);
    expect(writtenData()).toEqual({ monitorTemplateId: null });
  });

  it("naming no template, leaves a monitor linked to none as it is", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.monitorTemplateId = undefined as unknown as ObjectID;
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);

    const result: Awaited<
      ReturnType<typeof MonitorTemplateService.unlinkMonitor>
    > = await MonitorTemplateService.unlinkMonitor({
      monitorId: MONITOR_ID,
      props: { isRoot: true },
      clearTemplateSettings: true,
    });

    expect(result.outcome).toBe(MonitorTemplateChangeOutcome.Unchanged);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
