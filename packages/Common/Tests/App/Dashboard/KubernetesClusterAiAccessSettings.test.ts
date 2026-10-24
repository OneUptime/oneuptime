import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import i18next from "i18next";
import {
  AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG,
  AI_AGENT_DEFAULT_FIXES_ON_SETTINGS,
  AI_AGENT_EXAMPLE_WRITE_NAMESPACES,
  AiAgentHelmCommands,
  formatNameList,
  getAiAgentClusterWideCommandNote,
  getAiAgentHelmCommands,
  getAiAgentSettingsFlags,
  getAiAgentLogsCommand,
  getAiAgentScopedCommandNote,
  getAiAgentWriteDisclosure,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";
import {
  KubernetesAiAccessConfirmation,
  KubernetesAiAccessOfferedFields,
  KubernetesAiAccessSavedSettings,
  INVESTIGATION_ON_SENTENCE,
  KUBECTL_ALLOWLIST_FIELD_DESCRIPTION,
  REMEDIATION_MODES_BY_AUTONOMY,
  REMEDIATION_MODE_OPTION_DESCRIPTIONS,
  REMEDIATION_MODE_SHORT_NAMES,
  REMEDIATION_MODE_SUMMARIES,
  SavedKubectlAllowlist,
  capitalizeFirst,
  getAllowlistInEffect,
  getEveryModeProtections,
  getEveryModeProtectionsSentence,
  getKubectlAllowlistRemovalOnlyError,
  getKubernetesAiAccessAdminPermissionTitles,
  getKubernetesAiAccessConfirmation,
  getKubernetesAiAccessLooseningChanges,
  getKubernetesAiAccessOfferedFields,
  getKubernetesAiAccessSettingsChanges,
  getKubernetesAiAccessSettingsInitialValues,
  getKubernetesAiAccessSubmittedFields,
  getPermissionTitles,
  isAllowlistFieldShown,
  isRemediationModeOpenToEveryEditor,
  normalizeSavedKubectlAllowlist,
  parseKubectlAllowlistText,
  readDropdownId,
  readKubernetesAiAccessSavedSettings,
  readRemediationMode,
  readStoredKubectlAllowlist,
  validateKubectlAllowlistText,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSettings";
import {
  formatAiAccessProtections,
  joinAiAccessProtections,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import {
  PROJECT_AI_SETTINGS_PERMISSIONS,
  canChangeProjectAiSettings,
  canConfigureUnattendedKubernetesAiAccess,
  canReadKubectlJobs,
  canResetKubernetesAiAgent,
  getAccessTestPermissionGate,
  getAccessTestPermissionMessage,
  getAccessTestPermissionRequirement,
  getKubectlJobsPermissionTitles,
  getKubernetesAiAccessEditCapabilities,
  holdsKubernetesAiAccessPermission,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessPermissions";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  KUBERNETES_PLATFORMS,
  KubernetesPlatform,
  getKubernetesSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  SetupGuideOption,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { isKubernetesAgentRunnerRow } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAgentRunner";
import { AgentAiFixesMode } from "../../../Types/AI/AgentAiSettings";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner from "../../../Models/DatabaseModels/Runner";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiRemediationMode,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import KubectlPolicy, {
  KUBECTL_ALLOWLIST_MAX_PATTERNS,
  KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import fs from "fs";
import path from "path";

/*
 * The pure pieces behind the cluster's AI agent page (AI → Agent): the
 * helm commands it prints (KubernetesAiAccessSetup), who may loosen what AI
 * does — relative to the saved settings, as the server decides it — what a
 * Change actually sends, when a save is confirmed first, how the allowlist
 * is read and checked (by KubectlPolicy, the matcher's own rules)
 * (KubernetesAiAccessSettings), and the permission reads
 * (KubernetesAiAccessPermissions). The modal edits the investigation
 * switch, the fixes mode and the allowlist only: its Runner and credential
 * pickers went with runbook credentials (Runbooks > Runners > AI Access). The status helpers are covered by
 * KubernetesClusterAiAgentStatus.test.ts, the rendered page by
 * KubernetesClusterAiPage.test.tsx, and the server-side parity checks by
 * KubernetesClusterAiPageServerParity.test.ts.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const RUNNER_ID: string = "55555555-0000-4000-8000-000000000005";
const CREDENTIAL_ID: string = "77777777-0000-4000-8000-000000000007";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const SET_IMAGE_PATTERN: string = "kubectl set image deployment/web * -n web";
const PATCH_PATTERN: string = "kubectl patch deployment/web -n web -p *";
/*
 * A broad but valid entry: deleting any Deployment in any namespace. A
 * wildcard verb ("kubectl * * * -n *") is invalid since KubectlPolicy made
 * it so: refused where it is typed and skipped by the matcher.
 */
const BROAD_PATTERN: string = "kubectl delete deployment * -n *";
// Wildcard verbs (and a lone "*"): invalid, refused by the form.
const VERB_WILDCARD_PATTERNS: Array<string> = [
  "*",
  "kubectl *",
  "kubectl * * * -n *",
  "* * -n web",
];

// A line continuation left dangling at the end of a command.
const TRAILING_CONTINUATION_REGEX: RegExp = /\\\s*$/;
const CHART_VERSION_FLAG_REGEX: RegExp = /--version/;
const MATCHES_NEARLY_EVERYTHING_REGEX: RegExp = /nearly/;
const ANY_IMAGE_ANY_SERVICE_ACCOUNT_REGEX: RegExp =
  /equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets/;
// A backslash-newline line continuation, which the shell reads as a space.
const LINE_CONTINUATION_REGEX: RegExp = /\\\n/g;
// One shell word: a run of unquoted, single-quoted or double-quoted parts.
const SHELL_WORD_REGEX: RegExp = /(?:[^\s'"]+|'[^']*'|"[^"]*")+/g;
// The quotes around one quoted part of a shell word.
const SHELL_QUOTED_PART_REGEX: RegExp = /'([^']*)'|"([^"]*)"/g;
// A --set value that sets the namespace list to null.
const NULL_NAMESPACES_VALUE_REGEX: RegExp =
  /^aiAgent\.remediation\.namespaces=null$/;

/*
 * The shared exact strings every slice prints (phase-b-slices.md): the
 * dashboard, the server's ai_agent_not_connected gap and the docs all show
 * these, so they are pinned character for character.
 */
const EXACT_INSTALL_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reset-then-reuse-values \\
  --set aiAgent.enabled=true`;
const EXACT_APPLY_SETTINGS_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reset-then-reuse-values \\
  --set aiAgent.enabled=true \\
  --set aiAgent.investigation=true \\
  --set aiAgent.fixes=ask-for-approval`;
const EXACT_SCOPED_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reset-then-reuse-values \\
  --set aiAgent.enabled=true \\
  --set aiAgent.investigation=true \\
  --set aiAgent.fixes=ask-for-approval \\
  --set "aiAgent.remediation.namespaces={web,api}" \\
  --set aiAgent.remediation.nodeOperations=false`;
const EXACT_CLUSTER_WIDE_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reset-then-reuse-values \\
  --set aiAgent.enabled=true \\
  --set aiAgent.investigation=true \\
  --set aiAgent.fixes=ask-for-approval \\
  --set-json 'aiAgent.remediation.namespaces=[]'`;

/*
 * The argv of the `helm upgrade` line in a copy-paste command, the way a
 * POSIX shell splits it: line continuations joined, quotes removed. Only
 * what the page's commands use (no escapes inside quotes, no expansion).
 */
function getHelmUpgradeArgv(command: string): Array<string> {
  const line: string | undefined = command
    .replace(LINE_CONTINUATION_REGEX, " ")
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.trim().startsWith("helm upgrade ");
    });
  if (!line) {
    return [];
  }
  return (line.match(SHELL_WORD_REGEX) || []).map((word: string): string => {
    return word.replace(
      SHELL_QUOTED_PART_REGEX,
      (_quoted: string, single?: string, double?: string): string => {
        return single ?? double ?? "";
      },
    );
  });
}

// The value each occurrence of `flag` takes in an argv.
function getFlagValues(argv: Array<string>, flag: string): Array<string> {
  const values: Array<string> = [];
  argv.forEach((word: string, index: number) => {
    if (word === flag && index + 1 < argv.length) {
      values.push(argv[index + 1]!);
    }
  });
  return values;
}

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

// A cluster's saved AI settings.
function makeSaved(
  overrides: Partial<KubernetesAiAccessSavedSettings> = {},
): KubernetesAiAccessSavedSettings {
  return {
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
    ...overrides,
  };
}

const NOTHING_OFFERED: KubernetesAiAccessOfferedFields = {
  allowlist: false,
  allowlistRemoveOnly: false,
};

const EVERYTHING_OFFERED: KubernetesAiAccessOfferedFields = {
  allowlist: true,
  allowlistRemoveOnly: false,
};

// What a cluster editor without the admin set gets.
const TIGHTEN_ONLY_OFFERED: KubernetesAiAccessOfferedFields = {
  allowlist: true,
  allowlistRemoveOnly: true,
};

type SettingsFormValues = FormValues<{
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: string;
  kubectlAllowlistText: string;
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

beforeEach(() => {
  grant([...BASE_PERMISSIONS, Permission.ProjectMember]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the AI agent helm commands", () => {
  // Every platform's install guide, Advanced and Troubleshooting included.
  const installMarkdown: string = KUBERNETES_PLATFORMS.map(
    (option: SetupGuideOption<KubernetesPlatform>): string => {
      return getSetupGuideMarkdown(
        getKubernetesSetupGuide({
          clusterName: "prod-east",
          oneuptimeUrl: "https://oneuptime.example.com",
          apiKey: "key",
          platform: option.key,
        }),
      );
    },
  ).join("\n");

  function allCommands(): Array<string> {
    const commands: AiAgentHelmCommands = getAiAgentHelmCommands();
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

  test("are exactly the shared strings every slice prints", () => {
    const commands: AiAgentHelmCommands = getAiAgentHelmCommands();
    expect(commands.install).toBe(EXACT_INSTALL_COMMAND);
    expect(commands.applySettings).toBe(EXACT_APPLY_SETTINGS_COMMAND);
    expect(commands.enableRemediationScoped).toBe(EXACT_SCOPED_COMMAND);
    expect(commands.enableRemediation).toBe(EXACT_CLUSTER_WIDE_COMMAND);
    expect(Object.keys(commands).sort()).toEqual([
      "applySettings",
      "enableRemediation",
      "enableRemediationScoped",
      "install",
    ]);
  });

  /*
   * What AI may do is the agent's own setting (aiAgent.investigation and
   * aiAgent.fixes): every command that sets fixes names investigation too,
   * since a release that names either hands both to the agent.
   */
  test("the default commands turn fixes on to Ask for approval, with investigation on", () => {
    expect(AI_AGENT_DEFAULT_FIXES_ON_SETTINGS).toEqual({
      investigation: true,
      fixes: "RequireApproval",
    });

    for (const command of [
      getAiAgentHelmCommands().applySettings,
      getAiAgentHelmCommands().enableRemediationScoped,
      getAiAgentHelmCommands().enableRemediation,
    ]) {
      const sets: Array<string> = getFlagValues(
        getHelmUpgradeArgv(command),
        "--set",
      );
      expect(sets).toContain("aiAgent.investigation=true");
      expect(sets).toContain("aiAgent.fixes=ask-for-approval");
      // The older switch is never what the page tells anyone to set.
      expect(command).not.toContain("aiAgent.remediation.enabled");
    }
  });

  test.each([
    [true, "Disabled", "aiAgent.investigation=true", "aiAgent.fixes=off"],
    [
      false,
      "RequireApproval",
      "aiAgent.investigation=false",
      "aiAgent.fixes=ask-for-approval",
    ],
    [
      true,
      "Automatic",
      "aiAgent.investigation=true",
      "aiAgent.fixes=automatic",
    ],
    [
      true,
      "BypassApproval",
      "aiAgent.investigation=true",
      "aiAgent.fixes=bypass-approval",
    ],
  ] as Array<[boolean, AgentAiFixesMode, string, string]>)(
    "investigation %s, fixes %s: every command sets exactly that, in the chart's spelling",
    (
      investigation: boolean,
      fixes: AgentAiFixesMode,
      investigationFlag: string,
      fixesFlag: string,
    ) => {
      expect(getAiAgentSettingsFlags({ investigation, fixes })).toBe(
        `--set ${investigationFlag} \\\n  --set ${fixesFlag}`,
      );

      const commands: AiAgentHelmCommands = getAiAgentHelmCommands({
        investigation,
        fixes,
      });

      for (const command of [
        commands.applySettings,
        commands.enableRemediationScoped,
        commands.enableRemediation,
      ]) {
        const sets: Array<string> = getFlagValues(
          getHelmUpgradeArgv(command),
          "--set",
        );
        expect(sets).toContain(investigationFlag);
        expect(sets).toContain(fixesFlag);
      }

      // The install command never sets them: it installs read-only.
      expect(commands.install).toBe(EXACT_INSTALL_COMMAND);
    },
  );

  /*
   * Changing what AI may do keeps the write scope the release has: no
   * namespace list and no node operations flag, so
   * --reset-then-reuse-values keeps them.
   */
  test("the settings command sets the two values and nothing about the write scope", () => {
    const argv: Array<string> = getHelmUpgradeArgv(
      getAiAgentHelmCommands().applySettings,
    );
    expect(getFlagValues(argv, "--set")).toEqual([
      "aiAgent.enabled=true",
      "aiAgent.investigation=true",
      "aiAgent.fixes=ask-for-approval",
    ]);
    expect(getFlagValues(argv, "--set-json")).toEqual([]);
  });

  /*
   * `helm upgrade` of a release that does not exist fails with "has no
   * deployed releases", so the page's release and namespace must be the
   * install instructions' — one exported pair in DocumentationMarkdown.ts.
   */
  test("use the release and namespace of the Dashboard's install instructions", () => {
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
      /*
       * The release's own values, the chart's defaults for the rest: never
       * --reuse-values, which keeps the old chart's defaults too.
       */
      expect(getHelmUpgradeArgv(command)).toContain(
        "--reset-then-reuse-values",
      );
      expect(getHelmUpgradeArgv(command)).not.toContain("--reuse-values");
    }
  });

  test("every command updates the chart index first and turns the agent on", () => {
    expect(allCommands()).toHaveLength(4);
    for (const command of allCommands()) {
      expect(command.startsWith("helm repo update\n")).toBe(true);
      /*
       * Always aiAgent.enabled=true, harmless when the agent is on: nobody
       * has to decide whether theirs was installed with it turned off.
       */
      expect(getFlagValues(getHelmUpgradeArgv(command), "--set")).toContain(
        "aiAgent.enabled=true",
      );
    }
  });

  test("the install command is read-only and names no deprecated aiAccess value", () => {
    const install: string = getAiAgentHelmCommands().install;
    expect(install).not.toContain("remediation");
    for (const command of allCommands()) {
      expect(command).not.toContain("aiAccess");
    }
  });

  test("the recommended write command binds only the listed namespaces and keeps fixes off nodes", () => {
    const argv: Array<string> = getHelmUpgradeArgv(
      getAiAgentHelmCommands().enableRemediationScoped,
    );
    expect(getFlagValues(argv, "--set")).toEqual([
      "aiAgent.enabled=true",
      "aiAgent.investigation=true",
      "aiAgent.fixes=ask-for-approval",
      `aiAgent.remediation.namespaces=${AI_AGENT_EXAMPLE_WRITE_NAMESPACES}`,
      "aiAgent.remediation.nodeOperations=false",
    ]);
    expect(getFlagValues(argv, "--set-json")).toEqual([]);
  });

  /*
   * What helm receives: the shell hands `--set-json` one word whose value
   * is an empty JSON list — a value the schema accepts and that replaces a
   * stored list (a `=null` override is dropped under --reuse-values, and
   * lets a stored aiAccess list carry over under either flag).
   */
  test("the cluster-wide command hands helm an empty JSON list for the namespaces", () => {
    const argv: Array<string> = getHelmUpgradeArgv(
      getAiAgentHelmCommands().enableRemediation,
    );
    expect(argv).toContain("--reset-then-reuse-values");

    const setJson: Array<string> = getFlagValues(argv, "--set-json");
    expect(setJson).toEqual(["aiAgent.remediation.namespaces=[]"]);
    const assignment: string = setJson[0]!;
    const separator: number = assignment.indexOf("=");
    expect(assignment.slice(0, separator)).toBe(
      "aiAgent.remediation.namespaces",
    );
    expect(JSON.parse(assignment.slice(separator + 1))).toEqual([]);
    expect(AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG).toBe(
      "--set-json 'aiAgent.remediation.namespaces=[]'",
    );

    // Negative control: the helper does read a null reset where one is.
    const withNull: Array<string> = getHelmUpgradeArgv(
      "helm repo update\nhelm upgrade r c --reset-then-reuse-values \\\n  --set aiAgent.remediation.namespaces=null",
    );
    expect(
      getFlagValues(withNull, "--set").some((setting: string): boolean => {
        return NULL_NAMESPACES_VALUE_REGEX.test(setting);
      }),
    ).toBe(true);
  });

  test("no command keeps the old chart's defaults or resets the namespace list with null", () => {
    for (const command of allCommands()) {
      const argv: Array<string> = getHelmUpgradeArgv(command);
      expect({
        command,
        keepsReleaseValues: argv.includes("--reset-then-reuse-values"),
        reuseValues: argv.includes("--reuse-values"),
        nullNamespaces: getFlagValues(argv, "--set").some(
          (setting: string): boolean => {
            return NULL_NAMESPACES_VALUE_REGEX.test(setting);
          },
        ),
        nullText: command.includes("namespaces=null"),
      }).toEqual({
        command,
        keepsReleaseValues: true,
        reuseValues: false,
        nullNamespaces: false,
        nullText: false,
      });
    }
  });

  test("every command is complete, never a line to append", () => {
    for (const command of allCommands()) {
      expect(TRAILING_CONTINUATION_REGEX.test(command)).toBe(false);
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
    }
  });

  test("the scoped note says a listed namespace must exist and how to go back to cluster-wide", () => {
    const note: string = getAiAgentScopedCommandNote();
    expect(note).toContain(AI_AGENT_EXAMPLE_WRITE_NAMESPACES);
    expect(note).toContain("must already exist");
    expect(note).toContain("never creates a namespace");
    expect(note).toContain("fails the whole upgrade");
    expect(note).toContain(AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG);
    expect(note).toContain("not =null");
    expect(note).toContain("set it to true to allow cordon");
    // A drain, a taint and a node patch still ask, even with node operations on.
    expect(note).toContain(
      "a drain, a taint or a node patch still waits for a person",
    );
  });

  test("the cluster-wide note says the list is cleared and node operations are kept", () => {
    const note: string = getAiAgentClusterWideCommandNote();
    expect(
      note.startsWith(`${AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG} clears`),
    ).toBe(true);
    expect(note).toContain("Helm 3.10 or later");
    expect(note).toContain("Node operations keep the release's setting");
  });

  /*
   * The docs suite holds this disclosure to the chart docs' rules: what
   * write RBAC amounts to, every protected namespace, the agent's own
   * namespace, and the value that scopes it.
   */
  test("the write-access disclosure says what write access amounts to and where OneUptime holds the line", () => {
    const disclosure: string = getAiAgentWriteDisclosure();
    expect(disclosure).toMatch(ANY_IMAGE_ANY_SERVICE_ACCOUNT_REGEX);
    expect(disclosure).toContain("aiAgent.remediation.namespaces");
    expect(disclosure).toContain("aiAgent.remediation.nodeOperations=false");
    expect(disclosure).toContain("the agent's own namespace");
    for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
      expect(disclosure).toContain(namespace);
    }
    expect(disclosure).toContain("always needs a person");
    expect(disclosure).not.toContain("aiAccess");
    expect(disclosure).not.toContain("Runner");
  });

  test("the logs command uses the namespace the agent reported, else the install namespace", () => {
    expect(getAiAgentLogsCommand("monitoring")).toBe(
      "kubectl logs -n monitoring -l component=ai-agent --tail=100",
    );
    expect(getAiAgentLogsCommand("  monitoring ")).toBe(
      "kubectl logs -n monitoring -l component=ai-agent --tail=100",
    );
    for (const missing of [undefined, "", "   "]) {
      expect(getAiAgentLogsCommand(missing)).toBe(
        `kubectl logs -n ${KUBERNETES_AGENT_HELM_NAMESPACE} -l component=ai-agent --tail=100`,
      );
    }
  });

  test("formatNameList joins names the way the copy reads them", () => {
    expect(formatNameList([], "and")).toBe("");
    expect(formatNameList(["a"], "and")).toBe("a");
    expect(formatNameList(["a", "b"], "or")).toBe("a or b");
    expect(formatNameList(["a", "b", "c"], "and")).toBe("a, b and c");
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
    expect(validateKubectlAllowlistText(BROAD_PATTERN)).toBeNull();
    expect(
      validateKubectlAllowlistText("kubectl set image deployment/* * -n *"),
    ).toBeNull();
  });

  test("refuses a wildcard verb, which the matcher never reads", () => {
    for (const pattern of VERB_WILDCARD_PATTERNS) {
      expect({
        pattern,
        error: validateKubectlAllowlistText(pattern),
      }).toEqual({
        pattern,
        error: `Pattern 1: ${KubectlPolicy.describeAllowlistPatternProblem(pattern)}`,
      });
      expect(validateKubectlAllowlistText(pattern)).toMatch(/verb/);
    }
  });

  test("accepts a pattern without the leading kubectl, as the matcher does", () => {
    expect(
      validateKubectlAllowlistText("set image deployment/web * -n web"),
    ).toBeNull();
  });

  test("refuses a bare kubectl, which names no command", () => {
    expect(validateKubectlAllowlistText("kubectl")).toMatch(/^Pattern 1: /);
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
      {
        value: { patterns: [SET_IMAGE_PATTERN] },
        expected: { patterns: [], isClean: false },
      },
      { value: 42, expected: { patterns: [], isClean: false } },
      {
        value: [1, "", SET_IMAGE_PATTERN],
        expected: { patterns: [SET_IMAGE_PATTERN], isClean: false },
      },
      // A string that is not JSON is ONE pattern to the server.
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

  test("the allowlist in effect is the status's non-blank strings only", () => {
    expect(getAllowlistInEffect([SET_IMAGE_PATTERN, "", "  ", 3])).toEqual([
      SET_IMAGE_PATTERN,
    ]);
    expect(getAllowlistInEffect(undefined)).toEqual([]);
    expect(getAllowlistInEffect("kubectl *")).toEqual([]);
  });
});

describe("reading the saved settings", () => {
  /*
   * The Change modal edits the investigation switch, the fixes mode and the
   * kubectl allowlist. A Runner the cluster is still bound to (its own
   * in-cluster Runner, the only one the server lets a cluster hold) is not
   * read into the form, so no save can send it.
   */
  test("reads the switch, the mode and the allowlist, and no Runner or credential", () => {
    const saved: KubernetesAiAccessSavedSettings =
      readKubernetesAiAccessSavedSettings(
        Object.assign(new KubernetesCluster(), {
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
          aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
          aiAccessRunnerId: new ObjectID(RUNNER_ID),
          aiAccessRunner: Object.assign(new Runner(), {
            _id: RUNNER_ID,
            name: "kubernetes-agent/prod-east",
          }),
        }),
      );
    expect(saved).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
    });

    expect(
      readKubernetesAiAccessSavedSettings(new KubernetesCluster())
        .aiRemediationMode,
    ).toBe(KubernetesAiRemediationMode.Disabled);
  });

  /*
   * Regression: the column now defaults to true (AI on out of the box).
   * The page read a missing value as false, so an untouched form showed
   * investigation off and a save that changed nothing else turned it on
   * "again" — or, worse, the page told the operator it was off.
   */
  test("reads a missing investigation switch as on, the column's default", () => {
    expect(
      readKubernetesAiAccessSavedSettings(new KubernetesCluster())
        .isAiInvestigationEnabled,
    ).toBe(true);
    expect(
      readKubernetesAiAccessSavedSettings(
        Object.assign(new KubernetesCluster(), {
          isAiInvestigationEnabled: null,
        }),
      ).isAiInvestigationEnabled,
    ).toBe(true);
    // Negative control: an explicit false stays false.
    expect(
      readKubernetesAiAccessSavedSettings(
        Object.assign(new KubernetesCluster(), {
          isAiInvestigationEnabled: false,
        }),
      ).isAiInvestigationEnabled,
    ).toBe(false);
  });

  test("an unknown stored mode reads as Off, the server's reading", () => {
    expect(readRemediationMode("automatic")).toBe(
      KubernetesAiRemediationMode.Disabled,
    );
    expect(readRemediationMode(undefined)).toBe(
      KubernetesAiRemediationMode.Disabled,
    );
    for (const mode of Object.values(KubernetesAiRemediationMode)) {
      expect(readRemediationMode(mode)).toBe(mode);
    }
  });

  test("seeds the form with the switch, the mode and the allowlist as lines, and nothing else", () => {
    const initial: SettingsFormValues =
      getKubernetesAiAccessSettingsInitialValues(
        makeSaved({
          aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, "kubectl *"],
        }),
      );
    expect(initial).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      kubectlAllowlistText: `${SET_IMAGE_PATTERN}\nkubectl *`,
    });
  });
});

describe("what the Change modal offers", () => {
  test("an admin gets a free allowlist", () => {
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeSaved({ aiKubectlCommandAllowlist: [] }),
        canConfigureUnattended: true,
      }),
    ).toEqual(EVERYTHING_OFFERED);
  });

  test("a cluster editor without the admin set may only remove from the saved allowlist", () => {
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeSaved(),
        canConfigureUnattended: false,
      }),
    ).toEqual(TIGHTEN_ONLY_OFFERED);
  });

  /*
   * Runbooks > Runners > AI Access is gone, and the Runner and credential
   * pickers with it: whoever opens the modal, it offers the switch, the
   * mode and the allowlist, nothing more.
   */
  test("offers no Runner or credential field, whoever opens it", () => {
    for (const canConfigureUnattended of [true, false]) {
      for (const isSetByAgent of [true, false, undefined]) {
        const offered: KubernetesAiAccessOfferedFields =
          getKubernetesAiAccessOfferedFields({
            saved: makeSaved(),
            canConfigureUnattended,
            isSetByAgent,
          });
        expect(Object.keys(offered).sort()).toEqual(
          isSetByAgent
            ? ["allowlist", "allowlistRemoveOnly", "investigationAndFixes"]
            : ["allowlist", "allowlistRemoveOnly"],
        );
      }
    }
  });

  test("nothing to remove means no allowlist field for a cluster editor", () => {
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeSaved({ aiKubectlCommandAllowlist: [] }),
        canConfigureUnattended: false,
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
      }).allowlist,
    ).toBe(true);
  });

  test("the allowlist field shows, and is sent, only while Automatic is chosen", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved();

    expect(isAllowlistFieldShown(formValues(saved))).toBe(true);
    expect(
      isAllowlistFieldShown(
        formValues(saved, {
          aiRemediationMode: {
            value: KubernetesAiRemediationMode.Automatic,
            label: "Automatic",
          },
        }),
      ),
    ).toBe(true);
    for (const mode of [
      KubernetesAiRemediationMode.Disabled,
      KubernetesAiRemediationMode.RequireApproval,
      KubernetesAiRemediationMode.BypassApproval,
    ]) {
      expect(
        isAllowlistFieldShown(formValues(saved, { aiRemediationMode: mode })),
      ).toBe(false);
    }

    // Text typed while Automatic, then the mode changed: nothing is sent for it.
    const values: SettingsFormValues = formValues(saved, {
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      kubectlAllowlistText: "kubectl",
    });
    const submitted: KubernetesAiAccessOfferedFields =
      getKubernetesAiAccessSubmittedFields({
        offered: EVERYTHING_OFFERED,
        values,
      });
    expect(submitted).toEqual({ ...EVERYTHING_OFFERED, allowlist: false });
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values,
        offered: submitted,
      }),
    ).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    });
  });
});

