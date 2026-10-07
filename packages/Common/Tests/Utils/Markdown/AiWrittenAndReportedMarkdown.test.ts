import {
  markdownCodeSpan,
  WORD_JOINER,
} from "../../../Utils/Markdown/MarkdownEscape";
import {
  neutralizeAiWrittenMarkdown,
  neutralizeUntrustedValue,
} from "../../../Utils/Markdown/UntrustedMarkdown";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import { hrefsOf, renderAsDashboard } from "./DashboardMarkdownRenderer";
import { describe, expect, test } from "@jest/globals";
import { Lexer, Token, Tokens, marked } from "marked";

// Where an HTML tag starts.
const HTML_TAG_START_PATTERN: RegExp = /<\/?[A-Za-z]/;

/*
 * TEXT A MONITORED SYSTEM OR OneUptime AI WROTE, IN FEEDS AND CHATS.
 *
 * Two writers nobody reads over before their text is shown:
 *
 *   - a monitored system, whose response bodies, headers, emails, log
 *     lines and labels a monitor fills into a description template
 *     (neutralizeUntrustedValue), or shows as code (markdownCodeSpan);
 *   - OneUptime AI, whose analysis, drafted postmortem and chat answers
 *     are Markdown written from telemetry (neutralizeAiWrittenMarkdown).
 *
 * Whatever such text holds, each is read here the way every place that
 * shows it reads it - marked (the emails), the dashboard's own parser and
 * Slack's conversion - and none of them finds a mention, an image, a link
 * whose words hide where it goes, a diagram, or an HTML tag; and the text
 * still reads exactly as written.
 */

const WORD_JOINER_PATTERN: RegExp = new RegExp(WORD_JOINER, "g");
const SLACK_MENTION_PATTERN: RegExp = /<[!@#][A-Za-z0-9]/;
const SLACK_LINK_PATTERN: RegExp = /<(https?:\/\/[^|>]+)\|([^>]*)>/g;
const HTML_IMAGE_PATTERN: RegExp = /<img/;
const HTML_ANCHOR_PATTERN: RegExp = /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
const HTML_TAG_PATTERN: RegExp = /<[^>]+>/g;
const MERMAID_CLASS_PATTERN: RegExp = /language-mermaid/i;

function withoutJoiners(text: string): string {
  return text.replace(WORD_JOINER_PATTERN, "");
}

function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(
    new Lexer({ gfm: true, breaks: false, pedantic: false }).lex(markdown),
    (token: Token): void => {
      tokens.push(token);
    },
  );

  return tokens;
}

function slackTextOf(markdown: string): string {
  return SlackUtil.convertMarkdownToSlackRichText(markdown);
}

