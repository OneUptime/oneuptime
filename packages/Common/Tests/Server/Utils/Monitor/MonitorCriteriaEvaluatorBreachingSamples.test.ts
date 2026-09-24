/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing under test here
 * touches the sandbox, and the prebuilt binary cannot always dlopen in the
 * test environment — so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Markdown, {
  MarkdownContentType,
} from "../../../../Server/Types/Markdown";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MetricCriteriaContext, {
  MetricBreachingSample,
} from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import { marked, Tokens, Token } from "marked";
import { describe, expect, test } from "@jest/globals";

/*
 * THE BREACHING SAMPLES LIST.
 *
 * A metric monitor's root cause lists the samples that breached. It was a
 * GitHub-flavoured table — Timestamp | Metric | Alias | Value, one column
 * per formula component and one per attribute key — that grew a column
 * for every group-by attribute. In the ~416px email card every cell
 * wrapped into fragments, Slack (mrkdwn has no tables) got raw pipe rows,
 * and on the dashboard the widest column squeezed the rest.
 *
 * It is now a numbered list in the same visual language as the Affected
 * Resources list — one item per sample, oldest first:
 *
 *     1. `2026-08-14T10:28:00.000Z` — **1.07 GB**
 *        - `a`: 537 MB
 *        - `k8s.pod.name`: `web-1`
 *
 * These tests pin the exact markdown, that it PARSES as that shape (one
 * ordered list, each item owning a nested bullet list, nothing mistaken
 * for a code block), and what it becomes in each place a root cause is
 * read: the email (Markdown.convertToHTML), Slack
 * (SlackUtil.convertMarkdownToSlackRichText) and plain text
 * (Markdown.convertToPlainText). The value formatting itself — units,
 * scaling, the formula guard — is pinned in
 * MonitorCriteriaEvaluatorMetricUnits.test.ts.
 */

type EvaluatorPrivate = {
  buildMetricRootCauseContext: (input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }) => string | null;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

/*
 * MarkdownViewer's ISO_8601_REGEX: an inline code span whose whole text
 * matches it is re-rendered in the viewer's timezone on the dashboard.
 */
const DASHBOARD_LOCALIZED_TIMESTAMP: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 7, 14, 10, minute, 0, 0));
}

function iso(minute: number): string {
  return at(minute).toISOString();
}

function makeContext(
  overrides: Partial<MetricCriteriaContext> = {},
): MetricCriteriaContext {
  return {
    metricName: "k8s.pod.memory.usage",
    alias: "a",
    unit: "By",
    aggregationType: null,
    isFormula: false,
    filterAttributes: {},
    groupBy: ["k8s.namespace.name", "k8s.pod.name"],
    totalSamplesInWindow: 10,
    // Out of order on purpose: the list is chronological.
    breachingSamples: [
      {
        value: 1258291,
        timestamp: at(30),
        attributes: {
          "k8s.namespace.name": "payments",
          "k8s.pod.name": "web-2",
        },
      },
      {
        value: 1073741824,
        timestamp: at(28),
        attributes: {
          "k8s.namespace.name": "payments",
          "k8s.pod.name": "web-1",
        },
      },
      {
        value: 2147483648,
        timestamp: at(29),
        attributes: {
          "k8s.namespace.name": "payments",
          "k8s.pod.name": "web-1",
        },
      },
    ],
    ...overrides,
  };
}

function formulaContext(
  overrides: Partial<MetricCriteriaContext> = {},
): MetricCriteriaContext {
  return makeContext({
    metricName: "a + b",
    alias: "c",
    isFormula: true,
    formulaExpression: "a + b",
    unit: "By",
    groupBy: ["host.name"],
    totalSamplesInWindow: 5,
    components: [
      {
        alias: "a",
        name: "container.memory.usage",
        unit: "By",
        isFormula: false,
      },
      {
        alias: "b",
        name: "http.server.duration",
        unit: "ms",
        isFormula: false,
      },
    ],
    breachingSamples: [
      {
        value: 805306368,
        timestamp: at(29),
        attributes: { "host.name": "prod-01" },
        componentValues: [
          { alias: "a", value: 536870912 },
          { alias: "b", value: 1500 },
        ],
      },
      {
        value: 1073741824,
        timestamp: at(30),
        attributes: { "host.name": "prod-02" },
        // b had no data point at this timestamp.
        componentValues: [
          { alias: "a", value: 1073741824 },
          { alias: "b", value: null },
        ],
      },
    ],
    ...overrides,
  });
}

