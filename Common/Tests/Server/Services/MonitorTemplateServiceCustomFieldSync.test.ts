import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService, {
  SyncLinkedMonitorsResult,
} from "../../../Server/Services/MonitorTemplateService";
import FindBy from "../../../Server/Types/Database/FindBy";
import Query from "../../../Server/Types/Database/Query";
import Select from "../../../Server/Types/Database/Select";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Contract under test — pushing a monitor template's CUSTOM FIELD DEFAULTS
 * onto the monitors already made from it (issue #3548).
 *
 * Provisioning has always copied a template's `customFields` onto the monitors
 * it creates, so setting defaults on a template covers everything imported
 * after the edit. The fleet that makes this a problem is on the other side of
 * that line: a thousand devices an auto-import rule already turned into
 * monitors with every custom field empty. Sync is what reaches them, and three
 * things about it are easy to get wrong and impossible to undo:
 *
 *   - it OVERLAYS. A template holds a key for every custom field the project
 *     has defined the moment its edit form is saved, so an assignment would
 *     blank every field the template happens not to default across the whole
 *     fleet;
 *   - it is per-monitor, because the value written depends on what that
 *     monitor already holds — which rules out the bulk `updateBy` every other
 *     syncable field rides;
 *   - it is opt-in by name. An unscoped sync pushes criteria, interval and
 *     labels and deliberately leaves operator-entered custom field values
 *     alone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function buildTemplate(data?: {
  customFields?: JSONObject | undefined;
  monitorType?: MonitorType | undefined;
}): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  /*
   * Ping rather than Network Device, so nothing but custom fields can push a
   * sync onto the per-monitor path.
   */
  template.monitorType = data?.monitorType || MonitorType.Ping;
  template.monitoringInterval = "*/10 * * * *";
  template.minimumProbeAgreement = 2;
  const customFields: JSONObject | undefined =
    data && "customFields" in data
      ? data.customFields
      : {
          Vendor: "Cisco",
          "Configuration Item": "",
        };
  if (customFields) {
    template.customFields = customFields;
  }
  return template;
}

function buildLinkedMonitor(customFields?: JSONObject | undefined): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.Ping;
  monitor.monitorTemplateId = TEMPLATE_ID;
  if (customFields) {
    monitor.customFields = customFields;
  }
  return monitor;
}

interface MockedSync {
  updateOneSpy: SpyInstance<typeof MonitorService.updateOneById>;
  bulkUpdateSpy: SpyInstance<typeof MonitorService.updateBy>;
  findBySpy: SpyInstance<typeof MonitorService.findBy>;
  permissionSpy: SpyInstance<
    typeof ModelPermission.checkUpdateQueryPermissions
  >;
}

function mockSync(data: {
  template: MonitorTemplate;
  monitors: Array<Monitor>;
}): MockedSync {
  jest
    .spyOn(MonitorTemplateService, "findOneById")
    .mockResolvedValue(data.template);
  jest
    .spyOn(MonitorTemplateService, "countLinkedMonitors")
    .mockResolvedValue(data.monitors.length);

  return {
    updateOneSpy: jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1),
    bulkUpdateSpy: jest.spyOn(MonitorService, "updateBy").mockResolvedValue(0),
    findBySpy: jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue(data.monitors),
    permissionSpy: jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(
        async (
          _modelType: any,
          query: Query<Monitor>,
        ): Promise<Query<Monitor>> => {
          return query;
        },
      ) as SpyInstance<typeof ModelPermission.checkUpdateQueryPermissions>,
  };
}

