import { describe, expect, test } from "@jest/globals";
import {
  CONTINUE_ON_FAILURE_DESCRIPTION,
  HTTP_METHODS_WITH_BODY,
  MANUAL_INSTRUCTIONS_TITLE,
  NEEDS_APPROVAL_LABEL,
  REQUIRE_APPROVAL_DESCRIPTION,
  REQUIRE_APPROVAL_FOLDED_TITLE,
  REQUIRE_APPROVAL_TITLE,
  RUNNER_FIELD_TITLE,
  applyStepConfigChange,
  convertLegacyCredentialStep,
  formatSshTarget,
  getFirstCommand,
  getHttpHeaderCount,
  getStepMoreFieldsItems,
  isHttpBodyShown,
  isLegacyCredentialStep,
  isRunnerStep,
  parseSshTarget,
  readStepsForEditor,
  setStepRequiresApproval,
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
 *     is set - Require approval and Continue on failure first - and a step
 *     written with a credential (through the API) folds no port and no
 *     passphrase, which its credential holds;
 *   - the approval switch is on the step it holds back ("Require approval
 *     before running this step"), and a runbook a client saved with the old
 *     approval after a step shows it there;
 *   - an HTTP request shows its body only for a method that sends one, and
 *     folds its headers, counted, never quoted;
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

// What UUID.generate gives a step saved without an id.
const UUID_SHAPE: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  test("every automated step folds Require approval and Continue on failure first: the line names them before it runs out of room", () => {
    for (const type of [
      RunbookStepType.JavaScript,
      RunbookStepType.HttpRequest,
      RunbookStepType.Bash,
      RunbookStepType.SSH,
      RunbookStepType.Kubernetes,
      RunbookStepType.AI,
    ]) {
      expect({
        type,
        first: keys(getStepMoreFieldsItems(step(type, {}))).slice(0, 2),
      }).toEqual({
        type,
        first: ["requireApprovalBeforeRunning", "continueOnFailure"],
      });
    }
  });

  test("the folded line names the switch short - 'Require approval' - and says 'On' when it is on", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(
        RunbookStepType.Kubernetes,
        { kubeconfig: "", script: "kubectl get pods" },
        { requireApprovalBeforeRunning: true },
      ),
    );

    expect(items[0]).toEqual({
      key: "requireApprovalBeforeRunning",
      title: "Require approval",
      isSet: true,
      value: "On",
      translateValue: true,
    });
    expect(REQUIRE_APPROVAL_FOLDED_TITLE).toBe("Require approval");
  });

  test("the old flag alone is not shown as on: the editor reads it onto the next step first", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(
        RunbookStepType.Bash,
        { script: "uptime" },
        { requireApproval: true },
      ),
    );

    expect(items[0]).toMatchObject({
      key: "requireApprovalBeforeRunning",
      isSet: false,
    });
    expect(items[0]!.value).toBeUndefined();
  });

  test("an SSH step folds the switches, its port, its key passphrase, its host key, its notes and timeouts", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(RunbookStepType.SSH, {
        host: "10.0.4.21",
        username: "deploy",
        signIn: "{{global.variables.PROD_DB_SSH_KEY}}",
        script: "uptime",
      }),
    );

    expect(keys(items)).toEqual([
      "requireApprovalBeforeRunning",
      "continueOnFailure",
      "port",
      "passphrase",
      "hostKey",
      "description",
      "timeouts",
    ]);
    expect(setKeys(items)).toEqual([]);
  });

  test("a host key named is set, and folds as its title alone - never the key", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(RunbookStepType.SSH, {
        host: "10.0.4.21",
        script: "uptime",
        hostKey: "SHA256:gwsSZuUZNvG/8pOZ2G715I2GTVbDlhL4EKu6z7WLKNM",
      }),
    );

    const hostKey: FoldedSectionItem | undefined = items.find(
      (item: FoldedSectionItem): boolean => {
        return item.key === "hostKey";
      },
    );

    expect(hostKey).toEqual({ key: "hostKey", title: "Host key", isSet: true });
    expect(setKeys(items)).toEqual(["hostKey"]);
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
      "requireApprovalBeforeRunning",
      "continueOnFailure",
      "description",
      "timeouts",
    ]);
    // Its own timeout is still said to be set.
    expect(setKeys(items)).toEqual(["timeouts"]);
  });

  test("a kubectl step folds the switches, its notes and timeouts; what is on is said", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(
        RunbookStepType.Kubernetes,
        {
          kubeconfig: "",
          script: "kubectl get pods",
          timeoutInMs: DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
          claimTimeoutInMs: DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
        },
        {
          requireApprovalBeforeRunning: true,
          continueOnFailure: true,
          description: "Needs a look first.",
        },
      ),
    );

    expect(keys(items)).toEqual([
      "requireApprovalBeforeRunning",
      "continueOnFailure",
      "description",
      "timeouts",
    ]);
    // Timeouts at their defaults are not set; the switches on are, with "On".
    expect(setKeys(items)).toEqual([
      "requireApprovalBeforeRunning",
      "continueOnFailure",
      "description",
    ]);
    expect(
      items.find((item: FoldedSectionItem): boolean => {
        return item.key === "continueOnFailure";
      }),
    ).toMatchObject({ value: "On", translateValue: true });
  });

  test("an HTTP request folds its headers - how many, never their values - its notes and its timeout", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(RunbookStepType.HttpRequest, {
        method: "POST",
        url: "https://events.pagerduty.com/v2/enqueue",
        headersJson:
          '{ "Authorization": "Token token=s3cr3t", "X-Request-Id": "1" }',
        body: "{}",
      }),
    );

    expect(keys(items)).toEqual([
      "requireApprovalBeforeRunning",
      "continueOnFailure",
      "headersJson",
      "description",
      "timeouts",
    ]);

    const headers: FoldedSectionItem = items[2]!;
    expect(headers).toEqual({
      key: "headersJson",
      title: "Headers (JSON)",
      isSet: true,
      value: "2",
    });
    expect(JSON.stringify(items)).not.toContain("s3cr3t");

    // Headers that are not a JSON object are set, with nothing to count.
    const broken: FoldedSectionItem = getStepMoreFieldsItems(
      step(RunbookStepType.HttpRequest, { headersJson: "{ Authorization" }),
    )[2]!;
    expect(broken).toMatchObject({ key: "headersJson", isSet: true });
    expect(broken.value).toBeUndefined();

    // None: not set.
    expect(
      getStepMoreFieldsItems(
        step(RunbookStepType.HttpRequest, { headersJson: "  " }),
      )[2],
    ).toMatchObject({ key: "headersJson", isSet: false });
  });

  test("an AI step folds the switches, its provider and the context it reads; context off is said 'Off'", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(RunbookStepType.AI, {
        prompt: "Summarize.",
        includePreviousStepContext: false,
        includeTriggerContext: true,
      }),
    );

    expect(keys(items)).toEqual([
      "requireApprovalBeforeRunning",
      "continueOnFailure",
      "llmProviderId",
      "includePreviousStepContext",
      "includeTriggerContext",
      "description",
    ]);
    expect(setKeys(items)).toEqual(["includePreviousStepContext"]);
    expect(items[3]).toMatchObject({ value: "Off", translateValue: true });

    // An AI step written without the switches runs without the context: said.
    expect(
      setKeys(
        getStepMoreFieldsItems(step(RunbookStepType.AI, { prompt: "Hi." })),
      ),
    ).toEqual(["includePreviousStepContext", "includeTriggerContext"]);
  });

  test("a manual step folds nothing: its instructions are what the responder reads", () => {
    expect(
      getStepMoreFieldsItems(
        step(
          RunbookStepType.Manual,
          {},
          { description: "Check it.", requireApprovalBeforeRunning: true },
        ),
      ),
    ).toEqual([]);
  });
});

