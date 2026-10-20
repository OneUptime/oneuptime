import { describe, expect, test } from "@jest/globals";
import {
  applyStepConfigChange,
  convertLegacyCredentialStep,
  formatSshTarget,
  getFirstCommand,
  getStepMoreFieldsItems,
  isLegacyCredentialStep,
  isRunnerStep,
  parseSshTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookStepEditorModel";
import {
  KubernetesAction,
  KubernetesStepConfig,
  KubernetesWorkloadKind,
  RunbookStep,
  SSHStepConfig,
} from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  LEGACY_KUBERNETES_STEP_FIELDS,
  getKubectlScriptForLegacyKubernetesStep,
} from "../../../Types/Runbook/RunbookLegacySteps";
import {
  DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
} from "../../../Types/Runbook/RunbookStepTimeout";
import { FoldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";

/*
 * WHAT A RUNBOOK STEP'S EDITOR SHOWS AND FOLDS (RunbookStepEditorModel):
 * the rules behind the Steps page, without the page.
 *
 *   - an SSH step's machine is written as after `ssh`: user@host;
 *   - a step's More fields line names what its fold holds, and what of it
 *     is set - and a step written with a credential (through the API) folds
 *     no port and no passphrase, which its credential holds;
 *   - such a step is told apart, and turns into the script step that does
 *     what it did;
 *   - a kubectl step moved from a Kubernetes action loses the action it kept
 *     for older Runners once its script or kubeconfig is changed;
 *   - a folded step's line quotes a script's first command, past comments.
 */

function step(
  type: RunbookStepType,
  config: Record<string, unknown>,
  extra?: Partial<RunbookStep>,
): RunbookStep {
  return {
    id: "step-1",
    order: 0,
    type,
    title: "A step",
    config: config as never,
    ...(extra || {}),
  };
}

function keys(items: Array<FoldedSectionItem>): Array<string> {
  return items.map((item: FoldedSectionItem): string => {
    return item.key;
  });
}

function setKeys(items: Array<FoldedSectionItem>): Array<string> {
  return items
    .filter((item: FoldedSectionItem): boolean => {
      return item.isSet;
    })
    .map((item: FoldedSectionItem): string => {
      return item.key;
    });
}

const LEGACY_SSH: Record<string, unknown> = {
  credentialId: "90000000-0000-4000-8000-000000000c01",
  command: "redis-cli FLUSHALL",
  agentId: "40000000-0000-4000-8000-0000000000d1",
  timeoutInMs: 45000,
};

const LEGACY_KUBERNETES: Record<string, unknown> = {
  credentialId: "90000000-0000-4000-8000-000000000c01",
  action: KubernetesAction.ScaleWorkload,
  workloadKind: KubernetesWorkloadKind.Deployment,
  namespace: "jobs",
  workloadName: "workers",
  replicas: 4,
  agentId: "40000000-0000-4000-8000-0000000000d1",
  claimTimeoutInMs: 90000,
};

describe("the machine an SSH step signs in to", () => {
  test("is read from user@host, as written after ssh", () => {
    expect(parseSshTarget("deploy@10.0.4.21")).toEqual({
      username: "deploy",
      host: "10.0.4.21",
    });
    expect(parseSshTarget("  deploy @ db-1.internal  ")).toEqual({
      username: "deploy",
      host: "db-1.internal",
    });
  });

  test("without a user, the text is the host", () => {
    expect(parseSshTarget("10.0.4.21")).toEqual({
      username: "",
      host: "10.0.4.21",
    });
    expect(parseSshTarget("")).toEqual({ username: "", host: "" });
  });

  test("a user name may hold an @ of its own: the host is after the last one", () => {
    expect(parseSshTarget("ops@example.com@bastion")).toEqual({
      username: "ops@example.com",
      host: "bastion",
    });
  });

  test("a variable may stand for either half", () => {
    expect(
      parseSshTarget(
        "{{global.variables.DEPLOY_USER}}@{{global.variables.DB_HOST}}",
      ),
    ).toEqual({
      username: "{{global.variables.DEPLOY_USER}}",
      host: "{{global.variables.DB_HOST}}",
    });
  });

  test("is written back as user@host, or the host alone", () => {
    expect(formatSshTarget({ username: "deploy", host: "10.0.4.21" })).toBe(
      "deploy@10.0.4.21",
    );
    expect(formatSshTarget({ username: "", host: "10.0.4.21" })).toBe(
      "10.0.4.21",
    );
    expect(formatSshTarget({})).toBe("");

    // Round trip.
    expect(formatSshTarget(parseSshTarget("deploy@10.0.4.21"))).toBe(
      "deploy@10.0.4.21",
    );
  });
});

describe("a step's More fields", () => {
  test("an SSH step folds its port, its key passphrase, its notes, timeouts and switches", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(RunbookStepType.SSH, {
        host: "10.0.4.21",
        username: "deploy",
        signIn: "{{global.variables.PROD_DB_SSH_KEY}}",
        script: "uptime",
      }),
    );

    expect(keys(items)).toEqual([
      "port",
      "passphrase",
      "description",
      "timeouts",
      "continueOnFailure",
      "requireApproval",
    ]);
    expect(setKeys(items)).toEqual([]);
  });

  test("a port other than 22 and a passphrase are set, and the port says what it is", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(RunbookStepType.SSH, {
        host: "10.0.4.21",
        script: "uptime",
        port: 2222,
        passphrase: "{{global.variables.KEY_PASSPHRASE}}",
      }),
    );

    const port: FoldedSectionItem | undefined = items.find(
      (item: FoldedSectionItem): boolean => {
        return item.key === "port";
      },
    );

    expect(port).toMatchObject({ isSet: true, value: "2222" });
    expect(setKeys(items)).toEqual(["port", "passphrase"]);

    // Port 22 is the default: not set, and nothing to say.
    const atDefault: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(RunbookStepType.SSH, { host: "h", script: "uptime", port: 22 }),
    );
    expect(setKeys(atDefault)).toEqual([]);
  });

  test("a step written with a credential folds no port and no passphrase: its credential holds them", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(RunbookStepType.SSH, LEGACY_SSH),
    );

    expect(keys(items)).toEqual([
      "description",
      "timeouts",
      "continueOnFailure",
      "requireApproval",
    ]);
    // Its own timeout is still said to be set.
    expect(setKeys(items)).toEqual(["timeouts"]);
  });

  test("a kubectl step folds its notes, timeouts and switches; what is on is said", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(
        RunbookStepType.Kubernetes,
        {
          kubeconfig: "",
          script: "kubectl get pods",
          timeoutInMs: DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
          claimTimeoutInMs: DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
        },
        { requireApproval: true, description: "Needs a look first." },
      ),
    );

    expect(keys(items)).toEqual([
      "description",
      "timeouts",
      "continueOnFailure",
      "requireApproval",
    ]);
    // Timeouts at their defaults are not set; the switch on is, with "On".
    expect(setKeys(items)).toEqual(["description", "requireApproval"]);
    expect(
      items.find((item: FoldedSectionItem): boolean => {
        return item.key === "requireApproval";
      }),
    ).toMatchObject({ value: "On", translateValue: true });
  });

  test("an AI step folds its provider and the context it reads; a manual step folds nothing", () => {
    expect(
      keys(
        getStepMoreFieldsItems(
          step(RunbookStepType.AI, {
            prompt: "Summarize.",
            includePreviousStepContext: false,
            includeTriggerContext: true,
          }),
        ),
      ),
    ).toEqual([
      "llmProviderId",
      "includePreviousStepContext",
      "includeTriggerContext",
      "description",
      "continueOnFailure",
      "requireApproval",
    ]);
    expect(
      setKeys(
        getStepMoreFieldsItems(
          step(RunbookStepType.AI, {
            prompt: "Summarize.",
            includePreviousStepContext: false,
            includeTriggerContext: true,
          }),
        ),
      ),
    ).toEqual(["includePreviousStepContext"]);

    expect(
      getStepMoreFieldsItems(
        step(RunbookStepType.Manual, {}, { description: "Check it." }),
      ),
    ).toEqual([]);
  });
});

