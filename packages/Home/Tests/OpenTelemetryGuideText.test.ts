import {
  UNBROKEN_CODE_LENGTH,
  inlineTextLinks,
  inlineTextProblems,
  inlineTextToHtml,
  inlineTextToPlainText,
  parseInlineText,
} from "../Utils/Integrations/OpenTelemetry/GuideText";
import { JSDOM } from "jsdom";
import {
  highlightSnippet,
  plainArgumentBuiltins,
} from "../Utils/Integrations/OpenTelemetry/GuideHighlight";
import { OPEN_TELEMETRY_GUIDE_PAGES } from "../Utils/Integrations/OpenTelemetry/OpenTelemetryGuides";
import {
  PlacedSnippet,
  placedGuideSnippets,
} from "../Utils/Integrations/OpenTelemetry/GuideSnippets";
import { listInWords } from "../Utils/Integrations/OpenTelemetry/IntegrationsIndex";
import {
  GuideMark,
  GuideSection,
  guideMark,
  guideSections,
  monogramOf,
} from "../Utils/Integrations/OpenTelemetry/GuidePage";
import { isWideLogoFile } from "../Utils/ProviderLogoFiles";
import {
  OPEN_TELEMETRY_GUIDES,
  OpenTelemetryGuideEntry,
  OpenTelemetryGuideLanguage,
  getOpenTelemetryGuide,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import { describe, expect, test } from "@jest/globals";

/*
 * The small readers the guides' pages are drawn with: inline text (code,
 * bold and links in plain words), the highlighter's escaping, the words a
 * section title is built from, and the marks that stand in for a logo.
 */

describe("a guide's inline text", () => {
  test("is read into its parts: words, code, bold and links", () => {
    expect(
      parseInlineText(
        "Set `OTEL_SERVICE_NAME` under **Services**, see [the docs](/docs/telemetry/services).",
      ),
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
    const html: string = inlineTextToHtml(
      'A `<script>` and "quotes" & <b>tags</b>',
    );

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;quotes&quot; &amp; &lt;b&gt;tags&lt;/b&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
  });

  test("opens a link to another site in a new tab, and the site's own in place", () => {
    expect(inlineTextToHtml("[Fastify](https://fastify.dev)")).toContain(
      'href="https://fastify.dev" target="_blank" rel="noopener"',
    );
    expect(
      inlineTextToHtml("[Ingestion keys](/docs/telemetry/ingestion-keys)"),
    ).not.toContain("target=");
  });

  test("draws code that wraps with a box on each line it spans", () => {
    const code: Element = new JSDOM(
      inlineTextToHtml(
        'Record it: `span.addEvent("exception", { "exception.type": "CardDeclined" })`.',
      ),
    ).window.document.querySelector("code")!;

    expect(code.classList.contains("box-decoration-clone")).toBe(true);
    // Too long for a phone's line: it may break where it has to.
    expect(code.classList.contains("break-words")).toBe(true);
    expect(code.classList.contains("whitespace-nowrap")).toBe(false);
  });

  test("keeps a short name such as `bun add` on one line, and lets a long one break", () => {
    const codes: Array<Element> = Array.from(
      new JSDOM(
        inlineTextToHtml(
          "Use `pnpm add`, `yarn add` or `bun add`, or `@opentelemetry/auto-instrumentations-node`.",
        ),
      ).window.document.querySelectorAll("code"),
    );

    expect(
      codes.map((code: Element): [string, boolean] => {
        return [
          code.textContent || "",
          code.classList.contains("whitespace-nowrap"),
        ];
      }),
    ).toEqual([
      ["pnpm add", true],
      ["yarn add", true],
      ["bun add", true],
      ["@opentelemetry/auto-instrumentations-node", false],
    ]);
    for (const code of codes) {
      expect(code.classList.contains("box-decoration-clone")).toBe(true);
    }
  });

  test("keeps a name of exactly the unbroken length whole, and one character more breakable", () => {
    const classesOf: (code: string) => DOMTokenList = (
      code: string,
    ): DOMTokenList => {
      return new JSDOM(
        inlineTextToHtml(`\`${code}\``),
      ).window.document.querySelector("code")!.classList;
    };

    expect(
      classesOf("x".repeat(UNBROKEN_CODE_LENGTH)).contains("whitespace-nowrap"),
    ).toBe(true);
    expect(
      classesOf("x".repeat(UNBROKEN_CODE_LENGTH + 1)).contains(
        "whitespace-nowrap",
      ),
    ).toBe(false);
  });

  test("keeps code inside a link's words", () => {
    expect(
      inlineTextToHtml("[`register()`](/docs/telemetry/open-telemetry)"),
    ).toContain('<code class="font-mono text-[0.85em]">register()</code>');
  });

  test("gives its words alone to a meta description or structured data", () => {
    expect(
      inlineTextToPlainText(
        "Run `node --import` and open **Traces**: see [the docs](/docs/x).",
      ),
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
    expect(
      inlineTextProblems("All `closed`, **bold** and [linked](/docs/x)."),
    ).toEqual([]);
  });
});

describe("the highlighter", () => {
  test("escapes the code it colours", () => {
    const html: string = highlightSnippet(
      'const a = "<b>" && b;',
      "javascript",
    );

    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });

  test("leaves plain text as escaped text", () => {
    expect(highlightSnippet("connect-src 'self' <x>", "text")).toBe(
      "connect-src &#x27;self&#x27; &lt;x&gt;",
    );
  });

  test("draws a command's flag as the command's, not as a shell builtin of the same name", () => {
    const command: string =
      "opentelemetry-instrument gunicorn shop.wsgi --bind 0.0.0.0:8000";
    const shell: string = highlightSnippet(command, "bash");
    const dockerfile: string = highlightSnippet(`RUN ${command}`, "dockerfile");

    for (const html of [shell, dockerfile]) {
      // gunicorn's --bind, not bash's bind.
      expect(html).toContain("--bind 0.0.0.0:8000");
      expect(html).not.toContain('<span class="hljs-built_in">bind</span>');
      expect(
        new JSDOM(`<code>${html}</code>`).window.document.body.textContent,
      ).toBe(html === shell ? command : `RUN ${command}`);
    }
    // A builtin the command line calls is still one: "set" before its flag.
    expect(highlightSnippet("set -e", "bash")).toContain(
      '<span class="hljs-built_in">set</span>',
    );
  });

  test("draws a word of a path or a module name as plain text, not as a shell builtin of the same name", () => {
    const install: string = [
      "go get go.opentelemetry.io/otel@v1.47.0 \\",
      "  go.opentelemetry.io/otel/sdk/log@v1.47.0 \\",
      "  github.com/labstack/echo/v5@v5.4.2",
    ].join("\n");
    const html: string = highlightSnippet(install, "bash");

    // Go's log SDK and Echo's module, not bash's log and echo.
    expect(html).toContain("otel/sdk/log@v1.47.0");
    expect(html).toContain("labstack/echo/v5@v5.4.2");
    expect(html).not.toContain("hljs-built_in");
    expect(
      new JSDOM(`<code>${html}</code>`).window.document.body.textContent,
    ).toBe(install);

    // Bundler's exec and config set, and the local of /usr/local.
    for (const [code, language] of [
      ["bundle exec puma", "bash"],
      [
        'RUN bundle config set --local without "development test"',
        "dockerfile",
      ],
      [
        "COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer",
        "dockerfile",
      ],
    ] as Array<[string, "bash" | "dockerfile"]>) {
      expect([code, highlightSnippet(code, language)]).toEqual([
        code,
        expect.not.stringContaining("hljs-built_in"),
      ]);
    }

    // Where a command starts, a builtin is still one.
    for (const [code, language, word] of [
      ['export OTEL_SERVICE_NAME="orders-api"', "bash", "export"],
      [
        'RUN echo "FallbackResource /index.php" > site.conf',
        "dockerfile",
        "echo",
      ],
      ["cd app && export A=1", "bash", "export"],
      ["if true; then echo ready; fi", "bash", "echo"],
    ] as Array<[string, "bash" | "dockerfile", string]>) {
      expect([code, highlightSnippet(code, language)]).toEqual([
        code,
        expect.stringContaining(`<span class="hljs-built_in">${word}</span>`),
      ]);
    }
  });

  test("puts back as plain text only the builtins that are arguments, and leaves anything else as it was", () => {
    expect(
      plainArgumentBuiltins('--<span class="hljs-built_in">bind</span> :80'),
    ).toBe("--bind :80");
    expect(
      plainArgumentBuiltins(
        'a -<span class="hljs-built_in">set</span> b -<span class="hljs-built_in">read</span>',
      ),
    ).toBe("a -set b -read");
    expect(
      plainArgumentBuiltins(
        'bundle <span class="hljs-built_in">exec</span> puma',
      ),
    ).toBe("bundle exec puma");
    // A line that ends in a backslash goes on as the same command.
    expect(
      plainArgumentBuiltins(
        'go get a \\\n  <span class="hljs-built_in">log</span>',
      ),
    ).toBe("go get a \\\n  log");
    for (const html of [
      "",
      "plain words",
      '<span class="hljs-built_in">set</span> -e',
      '  <span class="hljs-built_in">export</span> A=1',
      'a\n<span class="hljs-built_in">export</span> A=1',
      'a &amp;&amp; <span class="hljs-built_in">export</span> A=1',
      'a; <span class="hljs-built_in">set</span> -e',
      'x=$(<span class="hljs-built_in">pwd</span>)',
      '<span class="hljs-keyword">RUN</span><span class="bash"> <span class="hljs-built_in">echo</span> hi</span>',
      '-<span class="hljs-string">bind</span>',
      // A tag left open, as no highlighter writes: kept whole.
      '--<span class="hljs-built_in">bind',
      '--<span class="hljs-built_in',
    ]) {
      expect(plainArgumentBuiltins(html)).toBe(html);
    }
  });

  test("leaves no shell builtin inside an argument in any guide's commands", () => {
    const BUILT_IN: string = '<span class="hljs-built_in">';
    // One element to read a line's text through, its tags left out.
    const reader: Element = new JSDOM(
      "<code></code>",
    ).window.document.querySelector("code")!;
    let builtins: number = 0;

    for (const guide of OPEN_TELEMETRY_GUIDE_PAGES) {
      for (const placed of placedGuideSnippets(guide)) {
        const snippet: PlacedSnippet["snippet"] = placed.snippet;

        if (snippet.language !== "bash" && snippet.language !== "dockerfile") {
          continue;
        }

        const html: string = highlightSnippet(snippet.code, snippet.language);
        let at: number = html.indexOf(BUILT_IN);

        while (at >= 0) {
          builtins++;
          // What the line holds before the builtin, with its tags left out.
          const lineStart: number = html.lastIndexOf("\n", at) + 1;
          reader.innerHTML = html.slice(lineStart, at);
          const before: string = (reader.textContent || "").trimEnd();
          const startsTheLine: boolean =
            before.length === 0 || before.endsWith("RUN");

          expect([guide.slug, snippet.id, before, startsTheLine]).toEqual([
            guide.slug,
            snippet.id,
            before,
            true,
          ]);
          at = html.indexOf(BUILT_IN, at + BUILT_IN.length);
        }
      }
    }

    // The guides' export lines and RUN echo lines are still coloured.
    expect(builtins).toBeGreaterThan(300);
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
    expect(titleOf(sections, "troubleshooting")).toBe(
      "Troubleshooting OpenTelemetry in Fastify",
    );
    expect(titleOf(sections, "faq")).toBe("Fastify OpenTelemetry FAQ");
    expect(titleOf(sections, "containers")).toBe(
      "Run it in Docker and Kubernetes",
    );
  });

  test("name the web app on the browser's own page, which ships a bundle, not a container", () => {
    const sections: Array<GuideSection> = guideSections(
      "JavaScript in the browser",
      "browser",
    );

    expect(titleOf(sections, "setup")).toBe(
      "Add OpenTelemetry to your web app",
    );
    expect(titleOf(sections, "troubleshooting")).toBe(
      "Troubleshooting OpenTelemetry in the browser",
    );
    expect(titleOf(sections, "faq")).toBe("Browser OpenTelemetry FAQ");
    expect(titleOf(sections, "containers")).toBe("Ship it to production");
  });

  test("name a browser framework's app after it", () => {
    const sections: Array<GuideSection> = guideSections("React", "browser");

    expect(titleOf(sections, "setup")).toBe(
      "Add OpenTelemetry to your React app",
    );
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
    expect(listInWords(["Python", "Java", ".NET"])).toBe(
      "Python, Java and .NET",
    );
  });

  test("stands two letters in for a logo the registry does not have", () => {
    expect(monogramOf("Express")).toBe("Ex");
    expect(monogramOf("Next.js")).toBe("Ne");
    expect(monogramOf("hapi")).toBe("Ha");
  });
});

describe("a guide's mark", () => {
  const markOf: (slug: string) => GuideMark = (slug: string): GuideMark => {
    return guideMark(getOpenTelemetryGuide(slug)!);
  };

  test("is the framework's official logo, served by this site at a versioned address", () => {
    const mark: GuideMark = markOf("express");

    expect(mark.logo?.src).toMatch(
      /^\/img\/provider-logos\/express\.svg\?v=[0-9a-f]{10}$/,
    );
    expect(mark.logo?.alt).toBe("Express");
    expect(mark.icon).toBeUndefined();
  });

  test("is a browser window for plain JavaScript in the browser, which no one brand owns", () => {
    const mark: GuideMark = markOf("browser");

    expect(mark.logo).toBeUndefined();
    expect(mark.icon).toBe("browser");
  });

  test("is a logo for every other JavaScript guide", () => {
    for (const entry of OPEN_TELEMETRY_GUIDES) {
      if (
        entry.language !== OpenTelemetryGuideLanguage.JavaScript ||
        entry.slug === "browser"
      ) {
        continue;
      }
      expect([entry.slug, Boolean(guideMark(entry).logo)]).toEqual([
        entry.slug,
        true,
      ]);
    }
  });

  test("is drawn wide for the wordmarks and wide symbols, square for the rest", () => {
    const wide: Array<string> = OPEN_TELEMETRY_GUIDES.filter(
      (entry: OpenTelemetryGuideEntry): boolean => {
        return Boolean(guideMark(entry).logo?.isWide);
      },
    ).map((entry: OpenTelemetryGuideEntry): string => {
      return entry.slug;
    });

    /*
     * Go's and PHP's marks are wordmarks, drawn wide on their language
     * guides; Sinatra's fedora and Phoenix's bird are wide symbols.
     */
    expect(wide).toEqual([
      "fastify",
      "koa",
      "hapi",
      "go",
      "sinatra",
      "php",
      "phoenix",
    ]);
  });

  test("falls back to the framework's initials for a guide with no logo and no icon", () => {
    const mark: GuideMark = guideMark({
      slug: "some-framework",
      name: "Some Framework",
      language: OpenTelemetryGuideLanguage.Python,
      kind: "framework",
    });

    expect(mark).toEqual({ logo: undefined, icon: undefined, monogram: "So" });
  });

  test("names a logo the registry has", () => {
    expect(getOpenTelemetryGuide("react")?.logo).toBe(ProviderLogo.React);
  });
});

describe("a logo file's width", () => {
  test("is wide when its viewBox is more than 1.3 times as wide as it is tall", () => {
    expect(isWideLogoFile('<svg viewBox="0 0 512 275"></svg>')).toBe(true);
    expect(isWideLogoFile('<svg viewBox="0 0 256 165"></svg>')).toBe(true);
  });

  test("is square for a square or nearly square viewBox", () => {
    expect(isWideLogoFile('<svg viewBox="0 0 24 24"></svg>')).toBe(false);
    expect(isWideLogoFile('<svg viewBox="0 0 256 225"></svg>')).toBe(false);
    expect(isWideLogoFile('<svg viewBox="0 0 130 100"></svg>')).toBe(false);
  });

  test("is square when the file has no readable viewBox", () => {
    expect(isWideLogoFile("<svg></svg>")).toBe(false);
    expect(isWideLogoFile('<svg viewBox="0 0 0 0"></svg>')).toBe(false);
    expect(isWideLogoFile('<svg viewBox="nonsense"></svg>')).toBe(false);
  });
});
