import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import Query from "../../../Server/Types/Database/Query";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import ActiveMonitorLimit from "../../../Server/Utils/Billing/ActiveMonitorLimit";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import IP from "../../../Types/IP/IP";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import DeviceMonitorTemplateUtil from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import PositiveNumber from "../../../Types/PositiveNumber";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  DEVICE_HAS_HIDDEN_MONITOR_OF_TEMPLATE_REFUSAL,
  getDeviceHasMonitorOfTemplateRefusal,
} from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import {
  stubRowsCallerMayDeleteLikeFindBy,
  stubRowsCallerMayWriteLikeFindBy,
} from "../TestingUtils/RowsCallerMayWrite";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_TEMPLATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

function stepsFor(deviceId: ObjectID): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    networkDeviceId: deviceId.toString(),
    monitorInterfaces: false,
    oids: [],
  };
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = { monitorStepsInstanceArray: [step] };
  return steps;
}

function automaticMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.NetworkDevice;
  monitor.monitorTemplateId = TEMPLATE_ID;
  monitor.autoProvisionedNetworkDeviceId = DEVICE_ID;
  monitor.monitorSteps = stepsFor(DEVICE_ID);
  return monitor;
}

async function allowDeleteQuery<TBaseModel extends BaseModel>(
  _model: { new (): TBaseModel },
  query: Query<TBaseModel>,
  _props: DatabaseCommonInteractionProps,
): Promise<Query<TBaseModel>> {
  return query;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("auto-provisioned Monitor lifecycle", () => {
  it("refuses a direct create that links a template hidden by the caller's read scope", async () => {
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };
    const readDenied: NotAuthorizedException = new NotAuthorizedException(
      "Monitor template is outside your label scope",
    );
    const findTemplateSpy: SpyInstance<
      typeof MonitorTemplateService.findOneBy
    > = jest
      .spyOn(MonitorTemplateService, "findOneBy")
      .mockRejectedValue(readDenied);
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.NetworkDevice;
    monitor.monitorTemplateId = TEMPLATE_ID;

    await expect(
      (MonitorService as any).onBeforeCreate({
        data: monitor,
        props,
      }),
    ).rejects.toBe(readDenied);

    expect(findTemplateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ props }),
    );
  });

  it("rejects conflicting scalar and relation template IDs on direct create", async () => {
    const findTemplateSpy: SpyInstance<
      typeof MonitorTemplateService.findOneBy
    > = jest.spyOn(MonitorTemplateService, "findOneBy");
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.NetworkDevice;
    monitor.monitorTemplateId = TEMPLATE_ID;
    monitor.monitorTemplate = new MonitorTemplate();
    monitor.monitorTemplate.id = OTHER_TEMPLATE_ID;

    await expect(
      (MonitorService as any).onBeforeCreate({
        data: monitor,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Conflicting Monitor Template references");

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rejects retargeting while provenance still points at the original device", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([automaticMonitor()]);
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorSteps: stepsFor(OTHER_DEVICE_ID) },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("cannot be retargeted");
  });

  it("allows criteria edits that retain the provisioned device binding", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([automaticMonitor()]);
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorSteps: stepsFor(DEVICE_ID) },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).resolves.toBeDefined();
  });

  it("rejects clearing the steps of an automatic monitor", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([automaticMonitor()]);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorSteps: null },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("monitor steps are required");
  });

  /*
   * Issues #11260 and #11266: a monitor an import, an auto import rule or
   * an alert policy made used to be refused any move off its template ("An
   * auto-provisioned monitor cannot be relinked or unlinked from its
   * template. Delete it..."), so "851 of 851 monitors could not be linked"
   * to a better template, and the only way out lost every monitor's
   * history. It moves now, and keeps the template it was created from.
   */
  function networkDeviceTemplateInProject(): void {
    const template: MonitorTemplate = new MonitorTemplate();
    template.id = OTHER_TEMPLATE_ID;
    template.projectId = PROJECT_ID;
    template.monitorType = MonitorType.NetworkDevice;
    jest.spyOn(MonitorTemplateService, "findOneBy").mockResolvedValue(template);
  }

  it("moves an automatic monitor to another template (#11260)", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([automaticMonitor()]);
    networkDeviceTemplateInProject();
    // The device has no other monitor made for it from that template.
    jest.spyOn(MonitorService, "findOneBy").mockResolvedValue(null);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorTemplateId: OTHER_TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).resolves.toBeDefined();
  });

  it("unlinks an automatic monitor from its template (#11266)", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([automaticMonitor()]);
    const findOtherSpy: SpyInstance<typeof MonitorService.findOneBy> = jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue(null);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorTemplateId: null },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).resolves.toBeDefined();

    // An unlink names no template, so no device can have its monitor.
    expect(findOtherSpy).not.toHaveBeenCalled();
  });

  it("refuses a move to a template the device has a monitor of, naming that monitor", async () => {
    const monitor: Monitor = automaticMonitor();
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    networkDeviceTemplateInProject();
    const other: Monitor = new Monitor();
    other.id = ObjectID.generate();
    other.name = "core-sw-01 - Interfaces";
    const findOtherSpy: SpyInstance<typeof MonitorService.findOneBy> = jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue(other);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: monitor.id },
        data: { monitorTemplateId: OTHER_TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      getDeviceHasMonitorOfTemplateRefusal("core-sw-01 - Interfaces"),
    );

    /*
     * Asked of the device's monitors linked to that template, leaving this
     * one out: Monitor's unique (device, template) index would refuse the
     * write with a database error otherwise.
     */
    const query: Record<string, unknown> = (
      findOtherSpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(String(query["autoProvisionedNetworkDeviceId"])).toBe(
      DEVICE_ID.toString(),
    );
    expect(String(query["monitorTemplateId"])).toBe(
      OTHER_TEMPLATE_ID.toString(),
    );
    expect(rawSqlOf(query["_id"])).toContain("!=");
  });

  it("refuses it without the other monitor's name when the caller may not read that monitor", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([automaticMonitor()]);
    networkDeviceTemplateInProject();
    const other: Monitor = new Monitor();
    other.id = ObjectID.generate();
    other.name = "hidden-by-label-scope";
    jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValueOnce(other)
      .mockResolvedValueOnce(null);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorTemplateId: OTHER_TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(DEVICE_HAS_HIDDEN_MONITOR_OF_TEMPLATE_REFUSAL);
  });

  it("asks nothing of the device when the automatic monitor stays on its template", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([automaticMonitor()]);
    const template: MonitorTemplate = new MonitorTemplate();
    template.id = TEMPLATE_ID;
    template.projectId = PROJECT_ID;
    template.monitorType = MonitorType.NetworkDevice;
    jest.spyOn(MonitorTemplateService, "findOneBy").mockResolvedValue(template);
    const findOtherSpy: SpyInstance<typeof MonitorService.findOneBy> = jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue(null);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorTemplateId: TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).resolves.toBeDefined();

    expect(findOtherSpy).not.toHaveBeenCalled();
  });

  it("validates project and type when a regular monitor is linked directly through CRUD", async () => {
    const monitor: Monitor = new Monitor();
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = MonitorType.NetworkDevice;
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    const template: MonitorTemplate = new MonitorTemplate();
    template.projectId = ObjectID.generate();
    template.monitorType = MonitorType.NetworkDevice;
    // The template is read pinned to the monitor's project, as the database would.
    const findTemplateSpy: SpyInstance<
      typeof MonitorTemplateService.findOneBy
    > = jest
      .spyOn(MonitorTemplateService, "findOneBy")
      .mockImplementation((async (input: {
        query: { projectId?: unknown };
      }): Promise<MonitorTemplate | null> => {
        return String(input.query.projectId) === template.projectId!.toString()
          ? template
          : null;
      }) as never);

    // Another project's template reads exactly like one that does not exist.
    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorTemplateId: TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Monitor template not found.");

    expect(
      String(
        (findTemplateSpy.mock.calls[0]![0] as { query: { projectId: unknown } })
          .query.projectId,
      ),
    ).toBe(PROJECT_ID.toString());

    findTemplateSpy.mockResolvedValue(null);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorTemplateId: OTHER_TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Monitor template not found.");
  });

  it("refuses a template of another monitor type, once it is found in the project", async () => {
    const monitor: Monitor = new Monitor();
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = MonitorType.NetworkDevice;
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    const template: MonitorTemplate = new MonitorTemplate();
    template.projectId = PROJECT_ID;
    template.monitorType = MonitorType.Website;
    jest.spyOn(MonitorTemplateService, "findOneBy").mockResolvedValue(template);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorTemplateId: TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Monitor template type must match the monitor type.");
  });

  it("refuses a direct update that links a template hidden by the caller's read scope", async () => {
    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = MonitorType.NetworkDevice;
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    // The monitors the caller's update may write: this one.
    stubRowsCallerMayWriteLikeFindBy(
      MonitorService,
      jest.spyOn(MonitorService, "findBy"),
    );
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };
    const readDenied: NotAuthorizedException = new NotAuthorizedException(
      "Monitor template is outside your label scope",
    );
    const findTemplateSpy: SpyInstance<
      typeof MonitorTemplateService.findOneBy
    > = jest
      .spyOn(MonitorTemplateService, "findOneBy")
      .mockRejectedValue(readDenied);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: monitor.id.toString() },
        data: { monitorTemplateId: TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props,
      }),
    ).rejects.toBe(readDenied);

    expect(findTemplateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ props }),
    );
  });

  it("rejects conflicting scalar and relation template IDs on direct update", async () => {
    const monitor: Monitor = new Monitor();
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = MonitorType.NetworkDevice;
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    const findTemplateSpy: SpyInstance<
      typeof MonitorTemplateService.findOneBy
    > = jest.spyOn(MonitorTemplateService, "findOneBy");

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: {
          monitorTemplateId: TEMPLATE_ID,
          monitorTemplate: { _id: OTHER_TEMPLATE_ID },
        },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Conflicting Monitor Template references");

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rejects an explicit relation clear paired with an automatic monitor's stored template ID", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([automaticMonitor()]);
    const findTemplateSpy: SpyInstance<
      typeof MonitorTemplateService.findOneBy
    > = jest.spyOn(MonitorTemplateService, "findOneBy");

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: {
          monitorTemplateId: TEMPLATE_ID,
          monitorTemplate: null,
        },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Conflicting Monitor Template references");

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });
});

