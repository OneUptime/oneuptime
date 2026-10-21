import type {} from "highlight.js";
import hljs from "highlight.js/lib/core";
import {
  MAX_HIGHLIGHT_LENGTH,
  escapeHtml,
  highlightCode,
} from "../../../../UI/Components/CodeEditor/CodeEditorHighlight";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * The highlighted copy sits under a transparent textarea holding the same
 * text, so it must hold exactly the same characters in the same order - a
 * character more or less and every glyph after it is drawn in the wrong
 * place - and nothing in it may become markup of its own: it is set as
 * innerHTML.
 */

const GRAMMARS: Array<string | null> = [
  "bash",
  "css",
  "javascript",
  "json",
  "markdown",
  "sql",
  "xml",
  "yaml",
  null,
  "no-such-grammar",
];

const EMOJI: string = String.fromCodePoint(0x1f600);

const TRICKY_INPUTS: Array<string> = [
  "",
  "<script>alert(1)</script>",
  "&amp; &lt; &gt; &#x27; &quot;",
  "a & b < c > d \" e ' f",
  '<img src=x onerror="alert(1)">',
  "tab\there\t\tand\ttabs",
  "unicode: é ✓ 漢字 " + EMOJI + " ü",
  '{\n  "a": "</div>",\n  "b": [1, 2, {"c": null}]\n}',
  "key: value\nlist:\n  - <b>item</b>\n  - &anchor x\n",
  "SELECT * FROM t WHERE a < 1 AND b > 2; -- <c>",
  'echo "$HOME" && cat <<EOF\n<html>\nEOF',
  "# Heading\n*em* **strong** `code` [link](http://x.y/<z>)",
  ".a > .b::after { content: '<>'; }",
  "const x = `${a < b}`; // <!-- -->",
  "   \n\n  trailing spaces   \n",
];

type TextOfFunction = (html: string) => string;

// What a browser would show for this HTML: its text content.
const textOf: TextOfFunction = (html: string): string => {
  const container: HTMLDivElement = document.createElement("div");
  container.innerHTML = html;
  return container.textContent || "";
};

type ElementsOfFunction = (html: string) => Array<Element>;

const elementsOf: ElementsOfFunction = (html: string): Array<Element> => {
  const container: HTMLDivElement = document.createElement("div");
  container.innerHTML = html;
  return Array.from(container.querySelectorAll("*"));
};

describe("highlightCode — the copy holds exactly the source text", () => {
  for (const grammar of GRAMMARS) {
    test.each(TRICKY_INPUTS)(
      `grammar ${String(grammar)}: %j`,
      (input: string) => {
        expect(textOf(highlightCode(input, grammar))).toBe(input);
        expect(textOf(highlightCode(input, grammar, { showTabs: true }))).toBe(
          input,
        );
      },
    );
  }
});

/*
 * A token is `hljs-<scope>`; a stretch in an embedded language (HTML inside
 * JavaScript or Markdown) is wrapped in a span named after that grammar.
 */
const ALLOWED_CLASS: RegExp =
  /^(?:hljs-[a-z_-]+|ou-code-editor__tab|bash|css|javascript|json|markdown|sql|xml|yaml)$/;

describe("highlightCode — nothing in the source becomes markup", () => {
  for (const grammar of GRAMMARS) {
    test(`grammar ${String(grammar)}: only token spans come out`, () => {
      for (const input of TRICKY_INPUTS) {
        for (const element of elementsOf(
          highlightCode(input, grammar, { showTabs: true }),
        )) {
          expect(element.tagName).toBe("SPAN");
          expect(element.className).toMatch(ALLOWED_CLASS);
          expect(element.getAttributeNames()).toEqual(["class"]);
        }
      }
    });
  }

  test("an injected image never becomes an element", () => {
    for (const grammar of GRAMMARS) {
      const html: string = highlightCode(
        '<img src=x onerror="alert(1)">',
        grammar,
      );
      const parsed: Document = new DOMParser().parseFromString(
        `<div>${html}</div>`,
        "text/html",
      );

      expect(parsed.querySelector("img")).toBeNull();
      expect(parsed.querySelector("[onerror]")).toBeNull();
    }
  });

  test("no raw angle bracket from the source survives", () => {
    for (const grammar of GRAMMARS) {
      const html: string = highlightCode("<script>alert(1)</script>", grammar);
      const withoutTokenSpans: string = html
        .replace(/<span class="[a-z_ -]+">/g, "")
        .replace(/<\/span>/g, "");

      expect(withoutTokenSpans).not.toContain("<");
      expect(withoutTokenSpans).not.toContain(">");
    }
  });
});

