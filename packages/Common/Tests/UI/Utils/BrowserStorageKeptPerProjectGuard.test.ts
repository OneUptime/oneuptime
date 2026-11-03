import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * WHAT THE DASHBOARD, THE ADMIN DASHBOARD AND THE SIGN-IN PAGES KEEP IN THE
 * BROWSER'S STORAGE, AND UNDER WHICH NAMES (#5306's follow-up).
 *
 * Every tab open on OneUptime's address shares its localStorage. A person
 * with two projects open in two tabs saw one tab's buttons follow the other
 * project's role, because the permission snapshot of "the current project"
 * was kept under one name for every project ("project_permissions"). The
 * snapshot is now kept per project (Common/UI/Utils/Permission). This guard
 * reads every browser module of those apps, and of Common/UI that they
 * share, with the TypeScript parser, and holds every local storage name to
 * one of:
 *
 *   - computed when it is used - with the project's id, a record's, the
 *     person's - so it is not the same for every project;
 *   - handed in by a caller (a helper's parameter): the helpers that keep a
 *     person's choices are followed to their callers (NAMING_HELPERS);
 *   - a fixed name the browser keeps for the person or for the browser, on
 *     the list below with its reason - the same in every project, on
 *     purpose.
 *
 * A fixed name is a string written out, a constant holding one (in the
 * module or imported from another), or one built only from such. Anything
 * per-project kept under a fixed name - a filter, a draft, the last page a
 * project's tab showed - fails here until it is named per project or
 * listed with a reason as good as these.
 *
 * Session storage is a tab's own (a duplicated tab gets a copy, and from
 * then on each keeps its own), so a fixed name there can never be another
 * tab's: those calls pass. The status page and public dashboard apps have
 * their own guard (App/Tests/StatusPage/PageIdKeptPerTabGuard). ee/ is
 * scanned when it is checked out (Common Test runs without it).
 */

// packages/Common/Tests/UI/Utils -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SCANNED_ROOTS: Array<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/Common/UI",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

/*
 * The storage wrappers themselves: every name they are given is their
 * caller's, and their callers are scanned.
 */
const STORAGE_WRAPPERS: Array<string> = [
  "packages/Common/UI/Utils/LocalStorage.ts",
  "packages/Common/UI/Utils/SessionStorage.ts",
];

const LOCAL_STORAGE_RECEIVERS: Array<string> = [
  "LocalStorage",
  "localStorage",
  "window.localStorage",
  "globalThis.localStorage",
];

const SESSION_STORAGE_RECEIVERS: Array<string> = [
  "SessionStorage",
  "sessionStorage",
  "window.sessionStorage",
  "globalThis.sessionStorage",
];

/*
 * A Storage handed to a helper (TopologyPositionOverrides, ReplayViewPrefs,
 * RememberedChoice, the maintenance calendar's): read as local storage,
 * which most of them are, so a fixed name there is held to the list too.
 */
const HANDED_STORAGE_RECEIVERS: Array<string> = ["storage", "store"];

const STORAGE_METHODS: Array<string> = ["getItem", "setItem", "removeItem"];

/*
 * The helpers that keep a person's choices in local storage under a name
 * their caller gives: where in the call that name is.
 */
interface NamingHelper {
  // A call (`RememberedChoice.read`), a constructor (`new RememberedView`) or a JSX attribute.
  kind: "call" | "construct" | "jsx";
  name: string;
  argument?: number | undefined;
  property?: string | undefined;
}

const NAMING_HELPERS: Array<NamingHelper> = [
  { kind: "call", name: "RememberedChoice.read", argument: 0 },
  { kind: "call", name: "RememberedChoice.remember", argument: 0 },
  { kind: "call", name: "RememberedChoice.forget", argument: 0 },
  { kind: "call", name: "RememberedChoice.subscribe", argument: 0 },
  { kind: "call", name: "readRecentCommandIds", argument: 0 },
  { kind: "call", name: "writeRecentCommandId", argument: 0 },
  { kind: "call", name: "useAutoRefresh", property: "storageKey" },
  { kind: "construct", name: "RememberedView", property: "storageKey" },
  { kind: "jsx", name: "recentStorageKey" },
];

/*
 * FIXED NAMES KEPT FOR THE PERSON OR THE BROWSER, NOT FOR A PROJECT: the
 * same in every project, on purpose. Each says why. A new one belongs here
 * only with a reason as good.
 */
