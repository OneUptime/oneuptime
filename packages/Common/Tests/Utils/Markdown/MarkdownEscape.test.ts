import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import escapeMarkdownInlineDefault, {
  WORD_JOINER,
  escapeMarkdownInline,
  escapeMarkdownValue,
  neutralizeChatControlSequences,
  neutralizeChatLinkSequences,
  neutralizeTagStarts,
} from "../../../Utils/Markdown/MarkdownEscape";
import { neutralizeChatControlSequences as neutralizeChatControlSequencesFromUntrustedMarkdown } from "../../../Utils/Markdown/UntrustedMarkdown";
import { describe, expect, test } from "@jest/globals";
import { Token, marked } from "marked";

/*
 * escapeMarkdownInline is the one thing standing between a user-typed name and
 * a feed renderer that does not run in safe mode. The attacks it has to stop
 * are concrete - closing a link early, a tracking-pixel image, raw HTML, a
 * heading or list smuggled in on a new line - so each gets a test of its own,
 * and the general property ("nothing special survives unescaped, and the text
 * still reads as typed") is checked across a corpus of hostile names.
 */

const SPECIAL_CHARACTERS: Array<string> = [
  "\\",
  "`",
  "*",
  "_",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  "!",
  "|",
  "<",
  ">",
];

/*
 * CommonMark: a backslash before any ASCII punctuation character renders as
 * that character. This is what a markdown renderer does to the escaped value,
 * so undoing it must give back exactly what the user typed.
 */
type RenderEscapesFunction = (escaped: string) => string;

