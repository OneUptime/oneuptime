"use strict";

/**
 * packages/Common/Types/InstallScripts/InstallScripts.ts, loaded as the
 * module it is: the install scripts every OneUptime serves at
 * /install/<name>, and the files under each. The App serves exactly this
 * list, so the ops tests hold the agents' install.sh files, the App's
 * Dockerfile and the docs to the real values rather than to a copy.
 *
 * The module imports nothing, so TypeScript's own transpiler turns it into
 * CommonJS and it runs as it is.
 */

const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const CATALOG_FILE = path.join(
  REPO_ROOT,
  "packages",
  "Common",
  "Types",
  "InstallScripts",
  "InstallScripts.ts",
);

let loaded = null;

function loadInstallScriptsCatalog() {
  if (loaded) {
    return loaded;
  }

  const source = fs.readFileSync(CATALOG_FILE, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: CATALOG_FILE,
  });

  const catalog = new Module(CATALOG_FILE);
  catalog.filename = CATALOG_FILE;
  catalog.paths = [];
  catalog._compile(outputText, CATALOG_FILE);

  if (!Array.isArray(catalog.exports.INSTALL_SCRIPTS)) {
    throw new Error(`${CATALOG_FILE} no longer exports INSTALL_SCRIPTS`);
  }

  loaded = catalog.exports;

  return loaded;
}

/** The entry whose folder is agents/<agentDirectory>, or null. */
function entryForAgentDirectory(agentDirectory) {
  return (
    loadInstallScriptsCatalog().INSTALL_SCRIPTS.find((entry) => {
      return entry.sourceDirectory === `agents/${agentDirectory}`;
    }) || null
  );
}

module.exports = {
  CATALOG_FILE,
  REPO_ROOT,
  entryForAgentDirectory,
  loadInstallScriptsCatalog,
};
