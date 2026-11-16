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
 * And source-map-support keeps only the maps and files it used last (see
 * boundSourceMapSupportCaches): it kept, for the life of the process, the
 * decoded map of every script a stack trace ever passed through and the text
 * of every file it read on the way - over a gigabyte once a stack trace has
 * passed through each of the App's modules.
 *
 * In development (NODE_ENV=development) this returns no transpiler, so
 * ts-node compiles as it always has: debuggers find each module's inline
 * map. So it does for ts-node's node16/nodenext emit variants, which no
 * OneUptime package uses. ts-node's custom transformers option is not
 * supported by custom transpilers; no OneUptime package sets it.
 *
 * Tests: packages/Common/Tests/Server/Utils/TsNode/.
 */

const { Buffer } = require("buffer");
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

/*
 * What source-map-support keeps between stack traces: the source maps and the
 * files it used last, up to these budgets. A stack trace maps each frame
 * through the decoded map of the frame's script, and source-map-support kept
 * every map it ever decoded, and the text of every file it read to find one
 * (a module's TypeScript; a package's whole script, read for its
 * sourceMappingURL comment), for the life of the process: once a stack trace
 * had passed through each of the 8,382 scripts of Common's services, 1,047 MB
 * of heap. A decoded map takes about 24 bytes for each character of its
 * encoded mappings, beside the module's TypeScript it keeps as sourcesContent
 * (DatabaseService.ts: 188 KB of mappings and 420 KB of TypeScript, 5 MB), and
 * a stack trace that passes through a script whose map was let go of decodes
 * it again (83 ms for DatabaseService.ts, 4 ms for a module of median size,
 * where a kept map answers in a fortieth of a millisecond). So the budget for
 * maps holds what a busy server's stack traces pass through again and again -
 * dozens of modules, its largest among them - and lets go of what a
 * long-running process meets once in a while; the text of a file is wanted
 * only while its map is found, and for the source line of an uncaught
 * exception, which is read from disk when it is gone.
 */
const SOURCE_MAP_CACHE_BYTES = 48 * 1024 * 1024;
const FILE_CONTENTS_CACHE_CHARACTERS = 8 * 1024 * 1024;
// Heap a decoded map takes for each character of its encoded mappings.
const DECODED_MAP_BYTES_PER_MAPPING_CHARACTER = 24;
// A script without a map, and a map whose mappings were handed over decoded.
const SCRIPT_WITHOUT_MAP_BYTES = 512;
const MAP_OF_UNKNOWN_SIZE_BYTES = 256 * 1024;

/*
 * source-map-support's state, which every copy of it shares (0.8's, the one
 * ts-node 10 installs): sourceMapCache and fileContentsCache are objects it
 * reads, writes and asks hasOwnProperty of, by key, and replaces only when
 * asked to empty them before every stack trace (emptyCacheBetweenOperations).
 * Each map it keeps is trace-mapping's TraceMap, which holds the encoded
 * mappings as _encoded, and their decoded segments beside them once a stack
 * trace has used them. App/Tests/SourceMapSupportCaches holds the library to
 * that.
 */
const SOURCE_MAP_SUPPORT_SHARED_DATA = Symbol.for(
  "source-map-support/sharedData",
);
const SOURCE_MAP_SUPPORT_SHARED_DATA_VERSION = 1;

/*
 * The heap a sourceMapCache entry ({ url, map }) holds, as near as it can
 * tell: its decoded mappings and the sources it keeps.
 */
function sourceMapCacheEntryBytes(entry) {
  const map = entry && entry.map;
  if (!map) {
    return SCRIPT_WITHOUT_MAP_BYTES;
  }
  let bytes =
    typeof map._encoded === "string"
      ? map._encoded.length * DECODED_MAP_BYTES_PER_MAPPING_CHARACTER
      : MAP_OF_UNKNOWN_SIZE_BYTES;
  for (const text of Array.isArray(map.sourcesContent)
    ? map.sourcesContent
    : []) {
    if (typeof text === "string") {
      bytes += text.length;
    }
  }
  return bytes;
}

