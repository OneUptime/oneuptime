import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import type { ParsedChangeEventEntry } from "../ChangeEventRow";

/*
 * The change events for what OneUptime itself changes: a fix command
 * OneUptime AI ran on a cluster or a host, and a runbook OneUptime ran.
 * Pure on purpose, so every rule is pinned by tests; OwnChangeRecorder
 * reads the rows and writes the events.
 *
 * They are recorded because the next investigation has to know about
 * them: a pod restarted by OneUptime AI ten minutes before an incident is
 * a change like a deploy, and an investigation that cannot see it might
 * blame something else for what it did.
 */

// The longest command, runbook name or failure reason an event keeps.
export const MAX_OWN_CHANGE_TEXT_LENGTH: number = 500;

// A Deployment, however kubectl's argument names it (deployment, deploy).
const DEPLOYMENT_KIND: RegExp = /^deploy/i;

// What a command undoes a change with, rather than making a new one.
const ROLLBACK_COMMAND: RegExp =
  /\b(?:rollout\s+undo|service\s+rollback|rollback)\b/i;

export function isRollbackCommand(command: string): boolean {
  return ROLLBACK_COMMAND.test(command);
}

function capped(text: string): string {
  const trimmed: string = text.trim();

  return trimmed.length > MAX_OWN_CHANGE_TEXT_LENGTH
    ? `${trimmed.slice(0, MAX_OWN_CHANGE_TEXT_LENGTH - 1)}…`
    : trimmed;
}

export interface KubectlTarget {
  namespace?: string | undefined;
  kind?: string | undefined;
  name?: string | undefined;
}

/*
 * The namespace and the object a kubectl argument list acts on:
 * ["rollout", "restart", "deployment/api", "-n", "web"] is deployment api
 * in web. Only what the arguments name plainly; anything else is left out.
 */
export function describeKubectlTarget(args: Array<unknown>): KubectlTarget {
  const target: KubectlTarget = {};
  const words: Array<string> = args.filter((arg: unknown): arg is string => {
    return typeof arg === "string";
  });

  for (let i: number = 0; i < words.length; i++) {
    const word: string = words[i]!;

    if ((word === "-n" || word === "--namespace") && words[i + 1]) {
      target.namespace = words[i + 1];
      i++;
      continue;
    }

    if (word.startsWith("--namespace=")) {
      target.namespace = word.slice("--namespace=".length) || undefined;
      continue;
    }

    if (!target.name && !word.startsWith("-") && word.includes("/")) {
      const [kind, name] = word.split("/", 2) as [string, string];

      if (kind && name) {
        target.kind = kind;
        target.name = name;
      }
    }
  }

  return target;
}

export interface AiCommandChange {
  jobId: ObjectID;
  command: string;
  succeeded: boolean;
  time: Date;
  // The kubectl argument list, when the command is kubectl.
  kubectlArgs?: Array<unknown> | undefined;
  kubernetesClusterId?: ObjectID | undefined;
  resourceType?: string | undefined;
  resourceId?: ObjectID | undefined;
  aiRunId?: ObjectID | undefined;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

// "OneUptime AI ran kubectl rollout restart deployment/api -n web".
export function buildAiCommandChangeEntry(
  change: AiCommandChange,
): ParsedChangeEventEntry {
  const command: string = capped(change.command) || "a command";
  const status: ChangeEventStatus = change.succeeded
    ? ChangeEventStatus.Succeeded
    : ChangeEventStatus.Failed;

  const attributes: Dictionary<string> = {
    [ChangeEventAttribute.Source]: ChangeEventSource.OneUptimeAi,
    [ChangeEventAttribute.Status]: status,
    [ChangeEventAttribute.Command]: command,
  };

  if (change.kubernetesClusterId) {
    attributes[ChangeEventAttribute.KubernetesClusterId] =
      change.kubernetesClusterId.toString();
  }

  if (change.kubectlArgs) {
    const target: KubectlTarget = describeKubectlTarget(change.kubectlArgs);

    if (target.namespace) {
      attributes[ChangeEventAttribute.KubernetesNamespace] = target.namespace;
    }

    if (target.kind && target.name && DEPLOYMENT_KIND.test(target.kind)) {
      attributes[ChangeEventAttribute.KubernetesDeployment] = target.name;
    }
  }

  if (change.resourceType && change.resourceId) {
    attributes[ChangeEventAttribute.ResourceType] = change.resourceType;
    attributes[ChangeEventAttribute.ResourceId] = change.resourceId.toString();
  }

  if (change.aiRunId) {
    attributes[ChangeEventAttribute.AiRunId] = change.aiRunId.toString();
  }

  if (change.incidentId) {
    attributes[ChangeEventAttribute.IncidentId] = change.incidentId.toString();
  }

  if (change.alertId) {
    attributes[ChangeEventAttribute.AlertId] = change.alertId.toString();
  }

  const subject: string = change.incidentId
    ? " for an incident"
    : change.alertId
      ? " for an alert"
      : "";

  return {
    time: change.time,
    eventType: isRollbackCommand(command)
      ? ChangeEventType.Rollback
      : ChangeEventType.Remediation,
    title: `${change.succeeded ? "OneUptime AI ran" : "OneUptime AI's command failed:"} ${command}`,
    description: `OneUptime AI ran this command${subject}, and it ${
      change.succeeded
        ? "succeeded"
        : "failed - it may have changed something before it failed"
    }.`,
    attributes,
  };
}

export enum RunbookChangeOutcome {
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

export interface RunbookChange {
  executionId: ObjectID;
  runbookId?: ObjectID | undefined;
  runbookName: string;
  outcome: RunbookChangeOutcome;
  time: Date;
  failureReason?: string | undefined;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

// 'Runbook "Flush cache" ran'.
export function buildRunbookChangeEntry(
  change: RunbookChange,
): ParsedChangeEventEntry {
  const name: string = capped(change.runbookName) || "Runbook";

  const attributes: Dictionary<string> = {
    [ChangeEventAttribute.Source]: ChangeEventSource.Runbook,
    [ChangeEventAttribute.Status]:
      change.outcome === RunbookChangeOutcome.Completed
        ? ChangeEventStatus.Succeeded
        : change.outcome === RunbookChangeOutcome.Failed
          ? ChangeEventStatus.Failed
          : ChangeEventStatus.Cancelled,
    [ChangeEventAttribute.RunbookExecutionId]: change.executionId.toString(),
  };

  if (change.runbookId) {
    attributes[ChangeEventAttribute.RunbookId] = change.runbookId.toString();
  }

  if (change.incidentId) {
    attributes[ChangeEventAttribute.IncidentId] = change.incidentId.toString();
  }

  if (change.alertId) {
    attributes[ChangeEventAttribute.AlertId] = change.alertId.toString();
  }

  const verb: string =
    change.outcome === RunbookChangeOutcome.Completed
      ? "ran"
      : change.outcome === RunbookChangeOutcome.Failed
        ? "failed"
        : "was cancelled";

  const reason: string =
    change.outcome !== RunbookChangeOutcome.Completed && change.failureReason
      ? ` ${capped(change.failureReason)}`
      : "";

  return {
    time: change.time,
    eventType: ChangeEventType.Runbook,
    title: `Runbook ${JSON.stringify(name)} ${verb}`,
    description: `OneUptime ran the runbook ${JSON.stringify(name)}${
      change.incidentId
        ? " for an incident"
        : change.alertId
          ? " for an alert"
          : ""
    }, and it ${verb === "ran" ? "completed" : verb}.${reason}`,
    attributes,
  };
}
