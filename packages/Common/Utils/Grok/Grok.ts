import BadDataException from "../../Types/Exception/BadDataException";
import GrokPatterns from "./GrokPatterns";

/*
 * Grok engine.
 *
 * A grok pattern is a regex with named references into a pattern
 * library: `%{IPV4:client_ip} - %{WORD:verb}` means "the IPv4 regex,
 * captured as client_ip, then a literal ' - ', then a word captured as
 * verb". Anything that is not a `%{...}` reference is passed through to
 * the regex verbatim, so raw regex and grok references can be mixed.
 *
 * Supported reference forms:
 *
 *   %{NAME}              match, capture nothing
 *   %{NAME:field}        capture into `field` as a string
 *   %{NAME:field:type}   capture into `field`, coerced (int/float/boolean)
 *
 * Compilation expands references recursively into one JavaScript RegExp
 * and records, for each captured field, the internal group name that
 * holds it. Only the groups this engine injects capture — every library
 * definition uses `(?:...)` — so extraction is a `match.groups` lookup
 * with no index arithmetic.
 *
 * Matching is deliberately UNANCHORED, like Logstash: a pattern
 * describes a fragment of the line unless the author anchors it with
 * `^`/`$` themselves.
 *
 * This runs once per ingested log record on the telemetry hot path
 * against text the customer's users control, so the compiler enforces
 * hard ceilings on expansion (depth, count, final source length) and
 * the matcher refuses inputs above MAX_GROK_INPUT_LENGTH rather than
 * handing an unbounded string to a backtracking engine.
 */

export enum GrokFieldType {
  String = "string",
  Integer = "integer",
  Float = "float",
  Boolean = "boolean",
}

export type GrokValue = string | number | boolean;

export interface GrokCapture {
  /** Internal RegExp group name, e.g. "oug0". Never surfaced to users. */
  groupName: string;
  /** Attribute name the user asked for, e.g. "client_ip". */
  fieldName: string;
  fieldType: GrokFieldType;
}

export interface CompiledGrokPattern {
  regex: RegExp;
  captures: Array<GrokCapture>;
  /** Expanded regex source. Useful for debugging and for the UI tester. */
  source: string;
}

/** Longest raw pattern a user may save. */
export const MAX_GROK_PATTERN_LENGTH: number = 4000;

/** Longest expanded regex source a pattern may compile to. */
export const MAX_GROK_SOURCE_LENGTH: number = 20000;

/** How deep `%{A}` -> `%{B}` -> `%{C}` nesting may go. */
export const MAX_GROK_EXPANSION_DEPTH: number = 20;

/** Total number of references expanded while compiling one pattern. */
export const MAX_GROK_EXPANSIONS: number = 500;

/** Fields one pattern may capture. */
export const MAX_GROK_CAPTURES: number = 100;

/*
 * Inputs longer than this are not parsed. A backtracking regex cannot be
 * interrupted once started, so the only bound available on the ingest
 * hot path is the length of what we feed it.
 */
export const MAX_GROK_INPUT_LENGTH: number = 32768;

/*
 * `%{NAME}`, `%{NAME:field}` or `%{NAME:field:type}`. The field and type
 * segments exclude `{`, `}` and `:` so a malformed reference fails to
 * match here and is reported as unparsable rather than being silently
 * split at the wrong colon.
 */
const GROK_REFERENCE_SOURCE: string =
  "%\\{([A-Za-z0-9_]+)(?::([^:{}]*))?(?::([^:{}]*))?\\}";

/*
 * Field names become log attribute keys. Dots are allowed because OTel
 * semantic-convention keys use them (`http.request.method`).
 */
const FIELD_NAME_REGEX: RegExp = /^[A-Za-z_][A-Za-z0-9_.@-]*$/;

interface CompileContext {
  patterns: Record<string, string>;
  captures: Array<GrokCapture>;
  /** Names currently being expanded — used to reject circular references. */
  stack: Array<string>;
  expansions: number;
}

function parseFieldType(rawType: string | undefined): GrokFieldType {
  if (!rawType) {
    return GrokFieldType.String;
  }

  switch (rawType.trim().toLowerCase()) {
    case "int":
    case "integer":
    case "long":
      return GrokFieldType.Integer;
    case "float":
    case "double":
    case "number":
      return GrokFieldType.Float;
    case "bool":
    case "boolean":
      return GrokFieldType.Boolean;
    case "string":
    case "text":
      return GrokFieldType.String;
    default:
      throw new BadDataException(
        `Unknown grok field type "${rawType}". Supported types are: int, long, float, double, boolean, string.`,
      );
  }
}

