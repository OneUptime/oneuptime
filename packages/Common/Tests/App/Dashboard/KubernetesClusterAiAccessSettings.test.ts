import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  AI_ACCESS_EXAMPLE_WRITE_NAMESPACES,
  AiAccessHelmCommands,
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  KubernetesAiAccessConfirmation,
  KubernetesAiAccessOfferedFields,
  KubernetesAiAccessSavedSettings,
  KubernetesAiCredentialDirectoryEntry,
  KubernetesAiRunnerDirectoryEntry,
  REMEDIATION_MODES_BY_AUTONOMY,
  SavedKubectlAllowlist,
  buildKubernetesAiCredentialDirectory,
  buildKubernetesAiCredentialOptions,
  buildKubernetesAiRunnerDirectory,
  buildKubernetesAiRunnerOptions,
  canConfigureUnattendedKubernetesAiAccess,
  canPickKubernetesRunner,
  canReadKubectlJobs,
  describeRunnerWriteAccess,
  getAccessTestPermissionGate,
  getAccessTestPermissionMessage,
  getAiAccessConnectCardMode,
  getAiAccessHelmCommands,
  getAiAccessWriteDisclosure,
  getKubectlAllowlistRemovalOnlyError,
  getKubectlJobsPermissionTitles,
  getKubernetesAiAccessAdminPermissionTitles,
  getKubernetesAiAccessBindingError,
  getKubernetesAiAccessChosenRunnerId,
  getKubernetesAiAccessConfirmation,
  getKubernetesAiAccessEditCapabilities,
  getKubernetesAiAccessLooseningChanges,
  getKubernetesAiAccessOfferedFields,
  getKubernetesAiAccessSettingsChanges,
  getKubernetesAiAccessSettingsInitialValues,
  getKubernetesAiCredentialAssignmentError,
  getKubernetesAiCredentialFieldDescription,
  getKubernetesRunnerPermissionTitles,
  isRemediationModeOpenToEveryEditor,
  isThisClustersAgentRunner,
  normalizeSavedKubectlAllowlist,
  parseKubectlAllowlistText,
  readKubernetesAiAccessSavedSettings,
  readStoredKubectlAllowlist,
  validateKubectlAllowlistText,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI";
import { getKubernetesInstallationMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { PermissionGateResult } from "../../../UI/Utils/PermissionGate";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import KubectlPolicy, {
  KUBECTL_ALLOWLIST_MAX_PATTERNS,
  KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH,
} from "../../../Utils/AiRemediation/KubectlPolicy";

/*
 * The pure pieces behind the cluster AI page's settings: who may loosen
 * what AI does (relative to the saved settings, as the server decides it),
 * what an edit actually sends, when a save is confirmed first, how the
 * allowlist is read and checked (by KubectlPolicy, the matcher's own
 * rules), which Runners and credentials the pickers offer, which card helps
 * connect a Runner, and the helm upgrades. The rendered page is covered by
 * KubernetesClusterAiPage.test.tsx; the server-side parity checks by
 * KubernetesClusterAiPageServerParity.test.ts.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const RUNNER_ID: string = "55555555-0000-4000-8000-000000000005";
const OTHER_RUNNER_ID: string = "55555555-0000-4000-8000-000000000006";
const CREDENTIAL_ID: string = "77777777-0000-4000-8000-000000000007";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const SET_IMAGE_PATTERN: string = "kubectl set image deployment/web * -n web";
const PATCH_PATTERN: string = "kubectl patch deployment/web -n web -p *";

// A line continuation left dangling at the end of a command.
const TRAILING_CONTINUATION_REGEX: RegExp = /\\\s*$/;
const CHART_VERSION_FLAG_REGEX: RegExp = /--version/;
const OLD_CHART_VERSION_REGEX: RegExp = /0\.7\.0/;
const MATCHES_NEARLY_EVERYTHING_REGEX: RegExp = /nearly/;
const ANY_IMAGE_ANY_SERVICE_ACCOUNT_REGEX: RegExp =
  /any image as any ServiceAccount/;

function grant(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([...permissions, ...blocked]);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: [
      ...permissions.map((permission: Permission) => {
        return {
          permission: permission,
          labelIds: [],
          _type: "UserPermission",
        };
      }),
      ...blocked.map((permission: Permission) => {
        return {
          permission: permission,
          labelIds: [],
          isBlockPermission: true,
          _type: "UserPermission",
        };
      }),
    ],
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

// The permission snapshot has not landed yet: nothing stored at all.
function grantNothingYet(): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
}

function makeSaved(
  overrides: Partial<KubernetesAiAccessSavedSettings> = {},
): KubernetesAiAccessSavedSettings {
  return {
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
    aiAccessRunnerId: RUNNER_ID,
    aiAccessRunnerName: "kubernetes-agent/prod-east",
    aiAccessCredentialId: null,
    aiAccessCredentialName: null,
    ...overrides,
  };
}

const NOTHING_OFFERED: KubernetesAiAccessOfferedFields = {
  allowlist: false,
  allowlistRemoveOnly: false,
  runner: false,
  credential: false,
  runnerClear: false,
  credentialClear: false,
};

const EVERYTHING_OFFERED: KubernetesAiAccessOfferedFields = {
  allowlist: true,
  allowlistRemoveOnly: false,
  runner: true,
  credential: true,
  runnerClear: false,
  credentialClear: false,
};

// What a cluster editor without the admin set and without the pickers gets.
const TIGHTEN_ONLY_OFFERED: KubernetesAiAccessOfferedFields = {
  allowlist: true,
  allowlistRemoveOnly: true,
  runner: false,
  credential: false,
  runnerClear: true,
  credentialClear: true,
};

type SettingsFormValues = FormValues<{
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: string;
  kubectlAllowlistText: string;
  aiAccessRunnerId: string;
  aiAccessCredentialId: string;
  clearAiAccessRunner: boolean;
  clearAiAccessCredential: boolean;
}>;

// What the form holds for a saved state, with the given edits applied.
function formValues(
  saved: KubernetesAiAccessSavedSettings,
  edits: Record<string, unknown> = {},
): SettingsFormValues {
  return {
    ...getKubernetesAiAccessSettingsInitialValues(saved),
    ...edits,
  } as SettingsFormValues;
}

// A Runner row; `clusterIdentifier` gives it an in-cluster agent posture.
function makeRunner(
  id: string,
  name: string,
  canRunAiCommands: boolean = true,
  clusterIdentifier?: string,
): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    canRunAiCommands,
    ...(clusterIdentifier
      ? {
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: false,
              clusterIdentifier,
            },
          },
        }
      : {}),
  });
}

function makeCredential(
  id: string,
  name: string,
  runnerIds: Array<string> | undefined,
  credentialType: RunbookCredentialType = RunbookCredentialType.Kubernetes,
): RunbookCredential {
  return Object.assign(new RunbookCredential(), {
    _id: id,
    name,
    credentialType,
    ...(runnerIds
      ? {
          runners: runnerIds.map((runnerId: string): Runner => {
            return Object.assign(new Runner(), { _id: runnerId });
          }),
        }
      : {}),
  });
}

function optionValues(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return String(option.value);
  });
}

function optionLabel(
  options: Array<DropdownOption>,
  value: string,
): string | undefined {
  return options.find((option: DropdownOption): boolean => {
    return option.value === value;
  })?.label;
}

beforeEach(() => {
  grant([...BASE_PERMISSIONS, Permission.ProjectMember]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("helm upgrades", () => {
  /*
   * The finding: the page printed `helm upgrade oneuptime-agent ...
   * --namespace oneuptime-kubernetes-agent`, while the Dashboard's own
   * install instructions install `kubernetes-agent` into `oneuptime-agent`.
   * helm answers a missing release with "has no deployed releases", so a
   * cluster installed the way the product said could not connect. The pair
   * is now one exported constant pair in DocumentationMarkdown.ts.
   */
  const installMarkdown: string = getKubernetesInstallationMarkdown({
    clusterName: "prod-east",
    oneuptimeUrl: "https://oneuptime.example.com",
    apiKey: "key",
  });

  function allCommands(): Array<string> {
    const commands: AiAccessHelmCommands = getAiAccessHelmCommands();
    return Object.values(commands);
  }

  function installPairs(): Array<{ release: string; namespace: string }> {
    const pairs: Array<{ release: string; namespace: string }> = [];
    const pattern: RegExp =
      /helm (?:install|upgrade) (\S+) oneuptime\/kubernetes-agent[\s\\]+--namespace (\S+)/g;
    let match: RegExpExecArray | null = pattern.exec(installMarkdown);
    while (match) {
      pairs.push({ release: match[1]!, namespace: match[2]! });
      match = pattern.exec(installMarkdown);
    }
    return pairs;
  }

  test("uses the release and namespace of the Dashboard's install instructions", () => {
    const pairs: Array<{ release: string; namespace: string }> = installPairs();

    // Harness guard: the parse found the install commands to compare with.
    expect(pairs.length).toBeGreaterThan(0);

    for (const pair of pairs) {
      expect(pair).toEqual({
        release: KUBERNETES_AGENT_HELM_RELEASE,
        namespace: KUBERNETES_AGENT_HELM_NAMESPACE,
      });
    }

    for (const command of allCommands()) {
      expect(command).toContain(
        `helm upgrade ${pairs[0]!.release} oneuptime/kubernetes-agent`,
      );
      expect(command).toContain(`--namespace ${pairs[0]!.namespace}`);
      expect(command).not.toContain("oneuptime-kubernetes-agent");
      expect(command).toContain("--reuse-values");
    }
  });

  test("the install markdown names the namespace and release only through the shared pair", () => {
    // Every -n / --namespace / uninstall in the instructions uses the pair.
    const namespaces: Array<string> = Array.from(
      installMarkdown.matchAll(/(?:--namespace|-n) ([\w.-]+)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(namespaces.length).toBeGreaterThan(5);
    for (const namespace of namespaces) {
      expect(namespace).toBe(KUBERNETES_AGENT_HELM_NAMESPACE);
    }
    expect(installMarkdown).toContain(
      `helm uninstall ${KUBERNETES_AGENT_HELM_RELEASE} --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
    );
    expect(installMarkdown).toContain(
      `deployment/${KUBERNETES_AGENT_HELM_RELEASE}`,
    );
  });

  /*
   * Every command, not only the read-only one: the write-access commands
   * are offered on their own, so an operator who runs one directly on an
   * old chart index would otherwise hit "Additional property aiAccess is
   * not allowed".
   */
  test("every command updates the chart index first", () => {
    expect(allCommands()).toHaveLength(3);
    for (const command of allCommands()) {
      expect(command.startsWith("helm repo update\n")).toBe(true);
      expect(command.indexOf("helm repo update")).toBeLessThan(
        command.indexOf("helm upgrade"),
      );
    }
  });

  test("the default command grants read-only access", () => {
    const readOnly: string = getAiAccessHelmCommands().readOnly;
    expect(readOnly).toContain("--set aiAccess.enabled=true");
    expect(readOnly).not.toContain("remediation");
  });

  test("the recommended write-access command binds the write role only in the listed namespaces and keeps fixes off nodes", () => {
    const scoped: string = getAiAccessHelmCommands().enableRemediationScoped;
    expect(scoped).toContain("--set aiAccess.enabled=true");
    expect(scoped).toContain("--set aiAccess.remediation.enabled=true");
    expect(scoped).toContain(
      `--set "aiAccess.remediation.namespaces=${AI_ACCESS_EXAMPLE_WRITE_NAMESPACES}"`,
    );
    expect(scoped).toContain("--set aiAccess.remediation.nodeOperations=false");

    const clusterWide: string = getAiAccessHelmCommands().enableRemediation;
    expect(clusterWide).toContain("--set aiAccess.remediation.enabled=true");
    expect(clusterWide).not.toContain("aiAccess.remediation.namespaces");
  });

  test("every command is complete, never a line to append", () => {
    for (const command of allCommands()) {
      // No trailing line continuation: the shell would wait for more input.
      expect(TRAILING_CONTINUATION_REGEX.test(command)).toBe(false);

      // Every continued line is followed by a real one.
      const lines: Array<string> = command.split("\n");
      lines.forEach((line: string, index: number) => {
        if (line.trimEnd().endsWith("\\")) {
          expect((lines[index + 1] || "").trim().length).toBeGreaterThan(0);
        }
      });
    }
  });

  test("names no chart version (published charts carry the OneUptime version)", () => {
    for (const command of allCommands()) {
      expect(command).not.toMatch(CHART_VERSION_FLAG_REGEX);
      expect(command).not.toMatch(OLD_CHART_VERSION_REGEX);
    }
  });

  /*
   * The chart docs must say what write RBAC amounts to wherever write
   * access is offered; this page is where customers copy the command.
   */
  test("the write-access disclosure says what patch access amounts to and where the policy holds the line", () => {
    const disclosure: string = getAiAccessWriteDisclosure();
    expect(disclosure).toMatch(ANY_IMAGE_ANY_SERVICE_ACCOUNT_REGEX);
    expect(disclosure).toContain("reading its Secrets");
    expect(disclosure).toContain("aiAccess.remediation.namespaces");
    expect(disclosure).toContain("aiAccess.remediation.nodeOperations=false");
    expect(disclosure).toContain("own namespace");
    for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
      expect(disclosure).toContain(namespace);
    }
  });
});

describe("the bound Runner's write access", () => {
  test("says where an in-cluster Runner may write", () => {
    expect(describeRunnerWriteAccess(undefined)).toBeNull();
    // A Runner outside the cluster: its credential's RBAC decides.
    expect(describeRunnerWriteAccess({ inCluster: false })).toBeNull();
    expect(
      describeRunnerWriteAccess({ inCluster: true, allowWrites: false }),
    ).toBe("read-only RBAC");
    // Absent: an older Runner that did not say.
    expect(
      describeRunnerWriteAccess({ inCluster: true, allowWrites: true }),
    ).toBe("writes allowed");
    expect(
      describeRunnerWriteAccess({
        inCluster: true,
        allowWrites: true,
        writeNamespaces: [],
      }),
    ).toBe("writes allowed cluster-wide");
    expect(
      describeRunnerWriteAccess({
        inCluster: true,
        allowWrites: true,
        writeNamespaces: ["web", "api"],
        allowNodeOperations: false,
      }),
    ).toBe("writes allowed in web, api, no node operations");
  });
});

describe("the connect card", () => {
  const baseStatus: KubernetesClusterAiAccessStatus = {
    clusterId: "c1",
    clusterName: "prod-east",
    clusterIdentifier: "prod-east",
    runner: {
      id: RUNNER_ID,
      name: "kubernetes-agent/prod-east",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: false },
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: "2026-09-22T10:00:00.000Z",
  };

  function gap(
    code: KubernetesAiAccessGap["code"],
    nextStep: string,
  ): KubernetesAiAccessGap {
    return { code, title: code, description: code, nextStep, blocks: "both" };
  }

  test("offers the helm upgrade while no Runner is bound and none is installed", () => {
    expect(
      getAiAccessConnectCardMode({
        ...baseStatus,
        runner: null,
        gaps: [
          gap(
            "no_runner_bound",
            "Upgrade the Kubernetes agent with --set aiAccess.enabled=true to install an in-cluster Runner (one command), or bind an existing Runner and a Kubernetes credential on this cluster's AI page.",
          ),
        ],
      }),
    ).toBe("connect");
    expect(
      getAiAccessConnectCardMode({
        ...baseStatus,
        gaps: [gap("runner_missing", "Reload this page.")],
      }),
    ).toBe("connect");
  });

  /*
   * Known follow-up 7: the in-cluster Runner is registered but not
   * selected. Re-running helm would change nothing, so the helm card is
   * replaced by "select it".
   */
  test("asks to select the Runner when this cluster's in-cluster Runner is installed but not selected", () => {
    expect(
      getAiAccessConnectCardMode({
        ...baseStatus,
        runner: null,
        gaps: [
          gap(
            "no_runner_bound",
            'Select the kubernetes-agent Runner "kubernetes-agent/prod-east" as this cluster\'s Runner on this page (leave the credential empty). No helm change is needed.',
          ),
        ],
      }),
    ).toBe("select_agent_runner");
  });

  test("shows no connect card once a Runner is bound, whatever else is missing", () => {
    expect(getAiAccessConnectCardMode(baseStatus)).toBe("none");
    expect(
      getAiAccessConnectCardMode({
        ...baseStatus,
        gaps: [
          gap(
            "credential_on_agent_runner",
            "Create a Runner under Project Settings → Runners, assign the Kubernetes credential to it and select both on this page — or install the in-cluster Runner on THIS cluster with --set aiAccess.enabled=true, which needs no credential.",
          ),
          gap(
            "remediation_write_access_missing",
            "Upgrade the agent with --set aiAccess.remediation.enabled=true.",
          ),
        ],
      }),
    ).toBe("none");
  });
});

describe("kubectl allowlist text", () => {
  test("is one pattern per line, blank lines and extra spaces dropped", () => {
    expect(
      parseKubectlAllowlistText(
        "kubectl rollout restart deployment/web -n web\n\n   kubectl   scale  deployment/api --replicas=* -n api  \r\n",
      ),
    ).toEqual([
      "kubectl rollout restart deployment/web -n web",
      "kubectl scale deployment/api --replicas=* -n api",
    ]);
    expect(parseKubectlAllowlistText("")).toEqual([]);
    expect(parseKubectlAllowlistText(undefined)).toEqual([]);
    expect(parseKubectlAllowlistText(["kubectl x"])).toEqual([]);
  });

  test("accepts kubectl patterns, including an empty list", () => {
    expect(validateKubectlAllowlistText("")).toBeNull();
    expect(validateKubectlAllowlistText(SET_IMAGE_PATTERN)).toBeNull();
    expect(
      validateKubectlAllowlistText(`${SET_IMAGE_PATTERN}\n${PATCH_PATTERN}`),
    ).toBeNull();
    // Broad but well-formed: accepted here, confirmed on save.
    expect(validateKubectlAllowlistText("*")).toBeNull();
    expect(validateKubectlAllowlistText("kubectl * * * -n *")).toBeNull();
  });

  /*
   * The matcher reads a pattern with or without the leading "kubectl" (it
   * tokenizes patterns like commands), so the form accepts both; the old
   * form refused "set image …" although the matcher would have used it.
   */
  test("accepts a pattern without the leading kubectl, as the matcher does", () => {
    expect(
      validateKubectlAllowlistText("set image deployment/web * -n web"),
    ).toBeNull();
  });

  test("refuses a bare kubectl, which names no command", () => {
    expect(validateKubectlAllowlistText("kubectl")).toMatch(/^Pattern 1: /);
    // The old message taught the whole-string glob reading.
    expect(validateKubectlAllowlistText("kubectl")).not.toMatch(
      /matched against the whole command/,
    );
    // Negative control: a real command right next to it passes.
    expect(validateKubectlAllowlistText("kubectl get pods")).toBeNull();
    expect(
      validateKubectlAllowlistText(`${SET_IMAGE_PATTERN}\nkubectl`),
    ).toMatch(/^Pattern 2:/);
  });

  test("refuses a pattern the matcher cannot split into words", () => {
    expect(
      validateKubectlAllowlistText(
        `kubectl patch deployment web -p '{"a":1} -n web`,
      ),
    ).toMatch(/^Pattern 1: /);
  });

  test("refuses more patterns, or longer ones, than the policy reads", () => {
    const tooMany: string = Array.from(
      { length: KUBECTL_ALLOWLIST_MAX_PATTERNS + 1 },
      (_value: unknown, index: number): string => {
        return `kubectl rollout restart deployment/web-${index} -n web`;
      },
    ).join("\n");
    expect(validateKubectlAllowlistText(tooMany)).toMatch(/At most 100/);

    const exactlyMax: string = tooMany.split("\n").slice(1).join("\n");
    expect(validateKubectlAllowlistText(exactlyMax)).toBeNull();

    const tooLong: string = `kubectl ${"x".repeat(
      KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH,
    )}`;
    expect(validateKubectlAllowlistText(tooLong)).toMatch(/at most 500/);
  });

  /*
   * One definition of validity: the form refuses a line exactly when
   * KubectlPolicy says the matcher cannot use it.
   */
  test("refuses a line exactly when KubectlPolicy.describeAllowlistPatternProblem does", () => {
    for (const pattern of [
      "kubectl",
      "*foo bar",
      "set image deployment/web * -n web",
      "kubectl  get   pods",
      SET_IMAGE_PATTERN,
      "Kubectl scale deployment/web --replicas=3 -n web",
      "* * -n web",
      `kubectl patch deployment web -p '{"a":1} -n web`,
      `kubectl ${"x".repeat(KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH)}`,
    ]) {
      const policyProblem: string | null =
        KubectlPolicy.describeAllowlistPatternProblem(
          parseKubectlAllowlistText(pattern)[0],
        );
      expect({
        pattern,
        refused: validateKubectlAllowlistText(pattern) !== null,
      }).toEqual({ pattern, refused: policyProblem !== null });
    }
  });
});

