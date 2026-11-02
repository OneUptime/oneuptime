import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../Models/DatabaseModels/IncidentCustomField";
import Monitor from "../../Models/DatabaseModels/Monitor";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import CustomFieldType from "../../Types/CustomField/CustomFieldType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Dictionary from "../../Types/Dictionary";
import MonitorType from "../../Types/Monitor/MonitorType";
import { ModelSchema } from "../../Utils/Schema/ModelSchema";
import { getSchemaFields, SchemaField } from "../../Utils/Schema/SchemaFields";

/*
 * THE VALUES A COLUMN TAKES, WHEN IT TAKES ONE OF A FEW.
 *
 * A text column typed with a string enum - a cloud account's provider
 * ("aws", "azure" or "gcp"), an AI rule's trigger, a workspace's type -
 * takes one of the enum's values, and says them (TableColumn.allowedValues:
 * Object.values(CloudProvider)). The OpenAPI spec writes them as the
 * field's enum (ModelSchema), and everything published from the spec
 * follows: the API reference lists them, MCP's tool schemas offer them, the
 * Terraform and OpenTofu provider refuses any other value at plan time and
 * lists them where the attribute is documented, and an example that has no
 * value of its own shows the first of them - not "Example short text",
 * which no API takes.
 *
 * Before, only a monitor's type and a workflow's status said theirs: every
 * other choice was a string the docs called "Example short text", and a
 * typo planned cleanly and failed, or was stored, at apply.
 *
 * The first block reads the models' source, so that a new column typed with
 * a string enum says its values; the second holds what the models say to
 * the rules; the third holds the spec to them.
 */

const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../Models/DatabaseModels",
);

const COMMON_DIRECTORY: string = path.resolve(__dirname, "../..");

const TEXT_COLUMN_TYPES: ReadonlyArray<string> = [
  "ShortText",
  "LongText",
  "VeryLongText",
];

/*
 * The most values a column may say. Each one is listed in the docs, and a
 * Terraform plan that refuses a value prints them all.
 */
const MOST_ALLOWED_VALUES: number = 100;

/*
 * Enums whose values a column does not say, each with why: too many to
 * list, so a plan's refusal would print hundreds of them.
 */
const LEFT_OUT_ENUMS: Readonly<Record<string, string>> = {
  Permission:
    "1,575 permissions, documented on the permissions pages rather than listed per field",
  Timezone:
    "the IANA time zones, about 600 of them, which every reader knows by their names",
  IconProp: "341 icon names, chosen in the dashboard's icon picker",
};

interface EnumDeclaration {
  file: string;
  name: string;
  values: Array<string> | null; // null: a member is not a string
}

interface EnumTypedColumn {
  model: string;
  file: string;
  property: string;
  // The enum's name where the model uses it.
  typeName: string;
  columnType: string | null;
  // The identifier in allowedValues: Object.values(<identifier>).
  allowedValuesOf: string | null;
  // allowedValues written some other way.
  allowedValuesWrittenOtherwise: boolean;
  enumDeclaration: EnumDeclaration;
}

const SOURCE_FILES: Map<string, ts.SourceFile> = new Map();

function parse(file: string): ts.SourceFile {
  let source: ts.SourceFile | undefined = SOURCE_FILES.get(file);

  if (!source) {
    source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf-8"),
      ts.ScriptTarget.Latest,
      true,
    );
    SOURCE_FILES.set(file, source);
  }

  return source;
}

function resolveModule(fromFile: string, specifier: string): string | null {
  let base: string;

  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("Common/")) {
    base = path.join(COMMON_DIRECTORY, specifier.slice("Common/".length));
  } else {
    return null;
  }

  for (const candidate of [
    `${base}.ts`,
    path.join(base, "Index.ts"),
    `${base}.tsx`,
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function stringMemberValues(
  declaration: ts.EnumDeclaration,
): Array<string> | null {
  const values: Array<string> = [];

  for (const member of declaration.members) {
    if (!member.initializer || !ts.isStringLiteral(member.initializer)) {
      return null;
    }

    values.push(member.initializer.text);
  }

  return values;
}

function findEnum(file: string, name: string): EnumDeclaration | null {
  const source: ts.SourceFile = parse(file);

  for (const statement of source.statements) {
    if (ts.isEnumDeclaration(statement) && statement.name.text === name) {
      return { file, name, values: stringMemberValues(statement) };
    }
  }

  return null;
}

// The enum a module's default export is: `export default Name;`.
function findDefaultExportedEnum(file: string): EnumDeclaration | null {
  const source: ts.SourceFile = parse(file);

  for (const statement of source.statements) {
    if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression)
    ) {
      return findEnum(file, statement.expression.text);
    }

    if (
      ts.isEnumDeclaration(statement) &&
      statement.modifiers?.some((modifier: ts.ModifierLike): boolean => {
        return modifier.kind === ts.SyntaxKind.DefaultKeyword;
      })
    ) {
      return {
        file,
        name: statement.name.text,
        values: stringMemberValues(statement),
      };
    }
  }

  return null;
}

