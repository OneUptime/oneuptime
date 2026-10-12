import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "Show ID" never hands React an object (issue #4615).
 *
 * On AI / LLM > Overview, Show ID on a row of Recent LLM Calls threw minified
 * React error #31: "Objects are not valid as a React child (found: object
 * with keys {_id})". The tables share one implementation (BaseModelTable)
 * for database rows, whose `_id` is a string, and analytics (ClickHouse)
 * rows - spans, LLM calls, exceptions, profiles - whose `_id` is an
 * ObjectID. It read the ID with `item["_id"] as string`, which the compiler
 * believed, and put the object in the dialog's <code>.
 *
 * The fix is one dialog, ObjectID/RecordIdModal.tsx, that turns whatever it
 * is given into text (ObjectID/RecordIdText.ts). This guard holds the rest of
 * the code to it. It reads the TypeScript of Common's UI, every feature set of
 * the App and the enterprise dashboards, and fails on:
 *
 *   1. a dialog (ConfirmModal or Modal) titled "<something> ID" - a Show ID
 *      dialog drawn by hand instead of RecordIdModal;
 *   2. a row's `_id` cast to a string in the code that lists database and
 *      analytics rows alike (ModelTable, Table, List, Detail, ModelDetail) -
 *      the cast that hid the ObjectID from the compiler;
 *   3. BaseModelTable's Show ID reading the ID any way but getRecordIdText,
 *      offering Show ID on a row with no ID, or drawing its own dialog;
 *   4. RecordIdModal putting the value it was given on the page, rather than
 *      the text it reads from it.
 *
 * What the dialog does is tested in Common/Tests/UI/Components/ObjectID and
 * ModelTable/BaseModelTableShowId; every telemetry table that offers Show ID
 * in Common/Tests/App/Dashboard/TelemetryTablesShowId.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");
const COMMON_UI_DIR: string = path.join(PACKAGES_DIR, "Common", "UI");
const COMPONENTS_DIR: string = path.join(COMMON_UI_DIR, "Components");

const SCAN_DIRS: Array<string> = [
  COMMON_UI_DIR,
  path.join(PACKAGES_DIR, "App", "FeatureSet"),
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
];

/*
 * The App Test job deletes ee/ before it runs, so there only the core screens
 * are read. The Enterprise Edition Test workflow (test.ee.yaml) runs this
 * guard with ee/ present, which is where the enterprise dashboards' dialogs
 * are held to it.
 */
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
);

/*
 * The components that list database and analytics rows alike, where a row's
 * `_id` may be a string or an ObjectID.
 */
const SHARED_ROW_DIRS: Array<string> = [
  "ModelTable",
  "Table",
  "List",
  "Detail",
  "ModelDetail",
  "ModelList",
  "ObjectID",
].map((name: string): string => {
  return path.join(COMPONENTS_DIR, name);
});

const BASE_MODEL_TABLE: string = path.join(
  COMPONENTS_DIR,
  "ModelTable",
  "BaseModelTable.tsx",
);

const RECORD_ID_MODAL: string = path.join(
  COMPONENTS_DIR,
  "ObjectID",
  "RecordIdModal.tsx",
);

// The dialogs that hand over a record's ID, besides the tables'.
const STATUS_PAGE_ID_DIALOGS: Array<string> = [
  path.join(
    PACKAGES_DIR,
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "StatusPage",
    "StatusPageResourcePanel.tsx",
  ),
  path.join(
    PACKAGES_DIR,
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "StatusPages",
    "View",
    "Resources.tsx",
  ),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

const DIALOG_COMPONENTS: Array<string> = ["ConfirmModal", "Modal"];

// A title that names an ID: "Monitor ID", "{{itemName}} ID", "Group ID".
const ID_TITLE: RegExp = /(^|[\s}-])ID$/;

const WHITESPACE_RUN: RegExp = /\s+/g;

// Cheap first pass: only files that could hold a dialog or an ID are parsed.
const MENTION: RegExp = /Modal|_id/;

interface Finding {
  file: string;
  line: number;
  text: string;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.includes(entry.name)) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function parseFile(file: string): ts.SourceFile {
  return parse(file, fs.readFileSync(file, "utf8"));
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

function finding(source: ts.SourceFile, node: ts.Node): Finding {
  return {
    file: relative(source.fileName),
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    text: node.getText(source).replace(WHITESPACE_RUN, " ").slice(0, 140),
  };
}

/*
 * Whether a title expression names an ID: a literal ending in "ID", a
 * template whose text ends in "ID", a translator call over such a literal,
 * or a choice between them.
 */
function isIdTitle(expression: ts.Expression): boolean {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return ID_TITLE.test(expression.text.trim());
  }

  if (ts.isTemplateExpression(expression)) {
    const spans: ReadonlyArray<ts.TemplateSpan> = expression.templateSpans;
    const tail: string = spans.length
      ? spans[spans.length - 1]!.literal.text
      : expression.head.text;

    return ID_TITLE.test(tail.trim());
  }

  if (ts.isCallExpression(expression)) {
    const first: ts.Expression | undefined = expression.arguments[0];

    return Boolean(first && isIdTitle(first));
  }

  if (ts.isConditionalExpression(expression)) {
    return isIdTitle(expression.whenTrue) || isIdTitle(expression.whenFalse);
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return isIdTitle(expression.expression);
  }

  return false;
}