describe("which modes a cluster editor without the admin set may choose", () => {
  function openModes(saved: KubernetesAiRemediationMode): Array<string> {
    return REMEDIATION_MODES_BY_AUTONOMY.filter(
      (mode: KubernetesAiRemediationMode): boolean => {
        return isRemediationModeOpenToEveryEditor(mode, saved);
      },
    );
  }

  test("every mode at or below the saved one", () => {
    expect(openModes(KubernetesAiRemediationMode.RequireApproval)).toEqual([
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

  /*
   * Regression (§11 "Disabled→enabled needs admin"): Off -> Ask for
   * approval was open to every editor. Turning fixes on at all now needs
   * the admin set, so an Off cluster offers a cluster editor only Off.
   */
  test("turning fixes on from Off is not open to every editor", () => {
    expect(openModes(KubernetesAiRemediationMode.Disabled)).toEqual([
      KubernetesAiRemediationMode.Disabled,
    ]);
    expect(
      isRemediationModeOpenToEveryEditor(
        KubernetesAiRemediationMode.RequireApproval,
        KubernetesAiRemediationMode.Disabled,
      ),
    ).toBe(false);
  });
});

describe("what an edit sends", () => {
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
    const saved: KubernetesAiAccessSavedSettings = makeSaved();
    for (const offered of [EVERYTHING_OFFERED, TIGHTEN_ONLY_OFFERED]) {
      expect(
        getKubernetesAiAccessSettingsChanges({
          saved,
          values: formValues(saved),
          offered,
        }),
      ).toEqual({});
    }
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
    expect(readDropdownId({ value: { value: "x" } })).toBe("x");
    expect(readDropdownId("")).toBeNull();
    expect(readDropdownId(null)).toBeNull();
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

  /*
   * The form holds no Runner or credential field. A value one left in the
   * form state - a draft from before the pickers were removed - is never
   * sent, whatever the modal offers.
   */
  test("never sends a Runner or credential, whatever the form holds", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved();

    for (const offered of [
      EVERYTHING_OFFERED,
      TIGHTEN_ONLY_OFFERED,
      NOTHING_OFFERED,
    ]) {
      expect(
        getKubernetesAiAccessSettingsChanges({
          saved,
          values: formValues(saved, {
            aiAccessRunnerId: RUNNER_ID,
            aiAccessCredentialId: CREDENTIAL_ID,
            clearAiAccessRunner: true,
            clearAiAccessCredential: true,
          }),
          offered,
        }),
      ).toEqual({});
    }
  });
});

/*
 * The server's rule (KubernetesClusterService.getAiAccessLoosening) is
 * RELATIVE to the saved settings. KubernetesClusterAiPageServerParity.test.ts
 * runs the same cases through the server.
 */
describe("loosening changes", () => {
  test("any move of the mode up loosens, Off -> Ask for approval included; moving it down never does", () => {
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
    ).toEqual(["switching fixes to Bypass approval"]);
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromOff,
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
      }),
    ).toEqual(["switching fixes to Automatic"]);
    // Regression (§11): turning fixes on at all needs the admin set now.
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromOff,
        changes: {
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        },
      }),
    ).toEqual(["switching fixes to Ask for approval"]);

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
      KubernetesAiRemediationMode.Automatic,
    ]) {
      expect(
        getKubernetesAiAccessLooseningChanges({
          saved: fromAutomatic,
          changes: { aiRemediationMode: mode },
        }),
      ).toEqual([]);
    }
    // Not a mode: nothing to judge.
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromOff,
        changes: { aiRemediationMode: "automatic" },
      }),
    ).toEqual([]);
  });

  test("adding a pattern loosens; removing patterns or clearing the list never does", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, PATCH_PATTERN],
    });

    for (const allowlist of [[SET_IMAGE_PATTERN], [], null]) {
      expect(
        getKubernetesAiAccessLooseningChanges({
          saved,
          changes: { aiKubectlCommandAllowlist: allowlist },
        }),
      ).toEqual([]);
    }

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

    expect(
      getKubernetesAiAccessLooseningChanges({
        saved,
        changes: {
          aiKubectlCommandAllowlist: [
            "kubectl set image deployment/web * -n prod",
            "kubectl set image deployment/api * -n prod",
          ],
        },
      }),
    ).toEqual([
      'adding the kubectl allowlist patterns "kubectl set image deployment/web * -n prod", "kubectl set image deployment/api * -n prod"',
    ]);
  });

  /*
   * The form sends no Runner or credential, so the page names no loosening
   * for one: a Runner bound through the API is the server's alone to judge,
   * and it refuses every Runner but the cluster's own in-cluster one
   * (KubernetesClusterService.validateAiAccessBindingPairs).
   */
  test("names no loosening for a Runner or credential, which the form never sends", () => {
    for (const changes of [
      { aiAccessRunnerId: RUNNER_ID },
      { aiAccessRunnerId: null },
      { aiAccessCredentialId: CREDENTIAL_ID },
      { aiAccessCredentialId: null },
      { isAiInvestigationEnabled: true },
      { isAiInvestigationEnabled: false },
    ] as Array<JSONObject>) {
      expect(
        getKubernetesAiAccessLooseningChanges({ saved: makeSaved(), changes }),
      ).toEqual([]);
    }
  });

  test("capitalizes the first loosening for the refusal", () => {
    expect(capitalizeFirst("switching fixes to Automatic")).toBe(
      "Switching fixes to Automatic",
    );
    expect(capitalizeFirst("")).toBe("");
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

describe("confirming a save that lets riskier changes run unattended", () => {
  function expectNamesWhatItUnlocks(
    confirmation: KubernetesAiAccessConfirmation | null,
  ): void {
    expect(confirmation).not.toBeNull();
    const text: string = confirmation!.description;
    for (const word of ["set image", "patch", "drain", "deleting workloads"]) {
      expect(text).toContain(word);
    }
    expect(text).toMatch(/never run/);
    expect(text).toContain("kube-system");
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

  test("is asked before a pattern with a wildcard for an object or the namespace", () => {
    for (const broad of [
      BROAD_PATTERN,
      "kubectl delete * * -n *",
      "kubectl delete deployment *",
      "kubectl set image deployment/* * -n *",
      "kubectl set image deployment/* * --namespace=*",
      "kubectl patch deployment * -p * -n *",
      "kubectl rollout restart deployment -n *",
      "set image deployment/web * -n *",
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
        "a wildcard for an object, the namespace, a selector or a --from source",
      );
    }
  });

  test("is never asked for a wildcard verb, which the form refuses first", () => {
    for (const pattern of VERB_WILDCARD_PATTERNS) {
      expect({
        pattern,
        confirmation: getKubernetesAiAccessConfirmation({
          saved: makeSaved(),
          changes: { aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, pattern] },
        }),
      }).toEqual({ pattern, confirmation: null });
    }
  });

  test("warns ahead when the broad allowlist is saved outside Automatic mode", () => {
    const confirmation: KubernetesAiAccessConfirmation | null =
      getKubernetesAiAccessConfirmation({
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
          aiKubectlCommandAllowlist: [],
        }),
        changes: { aiKubectlCommandAllowlist: [BROAD_PATTERN] },
      });
    expectNamesWhatItUnlocks(confirmation);
    expect(confirmation!.description).toContain("Once this cluster is");
  });

  test("is asked when Automatic mode switches on over a saved broad allowlist", () => {
    expectNamesWhatItUnlocks(
      getKubernetesAiAccessConfirmation({
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
          aiKubectlCommandAllowlist: [BROAD_PATTERN],
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
      {
        saved: makeSaved({ aiKubectlCommandAllowlist: [BROAD_PATTERN] }),
        changes: { isAiInvestigationEnabled: false },
      },
      {
        saved: makeSaved({ aiKubectlCommandAllowlist: [BROAD_PATTERN] }),
        changes: {
          aiKubectlCommandAllowlist: [BROAD_PATTERN, SET_IMAGE_PATTERN],
        },
      },
      {
        saved: makeSaved({
          aiKubectlCommandAllowlist: ["kubectl  delete  deployment *  -n *"],
        }),
        changes: {
          aiKubectlCommandAllowlist: ["kubectl  delete  deployment *  -n *"],
        },
      },
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
          aiKubectlCommandAllowlist: [BROAD_PATTERN],
        }),
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
      },
      {
        saved: makeSaved({ aiKubectlCommandAllowlist: [BROAD_PATTERN] }),
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
   * The parity check on the real matcher. Every probe names an object and
   * namespaces nobody would type into a pattern, so a pattern that
   * auto-approves a probe reaches objects and namespaces it does not name.
   * Each such pattern must be confirmed; each narrow one must neither be
   * confirmed nor reach the probes.
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
      "kubectl * * -n *",
      "kubectl * * * -n *",
      "kubectl delete * * -n *",
      "kubectl delete deployment * -n *",
      "kubectl delete deployment *",
      "kubectl delete statefulset * -n *",
      "kubectl set image deployment/* * -n *",
      "kubectl set image deployment/* * --namespace=*",
      "kubectl set env deployment/* * -n zz-probe-ns",
      "kubectl patch deployment * -p * -n *",
      "kubectl rollout restart deployment -n *",
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
      expect(promotedBy(BROAD_PATTERN).length).toBeGreaterThan(0);
      expect(promotedBy("kubectl delete * * -n *").length).toBeGreaterThan(0);
      for (const pattern of VERB_WILDCARD_PATTERNS) {
        expect({ pattern, promoted: promotedBy(pattern) }).toEqual({
          pattern,
          promoted: [],
        });
      }
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

      /*
       * Resetting the agent takes the same set, and an edit of the cluster
       * (the server's route asks both): the owner and admin roles edit
       * clusters, Edit AI Rule alone does not.
       */
      expect(canResetKubernetesAiAgent()).toBe(
        permission !== Permission.EditAutoRemediationRule,
      );

      grant([
        ...BASE_PERMISSIONS,
        permission,
        Permission.ReadKubernetesCluster,
        Permission.EditKubernetesCluster,
      ]);
      expect(canResetKubernetesAiAgent()).toBe(true);
    }

    expect(getKubernetesAiAccessAdminPermissionTitles()).toEqual(
      expect.arrayContaining([
        "Project Owner",
        "Project Admin",
        "Edit AI Rule",
      ]),
    );
  });

  test("is refused to every other cluster editor", () => {
    for (const permission of [
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditKubernetesCluster,
      Permission.ReadRunner,
    ]) {
      grant([...BASE_PERMISSIONS, permission]);
      expect(canConfigureUnattendedKubernetesAiAccess()).toBe(false);
      expect(canResetKubernetesAiAgent()).toBe(false);
    }
  });

  test("reads a block row as a denial, not a grant", () => {
    grant(
      [...BASE_PERMISSIONS, Permission.ProjectMember],
      [Permission.ProjectAdmin, Permission.EditAutoRemediationRule],
    );
    expect(canConfigureUnattendedKubernetesAiAccess()).toBe(false);
    expect(holdsKubernetesAiAccessPermission([Permission.ProjectMember])).toBe(
      true,
    );
  });

  test("offers Reset agent only to the admin set with an edit of clusters, as the route asks both", () => {
    // The admin set, but no edit of clusters at all: the route would refuse.
    grant([
      ...BASE_PERMISSIONS,
      Permission.EditAutoRemediationRule,
      Permission.ReadKubernetesCluster,
    ]);
    expect(canResetKubernetesAiAgent()).toBe(false);

    // A project admin whose edit of clusters is blocked outright.
    grant(
      [...BASE_PERMISSIONS, Permission.ProjectAdmin],
      [Permission.EditKubernetesCluster],
    );
    expect(canResetKubernetesAiAgent()).toBe(false);

    // The admin set and an edit of clusters through a member role.
    grant([
      ...BASE_PERMISSIONS,
      Permission.EditAutoRemediationRule,
      Permission.ProjectMember,
    ]);
    expect(canResetKubernetesAiAgent()).toBe(true);

    // A master admin is offered it; nothing is offered before the snapshot lands.
    grantNothingYet();
    expect(canResetKubernetesAiAgent()).toBe(false);
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    expect(canResetKubernetesAiAgent()).toBe(true);
  });

  test("is allowed to a master admin and withheld before the snapshot lands", () => {
    grantNothingYet();
    expect(canConfigureUnattendedKubernetesAiAccess()).toBe(false);

    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    expect(canConfigureUnattendedKubernetesAiAccess()).toBe(true);
  });

  test("decides what the Change modal offers", () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectAdmin]);
    expect(getKubernetesAiAccessEditCapabilities()).toEqual({
      canConfigureUnattended: true,
    });

    grant([
      ...BASE_PERMISSIONS,
      Permission.EditAutoRemediationRule,
      Permission.EditKubernetesCluster,
      Permission.ReadKubernetesCluster,
    ]);
    expect(getKubernetesAiAccessEditCapabilities()).toEqual({
      canConfigureUnattended: true,
    });

    // Reading Runners no longer unlocks anything here: there is no picker.
    grant([
      ...BASE_PERMISSIONS,
      Permission.ProjectMember,
      Permission.ReadRunner,
    ]);
    expect(getKubernetesAiAccessEditCapabilities()).toEqual({
      canConfigureUnattended: false,
    });
  });

  // The page's titles and PermissionGate's must never disagree.
  test("names permissions exactly as PermissionGate does, without a browser", () => {
    for (const permissions of [
      KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
      new Runner().getReadPermissions(),
      PROJECT_AI_SETTINGS_PERMISSIONS,
      [Permission.ProjectOwner, Permission.ProjectOwner],
    ]) {
      expect(getPermissionTitles(permissions)).toEqual(
        PermissionGate.getPermissionTitles(permissions),
      );
    }
  });
});

