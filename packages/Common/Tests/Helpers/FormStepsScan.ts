import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The detector behind the "long forms walk steps" guard
 * (Tests/UI/Components/Forms/LongFormStepsGuard.test.ts).
 *
 * The rule, in the maintainer's words: "have formsteps ... for any long forms
 * in the project (anything > 3 fields)". A form of more than three fields the
 * user can see is split into steps (FormStep, a field's stepId), or carries
 * an entry in the guard's allowlist that says why not.
 *
 * What it reads. Every JSX use of the form hosts - ModelTable (and the
 * RuleTable / LabelRuleTable wrappers around it), CardModelDetail,
 * ModelFormModal, BasicFormModal, ModelForm, BasicForm and DuplicateModel -
 * and from each, the fields and the steps it is handed. Fields are followed
 * the way they are written in this codebase: an array literal; a constant or
 * a variable, in the same file or imported from another (relative and
 * "Common/" imports); a function's returned array, including useMemo and an
 * array the function pushes into or reassigns (`fields = fields.concat([
 * ...])`); spreads, conditional spreads and the
 * larger branch of a ternary; .map / .filter / .concat / .slice of a list.
 * Whatever cannot be followed (props handed in from a caller, a list built in
 * a loop, data from the server) makes the form "uncountable", and the guard
 * asks for those to be listed with a reason too.
 *
 * What counts as a field the user can see. Every element of the list, less
 * the ones whose showIf is a constant `() => false` (registrations that only
 * make ModelForm select a column). A field shown under a condition counts:
 * the form can be that long. On a ModelTable the Create and the Edit forms
 * are told apart by doNotShowWhenCreating / doNotShowWhenEditing, and the
 * longer of the two is what is judged.
 *
 * What counts as steps. A non-empty steps list (formSteps, steps,
 * formProps.steps), or a summary turned on (BasicForm then walks a default
 * step and a Summary step).
 *
 * It also checks what makes a stepped form silently lose a field. BasicForm
 * shows a field only on the step its stepId names, so in a stepped form:
 *   - a field written inline with no stepId is never shown, anywhere;
 *   - a field whose stepId names no declared step is never shown either;
 *   - a declared step no field is on is an empty page in the wizard - and,
 *     on a ModelTable, so is a step whose every field the Edit form leaves
 *     out.
 */

export const LONG_FORM_FIELD_LIMIT: number = 3;

export type FormHostName =
  | "ModelTable"
  | "RuleTable"
  | "LabelRuleTable"
  | "CardModelDetail"
  | "ModelFormModal"
  | "BasicFormModal"
  | "ModelForm"
  | "BasicForm"
  | "DuplicateModel";

interface HostSpec {
  // Where the host takes its fields: a JSX attribute, or a key of formProps.
  fields: string;
  steps?: string | undefined;
  summary?: string | undefined;
}

export const FORM_HOSTS: Record<FormHostName, HostSpec> = {
  ModelTable: {
    fields: "formFields",
    steps: "formSteps",
    summary: "formSummary",
  },
  RuleTable: { fields: "formFields", steps: "formSteps" },
  LabelRuleTable: { fields: "formFields", steps: "formSteps" },
  CardModelDetail: { fields: "formFields", steps: "formSteps" },
  ModelFormModal: {
    fields: "formProps.fields",
    steps: "formProps.steps",
    summary: "formProps.summary",
  },
  BasicFormModal: {
    fields: "formProps.fields",
    steps: "formProps.steps",
    summary: "formProps.summary",
  },
  ModelForm: { fields: "fields", steps: "steps", summary: "summary" },
  BasicForm: { fields: "fields", steps: "steps", summary: "summary" },
  // Its own BasicFormModal receives these as props; the callers are counted.
  DuplicateModel: { fields: "fieldsToChange" },
};

export interface FormFieldFacts {
  // The column or override key the field writes, when it is written down.
  key: string;
  title: string;
  /*
   * The step the field is on: a string when written as one, null when it is
   * computed (a variable, a spread), undefined when the field has none.
   */
  stepId: string | null | undefined;
  // Written as an object literal in the scanned code itself, with no spread.
  isPlainLiteral: boolean;
  isNeverShown: boolean;
  isConditional: boolean;
  // doNotShowWhenEditing - the Create form only.
  isCreateOnly: boolean;
  // doNotShowWhenCreating - the Edit form only.
  isEditOnly: boolean;
  file: string;
  line: number;
}

export interface FormStepFacts {
  // The step's id when written as a string.
  id: string | null;
  title: string;
  isConditional: boolean;
}

export interface FormFacts {
  file: string;
  line: number;
  host: FormHostName;
  // How an allowlist names the form: see getFormLabel.
  label: string;
  fields: Array<FormFieldFacts>;
  // Why some fields could not be followed; empty when every one was.
  uncountableReasons: Array<string>;
  // The fields are a prop handed in by the caller (a wrapper component).
  isPassThrough: boolean;
  hasSteps: boolean;
  // The steps, when they could be followed; null when they could not.
  steps: Array<FormStepFacts> | null;
  // Turned on by summary: BasicForm then puts every field on its own step.
  hasSummaryOnly: boolean;
  // Whether a ModelTable offers its Edit form (isEditable written as true).
  hasEditForm: boolean;
  // The fields the user can see, on the longer of the forms the host draws.
  visibleFieldCount: number;
}

export type FormStepProblemKind =
  | "field-without-step"
  | "field-on-undeclared-step"
  | "empty-step"
  | "empty-step-on-edit";

export interface FormStepProblem {
  kind: FormStepProblemKind;
  form: FormFacts;
  message: string;
}

export interface SourceFileSystem {
  readFile: (filePath: string) => string | null;
}

export const REAL_FILE_SYSTEM: SourceFileSystem = {
  readFile: (filePath: string): string | null => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  },
};

