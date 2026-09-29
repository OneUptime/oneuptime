import {
  applyResolvedFrames,
  countResolvedFrames,
  getFrameDisplayLocation,
  parseFramesJson,
  FrameDisplayLocation,
} from "../../FeatureSet/Dashboard/src/Utils/SourceMapFrames";
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
} from "Common/Types/Telemetry/SourceMap";
import { describe, expect, test } from "@jest/globals";

const MINIFIED_FRAME: MinifiedStackFrame = {
  functionName: "e.onSelect",
  fileName: "https://app.example.com/assets/main.a8f1b2.js",
  lineNumber: 1,
  columnNumber: 48291,
  inApp: true,
};

const RESOLVED_FRAME: ResolvedStackFrame = {
  ...MINIFIED_FRAME,
  resolved: true,
  originalFileName: "src/components/Select.tsx",
  originalLineNumber: 42,
  originalColumnNumber: 17,
  originalFunctionName: "onSelect",
};

describe("parseFramesJson", () => {
  test("parses the parsedFrames column shape", () => {
    const frames: Array<MinifiedStackFrame> = parseFramesJson(
      JSON.stringify([MINIFIED_FRAME]),
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(MINIFIED_FRAME);
  });

  test("returns [] for undefined, bad JSON and non-arrays", () => {
    expect(parseFramesJson(undefined)).toEqual([]);
    expect(parseFramesJson("{not json")).toEqual([]);
    expect(parseFramesJson(JSON.stringify({ a: 1 }))).toEqual([]);
  });

  test("normalizes junk entries instead of crashing", () => {
    const frames: Array<MinifiedStackFrame> = parseFramesJson(
      JSON.stringify([
        null,
        "string",
        { functionName: 42, fileName: null, lineNumber: "7", inApp: 1 },
      ]),
    );

    // null / "string" entries are dropped; the junk object is normalized.
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

describe("applyResolvedFrames", () => {
  test("overlays resolved frames when lengths line up", () => {
    const frames: Array<ResolvedStackFrame> = applyResolvedFrames(
      [MINIFIED_FRAME],
      [RESOLVED_FRAME],
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]!.resolved).toBe(true);
    expect(frames[0]!.originalFileName).toBe("src/components/Select.tsx");
    // The minified fields survive the overlay.
    expect(frames[0]!.fileName).toBe(MINIFIED_FRAME.fileName);
  });

  test("discards an overlay whose length does not match the base frames", () => {
    const frames: Array<ResolvedStackFrame> = applyResolvedFrames(
      [MINIFIED_FRAME, { ...MINIFIED_FRAME, lineNumber: 2 }],
      [RESOLVED_FRAME],
    );

    expect(frames).toHaveLength(2);
    expect(frames[0]!.resolved).toBe(false);
    expect(frames[0]!.originalFileName).toBeUndefined();
  });

  test("no overlay marks every frame unresolved", () => {
    const frames: Array<ResolvedStackFrame> = applyResolvedFrames(
      [MINIFIED_FRAME],
      undefined,
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]!.resolved).toBe(false);
  });

  test("empty base frames produce empty output even with an overlay", () => {
    expect(applyResolvedFrames([], [RESOLVED_FRAME])).toEqual([]);
  });
});

describe("getFrameDisplayLocation", () => {
  test("prefers the original location for a resolved frame", () => {
    const location: FrameDisplayLocation =
      getFrameDisplayLocation(RESOLVED_FRAME);

    expect(location.isOriginal).toBe(true);
    expect(location.fileName).toBe("src/components/Select.tsx");
    expect(location.lineNumber).toBe(42);
    expect(location.columnNumber).toBe(17);
    expect(location.functionName).toBe("onSelect");
  });

  test("falls back to the minified function name when the map had no name", () => {
    const location: FrameDisplayLocation = getFrameDisplayLocation({
      ...RESOLVED_FRAME,
      originalFunctionName: undefined,
    });

    expect(location.isOriginal).toBe(true);
    expect(location.functionName).toBe("e.onSelect");
  });

  test("shows the minified location for an unresolved frame", () => {
    const location: FrameDisplayLocation = getFrameDisplayLocation({
      ...MINIFIED_FRAME,
      resolved: false,
    });

    expect(location.isOriginal).toBe(false);
    expect(location.fileName).toBe(MINIFIED_FRAME.fileName);
    expect(location.lineNumber).toBe(1);
  });

  test("a frame marked resolved but without an original file is shown minified", () => {
    const location: FrameDisplayLocation = getFrameDisplayLocation({
      ...MINIFIED_FRAME,
      resolved: true,
    });

    expect(location.isOriginal).toBe(false);
  });
});

describe("countResolvedFrames", () => {
  test("counts only resolved frames", () => {
    expect(
      countResolvedFrames([
        RESOLVED_FRAME,
        { ...MINIFIED_FRAME, resolved: false },
      ]),
    ).toBe(1);
    expect(countResolvedFrames([])).toBe(0);
  });
});
