import AffectedResourceList, {
  AffectedResourceListEntry,
} from "../../../../Server/Utils/Monitor/AffectedResourceList";
import Markdown, {
  MarkdownContentType,
} from "../../../../Server/Types/Markdown";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { marked, Tokens, Token } from "marked";

/*
 * AffectedResourceList renders the "Affected Resources" block of a platform
 * monitor's root cause. It replaced a GitHub-flavoured table that wrapped
 * into fragments in the email card, reached Slack as raw pipe rows (or
 * "_Row 1_" blocks) and let one long node name squeeze every other column
 * on the dashboard.
 *
 * These tests pin two things:
 *
 *   - the exact markdown — numbered items, a bold kind, the value at the
 *     end, labelled detail bullets indented to the item's content column,
 *     and the "... and N more" summary as its own paragraph,
 *   - that the markdown PARSES into that shape: a single ordered list whose
 *     items each own a nested bullet list, in marked (the email renderer),
 *     through slackify-markdown (Slack) and Markdown.convertToPlainText.
 *     A string that merely looks right can still parse as two lists or as
 *     an indented code block, and the reader would see the wreckage.
 */

function entry(
  overrides: Partial<AffectedResourceListEntry> = {},
): AffectedResourceListEntry {
  return {
    kind: "Pod",
    name: "`checkout-7d9f`",
    value: "**3**",
    details: [
      { label: "Namespace", value: "`payments`" },
      { label: "Deployment", value: "`checkout`" },
      { label: "Node", value: "`gke-prod-pool-1-abcd`" },
    ],
    ...overrides,
  };
}

function entries(count: number): Array<AffectedResourceListEntry> {
  const result: Array<AffectedResourceListEntry> = [];

  for (let i: number = 1; i <= count; i++) {
    result.push(
      entry({
        name: `\`pod-${i}\``,
        value: `**${100 - i}**`,
        details: [
          { label: "Namespace", value: `\`ns-${i}\`` },
          { label: "Node", value: `\`node-${i}\`` },
        ],
      }),
    );
  }

  return result;
}

function render(
  shown: Array<AffectedResourceListEntry>,
  totalCount?: number,
): string {
  return AffectedResourceList.render({
    heading: "Affected Resources",
    overflowNoun: "affected resources",
    totalCount: totalCount === undefined ? shown.length : totalCount,
    entries: shown,
  });
}

// The top-level block tokens marked produces, without the blank-line spacers.
function blocks(markdown: string): Array<Token> {
  return marked.lexer(markdown).filter((token: Token): boolean => {
    return token.type !== "space";
  });
}

function nestedList(item: Tokens.ListItem): Tokens.List | undefined {
  return item.tokens.find((token: Token): boolean => {
    return token.type === "list";
  }) as Tokens.List | undefined;
}

