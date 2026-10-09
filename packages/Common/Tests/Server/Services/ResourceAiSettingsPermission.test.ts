import CephClusterFeedService from "../../../Server/Services/CephClusterFeedService";
import CephClusterService from "../../../Server/Services/CephClusterService";
import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterFeedService from "../../../Server/Services/DockerSwarmClusterFeedService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostFeedService from "../../../Server/Services/HostFeedService";
import HostService from "../../../Server/Services/HostService";
import PodmanHostFeedService from "../../../Server/Services/PodmanHostFeedService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterFeedService from "../../../Server/Services/ProxmoxClusterFeedService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ResourceAiAgentService from "../../../Server/Services/ResourceAiAgentService";
import UserService from "../../../Server/Services/UserService";
import VMwareVCenterFeedService from "../../../Server/Services/VMwareVCenterFeedService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { ResourceAiAccessWriteCarryForward } from "../../../Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import { CephClusterFeedEventType } from "../../../Models/DatabaseModels/CephClusterFeed";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import { DatabaseServerFeedEventType } from "../../../Models/DatabaseModels/DatabaseServerFeed";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import { DockerHostFeedEventType } from "../../../Models/DatabaseModels/DockerHostFeed";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import { DockerSwarmClusterFeedEventType } from "../../../Models/DatabaseModels/DockerSwarmClusterFeed";
import Host from "../../../Models/DatabaseModels/Host";
import { HostFeedEventType } from "../../../Models/DatabaseModels/HostFeed";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import { PodmanHostFeedEventType } from "../../../Models/DatabaseModels/PodmanHostFeed";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import { ProxmoxClusterFeedEventType } from "../../../Models/DatabaseModels/ProxmoxClusterFeed";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import { VMwareVCenterFeedEventType } from "../../../Models/DatabaseModels/VMwareVCenterFeed";
import {
  RESOURCE_AI_ALLOWLIST_EXAMPLES,
  getResourceAiAccessAdminRefusal,
} from "../../../Types/AI/ResourceAiAccessPermissions";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
  AI_RESOURCE_TYPE_INFO,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import {
  stubRowsCallerMayWriteLikeFindBy,
  readsOfRowsCallerMayWrite,
} from "../TestingUtils/RowsCallerMayWrite";
/*
 * Who may make OneUptime AI do MORE on an infrastructure resource a
 * resource AI agent serves, enforced in each resource's own service (the
 * update hook calls the shared ResourceAiAccessSettings) — the rule
 * KubernetesClusterAiSettingsPermission.test.ts pins for a cluster:
 *
 * - LOOSENING (ANY move of the mode up — Off to anything, up to Automatic
 *   or Bypass approval — or adding an allowlist pattern) needs a GRANT of
 *   Project Owner, Project Admin or Edit Auto Remediation Rule;
 * - TIGHTENING (Off, moving down, removing patterns) and the investigation
 *   switch stay open to everyone who may edit the resource;
 * - an unchanged value re-posted by the AI page's form is not a change;
 * - the aiAccess* columns are the server's alone;
 * - root (an agent's first-connection defaults, the outcome bookkeeping)
 *   and master admins are not gated;
 * - an operator's AI write marks the resource AI-configured and is recorded
 *   on the resource's feed.
 *
 * The full rule runs against the Docker host, the database server and the
 * host services; a table over all eight services proves each one is wired.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_RESOURCE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

// Roles that may make AI do more (RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS).
const AI_ACCESS_ADMIN_ROLES: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditAutoRemediationRule,
];

type Hooks = {
  onBeforeUpdate: (
    updateBy: UpdateBy<BaseModel>,
  ) => Promise<OnUpdate<BaseModel>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<BaseModel>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<BaseModel>>;
};

/*
 * Everything the table needs to reach one resource type's service, its
 * feed, and the permission that lets someone edit it.
 */
interface ServiceWiring {
  resourceType: AiResourceType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  modelType: { new (): BaseModel };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  feedService: any;
  feedMethod: string;
  idKey: string;
  eventKey: string;
  updatedEvent: string;
  linkMethod: string;
  editPermission: Permission;
  readPermission: Permission;
}