describe("the stored allowlist", () => {
  test("is read the way the server reads it", () => {
    const cases: Array<{ value: unknown; expected: SavedKubectlAllowlist }> = [
      { value: null, expected: { patterns: [], isClean: true } },
      { value: undefined, expected: { patterns: [], isClean: true } },
      { value: [], expected: { patterns: [], isClean: true } },
      {
        value: [SET_IMAGE_PATTERN],
        expected: { patterns: [SET_IMAGE_PATTERN], isClean: true },
      },
      {
        value: JSON.stringify([SET_IMAGE_PATTERN]),
        expected: { patterns: [SET_IMAGE_PATTERN], isClean: true },
      },
      // Unusable: the server uses these as an empty allowlist.
      {
        value: { patterns: [SET_IMAGE_PATTERN] },
        expected: { patterns: [], isClean: false },
      },
      { value: 42, expected: { patterns: [], isClean: false } },
      {
        value: [1, "", SET_IMAGE_PATTERN],
        expected: { patterns: [SET_IMAGE_PATTERN], isClean: false },
      },
      /*
       * A string that is not JSON is ONE pattern to the server (its
       * readStoredKubectlAllowlist and the status's normalizeAllowlist),
       * so the policy uses it; it used to read here as no pattern at all.
       */
      {
        value: "kubectl *",
        expected: { patterns: ["kubectl *"], isClean: false },
      },
    ];

    for (const testCase of cases) {
      expect(normalizeSavedKubectlAllowlist(testCase.value)).toEqual(
        testCase.expected,
      );
    }
  });

  test("keeps the stored spelling where the form collapses whitespace", () => {
    expect(
      readStoredKubectlAllowlist(["  kubectl  scale   deployment/web  ", ""]),
    ).toEqual(["kubectl  scale   deployment/web"]);
    expect(
      normalizeSavedKubectlAllowlist(["  kubectl  scale   deployment/web  "])
        .patterns,
    ).toEqual(["kubectl scale deployment/web"]);
  });
});

describe("reading the saved settings", () => {
  test("takes the binding from the FK column or the relation", () => {
    const fromRelation: KubernetesAiAccessSavedSettings =
      readKubernetesAiAccessSavedSettings(
        Object.assign(new KubernetesCluster(), {
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
          aiAccessRunner: Object.assign(new Runner(), {
            _id: RUNNER_ID,
            name: "kubernetes-agent/prod-east",
          }),
        }),
      );
    expect(fromRelation.aiAccessRunnerId).toBe(RUNNER_ID);
    expect(fromRelation.aiAccessRunnerName).toBe("kubernetes-agent/prod-east");
    expect(fromRelation.aiAccessCredentialId).toBeNull();

    const fromColumn: KubernetesAiAccessSavedSettings =
      readKubernetesAiAccessSavedSettings(
        Object.assign(new KubernetesCluster(), {
          aiAccessRunnerId: new ObjectID(RUNNER_ID),
          aiAccessCredentialId: new ObjectID(CREDENTIAL_ID),
        }),
      );
    expect(fromColumn.aiAccessRunnerId).toBe(RUNNER_ID);
    expect(fromColumn.aiAccessCredentialId).toBe(CREDENTIAL_ID);
    // Missing switches read as the column defaults.
    expect(fromColumn.isAiInvestigationEnabled).toBe(false);
    expect(fromColumn.aiRemediationMode).toBe(
      KubernetesAiRemediationMode.Disabled,
    );
  });

  test("seeds the form with the allowlist as lines and both clear switches off", () => {
    const initial: SettingsFormValues =
      getKubernetesAiAccessSettingsInitialValues(
        makeSaved({
          aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, "kubectl *"],
        }),
      );
    expect(initial.kubectlAllowlistText).toBe(
      `${SET_IMAGE_PATTERN}\nkubectl *`,
    );
    expect(initial.clearAiAccessRunner).toBe(false);
    expect(initial.clearAiAccessCredential).toBe(false);
  });
});

