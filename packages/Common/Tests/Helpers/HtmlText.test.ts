import { removeHtmlMarkup } from "../../Types/HtmlMarkup";
import {
  decodeHtmlEntities,
  htmlAsText,
  markupAsSpaces,
  markupAsSpacesWithOutlookContent,
  telegramTextLength,
  visibleText,
} from "./HtmlText";
import { seededRandom } from "./SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * The readings the tests take rendered HTML in through (Tests/Helpers/
 * HtmlText). Each must read markup the way the walk does (removeHtmlMarkup):
 * whatever it is given, no "<" of any tag or comment is left in what it
 * returns, which the single passes the tests used to copy could not promise
 * - an unclosed "<script" stayed, a ">" in a quoted value or a comment ended
 * the markup early. TestTagStripGuard keeps those copies from coming back.
 */

const WHITESPACE_RUN: RegExp = /\s+/g;

// Words as a reader takes them in: whitespace runs as one space, ends trimmed.
const words: (text: string) => string = (text: string): string => {
  return text.replace(WHITESPACE_RUN, " ").trim();
};

// The pieces hostile markup is made of.
const PIECES: Array<string> = [
  "<",
  ">",
  "</",
  "<!--",
  "-->",
  "<!--[if mso]>",
  "<![endif]-->",
  "=",
  '"',
  "'",
  " ",
  "\n",
  "script",
  "style",
  "a",
  "b",
  "&",
  ";",
  "&lt;",
  "&amp;",
  "&#60;",
  "&#x3c;",
  "x",
];

// Texts of up to 40 pieces, from the same seed every run.
const hostileTexts: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  const random: () => number = seededRandom(20261011);
  const texts: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    const length: number = Math.floor(random() * 40);
    let text: string = "";

    for (let piece: number = 0; piece < length; piece++) {
      text += PIECES[Math.floor(random() * PIECES.length)]!;
    }

    texts.push(text);
  }

  return texts;
};

describe("markupAsSpaces", () => {
  test("puts a space where each tag and comment was, and keeps the text between them as it is", () => {
    expect(markupAsSpaces("<td>a</td><td>b</td>")).toBe(" a  b ");
    expect(markupAsSpaces("Hello <b>world</b>!")).toBe("Hello  world !");
    expect(markupAsSpaces("a<!-- note -->b")).toBe("a b");
    expect(markupAsSpaces("&lt;b&gt; &amp; &quot;")).toBe(
      "&lt;b&gt; &amp; &quot;",
    );
    expect(markupAsSpaces("no markup at all")).toBe("no markup at all");
  });

  test("reads the markup a single pass misread as markup, whole", () => {
    // A ">" inside a quoted value does not end the tag.
    expect(markupAsSpaces('<a title="x > y" href="/z">Go</a>')).toBe(" Go ");
    expect(markupAsSpaces('<img alt="a > b" src=x onerror=alert(1)>Text')).toBe(
      " Text",
    );
    // A comment ends at its "-->", not at the first ">" in it.
    expect(markupAsSpaces("<!-- a > b -->Text")).toBe(" Text");
    // An unclosed tag drops its "<" and keeps what follows it.
    expect(markupAsSpaces("a <script alert(1)")).toBe("a script alert(1)");
    // Pieces either side of a tag do not join into a new one.
    expect(markupAsSpaces("<scr<script>ipt>alert(1)")).toBe(" ipt>alert(1)");
  });

  test("hides an Outlook-only conditional comment, as every client but Outlook does", () => {
    expect(
      words(
        markupAsSpaces(
          "<!--[if mso]><v:roundrect><center>Open OneUptime</center></v:roundrect><![endif]--><p>Everyone</p>",
        ),
      ),
    ).toBe("Everyone");
  });
});