/*
 * The project's AI switches (AI Features, LLM providers, AI credits,
 * automatic investigation) are changed by project owners and admins — the
 * update ACL of Project.enableAutomaticIncidentInvestigation. Everyone else
 * is told who to ask.
 */
describe("who may change the project's AI settings from the cluster page", () => {
  test("project owners, admins and a master admin", () => {
    expect(PROJECT_AI_SETTINGS_PERMISSIONS).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    for (const permission of PROJECT_AI_SETTINGS_PERMISSIONS) {
      grant([...BASE_PERMISSIONS, permission]);
      expect(canChangeProjectAiSettings()).toBe(true);
    }

    grantNothingYet();
    expect(canChangeProjectAiSettings()).toBe(false);
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    expect(canChangeProjectAiSettings()).toBe(true);
  });

  test("not members, cluster editors or the auto-remediation admin set", () => {
    for (const permission of [
      Permission.ProjectMember,
      Permission.EditKubernetesCluster,
      Permission.EditAutoRemediationRule,
      Permission.SettingsAdmin,
    ]) {
      grant([...BASE_PERMISSIONS, permission]);
      expect(canChangeProjectAiSettings()).toBe(false);
    }
  });
});

/*
 * The kubectl command history (now on the AI Logs page) is RunnerJob
 * rows, which roles that may open the cluster's pages may not read.
 */
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

