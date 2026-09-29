import { ResolvedStackFrame } from "Common/Types/Telemetry/SourceMap";
import { FrameDisplayLocation } from "./SourceMapFrames";

/*
 * Pure helpers for StackFrameViewer: which frames to show for a view mode,
 * where the crash most likely happened, and how to read a raw stack trace
 * line. Kept out of the component so they can be unit tested.
 */

export enum StackTraceViewMode {
  // App frames shown, consecutive library frames folded into one row.
  Smart = "smart",
  AppOnly = "app",
  All = "all",
}

export interface StackTraceFrameItem {
  kind: "frame";
  frame: ResolvedStackFrame;
  originalIndex: number;
  isTopAppFrame: boolean;
}

export interface StackTraceLibraryGroupItem {
  kind: "collapsed-lib";
  frames: Array<{ frame: ResolvedStackFrame; originalIndex: number }>;
  // Index of the group's first frame; identifies the group when expanded.
  startIndex: number;
  // Shortened directory shared by the first and last frame, or "".
  commonPackage: string;
}

export type StackTraceDisplayItem =
  | StackTraceFrameItem
  | StackTraceLibraryGroupItem;

const PYTHON_TRACEBACK_HEADER_PATTERN: RegExp =
  /^\s*Traceback \(most recent call last\):\s*$/m;

/*
 * Python prints a traceback entry point first ("most recent call last") and
 * the parser stores its frames in that order, while V8, Java, .NET, Go and
 * Ruby print the crash point first.
 */
export function isOutermostFirstStackTrace(
  stackTrace: string | undefined,
): boolean {
  return PYTHON_TRACEBACK_HEADER_PATTERN.test(stackTrace || "");
}

/*
 * Everything else in the viewer reads frames innermost first (index 0 is
 * where the exception was raised), so an outermost-first trace is turned
 * around before it is used.
 */
export function orderFramesInnermostFirst<T>(
  frames: ReadonlyArray<T>,
  stackTrace: string | undefined,
): Array<T> {
  return isOutermostFirstStackTrace(stackTrace)
    ? [...frames].reverse()
    : [...frames];
}

// The topmost frame in application code: the most likely crash point.
export function getTopAppFrameIndex(
  frames: ReadonlyArray<ResolvedStackFrame>,
): number {
  return frames.findIndex((frame: ResolvedStackFrame): boolean => {
    return frame.inApp;
  });
}

// ".../services/inventory.ts" style: the last three path segments.
export function shortenFramePath(fullPath: string | undefined): string {
  if (!fullPath) {
    return "";
  }

  const parts: Array<string> = fullPath.split("/");

  if (parts.length <= 3) {
    return fullPath;
  }

  return ".../" + parts.slice(-3).join("/");
}

export function formatFrameLocation(
  location: FrameDisplayLocation,
  options: { shorten: boolean },
): string {
  const path: string = options.shorten
    ? shortenFramePath(location.fileName)
    : location.fileName || "";

  if (!path) {
    return "";
  }

  if (!location.lineNumber || location.lineNumber <= 0) {
    return path;
  }

  return `${path}:${location.lineNumber}${
    location.columnNumber ? `:${location.columnNumber}` : ""
  }`;
}

function getCommonPackage(
  frames: Array<{ frame: ResolvedStackFrame; originalIndex: number }>,
): string {
  const first: ResolvedStackFrame | undefined = frames[0]?.frame;
  const last: ResolvedStackFrame | undefined = frames[frames.length - 1]?.frame;

  const directoryOf: (fileName: string | undefined) => string = (
    fileName: string | undefined,
  ): string => {
    return fileName ? fileName.split("/").slice(0, -1).join("/") : "";
  };

  const firstDirectory: string = directoryOf(first?.fileName);

  return firstDirectory && firstDirectory === directoryOf(last?.fileName)
    ? shortenFramePath(firstDirectory)
    : "";
}

export interface BuildStackTraceDisplayItemsArgs {
  frames: ReadonlyArray<ResolvedStackFrame>;
  viewMode: StackTraceViewMode;
  // startIndex of every library group the user unfolded.
  expandedLibGroups: ReadonlySet<number>;
}

