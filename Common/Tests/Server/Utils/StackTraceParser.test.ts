import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../../Server/Utils/Telemetry/StackTraceParser";
import { describe, expect, test } from "@jest/globals";

/*
 * StackTraceParser auto-detects the language of a raw stack trace by running
 * every language parser and keeping whichever produces the most frames. These
 * tests lock down:
 *
 *   1. Each language parser recognizes its canonical format.
 *   2. The inApp classification (user code vs library/framework code) matches
 *      the LIBRARY_PATTERNS heuristics — this drives which frames get
 *      highlighted in the UI, so a regression here silently mislabels frames.
 *   3. The auto-detect "most frames wins" tie-break picks the right parser
 *      when a trace could be partially matched by more than one parser.
 */

describe("StackTraceParser.parse - guard clauses", () => {
  test("returns empty frames for empty string", () => {
    const result: ParsedStackTrace = StackTraceParser.parse("");
    expect(result.frames).toEqual([]);
    expect(result.raw).toBe("");
  });

  test("returns empty frames for whitespace-only string", () => {
    const result: ParsedStackTrace = StackTraceParser.parse("   \n  \t \n ");
    expect(result.frames).toEqual([]);
  });

  test("preserves the raw string unchanged", () => {
    const raw: string = "at foo (/app/index.js:1:1)";
    const result: ParsedStackTrace = StackTraceParser.parse(raw);
    expect(result.raw).toBe(raw);
  });

  test("handles null/undefined gracefully via falsy guard", () => {
    // parse() guards with `!rawStackTrace` before using it.
    const result: ParsedStackTrace = StackTraceParser.parse(
      undefined as unknown as string,
    );
    expect(result.frames).toEqual([]);
    expect(result.raw).toBe("");
  });

  test("returns empty frames for unparseable garbage", () => {
    const result: ParsedStackTrace = StackTraceParser.parse(
      "this is not a stack trace at all\njust some random text",
    );
    expect(result.frames).toEqual([]);
  });
});

describe("StackTraceParser.parse - JavaScript/Node.js", () => {
  test("parses `at functionName (file:line:col)`", () => {
    const trace: string = [
      "Error: boom",
      "    at doWork (/app/src/worker.js:42:15)",
      "    at main (/app/src/index.js:10:3)",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]).toEqual({
      functionName: "doWork",
      fileName: "/app/src/worker.js",
      lineNumber: 42,
      columnNumber: 15,
      inApp: true,
    });
    expect(result.frames[1]!.functionName).toBe("main");
    expect(result.frames[1]!.lineNumber).toBe(10);
  });

  test("parses anonymous `at file:line:col` frames", () => {
    const trace: string = "    at /app/src/index.js:10:3";
    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toEqual({
      functionName: "<anonymous>",
      fileName: "/app/src/index.js",
      lineNumber: 10,
      columnNumber: 3,
      inApp: true,
    });
  });

  test("parses `at functionName (file:line)` without a column", () => {
    const trace: string = "    at render (/app/component.js:7)";
    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.lineNumber).toBe(7);
    expect(result.frames[0]!.columnNumber).toBeUndefined();
    expect(result.frames[0]!.functionName).toBe("render");
  });

  test("parses eval frames", () => {
    const trace: string =
      "    at eval (eval at compile (/app/vm.js:5:10), <anonymous>:1:1)";
    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.functionName).toBe("eval at compile");
    expect(result.frames[0]!.fileName).toBe("/app/vm.js");
    expect(result.frames[0]!.lineNumber).toBe(5);
    expect(result.frames[0]!.columnNumber).toBe(10);
  });

  test("marks node_modules and node: internals as not inApp", () => {
    const trace: string = [
      "    at userCode (/app/src/handler.js:1:1)",
      "    at libCode (/app/node_modules/express/lib/router.js:2:2)",
      "    at process (node:internal/process/task_queues:3:3)",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(3);
    expect(result.frames[0]!.inApp).toBe(true);
    expect(result.frames[1]!.inApp).toBe(false);
    expect(result.frames[2]!.inApp).toBe(false);
  });
});

