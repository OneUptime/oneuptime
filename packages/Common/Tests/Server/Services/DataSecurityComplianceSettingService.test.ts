import DataSecurityComplianceSettingService, {
  Service as DataSecurityComplianceSettingServiceType,
} from "../../../Server/Services/DataSecurityComplianceSettingService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ServiceService from "../../../Server/Services/ServiceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DataSecurityComplianceSetting from "../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ComplianceFramework from "../../../Types/DataSecurity/ComplianceFramework";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import { KubernetesComplianceFramework } from "../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What a resource turned off of a compliance framework (#9555): a setting
 * names one of the project's resources, a framework Data Security scores
 * and, for one requirement, a requirement that framework has. There is one
 * per resource, framework and requirement: a second is refused, so turning
 * it on again changes the first.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface Hooks {
  onBeforeCreate: (
    createBy: CreateBy<DataSecurityComplianceSetting>,
  ) => Promise<OnCreate<DataSecurityComplianceSetting>>;
}

const hooks: Hooks = DataSecurityComplianceSettingService as unknown as Hooks;

let existing: Array<DataSecurityComplianceSetting>;
let findBySpy: jest.SpyInstance;
let resourceSpies: Record<string, jest.SpyInstance>;
let resourceFound: boolean;

function settingOf(
  data: Partial<DataSecurityComplianceSetting>,
): DataSecurityComplianceSetting {
  const setting: DataSecurityComplianceSetting =
    new DataSecurityComplianceSetting();
  setting.projectId = PROJECT_ID;
  setting.resourceType = DataStoreResourceKind.KubernetesCluster;
  setting.resourceId = CLUSTER_ID;
  setting.framework = ComplianceFramework.SOC2;
  setting.isEnabled = false;
  Object.assign(setting, data);
  return setting;
}

async function create(
  data: Partial<DataSecurityComplianceSetting>,
): Promise<{ thrown: unknown; data: DataSecurityComplianceSetting }> {
  const setting: DataSecurityComplianceSetting = settingOf(data);

  try {
    await hooks.onBeforeCreate({
      data: setting,
      props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
    } as unknown as CreateBy<DataSecurityComplianceSetting>);
    return { thrown: undefined, data: setting };
  } catch (error) {
    return { thrown: error, data: setting };
  }
}

beforeEach(() => {
  existing = [];
  resourceFound = true;
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  findBySpy = jest
    .spyOn(DataSecurityComplianceSettingService, "findBy")
    .mockImplementation((async () => {
      return existing;
    }) as never);

  const found: () => Promise<{ _id: string } | null> = async (): Promise<{
    _id: string;
  } | null> => {
    return resourceFound ? { _id: CLUSTER_ID.toString() } : null;
  };

  resourceSpies = {
    [DataStoreResourceKind.KubernetesCluster]: jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockImplementation(found as never),
    [DataStoreResourceKind.DockerHost]: jest
      .spyOn(DockerHostService, "findOneBy")
      .mockImplementation(found as never),
    [DataStoreResourceKind.PodmanHost]: jest
      .spyOn(PodmanHostService, "findOneBy")
      .mockImplementation(found as never),
    [DataStoreResourceKind.DatabaseServer]: jest
      .spyOn(DatabaseServerService, "findOneBy")
      .mockImplementation(found as never),
    [DataStoreResourceKind.CloudResource]: jest
      .spyOn(CloudResourceService, "findOneBy")
      .mockImplementation(found as never),
    [DataStoreResourceKind.Service]: jest
      .spyOn(ServiceService, "findOneBy")
      .mockImplementation(found as never),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("turning a framework off for a resource", () => {
  test("a framework of a resource of the project is accepted, about the whole framework", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ framework: ComplianceFramework.HIPAA });

    expect(result.thrown).toBeUndefined();
    expect(result.data.requirement).toBeNull();
    // The resource is looked for in the project, as OneUptime.
    expect(
      resourceSpies[DataStoreResourceKind.KubernetesCluster]!.mock.calls[0]![0],
    ).toMatchObject({
      query: { _id: CLUSTER_ID.toString(), projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("a requirement of the framework is accepted, trimmed", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ requirement: " CC6.1 " });

    expect(result.thrown).toBeUndefined();
    expect(result.data.requirement).toBe("CC6.1");
  });

  test("a requirement the framework does not have is refused, saying what to choose", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ requirement: "Art. 32" });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Error).message).toBe(
      "Art. 32 is not a requirement of SOC 2. Choose one of its requirements, or none for the whole framework.",
    );
  });

  test("a framework Data Security does not score is refused", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ framework: "FedRAMP" as ComplianceFramework });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("a kind of resource that holds no stores is refused", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ resourceType: "Host" as DataStoreResourceKind });

    expect(result.thrown).toBeInstanceOf(BadDataException);
  });

  test("a resource of another project, or none, is refused", async () => {
    resourceFound = false;

    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({});

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Error).message).toBe(
      "This resource is not in this project. Choose one of the project's resources.",
    );
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test.each([
    DataStoreResourceKind.KubernetesCluster,
    DataStoreResourceKind.DockerHost,
    DataStoreResourceKind.PodmanHost,
    DataStoreResourceKind.DatabaseServer,
    DataStoreResourceKind.CloudResource,
    DataStoreResourceKind.Service,
  ])(
    "a %s is looked for among its own kind",
    async (kind: DataStoreResourceKind) => {
      await create({ resourceType: kind });

      expect(resourceSpies[kind]).toHaveBeenCalledTimes(1);

      for (const [other, spy] of Object.entries(resourceSpies)) {
        if (other !== kind) {
          expect(spy).not.toHaveBeenCalled();
        }
      }
    },
  );

  test("a second setting for the same framework and requirement is refused", async () => {
    existing = [settingOf({ requirement: "CC6.1" })];

    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ requirement: "CC6.1" });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Error).message).toBe(
      "This resource already has a setting for this. Change that setting instead.",
    );
    expect(findBySpy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        resourceType: DataStoreResourceKind.KubernetesCluster,
        resourceId: CLUSTER_ID,
        framework: ComplianceFramework.SOC2,
      },
    });
  });

  test("the framework and one of its requirements are two settings", async () => {
    existing = [settingOf({ requirement: "CC6.1" })];

    expect((await create({})).thrown).toBeUndefined();

    existing = [settingOf({})];

    expect((await create({ requirement: "CC6.1" })).thrown).toBeUndefined();
  });

  test("a requirement is read trimmed, or as the whole framework", () => {
    expect(
      DataSecurityComplianceSettingServiceType.readRequirement(" A1.2 "),
    ).toBe("A1.2");
    expect(DataSecurityComplianceSettingServiceType.readRequirement(null)).toBe(
      "",
    );
    expect(DataSecurityComplianceSettingServiceType.readRequirement(7)).toBe(
      "",
    );
  });

  test("a data framework is never turned off for one namespace", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ namespace: "payments" });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Error).message).toBe(
      "Only a Kubernetes cluster's own frameworks can be turned off for one namespace. Leave the namespace empty.",
    );
  });
});