describe("what the edit modal offers", () => {
  test("an admin with both pickers gets the pickers and a free allowlist", () => {
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeSaved({ aiKubectlCommandAllowlist: [] }),
        canConfigureUnattended: true,
        isRunnerPickerAvailable: true,
        isCredentialPickerAvailable: true,
      }),
    ).toEqual(EVERYTHING_OFFERED);
  });

  /*
   * The finding (SIA-4, XP-7): the server, the docs and the gap copy
   * promise every cluster editor they may clear the Runner, credential and
   * allowlist, and the page offered them none of it.
   */
  test("a cluster editor without the admin set may remove patterns and unbind what is bound", () => {
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeSaved({ aiAccessCredentialId: CREDENTIAL_ID }),
        canConfigureUnattended: false,
        isRunnerPickerAvailable: false,
        isCredentialPickerAvailable: false,
      }),
    ).toEqual(TIGHTEN_ONLY_OFFERED);
  });

  test("nothing to remove or unbind means no allowlist field and no clear switch", () => {
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeSaved({
          aiKubectlCommandAllowlist: [],
          aiAccessRunnerId: null,
          aiAccessRunnerName: null,
        }),
        canConfigureUnattended: false,
        isRunnerPickerAvailable: false,
        isCredentialPickerAvailable: false,
      }),
    ).toEqual({
      ...NOTHING_OFFERED,
      allowlistRemoveOnly: true,
    });

    // An unclean stored allowlist is offered, so it can be cleared.
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeSaved({ aiKubectlCommandAllowlist: { a: 1 } }),
        canConfigureUnattended: false,
        isRunnerPickerAvailable: false,
        isCredentialPickerAvailable: false,
      }).allowlist,
    ).toBe(true);
  });

  test("an admin who may not list Runners may still unbind the bound one", () => {
    const offered: KubernetesAiAccessOfferedFields =
      getKubernetesAiAccessOfferedFields({
        saved: makeSaved(),
        canConfigureUnattended: true,
        isRunnerPickerAvailable: false,
        isCredentialPickerAvailable: true,
      });
    expect(offered.runner).toBe(false);
    expect(offered.runnerClear).toBe(true);
    expect(offered.credential).toBe(true);
    expect(offered.credentialClear).toBe(false);
  });
});

describe("which modes a cluster editor without the admin set may choose", () => {
  test("every mode at or below the saved one", () => {
    function openModes(saved: KubernetesAiRemediationMode): Array<string> {
      return REMEDIATION_MODES_BY_AUTONOMY.filter(
        (mode: KubernetesAiRemediationMode): boolean => {
          return isRemediationModeOpenToEveryEditor(mode, saved);
        },
      );
    }

    expect(openModes(KubernetesAiRemediationMode.Disabled)).toEqual([
      KubernetesAiRemediationMode.Disabled,
      KubernetesAiRemediationMode.RequireApproval,
    ]);
    expect(openModes(KubernetesAiRemediationMode.Automatic)).toEqual([
      KubernetesAiRemediationMode.Disabled,
      KubernetesAiRemediationMode.RequireApproval,
      KubernetesAiRemediationMode.Automatic,
    ]);
    // Bypass approval -> Automatic is a step down, open to every editor.
    expect(openModes(KubernetesAiRemediationMode.BypassApproval)).toEqual(
      REMEDIATION_MODES_BY_AUTONOMY,
    );
  });
});

describe("what an edit sends", () => {
  /*
   * The finding: ModelForm submits every field, so an editor who only
   * switched investigation off re-sent the unchanged Automatic mode, the
   * allowlist and the Runner binding — writes the server refuses without
   * the admin permissions. Only the change may be sent.
   */
  test("an editor who only toggles investigation sends only that", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved();
    for (const offered of [
      NOTHING_OFFERED,
      EVERYTHING_OFFERED,
      TIGHTEN_ONLY_OFFERED,
    ]) {
      expect(
        getKubernetesAiAccessSettingsChanges({
          saved,
          values: formValues(saved, { isAiInvestigationEnabled: false }),
          offered,
        }),
      ).toEqual({ isAiInvestigationEnabled: false });
    }
  });

  test("an untouched form sends nothing", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiAccessCredentialId: CREDENTIAL_ID,
    });
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({});
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved),
        offered: TIGHTEN_ONLY_OFFERED,
      }),
    ).toEqual({});
  });

  test("tightening the mode sends the mode", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved();
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, {
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
        offered: NOTHING_OFFERED,
      }),
    ).toEqual({ aiRemediationMode: KubernetesAiRemediationMode.Disabled });
  });

  test("reads a dropdown value handed over as an option", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved();
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, {
          aiRemediationMode: {
            value: KubernetesAiRemediationMode.RequireApproval,
            label: "Ask",
          },
        }),
        offered: NOTHING_OFFERED,
      }),
    ).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    });
  });

  test("ignores a mode that is not a mode", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved();
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, { aiRemediationMode: "automatic" }),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({});
  });

  test("sends the allowlist only when its patterns changed", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved();

    // Reformatting is not a change.
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, {
          kubectlAllowlistText: `\n  ${SET_IMAGE_PATTERN.replace(/ /g, "  ")}  \n\n`,
        }),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({});

    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, {
          kubectlAllowlistText: `${SET_IMAGE_PATTERN}\n${PATCH_PATTERN}`,
        }),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, PATCH_PATTERN],
    });

    // Clearing sends an empty list.
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, { kubectlAllowlistText: "" }),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({ aiKubectlCommandAllowlist: [] });
  });

  /*
   * The server decides "does this write add a pattern?" on the stored
   * strings. A line the form shows collapsed is sent in its stored
   * spelling, or removing one line would read as adding another.
   */
  test("sends every kept line in its stored spelling", () => {
    const oddlySpaced: string =
      "kubectl  scale   deployment/web --replicas=* -n web";
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, oddlySpaced],
    });

    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, {
          kubectlAllowlistText:
            "kubectl scale deployment/web --replicas=* -n web",
        }),
        offered: TIGHTEN_ONLY_OFFERED,
      }),
    ).toEqual({ aiKubectlCommandAllowlist: [oddlySpaced] });
  });

  test("replaces a stored allowlist the policy cannot use", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiKubectlCommandAllowlist: { patterns: [SET_IMAGE_PATTERN] },
    });
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({ aiKubectlCommandAllowlist: [] });

    // Not offered: never written, whatever it holds.
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, { kubectlAllowlistText: "kubectl *" }),
        offered: NOTHING_OFFERED,
      }),
    ).toEqual({});
  });

  test("binds, re-binds and clears the Runner and credential only when offered", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiAccessCredentialId: CREDENTIAL_ID,
    });

    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, {
          aiAccessRunnerId: OTHER_RUNNER_ID,
          aiAccessCredentialId: null,
        }),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({
      aiAccessRunnerId: OTHER_RUNNER_ID,
      aiAccessCredentialId: null,
    });

    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, { aiAccessRunnerId: "" }),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({ aiAccessRunnerId: null });

    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, {
          aiAccessRunnerId: OTHER_RUNNER_ID,
          aiAccessCredentialId: null,
        }),
        offered: NOTHING_OFFERED,
      }),
    ).toEqual({});
  });

  test("a clear switch sends null and nothing else, and only when it is on", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiAccessCredentialId: CREDENTIAL_ID,
    });

    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, {
          clearAiAccessRunner: true,
          clearAiAccessCredential: true,
          kubectlAllowlistText: "",
        }),
        offered: TIGHTEN_ONLY_OFFERED,
      }),
    ).toEqual({
      aiAccessRunnerId: null,
      aiAccessCredentialId: null,
      aiKubectlCommandAllowlist: [],
    });

    // Switches off: nothing is sent.
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved),
        offered: TIGHTEN_ONLY_OFFERED,
      }),
    ).toEqual({});

    // A clear-only offer can never send an id, whatever the form holds.
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, {
          aiAccessRunnerId: OTHER_RUNNER_ID,
          aiAccessCredentialId: "77777777-0000-4000-8000-00000000000a",
          clearAiAccessRunner: false,
        }),
        offered: TIGHTEN_ONLY_OFFERED,
      }),
    ).toEqual({});

    // Not offered: the switch is ignored.
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, { clearAiAccessRunner: true }),
        offered: NOTHING_OFFERED,
      }),
    ).toEqual({});
  });

  test("the chosen Runner follows the picker, the clear switch, or the saved binding", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved();
    expect(
      getKubernetesAiAccessChosenRunnerId({
        saved,
        values: formValues(saved, {
          aiAccessRunnerId: { value: OTHER_RUNNER_ID, label: "x" },
        }),
        offered: EVERYTHING_OFFERED,
      }),
    ).toBe(OTHER_RUNNER_ID);
    expect(
      getKubernetesAiAccessChosenRunnerId({
        saved,
        values: formValues(saved, { clearAiAccessRunner: true }),
        offered: TIGHTEN_ONLY_OFFERED,
      }),
    ).toBeNull();
    expect(
      getKubernetesAiAccessChosenRunnerId({
        saved,
        values: formValues(saved),
        offered: NOTHING_OFFERED,
      }),
    ).toBe(RUNNER_ID);
  });
});

/*
 * The server's rule (KubernetesClusterService.getAiAccessLoosening) is
 * RELATIVE to the saved settings; the page used an absolute one — any
 * unattended mode, any non-empty allowlist — and so hid tightening the
 * server accepts. KubernetesClusterAiPageServerParity.test.ts runs the same
 * cases through the server.
 */
