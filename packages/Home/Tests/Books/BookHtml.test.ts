import { JSDOM } from "jsdom";
import {
  bookAnchorId,
  BookHtmlOptions,
  InternalBookLink,
  isValidSectionId,
  resolveBookLink,
  ResolvedBookLink,
  safeExternalHref,
  sanitizeBookHtml,
} from "../../Utils/Books/BookHtml";
import { defaultBookItems, EpubItem } from "./Helpers/EpubFixture";

/*
 * sanitizeBookHtml is the security boundary of the in-page reader: the book's
 * EPUB is fetched from another origin at runtime and its sanitized HTML is
 * inserted with innerHTML on oneuptime.com. Every output here is checked two
 * ways: as a string (only allow-listed tags in a strict shape, every tag
 * balanced, every "&" an escape the sanitizer wrote) and as a DOM, by parsing
 * it with jsdom the way a browser would and checking every element,
 * attribute and link that comes out.
 */

const SECTION: string = "m01";

const ALLOWED_TAGS: Set<string> = new Set<string>([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "dd",
  "del",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "var",
]);

const VOID_TAGS: Set<string> = new Set<string>(["br", "hr"]);

const ALLOWED_ATTRIBUTES: Set<string> = new Set<string>([
  "class",
  "id",
  "lang",
  "href",
  "rel",
  "target",
  "data-book-section",
  "data-book-anchor",
  "colspan",
  "rowspan",
  "scope",
  "start",
  "reversed",
  "value",
  "title",
]);

const STRICT_TAG_PATTERN: RegExp =
  /^<(\/?)([a-z][a-z0-9]*)((?: [a-z][a-z-]*="[^"<>]*")*)>/;
const ESCAPE_PATTERN: RegExp = /^&(?:amp|lt|gt|quot|#39);/;
const READ_HREF_PATTERN: RegExp = /^#read\/[a-z0-9][a-z0-9-]{0,63}$/;
const BK_TOKEN_PATTERN: RegExp = /^bk-[a-z0-9_-]+$/;
const BK_ID_PATTERN: RegExp = /^bk-[a-z0-9][a-z0-9-]*--[A-Za-z][A-Za-z0-9_-]*$/;
const DANGEROUS_TEXT_PATTERN: RegExp = /<\s*\/?\s*(script|iframe|img|svg)/i;

const dom: JSDOM = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const documentForParsing: Document = dom.window.document;

afterAll(() => {
  dom.window.close();
});

const parse: (html: string) => HTMLElement = (html: string): HTMLElement => {
  const container: HTMLElement = documentForParsing.createElement("div");
  container.innerHTML = html;
  return container;
};

const RESOLVER: (href: string) => InternalBookLink | null = (
  href: string,
): InternalBookLink | null => {
  const hash: number = href.indexOf("#");
  const file: string = hash < 0 ? href : href.slice(0, hash);
  const fragment: string = hash < 0 ? "" : href.slice(hash + 1);
  const sections: Record<string, string> = {
    "../rollback.xhtml": "rollback",
    "02.xhtml": "m02",
    "../worksheets.xhtml": "worksheets",
    "../m/01.xhtml": "m01",
    "bad-id.xhtml": "Not A Valid Id",
  };
  const sectionId: string | undefined = Object.prototype.hasOwnProperty.call(
    sections,
    file,
  )
    ? sections[file]
    : undefined;

  return sectionId
    ? { kind: "internal", sectionId, fragment: fragment || undefined }
    : null;
};

const sanitize: (markup: string, withResolver?: boolean) => string = (
  markup: string,
  withResolver: boolean = true,
): string => {
  const options: BookHtmlOptions = withResolver
    ? { sectionId: SECTION, resolveRelativeLink: RESOLVER }
    : { sectionId: SECTION };

  return sanitizeBookHtml(markup, options);
};

/*
 * Every way the output could be unsafe or malformed. Returns a list of
 * problems, so a failing fuzz case prints its input next to what went wrong.
 */
const safetyViolations: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const violations: Array<string> = [];
  const stack: Array<string> = [];
  let index: number = 0;

  // String level: strict tags, balanced, and nothing unescaped between them.
  while (index < html.length) {
    const character: string = html[index]!;

    if (character === "<") {
      const match: RegExpExecArray | null = STRICT_TAG_PATTERN.exec(
        html.slice(index),
      );

      if (!match) {
        violations.push(
          `malformed tag at ${index}: ${html.slice(index, index + 40)}`,
        );
        break;
      }

      const isClose: boolean = match[1] === "/";
      const name: string = match[2]!;

      if (!ALLOWED_TAGS.has(name)) {
        violations.push(`tag <${name}> is not allowed`);
      }

      if (isClose) {
        if (match[3]) {
          violations.push(`close tag </${name}> has attributes`);
        }

        if (stack.pop() !== name) {
          violations.push(`unbalanced </${name}>`);
        }
      } else if (!VOID_TAGS.has(name)) {
        stack.push(name);
      }

      index += match[0].length;
      continue;
    }

    if (
      character === "&" &&
      !ESCAPE_PATTERN.test(html.slice(index, index + 6))
    ) {
      violations.push(`bare ampersand at ${index}`);
    }

    if (character === ">" || character === '"' || character === "'") {
      violations.push(`unescaped ${character} at ${index}`);
    }

    index++;
  }

  if (stack.length > 0) {
    violations.push(`unclosed ${stack.join(",")}`);
  }

  // DOM level: parse the output as a browser would and inspect what came out.
  const container: HTMLElement = parse(html);

  for (const element of Array.from(container.querySelectorAll("*"))) {
    const name: string = element.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(name)) {
      violations.push(`DOM element <${name}>`);
    }

    for (const attribute of Array.from(element.attributes)) {
      const value: string = attribute.value;

      if (!ALLOWED_ATTRIBUTES.has(attribute.name)) {
        violations.push(`DOM attribute ${attribute.name} on <${name}>`);
      }

      if (attribute.name === "href") {
        let external: boolean = false;

        try {
          const url: URL = new URL(value);
          external = ["http:", "https:", "mailto:"].includes(url.protocol);
        } catch {
          external = false;
        }

        if (!READ_HREF_PATTERN.test(value) && !external) {
          violations.push(`href ${value}`);
        }
      }

      if (attribute.name === "data-book-section" && !isValidSectionId(value)) {
        violations.push(`data-book-section ${value}`);
      }

      if (
        (attribute.name === "data-book-anchor" || attribute.name === "id") &&
        !BK_ID_PATTERN.test(value)
      ) {
        violations.push(`${attribute.name} ${value}`);
      }

      if (attribute.name === "class") {
        for (const token of value.split(" ")) {
          if (!BK_TOKEN_PATTERN.test(token)) {
            violations.push(`class ${token}`);
          }
        }
      }

      if (attribute.name === "target" && value !== "_blank") {
        violations.push(`target ${value}`);
      }

      if (attribute.name === "rel" && value !== "noopener noreferrer") {
        violations.push(`rel ${value}`);
      }
    }

    if (name === "a" && element.getAttribute("target") === "_blank") {
      if (element.getAttribute("rel") !== "noopener noreferrer") {
        violations.push("external link without rel=noopener");
      }
    }
  }

  return violations;
};

