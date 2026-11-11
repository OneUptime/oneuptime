import { describe, expect, test } from "@jest/globals";
import { ResolvedStackFrame } from "Common/Types/Telemetry/SourceMap";
import {
  RawStackTraceExcerpt,
  RawStackTraceLine,
  StackTraceCrashPoint,
  StackTraceDisplayItem,
  StackTraceFrameOrder,
  StackTraceViewMode,
  buildStackTraceDisplayItems,
  formatFrameLocation,
  getFramePackageName,
  getRawStackTraceExcerpt,
  getStackTraceCrashPoint,
  getStackTraceHeadline,
  isOutermostFirstStackTrace,
  orderFramesInnermostFirst,
  getTopAppFrameIndex,
  getVisibleFrameIndexes,
  orderStackTraceDisplayItems,
  parseRawStackTraceLines,
  shortenFramePath,
} from "../../FeatureSet/Dashboard/src/Utils/StackTracePresentation";

function frame(
  functionName: string,
  fileName: string,
  inApp: boolean,
  lineNumber: number = 10,
): ResolvedStackFrame {
  return {
    functionName,
    fileName,
    lineNumber,
    columnNumber: 3,
    inApp,
    resolved: false,
  };
}

/*
 * lib, app, lib, lib, lib, app, lib — the shape of a real Express trace:
 * runtime frames around the application code, with the router's frames in
 * a run.
 */
const FRAMES: Array<ResolvedStackFrame> = [
  frame(
    "processTicksAndRejections",
    "node:internal/process/task_queues",
    false,
  ),
  frame("reserveInventory", "/app/dist/services/inventory.js", true),
  frame("Layer.handle", "/app/node_modules/express/lib/router/layer.js", false),
  frame("next", "/app/node_modules/express/lib/router/route.js", false),
  frame(
    "Route.dispatch",
    "/app/node_modules/express/lib/router/route.js",
    false,
  ),
  frame("handleCheckout", "/app/dist/routes/checkout.js", true),
  frame("", "/app/node_modules/express/lib/router/index.js", false),
];

function describeItems(items: Array<StackTraceDisplayItem>): Array<string> {
  return items.map((item: StackTraceDisplayItem): string => {
    if (item.kind === "collapsed-lib") {
      return `group@${item.startIndex}x${item.frames.length}`;
    }

    return `${item.originalIndex}${item.isTopAppFrame ? "*" : ""}`;
  });
}

describe("getTopAppFrameIndex", () => {
  test("finds the first application frame", () => {
    expect(getTopAppFrameIndex(FRAMES)).toBe(1);
  });

  test("is -1 when every frame is library code", () => {
    expect(getTopAppFrameIndex([frame("a", "/lib/a.js", false)])).toBe(-1);
    expect(getTopAppFrameIndex([])).toBe(-1);
  });
});

