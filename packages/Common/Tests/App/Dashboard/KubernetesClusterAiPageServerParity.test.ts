import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  KubernetesAiAccessOfferedFields,
  KubernetesAiAccessSavedSettings,
  KubernetesAiAccessSettingsFormValues,
  getKubernetesAiAccessLooseningChanges,
  getKubernetesAiAccessOfferedFields,
  getKubernetesAiAccessSettingsChanges,
  getKubernetesAiAccessSettingsInitialValues,
  isRemediationModeOpenToEveryEditor,
  validateKubectlAllowlistText,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSettings";
import {
  AI_AGENT_GONE_TEXT,
  AI_AGENT_SIGNED_OFF_TEXT,
  AI_AGENT_SILENT_TEXT,
  AiAgentAttention,
  AiAgentAttentionStep,
  canSwitchToAiAgent,
  getAiAgentAttention,
  getAiAgentCardCommand,
  getAiAgentCardState,
  getAiAgentGapAction,
  getAiAgentMetaParts,
  getAiAgentOfflineReason,
  getAiAgentOverviewState,
  getAiAgentPodNamespace,
  getAiAgentStateSentence,
  getAiAgentSummary,
  getAttentionGaps,
  getAutomaticInvestigation,
  isAdvancedRunnerTarget,
  isLegacyRunnerTarget,
  parseStatus,
  shouldShowWriteAccessCommands,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import { isKubernetesAgentRunnerRow } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAgentRunner";
import {
  RunnerFormRestrictions,
  getReservedRunnerNameError,
  getRunnerFormFields,
  getRunnerFormRestrictions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/RunnerFormFields";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService, {
  AI_AGENT_INSTALL_COMMAND,
  CLUSTER_AI_AGENT_PAGE,
  KubernetesClusterAiAccessProjectGates,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService, {
  normalizeKubectlAllowlistForWrite,
} from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService, {
  Service as RunnerServiceClass,
} from "../../../Server/Services/RunnerService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";

/*
 * The AI agent page against the server it talks to — run for real, with
 * only the database stubbed:
 *
 * - who may loosen: the page's rule (getKubernetesAiAccessLooseningChanges)
 *   gives the verdict KubernetesClusterService's write hook gives, for the
 *   same saved settings, the same change and the same answer to "does this
 *   cluster have a Kubernetes AI agent?" — Off -> Ask for approval and
 *   clearing a binding while an agent exists included;
 * - the status the real service computes drives the page's card: every
 *   state of the "Kubernetes AI agent" card, the Needs attention item (one
 *   headline, a step per gap in this page's words), the write-access
 *   commands and the Overview card, from the real resolution of the access
 *   target;
 * - the page's allowlist validation agrees with the server's;
 * - the Runner pages and RunnerService agree on which rows are the chart's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_RUNNER_ID: string = "77777777-7777-4777-8777-777777777777";
const CREDENTIAL_ID: string = "55555555-5555-4555-8555-555555555555";
const OTHER_CREDENTIAL_ID: string = "88888888-8888-4888-8888-888888888888";
const AGENT_ID: string = "99999999-9999-4999-8999-999999999990";

const SET_IMAGE_PATTERN: string = "kubectl set image deployment/web * -n web";
const PATCH_PATTERN: string = "kubectl patch deployment/web -n web -p *";
const ODDLY_SPACED_PATTERN: string =
  "kubectl  scale   deployment/web --replicas=* -n web";

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
  automaticInvestigation: { incidents: true, alerts: false },
};

type Hooks = {
  onBeforeUpdate: (
    updateBy: UpdateBy<KubernetesCluster>,
  ) => Promise<OnUpdate<KubernetesCluster>>;
};

function hooks(): Hooks {
  return KubernetesClusterService as unknown as Hooks;
}

// A cluster editor who does not hold the admin set.
function memberProps(): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
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
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

interface StoredSettings {
  aiRemediationMode: KubernetesAiRemediationMode;
  aiKubectlCommandAllowlist: unknown;
  aiAccessRunnerId: string | null;
  aiAccessCredentialId: string | null;
  hasAiAgent: boolean;
}

// A cluster bound to an advanced Runner, with no AI agent unless said.
function stored(overrides: Partial<StoredSettings> = {}): StoredSettings {
  return {
    aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, PATCH_PATTERN],
    aiAccessRunnerId: RUNNER_ID,
    aiAccessCredentialId: null,
    hasAiAgent: false,
    ...overrides,
  };
}

// The same saved settings as the page reads them.
function asPageSaved(
  settings: StoredSettings,
): KubernetesAiAccessSavedSettings {
  return {
    isAiInvestigationEnabled: true,
    aiRemediationMode: settings.aiRemediationMode,
    aiKubectlCommandAllowlist: settings.aiKubectlCommandAllowlist,
    aiAccessRunnerId: settings.aiAccessRunnerId,
    aiAccessRunnerName: settings.aiAccessRunnerId ? "bash-runner" : null,
    aiAccessCredentialId: settings.aiAccessCredentialId,
    aiAccessCredentialName: settings.aiAccessCredentialId ? "prod token" : null,
  };
}

function makeAgentRow(
  overrides: Record<string, unknown> = {},
): KubernetesAiAgent {
  return Object.assign(new KubernetesAiAgent(), {
    id: new ObjectID(AGENT_ID),
    _id: AGENT_ID,
    projectId: PROJECT_ID,
    kubernetesClusterId: CLUSTER_ID,
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    lastRegisteredAt: OneUptimeDate.getCurrentDate(),
    agentVersion: "14.1.0",
    posture: {
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: false,
      writeNamespaces: [],
      podNamespace: "monitoring",
      kubectlVersion: "v1.31.2",
    },
    ...overrides,
  });
}

/*
 * Serves `settings` as the cluster the server's write hook reads first,
 * and answers "which of these clusters has an AI agent?" the same way.
 */
function serveStoredCluster(settings: StoredSettings): void {
  jest.spyOn(KubernetesClusterService, "findBy").mockResolvedValue([
    {
      id: CLUSTER_ID,
      _id: CLUSTER_ID.toString(),
      projectId: PROJECT_ID,
      isAiInvestigationEnabled: true,
      aiRemediationMode: settings.aiRemediationMode,
      aiKubectlCommandAllowlist: settings.aiKubectlCommandAllowlist,
      aiAccessRunnerId: settings.aiAccessRunnerId
        ? new ObjectID(settings.aiAccessRunnerId)
        : null,
      aiAccessCredentialId: settings.aiAccessCredentialId
        ? new ObjectID(settings.aiAccessCredentialId)
        : null,
    } as unknown as KubernetesCluster,
  ]);

  const agents: Map<string, KubernetesAiAgent> = new Map<
    string,
    KubernetesAiAgent
  >();
  if (settings.hasAiAgent) {
    agents.set(CLUSTER_ID.toString(), makeAgentRow());
  }
  jest
    .spyOn(KubernetesAiAgentService, "findForClusters")
    .mockResolvedValue(agents);
  jest
    .spyOn(KubernetesAiAgentService, "findForCluster")
    .mockResolvedValue(settings.hasAiAgent ? makeAgentRow() : null);
}

// Does the server refuse this write to a cluster editor as loosening?
async function serverSaysLoosens(
  settings: StoredSettings,
  changes: JSONObject,
): Promise<boolean> {
  serveStoredCluster(settings);

  try {
    await hooks().onBeforeUpdate({
      query: { _id: CLUSTER_ID.toString() },
      data: JSON.parse(JSON.stringify(changes)),
      limit: 1,
      skip: 0,
      props: memberProps(),
    } as unknown as UpdateBy<KubernetesCluster>);
    return false;
  } catch (err) {
    if (err instanceof NotAuthorizedException) {
      return true;
    }
    throw err;
  }
}

function pageSaysLoosens(
  settings: StoredSettings,
  changes: JSONObject,
): boolean {
  return (
    getKubernetesAiAccessLooseningChanges({
      saved: asPageSaved(settings),
      changes,
      hasAiAgent: settings.hasAiAgent,
    }).length > 0
  );
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(RunnerService, "findOneBy")
    .mockResolvedValue({ id: new ObjectID(RUNNER_ID) } as unknown as Runner);
  jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
    id: new ObjectID(CREDENTIAL_ID),
    credentialType: RunbookCredentialType.Kubernetes,
    name: "prod token",
    runners: [{ _id: RUNNER_ID, id: new ObjectID(RUNNER_ID) }],
  } as unknown as RunbookCredential);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may loosen: the page and the server agree", () => {
  const CASES: Array<{
    name: string;
    settings: StoredSettings;
    changes: JSONObject;
  }> = [
    {
      name: "Bypass approval -> Automatic",
      settings: stored({
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
      changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
    },
    {
      name: "Automatic -> Bypass approval",
      settings: stored(),
      changes: {
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      },
    },
    {
      name: "Off -> Automatic",
      settings: stored({
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
      changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
    },
    // Regression (§11): turning fixes on at all needs the admin set.
    {
      name: "Off -> Ask for approval",
      settings: stored({
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
      changes: {
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      },
    },
    {
      name: "Off -> Ask for approval on a cluster with an AI agent",
      settings: stored({
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        aiAccessRunnerId: null,
        hasAiAgent: true,
      }),
      changes: {
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      },
    },
    {
      name: "Automatic -> Ask for approval",
      settings: stored(),
      changes: {
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      },
    },
    {
      name: "Ask for approval -> Off",
      settings: stored({
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
      changes: { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
    },
    {
      name: "re-send the saved mode",
      settings: stored(),
      changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
    },
    {
      name: "drop one of two patterns",
      settings: stored(),
      changes: { aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN] },
    },
    {
      name: "clear the allowlist",
      settings: stored(),
      changes: { aiKubectlCommandAllowlist: [] },
    },
    {
      name: "add a pattern",
      settings: stored(),
      changes: {
        aiKubectlCommandAllowlist: [
          SET_IMAGE_PATTERN,
          PATCH_PATTERN,
          "kubectl delete pod * -n web",
        ],
      },
    },
    {
      name: "edit a pattern into another",
      settings: stored(),
      changes: {
        aiKubectlCommandAllowlist: [
          "kubectl set image deployment/web * -n prod",
          PATCH_PATTERN,
        ],
      },
    },
    {
      name: "keep a pattern stored with odd spacing, in its stored spelling",
      settings: stored({
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, ODDLY_SPACED_PATTERN],
      }),
      changes: { aiKubectlCommandAllowlist: [ODDLY_SPACED_PATTERN] },
    },
    {
      name: "clear an allowlist stored as a plain string",
      settings: stored({ aiKubectlCommandAllowlist: SET_IMAGE_PATTERN }),
      changes: { aiKubectlCommandAllowlist: [] },
    },
    {
      name: "unbind the Runner of a cluster without an AI agent",
      settings: stored(),
      changes: { aiAccessRunnerId: null },
    },
    // Regression (§11): with an agent, clearing hands the cluster to it.
    {
      name: "unbind the Runner of a cluster with an AI agent",
      settings: stored({ hasAiAgent: true }),
      changes: { aiAccessRunnerId: null },
    },
    {
      name: "unbind the Runner and credential of a cluster with an AI agent",
      settings: stored({
        aiAccessCredentialId: CREDENTIAL_ID,
        hasAiAgent: true,
      }),
      changes: { aiAccessRunnerId: null, aiAccessCredentialId: null },
    },
    {
      name: "unbind the credential of a cluster with an AI agent",
      settings: stored({
        aiAccessCredentialId: CREDENTIAL_ID,
        hasAiAgent: true,
      }),
      changes: { aiAccessCredentialId: null },
    },
    {
      name: "unbind the credential of a cluster without an AI agent",
      settings: stored({ aiAccessCredentialId: CREDENTIAL_ID }),
      changes: { aiAccessCredentialId: null },
    },
    {
      name: "bind another Runner",
      settings: stored(),
      changes: { aiAccessRunnerId: OTHER_RUNNER_ID },
    },
    {
      name: "re-send the bound Runner",
      settings: stored({ hasAiAgent: true }),
      changes: { aiAccessRunnerId: RUNNER_ID },
    },
    {
      name: "bind a credential",
      settings: stored(),
      changes: { aiAccessCredentialId: CREDENTIAL_ID },
    },
    {
      name: "bind another credential",
      settings: stored({ aiAccessCredentialId: CREDENTIAL_ID }),
      changes: { aiAccessCredentialId: OTHER_CREDENTIAL_ID },
    },
    {
      name: "turn investigation off",
      settings: stored({ hasAiAgent: true }),
      changes: { isAiInvestigationEnabled: false },
    },
    {
      name: "turn investigation on",
      settings: stored({ hasAiAgent: true }),
      changes: { isAiInvestigationEnabled: true },
    },
  ];

  test("harness guard: the server refuses a member's loosening and accepts their tightening", async () => {
    expect(
      await serverSaysLoosens(stored(), {
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    ).toBe(true);
    expect(
      await serverSaysLoosens(stored(), {
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
    ).toBe(false);
  });

  for (const testCase of CASES) {
    test(testCase.name, async () => {
      expect({
        page: pageSaysLoosens(testCase.settings, testCase.changes),
      }).toEqual({
        page: await serverSaysLoosens(testCase.settings, testCase.changes),
      });
    });
  }

  // The modes the modal offers a member are exactly the ones the server accepts.
  test("the modes offered to a member are the ones the server lets them save", async () => {
    for (const savedMode of Object.values(KubernetesAiRemediationMode)) {
      for (const mode of Object.values(KubernetesAiRemediationMode)) {
        if (mode === savedMode) {
          continue;
        }
        const settings: StoredSettings = stored({
          aiRemediationMode: savedMode,
        });
        expect({
          savedMode,
          mode,
          offered: isRemediationModeOpenToEveryEditor(mode, savedMode),
        }).toEqual({
          savedMode,
          mode,
          offered: !(await serverSaysLoosens(settings, {
            aiRemediationMode: mode,
          })),
        });
      }
    }
  });
});

/*
 * What a cluster editor without the admin set does through the form —
 * form values in, the update the page would send out — is accepted by the
 * server and not refused by the page first.
 */
describe("a cluster editor's tightening through the form is accepted end to end", () => {
  const MEMBER_EDITS: Array<{
    name: string;
    settings: StoredSettings;
    edits: Record<string, unknown>;
    expected: JSONObject;
  }> = [
    {
      name: "steps down from Bypass approval to Automatic",
      settings: stored({
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        hasAiAgent: true,
      }),
      edits: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
      expected: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
    },
    {
      name: "turns fixes off",
      settings: stored({ hasAiAgent: true }),
      edits: { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
      expected: { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
    },
    {
      name: "removes a pattern",
      settings: stored(),
      edits: { kubectlAllowlistText: PATCH_PATTERN },
      expected: { aiKubectlCommandAllowlist: [PATCH_PATTERN] },
    },
    {
      name: "removes a pattern next to one stored with odd spacing",
      settings: stored({
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, ODDLY_SPACED_PATTERN],
      }),
      edits: {
        kubectlAllowlistText:
          "kubectl scale deployment/web --replicas=* -n web",
      },
      expected: { aiKubectlCommandAllowlist: [ODDLY_SPACED_PATTERN] },
    },
    {
      name: "clears the allowlist",
      settings: stored(),
      edits: { kubectlAllowlistText: "" },
      expected: { aiKubectlCommandAllowlist: [] },
    },
    {
      name: "unbinds the Runner and the credential of a cluster without an AI agent",
      settings: stored({ aiAccessCredentialId: CREDENTIAL_ID }),
      edits: { clearAiAccessRunner: true, clearAiAccessCredential: true },
      expected: { aiAccessRunnerId: null, aiAccessCredentialId: null },
    },
  ];

  for (const edit of MEMBER_EDITS) {
    test(edit.name, async () => {
      const saved: KubernetesAiAccessSavedSettings = asPageSaved(edit.settings);
      const offered: KubernetesAiAccessOfferedFields =
        getKubernetesAiAccessOfferedFields({
          saved,
          canConfigureUnattended: false,
          isRunnerPickerAvailable: false,
          isCredentialPickerAvailable: false,
          isAdvancedBinding: saved.aiAccessRunnerId !== null,
          hasAiAgent: edit.settings.hasAiAgent,
        });
      const changes: JSONObject = getKubernetesAiAccessSettingsChanges({
        saved,
        values: {
          ...getKubernetesAiAccessSettingsInitialValues(saved),
          ...edit.edits,
        } as FormValues<KubernetesAiAccessSettingsFormValues>,
        offered,
      });

      expect(changes).toEqual(edit.expected);
      expect(
        getKubernetesAiAccessLooseningChanges({
          saved,
          changes,
          hasAiAgent: edit.settings.hasAiAgent,
        }),
      ).toEqual([]);
      expect(await serverSaysLoosens(edit.settings, changes)).toBe(false);
    });
  }

  /*
   * The unbind switch is gone for a member once the cluster has an agent
   * — and the server would refuse the write it used to send.
   */
  test("a member is not offered the unbind the server would refuse", async () => {
    const settings: StoredSettings = stored({
      aiAccessCredentialId: CREDENTIAL_ID,
      hasAiAgent: true,
    });
    const offered: KubernetesAiAccessOfferedFields =
      getKubernetesAiAccessOfferedFields({
        saved: asPageSaved(settings),
        canConfigureUnattended: false,
        isRunnerPickerAvailable: false,
        isCredentialPickerAvailable: false,
        isAdvancedBinding: true,
        hasAiAgent: true,
      });

    expect(offered.runnerClear).toBe(false);
    expect(offered.credentialClear).toBe(false);
    expect(
      await serverSaysLoosens(settings, {
        aiAccessRunnerId: null,
        aiAccessCredentialId: null,
      }),
    ).toBe(true);
  });
});

function fakeCluster(
  overrides: Record<string, unknown> = {},
): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: undefined,
    aiAccessCredentialId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    aiKubectlCommandAllowlist: undefined,
    ...overrides,
  } as unknown as KubernetesCluster;
}

// The chart's previous in-cluster Runner of this cluster.
function fakeLegacyRunner(overrides: Record<string, unknown> = {}): Runner {
  return {
    id: new ObjectID(RUNNER_ID),
    _id: RUNNER_ID,
    name: "kubernetes-agent/prod-us",
    lastAlive: OneUptimeDate.getCurrentDate(),
    canRunAiCommands: true,
    hostInfo: {
      kubernetes: {
        inCluster: true,
        allowWrites: false,
        clusterIdentifier: "prod-us",
      },
    },
    ...overrides,
  } as unknown as Runner;
}

// A Runner an operator created, outside the chart.
function fakeAdvancedRunner(overrides: Record<string, unknown> = {}): Runner {
  return {
    id: new ObjectID(OTHER_RUNNER_ID),
    _id: OTHER_RUNNER_ID,
    name: "bash-runner",
    lastAlive: OneUptimeDate.getCurrentDate(),
    canRunAiCommands: true,
    hostInfo: {},
    ...overrides,
  } as unknown as Runner;
}

async function realStatus(data: {
  cluster: KubernetesCluster;
  runner?: Runner | null;
  agentRow?: KubernetesAiAgent | null;
  gates?: KubernetesClusterAiAccessProjectGates;
}): Promise<KubernetesClusterAiAccessStatus> {
  jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(data.runner || null);
  return await KubernetesClusterAiAccessService.getStatusForClusterModel({
    cluster: data.cluster,
    gates: data.gates || READY_GATES,
    aiAgentRow: data.agentRow ?? null,
  });
}

function gapCodes(status: KubernetesClusterAiAccessStatus): Array<string> {
  return status.gaps.map((gap: KubernetesAiAccessGap): string => {
    return gap.code;
  });
}

/*
 * The gaps a project switch raises (project_ai_disabled, and the retired
 * project_auto_remediation_disabled and
 * project_ai_command_execution_disabled), as the page's Needs attention
 * card lists them.
 */
function projectSwitchGapCodes(
  status: KubernetesClusterAiAccessStatus,
): Array<string> {
  return getAttentionGaps(status)
    .map((gap: KubernetesAiAccessGap): string => {
      return gap.code;
    })
    .filter((code: string): boolean => {
      return code.startsWith("project_");
    });
}

/*
 * The server resolves the access target (agent, previous Runner, advanced
 * Runner, none) and the page reads the result. Each state of the card is
 * checked against what the real status produces for it.
 */
describe("the AI agent card follows the real status", () => {
  test("every status carries the agent and the automatic-investigation opt-ins", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster(),
    });
    expect(status).toHaveProperty("aiAgent", null);
    expect(getAutomaticInvestigation(status)).toEqual({
      incidents: true,
      alerts: false,
    });
  });

  test("nothing installed: the install command, and Needs attention says so", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster(),
    });
    expect(gapCodes(status)).toContain("ai_agent_not_connected");
    expect(getAiAgentCardState(status)).toBe("not_installed");
    expect(getAiAgentCardCommand(status)).toBe("install");
    expect(getAiAgentOverviewState(status).text).toBe("Not installed");
    expect(
      getAttentionGaps(status).map((gap: KubernetesAiAccessGap): string => {
        return gap.code;
      }),
    ).toContain("ai_agent_not_connected");
  });

  /*
   * A default install: the agent connected, read-only, Fixes off. The one
   * server gap is the fixes-off choice, so the page shows no Needs
   * attention card and reads Ready.
   */
  test("the agent online, fixes off: connected, ready, nothing needs attention", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster(),
      agentRow: makeAgentRow(),
    });
    expect(status.runner?.kind).toBe("ai_agent");
    expect(status.accessMethod).toBe("in_cluster");
    expect(getAiAgentSummary(status)?.id).toBe(AGENT_ID);
    expect(getAiAgentCardState(status)).toBe("connected");
    expect(gapCodes(status)).toEqual(["remediation_disabled"]);
    expect(getAttentionGaps(status)).toEqual([]);
    expect(status.isInvestigationReady).toBe(true);
    expect(shouldShowWriteAccessCommands(status)).toBe(false);
    expect(getAiAgentOverviewState(status).text).toBe("Connected");
  });

  test("the agent offline: its logs, in the namespace it reported", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster(),
      agentRow: makeAgentRow({
        lastAliveAt: OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          -30,
        ),
      }),
    });
    expect(gapCodes(status)).toContain("ai_agent_offline");
    expect(getAiAgentCardState(status)).toBe("offline");
    expect(getAiAgentCardCommand(status)).toBe("logs");
    expect(getAiAgentPodNamespace(status)).toBe("monitoring");
    expect(getAiAgentOverviewState(status).text).toBe("Offline");
    // It never signed off: its heartbeats stopped.
    expect(getAiAgentOfflineReason(status)).toBe("silent");
    expect(getAiAgentStateSentence(status)).toBe(AI_AGENT_SILENT_TEXT);
  });

  /*
   * The server's two halves of "offline" (KubernetesAiAgentService.isOnline)
   * are written by its own sign-off and reset. Each is run for real here —
   * only the database write is captured and applied to the row — and the
   * status the real service then computes must read as a sign-off on the
   * page: offline at once, last seen seconds ago, and a sentence that does
   * not claim five silent minutes.
   */
  describe("the agent's own sign-off and an admin's reset", () => {
    function captureWrites(row: KubernetesAiAgent): void {
      jest
        .spyOn(KubernetesAiAgentService, "updateColumnsByIdWithoutHooks")
        .mockImplementation(async (input: unknown): Promise<void> => {
          Object.assign(row, (input as { data: Record<string, unknown> }).data);
        });
      jest
        .spyOn(KubernetesAiAgentService, "updateOneById")
        .mockImplementation(async (input: unknown): Promise<number> => {
          Object.assign(row, (input as { data: Record<string, unknown> }).data);
          return 1;
        });
      jest
        .spyOn(KubernetesAiAgentService, "findForCluster")
        .mockResolvedValue(row);
      jest
        .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(UserService, "getUserMarkdownString")
        .mockResolvedValue("an admin");
      jest.spyOn(logger, "info").mockImplementation((): void => {
        return undefined;
      });
    }

    async function expectSignedOff(row: KubernetesAiAgent): Promise<void> {
      const status: KubernetesClusterAiAccessStatus = await realStatus({
        cluster: fakeCluster(),
        agentRow: row,
      });
      expect(getAiAgentSummary(status)?.connectionStatus).toBe("disconnected");
      expect(getAiAgentCardState(status)).toBe("offline");
      expect(getAiAgentOverviewState(status).text).toBe("Offline");
      expect(getAiAgentOfflineReason(status)).toBe("signed_off");
      expect(getAiAgentStateSentence(status)).toBe(AI_AGENT_SIGNED_OFF_TEXT);
      expect(getAiAgentStateSentence(status)).not.toContain(
        "has not checked in",
      );
      expect(getAiAgentMetaParts(status)[0]).toMatch(/^last seen /);
      expect(getAiAgentCardCommand(status)).toBe("logs");
    }

    test("a clean shutdown (a helm upgrade's old pod) reads as signed off", async () => {
      const row: KubernetesAiAgent = makeAgentRow();
      captureWrites(row);

      await KubernetesAiAgentService.markDisconnected({
        kubernetesAiAgentId: new ObjectID(AGENT_ID),
      });

      await expectSignedOff(row);
    });

    test("Reset agent reads as signed off, not as five silent minutes", async () => {
      const row: KubernetesAiAgent = makeAgentRow();
      captureWrites(row);

      await KubernetesAiAgentService.resetAgent({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        userId: ObjectID.generate(),
      });

      await expectSignedOff(row);
    });

    test("a sign-off it never came back from reads as gone", async () => {
      const status: KubernetesClusterAiAccessStatus = await realStatus({
        cluster: fakeCluster(),
        agentRow: makeAgentRow({
          connectionStatus: "disconnected",
          lastAliveAt: OneUptimeDate.addRemoveMinutes(
            OneUptimeDate.getCurrentDate(),
            -30,
          ),
        }),
      });
      expect(getAiAgentCardState(status)).toBe("offline");
      expect(getAiAgentOfflineReason(status)).toBe("gone");
      expect(getAiAgentStateSentence(status)).toBe(AI_AGENT_GONE_TEXT);
    });
  });

  test("fixes on with a read-only agent: the write-access commands and their gap", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster({
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
      agentRow: makeAgentRow(),
    });
    expect(gapCodes(status)).toContain("remediation_write_access_missing");
    expect(shouldShowWriteAccessCommands(status)).toBe(true);
    // Its action is the commands already on the page.
    expect(
      getAiAgentGapAction(
        status.gaps.find((gap: KubernetesAiAccessGap): boolean => {
          return gap.code === "remediation_write_access_missing";
        })!,
        status,
      ),
    ).toBeNull();
  });

  test("the previous in-cluster Runner, online and bound: works today", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster({ aiAccessRunnerId: new ObjectID(RUNNER_ID) }),
      runner: fakeLegacyRunner(),
    });
    expect(isLegacyRunnerTarget(status)).toBe(true);
    expect(getAiAgentCardState(status)).toBe("legacy_runner");
    expect(getAiAgentCardCommand(status)).toBe("install");
  });

  /*
   * Rolling the chart back (or the seconds of a helm upgrade) leaves the
   * legacy Runner online and the agent offline: the page follows the
   * server to the Runner, not to an agent that is not there.
   */
  test("a rollback: the previous Runner online and the agent offline resolves to the Runner", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster({ aiAccessRunnerId: new ObjectID(RUNNER_ID) }),
      runner: fakeLegacyRunner(),
      agentRow: makeAgentRow({ connectionStatus: "disconnected" }),
    });
    expect(getAiAgentCardState(status)).toBe("legacy_runner");
    expect(getAiAgentSummary(status)?.isOnline).toBe(false);
  });

  test("the agent online wins over the previous Runner bound", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster({ aiAccessRunnerId: new ObjectID(RUNNER_ID) }),
      runner: fakeLegacyRunner(),
      agentRow: makeAgentRow(),
    });
    expect(getAiAgentCardState(status)).toBe("connected");
  });

  test("an advanced Runner wins over an online agent, and can be switched back to it", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster({
        aiAccessRunnerId: new ObjectID(OTHER_RUNNER_ID),
        aiAccessCredentialId: new ObjectID(CREDENTIAL_ID),
      }),
      runner: fakeAdvancedRunner(),
      agentRow: makeAgentRow(),
    });
    expect(isAdvancedRunnerTarget(status)).toBe(true);
    expect(getAiAgentCardState(status)).toBe("advanced_runner");
    expect(canSwitchToAiAgent(status)).toBe(true);
    expect(getAiAgentCardCommand(status)).toBeNull();
  });

  test("project gates become Needs attention rows the page acts on", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster(),
      agentRow: makeAgentRow(),
      gates: {
        ...READY_GATES,
        isAiEnabled: false,
        hasLlmProvider: false,
        aiBalanceBlocker: "The project's AI balance is used up.",
      },
    });
    const actions: Record<string, string | null> = {};
    for (const gap of getAttentionGaps(status)) {
      actions[gap.code] = getAiAgentGapAction(gap, status);
    }
    expect(actions).toEqual({
      project_ai_disabled: "open_ai_features",
      llm_provider_missing: "open_llm_providers",
      ai_balance_insufficient: "open_ai_credits",
    });
  });

  /*
   * Enable AI is the project's only AI switch. A cluster reached through a
   * Runner an operator bound used to need "Enable AI command execution" as
   * well, and every cluster "Enable auto-remediation", each its own Needs
   * attention row. Now, with AI on, the real status puts no project switch
   * on the page at all, and with AI off exactly one row, Enable AI's, which
   * opens AI Features.
   */
  test("a cluster reached through a Runner answers to Enable AI alone", async () => {
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
      id: new ObjectID(CREDENTIAL_ID),
      credentialType: RunbookCredentialType.Kubernetes,
      name: "prod token",
      runners: [{ _id: OTHER_RUNNER_ID, id: new ObjectID(OTHER_RUNNER_ID) }],
    } as unknown as RunbookCredential);
    const cluster: KubernetesCluster = fakeCluster({
      aiAccessRunnerId: new ObjectID(OTHER_RUNNER_ID),
      aiAccessCredentialId: new ObjectID(CREDENTIAL_ID),
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    });

    const aiOn: KubernetesClusterAiAccessStatus = await realStatus({
      cluster,
      runner: fakeAdvancedRunner(),
    });
    expect(isAdvancedRunnerTarget(aiOn)).toBe(true);
    expect(projectSwitchGapCodes(aiOn)).toEqual([]);
    expect(aiOn.isRemediationReady).toBe(true);

    const aiOff: KubernetesClusterAiAccessStatus = await realStatus({
      cluster,
      runner: fakeAdvancedRunner(),
      gates: { ...READY_GATES, isAiEnabled: false },
    });
    expect(projectSwitchGapCodes(aiOff)).toEqual(["project_ai_disabled"]);
    expect(aiOff.isRemediationReady).toBe(false);
    expect(aiOff.isInvestigationReady).toBe(false);
    for (const gap of getAttentionGaps(aiOff)) {
      if (gap.code === "project_ai_disabled") {
        expect(getAiAgentGapAction(gap, aiOff)).toBe("open_ai_features");
      }
    }
  });

  test("a cluster reached through its AI agent answers to Enable AI alone", async () => {
    const cluster: KubernetesCluster = fakeCluster({
      aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
    });

    const aiOn: KubernetesClusterAiAccessStatus = await realStatus({
      cluster,
      agentRow: makeAgentRow(),
    });
    expect(projectSwitchGapCodes(aiOn)).toEqual([]);

    const aiOff: KubernetesClusterAiAccessStatus = await realStatus({
      cluster,
      agentRow: makeAgentRow(),
      gates: { ...READY_GATES, isAiEnabled: false },
    });
    expect(projectSwitchGapCodes(aiOff)).toEqual(["project_ai_disabled"]);
  });
});

