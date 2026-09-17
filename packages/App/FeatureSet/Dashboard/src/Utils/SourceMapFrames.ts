import {
  MinifiedStackFrame,
  ResolvedStackFrame,
} from "Common/Types/Telemetry/SourceMap";

/**
 * Pure helpers for the source-mapped stack trace UI (StackFrameViewer /
 * ExceptionExplorer). Kept out of the components so they can be unit
 * tested without rendering.
 */

export type ParseFramesJsonFunction = (
  parsedFrames: string | undefined,
) => Array<MinifiedStackFrame>;

/**
 * Parse the ExceptionInstance.parsedFrames JSON column. Malformed input
 * (bad JSON, not an array, junk entries) yields [] or skips the entry —
 * the viewer then falls back to the raw stack trace.
 */
export const parseFramesJson: ParseFramesJsonFunction = (
  parsedFrames: string | undefined,
): Array<MinifiedStackFrame> => {
  if (!parsedFrames) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(parsedFrames);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const frames: Array<MinifiedStackFrame> = [];

    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const frame: Record<string, unknown> = item as Record<string, unknown>;

      frames.push({
        functionName:
          typeof frame["functionName"] === "string"
            ? (frame["functionName"] as string)
            : "",
        fileName:
          typeof frame["fileName"] === "string"
            ? (frame["fileName"] as string)
            : "",
        lineNumber:
          typeof frame["lineNumber"] === "number"
            ? (frame["lineNumber"] as number)
            : 0,
        columnNumber:
          typeof frame["columnNumber"] === "number"
            ? (frame["columnNumber"] as number)
            : undefined,
        inApp: Boolean(frame["inApp"]),
      });
    }

    return frames;
  } catch {
    return [];
  }
};

export type ApplyResolvedFramesFunction = (
  baseFrames: Array<MinifiedStackFrame>,
  resolvedFrames: Array<ResolvedStackFrame> | undefined,
) => Array<ResolvedStackFrame>;

/**
 * Overlay the resolve API's output onto the parsed frames. The API returns
 * frames in input order; anything that does not line up (different length,
 * from a stale request) is discarded and the base frames are shown
 * unresolved — a wrong overlay is worse than none.
 */
export const applyResolvedFrames: ApplyResolvedFramesFunction = (
  baseFrames: Array<MinifiedStackFrame>,
  resolvedFrames: Array<ResolvedStackFrame> | undefined,
): Array<ResolvedStackFrame> => {
  if (
    resolvedFrames &&
    resolvedFrames.length === baseFrames.length &&
    baseFrames.length > 0
  ) {
    return resolvedFrames.map(
      (frame: ResolvedStackFrame, index: number): ResolvedStackFrame => {
        return {
          ...baseFrames[index]!,
          ...frame,
          resolved: Boolean(frame.resolved),
        };
      },
    );
  }

  return baseFrames.map((frame: MinifiedStackFrame): ResolvedStackFrame => {
    return { ...frame, resolved: false };
  });
};

export interface FrameDisplayLocation {
  functionName: string;
  fileName: string;
  lineNumber: number;
  columnNumber?: number | undefined;
  isOriginal: boolean;
}

export type GetFrameDisplayLocationFunction = (
  frame: ResolvedStackFrame,
) => FrameDisplayLocation;

/**
 * What the frame row should show: the original location when the frame was
 * source mapped, the minified one otherwise.
 */
export const getFrameDisplayLocation: GetFrameDisplayLocationFunction = (
  frame: ResolvedStackFrame,
): FrameDisplayLocation => {
  if (frame.resolved && frame.originalFileName) {
    return {
      functionName: frame.originalFunctionName || frame.functionName,
      fileName: frame.originalFileName,
      lineNumber: frame.originalLineNumber || 0,
      columnNumber: frame.originalColumnNumber,
      isOriginal: true,
    };
  }

  return {
    functionName: frame.functionName,
    fileName: frame.fileName,
    lineNumber: frame.lineNumber,
    columnNumber: frame.columnNumber,
    isOriginal: false,
  };
};

export type CountResolvedFramesFunction = (
  frames: Array<ResolvedStackFrame>,
) => number;

export const countResolvedFrames: CountResolvedFramesFunction = (
  frames: Array<ResolvedStackFrame>,
): number => {
  return frames.filter((frame: ResolvedStackFrame) => {
    return frame.resolved;
  }).length;
};
