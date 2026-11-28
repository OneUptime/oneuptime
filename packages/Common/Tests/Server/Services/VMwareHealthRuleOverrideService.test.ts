import VMwareHealthRuleOverride from "../../../Models/DatabaseModels/VMwareHealthRuleOverride";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import VMwareHealthRuleOverrideService, {
  Service as VMwareHealthRuleOverrideServiceClass,
  VMWARE_HEALTH_RULE_OVERRIDE_PART_ERROR,
  VMWARE_HEALTH_RULE_OVERRIDE_SCOPE_ERROR,
  VMWARE_HEALTH_RULE_OVERRIDE_TAKEN_ERROR,
  VMWARE_HEALTH_RULE_OVERRIDE_VCENTER_ERROR,
} from "../../../Server/Services/VMwareHealthRuleOverrideService";
import VMwareResourceService from "../../../Server/Services/VMwareResourceService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { VMwareHealthRuleScope } from "../../../Types/VMware/VMwareHealthRuleOverrides";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What an override of the VMware health rules may be (#11469), as the
 * service keeps it: about a vCenter the caller may read, a part of it the
 * caller may read, where the part sits copied from its row (never taken
 * from the caller - an override's reach is worked out from it), one per
 * part, and rules its scope judges at values they can take. The reads it
 * makes are spied on: what they were asked, as whom, and what they found.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const VCENTER_ID: ObjectID = ObjectID.generate();
const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

type Hook = (createBy: CreateBy<VMwareHealthRuleOverride>) => Promise<unknown>;
type UpdateHook = (
  updateBy: UpdateBy<VMwareHealthRuleOverride>,
) => Promise<unknown>;

const service: VMwareHealthRuleOverrideServiceClass =
  new VMwareHealthRuleOverrideServiceClass();

function onBeforeCreate(
  data: Partial<Record<string, unknown>>,
  props: DatabaseCommonInteractionProps = CALLER,
): Promise<unknown> {
  const model: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
  Object.assign(model, data);
  return (service as unknown as { onBeforeCreate: Hook }).onBeforeCreate({
    data: model,
    props,
  } as CreateBy<VMwareHealthRuleOverride>);
}

function createdWith(data: Partial<Record<string, unknown>>): {
  model: VMwareHealthRuleOverride;
  run: Promise<unknown>;
} {
  const model: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
  Object.assign(model, data);
  return {
    model,
    run: (service as unknown as { onBeforeCreate: Hook }).onBeforeCreate({
      data: model,
      props: CALLER,
    } as CreateBy<VMwareHealthRuleOverride>),
  };
}

function vcenter(): VMwareVCenter {
  const row: VMwareVCenter = new VMwareVCenter();
  row._id = VCENTER_ID.toString();
  return row;
}

function part(data: Partial<VMwareResource>): VMwareResource {
  const row: VMwareResource = new VMwareResource();
  Object.assign(row, data);
  return row;
}

let vcenterRead: jest.SpiedFunction<typeof VMwareVCenterService.findOneBy>;
let partRead: jest.SpiedFunction<typeof VMwareResourceService.findOneBy>;
let takenRead: jest.SpiedFunction<typeof service.findOneBy>;

beforeEach(() => {
  vcenterRead = jest
    .spyOn(VMwareVCenterService, "findOneBy")
    .mockResolvedValue(vcenter());
  partRead = jest.spyOn(VMwareResourceService, "findOneBy").mockResolvedValue(
    part({
      externalId: "host/DC-NORTH/esx-07.acme.lan",
      name: "esx-07.acme.lan",
      datacenterName: "DC-NORTH",
      clusterName: "cluster-a",
      hostName: null as unknown as string,
    }),
  );
  takenRead = jest.spyOn(service, "findOneBy").mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as BadDataException).message;
  }
  throw new Error("Expected the override to be refused.");
}