interface ParsedFile {
  file: string;
  sourceFile: ts.SourceFile;
  // Every named declaration, first one wins: `const x = ...`, `function x`.
  declarations: Map<string, ts.Node>;
  imports: Map<string, { file: string; exported: string }>;
  // Arguments of `<name>.push(...)` anywhere in the file.
  pushes: Map<string, Array<{ argument: ts.Expression; inLoop: boolean }>>;
  // Values of `<name> = ...` anywhere in the file.
  assignments: Map<string, Array<{ value: ts.Expression; inLoop: boolean }>>;
}

interface Resolution {
  items: Array<{ parsed: ParsedFile; node: ts.ObjectLiteralExpression }>;
  // Plain literals written in the file the form itself is in.
  plain: Set<ts.ObjectLiteralExpression>;
  reasons: Array<string>;
  isPassThrough: boolean;
}

const MAX_DEPTH: number = 12;

const LIST_METHODS: ReadonlySet<string> = new Set<string>([
  "map",
  "filter",
  "concat",
  "slice",
]);

const LOOP_KINDS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
]);

function unwrap(expression: ts.Node): ts.Node {
  let node: ts.Node = expression;

  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }

  return node;
}

function isInsideLoop(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (LOOP_KINDS.has(current.kind)) {
      return true;
    }

    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ["forEach", "map"].includes(current.expression.name.text)
    ) {
      return true;
    }

    if (ts.isSourceFile(current)) {
      return false;
    }

    current = current.parent;
  }

  return false;
}

export class FormStepsScanner {
  private readonly parsedFiles: Map<string, ParsedFile | null> = new Map<
    string,
    ParsedFile | null
  >();

  public constructor(
    private readonly repositoryRoot: string,
    private readonly fileSystem: SourceFileSystem = REAL_FILE_SYSTEM,
  ) {}

  public scanFile(filePath: string): Array<FormFacts> {
    const parsed: ParsedFile | null = this.parse(filePath);

    if (!parsed) {
      return [];
    }

    const forms: Array<FormFacts> = [];
    const hostCounts: Map<string, number> = new Map<string, number>();

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag: string = node.tagName.getText(parsed.sourceFile);

        if (Object.prototype.hasOwnProperty.call(FORM_HOSTS, tag)) {
          const index: number = hostCounts.get(tag) || 0;
          hostCounts.set(tag, index + 1);

          const form: FormFacts | null = this.readForm(
            parsed,
            node,
            tag as FormHostName,
            index,
          );

          if (form) {
            forms.push(form);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(parsed.sourceFile);

    return forms;
  }

  private parse(filePath: string): ParsedFile | null {
    if (this.parsedFiles.has(filePath)) {
      return this.parsedFiles.get(filePath) || null;
    }

    const text: string | null = this.fileSystem.readFile(filePath);

    if (text === null) {
      this.parsedFiles.set(filePath, null);
      return null;
    }

    const sourceFile: ts.SourceFile = ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const parsed: ParsedFile = {
      file: filePath,
      sourceFile,
      declarations: new Map<string, ts.Node>(),
      imports: new Map<string, { file: string; exported: string }>(),
      pushes: new Map<
        string,
        Array<{ argument: ts.Expression; inLoop: boolean }>
      >(),
      assignments: new Map<
        string,
        Array<{ value: ts.Expression; inLoop: boolean }>
      >(),
    };

    // Registered before walking, so a file that imports itself cannot loop.
    this.parsedFiles.set(filePath, parsed);

    const collect: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        !parsed.declarations.has(node.name.text)
      ) {
        parsed.declarations.set(node.name.text, node.initializer);
      }

      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        !parsed.declarations.has(node.name.text)
      ) {
        parsed.declarations.set(node.name.text, node);
      }

      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "push" &&
        ts.isIdentifier(node.expression.expression)
      ) {
        const name: string = node.expression.expression.text;
        const list: Array<{ argument: ts.Expression; inLoop: boolean }> =
          parsed.pushes.get(name) || [];

        for (const argument of node.arguments) {
          list.push({ argument, inLoop: isInsideLoop(node) });
        }

        parsed.pushes.set(name, list);
      }

      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        const name: string = node.left.text;
        const list: Array<{ value: ts.Expression; inLoop: boolean }> =
          parsed.assignments.get(name) || [];

