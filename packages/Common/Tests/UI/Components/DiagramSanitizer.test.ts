import { describe, expect, test } from "@jest/globals";
import DOMPurify from "dompurify";
import fs from "fs";
import path from "path";
import {
  KATEX_MATHML_ATTRIBUTES,
  KATEX_MATHML_TAGS,
  sanitizeDiagramSvg,
} from "../../../UI/Components/Markdown.tsx/DiagramSanitizer";

/*
 * The sanitizer every frontend runs over a mermaid diagram's SVG before it
 * goes into the page (MarkdownViewer's MermaidDiagram). It keeps SVG and
 * nothing else, as it always has, plus exactly the MathML KaTeX writes for a
 * $$...$$ label: mermaid has no switch for KaTeX's HTML-only output (its math
 * settings offer MathML, or MathML and HTML together), so the label is drawn
 * from KaTeX's MathML, and only that much MathML gets through.
 */

const KATEX_SOURCE: string = path.resolve(
  __dirname,
  "../../../node_modules/katex/src",
);

const MATHML_NAMESPACE: string = "http://www.w3.org/1998/Math/MathML";
const SVG_NAMESPACE: string = "http://www.w3.org/2000/svg";
const HTML_NAMESPACE: string = "http://www.w3.org/1999/xhtml";

// KaTeX's MathML node types never written for a mermaid label.
const NEVER_WRITTEN_FOR_A_LABEL: Array<string> = [
  // TeX source; mermaid deletes it before the label reaches the page.
  "annotation",
  // Only wraps the math and its annotation; its content is kept without it.
  "semantics",
  // \includegraphics, which KaTeX refuses unless told to trust the input.
  "mglyph",
  // Declared, never built (KaTeX lays out equation tags with mtd instead).
  "mlabeledtr",
];

// Attributes KaTeX sets only on its HTML, its SVG, or the nodes above.
const NOT_ON_A_LABELS_MATHML: Array<string> = [
  "aria-hidden",
  "d",
  "src",
  "alt",
  "valign",
  // \href, which KaTeX refuses unless told to trust the input.
  "href",
];

const parse: (markup: string) => HTMLDivElement = (
  markup: string,
): HTMLDivElement => {
  const holder: HTMLDivElement = document.createElement("div");
  holder.innerHTML = markup;
  return holder;
};

// Sanitized, then parsed back the way the viewer puts it in the page.
const sanitizedInPage: (svg: string) => HTMLDivElement = (
  svg: string,
): HTMLDivElement => {
  return parse(sanitizeDiagramSvg(svg));
};

const everyElement: (root: Element) => Array<Element> = (
  root: Element,
): Array<Element> => {
  return Array.from(root.querySelectorAll("*"));
};

const inALabel: (content: string) => string = (content: string): string => {
  return `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 100 40"><g class="label"><foreignObject width="80" height="20"><div xmlns="${HTML_NAMESPACE}" style="display: table-cell;"><span class="nodeLabel">${content}</span></div></foreignObject></g></svg>`;
};

const mathInALabel: (content: string) => string = (content: string): string => {
  return inALabel(
    `<span class="katex"><math xmlns="${MATHML_NAMESPACE}" display="block">${content}</math></span>`,
  );
};

/*
 * Nothing that runs: no script element, no element that loads something,
 * no event handler and no javascript: URL anywhere.
 */
const expectInert: (root: Element) => void = (root: Element): void => {
  for (const element of everyElement(root)) {
    const tag: string = element.localName;

    expect([tag, ["script", "iframe", "img", "object", "embed", "use", "set", "animate"].includes(tag)]).toEqual([tag, false]);

    for (const attribute of Array.from(element.attributes)) {
      expect([tag, attribute.name, /^on/i.test(attribute.name)]).toEqual([
        tag,
        attribute.name,
        false,
      ]);
      expect([tag, attribute.name, /javascript:/i.test(attribute.value)]).toEqual([
        tag,
        attribute.name,
        false,
      ]);
    }
  }
};

