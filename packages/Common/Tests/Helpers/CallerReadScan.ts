import fs from "fs";
import path from "path";
import ts from "typescript";
import { ScanFinding, modelFileOf, unwrap } from "./ReferenceNameScan";

/*
 * The columns server code reads WITH A CALLER'S PROPS: the select and the
 * query of a read made through a service - `XService.findOneById({ select,
 * query, props })`, findOneBy, findBy, findAllBy, countBy, and `this.` the
 * same inside a service - whose props are not OneUptime's own. A read made
 * with the caller's props is held to the caller's column permissions
 * (SelectPermission, QueryPermission), so a column no permission reads
 * (read: []) refuses it for everyone: "You do not have permissions to select
 * on - isGlobalLlm. No permission allows it: the column is not readable
 * through the API." - an LLM provider's Test button, for its own project's
 * owner.
 *
 * Props count as OneUptime's own when they are an object literal saying
 * isRoot or isMasterAdmin, or a variable the same function sets to one.
 * Anything else - `props`, `data.props`, a literal with only a tenant - is a
 * caller's. Only real syntax is read, through the TypeScript AST.
 */

export type ReadKind = "select" | "query";

export interface CallerRead extends ScanFinding {
  kind: ReadKind;
  // The DatabaseModels file the read is made on ("LlmProvider").
  modelFile: string;
  column: string;
  // The read's method: findOneById, findBy, ...
  method: string;
}

export const READ_METHODS: Array<string> = [
  "findOneById",
  "findOneBy",
  "findBy",
  "findAllBy",
  "countBy",
];

const WHITESPACE: RegExp = /\s+/g;

const SERVICE_IMPORT: RegExp = /(?:^|\/)Services\/([\w]+Service)$/;

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function propertyNamed(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return literal.properties.find((property: ts.ObjectLiteralElementLike) => {
    return (
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
      property.name.text === name
    );
  });
}

// `{ isRoot: true, ... }` or `{ isMasterAdmin: true, ... }`.
function saysOneUptime(literal: ts.ObjectLiteralExpression): boolean {
  return ["isRoot", "isMasterAdmin"].some((flag: string): boolean => {
    const property: ts.ObjectLiteralElementLike | undefined = propertyNamed(
      literal,
      flag,
    );

    return Boolean(
      property &&
        ts.isPropertyAssignment(property) &&
        unwrap(property.initializer).kind === ts.SyntaxKind.TrueKeyword,
    );
  });
}

// The function a node sits in, or the file.
function enclosingFunction(node: ts.Node): ts.Node {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current)
    ) {
      return current;
    }
  }

  return node.getSourceFile();
}

/*
 * Whether `props` are OneUptime's own: a literal saying so, or a variable
 * of the function (or an outer one) declared as such a literal.
 */
function isOneUptimesProps(props: ts.Expression): boolean {
  const expression: ts.Expression = unwrap(props);

  if (ts.isObjectLiteralExpression(expression)) {
    return saysOneUptime(expression);
  }

  if (!ts.isIdentifier(expression)) {
    return false;
  }

  for (
    let scope: ts.Node = enclosingFunction(expression);
    ;
    scope = enclosingFunction(scope)
  ) {
    let found: boolean | null = null;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        found === null &&
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === expression.text &&
        node.initializer
      ) {
        const initializer: ts.Expression = unwrap(node.initializer);
        found =
          ts.isObjectLiteralExpression(initializer) &&
          saysOneUptime(initializer);
      }

      ts.forEachChild(node, visit);
    };

    visit(scope);

    if (found !== null) {
      return found;
    }

    if (ts.isSourceFile(scope)) {
      return false;
    }
  }
}

function topLevelKeys(literal: ts.Expression | undefined): Array<ts.Node> {
  if (!literal) {
    return [];
  }

  const expression: ts.Expression = unwrap(literal);

  if (!ts.isObjectLiteralExpression(expression)) {
    return [];
  }

  return expression.properties.filter(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        (ts.isIdentifier(property.name) ||
          ts.isStringLiteralLike(property.name))
      );
    },
  );
}

function keyName(property: ts.Node): string {
  return (
    (property as ts.PropertyAssignment).name as
      | ts.Identifier
      | ts.StringLiteralLike
  ).text;
}

/*
 * The DatabaseModels file each service a file imports serves, by the name
 * it is imported under. `resolveService` reads a service file by its module
 * path, relative to the importing file.
 */
function importedServiceModels(
  source: ts.SourceFile,
  filePath: string,
): Map<string, string> {
  const models: Map<string, string> = new Map();

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.name
    ) {
      continue;
    }

    const specifier: string = statement.moduleSpecifier.text;

    if (!SERVICE_IMPORT.test(specifier)) {
      continue;
    }

    const servicePath: string | null = resolveModule(filePath, specifier);

    if (!servicePath) {
      continue;
    }

    const modelFile: string | null = modelFileOf(
      fs.readFileSync(servicePath, "utf8"),
    );

    if (modelFile) {
      models.set(statement.importClause.name.text, modelFile);
    }
  }

  return models;
}

const COMMON_DIRECTORY: string = path.resolve(__dirname, "..", "..");

function resolveModule(fromFile: string, specifier: string): string | null {
  const base: string = specifier.startsWith("Common/")
    ? path.join(COMMON_DIRECTORY, specifier.slice("Common/".length))
    : path.resolve(path.dirname(fromFile), specifier);

  for (const candidate of [`${base}.ts`, path.join(base, "Index.ts")]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/*
 * Every column one file reads with a caller's props, through a service it
 * imports or - inside a service - through `this`.
 */
export function findCallerReads(filePath: string, text: string): Array<CallerRead> {
  const source: ts.SourceFile = parse(path.basename(filePath), text);
  const services: Map<string, string> = importedServiceModels(source, filePath);
  const ownModel: string | null = modelFileOf(text);
  const found: Array<CallerRead> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(unwrap(node.expression)) &&
      READ_METHODS.includes(
        (unwrap(node.expression) as ts.PropertyAccessExpression).name.text,
      ) &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(unwrap(node.arguments[0]))
    ) {
      const callee: ts.PropertyAccessExpression = unwrap(
        node.expression,
      ) as ts.PropertyAccessExpression;
      const target: ts.Expression = unwrap(callee.expression);
      const modelFile: string | null =
        target.kind === ts.SyntaxKind.ThisKeyword
          ? ownModel
          : ts.isIdentifier(target)
            ? services.get(target.text) || null
            : null;
      const argument: ts.ObjectLiteralExpression = unwrap(
        node.arguments[0],
      ) as ts.ObjectLiteralExpression;
      const props: ts.ObjectLiteralElementLike | undefined = propertyNamed(
        argument,
        "props",
      );

      if (
        modelFile &&
        props &&
        ts.isPropertyAssignment(props) &&
        !isOneUptimesProps(props.initializer)
      ) {
        for (const kind of ["select", "query"] as Array<ReadKind>) {
          const clause: ts.ObjectLiteralElementLike | undefined =
            propertyNamed(argument, kind);

          const keys: Array<ts.Node> =
            clause && ts.isPropertyAssignment(clause)
              ? topLevelKeys(clause.initializer)
              : [];

          for (const key of keys) {
            found.push({
              file: filePath,
              line:
                source.getLineAndCharacterOfPosition(key.getStart(source))
                  .line + 1,
              text: node
                .getText(source)
                .replace(WHITESPACE, " ")
                .slice(0, 160),
              kind: kind,
              modelFile: modelFile,
              column: keyName(key),
              method: callee.name.text,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}
