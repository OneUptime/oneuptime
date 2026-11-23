import { listProductFiles } from "../../Helpers/CodeScanning";
import {
  JavaScriptPattern,
  KotlinStringLiteral,
  javaScriptForm,
  kotlinProductFiles,
  kotlinStringLiterals,
} from "../../Helpers/KotlinPatterns";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A PATTERN THAT FINDS A JWT IN TEXT LOOKS FOR IT ONCE PER RUN.
 *
 * Tokens are looked for in text somebody outside wrote: the server's log
 * lines, tool results and cluster or resource output on their way to a
 * model, exception messages at ingest, the instance health page's job and
 * log text. A token is "eyJ" and runs of base64url characters, and a
 * pattern tried from every "eyJ" (or every word boundary) of a long run of
 * those characters reads the rest of the run again from each one - its time
 * grows with the square of the text's length.
 *
 * So every such pattern in product code (read here from the source, across
 * all of it - ee/ and the agents' copies too, when checked out) begins with
 * the look-behind that lets a match start only where a run of those
 * characters starts, and settles on the run's first possible start with a
 * look-ahead (LogRedaction and Serializer say how) - unless it is listed
 * below with the reason it is linear on its own. And every one of them,
 * listed or not, reads the shapes that were slow in well under two seconds.
 *
 * The agents' Kotlin is read too (Helpers/KotlinPatterns): the Android
 * agent's redactor took 12 seconds on 100 KB of one of those shapes on a
 * device before it was held to the same rule (#10786). A device runs a
 * Kotlin pattern with Android's regular expressions, ICU's, which read two
 * things otherwise than JavaScript does, so a Kotlin pattern holds neither:
 *
 *   - a back-reference. ICU takes one for nothing when it works out where a
 *     match may start, so the look-ahead and \1 that settle on a run's first
 *     start in JavaScript would start a match only at an "e" there, and miss
 *     every token after a "-". An atomic group settles instead (the agent's
 *     Redactor.kt says how);
 *   - an open counted repeat, such as {5,}. ICU keeps a place to go back to
 *     for each character one reads; on a segment of about 250,000 it runs
 *     out of room, Android's matcher says it found nothing, and every later
 *     token stays in the text. Five, then any more ({5}[...]*), keeps none.
 *
 * A Kotlin pattern is timed as JavaScript reads it in the same steps
 * (javaScriptForm, which writes an atomic group as a look-ahead and \1).
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx|js|mjs|cjs)$/;

// A token's first segment, as a pattern writes it.
const TOKEN_START: string = "eyJ[A-Za-z0-9_-]";

// Where a run of the characters a token is made of starts.
const RUN_START: string = "(?<![A-Za-z0-9_-])";

/*
 * Patterns of another shape that are linear for a reason of their own, by
 * the file they are in.
 */
const LINEAR_FOR_ANOTHER_REASON: Record<string, string> = {
  "packages/Common/UI/Utils/ErrorSupportBundle.ts":
    "a token there may end after any of its segments, so the first start in a run ends in a match at the run's end and nothing is read twice",
  /*
   * The path rule of Session Replay's scrubber and the React Native
   * recorder's copy of it (#8385): a token is tested against one path
   * segment, anchored at both of its ends, so it is tried from the
   * segment's start alone. No look-behind either: the browser recorder runs
   * where a browser without one would refuse the whole bundle.
   */
  "packages/Common/Utils/Rum/UrlScrubber.ts":
    "anchored at both ends of one path segment, so it is tried once, from the segment's start, and no part holds a dot",
  "packages/App/FeatureSet/MobileRecorder/src/Sanitize.ts":
    "anchored at both ends of one route segment, so it is tried once, from the segment's start, and no part holds a dot",
};

interface FoundPattern {
  file: string;
  line: number;
  source: string;
  flags: string;
  // A Kotlin pattern is Java's, which a device reads with ICU.
  language: "JavaScript" | "Kotlin";
  // Whether its literal holds a Kotlin template, whose text is code's.
  hasTemplate: boolean;
}

// What ICU reads otherwise than JavaScript, in a Kotlin pattern's source.
const BACK_REFERENCE: RegExp = /(?<!\\)(?:\\\\)*\\(?:[1-9]|k<)/;
const OPEN_COUNTED_REPEAT: RegExp = /(?<!\\)(?:\\\\)*\{\d+,\}/;

// Every regular expression literal of a file, and every RegExp built from a literal.
function patternsIn(file: string, text: string): Array<FoundPattern> {
  const found: Array<FoundPattern> = [];
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const literal: string = node.getText(source);
      const end: number = literal.lastIndexOf("/");

      found.push({
        file,
        line: lineOf(node),
        source: literal.slice(1, end),
        flags: literal.slice(end + 1),
        language: "JavaScript",
        hasTemplate: false,
      });
    } else if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      node.expression.getText(source) === "RegExp" &&
      node.arguments &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const flags: ts.Expression | undefined = node.arguments[1];

      found.push({
        file,
        line: lineOf(node),
        source: node.arguments[0].text,
        flags: flags && ts.isStringLiteralLike(flags) ? flags.text : "",
        language: "JavaScript",
        hasTemplate: false,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const JAVASCRIPT_TOKEN_PATTERNS: Array<FoundPattern> = listProductFiles()
  .filter((file: string): boolean => {
    return CODE_FILE.test(file);
  })
  .flatMap((file: string): Array<FoundPattern> => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, file),
      "utf8",
    );

    if (!text.includes("eyJ")) {
      return [];
    }

    return patternsIn(file, text).filter((pattern: FoundPattern): boolean => {
      return pattern.source.includes(TOKEN_START);
    });
  });