describe("the MathML a diagram may carry", () => {
  test("is every element KaTeX can write for a label, and no other", () => {
    const tree: string = fs.readFileSync(
      path.join(KATEX_SOURCE, "mathMLTree.ts"),
      "utf8",
    );
    const union: RegExpMatchArray | null = tree.match(
      /export type MathNodeType =([\s\S]*?);/,
    );

    expect(union).not.toBeNull();

    const katexTypes: Array<string> = (
      (union as RegExpMatchArray)[1]?.match(/"([a-z]+)"/g) || []
    ).map((quoted: string): string => {
      return quoted.replace(/"/g, "");
    });

    expect(katexTypes.length).toBeGreaterThan(20);
    expect([...KATEX_MATHML_TAGS].sort()).toEqual(
      katexTypes
        .filter((type: string): boolean => {
          return !NEVER_WRITTEN_FOR_A_LABEL.includes(type);
        })
        .sort(),
    );
  });

  test("is every attribute KaTeX sets on it that SVG does not already allow, and no other", () => {
    const files: Array<string> = [];
    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|js)$/.test(entry.name)) {
          files.push(full);
        }
      }
    };
    walk(KATEX_SOURCE);

    const set: Set<string> = new Set();
    for (const file of files) {
      for (const match of fs
        .readFileSync(file, "utf8")
        .matchAll(/setAttribute\(\s*["']([a-zA-Z-]+)["']/g)) {
        set.add(match[1] as string);
      }
    }

    expect(set.size).toBeGreaterThan(20);

    // What SVG alone already lets through, asked of DOMPurify itself.
    const svgAllows: (name: string) => boolean = (name: string): boolean => {
      const clean: string = DOMPurify.sanitize(
        `<svg><g ${name}="1"></g></svg>`,
        { USE_PROFILES: { svg: true, svgFilters: true } },
      ) as string;
      return clean.includes(`${name}="1"`);
    };

    const needed: Array<string> = Array.from(set)
      .filter((name: string): boolean => {
        return !NOT_ON_A_LABELS_MATHML.includes(name) && !svgAllows(name);
      })
      .sort();

    expect([...KATEX_MATHML_ATTRIBUTES].sort()).toEqual(needed);
  });

  test("keeps each of those elements, with each of those attributes", () => {
    const attributes: string = KATEX_MATHML_ATTRIBUTES.map(
      (name: string): string => {
        return `${name}="1"`;
      },
    ).join(" ");
    const nested: string = KATEX_MATHML_TAGS.filter((tag: string): boolean => {
      return tag !== "math";
    })
      .map((tag: string): string => {
        return `<${tag} ${attributes}>t</${tag}>`;
      })
      .join("");

    const clean: HTMLDivElement = sanitizedInPage(mathInALabel(nested));
    const math: Element | null = clean.querySelector("math");

    expect(math?.namespaceURI).toBe(MATHML_NAMESPACE);

    for (const tag of KATEX_MATHML_TAGS) {
      const element: Element | null =
        tag === "math" ? math : (math?.querySelector(tag) ?? null);

      expect([tag, element?.namespaceURI]).toEqual([tag, MATHML_NAMESPACE]);

      if (tag === "math") {
        continue;
      }

      for (const name of KATEX_MATHML_ATTRIBUTES) {
        expect([tag, name, element?.getAttribute(name)]).toEqual([
          tag,
          name,
          "1",
        ]);
      }
    }
  });

  test("keeps what KaTeX writes for x^2 + y^2 = z^2 and drops the label's HTML around it", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      mathInALabel(
        "<semantics><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup><mo>=</mo><msup><mi>z</mi><mn>2</mn></msup></mrow><annotation encoding=\"application/x-tex\">x^2 + y^2 = z^2</annotation></semantics>",
      ),
    );

    const math: Element | null = clean.querySelector("foreignObject > math");

    expect(math?.getAttribute("display")).toBe("block");
    expect(math?.querySelectorAll("msup")).toHaveLength(3);
    // The TeX source is never shown, and semantics goes but keeps its math.
    expect(math?.textContent).toBe("x2+y2=z2");
    expect(math?.querySelector("semantics, annotation")).toBeNull();
    expect(
      everyElement(clean).filter((element: Element): boolean => {
        return element.namespaceURI === HTML_NAMESPACE;
      }),
    ).toEqual([]);
  });

  test("is not let in outside a label's foreignObject", () => {
    for (const markup of [
      `<svg xmlns="${SVG_NAMESPACE}"><math><mi>x</mi></math></svg>`,
      `<svg xmlns="${SVG_NAMESPACE}"><g><math><mi>x</mi></math></g></svg>`,
      `<svg xmlns="${SVG_NAMESPACE}"><text><math><mi>x</mi></math></text></svg>`,
      `<math><mi>x</mi></math>`,
    ]) {
      expect([markup, sanitizedInPage(markup).querySelector("math")]).toEqual([
        markup,
        null,
      ]);
    }
  });
});

describe("a diagram's SVG", () => {
  test("keeps mermaid's stylesheet, shapes, text and plain labels", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      `<svg xmlns="${SVG_NAMESPACE}" id="mermaid-1" viewBox="0 0 10 10"><style>#mermaid-1{fill:#333;}</style><g class="root"><rect x="1" y="1" width="8" height="8"></rect><text x="2" y="5">Hello Bob</text><foreignObject width="80" height="20"><div xmlns="${HTML_NAMESPACE}"><span class="nodeLabel"><p>Plain label</p></span></div></foreignObject></g></svg>`,
    );
    const svg: SVGSVGElement | null = clean.querySelector("svg");

    expect(svg?.querySelector("style")?.textContent).toContain("fill:#333");
    expect(svg?.querySelector("rect")).not.toBeNull();
    expect(svg?.querySelector("text")?.textContent).toBe("Hello Bob");
    expect(svg?.querySelector("foreignObject")?.textContent).toBe(
      "Plain label",
    );
  });

  test("still keeps no HTML element, not even the ones HTML shares with SVG", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      inALabel(
        '<style>body{display:none}</style><a href="https://example.com/phish">Sign in</a><font color="red">Red</font><title>T</title><b>Bold</b>',
      ),
    );

    expect(
      everyElement(clean).filter((element: Element): boolean => {
        return element.namespaceURI === HTML_NAMESPACE;
      }),
    ).toEqual([]);
    // The text the label showed stays.
    expect(clean.querySelector("foreignObject")?.textContent).toContain("Bold");
  });
});

