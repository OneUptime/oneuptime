import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * An alert's Root Cause page said isEditable but handed its card no
 * formFields, and the alert's rootCause column listed nobody who may update
 * it. CardModelDetail then checked the record's update permission alone,
 * which the person had, and drew Edit Alert - a button that opened an empty
 * dialog with nothing in it to change. Had the page named the field, the
 * column would have locked the button for everyone instead.
 *
 * Two rules keep an Edit button honest, checked here for every
 * CardModelDetail in the source:
 *
 *   1. An editable card has formFields. Its Edit dialog holds those and
 *      nothing else, so without them it can only open empty. Read in every
 *      frontend - the Dashboard, the Admin Dashboard, the Status Page,
 *      Accounts, the Public Dashboard, the shared Common/UI components, and
 *      the enterprise dashboards when ee/ is present. A card may be editable
 *      when its isEditable is anything but false; one whose attributes are
 *      spread from props is left alone, as the props may carry them.
 *
 *   2. Every column an editable card's form names may be updated by
 *      someone: its update list is not empty. Read where project members
 *      edit - every frontend but the Admin Dashboard, whose master admins
 *      pass no column check (UpdatePermission). Read for a card whose
 *      formFields are written out in place and whose modelType is a
 *      database model the file imports by name; the rest are counted as
 *      unread.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

const ADMIN_DASHBOARD_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
];

const PROJECT_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Dashboard", "src"),
  path.join(PACKAGES_DIR, "App", "FeatureSet", "StatusPage", "src"),
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Accounts", "src"),
  path.join(PACKAGES_DIR, "App", "FeatureSet", "PublicDashboard", "src"),
  path.join(PACKAGES_DIR, "Common", "UI"),
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

const DATABASE_MODELS: string = "Common/Models/DatabaseModels/";

interface Place {
  // Relative to the repository root, with forward slashes.
  file: string;
  line: number;
}

interface EditableCard extends Place {
  isEditable: string;
}

interface FormColumn extends Place {
  // The import the card's modelType names, e.g. Common/Models/DatabaseModels/Alert.
  modelImport: string;
  modelName: string;
  column: string;
}

interface ReadCards {
  cards: number;
  withoutFormFields: Array<EditableCard>;
  formColumns: Array<FormColumn>;
  // Editable cards whose form columns could not be read from the source.
  unreadForms: number;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...listSourceFiles(fullPath));
      }
    } else if (entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

// What a file's default imports are called, and where they come from.
function readDefaultImports(source: ts.SourceFile): Record<string, string> {
  const imports: Record<string, string> = {};

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.name &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports[statement.importClause.name.text] =
        statement.moduleSpecifier.text;
    }
  }

  return imports;
}

// The expression an attribute holds: {value}.
function attributeExpression(
  attribute: ts.JsxAttribute | undefined,
): ts.Expression | undefined {
  if (
    attribute?.initializer &&
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression
  ) {
    return attribute.initializer.expression;
  }

  return undefined;
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  name: string,
  source: ts.SourceFile,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) &&
        property.name.getText(source) === name
      );
    },
  ) as ts.PropertyAssignment | undefined;
}

// The columns a written-out formFields array names: each field's { column: true }.
function readFormColumns(
  formFields: ts.ArrayLiteralExpression,
  source: ts.SourceFile,
): Array<string> {
  const columns: Array<string> = [];

  for (const element of formFields.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      continue;
    }

    const field: ts.PropertyAssignment | undefined = propertyNamed(
      element,
      "field",
      source,
    );

    if (field && ts.isObjectLiteralExpression(field.initializer)) {
      for (const column of field.initializer.properties) {
        if (column.name) {
          columns.push(column.name.getText(source));
        }
      }
    }
  }

  return columns;
}

