import SourceMapResolver, {
  SourceMapBundle,
} from "../../../../Server/Utils/Telemetry/SourceMapResolver";
import StackTraceParser, {
  ParsedStackTrace,
} from "../../../../Server/Utils/Telemetry/StackTraceParser";
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
} from "../../../../Types/Telemetry/SourceMap";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * A real source map generated with @jridgewell/gen-mapping for a pretend
 * bundle main.abc123.js. Mappings (generated line 1, 0-based columns):
 *   col  0 → src/greet.ts line 1 col 16, name "greet"
 *   col 20 → src/greet.ts line 2 col  8, name "name"
 *   col 45 → src/greet.ts line 6 col 16, name "onSelect"
 *   col 60 → src/greet.ts line 7 col  9, name "greet"
 * sourcesContent carries the 8-line original source below.
 */
const FIXTURE_MAP: string = JSON.stringify({
  version: 3,
  file: "main.abc123.js",
  names: ["greet", "name", "onSelect"],
  sources: ["webpack://my-app/./src/greet.ts"],
  sourcesContent: [
    [
      "export function greet(user) {",
      "  const name = user.name;",
      "  return `Hello, ${name}!`;",
      "}",
      "",
      "export function onSelect(item) {",
      "  return greet(item.owner);",
      "}",
    ].join("\n"),
  ],
  mappings: "AAAgBA,oBACRC,yBAIQC,eACPF",
});

const FIXTURE_BUNDLE: SourceMapBundle = {
  bundlePath: "main.abc123.js",
  content: FIXTURE_MAP,
};

type MakeFrameFunction = (
  fileName: string,
  lineNumber: number,
  columnNumber?: number,
) => MinifiedStackFrame;

const makeFrame: MakeFrameFunction = (
  fileName: string,
  lineNumber: number,
  columnNumber?: number,
): MinifiedStackFrame => {
  return {
    functionName: "e.minified",
    fileName: fileName,
    lineNumber: lineNumber,
    columnNumber: columnNumber,
    inApp: true,
  };
};

describe("SourceMapResolver.normalizePath", () => {
  test("strips scheme, host, query and hash from a URL", () => {
    expect(
      SourceMapResolver.normalizePath(
        "https://app.example.com/assets/main.js?v=123#top",
      ),
    ).toBe("assets/main.js");
  });

  test("strips leading slashes from a path", () => {
    expect(SourceMapResolver.normalizePath("/assets/main.js")).toBe(
      "assets/main.js",
    );
  });

  test("leaves a bare file name unchanged", () => {
    expect(SourceMapResolver.normalizePath("main.js")).toBe("main.js");
  });

  test("handles a URL with no path", () => {
    expect(SourceMapResolver.normalizePath("https://app.example.com")).toBe("");
  });

  test("handles empty input", () => {
    expect(SourceMapResolver.normalizePath("")).toBe("");
  });

  test("converts Windows backslash separators to forward slashes", () => {
    expect(
      SourceMapResolver.normalizePath("build\\static\\js\\main.abc123.js"),
    ).toBe("build/static/js/main.abc123.js");
  });
});

describe("SourceMapResolver.getMatchScore", () => {
  test("bare bundle file name matches a full URL frame", () => {
    expect(
      SourceMapResolver.getMatchScore(
        "https://app.example.com/assets/main.abc123.js",
        "main.abc123.js",
      ),
    ).toBe(1);
  });

  test("more shared trailing segments score higher", () => {
    expect(
      SourceMapResolver.getMatchScore(
        "https://app.example.com/assets/main.js",
        "assets/main.js",
      ),
    ).toBe(2);
  });

  test("different file names do not match at all", () => {
    expect(
      SourceMapResolver.getMatchScore(
        "https://app.example.com/assets/main.js",
        "vendor.js",
      ),
    ).toBe(0);
  });

  test("matching is segment-aligned, not substring-based", () => {
    expect(
      SourceMapResolver.getMatchScore(
        "https://app.example.com/not-main.js",
        "main.js",
      ),
    ).toBe(0);
  });

  test("query strings on the frame do not break the match", () => {
    expect(
      SourceMapResolver.getMatchScore(
        "https://app.example.com/assets/main.js?v=42",
        "main.js",
      ),
    ).toBe(1);
  });

  test("a Windows-style bundle path matches a URL frame", () => {
    expect(
      SourceMapResolver.getMatchScore(
        "https://app.example.com/static/js/main.abc123.js",
        "build\\static\\js\\main.abc123.js",
      ),
    ).toBe(3);
  });
});

