import KubernetesClusterService, {
  AGENT_SET_AI_ACCESS_KEYS,
  getAgentSetAiAccessRefusal,
} from "../../../Server/Services/KubernetesClusterService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import RunnerService from "../../../Server/Services/RunnerService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner from "../../../Models/DatabaseModels/Runner";
import { AgentAiSettings } from "../../../Types/AI/AgentAiSettings";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * "This particular thing should be synced with the agent, and I should not
 * be able to manually edit it."
 *
 * While a cluster's Kubernetes AI agent sets investigation and fixes — its
 * chart names aiAgent.investigation / aiAgent.fixes (agent_configuration),
 * or nobody chose them and the agent's defaults apply (agent_defaults) —
 * KubernetesClusterService refuses an operator's change to either, from the
 * AI agent page, the API or Terraform alike, master admins included: the
 * question is where the setting lives, not who may change it. Everything
 * else stays as it was:
 *
 *  - re-posting the value the cluster has is no change (Terraform and the
 *    page post every field);
 *  - the kubectl allowlist and the Runner binding stay OneUptime's;
 *  - a cluster whose agent reports nothing (older than these settings), a
 *    cluster an operator configured while its agent uses its defaults, and
 *    a cluster bound to a Runner an operator chose keep OneUptime's
 *    settings, editable as before;
 *  - the server's own (root) writes are never refused — that is how the
 *    agent's settings reach the cluster;
 *  - when the agents cannot be read, a change is refused (fail closed);
 *  - a write on an agent-set cluster marks nothing configured, so the
 *    agent's defaults keep deciding;
 *  - clearing the Runner binding hands the cluster back to its agent, whose
 *    reported settings apply at once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
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
    updateBy: UpdateBy<KubernetesCluster>,
  ) => Promise<OnUpdate<KubernetesCluster>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<KubernetesCluster>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<KubernetesCluster>>;
};

function hooks(): Hooks {
  return KubernetesClusterService as unknown as Hooks;
}

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

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true } as DatabaseCommonInteractionProps;
}

// The callers a refusal applies to: everyone but the server itself.
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
  [
    "a Project Owner",
    (): DatabaseCommonInteractionProps => {
      return propsWith(Permission.ProjectOwner);
    },
  ],
  ["a master admin", masterAdminProps],
];

function updateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
  query: Record<string, unknown> = { _id: CLUSTER_ID.toString() },
): UpdateBy<KubernetesCluster> {
  return {
    query,
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<KubernetesCluster>;
}

function cluster(
  overrides: Record<string, unknown> = {},
  id: ObjectID = CLUSTER_ID,
): KubernetesCluster {
  return {
    id,
    projectId: PROJECT_ID,
    clusterIdentifier: "prod-us",
    // What the agent's settings put there.
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    aiKubectlCommandAllowlist: null,
    aiAccessRunnerId: null,
    aiAccessCredentialId: null,
    aiAccessConfiguredAt: null,
    ...overrides,
  } as unknown as KubernetesCluster;
}

function agentReporting(
  aiSettings: AgentAiSettings | undefined,
  clusterId: ObjectID = CLUSTER_ID,
): KubernetesAiAgent {
  return {
    id: ObjectID.generate(),
    projectId: PROJECT_ID,
    kubernetesClusterId: clusterId,
    posture: {
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: true,
      ...(aiSettings ? { aiSettings } : {}),
    },
  } as unknown as KubernetesAiAgent;
}

function agents(
  ...rows: Array<KubernetesAiAgent>
): Map<string, KubernetesAiAgent> {
  return new Map<string, KubernetesAiAgent>(
    rows.map((row: KubernetesAiAgent): [string, KubernetesAiAgent] => {
      return [row.kubernetesClusterId!.toString(), row];
    }),
  );
}

function advancedRunner(): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: "ops-runner",
    hostInfo: {},
  } as unknown as Runner;
}

let clusterLookup: jest.SpyInstance;
let agentLookup: jest.SpyInstance;
let boundRunnerLookup: jest.SpyInstance;
let markerWrite: jest.SpyInstance;
let applyStored: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  clusterLookup = jest
    .spyOn(KubernetesClusterService, "findBy")
    .mockResolvedValue([cluster()]);
  agentLookup = jest
    .spyOn(KubernetesAiAgentService, "findForClusters")
    .mockResolvedValue(agents(agentReporting(CONFIGURED)));
  boundRunnerLookup = jest
    .spyOn(RunnerService, "findBy")
    .mockResolvedValue([advancedRunner()]);
  jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(advancedRunner());
  markerWrite = jest
    .spyOn(KubernetesClusterService, "updateBy")
    .mockResolvedValue(1);
  applyStored = jest
    .spyOn(KubernetesAiAgentService, "applyStoredAiSettingsToCluster")
    .mockResolvedValue(null);
  // The feed writers are not what this file is about.
  jest
    .spyOn(
      KubernetesClusterService as unknown as {
        writeAiAccessSettingsChangedFeed: () => Promise<void>;
      },
      "writeAiAccessSettingsChangedFeed",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(
      KubernetesClusterService as unknown as {
        writeKubernetesClusterUpdatedFeed: () => Promise<void>;
      },
      "writeKubernetesClusterUpdatedFeed",
    )
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

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
  const onUpdate: OnUpdate<KubernetesCluster> = await hooks().onBeforeUpdate(
    updateBy(data, props),
  );
  await hooks().onUpdateSuccess(onUpdate, [CLUSTER_ID]);
}