describe("nothing in a diagram runs", () => {
  test("an event handler on KaTeX's MathML", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      mathInALabel(
        '<mrow onclick="alert(1)"><mi onmouseover="alert(2)" onfocus="alert(3)">x</mi><mo onanimationstart="alert(4)">+</mo></mrow>',
      ),
    );

    expect(clean.querySelector("mi")?.textContent).toBe("x");
    expectInert(clean);
  });

  test("an event handler on the math element itself", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      inALabel(
        `<math xmlns="${MATHML_NAMESPACE}" onclick="alert(1)" onload="alert(2)"><mi>x</mi></math>`,
      ),
    );

    expect(clean.querySelector("math")).not.toBeNull();
    expectInert(clean);
  });

  test("a script inside MathML, as an element or as text", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      mathInALabel(
        "<mtext><script>alert(1)</script></mtext><mi><script>alert(2)</script>x</mi>",
      ),
    );

    expect(clean.querySelector("script")).toBeNull();
    expectInert(clean);
  });

  test("HTML inside a MathML token: images, styles, forms", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      mathInALabel(
        '<mtext><img src="x" onerror="alert(1)"></mtext><mi><style>*{display:none}</style>y</mi><mo><form action="https://example.com"><button>Go</button></form></mo><mn><iframe src="https://example.com"></iframe></mn>',
      ),
    );

    expect(
      everyElement(clean).filter((element: Element): boolean => {
        return element.namespaceURI === HTML_NAMESPACE;
      }),
    ).toEqual([]);
    expect(clean.querySelector("math style")).toBeNull();
    expectInert(clean);
  });

  test("a javascript: link on MathML or SVG", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      inALabel(
        `<math xmlns="${MATHML_NAMESPACE}" href="javascript:alert(1)"><mrow href="javascript:alert(2)"><mi xlink:href="javascript:alert(3)">x</mi></mrow></math>`,
      ).replace(
        "</g></svg>",
        '<a xlink:href="javascript:alert(4)" href="javascript:alert(5)"><text>link</text></a></g></svg>',
      ),
    );

    expect(clean.querySelector("mi")?.textContent).toBe("x");
    expectInert(clean);
  });

  test("MathML that KaTeX never writes: maction, annotation-xml, mglyph, annotation", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      mathInALabel(
        '<maction actiontype="statusline"><mi>x</mi><mtext>see https://example.com</mtext></maction><semantics><mi>y</mi><annotation-xml encoding="text/html"><img src="x" onerror="alert(1)"></annotation-xml></semantics><mglyph src="https://example.com/x.png" alt="x"></mglyph><annotation encoding="application/x-tex">\\alert</annotation>',
      ),
    );

    for (const tag of ["maction", "annotation-xml", "mglyph", "annotation", "semantics"]) {
      expect([tag, clean.querySelector(tag)]).toEqual([tag, null]);
    }
    expectInert(clean);
  });

  test("event handlers and active elements in the SVG itself", () => {
    const clean: HTMLDivElement = sanitizedInPage(
      `<svg xmlns="${SVG_NAMESPACE}" onload="alert(1)"><g onclick="alert(2)"><rect onmouseover="alert(3)" width="1" height="1"></rect><set attributeName="href" to="javascript:alert(4)"></set><animate attributeName="href" values="javascript:alert(5)"></animate><use href="data:image/svg+xml,&lt;svg onload=alert(6)&gt;"></use><script>alert(7)</script></g><foreignObject><iframe src="https://example.com"></iframe><object data="https://example.com"></object></foreignObject></svg>`,
    );

    expect(clean.querySelector("rect")).not.toBeNull();
    expectInert(clean);
  });

  test.each([
    [
      "a table that closes math early",
      '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
    ],
    [
      "nested forms that close math early",
      '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
    ],
    [
      "an SVG style holding markup inside MathML",
      '<math><mi><svg><style><img src=x onerror=alert(1)></style></svg></mi></math>',
    ],
    [
      "a style whose text closes it inside an attribute",
      '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
    ],
    [
      "a comment that closes the style",
      '<math><mtext><style><!--</style><img src=x onerror=alert(1)>--></style></mtext></math>',
    ],
    [
      "mglyph and malignmark around a style",
      '<math><mi><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">',
    ],
  ])("a known way past a sanitizer: %s", (_name: string, payload: string) => {
    // Inside a label, where the math is let in, and on its own.
    for (const markup of [inALabel(payload), payload]) {
      const clean: HTMLDivElement = sanitizedInPage(markup);
      expectInert(clean);
      // Parsed again, as setting innerHTML twice would.
      expectInert(parse(clean.innerHTML));
    }
  });
});