describe("buildStackTraceDisplayItems", () => {
  test("All shows every frame in order and marks the crash point", () => {
    expect(
      describeItems(
        buildStackTraceDisplayItems({
          frames: FRAMES,
          viewMode: StackTraceViewMode.All,
          expandedLibGroups: new Set(),
        }),
      ),
    ).toEqual(["0", "1*", "2", "3", "4", "5", "6"]);
  });

  test("App only keeps the original frame numbers", () => {
    expect(
      describeItems(
        buildStackTraceDisplayItems({
          frames: FRAMES,
          viewMode: StackTraceViewMode.AppOnly,
          expandedLibGroups: new Set(),
        }),
      ),
    ).toEqual(["1*", "5"]);
  });

  test("Smart folds runs of library frames but leaves lone ones visible", () => {
    const items: Array<StackTraceDisplayItem> = buildStackTraceDisplayItems({
      frames: FRAMES,
      viewMode: StackTraceViewMode.Smart,
      expandedLibGroups: new Set(),
    });

    expect(describeItems(items)).toEqual(["0", "1*", "group@2x3", "5", "6"]);

    const group: StackTraceDisplayItem = items[2]!;
    expect(group.kind).toBe("collapsed-lib");
    expect(group.kind === "collapsed-lib" && group.commonPackage).toBe(
      ".../express/lib/router",
    );
  });

  test("Smart unfolds a group the user expanded", () => {
    expect(
      describeItems(
        buildStackTraceDisplayItems({
          frames: FRAMES,
          viewMode: StackTraceViewMode.Smart,
          expandedLibGroups: new Set([2]),
        }),
      ),
    ).toEqual(["0", "1*", "2", "3", "4", "5", "6"]);
  });

  test("a trailing run of library frames is folded too", () => {
    const frames: Array<ResolvedStackFrame> = [
      frame("app", "/app/src/a.ts", true),
      frame("x", "/lib/one/x.js", false),
      frame("y", "/lib/two/y.js", false),
    ];

    const items: Array<StackTraceDisplayItem> = buildStackTraceDisplayItems({
      frames,
      viewMode: StackTraceViewMode.Smart,
      expandedLibGroups: new Set(),
    });

    expect(describeItems(items)).toEqual(["0*", "group@1x2"]);
    // Frames from different directories share no package label.
    expect(items[1]!.kind === "collapsed-lib" && items[1]!.commonPackage).toBe(
      "",
    );
  });

  test("no application frames means nothing is marked as the crash point", () => {
    const frames: Array<ResolvedStackFrame> = [
      frame("a", "/lib/a.js", false),
      frame("b", "/lib/b.js", false),
    ];

    expect(
      describeItems(
        buildStackTraceDisplayItems({
          frames,
          viewMode: StackTraceViewMode.All,
          expandedLibGroups: new Set(),
        }),
      ),
    ).toEqual(["0", "1"]);
  });

  test("an empty frame list renders nothing in any mode", () => {
    for (const viewMode of Object.values(StackTraceViewMode)) {
      expect(
        buildStackTraceDisplayItems({
          frames: [],
          viewMode,
          expandedLibGroups: new Set(),
        }),
      ).toEqual([]);
    }
  });
});

describe("orderStackTraceDisplayItems", () => {
  const items: Array<StackTraceDisplayItem> = buildStackTraceDisplayItems({
    frames: FRAMES,
    viewMode: StackTraceViewMode.Smart,
    expandedLibGroups: new Set(),
  });

  test("keeps the runtime's newest-first order by default", () => {
    expect(
      describeItems(
        orderStackTraceDisplayItems(items, StackTraceFrameOrder.NewestFirst),
      ),
    ).toEqual(["0", "1*", "group@2x3", "5", "6"]);
  });

  test("reverses to put the entry point first, without touching the input", () => {
    expect(
      describeItems(
        orderStackTraceDisplayItems(items, StackTraceFrameOrder.OldestFirst),
      ),
    ).toEqual(["6", "5", "group@2x3", "1*", "0"]);
    expect(describeItems(items)).toEqual(["0", "1*", "group@2x3", "5", "6"]);
  });
});

describe("getVisibleFrameIndexes", () => {
  test("lists frame numbers on screen and skips folded groups", () => {
    expect(
      getVisibleFrameIndexes(
        buildStackTraceDisplayItems({
          frames: FRAMES,
          viewMode: StackTraceViewMode.Smart,
          expandedLibGroups: new Set(),
        }),
      ),
    ).toEqual([0, 1, 5, 6]);
    expect(getVisibleFrameIndexes([])).toEqual([]);
  });
});

describe("getFramePackageName", () => {
  test.each([
    ["/app/node_modules/express/lib/router/layer.js", "express"],
    ["/app/node_modules/@nestjs/core/router/router-proxy.js", "@nestjs/core"],
    [
      "/app/node_modules/express/node_modules/body-parser/lib/read.js",
      "body-parser",
    ],
    ["C:\\app\\node_modules\\@scope\\pkg\\index.js", "@scope/pkg"],
    ["node:internal/process/task_queues", "node"],
    [
      "/usr/local/lib/python3.12/site-packages/django/core/handlers/base.py",
      "django",
    ],
    ["/usr/lib/python3/dist-packages/six.py", "six"],
    [
      "/root/go/pkg/mod/github.com/gin-gonic/gin@v1.9.1/context.go",
      "github.com/gin-gonic/gin",
    ],
    ["/app/dist/services/inventory.js", null],
    ["", null],
    [undefined, null],
  ])("%s → %s", (fileName: string | undefined, expected: string | null) => {
    expect(getFramePackageName(fileName)).toBe(expected);
  });
});

