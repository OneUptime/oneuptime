import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { redactSecretValues } from "Common/Types/Runbook/SecretOutputRedaction";
import { RUNNER_OWN_ENVIRONMENT_NAMES } from "./RunnerOwnEnvironment";

/*
 * THE RUNNER'S OWN CREDENTIALS NEVER LEAVE IN WHAT A STEP PRINTED.
 *
 * What a runbook step prints is sent to the server and kept with the run,
 * where everyone who may read the runbook's runs reads it. A step runs
 * without the Runner's own settings in its environment
 * (RunnerOwnEnvironment), but it runs as the Runner's user, and a step that
 * reads the Runner's key from somewhere else - its process environment, a
 * file it was mounted from - and prints it would hand the key to every one
 * of them: whoever holds it claims the Runner's jobs and the secrets sent
 * with them.
 *
 * So before a step's output or error leaves this host, the Runner's own
 * credentials are replaced with [REDACTED], as the secret runbook variables
 * a step was handed are (RunbookExecutor.redactJobResult): its key - the
 * one it presents now, which the server issues the in-cluster Runner of the
 * Kubernetes agent chart at registration (RunnerIdentity), and the one it
 * was started with - and the other credentials it may hold
 * (RUNNER_OWN_ENVIRONMENT_NAMES). The server does the same again with the
 * key the result is sent with, before it stores the text
 * (RunnerIngress.submitJobResult), whatever this Runner sent.
 *
 * Only the value as it is: a step written to encode the key first is beyond
 * any search for it. That is why writing a step that runs takes what
 * changing a runbook's steps takes (Common/Types/Runbook/
 * RunbookStepAuthoring).
 */

/*
 * A value shorter than this is not looked for: a misconfigured short value
 * would replace common words in every output. A Runner's key is an id.
 */
export const MIN_REDACTED_RUNNER_CREDENTIAL_LENGTH: number = 8;

// The Runner's own credentials it holds now, each once.
export function getRunnerOwnCredentialValues(
  environment: NodeJS.ProcessEnv = process.env,
): Array<string> {
  const values: Set<string> = new Set<string>();

  const add: (value: unknown) => void = (value: unknown): void => {
    if (typeof value !== "string") {
      return;
    }

    const trimmed: string = value.trim();

    if (trimmed.length >= MIN_REDACTED_RUNNER_CREDENTIAL_LENGTH) {
      values.add(trimmed);
    }
  };

  // The key the server issued at registration (kubernetes-agent mode).
  add(LocalCache.getString("RUNNER", "RUNNER_KEY"));
  // The key the Runner was started with.
  add(environment["ONEUPTIME_RUNNER_KEY"]);

  for (const name of RUNNER_OWN_ENVIRONMENT_NAMES) {
    add(environment[name]);
  }

  return Array.from(values);
}

// `text` with every credential of the Runner's own replaced by [REDACTED].
export function redactRunnerOwnCredentials(
  text: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const values: Array<string> = getRunnerOwnCredentialValues(environment);

  if (!text || values.length === 0) {
    return text;
  }

  return redactSecretValues(text, values);
}
