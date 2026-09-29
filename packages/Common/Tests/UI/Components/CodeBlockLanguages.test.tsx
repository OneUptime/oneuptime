/*
 * CodeBlock language contract.
 *
 * CodeBlock renders through a trimmed highlight.js (lib/core + explicitly
 * registered grammars in CodeBlock/LanguageRegistry.ts) instead of
 * react-highlight, which eagerly imported all 194 grammars (~1.5MB). These
 * tests pin the contract that trim relies on:
 *
 *   1. a registered language still produces real hljs token markup inside
 *      the same <pre><code> shape react-highlight rendered;
 *   2. an unknown language degrades to plain escaped text — no crash and no
 *      hljs "Could not find the language" console noise;
 *   3. every language a CodeBlock call site actually passes (the audit that
 *      justified the trim) stays registered — removing a grammar from the
 *      registry breaks this suite, not a docs page at runtime.
 */
import CodeBlock from "../../../UI/Components/CodeBlock/CodeBlock";
import { resolveRegisteredLanguage } from "../../../UI/Components/CodeBlock/LanguageRegistry";
import "@testing-library/jest-dom";
import { render, RenderResult } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Every `language` value passed to CodeBlock by a call site at the time of
 * the react-highlight removal (grep of <CodeBlock usages in Dashboard +
 * Detail.tsx), plus the deliberately-registered cheap companions. If a new
 * call site introduces a language, add it here AND register its grammar in
 * LanguageRegistry.ts.
 */
const AUDITED_CALL_SITE_LANGUAGES: Array<string> = [
  // docs pages, Runner install, MCP pages, Telemetry snippets
  "bash",
  // MCP pages, AI agent task logs, subscriber templates (SMS)
  "text",
  // Detail.tsx FieldType.Code
  "plaintext",
  // MCP pages, logs, Detail.tsx JSON fields, webhook templates
  "json",
  // Detail.tsx HTML fields, email templates
  "html",
  // Detail.tsx CSS fields
  "css",
  // Detail.tsx FieldType.JavaScript, Telemetry snippets
  "javascript",
  // Slack / Microsoft Teams subscriber templates
  "markdown",
  // Telemetry Documentation per-language OTel snippets
  "typescript",
  "python",
  "go",
  "csharp",
  "rust",
  "php",
  "ruby",
  "elixir",
  "cpp",
  "swift",
];

// Registered as cheap future-proofing alongside the audited set.
const COMPANION_LANGUAGES: Array<string> = [
  "shell",
  "yaml",
  "sql",
  "dockerfile",
];

// Built-in hljs aliases callers could plausibly reach for next.
const EXPECTED_ALIASES: Array<string> = ["js", "ts", "sh", "yml", "md", "py"];

/*
 * jest.spyOn return types from @jest/globals vs @types/jest disagree in this
 * repo, so annotate with just the surface these tests read.
 */
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

