import { describe, expect, test } from "@jest/globals";
import {
  ProfileFrameOrigin,
  getProfileFrameOrigin,
  getProfileFunctionKey,
  isOwnProfileFrame,
  parseProfileFrame,
} from "../../../Utils/Profiles/ProfileFrames";

/*
 * A stored frame reads back as the function, file and line the ingest
 * wrote, and every frame is told apart as the application's own code, a
 * library, the runtime or the operating system - the Profiler draws "your
 * code" first and offers "Fix with AI" only on it.
 */

describe("parseProfileFrame", () => {
  test("reads function, file and line", () => {
    expect(
      parseProfileFrame("parseOrder@/app/src/orders/parser.ts:88"),
    ).toEqual({
      functionName: "parseOrder",
      fileName: "/app/src/orders/parser.ts",
      lineNumber: 88,
    });
  });

  test("a frame with no line keeps its whole file", () => {
    expect(parseProfileFrame("main@main.go")).toEqual({
      functionName: "main",
      fileName: "main.go",
      lineNumber: 0,
    });
  });

  test("a bare name is all function", () => {
    expect(parseProfileFrame("ksys_read")).toEqual({
      functionName: "ksys_read",
      fileName: "",
      lineNumber: 0,
    });
  });

  test("splits on the last colon, so a Windows path keeps its drive", () => {
    expect(parseProfileFrame("Run@C:\\app\\Program.cs:42")).toEqual({
      functionName: "Run",
      fileName: "C:\\app\\Program.cs",
      lineNumber: 42,
    });
  });

  test("a Windows path with no line is not read as a line", () => {
    expect(parseProfileFrame("Run@C:\\app\\Program.cs")).toEqual({
      functionName: "Run",
      fileName: "C:\\app\\Program.cs",
      lineNumber: 0,
    });
  });

  test("a function name with an @ in it keeps the part before the first @", () => {
    expect(parseProfileFrame("handler@file.js:1")).toEqual({
      functionName: "handler",
      fileName: "file.js",
      lineNumber: 1,
    });
  });

  test("an empty frame is empty", () => {
    expect(parseProfileFrame("")).toEqual({
      functionName: "",
      fileName: "",
      lineNumber: 0,
    });
  });
});

describe("getProfileFunctionKey", () => {
  test("is the same for one function at two lines", () => {
    const first: { functionName: string; fileName: string } =
      parseProfileFrame("parse@a.ts:10");
    const second: { functionName: string; fileName: string } =
      parseProfileFrame("parse@a.ts:90");

    expect(getProfileFunctionKey(first.functionName, first.fileName)).toBe(
      getProfileFunctionKey(second.functionName, second.fileName),
    );
  });

  test("tells apart one name in two files", () => {
    expect(getProfileFunctionKey("parse", "a.ts")).not.toBe(
      getProfileFunctionKey("parse", "b.ts"),
    );
  });

  test("cannot be fooled by a name ending in what a file begins with", () => {
    expect(getProfileFunctionKey("a@b", "c")).not.toBe(
      getProfileFunctionKey("a", "b@c"),
    );
  });
});

