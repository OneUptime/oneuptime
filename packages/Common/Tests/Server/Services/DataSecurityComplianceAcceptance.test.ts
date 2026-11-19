import DataSecurityComplianceSettingService, {
  Service as DataSecurityComplianceSettingServiceType,
} from "../../../Server/Services/DataSecurityComplianceSettingService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DataSecurityComplianceSetting from "../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import Permission from "../../../Types/Permission";
import Dictionary from "../../../Types/Dictionary";
import ComplianceFramework from "../../../Types/DataSecurity/ComplianceFramework";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import BadDataException from "../../../Types/Exception/BadDataException";
import { KubernetesComplianceFramework } from "../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ONE KUBERNETES OBJECT'S FINDING, ACCEPTED (#9874), as the settings service
 * takes it: a DataSecurityComplianceSetting that names the object - its kind,
 * its name and its namespace - for one control or the whole framework, with
 * a reason, and optionally an expiry. It is turning a control off for one
 * object, so it is the same record, with the same permissions and audit log,
 * and revoking it is turning it on again.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SETTING_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const BASELINE: KubernetesComplianceFramework =
  KubernetesComplianceFramework.PssBaseline;

interface Hooks {
  onBeforeCreate: (
    createBy: CreateBy<DataSecurityComplianceSetting>,
  ) => Promise<OnCreate<DataSecurityComplianceSetting>>;
  onCreatePermitted: (
    onCreate: OnCreate<DataSecurityComplianceSetting>,
  ) => Promise<void>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DataSecurityComplianceSetting>,
  ) => Promise<{
    updateBy: UpdateBy<DataSecurityComplianceSetting>;
  }>;
  onUpdatePermitted: (
    updateBy: UpdateBy<DataSecurityComplianceSetting>,
  ) => Promise<void>;
}

const hooks: Hooks = DataSecurityComplianceSettingService as unknown as Hooks;

// A setting's fields as a test hands them, a left-out one as undefined.
type SettingFields = {
  [Key in keyof DataSecurityComplianceSetting]?:
    | DataSecurityComplianceSetting[Key]
    | undefined;
};

let existing: Array<DataSecurityComplianceSetting>;
let held: Array<DataSecurityComplianceSetting>;
let findBySpy: jest.SpyInstance;
let heldSpy: jest.SpyInstance;

const IN_A_MONTH: Date = OneUptimeDate.addRemoveDays(
  OneUptimeDate.getCurrentDate(),
  30,
);
const LAST_WEEK: Date = OneUptimeDate.addRemoveDays(
  OneUptimeDate.getCurrentDate(),
  -7,
);

function acceptanceOf(data: SettingFields): DataSecurityComplianceSetting {
  const setting: DataSecurityComplianceSetting =
    new DataSecurityComplianceSetting();
  setting.projectId = PROJECT_ID;
  setting.resourceType = DataStoreResourceKind.KubernetesCluster;
  setting.resourceId = CLUSTER_ID;
  setting.framework = BASELINE;
  setting.requirement = "Privileged Containers";
  setting.namespace = "kube-system";
  setting.objectKind = "DaemonSet";
  setting.objectName = "cilium";
  setting.note = "Cilium's agent programs the node's network.";
  setting.isEnabled = false;
  Object.assign(setting, data);
  return setting;
}

async function create(
  data: SettingFields,
): Promise<{ thrown: unknown; data: DataSecurityComplianceSetting }> {
  const setting: DataSecurityComplianceSetting = acceptanceOf(data);

  try {
    await hooks.onBeforeCreate({
      data: setting,
      props: { userId: USER_ID, tenantId: PROJECT_ID },
    } as unknown as CreateBy<DataSecurityComplianceSetting>);
    return { thrown: undefined, data: setting };
  } catch (error) {
    return { thrown: error, data: setting };
  }
}

function messageOf(result: { thrown: unknown }): string {
  expect(result.thrown).toBeInstanceOf(BadDataException);
  return (result.thrown as Error).message;
}

