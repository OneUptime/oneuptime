import type BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import type { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import type TableColumnTypeEnum from "../../../Types/Database/TableColumnType";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY RELATION RESOLVES, WHICHEVER MODEL A PROCESS LOADS FIRST.
 *
 * A relation's eager `modelType: X` is read while its model's file is
 * evaluated. When X's file imports that model back - directly, or through
 * other files - the two are an import cycle, and whichever of them a process
 * happens to load first is evaluated while the other is not: the eager
 * reference keeps undefined for good, and a query that selects the relation
 * fails with "Select not supported on createdByUser of Incident Severity
 * because this column modelType is not found". It did, on the 16.0.0
 * branch, when User.ts was loaded before Project.ts (User keeps its relation
 * to Project, User.sampleProject, and Project imports User back), for twelve
 * relations: Project's, IncidentSeverity's and AlertSeverity's created/
 * deleted/archived by, Reseller's and ResellerPlan's.
 *
 * Inside a cycle, then, a relation is lazy - modelTypeThunk, resolved on
 * first read, once every model has loaded. This reads the require graph as
 * TypeScript emits it (an import only ever used as a type is not emitted, so
 * it makes no cycle) from both model indexes, and checks:
 *
 *  - that no decorator in a cycle names a model of the same cycle eagerly -
 *    which is broken whenever that model is the one loaded first;
 *  - every module of every cycle of models, loaded first in a module
 *    registry of its own, then every other model: every relation of every
 *    model resolves to a model.
 *
 * Relation Column Model Type Coverage checks every relation in the order the
 * models index loads them; this checks the orders a process can load them in.
 */

const COMMON: string = path.join(__dirname, "..", "..", "..");
const DATABASE_MODELS: string = path.join(COMMON, "Models", "DatabaseModels");
const MODEL_INDEXES: ReadonlyArray<string> = [
  path.join(DATABASE_MODELS, "Index.ts"),
  path.join(COMMON, "Models", "AnalyticsModels", "Index.ts"),
];

/*
 * Common's own compiler options, emitting CommonJS as ts-node and ts-jest
 * run it. emitDecoratorMetadata matters: a decorated property's type is
 * emitted as a value, so its import is kept.
 */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  ...ts.convertCompilerOptionsFromJson(
    (
      ts.readConfigFile(path.join(COMMON, "tsconfig.json"), ts.sys.readFile)
        .config as { compilerOptions: Record<string, unknown> }
    ).compilerOptions,
    COMMON,
  ).options,
  module: ts.ModuleKind.CommonJS,
};

const EMITTED_REQUIRE: string = 'require\\("([^"]+)"\\)';

const relative: (file: string) => string = (file: string): string => {
  return path.relative(COMMON, file).split(path.sep).join("/");
};

// The TypeScript file a relative import or require names.
const sourceOf: (from: string, specifier: string) => string | undefined = (
  from: string,
  specifier: string,
): string | undefined => {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const base: string = path.resolve(path.dirname(from), specifier);

  return [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "Index.ts"),
    path.join(base, "index.ts"),
  ].find((candidate: string): boolean => {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  });
};

const emittedRequires: Map<string, Set<string>> = new Map();

// The files a file requires once TypeScript has emitted it.
const requiresOf: (file: string) => Set<string> = (
  file: string,
): Set<string> => {
  const known: Set<string> | undefined = emittedRequires.get(file);

  if (known) {
    return known;
  }

  const javascript: string = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: COMPILER_OPTIONS,
    fileName: file,
  }).outputText;
  const requires: Set<string> = new Set();
  const pattern: RegExp = new RegExp(EMITTED_REQUIRE, "g");
  let match: RegExpExecArray | null = pattern.exec(javascript);

  while (match) {
    const required: string | undefined = sourceOf(file, match[1]!);

    if (required) {
      requires.add(required);
    }

    match = pattern.exec(javascript);
  }

  emittedRequires.set(file, requires);

  return requires;
};

// Every file the model indexes load.
const loaded: Set<string> = new Set(MODEL_INDEXES);
const toRead: Array<string> = [...MODEL_INDEXES];

while (toRead.length > 0) {
  for (const required of requiresOf(toRead.pop()!)) {
    if (!loaded.has(required)) {
      loaded.add(required);
      toRead.push(required);
    }
  }
}

// The import cycles among them: strongly connected components (Tarjan).
const cycles: Array<Array<string>> = [];
const visitOrder: Map<string, number> = new Map();
const lowest: Map<string, number> = new Map();
const onPath: Set<string> = new Set();
const pathStack: Array<string> = [];

const connect: (file: string) => void = (file: string): void => {
  visitOrder.set(file, visitOrder.size);
  lowest.set(file, visitOrder.get(file)!);
  pathStack.push(file);
  onPath.add(file);

  for (const required of requiresOf(file)) {
    if (!visitOrder.has(required)) {
      connect(required);
      lowest.set(file, Math.min(lowest.get(file)!, lowest.get(required)!));
    } else if (onPath.has(required)) {
      lowest.set(file, Math.min(lowest.get(file)!, visitOrder.get(required)!));
    }
  }

  if (lowest.get(file) === visitOrder.get(file)) {
    const component: Array<string> = [];
    let member: string;

    do {
      member = pathStack.pop()!;
      onPath.delete(member);
      component.push(member);
    } while (member !== file);

    if (component.length > 1) {
      cycles.push(component.sort());
    }
  }
};

