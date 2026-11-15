import fs from "fs";
import path from "path";
import ts from "typescript";
import { getWordOfMeaningKey, MEANING_KEYS } from "../Types/MeaningKeys";
import { listScanRoots, listSourceFiles } from "./ForeignHiddenRuleGuard";

/*
 * A KEY THAT NAMES ITS MEANING, WITH ITS ENGLISH WRITTEN BY HAND (#8180).
 *
 * A key such as "Open (status)" or "Created (import result)" is read as its
 * word - "Open", "Created" - by the translator itself, wherever the
 * reader's language has no wording of its own (Common/Types/MeaningKeys).
 * Before it did, each page wrote that English by hand, and the pattern
 * invites the next page to copy it:
 *
 *   - asking `hasTranslation(KEY)` and drawing the word where there is none:
 *     `translator.hasTranslation(OPEN_STATUS_TERM) ? ... : status`;
 *   - a lookup of the key that falls back to the word:
 *     `translateText(CREATED_IMPORT_RESULT) || "Created"`;
 *   - the word kept beside the key, for that fallback:
 *     `CREATED_IMPORT_RESULT_IN_ENGLISH: string = "Created"`.
 *
 * This reads the front ends' and Common's sources and finds each of them.
 * The key is known as a string, as `translationKey("...")`, or through a
 * constant set to either anywhere in the sources (OPEN_STATUS_TERM).
 *
 * It is a reader of the code, not a run of it.
 */

export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
);

export type MeaningKeyFallbackKind =
  // hasTranslation(KEY): a check that only matters to write the word by hand.
  | "asks-for-a-wording"
  // lookup(KEY) || "Word", lookup(KEY) ?? WORD, cond ? lookup(KEY) : "Word".
  | "falls-back-to-the-word"
  // const WORD: string = "Word", in a file that names the key.
  | "keeps-the-word";

export interface MeaningKeyFallbackFinding {
  // From the repository root.
  file: string;
  line: number;
  key: string;
  kind: MeaningKeyFallbackKind;
  // The code, as written.
  code: string;
}

// The two modules that are the translator's own knowledge of the keys.
const OWN_MODULES: ReadonlyArray<string> = [
  "packages/Common/Types/MeaningKeys.ts",
  "packages/Common/Types/Translator.ts",
];

// The functions that look a key up in the reader's language.
const LOOKUP_NAMES: ReadonlySet<string> = new Set<string>([
  "translateText",
  "translateTerm",
  "translateString",
  "t",
]);

const KEYS: ReadonlySet<string> = new Set<string>(MEANING_KEYS);

/*
 * Where a key can be looked up: every front end, Common's UI, the
 * enterprise screens, and Common's types, utilities and server, whose
 * translator knows the keys too.
 */
export function listMeaningKeyScanFiles(
  repositoryRoot: string = REPOSITORY_ROOT,
): Array<string> {
  const roots: Array<string> = [
    ...listScanRoots(repositoryRoot),
    path.join(repositoryRoot, "packages", "Common", "Types"),
    path.join(repositoryRoot, "packages", "Common", "Utils"),
    path.join(repositoryRoot, "packages", "Common", "Server"),
  ];

  return [
    ...new Set(
      roots.flatMap((root: string): Array<string> => {
        return listSourceFiles(root);
      }),
    ),
  ]
    .map((file: string): string => {
      return path.relative(repositoryRoot, file).split(path.sep).join("/");
    })
    .filter((file: string): boolean => {
      return !OWN_MODULES.includes(file) && !file.includes("/Tests/");
    })
    .sort();
}

export interface SourceText {
  // From the repository root.
  file: string;
  text: string;
}

function parse(source: SourceText): ts.SourceFile {
  return ts.createSourceFile(
    source.file,
    source.text,
    ts.ScriptTarget.Latest,
    true,
    source.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function stringOf(node: ts.Expression): string | undefined {
  const bare: ts.Expression = unwrap(node);

  return ts.isStringLiteral(bare) || ts.isNoSubstitutionTemplateLiteral(bare)
    ? bare.text
    : undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee: ts.Expression = unwrap(call.expression);

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return undefined;
}

// The meaning key an expression is written as, without what constants hold.
function keyWrittenAs(node: ts.Expression): string | undefined {
  const bare: ts.Expression = unwrap(node);
  const text: string | undefined = stringOf(bare);

  if (text !== undefined) {
    return KEYS.has(text) ? text : undefined;
  }

  if (
    ts.isCallExpression(bare) &&
    calleeName(bare) === "translationKey" &&
    bare.arguments.length > 0
  ) {
    return keyWrittenAs(bare.arguments[0] as ts.Expression);
  }

  return undefined;
}

function nameOf(node: ts.Expression): string | undefined {
  const bare: ts.Expression = unwrap(node);

  if (ts.isIdentifier(bare)) {
    return bare.text;
  }

  if (ts.isPropertyAccessExpression(bare)) {
    return bare.name.text;
  }

  return undefined;
}

function forEachNode(node: ts.Node, visit: (child: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child: ts.Node): void => {
    forEachNode(child, visit);
  });
}

export interface MeaningKeyBindings {
  // A constant's name, and the meaning key it is set to.
  keys: Map<string, string>;
}

/*
 * Every constant set to a meaning key, by name: OPEN_STATUS_TERM for "Open
 * (status)". A name is read wherever it is used, as it is imported under
 * its own name.
 */
export function readMeaningKeyBindings(
  sources: ReadonlyArray<SourceText>,
): MeaningKeyBindings {
  const keys: Map<string, string> = new Map<string, string>();

  for (const source of sources) {
    if (
      !MEANING_KEYS.some((key: string): boolean => {
        return source.text.includes(key);
      })
    ) {
      continue;
    }

    forEachNode(parse(source), (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const key: string | undefined = keyWrittenAs(node.initializer);

        if (key) {
          keys.set(node.name.text, key);
        }
      }
    });
  }

  return { keys };
}

