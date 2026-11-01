import {
  AiRemediationCommand,
  STORED_AI_COMMAND_STEP_TYPES,
} from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import KubectlPolicy, {
  KubectlNamedObject,
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "./KubectlPolicy";
import {
  CloudCatalogProvider,
  CloudCommandParse,
  getCloudCatalogProvider,
  parseCloudCommand,
} from "./Resource/CloudOperationCatalog";
import {
  ResourceTokenizeResult,
  tokenizeResourceCommand,
} from "./Resource/ResourceCommandPolicyCore";

/*
 * WHICH CHANGE A COMMAND MAKES, so the same fix can be told apart from
 * another across incidents (Types/AutoRemediation/RemediationTrackRecord).
 *
 * Two commands make the same change when they do the same thing to the same
 * object of the same cluster or resource - whatever their numbers:
 *
 *   - kubectl: the verb (and its subcommand) on the one object it names, in
 *     its namespace, on its cluster. `kubectl scale deployment/web
 *     --replicas=6 -n shop` and `--replicas=8` are one change; a rollout
 *     restart of the same deployment is another. A command that names no
 *     single object (a selector, --all) is compared as written.
 *   - a cloud change: the catalog's operation on the one resource it names,
 *     in its account (`cloud scale-out <arn> --count 8` and `--count 4` are
 *     one change), read by the catalog's own grammar.
 *   - any other command (Docker, Podman, Swarm, Proxmox, VMware, Ceph, a
 *     database or a host): the command as written, word for word, on its
 *     resource - their words carry their meaning (`govc vm.power -on` and
 *     `-off` are two changes).
 *
 * Null for a command that cannot be read: it is compared with nothing.
 * Pure, and never throws.
 */

// A key never grows past this, whatever a command holds.
const MAX_KEY_LENGTH: number = 1200;

function capped(key: string): string {
  return key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key;
}

function lower(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

// The words of a command, single-spaced, as its tokenizer reads them.
function wordsOf(argv: Array<string> | undefined): string | null {
  if (!argv || argv.length === 0) {
    return null;
  }

  return argv.join(" ");
}

function getKubectlChangeKey(
  command: Pick<AiRemediationCommand, "command" | "kubernetesClusterId">,
): string | null {
  const cluster: string = lower(command.kubernetesClusterId);

  if (!cluster) {
    return null;
  }

  // The argv without "kubectl", which the model may or may not write.
  const tokens: KubectlTokenizeResult = KubectlPolicy.tokenize(command.command);

  if (!tokens.args || tokens.args.length === 0) {
    return null;
  }

  const args: Array<string> = tokens.args;
  const named: KubectlNamedObject | null = KubectlPolicy.getNamedObject(args);

  if (!named) {
    const words: string | null = wordsOf(args);

    return words ? capped(`kubectl|${cluster}|${words}`) : null;
  }

  let namespace: string = "";

  try {
    const policy: KubectlPolicyResult = KubectlPolicy.evaluateArgs(args);
    namespace = policy.namespace || "";
  } catch {
    namespace = "";
  }

  const verb: string = named.subcommand
    ? `${named.verb} ${named.subcommand}`
    : named.verb;

  return capped(
    `kubectl|${cluster}|${verb}|${named.kind}/${named.name}|${namespace}`,
  );
}

function getResourceChangeKey(
  command: Pick<
    AiRemediationCommand,
    "command" | "resourceType" | "resourceId"
  >,
): string | null {
  const resourceId: string = lower(command.resourceId);

  if (!command.resourceType || !resourceId) {
    return null;
  }

  const tokens: ResourceTokenizeResult = tokenizeResourceCommand(
    command.command,
  );

  if (!tokens.argv || tokens.argv.length === 0) {
    return null;
  }

  const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
    command.resourceType,
  );

  if (provider) {
    const parse: CloudCommandParse = parseCloudCommand(provider, tokens.argv);

    if (!parse.ok || !parse.command.resource) {
      return null;
    }

    /*
     * Azure ids compare without case (as the inventory compares them); the
     * other clouds' ids are exact.
     */
    const target: string =
      provider === "azure"
        ? parse.command.resource.id.toLowerCase()
        : parse.command.resource.id;

    return capped(
      `cloud|${command.resourceType}|${resourceId}|${parse.command.operation.name}|${target}`,
    );
  }

  const words: string | null = wordsOf(tokens.argv);

  return words
    ? capped(`resource|${command.resourceType}|${resourceId}|${words}`)
    : null;
}

export function getRemediationChangeKey(
  command: Pick<
    AiRemediationCommand,
    | "stepType"
    | "command"
    | "runnerId"
    | "kubernetesClusterId"
    | "resourceType"
    | "resourceId"
  >,
): string | null {
  try {
    if (
      !command ||
      typeof command.command !== "string" ||
      !STORED_AI_COMMAND_STEP_TYPES.includes(command.stepType)
    ) {
      return null;
    }

    if (command.stepType === RunbookStepType.Kubectl) {
      return getKubectlChangeKey(command);
    }

    if (command.stepType === RunbookStepType.ResourceCommand) {
      return getResourceChangeKey(command);
    }

    // A Bash step on a Runner: the command as written, on that Runner.
    const runner: string = lower(command.runnerId);
    const tokens: ResourceTokenizeResult = tokenizeResourceCommand(
      command.command,
    );
    const words: string | null = wordsOf(tokens.argv);

    return runner && words
      ? capped(`${lower(command.stepType)}|${runner}|${words}`)
      : null;
  } catch {
    return null;
  }
}