const KEPT_FOR_THE_PERSON: Record<string, string> = {
  // Who is signed in: every tab of this browser is signed in as the same person.
  user_id: "who is signed in",
  user_name: "the signed-in person's name, for the header",
  user_email: "the signed-in person's email",
  profile_pic_id: "the signed-in person's picture",
  is_master_admin:
    "whether the signed-in person is a master admin - everywhere, in every project",
  token: "only removed: a session token the browser no longer keeps",
  // Their account's settings, the same in every project.
  user_timezone:
    "the person's timezone, from their account: every date in every project is shown in it",
  user_timezone_dismissed:
    "the timezone whose prompt the person put away - theirs, not a project's",
  // Sign-up's hand-offs, read once when the account or its first project is made.
  cardRegistered: "whether the person added a payment card at sign-up",
  initialUrl: "the address the person first opened, for sign-up",
  promoCode:
    "a promo code from the sign-up link, offered when the person creates their next project",
  clickIds:
    "the ad click ids the marketing site kept, read once at sign-up - the browser's, not a project's",
  firstTouch:
    "how the person first reached OneUptime, kept by the marketing site and read once at sign-up",
  // The person's permissions everywhere, beside the per-project snapshots (UI/Utils/Permission).
  global_permissions:
    "the person's global permissions and the list of their projects - the same in every tab, as every tab is the same person",
  "global-permissions-hash":
    "the hash of the global snapshot above, which every tab's requests send",
  // The session, across tabs.
  "oneuptime-last-activity-at":
    "when the person last used OneUptime in any tab: the idle timeout counts from it across tabs (UserActivity)",
  // Which project a new tab opens (UI/Utils/Project).
  last_accessed_project_id:
    "the project this browser opened last - what a new tab opens at /dashboard; each tab then keeps its own in session storage",
  // How the person likes OneUptime to look and read: their pick, the same in every project.
  oneuptimeLang:
    "the language the person reads OneUptime in, on every page and in every project",
  "oneuptime-dashboard-theme":
    "the person's light, dark or system theme, on every page and in every project",
  "oneuptime-navbar-product-categories":
    "which categories of the products menu the person folded",
  "oneuptime-navbar-recent-products":
    "the products the person visited: their addresses name the project, so each project's row lists its own (NavBarRecentProducts)",
  "oneuptime-command-palette-recents":
    "the Search commands the person ran: the commands are the same in every project, and each opens in the tab's own",
  "oneuptime.status-timeline-view":
    "whether the person reads state timelines as a timeline or a table",
  "metric-explorer-show-events":
    "whether the person shows events on metric charts",
  "metric-explorer-compare-previous":
    "whether the person compares metric charts with the period before",
  "oneuptime-network-map-layers": "which layers the person shows on site maps",
  "oneuptime.scheduleTimeline.mode":
    "whether the person reads on-call schedules by week or by month",
  "oneuptime.scheduleTimeline.groupByTeam":
    "whether the person groups on-call schedules by team",
  "oneuptime.replay.prefs":
    "how the person plays session replays: speed, skipping idle time",
  "oneuptime.investigationConversation.permissionMode":
    "how the person last asked OneUptime AI to act in a conversation - a starting pick for the next one; each request still says it",
  "oneuptime.llm-connect-way":
    "the way the person last picked on Connect an AI tool",
  "oneuptime.scheduled-maintenance-view":
    "only read once and removed: where the old List | Calendar switch kept the person's pick",
  // The instance's own, on the Admin Dashboard.
  "admin-dashboard-server-setup-hidden":
    "whether the master admin put the setup checklist away - the instance's, not a project's",
};

/*
 * How often a page refreshes itself: the person's pick for that page, the
 * same in every project. One rule for every such page, by the name's end.
 */
const AUTO_REFRESH_PICK_ENDING: string = "-auto-refresh-interval";

// The names every project's permission snapshot shared. Never used any more.
const SHARED_PERMISSION_NAMES: Array<string> = [
  "project_permissions",
  "project-permissions-hash",
];

interface StorageName {
  kind: "fixed" | "computed" | "handed-in";
  value?: string | undefined;
  /*
   * For a name handed in: the function whose parameter it is, and which
   * parameter - so the module's own calls of that function are followed.
   */
  parameterOf?: ts.SignatureDeclaration | undefined;
  parameterIndex?: number | undefined;
}

