/**
 * Resolves minified stack frames back to original source locations using
 * uploaded source maps (see the TelemetrySourceMap model).
 *
 * Resolution is lazy — it runs at read time when an exception detail view
 * asks for it, never on the ingestion hot path. That also tolerates the
 * CI race where a map is uploaded slightly after the first error of a new
 * release arrives.
 */

import {
  MinifiedStackFrame,
  ResolvedStackFrame,
  SourceCodeSnippet,
} from "../../../Types/Telemetry/SourceMap";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

export interface SourceMapBundle {
  /** Bundle path the map was uploaded for, e.g. "main.a8f1b2.js". */
  bundlePath: string;
  /** The raw source map JSON. */
  content: string;
}

/** Lines of context shown on each side of the resolved line. */
const SNIPPET_CONTEXT_LINES: number = 3;

/*
 * A single line longer than this is not human-authored source (it is
 * almost certainly minified or generated content that leaked into
 * sourcesContent) and would bloat the API response for no debugging value.
 */
const MAX_SNIPPET_LINE_LENGTH: number = 512;

/** Ceiling on frames processed per call — stack traces are never this deep. */
const MAX_FRAMES_TO_RESOLVE: number = 500;

interface ParsedBundle {
  bundlePath: string;
  normalizedPath: string;
  traceMap: TraceMap;
  sourcesContent: Array<string | null>;
  sources: Array<string | null>;
  resolvedSources: Array<string>;
}

export default class SourceMapResolver {
  /**
   * Normalize a bundle path or stack frame file name for matching:
   * strip URL scheme + host, query string, hash, and leading slashes,
   * so "https://app.example.com/assets/main.js?v=1" and
   * "assets/main.js" compare equal.
   */
  public static normalizePath(path: string): string {
    let normalized: string = (path || "").trim();

    // Strip scheme + host of absolute URLs (http, https, webpack, ...).
    const schemeMatch: RegExpMatchArray | null = normalized.match(
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//,
    );
    if (schemeMatch) {
      const afterScheme: string = normalized.substring(schemeMatch[0].length);
      const firstSlash: number = afterScheme.indexOf("/");
      normalized = firstSlash >= 0 ? afterScheme.substring(firstSlash) : "";
    }

    // Strip query string and hash.
    const queryIndex: number = normalized.indexOf("?");
    if (queryIndex >= 0) {
      normalized = normalized.substring(0, queryIndex);
    }
    const hashIndex: number = normalized.indexOf("#");
    if (hashIndex >= 0) {
      normalized = normalized.substring(0, hashIndex);
    }

    // Strip leading slashes.
    normalized = normalized.replace(/^\/+/, "");

    return normalized;
  }

  /**
   * How well a bundle path matches a stack frame file name: the number of
   * trailing path segments they share, or 0 when the file names differ.
   * Matching is segment-aligned so "main.js" never matches "not-main.js".
   */
  public static getMatchScore(
    frameFileName: string,
    bundlePath: string,
  ): number {
    const frameSegments: Array<string> = SourceMapResolver.normalizePath(
      frameFileName,
    )
      .split("/")
      .filter((s: string) => {
        return s.length > 0;
      });
    const bundleSegments: Array<string> = SourceMapResolver.normalizePath(
      bundlePath,
    )
      .split("/")
      .filter((s: string) => {
        return s.length > 0;
      });

    if (frameSegments.length === 0 || bundleSegments.length === 0) {
      return 0;
    }

    let shared: number = 0;
    while (
      shared < frameSegments.length &&
      shared < bundleSegments.length &&
      frameSegments[frameSegments.length - 1 - shared] ===
        bundleSegments[bundleSegments.length - 1 - shared]
    ) {
      shared++;
    }

    // The file name itself (last segment) must match for any score at all.
    return shared;
  }

  /**
   * Resolve parsed stack frames against a set of uploaded source maps.
   * Frames that cannot be resolved (no matching map, no mapping at that
   * position, malformed map) pass through unchanged with resolved: false —
   * resolution must never make a stack trace worse than the minified one.
   */
  public static resolveFrames(
    frames: Array<MinifiedStackFrame>,
    bundles: Array<SourceMapBundle>,
  ): Array<ResolvedStackFrame> {
    const parsedBundleCache: Map<string, ParsedBundle | null> = new Map();

    type ParseBundleFunction = (bundle: SourceMapBundle) => ParsedBundle | null;

    const parseBundle: ParseBundleFunction = (
      bundle: SourceMapBundle,
    ): ParsedBundle | null => {
      if (parsedBundleCache.has(bundle.bundlePath)) {
        return parsedBundleCache.get(bundle.bundlePath) || null;
      }

      let parsed: ParsedBundle | null = null;

      try {
        const json: {
          version?: number;
          mappings?: string;
          sources?: Array<string | null>;
          sourcesContent?: Array<string | null>;
        } = JSON.parse(bundle.content);

        const traceMap: TraceMap = new TraceMap(bundle.content);

        parsed = {
          bundlePath: bundle.bundlePath,
          normalizedPath: SourceMapResolver.normalizePath(bundle.bundlePath),
          traceMap: traceMap,
          sourcesContent: Array.isArray(json.sourcesContent)
            ? json.sourcesContent
            : [],
          sources: Array.isArray(traceMap.sources) ? traceMap.sources : [],
          resolvedSources: Array.isArray(traceMap.resolvedSources)
            ? traceMap.resolvedSources
            : [],
        };
      } catch {
        // Malformed map — treat as absent.
        parsed = null;
      }

      parsedBundleCache.set(bundle.bundlePath, parsed);
      return parsed;
    };

    const results: Array<ResolvedStackFrame> = [];

    for (const frame of frames.slice(0, MAX_FRAMES_TO_RESOLVE)) {
      results.push(SourceMapResolver.resolveFrame(frame, bundles, parseBundle));
    }

    return results;
  }

