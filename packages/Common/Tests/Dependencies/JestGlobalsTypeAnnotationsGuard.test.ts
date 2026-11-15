import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * NO @types/jest MOCK TYPE ON A SPY FROM @jest/globals (#8598).
 *
 * A test that imports `jest` from "@jest/globals" gets jest-mock's spies:
 * jest.spyOn returns jest-mock's SpyInstance, jest.fn its Mock. Its value
 * `jest` is not a namespace, so `jest.SpiedFunction<...>` or
 * `jest.Mock<...>` in a type position is still @types/jest's global
 * namespace, and the two disagree:
 *
 *   - jest.SpiedFunction<typeof X.method> is not what spyOn returns: its
 *     mock's lastCall is required where jest-mock's is optional, so
 *     `let spy: jest.SpiedFunction<...> = jest.spyOn(...)` is TS2322;
 *   - @types/jest's jest.Mock<T> takes the mock's RETURN type, so
 *     jest.Mock<(rows) => Promise<void>> is a mock that returns a
 *     function, and its mockResolvedValue takes never (TS2345).
 *
 * jest transpiles tests without a type check, so such a suite passes and
 * `npm run compile-tests` (Common) or `npm run compile` (App) turns red for
 * every branch merged with main: on 2026-11-15 seven suites at once
 * (IncomingRequestSecretGate, IncomingRequestSecretPolicy,
 * IncomingRequestSecretService, OnCallPolicyRunFailedStepRecovery,
 * SloReleaseCheckMeasurement, SloRequestCounting, AdminProjectChangePlan;
 * #8597). In such a file, write jest-mock's own types,
 * `SpyInstance<typeof X.method>` and `Mock<(rows) => Promise<void>>`,
 * imported from "jest-mock", as the rest of the tests do. jest.Mock<R> with
 * a return type, jest.SpyInstance and jest.MockedFunction keep their
 * @types/jest meaning and are left alone, as is a file that uses the global
 * `jest`, where the types and the values agree.
 *
 * This reads every test file under packages/Common/Tests, packages/App/Tests
 * and ee/Tests (when the checkout has ee/; CI's Common jobs remove it) and
 * fails on each such annotation, with its file and line. The rule itself is
 * shown to be real below: the shapes it refuses fail tsc, and the ones it
 * accepts compile.
 */

const REPOSITORY: string = path.resolve(__dirname, "..", "..", "..", "..");
const COMMON: string = path.join(REPOSITORY, "packages", "Common");

const TEST_DIRECTORIES: ReadonlyArray<string> = [
  "packages/Common/Tests",
  "packages/App/Tests",
  "ee/Tests",
];

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", "build"]);

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

// A file that might hold one: it names @jest/globals and one of the two types.
const MIGHT_HOLD_ONE: RegExp =
  /@jest\/globals[\s\S]*\bjest\s*\.\s*(SpiedFunction|Mock)\b|\bjest\s*\.\s*(SpiedFunction|Mock)\b[\s\S]*@jest\/globals/;

// The local name `jest` is imported under from "@jest/globals", if it is.
function jestImportedAs(sourceFile: ts.SourceFile): string | null {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@jest/globals"
    ) {
      continue;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    for (const element of bindings.elements) {
      if ((element.propertyName || element.name).text === "jest") {
        return element.name.text;
      }
    }
  }

  return null;
}

// Whether a type argument is a function's type: `(rows) => ...` or `typeof f`.
function isFunctionType(node: ts.TypeNode | undefined): boolean {
  if (!node) {
    return false;
  }

  if (ts.isParenthesizedTypeNode(node)) {
    return isFunctionType(node.type);
  }

  return ts.isFunctionTypeNode(node) || ts.isTypeQueryNode(node);
}

// Each annotation the rule refuses in `source`, as "<label>:<line> <what to write>".
export function findJestTypeTraps(
  label: string,
  source: string,
): Array<string> {
  if (!MIGHT_HOLD_ONE.test(source)) {
    return [];
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.Latest,
    true,
    label.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /*
   * Only a file that imports `jest` from @jest/globals: with the global
   * `jest`, jest.spyOn and jest.SpiedFunction are both @types/jest's.
   */
  if (!jestImportedAs(sourceFile)) {
    return [];
  }

  const found: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isQualifiedName(node.typeName) &&
      ts.isIdentifier(node.typeName.left) &&
      node.typeName.left.text === "jest"
    ) {
      const kind: string = node.typeName.right.text;
      const line: number =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;

      if (kind === "SpiedFunction") {
        found.push(
          `${label}:${line} jest.SpiedFunction<...> - write SpyInstance<...> from "jest-mock": jest.spyOn from @jest/globals returns it`,
        );
      } else if (kind === "Mock" && isFunctionType(node.typeArguments?.[0])) {
        found.push(
          `${label}:${line} jest.Mock<function> - write Mock<function> from "jest-mock": @types/jest's jest.Mock takes the mock's return type`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

function testFilesUnder(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) {
        files.push(...testFilesUnder(full));
      }
    } else if (TYPESCRIPT_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

const IMPORTS_JEST: string =
  'import { describe, expect, jest, test } from "@jest/globals";\n';

describe("the rule, on the shapes that broke compile-tests on 2026-11-15", () => {
  test("refuses a spy from @jest/globals annotated jest.SpiedFunction", () => {
    expect(
      findJestTypeTraps(
        "Gate.test.ts",
        IMPORTS_JEST +
          "let getMonitor: jest.SpiedFunction<typeof Cache.getMonitor>;\n" +
          'getMonitor = jest.spyOn(Cache, "getMonitor");\n',
      ),
    ).toEqual([
      'Gate.test.ts:2 jest.SpiedFunction<...> - write SpyInstance<...> from "jest-mock": jest.spyOn from @jest/globals returns it',
    ]);
  });

  test("refuses one written over several lines, and one inside another type", () => {
    expect(
      findJestTypeTraps(
        "Counting.test.ts",
        IMPORTS_JEST +
          "let isTracked: jest.SpiedFunction<\n" +
          "  typeof Store.isTracked\n" +
          ">;\n" +
          "const spies: Array<jest.SpiedFunction<typeof Store.read>> = [];\n",
      ).map((problem: string): string => {
        return problem.split(" ")[0] as string;
      }),
    ).toEqual(["Counting.test.ts:2", "Counting.test.ts:5"]);
  });

  test("refuses jest.Mock given a function's type, written any of the ways it was", () => {
    expect(
      findJestTypeTraps(
        "Recovery.test.ts",
        IMPORTS_JEST +
          "type RepositoryUpdate = jest.Mock<\n" +
          "  (where: Record<string, unknown>) => Promise<{ affected: number }>\n" +
          ">;\n" +
          "const onChange: jest.Mock<(data: Row) => void> = jest.fn();\n" +
          "const load: jest.Mock<typeof loadRuns> = jest.fn();\n" +
          "const parenthesized: jest.Mock<((rows: Array<Row>) => void)> = jest.fn();\n",
      ).map((problem: string): string => {
        return problem.split(" ").slice(0, 2).join(" ");
      }),
    ).toEqual([
      "Recovery.test.ts:2 jest.Mock<function>",
      "Recovery.test.ts:5 jest.Mock<function>",
      "Recovery.test.ts:6 jest.Mock<function>",
      "Recovery.test.ts:7 jest.Mock<function>",
    ]);
  });

  test("finds jest imported under another name too, and among other imports", () => {
    expect(
      findJestTypeTraps(
        "Renamed.test.ts",
        'import { afterEach, jest as j, test } from "@jest/globals";\n' +
          "let spy: jest.SpiedFunction<typeof API.post>;\n",
      ),
    ).toHaveLength(1);
  });
});

describe("the rule, on what it accepts", () => {
  test("jest-mock's own types, as the rest of the tests write them", () => {
    expect(
      findJestTypeTraps(
        "Right.test.ts",
        IMPORTS_JEST +
          'import { Mock, SpyInstance } from "jest-mock";\n' +
          "let getMonitor: SpyInstance<typeof Cache.getMonitor>;\n" +
          "const onChange: Mock<(data: Row) => void> = jest.fn();\n",
      ),
    ).toEqual([]);
  });

  test("@types/jest's types where they mean what they say", () => {
    expect(
      findJestTypeTraps(
        "ReturnTypes.test.ts",
        IMPORTS_JEST +
          "const save: jest.Mock<Promise<void>> = jest.fn() as never;\n" +
          "const bare: jest.Mock = jest.fn() as never;\n" +
          "let fetchSpy: jest.SpyInstance;\n" +
          "let post: jest.MockedFunction<typeof API.post>;\n",
      ),
    ).toEqual([]);
  });

  test("a file that uses the global jest, where the types and the values agree", () => {
    expect(
      findJestTypeTraps(
        "Global.test.ts",
        'let spy: jest.SpiedFunction<typeof API.post> = jest.spyOn(API, "post");\n' +
          "const onChange: jest.Mock<(data: Row) => void> = jest.fn();\n",
      ),
    ).toEqual([]);
  });

  test("a comment or a string that only names them", () => {
    expect(
      findJestTypeTraps(
        "Commented.test.ts",
        IMPORTS_JEST +
          "// Not jest.SpiedFunction<typeof X.y>: jest-mock's SpyInstance.\n" +
          'const why: string = "jest.Mock<(rows) => void> takes a return type";\n',
      ),
    ).toEqual([]);
  });
});

/*
 * The rule is real: compiled as compile-tests compiles a test, with
 * Common's own compiler options and its installed @jest/globals, jest-mock
 * and @types/jest, the shapes it refuses fail and the ones it accepts pass.
 */
describe("the rule is tsc's, not a style", () => {
  const compile: (source: string) => Array<string> = (
    source: string,
  ): Array<string> => {
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "jest-globals-types-"),
    );
    const file: string = path.join(directory, "Fixture.test.ts");

    try {
      fs.writeFileSync(file, source);
      // Common's own @jest/globals, jest-mock and @types/jest, as a test of Common resolves them.
      fs.symlinkSync(
        path.join(COMMON, "node_modules"),
        path.join(directory, "node_modules"),
        "dir",
      );

      const config: ts.ParsedCommandLine = ts.parseJsonConfigFileContent(
        ts.readConfigFile(path.join(COMMON, "tsconfig.json"), ts.sys.readFile)
          .config,
        ts.sys,
        COMMON,
      );
      const program: ts.Program = ts.createProgram([file], {
        ...config.options,
        noEmit: true,
        // The fixture's own errors are the ones that matter, and each is reported.
        skipLibCheck: true,
      });

      return ts
        .getPreEmitDiagnostics(program)
        .filter((diagnostic: ts.Diagnostic): boolean => {
          return diagnostic.file?.fileName === file;
        })
        .map((diagnostic: ts.Diagnostic): string => {
          return `TS${diagnostic.code}`;
        });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };

  const FIXTURE_HEAD: string =
    'import { jest } from "@jest/globals";\n' +
    "export const store: { read: (id: string) => Promise<number> } = {\n" +
    "  read: async (): Promise<number> => {\n" +
    "    return 1;\n" +
    "  },\n" +
    "};\n";

  test("a spy annotated jest.SpiedFunction does not compile; SpyInstance does", () => {
    expect(
      compile(
        FIXTURE_HEAD +
          'export const spy: jest.SpiedFunction<typeof store.read> = jest.spyOn(store, "read");\n',
      ),
    ).toContain("TS2322");
    expect(
      compile(
        FIXTURE_HEAD +
          'import { SpyInstance } from "jest-mock";\n' +
          'export const spy: SpyInstance<typeof store.read> = jest.spyOn(store, "read");\n' +
          "spy.mockResolvedValue(2);\n",
      ),
    ).toEqual([]);
  }, 120000);

  test("jest.Mock given a function's type cannot be resolved with a value; Mock can", () => {
    expect(
      compile(
        FIXTURE_HEAD +
          "type Update = jest.Mock<(id: string) => Promise<{ affected: number }>>;\n" +
          "export const update: Update = jest.fn() as unknown as Update;\n" +
          "update.mockResolvedValue({ affected: 1 });\n",
      ),
    ).toContain("TS2345");
    expect(
      compile(
        FIXTURE_HEAD +
          'import { Mock } from "jest-mock";\n' +
          "type Update = Mock<(id: string) => Promise<{ affected: number }>>;\n" +
          "export const update: Update = jest.fn<(id: string) => Promise<{ affected: number }>>();\n" +
          "update.mockResolvedValue({ affected: 1 });\n",
      ),
    ).toEqual([]);
  }, 120000);
});

describe("the repository's tests", () => {
  const scanned: Array<{ file: string; traps: Array<string> }> =
    TEST_DIRECTORIES.flatMap(
      (directory: string): Array<{ file: string; traps: Array<string> }> => {
        return testFilesUnder(path.join(REPOSITORY, directory)).map(
          (file: string): { file: string; traps: Array<string> } => {
            const label: string = path
              .relative(REPOSITORY, file)
              .split(path.sep)
              .join("/");

            return {
              file: label,
              traps: findJestTypeTraps(label, fs.readFileSync(file, "utf8")),
            };
          },
        );
      },
    );

  test("are read: thousands of test files, Common's and App's", () => {
    expect(scanned.length).toBeGreaterThan(5000);
    expect(
      scanned.some((entry: { file: string }): boolean => {
        return entry.file.startsWith("packages/App/Tests/");
      }),
    ).toBe(true);
  });

  test("annotate no spy or mock from @jest/globals with @types/jest's type", () => {
    expect(
      scanned.flatMap((entry: { traps: Array<string> }): Array<string> => {
        return entry.traps;
      }),
    ).toEqual([]);
  });
});