describe("getStackTraceHeadline", () => {
  test("returns the first line when it is the exception message", () => {
    expect(
      getStackTraceHeadline(
        "\n  TypeError: boom  \n    at run (/app/run.js:1:2)",
      ),
    ).toBe("TypeError: boom");
  });

  test("returns null when the trace starts with a frame or is empty", () => {
    expect(getStackTraceHeadline("    at run (/app/run.js:1:2)")).toBeNull();
    expect(getStackTraceHeadline("")).toBeNull();
    expect(getStackTraceHeadline(undefined)).toBeNull();
  });

  test("reads a Python traceback's exception line from the bottom", () => {
    expect(
      getStackTraceHeadline(
        [
          "Traceback (most recent call last):",
          '  File "/srv/app/checkout.py", line 41, in submit',
          "    reserve(order)",
          "ValueError: bad sku 'SKU-4821'",
          "",
        ].join("\n"),
      ),
    ).toBe("ValueError: bad sku 'SKU-4821'");
  });

  test("names the last exception of a chained Python traceback", () => {
    expect(
      getStackTraceHeadline(
        [
          "Traceback (most recent call last):",
          '  File "app.py", line 3, in <module>',
          "KeyError: 'sku'",
          "",
          "The above exception was the direct cause of the following exception:",
          "",
          "Traceback (most recent call last):",
          '  File "app.py", line 5, in <module>',
          "inventory.errors.ReservationError: stock changed",
        ].join("\r\n"),
      ),
    ).toBe("inventory.errors.ReservationError: stock changed");
  });

  test("skips notes printed after a Python exception line", () => {
    expect(
      getStackTraceHeadline(
        [
          "Traceback (most recent call last):",
          '  File "app.py", line 3, in <module>',
          "TimeoutError",
          "while reserving SKU-4821 (attempt 3 of 3)",
        ].join("\n"),
      ),
    ).toBe("TimeoutError");
  });

  test("has no Python headline when the traceback was cut before the message", () => {
    expect(
      getStackTraceHeadline(
        [
          "Traceback (most recent call last):",
          '  File "app.py", line 3, in <module>',
          "    reserve(sku)",
        ].join("\n"),
      ),
    ).toBeNull();
  });
});

describe("isOutermostFirstStackTrace / orderFramesInnermostFirst", () => {
  const PYTHON_TRACE: string = [
    "Traceback (most recent call last):",
    '  File "/srv/app/main.py", line 9, in <module>',
    '  File "/srv/app/checkout.py", line 41, in submit',
    "ValueError: bad sku",
  ].join("\n");

  test("recognises Python tracebacks only", () => {
    expect(isOutermostFirstStackTrace(PYTHON_TRACE)).toBe(true);
    expect(
      isOutermostFirstStackTrace("Error: boom\n    at run (/app/run.js:1:2)"),
    ).toBe(false);
    expect(
      isOutermostFirstStackTrace(
        "java.lang.Error: Traceback (most recent call last): in a message",
      ),
    ).toBe(false);
    expect(isOutermostFirstStackTrace("")).toBe(false);
    expect(isOutermostFirstStackTrace(undefined)).toBe(false);
  });

  test("turns Python frames around so the crash point comes first", () => {
    const frames: Array<string> = ["main", "submit"];

    expect(orderFramesInnermostFirst(frames, PYTHON_TRACE)).toEqual([
      "submit",
      "main",
    ]);
    // The input is left alone.
    expect(frames).toEqual(["main", "submit"]);
  });

  test("keeps innermost-first traces as they are", () => {
    expect(
      orderFramesInnermostFirst(
        ["run", "main"],
        "Error: boom\n    at run (/app/run.js:1:2)",
      ),
    ).toEqual(["run", "main"]);
  });
});

