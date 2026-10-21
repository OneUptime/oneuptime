/*
 * How the generator is type-checked: tsconfig.json, which `npm run compile`
 * (tsc --noEmit, run by the Terraform Provider Generation workflow) and
 * ts-jest both read.
 *
 * The generator imports Common's sources - Core/ResourceGenerator.ts and
 * GenerateProvider.ts through the "Common/*" alias, and GenerateProvider.ts
 * imports ../OpenAPI/GenerateSpec.ts, which reaches Common's whole server.
 * One program checks them all with one set of options. With options of its
 * own (strict: false, no experimentalDecorators, no jsx) that program reported
 * about 10,700 errors in Common files that pass `npx tsc` in packages/Common,
 * and nobody noticed: CI never ran it.
 *
 * So tsconfig.json extends Common's tsconfig. This suite pins that Common's
 * files are checked with Common's own options, that the generator's own files
 * stay strict, which files are checked, and that the type check, jest and the
 * dependencies agree on what "Common" and "TypeScript" are.
 */

import fs from "fs";
import path from "path";
import ts from "typescript";

const GENERATOR_DIR: string = path.resolve(__dirname, "..");
const REPO_ROOT: string = path.resolve(GENERATOR_DIR, "..", "..");
const COMMON_DIR: string = path.join(REPO_ROOT, "packages", "Common");
const GENERATOR_TSCONFIG: string = path.join(GENERATOR_DIR, "tsconfig.json");
const COMMON_TSCONFIG: string = path.join(COMMON_DIR, "tsconfig.json");

const TYPESCRIPT_SOURCE: RegExp = /\.tsx?$/;

function parseTsconfig(configPath: string): ts.ParsedCommandLine {
  const parsed: ts.ParsedCommandLine | undefined =
    ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (
          diagnostic: ts.Diagnostic,
        ): void => {
          throw new Error(
            ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
          );
        },
      },
    );

  if (!parsed) {
    throw new Error(`Could not read ${configPath}.`);
  }

  return parsed;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// Every .ts/.tsx file under `dir`, node_modules left out.
function typeScriptFilesIn(dir: string): Array<string> {
  const found: Array<string> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        found.push(...typeScriptFilesIn(full));
      }
    } else if (TYPESCRIPT_SOURCE.test(entry.name)) {
      found.push(full);
    }
  }
  return found.sort();
}

