/*
 * How MarkdownViewer's MermaidDiagram draws a diagram, against a stand-in for
 * mermaid that does what mermaid 11's render() does with the page
 * (node_modules/mermaid/dist/mermaid.core.mjs, `render`):
 *
 *   - it draws in a working element, <div id="d{id}"><svg id="{id}">, which
 *     it appends to the container it is given, or to document.body when it
 *     is given none;
 *   - for a diagram that does not parse it draws its "Syntax error in text"
 *     graphic there and throws WITHOUT removing the working element, unless
 *     suppressErrorRendering is set, when it removes it and throws;
 *   - otherwise it removes the working element and returns the SVG.
 *
 * The viewer gave it no container, so a diagram that did not parse left
 * mermaid's error graphic at the end of the page body, outside the viewer,
 * one more on every redraw. And its sanitizer kept SVG only, which dropped
 * the MathML KaTeX writes for a $$...$$ label, so the label was an empty
 * box. Real browsers draw the real thing in packages/E2E/Diagrams.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
// Loads mermaid lazily, so the jest.mock below is in place before it does.
import { MermaidDiagram } from "../../../UI/Components/Markdown.tsx/MarkdownViewer";

interface MockRenderCall {
  id: string;
  text: string;
  container: Element | undefined;
  containerAttached: boolean;
}

interface MockMermaidState {
  config: Record<string, unknown>;
  renderCalls: Array<MockRenderCall>;
  svgForText: (text: string) => string;
}

const mockMermaidState: MockMermaidState = {
  config: {},
  renderCalls: [],
  svgForText: (): string => {
    return "<svg></svg>";
  },
};

jest.mock("mermaid", () => {
  return {
    __esModule: true,
    default: {
      initialize: (config: Record<string, unknown>): void => {
        mockMermaidState.config = config;
      },
      render: async (
        id: string,
        text: string,
        container?: Element,
      ): Promise<{ svg: string }> => {
        mockMermaidState.renderCalls.push({
          id,
          text,
          container,
          containerAttached: Boolean(
            container && container.ownerDocument.body.contains(container),
          ),
        });

        const root: Element = container || document.body;
        const working: HTMLDivElement = document.createElement("div");
        working.id = `d${id}`;
        working.innerHTML = `<svg id="${id}" width="100%"><g></g></svg>`;
        root.appendChild(working);

        // Parsing is asynchronous in mermaid (diagram types load lazily).
        await Promise.resolve();

        if (text.includes("does not parse")) {
          if (mockMermaidState.config["suppressErrorRendering"]) {
            working.remove();
          } else {
            (working.firstElementChild as Element).innerHTML =
              '<g class="error-icon"><text class="error-text">Syntax error in text</text></g>';
          }
          throw new Error("Parse error on line 2: graph LR  A -->");
        }

        working.remove();
        return { svg: mockMermaidState.svgForText(text) };
      },
    },
  };
});

/*
 * What mermaid really returns for `A["$$x^2 + y^2 = z^2$$"] --> B[Plain
 * label]` (strict mode, captured from Chromium): each label is HTML inside a
 * foreignObject, and KaTeX's MathML sits inside the first one.
 */
const KATEX_LABEL_SVG: string = [
  '<svg id="mermaid-katex" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60" role="graphics-document document" aria-roledescription="flowchart-v2">',
  "<style>#mermaid-katex{font-family:inherit;font-size:16px;fill:#333;}</style>",
  '<g class="root"><g class="nodes">',
  '<g class="node default" id="flowchart-A-0" transform="translate(50, 30)"><rect class="basic label-container" x="-42" y="-17" width="84" height="34"></rect>',
  '<g class="label" transform="translate(-42, -9)"><rect></rect><foreignObject width="84.09375" height="18.34375">',
  '<div xmlns="http://www.w3.org/1999/xhtml" style="display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;">',
  '<span class="nodeLabel"><div style="display: flex; align-items: center; justify-content: center; white-space: nowrap;">',
  '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>',
  "<msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup><mo>=</mo><msup><mi>z</mi><mn>2</mn></msup>",
  "</mrow></math></span></div></span></div></foreignObject></g></g>",
  '<g class="node default" id="flowchart-B-1" transform="translate(220, 30)"><g class="label"><foreignObject width="83" height="24">',
  '<div xmlns="http://www.w3.org/1999/xhtml" style="display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;">',
  '<span class="nodeLabel"><p>Plain label</p></span></div></foreignObject></g></g>',
  "</g></g></svg>",
].join("");

const SEQUENCE_SVG: string =
  '<svg id="mermaid-seq" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><g><text x="10" y="20">Hello Bob</text></g></svg>';

const leftovers: () => Array<Element> = (): Array<Element> => {
  return Array.from(document.body.querySelectorAll('[id^="dmermaid-"]'));
};

const syntaxErrorGraphics: () => number = (): number => {
  return Array.from(document.querySelectorAll("svg")).filter(
    (svg: SVGSVGElement): boolean => {
      return (svg.textContent || "").includes("Syntax error in text");
    },
  ).length;
};

beforeEach(() => {
  mockMermaidState.config = {};
  mockMermaidState.renderCalls = [];
  mockMermaidState.svgForText = (text: string): string => {
    return text.includes("$$") ? KATEX_LABEL_SVG : SEQUENCE_SVG;
  };
});

