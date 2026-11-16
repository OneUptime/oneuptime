import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The App and Common compiled to JavaScript as their image compiles them
 * (Common/Server/Utils/TsNode/Precompile.js, with the App's own ts-node,
 * TypeScript and tsconfig), into a copy of their sources, then run as the
 * image runs them: plain node, with Common's PrecompiledSourceMaps.js first.
 * The image ran the same TypeScript through ts-node and Common's transpiler
 * before, so the compiled server must be that server:
 *
 * - every module it compiled is the JavaScript ts-node runs for it, byte for
 *   byte but its last line (which names its map instead of carrying an empty
 *   one), over every database model and decorated module, the 20 largest
 *   and a sample of the rest;
 * - TypeORM builds the same entity metadata from both (tables, columns and
 *   their types, which it reads from decorator metadata, relations), and the
 *   same migrations;
 * - stack traces name the same TypeScript files, lines and columns;
 * - every module's read of a file beside it (__dirname) finds that file;
 * - Common's services, the whole of its server graph, load without a
 *   TypeScript file, ts-node or TypeScript's compiler;
 * - the Enterprise loader loads a compiled ee/ entry (Server/Index.js),
 *   which it once named Index.ts and Node 26 would have run with its own
 *   type stripping.
 *
 * The copy lives in the system's temporary folder (Precompile.js refuses a
 * git checkout) and links the packages' installed node_modules.
 */

const APP_ROOT: string = path.resolve(__dirname, "..");
const PACKAGES: string = path.resolve(APP_ROOT, "..");
const COMMON_ROOT: string = path.join(PACKAGES, "Common");
const PRECOMPILED_SOURCE_MAPS: string =
  "Common/Server/Utils/TsNode/PrecompiledSourceMaps.js";
const ENTERPRISE_FIXTURES: string = path.join(
  APP_ROOT,
  "Tests",
  "Fixtures",
  "EnterpriseModules",
);

// Folders never copied: installs, tests, build output, built bundles.
const NOT_COPIED: Set<string> = new Set([
  "node_modules",
  "Tests",
  "build",
  "dist",
  "public",
  ".git",
]);

let workDirectory: string = "";
let copyRoot: string = "";
let appCopy: string = "";
let commonCopy: string = "";
let compileRun: SpawnSyncReturns<string> | null = null;

function copySources(from: string, to: string): void {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source: string): boolean => {
      return !NOT_COPIED.has(path.basename(source)) || source === from;
    },
  });
}

/*
 * The copy's node_modules: the App's installed packages, but Common, which
 * is the copy's own.
 */
function linkInstalledPackages(): void {
  fs.symlinkSync(
    path.join(COMMON_ROOT, "node_modules"),
    path.join(commonCopy, "node_modules"),
  );
  fs.mkdirSync(path.join(appCopy, "node_modules"));
  for (const entry of fs.readdirSync(path.join(APP_ROOT, "node_modules"))) {
    fs.symlinkSync(
      entry === "Common"
        ? "../../Common"
        : path.join(APP_ROOT, "node_modules", entry),
      path.join(appCopy, "node_modules", entry),
    );
  }
}

/*
 * The Enterprise loader's fixtures, where the compile reaches them (it
 * leaves Tests out) and at the depth their imports expect.
 */
const FIXTURES_IN_COPY: () => string = (): string => {
  return path.join(
    appCopy,
    "PrecompiledFixtures",
    "Fixtures",
    "EnterpriseModules",
  );
};

function node(
  args: Array<string>,
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number },
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd,
    env: { ...process.env, NODE_ENV: "production", ...(options.env || {}) },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeout || 600000,
  });
}

// A script of the test's own, outside both trees.
function script(name: string, lines: Array<string>): string {
  const file: string = path.join(workDirectory, name);
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

function lastJson(run: SpawnSyncReturns<string>): unknown {
  const line: string | undefined = run.stdout
    .split("\n")
    .filter((text: string) => {
      return text.startsWith("{") || text.startsWith("[");
    })
    .pop();
  if (!line) {
    throw new Error(
      `No JSON from ${run.status}: ${run.stdout.slice(-3000)}\n${run.stderr.slice(-3000)}`,
    );
  }
  return JSON.parse(line);
}

beforeAll(() => {
  workDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-precompiled-server-"),
  );
  copyRoot = path.join(workDirectory, "packages");
  appCopy = path.join(copyRoot, "App");
  commonCopy = path.join(copyRoot, "Common");
  copySources(APP_ROOT, appCopy);
  copySources(COMMON_ROOT, commonCopy);
  linkInstalledPackages();
  fs.mkdirSync(FIXTURES_IN_COPY(), { recursive: true });
  for (const entry of [
    "BootProbe.ts",
    "FixtureModuleFactory.ts",
    "DefaultExport",
  ]) {
    fs.cpSync(
      path.join(ENTERPRISE_FIXTURES, entry),
      path.join(FIXTURES_IN_COPY(), entry),
      { recursive: true },
    );
  }

  compileRun = node(
    [
      path.join(commonCopy, "Server", "Utils", "TsNode", "Precompile.js"),
      "--project",
      path.join(appCopy, "tsconfig.json"),
      "--root",
      appCopy,
      "--root",
      commonCopy,
    ],
    { cwd: appCopy },
  );
}, 900000);