describe("SourceMapResolver.cleanSourcePath", () => {
  test("strips the webpack scheme and namespace", () => {
    expect(
      SourceMapResolver.cleanSourcePath("webpack://my-app/src/greet.ts"),
    ).toBe("src/greet.ts");
  });

  test("strips leading relative segments", () => {
    expect(SourceMapResolver.cleanSourcePath("../../src/greet.ts")).toBe(
      "src/greet.ts",
    );
  });

  test("leaves a plain path unchanged", () => {
    expect(SourceMapResolver.cleanSourcePath("src/greet.ts")).toBe(
      "src/greet.ts",
    );
  });
});

describe("SourceMapResolver.resolveFrames", () => {
  test("resolves a minified frame to the original file, line, column and name", () => {
    // 1-based column 46 = 0-based 45 → onSelect at greet.ts line 6
    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("https://app.example.com/assets/main.abc123.js", 1, 46)],
      [FIXTURE_BUNDLE],
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]!.resolved).toBe(true);
    expect(frames[0]!.originalFileName).toBe("src/greet.ts");
    expect(frames[0]!.originalLineNumber).toBe(6);
    expect(frames[0]!.originalColumnNumber).toBe(17); // 0-based 16 + 1
    expect(frames[0]!.originalFunctionName).toBe("onSelect");
    // Minified fields are preserved for cross-checking.
    expect(frames[0]!.fileName).toBe(
      "https://app.example.com/assets/main.abc123.js",
    );
    expect(frames[0]!.lineNumber).toBe(1);
  });

  test("extracts a source snippet around the original line from sourcesContent", () => {
    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 1, 46)],
      [FIXTURE_BUNDLE],
    );

    const snippet: ResolvedStackFrame["sourceCodeSnippet"] =
      frames[0]!.sourceCodeSnippet;

    expect(snippet).toBeDefined();
    expect(snippet!.highlightLine).toBe(6);
    expect(snippet!.startLine).toBe(3); // 6 - 3 context lines
    expect(snippet!.lines).toHaveLength(6); // lines 3..8 of an 8-line file
    expect(snippet!.lines[snippet!.highlightLine - snippet!.startLine]).toBe(
      "export function onSelect(item) {",
    );
  });

  test("a mapping between segments resolves to the preceding segment", () => {
    // 1-based col 21 = 0-based 20 → exactly the `name` segment
    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 1, 21)],
      [FIXTURE_BUNDLE],
    );

    expect(frames[0]!.resolved).toBe(true);
    expect(frames[0]!.originalLineNumber).toBe(2);
    expect(frames[0]!.originalFunctionName).toBe("name");
  });

  test("a column BETWEEN segments resolves to the segment before it (greatest-lower-bound bias)", () => {
    /*
     * 1-based col 31 = 0-based 30 sits strictly between the segments at
     * 0-based columns 20 (`name`, line 2) and 45 (`onSelect`, line 6).
     * The lookup must land on the preceding segment — a probe of an exact
     * segment start could not detect a bias regression.
     */
    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 1, 31)],
      [FIXTURE_BUNDLE],
    );

    expect(frames[0]!.resolved).toBe(true);
    expect(frames[0]!.originalLineNumber).toBe(2);
    expect(frames[0]!.originalFunctionName).toBe("name");
  });

  test("a frame without a column still resolves by probing column 0", () => {
    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 1)],
      [FIXTURE_BUNDLE],
    );

    expect(frames[0]!.resolved).toBe(true);
    expect(frames[0]!.originalLineNumber).toBe(1);
    expect(frames[0]!.originalFunctionName).toBe("greet");
  });

  test("a frame with no matching bundle passes through unresolved", () => {
    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("https://app.example.com/assets/vendor.js", 1, 46)],
      [FIXTURE_BUNDLE],
    );

    expect(frames[0]!.resolved).toBe(false);
    expect(frames[0]!.originalFileName).toBeUndefined();
    expect(frames[0]!.fileName).toBe(
      "https://app.example.com/assets/vendor.js",
    );
  });

  test("a line with no mapping passes through unresolved", () => {
    // The fixture only maps generated line 1.
    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 99, 5)],
      [FIXTURE_BUNDLE],
    );

    expect(frames[0]!.resolved).toBe(false);
  });

  test("a malformed map is treated as absent, not an error", () => {
    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 1, 46)],
      [{ bundlePath: "main.abc123.js", content: "{not json" }],
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]!.resolved).toBe(false);
  });

  test("a map without sourcesContent resolves but yields no snippet", () => {
    const mapWithoutContent: Record<string, unknown> = JSON.parse(FIXTURE_MAP);
    delete mapWithoutContent["sourcesContent"];

    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 1, 46)],
      [
        {
          bundlePath: "main.abc123.js",
          content: JSON.stringify(mapWithoutContent),
        },
      ],
    );

    expect(frames[0]!.resolved).toBe(true);
    expect(frames[0]!.sourceCodeSnippet).toBeUndefined();
  });

  test("frames whose original source is under node_modules are marked as library code", () => {
    const libraryMap: Record<string, unknown> = JSON.parse(FIXTURE_MAP);
    libraryMap["sources"] = ["webpack://my-app/./node_modules/lodash/index.js"];

    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 1, 46)],
      [{ bundlePath: "main.abc123.js", content: JSON.stringify(libraryMap) }],
    );

    expect(frames[0]!.resolved).toBe(true);
    expect(frames[0]!.inApp).toBe(false);
  });

  test("picks the bundle with the most specific path match", () => {
    const otherMap: Record<string, unknown> = JSON.parse(FIXTURE_MAP);
    otherMap["names"] = ["wrongFunction"];

    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("https://cdn.example.com/v2/assets/main.abc123.js", 1, 46)],
      [
        // Same file name, fewer matching segments.
        {
          bundlePath: "other/main.abc123.js",
          content: JSON.stringify(otherMap),
        },
        // File name + directory match — must win.
        { bundlePath: "assets/main.abc123.js", content: FIXTURE_MAP },
      ],
    );

    expect(frames[0]!.resolved).toBe(true);
    expect(frames[0]!.originalFunctionName).toBe("onSelect");
  });

  test("resolves through an indexed (sections) source map", () => {
    /*
     * Indexed maps are what some bundlers emit for concatenated builds.
     * The upload validator admits them, so the resolver must flatten them
     * (AnyMap) rather than fail on the missing top-level mappings string.
     */
    const sectionedMap: string = JSON.stringify({
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: JSON.parse(FIXTURE_MAP),
        },
      ],
    });

    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 1, 46)],
      [{ bundlePath: "main.abc123.js", content: sectionedMap }],
    );

    expect(frames[0]!.resolved).toBe(true);
    expect(frames[0]!.originalFileName).toBe("src/greet.ts");
    expect(frames[0]!.originalLineNumber).toBe(6);
    expect(frames[0]!.originalFunctionName).toBe("onSelect");
    // sourcesContent survives the section flattening.
    expect(frames[0]!.sourceCodeSnippet).toBeDefined();
    expect(frames[0]!.sourceCodeSnippet!.highlightLine).toBe(6);
  });

  test("empty inputs produce empty output", () => {
    expect(SourceMapResolver.resolveFrames([], [FIXTURE_BUNDLE])).toEqual([]);
    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      [makeFrame("main.abc123.js", 1, 46)],
      [],
    );
    expect(frames[0]!.resolved).toBe(false);
  });

  test("output length always equals input length, even past the resolution budget", () => {
    /*
     * The dashboard overlay discards a length-mismatched response
     * wholesale, so frames past the 500-frame resolution budget must pass
     * through unresolved rather than be truncated.
     */
    const manyFrames: Array<MinifiedStackFrame> = [];
    for (let i: number = 0; i < 502; i++) {
      manyFrames.push(makeFrame("main.abc123.js", 1, 46));
    }

    const frames: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      manyFrames,
      [FIXTURE_BUNDLE],
    );

    expect(frames).toHaveLength(502);
    // Within budget: resolved.
    expect(frames[0]!.resolved).toBe(true);
    expect(frames[499]!.resolved).toBe(true);
    // Past budget: passed through unresolved, not dropped.
    expect(frames[500]!.resolved).toBe(false);
    expect(frames[501]!.resolved).toBe(false);
    expect(frames[501]!.fileName).toBe("main.abc123.js");
  });
});