/*
 * A Kubernetes cluster's own frameworks (#9627): the Pod Security
 * Standards and the CIS Kubernetes Benchmark, on a cluster only, for a
 * control each is scored on, and for the whole cluster or one namespace -
 * one setting per framework, control and namespace.
 */
describe("turning a Kubernetes framework off for a cluster or a namespace", () => {
  test("a framework is accepted for the whole cluster, with no requirement or namespace", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({
        framework: KubernetesComplianceFramework.PssRestricted,
      });

    expect(result.thrown).toBeUndefined();
    expect(result.data.requirement).toBeNull();
    expect(result.data.namespace).toBeNull();
  });

  test("a control it is scored on is accepted, and so is a namespace, trimmed", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({
        framework: KubernetesComplianceFramework.PssBaseline,
        requirement: " Privileged Containers ",
        namespace: " kube-system ",
      });

    expect(result.thrown).toBeUndefined();
    expect(result.data.requirement).toBe("Privileged Containers");
    expect(result.data.namespace).toBe("kube-system");
    expect(
      (
        await create({
          framework: KubernetesComplianceFramework.CisKubernetes,
          requirement: "5.1.3",
        })
      ).thrown,
    ).toBeUndefined();
  });

  test("a control the framework is not scored on is refused, saying what to choose", async () => {
    const baseline: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({
        framework: KubernetesComplianceFramework.PssBaseline,
        requirement: "Volume Types",
      });

    expect(baseline.thrown).toBeInstanceOf(BadDataException);
    expect((baseline.thrown as Error).message).toBe(
      "Volume Types is not a control PSS Baseline is scored on. Choose one of its controls, or none for the whole framework.",
    );
    // Not scored here: nothing to turn off.
    expect(
      (
        await create({
          framework: KubernetesComplianceFramework.CisKubernetes,
          requirement: "5.1.7",
        })
      ).thrown,
    ).toBeInstanceOf(BadDataException);
  });

  test("a namespace's name Kubernetes would not allow is refused", async () => {
    for (const namespace of ["Kube_System", "-web", "a".repeat(64)]) {
      const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
        await create({
          framework: KubernetesComplianceFramework.PssBaseline,
          namespace,
        });

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect((result.thrown as Error).message).toBe(
        `${namespace} is not a namespace's name. Write it as Kubernetes does: lowercase letters, digits and hyphens, at most 63 characters.`,
      );
    }
  });

  test("on anything but a Kubernetes cluster it is refused", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({
        resourceType: DataStoreResourceKind.DatabaseServer,
        framework: KubernetesComplianceFramework.CisKubernetes,
      });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Error).message).toBe(
      "CIS Kubernetes scores a Kubernetes cluster. Choose a Kubernetes cluster for this setting.",
    );
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("one setting per framework, control and namespace: a second is refused, another namespace is not", async () => {
    existing = [
      settingOf({
        framework: KubernetesComplianceFramework.PssBaseline,
        namespace: "kube-system",
      }),
    ];

    expect(
      (
        await create({
          framework: KubernetesComplianceFramework.PssBaseline,
          namespace: "kube-system",
        })
      ).thrown,
    ).toBeInstanceOf(BadDataException);
    expect(
      (
        await create({
          framework: KubernetesComplianceFramework.PssBaseline,
          namespace: "monitoring",
        })
      ).thrown,
    ).toBeUndefined();
    // The whole cluster is a setting of its own beside a namespace's.
    expect(
      (
        await create({
          framework: KubernetesComplianceFramework.PssBaseline,
        })
      ).thrown,
    ).toBeUndefined();
  });

  test("a namespace is read trimmed, or as the whole resource", () => {
    expect(
      DataSecurityComplianceSettingServiceType.readNamespace(" payments "),
    ).toBe("payments");
    expect(DataSecurityComplianceSettingServiceType.readNamespace(null)).toBe(
      "",
    );
  });
});