/*
 * Reads the SQL a QueryHelper operator would emit, so a test can say "this
 * clause is IS NULL" rather than "this clause is some opaque object".
 */
function rawSqlOf(operator: unknown): string {
  const findOperator: { getSql?: (alias: string) => string } = operator as {
    getSql?: (alias: string) => string;
  };

  return findOperator?.getSql
    ? findOperator.getSql("column")
    : String(operator);
}

/*
 * A Ping, IP, Port or NTP monitor a discovery import made for a device
 * (issue #5145) carries the same provenance as a Network Device one: the
 * template it came from and the device it was made for. What it must keep
 * is different - an address to check in every step, not a step naming the
 * device - and no other kind of monitor may carry a device's provenance.
 */
describe("a Ping, IP, Port or NTP monitor made for a device", () => {
  function addressSteps(destinations: Array<string | null>): MonitorSteps {
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: destinations.map(
        (destination: string | null): MonitorStep => {
          const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
            monitorName: "Kitchen display",
            monitorType: MonitorType.Ping,
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
          });

          if (destination) {
            step.setMonitorDestination(IP.fromString(destination));
          }

          return step;
        },
      ),
    };
    return steps;
  }

  function addressMonitor(
    monitorType: MonitorType = MonitorType.Ping,
  ): Monitor {
    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = monitorType;
    monitor.monitorTemplateId = TEMPLATE_ID;
    monitor.autoProvisionedNetworkDeviceId = DEVICE_ID;
    monitor.monitorSteps = addressSteps(["10.48.24.33"]);
    return monitor;
  }

  // The template a create names is the project's, of the monitor's own type.
  function templateOfType(monitorType: MonitorType): void {
    const template: MonitorTemplate = new MonitorTemplate();
    template.id = TEMPLATE_ID;
    template.projectId = PROJECT_ID;
    template.monitorType = monitorType;
    jest.spyOn(MonitorTemplateService, "findOneBy").mockResolvedValue(template);
  }

  beforeEach(() => {
    /*
     * CI runs with billing on: the plan checks a create asks before the
     * provenance one are answered here, as a paying project's would be.
     */
    jest
      .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
      .mockResolvedValue(undefined as never);
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      isFreePlan: false,
    } as never);
    jest
      .spyOn(ActiveMonitorLimit, "assertRoomFor")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);
  });

  it("an edit that keeps an address in every step goes on: there is no device step to keep", async () => {
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([addressMonitor()]);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorSteps: addressSteps(["10.48.24.34", "10.48.24.34"]) },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).resolves.toBeDefined();
  });

  it("an edit that leaves a step checking nothing, or clears the steps, is refused", async () => {
    for (const monitorSteps of [addressSteps(["10.48.24.34", null]), null]) {
      jest
        .spyOn(MonitorService, "findBy")
        .mockResolvedValue([addressMonitor(MonitorType.Port)]);

      await expect(
        (MonitorService as any).onBeforeUpdate({
          query: { _id: ObjectID.generate() },
          data: { monitorSteps: monitorSteps },
          limit: 1,
          skip: 0,
          props: { isRoot: true, tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(
        "A Ping, IP, Port or NTP monitor made for a network device must check the device's address in every step.",
      );
    }
  });

  it("a create checks it like a Network Device one: an address in every step, or it is refused", async () => {
    templateOfType(MonitorType.Ping);
    const monitor: Monitor = addressMonitor();
    monitor.monitorSteps = addressSteps([null]);

    await expect(
      (MonitorService as any).onBeforeCreate({
        data: monitor,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "A Ping, IP, Port or NTP monitor made for a network device must check the device's address in every step.",
    );
  });

  it("a create of any other kind of monitor may not carry a device's provenance", async () => {
    templateOfType(MonitorType.DNS);
    const monitor: Monitor = addressMonitor(MonitorType.DNS);

    await expect(
      (MonitorService as any).onBeforeCreate({
        data: monitor,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "Only Network Device, Ping, IP, Port, NTP, Website, API and SSL Certificate monitors can carry auto-provisioning provenance.",
    );
  });

  it("the monitor a discovery import builds for a device passes the create's checks", async () => {
    templateOfType(MonitorType.Ping);
    jest
      .spyOn(MonitorService as any, "validateLinkedResourcesBelongToProject")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorService, "validateDependencyConfiguration")
      .mockResolvedValue(undefined as never);
    const operational: MonitorStatus = new MonitorStatus();
    operational.id = ObjectID.generate();
    jest
      .spyOn(MonitorStatusService, "findOneBy")
      .mockResolvedValue(operational);

    const template: MonitorTemplate = new MonitorTemplate();
    template.id = TEMPLATE_ID;
    template.projectId = PROJECT_ID;
    template.monitorType = MonitorType.Ping;
    template.monitorSteps = addressSteps(["192.0.2.10"]);
    template.monitoringInterval = "*/5 * * * *";
    const device: NetworkDevice = new NetworkDevice();
    device.id = DEVICE_ID;
    device.projectId = PROJECT_ID;
    device.name = "WB0024KDS03";
    device.hostname = "10.48.24.33";

    const monitor: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: template,
      networkDevice: device,
    });

    await expect(
      (MonitorService as any).onBeforeCreate({
        data: monitor,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).resolves.toBeDefined();
    expect(monitor.autoProvisionedNetworkDeviceId?.toString()).toBe(
      DEVICE_ID.toString(),
    );
    expect(
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination?.toString(),
    ).toBe("10.48.24.33");
  });
});

describe("Network Device deletion with automatic monitors", () => {
  /*
   * The delete hook now asks the Network Alert Policy engine to remove the
   * POLICY-owned monitors of every device in the request, as root, before it
   * deletes the rest with the caller's own permissions. That engine call
   * pages MonitorService.findBy; unless a case is about policy monitors, the
   * answer is "this device has none".
   */
  beforeEach(() => {
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
    stubProjectDirectory({});
    /*
     * The devices the caller may delete: those the case's device read
     * answers. A case's own delete permission stub, set after this, decides
     * the rest.
     */
    stubRowsCallerMayDeleteLikeFindBy(
      NetworkDeviceService,
      jest.spyOn(NetworkDeviceService, "findBy"),
    );
  });

  it("fails closed at the foreign key when a monitor appears after service preflight", () => {
    const provenanceRelation: RelationMetadataArgs | undefined =
      getMetadataArgsStorage().relations.find(
        (relation: RelationMetadataArgs): boolean => {
          return (
            relation.target === Monitor &&
            relation.propertyName === "autoProvisionedNetworkDevice"
          );
        },
      );

    expect(provenanceRelation?.options.onDelete).toBe("RESTRICT");
  });

  function device(): NetworkDevice {
    const networkDevice: NetworkDevice = new NetworkDevice();
    networkDevice.id = DEVICE_ID;
    networkDevice.projectId = PROJECT_ID;
    return networkDevice;
  }

  function otherDevice(): NetworkDevice {
    const networkDevice: NetworkDevice = new NetworkDevice();
    networkDevice.id = OTHER_DEVICE_ID;
    networkDevice.projectId = PROJECT_ID;
    return networkDevice;
  }

  it("deletes the automatic monitor through MonitorService with tenant and caller context", async () => {
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(allowDeleteQuery);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([device()]);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(0));
    const deleteMonitorSpy: SpyInstance<typeof MonitorService.deleteBy> = jest
      .spyOn(MonitorService, "deleteBy")
      .mockResolvedValue(1);

    await (NetworkDeviceService as any).onBeforeDelete({
      query: { _id: DEVICE_ID },
      limit: 1,
      skip: 0,
      props: props,
    });

    expect(deleteMonitorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: PROJECT_ID,
          autoProvisionedNetworkDeviceId: DEVICE_ID,
        }),
        props: expect.objectContaining({
          tenantId: PROJECT_ID,
          userId: props.userId,
        }),
      }),
    );

    /*
     * ...and ONLY the monitors no alert policy owns. A policy's monitors are
     * system-managed — the API can neither set nor clear their
     * networkAlertPolicyId — so requiring the caller's Monitor delete
     * permission on them would refuse a device delete over rows the caller
     * never chose to own. The engine removes those as root instead.
     */
    const deletedMonitorQuery: Query<Monitor> = (
      deleteMonitorSpy.mock.calls[0]![0] as { query: Query<Monitor> }
    ).query;

    expect(rawSqlOf(deletedMonitorQuery.networkAlertPolicyId)).toContain(
      "IS NULL",
    );
  });

  it("does not require Monitor delete permission when the device has no automatic monitor", async () => {
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(allowDeleteQuery);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([device()]);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    const deleteMonitorSpy: SpyInstance<typeof MonitorService.deleteBy> =
      jest.spyOn(MonitorService, "deleteBy");

    await (NetworkDeviceService as any).onBeforeDelete({
      query: { _id: DEVICE_ID },
      limit: 1,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    });

    expect(deleteMonitorSpy).not.toHaveBeenCalled();
  });

  /*
   * THE INVARIANT THESE TWO CASES EXIST FOR. Monitor's provenance FK is
   * RESTRICT, so a policy-owned monitor left behind makes the device delete
   * fail outright — and those monitors are exactly the ones the operator
   * never chose individually, because the API cannot write
   * networkAlertPolicyId at all. They are removed by the engine, as root,
   * and they never appear in the caller-authorized preflight.
   */
  it("removes the device's policy-owned monitors as root", async () => {
    const policyMonitor: Monitor = automaticMonitor();
    policyMonitor.networkAlertPolicyId = ObjectID.generate();

    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(allowDeleteQuery);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([device()]);
    // No monitors are left for the caller-permissioned half of the cleanup.
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValueOnce([policyMonitor])
      .mockResolvedValue([]);
    const deleteMonitorSpy: SpyInstance<typeof MonitorService.deleteBy> = jest
      .spyOn(MonitorService, "deleteBy")
      .mockResolvedValue(1);

    await (NetworkDeviceService as any).onBeforeDelete({
      query: { _id: DEVICE_ID },
      limit: 1,
      skip: 0,
      props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
    });

    expect(deleteMonitorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        props: { isRoot: true },
      }),
    );

    /*
     * Still keyed on "a policy owns it" at the moment of the delete, so a
     * monitor that lost its owner between the page read and the delete is
     * left to the caller-permissioned half rather than swept up as root.
     */
    const policyDeleteQuery: Query<Monitor> = (
      deleteMonitorSpy.mock.calls[0]![0] as { query: Query<Monitor> }
    ).query;

    expect(rawSqlOf(policyDeleteQuery.networkAlertPolicyId)).toContain(
      "IS NOT NULL",
    );
  });

  it("does not remove policy monitors until every device has cleared the preflight", async () => {
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(
        async (
          modelType: { new (): BaseModel },
          query: Query<BaseModel>,
          props: DatabaseCommonInteractionProps,
        ): Promise<Query<BaseModel>> => {
          if ((modelType as unknown) === Monitor) {
            throw new NotAuthorizedException("no monitor delete");
          }

          return await allowDeleteQuery(modelType, query, props);
        },
      );
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([device(), otherDevice()]);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const deleteMonitorSpy: SpyInstance<typeof MonitorService.deleteBy> =
      jest.spyOn(MonitorService, "deleteBy");

    await expect(
      (NetworkDeviceService as any).onBeforeDelete({
        query: { _id: DEVICE_ID },
        limit: 2,
        skip: 0,
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(NotAuthorizedException);

    /*
     * Nothing was deleted. A policy's monitors carry the fleet's incident
     * history, and destroying them for a device that then SURVIVES the
     * request — because a later device in the same bulk delete was refused —
     * would be unrecoverable.
     */
    expect(deleteMonitorSpy).not.toHaveBeenCalled();
  });

  it("keeps the device when Monitor deletion is not authorized", async () => {
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(allowDeleteQuery);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([device()]);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(1));
    jest
      .spyOn(MonitorService, "deleteBy")
      .mockRejectedValue(
        new NotAuthorizedException("Monitor delete is blocked"),
      );

    await expect(
      (NetworkDeviceService as any).onBeforeDelete({
        query: { _id: DEVICE_ID },
        limit: 1,
        skip: 0,
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Monitor delete is blocked");
  });

  it("fails before deleting anything when permission scope excludes an automatic monitor", async () => {
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(allowDeleteQuery);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([device()]);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(2))
      .mockResolvedValueOnce(new PositiveNumber(1));
    const deleteMonitorSpy: SpyInstance<typeof MonitorService.deleteBy> =
      jest.spyOn(MonitorService, "deleteBy");

    await expect(
      (NetworkDeviceService as any).onBeforeDelete({
        query: { _id: DEVICE_ID },
        limit: 1,
        skip: 0,
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("permission to delete every auto-provisioned monitor");

    expect(deleteMonitorSpy).not.toHaveBeenCalled();
  });

  it("preflights every device in a bulk delete before deleting any monitor", async () => {
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(allowDeleteQuery);
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([device(), otherDevice()]);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(0));
    const deleteMonitorSpy: SpyInstance<typeof MonitorService.deleteBy> =
      jest.spyOn(MonitorService, "deleteBy");

    await expect(
      (NetworkDeviceService as any).onBeforeDelete({
        query: { projectId: PROJECT_ID },
        limit: 2,
        skip: 0,
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("permission to delete every auto-provisioned monitor");

    expect(deleteMonitorSpy).not.toHaveBeenCalled();
  });

  it("deletes automatic monitors in repeated bounded batches", async () => {
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(allowDeleteQuery);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([device()]);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(LIMIT_MAX + 1))
      .mockResolvedValueOnce(new PositiveNumber(LIMIT_MAX + 1))
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(0));
    const deleteMonitorSpy: SpyInstance<typeof MonitorService.deleteBy> = jest
      .spyOn(MonitorService, "deleteBy")
      .mockResolvedValueOnce(LIMIT_MAX)
      .mockResolvedValueOnce(1);

    await (NetworkDeviceService as any).onBeforeDelete({
      query: { _id: DEVICE_ID },
      limit: 1,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    });

    expect(deleteMonitorSpy).toHaveBeenCalledTimes(2);
    expect(deleteMonitorSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ limit: LIMIT_MAX, skip: 0 }),
    );
    expect(deleteMonitorSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: LIMIT_MAX, skip: 0 }),
    );
  });

  it("fails closed when a permission-scoped batch makes no progress", async () => {
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(allowDeleteQuery);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([device()]);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(1));
    jest.spyOn(MonitorService, "deleteBy").mockResolvedValue(0);

    await expect(
      (NetworkDeviceService as any).onBeforeDelete({
        query: { _id: DEVICE_ID },
        limit: 1,
        skip: 0,
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Could not delete every auto-provisioned monitor");
  });
});

/*
 * WHAT A MOVE OFF A TEMPLATE KEEPS ON THE MONITOR (issues #11260, #11266),
 * written once the write has passed every check (onUpdatePermitted): the
 * template it was created from, when it is not recorded yet, and - for a
 * person's write - the monitor taken from the alert policy that owned it,
 * which would otherwise delete it for carrying another template.
 */
describe("what a move to another template keeps", () => {
  const POLICY_ID: ObjectID = new ObjectID(
    "66666666-6666-4666-8666-666666666666",
  );

  function personProps(): DatabaseCommonInteractionProps {
    return { tenantId: PROJECT_ID, userId: ObjectID.generate() };
  }

  function rowsTheWriteMoves(
    monitors: Array<Monitor>,
  ): SpyInstance<typeof MonitorService.findBy> {
    const findBySpy: SpyInstance<typeof MonitorService.findBy> = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue(monitors as never);
    stubRowsCallerMayWriteLikeFindBy(MonitorService, findBySpy as never);
    return findBySpy;
  }

  /*
   * The update of the monitors it moves: one named by its id, as a form's
   * or a change's write is; several by their project, as a bulk write is.
   */
  function updateOf(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
    monitors: Array<Monitor>,
  ): {
    query: Record<string, unknown>;
    data: Record<string, unknown>;
    limit: number;
    skip: number;
    props: DatabaseCommonInteractionProps;
  } {
    return {
      query:
        monitors.length === 1
          ? { _id: monitors[0]!.id!.toString() }
          : { projectId: PROJECT_ID },
      data: data,
      limit: monitors.length,
      skip: 0,
      props: props,
    };
  }

  it("stamps the template a monitor made before it was recorded leaves, and takes it from its policy, in the same write", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.networkAlertPolicyId = POLICY_ID;
    rowsTheWriteMoves([monitor]);
    const hookFree: SpyInstance<
      typeof MonitorService.updateColumnsByIdWithoutHooks
    > = jest
      .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    const updateBy: ReturnType<typeof updateOf> = updateOf(
      { monitorTemplateId: OTHER_TEMPLATE_ID },
      personProps(),
      [monitor],
    );

    await (MonitorService as any).onUpdatePermitted(updateBy);

    expect(String(updateBy.data["createdFromMonitorTemplateId"])).toBe(
      TEMPLATE_ID.toString(),
    );
    expect(updateBy.data["networkAlertPolicyId"]).toBeNull();
    expect(hookFree).not.toHaveBeenCalled();
  });

  it("stamps it on an unlink too", async () => {
    const monitor: Monitor = automaticMonitor();
    rowsTheWriteMoves([monitor]);

    const updateBy: ReturnType<typeof updateOf> = updateOf(
      { monitorTemplateId: null },
      personProps(),
      [monitor],
    );

    await (MonitorService as any).onUpdatePermitted(updateBy);

    expect(String(updateBy.data["createdFromMonitorTemplateId"])).toBe(
      TEMPLATE_ID.toString(),
    );
    expect("networkAlertPolicyId" in updateBy.data).toBe(false);
  });

  it("never moves a template it was created from that is recorded already", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.monitorTemplateId = OTHER_TEMPLATE_ID;
    monitor.createdFromMonitorTemplateId = TEMPLATE_ID;
    rowsTheWriteMoves([monitor]);

    const updateBy: ReturnType<typeof updateOf> = updateOf(
      { monitorTemplateId: null },
      personProps(),
      [monitor],
    );

    await (MonitorService as any).onUpdatePermitted(updateBy);

    expect("createdFromMonitorTemplateId" in updateBy.data).toBe(false);
  });

  it("keeps the policy on OneUptime's own write", async () => {
    const monitor: Monitor = automaticMonitor();
    monitor.networkAlertPolicyId = POLICY_ID;
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);

    const updateBy: ReturnType<typeof updateOf> = updateOf(
      { monitorTemplateId: OTHER_TEMPLATE_ID },
      { isRoot: true, tenantId: PROJECT_ID },
      [monitor],
    );

    await (MonitorService as any).onUpdatePermitted(updateBy);

    expect(String(updateBy.data["createdFromMonitorTemplateId"])).toBe(
      TEMPLATE_ID.toString(),
    );
    expect("networkAlertPolicyId" in updateBy.data).toBe(false);
  });

  it("keeps each of several monitors' own template by itself first, when they differ", async () => {
    const first: Monitor = automaticMonitor();
    const second: Monitor = automaticMonitor();
    second.monitorTemplateId = OTHER_TEMPLATE_ID;
    second.networkAlertPolicyId = POLICY_ID;
    rowsTheWriteMoves([first, second]);
    const hookFree: SpyInstance<
      typeof MonitorService.updateColumnsByIdWithoutHooks
    > = jest
      .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    const thirdTemplate: ObjectID = ObjectID.generate();
    const updateBy: ReturnType<typeof updateOf> = updateOf(
      { monitorTemplateId: thirdTemplate },
      personProps(),
      [first, second],
    );

    await (MonitorService as any).onUpdatePermitted(updateBy);

    expect("createdFromMonitorTemplateId" in updateBy.data).toBe(false);
    expect("networkAlertPolicyId" in updateBy.data).toBe(false);
    expect(
      hookFree.mock.calls.map((call: Array<unknown>) => {
        const arg: { id: ObjectID; data: Record<string, unknown> } =
          call[0] as {
            id: ObjectID;
            data: Record<string, unknown>;
          };
        return {
          id: arg.id.toString(),
          createdFrom: String(arg.data["createdFromMonitorTemplateId"]),
          releasesPolicy: arg.data["networkAlertPolicyId"] === null,
        };
      }),
    ).toEqual([
      {
        id: first.id!.toString(),
        createdFrom: TEMPLATE_ID.toString(),
        releasesPolicy: false,
      },
      {
        id: second.id!.toString(),
        createdFrom: OTHER_TEMPLATE_ID.toString(),
        releasesPolicy: true,
      },
    ]);
  });

  it("keeps the same for several monitors in the one write, when they share it", async () => {
    const pair: Array<Monitor> = [automaticMonitor(), automaticMonitor()];
    rowsTheWriteMoves(pair);
    const hookFree: SpyInstance<
      typeof MonitorService.updateColumnsByIdWithoutHooks
    > = jest
      .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    const updateBy: ReturnType<typeof updateOf> = updateOf(
      { monitorTemplateId: OTHER_TEMPLATE_ID },
      personProps(),
      pair,
    );

    await (MonitorService as any).onUpdatePermitted(updateBy);

    expect(String(updateBy.data["createdFromMonitorTemplateId"])).toBe(
      TEMPLATE_ID.toString(),
    );
    expect(hookFree).not.toHaveBeenCalled();
  });

  it("reads nothing for a write that names no template", async () => {
    const monitor: Monitor = automaticMonitor();
    const findBySpy: SpyInstance<typeof MonitorService.findBy> =
      rowsTheWriteMoves([monitor]);

    const updateBy: ReturnType<typeof updateOf> = updateOf(
      { name: "core-sw-01" },
      personProps(),
      [monitor],
    );

    await (MonitorService as any).onUpdatePermitted(updateBy);

    expect(findBySpy).not.toHaveBeenCalled();
    expect(updateBy.data).toEqual({ name: "core-sw-01" });
  });

  it("a create from a template stamps it as the one the monitor was created from", async () => {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.NetworkDevice;
    monitor.monitorTemplateId = TEMPLATE_ID;

    await (MonitorService as any).onCreatePermitted({
      createBy: { data: monitor, props: personProps() },
      carryForward: {},
    });

    expect(monitor.createdFromMonitorTemplateId?.toString()).toBe(
      TEMPLATE_ID.toString(),
    );
  });

  it("a create from no template stamps none, and OneUptime's own value is kept", async () => {
    const fromNone: Monitor = new Monitor();
    fromNone.monitorType = MonitorType.NetworkDevice;

    await (MonitorService as any).onCreatePermitted({
      createBy: { data: fromNone, props: personProps() },
      carryForward: {},
    });

    expect(fromNone.createdFromMonitorTemplateId).toBeUndefined();

    const copied: Monitor = new Monitor();
    copied.monitorType = MonitorType.NetworkDevice;
    copied.monitorTemplateId = OTHER_TEMPLATE_ID;
    copied.createdFromMonitorTemplateId = TEMPLATE_ID;

    await (MonitorService as any).onCreatePermitted({
      createBy: { data: copied, props: { isRoot: true, tenantId: PROJECT_ID } },
      carryForward: {},
    });

    expect(copied.createdFromMonitorTemplateId?.toString()).toBe(
      TEMPLATE_ID.toString(),
    );
  });
});
