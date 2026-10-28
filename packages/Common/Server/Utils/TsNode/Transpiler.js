"use strict";

/*
 * The ts-node transpiler every OneUptime server runs its TypeScript with
 * (tsconfig.json "ts-node": { "transpiler": ... } in App, Probe, Runner and
 * the other server packages). It is plain JavaScript because ts-node loads it
 * before it can load TypeScript.
 *
 * Why: ts-node's transpile-only mode appends each module's source map, with
 * the module's whole TypeScript source in it (inlineSources), to the
 * module's JavaScript as base64. V8 keeps a script's text for as long as the
 * process runs, and keeps that data: URL a second time as the script's source
 * map URL. For the App's ~5,500 modules that was about 470 MB of a 1.4 GB
 * heap, held from boot to exit for stack traces that need a few of them.
 *
 * So, except in development, each module is compiled exactly as ts-node
 * compiles it, with two differences that change nothing a program can see:
 * - the code ends with an empty source map (ts-node appends the map a
 *   transpiler returns, inline), and the module's real map is kept here,
 *   deflated (about 7 MB for the App). When a stack trace first passes
 *   through the module, source-map-support - which ts-node installs for
 *   stack traces - gets that map, with the module's TypeScript read from
 *   disk as its sourcesContent, as it read the inline map before. Stack
 *   traces name the same TypeScript files, lines and columns as before.
 * - comments are left out of the code (removeComments). Only
 *   Function.prototype.toString() could tell, and nothing reads OneUptime's
 *   own functions' text. License comments (/*!) stay.
 *
 * In development (NODE_ENV=development) this returns no transpiler, so
 * ts-node compiles as it always has: debuggers find each module's inline
 * map. So it does for ts-node's node16/nodenext emit variants, which no
 * OneUptime package uses. ts-node's custom transformers option is not
 * supported by custom transpilers; no OneUptime package sets it.
 *
 * Tests: packages/Common/Tests/Server/Utils/TsNode/.
 */

const fs = require("fs");
const url = require("url");
const zlib = require("zlib");

/*
 * What ts-node gets back as the module's source map: none of its mappings.
 * ts-node's updateSourceMap sets its file and sources to the module.
 */
const EMPTY_SOURCE_MAP = '{"version":3,"sources":[],"names":[],"mappings":""}';

/*
 * The source map of every module compiled here, by file name: its names and
 * mappings as JSON, deflated, each byte one character of a string. Not a
 * Buffer: a small Buffer is a slice of a 64 KB pool slab (Node 26's
 * Buffer.poolSize), and 5,500 of them kept for the life of the process held
 * 150 MB of slabs.
 */
const sourceMaps = new Map();

let sourceMapSupportHooked = false;

function normalizeFileName(fileName) {
  let name = fileName;
  if (name.startsWith("file://")) {
    name = url.fileURLToPath(name);
  }
  return name.split("\\").join("/");
}

/*
 * True when modules keep their source maps outside their code: everywhere
 * but development.
 */
function keepsSourceMapsOutsideCode() {
  return process.env["NODE_ENV"] !== "development";
}

/*
 * The source map of a module compiled here, as ts-node's inline map was
 * (version, file, sources, names, mappings and the module's TypeScript as
 * sourcesContent), or null for any other script.
 */
function retrieveSourceMap(source) {
  try {
    if (typeof source !== "string" || source.length === 0) {
      return null;
    }
    const fileName = normalizeFileName(source);
    const kept = sourceMaps.get(fileName);
    if (!kept) {
      return null;
    }
    const parts = JSON.parse(
      zlib.inflateRawSync(Buffer.from(kept, "latin1")).toString("utf8"),
    );
    const map = {
      version: 3,
      file: fileName,
      sources: [fileName],
      names: parts.names,
      mappings: parts.mappings,
    };
    const typeScript = readSource(fileName);
    if (typeScript !== null) {
      map.sourcesContent = [typeScript];
    }
    return { url: source, map: map };
  } catch {
    // A stack trace without this module's map names its JavaScript lines.
    return null;
  }
}

// The module's TypeScript as Node read it (without a byte order mark).
function readSource(fileName) {
  try {
    const text = fs.readFileSync(fileName, "utf8");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return null;
  }
}

/*
 * Hands source-map-support the kept maps. It is the copy ts-node installed
 * (resolved as ts-node resolves it), and its handlers live in state every
 * copy shares, so this handler is asked before the one that reads inline
 * maps.
 */
function hookSourceMapSupport(resolve) {
  if (sourceMapSupportHooked) {
    return;
  }
  sourceMapSupportHooked = true;
  const sourceMapSupport = require(
    resolve("@cspotcode/source-map-support", true),
  );
  sourceMapSupport.install({ retrieveSourceMap: retrieveSourceMap });
}

function keepSourceMap(fileName, sourceMapText) {
  const map = JSON.parse(sourceMapText);
  const deflated = zlib.deflateRawSync(
    JSON.stringify({ names: map.names, mappings: map.mappings }),
  );
  sourceMaps.set(normalizeFileName(fileName), deflated.toString("latin1"));
}

/*
 * ts-node's transpiler factory: called once for each emit variant when
 * ts-node starts, with the compiler options of that variant. Returning
 * nothing leaves that variant to ts-node's own transpile.
 */
function create(createOptions) {
  if (!keepsSourceMapsOutsideCode()) {
    return undefined;
  }
  if (createOptions.nodeModuleEmitKind !== undefined) {
    return undefined;
  }

  const service = createOptions.service;
  const resolve = service.projectLocalResolveHelper;
  // The TypeScript ts-node loaded, not a second copy.
  const ts = require(resolve(service.options.compiler || "typescript", true));
  const compilerOptions = {
    ...service.config.options,
    // The map is kept here, without the source (read from disk when needed).
    inlineSources: false,
    removeComments: true,
  };

  hookSourceMapSupport(resolve);

  return {
    transpile: function transpile(input, transpileOptions) {
      const result = ts.transpileModule(input, {
        fileName: transpileOptions.fileName,
        compilerOptions: compilerOptions,
        reportDiagnostics: true,
      });
      if (typeof result.sourceMapText === "string") {
        keepSourceMap(transpileOptions.fileName, result.sourceMapText);
      }
      return {
        outputText: result.outputText,
        sourceMapText: EMPTY_SOURCE_MAP,
        diagnostics: result.diagnostics,
      };
    },
  };
}

module.exports = {
  create: create,
  // For tests.
  retrieveSourceMap: retrieveSourceMap,
  keepsSourceMapsOutsideCode: keepsSourceMapsOutsideCode,
  keptSourceMapCount: function keptSourceMapCount() {
    return sourceMaps.size;
  },
  keptSourceMapBytes: function keptSourceMapBytes() {
    let bytes = 0;
    for (const kept of sourceMaps.values()) {
      bytes += kept.length;
    }
    return bytes;
  },
};
