import fs from "fs";
import path from "path";
import ts from "typescript";
import { RULE_ENABLED_COLUMN } from "../../UI/Components/RuleRun/RuleEnabledField";

/*
 * The detector behind the "long forms walk steps" guard
 * (Tests/UI/Components/Forms/LongFormStepsGuard.test.ts) and the "no step
 * packs too many options" guard (OverloadedFormStepsGuard.test.ts, see
 * findOverloadedSteps at the end).
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
 * A field a helper builds (getOwnersFormField({ stepId: "owners", ... })) is
 * the object the helper returns, read with what the call hands it: a step,
 * title or showIf written in the call's object argument is the field's, so
 * the field is placed on its step like one written out in full.
 *
 * What counts as a field the user can see. Every element of the list, less
 * the ones whose showIf is a constant `() => false` (registrations that only
 * make ModelForm select a column). A field shown under a condition counts:
 * the form can be that long. On a ModelTable the Create and the Edit forms
 * are told apart by doNotShowWhenCreating / doNotShowWhenEditing, and the
 * longer of the two is what is judged.
 *
 * A folded section counts once. Fields next to each other that share a
 * collapsibleSection (an "Advanced" section, getAdvancedFormSection) are
 * drawn as one header until the user opens it, so the form - or the step -
 * is judged by the rows it shows, the section's header being one of them
 * (countFieldRows). Fields are told to share a section by how their
 * collapsibleSection is written, so write the same expression on each: one
 * constant, built once.
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
 *
 * And, for the "finish from any step" guard (FinishFromAnyStepGuard.test.ts),
 * what a custom element draws: the components its getCustomElement renders
 * (following a render helper in the same file), where each is declared, and
 * whether it fills in a value of its own when it is drawn - an effect in it
 * that calls onChange (see CustomElementComponentFacts).
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

interface CreateFormSpec {
  // Where the Create form takes the values it starts with.
  initialValues: string;
  // An attribute written true offers a Create form (a table's isCreateable).
  offeredBy?: string | undefined;
  // An attribute holding FormType.Create makes the form one (formType).
  formTypeAt?: string | undefined;
}

interface HostSpec {
  // Where the host takes its fields: a JSX attribute, or a key of formProps.
  fields: string;
  steps?: string | undefined;
  summary?: string | undefined;
  /*
   * A host that creates a model through ModelForm: how its Create form is
   * read (see FormFacts.hasCreateForm and createInitialValueKeys).
   */
  createForm?: CreateFormSpec | undefined;
}

const CREATE_FORM_TYPE: RegExp = /^FormType\.Create$/;
const UPDATE_FORM_TYPE: RegExp = /^FormType\.Update$/;

const TABLE_CREATE_FORM: CreateFormSpec = {
  initialValues: "createInitialValues",
  offeredBy: "isCreateable",
};

export const FORM_HOSTS: Record<FormHostName, HostSpec> = {
  ModelTable: {
    fields: "formFields",
    steps: "formSteps",
    summary: "formSummary",
    createForm: TABLE_CREATE_FORM,
  },
  RuleTable: {
    fields: "formFields",
    steps: "formSteps",
    createForm: TABLE_CREATE_FORM,
  },
  LabelRuleTable: {
    fields: "formFields",
    steps: "formSteps",
    createForm: TABLE_CREATE_FORM,
  },
  CardModelDetail: { fields: "formFields", steps: "formSteps" },
  ModelFormModal: {
    fields: "formProps.fields",
    steps: "formProps.steps",
    summary: "formProps.summary",
    createForm: {
      initialValues: "initialValues",
      formTypeAt: "formProps.formType",
    },
  },
  BasicFormModal: {
    fields: "formProps.fields",
    steps: "formProps.steps",
    summary: "formProps.summary",
  },
  ModelForm: {
    fields: "fields",
    steps: "steps",
    summary: "summary",
    createForm: { initialValues: "initialValues", formTypeAt: "formType" },
  },
  BasicForm: { fields: "fields", steps: "steps", summary: "summary" },
  // Its own BasicFormModal receives these as props; the callers are counted.
  DuplicateModel: { fields: "fieldsToChange" },
};

/*
 * A component a custom element draws (Field.getCustomElement).
 */