        list.push({ value: node.right, inLoop: isInsideLoop(node) });
        parsed.assignments.set(name, list);
      }

      if (
        ts.isImportDeclaration(node) &&
        node.importClause &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const target: string | null = this.resolveModule(
          filePath,
          node.moduleSpecifier.text,
        );

        if (target) {
          const clause: ts.ImportClause = node.importClause;

          if (clause.name) {
            parsed.imports.set(clause.name.text, {
              file: target,
              exported: "default",
            });
          }

          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
              parsed.imports.set(element.name.text, {
                file: target,
                exported: (element.propertyName || element.name).text,
              });
            }
          }
        }
      }

      ts.forEachChild(node, collect);
    };

    collect(sourceFile);

    return parsed;
  }

  private resolveModule(fromFile: string, specifier: string): string | null {
    let base: string;

    if (specifier.startsWith(".")) {
      base = path.resolve(path.dirname(fromFile), specifier);
    } else if (specifier.startsWith("Common/")) {
      base = path.join(
        this.repositoryRoot,
        "packages",
        "Common",
        specifier.slice("Common/".length),
      );
    } else {
      return null;
    }

    for (const candidate of [
      base + ".ts",
      base + ".tsx",
      path.join(base, "Index.ts"),
      path.join(base, "Index.tsx"),
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      if (this.fileSystem.readFile(candidate) !== null) {
        return candidate;
      }
    }

    return null;
  }

  private lookup(
    parsed: ParsedFile,
    name: string,
    depth: number,
  ): { parsed: ParsedFile; node: ts.Node } | null {
    if (depth > MAX_DEPTH) {
      return null;
    }

    const declaration: ts.Node | undefined = parsed.declarations.get(name);

    if (declaration) {
      return { parsed, node: declaration };
    }

    const imported: { file: string; exported: string } | undefined =
      parsed.imports.get(name);

    if (!imported) {
      return null;
    }

    const target: ParsedFile | null = this.parse(imported.file);

    if (!target) {
      return null;
    }

    if (imported.exported !== "default") {
      return this.lookup(target, imported.exported, depth + 1);
    }

    for (const statement of target.sourceFile.statements) {
      if (ts.isExportAssignment(statement)) {
        const expression: ts.Node = unwrap(statement.expression);

        if (ts.isIdentifier(expression)) {
          return this.lookup(target, expression.text, depth + 1);
        }

        return { parsed: target, node: expression };
      }

      if (
        ts.isFunctionDeclaration(statement) &&
        statement.modifiers?.some((modifier: ts.ModifierLike): boolean => {
          return modifier.kind === ts.SyntaxKind.DefaultKeyword;
        })
      ) {
        return { parsed: target, node: statement };
      }
    }

    return null;
  }

  // The expressions a function body returns, nested functions excepted.
  private returnedExpressions(
    fn: ts.FunctionLikeDeclarationBase,
  ): Array<ts.Expression> {
    if (!fn.body) {
      return [];
    }

    if (!ts.isBlock(fn.body)) {
      return [fn.body];
    }

    const found: Array<ts.Expression> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isReturnStatement(node) && node.expression) {
        found.push(node.expression);
        return;
      }

      if (ts.isFunctionLike(node)) {
        return;
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(fn.body, visit);

    return found;
  }

  private emptyResolution(): Resolution {
    return {
      items: [],
      plain: new Set<ts.ObjectLiteralExpression>(),
      reasons: [],
      isPassThrough: false,
    };
  }

  private merge(target: Resolution, source: Resolution): void {
    target.items.push(...source.items);
    source.plain.forEach((node: ts.ObjectLiteralExpression) => {
      target.plain.add(node);
    });
    target.reasons.push(...source.reasons);
    target.isPassThrough = target.isPassThrough || source.isPassThrough;
  }

  private larger(first: Resolution, second: Resolution): Resolution {
    return first.items.length >= second.items.length ? first : second;
  }

  // A list of fields (or steps): an array, or anything that evaluates to one.
  public resolveList(
    parsed: ParsedFile,
    node: ts.Node,
    depth: number,
    isHostFile: boolean,
  ): Resolution {
    const expression: ts.Node = unwrap(node);
    const result: Resolution = this.emptyResolution();
    const text: string = expression.getText(parsed.sourceFile).slice(0, 60);

    if (depth > MAX_DEPTH) {
      result.reasons.push(`too deep to follow: ${text}`);
      return result;
    }

    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        if (ts.isSpreadElement(element)) {
          this.merge(
            result,
            this.resolveList(parsed, element.expression, depth + 1, isHostFile),
          );
        } else {
          this.merge(
            result,
            this.resolveItem(parsed, element, depth + 1, isHostFile),
          );
        }
      }

      return result;
    }

    if (ts.isConditionalExpression(expression)) {
      return this.larger(
        this.resolveList(parsed, expression.whenTrue, depth + 1, isHostFile),
        this.resolveList(parsed, expression.whenFalse, depth + 1, isHostFile),
      );
    }

    if (ts.isBinaryExpression(expression)) {
      const operator: ts.SyntaxKind = expression.operatorToken.kind;

      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        return this.resolveList(
          parsed,
          expression.right,
          depth + 1,
          isHostFile,
        );
      }

      if (
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return this.larger(
          this.resolveList(parsed, expression.left, depth + 1, isHostFile),
          this.resolveList(parsed, expression.right, depth + 1, isHostFile),
        );
      }
    }

    if (
      expression.kind === ts.SyntaxKind.UndefinedKeyword ||
      expression.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(expression) && expression.text === "undefined")
    ) {
      return result;
    }

    if (ts.isIdentifier(expression)) {
      const found: { parsed: ParsedFile; node: ts.Node } | null = this.lookup(
        parsed,
        expression.text,
        depth + 1,
      );

      if (!found) {
        result.reasons.push(`cannot follow ${text}`);
        return result;
      }

      this.merge(
        result,
        this.resolveList(
          found.parsed,
          found.node,
          depth + 1,
          isHostFile && found.parsed === parsed,
        ),
      );

      // What is pushed into it later, where it was declared.
      for (const pushed of found.parsed.pushes.get(expression.text) || []) {
        if (pushed.inLoop) {
          result.reasons.push(
            `${expression.text} is filled in a loop, so its length is not written down`,
          );
          continue;
        }

        this.merge(
          result,
          this.resolveItem(
            found.parsed,
            pushed.argument,
            depth + 1,
            isHostFile && found.parsed === parsed,
          ),
        );
      }

      return this.applyAssignments({
        result,
        parsed: found.parsed,
        name: expression.text,
        assignments: found.parsed.assignments.get(expression.text) || [],
        depth,
        isHostFile: isHostFile && found.parsed === parsed,
      });
    }

    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "props"
    ) {
      result.isPassThrough = true;
      result.reasons.push(`handed in by the caller: ${text}`);
      return result;
    }

    if (ts.isCallExpression(expression)) {
      return this.resolveCall(parsed, expression, depth, isHostFile);
    }

    if (
      ts.isFunctionDeclaration(expression) ||
      ts.isArrowFunction(expression) ||
      ts.isFunctionExpression(expression)
    ) {
      // A declaration found by name: its value is what it returns.
      return result;
    }

    result.reasons.push(`cannot follow ${text}`);
    return result;
  }

  private resolveCall(
    parsed: ParsedFile,
    call: ts.CallExpression,
    depth: number,
    isHostFile: boolean,
  ): Resolution {
    const result: Resolution = this.emptyResolution();
    const callee: ts.Node = unwrap(call.expression);
    const text: string = call.getText(parsed.sourceFile).slice(0, 60);

    if (
      ts.isPropertyAccessExpression(callee) &&
      LIST_METHODS.has(callee.name.text)
    ) {
      const base: Resolution = this.resolveList(
        parsed,
        callee.expression,
        depth + 1,
        isHostFile,
      );

      if (callee.name.text === "concat") {
        for (const argument of call.arguments) {
          this.merge(
            base,
            this.resolveList(parsed, argument, depth + 1, isHostFile),
          );
        }
      }

      // A mapped field is rebuilt by the callback: not a literal any more.
      if (callee.name.text === "map") {
        base.plain.clear();
      }

      return base;
    }

    let fn: ts.Node | null = null;
    let fnFile: ParsedFile = parsed;

    if (
      ts.isIdentifier(callee) &&
      callee.text === "useMemo" &&
      call.arguments[0]
    ) {
      fn = unwrap(call.arguments[0]);
    } else if (ts.isIdentifier(callee)) {
      const found: { parsed: ParsedFile; node: ts.Node } | null = this.lookup(
        parsed,
        callee.text,
        depth + 1,
      );

      if (found) {
        fn = unwrap(found.node);
        fnFile = found.parsed;
      }
    }

    if (
      fn &&
      (ts.isFunctionDeclaration(fn) ||
        ts.isArrowFunction(fn) ||
        ts.isFunctionExpression(fn))
    ) {
      const returned: Array<ts.Expression> = this.returnedExpressions(fn);

      if (returned.length === 0) {
        result.reasons.push(`${text} returns nothing that can be followed`);
        return result;
      }

      // The largest list any return gives.
      let best: Resolution | null = null;

      for (const expression of returned) {
        const candidate: Resolution = this.resolveReturned(
          fnFile,
          fn,
          expression,
          depth + 1,
          isHostFile && fnFile === parsed,
        );

        best = best ? this.larger(best, candidate) : candidate;
      }

      return best || result;
    }

    result.reasons.push(`cannot follow ${text}`);
    return result;
  }

  /*
   * A function's returned list, with what the function pushes into it
   * before returning it: `const fields = [...]; fields.push(...); return
   * fields;`.
   */
  private resolveReturned(
    parsed: ParsedFile,
    fn: ts.FunctionLikeDeclarationBase,
    returned: ts.Expression,
    depth: number,
    isHostFile: boolean,
  ): Resolution {
    const expression: ts.Node = unwrap(returned);

    if (!ts.isIdentifier(expression) || !fn.body) {
      return this.resolveList(parsed, expression, depth, isHostFile);
    }

    let initializer: ts.Expression | null = null;
    const pushes: Array<{ argument: ts.Expression; inLoop: boolean }> = [];
    const assignments: Array<{ value: ts.Expression; inLoop: boolean }> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === expression.text &&
        node.initializer &&
        !initializer
      ) {
        initializer = node.initializer;
      }

      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "push" &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === expression.text
      ) {
        for (const argument of node.arguments) {
          pushes.push({ argument, inLoop: isInsideLoop(node) });
        }
      }

      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        node.left.text === expression.text
      ) {
        assignments.push({ value: node.right, inLoop: isInsideLoop(node) });
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(fn.body, visit);

    if (!initializer) {
      return this.resolveList(parsed, expression, depth, isHostFile);
    }

    const result: Resolution = this.resolveList(
      parsed,
      initializer,
      depth + 1,
      isHostFile,
    );

    for (const pushed of pushes) {
      if (pushed.inLoop) {
        result.reasons.push(
          `${expression.text} is filled in a loop, so its length is not written down`,
        );
        continue;
      }

      this.merge(
        result,
        this.resolveItem(parsed, pushed.argument, depth + 1, isHostFile),
      );
    }

    return this.applyAssignments({
      result,
      parsed,
      name: expression.text,
      assignments,
      depth,
      isHostFile,
    });
  }

  /*
   * A list variable that is assigned again: `fields = fields.concat([...])`
   * and `fields = [...fields, ...]` add what they append; any other new
   * value may replace the list, so the longer of the two is kept.
   */
  private applyAssignments(data: {
    result: Resolution;
    parsed: ParsedFile;
    name: string;
    assignments: Array<{ value: ts.Expression; inLoop: boolean }>;
    depth: number;
    isHostFile: boolean;
  }): Resolution {
    let result: Resolution = data.result;

    for (const assignment of data.assignments) {
      if (assignment.inLoop) {
        result.reasons.push(
          `${data.name} is filled in a loop, so its length is not written down`,
        );
        continue;
      }

      const value: ts.Node = unwrap(assignment.value);

      if (
        ts.isCallExpression(value) &&
        ts.isPropertyAccessExpression(value.expression) &&
        value.expression.name.text === "concat" &&
        ts.isIdentifier(unwrap(value.expression.expression)) &&
        (unwrap(value.expression.expression) as ts.Identifier).text ===
          data.name
      ) {
        for (const argument of value.arguments) {
          this.merge(
            result,
            this.resolveList(
              data.parsed,
              argument,
              data.depth + 1,
              data.isHostFile,
            ),
          );
        }

        continue;
      }

      if (ts.isArrayLiteralExpression(value)) {
        const additions: ts.NodeArray<ts.Expression> = value.elements;
        const selfSpread: boolean = additions.some(
          (element: ts.Expression): boolean => {
            return (
              ts.isSpreadElement(element) &&
              ts.isIdentifier(unwrap(element.expression)) &&
              (unwrap(element.expression) as ts.Identifier).text === data.name
            );
          },
        );

        if (selfSpread) {
          for (const element of additions) {
            if (
              ts.isSpreadElement(element) &&
              ts.isIdentifier(unwrap(element.expression)) &&
              (unwrap(element.expression) as ts.Identifier).text === data.name
            ) {
              continue;
            }

            this.merge(
              result,
              ts.isSpreadElement(element)
                ? this.resolveList(
                    data.parsed,
                    element.expression,
                    data.depth + 1,
                    data.isHostFile,
                  )
                : this.resolveItem(
                    data.parsed,
                    element,
                    data.depth + 1,
                    data.isHostFile,
                  ),
            );
          }

          continue;
        }
      }

      result = this.larger(
        result,
        this.resolveList(data.parsed, value, data.depth + 1, data.isHostFile),
      );
    }

    return result;
  }

  // One element of a list: a field object, or something that yields fields.
  private resolveItem(
    parsed: ParsedFile,
    node: ts.Node,
    depth: number,
    isHostFile: boolean,
  ): Resolution {
    const element: ts.Node = unwrap(node);
    const result: Resolution = this.emptyResolution();
    const text: string = element.getText(parsed.sourceFile).slice(0, 60);

    if (depth > MAX_DEPTH) {
      result.reasons.push(`too deep to follow: ${text}`);
      return result;
    }

    if (ts.isObjectLiteralExpression(element)) {
      result.items.push({ parsed, node: element });

      const hasSpread: boolean = element.properties.some(
        (property: ts.ObjectLiteralElementLike): boolean => {
          return ts.isSpreadAssignment(property);
        },
      );

      if (isHostFile && !hasSpread) {
        result.plain.add(element);
      }

      return result;
    }

    if (ts.isSpreadElement(element)) {
      return this.resolveList(
        parsed,
        element.expression,
        depth + 1,
        isHostFile,
      );
    }

    if (ts.isConditionalExpression(element)) {
      return this.larger(
        this.resolveItem(parsed, element.whenTrue, depth + 1, isHostFile),
        this.resolveItem(parsed, element.whenFalse, depth + 1, isHostFile),
      );
    }

    if (
      element.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(element) && element.text === "undefined")
    ) {
      return result;
    }

    if (ts.isIdentifier(element)) {
      const found: { parsed: ParsedFile; node: ts.Node } | null = this.lookup(
        parsed,
        element.text,
        depth + 1,
      );

      if (found) {
        return this.resolveItem(
          found.parsed,
          found.node,
          depth + 1,
          isHostFile && found.parsed === parsed,
        );
      }

      result.reasons.push(`cannot follow ${text}`);
      return result;
    }

    if (ts.isCallExpression(element)) {
      const callee: ts.Node = unwrap(element.expression);

      if (ts.isIdentifier(callee)) {
        const found: { parsed: ParsedFile; node: ts.Node } | null = this.lookup(
          parsed,
          callee.text,
          depth + 1,
        );
        const fn: ts.Node | null = found ? unwrap(found.node) : null;

        if (
          found &&
          fn &&
          (ts.isFunctionDeclaration(fn) ||
            ts.isArrowFunction(fn) ||
            ts.isFunctionExpression(fn))
        ) {
          const returned: Array<ts.Expression> = this.returnedExpressions(fn);
          const last: ts.Expression | undefined = returned[returned.length - 1];

          if (last) {
            // A helper's field: counted, but never a plain literal here.
            return this.resolveItem(found.parsed, last, depth + 1, false);
          }
        }
      }

      result.reasons.push(`cannot follow ${text}`);
      return result;
    }

    result.reasons.push(`cannot follow ${text}`);
    return result;
  }

  private readForm(
    parsed: ParsedFile,
    host: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    hostName: FormHostName,
    index: number,
  ): FormFacts | null {
    const spec: HostSpec = FORM_HOSTS[hostName];
    const attributes: Map<string, ts.JsxAttribute> = new Map<
      string,
      ts.JsxAttribute
    >();

    for (const attribute of host.attributes.properties) {
      if (ts.isJsxAttribute(attribute)) {
        attributes.set(attribute.name.getText(parsed.sourceFile), attribute);
      }
    }

    const fieldsExpression: ts.Expression | null = this.readHostValue(
      parsed,
      attributes,
      spec.fields,
    );

    if (!fieldsExpression) {
      return null;
    }

    const fieldResolution: Resolution = this.resolveList(
      parsed,
      fieldsExpression,
      0,
      true,
    );

    const fields: Array<FormFieldFacts> = fieldResolution.items.map(
      (item: { parsed: ParsedFile; node: ts.ObjectLiteralExpression }) => {
        return this.describeField(
          item.parsed,
          item.node,
          fieldResolution.plain.has(item.node),
        );
      },
    );

    const stepsExpression: ts.Expression | null = spec.steps
      ? this.readHostValue(parsed, attributes, spec.steps)
      : null;

    let steps: Array<FormStepFacts> | null = [];
    let hasSteps: boolean = false;

    if (stepsExpression) {
      const stepResolution: Resolution = this.resolveList(
        parsed,
        stepsExpression,
        0,
        false,
      );

      if (stepResolution.reasons.length > 0) {
        // Steps are there, but they cannot be listed.
        steps = null;
        hasSteps = true;
      } else {
        steps = stepResolution.items.map(
          (item: { parsed: ParsedFile; node: ts.ObjectLiteralExpression }) => {
            return this.describeStep(item.parsed, item.node);
          },
        );
        hasSteps = steps.length > 0;
      }
    }

    const summaryExpression: ts.Expression | null = spec.summary
      ? this.readHostValue(parsed, attributes, spec.summary)
      : null;
    const hasSummary: boolean = Boolean(
      summaryExpression && this.isSummaryEnabled(parsed, summaryExpression),
    );

    const hasEditForm: boolean =
      hostName !== "ModelTable" ||
      this.readBooleanAttribute(parsed, attributes, "isEditable") !== false;

    const shown: Array<FormFieldFacts> = fields.filter(
      (field: FormFieldFacts): boolean => {
        return !field.isNeverShown;
      },
    );

    let visibleFieldCount: number = shown.length;

    if (hostName === "ModelTable" || hostName === "RuleTable") {
      const onCreate: number = shown.filter(
        (field: FormFieldFacts): boolean => {
          return !field.isEditOnly;
        },
      ).length;
      const onEdit: number = hasEditForm
        ? shown.filter((field: FormFieldFacts): boolean => {
            return !field.isCreateOnly;
          }).length
        : 0;
      visibleFieldCount = Math.max(onCreate, onEdit);
    }

    return {
      file: toRepositoryPath(this.repositoryRoot, parsed.file),
      line:
        parsed.sourceFile.getLineAndCharacterOfPosition(
          host.getStart(parsed.sourceFile),
        ).line + 1,
      host: hostName,
      label: getFormLabel(parsed.sourceFile, attributes, hostName, index),
      fields,
      uncountableReasons: fieldResolution.isPassThrough
        ? []
        : fieldResolution.reasons,
      isPassThrough: fieldResolution.isPassThrough,
      hasSteps: hasSteps || hasSummary,
      steps: hasSteps ? steps : hasSummary ? null : [],
      hasSummaryOnly: hasSummary && !hasSteps,
      hasEditForm,
      visibleFieldCount,
    };
  }

  // A JSX attribute's expression, or a key of the object an attribute holds.
  private readHostValue(
    parsed: ParsedFile,
    attributes: Map<string, ts.JsxAttribute>,
    where: string,
  ): ts.Expression | null {
    const [attributeName, key] = where.split(".") as [string, string?];
    const attribute: ts.JsxAttribute | undefined =
      attributes.get(attributeName);

    if (
      !attribute ||
      !attribute.initializer ||
      !ts.isJsxExpression(attribute.initializer) ||
      !attribute.initializer.expression
    ) {
      return null;
    }

    if (!key) {
      return attribute.initializer.expression;
    }

    const value: ts.Node = unwrap(attribute.initializer.expression);
    const object: ts.Node = ts.isIdentifier(value)
      ? unwrap(this.lookup(parsed, value.text, 0)?.node || value)
      : value;

    if (!ts.isObjectLiteralExpression(object)) {
      return null;
    }

    for (const property of object.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        property.name.getText(parsed.sourceFile) === key
      ) {
        return property.initializer;
      }

      if (
        ts.isShorthandPropertyAssignment(property) &&
        property.name.text === key
      ) {
        return property.name;
      }
    }

    return null;
  }

  private readBooleanAttribute(
    parsed: ParsedFile,
    attributes: Map<string, ts.JsxAttribute>,
    name: string,
  ): boolean | null {
    const attribute: ts.JsxAttribute | undefined = attributes.get(name);

    if (!attribute) {
      return false;
    }

    if (!attribute.initializer) {
      return true;
    }

    if (
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression
    ) {
      const value: ts.Node = unwrap(attribute.initializer.expression);

      if (value.kind === ts.SyntaxKind.TrueKeyword) {
        return true;
      }

      if (value.kind === ts.SyntaxKind.FalseKeyword) {
        return false;
      }
    }

    // Decided at runtime: assume the Edit form can be offered.
    void parsed;
    return null;
  }

  private isSummaryEnabled(parsed: ParsedFile, expression: ts.Node): boolean {
    const value: ts.Node = unwrap(expression);

    if (!ts.isObjectLiteralExpression(value)) {
      return false;
    }

    return value.properties.some((property: ts.ObjectLiteralElementLike) => {
      return (
        ts.isPropertyAssignment(property) &&
        property.name.getText(parsed.sourceFile) === "enabled" &&
        unwrap(property.initializer).kind === ts.SyntaxKind.TrueKeyword
      );
    });
  }

  private describeField(
    parsed: ParsedFile,
    node: ts.ObjectLiteralExpression,
    isPlainLiteral: boolean,
  ): FormFieldFacts {
    const property: (
      name: string,
    ) => ts.ObjectLiteralElementLike | undefined = (
      name: string,
    ): ts.ObjectLiteralElementLike | undefined => {
      return node.properties.find(
        (candidate: ts.ObjectLiteralElementLike): boolean => {
          return (
            (ts.isPropertyAssignment(candidate) ||
              ts.isShorthandPropertyAssignment(candidate)) &&
            candidate.name.getText(parsed.sourceFile) === name
          );
        },
      );
    };

    const initializerOf: (name: string) => ts.Node | null = (
      name: string,
    ): ts.Node | null => {
      const found: ts.ObjectLiteralElementLike | undefined = property(name);

      if (!found) {
        return null;
      }

      return ts.isPropertyAssignment(found)
        ? unwrap(found.initializer)
        : (found as ts.ShorthandPropertyAssignment).name;
    };

    const isTrue: (name: string) => boolean = (name: string): boolean => {
      const value: ts.Node | null = initializerOf(name);

      if (!value) {
        return false;
      }

      return value.kind !== ts.SyntaxKind.FalseKeyword;
    };

    let key: string = "";
    const overrideKey: ts.Node | null = initializerOf("overrideFieldKey");
    const field: ts.Node | null =
      initializerOf("field") || initializerOf("overrideField");

    if (overrideKey && ts.isStringLiteralLike(overrideKey)) {
      key = overrideKey.text;
    } else if (overrideKey) {
      key = overrideKey.getText(parsed.sourceFile);
    } else if (
      field &&
      ts.isObjectLiteralExpression(field) &&
      field.properties[0]?.name
    ) {
      key = field.properties[0].name
        .getText(parsed.sourceFile)
        .replace(/^\[|\]$/g, "")
        .replace(/^["']|["']$/g, "");
    }

    const title: ts.Node | null = initializerOf("title");
    const stepId: ts.Node | null = initializerOf("stepId");
    const showIf: ts.Node | null = initializerOf("showIf");

    let stepIdValue: string | null | undefined = undefined;

    if (stepId) {
      stepIdValue = ts.isStringLiteralLike(stepId) ? stepId.text : null;
    } else if (
      node.properties.some((candidate: ts.ObjectLiteralElementLike) => {
        return ts.isSpreadAssignment(candidate);
      })
    ) {
      // A spread can carry one.
      stepIdValue = null;
    }

    return {
      key,
      title: title
        ? ts.isStringLiteralLike(title)
          ? title.text
          : title.getText(parsed.sourceFile)
        : "",
      stepId: stepIdValue,
      isPlainLiteral,
      isNeverShown: Boolean(showIf && isConstantFalseFunction(showIf)),
      isConditional: Boolean(showIf && !isConstantFalseFunction(showIf)),
      isCreateOnly: isTrue("doNotShowWhenEditing"),
      isEditOnly: isTrue("doNotShowWhenCreating"),
      file: toRepositoryPath(this.repositoryRoot, parsed.file),
      line:
        parsed.sourceFile.getLineAndCharacterOfPosition(
          node.getStart(parsed.sourceFile),
        ).line + 1,
    };
  }

  private describeStep(
    parsed: ParsedFile,
    node: ts.ObjectLiteralExpression,
  ): FormStepFacts {
    let id: string | null = null;
    let title: string = "";
    let isConditional: boolean = false;

    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        continue;
      }

      const name: string = property.name.getText(parsed.sourceFile);
      const value: ts.Node = unwrap(property.initializer);

      if (name === "id" && ts.isStringLiteralLike(value)) {
        id = value.text;
      }

      if (name === "title") {
        title = ts.isStringLiteralLike(value)
          ? value.text
          : value.getText(parsed.sourceFile);
      }

      if (name === "showIf") {
        isConditional = true;
      }
    }

    return { id, title, isConditional };
  }
}

