// UX rule: Docs/ux/README.md#a-records-overview
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { AUDIT_LOG_EXEMPT_TABLES } from "Common/Types/AuditLog/AuditLogCoverage";

/*
 * "Raw IDs move out of the main detail grids into a small copy line."
 *
 * Some thirty-five details cards led with the record's own ID - a full-width
 * UUID pill, usually the first field, above the record's name. The shared
 * Detail now takes a FieldType.ObjectID field on `_id` out of the grid and
 * draws it as one small "ID" line under the other fields, with a copy button
 * (Common/UI/Components/Detail/DetailIdLine.tsx). Pages declare the field
 * exactly as before, so a page written later gets the line by itself.
 *
 * This keeps it that way across every frontend that shares Detail - the
 * Dashboard, the Admin Dashboard and the enterprise dashboards - and fails
 * on:
 *
 *   1. a details field on the record's own `_id` drawn as anything but
 *      FieldType.ObjectID: with no type it is a raw UUID in the grid, which
 *      is how the incoming call policy page showed it;
 *   2. a page drawing the record's raw ID itself (a getElement field on
 *      `_id` titled "... ID");
 *   3. showIdAsField - the way a card keeps the ID as a field - anywhere but
 *      the cards below, each kept for a reason;
 *   4. the shared Detail no longer moving the ID (the rendering itself is
 *      tested in Common/Tests/UI/Components/Detail).
 *
 * "Can you also show created along the same lines as ID so it doesn't take
 * space up top. Please do this everywhere."
 *
 * So the line carries when the record was created, after the ID - and when
 * it was last updated, on the cards that show that. Detail takes a
 * FieldType.Date or FieldType.DateTime field on `createdAt` or `updatedAt`
 * out of the grid and puts it there (Detail/DetailRecordTime.ts), and this
 * also fails on:
 *
 *   5. a details field on `createdAt` or `updatedAt` that Detail would leave
 *      in the grid - another type, no type, or drawn by the page's own
 *      getElement - which is a Created row of its own again;
 *   6. a details field titled "Created", "Created At", "Updated"... that
 *      reads some other column, a Created row by another road;
 *   7. showRecordLine={false} - a Detail that draws every field as a field -
 *      anywhere but the custom fields card, whose keys people name;
 *   8. the shared Detail no longer putting the times on the line.
 *
 * A resource's Overview drawn with ResourceOverview (a service, a database,
 * a queue, a RUM application, a serverless function, a cloud environment or
 * resource) builds its Details card from rows, not fields, and three of
 * them led with "Service ID", "Database ID" and "Queue ID" rows spelling
 * out all 36 characters (#5298's UI review). The card ends with the same ID
 * line now (ResourceOverview's recordId), so this also fails on:
 *
 *   9. a ResourceOverview Details row whose value is the page's own record
 *      ID, and a page that draws ResourceOverview without giving it the ID
 *      and the record's model type for its line - with the ID alone, the
 *      line never says who created the record or who last modified it
 *      (recordModelType, #10290).
 *
 * "Who created and who last modified a record, on the overviews that draw
 * no record line yet" (#10461): a record's line - its ID, who created it and
 * who last modified it, and its History - ended a details card on most
 * record pages, and fourteen overviews, an API key's page and a dozen more
 * drew none, so they said neither who made the record nor who changed it
 * last. So this also fails on:
 *
 *  10. a record's own page - each Dashboard route drawn with
 *      pageRoute={RouteMap[PageMap.<KEY>_VIEW] as Route} - that draws no
 *      record line: neither its page nor a Dashboard or Common UI component
 *      it imports (followed IMPORT_DEPTH imports deep) has one of the line's
 *      shapes (LineShape): a ModelDetail field on `_id` as
 *      FieldType.ObjectID, or on createdAt or updatedAt as a date - which
 *      makes ModelDetail read who created and last modified the record with
 *      it - a RecordActivityLine, a ResourceRecordDetailsCard, or a
 *      ResourceOverview handed recordModelType. A plain Detail's `key: "_id"`
 *      field is no shape: Detail draws the ID, and reads nobody. A page with
 *      no line for a reason is listed in NO_RECORD_LINE with it, and the list
 *      only shrinks: an entry whose page draws a line fails too.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet"),
  path.join(PACKAGES_DIR, "Common", "UI"),
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
];

/*
 * The App Test job deletes ee/ before it runs (core is the Community Edition
 * by construction), so there only the core cards are read. The Enterprise
 * Edition Test workflow (test.ee.yaml) runs this guard with ee/ present,
 * which is where the enterprise dashboards' cards are held to it.
 */
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
);

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

/*
 * The cards whose point is the ID. Each keeps it as a field, and says why in
 * a comment beside showIdAsField. A new one belongs here only for a reason as
 * good as these.
 */
const ID_AS_FIELD: Record<string, string> = {
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/ProjectSettings.tsx":
    "People come to Project Settings to copy the project ID.",
  "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbeView.tsx":
    "A custom probe is installed with its ID beside its key (PROBE_ID, PROBE_KEY).",
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView.tsx":
    "A Runner is installed with its ID beside its key (ONEUPTIME_RUNNER_ID, ONEUPTIME_RUNNER_KEY).",
};

// A title that names an ID: "Monitor ID", "ID".
const TITLED_AS_AN_ID: RegExp = /\bID$/;

// The columns every record keeps its creation and last update times in.
const RECORD_TIME_COLUMNS: Array<string> = ["createdAt", "updatedAt"];

// The types Detail moves a time on with (DetailRecordTime.ts).
const RECORD_TIME_FIELD_TYPES: Array<string> = [
  "FieldType.Date",
  "FieldType.DateTime",
];

// A title that names the record's creation or update: "Created At".
const TITLED_AS_A_RECORD_TIME: RegExp =
  /^(Created|Updated|Last Updated|Date Created|Creation Date)( At| On| Date)?$/i;

// The same words anywhere in a file, for the scan's cheap first pass.
const TITLED_AS_A_RECORD_TIME_ANYWHERE: RegExp =
  /(Created|Updated|Creation Date)/i;

/*
 * The Details that draw every field as a field, with no line under them.
 * Each says why in a comment beside showRecordLine={false}.
 */
const RECORD_LINE_OFF: Record<string, string> = {
  "packages/Common/UI/Components/CustomFields/CustomFieldsDetail.tsx":
    "A record's custom fields are named by people: one called createdAt is theirs, not the record's own creation time.",
};

interface IdField {
  // Relative to the repository root, with forward slashes.
  file: string;
  line: number;
  title: string;
  // The fieldType initializer as written, "" when there is none.
  fieldType: string;
  hasGetElement: boolean;
  showIdAsField: boolean;
  /*
   * Read as `field: { _id: true }`, the way ModelDetail reads a field - and
   * so who created and last modified the record with it - rather than as a
   * plain Detail's `key: "_id"`.
   */
  isModelDetailField: boolean;
}

interface TimeField {
  // Relative to the repository root, with forward slashes.
  file: string;
  line: number;
  title: string;
  // The column read: createdAt or updatedAt, or "" for another one.
  column: string;
  // The fieldType initializer as written, "" when there is none.
  fieldType: string;
  hasGetElement: boolean;
  // Read as `field: { createdAt: true }`, the way ModelDetail reads one.
  isModelDetailField: boolean;
}

