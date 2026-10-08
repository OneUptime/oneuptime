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
 * as it is, and a diagram too long to draw as its source.
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
} from "../../../UI/Components/Markdown.tsx/MarkdownViewerOverLongText";
import { OVER_LONG_LINE_LENGTH } from "../../../Utils/Markdown/OverLongText";

/*
 * What the react-markdown stand-in was last given, and the tree it draws
 * with the viewer's components.
 */
const mockMarkdownState: {
  props: Record<string, unknown> | null;
  build: ((components: Record<string, React.ElementType>) => React.ReactElement) | null;
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
  rehypePlugins: Array<[TreePlugin, { held: ReadonlyArray<string> }]> | undefined;
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
  return (components: Record<string, React.ElementType>): React.ReactElement => {
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
    expect(
      screen.getByTestId("highlighted").textContent === longCode,
    ).toBe(true);

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
