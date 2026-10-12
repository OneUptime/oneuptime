import { describe, expect, test } from "@jest/globals";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import {
  escapeWildcards,
  hasWildcard,
  toLikePattern,
  unescapeWildcards,
} from "../../../Types/BaseDatabase/WildcardPattern";
import { JSONObject } from "../../../Types/JSON";
import queryStringToFilter, {
  LogFilter,
} from "../../../Types/Log/LogQueryToFilter";
import { buildSearchTokenForOperatorValue } from "../../../Utils/Telemetry/LockedFilterSearch";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * A LOCKED FILTER'S GLOBS, COPIED INTO THE LOGS EXPLORER'S SEARCH BAR.
 *
 * A resource page pins attribute filters a person set up with an operator -
 * "matches", "does not match", "starts with", "ends with" - and offers each
 * as search syntax to paste into the logs explorer. A glob keeps its own
 * escapes ("\*" a literal star, "\"" a literal quote) and wildcards there,
 * and is written with the search grammar's buildSearchTokenGlob. The chip
 * used to escape its quotes only: a glob holding an escaped quote, or ending
 * in a literal backslash with a space in it, gave a token whose closing
 * quote was escaped, and the token ran on into the filters pasted after it.
 *
 * Each case is pasted with another filter after it and compiled by the logs
 * explorer: the glob means what the filter meant, and the filter after it
 * still applies.
 */

const KEY: string = "k8s.ns";
const AFTER: string = "severity:error";

/*
 * What a glob means: the LIKE pattern it compiles to when it has a
 * wildcard, otherwise the literal text its escapes stand for.
 */
function globMeaning(glob: string): [string, string] {
  return hasWildcard(glob)
    ? ["pattern", toLikePattern(glob)]
    : ["text", unescapeWildcards(glob)];
}

// What the logs explorer compiled for KEY, read as a meaning.
function compiledMeaning(compiled: unknown): [string, string] | null {
  if (typeof compiled === "string") {
    return ["text", compiled];
  }

  // A negated glob with no wildcard is "not equal" to its text.
  if (compiled instanceof NotEqual) {
    return ["text", String(compiled.value)];
  }

  if (compiled instanceof Wildcard || compiled instanceof NotWildcard) {
    const globs: Array<string> = (
      (compiled as { toJSON: () => JSONObject }).toJSON()["value"] as Array<string>
    ).slice();

    return globs.length === 1 ? ["pattern", toLikePattern(globs[0]!)] : null;
  }

  return null;
}

function pasted(token: string): LogFilter {
  return queryStringToFilter(`${token} ${AFTER}`);
}

describe("a locked filter's glob, pasted with another filter after it", () => {
  test.each([
    ["an escaped quote", 'a\\"b c*'],
    ["a quote", 'say "hi"*'],
    ["a literal backslash at the end, with a space", "a b\\"],
    ["a literal backslash at the end", "*.log\\"],
    ["an escaped star", "a\\*b*"],
    ["a bracket left open", "f(*"],
    ["a bracket pair", "(x)*"],
    ["a colon at the end", "http*:"],
  ])("%s means what it meant", (_name: string, glob: string) => {
    for (const [value, negated] of [
      [new Wildcard([glob]), false],
      [new NotWildcard([glob]), true],
    ] as Array<[Wildcard<string> | NotWildcard<string>, boolean]>) {
      const token: string | null = buildSearchTokenForOperatorValue(
        KEY,
        value,
      );

      expect(token).not.toBeNull();

      const filter: LogFilter = pasted(token as string);

      expect([glob, filter.severityText]).toEqual([glob, "Error"]);
      expect([glob, compiledMeaning(filter.attributes?.[KEY])]).toEqual([
        glob,
        globMeaning(glob),
      ]);

      if (hasWildcard(glob)) {
        expect([glob, (filter.attributes?.[KEY] as object).constructor]).toEqual(
          [glob, negated ? NotWildcard : Wildcard],
        );
      }
    }
  });

  test.each([
    ["a quote", 'say "hi'],
    ["a backslash", "C:\\Temp\\"],
    ["a space and a star", "a b*c"],
    ["a bracket left open", "f(x"],
    ["a colon at the end", "Error:"],
  ])("starts with and ends with %s keep the text literal", (_name: string, text: string) => {
    for (const [value, glob] of [
      [new StartsWith(text), "starts"],
      [new EndsWith(text), "ends"],
    ] as Array<[StartsWith<string> | EndsWith<string>, string]>) {
      const filter: LogFilter = pasted(
        buildSearchTokenForOperatorValue(KEY, value) as string,
      );
      const like: string =
        glob === "starts"
          ? toLikePattern(`${escapeWildcards(text)}*`)
          : toLikePattern(`*${escapeWildcards(text)}`);

      expect([text, glob, filter.severityText]).toEqual([text, glob, "Error"]);
      expect([text, glob, compiledMeaning(filter.attributes?.[KEY])]).toEqual([
        text,
        glob,
        ["pattern", like],
      ]);
    }
  });

  test("every generated glob means what it meant, and the filter after it still applies", () => {
    const globs: Array<string> = generatedTexts(10000, 6060, [
      "a",
      " ",
      "*",
      "?",
      "\\",
      "\\*",
      '\\"',
      '"',
      "~",
      "(",
      ")",
      "-",
      ":",
    ], 10).filter((glob: string): boolean => {
      // The form splits on " OR "; a lone "*" reads as "has a value".
      return glob.trim().length > 0 && glob.trim() !== "*";
    });

    for (const glob of globs) {
      const token: string | null = buildSearchTokenForOperatorValue(
        KEY,
        new Wildcard([glob.trim()]),
      );

      if (token === null) {
        continue;
      }

      const filter: LogFilter = pasted(token);

      expect([glob, filter.severityText]).toEqual([glob, "Error"]);
      expect([glob, compiledMeaning(filter.attributes?.[KEY])]).toEqual([
        glob,
        globMeaning(glob.trim()),
      ]);
    }
  });
});
