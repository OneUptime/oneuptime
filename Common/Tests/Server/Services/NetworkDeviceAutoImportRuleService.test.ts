import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_TEMPLATE_COLUMNS: Array<string> = [
  "monitorTemplate",
  "monitorTemplateId",
];
const MONITOR_CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.MonitorAdmin,
  Permission.MonitorMember,
  Permission.CreateProjectMonitor,
];
const MONITOR_TEMPLATE_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.MonitorAdmin,
  Permission.MonitorMember,
  Permission.MonitorViewer,
  Permission.ReadMonitorTemplate,
];

function makeCreateBy(
  overrides: Partial<NetworkDeviceAutoImportRule> = {},
): CreateBy<NetworkDeviceAutoImportRule> {
  const rule: NetworkDeviceAutoImportRule = new NetworkDeviceAutoImportRule();
  rule.projectId = PROJECT_ID;
  rule.ipMatchTarget = "10.0.0.0/24";
  Object.assign(rule, overrides);

  return {
    data: rule,
    props: { isRoot: true },
  };
}

function mockMonitorTemplate(
  overrides: Partial<MonitorTemplate> = {},
  hasProject: boolean = true,
): jest.SpyInstance {
  const monitorTemplate: MonitorTemplate = new MonitorTemplate();
  monitorTemplate.projectId = PROJECT_ID;
  monitorTemplate.monitorType = MonitorType.NetworkDevice;
  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    networkDeviceId: ObjectID.generate().toString(),
    monitorInterfaces: true,
    oids: [],
  };
  monitorTemplate.monitorSteps = new MonitorSteps();
  monitorTemplate.monitorSteps.data = {
    monitorStepsInstanceArray: [step],
  };
  Object.assign(monitorTemplate, overrides);
  if (!hasProject) {
    delete monitorTemplate.projectId;
  }

  return jest
    .spyOn(MonitorTemplateService, "findOneById")
    .mockResolvedValue(monitorTemplate);
}

describe("NetworkDeviceAutoImportRule monitor template column access", () => {
  const rule: NetworkDeviceAutoImportRule = new NetworkDeviceAutoImportRule();

  it.each(MONITOR_TEMPLATE_COLUMNS)(
    "%s requires monitor-create permission to write",
    (columnName: string) => {
      const accessControl: ReturnType<
        NetworkDeviceAutoImportRule["getColumnAccessControlFor"]
      > = rule.getColumnAccessControlFor(columnName);

      expect(accessControl?.create).toEqual(MONITOR_CREATE_PERMISSIONS);
      expect(accessControl?.update).toEqual(MONITOR_CREATE_PERMISSIONS);
      expect(accessControl?.create).not.toContain(
        Permission.CreateNetworkDeviceAutoImportRule,
      );
      expect(accessControl?.update).not.toContain(
        Permission.EditNetworkDeviceAutoImportRule,
      );
    },
  );

  it.each(MONITOR_TEMPLATE_COLUMNS)(
    "%s requires monitor-template permission to read",
    (columnName: string) => {
      expect(rule.getColumnAccessControlFor(columnName)?.read).toEqual(
        MONITOR_TEMPLATE_READ_PERMISSIONS,
      );
    },
  );
});

describe("Monitor auto-provisioning provenance", () => {
  it("allows only one live monitor for a device and template", () => {
    const uniqueIndex: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === Monitor &&
            index.name === "IDX_monitor_auto_provisioned_device_template_unique"
          );
        },
      );

    expect(uniqueIndex?.columns).toEqual([
      "autoProvisionedNetworkDeviceId",
      "monitorTemplateId",
    ]);
    expect(uniqueIndex?.unique).toBe(true);
    expect(uniqueIndex?.where).toBe(
      '"deletedAt" IS NULL AND "autoProvisionedNetworkDeviceId" IS NOT NULL AND "monitorTemplateId" IS NOT NULL',
    );
  });
});

