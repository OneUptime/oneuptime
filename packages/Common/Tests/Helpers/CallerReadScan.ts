import fs from "fs";
import path from "path";
import ts from "typescript";
import { ScanFinding, modelFileOf, unwrap } from "./ReferenceNameScan";

/*
 * The columns server code reads WITH A CALLER'S PROPS: the select and the
 * query of a read made through a service - `XService.findOneById({ select,
 * query, props })`, findOneBy, findBy, findAllBy, countBy, `this.` the same
 * inside a service, and `this.service.` inside a model's API - whose props
 * are not OneUptime's own. A read made with the caller's props is held to
 * the caller's column permissions (SelectPermission, QueryPermission), so a
 * column no permission reads (read: []) refuses it for everyone: "You do not
 * have permissions to select on - isGlobalLlm. No permission allows it: the
 * column is not readable through the API." - an LLM provider's Test button,
 * for its own project's owner. A column read by fewer people than its table
 * refuses the rest of the table's readers in the same way.
 *
 * A key of a relation's select (`project: { name: true }`) is a read of the
 * related record's column (`relatedColumn`), which the relation query reads
 * only when the related model lets it (canReadOnRelationQuery).
 *
 * The select and the query are read where they are written: an object
 * literal in the call, or a variable the same function (or an outer one)
 * declares as one. Anything built some other way is not read.
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
  /*
   * For a key of a relation's select: the column of the related record it
   * reads (`project: { name: true }` reads "name" through "project").
   * Undefined for the read's own columns.
   */
  relatedColumn?: string | undefined;
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

/*
 * Writes by query: the rows they change are found by `query`, which is held
 * to the caller's read permissions like a read's (QueryPermission runs for
 * every operation). What they write is the write checks' business.
 */
export const WRITE_BY_QUERY_METHODS: Array<string> = [
  "updateOneBy",
  "updateBy",
  "deleteOneBy",
  "deleteBy",
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
      (ts.isIdentifier(property.name) ||
        ts.isStringLiteralLike(property.name)) &&
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

function isFunctionLike(
  node: ts.Node,
): node is
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

// The function a node sits in, or the file.
function enclosingFunction(node: ts.Node): ts.Node {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (isFunctionLike(current)) {
      return current;
    }
  }

  return node.getSourceFile();
}

/*
 * What a variable is declared as, by the function the name is used in or
 * an outer one, nearest first: its initializer, unwrapped - or undefined
 * when no function on the way declares it with one, or when the nearest
 * one takes it as a parameter. A function inside one of them has a scope
 * of its own, so what it declares is not looked at.
 */
function declaredValue(name: ts.Identifier): ts.Expression | undefined {
  for (
    let scope: ts.Node = enclosingFunction(name);
    ;
    scope = enclosingFunction(scope)
  ) {
    if (
      isFunctionLike(scope) &&
      scope.parameters.some((parameter: ts.ParameterDeclaration): boolean => {
        return (
          ts.isIdentifier(parameter.name) && parameter.name.text === name.text
        );
      })
    ) {
      return undefined;
    }

    let found: ts.Expression | undefined = undefined;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (found !== undefined || (node !== scope && isFunctionLike(node))) {
        return;
      }

      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name.text &&
        node.initializer
      ) {
        found = unwrap(node.initializer);
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(scope);

    if (found !== undefined) {
      return found;
    }

    if (ts.isSourceFile(scope)) {
      return undefined;
    }
  }
}

/*
 * The object literal an expression is: itself, or a variable declared as
 * one. Undefined for anything else - a call, a spread of something built.
 */
function objectLiteralOf(
  expression: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expression) {
    return undefined;
  }

  const value: ts.Expression = unwrap(expression);

  if (ts.isObjectLiteralExpression(value)) {
    return value;
  }

  if (ts.isIdentifier(value)) {
    const declared: ts.Expression | undefined = declaredValue(value);

    return declared && ts.isObjectLiteralExpression(declared)
      ? declared
      : undefined;
  }

  return undefined;
}

/*
 * The value a property of a call's argument is given: `select: x` gives x,
 * and the shorthand `{ select }` the variable named select.
 */