const WIRING: Array<ServiceWiring> = [
  {
    resourceType: AiResourceType.DockerHost,
    service: DockerHostService,
    modelType: DockerHost,
    feedService: DockerHostFeedService,
    feedMethod: "createDockerHostFeedItem",
    idKey: "dockerHostId",
    eventKey: "dockerHostFeedEventType",
    updatedEvent: DockerHostFeedEventType.DockerHostUpdated,
    linkMethod: "getDockerHostMarkdownLink",
    editPermission: Permission.EditDockerHost,
    readPermission: Permission.ReadDockerHost,
  },
  {
    resourceType: AiResourceType.PodmanHost,
    service: PodmanHostService,
    modelType: PodmanHost,
    feedService: PodmanHostFeedService,
    feedMethod: "createPodmanHostFeedItem",
    idKey: "podmanHostId",
    eventKey: "podmanHostFeedEventType",
    updatedEvent: PodmanHostFeedEventType.PodmanHostUpdated,
    linkMethod: "getPodmanHostMarkdownLink",
    editPermission: Permission.EditPodmanHost,
    readPermission: Permission.ReadPodmanHost,
  },
  {
    resourceType: AiResourceType.DockerSwarmCluster,
    service: DockerSwarmClusterService,
    modelType: DockerSwarmCluster,
    feedService: DockerSwarmClusterFeedService,
    feedMethod: "createDockerSwarmClusterFeedItem",
    idKey: "dockerSwarmClusterId",
    eventKey: "dockerSwarmClusterFeedEventType",
    updatedEvent: DockerSwarmClusterFeedEventType.DockerSwarmClusterUpdated,
    linkMethod: "getDockerSwarmClusterMarkdownLink",
    editPermission: Permission.EditDockerSwarmCluster,
    readPermission: Permission.ReadDockerSwarmCluster,
  },
  {
    resourceType: AiResourceType.ProxmoxCluster,
    service: ProxmoxClusterService,
    modelType: ProxmoxCluster,
    feedService: ProxmoxClusterFeedService,
    feedMethod: "createProxmoxClusterFeedItem",
    idKey: "proxmoxClusterId",
    eventKey: "proxmoxClusterFeedEventType",
    updatedEvent: ProxmoxClusterFeedEventType.ProxmoxClusterUpdated,
    linkMethod: "getProxmoxClusterMarkdownLink",
    editPermission: Permission.EditProxmoxCluster,
    readPermission: Permission.ReadProxmoxCluster,
  },
  {
    resourceType: AiResourceType.VMwareVCenter,
    service: VMwareVCenterService,
    modelType: VMwareVCenter,
    feedService: VMwareVCenterFeedService,
    feedMethod: "createVMwareVCenterFeedItem",
    idKey: "vmwareVCenterId",
    eventKey: "vmwareVCenterFeedEventType",
    updatedEvent: VMwareVCenterFeedEventType.VMwareVCenterUpdated,
    linkMethod: "getVMwareVCenterMarkdownLink",
    editPermission: Permission.EditVMwareVCenter,
    readPermission: Permission.ReadVMwareVCenter,
  },
  {
    resourceType: AiResourceType.CephCluster,
    service: CephClusterService,
    modelType: CephCluster,
    feedService: CephClusterFeedService,
    feedMethod: "createCephClusterFeedItem",
    idKey: "cephClusterId",
    eventKey: "cephClusterFeedEventType",
    updatedEvent: CephClusterFeedEventType.CephClusterUpdated,
    linkMethod: "getCephClusterMarkdownLink",
    editPermission: Permission.EditCephCluster,
    readPermission: Permission.ReadCephCluster,
  },
  {
    resourceType: AiResourceType.DatabaseServer,
    service: DatabaseServerService,
    modelType: DatabaseServer,
    feedService: DatabaseServerFeedService,
    feedMethod: "createDatabaseServerFeedItem",
    idKey: "databaseServerId",
    eventKey: "databaseServerFeedEventType",
    updatedEvent: DatabaseServerFeedEventType.DatabaseServerUpdated,
    linkMethod: "getDatabaseServerMarkdownLink",
    editPermission: Permission.EditDatabaseServer,
    readPermission: Permission.ReadDatabaseServer,
  },
  {
    resourceType: AiResourceType.Host,
    service: HostService,
    modelType: Host,
    feedService: HostFeedService,
    feedMethod: "createHostFeedItem",
    idKey: "hostId",
    eventKey: "hostFeedEventType",
    updatedEvent: HostFeedEventType.HostUpdated,
    linkMethod: "getHostMarkdownLink",
    editPermission: Permission.EditHost,
    readPermission: Permission.ReadHost,
  },
];