describe("loosening changes", () => {
  test("moving the mode up to an unattended mode loosens; moving it down never does", () => {
    const fromAutomatic: KubernetesAiAccessSavedSettings = makeSaved();
    const fromBypass: KubernetesAiAccessSavedSettings = makeSaved({
      aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
    });
    const fromOff: KubernetesAiAccessSavedSettings = makeSaved({
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    });

    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromAutomatic,
        changes: {
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        },
      }),
    ).toEqual(["switching AI remediation to Bypass approval"]);
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromOff,
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
      }),
    ).toEqual(["switching AI remediation to Automatic"]);

    // Bypass approval -> Automatic is a tightening.
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromBypass,
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
      }),
    ).toEqual([]);
    for (const mode of [
      KubernetesAiRemediationMode.Disabled,
      KubernetesAiRemediationMode.RequireApproval,
    ]) {
      expect(
        getKubernetesAiAccessLooseningChanges({
          saved: fromOff,
          changes: { aiRemediationMode: mode },
        }),
      ).toEqual([]);
    }
  });

  test("adding a pattern loosens; removing patterns or clearing the list never does", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, PATCH_PATTERN],
    });

    expect(
      getKubernetesAiAccessLooseningChanges({
        saved,
        changes: { aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN] },
      }),
    ).toEqual([]);
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved,
        changes: { aiKubectlCommandAllowlist: [] },
      }),
    ).toEqual([]);
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved,
        changes: { aiKubectlCommandAllowlist: null },
      }),
    ).toEqual([]);

    expect(
      getKubernetesAiAccessLooseningChanges({
        saved,
        changes: {
          aiKubectlCommandAllowlist: [
            SET_IMAGE_PATTERN,
            "kubectl delete pod * -n web",
          ],
        },
      }),
    ).toEqual([
      'adding the kubectl allowlist pattern "kubectl delete pod * -n web"',
    ]);

    // Editing a pattern into another string is adding one.
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved,
        changes: {
          aiKubectlCommandAllowlist: [
            "kubectl set image deployment/web * -n prod",
          ],
        },
      }),
    ).toHaveLength(1);
  });

  test("binding another Runner or a credential loosens; unbinding or re-sending the bound one never does", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiAccessCredentialId: CREDENTIAL_ID,
    });

    expect(
      getKubernetesAiAccessLooseningChanges({
        saved,
        changes: { aiAccessRunnerId: OTHER_RUNNER_ID },
      }),
    ).toEqual(["binding a different Runner"]);
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: makeSaved(),
        changes: { aiAccessCredentialId: CREDENTIAL_ID },
      }),
    ).toEqual(["binding a Kubernetes credential"]);

    for (const changes of [
      { aiAccessRunnerId: null },
      { aiAccessCredentialId: null },
      { aiAccessRunnerId: RUNNER_ID },
      { aiAccessCredentialId: CREDENTIAL_ID },
      { isAiInvestigationEnabled: true },
      { isAiInvestigationEnabled: false },
    ] as Array<JSONObject>) {
      expect(getKubernetesAiAccessLooseningChanges({ saved, changes })).toEqual(
        [],
      );
    }
  });
});

describe("the remove-only allowlist", () => {
  const stored: Array<string> = [
    SET_IMAGE_PATTERN,
    "kubectl  scale   deployment/web --replicas=* -n web",
  ];

  test("accepts removing lines, clearing the list and re-spacing a kept line", () => {
    for (const text of [
      SET_IMAGE_PATTERN,
      "",
      `${SET_IMAGE_PATTERN}\nkubectl scale deployment/web --replicas=* -n web`,
    ]) {
      expect(
        getKubectlAllowlistRemovalOnlyError({ text, storedValue: stored }),
      ).toBeNull();
    }
  });

  test("refuses a new line, or an edited one, naming the permissions that would allow it", () => {
    const error: string | null = getKubectlAllowlistRemovalOnlyError({
      text: `${SET_IMAGE_PATTERN}\nkubectl set image deployment/web * -n prod`,
      storedValue: stored,
    });
    expect(error).toMatch(
      /^Pattern 2 \("kubectl set image deployment\/web \* -n prod"\)/,
    );
    for (const title of getKubernetesAiAccessAdminPermissionTitles()) {
      expect(error).toContain(title);
    }
  });
});

/*
 * The confirmation is the UI's safety net for an allowlist that behaves
 * like Bypass approval. It used a whole-string glob reading ("*",
 * "kubectl *" were broad; anything with a literal "-n" was not), while the
 * matcher is word by word: "kubectl * * * -n *" auto-approves deleting any
 * Deployment in any non-protected namespace and was never confirmed. Broad
 * is now KubectlPolicy.isBroadAllowlistPattern, decided on the matcher's
 * own tokens, and the parity check below runs the real matcher.
 */