for (const file of loaded) {
  if (!visitOrder.has(file)) {
    connect(file);
  }
}

const isModel: (file: string) => boolean = (file: string): boolean => {
  return path.dirname(file) === DATABASE_MODELS;
};

// Cycles two models or more are in: the ones a relation can cross.
const modelCycles: Array<Array<string>> = cycles.filter(
  (cycle: Array<string>): boolean => {
    return cycle.filter(isModel).length > 1;
  },
);

/*
 * Each decorator's `modelType: X` where X is imported from a file of the same
 * cycle, as "<file>:<line> modelType: X".
 */
const eagerRelationsInCycles: () => Array<string> = (): Array<string> => {
  const eager: Array<string> = [];

  for (const cycle of cycles) {
    for (const file of cycle) {
      const source: ts.SourceFile = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const importedFrom: Map<string, string> = new Map();

      for (const statement of source.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !statement.importClause ||
          statement.importClause.isTypeOnly ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          continue;
        }

        const from: string | undefined = sourceOf(
          file,
          statement.moduleSpecifier.text,
        );

        if (!from) {
          continue;
        }

        const clause: ts.ImportClause = statement.importClause;

        if (clause.name) {
          importedFrom.set(clause.name.text, from);
        }

        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            if (!element.isTypeOnly) {
              importedFrom.set(element.name.text, from);
            }
          }
        }
      }

      const visit: (node: ts.Node, inDecorator: boolean) => void = (
        node: ts.Node,
        inDecorator: boolean,
      ): void => {
        const decorated: boolean = inDecorator || ts.isDecorator(node);

        if (
          decorated &&
          ts.isPropertyAssignment(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === "modelType" &&
          ts.isIdentifier(node.initializer)
        ) {
          const target: string | undefined = importedFrom.get(
            node.initializer.text,
          );

          if (target && cycle.includes(target)) {
            const line: number =
              source.getLineAndCharacterOfPosition(node.getStart(source)).line +
              1;

            eager.push(
              `${relative(file)}:${line} modelType: ${node.initializer.text}`,
            );
          }
        }

        ts.forEachChild(node, (child: ts.Node): void => {
          visit(child, decorated);
        });
      };

      visit(source, false);
    }
  }

  return eager.sort();
};

/*
 * Every module of every cycle of models - each is where a process can enter
 * its cycle - and User and Project, the ends of the cycle that broke 16.0.0,
 * should that cycle ever be gone.
 */
const FIRST_LOADED: ReadonlyArray<string> = Array.from(
  new Set([
    ...modelCycles.flat(),
    path.join(DATABASE_MODELS, "User.ts"),
    path.join(DATABASE_MODELS, "Project.ts"),
  ]),
)
  .map(relative)
  .sort();

type ModelType = { new (): BaseModel; name: string };

const unresolvedRelationsWhenLoadedFirst: (first: string) => Array<string> = (
  first: string,
): Array<string> => {
  const unresolved: Array<string> = [];

  jest.isolateModules(() => {
    jest.requireActual(path.join(COMMON, first.replace(/\.tsx?$/, "")));

    const models: Array<ModelType> = (
      jest.requireActual("../../../Models/DatabaseModels/Index") as {
        default: Array<ModelType>;
      }
    ).default;
    const Base: ModelType = (
      jest.requireActual(
        "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel",
      ) as { default: ModelType }
    ).default;
    const TableColumnType: typeof TableColumnTypeEnum = (
      jest.requireActual("../../../Types/Database/TableColumnType") as {
        default: typeof TableColumnTypeEnum;
      }
    ).default;

    for (const modelType of models) {
      const model: BaseModel = new modelType();

      for (const column of model.getTableColumns().columns) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        if (
          !metadata ||
          (metadata.type !== TableColumnType.Entity &&
            metadata.type !== TableColumnType.EntityArray)
        ) {
          continue;
        }

        const related: unknown = metadata.modelType
          ? new metadata.modelType()
          : undefined;

        if (!(related instanceof Base)) {
          unresolved.push(`${modelType.name}.${column}`);
        }
      }
    }
  });

  return unresolved.sort();
};

describe("the models' import cycles", () => {
  test("are read from the requires TypeScript emits", () => {
    expect(loaded.has(path.join(DATABASE_MODELS, "Project.ts"))).toBe(true);
    expect(
      requiresOf(path.join(DATABASE_MODELS, "Project.ts")).has(
        path.join(DATABASE_MODELS, "User.ts"),
      ),
    ).toBe(true);
  });

  /*
   * A relation listed here is eager inside its cycle: make it lazy, as
   * Project.createdByUser is -
   *
   *   modelTypeThunk: () => {
   *     return User;
   *   },
   *
   * with a comment saying which import brings the model back.
   */
  test("hold no relation that names a model of its own cycle eagerly", () => {
    expect(eagerRelationsInCycles()).toEqual([]);
  });
});

describe("every relation resolves to a model, whichever model loads first", () => {
  test.each(FIRST_LOADED)("%s loaded first", (first: string) => {
    expect(unresolvedRelationsWhenLoadedFirst(first)).toEqual([]);
  });
});
