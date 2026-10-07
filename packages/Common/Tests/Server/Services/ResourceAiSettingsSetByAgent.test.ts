import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import HostFeedService from "../../../Server/Services/HostFeedService";
import HostService from "../../../Server/Services/HostService";
import ResourceAiAccessService, {
  ResourceAiAccessProjectGates,
  ResourceAiAccessRow,
} from "../../../Server/Services/ResourceAiAccessService";
import ResourceAiAgentService from "../../../Server/Services/ResourceAiAgentService";
import UserService from "../../../Server/Services/UserService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  AGENT_SET_RESOURCE_AI_ACCESS_KEYS,
  getAgentSetResourceAiAccessRefusal,
} from "../../../Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import logger from "../../../Server/Utils/Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import { AgentAiSettings } from "../../../Types/AI/AgentAiSettings";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The resource services' half of "synced with the agent, and I should not
 * be able to manually edit it": while a resource's AI agent sets
 * investigation and fixes (its .env names ONEUPTIME_AI_INVESTIGATION /
 * ONEUPTIME_AI_FIXES, or nobody chose them and its defaults apply), an
 * operator's change to either is refused for everyone — master admins
 * included — while re-posting the values the resource has, the command
 * allowlist and the server's own writes go through, and a write marks
 * nothing configured. Settings stay OneUptime's (editable as before) for a
 * resource with no agent, an agent too old to report them, or an operator's
 * earlier choice where the agent uses its defaults. When the agents cannot
 * be read, a change is refused.
 *
 * The status the AI agent page reads carries where the settings are set,
 * and its "off" gaps point at the agent's variables when the agent sets
 * them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const CONFIGURED: AgentAiSettings = {
  investigation: true,
  fixes: "Automatic",
  isConfigured: true,
};

const DEFAULTS: AgentAiSettings = {
  investigation: true,
  fixes: "Automatic",
  isConfigured: false,
};

type Hooks = {
  onBeforeUpdate: (
    updateBy: UpdateBy<BaseModel>,
  ) => Promise<OnUpdate<BaseModel>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<BaseModel>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<BaseModel>>;
};

interface ServiceWiring {
  resourceType: AiResourceType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  feedService: any;
  feedMethod: string;
  linkMethod: string;
}

const WIRING: Array<ServiceWiring> = [
  {
    resourceType: AiResourceType.DockerHost,
    service: DockerHostService,
    feedService: DockerHostFeedService,
    feedMethod: "createDockerHostFeedItem",
    linkMethod: "getDockerHostMarkdownLink",
  },
  {
    resourceType: AiResourceType.DatabaseServer,
    service: DatabaseServerService,
    feedService: DatabaseServerFeedService,
    feedMethod: "createDatabaseServerFeedItem",
    linkMethod: "getDatabaseServerMarkdownLink",
  },
  {
    resourceType: AiResourceType.Host,
    service: HostService,
    feedService: HostFeedService,
    feedMethod: "createHostFeedItem",
    linkMethod: "getHostMarkdownLink",
  },
];

function propsWith(
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

function masterAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    isMasterAdmin: true,
  } as DatabaseCommonInteractionProps;
}

const CALLERS: Array<[string, () => DatabaseCommonInteractionProps]> = [
  [
    "a Settings Member",
    (): DatabaseCommonInteractionProps => {
      return propsWith(Permission.SettingsMember);
    },
  ],
  [
    "a Project Admin",
    (): DatabaseCommonInteractionProps => {
      return propsWith(Permission.ProjectAdmin);
    },
  ],
  ["a master admin", masterAdminProps],
];

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
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    // What the agent's settings put there.
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: null,
    aiAccessConfiguredAt: null,
    ...overrides,
  } as unknown as BaseModel;
}

