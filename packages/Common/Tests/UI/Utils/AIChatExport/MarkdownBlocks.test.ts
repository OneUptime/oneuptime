import { describe, expect, jest, test } from "@jest/globals";
import parseMarkdownBlocks, {
  MarkdownBlock,
  MarkdownBlockType,
  MarkdownInline,
} from "../../../../UI/Utils/AIChatExport/MarkdownBlocks";

/*
 * parseMarkdownBlocks lowers a remark/mdast tree into flat, drawable blocks for
 * the PDF exporter. The real parser (remark-parse) is native ESM that this
 * repo's jest transform cannot load, and remark-gfm is already stubbed to a
 * no-op by the shared jest config. So the tree-building step is not what these
 * tests are about — the lowering is. The parser is stubbed here so that
 * .parse(input) simply deserializes a hand-built mdast tree from the input
 * string. Each test therefore feeds an exact tree that matches the MarkdownNode
 * contract the source consumes (type/value/lang/depth/ordered/start/align/
 * children) and asserts the precise blocks that come back, branch by branch.
 *
 * Passing a string that is not valid JSON makes the stubbed .parse throw, which
 * is how the module's parse-failure fallback is exercised.
 */
jest.mock("remark-parse", () => {
  return { __esModule: true, default: (): void => {} };
});

