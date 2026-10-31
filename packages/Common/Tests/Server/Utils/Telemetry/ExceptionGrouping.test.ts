import {
  EXCEPTION_GROUPING_VERSION,
  ExceptionGroupingBasis,
  ExceptionGroupingKey,
  GROUPING_MODULE_SEGMENTS,
  MAX_GROUPING_FRAMES,
  collapseLongDigitRuns,
  getExceptionGroupingKey,
  getExceptionGroupingText,
  normalizeFrameFunction,
  normalizeFrameModule,
} from "../../../../Server/Utils/Telemetry/ExceptionGrouping";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * Grouping v2: an exception is its type and the functions and modules of
 * its own code - line numbers and library frames left out, recursion counted
 * once, the message only when there is no stack trace. A seeded sweep over
 * generated stack traces in JavaScript, Python and Java holds the rule:
 * the same in-app frames always group together, whatever their line
 * numbers, the library frames around them or the message, and a change to
 * an in-app frame groups apart.
 */

function key(
  stackTrace: string,
  overrides: { message?: string; exceptionType?: string } = {},
): ExceptionGroupingKey {
  return getExceptionGroupingKey({
    exceptionType: overrides.exceptionType ?? "TypeError",
    message: overrides.message ?? "boom",
    stackTrace,
  });
}

describe("a frame's module", () => {
  test.each([
    ["/app/src/cart/checkout.ts", "src/cart/checkout.ts"],
    ["/srv/releases/20261030/app/src/cart.ts", "app/src/cart.ts"],
    [
      "https://cdn.example.com/static/js/main.3f2a9c1b.js?v=12#x",
      "static/js/main.js",
    ],
    ["webpack:///./src/components/Cart.tsx", "src/components/Cart.tsx"],
    ["file:///home/me/app/index.js", "me/app/index.js"],
    ["C:\\build\\app\\Program.cs", "build/app/Program.cs"],
    ["../lib/./util.js", "lib/util.js"],
    ["CartService.java", "CartService.java"],
    ["", ""],
  ])("%s reads as %s", (fileName: string, module: string) => {
    expect(normalizeFrameModule(fileName)).toBe(module);
  });

  test("names the same code the same in every release and from every host", () => {
    expect(
      normalizeFrameModule("/opt/app-1.2.3/releases/20261030120000/src/a.js"),
    ).toBe(
      normalizeFrameModule("/opt/app-1.2.3/releases/20261101093000/src/a.js"),
    );
    expect(
      normalizeFrameModule("https://a.example.com/js/app.0a1b2c3d.js"),
    ).toBe(normalizeFrameModule("https://b.example.org/js/app.9f8e7d6c.js"));
  });

  test("keeps the last segments only", () => {
    expect(normalizeFrameModule("/a/b/c/d/e/f.js").split("/")).toHaveLength(
      GROUPING_MODULE_SEGMENTS,
    );
  });

  test("a megabyte-long file name is read from its head only", () => {
    const fileName: string = `/${"a".repeat(1024 * 1024)}/x.js`;
    // The fastest of up to three reads counts (FastestRun): one is noisy.
    const read: FastestRun<string> = fastestRun({
      run: (): string => {
        return normalizeFrameModule(fileName);
      },
      limitInMs: 500,
    });

    expect(read.result.length).toBeLessThanOrEqual(2048);
    expect(read.inMs).toBeLessThan(500);
  });
});

describe("a frame's function", () => {
  test.each([
    ["checkout", "checkout"],
    ["  async   checkout ", "checkout"],
    ["async async run", "run"],
    ["Object.<anonymous>", "<anonymous>"],
    ["anonymous", "<anonymous>"],
    ["", "<anonymous>"],
    ["lambda$123456", "lambda$<n>"],
    ["step2", "step2"],
    ["Cart.prototype.add", "Cart.prototype.add"],
  ])("%s reads as %s", (name: string, normalized: string) => {
    expect(normalizeFrameFunction(name)).toBe(normalized);
  });

  test("long digit runs, not short ones", () => {
    expect(collapseLongDigitRuns("a1b22c333d4444e55555")).toBe(
      "a1b22c333d<n>e<n>",
    );
    expect(collapseLongDigitRuns("1234")).toBe("<n>");
  });
});