export interface CustomElementComponentFacts {
  // The name the field draws it by: the JSX tag.
  name: string;
  // Where it is declared, repository-relative; null when it is not followed.
  file: string | null;
  /*
   * It writes a value of its own when it is drawn: an effect in it
   * (useEffect, useLayoutEffect, useAsyncEffect) calls onChange, directly or
   * through a function of its own. Null when it is not followed.
   */
  fillsInOnShow: boolean | null;
}

export interface FormFieldFacts {
  // The column or override key the field writes, when it is written down.
  key: string;
  title: string;
  // The fieldType as written ("FormFieldSchemaType.PeoplePicker"), or "".
  fieldType: string;
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
  /*
   * The defaultValue as written ("true", "60", "Mode.Suggest"), or undefined
   * when the field writes none. hasDefault also counts a getDefaultValue.
   */
  defaultValue: string | undefined;
  hasDefault: boolean;
  /*
   * The field object spreads another one in (`...someField`), which can
   * carry properties - a default among them - this scan does not see.
   */
  hasSpread: boolean;
  /*
   * The field's collapsibleSection as written (whitespace dropped), or
   * undefined when it is not in one. Fields next to each other with the same
   * text are one folded section.
   */
  collapsibleSection: string | undefined;
  // customElementCanBeSkipped written true (Forms/Utils/FinishFromAnyStep).
  customElementCanBeSkipped: boolean;
  // What its getCustomElement draws; empty when it has none.
  customElementComponents: Array<CustomElementComponentFacts>;
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
  /*
   * The fields the user can see, on the longer of the forms the host draws -
   * a folded section counting once (countFieldRows).
   */
  visibleFieldCount: number;
  /*
   * The form edits a rule model (one extending RuleBaseModel), whose
   * Match Criteria step ModelForm draws as one criteria builder in place of
   * the fields listed on it (RuleCriteriaModelForm).
   */
  isRuleModel: boolean;
  /*
   * The model the form saves, as its modelType names it: the identifier,
   * and the repository path of the file it is imported from - null when it
   * is not imported (a generic prop, a class declared in the file). Null
   * when the host takes no modelType written as a plain identifier.
   */
  modelType: { name: string; file: string | null } | null;
  /*
   * Whether the host draws a Create form through ModelForm: a table that is
   * isCreateable, a ModelForm or ModelFormModal whose formType is
   * FormType.Create. Null when that is decided at runtime.
   */
  hasCreateForm: boolean | null;
  /*
   * The keys of the values the Create form starts with (a table's
   * createInitialValues, a form's initialValues) when they are written as an
   * object literal, [] when there are none, null when they cannot be read.
   */
  createInitialValueKeys: Array<string> | null;
}

export type FormStepProblemKind =
  | "field-without-step"
  | "field-on-undeclared-step"
  | "empty-step"
  | "empty-step-on-edit"
  | "empty-step-on-create";

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

interface ResolvedItem {
  parsed: ParsedFile;
  node: ts.ObjectLiteralExpression;
  /*
   * For a field a helper returns: the object the call handed the helper,
   * whose properties (stepId, title, showIf...) the field carries.
   */
  call?: ts.ObjectLiteralExpression | undefined;
}

interface Resolution {
  items: Array<ResolvedItem>;
  // Plain literals written in the file the form itself is in.
  plain: Set<ts.ObjectLiteralExpression>;
  reasons: Array<string>;
  isPassThrough: boolean;
}

const MAX_DEPTH: number = 12;