describe("making an override", () => {
  test("a host's: the host found in the vCenter as the caller may read it, and where it sits copied from its row", async () => {
    const { model, run } = createdWith({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      scope: VMwareHealthRuleScope.Host,
      resourceExternalId: "  host/DC-NORTH/esx-07.acme.lan ",
      // What a caller says of where it sits is never kept.
      resourceName: "somewhere else",
      datacenterName: "DC-ELSEWHERE",
      clusterName: "cluster-z",
      hostName: "esx-99",
      rules: { hostCpuWarningPercent: 95, hostEvaluationMinutes: 10 },
    });
    await run;

    expect(vcenterRead).toHaveBeenCalledWith({
      query: { _id: VCENTER_ID, projectId: PROJECT_ID },
      select: { _id: true },
      props: CALLER,
    });
    expect(partRead).toHaveBeenCalledWith({
      query: {
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        kind: VMwareResourceKind.Host,
        externalId: "host/DC-NORTH/esx-07.acme.lan",
      },
      select: {
        externalId: true,
        name: true,
        datacenterName: true,
        clusterName: true,
        hostName: true,
      },
      props: CALLER,
    });
    expect({
      resourceExternalId: model.resourceExternalId,
      resourceName: model.resourceName,
      datacenterName: model.datacenterName,
      clusterName: model.clusterName,
      // A host's own name is what its VMs name it by.
      hostName: model.hostName,
      rules: model.rules,
    }).toEqual({
      resourceExternalId: "host/DC-NORTH/esx-07.acme.lan",
      resourceName: "esx-07.acme.lan",
      datacenterName: "DC-NORTH",
      clusterName: "cluster-a",
      hostName: "esx-07.acme.lan",
      rules: { hostCpuWarningPercent: 95, hostEvaluationMinutes: 10 },
    });
  });

  test("a cluster's: its own name is what its hosts and VMs name it by", async () => {
    partRead.mockResolvedValue(
      part({
        externalId: "cluster/DC-NORTH/cluster-a",
        name: "cluster-a",
        datacenterName: "DC-NORTH",
        clusterName: null as unknown as string,
        hostName: null as unknown as string,
      }),
    );
    const { model, run } = createdWith({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      scope: VMwareHealthRuleScope.Cluster,
      resourceExternalId: "cluster/DC-NORTH/cluster-a",
      rules: { hostMemoryWarningPercent: 97 },
    });
    await run;
    expect(partRead.mock.calls[0]![0].query).toEqual(
      expect.objectContaining({ kind: VMwareResourceKind.Cluster }),
    );
    expect({
      clusterName: model.clusterName,
      hostName: model.hostName,
    }).toEqual({ clusterName: "cluster-a", hostName: null });
  });

  test("a VM's: where it runs, as its row says", async () => {
    partRead.mockResolvedValue(
      part({
        externalId: "vm/4a1c",
        name: "web-01",
        datacenterName: "DC-NORTH",
        clusterName: "cluster-a",
        hostName: "esx-07.acme.lan",
      }),
    );
    const { model, run } = createdWith({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      scope: VMwareHealthRuleScope.VirtualMachine,
      resourceExternalId: "vm/4a1c",
      rules: { vmCpuReadyWarningPercent: null },
    });
    await run;
    expect(partRead.mock.calls[0]![0].query).toEqual(
      expect.objectContaining({ kind: VMwareResourceKind.VirtualMachine }),
    );
    expect({
      resourceName: model.resourceName,
      clusterName: model.clusterName,
      hostName: model.hostName,
      rules: model.rules,
    }).toEqual({
      resourceName: "web-01",
      clusterName: "cluster-a",
      hostName: "esx-07.acme.lan",
      rules: { vmCpuReadyWarningPercent: null },
    });
  });

  test("a vCenter's: no part to find, and nothing of one kept", async () => {
    const { model, run } = createdWith({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      scope: VMwareHealthRuleScope.VCenter,
      resourceExternalId: "host/whatever",
      resourceName: "x",
      datacenterName: "y",
      clusterName: "z",
      hostName: "w",
      rules: { datastoreWarningPercent: 70 },
    });
    await run;
    expect(partRead).not.toHaveBeenCalled();
    expect({
      resourceExternalId: model.resourceExternalId,
      resourceName: model.resourceName,
      datacenterName: model.datacenterName,
      clusterName: model.clusterName,
      hostName: model.hostName,
    }).toEqual({
      resourceExternalId: null,
      resourceName: null,
      datacenterName: null,
      clusterName: null,
      hostName: null,
    });
    // Its uniqueness is asked of the empty part.
    const asked: Record<string, unknown> = takenRead.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(asked["scope"]).toBe(VMwareHealthRuleScope.VCenter);
    expect(asked["resourceExternalId"]).not.toBe(null);
    expect(asked["resourceExternalId"]).toBeDefined();
  });

  test("the rules kept are only those its scope judges", async () => {
    const { model, run } = createdWith({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      scope: VMwareHealthRuleScope.Host,
      resourceExternalId: "host/DC-NORTH/esx-07.acme.lan",
      rules: { hostCpuWarningPercent: 95, vmSwapInWarningKibPerSecond: undefined },
    });
    await run;
    expect(model.rules).toEqual({ hostCpuWarningPercent: 95 });
  });

  test("the project is the caller's when the override does not say", async () => {
    await onBeforeCreate({
      vmwareVCenterId: VCENTER_ID,
      scope: VMwareHealthRuleScope.VCenter,
      rules: {},
    });
    expect(vcenterRead.mock.calls[0]![0].query).toEqual({
      _id: VCENTER_ID,
      projectId: PROJECT_ID,
    });
  });
});