// The three the full rule runs against (the unit's named coverage).
const FULLY_COVERED: Array<ServiceWiring> = WIRING.filter(
  (wiring: ServiceWiring) => {
    return [
      AiResourceType.DockerHost,
      AiResourceType.DatabaseServer,
      AiResourceType.Host,
    ].includes(wiring.resourceType);
  },
);

function hooks(wiring: ServiceWiring): Hooks {
  return wiring.service as Hooks;
}

function permissionRow(
  permission: Permission,
  isBlockPermission: boolean = false,
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission,
  };
}

function userProps(
  rows: Array<UserPermission>,
  options: {
    tenantId?: ObjectID | null;
    permissionProjectId?: ObjectID;
  } = {},
): DatabaseCommonInteractionProps {
  const tenantId: ObjectID | null =
    options.tenantId === undefined ? PROJECT_ID : options.tenantId;
  const permissionProjectId: ObjectID =
    options.permissionProjectId || tenantId || PROJECT_ID;

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: permissionProjectId,
    permissions: rows,
  };

  return {
    userId: ObjectID.generate(),
    ...(tenantId ? { tenantId } : {}),
    userTenantAccessPermission: {
      [permissionProjectId.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

function propsWith(
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  return userProps(
    permissions.map((permission: Permission) => {
      return permissionRow(permission);
    }),
  );
}

function updateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<BaseModel> {
  return {
    query: { _id: RESOURCE_ID.toString() },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<BaseModel>;
}

function resource(overrides: Record<string, unknown> = {}): BaseModel {
  return {
    id: RESOURCE_ID,
    projectId: PROJECT_ID,
    isAiInvestigationEnabled: false,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: null,
    ...overrides,
  } as unknown as BaseModel;
}

// Roles that may edit a resource of this type but may not author a FullAuto rule.
function editorRoles(wiring: ServiceWiring): Array<Permission> {
  return [
    Permission.SettingsMember,
    Permission.SettingsAdmin,
    Permission.ProjectMember,
    wiring.editPermission,
  ];
}

// Writes that make AI do more on a never-configured resource of this type.
function looseningWrites(
  wiring: ServiceWiring,
): Array<[string, Record<string, unknown>]> {
  const example: string = RESOURCE_AI_ALLOWLIST_EXAMPLES[wiring.resourceType];

  return [
    [
      "turn AI fixes on to Ask for approval",
      { aiRemediationMode: ResourceAiRemediationMode.RequireApproval },
    ],
    [
      "switch AI remediation to Automatic",
      { aiRemediationMode: ResourceAiRemediationMode.Automatic },
    ],
    [
      "switch AI remediation to Bypass approval",
      { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
    ],
    ["add an allowlist pattern", { aiCommandAllowlist: [example] }],
    [
      "pair Automatic with an allowlist",
      {
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
        aiCommandAllowlist: [example],
      },
    ],
  ];
}

// Writes that make AI do less, or only flip the investigation switch.
const TIGHTENING_WRITES: Array<[string, Record<string, unknown>]> = [
  [
    "turn AI remediation off",
    { aiRemediationMode: ResourceAiRemediationMode.Disabled },
  ],
  ["clear the allowlist to an empty list", { aiCommandAllowlist: [] }],
  ["clear the allowlist to null", { aiCommandAllowlist: null }],
  ["clear the allowlist text field", { aiCommandAllowlist: "" }],
  ["turn AI investigation on", { isAiInvestigationEnabled: true }],
  ["turn AI investigation off", { isAiInvestigationEnabled: false }],
  ["rename the resource", { name: "prod-web-1" }],
];

/*
 * No resource has an AI agent here: every operator write of an AI setting
 * reads the resources' agent rows (whether the agent sets investigation and
 * fixes), and these blocks are about who may change the settings. Without
 * an agent, OneUptime sets them.
 */
function withoutResourceAiAgents(): jest.SpyInstance {
  return jest
    .spyOn(ResourceAiAgentService, "findAgentsForResources")
    .mockResolvedValue(new Map<string, ResourceAiAgent>());
}

describe.each(FULLY_COVERED)(
  "$resourceType AI access: who may make AI do more",
  (wiring: ServiceWiring) => {
    let resourceLookup: jest.SpyInstance;

    beforeEach(() => {
      withoutResourceAiAgents();
      resourceLookup = jest
        .spyOn(wiring.service, "findBy")
        .mockResolvedValue([resource()]);

      /*
       * The read of the rows the caller's update may write, which the update
       * path makes before the hooks: what the read above answers.
       */
      stubRowsCallerMayWriteLikeFindBy(
        wiring.service,
        jest.spyOn(wiring.service, "findBy"),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("the column layer lets every editor through, so the service is the guard", () => {
      it.each(editorRoles(wiring))(
        "the table and column checks accept Bypass approval from %s",
        (role: Permission) => {
          const props: DatabaseCommonInteractionProps = propsWith(role);

          expect(() => {
            TablePermission.checkTableLevelPermissions(
              wiring.modelType,
              props,
              DatabaseRequestType.Update,
            );
            ColumnPermissions.checkDataColumnPermissions(
              wiring.modelType,
              {
                aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
              } as unknown as BaseModel,
              props,
              DatabaseRequestType.Update,
            );
          }).not.toThrow();
        },
      );

      it("while the server-only columns are refused by the column layer too", () => {
        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            wiring.modelType,
            {
              aiAccessConfiguredAt: new Date(),
            } as unknown as BaseModel,
            propsWith(Permission.ProjectOwner),
            DatabaseRequestType.Update,
          );
        }).toThrow();
      });
    });

    describe.each(editorRoles(wiring))(
      "a caller holding only %s",
      (role: Permission) => {
        it.each(looseningWrites(wiring))(
          "may not %s",
          async (_label: string, data: Record<string, unknown>) => {
            await expect(
              hooks(wiring).onBeforeUpdate(updateBy(data, propsWith(role))),
            ).rejects.toThrow(
              getResourceAiAccessAdminRefusal(wiring.resourceType),
            );
          },
        );

        it.each(TIGHTENING_WRITES)(
          "may %s",
          async (_label: string, data: Record<string, unknown>) => {
            await expect(
              hooks(wiring).onBeforeUpdate(updateBy(data, propsWith(role))),
            ).resolves.toBeDefined();
          },
        );
      },
    );

    describe.each(AI_ACCESS_ADMIN_ROLES)(
      "a caller holding %s",
      (role: Permission) => {
        it.each(looseningWrites(wiring))(
          "may %s",
          async (_label: string, data: Record<string, unknown>) => {
            const onUpdate: OnUpdate<BaseModel> = await hooks(
              wiring,
            ).onBeforeUpdate(updateBy(data, propsWith(role)));

            expect(
              (onUpdate.carryForward as ResourceAiAccessWriteCarryForward)
                .resourceType,
            ).toBe(wiring.resourceType);
          },
        );
      },
    );

    describe("judged against the resource's current settings", () => {
      it("lets an editor step Bypass approval down to Automatic, but not back up", async () => {
        resourceLookup.mockResolvedValue([
          resource({
            aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          }),
        ]);

        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: ResourceAiRemediationMode.Automatic },
              propsWith(wiring.editPermission),
            ),
          ),
        ).resolves.toBeDefined();

        resourceLookup.mockResolvedValue([
          resource({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
        ]);

        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
              propsWith(wiring.editPermission),
            ),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      });

      it("refuses Automatic from Ask for approval", async () => {
        resourceLookup.mockResolvedValue([
          resource({
            aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          }),
        ]);

        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: ResourceAiRemediationMode.Automatic },
              propsWith(Permission.SettingsMember),
            ),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      });

      it("lets an editor re-post every unchanged setting while flipping investigation", async () => {
        const example: string =
          RESOURCE_AI_ALLOWLIST_EXAMPLES[wiring.resourceType];

        resourceLookup.mockResolvedValue([
          resource({
            isAiInvestigationEnabled: true,
            aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
            aiCommandAllowlist: [example],
          }),
        ]);

        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              {
                isAiInvestigationEnabled: false,
                aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
                aiCommandAllowlist: [`  ${example} `],
              },
              propsWith(Permission.SettingsMember),
            ),
          ),
        ).resolves.toBeDefined();
      });

      it("lets an editor remove an allowlist pattern but not add one", async () => {
        const example: string =
          RESOURCE_AI_ALLOWLIST_EXAMPLES[wiring.resourceType];

        resourceLookup.mockResolvedValue([
          resource({ aiCommandAllowlist: [example] }),
        ]);

        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiCommandAllowlist: [] },
              propsWith(wiring.editPermission),
            ),
          ),
        ).resolves.toBeDefined();

        resourceLookup.mockResolvedValue([resource()]);

        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiCommandAllowlist: [example] },
              propsWith(wiring.editPermission),
            ),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      });
    });

    describe("validation, block rows, other projects and the server-only columns", () => {
      it("refuses an unusable allowlist entry for everyone, admins included", async () => {
        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiCommandAllowlist: ["rm -rf /"] },
              propsWith(Permission.ProjectOwner),
            ),
          ),
        ).rejects.toThrow(BadDataException);
      });

      it("refuses an unknown mode", async () => {
        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: "Yolo" },
              propsWith(Permission.ProjectOwner),
            ),
          ),
        ).rejects.toThrow(BadDataException);
      });

      it("does not read a block row for Project Admin as a grant", async () => {
        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
              userProps([
                permissionRow(wiring.editPermission),
                permissionRow(Permission.ProjectAdmin, true),
              ]),
            ),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      });

      it("does not count an admin grant held in a different project", async () => {
        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
              userProps([permissionRow(Permission.ProjectAdmin)], {
                tenantId: PROJECT_ID,
                permissionProjectId: OTHER_PROJECT_ID,
              }),
            ),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      });

      it("refuses the server-only columns to an owner and a master admin", async () => {
        for (const props of [
          propsWith(Permission.ProjectOwner),
          { isMasterAdmin: true, userId: ObjectID.generate() },
        ] as Array<DatabaseCommonInteractionProps>) {
          await expect(
            hooks(wiring).onBeforeUpdate(
              updateBy({ aiAccessLastVerifiedAt: new Date() }, props),
            ),
          ).rejects.toThrow(NotAuthorizedException);
        }
      });

      it("judges a write that matches no resource against the defaults in the caller's tenant", async () => {
        resourceLookup.mockResolvedValue([]);

        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
              propsWith(Permission.SettingsMember),
            ),
          ),
        ).rejects.toThrow(NotAuthorizedException);

        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
              propsWith(Permission.ProjectAdmin),
            ),
          ),
        ).resolves.toBeDefined();
      });

      it("refuses when the write loosens ANY matched resource", async () => {
        resourceLookup.mockResolvedValue([
          resource({
            aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          }),
          resource({
            id: OTHER_RESOURCE_ID,
            aiRemediationMode: ResourceAiRemediationMode.Disabled,
          }),
        ]);

        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
              propsWith(Permission.SettingsMember),
            ),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      });

      it("scopes the settings read to the caller's project, as root, selecting the AI columns", async () => {
        await hooks(wiring).onBeforeUpdate(
          updateBy(
            { isAiInvestigationEnabled: true },
            propsWith(Permission.SettingsMember),
          ),
        );

        expect(resourceLookup).toHaveBeenCalledTimes(1);
        const args: {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
        } = resourceLookup.mock.calls[0]![0] as {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
        };

        expect(args.query).toEqual({ _id: RESOURCE_ID.toString() });
        // Within the caller's project: the rows they may write are found there.
        expect(
          readsOfRowsCallerMayWrite(wiring.service as never)[0]!.query[
            "projectId"
          ],
        ).toEqual(PROJECT_ID);
        expect(args.props.isRoot).toBe(true);
        for (const column of [
          "projectId",
          "isAiInvestigationEnabled",
          "aiRemediationMode",
          "aiCommandAllowlist",
        ]) {
          expect(args.select[column]).toBe(true);
        }
      });
    });

    describe("callers the check does not apply to", () => {
      it("lets the server's own (root) writes set any mode and allowlist without reading settings", async () => {
        const onUpdate: OnUpdate<BaseModel> = await hooks(
          wiring,
        ).onBeforeUpdate(
          updateBy(
            {
              isAiInvestigationEnabled: true,
              aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
              aiCommandAllowlist: [
                RESOURCE_AI_ALLOWLIST_EXAMPLES[wiring.resourceType],
              ],
              aiAccessLastVerifiedAt: new Date(),
            },
            { isRoot: true },
          ),
        );

        expect(onUpdate.carryForward).toBeNull();
        expect(resourceLookup).not.toHaveBeenCalled();
      });

      it("lets a master admin loosen without any project permission rows", async () => {
        await expect(
          hooks(wiring).onBeforeUpdate(
            updateBy(
              { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
              { isMasterAdmin: true, userId: ObjectID.generate() },
            ),
          ),
        ).resolves.toBeDefined();
      });

      it("a write of other columns reads nothing and carries nothing forward", async () => {
        const onUpdate: OnUpdate<BaseModel> = await hooks(
          wiring,
        ).onBeforeUpdate(
          updateBy({ name: "renamed" }, propsWith(wiring.editPermission)),
        );

        expect(onUpdate.carryForward).toBeNull();
        expect(resourceLookup).not.toHaveBeenCalled();
      });
    });
  },
);