interface Use {
  file: string;
  line: number;
}

/*
 * The elements that draw a record's line by hand, wherever they are drawn,
 * with the names of the attributes they are handed.
 */
interface LineElement {
  tag: string;
  attributes: Array<string>;
}

const LINE_ELEMENT_TAGS: Array<string> = [
  "RecordActivityLine",
  "ResourceRecordDetailsCard",
  "ResourceOverview",
];

interface ScannedSource {
  idFields: Array<IdField>;
  showIdAsFieldUses: Array<Use>;
  timeFields: Array<TimeField>;
  recordLineOffUses: Array<Use>;
  lineElements: Array<LineElement>;
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

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    property.name &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  ) {
    return property.name.text;
  }

  return null;
}

function findProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) && propertyName(property) === name
      );
    },
  ) as ts.PropertyAssignment | undefined;
}

function hasMember(object: ts.ObjectLiteralExpression, name: string): boolean {
  return object.properties.some(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return propertyName(property) === name;
    },
  );
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

/*
 * The one column a field reads: `field: { _id: true }` (ModelDetail) or
 * `key: "_id"` (Detail). "" for a field that reads several, or none.
 */
function onlyColumnSelected(object: ts.ObjectLiteralExpression): string {
  const field: ts.PropertyAssignment | undefined = findProperty(
    object,
    "field",
  );

  if (field) {
    const select: ts.Expression = unwrap(field.initializer);

    if (
      ts.isObjectLiteralExpression(select) &&
      select.properties.length === 1 &&
      ts.isPropertyAssignment(select.properties[0]!) &&
      (select.properties[0] as ts.PropertyAssignment).initializer.kind ===
        ts.SyntaxKind.TrueKeyword
    ) {
      return propertyName(select.properties[0]!) || "";
    }

    return "";
  }

  const key: ts.PropertyAssignment | undefined = findProperty(object, "key");

  if (key && ts.isStringLiteral(unwrap(key.initializer))) {
    return (unwrap(key.initializer) as ts.StringLiteral).text;
  }

  return "";
}

// A field that reads the record's own ID and nothing else.
function selectsOnlyTheRecordId(object: ts.ObjectLiteralExpression): boolean {
  return onlyColumnSelected(object) === "_id";
}

function titleOf(
  object: ts.ObjectLiteralExpression,
  source: ts.SourceFile,
): string {
  const title: ts.PropertyAssignment | undefined = findProperty(
    object,
    "title",
  );
  const titleExpression: ts.Expression | undefined = title
    ? unwrap(title.initializer)
    : undefined;

  if (!titleExpression) {
    return "";
  }

  return ts.isStringLiteral(titleExpression) ||
    ts.isNoSubstitutionTemplateLiteral(titleExpression)
    ? titleExpression.text
    : titleExpression.getText(source);
}

// Whether a file could hold anything the scan reads: the cheap first pass.
function mayHoldARecordLine(text: string): boolean {
  return (
    text.includes("_id") ||
    text.includes("showIdAsField") ||
    text.includes("createdAt") ||
    text.includes("updatedAt") ||
    text.includes("showRecordLine") ||
    TITLED_AS_A_RECORD_TIME_ANYWHERE.test(text) ||
    LINE_ELEMENT_TAGS.some((tag: string): boolean => {
      return text.includes(tag);
    })
  );
}

/*
 * What one source file holds of the record line: its ID and time fields, its
 * switches, and the elements that draw the line by hand. `file` is how the
 * findings name it (relative to the repository); `fileName` says whether it
 * is TSX.
 */
function scanSource(
  file: string,
  text: string,
  fileName: string,
): ScannedSource {
  const scanned: ScannedSource = {
    idFields: [],
    showIdAsFieldUses: [],
    timeFields: [],
    recordLineOffUses: [],
    lineElements: [],
  };

  if (!mayHoldARecordLine(text)) {
    return scanned;
  }

  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // <RecordActivityLine ... />, <ResourceOverview ...>
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      LINE_ELEMENT_TAGS.includes(node.tagName.getText(source))
    ) {
      scanned.lineElements.push({
        tag: node.tagName.getText(source),
        attributes: node.attributes.properties
          .filter((property: ts.JsxAttributeLike): boolean => {
            return ts.isJsxAttribute(property);
          })
          .map((property: ts.JsxAttributeLike): string => {
            return (property as ts.JsxAttribute).name.getText(source);
          }),
      });
    }

    // <Detail showRecordLine={false} />
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "showRecordLine" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      unwrap(node.initializer.expression).kind === ts.SyntaxKind.FalseKeyword
    ) {
      scanned.recordLineOffUses.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }

    if (ts.isObjectLiteralExpression(node)) {
      const line: number =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

      // { ...props, showRecordLine: false }
      const lineOff: ts.PropertyAssignment | undefined = findProperty(
        node,
        "showRecordLine",
      );

      if (
        lineOff &&
        unwrap(lineOff.initializer).kind === ts.SyntaxKind.FalseKeyword
      ) {
        scanned.recordLineOffUses.push({ file: file, line });
      }

      const optOut: ts.PropertyAssignment | undefined = findProperty(
        node,
        "showIdAsField",
      );

      if (optOut) {
        scanned.showIdAsFieldUses.push({ file: file, line });
      }

      const fieldType: ts.PropertyAssignment | undefined = findProperty(
        node,
        "fieldType",
      );
      const fieldTypeText: string = fieldType
        ? unwrap(fieldType.initializer).getText(source)
        : "";
      const isModelDetailField: boolean = Boolean(findProperty(node, "field"));

      if (
        selectsOnlyTheRecordId(node) &&
        // A table column or a filter, which name their type `type`.
        !hasMember(node, "type") &&
        // A form field.
        !fieldTypeText.startsWith("FormFieldSchemaType")
      ) {
        const title: ts.PropertyAssignment | undefined = findProperty(
          node,
          "title",
        );
        const titleExpression: ts.Expression | undefined = title
          ? unwrap(title.initializer)
          : undefined;

        scanned.idFields.push({
          file: file,
          line,
          title: titleExpression
            ? ts.isStringLiteral(titleExpression)
              ? titleExpression.text
              : titleExpression.getText(source)
            : "",
          fieldType: fieldTypeText,
          hasGetElement: hasMember(node, "getElement"),
          showIdAsField: Boolean(
            optOut &&
              unwrap(optOut.initializer).kind === ts.SyntaxKind.TrueKeyword,
          ),
          isModelDetailField,
        });
      }

      /*
       * A details field that reads the record's creation or update time,
       * or is titled as one: it has a title and reads a column, and is
       * neither a table column or filter (`type`), a resource table's
       * column (`getValue`) nor a form field.
       */
      const column: string = onlyColumnSelected(node);
      const title: string = titleOf(node, source);
      const readsAColumn: boolean =
        hasMember(node, "field") || hasMember(node, "key");

      if (
        title &&
        readsAColumn &&
        !hasMember(node, "type") &&
        !hasMember(node, "getValue") &&
        !fieldTypeText.startsWith("FormFieldSchemaType") &&
        (RECORD_TIME_COLUMNS.includes(column) ||
          TITLED_AS_A_RECORD_TIME.test(title.trim()))
      ) {
        scanned.timeFields.push({
          file: file,
          line,
          title,
          column: RECORD_TIME_COLUMNS.includes(column) ? column : "",
          fieldType: fieldTypeText,
          hasGetElement: hasMember(node, "getElement"),
          isModelDetailField,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return scanned;
}

function scan(): ScannedSource {
  const all: ScannedSource = {
    idFields: [],
    showIdAsFieldUses: [],
    timeFields: [],
    recordLineOffUses: [],
    lineElements: [],
  };

  const files: Array<string> = SCAN_DIRS.flatMap(
    (directory: string): Array<string> => {
      return listSourceFiles(directory);
    },
  );

  for (const file of files) {
    const scanned: ScannedSource = scanSource(
      relative(file),
      fs.readFileSync(file, "utf8"),
      file,
    );

    all.idFields.push(...scanned.idFields);
    all.showIdAsFieldUses.push(...scanned.showIdAsFieldUses);
    all.timeFields.push(...scanned.timeFields);
    all.recordLineOffUses.push(...scanned.recordLineOffUses);
  }

  return all;
}

const { idFields, showIdAsFieldUses, timeFields, recordLineOffUses } = scan();

function describeField(field: IdField): string {
  return `${field.file}:${field.line} "${field.title}" (${
    field.fieldType || "no fieldType"
  })`;
}

describe("the record's own ID on details cards", () => {
  test("the scan finds the cards it is about", () => {
    // Thirty-odd overview and settings cards, across all three dashboards.
    expect(idFields.length).toBeGreaterThanOrEqual(35);

    const titlesByFile: Array<string> = idFields.map(
      (field: IdField): string => {
        return `${field.file} ${field.title}`;
      },
    );

    expect(titlesByFile).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Index.tsx Status Page ID",
        "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Index.tsx On-Call Policy ID",
        "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index.tsx Incident ID",
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewDetailsCard.tsx Monitor ID",
        "packages/App/FeatureSet/Dashboard/src/Pages/Users/View/Index.tsx User ID",
        "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Index.tsx Project ID",
      ]),
    );
    // The Community Edition checkout has no ee/, and must still pass.
    expect(
      titlesByFile.includes(
        "ee/AdminDashboard/EnterpriseLicenses/Pages/View/Index.tsx License ID",
      ),
    ).toBe(ENTERPRISE_PRESENT);
  });

  test("is an ObjectID field, so Detail draws it on the ID line instead of the grid", () => {
    const rawIds: Array<string> = idFields
      .filter((field: IdField): boolean => {
        return !field.hasGetElement && field.fieldType !== "FieldType.ObjectID";
      })
      .map(describeField);

    expect(rawIds).toEqual([]);
  });

  test("is never drawn raw by the page itself", () => {
    const drawnByPage: Array<string> = idFields
      .filter((field: IdField): boolean => {
        return field.hasGetElement && TITLED_AS_AN_ID.test(field.title.trim());
      })
      .map(describeField);

    expect(drawnByPage).toEqual([]);
  });
});