export function buildStackTraceDisplayItems(
  args: BuildStackTraceDisplayItemsArgs,
): Array<StackTraceDisplayItem> {
  const topAppFrameIndex: number = getTopAppFrameIndex(args.frames);

  const toFrameItem: (
    frame: ResolvedStackFrame,
    index: number,
  ) => StackTraceFrameItem = (
    frame: ResolvedStackFrame,
    index: number,
  ): StackTraceFrameItem => {
    return {
      kind: "frame",
      frame,
      originalIndex: index,
      isTopAppFrame: index === topAppFrameIndex,
    };
  };

  if (args.viewMode === StackTraceViewMode.All) {
    return args.frames.map(toFrameItem);
  }

  if (args.viewMode === StackTraceViewMode.AppOnly) {
    const items: Array<StackTraceDisplayItem> = [];

    args.frames.forEach((frame: ResolvedStackFrame, index: number): void => {
      if (frame.inApp) {
        items.push(toFrameItem(frame, index));
      }
    });

    return items;
  }

  const items: Array<StackTraceDisplayItem> = [];
  let group: Array<{ frame: ResolvedStackFrame; originalIndex: number }> = [];
  let groupStartIndex: number = 0;

  const flushGroup: () => void = (): void => {
    if (group.length === 0) {
      return;
    }

    // A lone library frame is not worth a fold; an unfolded group stays open.
    if (group.length === 1 || args.expandedLibGroups.has(groupStartIndex)) {
      for (const entry of group) {
        items.push(toFrameItem(entry.frame, entry.originalIndex));
      }
    } else {
      items.push({
        kind: "collapsed-lib",
        frames: [...group],
        startIndex: groupStartIndex,
        commonPackage: getCommonPackage(group),
      });
    }

    group = [];
  };

  args.frames.forEach((frame: ResolvedStackFrame, index: number): void => {
    if (frame.inApp) {
      flushGroup();
      items.push(toFrameItem(frame, index));
      return;
    }

    if (group.length === 0) {
      groupStartIndex = index;
    }

    group.push({ frame, originalIndex: index });
  });

  flushGroup();

  return items;
}

export enum StackTraceFrameOrder {
  // The crash point first, as runtimes print V8 / Java / .NET traces.
  NewestFirst = "newest",
  // The entry point first, as Python prints its tracebacks.
  OldestFirst = "oldest",
}

export function orderStackTraceDisplayItems(
  items: ReadonlyArray<StackTraceDisplayItem>,
  order: StackTraceFrameOrder,
): Array<StackTraceDisplayItem> {
  return order === StackTraceFrameOrder.OldestFirst
    ? [...items].reverse()
    : [...items];
}

// Every frame number currently on screen (folded library frames excluded).
export function getVisibleFrameIndexes(
  items: ReadonlyArray<StackTraceDisplayItem>,
): Array<number> {
  const indexes: Array<number> = [];

  for (const item of items) {
    if (item.kind === "frame") {
      indexes.push(item.originalIndex);
    }
  }

  return indexes;
}

const NODE_MODULES_PACKAGE_PATTERN: RegExp =
  /node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)/g;
const SITE_PACKAGES_PATTERN: RegExp =
  /(?:site-packages|dist-packages)[/\\]([^/\\]+)/;
const GO_MODULE_PATTERN: RegExp = /[/\\]pkg[/\\]mod[/\\](.+?)@v[\d.]+/;

/*
 * The third-party package a library frame belongs to, for a badge that says
 * "express" instead of just "Library". The innermost node_modules wins, so a
 * dependency's own dependency is named rather than its parent.
 */
export function getFramePackageName(
  fileName: string | undefined,
): string | null {
  const path: string = (fileName || "").trim();

  if (!path) {
    return null;
  }

  if (path.startsWith("node:")) {
    return "node";
  }

  let innermostPackage: string | null = null;
  const nodeModulesPattern: RegExp = new RegExp(NODE_MODULES_PACKAGE_PATTERN);
  let match: RegExpExecArray | null = nodeModulesPattern.exec(path);

  while (match) {
    innermostPackage = match[1]!.replace(/\\/g, "/");
    match = nodeModulesPattern.exec(path);
  }

  if (innermostPackage) {
    return innermostPackage;
  }

  const sitePackages: RegExpMatchArray | null = path.match(
    SITE_PACKAGES_PATTERN,
  );

  if (sitePackages) {
    return sitePackages[1]!.replace(/\.py$/, "");
  }

  const goModule: RegExpMatchArray | null = path.match(GO_MODULE_PATTERN);

  if (goModule) {
    return goModule[1]!.replace(/\\/g, "/");
  }

  return null;
}

// "ValueError: bad sku", "requests.exceptions.HTTPError", "KeyboardInterrupt"
const PYTHON_EXCEPTION_LINE_PATTERN: RegExp = /^[A-Za-z_][\w.]*(?::.*)?$/;
const INDENTED_LINE_PATTERN: RegExp = /^\s/;

