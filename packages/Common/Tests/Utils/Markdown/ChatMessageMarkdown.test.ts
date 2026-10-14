import { describe, expect, test } from "@jest/globals";
import { marked } from "marked";
import ChatMessageMarkdown, {
  ChatBlock,
  ChatInline,
  ChatMessageContent,
  ChatTextStyle,
} from "../../../Utils/Markdown/ChatMessageMarkdown";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import { renderAsDashboard } from "./DashboardMarkdownRenderer";
import {
  decodeHtmlEntities,
  htmlAsText,
  visibleText,
} from "../../Helpers/HtmlText";
import { replaceHtmlMarkup } from "../../../Types/HtmlMarkup";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * A SLACK OR MICROSOFT TEAMS MESSAGE, AS THE MARKDOWN OF A NOTE.
 *
 * ChatMessageMarkdown writes what a chat message is made of - paragraphs,
 * lists, quotes, code, and runs of styled text and links - as Markdown that
 * reads as the message did in the chat, in every renderer a note reaches:
 * the dashboard (micromark with its GitHub extensions, renderAsDashboard),
 * the emails (marked) and the chats (slackify). Whatever the message's own
 * text holds, it reads as typed: only the structure the chat had becomes
 * Markdown.
 */

const text: (value: string, style?: ChatTextStyle) => ChatInline = (
  value: string,
  style?: ChatTextStyle,
): ChatInline => {
  return { type: "text", text: value, style: style };
};

const link: (
  url: string,
  words?: string,
  style?: ChatTextStyle,
) => ChatInline = (
  url: string,
  words?: string,
  style?: ChatTextStyle,
): ChatInline => {
  return { type: "link", url: url, text: words, style: style };
};

const paragraph: (...inlines: Array<ChatInline>) => ChatBlock = (
  ...inlines: Array<ChatInline>
): ChatBlock => {
  return { type: "paragraph", inlines: inlines };
};

const markdownOf: (...blocks: Array<ChatBlock>) => string = (
  ...blocks: Array<ChatBlock>
): string => {
  return ChatMessageMarkdown.toMarkdown({ blocks: blocks }).toString();
};

const emailHtmlOf: (markdown: string) => string = (
  markdown: string,
): string => {
  return marked.parse(markdown, { async: false }) as string;
};

// A paragraph's or a line break's tag: where words are apart.
const SPACING_TAG: RegExp = /^<\/?(?:p|br)\b/i;

/*
 * The words a rendered note shows: a paragraph or a line break between
 * them a space, any other tag nothing (it is inside a line), the
 * references read once, white space runs one space.
 */
const readText: (html: string) => string = (html: string): string => {
  return FeedMarkdown.withoutInvisibleBreaks(
    decodeHtmlEntities(
      replaceHtmlMarkup(html, (markup: string): string => {
        return SPACING_TAG.test(markup) ? " " : "";
      }),
    ),
  )
    .split(/\s+/)
    .join(" ")
    .trim();
};

// Tags a rendered note may hold, by name: only what the renderer writes.
const TAG_NAME: RegExp = /<([a-z][a-z0-9]*)\b/g;

const tagsOf: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return Array.from(html.matchAll(TAG_NAME)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
};

const HREF: RegExp = /href="([^"]*)"/g;

// A link element: its address and what it shows.
const LINK_ELEMENT: RegExp = /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

const hrefsOf: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return Array.from(html.matchAll(HREF)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!.split("&amp;").join("&");
    },
  );
};