describe("cards that keep the ID as a field", () => {
  test("are only the ones whose point is the ID", () => {
    const files: Array<string> = Array.from(
      new Set(
        showIdAsFieldUses.map((use: { file: string }): string => {
          return use.file;
        }),
      ),
    ).sort();

    expect(files).toEqual(Object.keys(ID_AS_FIELD).sort());
  });

  test("keep one field each, the record's own ID", () => {
    for (const file of Object.keys(ID_AS_FIELD)) {
      const uses: Array<{ file: string; line: number }> =
        showIdAsFieldUses.filter((use: { file: string }): boolean => {
          return use.file === file;
        });
      const kept: Array<IdField> = idFields.filter(
        (field: IdField): boolean => {
          return field.file === file && field.showIdAsField;
        },
      );

      expect({ file, uses: uses.length }).toEqual({ file, uses: 1 });
      expect({ file, kept: kept.length }).toEqual({ file, kept: 1 });
      expect(kept[0]!.fieldType).toBe("FieldType.ObjectID");
    }
  });

  test("say why, beside the flag", () => {
    for (const file of Object.keys(ID_AS_FIELD)) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_DIR, file),
        "utf8",
      );
      const flagAt: number = source.indexOf("showIdAsField: true");
      const commentEnd: number = source.lastIndexOf("*/", flagAt);
      const fieldStart: number = source.lastIndexOf("field:", flagAt);

      // A block comment between the field's start and the flag.
      expect({ file, explained: commentEnd > fieldStart }).toEqual({
        file,
        explained: true,
      });
    }
  });
});

describe("the shared Detail", () => {
  const detail: string = fs.readFileSync(
    path.join(
      PACKAGES_DIR,
      "Common",
      "UI",
      "Components",
      "Detail",
      "Detail.tsx",
    ),
    "utf8",
  );

  const recordLine: string = fs.readFileSync(
    path.join(
      PACKAGES_DIR,
      "Common",
      "UI",
      "Components",
      "Detail",
      "DetailRecordLine.tsx",
    ),
    "utf8",
  );

  test("moves the record's ID to its ID line", () => {
    expect(detail).toContain(
      'import { getRecordIdText, isRecordIdField } from "./DetailRecordId";',
    );
    expect(detail).toContain(
      'import DetailRecordLine from "./DetailRecordLine";',
    );
    expect(detail).toMatch(/<DetailRecordLine\s+recordId=\{recordId\}/);
    expect(recordLine).toContain('import DetailIdLine from "./DetailIdLine";');
    expect(recordLine).toMatch(/<DetailIdLine\s+recordId=\{props\.recordId\}/);
  });

  test("moves the record's creation and update times to the same line", () => {
    expect(detail).toMatch(
      /import \{\s*getRecordTimes,\s*isRecordTimeField,\s*RecordTime,\s*\} from "\.\/DetailRecordTime";/,
    );
    expect(detail).toMatch(
      /<DetailRecordLine\s+recordId=\{recordId\}\s+times=\{recordTimes\}/,
    );
    // Neither is left for the grid to draw.
    expect(detail).toMatch(
      /isRecordIdField\(field\) \|\| isRecordTimeField\(field\)/,
    );
  });
});

