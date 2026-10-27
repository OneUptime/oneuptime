import { build as buildWithEsbuild, BuildOptions, Metafile } from "esbuild";
import * as fs from "fs";
import { builtinModules } from "module";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";

/*
 * esbuild.config.js builds what npm publishes as @oneuptime/cli: one
 * CommonJS file holding the CLI, the Common code it uses and every package
 * those need (#4872: the tsc build left bare require("Common/...") calls that
 * no installed CLI could answer). These tests hold the build's options, the
 * package manifest that publishes it, and the license file it writes.
 * Tests/PackagedCli builds the real bundle, installs it and runs it.
 */

interface BuildOptionsShape {
  absWorkingDir: string;
  entryPoints: Array<string>;
  outfile: string;
  bundle: boolean;
  platform: string;
  format: string;
  target: Array<string>;
  tsconfig: string;
  keepNames: boolean;
  external: Array<string>;
  metafile: boolean;
}

interface BundledPackage {
  name: string;
  version: string;
  license: string;
  directory: string;
  licenseTexts: Array<string>;
}

interface BuildConfigModule {
  CLI_ROOT: string;
  OUTPUT_DIRECTORY: string;
  BUNDLE_FILE_NAME: string;
  LICENSES_FILE_NAME: string;
  NODE_TARGET: string;
  TYPEORM_DATABASE_DRIVERS: Array<string>;
  createBuildOptions: (settings?: {
    outputDirectory?: string;
  }) => BuildOptionsShape;
  packageDirectoryOf: (file: string) => string | null;
  licenseOf: (manifest: Record<string, unknown>) => string;
  bundledPackages: (
    metafile: { inputs: Record<string, unknown> },
    workingDirectory?: string,
  ) => Array<BundledPackage>;
  renderLicenses: (packages: Array<BundledPackage>) => string;
}

interface CliManifest {
  name: string;
  version: string;
  main: string;
  bin: Record<string, string>;
  files: Array<string>;
  scripts: Record<string, string>;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const BuildConfig: BuildConfigModule = require("../esbuild.config");

const CLI_ROOT: string = path.resolve(__dirname, "..");

const NODE_TARGET_FORMAT: RegExp = /^node\d+$/;

// ES2022 and later, where TypeScript defines class fields rather than assigning them.
const DEFINE_FIELDS_TARGET: RegExp = /^es20(?:2[2-9]|[3-9]\d)$|^esnext$/;

// A `return require("name");` line of typeorm's PlatformTools.load().
const RETURN_REQUIRE: RegExp = /return require\("([^"\n]+)"\);/g;

// The Node.js lines of CLI Test's packaged-cli matrix: "node: [22, 24]".
const MATRIX_NODE_LINES: RegExp = /^ {8}node: \[([\d, ]+)\]$/m;

// The first job's setup-node version: "node-version: 26".
const SETUP_NODE_VERSION: RegExp = /^ {10}node-version: (\d+)$/m;

const MANIFEST: CliManifest = JSON.parse(
  fs.readFileSync(path.join(CLI_ROOT, "package.json"), "utf-8"),
) as CliManifest;

function fromCliRoot(file: string): string {
  return path.relative(CLI_ROOT, file).split(path.sep).join("/");
}

function normalizedPackagePath(file: string): string {
  return path.posix.normalize(file);
}

