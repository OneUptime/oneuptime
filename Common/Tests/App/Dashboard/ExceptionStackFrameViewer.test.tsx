import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import StackFrameViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/StackFrameViewer";
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
} from "../../../Types/Telemetry/SourceMap";

/*
 * The Stack Trace page. Frames arrive parsed from the latest occurrence and,
 * when source maps were uploaded, resolved back to original source. The
 * viewer must open on the crash point, let several frames be compared, fold
 * library noise, and never lose the raw trace.
 */

const STACK_TRACE: string = [
  "InventoryReservationError: Could not reserve 3 units of SKU-4821",
  "    at reserveInventory (/app/dist/services/inventory.js:212:17)",
  "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
  "    at submitOrder (/app/dist/services/order.js:88:24)",
  "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
  "    at next (/app/node_modules/express/lib/router/route.js:149:13)",
  "    at Route.dispatch (/app/node_modules/express/lib/router/route.js:119:3)",
].join("\n");

const FRAMES: Array<MinifiedStackFrame> = [
  {
    functionName: "reserveInventory",
    fileName: "/app/dist/services/inventory.js",
    lineNumber: 212,
    columnNumber: 17,
    inApp: true,
  },
  {
    functionName: "processTicksAndRejections",
    fileName: "node:internal/process/task_queues",
    lineNumber: 95,
    columnNumber: 5,
    inApp: false,
  },
  {
    functionName: "submitOrder",
    fileName: "/app/dist/services/order.js",
    lineNumber: 88,
    columnNumber: 24,
    inApp: true,
  },
  {
    functionName: "Layer.handle",
    fileName: "/app/node_modules/express/lib/router/layer.js",
    lineNumber: 95,
    columnNumber: 5,
    inApp: false,
  },
  {
    functionName: "next",
    fileName: "/app/node_modules/express/lib/router/route.js",
    lineNumber: 149,
    columnNumber: 13,
    inApp: false,
  },
  {
    functionName: "Route.dispatch",
    fileName: "/app/node_modules/express/lib/router/route.js",
    lineNumber: 119,
    columnNumber: 3,
    inApp: false,
  },
];

const RESOLVED: Array<ResolvedStackFrame> = FRAMES.map(
  (frame: MinifiedStackFrame, index: number): ResolvedStackFrame => {
    if (index === 0) {
      return {
        ...frame,
        resolved: true,
        originalFileName: "src/services/inventory.ts",
        originalLineNumber: 187,
        originalColumnNumber: 13,
        originalFunctionName: "InventoryService.reserveInventory",
        sourceCodeSnippet: {
          startLine: 186,
          highlightLine: 187,
          lines: [
            "    if (current.version !== expectedVersion) {",
            "      throw new InventoryReservationError(sku);",
            "    }",
          ],
        },
      };
    }

    return { ...frame, resolved: false };
  },
);

function renderViewer(
  props: Partial<React.ComponentProps<typeof StackFrameViewer>> = {},
): void {
  render(
    <StackFrameViewer
      stackTrace={STACK_TRACE}
      parsedFrames={JSON.stringify(FRAMES)}
      {...props}
    />,
  );
}

function frameRows(): Array<HTMLElement> {
  return screen.queryAllByTestId("stack-frame");
}

function frameNumbers(): Array<string | null> {
  return frameRows().map((row: HTMLElement) => {
    return row.getAttribute("data-frame-index");
  });
}

function toggleOf(index: number): HTMLElement {
  const row: HTMLElement | undefined = frameRows().find(
    (candidate: HTMLElement) => {
      return candidate.getAttribute("data-frame-index") === String(index);
    },
  );

  if (!row) {
    throw new Error(`Frame ${index} is not on screen`);
  }

  return within(row).getAllByRole("button")[0]!;
}

afterEach(() => {
  cleanup();
});

