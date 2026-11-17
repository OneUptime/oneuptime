import { describe, expect, test } from "@jest/globals";
import {
  getShortProfileFunctionName,
  isUnnamedProfileFunction,
} from "../../../Utils/Profiles/ProfileFunctionNames";

/*
 * A function's name as the Profiler shows it in a frame, a row or a
 * heading: the part a person reads code by, never the module path in front
 * of it - and code with no name at all told apart from code with one.
 */

describe("isUnnamedProfileFunction", () => {
  test("an address the profiler could not name is unnamed", () => {
    expect(isUnnamedProfileFunction("0x270675")).toBe(true);
    expect(isUnnamedProfileFunction("0x7F3A2C10")).toBe(true);
  });

  test("an empty name or a profiler's placeholder is unnamed", () => {
    expect(isUnnamedProfileFunction("")).toBe(true);
    expect(isUnnamedProfileFunction("   ")).toBe(true);
    expect(isUnnamedProfileFunction(null)).toBe(true);
    expect(isUnnamedProfileFunction(undefined)).toBe(true);
    expect(isUnnamedProfileFunction("<unknown>")).toBe(true);
  });

  test("a function's name is not, even one that starts like an address", () => {
    expect(isUnnamedProfileFunction("parseOrder")).toBe(false);
    expect(isUnnamedProfileFunction("0xDeadBeefHandler")).toBe(false);
    expect(isUnnamedProfileFunction("0x")).toBe(false);
    expect(isUnnamedProfileFunction("<anonymous>")).toBe(false);
  });
});

describe("getShortProfileFunctionName", () => {
  test("Go: the module's import path goes, the package stays", () => {
    expect(
      getShortProfileFunctionName(
        "go.opentelemetry.io/obi/pkg/export/otel/metric/components/exemplar.(*randRes).Offer",
      ),
    ).toBe("exemplar.(*randRes).Offer");
    expect(getShortProfileFunctionName("net/http.(*conn).serve")).toBe(
      "http.(*conn).serve",
    );
    expect(
      getShortProfileFunctionName("golang.org/x/net/http2.(*Framer).ReadFrame"),
    ).toBe("http2.(*Framer).ReadFrame");
  });

  test("Go: a path inside a generic's type argument is not the import path", () => {
    expect(
      getShortProfileFunctionName(
        "go.opentelemetry.io/otel/sdk/metric/internal/aggregate.Builder[go.shape.int64].Sum",
      ),
    ).toBe("aggregate.Builder[go.shape.int64].Sum");
    expect(
      getShortProfileFunctionName(
        "example.com/cache.Get[go.opentelemetry.io/otel/attribute.Set]",
      ),
    ).toBe("cache.Get[go.opentelemetry.io/otel/attribute.Set]");
  });

  test("Go: a package with no path, or one segment, is kept whole", () => {
    expect(getShortProfileFunctionName("main.main")).toBe("main.main");
    expect(getShortProfileFunctionName("runtime.mallocgc")).toBe(
      "runtime.mallocgc",
    );
    expect(getShortProfileFunctionName("encoding/json.Marshal")).toBe(
      "json.Marshal",
    );
  });

  test("Java: the package goes, the class and method stay", () => {
    expect(
      getShortProfileFunctionName(
        "org.springframework.web.servlet.DispatcherServlet.doDispatch",
      ),
    ).toBe("DispatcherServlet.doDispatch");
    expect(getShortProfileFunctionName("java.util.HashMap.get")).toBe(
      "HashMap.get",
    );
    expect(getShortProfileFunctionName("com.acme.shop.Order$Line.total")).toBe(
      "Order$Line.total",
    );
  });

  test("a single lower-case segment before a class is no package to drop", () => {
    expect(getShortProfileFunctionName("json.Marshal")).toBe("json.Marshal");
    expect(getShortProfileFunctionName("search.Rank")).toBe("search.Rank");
  });

  test("names with nothing to shorten are kept as they are", () => {
    for (const name of [
      "parseOrder",
      "JSON.parse",
      "Router.handle",
      "<module>",
      "<anonymous>",
      "process_job",
      "(garbage collector)",
      "std::vector<int>::push_back",
      "tokio::runtime::task::harness::poll",
      "V8::EntryFrame",
    ]) {
      expect(getShortProfileFunctionName(name)).toBe(name);
    }
  });

  test("an unnamed frame keeps its address, and nothing stays nothing", () => {
    expect(getShortProfileFunctionName("0x270675")).toBe("0x270675");
    expect(getShortProfileFunctionName("")).toBe("");
    expect(getShortProfileFunctionName(undefined)).toBe("");
  });

  test("a trailing slash never leaves an empty name", () => {
    expect(getShortProfileFunctionName("weird/")).toBe("weird/");
  });
});