describe("the bundle's build options", () => {
  const options: BuildOptionsShape = BuildConfig.createBuildOptions();

  it("bundles Index.ts, with everything it imports, into one CommonJS file for Node.js", () => {
    expect(BuildConfig.CLI_ROOT).toBe(CLI_ROOT);
    expect(options.absWorkingDir).toBe(CLI_ROOT);
    expect(options.entryPoints).toEqual([path.join(CLI_ROOT, "Index.ts")]);
    expect(options.bundle).toBe(true);
    expect(options.platform).toBe("node");
    expect(options.format).toBe("cjs");
    // The metafile is how the license file learns what the bundle holds.
    expect(options.metafile).toBe(true);
  });

  it("writes the bundle where package.json's bin and main point", () => {
    expect(fromCliRoot(options.outfile)).toBe(
      `build/dist/${BuildConfig.BUNDLE_FILE_NAME}`,
    );
    expect(Object.keys(MANIFEST.bin)).toEqual(["oneuptime"]);
    expect(normalizedPackagePath(MANIFEST.bin["oneuptime"] as string)).toBe(
      fromCliRoot(options.outfile),
    );
    expect(normalizedPackagePath(MANIFEST.main)).toBe(
      fromCliRoot(options.outfile),
    );
  });

  it("writes into another directory when asked, for a build that must not touch build/dist", () => {
    const elsewhere: string = path.join(os.tmpdir(), "somewhere-else");

    expect(
      BuildConfig.createBuildOptions({ outputDirectory: elsewhere }).outfile,
    ).toBe(path.join(elsewhere, BuildConfig.BUNDLE_FILE_NAME));
  });

  it("builds for the oldest Node.js that package.json's engines allows", () => {
    const oldestMajor: string = BuildConfig.NODE_TARGET.replace("node", "");

    expect(BuildConfig.NODE_TARGET).toMatch(NODE_TARGET_FORMAT);
    expect(options.target).toEqual([BuildConfig.NODE_TARGET]);
    expect(MANIFEST.engines).toEqual({ node: `>=${oldestMajor}` });
  });

  /*
   * esbuild compiles each file with the tsconfig.json nearest to it but never
   * reads one inside node_modules, where Common is whenever npm copies it
   * rather than links it. Compiled as standard decorators, the models'
   * typeorm decorators crash the bundle as it starts.
   */
  it("names the CLI's tsconfig, which compiles the models' decorators the way tsc does", () => {
    expect(options.tsconfig).toBe(path.join(CLI_ROOT, "tsconfig.json"));

    const read: { config?: unknown; error?: ts.Diagnostic } =
      ts.parseConfigFileTextToJson(
        options.tsconfig,
        fs.readFileSync(options.tsconfig, "utf-8"),
      );

    expect(read.error).toBeUndefined();

    const compilerOptions: Record<string, unknown> = (
      read.config as { compilerOptions: Record<string, unknown> }
    ).compilerOptions;

    expect(compilerOptions["experimentalDecorators"]).toBe(true);
    // Assignment semantics for class fields, as Common's own tsconfig has.
    expect(compilerOptions["useDefineForClassFields"]).not.toBe(true);
    expect(String(compilerOptions["target"]).toLowerCase()).not.toMatch(
      DEFINE_FIELDS_TARGET,
    );
  });

  it("keeps class names as written", () => {
    expect(options.keepNames).toBe(true);
  });

  it("leaves out only the database drivers typeorm loads on demand", () => {
    expect(options.external).toEqual(BuildConfig.TYPEORM_DATABASE_DRIVERS);

    for (const driver of BuildConfig.TYPEORM_DATABASE_DRIVERS) {
      // Never a Node.js module and never Common: those would be real holes.
      expect(builtinModules).not.toContain(driver);
      expect(driver.startsWith("Common")).toBe(false);
    }
  });

  /*
   * The list is typeorm's: PlatformTools.load() requires a driver by name
   * when a DataSource connects, which the CLI never does. A typeorm upgrade
   * that adds a driver fails here until the list names it, rather than
   * bundling a driver Common happens to install.
   */
  it("names every driver typeorm's PlatformTools.load() can require, and nothing else", () => {
    const typeormEntry: string = require.resolve("typeorm", {
      paths: [path.join(CLI_ROOT, "..", "Common")],
    });
    const source: string = fs.readFileSync(
      path.join(path.dirname(typeormEntry), "platform", "PlatformTools.js"),
      "utf-8",
    );
    const loadStart: number = source.indexOf("static load(name)");
    const loadEnd: number = source.indexOf("static ", loadStart + 1);

    expect(loadStart).toBeGreaterThan(-1);
    expect(loadEnd).toBeGreaterThan(loadStart);

    const required: Array<string> = [
      ...source.slice(loadStart, loadEnd).matchAll(RETURN_REQUIRE),
    ].map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(required.length).toBeGreaterThan(10);
    expect([...BuildConfig.TYPEORM_DATABASE_DRIVERS].sort()).toEqual(
      [...new Set(required)].sort(),
    );
  });
});

