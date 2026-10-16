"use strict";

/*
 * Builds the CLI npm publishes as @oneuptime/cli: one CommonJS file,
 * build/dist/Index.js, holding the CLI, the parts of packages/Common it uses
 * and every package those need, plus build/dist/THIRD-PARTY-LICENSES.txt
 * with the licenses of the packages it holds. `npm pack` and `npm publish`
 * run it (the prepack script); `npm run build` runs it by hand.
 *
 * Why one file (#4872): the CLI imports Common by its monorepo name, as in
 * "Common/Models/DatabaseModels/Index". Compiled by tsc alone those imports
 * stayed bare require() calls, and nothing on a customer's machine answers
 * them: the @oneuptime/common package holds only TypeScript at those paths,
 * and its JavaScript is ES modules under build/dist. Every CLI published
 * since 10.0.5 died at start with "Cannot find module
 * 'Common/Models/DatabaseModels/Index'". A bundle answers every import when
 * it is built, so the installed CLI needs no other package (no
 * @oneuptime/common with its 1,000 dependencies and native builds), and it
 * starts the same on every machine.
 */

const fs = require("fs");
const path = require("path");

const CLI_ROOT = __dirname;

const OUTPUT_DIRECTORY = path.join(CLI_ROOT, "build", "dist");

const BUNDLE_FILE_NAME = "Index.js";

const LICENSES_FILE_NAME = "THIRD-PARTY-LICENSES.txt";

/*
 * The oldest Node.js the bundle is built for: the oldest Node.js line still
 * maintained. package.json's engines says the same (Tests/BundleBuild holds
 * the two together), and CLI Test runs the packed CLI on every line from it
 * up.
 */
const NODE_TARGET = "node22";

/*
 * The database drivers typeorm's PlatformTools.load() requires when a
 * DataSource connects. The CLI loads Common's models for what their
 * decorators say (table names, API paths, columns) and never connects to a
 * database. Bundled, the four Common installs (pg, mysql2, mssql, ioredis)
 * would add about 5 MB that never runs. Their require() calls sit inside
 * load(), so leaving them out of the bundle changes nothing at run time.
 * Tests/BundleBuild holds this list to the one in typeorm's source.
 */
const TYPEORM_DATABASE_DRIVERS = [
  "@google-cloud/spanner",
  "@sap/hana-client",
  "@sap/hana-client/extension/Stream",
  "better-sqlite3",
  "ioredis",
  "mongodb",
  "mssql",
  "mysql",
  "mysql2",
  "oracledb",
  "pg",
  "pg-native",
  "pg-query-stream",
  "react-native-sqlite-storage",
  "redis",
  "sql.js",
  "sqlite3",
  "typeorm-aurora-data-api-driver",
];

/*
 * A package's license files: LICENSE, LICENCE.md, LICENSE-MIT, COPYING,
 * NOTICE (Apache-2.0 asks for a NOTICE file to travel with the code), in any
 * case - but not code that happens to be named so (license-checker.js).
 */
const LICENSE_FILE_NAME = /^(?:licen[cs]e|copying|notice)(?:[.-][\w.-]*)?$/i;

const CODE_FILE_NAME = /\.(?:[cm]?[jt]sx?|json|map)$/i;

/**
 * The esbuild options of the bundle.
 * @param {{ outputDirectory?: string }} [settings] - where to write it
 * @returns {import("esbuild").BuildOptions & { metafile: true }} the options
 */
function createBuildOptions(settings) {
  const outputDirectory =
    (settings && settings.outputDirectory) || OUTPUT_DIRECTORY;

  return {
    absWorkingDir: CLI_ROOT,
    entryPoints: [path.join(CLI_ROOT, "Index.ts")],
    outfile: path.join(outputDirectory, BUNDLE_FILE_NAME),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: [NODE_TARGET],
    /*
     * Named, not discovered. esbuild compiles each file with the
     * tsconfig.json nearest to it, but never reads one inside node_modules -
     * and Common is a copy inside node_modules wherever npm installs it
     * rather than linking it (a registry copy, or install-links). Without
     * experimentalDecorators esbuild then compiles the models' decorators as
     * standard ones, and the bundle dies on the first typeorm decorator it
     * runs ("Cannot read properties of undefined (reading 'constructor')").
     */
    tsconfig: path.join(CLI_ROOT, "tsconfig.json"),
    // Class names as written: Common prints and serializes some of them.
    keepNames: true,
    external: TYPEORM_DATABASE_DRIVERS,
    metafile: true,
    logLevel: "warning",
  };
}

/**
 * The directory of the package a file belongs to, when the file sits under a
 * node_modules directory: node_modules/<name> or node_modules/@<scope>/<name>.
 * @param {string} file - an absolute path
 * @returns {string | null} the package directory, or null for a file of ours
 */
function packageDirectoryOf(file) {
  const parts = file.split(path.sep);
  const at = parts.lastIndexOf("node_modules");

  if (at === -1) {
    return null;
  }

  const nameParts = (parts[at + 1] || "").startsWith("@") ? 2 : 1;

  // node_modules, its package's name, then at least one file inside it.
  if (parts.length < at + 1 + nameParts + 1) {
    return null;
  }

  return parts.slice(0, at + 1 + nameParts).join(path.sep);
}