describe("ChatMessageMarkdown.toMarkdown: a message as it read in the chat", () => {
  test("a paragraph of plain text is its text", () => {
    expect(markdownOf(paragraph(text("Restarted the primary DB")))).toBe(
      "Restarted the primary DB",
    );
  });

  test("line breaks are kept as hard breaks, a blank line starts a paragraph", () => {
    expect(
      markdownOf(paragraph(text("line one\nline two\n\n\nnext paragraph"))),
    ).toBe("line one  \nline two\n\nnext paragraph");

    const html: string = renderAsDashboard([
      markdownOf(paragraph(text("line one\nline two\n\nnext paragraph"))),
    ])[0]!;

    expect(html).toBe("<p>line one<br />\nline two</p>\n<p>next paragraph</p>");
  });

  test("each style is its Markdown, and together they nest", () => {
    expect(
      markdownOf(
        paragraph(
          text("bold", { bold: true }),
          text(" "),
          text("italic", { italic: true }),
          text(" "),
          text("gone", { strike: true }),
          text(" "),
          text("code", { code: true }),
          text(" "),
          text("all", { bold: true, italic: true, strike: true }),
          text(" "),
          text("bold code", { bold: true, code: true }),
        ),
      ),
    ).toBe("**bold** *italic* ~~gone~~ `code` ~~***all***~~ **`bold code`**");
  });

  test("white space at a styled run's ends goes outside its markers", () => {
    expect(
      markdownOf(
        paragraph(text("see"), text(" the docs ", { bold: true }), text("now")),
      ),
    ).toBe("see **the docs** now");
  });

  test("two runs whose markers would touch get a word joiner between them", () => {
    const markdown: string = markdownOf(
      paragraph(text("bold", { bold: true }), text("italic", { italic: true })),
    );

    expect(markdown).toBe("**bold**⁠*italic*");

    for (const html of [
      renderAsDashboard([markdown])[0]!,
      emailHtmlOf(markdown),
    ]) {
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<em>italic</em>");
    }
  });

  test("emphasis Markdown could not show there is left out, never shown as asterisks", () => {
    /*
     * "x**(paren)**y": an opening "**" before punctuation needs white space
     * or punctuation before it. The words are kept, the bold is not.
     */
    const markdown: string = markdownOf(
      paragraph(text("x"), text("(paren)", { bold: true }), text("y")),
    );

    expect(markdown).toBe("x(paren)y");
  });

  test("text after words on its line is written as typed: no list or heading starts there", () => {
    // "**Update** - rolled back": the "-" opens no list after "Update".
    expect(
      markdownOf(
        paragraph(text("Update", { bold: true }), text(" - rolled back")),
      ),
    ).toBe("**Update** - rolled back");
    expect(
      markdownOf(
        paragraph(
          text("api", { code: true }),
          text(" + db "),
          link("https://x.example/pr/1", "PR"),
          text(" # 1. merged"),
        ),
      ),
    ).toBe("`api` + db [PR](https://x.example/pr/1) # 1. merged");

    // At the start of a line - its first run, or after markers only - they are text.
    expect(markdownOf(paragraph(text("- rolled back")))).toBe(
      "\\- rolled back",
    );
    expect(
      markdownOf(paragraph(text("1"), text(". ", { bold: true }), text("x"))),
    ).toBe("1\\. x");
    expect(
      markdownOf(
        paragraph(text("- "), text("+ "), text("# x", { bold: true })),
      ),
    ).toBe("\\- + **# x**");

    // Inside emphasis no block starts: a long run's words are as typed.
    const long: string = `${"word ".repeat(300)}- a \`b\` + c`;

    expect(markdownOf(paragraph(text(long, { bold: true })))).toBe(
      `**${long.trim().split("`").join("\\`")}**`,
    );
  });

  test("a mention is a name, and a channel-wide mention notifies nobody", () => {
    const markdown: string = markdownOf(
      paragraph(text("cc "), text("@Aidil Rahman"), text(" and <!channel>")),
    );

    expect(markdown).toContain("@Aidil Rahman");
    // Slack would read <!channel> as a mention of everyone: broken.
    expect(SlackUtil.slackify(markdown)).not.toContain("<!channel>");
    expect(
      FeedMarkdown.withoutInvisibleBreaks(
        visibleText(renderAsDashboard([markdown])[0]!),
      ),
    ).toBe("cc @Aidil Rahman and <!channel>");
  });

  test("a link is a link, with its words", () => {
    expect(
      markdownOf(
        paragraph(
          text("Runbook: "),
          link("https://wiki.example.com/runbooks/db", "the runbook"),
        ),
      ),
    ).toBe("Runbook: [the runbook](https://wiki.example.com/runbooks/db)");
  });

  test("a link with no words shows its address", () => {
    expect(markdownOf(paragraph(link("https://status.example.com/a_b")))).toBe(
      "[https://status.example.com/a\\_b](https://status.example.com/a_b)",
    );
  });

  test("a mailto link is a link", () => {
    expect(
      hrefsOf(
        renderAsDashboard([
          markdownOf(paragraph(link("mailto:oncall@example.com", "mail us"))),
        ])[0]!,
      ),
    ).toEqual(["mailto:oncall@example.com"]);
  });

  test.each([
    [
      "a relative address, which would point into OneUptime",
      "/settings/billing",
    ],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<b>x</b>"],
    ["a Slack app link", "slack://channel?id=C1"],
    ["vbscript:", "vbscript:msgbox(1)"],
  ])(
    "%s is never linked: its words and address are text",
    (_case: string, address: string) => {
      const markdown: string = markdownOf(paragraph(link(address, "click")));
      const html: string = renderAsDashboard([markdown])[0]!;

      expect(hrefsOf(html)).toEqual([]);
      expect(hrefsOf(emailHtmlOf(markdown))).toEqual([]);
      expect(FeedMarkdown.withoutInvisibleBreaks(visibleText(html))).toBe(
        `click (${address})`,
      );
    },
  );

  test("a link whose words look like another site's address shows its real address", () => {
    const markdown: string = markdownOf(
      paragraph(
        link("https://evil.example/login", "https://bank.example/login"),
      ),
    );

    expect(markdown).toBe(
      "[https://evil.example/login](https://evil.example/login)",
    );
  });

  test("a link whose words are its own address, or a page of its site, keeps them", () => {
    expect(
      markdownOf(
        paragraph(link("https://status.example.com/x", "status.example.com")),
      ),
    ).toBe("[status.example.com](https://status.example.com/x)");
    expect(
      markdownOf(
        paragraph(
          link(
            "https://grafana.example.com/d/1",
            "https://grafana.example.com",
          ),
        ),
      ),
    ).toBe("[https://grafana.example.com](https://grafana.example.com/d/1)");
  });

  test("a file or an image is a link to it, marked, never an image", () => {
    const markdown: string = markdownOf(
      paragraph({
        type: "link",
        url: "https://acme.slack.com/files/U1/F1/screenshot.png",
        text: "screenshot.png",
        isAttachment: true,
      }),
    );

    expect(markdown).toBe(
      "📎 [screenshot.png](https://acme.slack.com/files/U1/F1/screenshot.png)",
    );

    const html: string = renderAsDashboard([markdown])[0]!;

    expect(tagsOf(html)).toEqual(["p", "a"]);
  });

  test("a note written without attachments leaves files and images out, and a paragraph of only them", () => {
    const blocks: Array<ChatBlock> = [
      paragraph(text("Graph attached")),
      paragraph({
        type: "link",
        url: "https://acme.slack.com/files/U1/F1/graph.png",
        text: "graph.png",
        isAttachment: true,
      }),
    ];

    expect(
      ChatMessageMarkdown.toMarkdown(
        { blocks: blocks },
        { withoutAttachments: true },
      ).toString(),
    ).toBe("Graph attached");
    expect(
      ChatMessageMarkdown.isEmpty(
        { blocks: [blocks[1]!] },
        { withoutAttachments: true },
      ),
    ).toBe(true);
    expect(ChatMessageMarkdown.isEmpty({ blocks: [blocks[1]!] })).toBe(false);
  });

  test("a backtick typed next to an address is never code", () => {
    const markdown: string = markdownOf(
      paragraph(text("see https://x.example/a`b` and ``c``")),
    );

    expect(markdown).toBe("see https://x.example/a\\`b\\` and \\`\\`c\\`\\`");

    const html: string = renderAsDashboard([markdown])[0]!;

    expect(html).not.toContain("<code>");
    /*
     * A bare address is a link up to what Markdown readers take as its end,
     * the next space: escapes typed glued to it are in it, as they are
     * wherever mdText places an address (FeedMarkdown).
     */
    expect(hrefsOf(html)).toEqual(["https://x.example/a%5C%60b%5C%60"]);
  });

  test("a code block is fenced, with no language, longer than any fence inside it", () => {
    const markdown: string = markdownOf({
      type: "code",
      text: "\n\nkubectl get pods\n```mermaid\ngraph TD\n```\n\n",
    });

    expect(markdown).toBe(
      "````\nkubectl get pods\n```mermaid\ngraph TD\n```\n````",
    );

    const html: string = renderAsDashboard([markdown])[0]!;

    // Code, shown as written: never a diagram.
    expect(tagsOf(html)).toEqual(["pre", "code"]);
    expect(html).not.toContain("language-");
  });

  test("a chat mention inside code is broken too: Slack reads mentions in code", () => {
    const markdown: string = markdownOf(
      { type: "code", text: "curl <https://x|y> && echo <!here>" },
      paragraph(text("run "), text("<@U0123ABC>", { code: true })),
    );

    const slack: string = SlackUtil.slackify(markdown);

    expect(slack).not.toContain("<!here>");
    expect(slack).not.toContain("<@U0123ABC>");
    expect(slack).not.toContain("<https://x|y>");
  });

  test("an empty code block, or empty paragraphs, write nothing", () => {
    expect(
      markdownOf(
        { type: "code", text: "\n \n" },
        paragraph(text("  \n ")),
        paragraph(),
      ),
    ).toBe("");
    expect(ChatMessageMarkdown.isEmpty({ blocks: [] })).toBe(true);
  });

  test("a bulleted list, a nested ordered list after it, and the list again", () => {
    const markdown: string = markdownOf(
      paragraph(text("Steps:")),
      {
        type: "list",
        ordered: false,
        indent: 0,
        items: [
          [text("drain node-3")],
          [text("roll back "), text("v2.4.1", { code: true })],
        ],
      },
      {
        type: "list",
        ordered: true,
        indent: 1,
        start: 1,
        items: [[text("check lag")], [text("check errors")]],
      },
      {
        type: "list",
        ordered: false,
        indent: 0,
        items: [[text("close the incident")]],
      },
    );

    expect(markdown).toBe(
      "Steps:\n\n- drain node-3\n- roll back `v2.4.1`\n    1. check lag\n    2. check errors\n- close the incident",
    );

    const html: string = renderAsDashboard([markdown])[0]!;

    expect(tagsOf(html)).toEqual([
      "p",
      "ul",
      "li",
      "li",
      "code",
      "ol",
      "li",
      "li",
      "li",
    ]);
  });

  test("an ordered list keeps its first number, and an item that spans lines stays one item", () => {
    const markdown: string = markdownOf({
      type: "list",
      ordered: true,
      indent: 0,
      start: 3,
      items: [[text("first line\nsecond line")], [text("next")]],
    });

    expect(markdown).toBe("3. first line  \n   second line\n4. next");

    const html: string = renderAsDashboard([markdown])[0]!;

    expect(html).toContain('<ol start="3">');
    expect(
      tagsOf(html).filter((tag: string): boolean => {
        return tag === "li";
      }),
    ).toHaveLength(2);
  });

  test("a list is nested at most one level below the list before it", () => {
    // Alone, a nested list is a list of its own: indented, it would be code.
    expect(
      markdownOf({
        type: "list",
        ordered: false,
        indent: 3,
        items: [[text("deep")]],
      }),
    ).toBe("- deep");

    // A jump of levels is one level.
    expect(
      markdownOf(
        { type: "list", ordered: false, indent: 0, items: [[text("top")]] },
        { type: "list", ordered: false, indent: 4, items: [[text("deep")]] },
        { type: "list", ordered: false, indent: 9, items: [[text("deeper")]] },
      ),
    ).toBe("- top\n    - deep\n        - deeper");
  });

  test("a list nested deeper than five levels stays at five", () => {
    const blocks: Array<ChatBlock> = [];

    for (let indent: number = 0; indent < 9; indent++) {
      blocks.push({
        type: "list",
        ordered: false,
        indent: indent,
        items: [[text(`level ${indent}`)]],
      });
    }

    const lines: Array<string> = markdownOf(...blocks).split("\n");

    expect(lines[5]).toBe(`${" ".repeat(20)}- level 5`);
    expect(lines[8]).toBe(`${" ".repeat(20)}- level 8`);
  });

  test("a quote keeps its lines and paragraphs", () => {
    const markdown: string = markdownOf({
      type: "quote",
      inlines: [text("quoted\nline two\n\nsecond paragraph")],
    });

    expect(markdown).toBe("> quoted  \n> line two\n>\n> second paragraph");

    expect(renderAsDashboard([markdown])[0]!).toBe(
      "<blockquote>\n<p>quoted<br />\nline two</p>\n<p>second paragraph</p>\n</blockquote>",
    );
  });

  test("blocks are a blank line apart", () => {
    expect(
      markdownOf(
        paragraph(text("one")),
        { type: "quote", inlines: [text("two")] },
        { type: "code", text: "three" },
        paragraph(text("four")),
      ),
    ).toBe("one\n\n> two\n\n```\nthree\n```\n\nfour");
  });
});

