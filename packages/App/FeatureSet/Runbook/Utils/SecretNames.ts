import {
  TemplatePlaceholder,
  findTemplatePlaceholders,
} from "Common/Utils/TemplatePlaceholders";

/*
 * Which runbook secrets a script names ({{runbookSecrets.NAME}}), read with
 * the same placeholder reader that fills them in (RunbookSecretsUtil
 * .populateInScript, through VMUtil.replaceValueInPlace) - in time in line
 * with the script's length (Common/Utils/TemplatePlaceholders). Kept apart
 * from RunbookSecretsUtil, which loads the sandbox, so the claim path's
 * check can be read and tested on its own.
 */

const RUNBOOK_SECRETS_PREFIX: string = "runbookSecrets.";

// The secrets a script names, each once, in the order it names them.
export function getSecretNamesInScript(script: string): Array<string> {
  // A set keeps the reading in line with the script's length, however many names.
  const names: Set<string> = new Set<string>();

  for (const placeholder of findTemplatePlaceholders(script || "")) {
    const inner: string = (placeholder as TemplatePlaceholder).inner.trim();

    if (!inner.startsWith(RUNBOOK_SECRETS_PREFIX)) {
      continue;
    }

    const name: string = inner.slice(RUNBOOK_SECRETS_PREFIX.length).trim();

    if (name) {
      names.add(name);
    }
  }

  return [...names];
}

/*
 * The secrets a script names that are not among `available` (the names of
 * the secrets it may be handed) - for a step on a global Runner, the ones
 * its project has not let global Runners use, or that do not exist. Such a
 * step is failed with their names rather than run with a placeholder where
 * the value should be.
 */
export function getSecretNamesNotIn(data: {
  script: string;
  available: Array<string>;
}): Array<string> {
  const available: Set<string> = new Set<string>(data.available);

  return getSecretNamesInScript(data.script).filter(
    (name: string): boolean => {
      return !available.has(name);
    },
  );
}
