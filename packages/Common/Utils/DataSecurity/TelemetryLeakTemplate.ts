import { MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH } from "../../Types/DataSecurity/TelemetryLeakFix";
import { normalizeLogBodyToErrorPattern } from "../Telemetry/LogErrorPattern";
import BUILT_IN_DETECTORS from "./Detectors/Index";
import { findSensitiveValues, ScanDetector, TextMatch } from "./TextScanner";

/*
 * A LOG LINE AS A TEMPLATE: WHAT THE CODE WROTE, NEVER WHAT IT WROTE IT
 * WITH (#10367).
 *
 * The code agent finds the line that writes a leak by what is constant
 * about it - "User <Email address> signed up" is a logger call with a
 * literal around one value - so a log line, an exception's message, a
 * span's name or a metric's name is handed to it as a template, and only
 * as one:
 *
 *   1. every value any detector finds in it (the catalog's and the
 *      project's own types, whatever the project turned off or allows) is
 *      replaced by its type's name: <Email address>;
 *   2. the rest is collapsed to its pattern (normalizeLogBodyToErrorPattern,
 *      the Logs' error patterns): timestamps, ids, addresses, hex runs and
 *      numbers become <timestamp>, <uuid>, <url>, <ip>, <hex>, <num>;
 *   3. a structured line keeps its message and the names of its fields,
 *      never their values: {"msg":"signup","email":<value>} - in JSON and
 *      in key=value form;
 *   4. what still looks like a value after all that is masked again - by
 *      the detectors, and anything shaped like an address (name@host.tld)
 *      or a masked value (j***) whatever no detector named - and the
 *      template is held to MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH;
 *   5. templates of one line of code (the same file and line) read from
 *      several records are aligned (alignTelemetryLeakTemplates): a word
 *      that differs between them is a value, whatever a detector made of
 *      it - and of two that cannot be lined up word for word, only the
 *      words both start and end with are kept.
 *
 * Pure: run inside OneUptime, by the locator that reads the records
 * (Server/Utils/DataSecurity/Telemetry/TelemetryLeakLocator). What it
 * returns is all of a record's text that ever leaves it.
 */

// The most of a text a template is made from.
export const MAX_TEMPLATE_SOURCE_LENGTH: number = 4_096;

/*
 * What still reads as an address or a masked value once every detector
 * ran, whatever no detector named: "j***@e******.com", "****-4242". The
 * characters a structured line separates its fields with end one.
 */
const ADDRESS_LIKE: RegExp =
  /[^\s@"'<>(){}[\],;=]+@[^\s@"'<>(){}[\],;=]+\.[^\s@"'<>(){}[\],;=]+/g;