// A model class whose Match Criteria step ModelForm draws as one builder.
const RULE_MODEL_CLASS: RegExp =
  /class\s+\w+\s+extends\s+(RuleBaseModel|RelationOnlyRuleBaseModel)\b/;

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
            const resolved: Resolution = this.resolveItem(
              found.parsed,
              last,
              depth + 1,
              false,
            );

            const argument: ts.Node | undefined = element.arguments[0]
              ? unwrap(element.arguments[0])
              : undefined;

            if (argument && ts.isObjectLiteralExpression(argument)) {
              for (const item of resolved.items) {
                item.call = item.call || argument;
              }
            }

            return resolved;
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
      (item: ResolvedItem) => {
        const facts: FormFieldFacts = this.describeField(
          item.parsed,
          item.node,
          fieldResolution.plain.has(item.node),
          item.call,
        );

        /*
         * RuleTable (and LabelRuleTable, built on it) leaves a rule's
         * Enabled switch off the create form: RuleEnabledField.
         */
        if (
          (hostName === "RuleTable" || hostName === "LabelRuleTable") &&
          facts.key === RULE_ENABLED_COLUMN &&
          isSwitchFieldType(facts.fieldType)
        ) {
          facts.isEditOnly = true;
        }

        return facts;
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
        steps = stepResolution.items.map((item: ResolvedItem) => {
          return this.describeStep(item.parsed, item.node);
        });
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

    let visibleFieldCount: number = countFieldRows(shown);

    if (hostName === "ModelTable" || hostName === "RuleTable") {
      const onCreate: number = countFieldRows(
        shown.filter((field: FormFieldFacts): boolean => {
          return !field.isEditOnly;
        }),
      );
      const onEdit: number = hasEditForm
        ? countFieldRows(
            shown.filter((field: FormFieldFacts): boolean => {
              return !field.isCreateOnly;
            }),
          )
        : 0;
      visibleFieldCount = Math.max(onCreate, onEdit);
    }

    const modelTypeExpression: ts.Expression | null =
      this.readHostValue(parsed, attributes, "modelType") ||
      this.readHostValue(parsed, attributes, "modelDetailProps.modelType") ||
      this.readHostValue(parsed, attributes, "formProps.modelType");

    const hasCreateForm: boolean | null = this.readHasCreateForm(
      parsed,
      attributes,
      spec.createForm,
    );

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
      isRuleModel: modelTypeExpression
        ? this.isRuleModelType(parsed, modelTypeExpression)
        : false,
      modelType: modelTypeExpression
        ? this.describeModelType(parsed, modelTypeExpression)
        : null,
      hasCreateForm,
      createInitialValueKeys:
        spec.createForm && hasCreateForm !== false
          ? this.readObjectKeys(
              parsed,
              this.readHostValue(
                parsed,
                attributes,
                spec.createForm.initialValues,
              ),
            )
          : [],
    };
  }

  private describeModelType(
    parsed: ParsedFile,
    expression: ts.Expression,
  ): { name: string; file: string | null } | null {
    const value: ts.Node = unwrap(expression);

    if (!ts.isIdentifier(value)) {
      return null;
    }

    const imported: { file: string; exported: string } | undefined =
      parsed.imports.get(value.text);

    return {
      name: value.text,
      file: imported
        ? toRepositoryPath(this.repositoryRoot, imported.file)
        : null,
    };
  }

  private readHasCreateForm(
    parsed: ParsedFile,
    attributes: Map<string, ts.JsxAttribute>,
    createForm: CreateFormSpec | undefined,
  ): boolean | null {
    if (!createForm) {
      return false;
    }

    if (createForm.offeredBy) {
      return this.readBooleanAttribute(
        parsed,
        attributes,
        createForm.offeredBy,
      );
    }

    if (createForm.formTypeAt) {
      const formType: ts.Expression | null = this.readHostValue(
        parsed,
        attributes,
        createForm.formTypeAt,
      );

      if (!formType) {
        return false;
      }

      const text: string = unwrap(formType).getText(parsed.sourceFile);

      if (CREATE_FORM_TYPE.test(text)) {
        return true;
      }

      if (UPDATE_FORM_TYPE.test(text)) {
        return false;
      }
    }

    return null;
  }

  /*
   * The keys an object literal writes - directly, or through a constant it
   * is declared as. [] when there is no object; null when it is something
   * else, or spreads in keys that are not written down.
   */
  private readObjectKeys(
    parsed: ParsedFile,
    expression: ts.Expression | null,
  ): Array<string> | null {
    if (!expression) {
      return [];
    }

    let value: ts.Node = unwrap(expression);

    if (ts.isIdentifier(value)) {
      if (value.text === "undefined") {
        return [];
      }

      const found: { parsed: ParsedFile; node: ts.Node } | null = this.lookup(
        parsed,
        value.text,
        0,
      );

      if (!found) {
        return null;
      }

      value = unwrap(found.node);
    }

    if (!ts.isObjectLiteralExpression(value)) {
      return null;
    }

    const keys: Array<string> = [];

    for (const property of value.properties) {
      if (
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        property.name
      ) {
        keys.push(
          property.name
            .getText(value.getSourceFile())
            .replace(/^\[|\]$/g, "")
            .replace(/^["']|["']$/g, ""),
        );
        continue;
      }

      return null;
    }

    return keys;
  }

  /*
   * Whether a modelType expression names a model class that extends
   * RuleBaseModel (directly, or through RelationOnlyRuleBaseModel): an
   * imported identifier whose file declares such a class.
   */
  private isRuleModelType(
    parsed: ParsedFile,
    expression: ts.Expression,
  ): boolean {
    const value: ts.Node = unwrap(expression);

    if (!ts.isIdentifier(value)) {
      return false;
    }

    const imported: { file: string; exported: string } | undefined =
      parsed.imports.get(value.text);

    const text: string | null = imported
      ? this.fileSystem.readFile(imported.file)
      : parsed.sourceFile.getFullText();

    if (!text) {
      return false;
    }

    return RULE_MODEL_CLASS.test(text);
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
    call?: ts.ObjectLiteralExpression | undefined,
  ): FormFieldFacts {
    const propertyOf: (
      container: ts.ObjectLiteralExpression,
      name: string,
    ) => ts.ObjectLiteralElementLike | undefined = (
      container: ts.ObjectLiteralExpression,
      name: string,
    ): ts.ObjectLiteralElementLike | undefined => {
      return container.properties.find(
        (candidate: ts.ObjectLiteralElementLike): boolean => {
          return (
            (ts.isPropertyAssignment(candidate) ||
              ts.isShorthandPropertyAssignment(candidate)) &&
            candidate.name.getText(container.getSourceFile()) === name
          );
        },
      );
    };

    // What the helper's caller wrote wins over the helper's own default.
    const property: (
      name: string,
    ) => ts.ObjectLiteralElementLike | undefined = (
      name: string,
    ): ts.ObjectLiteralElementLike | undefined => {
      return (
        (call ? propertyOf(call, name) : undefined) || propertyOf(node, name)
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
      key = overrideKey.getText(overrideKey.getSourceFile());
    } else if (
      field &&
      ts.isObjectLiteralExpression(field) &&
      field.properties[0]?.name
    ) {
      key = field.properties[0].name
        .getText(field.getSourceFile())
        .replace(/^\[|\]$/g, "")
        .replace(/^["']|["']$/g, "");
    }

    const title: ts.Node | null = initializerOf("title");
    const getCustomElement: ts.Node | null = initializerOf("getCustomElement");
    const defaultValue: ts.Node | null = initializerOf("defaultValue");
    const hasDefaultValue: boolean = Boolean(
      defaultValue &&
        defaultValue.kind !== ts.SyntaxKind.UndefinedKeyword &&
        !(ts.isIdentifier(defaultValue) && defaultValue.text === "undefined"),
    );
    const stepId: ts.Node | null = initializerOf("stepId");
    const showIf: ts.Node | null = initializerOf("showIf");
    const collapsibleSection: ts.Node | null =
      initializerOf("collapsibleSection");

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

    // A helper's field is reported where it is called.
    const position: ts.Node = call || node;
    const fieldType: ts.Node | null = initializerOf("fieldType");

    return {
      key,
      fieldType: fieldType ? fieldType.getText(fieldType.getSourceFile()) : "",
      title: title
        ? ts.isStringLiteralLike(title)
          ? title.text
          : title.getText(title.getSourceFile())
        : "",
      stepId: stepIdValue,
      isPlainLiteral,
      isNeverShown: Boolean(showIf && isConstantFalseFunction(showIf)),
      isConditional: Boolean(showIf && !isConstantFalseFunction(showIf)),
      isCreateOnly: isTrue("doNotShowWhenEditing"),
      isEditOnly: isTrue("doNotShowWhenCreating"),
      defaultValue:
        defaultValue && hasDefaultValue
          ? defaultValue.getText(defaultValue.getSourceFile())
          : undefined,
      hasDefault: hasDefaultValue || Boolean(initializerOf("getDefaultValue")),
      hasSpread: [node, call].some(
        (container: ts.ObjectLiteralExpression | undefined): boolean => {
          return Boolean(
            container?.properties.some(
              (candidate: ts.ObjectLiteralElementLike): boolean => {
                return ts.isSpreadAssignment(candidate);
              },
            ),
          );
        },
      ),
      collapsibleSection:
        collapsibleSection &&
        collapsibleSection.kind !== ts.SyntaxKind.UndefinedKeyword &&
        !(
          ts.isIdentifier(collapsibleSection) &&
          collapsibleSection.text === "undefined"
        )
          ? collapsibleSection
              .getText(collapsibleSection.getSourceFile())
              .replace(/\s+/g, "")
          : undefined,
      customElementCanBeSkipped: isTrue("customElementCanBeSkipped"),
      customElementComponents: getCustomElement
        ? this.readDrawnComponents(getCustomElement)
        : [],
      file: toRepositoryPath(
        this.repositoryRoot,
        call ? call.getSourceFile().fileName : parsed.file,
      ),
      line:
        position
          .getSourceFile()
          .getLineAndCharacterOfPosition(
            position.getStart(position.getSourceFile()),
          ).line + 1,
    };
  }

  /*
   * The components a getCustomElement draws: every JSX tag in it that names
   * a component, and in a function of the same file it calls to draw them
   * (renderMinutesSetting(...)), a few calls deep.
   */
  private readDrawnComponents(
    getCustomElement: ts.Node,
  ): Array<CustomElementComponentFacts> {
    const owner: ParsedFile | null = this.parse(
      getCustomElement.getSourceFile().fileName,
    );

    if (!owner) {
      return [];
    }

    const found: Map<string, CustomElementComponentFacts> = new Map<
      string,
      CustomElementComponentFacts
    >();
    const followed: Set<ts.Node> = new Set<ts.Node>();

    const visit: (node: ts.Node, depth: number) => void = (
      node: ts.Node,
      depth: number,
    ): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag: string = node.tagName.getText(owner.sourceFile);

        if (
          COMPONENT_TAG.test(tag) &&
          !tag.includes(".") &&
          tag !== "Fragment" &&
          !found.has(tag)
        ) {
          found.set(tag, this.describeComponentIn(owner, tag));
        }
      }

      if (
        depth < 3 &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression)
      ) {
        const declared: ts.Node | undefined = owner.declarations.get(
          node.expression.text,
        );

        if (
          declared &&
          ts.isFunctionLike(declared) &&
          !followed.has(declared)
        ) {
          followed.add(declared);
          visit(declared, depth + 1);
        }
      }

      ts.forEachChild(node, (child: ts.Node): void => {
        visit(child, depth);
      });
    };

    visit(getCustomElement, 0);

    return Array.from(found.values());
  }

  /*
   * Where a component a file uses is declared, and whether it fills in a
   * value of its own when it is drawn. Public so a guard can ask about a
   * component no form field in the scanned tree draws directly (a rule's
   * conditions builder, which ModelForm puts in itself).
   */
  public describeComponent(
    filePath: string,
    name: string,
  ): CustomElementComponentFacts {
    const parsed: ParsedFile | null = this.parse(filePath);

    if (!parsed) {
      return { name, file: null, fillsInOnShow: null };
    }

    return this.describeComponentIn(parsed, name);
  }

  private describeComponentIn(
    parsed: ParsedFile,
    name: string,
  ): CustomElementComponentFacts {
    const declared: { parsed: ParsedFile; node: ts.Node } | null = this.lookup(
      parsed,
      name,
      0,
    );

    if (!declared) {
      return { name, file: null, fillsInOnShow: null };
    }

    return {
      name,
      file: toRepositoryPath(this.repositoryRoot, declared.parsed.file),
      fillsInOnShow: fillsInOnShow(declared.node),
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

// The hosts that draw a Create and an Edit form from one field list.
const TABLE_HOSTS: ReadonlySet<FormHostName> = new Set<FormHostName>([
  "ModelTable",
  "RuleTable",
  "LabelRuleTable",
]);

// A switch, as a field's fieldType is written: Toggle or Checkbox.
export function isSwitchFieldType(fieldType: string): boolean {
  return (
    fieldType === "FormFieldSchemaType.Toggle" ||
    fieldType === "FormFieldSchemaType.Checkbox"
  );
}

// A JSX tag that names a component rather than an HTML element.
const COMPONENT_TAG: RegExp = /^[A-Z]/;

const EFFECT_HOOKS: ReadonlySet<string> = new Set<string>([
  "useEffect",
  "useLayoutEffect",
  "useAsyncEffect",
]);

// `onChange(...)`, `props.onChange(...)`, `props.onChange?.(...)`.
function isOnChangeCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  const callee: ts.Node = unwrap(node.expression);

  return (
    (ts.isIdentifier(callee) && callee.text === "onChange") ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === "onChange")
  );
}

function containsNode(
  root: ts.Node,
  test: (node: ts.Node) => boolean,
): boolean {
  let isFound: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (isFound) {
      return;
    }

    if (test(node)) {
      isFound = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(root);

  return isFound;
}

/*
 * Whether a component writes a value of its own when it is drawn: an effect
 * hook in it whose callback calls onChange - directly, or through a
 * function declared in the component that does. A value it only writes
 * when the user does something (an event handler) does not count.
 */
export function fillsInOnShow(component: ts.Node): boolean {
  // The component's own functions that call onChange.
  const callers: Set<string> = new Set<string>();

  const collect: (node: ts.Node) => void = (node: ts.Node): void => {
    // A function, or one wrapped in useCallback.
    const initializer: ts.Node | undefined =
      ts.isVariableDeclaration(node) && node.initializer
        ? unwrap(node.initializer)
        : undefined;

    const isFunction: boolean = Boolean(
      initializer &&
        (ts.isFunctionLike(initializer) ||
          (ts.isCallExpression(initializer) &&
            ts.isIdentifier(initializer.expression) &&
            initializer.expression.text === "useCallback" &&
            initializer.arguments[0] &&
            ts.isFunctionLike(unwrap(initializer.arguments[0])))),
    );

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      initializer &&
      isFunction &&
      containsNode(initializer, isOnChangeCall)
    ) {
      callers.add(node.name.text);
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      containsNode(node, isOnChangeCall)
    ) {
      callers.add(node.name.text);
    }

    ts.forEachChild(node, collect);
  };

  collect(component);

  return containsNode(component, (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node)) {
      return false;
    }

    const callee: ts.Node = unwrap(node.expression);
    const hookName: string = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : "";

    if (!EFFECT_HOOKS.has(hookName) || !node.arguments[0]) {
      return false;
    }

    return containsNode(node.arguments[0], (inner: ts.Node): boolean => {
      if (isOnChangeCall(inner)) {
        return true;
      }

      return (
        ts.isCallExpression(inner) &&
        ts.isIdentifier(unwrap(inner.expression)) &&
        callers.has((unwrap(inner.expression) as ts.Identifier).text)
      );
    });
  });
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

      /*
       * And the other way round: a step whose every field is left off the
       * Create form (doNotShowWhenCreating - a rule's Enabled switch, which
       * RuleTable leaves off on its own) is an empty page in the create
       * wizard.
       */
      if (
        TABLE_HOSTS.has(form.host) &&
        form.hasCreateForm !== false &&
        onStep.every((field: FormFieldFacts): boolean => {
          return field.isEditOnly;
        })
      ) {
        problems.push({
          kind: "empty-step-on-create",
          form,
          message: `every field on step "${stepId}" is left off the Create form (doNotShowWhenCreating), so the create wizard walks through an empty page.`,
        });
      }
    }
  }

  return problems;
}

