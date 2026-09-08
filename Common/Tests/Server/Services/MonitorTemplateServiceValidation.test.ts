import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import { Service } from "../../../Server/Services/MonitorTemplateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

class TestService extends Service {
  public override async onBeforeCreate(
    createBy: CreateBy<MonitorTemplate>,
  ): Promise<OnCreate<MonitorTemplate>> {
    return super.onBeforeCreate(createBy);
  }

  public override async onBeforeUpdate(
    updateBy: UpdateBy<MonitorTemplate>,
  ): Promise<OnUpdate<MonitorTemplate>> {
    return super.onBeforeUpdate(updateBy);
  }
}

const service: TestService = new TestService();
const PROJECT_ID: ObjectID = ObjectID.generate();

function buildTemplate(
  monitorType: MonitorType = MonitorType.Website,
): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = ObjectID.generate();
  template.projectId = PROJECT_ID;
  template.monitorType = monitorType;
  template.monitorSteps = MonitorSteps.getDefaultMonitorSteps({
    defaultMonitorStatusId: ObjectID.generate(),
    monitorType,
    monitorName: "Shared checks",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  return template;
}

function createRequest(template: MonitorTemplate): CreateBy<MonitorTemplate> {
  return { data: template, props: { tenantId: PROJECT_ID } };
}

function updateRequest(
  template: MonitorTemplate,
  data: Partial<
    Pick<MonitorTemplate, "monitorSteps" | "monitorType" | "templateName">
  >,
): UpdateBy<MonitorTemplate> {
  return {
    query: { _id: template.id!.toString() },
    data: data as unknown as UpdateBy<MonitorTemplate>["data"],
    props: { tenantId: PROJECT_ID },
    limit: 1,
    skip: 0,
  };
}

beforeEach(() => {
  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateService validation", () => {
  it.each([
    MonitorType.Website,
    MonitorType.API,
    MonitorType.SSLCertificate,
    MonitorType.Ping,
    MonitorType.IP,
    MonitorType.Port,
    MonitorType.Domain,
    MonitorType.DNS,
    MonitorType.Database,
    MonitorType.ExternalStatusPage,
    MonitorType.NetworkDevice,
    MonitorType.Kubernetes,
    MonitorType.Docker,
    MonitorType.Host,
    MonitorType.Podman,
    MonitorType.Proxmox,
    MonitorType.DockerSwarm,
    MonitorType.Ceph,
    MonitorType.IoTDevice,
  ])(
    "creates %s templates with shared criteria and no target",
    async (monitorType: MonitorType) => {
      const template: MonitorTemplate = buildTemplate(monitorType);
      const request: CreateBy<MonitorTemplate> = createRequest(template);

      await expect(service.onBeforeCreate(request)).resolves.toEqual({
        createBy: request,
        carryForward: null,
      });
      expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject,
      ).toHaveBeenCalledWith({
        monitorSteps: template.monitorSteps,
        projectId: PROJECT_ID,
      });
      expect(
        MonitorSteps.getValidationError(template.monitorSteps!, monitorType),
      ).not.toBeNull();
    },
  );

  it("allows creating a template before its optional steps are configured", async () => {
    const template: MonitorTemplate = buildTemplate();
    delete template.monitorSteps;
    await expect(
      service.onBeforeCreate(createRequest(template)),
    ).resolves.toBeDefined();
  });

  it("rejects missing criteria on create even when a target can be omitted", async () => {
    const template: MonitorTemplate = buildTemplate();
    template.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria =
      undefined as never;

    await expect(
      service.onBeforeCreate(createRequest(template)),
    ).rejects.toThrow("Monitor Criteria is required");
    expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject,
    ).not.toHaveBeenCalled();
  });

  it("rejects a missing HTTP request method on create", async () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.API);
    template.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.requestType =
      undefined as never;
    await expect(
      service.onBeforeCreate(createRequest(template)),
    ).rejects.toThrow("Request Type is required");
  });

  it("rejects an incomplete TLS configuration on update", async () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.API);
    jest.spyOn(service, "findBy").mockResolvedValue([template]);
    const changedSteps: MonitorSteps = MonitorSteps.clone(
      template.monitorSteps!,
    );
    changedSteps.data!.monitorStepsInstanceArray[0]!.setTlsClientCertificate(
      "certificate",
    );

    await expect(
      service.onBeforeUpdate(
        updateRequest(template, { monitorSteps: changedSteps }),
      ),
    ).rejects.toThrow(
      "Client private key is required when a client certificate is provided",
    );
  });

  it("uses the stored monitor type when only steps change", async () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.API);
    jest.spyOn(service, "findBy").mockResolvedValue([template]);
    const changedSteps: MonitorSteps = MonitorSteps.clone(
      template.monitorSteps!,
    );
    const step: MonitorStep = changedSteps.data!.monitorStepsInstanceArray[0]!;
    step.setRequestBody('{"healthy":true}');
    const request: UpdateBy<MonitorTemplate> = updateRequest(template, {
      monitorSteps: changedSteps,
    });

    await expect(service.onBeforeUpdate(request)).resolves.toEqual({
      updateBy: request,
      carryForward: null,
    });
    expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject,
    ).toHaveBeenCalledWith({
      monitorSteps: changedSteps,
      projectId: PROJECT_ID,
      alreadyStoredMonitorSteps: template.monitorSteps,
    });
  });

  it("validates existing steps against a changed monitor type", async () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.Website);
    jest.spyOn(service, "findBy").mockResolvedValue([template]);

    await expect(
      service.onBeforeUpdate(
        updateRequest(template, { monitorType: MonitorType.SQLQuery }),
      ),
    ).rejects.toThrow("SQL monitor configuration is required");
  });

  it("does not revalidate unrelated updates against an unfinished template", async () => {
    const template: MonitorTemplate = buildTemplate();
    const findSpy: SpyInstance<typeof service.findBy> = jest.spyOn(
      service,
      "findBy",
    );
    const request: UpdateBy<MonitorTemplate> = updateRequest(template, {
      templateName: "Renamed template",
    });
    await expect(service.onBeforeUpdate(request)).resolves.toEqual({
      updateBy: request,
      carryForward: null,
    });
    expect(findSpy).not.toHaveBeenCalled();
  });

  it("still rejects references outside the template project", async () => {
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockRejectedValue(
        new BadDataException("Monitor status belongs to another project"),
      );

    await expect(
      service.onBeforeCreate(createRequest(buildTemplate())),
    ).rejects.toThrow("Monitor status belongs to another project");
  });

  it("rejects a later invalid step during template updates", async () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.API);
    jest.spyOn(service, "findBy").mockResolvedValue([template]);
    const changedSteps: MonitorSteps = MonitorSteps.clone(
      template.monitorSteps!,
    );
    const invalidStep: MonitorStep = MonitorStep.clone(
      changedSteps.data!.monitorStepsInstanceArray[0]!,
    );
    invalidStep.data!.tlsClientKey = "private key";
    changedSteps.data!.monitorStepsInstanceArray.push(invalidStep);

    await expect(
      service.onBeforeUpdate(
        updateRequest(template, { monitorSteps: changedSteps }),
      ),
    ).rejects.toThrow(
      "Client certificate is required when a client private key is provided",
    );
  });
});