const renderEscapes: RenderEscapesFunction = (escaped: string): string => {
  return escaped.replace(/\\([!-/:-@[-`{-~])/g, "$1");
};

/*
 * Removes every escape sequence the helper produces; whatever special
 * character is left over would be interpreted by a markdown renderer.
 */
type StripEscapeSequencesFunction = (escaped: string) => string;

const stripEscapeSequences: StripEscapeSequencesFunction = (
  escaped: string,
): string => {
  return escaped.replace(/\\[\\`*_[\]()#+\-!|<>]/g, "");
};

const UNESCAPED_SPECIAL_CHARACTER: RegExp = /[\\`*_[\]()#+\-!|<>]/;

const HOSTILE_NAMES: Array<string> = [
  "Checkout](https://evil.example) [click",
  "![pixel](https://tracker.example/p.png)",
  "<img src=x onerror=alert(1)>",
  "<script>alert('x')</script>",
  "**bold** and _italic_ and `code`",
  "a | b | c",
  "# Heading",
  "- list item",
  "+ list item",
  "1) ordered",
  "C:\\Program Files\\app",
  "trailing backslash \\",
  "[SLO Name](javascript:alert(1))",
  "nested [[brackets]] ((parens))",
  "~~strike~~ and ==mark==",
  "emoji 🚀 and accents café",
  "",
];

describe("escapeMarkdownInline - empty input", () => {
  test("null becomes an empty string", () => {
    expect(escapeMarkdownInline(null)).toBe("");
  });

  test("undefined becomes an empty string", () => {
    expect(escapeMarkdownInline(undefined)).toBe("");
  });

  test("an empty string stays empty", () => {
    expect(escapeMarkdownInline("")).toBe("");
  });

  test("a runtime non-string is stringified rather than throwing", () => {
    // A column typed `string` can still arrive as a number from a raw query.
    expect(escapeMarkdownInline(42 as unknown as string)).toBe("42");
  });
});

describe("escapeMarkdownInline - text that needs no escaping", () => {
  test("plain words, digits and spaces pass through unchanged", () => {
    expect(escapeMarkdownInline("Checkout API 99 percent")).toBe(
      "Checkout API 99 percent",
    );
  });

  test("punctuation outside the escaped set passes through unchanged", () => {
    /*
     * These do not start any inline construct the feed cares about, so
     * escaping them would only add noise to stored text.
     */
    const untouched: string = ". , : ; ' \" ~ = & % $ @ ? / { } ^";

    expect(escapeMarkdownInline(untouched)).toBe(untouched);
  });

  test("unicode and emoji are preserved", () => {
    expect(escapeMarkdownInline("Café 🚀 Überwachung")).toBe(
      "Café 🚀 Überwachung",
    );
  });

  test("leading and trailing spaces are kept, not trimmed", () => {
    expect(escapeMarkdownInline("  padded  ")).toBe("  padded  ");
  });
});

describe("escapeMarkdownInline - every special character", () => {
  test.each(SPECIAL_CHARACTERS)(
    "prefixes %s with a backslash",
    (character: string) => {
      expect(escapeMarkdownInline(character)).toBe(`\\${character}`);
    },
  );

  test("escapes each occurrence, not just the first", () => {
    expect(escapeMarkdownInline("***")).toBe("\\*\\*\\*");
    expect(escapeMarkdownInline("a_b_c")).toBe("a\\_b\\_c");
  });

  test("escapes the whole set in one string", () => {
    expect(escapeMarkdownInline(SPECIAL_CHARACTERS.join(""))).toBe(
      SPECIAL_CHARACTERS.map((character: string): string => {
        return `\\${character}`;
      }).join(""),
    );
  });
});

describe("escapeMarkdownInline - links and images", () => {
  test("a name cannot close the surrounding link early", () => {
    /*
     * Interpolated as `[SLO ${name}](link)`, an unescaped `](` would end the
     * link text at the user's chosen spot and point it at their URL.
     */
    expect(escapeMarkdownInline("Checkout](https://evil.example)")).toBe(
      "Checkout\\]\\(https://evil.example\\)",
    );
  });

  test("a name cannot open a link of its own", () => {
    expect(escapeMarkdownInline("[click me](https://evil.example)")).toBe(
      "\\[click me\\]\\(https://evil.example\\)",
    );
  });

  test("image syntax is neutralised, so no zero-click request is made", () => {
    expect(escapeMarkdownInline("![x](https://tracker.example/p.png)")).toBe(
      "\\!\\[x\\]\\(https://tracker.example/p.png\\)",
    );
  });

  test("a javascript: link target is inert once its brackets are escaped", () => {
    expect(escapeMarkdownInline("[go](javascript:alert(1))")).toBe(
      "\\[go\\]\\(javascript:alert\\(1\\)\\)",
    );
  });

  test("a bare URL is left readable", () => {
    expect(escapeMarkdownInline("https://status.example.com/a.b")).toBe(
      "https://status.example.com/a.b",
    );
  });
});

describe("escapeMarkdownInline - emphasis, code and tables", () => {
  test("bold and italic markers are escaped", () => {
    expect(escapeMarkdownInline("**bold** _italic_")).toBe(
      "\\*\\*bold\\*\\* \\_italic\\_",
    );
  });

  test("snake_case names do not turn into italics", () => {
    expect(escapeMarkdownInline("checkout_api_latency")).toBe(
      "checkout\\_api\\_latency",
    );
  });

  test("backticks cannot open an inline code span", () => {
    expect(escapeMarkdownInline("`rm -rf`")).toBe("\\`rm \\-rf\\`");
  });

  test("pipes cannot split a table cell", () => {
    expect(escapeMarkdownInline("api | web")).toBe("api \\| web");
  });
});

describe("escapeMarkdownInline - HTML", () => {
  test("an HTML tag is escaped so it renders as text", () => {
    expect(escapeMarkdownInline("<img src=x onerror=alert(1)>")).toBe(
      "\\<img src=x onerror=alert\\(1\\)\\>",
    );
  });

  test("a closing tag is escaped too", () => {
    expect(escapeMarkdownInline("</div>")).toBe("\\</div\\>");
  });

  test("an autolink cannot be formed", () => {
    expect(escapeMarkdownInline("<https://evil.example>")).toBe(
      "\\<https://evil.example\\>",
    );
  });
});

describe("escapeMarkdownInline - block syntax", () => {
  test("a heading marker is escaped", () => {
    expect(escapeMarkdownInline("# Heading")).toBe("\\# Heading");
  });

  test("list markers are escaped", () => {
    expect(escapeMarkdownInline("- item")).toBe("\\- item");
    expect(escapeMarkdownInline("+ item")).toBe("\\+ item");
  });

  test("a literal backslash is doubled so it cannot escape what follows", () => {
    expect(escapeMarkdownInline("C:\\temp")).toBe("C:\\\\temp");
    expect(escapeMarkdownInline("end\\")).toBe("end\\\\");
  });
});

describe("escapeMarkdownInline - line breaks", () => {
  test("a newline becomes a space", () => {
    expect(escapeMarkdownInline("line one\nline two")).toBe(
      "line one line two",
    );
  });

  test("a Windows line break becomes ONE space, not two", () => {
    expect(escapeMarkdownInline("line one\r\nline two")).toBe(
      "line one line two",
    );
  });

  test("a lone carriage return becomes a space", () => {
    expect(escapeMarkdownInline("line one\rline two")).toBe(
      "line one line two",
    );
  });

  test("each break is replaced, so a blank line becomes two spaces", () => {
    /*
     * Collapsing runs is not the helper's job; what matters is that no break
     * survives to start a new paragraph.
     */
    expect(escapeMarkdownInline("a\n\nb")).toBe("a  b");
  });

  test("a heading smuggled in on a new line stays inline and escaped", () => {
    expect(escapeMarkdownInline("Name\n# Injected heading")).toBe(
      "Name \\# Injected heading",
    );
  });

  test("a block quote or list on a new line stays inline", () => {
    expect(escapeMarkdownInline("Name\n> quote\n- item")).toBe(
      "Name \\> quote \\- item",
    );
  });

  test("no line break of any kind survives", () => {
    expect(escapeMarkdownInline("a\nb\r\nc\rd")).not.toMatch(/[\r\n]/);
  });
});

describe("escapeMarkdownInline - properties over hostile names", () => {
  test.each(HOSTILE_NAMES)(
    "leaves no special character unescaped in %j",
    (name: string) => {
      const escaped: string = escapeMarkdownInline(name);

      expect(stripEscapeSequences(escaped)).not.toMatch(
        UNESCAPED_SPECIAL_CHARACTER,
      );
    },
  );

  test.each(HOSTILE_NAMES)(
    "renders back to exactly the typed text for %j",
    (name: string) => {
      /*
       * The point of escaping rather than stripping: the reader sees the name
       * the user typed, character for character.
       */
      expect(renderEscapes(escapeMarkdownInline(name))).toBe(name);
    },
  );

  test("renders a multi-line name back to the typed text with spaces for breaks", () => {
    expect(renderEscapes(escapeMarkdownInline("a*b\r\nc_d\ne"))).toBe(
      "a*b c_d e",
    );
  });

  test("never shortens its input", () => {
    for (const name of HOSTILE_NAMES) {
      expect(escapeMarkdownInline(name).length).toBeGreaterThanOrEqual(
        name.replace(/\r\n/g, "\n").length,
      );
    }
  });
});

describe("escapeMarkdownInline - idempotence (deliberately NOT idempotent)", () => {
  /*
   * Escaping twice escapes the backslashes the first pass added, and the reader
   * then sees them. That is correct behaviour for an escaper - the second call
   * cannot know the input was already escaped - so the contract is "escape
   * exactly once, at interpolation time, and never store the escaped form".
   * These tests pin that so nobody "fixes" it into something that silently
   * stops escaping user-typed backslashes.
   */
  test("text with nothing to escape is unchanged by any number of passes", () => {
    const plain: string = "Checkout API";

    expect(escapeMarkdownInline(escapeMarkdownInline(plain))).toBe(plain);
  });

  test("a second pass escapes the first pass's backslashes", () => {
    expect(escapeMarkdownInline(escapeMarkdownInline("a*b"))).toBe("a\\\\\\*b");
  });

  test("a double-escaped name renders with a visible backslash", () => {
    expect(
      renderEscapes(escapeMarkdownInline(escapeMarkdownInline("a*b"))),
    ).toBe("a\\*b");
  });

  test("a user-typed backslash before a special character is still escaped", () => {
    /*
     * If the helper tried to skip "already escaped" sequences, this name would
     * pass through and render as a bare `*`, losing the backslash the user
     * actually typed.
     */
    expect(escapeMarkdownInline("\\*")).toBe("\\\\\\*");
    expect(renderEscapes(escapeMarkdownInline("\\*"))).toBe("\\*");
  });
});

describe("MarkdownEscape module shape", () => {
  test("the default export is the named export", () => {
    expect(escapeMarkdownInlineDefault).toBe(escapeMarkdownInline);
  });
});

/*
 * escapeMarkdownValue is for a value put into Markdown that a person reads
 * and edits before posting it (a note template's {{placeholders}}). It
 * escapes only what can turn a value into a link, an image or HTML, so the
 * rest reads as typed even in the composer's visual mode, which shows a
 * backslash escape as written.
 */
describe("escapeMarkdownValue", () => {
  test("empty input becomes an empty string", () => {
    expect(escapeMarkdownValue(null)).toBe("");
    expect(escapeMarkdownValue(undefined)).toBe("");
    expect(escapeMarkdownValue("")).toBe("");
  });

  test("everyday punctuation is left as typed", () => {
    const untouched: string =
      "Site 03 - payments (EU) #42 + 50% off! **really** _now_ `code` a|b ~x~ C:/ok";

    expect(escapeMarkdownValue(untouched)).toBe(untouched);
  });

  test.each(["[", "]", "<", "\\"])(
    "prefixes %s with a backslash",
    (character: string) => {
      expect(escapeMarkdownValue(character)).toBe(`\\${character}`);
    },
  );

  test("a value cannot become a link", () => {
    expect(
      escapeMarkdownValue("[Reset your password](https://evil.example)"),
    ).toBe("\\[Reset your password\\](https://evil.example)");
  });

  test("a value cannot become an image", () => {
    expect(escapeMarkdownValue("![](https://tracker.example/p.png)")).toBe(
      "!\\[\\](https://tracker.example/p.png)",
    );
  });

  test("a value cannot become HTML or an autolink", () => {
    expect(escapeMarkdownValue("<img src=x onerror=alert(1)>")).toBe(
      "\\<img src=x onerror=alert(1)>",
    );
    expect(escapeMarkdownValue("<https://evil.example>")).toBe(
      "\\<https://evil.example>",
    );
  });

  test("a backslash in the value cannot undo the escape after it", () => {
    /*
     * Left alone, the value's backslash would pair with the one added before
     * the bracket: a literal backslash, then a live bracket.
     */
    expect(escapeMarkdownValue("\\[x](https://evil.example)")).toBe(
      "\\\\\\[x\\](https://evil.example)",
    );
  });

  test("line breaks become spaces by default", () => {
    expect(escapeMarkdownValue("one\ntwo\r\nthree\rfour")).toBe(
      "one two three four",
    );
  });

  test("line breaks are kept when asked, normalized to \\n", () => {
    expect(
      escapeMarkdownValue("one\r\ntwo\n[three]", { keepLineBreaks: true }),
    ).toBe("one\ntwo\n\\[three\\]");
  });

  test("rendering the escapes gives back exactly what was typed", () => {
    for (const name of HOSTILE_NAMES) {
      expect(renderEscapes(escapeMarkdownValue(name))).toBe(
        name.replace(/\r\n|\r|\n/g, " "),
      );
    }
  });

  test("no bracket, angle bracket or backslash is left unescaped", () => {
    for (const name of HOSTILE_NAMES) {
      expect(escapeMarkdownValue(name).replace(/\\[\\[\]<]/g, "")).not.toMatch(
        /[\\[\]<]/,
      );
    }
  });
});

/*
 * Both escapers also break chat control sequences. A feed item's Markdown is
 * posted to Slack, and slackify keeps "<!channel>" and "<@U123>" as they are -
 * that is how a Slack mention is written - after the Markdown parser has
 * already consumed the backslash escapes. So a title holding one would page
 * a channel. With an invisible word joiner after the "<", Slack shows the
 * characters, and the text still reads as typed.
 */
const CHAT_CONTROL_SEQUENCES: Array<string> = [
  "<!channel>",
  "<!here>",
  "<!everyone>",
  "<!subteam^S0123ABC>",
  "<!subteam^S0123ABC|@sre>",
  "<!date^1392734382^{date_short}|Feb 18, 2014>",
  "<@U0123ABC>",
  "<@W0123ABC|jane>",
  "<#C0123ABC>",
  "<#C0123ABC|general>",
];

// Characters an HTML or PowerShell paste holds that no chat tool acts on.
const NOT_CHAT_CONTROL_SEQUENCES: Array<string> = [
  "<!DOCTYPE html>",
  "<!-- upstream 502 -->",
  "<![CDATA[a < b]]>",
  "<# PowerShell block comment #>",
  "<https://status.example.com>",
  "a < b",
];

type EscapeFunction = (value: string) => string;

const ESCAPERS: Array<[string, EscapeFunction]> = [
  [
    "escapeMarkdownValue",
    (value: string): string => {
      return escapeMarkdownValue(value);
    },
  ],
  [
    "escapeMarkdownInline",
    (value: string): string => {
      return escapeMarkdownInline(value);
    },
  ],
];

function withoutWordJoiners(text: string): string {
  return text.split(WORD_JOINER).join("");
}

function slackTextOf(markdown: string): string {
  return JSON.stringify(
    SlackUtil.getMarkdownBlocks({
      payloadMarkdownBlock: {
        _type: "WorkspacePayloadMarkdown",
        text: markdown,
      },
    }),
  );
}

const SLACK_CONTROL_SEQUENCE_PATTERN: RegExp = /<(?:![a-z]|@[A-Z0-9]|#C)/;

describe("both escapers break chat control sequences", () => {
  test("the word joiner is U+2060, and both modules share one neutralizer", () => {
    expect(WORD_JOINER).toBe("⁠");
    expect(neutralizeChatControlSequencesFromUntrustedMarkdown).toBe(
      neutralizeChatControlSequences,
    );
  });

  describe.each(ESCAPERS)("%s", (_name: string, escape: EscapeFunction) => {
    test.each(CHAT_CONTROL_SEQUENCES)(
      "breaks %j with a word joiner, and it renders back as typed",
      (sequence: string) => {
        const typed: string = `Checkout is down ${sequence} now`;
        const escaped: string = escape(typed);

        expect(escaped).toContain(`<${WORD_JOINER}`);
        expect(renderEscapes(withoutWordJoiners(escaped))).toBe(typed);
      },
    );

    test.each(NOT_CHAT_CONTROL_SEQUENCES)(
      "adds no word joiner to %j",
      (text: string) => {
        const escaped: string = escape(text);

        expect(escaped).not.toContain(WORD_JOINER);
        expect(renderEscapes(escaped)).toBe(text);
      },
    );

    test("breaks every sequence in the value, not just the first", () => {
      const escaped: string = escape("<!here> and <@U1> and <#C1>");

      expect(escaped.split(`<${WORD_JOINER}`)).toHaveLength(4);
    });

    test("a second pass does not add a second word joiner", () => {
      const twice: string = escape(escape("<!channel>"));

      expect(twice.split(WORD_JOINER)).toHaveLength(2);
    });

    test("Slack reads no mention in the escaped value once slackify has converted it", () => {
      const value: string = CHAT_CONTROL_SEQUENCES.join(" ");

      // The value as typed really does carry live sequences.
      expect(slackTextOf(value)).toMatch(SLACK_CONTROL_SEQUENCE_PATTERN);

      /*
       * A backslash escape alone does not stop them: slackify reads the
       * Markdown first, which consumes the backslash.
       */
      expect(slackTextOf(value.replace(/</g, "\\<"))).toMatch(
        SLACK_CONTROL_SEQUENCE_PATTERN,
      );

      const slack: string = slackTextOf(`**Title:** ${escape(value)}`);

      expect(slack).not.toMatch(SLACK_CONTROL_SEQUENCE_PATTERN);
      expect(slack).toContain("&lt;");
    });
  });

  test("escapeMarkdownValue still leaves everyday punctuation as typed", () => {
    expect(escapeMarkdownValue("Site 03 - payments (EU) #42 @jane !now")).toBe(
      "Site 03 - payments (EU) #42 @jane !now",
    );
  });
});

// Slack's link syntax: "<" and an address of any scheme, then "|" and words.
const SLACK_LINK_PATTERN: RegExp = /<[A-Za-z][A-Za-z0-9+.-]*:[^>|]*\|/;

/*
 * Slack reads "<address|words>" as a link labelled with the words - for an
 * address of any scheme it links, not only a web one - and its Markdown
 * conversion passes code through as it is. In code, where nothing else is
 * escaped, only a "<" that starts such an address is broken.
 */
describe("neutralizeChatLinkSequences", () => {
  test.each([
    "<https://evil.example/login|Open the runbook>",
    "<http://evil.example/login|Open the runbook>",
    "<mailto:billing@evil.example|Write to billing>",
  ])(
    "breaks the address in %j, and it reads as written",
    (sequence: string) => {
      const typed: string = `See ${sequence} now`;
      const neutralized: string = neutralizeChatLinkSequences(typed);

      // In code, as typed, Slack really does get the link.
      expect(slackTextOf(`\`${typed}\``)).toMatch(SLACK_LINK_PATTERN);

      expect(neutralized).toContain(`<${WORD_JOINER}`);
      expect(withoutWordJoiners(neutralized)).toBe(typed);
      expect(slackTextOf(`\`${neutralized}\``)).not.toMatch(SLACK_LINK_PATTERN);
      expect(slackTextOf(`\`\`\`\n${neutralized}\n\`\`\``)).not.toMatch(
        SLACK_LINK_PATTERN,
      );
    },
  );

  test.each([
    "kubectl apply -f - <<EOF",
    "sort <ids.txt | uniq",
    "if (a < b) { return; }",
    "const seen: Map<string, number> = new Map();",
  ])("leaves %j as it is: no address starts there", (code: string) => {
    expect(neutralizeChatLinkSequences(code)).toBe(code);
  });

  test("is idempotent, and gives nothing for nothing", () => {
    const once: string = neutralizeChatLinkSequences(
      "<https://evil.example|a> <mailto:x@evil.example|b>",
    );

    expect(neutralizeChatLinkSequences(once)).toBe(once);
    expect(neutralizeChatLinkSequences(undefined)).toBe("");
    expect(neutralizeChatLinkSequences(null)).toBe("");
  });
});