describe("shortenFramePath", () => {
  test.each([
    ["", ""],
    [undefined, ""],
    ["checkout.ts", "checkout.ts"],
    ["src/routes/checkout.ts", "src/routes/checkout.ts"],
    ["/app/dist/routes/checkout.js", ".../dist/routes/checkout.js"],
    ["node:internal/process/task_queues", "node:internal/process/task_queues"],
  ])("%s → %s", (input: string | undefined, expected: string) => {
    expect(shortenFramePath(input)).toBe(expected);
  });
});

describe("formatFrameLocation", () => {
  const location: {
    functionName: string;
    fileName: string;
    lineNumber: number;
    columnNumber: number | undefined;
    isOriginal: boolean;
  } = {
    functionName: "reserveInventory",
    fileName: "/app/dist/services/inventory.js",
    lineNumber: 212,
    columnNumber: 17,
    isOriginal: false,
  };

  test("adds line and column", () => {
    expect(formatFrameLocation(location, { shorten: false })).toBe(
      "/app/dist/services/inventory.js:212:17",
    );
    expect(formatFrameLocation(location, { shorten: true })).toBe(
      ".../dist/services/inventory.js:212:17",
    );
  });

  test("omits a missing column and a zero line", () => {
    expect(
      formatFrameLocation(
        { ...location, columnNumber: undefined },
        { shorten: false },
      ),
    ).toBe("/app/dist/services/inventory.js:212");
    expect(
      formatFrameLocation({ ...location, lineNumber: 0 }, { shorten: false }),
    ).toBe("/app/dist/services/inventory.js");
  });

  test("is empty for a frame with no file", () => {
    expect(
      formatFrameLocation({ ...location, fileName: "" }, { shorten: true }),
    ).toBe("");
  });
});