describe("the grouping key", () => {
  const TRACE: string = [
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "    at reserveStock (/app/src/inventory.ts:42:17)",
    "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
    "    at checkout (/app/src/cart.ts:118:9)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
  ].join("\n");

  test("is the type and the in-app frames, top first, without lines or library frames", () => {
    expect(key(TRACE)).toEqual({
      basis: ExceptionGroupingBasis.InAppFrames,
      exceptionType: "TypeError",
      parts: ["app/src/inventory.ts|reserveStock", "app/src/cart.ts|checkout"],
    });
  });

  test("counts recursion once", () => {
    const recursive: string = [
      "RangeError: Maximum call stack size exceeded",
      ...new Array(40).fill("    at walk (/app/src/tree.ts:10:3)"),
      "    at main (/app/src/index.ts:2:1)",
    ].join("\n");

    expect(key(recursive).parts).toEqual([
      "app/src/tree.ts|walk",
      "app/src/index.ts|main",
    ]);
  });

  test("holds at most a bounded number of frames", () => {
    const deep: string = [
      "Error: deep",
      ...new Array(200).fill(0).map((_value: number, index: number): string => {
        return `    at f${index} (/app/src/f${index}.ts:1:1)`;
      }),
    ].join("\n");

    expect(key(deep).parts).toHaveLength(MAX_GROUPING_FRAMES);
  });

  test("with only library frames, every frame counts, the same way", () => {
    const library: string = [
      "Error: socket hang up",
      "    at connResetException (node:internal/errors:720:14)",
      "    at TLSSocket.socketOnEnd (node:_http_client:525:23)",
    ].join("\n");

    const grouping: ExceptionGroupingKey = key(library);
    expect(grouping.basis).toBe(ExceptionGroupingBasis.AllFrames);
    expect(grouping.parts.length).toBe(2);
  });

  test("with no stack trace, the message, with its varying values taken out", () => {
    const a: ExceptionGroupingKey = key("", {
      message: "Order id=1042 not found",
    });
    const b: ExceptionGroupingKey = key("", {
      message: "Order id=2077 not found",
    });

    expect(a.basis).toBe(ExceptionGroupingBasis.Message);
    expect(a).toEqual(b);
  });

  test("the message does not count once there are frames", () => {
    expect(key(TRACE, { message: "Order 1001 failed" })).toEqual(
      key(TRACE, { message: "Order 2002 failed" }),
    );
  });

  test("the type does", () => {
    expect(key(TRACE, { exceptionType: "TypeError" })).not.toEqual(
      key(TRACE, { exceptionType: "RangeError" }),
    );
  });

  test("the hashed text names the version, the project and the service, so a v2 fingerprint never equals a v1 one or another service's", () => {
    const text: string = getExceptionGroupingText({
      projectId: "p",
      primaryEntityId: "s",
      key: key(TRACE),
    });

    expect(text.split("\n").slice(0, 5)).toEqual([
      `grouping-v${EXCEPTION_GROUPING_VERSION}`,
      "p",
      "s",
      "TypeError",
      ExceptionGroupingBasis.InAppFrames,
    ]);
    expect(
      getExceptionGroupingText({
        projectId: "p",
        primaryEntityId: "other",
        key: key(TRACE),
      }),
    ).not.toBe(text);
  });

  test("a sixteen-megabyte stack trace is read from its head, quickly", () => {
    const huge: string = `Error: x\n    at f (/app/src/a.ts:1:1)\n${"x".repeat(16 * 1024 * 1024)}`;
    // The fastest of up to three reads counts (FastestRun): one is noisy.
    const read: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return key(huge).parts;
      },
      limitInMs: 2000,
    });

    expect(read.result).toEqual(["app/src/a.ts|f"]);
    expect(read.inMs).toBeLessThan(2000);
  });
});

/*
 * Generated stack traces. Each trace is a list of in-app frames (module and
 * function), drawn once; every variant of it changes what grouping v2 must
 * ignore - line and column numbers, library frames inserted anywhere, the
 * message - and must still group with it.
 */
interface InAppFrame {
  module: string;
  fn: string;
}

type Language = "javascript" | "python" | "java";

const MODULES: Array<string> = [
  "cart",
  "inventory",
  "billing",
  "users",
  "orders",
  "search",
];
const FUNCTIONS: Array<string> = [
  "checkout",
  "reserve",
  "charge",
  "load",
  "save",
  "find",
  "render",
];
const LIBRARY_JS: Array<string> = [
  "/app/node_modules/express/lib/router/layer.js",
  "node:internal/process/task_queues",
  "/app/node_modules/pg/lib/client.js",
];
const LIBRARY_PY: Array<string> = [
  "/usr/local/lib/python3.11/site-packages/django/core/handlers/base.py",
  "/app/.venv/lib/python3.11/site-packages/sqlalchemy/engine/base.py",
];
const LIBRARY_JAVA: Array<string> = [
  "org.springframework.web.servlet.FrameworkServlet.service",
  "java.base/java.util.HashMap.get",
];