describe("markupAsSpacesWithOutlookContent", () => {
  test("reads what only Outlook shows as part of the email", () => {
    const email: string =
      '<!--[if mso]><v:roundrect arcsize="10%"><center>Open OneUptime</center></v:roundrect><![endif]--><p>Everyone</p>';

    expect(words(markupAsSpacesWithOutlookContent(email))).toBe(
      "Open OneUptime Everyone",
    );
    // The same email as every other client reads it.
    expect(words(markupAsSpaces(email))).toBe("Everyone");
  });

  test("keeps an Outlook setting's value, as the old readings did", () => {
    expect(
      words(
        markupAsSpacesWithOutlookContent(
          "<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->",
        ),
      ),
    ).toBe("96");
  });

  test("hides an ordinary comment, and shows what the other clients are given", () => {
    expect(words(markupAsSpacesWithOutlookContent("<!-- OneUptime -->"))).toBe(
      "",
    );
    // Downlevel-revealed: every client but Outlook shows what sits between.
    expect(
      words(
        markupAsSpacesWithOutlookContent(
          '<!--[if !mso]><!--><a href="x">Open</a><!--<![endif]-->',
        ),
      ),
    ).toBe("Open");
  });

  test("is markupAsSpaces for an email with no Outlook-only comment", () => {
    for (const html of [
      "<p>Hi <b>there</b></p>",
      "<!-- note --><td>a</td>",
      "a <script",
      '<a title="x > y">Go</a>',
    ]) {
      expect(markupAsSpacesWithOutlookContent(html)).toBe(markupAsSpaces(html));
    }
  });
});

describe("decodeHtmlEntities", () => {
  test("decodes the named references the renderers write", () => {
    expect(decodeHtmlEntities("&amp; &quot; &apos; &lt; &gt; &nbsp;")).toBe(
      "& \" ' < >  ",
    );
    expect(decodeHtmlEntities("&AMP; &Lt; &QUOT;")).toBe('& < "');
  });

  test("decodes decimal and hexadecimal references", () => {
    expect(decodeHtmlEntities("&#39; &#60; &#x27; &#X3C; &#x3D; &#x60;")).toBe(
      "' < ' < = `",
    );
    expect(decodeHtmlEntities("&#128512; &#x1F600;")).toBe("😀 😀");
  });

  test("decodes once, as a browser reads a text node", () => {
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
    expect(decodeHtmlEntities("&amp;#39;")).toBe("&#39;");
  });

  test("leaves what it does not know, and numbers that are no character, as written", () => {
    expect(decodeHtmlEntities("&copy; &middot; &hellip;")).toBe(
      "&copy; &middot; &hellip;",
    );
    expect(decodeHtmlEntities("&#1114112; &#x110000;")).toBe(
      "&#1114112; &#x110000;",
    );
    expect(decodeHtmlEntities("&#x10FFFF;")).toBe(
      String.fromCodePoint(0x10ffff),
    );
    expect(decodeHtmlEntities("AT&T & co; &; &#; &#x;")).toBe(
      "AT&T & co; &; &#; &#x;",
    );
  });
});