/*
 * What a message's own text holds is never Markdown: every character
 * Markdown, HTML or a chat reads as something reads as typed. (A web
 * address is followed by a space here, as people type one: an address
 * glued to a character Markdown would read - "https://x.example)\<" -
 * shows the escape of that character, a quirk of every renderer's bare
 * links that mdText leaves as it is.)
 */
const MARKUP_PIECES: ReadonlyArray<string> = [
  "*",
  "**",
  "_",
  "__",
  "~",
  "~~",
  "`",
  "```",
  "[",
  "]",
  "(",
  ")",
  "![x](https://tracker.example/p.png) ",
  "[a](https://evil.example) ",
  "[ref]: https://evil.example ",
  "<b>",
  "</b>",
  "<img src=x onerror=alert(1)>",
  "<!--",
  "-->",
  "<https://autolink.example> ",
  "&amp;",
  "&lt;",
  "&#60;",
  "\\",
  "# ",
  "## ",
  "- ",
  "+ ",
  "1. ",
  "1) ",
  "> ",
  "| ",
  "---",
  "===",
  "    ",
  "\t",
  "```mermaid",
  "<!here>",
  "<@U0123ABC>",
  "<#C0123ABC|general>",
  "[[ref]]",
  "^[note]",
  "x",
  "word",
  " ",
  "é",
  "数据",
  "🔥",
  "\n",
];

