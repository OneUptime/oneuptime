/**
 * Shared types for source map resolution of exception stack traces.
 *
 * These live in Common/Types (not Common/Server) because the Dashboard UI
 * consumes the resolved frames returned by the resolve-stack-trace API and
 * must not import server-side modules.
 */

/**
 * A stack frame as parsed from a raw stack trace at ingest time.
 * Structurally identical to StackFrame in
 * Common/Server/Utils/Telemetry/StackTraceParser.ts — the ExceptionInstance
 * parsedFrames column stores a JSON array of these.
 */
export interface MinifiedStackFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
  columnNumber?: number | undefined;
  inApp: boolean;
}

/** A few lines of original source around the resolved location. */
export interface SourceCodeSnippet {
  /** 1-based line number of lines[0] in the original source file. */
  startLine: number;
  /** The context lines, in file order. */
  lines: Array<string>;
  /** 1-based line number (in the original source file) to highlight. */
  highlightLine: number;
}

/**
 * A stack frame after source map resolution. The minified fields are always
 * present (copied from the input frame); the original* fields are only set
 * when resolved is true.
 */
export interface ResolvedStackFrame extends MinifiedStackFrame {
  /** True when a source map mapped this frame back to original source. */
  resolved: boolean;
  originalFileName?: string | undefined;
  originalLineNumber?: number | undefined;
  originalColumnNumber?: number | undefined;
  originalFunctionName?: string | undefined;
  /** Present when the matching map was built with sourcesContent. */
  sourceCodeSnippet?: SourceCodeSnippet | undefined;
}

/** Response body of POST /telemetry/exceptions/resolve-stack-trace. */
export interface ResolveStackTraceResult {
  frames: Array<ResolvedStackFrame>;
  /** Number of frames that were resolved through a source map. */
  resolvedCount: number;
  /** Number of source maps found for the (service, release) pair. */
  sourceMapCount: number;
  /**
   * Maps that a frame matched but that were not loaded, because loading them
   * would have exceeded the resolver's per-request byte budget
   * (SOURCE_MAP_MAX_BYTES_PER_RESOLVE). Non-zero means symbols are missing
   * for a reason an operator can fix by raising the budget — as opposed to
   * the maps simply never having been uploaded.
   */
  sourceMapsSkippedForSize: number;
}