afterAll(() => {
  if (workDirectory) {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
});

describe("the App and Common, compiled as their image compiles them", () => {
  test("compile: every server module, and the frontend module the server imports", () => {
    expect({
      status: compileRun?.status,
      stderr: compileRun?.stderr,
    }).toEqual({ status: 0, stderr: "" });
    expect(compileRun?.stdout).toMatch(
      /^Compiled \d+ TypeScript files \(1 of them imported from other packages\)/,
    );

    for (const file of [
      "App/Index.js",
      "App/Migrate.js",
      "App/Utils/EnterpriseLoader.js",
      // Imported by the App's BaseAPI from the recorder's own package.
      "App/FeatureSet/BrowserRecorder/Manifest.js",
      "Common/Server/Infrastructure/Postgres/DataSourceOptions.js",
      "Common/Models/DatabaseModels/Index.js",
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.js",
    ]) {
      expect({ file, there: fs.existsSync(path.join(copyRoot, file)) }).toEqual(
        { file, there: true },
      );
      expect(fs.existsSync(path.join(copyRoot, `${file}.map`))).toBe(true);
    }
    // The frontends are bundled for the browser, and stay TypeScript.
    expect(
      fs.existsSync(
        path.join(appCopy, "FeatureSet", "Dashboard", "src", "Index.js"),
      ),
    ).toBe(false);
  });

  test("every module is the JavaScript ts-node runs for it", () => {
    const compare: string = script("compare.js", [
      '"use strict";',
      "const fs = require('fs');",
      "const path = require('path');",
      "const [appCopy, commonCopy] = process.argv.slice(2);",
      "const tsNode = require(require.resolve('ts-node', { paths: [appCopy] }));",
      "const service = tsNode.create({ project: path.join(appCopy, 'tsconfig.json'), transpileOnly: true });",
      "const files = [];",
      "const walk = (directory) => {",
      "  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {",
      "    const full = path.join(directory, entry.name);",
      "    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); }",
      "    else if (/\\.tsx?$/.test(entry.name) && fs.existsSync(full.replace(/\\.tsx?$/, '.js.map'))) files.push(full);",
      "  }",
      "};",
      "walk(appCopy); walk(commonCopy);",
      "files.sort();",
      "const decorated = /^\\s*@\\w+\\(/m;",
      "const bySize = files.slice().sort((a, b) => fs.statSync(b).size - fs.statSync(a).size).slice(0, 20);",
      "const sample = files.filter((file, index) => file.includes(path.sep + 'Models' + path.sep) || decorated.test(fs.readFileSync(file, 'utf8')) || index % 9 === 0 || bySize.includes(file));",
      "const INLINE = /\\n\\/\\/# sourceMappingURL=data:application\\/json;charset=utf-8;base64,[A-Za-z0-9+/=]+$/;",
      "const OWN = /\\n\\/\\/# sourceMappingURL=[^\\n/]+\\.js\\.map$/;",
      "const different = [];",
      "let decoratedModules = 0;",
      "for (const file of sample) {",
      "  const runtime = service.compile(fs.readFileSync(file, 'utf8'), file);",
      "  const compiled = fs.readFileSync(file.replace(/\\.tsx?$/, '.js'), 'utf8');",
      "  if (compiled.includes('__metadata(\"design:type\"')) decoratedModules++;",
      "  if (!INLINE.test(runtime) || !OWN.test(compiled) || runtime.replace(INLINE, '') !== compiled.replace(OWN, '')) different.push(file);",
      "}",
      "process.stdout.write(JSON.stringify({ files: files.length, compared: sample.length, decoratedModules, different: different.slice(0, 10) }) + '\\n');",
    ]);
    const run: SpawnSyncReturns<string> = node([compare, appCopy, commonCopy], {
      cwd: appCopy,
    });
    const result: {
      files: number;
      compared: number;
      decoratedModules: number;
      different: Array<string>;
    } = lastJson(run) as {
      files: number;
      compared: number;
      decoratedModules: number;
      different: Array<string>;
    };

    expect(result.different).toEqual([]);
    expect(result.files).toBeGreaterThan(8000);
    expect(result.compared).toBeGreaterThan(1500);
    // The database models' decorator metadata among them.
    expect(result.decoratedModules).toBeGreaterThan(500);
  }, 900000);

  /*
   * What TypeORM makes of the entities and migrations: what the App's
   * database is, built without a database (DataSource.buildMetadatas).
   */
  const TYPEORM_METADATA: Array<string> = [
    '"use strict";',
    "const path = require('path');",
    "const { DataSource } = require(require.resolve('typeorm', { paths: [path.resolve('../Common')] }));",
    "const options = require(require.resolve('Common/Server/Infrastructure/Postgres/DataSourceOptions', { paths: [process.cwd()] })).default;",
    "const dataSource = new DataSource(options);",
    "const typeName = (type) => (typeof type === 'function' ? type.name : String(type));",
    "dataSource.buildMetadatas().then(() => {",
    "  const entities = dataSource.entityMetadatas.map((entity) => ({",
    "    table: entity.tableName,",
    "    columns: entity.columns.map((column) => [column.propertyName, column.databaseName, typeName(column.type), column.isNullable, column.isPrimary, column.isGenerated, String(column.length), column.default === undefined ? null : JSON.stringify(column.default)]),",
    "    relations: entity.relations.map((relation) => [relation.propertyName, relation.relationType, relation.inverseEntityMetadata.tableName, relation.isNullable]),",
    "    indices: entity.indices.map((index) => [index.name, index.isUnique]),",
    "  })).sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0));",
    "  const migrations = dataSource.migrations.map((migration) => migration.name || migration.constructor.name);",
    "  const digest = (value) => require('crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');",
    "  const tables = {};",
    "  for (const entity of entities) tables[entity.table] = digest(entity);",
    "  const columns = entities.reduce((total, entity) => total + entity.columns.length, 0);",
    "  process.stdout.write(JSON.stringify({ columns, tables, migrations: migrations.length, migrationsDigest: digest(migrations) }) + '\\n', () => process.exit(0));",
    "}, (error) => { console.error(error); process.exit(1); });",
  ];

  test("TypeORM builds the same entities and migrations from both: the same decorator metadata", () => {
    const metadata: string = script("typeorm-metadata.js", TYPEORM_METADATA);
    const underTsNode: SpawnSyncReturns<string> = node(
      ["--require", "ts-node/register", metadata],
      { cwd: APP_ROOT },
    );
    const compiled: SpawnSyncReturns<string> = node(
      ["--require", PRECOMPILED_SOURCE_MAPS, metadata],
      { cwd: appCopy },
    );
    interface Metadata {
      columns: number;
      tables: Record<string, string>;
      migrations: number;
      migrationsDigest: string;
    }
    const fromTsNode: Metadata = lastJson(underTsNode) as Metadata;
    const fromCompiled: Metadata = lastJson(compiled) as Metadata;

    expect(Object.keys(fromTsNode.tables).length).toBeGreaterThan(400);
    expect(fromTsNode.columns).toBeGreaterThan(10000);
    expect(fromTsNode.migrations).toBeGreaterThan(900);
    // Each table's columns, types, relations and indices, by digest.
    expect(fromCompiled).toEqual(fromTsNode);
  }, 900000);

  test("migrations load from the compiled tree: one for every migration file", () => {
    const migrationsFolder: string = path.join(
      commonCopy,
      "Server",
      "Infrastructure",
      "Postgres",
      "SchemaMigrations",
    );
    const migrationFiles: Array<string> = fs
      .readdirSync(migrationsFolder)
      .filter((name: string) => {
        // eslint-disable-next-line wrap-regex -- Parentheses conflict with Prettier.
        return /^\d+-.*\.ts$/.test(name);
      });
    const run: SpawnSyncReturns<string> = node(
      [
        "--require",
        PRECOMPILED_SOURCE_MAPS,
        "-e",
        [
          "const migrations = require('Common/Server/Infrastructure/Postgres/SchemaMigrations/Index').default;",
          "const loaded = Object.keys(require.cache).filter((file) => /SchemaMigrations[\\\\/]\\d+-[^\\\\/]*\\.js$/.test(file));",
          "process.stdout.write(JSON.stringify({ count: migrations.length, loaded: loaded.length, runnable: migrations.filter((migration) => typeof migration.prototype.up === 'function' && typeof migration.prototype.down === 'function').length }) + '\\n');",
        ].join("\n"),
      ],
      { cwd: appCopy },
    );

    expect(migrationFiles.length).toBeGreaterThan(900);
    expect(lastJson(run)).toEqual({
      count: migrationFiles.length,
      loaded: migrationFiles.length,
      runnable: migrationFiles.length,
    });
  }, 300000);

  test("stack traces name the TypeScript files, lines and columns ts-node's did", () => {
    const stack: string = script("stack.js", [
      '"use strict";',
      "const Port = require(require.resolve('Common/Types/Port', { paths: [process.cwd()] })).default;",
      "try { new Port(-1); } catch (error) {",
      "  const frames = String(error.stack).split('\\n').slice(0, 3).map((line) => line.replace(/^.*[\\\\/]packages[\\\\/]/, 'packages/'));",
      "  process.stdout.write(JSON.stringify(frames) + '\\n');",
      "}",
    ]);
    const underTsNode: unknown = lastJson(
      node(["--require", "ts-node/register", stack], { cwd: APP_ROOT }),
    );
    const compiled: unknown = lastJson(
      node(["--require", PRECOMPILED_SOURCE_MAPS, stack], { cwd: appCopy }),
    );
    const withoutMaps: unknown = lastJson(node([stack], { cwd: appCopy }));

    expect(compiled).toEqual(underTsNode);
    expect(JSON.stringify(compiled)).toContain(
      "packages/Common/Types/Port.ts:",
    );
    // (control) Without the stack-trace support, the JavaScript's lines.
    expect(JSON.stringify(withoutMaps)).toContain(
      "packages/Common/Types/Port.js:",
    );
  }, 300000);

  test("every module's read of a file beside it (__dirname) finds it", () => {
    const reads: Array<{ module: string; target: string }> = [];
    // As the compiled code calls them: path_1.default.join(__dirname, "a").
    const READ: RegExp =
      /\bpath(?:_\d+)?(?:\.default)?\.(?:join|resolve)\(\s*__dirname\s*((?:,\s*"[^"]*"\s*)+)\)/g;
    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") {
            walk(full);
          }
        } else if (entry.name.endsWith(".js") && fs.existsSync(`${full}.map`)) {
          const text: string = fs.readFileSync(full, "utf8");
          for (const match of text.matchAll(READ)) {
            const parts: Array<string> = [
              ...(match[1] as string).matchAll(/"([^"]*)"/g),
            ].map((part: RegExpMatchArray) => {
              return part[1] as string;
            });
            reads.push({
              module: path.relative(copyRoot, full),
              target: path.resolve(path.dirname(full), ...parts),
            });
          }
        }
      }
    };
    walk(appCopy);
    walk(commonCopy);

    expect(reads.length).toBeGreaterThan(5);
    for (const read of reads) {
      expect({ ...read, found: fs.existsSync(read.target) }).toEqual({
        ...read,
        found: true,
      });
    }
  });

  test("Common's services load without a TypeScript file, ts-node or TypeScript's compiler", () => {
    const run: SpawnSyncReturns<string> = node(
      [
        "--require",
        PRECOMPILED_SOURCE_MAPS,
        "-e",
        [
          "require('Common/Server/Services/Index');",
          "const loaded = Object.keys(require.cache);",
          "process.stdout.write(JSON.stringify({ modules: loaded.length, typeScript: loaded.filter((file) => /\\.(ts|tsx|mts|cts)$/.test(file)), tooling: loaded.filter((file) => /[\\\\/]node_modules[\\\\/](typescript|ts-node)[\\\\/]/.test(file)) }) + '\\n');",
        ].join("\n"),
      ],
      { cwd: appCopy },
    );
    const result: {
      modules: number;
      typeScript: Array<string>;
      tooling: Array<string>;
    } = lastJson(run) as {
      modules: number;
      typeScript: Array<string>;
      tooling: Array<string>;
    };

    expect(result.modules).toBeGreaterThan(5000);
    expect(result.typeScript).toEqual([]);
    expect(result.tooling).toEqual([]);
  }, 300000);

  test("the Enterprise loader loads a compiled ee/ entry, Server/Index.js", () => {
    const directory: string = path.join(FIXTURES_IN_COPY(), "DefaultExport");
    const run: SpawnSyncReturns<string> = node(
      [
        "--require",
        PRECOMPILED_SOURCE_MAPS,
        path.join(FIXTURES_IN_COPY(), "BootProbe.js"),
      ],
      {
        cwd: appCopy,
        env: {
          ONEUPTIME_EDITION: "enterprise",
          ONEUPTIME_EE_DIR: directory,
          BILLING_ENABLED: "false",
        },
      },
    );
    const line: string | undefined = run.stdout
      .split("\n")
      .find((text: string) => {
        return text.startsWith("ENTERPRISE_BOOT_PROBE_RESULT ");
      });

    expect({
      status: run.status,
      line: Boolean(line),
      stderr: run.stderr,
    }).toEqual({ status: 0, line: true, stderr: "" });
    expect(
      JSON.parse(
        (line as string).slice("ENTERPRISE_BOOT_PROBE_RESULT ".length),
      ),
    ).toEqual(
      expect.objectContaining({
        outcome: "loaded",
        edition: "enterprise",
        entryFile: path.join(directory, "Server", "Index.js"),
        isLoaded: true,
        version: "0.0.0-DefaultExport",
      }),
    );
  }, 300000);
});