describe("when the record was created and last updated, on details cards", () => {
  test("the scan finds the cards it is about", () => {
    const createdAndUpdated: Array<TimeField> = timeFields.filter(
      (field: TimeField): boolean => {
        return field.column !== "";
      },
    );

    // A dozen-odd overview, settings and template cards.
    expect(createdAndUpdated.length).toBeGreaterThanOrEqual(13);

    const titlesByFile: Array<string> = createdAndUpdated.map(
      (field: TimeField): string => {
        return `${field.file} ${field.column} ${field.title}`;
      },
    );

    expect(titlesByFile).toEqual(
      expect.arrayContaining([
        // The card in the screenshot: a Created row above the ID line.
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewDetailsCard.tsx createdAt Created",
        "packages/App/FeatureSet/Dashboard/src/Pages/Alerts/View/Index.tsx createdAt Created At",
        "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Index.tsx createdAt Created At",
        "packages/App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/Index.tsx createdAt Created At",
        "packages/App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index.tsx createdAt Created At",
        "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/AnnouncementView.tsx updatedAt Updated",
      ]),
    );
    // The Community Edition checkout has no ee/, and must still pass.
    expect(
      titlesByFile.includes(
        "ee/AdminDashboard/EnterpriseLicenses/Pages/View/Index.tsx createdAt Issued On",
      ),
    ).toBe(ENTERPRISE_PRESENT);
  });

  test("is a Date or DateTime field, so Detail draws it on the ID line instead of the grid", () => {
    const rows: Array<string> = timeFields
      .filter((field: TimeField): boolean => {
        return (
          field.column !== "" &&
          (field.hasGetElement ||
            !RECORD_TIME_FIELD_TYPES.includes(field.fieldType))
        );
      })
      .map((field: TimeField): string => {
        return `${field.file}:${field.line} "${field.title}" (${
          field.fieldType || "no fieldType"
        }${field.hasGetElement ? ", getElement" : ""})`;
      });

    expect(rows).toEqual([]);
  });

  test("is never a Created row read from another column", () => {
    const rows: Array<string> = timeFields
      .filter((field: TimeField): boolean => {
        return field.column === "";
      })
      .map((field: TimeField): string => {
        return `${field.file}:${field.line} "${field.title}"`;
      });

    expect(rows).toEqual([]);
  });

  test("the title check knows a Created row when it sees one", () => {
    for (const title of [
      "Created",
      "Created At",
      "Created On",
      "Updated",
      "Updated At",
      "Last Updated",
      "Date Created",
      "Creation Date",
    ]) {
      expect({ title, matches: TITLED_AS_A_RECORD_TIME.test(title) }).toEqual({
        title,
        matches: true,
      });
    }

    // Who, not when; and the record's own facts.
    for (const title of [
      "Created By",
      "Created by User",
      "Declared At",
      "Starts At",
      "Issued On",
    ]) {
      expect({ title, matches: TITLED_AS_A_RECORD_TIME.test(title) }).toEqual({
        title,
        matches: false,
      });
    }
  });
});

/*
 * Rule 9: the pages that draw ResourceOverview, and every Details row they
 * write (an object with a label and a value).
 */
const DRAWS_RESOURCE_OVERVIEW: RegExp = /<ResourceOverview[\s/>]/;

interface OverviewRow {
  file: string;
  line: number;
  label: string;
  value: string;
}

function scanResourceOverviews(): {
  pages: Array<string>;
  rows: Array<OverviewRow>;
  pagesWithoutRecordId: Array<string>;
  pagesWithoutRecordModelType: Array<string>;
} {
  const pages: Array<string> = [];
  const rows: Array<OverviewRow> = [];
  const pagesWithoutRecordId: Array<string> = [];
  const pagesWithoutRecordModelType: Array<string> = [];

  const files: Array<string> = listSourceFiles(
    path.join(PACKAGES_DIR, "App", "FeatureSet", "Dashboard", "src", "Pages"),
  );

  for (const file of files) {
    const text: string = fs.readFileSync(file, "utf8");

    // Not the detail pages' ResourceOverviewTab, a different component.
    if (!DRAWS_RESOURCE_OVERVIEW.test(text)) {
      continue;
    }

    pages.push(relative(file));

    const source: ts.SourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    let givesRecordId: boolean = false;
    let givesRecordModelType: boolean = false;

    const givesAttribute: (
      node: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
      name: string,
    ) => boolean = (
      node: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
      name: string,
    ): boolean => {
      return node.attributes.properties.some(
        (property: ts.JsxAttributeLike): boolean => {
          return (
            ts.isJsxAttribute(property) &&
            property.name.getText(source) === name
          );
        },
      );
    };

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText(source) === "ResourceOverview"
      ) {
        givesRecordId = givesAttribute(node, "recordId");
        givesRecordModelType = givesAttribute(node, "recordModelType");
      }

      if (
        ts.isObjectLiteralExpression(node) &&
        hasMember(node, "label") &&
        hasMember(node, "value")
      ) {
        const label: ts.PropertyAssignment | undefined = findProperty(
          node,
          "label",
        );
        const value: ts.PropertyAssignment | undefined = findProperty(
          node,
          "value",
        );

        if (label && value) {
          const labelExpression: ts.Expression = unwrap(label.initializer);
          rows.push({
            file: relative(file),
            line:
              source.getLineAndCharacterOfPosition(node.getStart(source)).line +
              1,
            label: ts.isStringLiteral(labelExpression)
              ? labelExpression.text
              : labelExpression.getText(source),
            value: unwrap(value.initializer).getText(source),
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    if (!givesRecordId) {
      pagesWithoutRecordId.push(relative(file));
    }

    if (!givesRecordModelType) {
      pagesWithoutRecordModelType.push(relative(file));
    }
  }

  return { pages, rows, pagesWithoutRecordId, pagesWithoutRecordModelType };
}

// The page's own record ID, as the Overview pages read it.
const OWN_RECORD_ID: RegExp = /\bmodelId(String)?\b/;

describe("the record's own ID on a resource Overview's Details card", () => {
  const scanned: {
    pages: Array<string>;
    rows: Array<OverviewRow>;
    pagesWithoutRecordId: Array<string>;
    pagesWithoutRecordModelType: Array<string>;
  } = scanResourceOverviews();

  test("the scan finds the Overviews it is about, and their rows", () => {
    expect(scanned.pages).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Dashboard/src/Pages/Service/View/Index.tsx",
        "packages/App/FeatureSet/Dashboard/src/Pages/Database/View/Overview.tsx",
        "packages/App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Overview.tsx",
        "packages/App/FeatureSet/Dashboard/src/Pages/Rum/View/Overview.tsx",
        "packages/App/FeatureSet/Dashboard/src/Pages/Serverless/View/Overview.tsx",
        "packages/App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/Overview.tsx",
        "packages/App/FeatureSet/Dashboard/src/Pages/Cloud/View/MonitoredResourceOverview.tsx",
      ]),
    );
    // Technology, Runtime, Engine...: the rows are read.
    expect(scanned.rows.length).toBeGreaterThan(30);
    expect(
      scanned.rows.some((row: OverviewRow): boolean => {
        return row.label === "Technology";
      }),
    ).toBe(true);
  });

  test("no row spells out the page's own record ID: it is the card's ID line", () => {
    const offenders: Array<string> = scanned.rows
      .filter((row: OverviewRow): boolean => {
        return OWN_RECORD_ID.test(row.value);
      })
      .map((row: OverviewRow): string => {
        return `${row.file}:${row.line} ${row.label}: ${row.value}`;
      });

    expect(offenders).toEqual([]);
  });

  test("every Overview gives ResourceOverview its record ID for the line", () => {
    expect(scanned.pagesWithoutRecordId).toEqual([]);
  });

  test("and the record's model type, so the line says who created it and who last modified it", () => {
    expect(scanned.pagesWithoutRecordModelType).toEqual([]);
  });

  test("the rule knows a row that spells out the ID when it sees one", () => {
    expect(OWN_RECORD_ID.test("modelId.toString()")).toBe(true);
    expect(OWN_RECORD_ID.test("modelIdString")).toBe(true);
    expect(OWN_RECORD_ID.test("r.cloudAccountId")).toBe(false);
    expect(OWN_RECORD_ID.test("q.queueIdentifier")).toBe(false);
  });
});