describe("parseRawStackTraceLines", () => {
  function kinds(lines: Array<RawStackTraceLine>): Array<string> {
    return lines.map((line: RawStackTraceLine) => {
      return line.kind;
    });
  }

  test("splits a V8 trace into the message and function / location frames", () => {
    const lines: Array<RawStackTraceLine> = parseRawStackTraceLines(
      [
        "TypeError: Cannot read properties of undefined (reading 'sku')",
        "    at reserveInventory (/app/dist/services/inventory.js:212:17)",
        "    at /app/node_modules/express/lib/router/index.js:284:15",
        "    at async Promise.all (index 0)",
        "    at new Promise (<anonymous>)",
      ].join("\n"),
    );

    expect(kinds(lines)).toEqual([
      "message",
      "frame",
      "frame",
      "frame",
      "frame",
    ]);
    expect(lines[0]!.lineNumber).toBe(1);
    expect(lines[1]).toMatchObject({
      prefix: "    at ",
      functionName: "reserveInventory",
      separator: " (",
      location: "/app/dist/services/inventory.js:212:17",
      suffix: ")",
    });
    expect(lines[2]).toMatchObject({
      functionName: "",
      location: "/app/node_modules/express/lib/router/index.js:284:15",
    });
    expect(lines[3]).toMatchObject({
      functionName: "async Promise.all",
      location: "index 0",
    });
    expect(lines[4]).toMatchObject({
      functionName: "new Promise",
      location: "<anonymous>",
    });
  });

  test("reads Java frames and marks every Caused by line as a message", () => {
    const lines: Array<RawStackTraceLine> = parseRawStackTraceLines(
      [
        "java.lang.IllegalStateException: stock changed",
        "\tat com.shop.Inventory.reserve(Inventory.java:87)",
        "Caused by: java.sql.SQLException: lock timeout",
        "\tat org.postgresql.Driver.execute(Driver.java:12)",
        "\t... 12 more",
      ].join("\n"),
    );

    expect(kinds(lines)).toEqual([
      "message",
      "frame",
      "message",
      "frame",
      "other",
    ]);
    expect(lines[1]).toMatchObject({
      prefix: "\tat ",
      functionName: "com.shop.Inventory.reserve",
      separator: "(",
      location: "Inventory.java:87",
      suffix: ")",
    });
  });

  test("marks the exception lines after a Python traceback's frames, not its header", () => {
    const lines: Array<RawStackTraceLine> = parseRawStackTraceLines(
      [
        "Traceback (most recent call last):",
        '  File "app.py", line 3, in <module>',
        "    reserve(sku)",
        "KeyError: 'sku'",
        "",
        "During handling of the above exception, another exception occurred:",
        "",
        "Traceback (most recent call last):",
        '  File "app.py", line 5, in <module>',
        "ValueError: bad sku",
      ].join("\n"),
    );

    expect(kinds(lines)).toEqual([
      "other",
      "other",
      "other",
      "message",
      "other",
      "other",
      "other",
      "other",
      "other",
      "message",
    ]);
    expect(lines[1]!.text).toBe('  File "app.py", line 3, in <module>');
  });

  test("frame pieces join back into the exact line", () => {
    const trace: string = [
      "Error: boom",
      "    at reserveInventory (/app/dist/services/inventory.js:212:17)",
      "\tat com.shop.Inventory.reserve(Inventory.java:87)",
      "   at Shop.Checkout.Run() in C:\\src\\Checkout.cs:line 42",
      "    at   spaced   (/app/run.js:1:2)   ",
      "    at /app/node_modules/express/lib/router/index.js:284:15  ",
      "    at <anonymous> ",
    ].join("\n");

    for (const line of parseRawStackTraceLines(trace)) {
      expect(
        line.prefix +
          line.functionName +
          line.separator +
          line.location +
          line.suffix,
      ).toBe(line.kind === "frame" ? line.text : "");
    }

    const spaced: RawStackTraceLine = parseRawStackTraceLines(trace)[4]!;
    expect(spaced).toMatchObject({
      prefix: "    at   ",
      functionName: "spaced",
      separator: "   (",
      location: "/app/run.js:1:2",
      suffix: ")   ",
    });
  });

  test("a frame with neither a call nor a location keeps its text as the function", () => {
    expect(parseRawStackTraceLines("x\n    at <anonymous>")[1]).toMatchObject({
      kind: "frame",
      prefix: "    at ",
      functionName: "<anonymous>",
      location: "",
    });
  });

  test("strips Windows line endings and handles blank input", () => {
    const lines: Array<RawStackTraceLine> = parseRawStackTraceLines(
      "Error: boom\r\n    at run (C:\\app\\run.js:1:2)\r\n",
    );

    expect(lines[0]!.text).toBe("Error: boom");
    expect(lines[1]).toMatchObject({
      functionName: "run",
      location: "C:\\app\\run.js:1:2",
    });
    expect(lines[2]).toMatchObject({ kind: "other", text: "" });

    expect(parseRawStackTraceLines(undefined)).toEqual([
      {
        lineNumber: 1,
        kind: "other",
        text: "",
        prefix: "",
        functionName: "",
        separator: "",
        location: "",
        suffix: "",
      },
    ]);
  });

  test("a blank first line is not treated as the message", () => {
    expect(parseRawStackTraceLines("\nError: later")[0]!.kind).toBe("other");
  });
});

/*
 * The Overview's Where it happened card: the frame the exception was most
 * likely raised from, and the few frames that called it.
 */
