import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";

/*
 * slugify turns a heading into the `id` the docs renderer emits, and therefore
 * into the target every in-page `](#anchor)` link has to match. These tests pin
 * the two properties that are easy to break by accident:
 *
 *   - non-ASCII scripts must survive (they used to be stripped to an empty id,
 *     which silently 404'd every anchor in the ru/ja/ko/hi/zh docs), and
 *   - existing English ids must not move, because they are published URLs.
 */
describe("Markdown.slugify", () => {
  describe("English headings keep their existing ids", () => {
    test.each([
      [
        "Reducing the Volume of Data Collected",
        "reducing-the-volume-of-data-collected",
      ],
      ["Filtering by Log Severity", "filtering-by-log-severity"],
      ["Step 1 — Install the Collector", "step-1-install-the-collector"],
      ["What's New?", "whats-new"],
      ["Namespace Filtering", "namespace-filtering"],
    ])("%s", (heading: string, expected: string) => {
      expect(Markdown.slugify(heading)).toBe(expected);
    });
  });

  /*
   * \p{L}/\p{N} do not match "_", so it is listed explicitly in the character
   * class. The old `\w` matched it. These are real headings — dropping the
   * underscore would change ids that are already linked to.
   */
  describe("underscores are preserved", () => {
    test.each([
      [
        "`ceph_health_status` is 1 but no incident fires",
        "ceph_health_status-is-1-but-no-incident-fires",
      ],
      [
        "Counters like `pve_network_receive_bytes` only ever grow",
        "counters-like-pve_network_receive_bytes-only-ever-grow",
      ],
    ])("%s", (heading: string, expected: string) => {
      expect(Markdown.slugify(heading)).toBe(expected);
    });
  });

  describe("non-Latin scripts produce a usable id, not an empty one", () => {
    test.each([
      ["Фильтрация по важности логов", "фильтрация-по-важности-логов"],
      ["ログの重大度によるフィルタリング", "ログの重大度によるフィルタリング"],
      ["按日志严重性过滤", "按日志严重性过滤"],
      ["로그 심각도별 필터링", "로그-심각도별-필터링"],
      [
        "लॉग गंभीरता के अनुसार फ़िल्टर करना",
        "लॉग-गंभीरता-के-अनुसार-फ़िल्टर-करना",
      ],
    ])("%s", (heading: string, expected: string) => {
      const slug: string = Markdown.slugify(heading);
      expect(slug).not.toBe("");
      expect(slug).toBe(expected);
    });
  });

  describe("accented Latin keeps the accented letter", () => {
    test.each([
      [
        "Filtrage par gravité des journaux",
        "filtrage-par-gravité-des-journaux",
      ],
      [
        "Reduktion af mængden af indsamlede data",
        "reduktion-af-mængden-af-indsamlede-data",
      ],
      ["Fehlerbehebung für Größen", "fehlerbehebung-für-größen"],
    ])("%s", (heading: string, expected: string) => {
      expect(Markdown.slugify(heading)).toBe(expected);
    });
  });

  describe("markup and punctuation are still stripped", () => {
    test("strips inline HTML tags", () => {
      expect(Markdown.slugify("A <em>heading</em> here")).toBe(
        "a-heading-here",
      );
    });

    test("strips HTML entities", () => {
      expect(Markdown.slugify("Tom &amp; Jerry")).toBe("tom-jerry");
    });

    test("strips punctuation but keeps hyphens", () => {
      expect(Markdown.slugify("Set up SSO (SAML): step-by-step!")).toBe(
        "set-up-sso-saml-step-by-step",
      );
    });

    test("collapses whitespace runs and trims leading/trailing hyphens", () => {
      expect(Markdown.slugify("  spaced   out  ")).toBe("spaced-out");
    });

    test("emoji are dropped rather than becoming part of the id", () => {
      expect(Markdown.slugify("🚀 Getting Started")).toBe("getting-started");
    });
  });
});

/*
 * THE EMAIL RENDERER.
 *
 * Until this suite existed there was no coverage of convertToHTML at all,
 * for any content type — and the email renderer was a bare `new Renderer()`,
 * so marked's stock output went straight into the message. That mattered
 * most for the alert and incident root cause, which carries a
 * GitHub-flavoured table of breaching samples: it arrived as a naked
 * <table> with no borders and no padding, every row running into the next.
 *
 * Two properties are load-bearing and easy to break:
 *
 *  - the styling must be INLINE. MailService compiles the Handlebars
 *    template and hands the string to nodemailer with no CSS-inlining step
 *    anywhere in the pipeline, and Gmail strips <style> from the head, so a
 *    class name reaches the reader as nothing at all.
 *  - raw HTML a user typed must still be escaped. convertToHTML overrides
 *    `renderer.html` for exactly that, on a renderer every email shares.
 */