describe("NetworkDeviceAutoImportRuleService.onBeforeCreate monitor template validation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not look up a template when no template is selected", async () => {
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy(),
      ),
    ).resolves.toBeDefined();

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("accepts a Network Device template from the same project", async () => {
    const findTemplateSpy: jest.SpyInstance = mockMonitorTemplate();

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy({ monitorTemplateId: TEMPLATE_ID }),
      ),
    ).resolves.toBeDefined();

    expect(findTemplateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: TEMPLATE_ID }),
    );
  });

  it("uses the request tenant before DatabaseService injects projectId", async () => {
    mockMonitorTemplate();
    const createBy: CreateBy<NetworkDeviceAutoImportRule> = makeCreateBy({
      monitorTemplateId: TEMPLATE_ID,
    });
    delete createBy.data.projectId;
    createBy.props.tenantId = PROJECT_ID;

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(createBy),
    ).resolves.toBeDefined();
  });

  it("validates the dashboard's monitorTemplate relation payload", async () => {
    const findTemplateSpy: jest.SpyInstance = mockMonitorTemplate();
    const createBy: CreateBy<NetworkDeviceAutoImportRule> = makeCreateBy();
    (createBy.data as any).monitorTemplate = {
      _id: TEMPLATE_ID.toString(),
    };

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(createBy),
    ).resolves.toBeDefined();

    expect(findTemplateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(ObjectID) }),
    );
  });

  it("rejects conflicting scalar and relation template IDs on create", async () => {
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );
    const createBy: CreateBy<NetworkDeviceAutoImportRule> = makeCreateBy({
      monitorTemplateId: TEMPLATE_ID,
    });
    (createBy.data as any).monitorTemplate = { _id: OTHER_PROJECT_ID };

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(createBy),
    ).rejects.toThrow("Conflicting Monitor Template references");

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rejects a monitor template that does not exist", async () => {
    jest.spyOn(MonitorTemplateService, "findOneById").mockResolvedValue(null);

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy({ monitorTemplateId: TEMPLATE_ID }),
      ),
    ).rejects.toThrow("Monitor template not found.");
  });

  it("rejects a monitor template from another project", async () => {
    mockMonitorTemplate({ projectId: OTHER_PROJECT_ID });

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy({ monitorTemplateId: TEMPLATE_ID }),
      ),
    ).rejects.toThrow("Monitor template must belong to the same project.");
  });

  it("rejects a monitor template without a project", async () => {
    mockMonitorTemplate({}, false);

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy({ monitorTemplateId: TEMPLATE_ID }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a template for any other monitor type", async () => {
    mockMonitorTemplate({ monitorType: MonitorType.Ping });

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy({ monitorTemplateId: TEMPLATE_ID }),
      ),
    ).rejects.toThrow(
      "Monitor template must be a Network Device monitor template.",
    );
  });

  it("rejects a Network Device template without usable monitor steps", async () => {
    mockMonitorTemplate({ monitorSteps: null as never });

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy({ monitorTemplateId: TEMPLATE_ID }),
      ),
    ).rejects.toThrow("Monitor template monitor steps are required.");
  });

  it("checks both Monitor create allow and block permissions for a template-backed rule", async () => {
    mockMonitorTemplate();
    const allowSpy: jest.SpyInstance = jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    const blockSpy: jest.SpyInstance = jest
      .spyOn(TablePermission, "checkTableLevelBlockPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    const createBy: CreateBy<NetworkDeviceAutoImportRule> = makeCreateBy({
      monitorTemplateId: TEMPLATE_ID,
    });
    createBy.props = { tenantId: PROJECT_ID };

    await (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(createBy);

    expect(allowSpy).toHaveBeenCalledWith(Monitor, createBy.props, "create");
    expect(blockSpy).toHaveBeenCalledWith(Monitor, createBy.props, "create");
  });

  it("reads the selected template with the caller's tenant and label scope", async () => {
    const findTemplateSpy: jest.SpyInstance = mockMonitorTemplate();
    jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    jest
      .spyOn(TablePermission, "checkTableLevelBlockPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    const createBy: CreateBy<NetworkDeviceAutoImportRule> = makeCreateBy({
      monitorTemplateId: TEMPLATE_ID,
    });
    createBy.props = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };

    await (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(createBy);

    expect(findTemplateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TEMPLATE_ID,
        props: createBy.props,
      }),
    );
  });

  it("refuses a template the caller's read scope hides", async () => {
    const readDenied: NotAuthorizedException = new NotAuthorizedException(
      "Monitor template is outside your label scope",
    );
    const findTemplateSpy: jest.SpyInstance = jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockRejectedValue(readDenied);
    jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    jest
      .spyOn(TablePermission, "checkTableLevelBlockPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    const createBy: CreateBy<NetworkDeviceAutoImportRule> = makeCreateBy({
      monitorTemplateId: TEMPLATE_ID,
    });
    createBy.props = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(createBy),
    ).rejects.toBe(readDenied);

    expect(findTemplateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ props: createBy.props }),
    );
  });

  it("refuses a template-backed rule when Monitor creation is explicitly blocked", async () => {
    const findTemplateSpy: jest.SpyInstance = mockMonitorTemplate();
    jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    jest
      .spyOn(TablePermission, "checkTableLevelBlockPermissions")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Monitor create is blocked");
      });
    const createBy: CreateBy<NetworkDeviceAutoImportRule> = makeCreateBy({
      monitorTemplateId: TEMPLATE_ID,
    });
    createBy.props = { tenantId: PROJECT_ID };

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(createBy),
    ).rejects.toThrow("Monitor create is blocked");
    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rejects selecting a template on an exclusion rule without a lookup", async () => {
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy({
          monitorTemplateId: TEMPLATE_ID,
          isExclusion: true,
        }),
      ),
    ).rejects.toThrow("Exclusion rules cannot select a monitor template.");

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rejects selecting a template when ping-only hosts are included without a lookup", async () => {
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy({
          monitorTemplateId: TEMPLATE_ID,
          includePingOnlyHosts: true,
        }),
      ),
    ).rejects.toThrow(
      "Rules that include ping-only hosts cannot select a Network Device monitor template.",
    );

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("allows exclusion and ping-only rules when no template is selected", async () => {
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeCreate(
        makeCreateBy({ isExclusion: true, includePingOnlyHosts: true }),
      ),
    ).resolves.toBeDefined();

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });
});

