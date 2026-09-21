import RootCauseList, {
  RootCauseListItem,
} from "../../../../Server/Utils/Monitor/RootCauseList";
import { marked, Tokens, Token } from "marked";
import { describe, expect, test } from "@jest/globals";

/*
 * RootCauseList is the numbered list both per-item breakdowns of a root
 * cause render as — a platform monitor's Affected Resources and a metric
 * monitor's Breaching Samples. Each has its own suite for its own content
 * (AffectedResourceList.test.ts, MonitorCriteriaEvaluatorBreachingSamples
 * .test.ts); this one pins the shape they share.
 */

function item(overrides: Partial<RootCauseListItem> = {}): RootCauseListItem {
  return {
    title: "`2026-08-14T10:30:00.000Z`",
    value: "**1.07 GB**",
    details: [
      { label: "`a`", value: "537 MB" },
      { label: "`k8s.pod.name`", value: "`web-1`" },
    ],
    ...overrides,
  };
}

function items(count: number): Array<RootCauseListItem> {
  const result: Array<RootCauseListItem> = [];

  for (let i: number = 1; i <= count; i++) {
    result.push(
      item({
        title: `\`item-${i}\``,
        value: `**${i}**`,
        details: [{ label: "Label", value: `\`detail-${i}\`` }],
      }),
    );
  }

  return result;
}

describe("RootCauseList.render", () => {
  test("renders each item as a numbered line with its details as nested bullets", () => {
    expect(RootCauseList.render([item()])).toBe(
      [
        "1. `2026-08-14T10:30:00.000Z` — **1.07 GB**",
        "   - `a`: 537 MB",
        "   - `k8s.pod.name`: `web-1`",
      ].join("\n"),
    );
  });

  test("returns just the list — no heading, and no leading or trailing blank lines", () => {
    const markdown: string = RootCauseList.render(items(2));

    expect(markdown.startsWith("1. ")).toBe(true);
    expect(markdown.endsWith("`detail-2`")).toBe(true);
  });

  test("returns an empty string for no items", () => {
    expect(RootCauseList.render([])).toBe("");
  });

  test("numbers the items from 1 in the order given", () => {
    const markdown: string = RootCauseList.render(items(3));

    expect(markdown.split("\n")).toEqual([
      "1. `item-1` — **1**",
      "   - Label: `detail-1`",
      "2. `item-2` — **2**",
      "   - Label: `detail-2`",
      "3. `item-3` — **3**",
      "   - Label: `detail-3`",
    ]);
  });

  test("indents details to the content column: three spaces under 1-9, four under 10-99, five under 100", () => {
    const markdown: string = RootCauseList.render(items(100));

    expect(markdown).toContain("9. `item-9` — **9**\n   - Label: `detail-9`");
    expect(markdown).toContain(
      "10. `item-10` — **10**\n    - Label: `detail-10`",
    );
    expect(markdown).toContain(
      "99. `item-99` — **99**\n    - Label: `detail-99`",
    );
    expect(markdown).toContain(
      "100. `item-100` — **100**\n     - Label: `detail-100`",
    );
  });

  test("a detail with an empty or blank value is left out", () => {
    const markdown: string = RootCauseList.render([
      item({
        details: [
          { label: "`a`", value: "537 MB" },
          { label: "`b`", value: "" },
          { label: "`c`", value: "   " },
          { label: "`d`", value: "1.5 sec" },
        ],
      }),
    ]);

    expect(markdown.split("\n")).toEqual([
      "1. `2026-08-14T10:30:00.000Z` — **1.07 GB**",
      "   - `a`: 537 MB",
      "   - `d`: 1.5 sec",
    ]);
  });

  test("a detail with an empty label is just its value", () => {
    const markdown: string = RootCauseList.render([
      item({ details: [{ label: "", value: "`web-1`" }] }),
    ]);

    expect(markdown).toBe(
      "1. `2026-08-14T10:30:00.000Z` — **1.07 GB**\n   - `web-1`",
    );
  });

  test("an item without details is a single line", () => {
    expect(RootCauseList.render([item({ details: [] })])).toBe(
      "1. `2026-08-14T10:30:00.000Z` — **1.07 GB**",
    );
  });

  test("an empty value leaves just the title, with no dangling dash", () => {
    expect(RootCauseList.render([item({ value: "", details: [] })])).toBe(
      "1. `2026-08-14T10:30:00.000Z`",
    );
  });

  test("an empty title leaves just the value", () => {
    expect(RootCauseList.render([item({ title: " ", details: [] })])).toBe(
      "1. **1.07 GB**",
    );
  });

  test("trims the whitespace around the title, value, labels and values", () => {
    expect(
      RootCauseList.render([
        item({
          title: "  `t`  ",
          value: " **v** ",
          details: [{ label: " `k` ", value: " `x` " }],
        }),
      ]),
    ).toBe("1. `t` — **v**\n   - `k`: `x`");
  });

  test("renders labels, titles and values as markdown, unescaped", () => {
    /*
     * The caller decides: AffectedResourceList escapes its plain-text
     * labels, the Breaching Samples block code-spans its attribute keys.
     */
    expect(
      RootCauseList.render([
        item({
          title: "**Pod** `x`",
          details: [{ label: "*Namespace*", value: "`y`" }],
        }),
      ]),
    ).toBe("1. **Pod** `x` — **1.07 GB**\n   - *Namespace*: `y`");
  });

  test("parses as one ordered list whose every item owns a nested bullet list, with no code blocks", () => {
    const tokens: Array<Token> = marked
      .lexer(RootCauseList.render(items(12)))
      .filter((token: Token): boolean => {
        return token.type !== "space";
      });

    expect(tokens).toHaveLength(1);

    const list: Tokens.List = tokens[0] as Tokens.List;

    expect(list.type).toBe("list");
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(12);

    list.items.forEach((listItem: Tokens.ListItem, index: number) => {
      const nested: Tokens.List | undefined = listItem.tokens.find(
        (token: Token): boolean => {
          return token.type === "list";
        },
      ) as Tokens.List | undefined;

      expect(nested).toBeDefined();
      expect(nested!.ordered).toBe(false);
      expect(
        nested!.items.map((detail: Tokens.ListItem) => {
          return detail.text;
        }),
      ).toEqual([`Label: \`detail-${index + 1}\``]);

      expect(
        listItem.tokens.some((token: Token): boolean => {
          return token.type === "code";
        }),
      ).toBe(false);
    });
  });
});