describe("AffectedResourceList.render - markdown", () => {
  test("renders one numbered item per resource with its details as nested bullets", () => {
    expect(render([entry()])).toBe(
      [
        "",
        "",
        "**Affected Resources** (1 total)",
        "",
        "1. **Pod** `checkout-7d9f` — **3**",
        "   - Namespace: `payments`",
        "   - Deployment: `checkout`",
        "   - Node: `gke-prod-pool-1-abcd`",
      ].join("\n"),
    );
  });

  test("starts with a blank line so it is its own block after the previous section", () => {
    const markdown: string = render([entry()]);

    expect(markdown.startsWith("\n\n**Affected Resources**")).toBe(true);
  });

  test("numbers items in the order given, which the caller sorts worst first", () => {
    const markdown: string = render(entries(3));

    const first: number = markdown.indexOf("1. **Pod** `pod-1` — **99**");
    const second: number = markdown.indexOf("2. **Pod** `pod-2` — **98**");
    const third: number = markdown.indexOf("3. **Pod** `pod-3` — **97**");

    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  test("never emits GFM table syntax", () => {
    const markdown: string = render(entries(10), 83);

    expect(markdown).not.toMatch(/^\s*\|/m);
    expect(markdown).not.toContain("| --- |");
    expect(markdown).not.toContain("---");
  });

  test("indents details to the item's content column: three spaces under 1-9, four under 10", () => {
    const markdown: string = render(entries(10));

    expect(markdown).toContain(
      "9. **Pod** `pod-9` — **91**\n   - Namespace: `ns-9`",
    );
    expect(markdown).toContain(
      "10. **Pod** `pod-10` — **90**\n    - Namespace: `ns-10`\n    - Node: `node-10`",
    );
  });

  test("an item without details is a single line", () => {
    const markdown: string = render([
      entry({
        kind: "Node",
        name: "`node-a`",
        value: "**85.00%**",
        details: [],
      }),
      entry({
        kind: "Node",
        name: "`node-b`",
        value: "**80.00%**",
        details: [],
      }),
    ]);

    expect(markdown).toContain(
      "1. **Node** `node-a` — **85.00%**\n2. **Node** `node-b` — **80.00%**",
    );
  });

  test("a detail with an empty value is left out rather than printed as a dash", () => {
    const markdown: string = render([
      entry({
        details: [
          { label: "Namespace", value: "`payments`" },
          { label: "Deployment", value: "" },
          { label: "Pod", value: "   " },
          { label: "Node", value: "`node-a`" },
        ],
      }),
    ]);

    expect(markdown).toContain(
      "1. **Pod** `checkout-7d9f` — **3**\n   - Namespace: `payments`\n   - Node: `node-a`",
    );
    expect(markdown).not.toContain("Deployment");
    expect(markdown).not.toContain("- Pod");
    expect(markdown).not.toContain(": -");
  });

  test("an empty kind drops the bold marker instead of rendering '****'", () => {
    const markdown: string = render([entry({ kind: "", details: [] })]);

    expect(markdown).toContain("1. `checkout-7d9f` — **3**");
    expect(markdown).not.toContain("****");
  });

  test("an empty name leaves just the kind", () => {
    const markdown: string = render([
      entry({ kind: "Cluster", name: "", details: [] }),
    ]);

    expect(markdown).toContain("1. **Cluster** — **3**");
  });

  test("markdown in a kind or label is escaped, not rendered", () => {
    const markdown: string = render([
      entry({
        kind: "*bold* [link](https://evil.example)",
        details: [
          { label: "![img](https://evil.example/x.png)", value: "`x`" },
        ],
      }),
    ]);

    expect(markdown).toContain(
      "1. **\\*bold\\* \\[link\\]\\(https://evil.example\\)** `checkout-7d9f` — **3**",
    );
    expect(markdown).toContain(
      "   - \\!\\[img\\]\\(https://evil.example/x.png\\): `x`",
    );
  });

  describe("overflow summary", () => {
    test("summarises the resources beyond the ones shown", () => {
      const markdown: string = render(entries(10), 83);

      expect(markdown).toContain("**Affected Resources** (83 total)");
      expect(markdown.endsWith("*... and 73 more affected resources*")).toBe(
        true,
      );
    });

    test("the summary is separated from the last item by a blank line", () => {
      const markdown: string = render(entries(10), 12);

      expect(markdown).toContain(
        "    - Node: `node-10`\n\n*... and 2 more affected resources*",
      );
    });

    test("no summary when every resource is shown", () => {
      const markdown: string = render(entries(10), 10);

      expect(markdown).toContain("**Affected Resources** (10 total)");
      expect(markdown).not.toContain("more affected resources");
    });

    test("no summary when the total is smaller than the list (defensive)", () => {
      const markdown: string = render(entries(3), 1);

      expect(markdown).not.toContain("more affected resources");
      expect(markdown).not.toContain("... and");
    });

    test("markdown in the heading or noun is escaped", () => {
      const markdown: string = AffectedResourceList.render({
        heading: "A*b",
        overflowNoun: "x_y",
        totalCount: 2,
        entries: [entry({ details: [] })],
      });

      expect(markdown).toContain("**A\\*b** (2 total)");
      expect(markdown).toContain("*... and 1 more x\\_y*");
    });

    test("uses the caller's heading and noun (Docker Swarm lists tasks)", () => {
      const markdown: string = AffectedResourceList.render({
        heading: "Affected Tasks",
        overflowNoun: "affected tasks",
        totalCount: 14,
        entries: entries(10),
      });

      expect(markdown).toContain("**Affected Tasks** (14 total)");
      expect(markdown).toContain("*... and 4 more affected tasks*");
      expect(markdown).not.toContain("affected resources");
    });
  });

  test("MAX_ENTRIES is ten, the size the table used to be capped at", () => {
    expect(AffectedResourceList.MAX_ENTRIES).toBe(10);
  });
});

describe("AffectedResourceList.render - parses as one ordered list of resources", () => {
  test("marked sees the heading, one ordered list and the summary paragraph", () => {
    const tokens: Array<Token> = blocks(render(entries(10), 83));

    expect(
      tokens.map((token: Token) => {
        return token.type;
      }),
    ).toEqual(["paragraph", "list", "paragraph"]);

    const list: Tokens.List = tokens[1] as Tokens.List;
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(1);
    expect(list.loose).toBe(false);
    expect(list.items).toHaveLength(10);

    expect((tokens[2] as Tokens.Paragraph).text).toBe(
      "*... and 73 more affected resources*",
    );
  });

  test("every item, including the tenth, owns its details as a nested bullet list", () => {
    const list: Tokens.List = blocks(render(entries(10)))[1] as Tokens.List;

    list.items.forEach((item: Tokens.ListItem, index: number) => {
      const nested: Tokens.List | undefined = nestedList(item);

      expect(nested).toBeDefined();
      expect(nested!.ordered).toBe(false);
      expect(
        nested!.items.map((detail: Tokens.ListItem) => {
          return detail.text;
        }),
      ).toEqual([
        `Namespace: \`ns-${index + 1}\``,
        `Node: \`node-${index + 1}\``,
      ]);
    });
  });

  test("no detail line is mistaken for an indented code block", () => {
    const markdown: string = render(entries(10), 40);

    const walk: (tokens: Array<Token>) => Array<string> = (
      tokens: Array<Token>,
    ): Array<string> => {
      const types: Array<string> = [];

      for (const token of tokens) {
        types.push(token.type);

        const children: Array<Token> | undefined = (
          token as { tokens?: Array<Token> }
        ).tokens;

        if (children) {
          types.push(...walk(children));
        }

        if (token.type === "list") {
          for (const item of (token as Tokens.List).items) {
            types.push(...walk(item.tokens));
          }
        }
      }

      return types;
    };

    expect(walk(marked.lexer(markdown))).not.toContain("code");
  });

  test("renders to an email as a styled <ol> with a nested <ul> in each <li>, and no table", async () => {
    const html: string = await Markdown.convertToHTML(
      render(entries(2), 5),
      MarkdownContentType.Email,
    );

    expect(html).not.toContain("<table");
    expect(html).toMatch(/<ol style="[^"]+">/);
    expect(html).toMatch(/<ul style="[^"]+">/);

    // Each item's details open inside that item, before it closes.
    expect(html).toMatch(
      /<li style="[^"]+">\s*<strong>Pod<\/strong> <code[^>]*>pod-1<\/code> — <strong>99<\/strong>\s*<ul style="[^"]+">\s*<li style="[^"]+">Namespace: <code[^>]*>ns-1<\/code><\/li>\s*<li style="[^"]+">Node: <code[^>]*>node-1<\/code><\/li>\s*<\/ul>\s*<\/li>/,
    );

    // The summary follows the list; it is not inside the last item.
    const listEnd: number = html.lastIndexOf("</ol>");
    const summary: number = html.indexOf("... and 3 more affected resources");
    expect(summary).toBeGreaterThan(listEnd);
    expect(html).toContain("<em>... and 3 more affected resources</em>");
  });

  test("renders to Slack as numbered lines with bullet details, not a '_Row 1_' table dump", () => {
    const slack: string = SlackUtil.convertMarkdownToSlackRichText(
      render(entries(2), 5),
    );

    expect(slack).not.toContain("_Row 1_");
    expect(slack).not.toContain("*Namespace:*");
    /*
     * slackify-markdown turns **bold** into Slack's *bold* and fences it
     * with zero-width spaces so it binds next to punctuation.
     */
    expect(slack).toMatch(
      /1\.\s+\u200B?\*Pod\*\u200B? `pod-1` — \u200B?\*99\*\u200B?\n/,
    );
    expect(slack).toMatch(
      /\n\s+•\s+Namespace: `ns-1`\n\s+•\s+Node: `node-1`\n/,
    );
    expect(slack).toMatch(/\n2\.\s+\u200B?\*Pod\*\u200B? `pod-2`/);
    expect(slack).toContain("more affected resources");
  });

  test("renders to plain text as one readable line per resource and detail", () => {
    const text: string = Markdown.convertToPlainText(render(entries(2), 5));

    expect(text.split("\n")).toEqual([
      "Affected Resources (5 total)",
      "Pod pod-1 — 99",
      "Namespace: ns-1",
      "Node: node-1",
      "Pod pod-2 — 98",
      "Namespace: ns-2",
      "Node: node-2",
      "... and 3 more affected resources",
    ]);
  });

  /*
   * Real names are snake_case and can hold backticks. convertToPlainText
   * used to strip emphasis before code, so the underscores of one code()
   * span paired with the next span's (and with an italic note after the
   * list) and were deleted, and code()'s longer fences came out as debris:
   * "checkoutapi-7d9f", "kubesystem", "Pod ` db01 `", and a Virtual Machine
   * with no name at all.
   */
  test("plain text keeps code() names and details verbatim, underscores and backticks included", () => {
    const markdown: string =
      render(
        [
          entry({
            name: AffectedResourceList.code("checkout_api-7d9f"),
            value: "**99**",
            details: [
              {
                label: "Namespace",
                value: AffectedResourceList.code("kube_system"),
              },
              {
                label: "Node",
                value: AffectedResourceList.code("gke_prod_pool_1"),
              },
            ],
          }),
          entry({
            name: AffectedResourceList.code("db`01"),
            value: "**98**",
            details: [
              {
                label: "Namespace",
                value: AffectedResourceList.code("kube_system"),
              },
              {
                label: "Node",
                value: AffectedResourceList.code("gke_prod_pool_2"),
              },
            ],
          }),
          entry({
            kind: "Virtual Machine",
            name: AffectedResourceList.code("a``b`c"),
            value: "**97**",
            details: [],
          }),
        ],
        5,
      ) + "\n\n_Showing the first 3 of 5 affected resources._";

    expect(Markdown.convertToPlainText(markdown).split("\n")).toEqual([
      "Affected Resources (5 total)",
      "Pod checkout_api-7d9f — 99",
      "Namespace: kube_system",
      "Node: gke_prod_pool_1",
      "Pod db`01 — 98",
      "Namespace: kube_system",
      "Node: gke_prod_pool_2",
      "Virtual Machine a``b`c — 97",
      "... and 2 more affected resources",
      "Showing the first 3 of 5 affected resources.",
    ]);
  });
});

describe("AffectedResourceList.code", () => {
  test("wraps an identifier in single backticks", () => {
    expect(AffectedResourceList.code("checkout-7d9f")).toBe("`checkout-7d9f`");
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a lone line break", "\n"],
  ])("returns an empty string for %s", (_label: string, value: unknown) => {
    expect(AffectedResourceList.code(value as string | undefined | null)).toBe(
      "",
    );
  });

  test("trims surrounding whitespace", () => {
    expect(AffectedResourceList.code("  web-01  ")).toBe("`web-01`");
  });

  test("turns line breaks into single spaces so the list item cannot be split", () => {
    expect(AffectedResourceList.code("web\n01")).toBe("`web 01`");
    expect(AffectedResourceList.code("web\r\n01")).toBe("`web 01`");
    expect(AffectedResourceList.code("web \n\n 01")).toBe("`web 01`");
  });

  test("a name containing a backtick gets a longer fence, padded with spaces", () => {
    expect(AffectedResourceList.code("db`01")).toBe("`` db`01 ``");
  });

  test("the fence is always longer than the longest backtick run", () => {
    expect(AffectedResourceList.code("a``b`c")).toBe("``` a``b`c ```");
  });

  test("a name that starts or ends with a backtick still renders verbatim", async () => {
    const code: string = AffectedResourceList.code("`vm`");

    expect(code).toBe("`` `vm` ``");

    const html: string = await Markdown.convertToHTML(
      `x ${code} y`,
      MarkdownContentType.Email,
    );

    expect(html).toMatch(/<code[^>]*>`vm`<\/code>/);
  });

  test("markdown inside a name stays inside the code span", async () => {
    const code: string = AffectedResourceList.code(
      "vm` **pwned** [x](https://evil.example)",
    );

    const html: string = await Markdown.convertToHTML(
      `1. **Virtual Machine** ${code} — **3**`,
      MarkdownContentType.Email,
    );

    expect(html).not.toContain("<strong>pwned</strong>");
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toMatch(
      /<code[^>]*>vm` \*\*pwned\*\* \[x\]\(https:\/\/evil\.example\)<\/code>/,
    );
  });

  test("a pipe needs no escaping any more — there is no table to break", () => {
    expect(AffectedResourceList.code("a|b")).toBe("`a|b`");
  });

  test("a non-string value is stringified rather than crashing", () => {
    expect(AffectedResourceList.code(42 as unknown as string)).toBe("`42`");
  });
});

describe("AffectedResourceList.codeWithId", () => {
  test("shows the name with its id beside it", () => {
    expect(
      AffectedResourceList.codeWithId({ name: "web-vm", id: "qemu/100" }),
    ).toBe("`web-vm` (`qemu/100`)");
  });

  test("falls back to whichever half is present", () => {
    expect(AffectedResourceList.codeWithId({ name: "web-vm" })).toBe(
      "`web-vm`",
    );
    expect(AffectedResourceList.codeWithId({ id: "qemu/100" })).toBe(
      "`qemu/100`",
    );
  });

  test("shows a name that equals its id only once", () => {
    expect(AffectedResourceList.codeWithId({ name: "rbd", id: "rbd" })).toBe(
      "`rbd`",
    );
  });

  test("an empty half counts as missing", () => {
    expect(AffectedResourceList.codeWithId({ name: "", id: "qemu/100" })).toBe(
      "`qemu/100`",
    );
    expect(AffectedResourceList.codeWithId({ name: "web-vm", id: " " })).toBe(
      "`web-vm`",
    );
  });

  test("returns an empty string when neither half is present", () => {
    expect(AffectedResourceList.codeWithId({})).toBe("");
  });
});
