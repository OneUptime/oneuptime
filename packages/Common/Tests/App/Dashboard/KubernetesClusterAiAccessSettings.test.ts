import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  AiAccessHelmCommands,
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  KubernetesAiAccessConfirmation,
  KubernetesAiAccessOfferedFields,
  KubernetesAiAccessSavedSettings,
  MAX_KUBECTL_ALLOWLIST_PATTERNS,
  MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH,
  SavedKubectlAllowlist,
  buildKubernetesAiCredentialOptions,
  buildKubernetesAiRunnerOptions,
  canConfigureUnattendedKubernetesAiAccess,
  canPickKubernetesRunner,
  canReadKubectlJobs,
  getAccessTestPermissionGate,
  getAccessTestPermissionMessage,
  getAiAccessHelmCommands,
  getKubectlJobsPermissionTitles,
  getKubernetesAiAccessAdminPermissionTitles,
  getKubernetesAiAccessConfirmation,
  getKubernetesAiAccessEditCapabilities,
  getKubernetesAiAccessLooseningChanges,
  getKubernetesAiAccessSettingsChanges,
  getKubernetesAiAccessSettingsInitialValues,
  getKubernetesRunnerPermissionTitles,
  isBroadKubectlAllowlistPattern,
  normalizeSavedKubectlAllowlist,
  parseKubectlAllowlistText,
  readKubernetesAiAccessSavedSettings,
  validateKubectlAllowlistText,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI";
import { getKubernetesInstallationMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import { JSONObject } from "../../../Types/JSON";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { PermissionGateResult } from "../../../UI/Utils/PermissionGate";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";

/*
 * The pure pieces behind the cluster AI page's settings: who may loosen
 * what AI does, what an edit actually sends, when a save is confirmed
 * first, how the allowlist is read and checked, which Runners and
 * credentials the pickers offer, and the one-command helm upgrade. The
 * rendered page is covered by KubernetesClusterAiPage.test.tsx; these are
 * the rules it is built from, pinned one by one.
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

// A line continuation left dangling at the end of a command.
const TRAILING_CONTINUATION_REGEX: RegExp = /\\\s*$/;

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
  runner: false,
  credential: false,
};

const EVERYTHING_OFFERED: KubernetesAiAccessOfferedFields = {
  allowlist: true,
  runner: true,
  credential: true,
};

type SettingsFormValues = FormValues<{
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: string;
  kubectlAllowlistText: string;
  aiAccessRunnerId: string;
  aiAccessCredentialId: string;
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

function makeRunner(
  id: string,
  name: string,
  canRunAiCommands: boolean = true,
): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    canRunAiCommands,
  });
}

function optionValues(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return String(option.value);
  });
}

beforeEach(() => {
  grant([...BASE_PERMISSIONS, Permission.ProjectMember]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("one-command helm upgrade", () => {
  /*
   * The finding: the page printed `helm upgrade oneuptime-agent ...
   * --namespace oneuptime-kubernetes-agent`, while the Dashboard's own
   * install instructions install `kubernetes-agent` into `oneuptime-agent`.
   * helm answers a missing release with "has no deployed releases", so a
   * cluster installed the way the product said could not connect.
   */
  const installMarkdown: string = getKubernetesInstallationMarkdown({
    clusterName: "prod-east",
    oneuptimeUrl: "https://oneuptime.example.com",
    apiKey: "key",
  });

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

    const commands: AiAccessHelmCommands = getAiAccessHelmCommands();
    for (const command of [commands.readOnly, commands.enableRemediation]) {
      expect(command).toContain(
        `helm upgrade ${pairs[0]!.release} oneuptime/kubernetes-agent`,
      );
      expect(command).toContain(`--namespace ${pairs[0]!.namespace}`);
      expect(command).not.toContain("oneuptime-kubernetes-agent");
      expect(command).toContain("--reuse-values");
    }
  });

  test("updates the chart index first, so an old cached chart cannot refuse aiAccess", () => {
    const readOnly: string = getAiAccessHelmCommands().readOnly;
    expect(readOnly.startsWith("helm repo update\n")).toBe(true);
    expect(readOnly.indexOf("helm repo update")).toBeLessThan(
      readOnly.indexOf("helm upgrade"),
    );
  });

  test("the default command grants read-only access and is complete", () => {
    const readOnly: string = getAiAccessHelmCommands().readOnly;
    expect(readOnly).toContain("--set aiAccess.enabled=true");
    expect(readOnly).not.toContain("remediation");
    // No trailing line continuation: the shell would wait for more input.
    expect(TRAILING_CONTINUATION_REGEX.test(readOnly)).toBe(false);
  });

  test("the optional remediation command is a whole command, not a line to append", () => {
    const enableRemediation: string =
      getAiAccessHelmCommands().enableRemediation;
    expect(enableRemediation).toContain("--set aiAccess.enabled=true");
    expect(enableRemediation).toContain(
      "--set aiAccess.remediation.enabled=true",
    );
    expect(TRAILING_CONTINUATION_REGEX.test(enableRemediation)).toBe(false);

    // Every continued line is followed by a real one.
    const lines: Array<string> = enableRemediation.split("\n");
    lines.forEach((line: string, index: number) => {
      if (line.trimEnd().endsWith("\\")) {
        expect((lines[index + 1] || "").trim().length).toBeGreaterThan(0);
      }
    });
  });

  test("names no chart version (published charts carry the OneUptime version)", () => {
    const commands: AiAccessHelmCommands = getAiAccessHelmCommands();
    for (const command of [commands.readOnly, commands.enableRemediation]) {
      expect(command).not.toMatch(/--version/);
      expect(command).not.toMatch(/0\.7\.0/);
    }
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
      validateKubectlAllowlistText(
        `${SET_IMAGE_PATTERN}\nkubectl patch deployment/web -n web -p *`,
      ),
    ).toBeNull();
    // Broad but well-formed: accepted here, confirmed on save.
    expect(validateKubectlAllowlistText("*")).toBeNull();
    expect(validateKubectlAllowlistText("kubectl *")).toBeNull();
  });

  test("refuses a pattern that can never match because it does not start with kubectl", () => {
    expect(validateKubectlAllowlistText("set image deployment/web *")).toMatch(
      /Pattern 1 .*must start with "kubectl"/,
    );
    expect(
      validateKubectlAllowlistText(`${SET_IMAGE_PATTERN}\nhelm upgrade *`),
    ).toMatch(/Pattern 2/);
  });

  test("refuses a JSON array pasted from the old editor", () => {
    expect(
      validateKubectlAllowlistText(`["${SET_IMAGE_PATTERN}"]`),
    ).not.toBeNull();
  });

  test("refuses more patterns, or longer ones, than the policy reads", () => {
    const tooMany: string = Array.from(
      { length: MAX_KUBECTL_ALLOWLIST_PATTERNS + 1 },
      (_value: unknown, index: number): string => {
        return `kubectl rollout restart deployment/web-${index} -n web`;
      },
    ).join("\n");
    expect(validateKubectlAllowlistText(tooMany)).toMatch(/At most 100/);

    const exactlyMax: string = tooMany.split("\n").slice(1).join("\n");
    expect(validateKubectlAllowlistText(exactlyMax)).toBeNull();

    const tooLong: string = `kubectl ${"x".repeat(
      MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH,
    )}`;
    expect(validateKubectlAllowlistText(tooLong)).toMatch(/longer than 500/);
  });

  test("recognises patterns that match (nearly) every command", () => {
    for (const broad of [
      "*",
      "**",
      "kubectl *",
      "kubectl * *",
      "kubectl*",
      "  kubectl   *  ",
    ]) {
      expect(isBroadKubectlAllowlistPattern(broad)).toBe(true);
    }

    for (const narrow of [
      SET_IMAGE_PATTERN,
      "kubectl * -n web",
      "kubectl delete pod *",
      "kubectl rollout restart deployment/web -n web",
    ]) {
      expect(isBroadKubectlAllowlistPattern(narrow)).toBe(false);
    }
  });
});

