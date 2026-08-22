import fs from "fs";
import path from "path";

/*
 * Shared source-reading helpers for the route-reservation tests.
 *
 * The prefix arrays in FeatureSet/Frontend/Index.ts are module-private, so
 * the tests around them read the source rather than importing it. Reading
 * source means the parsing has to be exact, and two traps have already been
 * hit here:
 *
 *   1. This codebase's house style is to precede a reserved prefix with a
 *      comment that quotes OTHER paths, so a regex that scrapes every quoted
 *      string out of an array literal also picks up comment prose. That is
 *      not cosmetic - it lets an edit that deletes a reservation but leaves
 *      a comment mentioning it keep the suite green, which is the one edit
 *      these tests exist to catch. Comments are stripped before entries are
 *      read, so prose can never contribute an entry.
 *
 *   2. The lists now share their ingest entries through a spread
 *      (`...IngestRoutePrefixesToSkip`), so a parser that only understands
 *      string literals would silently report a list as missing exactly the
 *      prefixes it does reserve.
 *
 * Anything these helpers cannot account for throws rather than returning a
 * partial answer. A loud failure on an unrecognised entry shape is the safe
 * direction: the alternative is a test that quietly checks less than it
 * claims to.
 */

export const APP_DIR: string = path.join(__dirname, "..", "..");
export const REPO_ROOT: string = path.join(APP_DIR, "..");

export function readSource(...segments: Array<string>): string {
  return fs.readFileSync(path.join(...segments), "utf8");
}

/*
 * A registration inside a block comment, or commented out, is not a
 * registration - so comments come out before any of the matching below.
 *
 * This is a scanner rather than a pair of regexes because a regex cannot
 * tell a comment from the same characters inside a string. Frontend/Index.ts
 * really does contain
 *
 *     [frontendConfig.routePrefix, `${frontendConfig.routePrefix}/*`],
 *
 * and a plain /\/\*[\s\S]*?\*\//g treats that "/*" as the start of a comment
 * and deletes everything up to the next "*\/" - roughly 1,400 characters,
 * including the whole registerCustomDomainFallback declaration. Nothing
 * throws; the affected assertions just quietly stop seeing the code they are
 * meant to be checking. Quotes, apostrophes and template literals are
 * therefore tracked, and only comments found outside them are removed.
 */
export function stripComments(source: string): string {
  let output: string = "";
  let index: number = 0;

  while (index < source.length) {
    const character: string = source[index] as string;
    const next: string | undefined = source[index + 1];

    // Escapes are copied verbatim so "\\" cannot fake a quote.
    if (character === "\\" && index + 1 < source.length) {
      output += character + (next as string);
      index += 2;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      const quote: string = character;
      output += character;
      index++;

      while (index < source.length) {
        const inner: string = source[index] as string;

        if (inner === "\\" && index + 1 < source.length) {
          output += inner + (source[index + 1] as string);
          index += 2;
          continue;
        }

        output += inner;
        index++;

        if (inner === quote) {
          break;
        }
      }

      continue;
    }

    if (character === "/" && next === "*") {
      const close: number = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      continue;
    }

    if (character === "/" && next === "/") {
      const lineEnd: number = source.indexOf("\n", index);
      index = lineEnd < 0 ? source.length : lineEnd;
      continue;
    }

    output += character;
    index++;
  }

  return output;
}

/*
 * The body of `const <name>: Array<string> = [ ... ];`, found by balancing
 * brackets rather than by matching a closing "\n];" - single-line arrays
 * such as TELEMETRY_PREFIXES have no such line, and a lazy regex would run
 * past them into the next declaration.
 */
function arrayBody(source: string, name: string): string | null {
  const opening: RegExpMatchArray | null = source.match(
    new RegExp(`const ${name}: Array<string> = \\[`),
  );

  if (!opening || opening.index === undefined) {
    return null;
  }

  const start: number = opening.index + opening[0].length;
  let depth: number = 1;
  let index: number = start;

  while (index < source.length && depth > 0) {
    const character: string | undefined = source[index];

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;
    }

    index++;
  }

  if (depth !== 0) {
    throw new Error(`Unbalanced brackets in array literal "${name}".`);
  }

  return source.slice(start, index - 1);
}

/* Split on commas that are not nested inside brackets, braces or parens. */
function splitTopLevel(body: string): Array<string> {
  const elements: Array<string> = [];
  let depth: number = 0;
  let current: string = "";

  for (const character of body) {
    if (character === "[" || character === "{" || character === "(") {
      depth++;
    } else if (character === "]" || character === "}" || character === ")") {
      depth--;
    }

    if (character === "," && depth === 0) {
      elements.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  elements.push(current);

  return elements;
}

/*
 * Entries of an `Array<string>` declaration, with `...Other` spreads
 * resolved against declarations in the same source.
 */
export function arrayEntries(
  source: string,
  name: string,
  seen: Array<string> = [],
): Array<string> {
  /*
   * Comments come out before the brackets are balanced, not after: prose is
   * free to contain a stray "[", and it must not be able to shift where the
   * parser thinks the literal ends.
   */
  const code: string = stripComments(source);
  const body: string | null = arrayBody(code, name);

  if (body === null) {
    return [];
  }

  if (seen.includes(name)) {
    throw new Error(`Circular spread while resolving "${name}".`);
  }

  const entries: Array<string> = [];

  for (const element of splitTopLevel(body)) {
    const trimmed: string = element.trim();

    if (!trimmed) {
      continue;
    }

    const literal: RegExpMatchArray | null = trimmed.match(/^"([^"]+)"$/);

    if (literal && literal[1]) {
      entries.push(literal[1]);
      continue;
    }

    const spread: RegExpMatchArray | null = trimmed.match(/^\.\.\.(\w+)$/);

    if (spread && spread[1]) {
      const resolved: Array<string> = arrayEntries(source, spread[1], [
        ...seen,
        name,
      ]);

      if (resolved.length === 0) {
        throw new Error(
          `Spread "...${spread[1]}" in "${name}" resolved to nothing.`,
        );
      }

      entries.push(...resolved);
      continue;
    }

    throw new Error(
      `Unrecognised entry ${JSON.stringify(trimmed)} in "${name}". ` +
        `Entries must be a plain string literal or a spread of another ` +
        `Array<string> in the same file, so that these tests can read them.`,
    );
  }

  return entries;
}

/*
 * Mirrors shouldSkipDashboardFallbackRoute /
 * shouldSkipStatusPageDomainFallbackRoute in FeatureSet/Frontend/Index.ts.
 */
export function isReserved(
  prefixes: Array<string>,
  requestPath: string,
): boolean {
  return prefixes.some((prefix: string) => {
    return requestPath === prefix || requestPath.startsWith(`${prefix}/`);
  });
}