// A fileContentsCache entry's characters.
function fileContentsCacheEntryCharacters(text) {
  return typeof text === "string" ? text.length : 0;
}

/*
 * An object source-map-support can keep as a cache, holding at most `budget`
 * of what `weigh` says each value costs: reading a key makes it the newest,
 * and a value that takes the cache past its budget drops the oldest until it
 * is within it again (never the value just kept, however large). A Proxy,
 * because the library reads and writes the cache as an object's properties.
 */
function leastRecentlyUsed(budget, weigh, entries) {
  const kept = new Map();
  let total = 0;

  function forget(key) {
    const entry = kept.get(key);
    if (entry !== undefined) {
      total -= entry.weight;
      kept.delete(key);
    }
  }

  function keep(key, value) {
    forget(key);
    const weight = weigh(value);
    kept.set(key, { value: value, weight: weight });
    total += weight;
    // The map's first key is the one used longest ago.
    for (const oldest of kept.keys()) {
      if (total <= budget || oldest === key) {
        break;
      }
      forget(oldest);
    }
  }

  function touch(key) {
    const entry = kept.get(key);
    kept.delete(key);
    kept.set(key, entry);
    return entry.value;
  }

  for (const key of Object.keys(entries || {})) {
    keep(key, entries[key]);
  }

  return new Proxy(Object.create(null), {
    get: function get(target, key) {
      return kept.has(key) ? touch(key) : undefined;
    },
    set: function set(target, key, value) {
      keep(key, value);
      return true;
    },
    has: function has(target, key) {
      return kept.has(key);
    },
    deleteProperty: function deleteProperty(target, key) {
      forget(key);
      return true;
    },
    defineProperty: function defineProperty(target, key, descriptor) {
      keep(key, descriptor.value);
      return true;
    },
    getOwnPropertyDescriptor: function getOwnPropertyDescriptor(target, key) {
      if (!kept.has(key)) {
        return undefined;
      }
      return {
        value: kept.get(key).value,
        writable: true,
        enumerable: true,
        configurable: true,
      };
    },
    ownKeys: function ownKeys() {
      return Array.from(kept.keys());
    },
  });
}

/*
 * Gives source-map-support caches that keep what it used last. Leaves a copy
 * whose state it does not know as it is, and says so (false).
 */
function boundSourceMapSupportCaches() {
  const shared = globalThis[SOURCE_MAP_SUPPORT_SHARED_DATA];
  if (
    !shared ||
    shared.version !== SOURCE_MAP_SUPPORT_SHARED_DATA_VERSION ||
    typeof shared.sourceMapCache !== "object" ||
    typeof shared.fileContentsCache !== "object"
  ) {
    return false;
  }
  shared.sourceMapCache = leastRecentlyUsed(
    SOURCE_MAP_CACHE_BYTES,
    sourceMapCacheEntryBytes,
    shared.sourceMapCache,
  );
  shared.fileContentsCache = leastRecentlyUsed(
    FILE_CONTENTS_CACHE_CHARACTERS,
    fileContentsCacheEntryCharacters,
    shared.fileContentsCache,
  );
  return true;
}

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
  boundSourceMapSupportCaches();
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
  leastRecentlyUsed: leastRecentlyUsed,
  boundSourceMapSupportCaches: boundSourceMapSupportCaches,
  sourceMapCacheEntryBytes: sourceMapCacheEntryBytes,
  fileContentsCacheEntryCharacters: fileContentsCacheEntryCharacters,
  SOURCE_MAP_CACHE_BYTES: SOURCE_MAP_CACHE_BYTES,
  FILE_CONTENTS_CACHE_CHARACTERS: FILE_CONTENTS_CACHE_CHARACTERS,
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