/*
 * The maintainer: "have this runner drop down, hidden in More". A step that
 * runs on a Runner folds it first, and its line names where the step runs
 * whatever it is - "More fields · Runner: Global Runner, Require approval,
 * ..." - so nobody opens the fold to learn it.
 */
describe("a step's Runner, folded under its More fields", () => {
  test("comes first, named with what it runs on, as a value set - whatever it is", () => {
    for (const type of [
      RunbookStepType.JavaScript,
      RunbookStepType.Bash,
      RunbookStepType.SSH,
      RunbookStepType.Kubernetes,
    ]) {
      const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
        step(type, {}),
        { runner: "Global Runner" },
      );

      expect({ type, first: items[0] }).toEqual({
        type,
        first: {
          key: "runner",
          title: "Runner",
          isSet: true,
          value: "Global Runner",
        },
      });
      expect(keys(items).slice(1, 3)).toEqual([
        "requireApprovalBeforeRunning",
        "continueOnFailure",
      ]);
    }

    expect(RUNNER_FIELD_TITLE).toBe("Runner");
  });

  test("the value is drawn as handed - a Runner's name is never looked up as a translation", () => {
    const runner: FoldedSectionItem = getStepMoreFieldsItems(
      step(RunbookStepType.Bash, {}),
      { runner: "office-runner · Disconnected" },
    )[0]!;

    expect(runner.value).toBe("office-runner · Disconnected");
    expect(runner.translateValue).toBeUndefined();
  });

  test("the four the line has room for are the Runner, the two switches and the next: nothing in force is hidden", () => {
    const items: Array<FoldedSectionItem> = getStepMoreFieldsItems(
      step(RunbookStepType.JavaScript, {}, { continueOnFailure: true }),
      { runner: "prod-eu-west-1" },
    );

    expect(setKeys(items)).toEqual(["runner", "continueOnFailure"]);
  });

  test("a step with no Runner to name, or a step that runs on none, folds no Runner", () => {
    expect(
      keys(getStepMoreFieldsItems(step(RunbookStepType.Bash, {}))),
    ).not.toContain("runner");
    expect(
      keys(
        getStepMoreFieldsItems(step(RunbookStepType.Bash, {}), {
          runner: "",
        }),
      ),
    ).not.toContain("runner");
    expect(
      getStepMoreFieldsItems(step(RunbookStepType.Manual, {}), {
        runner: "Global Runner",
      }),
    ).toEqual([]);
  });
});

