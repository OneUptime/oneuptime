import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";

/*
 * "I can't filter by Owner/team on /on-call-duty/schedules. ... Can you
 * please also check if there are other places where we cannot filter by
 * owner / team, and build those as well?" - the maintainer.
 *
 * EVERY LIST OF A KIND WITH OWNERS CAN BE FILTERED BY THEM. A kind with
 * owners keeps them in <Kind>OwnerUser and <Kind>OwnerTeam (on-call
 * schedules, monitors, incidents, episodes, templates, probes, runners,
 * hosts, clusters and the rest). Each of its lists in the Dashboard - the
 * live list, the archived one, a settings page's list - has:
 *
 *   - the Owner chip over the table (useResourceOwners, with the kind's two
 *     owner tables, `topContent={filterBar}`), whose filter the server
 *     answers in the list's own query (`owners: OwnedBy`);
 *   - the chips' empty state, saved views and URL state wired through;
 *   - an Owners column, so what the chip filters on can be seen in the rows;
 *   - Labels in one place only: a list with the Labels chip has no Labels
 *     entry in its Filters dialog.
 *
 * Found, not listed: a new list of a kind with owners is held to this the
 * day it is written, and a list that leaves the Owner chip out says why in
 * NO_OWNER_CHIP below.
 *
 * And the key column every owner widget names the record by is the one the
 * owner tables have (resourceIdField: "monitorId" on MonitorOwnerUser):
 * Services passed "primaryEntityId", a column ServiceOwnerUser does not
 * have, so its Owner chip, Owners column, bulk owner actions and Owners
 * page all read and wrote nothing.
 *
 * Read through the TypeScript AST, so a reflow cannot fool it; the App
 * suite has no React, so the pages are read, not rendered (Common's
 * OwnerChipSchedules suite renders the schedules list, and the offline
 * OwnerFilters suite drives it in a browser).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MODELS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "Models",
  "DatabaseModels",
);

const MODEL_IMPORT_PREFIX: string = "Common/Models/DatabaseModels/";

const TSX_FILE: RegExp = /\.(ts|tsx)$/;
const OWNER_USER_FILE: RegExp = /^(\w+)OwnerUser\.ts$/;
const OWNER_USER_SUFFIX: RegExp = /OwnerUser$/;
const QUOTES: RegExp = /^["']|["']$/g;
const IDENTIFIER: RegExp = /^\w+$/;

/*
 * Lists of a kind with owners that have no Owner chip, and why. A key is the
 * file (from the Dashboard's src) and the table's id or name.
 */
const NO_OWNER_CHIP: Record<string, string> = {
  "Pages/Global/ActiveIncidents.tsx#active-incidents-table":
    "Every project's active incidents: owners and teams are each project's own.",
  "Pages/Global/ActiveAlerts.tsx#active-alerts-table":
    "Every project's active alerts: owners and teams are each project's own.",
  "Pages/Global/ActiveIncidentEpisodes.tsx#active-incident-episodes-table":
    "Every project's active episodes: owners and teams are each project's own.",
  "Pages/Global/ActiveAlertEpisodes.tsx#active-alert-episodes-table":
    "Every project's active episodes: owners and teams are each project's own.",
  "Pages/Monitor/Settings/MonitorProbes.tsx#Settings > Global Probes":
    "OneUptime's global probes: no project owns them.",
  "Components/Runner/GlobalRunnersTable.tsx#global-runners-table":
    "OneUptime's global Runners: no project owns them.",
  "Pages/Monitor/View/Slos.tsx#monitor-slos-table":
    "The SLOs one monitor's downtime spends; the SLOs list filters them by owner.",
  "Pages/Slo/View/Monitors.tsx#slo-monitors-table":
    "The monitors an SLO is measured on, added and removed by hand; the Monitors list filters them by owner.",
  "Pages/NetworkSite/View/Devices.tsx#network-site-devices-table":
    "A site's devices; the Devices list has the Site and Owner chips side by side.",
  "Pages/Host/CollectorConfigView.tsx#host-collector-config-hosts-table":
    "The hosts a collector config runs on; the Hosts list filters them by owner.",
  "Pages/Rum/Settings/SessionReplay.tsx#rum-application-session-replay-roster-table":
    "Each application's session replay settings, not a list to find applications in.",
  "Components/TelemetryService/TelemetryServiceTable.tsx#services-table":
    "Rendered by no page.",
};