describe("CodeBlock language registry contract", () => {
  let warnSpy: SpyLike;
  let errorSpy: SpyLike;
  let logSpy: SpyLike;

  beforeEach(() => {
    /*
     * highlight.js reports unknown languages via console.warn (and older
     * paths via console.log/error). Silence them so assertions below can
     * prove they never fire, without polluting test output if they do.
     */
    warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {}) as unknown as SpyLike;
    errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {}) as unknown as SpyLike;
    logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {}) as unknown as SpyLike;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  const getCodeElement: (container: HTMLElement) => HTMLElement = (
    container: HTMLElement,
  ): HTMLElement => {
    const code: HTMLElement | null = container.querySelector("pre code");
    expect(code).not.toBeNull();
    return code as HTMLElement;
  };

  test("renders a registered language with hljs token markup in the pre > code shape", () => {
    const jsonCode: string = '{ "status": "ok", "count": 2 }';
    const { container }: RenderResult = render(
      <CodeBlock code={jsonCode} language="json" />,
    );

    const code: HTMLElement = getCodeElement(container);

    /*
     * Same classes react-highlight produced: caller utilities + language-*
     * marker + the theme-carrying hljs class.
     */
    expect(code).toHaveClass("hljs");
    expect(code).toHaveClass("language-json");
    expect(code).toHaveClass("p-4");

    // Real token markup, not just escaped text.
    const tokenSpans: NodeListOf<Element> =
      code.querySelectorAll('[class*="hljs-"]');
    expect(tokenSpans.length).toBeGreaterThan(0);

    // Highlighting must not alter the visible source.
    expect(code.textContent).toBe(jsonCode);
  });

  test("escapes HTML-looking source when highlighting (no element injection)", () => {
    const htmlCode: string = '<script>alert("xss")</script>';
    const { container }: RenderResult = render(
      <CodeBlock code={htmlCode} language="html" />,
    );

    const code: HTMLElement = getCodeElement(container);

    // The source must appear as text, never as a live element.
    expect(code.querySelector("script")).toBeNull();
    expect(code.textContent).toBe(htmlCode);
  });

  test("unknown language falls back to plain escaped text without crashing or warning", () => {
    const snippet: string = "some <plain> text & symbols";
    const { container }: RenderResult = render(
      <CodeBlock code={snippet} language="definitely-not-a-language" />,
    );

    const code: HTMLElement = getCodeElement(container);

    // Plain fallback: content intact, no token markup, no injected elements.
    expect(code.textContent).toBe(snippet);
    expect(code.querySelectorAll('[class*="hljs-"]').length).toBe(0);
    // The theme class stays so the block still paints the dark background.
    expect(code).toHaveClass("hljs");

    // hljs was never invoked with the unknown name, so no console noise.
    expect(warnSpy.mock.calls.length).toBe(0);
    expect(errorSpy.mock.calls.length).toBe(0);
    expect(logSpy.mock.calls.length).toBe(0);
  });

  test("resolveRegisteredLanguage returns null for unknown or blank languages", () => {
    expect(resolveRegisteredLanguage("definitely-not-a-language")).toBeNull();
    expect(resolveRegisteredLanguage("")).toBeNull();
    expect(resolveRegisteredLanguage("   ")).toBeNull();
  });

  test("every audited call-site language is registered and renders", () => {
    const allLanguages: Array<string> = [
      ...AUDITED_CALL_SITE_LANGUAGES,
      ...COMPANION_LANGUAGES,
    ];

    for (const language of allLanguages) {
      // Registry-level guarantee: hljs can resolve the name (or its alias).
      expect(resolveRegisteredLanguage(language)).not.toBeNull();

      // Render-level guarantee: the block renders the source intact.
      const snippet: string = `sample code for ${language}`;
      const rendered: RenderResult = render(
        <CodeBlock code={snippet} language={language} />,
      );
      const code: HTMLElement = getCodeElement(rendered.container);
      expect(code).toHaveClass("hljs");
      expect(code).toHaveClass(`language-${language}`);
      expect(code.textContent).toBe(snippet);
      rendered.unmount();
    }

    expect(warnSpy.mock.calls.length).toBe(0);
    expect(errorSpy.mock.calls.length).toBe(0);
  });

  test("built-in hljs aliases resolve through the registered grammars", () => {
    for (const alias of EXPECTED_ALIASES) {
      expect(resolveRegisteredLanguage(alias)).not.toBeNull();
    }
  });

  test("language lookup is case- and whitespace-insensitive", () => {
    expect(resolveRegisteredLanguage(" JSON ")).toBe("json");
    expect(resolveRegisteredLanguage("Bash")).toBe("bash");
  });

  test("a ReactElement code child renders plain without crashing", () => {
    const child: ReactElement = <span data-testid="element-code">inline</span>;
    const { container, getByTestId }: RenderResult = render(
      <CodeBlock code={child} language="json" />,
    );

    const code: HTMLElement = getCodeElement(container);
    expect(getByTestId("element-code")).toBeInTheDocument();
    // No highlight pass ran over the element child.
    expect(code.querySelectorAll('[class*="hljs-"]').length).toBe(0);
  });
});