/*
 * The enum a name in a model's file stands for: one the file declares, or
 * one it imports.
 */
function resolveEnum(
  file: string,
  source: ts.SourceFile,
  localName: string,
): EnumDeclaration | null {
  const declared: EnumDeclaration | null = findEnum(file, localName);

  if (declared) {
    return declared;
  }

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const module: string | null = resolveModule(
      file,
      statement.moduleSpecifier.text,
    );
    const clause: ts.ImportClause = statement.importClause;

    if (clause.name && clause.name.text === localName) {
      return module ? findDefaultExportedEnum(module) : null;
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.name.text !== localName) {
          continue;
        }

        const importedName: string = element.propertyName
          ? element.propertyName.text
          : element.name.text;

        if (!module) {
          return null;
        }

        return importedName === "default"
          ? findDefaultExportedEnum(module)
          : findEnum(module, importedName);
      }
    }
  }

  return null;
}

// `Name`, or `Name | undefined` / `Name | null`: the name.
function typeNameOf(type: ts.TypeNode | undefined): string | null {
  if (!type) {
    return null;
  }

  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    return type.typeArguments ? null : type.typeName.text;
  }

  if (ts.isUnionTypeNode(type)) {
    const named: Array<ts.TypeNode> = type.types.filter(
      (member: ts.TypeNode): boolean => {
        return !(
          member.kind === ts.SyntaxKind.UndefinedKeyword ||
          (ts.isLiteralTypeNode(member) &&
            member.literal.kind === ts.SyntaxKind.NullKeyword)
        );
      },
    );

    return named.length === 1 ? typeNameOf(named[0]) : null;
  }

  return null;
}

function tableColumnArgument(
  property: ts.PropertyDeclaration,
): ts.ObjectLiteralExpression | null {
  for (const modifier of property.modifiers || []) {
    if (!ts.isDecorator(modifier)) {
      continue;
    }

    const expression: ts.Expression = modifier.expression;

    if (
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "TableColumn" &&
      expression.arguments[0] &&
      ts.isObjectLiteralExpression(expression.arguments[0])
    ) {
      return expression.arguments[0];
    }
  }

  return null;
}

function propertyOf(
  argument: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  for (const element of argument.properties) {
    if (
      ts.isPropertyAssignment(element) &&
      ts.isIdentifier(element.name) &&
      element.name.text === name
    ) {
      return element.initializer;
    }
  }

  return null;
}

// TableColumnType.ShortText: "ShortText".
function columnTypeOf(argument: ts.ObjectLiteralExpression): string | null {
  const type: ts.Expression | null = propertyOf(argument, "type");

  if (
    type &&
    ts.isPropertyAccessExpression(type) &&
    ts.isIdentifier(type.expression) &&
    type.expression.text === "TableColumnType"
  ) {
    return type.name.text;
  }

  return null;
}

// allowedValues: Object.values(Name): "Name".
function allowedValuesIdentifier(argument: ts.ObjectLiteralExpression): {
  identifier: string | null;
  present: boolean;
} {
  const value: ts.Expression | null = propertyOf(argument, "allowedValues");

  if (!value) {
    return { identifier: null, present: false };
  }

  if (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression) &&
    ts.isIdentifier(value.expression.expression) &&
    value.expression.expression.text === "Object" &&
    value.expression.name.text === "values" &&
    value.arguments.length === 1 &&
    ts.isIdentifier(value.arguments[0]!)
  ) {
    return {
      identifier: (value.arguments[0] as ts.Identifier).text,
      present: true,
    };
  }

  return { identifier: null, present: true };
}