function updateOf(
  data: Record<string, unknown>,
): UpdateBy<DataSecurityComplianceSetting> {
  return {
    query: { _id: SETTING_ID.toString() },
    data,
    props: { userId: USER_ID, tenantId: PROJECT_ID },
  } as unknown as UpdateBy<DataSecurityComplianceSetting>;
}

async function update(
  data: Record<string, unknown>,
): Promise<{ thrown: unknown; data: Record<string, unknown> }> {
  const updateBy: UpdateBy<DataSecurityComplianceSetting> = updateOf(data);

  try {
    await hooks.onUpdatePermitted(updateBy);
    return {
      thrown: undefined,
      data: updateBy.data as unknown as Record<string, unknown>,
    };
  } catch (error) {
    return {
      thrown: error,
      data: updateBy.data as unknown as Record<string, unknown>,
    };
  }
}

beforeEach(() => {
  existing = [];
  held = [];
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);
  findBySpy = jest
    .spyOn(DataSecurityComplianceSettingService, "findBy")
    .mockImplementation((async () => {
      return existing;
    }) as never);
  heldSpy = jest
    .spyOn(DataSecurityComplianceSettingService, "findRowsAndHoldUpdateToThem")
    .mockImplementation((async () => {
      return held;
    }) as never);
  jest
    .spyOn(KubernetesClusterService, "findOneBy")
    .mockImplementation((async () => {
      return { _id: CLUSTER_ID.toString() };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("accepting a finding", () => {
  test("a workload's finding of one control, in its namespace, with why", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ objectKind: " DaemonSet ", objectName: " cilium " });

    expect(result.thrown).toBeUndefined();
    expect(result.data.objectKind).toBe("DaemonSet");
    expect(result.data.objectName).toBe("cilium");
    expect(result.data.namespace).toBe("kube-system");
    expect(result.data.requirement).toBe("Privileged Containers");
    expect(result.data.note).toBe(
      "Cilium's agent programs the node's network.",
    );
  });

  test("for the whole framework: no control named", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ requirement: "" });

    expect(result.thrown).toBeUndefined();
    expect(result.data.requirement).toBeNull();
  });

  test("always with a reason: one accepted without why is refused", async () => {
    for (const note of [undefined, "", "   "]) {
      expect(messageOf(await create({ note: note as string }))).toBe(
        "Say why this finding is accepted. The reason is kept with it, for whoever reviews it.",
      );
    }
    // One made revoked has nothing accepted to explain.
    expect(
      (await create({ note: undefined, isEnabled: true })).thrown,
    ).toBeUndefined();
  });

  test("a kind no finding names is refused, listing the kinds", async () => {
    expect(messageOf(await create({ objectKind: "Secret" }))).toBe(
      "Secret is not a kind of object a finding names. Choose one of Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob, DeploymentConfig, Pod, Role, ClusterRole, RoleBinding, ClusterRoleBinding, ServiceAccount, Namespace.",
    );
    // A name with no kind names nothing.
    expect(messageOf(await create({ objectKind: "" }))).toContain(
      "is not a kind of object a finding names",
    );
  });

  test("a name Kubernetes would not give an object is refused", async () => {
    for (const objectName of [
      "kube-system/cilium",
      "two words",
      "a".repeat(254),
    ]) {
      expect(messageOf(await create({ objectName }))).toBe(
        "Name the object as Kubernetes does: at most 253 characters, with no slash or space.",
      );
    }
    // A role's colon is fine.
    expect(
      (
        await create({
          framework: KubernetesComplianceFramework.CisKubernetes,
          requirement: "5.1.1",
          namespace: "",
          objectKind: "ClusterRoleBinding",
          objectName: "system:node-proxier",
        })
      ).thrown,
    ).toBeUndefined();
  });

  test("a namespaced object needs its namespace; a cluster-wide one has none", async () => {
    expect(messageOf(await create({ namespace: "" }))).toBe(
      "Choose the namespace the DaemonSet is in.",
    );
    expect(
      messageOf(
        await create({
          framework: KubernetesComplianceFramework.CisKubernetes,
          requirement: "5.1.1",
          objectKind: "ClusterRoleBinding",
          objectName: "break-glass",
        }),
      ),
    ).toBe(
      "A ClusterRoleBinding belongs to no namespace. Leave the namespace empty.",
    );

    const clusterWide: {
      thrown: unknown;
      data: DataSecurityComplianceSetting;
    } = await create({
      framework: KubernetesComplianceFramework.CisKubernetes,
      requirement: "5.1.1",
      namespace: "",
      objectKind: "ClusterRoleBinding",
      objectName: "break-glass",
    });

    expect(clusterWide.thrown).toBeUndefined();
    expect(clusterWide.data.namespace).toBeNull();
  });

  test("a namespace's finding is the namespace's own", async () => {
    const own: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({
        framework: KubernetesComplianceFramework.CisKubernetes,
        requirement: "5.3.2",
        namespace: "",
        objectKind: "Namespace",
        objectName: "sandbox",
      });

    expect(own.thrown).toBeUndefined();
    // Stored as its finding names it: in itself.
    expect(own.data.namespace).toBe("sandbox");
    expect(
      messageOf(
        await create({
          framework: KubernetesComplianceFramework.CisKubernetes,
          requirement: "5.3.2",
          namespace: "payments",
          objectKind: "Namespace",
          objectName: "sandbox",
        }),
      ),
    ).toBe(
      "A namespace's finding is the namespace's own. Name the namespace itself, or leave the namespace empty.",
    );
  });

  test("only a Kubernetes cluster's own frameworks accept one object's finding", async () => {
    expect(
      messageOf(
        await create({
          framework: ComplianceFramework.SOC2,
          requirement: "",
          namespace: "",
        }),
      ),
    ).toBe(
      "Only a Kubernetes cluster's own frameworks accept one object's finding. Leave the object empty.",
    );
  });

  test("an expiry is a date still to come, and only an accepted finding has one", async () => {
    const later: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ expiresAt: IN_A_MONTH });

    expect(later.thrown).toBeUndefined();
    expect(later.data.expiresAt).toEqual(IN_A_MONTH);
    expect(messageOf(await create({ expiresAt: LAST_WEEK }))).toBe(
      "Choose an expiry still to come, or none to keep the finding accepted until it is revoked.",
    );
    expect(
      messageOf(
        await create({
          objectKind: undefined,
          objectName: undefined,
          expiresAt: IN_A_MONTH,
        }),
      ),
    ).toBe("Only an accepted finding expires. Leave the expiry empty.");
  });

  test("an expiry written as text is read as a date, and one that is no date is refused", () => {
    expect(
      DataSecurityComplianceSettingServiceType.readExpiry(
        "2027-02-01T00:00:00.000Z",
      ),
    ).toEqual(new Date("2027-02-01T00:00:00.000Z"));
    expect(DataSecurityComplianceSettingServiceType.readExpiry("")).toBeNull();
    expect(
      DataSecurityComplianceSettingServiceType.readExpiry(null),
    ).toBeNull();
    expect(() => {
      return DataSecurityComplianceSettingServiceType.readExpiry("next spring");
    }).toThrow(
      "Write the expiry as a date and time, or leave it empty to keep the finding accepted until it is revoked.",
    );
    expect(() => {
      return DataSecurityComplianceSettingServiceType.readExpiry(1764547200000);
    }).toThrow(BadDataException);
  });

  test("one acceptance per framework, control and object", async () => {
    existing = [acceptanceOf({})];

    expect(messageOf(await create({}))).toBe(
      "This finding already has an acceptance for this. Change that one instead.",
    );
    // Another control, the whole framework, another object: each its own.
    expect(
      (await create({ requirement: "Host Namespaces" })).thrown,
    ).toBeUndefined();
    expect((await create({ requirement: "" })).thrown).toBeUndefined();
    expect((await create({ objectName: "kube-proxy" })).thrown).toBeUndefined();
    expect(findBySpy.mock.calls[0]![0]).toMatchObject({
      select: { objectKind: true, objectName: true },
    });
  });

  test("an acceptance and turning the control off for its namespace are two settings", async () => {
    existing = [
      acceptanceOf({
        objectKind: undefined,
        objectName: undefined,
        note: undefined,
      }),
    ];

    expect((await create({})).thrown).toBeUndefined();

    existing = [acceptanceOf({})];

    const turnOff: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({
        objectKind: undefined,
        objectName: undefined,
        note: undefined,
      });

    expect(turnOff.thrown).toBeUndefined();
    expect(turnOff.data.objectKind).toBeNull();
    expect(turnOff.data.objectName).toBeNull();
  });

  test("whoever accepts it is who accepted it, and when", async () => {
    const setting: DataSecurityComplianceSetting = acceptanceOf({});

    await hooks.onCreatePermitted({
      createBy: {
        data: setting,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      },
      carryForward: undefined,
    } as unknown as OnCreate<DataSecurityComplianceSetting>);

    expect(setting.turnedOffByUserId?.toString()).toBe(USER_ID.toString());
    expect(setting.turnedOffAt).toBeInstanceOf(Date);
  });
});