describe("Markdown.convertToHTML - email renderer", () => {
  const TABLE_MARKDOWN: string = [
    "| Timestamp | Value |",
    "| --- | --- |",
    "| `2026-08-14T10:30:00.000Z` | 1.07 GB |",
  ].join("\n");

  test("renders a GFM table with inline styles, not class names", async () => {
    const html: string = await Markdown.convertToHTML(
      TABLE_MARKDOWN,
      MarkdownContentType.Email,
    );

    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("border-collapse:collapse");
    expect(html).toContain("padding:8px 10px");

    /*
     * A class would be dead weight: nothing inlines CSS before send and
     * Gmail drops the <style> block Style.hbs emits.
     */
    expect(html).not.toContain('class="');
  });

  test("the table carries the legacy attributes Outlook honours over CSS", async () => {
    const html: string = await Markdown.convertToHTML(
      TABLE_MARKDOWN,
      MarkdownContentType.Email,
    );

    expect(html).toContain('cellpadding="0"');
    expect(html).toContain('cellspacing="0"');
    expect(html).toContain('border="0"');
    expect(html).toContain('width="100%"');
  });

  /*
   * The DetailBox card leaves roughly 416px of usable width and a
   * root-cause table routinely runs to four or more columns, so a long
   * metric name has to wrap inside its column rather than push the table
   * past the body width. Email clients ignore overflow, so there is no
   * scrollbar to fall back on.
   */
  test("cells wrap long words rather than overflowing the card", async () => {
    const html: string = await Markdown.convertToHTML(
      TABLE_MARKDOWN,
      MarkdownContentType.Email,
    );

    expect(html).toContain("word-break:break-word");
    expect(html).not.toContain("overflow-x");
  });

  test("header cells are distinguishable from body cells", async () => {
    const html: string = await Markdown.convertToHTML(
      TABLE_MARKDOWN,
      MarkdownContentType.Email,
    );

    const header: string = html.slice(
      html.indexOf("<thead>"),
      html.indexOf("</thead>"),
    );
    const body: string = html.slice(html.indexOf("<tbody>"));

    expect(header).toContain("font-weight:600");
    expect(header).toContain("background-color:#f8fafc");
    expect(body).not.toContain("background-color:#f8fafc");
  });

  test("column alignment from the markdown survives", async () => {
    const html: string = await Markdown.convertToHTML(
      ["| A | B |", "| ---: | :--- |", "| 1 | 2 |"].join("\n"),
      MarkdownContentType.Email,
    );

    expect(html).toContain("text-align:right");
    expect(html).toContain("text-align:left");
  });

  // The root cause backticks every metric name, alias and timestamp.
  test("inline code is styled and its content preserved", async () => {
    const html: string = await Markdown.convertToHTML(
      "Metric `k8s.pod.memory.usage` breached",
      MarkdownContentType.Email,
    );

    expect(html).toContain("<code");
    expect(html).toContain("background-color:#f1f5f9");
    expect(html).toContain("k8s.pod.memory.usage");
  });

  test("code content is escaped rather than left live", async () => {
    const html: string = await Markdown.convertToHTML(
      "Metric `<img src=x onerror=alert(1)>` breached",
      MarkdownContentType.Email,
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  /*
   * The reason the DetailBoxField contract permits this output on a raw
   * slot at all: convertToHTML escapes the raw-HTML tokens a user typed
   * while letting the renderer's own tags through.
   */
  test("raw HTML typed into the markdown source is escaped", async () => {
    const html: string = await Markdown.convertToHTML(
      'Hello <img src=x onerror="alert(1)"> world',
      MarkdownContentType.Email,
    );

    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;img");
  });

  test("bold and links still render, so the rest of the email is unchanged", async () => {
    const html: string = await Markdown.convertToHTML(
      "**Filter Conditions Met**: see [the dashboard](https://example.com)",
      MarkdownContentType.Email,
    );

    expect(html).toContain("<strong>Filter Conditions Met</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  /*
   * The renderer is memoised in a static field and convertToHTML reassigns
   * `renderer.html` on it for every call, so any per-call state would leak
   * between emails. Rendering twice must be identical.
   */
  test("repeated renders are identical", async () => {
    const first: string = await Markdown.convertToHTML(
      TABLE_MARKDOWN,
      MarkdownContentType.Email,
    );
    const second: string = await Markdown.convertToHTML(
      TABLE_MARKDOWN,
      MarkdownContentType.Email,
    );

    expect(second).toBe(first);
  });

  test("an empty root cause does not throw", async () => {
    await expect(
      Markdown.convertToHTML("", MarkdownContentType.Email),
    ).resolves.toBe("");
  });
});

describe("Markdown.escapeHtml", () => {
  /*
   * Public so that code hand-building an email fragment by string
   * interpolation escapes the same way marked's own path does.
   */
  test("escapes the five characters that break out of HTML", () => {
    expect(Markdown.escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  test("escapes the ampersand first, so entities are not double-encoded wrongly", () => {
    expect(Markdown.escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  test("leaves ordinary text alone", () => {
    expect(Markdown.escapeHtml("web-7d9f / prod")).toBe("web-7d9f / prod");
  });
});