// Rule 1: a ConfirmModal or Modal titled "<something> ID".
function findHandMadeIdDialogs(source: ts.SourceFile): Array<Finding> {
  const found: Array<Finding> = [];

  visit(source, (node: ts.Node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
      return;
    }

    if (!DIALOG_COMPONENTS.includes(node.tagName.getText(source))) {
      return;
    }

    for (const attribute of node.attributes.properties) {
      if (
        !ts.isJsxAttribute(attribute) ||
        attribute.name.getText(source) !== "title" ||
        !attribute.initializer
      ) {
        continue;
      }

      const value: ts.Expression | undefined = ts.isStringLiteral(
        attribute.initializer,
      )
        ? attribute.initializer
        : ts.isJsxExpression(attribute.initializer)
          ? attribute.initializer.expression
          : undefined;

      if (value && isIdTitle(value)) {
        found.push(finding(source, node));
      }
    }
  });

  return found;
}

// `x._id`, `x?._id`, `x["_id"]`, `x?.["_id"]`.
function isIdRead(expression: ts.Expression): boolean {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }

  if (ts.isPropertyAccessExpression(current)) {
    return current.name.text === "_id";
  }

  if (ts.isElementAccessExpression(current)) {
    const argument: ts.Expression = current.argumentExpression;

    return (
      (ts.isStringLiteral(argument) ||
        ts.isNoSubstitutionTemplateLiteral(argument)) &&
      argument.text === "_id"
    );
  }

  return false;
}

// Rule 2: `row._id as string`, `<string>row["_id"]`.
function findIdStringCasts(source: ts.SourceFile): Array<Finding> {
  const found: Array<Finding> = [];

  visit(source, (node: ts.Node) => {
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      node.type.kind === ts.SyntaxKind.StringKeyword &&
      isIdRead(node.expression)
    ) {
      found.push(finding(source, node));
    }
  });

  return found;
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return Boolean(
        property.name &&
          (ts.isIdentifier(property.name) ||
            ts.isStringLiteral(property.name)) &&
          property.name.text === name,
      );
    },
  );
}

// The row action BaseModelTable builds for Show ID.
function findShowIdAction(
  source: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  let action: ts.ObjectLiteralExpression | undefined;

  visit(source, (node: ts.Node) => {
    if (action || !ts.isObjectLiteralExpression(node)) {
      return;
    }

    const title: ts.ObjectLiteralElementLike | undefined = propertyNamed(
      node,
      "title",
    );

    if (
      title &&
      ts.isPropertyAssignment(title) &&
      title.initializer.getText(source).replace(WHITESPACE_RUN, "") ===
        'tx("ShowID")'.replace(WHITESPACE_RUN, "")
    ) {
      action = node;
    }
  });

  return action;
}

function textOf(
  source: ts.SourceFile,
  property: ts.ObjectLiteralElementLike | undefined,
): string {
  return property ? property.getText(source).replace(WHITESPACE_RUN, " ") : "";
}

const PARSED: Array<ts.SourceFile> = SCAN_DIRS.flatMap(
  (directory: string): Array<string> => {
    return listSourceFiles(directory);
  },
)
  .filter((file: string): boolean => {
    return MENTION.test(fs.readFileSync(file, "utf8"));
  })
  .map(parseFile);