describe("Details that switch the line off", () => {
  test("are only the custom fields card", () => {
    const files: Array<string> = Array.from(
      new Set(
        recordLineOffUses.map((use: Use): string => {
          return use.file;
        }),
      ),
    ).sort();

    expect(files).toEqual(Object.keys(RECORD_LINE_OFF).sort());
  });

  test("say why, beside the switch", () => {
    for (const file of Object.keys(RECORD_LINE_OFF)) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_DIR, file),
        "utf8",
      );
      const switchAt: number = source.indexOf("showRecordLine={false}");
      const commentEnd: number = source.lastIndexOf("*/", switchAt);
      const tagStart: number = source.lastIndexOf("<Detail", switchAt);

      expect({ file, found: switchAt > -1 }).toEqual({ file, found: true });
      // A block comment between the tag's start and the switch.
      expect({ file, explained: commentEnd > tagStart }).toEqual({
        file,
        explained: true,
      });
    }
  });
});

/*
 * Rule 10 (#10461): every record's own page draws the record's line.
 */

const DASHBOARD_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);
const COMMON_DIR: string = path.join(PACKAGES_DIR, "Common");
const COMMON_UI_COMPONENTS: string = path.join(COMMON_DIR, "UI", "Components");

/*
 * How many imports deep the sweep follows a page to the card that draws its
 * line: a label rule's page draws it three down (its rules table, the rule's
 * view, Common's RuleRun/RuleView).
 */
const IMPORT_DEPTH: number = 4;

// A record's own page: the route its key names a view (MONITOR_VIEW).
const RECORD_PAGE_KEY: RegExp = /^[A-Z0-9_]+_VIEW$/;

/*
 * What a view's catch-all route draws for an address under it that names
 * no page: not the record's page, so no line of its own.
 */
const NOT_A_RECORD_PAGE_ELEMENTS: Array<string> = ["PageNotFound"];

// The shapes a record's line is drawn in.
enum LineShape {
  RecordIdField = "a ModelDetail field on _id as FieldType.ObjectID",
  RecordTimeField = "a ModelDetail field on createdAt or updatedAt as a date",
  RecordActivityLine = "RecordActivityLine",
  ResourceRecordDetailsCard = "ResourceRecordDetailsCard",
  ResourceOverview = "ResourceOverview handed recordModelType",
}

// The shapes of the line in a source file.
function getLineShapes(scanned: ScannedSource): Array<LineShape> {
  const shapes: Set<LineShape> = new Set<LineShape>();

  for (const field of scanned.idFields) {
    if (
      field.isModelDetailField &&
      field.fieldType === "FieldType.ObjectID" &&
      !field.hasGetElement &&
      !field.showIdAsField
    ) {
      shapes.add(LineShape.RecordIdField);
    }
  }

  for (const field of scanned.timeFields) {
    if (
      field.isModelDetailField &&
      field.column !== "" &&
      RECORD_TIME_FIELD_TYPES.includes(field.fieldType) &&
      !field.hasGetElement
    ) {
      shapes.add(LineShape.RecordTimeField);
    }
  }

  for (const element of scanned.lineElements) {
    if (element.tag === "RecordActivityLine") {
      shapes.add(LineShape.RecordActivityLine);
    } else if (element.tag === "ResourceRecordDetailsCard") {
      shapes.add(LineShape.ResourceRecordDetailsCard);
    } else if (
      element.tag === "ResourceOverview" &&
      element.attributes.includes("recordModelType")
    ) {
      shapes.add(LineShape.ResourceOverview);
    }
  }

  return Array.from(shapes);
}

const shapesByFile: Map<string, Array<LineShape>> = new Map<
  string,
  Array<LineShape>
>();
const importsByFile: Map<string, Array<string>> = new Map<
  string,
  Array<string>
>();

function getFileLineShapes(file: string): Array<LineShape> {
  let shapes: Array<LineShape> | undefined = shapesByFile.get(file);

  if (!shapes) {
    shapes = getLineShapes(
      scanSource(relative(file), fs.readFileSync(file, "utf8"), file),
    );
    shapesByFile.set(file, shapes);
  }

  return shapes;
}

