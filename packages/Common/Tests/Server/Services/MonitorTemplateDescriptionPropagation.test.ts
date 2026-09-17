import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import NetworkAlertPolicyEngineService from "../../../Server/Services/NetworkAlertPolicyEngineService";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepNetworkDeviceMonitorUtil } from "../../../Types/Monitor/MonitorStepNetworkDeviceMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import PartialEntity from "../../../Types/Database/PartialEntity";
import NetworkDeviceMonitorTemplateUtil from "../../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const PROJECT_ID: ObjectID = ObjectID.generate();
const TEMPLATE_ID: ObjectID = ObjectID.generate();
const DEVICE_ID: ObjectID = ObjectID.generate();
const LONG_RUNBOOK: string = [
  "# Network recovery — 東京 🔍",
  "",
  "1. Check **reachability**, then inspect `ifOperStatus`.",
  "2. Read [the runbook](https://example.com/runbooks/network).",
  "",
  "```sh",
  "ping -c 3 192.0.2.1",
  "```",
  "",
  "Keep operator notes, blank lines, and Unicode intact.\r\n",
]
  .join("\n")
  .repeat(100);

function buildTemplate(description?: string): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.templateName = "Network recovery";
  template.monitorName = "Availability";
  template.monitorType = MonitorType.NetworkDevice;
  if (description !== undefined) {
    template.monitorDescription = description;
  }
  template.monitoringInterval = "*/5 * * * *";

  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    ...MonitorStepNetworkDeviceMonitorUtil.getDefault(),
    networkDeviceId: ObjectID.generate().toString(),
  };
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };
  template.monitorSteps = steps;
  return template;
}

