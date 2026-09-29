import {
  neutralizeChatControlSequences,
  neutralizeMarkdownImagesAndDiagrams,
  neutralizeUntrustedMarkdown,
} from "../../../Utils/Markdown/UntrustedMarkdown";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import { describe, expect, test } from "@jest/globals";
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
 *     (marked, as the emails are rendered) and a real Slack conversion, and
 *     on the characters themselves: no "![" is left that is not escaped
 *     and that anything could complete, and no info string starts with
 *     "mermaid". The characters matter because the dashboard reads the
 *     text with another parser (remark, with footnotes), which this suite
 *     cannot run - jest stubs it - and which does not read every text as
 *     marked does (see "whatever renderer reads it" below);
 *   - everything else reads exactly as typed: text and links around a
 *     neutralised image are untouched, code with image syntax in it only
 *     gains an invisible word joiner, code without any is left byte for
 *     byte, and a mention looks the same once the joiner is ignored.
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
  // No fence of any renderer can open with "mermaid" as its language.
  expect(markdown.toLowerCase()).not.toMatch(/(`{3,}|~{3,})[ \t]*mermaid/);
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
  ])("leaves %j exactly as it is", (text: string) => {
    expect(neutralizeChatControlSequences(text)).toBe(text);
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
  ])("leaves %s exactly as written", (_label: string, text: string) => {
    expect(neutralizeMarkdownImagesAndDiagrams(text)).toBe(text);
  });

  test("keeps the line endings of a text it leaves alone", () => {
    const text: string = "a\r\nb `![x]`\r\n";

    expect(neutralizeMarkdownImagesAndDiagrams(text)).toBe(text);
  });

  /*
   * Code shows its characters as they are, so a backslash there would show.
   * Image syntax in code that something could complete gets an invisible
   * word joiner between its "!" and "[" instead: the code reads exactly as
   * typed, and no renderer that reads it as anything but code finds an
   * image in it either.
   */
  test.each([
    ["a code span", "Use `![x](https://t.example/p.png)` to embed"],
    [
      "a code span of two backticks",
      "Use ``a ` ![x](https://t.example/p.png)`` here",
    ],
    ["a fenced code block", "```markdown\n![x](https://t.example/p.png)\n```"],
    ["a tilde fence", "~~~\n![x](https://t.example/p.png)\n~~~"],
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

    expectNoOpenImage(result);
    expect(codeSpans(result).map(withoutJoiners)).toEqual(codeSpans(text));
    expect(
      codeBlocks(result).map((block: Tokens.Code): string => {
        return withoutJoiners(block.text);
      }),
    ).toEqual(["![kept too](https://t.example/k2.png)"]);
    expect(result).toBe(
      `\`!${WORD_JOINER}[kept](https://t.example/k.png)\` \\![gone](https://t.example/g.png)\n\n\`\`\`\n!${WORD_JOINER}[kept too](https://t.example/k2.png)\n\`\`\``,
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
   * A description is capped at 20000 characters - all of it can be image
   * syntax. Neutralising it must stay a matter of milliseconds and still
   * leave nothing to fetch.
   */
  test.each([
    ["back-to-back images", "![x](https://t.example/p.png)".repeat(700)],
    ["bare image openers", "![".repeat(10000)],
    ["nested image openers", `${"![a ".repeat(4000)}${"](u)".repeat(1000)}`],
    ["empty reference images", "![]".repeat(6000)],
    ["image openers before a definition", `${"![a]".repeat(4000)}\n\n[a]: u`],
  ])(
    "neutralises a description made of %s quickly",
    (_label: string, text: string) => {
      const started: number = Date.now();
      const result: string = neutralizeMarkdownImagesAndDiagrams(
        text.slice(0, 20000),
      );

      expect(Date.now() - started).toBeLessThan(5000);
      expectInert(result);
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