describe("confirming a save that lets riskier changes run unattended", () => {
  function expectNamesWhatItUnlocks(
    confirmation: KubernetesAiAccessConfirmation | null,
  ): void {
    expect(confirmation).not.toBeNull();
    const text: string = confirmation!.description;
    for (const word of ["set image", "patch", "drain", "deleting workloads"]) {
      expect(text).toContain(word);
    }
    // What still never runs unattended is said too.
    expect(text).toMatch(/never run/);
    expect(text).toContain("kube-system");
    // The old copy taught the whole-string glob reading.
    expect(text).not.toMatch(MATCHES_NEARLY_EVERYTHING_REGEX);
  }

  test("is asked before Bypass approval", () => {
    const confirmation: KubernetesAiAccessConfirmation | null =
      getKubernetesAiAccessConfirmation({
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
        changes: {
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        },
      });
    expectNamesWhatItUnlocks(confirmation);
    expect(confirmation!.title).toMatch(/Bypass approval/);
  });

  test("is asked before a pattern with a wildcard verb, object or namespace", () => {
    for (const broad of [
      "kubectl * * * -n *",
      "kubectl * * * * -n *",
      "kubectl * * -n *",
      "kubectl delete * * -n *",
      "kubectl * deployment web -n web",
      "* * * -n *",
      // A wildcard verb, even in one named namespace (chart-docs test gap).
      "* * -n web",
      "kubectl *",
    ]) {
      const confirmation: KubernetesAiAccessConfirmation | null =
        getKubernetesAiAccessConfirmation({
          saved: makeSaved(),
          changes: {
            aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, broad],
          },
        });
      expectNamesWhatItUnlocks(confirmation);
      expect(confirmation!.description).toContain(`"${broad}"`);
      expect(confirmation!.description).toContain("In Automatic mode");
      expect(confirmation!.description).toContain(
        "a wildcard for the verb, the object or the namespace",
      );
    }
  });

  test("warns ahead when the broad allowlist is saved outside Automatic mode", () => {
    const confirmation: KubernetesAiAccessConfirmation | null =
      getKubernetesAiAccessConfirmation({
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
          aiKubectlCommandAllowlist: [],
        }),
        changes: { aiKubectlCommandAllowlist: ["kubectl * * * -n *"] },
      });
    expectNamesWhatItUnlocks(confirmation);
    expect(confirmation!.description).toContain("Once this cluster is");
  });

  test("is asked when Automatic mode switches on over a saved broad allowlist", () => {
    expectNamesWhatItUnlocks(
      getKubernetesAiAccessConfirmation({
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
          aiKubectlCommandAllowlist: ["kubectl * * * -n *"],
        }),
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
      }),
    );
  });

  test("is not asked for anything else", () => {
    const quiet: Array<{
      saved: KubernetesAiAccessSavedSettings;
      changes: JSONObject;
    }> = [
      // Narrow allowlist, any mode change short of Bypass.
      {
        saved: makeSaved(),
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
      },
      {
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
      },
      // Narrow patterns: one object in one namespace, a wildcard only in a value.
      {
        saved: makeSaved(),
        changes: {
          aiKubectlCommandAllowlist: [
            SET_IMAGE_PATTERN,
            "kubectl delete deployment web -n prod",
            "kubectl rollout restart deployment/web -n web",
            "kubectl scale deployment/web --replicas=* -n web",
          ],
        },
      },
      // An already-saved broad pattern is not re-confirmed on unrelated edits.
      {
        saved: makeSaved({ aiKubectlCommandAllowlist: ["kubectl * * * -n *"] }),
        changes: { isAiInvestigationEnabled: false },
      },
      {
        saved: makeSaved({ aiKubectlCommandAllowlist: ["kubectl * * * -n *"] }),
        changes: {
          aiKubectlCommandAllowlist: ["kubectl * * * -n *", SET_IMAGE_PATTERN],
        },
      },
      // Re-sent in its stored spelling: still the saved pattern.
      {
        saved: makeSaved({
          aiKubectlCommandAllowlist: ["kubectl  * * *  -n *"],
        }),
        changes: { aiKubectlCommandAllowlist: ["kubectl  * * *  -n *"] },
      },
      // Leaving Bypass approval — to Automatic too — or clearing the allowlist.
      {
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
        changes: {
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        },
      },
      {
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
          aiKubectlCommandAllowlist: ["kubectl * * * -n *"],
        }),
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
      },
      {
        saved: makeSaved({ aiKubectlCommandAllowlist: ["kubectl * * * -n *"] }),
        changes: { aiKubectlCommandAllowlist: [] },
      },
    ];

    for (const testCase of quiet) {
      expect({
        changes: testCase.changes,
        confirmation: getKubernetesAiAccessConfirmation(testCase),
      }).toEqual({ changes: testCase.changes, confirmation: null });
    }
  });

  /*
   * The parity check the finding asked for, run on the real matcher. Every
   * probe names an object and namespaces nobody would type into a pattern,
   * so a pattern that auto-approves a probe reaches objects and namespaces
   * it does not name. Each such pattern must be confirmed; each narrow
   * pattern must neither be confirmed nor reach the probes.
   */
  describe("agrees with the matcher that actually runs", () => {
    const PROBES: Array<string> = [];
    for (const namespaceFlag of [
      "",
      " -n zz-probe-ns",
      " -n zz-probe-ns-2",
      " --namespace zz-probe-ns",
      " --namespace=zz-probe-ns",
    ]) {
      PROBES.push(`kubectl delete deployment zz-probe-obj${namespaceFlag}`);
      PROBES.push(`kubectl delete statefulset zz-probe-obj${namespaceFlag}`);
      PROBES.push(
        `kubectl set image deployment/zz-probe-obj c=zz:1${namespaceFlag}`,
      );
    }
    PROBES.push(
      "kubectl set env deployment/zz-probe-obj A=B -n zz-probe-ns",
      `kubectl patch deployment zz-probe-obj -p '{"spec":{"replicas":2}}' -n zz-probe-ns`,
      "kubectl scale deployment/zz-probe-obj --replicas=0 -n zz-probe-ns",
      "kubectl delete deployment zz-probe-obj zz-probe-obj-2 -n zz-probe-ns",
      "kubectl rollout restart deployment -n zz-probe-ns",
      "kubectl drain zz-probe-obj",
      "kubectl taint nodes zz-probe-obj k=v:NoSchedule",
    );

    // Probes the empty allowlist leaves for a human: what a pattern could promote.
    const promotable: Array<string> = PROBES.filter(
      (command: string): boolean => {
        return (
          KubectlPolicy.evaluateForAutoExecution({
            command,
            allowlistPatterns: [],
          }).verdict === AiRemediationCommandPolicyVerdict.RequiresApproval
        );
      },
    );

    function promotedBy(pattern: string): Array<string> {
      return promotable.filter((command: string): boolean => {
        return (
          KubectlPolicy.evaluateForAutoExecution({
            command,
            allowlistPatterns: [pattern],
          }).verdict === AiRemediationCommandPolicyVerdict.AutoApproved
        );
      });
    }

    function confirmsFor(pattern: string): boolean {
      return (
        getKubernetesAiAccessConfirmation({
          saved: makeSaved({ aiKubectlCommandAllowlist: [] }),
          changes: { aiKubectlCommandAllowlist: [pattern] },
        }) !== null
      );
    }

    const CANDIDATES: Array<string> = [
      "*",
      "kubectl *",
      "kubectl * *",
      "kubectl * * *",
      "kubectl * * * *",
      "kubectl * * -n *",
      "kubectl * * * -n *",
      "kubectl * * * * -n *",
      "kubectl * * * -p * -n *",
      "kubectl * * * --namespace *",
      "kubectl * * * --namespace=*",
      "* * * -n *",
      "kubectl delete * * -n *",
      "kubectl delete deployment * -n *",
      "kubectl set image deployment/* * -n zz-probe-ns",
      "kubectl scale deployment/* --replicas=* -n zz-probe-ns",
      SET_IMAGE_PATTERN,
      "kubectl delete deployment web -n prod",
      "kubectl rollout restart deployment/web -n web",
      "kubectl scale deployment/web --replicas=* -n web",
    ];

    const NARROW: Array<string> = [
      SET_IMAGE_PATTERN,
      "kubectl delete deployment web -n prod",
      "kubectl rollout restart deployment/web -n web",
      "kubectl scale deployment/web --replicas=* -n web",
    ];

    test("harness guard: the probes are riskier changes a pattern can promote", () => {
      expect(promotable.length).toBeGreaterThanOrEqual(15);
      expect(promotedBy("kubectl * * * -n *").length).toBeGreaterThan(0);
      expect(promotedBy("kubectl * * * * -n *").length).toBeGreaterThan(0);
      expect(promotedBy("kubectl * * * -p * -n *").length).toBeGreaterThan(0);
    });

    test("every pattern that reaches objects or namespaces it does not name is confirmed", () => {
      for (const pattern of CANDIDATES) {
        const promoted: Array<string> = promotedBy(pattern);
        if (promoted.length === 0) {
          continue;
        }
        expect({ pattern, promoted, confirmed: confirmsFor(pattern) }).toEqual({
          pattern,
          promoted,
          confirmed: true,
        });
      }
    });

    test("narrow patterns are neither confirmed nor reach other objects or namespaces", () => {
      for (const pattern of NARROW) {
        expect({
          pattern,
          confirmed: confirmsFor(pattern),
          promoted: promotedBy(pattern),
        }).toEqual({ pattern, confirmed: false, promoted: [] });
      }
    });
  });
});

describe("Runner picker options", () => {
  const runners: Array<Runner> = [
    makeRunner("r-this", "kubernetes-agent/prod-east", true, "prod-east"),
    makeRunner("r-other-cluster", "kubernetes-agent/prod-eu", true, "prod-eu"),
    makeRunner("r-host", "bash-runner"),
    makeRunner("r-off", "ops-runner", false),
  ];

  test("offer only Runners that can serve this cluster, its own agent first", () => {
    const options: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
      runners,
      clusterIdentifier: "prod-east",
      boundRunnerId: null,
      boundRunnerName: null,
    });

    expect(optionValues(options)).toEqual(["r-this", "r-host"]);
    expect(options[0]!.label).toMatch(/in-cluster Runner for this cluster/);
  });

  test("match this cluster's agent Runner whatever the identifier's casing", () => {
    expect(
      optionValues(
        buildKubernetesAiRunnerOptions({
          runners,
          clusterIdentifier: "Prod-East",
          boundRunnerId: null,
          boundRunnerName: null,
        }),
      ),
    ).toEqual(["r-this", "r-host"]);
  });

  test("offer no agent Runner when the cluster has no identifier", () => {
    expect(
      optionValues(
        buildKubernetesAiRunnerOptions({
          runners,
          clusterIdentifier: undefined,
          boundRunnerId: null,
          boundRunnerName: null,
        }),
      ),
    ).toEqual(["r-host"]);
  });

  /*
   * The finding (dashboard-ai-page-2): the server names an agent Runner
   * "kubernetes-agent/<id>" only while that fits 100 characters, and
   * "kubernetes-agent/<head>-<hash>" beyond. The picker rebuilt the name
   * from the identifier, so for an identifier of 84+ characters it hid
   * this cluster's own Runner, or called it another cluster's. It now
   * matches the Runner's posture, as the server does.
   */
  describe("a cluster identifier long enough for the server to shorten the Runner name", () => {
    const longIdentifier: string =
      "arn:aws:eks:ap-southeast-2:123456789012:cluster/payments-platform-production-blue-green";
    const otherLongIdentifier: string =
      "arn:aws:eks:ap-southeast-2:123456789012:cluster/payments-platform-producti-other-region";
    const head: string = `kubernetes-agent/${longIdentifier.slice(0, 74)}`;
    const thisRunner: Runner = makeRunner(
      "r-long",
      `${head}-fe7fc1b3`,
      true,
      longIdentifier,
    );
    // Same head, another hash: another long-named cluster's Runner.
    const otherRunner: Runner = makeRunner(
      "r-long-other",
      `${head}-0a1b2c3d`,
      true,
      otherLongIdentifier,
    );

    test("harness guard: the identifier is past the length the name keeps whole", () => {
      expect(longIdentifier.length).toBe(87);
      expect(`kubernetes-agent/${longIdentifier}`.length).toBeGreaterThan(100);
      expect(thisRunner.name!.endsWith(longIdentifier)).toBe(false);
    });

    test("lists this cluster's Runner first, as its in-cluster Runner, bound or not", () => {
      for (const boundRunnerId of [null, "r-long"]) {
        const options: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
          runners: [
            otherRunner,
            thisRunner,
            makeRunner("r-host", "bash-runner"),
          ],
          clusterIdentifier: longIdentifier,
          boundRunnerId,
          boundRunnerName: boundRunnerId ? thisRunner.name! : null,
        });
        expect(optionValues(options)).toEqual(["r-long", "r-host"]);
        expect(options[0]!.label).toBe(
          `${thisRunner.name} (in-cluster Runner for this cluster)`,
        );
      }
    });

    test("still calls another long-named cluster's Runner another cluster's", () => {
      const options: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
        runners: [otherRunner, thisRunner],
        clusterIdentifier: longIdentifier,
        boundRunnerId: "r-long-other",
        boundRunnerName: otherRunner.name!,
      });
      expect(optionLabel(options, "r-long-other")).toMatch(
        /currently bound — runs inside another cluster/,
      );
    });
  });

  test("an agent-named Runner whose posture names another cluster, or none, is not this cluster's", () => {
    expect(
      isThisClustersAgentRunner(
        makeRunner("a", "kubernetes-agent/prod-east", true, "prod-eu"),
        "prod-east",
      ),
    ).toBe(false);
    expect(
      isThisClustersAgentRunner(
        makeRunner("a", "kubernetes-agent/prod-east"),
        "prod-east",
      ),
    ).toBe(false);
    // An ordinary Runner that reports this cluster's posture is not an agent row.
    expect(
      isThisClustersAgentRunner(
        makeRunner("a", "office-runner", true, "prod-east"),
        "prod-east",
      ),
    ).toBe(false);
  });

  test("keep the bound Runner, saying why it cannot serve the cluster", () => {
    const boundToOther: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
      runners,
      clusterIdentifier: "prod-east",
      boundRunnerId: "r-other-cluster",
      boundRunnerName: "kubernetes-agent/prod-eu",
    });
    expect(optionValues(boundToOther)).toContain("r-other-cluster");
    expect(optionLabel(boundToOther, "r-other-cluster")).toMatch(
      /currently bound — runs inside another cluster/,
    );

    const boundToOff: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
      runners,
      clusterIdentifier: "prod-east",
      boundRunnerId: "r-off",
      boundRunnerName: "ops-runner",
    });
    expect(optionLabel(boundToOff, "r-off")).toMatch(
      /Runs AI Remediation Commands/,
    );

    const boundToUnlisted: Array<DropdownOption> =
      buildKubernetesAiRunnerOptions({
        runners,
        clusterIdentifier: "prod-east",
        boundRunnerId: "r-gone",
        boundRunnerName: "old-runner",
      });
    expect(boundToUnlisted[0]).toEqual({
      value: "r-gone",
      label: "old-runner (currently bound)",
    });
  });

  test("the directory names each Runner and says which are agent rows", () => {
    const directory: Record<string, KubernetesAiRunnerDirectoryEntry> =
      buildKubernetesAiRunnerDirectory(runners);
    expect(directory["r-this"]).toEqual({
      name: "kubernetes-agent/prod-east",
      isAgent: true,
    });
    expect(directory["r-host"]).toEqual({
      name: "bash-runner",
      isAgent: false,
    });
  });
});