describe("the approval switch", () => {
  test("says, in the maintainer's words, that it asks before running this step", () => {
    expect(REQUIRE_APPROVAL_TITLE).toBe(
      "Require approval before running this step",
    );
    expect(REQUIRE_APPROVAL_DESCRIPTION).toBe(
      "The run stops before this step until someone approves it.",
    );
    expect(NEEDS_APPROVAL_LABEL).toBe("Needs approval");
    expect(CONTINUE_ON_FAILURE_DESCRIPTION).toBe(
      "If this step fails, the run goes on instead of stopping.",
    );
    expect(MANUAL_INSTRUCTIONS_TITLE).toBe("Instructions");
  });

  test("turns a step's approval on and off, and changes nothing else", () => {
    const original: RunbookStep = step(
      RunbookStepType.Bash,
      { script: "uptime", agentId: "x" },
      { continueOnFailure: true, description: "notes" },
    );

    const on: RunbookStep = setStepRequiresApproval(original, true);
    expect(on).toEqual({ ...original, requireApprovalBeforeRunning: true });
    expect(on).not.toBe(original);
    expect(original.requireApprovalBeforeRunning).toBeUndefined();

    expect(setStepRequiresApproval(on, false)).toEqual({
      ...original,
      requireApprovalBeforeRunning: false,
    });
  });

  test("a Manual step has no approval switch: it stops the run for a person already", () => {
    const manual: RunbookStep = step(RunbookStepType.Manual, {});

    expect(setStepRequiresApproval(manual, true)).toBe(manual);
  });
});