describe("StackFrameViewer", () => {
  test("summarizes the trace and shows the exception line with the crash point", () => {
    renderViewer();

    expect(
      screen.getByText("6 frames · 2 in your code", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("stack-trace-headline")).toHaveTextContent(
      "InventoryReservationError: Could not reserve 3 units of SKU-4821",
    );
    expect(screen.getByTestId("stack-trace-crash-point")).toHaveTextContent(
      "Most likely crash point: reserveInventory in .../dist/services/inventory.js:212",
    );
  });

  test("opens the crash point by default and marks it", () => {
    renderViewer();

    const crash: HTMLElement = toggleOf(0);
    expect(crash).toHaveAttribute("aria-expanded", "true");
    expect(
      within(frameRows()[0]!).getByTestId("stack-frame-badge-crash"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("stack-frame-detail")).toHaveLength(1);
  });

  test("smart view folds runs of library frames and a group can be unfolded", () => {
    renderViewer();

    expect(frameNumbers()).toEqual(["0", "1", "2"]);
    const group: HTMLElement = screen.getByTestId("stack-frame-group");
    expect(group).toHaveTextContent(
      "3 library frames hidden in .../express/lib/router",
    );

    fireEvent.click(within(group).getByRole("button"));

    expect(frameNumbers()).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(screen.queryByTestId("stack-frame-group")).not.toBeInTheDocument();
  });

  test("App only and All switch the frames on screen", () => {
    renderViewer();

    fireEvent.click(screen.getByTestId("stack-trace-view-app"));
    expect(frameNumbers()).toEqual(["0", "2"]);

    fireEvent.click(screen.getByTestId("stack-trace-view-all"));
    expect(frameNumbers()).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(screen.getByTestId("stack-trace-view-all")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("frames can be listed oldest first", () => {
    renderViewer();

    fireEvent.click(screen.getByTestId("stack-trace-view-all"));
    fireEvent.click(screen.getByTestId("stack-trace-order-oldest"));

    expect(frameNumbers()).toEqual(["5", "4", "3", "2", "1", "0"]);
  });

  test("several frames can be open at once, and expand all / collapse all work", () => {
    renderViewer();

    fireEvent.click(toggleOf(2));
    expect(toggleOf(0)).toHaveAttribute("aria-expanded", "true");
    expect(toggleOf(2)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("stack-frame-detail")).toHaveLength(2);

    fireEvent.click(toggleOf(0));
    expect(toggleOf(0)).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByTestId("stack-trace-expand-all"));
    expect(screen.getAllByTestId("stack-frame-detail")).toHaveLength(3);
    expect(screen.getByTestId("stack-trace-expand-all")).toHaveTextContent(
      "Collapse all",
    );

    fireEvent.click(screen.getByTestId("stack-trace-expand-all"));
    expect(screen.queryAllByTestId("stack-frame-detail")).toHaveLength(0);
  });

  test("names the package a library frame comes from", () => {
    renderViewer();

    fireEvent.click(screen.getByTestId("stack-trace-view-all"));

    const origins: Array<string> = frameRows().map((row: HTMLElement) => {
      return (
        within(row).getByTestId("stack-frame-badge-origin").textContent || ""
      );
    });

    expect(origins).toEqual([
      "In app",
      "node",
      "In app",
      "express",
      "express",
      "express",
    ]);
  });

  test("shows original source for a source-mapped frame", () => {
    renderViewer({ resolvedFrames: RESOLVED });

    expect(
      screen.getByText("6 frames · 2 in your code · 1 source mapped"),
    ).toBeInTheDocument();

    const crashRow: HTMLElement = frameRows()[0]!;
    expect(
      within(crashRow).getByTestId("stack-frame-function"),
    ).toHaveTextContent("InventoryService.reserveInventory");
    expect(
      within(crashRow).getByTestId("stack-frame-badge-mapped"),
    ).toBeInTheDocument();

    const detail: HTMLElement =
      within(crashRow).getByTestId("stack-frame-detail");
    expect(detail).toHaveTextContent("src/services/inventory.ts:187:13");
    expect(detail).toHaveTextContent("/app/dist/services/inventory.js:212:17");

    const highlighted: HTMLElement | null = within(detail)
      .getByTestId("stack-frame-source-snippet")
      .querySelector("tr[data-highlighted='true']");
    expect(highlighted).toHaveTextContent(
      "187 throw new InventoryReservationError(sku);",
    );
  });

  test("warns when source maps were too large to load", () => {
    renderViewer({ skippedSourceMapCount: 2 });

    expect(
      screen.getByTestId("stack-trace-source-maps-skipped"),
    ).toHaveTextContent("2 source maps were too large to load");
  });

  test("the raw tab keeps the full trace, highlights the message and can wrap", () => {
    renderViewer();

    fireEvent.click(screen.getByTestId("stack-trace-tab-raw"));

    const raw: HTMLElement = screen.getByTestId("raw-stack-trace");
    expect(raw.querySelectorAll("tr")).toHaveLength(7);
    expect(raw).toHaveTextContent(
      "InventoryReservationError: Could not reserve",
    );
    expect(raw).toHaveTextContent(
      "/app/node_modules/express/lib/router/route.js:119:3",
    );
    expect(raw).toHaveAttribute("data-wrap", "false");

    fireEvent.click(screen.getByTestId("stack-trace-wrap"));
    expect(screen.getByTestId("raw-stack-trace")).toHaveAttribute(
      "data-wrap",
      "true",
    );
    expect(frameRows()).toHaveLength(0);
  });

  test("falls back to the raw trace when no frames were parsed", () => {
    renderViewer({ parsedFrames: "not json" });

    expect(screen.getByTestId("raw-stack-trace")).toBeInTheDocument();
    expect(screen.queryByTestId("stack-trace-tab")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Structured frames were not recorded/),
    ).toBeInTheDocument();
  });

  test("says so when no frame is application code", () => {
    renderViewer({
      parsedFrames: JSON.stringify(
        FRAMES.map((frame: MinifiedStackFrame) => {
          return { ...frame, inApp: false };
        }),
      ),
    });

    expect(screen.getByTestId("stack-trace-crash-point")).toHaveTextContent(
      "No frame was identified as your own code",
    );
    expect(screen.queryByTestId("stack-trace-view")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("stack-frame-detail")).toHaveLength(0);
  });

  test("an all-library trace shows every frame, and Expand all opens them", () => {
    renderViewer({
      parsedFrames: JSON.stringify(
        FRAMES.map((frame: MinifiedStackFrame) => {
          return { ...frame, inApp: false };
        }),
      ),
    });

    // Nothing is folded away behind a view switch that is not on screen.
    expect(screen.queryByTestId("stack-frame-group")).not.toBeInTheDocument();
    expect(frameNumbers()).toEqual(["0", "1", "2", "3", "4", "5"]);

    fireEvent.click(screen.getByTestId("stack-trace-expand-all"));

    expect(screen.getAllByTestId("stack-frame-detail")).toHaveLength(6);
    expect(screen.getByTestId("stack-trace-expand-all")).toHaveTextContent(
      "Collapse all",
    );
  });

  test("a Python traceback opens on the innermost frame and names its exception", () => {
    const pythonTrace: string = [
      "Traceback (most recent call last):",
      '  File "/srv/app/main.py", line 9, in <module>',
      "    checkout.submit(order)",
      '  File "/usr/lib/python3.12/site-packages/retry/api.py", line 33, in wrapper',
      "    return f(*args)",
      '  File "/srv/app/checkout.py", line 41, in submit',
      "    reserve(order)",
      "ValueError: bad sku 'SKU-4821'",
    ].join("\n");

    // The parser stores Python frames in printed order: entry point first.
    renderViewer({
      stackTrace: pythonTrace,
      parsedFrames: JSON.stringify([
        {
          functionName: "<module>",
          fileName: "/srv/app/main.py",
          lineNumber: 9,
          inApp: true,
        },
        {
          functionName: "wrapper",
          fileName: "/usr/lib/python3.12/site-packages/retry/api.py",
          lineNumber: 33,
          inApp: false,
        },
        {
          functionName: "submit",
          fileName: "/srv/app/checkout.py",
          lineNumber: 41,
          inApp: true,
        },
      ]),
    });

    expect(screen.getByTestId("stack-trace-headline")).toHaveTextContent(
      "ValueError: bad sku 'SKU-4821'",
    );
    expect(screen.getByTestId("stack-trace-crash-point")).toHaveTextContent(
      "Most likely crash point: submit in .../srv/app/checkout.py:41",
    );

    const functions: Array<string> = frameRows().map((row: HTMLElement) => {
      return within(row).getByTestId("stack-frame-function").textContent || "";
    });
    expect(functions).toEqual(["submit", "wrapper", "<module>"]);
    expect(toggleOf(0)).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByTestId("stack-trace-order-oldest"));
    expect(
      frameRows().map((row: HTMLElement) => {
        return within(row).getByTestId("stack-frame-function").textContent;
      }),
    ).toEqual(["<module>", "wrapper", "submit"]);
  });

  test("the raw tab shows every line exactly as recorded", () => {
    const javaTrace: string = [
      "java.lang.IllegalStateException: stock changed",
      "\tat com.shop.Inventory.reserve(Inventory.java:87)",
      "    at   spaced   (/app/run.js:1:2)",
    ].join("\n");

    renderViewer({ stackTrace: javaTrace, parsedFrames: "not json" });

    const cells: Array<string> = Array.from(
      screen.getByTestId("raw-stack-trace").querySelectorAll("tr"),
    ).map((row: HTMLTableRowElement) => {
      return row.querySelectorAll("td")[1]!.textContent || "";
    });

    expect(cells).toEqual(javaTrace.split("\n"));
  });

  test("copies the raw trace", () => {
    renderViewer();

    expect(
      screen.getByRole("button", { name: "Copy the raw stack trace" }),
    ).toBeInTheDocument();
  });
});