/*
 * "Infact please audit forms everywhere in the project and if there are a lot
 * of options in single step, we can split in into multiple steps." - the
 * maintainer, on the Create OAuth 2.0 Variable form, whose second step asked
 * for eight settings on one scrolling page.
 *
 * A step is one screen of a dialog. More than this many fields on one step -
 * each with its label and its help - no longer fits that screen, and the
 * step stops asking one question. The OAuth step was eight.
 */
export const STEP_FIELD_LIMIT: number = 5;

export interface StepFieldCount {
  form: FormFacts;
  step: FormStepFacts;
  // The fields on the step the user can see, on its longer form.
  fields: Array<FormFieldFacts>;
  // How many of them the user can see at once (see countStepFields).
  count: number;
}

/*
 * Every step of a stepped form, with the fields it can show. Counted like a
 * form's length: a field shown under a condition counts (the step can be
 * that long), a constant `showIf: () => false` registration does not, a
 * folded section counts once (countFieldRows), and a
 * ModelTable is judged by the longer of its Create and Edit forms. A rule
 * model's Match Criteria step counts as one field, because ModelForm draws
 * the criteria builder there instead of the fields listed on it.
 *
 * A field is only placed on a step when its stepId is written as a string;
 * a field from a helper that takes its step as an argument is left to that
 * helper's own tests, as the stepped form checks above leave it.
 */