afterEach(() => {
  cleanup();
  // Whatever a test left in the body must not leak into the next one.
  document.body.innerHTML = "";
});

describe("MermaidDiagram: a diagram that does not parse", () => {
  const BROKEN: string = "graph LR\n  A --> does not parse";

  test("shows its error in place of the diagram", async () => {
    const { container } = render(<MermaidDiagram chart={BROKEN} />);

    await waitFor((): void => {
      expect(
        container.querySelector("pre.text-red-500")?.textContent,
      ).toContain("Error rendering diagram");
    });
    expect(container.querySelector("pre.text-red-500")?.textContent).toContain(
      "Parse error on line 2",
    );
  });

  test("leaves nothing of mermaid's behind, in the viewer or at the end of the page", async () => {
    const { container } = render(<MermaidDiagram chart={BROKEN} />);

    await waitFor((): void => {
      expect(container.querySelector("pre.text-red-500")).not.toBeNull();
    });

    expect(leftovers()).toEqual([]);
    expect(syntaxErrorGraphics()).toBe(0);
    // The page holds the viewer's own markup and nothing else.
    expect(document.body.children).toHaveLength(1);
  });

  test("leaves nothing behind however often it is drawn again", async () => {
    const first: ReturnType<typeof render> = render(
      <MermaidDiagram chart={BROKEN} />,
    );

    await waitFor((): void => {
      expect(first.container.querySelector("pre.text-red-500")).not.toBeNull();
    });

    first.rerender(<MermaidDiagram chart={`${BROKEN}\n`} />);

    await waitFor((): void => {
      expect(mockMermaidState.renderCalls).toHaveLength(2);
    });
    await waitFor((): void => {
      expect(first.container.querySelector("pre.text-red-500")).not.toBeNull();
    });

    expect(leftovers()).toEqual([]);
    expect(syntaxErrorGraphics()).toBe(0);
  });

  test("does not stop the next diagram from drawing", async () => {
    const { container } = render(
      <div>
        <MermaidDiagram chart={BROKEN} />
        <MermaidDiagram chart="sequenceDiagram\n  Alice->>Bob: Hello Bob" />
      </div>,
    );

    await waitFor((): void => {
      expect(container.querySelector("pre.text-red-500")).not.toBeNull();
      expect(container.textContent).toContain("Hello Bob");
    });
    expect(leftovers()).toEqual([]);
  });
});

describe("MermaidDiagram: how mermaid is asked to draw", () => {
  test("in strict mode, without mermaid's own error graphic", async () => {
    render(
      <MermaidDiagram chart="sequenceDiagram\n  Alice->>Bob: Hello Bob" />,
    );

    await waitFor((): void => {
      expect(mockMermaidState.renderCalls).toHaveLength(1);
    });

    expect(mockMermaidState.config["securityLevel"]).toBe("strict");
    expect(mockMermaidState.config["suppressErrorRendering"]).toBe(true);
  });

  test("in a container of its own, in the page while it draws and gone after", async () => {
    const { container } = render(
      <MermaidDiagram chart="sequenceDiagram\n  Alice->>Bob: Hello Bob" />,
    );

    await waitFor((): void => {
      expect(container.textContent).toContain("Hello Bob");
    });

    const call: MockRenderCall = mockMermaidState
      .renderCalls[0] as MockRenderCall;

    // mermaid measures every label with the page's layout.
    expect(call.container).toBeDefined();
    expect(call.containerAttached).toBe(true);
    expect(document.body.contains(call.container as Element)).toBe(false);
    expect(leftovers()).toEqual([]);
  });
});

describe("MermaidDiagram: a $$...$$ label", () => {
  test("keeps the MathML KaTeX wrote for it", async () => {
    const { container } = render(
      <MermaidDiagram
        chart={'graph LR\n  A["$$x^2 + y^2 = z^2$$"] --> B[Plain label]'}
      />,
    );

    await waitFor((): void => {
      expect(container.querySelector("svg")).not.toBeNull();
    });

    const math: Element | null = container.querySelector(
      "svg foreignObject math",
    );

    expect(math).not.toBeNull();
    expect(math?.getAttribute("display")).toBe("block");
    expect(math?.querySelectorAll("msup")).toHaveLength(3);
    expect(math?.querySelectorAll("mi")).toHaveLength(3);
    expect(math?.textContent).toBe("x2+y2=z2");
    expect(container.textContent).toContain("Plain label");
  });

  test("keeps the label's text and drops its HTML wrappers, as before", async () => {
    const { container } = render(
      <MermaidDiagram
        chart={'graph LR\n  A["$$x^2 + y^2 = z^2$$"] --> B[Plain label]'}
      />,
    );

    await waitFor((): void => {
      expect(container.querySelector("svg")).not.toBeNull();
    });

    const htmlElements: Array<string> = Array.from(
      container.querySelectorAll("svg *"),
    )
      .filter((element: Element): boolean => {
        return element.namespaceURI === "http://www.w3.org/1999/xhtml";
      })
      .map((element: Element): string => {
        return element.tagName;
      });

    expect(htmlElements).toEqual([]);
  });
});