describe("the stored allowlist", () => {
  test("is read the way the server normalizes it", () => {
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
      // Unusable: the policy uses these as an empty allowlist.
      {
        value: { patterns: [SET_IMAGE_PATTERN] },
        expected: { patterns: [], isClean: false },
      },
      { value: "kubectl *", expected: { patterns: [], isClean: false } },
      { value: 42, expected: { patterns: [], isClean: false } },
      {
        value: [1, "", SET_IMAGE_PATTERN],
        expected: { patterns: [SET_IMAGE_PATTERN], isClean: false },
      },
    ];

    for (const testCase of cases) {
      expect(normalizeSavedKubectlAllowlist(testCase.value)).toEqual(
        testCase.expected,
      );
    }
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

  test("seeds the form with the allowlist as lines", () => {
    expect(
      getKubernetesAiAccessSettingsInitialValues(
        makeSaved({
          aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, "kubectl *"],
        }),
      ).kubectlAllowlistText,
    ).toBe(`${SET_IMAGE_PATTERN}\nkubectl *`);
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
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, { isAiInvestigationEnabled: false }),
        offered: NOTHING_OFFERED,
      }),
    ).toEqual({ isAiInvestigationEnabled: false });

    // The same edit by an admin who was offered everything.
    expect(
      getKubernetesAiAccessSettingsChanges({
        saved,
        values: formValues(saved, { isAiInvestigationEnabled: false }),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({ isAiInvestigationEnabled: false });
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
          kubectlAllowlistText: `${SET_IMAGE_PATTERN}\nkubectl patch deployment/web -n web -p *`,
        }),
        offered: EVERYTHING_OFFERED,
      }),
    ).toEqual({
      aiKubectlCommandAllowlist: [
        SET_IMAGE_PATTERN,
        "kubectl patch deployment/web -n web -p *",
      ],
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
});

