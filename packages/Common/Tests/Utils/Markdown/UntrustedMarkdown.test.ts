import {
  LEXED_TEXT_MAX_LENGTH,
  neutralizeChatControlSequences,
  neutralizeMarkdownImagesAndDiagrams,
  neutralizeUntrustedMarkdown,
} from "../../../Utils/Markdown/UntrustedMarkdown";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import {
  INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH,
  INCIDENT_FORM_DESCRIPTION_MAX_LENGTH,
} from "../../../Types/Incident/IncidentFormPublic";
import { renderAsDashboard } from "./DashboardMarkdownRenderer";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Lexer, Token, Tokens, marked } from "marked";

/*
 * Markdown an incident form's reporter wrote - somebody with no account,
 * only the form's link - is stored as an incident's own text, which nobody
 * reads over before it is posted to Slack and Teams and rendered for every
 * responder and in every owner's email. Three things in it act on their own
 * there: chat control sequences (Slack mentions), images (fetched from the
 * reporter's server by every reader) and mermaid diagrams (run in the
 * reader's browser).
 *
 * What is pinned, for every shape of each:
 *
 *   - nothing survives that acts on its own - checked with a real lexer
 *     (marked, as the emails are rendered), a real Slack conversion, the
 *     dashboard's own parser (micromark with its GitHub extensions, run in
 *     a child process - jest stubs react-markdown and remark-gfm), and on
 *     the characters themselves: no "![" is left that is not escaped and
 *     that anything could complete, outside fenced code every renderer
 *     reads as code, and no info string reads "mermaid", character
 *     references decoded. The characters matter because the parsers do not
 *     read every text alike (see "whatever renderer reads it" below);
 *   - everything else reads exactly as typed: text and links around a
 *     neutralised image are untouched, code with image syntax in it that
 *     something could complete only gains an invisible word joiner - unless
 *     it is fenced code every renderer reads as code, which is left byte for
 *     byte, as is code without any - and a mention looks the same once the
 *     joiner is ignored;
 *   - it takes time in proportion to the text: marked, whose worst shapes
 *     take seconds at the 20000 characters a description may hold, reads
 *     only a text of at most LEXED_TEXT_MAX_LENGTH characters.
 */

const WORD_JOINER: string = "\u2060";

// Every token the lexer makes of the text, depth first.
function tokensOf(markdown: string): Array<Token> {
  const all: Array<Token> = [];

  marked.walkTokens(
    new Lexer({ gfm: true, breaks: false, pedantic: false }).lex(markdown),
    (token: Token): void => {
      all.push(token);
    },
  );

  return all;
}

function images(markdown: string): Array<Tokens.Image> {
  return tokensOf(markdown).filter((token: Token): boolean => {
    return token.type === "image";
  }) as Array<Tokens.Image>;
}

function links(markdown: string): Array<Tokens.Link> {
  return tokensOf(markdown).filter((token: Token): boolean => {
    return token.type === "link";
  }) as Array<Tokens.Link>;
}

function codeBlocks(markdown: string): Array<Tokens.Code> {
  return tokensOf(markdown).filter((token: Token): boolean => {
    return token.type === "code";
  }) as Array<Tokens.Code>;
}

function codeSpans(markdown: string): Array<string> {
  return tokensOf(markdown)
    .filter((token: Token): boolean => {
      return token.type === "codespan";
    })
    .map((token: Token): string => {
      return (token as Tokens.Codespan).text;
    });
}

// What marked renders, as the owners' and on-call emails are rendered.
function html(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

function withoutJoiners(text: string): string {
  return text.split(WORD_JOINER).join("");
}

/*
 * The text with its numeric character references decoded, as CommonMark
 * decodes them in an info string: ```&#109;ermaid is a mermaid fence.
 */
function withReferencesDecoded(text: string): string {
  return text.replace(
    /&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));/g,
    (_reference: string, hex?: string, decimal?: string): string => {
      const codePoint: number = hex ? parseInt(hex, 16) : Number(decimal);

      return codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "\uFFFD";
    },
  );
}

const HTML_IMAGE_PATTERN: RegExp = /<img/;
const MERMAID_CLASS_PATTERN: RegExp = /language-mermaid/i;

/*
 * What the dashboard's parser makes of each text: no image, and no code
 * block whose class holds "language-mermaid" - neither for a language that
 * decodes to "mermaid" nor for one such as "-language-mermaid", which a
 * viewer matching the class loosely would read as mermaid too.
 */
function expectInertInDashboard(texts: Array<string>): void {
  const htmls: Array<string> = renderAsDashboard(texts);

  texts.forEach((text: string, index: number): void => {
    const html: string = htmls[index]!;

    expect({
      text: text,
      image: HTML_IMAGE_PATTERN.test(html),
      diagram: MERMAID_CLASS_PATTERN.test(html),
    }).toEqual({ text: text, image: false, diagram: false });
  });
}

// How long neutralising one text may take, however it is shaped.
const TIME_BOUND_IN_MS: number = 1000;