const MASKED_LIKE: RegExp = /[^\s"'<>(){}[\],;=]*\*{2,}[^\s"'<>(){}[\],;=]*/g;

// A type's name as a placeholder holds it: one line, no brackets, short.
const MAX_PLACEHOLDER_NAME_LENGTH: number = 60;

// What a value no detector named, or one a template read differently each time, is.
export const VALUE_PLACEHOLDER: string = "<value>";

/*
 * The fields of a structured line whose values are the code's own words -
 * its message, its level, its logger - kept in its template. Every other
 * field's value is data, and is masked.
 */
const MESSAGE_FIELDS: ReadonlySet<string> = new Set([
  "msg",
  "message",
  "event",
  "@m",
  "@mt",
  "messagetemplate",
  "log",
  "text",
  "level",
  "lvl",
  "severity",
  "logger",
  "loggername",
  "logger_name",
  "caller",
  "module",
  "component",
]);

// Private-use marks around a slot a value was taken from: no rule of the pattern matches them.
const SLOT_START: string = "\uE000";
const SLOT_END: string = "\uE001";
const SLOT_PATTERN: RegExp = /\uE000([a-z]+)\uE001/g;
// A whole word that is a placeholder, or a slot a value was taken from.
const PLACEHOLDER_WORD: RegExp = /^<[^<>]+>$/;
const SLOT_WORD: RegExp = /^\uE000[a-z]+\uE001$/;
// What no template keeps: the C0 controls and DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS: RegExp = /[\u0000-\u001f\u007f]/g;
// Two letters in a row: a word of the code's to find the line by.
const CODE_WORD: RegExp = /[A-Za-z]{2,}/;
// The punctuation around a word, kept when the word is masked.
const LEADING_PUNCTUATION: RegExp = /^[("'[{]*/;
const TRAILING_PUNCTUATION: RegExp = /[)"'\]},.:;!?]*$/;

function slotName(index: number): string {
  let name: string = "";
  let rest: number = index;

  do {
    name = String.fromCharCode(97 + (rest % 26)) + name;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);

  return name;
}

// A type's name as it stands in a template: <Email address>.
export function toTypePlaceholder(name: string): string {
  const clean: string = name
    .replace(/[<>\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PLACEHOLDER_NAME_LENGTH);

  return clean ? `<${clean}>` : VALUE_PLACEHOLDER;
}

export interface TelemetryLeakTemplateOptions {
  // The project's own types, compiled: their values are masked too.
  customDetectors?: ReadonlyArray<ScanDetector> | undefined;
  // What a data type is called, as the project calls it.
  nameOf: (dataTypeId: string) => string;
}

// The values every detector finds in the text, the first of each overlap kept.
function findValues(
  text: string,
  options: TelemetryLeakTemplateOptions,
): Array<TextMatch> {
  const customDetectors: ReadonlyArray<ScanDetector> =
    options.customDetectors || [];
  const matches: Array<TextMatch> = findSensitiveValues(text, {
    detectors:
      customDetectors.length > 0
        ? [...BUILT_IN_DETECTORS, ...customDetectors]
        : BUILT_IN_DETECTORS,
  }).sort((left: TextMatch, right: TextMatch): number => {
    return left.start - right.start || right.end - left.end;
  });
  const kept: Array<TextMatch> = [];
  let end: number = 0;

  for (const match of matches) {
    if (match.start >= end && match.end > match.start) {
      kept.push(match);
      end = match.end;
    }
  }

  return kept;
}

/*
 * Every value found in the text replaced by a slot, and what each slot
 * holds: its type's placeholder.
 */
function slotValues(
  text: string,
  options: TelemetryLeakTemplateOptions,
): { text: string; placeholders: Map<string, string> } {
  const placeholders: Map<string, string> = new Map();
  let slotted: string = "";
  let position: number = 0;

  for (const match of findValues(text, options)) {
    const name: string = slotName(placeholders.size);

    placeholders.set(name, toTypePlaceholder(options.nameOf(match.dataTypeId)));
    slotted += `${text.slice(position, match.start)}${SLOT_START}${name}${SLOT_END}`;
    position = match.end;
  }

  return { text: slotted + text.slice(position), placeholders };
}

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_WORD.test(text.trim()) || SLOT_WORD.test(text);
}

// A JSON value, its message fields kept (already slotted) and every other value masked.
function maskJsonValue(value: unknown, key: string | null): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      return maskJsonValue(item, key);
    });
  }

  if (value && typeof value === "object") {
    const masked: Record<string, unknown> = {};

    for (const [childKey, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      masked[childKey] = maskJsonValue(child, childKey);
    }

    return masked;
  }

  if (typeof value === "string") {
    if (key !== null && MESSAGE_FIELDS.has(key.toLowerCase())) {
      return value;
    }

    return isPlaceholder(value) ? value : VALUE_PLACEHOLDER;
  }

  // A number, a flag or a null is the record's, never the code's words.
  return value === null || value === undefined ? value : VALUE_PLACEHOLDER;
}

/*
 * A structured line - a JSON object, or fields written key=value - with
 * its message kept and every other field's value masked. Null for a line
 * that is neither.
 */
function maskStructuredLine(slotted: string): string | null {
  const trimmed: string = slotted.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return JSON.stringify(maskJsonValue(parsed, null)).replace(
          /"(<[^"<>]+>)"/g,
          "$1",
        );
      }
    } catch {
      // Not JSON after all: read as text.
    }
  }

  const fields: RegExp = /(^|\s)([A-Za-z_@][\w.@-]*)=("(?:[^"\\]|\\.)*"|\S+)/g;
  let count: number = 0;
  const masked: string = slotted.replace(
    fields,
    (_whole: string, lead: string, key: string, value: string): string => {
      count++;

      if (MESSAGE_FIELDS.has(key.toLowerCase())) {
        return `${lead}${key}=${value}`;
      }

      const bare: string = value.replace(/^"|"$/g, "");

      return `${lead}${key}=${isPlaceholder(bare) ? bare : VALUE_PLACEHOLDER}`;
    },
  );

  // Two or more fields make a key=value line; one is a sentence with an "=" in it.
  return count >= 2 ? masked : null;
}

/*
 * A text a record holds - a log line, an exception's message, a span's or
 * a metric's name - as a template (see the module comment), or "" when
 * nothing of it is the code's own words.
 */
