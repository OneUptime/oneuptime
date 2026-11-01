import { isRestatingColumnDescription } from "Common/UI/Components/Forms/Utils/ColumnDescriptionOnForm";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE COLUMN DESCRIPTIONS A FORM SHOWS.
 *
 * A form field with no description of its own shows its model column's
 * (Common/UI/Components/Forms/BasicModelForm), and FieldLabel looks it up
 * in the reader's language. The descriptions are written on the models
 * (@TableColumn({ description })), mostly for the API reference: taken
 * whole they are thousands of sentences no page shows, so the extractor
 * reads only the ones a form draws. Until it did, these were English in
 * every language: nearly five hundred form fields' help (#5292).
 *
 * A form field is an object literal with a fieldType of FormFieldSchemaType
 * and a field naming its column ({ field: { name: true } }). It draws its
 * column's description when it has no description of its own, does not say
 * hideColumnDescription: true, is not a color (the swatches say something
 * plainer), and the description is not one that only restates the field
 * ("Any friendly name of this object" - ColumnDescriptionOnForm, the rule
 * BasicModelForm applies). A rule's match conditions on a rule model draw
 * none either: the form puts one conditions builder in their place, which
 * names each condition by its title alone (RuleCriteriaModelForm). Its
 * model is the modelType of the nearest JSX
 * element around it (a ModelTable, a ModelFormModal, a CardModelDetail's
 * modelDetailProps), or the model a typed list of fields names
 * (Fields<Monitor>, Array<ModelField<Probe>>), as App's DescriptionScan
 * reads them (App/Tests/Dashboard/DescriptionScan, the "column" kind), which
 * holds the two to the same list (FormColumnDescriptionsInLocales).
 *
 * Read from the syntax tree, never by searching text.
 */

export interface FormColumnDescription {
  // The column's description, exactly as the form looks it up.
  text: string;
  // Where the form field is: repository-relative, with forward slashes.
  file: string;
  line: number;
  model: string;
  column: string;
}

// Where files are read from: the disk, or (in tests) files held in memory.
export interface FormColumnSourceReader {
  // The file's text, or null when there is no such file.
  read: (file: string) => string | null;
}

export const DISK_FORM_COLUMN_READER: FormColumnSourceReader = {
  read: (file: string): string | null => {
    return fs.existsSync(file) && fs.statSync(file).isFile()
      ? fs.readFileSync(file, "utf8")
      : null;
  },
};

const FORM_FIELD_TYPE: RegExp = /^FormFieldSchemaType\./;
// Field types whose fallback description BasicModelForm leaves out.
const NO_COLUMN_DESCRIPTION_TYPE: RegExp = /^FormFieldSchemaType\.Color$/;
const MODEL_MODULE: RegExp = /Models\/(DatabaseModels|AnalyticsModels)\//;
// A type parameter (TBaseModel, T), never a model.
const TYPE_PARAMETER_NAME: RegExp = /^T([A-Z]\w*)?$/;

/*
 * The step a rule form's match conditions are on: on a rule model, every
 * field of it is replaced by one conditions builder (Common/UI/Components/
 * RuleCriteria/RuleCriteriaModelForm, MATCH_CRITERIA_STEP_ID), so none of
 * them shows its column's description.
 */
const MATCH_CRITERIA_STEP: RegExp =
  /^(?:"match-criteria"|'match-criteria'|MATCH_CRITERIA_STEP_ID)$/;

// The class every rule model extends, itself or through another rule base.
const RULE_BASE_MODEL: string = "RuleBaseModel";

// How many base classes up a model's class is followed.
const MAX_BASE_CLASS_DEPTH: number = 8;

// Module aliases the frontends import through, to the directory each stands for.
const MODULE_ALIASES: ReadonlyArray<{ prefix: string; directory: string }> = [
  { prefix: "Common/", directory: "packages/Common" },
];

export class FormColumnDescriptionFinder {
  private readonly repositoryRoot: string;
  private readonly reader: FormColumnSourceReader;
  private readonly descriptions: Map<string, Map<string, string>> = new Map<
    string,
    Map<string, string>
  >();
  // Whether each model file's class is a rule model's (isRuleModel).
  private readonly ruleModels: Map<string, boolean> = new Map<
    string,
    boolean
  >();

  public constructor(
    repositoryRoot: string,
    reader: FormColumnSourceReader = DISK_FORM_COLUMN_READER,
  ) {
    this.repositoryRoot = repositoryRoot;
    this.reader = reader;
  }