describe("loosening changes", () => {
  test("are the unattended modes, a non-empty allowlist and any binding", () => {
    expect(
      getKubernetesAiAccessLooseningChanges({
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    ).toHaveLength(1);
    expect(
      getKubernetesAiAccessLooseningChanges({
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      }),
    ).toHaveLength(1);
    expect(
      getKubernetesAiAccessLooseningChanges({
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
      }),
    ).toHaveLength(1);
    expect(
      getKubernetesAiAccessLooseningChanges({ aiAccessRunnerId: RUNNER_ID }),
    ).toHaveLength(1);
    expect(
      getKubernetesAiAccessLooseningChanges({
        aiAccessCredentialId: CREDENTIAL_ID,
      }),
    ).toHaveLength(1);
  });

  test("never include tightening", () => {
    const tightening: Array<JSONObject> = [
      { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
      { aiRemediationMode: KubernetesAiRemediationMode.RequireApproval },
      { aiKubectlCommandAllowlist: [] },
      { aiAccessRunnerId: null },
      { aiAccessCredentialId: null },
      { isAiInvestigationEnabled: true },
      { isAiInvestigationEnabled: false },
    ];
    for (const changes of tightening) {
      expect(getKubernetesAiAccessLooseningChanges(changes)).toEqual([]);
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
    // What still never runs unattended is said too.
    expect(text).toMatch(/never run/);
    expect(text).toContain("kube-system");
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

  test("is asked before a match-everything allowlist", () => {
    for (const broad of ["kubectl *", "*"]) {
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
    }
  });

  test("warns ahead when the broad allowlist is saved outside Automatic mode", () => {
    const confirmation: KubernetesAiAccessConfirmation | null =
      getKubernetesAiAccessConfirmation({
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
          aiKubectlCommandAllowlist: [],
        }),
        changes: { aiKubectlCommandAllowlist: ["kubectl *"] },
      });
    expectNamesWhatItUnlocks(confirmation);
    expect(confirmation!.description).toContain("Once this cluster is");
  });

  test("is asked when Automatic mode switches on over a saved broad allowlist", () => {
    expectNamesWhatItUnlocks(
      getKubernetesAiAccessConfirmation({
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
          aiKubectlCommandAllowlist: ["kubectl *"],
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
      {
        saved: makeSaved(),
        changes: {
          aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, "kubectl * -n web"],
        },
      },
      // An already-saved broad pattern is not re-confirmed on unrelated edits.
      {
        saved: makeSaved({ aiKubectlCommandAllowlist: ["kubectl *"] }),
        changes: { isAiInvestigationEnabled: false },
      },
      {
        saved: makeSaved({ aiKubectlCommandAllowlist: ["kubectl *"] }),
        changes: {
          aiKubectlCommandAllowlist: ["kubectl *", SET_IMAGE_PATTERN],
        },
      },
      // Leaving Bypass approval, or clearing the allowlist.
      {
        saved: makeSaved({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
        changes: {
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        },
      },
      {
        saved: makeSaved({ aiKubectlCommandAllowlist: ["kubectl *"] }),
        changes: { aiKubectlCommandAllowlist: [] },
      },
    ];

    for (const testCase of quiet) {
      expect(getKubernetesAiAccessConfirmation(testCase)).toBeNull();
    }
  });
});

describe("Runner picker options", () => {
  const runners: Array<Runner> = [
    makeRunner("r-this", "kubernetes-agent/prod-east"),
    makeRunner("r-other-cluster", "kubernetes-agent/prod-eu"),
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

  test("keep the bound Runner, saying why it cannot serve the cluster", () => {
    const boundToOther: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
      runners,
      clusterIdentifier: "prod-east",
      boundRunnerId: "r-other-cluster",
      boundRunnerName: "kubernetes-agent/prod-eu",
    });
    expect(optionValues(boundToOther)).toContain("r-other-cluster");
    expect(
      boundToOther.find((option: DropdownOption): boolean => {
        return option.value === "r-other-cluster";
      })!.label,
    ).toMatch(/currently bound — runs inside another cluster/);

    const boundToOff: Array<DropdownOption> = buildKubernetesAiRunnerOptions({
      runners,
      clusterIdentifier: "prod-east",
      boundRunnerId: "r-off",
      boundRunnerName: "ops-runner",
    });
    expect(
      boundToOff.find((option: DropdownOption): boolean => {
        return option.value === "r-off";
      })!.label,
    ).toMatch(/Runs AI Remediation Commands/);

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
});

describe("credential picker options", () => {
  const credentials: Array<RunbookCredential> = [
    Object.assign(new RunbookCredential(), {
      _id: "c-ssh",
      name: "ssh key",
      credentialType: RunbookCredentialType.SSH,
    }),
    Object.assign(new RunbookCredential(), {
      _id: "c-k8s",
      name: "prod-east token",
      credentialType: RunbookCredentialType.Kubernetes,
    }),
  ];

  test("offer Kubernetes credentials only", () => {
    expect(
      optionValues(
        buildKubernetesAiCredentialOptions({
          credentials,
          boundCredentialId: null,
          boundCredentialName: null,
        }),
      ),
    ).toEqual(["c-k8s"]);
  });

  test("keep the bound credential so the form can show it", () => {
    expect(
      optionValues(
        buildKubernetesAiCredentialOptions({
          credentials,
          boundCredentialId: "c-ssh",
          boundCredentialName: "ssh key",
        }),
      ),
    ).toEqual(["c-ssh", "c-k8s"]);

    expect(
      buildKubernetesAiCredentialOptions({
        credentials,
        boundCredentialId: "c-gone",
        boundCredentialName: null,
      })[0],
    ).toEqual({
      value: "c-gone",
      label: "The bound credential (currently bound)",
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