/*
 * esbuild emits no decorator metadata: tsc's emitDecoratorMetadata, which
 * records each property's design:type, has no esbuild equivalent. typeorm's
 * @Column and @PrimaryColumn guess a column's type from that metadata when
 * the column names none, and throw ColumnTypeUndefinedError as the model
 * class loads when there is nothing to guess from. Such a model works under
 * ts-node, which emits the metadata, and kills the bundled CLI at start,
 * before even --version. So every column of every model the bundle holds
 * names its type.
 */
describe("the models the bundle holds", () => {
  const TYPE_GUESSING_DECORATORS: Array<string> = ["Column", "PrimaryColumn"];

  interface ColumnScan {
    files: number;
    columns: number;
    withoutType: Array<string>;
  }

  // The decorators a file imports from typeorm, by their local name.
  function typeormImports(source: ts.SourceFile): Map<string, string> {
    const imported: Map<string, string> = new Map<string, string>();

    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "typeorm"
      ) {
        continue;
      }

      const bindings: ts.NamedImportBindings | undefined =
        statement.importClause?.namedBindings;

      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          imported.set(
            element.name.text,
            (element.propertyName || element.name).text,
          );
        }
      }
    }

    return imported;
  }

  // A column names its type as @Column("varchar"), @Column(ColumnType.X, ...) or @Column({ type: ... }).
  function namesItsType(call: ts.CallExpression): boolean {
    const first: ts.Expression | undefined = call.arguments[0];

    if (!first) {
      return false;
    }

    if (!ts.isObjectLiteralExpression(first)) {
      return true;
    }

    return first.properties.some((property: ts.ObjectLiteralElementLike) => {
      return (
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "type"
      );
    });
  }

  function scanColumns(files: Array<string>): ColumnScan {
    const scan: ColumnScan = { files: 0, columns: 0, withoutType: [] };

    for (const file of files) {
      const source: ts.SourceFile = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf-8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const imported: Map<string, string> = typeormImports(source);

      scan.files += 1;

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          ts.isDecorator(node) &&
          ts.isCallExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          TYPE_GUESSING_DECORATORS.includes(
            imported.get(node.expression.expression.text) || "",
          )
        ) {
          scan.columns += 1;

          if (!namesItsType(node.expression)) {
            const { line } = source.getLineAndCharacterOfPosition(
              node.getStart(source),
            );
            scan.withoutType.push(
              `${path.relative(CLI_ROOT, file).split(path.sep).join("/")}:${line + 1}`,
            );
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    return scan;
  }

  it("name the type of every typeorm column, which the bundle cannot guess", async () => {
    const options: BuildOptions = {
      ...(BuildConfig.createBuildOptions({
        outputDirectory: path.join(os.tmpdir(), "oneuptime-cli-unwritten"),
      }) as unknown as BuildOptions),
      write: false,
      logLevel: "silent",
    };
    const metafile: Metafile = (await buildWithEsbuild(options))
      .metafile as Metafile;
    const ourSources: Array<string> = Object.keys(metafile.inputs)
      .map((input: string): string => {
        return path.resolve(CLI_ROOT, input);
      })
      .filter((file: string): boolean => {
        return (
          file.endsWith(".ts") && !file.split(path.sep).includes("node_modules")
        );
      });
    const scan: ColumnScan = scanColumns(ourSources);

    // Every database model is in the bundle, so this is thousands of columns.
    expect(scan.files).toBeGreaterThan(400);
    expect(scan.columns).toBeGreaterThan(1000);
    expect(scan.withoutType).toEqual([]);
  }, 120000);

  it("finds a column that leaves its type to the metadata, however typeorm's decorator is imported", () => {
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-cli-columns-"),
    );
    const model: string = path.join(directory, "Model.ts");

    try {
      fs.writeFileSync(
        model,
        [
          'import { Column as TypeOrmColumn, Entity, PrimaryColumn } from "typeorm";',
          'import TableColumn from "./TableColumn";',
          "",
          '@Entity({ name: "Example" })',
          "export default class Example {",
          '  @PrimaryColumn({ type: "uuid" })',
          "  public id?: string = undefined;",
          "",
          '  @TypeOrmColumn("varchar")',
          "  public byPosition?: string = undefined;",
          "",
          '  @TypeOrmColumn({ type: "text", nullable: true })',
          "  public byOption?: string = undefined;",
          "",
          "  @TableColumn({ title: 'Not typeorm, never a column here' })",
          "  @TypeOrmColumn({ nullable: true })",
          "  public guessed?: string = undefined;",
          "",
          "  @TypeOrmColumn()",
          "  public alsoGuessed?: number = undefined;",
          "}",
          "",
        ].join("\n"),
      );

      const scan: ColumnScan = scanColumns([model]);

      expect(scan.columns).toBe(5);
      expect(
        scan.withoutType.map((entry: string): string => {
          return entry.slice(entry.lastIndexOf(":") + 1);
        }),
      ).toEqual(["16", "19"]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("packageDirectoryOf", () => {
  const root: string = path.join(path.sep, "work", "app");

  it("finds the package a file belongs to", () => {
    expect(
      BuildConfig.packageDirectoryOf(
        path.join(root, "node_modules", "axios", "lib", "axios.js"),
      ),
    ).toBe(path.join(root, "node_modules", "axios"));
  });

  it("finds a scoped package", () => {
    expect(
      BuildConfig.packageDirectoryOf(
        path.join(root, "node_modules", "@colors", "colors", "lib", "index.js"),
      ),
    ).toBe(path.join(root, "node_modules", "@colors", "colors"));
  });

  it("finds the innermost package of a nested node_modules", () => {
    expect(
      BuildConfig.packageDirectoryOf(
        path.join(
          root,
          "node_modules",
          "typeorm",
          "node_modules",
          "glob",
          "dist",
          "index.js",
        ),
      ),
    ).toBe(path.join(root, "node_modules", "typeorm", "node_modules", "glob"));
  });

  it("answers null for our own files and for paths that are no file of a package", () => {
    expect(
      BuildConfig.packageDirectoryOf(
        path.join(root, "packages", "Common", "Models", "Incident.ts"),
      ),
    ).toBeNull();
    expect(
      BuildConfig.packageDirectoryOf(path.join(root, "node_modules", "axios")),
    ).toBeNull();
    expect(
      BuildConfig.packageDirectoryOf(
        path.join(root, "node_modules", "@scope", "name"),
      ),
    ).toBeNull();
    expect(
      BuildConfig.packageDirectoryOf(path.join(root, "node_modules")),
    ).toBeNull();
  });
});

describe("licenseOf", () => {
  it("reads an SPDX string", () => {
    expect(BuildConfig.licenseOf({ license: " MIT " })).toBe("MIT");
    expect(BuildConfig.licenseOf({ license: "(MIT AND BSD-3-Clause)" })).toBe(
      "(MIT AND BSD-3-Clause)",
    );
  });

  it("reads the object and the deprecated list forms", () => {
    expect(BuildConfig.licenseOf({ license: { type: "ISC" } })).toBe("ISC");
    expect(
      BuildConfig.licenseOf({
        licenses: [{ type: "MIT" }, { type: "Apache-2.0" }],
      }),
    ).toBe("MIT OR Apache-2.0");
  });

  it("says UNKNOWN when the manifest names none", () => {
    expect(BuildConfig.licenseOf({})).toBe("UNKNOWN");
    expect(BuildConfig.licenseOf({ license: "" })).toBe("UNKNOWN");
    expect(BuildConfig.licenseOf({ licenses: [] })).toBe("UNKNOWN");
  });
});

describe("bundledPackages", () => {
  let root: string;

  function writePackage(
    directory: string,
    manifest: Record<string, unknown>,
    files: Record<string, string>,
  ): void {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify(manifest),
    );

    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, name)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(directory, name), text);
    }
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-cli-licenses-"));

    writePackage(
      path.join(root, "app", "node_modules", "alpha"),
      { name: "alpha", version: "1.0.0", license: "MIT" },
      {
        "index.js": "",
        LICENSE: "MIT License\nCopyright (c) Alpha\n",
        // A script named like a license file is code, not a license.
        "license-checker.js": "module.exports = 1;",
      },
    );
    writePackage(
      path.join(root, "app", "node_modules", "@scope", "beta"),
      { name: "@scope/beta", version: "2.0.0", license: { type: "ISC" } },
      {
        "lib/a.js": "",
        "lib/b.js": "",
        "LICENCE.md": "ISC License, Beta",
        NOTICE: "Beta includes work by Gamma.",
      },
    );
    writePackage(
      path.join(root, "app", "node_modules", "alpha", "node_modules", "gamma"),
      { name: "gamma", version: "0.1.0", license: "BSD-3-Clause" },
      { "index.js": "" },
    );
    writePackage(
      path.join(root, "app", "node_modules", "delta"),
      { name: "delta", version: "4.0.0", license: "MIT" },
      { "index.js": "", "LICENSE-MIT": "Delta MIT", "COPYING.txt": "Delta" },
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists each third-party package once, by name and version, and none of our own files", () => {
    const packages: Array<BundledPackage> = BuildConfig.bundledPackages(
      {
        inputs: {
          "app/node_modules/alpha/index.js": {},
          "app/node_modules/@scope/beta/lib/a.js": {},
          "app/node_modules/@scope/beta/lib/b.js": {},
          "app/node_modules/alpha/node_modules/gamma/index.js": {},
          "app/node_modules/delta/index.js": {},
          "app/src/Index.ts": {},
          "../outside/Common/Models/Incident.ts": {},
        },
      },
      root,
    );

    expect(
      packages.map((entry: BundledPackage): string => {
        return `${entry.name}@${entry.version} ${entry.license}`;
      }),
    ).toEqual([
      "@scope/beta@2.0.0 ISC",
      "alpha@1.0.0 MIT",
      "delta@4.0.0 MIT",
      "gamma@0.1.0 BSD-3-Clause",
    ]);
    expect(packages[0]?.directory).toBe(
      path.join(root, "app", "node_modules", "@scope", "beta"),
    );
  });

  it("reads every license, licence, copying and notice file, in name order, and no code", () => {
    const packages: Array<BundledPackage> = BuildConfig.bundledPackages(
      {
        inputs: {
          "app/node_modules/alpha/index.js": {},
          "app/node_modules/@scope/beta/lib/a.js": {},
          "app/node_modules/alpha/node_modules/gamma/index.js": {},
          "app/node_modules/delta/index.js": {},
        },
      },
      root,
    );
    const textsOf: (name: string) => Array<string> = (
      name: string,
    ): Array<string> => {
      return (
        packages.find((entry: BundledPackage): boolean => {
          return entry.name === name;
        }) as BundledPackage
      ).licenseTexts;
    };

    expect(textsOf("alpha")).toEqual(["MIT License\nCopyright (c) Alpha"]);
    expect(textsOf("@scope/beta")).toEqual([
      "ISC License, Beta",
      "Beta includes work by Gamma.",
    ]);
    expect(textsOf("delta")).toEqual(["Delta", "Delta MIT"]);
    expect(textsOf("gamma")).toEqual([]);
  });

  /*
   * The CLI's node_modules and Common's can hold the same release (both had
   * supports-color 7.2.0 and has-flag 4.0.0), and the bundle then holds both
   * copies. The license file names the release once.
   */
  it("lists a release installed in two places once, with each distinct license text, and keeps other versions apart", () => {
    writePackage(
      path.join(root, "cli", "node_modules", "epsilon"),
      { name: "epsilon", version: "7.2.0", license: "MIT" },
      { "index.js": "", LICENSE: "Epsilon MIT" },
    );
    writePackage(
      path.join(root, "common", "node_modules", "epsilon"),
      { name: "epsilon", version: "7.2.0", license: "MIT" },
      { "index.js": "", LICENSE: "Epsilon MIT", NOTICE: "Epsilon notice" },
    );
    writePackage(
      path.join(
        root,
        "common",
        "node_modules",
        "zeta",
        "node_modules",
        "epsilon",
      ),
      { name: "epsilon", version: "8.0.0", license: "MIT" },
      { "index.js": "", LICENSE: "Epsilon 8 MIT" },
    );

    const packages: Array<BundledPackage> = BuildConfig.bundledPackages(
      {
        inputs: {
          "common/node_modules/epsilon/index.js": {},
          "common/node_modules/zeta/node_modules/epsilon/index.js": {},
          "cli/node_modules/epsilon/index.js": {},
        },
      },
      root,
    );

    expect(packages).toEqual([
      {
        name: "epsilon",
        version: "7.2.0",
        license: "MIT",
        // The first directory in path order, whatever order esbuild read them in.
        directory: path.join(root, "cli", "node_modules", "epsilon"),
        licenseTexts: ["Epsilon MIT", "Epsilon notice"],
      },
      {
        name: "epsilon",
        version: "8.0.0",
        license: "MIT",
        directory: path.join(
          root,
          "common",
          "node_modules",
          "zeta",
          "node_modules",
          "epsilon",
        ),
        licenseTexts: ["Epsilon 8 MIT"],
      },
    ]);
  });
});

describe("renderLicenses", () => {
  const packages: Array<BundledPackage> = [
    {
      name: "alpha",
      version: "1.0.0",
      license: "MIT",
      directory: "/x/alpha",
      licenseTexts: ["MIT License\nCopyright (c) Alpha"],
    },
    {
      name: "gamma",
      version: "0.1.0",
      license: "BSD-3-Clause",
      directory: "/x/gamma",
      licenseTexts: [],
    },
  ];

  it("reproduces each package's license under its name and version", () => {
    const text: string = BuildConfig.renderLicenses(packages);

    expect(text.startsWith("The OneUptime CLI (build/dist/Index.js)")).toBe(
      true,
    );
    expect(text).toContain(
      "alpha 1.0.0\nLicense: MIT\n\nMIT License\nCopyright (c) Alpha\n",
    );
  });

  it("says what package.json declares for a package that ships no license file", () => {
    expect(BuildConfig.renderLicenses(packages)).toContain(
      "gamma 0.1.0\nLicense: BSD-3-Clause\n\nThe package ships no license file. Its package.json declares: BSD-3-Clause\n",
    );
  });

  it("never prints where a package was built from", () => {
    expect(BuildConfig.renderLicenses(packages)).not.toContain("/x/");
  });

  it("writes the same text for the same packages", () => {
    expect(BuildConfig.renderLicenses(packages)).toBe(
      BuildConfig.renderLicenses(packages),
    );
  });
});

describe("the package npm publishes", () => {
  /*
   * The bundle holds everything the CLI runs, so npm has nothing to install
   * beside it: no @oneuptime/common (287 MB unpacked, 1,000 dependencies,
   * native builds that need python3, make and g++), and no network after the
   * tarball.
   */
  it("asks npm to install nothing with it", () => {
    expect(MANIFEST.dependencies || {}).toEqual({});
    expect(MANIFEST.peerDependencies || {}).toEqual({});
    expect(MANIFEST.optionalDependencies || {}).toEqual({});

    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
      expect(MANIFEST.scripts[hook]).toBeUndefined();
    }
  });

  it("ships the bundle and its license file, and nothing a build left behind", () => {
    expect(MANIFEST.files).toEqual([
      `build/dist/${BuildConfig.BUNDLE_FILE_NAME}`,
      `build/dist/${BuildConfig.LICENSES_FILE_NAME}`,
    ]);
  });

  it("builds the bundle whenever npm packs or publishes it", () => {
    expect(MANIFEST.scripts["prepack"]).toBe("npm run build");
    expect(MANIFEST.scripts["build"]).toBe("node esbuild.config.js");
    /*
     * A type-check only: tsc output never lands where the bundle goes. It
     * checks the tests too, with the sources' strict options: jest compiles
     * them with strict off, so 29 type errors once sat in two old suites
     * that no command ever reported.
     */
    expect(MANIFEST.scripts["compile"]).toBe(
      "tsc --noEmit && tsc --noEmit -p Tests/tsconfig.json",
    );
    expect(MANIFEST.scripts["smoke-test"]).toBe(
      "node Scripts/SmokeTestPackage.js",
    );
  });

  /*
   * Every package the sources import is bundled, so each is a devDependency:
   * what the build needs, not what an install fetches.
   */
  it("keeps every package the sources import as a devDependency", () => {
    const sourceFiles: Array<string> = [];
    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (!["node_modules", "build", "Tests"].includes(entry.name)) {
            walk(full);
          }
        } else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".d.ts")
        ) {
          sourceFiles.push(full);
        }
      }
    };

    walk(CLI_ROOT);

    const imported: Set<string> = new Set<string>();

    for (const file of sourceFiles) {
      const { importedFiles } = ts.preProcessFile(
        fs.readFileSync(file, "utf-8"),
        true,
        true,
      );

      for (const { fileName: specifier } of importedFiles) {
        if (specifier.startsWith(".") || builtinModules.includes(specifier)) {
          continue;
        }

        const parts: Array<string> = specifier.split("/");
        imported.add(
          specifier.startsWith("@")
            ? `${parts[0]}/${parts[1]}`
            : (parts[0] as string),
        );
      }
    }

    expect(sourceFiles.length).toBeGreaterThan(5);
    expect([...imported].sort()).toEqual([
      "Common",
      "chalk",
      "cli-table3",
      "commander",
    ]);

    for (const name of imported) {
      expect(MANIFEST.devDependencies[name]).toBeDefined();
    }

    expect(MANIFEST.devDependencies["Common"]).toBe("file:../Common");
    expect(MANIFEST.devDependencies["esbuild"]).toBeDefined();
  });
});