/*
 * A change to an accepted finding is decided on the rows the update writes,
 * read held (findRowsAndHoldUpdateToThem): never by the update's own query.
 */
describe("changing an accepted finding", () => {
  test("revoking it turns it on, names nobody, and reads nothing", async () => {
    const result: { thrown: unknown; data: Record<string, unknown> } =
      await update({ isEnabled: true });

    expect(result.thrown).toBeUndefined();
    expect(result.data).toEqual({
      isEnabled: true,
      turnedOffAt: null,
      turnedOffByUserId: null,
    });
    expect(heldSpy).not.toHaveBeenCalled();
  });

  test("accepting again one that expired says who accepted it now, and when", async () => {
    held = [acceptanceOf({ expiresAt: LAST_WEEK })];

    const result: { thrown: unknown; data: Record<string, unknown> } =
      await update({
        isEnabled: false,
        note: "Still needed until Cilium 1.17.",
        expiresAt: IN_A_MONTH,
      });

    expect(result.thrown).toBeUndefined();
    expect(result.data["turnedOffAt"]).toBeInstanceOf(Date);
    expect(result.data["turnedOffByUserId"]).toEqual(USER_ID);
    expect(heldSpy.mock.calls[0]![1]).toMatchObject({
      isEnabled: true,
      objectName: true,
      note: true,
      expiresAt: true,
    });
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("accepting again one that was revoked stamps it too", async () => {
    held = [acceptanceOf({ isEnabled: true })];

    expect(
      (await update({ isEnabled: false }))["data"]["turnedOffAt"],
    ).toBeInstanceOf(Date);
  });

  test("saving one in force as it is keeps who accepted it and when", async () => {
    held = [acceptanceOf({ expiresAt: IN_A_MONTH })];

    expect(await update({ isEnabled: false })).toEqual({
      thrown: undefined,
      data: { isEnabled: false },
    });
  });

  test("a later expiry for one in force changes when it fails again, not who accepted it", async () => {
    held = [acceptanceOf({ expiresAt: IN_A_MONTH })];

    const later: Date = OneUptimeDate.addRemoveDays(IN_A_MONTH, 60);

    expect(await update({ expiresAt: later })).toEqual({
      thrown: undefined,
      data: { expiresAt: later },
    });
    expect(heldSpy).toHaveBeenCalledTimes(1);
  });

  test("an expiry in the past, or on a setting that accepts nothing, is refused", async () => {
    held = [acceptanceOf({})];

    expect(messageOf(await update({ expiresAt: LAST_WEEK }))).toBe(
      "Choose an expiry still to come, or none to keep the finding accepted until it is revoked.",
    );

    held = [acceptanceOf({ objectKind: undefined, objectName: undefined })];

    expect(messageOf(await update({ expiresAt: IN_A_MONTH }))).toBe(
      "Only an accepted finding expires. Leave the expiry empty.",
    );
    // Clearing an expiry asks nothing of the rows.
    heldSpy.mockClear();
    expect((await update({ expiresAt: null })).thrown).toBeUndefined();
    expect(heldSpy).not.toHaveBeenCalled();
  });

  test("an accepted finding keeps its reason; one revoked at the same time may drop it", async () => {
    held = [acceptanceOf({})];

    expect(messageOf(await update({ note: null }))).toBe(
      "An accepted finding keeps its reason. Write why it is accepted, or revoke it.",
    );
    expect(
      (await update({ note: null, isEnabled: true })).thrown,
    ).toBeUndefined();

    // A setting that turns a control off may be left without a reason, as before.
    held = [acceptanceOf({ objectKind: undefined, objectName: undefined })];

    expect((await update({ note: null })).thrown).toBeUndefined();
  });

  test("accepting again one with no reason, sending none, is refused", async () => {
    held = [acceptanceOf({ isEnabled: true, note: undefined })];

    expect(messageOf(await update({ isEnabled: false }))).toBe(
      "Say why this finding is accepted. The reason is kept with it, for whoever reviews it.",
    );
    expect(
      (await update({ isEnabled: false, note: "Vendor fix due in March." }))
        .thrown,
    ).toBeUndefined();
  });

  test("an expiry sent as text is stored as a date", async () => {
    const updateBy: UpdateBy<DataSecurityComplianceSetting> = updateOf({
      expiresAt: "2027-03-01T00:00:00.000Z",
    });

    await hooks.onBeforeUpdate(updateBy);

    expect((updateBy.data as { expiresAt?: unknown }).expiresAt).toEqual(
      new Date("2027-03-01T00:00:00.000Z"),
    );
  });
});

/*
 * Accepting a finding needs exactly what turning a control off needs: it is
 * the same record, so the same table permissions, and its columns are read
 * and written as the framework's and the switch's are. Every change is in
 * the audit log, named by what it accepts.
 */
describe("who may accept a finding, and the audit log", () => {
  const columns: Dictionary<ColumnAccessControl> =
    getColumnAccessControlForAllColumns(new DataSecurityComplianceSetting());

  test("the object it names is set when it is made, by those who may turn a control off", () => {
    expect(columns["objectKind"]).toEqual(columns["framework"]);
    expect(columns["objectName"]).toEqual(columns["framework"]);
    expect(columns["objectKind"]?.update).toEqual([]);
  });

  test("its expiry is changed by those who may flip the switch", () => {
    expect(columns["expiresAt"]).toEqual(columns["isEnabled"]);
    expect(columns["expiresAt"]?.update?.length).toBeGreaterThan(0);
  });

  test("the table's permissions are the ones turning a control off has always needed", () => {
    const model: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();

    expect(model.getCreatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataSecurityCheckSetting,
    ]);
    expect(model.updateRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.EditDataSecurityCheckSetting,
    ]);
    // A Security Viewer reads acceptances, and accepts none.
    expect(model.readRecordPermissions).toContain(Permission.SecurityViewer);
    expect(model.getCreatePermissions()).not.toContain(
      Permission.SecurityViewer,
    );
  });

  test("every acceptance, change and revocation is audited, named by the object", () => {
    expect(new DataSecurityComplianceSetting().enableAuditLogOn).toMatchObject({
      create: true,
      update: true,
      delete: true,
      resourceNameColumns: [
        "framework",
        "requirement",
        "namespace",
        "objectKind",
        "objectName",
      ],
    });
  });
});