describe("a step written with a credential", () => {
  test("is told apart from a script step", () => {
    expect(isLegacyCredentialStep(step(RunbookStepType.SSH, LEGACY_SSH))).toBe(
      true,
    );
    expect(
      isLegacyCredentialStep(
        step(RunbookStepType.Kubernetes, LEGACY_KUBERNETES),
      ),
    ).toBe(true);
    expect(
      isLegacyCredentialStep(
        step(RunbookStepType.SSH, { host: "h", script: "uptime" }),
      ),
    ).toBe(false);
    // A credential with a script is a script step.
    expect(
      isLegacyCredentialStep(
        step(RunbookStepType.SSH, { ...LEGACY_SSH, script: "uptime" }),
      ),
    ).toBe(false);
    expect(
      isLegacyCredentialStep(
        step(RunbookStepType.Bash, { credentialId: "x", script: "" }),
      ),
    ).toBe(false);
  });

  test("an SSH step becomes a script step running its command, its Runner and timeouts kept", () => {
    const converted: RunbookStep = convertLegacyCredentialStep(
      step(RunbookStepType.SSH, LEGACY_SSH, { title: "Clear the cache" }),
    );
    const config: SSHStepConfig = converted.config as SSHStepConfig;

    expect(converted.title).toBe("Clear the cache");
    expect(config).toEqual({
      host: "",
      username: "",
      signIn: "",
      script: "redis-cli FLUSHALL",
      agentId: LEGACY_SSH["agentId"],
      timeoutInMs: 45000,
    });
    expect(isLegacyCredentialStep(converted)).toBe(false);
  });

  test("a Kubernetes step becomes the kubectl script that makes the same change", () => {
    const converted: RunbookStep = convertLegacyCredentialStep(
      step(RunbookStepType.Kubernetes, LEGACY_KUBERNETES),
    );
    const config: KubernetesStepConfig =
      converted.config as KubernetesStepConfig;

    expect(config.kubeconfig).toBe("");
    expect(config.script).toContain(
      `kubectl patch deployment workers --namespace jobs --subresource scale --patch '{"spec":{"replicas":4}}'`,
    );
    expect(config.agentId).toBe(LEGACY_KUBERNETES["agentId"]);
    expect(config.claimTimeoutInMs).toBe(90000);
    expect(config).not.toHaveProperty("credentialId");
    expect(config).not.toHaveProperty("action");
    expect(isLegacyCredentialStep(converted)).toBe(false);
  });

  test("any other step is left as it is", () => {
    const bash: RunbookStep = step(RunbookStepType.Bash, { script: "df -h" });

    expect(convertLegacyCredentialStep(bash)).toBe(bash);
  });
});

