import { describe, expect, jest, test } from "@jest/globals";

/*
 * neutralizeAssistantMarkdown parses with unified/remark and serializes with
 * mdast-util-to-markdown. Those packages are ESM-only and this project's jest
 * config does not transform them, so they cannot be imported under test. We
 * therefore replace the parser and serializer with tiny stubs:
 *
 *   - `unified().use(...).parse(input)` returns `JSON.parse(input)`, letting a
 *     test hand the function an exact mdast tree instead of a markdown string.
 *     Feeding it a non-JSON string makes JSON.parse throw, which exercises the
 *     function's own parse-failure fallback.
 *   - `toMarkdown(tree)` returns `JSON.stringify(tree)`, so the string the
 *     function returns is the neutralized tree itself and assertions can read
 *     the exact nodes the real logic (neutralizeNode / inertLink /
 *     collectDefinitions / the root re-wrap) produced.
 *
 * remark-gfm is already stubbed to a no-op by the jest moduleNameMapper.
 */
jest.mock("remark-parse", () => {
  return {
    __esModule: true,
    default: (): void => {},
  };
});

jest.mock("unified", () => {
  interface MockChain {
    use: () => MockChain;
    parse: (input: string) => unknown;
  }
  const makeChain: () => MockChain = (): MockChain => {
    const chain: MockChain = {
      use: (): MockChain => {
        return chain;
      },
      parse: (input: string): unknown => {
        return JSON.parse(input);
      },
    };
    return chain;
  };
  return { __esModule: true, unified: makeChain };
});

jest.mock("mdast-util-to-markdown", () => {
  return {
    __esModule: true,
    toMarkdown: (tree: unknown): string => {
      return JSON.stringify(tree);
    },
  };
});

jest.mock("mdast-util-gfm", () => {
  return {
    __esModule: true,
    gfmToMarkdown: (): Record<string, unknown> => {
      return {};
    },
  };
});

import neutralizeAssistantMarkdown from "../../../../UI/Utils/AIChatExport/MarkdownSafety";

/*
 * A structural view of the mdast nodes the tests build and inspect. It mirrors
 * the shape the function reads and writes; JSON round-tripping drops any key
 * whose value is undefined, which is fine for these assertions.
 */
interface TreeNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  identifier?: string;
  depth?: number;
  children?: Array<TreeNode>;
}

/*
 * Serialize a tree in, parse the neutralized tree back out. The function's
 * happy path returns JSON.stringify of the tree it built (see the module
 * mocks), so this hands back the neutralized tree for structural assertions.
 */
function run(tree: TreeNode): TreeNode {
  const output: string = neutralizeAssistantMarkdown(JSON.stringify(tree));
  return JSON.parse(output) as TreeNode;
}

function root(children: Array<TreeNode>): TreeNode {
  return { type: "root", children: children };
}

function paragraph(children: Array<TreeNode>): TreeNode {
  return { type: "paragraph", children: children };
}

function text(value: string): TreeNode {
  return { type: "text", value: value };
}

// Every node type present anywhere in the tree, root first.
function collectTypes(node: TreeNode): Array<string> {
  const types: Array<string> = [node.type];
  for (const child of node.children || []) {
    types.push(...collectTypes(child));
  }
  return types;
}

// The value of every inlineCode node, in document order.
function collectInlineCode(node: TreeNode): Array<string> {
  const values: Array<string> = [];
  if (node.type === "inlineCode" && node.value !== undefined) {
    values.push(node.value);
  }
  for (const child of node.children || []) {
    values.push(...collectInlineCode(child));
  }
  return values;
}

// The value of every text node, in document order.
function collectText(node: TreeNode): Array<string> {
  const values: Array<string> = [];
  if (node.type === "text" && node.value !== undefined) {
    values.push(node.value);
  }
  for (const child of node.children || []) {
    values.push(...collectText(child));
  }
  return values;
}

