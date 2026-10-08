/*
 * How MarkdownViewer shows a text too long for its parser: a response body
 * or a log a description template placed, megabytes on one line.
 *
 * react-markdown reads Markdown with remark, which ran out of stack on a
 * line of a few megabytes and took minutes on others, and the incident page
 * broke with it; prism took minutes to highlight a code block of
 * megabytes. The viewer now holds back what is too long before
 * react-markdown reads the text (MarkdownViewerOverLongText), and puts it
 * back as text with a rehype plugin; code too long to highlight is shown
 * as it is, and a diagram too long to draw as its source. A text with more
 * left than react-markdown reads in good time - a log of megabytes whose
 * lines are not plain, a table of thousands of rows - is shown as written.
 *
 * Jest stubs react-markdown, so the stand-in here records what the viewer
 * hands it, and draws the code blocks it is told to. The real parser runs
 * on sixteen megabytes in HugeTextInLongRunningProcess.test.ts.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("react-markdown", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
      mockMarkdownState.props = props;

      if (!mockMarkdownState.build) {
        return mockReact.createElement("div");
      }

      return mockMarkdownState.build(
        props["components"] as Record<string, React.ElementType>,
      );
    },
    defaultUrlTransform: (url: string): string => {
      return url;
    },
  };
});

// Records the language each code block is highlighted as.
jest.mock("react-syntax-highlighter/dist/esm/prism-light", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const Highlighter: {
    (props: Record<string, unknown>): React.ReactElement;
    registerLanguage: () => void;
  } = Object.assign(
    (props: Record<string, unknown>): React.ReactElement => {
      return react.createElement(
        "pre",
        {
          "data-testid": "highlighted",
          "data-highlighted-as": props["language"] as string,
        },
        props["children"] as React.ReactNode,
      );
    },
    {
      registerLanguage: (): void => {},
    },
  );
  return { __esModule: true, default: Highlighter, vscDarkPlus: {} };
});

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import MarkdownViewer from "../../../UI/Components/Markdown.tsx/MarkdownViewer";
import {
  HeldTextTreeNode,
  MAX_HIGHLIGHTED_CODE_LENGTH,
  MAX_PARSED_MARKDOWN_LENGTH,
  holdBackForViewer,
} from "../../../UI/Components/Markdown.tsx/MarkdownViewerOverLongText";
import { OVER_LONG_LINE_LENGTH } from "../../../Utils/Markdown/OverLongText";

/*
 * What the react-markdown stand-in was last given, and the tree it draws
 * with the viewer's components.
 */
const mockMarkdownState: {
  props: Record<string, unknown> | null;
  build:
    | ((components: Record<string, React.ElementType>) => React.ReactElement)
    | null;
} = { props: null, build: null };

const mockReact: typeof React = jest.requireActual("react") as typeof React;

type TreeTransformer = (tree: HeldTextTreeNode) => void;
type TreePlugin = (options: { held: ReadonlyArray<string> }) => TreeTransformer;

afterEach(() => {
  cleanup();
  mockMarkdownState.props = null;
  mockMarkdownState.build = null;
});

const MIB: number = 1024 * 1024;

// The markdown and the rehype plugins the viewer handed react-markdown.
function handedToParser(): {
  markdown: string;
  rehypePlugins:
    | Array<[TreePlugin, { held: ReadonlyArray<string> }]>
    | undefined;
} {
  const props: Record<string, unknown> = mockMarkdownState.props!;

  return {
    markdown: props["children"] as string,
    rehypePlugins: props["rehypePlugins"] as
      | Array<[TreePlugin, { held: ReadonlyArray<string> }]>
      | undefined,
  };
}

// A code fence as react-markdown hands it over: <pre><code class="language-x">.
function codeFence(
  language: string,
  source: string,
): (components: Record<string, React.ElementType>) => React.ReactElement {
  return function CodeFence(
    components: Record<string, React.ElementType>,
  ): React.ReactElement {
    const Pre: React.ElementType = components["pre"] as React.ElementType;
    const Code: React.ElementType = components["code"] as React.ElementType;

    return (
      <Pre>
        <Code className={`language-${language}`}>{source}</Code>
      </Pre>
    );
  };
}