/*
 * A kubectl step the data migration moved from a Kubernetes action keeps
 * that action and its credential, for Runners older than kubectl scripts,
 * only while its script and kubeconfig are the ones it was moved with. The
 * editor drops them the moment either changes, as every save does on the
 * server (RunbookService); nothing else the editor changes touches them.
 */
describe("editing a kubectl step moved from a Kubernetes action", () => {
  const LEGACY: Record<string, unknown> = {
    credentialId: "90000000-0000-4000-8000-000000000c01",
    action: KubernetesAction.RestartWorkload,
    workloadKind: KubernetesWorkloadKind.Deployment,
    namespace: "web",
    workloadName: "api",
  };

  const MOVED: Record<string, unknown> = {
    kubeconfig: "{{global.variables.prod_cluster-kubeconfig}}",
    script: getKubectlScriptForLegacyKubernetesStep(LEGACY as never),
    agentId: "40000000-0000-4000-8000-0000000000d1",
    ...LEGACY,
  };

  function movedStep(): RunbookStep {
    return step(RunbookStepType.Kubernetes, { ...MOVED });
  }

  function legacyFieldsOf(changed: RunbookStep): Array<string> {
    return Object.keys(changed.config).filter((key: string): boolean => {
      return LEGACY_KUBERNETES_STEP_FIELDS.includes(key);
    });
  }

  test.each([
    ["its script", { script: "kubectl get pods --namespace web" }],
    [
      "a line of its script",
      { script: `${String(MOVED["script"])}echo done\n` },
    ],
    ["its script, emptied", { script: "" }],
    ["its kubeconfig", { kubeconfig: "{{global.variables.staging}}" }],
    ["its kubeconfig, to the Runner's own access", { kubeconfig: "" }],
  ])(
    "changing %s drops them, and keeps the change",
    (_label: string, patch: Record<string, unknown>) => {
      const changed: RunbookStep = applyStepConfigChange(movedStep(), patch);

      expect(legacyFieldsOf(changed)).toEqual([]);
      expect(changed.config).toEqual({
        kubeconfig: MOVED["kubeconfig"],
        script: MOVED["script"],
        agentId: MOVED["agentId"],
        ...patch,
      });
      // A script step still, never one written with a credential.
      expect(isLegacyCredentialStep(changed)).toBe(false);
    },
  );

  test.each([
    ["its Runner", { agentId: "40000000-0000-4000-8000-0000000000d2" }],
    ["its timeouts", { timeoutInMs: 120000, claimTimeoutInMs: 30000 }],
    ["its script, to the same text", { script: MOVED["script"] }],
    [
      "its kubeconfig, to the same variable",
      { kubeconfig: MOVED["kubeconfig"] },
    ],
  ])(
    "changing %s keeps them",
    (_label: string, patch: Record<string, unknown>) => {
      const changed: RunbookStep = applyStepConfigChange(movedStep(), patch);

      expect(changed.config).toEqual({ ...MOVED, ...patch });
    },
  );

  test("once dropped, they do not come back when the script is put back", () => {
    const edited: RunbookStep = applyStepConfigChange(movedStep(), {
      script: "kubectl get pods",
    });
    const putBack: RunbookStep = applyStepConfigChange(edited, {
      script: MOVED["script"],
    });

    expect(legacyFieldsOf(putBack)).toEqual([]);
  });

  test("the step itself is not changed: the editor's state is replaced, not edited", () => {
    const before: RunbookStep = movedStep();
    const changed: RunbookStep = applyStepConfigChange(before, {
      script: "kubectl get pods",
    });

    expect(changed).not.toBe(before);
    expect(before.config).toEqual(MOVED);
  });

  test("any other step is written over as it always was", () => {
    const bash: RunbookStep = step(RunbookStepType.Bash, {
      script: "df -h",
      credentialId: "x",
    });

    expect(applyStepConfigChange(bash, { script: "uptime" }).config).toEqual({
      script: "uptime",
      credentialId: "x",
    });

    // A kubectl step written as a script has nothing to drop.
    const kubectl: RunbookStep = step(RunbookStepType.Kubernetes, {
      kubeconfig: "",
      script: "kubectl get pods",
    });

    expect(
      applyStepConfigChange(kubectl, { kubeconfig: "{{global.variables.k}}" })
        .config,
    ).toEqual({
      kubeconfig: "{{global.variables.k}}",
      script: "kubectl get pods",
    });

    // One written with a credential (no script) is turned into a script step only by its button.
    const written: RunbookStep = step(
      RunbookStepType.Kubernetes,
      LEGACY_KUBERNETES,
    );

    expect(
      applyStepConfigChange(written, { timeoutInMs: 1000 }).config,
    ).toEqual({ ...LEGACY_KUBERNETES, timeoutInMs: 1000 });
  });
});

describe("the rest of the model", () => {
  test("the steps that run on a Runner", () => {
    expect(
      [
        RunbookStepType.JavaScript,
        RunbookStepType.Bash,
        RunbookStepType.SSH,
        RunbookStepType.Kubernetes,
        RunbookStepType.HttpRequest,
        RunbookStepType.AI,
        RunbookStepType.Manual,
      ].filter(isRunnerStep),
    ).toEqual([
      RunbookStepType.JavaScript,
      RunbookStepType.Bash,
      RunbookStepType.SSH,
      RunbookStepType.Kubernetes,
    ]);
  });

  test("a script's first command skips blank lines and comments, and is cut at 80 characters", () => {
    expect(getFirstCommand("\n# list them\n  kubectl get pods  \n")).toBe(
      "kubectl get pods",
    );
    expect(getFirstCommand("# only a comment")).toBe("");
    expect(getFirstCommand(undefined)).toBe("");

    const long: string = `kubectl get pods ${"--namespace checkout ".repeat(6)}`;
    const first: string = getFirstCommand(long);

    expect(first).toHaveLength(81);
    expect(first.endsWith("…")).toBe(true);
  });
});