describe("getProfileFrameOrigin", () => {
  test.each([
    // Applications' own code.
    ["/app/src/orders/parser.ts", "parseOrder", ProfileFrameOrigin.Own],
    [
      "/home/runner/work/acme/acme/billing/charge.go",
      "charge",
      ProfileFrameOrigin.Own,
    ],
    ["src/handlers/checkout.py", "checkout", ProfileFrameOrigin.Own],
    ["C:\\inetpub\\app\\Orders.cs", "Load", ProfileFrameOrigin.Own],
    // Libraries.
    [
      "/app/node_modules/express/lib/router/index.js",
      "handle",
      ProfileFrameOrigin.Dependency,
    ],
    [
      "/usr/local/lib/python3.12/site-packages/django/core/handlers/base.py",
      "get_response",
      ProfileFrameOrigin.Dependency,
    ],
    [
      "/usr/lib/python3/dist-packages/requests/api.py",
      "get",
      ProfileFrameOrigin.Dependency,
    ],
    [
      "/go/pkg/mod/github.com/gin-gonic/gin@v1.9.1/gin.go",
      "ServeHTTP",
      ProfileFrameOrigin.Dependency,
    ],
    [
      "/app/vendor/github.com/lib/pq/conn.go",
      "query",
      ProfileFrameOrigin.Dependency,
    ],
    [
      "/usr/local/bundle/gems/rack-3.0.8/lib/rack.rb",
      "call",
      ProfileFrameOrigin.Dependency,
    ],
    // Runtimes.
    ["node:internal/timers", "listOnTimeout", ProfileFrameOrigin.Runtime],
    [
      "/usr/local/go/src/runtime/proc.go",
      "runtime.schedule",
      ProfileFrameOrigin.Runtime,
    ],
    [
      "/usr/local/lib/python3.12/json/decoder.py",
      "decode",
      ProfileFrameOrigin.Runtime,
    ],
    ["/usr/lib/python3.11/threading.py", "run", ProfileFrameOrigin.Runtime],
    [
      "/usr/local/lib/ruby/3.2.0/json/common.rb",
      "parse",
      ProfileFrameOrigin.Runtime,
    ],
    // The operating system.
    [
      "/lib/x86_64-linux-gnu/libc.so.6",
      "__memmove_avx_unaligned",
      ProfileFrameOrigin.Native,
    ],
    ["/usr/lib/libssl.so", "SSL_read", ProfileFrameOrigin.Native],
    ["[kernel.kallsyms]", "do_syscall_64", ProfileFrameOrigin.Native],
  ])(
    "%s (%s) is %s",
    (fileName: string, functionName: string, origin: ProfileFrameOrigin) => {
      expect(getProfileFrameOrigin(fileName, functionName, "")).toBe(origin);
    },
  );

  test("a kernel frame is the operating system's, whatever else it says", () => {
    expect(
      getProfileFrameOrigin("/app/src/x.ts", "do_syscall_64", "kernel"),
    ).toBe(ProfileFrameOrigin.Native);
  });

  test("with no file, a runtime's own function names give it away", () => {
    expect(getProfileFrameOrigin("", "java.util.HashMap.get")).toBe(
      ProfileFrameOrigin.Runtime,
    );
    expect(
      getProfileFrameOrigin("", "System.Text.Json.JsonSerializer.Deserialize"),
    ).toBe(ProfileFrameOrigin.Runtime);
    expect(getProfileFrameOrigin("", "runtime.mallocgc")).toBe(
      ProfileFrameOrigin.Runtime,
    );
    expect(getProfileFrameOrigin("", "(garbage collector)")).toBe(
      ProfileFrameOrigin.Runtime,
    );
  });

  test("with no file, a native frame type is the operating system's", () => {
    expect(getProfileFrameOrigin("", "memcpy", "native")).toBe(
      ProfileFrameOrigin.Native,
    );
  });

  test("an address the profiler could not name is nobody's code", () => {
    expect(getProfileFrameOrigin("", "0x7f3a1c2b")).toBe(
      ProfileFrameOrigin.Unknown,
    );
  });

  test("a frame with nothing to go on is unknown", () => {
    expect(getProfileFrameOrigin("", "")).toBe(ProfileFrameOrigin.Unknown);
    expect(getProfileFrameOrigin(undefined, undefined)).toBe(
      ProfileFrameOrigin.Unknown,
    );
  });

  test("when nothing says otherwise, a named function is the application's own", () => {
    expect(getProfileFrameOrigin("", "com.acme.orders.Parser.parse")).toBe(
      ProfileFrameOrigin.Own,
    );
    expect(getProfileFrameOrigin("", "main.handleCheckout")).toBe(
      ProfileFrameOrigin.Own,
    );
  });

  test("isOwnProfileFrame answers the same question", () => {
    expect(isOwnProfileFrame("/app/src/a.ts", "a")).toBe(true);
    expect(isOwnProfileFrame("/app/node_modules/x/y.js", "y")).toBe(false);
  });
});
