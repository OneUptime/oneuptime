/*
 * Perf contract for MarkdownViewer's mermaid integration (linear-polish):
 * mermaid's pre-bundled build is ~4.5MB — it used to be statically imported
 * and initialized at module scope, which dragged it into the Dashboard's
 * eager first-load graph through every markdown call site. The contract now
 * is: importing MarkdownViewer and rendering plain markdown must NEVER load
 * mermaid; only a rendered mermaid diagram may trigger the dynamic import,
 * and theme initialization must happen after that load.
 *
 * The jest module registry is the probe: the "mermaid" factory below flips a
 * sentinel when the module is actually required, which under ts-jest's
 * CommonJS output happens exactly when the component executes its dynamic
 * import(). (Common/jest.config.json maps "mermaid" to a stub via
 * moduleNameMapper, but an explicit jest.mock factory takes precedence.)
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";

interface MockMermaidState {
  required: boolean;
  initializeCalls: Array<unknown>;
  renderCalls: Array<string>;
}

const mockMermaidState: MockMermaidState = {
  required: false,
  initializeCalls: [],
  renderCalls: [],
};

jest.mock("mermaid", () => {
  // Runs only when something actually requires mermaid — the sentinel.
  mockMermaidState.required = true;
  return {
    __esModule: true,
    default: {
      initialize: (config: unknown): void => {
        mockMermaidState.initializeCalls.push(config);
      },
      render: (_id: string, chart: string): Promise<{ svg: string }> => {
        mockMermaidState.renderCalls.push(chart);
        return Promise.resolve({
          svg: '<svg><g data-diagram="true"></g></svg>',
        });
      },
    },
  };
});

import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import MarkdownViewer, {
  MermaidDiagram,
} from "../../../UI/Components/Markdown.tsx/MarkdownViewer";

/*
 * Captured immediately after the static import above: if MarkdownViewer ever
 * regresses to a module-scope `import mermaid from "mermaid"` (or a
 * module-scope initialize call), this flips to true before any test runs.
 */
const mermaidRequiredAtModuleLoad: boolean = mockMermaidState.required;

afterEach(() => {
  cleanup();
});

/*
 * NOTE: test order inside this file is load-bearing. The sentinel is
 * one-directional (a module stays required for the rest of the process), so
 * the "never loads" assertions must run before the test that legitimately
 * triggers the load.
 */
describe("MarkdownViewer lazy mermaid contract", () => {
  test("importing the MarkdownViewer module does not require mermaid", () => {
    expect(mermaidRequiredAtModuleLoad).toBe(false);
  });

  test("rendering plain markdown does not require mermaid", () => {
    render(
      <MarkdownViewer
        text={"# Hello\n\nJust **plain** markdown with `inline code`."}
      />,
    );

    const rendered: HTMLElement = screen.getByTestId("react-markdown");
    expect(rendered).toBeInTheDocument();
    expect(mockMermaidState.required).toBe(false);
    expect(mockMermaidState.initializeCalls).toHaveLength(0);
  });

  test("rendering a mermaid diagram dynamically loads mermaid, then initializes and renders", async () => {
    const chart: string = "graph TD; A-->B";
    const { container } = render(<MermaidDiagram chart={chart} />);

    // The load + render pipeline is async (dynamic import then render()).
    await waitFor((): void => {
      expect(mockMermaidState.renderCalls).toContain(chart);
    });

    expect(mockMermaidState.required).toBe(true);

    /*
     * Theme setup must run post-load and before render: with no module-scope
     * initialization left, the only way initialize() can have been called is
     * from the diagram's own effect after the dynamic import resolved.
     */
    expect(mockMermaidState.initializeCalls.length).toBeGreaterThan(0);

    await waitFor((): void => {
      expect(container.querySelector("svg")).not.toBeNull();
    });
  });
});