/*
 * CLI Test (.github/workflows/test.cli.yaml) is where the package npm
 * publishes gets run before a release: the job that runs these tests packs
 * it first, and a job per older Node.js line installs and runs that tarball.
 */
describe("CLI Test", () => {
  const workflow: string = fs.readFileSync(
    path.join(CLI_ROOT, "..", "..", ".github", "workflows", "test.cli.yaml"),
    "utf-8",
  );

  it("packs the CLI as npm publishes it, and hands the tarball on before the tests run", () => {
    const pack: number = workflow.indexOf(
      'cd packages/CLI && npm pack --pack-destination "$RUNNER_TEMP/cli-package"',
    );
    const upload: number = workflow.indexOf("name: cli-package\n");
    const tests: number = workflow.indexOf("cd packages/CLI && npm run test");

    expect(pack).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(pack);
    expect(tests).toBeGreaterThan(upload);
    // A re-run of the job uploads the same name again.
    expect(workflow.slice(upload, tests)).toContain("overwrite: true");
  });

  it("runs the packed CLI on every Node.js line from the oldest engines allows up to the tests' own", () => {
    const testsNode: number = Number(
      (SETUP_NODE_VERSION.exec(workflow) as RegExpExecArray)[1],
    );
    const matrix: Array<number> = (
      (MATRIX_NODE_LINES.exec(workflow) as RegExpExecArray)[1] as string
    )
      .split(",")
      .map((line: string): number => {
        return Number(line.trim());
      });
    const oldest: number = Number(
      (MANIFEST.engines as Record<string, string>)["node"]?.replace(">=", ""),
    );

    // Node.js's long-term lines are the even ones.
    const expected: Array<number> = [];

    for (let line: number = oldest; line < testsNode; line += 2) {
      expected.push(line);
    }

    expect(testsNode).toBe(26);
    expect(expected.length).toBeGreaterThan(0);
    expect(matrix).toEqual(expected);
    expect(workflow).toContain(
      'node packages/CLI/Scripts/SmokeTestPackage.js --tarball "$tarball"',
    );
  });
});