describe("ChatMessageMarkdown.toMarkdown: text from the chat reads as typed", () => {
  const texts: Array<string> = generatedTexts(1500, 2026, MARKUP_PIECES, 12);
  const markdowns: Array<string> = texts.map((value: string): string => {
    return markdownOf(paragraph(text(value)));
  });
  const dashboardHtmls: Array<string> = renderAsDashboard(markdowns);

  // What a paragraph of text reads as: its lines, trimmed, one space between words.
  const asRead: (value: string) => string = (value: string): string => {
    return value
      .split("\n")
      .map((line: string): string => {
        return line.trim();
      })
      .filter((line: string): boolean => {
        return Boolean(line);
      })
      .join(" ")
      .split(/\s+/)
      .join(" ")
      .trim();
  };

  /*
   * Paragraphs and line breaks only - and a link only where the text holds
   * a bare web address, which every renderer makes a link of as it reads,
   * showing where it goes (as it does wherever somebody types one).
   */
  const expectOnlyText: (html: string) => void = (html: string): void => {
    for (const tag of tagsOf(html)) {
      expect(["p", "br", "a"]).toContain(tag);
    }

    for (const match of html.matchAll(LINK_ELEMENT)) {
      expect(htmlAsText(match[2]!)).toBe(
        decodeURI(match[1]!.split("&amp;").join("&")),
      );
    }
  };

  test("the dashboard shows exactly the text, and nothing but paragraphs and line breaks", () => {
    texts.forEach((value: string, index: number): void => {
      const html: string = dashboardHtmls[index]!;

      expectOnlyText(html);

      expect({ markdown: markdowns[index], seen: readText(html) }).toEqual({
        markdown: markdowns[index],
        seen: asRead(value),
      });
    });
  });

  test("the emails show exactly the text, and nothing but paragraphs and line breaks", () => {
    texts.forEach((value: string, index: number): void => {
      const html: string = emailHtmlOf(markdowns[index]!);

      expectOnlyText(html);

      expect({ markdown: markdowns[index], seen: readText(html) }).toEqual({
        markdown: markdowns[index],
        seen: asRead(value),
      });
    });
  });

  test("Slack is never handed a mention, a channel-wide notice or a link", () => {
    for (const markdown of markdowns) {
      const slack: string = SlackUtil.slackify(markdown);

      expect(slack).not.toContain("<!here>");
      expect(slack).not.toContain("<@U0123ABC>");
      expect(slack).not.toContain("<#C0123ABC");
      expect(slack).not.toContain("<https://");
    }
  });
});

