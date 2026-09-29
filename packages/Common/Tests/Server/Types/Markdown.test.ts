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
 * most for the alert and incident root cause, which then carried a
 * GitHub-flavoured table of breaching samples: it arrived as a naked
 * <table> with no borders and no padding, every row running into the next.
 * (Those samples are a list now; tables typed into markdown remain.)
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

/*
 * Lists in the email renderer.
 *
 * A platform monitor's root cause lists its affected resources as a
 * numbered list with a bullet list of details nested under each item (see
 * AffectedResourceList). Unstyled, Gmail and Apple Mail indent each level
 * by 40px — close to a tenth of the card, twice over when nested — and
 * Outlook ignores padding on <ul>/<ol> altogether. So lists carry inline
 * styles that indent with margin-left and zero the padding.
 */
describe("Markdown.convertToHTML - email renderer lists", () => {
  const AFFECTED_RESOURCES: string = [
    "**Affected Resources** (2 total)",
    "",
    "1. **Pod** `checkout-7d9f` — **3**",
    "   - Namespace: `payments`",
    "   - Node: `gke-prod-pool-1`",
    "2. **Pod** `ledger-0` — **2**",
    "   - Namespace: `payments`",
  ].join("\n");

  test("ordered and bullet lists carry inline styles, not class names", async () => {
    const html: string = await Markdown.convertToHTML(
      AFFECTED_RESOURCES,
      MarkdownContentType.Email,
    );

    expect(html).toContain(
      '<ol style="margin:6px 0 12px 0;margin-left:32px;margin-inline-start:32px;margin-inline-end:0;padding:0;">',
    );
    expect(html).toContain(
      '<ul style="margin:6px 0 12px 0;margin-left:24px;margin-inline-start:24px;margin-inline-end:0;padding:0;">',
    );
    expect(html).toContain('<li style="margin:0 0 4px;padding:0;">');
    expect(html).not.toContain('class="');
    expect(html).not.toMatch(/<(ol|ul|li)>/);
  });

  /*
   * Outlook's Word engine ignores padding on lists but honours margin, so
   * the indent must live in margin-left for the marker to have room.
   */
  test("the indent is a margin, with the padding zeroed for Outlook", async () => {
    const html: string = await Markdown.convertToHTML(
      "- one\n- two",
      MarkdownContentType.Email,
    );

    expect(html).toMatch(/<ul style="[^"]*margin-left:24px;[^"]*padding:0;/);
    expect(html).not.toContain("padding-left");
    expect(html).not.toContain("40px");
  });

  /*
   * A numbered marker is wider than a bullet: "100." needs about 30px at
   * the card's 15px body size, so an ordered list gets the wider indent.
   */
  test("an ordered list is indented enough for a three-digit marker", async () => {
    const html: string = await Markdown.convertToHTML(
      "100. step\n101. step",
      MarkdownContentType.Email,
    );

    expect(html).toContain('<ol start="100" style="');
    expect(html).toContain("margin-left:32px;");
  });

  /*
   * margin-left is physical: in right-to-left text the marker sits on the
   * right, so the indent has to move there. The logical properties come
   * AFTER margin-left so a client that understands them overrides it (the
   * trailing margin-inline-end:0 cancels the left margin in RTL), and a
   * client that does not simply keeps margin-left.
   */
  test("lists carry logical margins after the physical one, for right-to-left text", async () => {
    const html: string = await Markdown.convertToHTML(
      "1. one\n   - nested",
      MarkdownContentType.Email,
    );

    expect(html).toMatch(
      /<ol style="[^"]*margin-left:32px;margin-inline-start:32px;margin-inline-end:0;/,
    );
    expect(html).toMatch(
      /<ul style="[^"]*margin-left:24px;margin-inline-start:24px;margin-inline-end:0;/,
    );
  });

  test("each item's details are a list nested inside that item", async () => {
    const html: string = await Markdown.convertToHTML(
      AFFECTED_RESOURCES,
      MarkdownContentType.Email,
    );

    expect(html).toMatch(
      /<ol [^>]*><li [^>]*><strong>Pod<\/strong> <code[^>]*>checkout-7d9f<\/code> — <strong>3<\/strong><ul [^>]*><li [^>]*>Namespace: <code[^>]*>payments<\/code><\/li><li [^>]*>Node: <code[^>]*>gke-prod-pool-1<\/code><\/li><\/ul><\/li><li [^>]*><strong>Pod<\/strong> <code[^>]*>ledger-0<\/code>/,
    );
    expect((html.match(/<ol /g) || []).length).toBe(1);
    expect((html.match(/<ul /g) || []).length).toBe(2);
    expect((html.match(/<li /g) || []).length).toBe(5);
  });

  test("an ordered list that does not start at 1 keeps its start number", async () => {
    const html: string = await Markdown.convertToHTML(
      "3. third\n4. fourth",
      MarkdownContentType.Email,
    );

    expect(html).toContain('<ol start="3" style="');
  });

  test("a list starting at 1 has no start attribute", async () => {
    const html: string = await Markdown.convertToHTML(
      "1. first\n2. second",
      MarkdownContentType.Email,
    );

    expect(html).not.toContain("start=");
  });

  test("a bullet list never gets a start attribute", async () => {
    const html: string = await Markdown.convertToHTML(
      "- a\n- b",
      MarkdownContentType.Email,
    );

    expect(html).not.toContain("start=");
  });

  test("task-list checkboxes still render inside their item", async () => {
    const html: string = await Markdown.convertToHTML(
      "- [x] done\n- [ ] todo",
      MarkdownContentType.Email,
    );

    expect(html).toMatch(
      /<li [^>]*><input checked="" disabled="" type="checkbox"> done<\/li>/,
    );
    expect(html).toMatch(
      /<li [^>]*><input disabled="" type="checkbox"> todo<\/li>/,
    );
  });

  test("raw HTML inside a list item is still escaped", async () => {
    const html: string = await Markdown.convertToHTML(
      '- <img src=x onerror="alert(1)">',
      MarkdownContentType.Email,
    );

    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;img");
  });

  test("repeated list renders are identical", async () => {
    const first: string = await Markdown.convertToHTML(
      AFFECTED_RESOURCES,
      MarkdownContentType.Email,
    );
    const second: string = await Markdown.convertToHTML(
      AFFECTED_RESOURCES,
      MarkdownContentType.Email,
    );

    expect(second).toBe(first);
  });

  /*
   * The list styling belongs to the email renderer alone; the docs and
   * blog renderers keep their own Tailwind classes.
   */
  test("the docs renderer does not pick up the email list styles", async () => {
    const html: string = await Markdown.convertToHTML(
      "- one\n- two",
      MarkdownContentType.Docs,
    );

    expect(html).not.toContain("margin-inline-start");
    expect(html).not.toContain("margin:6px 0 12px 0");
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

/*
 * PLAIN TEXT FOR SMS, CALLS, PUSH, EMAIL SUBJECTS AND PREHEADERS.
 *
 * convertToPlainText used to remove emphasis, links and HTML tags BEFORE it
 * removed code, and its `_([^_]+)_` crossed newlines. So the "_" inside a
 * code span like `http.status_code` paired with the "_" that opens a later
 * _italic_ footnote, and both were deleted: an alert root cause reached the
 * reader as "http.statuscode: 503 ... breaching samples._". Snake_case
 * outside code (TARGET_UNREACHABLE, a table header of OpenTelemetry keys)
 * and `<pod>` placeholders inside code were mangled the same way.
 *
 * These tests pin that code, identifiers and escaped characters reach the
 * reader literally, that a single * or _ only pairs on one line, and that
 * ordinary markdown still comes out as it did.
 */
describe("Markdown.convertToPlainText", () => {
  test("keeps the underscore in a code span that comes before an italic note", () => {
    const rootCause: string = [
      "1. `2026-08-14T10:30:00.000Z` — **5**",
      "   - `http.status_code`: `503`",
      "",
      "_Showing the first 20 of 25 breaching samples._",
    ].join("\n");

    expect(Markdown.convertToPlainText(rootCause)).toBe(
      [
        "2026-08-14T10:30:00.000Z — 5",
        "http.status_code: 503",
        "Showing the first 20 of 25 breaching samples.",
      ].join("\n"),
    );
  });

  /*
   * Shapes the root-cause and description builders really emit: the
   * breaching-samples ranked list (MonitorCriteriaEvaluator) and the table it
   * replaced, which root causes already stored on incidents still carry,
   * AffectedResourceList and its code() fences, escapeMarkdownInline
   * headings, and the K8s/Ceph templates' <placeholder> commands.
   */
  describe("real producer shapes", () => {
    test.each([
      [
        "reported repro with CRLF line endings",
        "1. `2026-08-14T10:30:00.000Z` — **5**\r\n   - `http.status_code`: `503`\r\n\r\n_Showing the first 20 of 25 breaching samples._",
        "2026-08-14T10:30:00.000Z — 5\nhttp.status_code: 503\nShowing the first 20 of 25 breaching samples.",
      ],
      [
        "GFM table header of raw attribute keys",
        "| Timestamp | Metric | Value | http.status_code | k8s.pod_name |",
        "| Timestamp | Metric | Value | http.status_code | k8s.pod_name |",
      ],
      [
        "a stored breaching-samples table with its italic footnote",
        "**Breaching Samples**\n3 of 10 samples breached the threshold.\n\n| Timestamp | Metric | Alias | Value | http.status_code | k8s.pod_name |\n| --- | --- | --- | --- | --- | --- |\n| `2026-08-14T10:30:00.000Z` | `http.server.duration` | - | 512 ms | 503 | web_1 |\n\n_Showing the first 1 of 3 breaching samples._",
        "Breaching Samples\n3 of 10 samples breached the threshold.\n| Timestamp | Metric | Alias | Value | http.status_code | k8s.pod_name |\n| --- | --- | --- | --- | --- | --- |\n| 2026-08-14T10:30:00.000Z | http.server.duration | - | 512 ms | 503 | web_1 |\nShowing the first 1 of 3 breaching samples.",
      ],
      [
        "table rows: a stray backtick in one row never pairs with the next row's code span",
        "| ts | v | pod |\n| --- | --- | --- |\n| `t1` | 5 | web`1 |\n| `t2` | 6 | web_2 |",
        "| ts | v | pod |\n| --- | --- | --- |\n| t1 | 5 | web`1 |\n| t2 | 6 | web_2 |",
      ],
      [
        "table rows: stray backticks in two rows stay literal and emphasis still works",
        "| ts | v | msg |\n| --- | --- | --- |\n| `t1` | 5 | it`s *bad* |\n| `t2` | 6 | isn`t _ok_ |",
        "| ts | v | msg |\n| --- | --- | --- |\n| t1 | 5 | it`s bad |\n| t2 | 6 | isn`t ok |",
      ],
      [
        "Filters list with a backtick inside a value",
        "- Filters:\n  - `log.message` = `it`s down`\n  - `service.name` = `check_out`\n  - `k8s.pod.name` = `api_1`",
        "Filters:\nlog.message = its down`\nservice.name = check_out\nk8s.pod.name = api_1",
      ],
      [
        "formula inside a code span keeps its * and _",
        "- Formula: `(current_replicas / max_replicas) * 100`",
        "Formula: (current_replicas / max_replicas) * 100",
      ],
      [
        "filter values with a trailing wildcard",
        "  - `k8s.namespace.name` = `kube_system`\n  - `service.name` = `checkout_*`",
        "k8s.namespace.name = kube_system\nservice.name = checkout_*",
      ],
      [
        "AffectedResourceList render output (AffectedResourceList.test.ts:394 lines)",
        "\n\n**Affected Resources** (5 total)\n\n1. **Pod** `pod-1` — **99**\n   - Namespace: `ns-1`\n   - Node: `node-1`\n2. **Pod** `pod-2` — **98**\n   - Namespace: `ns-2`\n   - Node: `node-2`\n\n*... and 3 more affected resources*",
        "Affected Resources (5 total)\nPod pod-1 — 99\nNamespace: ns-1\nNode: node-1\nPod pod-2 — 98\nNamespace: ns-2\nNode: node-2\n... and 3 more affected resources",
      ],
      [
        "AffectedResourceList.code(): double-backtick fence around a name with a backtick",
        "Pod `` web`01 `` — **99**",
        "Pod web`01 — 99",
      ],
      [
        "AffectedResourceList.code(): triple-backtick fence inline",
        "1. **Virtual Machine** ``` a``b ```",
        "Virtual Machine a``b",
      ],
      [
        "AffectedResourceList.code(): markdown inside a name stays literal",
        "3. **Virtual Machine** `` vm` **pwned** [x](https://evil.example) `` — **1**",
        "Virtual Machine vm` **pwned** [x](https://evil.example) — 1",
      ],
      [
        "escapeMarkdownInline output in a bold heading",
        "**Affected \\*Disks\\* \\(by\\_mount\\)** (4 total)",
        "Affected *Disks* (by_mount) (4 total)",
      ],
      [
        "K8s root-cause fallback placeholders inside code spans",
        "`<pod>` restarted; run `kubectl logs <pod-name> -c <container>`",
        "<pod> restarted; run kubectl logs <pod-name> -c <container>",
      ],
      [
        "Ceph template commands with placeholders",
        "Run `rados list-inconsistent-pg <pool>` then `ceph pg repair <pg.id>`.",
        "Run rados list-inconsistent-pg <pool> then ceph pg repair <pg.id>.",
      ],
      [
        "preheader fixture (SendCreatedResourceNotification.test.ts)",
        "A **bad deploy** saturated the queue",
        "A bad deploy saturated the queue",
      ],
      [
        "website root cause: SCREAMING_SNAKE_CASE outside code",
        "The probe returned TARGET_UNREACHABLE; set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true to allow it.",
        "The probe returned TARGET_UNREACHABLE; set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true to allow it.",
      ],
    ])("%s", (_name: string, input: string, expected: string) => {
      expect(Markdown.convertToPlainText(input)).toBe(expected);
    });
  });

  /*
   * Code is held back before every other step and comes back literally,
   * without its backticks. A span closes on the next run of the same number
   * of backticks ON THE SAME LINE (CommonMark run matching), so a stray
   * backtick can never pair with a span on another line or table row.
   */
  describe("code spans are opaque to every other step", () => {
    test.each([
      [
        "several code spans with underscores",
        "`a_1` + `b_2` = `c_3`",
        "a_1 + b_2 = c_3",
      ],
      ["double-backtick span containing a backtick", "``a`b``", "a`b"],
      [
        "double-backtick span with padding around a backticked word",
        "`` `vm` ``",
        "`vm`",
      ],
      [
        "code that looks like block markup",
        "`# not a header` and `- x`",
        "# not a header and - x",
      ],
      [
        "entities inside code stay literal",
        "`a &amp; b` and Tom &amp; Jerry",
        "a &amp; b and Tom & Jerry",
      ],
      ["strikethrough around a code span containing ~~", "~~`a~~b`~~", "a~~b"],
      [
        "emphasis wrapped around code",
        "**`http.status_code`** and _`k8s.pod_name`_ and *`a_b`*",
        "http.status_code and k8s.pod_name and a_b",
      ],
      [
        "link syntax inside code stays literal",
        "`[a](b)` then [c](d)",
        "[a](b) then c",
      ],
      [
        "dunder name in code vs in prose",
        "`__init__.py` and __init__.py",
        "__init__.py and init.py",
      ],
      [
        "angle-bracket generic around a code span is not a tag",
        "Returned Map<String, `k8s.pod_name`> from handler",
        "Returned Map<String, k8s.pod_name> from handler",
      ],
      [
        "comparison prose around code spans",
        "p99 latency < 500ms for `http.route` = `/checkout` (SLO > 99.9%)",
        "p99 latency < 500ms for http.route = /checkout (SLO > 99.9%)",
      ],
      [
        "two stray backticks on one line do not glue words",
        "Don't paste the ` character into the field. It's `broken for now.",
        "Don't paste the character into the field. It's broken for now.",
      ],
      [
        "single-backtick span keeps its padding",
        "(` x `) and x` a `y",
        "( x ) and x a y",
      ],
      [
        "a code span that wraps onto the next line keeps its backticks",
        "Run `kubectl get\npods -n payments` now",
        "Run `kubectl get\npods -n payments` now",
      ],
      [
        "an unclosed backtick does not shift later pairings",
        "Use `foo\n\nthen `bar_baz` and `qux`",
        "Use `foo\nthen bar_baz and qux",
      ],
      [
        "stray backtick at line end, code on the next line",
        "value `\nnext `x_y` _z_",
        "value `\nnext x_y z",
      ],
      ["unmatched backtick runs stay literal", "``a` b", "``a` b"],
      ["escaped backtick cannot open a span", "a\\`b `c`", "a`b c"],
    ])("%s", (_name: string, input: string, expected: string) => {
      expect(Markdown.convertToPlainText(input)).toBe(expected);
    });
  });

  /*
   * Fenced blocks are still dropped whole, but first, and only real ones: a
   * fence opens at the start of a line and closes on a line holding a fence
   * of the same character at least as long. An unclosed fence is text.
   */
  describe("fenced code blocks", () => {
    test.each([
      [
        "fenced block dropped; its underscore cannot pair with the next line",
        "```\nfoo_bar\n```\n_note_",
        "note",
      ],
      [
        "inline triple-backtick span before a real fence",
        "Run ```npm install``` first\n\nThen:\n\n```\nnpm test\n```\n\nDone _now_.",
        "Run npm install first\nThen:\nDone now.",
      ],
      [
        "two inline triple-backtick spans on different lines",
        "Use ```x``` and\nmore text here\nand ```y```",
        "Use x and\nmore text here\nand y",
      ],
      [
        "code() name then a SeriesDebugHints fence",
        "Affected: ``` a``b ```\n\n**Start here**\n\n```\nkubectl get pods\n```\n\nAfter.",
        "Affected: a``b\nStart here\nAfter.",
      ],
      [
        "unclosed fence keeps the rest and processes it",
        "```bash\nkubectl get pods\n\nThanks, _SRE team_",
        "```bash\nkubectl get pods\nThanks, SRE team",
      ],
      [
        "fence-shaped first line with text is not lost",
        "``` Deploy failed on web_1\nPlease check **logs**.",
        "``` Deploy failed on web_1\nPlease check logs.",
      ],
      [
        "tilde fence dropped",
        "Intro\n~~~\nfoo_bar ~~x~~\n~~~\nOutro",
        "Intro\nOutro",
      ],
      ["tilde fence then italic", "~~~\ncode_x\n~~~\n_a_", "a"],
      [
        "four-backtick fence closes only on four or more",
        "````\ncode ``` still code\n```\n````\nafter",
        "after",
      ],
      ["quoted fence", "> ```\n> code_x\n> ```\n> _after_", "after"],
      [
        "indented fence inside a numbered list",
        "1. Step\n   ```\n   kubectl get pods\n   ```\n2. Next",
        "Step\nNext",
      ],
      [
        "malformed fence opened mid-line is shown, not dropped",
        "Text ```\ncode\n```",
        "Text ```\ncode\n```",
      ],
      /*
       * A fence opened on a list-marker line. If "1. ```bash" were not an
       * opener, its indented closer would open a block of its own and
       * swallow the prose items up to the next fence.
       */
      [
        "fences opened on numbered list items keep the prose item between them",
        "Remediation steps:\n\n1. ```bash\n   kubectl rollout undo deploy/checkout_api\n   ```\n2. Scale **checkout_api** back to 6 replicas.\n3. ```bash\n   kubectl get pods -n payments\n   ```\n\nWe will post another update by 14:00 UTC.",
        "Remediation steps:\nScale checkout_api back to 6 replicas.\nWe will post another update by 14:00 UTC.",
      ],
      [
        "a fence opened on a bullet keeps the bullets after it",
        "Steps:\n- ```bash\n  kubectl get pods\n  ```\n- Check the logs\n- Restart the pod\n\n```\nkubectl rollout restart\n```\nDone.",
        "Steps:\nCheck the logs\nRestart the pod\nDone.",
      ],
      [
        "a fence opened on a quoted bullet",
        "> - ```\n>   code_x\n>   ```\n> - _after_",
        "after",
      ],
      [
        "an inline triple-backtick span on a bullet is not a fence",
        "- run ```npm ci``` first\n- then test",
        "run npm ci first\nthen test",
      ],
      [
        "a dropped fence still separates paragraphs",
        "**a\n```\nx\n```\nb**",
        "**a\nb**",
      ],
    ])("%s", (_name: string, input: string, expected: string) => {
      expect(Markdown.convertToPlainText(input)).toBe(expected);
    });
  });

  /*
   * A marker has to flank text: an opener is followed by a non-space and a
   * closer comes right after one. A single * or _ never pairs across a line
   * break; ** __ and ~~ may wrap onto the next line but never cross a blank
   * line.
   */
  describe("emphasis bounds and flanking", () => {
    test.each([
      [
        "single-character emphasis never crosses a line",
        "_a\nb_ and *c\nd*",
        "_a\nb_ and *c\nd*",
      ],
      ["bold may wrap onto the next line", "**open\nclose**", "open\nclose"],
      [
        "bold never crosses a blank line",
        "**open\n\nclose**",
        "**open\nclose**",
      ],
      [
        "wrapped bold keeps an identifier",
        "**Pod api_1\nrestarted**",
        "Pod api_1\nrestarted",
      ],
      [
        "star bullets on consecutive lines",
        "* item one\n* item two",
        "item one\nitem two",
      ],
      [
        "star bullets with bold labels and italics",
        "* **Status**: *monitoring*\n* **Owner**: *sre*",
        "Status: monitoring\nOwner: sre",
      ],
      [
        "star bullets mixing bold and italic",
        "* bullet with *x*\n* another bullet with **bold** and *italic*\n* plain bullet",
        "bullet with x\nanother bullet with bold and italic\nplain bullet",
      ],
      [
        "nested star bullets under a numbered list",
        "1. First step\n2. Second step\n   * nested star\n   * another *italic* nested",
        "First step\nSecond step\nnested star\nanother italic nested",
      ],
      ["spaced multiplication is not emphasis", "5 * 3 * 2", "5 * 3 * 2"],
      ["globs are not emphasis", "rm *.log and *.tmp", "rm *.log and *.tmp"],
      [
        "trailing star then a star bullet",
        "Latency p99* exceeded\n\n* measured at edge",
        "Latency p99* exceeded\nmeasured at edge",
      ],
      [
        "intraword stars pair as in CommonMark",
        "Capacity is 5 * 3 = 15 nodes; each node handles 2*1024 connections, so 15*2048 total.",
        "Capacity is 5 * 3 = 15 nodes; each node handles 21024 connections, so 152048 total.",
      ],
      [
        "every delimiter kind",
        "**bold** and __bold__ and *it* and _it_ and ~~gone~~",
        "bold and bold and it and it and gone",
      ],
      ["bold italic", "***bold italic***", "bold italic"],
      ["italic nested in bold", "**a *b* c**", "a b c"],
      ["strikethrough never crosses a blank line", "~~a\n\nb~~", "~~a\nb~~"],
      ["__ never crosses a blank line", "__open\n\nclose__", "__open\nclose__"],
      ["underscore bold around underscore italic", "__a _b_ c__", "a b c"],
      ["lone markers stay", "** __ _ * ` ~~", "** __ _ * ` ~~"],
    ])("%s", (_name: string, input: string, expected: string) => {
      expect(Markdown.convertToPlainText(input)).toBe(expected);
    });
  });

  /*
   * As in CommonMark, an underscore between two letters or digits is never
   * emphasis, and a run with a letter on its outer side cannot open or
   * close. Marks count as letters, so a combining accent or an Indic vowel
   * sign does not split a word.
   */
  describe("intraword underscores are literal", () => {
    test.each([
      [
        "snake_case and dunder in prose",
        "Set max_retry_count and __init__ runs",
        "Set max_retry_count and init runs",
      ],
      [
        "italic around a snake_case identifier",
        "_see k8s.pod_name_",
        "see k8s.pod_name",
      ],
      [
        "metric and host names in prose",
        "The metric process_cpu_seconds_total on host web_1 crossed 90%.",
        "The metric process_cpu_seconds_total on host web_1 crossed 90%.",
      ],
      [
        "digit separators and a real italic",
        "1_000_000 requests and _5_ errors",
        "1_000_000 requests and 5 errors",
      ],
      [
        "Devanagari with combining marks",
        "_see नमस्ते_दुनिया_",
        "see नमस्ते_दुनिया",
      ],
      [
        "NFD e + combining acute",
        "_see cafe\u0301_menu_",
        "see cafe\u0301_menu",
      ],
      [
        "letter on one side only: cannot open",
        "Set type_=1 and id_=2",
        "Set type_=1 and id_=2",
      ],
      [
        "Kafka-style topic names",
        "Lag on __consumer_offsets and __consumer_offsets_v2",
        "Lag on __consumer_offsets and __consumer_offsets_v2",
      ],
      [
        "SCREAMING_SNAKE_CASE env vars",
        "Set FEATURE_FLAG_NEW_CHECKOUT and DB_POOL_MAX_SIZE",
        "Set FEATURE_FLAG_NEW_CHECKOUT and DB_POOL_MAX_SIZE",
      ],
      ["underscore after bold is judged on the source", "**bold**_x_", "boldx"],
      [
        "italic touching a link is judged on the source",
        "[link](https://x.io)_y_ and _see_[docs](https://x.io)",
        "linky and seedocs",
      ],
      ["italic touching an HTML tag is judged on the source", "a<br>_b_", "ab"],
    ])("%s", (_name: string, input: string, expected: string) => {
      expect(Markdown.convertToPlainText(input)).toBe(expected);
    });
  });

  describe("HTML, autolinks, links, bare URLs, escapes and entities", () => {
    test.each([
      ["HTML tags", "<p>Hello <strong>world</strong></p>", "Hello world"],
      ["comparison prose is not a tag", "a < b and c > d", "a < b and c > d"],
      [
        "latency comparison",
        "Latency < 200ms but CPU > 90%",
        "Latency < 200ms but CPU > 90%",
      ],
      [
        "Go nil in a log line",
        'Go returned err="<nil>" twice',
        'Go returned err="" twice',
      ],
      [
        "HTML comment spanning a blank line",
        "a <!-- note\n\nhidden --> b",
        "a b",
      ],
      [
        "autolinks keep their address",
        "See <https://x.example/a_b_c> or <on_call@example.com>",
        "See https://x.example/a_b_c or on_call@example.com",
      ],
      [
        "links, bold, strikethrough",
        "[link](https://x.com) and **bold** and ~~struck~~",
        "link and bold and struck",
      ],
      [
        "image before link: no leftover '!'",
        "![CPU_graph](http://x/a_b.png) and [`k8s.pod_name`](https://x/a_b)",
        "CPU_graph and k8s.pod_name",
      ],
      [
        "badge image inside a link",
        "[![build](https://ci.example.com/badge.svg)](https://ci.example.com)",
        "build",
      ],
      [
        "link URL with one pair of parentheses",
        "[docs](https://en.wikipedia.org/wiki/Foo_(bar)) here",
        "docs here",
      ],
      [
        "bare URL with _segment_ path parts",
        "See https://grafana.example.com/d/_abc_/cpu_usage?var_ns=prod now",
        "See https://grafana.example.com/d/_abc_/cpu_usage?var_ns=prod now",
      ],
      [
        "entities inside a bare URL are still decoded",
        "Dashboard: https://g.acme.com/d/x?from=now-1h&amp;to=now",
        "Dashboard: https://g.acme.com/d/x?from=now-1h&to=now",
      ],
      [
        "italic around a bare URL",
        "_see https://x.example/a_b_",
        "see https://x.example/a_b",
      ],
      [
        "bare URL in parentheses and a sentence",
        "(see https://x.example/a_b).",
        "(see https://x.example/a_b).",
      ],
      [
        "bold around a bare URL",
        "**Dashboard: https://x.example/d/a_b**",
        "Dashboard: https://x.example/d/a_b",
      ],
      ["backslash escapes", "a\\_b and \\*x\\*", "a_b and *x*"],
      [
        "backslash before a letter is kept",
        "Path C:\\Users\\app_data\\logs",
        "Path C:\\Users\\app_data\\logs",
      ],
      [
        "entities",
        "&lt;tag&gt; &amp; &quot;q&quot; &#39;s&#39;&nbsp;x",
        "<tag> & \"q\" 's' x",
      ],
      ["entities decode once", "&amp;quot;", "&quot;"],
      [
        "entities inside an autolink are decoded, as in a bare URL",
        "See <https://grafana.acme.com/d/x?var-a=1&amp;var-b=2> now",
        "See https://grafana.acme.com/d/x?var-a=1&var-b=2 now",
      ],
      [
        "an email autolink keeps its underscores",
        "Mail <_ops_@example.com> now",
        "Mail _ops_@example.com now",
      ],
      ["a tag never crosses a blank line", "a <b\n\nc> d", "a <b\nc> d"],
      [
        "an escaped character keeps a generic from being read as a tag",
        "Returned List<Foo\\_Bar> ok",
        "Returned List<Foo_Bar> ok",
      ],
    ])("%s", (_name: string, input: string, expected: string) => {
      expect(Markdown.convertToPlainText(input)).toBe(expected);
    });
  });

  describe("block markers, line endings and whitespace", () => {
    test.each([
      [
        "headings, quotes, rules and lists",
        "# Heading\n> quote\n---\n- a\n1. b",
        "Heading\nquote\na\nb",
      ],
      [
        "horizontal rules of each kind",
        "Resolved.\n\n---\n\nPrevious update:\n\n***\n\nInvestigating.\n\n___\n\nEnd.",
        "Resolved.\nPrevious update:\nInvestigating.\nEnd.",
      ],
      ["spaced horizontal rule", "Above\n\n* * *\n\nBelow", "Above\nBelow"],
      [
        "CRLF star list",
        "Line one\r\n\r\n* bullet_a is **down**\r\n* bullet_b is _up_\r\n\r\nEnd.",
        "Line one\nbullet_a is down\nbullet_b is up\nEnd.",
      ],
      ["a lone CR is a line break", "line one\rline two", "line one\nline two"],
      [
        "whitespace inside code collapses like the rest",
        "Run `a    b` now",
        "Run a b now",
      ],
      ["whitespace only", "   ", ""],
      ["empty string", "", ""],
    ])("%s", (_name: string, input: string, expected: string) => {
      expect(Markdown.convertToPlainText(input)).toBe(expected);
    });
  });

  /*
   * U+E000..U+E004 are the function's own placeholder and mark characters.
   * Any already in the input are held back first, so they come back
   * verbatim, cannot forge a placeholder, and do not act as marks.
   */
  describe("input that already contains the internal sentinel characters", () => {
    const OPEN: string = String.fromCharCode(0xe000);
    const CLOSE: string = String.fromCharCode(0xe001);
    const PARAGRAPH: string = String.fromCharCode(0xe002);
    const UNDERSCORE: string = String.fromCharCode(0xe003);
    const EDGE: string = String.fromCharCode(0xe004);

    test("a placeholder-shaped run cannot resolve to held code", () => {
      const forged: string = `${OPEN}0${CLOSE}`;

      expect(
        Markdown.convertToPlainText(
          `ab ${forged} \`c\` ${forged} _a_ ${PARAGRAPH}`,
        ),
      ).toBe(`ab ${forged} c ${forged} a ${PARAGRAPH}`);
    });

    test("a code span next to a look-alike keeps both", () => {
      expect(
        Markdown.convertToPlainText(`\`a_b\` ${OPEN}0${CLOSE} _x_ 0`),
      ).toBe(`a_b ${OPEN}0${CLOSE} x 0`);
    });

    test("the intraword stand-in stays itself instead of becoming _", () => {
      expect(Markdown.convertToPlainText(`a${UNDERSCORE}b _c_ d_e`)).toBe(
        `a${UNDERSCORE}b c d_e`,
      );
    });

    test("the word-edge mark neither blocks emphasis nor disappears", () => {
      expect(Markdown.convertToPlainText(`x${EDGE}_y_ and ${EDGE}`)).toBe(
        `x${EDGE}y and ${EDGE}`,
      );
    });

    test("the paragraph mark does not act as a paragraph break", () => {
      expect(Markdown.convertToPlainText(`**a ${PARAGRAPH} b**`)).toBe(
        `a ${PARAGRAPH} b`,
      );
    });
  });

  describe("input that is not a non-empty string", () => {
    test.each([
      ["null", null],
      ["undefined", undefined],
      ["an empty string", ""],
    ])("%s gives an empty string", (_label: string, input: unknown) => {
      expect(Markdown.convertToPlainText(input as string)).toBe("");
    });

    test("a number is stringified rather than crashing", () => {
      expect(Markdown.convertToPlainText(42 as unknown as string)).toBe("42");
    });
  });

  /*
   * Several of the old regexes were quadratic (50,000 "<" took about 15 s).
   * The new steps take milliseconds on all of these, so the bound is
   * deliberately loose: it only fails on a real blow-up, not on a slow CI
   * machine.
   */
  describe("adversarial input stays fast and never throws", () => {
    const BOUND_MS: number = 3000;

    interface AdversarialCase {
      name: string;
      build: () => string;
      // Null when only "does not throw, within the bound" is asserted.
      expected: (() => string) | null;
    }

    const ADVERSARIAL_CASES: Array<AdversarialCase> = [
      {
        name: "50,000 '<' with no '>'",
        build: (): string => {
          return "<".repeat(50000);
        },
        expected: (): string => {
          return "<".repeat(50000);
        },
      },
      {
        name: "50,000 unclosed '[a]('",
        build: (): string => {
          return "[a](".repeat(50000);
        },
        expected: (): string => {
          return "[a](".repeat(50000);
        },
      },
      {
        name: "50,000 whitespace-only lines",
        build: (): string => {
          return " \n".repeat(50000);
        },
        expected: (): string => {
          return "";
        },
      },
      {
        name: "20,000 fence lines",
        build: (): string => {
          return "```\n".repeat(20000);
        },
        expected: (): string => {
          return "";
        },
      },
      {
        name: "a line of 200,000 backticks then text",
        build: (): string => {
          return "`".repeat(200000) + " text";
        },
        expected: (): string => {
          return "`".repeat(200000) + " text";
        },
      },
      {
        name: "a backtick staircase where no run can close",
        build: (): string => {
          return Array.from({ length: 600 }, (_value: unknown, k: number) => {
            return "`".repeat((k % 40) + 1) + "a";
          }).join("");
        },
        expected: null,
      },
      {
        name: "100,000 intraword underscores",
        build: (): string => {
          return "a_".repeat(100000);
        },
        expected: (): string => {
          return "a_".repeat(100000);
        },
      },
      {
        name: "25,000 star bullets with italics",
        build: (): string => {
          return "* x *y*\n".repeat(25000);
        },
        expected: (): string => {
          return "x y\n".repeat(24999) + "x y";
        },
      },
      {
        name: "30,000 unclosed fence openers",
        build: (): string => {
          return "``` a\n".repeat(30000) + "b";
        },
        expected: (): string => {
          return "``` a\n".repeat(30000) + "b";
        },
      },
    ];

    test.each(ADVERSARIAL_CASES)("$name", (adversarial: AdversarialCase) => {
      const input: string = adversarial.build();
      const startedAt: number = Date.now();
      const output: string = Markdown.convertToPlainText(input);
      const elapsedMs: number = Date.now() - startedAt;

      expect(typeof output).toBe("string");
      expect(elapsedMs).toBeLessThan(BOUND_MS);

      if (adversarial.expected) {
        expect(output).toBe(adversarial.expected());
      }
    });

    /*
     * The emphasis regexes run without the u flag on purpose: with it, the
     * boldUnderscores loop over this 10 MB two-byte bold span overflows V8's
     * backtrack stack and throws RangeError (checked against a copy with /u
     * added). Only "does not throw" and the result are asserted, not the
     * time, which scales with the machine.
     */
    test("10 MB of two-byte bold text with intraword underscores does not throw", () => {
      const input: string = "__" + "a_b — ".repeat(1700000) + "x__";
      const output: string = Markdown.convertToPlainText(input);

      expect(output.startsWith("a_b — a_b — ")).toBe(true);
      expect(output.endsWith("a_b — x")).toBe(true);
    }, 120000);
  });

  /*
   * Seeded, so every run checks the same inputs and a failure reproduces.
   * The generators mix the markup characters that used to interact (_ * ` ~
   * < [ \ &) with identifiers, line breaks and non-Latin text.
   */
  describe("properties over generated input", () => {
    const RUNS: number = 3000;

    /*
     * A 32-bit linear congruential generator: deterministic and
     * dependency-free. Math.imul keeps the multiply exact; a plain "*" would
     * pass 2^53, lose the low bits and cycle after a few thousand draws.
     */
    function makeRandom(seed: number): () => number {
      let state: number = seed >>> 0;

      return (): number => {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        return state / 4294967296;
      };
    }

    function pick<T>(random: () => number, items: Array<T>): T {
      return items[Math.floor(random() * items.length)] as T;
    }

    function hasSentinel(text: string): boolean {
      for (let i: number = 0; i < text.length; i++) {
        const code: number = text.charCodeAt(i);

        if (code >= 0xe000 && code <= 0xe004) {
          return true;
        }
      }

      return false;
    }

    test("returns trimmed text with no carriage return and no leftover placeholder", () => {
      const random: () => number = makeRandom(7);
      const tokens: Array<string> = [
        "_",
        "__",
        "*",
        "**",
        "`",
        "``",
        "```",
        "~~",
        "~~~",
        "\n",
        "\n\n",
        "\r\n",
        "\r",
        " ",
        "\t",
        "a",
        "b_c",
        "<",
        ">",
        "<b>",
        "</b>",
        "[x](y)",
        "![i](u)",
        "\\",
        "\\_",
        "&amp;",
        "&lt;",
        "https://x.example/a_b",
        "# ",
        "> ",
        "- ",
        "1. ",
        "|",
        "5",
        "é",
        "न",
      ];

      for (let run: number = 0; run < RUNS; run++) {
        let input: string = "";
        const length: number = 1 + Math.floor(random() * 30);

        for (let i: number = 0; i < length; i++) {
          input += pick(random, tokens);
        }

        const output: string = Markdown.convertToPlainText(input);

        expect(output).toBe(output.trim());
        expect(output).not.toContain("\r");
        expect(hasSentinel(output)).toBe(false);
      }
    });

    test("a single-line code span always comes back literally", () => {
      const random: () => number = makeRandom(11);
      const codeCharacters: Array<string> =
        "_*~[]()<>&;#!/\\|=-+.: abcXYZ019".split("");
      const before: Array<string> = [
        "",
        "_note_ ",
        "**bold** ",
        "see http.status_code ",
        "*a* ",
        "~~x~~ ",
        "[l](https://x/a_b) ",
        "<b>",
        "a < b ",
        "&amp; ",
        "# ",
        "- ",
        "1. ",
        "> ",
      ];
      const after: Array<string> = [
        "",
        " _italic_",
        " **b**",
        " done_",
        " <i>x</i>",
        " > 5",
        " `other_code`",
        " *",
        " _",
      ];

      for (let run: number = 0; run < RUNS; run++) {
        let code: string = "";
        const length: number = 1 + Math.floor(random() * 20);

        for (let i: number = 0; i < length; i++) {
          code += pick(random, codeCharacters);
        }

        // Whitespace inside code collapses like everywhere else.
        const literal: string = code.replace(/[ \t]+/g, " ").trim();

        if (!literal) {
          continue;
        }

        const input: string = `${pick(random, before)}\`${code}\`${pick(random, after)}`;

        expect(Markdown.convertToPlainText(input)).toContain(literal);
      }
    });

    test("an intraword underscore is never removed", () => {
      const random: () => number = makeRandom(13);
      const wordParts: Array<string> = [
        "a",
        "b",
        "x1",
        "9",
        "http",
        "status",
        "code",
        "K8s",
        "é",
        "न",
      ];
      const before: Array<string> = [
        "",
        "_see ",
        "__",
        "**",
        "*",
        "the ",
        "_",
        "`x` _",
        "**x**_",
      ];
      const after: Array<string> = [
        "",
        "_",
        "__",
        " and _x_",
        ".",
        "*",
        "**",
        "_ done",
      ];

      for (let run: number = 0; run < RUNS; run++) {
        let identifier: string = pick(random, wordParts);
        const joins: number = 1 + Math.floor(random() * 3);

        for (let i: number = 0; i < joins; i++) {
          identifier += (random() < 0.8 ? "_" : "__") + pick(random, wordParts);
        }

        const input: string = `${pick(random, before)}${identifier}${pick(random, after)}`;

        expect(Markdown.convertToPlainText(input)).toContain(identifier);
      }
    });

    /*
     * A sentinel in the input must behave exactly like any other inert
     * character. Swapping each one for "%" (also not a letter, digit, space
     * or markup here) before or after conversion gives the same text. The
     * generator makes no HTML tags on purpose: a sentinel inside a tag keeps
     * the tag from being stripped, the same as held-back code does.
     */
    test("sentinel characters in the input are inert", () => {
      const random: () => number = makeRandom(17);
      const sentinels: Array<string> = [
        0xe000, 0xe001, 0xe002, 0xe003, 0xe004,
      ].map((code: number) => {
        return String.fromCharCode(code);
      });
      const tokens: Array<string> = [
        "_",
        "__",
        "*",
        "**",
        "`",
        "``",
        "~~",
        " ",
        "\n",
        "\n\n",
        "a",
        "b",
        "1",
        "x_y",
        "# ",
        "- ",
        "> ",
        "1. ",
        ...sentinels,
      ];

      const neutralize: (text: string) => string = (text: string): string => {
        return text
          .split("")
          .map((character: string) => {
            return sentinels.includes(character) ? "%" : character;
          })
          .join("");
      };

      for (let run: number = 0; run < RUNS; run++) {
        let input: string = "";
        const length: number = 1 + Math.floor(random() * 25);

        for (let i: number = 0; i < length; i++) {
          input += pick(random, tokens);
        }

        expect(neutralize(Markdown.convertToPlainText(input))).toBe(
          Markdown.convertToPlainText(neutralize(input)),
        );
      }
    });
  });
});