function markedConfigured(): boolean {
  return markerWrite.mock.calls.some((call: Array<unknown>) => {
    const write: { data: Record<string, unknown> } = call[0] as {
      data: Record<string, unknown>;
    };
    return Boolean(write.data["aiAccessConfiguredAt"]);
  });
}

// Changes to the two settings the agent sets, from the cluster above.
const CHANGES: Array<[string, Record<string, unknown>]> = [
  ["turn investigation off", { isAiInvestigationEnabled: false }],
  [
    "turn fixes down to Ask for approval",
    { aiRemediationMode: KubernetesAiRemediationMode.RequireApproval },
  ],
  [
    "turn fixes off",
    { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
  ],
  [
    "turn fixes up to Bypass approval",
    { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
  ],
  [
    "change both",
    {
      isAiInvestigationEnabled: false,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    },
  ],
];

describe("a cluster whose agent's configuration sets investigation and fixes", () => {
  describe.each(CALLERS)(
    "%s",
    (_caller: string, props: () => DatabaseCommonInteractionProps) => {
      it.each(CHANGES)(
        "may not %s here",
        async (_label: string, data: Record<string, unknown>) => {
          expect(await refusalOf(data, props())).toBe(
            getAgentSetAiAccessRefusal("agent_configuration"),
          );
        },
      );
    },
  );

  it("the refusal says where the settings are set and where the command is", () => {
    const refusal: string = getAgentSetAiAccessRefusal("agent_configuration");
    expect(refusal).toContain("Kubernetes AI agent's configuration");
    expect(refusal).toContain("aiAgent.investigation and aiAgent.fixes");
    expect(refusal).toContain("AI → Agent");
  });

  it("re-posting the values the cluster has is no change (Terraform and the page post every field)", async () => {
    expect(
      await refusalOf(
        {
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        },
        propsWith(Permission.SettingsMember),
      ),
    ).toBeNull();
  });

  it("the kubectl allowlist stays OneUptime's", async () => {
    expect(
      await refusalOf(
        { aiKubectlCommandAllowlist: ["kubectl rollout restart * -n web"] },
        propsWith(Permission.ProjectAdmin),
      ),
    ).toBeNull();
  });

  it("an accepted write marks nothing configured, so the agent keeps deciding", async () => {
    await runUpdate(
      {
        aiKubectlCommandAllowlist: ["kubectl rollout restart * -n web"],
        isAiInvestigationEnabled: true,
      },
      propsWith(Permission.ProjectAdmin),
    );

    expect(markedConfigured()).toBe(false);
  });

  it("the server's own (root) writes are never refused — that is how the agent's settings land", async () => {
    await expect(
      hooks().onBeforeUpdate(
        updateBy({ isAiInvestigationEnabled: false }, rootProps()),
      ),
    ).resolves.toBeDefined();
    expect(agentLookup).not.toHaveBeenCalled();
  });

  it("a write reaching several clusters is refused when it changes one the agent sets", async () => {
    clusterLookup.mockResolvedValue([
      cluster({}, CLUSTER_ID),
      cluster({}, OTHER_CLUSTER_ID),
    ]);
    agentLookup.mockResolvedValue(agents(agentReporting(CONFIGURED)));

    await expect(
      hooks().onBeforeUpdate(
        updateBy(
          { isAiInvestigationEnabled: false },
          propsWith(Permission.ProjectAdmin),
          { projectId: PROJECT_ID },
        ),
      ),
    ).rejects.toThrow(getAgentSetAiAccessRefusal("agent_configuration"));
  });
});

describe("a cluster whose agent's defaults decide", () => {
  beforeEach(() => {
    agentLookup.mockResolvedValue(agents(agentReporting(DEFAULTS)));
  });

  it.each(CHANGES)(
    "a Project Admin may not %s here either",
    async (_label: string, data: Record<string, unknown>) => {
      expect(await refusalOf(data, propsWith(Permission.ProjectAdmin))).toBe(
        getAgentSetAiAccessRefusal("agent_defaults"),
      );
    },
  );

  it("the refusal says the defaults apply because the chart names neither setting", () => {
    const refusal: string = getAgentSetAiAccessRefusal("agent_defaults");
    expect(refusal).toContain("its defaults");
    expect(refusal).toContain(
      "sets neither aiAgent.investigation nor aiAgent.fixes",
    );
  });

  it("an accepted write marks nothing configured, so the defaults keep deciding", async () => {
    await runUpdate(
      { aiKubectlCommandAllowlist: [] },
      propsWith(Permission.SettingsMember),
    );

    expect(markedConfigured()).toBe(false);
  });
});

describe("clusters whose settings stay OneUptime's", () => {
  const CASES: Array<[string, () => void, Partial<Record<string, unknown>>?]> =
    [
      [
        "no Kubernetes AI agent",
        (): void => {
          agentLookup.mockResolvedValue(agents());
        },
      ],
      [
        "an agent too old to report its settings",
        (): void => {
          agentLookup.mockResolvedValue(agents(agentReporting(undefined)));
        },
      ],
      [
        "an agent on its defaults where an operator already chose the settings",
        (): void => {
          agentLookup.mockResolvedValue(agents(agentReporting(DEFAULTS)));
          clusterLookup.mockResolvedValue([
            cluster({ aiAccessConfiguredAt: new Date("2026-01-01T00:00:00Z") }),
          ]);
        },
      ],
      [
        "a cluster bound to a Runner an operator chose",
        (): void => {
          clusterLookup.mockResolvedValue([
            cluster({ aiAccessRunnerId: RUNNER_ID }),
          ]);
        },
      ],
    ];

  it.each(CASES)(
    "%s: a Project Admin may change investigation and fixes, and the write marks the cluster configured",
    async (_label: string, arrange: () => void) => {
      arrange();

      await runUpdate(
        {
          isAiInvestigationEnabled: false,
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        },
        propsWith(Permission.ProjectAdmin),
      );

      expect(markedConfigured()).toBe(true);
    },
  );

  it("a cluster bound to a Runner reads that Runner once, in its project", async () => {
    clusterLookup.mockResolvedValue([cluster({ aiAccessRunnerId: RUNNER_ID })]);

    await refusalOf(
      { isAiInvestigationEnabled: false },
      propsWith(Permission.ProjectAdmin),
    );

    expect(boundRunnerLookup).toHaveBeenCalledTimes(1);
    const query: Record<string, unknown> = (
      boundRunnerLookup.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["projectId"]!.toString()).toBe(PROJECT_ID.toString());
  });

  it("the chart's own previous Runner is no operator's choice: the agent still decides", async () => {
    clusterLookup.mockResolvedValue([cluster({ aiAccessRunnerId: RUNNER_ID })]);
    boundRunnerLookup.mockResolvedValue([
      {
        id: RUNNER_ID,
        _id: RUNNER_ID.toString(),
        name: "kubernetes-agent/prod-us",
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
        } as unknown as JSONObject,
      } as unknown as Runner,
    ]);

    expect(
      await refusalOf(
        { isAiInvestigationEnabled: false },
        propsWith(Permission.ProjectAdmin),
      ),
    ).toBe(getAgentSetAiAccessRefusal("agent_configuration"));
  });
});

describe("when the agents cannot be read", () => {
  beforeEach(() => {
    agentLookup.mockRejectedValue(new Error("database is down"));
  });

  it("a change to investigation or fixes is refused, even for a master admin", async () => {
    expect(
      await refusalOf({ isAiInvestigationEnabled: false }, masterAdminProps()),
    ).toBe(getAgentSetAiAccessRefusal("agent_configuration"));
  });

  it("re-posting the values the cluster has still passes", async () => {
    expect(
      await refusalOf(
        {
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        },
        propsWith(Permission.ProjectAdmin),
      ),
    ).toBeNull();
  });

  it("the failure is logged", async () => {
    await refusalOf(
      { isAiInvestigationEnabled: false },
      propsWith(Permission.ProjectAdmin),
    );

    expect(
      JSON.stringify((logger.error as unknown as jest.SpyInstance).mock.calls),
    ).toContain("could not read the Kubernetes AI agents");
  });
});

describe("clearing the Runner binding hands the cluster back to its agent", () => {
  beforeEach(() => {
    clusterLookup.mockResolvedValue([cluster({ aiAccessRunnerId: RUNNER_ID })]);
  });

  it("applies the agent's reported settings at once", async () => {
    await runUpdate(
      { aiAccessRunnerId: null },
      propsWith(Permission.ProjectAdmin),
    );

    expect(applyStored).toHaveBeenCalledTimes(1);
    const call: { projectId: ObjectID; kubernetesClusterId: ObjectID } =
      applyStored.mock.calls[0]![0] as {
        projectId: ObjectID;
        kubernetesClusterId: ObjectID;
      };
    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.kubernetesClusterId.toString()).toBe(CLUSTER_ID.toString());
  });

  it("negative control: binding a Runner, or clearing only the credential, does not", async () => {
    await runUpdate(
      { aiAccessRunnerId: RUNNER_ID },
      propsWith(Permission.ProjectAdmin),
    );
    await runUpdate(
      { aiAccessCredentialId: null },
      propsWith(Permission.ProjectAdmin),
    );

    expect(applyStored).not.toHaveBeenCalled();
  });
});

describe("AGENT_SET_AI_ACCESS_KEYS", () => {
  it("names exactly the two settings an agent sets", () => {
    expect([...AGENT_SET_AI_ACCESS_KEYS].sort()).toEqual([
      "aiRemediationMode",
      "isAiInvestigationEnabled",
    ]);
  });
});
