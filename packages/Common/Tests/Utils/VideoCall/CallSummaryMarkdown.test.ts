import { describe, expect, test } from "@jest/globals";
import {
  CallSummaryBasis,
  CallSummaryCitation,
  CallSummaryRootCause,
  CallSummaryRootCauseOutcome,
} from "../../../Types/VideoCall/CallSummary";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import CallSummaryMarkdown from "../../../Utils/VideoCall/CallSummaryMarkdown";
import { renderAsDashboard } from "../Markdown/DashboardMarkdownRenderer";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * THE ROOT CAUSE A PERSON STARTS FROM when they use OneUptime AI's
 * suggestion from an incident call: the suggestion, then each transcript
 * line it rests on as a plain quote, in the order they were said.
 *
 * It opens in the root cause's editor (MarkdownConverters), which honours
 * no backslash escape, reads an underscore inside a word as emphasis and
 * keeps a few HTML tags wherever they stand; once saved, the incident page
 * shows it (GitHub Markdown, which hides a backslash before punctuation and
 * reads entities). Both pieces are somebody else's text. So each suite here
 * reads the text both ways, as a person sees it: the words exactly as they
 * were written or said, nothing restyled, hidden, linked or turned into
 * markup - and the editor saves it back unchanged when nobody edits it.
 */

const ROOT_CAUSE: CallSummaryRootCause = {
  outcome: CallSummaryRootCauseOutcome.Suggested,
  summary:
    "checkout-api 2026.09.14-2 shipped with DB_POOL_MAX=10 instead of 40, so requests queued.",
  basis: CallSummaryBasis.StatedOnCall,
  citations: [
    {
      line: 11,
      time: "00:10:20",
      speaker: "Maya Chen",
      text: "So the pool size change caused it.",
    },
    {
      line: 6,
      time: "00:04:03",
      speaker: "Sam Rivera",
      text: "The new release has DB_POOL_MAX=10, it was 40 before.",
    },
    { line: 9, text: "Rolling back now." },
  ],
};

// Texts each reader would otherwise show differently from how they were written.
const TRICKY_TEXTS: Array<string> = [
  "DB_POOL_MAX=10 and max_connections=100 on db_primary.",
  "**bold** *em* _em_ __strong__ ***both*** ~~strike~~ ~one~ a*b*c a_b_c",
  "[click here](https://evil.example) ![pixel](https://tracker.example/p.png) [ref][1] [^note] [ ] [x]",
  "<u>under</u> <br> <br/> <BR /> <sub>x</sub> <SUP>y</SUP> <kbd>k</kbd> <u class=x>a</u> x<br>y <<u>>",
  "<script>alert(1)</script> <https://evil.example> <ops@example.com> <!-- hidden --> <img src=x onerror=alert(1)>",
  "&lt;b&gt; &amp; &#169; &#x41; R&D AT&T",
  "C:\\Users\\ops\\*.log a\\_b \\[x\\] trailing\\",
  "C:\\temp\\. \\# a\\!b \\> x",
  "a<b, <img src=x> and <!-- c --> mid-line",
  "{{incident.title}} {{x_y}} {{ a }}",
  "`code` ``double`` x`y `",
  "https://example.com/a_b_c www.example.com user@example.com",
  "p99 <200ms and 3 < 4 > 2 and a<b, x -> y, a => b",
  "(DB_POOL_MAX=10) \"max_conn\" 'a_b' \u201Cc_d\u201D \u2018e_f\u2019",
  "| a | b |",
];

// Texts whose first word would make their line a heading, a list, a quote, a rule or code.
const LINE_STARTS: Array<string> = [
  "# heading",
  "###### six",
  "- item",
  "+ item",
  "* item",
  "1. item",
  "1) item",
  "> quote",
  ">quote",
  "---",
  "- - -",
  "--- x",
  "~~~",
  "```",
  "[!WARNING] x",
  "**Note:** x",
  "    indented",
  "\tindented",
  "<div>x</div>",
  "<div class=x>y</div>",
  "<img src=x>",
  "<200ms is fine",
];

