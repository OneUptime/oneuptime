import { describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";

/*
 * Proves ee/jest.config.js's "ui" project: jsdom, Common's setup file, and
 * Common's derived module mappers all apply to ee UI tests.
 */
describe("the ee ui jest project", () => {
  test("runs in jsdom", () => {
    const element: HTMLDivElement = document.createElement("div");
    element.textContent = "enterprise";
    document.body.appendChild(element);

    expect(document.body.textContent).toContain("enterprise");
    expect(typeof window).toBe("object");
  });

  test("ran Common's jest.setup.ts (crypto polyfill and the scrollTo mock)", () => {
    expect(typeof globalThis.crypto.randomUUID).toBe("function");
    expect(jest.isMockFunction(window.scrollTo)).toBe(true);
  });

  test("resolves Common/ imports through the derived mappers", () => {
    expect(ObjectID.generate().toString()).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("resolves react to Common's pinned copy", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const react: { createElement: unknown } = require("react");

    expect(typeof react.createElement).toBe("function");
  });
});