describe("SourceMapResolver.validateSourceMapContent", () => {
  test("accepts a source map v3 with a mappings string", () => {
    expect(() => {
      return SourceMapResolver.validateSourceMapContent(FIXTURE_MAP);
    }).not.toThrow();
  });

  test("accepts an indexed map with sections instead of mappings", () => {
    expect(() => {
      return SourceMapResolver.validateSourceMapContent(
        JSON.stringify({ version: 3, sections: [] }),
      );
    }).not.toThrow();
  });

  test("rejects invalid JSON", () => {
    expect(() => {
      return SourceMapResolver.validateSourceMapContent("{not json");
    }).toThrow(BadDataException);
  });

  test("rejects a JSON array", () => {
    expect(() => {
      return SourceMapResolver.validateSourceMapContent("[1,2]");
    }).toThrow(BadDataException);
  });

  test("rejects a map that is not version 3", () => {
    expect(() => {
      return SourceMapResolver.validateSourceMapContent(
        JSON.stringify({ version: 2, mappings: "AAAA" }),
      );
    }).toThrow(BadDataException);
  });

  test("rejects a version given as a string, as required by the spec", () => {
    expect(() => {
      return SourceMapResolver.validateSourceMapContent(
        JSON.stringify({ version: "3", mappings: "AAAA" }),
      );
    }).toThrow(BadDataException);
  });

  test("rejects a map with neither mappings nor sections", () => {
    expect(() => {
      return SourceMapResolver.validateSourceMapContent(
        JSON.stringify({ version: 3, sources: [] }),
      );
    }).toThrow(BadDataException);
  });
});