function isPythonExceptionLine(line: string): boolean {
  return (
    !INDENTED_LINE_PATTERN.test(line) &&
    !PYTHON_TRACEBACK_HEADER_PATTERN.test(line) &&
    PYTHON_EXCEPTION_LINE_PATTERN.test(line.trimEnd())
  );
}

/*
 * The "Type: message" line of a trace, for the frames view — which otherwise
 * shows where it happened but not what happened. Most runtimes print it
 * first; Python prints it last, after the frames, below a fixed
 * "Traceback (most recent call last):" header.
 */
export function getStackTraceHeadline(
  stackTrace: string | undefined,
): string | null {
  const lines: Array<string> = (stackTrace || "")
    .split("\n")
    .map((line: string) => {
      return line.replace(/\r$/, "");
    });

  if (isOutermostFirstStackTrace(stackTrace)) {
    for (let index: number = lines.length - 1; index >= 0; index--) {
      const line: string = lines[index]!;

      if (!line.trim()) {
        continue;
      }

      // Frames and their source lines are indented: the message is below them.
      if (INDENTED_LINE_PATTERN.test(line)) {
        return null;
      }

      if (isPythonExceptionLine(line)) {
        return line.trim();
      }
    }

    return null;
  }

  for (const line of lines) {
    const trimmed: string = line.trim();

    if (!trimmed) {
      continue;
    }

    return AT_FRAME_PATTERN.test(line) ? null : trimmed;
  }

  return null;
}

export type RawStackTraceLineKind = "message" | "frame" | "other";

export interface RawStackTraceLine {
  lineNumber: number;
  kind: RawStackTraceLineKind;
  text: string;
  /*
   * For frame lines, the text cut into pieces that join back into it exactly:
   * prefix + functionName + separator + location + suffix === text.
   */
  prefix: string;
  functionName: string;
  separator: string;
  location: string;
  suffix: string;
}

const AT_FRAME_PATTERN: RegExp = /^(\s*at\s+)(.*)$/;
const CALL_WITH_LOCATION_PATTERN: RegExp = /^(.*?)(\s*\()([^()]*)(\))$/;
const LOCATION_ONLY_PATTERN: RegExp = /(?:^|[/\\])[^\s]*:\d+(?::\d+)?$/;
const CAUSED_BY_PATTERN: RegExp = /^\s*(Caused by|Suppressed):/;

/*
 * Split a raw stack trace into lines the viewer can colour without changing
 * a character: the exception message (the first line and every "Caused by:"
 * line, or for Python the exception lines after the frames), "at" frames cut
 * into function and location (V8, Java and .NET all use that shape), and
 * everything else as is (Python, Go, Ruby frames).
 */
export function parseRawStackTraceLines(
  stackTrace: string | undefined,
): Array<RawStackTraceLine> {
  const lines: Array<string> = (stackTrace || "").split("\n");
  const isPython: boolean = isOutermostFirstStackTrace(stackTrace);

  return lines.map((rawLine: string, index: number): RawStackTraceLine => {
    const text: string = rawLine.replace(/\r$/, "");
    const base: RawStackTraceLine = {
      lineNumber: index + 1,
      kind: "other",
      text,
      prefix: "",
      functionName: "",
      separator: "",
      location: "",
      suffix: "",
    };

    if (isPython) {
      return text.trim() && isPythonExceptionLine(text)
        ? { ...base, kind: "message" }
        : base;
    }

    const atMatch: RegExpMatchArray | null = text.match(AT_FRAME_PATTERN);

    if (atMatch) {
      const rest: string = atMatch[2] || "";
      const call: string = rest.trimEnd();
      const trailing: string = rest.slice(call.length);
      const callMatch: RegExpMatchArray | null = call.match(
        CALL_WITH_LOCATION_PATTERN,
      );

      if (callMatch && callMatch[1]) {
        return {
          ...base,
          kind: "frame",
          prefix: atMatch[1] || "",
          functionName: callMatch[1],
          separator: callMatch[2] || "",
          location: callMatch[3] || "",
          suffix: (callMatch[4] || "") + trailing,
        };
      }

      if (LOCATION_ONLY_PATTERN.test(call)) {
        return {
          ...base,
          kind: "frame",
          prefix: atMatch[1] || "",
          location: call,
          suffix: trailing,
        };
      }

      return {
        ...base,
        kind: "frame",
        prefix: atMatch[1] || "",
        functionName: call,
        suffix: trailing,
      };
    }

    if (
      (index === 0 && text.trim().length > 0) ||
      CAUSED_BY_PATTERN.test(text)
    ) {
      return { ...base, kind: "message" };
    }

    return base;
  });
}