interface StorageUse {
  file: string;
  line: number;
  // What keeps it: a storage call, or a helper that names a choice.
  via: string;
  isSessionStorage: boolean;
  name: StorageName;
  text: string;
}

function toRepositoryPath(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        ["node_modules", "build", "dist", "Tests", "Locales"].includes(
          entry.name,
        )
      ) {
        continue;
      }

      found.push(...listSourceFiles(full));
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(full);
    }
  }

  return found;
}

const parsedFiles: Map<string, ts.SourceFile | null> = new Map();

function parseFile(file: string, text?: string): ts.SourceFile | null {
  if (text === undefined && parsedFiles.has(file)) {
    return parsedFiles.get(file) || null;
  }

  let source: string | undefined = text;

  if (source === undefined) {
    if (!fs.existsSync(file)) {
      parsedFiles.set(file, null);
      return null;
    }

    source = fs.readFileSync(file, "utf8");
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  if (text === undefined) {
    parsedFiles.set(file, sourceFile);
  }

  return sourceFile;
}

// The file an import specifier names, or null for a package.
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string | null = null;

  if (specifier.startsWith("Common/")) {
    base = path.join(REPOSITORY_ROOT, "packages", specifier);
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  }

  if (!base) {
    return null;
  }

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "Index.ts"),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// A module-level `const NAME = ...` of a file, or undefined.
function findModuleConst(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Expression | null | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer || null;
      }
    }
  }

  return undefined;
}

// Where a name a file imports comes from: the module's file and its exported name.
function findImport(
  sourceFile: ts.SourceFile,
  name: string,
): { file: string; exportedName: string } | null {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    ) {
      continue;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause.namedBindings;

    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    for (const element of bindings.elements) {
      if (element.name.text !== name) {
        continue;
      }

      const file: string | null = resolveImport(
        sourceFile.fileName,
        statement.moduleSpecifier.text,
      );

      return file
        ? {
            file: file,
            exportedName: (element.propertyName || element.name).text,
          }
        : null;
    }
  }

  return null;
}

/*
 * The string an expression always is, or null when it is computed when it
 * runs: a string written out, a constant holding one - in the module, or
 * imported from another - or one built only from such.
 */
function evaluateFixed(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  depth: number = 0,
): string | null {
  if (depth > 12) {
    return null;
  }

  const node: ts.Expression = unwrap(expression);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateExpression(node)) {
    let value: string = node.head.text;

    for (const span of node.templateSpans) {
      const part: string | null = evaluateFixed(
        span.expression,
        sourceFile,
        depth + 1,
      );

      if (part === null) {
        return null;
      }

      value += part + span.literal.text;
    }

    return value;
  }

  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left: string | null = evaluateFixed(node.left, sourceFile, depth + 1);
    const right: string | null = evaluateFixed(
      node.right,
      sourceFile,
      depth + 1,
    );

    return left === null || right === null ? null : left + right;
  }

  if (ts.isIdentifier(node)) {
    return evaluateIdentifier(node.text, sourceFile, depth + 1);
  }

  return null;
}

function evaluateIdentifier(
  name: string,
  sourceFile: ts.SourceFile,
  depth: number,
): string | null {
  const local: ts.Expression | null | undefined = findModuleConst(
    sourceFile,
    name,
  );

  if (local !== undefined) {
    return local ? evaluateFixed(local, sourceFile, depth) : null;
  }

  const imported: { file: string; exportedName: string } | null = findImport(
    sourceFile,
    name,
  );

  if (!imported) {
    return null;
  }

  const importedFile: ts.SourceFile | null = parseFile(imported.file);

  return importedFile
    ? evaluateIdentifier(imported.exportedName, importedFile, depth)
    : null;
}

/*
 * Where a variable the call sees takes its value from, looked up from the
 * call outwards as the language does: the iterable of a for...of that
 * declares it (computed), a declaration in an enclosing block, a
 * function's parameter (handed in), or the module.
 */