describe("neutralizeAssistantMarkdown", () => {
  describe("empty input and passthrough", () => {
    test("returns an empty string for empty input without parsing", () => {
      expect(neutralizeAssistantMarkdown("")).toBe("");
    });

    test("leaves ordinary text untouched", () => {
      const result: TreeNode = run(root([paragraph([text("hello world")])]));

      expect(collectTypes(result)).toEqual(["root", "paragraph", "text"]);
      expect(collectText(result)).toEqual(["hello world"]);
    });

    test("leaves an inline code span untouched", () => {
      const result: TreeNode = run(
        root([paragraph([{ type: "inlineCode", value: "curl x" }])]),
      );

      expect(collectInlineCode(result)).toEqual(["curl x"]);
      expect(collectTypes(result)).not.toContain("link");
    });
  });

  describe("links", () => {
    test("keeps a distinct label and demotes the url to an inert code span", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            {
              type: "link",
              url: "https://evil.example/steal",
              children: [text("click here")],
            },
          ]),
        ]),
      );

      expect(collectTypes(result)).not.toContain("link");
      expect(collectInlineCode(result)).toEqual(["https://evil.example/steal"]);
      // "label (`url`)" — the label survives, then " (", the code span, ")".
      expect(collectText(result)).toEqual(["click here", " (", ")"]);
    });

    test("a url-only label (autolink) collapses to a single code span", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            {
              type: "link",
              url: "https://evil.example",
              children: [text("https://evil.example")],
            },
          ]),
        ]),
      );

      // No repeated label, no wrapping parens — just the inert url.
      expect(collectInlineCode(result)).toEqual(["https://evil.example"]);
      expect(collectText(result)).toEqual([]);
    });

    test("a link with no url keeps its distinct label as plain text", () => {
      const result: TreeNode = run(
        root([paragraph([{ type: "link", url: "", children: [text("see")] }])]),
      );

      expect(collectInlineCode(result)).toEqual([]);
      expect(collectText(result)).toEqual(["see"]);
    });

    test("a link with neither url nor label collapses to a single empty text node", () => {
      const result: TreeNode = run(
        root([paragraph([{ type: "link", url: "", children: [] }])]),
      );

      const para: TreeNode = (result.children || [])[0] as TreeNode;
      expect(para.children).toEqual([{ type: "text", value: "" }]);
    });

    test("neutralizes every link in a paragraph and keeps their order", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            {
              type: "link",
              url: "https://evil.example/a",
              children: [text("first")],
            },
            text(" and "),
            {
              type: "link",
              url: "https://evil.example/b",
              children: [text("second")],
            },
          ]),
        ]),
      );

      expect(collectInlineCode(result)).toEqual([
        "https://evil.example/a",
        "https://evil.example/b",
      ]);
      expect(collectText(result)).toEqual([
        "first",
        " (",
        ")",
        " and ",
        "second",
        " (",
        ")",
      ]);
    });

    test("preserves a rich label subtree while still neutralizing the url", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            {
              type: "link",
              url: "https://evil.example",
              children: [
                { type: "emphasis", children: [text("bold")] },
                text(" label"),
              ],
            },
          ]),
        ]),
      );

      /*
       * The distinct-label check reads the whole subtree via textOf, so the
       * emphasis node survives and the url is the only code span.
       */
      expect(collectTypes(result)).toContain("emphasis");
      expect(collectTypes(result)).not.toContain("link");
      expect(collectInlineCode(result)).toEqual(["https://evil.example"]);
      expect(collectText(result)).toContain("bold");
    });
  });

  describe("images", () => {
    test("rewrites an image into an [image: alt] label and an inert url", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            {
              type: "image",
              url: "https://evil.example/pixel.png",
              alt: "logo",
            },
          ]),
        ]),
      );

      expect(collectTypes(result)).not.toContain("image");
      expect(collectInlineCode(result)).toEqual([
        "https://evil.example/pixel.png",
      ]);
      expect(collectText(result)).toContain("[image: logo]");
    });

    test("uses an empty alt slot when the image has no alt", () => {
      const result: TreeNode = run(
        root([
          paragraph([{ type: "image", url: "https://evil.example/x.png" }]),
        ]),
      );

      expect(collectText(result)).toContain("[image: ]");
      expect(collectInlineCode(result)).toEqual(["https://evil.example/x.png"]);
    });

    test("an image with no url keeps only its [image: alt] label", () => {
      const result: TreeNode = run(
        root([paragraph([{ type: "image", url: "", alt: "logo" }])]),
      );

      expect(collectInlineCode(result)).toEqual([]);
      expect(collectText(result)).toEqual(["[image: logo]"]);
    });
  });

  describe("reference links, images and definitions", () => {
    test("resolves a link reference through its definition and drops the definition", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            {
              type: "linkReference",
              identifier: "ref",
              children: [text("click here")],
            },
          ]),
          {
            type: "definition",
            identifier: "ref",
            url: "https://evil.example/ref",
          },
        ]),
      );

      // The definition node is gone, so "[x][ref]" can no longer resolve live.
      expect(collectTypes(result)).not.toContain("definition");
      expect(collectTypes(result)).not.toContain("linkReference");
      expect(result.children).toHaveLength(1);
      expect(collectInlineCode(result)).toEqual(["https://evil.example/ref"]);
    });

    test("matches a reference to its definition case-insensitively", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            {
              type: "linkReference",
              identifier: "REF-One",
              children: [text("x")],
            },
          ]),
          {
            type: "definition",
            identifier: "ref-one",
            url: "https://evil.example/case",
          },
        ]),
      );

      expect(collectInlineCode(result)).toEqual(["https://evil.example/case"]);
    });

    test("resolves an image reference through its definition", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            { type: "imageReference", identifier: "img", alt: "logo" },
          ]),
          {
            type: "definition",
            identifier: "img",
            url: "https://evil.example/logo.png",
          },
        ]),
      );

      expect(collectTypes(result)).not.toContain("imageReference");
      expect(collectText(result)).toContain("[image: logo]");
      expect(collectInlineCode(result)).toEqual([
        "https://evil.example/logo.png",
      ]);
    });

    test("degrades a reference with no matching definition to its label text", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            {
              type: "linkReference",
              identifier: "missing",
              children: [text("foo")],
            },
          ]),
        ]),
      );

      // No definition means an empty url, so only the plain label remains.
      expect(collectInlineCode(result)).toEqual([]);
      expect(collectText(result)).toEqual(["foo"]);
    });

    test("a document that is only a definition serializes to an empty tree", () => {
      const result: TreeNode = run(
        root([
          {
            type: "definition",
            identifier: "ref",
            url: "https://evil.example",
          },
        ]),
      );

      expect(result.children).toEqual([]);
    });
  });

  describe("raw HTML", () => {
    test("demotes a root-level html node to a paragraph of inert text", () => {
      const result: TreeNode = run(
        root([
          { type: "html", value: '<img src="https://evil.example/pixel.png">' },
        ]),
      );

      expect(collectTypes(result)).toEqual(["root", "paragraph", "text"]);
      expect(collectText(result)).toEqual([
        '<img src="https://evil.example/pixel.png">',
      ]);
    });

    test("demotes an inline html node to a text node in place", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            text("before "),
            { type: "html", value: "<b>" },
            text(" after"),
          ]),
        ]),
      );

      expect(collectTypes(result)).not.toContain("html");
      expect(collectText(result)).toEqual(["before ", "<b>", " after"]);
    });
  });

  describe("tree shape and precedence", () => {
    test("rewrites a link nested in emphasis depth-first and keeps the emphasis", () => {
      const result: TreeNode = run(
        root([
          paragraph([
            {
              type: "emphasis",
              children: [
                {
                  type: "link",
                  url: "https://evil.example",
                  children: [text("click")],
                },
              ],
            },
          ]),
        ]),
      );

      const para: TreeNode = (result.children || [])[0] as TreeNode;
      const emphasis: TreeNode = (para.children || [])[0] as TreeNode;
      expect(emphasis.type).toBe("emphasis");
      expect(collectTypes(emphasis)).not.toContain("link");
      expect(collectInlineCode(emphasis)).toEqual(["https://evil.example"]);
    });

    test("neutralizes a link inside a heading and preserves the heading", () => {
      const result: TreeNode = run(
        root([
          {
            type: "heading",
            depth: 2,
            children: [
              text("See "),
              {
                type: "link",
                url: "https://evil.example",
                children: [text("here")],
              },
            ],
          },
        ]),
      );

      const heading: TreeNode = (result.children || [])[0] as TreeNode;
      expect(heading.type).toBe("heading");
      expect(heading.depth).toBe(2);
      expect(collectTypes(result)).not.toContain("link");
      expect(collectInlineCode(result)).toEqual(["https://evil.example"]);
    });

    test("re-wraps a bare phrasing node left at the root into a paragraph", () => {
      const result: TreeNode = run(root([text("loose")]));

      expect(result.children).toEqual([
        { type: "paragraph", children: [{ type: "text", value: "loose" }] },
      ]);
    });

    test("re-wraps a bare inline code node left at the root into a paragraph", () => {
      const result: TreeNode = run(root([{ type: "inlineCode", value: "x" }]));

      const child: TreeNode = (result.children || [])[0] as TreeNode;
      expect(child.type).toBe("paragraph");
      expect(child.children).toEqual([{ type: "inlineCode", value: "x" }]);
    });

    test("leaves a block node at the root unwrapped", () => {
      const result: TreeNode = run(
        root([{ type: "code", value: "console.log(1)" }]),
      );

      const child: TreeNode = (result.children || [])[0] as TreeNode;
      expect(child.type).toBe("code");
      expect(child.value).toBe("console.log(1)");
    });
  });

  describe("parse-failure fallback", () => {
    test("degrades to a fenced code block rather than emitting live markup", () => {
      /*
       * A non-JSON string makes the stubbed parser throw, standing in for any
       * real parse failure.
       */
      expect(neutralizeAssistantMarkdown("not valid json")).toBe(
        "```\nnot valid json\n```",
      );
    });

    test("neutralizes triple backticks in the fallback so they cannot break the fence", () => {
      expect(neutralizeAssistantMarkdown("```danger```")).toBe(
        "```\n'''danger'''\n```",
      );
    });
  });
});