describe("MarkdownViewer - text too long for its parser", () => {
  test("a text of at most 64 KB goes to the parser as it is, with no plugin", () => {
    const text: string = `**Response:** ${"word ".repeat(13000)}`;

    expect(text.length).toBeLessThanOrEqual(OVER_LONG_LINE_LENGTH);

    render(<MarkdownViewer text={text} />);

    expect(handedToParser().markdown).toBe(text);
    expect(handedToParser().rehypePlugins).toBeUndefined();
  });

  test("a line of sixteen megabytes reaches the parser held back, and the plugin puts it back as text", () => {
    const line: string = `HEAD ${"lorem ipsum ".repeat(Math.ceil((16 * MIB) / 12))}TAIL`;
    const text: string = `Before\n\n${line}\n\nAfter`;

    render(<MarkdownViewer text={text} />);

    const handed: ReturnType<typeof handedToParser> = handedToParser();

    // The parser reads a few kilobytes, not sixteen megabytes.
    expect(handed.markdown.length).toBeLessThan(4096);
    expect(handed.markdown.startsWith("Before\n\nHEAD lorem ipsum")).toBe(true);
    expect(handed.markdown.endsWith("ipsum TAIL\n\nAfter")).toBe(true);

    expect(handed.rehypePlugins).toHaveLength(1);

    const [plugin, options] = handed.rehypePlugins![0]!;

    // What the parser renders of the held-back markdown: here, one text.
    const tree: HeldTextTreeNode = {
      type: "root",
      children: [
        {
          type: "element",
          properties: {},
          children: [{ type: "text", value: handed.markdown }],
        },
      ],
    };

    plugin(options)(tree);

    // A boolean, so a failure does not print sixteen megabytes.
    expect(tree.children![0]!.children![0]!.value === text).toBe(true);
  });

  test("a link's address is put back together before the viewer judges it", () => {
    const address: string = `https://example.com/report?q=${"a".repeat(70000)}`;

    render(<MarkdownViewer text={`[The report](${address})`} />);

    const handed: ReturnType<typeof handedToParser> = handedToParser();
    const [plugin, options] = handed.rehypePlugins![0]!;

    // The parser leaves the token in the address it reads.
    const tokenAddress: string = handed.markdown.slice(
      handed.markdown.indexOf("(") + 1,
      handed.markdown.lastIndexOf(")"),
    );

    const tree: HeldTextTreeNode = {
      type: "root",
      children: [
        {
          type: "element",
          properties: { href: tokenAddress, className: [tokenAddress] },
          children: [{ type: "text", value: "The report" }],
        },
      ],
    };

    plugin(options)(tree);

    expect(tree.children![0]!.properties!["href"] === address).toBe(true);
    expect(
      (tree.children![0]!.properties!["className"] as Array<string>)[0] ===
        address,
    ).toBe(true);
  });

  test("a code block too long to highlight is shown as it is; a shorter one is highlighted", () => {
    const longCode: string = `{"items":[${'{"id":1},'.repeat(10000)}{"id":0}]}`;

    expect(longCode.length).toBeGreaterThan(MAX_HIGHLIGHTED_CODE_LENGTH);

    mockMarkdownState.build = codeFence("json", longCode);
    render(<MarkdownViewer text="(stand-in)" />);

    expect(screen.getByTestId("highlighted")).toHaveAttribute(
      "data-highlighted-as",
      "text",
    );
    // The block still reads as JSON code, with all of it there.
    expect(screen.getByTestId("highlighted").textContent === longCode).toBe(
      true,
    );

    cleanup();

    mockMarkdownState.build = codeFence("json", '{"id":1}');
    render(<MarkdownViewer text="(stand-in)" />);

    expect(screen.getByTestId("highlighted")).toHaveAttribute(
      "data-highlighted-as",
      "json",
    );
  });

  test("a diagram too long to draw is shown as its source", () => {
    const longChart: string = `graph TD\n${"A-->B\n".repeat(12000)}`;

    expect(longChart.length).toBeGreaterThan(MAX_HIGHLIGHTED_CODE_LENGTH);

    mockMarkdownState.build = codeFence("mermaid", longChart);
    render(<MarkdownViewer text="(stand-in)" />);

    expect(screen.getByTestId("highlighted")).toHaveAttribute(
      "data-highlighted-as",
      "text",
    );
  });
});

