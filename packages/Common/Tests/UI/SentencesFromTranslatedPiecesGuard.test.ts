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
 * A child element is read as what it draws (#8483): a value component (a
 * <Pill>, a <UserElement>, any *Element name) or an inline element holding
 * a value (<span className="font-medium">{props.eventType}</span>, <time>,
 * <bdi>) is a value of the sentence; a link (<Link>, <a>) or an inline
 * fragment around a translated phrase is that phrase, and so are words only
 * a screen reader reads (sr-only). EventItem's "Incident state changed to
 * <Pill>" kept English's order that way until #8290 made it one sentence.
 * An element before a phrase with nothing written between is spaced by its
 * own margin, a word of the sentence.
 *
 * A page's own translation helper counts as the translation it returns
 * (#8571): CodeProductionReview's `text(COPY.openSettings)`, a function of
 * the file whose every return is a translation, is a piece whose key is its
 * argument where the translation reads it, else the helper's own sentence.
 * A colon or a comma the code writes right after an element that holds a
 * translated phrase (`<span>{t("Logo Alt Text")}</span>{": "}`) is
 * English's punctuation, as it is after a phrase on its own; a label's
 * colon comes from LABEL_WITH_COLON. An element's key, id, class or test
 * handle, a name that holds one, and a search's lowercased haystack are
 * never drawn, and are no line of the page.
 *
 * This reads every frontend's source (each feature set's src, Common/UI and
 * the Enterprise screens) through the TypeScript AST, and fails on a
 * translated piece - what t(), tx(), translateText(), translateString(),
 * translateTemplate(), translatePlural() or translateTerm() returns -
 * joined into one line with something else by a template literal, by + or
 * by [...].join(), or drawn beside it in an element's children (#8290):
 * `{t("Showing")} {n} {t("of")} {total}` read "Page 2 of 5" in English's
 * order in Japanese, and `{count} {t(count === 1 ? "caller" :
 * "callers")}` took English's 1-or-more plural. A name that holds a
 * translation counts as the call it holds (`const keyTitle =
 * translator.translateText("Key")`, then `${keyTitle} ${index + 1}`):
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
 *   - a mark of no letters before a sentence ("⇄ Ada (covering Bob)"), a
 *     constant of this module or one it imports (OVERRIDE_TITLE_MARKER);
 *   - in JSX, two expressions with nothing drawn between them, an icon
 *     beside its word ({icon}, {pill.icon}) or a badge beside its count;
 *   - a child element that is no word of a sentence: an icon, a tooltip, a
 *     control, a block (a <div>, a link drawn as a block), a rounded badge
 *     or chip, what is drawn for the eye only (aria-hidden), a mark of no
 *     letters (a required "*"), an icon or a number in a step's place; an
 *     element after a word with nothing between (its count: "All 42"), and
 *     two elements side by side (a row of links);
 *   - a link that is an action of its own - its phrase starts as a
 *     sentence does ("Read the guide", "Open settings") - after a sentence,
 *     a value or a phrase whose English cannot be read: a hint, then what
 *     to do about it. After a phrase read as one ("Read the"), it is a word
 *     of that phrase's sentence.
 *
 * A piece's English is read from its call: a literal, a constant of the
 * same module or one it imports (BackupsCopy.couldNotLoad), a plural's
 * other form, every text of a constant table it looks up
 * (FINISHED_FIX_SENTENCES[outcome]), a nested key's default or what its
 * feature set's English locale says ("login.noAccountPrompt" is "Don't
 * have an account?"). A piece whose English cannot be read (a variable, a
 * lookup by key) counts as a phrase, not a sentence. What still has to be joined
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

// An expression that draws an icon: {icon}, {pill.icon}, {statusIcon} (#8483).
const ICON_NAME: RegExp = /(^i|I)con$/;

/*
 * A whole sentence: its English starts with a capital, a figure, a value, a
 * quote or a name written with a small first letter ("vCenter has not
 * reported it."), and ends with a full stop, a question or an exclamation
 * mark.
 */