function buildMonitor(template: MonitorTemplate): Monitor {
  const device: NetworkDevice = new NetworkDevice();
  device.id = DEVICE_ID;
  device.projectId = PROJECT_ID;
  device.name = "London core switch";

  return NetworkDeviceMonitorTemplateUtil.buildMonitor({
    template,
    networkDevice: device,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Long monitor descriptions provisioned from templates", () => {
  /*
   * Provisioning first reads a saved template, then builds a Monitor and
   * submits it through MonitorService. Neither field's validation nor the
   * intervening template mapping may reject or shorten the description.
   */
  it.each([
    { label: "501 characters", description: "a".repeat(501) },
    { label: "one MiB of text", description: "a".repeat(1024 * 1024) },
    { label: "Unicode Markdown and line endings", description: LONG_RUNBOOK },
    { label: "an explicitly empty description", description: "" },
    { label: "an omitted description", description: undefined },
  ])(
    "carries $label through template and monitor validation without loss",
    async ({
      description,
    }: {
      description: string | undefined;
    }): Promise<void> => {
      const template: MonitorTemplate = buildTemplate(description);
      await MonitorTemplateService["sanitizeCreateOrUpdate"](
        template,
        { isRoot: true },
        false,
      );

      const monitor: Monitor = buildMonitor(template);
      const validated: Monitor | PartialEntity<Monitor> = await MonitorService[
        "sanitizeCreateOrUpdate"
      ](monitor, { isRoot: true }, false);

      expect(template.monitorDescription).toBe(description);
      expect(validated.description).toBe(description);
      expect(monitor.monitorTemplateId?.toString()).toBe(
        TEMPLATE_ID.toString(),
      );
    },
  );

  it("uses an edited template description for subsequent monitors while retaining the first monitor's description", async () => {
    const template: MonitorTemplate = buildTemplate(LONG_RUNBOOK);
    const firstMonitor: Monitor = buildMonitor(template);
    const updatedDescription: string = `${LONG_RUNBOOK}\n## Updated recovery instructions\n${"b".repeat(1000)}`;

    const templateUpdate: MonitorTemplate | PartialEntity<MonitorTemplate> =
      await MonitorTemplateService["sanitizeCreateOrUpdate"](
        { monitorDescription: updatedDescription },
        { isRoot: true },
        true,
      );
    template.monitorDescription = templateUpdate.monitorDescription as string;
    const nextMonitor: Monitor = buildMonitor(template);
    await MonitorService["sanitizeCreateOrUpdate"](
      nextMonitor,
      { isRoot: true },
      false,
    );

    expect(firstMonitor.description).toBe(LONG_RUNBOOK);
    expect(nextMonitor.description).toBe(updatedDescription);
    expect(template.monitorDescription).toBe(updatedDescription);
  });

  it("accepts a long per-monitor override without changing the source template", async () => {
    const template: MonitorTemplate = buildTemplate(LONG_RUNBOOK);
    const monitor: Monitor = buildMonitor(template);
    const override: string = `${LONG_RUNBOOK}\n## Local escalation\n${"Operator-specific instructions.\n".repeat(100)}`;

    const update: Monitor | PartialEntity<Monitor> = await MonitorService[
      "sanitizeCreateOrUpdate"
    ]({ description: override }, { isRoot: true }, true);
    Object.assign(monitor, update);

    expect(monitor.description).toBe(override);
    expect(template.monitorDescription).toBe(LONG_RUNBOOK);
  });
});

type SyncMode = "single monitor" | "linked monitors";

interface SyncWrites {
  single: SpyInstance<typeof MonitorService.updateOneById>;
  bulk: SpyInstance<typeof MonitorService.updateBy>;
}

function mockSync(template: MonitorTemplate, monitor: Monitor): SyncWrites {
  jest.spyOn(MonitorTemplateService, "findOneById").mockResolvedValue(template);
  jest
    .spyOn(MonitorTemplateService, "countLinkedMonitors")
    .mockResolvedValue(1);
  jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
  jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
  jest
    .spyOn(NetworkAlertPolicyEngineService, "onMonitorTemplateSynced")
    .mockResolvedValue(undefined);

  return {
    single: jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(1),
    bulk: jest.spyOn(MonitorService, "updateBy").mockResolvedValue(1),
  };
}

async function sync(
  mode: SyncMode,
  monitor: Monitor,
  fields?: Array<string>,
): Promise<void> {
  const data: {
    monitorTemplateId: ObjectID;
    props: { isRoot: boolean };
    fields?: Array<string>;
  } = {
    monitorTemplateId: TEMPLATE_ID,
    props: { isRoot: true },
  };

  if (fields !== undefined) {
    data.fields = fields;
  }

  if (mode === "single monitor") {
    await MonitorTemplateService.syncToMonitor({
      ...data,
      monitorId: monitor.id!,
    });
  } else {
    await MonitorTemplateService.syncLinkedMonitors(data);
  }
}

describe.each(["single monitor", "linked monitors"] as const)(
  "Long descriptions during template sync to %s",
  (mode: SyncMode): void => {
    it.each([
      { label: "default fields", fields: undefined },
      { label: "explicitly selected fields", fields: ["monitoringInterval"] },
    ])(
      "preserves the monitor's own description when syncing $label",
      async ({
        fields,
      }: {
        fields: Array<string> | undefined;
      }): Promise<void> => {
        const template: MonitorTemplate = buildTemplate(LONG_RUNBOOK);
        // A Ping template exercises the ordinary bulk and single sync paths.
        template.monitorType = MonitorType.Ping;
        delete template.monitorSteps;
        const monitor: Monitor = new Monitor();
        monitor.id = ObjectID.generate();
        monitor.projectId = PROJECT_ID;
        monitor.monitorType = MonitorType.Ping;
        monitor.monitorTemplateId = TEMPLATE_ID;
        monitor.description = `${LONG_RUNBOOK}\nOperator-specific recovery steps`;
        const originalDescription: string = monitor.description;
        const writes: SyncWrites = mockSync(template, monitor);

        await sync(mode, monitor, fields);

        const write: PartialEntity<Monitor> =
          mode === "single monitor"
            ? writes.single.mock.calls[0]![0].data
            : writes.bulk.mock.calls[0]![0].data;
        expect(writes.single).toHaveBeenCalledTimes(
          mode === "single monitor" ? 1 : 0,
        );
        expect(writes.bulk).toHaveBeenCalledTimes(
          mode === "linked monitors" ? 1 : 0,
        );
        expect(write.monitoringInterval).toBe("*/5 * * * *");
        expect(write).not.toHaveProperty("description");
        expect(write).not.toHaveProperty("monitorDescription");
        Object.assign(monitor, write);
        expect(monitor.description).toBe(originalDescription);
        expect(template.monitorDescription).toBe(LONG_RUNBOOK);
      },
    );

    it("continues to reject an explicit request to overwrite per-monitor descriptions", async () => {
      const template: MonitorTemplate = buildTemplate(LONG_RUNBOOK);
      const monitor: Monitor = buildMonitor(template);
      monitor.id = ObjectID.generate();
      const writes: SyncWrites = mockSync(template, monitor);

      await expect(sync(mode, monitor, ["description"])).rejects.toThrow(
        'Field "description" is not syncable from a monitor template',
      );

      expect(writes.single).not.toHaveBeenCalled();
      expect(writes.bulk).not.toHaveBeenCalled();
      expect(monitor.description).toBe(LONG_RUNBOOK);
    });
  },
);
