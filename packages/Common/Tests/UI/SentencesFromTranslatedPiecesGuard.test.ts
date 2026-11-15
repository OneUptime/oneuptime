// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";

/*
 * A SENTENCE IS TRANSLATED WHOLE, NEVER A WORD AT A TIME (#8076).
 *
 * Every table row's ⋯ button was named `${translateString("More actions
 * for")} ${itemLabel}`: Japanese, which puts the name first ("{{name}} の
 * その他のアクション"), read "その他のアクション: Monitor: API". The
 * Correlate builder's remove button read "Remove condition 2" with a
 * Latin 2 on a Persian page, a security playbook's View button "View:
 * name" with English's colon in French, and the audit log dialog's title
 * kept English's order and its English fallbacks ("User Session",
 * "Resource") in every language. Joined from translated pieces, a sentence
 * keeps English's word order, its punctuation and its digits, whatever
 * each piece says.
 *
 * A sentence with a value in it is one key with a {{placeholder}}:
 * translator.translateTemplate("More actions for {{name}}", { name }), a
 * translatePlural for a count, a nested key with i18next's {{value}}, or
 * TranslatedSentence around an element. Numbers go in through
 * translator.formatNumber, so they are in the reader's digits.
 *
 * This reads every frontend's source (each feature set's src, Common/UI and
 * the Enterprise screens) through the TypeScript AST, and fails on a
 * translated piece - what t(), tx(), translateText(), translateString(),
 * translateTemplate(), translatePlural() or translateTerm() returns -
 * joined into one line with something else by a template literal, by + or
 * by [...].join():
 *
 *   - beside a value or another translated piece with nothing, a space, a
 *     comma, a colon or a dash between them ("Remove condition 2",
 *     "View: name", "Clear Status filter", "3 conditions");
 *   - with English words or punctuation written in the code beside it
 *     (`${t("Trigger")}: `, `, ${t("Secret")}`).
 *
 * What is not a sentence built from pieces, and passes:
 *
 *   - a whole sentence beside another, with a space between: a piece whose
 *     English starts with a capital (or a value) and ends with ".", "!" or
 *     "?", or a line break between them (two sentences, each translated
 *     whole: "Could not load it. <the server's reason>");
 *   - a label that carries its own colon, then its value ("Duration:" is
 *     "Durée :" in French, the colon translated with the label);
 *   - facts on one line, set apart by " · ", " • ", " | " or "/", or a
 *     separator a helper writes (getInlineSeparator, a SEPARATOR constant);
 *   - a path (" > ", "›", an arrow) and an aside in brackets: a unit, a
 *     shortcut, a host ("Memory (MB)", "Search (Ctrl+K)");
 *   - a mark of no letters before a sentence ("⇄ Ada (covering Bob)").
 *
 * A piece's English is read from its call: a literal, a constant of the
 * same module or one it imports (BackupsCopy.couldNotLoad), a plural's
 * other form. A piece whose English cannot be read (a variable, a lookup
 * by key) counts as a phrase, not a sentence. What still has to be joined
 * so - two sentences the guard cannot read as such - is listed in
 * JOINED_ON_PURPOSE with the reason, and an entry that no longer matches
 * fails, so the list only shrinks.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// What a translation call is named: t(), tx(), translateText(), translator.translatePlural() ...
const TRANSLATION_CALL: RegExp =
  /^(t|tx|translate|translate[A-Z][A-Za-z0-9]*)$/;

/*
 * Calls named like translation calls that hand back no text to show: the
 * markers and the term of a sentence's value.
 */
const NOT_A_PIECE: ReadonlySet<string> = new Set<string>([
  "translatableTerm",
  "translatableSentence",
  "translationKey",
]);

// An expression that writes the line's separator: getInlineSeparator(...), SEPARATOR.
const SEPARATOR_NAME: RegExp = /separator|arrow/i;

/*
 * A whole sentence: its English starts with a capital, a figure, a value or
 * a quote, and ends with a full stop, a question or an exclamation mark.
 */