// `count` samples one minute apart from 10:00, valued 1, 2, 3, ...
function manySamples(count: number): Array<MetricBreachingSample> {
  const samples: Array<MetricBreachingSample> = [];

  for (let i: number = 1; i <= count; i++) {
    samples.push({
      value: i,
      timestamp: at(i - 1),
      attributes: { "host.name": `host-${i}` },
    });
  }

  // Newest first, so the cap has to sort before it slices.
  return samples.reverse();
}

function makeCriteriaInstance(
  ctx: MetricCriteriaContext,
): MonitorCriteriaInstance {
  const filter: CriteriaFilter = {
    checkOn: CheckOn.MetricValue,
    metricCriteriaContext: ctx,
  } as CriteriaFilter;

  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [filter],
    incidents: [],
    alerts: [],
    name: "Memory breach",
    description: "Memory breach",
    id: ObjectID.generate().toString(),
  };
  return instance;
}

function rootCause(ctx: MetricCriteriaContext, monitor?: Monitor): string {
  const context: string | null = Evaluator.buildMetricRootCauseContext({
    criteriaInstance: makeCriteriaInstance(ctx),
    monitor: monitor || new Monitor(),
  });

  expect(context).not.toBeNull();
  return context as string;
}

/*
 * The Breaching Samples section on its own: from its heading to the end of
 * the root cause, which is where it sits when the monitor has no project
 * (so no explorer links follow it).
 */
function section(ctx: MetricCriteriaContext): string {
  const context: string = rootCause(ctx);
  const start: number = context.indexOf("**Breaching Samples**");

  expect(start).toBeGreaterThan(-1);
  return context.slice(start);
}

// The top-level block tokens marked produces, without the blank-line spacers.
function blocks(markdown: string): Array<Token> {
  return marked.lexer(markdown).filter((token: Token): boolean => {
    return token.type !== "space";
  });
}

function orderedLists(markdown: string): Array<Tokens.List> {
  return blocks(markdown).filter((token: Token): boolean => {
    return token.type === "list" && (token as Tokens.List).ordered;
  }) as Array<Tokens.List>;
}

function nestedList(item: Tokens.ListItem): Tokens.List | undefined {
  return item.tokens.find((token: Token): boolean => {
    return token.type === "list";
  }) as Tokens.List | undefined;
}

function detailTexts(item: Tokens.ListItem): Array<string> {
  const nested: Tokens.List | undefined = nestedList(item);

  if (!nested) {
    return [];
  }

  return nested.items.map((detail: Tokens.ListItem) => {
    return detail.text;
  });
}

// Every token type in the tree, list items included.
function allTokenTypes(tokens: Array<Token>): Array<string> {
  const types: Array<string> = [];

  for (const token of tokens) {
    types.push(token.type);

    const children: Array<Token> | undefined = (
      token as { tokens?: Array<Token> }
    ).tokens;

    if (children) {
      types.push(...allTokenTypes(children));
    }

    if (token.type === "list") {
      for (const item of (token as Tokens.List).items) {
        types.push(...allTokenTypes(item.tokens));
      }
    }
  }

  return types;
}

// The inline tokens of a list item's own line (not its nested list).
function itemInlineTokens(item: Tokens.ListItem): Array<Token> {
  const text: Tokens.Text | undefined = item.tokens.find(
    (token: Token): boolean => {
      return token.type === "text";
    },
  ) as Tokens.Text | undefined;

  expect(text).toBeDefined();
  return text!.tokens || [];
}

