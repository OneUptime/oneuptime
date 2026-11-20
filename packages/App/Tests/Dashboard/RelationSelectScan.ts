import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RelationReadersUtil from "Common/Types/Database/RelationReadersUtil";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY SELECT THAT READS A COLUMN THROUGH A RELATION, AND WHETHER THE
 * SERVER WILL READ IT (RelationSelectColumnsWiring, #10238).
 *
 * A select that reaches through a relation is checked against the RELATED
 * model, not the one being queried, and the check is all-or-nothing:
 * QueryPermission.checkRelationQueryPermission walks every inner key of
 * `select: { someRelation: { ... } }` and THROWS on the first one that is a
 * relation itself ("You cannot query deep relations") or whose column lacks
 * canReadOnRelationQuery ("Column X on Y does not support read on relation
 * query."). One such column fails the whole read, for every caller, at any
 * permission level, and nothing catches it at compile time: Select<T> lets
 * every column be spelled in a relation select.
 *
 * This reads the sources for every place a select is handed with the model
 * it reads, as the server will get it:
 *
 *   - `select` and `selectMoreFields` beside a `modelType`, in an object
 *     (`ModelAPI.getList({ modelType: X, select: { ... } })`) or as a
 *     component's props (`<ModelList modelType={X} select={...} />`);
 *   - the `field` of each of `columns` (a table's or a list's) and of each
 *     of `fields` (a detail's) beside a `modelType`, in an object
 *     (`modelDetailProps={{ modelType: X, fields: [...] }}`) or as props
 *     (`<ModelTable modelType={X} columns={[...]} />`): a table sends each
 *     column's relation select (getRelationSelectFromColumns) as its read.
 *
 * Each of those can be written out, or a constant declared elsewhere and
 * named or spread in - `select: A_SELECT`, `monitors: { _id: true,
 * ...SLO_MONITOR_FIRST_CHECK_SELECT }`, `columns={COLUMNS}`, a relation's
 * whole select as `dataStore: STORE_SELECT`. A constant is followed to what
 * it is declared with, in the same file or the one it is imported from
 * (relative, or Common/...), through its own spreads. The model is named by
 * its identifier, or by the model file it is imported from under another
 * name. #10238's select was a constant, named whole (`select:
 * DATA_SECURITY_ISSUE_VIEW_SELECT`), which this read only from 17.0.0 on.
 *
 * A column a relation reads only for those who may read it on the related
 * record (RelationReaders.ColumnReaders: a data store's sensitivity, #10281)
 * refuses every other reader of the relation the whole read. So a select
 * that names one is sent for each reader without what they may not read -
 * handed to getSelectReadableThroughRelations, PermissionGate's or, on the
 * server, QueryPermission's, which this reads through (`select:
 * PermissionGate.getSelectReadableThroughRelations(X, A_SELECT)` reads
 * A_SELECT) - or the column is shown only to who may read it.
 *
 * WHAT IT DOES NOT COVER. A select assembled at run time (a function's
 * result, a conditional spread), a `columns` or `fields` built by a
 * function, and a call that names its model anywhere but a `modelType`.
 * The coverage tests guard the parse itself: if a refactor moves a shape,
 * they fail rather than this quietly checking nothing.
 */

export const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");

const MODEL_DIR: string = path.join(
  REPO_ROOT,
  "Common",
  "Models",
  "DatabaseModels",
);

// Mirrors ColumnPermissions.getExcludedColumnNames().
export const EXCLUDED_COLUMN_NAMES: Array<string> = [
  "_id",
  "createdAt",
  "deletedAt",
  "updatedAt",
  "version",
];

export const SCAN_DIRECTORIES: Array<string> = [
  path.join(REPO_ROOT, "App"),
  path.join(REPO_ROOT, "Common", "UI"),
  path.join(REPO_ROOT, "Common", "Server"),
  path.join(REPO_ROOT, "Common", "Utils"),
];

/*
 * Test trees are skipped along with build output: a test asserting that a bad
 * select is refused has to spell out a bad select, and that is not a call site
 * anybody will make. Only production query sites are checked.
 */
const SKIP_DIRECTORY_NAMES: Array<string> = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "Tests",
  "__tests__",
];

const SOURCE_FILE_PATTERN: RegExp = new RegExp("\\.(ts|tsx)$");
const TSX_FILE_PATTERN: RegExp = new RegExp("\\.tsx$");
const MODEL_FILE_SUFFIX_PATTERN: RegExp = new RegExp("\\.ts$");
const MODEL_IMPORT_PATTERN: RegExp = new RegExp(
  "(^|/)Models/DatabaseModels/[^/]+$",
);

// Constants named in constants, followed this deep.
const MAX_DEPTH: number = 5;

// Where a select is handed to a read, beside its `modelType`.
export enum SelectShape {
  Select = "select",
  SelectMoreFields = "selectMoreFields",
  // A table's or a list's columns, each with its `field`.
  Columns = "columns",
  // A detail's fields, each with its `field`.
  Fields = "fields",
}

const SHAPES: Array<SelectShape> = [
  SelectShape.Select,
  SelectShape.SelectMoreFields,
  SelectShape.Columns,
  SelectShape.Fields,
];

export interface RelationSelectSite {
  // The file that reads it, from the packages folder: where its model is named.
  file: string;
  /*
   * Its line in that file: the relation's key, or the constant or spread
   * that brings it in from elsewhere.
   */
  line: number;
  // Where the column's key is written: "<file>:<line>".
  writtenAt: string;
  modelName: string;
  shape: SelectShape;
  relation: string;
  column: string;
  // The column is selected as a relation of its own: `{ relation: { column: { ... } } }`.
  isDeep: boolean;
  /*
   * The select is handed to getSelectReadableThroughRelations
   * (PermissionGate's, or QueryPermission's on the server) before it is
   * sent: each reader's read leaves out what a relation reads only for
   * those who may read it on the related record (#10281).
   */
  isReadPerReader: boolean;
}

export interface RelationSelectScan {
  sites: Array<RelationSelectSite>;
  // The sites that are relations, checked against the related model.
  checkedCount: number;
  violations: Array<string>;
}

function listModelNames(): Set<string> {
  return new Set(
    fs
      .readdirSync(MODEL_DIR)
      .filter((fileName: string) => {
        return fileName.endsWith(".ts") && fileName !== "Index.ts";
      })
      .map((fileName: string) => {
        return fileName.replace(MODEL_FILE_SUFFIX_PATTERN, "");
      }),
  );
}

function listSourceFiles(directory: string, out: Array<string> = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORY_NAMES.includes(entry.name)) {
      continue;
    }

    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      listSourceFiles(entryPath, out);
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      out.push(entryPath);
    }
  }

  return out;
}

const parsedFiles: Map<string, ts.SourceFile> = new Map();

function parseFile(filePath: string): ts.SourceFile {
  const parsed: ts.SourceFile | undefined = parsedFiles.get(filePath);

  if (parsed) {
    return parsed;
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    TSX_FILE_PATTERN.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  parsedFiles.set(filePath, sourceFile);

  return sourceFile;
}

// The file an import names: relative to the importer, or Common/... .
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;

  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("Common/")) {
    base = path.join(REPO_ROOT, specifier);
  } else {
    return null;
  }

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "Index.ts"),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// `{ ... } as const`, `{ ... } satisfies T` and `({ ... })` are the object.
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let unwrapped: ts.Expression = expression;

  while (
    ts.isAsExpression(unwrapped) ||
    ts.isSatisfiesExpression(unwrapped) ||
    ts.isParenthesizedExpression(unwrapped)
  ) {
    unwrapped = unwrapped.expression;
  }

  return unwrapped;
}

/*
 * Every constant a file declares, at any depth - a select is often a
 * component's own `const select = { ... }` - by its name, in the order
 * written.
 */
const declarationsByFile: Map<
  ts.SourceFile,
  Map<string, Array<ts.VariableDeclaration>>
> = new Map();

function declarationsOf(
  sourceFile: ts.SourceFile,
): Map<string, Array<ts.VariableDeclaration>> {
  const known: Map<string, Array<ts.VariableDeclaration>> | undefined =
    declarationsByFile.get(sourceFile);

  if (known) {
    return known;
  }

  const declarations: Map<string, Array<ts.VariableDeclaration>> = new Map();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const named: Array<ts.VariableDeclaration> =
        declarations.get(node.name.text) || [];

      named.push(node);
      declarations.set(node.name.text, named);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  declarationsByFile.set(sourceFile, declarations);

  return declarations;
}

/*
 * The expression a constant is declared with: the nearest declaration of
 * its name before `position` in this file (anywhere in it, when there is
 * no position), or the one in the file it is imported from.
 */
function resolveConstant(
  name: string,
  sourceFile: ts.SourceFile,
  position: number | null,
  depth: number = 0,
): ts.Expression | null {
  if (depth > MAX_DEPTH) {
    return null;
  }

  const declared: Array<ts.VariableDeclaration> = (
    declarationsOf(sourceFile).get(name) || []
  ).filter((declaration: ts.VariableDeclaration): boolean => {
    return position === null || declaration.getStart() < position;
  });

  const nearest: ts.VariableDeclaration | undefined =
    declared[declared.length - 1];

  if (nearest && nearest.initializer) {
    return unwrapExpression(nearest.initializer);
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.name.text !== name) {
          continue;
        }

        const importedFile: string | null = resolveImport(
          sourceFile.fileName,
          statement.moduleSpecifier.text,
        );

        return importedFile
          ? resolveConstant(
              (element.propertyName ?? element.name).text,
              parseFile(importedFile),
              null,
              depth + 1,
            )
          : null;
      }
    }
  }

  return null;
}

// An object written out, or a constant declared with one.
function resolveObject(
  expression: ts.Expression,
): ts.ObjectLiteralExpression | null {
  const unwrapped: ts.Expression = unwrapExpression(expression);

  if (ts.isObjectLiteralExpression(unwrapped)) {
    return unwrapped;
  }

  if (ts.isIdentifier(unwrapped)) {
    const declared: ts.Expression | null = resolveConstant(
      unwrapped.text,
      unwrapped.getSourceFile(),
      unwrapped.getStart(),
    );

    return declared && ts.isObjectLiteralExpression(declared) ? declared : null;
  }

  return null;
}

// A list written out, or a constant declared with one.
function resolveArray(
  expression: ts.Expression,
): ts.ArrayLiteralExpression | null {
  const unwrapped: ts.Expression = unwrapExpression(expression);

  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped;
  }

  if (ts.isIdentifier(unwrapped)) {
    const declared: ts.Expression | null = resolveConstant(
      unwrapped.text,
      unwrapped.getSourceFile(),
      unwrapped.getStart(),
    );

    return declared && ts.isArrayLiteralExpression(declared) ? declared : null;
  }

  return null;
}

/*
 * The model `expression` names: the model of the file it is imported from,
 * whatever it is called here, else a model of its own name.
 */
function resolveModelName(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  modelNames: Set<string>,
): string | null {
  const unwrapped: ts.Expression = unwrapExpression(expression);

  if (!ts.isIdentifier(unwrapped)) {
    return null;
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.name?.text === unwrapped.text &&
      MODEL_IMPORT_PATTERN.test(statement.moduleSpecifier.text)
    ) {
      const modelName: string = path.basename(statement.moduleSpecifier.text);

      return modelNames.has(modelName) ? modelName : null;
    }
  }

  return modelNames.has(unwrapped.text) ? unwrapped.text : null;
}

// An object's own keys and what they hold: `{ select }` holds `select`.
function readObjectProperties(
  node: ts.ObjectLiteralExpression,
): Map<string, ts.Expression> {
  const properties: Map<string, ts.Expression> = new Map();

  for (const property of node.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ) {
      properties.set(property.name.text, property.initializer);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(property.name.text, property.name);
    }
  }

  return properties;
}

// A component's props and what they hold: `modelType={X}`.
function readJsxAttributes(
  attributes: ts.JsxAttributes,
): Map<string, ts.Expression> {
  const properties: Map<string, ts.Expression> = new Map();

  for (const attribute of attributes.properties) {
    if (
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.initializer &&
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression
    ) {
      properties.set(attribute.name.text, attribute.initializer.expression);
    }
  }

  return properties;
}

interface SelectEntry {
  value: ts.Expression;
  // The key, wherever it is written.
  key: ts.Node;
  // Where the scanned file names it: the key, or what brings it in.
  readAt: ts.Node;
}

/*
 * A select's keys, the ones a spread brings in included: the permission
 * layer walks the keys a spread brings exactly as it walks the ones written
 * out. `readAt` is the node of the scanned file that brought this object in,
 * when it is written elsewhere.
 */
function readSelectProperties(
  node: ts.ObjectLiteralExpression,
  readAt: ts.Node | null,
  depth: number = 0,
): Map<string, SelectEntry> {
  const entries: Map<string, SelectEntry> = new Map();

  for (const property of node.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ) {
      entries.set(property.name.text, {
        value: property.initializer,
        key: property.name,
        readAt: readAt ?? property.name,
      });
      continue;
    }

    if (
      ts.isSpreadAssignment(property) &&
      ts.isIdentifier(property.expression) &&
      depth < MAX_DEPTH
    ) {
      const spread: ts.ObjectLiteralExpression | null = resolveObject(
        property.expression,
      );

      if (spread) {
        for (const [key, entry] of readSelectProperties(
          spread,
          readAt ?? property,
          depth + 1,
        )) {
          entries.set(key, entry);
        }
      }
    }
  }

  return entries;
}

function lineOf(node: ts.Node): number {
  return (
    node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1
  );
}

function fileOf(node: ts.Node): string {
  return path.relative(REPO_ROOT, node.getSourceFile().fileName);
}

interface ReadSite {
  modelName: string;
  shape: SelectShape;
  sourceFile: ts.SourceFile;
  // Handed to getSelectReadableThroughRelations (RelationSelectSite).
  isReadPerReader: boolean;
}

/*
 * The function a select is handed to so that each reader sends only what a
 * relation reads for them: PermissionGate.getSelectReadableThroughRelations
 * (Model, select) in the dashboard, and QueryPermission's, given
 * `{ modelType, select, props }`, on the server.
 */
export const PER_READER_SELECT_FUNCTION: string =
  "getSelectReadableThroughRelations";

// Whether `expression` calls PER_READER_SELECT_FUNCTION.
function isPerReaderSelectCall(
  expression: ts.Node | undefined,
): expression is ts.CallExpression {
  if (!expression || !ts.isCallExpression(expression)) {
    return false;
  }

  const callee: ts.Expression = expression.expression;

  return (
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === PER_READER_SELECT_FUNCTION) ||
    (ts.isIdentifier(callee) && callee.text === PER_READER_SELECT_FUNCTION)
  );
}

/*
 * Every relation's columns a select reads. `readAt` is the node of the
 * scanned file that brought `select` in, when it is written in another.
 * Each site is reported at the relation's line in the scanned file, or at
 * what brought it in.
 */
function collectFromSelect(
  site: ReadSite,
  select: ts.ObjectLiteralExpression,
  readAt: ts.Node | null,
  out: Array<RelationSelectSite>,
): void {
  for (const [relation, entry] of readSelectProperties(select, readAt)) {
    // A nested object, written out or named, is a select through a relation.
    const relationSelect: ts.ObjectLiteralExpression | null = resolveObject(
      entry.value,
    );

    if (!relationSelect) {
      continue;
    }

    for (const [column, inner] of readSelectProperties(
      relationSelect,
      relationSelect.getSourceFile() === site.sourceFile ? null : entry.readAt,
    )) {
      out.push({
        file: path.relative(REPO_ROOT, site.sourceFile.fileName),
        line: lineOf(entry.readAt),
        writtenAt: `${fileOf(inner.key)}:${lineOf(inner.key)}`,
        modelName: site.modelName,
        shape: site.shape,
        relation: relation,
        column: column,
        isDeep: resolveObject(inner.value) !== null,
        isReadPerReader: site.isReadPerReader,
      });
    }
  }
}

// Each `field` of a table's columns or a detail's fields.
function collectFromFieldList(
  site: ReadSite,
  list: ts.ArrayLiteralExpression,
  readAt: ts.Node | null,
  out: Array<RelationSelectSite>,
  depth: number = 0,
): void {
  for (const element of list.elements) {
    if (ts.isSpreadElement(element)) {
      const spread: ts.ArrayLiteralExpression | null = resolveArray(
        element.expression,
      );

      if (spread && depth < MAX_DEPTH) {
        collectFromFieldList(
          site,
          spread,
          readAt ??
            (spread.getSourceFile() === site.sourceFile ? null : element),
          out,
          depth + 1,
        );
      }

      continue;
    }

    const item: ts.ObjectLiteralExpression | null = resolveObject(element);

    if (!item) {
      continue;
    }

    const field: ts.Expression | undefined =
      readObjectProperties(item).get("field");
    const fieldSelect: ts.ObjectLiteralExpression | null = field
      ? resolveObject(field)
      : null;

    if (fieldSelect) {
      collectFromSelect(
        site,
        fieldSelect,
        readAt ??
          (fieldSelect.getSourceFile() === site.sourceFile ? null : element),
        out,
      );
    }
  }
}

/*
 * What each shape beside a `modelType` reads. `isReadPerReader`: the props
 * are themselves what getSelectReadableThroughRelations is handed (the
 * server's `{ modelType, select, props }`).
 */
function collectFromProps(
  props: Map<string, ts.Expression>,
  sourceFile: ts.SourceFile,
  modelNames: Set<string>,
  out: Array<RelationSelectSite>,
  isReadPerReader: boolean = false,
): void {
  const modelType: ts.Expression | undefined = props.get("modelType");

  if (!modelType) {
    return;
  }

  const modelName: string | null = resolveModelName(
    modelType,
    sourceFile,
    modelNames,
  );

  if (!modelName) {
    return;
  }

  for (const shape of SHAPES) {
    let expression: ts.Expression | undefined = props.get(shape);

    if (!expression) {
      continue;
    }

    /*
     * `select: PermissionGate.getSelectReadableThroughRelations(Model,
     * A_SELECT)`: the select is the one it is handed, sent for each reader
     * without what a relation reads for some readers alone.
     */
    let isHandedToPerReaderSelect: boolean = isReadPerReader;
    const unwrappedExpression: ts.Expression = unwrapExpression(expression);

    if (isPerReaderSelectCall(unwrappedExpression)) {
      const handed: ts.Expression | undefined =
        unwrappedExpression.arguments[1];

      if (!handed) {
        continue;
      }

      expression = handed;
      isHandedToPerReaderSelect = true;
    }

    const site: ReadSite = {
      modelName: modelName,
      shape: shape,
      sourceFile: sourceFile,
      isReadPerReader: isHandedToPerReaderSelect,
    };

    // Named whole (`select: A_SELECT`): read at the name.
    const readAt: ts.Node | null = ts.isIdentifier(unwrapExpression(expression))
      ? expression
      : null;

    if (
      shape === SelectShape.Select ||
      shape === SelectShape.SelectMoreFields
    ) {
      const select: ts.ObjectLiteralExpression | null =
        resolveObject(expression);

      if (select) {
        collectFromSelect(site, select, readAt, out);
      }

      continue;
    }

    const list: ts.ArrayLiteralExpression | null = resolveArray(expression);

    if (list) {
      collectFromFieldList(site, list, readAt, out);
    }
  }
}

function collectFromFile(
  sourceFile: ts.SourceFile,
  modelNames: Set<string>,
  out: Array<RelationSelectSite>,
): void {
  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      collectFromProps(
        readObjectProperties(node),
        sourceFile,
        modelNames,
        out,
        // The server's getSelectReadableThroughRelations({ modelType, select, props }).
        isPerReaderSelectCall(node.parent) && node.parent.arguments[0] === node,
      );
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      collectFromProps(
        readJsxAttributes(node.attributes),
        sourceFile,
        modelNames,
        out,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

export function collectRelationSelectSites(
  directories: Array<string> = SCAN_DIRECTORIES,
): Array<RelationSelectSite> {
  const modelNames: Set<string> = listModelNames();
  const sites: Array<RelationSelectSite> = [];

  for (const directory of directories) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const filePath of listSourceFiles(directory)) {
      collectFromFile(parseFile(filePath), modelNames, sites);
    }
  }

  return sites;
}

/*
 * Only the models a relation select actually names are loaded, rather than the
 * whole DatabaseModels index - a few dozen instead of several hundred, which is
 * the difference between this costing seconds and costing a minute.
 */
async function loadModel(modelName: string): Promise<BaseModel | null> {
  try {
    const imported: { default: { new (): BaseModel } } = await import(
      path.join(MODEL_DIR, modelName)
    );

    return new imported.default();
  } catch {
    return null;
  }
}

// Where a site is read, and where its column is written when that is elsewhere.
function where(site: RelationSelectSite): string {
  const readAt: string = `${site.file}:${site.line}`;

  return site.writtenAt === readAt
    ? readAt
    : `${readAt} (written at ${site.writtenAt})`;
}

/*
 * Checks every site against the models the server will use, as
 * QueryPermission.checkRelationQueryPermission does.
 */
export async function scanRelationSelects(
  directories: Array<string> = SCAN_DIRECTORIES,
): Promise<RelationSelectScan> {
  const sites: Array<RelationSelectSite> =
    collectRelationSelectSites(directories);
  const modelCache: Map<string, BaseModel | null> = new Map();
  const violations: Array<string> = [];
  let checkedCount: number = 0;

  const modelFor: (name: string) => Promise<BaseModel | null> = async (
    name: string,
  ): Promise<BaseModel | null> => {
    if (!modelCache.has(name)) {
      modelCache.set(name, await loadModel(name));
    }

    return modelCache.get(name) ?? null;
  };

  for (const site of sites) {
    const outerModel: BaseModel | null = await modelFor(site.modelName);

    if (!outerModel) {
      continue;
    }

    let relationMetadata: TableColumnMetadata | undefined = undefined;

    try {
      relationMetadata = outerModel.getTableColumnMetadata(site.relation);
    } catch {
      continue;
    }

    /*
     * Not every nested object under a select is a relation - `select` also
     * carries shapes the permission layer never walks. Only Entity and
     * EntityArray columns reach checkRelationQueryPermission's inner loop.
     */
    if (
      !relationMetadata ||
      !relationMetadata.modelType ||
      (relationMetadata.type !== TableColumnType.Entity &&
        relationMetadata.type !== TableColumnType.EntityArray)
    ) {
      continue;
    }

    const relatedModel: BaseModel = new relationMetadata.modelType();

    checkedCount++;

    if (site.isDeep) {
      violations.push(
        `${where(site)} - ${site.modelName}.${site.relation} selects ` +
          `${relatedModel.singularName}.${site.column} as a relation of its ` +
          `own. The read throws "You cannot query deep relations. Querying ` +
          `deep relations is not supported." Select its id here and read ` +
          `what it names on its own.`,
      );
      continue;
    }

    const columnMetadata: TableColumnMetadata =
      relatedModel.getTableColumnMetadata(site.column);

    if (!columnMetadata) {
      violations.push(
        `${where(site)} - ${site.modelName}.${site.relation} selects ` +
          `"${site.column}", which is not a column on ${relatedModel.singularName}.`,
      );
      continue;
    }

    if (
      !columnMetadata.canReadOnRelationQuery &&
      !EXCLUDED_COLUMN_NAMES.includes(site.column)
    ) {
      violations.push(
        `${where(site)} - ${site.modelName}.${site.relation} selects ` +
          `${relatedModel.singularName}.${site.column}, but that column has no ` +
          `canReadOnRelationQuery. The read throws "Column ${site.column} on ` +
          `${relatedModel.singularName} does not support read on relation query." ` +
          `Read it from the ${relatedModel.singularName} itself, or add ` +
          `canReadOnRelationQuery to the column if everyone who reads ` +
          `${site.modelName} may read it.`,
      );
      continue;
    }

    /*
     * A column a relation reads only for those who may read it on the
     * related record (RelationReaders.ColumnReaders, #10281): every other
     * reader of the relation is refused the whole read, so a page sends it
     * only for the readers who may.
     */
    if (
      RelationReadersUtil.isHeldToItsOwnRead(columnMetadata) &&
      !site.isReadPerReader
    ) {
      violations.push(
        `${where(site)} - ${site.modelName}.${site.relation} selects ` +
          `${relatedModel.singularName}.${site.column}, which a relation reads ` +
          `only for those who may read it on the ${relatedModel.singularName} ` +
          `itself (RelationReaders.ColumnReaders). Every other reader of ` +
          `${site.modelName} is refused the whole read, "You do not have ` +
          `permissions to read ${site.column} of ${relatedModel.singularName} ` +
          `through ${site.relation} on ${outerModel.singularName}." Hand the ` +
          `select to PermissionGate.${PER_READER_SELECT_FUNCTION} (Query` +
          `Permission's on the server), or show the column only to those who ` +
          `may read it (PermissionGate.canReadThroughRelation).`,
      );
    }
  }

  return {
    sites: sites,
    checkedCount: checkedCount,
    violations: Array.from(new Set(violations)).sort(),
  };
}
