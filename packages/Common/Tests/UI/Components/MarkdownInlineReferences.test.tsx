/*
 * Inline references in MarkdownViewer: the remark transform that turns
 * "[C12]" citation markers and "#6954" incident / alert numbers into custom
 * mdast nodes, the context-driven elements those nodes render as, and the
 * viewer wiring that only opts in when a caller passes `inlineReferences`.
 *
 * react-markdown and the remark packages are ESM and do not run under
 * Common's jest, so:
 *
 *   - the transform is exercised directly on hand-built mdast trees;
 *   - react-markdown is replaced (below) by a tiny stand-in that records the
 *     props MarkdownViewer passes, runs the recorded remark plugins over a
 *     test-provided mdast tree, and renders that tree through the recorded
 *     `components` map. That is enough to observe the real plugin, the real
 *     element components and the real context provider working together
 *     through MarkdownViewer, without the real parser.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("react-markdown", () => {
  return {
    __esModule: true,
    default: (props: MockReactMarkdownProps): React.ReactElement => {
      return renderMockMarkdown(props);
    },
    defaultUrlTransform: (url: string): string => {
      return url;
    },
  };
});

import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement, useEffect, useState } from "react";
import remarkGfm from "remark-gfm";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  CITATION_REFERENCE_NODE_TYPE,
  CITATION_REFERENCE_TAG_NAME,
  EVENT_REFERENCE_NODE_TYPE,
  EVENT_REFERENCE_TAG_NAME,
  InlineReferenceMarkdownNode,
  MARKDOWN_INLINE_REFERENCE_COMPONENTS,
  MarkdownCitationReferenceElement,
  MarkdownEventReference,
  MarkdownEventReferenceElement,
  MarkdownInlineReferenceContext,
  MarkdownInlineReferenceRenderers,
  applyInlineReferences,
  remarkInlineReferences,
} from "../../../UI/Components/Markdown.tsx/InlineReferences";
import MarkdownViewer from "../../../UI/Components/Markdown.tsx/MarkdownViewer";
import LazyMarkdownViewer from "../../../UI/Components/Markdown.tsx/LazyMarkdownViewer";

/*
 * ---------------------------------------------------------------------------
 * react-markdown stand-in
 * ---------------------------------------------------------------------------
 */

type MockComponentMap = Record<string, React.ElementType>;

interface MockReactMarkdownProps {
  children?: string;
  components?: MockComponentMap;
  remarkPlugins?: Array<unknown>;
}

interface MockMarkdownState {
  // When set, rendered instead of `children` (after running the plugins).
  tree: InlineReferenceMarkdownNode | null;
  calls: Array<MockReactMarkdownProps>;
}

const mockMarkdownState: MockMarkdownState = {
  tree: null,
  calls: [],
};

const MOCK_TAG_BY_NODE_TYPE: Record<string, string> = {
  paragraph: "p",
  strong: "strong",
  emphasis: "em",
  delete: "del",
  link: "a",
  image: "img",
  inlineCode: "code",
  blockquote: "blockquote",
  list: "ul",
  listItem: "li",
  heading: "h2",
};

function mockAttributeName(propertyName: string): string {
  // hast `dataCitationId` → DOM `data-citation-id`, as hast-util-to-jsx-runtime does.
  return propertyName.replace(/[A-Z]/g, (letter: string): string => {
    return `-${letter.toLowerCase()}`;
  });
}

function runMockPlugins(
  plugins: Array<unknown>,
  tree: InlineReferenceMarkdownNode,
): void {
  for (const plugin of plugins) {
    let transformer: unknown = undefined;

    if (Array.isArray(plugin)) {
      const [attacher, ...parameters] = plugin as [
        (...args: Array<unknown>) => unknown,
        ...Array<unknown>,
      ];
      transformer = attacher(...parameters);
    } else if (typeof plugin === "function") {
      transformer = (plugin as () => unknown)();
    }

    if (typeof transformer === "function") {
      (transformer as (node: InlineReferenceMarkdownNode) => void)(tree);
    }
  }
}

function renderMockNode(
  node: InlineReferenceMarkdownNode,
  components: MockComponentMap,
  key: number,
): React.ReactNode {
  if (node.type === "text") {
    return node.value || "";
  }

  if (node.type === "definition") {
    return null;
  }

  const tagName: string =
    node.data?.hName || MOCK_TAG_BY_NODE_TYPE[node.type] || "span";
  const elementProps: Record<string, unknown> = { key: key };

  for (const [name, value] of Object.entries(node.data?.hProperties || {})) {
    elementProps[mockAttributeName(name)] = value;
  }

  if (node.type === "link") {
    elementProps["href"] = node["url"];
  }

  if (node.type === "image") {
    elementProps["src"] = node["url"];
    elementProps["alt"] = node.alt;
  }

  const children: Array<React.ReactNode> =
    node.type === "inlineCode"
      ? [node.value || ""]
      : (node.children || []).map(
          (child: InlineReferenceMarkdownNode, index: number) => {
            return renderMockNode(child, components, index);
          },
        );

  const component: React.ElementType = (components[tagName] ||
    tagName) as React.ElementType;

  return React.createElement(
    component,
    elementProps,
    ...(children.length > 0 ? children : []),
  );
}

function renderMockMarkdown(props: MockReactMarkdownProps): ReactElement {
  mockMarkdownState.calls.push(props);

  if (!mockMarkdownState.tree) {
    return React.createElement(
      "div",
      { "data-testid": "react-markdown" },
      props.children,
    );
  }

  // The real pipeline parses fresh on every render; never mutate the fixture.
  const tree: InlineReferenceMarkdownNode = cloneTree(mockMarkdownState.tree);
  runMockPlugins(props.remarkPlugins || [], tree);

  return React.createElement(
    "div",
    { "data-testid": "react-markdown" },
    ...(tree.children || []).map(
      (child: InlineReferenceMarkdownNode, index: number) => {
        return renderMockNode(child, props.components || {}, index);
      },
    ),
  );
}

/*
 * ---------------------------------------------------------------------------
 * mdast helpers
 * ---------------------------------------------------------------------------
 */

type Node = InlineReferenceMarkdownNode;

function cloneTree(tree: Node): Node {
  return JSON.parse(JSON.stringify(tree)) as Node;
}

function text(value: string): Node {
  return { type: "text", value: value };
}

function paragraph(...children: Array<Node>): Node {
  return { type: "paragraph", children: children };
}

function root(...children: Array<Node>): Node {
  return { type: "root", children: children };
}

function citation(citationId: string, value?: string): Node {
  return {
    type: CITATION_REFERENCE_NODE_TYPE,
    data: {
      hName: CITATION_REFERENCE_TAG_NAME,
      hProperties: { dataCitationId: citationId },
    },
    children: [text(value ?? `[${citationId}]`)],
  };
}

function eventRef(
  kind: "incident" | "alert" | "",
  referenceNumber: number,
  value?: string,
): Node {
  return {
    type: EVENT_REFERENCE_NODE_TYPE,
    data: {
      hName: EVENT_REFERENCE_TAG_NAME,
      hProperties: {
        dataRefKind: kind,
        dataRefNumber: referenceNumber.toString(),
      },
    },
    children: [text(value ?? `#${referenceNumber}`)],
  };
}