/*
 * The "Needs attention" item against the statuses the real service sends.
 * For each of them:
 *
 * - the gaps become ONE item: a headline, then one step per gap in the
 *   server's order, with the fixes-off choice left out;
 * - the headline agrees with the server's own verdicts (isInvestigationReady,
 *   isRemediationReady);
 * - every gap the server can send has this page's own words. None of them
 *   sends the reader to the page they are on or repeats a helm or kubectl
 *   command — which the server's next steps do, because they are written
 *   for incident pages and the investigation panel too — and a step that
 *   points "above" or "below" points at something the page shows.
 */

const CLOSED_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: false,
  hasLlmProvider: false,
  aiBalanceBlocker: "The project's AI balance is used up.",
  automaticInvestigation: { incidents: false, alerts: false },
};

const FIXES_ON: Record<string, unknown> = {
  aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
};

// The agent's posture, as makeAgentRow reports it, with changes.
function agentPosture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    clusterIdentifier: "prod-us",
    inCluster: true,
    allowWrites: false,
    writeNamespaces: [],
    podNamespace: "monitoring",
    kubectlVersion: "v1.31.2",
    ...overrides,
  };
}

function minutesAgo(minutes: number): Date {
  return OneUptimeDate.addRemoveMinutes(
    OneUptimeDate.getCurrentDate(),
    -minutes,
  );
}