// Kinds with owners whose records no project list shows.
const KINDS_WITHOUT_A_PROJECT_LIST: Record<string, string> = {
  AIAgent:
    "AI agents are listed only in the Admin Dashboard, for the whole installation.",
};

const MODEL_TYPES: Array<{ new (): BaseModel }> = AllModelTypes as Array<{
  new (): BaseModel;
}>;

const modelNamed: (name: string) => { new (): BaseModel } | undefined = (
  name: string,
): { new (): BaseModel } | undefined => {
  return MODEL_TYPES.find((modelType: { new (): BaseModel }): boolean => {
    return modelType.name === name;
  });
};

// The kinds with owners of their own: XOwnerUser and XOwnerTeam both exist.
const OWNER_KINDS: Array<string> = fs
  .readdirSync(MODELS_DIR)
  .map((file: string): string | null => {
    const found: RegExpMatchArray | null = file.match(OWNER_USER_FILE);
    return found ? found[1]! : null;
  })
  .filter((kind: string | null): kind is string => {
    return (
      kind !== null &&
      fs.existsSync(path.join(MODELS_DIR, `${kind}OwnerTeam.ts`)) &&
      fs.existsSync(path.join(MODELS_DIR, `${kind}.ts`))
    );
  })
  .sort();

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", "Locales", "build", "dist"].includes(entry.name)) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (TSX_FILE.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function parse(fullPath: string): ts.SourceFile {
  return ts.createSourceFile(
    fullPath,
    fs.readFileSync(fullPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    fullPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  node.forEachChild((child: ts.Node): void => {
    visit(child, callback);
  });
}

// Local name -> module, for every default import of a file.
function defaultImports(sourceFile: ts.SourceFile): Map<string, string> {
  const imports: Map<string, string> = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.name &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.set(
        statement.importClause.name.text,
        statement.moduleSpecifier.text,
      );
    }
  }

  return imports;
}

// Local name -> module, for every named import of a file.
function namedImports(sourceFile: ts.SourceFile): Map<string, string> {
  const imports: Map<string, string> = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(element.name.text, statement.moduleSpecifier.text);
      }
    }
  }

  return imports;
}

// The model a local name in a file stands for, by its import.
function modelOf(sourceFile: ts.SourceFile, localName: string): string | null {
  const module: string | undefined = defaultImports(sourceFile).get(localName);

  if (!module || !module.startsWith(MODEL_IMPORT_PREFIX)) {
    return null;
  }

  return module.slice(MODEL_IMPORT_PREFIX.length);
}

function propertyName(property: ts.ObjectLiteralElementLike): string {
  return (property.name?.getText() || "").replace(QUOTES, "");
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (
      property: ts.ObjectLiteralElementLike,
    ): property is ts.PropertyAssignment => {
      return (
        ts.isPropertyAssignment(property) && propertyName(property) === name
      );
    },
  );
}

function attributeNamed(
  attributes: ts.JsxAttributes,
  name: string,
): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
      return ts.isJsxAttribute(property) && property.name.getText() === name;
    },
  );
}

// An attribute's value as text: a string's text, an expression's source.
function attributeText(attribute: ts.JsxAttribute | undefined): string {
  if (!attribute || !attribute.initializer) {
    return "";
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }

  if (ts.isJsxExpression(attribute.initializer)) {
    return attribute.initializer.expression?.getText() || "";
  }

  return attribute.initializer.getText();
}

/*
 * A string a file writes for an identifier: a `const NAME ... = "text"` of
 * its own, or of the Dashboard module it imports the name from.
 */
function resolveString(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): string | null {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }

  if (!ts.isIdentifier(expression)) {
    return null;
  }

  const fromFile: (file: ts.SourceFile) => string | null = (
    file: ts.SourceFile,
  ): string | null => {
    let found: string | null = null;

    visit(file, (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText() === expression.text &&
        node.initializer &&
        ts.isStringLiteralLike(node.initializer)
      ) {
        found = node.initializer.text;
      }
    });

    return found;
  };

  const own: string | null = fromFile(sourceFile);

  if (own !== null) {
    return own;
  }

  const module: string | undefined = namedImports(sourceFile).get(
    expression.text,
  );

  if (!module || !module.startsWith(".")) {
    return null;
  }

  for (const extension of [".ts", ".tsx"]) {
    const candidate: string = path.resolve(
      path.dirname(sourceFile.fileName),
      module + extension,
    );

    if (fs.existsSync(candidate)) {
      return fromFile(parse(candidate));
    }
  }

  return null;
}

