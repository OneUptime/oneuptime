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
  canSwitchToAiAgent,
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
  shouldShowWriteAccessCommands,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import { isKubernetesAgentRunnerRow } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAgentRunner";
import {
  RunnerFormRestrictions,
  getReservedRunnerNameError,
  getRunnerFormFields,
  getRunnerFormRestrictions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerFormFields";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService, {
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
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiAccessGap,
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
 *   state of the "Kubernetes AI agent" card, the Needs attention rows, the
 *   write-access commands and the Overview card, from the real resolution
 *   of the access target;
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