// The text as a person sees it: backticks are written as ' and whitespace runs are one space.
function asSeen(text: string): string {
  return text
    .split("`")
    .join("'")
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .join(" ");
}

function fragmentOf(html: string): DocumentFragment {
  const template: HTMLTemplateElement = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function elementNamesIn(fragment: DocumentFragment): Array<string> {
  return Array.from(fragment.querySelectorAll("*")).map(
    (element: Element): string => {
      return element.tagName.toLowerCase();
    },
  );
}

// What each top-level block (the suggestion, each quote) shows.
function blockTexts(fragment: DocumentFragment): Array<string> {
  return Array.from(fragment.children).map((element: Element): string => {
    return asSeen(element.textContent || "");
  });
}

function rootCauseFrom(
  summary: string,
  citations: Array<CallSummaryCitation> = [],
): CallSummaryRootCause {
  return {
    outcome: CallSummaryRootCauseOutcome.Suggested,
    summary,
    basis: CallSummaryBasis.Inferred,
    citations,
  };
}

// The suggestion is the text, and so is the one line it quotes, said with no time or speaker.
function markdownFor(text: string): string {
  return CallSummaryMarkdown.buildRootCause(
    rootCauseFrom(text, [{ line: 1, text }]),
  );
}

describe("CallSummaryMarkdown.buildRootCause", () => {
  test("the suggestion, then each cited line as a quote, in the order it was said", () => {
    expect(CallSummaryMarkdown.buildRootCause(ROOT_CAUSE)).toBe(
      [
        "checkout-api 2026.09.14-2 shipped with `DB_POOL_MAX=10` instead of 40, so requests queued.",
        "> 00:04:03 · Sam Rivera: The new release has `DB_POOL_MAX=10`, it was 40 before.",
        "> Rolling back now.",
        "> 00:10:20 · Maya Chen: So the pool size change caused it.",
      ].join("\n\n"),
    );
  });

  test("the editor shows it as written - DB_POOL_MAX is not italic - and saves it back unchanged", () => {
    const markdown: string = CallSummaryMarkdown.buildRootCause(ROOT_CAUSE);
    const html: string = markdownToHtml(markdown);
    const fragment: DocumentFragment = fragmentOf(html);

    expect(
      Array.from(fragment.children).map((element: Element): string => {
        return element.tagName.toLowerCase();
      }),
    ).toEqual(["p", "blockquote", "blockquote", "blockquote"]);
    expect(blockTexts(fragment)).toEqual([
      "checkout-api 2026.09.14-2 shipped with DB_POOL_MAX=10 instead of 40, so requests queued.",
      "00:04:03 · Sam Rivera: The new release has DB_POOL_MAX=10, it was 40 before.",
      "Rolling back now.",
      "00:10:20 · Maya Chen: So the pool size change caused it.",
    ]);
    expect(new Set(elementNamesIn(fragment))).toEqual(
      new Set(["p", "blockquote", "code"]),
    );
    expect(htmlToMarkdown(html)).toBe(markdown);
  });

  test("the incident page shows it as written too, each line its own quote", () => {
    const markdown: string = CallSummaryMarkdown.buildRootCause(ROOT_CAUSE);
    const fragment: DocumentFragment = fragmentOf(
      renderAsDashboard([markdown])[0]!,
    );

    expect(
      Array.from(fragment.children).map((element: Element): string => {
        return element.tagName.toLowerCase();
      }),
    ).toEqual(["p", "blockquote", "blockquote", "blockquote"]);
    expect(blockTexts(fragment)[1]).toBe(
      "00:04:03 · Sam Rivera: The new release has DB_POOL_MAX=10, it was 40 before.",
    );
    expect(elementNamesIn(fragment)).not.toContain("em");
  });

  test("somebody else's words stay words in the editor: nothing restyled, linked, hidden or tagged", () => {
    for (const text of [...TRICKY_TEXTS, ...LINE_STARTS]) {
      const markdown: string = markdownFor(text);
      const html: string = markdownToHtml(markdown);
      const fragment: DocumentFragment = fragmentOf(html);

      // A paragraph and a quote of plain text and code, nothing else.
      expect({ text, blocks: blockTexts(fragment) }).toEqual({
        text,
        blocks: [asSeen(text), asSeen(text)],
      });
      for (const name of elementNamesIn(fragment)) {
        expect({
          text,
          name,
          allowed: ["p", "blockquote", "code"].includes(name),
        }).toEqual({
          text,
          name,
          allowed: true,
        });
      }
      // Saved untouched, the root cause is what was written.
      expect({ text, saved: htmlToMarkdown(html) }).toEqual({
        text,
        saved: markdown,
      });
    }
  });

  test("and on the incident page: a bare address may link, showing itself, and nothing else does", () => {
    const texts: Array<string> = [...TRICKY_TEXTS, ...LINE_STARTS];
    const rendered: Array<string> = renderAsDashboard(texts.map(markdownFor));

    texts.forEach((text: string, index: number) => {
      const fragment: DocumentFragment = fragmentOf(rendered[index]!);

      expect({ text, blocks: blockTexts(fragment) }).toEqual({
        text,
        blocks: [asSeen(text), asSeen(text)],
      });
      for (const name of elementNamesIn(fragment)) {
        expect({
          text,
          name,
          allowed: ["p", "blockquote", "code", "a"].includes(name),
        }).toEqual({
          text,
          name,
          allowed: true,
        });
      }
      for (const link of Array.from(fragment.querySelectorAll("a"))) {
        const address: string = link.getAttribute("href") || "";

        expect({
          text,
          address,
          showsItself: address.endsWith(link.textContent || "-"),
        }).toEqual({
          text,
          address,
          showsItself: true,
        });
      }
    });
  });

  test("a first word that would make the line a heading, list, quote or rule is written as code", () => {
    expect(CallSummaryMarkdown.asEditorText("# not a heading")).toBe(
      "`#` not a heading",
    );
    expect(CallSummaryMarkdown.asEditorText("- not a list")).toBe(
      "`-` not a list",
    );
    expect(CallSummaryMarkdown.asEditorText("1. not a list")).toBe(
      "`1.` not a list",
    );
    expect(CallSummaryMarkdown.asEditorText("1) not a list")).toBe(
      "`1)` not a list",
    );
    expect(CallSummaryMarkdown.asEditorText(">not a quote")).toBe(
      "`>not` a quote",
    );
    expect(CallSummaryMarkdown.asEditorText("---")).toBe("`---`");
    // Anywhere else in the line they are plain words.
    expect(CallSummaryMarkdown.asEditorText("a - b # c 1. d > e")).toBe(
      "a - b # c 1. d > e",
    );
  });

  test("punctuation around a word written as code stays outside it, and a backtick cannot end the code", () => {
    expect(CallSummaryMarkdown.asEditorText("set max_connections.")).toBe(
      "set `max_connections`.",
    );
    expect(CallSummaryMarkdown.asEditorText("(DB_POOL_MAX=10),")).toBe(
      "(`DB_POOL_MAX=10`),",
    );
    expect(CallSummaryMarkdown.asEditorText("run `kubectl_get` now")).toBe(
      "run '`kubectl_get`' now",
    );
    expect(CallSummaryMarkdown.asEditorText("_")).toBe("`_`");
  });

  test("a tag the editor keeps, <u> or <br>, keeps its < out of the code, where the editor would still read it", () => {
    expect(CallSummaryMarkdown.asEditorText("<u>under</u>")).toBe(
      "<`u>under`<`/u>`",
    );
    expect(CallSummaryMarkdown.asEditorText("x<br>y")).toBe("x<`br>y`");
    expect(CallSummaryMarkdown.asEditorText("a_b<br>")).toBe("`a_b`<`br>`");
    // Not a tag the editor keeps: the word is code as it is.
    expect(CallSummaryMarkdown.asEditorText("x <ul>")).toBe("x `<ul>`");
    // An address in angle brackets, which the page would show as a bare link.
    expect(
      CallSummaryMarkdown.asEditorText("see <https://evil.example>."),
    ).toBe("see `<https://evil.example>`.");
    // A < that closes nothing in its word stays a <, as both show it.
    expect(CallSummaryMarkdown.asEditorText("p99 <200ms, a<b")).toBe(
      "p99 <200ms, a<b",
    );
  });

  test("a quote names the time and the speaker it has, and reads as a quote, never as a callout", () => {
    expect(
      CallSummaryMarkdown.quote({
        line: 3,
        speaker: " Priya Shah ",
        text: "Restarting.",
      }),
    ).toBe("> Priya Shah: Restarting.");
    expect(
      CallSummaryMarkdown.quote({
        line: 3,
        time: "00:01:02",
        text: "Restarting.",
      }),
    ).toBe("> 00:01:02: Restarting.");
    expect(
      CallSummaryMarkdown.quote({
        line: 3,
        time: " ",
        speaker: "",
        text: "Restarting.",
      }),
    ).toBe("> Restarting.");

    const markdown: string = CallSummaryMarkdown.buildRootCause(
      rootCauseFrom("**Note:** the cache", [
        { line: 1, speaker: "[!WARNING]", text: "the pool" },
        { line: 2, text: "**Note:** the pool" },
        { line: 3, text: "[!TIP]" },
      ]),
    );

    for (const line of markdown.split("\n")) {
      expect(line.startsWith("> [!")).toBe(false);
      expect(line.startsWith("> **")).toBe(false);
    }
    expect(markdown).toContain("> `[!WARNING]`: the pool");
  });

  test("control characters and line breaks become spaces, so the text stays one line", () => {
    expect(CallSummaryMarkdown.asEditorText("a\u0000b\u0007c\u007F")).toBe(
      "a b c",
    );
    expect(CallSummaryMarkdown.asEditorText(" line\nbreak\r\n\ttab  ")).toBe(
      "line break tab",
    );
    expect(
      CallSummaryMarkdown.buildRootCause(
        rootCauseFrom("one\n\n# two", [{ line: 1, text: "three\n> four" }]),
      ),
    ).toBe("one # two\n\n> three > four");
  });

  test("a call that did not settle the cause gives nothing to start from", () => {
    expect(
      CallSummaryMarkdown.buildRootCause({
        outcome: CallSummaryRootCauseOutcome.NotEnoughDiscussion,
        citations: [],
      }),
    ).toBe("");
    for (const summary of ["", " \n\t ", "\u0000\u0007"]) {
      expect(
        CallSummaryMarkdown.buildRootCause({
          outcome: CallSummaryRootCauseOutcome.Suggested,
          summary,
          citations: [{ line: 1, text: "x" }],
        }),
      ).toBe("");
    }
  });

  test("the time to write a long text grows with its length", () => {
    const worstCases: Array<string> = [
      "a_b *c* [d](e) <u> &amp; \\ ".repeat(16_000),
      "<".repeat(400_000),
      "<u>".repeat(140_000),
      "-".repeat(400_000),
      "&".repeat(400_000),
      `${"1".repeat(400_000)}.`,
      " \n\t".repeat(140_000),
    ];

    for (const text of worstCases) {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          CallSummaryMarkdown.asEditorText(text);
        },
        limitInMs: 2_000,
      });

      expect(timed.inMs).toBeLessThan(2_000);
    }
  });
});