function isConstantFalseFunction(node: ts.Node): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    return false;
  }

  const body: ts.Node = node.body;

  if (body.kind === ts.SyntaxKind.FalseKeyword) {
    return true;
  }

  if (ts.isBlock(body) && body.statements.length === 1) {
    const statement: ts.Statement = body.statements[0]!;

    return (
      ts.isReturnStatement(statement) &&
      Boolean(statement.expression) &&
      unwrap(statement.expression!).kind === ts.SyntaxKind.FalseKeyword
    );
  }

  return false;
}

/*
 * How the allowlist names a form: its host, then the first of its name,
 * title, card title or id written as a string - "CardModelDetail: Status
 * Page > Settings". A form with none of those, or sharing its name with
 * another of the same host in the file, is told apart by its position among
 * that host's uses in the file ("ModelForm #2").
 */
export function getFormLabel(
  sourceFile: ts.SourceFile,
  attributes: Map<string, ts.JsxAttribute>,
  hostName: FormHostName,
  index: number,
): string {
  const literal: (attribute: ts.JsxAttribute | undefined) => string | null = (
    attribute: ts.JsxAttribute | undefined,
  ): string | null => {
    if (!attribute || !attribute.initializer) {
      return null;
    }

    if (ts.isStringLiteral(attribute.initializer)) {
      return attribute.initializer.text;
    }

    if (
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression &&
      ts.isStringLiteralLike(unwrap(attribute.initializer.expression))
    ) {
      return (unwrap(attribute.initializer.expression) as ts.StringLiteralLike)
        .text;
    }

    return null;
  };

  const cardTitle: (attribute: ts.JsxAttribute | undefined) => string | null = (
    attribute: ts.JsxAttribute | undefined,
  ): string | null => {
    if (
      !attribute ||
      !attribute.initializer ||
      !ts.isJsxExpression(attribute.initializer) ||
      !attribute.initializer.expression
    ) {
      return null;
    }

    const value: ts.Node = unwrap(attribute.initializer.expression);

    if (!ts.isObjectLiteralExpression(value)) {
      return null;
    }

    for (const property of value.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        property.name.getText(sourceFile) === "title" &&
        ts.isStringLiteralLike(unwrap(property.initializer))
      ) {
        return (unwrap(property.initializer) as ts.StringLiteralLike).text;
      }
    }

    return null;
  };

  const name: string | null =
    literal(attributes.get("name")) ||
    literal(attributes.get("title")) ||
    cardTitle(attributes.get("cardProps")) ||
    literal(attributes.get("id"));

  return name ? `${hostName}: ${name}` : `${hostName} #${index + 1}`;
}

