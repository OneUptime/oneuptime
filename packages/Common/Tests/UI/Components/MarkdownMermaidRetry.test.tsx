/*
 * Retry contract for MarkdownViewer's lazy mermaid load (linear-polish):
 * loadMermaid() caches the dynamic-import promise module-wide so multiple
 * diagrams share one load — but a REJECTED load (flaky network, a deploy
 * rotating hashed chunk names) must not be cached forever. The contract is:
 * the diagram that triggered the failed load shows its error state, and the
 * next diagram mount retries the import from scratch.
 *
 * This lives in its own file rather than MarkdownLazy.test.tsx because that
 * file's sentinel design is one-directional: once its legitimate-load test
 * has run, jest's mock registry AND the component's module-scope cache both
 * hold the successfully resolved module for the rest of the process, so a
 * failure can no longer be staged there (jest.resetModules() is no escape —
 * it would fork React's identity out from under @testing-library). Here the
 * FIRST require of "mermaid" throws instead: jest memoizes a mock factory's
 * result only after it returns, so a throwing factory is re-invoked on the
 * next require — which is exactly the retry path under test.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";

interface MockMermaidState {
  factoryAttempts: number;
  failNextRequire: boolean;
  renderCalls: Array<string>;
}

const mockMermaidState: MockMermaidState = {
  factoryAttempts: 0,
  failNextRequire: true,
  renderCalls: [],
};

jest.mock("mermaid", () => {
  // Runs on every require until it returns once — then jest memoizes it.
  mockMermaidState.factoryAttempts++;
  if (mockMermaidState.failNextRequire) {
    mockMermaidState.failNextRequire = false;
    throw new Error("simulated mermaid chunk load failure");
  }
  return {
    __esModule: true,
    default: {
      initialize: (): void => {
        // theme setup is exercised in MarkdownLazy.test.tsx — a no-op here.
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
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { MermaidDiagram } from "../../../UI/Components/Markdown.tsx/MarkdownViewer";

afterEach(() => {
  cleanup();
});

describe("MarkdownViewer mermaid load retry contract", () => {
  test("a failed chunk load surfaces as the diagram's error state, and the next mount retries and succeeds", async () => {
    const chart: string = "graph TD; A-->B";

    /*
     * First mount: the dynamic import rejects (the mock factory throws on
     * the first require). The diagram must fall into its error path, not
     * hang or crash the tree.
     */
    const first: ReturnType<typeof render> = render(
      <MermaidDiagram chart={chart} />,
    );

    await waitFor((): void => {
      expect(
        first.container.querySelector("pre.text-red-500")?.textContent,
      ).toContain("Error rendering diagram");
    });

    expect(mockMermaidState.factoryAttempts).toBe(1);
    expect(mockMermaidState.renderCalls).toHaveLength(0);

    first.unmount();

    /*
     * Second mount: the rejected load must NOT have been cached — the
     * component retries the import, which now succeeds, and the diagram
     * renders. Before the fix, the module-scope promise cache pinned the
     * first rejection forever and this mount showed the error again.
     */
    const second: ReturnType<typeof render> = render(
      <MermaidDiagram chart={chart} />,
    );

    await waitFor((): void => {
      expect(mockMermaidState.renderCalls).toContain(chart);
    });

    expect(mockMermaidState.factoryAttempts).toBe(2);

    await waitFor((): void => {
      expect(second.container.querySelector("svg")).not.toBeNull();
    });
    expect(second.container.querySelector("pre.text-red-500")).toBeNull();
  });
});
