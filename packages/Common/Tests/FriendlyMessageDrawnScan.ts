import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "./ForeignHiddenRuleGuard";

/*
 * WHERE API.getFriendlyMessage's ANSWER IS DRAWN ON ITS OWN, AS IT CAME
 * (FriendlyMessageDrawnGuard, #7537).
 *
 * For a failure nobody explained, API.getFriendlyMessage answers with one
 * of a few fixed English sentences (Common/Types/Exception/UnexplainedError):
 * a gateway's 502 or 504 is SERVER_DOWN_MESSAGE, which is no key in any
 * language, and a server failure comes with its reference filled in. The
 * shared places an error is drawn (ErrorMessage, ErrorExplanation, a form's
 * alert, a dialog) and every card sentence with {{error}} (ErrorSentence)
 * say these in the reader's language. A page that draws the answer on its
 * own - `<p>{error}</p>`, `{turnMonitoringOn.error}`, an empty state's
 * `description={error}` - drew the English on every page, and a server
 * failure's reference had no copy button.
 *
 * This finds every such draw, read through the TypeScript AST: a value
 * that holds API.getFriendlyMessage's answer, drawn as a JSX text child or
 * handed to a prop that draws text as it is. A value holds the answer when
 * it is set from it:
 *
 *   - a state's setter called with it: setError(API.getFriendlyMessage(e));
 *   - a variable declared or assigned with it;
 *   - a property of an object literal written with it
 *     ({ error: API.getFriendlyMessage(e) }), read back as `x.error`;
 *   - a hook's returned property, in the file that calls the hook
 *     (`const turnOn = useTurnMonitoringOn(); {turnOn.error}`).
 *
 * Wrapped in a conditional, `||` or `??`, or parentheses, it still holds
 * it. Handed to ErrorInSentence, ErrorExplanation, ErrorMessage, ErrorLine
 * or ErrorSentence it is drawn in the reader's language, and is no finding.
 */

// The check that tells an error nobody explained from any other message.
const EXPLAINED_CHECK: string = "isUnexplainedErrorMessage";

// The calls whose answer is an error's message for the reader.
export const FRIENDLY_CALLS: ReadonlyArray<string> = [
  "getFriendlyMessage",
  "getFriendlyErrorMessage",
];

/*
 * The props that draw their text as it is. A component that says its
 * error in the reader's language takes it as `message` or `error`, which
 * are never findings.
 */
export const TEXT_PROPS: ReadonlyArray<string> = [
  "description",
  "title",
  "text",
  "subtitle",
];

/*
 * Components whose text prop is drawn in the reader's language already,
 * an error nobody explained as ErrorExplanation: a finding there is none.
 */
export const COMPONENTS_THAT_EXPLAIN: Record<string, ReadonlyArray<string>> = {
  // An error nobody explained is drawn with ErrorInSentence (#7537).
  Alert: ["title"],
  ConfirmModal: ["description"],
  InvestigationNotice: ["title"],
  // Drawn with ErrorMessageText.
  TableEmptyState: ["description"],
};

export interface FriendlyDrawFinding {
  // Relative to the repository root, with forward slashes.
  file: string;
  // 1-based.
  line: number;
  // The expression drawn, as written.
  text: string;
  // How it is drawn: "text child", or the prop it is handed to.
  how: string;
  // Where the drawn expression is in the source: a text child's braces.
  start: number;
  end: number;
  /*
   * A text child that is all its element draws: no words of the page's
   * around it, so it is an error drawn on its own.
   */
  standsAlone: boolean;
}

export interface FriendlySource {
  file: string;
  source: string;
}

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

// `x`, `(x)`, `x!`, `x as T` are all `x`.
function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function calleeName(call: ts.CallExpression): string | null {
  const callee: ts.Expression = unwrap(call.expression);

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return null;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text;
  }

  return null;
}

// What one file says of the values that hold the friendly message.
interface FileFacts {
  // Names (variables, states) that hold it.
  names: Set<string>;
  // Property names that hold it, wherever they are read in the file.
  properties: Set<string>;
  // Hook names this file defines, with the returned properties that hold it.
  hooks: Map<string, Set<string>>;
}