function valueOf(
  property: ts.ObjectLiteralElementLike | undefined,
): ts.Expression | undefined {
  if (!property) {
    return undefined;
  }

  if (ts.isPropertyAssignment(property)) {
    return property.initializer;
  }

  if (ts.isShorthandPropertyAssignment(property)) {
    return property.name;
  }

  return undefined;
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

  const declared: ts.Expression | undefined = declaredValue(expression);

  return Boolean(
    declared &&
      ts.isObjectLiteralExpression(declared) &&
      saysOneUptime(declared),
  );
}

function namedKeys(
  literal: ts.ObjectLiteralExpression | undefined,
): Array<ts.PropertyAssignment | ts.ShorthandPropertyAssignment> {
  if (!literal) {
    return [];
  }

  return literal.properties.filter(
    (
      property: ts.ObjectLiteralElementLike,
    ): property is ts.PropertyAssignment | ts.ShorthandPropertyAssignment => {
      return (
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        (ts.isIdentifier(property.name) ||
          ts.isStringLiteralLike(property.name))
      );
    },
  );
}

function keyName(
  property: ts.PropertyAssignment | ts.ShorthandPropertyAssignment,
): string {
  return (property.name as ts.Identifier | ts.StringLiteralLike).text;
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

// `this.service`: the service of the model a BaseAPI is for.
function isOwnService(target: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(target) &&
    unwrap(target.expression).kind === ts.SyntaxKind.ThisKeyword &&
    target.name.text === "service"
  );
}

/*
 * Every column one file reads with a caller's props, through a service it
 * imports or - inside a service - through `this`, or - inside a model's
 * API - through `this.service`.
 */
export function findCallerReads(
  filePath: string,
  text: string,
): Array<CallerRead> {
  const source: ts.SourceFile = parse(path.basename(filePath), text);
  const services: Map<string, string> = importedServiceModels(source, filePath);
  const ownModel: string | null = modelFileOf(text);
  const found: Array<CallerRead> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const methodName: string | undefined =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(unwrap(node.expression))
        ? (unwrap(node.expression) as ts.PropertyAccessExpression).name.text
        : undefined;

    if (
      ts.isCallExpression(node) &&
      methodName &&
      (READ_METHODS.includes(methodName) ||
        WRITE_BY_QUERY_METHODS.includes(methodName)) &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(unwrap(node.arguments[0]))
    ) {
      const callee: ts.PropertyAccessExpression = unwrap(
        node.expression,
      ) as ts.PropertyAccessExpression;
      // A write by query reads only through its query.
      const kinds: Array<ReadKind> = READ_METHODS.includes(methodName)
        ? ["select", "query"]
        : ["query"];
      const target: ts.Expression = unwrap(callee.expression);
      const modelFile: string | null =
        target.kind === ts.SyntaxKind.ThisKeyword || isOwnService(target)
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
      const propsValue: ts.Expression | undefined = valueOf(props);

      if (modelFile && propsValue && !isOneUptimesProps(propsValue)) {
        const readAt: (
          key: ts.Node,
          read: {
            kind: ReadKind;
            column: string;
            relatedColumn?: string | undefined;
          },
        ) => void = (
          key: ts.Node,
          read: {
            kind: ReadKind;
            column: string;
            relatedColumn?: string | undefined;
          },
        ): void => {
          found.push({
            file: filePath,
            line:
              key.getSourceFile().getLineAndCharacterOfPosition(key.getStart())
                .line + 1,
            text: node.getText(source).replace(WHITESPACE, " ").slice(0, 160),
            kind: read.kind,
            modelFile: modelFile,
            column: read.column,
            ...(read.relatedColumn !== undefined
              ? { relatedColumn: read.relatedColumn }
              : {}),
            method: callee.name.text,
          });
        };

        for (const kind of kinds) {
          const clause: ts.ObjectLiteralExpression | undefined =
            objectLiteralOf(valueOf(propertyNamed(argument, kind)));

          for (const key of namedKeys(clause)) {
            const column: string = keyName(key);

            readAt(key, { kind: kind, column: column });

            if (kind !== "select") {
              continue;
            }

            // A relation's select: the related record's columns it reads.
            const relation: ts.ObjectLiteralExpression | undefined =
              objectLiteralOf(valueOf(key));

            for (const relatedKey of namedKeys(relation)) {
              readAt(relatedKey, {
                kind: kind,
                column: column,
                relatedColumn: keyName(relatedKey),
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}
