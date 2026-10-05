import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
  KubernetesAiCredentialDirectoryEntry,
  KubernetesAiRunnerDirectoryEntry,
  INVESTIGATION_ON_SENTENCE,
  KUBECTL_ALLOWLIST_FIELD_DESCRIPTION,
  REMEDIATION_MODES_BY_AUTONOMY,
  REMEDIATION_MODE_OPTION_DESCRIPTIONS,
  REMEDIATION_MODE_SHORT_NAMES,
  REMEDIATION_MODE_SUMMARIES,
  SavedKubectlAllowlist,
  buildKubernetesAiCredentialDirectory,
  buildKubernetesAiCredentialOptions,
  buildKubernetesAiRunnerDirectory,
  buildKubernetesAiRunnerOptions,
  capitalizeFirst,
  getAllowlistInEffect,
  getEveryModeProtections,
  getEveryModeProtectionsSentence,
  getKubectlAllowlistRemovalOnlyError,
  getKubernetesAiAccessAdminPermissionTitles,
  getKubernetesAiAccessBindingError,
  getKubernetesAiAccessChosenRunnerId,
  getKubernetesAiAccessConfirmation,
  getKubernetesAiAccessLooseningChanges,
  getKubernetesAiAccessOfferedFields,
  getKubernetesAiAccessSettingsChanges,
  getKubernetesAiAccessSettingsInitialValues,
  getKubernetesAiAccessSubmittedFields,
  getKubernetesAiCredentialAssignmentError,
  getKubernetesAiCredentialFieldDescription,
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
  canPickKubernetesCredential,
  canPickKubernetesRunner,
  canReadKubectlJobs,
  canResetKubernetesAiAgent,
  getAccessTestPermissionGate,
  getAccessTestPermissionMessage,
  getAccessTestPermissionRequirement,
  getKubectlJobsPermissionTitles,
  getKubernetesAiAccessEditCapabilities,
  getKubernetesCredentialPermissionTitles,
  getKubernetesRunnerPermissionTitles,
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
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiRemediationMode,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
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
 * is read and checked (by KubectlPolicy, the matcher's own rules), which
 * Runners and credentials an advanced binding's pickers offer
 * (KubernetesAiAccessSettings), and the permission reads
 * (KubernetesAiAccessPermissions). The status helpers are covered by
 * KubernetesClusterAiAgentStatus.test.ts, the rendered page by
 * KubernetesClusterAiPage.test.tsx, and the server-side parity checks by
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
  --namespace oneuptime-agent --reuse-values \\
  --set aiAgent.enabled=true`;
const EXACT_APPLY_SETTINGS_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reuse-values \\
  --set aiAgent.enabled=true \\
  --set aiAgent.investigation=true \\
  --set aiAgent.fixes=ask-for-approval`;
const EXACT_SCOPED_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reuse-values \\
  --set aiAgent.enabled=true \\
  --set aiAgent.investigation=true \\
  --set aiAgent.fixes=ask-for-approval \\
  --set "aiAgent.remediation.namespaces={web,api}" \\
  --set aiAgent.remediation.nodeOperations=false`;
const EXACT_CLUSTER_WIDE_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reuse-values \\
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

// Saved settings of a cluster bound to an advanced (outside-the-chart) Runner.
function makeSaved(
  overrides: Partial<KubernetesAiAccessSavedSettings> = {},
): KubernetesAiAccessSavedSettings {
  return {
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
    aiAccessRunnerId: RUNNER_ID,
    aiAccessRunnerName: "bash-runner",
    aiAccessCredentialId: null,
    aiAccessCredentialName: null,
    ...overrides,
  };
}

// Saved settings of a cluster reached through its Kubernetes AI agent.
function makeAgentSaved(
  overrides: Partial<KubernetesAiAccessSavedSettings> = {},
): KubernetesAiAccessSavedSettings {
  return makeSaved({
    aiAccessRunnerId: null,
    aiAccessRunnerName: null,
    ...overrides,
  });
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
   * namespace list and no node operations flag, so --reuse-values keeps
   * them.
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
      expect(command).toContain("--reuse-values");
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
   * stored list under --reuse-values (a `=null` override would be dropped).
   */
  test("the cluster-wide command hands helm an empty JSON list for the namespaces", () => {
    const argv: Array<string> = getHelmUpgradeArgv(
      getAiAgentHelmCommands().enableRemediation,
    );
    expect(argv).toContain("--reuse-values");

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
      "helm repo update\nhelm upgrade r c --reuse-values \\\n  --set aiAgent.remediation.namespaces=null",
    );
    expect(
      getFlagValues(withNull, "--set").some((setting: string): boolean => {
        return NULL_NAMESPACES_VALUE_REGEX.test(setting);
      }),
    ).toBe(true);
  });

  test("no command pairs --reuse-values with a null namespace list", () => {
    for (const command of allCommands()) {
      const argv: Array<string> = getHelmUpgradeArgv(command);
      expect({
        command,
        reuseValues: argv.includes("--reuse-values"),
        nullNamespaces: getFlagValues(argv, "--set").some(
          (setting: string): boolean => {
            return NULL_NAMESPACES_VALUE_REGEX.test(setting);
          },
        ),
        nullText: command.includes("namespaces=null"),
      }).toEqual({
        command,
        reuseValues: true,
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
  test("takes the binding from the FK column or the relation", () => {
    const fromRelation: KubernetesAiAccessSavedSettings =
      readKubernetesAiAccessSavedSettings(
        Object.assign(new KubernetesCluster(), {
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
          aiAccessRunner: Object.assign(new Runner(), {
            _id: RUNNER_ID,
            name: "bash-runner",
          }),
        }),
      );
    expect(fromRelation.aiAccessRunnerId).toBe(RUNNER_ID);
    expect(fromRelation.aiAccessRunnerName).toBe("bash-runner");
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
    expect(fromColumn.aiRemediationMode).toBe(
      KubernetesAiRemediationMode.Disabled,
    );
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
    expect(initial.aiAccessRunnerId).toBe(RUNNER_ID);
    expect(initial.aiAccessCredentialId).toBe("");
  });
});

describe("what the Change modal offers", () => {
  test("an admin on an advanced binding with both pickers gets the pickers and a free allowlist", () => {
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeSaved({ aiKubectlCommandAllowlist: [] }),
        canConfigureUnattended: true,
        isRunnerPickerAvailable: true,
        isCredentialPickerAvailable: true,
        isAdvancedBinding: true,
        hasAiAgent: true,
      }),
    ).toEqual(EVERYTHING_OFFERED);
  });

  /*
   * The pickers are removed for every cluster without an advanced binding:
   * it is reached through its Kubernetes AI agent, and there is nothing to
   * pick. Even an admin who could list Runners gets none.
   */
  test("a cluster without an advanced binding gets no Runner or credential field at all", () => {
    for (const saved of [
      makeAgentSaved(),
      // Still bound to the previous in-cluster Runner.
      makeSaved({ aiAccessRunnerName: "kubernetes-agent/prod-east" }),
    ]) {
      for (const canConfigureUnattended of [true, false]) {
        const offered: KubernetesAiAccessOfferedFields =
          getKubernetesAiAccessOfferedFields({
            saved,
            canConfigureUnattended,
            isRunnerPickerAvailable: true,
            isCredentialPickerAvailable: true,
            isAdvancedBinding: false,
            hasAiAgent: true,
          });
        expect({
          runner: offered.runner,
          credential: offered.credential,
          runnerClear: offered.runnerClear,
          credentialClear: offered.credentialClear,
        }).toEqual({
          runner: false,
          credential: false,
          runnerClear: false,
          credentialClear: false,
        });
      }
    }
  });

  /*
   * Unbinding an advanced Runner used to be a tightening every editor could
   * make. With an AI agent row it moves the cluster to the agent — which
   * may hold broader write RBAC — so the switch is no longer offered to a
   * cluster editor without the admin set (critique finding 2).
   */
  test("a cluster editor may unbind an advanced binding only while the cluster has no AI agent", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiAccessCredentialId: CREDENTIAL_ID,
    });

    expect(
      getKubernetesAiAccessOfferedFields({
        saved,
        canConfigureUnattended: false,
        isRunnerPickerAvailable: false,
        isCredentialPickerAvailable: false,
        isAdvancedBinding: true,
        hasAiAgent: false,
      }),
    ).toEqual(TIGHTEN_ONLY_OFFERED);

    expect(
      getKubernetesAiAccessOfferedFields({
        saved,
        canConfigureUnattended: false,
        isRunnerPickerAvailable: false,
        isCredentialPickerAvailable: false,
        isAdvancedBinding: true,
        hasAiAgent: true,
      }),
    ).toEqual({
      ...TIGHTEN_ONLY_OFFERED,
      runnerClear: false,
      credentialClear: false,
    });
  });

  test("an admin who may not list Runners may still unbind, with or without an agent", () => {
    for (const hasAiAgent of [true, false]) {
      const offered: KubernetesAiAccessOfferedFields =
        getKubernetesAiAccessOfferedFields({
          saved: makeSaved(),
          canConfigureUnattended: true,
          isRunnerPickerAvailable: false,
          isCredentialPickerAvailable: true,
          isAdvancedBinding: true,
          hasAiAgent,
        });
      expect(offered.runner).toBe(false);
      expect(offered.runnerClear).toBe(true);
      expect(offered.credential).toBe(true);
      // Nothing bound: nothing to unbind.
      expect(offered.credentialClear).toBe(false);
    }
  });

  test("nothing to remove means no allowlist field for a cluster editor", () => {
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeAgentSaved({ aiKubectlCommandAllowlist: [] }),
        canConfigureUnattended: false,
        isRunnerPickerAvailable: false,
        isCredentialPickerAvailable: false,
        isAdvancedBinding: false,
        hasAiAgent: true,
      }),
    ).toEqual({
      ...NOTHING_OFFERED,
      allowlistRemoveOnly: true,
    });

    // An unclean stored allowlist is offered, so it can be cleared.
    expect(
      getKubernetesAiAccessOfferedFields({
        saved: makeAgentSaved({ aiKubectlCommandAllowlist: { a: 1 } }),
        canConfigureUnattended: false,
        isRunnerPickerAvailable: false,
        isCredentialPickerAvailable: false,
        isAdvancedBinding: false,
        hasAiAgent: true,
      }).allowlist,
    ).toBe(true);
  });

  test("the allowlist field shows, and is sent, only while Automatic is chosen", () => {
    const saved: KubernetesAiAccessSavedSettings = makeAgentSaved();

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
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiAccessCredentialId: CREDENTIAL_ID,
    });
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
        hasAiAgent: false,
      }),
    ).toEqual(["switching fixes to Bypass approval"]);
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromOff,
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
        hasAiAgent: false,
      }),
    ).toEqual(["switching fixes to Automatic"]);
    // Regression (§11): turning fixes on at all needs the admin set now.
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromOff,
        changes: {
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        },
        hasAiAgent: false,
      }),
    ).toEqual(["switching fixes to Ask for approval"]);

    // Bypass approval -> Automatic is a tightening.
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromBypass,
        changes: { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
        hasAiAgent: false,
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
          hasAiAgent: true,
        }),
      ).toEqual([]);
    }
    // Not a mode: nothing to judge.
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: fromOff,
        changes: { aiRemediationMode: "automatic" },
        hasAiAgent: false,
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
          hasAiAgent: false,
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
        hasAiAgent: false,
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
        hasAiAgent: false,
      }),
    ).toEqual([
      'adding the kubectl allowlist patterns "kubectl set image deployment/web * -n prod", "kubectl set image deployment/api * -n prod"',
    ]);
  });

  test("binding another Runner or a credential loosens; re-sending the bound one never does", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiAccessCredentialId: CREDENTIAL_ID,
    });

    for (const hasAiAgent of [true, false]) {
      expect(
        getKubernetesAiAccessLooseningChanges({
          saved,
          changes: { aiAccessRunnerId: OTHER_RUNNER_ID },
          hasAiAgent,
        }),
      ).toEqual(["binding a different Runner"]);
      expect(
        getKubernetesAiAccessLooseningChanges({
          saved: makeSaved(),
          changes: { aiAccessCredentialId: CREDENTIAL_ID },
          hasAiAgent,
        }),
      ).toEqual(["binding a Kubernetes credential"]);

      for (const changes of [
        { aiAccessRunnerId: RUNNER_ID },
        { aiAccessCredentialId: CREDENTIAL_ID },
        { isAiInvestigationEnabled: true },
        { isAiInvestigationEnabled: false },
      ] as Array<JSONObject>) {
        expect(
          getKubernetesAiAccessLooseningChanges({ saved, changes, hasAiAgent }),
        ).toEqual([]);
      }
    }
  });

  /*
   * Regression (§11 "clearing a Runner binding with an agent row needs
   * admin"): clearing the binding used to be a tightening every editor
   * could make. With an agent row it changes the resolved access target to
   * the agent, so it loosens; without one it only takes access away.
   */
  test("clearing the Runner or credential loosens exactly when the cluster has an AI agent", () => {
    const saved: KubernetesAiAccessSavedSettings = makeSaved({
      aiAccessCredentialId: CREDENTIAL_ID,
    });

    expect(
      getKubernetesAiAccessLooseningChanges({
        saved,
        changes: { aiAccessRunnerId: null, aiAccessCredentialId: null },
        hasAiAgent: true,
      }),
    ).toEqual([
      "switching this cluster to its Kubernetes AI agent",
      "removing the Kubernetes credential",
    ]);
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved,
        changes: { aiAccessRunnerId: null, aiAccessCredentialId: null },
        hasAiAgent: false,
      }),
    ).toEqual([]);

    // Clearing what is not bound changes nothing.
    expect(
      getKubernetesAiAccessLooseningChanges({
        saved: makeAgentSaved(),
        changes: { aiAccessRunnerId: null, aiAccessCredentialId: null },
        hasAiAgent: true,
      }),
    ).toEqual([]);
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

/*
 * The Runner picker exists only for a cluster already bound to a Runner
 * outside the chart. The Kubernetes AI agent replaces the chart's previous
 * in-cluster Runner, so no kubernetes-agent row is ever offered — this
 * cluster's included — and switching back to the agent is "leave the
 * Runner empty".
 */
describe("Runner picker options (advanced bindings)", () => {
  const runners: Array<Runner> = [
    makeRunner("r-this", "kubernetes-agent/prod-east", true, "prod-east"),
    makeRunner("r-other-cluster", "kubernetes-agent/prod-eu", true, "prod-eu"),
    makeRunner("r-renamed", "prod-eu-kubectl", true, "prod-eu"),
    makeRunner("r-host", "bash-runner"),
    makeRunner("r-off", "ops-runner", false),
  ];

  test("offer only Runners outside the chart that run AI commands", () => {
    const options: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
      runners,
      boundRunnerId: null,
      boundRunnerName: null,
    });

    expect(options).toEqual([{ value: "r-host", label: "bash-runner" }]);
  });

  test("keep the bound Runner, saying why it cannot serve the cluster", () => {
    expect(
      optionLabel(
        buildKubernetesAiRunnerOptions({
          runners,
          boundRunnerId: "r-this",
          boundRunnerName: "kubernetes-agent/prod-east",
        }),
        "r-this",
      ),
    ).toBe(
      "kubernetes-agent/prod-east (currently bound — installed by the Kubernetes agent chart, which now uses the Kubernetes AI agent)",
    );

    // A posture-only agent row is an agent row too (the server's rule).
    expect(
      optionLabel(
        buildKubernetesAiRunnerOptions({
          runners,
          boundRunnerId: "r-renamed",
          boundRunnerName: "prod-eu-kubectl",
        }),
        "r-renamed",
      ),
    ).toMatch(/currently bound — installed by the Kubernetes agent chart/);

    expect(
      optionLabel(
        buildKubernetesAiRunnerOptions({
          runners,
          boundRunnerId: "r-off",
          boundRunnerName: "ops-runner",
        }),
        "r-off",
      ),
    ).toMatch(/Runs AI Remediation Commands/);

    const boundToUnlisted: Array<DropdownOption> =
      buildKubernetesAiRunnerOptions({
        runners,
        boundRunnerId: "r-gone",
        boundRunnerName: "old-runner",
      });
    expect(boundToUnlisted[0]).toEqual({
      value: "r-gone",
      label: "old-runner (currently bound)",
    });
    expect(
      buildKubernetesAiRunnerOptions({
        runners: [],
        boundRunnerId: "r-gone",
        boundRunnerName: null,
      }),
    ).toEqual([
      { value: "r-gone", label: "The bound Runner (currently bound)" },
    ]);
  });

  test("skip a row without an id", () => {
    expect(
      buildKubernetesAiRunnerOptions({
        runners: [Object.assign(new Runner(), { name: "no-id" })],
        boundRunnerId: null,
        boundRunnerName: null,
      }),
    ).toEqual([]);
  });

  test("the directory names each Runner and says which are agent rows", () => {
    const directory: Record<string, KubernetesAiRunnerDirectoryEntry> =
      buildKubernetesAiRunnerDirectory(runners);
    expect(directory["r-this"]).toEqual({
      name: "kubernetes-agent/prod-east",
      isAgent: true,
    });
    expect(directory["r-renamed"]!.isAgent).toBe(true);
    expect(directory["r-host"]).toEqual({
      name: "bash-runner",
      isAgent: false,
    });
  });
});

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
      /^No credential can be chosen: "kubernetes-agent\/prod-east" is an in-cluster Runner/,
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

  test("the directory names each credential and its Runners", () => {
    const directory: Record<string, KubernetesAiCredentialDirectoryEntry> =
      buildKubernetesAiCredentialDirectory([
        ...credentials,
        makeCredential("c-unknown", "", undefined),
      ]);
    expect(directory["c-both"]).toEqual({
      name: "shared token",
      runnerIds: ["r-host", "r-other-host"],
    });
    expect(directory["c-unknown"]).toEqual({
      name: "c-unknown",
      runnerIds: undefined,
    });
  });
});

describe("a Runner and credential that cannot work together", () => {
  test("a credential not assigned to the Runner is refused, naming both", () => {
    expect(
      getKubernetesAiCredentialAssignmentError({
        runner: { id: "r-host", name: "bash-runner" },
        credentialId: "c-other",
        credentialName: "staging token",
        credentialRunnerIds: ["r-other-host"],
      }),
    ).toMatch(/"staging token" is not assigned to Runner "bash-runner"/);

    for (const credentialRunnerIds of [["r-host"], undefined]) {
      expect(
        getKubernetesAiCredentialAssignmentError({
          runner: { id: "r-host", name: "bash-runner" },
          credentialId: "c-host",
          credentialName: "prod-east token",
          credentialRunnerIds,
        }),
      ).toBeNull();
    }
    expect(
      getKubernetesAiCredentialAssignmentError({
        runner: { id: "r-host", name: "bash-runner" },
        credentialId: null,
        credentialName: null,
        credentialRunnerIds: undefined,
      }),
    ).toBeNull();
  });

  test("a credential without a Runner asks for one", () => {
    expect(
      getKubernetesAiCredentialAssignmentError({
        runner: { id: null, name: null },
        credentialId: "c-host",
        credentialName: null,
        credentialRunnerIds: ["r-host"],
      }),
    ).toMatch(/^The Kubernetes credential is only used through a Runner/);
  });

  test("a kubernetes-agent Runner with a credential asks for the credential to be cleared", () => {
    const error: string | null = getKubernetesAiCredentialAssignmentError({
      runner: { id: "r-this", name: "kubernetes-agent/prod-east" },
      credentialId: "c-host",
      credentialName: "prod-east token",
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
      // Resetting the agent takes the same set (the server's route gate).
      expect(canResetKubernetesAiAgent()).toBe(true);
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
      canPickRunner: true,
      canPickCredential: true,
    });

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
    expect(KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS.length).toBeGreaterThan(
      0,
    );
  });

  // The page's titles and PermissionGate's must never disagree.
  test("names permissions exactly as PermissionGate does, without a browser", () => {
    for (const permissions of [
      KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
      KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
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

describe("Runner and credential picker permissions", () => {
  test("the Runner picker is withheld from cluster editors who may not read Runners", () => {
    for (const permissions of [
      [Permission.SettingsAdmin],
      [Permission.SettingsMember],
      [Permission.EditKubernetesCluster, Permission.ReadKubernetesCluster],
    ]) {
      grant([...BASE_PERMISSIONS, ...permissions]);
      expect(canPickKubernetesRunner()).toBe(false);
    }
  });

  test("the Runner picker is offered to Runner readers and a master admin", () => {
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

  test("the credential picker needs permission to read credentials", () => {
    expect(canPickKubernetesCredential()).toBe(false);
    grant([...BASE_PERMISSIONS, Permission.ReadRunbookCredential]);
    expect(canPickKubernetesCredential()).toBe(true);
  });

  test("name the permissions that would unlock them", () => {
    expect(getKubernetesRunnerPermissionTitles()).toEqual(
      expect.arrayContaining(["Read Runbook Agent", "Project Member"]),
    );
    expect(getKubernetesCredentialPermissionTitles().join(", ")).toMatch(
      /Runbook Credential/,
    );
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

  test("the kubectl allowlist help gives an example and the matcher's rules, and stays short", () => {
    expect(KUBECTL_ALLOWLIST_FIELD_DESCRIPTION).toContain(
      "for example: kubectl set image deployment/web * -n web",
    );
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

  test("the Runner picker never offers an agent row, whatever it is named", () => {
    const options: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
      runners: [postureOnly, upperCaseName, podNoCluster, hostRunner],
      boundRunnerId: null,
      boundRunnerName: null,
    });
    // A Runner in a pod that names no cluster is an ordinary Runner.
    expect(optionValues(options)).toEqual(["r-pod", "r-host"]);
  });

  test("the credential picker offers nothing for an agent row the name does not mark", () => {
    const credentials: Array<RunbookCredential> = [
      makeCredential(CREDENTIAL_ID, "prod token", ["r-renamed"]),
    ];
    const runner: { id: string; name: string; isAgent: boolean } = {
      id: "r-renamed",
      name: "prod-eu-kubectl",
      isAgent: true,
    };

    expect(
      buildKubernetesAiCredentialOptions({
        credentials,
        boundCredentialId: null,
        boundCredentialName: null,
        runner,
      }),
    ).toEqual([]);
    expect(
      getKubernetesAiCredentialAssignmentError({
        runner,
        credentialId: CREDENTIAL_ID,
        credentialName: "prod token",
        credentialRunnerIds: ["r-renamed"],
      }),
    ).toMatch(/is an in-cluster Runner/);

    const ordinary: { id: string; name: string; isAgent: boolean } = {
      ...runner,
      isAgent: false,
    };
    expect(
      optionValues(
        buildKubernetesAiCredentialOptions({
          credentials,
          boundCredentialId: null,
          boundCredentialName: null,
          runner: ordinary,
        }),
      ),
    ).toEqual([CREDENTIAL_ID]);
  });

  test("saving a credential with an agent row the name does not mark is refused", () => {
    const runners: Record<string, KubernetesAiRunnerDirectoryEntry> =
      buildKubernetesAiRunnerDirectory([postureOnly]);
    const credentials: Record<string, KubernetesAiCredentialDirectoryEntry> =
      buildKubernetesAiCredentialDirectory([
        makeCredential(CREDENTIAL_ID, "prod token", ["r-renamed"]),
      ]);

    expect(
      getKubernetesAiAccessBindingError({
        saved: makeAgentSaved(),
        changes: {
          aiAccessRunnerId: "r-renamed",
          aiAccessCredentialId: CREDENTIAL_ID,
        },
        runners,
        credentials,
      }),
    ).toMatch(/"prod-eu-kubectl" is an in-cluster Runner/);
  });
});