function describeDiagnostic(diagnostic: ts.Diagnostic): string {
  const message: string = ts.flattenDiagnosticMessageText(
    diagnostic.messageText,
    "\n",
  );
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `TS${diagnostic.code}: ${message}`;
  }
  const position: ts.LineAndCharacter =
    diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${path.relative(REPO_ROOT, diagnostic.file.fileName)}(${
    position.line + 1
  },${position.character + 1}): TS${diagnostic.code}: ${message}`;
}

const generator: ts.ParsedCommandLine = parseTsconfig(GENERATOR_TSCONFIG);
const common: ts.ParsedCommandLine = parseTsconfig(COMMON_TSCONFIG);

/*
 * The only compiler options that differ from Common's, and why (tsconfig.json
 * says the same). Anything else that differs would check Common's files in a
 * way packages/Common does not.
 */
const EXPECTED_DIFFERENCES: Record<string, unknown> = {
  // Where each was read from.
  configFilePath: GENERATOR_TSCONFIG,
  // jest and ts-node run these files as CommonJS.
  module: ts.ModuleKind.CommonJS,
  // A check: nothing is built from this program.
  noEmit: true,
  // The generator's own @types: jest 30 for its jest 30 tests.
  typeRoots: [path.join(GENERATOR_DIR, "node_modules", "@types")],
};

/*
 * Every strictness option Common's tsconfig turns on. The generator's own
 * files - Core/, Tests/, GenerateProvider.ts - are held to each of them, as
 * they are wherever else they compile (Common's test type-check imports Core/;
 * the root's ts-node runs GenerateProvider.ts). Pinned here on their own, so
 * that Common relaxing one shows up as the generator's check getting weaker.
 */
const STRICT_OPTIONS: Array<string> = [
  "strict",
  "noImplicitAny",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "noImplicitThis",
  "useUnknownInCatchVariables",
  "alwaysStrict",
  "noUnusedLocals",
  "noUnusedParameters",
  "exactOptionalPropertyTypes",
  "noImplicitReturns",
  "noFallthroughCasesInSwitch",
  "noUncheckedIndexedAccess",
  "noImplicitOverride",
  "noPropertyAccessFromIndexSignature",
];

// The options Common's tsconfig turns on that are not about strictness.
const OTHER_OPTIONS_COMMON_TURNS_ON: Array<string> = [
  "experimentalDecorators",
  "emitDecoratorMetadata",
  "sourceMap",
  "esModuleInterop",
  "forceConsistentCasingInFileNames",
  "skipLibCheck",
  "resolveJsonModule",
];

describe("tsconfig.json: Common's files are checked with Common's options", () => {
  test("extends packages/Common/tsconfig.json", () => {
    const raw: { config?: { extends?: string } } = ts.readConfigFile(
      GENERATOR_TSCONFIG,
      ts.sys.readFile,
    );

    expect(path.resolve(GENERATOR_DIR, raw.config?.extends || "")).toBe(
      COMMON_TSCONFIG,
    );
  });

  test("both configs parse without errors", () => {
    expect(generator.errors.map(describeDiagnostic)).toEqual([]);
    expect(common.errors.map(describeDiagnostic)).toEqual([]);
  });

  test("differs from Common's options only where it has to", () => {
    const differing: Record<string, unknown> = {};
    const keys: Set<string> = new Set([
      ...Object.keys(generator.options),
      ...Object.keys(common.options),
    ]);

    for (const key of keys) {
      if (
        JSON.stringify(generator.options[key]) !==
        JSON.stringify(common.options[key])
      ) {
        differing[key] = generator.options[key];
      }
    }

    expect(differing).toEqual(EXPECTED_DIFFERENCES);
  });

  /*
   * The causes of the ~10,700 errors, one by one. Covered by the test above
   * too; spelled out so a change to any of them names what it breaks.
   */
  test.each([
    {
      option: "experimentalDecorators",
      value: true,
      why: "Common's models use legacy decorators, TS1240/TS1241/TS1270 without it",
    },
    {
      option: "emitDecoratorMetadata",
      value: true,
      why: "TypeORM reads the design-time types it emits for Common's decorated columns",
    },
    {
      option: "jsx",
      value: ts.JsxEmit.React,
      why: "Common's Types import UI .tsx components, TS6142 without it",
    },
    {
      option: "target",
      value: ts.ScriptTarget.ES2017,
      why: "es2017, and with it Common's default lib",
    },
    {
      option: "strictNullChecks",
      value: true,
      why: "Common's union narrowing needs it, TS2352/TS2339/TS2345 without it",
    },
  ])(
    "$option is Common's: $why",
    ({ option, value }: { option: string; value: unknown }) => {
      expect(common.options[option]).toBe(value);
      expect(generator.options[option]).toBe(value);
    },
  );

  test("resolves the Common/* alias against packages/Common, the way Common's own tsconfig does", () => {
    // TypeScript's own record of which tsconfig wrote "paths" (internal).
    expect(generator.options["pathsBasePath"]).toBe(COMMON_DIR);
    expect(generator.options.paths?.["Common/*"]).toEqual(["./*"]);
  });
});

describe("tsconfig.json: the generator's own files stay strict", () => {
  test.each(STRICT_OPTIONS)("%s is on", (option: string) => {
    expect(generator.options[option]).toBe(true);
  });

  /*
   * So a strictness option Common adds is pinned here too: each option Common
   * turns on is either in STRICT_OPTIONS or named as something else.
   */
  test("every option Common's tsconfig turns on is classified above", () => {
    const raw: { config?: { compilerOptions?: Record<string, unknown> } } =
      ts.readConfigFile(COMMON_TSCONFIG, ts.sys.readFile);
    const turnedOn: Array<string> = Object.entries(
      raw.config?.compilerOptions || {},
    )
      .filter(([, value]: [string, unknown]) => {
        return value === true;
      })
      .map(([option]: [string, unknown]) => {
        return option;
      });

    expect([...turnedOn].sort()).toEqual(
      [...STRICT_OPTIONS, ...OTHER_OPTIONS_COMMON_TURNS_ON].sort(),
    );
  });

  test("type-checks every TypeScript file of the generator", () => {
    const files: Array<string> = typeScriptFilesIn(GENERATOR_DIR);

    // The walk finds the generator's entry point, its Core and its tests.
    expect(files).toContain(path.join(GENERATOR_DIR, "GenerateProvider.ts"));
    expect(files).toContain(
      path.join(GENERATOR_DIR, "Core", "ResourceGenerator.ts"),
    );
    expect(files).toContain(
      path.join(GENERATOR_DIR, "Tests", "TypeCheckConfig.test.ts"),
    );

    const unchecked: Array<string> = files.filter((file: string) => {
      return !generator.fileNames.includes(file);
    });

    expect(unchecked).toEqual([]);
  });

  test("includes every global declaration file Common's own compile includes", () => {
    const globalDeclarations: Array<string> = common.fileNames.filter(
      (file: string) => {
        if (!file.endsWith(".d.ts")) {
          return false;
        }
        const source: ts.SourceFile = ts.createSourceFile(
          file,
          fs.readFileSync(file, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        // A file with no top-level import or export declares globals.
        return !ts.isExternalModule(source);
      },
    );

    expect(globalDeclarations).toEqual(
      expect.arrayContaining([
        path.join(COMMON_DIR, "Typings", "Index.d.ts"),
        path.join(COMMON_DIR, "UI", "index.d.ts"),
      ]),
    );
    expect(
      globalDeclarations.filter((file: string) => {
        return !generator.fileNames.includes(file);
      }),
    ).toEqual([]);
  });
});

describe("the type check, jest and the dependencies agree", () => {
  const jestConfig: any = readJson(
    path.join(GENERATOR_DIR, "jest.config.json"),
  );
  const packageJson: any = readJson(path.join(GENERATOR_DIR, "package.json"));

  test("every Common/* import of the generator resolves to Common's own sources", () => {
    const resolved: Array<string> = [];
    const unresolved: Array<string> = [];

    for (const file of typeScriptFilesIn(GENERATOR_DIR)) {
      // What the file imports or requires, as TypeScript reads it.
      const specifiers: Array<string> = ts
        .preProcessFile(fs.readFileSync(file, "utf8"), true, true)
        .importedFiles.map((reference: ts.FileReference) => {
          return reference.fileName;
        })
        .filter((specifier: string) => {
          return specifier.startsWith("Common/");
        });

      for (const specifier of specifiers) {
        const target: string | undefined = ts.resolveModuleName(
          specifier,
          file,
          generator.options,
          ts.sys,
        ).resolvedModule?.resolvedFileName;

        if (
          target &&
          target.startsWith(COMMON_DIR + path.sep) &&
          !target.includes(`${path.sep}node_modules${path.sep}`) &&
          !target.includes(`${path.sep}build${path.sep}`) &&
          !target.endsWith(".d.ts")
        ) {
          resolved.push(specifier);
        } else {
          unresolved.push(`${specifier} (from ${file}) -> ${target}`);
        }
      }
    }

    // The imports the generator is known to make were found and checked.
    expect(resolved).toEqual(
      expect.arrayContaining([
        "Common/Types/JSON",
        "Common/Server/Utils/Logger",
      ]),
    );
    expect(unresolved).toEqual([]);
  });

  test("GenerateProvider.ts's ../OpenAPI/GenerateSpec is Scripts/OpenAPI's source", () => {
    const target: string | undefined = ts.resolveModuleName(
      "../OpenAPI/GenerateSpec",
      path.join(GENERATOR_DIR, "GenerateProvider.ts"),
      generator.options,
      ts.sys,
    ).resolvedModule?.resolvedFileName;

    expect(target).toBe(
      path.join(REPO_ROOT, "Scripts", "OpenAPI", "GenerateSpec.ts"),
    );
  });

  test("jest maps Common/* to the directory the type check reads", () => {
    const specifier: string = "Common/Types/JSON";
    const mapped: Array<string> = Object.entries(
      jestConfig.moduleNameMapper as Record<string, string>,
    )
      .filter(([pattern]: [string, string]) => {
        return new RegExp(pattern).test(specifier);
      })
      .map(([pattern, replacement]: [string, string]) => {
        return path.resolve(
          specifier.replace(
            new RegExp(pattern),
            replacement.replace("<rootDir>", GENERATOR_DIR),
          ),
        );
      });
    const typeChecked: string | undefined = ts.resolveModuleName(
      specifier,
      path.join(GENERATOR_DIR, "Core", "ResourceGenerator.ts"),
      generator.options,
      ts.sys,
    ).resolvedModule?.resolvedFileName;

    expect(mapped).toEqual([path.join(COMMON_DIR, "Types", "JSON")]);
    expect(typeChecked).toBe(path.join(COMMON_DIR, "Types", "JSON.ts"));
  });

  test("ts-jest compiles the tests with this tsconfig", () => {
    expect(jestConfig.transform).toEqual({
      "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
    });
  });

  test("npm run compile type-checks this tsconfig and builds nothing", () => {
    expect(packageJson.scripts.compile).toBe("tsc --noEmit");
    expect(generator.options.noEmit).toBe(true);
  });

  /*
   * A different TypeScript, or different Node typings, can read the same
   * Common file differently. Both come from the lockfiles, which is what
   * `npm ci` installs in CI.
   */
  function lockedVersion(packageDir: string, name: string): string {
    const lock: any = readJson(path.join(packageDir, "package-lock.json"));
    const version: unknown = lock.packages?.[`node_modules/${name}`]?.version;
    if (typeof version !== "string") {
      throw new Error(`${packageDir}'s lockfile has no ${name}.`);
    }
    return version;
  }

  test("TypeScript is the major.minor Common checks itself with", () => {
    const majorMinor: (version: string) => string = (
      version: string,
    ): string => {
      return version.split(".").slice(0, 2).join(".");
    };

    expect(majorMinor(lockedVersion(GENERATOR_DIR, "typescript"))).toBe(
      majorMinor(lockedVersion(COMMON_DIR, "typescript")),
    );
  });

  test("@types/node is the major Common's is", () => {
    const major: (version: string) => string = (version: string): string => {
      return version.split(".")[0] || "";
    };

    expect(major(lockedVersion(GENERATOR_DIR, "@types/node"))).toBe(
      major(lockedVersion(COMMON_DIR, "@types/node")),
    );
    expect(packageJson.devDependencies["@types/node"]).toBe(
      readJson(path.join(COMMON_DIR, "package.json")).devDependencies[
        "@types/node"
      ],
    );
  });
});

