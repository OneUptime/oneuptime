import { JSONObject, JSONValue } from "../../../../Types/JSON";
import SigmaRule, {
  SigmaConditionNode,
  SigmaFieldRequirement,
  SigmaSelection,
} from "../../../../Types/SecurityEvent/SigmaRule";
import CidrMatchUtil from "../../../../Utils/NetworkSite/CidrMatchUtil";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { isSigmaWatchlistRequirement } from "../../../../Utils/SecurityEvent/Sigma/SigmaWatchlists";
import { resolveSigmaField } from "../Sigma/SigmaClickhouseCompiler";

/*
 * THE REAL-TIME SCREEN: whether an event, as ingest just wrote it, may
 * match a real-time detection rule - before any query is made.
 *
 * It reads the event's row (buildSecurityEventDbRow) the way the engine's
 * query reads the table (SigmaClickhouseCompiler: resolveSigmaField, text
 * whatever its case, Sigma's * and ? wildcards, cidr, the comparisons,
 * exists and null), and answers in three values:
 *
 *  - "no": the query cannot match it. Only said where the screen reads the
 *    event exactly as the database would: plain ASCII text, an IPv4
 *    address against an IPv4 range, a number written as one.
 *  - "yes": the query matches it, as far as the rule's own detection goes.
 *  - "maybe": anything the screen cannot be sure of - letters outside
 *    ASCII, which the database folds by its own rules; a watchlist; a
 *    regular expression; an attribute that is not text; a value longer
 *    than the screen reads.
 *
 * "yes" and "maybe" are candidates, which the engine then confirms with the
 * rule's own query (exceptions and watchlists included), restricted to
 * them: so the screen may let through more than matches, never less. It
 * is linear in the event's text - indexOf, startsWith, and a wildcard
 * matcher that never backtracks past its last star - and reads at most
 * REAL_TIME_SCREEN_TEXT_LIMIT characters of a value, so an attacker's
 * megabyte of text costs it nothing it cannot afford.
 */

export type ScreenVerdict = "yes" | "no" | "maybe";

// The longest text the screen reads; a longer value is the database's to decide.
export const REAL_TIME_SCREEN_TEXT_LIMIT: number = 65536;

// Plain ASCII, which every lowercasing agrees on.
const ASCII_TEXT: RegExp = /^[\x20-\x7e\t\r\n]*$/;

// A number as text, the way a comparison reads one for certain.
const PLAIN_NUMBER: RegExp = /^-?\d{1,15}(?:\.\d{1,15})?$/;

const IPV4_ADDRESS: RegExp = /^\d{1,3}(?:\.\d{1,3}){3}$/;

type FieldValue =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "array"; value: Array<string> }
  | { kind: "attribute"; present: boolean; value: JSONValue | undefined };

function and(verdicts: Array<ScreenVerdict>): ScreenVerdict {
  if (verdicts.includes("no")) {
    return "no";
  }

  return verdicts.every((verdict: ScreenVerdict): boolean => {
    return verdict === "yes";
  })
    ? "yes"
    : "maybe";
}

function or(verdicts: Array<ScreenVerdict>): ScreenVerdict {
  if (verdicts.includes("yes")) {
    return "yes";
  }

  return verdicts.every((verdict: ScreenVerdict): boolean => {
    return verdict === "no";
  })
    ? "no"
    : "maybe";
}

function not(verdict: ScreenVerdict): ScreenVerdict {
  return verdict === "yes" ? "no" : verdict === "no" ? "yes" : "maybe";
}

function isAscii(text: string): boolean {
  return ASCII_TEXT.test(text);
}

function readField(row: JSONObject, field: string): FieldValue {
  const resolved: ReturnType<typeof resolveSigmaField> =
    resolveSigmaField(field);

  if (resolved.kind === "attribute") {
    const attributes: JSONValue | undefined = row["attributes"];
    const map: JSONObject =
      attributes && typeof attributes === "object" && !Array.isArray(attributes)
        ? (attributes as JSONObject)
        : {};
    const present: boolean = Object.prototype.hasOwnProperty.call(
      map,
      resolved.attributeKey,
    );

    return {
      kind: "attribute",
      present,
      value: present ? map[resolved.attributeKey] : undefined,
    };
  }

  const value: JSONValue | undefined = row[resolved.column];

  if (resolved.kind === "numberColumn") {
    return { kind: "number", value: typeof value === "number" ? value : 0 };
  }

  if (resolved.kind === "arrayColumn") {
    return {
      kind: "array",
      value: Array.isArray(value)
        ? value.map((item: JSONValue): string => {
            return String(item);
          })
        : [],
    };
  }

  return { kind: "text", value: typeof value === "string" ? value : "" };
}

