import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { jest } from "@jest/globals";
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

/*
 * Testing Library waits a default of one second for findBy/waitFor. That is a
 * generous budget for a state update and a hopeless one for a React.lazy
 * boundary: the first component to render LazyMarkdownViewer has to resolve
 * the dynamic import and put MarkdownViewer (plus its mermaid mock) through
 * ts-jest before any assertion on the markdown text can pass. Locally that is
 * ~400 ms; on a CI runner with the other shard workers competing for the same
 * cores it goes past a second, and the test fails having rendered the Suspense
 * fallback -- a timeout wearing the costume of a missing element.
 *
 * ~20 components reach the viewer through that wrapper (FeedItem, EventItem,
 * Detail, BaseModelTable and the rest), so this is a whole class of flake
 * rather than one test, and it belongs here rather than at one call site.
 * Five seconds is still short enough that a genuinely broken assertion fails
 * promptly instead of sitting out the 60 s testTimeout.
 */
configure({ asyncUtilTimeout: 5000 });
