import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../Types/DataSecurity/DataTypeCatalog";

/*
 * WHAT A FIELD'S NAME SAYS IT HOLDS.
 *
 * Column, key and attribute names are the cheapest evidence a scan has:
 * `customer_email`, `dateOfBirth` and `http.request.header.authorization`
 * say what they hold before a single value is read. A name is split into
 * lower-case words - at every character that is not a letter or digit, at
 * every lower-to-upper case change (`dateOfBirth`), at every run of capitals
 * followed by a word (`SSNNumber` -> ssn, number) and between letters and
 * digits - and a type's hint matches when the hint's words appear in that
 * order, next to each other.
 *
 * Only the last segment of a dotted path is read as the field's own name, so
 * `customer.address.city` is not a street address because of `address`;
 * the segment before it is read too, so `card.number` still hints a card
 * number.
 */

// The most words of a name read: a field name is never a paragraph.
const MAX_NAME_WORDS: number = 32;

export function splitFieldName(name: string): Array<string> {
  const words: Array<string> = [];
  let current: string = "";
  let previousKind: "lower" | "upper" | "digit" | "other" = "other";

  const flush: () => void = (): void => {
    if (current.length > 0 && words.length < MAX_NAME_WORDS) {
      words.push(current.toLowerCase());
    }

    current = "";
  };

  const bounded: string = name.slice(0, 256);

  for (let index: number = 0; index < bounded.length; index++) {
    const character: string = bounded[index]!;
    const code: number = bounded.charCodeAt(index);
    let kind: "lower" | "upper" | "digit" | "other" = "other";

    if (code >= 97 && code <= 122) {
      kind = "lower";
    } else if (code >= 65 && code <= 90) {
      kind = "upper";
    } else if (code >= 48 && code <= 57) {
      kind = "digit";
    }

    if (kind === "other") {
      flush();
      previousKind = kind;
      continue;
    }

    if (current.length > 0) {
      const lowerToUpper: boolean =
        previousKind === "lower" && kind === "upper";
      const letterToDigit: boolean =
        (previousKind === "digit") !== (kind === "digit");
      /*
       * The last capital of a run that a lower-case letter follows starts
       * the next word: "SSNNumber" is "SSN" then "Number".
       */
      const nextCode: number = bounded.charCodeAt(index + 1);
      const capitalRunEnds: boolean =
        previousKind === "upper" &&
        kind === "upper" &&
        nextCode >= 97 &&
        nextCode <= 122;

      if (lowerToUpper || letterToDigit || capitalRunEnds) {
        flush();
      }
    }

    current += character;
    previousKind = kind;
  }

  flush();

  return words;
}

// Whether `hintWords` appear in `words` in order and next to each other.
export function containsWordRun(
  words: ReadonlyArray<string>,
  hintWords: ReadonlyArray<string>,
): boolean {
  if (hintWords.length === 0 || hintWords.length > words.length) {
    return false;
  }

  for (
    let start: number = 0;
    start + hintWords.length <= words.length;
    start++
  ) {
    let matched: boolean = true;

    for (let offset: number = 0; offset < hintWords.length; offset++) {
      if (words[start + offset] !== hintWords[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return true;
    }
  }

  return false;
}

interface CompiledHint {
  dataTypeId: string;
  words: ReadonlyArray<string>;
}

let compiledHints: Array<CompiledHint> | null = null;

function getCompiledHints(): Array<CompiledHint> {
  if (!compiledHints) {
    compiledHints = [];

    for (const info of DATA_TYPE_CATALOG) {
      for (const hint of info.nameHints) {
        compiledHints.push({
          dataTypeId: info.id,
          words: hint.split(" "),
        });
      }
    }
  }

  return compiledHints;
}

/*
 * The words a field's name is read as: those of its last path segment, and
 * of the one before it when the last is a generic word ("number", "value",
 * "id") that needs its parent to mean anything.
 */
const GENERIC_LAST_SEGMENTS: ReadonlySet<string> = new Set([
  "number",
  "no",
  "num",
  "value",
  "id",
  "code",
  "key",
  "token",
  "data",
]);

// What separates a path's segments, and a segment that is an array index.
const PATH_SEPARATOR: RegExp = /[.[\]/]/;
const ARRAY_INDEX: RegExp = /^\d{1,9}$/;

export function getFieldNameWords(fieldPath: string): Array<string> {
  const segments: Array<string> = fieldPath
    .slice(0, 1024)
    .split(PATH_SEPARATOR)
    .filter((segment: string) => {
      return segment.length > 0 && !ARRAY_INDEX.test(segment);
    });

  if (segments.length === 0) {
    return [];
  }

  const last: Array<string> = splitFieldName(segments[segments.length - 1]!);

  if (
    segments.length > 1 &&
    last.length === 1 &&
    GENERIC_LAST_SEGMENTS.has(last[0]!)
  ) {
    return [...splitFieldName(segments[segments.length - 2]!), ...last];
  }

  return last;
}

/*
 * The data types a field's name hints at, for the built-in catalog and any
 * extra hints a project's custom data types carry.
 */
export function getHintedDataTypeIds(
  fieldPath: string,
  extraHints: ReadonlyArray<{
    dataTypeId: string;
    hints: ReadonlyArray<string>;
  }> = [],
): Set<string> {
  const hinted: Set<string> = new Set();

  if (!fieldPath) {
    return hinted;
  }

  const words: Array<string> = getFieldNameWords(fieldPath);

  if (words.length === 0) {
    return hinted;
  }

  for (const hint of getCompiledHints()) {
    if (containsWordRun(words, hint.words)) {
      hinted.add(hint.dataTypeId);
    }
  }

  for (const extra of extraHints) {
    for (const hint of extra.hints) {
      const hintWords: Array<string> = splitFieldName(hint);

      if (containsWordRun(words, hintWords)) {
        hinted.add(extra.dataTypeId);
        break;
      }
    }
  }

  return hinted;
}

// The built-in types found from names only, which no value can confirm.
export function getNameOnlyDataTypes(): Array<DataTypeInfo> {
  return DATA_TYPE_CATALOG.filter((info: DataTypeInfo) => {
    return info.foundBy === "name";
  });
}
