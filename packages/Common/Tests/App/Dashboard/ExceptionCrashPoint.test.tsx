import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ExceptionCrashPoint, {
  CRASH_POINT_MAX_CALLERS,
  CRASH_POINT_RAW_LINE_COUNT,
  EXCEPTION_CRASH_POINT_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionCrashPoint";
import Route from "../../../Types/API/Route";
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
} from "../../../Types/Telemetry/SourceMap";
import { findNestedControls } from "../../Helpers/NestedControls";

/*
 * WHERE IT HAPPENED, ON THE EXCEPTION'S OVERVIEW.
 *
 * What a person opening an exception reads first: the line it was most
 * likely raised from - the first frame of their own code, where a source
 * map put it, with the source around it - and the few frames of their code
 * that called it, without opening the Stack Trace page. A trace without
 * structured frames shows the part of it worth reading first; an exception
 * without a stack trace shows nothing.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

const STACK_TRACE_ROUTE: Route = new Route(
  "/dashboard/70000000-0000-4000-8000-000000000001/exceptions/70000000-0000-4000-8000-000000000002/stack-trace",
);

const STACK_TRACE: string = [
  "InventoryReservationError: Could not reserve 3 units of SKU-4821",
  "    at reserveInventory (/app/dist/services/inventory.js:212:17)",
  "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
  "    at submitOrder (/app/dist/services/order.js:88:24)",
  "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
  "    at next (/app/node_modules/express/lib/router/route.js:149:13)",
  "    at Route.dispatch (/app/node_modules/express/lib/router/route.js:119:3)",
].join("\n");

const minified: (
  functionName: string,
  fileName: string,
  inApp: boolean,
  lineNumber: number,
  columnNumber: number,
) => MinifiedStackFrame = (
  functionName: string,
  fileName: string,
  inApp: boolean,
  lineNumber: number,
  columnNumber: number,
): MinifiedStackFrame => {
  return { functionName, fileName, lineNumber, columnNumber, inApp };
};

// The trace above, as the latest occurrence recorded it: innermost first.
const FRAMES: Array<MinifiedStackFrame> = [
  minified(
    "reserveInventory",
    "/app/dist/services/inventory.js",
    true,
    212,
    17,
  ),
  minified(
    "processTicksAndRejections",
    "node:internal/process/task_queues",
    false,
    95,
    5,
  ),
  minified("submitOrder", "/app/dist/services/order.js", true, 88, 24),
  minified(
    "Layer.handle",
    "/app/node_modules/express/lib/router/layer.js",
    false,
    95,
    5,
  ),
  minified(
    "next",
    "/app/node_modules/express/lib/router/route.js",
    false,
    149,
    13,
  ),
  minified(
    "Route.dispatch",
    "/app/node_modules/express/lib/router/route.js",
    false,
    119,
    3,
  ),
];

// The same frames through the release's source map: the crash point resolved.
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

const renderCard: (
  props?: Partial<React.ComponentProps<typeof ExceptionCrashPoint>>,
) => { container: HTMLElement } = (
  props: Partial<React.ComponentProps<typeof ExceptionCrashPoint>> = {},
): { container: HTMLElement } => {
  return render(
    <MemoryRouter>
      <ExceptionCrashPoint
        stackTrace={STACK_TRACE}
        parsedFrames={JSON.stringify(FRAMES)}
        isLoading={false}
        stackTraceRoute={STACK_TRACE_ROUTE}
        {...props}
      />
    </MemoryRouter>,
  );
};

const callers: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.queryAllByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.caller);
};

afterEach(() => {
  cleanup();
});

describe("Where it happened: the first frame of the application's own code", () => {
  test("is the card's frame, by its function and shortened location, the whole path under the pointer", () => {
    renderCard();

    expect(screen.getByText("Where it happened")).toBeInTheDocument();

    const frame: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.frame,
    );

    expect(frame).toHaveAttribute("data-in-app", "true");
    expect(frame).toHaveAttribute("data-frame-index", "0");
    expect(
      within(frame).getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.function),
    ).toHaveTextContent("reserveInventory");

    const location: HTMLElement = within(frame).getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.location,
    );

    expect(location).toHaveTextContent(".../dist/services/inventory.js:212:17");
    expect(location).toHaveAttribute(
      "title",
      "/app/dist/services/inventory.js:212:17",
    );
  });

  test("says it is the first frame of your own code", () => {
    renderCard();

    expect(
      screen.getByText(
        "The first frame in your own code: the most likely place the error was raised.",
      ),
    ).toBeInTheDocument();
  });

  test("passes over a runtime frame above it to the application's code", () => {
    renderCard({
      parsedFrames: JSON.stringify([
        minified("JSON.parse", "<anonymous>", false, 0, 0),
        ...FRAMES,
      ]),
    });

    const frame: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.frame,
    );

    expect(frame).toHaveAttribute("data-frame-index", "1");
    expect(
      within(frame).getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.function),
    ).toHaveTextContent("reserveInventory");
  });

  test("lists the application's frames that called it, nearest first, the library frames between left out", () => {
    renderCard();

    const list: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.callers,
    );

    expect(within(list).getByText("Called from")).toBeInTheDocument();
    expect(callers()).toHaveLength(1);
    expect(callers()[0]).toHaveAttribute("data-frame-index", "2");
    expect(callers()[0]).toHaveTextContent("submitOrder");
    expect(callers()[0]).toHaveTextContent(".../dist/services/order.js:88:24");
    expect(list).not.toHaveTextContent("Layer.handle");
    expect(list).not.toHaveTextContent("processTicksAndRejections");
  });

  test(`lists at most ${CRASH_POINT_MAX_CALLERS} callers`, () => {
    const deep: Array<MinifiedStackFrame> = [
      "validate",
      "parse",
      "load",
      "handle",
      "serve",
      "listen",
    ].map((name: string, index: number): MinifiedStackFrame => {
      return minified(name, `/app/src/${name}.js`, true, index + 1, 1);
    });

    renderCard({ parsedFrames: JSON.stringify(deep) });

    expect(callers()).toHaveLength(CRASH_POINT_MAX_CALLERS);
    expect(
      callers().map((caller: HTMLElement): string | null => {
        return caller.getAttribute("data-frame-index");
      }),
    ).toEqual(["1", "2", "3"]);
    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.summary),
    ).toHaveTextContent("6 frames · 6 in your code");
  });

  test("a crash point nothing of the application's called draws no Called from", () => {
    renderCard({
      parsedFrames: JSON.stringify([FRAMES[0], FRAMES[1], FRAMES[3]]),
    });

    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.frame),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.callers),
    ).toBeNull();
    expect(screen.queryByText("Called from")).toBeNull();
  });

  test("counts the frames, and those of the application's own code, beside the link to every frame", () => {
    renderCard();

    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.summary),
    ).toHaveTextContent("6 frames · 2 in your code");

    const link: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.stackTraceLink,
    );

    expect(link).toHaveTextContent("View full stack trace");
    expect(link).toHaveAttribute("href", STACK_TRACE_ROUTE.toString());
  });

  test("a frame with no function name reads <anonymous>", () => {
    renderCard({
      parsedFrames: JSON.stringify([
        minified("", "/app/dist/index.js", true, 3, 9),
      ]),
    });

    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.function),
    ).toHaveTextContent("<anonymous>");
    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.summary),
    ).toHaveTextContent("1 frame · 1 in your code");
  });

  test("has no control inside another", () => {
    const { container } = renderCard({ resolvedFrames: RESOLVED });

    expect(findNestedControls(container)).toEqual([]);
  });
});

describe("Where it happened, through a source map", () => {
  test("names the original function and file, and shows the source around the line", () => {
    renderCard({ resolvedFrames: RESOLVED });

    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.function),
    ).toHaveTextContent("InventoryService.reserveInventory");

    const location: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.location,
    );

    // Three parts or fewer: the whole path.
    expect(location).toHaveTextContent("src/services/inventory.ts:187:13");
    expect(location).toHaveAttribute(
      "title",
      "src/services/inventory.ts:187:13",
    );

    const snippet: HTMLElement = screen.getByTestId(
      "stack-frame-source-snippet",
    );

    expect(snippet).toHaveTextContent(
      "throw new InventoryReservationError(sku);",
    );
    expect(snippet).toHaveTextContent("187");
  });

  test("without the source in the map, draws no snippet", () => {
    renderCard();

    expect(screen.queryByTestId("stack-frame-source-snippet")).toBeNull();
  });

  test("a map that does not match the frames is not laid over them", () => {
    renderCard({ resolvedFrames: RESOLVED.slice(0, 2) });

    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.function),
    ).toHaveTextContent("reserveInventory");
    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.function),
    ).not.toHaveTextContent("InventoryService");
    expect(screen.queryByTestId("stack-frame-source-snippet")).toBeNull();
  });
});

describe("Where it happened, with no frame of the application's own", () => {
  const LIBRARY_ONLY: Array<MinifiedStackFrame> = [
    minified("JSON.parse", "<anonymous>", false, 0, 0),
    minified(
      "readBody",
      "/app/node_modules/body-parser/lib/read.js",
      false,
      130,
      18,
    ),
    minified(
      "next",
      "/app/node_modules/express/lib/router/index.js",
      false,
      280,
      10,
    ),
    minified(
      "handle",
      "/app/node_modules/express/lib/router/layer.js",
      false,
      95,
      5,
    ),
    minified("listOnTimeout", "node:internal/timers", false, 569, 17),
  ];

  test("is the innermost frame, and says no frame is in your own code", () => {
    renderCard({ parsedFrames: JSON.stringify(LIBRARY_ONLY) });

    const frame: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.frame,
    );

    expect(frame).toHaveAttribute("data-in-app", "false");
    expect(frame).toHaveAttribute("data-frame-index", "0");
    expect(frame).toHaveTextContent("JSON.parse");
    expect(
      screen.getByText(
        "No frame is in your own code, so this is the innermost frame of the stack trace.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "The first frame in your own code: the most likely place the error was raised.",
      ),
    ).toBeNull();
  });

  test("lists the frames under it, whatever code they are", () => {
    renderCard({ parsedFrames: JSON.stringify(LIBRARY_ONLY) });

    expect(
      callers().map((caller: HTMLElement): string | null => {
        return caller.getAttribute("data-frame-index");
      }),
    ).toEqual(["1", "2", "3"]);
    expect(callers()[0]).toHaveTextContent("readBody");
    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.summary),
    ).toHaveTextContent("5 frames · 0 in your code");
  });
});

describe("Where it happened, in a Python traceback", () => {
  // Python prints the outermost frame first and the crash point last.
  const PYTHON_TRACE: string = [
    "Traceback (most recent call last):",
    '  File "/srv/app/main.py", line 9, in <module>',
    "    run()",
    '  File "/srv/app/server.py", line 22, in run',
    "    handle(request)",
    '  File "/srv/app/routes.py", line 61, in handle',
    "    submit(order)",
    '  File "/srv/app/checkout.py", line 41, in submit',
    "    reserve(order.sku)",
    '  File "/srv/venv/lib/python3.12/site-packages/inventory/client.py", line 17, in reserve',
    "    raise ValueError(f'bad sku {sku}')",
    "ValueError: bad sku 42",
  ].join("\n");

  // As printed: outermost first.
  const PYTHON_FRAMES: Array<MinifiedStackFrame> = [
    minified("<module>", "/srv/app/main.py", true, 9, 0),
    minified("run", "/srv/app/server.py", true, 22, 0),
    minified("handle", "/srv/app/routes.py", true, 61, 0),
    minified("submit", "/srv/app/checkout.py", true, 41, 0),
    minified(
      "reserve",
      "/srv/venv/lib/python3.12/site-packages/inventory/client.py",
      false,
      17,
      0,
    ),
  ];

  test("its crash point is the innermost frame of the application's code, the last of its own printed", () => {
    renderCard({
      stackTrace: PYTHON_TRACE,
      parsedFrames: JSON.stringify(PYTHON_FRAMES),
    });

    const frame: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.frame,
    );

    expect(frame).toHaveAttribute("data-in-app", "true");
    expect(
      within(frame).getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.function),
    ).toHaveTextContent("submit");
    expect(
      within(frame).getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.location),
    ).toHaveTextContent("/srv/app/checkout.py:41");
  });

  test("its callers are the frames printed above it, nearest first", () => {
    renderCard({
      stackTrace: PYTHON_TRACE,
      parsedFrames: JSON.stringify(PYTHON_FRAMES),
    });

    expect(
      callers().map((caller: HTMLElement): string => {
        // Its function, before its location.
        return caller.firstElementChild?.textContent || "";
      }),
    ).toEqual(["handle", "run", "<module>"]);
  });

  test("without structured frames, shows the traceback's last lines, where the error is", () => {
    renderCard({
      stackTrace: PYTHON_TRACE,
      parsedFrames: undefined,
    });

    const raw: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.raw,
    );
    const lines: Array<string> = PYTHON_TRACE.split("\n");

    expect(CRASH_POINT_RAW_LINE_COUNT).toBeLessThan(lines.length);
    expect(raw.textContent!.split("\n")).toEqual(
      lines.slice(lines.length - CRASH_POINT_RAW_LINE_COUNT),
    );
    expect(raw).not.toHaveTextContent("Traceback (most recent call last):");
    expect(raw.textContent!.split("\n").pop()).toBe("ValueError: bad sku 42");
    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.summary),
    ).toHaveTextContent(
      `${lines.length - CRASH_POINT_RAW_LINE_COUNT} more lines`,
    );
  });
});

describe("Where it happened, without structured frames", () => {
  const LONG_TRACE: string = [
    "java.lang.IllegalStateException: Order 1182 has no lines",
    "\tat com.shop.checkout.OrderService.submit(OrderService.java:88)",
    "\tat com.shop.checkout.CheckoutController.post(CheckoutController.java:41)",
    "\tat jdk.internal.reflect.GeneratedMethodAccessor112.invoke(Unknown Source)",
    "\tat java.base/java.lang.reflect.Method.invoke(Method.java:568)",
    "\tat org.springframework.web.method.support.InvocableHandlerMethod.doInvoke(InvocableHandlerMethod.java:205)",
    "",
    "\tat org.springframework.web.servlet.FrameworkServlet.service(FrameworkServlet.java:883)",
    "\tat jakarta.servlet.http.HttpServlet.service(HttpServlet.java:658)",
    "\tat org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:166)",
    "\tat org.apache.tomcat.util.threads.TaskThread$WrappingRunnable.run(TaskThread.java:61)",
    "\tat java.base/java.lang.Thread.run(Thread.java:840)",
  ].join("\n");

  test("shows the trace's first lines as they are, and counts the rest", () => {
    renderCard({ stackTrace: LONG_TRACE, parsedFrames: undefined });

    const raw: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.raw,
    );
    const nonBlank: Array<string> = LONG_TRACE.split("\n").filter(
      (line: string): boolean => {
        return line.trim().length > 0;
      },
    );

    expect(raw.textContent!.split("\n")).toEqual(
      nonBlank.slice(0, CRASH_POINT_RAW_LINE_COUNT),
    );
    expect(raw.textContent!.split("\n")[0]).toBe(
      "java.lang.IllegalStateException: Order 1182 has no lines",
    );
    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.summary),
    ).toHaveTextContent(
      `${nonBlank.length - CRASH_POINT_RAW_LINE_COUNT} more lines`,
    );
    expect(
      screen.getByText(
        "Structured frames were not recorded for the latest occurrence.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.frame),
    ).toBeNull();
  });

  test("one line more is one more line", () => {
    const lines: Array<string> = LONG_TRACE.split("\n")
      .filter((line: string): boolean => {
        return line.trim().length > 0;
      })
      .slice(0, CRASH_POINT_RAW_LINE_COUNT + 1);

    renderCard({ stackTrace: lines.join("\n"), parsedFrames: "" });

    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.summary),
    ).toHaveTextContent("1 more line");
    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.summary),
    ).not.toHaveTextContent("1 more lines");
  });

  test("a short trace is shown whole, with no count, and the link to the Stack Trace page", () => {
    renderCard({ parsedFrames: "[]" });

    const raw: HTMLElement = screen.getByTestId(
      EXCEPTION_CRASH_POINT_TEST_IDS.raw,
    );

    expect(raw.textContent!.split("\n")).toEqual(STACK_TRACE.split("\n"));
    expect(
      screen.queryByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.summary),
    ).toBeNull();
    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.stackTraceLink),
    ).toHaveAttribute("href", STACK_TRACE_ROUTE.toString());
  });

  test("frames that are not JSON are read as none", () => {
    renderCard({ parsedFrames: "{not json" });

    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.raw),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.frame),
    ).toBeNull();
  });
});

describe("Where it happened, before the latest occurrence is read", () => {
  test("shows a loader, no frame and no description", () => {
    renderCard({ isLoading: true });

    expect(
      screen.getByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.loading),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.frame),
    ).toBeNull();
    expect(screen.queryByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.raw)).toBeNull();
    expect(
      screen.queryByText(
        "The first frame in your own code: the most likely place the error was raised.",
      ),
    ).toBeNull();
    expect(
      screen.queryByText(
        "Structured frames were not recorded for the latest occurrence.",
      ),
    ).toBeNull();
    // Still the card it will be.
    expect(screen.getByText("Where it happened")).toBeInTheDocument();
  });
});

describe("Where it happened, for an exception without a stack trace", () => {
  test.each([[undefined], [""]] as Array<[string | undefined]>)(
    "draws nothing (stack trace %j): the Stack Trace page says why",
    (stackTrace: string | undefined) => {
      const { container } = renderCard({
        stackTrace,
        parsedFrames: JSON.stringify(FRAMES),
      });

      expect(container).toBeEmptyDOMElement();
      expect(
        screen.queryByTestId(EXCEPTION_CRASH_POINT_TEST_IDS.card),
      ).toBeNull();
    },
  );

  test("draws nothing while loading either", () => {
    const { container } = renderCard({
      stackTrace: undefined,
      isLoading: true,
    });

    expect(container).toBeEmptyDOMElement();
  });
});
