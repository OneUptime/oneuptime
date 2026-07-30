/*
 * jsdom is the right environment for this package - it gives real
 * localStorage, sessionStorage, history and a real DOM for rrweb to walk -
 * but it stops at the edge of the platform APIs a network client needs.
 * TextEncoder, Response and CompressionStream all exist in every browser the
 * recorder targets and in Node, and none of them exist in jsdom.
 *
 * They are copied in from the Node runtime rather than stubbed, so the gzip
 * path under test is the same code path a browser runs, not a mock of it.
 *
 * Plain JavaScript on purpose: the package's tsconfig deliberately excludes
 * @types/node (this is browser code, and Node's fetch/BodyInit definitions
 * conflict with the DOM's), so a TypeScript setup file could not reference
 * `require` or `global` at all.
 */

const { TextDecoder, TextEncoder } = require("util");

if (typeof globalThis.TextEncoder !== "function") {
  globalThis.TextEncoder = TextEncoder;
}

if (typeof globalThis.TextDecoder !== "function") {
  globalThis.TextDecoder = TextDecoder;
}

const NODE_GLOBALS_TO_BORROW = [
  // Needed to read a CompressionStream's output.
  "Response",
  "Headers",
  "Request",
  "Blob",
  "CompressionStream",
  "DecompressionStream",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
];

for (const name of NODE_GLOBALS_TO_BORROW) {
  if (
    typeof globalThis[name] !== "function" &&
    typeof global[name] === "function"
  ) {
    globalThis[name] = global[name];
  }
}
