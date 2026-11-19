import JSONFunctions from "../../Types/JSONFunctions";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import {
  TemplatePlaceholder,
  findTemplatePlaceholders,
} from "../TemplatePlaceholders";

/*
 * HOW A MONITOR STEP REFERENCES ITS SECRETS, AND WHICH NEED A ONE-TIME CODE.
 *
 * Read the same way where a monitor is handed to a probe - the server
 * hands the probe the parameters of each one-time code (TOTP) secret a
 * step needs (Telemetry's MonitorUtil.attachTotpSecrets, issue #9703) - and
 * where a monitor is written: the monitor forms warn when a probe it would
 * run on is too old to make codes (issue #9759). One reading, so the warning
 * names exactly the steps the server would hand code parameters to.
 *
 * Free of the library that makes codes (Utils/Totp/TotpSecret), so a page
 * that reads a monitor's steps does not load it.
 */

export const MONITOR_SECRETS_REFERENCE_PREFIX: string = "monitorSecrets.";

// The function a script asks a fresh code with: oneuptime.getTotpCode("NAME").
export const TOTP_CODE_FUNCTION_NAME: string = "getTotpCode";

const CALLS_TOTP_CODE_FUNCTION: RegExp = new RegExp(
  `\\b${TOTP_CODE_FUNCTION_NAME}\\s*\\(`,
);

/*
 * The secret a placeholder names: the rest of "monitorSecrets.NAME" as
 * written, read the way the server reads it (VMUtil.replaceValueInPlace),
 * so {{ monitorSecrets.NAME }} is no reference here either.
 */
export function getReferencedName(
  placeholder: TemplatePlaceholder,
): string | null {
  if (!placeholder.inner.startsWith(MONITOR_SECRETS_REFERENCE_PREFIX)) {
    return null;
  }

  const name: string = placeholder.inner.slice(
    MONITOR_SECRETS_REFERENCE_PREFIX.length,
  );

  return name ? name : null;
}

// The names of the secrets a text references as {{monitorSecrets.NAME}}.
export function getReferencedSecretNames(text: string): Array<string> {
  const names: Array<string> = [];

  for (const placeholder of findTemplatePlaceholders(text)) {
    const name: string | null = getReferencedName(placeholder);

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

// Whether a script asks for a code with oneuptime.getTotpCode(...).
export function callsTotpCodeFunction(script: string): boolean {
  return typeof script === "string" && CALLS_TOTP_CODE_FUNCTION.test(script);
}

/*
 * Of these names, the ones a script writes in quotes - "NAME", 'NAME' or
 * `NAME` - as oneuptime.getTotpCode("NAME") is written. The server hands a
 * script the secrets it names, never all of them.
 */
export function getQuotedNames(
  script: string,
  names: Iterable<string>,
): Array<string> {
  const quoted: Array<string> = [];

  for (const name of Array.from(names)) {
    if (
      name &&
      !quoted.includes(name) &&
      (script.includes(`"${name}"`) ||
        script.includes(`'${name}'`) ||
        script.includes(`\`${name}\``))
    ) {
      quoted.push(name);
    }
  }

  return quoted;
}

// What a step references of the monitor's one-time code secrets.
export interface StepTotpReferences {
  // The names its {{monitorSecrets.NAME}} references give.
  names: Array<string>;
  // A script that asks with oneuptime.getTotpCode, for the names it quotes.
  script: string | undefined;
}

/*
 * Where a step's one-time codes go, and so what it references of the
 * secrets that make them (MonitorSecretTotp): the {{monitorSecrets.NAME}}
 * references of an API step's URL, headers and body, and of a Synthetic or
 * Custom JavaScript Code step's script - and, for a script that asks with
 * oneuptime.getTotpCode, the script itself, whose quoted names say which
 * secrets it asks for. Every other field fills in Text secrets only, and
 * leaves a reference to a one-time code secret as written. Null for a step
 * that references none.
 */
export function getStepTotpReferences(
  monitorStep: MonitorStep,
  monitorType: MonitorType | undefined,
): StepTotpReferences | null {
  if (!monitorStep?.data) {
    return null;
  }

  const texts: Array<string> = [];
  let script: string | undefined = undefined;

  if (monitorType === MonitorType.API) {
    texts.push(
      JSONFunctions.toString(monitorStep.data.monitorDestination || ""),
      JSONFunctions.toString(monitorStep.data.requestHeaders || {}),
      monitorStep.data.requestBody || "",
    );
  }

  if (
    monitorType === MonitorType.SyntheticMonitor ||
    monitorType === MonitorType.CustomJavaScriptCode
  ) {
    const customCode: string = monitorStep.data.customCode || "";

    texts.push(customCode);

    if (callsTotpCodeFunction(customCode)) {
      script = customCode;
    }
  }

  const names: Array<string> = [];

  for (const text of texts) {
    for (const name of getReferencedSecretNames(text)) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }

  if (names.length === 0 && script === undefined) {
    return null;
  }

  return { names, script };
}

/*
 * The one-time code secrets a step needs, of these: the ones it references,
 * then the ones its script asks for by name - in that order, each once.
 */
export function getTotpSecretNamesNeeded(
  references: StepTotpReferences,
  totpSecretNames: Iterable<string>,
): Array<string> {
  const known: Array<string> = Array.from(totpSecretNames);
  const names: Array<string> = [];

  for (const name of references.names) {
    if (known.includes(name) && !names.includes(name)) {
      names.push(name);
    }
  }

  if (references.script !== undefined) {
    for (const name of getQuotedNames(references.script, known)) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }

  return names;
}

/*
 * Whether a monitor's steps need a one-time code: a step that references
 * one of these one-time code secrets where a code goes, or a script that
 * asks for a code - which only a one-time code secret answers, so it needs
 * one whether or not the secrets' names can be read (null).
 */
export function doStepsNeedOneTimeCodes(data: {
  monitorSteps: MonitorSteps | undefined | null;
  monitorType: MonitorType | undefined;
  totpSecretNames: Iterable<string> | null;
}): boolean {
  for (const monitorStep of data.monitorSteps?.data
    ?.monitorStepsInstanceArray || []) {
    const references: StepTotpReferences | null = getStepTotpReferences(
      monitorStep,
      data.monitorType,
    );

    if (!references) {
      continue;
    }

    if (references.script !== undefined) {
      return true;
    }

    if (
      data.totpSecretNames &&
      getTotpSecretNamesNeeded(references, data.totpSecretNames).length > 0
    ) {
      return true;
    }
  }

  return false;
}