describe("connection test permission", () => {
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

  test("a refusal talks about testing the connection, not changing settings", () => {
    expect(getAccessTestPermissionRequirement()).toMatch(
      /^Testing the connection needs permission to edit this cluster/,
    );
    const message: string = getAccessTestPermissionMessage();
    expect(message).toMatch(/Nothing .* was changed/);
    expect(message).not.toMatch(/permission to change/);
  });
});

/*
 * The page's mode copy against the canonical description on
 * KubernetesAiRemediationMode. The shared phrases are checked in the
 * canonical comment too, so rewording it flags this copy for review.
 */
describe("the mode copy follows the canonical description", () => {
  const CANONICAL_SOURCE: string = path.resolve(
    __dirname,
    "../../../Types/Kubernetes/KubernetesClusterAiAccess.ts",
  );
  const COMMENT_LINE_BREAK_REGEX: RegExp = /\s*\n\s*\*?\s*/g;

  function getCanonicalModeComment(): string {
    const source: string = fs.readFileSync(CANONICAL_SOURCE, "utf8");
    const enumStart: number = source.indexOf(
      "export enum KubernetesAiRemediationMode",
    );
    const commentStart: number = source.lastIndexOf("/*", enumStart);
    expect(enumStart).toBeGreaterThan(-1);
    expect(commentStart).toBeGreaterThan(-1);
    return source
      .slice(commentStart, enumStart)
      .replace(COMMENT_LINE_BREAK_REGEX, " ");
  }

  const EVERY_MODE_CLAUSES: Array<string> = [
    "never changes its own namespace or anything outside the namespaces its chart may write",
    "the hourly per-cluster circuit breaker trips or another unattended round already holds the cluster",
  ];

  const NODE_CLAUSE_SHAPE_REGEX: RegExp =
    /a node drain(,| and) a node taint[^;]{0,120} always need a human/;
  const PAGE_NODE_CLAUSE: string =
    "a node drain, a node taint and a patch of a node always need a human";

  test("the canonical comment still says what the page repeats", () => {
    const canonical: string = getCanonicalModeComment();
    for (const clause of [
      ...EVERY_MODE_CLAUSES,
      "In EVERY mode, Bypass approval included",
      "set image, drain, taint, scale to zero",
      "except for what always asks",
    ]) {
      expect({ clause, inCanonical: canonical.includes(clause) }).toEqual({
        clause,
        inCanonical: true,
      });
    }
    expect(canonical).toMatch(NODE_CLAUSE_SHAPE_REGEX);
  });

  test("the node clause shape needs both the drain and the taint", () => {
    expect(PAGE_NODE_CLAUSE).toMatch(NODE_CLAUSE_SHAPE_REGEX);
    expect("a node drain always needs a human").not.toMatch(
      NODE_CLAUSE_SHAPE_REGEX,
    );
  });

  test("every mode's protections name the drain, the taint, the agent's scope and both proposal cases", () => {
    const sentence: string = getEveryModeProtectionsSentence();
    for (const clause of EVERY_MODE_CLAUSES) {
      expect({ clause, said: sentence.includes(clause) }).toEqual({
        clause,
        said: true,
      });
    }
    expect(sentence).toContain(PAGE_NODE_CLAUSE);
    expect(sentence).toContain("the in-cluster agent never changes");
    for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
      expect(sentence).toContain(namespace);
    }
  });

  test("the list the modal shows is the sentence the confirmations say, clause for clause", () => {
    const clauses: Array<string> = getEveryModeProtections();

    expect(clauses).toHaveLength(4);
    expect(getEveryModeProtectionsSentence()).toBe(
      joinAiAccessProtections(clauses),
    );
    // A clause may hold a ";" of its own: the list is built, never split.
    expect(clauses[0]).toBe(
      "destructive commands (deleting namespaces, volumes, nodes, secrets or CRDs; exec; apply) never run",
    );
    expect(formatAiAccessProtections(clauses)[0]).toBe(
      "Destructive commands (deleting namespaces, volumes, nodes, secrets or CRDs; exec; apply) never run.",
    );
  });

  test("the mode cards name the safe and riskier changes, the one-click approval and Bypass's exceptions", () => {
    const automatic: string =
      REMEDIATION_MODE_OPTION_DESCRIPTIONS[
        KubernetesAiRemediationMode.Automatic
      ];
    expect(automatic).toContain(
      "Riskier ones (patch, set image, drain, taint, scale to zero, …) wait for one-click approval unless the kubectl allowlist names them.",
    );
    expect(automatic).toContain("delete a named pod");
    expect(automatic).not.toMatch(/delete a named pod or job/);

    const bypass: string =
      REMEDIATION_MODE_OPTION_DESCRIPTIONS[
        KubernetesAiRemediationMode.BypassApproval
      ];
    expect(bypass).toMatch(/^AI does not ask: /);
    expect(bypass).toContain("follow-up rounds included");
    expect(bypass).toContain(
      "Writes in protected namespaces and node drains, taints and patches still ask a person.",
    );

    expect(
      REMEDIATION_MODE_OPTION_DESCRIPTIONS[
        KubernetesAiRemediationMode.RequireApproval
      ],
    ).toContain("AI proposes the exact kubectl fix");
    expect(
      REMEDIATION_MODE_OPTION_DESCRIPTIONS[
        KubernetesAiRemediationMode.Disabled
      ],
    ).toBe("AI never proposes or runs a fix. It can still investigate.");
  });

  test("Off speaks of fixes only, never of investigating", () => {
    expect(
      REMEDIATION_MODE_SUMMARIES[KubernetesAiRemediationMode.Disabled],
    ).toBe("AI never proposes or runs a fix.");
    for (const summary of Object.values(REMEDIATION_MODE_SUMMARIES)) {
      expect(summary).not.toMatch(/only investigates/);
    }
  });

  test("investigation on says what AI may run, and that it changes nothing", () => {
    expect(INVESTIGATION_ON_SENTENCE).toBe(
      "AI may run read-only kubectl on this cluster: get, describe, logs, events, top. It never changes anything.",
    );
  });

  test("the kubectl allowlist help gives the matcher's rules, and stays short", () => {
    expect(KUBECTL_ALLOWLIST_FIELD_DESCRIPTION).toContain(
      "* matches exactly one word",
    );
    expect(KUBECTL_ALLOWLIST_FIELD_DESCRIPTION).toContain(
      'a leading "kubectl" is optional',
    );
    expect(
      KUBECTL_ALLOWLIST_FIELD_DESCRIPTION.split(/\s+/).length,
    ).toBeLessThan(60);
    expect(KUBECTL_ALLOWLIST_FIELD_DESCRIPTION).not.toMatch(/permission/);
    // What the help promises is what the policy accepts.
    expect(
      validateKubectlAllowlistText("kubectl set image deployment/web * -n web"),
    ).toBeNull();
  });

  test("every mode has its own short name, one-line summary and card description", () => {
    for (const record of [
      REMEDIATION_MODE_OPTION_DESCRIPTIONS,
      REMEDIATION_MODE_SHORT_NAMES,
      REMEDIATION_MODE_SUMMARIES,
    ]) {
      const values: Array<string> = Object.values(
        KubernetesAiRemediationMode,
      ).map((mode: KubernetesAiRemediationMode): string => {
        return record[mode];
      });
      expect(
        values.every((value: string): boolean => {
          return value.trim().length > 0;
        }),
      ).toBe(true);
      expect(new Set(values).size).toBe(values.length);
    }
    expect(REMEDIATION_MODE_SHORT_NAMES).toEqual({
      [KubernetesAiRemediationMode.Disabled]: "Off",
      [KubernetesAiRemediationMode.RequireApproval]: "Ask for approval",
      [KubernetesAiRemediationMode.Automatic]: "Automatic",
      [KubernetesAiRemediationMode.BypassApproval]: "Bypass approval",
    });
  });

  test("Automatic says a riskier fix waits for one-click approval", () => {
    for (const text of [
      REMEDIATION_MODE_OPTION_DESCRIPTIONS[
        KubernetesAiRemediationMode.Automatic
      ],
      REMEDIATION_MODE_SUMMARIES[KubernetesAiRemediationMode.Automatic],
    ]) {
      expect(text).toMatch(/one-click approval/);
      expect(text).not.toMatch(/left for you/);
    }
  });

  /*
   * Bypass approval's card, with the every-mode protections listed right
   * under the cards, names every exception — another unattended round
   * included.
   */
  test("Bypass approval's card and the protections under it name every exception", () => {
    const card: string =
      REMEDIATION_MODE_OPTION_DESCRIPTIONS[
        KubernetesAiRemediationMode.BypassApproval
      ];
    const said: string = [card, ...getEveryModeProtections()].join(" ");
    for (const exception of [
      "protected namespaces",
      "node drains, taints and patches",
      "circuit breaker",
      "another unattended round",
    ]) {
      expect({ exception, named: said.includes(exception) }).toEqual({
        exception,
        named: true,
      });
    }
    expect(card).not.toMatch(/\bonly\b/);
    expect(card).not.toMatch(/nobody is asked/);
    expect(
      REMEDIATION_MODE_SUMMARIES[KubernetesAiRemediationMode.BypassApproval],
    ).toContain("still ask a person");
  });

  test("the Bypass approval confirmation says AI does not ask, then what still asks", () => {
    const confirmation: KubernetesAiAccessConfirmation | null =
      getKubernetesAiAccessConfirmation({
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
        changes: {
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        },
      });
    expect(confirmation!.description).toContain(
      "With Bypass approval OneUptime AI does not ask",
    );
    expect(confirmation!.description).toContain(
      getEveryModeProtectionsSentence(),
    );
  });
});

