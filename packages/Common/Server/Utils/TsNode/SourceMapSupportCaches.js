"use strict";

/*
 * A budget for what source-map-support keeps between stack traces, for both
 * ways a OneUptime server runs: through ts-node with Common's transpiler
 * (Transpiler.js: development, scripts, tests) and as JavaScript compiled at
 * image build time (PrecompiledSourceMaps.js: every image). Plain
 * JavaScript that needs nothing but Node, because both load it before any
 * TypeScript.
 *
 * Tests: packages/Common/Tests/Server/Utils/TsNode/Transpiler.test.ts and
 * packages/App/Tests/SourceMapSupportCaches.test.ts.
 */

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
 * ts-node 10 installs and the images install): sourceMapCache and
 * fileContentsCache are objects it reads, writes and asks hasOwnProperty of,
 * by key, and replaces only when asked to empty them before every stack trace
 * (emptyCacheBetweenOperations). Each map it keeps is trace-mapping's
 * TraceMap, which holds the encoded mappings as _encoded, and their decoded
 * segments beside them once a stack trace has used them.
 * App/Tests/SourceMapSupportCaches holds the library to that.
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

module.exports = {
  leastRecentlyUsed: leastRecentlyUsed,
  boundSourceMapSupportCaches: boundSourceMapSupportCaches,
  sourceMapCacheEntryBytes: sourceMapCacheEntryBytes,
  fileContentsCacheEntryCharacters: fileContentsCacheEntryCharacters,
  SOURCE_MAP_CACHE_BYTES: SOURCE_MAP_CACHE_BYTES,
  FILE_CONTENTS_CACHE_CHARACTERS: FILE_CONTENTS_CACHE_CHARACTERS,
};
