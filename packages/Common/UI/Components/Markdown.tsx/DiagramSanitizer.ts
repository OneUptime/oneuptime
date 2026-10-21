import DOMPurify from "dompurify";

/*
 * What a mermaid diagram may put into the page.
 *
 * SVG, and no HTML element - as before: a label's HTML wrappers (div, span,
 * p) are dropped and their text kept, and an HTML element HTML shares with
 * SVG (a, font, style, title) is dropped with its content.
 *
 * Plus the MathML KaTeX writes for a $$...$$ label, and nothing else of
 * MathML. The decision was to keep this sanitizer strict and have KaTeX write
 * HTML only for diagrams, but mermaid has no switch for that: its math
 * settings ask KaTeX for MathML, or for MathML and HTML together (and KaTeX's
 * HTML needs KaTeX's stylesheet and fonts besides). So the label is drawn
 * from KaTeX's MathML, and exactly the MathML KaTeX writes gets through:
 *
 *   - its elements, minus the four it never writes into a label: annotation
 *     (the TeX source, which mermaid deletes; dropped here with its text),
 *     semantics (its content is kept without it), mglyph (\includegraphics,
 *     refused unless KaTeX is told to trust the input) and mlabeledtr
 *     (declared, never built);
 *   - the attributes it sets on them that SVG does not already allow (class,
 *     display, height, style, width and xmlns it does);
 *   - only as a label: a math element directly inside a foreignObject,
 *     where a label's math sits once its HTML wrappers are gone, with no
 *     markup inside a MathML token (mi, mo, mn, ms, mtext) - KaTeX writes
 *     plain text there.
 *
 * Tests/UI/Components/DiagramSanitizer.test.ts derives both lists from the
 * installed KaTeX, so a KaTeX that writes something new is a failing test,
 * not a silently empty label.
 */

export const KATEX_MATHML_TAGS: ReadonlyArray<string> = [
  "math",
  "mi",
  "mn",
  "mo",
  "mtext",
  "mspace",
  "mrow",
  "mstyle",
  "mpadded",
  "mphantom",
  "menclose",
  "msub",
  "msup",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mfrac",
  "msqrt",
  "mroot",
  "mtable",
  "mtr",
  "mtd",
];

export const KATEX_MATHML_ATTRIBUTES: ReadonlyArray<string> = [
  "accent",
  "accentunder",
  "columnalign",
  "columnlines",
  "columnspacing",
  "depth",
  "displaystyle",
  "fence",
  "largeop",
  "linebreak",
  "linethickness",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "notation",
  "rowlines",
  "rowspacing",
  "rspace",
  "scriptlevel",
  "separator",
  "stretchy",
  "voffset",
];

const SVG_NAMESPACE: string = "http://www.w3.org/2000/svg";
const MATHML_NAMESPACE: string = "http://www.w3.org/1998/Math/MathML";

// Whether a node is an SVG foreignObject: where a label's content sits.
const isForeignObject: (node: Node | null) => boolean = (
  node: Node | null,
): boolean => {
  const element: Element | null = node as Element | null;

  return (
    Boolean(element) &&
    element?.namespaceURI === SVG_NAMESPACE &&
    element.localName.toLowerCase() === "foreignobject"
  );
};

let diagramPurifier: typeof DOMPurify | null = null;

/*
 * A DOMPurify of its own, made on first use, so the hook below touches no
 * other sanitizer on the page.
 */
const getDiagramPurifier: () => typeof DOMPurify = (): typeof DOMPurify => {
  if (!diagramPurifier) {
    const purifier: typeof DOMPurify = DOMPurify(window);

    // A math element anywhere but directly in a label's foreignObject goes.
    purifier.addHook(
      "uponSanitizeElement",
      (node: Node, event: { tagName: string }): void => {
        if (event.tagName === "math" && !isForeignObject(node.parentNode)) {
          node.parentNode?.removeChild(node);
        }
      },
    );

    diagramPurifier = purifier;
  }

  return diagramPurifier;
};

export const sanitizeDiagramSvg: (svg: string) => string = (
  svg: string,
): string => {
  return getDiagramPurifier().sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["foreignObject", ...KATEX_MATHML_TAGS],
    ADD_ATTR: [...KATEX_MATHML_ATTRIBUTES],
    // The TeX source, if mermaid ever left it in: dropped, text and all.
    ADD_FORBID_CONTENTS: ["annotation"],
    // A label's math sits in its foreignObject.
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    // KaTeX writes text, never markup, inside mi, mo, mn, ms and mtext.
    MATHML_TEXT_INTEGRATION_POINTS: {},
    /*
     * No HTML element anywhere in a diagram, as before. Without this, the
     * foreignObject rule above would keep an HTML a, font, style or title
     * that sits in a label.
     */
    ALLOWED_NAMESPACES: [SVG_NAMESPACE, MATHML_NAMESPACE],
  }) as string;
};