function resolveReference(
  match: RegExpExecArray,
  context: CompileContext,
): string {
  const patternName: string = match[1] as string;
  const rawFieldName: string | undefined = match[2];
  const rawFieldType: string | undefined = match[3];

  context.expansions++;

  if (context.expansions > MAX_GROK_EXPANSIONS) {
    throw new BadDataException(
      `This grok pattern expands to more than ${MAX_GROK_EXPANSIONS} sub-patterns. Please simplify it.`,
    );
  }

  const definition: string | undefined = context.patterns[patternName];

  if (definition === undefined) {
    throw new BadDataException(
      `Unknown grok pattern "%{${patternName}}". Check the list of supported patterns.`,
    );
  }

  if (context.stack.includes(patternName)) {
    throw new BadDataException(
      `Grok pattern "%{${patternName}}" refers to itself. Circular pattern references are not supported.`,
    );
  }

  if (context.stack.length >= MAX_GROK_EXPANSION_DEPTH) {
    throw new BadDataException(
      `Grok pattern "%{${patternName}}" nests more than ${MAX_GROK_EXPANSION_DEPTH} levels deep. Please simplify it.`,
    );
  }

  context.stack.push(patternName);
  const expanded: string = expandPattern(definition, context);
  context.stack.pop();

  if (rawFieldName === undefined) {
    return `(?:${expanded})`;
  }

  const fieldName: string = rawFieldName.trim();

  if (!FIELD_NAME_REGEX.test(fieldName)) {
    throw new BadDataException(
      `"${rawFieldName}" is not a valid grok field name. Use letters, digits, and . _ - @ (starting with a letter or underscore).`,
    );
  }

  if (context.captures.length >= MAX_GROK_CAPTURES) {
    throw new BadDataException(
      `This grok pattern captures more than ${MAX_GROK_CAPTURES} fields. Please capture fewer fields.`,
    );
  }

  const groupName: string = `oug${context.captures.length}`;

  context.captures.push({
    groupName: groupName,
    fieldName: fieldName,
    fieldType: parseFieldType(rawFieldType),
  });

  return `(?<${groupName}>${expanded})`;
}

function expandPattern(source: string, context: CompileContext): string {
  /*
   * A fresh RegExp per call: `lastIndex` is per-object state and
   * expansion recurses, so a shared instance would have nested calls
   * stepping on each other's scan position.
   */
  const referenceRegex: RegExp = new RegExp(GROK_REFERENCE_SOURCE, "g");

  let output: string = "";
  let cursor: number = 0;
  let match: RegExpExecArray | null = referenceRegex.exec(source);

  while (match !== null) {
    output += source.slice(cursor, match.index);
    output += resolveReference(match, context);
    cursor = match.index + match[0].length;

    if (output.length > MAX_GROK_SOURCE_LENGTH) {
      throw new BadDataException(
        `This grok pattern expands to more than ${MAX_GROK_SOURCE_LENGTH} characters of regex. Please simplify it.`,
      );
    }

    match = referenceRegex.exec(source);
  }

  output += source.slice(cursor);

  return output;
}

/*
 * Compile a grok pattern. Throws BadDataException with a message meant
 * for the person who typed the pattern — this is what save-time
 * validation and the pattern tester in the dashboard show.
 */
