import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE READS OF A WRITE'S QUERY, FOUND IN THE SOURCE.
 *
 * What the guards over the hooks of updates and deletes scan for
 * (UpdateChecksReadHeldRows, DeleteChecksReadHeldRows): each place a
 * function reads the query of an update or a delete - to read the rows it
 * names by it, say - outside the write path itself. The source is read as a
 * TypeScript syntax tree, so a read is found whatever shape it takes:
 *
 *   - `updateBy.query`, `onUpdate.updateBy.query`, `updateBy["query"]`;
 *   - through a name the write is held under: a parameter or variable
 *     declared as one (`(change: UpdateBy<Model>)`), one it is copied to
 *     (`const change = data.updateBy`, `{ ...updateBy, data }`), or one
 *     destructured out of something that holds it
 *     (`const { updateBy: change } = data`);
 *   - destructured: `const { query } = updateBy`, `({ query }: UpdateBy<M>)
 *     => ...`, `const { updateBy: { query } } = data`, and
 *     `({ query } = updateBy)`.
 *
 * Not counted: the query written (`updateBy.query = ...`), narrowed in place
 * (`updateBy.query = narrow(updateBy.query)`), read for the one row it names
 * by a plain id (DatabaseService.getOneRowIdNamedBy), or read in a hook that
 * runs once the write is done - and, where a guard allows it, asked whether
 * it names its rows by id at all (`!deleteBy.query._id`).
 */

export interface WriteQueryScan {
  // The names a write goes by, alone or as a property: `updateBy`, `onUpdate.updateBy`.
  writeNames: ReadonlySet<string>;
  // The types a write is declared with, whatever it is named: `UpdateBy<Model>`.
  writeTypes: ReadonlySet<string>;
  // Hooks that run once the write is done: what they read was written.
  afterTheWrite: ReadonlySet<string>;
  // Whether `!write.query._id` and `if (write.query._id)` go uncounted.
  allowsIdPresenceTest?: boolean | undefined;
}

// One read of a write's query: the function it is in, where, and its line.
export interface WriteQueryRead {
  functionName: string;
  line: number;
  text: string;
}

// What reads the one row a query names by its id.
const ONE_ROW_ID_READER: RegExp = /\bgetOneRowIdNamedBy$/;

// The source files scanned: TypeScript, not tests.
const SOURCE_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

// `(x)`, `x!`, `x as T`, `<T>x`, `x satisfies T`: the expression itself.
function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// The text of a property name, when it is written as one: `query`, `"query"`.
function propertyNameText(name: ts.Node | undefined): string | null {
  if (!name) {
    return null;
  }

  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return null;
}

// Whether a declared type names a write: `UpdateBy<Model>`, `UpdateBy<M> | null`.
function namesWriteType(
  type: ts.TypeNode | undefined,
  scan: WriteQueryScan,
): boolean {
  if (!type) {
    return false;
  }

  if (ts.isTypeReferenceNode(type)) {
    const typeName: ts.EntityName = type.typeName;
    const text: string = ts.isIdentifier(typeName)
      ? typeName.text
      : typeName.right.text;

    return scan.writeTypes.has(text);
  }

  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
    return type.types.some((each: ts.TypeNode): boolean => {
      return namesWriteType(each, scan);
    });
  }

  if (ts.isParenthesizedTypeNode(type)) {
    return namesWriteType(type.type, scan);
  }

  return false;
}

/*
 * Where `name` is bound in a binding name: the declaration itself for a
 * plain name, the element for a destructured one.
 */
function findBinding(
  bindingName: ts.BindingName,
  name: string,
  declaration: ts.Node,
): ts.Node | null {
  if (ts.isIdentifier(bindingName)) {
    return bindingName.text === name ? declaration : null;
  }

  for (const element of bindingName.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    const found: ts.Node | null = findBinding(element.name, name, element);

    if (found) {
      return found;
    }
  }

  return null;
}

// The declarations a block-like node holds: its variable statements'.
function findInStatements(
  statements: ts.NodeArray<ts.Statement>,
  name: string,
): ts.Node | null {
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      const found: ts.Node | null = findBinding(
        declaration.name,
        name,
        declaration,
      );

      if (found) {
        return found;
      }
    }
  }

  return null;
}