/*
 * Common files from the old error list: AuditLog.ts and Span.ts, the two the
 * failure was reported with, and one file for each other cause. They are
 * type-checked on their own (with what they import) in about a second; the
 * whole program takes about twenty, and the workflow's `npm run compile`
 * step checks that.
 */
const NAMED_COMMON_FILES: Array<{ file: string; oldErrors: Array<number> }> = [
  // TS2352 "Conversion of type ... may be a mistake": no strictNullChecks.
  { file: "Models/AnalyticsModels/AuditLog.ts", oldErrors: [2352] },
  { file: "Models/AnalyticsModels/Span.ts", oldErrors: [2352] },
  // TS1240 decorator signatures: no experimentalDecorators.
  { file: "Models/DatabaseModels/Monitor.ts", oldErrors: [1240] },
  // TS2345 an unnarrowed union: no strictNullChecks.
  { file: "Types/API/Route.ts", oldErrors: [2345] },
  // TS6142 imports UI/Components/Dropdown/Dropdown.tsx: no jsx.
  { file: "Types/Workspace/WorkspaceMessagePayload.ts", oldErrors: [6142] },
];

/*
 * The compiler options tsconfig.json had before it extended Common's
 * (24b994e15d, paths updated in 2d5eb2ec31).
 */
const OLD_COMPILER_OPTIONS: Record<string, unknown> = {
  target: "es2021",
  module: "commonjs",
  moduleResolution: "node",
  esModuleInterop: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  noEmit: true,
  strict: false,
  types: ["jest", "node"],
  baseUrl: ".",
  paths: { "Common/*": ["../../packages/Common/*"] },
};