function agentReporting(
  aiSettings: AgentAiSettings | undefined,
  resourceType: AiResourceType,
): Map<string, ResourceAiAgent> {
  return new Map<string, ResourceAiAgent>([
    [
      RESOURCE_ID.toString().toLowerCase(),
      {
        id: ObjectID.generate(),
        projectId: PROJECT_ID,
        resourceType,
        resourceId: RESOURCE_ID,
        posture: {
          resourceType,
          resourceIdentifier: "web-1",
          allowWrites: true,
          ...(aiSettings ? { aiSettings } : {}),
        },
      } as unknown as ResourceAiAgent,
    ],
  ]);
}

const CHANGES: Array<[string, Record<string, unknown>]> = [
  ["turn investigation off", { isAiInvestigationEnabled: false }],
  [
    "turn fixes down to Ask for approval",
    { aiRemediationMode: ResourceAiRemediationMode.RequireApproval },
  ],
  ["turn fixes off", { aiRemediationMode: ResourceAiRemediationMode.Disabled }],
  [
    "turn fixes up to Bypass approval",
    { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
  ],
];

describe.each(WIRING)(
  "$resourceType: settings its AI agent sets",
  (wiring: ServiceWiring) => {
    let resourceLookup: jest.SpyInstance;
    let agentLookup: jest.SpyInstance;
    let markerWrite: jest.SpyInstance;

    function hooks(): Hooks {
      return wiring.service as Hooks;
    }

    async function refusalOf(
      data: Record<string, unknown>,
      props: DatabaseCommonInteractionProps,
    ): Promise<string | null> {
      try {
        await hooks().onBeforeUpdate(updateBy(data, props));
        return null;
      } catch (error) {
        if (error instanceof BadDataException) {
          return error.message;
        }
        throw error;
      }
    }

    async function runUpdate(
      data: Record<string, unknown>,
      props: DatabaseCommonInteractionProps,
    ): Promise<void> {
      const onUpdate: OnUpdate<BaseModel> = await hooks().onBeforeUpdate(
        updateBy(data, props),
      );
      await hooks().onUpdateSuccess(onUpdate, [RESOURCE_ID]);
    }

    function markedConfigured(): boolean {
      return markerWrite.mock.calls.some((call: Array<unknown>) => {
        const write: { data: Record<string, unknown> } = call[0] as {
          data: Record<string, unknown>;
        };
        return Boolean(write.data["aiAccessConfiguredAt"]);
      });
    }

    beforeEach(() => {
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });
      resourceLookup = jest
        .spyOn(wiring.service, "findBy")
        .mockResolvedValue([resource()]);
      agentLookup = jest
        .spyOn(ResourceAiAgentService, "findAgentsForResources")
        .mockResolvedValue(agentReporting(CONFIGURED, wiring.resourceType));
      markerWrite = jest
        .spyOn(wiring.service, "updateBy")
        .mockResolvedValue(1 as never);
      jest
        .spyOn(wiring.feedService, wiring.feedMethod)
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(wiring.service, wiring.linkMethod)
        .mockResolvedValue("[resource](https://x)" as never);
      jest
        .spyOn(UserService, "getUserMarkdownString")
        .mockResolvedValue("[Jane](https://oneuptime.example/user)");
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe.each(CALLERS)(
      "%s",
      (_caller: string, props: () => DatabaseCommonInteractionProps) => {
        it.each(CHANGES)(
          "may not %s while the agent's configuration sets it",
          async (_label: string, data: Record<string, unknown>) => {
            expect(await refusalOf(data, props())).toBe(
              getAgentSetResourceAiAccessRefusal({
                resourceType: wiring.resourceType,
                source: "agent_configuration",
              }),
            );
          },
        );
      },
    );

    it.each(CHANGES)(
      "a Project Admin may not %s while the agent's defaults decide",
      async (_label: string, data: Record<string, unknown>) => {
        agentLookup.mockResolvedValue(
          agentReporting(DEFAULTS, wiring.resourceType),
        );

        expect(await refusalOf(data, propsWith(Permission.ProjectAdmin))).toBe(
          getAgentSetResourceAiAccessRefusal({
            resourceType: wiring.resourceType,
            source: "agent_defaults",
          }),
        );
      },
    );

    it("re-posting the values the resource has is no change", async () => {
      expect(
        await refusalOf(
          {
            isAiInvestigationEnabled: true,
            aiRemediationMode: ResourceAiRemediationMode.Automatic,
          },
          propsWith(Permission.SettingsMember),
        ),
      ).toBeNull();
    });

    it("an accepted write on an agent-set resource marks nothing configured", async () => {
      await runUpdate(
        { isAiInvestigationEnabled: true },
        propsWith(Permission.ProjectAdmin),
      );

      expect(markedConfigured()).toBe(false);
    });

    it("the server's own (root) writes are never refused", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy({ isAiInvestigationEnabled: false }, {
            isRoot: true,
          } as DatabaseCommonInteractionProps),
        ),
      ).resolves.toBeDefined();
    });

    it.each([
      ["no AI agent", new Map<string, ResourceAiAgent>(), null],
      [
        "an agent too old to report its settings",
        agentReporting(undefined, wiring.resourceType),
        null,
      ],
      [
        "an agent on its defaults where an operator already chose the settings",
        agentReporting(DEFAULTS, wiring.resourceType),
        new Date("2026-01-01T00:00:00Z"),
      ],
    ])(
      "%s: OneUptime's settings, changed as before, and the write marks the resource configured",
      async (
        _label: string,
        rows: Map<string, ResourceAiAgent>,
        configuredAt: Date | null,
      ) => {
        agentLookup.mockResolvedValue(rows);
        resourceLookup.mockResolvedValue([
          resource({ aiAccessConfiguredAt: configuredAt }),
        ]);

        await runUpdate(
          { isAiInvestigationEnabled: false },
          propsWith(Permission.ProjectAdmin),
        );

        expect(markedConfigured()).toBe(true);
      },
    );

    it("fails closed: when the agents cannot be read, a change is refused", async () => {
      agentLookup.mockRejectedValue(new Error("database is down"));

      expect(
        await refusalOf(
          { isAiInvestigationEnabled: false },
          masterAdminProps(),
        ),
      ).toBe(
        getAgentSetResourceAiAccessRefusal({
          resourceType: wiring.resourceType,
          source: "agent_configuration",
        }),
      );
      expect(
        JSON.stringify(
          (logger.error as unknown as jest.SpyInstance).mock.calls,
        ),
      ).toContain("could not read where the AI settings");
    });

    it("reads the agent rows of the resources the write reaches, in their project", async () => {
      await refusalOf(
        { isAiInvestigationEnabled: true },
        propsWith(Permission.SettingsMember),
      );

      expect(agentLookup).toHaveBeenCalledTimes(1);
      const call: {
        projectId: ObjectID;
        resourceType: AiResourceType;
        resourceIds: Array<ObjectID>;
      } = agentLookup.mock.calls[0]![0] as {
        projectId: ObjectID;
        resourceType: AiResourceType;
        resourceIds: Array<ObjectID>;
      };
      expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(call.resourceType).toBe(wiring.resourceType);
      expect(
        call.resourceIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([RESOURCE_ID.toString()]);
    });
  },
);

