/*
 * THE SECRET VALUES A PROBE HIDES IN ITS OWN LOG (OneUptime issue #10875).
 *
 * The server fills a monitor's Text secrets into a step before it hands the
 * step to a probe: {{monitorSecrets.Token}} arrives in a URL, a header, a
 * body or a script as the value itself, and the check can say it back - a
 * response that echoes the request, a script's error or the lines it logs.
 * The probe cannot tell which text was a secret, so the server hands it the
 * values it filled into the step beside the step
 * (MonitorStep.secretValuesToHide), the way it hands it the parameters of a
 * one-time code secret (MonitorStep.totpSecrets). While the probe runs the
 * step, every line it logs is written with those values hidden
 * (Common/Server/Utils/LogSecretValues).
 *
 * They are only ever held in memory, for as long as the step is: never
 * written to the database (MonitorStep.toDatabaseJSON), never in a response
 * of the API, and never logged, put in a span or sent back by the probe.
 * The server hands them only to a probe that declares it hides them
 * (ProbeCapability.HideSecretValuesInLogs): a probe from before has no use
 * for them, and is handed nothing more than it was.
 */

/*
 * The most values one step carries. A step names a handful of secrets; this
 * bounds what a malformed step makes a probe read.
 */
export const MAX_SECRET_VALUES_TO_HIDE_PER_STEP: number = 256;

/*
 * The values a step carries, as they travel: each a text that is not
 * empty, each once, in the order written, at most
 * MAX_SECRET_VALUES_TO_HIDE_PER_STEP. Anything else reads as no values.
 */
export function readSecretValuesToHide(value: unknown): Array<string> {
  const values: Array<string> = [];

  if (!Array.isArray(value)) {
    return values;
  }

  for (const entry of value) {
    if (values.length >= MAX_SECRET_VALUES_TO_HIDE_PER_STEP) {
      break;
    }

    if (typeof entry !== "string" || !entry || values.includes(entry)) {
      continue;
    }

    values.push(entry);
  }

  return values;
}