describe("getStackTraceCrashPoint", () => {
  const indexesOf: (point: StackTraceCrashPoint) => Array<number> = (
    point: StackTraceCrashPoint,
  ): Array<number> => {
    return point.callers.map((caller: { originalIndex: number }): number => {
      return caller.originalIndex;
    });
  };

  test("is the first frame of the application's own code, not the runtime frame above it", () => {
    const point: StackTraceCrashPoint | null = getStackTraceCrashPoint(
      FRAMES,
      3,
    );

    expect(point).not.toBeNull();
    expect(point!.originalIndex).toBe(1);
    expect(point!.frame).toBe(FRAMES[1]);
    expect(point!.frame.functionName).toBe("reserveInventory");
    expect(point!.isInApp).toBe(true);
  });

  test("its callers are the application's own frames under it, nearest first, the library frames between left out", () => {
    const point: StackTraceCrashPoint = getStackTraceCrashPoint(FRAMES, 3)!;

    // The router's frames (2-4) and Node's (0, 6) are not the application's.
    expect(indexesOf(point)).toEqual([5]);
    expect(point.callers[0]!.frame).toBe(FRAMES[5]);
  });

  test("counts every frame, and the application's own", () => {
    const point: StackTraceCrashPoint = getStackTraceCrashPoint(FRAMES, 3)!;

    expect(point.frameCount).toBe(7);
    expect(point.appFrameCount).toBe(2);
  });

  test("shows at most the callers asked for, the nearest ones", () => {
    const deep: Array<ResolvedStackFrame> = [
      frame("validate", "/app/a.js", true),
      frame("parse", "/app/b.js", true),
      frame("load", "/app/c.js", true),
      frame("handle", "/app/d.js", true),
      frame("serve", "/app/e.js", true),
    ];

    expect(indexesOf(getStackTraceCrashPoint(deep, 3)!)).toEqual([1, 2, 3]);
    expect(indexesOf(getStackTraceCrashPoint(deep, 1)!)).toEqual([1]);
    expect(getStackTraceCrashPoint(deep, 0)!.callers).toEqual([]);
    expect(indexesOf(getStackTraceCrashPoint(deep, 10)!)).toEqual([1, 2, 3, 4]);
  });

  test("with no frame of the application's own, it is the innermost frame, called from the frames under it whatever code they are", () => {
    const libraryOnly: Array<ResolvedStackFrame> = [
      frame("JSON.parse", "<anonymous>", false),
      frame("readBody", "/app/node_modules/body-parser/read.js", false),
      frame("next", "/app/node_modules/express/lib/router/index.js", false),
      frame("handle", "/app/node_modules/express/lib/router/layer.js", false),
      frame("listOnTimeout", "node:internal/timers", false),
    ];

    const point: StackTraceCrashPoint = getStackTraceCrashPoint(
      libraryOnly,
      3,
    )!;

    expect(point.originalIndex).toBe(0);
    expect(point.frame.functionName).toBe("JSON.parse");
    expect(point.isInApp).toBe(false);
    expect(indexesOf(point)).toEqual([1, 2, 3]);
    expect(point.frameCount).toBe(5);
    expect(point.appFrameCount).toBe(0);
  });

  test("a crash point in the application's code deep in the trace has no callers when nothing of the application's is under it", () => {
    const point: StackTraceCrashPoint = getStackTraceCrashPoint(
      [
        frame("a", "/lib/a.js", false),
        frame("b", "/lib/b.js", false),
        frame("onlyMine", "/app/mine.js", true),
        frame("c", "/lib/c.js", false),
      ],
      3,
    )!;

    expect(point.originalIndex).toBe(2);
    expect(point.callers).toEqual([]);
    expect(point.appFrameCount).toBe(1);
  });

  test("one frame is its own crash point, with no callers", () => {
    const only: ResolvedStackFrame = frame("main", "/app/main.js", true);
    const point: StackTraceCrashPoint = getStackTraceCrashPoint([only], 3)!;

    expect(point.frame).toBe(only);
    expect(point.callers).toEqual([]);
    expect(point.frameCount).toBe(1);
    expect(point.appFrameCount).toBe(1);
  });

  test("no frames is no crash point", () => {
    expect(getStackTraceCrashPoint([], 3)).toBeNull();
  });

  test("leaves the frames it was given alone", () => {
    const copy: Array<ResolvedStackFrame> = FRAMES.map(
      (each: ResolvedStackFrame): ResolvedStackFrame => {
        return { ...each };
      },
    );

    getStackTraceCrashPoint(FRAMES, 3);

    expect(FRAMES).toEqual(copy);
  });
});

/*
 * The card's excerpt of a stack trace without structured frames: the part
 * worth reading first.
 */