/*
 * The finding (dashboard-ai-page-7): the picker offered every Kubernetes
 * credential, so an admin could save a Runner with a credential that is
 * not assigned to it (the status then blocks everything with a
 * credential_missing gap), or a credential for a kubernetes-agent Runner,
 * which is never given one.
 */
describe("credential picker options", () => {
  const credentials: Array<RunbookCredential> = [
    makeCredential("c-ssh", "ssh key", ["r-host"], RunbookCredentialType.SSH),
    makeCredential("c-host", "prod-east token", ["r-host"]),
    makeCredential("c-other", "staging token", ["r-other-host"]),
    makeCredential("c-both", "shared token", ["r-host", "r-other-host"]),
  ];

  const HOST_RUNNER: { id: string; name: string } = {
    id: "r-host",
    name: "bash-runner",
  };

  test("offer only Kubernetes credentials assigned to the chosen Runner", () => {
    expect(
      optionValues(
        buildKubernetesAiCredentialOptions({
          credentials,
          boundCredentialId: null,
          boundCredentialName: null,
          runner: HOST_RUNNER,
        }),
      ),
    ).toEqual(["c-host", "c-both"]);

    // Negative control: another Runner gets its own credentials.
    expect(
      optionValues(
        buildKubernetesAiCredentialOptions({
          credentials,
          boundCredentialId: null,
          boundCredentialName: null,
          runner: { id: "r-other-host", name: "other" },
        }),
      ),
    ).toEqual(["c-other", "c-both"]);
  });

  test("offer none for a kubernetes-agent Runner, or before a Runner is chosen, and say why", () => {
    for (const runner of [
      { id: "r-this", name: "kubernetes-agent/prod-east" },
      { id: null, name: null },
    ]) {
      expect(
        buildKubernetesAiCredentialOptions({
          credentials,
          boundCredentialId: null,
          boundCredentialName: null,
          runner,
        }),
      ).toEqual([]);
    }

    expect(
      getKubernetesAiCredentialFieldDescription({
        id: "r-this",
        name: "kubernetes-agent/prod-east",
      }),
    ).toMatch(
      /No credential can be chosen: "kubernetes-agent\/prod-east" is an in-cluster Runner/,
    );
    expect(
      getKubernetesAiCredentialFieldDescription({ id: null, name: null }),
    ).toMatch(/Choose the Runner first/);
    expect(getKubernetesAiCredentialFieldDescription(HOST_RUNNER)).toMatch(
      /assigned to "bash-runner"/,
    );
  });

  test("keep the bound credential, saying why it does not fit", () => {
    const forHost: Array<DropdownOption> = buildKubernetesAiCredentialOptions({
      credentials,
      boundCredentialId: "c-other",
      boundCredentialName: "staging token",
      runner: HOST_RUNNER,
    });
    expect(optionValues(forHost)).toEqual(["c-host", "c-other", "c-both"]);
    expect(optionLabel(forHost, "c-other")).toBe(
      "staging token (currently bound — not assigned to bash-runner)",
    );

    const forAgent: Array<DropdownOption> = buildKubernetesAiCredentialOptions({
      credentials,
      boundCredentialId: "c-host",
      boundCredentialName: "prod-east token",
      runner: { id: "r-this", name: "kubernetes-agent/prod-east" },
    });
    expect(forAgent).toHaveLength(1);
    expect(optionLabel(forAgent, "c-host")).toMatch(
      /currently bound — kubernetes-agent\/prod-east is an in-cluster Runner and is never given a credential/,
    );

    expect(
      optionLabel(
        buildKubernetesAiCredentialOptions({
          credentials,
          boundCredentialId: "c-ssh",
          boundCredentialName: "ssh key",
          runner: HOST_RUNNER,
        }),
        "c-ssh",
      ),
    ).toMatch(/not a Kubernetes credential/);

    expect(
      buildKubernetesAiCredentialOptions({
        credentials,
        boundCredentialId: "c-gone",
        boundCredentialName: null,
        runner: HOST_RUNNER,
      })[0],
    ).toEqual({
      value: "c-gone",
      label: "The bound credential (currently bound)",
    });
  });

  test("offer a credential whose assignments could not be read", () => {
    expect(
      optionValues(
        buildKubernetesAiCredentialOptions({
          credentials: [makeCredential("c-unknown", "unknown", undefined)],
          boundCredentialId: null,
          boundCredentialName: null,
          runner: HOST_RUNNER,
        }),
      ),
    ).toEqual(["c-unknown"]);
  });
});

