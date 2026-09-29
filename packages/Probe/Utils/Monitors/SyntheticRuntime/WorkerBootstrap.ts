/*
 * This source runs in a dedicated browser Web Worker, never in Node.js.
 * It deliberately has no imports: the entire capability surface is supplied
 * through a private MessagePort and all user-visible objects are worker-realm
 * facades containing copied data or opaque identifiers.
 */
export function getSyntheticMonitorWorkerBootstrapSource(): string {
  return String.raw`"use strict";

(() => {
  const PROTOCOL_VERSION = 1;
  const MAX_REQUEST_BYTES = 1_000_000;
  const MAX_RESULT_BYTES = 5_000_000;
  const MAX_LOG_BYTES = 1_000_000;
  const MAX_LOG_MESSAGES = 10_000;
  const MAX_LOG_MESSAGE_BYTES = 128_000;
  const MAX_METRICS = 100;
  const MAX_SERIALIZATION_DEPTH = 30;
  const MAX_SERIALIZATION_NODES = 20_000;
  const MAX_LOG_SERIALIZATION_NODES = 2_000;
  const MAX_CONTEXT_PAGES = 8;

  const NativeTextEncoder = globalThis.TextEncoder;
  const NativeTextDecoder = globalThis.TextDecoder;
  const nativeCrypto = globalThis.crypto;
  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const nativeSetInterval = globalThis.setInterval.bind(globalThis);
  const nativeClearInterval = globalThis.clearInterval.bind(globalThis);
  const nativeQueueMicrotask = globalThis.queueMicrotask.bind(globalThis);

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    let output = "";
    for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
    return output;
  }

  function hexToBytes(value) {
    if (value.length % 2 !== 0 || !/^[a-f0-9]*$/i.test(value)) {
      throw new Error("Invalid hexadecimal input.");
    }
    const bytes = new Uint8Array(value.length / 2);
    for (let index = 0; index < value.length; index += 2) {
      bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
    }
    return bytes;
  }

  class SandboxBuffer extends Uint8Array {
    static from(value, encoding) {
      if (value instanceof Uint8Array) return new SandboxBuffer(value);
      if (Array.isArray(value)) return new SandboxBuffer(value);
      if (typeof value !== "string") throw new TypeError("Unsupported Buffer input.");
      if (encoding === "base64") return new SandboxBuffer(base64ToBytes(value));
      if (encoding === "hex") return new SandboxBuffer(hexToBytes(value));
      return new SandboxBuffer(new NativeTextEncoder().encode(value));
    }

    static alloc(size, fill) {
      const result = new SandboxBuffer(Number(size));
      if (fill !== undefined) result.fill(Number(fill));
      return result;
    }

    static concat(values) {
      const arrays = values.map((value) => SandboxBuffer.from(value));
      const size = arrays.reduce((total, value) => total + value.length, 0);
      const result = new SandboxBuffer(size);
      let offset = 0;
      for (const value of arrays) {
        result.set(value, offset);
        offset += value.length;
      }
      return result;
    }

    static isBuffer(value) {
      return value instanceof SandboxBuffer;
    }

    static byteLength(value) {
      return SandboxBuffer.from(value).byteLength;
    }

    toString(encoding) {
      if (encoding === "base64") return bytesToBase64(this);
      if (encoding === "hex") return bytesToHex(this);
      return new NativeTextDecoder().decode(this);
    }
  }

  function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  function sha256(input) {
    const bytes = input instanceof Uint8Array ? input : new NativeTextEncoder().encode(String(input));
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    view.setUint32(paddedLength - 8, high, false);
    view.setUint32(paddedLength - 4, low, false);

    const constants = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const hash = new Uint32Array([
      0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
      0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
    ]);
    const words = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        words[index] = view.getUint32(offset + index * 4, false);
      }
      for (let index = 16; index < 64; index += 1) {
        const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
        const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }
      let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
      let e = hash[4], f = hash[5], g = hash[6], h = hash[7];
      for (let index = 0; index < 64; index += 1) {
        const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + choose + constants[index] + words[index]) >>> 0;
        const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
    }
    const result = new Uint8Array(32);
    const resultView = new DataView(result.buffer);
    for (let index = 0; index < hash.length; index += 1) {
      resultView.setUint32(index * 4, hash[index], false);
    }
    return new SandboxBuffer(result);
  }

  function hmacSha256(key, input) {
    let keyBytes = SandboxBuffer.from(key);
    if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
    const block = SandboxBuffer.alloc(64);
    block.set(keyBytes);
    const outer = SandboxBuffer.alloc(64);
    const inner = SandboxBuffer.alloc(64);
    for (let index = 0; index < 64; index += 1) {
      outer[index] = block[index] ^ 0x5c;
      inner[index] = block[index] ^ 0x36;
    }
    return sha256(SandboxBuffer.concat([outer, sha256(SandboxBuffer.concat([inner, SandboxBuffer.from(input)]))]));
  }

  function createCryptoFacade() {
    function digestResult(bytes, encoding) {
      if (!encoding || encoding === "hex") return bytes.toString("hex");
      if (encoding === "base64") return bytes.toString("base64");
      if (encoding === "buffer" || encoding === null) return bytes;
      throw new Error("Only hex, base64, and buffer crypto encodings are available.");
    }
    return Object.freeze({
      createHash(algorithm) {
        if (!/^sha-?256$/i.test(String(algorithm))) {
          throw new Error("Only SHA-256 is available in synthetic monitor scripts.");
        }
        const chunks = [];
        return {
          update(value) { chunks.push(SandboxBuffer.from(value)); return this; },
          digest(encoding) { return digestResult(sha256(SandboxBuffer.concat(chunks)), encoding); },
        };
      },
      createHmac(algorithm, key) {
        if (!/^sha-?256$/i.test(String(algorithm))) {
          throw new Error("Only HMAC-SHA-256 is available in synthetic monitor scripts.");
        }
        const chunks = [];
        return {
          update(value) { chunks.push(SandboxBuffer.from(value)); return this; },
          digest(encoding) { return digestResult(hmacSha256(key, SandboxBuffer.concat(chunks)), encoding); },
        };
      },
      randomBytes(size) {
        const length = Number(size);
        if (!Number.isSafeInteger(length) || length < 0 || length > 1_000_000) {
          throw new RangeError("randomBytes size is invalid.");
        }
        const result = new SandboxBuffer(length);
        nativeCrypto.getRandomValues(result);
        return result;
      },
      randomInt(minOrMax, maybeMax) {
        const min = maybeMax === undefined ? 0 : Number(minOrMax);
        const max = maybeMax === undefined ? Number(minOrMax) : Number(maybeMax);
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min) {
          throw new RangeError("randomInt range is invalid.");
        }
        const range = max - min;
        if (range > 0xffffffff) throw new RangeError("randomInt range is too large.");
        const limit = Math.floor(0x100000000 / range) * range;
        const value = new Uint32Array(1);
        do { nativeCrypto.getRandomValues(value); } while (value[0] >= limit);
        return min + (value[0] % range);
      },
      randomUUID() { return nativeCrypto.randomUUID(); },
    });
  }

  function hardenAmbientCapabilities() {
    const blocked = [
      "BroadcastChannel", "EventSource", "SharedWorker", "WebSocket", "WebTransport",
      "Worker", "XMLHttpRequest", "fetch", "importScripts",
    ];
    for (const name of blocked) {
      try {
        Object.defineProperty(globalThis, name, {
          value: undefined, writable: false, configurable: false,
        });
      } catch (_) {}
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function utf8Prefix(value, maxBytes) {
    let bytes = 0;
    let end = 0;
    while (end < value.length) {
      const code = value.charCodeAt(end);
      let width = 1;
      let codeUnits = 1;
      if (code < 0x80) width = 1;
      else if (code < 0x800) width = 2;
      else if (code >= 0xd800 && code <= 0xdbff && end + 1 < value.length && value.charCodeAt(end + 1) >= 0xdc00 && value.charCodeAt(end + 1) <= 0xdfff) {
        width = 4;
        codeUnits = 2;
      } else width = 3;
      if (bytes + width > maxBytes) break;
      bytes += width;
      end += codeUnits;
    }
    return { value: value.slice(0, end), bytes, complete: end === value.length };
  }

  function chargeString(state, value, errorMessage) {
    const prefix = jsonStringPrefix(value, state.maxBytes - state.bytes);
    if (!prefix.complete) throw new Error(errorMessage);
    state.bytes += prefix.bytes;
  }

  function jsonStringPrefix(value, maxBytes) {
    let bytes = 0;
    let end = 0;
    while (end < value.length) {
      const code = value.charCodeAt(end);
      let width = 1;
      let codeUnits = 1;
      if (code === 0x22 || code === 0x5c) width = 2;
      else if (code <= 0x1f) width = 6;
      else if (code < 0x80) width = 1;
      else if (code < 0x800) width = 2;
      else if (code >= 0xd800 && code <= 0xdbff && end + 1 < value.length && value.charCodeAt(end + 1) >= 0xdc00 && value.charCodeAt(end + 1) <= 0xdfff) {
        width = 4;
        codeUnits = 2;
      } else width = 3;
      if (bytes + width > maxBytes) break;
      bytes += width;
      end += codeUnits;
    }
    return { value: value.slice(0, end), bytes, complete: end === value.length };
  }

  function safeString(value, maxBytes) {
    if (typeof value === "string") return utf8Prefix(value, maxBytes).value;
    if (value === undefined) return "undefined";
    if (typeof value === "bigint") return utf8Prefix(value.toString(), maxBytes).value;

    const seen = new WeakSet();
    const state = { nodes: 0, bytes: 0, maxBytes };
    function copy(nested, depth) {
      state.nodes += 1;
      if (state.nodes > MAX_LOG_SERIALIZATION_NODES || depth > 10) return "[Truncated]";
      if (nested === null || typeof nested === "boolean" || typeof nested === "number") return nested;
      if (typeof nested === "string") {
        const prefix = utf8Prefix(nested, Math.max(state.maxBytes - state.bytes, 0));
        state.bytes += prefix.bytes;
        return prefix.complete ? prefix.value : prefix.value + "[Truncated]";
      }
      if (typeof nested === "bigint") return nested.toString();
      if (typeof nested === "undefined") return "undefined";
      if (!nested || typeof nested !== "object") return "[Unsupported value]";
      if (seen.has(nested)) return "[Circular]";
      seen.add(nested);
      if (Array.isArray(nested)) {
        const result = [];
        const count = Math.min(nested.length, MAX_LOG_SERIALIZATION_NODES - state.nodes);
        for (let index = 0; index < count; index += 1) result.push(copy(nested[index], depth + 1));
        if (count < nested.length) result.push("[Truncated]");
        return result;
      }
      if (!isPlainObject(nested)) return "[Unsupported value]";
      const result = Object.create(null);
      for (const key in nested) {
        if (!Object.prototype.hasOwnProperty.call(nested, key)) continue;
        if (state.nodes >= MAX_LOG_SERIALIZATION_NODES) {
          result.__truncated__ = true;
          break;
        }
        const safeKey = utf8Prefix(key, 200).value;
        result[safeKey] = copy(nested[key], depth + 1);
      }
      return result;
    }

    try {
      const result = JSON.stringify(copy(value, 0));
      return utf8Prefix(result === undefined ? "undefined" : result, maxBytes).value;
    } catch (_) {
      return "[Unserializable value]";
    }
  }

  function runWithPort(port, payload) {
    const pending = new Map();
    const proxyMetadata = new WeakMap();
    const capabilityCache = new Map();
    let requestSequence = 0;
    let runtimeState = { pages: [] };
    const logMessages = [];
    const capturedMetrics = [];
    const screenshotAssignments = Object.create(null);
    let totalLogBytes = 0;

    port.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.kind !== "rpc-response") return;
      const response = message.response;
      if (!response || response.version !== PROTOCOL_VERSION || typeof response.requestId !== "string") return;
      const waiter = pending.get(response.requestId);
      if (!waiter) return;
      pending.delete(response.requestId);
      if (response.state) applyRuntimeState(response.state);
      if (response.ok) waiter.resolve(decode(response.value));
      else waiter.reject(new Error(typeof response.error === "string" ? response.error : "Sandbox RPC failed."));
    });
    port.start();

    function encode(value, depth, seen, state) {
      if (depth > MAX_SERIALIZATION_DEPTH) throw new Error("Sandbox argument nesting is too deep.");
      state.nodes += 1;
      if (state.nodes > MAX_SERIALIZATION_NODES) throw new Error("Sandbox argument is too complex.");
      if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
        state.bytes += 16;
        if (state.bytes > state.maxBytes) throw new Error("Sandbox argument exceeded the size limit.");
        return value;
      }
      if (typeof value === "string") {
        chargeString(state, value, "Sandbox argument exceeded the size limit.");
        return value;
      }
      if (typeof value === "bigint") {
        const bigintValue = value.toString();
        chargeString(state, bigintValue, "Sandbox argument exceeded the size limit.");
        return { __oneuptimeBigInt: true, value: bigintValue };
      }
      if (typeof value === "function") {
        const source = Function.prototype.toString.call(value);
        chargeString(state, source, "Sandbox argument exceeded the size limit.");
        return { __oneuptimeFunction: true, source };
      }
      if (value instanceof RegExp) {
        chargeString(state, value.source + value.flags, "Sandbox argument exceeded the size limit.");
        return { __oneuptimeRegExp: true, source: value.source, flags: value.flags };
      }
      if (value instanceof Date) {
        const date = value.toISOString();
        chargeString(state, date, "Sandbox argument exceeded the size limit.");
        return date;
      }
      if (value instanceof Uint8Array) {
        const encodedBytes = 4 * Math.ceil(value.byteLength / 3);
        state.bytes += encodedBytes;
        if (state.bytes > state.maxBytes) throw new Error("Sandbox binary argument exceeded the size limit.");
        return { __oneuptimeBinary: true, base64: bytesToBase64(value) };
      }
      const metadata = proxyMetadata.get(value);
      if (metadata) return metadata;
      if (seen.has(value)) throw new Error("Cyclic sandbox arguments are not supported.");
      seen.add(value);
      if (value instanceof Map) {
        if (value.size > 1_000) throw new Error("Sandbox map argument exceeded the entry limit.");
        const entries = [];
        for (const [key, entryValue] of value.entries()) {
          entries.push([
            encode(key, depth + 1, seen, state),
            encode(entryValue, depth + 1, seen, state),
          ]);
        }
        return { __oneuptimeMap: true, entries };
      }
      if (Array.isArray(value)) {
        if (value.length > MAX_SERIALIZATION_NODES - state.nodes) throw new Error("Sandbox argument is too complex.");
        const result = [];
        for (let index = 0; index < value.length; index += 1) result.push(encode(value[index], depth + 1, seen, state));
        return result;
      }
      if (!isPlainObject(value)) throw new Error("Sandbox argument type is not supported.");
      const result = Object.create(null);
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          throw new Error("Sandbox argument contains a forbidden property.");
        }
        chargeString(state, key, "Sandbox argument exceeded the size limit.");
        result[key] = encode(value[key], depth + 1, seen, state);
      }
      return result;
    }

    function encodeBounded(value) {
      return encode(
        value,
        0,
        new WeakSet(),
        { nodes: 0, bytes: 0, maxBytes: MAX_REQUEST_BYTES },
      );
    }

    function decode(value, depth = 0, refreshCapability = true) {
      if (depth > MAX_SERIALIZATION_DEPTH) throw new Error("Sandbox result nesting is too deep.");
      if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (Array.isArray(value)) return value.map((entry) => decode(entry, depth + 1, refreshCapability));
      if (!value || typeof value !== "object") throw new Error("Sandbox result type is invalid.");
      if (value.__oneuptimeCapability === true) return createCapabilityProxy(value, refreshCapability);
      if (value.__oneuptimeScreenshot === true) return createScreenshot(value);
      if (value.__oneuptimeBinary === true) return SandboxBuffer.from(value.base64, "base64");
      if (value.__oneuptimeBigInt === true) return BigInt(value.value);
      if (value.__oneuptimeMap === true) {
        if (!Array.isArray(value.entries) || value.entries.length > 1_000) {
          throw new Error("Sandbox map result is invalid.");
        }
        return new Map(value.entries.map((entry) => {
          if (!Array.isArray(entry) || entry.length !== 2) throw new Error("Sandbox map result is invalid.");
          return [
            decode(entry[0], depth + 1, refreshCapability),
            decode(entry[1], depth + 1, refreshCapability),
          ];
        }));
      }
      if (value.__oneuptimeRegExp === true) return new RegExp(value.source, value.flags);
      const result = Object.create(null);
      for (const [key, entry] of Object.entries(value)) {
        result[key] = decode(entry, depth + 1, refreshCapability);
      }
      return result;
    }

    function isCapabilityDescriptor(value) {
      return Boolean(value) && typeof value === "object" &&
        value.__oneuptimeCapability === true &&
        typeof value.id === "string" && value.id.length > 0 && value.id.length <= 200 &&
        typeof value.type === "string";
    }

    function applyRuntimeState(state) {
      if (!state || typeof state !== "object" || !Array.isArray(state.pages)) return;
      const pages = [];
      const pageIds = new Set();
      for (const descriptor of state.pages.slice(0, MAX_CONTEXT_PAGES)) {
        if (!isCapabilityDescriptor(descriptor) || descriptor.type !== "page" || pageIds.has(descriptor.id)) continue;
        pageIds.add(descriptor.id);
        pages.push(createCapabilityProxy(descriptor));
      }
      if (isCapabilityDescriptor(state.invokedCapability)) {
        createCapabilityProxy(state.invokedCapability);
      }
      runtimeState = { pages };
    }

    function rpc(capability, method, args, locatorChain) {
      const serializationState = { nodes: 0, bytes: 0, maxBytes: MAX_REQUEST_BYTES };
      const requestId = String(++requestSequence);
      const request = {
        version: PROTOCOL_VERSION,
        executionId: payload.executionId,
        requestId,
        capabilityId: capability.id,
        method,
        args: encode(args, 0, new WeakSet(), serializationState),
      };
      if (locatorChain) request.locatorChain = encode(locatorChain, 0, new WeakSet(), serializationState);
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        port.postMessage({ kind: "rpc", request });
      });
    }

    function createScreenshot(descriptor) {
      const screenshot = Object.freeze({
        __oneuptimeScreenshot: true,
        id: descriptor.id,
        byteLength: descriptor.byteLength,
        toString() { return "[SyntheticMonitorScreenshot " + descriptor.byteLength + " bytes]"; },
      });
      proxyMetadata.set(screenshot, descriptor);
      return screenshot;
    }

    const locatorChainMethods = new Set([
      "and", "filter", "first", "frameLocator", "getByAltText", "getByLabel",
      "getByPlaceholder", "getByRole", "getByTestId", "getByText", "getByTitle",
      "last", "locator", "nth", "or",
    ]);
    const blockedProperties = new Set([
      "__proto__", "_browserType", "_channel", "_connection", "browser", "browserType",
      "connect", "connectOverCDP", "constructor", "launch", "launchPersistentContext",
      "launchServer", "newCDPSession", "prototype", "route", "routeFromHAR", "tracing",
    ]);
    /*
     * Event subscriptions cannot cross the isolation boundary. Scripts call
     * these without awaiting, so an RPC rejection would be swallowed as an
     * unhandled rejection and the listener would silently never fire — throw
     * synchronously instead so the script fails with an actionable error.
     */
    const eventEmitterMethods = new Set([
      "addListener", "off", "on", "once", "prependListener",
      "prependOnceListener", "removeAllListeners", "removeListener",
    ]);
    // Synchronous in Playwright, so an async facade would break chained calls.
    const unavailableSyncPageMethods = new Map([
      ["frame", "use page.frameLocator(...) instead"],
      ["frames", "use page.frameLocator(...) instead"],
      ["mainFrame", "call the equivalent method on page directly, or use page.frameLocator(...)"],
      ["video", "recordings are not captured for synthetic monitors"],
      ["workers", "web workers are not observable from synthetic monitors"],
    ]);
    const unavailableSyncFrameMethods = new Map([
      ["childFrames", "use page.frameLocator(...) instead"],
      ["frameElement", "use page.frameLocator(...) instead"],
      ["page", "keep a reference to the page object instead"],
      ["parentFrame", "use page.frameLocator(...) instead"],
    ]);
    function throwUnavailable(api, guidance) {
      throw new Error(
        "Playwright API '" + api + "' is not available in synthetic monitors" +
          (guidance ? "; " + guidance : "") + ".",
      );
    }
    function createUnavailableRequestProxy(ownerType) {
      /*
       * Benign coercions (String(...), JSON.stringify, symbols) must not
       * throw — only actual method calls get the descriptive error.
       */
      return new Proxy(Object.create(null), {
        get(_requestTarget, requestProperty) {
          if (typeof requestProperty !== "string") return undefined;
          if (requestProperty === "then") return undefined;
          if (requestProperty === "toString" || requestProperty === "toJSON") {
            return () => "[" + ownerType + ".request is unavailable in synthetic monitors]";
          }
          return () => {
            throwUnavailable(
              ownerType + ".request." + requestProperty + "()",
              "use the axios global for HTTP requests instead",
            );
          };
        },
        getPrototypeOf() { return null; },
      });
    }

    function createLocatorProxy(rootCapabilityId, chain) {
      const metadata = Object.freeze({ __oneuptimeLocator: true, rootCapabilityId, chain });
      const proxy = new Proxy(Object.create(null), {
        get(_target, property) {
          if (property === "then") return undefined;
          if (property === Symbol.toStringTag) return "Locator";
          if (property === "toString") return () => "Locator@" + chain.map((step) => step.method).join(".");
          if (typeof property !== "string" || blockedProperties.has(property) || property.startsWith("_")) return undefined;
          if (locatorChainMethods.has(property)) {
            return (...args) => createLocatorProxy(rootCapabilityId, [...chain, { method: property, args: encodeBounded(args) }]);
          }
          return (...args) => rpc({ id: rootCapabilityId }, property, args, chain);
        },
        getPrototypeOf() { return null; },
        has(_target, property) { return typeof property === "string" && !blockedProperties.has(property); },
        ownKeys() { return []; },
      });
      proxyMetadata.set(proxy, metadata);
      return proxy;
    }

    function createCapabilityProxy(descriptor, shouldRefresh = true) {
      if (!isCapabilityDescriptor(descriptor)) {
        throw new Error("Sandbox capability descriptor is invalid.");
      }
      const cached = capabilityCache.get(descriptor.id);
      if (cached) {
        if (cached.type !== descriptor.type) {
          throw new Error("Sandbox capability type changed unexpectedly.");
        }
        if (shouldRefresh) refreshCapabilitySnapshot(cached, descriptor);
        return cached.proxy;
      }
      const metadata = Object.freeze({
        __oneuptimeCapability: true,
        id: descriptor.id,
        type: descriptor.type,
      });
      const capabilityState = {
        type: descriptor.type,
        metadata,
        proxy: undefined,
        refreshing: false,
        snapshot: Object.create(null),
      };
      const localLocatorMethods = new Set([
        "frameLocator", "getByAltText", "getByLabel", "getByPlaceholder", "getByRole",
        "getByTestId", "getByText", "getByTitle", "locator",
      ]);
      const snapshotMethods = new Set([
        "allHeaders", "defaultValue", "failure", "headers", "headersArray",
        "isMultiple", "isNavigationRequest", "message", "method", "name", "ok",
        "postData", "postDataJSON", "resourceType", "status", "statusText", "type", "url",
      ]);
      const target = Object.create(null);
      const proxy = new Proxy(target, {
        get(_target, property) {
          if (property === "then") return undefined;
          if (property === Symbol.toStringTag) return capabilityState.type;
          if (property === "toJSON") return () => capabilityState.metadata;
          if (typeof property !== "string" || blockedProperties.has(property) || property.startsWith("_")) return undefined;

          if (eventEmitterMethods.has(property)) {
            return () => {
              throwUnavailable(
                capabilityState.type + "." + property + "()",
                "use page.waitForEvent(...), waitForResponse/waitForRequest with a string or RegExp, or locator-based waits instead",
              );
            };
          }

          if (
            (capabilityState.type === "page" ||
              capabilityState.type === "browser-context") &&
            property === "request"
          ) {
            return createUnavailableRequestProxy(capabilityState.type);
          }
          if (
            capabilityState.type === "frame" &&
            unavailableSyncFrameMethods.has(property)
          ) {
            return () => {
              throwUnavailable("frame." + property + "()", unavailableSyncFrameMethods.get(property));
            };
          }

          const snapshot = capabilityState.snapshot;
          if (capabilityState.type === "page") {
            if (unavailableSyncPageMethods.has(property)) {
              return () => {
                throwUnavailable("page." + property + "()", unavailableSyncPageMethods.get(property));
              };
            }
            if (property === "context") return () => snapshot.context;
            if (property === "keyboard" || property === "mouse" || property === "touchscreen") return snapshot[property];
            if (property === "isClosed") return () => Boolean(snapshot.isClosed);
            if (property === "url") return () => String(snapshot.url || "");
            if (property === "viewportSize") return () => snapshot.viewportSize || null;
            if (localLocatorMethods.has(property)) {
              return (...args) => createLocatorProxy(capabilityState.metadata.id, [{ method: property, args: encodeBounded(args) }]);
            }
          }
          if (capabilityState.type === "browser-context") {
            if (property === "pages") return () => (runtimeState.pages || snapshot.pages || []).slice();
            if (property === "browser") return () => undefined;
          }
          if (capabilityState.type === "locator" && locatorChainMethods.has(property)) {
            return (...args) => createLocatorProxy(capabilityState.metadata.id, [{ method: property, args: encodeBounded(args) }]);
          }
          if (snapshotMethods.has(property) && Object.prototype.hasOwnProperty.call(snapshot, property)) {
            return () => snapshot[property];
          }
          if (capabilityState.type === "response" && property === "request" && snapshot.request) return () => snapshot.request;
          if (capabilityState.type === "file-chooser" && property === "page" && snapshot.page) return () => snapshot.page;
          return (...args) => rpc(capabilityState.metadata, property, args);
        },
        getPrototypeOf() { return null; },
        has(_target, property) { return typeof property === "string" && !blockedProperties.has(property); },
        ownKeys() { return Object.keys(capabilityState.snapshot); },
        getOwnPropertyDescriptor(_target, property) {
          if (typeof property !== "string" || blockedProperties.has(property)) return undefined;
          return { configurable: true, enumerable: true, writable: false, value: this.get(_target, property) };
        },
      });
      capabilityState.proxy = proxy;
      capabilityCache.set(descriptor.id, capabilityState);
      proxyMetadata.set(proxy, metadata);
      refreshCapabilitySnapshot(capabilityState, descriptor);
      return proxy;
    }

    function refreshCapabilitySnapshot(capabilityState, descriptor) {
      if (!Object.prototype.hasOwnProperty.call(descriptor, "snapshot") || capabilityState.refreshing) return;
      capabilityState.refreshing = true;
      try {
        capabilityState.snapshot = decode(descriptor.snapshot || {}, 0, false);
      } finally {
        capabilityState.refreshing = false;
      }
    }

    function makeAxios(defaults) {
      function assertNoFunctions(value, path, seen = new WeakSet()) {
        if (!value || typeof value !== "object") return;
        if (seen.has(value)) throw new Error("Cyclic axios values are not supported.");
        seen.add(value);
        for (const [key, nested] of Object.entries(value)) {
          if (typeof nested === "function") throw new Error("Functions are not supported in axios values at " + path + "." + key + ".");
          assertNoFunctions(nested, path + "." + key, seen);
        }
      }
      function merge(config) {
        const result = Object.assign({}, defaults || {}, config || {});
        if (defaults && defaults.headers && config && config.headers) {
          result.headers = Object.assign({}, defaults.headers, config.headers);
        }
        return result;
      }
      async function request(config) {
        const finalConfig = merge(config);
        assertNoFunctions(finalConfig, "config");
        const method = String(finalConfig.method || "get").toLowerCase();
        const url = String(finalConfig.url || "");
        const response = await rpc(payload.capabilities.runtime, "axiosRequest", [{
          method, url, data: finalConfig.data, config: finalConfig,
        }]);
        if (response && response.__oneuptimeAxiosError) {
          const error = new Error(response.message || "Request failed");
          error.isAxiosError = true;
          error.response = {
            data: response.data, headers: response.headers, status: response.status, statusText: response.statusText,
          };
          throw error;
        }
        return response;
      }
      const instance = function axios(urlOrConfig, config) {
        if (typeof urlOrConfig === "string") return request(Object.assign({}, config || {}, { url: urlOrConfig }));
        return request(urlOrConfig || {});
      };
      instance.request = request;
      for (const method of ["get", "delete", "head", "options"]) {
        instance[method] = (url, config) => request(Object.assign({}, config || {}, { method, url }));
      }
      for (const method of ["post", "put", "patch"]) {
        instance[method] = (url, data, config) => request(Object.assign({}, config || {}, { method, url, data }));
      }
      instance.create = (config) => makeAxios(merge(config));
      instance.isAxiosError = (error) => Boolean(error && error.isAxiosError);
      instance.defaults = Object.freeze(Object.assign({}, defaults || {}));
      return Object.freeze(instance);
    }

    function createHttpModule(axios, protocol) {
      class EventEmitter {
        constructor() { this.listeners = Object.create(null); }
        on(event, listener) { (this.listeners[event] ||= []).push(listener); return this; }
        once(event, listener) {
          const wrapper = (...args) => { this.removeListener(event, wrapper); listener(...args); };
          return this.on(event, wrapper);
        }
        removeListener(event, listener) {
          this.listeners[event] = (this.listeners[event] || []).filter((entry) => entry !== listener);
          return this;
        }
        emit(event, ...args) {
          for (const listener of [...(this.listeners[event] || [])]) listener(...args);
          return this;
        }
      }
      class Agent { constructor(options) { this.options = options || {}; this.__agentType = protocol + "_agent"; } destroy() {} }
      function normalize(input, options) {
        if (typeof input === "string" || input instanceof URL) return { url: String(input), options: options || {} };
        const config = Object.assign({}, input || {}, options || {});
        const hostname = config.hostname || config.host || "localhost";
        const port = config.port ? ":" + config.port : "";
        const path = config.path || "/";
        return { url: protocol + "://" + hostname + port + path, options: config };
      }
      function request(input, options, callback) {
        if (typeof options === "function") { callback = options; options = undefined; }
        const normalized = normalize(input, options);
        const requestEmitter = new EventEmitter();
        const chunks = [];
        let ended = false;
        let aborted = false;
        requestEmitter.write = (chunk) => { if (ended) throw new Error("write after end"); chunks.push(SandboxBuffer.from(chunk)); return true; };
        requestEmitter.abort = () => { aborted = true; requestEmitter.emit("abort"); };
        requestEmitter.destroy = (error) => { aborted = true; if (error) requestEmitter.emit("error", error); };
        requestEmitter.setHeader = (name, value) => { (normalized.options.headers ||= {})[name] = value; };
        requestEmitter.getHeader = (name) => (normalized.options.headers || {})[name];
        requestEmitter.end = (chunk) => {
          if (chunk !== undefined) requestEmitter.write(chunk);
          if (ended) return requestEmitter;
          ended = true;
          nativeQueueMicrotask(async () => {
            if (aborted) return;
            try {
              const response = await axios.request({
                method: normalized.options.method || "get",
                url: normalized.url,
                headers: normalized.options.headers,
                data: chunks.length ? SandboxBuffer.concat(chunks).toString() : undefined,
                timeout: normalized.options.timeout,
              });
              const incoming = new EventEmitter();
              incoming.statusCode = response.status;
              incoming.statusMessage = response.statusText;
              incoming.headers = response.headers;
              incoming.complete = false;
              if (typeof callback === "function") callback(incoming);
              nativeQueueMicrotask(() => {
                const data = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
                if (data) incoming.emit("data", SandboxBuffer.from(data));
                incoming.complete = true;
                incoming.emit("end");
              });
              requestEmitter.emit("response", incoming);
            } catch (error) { requestEmitter.emit("error", error); }
          });
          return requestEmitter;
        };
        return requestEmitter;
      }
      function get(input, options, callback) { const result = request(input, options, callback); result.end(); return result; }
      return Object.freeze({ Agent, get, request, globalAgent: Object.freeze(new Agent()) });
    }

    function sanitizeReturn(value, depth = 0, seen = new WeakSet(), state = { nodes: 0, bytes: 0, maxBytes: MAX_RESULT_BYTES }) {
      if (depth > MAX_SERIALIZATION_DEPTH) throw new Error("Return value nesting is too deep.");
      state.nodes += 1;
      if (state.nodes > MAX_SERIALIZATION_NODES) throw new Error("Return value is too complex.");
      if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
        state.bytes += 16;
        if (state.bytes > state.maxBytes) throw new Error("Synthetic monitor result exceeded the size limit.");
        return value;
      }
      if (typeof value === "string") {
        chargeString(state, value, "Synthetic monitor result exceeded the size limit.");
        return value;
      }
      if (typeof value === "bigint") {
        const bigintValue = value.toString();
        chargeString(state, bigintValue, "Synthetic monitor result exceeded the size limit.");
        return bigintValue;
      }
      const metadata = value && typeof value === "object" ? proxyMetadata.get(value) : undefined;
      if (metadata && metadata.__oneuptimeScreenshot === true) return metadata;
      if (value instanceof Uint8Array) {
        state.bytes += 4 * Math.ceil(value.byteLength / 3);
        if (state.bytes > state.maxBytes) throw new Error("Synthetic monitor result exceeded the size limit.");
        return { __oneuptimeBinary: true, base64: bytesToBase64(value) };
      }
      if (value instanceof Date) {
        const date = value.toISOString();
        chargeString(state, date, "Synthetic monitor result exceeded the size limit.");
        return date;
      }
      if (seen.has(value)) throw new Error("Cyclic return values are not supported.");
      seen.add(value);
      if (Array.isArray(value)) {
        if (value.length > MAX_SERIALIZATION_NODES - state.nodes) throw new Error("Return value is too complex.");
        const result = [];
        for (let index = 0; index < value.length; index += 1) result.push(sanitizeReturn(value[index], depth + 1, seen, state));
        return result;
      }
      if (!isPlainObject(value)) return undefined;
      const result = Object.create(null);
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        chargeString(state, key, "Synthetic monitor result exceeded the size limit.");
        result[key] = sanitizeReturn(value[key], depth + 1, seen, state);
      }
      return result;
    }

    function captureLog(args) {
      if (logMessages.length >= MAX_LOG_MESSAGES) return;
      const remaining = Math.min(MAX_LOG_BYTES - totalLogBytes, MAX_LOG_MESSAGE_BYTES);
      if (remaining <= 0) return;
      let message = "";
      let encodedMessageBytes = 0;
      for (let index = 0; index < Math.min(args.length, MAX_LOG_SERIALIZATION_NODES); index += 1) {
        const separator = index === 0 ? "" : " ";
        const separatorBytes = separator.length;
        const available = Math.max(remaining - encodedMessageBytes - separatorBytes, 0);
        if (available <= 0) break;
        const part = jsonStringPrefix(safeString(args[index], available), available);
        message += separator + part.value;
        encodedMessageBytes += separatorBytes + part.bytes;
        if (!part.complete) break;
      }
      if (encodedMessageBytes === 0 && message.length === 0) return;
      totalLogBytes += encodedMessageBytes;
      logMessages.push(message);
      void rpc(payload.capabilities.runtime, "log", [message]).catch(() => {});
    }

    const sandboxConsole = Object.freeze({
      log: (...args) => captureLog(args), info: (...args) => captureLog(args),
      warn: (...args) => captureLog(args), error: (...args) => captureLog(args),
    });
    const oneuptime = Object.freeze({
      captureMetric(name, value, attributes) {
        if (capturedMetrics.length >= MAX_METRICS || typeof name !== "string" || !name || typeof value !== "number" || !Number.isFinite(value)) return;
        const metric = { name: name.slice(0, 200), value };
        if (attributes && typeof attributes === "object") {
          const safe = Object.create(null);
          let attributeCount = 0;
          for (const key in attributes) {
            if (!Object.prototype.hasOwnProperty.call(attributes, key)) continue;
            if (attributeCount >= 50) break;
            const attribute = attributes[key];
            if (["string", "number", "boolean"].includes(typeof attribute)) safe[key.slice(0, 200)] = String(attribute).slice(0, 1000);
            attributeCount += 1;
          }
          if (Object.keys(safe).length) metric.attributes = safe;
        }
        capturedMetrics.push(metric);
        void rpc(payload.capabilities.runtime, "captureMetric", [metric]).catch(() => {});
      },
    });
    const screenshots = new Proxy(Object.create(null), {
      set(_target, property, value) {
        if (typeof property !== "string") return false;
        const metadata = value && typeof value === "object" ? proxyMetadata.get(value) : undefined;
        if (metadata && metadata.__oneuptimeScreenshot === true) {
          const name = property.slice(0, 200);
          screenshotAssignments[name] = metadata;
          void rpc(payload.capabilities.runtime, "assignScreenshot", [name, metadata]).catch(() => {});
        }
        return true;
      },
      get(_target, property) { return typeof property === "string" ? screenshotAssignments[property] : undefined; },
      ownKeys() { return Object.keys(screenshotAssignments); },
      getOwnPropertyDescriptor() { return { configurable: true, enumerable: true }; },
    });

    const page = createCapabilityProxy(payload.capabilities.page);
    const bootstrapPages = payload.capabilities.browserContext &&
      payload.capabilities.browserContext.snapshot &&
      Array.isArray(payload.capabilities.browserContext.snapshot.pages)
      ? payload.capabilities.browserContext.snapshot.pages
      : [payload.capabilities.page];
    applyRuntimeState({
      pages: bootstrapPages,
      invokedCapability: payload.capabilities.page,
    });
    const axios = makeAxios(null);
    const http = createHttpModule(axios, "http");
    const https = createHttpModule(axios, "https");
    const cryptoFacade = createCryptoFacade();

    hardenAmbientCapabilities();

    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    const parameterNames = [
      "page", "axios", "http", "https", "crypto", "console", "oneuptime",
      "screenshots", "browserType", "screenSizeType", "args", "Buffer",
      "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    ];
    const parameterValues = [
      page, axios, http, https, cryptoFacade, sandboxConsole, oneuptime,
      screenshots, payload.browserType, payload.screenSizeType, decode(payload.args || {}), SandboxBuffer,
      nativeSetTimeout, nativeClearTimeout, nativeSetInterval, nativeClearInterval,
    ];

    (async () => {
      await rpc(payload.capabilities.runtime, "ready", []);
      let returnValue;
      let scriptError;
      try {
        const userFunction = new AsyncFunction(
          ...parameterNames,
          "\"use strict\";\nreturn await (async function () {\n\"use strict\";\n" +
            payload.code +
            "\n}).call(undefined);",
        );
        returnValue = await userFunction(...parameterValues);
      } catch (error) {
        scriptError = error && error.message ? String(error.message) : String(error);
      }

      let safeReturnValue;
      if (!scriptError) {
        try { safeReturnValue = sanitizeReturn(returnValue); }
        catch (error) { scriptError = error && error.message ? String(error.message) : String(error); }
      }

      const result = {
        returnValue: safeReturnValue,
        logMessages,
        capturedMetrics,
        screenshotAssignments,
        scriptError: scriptError ? scriptError.slice(0, 4000) : undefined,
      };
      const serializedResult = JSON.stringify(result);
      const serializedResultPrefix = utf8Prefix(serializedResult, MAX_RESULT_BYTES);
      const resultBytes = serializedResultPrefix.complete
        ? serializedResultPrefix.bytes
        : MAX_RESULT_BYTES + 1;
      if (resultBytes > MAX_RESULT_BYTES) {
        result.returnValue = undefined;
        result.scriptError = "Synthetic monitor result exceeded the size limit.";
      }
      port.postMessage({ kind: "complete", result });
    })().catch((error) => {
      port.postMessage({
        kind: "complete",
        result: {
          logMessages,
          capturedMetrics,
          screenshotAssignments,
          scriptError: (error && error.message ? String(error.message) : String(error)).slice(0, 4000),
        },
      });
    });
  }

  globalThis.addEventListener("message", function initialize(event) {
    const message = event.data;
    const port = event.ports && event.ports[0];
    if (!message || message.kind !== "initialize" || !port || !message.payload) return;
    if (message.payload.version !== PROTOCOL_VERSION) {
      port.postMessage({ kind: "complete", result: { logMessages: [], capturedMetrics: [], screenshotAssignments: {}, scriptError: "Unsupported synthetic runtime protocol version." } });
      return;
    }
    runWithPort(port, message.payload);
  }, { once: true });
})();`;
}