describe("getAgentSetResourceAiAccessRefusal", () => {
  it.each(ALL_AI_RESOURCE_TYPES)(
    "%s: says where the settings are set and which variables change them",
    (resourceType: AiResourceType) => {
      const configured: string = getAgentSetResourceAiAccessRefusal({
        resourceType,
        source: "agent_configuration",
      });
      expect(configured).toContain("'s configuration");
      expect(configured).toContain("ONEUPTIME_AI_INVESTIGATION");
      expect(configured).toContain("ONEUPTIME_AI_FIXES");
      expect(configured).toContain("AI agent page");

      const defaults: string = getAgentSetResourceAiAccessRefusal({
        resourceType,
        source: "agent_defaults",
      });
      expect(defaults).toContain("its defaults");
    },
  );

  it("names exactly the two settings an agent sets", () => {
    expect([...AGENT_SET_RESOURCE_AI_ACCESS_KEYS].sort()).toEqual([
      "aiRemediationMode",
      "isAiInvestigationEnabled",
    ]);
  });
});

describe("ResourceAiAccessService.buildStatus: where the settings are set", () => {
  const READY_GATES: ResourceAiAccessProjectGates = {
    isAiEnabled: true,
    hasLlmProvider: true,
    aiBalanceBlocker: null,
  };

  function row(
    overrides: Partial<ResourceAiAccessRow> = {},
  ): ResourceAiAccessRow {
    return {
      resourceType: AiResourceType.DockerHost,
      id: RESOURCE_ID,
      projectId: PROJECT_ID,
      name: "web-1",
      identifier: "web-1",
      isAiInvestigationEnabled: false,
      aiRemediationMode: ResourceAiRemediationMode.Disabled,
      aiCommandAllowlist: [],
      isArchived: false,
      ...overrides,
    };
  }

  function agent(aiSettings: AgentAiSettings | undefined): ResourceAiAgent {
    return {
      id: ObjectID.generate(),
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
      resourceIdentifier: "web-1",
      agentVersion: "14.2.0",
      connectionStatus: "connected",
      lastAliveAt: OneUptimeDate.getCurrentDate(),
      posture: {
        resourceType: AiResourceType.DockerHost,
        resourceIdentifier: "web-1",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
        ...(aiSettings ? { aiSettings } : {}),
      },
    } as unknown as ResourceAiAgent;
  }

  function gapStep(
    status: ResourceAiAccessStatus,
    code: string,
  ): string | undefined {
    return status.gaps.find((gap: ResourceAiAccessGap) => {
      return gap.code === code;
    })?.nextStep;
  }

  it.each([
    [
      "the agent's configuration",
      agent(CONFIGURED),
      undefined,
      "agent_configuration",
    ],
    ["the agent's defaults", agent(DEFAULTS), undefined, "agent_defaults"],
    [
      "an operator's earlier choice over the defaults",
      agent(DEFAULTS),
      new Date("2026-01-01T00:00:00Z"),
      "oneuptime",
    ],
    [
      "an agent too old to report them",
      agent(undefined),
      undefined,
      "oneuptime",
    ],
    ["no agent", null, undefined, "oneuptime"],
  ])(
    "%s",
    (
      _label: string,
      agentRow: ResourceAiAgent | null,
      configuredAt: Date | undefined,
      expected: string,
    ) => {
      const status: ResourceAiAccessStatus =
        ResourceAiAccessService.buildStatus({
          resource: row({ aiAccessConfiguredAt: configuredAt }),
          agentRow,
          gates: READY_GATES,
        });

      expect(status.aiSettingsSource).toBe(expected);
    },
  );

  it("set by the agent, the off gaps name its variables", () => {
    const status: ResourceAiAccessStatus = ResourceAiAccessService.buildStatus({
      resource: row(),
      agentRow: agent({
        investigation: false,
        fixes: "Disabled",
        isConfigured: true,
      }),
      gates: READY_GATES,
    });

    expect(gapStep(status, "investigation_disabled")).toContain(
      "ONEUPTIME_AI_INVESTIGATION=true",
    );
    expect(gapStep(status, "remediation_disabled")).toContain(
      "ONEUPTIME_AI_FIXES",
    );
    expect(gapStep(status, "remediation_disabled")).toContain(
      "ONEUPTIME_AI_ALLOW_WRITES=true",
    );
  });

  it("set in OneUptime, the off gaps name the page's switches, as before", () => {
    const status: ResourceAiAccessStatus = ResourceAiAccessService.buildStatus({
      resource: row(),
      agentRow: agent(undefined),
      gates: READY_GATES,
    });

    expect(gapStep(status, "investigation_disabled")).toContain(
      "Turn on AI investigation",
    );
    expect(gapStep(status, "remediation_disabled")).toContain('Set "Fixes" to');
  });
});
