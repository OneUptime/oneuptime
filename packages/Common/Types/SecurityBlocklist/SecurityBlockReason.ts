import { JSONObject, JSONValue } from "../JSON";
import {
  TemplateValues,
  Translator,
  composedValue,
  createTranslator,
  translationKey,
} from "../Translator";
import {
  SecurityAddressProtection,
  getSecurityProtectionLead,
  getSecurityProtectionSentence,
} from "./SecurityProtectedAddress";

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

/*
 * The reconciler's own sentences around a destination's reason (#10629):
 * what a block's row says at a destination that could not take it, let it
 * go, be read or be written.
 *
 * And what a held-back block's rows say (#10640, #10804): the address is
 * protected now, so OneUptime took the block off, then what protects it
 * ({{protection}}, describeSecurityAddressProtection's sentence) - after
 * how the block meets it ({{overlap}}: "35.205.11.0/24 holds
 * 35.205.11.131.") when the two are not the same.
 */
export const SECURITY_BLOCK_REASON_FRAMES: {
  notApplied: string;
  notRemoved: string;
  noLongerEnforces: string;
  couldNotRead: string;
  couldNotReadBack: string;
  couldNotWrite: string;
  notReady: string;
  heldBack: string;
  heldBackOverlapping: string;
} = {
  notApplied: translationKey("Not applied: {{reason}}"),
  notRemoved: translationKey("Not removed: {{reason}}"),
  noLongerEnforces: translationKey(
    "{{destination}} no longer enforces the blocklist.",
  ),
  couldNotRead: translationKey("Could not read {{destination}}: {{error}}"),
  couldNotReadBack: translationKey(
    "Could not read {{destination}} back: {{error}}",
  ),
  couldNotWrite: translationKey(
    "Could not write to {{destination}}: {{error}}",
  ),
  notReady: translationKey(
    "{{destination}} is not ready to hold blocks: {{error}}",
  ),
  heldBack: translationKey(
    "Held back: {{value}} is protected now, so OneUptime took the block off. {{protection}}",
  ),
  heldBackOverlapping: translationKey(
    "Held back: {{value}} is protected now, so OneUptime took the block off. {{overlap}} {{protection}}",
  ),
};

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

/*
 * A reconciler's frame around a destination's sentence, or null when the
 * destination gave none: its English text is then all a row says, as
 * before. A frame is only said around a sentence, so a row reads wholly in
 * the reader's language or wholly in English.
 */
export function frameSecurityBlockReason(
  frame: string,
  sentence: SecurityBlockReason | undefined | null,
): SecurityBlockReason | null {
  return sentence
    ? securityBlockReason(frame, undefined, { parts: { reason: sentence } })
    : null;
}

/*
 * A frame around a failure that carries its sentence (an error of Azure
 * WAF's or Cloud Armor's own, whose reason says it in words a reader's
 * language has), with the destination's name; null for any other failure,
 * whose English text is then all a row says.
 */
export function frameSecurityBlockFailure(data: {
  frame: string;
  destination: string;
  error: unknown;
}): SecurityBlockReason | null {
  const carried: SecurityBlockReason | null =
    data.error && typeof data.error === "object"
      ? readSecurityBlockReason((data.error as { reason?: unknown }).reason)
      : null;

  return carried
    ? securityBlockReason(
        data.frame,
        { destination: data.destination },
        { parts: { error: carried } },
      )
    : null;
}

// A cloud resource's kind, when its protection does not name one: "the address of resource web-3".
export const SECURITY_PROTECTED_RESOURCE_KIND: string =
  translationKey("resource");

// The values a sentence names, of those given: a reason keeps no value its sentence never says.
function valuesNamedIn(
  template: string,
  values: Record<string, string>,
): Record<string, string> {
  const named: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    if (template.includes(`{{${key}}}`)) {
      named[key] = value;
    }
  }

  return named;
}

/*
 * What protects an address, as the sentences a reader's language words
 * (#10804): the sentence of what protects it, and - when the block and
 * what is protected are not the same - the one before it that says how
 * they meet ("35.205.11.0/24 holds 35.205.11.131."). In English they read
 * as describeSecurityAddressProtection writes them. The protection is as
 * the reader may see it: whoever may not name a record leaves its name
 * out before this (isSecurityProtectionWithheld).
 */
export function securityProtectionReasons(data: {
  value: string;
  protection: SecurityAddressProtection;
}): {
  overlap: SecurityBlockReason | null;
  protection: SecurityBlockReason;
} {
  const values: Record<string, string> = {
    value: data.value,
    address: data.protection.protectedValue,
    name: data.protection.name || data.protection.protectedValue,
    where: data.protection.where || "",
  };
  const sentence: string = getSecurityProtectionSentence(data.protection);
  const lead: string | null = getSecurityProtectionLead({
    value: data.value,
    protectedValue: data.protection.protectedValue,
  });
  // A kind the protection names is a product's own name, written as it is; none is the reader's word.
  const kind: Record<string, string> = data.protection.kind
    ? { kind: data.protection.kind }
    : {};
  const kindPart: Record<string, SecurityBlockReason> =
    !data.protection.kind && sentence.includes("{{kind}}")
      ? { kind: securityBlockReason(SECURITY_PROTECTED_RESOURCE_KIND) }
      : {};

  return {
    overlap: lead
      ? securityBlockReason(lead, valuesNamedIn(lead, values))
      : null,
    protection: securityBlockReason(
      sentence,
      valuesNamedIn(sentence, { ...values, ...kind }),
      { parts: kindPart },
    ),
  };
}

/*
 * Why a block is held back now that what it blocks is protected (#10640),
 * as its rows say it in the reader's language (#10804): "Held back:
 * 35.205.11.131 is protected now, so OneUptime took the block off.
 * 35.205.11.131 is one of your project's own addresses." Filled in
 * English, it is the row's text and the case's timeline line.
 */
export function securityBlockHeldBackReason(data: {
  value: string;
  protection: SecurityAddressProtection;
}): SecurityBlockReason {
  const sentences: {
    overlap: SecurityBlockReason | null;
    protection: SecurityBlockReason;
  } = securityProtectionReasons(data);

  return sentences.overlap
    ? securityBlockReason(
        SECURITY_BLOCK_REASON_FRAMES.heldBackOverlapping,
        { value: data.value },
        {
          parts: {
            overlap: sentences.overlap,
            protection: sentences.protection,
          },
        },
      )
    : securityBlockReason(
        SECURITY_BLOCK_REASON_FRAMES.heldBack,
        { value: data.value },
        { parts: { protection: sentences.protection } },
      );
}

// Whether a row's reason says its block is held back as protected now (#10640): not a failure.
export function isSecurityBlockHeldBackReason(
  reason: SecurityBlockReason | null | undefined,
): boolean {
  return (
    reason?.template === SECURITY_BLOCK_REASON_FRAMES.heldBack ||
    reason?.template === SECURITY_BLOCK_REASON_FRAMES.heldBackOverlapping
  );
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