describe("getRawStackTraceExcerpt", () => {
  const NODE_TRACE: string = [
    "TypeError: Cannot read properties of undefined (reading 'sku')",
    "    at reserveInventory (/app/dist/services/inventory.js:41:17)",
    "    at handleCheckout (/app/dist/routes/checkout.js:12:5)",
    "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
    "    at next (/app/node_modules/express/lib/router/route.js:149:13)",
    "    at Route.dispatch (/app/node_modules/express/lib/router/route.js:119:3)",
  ].join("\n");

  test("a short trace is shown whole, nothing hidden", () => {
    const excerpt: RawStackTraceExcerpt = getRawStackTraceExcerpt(
      NODE_TRACE,
      8,
    );

    expect(excerpt.lines).toEqual(NODE_TRACE.split("\n"));
    expect(excerpt.hiddenLineCount).toBe(0);
  });

  test("a trace of exactly as many lines as asked hides none", () => {
    expect(getRawStackTraceExcerpt(NODE_TRACE, 6)).toEqual({
      lines: NODE_TRACE.split("\n"),
      hiddenLineCount: 0,
    });
  });

  test("a longer trace shows its first lines, the message and the crash point, and counts the rest", () => {
    const excerpt: RawStackTraceExcerpt = getRawStackTraceExcerpt(
      NODE_TRACE,
      3,
    );

    expect(excerpt.lines).toEqual([
      "TypeError: Cannot read properties of undefined (reading 'sku')",
      "    at reserveInventory (/app/dist/services/inventory.js:41:17)",
      "    at handleCheckout (/app/dist/routes/checkout.js:12:5)",
    ]);
    expect(excerpt.hiddenLineCount).toBe(3);
  });

  test("a Python traceback, which prints the crash point and the error last, shows its last lines", () => {
    const python: string = [
      "Traceback (most recent call last):",
      '  File "/srv/app/main.py", line 9, in <module>',
      "    submit(order)",
      '  File "/srv/app/checkout.py", line 41, in submit',
      "    reserve(order.sku)",
      '  File "/srv/app/inventory.py", line 17, in reserve',
      "    raise ValueError(f'bad sku {sku}')",
      "ValueError: bad sku 42",
    ].join("\n");

    const excerpt: RawStackTraceExcerpt = getRawStackTraceExcerpt(python, 3);

    expect(excerpt.lines).toEqual([
      '  File "/srv/app/inventory.py", line 17, in reserve',
      "    raise ValueError(f'bad sku {sku}')",
      "ValueError: bad sku 42",
    ]);
    expect(excerpt.hiddenLineCount).toBe(5);
  });

  test("leaves blank lines out, before it counts, and keeps each line's indent", () => {
    const excerpt: RawStackTraceExcerpt = getRawStackTraceExcerpt(
      "\n\nError: boom\n\n   \n    at run (/app/run.js:1:2)\n\t\n    at main (/app/main.js:3:4)\n",
      2,
    );

    expect(excerpt.lines).toEqual([
      "Error: boom",
      "    at run (/app/run.js:1:2)",
    ]);
    expect(excerpt.hiddenLineCount).toBe(1);
  });

  test("reads Windows line endings without a carriage return left on a line", () => {
    expect(
      getRawStackTraceExcerpt(
        "System.InvalidOperationException: boom\r\n   at Shop.Checkout.Submit() in C:\\src\\Checkout.cs:line 41\r\n",
        8,
      ).lines,
    ).toEqual([
      "System.InvalidOperationException: boom",
      "   at Shop.Checkout.Submit() in C:\\src\\Checkout.cs:line 41",
    ]);
  });

  test("no trace is no lines", () => {
    expect(getRawStackTraceExcerpt(undefined, 8)).toEqual({
      lines: [],
      hiddenLineCount: 0,
    });
    expect(getRawStackTraceExcerpt("", 8)).toEqual({
      lines: [],
      hiddenLineCount: 0,
    });
    expect(getRawStackTraceExcerpt("\n \n\t", 8)).toEqual({
      lines: [],
      hiddenLineCount: 0,
    });
  });
});
