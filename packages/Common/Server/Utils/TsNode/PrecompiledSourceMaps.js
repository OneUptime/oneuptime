"use strict";

/*
 * Stack traces for a server that runs the JavaScript its image compiled
 * (Precompile.js), loaded before anything else by every image's start
 * command:
 *
 *   node --require Common/Server/Utils/TsNode/PrecompiledSourceMaps.js Index.js
 *
 * It does two things.
 *
 * 1. Installs source-map-support, as ts-node did, with a handler that finds
 *    a compiled module's map in the Foo.js.map beside it. A map is read the
 *    first time a stack trace passes through its module, and source-map-support
 *    keeps only the maps and files it used last (SourceMapSupportCaches.js).
 *    So stack traces name the TypeScript files, lines and columns they named
 *    under ts-node, and a process holds no map it has not used. (Node's own
 *    --enable-source-maps reads and parses every module's map as the module
 *    loads, and keeps every map a stack trace decodes.) The source line an
 *    uncaught exception prints is read from the TypeScript on disk.
 *
 * 2. Refuses to load TypeScript. Node 26 runs a .ts file it is asked for by
 *    name with its own type stripping, which knows no decorators and loads
 *    the file as an ES module: different code from what the image compiled.
 *    So a require() that reaches a .ts file (a file the build did not
 *    compile, or one asked for by its .ts name) fails, and says so, instead
 *    of running something else.
 *
 * A process that runs its TypeScript through ts-node (a development server,
 * a script) has ts-node's source maps and loads its .ts files through it:
 * there this does nothing.
 *
 * Plain JavaScript, because it is loaded before anything that could compile
 * TypeScript. Tests: packages/Common/Tests/Server/Utils/TsNode/.
 */

const fs = require("fs");
const Module = require("module");
const path = require("path");
const url = require("url");
const SourceMapSupportCaches = require("./SourceMapSupportCaches.js");

// What ts-node keeps on process when it is registered.
const TS_NODE_REGISTERED = Symbol.for("ts-node.register.instance");

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

const INSTALLED = Symbol.for("oneuptime.precompiledSourceMaps.installed");

function isUnderNodeModules(fileName) {
  return fileName.split(/[\\/]/).includes("node_modules");
}

/*
 * The map Precompile.js wrote beside a compiled module (Foo.js.map beside
 * Foo.js), as source-map-support asks for it: by the script's file name or
 * file URL. Null for any other script, which source-map-support's own
 * handler then looks at: an installed package's script, or a file the build
 * did not write a map for.
 */
function retrieveSourceMap(source) {
  try {
    if (typeof source !== "string" || source.length === 0) {
      return null;
    }
    const fileName = source.startsWith("file://")
      ? url.fileURLToPath(source)
      : source;
    if (
      !path.isAbsolute(fileName) ||
      path.extname(fileName) !== ".js" ||
      isUnderNodeModules(fileName)
    ) {
      return null;
    }
    const mapFile = `${fileName}.map`;
    // Its sources name the TypeScript beside it, relative to the map.
    return { url: mapFile, map: fs.readFileSync(mapFile, "utf8") };
  } catch {
    // No map: a stack trace through this module names its JavaScript.
    return null;
  }
}

function refuseTypeScript(module, fileName) {
  throw new Error(
    `${fileName} is TypeScript, and this process runs the JavaScript its image compiled when it was built (Common/Server/Utils/TsNode/Precompile.js). ` +
      `Either the build did not compile ${path.basename(fileName)}, or something requires it by its .ts name: require it without its extension, as every other module is.`,
  );
}

function install() {
  if (process[TS_NODE_REGISTERED] || globalThis[INSTALLED]) {
    return false;
  }
  globalThis[INSTALLED] = true;

  for (const extension of TYPESCRIPT_EXTENSIONS) {
    Module._extensions[extension] = refuseTypeScript;
  }

  require("@cspotcode/source-map-support").install({
    environment: "node",
    retrieveSourceMap: retrieveSourceMap,
  });
  SourceMapSupportCaches.boundSourceMapSupportCaches();
  return true;
}

install();

module.exports = {
  install: install,
  // For tests.
  retrieveSourceMap: retrieveSourceMap,
  refuseTypeScript: refuseTypeScript,
};
