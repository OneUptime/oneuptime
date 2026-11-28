import fs from "fs";
import path from "path";
import ts from "typescript";
import { listScanRoots, listSourceFiles } from "./ForeignHiddenRuleGuard";
import { REPOSITORY_ROOT } from "./PillTextNames";

/*
 * WHERE A STATE'S, A SEVERITY'S OR A STATUS'S NAME IS DRAWN AS TEXT, READ
 * FROM SOURCE (RecordNamesInTextGuard, #8064, #7894).
 *
 * A record of the lists a new project starts with - its states, severities,
 * monitor statuses, postmortem statuses, security case statuses and
 * priorities - is named by OneUptime ("Resolved", "Critical Incident") or by
 * the project ("Open", "Sev 1"). OneUptime's names read in the reader's
 * language, the project's as written (Common/Utils/DefaultRecordNames). Two
 * ways of drawing one broke that:
 *
 *   - looked up: handed to translatableTerm(), translateText() or
 *     translateTerm(), which look any text up, so a state named "Open" read
 *     the verb "Abrir" in Spanish - in the incident page's tiles, Mark as,
 *     the Change state dialogs (#8064);
 *   - drawn as stored: put into a sentence's values or a JSX text as it is,
 *     so the default "Resolved" read English on a German page, beside
 *     badges that say "Behoben" (#7894).
 *
 * Either has to go through the one rule: translateRecordName(translator,
 * list, name) for a name drawn as text, recordNameInSentence(list, name)
 * for one put into a sentence, isRecordNameAsWritten(list, name) for a
 * badge's or an option's mark.
 *
 * A name is told by what it is read off: `.name` (or `["name"]`,
 * `getColumnValue("name")`) of something called a state, a severity, a
 * status or a priority (`currentIncidentState`, `alertSeverity`,
 * `acknowledgeState`), or a value called one's name (`stateName`,
 * `severityName`, `targetStateName`). A variable is read through to what it
 * is set to in the same file, so one set by a call that decides is decided;
 * a call handed the name's list (`StateListType.IncidentState`) decides
 * too. A call that makes its own text is read where it makes it, and an
 * element where it draws its own. It is a reader of the code, not a run of
 * it: a name carried under another name (`tile.name`, `choice.name`) is out
 * of its sight, and the render tests hold those.
 */

export { REPOSITORY_ROOT };

// What is called a state, a severity, a status or a priority.
const STATE_WORD: RegExp = /(state|severity|status|priority)$/i;

// What is called one's name.
const STATE_NAME_WORD: RegExp = /(state|severity|status|priority)name$/i;

// An argument that names a list: StateListType.IncidentState.
const STATE_LIST_ARGUMENT: RegExp = /\bStateListType\./;

// The calls that read a name by its list, and so decide how it reads.
export const DECIDING_CALLS: ReadonlyArray<string> = [
  "translateRecordName",
  "recordNameInSentence",
  "isRecordNameAsWritten",
  "isDefaultRecordName",
  // The status page's and the on-call page's, by the same rule (#8066).
  "translateStatusName",
  "getOnCallPageStateName",
  // A form's request page's, handed the state's list (Accounts Utils/FormFollowUp).
  "getFormRequestStateName",
  // When this goes down's, which hand an event's kind its list.
  "getWhoIsToldSeverityValue",
  "getWhoIsToldStatusValue",
];

// The calls that look a text up in the reader's language, whatever it is.
const LOOKUP_CALLS: ReadonlyArray<string> = [
  "translatableTerm",
  "translateText",
  "translateTerm",
];

// The calls that fill a sentence with values.
const SENTENCE_CALLS: ReadonlyArray<string> = [
  "translateTemplate",
  "translatePlural",
  "translateTemplateAround",
];

/*
 * The calls that hand back the text they are called on or handed, reshaped:
 * `state.name.trim()`, `String(state.name)`, `[number, severity.name].join(" · ")`.
 * Any other call makes its own text, read where it is made.
 */
const TEXT_PASSING_METHODS: ReadonlyArray<string> = [
  "trim",
  "toString",
  "toLowerCase",
  "toUpperCase",
  "slice",
  "substring",
  "replace",
  "join",
  "concat",
];