/*
 * The field as the query's string operators read it: text as it is, a
 * number column as its digits, an absent attribute as ''. Undefined for an
 * attribute that is not text: how it was written down is the database's.
 */
function asText(field: FieldValue): string | undefined {
  switch (field.kind) {
    case "text":
      return field.value;
    case "number":
      return String(field.value);
    case "attribute":
      if (!field.present) {
        return "";
      }
      return typeof field.value === "string" ? field.value : undefined;
    default:
      return undefined;
  }
}

/*
 * A Sigma value as pieces: literal text, `*` (any run) and `?` (one
 * character), with `\` escaping the character after it - as
 * sigmaPatternToLike reads it.
 */
type PatternPiece = { kind: "text"; text: string } | { kind: "any" } | { kind: "one" };

export function readSigmaPattern(value: string): Array<PatternPiece> {
  const pieces: Array<PatternPiece> = [];
  let text: string = "";

  const flush: () => void = (): void => {
    if (text) {
      pieces.push({ kind: "text", text });
      text = "";
    }
  };

  for (let index: number = 0; index < value.length; index++) {
    const char: string = value[index]!;

    if (char === "\\" && index + 1 < value.length) {
      text += value[index + 1]!;
      index++;
      continue;
    }

    if (char === "*" || char === "?") {
      flush();
      pieces.push(char === "*" ? { kind: "any" } : { kind: "one" });
      continue;
    }

    text += char;
  }

  flush();

  return pieces;
}

/*
 * Whether `text` is wholly the pattern: the classic two-pointer wildcard
 * match, which on a mismatch goes back only to just after the last `*` it
 * passed - never further - so it takes at most text x pattern steps, and
 * the text is held to REAL_TIME_SCREEN_TEXT_LIMIT.
 */
export function matchesWildcard(
  text: string,
  pieces: Array<PatternPiece>,
): boolean {
  // One character per position: literal pieces are spread into characters.
  const pattern: Array<string | null | undefined> = [];

  for (const piece of pieces) {
    if (piece.kind === "text") {
      for (const char of piece.text) {
        pattern.push(char);
      }
    } else {
      // null: any run; undefined: exactly one character.
      pattern.push(piece.kind === "any" ? null : undefined);
    }
  }

  const characters: Array<string> = Array.from(text);
  let textIndex: number = 0;
  let patternIndex: number = 0;
  let starIndex: number = -1;
  let starTextIndex: number = 0;

  while (textIndex < characters.length) {
    const want: string | null | undefined = pattern[patternIndex];

    if (
      patternIndex < pattern.length &&
      want !== null &&
      (want === undefined || want === characters[textIndex])
    ) {
      textIndex++;
      patternIndex++;
    } else if (patternIndex < pattern.length && want === null) {
      starIndex = patternIndex;
      starTextIndex = textIndex;
      patternIndex++;
    } else if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      starTextIndex++;
      textIndex = starTextIndex;
    } else {
      return false;
    }
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === null) {
    patternIndex++;
  }

  return patternIndex === pattern.length;
}