function readCards(file: string, text: string): ReadCards {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports: Record<string, string> = readDefaultImports(source);
  const withoutFormFields: Array<EditableCard> = [];
  const formColumns: Array<FormColumn> = [];
  let cards: number = 0;
  let unreadForms: number = 0;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      // <CardModelDetail> and <CardModelDetail<Model>> alike.
      node.tagName.getText(source) === "CardModelDetail"
    ) {
      cards++;

      const line: number =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const properties: ReadonlyArray<ts.JsxAttributeLike> =
        node.attributes.properties;
      const attributes: Array<ts.JsxAttribute> = properties.filter(
        ts.isJsxAttribute,
      );

      const attributeNamed: (name: string) => ts.JsxAttribute | undefined = (
        name: string,
      ): ts.JsxAttribute | undefined => {
        return attributes.find((attribute: ts.JsxAttribute): boolean => {
          return attribute.name.getText(source) === name;
        });
      };

      const isEditable: ts.JsxAttribute | undefined =
        attributeNamed("isEditable");

      // A bare isEditable is isEditable={true}.
      const isEditableValue: string | undefined = isEditable
        ? isEditable.initializer?.getText(source) || "{true}"
        : undefined;

      const formFields: ts.JsxAttribute | undefined =
        attributeNamed("formFields");

      if (isEditableValue && isEditableValue !== "{false}") {
        if (!formFields) {
          if (!properties.some(ts.isJsxSpreadAttribute)) {
            withoutFormFields.push({
              file: file,
              line: line,
              isEditable: isEditableValue,
            });
          }
        } else {
          const fields: ts.Expression | undefined =
            attributeExpression(formFields);
          const detail: ts.Expression | undefined = attributeExpression(
            attributeNamed("modelDetailProps"),
          );
          const modelType: ts.PropertyAssignment | undefined =
            detail && ts.isObjectLiteralExpression(detail)
              ? propertyNamed(detail, "modelType", source)
              : undefined;
          const modelName: string | undefined =
            modelType && ts.isIdentifier(modelType.initializer)
              ? modelType.initializer.text
              : undefined;
          const modelImport: string | undefined = modelName
            ? imports[modelName]
            : undefined;

          if (
            fields &&
            ts.isArrayLiteralExpression(fields) &&
            modelName &&
            modelImport?.startsWith(DATABASE_MODELS)
          ) {
            for (const column of readFormColumns(fields, source)) {
              formColumns.push({
                file: file,
                line: line,
                modelImport: modelImport,
                modelName: modelName,
                column: column,
              });
            }
          } else {
            unreadForms++;
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return {
    cards: cards,
    withoutFormFields: withoutFormFields,
    formColumns: formColumns,
    unreadForms: unreadForms,
  };
}

type ModelType = { new (): DatabaseBaseModel };

const MODELS: Record<string, ModelType> = {};

// The database model an import names, loaded once.
function loadModel(modelImport: string): ModelType {
  if (!MODELS[modelImport]) {
    MODELS[modelImport] = (
      jest.requireActual(modelImport) as { default: ModelType }
    ).default;
  }

  return MODELS[modelImport]!;
}

interface ColumnFinding {
  where: string;
  problem: "not a column of the model" | "nobody may update it";
}

// A form column nobody may update, or that the model does not have.
function checkFormColumn(formColumn: FormColumn): ColumnFinding | null {
  const model: DatabaseBaseModel = new (loadModel(formColumn.modelImport))();
  const where: string = `${formColumn.file}:${formColumn.line} ${formColumn.modelName}.${formColumn.column}`;

  if (!model.getTableColumns().columns.includes(formColumn.column)) {
    return { where: where, problem: "not a column of the model" };
  }

  const access: ColumnAccessControl | undefined =
    model.getColumnAccessControlForAllColumns()[formColumn.column];

  if ((access?.update || []).length === 0) {
    return { where: where, problem: "nobody may update it" };
  }

  return null;
}

function readDirectories(directories: Array<string>): Array<ReadCards> {
  return directories
    .flatMap((directory: string): Array<string> => {
      return listSourceFiles(directory);
    })
    .map((file: string): ReadCards | null => {
      const text: string = fs.readFileSync(file, "utf8");

      if (!text.includes("CardModelDetail")) {
        return null;
      }

      return readCards(relative(file), text);
    })
    .filter((result: ReadCards | null): result is ReadCards => {
      return result !== null;
    });
}

const ADMIN_DASHBOARD_READ: Array<ReadCards> =
  readDirectories(ADMIN_DASHBOARD_DIRS);
const PROJECT_READ: Array<ReadCards> = readDirectories(PROJECT_DIRS);

const CARDS_READ: number = [...ADMIN_DASHBOARD_READ, ...PROJECT_READ].reduce(
  (total: number, result: ReadCards): number => {
    return total + result.cards;
  },
  0,
);

const WITHOUT_FORM_FIELDS: Array<EditableCard> = [
  ...ADMIN_DASHBOARD_READ,
  ...PROJECT_READ,
].flatMap((result: ReadCards): Array<EditableCard> => {
  return result.withoutFormFields;
});

const PROJECT_FORM_COLUMNS: Array<FormColumn> = PROJECT_READ.flatMap(
  (result: ReadCards): Array<FormColumn> => {
    return result.formColumns;
  },
);

const ROOT_CAUSE_PAGE: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Alerts",
  "View",
  "RootCause.tsx",
);

// The alert's Root Cause page as it was: editable, with nothing to edit.
const ROOT_CAUSE_PAGE_BEFORE: string = `
import Alert from "Common/Models/DatabaseModels/Alert";

const Page = () => {
  return (
    <CardModelDetail
      name="Root Cause"
      cardProps={{ title: "Root Cause" }}
      isEditable={true}
      modelDetailProps={{ modelType: Alert, fields: [], modelId: modelId }}
    />
  );
};
`;

describe("rule 1, as this guard reads it", () => {
  test("an editable card without formFields, as the alert's Root Cause page had it", () => {
    const result: ReadCards = readCards(
      "Synthetic.tsx",
      ROOT_CAUSE_PAGE_BEFORE,
    );

    expect(result.cards).toBe(1);
    expect(result.withoutFormFields).toEqual([
      { file: "Synthetic.tsx", line: 6, isEditable: "{true}" },
    ]);
  });

  test("a bare isEditable, an expression, and a typed card count as editable", () => {
    const result: ReadCards = readCards(
      "Synthetic.tsx",
      `
const Page = () => {
  return (
    <>
      <CardModelDetail isEditable modelDetailProps={{}} />
      <CardModelDetail isEditable={canEdit} modelDetailProps={{}} />
      <CardModelDetail<Alert> isEditable={true} modelDetailProps={{}}></CardModelDetail>
    </>
  );
};
`,
    );

    expect(result.cards).toBe(3);
    expect(
      result.withoutFormFields.map((card: EditableCard): string => {
        return card.isEditable;
      }),
    ).toEqual(["{true}", "{canEdit}", "{true}"]);
  });

  test("a card with formFields, one that is not editable, and one spread from props pass", () => {
    const result: ReadCards = readCards(
      "Synthetic.tsx",
      `
const Page = () => {
  return (
    <>
      <CardModelDetail isEditable={true} formFields={[{ field: { rootCause: true } }]} modelDetailProps={{}} />
      <CardModelDetail isEditable={false} modelDetailProps={{}} />
      <CardModelDetail modelDetailProps={{}} />
      <CardModelDetail {...props} isEditable={true} />
    </>
  );
};
`,
    );

    expect(result.cards).toBe(4);
    expect(result.withoutFormFields).toEqual([]);
  });

  test("other components that take isEditable are not cards", () => {
    const result: ReadCards = readCards(
      "Synthetic.tsx",
      `
const Page = () => {
  return (
    <>
      <ModelTable isEditable={true} modelType={Alert} />
      <CardModelDetailList isEditable={true} />
      <Detail isEditable />
    </>
  );
};
`,
    );

    expect(result.cards).toBe(0);
    expect(result.withoutFormFields).toEqual([]);
  });

  test("a card inside an expression, a condition or a callback is read", () => {
    const result: ReadCards = readCards(
      "Synthetic.tsx",
      `
const Page = () => {
  return (
    <Fragment>
      {canSee ? <CardModelDetail isEditable={true} modelDetailProps={{}} /> : null}
      {items.map((item) => {
        return <CardModelDetail key={item.id} isEditable={true} modelDetailProps={{}} />;
      })}
    </Fragment>
  );
};
`,
    );

    expect(result.cards).toBe(2);
    expect(result.withoutFormFields).toHaveLength(2);
  });
});

describe("rule 2, as this guard reads it", () => {
  test("it reads the columns a written-out form names, and the model they belong to", () => {
    const result: ReadCards = readCards(
      "Synthetic.tsx",
      `
import Alert from "Common/Models/DatabaseModels/Alert";

const Page = () => {
  return (
    <CardModelDetail
      isEditable={true}
      formFields={[
        { field: { rootCause: true }, title: "Root Cause" },
        { field: { remediationNotes: true }, title: "Remediation Notes" },
      ]}
      modelDetailProps={{ modelType: Alert, fields: [], modelId: modelId }}
    />
  );
};
`,
    );

    expect(
      result.formColumns.map((formColumn: FormColumn): string => {
        return `${formColumn.modelImport}#${formColumn.column}`;
      }),
    ).toEqual([
      "Common/Models/DatabaseModels/Alert#rootCause",
      "Common/Models/DatabaseModels/Alert#remediationNotes",
    ]);
    expect(result.unreadForms).toBe(0);
  });

  test("a form held in a variable, or a model it cannot name, is counted as unread", () => {
    const result: ReadCards = readCards(
      "Synthetic.tsx",
      `
import Alert from "Common/Models/DatabaseModels/Alert";
import Something from "../Somewhere/Something";

const Page = () => {
  return (
    <>
      <CardModelDetail isEditable={true} formFields={FIELDS} modelDetailProps={{ modelType: Alert }} />
      <CardModelDetail isEditable={true} formFields={[{ field: { name: true } }]} modelDetailProps={{ modelType: Something }} />
      <CardModelDetail isEditable={true} formFields={[{ field: { name: true } }]} modelDetailProps={detailProps} />
    </>
  );
};
`,
    );

    expect(result.formColumns).toEqual([]);
    expect(result.unreadForms).toBe(3);
  });

  test("a form naming a column nobody may update is found", () => {
    // An alert's episode is moved by the server alone (EpisodeReferenceColumns).
    const result: ReadCards = readCards(
      "Synthetic.tsx",
      `
import Alert from "Common/Models/DatabaseModels/Alert";

const Page = () => {
  return (
    <CardModelDetail
      isEditable={true}
      formFields={[{ field: { alertEpisodeId: true } }]}
      modelDetailProps={{ modelType: Alert }}
    />
  );
};
`,
    );

    expect(result.formColumns.map(checkFormColumn)).toEqual([
      {
        where: "Synthetic.tsx:6 Alert.alertEpisodeId",
        problem: "nobody may update it",
      },
    ]);
  });

  test("a form naming something the model does not have is found", () => {
    const result: ReadCards = readCards(
      "Synthetic.tsx",
      `
import Alert from "Common/Models/DatabaseModels/Alert";

const Page = () => {
  return (
    <CardModelDetail
      isEditable={true}
      formFields={[{ field: { notAColumn: true } }]}
      modelDetailProps={{ modelType: Alert }}
    />
  );
};
`,
    );

    expect(result.formColumns.map(checkFormColumn)).toEqual([
      {
        where: "Synthetic.tsx:6 Alert.notAColumn",
        problem: "not a column of the model",
      },
    ]);
  });
});

describe("the alert's Root Cause page", () => {
  const result: ReadCards = readCards(
    relative(ROOT_CAUSE_PAGE),
    fs.readFileSync(ROOT_CAUSE_PAGE, "utf8"),
  );

  test("hands its one card formFields", () => {
    expect(result.cards).toBe(1);
    expect(result.withoutFormFields).toEqual([]);
  });

  test("asks for the alert's root cause, and someone may change it", () => {
    expect(
      result.formColumns.map((formColumn: FormColumn): string => {
        return `${formColumn.modelName}.${formColumn.column}`;
      }),
    ).toEqual(["Alert.rootCause"]);
    expect(result.formColumns.map(checkFormColumn)).toEqual([null]);
  });
});

describe("every editable card has something to edit", () => {
  test("it read the frontends' cards", () => {
    // About 190 when this was written; a broken scan reads none.
    expect(CARDS_READ).toBeGreaterThan(100);
  });

  test("rule 1: no card may be editable with no formFields", () => {
    expect(
      WITHOUT_FORM_FIELDS.map((card: EditableCard): string => {
        return `${card.file}:${card.line} isEditable=${card.isEditable}`;
      }),
    ).toEqual([]);
  });

  test("it read the columns project members' forms name", () => {
    // About 270 when this was written.
    expect(PROJECT_FORM_COLUMNS.length).toBeGreaterThan(150);
  });

  test("rule 2: every column a project member's form names may be updated by someone", () => {
    expect(
      PROJECT_FORM_COLUMNS.map(checkFormColumn)
        .filter((finding: ColumnFinding | null): finding is ColumnFinding => {
          return finding !== null;
        })
        .map((finding: ColumnFinding): string => {
          return `${finding.where}: ${finding.problem}`;
        }),
    ).toEqual([]);
  });
});
