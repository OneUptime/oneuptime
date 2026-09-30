import CephClusterService from "../../../Server/Services/CephClusterService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../Server/Services/HostService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ResourceAiAccessSettings from "../../../Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import {
  RESOURCE_AI_ALLOWLIST_EXAMPLES,
  getResourceAiAccessAdminRefusal,
} from "../../../Types/AI/ResourceAiAccessPermissions";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test: a CREATE of an infrastructure resource a resource AI
 * agent serves is held to the AI access rules an update is held to
 * (ResourceAiAccessSettings.checkCreate from each service's onBeforeCreate),
 * as a Kubernetes cluster's create is:
 *
 * - an unknown remediation mode, or an allowlist entry the matcher can
 *   never use, is refused for EVERY caller (a master admin, root);
 * - the server-only aiAccess* columns (a forged "Last verified", a
 *   configured marker that would make an agent skip its first-connection
 *   defaults) are refused for every caller but root, a master admin
 *   included: the create column ACLs never run for a master admin;
 * - making AI do more than the never-configured defaults needs the AI
 *   access admin permissions, as on an update (defence in depth: the
 *   create column ACLs refuse these columns to every role today).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface CreateWiring {
  resourceType: AiResourceType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  modelType: { new (): BaseModel };
  editPermission: Permission;
}

const WIRING: Array<CreateWiring> = [
  {
    resourceType: AiResourceType.DockerHost,
    service: DockerHostService,
    modelType: DockerHost,
    editPermission: Permission.EditDockerHost,
  },
  {
    resourceType: AiResourceType.PodmanHost,
    service: PodmanHostService,
    modelType: PodmanHost,
    editPermission: Permission.EditPodmanHost,
  },
  {
    resourceType: AiResourceType.DockerSwarmCluster,
    service: DockerSwarmClusterService,
    modelType: DockerSwarmCluster,
    editPermission: Permission.EditDockerSwarmCluster,
  },
  {
    resourceType: AiResourceType.ProxmoxCluster,
    service: ProxmoxClusterService,
    modelType: ProxmoxCluster,
    editPermission: Permission.EditProxmoxCluster,
  },
  {
    resourceType: AiResourceType.VMwareVCenter,
    service: VMwareVCenterService,
    modelType: VMwareVCenter,
    editPermission: Permission.EditVMwareVCenter,
  },
  {
    resourceType: AiResourceType.CephCluster,
    service: CephClusterService,
    modelType: CephCluster,
    editPermission: Permission.EditCephCluster,
  },
  {
    resourceType: AiResourceType.DatabaseServer,
    service: DatabaseServerService,
    modelType: DatabaseServer,
    editPermission: Permission.EditDatabaseServer,
  },
  {
    resourceType: AiResourceType.Host,
    service: HostService,
    modelType: Host,
    editPermission: Permission.EditHost,
  },
];

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  isMasterAdmin: true,
  userId: new ObjectID("11111111-1111-4111-8111-111111111111"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

const ROOT: DatabaseCommonInteractionProps = {
  isRoot: true,
} as DatabaseCommonInteractionProps;

function propsWith(permission: Permission): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

function model(wiring: CreateWiring, data: Record<string, unknown>): BaseModel {
  const row: BaseModel = new wiring.modelType();
  Object.assign(row, { projectId: PROJECT_ID, name: "prod-1", ...data });
  return row;
}

function createBy(
  wiring: CreateWiring,
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): CreateBy<BaseModel> {
  return { data: model(wiring, data), props } as CreateBy<BaseModel>;
}

function onBeforeCreate(
  wiring: CreateWiring,
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<OnCreate<BaseModel>> {
  return wiring.service.onBeforeCreate(createBy(wiring, data, props));
}

it("the wiring table covers every resource type", () => {
  expect(
    WIRING.map((wiring: CreateWiring) => {
      return wiring.resourceType;
    }),
  ).toEqual([...ALL_AI_RESOURCE_TYPES]);
});

describe.each(WIRING)(
  "$resourceType create: the AI access rules",
  (wiring: CreateWiring) => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("refuses a master admin's unknown remediation mode", async () => {
      await expect(
        onBeforeCreate(wiring, { aiRemediationMode: "Bypass" }, MASTER_ADMIN),
      ).rejects.toThrow(BadDataException);
      await expect(
        onBeforeCreate(wiring, { aiRemediationMode: "Bypass" }, MASTER_ADMIN),
      ).rejects.toThrow(/AI remediation mode must be one of/);
    });

    it("refuses a master admin's allowlist entry the matcher can never use", async () => {
      await expect(
        onBeforeCreate(
          wiring,
          { aiCommandAllowlist: ["rm -rf /"] },
          MASTER_ADMIN,
        ),
      ).rejects.toThrow(/Pattern 1 of the AI command allowlist/);
    });

    it("refuses a master admin's forged 'Last verified' and configured marker", async () => {
      await expect(
        onBeforeCreate(
          wiring,
          {
            aiAccessLastVerifiedAt: new Date(),
            aiAccessConfiguredAt: new Date(),
          },
          MASTER_ADMIN,
        ),
      ).rejects.toThrow(NotAuthorizedException);
      await expect(
        onBeforeCreate(
          wiring,
          { aiAccessConfiguredAt: new Date() },
          MASTER_ADMIN,
        ),
      ).rejects.toThrow(
        "aiAccessConfiguredAt is written by OneUptime itself and cannot be set through the API.",
      );
    });

    it("refuses an editor's Bypass approval in the refusal's own words", async () => {
      await expect(
        onBeforeCreate(
          wiring,
          { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
          propsWith(wiring.editPermission),
        ),
      ).rejects.toThrow(getResourceAiAccessAdminRefusal(wiring.resourceType));
    });

    it("validates the server's own (root) creates too", async () => {
      await expect(
        onBeforeCreate(wiring, { aiRemediationMode: "Bypass" }, ROOT),
      ).rejects.toThrow(/AI remediation mode must be one of/);
    });

    it("negative control: root may set the server-only columns, and a usable allowlist is stored as an array", async () => {
      const example: string =
        RESOURCE_AI_ALLOWLIST_EXAMPLES[wiring.resourceType];

      const result: OnCreate<BaseModel> = await onBeforeCreate(
        wiring,
        {
          aiAccessConfiguredAt: new Date(),
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          aiCommandAllowlist: JSON.stringify([`  ${example}  `]),
        },
        ROOT,
      );

      expect(
        (result.createBy.data as unknown as Record<string, unknown>)[
          "aiCommandAllowlist"
        ],
      ).toEqual([example]);
    });

    it("negative control: a create without AI columns is untouched", () => {
      expect(() => {
        ResourceAiAccessSettings.checkCreate({
          resourceType: wiring.resourceType,
          createBy: createBy(wiring, {}, propsWith(wiring.editPermission)),
        });
      }).not.toThrow();
    });
  },
);

describe("ResourceAiAccessSettings.checkCreate", () => {
  it("lets a master admin create with any valid mode and allowlist", () => {
    const wiring: CreateWiring = WIRING[0]!;

    expect(() => {
      ResourceAiAccessSettings.checkCreate({
        resourceType: wiring.resourceType,
        createBy: createBy(
          wiring,
          {
            aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
            aiCommandAllowlist: [
              RESOURCE_AI_ALLOWLIST_EXAMPLES[wiring.resourceType],
            ],
          },
          MASTER_ADMIN,
        ),
      });
    }).not.toThrow();
  });

  it("lets a Project Admin create with a loosened mode (the admin set)", () => {
    const wiring: CreateWiring = WIRING[0]!;

    expect(() => {
      ResourceAiAccessSettings.checkCreate({
        resourceType: wiring.resourceType,
        createBy: createBy(
          wiring,
          { aiRemediationMode: ResourceAiRemediationMode.Automatic },
          propsWith(Permission.ProjectAdmin),
        ),
      });
    }).not.toThrow();
  });

  it("lets an editor create with settings no looser than the defaults", () => {
    const wiring: CreateWiring = WIRING[0]!;

    expect(() => {
      ResourceAiAccessSettings.checkCreate({
        resourceType: wiring.resourceType,
        createBy: createBy(
          wiring,
          {
            isAiInvestigationEnabled: true,
            aiRemediationMode: ResourceAiRemediationMode.Disabled,
            aiCommandAllowlist: [],
          },
          propsWith(wiring.editPermission),
        ),
      });
    }).not.toThrow();
  });
});

/*
 * The finding's path end to end: the POST a master admin sends reaches
 * DatabaseService.create, whose create permission check returns early for
 * a master admin. Refused before the row is saved.
 */
describe("a master admin's POST through DockerHostService.create", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is refused before anything is saved", async () => {
    const save: jest.Mock = jest.fn();
    getJestSpyOn(DockerHostService, "getRepository").mockReturnValue({
      save,
    });

    await expect(
      DockerHostService.create({
        data: model(WIRING[0]!, {
          aiRemediationMode: "Bypass",
          aiCommandAllowlist: ["rm -rf /"],
          aiAccessLastVerifiedAt: new Date(),
          aiAccessConfiguredAt: new Date(),
        }) as DockerHost,
        props: MASTER_ADMIN,
      }),
    ).rejects.toThrow(BadDataException);

    await expect(
      DockerHostService.create({
        data: model(WIRING[0]!, {
          aiAccessConfiguredAt: new Date(),
        }) as DockerHost,
        props: MASTER_ADMIN,
      }),
    ).rejects.toThrow(NotAuthorizedException);

    expect(save).not.toHaveBeenCalled();
  });
});
