import {
  AIStepConfig,
  HttpRequestMethod,
  HttpRequestStepConfig,
  KubernetesStepConfig,
  RunbookStep,
  SSHStepConfig,
  isLegacyKubernetesStepConfig,
  isLegacySSHStepConfig,
} from "Common/Types/Runbook/RunbookStep";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  canStepTypeRequireApproval,
  moveApprovalsBeforeTheirSteps,
  stepRequiresApprovalBeforeRunning,
} from "Common/Types/Runbook/RunbookStepApproval";
import UUID from "Common/Utils/UUID";
import {
  getKubectlScriptForLegacyKubernetesStep,
  isMovedKubernetesStepConfig,
  withoutLegacyKubernetesFields,
} from "Common/Types/Runbook/RunbookLegacySteps";
import {
  DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
} from "Common/Types/Runbook/RunbookStepTimeout";
import {
  FOLDED_SECTION_OFF,
  FOLDED_SECTION_ON,
  FoldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A RUNBOOK STEP'S EDITOR SHOWS, AND WHAT IT FOLDS AWAY.
 *
 * The maintainer, on the step editor: "make runbook steps easy to understand
 * and use, specially kubectl and ssh steps have too many options. Kubectl
 * steps should take in a script like kubectl commands and not have dropdown
 * options ... Please do the same for SSH as well, it should take a bash
 * script (after ssh into a machine) ... hide advanced options." And then:
 * "Can we please make all the runbook step options simpler, and use the
 * 'More' thing we have on other forms to hide advanced options."
 *
 * So a step shows what most steps need, and folds the rest under More
 * fields (one quiet line that names what is inside, and what of it is set):
 *
 *   - Manual: its title and the instructions the responder reads, nothing
 *     folded;
 *   - JavaScript and Bash: the script;
 *   - HTTP request: the method, the URL and - for a method that sends one -
 *     the body; its headers folded;
 *   - SSH: the machine (user@host), the secret it signs in with, and the
 *     bash script - its port and key passphrase folded;
 *   - kubectl: the cluster's kubeconfig and the script;
 *   - AI: the prompt - its provider and the context it reads folded;
 *   - every step that runs on a Runner folds its Runner first, named on
 *     the folded line whatever it is ("Runner: Global Runner") - the
 *     maintainer: "have this runner drop down, hidden in More, and by
 *     default select the global runner unless I have custom runner set to
 *     default runner for the project";
 *   - every automated step folds Require approval before running this step
 *     and Continue on failure, then its notes and its timeouts.
 *
 * A step that asks for approval says so on its header too ("Needs
 * approval"), so the list reads where the run stops for a person: the
 * switch is on the step it holds back (RunbookStepApproval), and moving
 * the step moves its approval with it.
 *
 * React-free on purpose: App's tests read these without the page.
 */

// ----------------------------------------------------------- SSH machine

export interface SshTarget {
  username: string;
  host: string;
}

/*
 * The machine an SSH step signs in to, read from how people write it after
 * `ssh`: "deploy@10.0.4.21". The user is what comes before the last "@" (a
 * user name may hold an "@" of its own; a host never does); without one,
 * the text is the host.
 */
export function parseSshTarget(text: string): SshTarget {
  const trimmed: string = (text || "").trim();
  const at: number = trimmed.lastIndexOf("@");

  if (at === -1) {
    return { username: "", host: trimmed };
  }

  return {
    username: trimmed.slice(0, at).trim(),
    host: trimmed.slice(at + 1).trim(),
  };
}

// user@host, or the host alone while there is no user.
export function formatSshTarget(target: {
  username?: string | undefined;
  host?: string | undefined;
}): string {
  const username: string = (target.username || "").trim();
  const host: string = (target.host || "").trim();

  if (!username) {
    return host;
  }

  return `${username}@${host}`;
}

export const SSH_TARGET_TITLE: string = translationKey("SSH to");

export const SSH_TARGET_PLACEHOLDER: string = "deploy@10.0.4.21";

export const SSH_TARGET_HELP: string = translationKey(
  "The user and the machine to sign in to, as you would write them after ssh.",
);

export const SSH_TARGET_NEEDS_USER: string = translationKey(
  "Add the user to sign in as, before an @: deploy@10.0.4.21.",
);

export const SSH_SIGN_IN_TITLE: string = translationKey("Sign in with");

export const SSH_PASSPHRASE_TITLE: string = translationKey("Key passphrase");

export const SSH_PORT_TITLE: string = translationKey("Port");

/*
 * The machine's host keys (SSHStepConfig.hostKey), under More fields: the
 * Runner signs in only when the machine presents one of them. Read line by
 * line as Types/Runbook/SshHostKey reads them.
 */
export const SSH_HOST_KEY_TITLE: string = translationKey("Host key");

export const SSH_HOST_KEY_HELP: string = translationKey(
  "The step signs in only when the machine presents one of these keys: its SHA256 fingerprint, or its public key as ssh-keyscan prints it, one per line. Left empty, any key is accepted, and the step's output shows the one the machine presented.",
);

// Under the field, while a line is not a key: the server refuses the step.
export const SSH_HOST_KEY_INVALID: string = translationKey(
  "A line here is neither a SHA256 fingerprint nor a public key, so the step will fail when it runs.",
);

export const SSH_HOST_KEY_TOO_LONG: string = translationKey(
  "This names more keys than a machine has, so the step will fail when it runs. A machine has one key of each type: name those.",
);

export const SSH_HOST_KEY_PLACEHOLDER: string =
  "SHA256:gwsSZuUZNvG/8pOZ2G715I2GTVbDlhL4EKu6z7WLKNM";

export const KUBECONFIG_TITLE: string = translationKey("Kubeconfig");

// The kubeconfig picker's first choice: none, so the Runner's own access.
export const RUNNER_OWN_KUBECONFIG_LABEL: string = translationKey(
  "The Runner's own access",
);

// The key passphrase picker's first choice: a key with no passphrase.
export const NO_PASSPHRASE_LABEL: string = translationKey("No passphrase");

// ------------------------------------------------------------- examples

export interface ScriptExample {
  // English, looked up when drawn.
  label: string;
  description: string;
  code: string;
}

/*
 * What an SSH step runs: bash on the machine, as the user it signs in as.
 * The first is what a new step starts with.
 */
export const SSH_EXAMPLES: Array<ScriptExample> = [
  {
    label: translationKey("Check the machine"),
    description: translationKey(
      "Its name, how long it has been up and its load.",
    ),
    code: `hostname
uptime`,
  },
  {
    label: translationKey("Restart a service"),
    description: translationKey(
      "Restart a systemd service, then show its status.",
    ),
    code: `sudo systemctl restart nginx
systemctl status nginx --no-pager`,
  },
  {
    label: translationKey("Check disk space"),
    description: translationKey("How full each disk is."),
    code: `df -h`,
  },
  {
    label: translationKey("Tail a log"),
    description: translationKey("Show the last lines of a log file."),
    code: `tail -n 100 /var/log/syslog`,
  },
];

/*
 * What a kubectl step runs: bash on the Runner, with KUBECONFIG pointing at
 * the cluster. The first is what a new step starts with: it changes
 * nothing.
 */
export const KUBECTL_EXAMPLES: Array<ScriptExample> = [
  {
    label: translationKey("List pods"),
    description: translationKey("Every pod in the cluster, with its status."),
    code: `kubectl get pods --all-namespaces`,
  },
  {
    label: translationKey("Restart a deployment"),
    description: translationKey(
      "Restart it, then wait until its new pods are ready.",
    ),
    code: `kubectl rollout restart deployment/checkout-api --namespace checkout
kubectl rollout status deployment/checkout-api --namespace checkout --timeout=120s`,
  },
  {
    label: translationKey("Scale a deployment"),
    description: translationKey("Set how many replicas it runs."),
    code: `kubectl scale deployment/checkout-api --replicas=3 --namespace checkout`,
  },
  {
    label: translationKey("Pods that are not running"),
    description: translationKey(
      "List them, and fail the step when there are any.",
    ),
    code: `pods=$(kubectl get pods --all-namespaces --field-selector=status.phase!=Running,status.phase!=Succeeded --no-headers)
echo "$pods"
test -z "$pods"`,
  },
  {
    label: translationKey("Roll back"),
    description: translationKey(
      "Go back to the deployment's previous version.",
    ),
    code: `kubectl rollout undo deployment/checkout-api --namespace checkout`,
  },
];

// -------------------------------------------------------- More fields

// The step's Runner, as its folded line names it ("Runner: Global Runner").
export const RUNNER_FIELD_TITLE: string = translationKey("Runner");

export const MORE_FIELDS_DESCRIPTION_TITLE: string =
  translationKey("Description");
export const MORE_FIELDS_TIMEOUTS_TITLE: string = translationKey("Timeouts");
export const CONTINUE_ON_FAILURE_TITLE: string = translationKey(
  "Continue on failure",
);
export const CONTINUE_ON_FAILURE_DESCRIPTION: string = translationKey(
  "If this step fails, the run goes on instead of stopping.",
);
/*
 * The switch on the step it holds back, in the maintainer's words: "require
 * approval before running this step".
 */
export const REQUIRE_APPROVAL_TITLE: string = translationKey(
  "Require approval before running this step",
);
export const REQUIRE_APPROVAL_DESCRIPTION: string = translationKey(
  "The run stops before this step until someone approves it.",
);
// The switch as the folded line names it: "More fields · Require approval: On".
export const REQUIRE_APPROVAL_FOLDED_TITLE: string =
  translationKey("Require approval");
// On the header of a step that asks for approval, as a playbook step says it.
export const NEEDS_APPROVAL_LABEL: string = translationKey("Needs approval");
/*
 * On the header of a step written with a runbook credential, open or
 * folded: runbook credentials were removed, so it no longer runs
 * (isLegacyCredentialStep). Without it a folded runbook read as if every
 * step still ran.
 */
export const NO_LONGER_RUNS_LABEL: string = translationKey("No longer runs");
export const LLM_PROVIDER_TITLE: string = translationKey("LLM provider");
export const INCLUDE_PREVIOUS_STEP_CONTEXT_TITLE: string = translationKey(
  "Include previous step context",
);
export const INCLUDE_TRIGGER_CONTEXT_TITLE: string = translationKey(
  "Include trigger context",
);
export const HTTP_HEADERS_TITLE: string = translationKey("Headers (JSON)");
// A Manual step's description is what the responder reads and does.
export const MANUAL_INSTRUCTIONS_TITLE: string = translationKey("Instructions");

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isSetTimeout(value: unknown, defaultValue: number): boolean {
  return typeof value === "number" && value !== defaultValue;
}

export interface StepMoreFieldsOptions {
  /*
   * Where a step that runs on a Runner runs, as the folded line names it -
   * already in the reader's words: "Global Runner", a Runner's own name
   * ("prod-eu-west-1", with "· Disconnected" when it is not connected), or
   * "None" while the step cannot run as it is. Left out for a step that
   * runs on no Runner, or folds no Runner field.
   */
  runner?: string | undefined;
}

/*
 * What a step's More fields fold holds, in order, and which of it is set -
 * so the folded line says "More fields · Runner: Global Runner, Require
 * approval: On, Port: 2222" and nothing in force is hidden. A step that
 * runs on a Runner names it first, always with what it is: where the step
 * runs is what a reader most needs from the fold. The two switches every
 * automated step has come next: they change how the run goes, and the line
 * names them before it runs out of room. Empty for a Manual step, which
 * folds nothing: its instructions are what the responder reads, and it
 * stops the run for a person already.
 */
export function getStepMoreFieldsItems(
  step: RunbookStep,
  options: StepMoreFieldsOptions = {},
): Array<FoldedSectionItem> {
  if (step.type === RunbookStepType.Manual) {
    return [];
  }

  const config: Record<string, unknown> = (step.config || {}) as Record<
    string,
    unknown
  >;

  const items: Array<FoldedSectionItem> = [];

  /*
   * Named with what it is whatever it is - the default included - so it
   * reads as set: the one item the line always says the value of.
   */
  if (options.runner) {
    items.push({
      key: "runner",
      title: RUNNER_FIELD_TITLE,
      isSet: true,
      value: options.runner,
    });
  }

  const requiresApproval: boolean = stepRequiresApprovalBeforeRunning(step);

  items.push({
    key: "requireApprovalBeforeRunning",
    title: REQUIRE_APPROVAL_FOLDED_TITLE,
    isSet: requiresApproval,
    ...(requiresApproval
      ? { value: FOLDED_SECTION_ON, translateValue: true }
      : {}),
  });
  items.push({
    key: "continueOnFailure",
    title: CONTINUE_ON_FAILURE_TITLE,
    isSet: step.continueOnFailure === true,
    ...(step.continueOnFailure === true
      ? { value: FOLDED_SECTION_ON, translateValue: true }
      : {}),
  });

  // An HTTP request's headers: how many it sends, never their values.
  if (step.type === RunbookStepType.HttpRequest) {
    const headerCount: number | undefined = getHttpHeaderCount(
      (step.config as HttpRequestStepConfig).headersJson,
    );

    items.push({
      key: "headersJson",
      title: HTTP_HEADERS_TITLE,
      isSet: hasText((step.config as HttpRequestStepConfig).headersJson),
      ...(headerCount ? { value: String(headerCount) } : {}),
    });
  }

  /*
   * A step written with a credential folds no port and no passphrase: its
   * credential holds them (the editor shows such a step as it is, and its
   * fold only its switches, notes and timeouts).
   */
  if (step.type === RunbookStepType.SSH && !isLegacyCredentialStep(step)) {
    const ssh: SSHStepConfig = step.config as SSHStepConfig;
    const port: number | undefined =
      typeof ssh.port === "number" ? ssh.port : undefined;

    items.push({
      key: "port",
      title: SSH_PORT_TITLE,
      isSet: port !== undefined && port !== 22,
      ...(port !== undefined && port !== 22 ? { value: String(port) } : {}),
    });
    items.push({
      key: "passphrase",
      title: SSH_PASSPHRASE_TITLE,
      isSet: hasText(ssh.passphrase),
    });
    items.push({
      key: "hostKey",
      title: SSH_HOST_KEY_TITLE,
      isSet: hasText(ssh.hostKey),
    });
  }

  if (step.type === RunbookStepType.AI) {
    const ai: AIStepConfig = step.config as AIStepConfig;

    items.push({
      key: "llmProviderId",
      title: LLM_PROVIDER_TITLE,
      isSet: hasText(ai.llmProviderId),
    });
    /*
     * On for every new AI step: said, "Off", when it is not - an AI step
     * written without the switch runs without that context too.
     */
    items.push({
      key: "includePreviousStepContext",
      title: INCLUDE_PREVIOUS_STEP_CONTEXT_TITLE,
      isSet: ai.includePreviousStepContext !== true,
      ...(ai.includePreviousStepContext !== true
        ? { value: FOLDED_SECTION_OFF, translateValue: true }
        : {}),
    });
    items.push({
      key: "includeTriggerContext",
      title: INCLUDE_TRIGGER_CONTEXT_TITLE,
      isSet: ai.includeTriggerContext !== true,
      ...(ai.includeTriggerContext !== true
        ? { value: FOLDED_SECTION_OFF, translateValue: true }
        : {}),
    });
  }

  items.push({
    key: "description",
    title: MORE_FIELDS_DESCRIPTION_TITLE,
    isSet: hasText(step.description),
  });

  if (
    step.type === RunbookStepType.JavaScript ||
    step.type === RunbookStepType.Bash ||
    step.type === RunbookStepType.SSH ||
    step.type === RunbookStepType.Kubernetes ||
    step.type === RunbookStepType.HttpRequest
  ) {
    items.push({
      key: "timeouts",
      title: MORE_FIELDS_TIMEOUTS_TITLE,
      isSet:
        isSetTimeout(
          config["timeoutInMs"],
          DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
        ) ||
        isSetTimeout(
          config["claimTimeoutInMs"],
          DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
        ),
    });
  }

  return items;
}

// ------------------------------------------------------- HTTP request

// The methods whose request carries a body; GET and HEAD send none.
export const HTTP_METHODS_WITH_BODY: Array<HttpRequestMethod> = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

/*
 * Whether an HTTP request step shows its Body: for a method that sends one,
 * and for any step that has one already - a GET with a body sends it, so
 * the editor never hides what the step does.
 */
export function isHttpBodyShown(config: HttpRequestStepConfig): boolean {
  return (
    HTTP_METHODS_WITH_BODY.includes(config.method || "GET") ||
    hasText(config.body)
  );
}

/*
 * How many headers a step's headers JSON names, for the folded line
 * ("Headers (JSON): 2"); undefined when it is empty or not a JSON object,
 * which the step says when it runs.
 */
export function getHttpHeaderCount(
  headersJson: string | undefined,
): number | undefined {
  if (!hasText(headersJson)) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(headersJson!);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const count: number = Object.keys(parsed as Record<string, unknown>).length;

    return count > 0 ? count : undefined;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------ the step list

/*
 * A runbook's stored steps as the editor holds them: every approval before
 * the step it holds back - a runbook an API client wrote with the old
 * approval after a step reads the way it runs (RunbookStepApproval) - in
 * the order they run, numbered from 0, each with an id.
 */
export function readStepsForEditor(steps: unknown): Array<RunbookStep> {
  return moveApprovalsBeforeTheirSteps(steps)
    .map((step: RunbookStep, index: number) => {
      return { step, index };
    })
    .sort(
      (
        a: { step: RunbookStep; index: number },
        b: { step: RunbookStep; index: number },
      ): number => {
        return (
          (Number(a.step.order) || 0) - (Number(b.step.order) || 0) ||
          a.index - b.index
        );
      },
    )
    .map((entry: { step: RunbookStep; index: number }, order: number) => {
      return {
        ...entry.step,
        id: entry.step.id || UUID.generate(),
        order,
      };
    });
}

/*
 * A step turned on or off for approval. Only an automated step asks for
 * approval: a Manual step stops the run for a person already.
 */
export function setStepRequiresApproval(
  step: RunbookStep,
  requiresApproval: boolean,
): RunbookStep {
  if (!canStepTypeRequireApproval(step.type)) {
    return step;
  }

  return { ...step, requireApprovalBeforeRunning: requiresApproval };
}

// ----------------------------------------------------- legacy steps

/*
 * Whether a step was written before runbook variables - an SSH or
 * Kubernetes step that names a runbook credential (the data migrations
 * rewrote every stored one). Runbook credentials were removed, so such a
 * step no longer runs: the editor shows it as it is, with a button that
 * turns it into a script step.
 */
/*
 * What such a step's body says above its one button: the fact first, then
 * what turning it into a script step leaves to its author - an SSH step's
 * machine and the secret it signs in with (its credential held them), a
 * Kubernetes step's kubeconfig.
 */
export const LEGACY_SSH_STEP_NOTICE: string = translationKey(
  "Runbook credentials were removed, so this step no longer runs. Turn it into a script step, then fill in the machine and the secret variable it signs in with.",
);
export const LEGACY_KUBERNETES_STEP_NOTICE: string = translationKey(
  "Runbook credentials were removed, so this step no longer runs. Turn it into a kubectl script that does the same, then pick its kubeconfig.",
);

export function isLegacyCredentialStep(step: RunbookStep): boolean {
  if (step.type === RunbookStepType.SSH) {
    return isLegacySSHStepConfig(step.config);
  }

  if (step.type === RunbookStepType.Kubernetes) {
    return isLegacyKubernetesStepConfig(step.config);
  }

  return false;
}

/*
 * A legacy step turned into the script step that does what it did: an SSH
 * step's command becomes its script, a Kubernetes step's action the
 * kubectl command that makes the same change. The secret it signs in with
 * is left for the author to pick: the credential's is not a variable.
 */
export function convertLegacyCredentialStep(step: RunbookStep): RunbookStep {
  if (step.type === RunbookStepType.SSH) {
    const legacy: SSHStepConfig = step.config as SSHStepConfig;

    const next: SSHStepConfig = {
      host: "",
      username: "",
      signIn: "",
      script: legacy.command || "",
      agentId: legacy.agentId || "",
      ...(legacy.timeoutInMs !== undefined
        ? { timeoutInMs: legacy.timeoutInMs }
        : {}),
      ...(legacy.claimTimeoutInMs !== undefined
        ? { claimTimeoutInMs: legacy.claimTimeoutInMs }
        : {}),
    };

    return { ...step, config: next };
  }

  if (step.type === RunbookStepType.Kubernetes) {
    const legacy: KubernetesStepConfig = step.config as KubernetesStepConfig;

    const next: KubernetesStepConfig = {
      kubeconfig: "",
      script: getKubectlScriptForLegacyKubernetesStep(legacy),
      agentId: legacy.agentId || "",
      ...(legacy.timeoutInMs !== undefined
        ? { timeoutInMs: legacy.timeoutInMs }
        : {}),
      ...(legacy.claimTimeoutInMs !== undefined
        ? { claimTimeoutInMs: legacy.claimTimeoutInMs }
        : {}),
    };

    return { ...step, config: next };
  }

  return step;
}

// ------------------------------------------------- editing a step

// Whether `field` of a step's config is another text after a change.
function isChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  field: string,
): boolean {
  const text: (value: unknown) => string = (value: unknown): string => {
    return typeof value === "string" ? value : "";
  };

  return text(before[field]) !== text(after[field]);
}

/*
 * A step with `patch` written over its config, as the editor changes it.
 *
 * A kubectl step the 14.0.79 data migration moved from a Kubernetes action
 * kept that action and its credential beside its script, for Runners older
 * than kubectl scripts. Runbook credentials are gone, so nothing reads them
 * now, and the data migration that removed the credentials dropped them
 * (RemoveRunbookCredentials). A step opened before that migration ran may
 * still hold them: a change to its script or kubeconfig drops them here,
 * so the save names no runbook credential. Its Runner, timeouts and notes
 * change nothing it does.
 */
export function applyStepConfigChange(
  step: RunbookStep,
  patch: Record<string, unknown>,
): RunbookStep {
  const current: Record<string, unknown> = (step.config || {}) as Record<
    string,
    unknown
  >;
  const next: Record<string, unknown> = { ...current, ...patch };

  if (
    step.type === RunbookStepType.Kubernetes &&
    isMovedKubernetesStepConfig(current) &&
    (isChanged(current, next, "script") ||
      isChanged(current, next, "kubeconfig"))
  ) {
    return {
      ...step,
      config: withoutLegacyKubernetesFields(next) as never,
    };
  }

  return { ...step, config: next as never };
}

// ------------------------------------------------------------ misc

// The step types that run on a Runner, whose fold holds two timeouts.
export function isRunnerStep(type: RunbookStepType): boolean {
  return (
    type === RunbookStepType.JavaScript ||
    type === RunbookStepType.Bash ||
    type === RunbookStepType.SSH ||
    type === RunbookStepType.Kubernetes
  );
}

// The first command of a script, for a folded step's line: comments skipped.
export function getFirstCommand(script: string | undefined): string {
  for (const rawLine of (script || "").split("\n")) {
    const line: string = rawLine.trim();

    if (line && !line.startsWith("#")) {
      return line.length > 80 ? `${line.slice(0, 80)}…` : line;
    }
  }

  return "";
}