describe("highlightCode — tokens are marked with highlight.js classes", () => {
  test("JSON keys, strings, numbers and literals", () => {
    const html: string = highlightCode(
      '{"a": "b", "n": 1, "t": true, "z": null}',
      "json",
    );

    expect(html).toContain('<span class="hljs-attr">&quot;a&quot;</span>');
    expect(html).toContain('<span class="hljs-string">&quot;b&quot;</span>');
    expect(html).toContain('<span class="hljs-number">1</span>');
    expect(html).toContain('<span class="hljs-literal">true</span>');
    expect(html).toContain('<span class="hljs-literal">null</span>');
  });

  test("YAML keys and list bullets", () => {
    const html: string = highlightCode("key: value\nlist:\n  - item\n", "yaml");

    expect(html).toContain('<span class="hljs-attr">key:</span>');
    expect(html).toContain('<span class="hljs-attr">list:</span>');
    expect(html).toContain('<span class="hljs-bullet">-</span>');
  });

  test("JavaScript keywords and comments", () => {
    const html: string = highlightCode(
      "const x = await f(); // done",
      "javascript",
    );

    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain('<span class="hljs-keyword">await</span>');
    expect(html).toContain('<span class="hljs-comment">// done</span>');
  });

  test("SQL keywords and strings", () => {
    const html: string = highlightCode("SELECT * FROM t WHERE a = 'x';", "sql");

    expect(html).toContain('<span class="hljs-keyword">SELECT</span>');
    expect(html).toContain('<span class="hljs-keyword">FROM</span>');
    expect(html).toContain('<span class="hljs-string">&#x27;x&#x27;</span>');
  });

  test("Bash built-ins, keywords and variables", () => {
    const html: string = highlightCode(
      'echo "hi $HOME"; if true; then ls; fi',
      "bash",
    );

    expect(html).toContain('<span class="hljs-built_in">echo</span>');
    expect(html).toContain('<span class="hljs-keyword">if</span>');
    expect(html).toContain('<span class="hljs-variable">$HOME</span>');
  });

  test("HTML tags, through the xml grammar", () => {
    const html: string = highlightCode('<div class="a">x</div>', "xml");

    expect(html).toContain('<span class="hljs-name">div</span>');
    expect(html).toContain('<span class="hljs-attr">class</span>');
  });

  test("CSS selectors and properties", () => {
    const html: string = highlightCode(".a { color: red; }", "css");

    expect(html).toContain('<span class="hljs-selector-class">.a</span>');
    expect(html).toContain('<span class="hljs-attribute">color</span>');
  });

  test("Markdown headings", () => {
    expect(highlightCode("# Title", "markdown")).toContain(
      '<span class="hljs-section"># Title</span>',
    );
  });
});