// The unit repeated, cut to exactly this length.
function repeatTo(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

/*
 * The slowest shapes found for a text of a given length. On those marked
 * takes seconds for: emphasis next to image syntax, a run of unclosed
 * emphasis, brackets and emphasis - the markers tagging each place make
 * some of them worse still. Each gives a text of exactly the length asked,
 * in which something could complete every "![" - so none may be left open.
 */
const WORST_CASE_SHAPES: Array<[string, (length: number) => string]> = [
  [
    "back-to-back images",
    (length: number): string => {
      return repeatTo("![x](https://t.example/p.png)", length);
    },
  ],
  [
    "image openers, closed once at the end",
    (length: number): string => {
      return `${repeatTo("![", length - 4)}](u)`;
    },
  ],
  [
    "empty reference images before a definition",
    (length: number): string => {
      return `${repeatTo("![][a]", length - 8)}\n\n[a]: u`;
    },
  ],
  [
    "image openers before a definition",
    (length: number): string => {
      return `${repeatTo("![a]", length - 8)}\n\n[a]: u`;
    },
  ],
  [
    "images in strong emphasis",
    (length: number): string => {
      return repeatTo("**![](b)**", length);
    },
  ],
  [
    "images in underscore emphasis",
    (length: number): string => {
      return repeatTo("__![](b)__", length);
    },
  ],
  [
    "images with alt text in emphasis",
    (length: number): string => {
      return repeatTo("_![a](b)_", length);
    },
  ],
  [
    "text and images in emphasis",
    (length: number): string => {
      return repeatTo("**x![](b)**", length);
    },
  ],
  [
    "brackets in emphasis, then one image",
    (length: number): string => {
      return `${repeatTo("**a](b)**", length - 7)}![a](b)`;
    },
  ],
  [
    "emphasised image openers before a definition",
    (length: number): string => {
      return `${repeatTo("**![", length - 8)}\n\n[a]: b`;
    },
  ],
  [
    "one image, then unclosed emphasis",
    (length: number): string => {
      return `![a](b) ${repeatTo("*a ", length - 8)}`;
    },
  ],
  [
    "image openers in links",
    (length: number): string => {
      return `${repeatTo("[![a](", length - 4)}](u)`;
    },
  ],
  [
    "a run of backticks",
    (length: number): string => {
      return "`".repeat(length);
    },
  ],
  [
    "a run of tildes",
    (length: number): string => {
      return "~".repeat(length);
    },
  ],
  [
    "mermaid fences spelled with references",
    (length: number): string => {
      return repeatTo("```&#109;ermaid\n", length);
    },
  ],
  [
    "labels after text before a colon, then an image",
    (length: number): string => {
      return `${repeatTo("x[a]:", length - 9)}\n\n![a](u)`;
    },
  ],
  [
    "images in code spans",
    (length: number): string => {
      return repeatTo("`![](b)` ", length);
    },
  ],
];

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * Where each "![" whose "!" is not escaped starts - an image can only begin
 * at one of these, whichever parser reads the text.
 */
function openImageSyntax(text: string): Array<number> {
  const positions: Array<number> = [];

  for (
    let position: number = text.indexOf("![");
    position !== -1;
    position = text.indexOf("![", position + 1)
  ) {
    let backslashes: number = 0;

    while (
      position - backslashes - 1 >= 0 &&
      text[position - backslashes - 1] === "\\"
    ) {
      backslashes++;
    }

    if (backslashes % 2 === 0) {
      positions.push(position);
    }
  }

  return positions;
}

// Nothing in the text is fetched or run when it is shown.
function expectInert(markdown: string): void {
  expect(images(markdown)).toEqual([]);
  expect(html(markdown)).not.toContain("<img");
  expect(
    codeBlocks(markdown).filter((block: Tokens.Code): boolean => {
      return (block.lang || "").trim().toLowerCase().startsWith("mermaid");
    }),
  ).toEqual([]);
  /*
   * No fence of any renderer can open with "mermaid" as its language, as
   * typed or spelled with character references.
   */
  expect(withReferencesDecoded(markdown).toLowerCase()).not.toMatch(
    /(`{3,}|~{3,})[ \t]*mermaid/,
  );
}

/*
 * As expectInert, and on the characters: no image syntax is left open at
 * all, so no parser - however it reads the text around it - finds an image.
 */
function expectNoOpenImage(markdown: string): void {
  expectInert(markdown);
  expect(openImageSyntax(markdown)).toEqual([]);
}

describe("neutralizeChatControlSequences", () => {
  test.each([
    ["<!channel> Checkout is down"],
    ["<!here>"],
    ["<!everyone> please look"],
    ["<!subteam^S0123ABC> on-call"],
    ["<!subteam^S0123ABC|@sre>"],
    ["<!date^1392734382^{date_short}|Feb 18, 2014>"],
    ["hi <@U0123ABC>"],
    ["<@W0123ABC|jane>"],
    ["see <#C0123ABC>"],
    ["see <#C0123ABC|general>"],
  ])("breaks %j, and it still reads as typed", (text: string) => {
    const neutralized: string = neutralizeChatControlSequences(text);

    expect(neutralized).not.toMatch(/<[!@#]/);
    expect(neutralized.split(WORD_JOINER).join("")).toBe(text);
    expect(neutralized).toContain(`<${WORD_JOINER}`);
  });

  test("breaks every sequence in the text, code spans and blocks included", () => {
    const text: string =
      "<!here> and <@U1> and <#C1>\n\n`<!channel>`\n\n```\n<!everyone>\n```";

    const neutralized: string = neutralizeChatControlSequences(text);

    expect(neutralized).not.toMatch(/<[!@#]/);
    expect(neutralized.split(WORD_JOINER).join("")).toBe(text);
  });

  test.each([
    ["a plain sentence"],
    ["a < b and c > d"],
    ["<https://status.example.com>"],
    ["<jane@example.com>"],
    ["**bold** and _italic_"],
    ["<div>raw</div>"],
    ["a<b"],
    ["<"],
    ["<>"],
    ["< !channel>"],
    ["!here @jane #general"],
    [""],
    // Pasted HTML and PowerShell: none of it is a sequence Slack acts on.
    ["<!DOCTYPE html>"],
    ["<!doctype html>"],
    ["<!-- upstream 502 -->"],
    ["<![CDATA[a < b]]>"],
    ['<!ENTITY copy "&#169;">'],
    ["<# PowerShell block comment #>"],
    ["<#\n.SYNOPSIS\n  Restarts the pool.\n#>"],
  ])("leaves %j exactly as it is", (text: string) => {
    expect(neutralizeChatControlSequences(text)).toBe(text);
  });

  /*
   * A reporter pasting the page a proxy served into the description: a
   * responder copies it out of the report to reproduce the problem, and a
   * stored invisible character would turn "<!DOCTYPE" and "<!--" into text
   * in the browser it is pasted into.
   */
  test("stores an HTML page pasted in a code block exactly as typed", () => {
    const text: string =
      "```html\n<!DOCTYPE html>\n<!-- upstream 502 -->\n<![CDATA[x]]>\n```";

    expect(neutralizeUntrustedMarkdown(text)).toBe(text);
  });

  test("still breaks a mention right after a comment or a declaration", () => {
    expect(
      neutralizeChatControlSequences(
        "<!-- note --><!here> <!DOCTYPE html><@U0123ABC>",
      ),
    ).toBe(
      `<!-- note --><${WORD_JOINER}!here> <!DOCTYPE html><${WORD_JOINER}@U0123ABC>`,
    );
  });

  test("is idempotent", () => {
    const once: string = neutralizeChatControlSequences("<!channel> <@U1>");

    expect(neutralizeChatControlSequences(once)).toBe(once);
  });

  test.each([[null], [undefined]])(
    "turns %p into an empty text",
    (value: null | undefined) => {
      expect(neutralizeChatControlSequences(value)).toBe("");
    },
  );

  /*
   * What decides it: the text as the bot posts it to Slack. slackify keeps
   * <!here> and <@U1> as they are - in text and in code - and Slack reads
   * them as mentions; with the word joiner the "<" is escaped instead.
   */
  test("no Slack mention survives the bot's Markdown conversion", () => {
    const text: string =
      "**<!channel> Checkout is down**\n\n<!here> <!everyone> <!subteam^S1> <@U0123ABC> <#C0123ABC>\n\n`<!here>`\n\n```\n<@U1>\n```";

    const before: string = JSON.stringify(
      SlackUtil.getMarkdownBlocks({
        payloadMarkdownBlock: { _type: "WorkspacePayloadMarkdown", text: text },
      }),
    );
    const after: string = JSON.stringify(
      SlackUtil.getMarkdownBlocks({
        payloadMarkdownBlock: {
          _type: "WorkspacePayloadMarkdown",
          text: neutralizeChatControlSequences(text),
        },
      }),
    );

    // The unneutralised text really does carry live mentions.
    expect(before).toMatch(/<(![a-z]|@[A-Z0-9]|#C)/);
    expect(after).not.toMatch(/<(![a-z]|@[A-Z0-9]|#C)/);
    expect(after).toContain("&lt;");
  });
});

describe("neutralizeMarkdownImagesAndDiagrams - images", () => {
  test("turns an image into a link to the same address", () => {
    const text: string = "Look: ![the error](https://t.example/p.png) here";
    const result: string = neutralizeMarkdownImagesAndDiagrams(text);

    expect(result).toBe("Look: \\![the error](https://t.example/p.png) here");
    expectNoOpenImage(result);
    expect(
      links(result).map((link: Tokens.Link): string => {
        return link.href;
      }),
    ).toEqual(["https://t.example/p.png"]);
  });

  test("gives an image without alt text its address as the link's text, so the link can be seen", () => {
    const result: string = neutralizeMarkdownImagesAndDiagrams(
      "![](https://t.example/p.png)",
    );

    expect(result).toBe(
      "\\![https://t.example/p.png](https://t.example/p.png)",
    );
    expectNoOpenImage(result);
    expect(links(result)[0]!.text).toBe("https://t.example/p.png");
  });

  test("shortens a long address used as the link's text, and escapes it to read as typed", () => {
    const address: string = `https://t.example/${"a_b".repeat(40)}.png`;
    const result: string = neutralizeMarkdownImagesAndDiagrams(
      `![](${address})`,
    );

    expectNoOpenImage(result);
    expect(links(result)[0]!.href).toBe(address);
    // The underscores are escaped in the source, and read as typed.
    expect(html(result)).toContain(`>${address.slice(0, 80)}...</a>`);
  });

  test("gives an image with no address a plain word to click", () => {
    const result: string = neutralizeMarkdownImagesAndDiagrams("![]()");

    expect(result).toBe("\\![image]()");
    expectNoOpenImage(result);
  });

  test.each([
    ["an image with a title", '![x](https://t.example/p.png "Title")'],
    ["an image in angle brackets", "![x](<https://t.example/a b.png>)"],
    [
      "a full reference image",
      "See ![x][pic]\n\n[pic]: https://t.example/p.png",
    ],
    [
      "a collapsed reference image",
      "See ![pic][]\n\n[pic]: https://t.example/p.png",
    ],
    [
      "a shortcut reference image",
      "See ![pic]\n\n[pic]: https://t.example/p.png",
    ],
    [
      "a reference image defined before it",
      "[pic]: https://t.example/p.png\n\n![pic]",
    ],
    /*
     * marked takes a task list item's box off before it reads the item, so
     * a definition can follow the box on its line.
     */
    [
      "a reference image defined in a task list item",
      "- [ ] [pic]: https://t.example/p.png\n\n![pic]",
    ],
    [
      "a reference image defined in a ticked task list item in a block quote",
      "> 1. [x] [pic]: https://t.example/p.png\n\nSee ![pic] here",
    ],
    ["an image in a heading", "# Down ![x](https://t.example/p.png)"],
    ["an image in bold", "**![x](https://t.example/p.png)**"],
    ["an image in a block quote", "> quoted\n> ![x](https://t.example/p.png)"],
    ["an image in a nested block quote", "> > ![x](https://t.example/p.png)"],
    ["an image in a list item", "- one\n- ![x](https://t.example/p.png)"],
    [
      "an image in a nested list item",
      "1. one\n   - ![x](https://t.example/p.png)",
    ],
    [
      "an image in a table cell",
      "| a | b |\n|---|---|\n| ![x](https://t.example/p.png) | c |",
    ],
    [
      "an image inside a link (a badge)",
      "[![build](https://t.example/b.svg)](https://ci.example)",
    ],
    [
      "an image right after an exclamation mark",
      "Wow!![x](https://t.example/p.png)",
    ],
    [
      "an image after an escaped backslash",
      "\\\\![x](https://t.example/p.png)",
    ],
    ["an image after a code span", "`code`![x](https://t.example/p.png)"],
    [
      "an image inside raw inline HTML",
      "<span>![x](https://t.example/p.png)</span>",
    ],
    [
      "two images in a row",
      "![a](https://t.example/1.png)![b](https://t.example/2.png)",
    ],
    [
      "an image in the alt text of another",
      "![outer ![inner](https://t.example/1.png)](https://t.example/2.png)",
    ],
    [
      "an image on a line with Windows line endings",
      "a\r\n![x](https://t.example/p.png)\r\nb",
    ],
    [
      "an image with tab-indented text before it",
      "\tnot code\n\n![x](https://t.example/p.png)",
    ],
  ])("leaves nothing to fetch in %s", (_label: string, text: string) => {
    const before: number = images(text).length;
    const result: string = neutralizeMarkdownImagesAndDiagrams(text);

    // Each case really does hold an image before it is neutralised.
    expect(before).toBeGreaterThan(0);
    expectNoOpenImage(result);
  });

  test("keeps a reference image's definition, so the link still goes where the image did", () => {
    const result: string = neutralizeMarkdownImagesAndDiagrams(
      "See ![x][pic]\n\n[pic]: https://t.example/p.png",
    );

    expect(result).toBe("See \\![x][pic]\n\n[pic]: https://t.example/p.png");
    expect(links(result)[0]!.href).toBe("https://t.example/p.png");
  });

  test("changes only the image's own exclamation mark", () => {
    expect(
      neutralizeMarkdownImagesAndDiagrams("Wow!![x](https://t.example/p.png)"),
    ).toBe("Wow!\\![x](https://t.example/p.png)");
    expect(
      neutralizeMarkdownImagesAndDiagrams("\\\\![x](https://t.example/p.png)"),
    ).toBe("\\\\\\![x](https://t.example/p.png)");
  });

  /*
   * An address may hold image syntax, and every renderer reads a backslash
   * in an address as the character after it: the link goes where it did.
   */
  test("an image's syntax in a link's address is broken, and the link still goes to the same address", () => {
    const text: string = "[see](https://t.example/![x](y))";
    const result: string = neutralizeMarkdownImagesAndDiagrams(text);

    expect(result).toBe("[see](https://t.example/\\![x](y))");
    expectNoOpenImage(result);
    expect(
      links(result).map((link: Tokens.Link): string => {
        return link.href;
      }),
    ).toEqual(
      links(text).map((link: Tokens.Link): string => {
        return link.href;
      }),
    );
  });

  test.each([
    ["an escaped image", "\\![x](https://t.example/p.png)"],
    [
      "an exclamation mark before a link",
      "Look! [the page](https://t.example)",
    ],
    ["a plain link", "[the page](https://t.example/p.png)"],
    ["an autolink", "<https://t.example/p.png>"],
    ["a bare address", "https://t.example/p.png"],
    ["text with no Markdown at all", "Checkout fails at step 3."],
    ["an empty text", ""],
    // Nothing after them could complete an image.
    ["an exclamation mark before brackets", "Wow![sic] that failed"],
    [
      "Rust's vec! in a code block",
      "```rust\nlet v = vec![1, 2, 3];\n```\n\nSee [the docs](https://docs.example)",
    ],
    ["a non-null assertion in a code span", "`map.get(key)![0]` is undefined"],
    ["image syntax that is never closed", "![".repeat(50)],
    [
      "brackets closed only after the paragraph ends",
      "![a\n\n](https://t.example/p.png)",
    ],
    /*
     * A "]:" that could not start a link reference definition: only one at
     * the start of a line - after indentation, or block quote, list or
     * footnote markers - could complete "![y]".
     */
    [
      "code beside a Python slice elsewhere in the text",
      "`x = ![y]`\n\nfor x in lines[1:]:\n    print(x)",
    ],
    [
      "code beside a computed key and a log line",
      "`list![0]` then `{ [key]: value }`, and sshd[1]: accepted",
    ],
  ])("leaves %s exactly as written", (_label: string, text: string) => {
    expect(neutralizeMarkdownImagesAndDiagrams(text)).toBe(text);
  });

  /*
   * A fence opened at the very start of a line after a blank line (or at the
   * start of the text, or right after another such fence closes) is fenced
   * code to every renderer here, so image syntax in it can never be an
   * image: it is left byte for byte, and code copied out of a report is the
   * code that was reported - Rust's vec! with indexing after it included,
   * where "][" could otherwise complete the "![".
   */
  test("leaves image syntax in fenced code every renderer reads as code exactly as written", () => {
    const texts: Array<string> = [
      "```markdown\n![x](https://t.example/p.png)\n```",
      "~~~\n![x](https://t.example/p.png)\n~~~",
      "```rust\nlet grid = vec![vec![0; w]; h];\nlet v = grid[y][x];\n```",
      "Steps:\n\n```ts\ninterface Map {\n  [key: string]: T;\n}\nconst v = map![key];\n```\n\n[a]: https://docs.example",
      "```\n![a](https://t.example/1.png)\n```\n```\n![b](https://t.example/2.png)\n```",
      "````\n```\n![x](https://t.example/p.png)\n```\n````",
      "```\n<div>\n\n![x](https://t.example/p.png)\n```",
    ];

    for (const text of texts) {
      expect(neutralizeMarkdownImagesAndDiagrams(text)).toBe(text);
      expect(images(text)).toEqual([]);
    }

    expectInertInDashboard(texts);
  });

  /*
   * Where the renderers could pair the fences differently - a fence that is
   * indented, inside a container or after text, an HTML block, a closing
   * fence only one of them accepts, a byte-order mark - no fence is trusted
   * any more, and image syntax after it is broken as anywhere else.
   */
  test.each([
    [
      "a fence in a list item, ended by a line that is not",
      "- item\n\n  ```\n  code\n![x](https://t.example/p.png)\n```",
    ],
    [
      "a fence right after raw HTML",
      "<div>\n```\n\n![x](https://t.example/p.png)\n```",
    ],
    [
      "a fence inside an HTML comment",
      "<!--\n\n```\n-->\n![x](https://t.example/p.png)\n```",
    ],
    [
      "a fence closed only as marked reads it",
      "```\ncode\n```~\n\n```\n![x](https://t.example/p.png)\n```",
    ],
    [
      "a fence closed only as CommonMark reads it",
      "```\ncode\n```\t\n\n```\n![x](https://t.example/p.png)\n```",
    ],
    [
      "a fence after a byte-order mark",
      "\uFEFF```\n\n```\n![x](https://t.example/p.png)\n```",
    ],
    [
      "an indented fence",
      "   ````\n\n```\n\n   ````\n\n![x](https://t.example/p.png)\n```",
    ],
    [
      "a fence after a paragraph line",
      "text\n```\n\n```\n![x](https://t.example/p.png)\n```",
    ],
  ])("breaks image syntax after %s", (_label: string, text: string) => {
    const result: string = neutralizeMarkdownImagesAndDiagrams(text);

    expectNoOpenImage(result);
    expectInertInDashboard([result]);
  });

  test("keeps the line endings of a text it leaves alone", () => {
    const text: string = "a\r\nb `![x]`\r\n";

    expect(neutralizeMarkdownImagesAndDiagrams(text)).toBe(text);
  });

  /*
   * Code shows its characters as they are, so a backslash there would show.
   * Image syntax in other code that something could complete gets an
   * invisible word joiner between its "!" and "[" instead: the code reads
   * as typed, and no renderer that reads it as anything but code finds an
   * image in it either.
   */
  test.each([
    ["a code span", "Use `![x](https://t.example/p.png)` to embed"],
    [
      "a code span of two backticks",
      "Use ``a ` ![x](https://t.example/p.png)`` here",
    ],
    [
      "a fenced code block right after a line of text",
      "Run:\n```markdown\n![x](https://t.example/p.png)\n```",
    ],
    ["an indented code block", "Text:\n\n    ![x](https://t.example/p.png)"],
    [
      "a code block inside a list",
      "- item\n\n  ```\n  ![x](https://t.example/p.png)\n  ```",
    ],
    [
      "a code block inside a block quote",
      "> ```\n> ![x](https://t.example/p.png)\n> ```",
    ],
    ["a raw HTML block", "<div>\n![x](https://t.example/p.png)\n</div>"],
  ])(
    "breaks image syntax in %s invisibly, so it reads as written",
    (_label: string, text: string) => {
      const result: string = neutralizeMarkdownImagesAndDiagrams(text);

      expect(result).not.toBe(text);
      expect(withoutJoiners(result)).toBe(text);
      expect(result).toContain(`!${WORD_JOINER}[`);
      expectNoOpenImage(result);
      expect(codeSpans(result).map(withoutJoiners)).toEqual(codeSpans(text));
      expect(
        codeBlocks(result).map((block: Tokens.Code): string => {
          return withoutJoiners(block.text);
        }),
      ).toEqual(
        codeBlocks(text).map((block: Tokens.Code): string => {
          return block.text;
        }),
      );
    },
  );

  test("code beside an image reads as written: only the image becomes a link", () => {
    const text: string =
      "`![kept](https://t.example/k.png)` ![gone](https://t.example/g.png)\n\n```\n![kept too](https://t.example/k2.png)\n```";

    const result: string = neutralizeMarkdownImagesAndDiagrams(text);

    expectInert(result);
    expectInertInDashboard([result]);
    expect(codeSpans(result).map(withoutJoiners)).toEqual(codeSpans(text));
    expect(
      codeBlocks(result).map((block: Tokens.Code): string => {
        return block.text;
      }),
    ).toEqual(["![kept too](https://t.example/k2.png)"]);
    expect(result).toBe(
      `\`!${WORD_JOINER}[kept](https://t.example/k.png)\` \\![gone](https://t.example/g.png)\n\n\`\`\`\n![kept too](https://t.example/k2.png)\n\`\`\``,
    );
  });

  test("breaks an image in another's alt text too, in one pass, without touching the code beside them", () => {
    const text: string =
      "`![kept](https://t.example/k.png)` ![outer ![inner](https://t.example/1.png)](https://t.example/2.png)";

    const result: string = neutralizeMarkdownImagesAndDiagrams(text);

    expectNoOpenImage(result);
    expect(codeSpans(result).map(withoutJoiners)).toEqual([
      "![kept](https://t.example/k.png)",
    ]);
    expect(result).toBe(
      `\`!${WORD_JOINER}[kept](https://t.example/k.png)\` \\![outer \\![inner](https://t.example/1.png)](https://t.example/2.png)`,
    );
  });

  /*
   * The dashboard reads incident text with remark and GitHub's extensions,
   * footnotes included; the emails with marked. They disagree on these
   * shapes: to marked the image is in an indented code block, or in what
   * it takes for a link definition, while the dashboard shows it as an
   * image - which is why no reading of the text is trusted to decide
   * whether an image is safe to leave. (Checked against the dashboard's
   * react-markdown and remark-gfm, which jest stubs here.)
   */
  test.each([
    [
      "a link definition followed by an indented line",
      "[a]: https://x.example\n    ![x](https://t.example/p.png)",
      `[a]: https://x.example\n    !${WORD_JOINER}[x](https://t.example/p.png)`,
    ],
    [
      "a footnote definition",
      "See[^1]\n\n[^1]: ![x](https://t.example/p.png)",
      "See[^1]\n\n[^1]: \\![x](https://t.example/p.png)",
    ],
    [
      "a footnote's indented paragraph",
      "See[^1]\n\n[^1]: note\n\n    ![x](https://t.example/p.png)",
      `See[^1]\n\n[^1]: note\n\n    !${WORD_JOINER}[x](https://t.example/p.png)`,
    ],
    [
      "a footnote in a list item",
      "1. a\n\n   [^n]: ![x](https://t.example/p.png)\n\nsee[^n]",
      "1. a\n\n   [^n]: \\![x](https://t.example/p.png)\n\nsee[^n]",
    ],
    [
      "a reference image defined inside a footnote",
      "See[^1]\n\n[^1]: [pic]: https://t.example/p.png\n\n![pic]",
      "See[^1]\n\n[^1]: [pic]: https://t.example/p.png\n\n\\![pic]",
    ],
    [
      "a reference image defined after a byte order mark",
      "\uFEFF[pic]: https://t.example/p.png\n\n![pic]",
      "\uFEFF[pic]: https://t.example/p.png\n\n\\![pic]",
    ],
  ])(
    "leaves no image the dashboard would show in %s",
    (_label: string, text: string, expected: string) => {
      // marked finds no image here - the dashboard's renderer does.
      expect(images(text)).toEqual([]);

      const result: string = neutralizeMarkdownImagesAndDiagrams(text);

      expect(result).toBe(expected);
      expectNoOpenImage(result);
    },
  );

  /*
   * The lexer only chooses how each place is changed; a reporter who types
   * the private use characters the places are tagged with cannot make one
   * of them be skipped.
   */
  test("a reporter who types the tagging characters leaves nothing open", () => {
    const text: string =
      "\uE0000\uE001![x](https://t.example/p.png) `\uE0001\uE001` ![y](https://t.example/q.png) \uE0002\uE001";

    const result: string = neutralizeMarkdownImagesAndDiagrams(text);

    expectNoOpenImage(result);
  });

  test("keeps every other character of the text", () => {
    const text: string =
      "# Checkout\n\nSteps:\n\n1. Open **cart**\n2. See ![shot](https://t.example/s.png) and [logs](https://logs.example)\n\n> quoted\n";

    const result: string = neutralizeMarkdownImagesAndDiagrams(text);

    expect(result.replace("\\![shot]", "![shot]")).toBe(text);
  });

  test.each([[null], [undefined]])(
    "turns %p into an empty text",
    (value: null | undefined) => {
      expect(neutralizeMarkdownImagesAndDiagrams(value)).toBe("");
    },
  );

  /*
   * A description is capped at 20000 characters and a Rich text answer at
   * 10000 - all of it image syntax, emphasis around it, or whatever else a
   * stranger with the form's link chooses - and neutralising it runs in the
   * process that serves every tenant. marked takes seconds on some of these
   * shapes (the emphasis ones, and brackets), so it only reads a text of at
   * most LEXED_TEXT_MAX_LENGTH characters; at every one of these lengths,
   * neutralising stays a matter of milliseconds - the bound here is
   * generous - and leaves nothing to fetch. (marked is not asked whether
   * the result is inert: it would take seconds on some of them itself.)
   */
  test.each(WORST_CASE_SHAPES)(
    "neutralises a text made of %s quickly, at every length a form takes",
    (_label: string, shape: (length: number) => string) => {
      for (const length of [
        INCIDENT_FORM_DESCRIPTION_MAX_LENGTH,
        INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH,
        LEXED_TEXT_MAX_LENGTH,
      ]) {
        const text: string = shape(length);

        const started: number = Date.now();
        const result: string = neutralizeMarkdownImagesAndDiagrams(text);
        const elapsed: number = Date.now() - started;

        expect({
          length: text.length,
          fast: elapsed < TIME_BOUND_IN_MS,
        }).toEqual({ length: length, fast: true });
        expect(openImageSyntax(result)).toEqual([]);
        expect(withReferencesDecoded(result).toLowerCase()).not.toMatch(
          /(`{3,}|~{3,})[ \t]*mermaid/,
        );

        if (length <= LEXED_TEXT_MAX_LENGTH) {
          expectInert(result);
        }
      }
    },
  );

  test("hands the lexer a text of at most LEXED_TEXT_MAX_LENGTH characters, and never a longer one", () => {
    const lex: ReturnType<typeof jest.spyOn> = jest.spyOn(
      Lexer.prototype,
      "lex",
    );

    neutralizeMarkdownImagesAndDiagrams(
      repeatTo("See ![](https://t.example/p.png) ", LEXED_TEXT_MAX_LENGTH),
    );

    expect(lex).toHaveBeenCalledTimes(1);

    lex.mockClear();

    neutralizeMarkdownImagesAndDiagrams(
      repeatTo("See ![](https://t.example/p.png) ", LEXED_TEXT_MAX_LENGTH + 1),
    );

    expect(lex).not.toHaveBeenCalled();
  });

  /*
   * Without the lexer, what each place is has to be told from its own line.
   * For the shapes a real report has, that gives exactly what the lexer
   * gives: an image in text becomes a link, with its address as its text
   * when it had none; image syntax in a code span stays as typed, joined
   * invisibly; a mermaid fence every renderer reads as one is renamed.
   */
  test.each([
    ["an image without alt text", "See ![](https://t.example/p.png) here."],
    ["an image with alt text", "![the error](https://t.example/p.png)"],
    [
      "an image with an address in angle brackets and a title",
      '![](<https://t.example/a b.png> "The error")',
    ],
    ["an image with no address", "![]()"],
    ["image syntax in a code span", "Use `![x](https://t.example/p.png)`."],
    ["an indented code block", "Text:\n\n    ![x](https://t.example/p.png)"],
    ["a mermaid fence", "```mermaid\ngraph TD\n```"],
    [
      "a mermaid fence spelled with a reference",
      "```&#109;ermaid\ngraph TD\n```",
    ],
    ["image syntax in fenced code", "```\n![x](https://t.example/p.png)\n```"],
  ])(
    "neutralises %s in a text too long for the lexer as in a short one",
    (_label: string, text: string) => {
      const opening: string = `${repeatTo("Every order fails at checkout. ", LEXED_TEXT_MAX_LENGTH)}\n\n`;

      expect(neutralizeMarkdownImagesAndDiagrams(opening + text)).toBe(
        opening + neutralizeMarkdownImagesAndDiagrams(text),
      );
    },
  );

  test.each([
    [
      "a mermaid fence in a block quote",
      "> ```&#109;ermaid\n> graph TD\n> ```",
      `> \`\`\`${WORD_JOINER}&#109;ermaid\n> graph TD\n> \`\`\``,
    ],
    [
      "image syntax in a code span that goes on to another line",
      "Use `a\n![x](https://t.example/p.png)` here",
      "Use `a\n\\![x](https://t.example/p.png)` here",
    ],
  ])(
    "breaks %s in a text too long for the lexer, if less tidily",
    (_label: string, text: string, expected: string) => {
      const opening: string = `${repeatTo("Every order fails at checkout. ", LEXED_TEXT_MAX_LENGTH)}\n\n`;
      const result: string = neutralizeMarkdownImagesAndDiagrams(
        opening + text,
      );

      expect(result).toBe(opening + expected);
      expectInert(result);
      expectInertInDashboard([result]);
    },
  );
});

describe("neutralizeMarkdownImagesAndDiagrams - mermaid diagrams", () => {
  test("shows a mermaid diagram as the code it is", () => {
    const result: string = neutralizeMarkdownImagesAndDiagrams(
      "Flow:\n\n```mermaid\ngraph TD\n  A-->B\n```",
    );

    expect(result).toBe("Flow:\n\n```text\ngraph TD\n  A-->B\n```");
    expectInert(result);
    expect(codeBlocks(result)[0]!.text).toBe("graph TD\n  A-->B");
  });

  test.each([
    ["a tilde fence", "~~~mermaid\ngraph TD\n~~~"],
    ["a longer fence", "````mermaid\ngraph TD\n````"],
    ["a space before the language", "``` mermaid\ngraph TD\n```"],
    ["more after the language", "```mermaid {init: {}}\ngraph TD\n```"],
    ["another spelling", "```Mermaid\ngraph TD\n```"],
    ["a language that starts with mermaid", "```mermaid-js\ngraph TD\n```"],
    ["a fence in a block quote", "> ```mermaid\n> graph TD\n> ```"],
    ["a fence in a list item", "- flow:\n\n  ```mermaid\n  graph TD\n  ```"],
    ["an indented fence", "   ```mermaid\n   graph TD\n   ```"],
  ])("demotes %s", (_label: string, text: string) => {
    const result: string = neutralizeMarkdownImagesAndDiagrams(text);

    expectInert(result);
    expect(codeBlocks(result)).toHaveLength(1);
    expect(result).not.toContain(WORD_JOINER);
    expect(result.toLowerCase()).toContain("text");
  });

  /*
   * Where the lexer finds no mermaid fence, "mermaid" after a fence run
   * still gets an invisible word joiner before it: whatever another
   * renderer makes of the text, no language there reads "mermaid", and
   * the text reads as typed.
   */
  test.each([
    ["an inline code span", "Use ```mermaid``` fences to draw"],
    [
      "a mermaid fence shown inside another code block",
      "````markdown\n```mermaid\ngraph TD\n```\n````",
    ],
    ["a fence indented as code", "Text:\n\n    ```mermaid\n    graph\n    ```"],
    [
      "a fence in a footnote's indented paragraph (the dashboard draws it)",
      "See[^d]\n\n[^d]: flow\n\n    ```mermaid\n    graph TD\n    ```",
    ],
    [
      "a fence after a link definition, on an indented line",
      "[a]: https://x.example\n    ```mermaid\n    graph TD\n    ```",
    ],
  ])(
    "breaks %s invisibly, so it reads as written",
    (_label: string, text: string) => {
      const result: string = neutralizeMarkdownImagesAndDiagrams(text);

      expectInert(result);
      expect(result).toContain(`${WORD_JOINER}mermaid`);
      expect(withoutJoiners(result)).toBe(text);
    },
  );

  test.each([
    ["another language", "```js\nconst mermaid = 1;\n```"],
    ["the word in text", "We draw mermaid diagrams."],
  ])("leaves %s exactly as written", (_label: string, text: string) => {
    expect(neutralizeMarkdownImagesAndDiagrams(text)).toBe(text);
  });

  /*
   * The dashboard reads a fence's info string as CommonMark does, character
   * references decoded, so ```&#109;ermaid is a mermaid fence there - and a
   * viewer matching "language-mermaid" anywhere in a class would take
   * ```-language-mermaid for one too. So every "mermaid" in an info string,
   * as the dashboard decodes it, is broken, wherever it stands.
   */
  const SPELLED_MERMAID_FENCES: Array<[string, string]> = [
    ["a decimal reference", "```&#109;ermaid\ngraph TD\n```"],
    ["a reference inside the word", "```mer&#109;aid\ngraph TD\n```"],
    ["a hexadecimal reference", "```&#x6D;ermaid\ngraph TD\n```"],
    ["an upper-case hexadecimal reference", "```&#X6d;ermaid\ngraph TD\n```"],
    ["a reference with leading zeros", "```&#0000109;ermaid\ngraph TD\n```"],
    [
      "a reference for every letter",
      "```&#109;&#101;&#114;&#109;&#97;&#105;&#100;\ngraph TD\n```",
    ],
    ["a reference in a tilde fence", "~~~&#109;ermaid\ngraph TD\n~~~"],
    ["spaces before a reference", "```   &#109;ermaid\ngraph TD\n```"],
    ["a reference in a block quote", "> ```&#109;ermaid\n> graph TD\n> ```"],
    [
      "a reference in a list item",
      "- flow:\n\n  ```&#109;ermaid\n  graph TD\n  ```",
    ],
    [
      "a language ending in -language-mermaid",
      "```-language-mermaid\ngraph TD\n```",
    ],
    [
      "a language ending in .language-mermaid",
      "```.language-mermaid\ngraph TD\n```",
    ],
    [
      "a language ending in +language-mermaid, in a list item",
      "- ```+language-mermaid\n  graph TD\n  ```",
    ],
    ["capital letters", "```MERMAID\ngraph TD\n```"],
  ];

  test.each(SPELLED_MERMAID_FENCES)(
    "breaks a mermaid fence spelled with %s",
    (_label: string, text: string) => {
      const result: string = neutralizeMarkdownImagesAndDiagrams(text);

      expect(result).not.toBe(text);
      expectInert(result);
      expect(neutralizeMarkdownImagesAndDiagrams(result)).toBe(result);
    },
  );

  test("leaves the dashboard no mermaid fence where it would have found one in each", () => {
    const texts: Array<string> = SPELLED_MERMAID_FENCES.map(
      (fence: [string, string]): string => {
        return fence[1];
      },
    );

    // Every one of them really is a mermaid fence to the dashboard.
    for (const html of renderAsDashboard(texts)) {
      expect(html).toMatch(/class="language-[^"]*mermaid/i);
    }

    expectInertInDashboard(texts.map(neutralizeMarkdownImagesAndDiagrams));
  });

  test.each([
    ["```&#109;ermaid\ngraph TD\n```", "```text\ngraph TD\n```"],
    ["```-language-mermaid\ngraph TD\n```", "```text\ngraph TD\n```"],
    ["> ```mer&#x6D;aid\n> graph TD\n> ```", "> ```text\n> graph TD\n> ```"],
    [
      "```js mermaid\ngraph TD\n```",
      `\`\`\`js ${WORD_JOINER}mermaid\ngraph TD\n\`\`\``,
    ],
    [
      "Use ```&#109;ermaid``` fences",
      `Use \`\`\`${WORD_JOINER}&#109;ermaid\`\`\` fences`,
    ],
  ])(
    "gives %j the language text where it is a fence, and breaks it elsewhere",
    (text: string, expected: string) => {
      expect(neutralizeMarkdownImagesAndDiagrams(text)).toBe(expected);
    },
  );
});

describe("neutralizeUntrustedMarkdown", () => {
  test("neutralises images, diagrams and mentions together", () => {
    const text: string =
      "<!here> ![](https://t.example/p.png)\n\n```mermaid\ngraph TD\n```\n\n[Verify your session](https://evil.example/login) <@U0123ABC>";

    const result: string = neutralizeUntrustedMarkdown(text);

    expectNoOpenImage(result);
    expect(result).not.toMatch(/<[!@#]/);
    // Links stay links: the reporter linking the broken page is the point.
    expect(
      links(result).map((link: Tokens.Link): string => {
        return link.href;
      }),
    ).toEqual(["https://t.example/p.png", "https://evil.example/login"]);
    expect(result.split(WORD_JOINER).join("")).toBe(
      "<!here> \\![https://t.example/p.png](https://t.example/p.png)\n\n```text\ngraph TD\n```\n\n[Verify your session](https://evil.example/login) <@U0123ABC>",
    );
  });

  test("leaves ordinary Markdown exactly as written", () => {
    const text: string =
      "Checkout fails at **step 3**.\n\n- since 09:00\n- EU only\n\n```\nError 502\n```";

    expect(neutralizeUntrustedMarkdown(text)).toBe(text);
  });

  test.each([[null], [undefined]])(
    "turns %p into an empty text",
    (value: null | undefined) => {
      expect(neutralizeUntrustedMarkdown(value)).toBe("");
    },
  );
});