/*
 * Runs of styled text next to one another, in every arrangement: the words
 * always read as written, and no marker is ever shown as a character.
 */
describe("ChatMessageMarkdown.toMarkdown: styled runs side by side", () => {
  const WORDS: ReadonlyArray<string> = [
    "a",
    "word",
    " ",
    "(x)",
    ".",
    "🔥",
    "é",
    "1",
    "-",
    '"',
    "#",
    ">",
    ")",
    "|",
    "=",
    "*",
    "_",
    "~",
    "\n",
  ];
  const STYLES: ReadonlyArray<ChatTextStyle | undefined> = [
    undefined,
    { bold: true },
    { italic: true },
    { strike: true },
    { bold: true, italic: true },
    { code: true },
    { bold: true, strike: true },
  ];

  const random: SeededRandom = seededRandom(4724);
  const lines: Array<Array<ChatInline>> = [];

  for (let index: number = 0; index < 4000; index++) {
    const runs: Array<ChatInline> = [];
    const count: number = 1 + random(6);

    for (let run: number = 0; run < count; run++) {
      let value: string = "";
      const length: number = 1 + random(3);

      for (let word: number = 0; word < length; word++) {
        value += WORDS[random(WORDS.length)]!;
      }

      // Now and then a link instead, styled as runs are.
      runs.push(
        random(8) === 0
          ? link(
              "https://grafana.example.com/d/1",
              value,
              STYLES[random(STYLES.length)],
            )
          : text(value, STYLES[random(STYLES.length)]),
      );
    }

    lines.push(runs);
  }

  const markdowns: Array<string> = lines.map(
    (line: Array<ChatInline>): string => {
      return markdownOf(paragraph(...line));
    },
  );
  const dashboardHtmls: Array<string> = renderAsDashboard(markdowns);

  // The words of a line: a link's words, or its address when it has none.
  const expectedText: (line: Array<ChatInline>) => string = (
    line: Array<ChatInline>,
  ): string => {
    return line
      .map((inline: ChatInline): string => {
        if (inline.type === "text") {
          return inline.text;
        }

        const words: string = (inline.text || "").split(/\s+/).join(" ").trim();

        return words || inline.url;
      })
      .join("")
      .split(/\s+/)
      .join(" ")
      .trim();
  };

  test("every renderer reads the words as written, and shows no marker", () => {
    lines.forEach((line: Array<ChatInline>, index: number): void => {
      const expected: string = expectedText(line);

      for (const html of [
        dashboardHtmls[index]!,
        emailHtmlOf(markdowns[index]!),
      ]) {
        expect({ markdown: markdowns[index], seen: readText(html) }).toEqual({
          markdown: markdowns[index],
          seen: expected,
        });
      }
    });
  });

  test("a run alone in its line keeps its style", () => {
    const html: string = renderAsDashboard([
      markdownOf(paragraph(text("(x)", { bold: true }))),
      markdownOf(paragraph(text("🔥", { italic: true }))),
      markdownOf(paragraph(text("gone.", { strike: true }))),
    ]).join("\n");

    expect(html).toContain("<strong>(x)</strong>");
    expect(html).toContain("<em>🔥</em>");
    expect(html).toContain("<del>gone.</del>");
  });
});

