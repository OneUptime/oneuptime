"use strict";

/**
 * packages/Common/Tests/Helpers/SeededRandom.ts, loaded as the module it is:
 * the one seeded generator every test suite draws from, for the ops tests,
 * which jest runs as plain JavaScript. SeededRandomGuard
 * (packages/Common/Tests/Helpers) fails a test file that rolls a generator
 * of its own.
 *
 * The module imports nothing, so TypeScript's own transpiler turns it into
 * CommonJS and it runs as it is, as Utils/InstallScriptsCatalog loads the
 * install scripts' catalog.
 */

const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SEEDED_RANDOM_FILE = path.join(
  REPO_ROOT,
  "packages",
  "Common",
  "Tests",
  "Helpers",
  "SeededRandom.ts",
);

let loaded = null;

function loadSeededRandom() {
  if (loaded) {
    return loaded;
  }

  const source = fs.readFileSync(SEEDED_RANDOM_FILE, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: SEEDED_RANDOM_FILE,
  });

  const helper = new Module(SEEDED_RANDOM_FILE);
  helper.filename = SEEDED_RANDOM_FILE;
  helper.paths = [];
  helper._compile(outputText, SEEDED_RANDOM_FILE);

  if (typeof helper.exports.seededRandom !== "function") {
    throw new Error(`${SEEDED_RANDOM_FILE} no longer exports seededRandom`);
  }

  loaded = helper.exports;

  return loaded;
}

/**
 * The draws of a seed, as the helper's seededRandom gives them: random() a
 * fraction from 0 up to 1, random(limit) a whole number below the limit.
 */
function seededRandom(seed) {
  return loadSeededRandom().seededRandom(seed);
}

module.exports = {
  SEEDED_RANDOM_FILE,
  seededRandom,
};
