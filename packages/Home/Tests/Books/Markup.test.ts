import {
  childElements,
  CloseTagToken,
  decodeEntities,
  escapeHtml,
  findElements,
  findFirstElement,
  MarkupElement,
  MarkupNode,
  MarkupToken,
  normalizeWhitespace,
  OpenTagToken,
  parseMarkupTree,
  textContent,
  tokenizeMarkup,
} from "../../Utils/Books/Markup";

/*
 * The tokenizer underneath the book sanitizer and the EPUB package parser.
 * It must never assume well-formed input: whatever it cannot recognise as a
 * tag becomes text (which the sanitizer escapes) or is dropped.
 */

const REPLACEMENT: string = String.fromCodePoint(0xfffd);

const openTags: (tokens: Array<MarkupToken>) => Array<OpenTagToken> = (
  tokens: Array<MarkupToken>,
): Array<OpenTagToken> => {
  return tokens.filter((token: MarkupToken): token is OpenTagToken => {
    return token.type === "open";
  });
};

const texts: (tokens: Array<MarkupToken>) => Array<string> = (
  tokens: Array<MarkupToken>,
): Array<string> => {
  return tokens
    .filter((token: MarkupToken): boolean => {
      return token.type === "text";
    })
    .map((token: MarkupToken): string => {
      return token.type === "text" ? token.text : "";
    });
};

const elementNames: (node: MarkupElement) => Array<string> = (
  node: MarkupElement,
): Array<string> => {
  return childElements(node).map((child: MarkupElement): string => {
    return child.name;
  });
};