// Every string of the agents' Kotlin that holds a token's first segment: a pattern.
const KOTLIN_TOKEN_PATTERNS: Array<FoundPattern> = kotlinProductFiles().flatMap(
  (file: string): Array<FoundPattern> => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, file),
      "utf8",
    );

    if (!text.includes("eyJ")) {
      return [];
    }

    return kotlinStringLiterals(text)
      .filter((literal: KotlinStringLiteral): boolean => {
        return literal.value.includes(TOKEN_START);
      })
      .map((literal: KotlinStringLiteral): FoundPattern => {
        return {
          file,
          line: literal.line,
          source: literal.value,
          flags: "",
          language: "Kotlin",
          hasTemplate: literal.hasTemplate,
        };
      });
  },
);

const TOKEN_PATTERNS: Array<FoundPattern> = [
  ...JAVASCRIPT_TOKEN_PATTERNS,
  ...KOTLIN_TOKEN_PATTERNS,
];

const AGENT_REDACTOR: string =
  "agents/AndroidAgent/app/src/main/java/com/oneuptime/androidagent/logs/Redactor.kt";

/*
 * The pattern as JavaScript runs it: a Kotlin one as javaScriptForm writes
 * it, every match replaced, as Kotlin's replace does.
 */
function runnable(pattern: FoundPattern): RegExp {
  if (pattern.language === "JavaScript") {
    return new RegExp(pattern.source, pattern.flags);
  }

  const form: JavaScriptPattern = javaScriptForm(pattern.source);

  return new RegExp(form.source, `${form.flags}g`);
}

const LENGTH: number = 100000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const SLOW_SHAPES: Array<string> = [
  repeat("eyJ", LENGTH),
  repeat("-eyJ-", LENGTH),
  repeat("eyJab-", LENGTH),
  repeat("eyJeeeeeeeeee", LENGTH),
  repeat("eyJ".repeat(170) + "." + "a".repeat(16384) + "!", LENGTH),
];