const expectSafe: (html: string) => void = (html: string): void => {
  expect({ html, violations: safetyViolations(html) }).toEqual({
    html,
    violations: [],
  });
};

const stringTagSequence: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return Array.from(
    html.matchAll(/<(\/?)([a-z][a-z0-9]*)[^>]*>/g),
    (match: RegExpMatchArray): string => {
      return `${match[1]}${match[2]}`;
    },
  );
};

const domTagSequence: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  const sequence: Array<string> = [];

  for (const child of Array.from(element.children)) {
    const name: string = child.tagName.toLowerCase();
    sequence.push(name, ...domTagSequence(child));

    if (!VOID_TAGS.has(name)) {
      sequence.push(`/${name}`);
    }
  }

  return sequence;
};

// A browser parses the output into exactly the structure the string describes.
const expectRoundTrip: (html: string) => void = (html: string): void => {
  const container: HTMLElement = parse(html);

  expect(domTagSequence(container)).toEqual(stringTagSequence(html));
  expect(parse(container.innerHTML).innerHTML).toBe(container.innerHTML);
};

const MIDDOT: string = String.fromCodePoint(0xb7);
const EM_DASH: string = String.fromCodePoint(0x2014);
const NUL: string = String.fromCharCode(0);

describe("the safety checker used by these tests", () => {
  test.each([
    ["an event handler", '<p onclick="alert(1)">x</p>'],
    ["a script element", "<script>alert(1)</script>"],
    ["an unquoted attribute", "<p class=bk-x>x</p>"],
    ["a javascript: link", '<a href="javascript:alert(1)">x</a>'],
    ["a protocol-relative link", '<a href="//evil.example/">x</a>'],
    ["a class outside the bk- namespace", '<p class="hidden">x</p>'],
    ["an id outside the bk- namespace", '<p id="main-content">x</p>'],
    [
      "an invalid data-book-section",
      '<a href="#read/m01" data-book-section="M 01">x</a>',
    ],
    ["a bare ampersand", "<p>a & b</p>"],
    ["a raw quote in text", '<p>"</p>'],
    ["an unbalanced close", "<p><b>x</p></b>"],
    ["an unclosed element", "<div>x"],
    [
      "a new tab without rel",
      '<a href="https://x.example/" target="_blank">x</a>',
    ],
  ])("rejects %s", (_name: string, html: string) => {
    expect(safetyViolations(html).length).toBeGreaterThan(0);
  });

  test("accepts what the sanitizer writes", () => {
    expect(
      safetyViolations(
        '<p class="bk-hook" id="bk-m01--x">a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;<br><a href="#read/m02" data-book-section="m02">m</a> <a href="https://x.example/" rel="noopener noreferrer" target="_blank">x</a></p>',
      ),
    ).toEqual([]);
  });
});

describe("isValidSectionId", () => {
  test.each([
    "m01",
    "why",
    "contents",
    "worksheets",
    "a",
    "0",
    "a-b-c",
    "x".repeat(64),
  ])("accepts %j", (id: string) => {
    expect(isValidSectionId(id)).toBe(true);
  });

  test.each([
    "",
    "-m01",
    "M01",
    "m_01",
    "m 01",
    "m01/",
    "../m01",
    "x".repeat(65),
    "m01\n",
    "javascript:alert(1)",
  ])("rejects %j", (id: string) => {
    expect(isValidSectionId(id)).toBe(false);
  });
});

