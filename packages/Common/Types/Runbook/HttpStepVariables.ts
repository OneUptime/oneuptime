import { HttpRequestStepConfig } from "./RunbookStep";
import {
  RunbookVariableReference,
  replaceRunbookVariableReferences,
} from "./RunbookVariableReference";
import { redactSecretValues } from "./SecretOutputRedaction";

/*
 * AN HTTP REQUEST STEP FILLS IN THE RUNBOOK VARIABLES IT NAMES.
 *
 * Bash, JavaScript, SSH and kubectl steps had variables; an HTTP request
 * step - calling PagerDuty, Slack or a service of your own, usually with a
 * token - did not, so a token had to be typed into the step, where
 * everyone who may read the runbook reads it. Now its URL, headers and body
 * name variables the way scripts do ({{global.variables.NAME}},
 * {{local.variables.NAME}}), and OneUptime fills them in when the step runs.
 *
 * Who gets a secret: an HTTP request step is sent by OneUptime itself, from
 * its own servers - which keep the secret already, encrypted, and decrypt it
 * for every Runner that takes a step. No Runner is involved, so a secret's
 * Runners do not apply: the step gets every variable of its project (and of
 * its runbook) that it names, plain or secret. The secret is filled in only
 * in the request as it is sent, never stored, and hidden in what the step
 * records (the response's status, headers and body, and any error).
 *
 * How a value is placed, so a value is never read as JSON it was not:
 *
 *   - the URL: as written - a reference may stand for a whole base URL, so
 *     nothing is escaped;
 *   - the headers and the body, when they are JSON as written: each string
 *     in them (names included) is filled in, and the JSON written again, so
 *     a value with a quote or a line break in it stays one string;
 *   - otherwise (a reference standing where a number goes, or a body that is
 *     plain text): the text is filled in as written, and read as before.
 *
 * Pure, so the step's executor and the tests read the same rules.
 */

// The step's fields that may name variables, as stored.
export function getHttpStepVariableTexts(
  config: Pick<HttpRequestStepConfig, "url" | "headersJson" | "body">,
): Array<string> {
  return [config.url || "", config.headersJson || "", config.body || ""];
}

type GetValueFunction = (
  reference: RunbookVariableReference,
) => string | undefined;

// Every string in a JSON value, keys included, with references filled in.
function fillJsonValue(value: unknown, getValue: GetValueFunction): unknown {
  if (typeof value === "string") {
    return replaceRunbookVariableReferences(value, getValue);
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      return fillJsonValue(item, getValue);
    });
  }

  if (value && typeof value === "object") {
    const filled: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      filled[replaceRunbookVariableReferences(key, getValue)] = fillJsonValue(
        item,
        getValue,
      );
    }

    return filled;
  }

  return value;
}

/*
 * A header or body text with its references filled in: within the JSON's
 * strings when the text is JSON as written, else as plain text.
 */
export function fillHttpStepJsonText(
  text: string,
  getValue: GetValueFunction,
): string {
  if (typeof text !== "string" || text.indexOf("{{") === -1) {
    return text;
  }

  let parsed: unknown = undefined;

  try {
    parsed = JSON.parse(text);
  } catch {
    return replaceRunbookVariableReferences(text, getValue);
  }

  // A JSON string, number or the like holds nothing to fill but itself.
  if (typeof parsed !== "object" || parsed === null) {
    return replaceRunbookVariableReferences(text, getValue);
  }

  return JSON.stringify(fillJsonValue(parsed, getValue));
}

// The step's URL, headers and body with the variables it names filled in.
export function fillHttpStepConfig<T extends HttpRequestStepConfig>(
  config: T,
  getValue: GetValueFunction,
): T {
  return {
    ...config,
    url: replaceRunbookVariableReferences(config.url || "", getValue),
    ...(config.headersJson
      ? { headersJson: fillHttpStepJsonText(config.headersJson, getValue) }
      : {}),
    ...(config.body
      ? { body: fillHttpStepJsonText(config.body, getValue) }
      : {}),
  };
}

/*
 * What the step records, with every secret it was given hidden - as each
 * one was given, and as a URL carries it (percent-encoded), since the
 * request's own URL comes back in errors and in echoing responses.
 */
export function redactHttpStepSecrets(
  text: string,
  secretValues: Array<string>,
): string {
  if (!secretValues.length || typeof text !== "string" || !text) {
    return text;
  }

  const forms: Array<string> = [];

  for (const value of secretValues) {
    forms.push(value);

    const encoded: string = encodeURIComponent(value);

    if (encoded !== value) {
      forms.push(encoded);
    }
  }

  return redactSecretValues(text, forms);
}
