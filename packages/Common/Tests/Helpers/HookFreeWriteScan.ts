import fs from "fs";
import path from "path";
import ts from "typescript";
import { listTypeScriptFiles, modelFileOf, unwrap } from "./ReferenceNameScan";

/*
 * WRITES THAT GO ROUND DATABASESERVICE'S HOOKS, AND WHETHER THE CODE MAKING
 * EACH ONE RECORDS IT IN THE AUDIT LOG.
 *
 * DatabaseService records every create, update and delete it makes of an
 * audited model (AuditLogService). Four kinds of write never reach it:
 *
 *   - the services' *WithoutHooks writes (one statement, no hooks:
 *     compareAndSetColumnsByIdWithoutHooks and the rest);
 *   - relation writes - `getRepository().createQueryBuilder()
 *     .relation(Model, "labels").of(id).add(ids)`;
 *   - a create or createMany with `ignoreHooks: true`, which DatabaseService
 *     records nothing of;
 *   - raw SQL - UPDATE, INSERT INTO and DELETE FROM a model's table.
 *
 * HookFreeWriteScanner reads every server file under the directories it is
 * given - through the TypeScript AST, so a write named in a comment or a
 * string is none - and answers each such write with the model it writes,
 * when the code says (the service it is made through, the entity it names,
 * the table in the SQL), the columns it writes, when the code says, and
 * whether the function it is in records an audit entry: calls
 * AuditLogService.record*, or a function that does - in its own file or,
 * through an import, in another (findRecordingFunctions). A guard holds the
 * rest to a list (HookFreeWritesAreRecorded.test.ts).
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export enum HookFreeWriteForm {
  WithoutHooks = "WithoutHooks",
  Relation = "Relation",
  IgnoreHooksCreate = "IgnoreHooksCreate",
  RawSql = "RawSql",
}

export enum HookFreeWriteAction {
  Create = "Create",
  Update = "Update",
  Delete = "Delete",
}

export interface HookFreeWrite {
  // From the repository's root.
  file: string;
  line: number;
  form: HookFreeWriteForm;
  action: HookFreeWriteAction;
  // The method, the relation call, or the SQL verb.
  call: string;
  // "Class.method", a function's name, or "(module)".
  inFunction: string;
  // The model's file under Models/DatabaseModels, when the code names it.
  modelFile: string | null;
  // The table a raw statement names.
  tableName: string | null;
  // The columns written, when the code says; null when it does not.
  columns: Array<string> | null;
  // Whether the function the write is in records an audit entry.
  isRecorded: boolean;
}

// A function the scan knows by name, and what it calls.
interface ScannedFunction {
  file: string;
  name: string;
  // Calls it makes: a bare name, `this.name`, or `<Imported>.name`.
  calls: Array<{ receiver: string | null; name: string }>;
  callsTheRecorder: boolean;
}

// What a file imports, by local name: the module specifier.
type Imports = Map<string, string>;

const RECORD_METHOD: RegExp = /^record(Create|Update|Delete|Download)$/;

// What the recorder is called by, wherever it is held.
const RECORDER_NAME: RegExp = /^auditLogService$/i;

// The dashboards' browser code, which writes nothing to the database itself.
const BROWSER_CODE: RegExp =
  /\/(Dashboard|AdminDashboard|StatusPage|Accounts|PublicDashboard)\/src\//;

const SQL_WRITE: RegExp =
  /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+\\?"([A-Z][A-Za-z0-9]*)\\?"/g;

export class HookFreeWriteScanner {
  private repoRoot: string;
  private commonRoot: string;
  private writeMethods: ReadonlySet<string>;
  private functionsByFile: Map<string, Array<ScannedFunction>> = new Map();
  private recording: Set<string> = new Set<string>();
  private serviceModelCache: Map<string, string | null> = new Map();
  private sources: Map<string, ts.SourceFile> = new Map();

  public constructor(data: {
    repoRoot: string;
    commonRoot: string;
    // The *WithoutHooks methods that write.
    writeMethods: ReadonlySet<string>;
  }) {
    this.repoRoot = data.repoRoot;
    this.commonRoot = data.commonRoot;
    this.writeMethods = data.writeMethods;
  }

  // Every hook-free write in the files under `directories`.
  public scan(directories: Array<string>): Array<HookFreeWrite> {
    const files: Array<string> = [];

    for (const directory of directories) {
      for (const file of listTypeScriptFiles(directory)) {
        if (this.isServerCode(file)) {
          files.push(file);
        }
      }
    }

    for (const file of files) {
      this.functionsByFile.set(file, this.readFunctions(file));
    }

    this.findRecordingFunctions();

    const writes: Array<HookFreeWrite> = [];

    for (const file of files) {
      writes.push(...this.findWrites(file));
    }

    return writes;
  }

  // Whether `name`, a function of `file`, records an audit entry.
  public isRecordingFunction(file: string, name: string): boolean {
    return this.recording.has(`${file}#${name}`);
  }

  /*
   * Whether `caller`, a function of `file`, calls `callee` there: directly,
   * or through the file's other functions (a bare name, `this.`, or their
   * class), closures in its body included.
   */
  public callsInFile(file: string, caller: string, callee: string): boolean {
    const functions: Array<ScannedFunction> =
      this.functionsByFile.get(file) || [];
    const seen: Set<string> = new Set<string>();
    const queue: Array<string> = [caller];

    while (queue.length > 0) {
      const name: string = queue.shift()!;

      if (seen.has(name)) {
        continue;
      }

      seen.add(name);

      for (const entry of functions) {
        if (entry.name !== name) {
          continue;
        }

        for (const call of entry.calls) {
          for (const target of functions) {
            const dot: number = target.name.lastIndexOf(".");
            const ownName: string =
              dot === -1 ? target.name : target.name.slice(dot + 1);
            const ownClass: string | null =
              dot === -1 ? null : target.name.slice(0, dot);

            if (
              ownName !== call.name ||
              (call.receiver !== null &&
                call.receiver !== "this" &&
                call.receiver !== ownClass)
            ) {
              continue;
            }

            if (target.name === callee) {
              return true;
            }

            queue.push(target.name);
          }
        }
      }
    }

    return false;
  }

  private isServerCode(file: string): boolean {
    const relative: string = path
      .relative(this.repoRoot, file)
      .split(path.sep)
      .join("/");

    return (
      !relative.includes("/Tests/") &&
      !relative.includes("/node_modules/") &&
      !BROWSER_CODE.test(relative) &&
      !relative.includes("/Docs/Content/") &&
      // Schema migrations change tables, not anybody's records.
      !relative.includes("/Infrastructure/Postgres/SchemaMigrations/")
    );
  }

  private source(file: string): ts.SourceFile {
    let source: ts.SourceFile | undefined = this.sources.get(file);

    if (!source) {
      source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      this.sources.set(file, source);
    }

    return source;
  }

  private importsOf(source: ts.SourceFile): Imports {
    const imports: Imports = new Map<string, string>();

    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }

      const specifier: string = statement.moduleSpecifier.text;
      const clause: ts.ImportClause | undefined = statement.importClause;

      if (clause?.name) {
        imports.set(clause.name.text, specifier);
      }

      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          imports.set(element.name.text, specifier);
        }
      }
    }

    return imports;
  }

  // The file an import names, or null for a package's.
  private resolveImport(fromFile: string, specifier: string): string | null {
    let base: string;

    if (specifier.startsWith("Common/")) {
      base = path.join(this.commonRoot, specifier.slice("Common/".length));
    } else if (specifier.startsWith(".")) {
      base = path.resolve(path.dirname(fromFile), specifier);
    } else {
      return null;
    }

    for (const candidate of [`${base}.ts`, path.join(base, "Index.ts")]) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  // The model a service file is the service of.
  private modelOfServiceFile(file: string): string | null {
    if (!this.serviceModelCache.has(file)) {
      this.serviceModelCache.set(
        file,
        modelFileOf(fs.readFileSync(file, "utf8")),
      );
    }

    return this.serviceModelCache.get(file) || null;
  }

  // The name a function-like node is known by in its file.
  private functionName(node: ts.Node): string | null {
    if (
      (ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      const owner: string | null =
        ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)
          ? this.className(node.parent)
          : null;

      return owner ? `${owner}.${node.name.text}` : node.name.text;
    }

    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isVariableDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name)
    ) {
      return node.parent.name.text;
    }

    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isPropertyDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name)
    ) {
      const owner: string | null = this.className(node.parent.parent);
      return owner
        ? `${owner}.${node.parent.name.text}`
        : node.parent.name.text;
    }

    return null;
  }

  private className(node: ts.Node | undefined): string | null {
    if (node && ts.isClassDeclaration(node)) {
      return node.name?.text || "(class)";
    }

    if (node && ts.isClassExpression(node)) {
      return node.name?.text || "(class)";
    }

    return null;
  }

  /*
   * The named function a node is in, outermost first: a closure inside a
   * method is the method's. "(module)" for code outside any.
   */
  private enclosingFunctions(node: ts.Node): Array<string> {
    const names: Array<string> = [];
    let current: ts.Node | undefined = node.parent;

    while (current) {
      const name: string | null = this.functionName(current);

      if (name) {
        names.unshift(name);
      }

      current = current.parent;
    }

    return names.length > 0 ? names : ["(module)"];
  }

  private readFunctions(file: string): Array<ScannedFunction> {
    const source: ts.SourceFile = this.source(file);
    const functions: Array<ScannedFunction> = [];

    const visitFunction: (node: ts.Node, name: string) => void = (
      node: ts.Node,
      name: string,
    ): void => {
      const entry: ScannedFunction = {
        file,
        name,
        calls: [],
        callsTheRecorder: false,
      };

      const visitBody: (child: ts.Node) => void = (child: ts.Node): void => {
        if (ts.isCallExpression(child)) {
          const callee: ts.Expression = unwrap(child.expression);

          if (ts.isIdentifier(callee)) {
            entry.calls.push({ receiver: null, name: callee.text });
          } else if (ts.isPropertyAccessExpression(callee)) {
            const receiver: ts.Expression = unwrap(callee.expression);
            const receiverName: string | null =
              receiver.kind === ts.SyntaxKind.ThisKeyword
                ? "this"
                : ts.isIdentifier(receiver)
                  ? receiver.text
                  : null;

            entry.calls.push({
              receiver: receiverName,
              name: callee.name.text,
            });

            if (
              RECORD_METHOD.test(callee.name.text) &&
              receiverName &&
              RECORDER_NAME.test(receiverName)
            ) {
              entry.callsTheRecorder = true;
            }
          }
        }

        ts.forEachChild(child, visitBody);
      };

      ts.forEachChild(node, visitBody);
      functions.push(entry);
    };

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      const name: string | null = this.functionName(node);

      if (name) {
        visitFunction(node, name);
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    return functions;
  }

  /*
   * The functions that record an audit entry: those that call the recorder,
   * then - until nothing changes - those that call one of them, in their
   * own file (a bare name, `this.`, their class) or through an import.
   */
  private findRecordingFunctions(): void {
    for (const functions of this.functionsByFile.values()) {
      for (const entry of functions) {
        if (entry.callsTheRecorder) {
          this.recording.add(`${entry.file}#${entry.name}`);
        }
      }
    }

    let isChanged: boolean = true;

    while (isChanged) {
      isChanged = false;

      for (const [file, functions] of this.functionsByFile) {
        const imports: Imports = this.importsOf(this.source(file));

        for (const entry of functions) {
          const key: string = `${file}#${entry.name}`;

          if (this.recording.has(key)) {
            continue;
          }

          if (
            entry.calls.some(
              (call: { receiver: string | null; name: string }): boolean => {
                return this.callsRecordingFunction({ file, imports, call });
              },
            )
          ) {
            this.recording.add(key);
            isChanged = true;
          }
        }
      }
    }
  }

  private callsRecordingFunction(data: {
    file: string;
    imports: Imports;
    call: { receiver: string | null; name: string };
  }): boolean {
    const { file, imports, call } = data;
    const ownFunctions: Array<ScannedFunction> =
      this.functionsByFile.get(file) || [];

    // A function of the same file: a bare name, `this.`, or its class.
    const sameFile: boolean = ownFunctions.some(
      (entry: ScannedFunction): boolean => {
        const ownName: string = entry.name.includes(".")
          ? entry.name.slice(entry.name.lastIndexOf(".") + 1)
          : entry.name;
        const ownClass: string | null = entry.name.includes(".")
          ? entry.name.slice(0, entry.name.lastIndexOf("."))
          : null;

        return (
          ownName === call.name &&
          (call.receiver === null ||
            call.receiver === "this" ||
            call.receiver === ownClass) &&
          this.recording.has(`${file}#${entry.name}`)
        );
      },
    );

    if (sameFile) {
      return true;
    }

    // A function of an imported file: `<Imported>.name(...)`.
    if (!call.receiver || !imports.has(call.receiver)) {
      return false;
    }

    const imported: string | null = this.resolveImport(
      file,
      imports.get(call.receiver)!,
    );

    if (!imported) {
      return false;
    }

    return (this.functionsByFile.get(imported) || []).some(
      (entry: ScannedFunction): boolean => {
        return (
          (entry.name === call.name || entry.name.endsWith(`.${call.name}`)) &&
          this.recording.has(`${imported}#${entry.name}`)
        );
      },
    );
  }

  /*
   * Whether a function the write is in records: a named one the scan knows
   * records, or any - a route's handler is an arrow function with no name -
   * whose own body calls the recorder or a function that records.
   */
  private isRecorded(file: string, node: ts.Node): boolean {
    const imports: Imports = this.importsOf(this.source(file));
    let current: ts.Node | undefined = node.parent;

    while (current) {
      if (ts.isFunctionLike(current)) {
        const name: string | null = this.functionName(current);

        if (name && this.recording.has(`${file}#${name}`)) {
          return true;
        }

        if (!name && this.bodyRecords(file, imports, current)) {
          return true;
        }
      }

      current = current.parent;
    }

    return false;
  }

  private bodyRecords(file: string, imports: Imports, body: ts.Node): boolean {
    let records: boolean = false;

    const visit: (child: ts.Node) => void = (child: ts.Node): void => {
      if (records) {
        return;
      }

      if (ts.isCallExpression(child)) {
        const callee: ts.Expression = unwrap(child.expression);
        let call: { receiver: string | null; name: string } | null = null;

        if (ts.isIdentifier(callee)) {
          call = { receiver: null, name: callee.text };
        } else if (ts.isPropertyAccessExpression(callee)) {
          const receiver: ts.Expression = unwrap(callee.expression);
          call = {
            receiver:
              receiver.kind === ts.SyntaxKind.ThisKeyword
                ? "this"
                : ts.isIdentifier(receiver)
                  ? receiver.text
                  : null,
            name: callee.name.text,
          };

          if (
            RECORD_METHOD.test(call.name) &&
            call.receiver &&
            RECORDER_NAME.test(call.receiver)
          ) {
            records = true;
            return;
          }
        }

        if (call && this.callsRecordingFunction({ file, imports, call })) {
          records = true;
          return;
        }
      }

      ts.forEachChild(child, visit);
    };

    ts.forEachChild(body, visit);

    return records;
  }

  private findWrites(file: string): Array<HookFreeWrite> {
    const source: ts.SourceFile = this.source(file);
    const imports: Imports = this.importsOf(source);
    const relative: string = path
      .relative(this.repoRoot, file)
      .split(path.sep)
      .join("/");
    const writes: Array<HookFreeWrite> = [];

    const base: (
      node: ts.Node,
    ) => Pick<HookFreeWrite, "file" | "line" | "inFunction" | "isRecorded"> = (
      node: ts.Node,
    ) => {
      const functions: Array<string> = this.enclosingFunctions(node);

      return {
        file: relative,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        inFunction: functions[0]!,
        isRecorded: this.isRecorded(file, node),
      };
    };

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee: ts.Expression = unwrap(node.expression);

        if (ts.isPropertyAccessExpression(callee)) {
          const method: string = callee.name.text;

          if (this.writeMethods.has(method)) {
            writes.push({
              ...base(node),
              form: HookFreeWriteForm.WithoutHooks,
              action: HookFreeWriteAction.Update,
              call: method,
              modelFile: this.modelOfReceiver({
                file,
                imports,
                receiver: unwrap(callee.expression),
              }),
              tableName: null,
              columns: this.columnsWritten(node),
            });
          }

          if (["add", "remove", "set", "addAndRemove"].includes(method)) {
            const relation: { model: ts.Expression; column: string } | null =
              this.relationOf(callee.expression);

            if (relation) {
              writes.push({
                ...base(node),
                form: HookFreeWriteForm.Relation,
                action: HookFreeWriteAction.Update,
                call: `relation(…, "${relation.column}").${method}`,
                modelFile: this.modelOfEntity(file, imports, relation.model),
                tableName: null,
                columns: [relation.column],
              });
            }
          }

          if (
            (method === "create" || method === "createMany") &&
            this.passesIgnoreHooks(node)
          ) {
            writes.push({
              ...base(node),
              form: HookFreeWriteForm.IgnoreHooksCreate,
              action: HookFreeWriteAction.Create,
              call: method,
              modelFile: this.modelOfReceiver({
                file,
                imports,
                receiver: unwrap(callee.expression),
              }),
              tableName: null,
              columns: null,
            });
          }
        }
      }

      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)
      ) {
        const text: string = node.getText(source);

        for (const match of text.matchAll(SQL_WRITE)) {
          const verb: string = match[1]!.replace(/\s+/g, " ").toUpperCase();

          writes.push({
            ...base(node),
            form: HookFreeWriteForm.RawSql,
            action:
              verb === "UPDATE"
                ? HookFreeWriteAction.Update
                : verb === "INSERT INTO"
                  ? HookFreeWriteAction.Create
                  : HookFreeWriteAction.Delete,
            call: verb,
            modelFile: null,
            tableName: match[2]!,
            columns:
              verb === "UPDATE"
                ? this.sqlSetColumns(text.slice(match.index! + match[0].length))
                : null,
          });
        }

        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    return writes;
  }

  // The service a write is made through, as the model it serves.
  private modelOfReceiver(data: {
    file: string;
    imports: Imports;
    receiver: ts.Expression;
  }): string | null {
    if (data.receiver.kind === ts.SyntaxKind.ThisKeyword) {
      return this.modelOfServiceFile(data.file);
    }

    if (
      ts.isIdentifier(data.receiver) &&
      data.imports.has(data.receiver.text)
    ) {
      const imported: string | null = this.resolveImport(
        data.file,
        data.imports.get(data.receiver.text)!,
      );

      return imported ? this.modelOfServiceFile(imported) : null;
    }

    return null;
  }

  // An entity named in `.relation(Entity, ...)`, as its model file.
  private modelOfEntity(
    file: string,
    imports: Imports,
    entity: ts.Expression,
  ): string | null {
    const named: ts.Expression = unwrap(entity);

    if (!ts.isIdentifier(named) || !imports.has(named.text)) {
      return null;
    }

    const match: RegExpMatchArray | null = imports
      .get(named.text)!
      .match(/(?:^|\/)Models\/DatabaseModels\/([\w/]+)$/);

    if (match) {
      return match[1]!;
    }

    void file;
    return null;
  }

  // The `.relation(Entity, "column")` a write chain goes through, if any.
  private relationOf(
    expression: ts.Expression,
  ): { model: ts.Expression; column: string } | null {
    let current: ts.Expression = unwrap(expression);

    for (let depth: number = 0; depth < 6; depth++) {
      if (!ts.isCallExpression(current)) {
        return null;
      }

      const callee: ts.Expression = unwrap(current.expression);

      if (!ts.isPropertyAccessExpression(callee)) {
        return null;
      }

      if (callee.name.text === "relation") {
        const [entity, column] = current.arguments;

        return entity && column && ts.isStringLiteral(column)
          ? { model: entity, column: column.text }
          : null;
      }

      current = unwrap(callee.expression);
    }

    return null;
  }

  // Whether a create's own argument says `ignoreHooks: true`.
  private passesIgnoreHooks(call: ts.CallExpression): boolean {
    const argument: ts.Expression | undefined = call.arguments[0]
      ? unwrap(call.arguments[0])
      : undefined;

    if (!argument || !ts.isObjectLiteralExpression(argument)) {
      return false;
    }

    for (const property of argument.properties) {
      if (
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "props"
      ) {
        const props: ts.Expression = ts.isShorthandPropertyAssignment(property)
          ? property.name
          : unwrap(property.initializer);

        return this.saysIgnoreHooks(props, call, 0);
      }
    }

    return false;
  }

  /*
   * Whether props say `ignoreHooks: true`: an object literal, through its
   * spreads, or a local constant that holds one.
   */
  private saysIgnoreHooks(
    expression: ts.Expression,
    scope: ts.Node,
    depth: number,
  ): boolean {
    if (depth > 4) {
      return false;
    }

    const props: ts.Expression = unwrap(expression);

    if (ts.isObjectLiteralExpression(props)) {
      return props.properties.some(
        (entry: ts.ObjectLiteralElementLike): boolean => {
          if (ts.isSpreadAssignment(entry)) {
            return this.saysIgnoreHooks(entry.expression, scope, depth + 1);
          }

          return (
            ts.isPropertyAssignment(entry) &&
            ts.isIdentifier(entry.name) &&
            entry.name.text === "ignoreHooks" &&
            unwrap(entry.initializer).kind === ts.SyntaxKind.TrueKeyword
          );
        },
      );
    }

    if (!ts.isIdentifier(props)) {
      return false;
    }

    let body: ts.Node | undefined = scope.parent;

    while (body && !ts.isFunctionLike(body) && !ts.isSourceFile(body)) {
      body = body.parent;
    }

    let initializer: ts.Expression | undefined = undefined;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === props.text &&
        node.initializer
      ) {
        initializer = node.initializer;
      }

      ts.forEachChild(node, visit);
    };

    if (body) {
      visit(body);
    }

    return initializer
      ? this.saysIgnoreHooks(initializer, scope, depth + 1)
      : false;
  }

  /*
   * The columns a *WithoutHooks write sets: the keys of its `data`, `set`
   * and `add`, through spreads, conditionals and a local constant built in
   * the same function. Null when any of it cannot be read off the code.
   */
  private columnsWritten(call: ts.CallExpression): Array<string> | null {
    const argument: ts.Expression | undefined = call.arguments[0]
      ? unwrap(call.arguments[0])
      : undefined;

    if (!argument || !ts.isObjectLiteralExpression(argument)) {
      return null;
    }

    const columns: Set<string> = new Set<string>();
    let isKnown: boolean = true;

    for (const property of argument.properties) {
      const name: string | null =
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        ts.isIdentifier(property.name)
          ? property.name.text
          : null;

      if (!name || !["data", "set", "add"].includes(name)) {
        continue;
      }

      const value: ts.Expression = ts.isShorthandPropertyAssignment(property)
        ? property.name
        : (property as ts.PropertyAssignment).initializer;

      if (!this.keysOf(value, call, columns, 0)) {
        isKnown = false;
      }
    }

    return isKnown ? Array.from(columns).sort() : null;
  }

  private keysOf(
    expression: ts.Expression,
    scope: ts.Node,
    keys: Set<string>,
    depth: number,
  ): boolean {
    if (depth > 4) {
      return false;
    }

    const value: ts.Expression = unwrap(expression);

    if (ts.isConditionalExpression(value)) {
      return (
        this.keysOf(value.whenTrue, scope, keys, depth + 1) &&
        this.keysOf(value.whenFalse, scope, keys, depth + 1)
      );
    }

    if (ts.isObjectLiteralExpression(value)) {
      let isKnown: boolean = true;

      for (const property of value.properties) {
        if (ts.isSpreadAssignment(property)) {
          isKnown =
            this.keysOf(property.expression, scope, keys, depth + 1) && isKnown;
          continue;
        }

        if (
          property.name &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ) {
          keys.add(property.name.text);
          continue;
        }

        isKnown = false;
      }

      return isKnown;
    }

    if (ts.isIdentifier(value)) {
      return this.keysOfLocal(value.text, scope, keys, depth);
    }

    return false;
  }

  /*
   * A local constant's keys: its object literal, and every property the
   * function then assigns to it (`update.status = ...`).
   */
  private keysOfLocal(
    name: string,
    scope: ts.Node,
    keys: Set<string>,
    depth: number,
  ): boolean {
    let body: ts.Node | undefined = scope.parent;

    while (body && !ts.isFunctionLike(body) && !ts.isSourceFile(body)) {
      body = body.parent;
    }

    if (!body) {
      return false;
    }

    let declaration: ts.VariableDeclaration | null = null;
    let isKnown: boolean = true;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name
      ) {
        declaration = node;
      }

      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const target: ts.Expression = unwrap(node.left);

        if (
          ts.isPropertyAccessExpression(target) &&
          ts.isIdentifier(target.expression) &&
          target.expression.text === name
        ) {
          keys.add(target.name.text);
        }

        if (
          ts.isElementAccessExpression(target) &&
          ts.isIdentifier(target.expression) &&
          target.expression.text === name
        ) {
          if (ts.isStringLiteral(target.argumentExpression)) {
            keys.add(target.argumentExpression.text);
          } else {
            isKnown = false;
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(body);

    const found: ts.VariableDeclaration | null = declaration;

    if (!found || !(found as ts.VariableDeclaration).initializer) {
      return false;
    }

    return (
      this.keysOf(
        (found as ts.VariableDeclaration).initializer!,
        scope,
        keys,
        depth + 1,
      ) && isKnown
    );
  }

  // `SET "a" = ..., "b" = ...`: the columns an UPDATE statement sets.
  private sqlSetColumns(rest: string): Array<string> | null {
    const set: RegExpMatchArray | null = rest.match(
      /\bSET\b([\s\S]{0,4000}?)(?:\bWHERE\b|\bFROM\b|\bRETURNING\b|$)/i,
    );

    if (!set) {
      return null;
    }

    const columns: Set<string> = new Set<string>();

    for (const match of set[1]!.matchAll(/\\?"(\w+)\\?"\s*=/g)) {
      columns.add(match[1]!);
    }

    return columns.size > 0 ? Array.from(columns).sort() : null;
  }
}