const TEXT_PASSING_FUNCTIONS: ReadonlyArray<string> = ["String"];

// Where a value goes in each: its values are the argument at this place.
const SENTENCE_VALUES_ARGUMENT: Readonly<Record<string, number>> = {
  translateTemplate: 1,
  translatePlural: 2,
  translateTemplateAround: 1,
};

export enum RecordNameTextKind {
  // Looked up by its text: translatableTerm(), translateText(), translateTerm().
  LookedUp = "looked up",
  // Put into a sentence's values as it is stored.
  InSentenceAsStored = "in a sentence as stored",
  // Drawn as JSX text as it is stored.
  DrawnAsStored = "drawn as stored",
}

export interface RecordNameTextSite {
  // From the repository root, with forward slashes.
  file: string;
  line: number;
  kind: RecordNameTextKind;
  // The expression, as written, on one line.
  text: string;
}

// The name an expression ends in: `incident.currentIncidentState` is "currentIncidentState".
function lastSegment(node: ts.Expression): string {
  let expression: ts.Expression = node;

  while (
    ts.isNonNullExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression)
  ) {
    expression = expression.expression;
  }

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }

  return "";
}

// The name a call is made by: `translateText` of `translator.translateText(x)`.
function calleeName(call: ts.CallExpression): string {
  const callee: ts.Expression = call.expression;

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return "";
}

// The value a variable read at `from` is set to, in the nearest block declaring it.
function initializerOf(name: string, from: ts.Node): ts.Expression | undefined {
  for (
    let scope: ts.Node | undefined = from.parent;
    scope;
    scope = scope.parent
  ) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) {
      continue;
    }

    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }

      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer
        ) {
          return declaration.initializer;
        }
      }
    }
  }

  return undefined;
}

// Whether an identifier is read as a value where it stands.
function isReadAsValue(identifier: ts.Identifier): boolean {
  const parent: ts.Node = identifier.parent;

  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
    return false;
  }

  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent)) &&
    parent.name === identifier
  ) {
    return false;
  }

  return true;
}

/*
 * Whether an expression reads a state's, a severity's or a status's name
 * that nothing decided yet, following variables `depth` deep. A call that
 * decides (DECIDING_CALLS) is not read into; a comparison or a condition
 * draws nothing of what it compares.
 */
