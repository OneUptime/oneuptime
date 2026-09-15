import { describe, expect, test } from "@jest/globals";
import {
  AIRootCauseFeedContent,
  AI_ROOT_CAUSE_FEED_LEAD,
  DEFAULT_AI_ROOT_CAUSE_LABEL,
  FeedItemMarkdown,
  buildAIRootCauseFeedContent,
  getFeedItemMarkdown,
  stripCitationMarkers,
} from "../../FeatureSet/Dashboard/src/Utils/AIRootCauseFeedItem";

/*
 * The incident and alert feeds show an AI investigation as a short entry:
 * a lead, the Summary and the root cause, without citation markers. The full
 * report moves behind More Information. These tests pin that shape for every
 * report layout the parser understands, and pin that anything it cannot
 * structure is posted exactly as before.
 */

const LEAD: string = `**${AI_ROOT_CAUSE_FEED_LEAD}**`;

const SUMMARY_TEXT: string =
  "checkout-api p95 latency passed 2s at 18:01 UTC because its database pool was cut from 40 to 10 connections [C2][C3][C6]. Incidents #1017, #1029 and #1036 had the same cause [C1].";
const ROOT_CAUSE_TEXT: string =
  "Release 2026.09.14-2 started at 17:52:04 with `db pool configured max=10` (previously max=40) [C5]. The pool sat at its ceiling from 17:58 [C6], so checkout requests waited up to 2s for a connection [C2].";

const COMPACT_SUMMARY: string =
  "checkout-api p95 latency passed 2s at 18:01 UTC because its database pool was cut from 40 to 10 connections. Incidents #1017, #1029 and #1036 had the same cause.";
const COMPACT_ROOT_CAUSE: string =
  "Release 2026.09.14-2 started at 17:52:04 with `db pool configured max=10` (previously max=40). The pool sat at its ceiling from 17:58, so checkout requests waited up to 2s for a connection.";

const EXPECTED_COMPACT_TEXT: string = [
  LEAD,
  COMPACT_SUMMARY,
  `**Most likely root cause:** ${COMPACT_ROOT_CAUSE}`,
].join("\n\n");

/*
 * The exact layout AIInvestigationEngine.buildBrandedMarkdown posts: brand
 * heading, the model's bold lead-in sections, the server's Evidence checked
 * list and the footer.
 */
function serverReport(analysis: string): string {
  return [
    "## 🧠 AI — Automated Root Cause Analysis",
    "",
    analysis,
    "",
    "**Evidence checked**",
    '- **[C1]** Incident search "checkout latency" (3 found) — 3 row(s)',
    "- **[C2]** P95(http.server.request.duration), 2026-09-14T17:00:00.000Z — 2026-09-14T18:20:00.000Z — 80 row(s)",
    "- **[C3]** Logs — 50 row(s)",
    "",
    "---",
    "*Investigated automatically by OneUptime AI — read-only, 10 queries run across your own telemetry using claude-sonnet-4-5. This is an AI-generated first pass; verify before acting.*",
  ].join("\n");
}

const SERVER_ANALYSIS: string = [
  `**Summary** — ${SUMMARY_TEXT}`,
  `**Most likely root cause** — ${ROOT_CAUSE_TEXT}`,
  [
    "**Evidence**",
    "- p95 of `http.server.request.duration` rose from ~310 ms to 2.35 s [C2]",
    "- `db.client.connections.usage` stayed pinned at 10 [C6]",
  ].join("\n"),
  [
    "**Suggested next steps**",
    "1. Roll checkout-api back to 2026.09.14-1.",
    "2. Add a release check that fails when `DB_POOL_MAX` drops.",
  ].join("\n"),
].join("\n\n");

const SERVER_REPORT: string = serverReport(SERVER_ANALYSIS);