/*
 * The declaration an identifier refers to - a parameter, a variable, or an
 * element destructured into one - by the scopes it is written in, the
 * nearest first. Null for one declared nowhere in the file (an import, a
 * global).
 */
function findDeclaration(identifier: ts.Identifier): ts.Node | null {
  const name: string = identifier.text;
  let current: ts.Node | undefined = identifier.parent;

  while (current) {
    if (ts.isFunctionLike(current)) {
      for (const parameter of current.parameters) {
        const found: ts.Node | null = findBinding(
          parameter.name,
          name,
          parameter,
        );

        if (found) {
          return found;
        }
      }
    }

    if (
      ts.isBlock(current) ||
      ts.isSourceFile(current) ||
      ts.isModuleBlock(current) ||
      ts.isCaseClause(current) ||
      ts.isDefaultClause(current)
    ) {
      const found: ts.Node | null = findInStatements(current.statements, name);

      if (found) {
        return found;
      }
    }

    if (
      (ts.isForStatement(current) ||
        ts.isForOfStatement(current) ||
        ts.isForInStatement(current)) &&
      current.initializer &&
      ts.isVariableDeclarationList(current.initializer)
    ) {
      for (const declaration of current.initializer.declarations) {
        const found: ts.Node | null = findBinding(
          declaration.name,
          name,
          declaration,
        );

        if (found) {
          return found;
        }
      }
    }

    if (ts.isCatchClause(current) && current.variableDeclaration) {
      const found: ts.Node | null = findBinding(
        current.variableDeclaration.name,
        name,
        current.variableDeclaration,
      );

      if (found) {
        return found;
      }
    }

    current = current.parent;
  }

  return null;
}

/*
 * The scanner for one source file: whether an expression holds a write, and
 * whether a node reads its query.
 */
class WriteQueryReader {
  private readonly bindingIsWrite: Map<ts.Node, boolean> = new Map<
    ts.Node,
    boolean
  >();

  public constructor(private readonly scan: WriteQueryScan) {}

  /*
   * Whether `expression` holds a write: one of its names, alone or as a
   * property (`updateBy`, `onUpdate.updateBy`, `data["updateBy"]`), or a
   * name the write is held under (isWriteBinding).
   */
  public isWrite(expression: ts.Expression): boolean {
    const node: ts.Expression = unwrap(expression);

    if (ts.isIdentifier(node)) {
      if (this.scan.writeNames.has(node.text)) {
        return true;
      }

      const declaration: ts.Node | null = findDeclaration(node);

      return declaration ? this.isWriteBinding(declaration) : false;
    }

    if (ts.isPropertyAccessExpression(node)) {
      return this.scan.writeNames.has(node.name.text);
    }

    if (ts.isElementAccessExpression(node)) {
      const key: string | null = propertyNameText(node.argumentExpression);

      return key !== null && this.scan.writeNames.has(key);
    }

    return false;
  }

  /*
   * Whether a declaration holds a write: declared as one, copied from one
   * (`= updateBy`, `= { ...updateBy, data }` that keeps its query), or
   * destructured out of what holds one (`const { updateBy: change } = data`).
   */
  private isWriteBinding(declaration: ts.Node): boolean {
    const known: boolean | undefined = this.bindingIsWrite.get(declaration);

    if (known !== undefined) {
      return known;
    }

    // A binding that refers to itself, however far round, holds nothing.
    this.bindingIsWrite.set(declaration, false);

    let isWrite: boolean = false;

    if (ts.isParameter(declaration)) {
      isWrite = namesWriteType(declaration.type, this.scan);
    } else if (ts.isVariableDeclaration(declaration)) {
      isWrite =
        namesWriteType(declaration.type, this.scan) ||
        Boolean(
          declaration.initializer &&
            this.copiesWrite(declaration.initializer),
        );
    } else if (ts.isBindingElement(declaration)) {
      const taken: string | null = propertyNameText(
        declaration.propertyName || declaration.name,
      );

      isWrite = taken !== null && this.scan.writeNames.has(taken);
    }

    this.bindingIsWrite.set(declaration, isWrite);

    return isWrite;
  }