/*
 * Every one of the eight services calls the shared rule from its update
 * hooks: a loosening by an editor is refused, an admin's is let through
 * with the settings as they stood, and after an operator's AI write the
 * resource is marked AI-configured and the change lands on its own feed
 * as an "updated" item.
 */
describe.each(WIRING)(
  "$resourceType service wiring of the AI access rules",
  (wiring: ServiceWiring) => {
    let resourceLookup: jest.SpyInstance;
    let markerWrite: jest.SpyInstance;
    let feedWrite: jest.SpyInstance;

    beforeEach(() => {
      withoutResourceAiAgents();
      resourceLookup = jest
        .spyOn(wiring.service, "findBy")
        .mockResolvedValue([resource()]);

      /*
       * The read of the rows the caller's update may write, which the update
       * path makes before the hooks: what the read above answers.
       */
      stubRowsCallerMayWriteLikeFindBy(
        wiring.service,
        jest.spyOn(wiring.service, "findBy"),
      );
      markerWrite = jest
        .spyOn(wiring.service, "updateBy")
        .mockResolvedValue(1 as never);
      feedWrite = jest
        .spyOn(wiring.feedService, wiring.feedMethod)
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(wiring.service, wiring.linkMethod)
        .mockResolvedValue(
          FeedMarkdown.asMarkdown("[resource](https://x)") as never,
        );
      jest
        .spyOn(UserService, "getUserMarkdownString")
        .mockResolvedValue(
          FeedMarkdown.asMarkdown("[Jane](https://oneuptime.example/user)"),
        );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function waitFor(predicate: () => boolean): Promise<void> {
      for (let i: number = 0; i < 100 && !predicate(); i++) {
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 0);
        });
      }
    }

    it("refuses an editor's Bypass approval in the refusal's own words", async () => {
      await expect(
        hooks(wiring).onBeforeUpdate(
          updateBy(
            { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
            propsWith(wiring.editPermission),
          ),
        ),
      ).rejects.toThrow(getResourceAiAccessAdminRefusal(wiring.resourceType));
    });

    it("validates the allowlist against its own type's programs", async () => {
      const otherType: AiResourceType =
        wiring.resourceType === AiResourceType.Host
          ? AiResourceType.CephCluster
          : AiResourceType.Host;

      await expect(
        hooks(wiring).onBeforeUpdate(
          updateBy(
            { aiCommandAllowlist: [RESOURCE_AI_ALLOWLIST_EXAMPLES[otherType]] },
            propsWith(Permission.ProjectOwner),
          ),
        ),
      ).rejects.toThrow(
        `does not start with a program the ${
          AI_RESOURCE_TYPE_INFO[wiring.resourceType].agentDisplayName
        } runs`,
      );
    });

    it("lets an admin's write through, marks the resource configured and records it on its feed", async () => {
      const props: DatabaseCommonInteractionProps = propsWith(
        Permission.ProjectAdmin,
      );

      const before: OnUpdate<BaseModel> = await hooks(wiring).onBeforeUpdate(
        updateBy(
          { aiRemediationMode: ResourceAiRemediationMode.RequireApproval },
          props,
        ),
      );

      expect(before.carryForward).toEqual({
        resourceType: wiring.resourceType,
        previousResourceAiAccessSettings: {
          [RESOURCE_ID.toString()]: {
            projectId: PROJECT_ID,
            isAiInvestigationEnabled: false,
            aiRemediationMode: ResourceAiRemediationMode.Disabled,
            aiCommandAllowlist: [],
            // Never configured, and no AI agent: OneUptime sets them.
            aiAccessConfiguredAt: null,
            aiSettingsSource: "oneuptime",
          },
        },
      });

      await hooks(wiring).onUpdateSuccess(before, [RESOURCE_ID]);

      const markerCalls: Array<Record<string, unknown>> =
        markerWrite.mock.calls.map((call: Array<unknown>) => {
          return call[0] as Record<string, unknown>;
        });
      const marker: Record<string, unknown> | undefined = markerCalls.find(
        (call: Record<string, unknown>) => {
          return Boolean(
            (call["data"] as Record<string, unknown>)["aiAccessConfiguredAt"],
          );
        },
      );
      expect(marker).toBeDefined();
      expect(marker!["props"]).toEqual({ isRoot: true });

      await waitFor(() => {
        return feedWrite.mock.calls.length > 0;
      });

      expect(feedWrite).toHaveBeenCalledTimes(1);
      const item: Record<string, unknown> = feedWrite.mock
        .calls[0]![0] as Record<string, unknown>;
      expect(String(item[wiring.idKey])).toBe(RESOURCE_ID.toString());
      expect(item[wiring.eventKey]).toBe(wiring.updatedEvent);
      expect(item["projectId"]).toBe(PROJECT_ID);
      expect(item["userId"]).toBe(props.userId);
      expect(item["feedInfoInMarkdown"]).toBe(
        "🤖 **[Jane](https://oneuptime.example/user)** changed what OneUptime AI may do on [resource](https://x):\n\n- AI remediation changed from **Off** to **Ask for approval**",
      );
    });

    it("negative control: a root write is neither marked nor recorded", async () => {
      const before: OnUpdate<BaseModel> = await hooks(wiring).onBeforeUpdate(
        updateBy(
          { aiRemediationMode: ResourceAiRemediationMode.RequireApproval },
          { isRoot: true },
        ),
      );

      await hooks(wiring).onUpdateSuccess(before, [RESOURCE_ID]);

      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });

      expect(markerWrite).not.toHaveBeenCalled();
      expect(feedWrite).not.toHaveBeenCalled();
      expect(resourceLookup).not.toHaveBeenCalled();
    });
  },
);