function errorsIn(
  options: ts.CompilerOptions,
): Array<{ file: string; errors: Array<string> }> {
  const rootNames: Array<string> = NAMED_COMMON_FILES.map(
    ({ file }: { file: string }) => {
      return path.join(COMMON_DIR, file);
    },
  );
  const program: ts.Program = ts.createProgram({ rootNames, options });

  return NAMED_COMMON_FILES.map(({ file }: { file: string }) => {
    const source: ts.SourceFile | undefined = program.getSourceFile(
      path.join(COMMON_DIR, file),
    );
    if (!source) {
      return { file, errors: ["not in the program"] };
    }
    return {
      file,
      errors: [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ].map(describeDiagnostic),
    };
  });
}

describe("Common files that failed the generator's type check", () => {
  test("type-check clean with Common's options", () => {
    expect(errorsIn(generator.options)).toEqual(
      NAMED_COMMON_FILES.map(({ file }: { file: string }) => {
        return { file, errors: [] };
      }),
    );
  });

  test("failed with the generator's old options, so the check above means something", () => {
    const old: ts.CompilerOptions = ts.convertCompilerOptionsFromJson(
      OLD_COMPILER_OPTIONS,
      GENERATOR_DIR,
    ).options;

    for (const { file, errors } of errorsIn(old)) {
      const expected: Array<number> =
        NAMED_COMMON_FILES.find((named: { file: string }) => {
          return named.file === file;
        })?.oldErrors || [];

      for (const code of expected) {
        expect({
          file,
          reported: errors.some((error: string) => {
            return error.includes(`: TS${code}: `);
          }),
        }).toEqual({ file, reported: true });
      }
    }
  });
});