describe("bookAnchorId", () => {
  test("namespaces an element id by its section", () => {
    expect(bookAnchorId("worksheets", "restore-proof")).toBe(
      "bk-worksheets--restore-proof",
    );
  });

  test("replaces dots and colons, which are awkward in CSS selectors", () => {
    expect(bookAnchorId("m01", "ok.id:1")).toBe("bk-m01--ok-id-1");
  });

  test("trims surrounding whitespace", () => {
    expect(bookAnchorId("m01", "  note ")).toBe("bk-m01--note");
  });

  test.each([
    "",
    "1starts-with-digit",
    "has space",
    "-dash",
    "a/b",
    "x".repeat(81),
    'q"uote',
  ])("refuses the id %j", (id: string) => {
    expect(bookAnchorId("m01", id)).toBeNull();
  });

  test("refuses an invalid section id", () => {
    expect(bookAnchorId("Bad Section", "note")).toBeNull();
    expect(bookAnchorId("", "note")).toBeNull();
  });
});

describe("safeExternalHref", () => {
  test.each([
    ["https://example.com/a?b=1#c", "https://example.com/a?b=1#c"],
    ["http://example.com", "http://example.com/"],
    ["HTTPS://Example.COM/Path", "https://example.com/Path"],
    ["  https://example.com/x  ", "https://example.com/x"],
    ["https://example.com/a b", "https://example.com/a%20b"],
    ["mailto:books@example.com", "mailto:books@example.com"],
  ])("normalizes %j to %j", (input: string, expected: string) => {
    expect(safeExternalHref(input)).toBe(expected);
  });

  test.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/",
    "blob:https://example.com/0000",
    "http://",
    "//example.com/",
    "/relative",
    "",
  ])("refuses %j", (input: string) => {
    expect(safeExternalHref(input)).toBeNull();
  });
});

describe("resolveBookLink", () => {
  const options: BookHtmlOptions = {
    sectionId: SECTION,
    resolveRelativeLink: RESOLVER,
  };

  test("resolves a fragment to the same section", () => {
    expect(resolveBookLink("#local-note", options)).toEqual({
      kind: "internal",
      sectionId: SECTION,
      fragment: "local-note",
    });
  });

  test("resolves a bare '#' to the top of the same section", () => {
    expect(resolveBookLink("#", options)).toEqual({
      kind: "internal",
      sectionId: SECTION,
      fragment: undefined,
    });
  });

  test("resolves external http, https and mailto links", () => {
    expect(resolveBookLink("https://example.com/x", options)).toEqual({
      kind: "external",
      href: "https://example.com/x",
    });
    expect(resolveBookLink("http://example.com", options)).toEqual({
      kind: "external",
      href: "http://example.com/",
    });
    expect(resolveBookLink("mailto:a@example.com", options)).toEqual({
      kind: "external",
      href: "mailto:a@example.com",
    });
  });

  test("resolves relative links through the book", () => {
    expect(resolveBookLink("../rollback.xhtml", options)).toEqual({
      kind: "internal",
      sectionId: "rollback",
      fragment: undefined,
    });
    expect(
      resolveBookLink(" ../worksheets.xhtml#restore-proof ", options),
    ).toEqual({
      kind: "internal",
      sectionId: "worksheets",
      fragment: "restore-proof",
    });
  });

  test.each([
    "",
    "   ",
    "//evil.example/x",
    "javascript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,x",
    "unknown.xhtml",
    "img/cover.jpg",
  ])("drops %j", (href: string) => {
    expect(resolveBookLink(href, options)).toBeNull();
  });

  test("drops relative links when there is no resolver", () => {
    expect(
      resolveBookLink("../rollback.xhtml", { sectionId: SECTION }),
    ).toBeNull();
  });

  test("never hands a scheme link to the relative resolver", () => {
    const seen: Array<string> = [];
    const spying: BookHtmlOptions = {
      sectionId: SECTION,
      resolveRelativeLink: (href: string): InternalBookLink | null => {
        seen.push(href);
        return { kind: "internal", sectionId: "m02" };
      },
    };
    const results: Array<ResolvedBookLink | null> = [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:x",
      "//evil",
    ].map((href: string): ResolvedBookLink | null => {
      return resolveBookLink(href, spying);
    });

    expect(results).toEqual([null, null, null, null]);
    expect(seen).toEqual([]);
  });
});