/*
 * Whether `column` of an owner table (`ownerModel`) is the key it names a
 * record of `kind` by: an id column, with the relation to `kind` on it.
 */
function isKeyOfKind(ownerModel: string, column: string, kind: string): boolean {
  const modelType: { new (): BaseModel } | undefined = modelNamed(ownerModel);

  if (!modelType) {
    return false;
  }

  const model: BaseModel = new modelType();

  if (model.getTableColumnMetadata(column)?.type !== TableColumnType.ObjectID) {
    return false;
  }

  return model.getTableColumns().columns.some((name: string): boolean => {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(name);

    return (
      metadata?.type === TableColumnType.Entity &&
      metadata.manyToOneRelationColumn === column &&
      (metadata.modelType as { name?: string } | undefined)?.name === kind
    );
  });
}

interface OwnerWiring {
  // The kind the hook, the bulk actions or the card is for.
  kind: string | null;
  ownerUserModel: string | null;
  ownerTeamModel: string | null;
  resourceIdField: string | null;
  showsOwnerChip: boolean;
  showsLabelsChip: boolean;
}

interface ListTable {
  file: string;
  // The file and the table's id - or its name, where two share an id.
  key: string;
  name: string;
  kind: string;
  element: ts.JsxOpeningLikeElement;
  sourceFile: ts.SourceFile;
}

interface Scanned {
  tables: Array<ListTable>;
  // Every useResourceOwners call, by file.
  hookCalls: Array<{ file: string; wiring: OwnerWiring }>;
  // Every useBulkOwnerActions call and OwnersCard element.
  ownerWidgets: Array<{ file: string; what: string; wiring: OwnerWiring }>;
}

function readOptions(
  sourceFile: ts.SourceFile,
  options: ts.ObjectLiteralExpression,
  kind: string | null,
): OwnerWiring {
  const identifierModel: (name: string) => string | null = (
    name: string,
  ): string | null => {
    const property: ts.PropertyAssignment | undefined = propertyNamed(
      options,
      name,
    );

    return property && ts.isIdentifier(property.initializer)
      ? modelOf(sourceFile, property.initializer.text)
      : null;
  };

  const resourceIdField: ts.PropertyAssignment | undefined = propertyNamed(
    options,
    "resourceIdField",
  );
  const showOwnerFacet: ts.PropertyAssignment | undefined = propertyNamed(
    options,
    "showOwnerFacet",
  );
  const showLabelsFacet: ts.PropertyAssignment | undefined = propertyNamed(
    options,
    "showLabelsFacet",
  );

  return {
    kind,
    ownerUserModel: identifierModel("ownerUserModelType"),
    ownerTeamModel: identifierModel("ownerTeamModelType"),
    resourceIdField: resourceIdField
      ? resolveString(sourceFile, resourceIdField.initializer)
      : null,
    showsOwnerChip: showOwnerFacet?.initializer.kind !== ts.SyntaxKind.FalseKeyword,
    showsLabelsChip:
      showLabelsFacet?.initializer.kind === ts.SyntaxKind.TrueKeyword,
  };
}

function typeArgumentModel(
  sourceFile: ts.SourceFile,
  typeArguments: ts.NodeArray<ts.TypeNode> | undefined,
  index: number,
): string | null {
  const typeArgument: ts.TypeNode | undefined = typeArguments?.[index];

  return typeArgument && ts.isTypeReferenceNode(typeArgument)
    ? modelOf(sourceFile, typeArgument.typeName.getText())
    : null;
}