const SENTENCE_START: RegExp = /^[A-Z0-9{"'“«(¿¡…]/;
const SENTENCE_END: RegExp = /[.!?…。！？]["'”»)\]]*$/;

// A label's own colon at its end: "Duration:".
const ENDS_WITH_COLON: RegExp = /[:：]$/;

const LETTER: RegExp = /[A-Za-z]/;

// Any letter or figure, in any script: a constant without one is a mark ("⇄").
const LETTER_OR_FIGURE: RegExp = /[\p{L}\p{N}]/u;

/*
 * What sets two parts of a line apart, so no sentence runs across: a line
 * break, a separator between facts (" · ", " • ", " | ", "/"), a path's
 * ">" or "›", an arrow, or a bracket of an aside.
 */
const APART: RegExp = /[\n·•|/>›→←⇄()[\]（）]/;

// What follows a sentence's end: ". ", "! ".
const AFTER_A_SENTENCE: RegExp = /^\s*[.!?。！？]/;

const ONLY_SPACE: RegExp = /^\s+$/;

// Punctuation that joins clauses of one sentence: ",", ":", ";".
const CLAUSE_PUNCTUATION: RegExp = /[:,;：，]/;

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

const WHITESPACE_RUN: RegExp = /\s+/g;

// How deep a constant is followed through other constants and modules.
const MAX_RESOLVE_DEPTH: number = 6;

export enum JoinedPieceKind {
  Value = "a value joined to a translated phrase",
  Pieces = "translated phrases joined",
  Words = "English words written beside a translated phrase",
  Punctuation = "punctuation written beside a translated phrase",
}

export interface JoinedPieceFinding {
  file: string;
  line: number;
  text: string;
  kinds: Array<JoinedPieceKind>;
}

/*
 * Where a module's import leads, relative to the repository, or undefined
 * for a package. "Common/..." is packages/Common/....
 */
export type ModuleReader = (file: string) => string | undefined;

const MODULE_EXTENSIONS: ReadonlyArray<string> = [
  ".ts",
  ".tsx",
  "/index.ts",
  "/index.tsx",
];

export const resolveModulePath: (
  fromFile: string,
  specifier: string,
  exists: (file: string) => boolean,
) => string | undefined = (
  fromFile: string,
  specifier: string,
  exists: (file: string) => boolean,
): string | undefined => {
  let base: string | undefined = undefined;

  if (specifier.startsWith(".")) {
    base = path.posix.join(path.posix.dirname(fromFile), specifier);
  } else if (specifier.startsWith("Common/")) {
    base = `packages/${specifier}`;
  }

  if (!base) {
    return undefined;
  }

  for (const extension of ["", ...MODULE_EXTENSIONS]) {
    const candidate: string = `${base}${extension}`;

    if (TYPESCRIPT_FILE.test(candidate) && exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

interface ModuleScope {
  file: string;
  // A module's constants by name, and an object constant's properties as "NAME.prop".
  constants: Map<string, ts.Expression>;
  // What a name was imported as: its module and the name it has there.
  imports: Map<string, { module: string; name: string }>;
}

const unwrap: (expression: ts.Expression) => ts.Expression = (
  expression: ts.Expression,
): ts.Expression => {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
};

const calleeName: (expression: ts.Expression) => string | undefined = (
  expression: ts.Expression,
): string | undefined => {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return undefined;
};

const readScope: (file: string, source: ts.SourceFile) => ModuleScope = (
  file: string,
  source: ts.SourceFile,
): ModuleScope => {
  const constants: Map<string, ts.Expression> = new Map<
    string,
    ts.Expression
  >();
  const imports: Map<string, { module: string; name: string }> = new Map<
    string,
    { module: string; name: string }
  >();

  const addObject: (prefix: string, value: ts.Expression) => void = (
    prefix: string,
    value: ts.Expression,
  ): void => {
    const object: ts.Expression = unwrap(value);

    if (!ts.isObjectLiteralExpression(object)) {
      return;
    }

    for (const property of object.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ) {
        const name: string = `${prefix}.${property.name.text}`;
        constants.set(name, property.initializer);
        addObject(name, property.initializer);
      }
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      constants.set(node.name.text, node.initializer);
      addObject(node.name.text, node.initializer);
    }

    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause
    ) {
      const module: string = node.moduleSpecifier.text;
      const clause: ts.ImportClause = node.importClause;

      if (clause.name) {
        imports.set(clause.name.text, { module, name: "default" });
      }

      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          imports.set(element.name.text, {
            module,
            name: (element.propertyName || element.name).text,
          });
        }
      }
    }

    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      constants.set("default", node.expression);
      addObject("default", node.expression);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return { file, constants, imports };
};

const parse: (file: string, source: string) => ts.SourceFile = (
  file: string,
  source: string,
): ts.SourceFile => {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
};

/*
 * The modules a scan follows a key's constant into (a copy module, mostly):
 * each read once, whatever imports it.
 */
class ScopeReader {
  private readonly scopes: Map<string, ModuleScope | null> = new Map<
    string,
    ModuleScope | null
  >();

  public constructor(private readonly readModule: ModuleReader) {}

  public exists(file: string): boolean {
    return this.readModule(file) !== undefined;
  }

  public scopeOf(file: string): ModuleScope | null {
    if (this.scopes.has(file)) {
      return this.scopes.get(file) || null;
    }

    const text: string | undefined = this.readModule(file);
    const scope: ModuleScope | null =
      text === undefined ? null : readScope(file, parse(file, text));

    this.scopes.set(file, scope);

    return scope;
  }

  // What a name or NAME.prop stands for in a module, followed through its imports.
  public resolve(
    scope: ModuleScope,
    name: string,
    depth: number,
  ): { expression: ts.Expression; scope: ModuleScope } | undefined {
    if (depth > MAX_RESOLVE_DEPTH) {
      return undefined;
    }

    const local: ts.Expression | undefined = scope.constants.get(name);

    if (local) {
      return { expression: local, scope };
    }

    const [head, ...rest] = name.split(".") as [string, ...Array<string>];

    // A name for another: `export default SessionLengthCopy`.
    const alias: ts.Expression | undefined = scope.constants.get(head);

    if (alias && rest.length > 0 && ts.isIdentifier(unwrap(alias))) {
      return this.resolve(
        scope,
        [(unwrap(alias) as ts.Identifier).text, ...rest].join("."),
        depth + 1,
      );
    }

    const imported: { module: string; name: string } | undefined =
      scope.imports.get(head);

    if (!imported) {
      return undefined;
    }

    const target: string | undefined = resolveModulePath(
      scope.file,
      imported.module,
      (file: string): boolean => {
        return this.exists(file);
      },
    );
    const targetScope: ModuleScope | null = target
      ? this.scopeOf(target)
      : null;

    if (!targetScope) {
      return undefined;
    }

    return this.resolve(
      targetScope,
      [imported.name, ...rest].join("."),
      depth + 1,
    );
  }
}

// The dotted name an identifier or a property chain reads: "BackupsCopy.couldNotLoad".
const dottedName: (expression: ts.Expression) => string | undefined = (
  expression: ts.Expression,
): string | undefined => {
  const current: ts.Expression = unwrap(expression);

  if (ts.isIdentifier(current)) {
    return current.text;
  }

  if (ts.isPropertyAccessExpression(current)) {
    const head: string | undefined = dottedName(current.expression);
    return head ? `${head}.${current.name.text}` : undefined;
  }

  return undefined;
};

// The call a translated piece is, behind a "|| fallback" or a "?? fallback".
const translationCallOf: (
  expression: ts.Expression,
) => ts.CallExpression | undefined = (
  expression: ts.Expression,
): ts.CallExpression | undefined => {
  const current: ts.Expression = unwrap(expression);

  if (ts.isCallExpression(current)) {
    const name: string | undefined = calleeName(current.expression);

    return name && TRANSLATION_CALL.test(name) && !NOT_A_PIECE.has(name)
      ? current
      : undefined;
  }

  if (
    ts.isBinaryExpression(current) &&
    (current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return translationCallOf(current.left);
  }

  return undefined;
};

interface PieceContext {
  scope: ModuleScope;
  reader: ScopeReader;
}

/*
 * The English a key expression holds, every text it can be, or undefined
 * where it cannot be read.
 */
const englishOf: (
  expression: ts.Expression,
  context: PieceContext,
  depth: number,
) => Array<string> | undefined = (
  expression: ts.Expression,
  context: PieceContext,
  depth: number,
): Array<string> | undefined => {
  if (depth > MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  const current: ts.Expression = unwrap(expression);

  if (
    ts.isStringLiteral(current) ||
    ts.isNoSubstitutionTemplateLiteral(current)
  ) {
    return [current.text];
  }

  if (ts.isConditionalExpression(current)) {
    const whenTrue: Array<string> | undefined = englishOf(
      current.whenTrue,
      context,
      depth + 1,
    );
    const whenFalse: Array<string> | undefined = englishOf(
      current.whenFalse,
      context,
      depth + 1,
    );

    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }

  // A plural: { one: "...", other: "..." } reads as its other form.
  if (ts.isObjectLiteralExpression(current)) {
    for (const property of current.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "other"
      ) {
        return englishOf(property.initializer, context, depth + 1);
      }
    }

    return undefined;
  }

  if (
    ts.isCallExpression(current) &&
    calleeName(current.expression) === "translationKey" &&
    current.arguments[0]
  ) {
    return englishOf(current.arguments[0], context, depth + 1);
  }

  const name: string | undefined = dottedName(current);
  const resolved:
    | { expression: ts.Expression; scope: ModuleScope }
    | undefined = name
    ? context.reader.resolve(context.scope, name, 0)
    : undefined;

  return resolved
    ? englishOf(
        resolved.expression,
        { scope: resolved.scope, reader: context.reader },
        depth + 1,
      )
    : undefined;
};

type LinePart =
  | { kind: "text"; text: string }
  | { kind: "piece"; isSentence: boolean; isLabel: boolean }
  | { kind: "separator" }
  | { kind: "value"; leading: string; trailing: string };

export const isWholeSentence: (english: ReadonlyArray<string>) => boolean = (
  english: ReadonlyArray<string>,
): boolean => {
  return (
    english.length > 0 &&
    english.every((text: string): boolean => {
      const trimmed: string = text.trim();
      return SENTENCE_START.test(trimmed) && SENTENCE_END.test(trimmed);
    })
  );
};

// A label that carries its own colon: "Duration:", "Opens an incident when this happens again:".
export const isLabelWithColon: (english: ReadonlyArray<string>) => boolean = (
  english: ReadonlyArray<string>,
): boolean => {
  return (
    english.length > 0 &&
    english.every((text: string): boolean => {
      const trimmed: string = text.trim();
      return SENTENCE_START.test(trimmed) && ENDS_WITH_COLON.test(trimmed);
    })
  );
};

/*
 * The text a value starts or ends with, where it is a literal, a template,
 * a choice between one and nothing, or a constant holding one:
 * `${m.unit ? ` (${m.unit})` : ""}` starts with " (".
 */
const edgeTextOf: (
  expression: ts.Expression,
  side: "leading" | "trailing",
  context: PieceContext,
  depth: number,
) => string | undefined = (
  expression: ts.Expression,
  side: "leading" | "trailing",
  context: PieceContext,
  depth: number,
): string | undefined => {
  if (depth > MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  const current: ts.Expression = unwrap(expression);

  if (
    ts.isStringLiteral(current) ||
    ts.isNoSubstitutionTemplateLiteral(current)
  ) {
    return current.text;
  }

  if (ts.isTemplateExpression(current)) {
    if (side === "leading") {
      return current.head.text;
    }

    const last: ts.TemplateSpan | undefined =
      current.templateSpans[current.templateSpans.length - 1];

    return last ? last.literal.text : undefined;
  }

  if (ts.isConditionalExpression(current)) {
    const whenTrue: string | undefined = edgeTextOf(
      current.whenTrue,
      side,
      context,
      depth + 1,
    );
    const whenFalse: string | undefined = edgeTextOf(
      current.whenFalse,
      side,
      context,
      depth + 1,
    );

    // A choice between some text and nothing starts as the text does.
    if (whenFalse === "") {
      return whenTrue;
    }

    if (whenTrue === "") {
      return whenFalse;
    }

    return whenTrue === whenFalse ? whenTrue : undefined;
  }

  // A constant of this module: `const tzSuffix = timezone ? ` (${timezone})` : ""`.
  if (ts.isIdentifier(current)) {
    const constant: ts.Expression | undefined = context.scope.constants.get(
      current.text,
    );

    return constant
      ? edgeTextOf(constant, side, context, depth + 1)
      : undefined;
  }

  return undefined;
};

const partOf: (expression: ts.Expression, context: PieceContext) => LinePart = (
  expression: ts.Expression,
  context: PieceContext,
): LinePart => {
  const current: ts.Expression = unwrap(expression);

  if (
    ts.isStringLiteral(current) ||
    ts.isNoSubstitutionTemplateLiteral(current)
  ) {
    return { kind: "text", text: current.text };
  }

  const call: ts.CallExpression | undefined = translationCallOf(current);

  if (call) {
    const english: Array<string> | undefined = call.arguments[0]
      ? englishOf(call.arguments[0], context, 0)
      : undefined;

    return {
      kind: "piece",
      isSentence: english ? isWholeSentence(english) : false,
      isLabel: english ? isLabelWithColon(english) : false,
    };
  }

  // cond ? t("A") : t("B"): a piece, a sentence only when both are.
  if (ts.isConditionalExpression(current)) {
    const whenTrue: LinePart = partOf(current.whenTrue, context);
    const whenFalse: LinePart = partOf(current.whenFalse, context);

    if (whenTrue.kind === "piece" && whenFalse.kind === "piece") {
      return {
        kind: "piece",
        isSentence: whenTrue.isSentence && whenFalse.isSentence,
        isLabel: whenTrue.isLabel && whenFalse.isLabel,
      };
    }
  }

  const name: string | undefined = ts.isCallExpression(current)
    ? calleeName(current.expression)
    : calleeName(current);

  if (name && SEPARATOR_NAME.test(name)) {
    return { kind: "separator" };
  }

  const leading: string | undefined = edgeTextOf(
    current,
    "leading",
    context,
    0,
  );
  const trailing: string | undefined = edgeTextOf(
    current,
    "trailing",
    context,
    0,
  );

  // A constant of no letters or figures is a mark: "⇄", " · ".
  if (
    leading !== undefined &&
    leading === trailing &&
    leading.length > 0 &&
    !LETTER_OR_FIGURE.test(leading) &&
    (ts.isIdentifier(current) || ts.isPropertyAccessExpression(current))
  ) {
    return { kind: "separator" };
  }

  return { kind: "value", leading: leading || "", trailing: trailing || "" };
};

// What stands between two parts of a line.
enum Joint {
  // Facts set apart, a path, an aside in brackets, lines: no sentence runs across.
  Apart = "apart",
  // A sentence ended before it.
  SentenceEnd = "sentence end",
  // Only a space.
  Space = "space",
  // Nothing, a comma, a colon, a dash, or words: one sentence runs across.
  Word = "word",
}

const jointOf: (text: string) => Joint = (text: string): Joint => {
  if (APART.test(text)) {
    return Joint.Apart;
  }

  if (AFTER_A_SENTENCE.test(text)) {
    return Joint.SentenceEnd;
  }

  if (ONLY_SPACE.test(text)) {
    return Joint.Space;
  }

  return Joint.Word;
};

/*
 * Why a line's parts make one sentence of translated pieces, or nothing
 * when they do not.
 */
export const judgeLine: (
  parts: ReadonlyArray<LinePart>,
) => Array<JoinedPieceKind> = (
  parts: ReadonlyArray<LinePart>,
): Array<JoinedPieceKind> => {
  // Literal text next to literal text is one stretch of text.
  const line: Array<LinePart> = [];

  for (const part of parts) {
    const previous: LinePart | undefined = line[line.length - 1];

    if (part.kind === "text" && previous && previous.kind === "text") {
      line[line.length - 1] = { kind: "text", text: previous.text + part.text };
    } else {
      line.push(part);
    }
  }

  const kinds: Set<JoinedPieceKind> = new Set<JoinedPieceKind>();

  line.forEach((part: LinePart, index: number): void => {
    if (part.kind !== "piece") {
      return;
    }

    for (const direction of [-1, 1]) {
      let at: number = index + direction;
      let between: string = "";
      const beside: LinePart | undefined = line[at];

      if (beside && beside.kind === "text") {
        between = beside.text;
        at += direction;
      }

      const neighbour: LinePart | undefined = line[at];

      if (neighbour && neighbour.kind === "separator") {
        continue;
      }

      // The edge of the line: what the code writes beside the piece.
      if (!neighbour) {
        if (jointOf(between) === Joint.Apart) {
          continue;
        }

        if (LETTER.test(between)) {
          kinds.add(JoinedPieceKind.Words);
        } else if (CLAUSE_PUNCTUATION.test(between)) {
          kinds.add(JoinedPieceKind.Punctuation);
        }

        continue;
      }

      // A value's own text counts as written beside the piece: " (" in `${unit ? ` (${unit})` : ""}`.
      if (neighbour.kind === "value") {
        between =
          direction === 1
            ? between + neighbour.leading
            : neighbour.trailing + between;
      }

      const joint: Joint = jointOf(between);

      if (joint === Joint.Apart || joint === Joint.SentenceEnd) {
        continue;
      }

      if (joint === Joint.Space) {
        // A whole sentence stands beside anything.
        if (part.isSentence) {
          continue;
        }

        if (neighbour.kind === "piece" && neighbour.isSentence) {
          continue;
        }

        // A label with its own colon, then what it labels.
        if (direction === 1 && part.isLabel && neighbour.kind === "value") {
          continue;
        }
      }

      kinds.add(
        neighbour.kind === "piece"
          ? JoinedPieceKind.Pieces
          : JoinedPieceKind.Value,
      );
    }
  });

  return Array.from(kinds).sort();
};

const flattenPlus: (expression: ts.Expression) => Array<ts.Expression> = (
  expression: ts.Expression,
): Array<ts.Expression> => {
  const current: ts.Expression = unwrap(expression);

  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return [...flattenPlus(current.left), ...flattenPlus(current.right)];
  }

  return [expression];
};

const isPlus: (node: ts.Node) => boolean = (node: ts.Node): boolean => {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  );
};

// The parts of a template literal, a + chain or a [...].join(), or undefined for anything else.
const linePartsOf: (
  node: ts.Node,
  context: PieceContext,
) => Array<LinePart> | undefined = (
  node: ts.Node,
  context: PieceContext,
): Array<LinePart> | undefined => {
  if (ts.isTemplateExpression(node)) {
    const parts: Array<LinePart> = [{ kind: "text", text: node.head.text }];

    for (const span of node.templateSpans) {
      parts.push(partOf(span.expression, context));
      parts.push({ kind: "text", text: span.literal.text });
    }

    return parts;
  }

  // The outermost + of a chain, its operands in order.
  if (isPlus(node)) {
    let outer: ts.Node = node.parent;

    while (ts.isParenthesizedExpression(outer)) {
      outer = outer.parent;
    }

    if (isPlus(outer)) {
      return undefined;
    }

    return flattenPlus(node as ts.Expression).map(
      (operand: ts.Expression): LinePart => {
        return partOf(operand, context);
      },
    );
  }

  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join"
  ) {
    const list: ts.Expression = unwrap(node.expression.expression);

    if (!ts.isArrayLiteralExpression(list)) {
      return undefined;
    }

    const separatorArgument: ts.Expression | undefined = node.arguments[0];
    const separator: LinePart = !separatorArgument
      ? { kind: "text", text: "," }
      : ts.isStringLiteral(separatorArgument) ||
          ts.isNoSubstitutionTemplateLiteral(separatorArgument)
        ? { kind: "text", text: separatorArgument.text }
        : { kind: "separator" };
    const parts: Array<LinePart> = [];

    list.elements.forEach((element: ts.Expression, index: number): void => {
      if (index > 0) {
        parts.push(separator);
      }

      parts.push(
        ts.isSpreadElement(element)
          ? { kind: "value", leading: "", trailing: "" }
          : partOf(element, context),
      );
    });

    return parts;
  }

  return undefined;
};

/*
 * Every line of `source` made by joining translated pieces into one
 * sentence. Constants it imports are read with `readModule`.
 */
export const findSentencesFromPieces: (data: {
  file: string;
  source: string;
  readModule?: ModuleReader | undefined;
  reader?: ScopeReader | undefined;
}) => Array<JoinedPieceFinding> = (data: {
  file: string;
  source: string;
  readModule?: ModuleReader | undefined;
  reader?: ScopeReader | undefined;
}): Array<JoinedPieceFinding> => {
  const sourceFile: ts.SourceFile = parse(data.file, data.source);
  const reader: ScopeReader =
    data.reader ||
    new ScopeReader(
      data.readModule ||
        ((): string | undefined => {
          return undefined;
        }),
    );
  const context: PieceContext = {
    scope: readScope(data.file, sourceFile),
    reader,
  };
  const findings: Array<JoinedPieceFinding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const parts: Array<LinePart> | undefined = linePartsOf(node, context);

    if (
      parts &&
      parts.some((part: LinePart): boolean => {
        return part.kind === "piece";
      })
    ) {
      const kinds: Array<JoinedPieceKind> = judgeLine(parts);

      if (kinds.length > 0) {
        findings.push({
          file: data.file,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          text: node
            .getText(sourceFile)
            .replace(WHITESPACE_RUN, " ")
            .slice(0, 160),
          kinds,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
};

/*
 * Lines still joined on purpose, by file and the start of the line as the
 * failure prints it, each with why it is no sentence built from pieces.
 * Each must still match: an entry left behind by a fix fails.
 */
export const JOINED_ON_PURPOSE: ReadonlyArray<{
  file: string;
  text: string;
  why: string;
}> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Cloud/CloudSetupGuide.ts",
    text: "`**${context.translator.translateText(tab.label) || tab.label}** — ${tab.description}`",
    why: "A Markdown bullet: a tab's name in bold, a dash, then what it is - a term and its definition, not a sentence.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/DatabaseMonitor/DatabaseMonitorStepForm.tsx",
    text: "`${translator.translateText(groupDescriptions[group])} ${translator.translateText(getPrivilegeHint(databaseType, group))}`",
    why: "Two whole sentences, what a metric group is and the grant it needs, each looked up by its group.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer.tsx",
    text: "`${translator.translateText(baseText)} — ${hint}`",
    why: "A button's tooltip: what it does, then what it leaves out, each a whole sentence in the reader's language.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/NamePatternInput.tsx",
    text: "`${chip.token} - ${translator.translateText(chip.description)}`",
    why: "A name pattern's token, as typed ({site.code}), then what it stands for: code and its definition.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleReadiness.tsx",
    text: "`${translator.translateTerm(method.methodType)} ${ method.maskedIdentifier }`",
    why: 'A notification method\'s kind and its masked address ("SMS +1 ••• 0100"), an item of the list a sentence holds.',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil.ts",
    text: "`${saved}${translator.translateTemplate(",
    why: "Two whole sentences: what was saved, ending with its own space (none after a full-width stop), then what the token refresh did.",
  },
];

interface RepositoryScan {
  findings: Array<JoinedPieceFinding>;
  files: Array<string>;
}

let repositoryScan: RepositoryScan | undefined = undefined;

const scanRepository: () => RepositoryScan = (): RepositoryScan => {
  if (repositoryScan) {
    return repositoryScan;
  }

  const texts: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();

  const readModule: ModuleReader = (file: string): string | undefined => {
    if (texts.has(file)) {
      return texts.get(file);
    }

    const absolute: string = path.join(REPOSITORY_ROOT, file);
    const text: string | undefined = fs.existsSync(absolute)
      ? fs.readFileSync(absolute, "utf8")
      : undefined;
    texts.set(file, text);

    return text;
  };

  const reader: ScopeReader = new ScopeReader(readModule);
  const findings: Array<JoinedPieceFinding> = [];
  const files: Array<string> = [];

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const absolute of listSourceFiles(root)) {
      const file: string = toRelativePath(REPOSITORY_ROOT, absolute);
      const source: string = fs.readFileSync(absolute, "utf8");

      files.push(file);
      findings.push(...findSentencesFromPieces({ file, source, reader }));
    }
  }

  repositoryScan = { findings, files };

  return repositoryScan;
};

const isJoinedOnPurpose: (finding: JoinedPieceFinding) => boolean = (
  finding: JoinedPieceFinding,
): boolean => {
  return JOINED_ON_PURPOSE.some(
    (entry: { file: string; text: string }): boolean => {
      return entry.file === finding.file && finding.text.startsWith(entry.text);
    },
  );
};

// The kinds a fixture's lines are found for, one line each.
const kindsOf: (source: string, file?: string) => Array<string> = (
  source: string,
  file: string = "packages/App/FeatureSet/Dashboard/src/Fixture.tsx",
): Array<string> => {
  return findSentencesFromPieces({ file, source }).map(
    (finding: JoinedPieceFinding): string => {
      return `${finding.text} => ${finding.kinds.join("; ")}`;
    },
  );
};

describe("sentences built from translated pieces", () => {
  test("no frontend joins a translated phrase into a sentence", () => {
    const { findings } = scanRepository();

    const offenders: Array<string> = findings
      .filter((finding: JoinedPieceFinding): boolean => {
        return !isJoinedOnPurpose(finding);
      })
      .map((finding: JoinedPieceFinding): string => {
        return `${finding.file}:${finding.line} (${finding.kinds.join("; ")}) ${finding.text}`;
      });

    /*
     * Make each one sentence with its values as {{placeholders}}:
     * translator.translateTemplate("Remove condition {{number}}", { number:
     * translator.formatNumber(index + 1) }), translatePlural for a count,
     * a nested key with i18next's {{value}}, or TranslatedSentence around
     * an element - then give the new key a wording in every language.
     */
    expect(offenders).toEqual([]);
  });

  test("every line joined on purpose is still there, and says why", () => {
    const { findings } = scanRepository();

    const stale: Array<string> = JOINED_ON_PURPOSE.filter(
      (entry: { file: string; text: string }): boolean => {
        return !findings.some((finding: JoinedPieceFinding): boolean => {
          return (
            finding.file === entry.file && finding.text.startsWith(entry.text)
          );
        });
      },
    ).map((entry: { file: string; text: string }): string => {
      return `${entry.file}: ${entry.text}`;
    });

    expect(stale).toEqual([]);

    for (const entry of JOINED_ON_PURPOSE) {
      expect({ entry: entry.text, why: entry.why.length > 20 }).toEqual({
        entry: entry.text,
        why: true,
      });
    }
  });

  test("the scan reads every frontend, and the lines this issue fixed", () => {
    const { files, findings } = scanRepository();

    expect(files.length).toBeGreaterThan(1000);

    const fixed: Array<string> = [
      "packages/Common/UI/Components/ActionButton/RowActions.tsx",
      "packages/Common/UI/Components/Filters/FiltersForm.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterBuilder.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterChips.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplatePicker.tsx",
      "packages/App/FeatureSet/StatusPage/src/Pages/Incidents/Detail.tsx",
    ];

    expect(files).toEqual(expect.arrayContaining(fixed));

    for (const file of fixed) {
      expect({
        file,
        findings: findings.filter((finding: JoinedPieceFinding): boolean => {
          return finding.file === file;
        }).length,
      }).toEqual({ file, findings: 0 });
    }
  });
});

describe("the lines this issue was about are found", () => {
  test("a row's ⋯ button: a phrase, then the row's name", () => {
    // RowActions before the fix.
    expect(
      kindsOf(
        'const label = `${translateString("More actions for") || "More actions for"} ${props.itemLabel}`;',
      ),
    ).toEqual([
      '`${translateString("More actions for") || "More actions for"} ${props.itemLabel}` => a value joined to a translated phrase',
    ]);
  });

  test("Remove condition 2, its number in Latin digits", () => {
    // CorrelateFilterBuilder and CorrelateFilterChips before the fix.
    expect(
      kindsOf('const label = `${t("Remove condition")} ${index + 1}`;'),
    ).toEqual([
      '`${t("Remove condition")} ${index + 1}` => a value joined to a translated phrase',
    ]);
  });

  test("View: name, English's colon in every language", () => {
    // SecurityPlaybookTemplatePicker before the fix.
    expect(
      kindsOf(
        'const a = `${translator.translateText("View") || "View"}: ${name}`;',
      ),
    ).toEqual([
      '`${translator.translateText("View") || "View"}: ${name}` => a value joined to a translated phrase',
    ]);
  });

  test("Clear Status filter: three pieces in English's order", () => {
    // FiltersForm before the fix.
    expect(
      kindsOf(
        'const a = `${tx("Clear")} ${tx(filter.title)} ${tx("filter")}`;',
      ),
    ).toEqual([
      '`${tx("Clear")} ${tx(filter.title)} ${tx("filter")}` => translated phrases joined',
    ]);
  });

  test("a count beside its noun, and a count beside 'of'", () => {
    // CorrelateGraph and TopologyPage before the fix.
    expect(
      kindsOf(
        [
          'const a = `${resultFilter.conditions.length} ${t("conditions")}`;',
          'const b = `${shown} ${translateString("of")} ${total} ${translateString("resources shown.")}`;',
        ].join("\n"),
      ),
    ).toEqual([
      '`${resultFilter.conditions.length} ${t("conditions")}` => a value joined to a translated phrase',
      '`${shown} ${translateString("of")} ${total} ${translateString("resources shown.")}` => a value joined to a translated phrase',
    ]);
  });

  test("a status page's date glued to its phrase with +", () => {
    // StatusPage's incident, announcement and maintenance pages before the fix.
    expect(
      kindsOf(
        'const a = i18n.t("incidents.declaredAt") + OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(at);',
      ),
    ).toEqual([
      'i18n.t("incidents.declaredAt") + OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(at) => a value joined to a translated phrase',
    ]);
  });

  test("English words and punctuation written beside a piece", () => {
    // WorkflowTemplatePicker's screen reader words before the fix.
    expect(
      kindsOf(
        [
          'const a = `${tx("Trigger")}: `;',
          'const b = `, ${tx("Secret")}`;',
          'const c = `Search ${t("templates")}`;',
        ].join("\n"),
      ),
    ).toEqual([
      '`${tx("Trigger")}: ` => punctuation written beside a translated phrase',
      '`, ${tx("Secret")}` => punctuation written beside a translated phrase',
      '`Search ${t("templates")}` => English words written beside a translated phrase',
    ]);
  });

  test("pieces joined with a space by join()", () => {
    expect(
      kindsOf('const a = [t("Show"), name, t("on map")].join(" ");'),
    ).toEqual([
      '[t("Show"), name, t("on map")].join(" ") => a value joined to a translated phrase',
    ]);
  });

  test("a constant imported from a copy module is read for its English", () => {
    const modules: Record<string, string> = {
      "packages/App/FeatureSet/Dashboard/src/Copy.ts":
        'export const Copy = { lead: translationKey("Remove"), sentence: translationKey("It could not be loaded.") };',
    };
    const readModule: ModuleReader = (file: string): string | undefined => {
      return modules[file];
    };

    expect(
      findSentencesFromPieces({
        file: "packages/App/FeatureSet/Dashboard/src/Page.tsx",
        source: [
          'import { Copy } from "./Copy";',
          "const a = `${translator.translateText(Copy.lead)} ${name}`;",
          "const b = `${translator.translateText(Copy.sentence)} ${reason}`;",
        ].join("\n"),
        readModule,
      }).map((finding: JoinedPieceFinding): string => {
        return finding.text;
      }),
    ).toEqual(["`${translator.translateText(Copy.lead)} ${name}`"]);
  });

  test("a copy module's default export is read through its name", () => {
    // As ee/AdminDashboard/SessionLength reads SessionLengthCopy.
    const modules: Record<string, string> = {
      "ee/AdminDashboard/Words/WordsCopy.ts": [
        "export const WordsCopy = {",
        '  includesYou: translationKey("That includes you: you will be signed out."),',
        '  forYou: translationKey("for you"),',
        "};",
        "export default WordsCopy;",
      ].join("\n"),
    };

    expect(
      findSentencesFromPieces({
        file: "ee/AdminDashboard/Words/WordsPage.tsx",
        source: [
          'import WordsCopy from "./WordsCopy";',
          'const a = `${signsOut} ${translator.translateText(WordsCopy.includesYou) || ""}`;',
          'const b = `${signsOut} ${translator.translateText(WordsCopy.forYou) || ""}`;',
        ].join("\n"),
        readModule: (file: string): string | undefined => {
          return modules[file];
        },
      }).map((finding: JoinedPieceFinding): string => {
        return finding.text;
      }),
    ).toEqual([
      '`${signsOut} ${translator.translateText(WordsCopy.forYou) || ""}`',
    ]);
  });
});

describe("what is not a sentence built from pieces", () => {
  test("one template with its values as placeholders", () => {
    expect(
      kindsOf(
        [
          'const a = translator.translateTemplate("More actions for {{name}}", { name });',
          'const b = translator.translatePlural({ one: "{{count}} event", other: "{{count}} events" }, n);',
          'const c = i18n.t("incidents.declaredAtTime", { time });',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("two whole sentences, side by side or on lines of their own", () => {
    expect(
      kindsOf(
        [
          'const a = `${t("It could not be saved.")} ${t("Try again in a minute.")}`;',
          'const b = `${reason} ${translator.translateText("Ask an admin to change it.")}`;',
          "const c = `${translator.translateText(copy.title)}. ${translator.translateText(copy.description)}`;",
          'const d = [t("First line"), "", t("second line")].join("\\n");',
          'const e = [t("Checked {{time}}."), t("Nothing found.")].join(" ");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a label with its own colon, then its value", () => {
    expect(
      kindsOf(
        'const a = `${translator.translateText("Duration:")} ${durationStr}`;',
      ),
    ).toEqual([]);
  });

  test("facts set apart on a line, a path, and an aside in brackets", () => {
    expect(
      kindsOf(
        [
          "const a = `${name} · ${translateString(status) || status}`;",
          'const b = `${words}${getInlineSeparator(translator.language)}${translator.translateText("Paused")}`;',
          'const c = `${t("Cloud")} > ${t("Connect")}`;',
          'const d = `${translator.translateText(m.friendlyName)}${m.unit ? ` (${m.unit})` : ""}`;',
          "const e = `${tx(action.label)} (${action.shortcut})`;",
          'const f = [t("{{count}} up"), t("{{count}} down")].join(" / ");',
          'const g = ` · ${translator.translateText("Paused")}`;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a mark of no letters, and an aside a constant starts with", () => {
    expect(
      kindsOf(
        [
          'const MARKER: string = "⇄";',
          'const tzSuffix: string = timezone ? ` (${timezone})` : "";',
          'const a = `${MARKER} ${translateTemplate("{{substitute}} (covering {{original}})", values)}`;',
          'const b = `${translateTemplate("Daily {{start}} – {{end}}", values)}${tzSuffix}`;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a piece on its own, and code that joins no piece", () => {
    expect(
      kindsOf(
        [
          'const a = `${translator.translateText("Name")}`;',
          "const b = `${first} ${last}`;",
          'const c = "Remove condition " + (index + 1);',
          'const d = translatableTerm("Monitor") + "";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("the rule's pieces", () => {
  test("a whole sentence starts as one and ends with its stop", () => {
    expect(isWholeSentence(["It could not be loaded."])).toBe(true);
    expect(isWholeSentence(["{{count}} rows skipped."])).toBe(true);
    expect(isWholeSentence(['"{{name}}" was saved!'])).toBe(true);
    expect(isWholeSentence(["Is it on?"])).toBe(true);
    expect(isWholeSentence(["is down."])).toBe(false);
    expect(isWholeSentence(["More actions for"])).toBe(false);
    expect(isWholeSentence(["Duration:"])).toBe(false);
    expect(isWholeSentence([])).toBe(false);
    expect(isWholeSentence(["It is done.", "Remove"])).toBe(false);
  });

  test("a label carries its own colon", () => {
    expect(isLabelWithColon(["Duration:"])).toBe(true);
    expect(isLabelWithColon(["Self Time:", "Duration:"])).toBe(true);
    expect(isLabelWithColon(["Duration"])).toBe(false);
    expect(isLabelWithColon(["at:"])).toBe(false);
  });

  test("an import is found where the app resolves it", () => {
    const files: ReadonlySet<string> = new Set<string>([
      "packages/App/FeatureSet/Dashboard/src/Components/Copy.ts",
      "packages/Common/UI/Utils/Words/index.ts",
    ]);
    const exists: (file: string) => boolean = (file: string): boolean => {
      return files.has(file);
    };

    expect(
      resolveModulePath(
        "packages/App/FeatureSet/Dashboard/src/Components/Page/Page.tsx",
        "../Copy",
        exists,
      ),
    ).toBe("packages/App/FeatureSet/Dashboard/src/Components/Copy.ts");
    expect(
      resolveModulePath(
        "packages/App/FeatureSet/Dashboard/src/Page.tsx",
        "Common/UI/Utils/Words",
        exists,
      ),
    ).toBe("packages/Common/UI/Utils/Words/index.ts");
    expect(
      resolveModulePath(
        "packages/App/FeatureSet/Dashboard/src/Page.tsx",
        "react",
        exists,
      ),
    ).toBeUndefined();
  });

  test("a line's parts are judged on each side of a piece", () => {
    expect(
      judgeLine([
        { kind: "piece", isSentence: false, isLabel: false },
        { kind: "text", text: " " },
        { kind: "value", leading: "", trailing: "" },
      ]),
    ).toEqual([JoinedPieceKind.Value]);
    expect(
      judgeLine([
        { kind: "value", leading: "", trailing: "" },
        { kind: "text", text: " · " },
        { kind: "piece", isSentence: false, isLabel: false },
      ]),
    ).toEqual([]);
    expect(
      judgeLine([
        { kind: "piece", isSentence: true, isLabel: false },
        { kind: "text", text: " " },
        { kind: "value", leading: "", trailing: "" },
      ]),
    ).toEqual([]);
    expect(
      judgeLine([
        { kind: "piece", isSentence: true, isLabel: false },
        { kind: "text", text: ": " },
        { kind: "value", leading: "", trailing: "" },
      ]),
    ).toEqual([JoinedPieceKind.Value]);
    expect(
      judgeLine([
        { kind: "value", leading: "", trailing: "" },
        { kind: "text", text: " " },
        { kind: "piece", isSentence: false, isLabel: true },
      ]),
    ).toEqual([JoinedPieceKind.Value]);
  });
});

describe("a fixed line put back to joining words fails the guard", () => {
  // Mutation check (#8076): the row's ⋯ button, as RowActions wrote it.
  test("RowActions with its name tacked on again", () => {
    const file: string =
      "packages/Common/UI/Components/ActionButton/RowActions.tsx";
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );
    const sentence: RegExp =
      /translator\.translateTemplate\(\s*"More actions for \{\{name\}\}",\s*\{\s*name: props\.itemLabel,?\s*\},?\s*\)/;

    expect(source).toMatch(sentence);
    expect(findSentencesFromPieces({ file, source })).toEqual([]);

    const putBack: string = source.replace(
      sentence,
      '`${translateString("More actions for") || "More actions for"} ${props.itemLabel}`',
    );

    expect(
      findSentencesFromPieces({ file, source: putBack }).map(
        (finding: JoinedPieceFinding): string => {
          return finding.kinds.join("; ");
        },
      ),
    ).toEqual([JoinedPieceKind.Value]);
  });

  test("the Correlate builder's remove button with its number joined again", () => {
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterBuilder.tsx";
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );
    const sentence: RegExp =
      /translator\.translateTemplate\(\s*"Remove condition \{\{number\}\}",\s*\{\s*number: translator\.formatNumber\(index \+ 1\)\s*\},?\s*\)/;

    expect(source).toMatch(sentence);

    const putBack: string = source.replace(
      sentence,
      '`${t("Remove condition")} ${index + 1}`',
    );

    expect(findSentencesFromPieces({ file, source: putBack })).toHaveLength(1);
  });
});
