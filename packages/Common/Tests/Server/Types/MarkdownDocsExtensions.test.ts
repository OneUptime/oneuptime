import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import {
  DOCS_CALLOUT_LABELS,
  DOCS_CALLOUT_TYPES,
  DOCS_CONTAINER_NAMES,
  DocsContainerMatch,
  docsTabKey,
  readDocsContainer,
  splitDocsTabs,
} from "../../../Server/Types/MarkdownDocsExtensions";

/*
 * The docs' block components - steps, tabs, cards, collapsible sections and
 * callouts - are Markdown, read by the docs renderer alone. These pin how a
 * container is found (nesting, code fences, unclosed and unknown names), what
 * each one renders, that the markup stays escaped, and that the blog and
 * email renderers still read ":::" as text.
 */

const docs: (markdown: string) => Promise<string> = (
  markdown: string,
): Promise<string> => {
  return Markdown.convertToHTML(markdown, MarkdownContentType.Docs);
};

describe("readDocsContainer", () => {
  test("reads a container at the start of the source", () => {
    const match: DocsContainerMatch | null = readDocsContainer(
      ":::steps\n### One\nText\n:::\nAfter",
    );

    expect(match).toEqual({
      raw: ":::steps\n### One\nText\n:::\n",
      name: "steps",
      argument: "",
      body: "### One\nText",
    });
  });

  test("takes everything after the name as its argument", () => {
    expect(
      readDocsContainer(":::details   Why is this offline?  \nBody\n:::")
        ?.argument,
    ).toBe("Why is this offline?");
  });

  test("has a raw that is an exact prefix of the source, with or without a trailing newline", () => {
    for (const source of [":::tip\nA\n:::", ":::tip\nA\n:::\n\nNext"]) {
      const match: DocsContainerMatch | null = readDocsContainer(source);

      expect(match).not.toBeNull();
      expect(source.startsWith(match!.raw)).toBe(true);
    }
  });

  test("accepts up to three spaces of indentation and longer colon runs", () => {
    expect(readDocsContainer("   ::::note\nA\n   ::::")?.name).toBe("note");
    expect(readDocsContainer("    :::note\nA\n:::")).toBeNull();
  });

  test("closes at its own closing line, past nested containers", () => {
    const source: string = [
      ":::steps",
      "### One",
      ":::tabs",
      "@tab A",
      "a",
      ":::",
      "### Two",
      ":::",
      "outside",
    ].join("\n");

    expect(readDocsContainer(source)?.body).toBe(
      ["### One", ":::tabs", "@tab A", "a", ":::", "### Two"].join("\n"),
    );
  });

  test("ignores ':::' lines inside a fenced code block", () => {
    const source: string = [
      ":::tip",
      "```markdown",
      ":::",
      "```",
      "~~~~",
      ":::",
      "~~~",
      ":::",
      "~~~~",
      "end",
      ":::",
    ].join("\n");

    expect(readDocsContainer(source)?.body.split("\n").pop()).toBe("end");
  });

  test("is not a container when it is never closed", () => {
    expect(readDocsContainer(":::steps\n### One\nno end")).toBeNull();
  });

  test("is not a container when its name is not one of ours", () => {
    expect(readDocsContainer(":::unknown\nx\n:::")).toBeNull();
    expect(readDocsContainer("::: \nx\n:::")).toBeNull();
    expect(readDocsContainer("text\n:::note\nx\n:::")).toBeNull();
  });

  test("knows every component name and every callout type", () => {
    expect(DOCS_CONTAINER_NAMES).toEqual(
      expect.arrayContaining(["steps", "tabs", "cards", "details"]),
    );
    for (const type of DOCS_CALLOUT_TYPES) {
      expect(DOCS_CONTAINER_NAMES).toContain(type);
      expect(DOCS_CALLOUT_LABELS[type]).toEqual(expect.any(String));
    }
  });
});