describe("an HTTP request step's body", () => {
  test("shows for a method that sends one, and never for GET or HEAD unless the step has one", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect({ method, shown: isHttpBodyShown({ url: "x", method }) }).toEqual({
        method,
        shown: true,
      });
    }

    for (const method of ["GET", "HEAD"] as const) {
      expect({ method, shown: isHttpBodyShown({ url: "x", method }) }).toEqual({
        method,
        shown: false,
      });
      // A body it has is sent, so it shows: nothing the step does is hidden.
      expect(
        isHttpBodyShown({ url: "x", method, body: '{ "ping": true }' }),
      ).toBe(true);
    }

    // A step written without a method sends GET.
    expect(isHttpBodyShown({ url: "x" } as never)).toBe(false);
    expect(HTTP_METHODS_WITH_BODY).toEqual(["POST", "PUT", "PATCH", "DELETE"]);
  });

  test("its headers are counted from the JSON object they are, and nothing else", () => {
    expect(getHttpHeaderCount('{ "A": "1" }')).toBe(1);
    expect(getHttpHeaderCount('{ "A": "1", "B": "2", "C": "3" }')).toBe(3);
    expect(getHttpHeaderCount("{}")).toBeUndefined();
    expect(getHttpHeaderCount("[1, 2]")).toBeUndefined();
    expect(getHttpHeaderCount('"text"')).toBeUndefined();
    expect(getHttpHeaderCount("null")).toBeUndefined();
    expect(getHttpHeaderCount("{ broken")).toBeUndefined();
    expect(getHttpHeaderCount("")).toBeUndefined();
    expect(getHttpHeaderCount(undefined)).toBeUndefined();
  });
});

describe("the steps the editor holds", () => {
  test("are in the order they run, numbered from 0, each with an id", () => {
    const steps: Array<RunbookStep> = readStepsForEditor([
      { ...step(RunbookStepType.Bash, {}), id: "b", order: 7 },
      { ...step(RunbookStepType.Manual, {}), id: "", order: 3 },
      { ...step(RunbookStepType.HttpRequest, {}), id: "c", order: 9 },
    ]);

    expect(
      steps.map((each: RunbookStep) => {
        return [each.type, each.order];
      }),
    ).toEqual([
      [RunbookStepType.Manual, 0],
      [RunbookStepType.Bash, 1],
      [RunbookStepType.HttpRequest, 2],
    ]);
    // A step saved without an id is given one.
    expect(steps[0]!.id).toMatch(UUID_SHAPE);
    expect(steps[1]!.id).toBe("b");
  });

  test("a runbook a client saved with the old approval after a step shows it on the step it held back", () => {
    const steps: Array<RunbookStep> = readStepsForEditor([
      {
        ...step(RunbookStepType.SSH, { script: "uptime" }),
        id: "stop",
        order: 0,
        requireApproval: true,
      },
      {
        ...step(RunbookStepType.Kubernetes, { script: "kubectl get pods" }),
        id: "promote",
        order: 1,
      },
      {
        ...step(RunbookStepType.AI, { prompt: "Summarize." }),
        id: "summary",
        order: 2,
        requireApproval: true,
      },
    ]);

    expect(
      steps.map((each: RunbookStep) => {
        return [each.id, each.type, each.requireApprovalBeforeRunning === true];
      }),
    ).toEqual([
      ["stop", RunbookStepType.SSH, false],
      ["promote", RunbookStepType.Kubernetes, true],
      ["summary", RunbookStepType.AI, false],
      ["summary-approval", RunbookStepType.Manual, false],
    ]);
    // What the editor saves never says it the old way.
    expect(JSON.stringify(steps)).not.toContain('"requireApproval"');
  });

  test("no steps, or what is not a list of steps, is no steps", () => {
    expect(readStepsForEditor(undefined)).toEqual([]);
    expect(readStepsForEditor(null)).toEqual([]);
    expect(readStepsForEditor({})).toEqual([]);
  });

  test("moving a step moves its approval with it: the approval is the step's own", () => {
    const steps: Array<RunbookStep> = readStepsForEditor([
      {
        ...step(RunbookStepType.Bash, {}),
        id: "a",
        order: 0,
      },
      {
        ...step(RunbookStepType.Kubernetes, {}),
        id: "b",
        order: 1,
        requireApprovalBeforeRunning: true,
      },
    ]);

    // The person drags b above a.
    const moved: Array<RunbookStep> = readStepsForEditor([
      { ...steps[1]!, order: 0 },
      { ...steps[0]!, order: 1 },
    ]);

    expect(
      moved.map((each: RunbookStep) => {
        return [each.id, each.requireApprovalBeforeRunning === true];
      }),
    ).toEqual([
      ["b", true],
      ["a", false],
    ]);
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