function classifyIdentifier(
  from: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
): StorageName {
  for (let node: ts.Node = from.parent; node; node = node.parent) {
    if (
      ts.isForOfStatement(node) &&
      ts.isVariableDeclarationList(node.initializer) &&
      node.initializer.declarations.some(
        (declaration: ts.VariableDeclaration): boolean => {
          return (
            ts.isIdentifier(declaration.name) && declaration.name.text === name
          );
        },
      )
    ) {
      return { kind: "computed" };
    }

    if (ts.isBlock(node)) {
      for (const statement of node.statements) {
        if (!ts.isVariableStatement(statement)) {
          continue;
        }

        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name
          ) {
            return declaration.initializer
              ? classifyExpression(declaration.initializer, sourceFile)
              : { kind: "computed" };
          }
        }
      }
    }

    if (ts.isFunctionLike(node)) {
      const index: number = node.parameters.findIndex(
        (parameter: ts.ParameterDeclaration): boolean => {
          return (
            ts.isIdentifier(parameter.name) && parameter.name.text === name
          );
        },
      );

      if (index >= 0) {
        return {
          kind: "handed-in",
          parameterOf: node,
          parameterIndex: index,
        };
      }
    }

    if (ts.isSourceFile(node)) {
      break;
    }
  }

  const value: string | null = evaluateIdentifier(name, sourceFile, 0);

  return value === null ? { kind: "computed" } : { kind: "fixed", value };
}

function classifyExpression(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  from?: ts.Node,
): StorageName {
  if (!expression) {
    return { kind: "computed" };
  }

  const node: ts.Expression = unwrap(expression);

  if (ts.isIdentifier(node)) {
    return classifyIdentifier(from || node, node.text, sourceFile);
  }

  // `this.storageKey`, `definition.storageKey`: a value handed to the object.
  if (ts.isPropertyAccessExpression(node)) {
    return { kind: "handed-in" };
  }

  const value: string | null = evaluateFixed(node, sourceFile);

  return value === null ? { kind: "computed" } : { kind: "fixed", value };
}

/*
 * The name a function is called by in its module: a function's own name,
 * the constant an arrow function is held in, a method's name.
 */
function functionName(fn: ts.SignatureDeclaration): string | null {
  if (
    (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) &&
    fn.name &&
    ts.isIdentifier(fn.name)
  ) {
    return fn.name.text;
  }

  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    fn.parent &&
    ts.isVariableDeclaration(fn.parent) &&
    ts.isIdentifier(fn.parent.name)
  ) {
    return fn.parent.name.text;
  }

  return null;
}

// Every call in the module of a function by its name: `name(...)`, `this.name(...)`, `X.name(...)`.
function findCallsOf(
  sourceFile: ts.SourceFile,
  name: string,
): Array<ts.CallExpression> {
  const calls: Array<ts.CallExpression> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee: ts.Expression = node.expression;

      if (
        (ts.isIdentifier(callee) && callee.text === name) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === name)
      ) {
        calls.push(node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return calls;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function calleeName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    return `${expression.expression.text}.${expression.name.text}`;
  }

  return "";
}

// The argument or option of a helper call that names what it keeps.
function helperNameExpression(
  helper: NamingHelper,
  args: ts.NodeArray<ts.Expression> | undefined,
): ts.Expression | undefined {
  if (!args) {
    return undefined;
  }

  if (helper.argument !== undefined) {
    return args[helper.argument];
  }

  const options: ts.Expression | undefined = args[0]
    ? unwrap(args[0])
    : undefined;

  if (!options || !ts.isObjectLiteralExpression(options)) {
    return undefined;
  }

  for (const property of options.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === helper.property
    ) {
      return property.initializer;
    }

    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === helper.property
    ) {
      return property.name;
    }
  }

  return undefined;
}

// A module that may keep something in storage: no other needs a parse.
const MAY_KEEP_IN_STORAGE: RegExp =
  /getItem|setItem|removeItem|Remembered|RecentCommand|AutoRefresh|recentStorageKey/;