function writtenCustomFields(
  updateOneSpy: SpyInstance<typeof MonitorService.updateOneById>,
  callIndex: number,
): JSONObject {
  return updateOneSpy.mock.calls[callIndex]![0].data
    .customFields as unknown as JSONObject;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateService custom field default synchronization", () => {
  it("is not pushed by an unscoped sync", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildLinkedMonitor({ Vendor: "Juniper" });
    const mocks: MockedSync = mockSync({ template, monitors: [monitor] });

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 1, syncedMonitors: 0 });

    /*
     * The bulk path, and the payload it carries has no customFields key at
     * all — not an empty one, which would still clear the column. (`labels` is
     * absent because this template has none, not because it is unsyncable.)
     */
    expect(mocks.updateOneSpy).not.toHaveBeenCalled();
    expect(mocks.bulkUpdateSpy).toHaveBeenCalledTimes(1);

    const bulkPayloadKeys: Array<string> = Object.keys(
      mocks.bulkUpdateSpy.mock.calls[0]![0].data as unknown as JSONObject,
    );
    expect(bulkPayloadKeys).not.toContain("customFields");
    expect(bulkPayloadKeys).toEqual([
      "monitoringInterval",
      "minimumProbeAgreement",
    ]);
  });

  it("is accepted as a scoped field, and an unknown field still is not", async () => {
    const template: MonitorTemplate = buildTemplate();
    mockSync({ template, monitors: [buildLinkedMonitor()] });

    await expect(
      MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["customFields"],
        props: { isRoot: true },
      }),
    ).resolves.toEqual({ totalLinkedMonitors: 1, syncedMonitors: 1 });

    await expect(
      MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["name"],
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * The behaviour the whole feature turns on: only the fields the template
   * actually defaults are written, and every other value on the monitor —
   * including one on a field the template holds an empty string for — survives.
   */
  it("overlays the template's defaults and leaves every other value on the monitor alone", async () => {
    const template: MonitorTemplate = buildTemplate({
      customFields: {
        Vendor: "Cisco",
        Duration: 30,
        "Configuration Item": "",
        Services: [],
      },
    });
    const monitor: Monitor = buildLinkedMonitor({
      Vendor: "Juniper",
      "Configuration Item": "CI-4417",
      Services: ["billing"],
      Notes: "replaced 2026-01-04",
    });
    const mocks: MockedSync = mockSync({ template, monitors: [monitor] });

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["customFields"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 1, syncedMonitors: 1 });
    expect(writtenCustomFields(mocks.updateOneSpy, 0)).toEqual({
      Vendor: "Cisco",
      Duration: 30,
      "Configuration Item": "CI-4417",
      Services: ["billing"],
      Notes: "replaced 2026-01-04",
    });

    // Scoped to custom fields, so nothing else about the monitor is rewritten.
    expect(
      Object.keys(
        mocks.updateOneSpy.mock.calls[0]![0].data as unknown as JSONObject,
      ),
    ).toEqual(["customFields"]);
  });

  /*
   * Each monitor's payload is computed from that monitor's own bag, which is
   * exactly why this cannot ride the shared bulk update the other syncable
   * fields use.
   */
  it("writes a different payload per monitor, one row at a time", async () => {
    const template: MonitorTemplate = buildTemplate({
      customFields: { Vendor: "Cisco" },
    });
    const alreadyTagged: Monitor = buildLinkedMonitor({
      Vendor: "Juniper",
      "Configuration Item": "CI-1",
    });
    const untouched: Monitor = buildLinkedMonitor();
    const mocks: MockedSync = mockSync({
      template,
      monitors: [alreadyTagged, untouched],
    });

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["customFields"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 2, syncedMonitors: 2 });
    expect(mocks.bulkUpdateSpy).not.toHaveBeenCalled();
    expect(mocks.updateOneSpy).toHaveBeenCalledTimes(2);

    expect(writtenCustomFields(mocks.updateOneSpy, 0)).toEqual({
      Vendor: "Cisco",
      "Configuration Item": "CI-1",
    });
    expect(writtenCustomFields(mocks.updateOneSpy, 1)).toEqual({
      Vendor: "Cisco",
    });
  });

  /*
   * Whatever else it pushes, a per-monitor sync has to READ the column it is
   * about to overlay — a select that omits it hands the merge an undefined bag
   * and turns the overlay into an assignment, silently blanking the fields the
   * template does not default.
   */
  it("reads each monitor's existing custom fields before overlaying them", async () => {
    const template: MonitorTemplate = buildTemplate({
      customFields: { Vendor: "Cisco" },
    });
    const mocks: MockedSync = mockSync({
      template,
      monitors: [buildLinkedMonitor()],
    });

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["customFields"],
      props: { isRoot: true },
    });

    const select: Select<Monitor> = (
      mocks.findBySpy.mock.calls[0]![0] as FindBy<Monitor>
    ).select as Select<Monitor>;
    expect((select as JSONObject)["customFields"]).toBe(true);
  });

  /*
   * The read of the template itself, for the same reason. Selecting the column
   * is what makes the difference between "this template defaults nothing" and
   * "nobody asked for the column", and the two are indistinguishable
   * afterwards.
   */
  it("selects customFields on the template it reads", async () => {
    const template: MonitorTemplate = buildTemplate();
    mockSync({ template, monitors: [buildLinkedMonitor()] });
    const templateReadSpy: SpyInstance<
      typeof MonitorTemplateService.findOneById
    > = jest.spyOn(MonitorTemplateService, "findOneById");

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["customFields"],
      props: { isRoot: true },
    });

    expect(
      (templateReadSpy.mock.calls[0]![0].select as JSONObject)["customFields"],
    ).toBe(true);
  });

  /*
   * A caller who may not update Monitor.customFields must be refused before
   * the first write, not on whichever row the loop happens to reach when the
   * column check finally runs. The per-monitor values are not known at that
   * point and only the KEYS decide a column check, so the probe names the
   * column with an empty bag.
   */
  it("names customFields in the up-front column permission probe", async () => {
    const template: MonitorTemplate = buildTemplate({
      customFields: { Vendor: "Cisco" },
    });
    const mocks: MockedSync = mockSync({
      template,
      monitors: [buildLinkedMonitor()],
    });

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["customFields"],
      props: { isRoot: true },
    });

    expect(mocks.permissionSpy).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(mocks.permissionSpy.mock.calls[0]![2] as JSONObject),
    ).toContain("customFields");
  });

  /*
   * "0 of 200 synced" is the summary the dashboard reads as a permissions
   * problem and tells the operator to run the sync again as somebody else. A
   * template with nothing to push must therefore write nothing and say so,
   * rather than walk the fleet.
   */
  it.each([
    ["an absent bag", undefined],
    ["an empty bag", {}],
    ["a bag holding only blanks", { Vendor: "", Services: [], Duration: null }],
  ])(
    "writes nothing when the template has %s",
    async (
      _label: string,
      customFields: JSONObject | undefined,
    ): Promise<void> => {
      const template: MonitorTemplate = buildTemplate({ customFields });
      const mocks: MockedSync = mockSync({
        template,
        monitors: [buildLinkedMonitor({ Vendor: "Juniper" })],
      });

      const result: SyncLinkedMonitorsResult =
        await MonitorTemplateService.syncLinkedMonitors({
          monitorTemplateId: TEMPLATE_ID,
          fields: ["customFields"],
          props: { isRoot: true },
        });

      expect(result).toEqual({ totalLinkedMonitors: 1, syncedMonitors: 0 });
      expect(mocks.updateOneSpy).not.toHaveBeenCalled();
      expect(mocks.bulkUpdateSpy).not.toHaveBeenCalled();
      expect(mocks.findBySpy).not.toHaveBeenCalled();
    },
  );

  /*
   * Custom fields ride alongside the other per-monitor field rather than
   * displacing it: a Network Device template pushing criteria AND defaults has
   * to rebind the steps to each monitor's own device in the same write.
   */
  it("carries a Network Device criteria rebind and the defaults in one write", async () => {
    const template: MonitorTemplate = buildTemplate({
      monitorType: MonitorType.NetworkDevice,
      customFields: { Vendor: "Cisco" },
    });
    const monitor: Monitor = buildLinkedMonitor({ Duration: 30 });
    const mocks: MockedSync = mockSync({ template, monitors: [monitor] });

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["customFields", "monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 1, syncedMonitors: 1 });
    expect(mocks.updateOneSpy).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(
        mocks.updateOneSpy.mock.calls[0]![0].data as unknown as JSONObject,
      ).sort(),
    ).toEqual(["customFields", "monitoringInterval"]);
    expect(writtenCustomFields(mocks.updateOneSpy, 0)).toEqual({
      Vendor: "Cisco",
      Duration: 30,
    });
  });

  describe("syncToMonitor", () => {
    it("overlays the defaults onto that one monitor's values", async () => {
      const template: MonitorTemplate = buildTemplate({
        customFields: { Vendor: "Cisco", "Configuration Item": "" },
      });
      const monitor: Monitor = buildLinkedMonitor({
        Vendor: "Juniper",
        "Configuration Item": "CI-4417",
      });

      jest
        .spyOn(MonitorTemplateService, "findOneById")
        .mockResolvedValue(template);
      jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
      const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> =
        jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(1);

      await MonitorTemplateService.syncToMonitor({
        monitorTemplateId: TEMPLATE_ID,
        monitorId: monitor.id!,
        fields: ["customFields"],
        props: { isRoot: true },
      });

      expect(writtenCustomFields(updateOneSpy, 0)).toEqual({
        Vendor: "Cisco",
        "Configuration Item": "CI-4417",
      });
    });

    it("reads the monitor's existing custom fields before overlaying them", async () => {
      const template: MonitorTemplate = buildTemplate({
        customFields: { Vendor: "Cisco" },
      });
      const monitor: Monitor = buildLinkedMonitor();

      jest
        .spyOn(MonitorTemplateService, "findOneById")
        .mockResolvedValue(template);
      const monitorReadSpy: SpyInstance<typeof MonitorService.findOneById> =
        jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
      jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(1);

      await MonitorTemplateService.syncToMonitor({
        monitorTemplateId: TEMPLATE_ID,
        monitorId: monitor.id!,
        fields: ["customFields"],
        props: { isRoot: true },
      });

      expect(
        (monitorReadSpy.mock.calls[0]![0].select as JSONObject)["customFields"],
      ).toBe(true);
    });

    it("writes nothing when the template defaults nothing", async () => {
      const template: MonitorTemplate = buildTemplate({ customFields: {} });
      const monitor: Monitor = buildLinkedMonitor({ Vendor: "Juniper" });

      jest
        .spyOn(MonitorTemplateService, "findOneById")
        .mockResolvedValue(template);
      jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
      const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> =
        jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(1);

      await MonitorTemplateService.syncToMonitor({
        monitorTemplateId: TEMPLATE_ID,
        monitorId: monitor.id!,
        fields: ["customFields"],
        props: { isRoot: true },
      });

      expect(updateOneSpy).not.toHaveBeenCalled();
    });
  });
});