describe("sanitizeBookHtml: book structure", () => {
  test("keeps the structural text elements of a Move, namespacing its classes", () => {
    const html: string = sanitize(
      [
        "<h1>01 &#183; The bill</h1>",
        '<p class="meta">Decide &#183; Low risk</p>',
        '<p class="hook">The invoice records <em>what you were charged</em>.</p>',
        "<h2>Leaving from</h2>",
        "<ul><li><strong>AWS:</strong> Cost Explorer &#8212; hourly.</li></ul>",
        "<ol><li>Export with <code>aws ce</code>.</li></ol>",
        '<div class="rollback"><h3>Rollback</h3><p>Back out.</p></div>',
        "<dl><dt>Swap</dt><dd>Start there.</dd></dl>",
        '<table><thead><tr><th scope="col">Was</th></tr></thead><tbody><tr><td>$1</td></tr></tbody></table>',
        "<blockquote><p>Quoted <q>inline</q>.</p></blockquote>",
        "<pre><code>kubectl get nodes</code></pre>",
      ].join("\n"),
    );

    expect(html).toBe(
      [
        `<h1>01 ${MIDDOT} The bill</h1>`,
        `<p class="bk-meta">Decide ${MIDDOT} Low risk</p>`,
        '<p class="bk-hook">The invoice records <em>what you were charged</em>.</p>',
        "<h2>Leaving from</h2>",
        `<ul><li><strong>AWS:</strong> Cost Explorer ${EM_DASH} hourly.</li></ul>`,
        "<ol><li>Export with <code>aws ce</code>.</li></ol>",
        '<div class="bk-rollback"><h3>Rollback</h3><p>Back out.</p></div>',
        "<dl><dt>Swap</dt><dd>Start there.</dd></dl>",
        '<table><thead><tr><th scope="col">Was</th></tr></thead><tbody><tr><td>$1</td></tr></tbody></table>',
        "<blockquote><p>Quoted <q>inline</q>.</p></blockquote>",
        "<pre><code>kubectl get nodes</code></pre>",
      ].join("\n"),
    );
    expectSafe(html);
    expectRoundTrip(html);
  });

  test("keeps every allow-listed element", () => {
    const names: Array<string> = Array.from(ALLOWED_TAGS).filter(
      (name: string): boolean => {
        return !VOID_TAGS.has(name) && name !== "a";
      },
    );

    for (const name of names) {
      expect(sanitize(`<${name}>x</${name}>`)).toBe(`<${name}>x</${name}>`);
    }
  });

  test("returns only the body of a whole XHTML document", () => {
    const html: string = sanitize(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<!DOCTYPE html>",
        '<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">',
        '<head><meta charset="utf-8"/><title>The bill</title><link rel="stylesheet" href="../style.css"/><style>body{}</style></head>',
        "<body><h1>Hello</h1></body>",
        "</html>",
      ].join("\n"),
    );

    expect(html).toBe("<h1>Hello</h1>");
  });

  test("trims leading and trailing whitespace", () => {
    expect(sanitize("\n\n  <p>x</p>  \n")).toBe("<p>x</p>");
    expect(sanitize("")).toBe("");
    expect(sanitize("   ")).toBe("");
  });

  test("escapes text, including characters the book wrote as entities", () => {
    const html: string = sanitize(
      `<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "q" 's' > <</p>`,
    );

    expect(html).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;s&#39; &gt; &lt;</p>",
    );
    expectSafe(html);
    expect(parse(html).textContent).toBe(
      `<script>alert(1)</script> & "q" 's' > <`,
    );
    expect(parse(html).querySelector("script")).toBeNull();
  });

  test("writes br and hr as void elements and drops stray close tags", () => {
    expect(sanitize('<br/><br><hr class="rule"><br onclick="x"></br>')).toBe(
      '<br><br><hr class="bk-rule"><br>',
    );
  });

  test("unwraps unknown elements and keeps their content", () => {
    expect(
      sanitize(
        '<font color="red"><center><x-foo>kept</x-foo></center></font><nav><p>navigation</p></nav>',
      ),
    ).toBe("kept<p>navigation</p>");
    expect(sanitize("<epub:switch><p>x</p></epub:switch>")).toBe("<p>x</p>");
  });

  test("removes elements with the hidden attribute, content included", () => {
    expect(sanitize("<p hidden>secret</p>shown")).toBe("shown");
    expect(
      sanitize(
        '<nav HIDDEN="hidden"><ol><li><a href="#x">Landmark</a></li></ol></nav>after',
      ),
    ).toBe("after");
    expect(sanitize('<div hidden=""><div><p>nested</p></div></div>after')).toBe(
      "after",
    );
  });
});

describe("sanitizeBookHtml: class names and ids", () => {
  test("prefixes class names with bk- and lower-cases them", () => {
    expect(sanitize('<p class="Hook  meta">x</p>')).toBe(
      '<p class="bk-hook bk-meta">x</p>',
    );
  });

  test("drops class tokens that are not plain identifiers, and duplicates", () => {
    expect(
      sanitize(`<p class="1bad ok-1 _x Ok ok a:b a.b 'q' &lt;x&gt;">x</p>`),
    ).toBe('<p class="bk-ok-1 bk-ok">x</p>');
    expect(sanitize('<p class="   ">x</p>')).toBe("<p>x</p>");
  });

  test("keeps at most eight classes", () => {
    expect(sanitize('<p class="a b c d e f g h i j">x</p>')).toBe(
      '<p class="bk-a bk-b bk-c bk-d bk-e bk-f bk-g bk-h">x</p>',
    );
  });

  test("namespaces ids by section, and drops ids that are not identifiers", () => {
    expect(
      sanitize('<section id="restore-proof"><p id="ok.id:1">x</p></section>'),
    ).toBe(
      '<section id="bk-m01--restore-proof"><p id="bk-m01--ok-id-1">x</p></section>',
    );
    expect(sanitize('<p id="has space">x</p><p id="1digit">y</p>')).toBe(
      "<p>x</p><p>y</p>",
    );
  });

  test("cannot produce an id or class that collides with the page's own", () => {
    const html: string = sanitize(
      '<div id="main-content" class="hidden sr-only books-page"><p id="book-reader">x</p></div>',
    );
    const container: HTMLElement = parse(html);

    expect(container.querySelector("#main-content")).toBeNull();
    expect(container.querySelector("#book-reader")).toBeNull();
    expect(
      container.querySelector(".hidden, .sr-only, .books-page"),
    ).toBeNull();
    expect(html).toBe(
      '<div class="bk-hidden bk-sr-only bk-books-page" id="bk-m01--main-content"><p id="bk-m01--book-reader">x</p></div>',
    );
  });
});