/**
 * A package.json's license, as an SPDX expression where it gives one.
 * @param {object} manifest - the parsed package.json
 * @returns {string} the license, or "UNKNOWN" when it names none
 */
function licenseOf(manifest) {
  if (typeof manifest.license === "string" && manifest.license.trim()) {
    return manifest.license.trim();
  }

  if (manifest.license && typeof manifest.license.type === "string") {
    return manifest.license.type;
  }

  // The deprecated form: "licenses": [{ "type": "MIT" }, ...].
  if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) {
    return manifest.licenses
      .map((entry) => {
        return typeof entry === "string" ? entry : entry && entry.type;
      })
      .filter(Boolean)
      .join(" OR ");
  }

  return "UNKNOWN";
}

/**
 * The third-party packages a build put into the bundle: every input under a
 * node_modules directory, by the package it belongs to.
 * @param {{ inputs: Record<string, unknown> }} metafile - esbuild's metafile
 * @param {string} [workingDirectory] - what the metafile's paths are relative to
 * @returns {Array<{ name: string, version: string, license: string, directory: string, licenseTexts: Array<string> }>}
 *   one entry per package directory, by name then version
 */
function bundledPackages(metafile, workingDirectory) {
  const root = workingDirectory || CLI_ROOT;
  const byDirectory = new Map();

  for (const input of Object.keys(metafile.inputs)) {
    const directory = packageDirectoryOf(path.resolve(root, input));

    if (!directory || byDirectory.has(directory)) {
      continue;
    }

    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf8"),
    );

    const licenseTexts = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => {
        return (
          entry.isFile() &&
          LICENSE_FILE_NAME.test(entry.name) &&
          !CODE_FILE_NAME.test(entry.name)
        );
      })
      .map((entry) => {
        return entry.name;
      })
      .sort()
      .map((name) => {
        return fs.readFileSync(path.join(directory, name), "utf8").trim();
      });

    byDirectory.set(directory, {
      name: manifest.name,
      version: manifest.version,
      license: licenseOf(manifest),
      directory: directory,
      licenseTexts: licenseTexts,
    });
  }

  return [...byDirectory.values()].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }

    if (a.version !== b.version) {
      return a.version < b.version ? -1 : 1;
    }

    return a.directory < b.directory ? -1 : 1;
  });
}

/**
 * THIRD-PARTY-LICENSES.txt: every package the bundle holds, with its license.
 * @param {Array<{ name: string, version: string, license: string, licenseTexts: Array<string> }>} packages
 *   from bundledPackages()
 * @returns {string} the file's text
 */
function renderLicenses(packages) {
  const sections = packages.map((entry) => {
    const texts =
      entry.licenseTexts.length > 0
        ? entry.licenseTexts.join("\n\n")
        : `The package ships no license file. Its package.json declares: ${entry.license}`;

    return [
      `${entry.name} ${entry.version}`,
      `License: ${entry.license}`,
      "",
      texts,
    ].join("\n");
  });

  return [
    "The OneUptime CLI (build/dist/Index.js) includes the third-party",
    "packages below. Each keeps its own license, reproduced here.",
    "",
    ...sections.map((section) => {
      return `${"=".repeat(72)}\n${section}\n`;
    }),
  ].join("\n");
}

/**
 * Builds the bundle and its license file into a clean output directory.
 * @param {{ outputDirectory?: string }} [settings] - where to write them
 * @returns {Promise<{ bundleFile: string, licensesFile: string, metafile: object, packages: Array<object> }>}
 *   what it wrote, with esbuild's metafile and the packages the bundle holds
 */
async function build(settings) {
  const esbuild = require("esbuild");
  const options = createBuildOptions(settings);
  const outputDirectory = path.dirname(options.outfile);

  // Nothing from an earlier build, or from a stray tsc run, may ship.
  fs.rmSync(outputDirectory, { recursive: true, force: true });

  const result = await esbuild.build(options);
  const packages = bundledPackages(result.metafile, CLI_ROOT);
  const licensesFile = path.join(outputDirectory, LICENSES_FILE_NAME);

  fs.writeFileSync(licensesFile, renderLicenses(packages));

  return {
    bundleFile: options.outfile,
    licensesFile: licensesFile,
    metafile: result.metafile,
    packages: packages,
  };
}

module.exports = {
  CLI_ROOT,
  OUTPUT_DIRECTORY,
  BUNDLE_FILE_NAME,
  LICENSES_FILE_NAME,
  NODE_TARGET,
  TYPEORM_DATABASE_DRIVERS,
  createBuildOptions,
  packageDirectoryOf,
  licenseOf,
  bundledPackages,
  renderLicenses,
  build,
};

if (require.main === module) {
  build().catch((error) => {
    // esbuild has already printed what failed.
    process.stderr.write(`${error && error.message ? error.message : error}\n`);
    process.exit(1);
  });
}