describe("NetworkDeviceAutoImportRuleService.onBeforeUpdate monitor template validation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeUpdateBy(
    data: Record<string, unknown>,
  ): UpdateBy<NetworkDeviceAutoImportRule> {
    return {
      query: { _id: "some-rule-id" },
      data: data,
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDeviceAutoImportRule>;
  }

  function mockExistingRule(
    overrides: Partial<NetworkDeviceAutoImportRule> = {},
  ): jest.SpyInstance {
    const rule: NetworkDeviceAutoImportRule = new NetworkDeviceAutoImportRule();
    rule.projectId = PROJECT_ID;
    rule.ipMatchTarget = "10.0.0.0/24";
    rule.isExclusion = false;
    rule.includePingOnlyHosts = false;
    Object.assign(rule, overrides);

    return jest
      .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
      .mockResolvedValue([rule]);
  }

  it("avoids both row and template lookups for an unrelated update", async () => {
    const findRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceAutoImportRuleService,
      "findBy",
    );
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ name: "Updated name" }),
      ),
    ).resolves.toBeDefined();

    expect(findRulesSpy).not.toHaveBeenCalled();
    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("tenant-scopes the privileged update snapshot before validating a guessed rule ID", async () => {
    const findRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
      .mockResolvedValue([]);
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );
    const updateBy: UpdateBy<NetworkDeviceAutoImportRule> = makeUpdateBy({
      monitorTemplateId: TEMPLATE_ID,
    });
    updateBy.props = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(updateBy),
    ).resolves.toBeDefined();

    expect(findRulesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: "some-rule-id",
          projectId: PROJECT_ID,
        },
        props: { isRoot: true },
      }),
    );
    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("keeps criteria-only updates independent of template lookup", async () => {
    mockExistingRule();
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ ipMatchTarget: "192.168.0.0/16" }),
      ),
    ).resolves.toBeDefined();

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rechecks Monitor create permission before broadening an enabled template-backed rule", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID, isEnabled: true });
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );
    jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    jest
      .spyOn(TablePermission, "checkTableLevelBlockPermissions")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Monitor create is blocked");
      });
    const updateBy: UpdateBy<NetworkDeviceAutoImportRule> = makeUpdateBy({
      ipMatchTarget: "0.0.0.0/0",
    });
    updateBy.props = { tenantId: PROJECT_ID };

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(updateBy),
    ).rejects.toThrow("Monitor create is blocked");

    // Authorization happens before the root template lookup.
    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rechecks template read scope before broadening an enabled template-backed rule", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID, isEnabled: true });
    jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    jest
      .spyOn(TablePermission, "checkTableLevelBlockPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    const readDenied: NotAuthorizedException = new NotAuthorizedException(
      "Monitor template is outside your label scope",
    );
    const findTemplateSpy: jest.SpyInstance = jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockRejectedValue(readDenied);
    const updateBy: UpdateBy<NetworkDeviceAutoImportRule> = makeUpdateBy({
      ipMatchTarget: "0.0.0.0/0",
    });
    updateBy.props = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(updateBy),
    ).rejects.toBe(readDenied);

    expect(findTemplateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ props: updateBy.props }),
    );
  });

  it("allows criteria edits on a disabled template-backed rule until it is enabled", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID, isEnabled: false });
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );
    const allowSpy: jest.SpyInstance = jest.spyOn(
      TablePermission,
      "checkTableLevelPermissions",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ ipMatchTarget: "0.0.0.0/0" }),
      ),
    ).resolves.toBeDefined();

    expect(allowSpy).not.toHaveBeenCalled();
    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("accepts selecting a valid template by ID", async () => {
    mockExistingRule();
    mockMonitorTemplate();

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ monitorTemplateId: TEMPLATE_ID }),
      ),
    ).resolves.toBeDefined();
  });

  it("uses the update request tenant as the authoritative project", async () => {
    mockExistingRule({ projectId: OTHER_PROJECT_ID });
    mockMonitorTemplate();
    const updateBy: UpdateBy<NetworkDeviceAutoImportRule> = makeUpdateBy({
      monitorTemplateId: TEMPLATE_ID,
    });
    updateBy.props.tenantId = PROJECT_ID;

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(updateBy),
    ).resolves.toBeDefined();
  });

  it("accepts selecting a valid template by relation", async () => {
    mockExistingRule();
    const findTemplateSpy: jest.SpyInstance = mockMonitorTemplate();

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({
          monitorTemplate: { _id: TEMPLATE_ID.toString() },
        }),
      ),
    ).resolves.toBeDefined();

    expect(findTemplateSpy).toHaveBeenCalled();
  });

  it("rejects conflicting scalar and relation template IDs on update", async () => {
    mockExistingRule();
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({
          monitorTemplateId: TEMPLATE_ID,
          monitorTemplate: { _id: OTHER_PROJECT_ID },
        }),
      ),
    ).rejects.toThrow("Conflicting Monitor Template references");

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rejects an explicit relation clear that conflicts with a scalar template ID", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID });
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({
          monitorTemplateId: TEMPLATE_ID,
          monitorTemplate: null,
        }),
      ),
    ).rejects.toThrow("Conflicting Monitor Template references");

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rejects turning a template-backed rule into an exclusion rule", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID });
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ isExclusion: true }),
      ),
    ).rejects.toThrow("Exclusion rules cannot select a monitor template.");

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rejects enabling ping-only hosts on a template-backed rule", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID });
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ includePingOnlyHosts: true }),
      ),
    ).rejects.toThrow(BadDataException);

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("rejects selecting a template on an existing exclusion rule", async () => {
    mockExistingRule({ isExclusion: true });

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ monitorTemplateId: TEMPLATE_ID }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("allows clearing a template while enabling exclusion", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID });
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ monitorTemplateId: null, isExclusion: true }),
      ),
    ).resolves.toBeDefined();

    expect(findTemplateSpy).not.toHaveBeenCalled();
  });

  it("validates a stored template when a compatible flag is updated", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID });
    const findTemplateSpy: jest.SpyInstance = mockMonitorTemplate();

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ isExclusion: false }),
      ),
    ).resolves.toBeDefined();

    expect(findTemplateSpy).toHaveBeenCalled();
  });

  it("rechecks Monitor create permission when a stored template-backed rule is enabled", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID, isEnabled: false });
    mockMonitorTemplate();
    const allowSpy: jest.SpyInstance = jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    jest
      .spyOn(TablePermission, "checkTableLevelBlockPermissions")
      .mockImplementation(() => {
        return undefined;
      });
    const updateBy: UpdateBy<NetworkDeviceAutoImportRule> = makeUpdateBy({
      isEnabled: true,
    });
    updateBy.props = { tenantId: PROJECT_ID };

    await (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(updateBy);

    expect(allowSpy).toHaveBeenCalled();
  });

  it("allows a user to disable a template-backed rule without Monitor create permission", async () => {
    mockExistingRule({ monitorTemplateId: TEMPLATE_ID, isEnabled: true });
    const findTemplateSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );
    const allowSpy: jest.SpyInstance = jest.spyOn(
      TablePermission,
      "checkTableLevelPermissions",
    );

    await expect(
      (NetworkDeviceAutoImportRuleService as any).onBeforeUpdate(
        makeUpdateBy({ isEnabled: false }),
      ),
    ).resolves.toBeDefined();

    expect(allowSpy).not.toHaveBeenCalled();
    expect(findTemplateSpy).not.toHaveBeenCalled();
  });
});