  private static resolveFrame(
    frame: MinifiedStackFrame,
    bundles: Array<SourceMapBundle>,
    parseBundle: (bundle: SourceMapBundle) => ParsedBundle | null,
  ): ResolvedStackFrame {
    const unresolved: ResolvedStackFrame = {
      ...frame,
      resolved: false,
    };

    if (!frame.fileName || !frame.lineNumber || frame.lineNumber < 1) {
      return unresolved;
    }

    // Pick the bundle whose path shares the most trailing segments.
    let bestBundle: SourceMapBundle | null = null;
    let bestScore: number = 0;

    for (const bundle of bundles) {
      const score: number = SourceMapResolver.getMatchScore(
        frame.fileName,
        bundle.bundlePath,
      );
      if (score > bestScore) {
        bestScore = score;
        bestBundle = bundle;
      }
    }

    if (!bestBundle) {
      return unresolved;
    }

    const parsed: ParsedBundle | null = parseBundle(bestBundle);

    if (!parsed) {
      return unresolved;
    }

    try {
      /*
       * trace-mapping expects a 1-based line and a 0-based column, while
       * JS stack traces (and StackTraceParser) carry 1-based columns.
       * Frames without a column (some runtimes omit it) probe column 0 —
       * for the typical fully-minified single-line bundle every mapping
       * is on line 1 anyway, so this still lands on a real segment often
       * enough to be worth trying.
       */
      const position: {
        source: string | null;
        line: number | null;
        column: number | null;
        name: string | null;
      } = originalPositionFor(parsed.traceMap, {
        line: frame.lineNumber,
        column: Math.max(0, (frame.columnNumber || 1) - 1),
      });

      if (!position.source || position.line === null) {
        return unresolved;
      }

      const originalFileName: string = SourceMapResolver.cleanSourcePath(
        position.source,
      );

      return {
        ...frame,
        resolved: true,
        originalFileName: originalFileName,
        originalLineNumber: position.line,
        originalColumnNumber:
          position.column !== null ? position.column + 1 : undefined,
        originalFunctionName: position.name || undefined,
        sourceCodeSnippet: SourceMapResolver.extractSnippet(
          parsed,
          position.source,
          position.line,
        ),
        /*
         * A frame that maps back to original source is application code
         * unless the original path says otherwise (bundled dependencies
         * keep their node_modules path in the map).
         */
        inApp: !originalFileName.includes("node_modules/"),
      };
    } catch {
      return unresolved;
    }
  }

  /**
   * Strip bundler scheme prefixes (webpack://, rollup://, vite/deps
   * paths...) and leading ./ or ../ noise from an original source path.
   */
  public static cleanSourcePath(sourcePath: string): string {
    let cleaned: string = sourcePath;

    // webpack://my-app/./src/foo.ts → ./src/foo.ts
    const schemeMatch: RegExpMatchArray | null = cleaned.match(
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//,
    );
    if (schemeMatch) {
      const afterScheme: string = cleaned.substring(schemeMatch[0].length);
      const firstSlash: number = afterScheme.indexOf("/");
      cleaned = firstSlash >= 0 ? afterScheme.substring(firstSlash + 1) : "";
    }

    // ./src/foo.ts → src/foo.ts ; ../../src/foo.ts → src/foo.ts
    cleaned = cleaned.replace(/^(\.\.?\/)+/, "");

    return cleaned || sourcePath;
  }

  private static extractSnippet(
    parsed: ParsedBundle,
    source: string,
    line: number,
  ): SourceCodeSnippet | undefined {
    if (!parsed.sourcesContent || parsed.sourcesContent.length === 0) {
      return undefined;
    }

    /*
     * originalPositionFor returns the source as it appears after sourceRoot
     * resolution, so look it up in resolvedSources first, then fall back to
     * the raw sources array (maps without sourceRoot).
     */
    let index: number = parsed.resolvedSources.indexOf(source);
    if (index < 0) {
      index = parsed.sources.indexOf(source);
    }

    if (index < 0 || index >= parsed.sourcesContent.length) {
      return undefined;
    }

    const content: string | null = parsed.sourcesContent[index] ?? null;

    if (typeof content !== "string" || content.length === 0) {
      return undefined;
    }

    const allLines: Array<string> = content.split("\n");

    if (line < 1 || line > allLines.length) {
      return undefined;
    }

    const startLine: number = Math.max(1, line - SNIPPET_CONTEXT_LINES);
    const endLine: number = Math.min(
      allLines.length,
      line + SNIPPET_CONTEXT_LINES,
    );

    const snippetLines: Array<string> = [];
    for (let i: number = startLine; i <= endLine; i++) {
      let text: string = allLines[i - 1] || "";
      if (text.length > MAX_SNIPPET_LINE_LENGTH) {
        text = text.substring(0, MAX_SNIPPET_LINE_LENGTH) + "…";
      }
      snippetLines.push(text);
    }

    return {
      startLine: startLine,
      lines: snippetLines,
      highlightLine: line,
    };
  }
}