describe("a pattern that finds a JWT looks for it once per run", () => {
  test("the guard finds the patterns it holds to the rule", () => {
    const files: Array<string> = TOKEN_PATTERNS.map(
      (pattern: FoundPattern): string => {
        return pattern.file;
      },
    );

    // The server's own, read wherever the checkout is.
    for (const file of [
      "packages/Common/Server/Utils/LogRedaction.ts",
      "packages/Common/Server/Utils/AI/Toolbox/Serializer.ts",
      "packages/Common/Server/Utils/Telemetry/ExceptionSanitizer.ts",
      "packages/Common/Utils/AiRemediation/KubectlOutputRedactor.ts",
      "packages/Common/Utils/AiRemediation/Resource/ResourceOutputRedactor.ts",
      "packages/App/API/AdminHealthProbes.ts",
      // And the Android agent's, read from its Kotlin.
      AGENT_REDACTOR,
    ]) {
      expect({ file, found: files.includes(file) }).toEqual({
        file,
        found: true,
      });
    }
  });

  test("each starts only where a run of a token's characters starts", () => {
    const offending: Array<string> = TOKEN_PATTERNS.filter(
      (pattern: FoundPattern): boolean => {
        return (
          !LINEAR_FOR_ANOTHER_REASON[pattern.file] &&
          !pattern.source.startsWith(RUN_START)
        );
      },
    ).map((pattern: FoundPattern): string => {
      return `${pattern.file}:${pattern.line} /${pattern.source}/${pattern.flags}`;
    });

    expect(offending).toEqual([]);
  });

  test("each pattern listed as linear for another reason is still there", () => {
    for (const file of Object.keys(LINEAR_FOR_ANOTHER_REASON)) {
      expect(fs.existsSync(path.join(REPOSITORY_DIRECTORY, file))).toBe(true);
    }
  });

  test("a Kotlin one holds nothing Android's regular expressions read otherwise", () => {
    const offending: Array<string> = [];

    for (const pattern of KOTLIN_TOKEN_PATTERNS) {
      const where: string = `${pattern.file}:${pattern.line} /${pattern.source}/`;

      if (pattern.hasTemplate) {
        offending.push(`${where} is built from code, which is not read here`);
      }

      if (BACK_REFERENCE.test(pattern.source)) {
        offending.push(`${where} holds a back-reference`);
      }

      if (OPEN_COUNTED_REPEAT.test(pattern.source)) {
        offending.push(`${where} holds an open counted repeat`);
      }
    }

    expect(offending).toEqual([]);
  });

  test("the Kotlin rules catch both forms that were wrong on Android", () => {
    // The agent's before #10786: tried from every word boundary, each segment an open counted repeat.
    const before: string = String.raw`\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}`;
    // The server's form, which on Android misses every token after a "-".
    const server: string = String.raw`(?<![A-Za-z0-9_-])(?=((?:[A-Za-z0-9_-]*?-)??)eyJ)\1eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}`;

    expect(before.startsWith(RUN_START)).toBe(false);
    expect(OPEN_COUNTED_REPEAT.test(before)).toBe(true);
    expect(BACK_REFERENCE.test(server)).toBe(true);
    expect(OPEN_COUNTED_REPEAT.test(server)).toBe(true);

    // An escaped backslash before a digit, or before a brace, is neither.
    expect(BACK_REFERENCE.test(String.raw`a\\1`)).toBe(false);
    expect(OPEN_COUNTED_REPEAT.test(String.raw`a\{5,}`)).toBe(false);
    expect(BACK_REFERENCE.test(String.raw`a\\\1`)).toBe(true);
    expect(OPEN_COUNTED_REPEAT.test(String.raw`a\\{5,}`)).toBe(true);

    // The agent's now is read, and holds to every rule.
    const agents: Array<FoundPattern> = KOTLIN_TOKEN_PATTERNS.filter(
      (pattern: FoundPattern): boolean => {
        return pattern.file === AGENT_REDACTOR;
      },
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]!.source.startsWith(RUN_START)).toBe(true);
    expect(BACK_REFERENCE.test(agents[0]!.source)).toBe(false);
    expect(OPEN_COUNTED_REPEAT.test(agents[0]!.source)).toBe(false);
  });

  test("each reads the shapes that were slow in well under two seconds", () => {
    const slow: Array<string> = [];

    for (const pattern of TOKEN_PATTERNS) {
      let regExp: RegExp;

      try {
        regExp = runnable(pattern);
      } catch (error) {
        slow.push(
          `${pattern.file}:${pattern.line} cannot be timed: ${(error as Error).message}`,
        );
        continue;
      }

      for (const text of SLOW_SHAPES) {
        const startedAt: number = Date.now();

        text.replace(regExp, "x");

        const elapsed: number = Date.now() - startedAt;

        if (elapsed >= 2000) {
          slow.push(
            `${pattern.file}:${pattern.line} took ${elapsed} ms on ${text.slice(0, 20)}...`,
          );
        }
      }
    }

    expect(slow).toEqual([]);
  });
});
