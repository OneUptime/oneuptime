import { JSONObject, JSONValue } from "../JSON";

/*
 * A RUN'S INPUTS: the values another tool sends with a webhook call, and how
 * the steps receive them.
 *
 * The JSON object a call to a runbook's webhook sends (Types/Runbook/
 * RunbookWebhook) is kept with the run (RunbookExecution.inputs) and handed
 * to the steps as DATA, never as text pasted into a script or a command:
 *
 *   - a Bash step gets environment variables. Each top-level value is
 *     ONEUPTIME_INPUT_<NAME> - the name upper-cased, every character other
 *     than a letter, a digit or "_" written as "_" - with text as it is,
 *     numbers and true/false as written, and objects and lists as JSON. The
 *     whole object is ONEUPTIME_INPUTS (JSON, for jq), and what started the
 *     run is ONEUPTIME_TRIGGER. Quote them as any shell variable:
 *     "$ONEUPTIME_INPUT_HOST";
 *   - a JavaScript step gets args.inputs (the object as sent) and
 *     args.trigger;
 *   - an AI step whose prompt includes the trigger context reads them there,
 *     marked as data from outside OneUptime;
 *   - HTTP request, SSH and Kubernetes steps do not get them: their URL,
 *     command and target are what the runbook's author wrote, and nothing a
 *     caller sends can change them.
 *
 * Every name the variables take starts with ONEUPTIME_, so a caller cannot
 * set PATH, LD_PRELOAD, BASH_ENV or any variable the Runner itself reads.
 *
 * What a call may send is bounded here, before anything is stored: a JSON
 * object (or nothing), at most RUNBOOK_INPUTS_MAX_BYTES, at most
 * RUNBOOK_INPUTS_MAX_DEPTH levels deep, with no NUL character anywhere -
 * a process's environment cannot hold one.
 */

export const RUNBOOK_INPUTS_MAX_BYTES: number = 64 * 1024;
export const RUNBOOK_INPUTS_MAX_DEPTH: number = 32;

// The most variables a step is given, one per top-level value.
export const RUNBOOK_INPUT_MAX_VARIABLES: number = 100;

// A longer name is not made into a variable (it is still in ONEUPTIME_INPUTS).
export const RUNBOOK_INPUT_MAX_NAME_LENGTH: number = 100;

export const RUNBOOK_INPUT_VARIABLE_PREFIX: string = "ONEUPTIME_INPUT_";
export const RUNBOOK_INPUTS_VARIABLE: string = "ONEUPTIME_INPUTS";
export const RUNBOOK_TRIGGER_VARIABLE: string = "ONEUPTIME_TRIGGER";

const NUL: string = String.fromCharCode(0);

export enum RunbookInputsRefusal {
  NotAnObject = "NotAnObject",
  TooLarge = "TooLarge",
  TooDeep = "TooDeep",
  NulCharacter = "NulCharacter",
}

export type RunbookInputsReadResult =
  | { isRefused: false; inputs: JSONObject }
  | { isRefused: true; refusal: RunbookInputsRefusal };

const isPlainObject: (value: unknown) => value is JSONObject = (
  value: unknown,
): value is JSONObject => {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

/*
 * The deepest nesting in `value`, walked without recursion so a body nested
 * thousands deep is measured, not a stack overflow. Stops counting past
 * `limit`. NUL is looked for in every key and every text on the way.
 */
function inspect(
  value: JSONValue,
  limit: number,
): { depth: number; hasNul: boolean } {
  let deepest: number = 0;
  const pending: Array<{ value: unknown; depth: number }> = [
    { value: value, depth: 0 },
  ];

  while (pending.length > 0) {
    const item: { value: unknown; depth: number } = pending.pop()!;

    if (typeof item.value === "string") {
      if (item.value.indexOf(NUL) !== -1) {
        return { depth: deepest, hasNul: true };
      }

      continue;
    }

    if (typeof item.value !== "object" || item.value === null) {
      continue;
    }

    const depth: number = item.depth + 1;
    deepest = Math.max(deepest, depth);

    if (deepest > limit) {
      return { depth: deepest, hasNul: false };
    }

    if (Array.isArray(item.value)) {
      for (const child of item.value) {
        pending.push({ value: child, depth: depth });
      }

      continue;
    }

    for (const key of Object.keys(item.value as object)) {
      if (key.indexOf(NUL) !== -1) {
        return { depth: deepest, hasNul: true };
      }

      pending.push({
        value: (item.value as Record<string, unknown>)[key],
        depth: depth,
      });
    }
  }

  return { depth: deepest, hasNul: false };
}

/*
 * A webhook call's body as the run's inputs, or why it is refused. No body,
 * an empty body or an empty object are no inputs. `rawBodyByteLength` is the
 * size of the body as sent, when the caller knows it; the inputs are
 * measured as JSON either way.
 */
export function readRunbookInputs(
  body: unknown,
  rawBodyByteLength?: number | undefined,
): RunbookInputsReadResult {
  if (
    typeof rawBodyByteLength === "number" &&
    rawBodyByteLength > RUNBOOK_INPUTS_MAX_BYTES
  ) {
    return { isRefused: true, refusal: RunbookInputsRefusal.TooLarge };
  }

  if (body === undefined || body === null || body === "") {
    return { isRefused: false, inputs: {} };
  }

  if (!isPlainObject(body)) {
    return { isRefused: true, refusal: RunbookInputsRefusal.NotAnObject };
  }

  const inspected: { depth: number; hasNul: boolean } = inspect(
    body,
    RUNBOOK_INPUTS_MAX_DEPTH,
  );

  if (inspected.hasNul) {
    return { isRefused: true, refusal: RunbookInputsRefusal.NulCharacter };
  }

  if (inspected.depth > RUNBOOK_INPUTS_MAX_DEPTH) {
    return { isRefused: true, refusal: RunbookInputsRefusal.TooDeep };
  }

  let text: string;

  try {
    text = JSON.stringify(body);
  } catch {
    return { isRefused: true, refusal: RunbookInputsRefusal.NotAnObject };
  }

  if (getByteLength(text) > RUNBOOK_INPUTS_MAX_BYTES) {
    return { isRefused: true, refusal: RunbookInputsRefusal.TooLarge };
  }

  // A copy, as JSON reads it: no prototype, no Dates, nothing but values.
  return { isRefused: false, inputs: JSON.parse(text) as JSONObject };
}

function getByteLength(text: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }

  // Every UTF-16 unit is at most 3 bytes in UTF-8.
  return text.length * 3;
}

