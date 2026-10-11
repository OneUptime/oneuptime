import { stripHtmlTags } from "../../../App/Tests/FeatureSet/Docs/DocsHtmlText";
import removeHtmlMarkup, {
  removeHtmlMarkup as namedRemoveHtmlMarkup,
  replaceHtmlMarkup,
} from "../../Types/HtmlMarkup";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * removeHtmlMarkup (Common/Types/HtmlMarkup) is how product code reads text
 * out of HTML, or out of Markdown with HTML in it: docs anchors, docs tab
 * keys, the docs search index, and Microsoft Teams messages. It replaced a
 * single pass of /<[^>]*>/ in each, which code scanning reports as
 * incomplete multi-character sanitization.
 *
 * What it promises, and what these tests hold it to:
 *
 *   - text without markup comes back exactly as it went in;
 *   - every tag and comment is taken out whole, and the text around it is
 *     kept exactly as it is, entities included;
 *   - a "<" whose markup never ends is dropped on its own;
 *   - so what it returns never holds a "<", whatever it is given - nested,
 *     overlapping and unclosed markup included - and reading it again
 *     changes nothing;
 *   - on HTML a renderer or a chat client writes, it reads what a browser
 *     reads;
 *   - it takes time that grows with the length of the text alone.
 */

const browserText: (html: string) => string = (html: string): string => {
  return JSDOM.fragment(html).textContent || "";
};

// A small seeded generator, so the generated cases are the same every run.
const seededRandom: (seed: number) => (limit: number) => number = (
  seed: number,
): ((limit: number) => number) => {
  let state: number = seed;

  return (limit: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % limit;
  };
};

// Text made of the characters markup is made of, and some that are not.
const generatedTexts: (count: number, seed: number) => Array<string> = (
  count: number,
  seed: number,
): Array<string> => {
  const alphabet: Array<string> = [
    "<",
    ">",
    "!",
    "-",
    "=",
    '"',
    "'",
    "/",
    "?",
    " ",
    "\n",
    "s",
    "c",
    "r",
    "i",
    "p",
    "t",
    "a",
    "b",
    "é",
    "語",
    "😀",
    "&",
    ";",
  ];
  const random: (limit: number) => number = seededRandom(seed);
  const texts: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    let text: string = "";
    const length: number = random(28);

    for (let position: number = 0; position < length; position++) {
      text += alphabet[random(alphabet.length)];
    }

    texts.push(text);
  }

  return texts;
};