  // `updateBy`, or `{ ...updateBy, data }` - a copy that keeps its query.
  private copiesWrite(initializer: ts.Expression): boolean {
    const node: ts.Expression = unwrap(initializer);

    if (!ts.isObjectLiteralExpression(node)) {
      return this.isWrite(node);
    }

    const setsQuery: boolean = node.properties.some(
      (property: ts.ObjectLiteralElementLike): boolean => {
        return propertyNameText(property.name) === "query";
      },
    );

    return (
      !setsQuery &&
      node.properties.some((property: ts.ObjectLiteralElementLike) => {
        return (
          ts.isSpreadAssignment(property) && this.isWrite(property.expression)
        );
      })
    );
  }

  // `<write>.query` and `<write>["query"]`.
  public isWriteQuery(node: ts.Node): boolean {
    if (ts.isPropertyAccessExpression(node)) {
      return node.name.text === "query" && this.isWrite(node.expression);
    }

    if (ts.isElementAccessExpression(node)) {
      return (
        propertyNameText(node.argumentExpression) === "query" &&
        this.isWrite(node.expression)
      );
    }

    return false;
  }

  /*
   * A destructuring that takes the query out of a write:
   * `const { query } = updateBy`, `({ query }: UpdateBy<M>)`,
   * `const { updateBy: { query } } = data`, `({ query } = updateBy)`. Each
   * element that takes it counts as one read.
   */
  public isQueryDestructured(node: ts.Node): boolean {
    if (ts.isBindingElement(node)) {
      if (
        propertyNameText(node.propertyName || node.name) !== "query" ||
        !ts.isObjectBindingPattern(node.parent)
      ) {
        return false;
      }

      return this.patternHoldsWrite(node.parent);
    }

    if (
      (ts.isShorthandPropertyAssignment(node) ||
        ts.isPropertyAssignment(node)) &&
      propertyNameText(node.name) === "query" &&
      ts.isObjectLiteralExpression(node.parent)
    ) {
      const assignment: ts.Node = node.parent.parent;

      return (
        ts.isBinaryExpression(assignment) &&
        assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        assignment.left === node.parent &&
        this.isWrite(assignment.right)
      );
    }

    return false;
  }

  // Whether an object binding pattern is bound to a write.
  private patternHoldsWrite(pattern: ts.ObjectBindingPattern): boolean {
    const owner: ts.Node = pattern.parent;

    if (ts.isVariableDeclaration(owner)) {
      return (
        namesWriteType(owner.type, this.scan) ||
        Boolean(owner.initializer && this.isWrite(owner.initializer))
      );
    }

    if (ts.isParameter(owner)) {
      return namesWriteType(owner.type, this.scan);
    }

    // `{ updateBy: { query } }`: the element above takes a write.
    if (ts.isBindingElement(owner)) {
      const taken: string | null = propertyNameText(
        owner.propertyName || owner.name,
      );

      return taken !== null && this.scan.writeNames.has(taken);
    }

    return false;
  }
}

// The class member or top-level function a node is in.
export function functionNameOf(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;
  let name: string = "<module>";

  while (current) {
    if (
      (ts.isMethodDeclaration(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isPropertyDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }

    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }

    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      ts.isSourceFile(current.parent.parent.parent)
    ) {
      name = current.name.text;
    }

    current = current.parent;
  }

  return name;
}

// `write.query = ...`: the query itself, written.
function isAssigned(node: ts.Node): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === node
  );
}

// Inside `write.query = narrow(write.query)`: narrowed in place.
function isNarrowedInPlace(node: ts.Node, reader: WriteQueryReader): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current && !ts.isStatement(current)) {
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      reader.isWriteQuery(current.left)
    ) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

// `getOneRowIdNamedBy(write.query)`: the one row it names by id.
function isOneRowIdRead(node: ts.Node): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isCallExpression(parent) &&
    parent.arguments.includes(node as ts.Expression) &&
    ONE_ROW_ID_READER.test(parent.expression.getText())
  );
}

