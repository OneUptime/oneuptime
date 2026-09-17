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
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
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
      typeof MonitorTemplateService.findOneById
    > = jest
      .spyOn(MonitorTemplateService, "findOneById")
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
      typeof MonitorTemplateService.findOneById
    > = jest.spyOn(MonitorTemplateService, "findOneById");
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

  it("rejects relinking or unlinking an automatic monitor's template", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([automaticMonitor()]);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorTemplateId: OTHER_TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("cannot be relinked or unlinked");
  });

  it("validates project and type when a regular monitor is linked directly through CRUD", async () => {
    const monitor: Monitor = new Monitor();
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = MonitorType.NetworkDevice;
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    const template: MonitorTemplate = new MonitorTemplate();
    template.projectId = ObjectID.generate();
    template.monitorType = MonitorType.NetworkDevice;
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { monitorTemplateId: TEMPLATE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("same project as the monitor");
  });

  it("refuses a direct update that links a template hidden by the caller's read scope", async () => {
    const monitor: Monitor = new Monitor();
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = MonitorType.NetworkDevice;
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };
    const readDenied: NotAuthorizedException = new NotAuthorizedException(
      "Monitor template is outside your label scope",
    );
    const findTemplateSpy: SpyInstance<
      typeof MonitorTemplateService.findOneById
    > = jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockRejectedValue(readDenied);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
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
      typeof MonitorTemplateService.findOneById
    > = jest.spyOn(MonitorTemplateService, "findOneById");

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
      typeof MonitorTemplateService.findOneById
    > = jest.spyOn(MonitorTemplateService, "findOneById");

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