/*
 * The cluster's Kubernetes credential, assigned to `runnerId` (the
 * advanced Runner unless said), or none at all.
 */
function serveCredential(runnerId: string | null = OTHER_RUNNER_ID): void {
  jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue(
    runnerId
      ? ({
          id: new ObjectID(CREDENTIAL_ID),
          credentialType: RunbookCredentialType.Kubernetes,
          name: "prod token",
          runners: [{ _id: runnerId, id: new ObjectID(runnerId) }],
        } as unknown as RunbookCredential)
      : null,
  );
}

const ADVANCED_BINDING: Record<string, unknown> = {
  aiAccessRunnerId: new ObjectID(OTHER_RUNNER_ID),
  aiAccessCredentialId: new ObjectID(CREDENTIAL_ID),
};

const LEGACY_BINDING: Record<string, unknown> = {
  aiAccessRunnerId: new ObjectID(RUNNER_ID),
};

/*
 * The status as the page receives it: computed by the real service, sent
 * as JSON, read back with the page's own parser.
 */
async function pageStatus(
  data: Parameters<typeof realStatus>[0],
): Promise<KubernetesClusterAiAccessStatus> {
  const built: KubernetesClusterAiAccessStatus = await realStatus(data);
  const parsed: KubernetesClusterAiAccessStatus | null = parseStatus(
    JSON.parse(JSON.stringify(built)),
  );

  if (!parsed) {
    throw new Error("The page could not read the server's status.");
  }

  return parsed;
}