describe("sanitizeBookHtml: links", () => {
  test("rewrites links to other chapters into reader links", () => {
    expect(
      sanitize('<a href="../rollback.xhtml">Before you touch anything</a>'),
    ).toBe(
      '<a href="#read/rollback" data-book-section="rollback">Before you touch anything</a>',
    );
    expect(sanitize('<a href="02.xhtml">Move 02</a>')).toBe(
      '<a href="#read/m02" data-book-section="m02">Move 02</a>',
    );
  });

  test("carries a fragment as the namespaced anchor it points at", () => {
    expect(
      sanitize('<a href="../worksheets.xhtml#restore-proof">Restore proof</a>'),
    ).toBe(
      '<a href="#read/worksheets" data-book-section="worksheets" data-book-anchor="bk-worksheets--restore-proof">Restore proof</a>',
    );
    expect(
      sanitize('<a href="#local-note">below</a><p id="local-note">n</p>'),
    ).toBe(
      '<a href="#read/m01" data-book-section="m01" data-book-anchor="bk-m01--local-note">below</a><p id="bk-m01--local-note">n</p>',
    );
  });

  test("links to the top of the section for a bare '#' or an invalid fragment", () => {
    expect(sanitize('<a href="#">top</a>')).toBe(
      '<a href="#read/m01" data-book-section="m01">top</a>',
    );
    expect(sanitize('<a href="#1-not-an-id">x</a>')).toBe(
      '<a href="#read/m01" data-book-section="m01">x</a>',
    );
  });

  test("opens external links in a new tab without an opener", () => {
    expect(
      sanitize(
        '<a href="https://github.com/OneUptime/back-to-metal" target="_self" rel="opener">source</a>',
      ),
    ).toBe(
      '<a href="https://github.com/OneUptime/back-to-metal" rel="noopener noreferrer" target="_blank">source</a>',
    );
    expect(sanitize('<a href="mailto:books@example.com">mail</a>')).toBe(
      '<a href="mailto:books@example.com" rel="noopener noreferrer" target="_blank">mail</a>',
    );
  });

  test("re-encodes external URLs rather than copying them", () => {
    const html: string = sanitize(
      '<a href="https://ok.example/a?b=1&amp;c=&quot;2&quot;&gt;">x</a>',
    );

    expect(html).toBe(
      '<a href="https://ok.example/a?b=1&amp;c=%222%22%3E" rel="noopener noreferrer" target="_blank">x</a>',
    );
    expectSafe(html);
  });

  test("turns a link that goes nowhere safe into a span, keeping its text", () => {
    expect(sanitize("<a>no href</a>")).toBe("<span>no href</span>");
    expect(sanitize('<a href="">empty</a>')).toBe("<span>empty</span>");
    expect(sanitize('<a href="unknown.xhtml">unknown</a>')).toBe(
      "<span>unknown</span>",
    );
    expect(sanitize('<a href="../rollback.xhtml">no resolver</a>', false)).toBe(
      "<span>no resolver</span>",
    );
    expect(sanitize('<a href="bad-id.xhtml">bad id</a>')).toBe(
      "<span>bad id</span>",
    );
    expect(
      sanitize('<a href="javascript:alert(1)"><b>bold</b> text</a> after'),
    ).toBe("<span><b>bold</b> text</span> after");
  });

  test("ignores reader data attributes the book tries to set itself", () => {
    expect(
      sanitize(
        '<p data-book-section="m05" data-book-anchor="x">p</p><a href="https://x.example/" data-book-section="m05">a</a>',
      ),
    ).toBe(
      '<p>p</p><a href="https://x.example/" rel="noopener noreferrer" target="_blank">a</a>',
    );
  });
});

describe("sanitizeBookHtml: attributes", () => {
  test("keeps only whole-number colspan, rowspan, start and value", () => {
    expect(
      sanitize(
        '<table><tr><td colspan="2x" rowspan="3">a</td><td colspan=" 007 " rowspan="10000">b</td></tr></table><ol start="-1"><li value="4">c</li></ol><ol start=" 7 "><li value="1.5">d</li></ol>',
      ),
    ).toBe(
      '<table><tr><td rowspan="3">a</td><td colspan="7">b</td></tr></table><ol><li value="4">c</li></ol><ol start="7"><li>d</li></ol>',
    );
  });

  test("keeps only the four valid th scopes", () => {
    expect(
      sanitize(
        '<th scope="row">a</th><th scope="col">b</th><th scope="rowgroup">c</th><th scope="colgroup">d</th><th scope="bogus">e</th><th scope="row onclick=x">f</th>',
      ),
    ).toBe(
      '<th scope="row">a</th><th scope="col">b</th><th scope="rowgroup">c</th><th scope="colgroup">d</th><th>e</th><th>f</th>',
    );
  });

  test("normalizes reversed to a boolean attribute", () => {
    expect(sanitize('<ol reversed="no">x</ol><ol reversed>y</ol>')).toBe(
      '<ol reversed="reversed">x</ol><ol reversed="reversed">y</ol>',
    );
  });

  test("keeps valid language tags from lang or xml:lang", () => {
    expect(
      sanitize(
        '<p lang="en-GB">a</p><p xml:lang="fr">b</p><p lang="de" xml:lang="fr">c</p><p lang="javascript:1">d</p><p lang="e">e</p><p lang="zh-Hant-TW">f</p>',
      ),
    ).toBe(
      '<p lang="en-GB">a</p><p lang="fr">b</p><p lang="de">c</p><p>d</p><p>e</p><p lang="zh-Hant-TW">f</p>',
    );
  });

  test("keeps an abbr title, capped at 200 characters", () => {
    const html: string = sanitize(`<abbr title="${"x".repeat(300)}">A</abbr>`);
    const title: string | null = parse(html)
      .querySelector("abbr")!
      .getAttribute("title");

    expect(title).toBe("x".repeat(200));
    expect(sanitize('<abbr title="Content Delivery Network">CDN</abbr>')).toBe(
      '<abbr title="Content Delivery Network">CDN</abbr>',
    );
  });

  test("keeps element-specific attributes only on their own elements", () => {
    expect(
      sanitize(
        '<p title="t" colspan="2" start="3" scope="row" href="https://x.example/">p</p><a title="t" href="#x">a</a>',
      ),
    ).toBe(
      '<p>p</p><a href="#read/m01" data-book-section="m01" data-book-anchor="bk-m01--x">a</a>',
    );
  });

  test("escapes quotes and angle brackets inside attribute values", () => {
    const html: string = sanitize(
      `<abbr title='"><script>alert(1)</script><x y="'>A</abbr>`,
    );

    expect(html).toBe(
      '<abbr title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;x y=&quot;">A</abbr>',
    );
    expectSafe(html);
    expect(parse(html).querySelector("script")).toBeNull();
  });
});