/*
 * The variable a top-level name becomes, or null when it becomes none: a
 * name with no letter or digit, or one longer than
 * RUNBOOK_INPUT_MAX_NAME_LENGTH.
 */
export function getRunbookInputVariableName(name: string): string | null {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > RUNBOOK_INPUT_MAX_NAME_LENGTH
  ) {
    return null;
  }

  let written: string = "";
  let hasLetterOrDigit: boolean = false;

  for (const character of name.toUpperCase()) {
    const isLetter: boolean = character >= "A" && character <= "Z";
    const isDigit: boolean = character >= "0" && character <= "9";

    if (isLetter || isDigit) {
      hasLetterOrDigit = true;
      written += character;
    } else {
      written += "_";
    }
  }

  return hasLetterOrDigit ? `${RUNBOOK_INPUT_VARIABLE_PREFIX}${written}` : null;
}

// A top-level value as a variable's text.
export function getRunbookInputVariableValue(value: JSONValue): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

/*
 * The environment a Bash step's process gets on top of the Runner's own:
 * the inputs, the whole object, and what started the run. Two names that
 * become the same variable ("host-name" and "host_name") give it the first
 * one's value; past RUNBOOK_INPUT_MAX_VARIABLES the rest are only in
 * ONEUPTIME_INPUTS. A value holding a NUL is left out (readRunbookInputs
 * refuses those, so only a row written some other way could hold one).
 */
export function getRunbookInputVariables(data: {
  inputs?: JSONObject | null | undefined;
  trigger?: string | null | undefined;
}): Record<string, string> {
  const inputs: JSONObject = isPlainObject(data.inputs) ? data.inputs : {};
  const variables: Record<string, string> = {};

  let count: number = 0;

  for (const name of Object.keys(inputs)) {
    if (count >= RUNBOOK_INPUT_MAX_VARIABLES) {
      break;
    }

    const variable: string | null = getRunbookInputVariableName(name);

    if (!variable || variables[variable] !== undefined) {
      continue;
    }

    const value: string = getRunbookInputVariableValue(
      inputs[name] as JSONValue,
    );

    if (value.indexOf(NUL) !== -1) {
      continue;
    }

    variables[variable] = value;
    count++;
  }

  const whole: string = JSON.stringify(inputs);

  if (whole.indexOf(NUL) === -1) {
    variables[RUNBOOK_INPUTS_VARIABLE] = whole;
  }

  if (typeof data.trigger === "string" && data.trigger.indexOf(NUL) === -1) {
    variables[RUNBOOK_TRIGGER_VARIABLE] = data.trigger;
  }

  return variables;
}

// What a JavaScript step reads as `args`.
export function getRunbookInputArgs(data: {
  inputs?: JSONObject | null | undefined;
  trigger?: string | null | undefined;
}): JSONObject {
  return {
    inputs: isPlainObject(data.inputs) ? data.inputs : {},
    trigger: typeof data.trigger === "string" ? data.trigger : null,
  };
}

// Whether a run has any inputs to show.
export function hasRunbookInputs(inputs: unknown): boolean {
  return isPlainObject(inputs) && Object.keys(inputs).length > 0;
}
