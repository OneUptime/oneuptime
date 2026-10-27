import {
  inlineTextLinks,
  inlineTextProblems,
  inlineTextToHtml,
  inlineTextToPlainText,
  parseInlineText,
} from "../Utils/Integrations/OpenTelemetry/GuideText";
import { highlightSnippet } from "../Utils/Integrations/OpenTelemetry/GuideHighlight";
import { listInWords } from "../Utils/Integrations/OpenTelemetry/IntegrationsIndex";
import {
  GuideSection,
  guideSections,
  monogramOf,
} from "../Utils/Integrations/OpenTelemetry/GuidePage";
import { describe, expect, test } from "@jest/globals";

/*
 * The small readers the guides' pages are drawn with: inline text (code,
 * bold and links in plain words), the highlighter's escaping, the words a
 * section title is built from, and the marks that stand in for a logo.
 */

describe("a guide's inline text", () => {
  test("is read into its parts: words, code, bold and links", () => {
    expect(
      parseInlineText("Set `OTEL_SERVICE_NAME` under **Services**, see [the docs](/docs/telemetry/services)."),
    ).toEqual([
      { kind: "text", text: "Set " },
      { kind: "code", text: "OTEL_SERVICE_NAME" },
      { kind: "text", text: " under " },
      { kind: "bold", text: "Services" },
      { kind: "text", text: ", see " },
      { kind: "link", text: "the docs", href: "/docs/telemetry/services" },
      { kind: "text", text: "." },
    ]);
  });

  test("is drawn as HTML with every character of the words escaped", () => {
    const html: string = inlineTextToHtml("A `<script>` and \"quotes\" & <b>tags</b>");

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;quotes&quot; &amp; &lt;b&gt;tags&lt;/b&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
  });

  test("opens a link to another site in a new tab, and the site's own in place", () => {
    expect(inlineTextToHtml("[Fastify](https://fastify.dev)")).toContain(
      'href="https://fastify.dev" target="_blank" rel="noopener"',
    );
    expect(inlineTextToHtml("[Ingestion keys](/docs/telemetry/ingestion-keys)")).not.toContain(
      "target=",
    );
  });

  test("keeps code inside a link's words", () => {
    expect(inlineTextToHtml("[`register()`](/docs/telemetry/open-telemetry)")).toContain(
      '<code class="font-mono text-[0.85em]">register()</code>',
    );
  });

  test("gives its words alone to a meta description or structured data", () => {
    expect(
      inlineTextToPlainText("Run `node --import` and open **Traces**: see [the docs](/docs/x)."),
    ).toBe("Run node --import and open Traces: see the docs.");
  });

  test("lists its links", () => {
    expect(inlineTextLinks("[a](/docs/a) and [b](https://b.example)")).toEqual([
      "/docs/a",
      "https://b.example",
    ]);
  });

  test("names a mark left open, and a link the site would not write", () => {
    expect(inlineTextProblems("A lone ` backtick")).toEqual([
      'a backtick that never closes in "A lone ` backtick"',
    ]);
    expect(inlineTextProblems("Bold **that never ends")).toEqual([
      'a bold mark that never closes in "Bold **that never ends"',
    ]);
    expect(inlineTextProblems("[relative](docs/page)")).toEqual([
      'a link to "docs/page": write /path or https://',
    ]);
    expect(inlineTextProblems("All `closed`, **bold** and [linked](/docs/x).")).toEqual([]);
  });
});

describe("the highlighter", () => {
  test("escapes the code it colours", () => {
    const html: string = highlightSnippet('const a = "<b>" && b;', "javascript");

    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });

  test("leaves plain text as escaped text", () => {
    expect(highlightSnippet("connect-src 'self' <x>", "text")).toBe(
      "connect-src &#x27;self&#x27; &lt;x&gt;",
    );
  });
});

describe("a guide's section titles", () => {
  const titleOf: (sections: Array<GuideSection>, id: string) => string = (
    sections: Array<GuideSection>,
    id: string,
  ): string => {
    return sections.find((section: GuideSection): boolean => {
      return section.id === id;
    })!.title;
  };

  test("name a framework as its maker writes it", () => {
    const sections: Array<GuideSection> = guideSections("Fastify", "framework");

    expect(titleOf(sections, "setup")).toBe("Add OpenTelemetry to Fastify");
    expect(titleOf(sections, "troubleshooting")).toBe("Troubleshooting OpenTelemetry in Fastify");
    expect(titleOf(sections, "faq")).toBe("Fastify OpenTelemetry FAQ");
    expect(titleOf(sections, "containers")).toBe("Run it in Docker and Kubernetes");
  });

  test("name the web app on the browser's own page, which ships a bundle, not a container", () => {
    const sections: Array<GuideSection> = guideSections("JavaScript in the browser", "browser");

    expect(titleOf(sections, "setup")).toBe("Add OpenTelemetry to your web app");
    expect(titleOf(sections, "troubleshooting")).toBe(
      "Troubleshooting OpenTelemetry in the browser",
    );
    expect(titleOf(sections, "faq")).toBe("Browser OpenTelemetry FAQ");
    expect(titleOf(sections, "containers")).toBe("Ship it to production");
  });

  test("name a browser framework's app after it", () => {
    const sections: Array<GuideSection> = guideSections("React", "browser");

    expect(titleOf(sections, "setup")).toBe("Add OpenTelemetry to your React app");
    expect(titleOf(sections, "faq")).toBe("React OpenTelemetry FAQ");
  });

  test("are the same fourteen sections, in the same order, on every page", () => {
    const ids: (sections: Array<GuideSection>) => Array<string> = (
      sections: Array<GuideSection>,
    ): Array<string> => {
      return sections.map((section: GuideSection): string => {
        return section.id;
      });
    };

    expect(ids(guideSections("Express", "framework"))).toEqual(
      ids(guideSections("JavaScript in the browser", "browser")),
    );
    expect(guideSections("Express", "framework").length).toBe(14);
  });
});

describe("the words the index and the marks are made of", () => {
  test("lists languages as a sentence does", () => {
    expect(listInWords([])).toBe("");
    expect(listInWords(["Python"])).toBe("Python");
    expect(listInWords(["Python", "Java"])).toBe("Python and Java");
    expect(listInWords(["Python", "Java", ".NET"])).toBe("Python, Java and .NET");
  });

  test("stands two letters in for a logo the registry does not have", () => {
    expect(monogramOf("Express")).toBe("Ex");
    expect(monogramOf("Next.js")).toBe("Ne");
    expect(monogramOf("hapi")).toBe("Ha");
  });
});