describe("htmlAsText", () => {
  test("takes the markup out first, so escaped text stays the text a person typed", () => {
    expect(htmlAsText("<p>&lt;b&gt;bold&lt;/b&gt; &amp; more</p>")).toBe(
      "<b>bold</b> & more",
    );
    expect(
      htmlAsText(
        '<a href="https://evil.example/login">Reset &quot;now&quot;</a>',
      ),
    ).toBe('Reset "now"');
    expect(htmlAsText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe(
      "<script>alert(1)</script>",
    );
  });

  test("keeps whitespace as it is", () => {
    expect(htmlAsText("line 1\n<br>\nline 2")).toBe("line 1\n\nline 2");
    expect(htmlAsText(" <b>a</b>  b ")).toBe(" a  b ");
  });

  test("reads hostile markup whole", () => {
    expect(htmlAsText('<img alt="a > b" src=x onerror=alert(1)>Text')).toBe(
      "Text",
    );
    expect(htmlAsText("a <script")).toBe("a script");
    expect(htmlAsText("<!-- a > b -->Text")).toBe("Text");
  });
});

describe("visibleText", () => {
  test("leaves out what <style> and <script> hold", () => {
    expect(
      visibleText(
        '<style>.a { color: red; }</style><p>Hi <b>there</b></p><script>var x = "<b>";</script>',
      ),
    ).toBe("Hi there");
    expect(
      visibleText('<STYLE type="text/css">p { margin: 0; }</STYLE><p>Hi</p>'),
    ).toBe("Hi");
  });

  test("ends a <style> or <script> at its end tag, read as a browser reads one", () => {
    for (const endTag of [
      "</script>",
      "</SCRIPT>",
      "</script >",
      '</script foo="bar">',
      "</script\t\n bar>",
    ]) {
      expect([endTag, visibleText(`<script>a < b${endTag}<p>Hi</p>`)]).toEqual([
        endTag,
        "Hi",
      ]);
    }
    // "</styles>" ends nothing; the real end tag does.
    expect(visibleText("<style>a</styles>b</style><p>Hi</p>")).toBe("Hi");
    // An element whose end tag never comes is read by the walk.
    expect(visibleText("<style>p { margin: 0; }<p>Hi</p>")).toBe(
      "p { margin: 0; } Hi",
    );
  });

  test("hides comments, Outlook-only ones too", () => {
    expect(
      visibleText(
        "<!-- layout --><!--[if mso]><p>Outlook only</p><![endif]--><p>Everyone</p>",
      ),
    ).toBe("Everyone");
  });

  test("keeps cells apart, decodes references, and reads whitespace as one space", () => {
    expect(visibleText("<table><tr><td>a</td><td>b</td></tr></table>")).toBe(
      "a b",
    );
    expect(visibleText("<p>A&nbsp;&amp;&nbsp;B &#x27;C&#x27;</p>")).toBe(
      "A & B 'C'",
    );
    expect(visibleText("  <p>\n  spaced \t out </p>  ")).toBe("spaced out");
  });
});

describe("telegramTextLength", () => {
  test("counts a tag as nothing and a character reference as one", () => {
    expect(telegramTextLength("<b>Incident</b>")).toBe("Incident".length);
    expect(telegramTextLength("&lt;log&gt;")).toBe("<log>".length);
    expect(telegramTextLength("&#39;")).toBe(1);
    // "&amp;amp;" is the text "&amp;".
    expect(telegramTextLength("&amp;amp;")).toBe(5);
    expect(
      telegramTextLength('<a href="https://x.example/?a=1&amp;b=2">link</a>'),
    ).toBe(4);
  });

  test("counts an emoji as two, as Telegram does, and plain text as its length", () => {
    expect(telegramTextLength("😀")).toBe(2);
    expect(telegramTextLength("plain text")).toBe(10);
    expect(telegramTextLength("")).toBe(0);
  });
});

describe("every reading, on hostile text", () => {
  const texts: Array<string> = hostileTexts(4000);

  test("leaves no < of any tag or comment", () => {
    for (const text of texts) {
      expect([text, removeHtmlMarkup(text).includes("<")]).toEqual([
        text,
        false,
      ]);
      expect([text, markupAsSpaces(text).includes("<")]).toEqual([text, false]);
      expect([
        text,
        markupAsSpacesWithOutlookContent(text).includes("<"),
      ]).toEqual([text, false]);

      // A "<" after decoding is one a reference wrote: none without an "&".
      if (!text.includes("&")) {
        expect([text, htmlAsText(text).includes("<")]).toEqual([text, false]);
        expect([text, visibleText(text).includes("<")]).toEqual([text, false]);
      }
    }
  });

  test("reads the same markup as removeHtmlMarkup, a space in place of each", () => {
    const withoutSpaces: (text: string) => string = (text: string): string => {
      return text.split(" ").join("");
    };

    for (const text of texts) {
      expect([text, withoutSpaces(markupAsSpaces(text))]).toEqual([
        text,
        withoutSpaces(removeHtmlMarkup(text)),
      ]);
    }
  });

  test("changes nothing when read again", () => {
    for (const text of texts) {
      const once: string = markupAsSpaces(text);

      expect([text, markupAsSpaces(once)]).toEqual([text, once]);
    }
  });

  test("never counts a message longer than it is written", () => {
    for (const text of texts) {
      expect([text, telegramTextLength(text) <= text.length]).toEqual([
        text,
        true,
      ]);
    }
  });

  test("reads a long hostile text in time that grows with its length", () => {
    const hostile: Array<string> = [
      '<a title="'.repeat(40000),
      "<".repeat(200000),
      "<!--[if mso]>".repeat(20000) + "<![endif]-->",
      "<!--".repeat(50000),
      '<a b="x>'.repeat(30000),
    ];
    const started: number = Date.now();

    for (const html of hostile) {
      expect(markupAsSpaces(html).includes("<")).toBe(false);
      expect(markupAsSpacesWithOutlookContent(html).includes("<")).toBe(false);
      expect(visibleText(html).includes("<")).toBe(false);
      telegramTextLength(html);
    }

    // Quadratic reading of these would take minutes.
    expect(Date.now() - started).toBeLessThan(20000);
  });
});