/*
 * Who turned it off, and when (#9629). The row is made the first time it
 * is turned off and only changed after that, so OneUptime writes both
 * whenever it goes from on to off - never when it is saved off again - and
 * clears them when it is turned on again. Both are written once the write
 * passed every permission check: no caller may write either.
 */
interface PermittedHooks {
  onCreatePermitted: (
    onCreate: OnCreate<DataSecurityComplianceSetting>,
  ) => Promise<void>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DataSecurityComplianceSetting>,
  ) => Promise<OnUpdate<DataSecurityComplianceSetting>>;
  onUpdatePermitted: (
    updateBy: UpdateBy<DataSecurityComplianceSetting>,
  ) => Promise<void>;
}

const permitted: PermittedHooks =
  DataSecurityComplianceSettingService as unknown as PermittedHooks;

const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SETTING_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

async function createPermitted(
  data: Partial<DataSecurityComplianceSetting>,
  userId: ObjectID | null = USER_ID,
): Promise<DataSecurityComplianceSetting> {
  const setting: DataSecurityComplianceSetting = settingOf(data);

  await permitted.onCreatePermitted({
    createBy: {
      data: setting,
      props: { ...(userId ? { userId } : {}), tenantId: PROJECT_ID },
    },
    carryForward: undefined,
  } as unknown as OnCreate<DataSecurityComplianceSetting>);

  return setting;
}

function updateOf(
  data: Record<string, unknown>,
  userId: ObjectID | null = USER_ID,
): UpdateBy<DataSecurityComplianceSetting> {
  return {
    query: { _id: SETTING_ID.toString() },
    data,
    props: { ...(userId ? { userId } : {}), tenantId: PROJECT_ID },
  } as unknown as UpdateBy<DataSecurityComplianceSetting>;
}

