import { JSONObject, JSONValue } from "Common/Types/JSON";
import { ReturnValue } from "Common/Types/Workflow/Component";
import { WORKFLOW_LOG_REDACTED_VALUE } from "./SecretRedaction";

/*
 * VALUES A STEP MARKED SENSITIVE STAY SENSITIVE FOR THE REST OF THE RUN
 * (#11476).
 *
 * A step's returned value marked sensitive (ReturnValue.isSensitive) - the
 * images Get Files From Markdown hands on, as base64 - is hidden in that
 * step's own log line. Handed to a later step, it used to be logged whole
 * there, under the later step's arguments, and again under what that step
 * returned. So the run carries each one, from the step that returned it to
 * its end (and across a Sleep, from the values the run kept):
 *
 *   - a later step's argument or returned value that IS a carried value is
 *     logged as the redaction marker, whole, as the step that returned it
 *     logs it - as the value, or as the text a step is handed it as: a list
 *     or an object written into a text setting arrives as its indented JSON
 *     (VMAPI);
 *   - inside anything else the run logs - another value, a message a step
 *     logs, an error - the carried value's text is taken out wherever it
 *     appears: the value itself when it is a text of
 *     MIN_CARRIED_STRING_LENGTH characters or more; for a list or an object,
 *     its JSON, compact and indented, and every text in it of
 *     MIN_CARRIED_PIECE_LENGTH characters or more (an image's bytes, an
 *     address). Shorter texts - a file's name, its type, a field's name -
 *     say what was handed on, not what it holds, and are left in, so the log
 *     still reads.
 *
 * What a step is handed and returns at run time is never changed: only what
 * the run writes down (RunWorkflow).
 */

// A text a step marked sensitive is taken out of later lines from this long.
export const MIN_CARRIED_STRING_LENGTH: number = 8;

// A text inside a sensitive list or object, from this long.
export const MIN_CARRIED_PIECE_LENGTH: number = 32;

/*
 * One value carried: its JSON, the forms a later step may be handed it in
 * whole, and the texts taken out of later lines.
 */
export interface CarriedValue {
  json: string;
  wholeForms: Array<string>;
  texts: Array<string>;
}

type SensitiveField = Pick<ReturnValue, "id" | "isSensitive">;

// A value's JSON, or null for one that has none.
const toJSONText: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (value === undefined) {
    return null;
  }

  try {
    const json: string | undefined = JSON.stringify(value);
    return typeof json === "string" ? json : null;
  } catch {
    return null;
  }
};

// Every text a list or an object holds, at any depth, its keys too.
const collectTexts: (
  value: unknown,
  into: Array<string>,
  seen: WeakSet<Record<string, unknown>>,
) => void = (
  value: unknown,
  into: Array<string>,
  seen: WeakSet<Record<string, unknown>>,
): void => {
  if (typeof value === "string") {
    into.push(value);
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const node: Record<string, unknown> = value as Record<string, unknown>;

  if (seen.has(node)) {
    return;
  }

  seen.add(node);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTexts(item, into, seen);
    }

    return;
  }

  for (const [key, item] of Object.entries(node)) {
    into.push(key);
    collectTexts(item, into, seen);
  }
};

export type CarryValueFunction = (value: JSONValue) => CarriedValue | null;

/*
 * What carrying a value takes out of later lines, or null for a value that
 * holds nothing worth taking out: no text long enough. A number, a boolean
 * or nothing is never carried - every log is full of them.
 */
export const carryValue: CarryValueFunction = (
  value: JSONValue,
): CarriedValue | null => {
  const json: string | null = toJSONText(value);

  if (json === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.length >= MIN_CARRIED_STRING_LENGTH
      ? { json: json, wholeForms: [value], texts: [value] }
      : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const pieces: Array<string> = [];
  const found: Array<string> = [];

  collectTexts(value, found, new WeakSet<Record<string, unknown>>());

  for (const text of found) {
    if (text.length >= MIN_CARRIED_PIECE_LENGTH && !pieces.includes(text)) {
      pieces.push(text);
    }
  }

  if (pieces.length === 0) {
    return null;
  }

  // As a text setting is handed it (VMAPI's writeValueAsText).
  const indented: string = JSON.stringify(value, null, 2);
  const wholeForms: Array<string> =
    indented === json ? [json] : [json, indented];

  return {
    json: json,
    wholeForms: wholeForms,
    texts: [...wholeForms, ...pieces],
  };
};

export default class SensitiveValues {
  // The values carried, by their JSON: the same value twice is one.
  private carried: Map<string, CarriedValue> = new Map();

  // Every form a later step may be handed a carried value in, whole.
  private wholeForms: Set<string> = new Set<string>();

  /*
   * Each returned value the step's own metadata marks sensitive, carried
   * from now on. Called with every step's values as it returns them, and
   * with each step's kept values when a run that slept carries on.
   */
  public carry(
    returnValues: JSONObject | null | undefined,
    fields: Array<SensitiveField> | null | undefined,
  ): void {
    if (!returnValues || !fields) {
      return;
    }

    for (const field of fields) {
      if (
        field.isSensitive !== true ||
        !Object.prototype.hasOwnProperty.call(returnValues, field.id)
      ) {
        continue;
      }

      const carried: CarriedValue | null = carryValue(
        returnValues[field.id] as JSONValue,
      );

      if (carried && !this.carried.has(carried.json)) {
        this.carried.set(carried.json, carried);

        for (const form of carried.wholeForms) {
          this.wholeForms.add(form);
        }
      }
    }
  }

  // Whether nothing is carried.
  public isEmpty(): boolean {
    return this.carried.size === 0;
  }

  // Every text taken out of later lines, each once.
  public getTexts(): Array<string> {
    const texts: Set<string> = new Set<string>();

    for (const carried of this.carried.values()) {
      for (const text of carried.texts) {
        texts.add(text);
      }
    }

    return Array.from(texts);
  }

  /*
   * Whether a value is one carried, whole: the value itself, or a text that
   * is it as a step is handed it (its JSON, compact or indented).
   */
  public isCarried(value: JSONValue): boolean {
    if (this.carried.size === 0 || value === null || value === undefined) {
      return false;
    }

    if (typeof value === "string") {
      return this.wholeForms.has(value);
    }

    if (typeof value !== "object") {
      return false;
    }

    const json: string | null = toJSONText(value);

    return json !== null && this.carried.has(json);
  }

  /*
   * A step's arguments or returned values as the run writes them down: each
   * one that is a carried value, whole, as the redaction marker. A copy;
   * the values themselves are never changed.
   */
  public redactCarriedValues(values: JSONObject): JSONObject {
    if (this.carried.size === 0) {
      return values;
    }

    const loggable: JSONObject = {};

    for (const key of Object.keys(values || {})) {
      loggable[key] = this.isCarried(values[key] as JSONValue)
        ? WORKFLOW_LOG_REDACTED_VALUE
        : values[key]!;
    }

    return loggable;
  }
}