function scan(): Scanned {
  const scanned: Scanned = { tables: [], hookCalls: [], ownerWidgets: [] };

  for (const fullPath of listSourceFiles(DASHBOARD_SRC)) {
    const file: string = path
      .relative(DASHBOARD_SRC, fullPath)
      .split(path.sep)
      .join("/");
    const sourceFile: ts.SourceFile = parse(fullPath);

    visit(sourceFile, (node: ts.Node): void => {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText() === "ModelTable"
      ) {
        const kind: string | null = typeArgumentModel(
          sourceFile,
          node.typeArguments,
          0,
        );

        if (kind && OWNER_KINDS.includes(kind)) {
          const id: string = attributeText(
            attributeNamed(node.attributes, "id"),
          );
          const name: string = attributeText(
            attributeNamed(node.attributes, "name"),
          );

          scanned.tables.push({
            file,
            key: `${file}#${id ? resolveIdText(sourceFile, id) : name}`,
            name: name,
            kind,
            element: node,
            sourceFile,
          });
        }
      }

      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText() === "OwnersCard"
      ) {
        const ownerUserModel: string | null = typeArgumentModel(
          sourceFile,
          node.typeArguments,
          0,
        );
        const resourceIdField: ts.JsxAttribute | undefined = attributeNamed(
          node.attributes,
          "resourceIdField",
        );

        scanned.ownerWidgets.push({
          file,
          what: "OwnersCard",
          wiring: {
            kind: ownerUserModel
              ? ownerUserModel.replace(OWNER_USER_SUFFIX, "")
              : null,
            ownerUserModel,
            ownerTeamModel: typeArgumentModel(
              sourceFile,
              node.typeArguments,
              1,
            ),
            resourceIdField:
              resourceIdField?.initializer &&
              ts.isStringLiteral(resourceIdField.initializer)
                ? resourceIdField.initializer.text
                : resourceIdField?.initializer &&
                    ts.isJsxExpression(resourceIdField.initializer) &&
                    resourceIdField.initializer.expression
                  ? resolveString(
                      sourceFile,
                      resourceIdField.initializer.expression,
                    )
                  : null,
            showsOwnerChip: false,
            showsLabelsChip: false,
          },
        });
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ["useResourceOwners", "useBulkOwnerActions"].includes(
          node.expression.text,
        ) &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const kind: string | null = typeArgumentModel(
          sourceFile,
          node.typeArguments,
          0,
        );
        const wiring: OwnerWiring = readOptions(
          sourceFile,
          node.arguments[0],
          kind,
        );

        if (node.expression.text === "useResourceOwners") {
          scanned.hookCalls.push({ file, wiring });
        } else {
          scanned.ownerWidgets.push({
            file,
            what: "useBulkOwnerActions",
            wiring,
          });
        }
      }
    });
  }

  return scanned;
}

// A table's id as written: a string, or a constant of the file's.
function resolveIdText(sourceFile: ts.SourceFile, idText: string): string {
  if (!IDENTIFIER.test(idText)) {
    return idText;
  }

  const resolved: string | null = resolveString(
    sourceFile,
    ts.factory.createIdentifier(idText),
  );

  return resolved || idText;
}

const SCANNED: Scanned = scan();

/*
 * Two tables of one page with one id (the Probes page's global and custom
 * probes) are told apart by their names.
 */
const SHARED_KEYS: Set<string> = new Set<string>(
  SCANNED.tables
    .map((table: ListTable): string => {
      return table.key;
    })
    .filter((key: string, index: number, keys: Array<string>): boolean => {
      return keys.indexOf(key) !== index;
    }),
);

for (const table of SCANNED.tables) {
  if (SHARED_KEYS.has(table.key)) {
    table.key = `${table.file}#${table.name}`;
  }
}

function attributeOf(table: ListTable, name: string): string {
  return attributeText(attributeNamed(table.element.attributes, name));
}

/*
 * An attribute's value, or - for one written as a constant of the page
 * (`emptyState={devicesEmptyState}`) - what the constant is made of.
 */
function attributeSourceOf(table: ListTable, name: string): string {
  const text: string = attributeOf(table, name);

  if (!IDENTIFIER.test(text)) {
    return text;
  }

  let definition: string = text;

  visit(table.sourceFile, (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === text &&
      node.initializer
    ) {
      definition = node.initializer.getText();
    }
  });

  return definition;
}

// The column objects of a table's `columns={[...]}`.
function columnsOf(table: ListTable): Array<ts.ObjectLiteralExpression> {
  const attribute: ts.JsxAttribute | undefined = attributeNamed(
    table.element.attributes,
    "columns",
  );
  const expression: ts.Expression | undefined =
    attribute?.initializer && ts.isJsxExpression(attribute.initializer)
      ? attribute.initializer.expression
      : undefined;

  if (!expression || !ts.isArrayLiteralExpression(expression)) {
    return [];
  }

  return expression.elements.filter(
    (element: ts.Expression): element is ts.ObjectLiteralExpression => {
      return ts.isObjectLiteralExpression(element);
    },
  );
}