function drawFrames(random: SeededRandom): Array<InAppFrame> {
  const count: number = 1 + random(6);
  const frames: Array<InAppFrame> = [];

  for (let index: number = 0; index < count; index++) {
    frames.push({
      module: `${MODULES[random(MODULES.length)]!}${random(3)}`,
      fn: `${FUNCTIONS[random(FUNCTIONS.length)]!}${random(3)}`,
    });
  }

  return frames;
}

function render(
  language: Language,
  frames: Array<InAppFrame>,
  random: SeededRandom,
  withLibraryFrames: boolean,
): string {
  const lines: Array<string> = [];
  const line: () => number = (): number => {
    return 1 + random(5000);
  };
  const library: () => void = (): void => {
    if (!withLibraryFrames || random(2) === 0) {
      return;
    }
    if (language === "javascript") {
      lines.push(
        `    at Layer.handle (${LIBRARY_JS[random(LIBRARY_JS.length)]!}:${line()}:${line()})`,
      );
    } else if (language === "python") {
      lines.push(
        `  File "${LIBRARY_PY[random(LIBRARY_PY.length)]!}", line ${line()}, in inner`,
      );
    } else {
      lines.push(
        `\tat ${LIBRARY_JAVA[random(LIBRARY_JAVA.length)]!}(Library.java:${line()})`,
      );
    }
  };

  if (language === "javascript") {
    lines.push("TypeError: generated");
    for (const frame of frames) {
      library();
      lines.push(
        `    at ${frame.fn} (/app/src/${frame.module}.ts:${line()}:${line()})`,
      );
    }
    library();
  } else if (language === "python") {
    lines.push("Traceback (most recent call last):");
    for (const frame of frames) {
      library();
      lines.push(
        `  File "/app/service/${frame.module}.py", line ${line()}, in ${frame.fn}`,
      );
    }
    library();
    lines.push("ValueError: generated");
  } else {
    lines.push("java.lang.IllegalStateException: generated");
    for (const frame of frames) {
      library();
      lines.push(
        `\tat com.example.${frame.module}.Service.${frame.fn}(Service.java:${line()})`,
      );
    }
    library();
  }

  return lines.join("\n");
}

describe("a seeded sweep over generated stack traces", () => {
  const LANGUAGES: Array<Language> = ["javascript", "python", "java"];

  test("the same in-app frames always group together, whatever the lines, the library frames and the message", () => {
    const random: SeededRandom = seededRandom(31337);
    const problems: Array<string> = [];

    for (let round: number = 0; round < 600; round++) {
      const language: Language = LANGUAGES[round % LANGUAGES.length]!;
      const frames: Array<InAppFrame> = drawFrames(random);
      const base: ExceptionGroupingKey = key(
        render(language, frames, random, false),
        {
          message: `failed ${random(100000)}`,
        },
      );

      if (base.basis !== ExceptionGroupingBasis.InAppFrames) {
        problems.push(`${round} ${language}: no in-app frames read`);
        continue;
      }

      for (let variant: number = 0; variant < 4; variant++) {
        const other: ExceptionGroupingKey = key(
          render(language, frames, random, true),
          {
            message: `failed ${random(100000)}`,
          },
        );

        if (JSON.stringify(other) !== JSON.stringify(base)) {
          problems.push(
            `${round}/${variant} ${language}: ${JSON.stringify(other.parts)} vs ${JSON.stringify(base.parts)}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("a different in-app frame groups apart", () => {
    const random: SeededRandom = seededRandom(4711);
    const problems: Array<string> = [];

    for (let round: number = 0; round < 600; round++) {
      const language: Language = LANGUAGES[round % LANGUAGES.length]!;
      const frames: Array<InAppFrame> = drawFrames(random);
      const changed: Array<InAppFrame> = frames.map((frame: InAppFrame) => {
        return { ...frame };
      });
      const index: number = random(changed.length);
      changed[index] = {
        module: changed[index]!.module,
        fn: `${changed[index]!.fn}Renamed`,
      };

      const a: ExceptionGroupingKey = key(
        render(language, frames, random, true),
      );
      const b: ExceptionGroupingKey = key(
        render(language, changed, random, true),
      );

      if (JSON.stringify(a) === JSON.stringify(b)) {
        problems.push(
          `${round} ${language}: a renamed function grouped together`,
        );
      }
    }

    expect(problems).toEqual([]);
  });
});