/*
 * Which Runner rows are kubernetes-agent Runners: the server's one rule
 * (RunnerService.isKubernetesAgentRunnerRow) — the name marker, compared
 * case-insensitively, OR an agent posture.
 */
describe("a kubernetes-agent Runner, by the server's rule", () => {
  const postureOnly: Runner = makeRunner(
    "r-renamed",
    "prod-eu-kubectl",
    true,
    "prod-eu",
  );
  const upperCaseName: Runner = makeRunner(
    "r-upper",
    "KUBERNETES-AGENT/prod-eu",
    true,
  );
  const podNoCluster: Runner = Object.assign(new Runner(), {
    _id: "r-pod",
    name: "pod-runner",
    canRunAiCommands: true,
    hostInfo: { kubernetes: { inCluster: true, allowWrites: true } },
  });
  const hostRunner: Runner = makeRunner("r-host", "bash-runner");

  test("the rule reads the name in any case, or the posture", () => {
    expect(isKubernetesAgentRunnerRow(postureOnly)).toBe(true);
    expect(isKubernetesAgentRunnerRow(upperCaseName)).toBe(true);
    expect(
      isKubernetesAgentRunnerRow({ name: "  Kubernetes-Agent/prod-eu " }),
    ).toBe(true);
    expect(isKubernetesAgentRunnerRow(podNoCluster)).toBe(false);
    expect(isKubernetesAgentRunnerRow(hostRunner)).toBe(false);
    expect(isKubernetesAgentRunnerRow({ name: "kubernetes-agent" })).toBe(
      false,
    );
    expect(isKubernetesAgentRunnerRow(null)).toBe(false);
    expect(isKubernetesAgentRunnerRow({})).toBe(false);
  });
});

