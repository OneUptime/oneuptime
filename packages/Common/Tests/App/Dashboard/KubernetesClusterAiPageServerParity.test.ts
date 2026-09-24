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
  buildKubernetesAiRunnerOptions,
  describeRunnerWriteAccess,
  getAiAccessConnectCardMode,
  getKubernetesAiAccessLooseningChanges,
  getKubernetesAiAccessOfferedFields,
  getKubernetesAiAccessSettingsChanges,
  getKubernetesAiAccessSettingsInitialValues,
  validateKubectlAllowlistText,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI";
import { isKubernetesAgentRunnerRow } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAgentRunner";
import {
  RunnerFormRestrictions,
  getReservedRunnerNameError,
  getRunnerFormFields,
  getRunnerFormRestrictions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/RunnerFormFields";
import KubernetesClusterAiAccessService, {
  KubernetesClusterAiAccessProjectGates,
  getKubernetesAgentRunnerNameForCluster,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService, {
  normalizeKubectlAllowlistForWrite,
} from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService, {
  Service as RunnerServiceClass,
} from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
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
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";

/*
 * The AI page against the server it talks to — run for real, with only
 * the database stubbed:
 *
 * - who may loosen: the page's rule (getKubernetesAiAccessLooseningChanges)
 *   gives the verdict KubernetesClusterService's write hook gives, for the
 *   same saved settings and the same change, and every tightening a cluster
 *   editor makes through the form is accepted by the server;
 * - the gaps the real status computes drive the page's connect card;
 * - the Runner name the server gives a long cluster identifier is still
 *   recognised by the page's Runner picker;
 * - the page's allowlist validation agrees with the server's.
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

const SET_IMAGE_PATTERN: string = "kubectl set image deployment/web * -n web";
const PATCH_PATTERN: string = "kubectl patch deployment/web -n web -p *";
const ODDLY_SPACED_PATTERN: string =
  "kubectl  scale   deployment/web --replicas=* -n web";

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  isAutoRemediationEnabled: true,
  isAiCommandExecutionEnabled: true,
  hasLlmProvider: true,
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
}

function stored(overrides: Partial<StoredSettings> = {}): StoredSettings {
  return {
    aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, PATCH_PATTERN],
    aiAccessRunnerId: RUNNER_ID,
    aiAccessCredentialId: null,
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
    aiAccessRunnerName: "bash-runner",
    aiAccessCredentialId: settings.aiAccessCredentialId,
    aiAccessCredentialName: settings.aiAccessCredentialId ? "prod token" : null,
  };
}

// Serves `settings` as the cluster the server's write hook reads first.
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
  } as unknown as RunbookCredential);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The finding (dashboard-ai-page-4, XP-7, SIA-4): the server's rule is
 * relative to the saved settings, the page's was absolute, and the page
 * hid tightening the server accepts from every cluster editor.
 */
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
    {
      name: "Automatic -> Ask for approval",
      settings: stored(),
      changes: {
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      },
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
      name: "keep a pattern stored with odd spacing, re-spaced",
      settings: stored({
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, ODDLY_SPACED_PATTERN],
      }),
      changes: {
        aiKubectlCommandAllowlist: [
          "kubectl scale deployment/web --replicas=* -n web",
        ],
      },
    },
    {
      name: "clear an allowlist stored as a plain string",
      settings: stored({ aiKubectlCommandAllowlist: SET_IMAGE_PATTERN }),
      changes: { aiKubectlCommandAllowlist: [] },
    },
    {
      name: "unbind the Runner",
      settings: stored(),
      changes: { aiAccessRunnerId: null },
    },
    {
      name: "bind another Runner",
      settings: stored(),
      changes: { aiAccessRunnerId: OTHER_RUNNER_ID },
    },
    {
      name: "re-send the bound Runner",
      settings: stored(),
      changes: { aiAccessRunnerId: RUNNER_ID },
    },
    {
      name: "unbind the credential",
      settings: stored({ aiAccessCredentialId: CREDENTIAL_ID }),
      changes: { aiAccessCredentialId: null },
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
      settings: stored(),
      changes: { isAiInvestigationEnabled: false },
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
      }),
      edits: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
      expected: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
    },
    {
      name: "removes a pattern",
      settings: stored(),
      edits: { kubectlAllowlistText: PATCH_PATTERN },
      expected: { aiKubectlCommandAllowlist: [PATCH_PATTERN] },
    },
    {
      // The form shows the kept line re-spaced; it is sent as stored.
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
      name: "unbinds the Runner and the credential",
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
      expect(getKubernetesAiAccessLooseningChanges({ saved, changes })).toEqual(
        [],
      );
      expect(await serverSaysLoosens(edit.settings, changes)).toBe(false);
    });
  }
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
    aiAccessRunnerId: new ObjectID(RUNNER_ID),
    aiAccessCredentialId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    aiKubectlCommandAllowlist: undefined,
    ...overrides,
  } as unknown as KubernetesCluster;
}