export function readsAStateName(
  expression: ts.Node,
  depth: number = 3,
): boolean {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue);
      visit(node.whenFalse);
      return;
    }

    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      return;
    }

    // `state.name && <Pill ... />` draws what is after it: the name is its condition.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      visit(node.right);
      return;
    }

    // An element draws its own text, read where it is drawn.
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      return;
    }

    if (ts.isCallExpression(node)) {
      const name: string = calleeName(node);

      // A call handed the name's list - StateListType.IncidentState - reads it by that list.
      if (
        DECIDING_CALLS.includes(name) ||
        node.arguments.some((argument: ts.Expression): boolean => {
          return STATE_LIST_ARGUMENT.test(argument.getText());
        })
      ) {
        return;
      }

      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (
        name === "getColumnValue" &&
        firstArgument &&
        ts.isStringLiteralLike(firstArgument) &&
        firstArgument.text === "name" &&
        ts.isPropertyAccessExpression(node.expression) &&
        STATE_WORD.test(lastSegment(node.expression.expression))
      ) {
        found = true;
        return;
      }

      if (
        ts.isPropertyAccessExpression(node.expression) &&
        TEXT_PASSING_METHODS.includes(name)
      ) {
        visit(node.expression.expression);
        node.arguments.forEach(visit);
        return;
      }

      if (
        ts.isIdentifier(node.expression) &&
        TEXT_PASSING_FUNCTIONS.includes(name)
      ) {
        node.arguments.forEach(visit);
        return;
      }

      // Any other call makes its own text, read where it is made.
      return;
    }

    // A function's body draws nothing until it is called.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      return;
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ((node.name.text === "name" &&
        STATE_WORD.test(lastSegment(node.expression))) ||
        STATE_NAME_WORD.test(node.name.text))
    ) {
      found = true;
      return;
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "name" &&
      STATE_WORD.test(lastSegment(node.expression))
    ) {
      found = true;
      return;
    }

    if (ts.isIdentifier(node) && isReadAsValue(node)) {
      const initializer: ts.Expression | undefined = initializerOf(
        node.text,
        node,
      );

      /*
       * A variable is what it is set to: `selectedStateName` set by
       * recordNameInSentence() is decided. One set by nothing the reader
       * can see - a parameter - is a name when it is called one.
       */
      if (initializer) {
        if (depth > 0 && readsAStateName(initializer, depth - 1)) {
          found = true;
        }

        return;
      }

      if (STATE_NAME_WORD.test(node.text)) {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(expression);

  return found;
}

// The values object of a sentence a call fills, when it is written out.
function sentenceValuesOf(
  call: ts.CallExpression,
): ts.ObjectLiteralExpression | undefined {
  const name: string = calleeName(call);
  const at: number | undefined = SENTENCE_VALUES_ARGUMENT[name];

  if (!SENTENCE_CALLS.includes(name) || at === undefined) {
    return undefined;
  }

  const values: ts.Expression | undefined = call.arguments[at];

  return values && ts.isObjectLiteralExpression(values) ? values : undefined;
}

// Each value written into a values object.
function valuesIn(values: ts.ObjectLiteralExpression): Array<ts.Expression> {
  const found: Array<ts.Expression> = [];

  for (const property of values.properties) {
    if (ts.isPropertyAssignment(property)) {
      found.push(property.initializer);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      found.push(property.name);
    }
  }

  return found;
}

// Every place a source file draws a state's name without its list deciding how.
export function readRecordNameTextSites(
  file: string,
  sourceText: string,
): Array<RecordNameTextSite> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: Array<RecordNameTextSite> = [];

  const add: (node: ts.Node, kind: RecordNameTextKind) => void = (
    node: ts.Node,
    kind: RecordNameTextKind,
  ): void => {
    sites.push({
      file: file,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      kind: kind,
      text: node.getText(source).replace(/\s+/g, " "),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name: string = calleeName(node);
      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (
        LOOKUP_CALLS.includes(name) &&
        firstArgument &&
        readsAStateName(firstArgument)
      ) {
        add(firstArgument, RecordNameTextKind.LookedUp);
      }

      const values: ts.ObjectLiteralExpression | undefined =
        sentenceValuesOf(node);

      for (const value of values ? valuesIn(values) : []) {
        // A term or a lookup is read above, as its call.
        if (
          ts.isCallExpression(value) &&
          LOOKUP_CALLS.includes(calleeName(value))
        ) {
          continue;
        }

        if (readsAStateName(value)) {
          add(value, RecordNameTextKind.InSentenceAsStored);
        }
      }
    }

    // <TranslatedSentence values={{ state: x.name }} />
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "values" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isObjectLiteralExpression(node.initializer.expression)
    ) {
      for (const value of valuesIn(node.initializer.expression)) {
        if (
          !(
            ts.isCallExpression(value) &&
            LOOKUP_CALLS.includes(calleeName(value))
          ) &&
          readsAStateName(value)
        ) {
          add(value, RecordNameTextKind.InSentenceAsStored);
        }
      }
    }

    // <span>{state.name}</span>
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      readsAStateName(node.expression)
    ) {
      add(node.expression, RecordNameTextKind.DrawnAsStored);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return sites;
}

// Every module of the front ends: each app's src, Common/UI and ee's screens.
export function listRecordNameScanFiles(): Array<string> {
  return listScanRoots(REPOSITORY_ROOT)
    .flatMap((root: string): Array<string> => {
      return listSourceFiles(root);
    })
    .map((file: string): string => {
      return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    })
    .sort();
}

// Every place the front ends draw a state's name without its list deciding how.
export function readAllRecordNameTextSites(): Array<RecordNameTextSite> {
  return listRecordNameScanFiles().flatMap(
    (file: string): Array<RecordNameTextSite> => {
      return readRecordNameTextSites(
        file,
        fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
      );
    },
  );
}