describe("MarkdownViewer - text with too much left for its parser", () => {
  // Lines with a "|" are not plain: they could be a table, so none is held back.
  const pipeLines: (length: number) => string = (length: number): string => {
    const line: string = "2026-10-08T10:00:00Z | INFO | request served\n";

    return line.repeat(Math.ceil(length / line.length)).slice(0, length);
  };

  test("is shown as it was written, line breaks kept, and never handed to the parser", () => {
    const text: string = `**Response:**\n\n${pipeLines(MIB)}\n\n_end_`;

    render(<MarkdownViewer text={text} />);

    expect(mockMarkdownState.props).toBeNull();

    const shown: HTMLElement = screen.getByTestId("markdown-viewer-text");

    // Booleans, so a failure does not print a megabyte.
    expect(shown.textContent === text).toBe(true);
    expect(shown.className.includes("whitespace-pre-wrap")).toBe(true);
    expect(shown.querySelector("*")).toBeNull();
  });

  test("a text with no more than that left still goes to the parser", () => {
    const table: string = `| Host | State |\n| --- | --- |\n${"| web-01 | down |\n".repeat(6000)}`;

    expect(table.length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
    expect(table.length).toBeLessThanOrEqual(MAX_PARSED_MARKDOWN_LENGTH);

    render(<MarkdownViewer text={table} />);

    expect(screen.queryByTestId("markdown-viewer-text")).toBeNull();
    expect(handedToParser().markdown === table).toBe(true);
  });

  test("sixteen megabytes of plain lines are held back, and so still read as Markdown", () => {
    const line: string = "2026-10-08T10:00:00Z INFO request served\n";
    const text: string = `**Response:**\n\n${line.repeat(Math.ceil((16 * MIB) / line.length))}\n_end_`;

    render(<MarkdownViewer text={text} />);

    expect(screen.queryByTestId("markdown-viewer-text")).toBeNull();
    expect(handedToParser().markdown.length).toBeLessThan(4096);
    expect(handedToParser().rehypePlugins).toHaveLength(1);
  });
});

describe("holdBackForViewer - what is shown as text", () => {
  const pipeLines: (length: number) => string = (length: number): string => {
    const line: string = "a | b\n";

    return line.repeat(Math.ceil(length / line.length)).slice(0, length);
  };

  test("nothing of at most 64 KB, whatever it holds", () => {
    expect(holdBackForViewer(pipeLines(OVER_LONG_LINE_LENGTH)).showAsText).toBe(
      false,
    );
  });

  test("a text with exactly the most left is read as Markdown; one more character is shown as text", () => {
    expect(
      holdBackForViewer(pipeLines(MAX_PARSED_MARKDOWN_LENGTH)).showAsText,
    ).toBe(false);
    expect(
      holdBackForViewer(pipeLines(MAX_PARSED_MARKDOWN_LENGTH + 1)).showAsText,
    ).toBe(true);
  });

  test("what is left is what counts: over-long lines and plain runs held back leave little", () => {
    const heldBack: ReturnType<typeof holdBackForViewer> = holdBackForViewer(
      `Before\n\n${"a".repeat(16 * MIB)}\n\n${"plain line\n".repeat(200000)}\nAfter`,
    );

    expect(heldBack.showAsText).toBe(false);
    expect(heldBack.markdown.length).toBeLessThan(8192);
  });

  test("lines that are not plain are left in, and over the most, shown as text", () => {
    for (const line of [
      "GET /api -> 200 in 12 ms\n",
      "ran `make build` in 12 ms\n",
      "| web-01 | down |\n",
      "- web-01 is down\n",
    ]) {
      const heldBack: ReturnType<typeof holdBackForViewer> = holdBackForViewer(
        line.repeat(Math.ceil((2 * MAX_PARSED_MARKDOWN_LENGTH) / line.length)),
      );

      expect([line, heldBack.showAsText]).toEqual([line, true]);
    }
  });
});
