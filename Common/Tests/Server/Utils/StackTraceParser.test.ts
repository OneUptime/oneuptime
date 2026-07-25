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
