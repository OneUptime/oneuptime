import {
  AIStepConfig,
  KubernetesStepConfig,
  RunbookStep,
  SSHStepConfig,
  isLegacyKubernetesStepConfig,
  isLegacySSHStepConfig,
} from "Common/Types/Runbook/RunbookStep";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { getKubectlScriptForLegacyKubernetesStep } from "Common/Types/Runbook/RunbookLegacySteps";
import {
  DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
} from "Common/Types/Runbook/RunbookStepTimeout";
import {
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
 * script (after ssh into a machine) ... hide advanced options."
 *
 * So a step shows what most steps need, and folds the rest under More
 * fields (one quiet line that names what is inside, and what of it is set):
 *
 *   - SSH: the Runner, the machine (user@host), the secret it signs in
 *     with, and the bash script - its port and key passphrase folded;
 *   - kubectl: the Runner, the cluster's kubeconfig and the script;
 *   - every automated step folds its notes, its timeouts, Continue on
 *     failure and Require approval; an AI step its provider and the context
 *     it reads too.
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

export const SSH_TARGET_NEEDS_USER: string = translationKey(
  "Add the user to sign in as, before an @: deploy@10.0.4.21.",
);

export const SSH_SIGN_IN_TITLE: string = translationKey("Sign in with");

export const SSH_PASSPHRASE_TITLE: string = translationKey("Key passphrase");

export const SSH_PORT_TITLE: string = translationKey("Port");

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

export const MORE_FIELDS_DESCRIPTION_TITLE: string =
  translationKey("Description");
export const MORE_FIELDS_TIMEOUTS_TITLE: string = translationKey("Timeouts");
export const CONTINUE_ON_FAILURE_TITLE: string = translationKey(
  "Continue on failure",
);
export const REQUIRE_APPROVAL_TITLE: string = translationKey(
  "Require approval before running the next step",
);
export const LLM_PROVIDER_TITLE: string = translationKey("LLM provider");
export const INCLUDE_PREVIOUS_STEP_CONTEXT_TITLE: string = translationKey(
  "Include previous step context",
);
export const INCLUDE_TRIGGER_CONTEXT_TITLE: string = translationKey(
  "Include trigger context",
);

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isSetTimeout(value: unknown, defaultValue: number): boolean {
  return typeof value === "number" && value !== defaultValue;
}

/*
 * What a step's More fields fold holds, in order, and which of it is set -
 * so the folded line says "More fields · Port: 2222, Require approval: On"
 * and nothing in force is hidden. Empty for a Manual step, which folds
 * nothing: its description is what the responder reads.
 */
export function getStepMoreFieldsItems(
  step: RunbookStep,
): Array<FoldedSectionItem> {
  if (step.type === RunbookStepType.Manual) {
    return [];
  }

  const config: Record<string, unknown> = (step.config || {}) as Record<
    string,
    unknown
  >;

  const items: Array<FoldedSectionItem> = [];

  if (step.type === RunbookStepType.SSH) {
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
  }

  if (step.type === RunbookStepType.AI) {
    const ai: AIStepConfig = step.config as AIStepConfig;

    items.push({
      key: "llmProviderId",
      title: LLM_PROVIDER_TITLE,
      isSet: hasText(ai.llmProviderId),
    });
    items.push({
      key: "includePreviousStepContext",
      title: INCLUDE_PREVIOUS_STEP_CONTEXT_TITLE,
      // On by default for a new AI step: set when turned off.
      isSet: ai.includePreviousStepContext === false,
    });
    items.push({
      key: "includeTriggerContext",
      title: INCLUDE_TRIGGER_CONTEXT_TITLE,
      isSet: ai.includeTriggerContext === false,
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

  items.push({
    key: "continueOnFailure",
    title: CONTINUE_ON_FAILURE_TITLE,
    isSet: step.continueOnFailure === true,
    ...(step.continueOnFailure === true
      ? { value: FOLDED_SECTION_ON, translateValue: true }
      : {}),
  });
  items.push({
    key: "requireApproval",
    title: REQUIRE_APPROVAL_TITLE,
    isSet: step.requireApproval === true,
    ...(step.requireApproval === true
      ? { value: FOLDED_SECTION_ON, translateValue: true }
      : {}),
  });

  return items;
}

// ----------------------------------------------------- legacy steps

/*
 * Whether a step was written before runbook variables - an SSH or
 * Kubernetes step that names a credential (only through the API since the
 * data migration rewrote every stored one). The editor shows such a step as
 * it is, with a button that turns it into a script step.
 */
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