// The hooks of every file read: name -> the properties that hold it.
export type FriendlyHooks = Map<string, Set<string>>;

/*
 * Whether an expression holds the friendly message, by what the file
 * learnt so far.
 */
function holdsFriendly(
  expression: ts.Expression | undefined,
  facts: FileFacts,
  hookVariables: Map<string, Set<string>>,
): boolean {
  if (!expression) {
    return false;
  }

  const node: ts.Expression = unwrap(expression);

  if (ts.isCallExpression(node)) {
    const name: string | null = calleeName(node);

    return name !== null && FRIENDLY_CALLS.includes(name);
  }

  if (ts.isIdentifier(node)) {
    return facts.names.has(node.text);
  }

  if (ts.isPropertyAccessExpression(node)) {
    const property: string = node.name.text;
    const owner: ts.Expression = unwrap(node.expression);

    if (
      ts.isIdentifier(owner) &&
      hookVariables.get(owner.text)?.has(property)
    ) {
      return true;
    }

    return facts.properties.has(property);
  }

  if (ts.isConditionalExpression(node)) {
    /*
     * isUnexplainedErrorMessage(error) ? <ErrorExplanation ... /> : error:
     * the answer nobody explained is explained, and only a message somebody
     * wrote is drawn as it is.
     */
    const condition: ts.Expression = unwrap(node.condition);

    if (
      ts.isCallExpression(condition) &&
      calleeName(condition) === EXPLAINED_CHECK
    ) {
      return holdsFriendly(node.whenTrue, facts, hookVariables);
    }

    return (
      holdsFriendly(node.whenTrue, facts, hookVariables) ||
      holdsFriendly(node.whenFalse, facts, hookVariables)
    );
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return (
      holdsFriendly(node.left, facts, hookVariables) ||
      holdsFriendly(node.right, facts, hookVariables)
    );
  }

  return false;
}

/*
 * The setters of a file's states: setError -> error, from
 * `const [error, setError] = useState(...)`.
 */
