/*
 * ORDINARY MARKDOWN AN EMAIL CARRIES, FOR GOLDEN TESTS.
 *
 * The descriptions, root causes and notes notifications carry, as people
 * and templates write them: headings, lists, tables, quotes, code, links,
 * references and screenshots, release notes, stack traces in list items,
 * and a long log line. The guard before marked (Utils/Markdown/SlowMarkdown
 * and OverLongText) holds back only Markdown marked reads slowly or cannot
 * read at all, so each of these must render exactly as it always did:
 * Tests/Fixtures/OrdinaryEmailMarkdown.golden.json holds what each rendered
 * to before #7597, #7598 and #7600 changed that guard, and
 * MarkdownEmailOrdinaryGolden.test.ts holds the renderer to it.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// A real 1x1 PNG, as the probe reports a screenshot: too short to hold back.
const ONE_PIXEL_PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const lines: (count: number, line: (index: number) => string) => string = (
  count: number,
  line: (index: number) => string,
): string => {
  const written: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    written.push(line(index));
  }

  return written.join("\n");
};

export interface OrdinaryEmailMarkdown {
  name: string;
  markdown: string;
}

export const ORDINARY_EMAIL_MARKDOWN: ReadonlyArray<OrdinaryEmailMarkdown> = [
  {
    name: "an incident's description",
    markdown: [
      "## Checkout API is down",
      "",
      "The **checkout** service returns `503` for *every* request since 10:42 UTC.",
      "See [the dashboard](https://grafana.example.com/d/abc?orgId=1&from=now-1h) and <https://status.example.com>,",
      "or https://example.com/runbooks/checkout for the runbook.  ",
      "Paged: @on-call (primary).",
    ].join("\n"),
  },
  {
    name: "lists, nested and numbered",
    markdown: [
      "- Impact",
      "  - EU customers cannot pay",
      "  - US customers see retries",
      "- Cause: a bad deploy",
      "",
      "1. Roll back `checkout@4.2.1`",
      "2. Purge the CDN",
      "3. Watch the error rate",
      "",
      "10) Ten",
      "11) Eleven",
    ].join("\n"),
  },
  {
    name: "a loose list with code in an item",
    markdown: [
      "- **Response body:**",
      "",
      "  ```json",
      '  {"error": "upstream timed out", "code": 504}',
      "  ```",
      "",
      "- **Headers:**",
      "",
      "      content-type: application/json",
      "      x-request-id: 4f2a",
    ].join("\n"),
  },
  {
    name: "a table",
    markdown: [
      "| Host | State | Since |",
      "| --- | :---: | ---: |",
      "| web-01 | **down** | 10:42 |",
      "| web-02 | up | 09:00 |",
      "| db-01 | `degraded` | 10:40 |",
    ].join("\n"),
  },
  {
    name: "a quote with a list",
    markdown: [
      "> From the customer:",
      "> - the page hangs",
      "> - then shows *Error 503*",
      ">",
      "> > Nested: we retried twice.",
    ].join("\n"),
  },
  {
    name: "a fenced log",
    markdown: `Last lines of the log:\n\n\`\`\`\n${lines(
      60,
      (index: number): string => {
        return `2026-11-15T10:${String(index % 60).padStart(2, "0")}:00Z ERROR checkout request ${index} failed: upstream timed out after 30000 ms`;
      },
    )}\n\`\`\`\n\nEnd of log.`,
  },
  {
    name: "references and definitions",
    markdown: [
      "See [the runbook][runbook], [the Runbook][RUNBOOK] and [status].",
      "![Home page][home] then [again][home].",
      "",
      "[runbook]: https://example.com/runbooks/checkout",
      '[status]: https://status.example.com "Status page"',
      "[home]: https://ci.example.com/runs/42/home.png 'Home'",
    ].join("\n"),
  },
  {
    name: "a screenshot, inline and by reference",
    markdown: [
      "Monitor is down - Timeout waiting for selector `#checkout`",
      "",
      `![Home](data:image/png;base64,${ONE_PIXEL_PNG})`,
      "",
      "![Again][shot]",
      "",
      `[shot]: data:image/png;base64,${ONE_PIXEL_PNG}`,
    ].join("\n"),
  },
  {
    name: "headings, rules and emphasis",
    markdown: [
      "Root cause",
      "==========",
      "",
      "Timeline",
      "--------",
      "",
      "### 10:42",
      "",
      "***",
      "",
      "A ***strong and emphasised*** word, ~~struck~~, __bold__, _italic_,",
      "snake_case_names and 2*3*4 stay as they are.",
    ].join("\n"),
  },
  {
    name: "escapes, HTML and entities",
    markdown: [
      "Not a list: \\- item, not *emphasis*: \\*a\\*, a backslash: \\\\.",
      'Raw HTML is escaped: <img src=x onerror="alert(1)"> <b>bold</b>.',
      "Entities: &amp; &lt; &copy; &#169; &nbsp;.",
      'A [link with **bold** text](https://example.com/a_b) and a [link with a title](https://example.com "Title").',
    ].join("\n"),
  },
  {
    name: "a release note of 300 items",
    markdown: `## What changed\n\n${lines(300, (index: number): string => {
      return `- Fixed issue #${7000 + index}: the probe dropped a check when the **monitor** had \`${index}\` [criteria](https://example.com/issues/${7000 + index})`;
    })}`,
  },
  {
    name: "a list item with a 300-line stack trace",
    markdown: `- **Error:** \`TypeError: Cannot read properties of undefined\`\n  \`\`\`\n${lines(
      300,
      (index: number): string => {
        return `      at Object.handler (/app/src/routes/checkout${index}.ts:${index + 10}:15)`;
      },
    )}\n  \`\`\`\n- Next step: roll back.`,
  },
  {
    name: "a list item of 200 lines of text",
    markdown: `- ${lines(200, (index: number): string => {
      return `  the probe in region ${index} saw the checkout endpoint time out twice`;
    }).trimStart()}\n- and then it recovered.`,
  },
  {
    name: "a loose list item of three paragraphs",
    markdown: `- First paragraph\n${lines(60, (): string => {
      return "  of an item that runs on";
    })}\n\n${lines(60, (): string => {
      return "  the second paragraph of it";
    })}\n\n${lines(60, (): string => {
      return "  and the third";
    })}\n\n- Another item.`,
  },
  {
    name: "a long log line with links at its ends",
    markdown: `[Run 42](https://ci.example.com/runs/42) ${"GET /api/checkout 200 12ms ".repeat(2700)}see [the trace](https://trace.example.com/t/abc) now`,
  },
  {
    name: "a long log line starting with a bare address",
    markdown: `https://example.com/logs/${"a-".repeat(200)} ${"request served in 12 ms ".repeat(3000)}done.`,
  },
  {
    name: "a paragraph of 60 references",
    markdown: `${lines(60, (index: number): string => {
      return index % 2 === 0
        ? `![Shot ${index}][s${index % 7}]`
        : `[Run ${index}][s${index % 7}]`;
    })}\n\n${lines(7, (index: number): string => {
      return `[s${index}]: https://ci.example.com/runs/${index}/shot.png`;
    })}`,
  },
  {
    name: "task lists",
    markdown: [
      "- [x] Page the on-call",
      "- [ ] Write the postmortem",
      "- [ ] [Update the status page](https://status.example.com)",
    ].join("\n"),
  },
  {
    name: "definitions in a list item and a quote",
    markdown: [
      "- See [one].",
      "",
      "  [one]: https://example.com/one",
      "",
      "> And [two].",
      ">",
      "> [two]: https://example.com/two",
    ].join("\n"),
  },
  {
    name: "an empty field and white space",
    markdown: "   \n\n  ",
  },
];