// One string value against the field, as the compiler's LIKE / ILIKE / = would read it.
function screenText(data: {
  field: FieldValue;
  value: string;
  modifiers: Array<string>;
}): ScreenVerdict {
  const actual: string | undefined = asText(data.field);

  if (actual === undefined || actual.length > REAL_TIME_SCREEN_TEXT_LIMIT) {
    return "maybe";
  }

  const isCased: boolean = data.modifiers.includes("cased");

  // Lowercasing letters outside ASCII is the database's.
  if (!isCased && (!isAscii(actual) || !isAscii(data.value))) {
    return "maybe";
  }

  const fold: (text: string) => string = (text: string): string => {
    return isCased ? text : text.toLowerCase();
  };

  const pieces: Array<PatternPiece> = readSigmaPattern(data.value);
  const anyRun: PatternPiece = { kind: "any" };

  // What one `?` stands for in text outside ASCII is the database's too.
  if (
    !isAscii(actual) &&
    pieces.some((piece: PatternPiece): boolean => {
      return piece.kind === "one";
    })
  ) {
    return "maybe";
  }

  let wanted: Array<PatternPiece> = pieces;

  if (data.modifiers.includes("contains")) {
    wanted = [anyRun, ...pieces, anyRun];
  } else if (data.modifiers.includes("startswith")) {
    wanted = [...pieces, anyRun];
  } else if (data.modifiers.includes("endswith")) {
    wanted = [anyRun, ...pieces];
  }

  const folded: Array<PatternPiece> = wanted.map(
    (piece: PatternPiece): PatternPiece => {
      return piece.kind === "text"
        ? { kind: "text", text: fold(piece.text) }
        : piece;
    },
  );
  const text: string = fold(actual);

  // The common shapes, by the string methods: a plain value, contains, starts, ends.
  const literal: Array<string> = folded
    .filter((piece: PatternPiece): boolean => {
      return piece.kind === "text";
    })
    .map((piece: PatternPiece): string => {
      return (piece as { text: string }).text;
    });
  const shape: string = folded
    .map((piece: PatternPiece): string => {
      return piece.kind === "text" ? "t" : piece.kind === "any" ? "*" : "?";
    })
    .join("");

  switch (shape) {
    case "":
      return text === "" ? "yes" : "no";
    case "t":
      return text === literal[0] ? "yes" : "no";
    case "*t*":
      return text.includes(literal[0]!) ? "yes" : "no";
    case "t*":
      return text.startsWith(literal[0]!) ? "yes" : "no";
    case "*t":
      return text.endsWith(literal[0]!) ? "yes" : "no";
    default:
      return matchesWildcard(text, folded) ? "yes" : "no";
  }
}

function screenComparison(
  field: FieldValue,
  operator: string,
  value: JSONValue,
): ScreenVerdict {
  const wanted: number = Number(value);

  if (!Number.isFinite(wanted)) {
    // The rule cannot be saved this way; the database is the judge.
    return "maybe";
  }

  let actual: number | null = null;

  if (field.kind === "number") {
    actual = field.value;
  } else {
    const text: string | undefined = asText(field);

    if (text === undefined) {
      return "maybe";
    }

    if (!PLAIN_NUMBER.test(text)) {
      // Empty is no number at all: toFloat64OrNull is NULL, and NULL compares as false.
      return text === "" ? "no" : "maybe";
    }

    actual = Number(text);
  }

  const holds: boolean =
    operator === "gt"
      ? actual > wanted
      : operator === "gte"
        ? actual >= wanted
        : operator === "lt"
          ? actual < wanted
          : actual <= wanted;

  return holds ? "yes" : "no";
}

function screenValue(
  field: FieldValue,
  requirement: SigmaFieldRequirement,
  value: JSONValue,
): ScreenVerdict {
  const modifiers: Array<string> = requirement.modifiers;

  // null: the field is absent (empty, or no such attribute).
  if (value === null) {
    switch (field.kind) {
      case "attribute":
        return field.present ? "no" : "yes";
      case "number":
        return field.value === 0 ? "yes" : "no";
      case "text":
        return field.value === "" ? "yes" : "no";
      default:
        return "maybe";
    }
  }

  if (modifiers.includes("exists")) {
    const wantsExists: boolean = value === true || value === "true";

    if (field.kind === "attribute") {
      return field.present === wantsExists ? "yes" : "no";
    }

    const text: string | undefined = asText(field);

    if (text === undefined) {
      return "maybe";
    }

    return (text !== "") === wantsExists ? "yes" : "no";
  }

  // Regular expressions are the database's: RE2, never this process's engine.
  if (modifiers.includes("re")) {
    return "maybe";
  }

  if (modifiers.includes("cidr")) {
    const text: string | undefined = asText(field);
    const range: string = String(value);

    if (
      text === undefined ||
      !CidrMatchUtil.isValidCidr(range) ||
      (text !== "" && !IPV4_ADDRESS.test(text))
    ) {
      return "maybe";
    }

    // No address in the field: no match, as the query's guard reads it.
    return text !== "" && CidrMatchUtil.ipInCidr(text, range) ? "yes" : "no";
  }

  for (const operator of ["gt", "gte", "lt", "lte"]) {
    if (modifiers.includes(operator)) {
      return screenComparison(field, operator, value);
    }
  }

  if (field.kind === "array") {
    if (modifiers.includes("contains")) {
      return or(
        field.value.map((item: string): ScreenVerdict => {
          return screenText({
            field: { kind: "text", value: item },
            value: String(value),
            modifiers: ["contains"],
          });
        }),
      );
    }

    // Membership is exact.
    return field.value.includes(String(value)) ? "yes" : "no";
  }

  // A number column against a number: equality of numbers.
  if (
    field.kind === "number" &&
    typeof value === "number" &&
    !modifiers.includes("contains") &&
    !modifiers.includes("startswith") &&
    !modifiers.includes("endswith")
  ) {
    return field.value === value ? "yes" : "no";
  }

  return screenText({ field, value: String(value), modifiers });
}