function fakeRunner(overrides: Record<string, unknown> = {}): Runner {
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

async function realStatus(data: {
  cluster: KubernetesCluster;
  runner: Runner | null;
}): Promise<KubernetesClusterAiAccessStatus> {
  jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(data.runner);
  return await KubernetesClusterAiAccessService.getStatusForClusterModel({
    cluster: data.cluster,
    gates: READY_GATES,
  });
}

function gapCodes(status: KubernetesClusterAiAccessStatus): Array<string> {
  return status.gaps.map((gap: KubernetesAiAccessGap): string => {
    return gap.code;
  });
}

/*
 * The server tells "no Runner can reach this cluster" from "this cluster's
 * in-cluster Runner is installed but not selected" only in the words of
 * one no_runner_bound gap. The page's connect card is chosen from those
 * words, so it is checked against what the real status produces.
 */
describe("the connect card follows the real status", () => {
  test("no Runner bound and none registered: the helm upgrade", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster({ aiAccessRunnerId: undefined }),
      runner: null,
    });
    expect(gapCodes(status)).toEqual(["no_runner_bound"]);
    expect(getAiAccessConnectCardMode(status)).toBe("connect");
  });

  test("no Runner bound but this cluster's in-cluster Runner registered: select it", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster({ aiAccessRunnerId: undefined }),
      runner: fakeRunner(),
    });
    expect(gapCodes(status)).toEqual(["no_runner_bound"]);
    expect(getAiAccessConnectCardMode(status)).toBe("select_agent_runner");
  });

  test("a bound read-only in-cluster Runner: no connect card, and the page says it is read-only", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster(),
      runner: fakeRunner(),
    });
    expect(gapCodes(status)).toContain("remediation_write_access_missing");
    expect(getAiAccessConnectCardMode(status)).toBe("none");
    expect(describeRunnerWriteAccess(status.runner?.posture)).toBe(
      "read-only RBAC",
    );
  });

  test("a credential on another cluster's in-cluster Runner: its gap, no connect card", async () => {
    const status: KubernetesClusterAiAccessStatus = await realStatus({
      cluster: fakeCluster({
        aiAccessCredentialId: new ObjectID(CREDENTIAL_ID),
      }),
      runner: fakeRunner({
        name: "kubernetes-agent/prod-eu",
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: false,
            clusterIdentifier: "prod-eu",
          },
        },
      }),
    });
    expect(gapCodes(status)).toContain("credential_on_agent_runner");
    expect(getAiAccessConnectCardMode(status)).toBe("none");
  });
});

/*
 * The finding (dashboard-ai-page-2): the server shortens an agent Runner's
 * name with a hash once "kubernetes-agent/<id>" passes 100 characters, and
 * the page rebuilt the name to find this cluster's Runner.
 */
