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
export function getFramePackageName(fileName: string | undefined): string | null {
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

  const sitePackages: RegExpMatchArray | null = path.match(SITE_PACKAGES_PATTERN);

  if (sitePackages) {
    return sitePackages[1]!.replace(/\.py$/, "");
  }

  const goModule: RegExpMatchArray | null = path.match(GO_MODULE_PATTERN);

  if (goModule) {
    return goModule[1]!.replace(/\\/g, "/");
  }

  return null;
}

/*
 * The "Type: message" line a trace starts with, for the frames view — which
 * otherwise shows where it happened but not what happened.
 */
export function getStackTraceHeadline(stackTrace: string | undefined): string | null {
  for (const line of (stackTrace || "").split("\n")) {
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
  // For frame lines: the leading whitespace, the function and the location.
  indent: string;
  functionName: string;
  location: string;
}

const AT_FRAME_PATTERN: RegExp = /^(\s*)at\s+(.*)$/;
const CALL_WITH_LOCATION_PATTERN: RegExp = /^(.*?)\s*\(([^()]*)\)$/;
const LOCATION_ONLY_PATTERN: RegExp = /(?:^|[/\\])[^\s]*:\d+(?::\d+)?$/;
const CAUSED_BY_PATTERN: RegExp = /^\s*(Caused by|Suppressed):/;

/*
 * Split a raw stack trace into lines the viewer can colour: the exception
 * message (first line, and every "Caused by:" line), "at" frames split into
 * function and location (V8, Java and .NET all use that shape), and
 * everything else verbatim (Python, Go, Ruby traces).
 */
export function parseRawStackTraceLines(
  stackTrace: string | undefined,
): Array<RawStackTraceLine> {
  const lines: Array<string> = (stackTrace || "").split("\n");

  return lines.map((rawLine: string, index: number): RawStackTraceLine => {
    const text: string = rawLine.replace(/\r$/, "");
    const base: RawStackTraceLine = {
      lineNumber: index + 1,
      kind: "other",
      text,
      indent: "",
      functionName: "",
      location: "",
    };

    const atMatch: RegExpMatchArray | null = text.match(AT_FRAME_PATTERN);

    if (atMatch) {
      const rest: string = (atMatch[2] || "").trim();
      const callMatch: RegExpMatchArray | null = rest.match(
        CALL_WITH_LOCATION_PATTERN,
      );

      if (callMatch && callMatch[1]) {
        return {
          ...base,
          kind: "frame",
          indent: atMatch[1] || "",
          functionName: callMatch[1],
          location: callMatch[2] || "",
        };
      }

      if (LOCATION_ONLY_PATTERN.test(rest)) {
        return {
          ...base,
          kind: "frame",
          indent: atMatch[1] || "",
          location: rest,
        };
      }

      return {
        ...base,
        kind: "frame",
        indent: atMatch[1] || "",
        functionName: rest,
      };
    }

    if ((index === 0 && text.trim().length > 0) || CAUSED_BY_PATTERN.test(text)) {
      return { ...base, kind: "message" };
    }

    return base;
  });
}