describe("ChatMessageMarkdown helpers", () => {
  test("toPlainText is the words and the addresses of links, on one line", () => {
    const content: ChatMessageContent = {
      blocks: [
        paragraph(text("Discussion with "), text("@Aidil", { bold: true })),
        {
          type: "list",
          ordered: false,
          indent: 0,
          items: [[link("https://x.example")]],
        },
        { type: "code", text: "a\nb" },
      ],
    };

    expect(ChatMessageMarkdown.toPlainText(content)).toBe(
      "Discussion with @Aidil https://x.example a b",
    );
  });

  test("getLinkableAddress keeps web and mailto addresses only", () => {
    expect(ChatMessageMarkdown.getLinkableAddress("https://a.example/x")).toBe(
      "https://a.example/x",
    );
    expect(ChatMessageMarkdown.getLinkableAddress("HTTP://a.example")).toBe(
      "HTTP://a.example",
    );
    expect(ChatMessageMarkdown.getLinkableAddress("mailto:a@b.example")).toBe(
      "mailto:a@b.example",
    );

    for (const address of [
      "",
      "   ",
      "/relative",
      "a.example/no-scheme",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://a.example",
      undefined,
    ]) {
      expect(ChatMessageMarkdown.getLinkableAddress(address)).toBeNull();
    }
  });

  test("getLinkWords keeps words that are not an address, or the address's own site", () => {
    expect(
      ChatMessageMarkdown.getLinkWords({
        url: "https://a.example/x",
        text: "the dashboard",
      }),
    ).toBe("the dashboard");
    expect(
      ChatMessageMarkdown.getLinkWords({
        url: "https://www.a.example/x",
        text: "www.a.example",
      }),
    ).toBe("www.a.example");
    // Another host - even one a "www." away - shows the address.
    expect(
      ChatMessageMarkdown.getLinkWords({
        url: "https://a.example/x",
        text: "www.a.example",
      }),
    ).toBe("https://a.example/x");
    expect(
      ChatMessageMarkdown.getLinkWords({
        url: "https://a.example/x",
        text: "www.b.example",
      }),
    ).toBe("https://a.example/x");
    expect(
      ChatMessageMarkdown.getLinkWords({ url: "https://a.example/x" }),
    ).toBe("https://a.example/x");
  });
});