describe("Breaching Samples - markdown", () => {
  test("renders the whole metric root cause with the samples as a numbered list", () => {
    expect(rootCause(makeContext())).toBe(
      [
        "**Metric Details**",
        "- Metric: `k8s.pod.memory.usage`",
        "- Alias: `a`",
        "- Unit: Bytes",
        "- Grouped By: `k8s.namespace.name`, `k8s.pod.name`",
        "",
        "",
        "**Breaching Samples**",
        "3 of 10 samples breached the threshold.",
        "",
        "1. `2026-08-14T10:28:00.000Z` — **1.07 GB**",
        "   - `k8s.namespace.name`: `payments`",
        "   - `k8s.pod.name`: `web-1`",
        "2. `2026-08-14T10:29:00.000Z` — **2.15 GB**",
        "   - `k8s.namespace.name`: `payments`",
        "   - `k8s.pod.name`: `web-1`",
        "3. `2026-08-14T10:30:00.000Z` — **1.26 MB**",
        "   - `k8s.namespace.name`: `payments`",
        "   - `k8s.pod.name`: `web-2`",
      ].join("\n"),
    );
  });

  test("renders a formula's component values and attributes under each sample", () => {
    expect(section(formulaContext())).toBe(
      [
        "**Breaching Samples**",
        "2 of 5 samples breached the threshold.",
        "",
        "1. `2026-08-14T10:29:00.000Z` — **805 MB**",
        "   - `a`: 537 MB",
        "   - `b`: 1.5 sec",
        "   - `host.name`: `prod-01`",
        "2. `2026-08-14T10:30:00.000Z` — **1.07 GB**",
        "   - `a`: 1.07 GB",
        "   - `host.name`: `prod-02`",
      ].join("\n"),
    );
  });

  test("a sample with no components and no attributes is a single line", () => {
    expect(
      section(
        makeContext({
          groupBy: [],
          totalSamplesInWindow: undefined,
          breachingSamples: [
            { value: 1073741824, timestamp: at(30), attributes: {} },
          ],
        }),
      ),
    ).toBe(
      [
        "**Breaching Samples**",
        "1 sample breached the threshold.",
        "",
        "1. `2026-08-14T10:30:00.000Z` — **1.07 GB**",
      ].join("\n"),
    );
  });

  test("never emits GFM table syntax", () => {
    for (const ctx of [
      makeContext(),
      formulaContext(),
      makeContext({ breachingSamples: manySamples(25) }),
    ]) {
      const markdown: string = section(ctx);

      expect(markdown).not.toMatch(/^\s*\|/m);
      expect(markdown).not.toContain("| --- |");
      expect(markdown).not.toContain("Timestamp");
    }
  });

  test("lists the samples oldest first, whatever order they arrive in", () => {
    const markdown: string = section(makeContext());

    const first: number = markdown.indexOf(`1. \`${iso(28)}\``);
    const second: number = markdown.indexOf(`2. \`${iso(29)}\``);
    const third: number = markdown.indexOf(`3. \`${iso(30)}\``);

    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  test("timestamps are bare ISO 8601 code spans, which the dashboard localizes", () => {
    const list: Tokens.List = orderedLists(section(makeContext()))[0]!;

    for (const item of list.items) {
      const first: Token = itemInlineTokens(item)[0]!;

      expect(first.type).toBe("codespan");
      expect((first as Tokens.Codespan).text).toMatch(
        DASHBOARD_LOCALIZED_TIMESTAMP,
      );
    }
  });

  test("a timestamp that arrives as a string (a context read back from JSON) is still ISO", () => {
    const markdown: string = section(
      makeContext({
        breachingSamples: [
          {
            value: 1073741824,
            timestamp: "2026-08-14T10:30:00.000Z" as unknown as Date,
            attributes: {},
          },
        ],
      }),
    );

    expect(markdown).toContain("1. `2026-08-14T10:30:00.000Z` — **1.07 GB**");
  });

  test("the value is bold at the end of the item's line", () => {
    const list: Tokens.List = orderedLists(section(makeContext()))[0]!;
    const inline: Array<Token> = itemInlineTokens(list.items[0]!);
    const last: Token = inline[inline.length - 1]!;

    expect(last.type).toBe("strong");
    expect((last as Tokens.Strong).text).toBe("1.07 GB");
  });

  /*
   * The table's Metric and Alias columns printed the same two values on
   * every row — the ones the Metric Details list right above states once.
   */
  test("does not repeat the metric name or alias on each sample", () => {
    const context: string = rootCause(makeContext());
    const markdown: string = section(makeContext());

    expect(markdown).not.toContain("k8s.pod.memory.usage");
    expect(markdown).not.toContain("Metric:");
    expect(markdown).not.toContain("Alias:");
    expect(markdown).not.toContain("`a`");

    // Still stated once, above.
    expect(context).toContain("- Metric: `k8s.pod.memory.usage`");
    expect(context).toContain("- Alias: `a`");
  });

  test("does not repeat a formula's expression or alias on each sample either", () => {
    const markdown: string = section(formulaContext());

    expect(markdown).not.toContain("a + b");
    expect(markdown).not.toContain("`c`");
  });

  test("the summary line is unchanged and precedes the list in the heading's paragraph", () => {
    expect(section(makeContext())).toMatch(
      /^\*\*Breaching Samples\*\*\n3 of 10 samples breached the threshold\.\n\n1\. /,
    );
    expect(section(makeContext({ totalSamplesInWindow: undefined }))).toContain(
      "**Breaching Samples**\n3 samples breached the threshold.\n",
    );
    // A total smaller than the breach count is ignored rather than contradicted.
    expect(section(makeContext({ totalSamplesInWindow: 2 }))).toContain(
      "\n3 samples breached the threshold.\n",
    );
  });

  test("falls back to the single breachingSample when there is no list of them", () => {
    const markdown: string = section(
      makeContext({
        breachingSamples: undefined,
        breachingSample: {
          value: 1073741824,
          timestamp: at(30),
          attributes: { "k8s.pod.name": "web-1" },
        },
      }),
    );

    expect(markdown).toContain(
      "1. `2026-08-14T10:30:00.000Z` — **1.07 GB**\n   - `k8s.pod.name`: `web-1`",
    );
    expect(markdown).not.toContain("2. ");
  });

  test("no Breaching Samples section at all when nothing breached", () => {
    const context: string = rootCause(
      makeContext({ breachingSamples: [], breachingSample: undefined }),
    );

    expect(context).not.toContain("Breaching Samples");
    expect(context).toContain("**Metric Details**");
  });
});

describe("Breaching Samples - formula components", () => {
  test("each component is labelled by its alias and formatted in its own unit", () => {
    const list: Tokens.List = orderedLists(section(formulaContext()))[0]!;

    expect(detailTexts(list.items[0]!)).toEqual([
      "`a`: 537 MB",
      "`b`: 1.5 sec",
      "`host.name`: `prod-01`",
    ]);
  });

  test("a component with a null value is left out rather than printed as a dash", () => {
    const markdown: string = section(formulaContext());

    expect(markdown).toContain(
      "2. `2026-08-14T10:30:00.000Z` — **1.07 GB**\n   - `a`: 1.07 GB\n   - `host.name`: `prod-02`",
    );
    expect(markdown).not.toContain("`b`: -");
    expect(markdown).not.toMatch(/: -$/m);
  });

  test("a component the sample has no entry for is left out too", () => {
    const ctx: MetricCriteriaContext = formulaContext();
    ctx.breachingSamples![0]!.componentValues = [{ alias: "b", value: 1500 }];

    const list: Tokens.List = orderedLists(section(ctx))[0]!;

    expect(detailTexts(list.items[0]!)).toEqual([
      "`b`: 1.5 sec",
      "`host.name`: `prod-01`",
    ]);
  });

  test("a sample with no componentValues lists only its attributes", () => {
    const ctx: MetricCriteriaContext = formulaContext();
    delete ctx.breachingSamples![0]!.componentValues;

    const list: Tokens.List = orderedLists(section(ctx))[0]!;

    expect(detailTexts(list.items[0]!)).toEqual(["`host.name`: `prod-01`"]);
  });

  test("components are listed in the formula's order, before the attributes", () => {
    const ctx: MetricCriteriaContext = formulaContext();
    // componentValues arrive in a different order from the components.
    ctx.breachingSamples![0]!.componentValues = [
      { alias: "b", value: 1500 },
      { alias: "a", value: 536870912 },
    ];

    const list: Tokens.List = orderedLists(section(ctx))[0]!;

    expect(detailTexts(list.items[0]!)).toEqual([
      "`a`: 537 MB",
      "`b`: 1.5 sec",
      "`host.name`: `prod-01`",
    ]);
  });

  test("a component value of zero is shown, not treated as missing", () => {
    const ctx: MetricCriteriaContext = formulaContext();
    ctx.breachingSamples![0]!.componentValues = [
      { alias: "a", value: 0 },
      { alias: "b", value: 1500 },
    ];

    const list: Tokens.List = orderedLists(section(ctx))[0]!;

    expect(detailTexts(list.items[0]!)[0]).toMatch(/^`a`: 0/);
  });

  test("a component value that is not a number is left out", () => {
    const ctx: MetricCriteriaContext = formulaContext();
    ctx.breachingSamples![0]!.componentValues = [
      { alias: "a", value: "537" as unknown as number },
      { alias: "b", value: 1500 },
    ];

    const list: Tokens.List = orderedLists(section(ctx))[0]!;

    expect(detailTexts(list.items[0]!)).toEqual([
      "`b`: 1.5 sec",
      "`host.name`: `prod-01`",
    ]);
  });
});

describe("Breaching Samples - attributes", () => {
  test("lists every attribute of the sample as `key`: `value`", () => {
    const list: Tokens.List = orderedLists(section(makeContext()))[0]!;

    expect(detailTexts(list.items[2]!)).toEqual([
      "`k8s.namespace.name`: `payments`",
      "`k8s.pod.name`: `web-2`",
    ]);
  });

  test("a missing, null or empty attribute is left out rather than printed as a dash", () => {
    const markdown: string = section(
      makeContext({
        breachingSamples: [
          {
            value: 1,
            timestamp: at(28),
            attributes: { "k8s.pod.name": "web-1", "k8s.node.name": null },
          },
          {
            value: 2,
            timestamp: at(29),
            attributes: {
              "k8s.pod.name": "",
              "k8s.node.name": "node-a",
              region: "   ",
            },
          },
        ],
        unit: null,
      }),
    );

    expect(markdown).toContain(
      [
        "1. `2026-08-14T10:28:00.000Z` — **1**",
        "   - `k8s.pod.name`: `web-1`",
        "2. `2026-08-14T10:29:00.000Z` — **2**",
        "   - `k8s.node.name`: `node-a`",
      ].join("\n"),
    );
    expect(markdown).not.toContain("region");
    expect(markdown).not.toMatch(/: -$/m);
  });

  test("every sample lists its attributes in the same order, first seen first", () => {
    const markdown: string = section(
      makeContext({
        unit: null,
        breachingSamples: [
          {
            value: 1,
            timestamp: at(28),
            attributes: { zone: "z1", host: "h1" },
          },
          {
            value: 2,
            timestamp: at(29),
            // Same keys, different insertion order, plus a new one.
            attributes: { pod: "p2", host: "h2", zone: "z2" },
          },
        ],
      }),
    );

    expect(markdown).toContain(
      [
        "1. `2026-08-14T10:28:00.000Z` — **1**",
        "   - `zone`: `z1`",
        "   - `host`: `h1`",
        "2. `2026-08-14T10:29:00.000Z` — **2**",
        "   - `zone`: `z2`",
        "   - `host`: `h2`",
        "   - `pod`: `p2`",
      ].join("\n"),
    );
  });

  test("numbers and booleans are shown as text", () => {
    const markdown: string = section(
      makeContext({
        breachingSamples: [
          {
            value: 1073741824,
            timestamp: at(30),
            attributes: { "http.status_code": 503, "error.flag": false },
          },
        ],
      }),
    );

    expect(markdown).toContain("   - `http.status_code`: `503`");
    expect(markdown).toContain("   - `error.flag`: `false`");
  });

  test("a backtick in a key or value cannot close its code span early", () => {
    const markdown: string = section(
      makeContext({
        breachingSamples: [
          {
            value: 1073741824,
            timestamp: at(30),
            attributes: { "odd`key": "we``ird" },
          },
        ],
      }),
    );

    expect(markdown).toContain("   - `` odd`key ``: ``` we``ird ```");

    const list: Tokens.List = orderedLists(markdown)[0]!;
    const detail: Tokens.ListItem = nestedList(list.items[0]!)!.items[0]!;
    const codespans: Array<string> = (
      (detail.tokens[0] as Tokens.Text).tokens || []
    )
      .filter((token: Token): boolean => {
        return token.type === "codespan";
      })
      .map((token: Token) => {
        return (token as Tokens.Codespan).text;
      });

    expect(codespans).toEqual(["odd`key", "we``ird"]);
  });

  test("a line break in a value cannot split the item", () => {
    const markdown: string = section(
      makeContext({
        breachingSamples: [
          {
            value: 1073741824,
            timestamp: at(30),
            attributes: { message: "first line\n\n2. second line" },
          },
        ],
      }),
    );

    expect(markdown).toContain("   - `message`: `first line 2. second line`");
    expect(orderedLists(markdown)[0]!.items).toHaveLength(1);
  });

  test("markdown and HTML in an attribute stay inert inside the code span in the email", async () => {
    const markdown: string = section(
      makeContext({
        breachingSamples: [
          {
            value: 1073741824,
            timestamp: at(30),
            attributes: {
              "**key**":
                '**bold** [x](https://evil.example) <img src=x onerror="alert(1)">',
            },
          },
        ],
      }),
    );

    const html: string = await Markdown.convertToHTML(
      markdown,
      MarkdownContentType.Email,
    );

    expect(html).not.toContain("<strong>bold</strong>");
    expect(html).not.toContain("<strong>key</strong>");
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).not.toContain("<img");
    expect(html).toMatch(/<code[^>]*>\*\*key\*\*<\/code>/);
    expect(html).toMatch(
      /<code[^>]*>\*\*bold\*\* \[x\]\(https:\/\/evil\.example\) &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;<\/code>/,
    );
  });
});

describe("Breaching Samples - the 20-sample cap", () => {
  test("shows the first 20 samples chronologically and says how many there were", () => {
    const markdown: string = section(
      makeContext({
        unit: null,
        totalSamplesInWindow: 60,
        breachingSamples: manySamples(25),
      }),
    );

    const list: Tokens.List = orderedLists(markdown)[0]!;

    expect(list.items).toHaveLength(20);
    expect(markdown).toContain("25 of 60 samples breached the threshold.");
    expect(markdown).toContain(`1. \`${iso(0)}\` — **1**`);
    expect(markdown).toContain(`20. \`${iso(19)}\` — **20**`);
    expect(markdown).not.toContain(iso(20));
    expect(markdown).not.toContain("21. ");
    expect(
      markdown.endsWith("\n\n_Showing the first 20 of 25 breaching samples._"),
    ).toBe(true);
  });

  test("indents the details of items 10-20 to their wider content column", () => {
    const markdown: string = section(
      makeContext({ unit: null, breachingSamples: manySamples(25) }),
    );

    expect(markdown).toContain(
      `9. \`${iso(8)}\` — **9**\n   - \`host.name\`: \`host-9\`\n10. \`${iso(9)}\` — **10**\n    - \`host.name\`: \`host-10\``,
    );
    expect(markdown).toContain(
      `20. \`${iso(19)}\` — **20**\n    - \`host.name\`: \`host-20\`\n\n_Showing`,
    );
  });

  test("every one of the 20 items owns its details, and nothing parses as a code block", () => {
    const markdown: string = section(
      makeContext({ unit: null, breachingSamples: manySamples(25) }),
    );

    const list: Tokens.List = orderedLists(markdown)[0]!;

    list.items.forEach((item: Tokens.ListItem, index: number) => {
      expect(detailTexts(item)).toEqual([
        `\`host.name\`: \`host-${index + 1}\``,
      ]);
    });

    expect(allTokenTypes(marked.lexer(markdown))).not.toContain("code");
  });

  test("the note is a paragraph of its own after the list, not part of the last item", () => {
    const tokens: Array<Token> = blocks(
      section(makeContext({ unit: null, breachingSamples: manySamples(25) })),
    );

    expect(
      tokens.map((token: Token) => {
        return token.type;
      }),
    ).toEqual(["paragraph", "list", "paragraph"]);
    expect((tokens[2] as Tokens.Paragraph).text).toBe(
      "_Showing the first 20 of 25 breaching samples._",
    );
  });

  test("exactly 20 samples are all shown, with no note", () => {
    const markdown: string = section(
      makeContext({ unit: null, breachingSamples: manySamples(20) }),
    );

    expect(orderedLists(markdown)[0]!.items).toHaveLength(20);
    expect(markdown).not.toContain("Showing the first");
  });

  test("21 samples show 20 and note the one left out", () => {
    const markdown: string = section(
      makeContext({ unit: null, breachingSamples: manySamples(21) }),
    );

    expect(orderedLists(markdown)[0]!.items).toHaveLength(20);
    expect(markdown).toContain(
      "_Showing the first 20 of 21 breaching samples._",
    );
  });

  test("attribute keys that only appear on samples past the cap are not listed", () => {
    const samples: Array<MetricBreachingSample> = manySamples(21);
    // The newest sample (first in the array) is the one the cap drops.
    samples[0]!.attributes = { "only.on.21": "x" };

    const markdown: string = section(
      makeContext({ unit: null, breachingSamples: samples }),
    );

    expect(markdown).not.toContain("only.on.21");
  });
});

describe("Breaching Samples - parses as one ordered list of samples", () => {
  test("marked sees the heading paragraph and one ordered list", () => {
    const tokens: Array<Token> = blocks(section(makeContext()));

    expect(
      tokens.map((token: Token) => {
        return token.type;
      }),
    ).toEqual(["paragraph", "list"]);

    const list: Tokens.List = tokens[1] as Tokens.List;

    expect(list.ordered).toBe(true);
    expect(list.start).toBe(1);
    expect(list.loose).toBe(false);
    expect(list.items).toHaveLength(3);
  });

  test("every item owns its details as a nested bullet list", () => {
    const list: Tokens.List = orderedLists(section(makeContext()))[0]!;

    expect(
      list.items.map((item: Tokens.ListItem) => {
        const nested: Tokens.List | undefined = nestedList(item);

        expect(nested).toBeDefined();
        expect(nested!.ordered).toBe(false);

        return detailTexts(item);
      }),
    ).toEqual([
      ["`k8s.namespace.name`: `payments`", "`k8s.pod.name`: `web-1`"],
      ["`k8s.namespace.name`: `payments`", "`k8s.pod.name`: `web-1`"],
      ["`k8s.namespace.name`: `payments`", "`k8s.pod.name`: `web-2`"],
    ]);
  });

  test("the whole root cause has exactly one ordered list, and no code block", () => {
    for (const ctx of [makeContext(), formulaContext()]) {
      const context: string = rootCause(ctx);

      expect(orderedLists(context)).toHaveLength(1);
      expect(allTokenTypes(marked.lexer(context))).not.toContain("code");
    }
  });

  test("the explorer link after the list is its own paragraph, not part of the last sample", () => {
    const monitor: Monitor = new Monitor();
    monitor.projectId = ObjectID.generate();

    const context: string = rootCause(makeContext(), monitor);
    const tokens: Array<Token> = blocks(context);
    const listIndex: number = tokens.findIndex((token: Token): boolean => {
      return token.type === "list" && (token as Tokens.List).ordered;
    });

    expect(listIndex).toBeGreaterThan(-1);

    const list: Tokens.List = tokens[listIndex] as Tokens.List;
    expect(list.items).toHaveLength(3);
    expect(list.items[2]!.raw).not.toContain("Open metric in dashboard");

    const after: Token | undefined = tokens[listIndex + 1];
    expect(after?.type).toBe("paragraph");
    expect((after as Tokens.Paragraph).text).toContain(
      "[Open metric in dashboard](",
    );
  });
});

describe("Breaching Samples - in the email", () => {
  test("renders as a styled <ol> with a nested <ul> in each <li>, and no table", async () => {
    const html: string = await Markdown.convertToHTML(
      rootCause(makeContext()),
      MarkdownContentType.Email,
    );

    expect(html).not.toContain("<table");
    expect(html.match(/<ol /g)).toHaveLength(1);
    expect(html).toMatch(/<ol style="[^"]+">/);

    expect(html).toMatch(
      /<li style="[^"]+">\s*<code[^>]*>2026-08-14T10:28:00\.000Z<\/code> — <strong>1\.07 GB<\/strong>\s*<ul style="[^"]+">\s*<li style="[^"]+"><code[^>]*>k8s\.namespace\.name<\/code>: <code[^>]*>payments<\/code><\/li>\s*<li style="[^"]+"><code[^>]*>k8s\.pod\.name<\/code>: <code[^>]*>web-1<\/code><\/li>\s*<\/ul>\s*<\/li>/,
    );
    expect(html).toMatch(
      /<code[^>]*>2026-08-14T10:30:00\.000Z<\/code> — <strong>1\.26 MB<\/strong>/,
    );
  });

  test("renders a formula's components as nested bullets", async () => {
    const html: string = await Markdown.convertToHTML(
      section(formulaContext()),
      MarkdownContentType.Email,
    );

    expect(html).toMatch(
      /<ul style="[^"]+">\s*<li style="[^"]+"><code[^>]*>a<\/code>: 537 MB<\/li>\s*<li style="[^"]+"><code[^>]*>b<\/code>: 1\.5 sec<\/li>\s*<li style="[^"]+"><code[^>]*>host\.name<\/code>: <code[^>]*>prod-01<\/code><\/li>\s*<\/ul>/,
    );
    expect(html).not.toContain("-</");
  });

  test("the heading and summary come before the list", async () => {
    const html: string = await Markdown.convertToHTML(
      section(makeContext()),
      MarkdownContentType.Email,
    );

    const heading: number = html.indexOf("<strong>Breaching Samples</strong>");
    const summary: number = html.indexOf(
      "3 of 10 samples breached the threshold.",
    );
    const list: number = html.indexOf("<ol");

    expect(heading).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(heading);
    expect(list).toBeGreaterThan(summary);
  });

  test("the cap note follows the list; it is not inside the last item", async () => {
    const html: string = await Markdown.convertToHTML(
      section(makeContext({ unit: null, breachingSamples: manySamples(25) })),
      MarkdownContentType.Email,
    );

    const listEnd: number = html.lastIndexOf("</ol>");
    const note: number = html.indexOf(
      "Showing the first 20 of 25 breaching samples.",
    );

    expect(note).toBeGreaterThan(listEnd);
    expect(html).toContain(
      "<em>Showing the first 20 of 25 breaching samples.</em>",
    );
    expect(
      html.match(
        /<code[^>]*>2026-08-14T10:\d{2}:00\.000Z<\/code> — <strong>\d+<\/strong>/g,
      ),
    ).toHaveLength(20);
  });
});

describe("Breaching Samples - in Slack", () => {
  test("renders as numbered lines with bullet details, not a table dump", () => {
    const slack: string = SlackUtil.convertMarkdownToSlackRichText(
      section(makeContext()),
    );

    expect(slack).not.toContain("_Row 1_");
    expect(slack).not.toMatch(/^\s*\|/m);
    /*
     * slackify-markdown turns **bold** into Slack's *bold* and fences it
     * with zero-width spaces so it binds next to punctuation.
     */
    expect(slack).toMatch(
      /1\.\s+`2026-08-14T10:28:00\.000Z` — \u200B?\*1\.07 GB\*\u200B?\n/,
    );
    expect(slack).toMatch(
      /\n\s+•\s+`k8s\.namespace\.name`: `payments`\n\s+•\s+`k8s\.pod\.name`: `web-1`\n/,
    );
    expect(slack).toMatch(
      /\n3\.\s+`2026-08-14T10:30:00\.000Z` — \u200B?\*1\.26 MB\*\u200B?\n/,
    );
    expect(slack).toContain("3 of 10 samples breached the threshold.");
  });

  test("renders a formula's components as bullets under their sample", () => {
    const slack: string = SlackUtil.convertMarkdownToSlackRichText(
      section(formulaContext()),
    );

    expect(slack).toMatch(
      /\n\s+•\s+`a`: 537 MB\n\s+•\s+`b`: 1\.5 sec\n\s+•\s+`host\.name`: `prod-01`\n/,
    );
  });

  test("keeps all 20 items numbered in order, with the cap note after them", () => {
    const slack: string = SlackUtil.convertMarkdownToSlackRichText(
      section(makeContext({ unit: null, breachingSamples: manySamples(25) })),
    );

    for (let i: number = 1; i <= 20; i++) {
      expect(slack).toMatch(
        new RegExp(`(^|\\n)${i}\\.\\s+\`${iso(i - 1).replace(/\./g, "\\.")}\``),
      );
    }

    expect(slack).not.toMatch(/(^|\n)21\.\s/);
    expect(
      slack.indexOf("Showing the first 20 of 25 breaching samples."),
    ).toBeGreaterThan(slack.indexOf(`\`${iso(19)}\``));
  });
});

describe("Breaching Samples - as plain text", () => {
  test("reads as one line per sample and per detail", () => {
    expect(
      Markdown.convertToPlainText(section(makeContext())).split("\n"),
    ).toEqual([
      "Breaching Samples",
      "3 of 10 samples breached the threshold.",
      "2026-08-14T10:28:00.000Z — 1.07 GB",
      "k8s.namespace.name: payments",
      "k8s.pod.name: web-1",
      "2026-08-14T10:29:00.000Z — 2.15 GB",
      "k8s.namespace.name: payments",
      "k8s.pod.name: web-1",
      "2026-08-14T10:30:00.000Z — 1.26 MB",
      "k8s.namespace.name: payments",
      "k8s.pod.name: web-2",
    ]);
  });

  test("a formula's components read as alias: value", () => {
    expect(
      Markdown.convertToPlainText(section(formulaContext())).split("\n"),
    ).toEqual([
      "Breaching Samples",
      "2 of 5 samples breached the threshold.",
      "2026-08-14T10:29:00.000Z — 805 MB",
      "a: 537 MB",
      "b: 1.5 sec",
      "host.name: prod-01",
      "2026-08-14T10:30:00.000Z — 1.07 GB",
      "a: 1.07 GB",
      "host.name: prod-02",
    ]);
  });

  test("the cap note is the last line", () => {
    const lines: Array<string> = Markdown.convertToPlainText(
      section(makeContext({ unit: null, breachingSamples: manySamples(25) })),
    ).split("\n");

    expect(lines[lines.length - 1]).toBe(
      "Showing the first 20 of 25 breaching samples.",
    );
    expect(lines).toContain(`${iso(19)} — 20`);
    expect(lines).toContain("host.name: host-20");
  });

  /*
   * OpenTelemetry keys and values are snake_case, and the cap note is
   * _italic_. convertToPlainText used to strip emphasis before code, with a
   * regex that crossed newlines, so the "_" in `http.status_code` paired
   * with the next underscore anywhere below it and both were deleted: the
   * SMS read "http.statuscode: 503" and "... breaching samples._".
   */
  test("snake_case keys, values and metric names survive, and the cap note closes cleanly", () => {
    const samples: Array<MetricBreachingSample> = [];

    for (let i: number = 1; i <= 25; i++) {
      samples.push({
        value: 4 + i,
        timestamp: at(i - 1),
        attributes: {
          "http.status_code": 503,
          "k8s.pod.name": `checkout_api-${i}`,
        },
      });
    }

    const ctx: MetricCriteriaContext = makeContext({
      metricName: "http_server_request_errors",
      unit: null,
      groupBy: ["http.status_code", "k8s.pod.name"],
      totalSamplesInWindow: 100,
      breachingSamples: samples,
    });

    const lines: Array<string> = Markdown.convertToPlainText(
      section(ctx),
    ).split("\n");

    expect(lines.slice(0, 8)).toEqual([
      "Breaching Samples",
      "25 of 100 samples breached the threshold.",
      `${iso(0)} — 5`,
      "http.status_code: 503",
      "k8s.pod.name: checkout_api-1",
      `${iso(1)} — 6`,
      "http.status_code: 503",
      "k8s.pod.name: checkout_api-2",
    ]);
    expect(lines).toContain("k8s.pod.name: checkout_api-20");
    expect(lines[lines.length - 1]).toBe(
      "Showing the first 20 of 25 breaching samples.",
    );

    const wholeRootCause: string = Markdown.convertToPlainText(rootCause(ctx));

    expect(wholeRootCause).toContain("http_server_request_errors");
    expect(wholeRootCause).not.toContain("statuscode");
    expect(wholeRootCause).not.toContain("samples._");
  });
});