function settersOf(sourceFile: ts.SourceFile): Map<string, string> {
  const setters: Map<string, string> = new Map<string, string>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements.length >= 2 &&
      node.initializer &&
      ts.isCallExpression(unwrap(node.initializer))
    ) {
      const call: ts.CallExpression = unwrap(
        node.initializer,
      ) as ts.CallExpression;
      const [value, setter] = node.name.elements;

      if (
        calleeName(call) === "useState" &&
        value &&
        setter &&
        ts.isBindingElement(value) &&
        ts.isBindingElement(setter) &&
        ts.isIdentifier(value.name) &&
        ts.isIdentifier(setter.name)
      ) {
        setters.set(setter.name.text, value.name.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return setters;
}

// The variables a file binds to a hook it calls: `const x = useHook()`.
function hookVariablesOf(
  sourceFile: ts.SourceFile,
  hooks: FriendlyHooks,
  facts: FileFacts,
): Map<string, Set<string>> {
  const variables: Map<string, Set<string>> = new Map<string, Set<string>>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(unwrap(node.initializer))
    ) {
      const name: string | null = calleeName(
        unwrap(node.initializer) as ts.CallExpression,
      );
      const properties: Set<string> | undefined =
        name !== null ? hooks.get(name) : undefined;

      if (properties && properties.size > 0) {
        if (ts.isIdentifier(node.name)) {
          variables.set(node.name.text, properties);
        } else if (ts.isObjectBindingPattern(node.name)) {
          // `const { error } = useHook()`: `error` holds it.
          for (const element of node.name.elements) {
            const read: string | null =
              element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : ts.isIdentifier(element.name)
                  ? element.name.text
                  : null;

            if (read && properties.has(read) && ts.isIdentifier(element.name)) {
              facts.names.add(element.name.text);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return variables;
}

// A hook's name: useTurnMonitoringOn.
const HOOK_NAME: RegExp = /^use[A-Z]/;

// The name of the function a node is in, when it is a hook's (use*).
function enclosingHookName(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return HOOK_NAME.test(current.name.text) ? current.name.text : null;
    }

    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      const name: string = current.parent.name.text;

      if (HOOK_NAME.test(name)) {
        return name;
      }
    }

    current = current.parent;
  }

  return null;
}

/*
 * What a file says of the values that hold the friendly message: run until
 * nothing new is learnt, since a value set from another that holds it
 * holds it too.
 */
function learnFacts(
  sourceFile: ts.SourceFile,
  hooks: FriendlyHooks,
): { facts: FileFacts; hookVariables: Map<string, Set<string>> } {
  const facts: FileFacts = {
    names: new Set<string>(),
    properties: new Set<string>(),
    hooks: new Map<string, Set<string>>(),
  };
  const setters: Map<string, string> = settersOf(sourceFile);
  const hookVariables: Map<string, Set<string>> = hookVariablesOf(
    sourceFile,
    hooks,
    facts,
  );

  let learnt: boolean = true;

  const learn: (set: Set<string>, value: string) => void = (
    set: Set<string>,
    value: string,
  ): void => {
    if (!set.has(value)) {
      set.add(value);
      learnt = true;
    }
  };

  // Each property of an object literal that holds it, and its owner's state.
  const learnObject: (
    object: ts.ObjectLiteralExpression,
    state: string | null,
  ) => void = (
    object: ts.ObjectLiteralExpression,
    state: string | null,
  ): void => {
    for (const property of object.properties) {
      let name: string | null = null;
      let holds: boolean = false;

      if (ts.isPropertyAssignment(property)) {
        name = propertyName(property.name);
        holds = holdsFriendly(property.initializer, facts, hookVariables);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        name = property.name.text;
        holds = facts.names.has(property.name.text);
      }

      if (name && holds) {
        learn(facts.properties, name);

        if (state) {
          learn(facts.names, state);
        }
      }
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // setError(<it>), setState({ error: <it> }), setState((p) => ({ ...p, error: <it> })).
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const name: string | null = calleeName(node);
      const state: string | undefined =
        name !== null ? setters.get(name) : undefined;

      if (state) {
        const argument: ts.Expression = unwrap(node.arguments[0]!);

        if (holdsFriendly(argument, facts, hookVariables)) {
          learn(facts.names, state);
        }

        if (ts.isObjectLiteralExpression(argument)) {
          learnObject(argument, null);
        }

        if (
          (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
          ts.isExpression(argument.body as ts.Node)
        ) {
          const body: ts.Expression = unwrap(argument.body as ts.Expression);

          if (holdsFriendly(body, facts, hookVariables)) {
            learn(facts.names, state);
          }

          if (ts.isObjectLiteralExpression(body)) {
            learnObject(body, null);
          }
        }
      }
    }

    // const message = API.getFriendlyMessage(err);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      holdsFriendly(node.initializer, facts, hookVariables)
    ) {
      learn(facts.names, node.name.text);
    }

    // message = API.getFriendlyMessage(err);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      holdsFriendly(node.right, facts, hookVariables)
    ) {
      learn(facts.names, node.left.text);
    }

    // { error: API.getFriendlyMessage(err) }, anywhere.
    if (ts.isObjectLiteralExpression(node)) {
      learnObject(node, null);

      // A hook's returned object: its properties hold it for its callers.
      if (node.parent && ts.isReturnStatement(node.parent)) {
        const hook: string | null = enclosingHookName(node);

        if (hook) {
          for (const property of node.properties) {
            const name: string | null = ts.isPropertyAssignment(property)
              ? propertyName(property.name)
              : ts.isShorthandPropertyAssignment(property)
                ? property.name.text
                : null;
            const holds: boolean = ts.isPropertyAssignment(property)
              ? holdsFriendly(property.initializer, facts, hookVariables)
              : ts.isShorthandPropertyAssignment(property)
                ? facts.names.has(property.name.text)
                : false;

            if (name && holds) {
              const returned: Set<string> =
                facts.hooks.get(hook) || new Set<string>();

              if (!returned.has(name)) {
                returned.add(name);
                facts.hooks.set(hook, returned);
                learnt = true;
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  while (learnt) {
    learnt = false;
    visit(sourceFile);
  }

  return { facts, hookVariables };
}

function tagOf(attribute: ts.JsxAttribute): string {
  const element: ts.Node = attribute.parent.parent;

  if (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) {
    return element.tagName.getText();
  }

  return "";
}

// Where a file draws a value that holds the friendly message, as it came.
function findDraws(
  file: string,
  sourceFile: ts.SourceFile,
  facts: FileFacts,
  hookVariables: Map<string, Set<string>>,
): Array<FriendlyDrawFinding> {
  const found: Array<FriendlyDrawFinding> = [];

  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1
    );
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      holdsFriendly(node.expression, facts, hookVariables)
    ) {
      const siblings: ReadonlyArray<ts.JsxChild> = node.parent.children;

      found.push({
        file,
        line: lineOf(node),
        text: node.expression.getText(sourceFile),
        how: "text child",
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        standsAlone: siblings.every((sibling: ts.JsxChild): boolean => {
          return (
            sibling === node ||
            (ts.isJsxText(sibling) && sibling.text.trim() === "")
          );
        }),
      });
    }

    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      const prop: string = node.name.getText(sourceFile);
      const tag: string = tagOf(node);

      if (
        TEXT_PROPS.includes(prop) &&
        !(COMPONENTS_THAT_EXPLAIN[tag] || []).includes(prop) &&
        holdsFriendly(node.initializer.expression, facts, hookVariables)
      ) {
        found.push({
          file,
          line: lineOf(node),
          text: node.initializer.expression.getText(sourceFile),
          how: `${tag}'s ${prop}`,
          start: node.initializer.expression.getStart(sourceFile),
          end: node.initializer.expression.getEnd(),
          standsAlone: false,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

/*
 * Every draw of the friendly message as it came, in a set of modules: the
 * hooks are learnt from all of them first, so a file that calls one
 * defined in another is read with what the hook returns.
 */
export function findFriendlyDrawsInSources(
  sources: Array<FriendlySource>,
): Array<FriendlyDrawFinding> {
  const parsed: Array<{ file: string; sourceFile: ts.SourceFile }> =
    sources.map((source: FriendlySource) => {
      return {
        file: source.file,
        sourceFile: parse(source.file, source.source),
      };
    });

  const hooks: FriendlyHooks = new Map<string, Set<string>>();

  // Hooks that call other hooks: learn until nothing new is learnt.
  for (let round: number = 0; round < 3; round++) {
    for (const { sourceFile } of parsed) {
      if (!sourceFile.text.includes("use")) {
        continue;
      }

      const { facts } = learnFacts(sourceFile, hooks);

      for (const [hook, properties] of facts.hooks) {
        const known: Set<string> = hooks.get(hook) || new Set<string>();

        for (const property of properties) {
          known.add(property);
        }

        hooks.set(hook, known);
      }
    }
  }

  const found: Array<FriendlyDrawFinding> = [];

  for (const { file, sourceFile } of parsed) {
    if (!file.endsWith(".tsx")) {
      continue;
    }

    const { facts, hookVariables } = learnFacts(sourceFile, hooks);

    found.push(...findDraws(file, sourceFile, facts, hookVariables));
  }

  return found;
}

export const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../..");

/*
 * The browser modules read: every feature set's (the Dashboard, Accounts,
 * the Admin Dashboard, status pages, public dashboards), the shared UI's,
 * and the Enterprise screens' when ee/ is in the checkout.
 */
export function listFriendlyScanFiles(repositoryRoot: string): Array<string> {
  return listScanRoots(repositoryRoot).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );
}

export function findFriendlyDraws(
  repositoryRoot: string = REPOSITORY_ROOT,
): Array<FriendlyDrawFinding> {
  return findFriendlyDrawsInSources(
    listFriendlyScanFiles(repositoryRoot).map((file: string) => {
      return {
        file: toRelativePath(repositoryRoot, file),
        source: fs.readFileSync(file, "utf8"),
      };
    }),
  );
}

// A finding as "<file>:<line> <how>: <text>".
export function formatFriendlyDraw(finding: FriendlyDrawFinding): string {
  return `${finding.file}:${finding.line} ${finding.how}: ${finding.text}`;
}