/*
 * A message is what anybody in the channel wrote: up to 40,000 characters
 * in Slack, more through an app. Whatever its shape, it is written in time
 * that grows with its length.
 */
describe("ChatMessageMarkdown.toMarkdown: in time that grows with the message", () => {
  const LENGTH: number = 400000;
  const LIMIT_IN_MS: number = 2000;

  const timed: (content: ChatMessageContent) => number = (
    content: ChatMessageContent,
  ): number => {
    const started: number = Date.now();
    ChatMessageMarkdown.toMarkdown(content);
    return Date.now() - started;
  };

  test.each([
    ["one long word", paragraph(text("a".repeat(LENGTH)))],
    ["markers", paragraph(text("*_~`[]<>\\".repeat(LENGTH / 9)))],
    ["addresses", paragraph(text("https://a.example/x ".repeat(LENGTH / 20)))],
    ["lines", paragraph(text("a line of a message\n".repeat(LENGTH / 19)))],
    ["one character a line", paragraph(text("a\n".repeat(LENGTH / 2)))],
    ["spaces", paragraph(text(" ".repeat(LENGTH) + "x"))],
    // A backtick next to an address is a value of its own: a run of them is one.
    ["backticks", paragraph(text("`".repeat(LENGTH)))],
    [
      "an address, then backticks",
      paragraph(text(`https://a.example/${"`a".repeat(LENGTH / 2)}`)),
    ],
    [
      "addresses and backticks",
      paragraph(text("https://a.example/`x` ".repeat(LENGTH / 22))),
    ],
    [
      "one long word with no space to cut at",
      paragraph(text("ab".repeat(LENGTH / 2))),
    ],
  ])("%s", (_case: string, block: ChatBlock) => {
    expect(timed({ blocks: [block] })).toBeLessThan(LIMIT_IN_MS);
  });

  test("a run per character, each styled unlike the last", () => {
    const inlines: Array<ChatInline> = [];

    for (let index: number = 0; index < 40000; index++) {
      inlines.push(
        text(
          index % 3 === 0 ? "(" : "a",
          index % 2 === 0 ? { bold: true } : { italic: true },
        ),
      );
    }

    expect(timed({ blocks: [paragraph(...inlines)] })).toBeLessThan(
      LIMIT_IN_MS,
    );
  });

  test("a list of thousands of items, and a long code block", () => {
    const items: Array<Array<ChatInline>> = [];

    for (let index: number = 0; index < 20000; index++) {
      items.push([text(`item ${index}`)]);
    }

    expect(
      timed({
        blocks: [
          { type: "list", ordered: true, indent: 0, items: items },
          { type: "code", text: "```\n".repeat(LENGTH / 4) },
        ],
      }),
    ).toBeLessThan(LIMIT_IN_MS);
  });
});