describe("removeHtmlMarkup", () => {
  it("is the module's default export and a named one", () => {
    expect(namedRemoveHtmlMarkup).toBe(removeHtmlMarkup);
  });

  describe("text without markup", () => {
    it.each([
      [""],
      ["Restarted the primary DB"],
      ["  spaced\tout\n\nover lines  "],
      ["p99 > 2 s pages someone; a --> b"],
      ["Tom &amp; Jerry &lt;b&gt; &#39;quoted&#39; &nbsp;"],
      ["数据库已恢复。確認お願いします。"],
      ["복구 완료 — डेटाबेस फिर से उपलब्ध है"],
      ["پایگاه داده دوباره در دسترس است"],
      ["🔥 on fire 🚒 ⚠️ 👍🏽 👨‍👩‍👧"],
    ])("comes back exactly as it went in: %j", (text: string) => {
      expect(removeHtmlMarkup(text)).toBe(text);
    });
  });

  describe("tags and comments", () => {
    it.each([
      [
        "a tag pair",
        "<p>Restarted the primary DB</p>",
        "Restarted the primary DB",
      ],
      [
        "nested tags",
        "<p>Do <strong><em>this</em></strong> first.</p>",
        "Do this first.",
      ],
      [
        "adjacent and void tags",
        "<b>a</b><i>b</i>one<br>two<br/>three<hr />",
        "abonetwothree",
      ],
      ["an empty tag", "<></>", ""],
      ["upper case", "<P>Upper</P><BR>", "Upper"],
      [
        "a tag over several lines",
        '<a\n  href="/docs/a_b"\n  class="x">link</a>',
        "link",
      ],
      [
        "attributes",
        '<a class="docs-link" href="/docs/a_b" data-x=\'1\'>guide</a>',
        "guide",
      ],
      [
        "a Teams mention and a span",
        '<div><at id="0">Jane</at> <span style="color:red">Sev 1</span></div>',
        "Jane Sev 1",
      ],
      [
        "a processing instruction and a declaration",
        '<?xml version="1.0"?><!DOCTYPE html>text',
        "text",
      ],
      ["a comment", "a<!-- a note -->b", "ab"],
      ["a comment over lines", "a<!--\n<b>x</b>\n-->b", "ab"],
      [
        "the shortest comments, as a browser ends them",
        "a<!-->b<!--->c<!---->d",
        "abcd",
      ],
    ])("takes out %s", (_case: string, html: string, text: string) => {
      expect(removeHtmlMarkup(html)).toBe(text);
    });

    it("keeps whitespace and text between tags exactly as they are", () => {
      expect(removeHtmlMarkup(" <b> a </b> ")).toBe("  a  ");
      expect(removeHtmlMarkup("<p>one</p>\n<p>two  words</p>\n")).toBe(
        "one\ntwo  words\n",
      );
    });

    it("leaves entities as they are", () => {
      expect(
        removeHtmlMarkup("<p>use &lt;script&gt; &amp; &quot;quotes&quot;</p>"),
      ).toBe("use &lt;script&gt; &amp; &quot;quotes&quot;");
    });
  });

  describe("attribute values", () => {
    it.each([
      ["double quotes", '<a title="a > b">link</a> after', "link after"],
      ["single quotes", "<img alt='1 > 0'>after", "after"],
      ["spaces around '='", "<a title = \"x>y\" class='p>q'>z</a>", "z"],
      ["the other quote inside", `<a title="it's > 1">x</a>`, "x"],
      ["a '<' inside", '<a title="<b>">x</a>', "x"],
    ])(
      "end a tag only at a '>' outside a quoted value: %s",
      (_case: string, html: string, text: string) => {
        expect(removeHtmlMarkup(html)).toBe(text);
      },
    );

    it("read an unquoted value up to the '>' that ends the tag", () => {
      expect(removeHtmlMarkup("<a title=a>b>c")).toBe("b>c");
    });

    it("read a quote that does not follow '=' as part of the tag, not a value", () => {
      expect(removeHtmlMarkup('<a b"c>d"')).toBe('d"');
    });

    it("drop the '<' alone when a quoted value never closes", () => {
      expect(removeHtmlMarkup('<a title="x>y and more')).toBe(
        'a title="x>y and more',
      );
    });
  });

  describe("markup a single pass of a tag pattern leaves behind", () => {
    it.each([
      ["a tag inside a tag's name", "<scr<script>ipt>", "ipt>"],
      ["an overlapping comment", "<!<!---->--", "--"],
      ["a tag before a tag", "<<script>script>alert(1)", "script>alert(1)"],
      ["a tag inside a tag", "<script<script>>alert(1)", ">alert(1)"],
      ["an unclosed tag", "hello <script", "hello script"],
      [
        "an unclosed tag after markup",
        "<b>bold</b> then <img src=x onerror=alert(1)",
        "bold then img src=x onerror=alert(1)",
      ],
      ["a run of '<'", "<<<<", ""],
      ["a '<' before text", "a < b <c", "a  b c"],
      [
        "a comment holding a tag and '>'",
        "a<!-- x > <script>y</script> -->b",
        "ab",
      ],
      ["an unclosed comment", "a<!-- never closed", "a!-- never closed"],
      [
        "a quoted value holding a whole tag",
        '<img alt="<script>" src=x>after',
        "after",
      ],
      ["tags that join once one is out", "<scr<!-- -->ipt>x", "ipt>x"],
    ])(
      "%s comes out with no '<'",
      (_case: string, html: string, text: string) => {
        const result: string = removeHtmlMarkup(html);

        expect(result).toBe(text);
        expect(result).not.toContain("<");
      },
    );
  });

  describe("what it returns", () => {
    const generated: Array<string> = generatedTexts(20000, 4242);

    it("never holds a '<', for any text", () => {
      const withAngleBracket: Array<string> = generated.filter(
        (text: string): boolean => {
          return removeHtmlMarkup(text).includes("<");
        },
      );

      expect(
        generated.some((text: string): boolean => {
          return text.includes("<");
        }),
      ).toBe(true);
      expect(withAngleBracket).toEqual([]);
    });

    it("is read the same a second time", () => {
      const changed: Array<string> = generated.filter(
        (text: string): boolean => {
          const once: string = removeHtmlMarkup(text);
          return removeHtmlMarkup(once) !== once;
        },
      );

      expect(changed).toEqual([]);
    });

    it("keeps every character it does not take out, in order", () => {
      // What is left is the input with whole pieces taken out.
      for (const text of generated.slice(0, 2000)) {
        const result: string = removeHtmlMarkup(text);
        let at: number = 0;

        for (const character of result) {
          at = text.indexOf(character, at);
          expect(at).toBeGreaterThanOrEqual(0);
          at += character.length;
        }
      }
    });

    it("reads markup as the docs tests' stripHtmlTags reads it", () => {
      /*
       * The docs tests read rendered pages with stripHtmlTags
       * (App/Tests/FeatureSet/Docs/DocsHtmlText.ts), a walk that looks ahead
       * from every "<". The two must agree on every text.
       */
      const differences: Array<string> = generated
        .filter((text: string): boolean => {
          return removeHtmlMarkup(text) !== stripHtmlTags(text);
        })
        .slice(0, 5);

      expect(differences).toEqual([]);
    });
  });

  describe("reads HTML as a browser does", () => {
    /*
     * HTML a renderer or a chat client writes has a "<" that is text as
     * "&lt;", so on it the text removeHtmlMarkup leaves - once its entities
     * are read - is what a browser shows.
     */
    it.each([
      [
        "a Teams message",
        '<div><div><at id="0">Adele Vance</at>&nbsp;Hello there</div></div>',
      ],
      [
        "a Teams reply quote",
        '<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="1"><strong itemprop="mri">Jane</strong><p itemprop="preview">Is the DB back?</p></blockquote><p>Yes.</p>',
      ],
      [
        "a Teams image",
        '<span><img height="63" src="https://graph.microsoft.com/v1.0/x/$value" width="67" style="vertical-align:bottom; width:67px"></span>',
      ],
      [
        "a docs heading",
        '<h2 id="x"><span class="docs-heading__text">Run <code class="docs-code-inline">oneuptime &lt;resource&gt; list</code></span></h2>',
      ],
      ["a quoted value holding '>'", '<a title="a > b">link</a> after'],
      ["a comment holding markup", "a<!-- x > y <b>z</b> -->b"],
      ["entities", "<p>use &lt;script&gt; &amp; &quot;quotes&quot; &#39;</p>"],
      [
        "other scripts and directions",
        '<p><strong>リクエストタイムアウト（秒）</strong>を</p><p dir="rtl">مانیتور <em>وب‌سایت</em></p>',
      ],
    ])("on %s", (_case: string, html: string) => {
      expect(browserText(removeHtmlMarkup(html))).toBe(browserText(html));
    });
  });

  describe("tags that never end, then tags that do", () => {
    /*
     * Each tag's end is looked for from its "<" until one is found never to
     * end; from then on every tag's end is looked up, worked out once from
     * the end of the text. Either way the reading is the same.
     */
    it.each([
      [
        "an unclosed quoted value, then tags",
        '<a title="x>y and <b>bold</b> <i>it</i>',
        'a title="x>y and bold it',
      ],
      [
        "an unclosed value, then a comment and tags",
        '<p>text <img src="x <!-- note --> <b>b</b>',
        'text img src="x  b',
      ],
      [
        "tags, an unclosed value, then a quoted value holding '>'",
        "<b>a</b><c d=\"e>f <b>g</b> <h i='j>k'>l",
        'ac d="e>f g l',
      ],
    ])("reads %s", (_case: string, html: string, text: string) => {
      expect(removeHtmlMarkup(html)).toBe(text);
      expect(removeHtmlMarkup(html)).toBe(stripHtmlTags(html));
    });
  });

  describe("replaceHtmlMarkup", () => {
    it("asks what each tag and comment becomes, given it as written", () => {
      const seen: Array<string> = [];
      const text: string = replaceHtmlMarkup(
        'one<br/>two<li class="x>y">three<!-- a > b --></p>',
        (markup: string): string => {
          seen.push(markup);
          return markup === "<br/>" ? "\n" : "|";
        },
      );

      expect(seen).toEqual([
        "<br/>",
        '<li class="x>y">',
        "<!-- a > b -->",
        "</p>",
      ]);
      expect(text).toBe("one\ntwo|three||");
    });

    it("does not ask about a '<' whose markup never ends, which goes alone", () => {
      const seen: Array<string> = [];
      const text: string = replaceHtmlMarkup(
        "a <b>c</b> <img src=x",
        (markup: string): string => {
          seen.push(markup);
          return "";
        },
      );

      expect(seen).toEqual(["<b>", "</b>"]);
      expect(text).toBe("a c img src=x");
    });

    it("holds no '<' when what it puts in place holds none", () => {
      for (const html of generatedTexts(5000, 77)) {
        expect(
          replaceHtmlMarkup(html, (): string => {
            return "-";
          }),
        ).not.toContain("<");
      }
    });

    it("reads markup as removeHtmlMarkup does", () => {
      for (const html of generatedTexts(5000, 78)) {
        expect(
          replaceHtmlMarkup(html, (): string => {
            return "";
          }),
        ).toBe(removeHtmlMarkup(html));
      }
    });
  });

  describe("time", () => {
    /*
     * Looking ahead from each "<" for the end of its tag read the rest of
     * the text again for every "<" that never closes. These texts take a
     * walk that does that minutes; read once, they take milliseconds. The
     * limit is far above that, so a slow machine does not fail it.
     */
    const LIMIT_IN_MS: number = 3000;

    it.each([
      ["a run of '<' before an unclosed value", "<".repeat(300000) + '=">'],
      ["comment openings", "<!--".repeat(100000) + ">"],
      ["unclosed comment openings", "<!--".repeat(100000) + "x>"],
      ["values opening and closing", '<a="'.repeat(100000) + ">"],
      ["tags", "<b>x</b>".repeat(60000)],
      ["text with a tag at the end", "word ".repeat(100000) + "<b>x</b>"],
    ])("reads %s in linear time", (_case: string, html: string) => {
      const started: number = Date.now();
      const result: string = removeHtmlMarkup(html);

      expect(Date.now() - started).toBeLessThan(LIMIT_IN_MS);
      expect(result).not.toContain("<");
    });
  });

  describe("imports", () => {
    it("imports nothing, so the docs anchor scripts can load it with a root install", () => {
      const source: string = fs.readFileSync(
        path.resolve(__dirname, "../../Types/HtmlMarkup.ts"),
        "utf8",
      );

      expect(source).not.toMatch(/^\s*import\b/m);
      expect(source).not.toMatch(/\brequire\(/);
    });
  });
});