describe("RootCauseList.code", () => {
  test("wraps a value in single backticks", () => {
    expect(RootCauseList.code("web-1")).toBe("`web-1`");
  });

  test("an ISO timestamp stays a bare single-backtick span, which the dashboard localizes", () => {
    expect(RootCauseList.code("2026-08-14T10:30:00.000Z")).toBe(
      "`2026-08-14T10:30:00.000Z`",
    );
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["whitespace", "  \t "],
    ["line breaks", "\r\n\n"],
  ])("returns an empty string for %s", (_label: string, value: unknown) => {
    expect(RootCauseList.code(value as string | undefined | null)).toBe("");
  });

  test("turns line breaks into single spaces", () => {
    expect(RootCauseList.code("a\nb\r\nc \n\n d")).toBe("`a b c d`");
  });

  test("a value with backticks gets a fence one longer than its longest run, padded with spaces", () => {
    expect(RootCauseList.code("a`b")).toBe("`` a`b ``");
    expect(RootCauseList.code("a``b`c")).toBe("``` a``b`c ```");
  });

  test("the result parses back to exactly the value", () => {
    for (const value of ["a`b", "`edge`", "x``y", "**not bold**", "a|b"]) {
      const tokens: Array<Token> = marked.lexer(
        `before ${RootCauseList.code(value)} after`,
      );
      const paragraph: Tokens.Paragraph = tokens[0] as Tokens.Paragraph;
      const codespan: Tokens.Codespan | undefined = paragraph.tokens.find(
        (token: Token): boolean => {
          return token.type === "codespan";
        },
      ) as Tokens.Codespan | undefined;

      expect(codespan).toBeDefined();
      expect(codespan!.text).toBe(value);
    }
  });
});