describe("Show ID: one dialog, and never an object on the page (#4615)", () => {
  test("the scan reads Common's UI and the App's frontends", () => {
    const files: Array<string> = PARSED.map((source: ts.SourceFile) => {
      return relative(source.fileName);
    });

    expect(files.length).toBeGreaterThan(300);
    expect(files).toEqual(
      expect.arrayContaining([
        "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
        "packages/Common/UI/Components/ObjectID/RecordIdModal.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourcePanel.tsx",
        "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Resources.tsx",
        "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbes.tsx",
      ]),
    );

    if (ENTERPRISE_PRESENT) {
      expect(
        files.some((file: string): boolean => {
          return file.startsWith("ee/Dashboard/");
        }),
      ).toBe(true);
    }
  });

  test("no dialog shows a record's ID but RecordIdModal", () => {
    const found: Array<Finding> = PARSED.flatMap(findHandMadeIdDialogs);

    expect(found).toEqual([]);
  });

  test("the shared row components never cast a row's _id to a string", () => {
    const files: Array<string> = SHARED_ROW_DIRS.flatMap(listSourceFiles);

    expect(files.length).toBeGreaterThan(20);

    const found: Array<Finding> = files.flatMap((file: string) => {
      return findIdStringCasts(parseFile(file));
    });

    expect(found).toEqual([]);
  });

  test("BaseModelTable's Show ID reads the ID as text, and only offers it on a row with one", () => {
    const source: ts.SourceFile = parseFile(BASE_MODEL_TABLE);
    const action: ts.ObjectLiteralExpression | undefined =
      findShowIdAction(source);

    expect(action).toBeDefined();

    expect(textOf(source, propertyNamed(action!, "isVisible"))).toContain(
      'hasRecordId(item["_id"])',
    );
    expect(textOf(source, propertyNamed(action!, "onClick"))).toContain(
      'setViewId(getRecordIdText(item["_id"]))',
    );
  });

  test("BaseModelTable opens the shared dialog, with the API Reference page only where there is one", () => {
    const text: string = fs
      .readFileSync(BASE_MODEL_TABLE, "utf8")
      .replace(WHITESPACE_RUN, " ");

    expect(text).toContain(
      'import RecordIdModal from "../ObjectID/RecordIdModal";',
    );
    expect(text).toContain("<RecordIdModal recordId={viewId}");
    expect(text).toContain(
      "apiReferencePagePath={getApiReferencePagePath(model, { isBillingEnabled: BILLING_ENABLED, })}",
    );
    // The dialog it used to draw itself, and the page it always linked to.
    expect(text).not.toContain("ID of this {{itemName}}:");
    expect(text).not.toContain("model.getAPIDocumentationPath()");
  });

  test("RecordIdModal puts on the page only the text it reads from the ID", () => {
    const source: ts.SourceFile = parseFile(RECORD_ID_MODAL);
    const reads: Array<string> = [];

    visit(source, (node: ts.Node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "recordId" &&
        node.expression.getText(source) === "props"
      ) {
        reads.push(node.parent.getText(source));
      }
    });

    expect(reads).toEqual(["getRecordIdText(props.recordId)"]);
  });

  test("the status page's resources and groups open the shared dialog too", () => {
    for (const file of STATUS_PAGE_ID_DIALOGS) {
      const text: string = fs.readFileSync(file, "utf8");

      expect({
        file: relative(file),
        opens: text.includes("<RecordIdModal"),
      }).toEqual({ file: relative(file), opens: true });
    }
  });
});

describe("the guard's own checks", () => {
  test("find a dialog titled with an ID, in every way a title is written", () => {
    const source: ts.SourceFile = parse(
      "Fixture.tsx",
      [
        "const a = <ConfirmModal title={`${name} ID`} onSubmit={f} />;",
        'const b = <ConfirmModal title="Group ID" onSubmit={f} />;',
        'const c = <Modal title={translator.translateTemplate("{{itemName}} ID", {})}><div /></Modal>;',
        'const d = <ConfirmModal title={name ? tx("{{name}} ID") : tx("Group ID")} onSubmit={f} />;',
        'const e = <ConfirmModal title={"Probe-ID"} onSubmit={f} />;',
      ].join("\n"),
    );

    expect(
      findHandMadeIdDialogs(source).map((found: Finding): number => {
        return found.line;
      }),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  test("leave other dialogs alone", () => {
    const source: ts.SourceFile = parse(
      "Fixture.tsx",
      [
        'const a = <ConfirmModal title="Probe Key" onSubmit={f} />;',
        'const b = <ConfirmModal title="Delete Monitor" onSubmit={f} />;',
        'const c = <Modal title={tx("Valid IDs")}><div /></Modal>;',
        'const d = <RecordIdModal recordId={id} itemName="Monitor" onClose={f} />;',
        'const e = <Card title="Monitor ID" />;',
      ].join("\n"),
    );

    expect(findHandMadeIdDialogs(source)).toEqual([]);
  });

  test("find every way a row's _id is cast to a string", () => {
    // A .ts file: in a .tsx one, `<string>x` is read as an element.
    const source: ts.SourceFile = parse(
      "Fixture.ts",
      [
        'setViewId(item["_id"] as string);',
        "setViewId(item._id as string);",
        "setViewId(item?._id as string);",
        'setViewId(<string>item["_id"]);',
        "setViewId((item._id!) as string);",
      ].join("\n"),
    );

    expect(
      findIdStringCasts(source).map((found: Finding): number => {
        return found.line;
      }),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  test("leave reads that keep the ID honest alone", () => {
    const source: ts.SourceFile = parse(
      "Fixture.tsx",
      [
        'setViewId(getRecordIdText(item["_id"]));',
        "setViewId(item._id?.toString() || null);",
        "const id = new ObjectID(getRecordIdText(item._id));",
        'const name = item["name"] as string;',
        "const id = item._id as ObjectID;",
      ].join("\n"),
    );

    expect(findIdStringCasts(source)).toEqual([]);
  });

  test("find BaseModelTable's Show ID action by its title", () => {
    const source: ts.SourceFile = parse(
      "Fixture.tsx",
      [
        "const actions = [",
        '  { title: tx("Edit"), onClick: f },',
        '  { title: tx("Show ID"), isVisible: g, onClick: h },',
        "];",
      ].join("\n"),
    );

    const action: ts.ObjectLiteralExpression | undefined =
      findShowIdAction(source);

    expect(action).toBeDefined();
    expect(textOf(source, propertyNamed(action!, "isVisible"))).toBe(
      "isVisible: g",
    );
  });
});