describe("a Runner and credential that cannot work together", () => {
  test("a credential not assigned to the Runner is refused, naming both", () => {
    const error: string | null = getKubernetesAiCredentialAssignmentError({
      runner: { id: "r-host", name: "bash-runner" },
      credentialId: "c-other",
      credentialName: "staging token",
      credentialRunnerIds: ["r-other-host"],
    });
    expect(error).toMatch(
      /"staging token" is not assigned to Runner "bash-runner"/,
    );

    // Negative controls: assigned, unknown assignments, or no credential.
    expect(
      getKubernetesAiCredentialAssignmentError({
        runner: { id: "r-host", name: "bash-runner" },
        credentialId: "c-host",
        credentialName: "prod-east token",
        credentialRunnerIds: ["r-host"],
      }),
    ).toBeNull();
    expect(
      getKubernetesAiCredentialAssignmentError({
        runner: { id: "r-host", name: "bash-runner" },
        credentialId: "c-host",
        credentialName: "prod-east token",
        credentialRunnerIds: undefined,
      }),
    ).toBeNull();
    expect(
      getKubernetesAiCredentialAssignmentError({
        runner: { id: "r-host", name: "bash-runner" },
        credentialId: null,
        credentialName: null,
        credentialRunnerIds: undefined,
      }),
    ).toBeNull();
  });

  test("a kubernetes-agent Runner with a credential asks for the credential to be cleared", () => {
    const error: string | null = getKubernetesAiCredentialAssignmentError({
      runner: { id: "r-this", name: "kubernetes-agent/prod-east" },
      credentialId: "c-host",
      credentialName: "prod-east token",
      // Even assigned: an agent Runner is never given a credential.
      credentialRunnerIds: ["r-this"],
    });
    expect(error).toMatch(/is an in-cluster Runner/);
    expect(error).toMatch(/Clear the Kubernetes credential/);
    expect(error).not.toMatch(/not assigned/);
  });

  describe("on save", () => {
    const runners: Record<string, KubernetesAiRunnerDirectoryEntry> =
      buildKubernetesAiRunnerDirectory([
        makeRunner("r-this", "kubernetes-agent/prod-east", true, "prod-east"),
        makeRunner("r-host", "bash-runner"),
        makeRunner("r-other-host", "other-runner"),
      ]);
    const credentials: Record<string, KubernetesAiCredentialDirectoryEntry> =
      buildKubernetesAiCredentialDirectory([
        makeCredential("c-host", "prod-east token", ["r-host"]),
        makeCredential("c-other", "staging token", ["r-other-host"]),
      ]);
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiAccessRunnerId: "r-host",
      aiAccessRunnerName: "bash-runner",
      aiAccessCredentialId: "c-host",
      aiAccessCredentialName: "prod-east token",
    });

    test("refuses setting a credential the Runner cannot use", () => {
      expect(
        getKubernetesAiAccessBindingError({
          saved,
          changes: { aiAccessCredentialId: "c-other" },
          runners,
          credentials,
        }),
      ).toMatch(/"staging token" is not assigned to Runner "bash-runner"/);
    });

    test("refuses binding a Runner the kept credential is not assigned to", () => {
      expect(
        getKubernetesAiAccessBindingError({
          saved,
          changes: { aiAccessRunnerId: "r-other-host" },
          runners,
          credentials,
        }),
      ).toMatch(/"prod-east token" is not assigned to Runner "other-runner"/);
      expect(
        getKubernetesAiAccessBindingError({
          saved,
          changes: { aiAccessRunnerId: "r-this" },
          runners,
          credentials,
        }),
      ).toMatch(/Clear the Kubernetes credential/);
    });

    test("never refuses unbinding, a matching pair, or an unrelated edit", () => {
      for (const changes of [
        { aiAccessRunnerId: null },
        { aiAccessCredentialId: null },
        { aiAccessRunnerId: "r-this", aiAccessCredentialId: null },
        { aiAccessRunnerId: "r-other-host", aiAccessCredentialId: "c-other" },
        { isAiInvestigationEnabled: false },
      ] as Array<JSONObject>) {
        expect({
          changes,
          error: getKubernetesAiAccessBindingError({
            saved,
            changes,
            runners,
            credentials,
          }),
        }).toEqual({ changes, error: null });
      }
    });
  });
});

describe("who may loosen a cluster's AI access", () => {
  test("uses the same permissions as an unattended auto-remediation rule", () => {
    expect(KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditAutoRemediationRule,
      ]),
    );

    for (const permission of KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS) {
      grant([...BASE_PERMISSIONS, permission]);
      expect(canConfigureUnattendedKubernetesAiAccess()).toBe(true);
    }

    expect(getKubernetesAiAccessAdminPermissionTitles()).toEqual(
      expect.arrayContaining([
        "Project Owner",
        "Project Admin",
        "Edit Auto Remediation Rule",
      ]),
    );
  });

  test("is refused to every other cluster editor", () => {
    for (const permission of [
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditKubernetesCluster,
      Permission.ReadRunbookCredential,
    ]) {
      grant([...BASE_PERMISSIONS, permission]);
      expect(canConfigureUnattendedKubernetesAiAccess()).toBe(false);
    }
  });

  test("reads a block row as a denial, not a grant", () => {
    grant(
      [...BASE_PERMISSIONS, Permission.ProjectMember],
      [Permission.ProjectAdmin, Permission.EditAutoRemediationRule],
    );
    expect(canConfigureUnattendedKubernetesAiAccess()).toBe(false);
  });

  test("is allowed to a master admin and withheld before the snapshot lands", () => {
    grantNothingYet();
    expect(canConfigureUnattendedKubernetesAiAccess()).toBe(false);

    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    expect(canConfigureUnattendedKubernetesAiAccess()).toBe(true);
  });

  test("decides what the edit modal offers", () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectAdmin]);
    expect(getKubernetesAiAccessEditCapabilities()).toEqual({
      canConfigureUnattended: true,
      canPickRunner: true,
      canPickCredential: true,
    });

    // May loosen and list Runners, may not read credentials.
    grant([
      ...BASE_PERMISSIONS,
      Permission.ProjectMember,
      Permission.EditAutoRemediationRule,
    ]);
    expect(getKubernetesAiAccessEditCapabilities()).toEqual({
      canConfigureUnattended: true,
      canPickRunner: true,
      canPickCredential: false,
    });

    // May loosen, but may not list Runners.
    grant([
      ...BASE_PERMISSIONS,
      Permission.EditAutoRemediationRule,
      Permission.EditKubernetesCluster,
      Permission.ReadKubernetesCluster,
    ]);
    expect(getKubernetesAiAccessEditCapabilities()).toEqual({
      canConfigureUnattended: true,
      canPickRunner: false,
      canPickCredential: false,
    });

    // Reading credentials alone does not let a member bind one.
    grant([
      ...BASE_PERMISSIONS,
      Permission.ProjectMember,
      Permission.ReadRunbookCredential,
    ]);
    expect(getKubernetesAiAccessEditCapabilities()).toEqual({
      canConfigureUnattended: false,
      canPickRunner: false,
      canPickCredential: false,
    });
  });
});

describe("Runner picker permission", () => {
  test("is withheld from cluster editors who may not read Runners", () => {
    for (const permissions of [
      [Permission.SettingsAdmin],
      [Permission.SettingsMember],
      [Permission.EditKubernetesCluster, Permission.ReadKubernetesCluster],
    ]) {
      grant([...BASE_PERMISSIONS, ...permissions]);
      expect(canPickKubernetesRunner()).toBe(false);
    }
  });

  test("is offered to Runner readers and a master admin", () => {
    for (const permission of [
      Permission.ProjectMember,
      Permission.ReadRunner,
      Permission.RunbookViewer,
    ]) {
      grant([...BASE_PERMISSIONS, permission]);
      expect(canPickKubernetesRunner()).toBe(true);
    }

    grantNothingYet();
    expect(canPickKubernetesRunner()).toBe(false);

    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    expect(canPickKubernetesRunner()).toBe(true);
  });

  test("names the permissions that would unlock it", () => {
    expect(getKubernetesRunnerPermissionTitles()).toEqual(
      expect.arrayContaining(["Read Runbook Agent", "Project Member"]),
    );
  });
});

describe("command history permission", () => {
  test("is withheld from roles that may open the page but not read Runner jobs", () => {
    for (const permission of [
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadKubernetesCluster,
      Permission.EditKubernetesCluster,
    ]) {
      grant([...BASE_PERMISSIONS, permission]);
      expect(canReadKubectlJobs()).toBe(false);
    }
  });

  test("is granted to Runner job readers and a master admin", () => {
    for (const permission of [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookViewer,
      Permission.ReadRunbookExecution,
    ]) {
      grant([...BASE_PERMISSIONS, permission]);
      expect(canReadKubectlJobs()).toBe(true);
    }

    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    expect(canReadKubectlJobs()).toBe(true);
  });

  test("names the permissions that would unlock it", () => {
    expect(getKubectlJobsPermissionTitles()).toEqual(
      expect.arrayContaining(["Viewer", "Runbook Viewer"]),
    );
  });
});

describe("access test permission", () => {
  test("requires edit access to the cluster, as the /test route does", () => {
    grant([...BASE_PERMISSIONS, Permission.ReadKubernetesCluster]);
    const refused: PermissionGateResult = getAccessTestPermissionGate();
    expect(refused.isAllowed).toBe(false);
    expect(refused.disabledReason).toMatch(/Edit Kubernetes Cluster/);

    for (const permission of [
      Permission.ProjectMember,
      Permission.SettingsMember,
      Permission.EditKubernetesCluster,
    ]) {
      grant([...BASE_PERMISSIONS, permission]);
      expect(getAccessTestPermissionGate().isAllowed).toBe(true);
    }

    // Snapshot not landed: nothing honest to say, so no reason.
    grantNothingYet();
    expect(getAccessTestPermissionGate()).toEqual({ isAllowed: false });
  });

  test("a refusal talks about running the test, not changing settings", () => {
    const message: string = getAccessTestPermissionMessage();
    expect(message).toMatch(/Running the access test needs permission/);
    expect(message).toMatch(/Nothing .* was changed/);
    expect(message).not.toMatch(/permission to change/);
  });
});