describe("highlightCode — falls back to escaped plain text", () => {
  const SOURCE: string = '{"a": "<b>&</b>"}';

  test("without a grammar", () => {
    expect(highlightCode(SOURCE, null)).toBe(escapeHtml(SOURCE));
  });

  test("with a grammar highlight.js does not know", () => {
    expect(highlightCode(SOURCE, "cobol")).toBe(escapeHtml(SOURCE));
  });

  test("for a document over the length limit", () => {
    const long: string = "[" + "1,".repeat(MAX_HIGHLIGHT_LENGTH / 2) + "1]";

    expect(long.length).toBeGreaterThan(MAX_HIGHLIGHT_LENGTH);
    expect(highlightCode(long, "json")).toBe(escapeHtml(long));
    expect(highlightCode(long, "json")).not.toContain("<span");
  });

  test("a document exactly at the limit is still highlighted", () => {
    const text: string = '"' + "a".repeat(MAX_HIGHLIGHT_LENGTH - 2) + '"';

    expect(text.length).toBe(MAX_HIGHLIGHT_LENGTH);
    expect(highlightCode(text, "json")).toContain('<span class="hljs-string">');
  });

  test("when highlight.js throws", () => {
    jest.spyOn(hljs, "highlight").mockImplementation(() => {
      throw new Error("grammar crashed");
    });

    try {
      expect(highlightCode(SOURCE, "json")).toBe(escapeHtml(SOURCE));
    } finally {
      jest.restoreAllMocks();
    }
  });

  test("escapeHtml escapes exactly &, < and >", () => {
    expect(escapeHtml("a & b < c > d \" e ' f")).toBe(
      "a &amp; b &lt; c &gt; d \" e ' f",
    );
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("highlightCode — showTabs", () => {
  const TAB_SPAN: string = '<span class="ou-code-editor__tab">\t</span>';

  test("wraps every tab, and changes nothing else", () => {
    const plain: string = highlightCode("a\tb\t\tc", null);
    const shown: string = highlightCode("a\tb\t\tc", null, { showTabs: true });

    expect(shown).toBe(`a${TAB_SPAN}b${TAB_SPAN}${TAB_SPAN}c`);
    expect(shown.split(TAB_SPAN).join("\t")).toBe(plain);
  });

  test("wraps tabs inside highlighted YAML too", () => {
    const source: string = "key:\n\tchild: 1\n";
    const plain: string = highlightCode(source, "yaml");
    const shown: string = highlightCode(source, "yaml", { showTabs: true });

    expect(shown).toContain(TAB_SPAN);
    expect(shown.split(TAB_SPAN).join("\t")).toBe(plain);
  });

  test("is off unless asked for", () => {
    expect(highlightCode("a\tb", null)).toBe("a\tb");
    expect(highlightCode("a\tb", null, { showTabs: false })).toBe("a\tb");
  });

  test("leaves a document without tabs untouched", () => {
    expect(highlightCode("a b", "yaml", { showTabs: true })).toBe(
      highlightCode("a b", "yaml"),
    );
  });
});

describe("the grammars are registered on highlight.js core", () => {
  test.each([
    "bash",
    "css",
    "javascript",
    "json",
    "markdown",
    "sql",
    "xml",
    "yaml",
  ])("%s is registered once the module is imported", (grammar: string) => {
    expect(hljs.getLanguage(grammar)).toBeDefined();
  });

  test("html resolves, as an alias of xml", () => {
    expect(hljs.getLanguage("html")).toBe(hljs.getLanguage("xml"));
  });

  /*
   * CodeBlock registers its own set of grammars on the same core. Importing
   * the editor afterwards must leave them exactly as they are.
   */
  test("a grammar CodeBlock already registered is left alone", async () => {
    jest.resetModules();

    const { default: core } = await import("highlight.js/lib/core");

    await import("../../../../UI/Components/CodeBlock/LanguageRegistry");

    const before: ReturnType<typeof core.getLanguage> =
      core.getLanguage("json");

    await import("../../../../UI/Components/CodeEditor/CodeEditorHighlight");

    expect(before).toBeDefined();
    expect(core.getLanguage("json")).toBe(before);
    expect(core.getLanguage("yaml")).toBeDefined();
  });

  test("a grammar registered by anyone else first is not replaced", async () => {
    jest.resetModules();

    const { default: core } = await import("highlight.js/lib/core");

    core.registerLanguage("json", () => {
      return { name: "Stub JSON", contains: [] };
    });

    await import("../../../../UI/Components/CodeEditor/CodeEditorHighlight");

    expect(core.getLanguage("json")?.name).toBe("Stub JSON");
    // Every grammar it did not find is still registered.
    expect(core.getLanguage("sql")).toBeDefined();
  });
});