/*
 * Everything the cluster's "What AI may do" card, its Change modal and the
 * write-access panel say is looked up in the Dashboard's locale files
 * (src/Locales/README.md): a constant or a map's label is a key, and a
 * function answers with whole keyed sentences. The mode maps were keyed by
 * an enum the extractor cannot read, and the clauses, notes and refusals
 * were plain strings and template literals that read English everywhere.
 *
 * A pseudo-locale wraps every en.json entry in ‹ ›, so what was looked up
 * comes back wrapped, and so does a word or a list put into it. These run
 * last: they set up the global i18next instance the functions read.
 */
describe("in the reader's language", () => {
  const ENGLISH: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const LOOKED_UP: RegExp = /^‹[^]*›$/;

  const BYPASS_SENTENCE: string =
    "With Bypass approval OneUptime AI does not ask: it applies every fix the kubectl policy allows on this cluster on its own — {{examples}} included, in follow-up rounds too. Even so, {{protections}}.";

  const toBypass: {
    saved: KubernetesAiAccessSavedSettings;
    changes: JSONObject;
  } = {
    saved: makeSaved({
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    }),
    changes: { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
  };

  beforeAll(async () => {
    const pseudo: Record<string, string> = {};

    for (const [key, value] of Object.entries(ENGLISH)) {
      if (typeof value === "string") {
        pseudo[key] = `‹${value}›`;
      }
    }

    // Every wording but the Bypass approval confirmation's.
    const withoutBypassSentence: Record<string, string> = { ...pseudo };
    delete withoutBypassSentence[BYPASS_SENTENCE];

    await i18next.init({
      lng: "xx",
      fallbackLng: "en",
      resources: {
        xx: { translation: pseudo },
        yy: { translation: withoutBypassSentence },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test("the mode maps and the constants are keys in en.json", async () => {
    await i18next.changeLanguage("xx");

    for (const key of [
      ...Object.values(REMEDIATION_MODE_SHORT_NAMES),
      ...Object.values(REMEDIATION_MODE_SUMMARIES),
      ...Object.values(REMEDIATION_MODE_OPTION_DESCRIPTIONS),
      INVESTIGATION_ON_SENTENCE,
      KUBECTL_ALLOWLIST_FIELD_DESCRIPTION,
      getKubernetesAiAccessConfirmation(toBypass)!.title,
    ]) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });

  test("each every-mode protection, with the namespaces listed in the reader's words", async () => {
    await i18next.changeLanguage("xx");

    const clauses: Array<string> = getEveryModeProtections();

    expect(clauses).toHaveLength(4);
    for (const clause of clauses) {
      expect(clause).toMatch(LOOKED_UP);
    }
    expect(clauses[1]).toBe(
      "‹a write in ‹kube-system, kube-public or kube-node-lease›, a node drain, a node taint and a patch of a node always need a human›",
    );
    expect(getEveryModeProtectionsSentence()).toBe(
      `‹${clauses[0]}; ${clauses[1]}; ${clauses[2]}; and ${clauses[3]}›`,
    );
  });

  test("every loosening the refusal names", async () => {
    await i18next.changeLanguage("xx");

    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: makeSaved(),
        changes: {
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
          aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, PATCH_PATTERN],
        },
      }),
    ).toEqual([
      "‹switching fixes to ‹Bypass approval››",
      `‹adding the kubectl allowlist pattern "${PATCH_PATTERN}"›`,
    ]);
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: makeSaved({ aiKubectlCommandAllowlist: [] }),
        changes: {
          aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, PATCH_PATTERN],
        },
      }),
    ).toEqual([
      `‹adding the kubectl allowlist patterns "${SET_IMAGE_PATTERN}", "${PATCH_PATTERN}"›`,
    ]);
  });

  test("the confirmations, the protections in them in the reader's words", async () => {
    await i18next.changeLanguage("xx");

    const bypass: KubernetesAiAccessConfirmation | null =
      getKubernetesAiAccessConfirmation(toBypass);

    expect(bypass!.description).toMatch(LOOKED_UP);
    expect(bypass!.description).toContain(getEveryModeProtectionsSentence());

    for (const changes of [
      {
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        aiKubectlCommandAllowlist: [BROAD_PATTERN],
      },
      { aiKubectlCommandAllowlist: [BROAD_PATTERN, `${BROAD_PATTERN} -o`] },
    ]) {
      const confirmation: KubernetesAiAccessConfirmation | null =
        getKubernetesAiAccessConfirmation({
          saved: makeSaved({
            aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
          }),
          changes,
        });

      expect(ENGLISH[confirmation!.title]).toBe(confirmation!.title);
      expect(confirmation!.description).toMatch(LOOKED_UP);
    }
  });

  /*
   * A language that words the protections but not the confirmation reads
   * the whole confirmation in English, protections included.
   */
  test("a confirmation the reader's language lacks is English, its protections too", async () => {
    await i18next.changeLanguage("en");
    const english: string =
      getKubernetesAiAccessConfirmation(toBypass)!.description;

    await i18next.changeLanguage("yy");
    expect(getKubernetesAiAccessConfirmation(toBypass)!.description).toBe(
      english,
    );
    expect(getEveryModeProtectionsSentence()).toMatch(LOOKED_UP);
  });

  test("the allowlist's errors", async () => {
    await i18next.changeLanguage("xx");

    const tooMany: string = Array.from(
      { length: KUBECTL_ALLOWLIST_MAX_PATTERNS + 1 },
      (_value: unknown, index: number): string => {
        return `kubectl rollout restart deployment/web-${index} -n web`;
      },
    ).join("\n");

    expect(validateKubectlAllowlistText(tooMany)).toBe(
      `‹At most ${KUBECTL_ALLOWLIST_MAX_PATTERNS} patterns; this list has ${KUBECTL_ALLOWLIST_MAX_PATTERNS + 1}.›`,
    );
    // The policy's own words stay as it says them.
    expect(validateKubectlAllowlistText("kubectl *")).toMatch(
      /^‹Pattern 1: .+›$/,
    );
    expect(
      getKubectlAllowlistRemovalOnlyError({
        text: PATCH_PATTERN,
        storedValue: [SET_IMAGE_PATTERN],
      }),
    ).toMatch(LOOKED_UP);
  });

  test("the write-access notes and the disclosure, the namespaces listed in the reader's words", async () => {
    await i18next.changeLanguage("xx");

    expect(getAiAgentScopedCommandNote()).toMatch(LOOKED_UP);
    expect(getAiAgentScopedCommandNote()).toContain(
      AI_AGENT_EXAMPLE_WRITE_NAMESPACES,
    );
    expect(getAiAgentClusterWideCommandNote()).toMatch(LOOKED_UP);
    expect(
      getAiAgentClusterWideCommandNote().startsWith(
        `‹${AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG} clears`,
      ),
    ).toBe(true);

    const disclosure: string = getAiAgentWriteDisclosure();

    expect(disclosure).toMatch(LOOKED_UP);
    expect(disclosure).toContain(
      "‹kube-system, kube-public and kube-node-lease›",
    );
    expect(disclosure).toContain(
      "‹kube-system, kube-public or kube-node-lease›",
    );
  });

  test("the connection test's permission sentences", async () => {
    await i18next.changeLanguage("xx");

    expect(getAccessTestPermissionRequirement()).toMatch(
      /^‹Testing the connection needs permission to edit this ‹cluster› \(one of: .+\)\.›$/,
    );
    expect(getAccessTestPermissionMessage()).toMatch(LOOKED_UP);
  });
});