describe("sanitizeBookHtml: hostile markup", () => {
  test.each([
    ["script", "<script>alert(1)</script><p>ok</p>", "<p>ok</p>"],
    ["external script", '<SCRIPT SRC="//evil.example/x.js"></SCRIPT>ok', "ok"],
    [
      "script with markup inside",
      '<script>if (a < b) { document.write("<p>x</p>") }</script>ok',
      "ok",
    ],
    [
      "style",
      "<style>body{background:url(javascript:alert(1))}</style>ok",
      "ok",
    ],
    ["iframe", '<iframe src="javascript:alert(1)"></iframe>ok', "ok"],
    ["unclosed iframe", '<iframe srcdoc="<script>alert(1)</script>">ok', ""],
    [
      "object and param",
      '<object data="x.swf"><param name="a" value="b"></object>ok',
      "ok",
    ],
    ["embed", '<embed src="x.swf">ok', "ok"],
    ["svg onload", '<svg onload="alert(1)"><circle r="1"/></svg>ok', "ok"],
    [
      "script in svg",
      "<svg><script>alert(1)</script></svg><p>after</p>",
      "<p>after</p>",
    ],
    ["namespaced script", "<svg:script>alert(1)</svg:script>ok", "ok"],
    [
      "math",
      '<math><mi xlink:href="javascript:alert(1)">x</mi></math>ok',
      "ok",
    ],
    [
      "img without a slash",
      "<p>a<img src=x onerror=alert(1)>b</p><p>after</p>",
      "<p>ab</p><p>after</p>",
    ],
    ["img with a slash", '<img src="x" onerror="alert(1)"/>after', "after"],
    [
      "upper-case img",
      "<IMG SRC=x ONERROR=alert(1)><P CLASS=A>up</P>",
      '<p class="bk-a">up</p>',
    ],
    [
      "picture and source",
      '<picture><source srcset="x"><img src="x"></picture>ok',
      "ok",
    ],
    [
      "video and source",
      "<video><source src=x onerror=alert(1)></video>ok",
      "ok",
    ],
    ["audio", '<audio src="x" onerror="alert(1)"></audio>ok', "ok"],
    [
      "event handlers",
      '<p onclick="alert(1)" ONMOUSEOVER="alert(2)" onFocus=x>t</p>',
      "<p>t</p>",
    ],
    [
      "style attribute",
      '<p style="background:url(javascript:alert(1))">t</p>',
      "<p>t</p>",
    ],
    ["base", '<base href="https://evil.example/">ok', "ok"],
    [
      "meta refresh",
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">ok',
      "ok",
    ],
    [
      "stylesheet link",
      '<link rel="stylesheet" href="https://evil.example/x.css">ok',
      "ok",
    ],
    [
      "form controls",
      '<form action="https://evil.example"><input name="p" value="v"><button formaction="javascript:alert(1)">Go</button><select><option>o</option></select><textarea>t</textarea></form>ok',
      "ok",
    ],
    ["stray input", '<input autofocus onfocus="alert(1)">ok', "ok"],
    ["template", "<template><img src=x onerror=alert(1)></template>ok", "ok"],
    [
      "noscript mutation",
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>ok',
      "ok",
    ],
    ["xmp", "<xmp><script>alert(1)</script></xmp>ok", "ok"],
    ["plaintext", "ok<plaintext><script>alert(1)</script>", "ok"],
    ["dialog", "<dialog open><p>modal</p></dialog>ok", "ok"],
    [
      "slot and portal",
      '<slot name="x">s</slot><portal src="x"></portal>ok',
      "ok",
    ],
    ["comment", "<!-- <script>alert(1)</script> -->ok", "ok"],
    ["comment closed early", "<!--><script>alert(1)</script>-->ok", "ok"],
    [
      "comment text after its end",
      "<!-- a --> b --><p>c</p>",
      "b --&gt;<p>c</p>",
    ],
    [
      "CDATA with markup",
      "<![CDATA[<script>alert(1)</script>]]>",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    ],
    [
      "processing instruction",
      "<?xml-stylesheet href='javascript:alert(1)'?>ok",
      "ok",
    ],
    [
      "namespaced link",
      '<x:a href="javascript:alert(1)">n</x:a>',
      "<span>n</span>",
    ],
    ["namespaced paragraph", "<x:p onclick=x>t</x:p>", "<p>t</p>"],
    ["nested drop", "<style><style></style>tail</style>ok", "ok"],
  ])("neutralises %s", (_name: string, input: string, expected: string) => {
    const html: string = sanitize(input);

    expect(html).toBe(expected);
    expectSafe(html);
    expect(DANGEROUS_TEXT_PATTERN.test(parse(html).innerHTML)).toBe(false);
  });

  test.each([
    ["plain", "javascript:alert(1)"],
    ["upper case", "JAVASCRIPT:alert(1)"],
    ["mixed case", "JaVaScRiPt:alert(1)"],
    ["leading space", " javascript:alert(1)"],
    ["leading newline", "\njavascript:alert(1)"],
    ["tab in the scheme", "java\tscript:alert(1)"],
    ["newline in the scheme", "java\nscript:alert(1)"],
    ["carriage return in the scheme", "java\rscript:alert(1)"],
    ["NUL in the scheme", `java${NUL}script:alert(1)`],
    ["decimal entity", "&#106;avascript:alert(1)"],
    ["hex entity", "&#x6A;avascript:alert(1)"],
    ["entity tab in the scheme", "jav&#x09;ascript:alert(1)"],
    ["entity colon", "javascript&colon;alert(1)"],
    ["numeric colon", "javascript&#58;alert(1)"],
    ["percent-encoded colon", "javascript%3Aalert(1)"],
    ["data URL", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["vbscript", "vbscript:msgbox(1)"],
    ["file", "file:///etc/passwd"],
    ["blob", "blob:https://example.com/0000-0000"],
    ["protocol-relative", "//evil.example/x"],
    ["backslashes", "\\\\evil.example\\x"],
    ["unknown scheme", "x-custom:open"],
  ])("removes a %s href", (_name: string, href: string) => {
    const escaped: string = href.replace(/"/g, "&quot;");
    const html: string = sanitize(`<a href="${escaped}">x</a>`);

    expect(html).toBe("<span>x</span>");
    expectSafe(html);
  });
});

describe("sanitizeBookHtml: balance and nesting", () => {
  test.each([
    [
      "<p><b>unclosed <i>deep</p>more",
      "<p><b>unclosed <i>deep</i></b></p>more",
    ],
    ["</div></p>text<p>", "text<p></p>"],
    ["<div><span>x</div></span>y", "<div><span>x</span></div>y"],
    ["<ul><li>a<li>b", "<ul><li>a<li>b</li></li></ul>"],
    [
      "<table><tr><td>a</table>after",
      "<table><tr><td>a</td></tr></table>after",
    ],
    ["<b><x-unknown><i>t</b></i>", "<b><i>t</i></b>"],
    ["<p>a</P><P>b</p>", "<p>a</p><p>b</p>"],
  ])("balances %j", (input: string, expected: string) => {
    const html: string = sanitize(input);

    expect(html).toBe(expected);
    expect(safetyViolations(html)).toEqual([]);
  });

  test("unwraps elements nested deeper than 48 levels, keeping their text", () => {
    const depth: number = 60;
    const html: string = sanitize(
      "<div>".repeat(depth) +
        "deep<br><p>para</p>" +
        "</div>".repeat(depth) +
        "<p>after</p>",
    );

    expect(html.match(/<div>/g)).toHaveLength(48);
    expect(html.match(/<\/div>/g)).toHaveLength(48);
    expect(html).not.toContain("<br>");
    expect(html).toContain("deeppara");
    expect(html.endsWith("<p>after</p>")).toBe(true);
    expectSafe(html);
  });

  test("keeps elements at exactly the depth limit", () => {
    const html: string = sanitize(
      "<div>".repeat(47) + "<p>47 deep</p>" + "</div>".repeat(47),
    );

    expect(html).toContain("<p>47 deep</p>");
    expect(html.match(/<div>/g)).toHaveLength(47);
  });
});

describe("sanitizeBookHtml: the book's own documents", () => {
  test.each(
    defaultBookItems()
      .filter((item: EpubItem): boolean => {
        return !item.mediaType || item.mediaType === "application/xhtml+xml";
      })
      .map((item: EpubItem): [string, string] => {
        return [item.href, item.content];
      }),
  )(
    "sanitizes %s safely and parses back to the same structure",
    (_href: string, content: string) => {
      const html: string = sanitize(content);

      expect(html.length).toBeGreaterThan(0);
      expectSafe(html);
      expectRoundTrip(html);
      expect(parse(html).querySelector("script")).toBeNull();
    },
  );
});

/*
 * Seeded fuzzing: random tag soup built from dangerous and benign pieces,
 * broken syntax included. The seed is fixed, so a failure is reproducible;
 * the assertion prints the input that produced it.
 */
describe("sanitizeBookHtml: fuzzing", () => {
  const createRandom: (seed: number) => () => number = (
    seed: number,
  ): (() => number) => {
    let state: number = seed >>> 0;

    return (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value: number = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  };

  const TAGS: Array<string> = [
    "script",
    "SCRIPT",
    "style",
    "iframe",
    "img",
    "Img",
    "svg",
    "svg:script",
    "math",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "option",
    "template",
    "noscript",
    "base",
    "meta",
    "link",
    "video",
    "audio",
    "source",
    "xmp",
    "title",
    "head",
    "html",
    "body",
    "nav",
    "x-foo",
    "x:a",
    "a",
    "A",
    "p",
    "div",
    "span",
    "b",
    "i",
    "em",
    "strong",
    "code",
    "pre",
    "h1",
    "h2",
    "ul",
    "ol",
    "li",
    "table",
    "tr",
    "td",
    "th",
    "abbr",
    "section",
    "br",
    "hr",
  ];

  const ATTRIBUTES: Array<string> = [
    "onclick=alert(1)",
    'ONMOUSEOVER="alert(1)"',
    "onerror=alert(1)",
    'style="color:red"',
    'href="javascript:alert(1)"',
    'href=" JAVASCRIPT:alert(1)"',
    'href="&#106;avascript:alert(1)"',
    'href="java&#x09;script:alert(1)"',
    'href="data:text/html,<script>alert(1)</script>"',
    'href="vbscript:x"',
    'href="//evil.example/x"',
    'href="https://example.com/?q=<x>&amp;y=&quot;z&quot;"',
    'href="mailto:a@example.com"',
    'href="#frag"',
    'href="#"',
    'href="../rollback.xhtml"',
    'href="../worksheets.xhtml#restore-proof"',
    'href="bad-id.xhtml"',
    'href="nowhere.xhtml"',
    'src="x"',
    'srcdoc="<script>alert(1)</script>"',
    'formaction="javascript:alert(1)"',
    'xlink:href="javascript:alert(1)"',
    'class="hook meta"',
    `class='" onclick="alert(1)'`,
    'class="1bad _x ok"',
    'id="restore-proof"',
    'id="1bad"',
    'id="x" id="y"',
    "hidden",
    'title="t&quot;><script>"',
    'colspan="2"',
    'rowspan="x"',
    'scope="row"',
    'lang="en-GB"',
    'xml:lang="javascript:x"',
    'data-book-section="m05"',
    'target="_self"',
    'rel="opener"',
    "reversed",
    'value="3"',
    'start="007"',
  ];

  const TEXTS: Array<string> = [
    "hello",
    " ",
    "\n",
    "<",
    ">",
    "&",
    "&amp;",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
    "&#60;script&#62;",
    "&#x3C;img src=x onerror=alert(1)&#x3E;",
    '"',
    "'",
    "&#106;avascript:",
    "javascript:alert(1)",
    "]]>",
    "-->",
    "<!--",
    "<![CDATA[<script>alert(1)</script>]]>",
    "<?x y?>",
    "<!DOCTYPE html>",
    "&bogus;",
    "&#0;",
    "&#xD800;",
    NUL,
    "</",
    "<3",
    "a < b",
    `"><script>alert(1)</script>`,
    "<img src=x onerror=alert(1)>",
    "<a href=javascript:alert(1)>",
    `${MIDDOT}${EM_DASH}`,
  ];

  const pick: (random: () => number, items: Array<string>) => string = (
    random: () => number,
    items: Array<string>,
  ): string => {
    return items[Math.floor(random() * items.length)]!;
  };

  const tagSoup: (random: () => number) => string = (
    random: () => number,
  ): string => {
    const pieces: Array<string> = [];
    const count: number = 1 + Math.floor(random() * 40);

    for (let index: number = 0; index < count; index++) {
      const roll: number = random();

      if (roll < 0.35) {
        const attributes: Array<string> = [];
        const attributeCount: number = Math.floor(random() * 4);

        for (let a: number = 0; a < attributeCount; a++) {
          attributes.push(pick(random, ATTRIBUTES));
        }

        const selfClosing: string = random() < 0.1 ? " /" : "";
        const end: string = random() < 0.03 ? "" : ">";

        pieces.push(
          `<${pick(random, TAGS)}${attributes.length ? " " + attributes.join(" ") : ""}${selfClosing}${end}`,
        );
      } else if (roll < 0.6) {
        pieces.push(`</${pick(random, TAGS)}>`);
      } else {
        pieces.push(pick(random, TEXTS));
      }
    }

    return pieces.join("");
  };

  test("never produces unsafe or unbalanced output for 600 random documents", () => {
    const random: () => number = createRandom(0x0b00c5);
    const failures: Array<{ input: string; violations: Array<string> }> = [];

    for (let iteration: number = 0; iteration < 600; iteration++) {
      const input: string = tagSoup(random);
      const withResolver: boolean = random() < 0.8;
      const violations: Array<string> = safetyViolations(
        sanitize(input, withResolver),
      );

      if (violations.length > 0) {
        failures.push({ input, violations });
      }
    }

    expect(failures).toEqual([]);
  });

  test("is deterministic", () => {
    const first: () => number = createRandom(42);
    const second: () => number = createRandom(42);

    for (let iteration: number = 0; iteration < 25; iteration++) {
      const input: string = tagSoup(first);

      expect(tagSoup(second)).toBe(input);
      expect(sanitize(input)).toBe(sanitize(input));
    }
  });

  test("sanitizing its own output changes nothing but the namespacing it already applied", () => {
    const random: () => number = createRandom(7);

    for (let iteration: number = 0; iteration < 150; iteration++) {
      const once: string = sanitize(tagSoup(random));
      const twice: string = sanitize(once);

      // A second pass may only prefix names again; it never adds or removes markup.
      expect(stringTagSequence(twice)).toEqual(stringTagSequence(once));
      expect(parse(twice).textContent).toBe(parse(once).textContent);
      expect(safetyViolations(twice)).toEqual([]);
    }
  });
});