export function countStepFields(form: FormFacts): Array<StepFieldCount> {
  if (!form.hasSteps || form.hasSummaryOnly || !form.steps) {
    return [];
  }

  const counts: Array<StepFieldCount> = [];

  for (const step of form.steps) {
    if (!step.id) {
      continue;
    }

    const onStep: Array<FormFieldFacts> = form.fields.filter(
      (field: FormFieldFacts): boolean => {
        return !field.isNeverShown && field.stepId === step.id;
      },
    );

    let count: number = countFieldRows(onStep);

    if (form.host === "ModelTable" || form.host === "RuleTable") {
      const onCreate: number = countFieldRows(
        onStep.filter((field: FormFieldFacts): boolean => {
          return !field.isEditOnly;
        }),
      );
      const onEdit: number = form.hasEditForm
        ? countFieldRows(
            onStep.filter((field: FormFieldFacts): boolean => {
              return !field.isCreateOnly;
            }),
          )
        : 0;
      count = Math.max(onCreate, onEdit);
    }

    if (step.id === RULE_CRITERIA_STEP_ID && form.isRuleModel && count > 0) {
      count = 1;
    }

    counts.push({ form, step, fields: onStep, count });
  }

  return counts;
}

// Mirrors MATCH_CRITERIA_STEP_ID in UI/Components/RuleCriteria.
export const RULE_CRITERIA_STEP_ID: string = "match-criteria";

