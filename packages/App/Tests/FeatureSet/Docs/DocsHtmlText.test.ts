import { stripHtmlTags } from "./DocsHtmlText";
import { describe, expect, it } from "@jest/globals";

/*
 * stripHtmlTags, the one place the docs tests take tags out of rendered
 * HTML. It replaced a copied line.replace(/<[^>]*>/g, "") that code scanning
 * reported as incomplete multi-character sanitization: one pass can leave an
 * unclosed "<script" behind, or pieces that join into a new tag. These pin
 * what it reads as text and what it drops, including on the inputs that
 * defeat a single pass, and that it never returns a "<".
 *
 * That it reads every real docs page as a browser does is held in
 * Common/Tests/App/Docs/DocsHtmlTextReadsLikeABrowser (jsdom lives there).
 */

describe("stripHtmlTags", () => {
  describe("keeps the text", () => {
    it("returns an empty string for an empty one", () => {
      expect(stripHtmlTags("")).toBe("");
    });

    it("returns text without markup exactly as it was", () => {
      const text: string = "Retries after the first one: 3, then 5 * 60 s.";

      expect(stripHtmlTags(text)).toBe(text);
      expect(stripHtmlTags("  spaced\tout  ")).toBe("  spaced\tout  ");
    });

    it("keeps the text between tags, with its spaces and line breaks", () => {
      expect(stripHtmlTags("<p>one</p>\n<p>two  words</p>\n")).toBe(
        "one\ntwo  words\n",
      );
      expect(stripHtmlTags(" <b> a </b> ")).toBe("  a  ");
    });

    it("keeps Japanese, Chinese, Korean and Persian text as it is", () => {
      expect(
        stripHtmlTags(
          "<p><strong>リクエストタイムアウト（秒）</strong>を設定します。</p>",
        ),
      ).toBe("リクエストタイムアウト（秒）を設定します。");
      expect(stripHtmlTags("<p>在第一次尝试_之后_的重试。</p>")).toBe(
        "在第一次尝试_之后_的重试。",
      );
      expect(stripHtmlTags("<td>모니터 <code>상태</code></td>")).toBe(
        "모니터 상태",
      );
      expect(stripHtmlTags('<p dir="rtl">مانیتور <em>وب‌سایت</em></p>')).toBe(
        "مانیتور وب‌سایت",
      );
      // A character outside the Basic Multilingual Plane stays whole.
      expect(stripHtmlTags("<b>😀</b>𠮷")).toBe("😀𠮷");
    });

    it("leaves entities as they are, so an escaped tag stays text", () => {
      expect(
        stripHtmlTags("<p>use &lt;script&gt; tags &amp; &quot;quotes&quot;</p>"),
      ).toBe("use &lt;script&gt; tags &amp; &quot;quotes&quot;");
    });

    it("keeps a '>' that closes nothing", () => {
      expect(stripHtmlTags("a > b")).toBe("a > b");
      expect(stripHtmlTags("A --> B")).toBe("A --> B");
      expect(stripHtmlTags("<p>a</p> > b")).toBe("a > b");
    });

    it("keeps the quotes and markers of the text outside tags", () => {
      expect(
        stripHtmlTags(`<p>It's "quoted", **bold** and _italic_</p>`),
      ).toBe(`It's "quoted", **bold** and _italic_`);
    });
  });

  describe("drops tags", () => {
    it("drops nested tags", () => {
      expect(
        stripHtmlTags(
          '<div class="docs-step"><p>Do <strong><em>this</em></strong> first.</p></div>',
        ),
      ).toBe("Do this first.");
    });

    it("drops adjacent tags, void tags and self-closing tags", () => {
      expect(stripHtmlTags("<b>a</b><i>b</i><u>c</u>")).toBe("abc");
      expect(stripHtmlTags("one<br>two<br/>three<hr />")).toBe(
        "onetwothree",
      );
      expect(stripHtmlTags("<></>")).toBe("");
    });

    it("drops the attributes with the tag, underscores and all", () => {
      expect(
        stripHtmlTags(
          '<a class="docs-link" href="/docs/monitor/website_monitor">the guide</a>',
        ),
      ).toBe("the guide");
      expect(
        stripHtmlTags(
          '<img src="/docs/static/images/a_b.png" alt="a_b" class="docs-image" loading="lazy" />',
        ),
      ).toBe("");
      expect(
        stripHtmlTags('<button data-docs-tab="first_tab">First</button>'),
      ).toBe("First");
    });

    it("drops a tag whose quoted attribute value holds a '>'", () => {
      expect(stripHtmlTags('<a title="a > b">link</a>')).toBe("link");
      expect(stripHtmlTags("<img alt='1 > 0'>after")).toBe("after");
      expect(stripHtmlTags('<a title = "x>y" class=\'p>q\'>z</a>')).toBe("z");
      // A quote of the other kind inside a value does not end it.
      expect(stripHtmlTags(`<a title="it's > 1">x</a>`)).toBe("x");
      expect(stripHtmlTags(`<a title='say "a > b"'>x</a>`)).toBe("x");
    });

    it("ends a tag at the first '>' when the value is not quoted", () => {
      // As a browser reads it: an unquoted value ends at ">".
      expect(stripHtmlTags("<a title=a>b>c")).toBe("b>c");
      // A quote that does not open a value is a character of the tag.
      expect(stripHtmlTags('<a b"c>d')).toBe("d");
      expect(stripHtmlTags('<a href=x"y>z')).toBe("z");
    });

    it("drops a tag that runs over several lines", () => {
      expect(stripHtmlTags('<a\n  href="/docs/a_b"\n  class="x">link</a>')).toBe(
        "link",
      );
      expect(stripHtmlTags('<p title="one\ntwo">text</p>')).toBe("text");
    });
  });

  describe("drops comments", () => {
    it("drops a comment whole, with the tags and '>' inside it", () => {
      expect(stripHtmlTags("a<!-- note -->b")).toBe("ab");
      expect(stripHtmlTags("a<!-- x > y <b>z</b> -> w -->b")).toBe("ab");
      expect(stripHtmlTags("a<!--\nTODO(i18n): fix_this\n-->b")).toBe("ab");
    });

    it("ends the shortest comments where they start, as a browser does", () => {
      expect(stripHtmlTags("a<!-->b")).toBe("ab");
      expect(stripHtmlTags("a<!--->b")).toBe("ab");
      expect(stripHtmlTags("a<!---->b")).toBe("ab");
    });
  });

  describe("a '<' that never closes", () => {
    it("drops the '<' on its own and keeps the text after it", () => {
      expect(stripHtmlTags("hello <script")).toBe("hello script");
      expect(stripHtmlTags("<b>bold</b> then <img src=x")).toBe(
        "bold then img src=x",
      );
      expect(stripHtmlTags("a < b")).toBe("a  b");
      expect(stripHtmlTags("<")).toBe("");
      expect(stripHtmlTags("<<<<")).toBe("");
    });

    it("keeps the text after a quoted value that never closes", () => {
      expect(stripHtmlTags('<a title="x>y')).toBe('a title="x>y');
      expect(stripHtmlTags("x<!-- never closed > here")).toBe(
        "x!-- never closed > here",
      );
    });
  });

  describe("text that one pass of a tag pattern would turn into a tag", () => {
    it.each([
      ["<<b>script>", "script>"],
      ["<scr<b>ipt>", "ipt>"],
      ["<scr<script>ipt>alert(1)</script>", "ipt>alert(1)"],
      ["<<script>script>alert(1)", "script>alert(1)"],
      ["<script<script>>alert(1)", ">alert(1)"],
      ["<p>x</p><script", "xscript"],
      ["<iframe src=x></iframe><style>", ""],
      ["<!-- <script> -->", ""],
      ["<!--<!-- -->-->", "-->"],
      ["<<!-- -->script>", "script>"],
    ])("reads %j as %j", (html: string, text: string) => {
      expect(stripHtmlTags(html)).toBe(text);
    });
  });

  describe("what it promises for any input", () => {
    const INPUTS: Array<string> = [
      "<scr<script>ipt>alert(1)</script>",
      "<<script>script>alert(1)",
      "<script<script>>alert(1)",
      "<p>x</p><script",
      "<<<<",
      "a < b <c",
      "<iframe src=x></iframe><style>",
      "<!-- <script> -->",
      '<a title="x>y',
      "<a title='>'<script>",
      '"><script>alert(1)</script>',
      "<<<b>>>",
      "<\n<\n>\n>",
      "<!-<!--->->",
      "<a b='c' d=\"e\" f=g h>i</a><",
      "Text only, with no markup at all.",
      "",
    ];

    it.each(INPUTS)("returns no '<' for %j", (html: string) => {
      expect(stripHtmlTags(html)).not.toContain("<");
    });

    it.each(INPUTS)("returns text a second pass leaves alone, for %j", (html: string) => {
      const once: string = stripHtmlTags(html);

      expect(stripHtmlTags(once)).toBe(once);
    });

    it("reads a long run of '<' with no '>' after it in one pass", () => {
      const started: number = Date.now();

      expect(stripHtmlTags("<".repeat(200000) + "x")).toBe("x");
      expect(stripHtmlTags('<a title="'.repeat(20000))).toBe(
        'a title="'.repeat(20000),
      );
      // Read twice over at most: well under a second, not minutes.
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it("reads a long page of tags quickly", () => {
      const started: number = Date.now();
      const html: string = "<p>a<b>b</b></p>\n".repeat(50000);

      expect(stripHtmlTags(html)).toBe("ab\n".repeat(50000));
      expect(Date.now() - started).toBeLessThan(2000);
    });
  });
});