function keyOf(
  node: ts.Expression,
  bindings: MeaningKeyBindings,
): string | undefined {
  const written: string | undefined = keyWrittenAs(node);

  if (written) {
    return written;
  }

  const name: string | undefined = nameOf(node);

  return name ? bindings.keys.get(name) : undefined;
}

// The key a lookup call looks up: translateText(KEY), t(KEY).
function keyLookedUpBy(
  node: ts.Expression,
  bindings: MeaningKeyBindings,
): string | undefined {
  const bare: ts.Expression = unwrap(node);

  if (
    !ts.isCallExpression(bare) ||
    !LOOKUP_NAMES.has(calleeName(bare) || "") ||
    bare.arguments.length === 0
  ) {
    return undefined;
  }

  return keyOf(bare.arguments[0] as ts.Expression, bindings);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function codeOf(source: ts.SourceFile, node: ts.Node): string {
  return node.getText(source).replace(/\s+/g, " ").trim();
}

/*
 * The hand-written fallbacks in one file. `bindings` says which constants
 * hold a meaning key, across every file read.
 */
export function findMeaningKeyFallbacks(
  sourceText: SourceText,
  bindings: MeaningKeyBindings,
): Array<MeaningKeyFallbackFinding> {
  const names: Array<string> = [...bindings.keys.keys()];
  const namesAKey: boolean =
    MEANING_KEYS.some((key: string): boolean => {
      return sourceText.text.includes(key);
    }) ||
    names.some((name: string): boolean => {
      return new RegExp(`\\b${name}\\b`).test(sourceText.text);
    });

  if (!namesAKey) {
    return [];
  }

  const source: ts.SourceFile = parse(sourceText);
  const findings: Array<MeaningKeyFallbackFinding> = [];

  // The keys this file names, and the constants it sets to a key's word.
  const keysNamed: Set<string> = new Set<string>();
  const wordConstants: Map<string, string> = new Map<string, string>();

  forEachNode(source, (node: ts.Node): void => {
    if (ts.isExpression(node)) {
      const key: string | undefined = keyOf(node, bindings);

      if (key) {
        keysNamed.add(key);
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const text: string | undefined = stringOf(node.initializer);

      if (text !== undefined) {
        wordConstants.set(node.name.text, text);
      }
    }
  });

  const isTheWordOf: (node: ts.Expression, key: string) => boolean = (
    node: ts.Expression,
    key: string,
  ): boolean => {
    const word: string | undefined = getWordOfMeaningKey(key);
    const text: string | undefined =
      stringOf(node) ?? wordConstants.get(nameOf(node) || "");

    return word !== undefined && text === word;
  };

  const report: (
    node: ts.Node,
    key: string,
    kind: MeaningKeyFallbackKind,
  ) => void = (
    node: ts.Node,
    key: string,
    kind: MeaningKeyFallbackKind,
  ): void => {
    findings.push({
      file: sourceText.file,
      line: lineOf(source, node),
      key,
      kind,
      code: codeOf(source, node),
    });
  };

  forEachNode(source, (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      calleeName(node) === "hasTranslation" &&
      node.arguments.length > 0
    ) {
      const key: string | undefined = keyOf(
        node.arguments[0] as ts.Expression,
        bindings,
      );

      if (key) {
        report(node, key, "asks-for-a-wording");
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      const key: string | undefined = keyLookedUpBy(node.left, bindings);

      if (key && isTheWordOf(node.right, key)) {
        report(node, key, "falls-back-to-the-word");
      }
    }

    if (ts.isConditionalExpression(node)) {
      for (const [branch, other] of [
        [node.whenTrue, node.whenFalse],
        [node.whenFalse, node.whenTrue],
      ] as Array<[ts.Expression, ts.Expression]>) {
        const key: string | undefined = keyLookedUpBy(branch, bindings);

        if (key && isTheWordOf(other, key)) {
          report(node, key, "falls-back-to-the-word");
        }
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const text: string | undefined = stringOf(node.initializer);

      for (const key of keysNamed) {
        if (text !== undefined && text === getWordOfMeaningKey(key)) {
          report(node, key, "keeps-the-word");
        }
      }
    }
  });

  return findings;
}

// Every hand-written fallback in the files, read from disk.
export function findMeaningKeyFallbacksIn(
  files: ReadonlyArray<string>,
  repositoryRoot: string = REPOSITORY_ROOT,
): Array<MeaningKeyFallbackFinding> {
  const sources: Array<SourceText> = files.map((file: string): SourceText => {
    return {
      file,
      text: fs.readFileSync(path.join(repositoryRoot, file), "utf8"),
    };
  });
  const bindings: MeaningKeyBindings = readMeaningKeyBindings(sources);

  return sources.flatMap(
    (source: SourceText): Array<MeaningKeyFallbackFinding> => {
      return findMeaningKeyFallbacks(source, bindings);
    },
  );
}

export function formatMeaningKeyFallbackFindings(
  findings: ReadonlyArray<MeaningKeyFallbackFinding>,
): string {
  return findings
    .map((finding: MeaningKeyFallbackFinding): string => {
      return `${finding.file}:${finding.line} (${finding.kind}, "${finding.key}"): ${finding.code}`;
    })
    .join("\n");
}
