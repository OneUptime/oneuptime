import { JSONObject, JSONValue } from "../JSON";
import {
  TemplateValues,
  Translator,
  composedValue,
  createTranslator,
} from "../Translator";

/*
 * WHY A DESTINATION OF THE BLOCKLIST IS NOT ENFORCING A BLOCK, IN THE
 * READER'S LANGUAGE (#10629).
 *
 * A destination's reasons ("Application Gateway matches IPv4 addresses
 * only", "prod-waf is in Detection mode...") and a cloud WAF's status were
 * English sentences the server wrote into a text column, so a German reader
 * saw a German chip beside an English sentence. A reason is kept instead as
 * what the step checks' evidence keeps (SecurityCaseStepCheckSentence): an
 * English sentence that is a key of the Dashboard's locales, with its
 * values, worded where it is drawn - in the reader's language, or in
 * English (fillSecurityBlockReason) for the text columns, the logs, an API
 * client and OneUptime AI.
 *
 * A value that is itself a sentence ("Not applied: {{reason}}") is a part:
 * worded with the same translator, so a sentence is wholly in the reader's
 * language or wholly in English. A value a provider wrote (Azure's own
 * words for a refusal), a name or an address stays as it is.
 *
 * The sentences live with each destination's code, each marked with
 * translationKey so the Dashboard's extractor puts it in every locale.
 */

export interface SecurityBlockReason {
  // The English sentence: a key of the Dashboard's locales.
  template: string;
  // Values put in as they are: names, addresses, a provider's own words.
  values?: Record<string, string> | undefined;
  // Figures, written in the reader's digits.
  numbers?: Record<string, number> | undefined;
  // Values that are sentences of their own, worded with the same translator.
  parts?: Record<string, SecurityBlockReason> | undefined;
}

// How deep parts may nest in a stored reason: a sentence in a sentence in a sentence.
const MAX_PART_DEPTH: number = 3;

// The longest text a stored reason keeps of one value.
export const SECURITY_BLOCK_REASON_VALUE_MAX_LENGTH: number = 1000;

let english: Translator | null = null;

function getEnglish(): Translator {
  if (!english) {
    english = createTranslator(undefined, "en");
  }

  return english;
}

// The reason in the reader's words: its sentence looked up, its parts worded alike.
export function wordSecurityBlockReason(
  reason: SecurityBlockReason,
  translator: Translator,
): string {
  const values: TemplateValues = { ...(reason.values || {}) };

  for (const [key, number] of Object.entries(reason.numbers || {})) {
    values[key] = translator.formatNumber(number);
  }

  for (const [key, part] of Object.entries(reason.parts || {})) {
    values[key] = composedValue((words: Translator): string => {
      return wordSecurityBlockReason(part, words);
    });
  }

  return translator.translateTemplate(reason.template, values);
}

// The reason in English, as the server's text columns, logs and API clients read it.
export function fillSecurityBlockReason(reason: SecurityBlockReason): string {
  return wordSecurityBlockReason(reason, getEnglish());
}

// A reason with nothing to fill: a sentence of its own.
export function securityBlockReason(
  template: string,
  values?: Record<string, string> | undefined,
  more?:
    | {
        numbers?: Record<string, number> | undefined;
        parts?: Record<string, SecurityBlockReason> | undefined;
      }
    | undefined,
): SecurityBlockReason {
  return {
    template,
    ...(values && Object.keys(values).length > 0 ? { values } : {}),
    ...(more?.numbers && Object.keys(more.numbers).length > 0
      ? { numbers: more.numbers }
      : {}),
    ...(more?.parts && Object.keys(more.parts).length > 0
      ? { parts: more.parts }
      : {}),
  };
}

// A reason as a JSON column keeps it.
export function toSecurityBlockReasonJson(
  reason: SecurityBlockReason,
): JSONObject {
  const json: JSONObject = { template: reason.template };

  if (reason.values && Object.keys(reason.values).length > 0) {
    json["values"] = { ...reason.values };
  }

  if (reason.numbers && Object.keys(reason.numbers).length > 0) {
    json["numbers"] = { ...reason.numbers };
  }

  if (reason.parts && Object.keys(reason.parts).length > 0) {
    const parts: JSONObject = {};

    for (const [key, part] of Object.entries(reason.parts)) {
      parts[key] = toSecurityBlockReasonJson(part);
    }

    json["parts"] = parts;
  }

  return json;
}

function readRecord<T>(
  value: JSONValue | undefined,
  readEntry: (entry: JSONValue) => T | undefined,
): Record<string, T> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record: Record<string, T> = {};

  for (const [key, entry] of Object.entries(value as JSONObject)) {
    const read: T | undefined = readEntry(entry as JSONValue);

    if (read !== undefined) {
      record[key] = read;
    }
  }

  return Object.keys(record).length > 0 ? record : undefined;
}

/*
 * A reason as a column or an API answer holds it, read back - or null for
 * anything that is not one, so a page falls back to the English text.
 */
export function readSecurityBlockReason(
  value: unknown,
  depth: number = 0,
): SecurityBlockReason | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    depth > MAX_PART_DEPTH
  ) {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const template: unknown = json["template"];

  if (typeof template !== "string" || !template.trim()) {
    return null;
  }

  const values: Record<string, string> | undefined = readRecord<string>(
    json["values"],
    (entry: JSONValue): string | undefined => {
      return typeof entry === "string"
        ? entry.slice(0, SECURITY_BLOCK_REASON_VALUE_MAX_LENGTH)
        : undefined;
    },
  );
  const numbers: Record<string, number> | undefined = readRecord<number>(
    json["numbers"],
    (entry: JSONValue): number | undefined => {
      return typeof entry === "number" && Number.isFinite(entry)
        ? entry
        : undefined;
    },
  );
  const parts: Record<string, SecurityBlockReason> | undefined =
    readRecord<SecurityBlockReason>(
      json["parts"],
      (entry: JSONValue): SecurityBlockReason | undefined => {
        return readSecurityBlockReason(entry, depth + 1) || undefined;
      },
    );

  return securityBlockReason(template, values, { numbers, parts });
}