  // The column descriptions the forms of one source file draw, in source order.
  public find(file: string, text: string): Array<FormColumnDescription> {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const found: Array<FormColumnDescription> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const description: FormColumnDescription | null = this.visitField(
          file,
          sourceFile,
          node,
        );

        if (description) {
          found.push(description);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return found;
  }

  private visitField(
    file: string,
    sourceFile: ts.SourceFile,
    node: ts.ObjectLiteralExpression,
  ): FormColumnDescription | null {
    const properties: Map<string, ts.Node> = propertiesOf(node);
    const fieldType: ts.Node | undefined = properties.get("fieldType");
    const fieldTypeText: string = fieldType
      ? fieldType.getText(sourceFile)
      : "";

    if (
      !FORM_FIELD_TYPE.test(fieldTypeText) ||
      NO_COLUMN_DESCRIPTION_TYPE.test(fieldTypeText) ||
      properties.has("description") ||
      properties.get("hideColumnDescription")?.kind ===
        ts.SyntaxKind.TrueKeyword
    ) {
      return null;
    }

    const field: ts.Node | undefined = properties.get("field");

    if (!field || !ts.isObjectLiteralExpression(field)) {
      return null;
    }

    const first: ts.ObjectLiteralElementLike | undefined = field.properties[0];
    const column: string | null =
      first &&
      (ts.isPropertyAssignment(first) ||
        ts.isShorthandPropertyAssignment(first))
        ? propertyName(first.name)
        : null;
    const model: string | null = modelOf(node);

    if (!column || !model) {
      return null;
    }

    const modelFile: string | null = this.modelFile(file, sourceFile, model);

    // A rule's match condition, drawn by the conditions builder.
    if (
      modelFile &&
      MATCH_CRITERIA_STEP.test(
        properties.get("stepId")?.getText(sourceFile) || "",
      ) &&
      this.isRuleModel(modelFile)
    ) {
      return null;
    }

    const description: string | null = modelFile
      ? this.columnDescription(modelFile, column)
      : null;

    if (!description || isRestatingColumnDescription(description)) {
      return null;
    }

    return {
      text: description,
      file: path.relative(this.repositoryRoot, file).split(path.sep).join("/"),
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      model: model,
      column: column,
    };
  }

  // The model's file, when the model is imported by default from a models directory.
  private modelFile(
    file: string,
    sourceFile: ts.SourceFile,
    model: string,
  ): string | null {
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !statement.importClause?.name ||
        statement.importClause.name.text !== model ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }

      const specifier: string = statement.moduleSpecifier.text;

      if (!MODEL_MODULE.test(specifier)) {
        return null;
      }

      return this.resolveModule(file, specifier);
    }

    return null;
  }

  /*
   * Whether a model's class extends RuleBaseModel, itself or through a base
   * of its own (OnCallRuleBaseModel, RelationOnlyRuleBaseModel).
   */
  private isRuleModel(modelFile: string, depth: number = 0): boolean {
    const known: boolean | undefined = this.ruleModels.get(modelFile);

    if (known !== undefined) {
      return known;
    }

    const text: string | null = this.reader.read(modelFile);
    let isRule: boolean = false;

    if (text !== null && depth < MAX_BASE_CLASS_DEPTH) {
      const sourceFile: ts.SourceFile = ts.createSourceFile(
        modelFile,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      for (const base of baseClassNames(sourceFile)) {
        if (base === RULE_BASE_MODEL) {
          isRule = true;
          break;
        }

        const baseFile: string | null = this.importedFile(
          modelFile,
          sourceFile,
          base,
        );

        if (baseFile && this.isRuleModel(baseFile, depth + 1)) {
          isRule = true;
          break;
        }
      }
    }

    this.ruleModels.set(modelFile, isRule);

    return isRule;
  }

  // The file a default import names, wherever it is.
  private importedFile(
    file: string,
    sourceFile: ts.SourceFile,
    name: string,
  ): string | null {
    for (const statement of sourceFile.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.name?.text === name &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        return this.resolveModule(file, statement.moduleSpecifier.text);
      }
    }

    return null;
  }

  private resolveModule(file: string, specifier: string): string | null {
    let base: string | null = null;

    if (specifier.startsWith(".")) {
      base = path.resolve(path.dirname(file), specifier);
    } else {
      for (const alias of MODULE_ALIASES) {
        if (specifier.startsWith(alias.prefix)) {
          base = path.join(
            this.repositoryRoot,
            alias.directory,
            specifier.slice(alias.prefix.length),
          );
          break;
        }
      }
    }

    if (!base) {
      return null;
    }

    for (const candidate of [`${base}.ts`, `${base}.tsx`]) {
      if (this.reader.read(candidate) !== null) {
        return candidate;
      }
    }

    return null;
  }

  // A model column's description, from its @TableColumn({ description }).
  private columnDescription(modelFile: string, column: string): string | null {
    let byColumn: Map<string, string> | undefined =
      this.descriptions.get(modelFile);

    if (!byColumn) {
      const read: Map<string, string> = new Map<string, string>();
      byColumn = read;
      const text: string | null = this.reader.read(modelFile);

      if (text !== null) {
        const sourceFile: ts.SourceFile = ts.createSourceFile(
          modelFile,
          text,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );

        const visit: (node: ts.Node) => void = (node: ts.Node): void => {
          if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
            const description: string | null = tableColumnDescription(node);

            if (description !== null) {
              read.set(node.name.text, description);
            }
          }

          ts.forEachChild(node, visit);
        };

        visit(sourceFile);
      }

      this.descriptions.set(modelFile, byColumn);
    }

    return byColumn.get(column) || null;
  }
}