describe("StackTraceParser.parse - Python", () => {
  test('parses `File "path", line N, in function`', () => {
    const trace: string = [
      "Traceback (most recent call last):",
      '  File "/app/main.py", line 22, in run',
      "    do_thing()",
      '  File "/app/service.py", line 5, in do_thing',
      "    raise ValueError()",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]).toEqual({
      functionName: "run",
      fileName: "/app/main.py",
      lineNumber: 22,
      inApp: true,
    });
    expect(result.frames[1]!.functionName).toBe("do_thing");
  });

  test("uses <module> when the `in function` suffix is absent", () => {
    const trace: string = '  File "/app/main.py", line 1';
    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.functionName).toBe("<module>");
  });

  test("marks site-packages as not inApp", () => {
    const trace: string = [
      '  File "/app/main.py", line 1, in run',
      '  File "/usr/lib/python3.11/site-packages/requests/api.py", line 9, in get',
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.inApp).toBe(true);
    expect(result.frames[1]!.inApp).toBe(false);
  });
});

describe("StackTraceParser.parse - Java", () => {
  test("parses `at package.Class.method(File.java:line)`", () => {
    const trace: string = [
      "java.lang.NullPointerException",
      "    at com.example.Service.process(Service.java:42)",
      "    at com.example.Main.main(Main.java:10)",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.functionName).toBe("com.example.Service.process");
    expect(result.frames[0]!.fileName).toBe("Service.java");
    expect(result.frames[0]!.lineNumber).toBe(42);
  });

  test("parses native and unknown-source frames", () => {
    const trace: string = [
      "    at com.example.Service.process(Service.java:42)",
      "    at sun.reflect.NativeMethod.invoke(Native Method)",
      "    at com.example.App.run(Unknown Source)",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(3);
    expect(result.frames[1]!.fileName).toBe("Native Method");
    expect(result.frames[1]!.lineNumber).toBe(0);
    expect(result.frames[1]!.inApp).toBe(false);
    expect(result.frames[2]!.fileName).toBe("Unknown Source");
    expect(result.frames[2]!.lineNumber).toBe(0);
  });

  test("marks java.* / org.springframework.* as not inApp", () => {
    const trace: string = [
      "    at com.example.Service.process(Service.java:42)",
      "    at org.springframework.web.Dispatcher.doDispatch(Dispatcher.java:1)",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames[0]!.inApp).toBe(true);
    expect(result.frames[1]!.inApp).toBe(false);
  });
});

describe("StackTraceParser.parse - Go", () => {
  test("pairs the function line with the following file:line", () => {
    const trace: string = [
      "goroutine 1 [running]:",
      "main.doWork(0x1, 0x2)",
      "\t/app/main.go:25 +0x1a",
      "main.main()",
      "\t/app/main.go:10 +0x2b",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.functionName).toBe("main.doWork");
    expect(result.frames[0]!.fileName).toBe("/app/main.go");
    expect(result.frames[0]!.lineNumber).toBe(25);
    expect(result.frames[1]!.functionName).toBe("main.main");
  });

  test("marks vendor / pkg/mod paths as not inApp", () => {
    const trace: string = [
      "main.doWork()",
      "\t/app/main.go:25 +0x1a",
      "github.com/lib/pq.Query()",
      "\t/app/vendor/github.com/lib/pq/conn.go:5 +0x3c",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.inApp).toBe(true);
    expect(result.frames[1]!.inApp).toBe(false);
  });
});

describe("StackTraceParser.parse - Ruby", () => {
  test("parses `file:line:in 'method'`", () => {
    const trace: string = [
      "/app/service.rb:12:in `process'",
      "/app/main.rb:3:in `<main>'",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.functionName).toBe("process");
    expect(result.frames[0]!.fileName).toBe("/app/service.rb");
    expect(result.frames[0]!.lineNumber).toBe(12);
    expect(result.frames[1]!.functionName).toBe("<main>");
  });

  test("marks gems paths as not inApp", () => {
    const trace: string = [
      "/app/service.rb:12:in `process'",
      "/usr/local/gems/activerecord/lib/query.rb:8:in `execute'",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames[0]!.inApp).toBe(true);
    expect(result.frames[1]!.inApp).toBe(false);
  });
});

describe("StackTraceParser.parse - C#/.NET", () => {
  test("parses `at Namespace.Class.Method(params) in file:line N`", () => {
    const trace: string = [
      "System.NullReferenceException: boom",
      "   at MyApp.Service.Process(String id) in /app/Service.cs:line 42",
      "   at MyApp.Program.Main() in /app/Program.cs:line 10",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.functionName).toBe(
      "MyApp.Service.Process(String id)",
    );
    expect(result.frames[0]!.fileName).toBe("/app/Service.cs");
    expect(result.frames[0]!.lineNumber).toBe(42);
  });

  test("parses frames without file info", () => {
    const trace: string = [
      "   at MyApp.Service.Process(String id) in /app/Service.cs:line 42",
      "   at MyApp.Internal.Helper.Run()",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[1]!.fileName).toBe("");
    expect(result.frames[1]!.lineNumber).toBe(0);
    expect(result.frames[1]!.functionName).toBe("MyApp.Internal.Helper.Run()");
  });
});

describe("StackTraceParser.parse - PHP", () => {
  test("parses `#N /path/file.php(line): Class->method()`", () => {
    const trace: string = [
      "#0 /app/service.php(42): Service->process()",
      "#1 /app/index.php(10): Service->run()",
      "#2 {main}",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(3);
    expect(result.frames[0]!.functionName).toBe("Service->process");
    expect(result.frames[0]!.fileName).toBe("/app/service.php");
    expect(result.frames[0]!.lineNumber).toBe(42);
    expect(result.frames[2]!.functionName).toBe("{main}");
    expect(result.frames[2]!.inApp).toBe(true);
  });

  test("strips trailing () from method names", () => {
    const trace: string = "#0 /app/service.php(42): MyClass->doThing()";
    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames[0]!.functionName).toBe("MyClass->doThing");
  });
});

describe("StackTraceParser.parse - auto-detection", () => {
  test("picks the parser that yields the most frames", () => {
    /*
     * A pure Python trace should be attributed entirely to the Python parser,
     * not partially matched by another language.
     */
    const python: string = [
      '  File "/app/a.py", line 1, in a',
      '  File "/app/b.py", line 2, in b',
      '  File "/app/c.py", line 3, in c',
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(python);
    expect(result.frames).toHaveLength(3);
    expect(
      result.frames.every((f: StackFrame) => {
        return f.fileName.endsWith(".py");
      }),
    ).toBe(true);
  });

  test("a single JS frame beats zero frames from other parsers", () => {
    const result: ParsedStackTrace = StackTraceParser.parse(
      "    at solo (/app/only.js:1:1)",
    );
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.fileName).toBe("/app/only.js");
  });
});

/*
 * Firefox (SpiderMonkey) and Safari (JavaScriptCore) write `fn@source:line:col`
 * — no `at`, no parentheses, no header line, and no indentation. Every frame
 * below returned ZERO frames before parseJavaScriptBrowser existed, which is
 * what kept browser exceptions from ever reaching source-map resolution
 * (github.com/OneUptime/oneuptime/issues/3511).
 *
 * Two properties are load-bearing for the whole parse() election and are
 * asserted separately below: the browser parser is registered LAST so it can
 * never take a tie from another language, and it emits nothing at all until
 * the stack has produced one unambiguous `name@<url>:line` anchor frame.
 */
describe("StackTraceParser.parse - JavaScript/Firefox (SpiderMonkey)", () => {
  test("parses the stack reported in issue #3511", () => {
    const trace: string = [
      "handleSubmit@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:98217",
      "onClick/<@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:74102",
      "@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:2211",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(3);
    expect(result.frames[0]).toEqual({
      functionName: "handleSubmit",
      fileName: "https://app.example.com/_nuxt/entry.a1b2c3d4.js",
      lineNumber: 1,
      columnNumber: 98217,
      inApp: true,
    });
    // A nested-closure name is kept as Firefox wrote it.
    expect(result.frames[1]!.functionName).toBe("onClick/<");
    // A nameless top-level frame gets the same placeholder the V8 parser uses.
    expect(result.frames[2]!.functionName).toBe("<anonymous>");
    expect(result.frames[2]!.columnNumber).toBe(2211);
  });

  test("keeps every shape of Firefox display name verbatim", () => {
    const trace: string = [
      "Foo.prototype.render@https://example.com/app.js:88:14",
      "store.dispatch@https://example.com/app.js:44:7",
      "initGrid/</<@https://example.com/app.js:214:31",
      "initGrid/onRow/<@https://example.com/app.js:219:15",
      "[16]</Grid.prototype.draw/<@https://example.com/app.js:1:98211",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(
      result.frames.map((f: StackFrame) => {
        return f.functionName;
      }),
    ).toEqual([
      "Foo.prototype.render",
      "store.dispatch",
      "initGrid/</<",
      "initGrid/onRow/<",
      "[16]</Grid.prototype.draw/<",
    ]);
  });

  test("keeps the async cause marker as part of the function name", () => {
    /*
     * `<cause>*<fn>` is how Firefox marks a frame reconstructed from an async
     * stack. Stripping the marker would render two adjacent frames as the same
     * function at the same position, and StackFrame has no field to move it to.
     */
    const trace: string = [
      "async*loadUser@https://example.com/app.js:19:9",
      "promise callback*fetchAll@https://example.com/app.js:33:5",
      "setTimeout handler*poll@https://example.com/app.js:71:3",
      "promise callback*initGrid/<@https://example.com/app.js:41:9",
      // A getter that registers a promise callback carries BOTH forms at once.
      "promise callback*get profile@https://example.com/app.js:52:7",
      "async*@https://example.com/app.js:26:3",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(
      result.frames.map((f: StackFrame) => {
        return f.functionName;
      }),
    ).toEqual([
      "async*loadUser",
      "promise callback*fetchAll",
      "setTimeout handler*poll",
      "promise callback*initGrid/<",
      "promise callback*get profile",
      "async*",
    ]);
    expect(result.frames[2]!.lineNumber).toBe(71);
  });

  test("parses the column-less form older Firefox emitted", () => {
    const trace: string = [
      "doStuff@https://example.com/legacy.js:112",
      "boot@https://example.com/legacy.js:5:1",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.lineNumber).toBe(112);
    expect(result.frames[0]!.columnNumber).toBeUndefined();
  });

  test("reports an eval frame against the introducing file and line", () => {
    /*
     * `https://x/app.js line 12 > eval:1:5` — the 1:5 is a position inside the
     * eval'd text, which has no bundle and no source map. app.js:12 is the only
     * position a source map can resolve, so that is what the frame carries and
     * the inner column is dropped rather than aimed at the wrong file.
     */
    const trace: string = [
      "evalTarget@https://x.example.com/app.js line 12 > eval:1:5",
      "nested@https://x.example.com/app.js line 30 > eval line 1 > eval:1:9",
      "viaFunction@https://x.example.com/app.js line 7 > Function:1:1",
      /*
       * The `line N >` decoration is unmistakable, so an extensionless
       * introducer is exempt from the script-extension rule below.
       */
      "inline@https://x.example.com/checkout line 4 > eval:1:5",
      "boot@https://x.example.com/app.js:3:1",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(5);
    expect(result.frames[0]!.fileName).toBe("https://x.example.com/app.js");
    expect(result.frames[0]!.lineNumber).toBe(12);
    expect(result.frames[0]!.columnNumber).toBeUndefined();
    // Nested introductions collapse to the OUTERMOST line, not the innermost.
    expect(result.frames[1]!.lineNumber).toBe(30);
    expect(result.frames[2]!.lineNumber).toBe(7);
    expect(result.frames[3]).toEqual({
      functionName: "inline",
      fileName: "https://x.example.com/checkout",
      lineNumber: 4,
      inApp: true,
    });
  });

  test("parses a self-hosted builtin frame and marks it as library code", () => {
    const trace: string = [
      "next@self-hosted:1154:9",
      "boot@https://x.example.com/a.js:1:1",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]).toEqual({
      functionName: "next",
      fileName: "self-hosted",
      lineNumber: 1154,
      columnNumber: 9,
      inApp: false,
    });
  });

  test("parses sources whose own colons must not be mistaken for the location", () => {
    const trace: string = [
      "boot@http://localhost:3000/static/js/bundle.js:12345:56",
      "send@https://user:pw@cdn.example.com/sdk.js:1:9033",
      "w@blob:https://example.com/9f0a-1:2:3",
      "run@file:///C:/app/dist/x.js:8:2",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(4);
    // The :port survives; only the trailing two numbers are the location.
    expect(result.frames[0]!.fileName).toBe(
      "http://localhost:3000/static/js/bundle.js",
    );
    expect(result.frames[0]!.lineNumber).toBe(12345);
    expect(result.frames[0]!.columnNumber).toBe(56);
    // Userinfo contains both a colon and an `@` and must stay in the URL.
    expect(result.frames[1]!.fileName).toBe(
      "https://user:pw@cdn.example.com/sdk.js",
    );
    expect(result.frames[2]!.fileName).toBe("blob:https://example.com/9f0a-1");
    expect(result.frames[3]!.fileName).toBe("file:///C:/app/dist/x.js");
  });

  test("classifies extension and vendored URLs as library code", () => {
    const trace: string = [
      "onMessage@moz-extension://a1b2/content.js:9:1",
      "inject@chrome-extension://c3d4/inject.js:2:2",
      "render@https://app.example.com/node_modules/react-dom/index.js:5:5",
      "handleSubmit@https://app.example.com/assets/app.js:1:1",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(
      result.frames.map((f: StackFrame) => {
        return f.inApp;
      }),
    ).toEqual([false, false, false, true]);
  });

  test("handles CRLF line endings", () => {
    const trace: string = [
      "handleSubmit@https://example.com/app.js:1:2",
      "boot@https://example.com/app.js:3:4",
    ].join("\r\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[1]!.columnNumber).toBe(4);
  });

  test("skips a pathologically long line without dropping the rest", () => {
    const trace: string = [
      `x@https://example.com/${"a".repeat(5000)}.js:1:1`,
      "boot@https://example.com/app.js:2:2",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.fileName).toBe("https://example.com/app.js");
  });
});

describe("StackTraceParser.parse - JavaScript/Safari (JavaScriptCore)", () => {
  test("parses a Safari stack including its pseudo-function names", () => {
    const trace: string = [
      "handleSubmit@https://app.example.com/build/main.js:12:34",
      "global code@https://app.example.com/build/main.js:1:1",
      "module code@https://app.example.com/build/mod.mjs:3:11",
      "eval code@https://app.example.com/build/main.js:7:9",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(4);
    /*
     * `global code` / `module code` / `eval code` are kept exactly as
     * JavaScriptCore wrote them — they are the only name the engine gives the
     * frame, and rewriting them would disagree with the raw stack shown
     * beside the frame list.
     */
    expect(
      result.frames.map((f: StackFrame) => {
        return f.functionName;
      }),
    ).toEqual(["handleSubmit", "global code", "module code", "eval code"]);
    expect(result.frames[2]!.fileName).toBe(
      "https://app.example.com/build/mod.mjs",
    );
  });

  test("parses `fn@[native code]` with no fabricated location", () => {
    const trace: string = [
      "handleSubmit@https://app.example.com/build/main.js:12:34",
      "forEach@[native code]",
      "promiseReactionJob@[native code]",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(3);
    expect(result.frames[1]).toEqual({
      functionName: "forEach",
      fileName: "[native code]",
      /*
       * lineNumber is not optional on StackFrame, and 0 is the same file-less
       * sentinel parseJava already uses for `(Native Method)`. It also keeps
       * the frame out of source-map resolution, which skips lineNumber < 1.
       */
      lineNumber: 0,
      inApp: false,
    });
    expect(result.frames[1]!.columnNumber).toBeUndefined();
  });

  test("parses ES2015 accessor and bound function names", () => {
    const trace: string = [
      "get fullName@https://example.com/app.js:4:9",
      "bound save@https://example.com/app.js:9:2",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.functionName).toBe("get fullName");
    expect(result.frames[1]!.functionName).toBe("bound save");
  });
});

describe("StackTraceParser.parse - browser parser election", () => {
  test("a V8 stack still elects the V8 parser", () => {
    /*
     * The whole reason the browser grammar is a separate parser rather than
     * more patterns inside parseJavaScript: a V8 stack must be unaffected.
     */
    const trace: string = [
      "Error: boom",
      "    at doWork (/app/src/worker.js:42:15)",
      "    at main (/app/src/index.js:10:3)",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.fileName).toBe("/app/src/worker.js");
  });

  test("a V8 frame is never double-claimed by the browser parser", () => {
    const v8: ParsedStackTrace = StackTraceParser.parse(
      "    at Object.send (https://app.example.com/assets/main.js:1:2)",
    );
    expect(v8.frames).toHaveLength(1);
    expect(v8.frames[0]!.functionName).toBe("Object.send");

    /*
     * `at a*b` satisfies the async-cause name grammar, and no V8 pattern
     * matches a column-less line — so without the `at ` guard in
     * parseJavaScriptBrowser these two lines would become browser frames.
     */
    const disguised: ParsedStackTrace = StackTraceParser.parse(
      [
        "at a*b@https://x.example.com/app.js:112",
        "at c*d@https://x.example.com/app.js:113",
      ].join("\n"),
    );
    expect(disguised.frames).toEqual([]);
  });

  test("a mixed stack resolves to whichever engine has more frames", () => {
    const trace: string = [
      "TypeError: t is undefined",
      "onSelect@https://app.example.com/main.js:1:46",
      "render@https://app.example.com/main.js:2:3",
      "    at wrapper (/app/src/bridge.js:9:1)",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.functionName).toBe("onSelect");
  });

  test("browser-shaped lines never take a tie from another language", () => {
    /*
     * parse() keeps the FIRST parser to reach a frame count, and the browser
     * parser is registered last, so it has to strictly out-count every
     * language before it. These are the exact tie shapes that would otherwise
     * silently delete a correct parse.
     */
    type TieCase = { name: string; trace: string; expectedFile: string };

    const cases: Array<TieCase> = [
      {
        name: "ruby",
        trace: [
          "/app/models/user.rb:12:in `save'",
          "/app/controllers/users_controller.rb:8:in `create'",
          "x@https://a.example.com/a.js:1:1",
          "y@https://a.example.com/a.js:2:1",
        ].join("\n"),
        expectedFile: "/app/models/user.rb",
      },
      {
        name: "python",
        trace: [
          'File "/app/a.py", line 1, in a',
          'File "/app/b.py", line 2, in b',
          "x@https://a.example.com/a.js:1:1",
          "y@https://a.example.com/a.js:2:1",
        ].join("\n"),
        expectedFile: "/app/a.py",
      },
      {
        name: "java",
        trace: [
          "at com.example.Foo.bar(Foo.java:10)",
          "at com.example.Main.main(Main.java:5)",
          "x@https://a.example.com/a.js:1:1",
          "y@https://a.example.com/a.js:2:1",
        ].join("\n"),
        expectedFile: "Foo.java",
      },
      {
        name: "php",
        trace: [
          "#0 /app/service.php(42): Service->process()",
          "#1 /app/index.php(10): Service->run()",
          "#2 {main}",
          "x@https://a.example.com/a.js:1:1",
          "y@https://a.example.com/a.js:2:1",
          "z@https://a.example.com/a.js:3:1",
        ].join("\n"),
        expectedFile: "/app/service.php",
      },
    ];

    for (const testCase of cases) {
      const result: ParsedStackTrace = StackTraceParser.parse(testCase.trace);
      expect(result.frames[0]!.fileName).toBe(testCase.expectedFile);
    }
  });

  test("forged `[native code]` lines cannot evict another language", () => {
    /*
     * A pseudo-source frame needs no URL and no digits, so without the anchor
     * requirement two of them would be the cheapest possible way to out-count
     * a real stack.
     */
    const trace: string = [
      "/app/models/user.rb:12:in `save'",
      "/app/controllers/users_controller.rb:8:in `create'",
      "map@[native code]",
      "forEach@[native code]",
      "reduce@[native code]",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.fileName).toBe("/app/models/user.rb");
  });

  test("keeps every frame of a browser stack that also carries context lines", () => {
    /*
     * Log bodies interleave frames with structured context. A frame must never
     * be dropped because the lines around it were not frames — on the log
     * ingest path a zero-frame parse discards the whole exception.
     */
    const trace: string = [
      "onSelect@https://app.example.com/main.js:1:46",
      "render@https://app.example.com/main.js:2:3",
      "  request_id=abc",
      "  user_id=42",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(2);
  });
});

describe("StackTraceParser.parse - browser parser rejections", () => {
  /*
   * The browser parser runs over arbitrary ERROR log bodies via
   * LogExceptionExtractor's raw-body path, so anything that reads as
   * `something@something:number` has to be rejected explicitly. Each guard
   * that does the rejecting is pinned here, because none of them is visible
   * from the regexes alone and every one is a single edit away from being
   * "simplified" back out.
   */
  type RejectionCase = { why: string; input: string };

  const rejections: Array<RejectionCase> = [
    {
      why: "an email address in log prose (the name has spaces)",
      input: "failed login for user@example.com:22:1\nretrying in 5s",
    },
    {
      why: "an SSH/git remote (the source names no scheme)",
      input: "git@github.com:22:1",
    },
    {
      why: "an ssh command line",
      input: "ssh user@host:2222",
    },
    {
      why: "a connection string (the name contains a colon)",
      input: "Connection string: mongodb://svc@db.internal/app:1:1",
    },
    {
      why: "a scoped npm path (what follows the `@` names no scheme)",
      input: "/app/node_modules/@scope/pkg/index.js:10:5",
    },
    {
      why: "a URL whose :port would otherwise peel as a line number",
      input: "@http://127.0.0.1:8080\nserve@http://localhost:3000",
    },
    {
      why: "a URL ending in a number with no column and no script extension",
      input: "notify@https://hooks.slack.com/services/T000:200",
    },
    {
      why: "a bare location with no `@` at all",
      input: [
        "https://cdn.example.com/vendor.js:99:1",
        "https://cdn.example.com/other.js:98:2",
      ].join("\n"),
    },
    {
      why: "pseudo-source frames with no anchor frame to license them",
      input: "map@[native code]\nforEach@[native code]",
    },
    {
      why: "a bare `@`",
      input: "@\n@@",
    },
    /*
     * The four below name a perfectly valid source, so the ONLY thing
     * rejecting them is the guard each one is named for. Without them the
     * guards are all individually deletable with the suite still green.
     */
    {
      why: "prose whose leading words cannot be a function name (spaces)",
      input:
        "notified on-call engineer jane@https://status.example.com/app.js:1:2",
    },
    {
      why: "a name containing a colon",
      input: "Connection string: svc@https://db.example.com/app.js:1:1",
    },
    {
      why: "a scheme://authority whose :port would peel as the line number",
      input: "boot@https://example.com:8080:1",
    },
    {
      why: "a zero line number, which collides with the native-frame sentinel",
      input: "boot@https://example.com/app.js:0:5",
    },
    {
      why: "self-hosted frames with no anchor frame to license them",
      input: "next@self-hosted:1154:9\nmap@self-hosted:1:1",
    },
  ];

  for (const rejection of rejections) {
    test(`rejects ${rejection.why}`, () => {
      const result: ParsedStackTrace = StackTraceParser.parse(rejection.input);
      expect(result.frames).toEqual([]);
    });
  }

  test("does not claim a Go file:line pair", () => {
    /*
     * `/app/main.go:25` is a single-number bare location — the Go parser owns
     * it and still does. Inside a browser stack the browser parser must not
     * add a SECOND frame for it: the two frames below are the two `@` frames,
     * and the Go line contributes nothing.
     */
    const goOnly: ParsedStackTrace = StackTraceParser.parse("/app/main.go:25");
    expect(goOnly.frames).toHaveLength(1);
    expect(goOnly.frames[0]!.fileName).toBe("/app/main.go");

    const withAnchors: ParsedStackTrace = StackTraceParser.parse(
      [
        "handler@https://app.example.com/a.js:1:1",
        "boot@https://app.example.com/a.js:2:1",
        "/app/main.go:25",
      ].join("\n"),
    );
    expect(
      withAnchors.frames.map((f: StackFrame) => {
        return f.functionName;
      }),
    ).toEqual(["handler", "boot"]);
  });

  test("an anchored stack still does not license bare locations", () => {
    /*
     * A logged asset URL sitting next to real frames must not become a frame:
     * the no-`@` form is rejected outright, not merely gated on an anchor.
     */
    const trace: string = [
      "handler@https://app.example.com/a.js:1:1",
      "https://cdn.example.com/vendor.js:99:1",
      "https://cdn.example.com/other.js:98:2",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.functionName).toBe("handler");
  });

  test("never emits a fileName that a source map could not be matched to", () => {
    /*
     * SourceMapResolver matches a frame to a bundle by shared trailing path
     * segments, so a fileName with junk glued to its last segment resolves to
     * nothing. Any accepted frame must at minimum still end in its own
     * basename.
     */
    const trace: string = [
      "a@https://app.example.com/assets/main.abc.js:1:2",
      "b@https://app.example.com/assets/main.abc.js:abc:1",
      "c@https://app.example.com/assets/main.abc.js?v=2:3:4",
    ].join("\n");

    const result: ParsedStackTrace = StackTraceParser.parse(trace);

    /*
     * The middle frame's `:abc:` is not a location, so it is dropped outright
     * rather than emitted with junk glued to its last path segment.
     */
    expect(
      result.frames.map((f: StackFrame) => {
        return f.functionName;
      }),
    ).toEqual(["a", "c"]);

    for (const frame of result.frames) {
      expect(frame.fileName).toContain("main.abc.js");
      expect(frame.fileName).not.toContain(":abc");
    }
  });
});