export function compileGrokPattern(
  pattern: string,
  extraPatterns?: Record<string, string> | undefined,
): CompiledGrokPattern {
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    throw new BadDataException("Grok pattern cannot be empty.");
  }

  if (pattern.length > MAX_GROK_PATTERN_LENGTH) {
    throw new BadDataException(
      `Grok pattern cannot be longer than ${MAX_GROK_PATTERN_LENGTH} characters.`,
    );
  }

  const context: CompileContext = {
    patterns: extraPatterns
      ? { ...GrokPatterns, ...extraPatterns }
      : GrokPatterns,
    captures: [],
    stack: [],
    expansions: 0,
  };

  const source: string = expandPattern(pattern, context);

  if (source.length > MAX_GROK_SOURCE_LENGTH) {
    throw new BadDataException(
      `This grok pattern expands to more than ${MAX_GROK_SOURCE_LENGTH} characters of regex. Please simplify it.`,
    );
  }

  let regex: RegExp;

  try {
    /*
     * No `g`/`y` flag on purpose: those carry `lastIndex` between calls
     * and a compiled pattern is reused for every record.
     */
    regex = new RegExp(source);
  } catch (err) {
    throw new BadDataException(
      `This grok pattern is not valid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    regex: regex,
    captures: context.captures,
    source: source,
  };
}

function coerceValue(raw: string, fieldType: GrokFieldType): GrokValue {
  if (fieldType === GrokFieldType.Integer) {
    const parsed: number = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : raw;
  }

  if (fieldType === GrokFieldType.Float) {
    const parsed: number = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }

  if (fieldType === GrokFieldType.Boolean) {
    const normalized: string = raw.trim().toLowerCase();

    if (
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "y" ||
      normalized === "1"
    ) {
      return true;
    }

    if (
      normalized === "false" ||
      normalized === "no" ||
      normalized === "n" ||
      normalized === "0"
    ) {
      return false;
    }

    /*
     * Not recognisably a boolean — keep the raw text rather than
     * inventing a `false` the log never said.
     */
    return raw;
  }

  return raw;
}

/*
 * Run a compiled pattern against one string. Returns null when the
 * pattern does not match; returns the captured fields otherwise (which
 * is an empty object for a pattern that matches but captures nothing).
 *
 * Empty captures are dropped, matching Logstash's default
 * `keep_empty_captures => false`: an optional group that did not
 * participate should not write a blank attribute onto the log.
 */
export function matchGrokPattern(
  compiled: CompiledGrokPattern,
  input: string,
): Record<string, GrokValue> | null {
  if (typeof input !== "string" || input.length === 0) {
    return null;
  }

  if (input.length > MAX_GROK_INPUT_LENGTH) {
    return null;
  }

  const match: RegExpExecArray | null = compiled.regex.exec(input);

  if (!match) {
    return null;
  }

  const groups: Record<string, string | undefined> = match.groups || {};
  const extracted: Record<string, GrokValue> = {};

  for (const capture of compiled.captures) {
    const raw: string | undefined = groups[capture.groupName];

    if (raw === undefined || raw === "") {
      continue;
    }

    /*
     * The same field name can legitimately appear twice (alternation
     * branches, or a library pattern that already names it). Whichever
     * group actually matched first wins, so a later branch that did not
     * participate cannot blank out a real value.
     */
    if (extracted[capture.fieldName] !== undefined) {
      continue;
    }

    extracted[capture.fieldName] = coerceValue(raw, capture.fieldType);
  }

  return extracted;
}

/*
 * Process-wide compile cache for the ingest path.
 *
 * Compiling walks the pattern library and builds a RegExp; doing that
 * per log record would dominate the cost of the processor. Compiled
 * patterns are immutable and carry no `lastIndex` state (no `g` flag),
 * so one instance is safely shared by every project using the same
 * pattern text.
 *
 * Failures are cached too. An invalid pattern that reaches ingest would
 * otherwise be recompiled — and rejected — once per record.
 */
const compileCache: Map<string, CompiledGrokPattern | BadDataException> =
  new Map<string, CompiledGrokPattern | BadDataException>();

export const MAX_CACHED_GROK_PATTERNS: number = 500;

export function compileGrokPatternCached(pattern: string): CompiledGrokPattern {
  const cached: CompiledGrokPattern | BadDataException | undefined =
    compileCache.get(pattern);

  if (cached !== undefined) {
    if (cached instanceof BadDataException) {
      throw cached;
    }

    return cached;
  }

  let result: CompiledGrokPattern | BadDataException;

  try {
    result = compileGrokPattern(pattern);
  } catch (err) {
    result =
      err instanceof BadDataException ? err : new BadDataException(String(err));
  }

  if (compileCache.size >= MAX_CACHED_GROK_PATTERNS) {
    // Insertion-ordered: drop the oldest entry to bound the cache.
    const oldestKey: string | undefined = compileCache.keys().next().value;

    if (oldestKey !== undefined) {
      compileCache.delete(oldestKey);
    }
  }

  compileCache.set(pattern, result);

  if (result instanceof BadDataException) {
    throw result;
  }

  return result;
}

/** Test seam: forget every cached compilation. */
export function clearGrokCompileCache(): void {
  compileCache.clear();
}

/*
 * Compile + match in one call. Convenience for the dashboard's pattern
 * tester and for tests; ingest compiles once and reuses the result.
 */
export function parseWithGrokPattern(
  pattern: string,
  input: string,
): Record<string, GrokValue> | null {
  return matchGrokPattern(compileGrokPattern(pattern), input);
}

export default {
  compileGrokPattern,
  compileGrokPatternCached,
  matchGrokPattern,
  parseWithGrokPattern,
};