/*
 * neutralizeTagStarts: text somebody typed in a chat tool - a Microsoft
 * Teams message saved as a note - placed into Markdown as a whole. Its
 * lines, lists and words stay as they are; a "<" that whitespace does not
 * follow gets an invisible word joiner, so no renderer reads a tag, a
 * comment, an autolink or a chat mention from it, and it still reads as
 * typed.
 */
describe("neutralizeTagStarts", () => {
  // Every token marked reads in some Markdown, nested ones included.
  function tokensOf(markdown: string): Array<Token> {
    const tokens: Array<Token> = [];

    marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
      tokens.push(token);
    });

    return tokens;
  }

  /*
   * What marked reads as HTML, or as an autolink in angle brackets. A bare
   * address is still a link, as it is wherever somebody types one.
   */
  function markupOf(markdown: string): Array<string> {
    return tokensOf(markdown)
      .filter((token: Token): boolean => {
        return (
          token.type === "html" ||
          (token.type === "link" && token.raw.startsWith("<"))
        );
      })
      .map((token: Token): string => {
        return `${token.type}: ${token.raw}`;
      });
  }

  const TYPED_MARKUP: Array<string> = [
    "<b>bold</b>",
    "<script>alert(1)</script>",
    "<img src=https://tracker.example/p.png>",
    "<!-- a comment -->",
    "<!DOCTYPE html>",
    "<?php echo 1; ?>",
    "<https://status.example.com>",
    "<ops@example.com>",
    "<!channel>",
    "<@U0123ABC>",
    "<#C0123ABC|general>",
  ];

  test.each(TYPED_MARKUP)(
    "%j reads as typed, and marked reads no HTML or link in it",
    (typed: string) => {
      const markdown: string = `Pinned: ${typed} done`;
      const neutralized: string = neutralizeTagStarts(markdown);

      expect(neutralized).toContain(`<${WORD_JOINER}`);
      expect(withoutWordJoiners(neutralized)).toBe(markdown);
      expect(markupOf(neutralized)).toEqual([]);
    },
  );

  test("as typed, marked does read markup in those", () => {
    // So the test above is not passing on text Markdown leaves alone anyway.
    const readAsMarkup: Array<string> = TYPED_MARKUP.filter(
      (typed: string): boolean => {
        return markupOf(`Pinned: ${typed} done`).length > 0;
      },
    );

    expect(readAsMarkup).toEqual(
      TYPED_MARKUP.filter((typed: string): boolean => {
        // Slack's own sequences are not Markdown; Slack reads them (below).
        return !["<!channel>", "<@U0123ABC>", "<#C0123ABC|general>"].includes(
          typed,
        );
      }),
    );
  });

  test("Slack reads no mention or link in it once slackify has converted it", () => {
    const typed: string = [
      "<!channel>",
      "<!here>",
      "<@U0123ABC>",
      "<#C0123ABC>",
      "<https://evil.example/login|Open the runbook>",
    ].join(" ");

    expect(slackTextOf(typed)).toMatch(SLACK_CONTROL_SEQUENCE_PATTERN);

    const slack: string = slackTextOf(neutralizeTagStarts(typed));

    expect(slack).not.toMatch(SLACK_CONTROL_SEQUENCE_PATTERN);
    expect(slack).not.toMatch(SLACK_LINK_PATTERN);
  });

  test("breaks every '<' that whitespace does not follow, one at the end too", () => {
    expect(neutralizeTagStarts("a<b <c <1 <= <- << <")).toBe(
      ["a<", "b <", "c <", "1 <", "= <", "- <", "< <", ""].join(WORD_JOINER),
    );
  });

  test.each([
    "Restarted the primary DB",
    "- Drained node-3\n- Rolled back v2.4.1",
    "@Jane and @Ravi, failover done at 12:03.",
    "p99 < 200 ms is fine, > 2 s pages someone",
    "a <\tb and c <\nd",
    'Tom & Jerry said "it\'s fixed" 🔥 数据库已恢复',
    "",
  ])("leaves %j exactly as it is", (text: string) => {
    expect(neutralizeTagStarts(text)).toBe(text);
  });

  test("is idempotent, and gives nothing for nothing", () => {
    const once: string = neutralizeTagStarts("<b>x</b> <!here> <a");

    expect(neutralizeTagStarts(once)).toBe(once);
    expect(neutralizeTagStarts(undefined)).toBe("");
    expect(neutralizeTagStarts(null)).toBe("");
  });
});
