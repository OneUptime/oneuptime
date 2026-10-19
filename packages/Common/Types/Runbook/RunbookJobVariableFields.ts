import { JSONObject } from "../JSON";
import RunbookStepType from "./RunbookStepType";
import {
  RunbookVariableReference,
  findRunbookVariableReferencesIn,
} from "./RunbookVariableReference";

/*
 * WHERE A RUNBOOK STEP'S JOB NAMES RUNBOOK VARIABLES.
 *
 * A job (RunnerJob) keeps a step's references as written, never a value:
 *
 *   - a Bash or JavaScript step in its script;
 *   - an SSH step that takes a script in its payload's host, username,
 *     signIn (the key or password), passphrase and script;
 *   - a kubectl step (Kubernetes, with a script) in its payload's
 *     kubeconfig and script.
 *
 * An SSH or Kubernetes job that names a credential (a step written before
 * runbook variables, or a command OneUptime AI composed) names none: its
 * credential is resolved apart, and AI commands are never filled in.
 *
 * Read the same way when a Runner takes the job (to fill them in) and when
 * its result comes back (to hide the secrets it was given).
 */

export interface RunbookJobVariableSource {
  stepType?: RunbookStepType | string | undefined;
  script?: string | undefined;
  payload?: JSONObject | undefined;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Whether a job's step takes variables at all.
export function jobUsesRunbookVariables(
  job: RunbookJobVariableSource,
): boolean {
  if (
    job.stepType === RunbookStepType.Bash ||
    job.stepType === RunbookStepType.JavaScript
  ) {
    return true;
  }

  if (
    job.stepType === RunbookStepType.SSH ||
    job.stepType === RunbookStepType.Kubernetes
  ) {
    const payload: JSONObject = job.payload || {};

    return !asText(payload["credentialId"]);
  }

  return false;
}

// The fields of a job that may name variables, as stored.
export function getRunbookJobVariableTexts(
  job: RunbookJobVariableSource,
): Array<string> {
  if (!jobUsesRunbookVariables(job)) {
    return [];
  }

  const payload: JSONObject = job.payload || {};

  if (job.stepType === RunbookStepType.SSH) {
    return [
      asText(payload["host"]),
      asText(payload["username"]),
      asText(payload["signIn"]),
      asText(payload["passphrase"]),
      asText(payload["script"]),
    ];
  }

  if (job.stepType === RunbookStepType.Kubernetes) {
    return [asText(payload["kubeconfig"]), asText(payload["script"])];
  }

  return [job.script || ""];
}

// The variables a job names, each once.
export function getRunbookJobVariableReferences(
  job: RunbookJobVariableSource,
): Array<RunbookVariableReference> {
  return findRunbookVariableReferencesIn(getRunbookJobVariableTexts(job));
}

/*
 * The fields of a job that take a secret, which hold one reference each:
 * an SSH step's key or password and passphrase, a kubectl step's
 * kubeconfig. Empty ones are left out.
 */
export function getRunbookJobSecretFields(
  job: RunbookJobVariableSource,
): Array<string> {
  if (!jobUsesRunbookVariables(job)) {
    return [];
  }

  const payload: JSONObject = job.payload || {};

  const fields: Array<string> =
    job.stepType === RunbookStepType.SSH
      ? [asText(payload["signIn"]), asText(payload["passphrase"])]
      : job.stepType === RunbookStepType.Kubernetes
        ? [asText(payload["kubeconfig"])]
        : [];

  return fields.filter((field: string): boolean => {
    return field.trim().length > 0;
  });
}