// The classes a file's classes extend, by name.
function baseClassNames(sourceFile: ts.SourceFile): Array<string> {
  const names: Array<string> = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) {
      continue;
    }

    for (const clause of statement.heritageClauses || []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
        continue;
      }

      for (const type of clause.types) {
        if (ts.isIdentifier(type.expression)) {
          names.push(type.expression.text);
        }
      }
    }
  }

  return names;
}

// The description a property's @TableColumn({ ... }) gives, when it is a literal.
function tableColumnDescription(node: ts.PropertyDeclaration): string | null {
  const decorators: ReadonlyArray<ts.Decorator> =
    (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined) || [];

  for (const decorator of decorators) {
    const call: ts.Expression = decorator.expression;

    if (
      !ts.isCallExpression(call) ||
      !ts.isIdentifier(call.expression) ||
      call.expression.text !== "TableColumn"
    ) {
      continue;
    }

    const argument: ts.Expression | undefined = call.arguments[0];

    if (!argument || !ts.isObjectLiteralExpression(argument)) {
      continue;
    }

    const description: ts.Node | undefined =
      propertiesOf(argument).get("description");

    if (
      description &&
      (ts.isStringLiteral(description) ||
        ts.isNoSubstitutionTemplateLiteral(description))
    ) {
      return description.text;
    }
  }

  return null;
}

/*
 * The model a form field belongs to: the modelType of the nearest JSX
 * element around it, or the model a typed list of fields names.
 */
function modelOf(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isJsxOpeningElement(current) ||
      ts.isJsxSelfClosingElement(current)
    ) {
      for (const attribute of current.attributes.properties) {
        if (
          !ts.isJsxAttribute(attribute) ||
          !attribute.initializer ||
          !ts.isJsxExpression(attribute.initializer) ||
          !attribute.initializer.expression
        ) {
          continue;
        }

        const name: string = attribute.name.getText();
        const expression: ts.Expression = attribute.initializer.expression;

        if (name === "modelType" && ts.isIdentifier(expression)) {
          return expression.text;
        }

        if (
          name === "modelDetailProps" &&
          ts.isObjectLiteralExpression(expression)
        ) {
          const modelType: ts.Node | undefined =
            propertiesOf(expression).get("modelType");

          if (modelType && ts.isIdentifier(modelType)) {
            return modelType.text;
          }
        }
      }
    }

    const type: ts.TypeNode | undefined =
      ts.isVariableDeclaration(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
        ? current.type
        : undefined;

    if (type) {
      const model: string | null = modelInType(type);

      if (model) {
        return model;
      }
    }

    current = current.parent;
  }

  return null;
}

function modelInType(type: ts.TypeNode): string | null {
  let model: string | null = null;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (model) {
      return;
    }

    if (ts.isTypeReferenceNode(node) && node.typeArguments) {
      for (const argument of node.typeArguments) {
        if (
          ts.isTypeReferenceNode(argument) &&
          ts.isIdentifier(argument.typeName) &&
          !argument.typeArguments &&
          !TYPE_PARAMETER_NAME.test(argument.typeName.text)
        ) {
          model = argument.typeName.text;
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(type);

  return model;
}

function propertiesOf(node: ts.ObjectLiteralExpression): Map<string, ts.Node> {
  const properties: Map<string, ts.Node> = new Map<string, ts.Node>();

  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name: string | null = propertyName(property.name);

      if (name) {
        properties.set(name, property.initializer);
      }
    } else if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(property.name.text, property.name);
    }
  }

  return properties;
}

function propertyName(name: ts.Node): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return null;
}