jest.mock("unified", () => {
  interface Chain {
    use: () => Chain;
    parse: (input: string) => unknown;
  }
  const makeChain: () => Chain = (): Chain => {
    const chain: Chain = {
      use: (): Chain => {
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

/*
 * Minimal mirror of the private MarkdownNode contract the source reads. Only
 * the fields the lowering touches are modelled.
 */
interface MdNode {
  type: string;
  value?: string | undefined;
  lang?: string | undefined;
  depth?: number | undefined;
  ordered?: boolean | undefined;
  start?: number | null | undefined;
  align?: Array<string | null> | undefined;
  children?: Array<MdNode> | undefined;
}

function root(children: Array<MdNode>): MdNode {
  return { type: "root", children: children };
}

function blocksOf(tree: MdNode): Array<MarkdownBlock> {
  return parseMarkdownBlocks(JSON.stringify(tree));
}

function text(value: string): MdNode {
  return { type: "text", value: value };
}

function plain(value: string): MarkdownInline {
  return {
    text: value,
    isBold: false,
    isItalic: false,
    isStrikethrough: false,
  };
}

describe("parseMarkdownBlocks", () => {
  describe("input guards and error handling", () => {
    test("returns an empty list for empty string without invoking the parser", () => {
      expect(parseMarkdownBlocks("")).toEqual([]);
    });

    test("returns an empty list when the tree has no children", () => {
      expect(blocksOf({ type: "root" })).toEqual([]);
    });

    test("falls back to a single raw paragraph when parsing throws", () => {
      const raw: string = "# not json {";

      expect(parseMarkdownBlocks(raw)).toEqual([
        {
          type: MarkdownBlockType.Paragraph,
          inlines: [{ text: raw }],
        },
      ]);
    });

    test("keeps the original text verbatim in the parse-failure fallback", () => {
      const raw: string = "just some **unparseable** text";
      const blocks: Array<MarkdownBlock> = parseMarkdownBlocks(raw);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe(MarkdownBlockType.Paragraph);
      expect(blocks[0]?.inlines).toEqual([{ text: raw }]);
    });
  });

  describe("headings", () => {
    test("maps each heading depth 1-6 onto its level", () => {
      for (let depth: number = 1; depth <= 6; depth++) {
        const blocks: Array<MarkdownBlock> = blocksOf(
          root([{ type: "heading", depth: depth, children: [text("H")] }]),
        );

        expect(blocks).toEqual([
          {
            type: MarkdownBlockType.Heading,
            level: depth,
            inlines: [plain("H")],
          },
        ]);
      }
    });

    test("defaults a heading with no depth to level 1", () => {
      expect(
        blocksOf(root([{ type: "heading", children: [text("H")] }])),
      ).toEqual([
        {
          type: MarkdownBlockType.Heading,
          level: 1,
          inlines: [plain("H")],
        },
      ]);
    });

    test("treats a zero depth as level 1", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([{ type: "heading", depth: 0, children: [text("H")] }]),
      );

      expect(blocks[0]?.level).toBe(1);
    });

    test("carries inline styling inside a heading", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "heading",
            depth: 2,
            children: [{ type: "strong", children: [text("bold")] }],
          },
        ]),
      );

      expect(blocks[0]?.inlines).toEqual([
        { text: "bold", isBold: true, isItalic: false, isStrikethrough: false },
      ]);
    });
  });

  describe("paragraphs", () => {
    test("renders a paragraph with plain inline text at indent 0", () => {
      expect(
        blocksOf(root([{ type: "paragraph", children: [text("hi")] }])),
      ).toEqual([
        {
          type: MarkdownBlockType.Paragraph,
          inlines: [plain("hi")],
          indent: 0,
        },
      ]);
    });
  });

  describe("inline styling (collectInlines)", () => {
    test("captures bold, italic, code, strikethrough and their nesting", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "paragraph",
            children: [
              text("plain "),
              {
                type: "strong",
                children: [text("b"), { type: "inlineCode", value: "c" }],
              },
              { type: "emphasis", children: [text("i")] },
              { type: "delete", children: [text("d")] },
            ],
          },
        ]),
      );

      expect(blocks[0]?.inlines).toEqual([
        plain("plain "),
        { text: "b", isBold: true, isItalic: false, isStrikethrough: false },
        { text: "c", isCode: true, isBold: true, isItalic: false },
        { text: "i", isBold: false, isItalic: true, isStrikethrough: false },
        { text: "d", isBold: false, isItalic: false, isStrikethrough: true },
      ]);
    });

    test("emits an empty-string inline for empty inline code", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([{ type: "paragraph", children: [{ type: "inlineCode" }] }]),
      );

      expect(blocks[0]?.inlines).toEqual([
        { text: "", isCode: true, isBold: false, isItalic: false },
      ]);
    });

    test("drops a text node with no value rather than emitting an empty inline", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([{ type: "paragraph", children: [text(""), text("kept")] }]),
      );

      expect(blocks[0]?.inlines).toEqual([plain("kept")]);
    });

    test("turns a hard break into a newline inline with no styling", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "paragraph",
            children: [text("a"), { type: "break" }, text("b")],
          },
        ]),
      );

      expect(blocks[0]?.inlines).toEqual([
        plain("a"),
        { text: "\n" },
        plain("b"),
      ]);
    });

    test("keeps link and image text but discards their destinations", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "paragraph",
            children: [
              { type: "link", value: "ignored", children: [text("L")] },
              { type: "image", value: "ignored", children: [text("I")] },
              { type: "linkReference", children: [text("R")] },
              { type: "imageReference", children: [text("IR")] },
            ],
          },
        ]),
      );

      const serialized: string = JSON.stringify(blocks);

      expect(blocks[0]?.inlines).toEqual([
        plain("L"),
        plain("I"),
        plain("R"),
        plain("IR"),
      ]);
      expect(serialized).not.toContain("ignored");
    });

    test("recurses through an unknown inline container", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "paragraph",
            children: [{ type: "superscript", children: [text("nested")] }],
          },
        ]),
      );

      expect(blocks[0]?.inlines).toEqual([plain("nested")]);
    });

    test("falls back to text plus bold flag for an unknown valued inline", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "paragraph",
            children: [
              {
                type: "strong",
                children: [{ type: "footnoteReference", value: "fx" }],
              },
            ],
          },
        ]),
      );

      expect(blocks[0]?.inlines).toEqual([{ text: "fx", isBold: true }]);
    });
  });

  describe("code blocks", () => {
    test("keeps the code body and language", () => {
      expect(
        blocksOf(root([{ type: "code", lang: "ts", value: "const a = 1;" }])),
      ).toEqual([
        {
          type: MarkdownBlockType.Code,
          code: "const a = 1;",
          language: "ts",
        },
      ]);
    });

    test("defaults missing language and body to empty strings", () => {
      expect(blocksOf(root([{ type: "code" }]))).toEqual([
        {
          type: MarkdownBlockType.Code,
          code: "",
          language: "",
        },
      ]);
    });
  });

  describe("blockquotes", () => {
    test("re-labels a quoted paragraph as a Quote while keeping its inlines", () => {
      expect(
        blocksOf(
          root([
            {
              type: "blockquote",
              children: [{ type: "paragraph", children: [text("quoted")] }],
            },
          ]),
        ),
      ).toEqual([
        {
          type: MarkdownBlockType.Quote,
          inlines: [plain("quoted")],
          indent: 0,
        },
      ]);
    });

    test("re-labels a quoted heading as a Quote but keeps its level", () => {
      expect(
        blocksOf(
          root([
            {
              type: "blockquote",
              children: [{ type: "heading", depth: 3, children: [text("QH")] }],
            },
          ]),
        ),
      ).toEqual([
        {
          type: MarkdownBlockType.Quote,
          level: 3,
          inlines: [plain("QH")],
        },
      ]);
    });

    test("emits one Quote block per child of the blockquote", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "blockquote",
            children: [
              { type: "paragraph", children: [text("one")] },
              { type: "paragraph", children: [text("two")] },
            ],
          },
        ]),
      );

      expect(blocks).toHaveLength(2);
      expect(
        blocks.every((block: MarkdownBlock) => {
          return block.type === MarkdownBlockType.Quote;
        }),
      ).toBe(true);
    });
  });

  describe("thematic break", () => {
    test("lowers a thematic break to a bare Rule block", () => {
      expect(blocksOf(root([{ type: "thematicBreak" }]))).toEqual([
        { type: MarkdownBlockType.Rule },
      ]);
    });
  });

  describe("raw html", () => {
    test("shows raw html as an unstyled paragraph", () => {
      expect(blocksOf(root([{ type: "html", value: "<b>x</b>" }]))).toEqual([
        {
          type: MarkdownBlockType.Paragraph,
          inlines: [{ text: "<b>x</b>" }],
          indent: 0,
        },
      ]);
    });

    test("drops an html node that has no value", () => {
      expect(blocksOf(root([{ type: "html" }]))).toEqual([]);
    });
  });

  describe("unordered lists", () => {
    test("renders each item with a dash marker at the given indent", () => {
      expect(
        blocksOf(
          root([
            {
              type: "list",
              children: [
                {
                  type: "listItem",
                  children: [{ type: "paragraph", children: [text("one")] }],
                },
                {
                  type: "listItem",
                  children: [{ type: "paragraph", children: [text("two")] }],
                },
              ],
            },
          ]),
        ),
      ).toEqual([
        {
          type: MarkdownBlockType.ListItem,
          inlines: [plain("one")],
          indent: 0,
          marker: "-",
        },
        {
          type: MarkdownBlockType.ListItem,
          inlines: [plain("two")],
          indent: 0,
          marker: "-",
        },
      ]);
    });

    test("joins multiple paragraphs in one item with a soft break", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "list",
            children: [
              {
                type: "listItem",
                children: [
                  { type: "paragraph", children: [text("p1")] },
                  { type: "paragraph", children: [text("p2")] },
                ],
              },
            ],
          },
        ]),
      );

      expect(blocks).toEqual([
        {
          type: MarkdownBlockType.ListItem,
          inlines: [plain("p1"), { text: "\n" }, plain("p2")],
          indent: 0,
          marker: "-",
        },
      ]);
    });

    test("renders an empty item as an empty inline list", () => {
      expect(
        blocksOf(root([{ type: "list", children: [{ type: "listItem" }] }])),
      ).toEqual([
        {
          type: MarkdownBlockType.ListItem,
          inlines: [],
          indent: 0,
          marker: "-",
        },
      ]);
    });
  });

  describe("ordered lists", () => {
    test("numbers items sequentially starting at 1 by default", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "list",
            ordered: true,
            children: [
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [text("a")] }],
              },
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [text("b")] }],
              },
            ],
          },
        ]),
      );

      expect(
        blocks.map((block: MarkdownBlock) => {
          return block.marker;
        }),
      ).toEqual(["1.", "2."]);
    });

    test("honours a numeric start value and increments from it", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "list",
            ordered: true,
            start: 5,
            children: [
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [text("five")] }],
              },
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [text("six")] }],
              },
            ],
          },
        ]),
      );

      expect(
        blocks.map((block: MarkdownBlock) => {
          return block.marker;
        }),
      ).toEqual(["5.", "6."]);
    });

    test("treats a null start as starting at 1", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "list",
            ordered: true,
            start: null,
            children: [
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [text("only")] }],
              },
            ],
          },
        ]),
      );

      expect(blocks[0]?.marker).toBe("1.");
    });
  });

  describe("nested lists and non-paragraph list children", () => {
    test("increments indent for a nested list and appends it after the item", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "list",
            children: [
              {
                type: "listItem",
                children: [
                  { type: "paragraph", children: [text("a")] },
                  {
                    type: "list",
                    children: [
                      {
                        type: "listItem",
                        children: [
                          { type: "paragraph", children: [text("a1")] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      );

      expect(blocks).toEqual([
        {
          type: MarkdownBlockType.ListItem,
          inlines: [plain("a")],
          indent: 0,
          marker: "-",
        },
        {
          type: MarkdownBlockType.ListItem,
          inlines: [plain("a1")],
          indent: 1,
          marker: "-",
        },
      ]);
    });

    test("lowers a non-paragraph, non-list child through toBlocks after the item", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "list",
            children: [
              {
                type: "listItem",
                children: [
                  { type: "paragraph", children: [text("intro")] },
                  { type: "code", lang: "sh", value: "ls" },
                ],
              },
            ],
          },
        ]),
      );

      expect(blocks).toEqual([
        {
          type: MarkdownBlockType.ListItem,
          inlines: [plain("intro")],
          indent: 0,
          marker: "-",
        },
        {
          type: MarkdownBlockType.Code,
          code: "ls",
          language: "sh",
        },
      ]);
    });
  });

  describe("tables (tableToBlock)", () => {
    test("splits the header row from data rows and maps alignments", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "table",
            align: ["left", "center", "right", null],
            children: [
              {
                type: "tableRow",
                children: [
                  { type: "tableCell", children: [text("H1")] },
                  {
                    type: "tableCell",
                    children: [{ type: "strong", children: [text("H2")] }],
                  },
                ],
              },
              {
                type: "tableRow",
                children: [
                  { type: "tableCell", children: [text("r1c1")] },
                  { type: "tableCell", children: [text("r1c2")] },
                ],
              },
              {
                type: "tableRow",
                children: [
                  { type: "tableCell", children: [text("r2c1")] },
                  { type: "tableCell", children: [text("r2c2")] },
                ],
              },
            ],
          },
        ]),
      );

      expect(blocks).toEqual([
        {
          type: MarkdownBlockType.Table,
          headers: ["H1", "H2"],
          rows: [
            ["r1c1", "r1c2"],
            ["r2c1", "r2c2"],
          ],
          alignments: ["left", "center", "right", "left"],
        },
      ]);
    });

    test("flattens styled cell content down to plain text", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          {
            type: "table",
            children: [
              {
                type: "tableRow",
                children: [
                  {
                    type: "tableCell",
                    children: [
                      { type: "emphasis", children: [text("em")] },
                      { type: "inlineCode", value: "code" },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      );

      expect(blocks[0]?.headers).toEqual(["emcode"]);
      expect(blocks[0]?.rows).toEqual([]);
    });

    test("produces empty header, row and alignment arrays for an empty table", () => {
      expect(blocksOf(root([{ type: "table" }]))).toEqual([
        {
          type: MarkdownBlockType.Table,
          headers: [],
          rows: [],
          alignments: [],
        },
      ]);
    });
  });

  describe("unknown top-level nodes", () => {
    test("recurses into the children of an unknown container", () => {
      expect(
        blocksOf(
          root([
            {
              type: "customBlock",
              children: [{ type: "paragraph", children: [text("inside")] }],
            },
          ]),
        ),
      ).toEqual([
        {
          type: MarkdownBlockType.Paragraph,
          inlines: [plain("inside")],
          indent: 0,
        },
      ]);
    });

    test("emits nothing for an unknown leaf node", () => {
      expect(blocksOf(root([{ type: "yaml" }]))).toEqual([]);
    });
  });

  describe("document order", () => {
    test("preserves block order across a mixed document", () => {
      const blocks: Array<MarkdownBlock> = blocksOf(
        root([
          { type: "heading", depth: 1, children: [text("Title")] },
          { type: "paragraph", children: [text("intro")] },
          {
            type: "list",
            children: [
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [text("point")] }],
              },
            ],
          },
          { type: "code", lang: "js", value: "x" },
          { type: "thematicBreak" },
        ]),
      );

      expect(
        blocks.map((block: MarkdownBlock) => {
          return block.type;
        }),
      ).toEqual([
        MarkdownBlockType.Heading,
        MarkdownBlockType.Paragraph,
        MarkdownBlockType.ListItem,
        MarkdownBlockType.Code,
        MarkdownBlockType.Rule,
      ]);
    });
  });
});