/*
 * `!write.query._id` or `if (write.query._id)`: whether the query names its
 * rows by id at all - what the query says, not what a row holds.
 */
function isIdPresenceTest(node: ts.Node): boolean {
  const idRead: ts.Node = node.parent;

  if (
    !ts.isPropertyAccessExpression(idRead) ||
    idRead.expression !== node ||
    idRead.name.text !== "_id"
  ) {
    return false;
  }

  const test: ts.Node = idRead.parent;

  return (
    (ts.isPrefixUnaryExpression(test) &&
      test.operator === ts.SyntaxKind.ExclamationToken) ||
    (ts.isIfStatement(test) && test.expression === idRead)
  );
}

// Each read of a write's query in one source file.
export function findWriteQueryReadsIn(
  source: ts.SourceFile,
  scan: WriteQueryScan,
): Array<WriteQueryRead> {
  const reader: WriteQueryReader = new WriteQueryReader(scan);
  const reads: Array<WriteQueryRead> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const isRead: boolean =
      (reader.isWriteQuery(node) &&
        !isAssigned(node) &&
        !isNarrowedInPlace(node, reader) &&
        !isOneRowIdRead(node) &&
        !(scan.allowsIdPresenceTest && isIdPresenceTest(node))) ||
      reader.isQueryDestructured(node);

    if (isRead && !scan.afterTheWrite.has(functionNameOf(node))) {
      reads.push({
        functionName: functionNameOf(node),
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: node.parent.getText().split("\n")[0]!.trim(),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return reads;
}

// Each read of a write's query in a snippet of code, by function (tests of the scan).
export function findWriteQueryReadsInCode(
  code: string,
  scan: WriteQueryScan,
): Array<string> {
  const source: ts.SourceFile = ts.createSourceFile(
    "Example.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
  );

  return findWriteQueryReadsIn(source, scan).map(
    (read: WriteQueryRead): string => {
      return read.functionName;
    },
  );
}

// A read found in the repository: `<file>::<function>`, where, and its line.
export interface RepositoryWriteQueryRead {
  key: string;
  line: number;
  text: string;
}

function sourceFiles(
  repositoryRoot: string,
  directory: string,
  skippedDirectoryNames: ReadonlySet<string>,
): Array<string> {
  const absolute: string = path.join(repositoryRoot, directory);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!skippedDirectoryNames.has(entry.name)) {
        files.push(
          ...sourceFiles(repositoryRoot, relative, skippedDirectoryNames),
        );
      }

      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(relative);
    }
  }

  return files;
}

/*
 * Each read of a write's query in the source of `directories` - but the
 * write path itself (`writePath`) - by `<file>::<function>`. A directory
 * missing from the checkout (ee/) is skipped.
 */
export function findWriteQueryReads(data: {
  repositoryRoot: string;
  directories: Array<string>;
  skippedDirectoryNames: ReadonlySet<string>;
  writePath: string;
  scan: WriteQueryScan;
}): Array<RepositoryWriteQueryRead> {
  const reads: Array<RepositoryWriteQueryRead> = [];

  // A file that names no write and no write type has nothing to find.
  const namesAWrite: RegExp = new RegExp(
    `\\b(${[...data.scan.writeNames, ...data.scan.writeTypes].join("|")})\\b`,
  );

  for (const directory of data.directories) {
    for (const file of sourceFiles(
      data.repositoryRoot,
      directory,
      data.skippedDirectoryNames,
    )) {
      if (file === data.writePath) {
        continue;
      }

      const text: string = fs.readFileSync(
        path.join(data.repositoryRoot, file),
        "utf8",
      );

      if (!namesAWrite.test(text)) {
        continue;
      }

      const source: ts.SourceFile = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
      );

      for (const read of findWriteQueryReadsIn(source, data.scan)) {
        reads.push({
          key: `${file}::${read.functionName}`,
          line: read.line,
          text: read.text,
        });
      }
    }
  }

  return reads;
}