describe("buildAIRootCauseFeedContent", () => {
  test("turns the server's branded report into a lead, the summary and the root cause", () => {
    const content: AIRootCauseFeedContent =
      buildAIRootCauseFeedContent(SERVER_REPORT);

    expect(content.text).toBe(EXPECTED_COMPACT_TEXT);
    expect(content.moreInformationInMarkdown).toBe(SERVER_REPORT);
  });

  test("leaves the evidence, next steps, evidence checked list, footer and brand heading to More Information", () => {
    const content: AIRootCauseFeedContent =
      buildAIRootCauseFeedContent(SERVER_REPORT);

    for (const hidden of [
      "Automated Root Cause Analysis",
      "**Summary**",
      "Evidence",
      "Suggested next steps",
      "Roll checkout-api back",
      "Evidence checked",
      "row(s)",
      "Investigated automatically by OneUptime AI",
      "---",
    ]) {
      expect(content.text).not.toContain(hidden);
      expect(content.moreInformationInMarkdown).toContain(hidden);
    }

    expect(content.text).not.toMatch(/\[C\d+\]/);
  });

  test("the lead is the first paragraph and the root cause is its own labelled paragraph", () => {
    const paragraphs: Array<string> =
      buildAIRootCauseFeedContent(SERVER_REPORT).text.split("\n\n");

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toBe(LEAD);
    expect(paragraphs[1]).toBe(COMPACT_SUMMARY);
    expect(paragraphs[2]!.startsWith("**Most likely root cause:** ")).toBe(
      true,
    );
  });

  test("works without the brand heading, the evidence checked list or the footer", () => {
    const content: AIRootCauseFeedContent =
      buildAIRootCauseFeedContent(SERVER_ANALYSIS);

    expect(content.text).toBe(EXPECTED_COMPACT_TEXT);
    expect(content.moreInformationInMarkdown).toBe(SERVER_ANALYSIS);
  });

  test.each([
    [
      "ATX headings",
      `## Summary\n\n${SUMMARY_TEXT}\n\n## Most likely root cause\n\n${ROOT_CAUSE_TEXT}\n\n## Evidence\n\n- p95 rose [C2]`,
    ],
    [
      "level three headings with a closing sequence",
      `### Summary ###\n${SUMMARY_TEXT}\n### Most likely root cause ###\n${ROOT_CAUSE_TEXT}`,
    ],
    [
      "bold labels with the colon inside",
      `**Summary:** ${SUMMARY_TEXT}\n\n**Most likely root cause:** ${ROOT_CAUSE_TEXT}`,
    ],
    [
      "bold labels with the colon outside",
      `**Summary**: ${SUMMARY_TEXT}\n\n**Most likely root cause**: ${ROOT_CAUSE_TEXT}`,
    ],
    [
      "bold-only label lines",
      `**Summary**\n${SUMMARY_TEXT}\n\n**Most likely root cause**\n${ROOT_CAUSE_TEXT}`,
    ],
    [
      "underscore bold labels with an en dash",
      `__Summary__ – ${SUMMARY_TEXT}\n\n__Most likely root cause__ – ${ROOT_CAUSE_TEXT}`,
    ],
    [
      "plain labels",
      `Summary: ${SUMMARY_TEXT}\n\nMost likely root cause: ${ROOT_CAUSE_TEXT}`,
    ],
    [
      "headings with an inline body",
      `## Summary — ${SUMMARY_TEXT}\n\n## Most likely root cause — ${ROOT_CAUSE_TEXT}`,
    ],
  ])(
    "reads the summary and root cause from %s",
    (_style: string, markdown: string) => {
      const content: AIRootCauseFeedContent =
        buildAIRootCauseFeedContent(markdown);

      expect(content.text).toBe(EXPECTED_COMPACT_TEXT);
      expect(content.moreInformationInMarkdown).toBe(markdown);
    },
  );

  test("a TL;DR counts as the summary", () => {
    const markdown: string = `**TL;DR** — ${SUMMARY_TEXT}\n\n**Root cause** — ${ROOT_CAUSE_TEXT}`;

    expect(buildAIRootCauseFeedContent(markdown).text).toBe(
      [LEAD, COMPACT_SUMMARY, `**Root cause:** ${COMPACT_ROOT_CAUSE}`].join(
        "\n\n",
      ),
    );
  });

  test.each([
    ["Probable root cause", "Probable root cause"],
    ["Root cause hypothesis", "Root cause hypothesis"],
    [
      "Most likely root cause (medium confidence)",
      "Most likely root cause (medium confidence)",
    ],
    ["Root cause (*low* confidence)", "Root cause (low confidence)"],
    ["🔍 Likely root cause", "Likely root cause"],
  ])(
    "labels the root cause with the report's own title %j",
    (heading: string, label: string) => {
      const markdown: string = `## Summary\n\n${SUMMARY_TEXT}\n\n## ${heading}\n\n${ROOT_CAUSE_TEXT}`;

      expect(buildAIRootCauseFeedContent(markdown).text).toBe(
        [LEAD, COMPACT_SUMMARY, `**${label}:** ${COMPACT_ROOT_CAUSE}`].join(
          "\n\n",
        ),
      );
    },
  );

  test("the default root cause label is the one the investigation prompt asks for", () => {
    expect(DEFAULT_AI_ROOT_CAUSE_LABEL).toBe("Most likely root cause");
  });

  test("a report without a summary shows the lead and the root cause", () => {
    const markdown: string = serverReport(
      `**Most likely root cause** — ${ROOT_CAUSE_TEXT}\n\n**Evidence**\n- p95 rose [C2]`,
    );
    const content: AIRootCauseFeedContent =
      buildAIRootCauseFeedContent(markdown);

    expect(content.text).toBe(
      [LEAD, `**Most likely root cause:** ${COMPACT_ROOT_CAUSE}`].join("\n\n"),
    );
    expect(content.moreInformationInMarkdown).toBe(markdown);
  });

  test("a report without a root cause shows the lead and the summary", () => {
    const markdown: string = serverReport(
      `**Summary** — ${SUMMARY_TEXT}\n\n**Suggested next steps**\n1. Roll back.`,
    );
    const content: AIRootCauseFeedContent =
      buildAIRootCauseFeedContent(markdown);

    expect(content.text).toBe([LEAD, COMPACT_SUMMARY].join("\n\n"));
    expect(content.moreInformationInMarkdown).toBe(markdown);
  });

  test("a report with only evidence and next steps is not structured and stays as posted", () => {
    const markdown: string = serverReport(
      "**Evidence**\n- p95 rose [C2]\n\n**Suggested next steps**\n1. Roll back.",
    );

    expect(buildAIRootCauseFeedContent(markdown)).toEqual({ text: markdown });
  });

  test("sections holding nothing but citation markers leave the report as posted", () => {
    const markdown: string =
      "**Summary** — [C1][C2]\n\n**Most likely root cause** — [C3], [C4]";

    expect(buildAIRootCauseFeedContent(markdown)).toEqual({ text: markdown });
  });

  test("a citations-only summary is skipped while a real root cause is kept", () => {
    const markdown: string = `**Summary** — [C1] [C2]\n\n**Most likely root cause** — ${ROOT_CAUSE_TEXT}`;

    expect(buildAIRootCauseFeedContent(markdown)).toEqual({
      text: [LEAD, `**Most likely root cause:** ${COMPACT_ROOT_CAUSE}`].join(
        "\n\n",
      ),
      moreInformationInMarkdown: markdown,
    });
  });

  test("text before the first section is left to More Information", () => {
    const markdown: string = `## AI — Automated Root Cause Analysis\n\nI looked at 10 data sources before writing this.\n\n**Summary** — ${SUMMARY_TEXT}`;
    const content: AIRootCauseFeedContent =
      buildAIRootCauseFeedContent(markdown);

    expect(content.text).toBe([LEAD, COMPACT_SUMMARY].join("\n\n"));
    expect(content.moreInformationInMarkdown).toContain("10 data sources");
  });

  test("a multi-paragraph summary keeps its paragraphs", () => {
    const markdown: string =
      "## Summary\n\nPool saturated [C1].\n\nLatency recovered after the rollback [C2].\n\n## Root cause\n\nPool cut to 10 [C3].";

    expect(buildAIRootCauseFeedContent(markdown).text).toBe(
      [
        LEAD,
        "Pool saturated.\n\nLatency recovered after the rollback.",
        "**Root cause:** Pool cut to 10.",
      ].join("\n\n"),
    );
  });

  test.each([
    ["a bulleted list", "- Pool cut to 10 [C1]\n- Retries piled up [C2]"],
    ["a numbered list", "1. Pool cut to 10 [C1]\n2. Retries piled up [C2]"],
    ["a quote", "> Pool cut to 10 [C1]"],
    ["a table", "| Setting | Value |\n| --- | --- |\n| max | 10 [C1] |"],
    ["a fenced code block", "```\npool max=10 [C1]\n```"],
    ["an HTML block", "<details>Pool cut to 10 [C1]</details>"],
  ])(
    "a root cause that starts with %s puts the label on its own line",
    (_block: string, body: string) => {
      const markdown: string = `## Summary\n\nPool saturated.\n\n## Most likely root cause\n\n${body}`;
      const text: string = buildAIRootCauseFeedContent(markdown).text;

      expect(
        text.startsWith(
          `${LEAD}\n\nPool saturated.\n\n**Most likely root cause:**\n\n`,
        ),
      ).toBe(true);
    },
  );

  test("citation markers inside code in the root cause stay; the rest go", () => {
    const markdown: string =
      "## Summary\n\nPool saturated [C1].\n\n## Most likely root cause\n\nThe log line `pool exhausted [C9]` repeated [C2]:\n\n```\nERROR pool exhausted [C9]\n```";

    expect(buildAIRootCauseFeedContent(markdown).text).toBe(
      [
        LEAD,
        "Pool saturated.",
        "**Most likely root cause:** The log line `pool exhausted [C9]` repeated:\n\n```\nERROR pool exhausted [C9]\n```",
      ].join("\n\n"),
    );
  });

  test("CRLF reports produce the same compact text and keep the original as More Information", () => {
    const crlfReport: string = SERVER_REPORT.replace(/\n/g, "\r\n");
    const content: AIRootCauseFeedContent =
      buildAIRootCauseFeedContent(crlfReport);

    expect(content.text).toBe(EXPECTED_COMPACT_TEXT);
    expect(content.text).not.toContain("\r");
    expect(content.moreInformationInMarkdown).toBe(crlfReport);
  });

  test.each([
    [
      "a brand heading followed by prose",
      "## AI — Automated Root Cause Analysis\n\nThe incident was caused by connection exhaustion.",
    ],
    [
      "a brand heading with an unlabelled note, evidence checked list and footer",
      "## 🧠 AI — Automated Root Cause Analysis\n\nThe pool was exhausted [C1].\n\n**Evidence checked**\n- **[C1]** Logs — 4 row(s)\n\n---\n*Investigated automatically by OneUptime AI — read-only, 1 query run across your own telemetry. This is an AI-generated first pass; verify before acting.*",
    ],
    [
      "legacy headings the parser does not know",
      "## AI — Automated Root Cause Analysis\n\n### What happened\n\nPool exhausted [C1].\n\n### What to do\n\nRoll back.",
    ],
    ["plain prose", "Connection exhaustion [C1]."],
    ["a root cause label with no body", "**Summary**\n\n**Root cause**"],
    ["an empty report", ""],
    ["a whitespace-only report", "  \r\n\t\n"],
  ])(
    "%s is returned unchanged with no More Information",
    (_shape: string, markdown: string) => {
      const content: AIRootCauseFeedContent =
        buildAIRootCauseFeedContent(markdown);

      expect(content).toEqual({ text: markdown });
      expect(content.text).toBe(markdown);
      expect(content.moreInformationInMarkdown).toBeUndefined();
    },
  );

  test("a non-string report becomes empty text", () => {
    expect(buildAIRootCauseFeedContent(undefined as unknown as string)).toEqual(
      { text: "" },
    );
    expect(buildAIRootCauseFeedContent(null as unknown as string)).toEqual({
      text: "",
    });
  });

  test("model-authored markdown is passed through as text, never turned into anything else", () => {
    const markdown: string =
      "**Summary** — See [the runbook](https://evil.example/x) and <img src=x onerror=alert(1)> [C1].\n\n**Most likely root cause** — ![beacon](https://evil.example/b.png) pool [C2].";

    expect(buildAIRootCauseFeedContent(markdown).text).toBe(
      [
        LEAD,
        "See [the runbook](https://evil.example/x) and <img src=x onerror=alert(1)>.",
        "**Most likely root cause:** ![beacon](https://evil.example/b.png) pool.",
      ].join("\n\n"),
    );
  });

  test("markdown characters in a root cause title cannot break the bold label", () => {
    const markdown: string =
      "## Summary\n\nPool saturated.\n\n## Root cause (`medium` **confidence**)\n\nPool cut to 10.";

    expect(buildAIRootCauseFeedContent(markdown).text).toBe(
      [
        LEAD,
        "Pool saturated.",
        "**Root cause (medium confidence):** Pool cut to 10.",
      ].join("\n\n"),
    );
  });
});