export function toRepositoryPath(
  repositoryRoot: string,
  filePath: string,
): string {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

export function scanFormFiles(data: {
  repositoryRoot: string;
  files: Array<string>;
  fileSystem?: SourceFileSystem | undefined;
}): Array<FormFacts> {
  const scanner: FormStepsScanner = new FormStepsScanner(
    data.repositoryRoot,
    data.fileSystem || REAL_FILE_SYSTEM,
  );
  const forms: Array<FormFacts> = [];

  for (const file of data.files) {
    forms.push(...scanner.scanFile(file));
  }

  /*
   * Two forms of one host sharing a name in a file are told apart by their
   * position, so an allowlist entry can never match the wrong one.
   */
  const seen: Map<string, number> = new Map<string, number>();

  for (const form of forms) {
    const key: string = `${form.file}::${form.label}`;
    const count: number = (seen.get(key) || 0) + 1;
    seen.set(key, count);

    if (count > 1) {
      form.label = `${form.label} #${count}`;
    }
  }

  return forms;
}

export function isLongForm(form: FormFacts): boolean {
  return form.visibleFieldCount > LONG_FORM_FIELD_LIMIT;
}

// Forms of more than three fields with no steps, that are counted for sure.
export function findLongFormsWithoutSteps(
  forms: Array<FormFacts>,
): Array<FormFacts> {
  return forms.filter((form: FormFacts): boolean => {
    return (
      !form.hasSteps &&
      !form.isPassThrough &&
      form.uncountableReasons.length === 0 &&
      isLongForm(form)
    );
  });
}

// Forms without steps whose fields could not all be followed.
export function findUncountableForms(
  forms: Array<FormFacts>,
): Array<FormFacts> {
  return forms.filter((form: FormFacts): boolean => {
    return (
      !form.hasSteps &&
      !form.isPassThrough &&
      form.uncountableReasons.length > 0
    );
  });
}

export function findStepProblems(
  forms: Array<FormFacts>,
): Array<FormStepProblem> {
  const problems: Array<FormStepProblem> = [];

  for (const form of forms) {
    if (!form.hasSteps || form.hasSummaryOnly || !form.steps) {
      continue;
    }

    const stepIds: Array<string> = form.steps
      .map((step: FormStepFacts): string | null => {
        return step.id;
      })
      .filter((id: string | null): id is string => {
        return id !== null;
      });
    const allStepIdsKnown: boolean = stepIds.length === form.steps.length;
    const shown: Array<FormFieldFacts> = form.fields.filter(
      (field: FormFieldFacts): boolean => {
        return !field.isNeverShown;
      },
    );

    for (const field of shown) {
      const name: string = field.title || field.key || "a field";

      if (field.stepId === undefined && field.isPlainLiteral) {
        problems.push({
          kind: "field-without-step",
          form,
          message: `"${name}" (${field.file}:${field.line}) has no stepId, so BasicForm never shows it - on no step of the form. Give it the stepId of the step it belongs on.`,
        });
      }

      if (
        typeof field.stepId === "string" &&
        allStepIdsKnown &&
        !stepIds.includes(field.stepId)
      ) {
        problems.push({
          kind: "field-on-undeclared-step",
          form,
          message: `"${name}" (${field.file}:${field.line}) is on step "${field.stepId}", which the form does not declare (${stepIds.join(", ")}), so it is never shown.`,
        });
      }
    }

    const everyStepKnown: boolean =
      allStepIdsKnown &&
      form.uncountableReasons.length === 0 &&
      shown.every((field: FormFieldFacts): boolean => {
        return typeof field.stepId === "string";
      });

    if (!everyStepKnown) {
      continue;
    }

    for (const stepId of stepIds) {
      const onStep: Array<FormFieldFacts> = shown.filter(
        (field: FormFieldFacts): boolean => {
          return field.stepId === stepId;
        },
      );

      if (onStep.length === 0) {
        problems.push({
          kind: "empty-step",
          form,
          message: `step "${stepId}" has no field on it, so the wizard walks through an empty page.`,
        });
        continue;
      }

      if (
        form.host === "ModelTable" &&
        form.hasEditForm &&
        onStep.every((field: FormFieldFacts): boolean => {
          return field.isCreateOnly;
        })
      ) {
        problems.push({
          kind: "empty-step-on-edit",
          form,
          message: `every field on step "${stepId}" is doNotShowWhenEditing, so the Edit form walks through an empty page.`,
        });
      }
    }
  }

  return problems;
}

export function describeForm(form: FormFacts): string {
  const titles: Array<string> = form.fields
    .filter((field: FormFieldFacts): boolean => {
      return !field.isNeverShown;
    })
    .map((field: FormFieldFacts): string => {
      return (
        (field.title || field.key || "?") +
        (field.isConditional ? " (when shown)" : "")
      );
    });

  return `${form.file}:${form.line} ${form.label} - ${form.visibleFieldCount} fields: ${titles.join(", ")}`;
}