// The titles of a table's `filters={[...]}`, as written.
function filterTitlesOf(table: ListTable): Array<string> {
  const attribute: ts.JsxAttribute | undefined = attributeNamed(
    table.element.attributes,
    "filters",
  );
  const expression: ts.Expression | undefined =
    attribute?.initializer && ts.isJsxExpression(attribute.initializer)
      ? attribute.initializer.expression
      : undefined;

  if (!expression || !ts.isArrayLiteralExpression(expression)) {
    return [];
  }

  return expression.elements
    .filter((element: ts.Expression): element is ts.ObjectLiteralExpression => {
      return ts.isObjectLiteralExpression(element);
    })
    .map((element: ts.ObjectLiteralExpression): string => {
      const title: ts.PropertyAssignment | undefined = propertyNamed(
        element,
        "title",
      );

      return title && ts.isStringLiteralLike(title.initializer)
        ? title.initializer.text
        : "";
    });
}

const CHIP_TABLES: Array<ListTable> = SCANNED.tables.filter(
  (table: ListTable): boolean => {
    return !NO_OWNER_CHIP[table.key];
  },
);

const hookOf: (table: ListTable) => OwnerWiring | undefined = (
  table: ListTable,
): OwnerWiring | undefined => {
  return SCANNED.hookCalls.find(
    (call: { file: string; wiring: OwnerWiring }): boolean => {
      return call.file === table.file && call.wiring.kind === table.kind;
    },
  )?.wiring;
};