function withoutHtmlEscapes(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/*
 * Whether a link's words are the address it opens - a bare address made a
 * link, as every renderer does with one typed into a note. The renderers
 * escape the words for HTML and percent-encode the address, so both are
 * compared as a reader sees them.
 */
function showsItsAddress(words: string, href: string): boolean {
  const shown: string = withoutHtmlEscapes(words);
  let address: string = withoutHtmlEscapes(href);

  try {
    address = decodeURI(address);
  } catch {
    // An address that does not decode is compared as it is.
  }

  return [shown, `http://${shown}`, `mailto:${shown}`].includes(address);
}

// The links a reader can follow whose words are not the address they open.
function hidingLinksIn(markdown: string, html: string): Array<string> {
  const fromMarked: Array<string> = tokensOf(markdown)
    .filter((token: Token): boolean => {
      return (
        token.type === "link" &&
        !showsItsAddress(
          (token as Tokens.Link).text,
          (token as Tokens.Link).href,
        )
      );
    })
    .map((token: Token): string => {
      return (token as Tokens.Link).raw;
    });

  const fromDashboard: Array<string> = Array.from(
    html.matchAll(HTML_ANCHOR_PATTERN),
  )
    .filter((match: RegExpMatchArray): boolean => {
      return !showsItsAddress(
        match[2]!.replace(HTML_TAG_PATTERN, ""),
        hrefsOf(match[0])[0]!,
      );
    })
    .map((match: RegExpMatchArray): string => {
      return match[0];
    });

  const fromSlack: Array<string> = Array.from(
    slackTextOf(markdown).matchAll(SLACK_LINK_PATTERN),
  )
    .filter((match: RegExpMatchArray): boolean => {
      return !showsItsAddress(match[2]!, match[1]!);
    })
    .map((match: RegExpMatchArray): string => {
      return match[0];
    });

  return [...fromMarked, ...fromDashboard, ...fromSlack];
}

/*
 * No image is fetched, no diagram drawn, no link hides where it goes, no
 * HTML tag is read and no mention reaches Slack, in any of the renderers.
 */
function expectInert(markdowns: Array<string>): void {
  const htmls: Array<string> = renderAsDashboard(markdowns);

  markdowns.forEach((markdown: string, index: number): void => {
    const tokens: Array<Token> = tokensOf(markdown);
    const html: string = htmls[index]!;

    expect({
      markdown: markdown,
      images: tokens.filter((token: Token): boolean => {
        return token.type === "image";
      }).length,
      htmlTags: tokens.filter((token: Token): boolean => {
        return token.type === "html" && HTML_TAG_START_PATTERN.test(token.raw);
      }).length,
      dashboardImage: HTML_IMAGE_PATTERN.test(html),
      diagram: MERMAID_CLASS_PATTERN.test(html),
      hidingLinks: hidingLinksIn(markdown, html),
      slackMention: SLACK_MENTION_PATTERN.test(slackTextOf(markdown)),
    }).toEqual({
      markdown: markdown,
      images: 0,
      htmlTags: 0,
      dashboardImage: false,
      diagram: false,
      hidingLinks: [],
      slackMention: false,
    });
  });
}

// What an AI could be steered into writing by a log line it read.
const STEERED_ANSWER: string = [
  "## Summary",
  "",
  "The checkout service ran out of database connections.",
  "",
  "<!channel> please [open the runbook](https://evil.example/login) and",
  "approve the fix. ![status](https://tracker.example/p.png?u=1)",
  "",
  '<a href="https://evil.example/a">Open the dashboard</a> <img src="https://tracker.example/q.png"> <@U0123ABC>',
  "",
  "[ref]: https://evil.example/ref",
  "",
  "See [the details][ref].",
  "",
  "```mermaid",
  "flowchart TD",
  '  A@{ img: "https://tracker.example/m.png" }',
  "```",
].join("\n");

describe("neutralizeAiWrittenMarkdown", () => {
  test("nothing in a steered answer acts on its own anywhere it is shown", () => {
    expectInert([neutralizeAiWrittenMarkdown(STEERED_ANSWER)]);
  });

  test.each([
    [
      "a link whose words hide where it goes",
      "[Open the runbook](https://evil.example/login)",
    ],
    ["a link with a title", '[Docs](https://evil.example/d "Official docs")'],
    [
      "a link by reference",
      "See [the docs][d].\n\n[d]: https://evil.example/d",
    ],
    ["a collapsed reference", "See [d][].\n\n[d]: https://evil.example/d"],
    ["a shortcut reference", "See [d].\n\n[d]: https://evil.example/d"],
    ["an image", "![status](https://tracker.example/p.png)"],
    ["an image with no words", "![](https://tracker.example/p.png)"],
    [
      "an image inside a link",
      "[![x](https://tracker.example/p.png)](https://evil.example)",
    ],
    ["an HTML anchor", '<a href="https://evil.example">Open the dashboard</a>'],
    ["an HTML image", '<img src="https://tracker.example/p.png">'],
    ["an HTML block", '<div>\n<a href="https://evil.example">Open</a>\n</div>'],
    ["a channel mention", "<!channel> look at this"],
    ["a here mention", "<!here>"],
    ["a user group mention", "<!subteam^S0123ABC|@sre>"],
    ["a user mention", "<@U0123ABC>"],
    ["a channel link", "<#C0123ABC>"],
    ["a mention inside code", "`<!channel>`"],
    ["a mention inside a fenced block", "```\n<!channel>\n```"],
    ["a mermaid diagram", "```mermaid\nflowchart TD\n  A --> B\n```"],
  ])("%s acts on nothing", (_name: string, markdown: string) => {
    const result: string = neutralizeAiWrittenMarkdown(markdown);

    expectInert([result]);
  });

  test.each([
    ["a heading and a paragraph", "## Summary\n\nThe pool is exhausted."],
    ["emphasis", "This is **bold** and _emphasised_ and ~~struck~~."],
    ["a list", "- one\n- two\n  - nested\n1. first\n2. second"],
    ["a table", "| Pod | Restarts |\n| --- | --- |\n| web-1 | 12 |"],
    ["inline code", "Run `kubectl get pods -n prod`."],
    [
      "a fenced block",
      "```bash\nkubectl rollout restart deployment/checkout\n```",
    ],
    ["a quote", "> The deploy at 10:42 changed the pool size."],
    ["a bare address", "See https://status.example.com for updates."],
    ["citations", "The pool ran dry [C1] after the deploy [C2]."],
  ])("keeps %s exactly as written", (_name: string, markdown: string) => {
    expect(neutralizeAiWrittenMarkdown(markdown)).toBe(markdown);
  });

  test("keeps the formatting the model wrote: the same blocks, read the same way", () => {
    const answer: string = [
      "## Root cause",
      "",
      "**The connection pool** ran out.",
      "",
      "- `max_connections` is 100",
      "- the deploy doubled the workers",
      "",
      "| Service | Pool |",
      "| --- | --- |",
      "| checkout | 100 |",
      "",
      "```sql",
      "SHOW max_connections;",
      "```",
    ].join("\n");

    const result: string = neutralizeAiWrittenMarkdown(answer);

    const types: (markdown: string) => Array<string> = (
      markdown: string,
    ): Array<string> => {
      return tokensOf(markdown).map((token: Token): string => {
        return token.type;
      });
    };

    expect(types(result)).toEqual(types(answer));
  });

  test("a link shows its words and its address, as written", () => {
    const result: string = neutralizeAiWrittenMarkdown(
      "Open [the runbook](https://evil.example/login) now.",
    );

    expect(withoutJoiners(result)).toBe(
      "Open [the runbook](https://evil.example/login) now.",
    );
    expect(
      tokensOf(result).some((token: Token): boolean => {
        return (
          token.type === "link" && (token as Tokens.Link).text === "the runbook"
        );
      }),
    ).toBe(false);
  });

  test("a bare address stays a link that shows exactly where it goes", () => {
    const result: string = neutralizeAiWrittenMarkdown(
      "Status: https://status.example.com/incidents/42",
    );

    const links: Array<Tokens.Link> = tokensOf(result).filter(
      (token: Token): boolean => {
        return token.type === "link";
      },
    ) as Array<Tokens.Link>;

    expect(links).toHaveLength(1);
    expect(links[0]!.text).toBe(links[0]!.href);
  });

  test("an HTML tag reads as written, and is a tag nowhere", () => {
    const html: string = '<a href="https://evil.example">Open</a> <img src=x>';
    const result: string = neutralizeAiWrittenMarkdown(html);

    expect(withoutJoiners(result)).toBe(html);
    expect(result).not.toMatch(/<\/?[A-Za-z]/);
  });

  test("a mention reads as written but notifies nobody in Slack", () => {
    const result: string = neutralizeAiWrittenMarkdown(
      "<!channel> and <@U0123ABC> in `<!here>` and\n\n```\n<#C0123ABC>\n```",
    );

    expect(withoutJoiners(result)).toBe(
      "<!channel> and <@U0123ABC> in `<!here>` and\n\n```\n<#C0123ABC>\n```",
    );
    expect(slackTextOf(result)).not.toMatch(SLACK_MENTION_PATTERN);
  });

  test("code in a fenced block keeps its characters, links and tags included", () => {
    const code: string =
      "```ts\nconst handler = handlers[0](event); // <div> [x](y)\n```";

    expect(neutralizeAiWrittenMarkdown(code)).toBe(code);
  });

  test("a link after a fenced block written with Windows line endings is still broken", () => {
    const result: string = neutralizeAiWrittenMarkdown(
      "```\r\ncode\r\n```\r\n[Open](https://evil.example)",
    );

    expect(result).toBe(
      `\`\`\`\ncode\n\`\`\`\n[Open]${WORD_JOINER}(https://evil.example)`,
    );
    expectInert([result]);
  });

  test("a fence the renderers could pair differently is not trusted", () => {
    // marked closes "```" with "```~"; CommonMark does not.
    const result: string = neutralizeAiWrittenMarkdown(
      "```\ncode\n```~\n[Open](https://evil.example)\n```",
    );

    expectInert([result]);
  });

  /*
   * A responder copies a command out of the answer and runs it: in any
   * fence - right under a line of text, nested in a list item, after a
   * fence some renderer might pair differently - it keeps the characters
   * the model wrote. A "<" there gets no joiner (dashboards and email show
   * raw HTML as text, Slack shows code as it is, and the Teams card escapes
   * fenced lines).
   */
  test.each([
    [
      "right under a line of text",
      "Apply the fix:\n```bash\nkubectl apply -f - <<EOF\napiVersion: v1\nEOF\n```",
      "kubectl apply -f - <<EOF",
    ],
    [
      "nested in a list item",
      "1. Restart the pods:\n   ```bash\n   sort <ids.txt | xargs kubectl delete pod\n   ```",
      "sort <ids.txt | xargs kubectl delete pod",
    ],
    [
      "after another fence under a line of text",
      "Run this:\n```\necho hi\n```\nThen:\n```ts\nconst seen: Map<string, number> = new Map();\n```",
      "const seen: Map<string, number> = new Map();",
    ],
  ])(
    "a command in a fence %s copies out with the characters the model wrote",
    (_layout: string, markdown: string, command: string) => {
      const result: string = neutralizeAiWrittenMarkdown(markdown);

      expect(result).toContain(command);
      expectInert([result]);
    },
  );

  test("a Slack link in code is broken, even in a fence every renderer reads as code", () => {
    const answer: string =
      "Details:\n\n```\n<https://evil.example/login|Open the runbook>\n```";
    const result: string = neutralizeAiWrittenMarkdown(answer);

    expect(withoutJoiners(result)).toBe(answer);
    expect(result).toContain(`<${WORD_JOINER}https://evil.example/login|`);
    expectInert([result]);
  });

  test("a link in a fence some renderer might read as text is still broken", () => {
    const result: string = neutralizeAiWrittenMarkdown(
      "See:\n```\n[Open the runbook](https://evil.example/login)\n```",
    );

    expect(result).toContain(
      `[Open the runbook]${WORD_JOINER}(https://evil.example/login)`,
    );
  });

  test("an HTML comment, declaration or processing instruction outside code reads as text", () => {
    const answer: string =
      "Before <!-- hidden --> after <?php echo 1; ?> and <!DOCTYPE html>";
    const result: string = neutralizeAiWrittenMarkdown(answer);

    expect(withoutJoiners(result)).toBe(answer);
    expect(result).not.toMatch(/<[!?]/);
    expect(
      tokensOf(result).filter((token: Token): boolean => {
        return token.type === "html";
      }),
    ).toEqual([]);
  });

  test("is idempotent", () => {
    const once: string = neutralizeAiWrittenMarkdown(STEERED_ANSWER);

    expect(neutralizeAiWrittenMarkdown(once)).toBe(once);
  });

  test.each([[null], [undefined]])(
    "turns %p into an empty text",
    (value: null | undefined) => {
      expect(neutralizeAiWrittenMarkdown(value)).toBe("");
    },
  );
});

/*
 * What a monitored system can send: an HTML response body, a header with a
 * link, an email subject with a mention, a log line with a fence in it.
 */
const REPORTED_VALUES: Array<string> = [
  '<html><body><a href="https://evil.example">Reset your password</a></body></html>',
  "[Verify your account](https://evil.example/login)",
  "![](https://tracker.example/p.png)",
  "<!channel> checkout is down <@U0123ABC>",
  "x` [link](https://evil.example) `y",
  "line one\n```\n[Open](https://evil.example)\n```",
  '```mermaid\nflowchart TD\n  A@{ img: "https://tracker.example/m.png" }',
  "[a]: https://tracker.example/p.png",
  "<https://evil.example>",
];

describe("neutralizeUntrustedValue", () => {
  test.each(REPORTED_VALUES)(
    "%j reads exactly as sent, wherever a template places it",
    (value: string) => {
      const neutralized: string = neutralizeUntrustedValue(value);

      expect(withoutJoiners(neutralized)).toBe(value);

      // In a sentence, in a list, in a code span, in a fenced block.
      expectInert([
        `The API answered: ${neutralized}`,
        `- ${neutralized}`,
        `Body: \`${neutralized}\``,
        `\`\`\`\n${neutralized}\n\`\`\``,
        `${neutralized}\n\n![a]`,
      ]);
    },
  );

  test("leaves ordinary text exactly as it is", () => {
    for (const value of [
      "Checkout is down",
      "HTTP 503 Service Unavailable",
      "x < y and y > z",
      '{"error": "timeout", "retry": true}',
      "",
    ]) {
      expect(neutralizeUntrustedValue(value)).toBe(value);
    }
  });

  /*
   * A template places values side by side, and next to its own text: what
   * one value starts, the next must not be able to finish.
   */
  test.each([
    ["a mention", "billing <", "!channel> queue is backing up"],
    ["a user mention", "ask <", "@U0123ABC>"],
    ["an HTML tag", "x <", 'img src="https://tracker.example/p.png">'],
    ["an HTML comment", "x <", "!-- the rest is hidden -->"],
    ["a Slack link", "see <", "https://evil.example/login|Open the runbook>"],
  ])(
    "two values side by side make no %s",
    (_kind: string, first: string, second: string) => {
      const markdown: string = `Alert from ${neutralizeUntrustedValue(first)}${neutralizeUntrustedValue(second)}`;

      expect(withoutJoiners(markdown)).toBe(`Alert from ${first}${second}`);
      expect(markdown).not.toMatch(/<[!@#A-Za-z/]/);
      expectInert([markdown, `Body: \`${markdown}\``]);
    },
  );

  test("a value cannot finish a link another value started", () => {
    const markdown: string = `${neutralizeUntrustedValue("[Reset your password]")}(${neutralizeUntrustedValue("https://evil.example/login")})`;

    expect(withoutJoiners(markdown)).toBe(
      "[Reset your password](https://evil.example/login)",
    );
    expectInert([markdown]);
  });

  test("a Slack link in a value inside the author's code span or block is broken", () => {
    const neutralized: string = neutralizeUntrustedValue(
      "<https://evil.example/login|Open the runbook>",
    );

    expectInert([`Body: \`${neutralized}\``, `\`\`\`\n${neutralized}\n\`\`\``]);
  });

  test("is idempotent", () => {
    for (const value of REPORTED_VALUES) {
      const once: string = neutralizeUntrustedValue(value);

      expect(neutralizeUntrustedValue(once)).toBe(once);
    }

    const sideBySide: string = neutralizeUntrustedValue("[Reset] <");

    expect(neutralizeUntrustedValue(sideBySide)).toBe(sideBySide);
  });

  test.each([[null], [undefined]])(
    "turns %p into an empty text",
    (value: null | undefined) => {
      expect(neutralizeUntrustedValue(value)).toBe("");
    },
  );
});

describe("markdownCodeSpan", () => {
  test("a reported value is code that reads as written", () => {
    expect(markdownCodeSpan("web-1")).toBe("`web-1`");
    expect(markdownCodeSpan("2026-08-14T10:30:00.000Z")).toBe(
      "`2026-08-14T10:30:00.000Z`",
    );
  });

  test("a backtick in the value cannot close the span early", () => {
    const value: string = "a`b ``c [x](https://evil.example)";
    const span: string = markdownCodeSpan(value);

    const codeSpans: Array<string> = tokensOf(span)
      .filter((token: Token): boolean => {
        return token.type === "codespan";
      })
      .map((token: Token): string => {
        return (token as Tokens.Codespan).text;
      });

    expect(codeSpans).toEqual([value]);
    expectInert([`Value: ${span} - done`]);
  });

  test("a line break in the value cannot end the line", () => {
    expect(markdownCodeSpan("first\n\n# heading\r\nlast")).toBe(
      "`first # heading last`",
    );
  });

  test("a Slack link or an HTML tag in the value is broken: Slack keeps code as it is, and a Teams card has no code spans", () => {
    const value: string =
      '<https://evil.example/login|Open the runbook> <img src="https://tracker.example/p.png">';
    const span: string = markdownCodeSpan(value);

    expect(withoutJoiners(span)).toBe(`\`${value}\``);
    expect(span).not.toMatch(/<[A-Za-z!@#/]/);
    expectInert([`Value: ${span}`]);
  });

  test("a '<' with a space after it starts nothing, and is left as it is", () => {
    expect(markdownCodeSpan("a < b")).toBe("`a < b`");
  });

  test("a mention in the value notifies nobody in Slack, though Slack keeps code as it is", () => {
    const span: string = markdownCodeSpan("<!channel> <@U0123ABC>");

    expect(withoutJoiners(span)).toBe("`<!channel> <@U0123ABC>`");
    expect(slackTextOf(`Value: ${span}`)).not.toMatch(SLACK_MENTION_PATTERN);
  });

  test.each([[null], [undefined], [""], ["  \n "]])(
    "turns %p into no span at all",
    (value: string | null | undefined) => {
      expect(markdownCodeSpan(value)).toBe("");
    },
  );
});