const SENTENCE_START: RegExp = /^(?:[A-Z0-9{"'“«(¿¡…]|[a-z]+[A-Z])/;
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

// Clause punctuation that starts what follows: ": " after a label.
const PUNCTUATION_AFTER: RegExp = /^\s*[:,;：，]/;

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

  private readonly locales: Map<string, unknown> = new Map<string, unknown>();

  public constructor(private readonly readModule: ModuleReader) {}

  public exists(file: string): boolean {
    return this.readModule(file) !== undefined;
  }

  /*
   * What a nested key says in English, in the English locale of the
   * feature set the file is in: Accounts' "login.noAccountPrompt" is
   * "Don't have an account?".
   */
  public englishOfNestedKey(file: string, key: string): string | undefined {
    const featureSet: RegExpMatchArray | null = file.match(
      /^(packages\/App\/FeatureSet\/[^/]+\/src)\//,
    );

    if (!featureSet) {
      return undefined;
    }

    const localeFile: string = `${featureSet[1]}/Locales/en.json`;

    if (!this.locales.has(localeFile)) {
      const text: string | undefined = this.readModule(localeFile);
      let locale: unknown = undefined;

      try {
        locale = text === undefined ? undefined : JSON.parse(text);
      } catch {
        locale = undefined;
      }

      this.locales.set(localeFile, locale);
    }

    let current: unknown = this.locales.get(localeFile);

    for (const part of key.split(".")) {
      current =
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined;
    }

    return typeof current === "string" ? current : undefined;
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

/*
 * The call a translated piece is, behind a "|| fallback" or a "?? fallback",
 * or the translation a page's own helper returns (#8571).
 */
const translationCallOf: (
  expression: ts.Expression,
  depth?: number,
) => ts.CallExpression | undefined = (
  expression: ts.Expression,
  depth: number = 0,
): ts.CallExpression | undefined => {
  const current: ts.Expression = unwrap(expression);

  if (ts.isCallExpression(current)) {
    const name: string | undefined = calleeName(current.expression);

    if (name && TRANSLATION_CALL.test(name)) {
      return NOT_A_PIECE.has(name) ? undefined : current;
    }

    return helperTranslationCallOf(current, depth);
  }

  if (
    ts.isBinaryExpression(current) &&
    (current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return translationCallOf(current.left, depth);
  }

  return undefined;
};

type HelperFunction =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration;

/*
 * The function a name calls, where this file declares it in a block around
 * the call: `const text = (key: string): string => ...`, `function text()`.
 * Read by scope, as a name's constant is; a parameter of that name hides it.
 */
const functionInScopeOf: (
  identifier: ts.Identifier,
) => HelperFunction | undefined = (
  identifier: ts.Identifier,
): HelperFunction | undefined => {
  const name: string = identifier.text;
  let node: ts.Node | undefined = identifier.parent;

  while (node) {
    if (
      ts.isFunctionLike(node) &&
      node.parameters.some((parameter: ts.ParameterDeclaration): boolean => {
        return ts.isIdentifier(parameter.name) && parameter.name.text === name;
      })
    ) {
      return undefined;
    }

    if (isDeclaringNode(node)) {
      for (const statement of node.statements) {
        if (
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === name
        ) {
          return statement;
        }

        if (!ts.isVariableStatement(statement)) {
          continue;
        }

        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name
          ) {
            const initializer: ts.Expression | undefined =
              declaration.initializer
                ? unwrap(declaration.initializer)
                : undefined;

            return initializer &&
              (ts.isArrowFunction(initializer) ||
                ts.isFunctionExpression(initializer))
              ? initializer
              : undefined;
          }
        }
      }
    }

    node = node.parent;
  }

  return undefined;
};

/*
 * The translation a function returns: its expression body, or its first
 * return - where every return is one. A function that returns a
 * translation on one path and a name as written on another
 * (getFirstName's "this user") is no translation helper.
 */
const returnedTranslationOf: (
  helper: HelperFunction,
  depth: number,
) => ts.CallExpression | undefined = (
  helper: HelperFunction,
  depth: number,
): ts.CallExpression | undefined => {
  const body: ts.ConciseBody | undefined = helper.body;

  if (!body) {
    return undefined;
  }

  if (!ts.isBlock(body)) {
    return translationCallOf(body, depth);
  }

  const returned: Array<ts.Expression | undefined> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // A function inside it returns for itself.
    if (ts.isFunctionLike(node)) {
      return;
    }

    if (ts.isReturnStatement(node)) {
      returned.push(node.expression);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);

  const calls: Array<ts.CallExpression | undefined> = returned.map(
    (expression: ts.Expression | undefined): ts.CallExpression | undefined => {
      return expression ? translationCallOf(expression, depth) : undefined;
    },
  );

  return calls.length > 0 &&
    calls.every((call: ts.CallExpression | undefined): boolean => {
      return call !== undefined;
    })
    ? calls[0]
    : undefined;
};

/*
 * Whether an expression reads a name, itself or through a const of the
 * function it is in: `inReviewHostWords(key, provider)` reads "key", and so
 * does `sentence` after `const sentence = inReviewHostWords(key, ...)`.
 */
const readsName: (
  expression: ts.Node,
  name: string,
  depth: number,
) => boolean = (expression: ts.Node, name: string, depth: number): boolean => {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (
      ts.isIdentifier(node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      if (node.text === name) {
        found = true;
        return;
      }

      const initializer: ts.Expression | undefined =
        depth < MAX_RESOLVE_DEPTH ? initializerInScopeOf(node) : undefined;

      if (initializer && readsName(initializer, name, depth + 1)) {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(expression);

  return found;
};

const helperCalls: WeakMap<ts.CallExpression, ts.CallExpression | null> =
  new WeakMap<ts.CallExpression, ts.CallExpression | null>();

/*
 * A call to a page's own translation helper (#8571): a function of this
 * file that returns a translation, as CodeProductionReview's `const text =
 * (key) => translator.translateText(inReviewHostWords(key, ...)) || key`.
 * Where the translation's key is read from the helper's first parameter,
 * the call is a piece whose key is its own first argument
 * (`text(COPY.openSettings)`); otherwise the helper says its own sentence,
 * and the piece is the translation it returns.
 */
const helperTranslationCallOf: (
  call: ts.CallExpression,
  depth: number,
) => ts.CallExpression | undefined = (
  call: ts.CallExpression,
  depth: number,
): ts.CallExpression | undefined => {
  if (!ts.isIdentifier(call.expression) || depth > MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  if (helperCalls.has(call)) {
    return helperCalls.get(call) || undefined;
  }

  // Asked again while it is being read (a helper calling itself): no piece.
  helperCalls.set(call, null);

  const helper: HelperFunction | undefined = functionInScopeOf(call.expression);
  const inner: ts.CallExpression | undefined = helper
    ? returnedTranslationOf(helper, depth + 1)
    : undefined;
  const parameter: ts.ParameterDeclaration | undefined = helper?.parameters[0];
  const key: ts.Expression | undefined = inner?.arguments[0];
  const readsItsArgument: boolean = Boolean(
    parameter &&
      ts.isIdentifier(parameter.name) &&
      key &&
      readsName(key, parameter.name.text, 0),
  );
  const result: ts.CallExpression | undefined = inner
    ? readsItsArgument
      ? call
      : inner
    : undefined;

  helperCalls.set(call, result || null);

  return result;
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

  /*
   * A lookup in a constant table, FINISHED_FIX_SENTENCES[outcome]: every
   * text the table holds (#8483).
   */
  if (ts.isElementAccessExpression(current)) {
    const tableName: string | undefined = dottedName(current.expression);
    const table: { expression: ts.Expression; scope: ModuleScope } | undefined =
      tableName
        ? context.reader.resolve(context.scope, tableName, 0)
        : undefined;
    const literal: ts.Expression | undefined = table
      ? unwrap(table.expression)
      : undefined;

    if (!table || !literal) {
      return undefined;
    }

    // An entry the table spreads in, or writes as a method, is not read.
    const entries: Array<ts.Expression | undefined> =
      ts.isObjectLiteralExpression(literal)
        ? literal.properties.map(
            (
              property: ts.ObjectLiteralElementLike,
            ): ts.Expression | undefined => {
              return ts.isPropertyAssignment(property)
                ? property.initializer
                : undefined;
            },
          )
        : ts.isArrayLiteralExpression(literal)
          ? Array.from(literal.elements)
          : [];
    const texts: Array<string> = [];

    for (const entry of entries) {
      const english: Array<string> | undefined = entry
        ? englishOf(
            entry,
            { scope: table.scope, reader: context.reader },
            depth + 1,
          )
        : undefined;

      if (!english) {
        return undefined;
      }

      texts.push(...english);
    }

    return texts.length > 0 ? texts : undefined;
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

// An i18next nested key: "login.noAccountPrompt", "eventItem.postedOn".
const NESTED_KEY: RegExp = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;

/*
 * The English a translated piece says: its key's, or for a nested key, the
 * default it is called with (t("eventItem.postedOn", "posted on"), {
 * defaultValue }) or what the feature set's English locale says (#8483).
 */
const pieceEnglishOf: (
  call: ts.CallExpression,
  context: PieceContext,
  depth: number,
) => Array<string> | undefined = (
  call: ts.CallExpression,
  context: PieceContext,
  depth: number,
): Array<string> | undefined => {
  const key: ts.Expression | undefined = call.arguments[0];
  // A choice of a text or nothing ("") draws the text, or nothing at all.
  const read: Array<string> | undefined = key
    ? englishOf(key, context, depth)
    : undefined;
  const english: Array<string> | undefined =
    read &&
    read.some((text: string): boolean => {
      return text !== "";
    })
      ? read.filter((text: string): boolean => {
          return text !== "";
        })
      : read;

  if (!english || english.length !== 1 || !NESTED_KEY.test(english[0] || "")) {
    return english;
  }

  const fallback: ts.Expression | undefined = call.arguments[1]
    ? unwrap(call.arguments[1])
    : undefined;

  if (
    fallback &&
    (ts.isStringLiteral(fallback) ||
      ts.isNoSubstitutionTemplateLiteral(fallback))
  ) {
    return [fallback.text];
  }

  if (fallback && ts.isObjectLiteralExpression(fallback)) {
    for (const property of fallback.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "defaultValue"
      ) {
        const value: ts.Expression = unwrap(property.initializer);

        if (
          ts.isStringLiteral(value) ||
          ts.isNoSubstitutionTemplateLiteral(value)
        ) {
          return [value.text];
        }
      }
    }
  }

  const fromLocale: string | undefined = context.reader.englishOfNestedKey(
    context.scope.file,
    english[0] as string,
  );

  // A nested key whose English cannot be found is read as nothing, not as its key.
  return fromLocale === undefined ? undefined : [fromLocale];
};

type LinePart =
  | { kind: "text"; text: string }
  | {
      kind: "piece";
      isSentence: boolean;
      isLabel: boolean;
      // Its English was read: a literal, a constant, a nested key's default.
      isRead?: boolean | undefined;
      // Its English starts as a sentence does: with a capital, a figure or a quote.
      startsAsSentence?: boolean | undefined;
      // A child element that draws the phrase: <Link>{t("docs")}</Link> (#8483).
      isElement?: boolean | undefined;
      // A link that is a call to action of its own: <Link>{t("Read the guide")}</Link>.
      isCallToAction?: boolean | undefined;
      // What an element drawing the phrase starts and ends with: <>{" "}<Link>...</Link></>.
      leading?: string | undefined;
      trailing?: string | undefined;
    }
  | {
      kind: "separator";
      /*
       * An element that holds a translated phrase of its own, a label in a
       * <span> or a <b>: what the code writes right after it is read (#8571).
       */
      holdsPhrase?: boolean | undefined;
    }
  | {
      kind: "value";
      leading: string;
      trailing: string;
      // The value is one whole translated sentence: ` ${t("It is linked.")}`.
      isSentence?: boolean | undefined;
      // A child element that draws the value: a pill, a name, a date (#8483).
      isElement?: boolean | undefined;
    };

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

  /*
   * A template starts with its head, and where the head is only spaces,
   * with what its first value starts with: ` ${t("(truncated)")}` starts
   * with " (".
   */
  if (ts.isTemplateExpression(current)) {
    const first: ts.TemplateSpan | undefined = current.templateSpans[0];
    const last: ts.TemplateSpan | undefined =
      current.templateSpans[current.templateSpans.length - 1];

    if (side === "leading") {
      const inner: string | undefined =
        first && current.head.text.trim() === ""
          ? edgeTextOf(first.expression, side, context, depth + 1)
          : undefined;

      return current.head.text + (inner || "");
    }

    if (!last) {
      return undefined;
    }

    const inner: string | undefined =
      last.literal.text.trim() === ""
        ? edgeTextOf(last.expression, side, context, depth + 1)
        : undefined;

    return (inner || "") + last.literal.text;
  }

  /*
   * A translated piece starts and ends with the mark its English does: the
   * bracket of "(truncated)" sets it apart as an aside wherever it is drawn.
   */
  const call: ts.CallExpression | undefined = translationCallOf(current);

  if (call) {
    const english: Array<string> | undefined = pieceEnglishOf(
      call,
      context,
      depth + 1,
    );
    const edges: Array<string> = (english || []).map((text: string): string => {
      const trimmed: string = text.trim();
      return side === "leading" ? trimmed.charAt(0) : trimmed.slice(-1);
    });

    // Only a mark: the piece's own words are no words written beside it.
    return edges.length > 0 &&
      edges[0] !== "" &&
      !LETTER_OR_FIGURE.test(edges[0] as string) &&
      edges.every((edge: string): boolean => {
        return edge === edges[0];
      })
      ? edges[0]
      : undefined;
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

    if (constant) {
      return edgeTextOf(constant, side, context, depth + 1);
    }
  }

  /*
   * A constant another module exports: OverridePresentation's
   * OVERRIDE_TITLE_MARKER, "⇄".
   */
  const name: string | undefined =
    ts.isIdentifier(current) || ts.isPropertyAccessExpression(current)
      ? dottedName(current)
      : undefined;
  const resolved:
    | { expression: ts.Expression; scope: ModuleScope }
    | undefined = name
    ? context.reader.resolve(context.scope, name, 0)
    : undefined;

  return resolved
    ? edgeTextOf(
        resolved.expression,
        side,
        { scope: resolved.scope, reader: context.reader },
        depth + 1,
      )
    : undefined;
};

// Statements that declare names a block's code can read.
type DeclaringNode = ts.Block | ts.SourceFile | ts.ModuleBlock | ts.CaseClause;

const isDeclaringNode: (node: ts.Node) => node is DeclaringNode = (
  node: ts.Node,
): node is DeclaringNode => {
  return (
    ts.isBlock(node) ||
    ts.isSourceFile(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseClause(node)
  );
};

/*
 * What a name read here was declared with: the nearest `const name = ...`
 * of a block around it, or undefined where a parameter, a destructured
 * name or nothing declares it. Read by scope, so two functions' own
 * `label`s are never taken for each other.
 */
const initializerInScopeOf: (
  identifier: ts.Identifier,
) => ts.Expression | undefined = (
  identifier: ts.Identifier,
): ts.Expression | undefined => {
  const name: string = identifier.text;
  let node: ts.Node | undefined = identifier.parent;

  while (node) {
    if (ts.isFunctionLike(node)) {
      const declaresIt: boolean = node.parameters.some(
        (parameter: ts.ParameterDeclaration): boolean => {
          return (
            ts.isIdentifier(parameter.name) && parameter.name.text === name
          );
        },
      );

      if (declaresIt) {
        return undefined;
      }
    }

    if (isDeclaringNode(node)) {
      for (const statement of node.statements) {
        if (!ts.isVariableStatement(statement)) {
          continue;
        }

        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name
          ) {
            return declaration.initializer;
          }
        }
      }
    }

    node = node.parent;
  }

  return undefined;
};

/*
 * A name that holds a translation: `const keyTitle =
 * translator.translateText("Key")`, then `${keyTitle} ${index + 1}` -
 * the piece it holds, as if the call stood there (#8290).
 */
const translatedConstantOf: (
  expression: ts.Expression,
) => ts.CallExpression | undefined = (
  expression: ts.Expression,
): ts.CallExpression | undefined => {
  if (!ts.isIdentifier(expression)) {
    return undefined;
  }

  const initializer: ts.Expression | undefined =
    initializerInScopeOf(expression);

  return initializer ? translationCallOf(initializer) : undefined;
};

/*
 * Whether a value is one whole translated sentence and nothing else, as a
 * second sentence is added after a first: ` ${t("SLOs are linked
 * automatically.")}`, behind a choice between it and nothing, or in a name
 * that holds one (`const expiry = ...`).
 */
const holdsWholeSentence: (
  expression: ts.Expression,
  context: PieceContext,
  depth: number,
) => boolean = (
  expression: ts.Expression,
  context: PieceContext,
  depth: number,
): boolean => {
  if (depth > MAX_RESOLVE_DEPTH) {
    return false;
  }

  const current: ts.Expression = unwrap(expression);
  const call: ts.CallExpression | undefined = translationCallOf(current);

  if (call) {
    const english: Array<string> | undefined = pieceEnglishOf(call, context, 0);

    return english ? isWholeSentence(english) : false;
  }

  if (ts.isTemplateExpression(current)) {
    const span: ts.TemplateSpan | undefined = current.templateSpans[0];

    return (
      current.templateSpans.length === 1 &&
      span !== undefined &&
      current.head.text.trim() === "" &&
      span.literal.text.trim() === "" &&
      holdsWholeSentence(span.expression, context, depth + 1)
    );
  }

  if (ts.isConditionalExpression(current)) {
    const isNothing: (side: ts.Expression) => boolean = (
      side: ts.Expression,
    ): boolean => {
      const value: ts.Expression = unwrap(side);

      return (
        (ts.isStringLiteral(value) ||
          ts.isNoSubstitutionTemplateLiteral(value)) &&
        value.text === ""
      );
    };

    if (isNothing(current.whenFalse)) {
      return holdsWholeSentence(current.whenTrue, context, depth + 1);
    }

    if (isNothing(current.whenTrue)) {
      return holdsWholeSentence(current.whenFalse, context, depth + 1);
    }

    return false;
  }

  if (ts.isIdentifier(current)) {
    const initializer: ts.Expression | undefined =
      initializerInScopeOf(current);

    return initializer
      ? holdsWholeSentence(initializer, context, depth + 1)
      : false;
  }

  return false;
};

/*
 * A piece's edge mark, where it sets the piece apart or ends a sentence:
 * a bracket, a separator, a full stop. A colon or a dash is the piece's own
 * clause punctuation, and stays out.
 */
const markThatSetsApart: (mark: string | undefined) => string = (
  mark: string | undefined,
): string => {
  return mark !== undefined && (APART.test(mark) || AFTER_A_SENTENCE.test(mark))
    ? mark
    : "";
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

  const call: ts.CallExpression | undefined =
    translationCallOf(current) || translatedConstantOf(current);

  if (call) {
    const english: Array<string> | undefined = pieceEnglishOf(call, context, 0);

    return {
      kind: "piece",
      isSentence: english ? isWholeSentence(english) : false,
      isLabel: english ? isLabelWithColon(english) : false,
      /*
       * The mark its English starts or ends with: "(" of "(opens in a new
       * tab)" sets it apart as an aside, "." of "a private link." ends a
       * sentence before what follows it (#8483).
       */
      leading: markThatSetsApart(edgeTextOf(current, "leading", context, 0)),
      trailing: markThatSetsApart(edgeTextOf(current, "trailing", context, 0)),
      isRead: english !== undefined,
      startsAsSentence: english
        ? english.length > 0 &&
          english.every((text: string): boolean => {
            return SENTENCE_START.test(text.trim());
          })
        : false,
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
        isRead: Boolean(whenTrue.isRead && whenFalse.isRead),
        startsAsSentence: Boolean(
          whenTrue.startsAsSentence && whenFalse.startsAsSentence,
        ),
        // "(done)" or "(to do)": an aside either way.
        leading: whenTrue.leading === whenFalse.leading ? whenTrue.leading : "",
        trailing:
          whenTrue.trailing === whenFalse.trailing ? whenTrue.trailing : "",
      };
    }
  }

  const name: string | undefined = ts.isCallExpression(current)
    ? calleeName(current.expression)
    : calleeName(current);

  if (name && (SEPARATOR_NAME.test(name) || ICON_NAME.test(name))) {
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

  return {
    kind: "value",
    leading: leading || "",
    trailing: trailing || "",
    isSentence: holdsWholeSentence(current, context, 0),
  };
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
export interface JudgeOptions {
  /*
   * JSX children: two expressions with nothing between them are drawn side
   * by side, an icon and its word or a badge and its count, not a sentence:
   * only a space or words written between them make one.
   */
  isJsx?: boolean | undefined;
}

// A child element's part: a pill, a name, a link (#8483).
const isElementPart: (part: LinePart) => boolean = (
  part: LinePart,
): boolean => {
  return (
    (part.kind === "piece" || part.kind === "value") && Boolean(part.isElement)
  );
};

// A phrase whose English was read, and is no whole sentence: "Read the".
const isReadPhrase: (part: LinePart) => boolean = (part: LinePart): boolean => {
  return part.kind === "piece" && Boolean(part.isRead) && !part.isSentence;
};

export const judgeLine: (
  parts: ReadonlyArray<LinePart>,
  options?: JudgeOptions,
) => Array<JoinedPieceKind> = (
  parts: ReadonlyArray<LinePart>,
  options?: JudgeOptions,
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

  /*
   * English's colon or comma written right after an element that holds a
   * translated phrase: `<span>{t("Line {{line}}")}</span>{": "}` keeps the
   * colon French spaces and Chinese writes full-width (#8571).
   */
  line.forEach((part: LinePart, index: number): void => {
    const next: LinePart | undefined = line[index + 1];

    if (
      part.kind === "separator" &&
      part.holdsPhrase &&
      next &&
      next.kind === "text" &&
      PUNCTUATION_AFTER.test(next.text)
    ) {
      kinds.add(JoinedPieceKind.Punctuation);
    }
  });

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

      /*
       * A value's own text counts as written beside the piece: " (" in
       * `${unit ? ` (${unit})` : ""}`, and so does an element's: the space
       * of <>{" "}<Link>...</Link></>.
       */
      if (neighbour.kind === "value" || neighbour.kind === "piece") {
        between =
          direction === 1
            ? between + (neighbour.leading || "")
            : (neighbour.trailing || "") + between;
      }

      between =
        direction === 1
          ? (part.trailing || "") + between
          : between + (part.leading || "");

      if (options?.isJsx && between === "") {
        /*
         * An element before a phrase is spaced from it by its own margin,
         * as EventItem's kind was from "state changed to" (`mr-1`): nothing
         * written between them is a space, the element a word of the
         * sentence. An element after a word with nothing between is the
         * word's count or badge ("All 42"), and two elements side by side a
         * row of links or of chips, laid out apart (#8483).
         */
        const left: LinePart = direction === -1 ? neighbour : part;
        const right: LinePart = direction === -1 ? part : neighbour;

        if (!isElementPart(left) || isElementPart(right)) {
          continue;
        }

        between = " ";
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

        if (
          (neighbour.kind === "piece" || neighbour.kind === "value") &&
          neighbour.isSentence
        ) {
          continue;
        }

        /*
         * A label with its own colon, then what it labels: a value, a link,
         * or a sentence of its own (a value's name, then what it means).
         */
        if (direction === 1 && part.isLabel) {
          continue;
        }

        if (
          direction === -1 &&
          neighbour.kind === "piece" &&
          neighbour.isLabel
        ) {
          continue;
        }

        /*
         * A link that is an action of its own ("Read the guide") after a
         * hint the code holds - a value, a phrase whose English cannot be
         * read - is a sentence after a sentence. Beside a phrase read as one
         * ("Read the"), it is a word of that phrase's sentence (#8483).
         */
        if (
          (part.isCallToAction && !isReadPhrase(neighbour)) ||
          (neighbour.kind === "piece" &&
            neighbour.isCallToAction &&
            !isReadPhrase(part))
        ) {
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

const JSX_ENTITIES: Readonly<Record<string, string>> = {
  "&nbsp;": " ",
  "&middot;": "·",
  "&bull;": "•",
  "&mdash;": "—",
  "&ndash;": "–",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

const JSX_ENTITY: RegExp = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi;

const LINE_BREAK: RegExp = /\r\n|\n|\r/;

// A line with something on it besides spaces and tabs.
const NOT_BLANK: RegExp = /[^ \t]/;

/*
 * The text a JSX text child draws, as React's JSX transform writes it: each
 * line trimmed where it meets a line break, lines of only spaces dropped,
 * the rest joined by one space. `{t("Showing")} {n}` draws a space between
 * them; `{icon}` and `{t("Save")}` on lines of their own draw none.
 */
export const renderedJsxText: (raw: string) => string = (
  raw: string,
): string => {
  const lines: Array<string> = raw.split(LINE_BREAK);
  let lastWithText: number = 0;

  lines.forEach((line: string, index: number): void => {
    if (NOT_BLANK.test(line)) {
      lastWithText = index;
    }
  });

  let text: string = "";

  lines.forEach((line: string, index: number): void => {
    let trimmed: string = line.replace(/\t/g, " ");

    if (index !== 0) {
      trimmed = trimmed.replace(/^[ ]+/, "");
    }

    if (index !== lines.length - 1) {
      trimmed = trimmed.replace(/[ ]+$/, "");
    }

    if (trimmed) {
      text += index === lastWithText ? trimmed : `${trimmed} `;
    }
  });

  return text.replace(JSX_ENTITY, (entity: string): string => {
    const named: string | undefined = JSX_ENTITIES[entity.toLowerCase()];

    if (named) {
      return named;
    }

    const code: number = entity.toLowerCase().startsWith("&#x")
      ? parseInt(entity.slice(3, -1), 16)
      : parseInt(entity.slice(2, -1), 10);

    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
};

/*
 * Elements drawn inline, in the run of a sentence: what they hold is read
 * as part of the line around them. Any other element - an icon, a
 * tooltip, a control, a block, a separator - sets its two sides apart.
 */
const INLINE_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "em",
  "i",
  "mark",
  "q",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  // Common/UI's links, drawn as an <a>.
  "AppLink",
  "Link",
]);

/*
 * What an element starts or ends with, to the line around it, where it
 * starts or ends with an icon or a separator: set apart, as by a break.
 */
const SET_APART: string = "\n";

// Links: one around a translated phrase is a phrase of its sentence.
const LINK_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "a",
  "AppLink",
  "Link",
]);

/*
 * Components that draw one value inline: a state's or a label's pill, a
 * user's or a monitor's name (UserElement, MonitorElement), a name drawn
 * as its project wrote it. Beside a phrase, such an element is a value the
 * sentence holds, as {name} is (#8483).
 */
const VALUE_COMPONENT: RegExp =
  /^(Pill|ColorPill|BreakableName|IsolatedText|ReadAsWritten|[A-Z][A-Za-z0-9]*Element)$/;

// What an element is named in JSX: <span>, <Link>, <Icons.Close> is Close.
const jsxTagNameOf: (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
) => string = (element: ts.JsxElement | ts.JsxSelfClosingElement): string => {
  const tagName: ts.JsxTagNameExpression = ts.isJsxElement(element)
    ? element.openingElement.tagName
    : element.tagName;

  if (ts.isIdentifier(tagName)) {
    return tagName.text;
  }

  if (ts.isPropertyAccessExpression(tagName)) {
    return tagName.name.text;
  }

  return "";
};

/*
 * What a child element is to the line around it (#8483):
 *
 *   - a value, where it is a value component (<Pill>, <UserElement>), or an
 *     inline element holding a value and no translated phrase (<span
 *     className="font-medium">{props.eventType}</span>);
 *   - a translated phrase, where an inline element holds one (<Link>{t(
 *     "docs")}</Link>): a sentence only when all it holds are;
 *   - apart, for anything else: an icon, a tooltip, a control, a block, a
 *     mark of no letters (<span className="text-red-500">*</span>).
 */
const jsxElementPartOf: (
  element: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  context: PieceContext,
  depth: number,
) => LinePart = (
  element: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  context: PieceContext,
  depth: number,
): LinePart => {
  const tag: string = ts.isJsxFragment(element) ? "" : jsxTagNameOf(element);

  if (!ts.isJsxFragment(element) && isLaidOutApart(element, context)) {
    return { kind: "separator" };
  }

  if (VALUE_COMPONENT.test(tag)) {
    return { kind: "value", leading: "", trailing: "", isElement: true };
  }

  if (
    depth > MAX_RESOLVE_DEPTH ||
    ts.isJsxSelfClosingElement(element) ||
    !(ts.isJsxFragment(element) || INLINE_ELEMENTS.has(tag))
  ) {
    return { kind: "separator" };
  }

  const inner: Array<LinePart> = jsxChildPartsOf(
    element.children,
    context,
    depth + 1,
  );
  const pieces: Array<LinePart & { kind: "piece" }> = inner.filter(
    (part: LinePart): part is LinePart & { kind: "piece" } => {
      return part.kind === "piece";
    },
  );

  if (pieces.length > 0) {
    /*
     * A link around a phrase is a phrase of the sentence it stands in, as a
     * fragment's phrase is, where the fragment holds no block or icon. Any
     * other element around one is a label, a heading or a line of its own,
     * laid out beside its neighbours, and its own line is read for itself.
     */
    const isInlineFragment: boolean =
      ts.isJsxFragment(element) &&
      !inner.some((part: LinePart): boolean => {
        return part.kind === "separator";
      });

    /*
     * Words only a screen reader reads (sr-only) are read in the run of the
     * line around them: "Connect" before a product's name.
     */
    const isReadInLine: boolean =
      !ts.isJsxFragment(element) && isScreenReaderOnly(element, context);

    if (!isInlineFragment && !isReadInLine && !LINK_ELEMENTS.has(tag)) {
      // A label in an element of its own carries its colon, if it has one, inside.
      return {
        kind: "separator",
        holdsPhrase: !pieces.every(
          (piece: LinePart & { kind: "piece" }): boolean => {
            return piece.isLabel;
          },
        ),
      };
    }

    const only: (LinePart & { kind: "piece" }) | undefined =
      pieces.length === 1 ? pieces[0] : undefined;

    return {
      kind: "piece",
      isSentence: pieces.every(
        (piece: LinePart & { kind: "piece" }): boolean => {
          return piece.isSentence;
        },
      ),
      isLabel: Boolean(only && only.isLabel),
      isRead: pieces.every((piece: LinePart & { kind: "piece" }): boolean => {
        return Boolean(piece.isRead);
      }),
      startsAsSentence: Boolean(pieces[0]?.startsAsSentence),
      isElement: true,
      /*
       * A link of one phrase that starts as a sentence does ("Read the
       * guide", "Open settings"): an action of its own after a sentence.
       */
      isCallToAction: ts.isJsxFragment(element)
        ? Boolean(only && only.isCallToAction)
        : LINK_ELEMENTS.has(tag) &&
          Boolean(only && only.isRead && only.startsAsSentence),
      leading: innerEdgeOf(inner, "leading"),
      trailing: innerEdgeOf(inner, "trailing"),
    };
  }

  const drawsSomething: boolean = inner.some((part: LinePart): boolean => {
    return (
      part.kind === "value" ||
      (part.kind === "text" && LETTER_OR_FIGURE.test(part.text))
    );
  });

  if (!drawsSomething) {
    return { kind: "separator" };
  }

  return {
    kind: "value",
    leading: innerEdgeOf(inner, "leading"),
    trailing: innerEdgeOf(inner, "trailing"),
    isElement: true,
  };
};

/*
 * An element starts and ends as what it holds does: <span>({count})</span>
 * is an aside in brackets, <span>· {time}</span> a fact set apart, and
 * <><InlineSeparator /><bdi>{name}</bdi></> starts set apart.
 */
const innerEdgeOf: (
  inner: ReadonlyArray<LinePart>,
  side: "leading" | "trailing",
) => string = (
  inner: ReadonlyArray<LinePart>,
  side: "leading" | "trailing",
): string => {
  const parts: Array<LinePart> =
    side === "leading" ? [...inner] : [...inner].reverse();
  let edge: string = "";

  // Spaces, then what the first part that is not one starts with: " (done)".
  for (const part of parts) {
    if (part.kind === "text") {
      edge = side === "leading" ? edge + part.text : part.text + edge;

      if (!ONLY_SPACE.test(part.text)) {
        return edge;
      }

      continue;
    }

    const mark: string =
      part.kind === "separator" ? SET_APART : part[side] || "";

    return side === "leading" ? edge + mark : mark + edge;
  }

  return edge;
};

// An attribute's value as written: className="a b", className={CONSTANT}.
const jsxAttributeTextOf: (
  attribute: ts.JsxAttribute,
  context: PieceContext,
) => string = (attribute: ts.JsxAttribute, context: PieceContext): string => {
  const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;

  if (!initializer) {
    return "";
  }

  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const expression: ts.Expression = unwrap(initializer.expression);

    if (ts.isIdentifier(expression)) {
      const constant: ts.Expression | undefined = context.scope.constants.get(
        expression.text,
      );

      if (constant) {
        return constant.getText();
      }
    }

    return expression.getText();
  }

  return "";
};

// A badge's or a chip's box: rounded, rounded-full, rounded-md.
const ROUNDED_BOX: RegExp = /(^|[\s"'`:])rounded(-[a-z0-9]+)?(?=[\s"'`]|$)/;

// A box on a line of its own: block, flex, grid (not inline-block or flex-1).
const BOX_OF_ITS_OWN: RegExp =
  /(^|[\s"'`])(block|flex|grid|table|flow-root)(?=[\s"'`]|$)/;

/*
 * An element drawn for the eye only (aria-hidden: a step's number, a
 * check mark, a dot), a badge or a chip (a rounded box around a count or a
 * word), or a box on a line of its own (a link drawn as a block): apart
 * from the words beside it, as an icon is.
 */
const isLaidOutApart: (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  context: PieceContext,
) => boolean = (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  context: PieceContext,
): boolean => {
  const attributes: ts.JsxAttributes = ts.isJsxElement(element)
    ? element.openingElement.attributes
    : element.attributes;

  return attributes.properties.some(
    (property: ts.JsxAttributeLike): boolean => {
      if (!ts.isJsxAttribute(property)) {
        return false;
      }

      const name: string = property.name.getText();

      if (name === "aria-hidden") {
        const value: string = property.initializer
          ? jsxAttributeTextOf(property, context)
          : "true";

        return value === "true";
      }

      if (name !== "className") {
        return false;
      }

      const classes: string = jsxAttributeTextOf(property, context);

      return ROUNDED_BOX.test(classes) || BOX_OF_ITS_OWN.test(classes);
    },
  );
};

// Words drawn for a screen reader only: className="sr-only".
const SCREEN_READER_ONLY: RegExp = /(^|[\s"'`])sr-only(?=[\s"'`]|$)/;

const isScreenReaderOnly: (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  context: PieceContext,
) => boolean = (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  context: PieceContext,
): boolean => {
  const attributes: ts.JsxAttributes = ts.isJsxElement(element)
    ? element.openingElement.attributes
    : element.attributes;

  return attributes.properties.some(
    (property: ts.JsxAttributeLike): boolean => {
      return (
        ts.isJsxAttribute(property) &&
        property.name.getText() === "className" &&
        SCREEN_READER_ONLY.test(jsxAttributeTextOf(property, context))
      );
    },
  );
};

// null, undefined, false or "": what draws nothing.
const drawsNothing: (expression: ts.Expression) => boolean = (
  expression: ts.Expression,
): boolean => {
  const current: ts.Expression = unwrap(expression);

  return (
    current.kind === ts.SyntaxKind.NullKeyword ||
    current.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(current) && current.text === "undefined") ||
    ((ts.isStringLiteral(current) ||
      ts.isNoSubstitutionTemplateLiteral(current)) &&
      current.text === "")
  );
};

/*
 * The elements an expression draws, where all it draws is elements or
 * nothing: {cond ? <Link>...</Link> : null}, {cond && <Icon />}.
 */
const jsxElementsDrawnBy: (
  expression: ts.Expression,
) =>
  | Array<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment>
  | undefined = (
  expression: ts.Expression,
):
  | Array<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment>
  | undefined => {
  const current: ts.Expression = unwrap(expression);

  // An empty fragment, <></>, draws nothing.
  if (
    ts.isJsxFragment(current) &&
    current.children.every((child: ts.JsxChild): boolean => {
      return ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces;
    })
  ) {
    return [];
  }

  if (
    ts.isJsxElement(current) ||
    ts.isJsxSelfClosingElement(current) ||
    ts.isJsxFragment(current)
  ) {
    return [current];
  }

  if (drawsNothing(current)) {
    return [];
  }

  if (ts.isConditionalExpression(current)) {
    const whenTrue:
      | Array<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment>
      | undefined = jsxElementsDrawnBy(current.whenTrue);
    const whenFalse:
      | Array<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment>
      | undefined = jsxElementsDrawnBy(current.whenFalse);

    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }

  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return jsxElementsDrawnBy(current.right);
  }

  return undefined;
};

/*
 * A choice between marks of no letters, or a mark and nothing: {open ? "▼"
 * : "▶"}, {isSelected ? "✓" : ""}. (A mark written alone is the line's own
 * text, as {" "} is.)
 */
const isChoiceOfMarks: (expression: ts.Expression) => boolean = (
  expression: ts.Expression,
): boolean => {
  const current: ts.Expression = unwrap(expression);

  if (!ts.isConditionalExpression(current)) {
    return false;
  }

  return [current.whenTrue, current.whenFalse].every(
    (side: ts.Expression): boolean => {
      const value: ts.Expression = unwrap(side);

      if (
        ts.isStringLiteral(value) ||
        ts.isNoSubstitutionTemplateLiteral(value)
      ) {
        return !LETTER_OR_FIGURE.test(value.text);
      }

      return isChoiceOfMarks(value);
    },
  );
};

/*
 * What an expression that draws elements is to the line: the phrase one
 * of them holds, else a value one of them is, else apart.
 */
const jsxDrawnPartOf: (
  elements: ReadonlyArray<
    ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment
  >,
  context: PieceContext,
  depth: number,
) => LinePart = (
  elements: ReadonlyArray<
    ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment
  >,
  context: PieceContext,
  depth: number,
): LinePart => {
  const parts: Array<LinePart> = elements.map(
    (
      element: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
    ): LinePart => {
      return jsxElementPartOf(element, context, depth);
    },
  );

  const piece: LinePart | undefined = parts.find((part: LinePart): boolean => {
    return part.kind === "piece";
  });

  if (piece) {
    return piece;
  }

  /*
   * An icon, or a value in its place, is a marker: {done ? <Icon /> :
   * <span>{number}</span>} is a step's mark beside its title.
   */
  if (
    parts.some((part: LinePart): boolean => {
      return part.kind === "separator";
    })
  ) {
    return { kind: "separator" };
  }

  return (
    parts.find((part: LinePart): boolean => {
      return part.kind === "value";
    }) || { kind: "separator" }
  );
};

// The parts of an element's children: its text, each {expression}, and each child element.
const jsxChildPartsOf: (
  children: ts.NodeArray<ts.JsxChild>,
  context: PieceContext,
  depth: number,
) => Array<LinePart> = (
  children: ts.NodeArray<ts.JsxChild>,
  context: PieceContext,
  depth: number,
): Array<LinePart> => {
  const parts: Array<LinePart> = [];

  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text: string = renderedJsxText(child.text);

      if (text !== "") {
        parts.push({ kind: "text", text });
      }

      continue;
    }

    if (ts.isJsxExpression(child)) {
      // {/* a comment */} draws nothing.
      if (!child.expression) {
        continue;
      }

      const drawn:
        | Array<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment>
        | undefined = jsxElementsDrawnBy(child.expression);

      if (drawn) {
        parts.push(jsxDrawnPartOf(drawn, context, depth));
      } else if (isChoiceOfMarks(child.expression)) {
        parts.push({ kind: "separator" });
      } else {
        parts.push(partOf(child.expression, context));
      }

      continue;
    }

    parts.push(jsxElementPartOf(child, context, depth));
  }

  return parts;
};

/*
 * The parts of an element's children, or undefined for any other node: its
 * text, and each {expression} as a template's span would be (#8290). A
 * child element is what it draws: a pill or a name a value, a link around
 * a phrase that phrase, an icon or a block apart (#8483).
 */
const jsxLinePartsOf: (
  node: ts.Node,
  context: PieceContext,
) => Array<LinePart> | undefined = (
  node: ts.Node,
  context: PieceContext,
): Array<LinePart> | undefined => {
  if (!ts.isJsxElement(node) && !ts.isJsxFragment(node)) {
    return undefined;
  }

  return jsxChildPartsOf(node.children, context, 0);
};

// An element's attributes no one reads: its key, its id, its classes, a test's handle.
const NOT_DRAWN_ATTRIBUTE: RegExp =
  /^(key|id|className|htmlFor|dataTestId|testId|data-[\w-]+|aria-(controls|labelledby|describedby|owns))$/;

// A name that holds what no one reads: a React key, an id, a class, a test's handle.
const NOT_DRAWN_NAME: RegExp = /^(key|id)$|(Key|Id|TestId|ClassName)$/;

// A text lowercased whole is searched, never drawn: a haystack.
const LOWERCASED: RegExp = /^to(Locale)?LowerCase$/;

/*
 * Whether a line is never drawn (#8571): an element's key or id
 * (`key={`${reason.text}-${text}`}`), a name that holds one (`const key =
 * fileObject._id || `${displayName}-${index}``), or a search's lowercased
 * haystack.
 */
const isNeverDrawn: (node: ts.Node) => boolean = (node: ts.Node): boolean => {
  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;

  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      (ts.isBinaryExpression(current) &&
        (current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          current.operatorToken.kind ===
            ts.SyntaxKind.QuestionQuestionToken)) ||
      (ts.isConditionalExpression(current) && current.condition !== child))
  ) {
    child = current;
    current = current.parent;
  }

  if (!current) {
    return false;
  }

  if (
    ts.isPropertyAccessExpression(current) &&
    current.expression === child &&
    LOWERCASED.test(current.name.text)
  ) {
    return true;
  }

  if (ts.isJsxExpression(current) && ts.isJsxAttribute(current.parent)) {
    return NOT_DRAWN_ATTRIBUTE.test(current.parent.name.getText());
  }

  if (
    (ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current)) &&
    ts.isIdentifier(current.name)
  ) {
    return NOT_DRAWN_NAME.test(current.name.text);
  }

  return false;
};

// Where an element's children start and end, without the whitespace around them.
const jsxChildrenText: (
  node: ts.JsxElement | ts.JsxFragment,
  sourceFile: ts.SourceFile,
) => { start: number; text: string } = (
  node: ts.JsxElement | ts.JsxFragment,
  sourceFile: ts.SourceFile,
): { start: number; text: string } => {
  // What the line draws: not the whitespace around it, nor a {/* comment */}.
  const children: ReadonlyArray<ts.JsxChild> = node.children.filter(
    (child: ts.JsxChild): boolean => {
      if (ts.isJsxText(child)) {
        return !child.containsOnlyTriviaWhiteSpaces;
      }

      return !(ts.isJsxExpression(child) && !child.expression);
    },
  );
  const first: ts.JsxChild | undefined = children[0];
  const last: ts.JsxChild | undefined = children[children.length - 1];

  if (!first || !last) {
    return { start: node.getStart(sourceFile), text: "" };
  }

  const start: number = first.getStart(sourceFile);

  return {
    start,
    text: sourceFile.text.slice(start, last.getEnd()).trim(),
  };
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
    const jsxParts: Array<LinePart> | undefined = jsxLinePartsOf(node, context);
    const parts: Array<LinePart> | undefined =
      jsxParts || (isNeverDrawn(node) ? undefined : linePartsOf(node, context));

    if (
      parts &&
      parts.some((part: LinePart): boolean => {
        return (
          part.kind === "piece" ||
          (part.kind === "separator" && Boolean(part.holdsPhrase))
        );
      })
    ) {
      const kinds: Array<JoinedPieceKind> = judgeLine(parts, {
        isJsx: Boolean(jsxParts),
      });

      if (kinds.length > 0) {
        // An element's line is its children, as the failure names them.
        const where: { start: number; text: string } =
          jsxParts && (ts.isJsxElement(node) || ts.isJsxFragment(node))
            ? jsxChildrenText(node, sourceFile)
            : {
                start: node.getStart(sourceFile),
                text: node.getText(sourceFile),
              };

        findings.push({
          file: data.file,
          line: sourceFile.getLineAndCharacterOfPosition(where.start).line + 1,
          text: where.text.replace(WHITESPACE_RUN, " ").slice(0, 160),
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
    file: "packages/App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixSteps.ts",
    text: "`${kind} ${command.resourceNameSnapshot || unknownName}`",
    why: "A runbook step's target: the kind of resource, worded for the middle of a sentence, and its name as written (\"host web-1\"), a value the step's sentence holds.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/FormBuilder/Submissions/FormSubmissionsTable.tsx",
    text: "{tx(created.kindTitle)} {created.reference}",
    why: 'A link to what a submission created, named by its kind and its reference ("Incident #42"): a name, not a sentence.',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeModal.tsx",
    text: "`${sentence}${nextStep}`",
    why: "Two whole sentences: where no code is waiting, then what to do next, each a notification method's own sentence looked up whole.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Permission/RolePickerOptions.ts",
    text: "`${english} ${translated}`",
    why: "What a role search reads, never drawn: the English words and the reader's side by side, so either finds the role.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer.tsx",
    text: '{t("Services")} {renderServiceChips(scope)}',
    why: "A heading word before the chips of the services in scope, which a function draws as buttons: a label over its values, not a sentence.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Cloud/CloudSetupGuide.ts",
    text: "`**${context.translator.translateText(tab.label) || tab.label}** — ${tab.description}`",
    why: "A Markdown bullet: a tab's name in bold, a dash, then what it is - a term and its definition, not a sentence.",
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
  /*
   * A sentence the code holds, then a link to act on it (#8483): each a
   * whole sentence of its own, looked up by what the line is about, so the
   * guard cannot read its English.
   */
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainRecords.tsx",
    text: "{say(description.lookedUp)} {description.whatToDo ? (",
    why: 'Two whole sentences of a DNS check: what the lookup found ("We looked up the CNAME record of ... and found ..."), then what to do about it, each read through the card\'s say() helper.',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx",
    text: "{translator.translateText(hint.text)} {hint.linkText && linkUrl ? (",
    why: "A chart's fallback hint, one short sentence its template ships, then the link to the docs after it, an English key of its own.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetDetailsCard.tsx",
    text: '{translator.translatePlural(help.unknown, unknownCount)}{" "} <a',
    why: 'Why some details are unknown, a whole sentence for the kind of asset ("2 details are unknown: ..."), then the link to where each detail comes from.',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceHealthCard.tsx",
    text: '{translator.translateText(tile.hint.text)}{" "} <a',
    why: 'A tile\'s hint, a whole sentence, then the link to its docs section ("How the agent links spans").',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Workspace/RecordChannelMembersCard.tsx",
    text: '{translator.translateText(productText.notFound)}{" "} <Link',
    why: "Why OneUptime cannot add you, a whole sentence for the chat product, then the link to connect your account.",
  },
  /*
   * A thing named by its kind, or a figure by its label, and its value:
   * names and facts, not sentences (#8483).
   */
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsTimeline.tsx",
    text: '{translator.translateText(props.subject.label)}{" "} <span',
    why: 'What a network event happened to, named by its kind and its name as the device wrote it ("Interface eth0").',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRuleScope.tsx",
    text: '{translator.translateText("Project")}{" "} <bdi',
    why: "The project a rule is scoped to, named by its kind and its ID, one per line.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRuleScope.tsx",
    text: '{translator.translateText("Domain")}{" "} <bdi',
    why: "The domain a rule is scoped to, named by its kind and its ID, one per line.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Profiles/ProfileFunctionTable.tsx",
    text: '{translator.translateText(figure.label)}{" "} <span',
    why: "A function's share of the profile, as a legend draws a figure: its label (Self, Total), then the share.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/SecurityOverview/StackedDayBars.tsx",
    text: "`${seriesName(series, translator)} ${translator.formatNumber(",
    why: "A day bar's tooltip lists each series as a legend does: its name, then its count, in brackets after the day's total.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyNodes.tsx",
    text: "{tx(firstFact.label, translator)} <bdi>{firstFact.value}</bdi>",
    why: "A part's first fact, as its details list it: the fact's label, then its value.",
  },
  /*
   * The workflow builder's paths between steps are no longer here: a screen
   * reader hears "which led to {{steps}}" and "Leads to {{steps}}" as one
   * sentence each, the steps a slot (#8570).
   */
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

/*
 * Mutation checks (#8570): the workflow builder's paths between steps, each
 * one sentence for a screen reader now, put back to the words they joined.
 */
describe("a workflow path read as one sentence, put back to joined words, fails the guard", () => {
  test("the run log's which led to, its words before the steps again", () => {
    const file: string =
      "packages/Common/UI/Components/Workflow/StepTraceViewer.tsx";
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );
    const start: number = source.indexOf(
      "<TranslatedSentence\n            template={LED_TO_SENTENCE}",
    );
    const end: number = source.indexOf(
      "/>",
      source.indexOf("renderText", start),
    );

    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(findSentencesFromPieces({ file, source })).toEqual([]);

    const putBack: string =
      source.slice(0, start) +
      `<DirectionArrow isDecorative={true} className="text-gray-400" />{" "}
          <span className="sr-only">
            {translator.translateText("which led to")}
          </span>{" "}
          {outcome.nextSteps.map((next: StepOutcomeNextStep) => {
            return <NextStepLabel key={next.componentId} next={next} notRunLabel={props.notRunLabel} isFollowed={false} />;
          })}` +
      source.slice(end + 2);

    expect(findSentencesFromPieces({ file, source: putBack })).toHaveLength(1);
  });

  test("the Switch / Case editor's Leads to, its words before the steps again", () => {
    const file: string =
      "packages/Common/UI/Components/Workflow/Switch/SwitchEditor.tsx";
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );
    const start: number = source.indexOf(
      "<TranslatedSentence\n          template={LEADS_TO_SENTENCE}",
    );
    const end: number = source.indexOf(
      "/>",
      source.indexOf("renderText", start),
    );

    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(findSentencesFromPieces({ file, source })).toEqual([]);

    const putBack: string =
      source.slice(0, start) +
      `<span className="sr-only">{translator.translateText("Leads to")} </span>
        {steps.map((step: ConnectedStep) => {
          return <span key={step.componentId} className="font-medium text-gray-800">{step.title}</span>;
        })}` +
      source.slice(end + 2);

    expect(findSentencesFromPieces({ file, source: putBack })).toHaveLength(1);
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

// The kinds a JSX fixture's lines are found for, one line each (#8290).
const jsxKindsOf: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  return kindsOf(source, "packages/App/FeatureSet/Dashboard/src/Fixture.tsx");
};

describe("sentences built in an element's children are found (#8290)", () => {
  test("Page 2 of 5 and Showing N of M, a word at a time", () => {
    // ServiceMapGraph and EntityDetailPanel before the fix.
    expect(
      jsxKindsOf(
        [
          'const a = <p>{t("Page")} {page} {t("of")} {pages}</p>;',
          "const b = (",
          "  <p>",
          '    {t("Showing")}{" "}',
          '    {shown}{" "}',
          '    {t("of")}{" "}',
          "    {total}",
          "  </p>",
          ");",
        ].join("\n"),
      ),
    ).toEqual([
      '{t("Page")} {page} {t("of")} {pages} => a value joined to a translated phrase',
      '{t("Showing")}{" "} {shown}{" "} {t("of")}{" "} {total} => a value joined to a translated phrase',
    ]);
  });

  test("a count beside its noun, English's 1-or-more plural", () => {
    // ServiceMapGraph's callers and CorrelateInspector's events before the fix.
    expect(
      jsxKindsOf(
        [
          'const a = <span>{n} {t(n === 1 ? "caller" : "callers")}</span>;',
          'const b = <p>{count}{" "}{t("less frequent observables not shown")}</p>;',
        ].join("\n"),
      ),
    ).toEqual([
      '{n} {t(n === 1 ? "caller" : "callers")} => a value joined to a translated phrase',
      '{count}{" "}{t("less frequent observables not shown")} => a value joined to a translated phrase',
    ]);
  });

  test("a phrase, then a name or a date: Traces for, posted on", () => {
    // EdgeDetailPanel and EventItem before the fix.
    expect(
      jsxKindsOf(
        [
          'const a = <Link>{translateString("Traces for") || ""} {fromName}</Link>;',
          "const b = (",
          "  <p>",
          '    {t("eventItem.postedOn", "posted on")}{" "}',
          "    {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)}",
          "  </p>",
          ");",
        ].join("\n"),
      ),
    ).toEqual([
      '{translateString("Traces for") || ""} {fromName} => a value joined to a translated phrase',
      '{t("eventItem.postedOn", "posted on")}{" "} {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)} => a value joined to a translated phrase',
    ]);
  });

  test("a label's colon, and English words, written beside a piece", () => {
    // RecordingHealthCard and WorkflowIssuesModal before the fix.
    expect(
      jsxKindsOf(
        [
          'const a = <dt>{translator.translateText("Capabilities")}:</dt>;',
          'const b = <span>{t("Error")}{": "}</span>;',
          'const c = <span>Search {t("templates")}</span>;',
        ].join("\n"),
      ),
    ).toEqual([
      '{translator.translateText("Capabilities")}: => punctuation written beside a translated phrase',
      '{t("Error")}{": "} => punctuation written beside a translated phrase',
      'Search {t("templates")} => English words written beside a translated phrase',
    ]);
  });

  test("two translated phrases side by side", () => {
    // OpenStack Capacity's column header before the fix.
    expect(
      jsxKindsOf(
        'const a = <th>{t(getTitle(name))}{" "}{t("allocated")}</th>;',
      ),
    ).toEqual([
      '{t(getTitle(name))}{" "}{t("allocated")} => translated phrases joined',
    ]);
  });

  test("a name that holds a translation counts as the call it holds", () => {
    // NamingLookupTableEditor before #8076's fix, and FacetFilterBar's toggle.
    expect(
      kindsOf(
        [
          "function Editor() {",
          '  const keyTitle: string = translator.translateText("Key");',
          "  return `${keyTitle} ${index + 1}`;",
          "}",
          "function Toggle() {",
          '  const filterText: string = translator.translateText("Filter") || "Filter";',
          "  return <span>{filterText} {count}</span>;",
          "}",
        ].join("\n"),
      ),
    ).toEqual([
      "`${keyTitle} ${index + 1}` => a value joined to a translated phrase",
      "{filterText} {count} => a value joined to a translated phrase",
    ]);
  });
});

describe("what is not a sentence built in an element's children", () => {
  test("an icon or a badge beside its word, with nothing drawn between", () => {
    expect(
      jsxKindsOf(
        [
          "const a = (",
          "  <button>",
          "    {icon}",
          '    {t("Save")}',
          "    {count}",
          "  </button>",
          ");",
          'const b = <span>{badge}{t("New")}</span>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("an icon, a required mark, a block or a control sets apart what is on each side of it", () => {
    expect(
      jsxKindsOf(
        [
          'const a = <p><Icon icon={IconProp.Add} /> {t("Add Monitor")}</p>;',
          'const b = <span>{t("Name")} <span className="text-red-500">*</span></span>;',
          'const c = <div>{t("Monitors")} <div>{name}</div></div>;',
          'const d = <div>{t("Owner")} <Button title={name} /></div>;',
          'const e = <p>{t("Status")} <InfoTooltip text={help} /></p>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("whole sentences, a label with its colon, facts set apart, an aside", () => {
    expect(
      jsxKindsOf(
        [
          'const a = <p>{t("It could not be loaded.")} {error}</p>;',
          'const b = <p>{t("Duration:")} {value}</p>;',
          'const c = <p>{name} · {t("Paused")}</p>;',
          'const d = <p>{t("Memory")} ({unit})</p>;',
          'const e = <p>{t(props.description)}{cond ? ` ${t("SLOs are linked automatically.")}` : ""}</p>;',
          'const f = <span>{translatePlural(ROWS, n)}{truncated ? ` ${t("(truncated)")}` : ""}</span>;',
          'const g = <p>{translateTemplate("Showing {{shown}} of {{total}}", { shown, total })}</p>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a mark another module exports, before a word", () => {
    // LayersPreview's "⇄ covering": OVERRIDE_TITLE_MARKER is OverridePresentation's.
    const modules: Record<string, string> = {
      "packages/App/FeatureSet/Dashboard/src/Marks.ts":
        'export const MARKER: string = "⇄";',
    };

    expect(
      findSentencesFromPieces({
        file: "packages/App/FeatureSet/Dashboard/src/Page.tsx",
        source: [
          'import { MARKER } from "./Marks";',
          'const a = <span>{MARKER} {translator.translateText("covering")}</span>;',
        ].join("\n"),
        readModule: (file: string): string | undefined => {
          return modules[file];
        },
      }),
    ).toEqual([]);
  });

  test("a name read by its own scope: a parameter or another function's const is no piece", () => {
    expect(
      kindsOf(
        [
          "function a() {",
          '  const label: string = t("Key");',
          "  return label;",
          "}",
          "function b(label: string) {",
          "  return `${label} ${n}`;",
          "}",
          "function c() {",
          "  return `${label} ${n}`;",
          "}",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a comment between two children draws nothing", () => {
    expect(
      jsxKindsOf('const a = <span>{icon}{/* the word */}{t("Save")}</span>;'),
    ).toEqual([]);
  });
});

describe("the JSX reading's pieces (#8290)", () => {
  test("a text child draws what React's JSX transform draws", () => {
    expect(renderedJsxText(" ")).toBe(" ");
    expect(renderedJsxText("\n      ")).toBe("");
    expect(renderedJsxText(" of\n      ")).toBe(" of");
    expect(renderedJsxText("\n  posted on\n  ")).toBe("posted on");
    expect(renderedJsxText("first\n    second")).toBe("first second");
    expect(renderedJsxText("&nbsp;")).toBe(" ");
    expect(renderedJsxText(" &middot; ")).toBe(" · ");
    expect(renderedJsxText("&#183;")).toBe("·");
    expect(renderedJsxText("&#x2022;")).toBe("•");
  });

  test("in JSX, nothing between a piece and a value is no joint", () => {
    const line: Parameters<typeof judgeLine>[0] = [
      { kind: "piece", isSentence: false, isLabel: false },
      { kind: "value", leading: "", trailing: "" },
    ];

    expect(judgeLine(line, { isJsx: true })).toEqual([]);
    expect(judgeLine(line)).toEqual([JoinedPieceKind.Value]);
    expect(
      judgeLine(
        [
          { kind: "piece", isSentence: false, isLabel: false },
          { kind: "text", text: " " },
          { kind: "value", leading: "", trailing: "" },
        ],
        { isJsx: true },
      ),
    ).toEqual([JoinedPieceKind.Value]);
  });

  test("a value that holds one whole sentence stands beside a phrase", () => {
    expect(
      judgeLine([
        { kind: "piece", isSentence: false, isLabel: false },
        { kind: "value", leading: " ", trailing: "", isSentence: true },
      ]),
    ).toEqual([]);
    expect(
      judgeLine([
        { kind: "piece", isSentence: false, isLabel: false },
        { kind: "value", leading: " ", trailing: "", isSentence: false },
      ]),
    ).toEqual([JoinedPieceKind.Value]);
  });
});

describe("sentences built around a child element are found (#8483)", () => {
  test("a name before a phrase, spaced by its own margin: EventItem's state change", () => {
    // EventItem before #8290's fix: "Incident" "state changed to" <Pill />.
    expect(
      jsxKindsOf(
        [
          "const a = (",
          '  <span className="mr-2">',
          '    <span className="font-medium text-gray-900 mr-1">{props.eventType}</span>',
          '    {t("eventItem.stateChangedTo", "state changed to")}',
          "  </span>",
          ");",
        ].join("\n"),
      ),
    ).toEqual([
      '<span className="font-medium text-gray-900 mr-1">{props.eventType}</span> {t("eventItem.stateChangedTo", "state changed to")} => a value joined to a translated phrase',
    ]);
  });

  test("a phrase, then a link, a pill, a name or a time", () => {
    expect(
      jsxKindsOf(
        [
          'const a = <p>{t("Read the")} <Link to={route}>{t("docs")}</Link></p>;',
          'const b = <p>{t("Created by")} <UserElement user={user} /></p>;',
          'const c = <p>{t("Moved to")} <Pill text={state} color={color} /></p>;',
          'const d = <p>{t("Last seen")} <time dateTime={iso}>{when}</time></p>;',
        ].join("\n"),
      ),
    ).toEqual([
      '{t("Read the")} <Link to={route}>{t("docs")}</Link> => translated phrases joined',
      '{t("Created by")} <UserElement user={user} /> => a value joined to a translated phrase',
      '{t("Moved to")} <Pill text={state} color={color} /> => a value joined to a translated phrase',
      '{t("Last seen")} <time dateTime={iso}>{when}</time> => a value joined to a translated phrase',
    ]);
  });

  test("a count drawn on its own beside its words", () => {
    // TimelineToolbar's chips and the security overview's links before the fix.
    expect(
      jsxKindsOf(
        [
          'const a = <span><span className="font-semibold">{covered}</span>{t("covered now")}</span>;',
          'const b = <span><span className="font-semibold tabular-nums">{n}</span>{" "}{translatePlural(LABEL, n)}</span>;',
        ].join("\n"),
      ),
    ).toEqual([
      '<span className="font-semibold">{covered}</span>{t("covered now")} => a value joined to a translated phrase',
      '<span className="font-semibold tabular-nums">{n}</span>{" "}{translatePlural(LABEL, n)} => a value joined to a translated phrase',
    ]);
  });

  test("words a screen reader reads in the run of the line", () => {
    // SecurityEventProviderTile before the fix: "Connect" + the product, the product + "Setup guide".
    expect(
      jsxKindsOf(
        [
          'const a = <button><span className="sr-only">{t("Connect")} </span>{definition.title}</button>;',
          'const b = <a><span className="sr-only">{definition.title} </span>{t("Setup guide")}</a>;',
        ].join("\n"),
      ),
    ).toEqual([
      '<span className="sr-only">{t("Connect")} </span>{definition.title} => a value joined to a translated phrase',
      '<span className="sr-only">{definition.title} </span>{t("Setup guide")} => a value joined to a translated phrase',
    ]);
  });

  test("what a fragment draws after a phrase, and English's colon before a value", () => {
    // DeclaredCodeChangeLine and Unsubscribe before the fix.
    expect(
      kindsOf(
        [
          'const a = <p>{t("View pull request")}{n ? <>{" "}<span dir="ltr">#{n}</span></> : <></>}</p>;',
          'const b = <p>{t("For more, read")}{route ? <>{" "}<Link to={route}>{t("the guide")}</Link></> : <></>}</p>;',
          "function C() {",
          '  const label: string = t("Email address");',
          '  return <p>{label}{contact ? <>{": "}<span>{contact}</span></> : null}</p>;',
          "}",
        ].join("\n"),
      ),
    ).toEqual([
      '{t("View pull request")}{n ? <>{" "}<span dir="ltr">#{n}</span></> : <></>} => a value joined to a translated phrase',
      '{t("For more, read")}{route ? <>{" "}<Link to={route}>{t("the guide")}</Link></> : <></>} => translated phrases joined',
      '{label}{contact ? <>{": "}<span>{contact}</span></> : null} => a value joined to a translated phrase',
    ]);
  });

  test("a nested key reads as the feature set's English locale says, or as its default", () => {
    const modules: Record<string, string> = {
      "packages/App/FeatureSet/Accounts/src/Locales/en.json": JSON.stringify({
        login: {
          noAccountPrompt: "Don't have an account?",
          registerLink: "Register.",
          readThe: "Read the",
          docs: "docs",
        },
      }),
    };

    expect(
      findSentencesFromPieces({
        file: "packages/App/FeatureSet/Accounts/src/Pages/Login.tsx",
        source: [
          'const a = <p>{t("login.noAccountPrompt")}{" "}<Link to={route}>{t("login.registerLink")}</Link></p>;',
          'const b = <p>{t("login.readThe")}{" "}<Link to={route}>{t("login.docs")}</Link></p>;',
          'const c = <p>{t("eventItem.postedOn", "posted on")} <time>{date}</time></p>;',
          'const d = <p>{t("eventItem.postedOn", { defaultValue: "It was posted." })} {date}</p>;',
        ].join("\n"),
        readModule: (file: string): string | undefined => {
          return modules[file];
        },
      }).map((finding: JoinedPieceFinding): string => {
        return finding.text;
      }),
    ).toEqual([
      '{t("login.readThe")}{" "}<Link to={route}>{t("login.docs")}</Link>',
      '{t("eventItem.postedOn", "posted on")} <time>{date}</time>',
    ]);
  });

  test("a lookup in a constant table reads as every text the table holds", () => {
    expect(
      kindsOf(
        [
          'const SENTENCES = { done: translationKey("The fix is in."), failed: translationKey("The fix failed.") };',
          'const PHRASES = { done: translationKey("fixed in"), failed: translationKey("failed in") };',
          "const a = <p>{t(SENTENCES[outcome])} {name}</p>;",
          "const b = <p>{t(PHRASES[outcome])} {name}</p>;",
          "const c = `${t(SENTENCES[outcome])} ${name}`;",
        ].join("\n"),
      ),
    ).toEqual([
      "{t(PHRASES[outcome])} {name} => a value joined to a translated phrase",
    ]);
  });
});

describe("what is not a sentence built around a child element (#8483)", () => {
  test("a link to act on a sentence, or on a hint the code holds", () => {
    expect(
      jsxKindsOf(
        [
          'const a = <p>{t("It could not be loaded.")} <Link to={route}>{t("Try again")}</Link></p>;',
          'const b = <p>{t(hint.text)} <a href={url}>{t("Read the guide")}</a></p>;',
          'const c = <p>{props.hint}{route ? <>{" "}<Link to={route}>{t("Open settings")}</Link></> : <></>}</p>;',
          'const d = <p>{t("For more, see this guide:")} <Link to={route}>{t("Slack Integration")}</Link></p>;',
          'const e = <p>{t("vCenter has not reported it.")} <Link to={route}>{t("See all hosts")}</Link></p>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a count or a badge after its word, an aside in brackets, and links side by side", () => {
    expect(
      jsxKindsOf(
        [
          'const a = <button>{t("All")}<span className="tabular-nums opacity-70">{n}</span></button>;',
          'const b = <button>{t("Errors")} <span className="rounded-full bg-gray-100 px-1.5">{n}</span></button>;',
          'const c = <div><Link to={a}>{t("All metrics")}</Link><Link to={b}>{t("docs")}</Link></div>;',
          'const d = <p>{t("Your queues")}{" "}<span className="text-gray-400">({n})</span></p>;',
          'const e = <p><bdi>{project}</bdi>{" "}{t("({{count}} instances now)", { count })}</p>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("what is drawn for the eye only, a mark, or an icon in a number's place", () => {
    expect(
      jsxKindsOf(
        [
          'const a = <span><span aria-hidden="true">{n}.</span>{t(step.title)}</span>;',
          "const b = <button>{done ? <Icon icon={IconProp.Check} /> : <span>{n}</span>}{t(title)}</button>;",
          'const c = <button>{open ? "▼" : "▶"} {t("Details")}</button>;',
          'const d = <button><span className="mr-1.5">{pill.icon}</span>{t(pill.label)}</button>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a box of its own, a separator before a name, and an aside a screen reader reads", () => {
    expect(
      jsxKindsOf(
        [
          'const a = <div>{t("Your rules")} <Link to={route} className="block">{name}</Link></div>;',
          "const b = <span>{t(chipLabel)}{title ? <><InlineSeparator /><bdi>{title}</bdi></> : <></>}</span>;",
          'const c = <p>{t(step.title)}<span className="sr-only">{" "}{done ? t("(done)") : t("(to do)")}</span></p>;',
          'const d = <p>{t(name)}{done ? <>{" "}<span className="sr-only">{t("(done)")}</span></> : null}</p>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a negative control: the same lines without what sets them apart are found", () => {
    expect(
      jsxKindsOf(
        [
          'const a = <div>{t("Your rules")} <Link to={route}>{name}</Link></div>;',
          'const b = <button>{t("Errors")} <span className="bg-gray-100 px-1.5">{n}</span></button>;',
        ].join("\n"),
      ),
    ).toEqual([
      '{t("Your rules")} <Link to={route}>{name}</Link> => a value joined to a translated phrase',
      '{t("Errors")} <span className="bg-gray-100 px-1.5">{n}</span> => a value joined to a translated phrase',
    ]);
  });
});

describe("the reading of a child element (#8483)", () => {
  test("nothing between: an element before a phrase is a word of it, one after it its badge", () => {
    const options: JudgeOptions = { isJsx: true };

    expect(
      judgeLine(
        [
          { kind: "value", leading: "", trailing: "", isElement: true },
          { kind: "piece", isSentence: false, isLabel: false },
        ],
        options,
      ),
    ).toEqual([JoinedPieceKind.Value]);
    expect(
      judgeLine(
        [
          { kind: "piece", isSentence: false, isLabel: false },
          { kind: "value", leading: "", trailing: "", isElement: true },
        ],
        options,
      ),
    ).toEqual([]);
    expect(
      judgeLine(
        [
          { kind: "piece", isSentence: false, isLabel: false, isElement: true },
          { kind: "value", leading: "", trailing: "", isElement: true },
        ],
        options,
      ),
    ).toEqual([]);
  });

  test("a link to act on stands beside a hint, not beside a phrase read as one", () => {
    const link: Parameters<typeof judgeLine>[0][number] = {
      kind: "piece",
      isSentence: false,
      isLabel: false,
      isRead: true,
      startsAsSentence: true,
      isElement: true,
      isCallToAction: true,
    };

    expect(
      judgeLine([
        { kind: "piece", isSentence: false, isLabel: false, isRead: false },
        { kind: "text", text: " " },
        link,
      ]),
    ).toEqual([]);
    expect(
      judgeLine([
        { kind: "value", leading: "", trailing: "" },
        { kind: "text", text: " " },
        link,
      ]),
    ).toEqual([]);
    expect(
      judgeLine([
        { kind: "piece", isSentence: false, isLabel: false, isRead: true },
        { kind: "text", text: " " },
        link,
      ]),
    ).toEqual([JoinedPieceKind.Pieces]);
  });

  test("a sentence may start with a name written with a small first letter", () => {
    expect(isWholeSentence(["vCenter has not reported it."])).toBe(true);
    expect(isWholeSentence(["iOS apps send their crashes."])).toBe(true);
    expect(isWholeSentence(["is down."])).toBe(false);
    expect(isWholeSentence(["vcenter is down."])).toBe(false);
  });
});

/*
 * Mutation checks (#8290): each line this issue made one sentence, put back
 * as it was written, fails the guard again.
 */
const PUT_BACK: ReadonlyArray<{
  file: string;
  fixed: RegExp;
  asItWas: string;
}> = [
  {
    file: "packages/Common/UI/Components/EventItem/EventItem.tsx",
    fixed:
      /\{t\("eventItem\.postedOnDate", \{[\s\S]*?defaultValue: "posted on \{\{date\}\}",\s*\}\)\}/,
    asItWas:
      '{t("eventItem.postedOn", "posted on")}{" "}\n{OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(item.date)}',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel.tsx",
    fixed:
      /\{translator\.translateTemplate\(SHOWING_CONNECTIONS, \{[\s\S]*?\}\)\}/,
    asItWas:
      '{t("Showing")}{" "}\n{section.rows.length}{" "}\n{t("of")}{" "}\n{section.total}',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Topology/EdgeDetailPanel.tsx",
    fixed:
      /\{translator\.translateTemplate\(TRACES_FOR_SERVICE, \{\s*name: fromName,?\s*\}\)\}/,
    asItWas: '{translateString("Traces for") || ""} {fromName}',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateInspector.tsx",
    fixed:
      /\{translator\.translatePlural\(\s*OBSERVABLES_NOT_SHOWN,[\s\S]*?\)\}/,
    asItWas:
      '{props.droppedObservableCount}{" "}\n{t("less frequent observables not shown")}',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Capacity.tsx",
    fixed:
      /\{translator\.translateText\(\s*getOpenStackCapacityAllocatedTitle\(name\),\s*\)\}/,
    asItWas:
      '{translator.translateText(getOpenStackCapacityResourceTitle(name))}{" "}\n{translator.translateText("allocated")}',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthCard.tsx",
    fixed:
      /\{translator\.translateTemplate\(LABEL_WITH_COLON, \{\s*label: translatableTerm\("Capabilities"\),\s*\}\)\}/,
    asItWas: '{translator.translateText("Capabilities")}:',
  },
];

// The repository's files, as the scan reads a module or a locale.
const readFromDisk: ModuleReader = (file: string): string | undefined => {
  const absolute: string = path.join(REPOSITORY_ROOT, file);

  return fs.existsSync(absolute)
    ? fs.readFileSync(absolute, "utf8")
    : undefined;
};

const findingsOfPutBack: (data: {
  file: string;
  fixed: RegExp;
  asItWas: string;
}) => { fixed: number; putBack: number } = (data: {
  file: string;
  fixed: RegExp;
  asItWas: string;
}): { fixed: number; putBack: number } => {
  const source: string = fs.readFileSync(
    path.join(REPOSITORY_ROOT, data.file),
    "utf8",
  );

  expect(source).toMatch(data.fixed);

  return {
    fixed: findSentencesFromPieces({
      file: data.file,
      source,
      readModule: readFromDisk,
    }).length,
    putBack: findSentencesFromPieces({
      file: data.file,
      source: source.replace(data.fixed, data.asItWas),
      readModule: readFromDisk,
    }).length,
  };
};

describe("a line #8290 made one sentence, put back, fails the guard", () => {
  for (const entry of PUT_BACK) {
    test(entry.file, () => {
      const found: { fixed: number; putBack: number } =
        findingsOfPutBack(entry);

      expect(found.fixed).toBe(0);
      expect(found.putBack).toBeGreaterThan(0);
    });
  }
});

/*
 * Mutation checks (#8483): each sentence built around a child element that
 * this issue made one, put back as it was written, fails the guard again -
 * EventItem's "Incident state changed to" first, which #8290 found by hand.
 */
const PUT_BACK_AROUND_AN_ELEMENT: ReadonlyArray<{
  file: string;
  what: string;
  fixed: RegExp;
  asItWas: string;
}> = [
  {
    file: "packages/Common/UI/Components/EventItem/EventItem.tsx",
    what: "the event's kind, then state changed to, then the state's pill",
    fixed:
      /<TranslatedSentence\s+template=\{EVENT_STATE_CHANGED_TO\}[\s\S]*?\}\}\s*\/>/,
    asItWas: [
      '<span className="mr-2">',
      '  <span className="font-medium text-gray-900 mr-1">',
      "    {props.eventType}",
      "  </span>",
      '  {t("eventItem.stateChangedTo", "state changed to")}',
      "</span>",
      '<span className="mr-1">',
      "  <Pill text={item.stateDisplayName} isMinimal={true} />",
      "</span>",
    ].join("\n"),
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineToolbar.tsx",
    what: "a bold count, then covered now",
    fixed: /<SummaryCount\s+template=\{SUMMARY_COVERED_NOW\}[\s\S]*?\/>/,
    asItWas: [
      '<span className="font-semibold text-gray-900">',
      "  {props.summary.coveredNow}",
      "</span>",
      '{translator.translateText("covered now")}',
    ].join("\n"),
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatus.tsx",
    what: "a bold count, then its noun in English's plural",
    fixed:
      /<TranslatedSentence\s+template=\{props\.item\.label\}[\s\S]*?\}\}\s*\/>/,
    asItWas: [
      '<span className="font-semibold tabular-nums text-gray-900">',
      "  {translator.formatNumber(props.item.count)}",
      '</span>{" "}',
      "{translator.translatePlural(props.item.label, props.item.count)}",
    ].join("\n"),
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventProviderTile.tsx",
    what: "Connect for a screen reader, then the product",
    fixed:
      /<span className="sr-only">\s*\{translateTemplate\(CONNECT_PROVIDER, \{[\s\S]*?\}\)\}\s*<\/span>\s*<span aria-hidden="true">\{definition\.title\}<\/span>/,
    asItWas:
      '<span className="sr-only">{translateString("Connect")} </span>\n{definition.title}',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventProviderTile.tsx",
    what: "the product for a screen reader, then Setup guide",
    fixed:
      /<span className="sr-only">\s*\{translateTemplate\(PROVIDER_SETUP_GUIDE, \{[\s\S]*?\}\)\}\s*<\/span>\s*<span aria-hidden="true">\{translateString\("Setup guide"\)\}<\/span>/,
    asItWas:
      '<span className="sr-only">{definition.title} </span>\n{translateString("Setup guide")}',
  },
  {
    file: "packages/App/FeatureSet/StatusPage/src/Pages/Subscribe/Unsubscribe.tsx",
    what: "the channel, English's colon, then the address",
    fixed:
      /\{t\("subscribe\.unsubscribe\.channelWithColon", \{ channel: label \}\)\}\{" "\}/,
    asItWas: '{label}\n{": "}',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeLine.tsx",
    what: "View pull request, then its number",
    fixed:
      /\{change\.pullRequestNumber \? \(\s*<TranslatedSentence[\s\S]*?\/>\s*\) : \(\s*translator\.translateText\(DECLARED_CODE_VIEW_PULL_REQUEST\)\s*\)\}/,
    asItWas: [
      "{translator.translateText(DECLARED_CODE_VIEW_PULL_REQUEST)}",
      "{change.pullRequestNumber ? (",
      "  <>",
      '    {" "}',
      '    <span dir="ltr">#{change.pullRequestNumber}</span>',
      "  </>",
      ") : (",
      "  <></>",
      ")}",
    ].join("\n"),
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistImportModal.tsx",
    what: "a line left out, English's colon and dash between its pieces",
    fixed:
      /<TranslatedSentence\s+template=\{IMPORT_PROBLEM_ITEM\}[\s\S]*?\}\}\s*\/>/,
    asItWas: [
      '<span className="font-medium text-gray-700">',
      "  {translator.translateTemplate(IMPORT_PROBLEM_LINE, {",
      "    line: translator.formatNumber(problem.line),",
      "  })}",
      "</span>",
      '{": "}',
      '<IsolatedText text={problem.value} className="font-mono" />',
      '{" - "}',
      "{translator.translateText(problem.message) || problem.message}",
    ].join("\n"),
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/AIInsights/InsightListItem.tsx",
    what: "the bare count, then its sentence for a screen reader",
    fixed:
      /<span aria-hidden="true">\s*\{translator\.formatNumber\(occurrenceCount\)\}\s*<\/span>\s*<span className="sr-only">\{detectionsLabel\}<\/span>/,
    asItWas:
      '{occurrenceCount}\n<span className="sr-only"> {detectionsLabel}</span>',
  },
];

describe("a sentence #8483 made one around an element, put back, fails the guard", () => {
  for (const entry of PUT_BACK_AROUND_AN_ELEMENT) {
    test(`${entry.file}: ${entry.what}`, () => {
      const found: { fixed: number; putBack: number } =
        findingsOfPutBack(entry);

      expect(found.fixed).toBe(0);
      expect(found.putBack).toBeGreaterThan(0);
    });
  }
});

describe("a page's own translation helper is read as the translation it returns (#8571)", () => {
  test("a helper whose key is its argument: the argument is the piece's key", () => {
    // CodeProductionReview's text(), which rewords a host's name before it translates.
    expect(
      jsxKindsOf(
        [
          "function Page() {",
          "  const text: (key: string) => string = (key: string): string => {",
          "    const sentence: string = reword(key, provider);",
          "    return translator.translateText(sentence) || sentence;",
          "  };",
          '  const a = <p>{text("Read the")} <Link to={route}>{text("docs")}</Link></p>;',
          '  const b = <p>{text("It could not be posted.")} <Link to={route}>{text("Open settings")}</Link></p>;',
          "  return a;",
          "}",
        ].join("\n"),
      ),
    ).toEqual([
      '{text("Read the")} <Link to={route}>{text("docs")}</Link> => translated phrases joined',
    ]);
  });

  test("a helper that says its own sentence, and one declared as a function", () => {
    expect(
      kindsOf(
        [
          "const describe = (n: number): string => {",
          '  return translator.translateTemplate("Attempt {{n}}", { n });',
          "};",
          "function heading(): string {",
          '  return translator.translateText("It is done.");',
          "}",
          "const a = `${describe(n)} ${name}`;",
          "const b = `${heading()} ${reason}`;",
        ].join("\n"),
      ),
    ).toEqual([
      "`${describe(n)} ${name}` => a value joined to a translated phrase",
    ]);
  });

  test("a function that returns a translation on one path and a name on another is no helper", () => {
    // Users' on-call page: getFirstName's "this user", else the name as written.
    expect(
      kindsOf(
        [
          "const firstName = (name: string): string => {",
          '  if (!name) { return translateTerm("this user"); }',
          '  return name.split(" ")[0] || name;',
          "};",
          "const a = `${firstName(user)} ${surname}`;",
          "function b(text: (key: string) => string) {",
          '  return `${text("Read the")} ${name}`;',
          "}",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("English's punctuation after an element that holds a translated label (#8571)", () => {
  test("a colon or a comma written right after the element", () => {
    // FormBrandingSection, TelemetryActiveFilterChips and the watchlist import before the fix.
    expect(
      jsxKindsOf(
        [
          'const a = <p><span className="font-medium">{t("Logo Alt Text")}</span>{": "}{value}</p>;',
          'const b = <p><b>{t("Note")}</b>: {text}</p>;',
          'const c = <p><span>{t("Monitors")}</span>, <span>{t("Incidents")}</span></p>;',
        ].join("\n"),
      ),
    ).toEqual([
      '<span className="font-medium">{t("Logo Alt Text")}</span>{": "}{value} => punctuation written beside a translated phrase',
      '<b>{t("Note")}</b>: {text} => punctuation written beside a translated phrase',
      '<span>{t("Monitors")}</span>, <span>{t("Incidents")}</span> => punctuation written beside a translated phrase',
    ]);
  });

  test("a label with its own colon, a name in an element, and a colon inside a code sample", () => {
    expect(
      jsxKindsOf(
        [
          'const LABEL_WITH_COLON: string = translationKey("{{label}}:");',
          'const a = <p><span>{translateTemplate(LABEL_WITH_COLON, { label: translatableTerm("Logo Alt Text") })}</span> {value}</p>;',
          'const b = <p><span className="font-medium">{props.failure.name}</span>: {reason}</p>;',
          'const c = <pre><span className="text-amber-400">client_ip</span>: {"value"}</pre>;',
          'const d = <p>{t("Duration:")} {t(status)}</p>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("what is never drawn is no sentence (#8571)", () => {
  test("an element's key or id, a name that holds one, and a search's lowercased haystack", () => {
    expect(
      jsxKindsOf(
        [
          'const a = <span key={`${t("Reason")}-${text}`}>{text}</span>;',
          'const b = fileObject._id || `${t("File")}-${index}`;',
          'const key: string = fileObject._id || `${t("File")}-${index}`;',
          'const c = <div id={`${t("Panel")}-${id}`} data-testid={`${t("Row")}-${id}`} />;',
          'const d = { haystack: `${t("Host")} ${name}`.toLowerCase() };',
        ].join("\n"),
      ),
    ).toEqual([
      // A negative control: the same line, in a name that is drawn.
      '`${t("File")}-${index}` => a value joined to a translated phrase',
    ]);
  });
});

/*
 * Mutation checks (#8571): each label whose colon this issue took from a
 * key, put back with English's colon written after it, fails the guard.
 */
const PUT_BACK_COLON: ReadonlyArray<{
  file: string;
  what: string;
  fixed: RegExp;
  asItWas: string;
}> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/FormBuilder/Branding/FormBrandingSection.tsx",
    what: "Logo Alt Text, then English's colon",
    fixed:
      /\{translateTemplate\(LABEL_WITH_COLON, \{\s*label: translatableTerm\("Logo Alt Text"\),?\s*\}\)\}\s*<\/span>\{" "\}/,
    asItWas: '{tx("Logo Alt Text")}\n</span>\n{": "}',
  },
  {
    file: "packages/Common/UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips.tsx",
    what: "a filter chip's field, then English's colon",
    fixed:
      /\{translator\.translateTemplate\(LABEL_WITH_COLON, \{\s*label: keyText,?\s*\}\)\}/,
    asItWas: "{keyText}:",
  },
  {
    file: "packages/Common/UI/Components/TelemetryViewer/components/FacetHelpButton.tsx",
    what: "a value's name, English's colon, then its sentence",
    fixed:
      /\{translator\.translateTemplate\(LABEL_WITH_COLON, \{\s*label: entry\.label,?\s*\}\)\}\{" "\}/,
    asItWas: "{entry.label}: ",
  },
];

describe("a label #8571 gave its own colon, put back, fails the guard", () => {
  for (const entry of PUT_BACK_COLON) {
    test(`${entry.file}: ${entry.what}`, () => {
      const found: { fixed: number; putBack: number } =
        findingsOfPutBack(entry);

      expect(found.fixed).toBe(0);
      expect(found.putBack).toBeGreaterThan(0);
    });
  }
});