describe("what is refused, in words the person can act on", () => {
  test("a scope this build does not know", async () => {
    for (const scope of [undefined, "Datacenter", ""]) {
      expect(
        await refusal(
          onBeforeCreate({
            projectId: PROJECT_ID,
            vmwareVCenterId: VCENTER_ID,
            scope,
          }),
        ),
      ).toBe(VMWARE_HEALTH_RULE_OVERRIDE_SCOPE_ERROR);
    }
  });

  test("no vCenter, or one the caller may not read or that is not the project's", async () => {
    expect(
      await refusal(
        onBeforeCreate({
          projectId: PROJECT_ID,
          scope: VMwareHealthRuleScope.VCenter,
        }),
      ),
    ).toBe(VMWARE_HEALTH_RULE_OVERRIDE_VCENTER_ERROR);

    vcenterRead.mockResolvedValue(null);
    expect(
      await refusal(
        onBeforeCreate({
          projectId: PROJECT_ID,
          vmwareVCenterId: VCENTER_ID,
          scope: VMwareHealthRuleScope.VCenter,
        }),
      ),
    ).toBe(VMWARE_HEALTH_RULE_OVERRIDE_VCENTER_ERROR);
  });

  test("a part the vCenter does not report, or the caller may not read", async () => {
    partRead.mockResolvedValue(null);
    expect(
      await refusal(
        onBeforeCreate({
          projectId: PROJECT_ID,
          vmwareVCenterId: VCENTER_ID,
          scope: VMwareHealthRuleScope.Host,
          resourceExternalId: "host/DC-NORTH/not-there",
        }),
      ),
    ).toBe(VMWARE_HEALTH_RULE_OVERRIDE_PART_ERROR);
  });

  test("a part's scope with no part named", async () => {
    for (const resourceExternalId of [undefined, "", "   "]) {
      expect(
        await refusal(
          onBeforeCreate({
            projectId: PROJECT_ID,
            vmwareVCenterId: VCENTER_ID,
            scope: VMwareHealthRuleScope.VirtualMachine,
            resourceExternalId,
          }),
        ),
      ).toBe(VMWARE_HEALTH_RULE_OVERRIDE_PART_ERROR);
    }
    expect(partRead).not.toHaveBeenCalled();
  });

  test("a second override of the same part", async () => {
    takenRead.mockResolvedValue(new VMwareHealthRuleOverride());
    expect(
      await refusal(
        onBeforeCreate({
          projectId: PROJECT_ID,
          vmwareVCenterId: VCENTER_ID,
          scope: VMwareHealthRuleScope.Host,
          resourceExternalId: "host/DC-NORTH/esx-07.acme.lan",
        }),
      ),
    ).toBe(VMWARE_HEALTH_RULE_OVERRIDE_TAKEN_ERROR);
    // Asked of every override, the caller's or not: one per part, whoever made it.
    expect(takenRead.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: {
          projectId: PROJECT_ID,
          vmwareVCenterId: VCENTER_ID,
          scope: VMwareHealthRuleScope.Host,
          resourceExternalId: "host/DC-NORTH/esx-07.acme.lan",
        },
        props: { isRoot: true },
      }),
    );
  });

  test("a rule its scope does not judge, and a value no rule can be", async () => {
    partRead.mockResolvedValue(part({ externalId: "vm/1", name: "web-01" }));
    expect(
      await refusal(
        onBeforeCreate({
          projectId: PROJECT_ID,
          vmwareVCenterId: VCENTER_ID,
          scope: VMwareHealthRuleScope.VirtualMachine,
          resourceExternalId: "vm/1",
          rules: { datastoreWarningPercent: 50 },
        }),
      ),
    ).toBe(
      "That rule judges nothing an override of this kind covers. Set it on a vCenter, a cluster or a host that holds what it judges.",
    );
    expect(
      await refusal(
        onBeforeCreate({
          projectId: PROJECT_ID,
          vmwareVCenterId: VCENTER_ID,
          scope: VMwareHealthRuleScope.VirtualMachine,
          resourceExternalId: "vm/1",
          rules: { vmSwapEvaluationMinutes: 60 },
        }),
      ),
    ).toBe("A wait is a whole number of minutes from 0 to 30.");
  });

  test("the words", () => {
    expect(VMWARE_HEALTH_RULE_OVERRIDE_SCOPE_ERROR).toBe(
      "Choose what the rules apply to: a whole vCenter, a cluster, an ESXi host or a VM.",
    );
    expect(VMWARE_HEALTH_RULE_OVERRIDE_VCENTER_ERROR).toBe(
      "That vCenter is not in this project, or you may not read it. Choose one of the project's vCenters.",
    );
    expect(VMWARE_HEALTH_RULE_OVERRIDE_PART_ERROR).toBe(
      "That part is not in the vCenter, or you may not read it. Choose one the vCenter reports.",
    );
    expect(VMWARE_HEALTH_RULE_OVERRIDE_TAKEN_ERROR).toBe(
      "That already has rules of its own. Edit them instead of adding another.",
    );
  });
});