describe("splitDocsTabs", () => {
  test("splits at its own @tab lines and keeps text before the first", () => {
    expect(splitDocsTabs("Intro\n@tab One\na\n@tab Two  \nb")).toEqual({
      intro: "Intro",
      tabs: [
        { label: "One", body: "a" },
        { label: "Two", body: "b" },
      ],
    });
  });

  test("leaves @tab lines in code samples and nested sets alone", () => {
    const body: string = [
      "@tab Outer A",
      "```text",
      "@tab not a tab",
      "```",
      ":::tabs",
      "@tab Inner",
      "x",
      ":::",
      "@tab Outer B",
      "y",
    ].join("\n");

    expect(
      splitDocsTabs(body).tabs.map((tab: { label: string }) => {
        return tab.label;
      }),
    ).toEqual(["Outer A", "Outer B"]);
  });

  test("matches labels on case and spacing alone", () => {
    expect(docsTabKey("  Docker   Compose ")).toBe("docker compose");
    expect(docsTabKey("Node.js")).toBe("node.js");
  });
});

describe("the docs renderer's components", () => {
  describe("steps", () => {
    test("makes each heading a numbered step that keeps its anchor", async () => {
      const html: string = await docs(
        ":::steps\n### Install the agent\nRun it.\n\n### Check it reports\nOpen it.\n:::",
      );

      expect(html).toContain('<ol class="docs-steps" role="list">');
      expect(html.match(/<li class="docs-step">/g)).toHaveLength(2);
      expect(html).toContain('id="install-the-agent"');
      expect(html).toContain('id="check-it-reports"');
      expect(html).toContain('<div class="docs-step__body"><p>Run it.</p>');
    });

    test("splits at the highest heading level present, keeping deeper ones inside", async () => {
      const html: string = await docs(
        ":::steps\n## First\n### Detail\nx\n## Second\ny\n:::",
      );

      expect(html.match(/<li class="docs-step">/g)).toHaveLength(2);
      expect(html).toMatch(
        /<div class="docs-step__body"><h3 id="detail"[\s\S]*<\/div><\/li><li class="docs-step"><h2 id="second"/,
      );
    });

    test("keeps text before the first step above the list", async () => {
      const html: string = await docs(":::steps\nBefore.\n### One\nx\n:::");

      expect(html.indexOf("<p>Before.</p>")).toBeLessThan(
        html.indexOf('<ol class="docs-steps"'),
      );
    });

    test("draws a plain numbered list as steps when there are no headings", async () => {
      const html: string = await docs(":::steps\n1. One\n2. Two\n:::");

      expect(html).toContain('<div class="docs-steps docs-steps--list"><ol>');
    });

    test("interrupts a paragraph that runs straight into it", async () => {
      const html: string = await docs("Intro text.\n:::steps\n### One\nx\n:::");

      expect(html).toContain("<p>Intro text.</p>");
      expect(html).toContain('<ol class="docs-steps"');
    });
  });

  describe("tabs", () => {
    const source: string = [
      ":::tabs",
      "@tab Docker Compose",
      "```bash",
      "docker compose up -d",
      "```",
      "@tab Kubernetes",
      "Run `helm install`.",
      ":::",
    ].join("\n");

    test("renders a tab list and a panel per tab, the first selected", async () => {
      const html: string = await docs(source);

      expect(html).toContain(
        '<div class="docs-tabs" data-docs-tabs id="docs-tabs-1">',
      );
      expect(html).toContain('role="tablist"');
      expect(html.match(/role="tab"/g)).toHaveLength(2);
      expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
      expect(html).toContain(
        'id="docs-tabs-1-tab-0" aria-controls="docs-tabs-1-panel-0" aria-selected="true" tabindex="0" data-docs-tab="docker compose"',
      );
      expect(html).toContain(
        'id="docs-tabs-1-tab-1" aria-controls="docs-tabs-1-panel-1" aria-selected="false" tabindex="-1" data-docs-tab="kubernetes"',
      );
      expect(html).toContain(
        '<div class="docs-tabs__panel is-active" role="tabpanel" id="docs-tabs-1-panel-0" aria-labelledby="docs-tabs-1-tab-0"',
      );
    });

    test("labels every panel, so the page reads in order without scripting", async () => {
      const html: string = await docs(source);

      expect(html).toContain(
        '<p class="docs-tabs__panel-label">Docker Compose</p>',
      );
      expect(html).toContain(
        '<p class="docs-tabs__panel-label">Kubernetes</p>',
      );
    });

    test("numbers sets per page, nested ones too, and starts again on the next page", async () => {
      const nested: string = [
        ":::tabs",
        "@tab A",
        ":::tabs",
        "@tab A1",
        "x",
        "@tab A2",
        "y",
        ":::",
        "@tab B",
        "z",
        ":::",
        "",
        source,
      ].join("\n");

      const first: string = await docs(nested);
      const second: string = await docs(nested);

      const ids: Array<string> = Array.from(
        first.matchAll(/data-docs-tabs id="([^"]+)"/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      expect(new Set(ids).size).toBe(3);
      expect(second).toBe(first);
    });

    test("escapes a label", async () => {
      const html: string = await docs(
        ':::tabs\n@tab <img src=x onerror="alert(1)">\nx\n@tab B\ny\n:::',
      );

      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    });
  });

  describe("cards", () => {
    test("turns each list item into a linked card with its description", async () => {
      const html: string = await docs(
        [
          ":::cards",
          "- [Monitors](/docs/monitor/create-monitor): Watch websites and APIs.",
          "- **[Incidents](/docs/incidents/index)** — Coordinate a response.",
          "- [On-Call](/docs/on-call/schedules) - Decide who is paged.",
          ":::",
        ].join("\n"),
      );

      expect(html).toContain('<div class="docs-cards">');
      expect(html).toContain(
        '<a class="docs-card" href="/docs/monitor/create-monitor"><span class="docs-card__icon" aria-hidden="true"></span><span class="docs-card__title">Monitors</span><span class="docs-card__body">Watch websites and APIs.</span></a>',
      );
      expect(html).toContain(
        '<span class="docs-card__title">Incidents</span><span class="docs-card__body">Coordinate a response.</span>',
      );
      expect(html).toContain(
        '<span class="docs-card__body">Decide who is paged.</span>',
      );
    });

    test("opens a card that leaves the docs in a new tab", async () => {
      const html: string = await docs(
        ":::cards\n- [GitHub](https://github.com/oneuptime/oneuptime)\n:::",
      );

      expect(html).toContain(
        '<a class="docs-card" href="https://github.com/oneuptime/oneuptime" target="_blank" rel="noopener noreferrer">',
      );
      expect(html).not.toContain("docs-card__body");
    });

    test("keeps an item without a link as a card that is not a link", async () => {
      const html: string = await docs(":::cards\n- Just **text**\n:::");

      expect(html).toContain(
        '<div class="docs-card docs-card--static"><span class="docs-card__icon" aria-hidden="true"></span><span class="docs-card__body">Just <strong>text</strong></span></div>',
      );
    });

    test("escapes the link target", async () => {
      const html: string = await docs(
        ':::cards\n- [X](/docs/a/b?x="><script>)\n:::',
      );

      expect(html).not.toContain('"><script>');
    });
  });

  describe("details", () => {
    test("folds its body under a summary written in Markdown", async () => {
      const html: string = await docs(
        ":::details Why is `probe-1` offline?\nBecause **reasons**.\n:::",
      );

      expect(html).toContain(
        '<details class="docs-details"><summary class="docs-details__summary">Why is <code class="docs-code-inline">probe-1</code> offline?</summary><div class="docs-details__body"><p>Because <strong>reasons</strong>.</p></div></details>',
      );
    });

    test("marks its default summary for translation", async () => {
      expect(await docs(":::details\nx\n:::")).toContain(
        '<span data-docs-label="details">Details</span>',
      );
    });
  });

  describe("callouts", () => {
    test.each(DOCS_CALLOUT_TYPES as Array<string>)(
      ":::%s renders a callout with a label marked for translation",
      async (type: string) => {
        const html: string = await docs(`:::${type}\nBody **text**.\n:::`);

        expect(html).toContain(`docs-callout docs-callout--${type}`);
        expect(html).toContain(
          `<span class="docs-callout__label" data-docs-label="${type}">${DOCS_CALLOUT_LABELS[type]}</span>`,
        );
        expect(html).toContain(
          '<div class="docs-callout__body"><p>Body <strong>text</strong>.</p></div>',
        );
      },
    );

    test("uses a title of its own when it has one", async () => {
      const html: string = await docs(":::warning Back up *first*\nx\n:::");

      expect(html).toContain(
        '<span class="docs-callout__label">Back up <em>first</em></span>',
      );
      expect(html).not.toContain('data-docs-label="warning"');
    });

    test.each([
      ["NOTE", "note"],
      ["TIP", "tip"],
      ["IMPORTANT", "important"],
      ["WARNING", "warning"],
      ["CAUTION", "caution"],
      ["DANGER", "danger"],
      ["INFO", "info"],
    ])("reads GitHub's > [!%s] alert", async (marker: string, type: string) => {
      const html: string = await docs(`> [!${marker}]\n> Back up **first**.`);

      expect(html).toContain(`docs-callout docs-callout--${type}`);
      expect(html).toContain(`data-docs-label="${type}"`);
      expect(html).toContain(
        '<div class="docs-callout__body"><p>Back up <strong>first</strong>.</p>',
      );
      expect(html).not.toContain(`[!${marker}]`);
    });

    test("reads an alert whose marker is a paragraph of its own", async () => {
      const html: string = await docs("> [!TIP]\n>\n> One.\n>\n> Two.");

      expect(html).toContain("docs-callout--tip");
      expect(html).toContain(
        '<div class="docs-callout__body"><p>One.</p><p>Two.</p></div>',
      );
      expect(html).not.toContain("<p></p>");
    });

    test("still reads the > **Note:** form, Important included", async () => {
      expect(await docs("> **Note:** Read this.")).toContain(
        "docs-callout--note",
      );
      expect(await docs("> **Important:** Read this.")).toContain(
        "docs-callout--important",
      );
    });

    test("leaves an ordinary quote a quote", async () => {
      expect(await docs("> Just a quote.")).toContain(
        '<blockquote class="docs-quote">',
      );
    });
  });

  describe("code blocks", () => {
    test("show a title next to the language", async () => {
      const html: string = await docs(
        '```bash title="install.sh"\necho hi\n```',
      );

      expect(html).toContain(
        '<span class="docs-code__title">install.sh</span><span class="docs-code__lang">Bash</span>',
      );
      expect(html).toContain('<code class="language-bash">');
      expect(html).toContain('data-language="bash"');
    });

    test("accept a title in single quotes, and escape it", async () => {
      const html: string = await docs(
        "```yaml title='<values>.yaml'\na: 1\n```",
      );

      expect(html).toContain(
        '<span class="docs-code__title">&lt;values&gt;.yaml</span>',
      );
    });

    test("caption a diagram with its title", async () => {
      const html: string = await docs(
        '```mermaid title="From a check to a page"\nflowchart LR\n  A --> B\n```',
      );

      expect(html).toContain(
        '<div class="docs-diagram"><div class="mermaid">flowchart LR\n  A --&gt; B</div><p class="docs-diagram__caption">From a check to a page</p></div>',
      );
    });
  });

  describe("what is not a component", () => {
    test("an unknown or unclosed container stays text", async () => {
      const html: string = await docs(
        ":::unknown\nx\n:::\n\n:::steps\nnever closed",
      );

      expect(html).toContain("<p>:::unknown\nx\n:::</p>");
      expect(html).toContain("<p>:::steps\nnever closed</p>");
    });

    test("raw HTML inside a component is still escaped", async () => {
      const html: string = await docs(
        ':::tip\n<img src=x onerror="alert(1)">\n:::\n\n:::steps\n### One\n<script>alert(1)</script>\n:::',
      );

      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    test.each([
      MarkdownContentType.Blog,
      MarkdownContentType.Email,
      MarkdownContentType.BlogValidation,
    ])(
      "content type %s reads ':::' as text",
      async (type: MarkdownContentType) => {
        const html: string = await Markdown.convertToHTML(
          ":::steps\n### One\nx\n:::\n\n> [!NOTE]\n> y",
          type,
        );

        expect(html).not.toContain("docs-steps");
        expect(html).not.toContain("docs-callout");
        expect(html).toContain(":::steps");
      },
    );
  });
});