describe("stripCitationMarkers", () => {
  test.each([
    ["a single marker and the space before it", "pool [C1].", "pool."],
    ["adjacent markers", "connection [C2][C3][C6].", "connection."],
    ["space-separated markers", "pool [C2] [C3] rose", "pool rose"],
    ["comma-separated markers", "pool [C2], [C3]; [C4] rose", "pool rose"],
    [
      "a marker before a comma",
      "pool [C1], then latency",
      "pool, then latency",
    ],
    ["a marker without a space before it", "pool[C1].", "pool."],
    [
      "markers at the end of the text",
      "pool saturated [C1][C2]",
      "pool saturated",
    ],
    ["a tab before a marker", "pool\t[C1].", "pool."],
    ["a marker glued to the next word", "pool [C1]saturated", "pool saturated"],
    ["a marker glued on both sides", "pool[C1]saturated", "pool saturated"],
    [
      "a marker after a full stop",
      "Pool cut.[C1]Latency rose.",
      "Pool cut. Latency rose.",
    ],
    ["a marker at the start", "[C1] Pool saturated.", "Pool saturated."],
    ["markers in empty parentheses", "pool ([C1]).", "pool."],
    ["a marker list in parentheses", "pool ([C1], [C2]) rose", "pool rose"],
    ["a marker inside non-empty parentheses", "pool (see [C1])", "pool (see)"],
    ["a marker inside bold", "**pool [C1]** rose", "**pool** rose"],
    ["a marker inside emphasis", "_pool [C1]_ rose", "_pool_ rose"],
    ["a marker before a closing quote", '"pool [C1]" rose', '"pool" rose'],
    ["three digit citation ids", "pool [C123] rose", "pool rose"],
    [
      "four digit ids, which are not markers",
      "pool [C1234] rose",
      "pool [C1234] rose",
    ],
    [
      "lower-case ids, which are not markers",
      "pool [c1] rose",
      "pool [c1] rose",
    ],
    [
      "other bracketed text",
      "pool [C] [CX] [1] rose",
      "pool [C] [CX] [1] rose",
    ],
    ["text with no markers", "Pool saturated.", "Pool saturated."],
    ["an empty string", "", ""],
  ])("handles %s", (_case: string, input: string, expected: string) => {
    expect(stripCitationMarkers(input)).toBe(expected);
  });

  test("markers inside inline code spans are literal text and stay", () => {
    expect(
      stripCitationMarkers("The log `pool [C1] exhausted` repeated [C2]."),
    ).toBe("The log `pool [C1] exhausted` repeated.");
    expect(
      stripCitationMarkers("Double ``code with ` and [C1]`` stays [C2]."),
    ).toBe("Double ``code with ` and [C1]`` stays.");
  });

  test("an unmatched backtick does not protect the markers after it", () => {
    expect(stripCitationMarkers("a ` tick [C1] here")).toBe("a ` tick here");
  });

  test("removing a marker between code spans cannot merge their backticks", () => {
    expect(stripCitationMarkers("`a` [C1]`b`")).toBe("`a` `b`");
    expect(stripCitationMarkers("`a`[C1]`b`")).toBe("`a` `b`");
  });

  test("markers inside fenced code blocks stay, including unclosed and tilde fences", () => {
    expect(
      stripCitationMarkers(
        "Before [C1].\n\n```log\nERROR [C2] pool\n```\n\nAfter [C3].",
      ),
    ).toBe("Before.\n\n```log\nERROR [C2] pool\n```\n\nAfter.");
    expect(
      stripCitationMarkers("Before [C1].\n~~~\n[C2]\n~~~\nAfter [C3]."),
    ).toBe("Before.\n~~~\n[C2]\n~~~\nAfter.");
    expect(stripCitationMarkers("Before [C1].\n```\n[C2]\n\n[C3]")).toBe(
      "Before.\n```\n[C2]\n\n[C3]",
    );
    expect(
      stripCitationMarkers("  - item [C1]\n    ```\n    [C2]\n    ```"),
    ).toBe("  - item\n    ```\n    [C2]\n    ```");
  });

  test("blank lines inside a fence are kept exactly", () => {
    expect(stripCitationMarkers("[C1] x\n```\na\n\n\nb\n```")).toBe(
      "x\n```\na\n\n\nb\n```",
    );
  });

  test("a line holding only markers is removed instead of splitting the paragraph", () => {
    expect(
      stripCitationMarkers("Pool saturated\n[C1] [C2]\nLatency rose"),
    ).toBe("Pool saturated\nLatency rose");
  });

  test("a paragraph holding only markers leaves a single blank line", () => {
    expect(
      stripCitationMarkers("Pool saturated.\n\n[C1][C2]\n\nLatency rose."),
    ).toBe("Pool saturated.\n\nLatency rose.");
  });

  test("list structure and indentation survive", () => {
    expect(
      stripCitationMarkers(
        "- [C1] Pool cut to 10\n- Retries piled up [C2]\n  [C3] continued\n1. Roll back [C4]",
      ),
    ).toBe("- Pool cut to 10\n- Retries piled up\n  continued\n1. Roll back");
  });

  test("a hard line break after a marker is kept", () => {
    expect(stripCitationMarkers("Pool saturated [C1]  \nLatency rose")).toBe(
      "Pool saturated  \nLatency rose",
    );
  });

  test("CRLF and CR line endings are normalised", () => {
    expect(stripCitationMarkers("Pool [C1].\r\n\r\nLatency [C2].\rDone")).toBe(
      "Pool.\n\nLatency.\nDone",
    );
    expect(stripCitationMarkers("No markers\r\nhere")).toBe("No markers\nhere");
  });

  test("a non-string input becomes an empty string", () => {
    expect(stripCitationMarkers(undefined as unknown as string)).toBe("");
  });

  test("long runs of whitespace around markers are handled in linear time", () => {
    const spaces: string = " ".repeat(50_000);
    const started: number = Date.now();

    expect(stripCitationMarkers(`pool${spaces}[C1].`)).toBe("pool.");
    expect(stripCitationMarkers(`[C1]${spaces}x`)).toBe("x");
    expect(stripCitationMarkers(`pool [C1]${spaces}[C2]${spaces}end`)).toBe(
      `pool${spaces}end`,
    );
    expect(stripCitationMarkers(`${"[C1]".repeat(10_000)} pool`)).toBe("pool");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("getFeedItemMarkdown", () => {
  test("an AI investigation with a structured report is compact, with the full report as More Information", () => {
    const markdown: FeedItemMarkdown = getFeedItemMarkdown({
      isAIInvestigation: true,
      feedInfoInMarkdown: SERVER_REPORT,
      moreInformationInMarkdown: undefined,
    });

    expect(markdown).toEqual({
      textInMarkdown: EXPECTED_COMPACT_TEXT,
      moreTextInMarkdown: SERVER_REPORT,
    });
  });

  test("an AI investigation whose report is not structured is unchanged", () => {
    const report: string =
      "## AI — Automated Root Cause Analysis\n\nThe incident was caused by connection exhaustion [C1].";

    expect(
      getFeedItemMarkdown({
        isAIInvestigation: true,
        feedInfoInMarkdown: report,
      }),
    ).toEqual({ textInMarkdown: report, moreTextInMarkdown: "" });
  });

  test("an item that is not an AI investigation is never compacted, even when it looks structured", () => {
    expect(
      getFeedItemMarkdown({
        isAIInvestigation: false,
        feedInfoInMarkdown: SERVER_REPORT,
        moreInformationInMarkdown: undefined,
      }),
    ).toEqual({ textInMarkdown: SERVER_REPORT, moreTextInMarkdown: "" });

    expect(
      getFeedItemMarkdown({
        isAIInvestigation: false,
        feedInfoInMarkdown: "## Root cause\n\nAn engineer found it [C1].",
        moreInformationInMarkdown: "Details",
      }),
    ).toEqual({
      textInMarkdown: "## Root cause\n\nAn engineer found it [C1].",
      moreTextInMarkdown: "Details",
    });
  });

  test("an AI item that already has More Information keeps it, and keeps its full text so the report stays visible", () => {
    expect(
      getFeedItemMarkdown({
        isAIInvestigation: true,
        feedInfoInMarkdown: SERVER_REPORT,
        moreInformationInMarkdown: "Run details posted by the server.",
      }),
    ).toEqual({
      textInMarkdown: SERVER_REPORT,
      moreTextInMarkdown: "Run details posted by the server.",
    });
  });

  test("whitespace-only More Information does not count as existing content", () => {
    expect(
      getFeedItemMarkdown({
        isAIInvestigation: true,
        feedInfoInMarkdown: SERVER_REPORT,
        moreInformationInMarkdown: " \n ",
      }),
    ).toEqual({
      textInMarkdown: EXPECTED_COMPACT_TEXT,
      moreTextInMarkdown: SERVER_REPORT,
    });
  });

  test("missing markdown becomes empty strings", () => {
    expect(getFeedItemMarkdown({ isAIInvestigation: true })).toEqual({
      textInMarkdown: "",
      moreTextInMarkdown: "",
    });
    expect(getFeedItemMarkdown({ isAIInvestigation: false })).toEqual({
      textInMarkdown: "",
      moreTextInMarkdown: "",
    });
  });
});