function stepCodes(
  attention: AiAgentAttention | null,
): Array<KubernetesAiAccessGapCode> {
  return (attention?.steps || []).map(
    (step: AiAgentAttentionStep): KubernetesAiAccessGapCode => {
      return step.gap.code;
    },
  );
}

function stepTexts(attention: AiAgentAttention | null): Array<string> {
  return (attention?.steps || []).map((step: AiAgentAttentionStep): string => {
    return step.text;
  });
}

interface NamedStatus {
  name: string;
  status: KubernetesClusterAiAccessStatus;
}

/*
 * Every shape of status the server sends: each access target in each of
 * its states, each switch, each project gate. Built one at a time —
 * realStatus re-serves the bound Runner for each.
 */
async function everyServerStatus(): Promise<Array<NamedStatus>> {
  const cases: Array<{
    name: string;
    data: Parameters<typeof realStatus>[0];
    credentialFor?: string | null;
  }> = [
    {
      name: "the agent, ready",
      data: {
        cluster: fakeCluster(FIXES_ON),
        agentRow: makeAgentRow({
          posture: agentPosture({ allowWrites: true }),
        }),
      },
    },
    {
      name: "the agent, fixes off",
      data: { cluster: fakeCluster(), agentRow: makeAgentRow() },
    },
    { name: "nothing installed", data: { cluster: fakeCluster() } },
    {
      name: "nothing installed, investigation off, fixes on",
      data: {
        cluster: fakeCluster({ ...FIXES_ON, isAiInvestigationEnabled: false }),
      },
    },
    {
      name: "the agent silent, fixes on",
      data: {
        cluster: fakeCluster(FIXES_ON),
        agentRow: makeAgentRow({ lastAliveAt: minutesAgo(60) }),
      },
    },
    {
      name: "the agent just signed off",
      data: {
        cluster: fakeCluster(),
        agentRow: makeAgentRow({ connectionStatus: "disconnected" }),
      },
    },
    {
      name: "the agent signed off and never came back",
      data: {
        cluster: fakeCluster(),
        agentRow: makeAgentRow({
          connectionStatus: "disconnected",
          lastAliveAt: minutesAgo(60),
        }),
      },
    },
    {
      name: "the agent reports another cluster, fixes on",
      data: {
        cluster: fakeCluster(FIXES_ON),
        agentRow: makeAgentRow({
          posture: agentPosture({ clusterIdentifier: "prod-eu" }),
        }),
      },
    },
    {
      name: "the agent read-only, fixes on",
      data: { cluster: fakeCluster(FIXES_ON), agentRow: makeAgentRow() },
    },
    {
      name: "investigation off",
      data: {
        cluster: fakeCluster({ isAiInvestigationEnabled: false }),
        agentRow: makeAgentRow(),
      },
    },
    {
      name: "investigation off, fixes on and working",
      data: {
        cluster: fakeCluster({ ...FIXES_ON, isAiInvestigationEnabled: false }),
        agentRow: makeAgentRow({
          posture: agentPosture({ allowWrites: true }),
        }),
      },
    },
    {
      name: "every project gate closed",
      data: {
        cluster: fakeCluster(FIXES_ON),
        agentRow: makeAgentRow({
          posture: agentPosture({ allowWrites: true }),
        }),
        gates: CLOSED_GATES,
      },
    },
    {
      name: "the previous Runner, read-only with fixes on",
      data: {
        cluster: fakeCluster({ ...FIXES_ON, ...LEGACY_BINDING }),
        runner: fakeLegacyRunner(),
      },
    },
    {
      name: "the previous Runner, offline",
      data: {
        cluster: fakeCluster(LEGACY_BINDING),
        runner: fakeLegacyRunner({ lastAlive: minutesAgo(60) }),
      },
    },
    {
      name: "the previous Runner, signed off",
      data: {
        cluster: fakeCluster(LEGACY_BINDING),
        runner: fakeLegacyRunner({
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      },
    },
    {
      name: "the previous Runner, not accepting AI commands",
      data: {
        cluster: fakeCluster(LEGACY_BINDING),
        runner: fakeLegacyRunner({ canRunAiCommands: false }),
      },
    },
    {
      name: "the previous Runner, its posture dropped",
      data: {
        cluster: fakeCluster(LEGACY_BINDING),
        runner: fakeLegacyRunner({ hostInfo: {} }),
      },
    },
    {
      name: "an advanced Runner, ready",
      data: {
        cluster: fakeCluster({ ...FIXES_ON, ...ADVANCED_BINDING }),
        runner: fakeAdvancedRunner(),
      },
    },
    {
      name: "an advanced Runner, offline",
      data: {
        cluster: fakeCluster(ADVANCED_BINDING),
        runner: fakeAdvancedRunner({ lastAlive: minutesAgo(60) }),
      },
    },
    {
      name: "an advanced Runner, never connected",
      data: {
        cluster: fakeCluster(ADVANCED_BINDING),
        runner: fakeAdvancedRunner({ lastAlive: undefined }),
      },
    },
    {
      name: "an advanced Runner, signed off",
      data: {
        cluster: fakeCluster(ADVANCED_BINDING),
        runner: fakeAdvancedRunner({
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      },
    },
    {
      name: "an advanced Runner, not accepting AI commands",
      data: {
        cluster: fakeCluster(ADVANCED_BINDING),
        runner: fakeAdvancedRunner({ canRunAiCommands: false }),
      },
    },
    {
      name: "an advanced Runner without a credential",
      data: {
        cluster: fakeCluster({
          aiAccessRunnerId: new ObjectID(OTHER_RUNNER_ID),
        }),
        runner: fakeAdvancedRunner(),
      },
    },
    {
      name: "an advanced Runner whose credential is another Runner's",
      data: {
        cluster: fakeCluster(ADVANCED_BINDING),
        runner: fakeAdvancedRunner(),
      },
      credentialFor: RUNNER_ID,
    },
    {
      name: "an advanced Runner whose credential was deleted",
      data: {
        cluster: fakeCluster(ADVANCED_BINDING),
        runner: fakeAdvancedRunner(),
      },
      credentialFor: null,
    },
    {
      name: "an advanced Runner in a pod of no named cluster, fixes on",
      data: {
        cluster: fakeCluster({
          ...FIXES_ON,
          aiAccessRunnerId: new ObjectID(OTHER_RUNNER_ID),
        }),
        runner: fakeAdvancedRunner({
          hostInfo: { kubernetes: { inCluster: true, allowWrites: false } },
        }),
      },
    },
    {
      name: "an advanced Runner, AI off for the project",
      data: {
        cluster: fakeCluster({ ...FIXES_ON, ...ADVANCED_BINDING }),
        runner: fakeAdvancedRunner(),
        gates: { ...READY_GATES, isAiEnabled: false },
      },
    },
    {
      name: "the bound Runner was just deleted",
      data: { cluster: fakeCluster(LEGACY_BINDING), runner: null },
    },
    {
      name: "everything wrong at once",
      data: {
        cluster: fakeCluster({ ...FIXES_ON, isAiInvestigationEnabled: false }),
        gates: CLOSED_GATES,
      },
    },
  ];

  const statuses: Array<NamedStatus> = [];

  for (const testCase of cases) {
    serveCredential(
      testCase.credentialFor === undefined
        ? OTHER_RUNNER_ID
        : testCase.credentialFor,
    );
    statuses.push({
      name: testCase.name,
      status: await pageStatus(testCase.data),
    });
  }

  return statuses;
}

/*
 * Every gap the server produces, but the fixes-off choice. The retired
 * project_auto_remediation_disabled and project_ai_command_execution_disabled
 * are not among them: Enable AI covers both.
 */
const ATTENTION_GAP_CODES: Array<KubernetesAiAccessGapCode> = [
  "ai_agent_not_connected",
  "ai_agent_offline",
  "ai_balance_insufficient",
  "runner_missing",
  "runner_offline",
  "runner_ai_commands_disabled",
  "runner_cluster_mismatch",
  "credential_missing",
  "investigation_disabled",
  "remediation_write_access_missing",
  "project_ai_disabled",
  "llm_provider_missing",
];

const UPGRADE_STEP: string =
  "Upgrade the Kubernetes agent chart with the command above. The Kubernetes AI agent replaces the previous in-cluster Runner.";

const CHOOSE_CREDENTIAL_STEP: string =
  "With Change below, choose a Kubernetes credential the Runner may use, or clear the Runner to use the Kubernetes AI agent.";

describe("Needs attention, from the server's own statuses", () => {
  test("a new cluster: one item, two steps, no self-reference", async () => {
    const status: KubernetesClusterAiAccessStatus = await pageStatus({
      cluster: fakeCluster({ isAiInvestigationEnabled: false }),
    });

    // What the server sends: three gaps, each written for any surface.
    expect(gapCodes(status)).toEqual([
      "ai_agent_not_connected",
      "investigation_disabled",
      "remediation_disabled",
    ]);
    expect(status.gaps[0]!.nextStep).toContain(AI_AGENT_INSTALL_COMMAND);
    expect(status.gaps[1]!.nextStep).toContain(CLUSTER_AI_AGENT_PAGE);

    // What the page shows: one item.
    expect(getAiAgentAttention(status)).toEqual({
      title: "OneUptime AI can't investigate this cluster",
      steps: [
        {
          gap: status.gaps[0],
          text: "Install the Kubernetes AI agent with the command above.",
          action: null,
        },
        {
          gap: status.gaps[1],
          text: "Turn on AI investigation with kubectl.",
          action: "turn_on_investigation",
        },
      ],
    });
    expect(getAiAgentCardCommand(status)).toBe("install");
  });

  test("nothing to show when AI is ready, or only fixes are off by choice", async () => {
    const statuses: Array<NamedStatus> = (await everyServerStatus()).filter(
      (entry: NamedStatus): boolean => {
        return [
          "the agent, ready",
          "the agent, fixes off",
          "an advanced Runner, ready",
        ].includes(entry.name);
      },
    );

    expect(statuses).toHaveLength(3);
    for (const { name, status } of statuses) {
      expect({ name, isReady: status.isInvestigationReady }).toEqual({
        name,
        isReady: true,
      });
      expect({ name, attention: getAiAgentAttention(status) }).toEqual({
        name,
        attention: null,
      });
    }
  });

  test("every status is one item whose steps follow the server's gaps", async () => {
    for (const { name, status } of await everyServerStatus()) {
      const attention: AiAgentAttention | null = getAiAgentAttention(status);
      const expectedCodes: Array<string> = gapCodes(status).filter(
        (code: string): boolean => {
          return code !== "remediation_disabled";
        },
      );

      expect({ name, codes: stepCodes(attention) }).toEqual({
        name,
        codes: expectedCodes,
      });

      if (!attention) {
        continue;
      }

      // Each step keeps the action its gap offers on the page.
      for (const step of attention.steps) {
        expect({ name, action: step.action }).toEqual({
          name,
          action: getAiAgentGapAction(step.gap, status),
        });
      }

      // The headline says what the server's verdicts say.
      if (!status.isInvestigationReady) {
        expect({ name, title: attention.title }).toEqual({
          name,
          title: expect.stringMatching(
            /^OneUptime AI can't investigate this cluster( or run fixes on it)?$/,
          ),
        });
      } else {
        expect({ name, title: attention.title }).toEqual({
          name,
          title: "OneUptime AI can't run fixes on this cluster",
        });
      }

      const fixesOn: boolean =
        status.remediationMode !== KubernetesAiRemediationMode.Disabled;
      expect({ name, namesFixes: attention.title.includes("fixes") }).toEqual({
        name,
        namesFixes: fixesOn
          ? !status.isRemediationReady
          : status.isInvestigationReady,
      });
    }
  });

  test("every gap the server sends has this page's own words", async () => {
    const seen: Set<KubernetesAiAccessGapCode> =
      new Set<KubernetesAiAccessGapCode>();

    for (const { name, status } of await everyServerStatus()) {
      for (const step of getAiAgentAttention(status)?.steps || []) {
        seen.add(step.gap.code);

        expect({ name, text: step.text }).not.toEqual({
          name,
          text: step.gap.nextStep,
        });
        expect({ name, text: step.text }).toEqual({
          name,
          text: expect.stringMatching(/^[A-Z].*\.$/),
        });
        for (const forbidden of [
          CLUSTER_AI_AGENT_PAGE,
          "AI → Agent",
          "AI agent page",
          AI_AGENT_INSTALL_COMMAND,
          "helm ",
          "kubectl logs",
          CLUSTER_ID.toString(),
          RUNNER_ID,
          OTHER_RUNNER_ID,
        ]) {
          expect({ name, text: step.text }).toEqual({
            name,
            text: expect.not.stringContaining(forbidden),
          });
        }
      }
    }

    // Every gap but the fixes-off choice was seen, so none fell through.
    expect(Array.from(seen).sort()).toEqual([...ATTENTION_GAP_CODES].sort());
  });

  /*
   * A step that says "above" or "below" sends the reader to something on
   * this page — so that thing must be there for the same status.
   */
  test("a step points only at what the page shows for the same status", async () => {
    for (const { name, status } of await everyServerStatus()) {
      for (const text of stepTexts(getAiAgentAttention(status))) {
        const where: Record<string, unknown> = { name, text };

        if (text.includes("with the command above")) {
          expect({ ...where, command: getAiAgentCardCommand(status) }).toEqual({
            ...where,
            command: "install",
          });
        }
        if (text.includes("(the command is above)")) {
          expect({ ...where, command: getAiAgentCardCommand(status) }).toEqual({
            ...where,
            command: "logs",
          });
        }
        if (text.includes("commands below")) {
          expect({
            ...where,
            shown: shouldShowWriteAccessCommands(status),
          }).toEqual({ ...where, shown: true });
        }
        // Runner pickers and Runner fixes exist only for an advanced binding.
        if (text.includes("With Change below") || text.includes("the Runner")) {
          expect({
            ...where,
            advanced: isAdvancedRunnerTarget(status),
          }).toEqual({ ...where, advanced: true });
        }
        if (text.startsWith("Reset the Kubernetes AI agent")) {
          expect({
            ...where,
            hasAgent: getAiAgentSummary(status) !== null,
          }).toEqual({ ...where, hasAgent: true });
        }
      }
    }
  });

  test("an offline agent: wait right after a sign-off, bring it back otherwise", async () => {
    const byName: Map<string, KubernetesClusterAiAccessStatus> = new Map<
      string,
      KubernetesClusterAiAccessStatus
    >(
      (await everyServerStatus()).map(
        (entry: NamedStatus): [string, KubernetesClusterAiAccessStatus] => {
          return [entry.name, entry.status];
        },
      ),
    );

    const signedOff: AiAgentAttention | null = getAiAgentAttention(
      byName.get("the agent just signed off")!,
    );
    expect(signedOff?.title).toBe(
      "OneUptime AI can't investigate this cluster",
    );
    expect(stepTexts(signedOff)).toEqual([
      "Wait a few minutes for the Kubernetes AI agent to reconnect. If it does not, its logs say why (the command is above).",
    ]);

    expect(
      stepTexts(
        getAiAgentAttention(
          byName.get("the agent signed off and never came back")!,
        ),
      ),
    ).toEqual([
      "Bring the Kubernetes AI agent back online. Its logs say why it is offline (the command is above).",
    ]);

    // Silent with fixes on: both blocked, and the agent is read-only too.
    const silent: AiAgentAttention | null = getAiAgentAttention(
      byName.get("the agent silent, fixes on")!,
    );
    expect(silent?.title).toBe(
      "OneUptime AI can't investigate this cluster or run fixes on it",
    );
    expect(stepTexts(silent)).toEqual([
      "Bring the Kubernetes AI agent back online. Its logs say why it is offline (the command is above).",
      "Give the Kubernetes AI agent write access with the commands below.",
    ]);
    expect(
      silent?.steps.map((step: AiAgentAttentionStep): string | null => {
        return step.action;
      }),
    ).toEqual([null, null]);
  });

  test("an agent that has not reported this cluster: reset it", async () => {
    const status: KubernetesClusterAiAccessStatus = await pageStatus({
      cluster: fakeCluster(),
      agentRow: makeAgentRow({
        posture: agentPosture({ clusterIdentifier: "prod-eu" }),
      }),
    });

    expect(gapCodes(status)).toEqual([
      "runner_cluster_mismatch",
      "remediation_disabled",
    ]);
    expect(status.gaps[0]!.nextStep).toContain(CLUSTER_AI_AGENT_PAGE);
    expect(stepTexts(getAiAgentAttention(status))).toEqual([
      "Reset the Kubernetes AI agent. It reconnects on its own within a few minutes.",
    ]);
  });

  test("the previous in-cluster Runner: every Runner gap is the one chart upgrade", async () => {
    const statuses: Array<NamedStatus> = (await everyServerStatus()).filter(
      (entry: NamedStatus): boolean => {
        return entry.name.startsWith("the previous Runner");
      },
    );

    expect(statuses).toHaveLength(5);
    for (const { name, status } of statuses) {
      expect({ name, legacy: isLegacyRunnerTarget(status) }).toEqual({
        name,
        legacy: true,
      });
      expect({ name, command: getAiAgentCardCommand(status) }).toEqual({
        name,
        command: "install",
      });

      for (const step of getAiAgentAttention(status)?.steps || []) {
        expect({ name, code: step.gap.code, text: step.text }).toEqual({
          name,
          code: step.gap.code,
          text:
            step.gap.code === "remediation_write_access_missing"
              ? "Upgrade to the Kubernetes AI agent with write access, using the commands below."
              : UPGRADE_STEP,
        });
        // Nothing to open on a Runner that is being replaced.
        expect({ name, action: step.action }).toEqual({ name, action: null });
      }
    }
  });

  test("an advanced Runner: fixed on the Runner, or swapped under Change", async () => {
    const byName: Map<string, KubernetesClusterAiAccessStatus> = new Map<
      string,
      KubernetesClusterAiAccessStatus
    >(
      (await everyServerStatus()).map(
        (entry: NamedStatus): [string, KubernetesClusterAiAccessStatus] => {
          return [entry.name, entry.status];
        },
      ),
    );
    const expected: Array<[string, Array<[string, string, string | null]>]> = [
      [
        "an advanced Runner, offline",
        [
          [
            "runner_offline",
            "Start the Runner and make sure it can reach your OneUptime URL.",
            "view_runner",
          ],
        ],
      ],
      [
        "an advanced Runner, never connected",
        [
          [
            "runner_offline",
            "Start the Runner and make sure it can reach your OneUptime URL.",
            "view_runner",
          ],
        ],
      ],
      [
        "an advanced Runner, signed off",
        [
          [
            "runner_offline",
            "Start the Runner and make sure it can reach your OneUptime URL.",
            "view_runner",
          ],
        ],
      ],
      [
        "an advanced Runner, not accepting AI commands",
        [
          [
            "runner_ai_commands_disabled",
            'Turn on "Runs AI Remediation Commands" on the Runner.',
            "view_runner",
          ],
        ],
      ],
      [
        "an advanced Runner without a credential",
        [["credential_missing", CHOOSE_CREDENTIAL_STEP, "view_runner"]],
      ],
      [
        "an advanced Runner whose credential is another Runner's",
        [["credential_missing", CHOOSE_CREDENTIAL_STEP, "view_runner"]],
      ],
      [
        "an advanced Runner whose credential was deleted",
        [["credential_missing", CHOOSE_CREDENTIAL_STEP, "view_runner"]],
      ],
      [
        "an advanced Runner in a pod of no named cluster, fixes on",
        [
          ["runner_cluster_mismatch", CHOOSE_CREDENTIAL_STEP, "view_runner"],
          [
            "remediation_write_access_missing",
            "Set ONEUPTIME_KUBECTL_ALLOW_WRITES=true on the Runner's host and restart it.",
            null,
          ],
        ],
      ],
      [
        "an advanced Runner, AI off for the project",
        [
          [
            "project_ai_disabled",
            "Turn on AI for this project.",
            "open_ai_features",
          ],
        ],
      ],
    ];

    for (const [name, steps] of expected) {
      const status: KubernetesClusterAiAccessStatus = byName.get(name)!;

      expect({ name, advanced: isAdvancedRunnerTarget(status) }).toEqual({
        name,
        advanced: true,
      });
      expect({
        name,
        steps: (getAiAgentAttention(status)?.steps || []).map(
          (step: AiAgentAttentionStep): [string, string, string | null] => {
            return [step.gap.code, step.text, step.action];
          },
        ),
      }).toEqual({ name, steps });
    }

    /*
     * Enable AI is the one switch for a Runner's commands too: off, it
     * blocks investigation and fixes alike.
     */
    expect(
      getAiAgentAttention(
        byName.get("an advanced Runner, AI off for the project")!,
      )?.title,
    ).toBe("OneUptime AI can't investigate this cluster or run fixes on it");
  });

  test("a read-only executor with fixes on: the commands below for the agent", async () => {
    const status: KubernetesClusterAiAccessStatus = await pageStatus({
      cluster: fakeCluster(FIXES_ON),
      agentRow: makeAgentRow(),
    });
    const attention: AiAgentAttention | null = getAiAgentAttention(status);

    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
    expect(shouldShowWriteAccessCommands(status)).toBe(true);
    expect(attention?.title).toBe(
      "OneUptime AI can't run fixes on this cluster",
    );
    expect(stepTexts(attention)).toEqual([
      "Give the Kubernetes AI agent write access with the commands below.",
    ]);
  });

  test("the project's gates: one step each, in the server's order, each with its settings page", async () => {
    const status: KubernetesClusterAiAccessStatus = await pageStatus({
      cluster: fakeCluster(FIXES_ON),
      agentRow: makeAgentRow({ posture: agentPosture({ allowWrites: true }) }),
      gates: CLOSED_GATES,
    });
    const attention: AiAgentAttention | null = getAiAgentAttention(status);

    expect(attention?.title).toBe(
      "OneUptime AI can't investigate this cluster or run fixes on it",
    );
    expect(
      (attention?.steps || []).map(
        (step: AiAgentAttentionStep): [string, string, string | null] => {
          return [step.gap.code, step.text, step.action];
        },
      ),
    ).toEqual([
      [
        "project_ai_disabled",
        "Turn on AI for this project.",
        "open_ai_features",
      ],
      [
        "llm_provider_missing",
        "Add an AI provider for this project, or use OneUptime AI credits.",
        "open_llm_providers",
      ],
      [
        "ai_balance_insufficient",
        "Add AI credits to this project, or turn on auto-recharge.",
        "open_ai_credits",
      ],
    ]);
  });

  test("the bound Runner just deleted: reload", async () => {
    const status: KubernetesClusterAiAccessStatus = await pageStatus({
      cluster: fakeCluster(LEGACY_BINDING),
      runner: null,
    });

    expect(gapCodes(status)).toEqual([
      "runner_missing",
      "remediation_disabled",
    ]);
    expect(stepTexts(getAiAgentAttention(status))).toEqual([
      "Reload this page. The Runner this cluster was bound to was just deleted.",
    ]);
  });
});

/*
 * One definition of a usable allowlist entry: the page and the server's
 * save validation give these entries the same answer.
 */
describe("allowlist validation: the page and the server agree", () => {
  const ENTRIES: Array<{ name: string; patterns: Array<string> }> = [
    { name: "a bare kubectl", patterns: ["kubectl"] },
    { name: "a leading wildcard", patterns: ["*foo bar"] },
    { name: "runs of spaces", patterns: ["kubectl  get   pods"] },
    { name: "a set image shape", patterns: [SET_IMAGE_PATTERN] },
    { name: "a wildcard verb", patterns: ["* * -n web"] },
    {
      name: "one pattern too many",
      patterns: Array.from(
        { length: 101 },
        (_value: unknown, index: number): string => {
          return `kubectl rollout restart deployment/web-${index} -n web`;
        },
      ),
    },
    {
      name: "a pattern too long",
      patterns: [`kubectl ${"x".repeat(493)}`],
    },
  ];

  for (const entry of ENTRIES) {
    test(entry.name, () => {
      let isServerRefusal: boolean = false;
      try {
        normalizeKubectlAllowlistForWrite(entry.patterns);
      } catch {
        isServerRefusal = true;
      }

      expect({
        pageRefuses:
          validateKubectlAllowlistText(entry.patterns.join("\n")) !== null,
      }).toEqual({ pageRefuses: isServerRefusal });
    });
  }
});

/*
 * The Runner pages against RunnerService, run for real with only the
 * database read stubbed. The pages decide which rows are kubernetes-agent
 * rows with the server's rule, and their edit form posts nothing the
 * server's write hook refuses.
 */
describe("the Runner pages and RunnerService agree on agent rows", () => {
  interface RowCase {
    label: string;
    row: { name?: unknown; hostInfo?: unknown };
  }

  const AGENT_POSTURE: JSONObject = {
    kubernetes: { inCluster: true, clusterIdentifier: "prod" },
  };

  const ROWS: Array<RowCase> = [
    {
      label: "an agent row",
      row: { name: "kubernetes-agent/prod", hostInfo: AGENT_POSTURE },
    },
    {
      label: "an agent row whose heartbeat dropped the posture",
      row: { name: "kubernetes-agent/prod", hostInfo: {} },
    },
    {
      label: "a case-variant agent name",
      row: { name: "Kubernetes-Agent/prod", hostInfo: {} },
    },
    {
      label: "an agent by posture alone (a legacy rename)",
      row: { name: "prod-kubectl", hostInfo: AGENT_POSTURE },
    },
    {
      label: "a Runner in a pod naming no cluster",
      row: {
        name: "pod-runner",
        hostInfo: { kubernetes: { inCluster: true } },
      },
    },
    { label: "a host Runner", row: { name: "office-runner", hostInfo: {} } },
    { label: "a look-alike name", row: { name: "kubernetes-agent-office" } },
  ];

  const RUNNER_ROW_ID: ObjectID = new ObjectID(
    "99999999-9999-4999-8999-999999999999",
  );

  interface RunnerHooks {
    onBeforeCreate(createBy: CreateBy<Runner>): Promise<OnCreate<Runner>>;
    onBeforeUpdate(updateBy: UpdateBy<Runner>): Promise<OnUpdate<Runner>>;
  }

  function runnerHooks(): RunnerHooks {
    return RunnerService as unknown as RunnerHooks;
  }

  function editorProps(): DatabaseCommonInteractionProps {
    return {
      userId: ObjectID.generate(),
      tenantId: PROJECT_ID,
    } as DatabaseCommonInteractionProps;
  }

  function serveRunnerRow(row: RowCase["row"]): void {
    jest.spyOn(RunnerService, "findBy").mockResolvedValue([
      {
        id: RUNNER_ROW_ID,
        _id: RUNNER_ROW_ID.toString(),
        ...row,
      } as unknown as Runner,
    ]);
  }

  async function serverRefusal(
    row: RowCase["row"],
    data: JSONObject,
  ): Promise<string | null> {
    serveRunnerRow(row);

    try {
      await runnerHooks().onBeforeUpdate({
        query: { _id: RUNNER_ROW_ID.toString() },
        data: data as unknown as Runner,
        limit: 1,
        skip: 0,
        props: editorProps(),
      } as unknown as UpdateBy<Runner>);
      return null;
    } catch (err) {
      if (err instanceof BadDataException) {
        return err.message;
      }
      throw err;
    }
  }

  function formFieldNames(row: RowCase["row"]): Array<string> {
    return getRunnerFormFields({
      withSteps: false,
      restrictions: getRunnerFormRestrictions(row),
    }).map((field: Field<Runner>): string => {
      return Object.keys(field.field || {})[0] || "";
    });
  }

  test("the pages' agent rule is RunnerService.isKubernetesAgentRunnerRow", () => {
    for (const rowCase of ROWS) {
      expect({
        row: rowCase.label,
        isAgent: isKubernetesAgentRunnerRow(rowCase.row),
      }).toEqual({
        row: rowCase.label,
        isAgent: RunnerServiceClass.isKubernetesAgentRunnerRow(rowCase.row),
      });
    }
  });

  test("the form's locks are the hook's rules", () => {
    for (const rowCase of ROWS) {
      const restrictions: RunnerFormRestrictions = getRunnerFormRestrictions(
        rowCase.row,
      );
      expect({ row: rowCase.label, restrictions }).toEqual({
        row: rowCase.label,
        restrictions: {
          isNameLocked: RunnerServiceClass.isKubernetesAgentName(
            rowCase.row.name,
          ),
          areShellCapabilitiesLocked:
            RunnerServiceClass.isKubernetesAgentRunnerRow(rowCase.row),
        },
      });
    }
  });

  test("the hook refuses exactly what the form leaves out", async () => {
    for (const rowCase of ROWS) {
      const fields: Array<string> = formFieldNames(rowCase.row);

      const renameRefused: boolean =
        (await serverRefusal(rowCase.row, { name: "renamed-runner" })) !== null;
      const runbooksRefused: boolean =
        (await serverRefusal(rowCase.row, { canRunRunbooks: true })) !== null;

      expect({
        row: rowCase.label,
        renameRefused,
        runbooksRefused,
      }).toEqual({
        row: rowCase.label,
        renameRefused: !fields.includes("name"),
        runbooksRefused: !fields.includes("canRunRunbooks"),
      });
    }
  });

  test("the name check refuses a reserved name exactly when the create hook does", async () => {
    for (const name of [
      "kubernetes-agent/prod",
      "Kubernetes-Agent/prod",
      "prod-runner",
      "kubernetes-agent",
      "kubernetes-agent-office",
    ]) {
      let serverRefuses: boolean = false;
      try {
        await runnerHooks().onBeforeCreate({
          data: Object.assign(new Runner(), { name }),
          props: editorProps(),
        } as unknown as CreateBy<Runner>);
      } catch (err) {
        if (!(err instanceof BadDataException)) {
          throw err;
        }
        serverRefuses = true;
      }

      expect({
        name,
        pageRefuses: getReservedRunnerNameError(name) !== null,
      }).toEqual({ name, pageRefuses: serverRefuses });
    }
  });
});