describe("who turned it off, and when", () => {
  test("a setting made off was turned off by whoever made it, now", async () => {
    const before: number = Date.now();
    const setting: DataSecurityComplianceSetting = await createPermitted({
      isEnabled: false,
    });

    expect(setting.turnedOffByUserId?.toString()).toBe(USER_ID.toString());
    expect(setting.turnedOffAt).toBeInstanceOf(Date);
    expect(new Date(setting.turnedOffAt!).getTime()).toBeGreaterThanOrEqual(
      before,
    );
  });

  test("a setting made with no switch is off, as its column's default is", async () => {
    // A request that leaves the switch out: settingOf's false is cleared.
    const setting: DataSecurityComplianceSetting = await createPermitted({
      isEnabled: undefined,
    } as unknown as Partial<DataSecurityComplianceSetting>);

    expect(setting.turnedOffAt).toBeInstanceOf(Date);
  });

  test("one an API key made off says when, and names nobody", async () => {
    const setting: DataSecurityComplianceSetting = await createPermitted(
      { isEnabled: false },
      null,
    );

    expect(setting.turnedOffAt).toBeInstanceOf(Date);
    expect(setting.turnedOffByUserId).toBeUndefined();
  });

  test("a setting made on was turned off by nobody", async () => {
    const setting: DataSecurityComplianceSetting = await createPermitted({
      isEnabled: true,
    });

    expect(setting.turnedOffAt).toBeUndefined();
    expect(setting.turnedOffByUserId).toBeUndefined();
  });

  test("turning one off says who and when", async () => {
    existing = [settingOf({ isEnabled: true })];

    const updateBy: UpdateBy<DataSecurityComplianceSetting> = updateOf({
      isEnabled: false,
    });

    await permitted.onUpdatePermitted(updateBy);

    expect(
      (updateBy.data as { turnedOffByUserId?: ObjectID }).turnedOffByUserId,
    ).toEqual(USER_ID);
    expect(
      (updateBy.data as { turnedOffAt?: Date }).turnedOffAt,
    ).toBeInstanceOf(Date);
    // What it was is read as OneUptime, by the update's own query.
    expect(findBySpy.mock.calls[0]![0]).toMatchObject({
      query: { _id: SETTING_ID.toString() },
      props: { isRoot: true },
    });
  });

  test("turned off by an API key, it says when and names nobody", async () => {
    existing = [settingOf({ isEnabled: true })];

    const updateBy: UpdateBy<DataSecurityComplianceSetting> = updateOf(
      { isEnabled: false },
      null,
    );

    await permitted.onUpdatePermitted(updateBy);

    expect(
      (updateBy.data as { turnedOffAt?: Date }).turnedOffAt,
    ).toBeInstanceOf(Date);
    expect(
      (updateBy.data as { turnedOffByUserId?: ObjectID | null })
        .turnedOffByUserId,
    ).toBeNull();
  });

  test("saved off again, it keeps who turned it off and when", async () => {
    existing = [settingOf({ isEnabled: false })];

    const updateBy: UpdateBy<DataSecurityComplianceSetting> = updateOf({
      isEnabled: false,
    });

    await permitted.onUpdatePermitted(updateBy);

    expect(updateBy.data).toEqual({ isEnabled: false });
  });

  test("turned on again, it names nobody, and reads nothing to say so", async () => {
    const updateBy: UpdateBy<DataSecurityComplianceSetting> = updateOf({
      isEnabled: true,
    });

    await permitted.onUpdatePermitted(updateBy);

    expect(updateBy.data).toEqual({
      isEnabled: true,
      turnedOffAt: null,
      turnedOffByUserId: null,
    });
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("a reason written while it is off changes neither", async () => {
    const updateBy: UpdateBy<DataSecurityComplianceSetting> = updateOf({
      note: "No card data here.",
    });

    await permitted.onUpdatePermitted(updateBy);

    expect(updateBy.data).toEqual({ note: "No card data here." });
    expect(findBySpy).not.toHaveBeenCalled();
  });
});

describe("why it does not apply", () => {
  test("is stored trimmed, an empty one as none, on a create", async () => {
    expect((await create({ note: "  No card data here.  " })).data.note).toBe(
      "No card data here.",
    );
    expect((await create({ note: "   " })).data.note).toBeNull();
    // A create with no reason is left with none.
    expect((await create({})).data.note).toBeUndefined();
  });

  test("is stored trimmed, an empty one as none, on a change", async () => {
    jest
      .spyOn(ProjectReferenceCheck, "validateUpdate")
      .mockResolvedValue(undefined as never);

    const written: UpdateBy<DataSecurityComplianceSetting> = updateOf({
      note: "  Logs never hold card data.  ",
    });

    await permitted.onBeforeUpdate(written);

    expect((written.data as { note?: unknown }).note).toBe(
      "Logs never hold card data.",
    );

    const cleared: UpdateBy<DataSecurityComplianceSetting> = updateOf({
      note: "",
    });

    await permitted.onBeforeUpdate(cleared);

    expect((cleared.data as { note?: unknown }).note).toBeNull();

    const untouched: UpdateBy<DataSecurityComplianceSetting> = updateOf({
      isEnabled: false,
    });

    await permitted.onBeforeUpdate(untouched);

    expect(untouched.data).toEqual({ isEnabled: false });
  });

  test("longer than its column holds, it is refused in words", async () => {
    const result: { thrown: unknown; data: DataSecurityComplianceSetting } =
      await create({ note: "x".repeat(ColumnLength.LongText + 1) });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Error).message).toBe(
      `Write the reason in ${ColumnLength.LongText} characters or fewer.`,
    );
    expect(
      (await create({ note: "x".repeat(ColumnLength.LongText) })).thrown,
    ).toBeUndefined();
  });

  test("is read the same way wherever it is written", () => {
    expect(DataSecurityComplianceSettingServiceType.readNote(" a ")).toBe("a");
    expect(DataSecurityComplianceSettingServiceType.readNote("")).toBeNull();
    expect(DataSecurityComplianceSettingServiceType.readNote(null)).toBeNull();
    expect(DataSecurityComplianceSettingServiceType.readNote(7)).toBeNull();
  });
});