describe("every list of a kind with owners has the Owner chip", () => {
  test("the scan finds the kinds with owners and their lists", () => {
    // Monitors, incidents, on-call schedules, episodes, templates and more.
    expect(OWNER_KINDS.length).toBeGreaterThanOrEqual(37);
    expect(OWNER_KINDS).toEqual(
      expect.arrayContaining([
        "OnCallDutyPolicySchedule",
        "OnCallDutyPolicy",
        "Monitor",
        "Incident",
        "IncidentEpisode",
        "AlertEpisode",
        "IncidentTemplate",
        "ScheduledMaintenanceTemplate",
        "Probe",
        "Runner",
        "Service",
      ]),
    );

    // The schedules list of the maintainer's words, and 60 or so more.
    expect(SCANNED.tables.length).toBeGreaterThanOrEqual(60);
    expect(
      SCANNED.tables.map((table: ListTable): string => {
        return table.key;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Pages/OnCallDuty/OnCallDutySchedules.tsx#on-call-schedules-table",
        "Pages/OnCallDuty/OnCallDutyPolicies.tsx#on-call-duty-table",
      ]),
    );
  });

  test("each list left without it is still a list, and says why", () => {
    const keys: Array<string> = SCANNED.tables.map(
      (table: ListTable): string => {
        return table.key;
      },
    );

    for (const [key, reason] of Object.entries(NO_OWNER_CHIP)) {
      expect({ key, isAList: keys.includes(key) }).toEqual({
        key,
        isAList: true,
      });
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  test("every kind with owners has a list with the Owner chip, or no project list at all", () => {
    const kindsWithChip: Set<string> = new Set<string>(
      CHIP_TABLES.map((table: ListTable): string => {
        return table.kind;
      }),
    );

    const missing: Array<string> = OWNER_KINDS.filter(
      (kind: string): boolean => {
        return !kindsWithChip.has(kind) && !KINDS_WITHOUT_A_PROJECT_LIST[kind];
      },
    );

    expect(missing).toEqual([]);

    for (const kind of Object.keys(KINDS_WITHOUT_A_PROJECT_LIST)) {
      expect({ kind, hasList: kindsWithChip.has(kind) }).toEqual({
        kind,
        hasList: false,
      });
    }
  });

  test.each(
    CHIP_TABLES.map((table: ListTable): [string, ListTable] => {
      return [table.key, table];
    }),
  )("%s", (_key: string, table: ListTable) => {
    const wiring: OwnerWiring | undefined = hookOf(table);

    // The hook, for this kind, with its two owner tables and the chip on.
    expect({
      table: table.key,
      hook: wiring && {
        ownerUserModel: wiring.ownerUserModel,
        ownerTeamModel: wiring.ownerTeamModel,
        showsOwnerChip: wiring.showsOwnerChip,
      },
    }).toEqual({
      table: table.key,
      hook: {
        ownerUserModel: `${table.kind}OwnerUser`,
        ownerTeamModel: `${table.kind}OwnerTeam`,
        showsOwnerChip: true,
      },
    });

    // The chips over the table, their empty state and the query.
    expect(attributeOf(table, "topContent")).toContain("filterBar");
    expect(attributeSourceOf(table, "emptyState")).toContain(
      "facetEmptyState",
    );
    expect(attributeOf(table, "query")).toContain("mergeFiltersIntoQuery(");

    // A list with saved views saves and restores the chips with them.
    if (attributeNamed(table.element.attributes, "saveFilterProps")) {
      expect(attributeOf(table, "currentFacetState")).toBe("facetSaveState");
      expect(attributeOf(table, "onFacetStateRestored")).toBe(
        "restoreFacetState",
      );
    }

    expect(attributeOf(table, "onFetchSuccess")).toContain(
      "onResourcesFetched(",
    );

    // An Owners column that draws the owners the hook read.
    const owners: ts.ObjectLiteralExpression | undefined = columnsOf(
      table,
    ).find((column: ts.ObjectLiteralExpression): boolean => {
      const title: ts.PropertyAssignment | undefined = propertyNamed(
        column,
        "title",
      );

      return Boolean(
        title &&
          ts.isStringLiteralLike(title.initializer) &&
          title.initializer.text === "Owners",
      );
    });

    expect(owners).toBeDefined();
    expect(owners!.getText()).toContain("<OwnersCell");
    expect(owners!.getText()).toContain("getOwnersForResource(item)");

    // Labels in one place: with the Labels chip, not in the Filters dialog.
    if (wiring?.showsLabelsChip) {
      expect({ table: table.key, filters: filterTitlesOf(table) }).toEqual({
        table: table.key,
        filters: expect.not.arrayContaining(["Labels"]),
      });
    }
  });
});

describe("every owner widget names the record by the owner tables' own key", () => {
  const widgets: Array<{ file: string; what: string; wiring: OwnerWiring }> =
    [
      ...SCANNED.hookCalls
        .filter((call: { file: string; wiring: OwnerWiring }): boolean => {
          return (
            call.wiring.showsOwnerChip && Boolean(call.wiring.ownerUserModel)
          );
        })
        .map((call: { file: string; wiring: OwnerWiring }) => {
          return { file: call.file, what: "useResourceOwners", wiring: call.wiring };
        }),
      ...SCANNED.ownerWidgets,
    ];

  test("the scan finds them (hooks, bulk owner actions and Owners cards)", () => {
    expect(widgets.length).toBeGreaterThanOrEqual(100);
  });

  test.each(
    widgets.map(
      (widget: {
        file: string;
        what: string;
        wiring: OwnerWiring;
      }): [string, OwnerWiring] => {
        return [
          `${widget.file} ${widget.what}<${widget.wiring.kind}>`,
          widget.wiring,
        ];
      },
    ),
  )("%s", (_name: string, wiring: OwnerWiring) => {
    const kind: string = wiring.kind || "";

    expect({
      ownerUserModel: wiring.ownerUserModel,
      ownerTeamModel: wiring.ownerTeamModel,
    }).toEqual({
      ownerUserModel: `${kind}OwnerUser`,
      ownerTeamModel: `${kind}OwnerTeam`,
    });

    const field: string = wiring.resourceIdField || "";

    expect({
      field,
      onPeople: isKeyOfKind(`${kind}OwnerUser`, field, kind),
      onTeams: isKeyOfKind(`${kind}OwnerTeam`, field, kind),
    }).toEqual({ field, onPeople: true, onTeams: true });
  });

  test("a service's owners are named by serviceId, the column their tables have", () => {
    expect(isKeyOfKind("ServiceOwnerUser", "serviceId", "Service")).toBe(true);
    expect(isKeyOfKind("ServiceOwnerUser", "primaryEntityId", "Service")).toBe(
      false,
    );
  });
});