function linkReference(
  identifier: string,
  children: Array<Node>,
  referenceType: "shortcut" | "collapsed" | "full" = "shortcut",
  label?: string,
): Node {
  return {
    type: "linkReference",
    identifier: identifier,
    label: label ?? identifier.toUpperCase(),
    referenceType: referenceType,
    children: children,
  };
}

const BOTH: { citations: boolean; eventReferences: boolean } = {
  citations: true,
  eventReferences: true,
};

// Transforms a single paragraph with the given children and returns them.
function transformParagraph(
  children: Array<Node>,
  options: { citations: boolean; eventReferences: boolean } = BOTH,
): Array<Node> {
  const tree: Node = root(paragraph(...children));
  applyInlineReferences(tree, options);
  return tree.children?.[0]?.children || [];
}

function transformText(
  value: string,
  options: { citations: boolean; eventReferences: boolean } = BOTH,
): Array<Node> {
  return transformParagraph([text(value)], options);
}

function collectNodes(
  node: Node,
  predicate: (candidate: Node) => boolean,
): Array<Node> {
  const found: Array<Node> = predicate(node) ? [node] : [];
  for (const child of node.children || []) {
    found.push(...collectNodes(child, predicate));
  }
  return found;
}

function isCustomReferenceNode(node: Node): boolean {
  return (
    node.type === CITATION_REFERENCE_NODE_TYPE ||
    node.type === EVENT_REFERENCE_NODE_TYPE
  );
}

function countType(tree: Node, type: string): number {
  return collectNodes(tree, (node: Node): boolean => {
    return node.type === type;
  }).length;
}

const CITATION_IDENTIFIER: RegExp = /^c\d{1,3}$/i;

function isCitationReferenceNode(node: Node): boolean {
  return (
    (node.type === "linkReference" ||
      node.type === "imageReference" ||
      node.type === "definition") &&
    CITATION_IDENTIFIER.test(node.identifier || "")
  );
}

/*
 * The text a reader would see, with citation references shown the way they
 * read once reverted. The transform must preserve this exactly.
 */
function visibleText(node: Node): string {
  if (node.type === "text") {
    return node.value || "";
  }

  if (node.type === "inlineCode" || node.type === "code") {
    return `\`${node.value || ""}\``;
  }

  if (node.type === "html") {
    return node.value || "";
  }

  if (node.type === "definition") {
    return "";
  }

  if (node.type === "break") {
    return "\n";
  }

  const suffix: string =
    node.referenceType === "collapsed"
      ? "][]"
      : node.referenceType === "full"
        ? `][${node.label || node.identifier || ""}]`
        : "]";

  if (node.type === "imageReference") {
    return isCitationReferenceNode(node)
      ? `![${node.alt || ""}${suffix}`
      : `<image ${node.alt || ""}>`;
  }

  const inner: string = (node.children || []).map(visibleText).join("");

  if (node.type === "linkReference" && isCitationReferenceNode(node)) {
    return `[${inner}${suffix}`;
  }

  return inner;
}

const customNodeText: (node: Node) => string = (node: Node): string => {
  return (node.children || [])
    .map((child: Node): string => {
      return child.value || "";
    })
    .join("");
};

afterEach(() => {
  cleanup();
  mockMarkdownState.tree = null;
  mockMarkdownState.calls = [];
});

/*
 * ---------------------------------------------------------------------------
 * applyInlineReferences: citations
 * ---------------------------------------------------------------------------
 */

