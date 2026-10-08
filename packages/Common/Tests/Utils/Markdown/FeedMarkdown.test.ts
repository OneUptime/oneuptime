import FeedMarkdown, {
  MarkdownText,
  isMarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { hrefsOf, renderAsDashboard } from "./DashboardMarkdownRenderer";
import { describe, expect, test } from "@jest/globals";
import { Lexer, Token, Tokens, marked } from "marked";

/*
 * FEED AND CHAT MARKDOWN, ESCAPED BY DEFAULT (FeedMarkdown).
 *
 * The `mdText` tag places every value as text - wherever it sits: in a sentence,
 * in a link's words, as a link's address, in a code span, in a fenced code
 * block, in a table row, at the start of a line - and a MarkdownText as it
 * is. Each case is read the way every place that shows feed text reads it:
 * marked (the emails), the dashboard's own parser (micromark with its GitHub
 * extensions) and Slack's conversion. None of them finds a link, an image,
 * HTML, a mention, code or a heading the value made, and the value reads
 * exactly as it was typed.
 */

const WORD_JOINER_PATTERN: RegExp = new RegExp(WORD_JOINER, "g");
const HTML_TAG_PATTERN: RegExp = /<[^>]+>/g;
const SLACK_MENTION_PATTERN: RegExp = /<[!@#][A-Za-z0-9]/;
const HTML_ELEMENT_PATTERN: RegExp =
  /<(?:img|a|code|pre|h[1-6]|ul|ol|li|blockquote|table|script|em|strong|del|hr)\b/;
const DASHBOARD_ANCHOR_PATTERN: RegExp =
  /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

// Names and titles that try everything Markdown, HTML and Slack would read.
const HOSTILE_VALUES: Array<string> = [
  "![pixel](https://tracker.example/p.png)",
  "[Reset your password](https://evil.example/login)",
  "Checkout](https://evil.example) [click",
  "<img src=x onerror=alert(1)>",
  "<script>alert('x')</script>",
  "<!channel> <!here> <@U123ABC> <#C123ABC>",
  "<https://evil.example|Open the runbook>",
  "**bold** and _italic_ and `code` and ~~gone~~",
  "a | b | c",
  "trailing backslash \\",
  "C:\\Program Files\\app",
  "&lt;img src=x&gt; &amp; &#60; &#x3C;",
  "R&D <> AT&T",
  "nested [[brackets]] ((parens))",
  "*.example.com",
  "``` fence",
  "line one\nline two\r\nline three",
  "[a]: https://evil.example",
  "emoji 🚀 and accents café",
];

// Values that start a block when they start a line.
const BLOCK_STARTING_VALUES: Array<string> = [
  "# Heading",
  "## Heading",
  "- list item",
  "+ list item",
  "* list item",
  "1. ordered",
  "2) ordered",
  "> quote",
  "=====",
  "-----",
  "***",
  "```",
  "~~~",
  "| a | b |",
];

const ORDINARY_VALUES: Array<string> = [
  "Payments API",
  "Site 03 - payments (EU)",
  "db-primary.eu-west-1",
  "checkout_service",
  "99.9% availability",
  "Release v2.1.0 (rollback #42)",
  "R&D",
  "Ops: on-call / week 3",
];

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

function decodeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// The words a reader sees in HTML: tags dropped, escapes undone, joiners gone.
function textOfHtml(html: string): string {
  return withoutJoiners(decodeHtml(html.replace(HTML_TAG_PATTERN, "")))
    .replace(/\s+/g, " ")
    .trim();
}

function textOfEmail(markdown: string): string {
  return textOfHtml(marked.parse(markdown, { async: false }) as string);
}

// A value as one line of text: line breaks become spaces, as the tag has it.
function asOneLine(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Whether a link's words are the address it opens: a bare address in a
 * value, which every renderer makes a link of - one that shows where it
 * goes. The renderers escape the words for HTML and percent-encode the
 * address, so both are compared as a reader sees them.
 */
function showsItsAddress(words: string, href: string): boolean {
  const shown: string = withoutJoiners(decodeHtml(words)).trim();
  let address: string = decodeHtml(href);

  try {
    address = decodeURI(address);
  } catch {
    // An address that does not decode is compared as it is.
  }

  return [shown, `http://${shown}`, `mailto:${shown}`].includes(address);
}

const SLACK_ANY_LINK_PATTERN: RegExp =
  /<([A-Za-z][A-Za-z0-9+.-]*:[^|>]*)(?:\|([^>]*))?>/g;

/*
 * Nothing the value holds is read as anything: no image, HTML, code,
 * emphasis, heading or list in the emails or the dashboard, no link whose
 * words hide where it goes, and no mention or such link in Slack.
 */
function expectOnlyText(markdowns: Array<string>): void {
  const htmls: Array<string> = renderAsDashboard(markdowns);

  markdowns.forEach((markdown: string, index: number): void => {
    const unexpectedTokens: Array<string> = tokensOf(markdown)
      .filter((token: Token): boolean => {
        if (token.type === "link") {
          return !showsItsAddress(
            (token as Tokens.Link).text,
            (token as Tokens.Link).href,
          );
        }

        return ![
          "paragraph",
          "text",
          "escape",
          "space",
          "br",
          "strong",
        ].includes(token.type);
      })
      .map((token: Token): string => {
        return `${token.type}: ${token.raw}`;
      });

    expect({ markdown: markdown, tokens: unexpectedTokens }).toEqual({
      markdown: markdown,
      tokens: [],
    });

    const html: string = htmls[index]!;
    const anchorsShowingTheirAddress: string = html.replace(
      DASHBOARD_ANCHOR_PATTERN,
      (anchor: string, _href: string, words: string): string => {
        return showsItsAddress(
          words.replace(HTML_TAG_PATTERN, ""),
          hrefsOf(anchor)[0]!,
        )
          ? ""
          : anchor;
      },
    );
    const elements: Array<string> = (
      anchorsShowingTheirAddress.match(/<[a-z0-9]+\b/g) || []
    ).filter((tag: string): boolean => {
      return !["<p", "<strong", "<br"].includes(tag);
    });

    expect({ markdown: markdown, elements: elements }).toEqual({
      markdown: markdown,
      elements: [],
    });

    const slack: string = SlackUtil.convertMarkdownToSlackRichText(markdown);
    const hidingSlackLinks: Array<string> = Array.from(
      slack.matchAll(SLACK_ANY_LINK_PATTERN),
    )
      .filter((match: RegExpMatchArray): boolean => {
        return match[2] !== undefined && !showsItsAddress(match[2], match[1]!);
      })
      .map((match: RegExpMatchArray): string => {
        return match[0];
      });

    expect({
      markdown: markdown,
      mention: SLACK_MENTION_PATTERN.test(slack),
      hidingLinks: hidingSlackLinks,
    }).toEqual({ markdown: markdown, mention: false, hidingLinks: [] });
  });
}

describe("md: a value in a sentence", () => {
  test.each(ORDINARY_VALUES)(
    "an ordinary value is placed byte for byte: %s",
    (value: string) => {
      expect(mdText`Added **${value}** to the incident.`.toString()).toBe(
        `Added **${value}** to the incident.`,
      );
    },
  );

  test.each([
    ["between letters", "checkout_service", "checkout_service"],
    ["between digits", "v1_2", "v1_2"],
    ["at the start", "_private", "\\_private"],
    ["at the end", "trailing_", "trailing\\_"],
    ["around a word", "an _important_ one", "an \\_important\\_ one"],
    ["before punctuation", "a_.b", "a\\_.b"],
  ])("an underscore %s", (_case: string, value: string, expected: string) => {
    expect(mdText`${value}`.toString()).toBe(expected);
  });

  test("hostile values are only text, everywhere they are read", () => {
    expectOnlyText(
      HOSTILE_VALUES.map((value: string): string => {
        return mdText`Added label ${value} to the incident.`.toString();
      }),
    );
  });

  test.each(HOSTILE_VALUES)("reads exactly as typed: %s", (value: string) => {
    const markdown: string =
      mdText`Added **${value}** to the incident.`.toString();
    const htmls: Array<string> = renderAsDashboard([markdown]);

    const expected: string = `Added ${asOneLine(value)} to the incident.`;

    expect(textOfEmail(markdown)).toBe(expected);
    expect(textOfHtml(htmls[0]!)).toBe(expected);
  });

  test("a value inside bold stays inside it", () => {
    const tokens: Array<Token> = tokensOf(
      mdText`Changed to **${"Degraded** _not_ **really"}**.`.toString(),
    );

    const strong: Array<Token> = tokens.filter((token: Token): boolean => {
      return token.type === "strong";
    });

    expect(strong).toHaveLength(1);
    expect(withoutJoiners((strong[0] as Tokens.Strong).text)).toContain(
      "\\_not\\_",
    );
  });

  test("line breaks in a value become spaces", () => {
    expect(mdText`State: ${"Up\nDown\r\nSideways"}`.toString()).toBe(
      "State: Up Down Sideways",
    );
  });

  test("character references read as typed, an ordinary & is left alone", () => {
    expect(mdText`${"&lt;b&gt;"}`.toString()).toBe("\\&lt;b\\&gt;");
    expect(mdText`${"R&D and AT&T"}`.toString()).toBe("R&D and AT&T");
    expect(textOfEmail(mdText`Team ${"&#60;x&#x3E; &amp;"}`.toString())).toBe(
      "Team &#60;x&#x3E; &amp;",
    );
  });

  test("an & at the end of a value cannot start a reference with what follows", () => {
    const markdown: string = mdText`${"AT&"}${"lt;"}`.toString();

    expect(textOfEmail(markdown)).toBe("AT&lt;");
  });
});

describe("md: values side by side cannot complete one another", () => {
  test.each([
    [
      "an image's ! and the rest of it",
      "!",
      "[x](https://tracker.example/p.png)",
    ],
    ["a link's text and its address", "[Reset]", "(https://evil.example)"],
    ["a mention split in two", "x <", "!channel>"],
    ["a Slack link split in two", "<https://evil.example", "|Open>"],
    ["a code span split in two", "`a", "b`"],
    ["an HTML tag split in two", "<img src=", "x onerror=alert(1)>"],
  ])("%s", (_case: string, first: string, second: string) => {
    const markdown: string = mdText`See ${first}${second} now.`.toString();

    expectOnlyText([markdown]);
    expect(textOfEmail(markdown)).toBe(`See ${asOneLine(first + second)} now.`);
  });
});

describe("md: a bare web address in a value", () => {
  test.each([
    "https://example.com/~ops/_status",
    "https://example.com/a*b/c~d/`e`",
    "http://localhost:3002/_next/static",
    "www.example.com/~user",
  ])(
    "keeps its characters, so its link goes where it says: %s",
    (address: string) => {
      const markdown: string = mdText`Monitor ${address} is down.`.toString();

      expect(markdown).toBe(`Monitor ${address} is down.`);

      const links: Array<Token> = tokensOf(markdown).filter(
        (token: Token): boolean => {
          return token.type === "link";
        },
      );

      expect(links).toHaveLength(1);
      expect((links[0] as Tokens.Link).text).toBe(address);
    },
  );

  test("punctuation GitHub's Markdown leaves out of the link is escaped", () => {
    expect(mdText`${"see https://example.com/a_ and *this*"}`.toString()).toBe(
      "see https://example.com/a\\_ and \\*this\\*",
    );
  });

  test("emphasis around an address is still escaped", () => {
    const markdown: string =
      mdText`${"_https://example.com/x_ **bold**"}`.toString();

    expectOnlyText([markdown]);
  });
});

describe("md: a number that starts a line", () => {
  test.each(["1.07 GB", "2)x", "99.9% availability", "3.14"])(
    "starts no list, so it is left as it is: %s",
    (value: string) => {
      expect(mdText`${value}`.toString()).toBe(value);
      expectOnlyText([mdText`${value}`.toString()]);
    },
  );

  test.each(["1. ordered", "2) ordered", "10.", "7)"])(
    "starts a list, so its marker is escaped: %s",
    (value: string) => {
      expect(mdText`${value}`.toString()).not.toBe(value);
      expectOnlyText([mdText`${value}`.toString()]);
    },
  );
});

describe("md: a value that starts a line", () => {
  test.each(BLOCK_STARTING_VALUES)(
    "starts no block at the start of the text: %s",
    (value: string) => {
      const markdown: string = mdText`${value}`.toString();

      expectOnlyText([markdown]);
      expect(textOfEmail(markdown)).toBe(value);
    },
  );

  test.each(BLOCK_STARTING_VALUES)(
    "starts no block after a line break: %s",
    (value: string) => {
      const markdown: string = mdText`Labels:\n${value}`.toString();

      expectOnlyText([markdown]);
      expect(textOfEmail(markdown)).toBe(`Labels: ${value}`);
    },
  );

  test.each(BLOCK_STARTING_VALUES)(
    "starts no block inside a list item: %s",
    (value: string) => {
      const markdown: string = mdText`- ${value}`.toString();
      const tokens: Array<Token> = tokensOf(markdown);

      expect(
        tokens.filter((token: Token): boolean => {
          return token.type === "list_item";
        }),
      ).toHaveLength(1);
      expect(
        tokens.filter((token: Token): boolean => {
          return ["heading", "blockquote", "code", "hr", "table"].includes(
            token.type,
          );
        }),
      ).toEqual([]);
      expect(
        tokens.filter((token: Token): boolean => {
          return token.type === "list";
        }),
      ).toHaveLength(1);
      expect(textOfEmail(markdown)).toBe(value);
    },
  );

  test("inside a quote", () => {
    const tokens: Array<Token> = tokensOf(
      mdText`> ${"# not a heading"}`.toString(),
    );

    expect(
      tokens.filter((token: Token): boolean => {
        return token.type === "heading";
      }),
    ).toEqual([]);
  });

  test("mid-line, block markers are left as they are", () => {
    expect(mdText`Rule ${"# 1"} matched`.toString()).toBe("Rule # 1 matched");
    expect(mdText`State **${"- down"}**`.toString()).toBe("State **- down**");
  });
});

describe("md: a value in a link's words", () => {
  test.each([...HOSTILE_VALUES, ...BLOCK_STARTING_VALUES, ...ORDINARY_VALUES])(
    "the link keeps its address and its words read as typed: %s",
    (value: string) => {
      const markdown: string =
        mdText`[Monitor ${value}](https://oneuptime.example/monitors/1)`.toString();

      const links: Array<Token> = tokensOf(markdown).filter(
        (token: Token): boolean => {
          return token.type === "link";
        },
      );

      expect(links).toHaveLength(1);
      expect((links[0] as Tokens.Link).href).toBe(
        "https://oneuptime.example/monitors/1",
      );
      expect(
        tokensOf(markdown).filter((token: Token): boolean => {
          return ["image", "html", "codespan"].includes(token.type);
        }),
      ).toEqual([]);

      const html: string = renderAsDashboard([markdown])[0]!;
      const anchors: Array<RegExpMatchArray> = Array.from(
        html.matchAll(DASHBOARD_ANCHOR_PATTERN),
      );

      expect(anchors).toHaveLength(1);
      expect(hrefsOf(anchors[0]![0])).toEqual([
        "https://oneuptime.example/monitors/1",
      ]);
      expect(textOfHtml(anchors[0]![2]!)).toBe(
        `Monitor ${asOneLine(value)}`.trim(),
      );
      expect(textOfEmail(markdown)).toBe(`Monitor ${asOneLine(value)}`.trim());
    },
  );

  test("what only starts a block is left as typed: a link's words never start a line", () => {
    expect(
      mdText`[Incident ${"INC-7"}](https://oneuptime.example/i/7)`.toString(),
    ).toBe("[Incident INC-7](https://oneuptime.example/i/7)");
    expect(
      mdText`[Alert ${"#3"}](https://oneuptime.example/a/3)`.toString(),
    ).toBe("[Alert #3](https://oneuptime.example/a/3)");
    expect(
      mdText`[${"a > b + c"}](https://oneuptime.example/x)`.toString(),
    ).toBe("[a > b + c](https://oneuptime.example/x)");
    // What acts inside a link's words is escaped.
    expect(
      mdText`[${"(EU) *x* [y]! a|b"}](https://oneuptime.example/x)`.toString(),
    ).toBe("[\\(EU\\) \\*x\\* \\[y\\]\\! a\\|b](https://oneuptime.example/x)");
  });

  test("a link inside bold, as the incident summaries write one", () => {
    const markdown: string =
      mdText`**[Incident #4: ${"Edge ] (outage)"}](https://oneuptime.example/i/4)**`.toString();

    expect(textOfEmail(markdown)).toBe("Incident #4: Edge ] (outage)");
    expect(
      tokensOf(markdown).filter((token: Token): boolean => {
        return token.type === "link";
      }),
    ).toHaveLength(1);
  });
});

describe("md: a value as a link's address", () => {
  test("characters that would end or break the address are encoded", () => {
    expect(
      mdText`[Open](${"https://oneuptime.example/a b(c)<d>\\e`f\"g'h"})`.toString(),
    ).toBe(
      "[Open](https://oneuptime.example/a%20b%28c%29%3Cd%3E%5Ce%60f%22g%27h)",
    );
  });

  test("the address is the one link, whatever it holds", () => {
    const markdown: string =
      mdText`[Open](${"https://oneuptime.example/x) [evil](https://evil.example"})`.toString();
    const links: Array<Token> = tokensOf(markdown).filter(
      (token: Token): boolean => {
        return token.type === "link";
      },
    );

    expect(links).toHaveLength(1);
    expect((links[0] as Tokens.Link).text).toBe("Open");
  });

  test.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
  ])("an address with another scheme is not linked: %s", (address: string) => {
    expect(mdText`[Open](${address})`.toString()).toBe("[Open](#)");
  });

  test.each([
    "https://oneuptime.example/dashboard",
    "http://localhost:3002/dashboard/1",
    "mailto:ops@example.com",
    "/dashboard/relative",
  ])("a web, mailto or relative address is kept: %s", (address: string) => {
    expect(mdText`[Open](${address})`.toString()).toBe(`[Open](${address})`);
  });

  test("a URL value is placed as its address", () => {
    const url: URL = URL.fromString("https://oneuptime.example/dashboard/42");

    expect(mdText`[Open](${url})`.toString()).toBe(
      "[Open](https://oneuptime.example/dashboard/42)",
    );
  });
});

describe("md: a value in a code span", () => {
  test.each([
    ["plain", "checkout-api", "`checkout-api`"],
    ["a backtick", "a`b", "`` a`b ``"],
    ["two backticks", "a``b", "``` a``b ```"],
    ["a line break", "a\nb", "`a b`"],
    ["a mention", "<!channel>", `\`<${WORD_JOINER}!channel>\``],
  ])("%s", (_case: string, value: string, expected: string) => {
    expect(mdText`Rule ${"x"}: \`${value}\``.toString()).toBe(
      `Rule x: ${expected}`,
    );
  });

  test("a code span with text and a value around it is written again as a whole", () => {
    expect(
      mdText`run \`kubectl get pods -n ${"prod`ns"}\` now`.toString(),
    ).toBe("run `` kubectl get pods -n prod`ns `` now");
  });

  test.each(HOSTILE_VALUES)(
    "the value is the code, exactly: %s",
    (value: string) => {
      const markdown: string = mdText`Matched: \`${value}\``.toString();
      const codes: Array<Token> = tokensOf(markdown).filter(
        (token: Token): boolean => {
          return token.type === "codespan";
        },
      );

      expect(codes).toHaveLength(1);
      expect(
        withoutJoiners(decodeHtml((codes[0] as Tokens.Codespan).text)),
      ).toBe(asOneLine(value));
      expect(
        SLACK_MENTION_PATTERN.test(
          SlackUtil.convertMarkdownToSlackRichText(markdown),
        ),
      ).toBe(false);
    },
  );

  test("a code span the template writes without values is left as written", () => {
    expect(mdText`Use \`kubectl\` on ${"prod"}`.toString()).toBe(
      "Use `kubectl` on prod",
    );
  });
});

describe("md: a value in a fenced code block", () => {
  test("a fence in the value cannot close the block", () => {
    const markdown: string =
      mdText`Output:\n\`\`\`\n${"before\n```\n# not a heading\n![x](https://tracker.example/p.png)"}\n\`\`\``.toString();

    const tokens: Array<Token> = tokensOf(markdown);

    expect(
      tokens.filter((token: Token): boolean => {
        return token.type === "code";
      }),
    ).toHaveLength(1);
    expect(
      tokens.filter((token: Token): boolean => {
        return ["heading", "image"].includes(token.type);
      }),
    ).toEqual([]);
    expect(markdown).toContain("````\nbefore\n```\n# not a heading");
  });

  test("mentions and Slack links are broken, other characters kept", () => {
    expect(
      mdText`\`\`\`\n${"cat <<EOF\n<!here> <https://evil.example|x>"}\n\`\`\``.toString(),
    ).toBe(
      `\`\`\`\ncat <<EOF\n<${WORD_JOINER}!here> <${WORD_JOINER}https://evil.example|x>\n\`\`\``,
    );
  });

  test("a value in the language is a language name, never a diagram", () => {
    expect(mdText`\`\`\`${"mermaid"}\ncode\n\`\`\``.toString()).toBe(
      `\`\`\`${WORD_JOINER}mermaid\ncode\n\`\`\``,
    );
    expect(mdText`\`\`\`${"js onload=x"}\ncode\n\`\`\``.toString()).toBe(
      "```jsonloadx\ncode\n```",
    );
  });
});

describe("md: a value in a table row", () => {
  test("a | in a value does not start another cell", () => {
    const markdown: string =
      mdText`| Name | Value |\n| --- | --- |\n| ${"a | b"} | ${"c"} |`.toString();
    const html: string = renderAsDashboard([markdown])[0]!;

    expect((html.match(/<td>/g) || []).length).toBe(2);
    expect(html).toContain("<td>a | b</td>");
  });

  test("outside a table a | is left as it is", () => {
    expect(mdText`Filter: ${"a | b"}`.toString()).toBe("Filter: a | b");
  });
});

describe("md: other values", () => {
  test("null and undefined are nothing", () => {
    expect(mdText`[${null}][${undefined}]`.toString()).toBe("[][]");
  });

  test("numbers, bigints and ObjectIDs are their text", () => {
    const id: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(mdText`${3} of ${BigInt(10)} (${id})`.toString()).toBe(
      "3 of 10 (aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)",
    );
  });

  test("a negative number at the start of a line is not a list", () => {
    expect(textOfEmail(mdText`${-5} errors`.toString())).toBe("-5 errors");
  });

  test("a backslash the template ends in does not escape the value", () => {
    const markdown: string =
      mdText`Path C:\\${"[x](https://evil.example)"}`.toString();

    expect(markdown).toBe(
      `Path C:\\${WORD_JOINER}\\[x\\](https://evil.example)`,
    );
    expect(textOfEmail(markdown)).toBe("Path C:\\[x](https://evil.example)");
    expectOnlyText([markdown]);
  });

  test("a template is read once and its values change every time", () => {
    const say: (name: string) => string = (name: string): string => {
      return mdText`Hello **${name}**`.toString();
    };

    expect(say("a")).toBe("Hello **a**");
    expect(say("[b]")).toBe("Hello **\\[b\\]**");
    expect(say("c")).toBe("Hello **c**");
  });
});

describe("MarkdownText", () => {
  test("a piece written with md is placed as it is", () => {
    const rules: MarkdownText = mdText`**${"Rule [1]"}**`;

    expect(mdText`Rules: ${rules}`.toString()).toBe("Rules: **Rule \\[1\\]**");
  });

  test("pieces nest in link words and lists", () => {
    const name: MarkdownText = mdText`**${"db*1"}**`;

    expect(mdText`[${name}](https://oneuptime.example/a)`.toString()).toBe(
      "[**db\\*1**](https://oneuptime.example/a)",
    );
    expect(mdText`- ${name}`.toString()).toBe("- **db\\*1**");
  });

  test("is recognised by its mark, and is not a string", () => {
    expect(isMarkdownText(mdText`x`)).toBe(true);
    expect(FeedMarkdown.isMarkdownText(mdText`x`)).toBe(true);
    expect(isMarkdownText("x")).toBe(false);
    expect(
      isMarkdownText({
        toString: () => {
          return "x";
        },
      }),
    ).toBe(false);
    expect(isMarkdownText(null)).toBe(false);
    expect(typeof mdText`x`).toBe("object");
  });

  test("cannot be made from a string outside the builder", () => {
    expect(() => {
      return new (MarkdownText as unknown as new (
        key: symbol,
        markdown: string,
      ) => MarkdownText)(Symbol("guess"), "[x](https://evil.example)");
    }).toThrow(
      "A MarkdownText is made with the mdText tag or a FeedMarkdown helper.",
    );
  });

  test("an object that only looks like Markdown is escaped as text", () => {
    const pretender: unknown = {
      toString: () => {
        return "[x](https://evil.example)";
      },
    };

    expect(mdText`${pretender as string}`.toString()).toBe(
      "\\[x\\](https://evil.example)",
    );
  });

  test("isEmpty", () => {
    expect(mdText``.isEmpty()).toBe(true);
    expect(mdText`${""}`.isEmpty()).toBe(true);
    expect(mdText`x`.isEmpty()).toBe(false);
    expect(FeedMarkdown.empty().isEmpty()).toBe(true);
  });

  test("joins into a string with += as it is", () => {
    let text: string = "Start ";
    text += mdText`**${"[x]"}**`;

    expect(text).toBe("Start **\\[x\\]**");
  });
});

describe("FeedMarkdown helpers", () => {
  test("code: markdownCodeSpan, as MarkdownText", () => {
    expect(FeedMarkdown.code("a`b").toString()).toBe("`` a`b ``");
    expect(FeedMarkdown.code("").toString()).toBe("");
    expect(mdText`Rule ${FeedMarkdown.code("x")}`.toString()).toBe("Rule `x`");
  });

  test("join: plain items escaped, pieces as they are, the separator between", () => {
    expect(
      FeedMarkdown.join(["a", "[b]", mdText`**c**`, "-d"]).toString(),
    ).toBe("a, \\[b\\], **c**, -d");
    expect(FeedMarkdown.join(["-a", "b"], " and ").toString()).toBe(
      "\\-a and b",
    );
    expect(FeedMarkdown.join([]).toString()).toBe("");
  });

  test("join: an item after a line break is at the start of a line", () => {
    expect(FeedMarkdown.join(["# a", "# b"], "\n").toString()).toBe(
      "\\# a\n\\# b",
    );
  });

  test("bulletList: one bullet per item, each item as text", () => {
    expect(
      FeedMarkdown.bulletList(["prod", "-canary", mdText`**x**`]).toString(),
    ).toBe("- prod\n- \\-canary\n- **x**");
  });

  test("bulletList: the whenEmpty bullet, or nothing", () => {
    expect(
      FeedMarkdown.bulletList([], {
        whenEmpty: "(no named labels)",
      }).toString(),
    ).toBe("- (no named labels)");
    expect(FeedMarkdown.bulletList([]).toString()).toBe("");
  });

  test("bulletList: hostile items stay in their bullets", () => {
    const markdown: string = FeedMarkdown.bulletList(HOSTILE_VALUES).toString();
    const items: Array<Token> = tokensOf(markdown).filter(
      (token: Token): boolean => {
        return token.type === "list_item";
      },
    );

    expect(items).toHaveLength(HOSTILE_VALUES.length);
    expect(
      tokensOf(markdown).filter((token: Token): boolean => {
        return (
          ["image", "html", "codespan", "heading"].includes(token.type) ||
          (token.type === "link" &&
            !showsItsAddress(
              (token as Tokens.Link).text,
              (token as Tokens.Link).href,
            ))
        );
      }),
    ).toEqual([]);
  });

  test("link: the words as text, the address encoded", () => {
    expect(
      FeedMarkdown.link(
        "Host [db]",
        "https://oneuptime.example/h 1",
      ).toString(),
    ).toBe("[Host \\[db\\]](https://oneuptime.example/h%201)");
    expect(
      FeedMarkdown.link(mdText`**${"x"}**`, "javascript:alert(1)").toString(),
    ).toBe("[**x**](#)");
  });

  test("asMarkdown: Markdown placed as written", () => {
    expect(
      mdText`Description: ${FeedMarkdown.asMarkdown("**Bold** [doc](https://docs.example)")}`.toString(),
    ).toBe("Description: **Bold** [doc](https://docs.example)");
    expect(FeedMarkdown.asMarkdown(undefined).toString()).toBe("");
  });

  test("aiWritten: AI Markdown keeps its formatting and acts on nothing", () => {
    const markdown: string = FeedMarkdown.aiWritten(
      "## Cause\n\n- **disk** full <!channel> ![x](https://tracker.example/p.png)",
    ).toString();

    expect(markdown).toContain("## Cause");
    expect(markdown).toContain("**disk**");
    expect(
      tokensOf(markdown).filter((token: Token): boolean => {
        return token.type === "image";
      }),
    ).toEqual([]);
    expect(
      SLACK_MENTION_PATTERN.test(
        SlackUtil.convertMarkdownToSlackRichText(markdown),
      ),
    ).toBe(false);
  });

  test("writtenOutside: an outsider's images become links, mentions break", () => {
    const markdown: string = FeedMarkdown.writtenOutside(
      "See ![x](https://tracker.example/p.png) <!channel>",
    ).toString();

    expect(
      tokensOf(markdown).filter((token: Token): boolean => {
        return token.type === "image";
      }),
    ).toEqual([]);
    expect(markdown).toContain(`<${WORD_JOINER}!channel>`);
  });

  test("textWithCode: backticked parts are code, the rest is text", () => {
    expect(
      FeedMarkdown.textWithCode(
        '`docker ps -a` on Docker host "web-1"',
      ).toString(),
    ).toBe('`docker ps -a` on Docker host "web-1"');
    expect(
      FeedMarkdown.textWithCode(
        "`kubectl get pods` on *prod* [x](https://evil.example)",
      ).toString(),
    ).toBe("`kubectl get pods` on \\*prod\\* \\[x\\](https://evil.example)");

    // A part of the text is never code because the code before it ended early.
    const tokens: Array<Token> = tokensOf(
      FeedMarkdown.textWithCode(
        "`a` [b](https://evil.example) `<!channel>` ![p](https://t.example/p.png)",
      ).toString(),
    );

    expect(
      tokens
        .filter((token: Token): boolean => {
          if (token.type === "link") {
            // Only a bare address is a link, and it shows where it goes.
            return !showsItsAddress(
              (token as Tokens.Link).text,
              (token as Tokens.Link).href,
            );
          }

          return ["image", "html", "em", "strong"].includes(token.type);
        })
        .map((token: Token): string => {
          return token.raw;
        }),
    ).toEqual([]);
    expect(
      tokens
        .filter((token: Token): boolean => {
          return token.type === "codespan";
        })
        .map((token: Token): string => {
          return withoutJoiners(decodeHtml((token as Tokens.Codespan).text));
        }),
    ).toEqual(["a", "<!channel>"]);
  });

  test("textWithCode: text whose backticks do not pair is all text", () => {
    expect(FeedMarkdown.textWithCode("it`s *here*").toString()).toBe(
      "it\\`s \\*here\\*",
    );
    expect(FeedMarkdown.textWithCode(null).toString()).toBe("");
  });

  test("multilineText: each line as text, the line breaks kept", () => {
    const markdown: string = FeedMarkdown.multilineText(
      "first [x](https://evil.example)\n# second\n- third",
    ).toString();

    expect(markdown).toBe(
      "first \\[x\\](https://evil.example)\n\\# second\n\\- third",
    );
    expectOnlyText([markdown]);
  });

  test("multilineText: nothing for nothing", () => {
    expect(FeedMarkdown.multilineText(null).toString()).toBe("");
  });

  test("numberedList: numbered from 1, each item's bullets under it", () => {
    expect(
      FeedMarkdown.numberedList([
        { line: mdText`\`a\` — **3**`, bullets: ["Namespace: payments"] },
        { line: "plain" },
      ]).toString(),
    ).toBe("1. `a` — **3**\n   - Namespace: payments\n2. plain");
    expect(FeedMarkdown.numberedList([]).toString()).toBe("");
  });

  test("numberedList: bullets indented to the item's content column, past item 9 too", () => {
    const markdown: string = FeedMarkdown.numberedList(
      Array.from({ length: 10 }, (_: unknown, index: number) => {
        return { line: `item ${index + 1}`, bullets: [`detail ${index + 1}`] };
      }),
    ).toString();
    const lines: Array<string> = markdown.split("\n");

    expect(lines[1]).toBe("   - detail 1");
    expect(lines[18]).toBe("10. item 10");
    expect(lines[19]).toBe("    - detail 10");

    const listItems: Array<Token> = tokensOf(markdown).filter(
      (token: Token): boolean => {
        return token.type === "list_item";
      },
    );

    // Ten numbered items, each owning its one bullet.
    expect(listItems).toHaveLength(20);
  });

  test("numberedList: a hostile line or bullet stays text in its item", () => {
    const markdown: string = FeedMarkdown.numberedList(
      HOSTILE_VALUES.map((value: string) => {
        return { line: value, bullets: [value] };
      }),
    ).toString();

    expect(
      tokensOf(markdown).filter((token: Token): boolean => {
        return (
          ["image", "html", "heading", "blockquote", "code"].includes(
            token.type,
          ) ||
          (token.type === "link" &&
            !showsItsAddress(
              (token as Tokens.Link).text,
              (token as Tokens.Link).href,
            ))
        );
      }),
    ).toEqual([]);
  });

  test("trim: the same Markdown without the white space around it", () => {
    expect(mdText`  **${"x"}**\n`.trim().toString()).toBe("**x**");
    expect(FeedMarkdown.empty().trim().isEmpty()).toBe(true);
  });

  test("withoutInvisibleBreaks: the text a reader sees", () => {
    expect(
      FeedMarkdown.withoutInvisibleBreaks(`<${WORD_JOINER}!channel> ok`),
    ).toBe("<!channel> ok");
    expect(FeedMarkdown.withoutInvisibleBreaks(undefined)).toBe("");
  });

  test("templateText, reportedValue and withoutChatSequences: text for Markdown somebody else puts together", () => {
    expect(FeedMarkdown.templateText("[x](https://evil.example)")).toBe(
      "\\[x\\](https://evil.example)",
    );
    expect(FeedMarkdown.templateText("a\nb")).toBe("a b");
    expect(FeedMarkdown.templateText("a\nb", { keepLineBreaks: true })).toBe(
      "a\nb",
    );
    expect(FeedMarkdown.reportedValue("<!channel> ![x](y)")).not.toMatch(
      /<!channel>|!\[/,
    );
    expect(FeedMarkdown.withoutChatSequences("**kept** <!channel>")).toBe(
      `**kept** <${WORD_JOINER}!channel>`,
    );
  });

  test("aiWrittenForTeams: as aiWritten, and a tag in fenced code breaks too", () => {
    const answer: string =
      "Run this:\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n<b>bold</b> and `a<b`";
    const forTeams: string = FeedMarkdown.aiWrittenForTeams(answer).toString();

    expect(forTeams).not.toMatch(/<(?![\s\u2060])/);
    expect(FeedMarkdown.withoutInvisibleBreaks(forTeams)).toBe(
      FeedMarkdown.withoutInvisibleBreaks(
        FeedMarkdown.aiWritten(answer).toString(),
      ),
    );
    // Elsewhere aiWritten keeps a "<" in fenced code as it is.
    expect(FeedMarkdown.aiWritten(answer).toString()).toContain("\n<img src=x");
  });

  test("the HTML element pattern used above catches what it should", () => {
    expect(HTML_ELEMENT_PATTERN.test("<img src=x>")).toBe(true);
    expect(HTML_ELEMENT_PATTERN.test("&lt;img&gt;")).toBe(false);
  });
});