it("the wiring table covers every resource type", () => {
  expect(
    WIRING.map((wiring: ServiceWiring) => {
      return wiring.resourceType;
    }),
  ).toEqual([...ALL_AI_RESOURCE_TYPES]);
});

/*
 * The same rule through updateOneById, the entry point BaseAPI's PUT takes.
 * Only the surfaces that need Postgres are stubbed: the internal find, the
 * repository, and the model-level permission checks (the table/column layer
 * is pinned above and lets these roles through by design).
 */
describe.each(FULLY_COVERED)(
  "$resourceType AI access through updateOneById",
  (wiring: ServiceWiring) => {
    let repositoryUpdate: jest.Mock;
    let feedWrite: jest.SpyInstance;

    beforeEach(() => {
      withoutResourceAiAgents();
      getJestSpyOn(wiring.service, "_findBy").mockResolvedValue([
        resource({
          _id: RESOURCE_ID.toString(),
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        }),
      ]);
      repositoryUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      getJestSpyOn(wiring.service, "getRepository").mockReturnValue({
        update: repositoryUpdate,
        save: jest.fn(),
      });
      jest
        .spyOn(ModelPermission, "checkUpdateQueryPermissions")
        .mockImplementation(((_modelType: unknown, query: unknown) => {
          return Promise.resolve(query);
        }) as never);
      jest
        .spyOn(ModelPermission, "checkUpdatePermissionByModel")
        .mockResolvedValue(undefined);
      feedWrite = jest
        .spyOn(wiring.feedService, wiring.feedMethod)
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(UserService, "getUserMarkdownString")
        .mockResolvedValue(
          FeedMarkdown.asMarkdown("[Jane](https://oneuptime.example/user)"),
        );
      jest
        .spyOn(wiring.service, wiring.linkMethod)
        .mockResolvedValue(
          FeedMarkdown.asMarkdown("[resource](https://x)") as never,
        );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function waitFor(predicate: () => boolean): Promise<void> {
      for (let i: number = 0; i < 100 && !predicate(); i++) {
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 0);
        });
      }
    }

    it("refuses an editor's Bypass approval before anything is written", async () => {
      await expect(
        wiring.service.updateOneById({
          id: RESOURCE_ID,
          data: {
            aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          },
          props: propsWith(wiring.editPermission),
        }),
      ).rejects.toThrow(NotAuthorizedException);

      expect(repositoryUpdate).not.toHaveBeenCalled();
    });

    it("writes a Project Admin's Bypass approval, marks the resource configured and records who did it", async () => {
      const props: DatabaseCommonInteractionProps = propsWith(
        Permission.ProjectAdmin,
      );

      const updated: number = await wiring.service.updateOneById({
        id: RESOURCE_ID,
        data: {
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        },
        props,
      });

      expect(updated).toBe(1);

      const writes: Array<Record<string, unknown>> =
        repositoryUpdate.mock.calls.map((call: Array<unknown>) => {
          return call[1] as Record<string, unknown>;
        });

      expect(writes[0]!["aiRemediationMode"]).toBe(
        ResourceAiRemediationMode.BypassApproval,
      );
      expect(writes[0]!["aiAccessConfiguredAt"]).toBeUndefined();
      // The marker is its own, server-side write after the operator's.
      expect(writes[1]!["aiAccessConfiguredAt"]).toBeInstanceOf(Date);

      await waitFor(() => {
        return feedWrite.mock.calls.length > 0;
      });

      expect(feedWrite).toHaveBeenCalledTimes(1);
      const item: Record<string, unknown> = feedWrite.mock
        .calls[0]![0] as Record<string, unknown>;
      expect(item["userId"]).toBe(props.userId);
      expect(item["feedInfoInMarkdown"]).toContain(
        "AI remediation changed from **Ask for approval** to **Bypass approval**",
      );
    });
  },
);