describe("SourceMapResolver.sanitizeMinifiedStackFrames", () => {
  test("coerces a well-formed frames array", () => {
    const frames: Array<MinifiedStackFrame> =
      SourceMapResolver.sanitizeMinifiedStackFrames([
        {
          functionName: "e.onSelect",
          fileName: "main.js",
          lineNumber: 1,
          columnNumber: 46,
          inApp: true,
        },
      ]);

    expect(frames).toEqual([
      {
        functionName: "e.onSelect",
        fileName: "main.js",
        lineNumber: 1,
        columnNumber: 46,
        inApp: true,
      },
    ]);
  });

  test("returns [] for non-array input", () => {
    expect(SourceMapResolver.sanitizeMinifiedStackFrames(undefined)).toEqual(
      [],
    );
    expect(SourceMapResolver.sanitizeMinifiedStackFrames("frames")).toEqual([]);
    expect(SourceMapResolver.sanitizeMinifiedStackFrames({ a: 1 })).toEqual([]);
  });

  test("drops junk entries and normalizes junk fields", () => {
    const frames: Array<MinifiedStackFrame> =
      SourceMapResolver.sanitizeMinifiedStackFrames([
        null,
        "string",
        [1, 2],
        {
          functionName: 42,
          fileName: null,
          lineNumber: "7",
          columnNumber: Infinity,
          inApp: 1,
        },
      ]);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      functionName: "",
      fileName: "",
      lineNumber: 0,
      columnNumber: undefined,
      inApp: true,
    });
  });
});

describe("end to end: raw browser stack trace → parsed frames → resolved frames", () => {
  test("resolves the exact shape reported in the source map feature request", () => {
    const rawStackTrace: string = [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "    at e.onSelect (https://app.example.com/assets/main.abc123.js:1:46)",
      "    at e.render (https://app.example.com/assets/main.abc123.js:1:21)",
    ].join("\n");

    const parsed: ParsedStackTrace = StackTraceParser.parse(rawStackTrace);
    expect(parsed.frames).toHaveLength(2);

    const resolved: Array<ResolvedStackFrame> = SourceMapResolver.resolveFrames(
      parsed.frames,
      [FIXTURE_BUNDLE],
    );

    expect(resolved[0]!.resolved).toBe(true);
    expect(resolved[0]!.originalFileName).toBe("src/greet.ts");
    expect(resolved[0]!.originalLineNumber).toBe(6);
    expect(resolved[0]!.originalFunctionName).toBe("onSelect");

    expect(resolved[1]!.resolved).toBe(true);
    expect(resolved[1]!.originalLineNumber).toBe(2);
  });
});