function modelFiles(): Array<string> {
  const files: Array<string> = [];

  for (const directory of [
    MODELS_DIRECTORY,
    path.join(MODELS_DIRECTORY, "DatabaseBaseModel"),
  ]) {
    for (const name of fs.readdirSync(directory).sort()) {
      if (name.endsWith(".ts")) {
        files.push(path.join(directory, name));
      }
    }
  }

  return files;
}

// Every column of every model whose type is an enum with string values.
function enumTypedColumns(): Array<EnumTypedColumn> {
  const columns: Array<EnumTypedColumn> = [];

  for (const file of modelFiles()) {
    const source: ts.SourceFile = parse(file);

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
        const argument: ts.ObjectLiteralExpression | null =
          tableColumnArgument(node);
        const typeName: string | null = typeNameOf(node.type);

        if (argument && typeName) {
          const enumDeclaration: EnumDeclaration | null = resolveEnum(
            file,
            source,
            typeName,
          );

          if (enumDeclaration && enumDeclaration.values) {
            const allowed: { identifier: string | null; present: boolean } =
              allowedValuesIdentifier(argument);

            columns.push({
              model: path.basename(file, ".ts"),
              file,
              property: node.name.text,
              typeName,
              columnType: columnTypeOf(argument),
              allowedValuesOf: allowed.identifier,
              allowedValuesWrittenOtherwise:
                allowed.present && !allowed.identifier,
              enumDeclaration,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return columns;
}

const ENUM_TYPED_COLUMNS: Array<EnumTypedColumn> = enumTypedColumns();

function labelOf(column: EnumTypedColumn): string {
  return `${column.model}.${column.property}`;
}

describe("a text column typed with a string enum", () => {
  test("the scan finds the columns it is about", () => {
    const labels: Array<string> = ENUM_TYPED_COLUMNS.map(labelOf);

    /*
     * A few of every shape: a default import, a named one, an enum the
     * model's own file declares, and a base model's column.
     */
    expect(labels).toEqual(
      expect.arrayContaining([
        "CloudConnection.provider",
        "WorkspaceSetting.workspaceType",
        "IncidentFeed.incidentFeedEventType",
        "FileModel.fileType",
        "OnCallRuleBaseModel.whenToPage",
      ]),
    );
    expect(ENUM_TYPED_COLUMNS.length).toBeGreaterThan(300);
  });

  test("says the values it takes, with Object.values of its own enum", () => {
    const missing: Array<string> = [];

    for (const column of ENUM_TYPED_COLUMNS) {
      if (
        !column.columnType ||
        !TEXT_COLUMN_TYPES.includes(column.columnType)
      ) {
        continue;
      }

      if (LEFT_OUT_ENUMS[column.enumDeclaration.name]) {
        continue;
      }

      if (column.allowedValuesOf !== column.typeName) {
        missing.push(
          `${labelOf(column)}: allowedValues: Object.values(${column.typeName})`,
        );
      }
    }

    expect(missing).toEqual([]);
  });

  test("the enums left out are too long to list, and say nothing", () => {
    const leftOut: Array<EnumTypedColumn> = ENUM_TYPED_COLUMNS.filter(
      (column: EnumTypedColumn): boolean => {
        return Boolean(LEFT_OUT_ENUMS[column.enumDeclaration.name]);
      },
    );

    // Each enum on the list is used by a column, so the list cannot go stale.
    expect(
      Array.from(
        new Set(
          leftOut.map((column: EnumTypedColumn): string => {
            return column.enumDeclaration.name;
          }),
        ),
      ).sort(),
    ).toEqual(Object.keys(LEFT_OUT_ENUMS).sort());

    for (const column of leftOut) {
      expect(new Set(column.enumDeclaration.values).size).toBeGreaterThan(
        MOST_ALLOWED_VALUES,
      );
      expect(column.allowedValuesOf).toBeNull();
    }
  });

  test("names its values one way: Object.values(<its enum>)", () => {
    expect(
      ENUM_TYPED_COLUMNS.filter((column: EnumTypedColumn): boolean => {
        return column.allowedValuesWrittenOtherwise;
      }).map(labelOf),
    ).toEqual([]);
  });

  test("a monitor's type, a workflow's status and a custom field's type say theirs by their column type", () => {
    const byColumnType: Array<string> = ENUM_TYPED_COLUMNS.filter(
      (column: EnumTypedColumn): boolean => {
        return (
          column.columnType === "MonitorType" ||
          column.columnType === "WorkflowStatus" ||
          column.columnType === "CustomFieldType"
        );
      },
    ).map((column: EnumTypedColumn): string => {
      return `${labelOf(column)} ${column.columnType}`;
    });

    expect(byColumnType).toEqual(
      expect.arrayContaining([
        "Monitor.monitorType MonitorType",
        "IncidentCustomField.customFieldType CustomFieldType",
      ]),
    );

    for (const column of ENUM_TYPED_COLUMNS) {
      if (!column.columnType || TEXT_COLUMN_TYPES.includes(column.columnType)) {
        continue;
      }

      // ModelSchema writes those enums itself.
      expect(column.allowedValuesOf).toBeNull();
    }
  });
});

interface ColumnWithAllowedValues {
  label: string;
  column: TableColumnMetadata;
  modelType: new () => DatabaseBaseModel;
  key: string;
}

function columnsWithAllowedValues(): Array<ColumnWithAllowedValues> {
  const found: Array<ColumnWithAllowedValues> = [];

  for (const modelType of AllModelTypes) {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new modelType(),
    );

    for (const key of Object.keys(columns)) {
      const column: TableColumnMetadata | undefined = columns[key];

      if (column?.allowedValues) {
        found.push({
          label: `${modelType.name}.${key}`,
          column,
          modelType,
          key,
        });
      }
    }
  }

  return found;
}

const COLUMNS_WITH_ALLOWED_VALUES: Array<ColumnWithAllowedValues> =
  columnsWithAllowedValues();

describe("the values a column says it takes", () => {
  test("are said by hundreds of columns", () => {
    expect(COLUMNS_WITH_ALLOWED_VALUES.length).toBeGreaterThan(300);
  });

  test("are text columns' only", () => {
    expect(
      COLUMNS_WITH_ALLOWED_VALUES.filter(
        (entry: ColumnWithAllowedValues): boolean => {
          return ![
            TableColumnType.ShortText,
            TableColumnType.LongText,
            TableColumnType.VeryLongText,
          ].includes(entry.column.type);
        },
      ).map((entry: ColumnWithAllowedValues): string => {
        return entry.label;
      }),
    ).toEqual([]);
  });

  /*
   * An enum may name "no value" as one of its values (an invoice's status
   * before Stripe says one is ""), so an empty string is one too.
   */
  test("are a few strings, written as they are stored", () => {
    for (const entry of COLUMNS_WITH_ALLOWED_VALUES) {
      const values: ReadonlyArray<string> = entry.column.allowedValues!;

      expect([entry.label, values.length > 0]).toEqual([entry.label, true]);
      expect([
        entry.label,
        new Set(values).size <= MOST_ALLOWED_VALUES,
      ]).toEqual([entry.label, true]);

      for (const value of values) {
        expect([entry.label, typeof value, value === value.trim()]).toEqual([
          entry.label,
          "string",
          true,
        ]);
      }
    }
  });

  test("hold the column's own example and default", () => {
    const wrong: Array<string> = [];

    for (const entry of COLUMNS_WITH_ALLOWED_VALUES) {
      const values: ReadonlyArray<string> = entry.column.allowedValues!;

      for (const [what, value] of [
        ["example", entry.column.example],
        ["default", entry.column.defaultValue],
      ] as Array<[string, unknown]>) {
        if (value !== undefined && !values.includes(value as string)) {
          wrong.push(`${entry.label}: its ${what} ${JSON.stringify(value)}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });
});

function openApiOfField(
  fields: Array<SchemaField>,
  name: string,
): Record<string, unknown> | undefined {
  return fields.find((field: SchemaField): boolean => {
    return field.name === name;
  })?.openApi as Record<string, unknown> | undefined;
}

describe("the spec of a column that says its values", () => {
  test("a cloud account's provider is one of aws, azure and gcp, with aws for its example", () => {
    for (const schema of [
      ModelSchema.getCreateModelSchema({ modelType: CloudConnection }),
      ModelSchema.getReadModelSchema({ modelType: CloudConnection }),
      ModelSchema.getModelSchema({ modelType: CloudConnection }),
    ]) {
      const openApi: Record<string, unknown> | undefined = openApiOfField(
        getSchemaFields(schema),
        "provider",
      );

      expect(openApi?.["enum"]).toEqual(Object.values(CloudProvider));
      expect(openApi?.["example"]).toBe("aws");
      expect(openApi?.["type"]).toBe("string");
    }
  });

  test("every model's create and read schemas write each column's values as its enum, and an example among them", () => {
    const wrong: Array<string> = [];

    for (const entry of COLUMNS_WITH_ALLOWED_VALUES) {
      const values: Array<string> = Array.from(
        new Set(entry.column.allowedValues!),
      );

      for (const [schemaName, fields] of [
        [
          "create",
          getSchemaFields(
            ModelSchema.getCreateModelSchema({ modelType: entry.modelType }),
          ),
        ],
        [
          "read",
          getSchemaFields(
            ModelSchema.getReadModelSchema({ modelType: entry.modelType }),
          ),
        ],
      ] as Array<[string, Array<SchemaField>]>) {
        const openApi: Record<string, unknown> | undefined = openApiOfField(
          fields,
          entry.key,
        );

        // Not every column is in every schema (read-only, hidden...).
        if (!openApi) {
          continue;
        }

        if (JSON.stringify(openApi["enum"]) !== JSON.stringify(values)) {
          wrong.push(`${entry.label} (${schemaName}): enum`);
        }

        if (!values.includes(openApi["example"] as string)) {
          wrong.push(
            `${entry.label} (${schemaName}): example ${JSON.stringify(openApi["example"])}`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("an enum that gives two names one value says the value once", () => {
    const column: TableColumnMetadata = {
      type: TableColumnType.ShortText,
      allowedValues: ["image/png", "image/jpeg", "image/jpeg"],
    };

    expect(ModelSchema.getAllowedValues(column)).toEqual([
      "image/png",
      "image/jpeg",
    ]);
  });

  test("an example the column gives wins; else the first value; else the placeholder", () => {
    expect(
      ModelSchema.getTextExample(
        {
          type: TableColumnType.ShortText,
          allowedValues: ["a", "b"],
          example: "b",
        },
        "placeholder",
      ),
    ).toBe("b");
    expect(
      ModelSchema.getTextExample(
        { type: TableColumnType.ShortText, allowedValues: ["a", "b"] },
        "placeholder",
      ),
    ).toBe("a");
    expect(
      ModelSchema.getTextExample(
        { type: TableColumnType.ShortText },
        "placeholder",
      ),
    ).toBe("placeholder");
    expect(
      ModelSchema.getAllowedValues({ type: TableColumnType.ShortText }),
    ).toBeUndefined();
    expect(
      ModelSchema.getAllowedValues({
        type: TableColumnType.ShortText,
        allowedValues: [],
      }),
    ).toBeUndefined();
  });

  test("a custom field's type is a string, one of the custom field types, not a JSON value", () => {
    for (const schema of [
      ModelSchema.getCreateModelSchema({ modelType: IncidentCustomField }),
      ModelSchema.getModelSchema({ modelType: IncidentCustomField }),
    ]) {
      const openApi: Record<string, unknown> | undefined = openApiOfField(
        getSchemaFields(schema),
        "customFieldType",
      );

      expect(openApi?.["type"]).toBe("string");
      expect(openApi?.["enum"]).toEqual(Object.values(CustomFieldType));
      expect(openApi?.["example"]).toBe(CustomFieldType.Text);
    }
  });

  test("a monitor's type has an example the API takes in every schema", () => {
    for (const schema of [
      ModelSchema.getCreateModelSchema({ modelType: Monitor }),
      ModelSchema.getReadModelSchema({ modelType: Monitor }),
      ModelSchema.getModelSchema({ modelType: Monitor }),
    ]) {
      const openApi: Record<string, unknown> | undefined = openApiOfField(
        getSchemaFields(schema),
        "monitorType",
      );

      expect(openApi?.["enum"]).toEqual(Object.values(MonitorType));
      expect(Object.values(MonitorType)).toContain(openApi?.["example"]);
    }
  });
});