describe("the Runner picker recognises the Runner name the server gives", () => {
  function agentRunner(id: string, clusterIdentifier: string): Runner {
    return Object.assign(new Runner(), {
      _id: id,
      name: getKubernetesAgentRunnerNameForCluster(clusterIdentifier),
      canRunAiCommands: true,
      hostInfo: {
        kubernetes: { inCluster: true, allowWrites: false, clusterIdentifier },
      },
    });
  }

  for (const length of [83, 84, 87, 100]) {
    test(`a ${length}-character cluster identifier`, () => {
      const identifier: string = `eks-${"a".repeat(length - 9)}-blue`;
      const other: string = `eks-${"a".repeat(length - 9)}-gren`;
      expect(identifier.length).toBe(length);

      const options: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
        runners: [
          agentRunner("r-other", other),
          agentRunner("r-this", identifier),
        ],
        clusterIdentifier: identifier,
        boundRunnerId: null,
        boundRunnerName: null,
      });

      expect(options).toEqual([
        {
          value: "r-this",
          label: `${getKubernetesAgentRunnerNameForCluster(identifier)} (in-cluster Runner for this cluster)`,
        },
      ]);
    });
  }

  test("harness guard: past 83 characters the server's name is not kubernetes-agent/<id>", () => {
    const identifier: string = "a".repeat(84);
    expect(getKubernetesAgentRunnerNameForCluster(identifier)).not.toBe(
      `kubernetes-agent/${identifier}`,
    );
  });
});

/*
 * One definition of a usable allowlist entry. These entries get the same
 * answer from the page and from the server's save validation. (Entries the
 * matcher reads but the server's validation still refuses on its own
 * terms — a pattern without the leading "kubectl" — are the server's to
 * change; see KubectlPolicy.describeAllowlistPatternProblem.)
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
 * server's write hook refuses — and leaves out exactly what it refuses.
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
      label: "a padded upper-case agent name",
      row: { name: "  KUBERNETES-AGENT/prod ", hostInfo: {} },
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

  // Serves `row` as the Runner the update hook reads.
  function serveRunnerRow(row: RowCase["row"]): void {
    jest.spyOn(RunnerService, "findBy").mockResolvedValue([
      {
        id: RUNNER_ROW_ID,
        _id: RUNNER_ROW_ID.toString(),
        ...row,
      } as unknown as Runner,
    ]);
  }

  // What the hook says about a non-root update of `row`: null, or the refusal.
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

  // The fields the detail page's edit form offers for `row`.
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

  test("the form's locks are the hook's rules: the name marker, and the row rule", () => {
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

  /*
   * What the form posts for a row: every field it offers, the capability
   * switches it offers as they are stored (off) and "Runs AI Remediation
   * Commands" on, the name re-posted unchanged.
   */
  test("the hook accepts everything the edit form posts, for every row", async () => {
    for (const rowCase of ROWS) {
      const fields: Array<string> = formFieldNames(rowCase.row);
      const data: JSONObject = {};

      if (fields.includes("name")) {
        data["name"] = rowCase.row.name as string;
      }
      data["description"] = "Edited from the Runner page.";
      if (fields.includes("canRunRunbooks")) {
        data["canRunRunbooks"] = false;
      }
      if (fields.includes("canRunCodeFixTasks")) {
        data["canRunCodeFixTasks"] = false;
      }
      data["canRunAiCommands"] = true;

      expect({
        row: rowCase.label,
        refusal: await serverRefusal(rowCase.row, data),
      }).toEqual({ row: rowCase.label, refusal: null });
    }
  });

  test("the hook refuses exactly what the form leaves out", async () => {
    for (const rowCase of ROWS) {
      const fields: Array<string> = formFieldNames(rowCase.row);

      const renameRefused: boolean =
        (await serverRefusal(rowCase.row, { name: "renamed-runner" })) !== null;
      const runbooksRefused: boolean =
        (await serverRefusal(rowCase.row, { canRunRunbooks: true })) !== null;
      const codeFixesRefused: boolean =
        (await serverRefusal(rowCase.row, { canRunCodeFixTasks: true })) !==
        null;

      expect({
        row: rowCase.label,
        renameRefused,
        runbooksRefused,
        codeFixesRefused,
      }).toEqual({
        row: rowCase.label,
        renameRefused: !fields.includes("name"),
        runbooksRefused: !fields.includes("canRunRunbooks"),
        codeFixesRefused: !fields.includes("canRunCodeFixTasks"),
      });
    }
  });

  test("the name check refuses a reserved name exactly when the create hook does", async () => {
    for (const name of [
      "kubernetes-agent/prod",
      "Kubernetes-Agent/prod",
      " KUBERNETES-AGENT/prod",
      "prod-runner",
      "kubernetes-agent",
      "kubernetes-agent-office",
      "my-kubernetes-agent/prod",
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