// Every name a module keeps in the browser's storage, and how.
function findStorageUses(file: string, text: string): Array<StorageUse> {
  if (!MAY_KEEP_IN_STORAGE.test(text)) {
    return [];
  }

  const sourceFile: ts.SourceFile | null = parseFile(file, text);

  if (!sourceFile) {
    return [];
  }

  const uses: Array<StorageUse> = [];
  const repositoryPath: string = toRepositoryPath(file);

  /*
   * Records what keeps a name. A name a function of this module is handed
   * is followed to the module's own calls of that function, where it is
   * named; a helper exported for other modules stays handed in.
   */
  const record: (
    node: ts.Node,
    via: string,
    isSessionStorage: boolean,
    expression: ts.Expression | undefined,
    depth?: number,
  ) => void = (
    node: ts.Node,
    via: string,
    isSessionStorage: boolean,
    expression: ts.Expression | undefined,
    depth: number = 0,
  ): void => {
    const name: StorageName = classifyExpression(expression, sourceFile, node);

    if (
      name.kind === "handed-in" &&
      name.parameterOf &&
      name.parameterIndex !== undefined &&
      depth < 4
    ) {
      const helper: string | null = functionName(name.parameterOf);
      const calls: Array<ts.CallExpression> = helper
        ? findCallsOf(sourceFile, helper)
        : [];

      if (calls.length > 0) {
        for (const call of calls) {
          record(
            call,
            `${helper}`,
            isSessionStorage,
            call.arguments[name.parameterIndex],
            depth + 1,
          );
        }

        return;
      }
    }

    uses.push({
      file: repositoryPath,
      line: lineOf(sourceFile, node),
      via: via,
      isSessionStorage: isSessionStorage,
      name: name,
      text: expression ? expression.getText(sourceFile) : "",
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee: ts.Expression = node.expression;

      if (
        ts.isPropertyAccessExpression(callee) &&
        STORAGE_METHODS.includes(callee.name.text)
      ) {
        const receiver: string = callee.expression.getText(sourceFile);
        const isSession: boolean = SESSION_STORAGE_RECEIVERS.includes(receiver);
        const isLocal: boolean =
          LOCAL_STORAGE_RECEIVERS.includes(receiver) ||
          HANDED_STORAGE_RECEIVERS.includes(receiver);

        if (isSession || isLocal) {
          record(
            node,
            `${receiver}.${callee.name.text}`,
            isSession,
            node.arguments[0],
          );
        }
      }

      const name: string = calleeName(callee);

      for (const helper of NAMING_HELPERS) {
        if (helper.kind === "call" && helper.name === name) {
          record(
            node,
            name,
            false,
            helperNameExpression(helper, node.arguments),
          );
        }
      }
    }

    if (ts.isNewExpression(node)) {
      const name: string = calleeName(node.expression);

      for (const helper of NAMING_HELPERS) {
        if (helper.kind === "construct" && helper.name === name) {
          record(
            node,
            `new ${name}`,
            false,
            helperNameExpression(helper, node.arguments),
          );
        }
      }
    }

    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      for (const helper of NAMING_HELPERS) {
        if (helper.kind === "jsx" && helper.name === node.name.text) {
          const initializer: ts.JsxAttributeValue | undefined =
            node.initializer;
          const expression: ts.Expression | undefined = !initializer
            ? undefined
            : ts.isStringLiteral(initializer)
              ? initializer
              : ts.isJsxExpression(initializer)
                ? initializer.expression
                : undefined;

          record(node, `${helper.name}=`, false, expression);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return uses;
}

function isExplained(use: StorageUse): boolean {
  if (use.isSessionStorage || use.name.kind !== "fixed") {
    return true;
  }

  const value: string = use.name.value || "";

  return (
    Object.prototype.hasOwnProperty.call(KEPT_FOR_THE_PERSON, value) ||
    value.endsWith(AUTO_REFRESH_PICK_ENDING)
  );
}

function describeUse(use: StorageUse): string {
  return `${use.file}:${use.line} ${use.via}(${use.text}) = ${JSON.stringify(
    use.name.value,
  )}`;
}

const SCANNED_FILES: Array<string> = SCANNED_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(path.join(REPOSITORY_ROOT, root));
  },
).filter((file: string): boolean => {
  return !STORAGE_WRAPPERS.includes(toRepositoryPath(file));
});

const ALL_USES: Array<StorageUse> = SCANNED_FILES.flatMap(
  (file: string): Array<StorageUse> => {
    return findStorageUses(file, fs.readFileSync(file, "utf8"));
  },
);

const FIXED_LOCAL_NAMES: Array<string> = ALL_USES.filter(
  (use: StorageUse): boolean => {
    return !use.isSessionStorage && use.name.kind === "fixed";
  },
).map((use: StorageUse): string => {
  return use.name.value || "";
});

describe("BrowserStorageKeptPerProjectGuard: the detector", () => {
  const EXAMPLE: string = path.join(
    REPOSITORY_ROOT,
    "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
  );

  type FindFunction = (lines: Array<string>) => Array<StorageUse>;

  const find: FindFunction = (lines: Array<string>): Array<StorageUse> => {
    return findStorageUses(EXAMPLE, lines.join("\n"));
  };

  test("flags a name written out, in local storage, whatever the receiver", () => {
    const uses: Array<StorageUse> = find([
      'LocalStorage.setItem("selected_filter", value);',
      'window.localStorage.getItem("selected_filter");',
      "localStorage.removeItem(`selected_filter`);",
      'window.localStorage?.getItem("selected_filter");',
      'storage.setItem("selected_filter", value);',
    ]);

    expect(
      uses.map((use: StorageUse) => {
        return [use.name.kind, use.name.value, isExplained(use)];
      }),
    ).toEqual([
      ["fixed", "selected_filter", false],
      ["fixed", "selected_filter", false],
      ["fixed", "selected_filter", false],
      ["fixed", "selected_filter", false],
      ["fixed", "selected_filter", false],
    ]);
  });

  test("reads a constant the name is held in - in the module, built from others, or inside a function", () => {
    const uses: Array<StorageUse> = find([
      'const PREFIX: string = "oneuptime.";',
      'const FILTER_KEY: string = PREFIX + "filter";',
      "const DRAFT_KEY: string = `${PREFIX}draft`;",
      "LocalStorage.getItem(FILTER_KEY);",
      "LocalStorage.getItem(DRAFT_KEY);",
      "function remember(value: string): void {",
      '  const key: string = "last-page";',
      "  LocalStorage.setItem(key, value);",
      "}",
    ]);

    expect(
      uses.map((use: StorageUse) => {
        return use.name.value;
      }),
    ).toEqual(["oneuptime.filter", "oneuptime.draft", "last-page"]);
  });

  test("follows a constant imported from another module", () => {
    const uses: Array<StorageUse> = find([
      'import { CURRENT_PROJECT_ID_STORAGE_KEY, LAST_ACCESSED_PROJECT_ID_STORAGE_KEY } from "Common/UI/Utils/Project";',
      "LocalStorage.getItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY);",
      "SessionStorage.getItem(CURRENT_PROJECT_ID_STORAGE_KEY);",
    ]);

    expect(
      uses.map((use: StorageUse) => {
        return [use.name.value, use.isSessionStorage, isExplained(use)];
      }),
    ).toEqual([
      ["last_accessed_project_id", false, true],
      ["current_project_id", true, true],
    ]);
  });

  test("lets a name computed with the project's id, a parameter and a property through", () => {
    const uses: Array<StorageUse> = find([
      "LocalStorage.setItem(`project_${projectId}`, value);",
      'LocalStorage.setItem(projectId.toString() + "_filter", value);',
      "LocalStorage.getItem(getFilterKey(projectId));",
      "function read(key: string): string | null {",
      "  return window.localStorage.getItem(key);",
      "}",
      "window.localStorage.getItem(this.storageKey);",
      "for (const key of keys) {",
      "  window.localStorage.removeItem(key);",
      "}",
    ]);

    expect(
      uses.map((use: StorageUse) => {
        return [use.name.kind, isExplained(use)];
      }),
    ).toEqual([
      ["computed", true],
      ["computed", true],
      ["computed", true],
      ["handed-in", true],
      ["handed-in", true],
      ["computed", true],
    ]);
  });

  test("a name written out in session storage is the tab's own", () => {
    const uses: Array<StorageUse> = find([
      'window.sessionStorage.setItem("selected_filter", value);',
      'SessionStorage.getItem("selected_filter");',
    ]);

    expect(
      uses.map((use: StorageUse) => {
        return [use.isSessionStorage, isExplained(use)];
      }),
    ).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  test("follows the helpers that keep a choice under a name their caller gives", () => {
    const uses: Array<StorageUse> = find([
      'RememberedChoice.remember("selected_filter", value);',
      'RememberedChoice.read(getDashboardViewerPickKey(dashboardId, "time-range"));',
      'const view: RememberedView<string> = new RememberedView<string>({ storageKey: "selected_view", values: [], defaultValue: "a" });',
      'useAutoRefresh({ storageKey: "monitors-overview-auto-refresh-interval", onRefresh });',
      'writeRecentCommandId("palette-recents", commandId);',
      'const palette = <CommandPalette recentStorageKey="palette-recents" />;',
    ]);

    expect(
      uses.map((use: StorageUse) => {
        return [use.via, use.name.value, isExplained(use)];
      }),
    ).toEqual([
      ["RememberedChoice.remember", "selected_filter", false],
      ["RememberedChoice.read", undefined, true],
      ["new RememberedView", "selected_view", false],
      ["useAutoRefresh", "monitors-overview-auto-refresh-interval", true],
      ["writeRecentCommandId", "palette-recents", false],
      ["recentStorageKey=", "palette-recents", false],
    ]);
  });

  test("catches the names every project's permission snapshot shared", () => {
    const uses: Array<StorageUse> = find([
      'LocalStorage.getItem("project_permissions");',
      'LocalStorage.setItem("project-permissions-hash", hash);',
    ]);

    expect(uses.filter(isExplained)).toEqual([]);
    expect(
      uses.map((use: StorageUse) => {
        return use.name.value;
      }),
    ).toEqual(SHARED_PERMISSION_NAMES);
  });
});

describe("BrowserStorageKeptPerProjectGuard: the Dashboard, the Admin Dashboard and the sign-in pages", () => {
  test("reads every browser module of the apps and of Common/UI", () => {
    const files: Array<string> = SCANNED_FILES.map(toRepositoryPath);

    expect(files).toContain("packages/Common/UI/Utils/Permission.ts");
    expect(files).toContain("packages/Common/UI/Utils/Project.ts");
    expect(files).toContain(
      "packages/App/FeatureSet/Dashboard/src/Utils/i18n.ts",
    );
    expect(files).toContain(
      "packages/App/FeatureSet/AdminDashboard/src/Utils/i18n.ts",
    );
    expect(files).toContain(
      "packages/App/FeatureSet/Accounts/src/Utils/i18n.ts",
    );
    expect(files.length).toBeGreaterThan(1000);

    // A guard that found nothing would pass on anything.
    expect(ALL_USES.length).toBeGreaterThanOrEqual(150);
    expect(FIXED_LOCAL_NAMES.length).toBeGreaterThanOrEqual(40);
  });

  test("every name kept in local storage is computed per use, handed in, or kept for the person with a reason", () => {
    expect(
      ALL_USES.filter((use: StorageUse): boolean => {
        return !isExplained(use);
      }).map(describeUse),
    ).toEqual([]);
  });

  test("the names every project's permission snapshot shared are never used", () => {
    expect(
      FIXED_LOCAL_NAMES.filter((name: string): boolean => {
        return SHARED_PERMISSION_NAMES.includes(name);
      }),
    ).toEqual([]);

    for (const name of SHARED_PERMISSION_NAMES) {
      expect(Object.keys(KEPT_FOR_THE_PERSON)).not.toContain(name);
    }
  });

  test("every name on the list is still used, so the list cannot outlive its reasons", () => {
    expect(
      Object.keys(KEPT_FOR_THE_PERSON).filter((name: string): boolean => {
        return !FIXED_LOCAL_NAMES.includes(name);
      }),
    ).toEqual([]);

    expect(
      FIXED_LOCAL_NAMES.some((name: string): boolean => {
        return name.endsWith(AUTO_REFRESH_PICK_ENDING);
      }),
    ).toBe(true);
  });

  test("a project's permission snapshot is kept under names built with the project's id", () => {
    const file: string = path.join(
      REPOSITORY_ROOT,
      "packages/Common/UI/Utils/Permission.ts",
    );
    const sourceFile: ts.SourceFile = parseFile(
      file,
      fs.readFileSync(file, "utf8"),
    )!;

    const builders: Map<string, string> = new Map();

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        builders.set(node.name.text, node.body.getText(sourceFile));
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    for (const name of [
      "getProjectPermissionsStorageKey",
      "getProjectPermissionsHashStorageKey",
    ]) {
      const body: string = builders.get(name) || "";

      expect([
        name,
        body.includes("toPermissionsProjectId(projectId)"),
      ]).toEqual([name, true]);
      expect([name, body.includes("${id}")]).toEqual([name, true]);
    }

    // The two names, and nothing else, every project snapshot is kept under.
    const keptUnderBuilders: Array<StorageUse> = ALL_USES.filter(
      (use: StorageUse): boolean => {
        return (
          use.file === "packages/Common/UI/Utils/Permission.ts" &&
          use.name.kind === "fixed"
        );
      },
    );

    expect(
      [
        ...new Set(
          keptUnderBuilders.map((use: StorageUse) => {
            return use.name.value;
          }),
        ),
      ].sort(),
    ).toEqual(["global-permissions-hash", "global_permissions"]);
  });
});