// A module a file names, as a source file of its own, or null.
function resolveModule(fromFile: string, specifier: string): string | null {
  let base: string;

  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("Common/")) {
    base = path.join(COMMON_DIR, specifier.slice("Common/".length));
  } else {
    // A package's: react, an icon set, the Enterprise plugins.
    return null;
  }

  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "Index.tsx"),
    path.join(base, "Index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

// What a file imports, re-exports and imports lazily, of the code it draws.
function getImports(file: string): Array<string> {
  let imports: Array<string> | undefined = importsByFile.get(file);

  if (!imports) {
    const text: string = fs.readFileSync(file, "utf8");
    const specifiers: Array<string> = [];

    for (const match of text.matchAll(
      /\b(?:import|export)\b[^;"'`]*?\bfrom\s*"([^"]+)"/g,
    )) {
      specifiers.push(match[1]!);
    }

    for (const match of text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) {
      specifiers.push(match[1]!);
    }

    imports = specifiers
      .map((specifier: string): string | null => {
        return resolveModule(file, specifier);
      })
      .filter((resolved: string | null): resolved is string => {
        return (
          resolved !== null &&
          (resolved.startsWith(DASHBOARD_SRC + path.sep) ||
            resolved.startsWith(COMMON_UI_COMPONENTS + path.sep))
        );
      });
    importsByFile.set(file, imports);
  }

  return imports;
}

// The files a page draws its line in: itself, or what it imports.
function findLineDrawers(page: string): Array<string> {
  const drawers: Array<string> = [];
  const seen: Set<string> = new Set<string>([page]);
  let layer: Array<string> = [page];

  for (let depth: number = 0; depth <= IMPORT_DEPTH; depth++) {
    const next: Array<string> = [];

    for (const file of layer) {
      if (getFileLineShapes(file).length > 0) {
        drawers.push(relative(file));
      }

      if (depth < IMPORT_DEPTH) {
        for (const imported of getImports(file)) {
          if (!seen.has(imported)) {
            seen.add(imported);
            next.push(imported);
          }
        }
      }
    }

    layer = next;
  }

  return drawers;
}

// React's lazy(), as a routes file calls it: lazy(...) or React.lazy(...).
const LAZY_CALL: RegExp = /(^|\.)lazy$/;

interface RoutedPage {
  key: string;
  // The routes file, relative to the repository.
  routes: string;
  // The element the route draws.
  element: string;
  // Its source, or null when its import was not found.
  file: string | null;
}

/*
 * Every route of the Dashboard that hands its page `pageRoute=
 * {RouteMap[PageMap.<KEY>] as Route}`, read from the routes files' syntax:
 * the element it draws, and the file that element is imported from - a
 * default import, or a lazy one.
 */
function scanRoutedPages(): Array<RoutedPage> {
  const pages: Array<RoutedPage> = [];
  const routesDirectory: string = path.join(DASHBOARD_SRC, "Routes");

  for (const name of fs.readdirSync(routesDirectory).sort()) {
    if (!name.endsWith(".tsx")) {
      continue;
    }

    const routesFile: string = path.join(routesDirectory, name);
    const source: ts.SourceFile = ts.createSourceFile(
      routesFile,
      fs.readFileSync(routesFile, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const importedFrom: Map<string, string> = new Map<string, string>();
    const routed: Array<{ key: string; element: string }> = [];

    const findLazyImport: (node: ts.Node) => string | null = (
      node: ts.Node,
    ): string | null => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        return node.arguments[0].text;
      }

      return ts.forEachChild(node, findLazyImport) || null;
    };

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      // import ProjectSettings from "../Pages/Settings/ProjectSettings";
      if (
        ts.isImportDeclaration(node) &&
        node.importClause?.name &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        importedFrom.set(
          node.importClause.name.text,
          node.moduleSpecifier.text,
        );
      }

      // const DangerZone = lazy(() => { return import("..."); });
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        LAZY_CALL.test(node.initializer.expression.getText(source))
      ) {
        const specifier: string | null = findLazyImport(node.initializer);

        if (specifier) {
          importedFrom.set(node.name.text, specifier);
        }
      }

      // <ProjectSettings pageRoute={RouteMap[PageMap.SETTINGS] as Route} />
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(source) === "pageRoute" &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        const routeExpression: ts.Expression = unwrap(
          node.initializer.expression,
        );

        if (
          ts.isElementAccessExpression(routeExpression) &&
          routeExpression.expression.getText(source) === "RouteMap" &&
          ts.isPropertyAccessExpression(routeExpression.argumentExpression) &&
          routeExpression.argumentExpression.expression.getText(source) ===
            "PageMap"
        ) {
          const element: ts.Node = node.parent.parent;

          if (
            ts.isJsxSelfClosingElement(element) ||
            ts.isJsxOpeningElement(element)
          ) {
            routed.push({
              key: routeExpression.argumentExpression.name.text,
              element: element.tagName.getText(source),
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    for (const route of routed) {
      const specifier: string | undefined = importedFrom.get(route.element);

      pages.push({
        key: route.key,
        routes: relative(routesFile),
        element: route.element,
        file: specifier ? resolveModule(routesFile, specifier) : null,
      });
    }
  }

  return pages;
}

/*
 * The record pages that draw no line, each with why. Not records anyone
 * creates or changes - telemetry, what an agent reports, a log of what
 * OneUptime did, kinds the audit log does not keep (exemptTable) - a record
 * whose line is on another of its pages (lineOn: that page draws it), one
 * drawn by the Enterprise plugin (lineDrawnBy: checked where ee/ is
 * present), and the pages still to draw (stillToDraw: the issue that
 * will). The list only shrinks.
 */
interface NoRecordLine {
  reason: string;
  exemptTable?: string | undefined;
  lineOn?: string | undefined;
  lineDrawnBy?: string | undefined;
  stillToDraw?: number | undefined;
}

const AI_INSIGHT: NoRecordLine = {
  reason:
    "An insight is what OneUptime AI reported: no record anyone creates or changes, and the audit log keeps none.",
  exemptTable: "AIInsight",
};

const TELEMETRY: string =
  "Telemetry an app or an agent sent, kept in the telemetry store: no record anyone creates or changes.";

const DROP_FILTER_STILL_TO_DRAW: NoRecordLine = {
  reason:
    "Still to draw, once PR #10694 - which changes this page - has merged (#10728).",
  stillToDraw: 10728,
};

const NO_RECORD_LINE: Record<string, NoRecordLine> = {
  AI_INSIGHT_VIEW: AI_INSIGHT,
  EXCEPTIONS_AI_INSIGHT_VIEW: AI_INSIGHT,
  LOGS_AI_INSIGHT_VIEW: AI_INSIGHT,
  METRICS_AI_INSIGHT_VIEW: AI_INSIGHT,
  PROFILES_AI_INSIGHT_VIEW: AI_INSIGHT,
  TRACES_AI_INSIGHT_VIEW: AI_INSIGHT,
  DATA_SECURITY_IDENTITY_VIEW: {
    reason:
      "An identity is what Data Security's scans found of who can reach a store: nobody creates or edits one.",
    exemptTable: "DataSecurityIdentity",
  },
  CODE_TASK_VIEW: {
    reason:
      "A code task is a run of OneUptime AI, drawn as its conversation: a record of a run, which the audit log does not keep.",
    exemptTable: "AIRun",
  },
  ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOG_VIEW: {
    reason: "A call's log: what OneUptime did with an incoming call.",
    exemptTable: "IncomingCallLog",
  },
  ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW: {
    reason: "An escalation's log: what the on-call policy did when it ran.",
    exemptTable: "OnCallDutyPolicyExecutionLog",
  },
  TRACE_VIEW: { reason: TELEMETRY },
  METRIC_VIEW: { reason: TELEMETRY },
  PROFILE_VIEW: { reason: TELEMETRY },
  LLM_CONVERSATION_VIEW: { reason: TELEMETRY },
  RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW: { reason: TELEMETRY },
  HOST_VIEW_PROCESS_VIEW: {
    reason:
      "A process the host's agent reports running on it: no record anyone creates or changes.",
  },
  HOST_VIEW_SERVICE_VIEW: {
    reason:
      "A service the host's agent reports running on it: no record anyone creates or changes.",
  },
  HOST_VIEW_SYSTEMD_UNIT_VIEW: {
    reason:
      "A systemd unit the host's agent reports: no record anyone creates or changes.",
  },
  SECURITY_EVENTS_ENTITY_RISK_VIEW: {
    reason:
      "An entity's risk is OneUptime's running score from its detections, opened by the entity it is about (its type and value), not by a record's ID.",
  },
  USER_VIEW: {
    reason:
      "A person's account is no project's record: the person made it, and the project's audit log keeps nothing of it. Its card draws the ID alone (a plain Detail's key \"_id\").",
  },
  DASHBOARD_VIEW: {
    reason:
      "A dashboard opens on its canvas, which is the dashboard itself; its line is on its Overview.",
    lineOn: "DASHBOARD_VIEW_OVERVIEW",
  },
  CODE_REPOSITORY_VIEW: {
    reason:
      "A repository opens on its tasks; its details, and its line, are on its Settings.",
    lineOn: "CODE_REPOSITORY_VIEW_SETTINGS",
  },
  TEAM_ROLE_VIEW: {
    reason:
      "A custom role's page is the Enterprise plugin's (TeamRoleView), whose details card ends with the line; core's page only hands it over.",
    lineDrawnBy: "ee/Dashboard/CustomRoles/RoleViewPage.tsx",
  },
  LOGS_SETTINGS_DROP_FILTER_VIEW: DROP_FILTER_STILL_TO_DRAW,
  TRACES_SETTINGS_DROP_FILTER_VIEW: DROP_FILTER_STILL_TO_DRAW,
  FORM_VIEW: {
    reason:
      "Still to draw: a form opens on its builder, which has no details card of the form (#10728).",
    stillToDraw: 10728,
  },
};

/*
 * The overviews #10461 named, and the record pages it left out that drew
 * no line either, with the file each draws its line in now.
 */
const DRAWN_SINCE_10461: Record<string, string> = {
  DATA_OBSERVABILITY_TABLE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/DataObservability/TableView/Overview.tsx",
  DATA_OBSERVABILITY_STORE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/DataObservability/View/Overview.tsx",
  DATA_OBSERVABILITY_PIPELINE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/DataPipeline/View/Overview.tsx",
  DATA_OBSERVABILITY_DATA_PRODUCT_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/DataProduct/View/Overview.tsx",
  DATA_SECURITY_STORE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/Overview.tsx",
  DATA_SECURITY_ISSUE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/DataSecurity/IssueView/Overview.tsx",
  EXCEPTIONS_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionExplorer.tsx",
  INVENTORY_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/Inventory/View/Index.tsx",
  SECURITY_CASE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Index.tsx",
  IOT_FLEET_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/IoT/View/Index.tsx",
  OPENSTACK_CLOUD_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Index.tsx",
  NETWORK_SITE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/Index.tsx",
  SETTINGS_TELEMETRY_INGESTION_KEY_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/Settings/TelemetryIngestionKeyView.tsx",
  DASHBOARD_PLAYLIST_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/Dashboards/Playlists/PlaylistView.tsx",
  SETTINGS_APIKEY_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/Settings/APIKeyView.tsx",
  LOGS_SETTINGS_PIPELINE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/Logs/Settings/PipelineView.tsx",
  TRACES_SETTINGS_PIPELINE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/Traces/Settings/PipelineView.tsx",
  SECURITY_EVENTS_SETTINGS_NOTE_TEMPLATE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/NoteTemplateView.tsx",
  SECURITY_EVENTS_WATCHLIST_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/SecurityEvents/WatchlistView.tsx",
  SECURITY_BLOCKLIST_FEED_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/SecurityEvents/BlocklistFeedView.tsx",
  SECURITY_PLAYBOOK_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/SecurityEvents/PlaybookView.tsx",
  SECURITY_EVENTS_HUNT_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntHeader.tsx",
  HOST_COLLECTOR_CONFIG_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/Host/CollectorConfigView.tsx",
  // Their cards keep the ID as a field; Created takes the line, with who.
  MONITORS_SETTINGS_PROBE_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbeView.tsx",
  RUNBOOKS_RUNNER_VIEW:
    "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView.tsx",
};

// A page's relative path in its product's RoutePath dictionary.
function routePathOf(key: string): string | undefined {
  const routeMap: string = fs
    .readFileSync(path.join(DASHBOARD_SRC, "Utils", "RouteMap.ts"), "utf8")
    .replace(/\s+/g, " ");
  const match: RegExpMatchArray | null = routeMap.match(
    new RegExp(`\\[PageMap\\.${key}\\]: [\`"]([^\`"]*)[\`"],`),
  );

  return match ? match[1] : undefined;
}

describe("every record's own page draws its record line (#10461)", () => {
  const routedPages: Array<RoutedPage> = scanRoutedPages().filter(
    (page: RoutedPage): boolean => {
      return !NOT_A_RECORD_PAGE_ELEMENTS.includes(page.element);
    },
  );
  const recordPages: Array<RoutedPage> = routedPages.filter(
    (page: RoutedPage): boolean => {
      return RECORD_PAGE_KEY.test(page.key);
    },
  );
  const recordPageKeys: Array<string> = Array.from(
    new Set(
      recordPages.map((page: RoutedPage): string => {
        return page.key;
      }),
    ),
  ).sort();

  // Whether every route of a key draws a line, and where.
  const drawersOf: (key: string) => Array<string> = (
    key: string,
  ): Array<string> => {
    const drawers: Set<string> = new Set<string>();

    for (const page of routedPages) {
      if (page.key === key && page.file) {
        for (const drawer of findLineDrawers(page.file)) {
          drawers.add(drawer);
        }
      }
    }

    return Array.from(drawers);
  };

  const drawsLine: (key: string) => boolean = (key: string): boolean => {
    return routedPages
      .filter((page: RoutedPage): boolean => {
        return page.key === key;
      })
      .every((page: RoutedPage): boolean => {
        return page.file !== null && findLineDrawers(page.file).length > 0;
      });
  };

  test("the sweep finds the record pages it is about (it is not vacuous)", () => {
    expect(recordPageKeys.length).toBeGreaterThanOrEqual(150);
    expect(recordPageKeys).toEqual(
      expect.arrayContaining([
        "MONITOR_VIEW",
        "INCIDENT_VIEW",
        "ALERT_VIEW",
        "STATUS_PAGE_VIEW",
        "ON_CALL_DUTY_POLICY_VIEW",
        "SERVICE_VIEW",
        "SLO_VIEW",
        "NETWORK_SITE_VIEW",
        "IOT_FLEET_VIEW",
        "SECURITY_CASE_VIEW",
        "DATA_SECURITY_ISSUE_VIEW",
        "ALERTS_SETTINGS_LABEL_RULE_VIEW",
        // Routes whose key the formatter wraps across lines.
        "SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW",
        "STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES_VIEW",
        "ON_CALL_DUTY_SETTINGS_INCOMING_CALL_POLICY_LABEL_RULE_VIEW",
        "SETTINGS_APIKEY_VIEW",
      ]),
    );
  });

  test("finds the source of every record page's element", () => {
    const unresolved: Array<string> = recordPages
      .filter((page: RoutedPage): boolean => {
        return page.file === null;
      })
      .map((page: RoutedPage): string => {
        return `${page.routes}: <${page.element}> for ${page.key}`;
      });

    expect(unresolved).toEqual([]);
  });

  test("every record page draws its line, or is listed with why", () => {
    const offenders: Array<string> = recordPageKeys.filter(
      (key: string): boolean => {
        return (
          !Object.prototype.hasOwnProperty.call(NO_RECORD_LINE, key) &&
          !drawsLine(key)
        );
      },
    );

    expect(offenders).toEqual([]);
  });

  test.each(Object.keys(DRAWN_SINCE_10461))(
    "%s draws its line where #10461 drew it",
    (key: string) => {
      expect(recordPageKeys).toContain(key);
      expect(drawsLine(key)).toBe(true);
      expect(drawersOf(key)).toContain(DRAWN_SINCE_10461[key]);
    },
  );

  test("the list only shrinks: every page on it is a record page that draws no line", () => {
    const stale: Array<string> = Object.keys(NO_RECORD_LINE).filter(
      (key: string): boolean => {
        return !recordPageKeys.includes(key) || drawsLine(key);
      },
    );

    expect(stale).toEqual([]);
  });

  test("each page on the list says why", () => {
    for (const [key, entry] of Object.entries(NO_RECORD_LINE)) {
      expect({ key, explained: entry.reason.trim().length > 20 }).toEqual({
        key,
        explained: true,
      });
    }
  });

  test("a kind it names as unrecorded is one the audit log does not keep", () => {
    for (const [key, entry] of Object.entries(NO_RECORD_LINE)) {
      if (entry.exemptTable) {
        expect({
          key,
          exempt: Boolean(AUDIT_LOG_EXEMPT_TABLES[entry.exemptTable]),
        }).toEqual({ key, exempt: true });
      }
    }
  });

  test("a page whose line is on another of its pages: that page is the record's, and draws it", () => {
    const entries: Array<[string, NoRecordLine]> = Object.entries(
      NO_RECORD_LINE,
    ).filter(([, entry]: [string, NoRecordLine]): boolean => {
      return Boolean(entry.lineOn);
    });

    expect(entries.length).toBeGreaterThanOrEqual(2);

    for (const [key, entry] of entries) {
      const lineOn: string = entry.lineOn!;
      const viewPath: string | undefined = routePathOf(key);

      // A page of the same record: its address is under the view's.
      expect(viewPath).toBeDefined();
      expect(routePathOf(lineOn)?.startsWith(`${viewPath}/`)).toBe(true);
      expect(
        routedPages.some((page: RoutedPage): boolean => {
          return page.key === lineOn;
        }),
      ).toBe(true);
      expect({ lineOn, draws: drawsLine(lineOn) }).toEqual({
        lineOn,
        draws: true,
      });
    }
  });

  test("a page the Enterprise plugin draws: the plugin's card ends with the line", () => {
    for (const entry of Object.values(NO_RECORD_LINE)) {
      if (!entry.lineDrawnBy) {
        continue;
      }

      const file: string = path.join(REPOSITORY_DIR, entry.lineDrawnBy);

      // The Community Edition checkout has no ee/, and must still pass.
      if (!ENTERPRISE_PRESENT) {
        continue;
      }

      expect(getFileLineShapes(file)).toContain(LineShape.RecordIdField);
    }
  });

  test("a page still to draw names the issue that will draw it", () => {
    for (const [key, entry] of Object.entries(NO_RECORD_LINE)) {
      if (entry.stillToDraw) {
        expect({
          key,
          cited: entry.reason.includes(`#${entry.stillToDraw}`),
        }).toEqual({ key, cited: true });
      }
    }
  });
});

describe("the sweep knows each shape of the line when it sees one", () => {
  const shapesIn: (source: string) => Array<LineShape> = (
    source: string,
  ): Array<LineShape> => {
    return getLineShapes(scanSource("snippet.tsx", source, "snippet.tsx"));
  };

  test("a ModelDetail field on the record's own ID", () => {
    expect(
      shapesIn(`const fields = [
        { field: { name: true }, title: "Name" },
        { field: { _id: true }, title: "ID", fieldType: FieldType.ObjectID },
      ];`),
    ).toEqual([LineShape.RecordIdField]);
  });

  test("a ModelDetail field on when the record was created or last updated", () => {
    expect(
      shapesIn(
        `const fields = [{ field: { createdAt: true }, title: "Created", fieldType: FieldType.DateTime }];`,
      ),
    ).toEqual([LineShape.RecordTimeField]);
    expect(
      shapesIn(
        `const fields = [{ field: { updatedAt: true }, title: "Updated", fieldType: FieldType.Date }];`,
      ),
    ).toEqual([LineShape.RecordTimeField]);
  });

  test("the line drawn by hand", () => {
    expect(
      shapesIn(
        `const a = <RecordActivityLine modelType={IoTFleet} recordId={modelId} />;`,
      ),
    ).toEqual([LineShape.RecordActivityLine]);
    expect(
      shapesIn(
        `const a = <ResourceRecordDetailsCard modelType={Host} modelId={id} id="host-details" title="Host Details" settingsRoute={route} facts={[]} />;`,
      ),
    ).toEqual([LineShape.ResourceRecordDetailsCard]);
    expect(
      shapesIn(
        `const a = <ResourceOverview recordId={id} recordModelType={Service}>{children}</ResourceOverview>;`,
      ),
    ).toEqual([LineShape.ResourceOverview]);
  });

  test("is not fooled by what draws no line, or not one that says who", () => {
    // The ID alone: no model type, so nothing reads who made the record.
    expect(shapesIn(`const a = <ResourceOverview recordId={id} />;`)).toEqual(
      [],
    );
    // A plain Detail draws the ID, and reads nobody.
    expect(
      shapesIn(
        `const fields = [{ key: "_id", title: "User ID", fieldType: FieldType.ObjectID }];`,
      ),
    ).toEqual([]);
    // The page draws the ID itself, as a link or a count.
    expect(
      shapesIn(
        `const fields = [{ field: { _id: true }, title: "Player link", fieldType: FieldType.Element, getElement: () => <a /> }];`,
      ),
    ).toEqual([]);
    // A card that keeps the ID as a field.
    expect(
      shapesIn(
        `const fields = [{ field: { _id: true }, title: "Project ID", fieldType: FieldType.ObjectID, showIdAsField: true }];`,
      ),
    ).toEqual([]);
    // Another record's ID, a table's column and a form's field.
    expect(
      shapesIn(
        `const fields = [{ field: { projectId: true }, title: "Project ID", fieldType: FieldType.ObjectID }];`,
      ),
    ).toEqual([]);
    expect(
      shapesIn(
        `const columns = [{ field: { _id: true }, title: "ID", type: FieldType.ObjectID }];`,
      ),
    ).toEqual([]);
    expect(
      shapesIn(
        `const formFields = [{ field: { _id: true }, title: "ID", fieldType: FormFieldSchemaType.ObjectID }];`,
      ),
    ).toEqual([]);
    // A name in a comment or a string is no element.
    expect(
      shapesIn(
        `// <RecordActivityLine /> is drawn elsewhere.\nconst words: string = "RecordActivityLine";`,
      ),
    ).toEqual([]);
  });

  test("follows a page's imports to the card that draws its line", () => {
    const exception: Array<string> = findLineDrawers(
      path.join(DASHBOARD_SRC, "Pages", "Exceptions", "View", "Index.tsx"),
    );

    // Not in the page itself: in the explorer it draws.
    expect(exception).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionExplorer.tsx",
    );
    expect(exception).not.toContain(
      "packages/App/FeatureSet/Dashboard/src/Pages/Exceptions/View/Index.tsx",
    );
    // A label rule's page draws it three imports down, in Common's RuleView.
    expect(
      findLineDrawers(
        path.join(
          DASHBOARD_SRC,
          "Pages",
          "Alerts",
          "Settings",
          "AlertLabelRules.tsx",
        ),
      ),
    ).toContain("packages/Common/UI/Components/RuleRun/RuleView.tsx");
  });

  test("reads a page's import, and a lazy page's", () => {
    const routed: Array<RoutedPage> = scanRoutedPages();
    const fileOf: (key: string) => string | null | undefined = (
      key: string,
    ): string | null | undefined => {
      return routed.find((page: RoutedPage): boolean => {
        return page.key === key;
      })?.file;
    };

    expect(fileOf("SETTINGS_APIKEY_VIEW")).toBe(
      path.join(DASHBOARD_SRC, "Pages", "Settings", "APIKeyView.tsx"),
    );
    // const SettingsDangerZone = lazy(() => { return import("..."); });
    expect(fileOf("SETTINGS_DANGERZONE")).toBe(
      path.join(DASHBOARD_SRC, "Pages", "Settings", "DangerZone.tsx"),
    );
  });
});