describe("applyInlineReferences — citation markers", () => {
  test("splits a single citation into text + citation node + text", () => {
    expect(transformText("Pool ran dry [C12] at 18:01.")).toEqual([
      text("Pool ran dry "),
      citation("C12"),
      text(" at 18:01."),
    ]);
  });

  test("builds the exact node shape, hName and hProperties", () => {
    const [, node] = transformText("see [C7] now");

    expect(node).toStrictEqual({
      type: "oneuptimeCitationReference",
      data: {
        hName: "oneuptime-citation-ref",
        hProperties: { dataCitationId: "C7" },
      },
      children: [{ type: "text", value: "[C7]" }],
    });
  });

  test("splits several citations in one text run in order", () => {
    expect(transformText("A [C1], B [C22] and C [C333].")).toEqual([
      text("A "),
      citation("C1"),
      text(", B "),
      citation("C22"),
      text(" and C "),
      citation("C333"),
      text("."),
    ]);
  });

  test("adjacent markers [C4][C5] become two back-to-back nodes with no empty text", () => {
    const children: Array<Node> = transformText("dry [C4][C5].");

    expect(children).toEqual([
      text("dry "),
      citation("C4"),
      citation("C5"),
      text("."),
    ]);
    expect(
      children.some((child: Node): boolean => {
        return child.type === "text" && child.value === "";
      }),
    ).toBe(false);
  });

  test("a marker that is the whole text run leaves no empty text around it", () => {
    expect(transformText("[C3]")).toEqual([citation("C3")]);
  });

  test.each([
    ["[C1234]"],
    ["[c12]"],
    ["[C]"],
    ["[ C1 ]"],
    ["C12"],
    ["[CC1]"],
    ["[C1a]"],
    ["[C-1]"],
  ])("leaves the non-citation %p as untouched text", (value: string) => {
    const original: Node = text(`before ${value} after`);
    const children: Array<Node> = transformParagraph([original], {
      citations: true,
      eventReferences: false,
    });

    expect(children).toHaveLength(1);
    // Untouched nodes are kept by identity (positions and all).
    expect(children[0]).toBe(original);
  });

  test("splits citations inside strong, emphasis, delete, headings, list items, table cells and blockquotes", () => {
    const tree: Node = root(
      paragraph({ type: "strong", children: [text("[C1]")] }),
      paragraph({ type: "emphasis", children: [text("x [C2]")] }),
      paragraph({ type: "delete", children: [text("[C3] y")] }),
      { type: "heading", depth: 3, children: [text("Why [C4]")] },
      {
        type: "list",
        children: [{ type: "listItem", children: [paragraph(text("- [C5]"))] }],
      },
      {
        type: "table",
        children: [
          {
            type: "tableRow",
            children: [{ type: "tableCell", children: [text("[C6]")] }],
          },
        ],
      },
      { type: "blockquote", children: [paragraph(text("q [C7]"))] },
    );

    applyInlineReferences(tree, BOTH);

    const ids: Array<string> = collectNodes(tree, (node: Node): boolean => {
      return node.type === CITATION_REFERENCE_NODE_TYPE;
    }).map((node: Node): string => {
      return node.data?.hProperties?.["dataCitationId"] || "";
    });

    expect(ids).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7"]);
  });

  test("the server's evidence list bullet **[C11]** becomes a citation inside strong", () => {
    const tree: Node = root({
      type: "list",
      children: [
        {
          type: "listItem",
          children: [
            paragraph(
              { type: "strong", children: [text("[C11]")] },
              text(" Logs search — 3 row(s)"),
            ),
          ],
        },
      ],
    });

    applyInlineReferences(tree, BOTH);

    const strong: Node | undefined =
      tree.children?.[0]?.children?.[0]?.children?.[0]?.children?.[0];
    expect(strong?.children).toEqual([citation("C11")]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * applyInlineReferences: incident / alert numbers
 * ---------------------------------------------------------------------------
 */

describe("applyInlineReferences — incident and alert numbers", () => {
  test("splits a bare #number with an empty kind", () => {
    expect(transformText("Same as #6954 last week.")).toEqual([
      text("Same as "),
      eventRef("", 6954),
      text(" last week."),
    ]);
  });

  test("builds the exact node shape, hName and hProperties", () => {
    const [, node] = transformText("incident #42 again");

    expect(node).toStrictEqual({
      type: "oneuptimeEventReference",
      data: {
        hName: "oneuptime-event-ref",
        hProperties: { dataRefKind: "incident", dataRefNumber: "42" },
      },
      children: [{ type: "text", value: "#42" }],
    });
  });

  test("an 'alert' qualifier sets the alert kind, case-insensitively", () => {
    expect(transformText("Alert #12 fired")).toEqual([
      text("Alert "),
      eventRef("alert", 12),
      text(" fired"),
    ]);
  });

  test("a plural qualifier carries across a comma / and separated list", () => {
    expect(transformText("prior: incidents #1, #2 and #3.")).toEqual([
      text("prior: incidents "),
      eventRef("incident", 1),
      text(", "),
      eventRef("incident", 2),
      text(" and "),
      eventRef("incident", 3),
      text("."),
    ]);
  });

  test("mixes citations and references in document order", () => {
    expect(
      transformText("Pool dry [C4]; same as incident #1234 and #77 [C5]."),
    ).toEqual([
      text("Pool dry "),
      citation("C4"),
      text("; same as incident "),
      eventRef("incident", 1234),
      text(" and "),
      eventRef("incident", 77),
      text(" "),
      citation("C5"),
      text("."),
    ]);
  });

  test.each([
    ["abc#12"],
    ["&#123;"],
    ["https://x/#12"],
    ["##12"],
    ["#12abc"],
    ["#1234567890"],
    ["#"],
    ["# 12"],
  ])("does not treat %p as a reference", (value: string) => {
    const original: Node = text(value);
    const children: Array<Node> = transformParagraph([original], {
      citations: false,
      eventReferences: true,
    });

    expect(children).toEqual([original]);
  });

  test("a bracketed [#12] (never a link without a definition) keeps its brackets as text", () => {
    expect(transformText("see [#12]")).toEqual([
      text("see ["),
      eventRef("", 12),
      text("]"),
    ]);
  });

  /*
   * An empty kind means "the subject's kind" to the panel, so a qualifier
   * lost to punctuation would link "alerts: #100" to incident #100.
   */
  test("a qualifier followed by a colon or parenthesis still sets the kind of the whole list", () => {
    expect(transformText("Related alerts: #100, #101")).toEqual([
      text("Related alerts: "),
      eventRef("alert", 100),
      text(", "),
      eventRef("alert", 101),
    ]);
    expect(transformText("a similar incident (#12)")).toEqual([
      text("a similar incident ("),
      eventRef("incident", 12),
      text(")"),
    ]);
  });

  test.each([
    ["Scheduled maintenance #42 overlapped"],
    ["incident episode #3"],
    ["PRs #45, #46 and #47"],
    ["step #1 of the runbook"],
  ])(
    "leaves a number from another numbering in %p as plain text",
    (value: string) => {
      const original: Node = text(value);

      expect(transformParagraph([original], BOTH)).toEqual([original]);
    },
  );

  test("a number from another numbering does not stop a real reference beside it", () => {
    expect(transformText("PR #45 reverted incident #46")).toEqual([
      text("PR #45 reverted incident "),
      eventRef("incident", 46),
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * applyInlineReferences: what is never touched
 * ---------------------------------------------------------------------------
 */

describe("applyInlineReferences — opaque content", () => {
  test("never splits text inside a link", () => {
    const link: Node = {
      type: "link",
      url: "https://evil.example/#12",
      children: [text("[C1] incident #12")],
    };
    const snapshot: Node = cloneTree(link);

    const children: Array<Node> = transformParagraph([
      text("go "),
      link,
      text(" [C2]"),
    ]);

    expect(children).toEqual([
      text("go "),
      snapshot,
      text(" "),
      citation("C2"),
    ]);
  });

  test("never splits text inside a non-citation link reference", () => {
    const reference: Node = linkReference("docs", [text("[C1] #12")]);
    const snapshot: Node = cloneTree(reference);

    expect(transformParagraph([reference])).toEqual([snapshot]);
  });

  test("never touches inline code, code blocks or html", () => {
    const tree: Node = root(
      paragraph({ type: "inlineCode", value: "[C1] #12" }),
      { type: "code", lang: "text", value: "[C1]\nincident #12" },
      { type: "html", value: "<b>[C1] #12</b>" },
    );
    const snapshot: Node = cloneTree(tree);

    applyInlineReferences(tree, BOTH);

    expect(tree).toEqual(snapshot);
  });

  test("does not split the text of nested link content inside emphasis inside a link", () => {
    const tree: Node = root(
      paragraph({
        type: "link",
        url: "https://example.com",
        children: [{ type: "emphasis", children: [text("[C9] #9")] }],
      }),
    );
    const snapshot: Node = cloneTree(tree);

    applyInlineReferences(tree, BOTH);

    expect(tree).toEqual(snapshot);
  });

  test("leaves the tree untouched when both transforms are off", () => {
    const tree: Node = root(
      { type: "definition", identifier: "c1", url: "https://evil.example" },
      paragraph(text("[C1] #12 "), linkReference("c1", [text("C1")])),
    );
    const snapshot: Node = cloneTree(tree);

    applyInlineReferences(tree, { citations: false, eventReferences: false });

    expect(tree).toEqual(snapshot);
  });

  test("citations off: markers stay text and citation link references are not reverted", () => {
    const reference: Node = linkReference("c1", [text("C1")]);
    const children: Array<Node> = transformParagraph(
      [text("[C2] incident #5 "), reference],
      { citations: false, eventReferences: true },
    );

    expect(children).toEqual([
      text("[C2] incident "),
      eventRef("incident", 5),
      text(" "),
      reference,
    ]);
  });

  test("event references off: numbers stay text", () => {
    expect(
      transformText("[C2] incident #5", {
        citations: true,
        eventReferences: false,
      }),
    ).toEqual([citation("C2"), text(" incident #5")]);
  });

  test("is idempotent — a second pass changes nothing", () => {
    const tree: Node = root(
      paragraph(
        text("dry [C4][C5], incidents #1 and #2 "),
        linkReference("c7", [text("C7")]),
      ),
    );

    applyInlineReferences(tree, BOTH);
    const once: Node = cloneTree(tree);
    applyInlineReferences(tree, BOTH);

    expect(tree).toEqual(once);
  });

  test("tolerates empty, value-less and childless nodes", () => {
    const tree: Node = root(
      paragraph(text(""), { type: "text" }, { type: "break" }),
      { type: "paragraph" },
      { type: "thematicBreak" },
    );

    expect(() => {
      applyInlineReferences(tree, BOTH);
    }).not.toThrow();
    expect(collectNodes(tree, isCustomReferenceNode)).toHaveLength(0);
  });

  test("tolerates a missing tree", () => {
    expect(() => {
      applyInlineReferences(undefined as unknown as Node, BOTH);
      applyInlineReferences(null as unknown as Node, BOTH);
    }).not.toThrow();
  });
});

/*
 * ---------------------------------------------------------------------------
 * applyInlineReferences: citation link references and definitions
 * ---------------------------------------------------------------------------
 */

describe("applyInlineReferences — a citation can never become a link", () => {
  test("reverts a shortcut [C12] link reference to text and splits it", () => {
    const tree: Node = root(
      paragraph(
        text("See "),
        linkReference("c12", [text("C12")]),
        text(" now"),
      ),
      { type: "definition", identifier: "c12", url: "https://evil.example" },
    );

    applyInlineReferences(tree, BOTH);

    expect(tree).toEqual(
      root(paragraph(text("See "), citation("C12"), text(" now"))),
    );
  });

  test("drops citation definitions anywhere, keeps other definitions", () => {
    const keep: Node = {
      type: "definition",
      identifier: "docs",
      url: "https://docs.example",
    };
    const tree: Node = root(
      { type: "definition", identifier: "C3", url: "https://a.example" },
      keep,
      {
        type: "blockquote",
        children: [
          { type: "definition", identifier: "c999", url: "https://b.example" },
          paragraph(text("quoted")),
        ],
      },
      {
        type: "list",
        children: [
          {
            type: "listItem",
            children: [
              {
                type: "definition",
                identifier: "c1",
                url: "https://c.example",
              },
            ],
          },
        ],
      },
    );

    applyInlineReferences(tree, BOTH);

    expect(collectNodes(tree, isCitationReferenceNode)).toHaveLength(0);
    expect(tree.children?.[0]).toBe(keep);
    expect(countType(tree, "definition")).toBe(1);
  });

  test("does not drop definitions for identifiers that only look similar", () => {
    const tree: Node = root(
      { type: "definition", identifier: "c1234", url: "https://a.example" },
      { type: "definition", identifier: "cc1", url: "https://b.example" },
      { type: "definition", identifier: "c", url: "https://c.example" },
    );

    applyInlineReferences(tree, BOTH);

    expect(countType(tree, "definition")).toBe(3);
  });

  test("reverts a collapsed [C12][] reference", () => {
    expect(
      transformParagraph([linkReference("c12", [text("C12")], "collapsed")]),
    ).toEqual([citation("C12"), text("[]")]);
  });

  test("reverts a full [evidence][C3] reference", () => {
    expect(
      transformParagraph([
        text("the "),
        linkReference("c3", [text("evidence")], "full", "C3"),
      ]),
    ).toEqual([text("the [evidence]"), citation("C3")]);
  });

  test("reverts a citation image reference ![C2] to text", () => {
    expect(
      transformParagraph([
        text("look "),
        {
          type: "imageReference",
          identifier: "c2",
          label: "C2",
          referenceType: "shortcut",
          alt: "C2",
        },
      ]),
    ).toEqual([text("look !"), citation("C2")]);
  });

  test("keeps the formatted children of a reverted reference and still splits inside them", () => {
    expect(
      transformParagraph([
        linkReference(
          "c4",
          [{ type: "emphasis", children: [text("see #88")] }],
          "full",
          "C4",
        ),
      ]),
    ).toEqual([
      text("["),
      { type: "emphasis", children: [text("see "), eventRef("", 88)] },
      text("]"),
      citation("C4"),
    ]);
  });

  test("reverts citation link references nested in strong inside a list item", () => {
    const tree: Node = root({
      type: "list",
      children: [
        {
          type: "listItem",
          children: [
            paragraph({
              type: "strong",
              children: [linkReference("c11", [text("C11")])],
            }),
          ],
        },
      ],
    });

    applyInlineReferences(tree, BOTH);

    expect(countType(tree, "linkReference")).toBe(0);
    expect(
      collectNodes(tree, (node: Node): boolean => {
        return node.type === "strong";
      })[0]?.children,
    ).toEqual([citation("C11")]);
  });

  test("reverts a citation reference hoisted out of another citation reference", () => {
    /*
     * The parser never nests references, but the transform must not rely on
     * that: the inner reference is examined after the outer one is reverted.
     */
    const tree: Node = root(
      paragraph(
        text("a "),
        linkReference(
          "c18",
          [
            { type: "break" },
            linkReference("c4", [text("C4")], "full", "C4"),
            text(" b"),
          ],
          "full",
          "C18",
        ),
      ),
    );

    applyInlineReferences(tree, { citations: true, eventReferences: false });

    expect(countType(tree, "linkReference")).toBe(0);
    // "[C4][C4]" is how a full [C4][C4] reference reads once reverted.
    expect(tree.children?.[0]?.children).toEqual([
      text("a ["),
      { type: "break" },
      citation("C4"),
      citation("C4"),
      text(" b]"),
      citation("C18"),
    ]);
  });

  test("merges a reverted run into one text node spanning the original positions", () => {
    const start: { line: number; column: number; offset: number } = {
      line: 1,
      column: 1,
      offset: 0,
    };
    const middle: { line: number; column: number; offset: number } = {
      line: 1,
      column: 3,
      offset: 2,
    };
    const end: { line: number; column: number; offset: number } = {
      line: 1,
      column: 9,
      offset: 8,
    };
    const untouchedReference: Node = linkReference("docs", [text("docs")]);
    const tree: Node = root(
      paragraph(
        { type: "text", value: "a ", position: { start: start, end: middle } },
        untouchedReference,
        { type: "text", value: " b", position: { start: middle, end: end } },
      ),
      /*
       * "[c1]" — lowercase, so the reverted text is not a citation marker and
       * the merged node survives unsplit.
       */
      paragraph(
        { type: "text", value: "x ", position: { start: start, end: middle } },
        linkReference("c1", [text("c1")], "shortcut", "c1"),
        { type: "text", value: " y", position: { start: middle, end: end } },
      ),
      paragraph(
        text("no positions "),
        linkReference("c2", [text("c2")], "shortcut", "c2"),
      ),
    );

    applyInlineReferences(tree, { citations: true, eventReferences: false });

    // No citation reference in the first paragraph: nothing merged, identity kept.
    expect(tree.children?.[0]?.children).toHaveLength(3);
    expect(tree.children?.[0]?.children?.[1]).toBe(untouchedReference);

    expect(tree.children?.[1]?.children).toStrictEqual([
      { type: "text", value: "x [c1] y", position: { start: start, end: end } },
    ]);

    expect(tree.children?.[2]?.children).toStrictEqual([
      { type: "text", value: "no positions [c2]" },
    ]);
  });

  test("a reverted marker merged with its surrounding text is split back out", () => {
    expect(
      transformParagraph(
        [text("x "), linkReference("c1", [text("C1")]), text(" y")],
        { citations: true, eventReferences: false },
      ),
    ).toEqual([text("x "), citation("C1"), text(" y")]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * applyInlineReferences: invariants over many generated trees
 * ---------------------------------------------------------------------------
 */

describe("applyInlineReferences — generated trees", () => {
  // Small deterministic PRNG so a failure is reproducible from its seed.
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

  const FRAGMENTS: Array<string> = [
    "[C1]",
    "[C12]",
    "[C999]",
    "[C1000]",
    "[c3]",
    "[C4][C5]",
    "#1",
    "#6954",
    "#123456789",
    "#1234567890",
    "incident ",
    "incidents ",
    "alert ",
    "Alerts ",
    ", ",
    " and ",
    "abc",
    "abc#12",
    "&#123;",
    "/#5",
    "##7",
    "#8abc",
    "[",
    "]",
    "C",
    "#",
    " ",
    "\n",
    "—",
    "é",
    "[#12]",
    "(see [C2])",
    "javascript:alert(1)",
    "![x](https://evil.example/p.png)",
  ];

  type Random = () => number;

  const pick: <T>(random: Random, items: Array<T>) => T = <T,>(
    random: Random,
    items: Array<T>,
  ): T => {
    return items[Math.floor(random() * items.length)] as T;
  };

  const randomText: (random: Random) => string = (random: Random): string => {
    let value: string = "";
    const count: number = 1 + Math.floor(random() * 6);
    for (let index: number = 0; index < count; index++) {
      value += pick(random, FRAGMENTS);
    }
    return value;
  };

  const randomInline: (random: Random, depth: number) => Node = (
    random: Random,
    depth: number,
  ): Node => {
    const roll: number = random();
    const nested: () => Array<Node> = (): Array<Node> => {
      const children: Array<Node> = [];
      const count: number = 1 + Math.floor(random() * 3);
      for (let index: number = 0; index < count; index++) {
        children.push(randomInline(random, depth + 1));
      }
      return children;
    };

    if (depth > 2 || roll < 0.35) {
      return text(randomText(random));
    }
    if (roll < 0.45) {
      return {
        type: pick(random, ["strong", "emphasis", "delete"]),
        children: nested(),
      };
    }
    if (roll < 0.55) {
      return {
        type: "link",
        url: "https://evil.example/#12",
        children: [text(randomText(random))],
      };
    }
    if (roll < 0.65) {
      const id: number = 1 + Math.floor(random() * 20);
      return linkReference(
        `c${id}`,
        random() < 0.5 ? [text(`C${id}`)] : nested(),
        pick(random, ["shortcut", "collapsed", "full"] as Array<
          "shortcut" | "collapsed" | "full"
        >),
        `C${id}`,
      );
    }
    if (roll < 0.72) {
      return linkReference("docs", [text(randomText(random))]);
    }
    if (roll < 0.78) {
      return {
        type: "imageReference",
        identifier: random() < 0.5 ? "c2" : "logo",
        label: "C2",
        referenceType: "shortcut",
        alt: randomText(random),
      };
    }
    if (roll < 0.84) {
      return { type: "image", url: "https://evil.example/p.png", alt: "x" };
    }
    if (roll < 0.9) {
      return { type: "inlineCode", value: randomText(random) };
    }
    if (roll < 0.95) {
      return { type: "html", value: `<b>${randomText(random)}</b>` };
    }
    return { type: "break" };
  };

  const randomTree: (random: Random) => Node = (random: Random): Node => {
    const blocks: Array<Node> = [];
    const count: number = 1 + Math.floor(random() * 5);

    for (let index: number = 0; index < count; index++) {
      const inlines: Array<Node> = [];
      const inlineCount: number = 1 + Math.floor(random() * 4);
      for (let inline: number = 0; inline < inlineCount; inline++) {
        inlines.push(randomInline(random, 0));
      }

      const roll: number = random();
      if (roll < 0.5) {
        blocks.push(paragraph(...inlines));
      } else if (roll < 0.6) {
        blocks.push({ type: "heading", depth: 2, children: inlines });
      } else if (roll < 0.75) {
        blocks.push({
          type: "list",
          children: [{ type: "listItem", children: [paragraph(...inlines)] }],
        });
      } else if (roll < 0.85) {
        blocks.push({ type: "blockquote", children: [paragraph(...inlines)] });
      } else if (roll < 0.92) {
        blocks.push({
          type: "definition",
          identifier:
            random() < 0.7 ? `c${1 + Math.floor(random() * 20)}` : "docs",
          url: "https://evil.example",
        });
      } else {
        blocks.push({ type: "code", value: randomText(random) });
      }
    }

    return root(...blocks);
  };

  const OPAQUE: Set<string> = new Set<string>([
    "link",
    "linkReference",
    "image",
    "imageReference",
    "inlineCode",
    "code",
    "html",
  ]);

  const findCustomNodesInsideOpaque: (
    node: Node,
    insideOpaque: boolean,
  ) => Array<Node> = (node: Node, insideOpaque: boolean): Array<Node> => {
    const found: Array<Node> =
      insideOpaque && isCustomReferenceNode(node) ? [node] : [];
    const childInsideOpaque: boolean = insideOpaque || OPAQUE.has(node.type);
    for (const child of node.children || []) {
      found.push(...findCustomNodesInsideOpaque(child, childInsideOpaque));
    }
    return found;
  };

  test("never creates links or images, never leaves a citation link, and preserves the visible text", () => {
    const random: Random = createRandom(20260914);

    for (let iteration: number = 0; iteration < 400; iteration++) {
      const tree: Node = randomTree(random);
      const before: Node = cloneTree(tree);

      applyInlineReferences(tree, BOTH);

      const context: string = `iteration ${iteration}: ${JSON.stringify(before)}`;

      // Never creates link or image nodes.
      expect({ context, count: countType(tree, "link") }).toEqual({
        context,
        count: countType(before, "link"),
      });
      expect({ context, count: countType(tree, "image") }).toEqual({
        context,
        count: countType(before, "image"),
      });

      // No citation link reference, image reference or definition survives.
      expect({
        context,
        left: collectNodes(tree, isCitationReferenceNode),
      }).toEqual({
        context,
        left: [],
      });

      // Other references and definitions are left alone.
      const nonCitation: (candidate: Node) => boolean = (
        candidate: Node,
      ): boolean => {
        return (
          ["linkReference", "imageReference", "definition"].includes(
            candidate.type,
          ) && !isCitationReferenceNode(candidate)
        );
      };
      expect({
        context,
        count: collectNodes(tree, nonCitation).length,
      }).toEqual({
        context,
        count: collectNodes(before, nonCitation).length,
      });

      // Nothing a reader sees is added, lost or reordered.
      expect({ context, text: visibleText(tree) }).toEqual({
        context,
        text: visibleText(before),
      });

      // Custom nodes never sit inside links, references or code.
      expect({
        context,
        nested: findCustomNodesInsideOpaque(tree, false),
      }).toEqual({
        context,
        nested: [],
      });

      // Every custom node carries only a validated token.
      for (const node of collectNodes(tree, isCustomReferenceNode)) {
        const value: string = customNodeText(node);
        expect(node.children).toHaveLength(1);

        if (node.type === CITATION_REFERENCE_NODE_TYPE) {
          expect(node.data?.hName).toBe(CITATION_REFERENCE_TAG_NAME);
          expect(value).toMatch(/^\[C\d{1,3}\]$/);
          expect(node.data?.hProperties).toEqual({
            dataCitationId: value.slice(1, -1),
          });
        } else {
          expect(node.data?.hName).toBe(EVENT_REFERENCE_TAG_NAME);
          expect(value).toMatch(/^#\d{1,9}$/);
          expect(Object.keys(node.data?.hProperties || {}).sort()).toEqual([
            "dataRefKind",
            "dataRefNumber",
          ]);
          expect(["", "incident", "alert"]).toContain(
            node.data?.hProperties?.["dataRefKind"],
          );
          expect(node.data?.hProperties?.["dataRefNumber"]).toBe(
            String(parseInt(value.slice(1), 10)),
          );
        }
      }
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * remarkInlineReferences
 * ---------------------------------------------------------------------------
 */

describe("remarkInlineReferences", () => {
  test("returns a transformer that applies both passes by default", () => {
    const tree: Node = root(paragraph(text("[C1] and #2")));

    remarkInlineReferences()(tree);

    expect(tree.children?.[0]?.children).toEqual([
      citation("C1"),
      text(" and "),
      eventRef("", 2),
    ]);
  });

  test("honours disabled passes", () => {
    const citationsOnly: Node = root(paragraph(text("[C1] and #2")));
    remarkInlineReferences({ eventReferences: false })(citationsOnly);
    expect(citationsOnly.children?.[0]?.children).toEqual([
      citation("C1"),
      text(" and #2"),
    ]);

    const referencesOnly: Node = root(paragraph(text("[C1] and #2")));
    remarkInlineReferences({ citations: false })(referencesOnly);
    expect(referencesOnly.children?.[0]?.children).toEqual([
      text("[C1] and "),
      eventRef("", 2),
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Reference elements
 * ---------------------------------------------------------------------------
 */

const Chip: React.FunctionComponent<{ id: string }> = (props: {
  id: string;
}): ReactElement => {
  return (
    <button type="button" data-testid="chip">
      chip:{props.id}
    </button>
  );
};

describe("MarkdownCitationReferenceElement", () => {
  test("renders what renderCitation returns for the citation id", () => {
    const renderCitation: MockFunction = getJestMockFunction();
    renderCitation.mockImplementation((citationId: unknown) => {
      return <Chip id={String(citationId)} />;
    });

    render(
      <p>
        <MarkdownInlineReferenceContext.Provider
          value={{
            renderCitation: renderCitation as unknown as (
              citationId: string,
            ) => ReactElement | null,
          }}
        >
          before{" "}
          <MarkdownCitationReferenceElement data-citation-id="C12">
            [C12]
          </MarkdownCitationReferenceElement>{" "}
          after
        </MarkdownInlineReferenceContext.Provider>
      </p>,
    );

    expect(renderCitation).toHaveBeenCalledWith("C12");
    expect(screen.getByTestId("chip")).toHaveTextContent("chip:C12");
    expect(screen.queryByText("[C12]")).toBeNull();
  });

  test("falls back to the plain marker when renderCitation returns null", () => {
    const { container } = render(
      <p>
        <MarkdownInlineReferenceContext.Provider
          value={{
            renderCitation: (): ReactElement | null => {
              return null;
            },
          }}
        >
          <MarkdownCitationReferenceElement data-citation-id="C5">
            [C5]
          </MarkdownCitationReferenceElement>
        </MarkdownInlineReferenceContext.Provider>
      </p>,
    );

    expect(container.innerHTML).toBe("<p>[C5]</p>");
  });

  test("falls back to plain text without a provider", () => {
    const { container } = render(
      <p>
        <MarkdownCitationReferenceElement data-citation-id="C5">
          [C5]
        </MarkdownCitationReferenceElement>
      </p>,
    );

    expect(container.innerHTML).toBe("<p>[C5]</p>");
  });

  test("falls back to plain text when the provider has no renderCitation", () => {
    const renderEventReference: MockFunction = getJestMockFunction();
    const { container } = render(
      <MarkdownInlineReferenceContext.Provider
        value={{
          renderEventReference: renderEventReference as unknown as (
            reference: MarkdownEventReference,
          ) => ReactElement | null,
        }}
      >
        <MarkdownCitationReferenceElement data-citation-id="C5">
          [C5]
        </MarkdownCitationReferenceElement>
      </MarkdownInlineReferenceContext.Provider>,
    );

    expect(container.textContent).toBe("[C5]");
    expect(renderEventReference).not.toHaveBeenCalled();
  });

  test.each([["javascript:alert(1)"], ["C1234"], ["c12"], [""], ["C1 "]])(
    "never calls renderCitation for the malformed id %p",
    (citationId: string) => {
      const renderCitation: MockFunction = getJestMockFunction();
      const { container } = render(
        <MarkdownInlineReferenceContext.Provider
          value={{
            renderCitation: renderCitation as unknown as (
              citationId: string,
            ) => ReactElement | null,
          }}
        >
          <MarkdownCitationReferenceElement data-citation-id={citationId}>
            literal
          </MarkdownCitationReferenceElement>
        </MarkdownInlineReferenceContext.Provider>,
      );

      expect(renderCitation).not.toHaveBeenCalled();
      expect(container.textContent).toBe("literal");
    },
  );

  test("renders the marker text when there are no children", () => {
    const { container } = render(
      <MarkdownCitationReferenceElement data-citation-id="C8" />,
    );

    expect(container.textContent).toBe("[C8]");
  });
});

describe("MarkdownEventReferenceElement", () => {
  const renderWith: (
    renderEventReference:
      | ((reference: MarkdownEventReference) => ReactElement | null)
      | undefined,
    element: ReactElement,
  ) => HTMLElement = (
    renderEventReference:
      | ((reference: MarkdownEventReference) => ReactElement | null)
      | undefined,
    element: ReactElement,
  ): HTMLElement => {
    return render(
      <MarkdownInlineReferenceContext.Provider
        value={{ renderEventReference: renderEventReference }}
      >
        {element}
      </MarkdownInlineReferenceContext.Provider>,
    ).container;
  };

  test("passes kind, number and the text as written to renderEventReference", () => {
    const received: Array<MarkdownEventReference> = [];

    renderWith(
      (reference: MarkdownEventReference): ReactElement => {
        received.push(reference);
        return <span data-testid="reference-link">{reference.text}</span>;
      },
      <MarkdownEventReferenceElement
        data-ref-kind="incident"
        data-ref-number="6954"
      >
        #6954
      </MarkdownEventReferenceElement>,
    );

    expect(received).toEqual([
      { kind: "incident", number: 6954, text: "#6954" },
    ]);
    expect(screen.getByTestId("reference-link")).toHaveTextContent("#6954");
  });

  test("an alert kind is passed through", () => {
    const received: Array<MarkdownEventReference> = [];

    renderWith(
      (reference: MarkdownEventReference): ReactElement | null => {
        received.push(reference);
        return null;
      },
      <MarkdownEventReferenceElement data-ref-kind="alert" data-ref-number="7">
        #7
      </MarkdownEventReferenceElement>,
    );

    expect(received).toEqual([{ kind: "alert", number: 7, text: "#7" }]);
  });

  test.each([[""], ["problem"], ["Incident"], [undefined]])(
    "an unknown kind %p becomes null",
    (kind: string | undefined) => {
      const received: Array<MarkdownEventReference> = [];

      renderWith(
        (reference: MarkdownEventReference): ReactElement | null => {
          received.push(reference);
          return null;
        },
        <MarkdownEventReferenceElement
          data-ref-kind={kind}
          data-ref-number="12"
        >
          #12
        </MarkdownEventReferenceElement>,
      );

      expect(received).toEqual([{ kind: null, number: 12, text: "#12" }]);
    },
  );

  test("keeps leading zeros in the text but parses the number", () => {
    const received: Array<MarkdownEventReference> = [];

    renderWith(
      (reference: MarkdownEventReference): ReactElement | null => {
        received.push(reference);
        return null;
      },
      <MarkdownEventReferenceElement data-ref-kind="" data-ref-number="7">
        #007
      </MarkdownEventReferenceElement>,
    );

    expect(received).toEqual([{ kind: null, number: 7, text: "#007" }]);
  });

  test.each([["12a"], [""], ["1234567890"], ["-1"], ["1.5"]])(
    "never calls renderEventReference for the malformed number %p",
    (referenceNumber: string) => {
      const renderEventReference: MockFunction = getJestMockFunction();

      const container: HTMLElement = renderWith(
        renderEventReference as unknown as (
          reference: MarkdownEventReference,
        ) => ReactElement | null,
        <MarkdownEventReferenceElement
          data-ref-kind="incident"
          data-ref-number={referenceNumber}
        >
          #literal
        </MarkdownEventReferenceElement>,
      );

      expect(renderEventReference).not.toHaveBeenCalled();
      expect(container.textContent).toBe("#literal");
    },
  );

  test("falls back to plain text when the callback returns null, is missing, or there is no provider", () => {
    const nullCallback: HTMLElement = renderWith(
      (): ReactElement | null => {
        return null;
      },
      <MarkdownEventReferenceElement
        data-ref-kind="incident"
        data-ref-number="1"
      >
        #1
      </MarkdownEventReferenceElement>,
    );
    expect(nullCallback.innerHTML).toBe("#1");
    cleanup();

    const missingCallback: HTMLElement = renderWith(
      undefined,
      <MarkdownEventReferenceElement
        data-ref-kind="incident"
        data-ref-number="2"
      >
        #2
      </MarkdownEventReferenceElement>,
    );
    expect(missingCallback.innerHTML).toBe("#2");
    cleanup();

    const { container } = render(
      <MarkdownEventReferenceElement
        data-ref-kind="incident"
        data-ref-number="3"
      >
        #3
      </MarkdownEventReferenceElement>,
    );
    expect(container.innerHTML).toBe("#3");
  });

  test("renders #number when there are no children", () => {
    const received: Array<MarkdownEventReference> = [];

    const container: HTMLElement = renderWith(
      (reference: MarkdownEventReference): ReactElement | null => {
        received.push(reference);
        return null;
      },
      <MarkdownEventReferenceElement
        data-ref-kind="alert"
        data-ref-number={42}
      />,
    );

    expect(received).toEqual([{ kind: "alert", number: 42, text: "#42" }]);
    expect(container.textContent).toBe("#42");
  });
});

describe("inline reference components map", () => {
  test("maps exactly the two custom tag names to the module-scope elements", () => {
    expect(Object.keys(MARKDOWN_INLINE_REFERENCE_COMPONENTS).sort()).toEqual([
      "oneuptime-citation-ref",
      "oneuptime-event-ref",
    ]);
    expect(
      MARKDOWN_INLINE_REFERENCE_COMPONENTS[CITATION_REFERENCE_TAG_NAME],
    ).toBe(MarkdownCitationReferenceElement);
    expect(MARKDOWN_INLINE_REFERENCE_COMPONENTS[EVENT_REFERENCE_TAG_NAME]).toBe(
      MarkdownEventReferenceElement,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * MarkdownViewer wiring
 * ---------------------------------------------------------------------------
 */

const EXISTING_COMPONENT_KEYS: Array<string> = [
  "a",
  "blockquote",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

function lastMarkdownProps(): MockReactMarkdownProps {
  const props: MockReactMarkdownProps | undefined =
    mockMarkdownState.calls[mockMarkdownState.calls.length - 1];
  if (!props) {
    throw new Error("react-markdown was not rendered");
  }
  return props;
}

const INCIDENT_REPORT_TREE: Node = root(
  paragraph(
    { type: "strong", children: [text("Summary")] },
    text(" — pool ran dry [C4][C5], same as incident #6954 and "),
    {
      type: "link",
      url: "https://evil.example/#12",
      children: [text("incident #12 [C4]")],
    },
    text(". Unknown [C99]."),
  ),
);

const renderers: () => MarkdownInlineReferenceRenderers =
  (): MarkdownInlineReferenceRenderers => {
    return {
      renderCitation: (citationId: string): ReactElement | null => {
        if (citationId === "C99") {
          return null;
        }
        return (
          <button type="button" aria-label={`Citation ${citationId}`}>
            {citationId}
          </button>
        );
      },
      renderEventReference: (
        reference: MarkdownEventReference,
      ): ReactElement | null => {
        return (
          <span
            data-testid="event-reference"
            data-kind={reference.kind ?? "none"}
            data-number={reference.number}
          >
            {reference.text}
          </span>
        );
      },
    };
  };

describe("MarkdownViewer inlineReferences wiring", () => {
  beforeEach(() => {
    mockMarkdownState.calls = [];
  });

  test("without inlineReferences: only remark-gfm, the existing components, today's DOM", () => {
    const { container } = render(
      <MarkdownViewer text="Same as #6954 [C1]" safeMode={true} />,
    );

    const props: MockReactMarkdownProps = lastMarkdownProps();
    expect(props.remarkPlugins).toEqual([remarkGfm]);
    expect(props.remarkPlugins?.[0]).toBe(remarkGfm);
    expect(Object.keys(props.components || {}).sort()).toEqual(
      EXISTING_COMPONENT_KEYS,
    );
    expect(container.innerHTML).toBe(
      '<div class="max-w-none"><div data-testid="react-markdown">Same as #6954 [C1]</div></div>',
    );
  });

  test("without inlineReferences a tree never gains reference elements", () => {
    mockMarkdownState.tree = INCIDENT_REPORT_TREE;
    const { container } = render(
      <MarkdownViewer text="ignored" safeMode={true} />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByTestId("event-reference")).toBeNull();
    expect(container.textContent).toContain(
      "pool ran dry [C4][C5], same as incident #6954",
    );
  });

  test("with inlineReferences: adds the plugin with both passes and registers the two elements", () => {
    render(
      <MarkdownViewer
        text="x"
        safeMode={true}
        inlineReferences={renderers()}
      />,
    );

    const props: MockReactMarkdownProps = lastMarkdownProps();
    expect(props.remarkPlugins).toHaveLength(2);
    expect(props.remarkPlugins?.[0]).toBe(remarkGfm);
    expect(props.remarkPlugins?.[1]).toEqual([
      remarkInlineReferences,
      { citations: true, eventReferences: true },
    ]);

    const components: MockComponentMap = props.components || {};
    expect(Object.keys(components).sort()).toEqual(
      [
        ...EXISTING_COMPONENT_KEYS,
        CITATION_REFERENCE_TAG_NAME,
        EVENT_REFERENCE_TAG_NAME,
      ].sort(),
    );
    expect(components[CITATION_REFERENCE_TAG_NAME]).toBe(
      MarkdownCitationReferenceElement,
    );
    expect(components[EVENT_REFERENCE_TAG_NAME]).toBe(
      MarkdownEventReferenceElement,
    );
  });

  test("renders citation chips and reference links through the real plugin, elements and context", () => {
    mockMarkdownState.tree = INCIDENT_REPORT_TREE;

    const { container } = render(
      <MarkdownViewer
        text="ignored"
        safeMode={true}
        inlineReferences={renderers()}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button: HTMLElement): string => {
        return button.getAttribute("aria-label") || "";
      }),
    ).toEqual(["Citation C4", "Citation C5"]);

    const references: Array<HTMLElement> =
      screen.getAllByTestId("event-reference");
    expect(references).toHaveLength(1);
    expect(references[0]).toHaveAttribute("data-kind", "incident");
    expect(references[0]).toHaveAttribute("data-number", "6954");

    // A citation the callback declines stays plain text.
    expect(container.textContent).toContain("Unknown [C99].");

    /*
     * The model-authored link is still neutralized by the safe `a` renderer,
     * its text is never split, and nothing interactive nests inside it.
     */
    expect(container.querySelector("a")).toBeNull();
    const neutralized: Element | null = container.querySelector(
      "span.decoration-dotted",
    );
    expect(neutralized).not.toBeNull();
    expect(neutralized?.textContent).toBe("incident #12 [C4]");
    expect(neutralized?.querySelector("button, [data-testid]")).toBeNull();
  });

  test("citations cannot be turned into links with a definition", () => {
    mockMarkdownState.tree = root(
      paragraph(text("see "), linkReference("c4", [text("C4")])),
      { type: "definition", identifier: "c4", url: "https://evil.example" },
    );

    const { container } = render(
      <MarkdownViewer
        text="ignored"
        safeMode={true}
        inlineReferences={renderers()}
      />,
    );

    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByRole("button", { name: "Citation C4" })).toBeVisible();
  });

  test("safeMode neutralization of images still applies with inlineReferences", () => {
    mockMarkdownState.tree = root(
      paragraph(text("[C4] "), {
        type: "image",
        url: "https://evil.example/p.png",
        alt: "pixel",
      }),
    );

    const { container } = render(
      <MarkdownViewer
        text="ignored"
        safeMode={true}
        inlineReferences={renderers()}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[image: pixel]");
  });

  test("new renderer callbacks flow through context without remounting the elements", () => {
    mockMarkdownState.tree = root(paragraph(text("see [C4]")));
    let mounts: number = 0;

    const CountingChip: React.FunctionComponent<{ label: string }> = (props: {
      label: string;
    }): ReactElement => {
      const [mountedLabel] = useState<string>(props.label);
      useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <button type="button" data-first-label={mountedLabel}>
          {props.label}
        </button>
      );
    };

    const makeRenderers: (label: string) => MarkdownInlineReferenceRenderers = (
      label: string,
    ): MarkdownInlineReferenceRenderers => {
      return {
        renderCitation: (citationId: string): ReactElement => {
          return <CountingChip label={`${label} ${citationId}`} />;
        },
      };
    };

    const { rerender } = render(
      <MarkdownViewer
        text="ignored"
        safeMode={true}
        inlineReferences={makeRenderers("first")}
      />,
    );

    expect(screen.getByRole("button")).toHaveTextContent("first C4");

    rerender(
      <MarkdownViewer
        text="ignored"
        safeMode={true}
        inlineReferences={makeRenderers("second")}
      />,
    );

    const button: HTMLElement = screen.getByRole("button");
    expect(button).toHaveTextContent("second C4");
    // Same instance: its first-render state survived the re-render.
    expect(button).toHaveAttribute("data-first-label", "first C4");
    expect(mounts).toBe(1);
  });

  test("the components map keeps its identity across re-renders and changes only with its options", () => {
    const { rerender } = render(<MarkdownViewer text="one" safeMode={true} />);
    rerender(<MarkdownViewer text="two" safeMode={true} />);

    const [first, second] = mockMarkdownState.calls;
    expect(second?.components).toBe(first?.components);

    rerender(<MarkdownViewer text="two" safeMode={false} />);
    const unsafe: MockComponentMap | undefined = lastMarkdownProps().components;
    expect(unsafe).not.toBe(first?.components);

    rerender(
      <MarkdownViewer
        text="two"
        safeMode={false}
        inlineReferences={renderers()}
      />,
    );
    const withReferences: MockComponentMap | undefined =
      lastMarkdownProps().components;
    expect(withReferences).not.toBe(unsafe);

    // New callback objects alone do not rebuild the map.
    rerender(
      <MarkdownViewer
        text="three"
        safeMode={false}
        inlineReferences={renderers()}
      />,
    );
    expect(lastMarkdownProps().components).toBe(withReferences);
  });

  test("safeMode still neutralizes links in the memoized map, and unsafe mode still renders them", () => {
    mockMarkdownState.tree = root(
      paragraph({
        type: "link",
        url: "https://example.com/docs",
        children: [text("docs")],
      }),
    );

    const { container, rerender } = render(
      <MarkdownViewer text="ignored" safeMode={true} />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("docs");

    rerender(<MarkdownViewer text="ignored" safeMode={false} />);
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
  });

  test("dropping inlineReferences on a re-render removes the plugin again", () => {
    mockMarkdownState.tree = root(paragraph(text("see [C4]")));

    const { rerender, container } = render(
      <MarkdownViewer
        text="ignored"
        safeMode={true}
        inlineReferences={renderers()}
      />,
    );
    expect(screen.getByRole("button")).toBeVisible();

    rerender(<MarkdownViewer text="ignored" safeMode={true} />);

    expect(lastMarkdownProps().remarkPlugins).toEqual([remarkGfm]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toBe("see [C4]");
  });

  test("LazyMarkdownViewer forwards inlineReferences to the viewer", async () => {
    mockMarkdownState.tree = root(paragraph(text("alert #9 [C1]")));

    await act(async () => {
      render(
        <LazyMarkdownViewer
          text="ignored"
          safeMode={true}
          inlineReferences={renderers()}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("react-markdown")).toBeInTheDocument();
    });

    expect(lastMarkdownProps().remarkPlugins?.[1]).toEqual([
      remarkInlineReferences,
      { citations: true, eventReferences: true },
    ]);
    expect(screen.getByRole("button", { name: "Citation C1" })).toBeVisible();
    expect(screen.getByTestId("event-reference")).toHaveAttribute(
      "data-kind",
      "alert",
    );
  });
});