function screenRequirement(
  row: JSONObject,
  requirement: SigmaFieldRequirement,
): ScreenVerdict {
  // A watchlist is the project's, read by the query: never here.
  if (isSigmaWatchlistRequirement(requirement)) {
    return "maybe";
  }

  const field: FieldValue = readField(row, requirement.field);
  let values: Array<JSONValue> = requirement.values;

  // windash: both spellings of a Windows flag, as the compiler expands them.
  if (requirement.modifiers.includes("windash")) {
    const expanded: Array<JSONValue> = [];

    for (const value of values) {
      const text: string = String(value);
      expanded.push(text);

      if (text.includes("-")) {
        expanded.push(text.split("-").join("/"));
      }
    }

    values = expanded;
  }

  const verdicts: Array<ScreenVerdict> = values.map(
    (value: JSONValue): ScreenVerdict => {
      return screenValue(field, requirement, value);
    },
  );

  return requirement.modifiers.includes("all") ? and(verdicts) : or(verdicts);
}

function screenSelection(
  row: JSONObject,
  selection: SigmaSelection,
): ScreenVerdict {
  // Keywords match the message, any of them; a selection of keywords has no field maps.
  if (selection.keywords.length > 0) {
    const message: FieldValue = readField(row, "message");

    return or(
      selection.keywords.map((keyword: string): ScreenVerdict => {
        return screenText({
          field: message,
          value: keyword,
          modifiers: ["contains"],
        });
      }),
    );
  }

  // Field maps OR together; fields inside one map AND together.
  return or(
    selection.fieldMaps.map(
      (requirements: Array<SigmaFieldRequirement>): ScreenVerdict => {
        return and(
          requirements.map((requirement: SigmaFieldRequirement) => {
            return screenRequirement(row, requirement);
          }),
        );
      },
    ),
  );
}

function screenNode(
  row: JSONObject,
  rule: SigmaRule,
  node: SigmaConditionNode,
): ScreenVerdict {
  switch (node.kind) {
    case "selection": {
      const selection: SigmaSelection | undefined = rule.selections.find(
        (candidate: SigmaSelection): boolean => {
          return candidate.name === node.name;
        },
      );

      return selection ? screenSelection(row, selection) : "maybe";
    }
    case "and":
      return and(
        node.children.map((child: SigmaConditionNode): ScreenVerdict => {
          return screenNode(row, rule, child);
        }),
      );
    case "or":
      return or(
        node.children.map((child: SigmaConditionNode): ScreenVerdict => {
          return screenNode(row, rule, child);
        }),
      );
    case "not":
      return not(screenNode(row, rule, node.child));
    case "of": {
      const verdicts: Array<ScreenVerdict> = SigmaRuleParser.matchSelectionNames(
        node.pattern,
        rule.selections.map((selection: SigmaSelection): string => {
          return selection.name;
        }),
      ).map((name: string): ScreenVerdict => {
        return screenNode(row, rule, { kind: "selection", name });
      });

      if (verdicts.length === 0) {
        return "maybe";
      }

      if (node.quantifier === "any") {
        return or(verdicts);
      }

      if (node.quantifier === "all") {
        return and(verdicts);
      }

      const needed: number = node.quantifier;
      const yes: number = verdicts.filter((verdict: ScreenVerdict): boolean => {
        return verdict === "yes";
      }).length;
      const maybe: number = verdicts.filter(
        (verdict: ScreenVerdict): boolean => {
          return verdict === "maybe";
        },
      ).length;

      if (yes >= needed) {
        return "yes";
      }

      return yes + maybe < needed ? "no" : "maybe";
    }
    default:
      return "maybe";
  }
}

/*
 * Whether the event (its row, as ingest wrote it) may match the rule's
 * detection. Anything the screen does not know how to read is "maybe".
 */
export function screenSecurityEventRow(
  rule: SigmaRule,
  row: JSONObject,
): ScreenVerdict {
  try {
    return screenNode(row, rule, rule.condition);
  } catch {
    return "maybe";
  }
}
