import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "util";
import { webcrypto, randomUUID } from "crypto";

// Polyfill TextEncoder/TextDecoder for jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).TextEncoder = TextEncoder;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).TextDecoder = TextDecoder;

/*
 * jsdom does not expose crypto.randomUUID, so back it with Node's webcrypto
 * (UUID.ts calls globalThis.crypto.randomUUID() to stay browser-bundle-safe).
 */
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
if (typeof globalThis.crypto.randomUUID !== "function") {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: randomUUID,
    configurable: true,
  });
}

// Mock window.scrollTo for jsdom
Object.defineProperty(window, "scrollTo", {
  value: jest.fn(),
  writable: true,
});