describe("changing an override's rules", () => {
  function onBeforeUpdate(data: Record<string, unknown>): Promise<unknown> {
    return (service as unknown as { onBeforeUpdate: UpdateHook }).onBeforeUpdate(
      {
        query: { _id: ObjectID.generate().toString() },
        data,
        props: CALLER,
      } as unknown as UpdateBy<VMwareHealthRuleOverride>,
    );
  }

  function held(scope: VMwareHealthRuleScope): void {
    const row: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
    row.scope = scope;
    jest
      .spyOn(
        service as unknown as {
          findRowsAndHoldUpdateToThem: () => Promise<
            Array<VMwareHealthRuleOverride>
          >;
        },
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([row]);
  }

  test("checked against the scope of the rows it writes, and kept clean", async () => {
    held(VMwareHealthRuleScope.Cluster);
    const data: Record<string, unknown> = {
      rules: { hostCpuWarningPercent: 99, vmBalloonedWarningMebibytes: undefined },
    };
    await onBeforeUpdate(data);
    expect(data["rules"]).toEqual({ hostCpuWarningPercent: 99 });
  });

  test("a rule the row's scope does not judge is refused", async () => {
    held(VMwareHealthRuleScope.VirtualMachine);
    expect(
      await refusal(onBeforeUpdate({ rules: { hostCpuWarningPercent: 99 } })),
    ).toMatch(/^That rule judges nothing/);
  });

  test("an update that does not touch the rules reads nothing", async () => {
    const spy: jest.SpiedFunction<() => Promise<unknown>> = jest.spyOn(
      service as unknown as {
        findRowsAndHoldUpdateToThem: () => Promise<unknown>;
      },
      "findRowsAndHoldUpdateToThem",
    );
    await onBeforeUpdate({ resourceName: "x" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("what a person's create may hold, as the permission checks see it", () => {
  // A member of the project: may change its health rules.
  function memberProps(): DatabaseCommonInteractionProps {
    const permission: UserTenantAccessPermission = {
      projectId: PROJECT_ID,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    };
    return {
      userId: ObjectID.generate(),
      tenantId: PROJECT_ID,
      userTenantAccessPermission: { [PROJECT_ID.toString()]: permission },
    };
  }

  const WHERE_IT_SITS: Array<string> = [
    "resourceName",
    "datacenterName",
    "clusterName",
    "hostName",
  ];

  function written(): VMwareHealthRuleOverride {
    const record: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
    record.projectId = PROJECT_ID;
    record.vmwareVCenterId = VCENTER_ID;
    record.scope = VMwareHealthRuleScope.Host;
    record.resourceExternalId = "host/DC-NORTH/esx-07.acme.lan";
    record.rules = { hostCpuWarningPercent: 95 };
    record.resourceName = "esx-07.acme.lan";
    record.datacenterName = "DC-NORTH";
    record.clusterName = "cluster-a";
    record.hostName = "esx-07.acme.lan";
    return record;
  }

  test("where the part sits is OneUptime's to write: computed, never in a request", () => {
    const model: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
    for (const column of WHERE_IT_SITS) {
      expect({
        column,
        computed: model.getTableColumnMetadata(column).computed,
        create: model.getColumnAccessControlFor(column)?.create,
        update: model.getColumnAccessControlFor(column)?.update,
      }).toEqual({ column, computed: true, create: [], update: [] });
    }
  });

  test("what the person sends of where it sits is dropped before the hooks, not refused", () => {
    const record: VMwareHealthRuleOverride = written();
    expect(
      ColumnPermissions.checkComputedColumnsSentOnCreate(
        VMwareHealthRuleOverride,
        record,
        memberProps(),
      ),
    ).toEqual([]);
    for (const column of WHERE_IT_SITS) {
      expect(
        (record as unknown as Record<string, unknown>)[column],
      ).toBeUndefined();
    }
    // What they may send is kept.
    expect(record.rules).toEqual({ hostCpuWarningPercent: 95 });
    expect(record.scope).toBe(VMwareHealthRuleScope.Host);
  });

  test("what the service wrote of where it sits passes the check after the hooks", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        VMwareHealthRuleOverride,
        written(),
        memberProps(),
        DatabaseRequestType.Create,
        WHERE_IT_SITS,
      );
    }).not.toThrow();
  });

  test("a whole vCenter's override, its part's columns written empty, passes too", () => {
    const record: VMwareHealthRuleOverride = written();
    record.scope = VMwareHealthRuleScope.VCenter;
    for (const column of [...WHERE_IT_SITS, "resourceExternalId"]) {
      (record as unknown as Record<string, unknown>)[column] = null;
    }
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        VMwareHealthRuleOverride,
        record,
        memberProps(),
        DatabaseRequestType.Create,
        WHERE_IT_SITS,
      );
    }).not.toThrow();
  });

  test("an update may change the rules, and nothing the override is about", () => {
    const rules: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
    rules.rules = { hostCpuWarningPercent: 80 };
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        VMwareHealthRuleOverride,
        rules,
        memberProps(),
        DatabaseRequestType.Update,
      );
    }).not.toThrow();

    for (const column of [
      "hostName",
      "scope",
      "resourceExternalId",
      "vmwareVCenterId",
    ]) {
      const record: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
      (record as unknown as Record<string, unknown>)[column] =
        column === "vmwareVCenterId" ? ObjectID.generate() : "x";
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          VMwareHealthRuleOverride,
          record,
          memberProps(),
          DatabaseRequestType.Update,
        );
      }).toThrow();
    }
  });
});

describe("the model", () => {
  test("who may read and change overrides: whoever may read or change a vCenter", () => {
    const model: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
    expect(model.readRecordPermissions).toContain(Permission.ReadVMwareVCenter);
    expect(model.readRecordPermissions).toContain(Permission.Viewer);
    expect(model.createRecordPermissions).toContain(
      Permission.EditVMwareVCenter,
    );
    expect(model.updateRecordPermissions).toContain(
      Permission.EditVMwareVCenter,
    );
    expect(model.deleteRecordPermissions).toContain(
      Permission.EditVMwareVCenter,
    );
    expect(model.updateRecordPermissions).not.toContain(Permission.Viewer);
  });

  test("is served at /vmware-health-rule-override, and named for its table", () => {
    const model: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/vmware-health-rule-override",
    );
    expect(model.tableName).toBe("VMwareHealthRuleOverride");
  });

  test("is the service the API uses", () => {
    expect(VMwareHealthRuleOverrideService).toBeInstanceOf(
      VMwareHealthRuleOverrideServiceClass,
    );
  });
});