// Steps that can show more than STEP_FIELD_LIMIT fields.
export function findOverloadedSteps(
  forms: Array<FormFacts>,
): Array<StepFieldCount> {
  return forms.flatMap((form: FormFacts): Array<StepFieldCount> => {
    return countStepFields(form).filter((count: StepFieldCount): boolean => {
      return count.count > STEP_FIELD_LIMIT;
    });
  });
}

/*
 * The rows a list of fields takes on screen. Every field is a row, except
 * that fields next to each other in one folded section (collapsibleSection,
 * e.g. getAdvancedFormSection) are one row between them: the section's
 * header, which is all the form shows of them until the user opens it.
 */
export function countFieldRows(fields: Array<FormFieldFacts>): number {
  let rows: number = 0;
  let previousSection: string | undefined = undefined;

  for (const field of fields) {
    if (
      field.collapsibleSection !== undefined &&
      field.collapsibleSection === previousSection
    ) {
      continue;
    }

    rows++;
    previousSection = field.collapsibleSection;
  }

  return rows;
}

function describeFieldTitle(field: FormFieldFacts): string {
  return (
    (field.title || field.key || "?") +
    (field.isConditional ? " (when shown)" : "") +
    (field.collapsibleSection !== undefined ? " (folded)" : "")
  );
}

export function describeStepFieldCount(count: StepFieldCount): string {
  const titles: Array<string> = count.fields.map(describeFieldTitle);

  return `${count.form.file}:${count.form.line} ${count.form.label} - step "${count.step.id}" (${count.step.title}) shows ${count.count} fields: ${titles.join(", ")}`;
}

export function describeForm(form: FormFacts): string {
  const titles: Array<string> = form.fields
    .filter((field: FormFieldFacts): boolean => {
      return !field.isNeverShown;
    })
    .map(describeFieldTitle);

  return `${form.file}:${form.line} ${form.label} - ${form.visibleFieldCount} fields: ${titles.join(", ")}`;
}