describe("decodeEntities", () => {
  test("decodes the XML entities", () => {
    expect(decodeEntities("&amp; &lt; &gt; &quot; &apos;")).toBe(`& < > " '`);
  });

  test("decodes the HTML named entities books use", () => {
    expect(decodeEntities("a&nbsp;b")).toBe(`a${String.fromCodePoint(0xa0)}b`);
    expect(decodeEntities("&mdash;&ndash;&middot;&hellip;")).toBe(
      String.fromCodePoint(0x2014, 0x2013, 0xb7, 0x2026),
    );
    expect(decodeEntities("&lsquo;&rsquo;&ldquo;&rdquo;")).toBe(
      String.fromCodePoint(0x2018, 0x2019, 0x201c, 0x201d),
    );
    expect(decodeEntities("&copy; &times; &rarr; &euro;")).toBe(
      String.fromCodePoint(0xa9, 0x20, 0xd7, 0x20, 0x2192, 0x20, 0x20ac),
    );
  });

  test("is case-sensitive for named entities", () => {
    expect(decodeEntities("&prime;&Prime;")).toBe(
      String.fromCodePoint(0x2032, 0x2033),
    );
    expect(decodeEntities("&AMP;")).toBe("&AMP;");
  });

  test("decodes decimal and hexadecimal character references", () => {
    expect(decodeEntities("&#65;&#x42;&#X43;&#x1F600;")).toBe(
      `ABC${String.fromCodePoint(0x1f600)}`,
    );
    expect(decodeEntities("&#183;")).toBe(String.fromCodePoint(0xb7));
    expect(decodeEntities("&#0065;")).toBe("A");
  });

  test("keeps tab, newline and carriage return references", () => {
    expect(decodeEntities("&#9;&#10;&#13;&#x9;")).toBe("\t\n\r\t");
  });

  test.each([
    ["NUL", "&#0;"],
    ["a C0 control", "&#1;"],
    ["escape", "&#x1B;"],
    ["a lone high surrogate", "&#xD800;"],
    ["a lone low surrogate", "&#56320;"],
    ["a code point above U+10FFFF", "&#x110000;"],
    ["a huge decimal", "&#9999999;"],
  ])("replaces %s with U+FFFD", (_description: string, reference: string) => {
    expect(decodeEntities(`[${reference}]`)).toBe(`[${REPLACEMENT}]`);
  });

  test("leaves unknown and malformed references as literal text", () => {
    expect(decodeEntities("&bogus;")).toBe("&bogus;");
    expect(decodeEntities("&nbsp")).toBe("&nbsp");
    expect(decodeEntities("& amp;")).toBe("& amp;");
    expect(decodeEntities("&#;&#x;&#xZZ;")).toBe("&#;&#x;&#xZZ;");
    expect(decodeEntities("&#99999999;")).toBe("&#99999999;");
    expect(decodeEntities("AT&T")).toBe("AT&T");
  });

  test("does not resolve entity names through the object prototype", () => {
    expect(decodeEntities("&constructor;&toString;&hasOwnProperty;")).toBe(
      "&constructor;&toString;&hasOwnProperty;",
    );
    expect(decodeEntities("&__proto__;")).toBe("&__proto__;");
  });

  test("decodes exactly once", () => {
    expect(decodeEntities("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
    expect(decodeEntities("&amp;#106;")).toBe("&#106;");
  });

  test("returns text without ampersands untouched", () => {
    const text: string = "Plain text, no references.";

    expect(decodeEntities(text)).toBe(text);
    expect(decodeEntities("")).toBe("");
  });
});

describe("escapeHtml", () => {
  test("escapes every character that is special in text or attributes", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  test("escapes ampersands first, so escaping twice is visible and not lossy", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    expect(decodeEntities(escapeHtml(`<"&'>`))).toBe(`<"&'>`);
  });

  test("leaves other characters alone", () => {
    const text: string = `Plain ${String.fromCodePoint(0xb7)} text / = \``;

    expect(escapeHtml(text)).toBe(text);
  });
});

describe("tokenizeMarkup", () => {
  test("produces text, open and close tokens in document order", () => {
    expect(tokenizeMarkup("<p>Hello <b>world</b></p>")).toEqual([
      {
        type: "open",
        name: "p",
        qualifiedName: "p",
        attributes: {},
        selfClosing: false,
      },
      { type: "text", text: "Hello " },
      {
        type: "open",
        name: "b",
        qualifiedName: "b",
        attributes: {},
        selfClosing: false,
      },
      { type: "text", text: "world" },
      { type: "close", name: "b", qualifiedName: "b" },
      { type: "close", name: "p", qualifiedName: "p" },
    ]);
  });

  test("returns no tokens for empty input", () => {
    expect(tokenizeMarkup("")).toEqual([]);
  });

  test("decodes entities in text", () => {
    expect(
      texts(tokenizeMarkup("<p>Tom &amp; Jerry &#183; &lt;3</p>")),
    ).toEqual([`Tom & Jerry ${String.fromCodePoint(0xb7)} <3`]);
  });

  test("reads double-quoted, single-quoted, unquoted and valueless attributes", () => {
    const [tag] = openTags(
      tokenizeMarkup(
        `<td colspan="2" scope='row' rowspan=3 nowrap data-x = "spaced">`,
      ),
    );

    expect(tag!.attributes).toEqual({
      colspan: "2",
      scope: "row",
      rowspan: "3",
      nowrap: "",
      "data-x": "spaced",
    });
  });

  test("lower-cases attribute names and keeps the first of duplicates", () => {
    const [tag] = openTags(
      tokenizeMarkup(`<a HREF="first" href="second" Class="c">x</a>`),
    );

    expect(tag!.attributes).toEqual({ href: "first", class: "c" });
  });

  test("decodes entities in attribute values", () => {
    const [tag] = openTags(
      tokenizeMarkup(
        `<a title="a&amp;b &quot;q&quot;" href="&#106;avascript:x">t</a>`,
      ),
    );

    expect(tag!.attributes["title"]).toBe(`a&b "q"`);
    expect(tag!.attributes["href"]).toBe("javascript:x");
  });

  test("does not end a tag at a '>' inside a quoted attribute value", () => {
    const tokens: Array<MarkupToken> = tokenizeMarkup(
      `<a title="a>b" data-y='c>d'>text</a>`,
    );

    expect(openTags(tokens)[0]!.attributes).toEqual({
      title: "a>b",
      "data-y": "c>d",
    });
    expect(texts(tokens)).toEqual(["text"]);
  });

  test("recognises self-closing tags with and without a space", () => {
    const tags: Array<OpenTagToken> = openTags(
      tokenizeMarkup(`<br/><br /><img src="a.jpg"/><hr>`),
    );

    expect(
      tags.map((tag: OpenTagToken): [string, boolean] => {
        return [tag.name, tag.selfClosing];
      }),
    ).toEqual([
      ["br", true],
      ["br", true],
      ["img", true],
      ["hr", false],
    ]);
    expect(tags[2]!.attributes).toEqual({ src: "a.jpg" });
  });

  test("keeps namespace prefixes in the qualified name and strips them from the name", () => {
    const tokens: Array<MarkupToken> = tokenizeMarkup(
      `<dc:Title>Back to Metal</dc:Title><nav epub:type="toc"></nav>`,
    );
    const [title, nav] = openTags(tokens);
    const close: CloseTagToken | undefined = tokens.find(
      (token: MarkupToken): token is CloseTagToken => {
        return token.type === "close";
      },
    );

    expect(title!.qualifiedName).toBe("dc:title");
    expect(title!.name).toBe("title");
    expect(close).toEqual({
      type: "close",
      name: "title",
      qualifiedName: "dc:title",
    });
    expect(nav!.attributes).toEqual({ "epub:type": "toc" });
  });

  test("lower-cases tag names", () => {
    const tokens: Array<MarkupToken> = tokenizeMarkup("<SCRIPT>x</ScRiPt>");

    expect(tokens[0]).toMatchObject({ type: "open", name: "script" });
    expect(tokens[2]).toMatchObject({ type: "close", name: "script" });
  });

  test("drops comments, doctypes, XML declarations and processing instructions", () => {
    expect(
      texts(
        tokenizeMarkup(
          `<?xml version="1.0"?><!DOCTYPE html><!-- note --><?php echo 1 ?>kept`,
        ),
      ),
    ).toEqual(["kept"]);
  });

  test("drops markup inside comments", () => {
    const tokens: Array<MarkupToken> = tokenizeMarkup(
      "a<!-- <script>alert(1)</script> -->b",
    );

    expect(openTags(tokens)).toEqual([]);
    expect(texts(tokens)).toEqual(["ab"]);
  });

  test("ends a comment at the first '-->'", () => {
    const tokens: Array<MarkupToken> = tokenizeMarkup(
      "<!-- a --> b --><p>c</p>",
    );

    expect(texts(tokens)).toEqual([" b -->", "c"]);
    expect(openTags(tokens)).toHaveLength(1);
  });

  test("drops everything after an unterminated comment", () => {
    expect(tokenizeMarkup("before<!-- never closed <p>x</p>")).toEqual([
      { type: "text", text: "before" },
    ]);
  });

  test("turns CDATA into literal text, entities and tags included", () => {
    const tokens: Array<MarkupToken> = tokenizeMarkup(
      "<p><![CDATA[a &lt; b <script>alert(1)</script>]]></p>",
    );

    expect(
      openTags(tokens).map((tag: OpenTagToken): string => {
        return tag.name;
      }),
    ).toEqual(["p"]);
    expect(texts(tokens)).toEqual(["a &lt; b <script>alert(1)</script>"]);
  });

  test("treats an unterminated CDATA section as text to the end", () => {
    expect(texts(tokenizeMarkup("x<![CDATA[<b>y"))).toEqual(["x<b>y"]);
  });

  test("keeps a '<' that does not start a tag as text", () => {
    expect(tokenizeMarkup("a < b, 1<2, <3 and < / >")).toEqual([
      { type: "text", text: "a < b, 1<2, <3 and < / >" },
    ]);
    expect(texts(tokenizeMarkup("x </ y"))).toEqual(["x </ y"]);
  });

  test("drops the rest of the input after an unterminated tag", () => {
    expect(tokenizeMarkup(`kept <p class="never closed`)).toEqual([
      { type: "text", text: "kept " },
    ]);
    expect(tokenizeMarkup("kept <a href='x>more text")).toEqual([
      { type: "text", text: "kept " },
    ]);
  });

  test("merges text around dropped constructs into one token", () => {
    expect(tokenizeMarkup("a<!--x-->b<?pi?>c")).toEqual([
      { type: "text", text: "abc" },
    ]);
  });

  test("tokenizes a real EPUB content document", () => {
    const tokens: Array<MarkupToken> = tokenizeMarkup(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<!DOCTYPE html>",
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">',
        '<head><meta charset="utf-8"/><title>The bill</title></head>',
        "<body><h1>01 &#183; The bill</h1></body></html>",
      ].join("\n"),
    );

    expect(
      openTags(tokens).map((tag: OpenTagToken): string => {
        return tag.qualifiedName;
      }),
    ).toEqual(["html", "head", "meta", "title", "body", "h1"]);
    expect(openTags(tokens)[0]!.attributes).toMatchObject({
      lang: "en",
      "xml:lang": "en",
      "xmlns:epub": "http://www.idpf.org/2007/ops",
    });
    expect(texts(tokens).join("")).toContain(
      `01 ${String.fromCodePoint(0xb7)} The bill`,
    );
  });
});

describe("parseMarkupTree", () => {
  test("builds nested elements with text children", () => {
    const root: MarkupElement = parseMarkupTree(
      "<ol><li><a href='a.xhtml'>A</a></li><li>B</li></ol>",
    );

    expect(root.name).toBe("#root");
    expect(elementNames(root)).toEqual(["ol"]);

    const list: MarkupElement = childElements(root, "ol")[0]!;

    expect(childElements(list, "li")).toHaveLength(2);
    expect(
      childElements(childElements(list, "li")[0]!, "a")[0]!.attributes,
    ).toEqual({ href: "a.xhtml" });
    expect(textContent(list)).toBe("AB");
  });

  test("keeps the text of an OPF <meta> in the default xml mode", () => {
    const root: MarkupElement = parseMarkupTree(
      '<metadata><meta property="dcterms:modified">2026-09-14T15:33:10Z</meta><dc:title>T</dc:title></metadata>',
    );
    const meta: MarkupElement | null = findFirstElement(
      root,
      (element: MarkupElement): boolean => {
        return element.name === "meta";
      },
    );

    expect(meta?.children).toEqual(["2026-09-14T15:33:10Z"]);
    expect(elementNames(childElements(root, "metadata")[0]!)).toEqual([
      "meta",
      "title",
    ]);
  });

  test("treats HTML void elements as childless in html mode", () => {
    const root: MarkupElement = parseMarkupTree(
      '<p>a<br>b<img src="x">c<meta property="p">d</meta></p>',
      "html",
    );
    const paragraph: MarkupElement = childElements(root, "p")[0]!;

    expect(elementNames(paragraph)).toEqual(["br", "img", "meta"]);
    expect(
      childElements(paragraph).every((child: MarkupElement): boolean => {
        return child.children.length === 0;
      }),
    ).toBe(true);
    expect(textContent(paragraph)).toBe("abcd");
  });

  test("nests after an unclosed <br> in xml mode, as XML requires a close", () => {
    const root: MarkupElement = parseMarkupTree("<p>a<br>b</p>c");
    const paragraph: MarkupElement = childElements(root, "p")[0]!;

    expect(childElements(paragraph, "br")[0]!.children).toEqual(["b"]);
    // Closing </p> still closes the paragraph and the br inside it.
    expect(root.children[1]).toBe("c");
  });

  test("respects self-closing tags in both modes", () => {
    for (const mode of ["xml", "html"] as const) {
      const root: MarkupElement = parseMarkupTree(
        '<item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/>',
        mode,
      );

      expect(elementNames(root)).toEqual(["item", "item"]);
    }
  });

  test("tolerates close tags that do not match anything open", () => {
    const root: MarkupElement = parseMarkupTree(
      "</div><a><b>x</a>y</b></zzz>z",
    );

    expect(elementNames(root)).toEqual(["a"]);
    expect(
      childElements(childElements(root, "a")[0]!, "b")[0]!.children,
    ).toEqual(["x"]);
    expect(root.children.slice(1)).toEqual(["y", "z"]);
  });

  test("closes by qualified name, so prefixes do not collide", () => {
    const root: MarkupElement = parseMarkupTree(
      "<dc:title>A<title>B</dc:title>C",
    );
    const title: MarkupElement = childElements(root)[0]!;

    expect(title.qualifiedName).toBe("dc:title");
    expect(textContent(title)).toBe("AB");
    expect(root.children[1]).toBe("C");
  });

  test("closes elements left open at the end of the input", () => {
    const root: MarkupElement = parseMarkupTree("<ol><li>one<li>two");

    expect(textContent(root)).toBe("onetwo");
    expect(elementNames(root)).toEqual(["ol"]);
  });
});

describe("tree helpers", () => {
  const root: MarkupElement = parseMarkupTree(
    [
      '<nav epub:type="toc"><h1>Contents</h1><ol>',
      '<li><a href="a.xhtml">  A\n  one </a><ol><li><a href="a.xhtml#x">A.1</a></li></ol></li>',
      "<li><span>B</span></li>",
      "</ol></nav>",
      '<nav epub:type="landmarks" hidden="hidden"><ol><li><a href="nav.xhtml">Landmark</a></li></ol></nav>',
    ].join(""),
  );

  test("findElements returns every match in document order, at any depth", () => {
    const links: Array<MarkupElement> = findElements(
      root,
      (element: MarkupElement): boolean => {
        return element.name === "a";
      },
    );

    expect(
      links.map((link: MarkupElement): string | undefined => {
        return link.attributes["href"];
      }),
    ).toEqual(["a.xhtml", "a.xhtml#x", "nav.xhtml"]);
  });

  test("findElements finds nothing when nothing matches", () => {
    expect(
      findElements(root, (element: MarkupElement): boolean => {
        return element.name === "table";
      }),
    ).toEqual([]);
  });

  test("findFirstElement returns the first match or null", () => {
    expect(
      findFirstElement(root, (element: MarkupElement): boolean => {
        return element.name === "nav";
      })?.attributes["epub:type"],
    ).toBe("toc");
    expect(
      findFirstElement(root, (element: MarkupElement): boolean => {
        return element.name === "video";
      }),
    ).toBeNull();
  });

  test("childElements returns direct element children, optionally by name", () => {
    const nav: MarkupElement = childElements(root, "nav")[0]!;

    expect(elementNames(nav)).toEqual(["h1", "ol"]);
    expect(childElements(nav, "ol")).toHaveLength(1);
    expect(childElements(nav, "li")).toEqual([]);
    expect(childElements(root, "nav")).toHaveLength(2);
  });

  test("textContent concatenates all descendant text", () => {
    const text: MarkupNode = "loose";

    expect(textContent(text)).toBe("loose");
    expect(textContent(childElements(root, "nav")[0]!)).toBe(
      "Contents  A\n  one A.1B",
    );
  });

  test("normalizeWhitespace collapses runs and trims", () => {
    expect(normalizeWhitespace("  A\n  one \t two  ")).toBe("A one two");
    expect(normalizeWhitespace("")).toBe("");
    expect(normalizeWhitespace(" \n\t ")).toBe("");
  });
});
