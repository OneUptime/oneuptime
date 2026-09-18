import escapeMarkdownInlineDefault, {
  escapeMarkdownInline,
} from "../../../Utils/Markdown/MarkdownEscape";
import { describe, expect, test } from "@jest/globals";

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