export function buildTelemetryLeakTemplate(
  text: string | null | undefined,
  options: TelemetryLeakTemplateOptions,
): string {
  if (typeof text !== "string" || !text.trim()) {
    return "";
  }

  const source: string = text.slice(0, MAX_TEMPLATE_SOURCE_LENGTH);
  const slotted: { text: string; placeholders: Map<string, string> } =
    slotValues(source, options);
  const structured: string | null = maskStructuredLine(slotted.text);
  let template: string = normalizeLogBodyToErrorPattern(
    structured !== null ? structured : slotted.text,
  ).replace(SLOT_PATTERN, (_whole: string, name: string): string => {
    return slotted.placeholders.get(name) || VALUE_PLACEHOLDER;
  });

  // A slot cut in two by the pattern's length, and anything else of the marks.
  template = template.replace(/[\uE000\uE001][a-z]*/g, VALUE_PLACEHOLDER);

  // Anything that still reads as a value, masked again.
  const again: { text: string; placeholders: Map<string, string> } = slotValues(
    template,
    options,
  );

  template = again.text
    .replace(SLOT_PATTERN, (_whole: string, name: string): string => {
      return again.placeholders.get(name) || VALUE_PLACEHOLDER;
    })
    .replace(ADDRESS_LIKE, VALUE_PLACEHOLDER)
    .replace(MASKED_LIKE, VALUE_PLACEHOLDER);

  // Control characters out, one line, held to its length.
  template = template
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (template.length > MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH) {
    template = `${template.slice(0, MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH - 1).trimEnd()}…`;
  }

  // Nothing but placeholders and punctuation: no words of the code to find it by.
  return CODE_WORD.test(template.replace(/<[^<>]*>/g, " ")) ? template : "";
}

/*
 * A template's words, as spaces part them: a placeholder ("<Email
 * address>") is part of one word whatever spaces are in it, and so is what
 * touches it ("id-<hex>" is one word).
 */
export function splitTemplateWords(template: string): Array<string> {
  return template.match(/(?:<[^<>]*>|[^\s<]|<)+/g) || [];
}

// How a word of one read of a line is kept.
enum WordMask {
  Kept = 0,
  // A value in a word of its own: masked, its punctuation kept.
  Word = 1,
  // Part of a stretch that differs between two reads: the stretch is one value.
  Stretch = 2,
}

/*
 * Templates of ONE line of code - the records of one place, the same file
 * and line - read with different values, aligned: of two with as many
 * words, each word that differs between them is a value (a name no
 * detector knows, an account number) and is masked in both. Of two that
 * cannot be lined up word for word - a value with a space in it - the
 * words both start and end with are the code's, and what lies between is
 * masked as one value in each. Each template given, to what it became.
 */
export function alignTelemetryLeakTemplates(
  templates: ReadonlyArray<string>,
): Map<string, string> {
  const distinct: Array<string> = [];

  for (const template of templates) {
    if (template && !distinct.includes(template)) {
      distinct.push(template);
    }
  }

  const words: Array<Array<string>> = distinct.map(splitTemplateWords);
  const masks: Array<Array<WordMask>> = words.map(
    (parts: Array<string>): Array<WordMask> => {
      return parts.map((): WordMask => {
        return WordMask.Kept;
      });
    },
  );

  for (let left: number = 0; left < words.length; left++) {
    for (let right: number = left + 1; right < words.length; right++) {
      const a: Array<string> = words[left]!;
      const b: Array<string> = words[right]!;

      if (a.length === b.length) {
        a.forEach((word: string, index: number): void => {
          if (word !== b[index]) {
            masks[left]![index] = Math.max(masks[left]![index]!, WordMask.Word);
            masks[right]![index] = Math.max(
              masks[right]![index]!,
              WordMask.Word,
            );
          }
        });
        continue;
      }

      let prefix: number = 0;

      while (
        prefix < a.length &&
        prefix < b.length &&
        a[prefix] === b[prefix]
      ) {
        prefix++;
      }

      let suffix: number = 0;

      while (
        suffix < a.length - prefix &&
        suffix < b.length - prefix &&
        a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
      ) {
        suffix++;
      }

      for (let index: number = prefix; index < a.length - suffix; index++) {
        masks[left]![index] = WordMask.Stretch;
      }

      for (let index: number = prefix; index < b.length - suffix; index++) {
        masks[right]![index] = WordMask.Stretch;
      }
    }
  }

  const aligned: Map<string, string> = new Map();

  distinct.forEach((template: string, index: number): void => {
    const parts: Array<string> = words[index]!;
    const mask: Array<WordMask> = masks[index]!;

    if (
      mask.every((each: WordMask): boolean => {
        return each === WordMask.Kept;
      })
    ) {
      aligned.set(template, template);
      return;
    }

    const kept: Array<string> = [];

    parts.forEach((word: string, at: number): void => {
      if (mask[at] === WordMask.Stretch) {
        // A stretch is one value, however many words it held.
        if (mask[at - 1] !== WordMask.Stretch) {
          kept.push(VALUE_PLACEHOLDER);
        }
        return;
      }

      kept.push(mask[at] === WordMask.Word ? maskWord(word) : word);
    });

    aligned.set(template, kept.join(" "));
  });

  return aligned;
}

// A word that differs between two reads of one line: a value, punctuation kept.
function maskWord(word: string): string {
  if (isPlaceholder(word)) {
    return word;
  }

  const lead: string = LEADING_PUNCTUATION.exec(word)?.[0] || "";
  const tail: string = TRAILING_PUNCTUATION.exec(word)?.[0] || "";

  return `${lead}${VALUE_PLACEHOLDER}${tail}`;
}
