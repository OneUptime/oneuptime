export interface ParsedStackFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
}

/**
 * High-level category we bucket every profile type into. This drives the
 * UI: the three pills (CPU / Memory / Locks), the icon shown, the unit
 * used when formatting values, and the default explainer shown on the
 * profile detail page.
 *
 * This is the single source of truth for type-grouping across Profiles.
 */
export type ProfileCategory =
  | "cpu"
  | "memory"
  | "locks"
  | "wall"
  | "goroutines"
  | "other";

/**
 * The module origin of a stack frame. Used to color flame graphs in a way
 * a human can actually read: your code stands out, library code is
 * present but muted, runtime code is quiet.
 */
export type ModuleCategory = "own" | "vendor" | "runtime" | "native" | "unknown";

export default class ProfileUtil {
  /**
   * Short, human-readable name for a profile type. Used everywhere the
   * user sees a type (badges, dropdowns, table cells).
   */
  public static getProfileTypeDisplayName(profileType: string): string {
    const type: string = profileType.toLowerCase().trim();

    switch (type) {
      case "cpu":
      case "samples":
        return "CPU time";
      case "wall":
        return "Wall time";
      case "inuse_objects":
        return "Live memory (objects)";
      case "inuse_space":
        return "Live memory";
      case "alloc_objects":
        return "Allocations (count)";
      case "alloc_space":
        return "Allocations";
      case "heap":
        return "Heap memory";
      case "goroutine":
        return "Goroutines";
      case "contention":
      case "mutex":
        return "Lock contention";
      case "block":
        return "Blocking";
      default:
        return profileType || "Unknown";
    }
  }

  /**
   * One-sentence plain-English description of what a type measures. Shown
   * in tooltips and on the profile detail page so new engineers learn
   * what they're looking at.
   */
  public static getProfileTypeDescription(profileType: string): string {
    const category: ProfileCategory = ProfileUtil.getProfileCategory(profileType);

    switch (category) {
      case "cpu":
        return "Where CPU time is going. The profiler freezes the process every few milliseconds and records which function is running — wider = more CPU.";
      case "memory":
        return "Which functions are holding or allocating memory. Wider = more bytes or more objects.";
      case "locks":
        return "Which code is waiting on locks or mutexes. Wider = more time spent blocked.";
      case "wall":
        return "Wall-clock time including time spent waiting on I/O, not just CPU.";
      case "goroutines":
        return "Where goroutines are currently parked in your Go program.";
      default:
        return "Performance samples from your service.";
    }
  }

  /**
   * Inverse of getProfileCategory: given a single raw profileType string
   * (the value carried by the UI pill), return every raw type stored in
   * ClickHouse that should be considered part of the same category.
   *
   * Why this matters: agents store the raw type with whatever name the
   * runtime emits ("samples" for Node CPU, "cpu" for Go CPU, "inuse_space"
   * vs "heap" for memory, etc.). The pill stores a single canonical value,
   * so a literal `WHERE profileType = 'cpu'` filter would miss the user's
   * actual rows. Backend filters with `IN (...)` instead.
   *
   * Returning `undefined` means "do not filter" — caller must pass
   * undefined to the backend, not an empty array.
   */
  public static getRawProfileTypesForCategory(
    profileType: string | undefined,
  ): Array<string> | undefined {
    if (!profileType) {
      return undefined;
    }
    const category: ProfileCategory =
      ProfileUtil.getProfileCategory(profileType);
    switch (category) {
      case "cpu":
        return ["cpu", "samples"];
      case "memory":
        return [
          "inuse_space",
          "inuse_objects",
          "alloc_space",
          "alloc_objects",
          "heap",
        ];
      case "locks":
        return ["mutex", "contention", "block"];
      case "wall":
        return ["wall"];
      case "goroutines":
        return ["goroutine"];
      default:
        // Unknown / advanced specific type — pass through verbatim so the
        // backend filters on exactly the chosen value.
        return [profileType];
    }
  }

  /**
   * Bucket a raw profileType string into one of three user-facing pills.
   */
  public static getProfileCategory(profileType: string): ProfileCategory {
    const type: string = profileType.toLowerCase().trim();

    switch (type) {
      case "cpu":
      case "samples":
        return "cpu";
      case "wall":
        return "wall";
      case "inuse_objects":
      case "inuse_space":
      case "alloc_objects":
      case "alloc_space":
      case "heap":
        return "memory";
      case "contention":
      case "mutex":
      case "block":
        return "locks";
      case "goroutine":
        return "goroutines";
      default:
        return "other";
    }
  }

  /**
   * Short label for the category pill itself ("CPU", "Memory", "Locks").
   */
  public static getCategoryDisplayName(category: ProfileCategory): string {
    switch (category) {
      case "cpu":
        return "CPU";
      case "memory":
        return "Memory";
      case "locks":
        return "Locks";
      case "wall":
        return "Wall time";
      case "goroutines":
        return "Goroutines";
      default:
        return "Other";
    }
  }

  /**
   * Unit we should use when formatting raw sample values for display.
   * Samples are nanoseconds by default; memory is bytes; goroutines are
   * a count. This lets us show "23.4ms" or "1.2 MB" instead of raw
   * numbers the user can't interpret.
   */
  public static getProfileTypeUnit(profileType: string): string {
    const category: ProfileCategory = ProfileUtil.getProfileCategory(profileType);

    switch (category) {
      case "cpu":
      case "wall":
      case "locks":
        return "nanoseconds";
      case "memory": {
        const t: string = profileType.toLowerCase().trim();
        // Object-count types return a count, everything else is bytes.
        if (t === "inuse_objects" || t === "alloc_objects") {
          return "count";
        }
        return "bytes";
      }
      case "goroutines":
        return "count";
      default:
        return "count";
    }
  }

  /**
   * Tailwind badge color for a profile type. Colors align with category:
   * CPU=orange (hot), memory=blue (cool), locks=red (blocked),
   * wall=purple, goroutines=green.
   */
  public static getProfileTypeBadgeColor(profileType: string): string {
    const category: ProfileCategory = ProfileUtil.getProfileCategory(profileType);

    switch (category) {
      case "cpu":
        return "bg-orange-50 text-orange-700 ring-1 ring-orange-200";
      case "memory":
        return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
      case "locks":
        return "bg-red-50 text-red-700 ring-1 ring-red-200";
      case "wall":
        return "bg-purple-50 text-purple-700 ring-1 ring-purple-200";
      case "goroutines":
        return "bg-green-50 text-green-700 ring-1 ring-green-200";
      default:
        return "bg-gray-100 text-gray-700 ring-1 ring-gray-200";
    }
  }

  /**
   * Classify a frame's source file into a module category.
   *
   * Rules (in priority order):
   *   1. Empty / unknown file → "unknown"
   *   2. Starts with "node:" or matches Node internals → "runtime"
   *   3. Contains "node_modules" → "vendor"
   *   4. Starts with /usr/lib, /usr/src/node, [kernel], or looks like a
   *      shared library → "native" / "runtime"
   *   5. Everything else (your project paths, relative paths) → "own"
   *
   * This heuristic is intentionally generous: when in doubt we prefer to
   * classify a frame as "own" so the user sees their code highlighted.
   */
  public static getModuleCategory(fileName: string): ModuleCategory {
    const f: string = (fileName || "").toLowerCase();

    if (!f) {
      return "unknown";
    }

    // Node.js internals
    if (
      f.startsWith("node:") ||
      f.startsWith("internal/") ||
      f.startsWith("node:internal")
    ) {
      return "runtime";
    }

    // Language runtimes (Go, Python, JVM, V8)
    if (
      f.startsWith("/usr/local/go/") ||
      f.startsWith("/opt/python") ||
      f.startsWith("runtime/") ||
      f.startsWith("java/") ||
      f.startsWith("jdk.") ||
      f.startsWith("[v8") ||
      f.startsWith("v8::")
    ) {
      return "runtime";
    }

    // Kernel / native
    if (
      f.startsWith("[kernel]") ||
      f.startsWith("/lib/") ||
      f.startsWith("/usr/lib/") ||
      f.endsWith(".so") ||
      f.includes(".so.")
    ) {
      return "native";
    }

    // Third-party dependencies
    if (f.includes("node_modules") || f.includes("site-packages") || f.includes("vendor/")) {
      return "vendor";
    }

    return "own";
  }

  /**
   * Visual treatment for a frame based on its module category. Returns a
   * pair of tailwind classes for the rectangle background and text.
   *
   * Design intent:
   *   - "own"     → warm orange, full saturation. This is what the user
   *                 cares about and should see first.
   *   - "vendor"  → muted blue. Present but not drawing attention.
   *   - "runtime" → gray. Supporting cast.
   *   - "native"  → slate/purple. Distinct from runtime.
   *   - "unknown" → pale gray.
   *
   * The `intensity` parameter (0..1) lets hot frames within a category
   * read as more saturated than cool ones.
   */
  public static getModuleFrameStyle(
    category: ModuleCategory,
    intensity: number = 0.6,
  ): { bg: string; text: string; border: string } {
    // Clamp intensity to a readable range.
    const i: number = Math.max(0.25, Math.min(1, intensity));

    if (category === "own") {
      // Orange gradient: 300 (cool) → 600 (hot)
      if (i > 0.8) {
        return {
          bg: "bg-orange-600",
          text: "text-white",
          border: "border-orange-700",
        };
      }
      if (i > 0.6) {
        return {
          bg: "bg-orange-500",
          text: "text-white",
          border: "border-orange-600",
        };
      }
      if (i > 0.4) {
        return {
          bg: "bg-orange-400",
          text: "text-white",
          border: "border-orange-500",
        };
      }
      return {
        bg: "bg-orange-300",
        text: "text-orange-900",
        border: "border-orange-400",
      };
    }

    if (category === "vendor") {
      if (i > 0.7) {
        return {
          bg: "bg-sky-400",
          text: "text-white",
          border: "border-sky-500",
        };
      }
      return {
        bg: "bg-sky-300",
        text: "text-sky-900",
        border: "border-sky-400",
      };
    }

    if (category === "native") {
      return {
        bg: "bg-purple-300",
        text: "text-purple-900",
        border: "border-purple-400",
      };
    }

    if (category === "runtime") {
      return {
        bg: "bg-slate-200",
        text: "text-slate-700",
        border: "border-slate-300",
      };
    }

    return {
      bg: "bg-gray-200",
      text: "text-gray-700",
      border: "border-gray-300",
    };
  }

  /**
   * Human-friendly label for a module category. Used in the flame graph
   * legend.
   */
  public static getModuleCategoryLabel(category: ModuleCategory): string {
    switch (category) {
      case "own":
        return "Your code";
      case "vendor":
        return "Dependencies";
      case "runtime":
        return "Runtime";
      case "native":
        return "Native / kernel";
      default:
        return "Unknown";
    }
  }

  public static parseStackFrame(frame: string): ParsedStackFrame {
    // Format: "function@file:line"
    const atIndex: number = frame.indexOf("@");

    if (atIndex === -1) {
      return {
        functionName: frame,
        fileName: "",
        lineNumber: 0,
      };
    }

    const functionName: string = frame.substring(0, atIndex);
    const rest: string = frame.substring(atIndex + 1);

    const lastColonIndex: number = rest.lastIndexOf(":");

    if (lastColonIndex === -1) {
      return {
        functionName,
        fileName: rest,
        lineNumber: 0,
      };
    }

    const fileName: string = rest.substring(0, lastColonIndex);
    const lineStr: string = rest.substring(lastColonIndex + 1);
    const lineNumber: number = parseInt(lineStr, 10);

    return {
      functionName,
      fileName,
      lineNumber: isNaN(lineNumber) ? 0 : lineNumber,
    };
  }

  /**
   * Show a file path with the important bits kept. We want
   * "…Dashboard/src/Pages/Profiles/View.tsx:42" rather than a
   * left-truncated blob that starts with "…modules/". The rule:
   *   - If `node_modules` is in the path, start after the package name
   *     (so the reader sees the library, not the depth).
   *   - If the path is longer than `maxLen` chars, trim from the left
   *     keeping the tail intact.
   */
  public static formatFileName(fileName: string, maxLen: number = 48): string {
    if (!fileName) {
      return "";
    }

    let f: string = fileName;

    const nmIdx: number = f.lastIndexOf("node_modules/");
    if (nmIdx >= 0) {
      f = f.substring(nmIdx + "node_modules/".length);
    }

    if (f.length > maxLen) {
      f = "…" + f.substring(f.length - maxLen + 1);
    }

    return f;
  }

  /**
   * Format a raw sample value (e.g. 23400000 nanoseconds) as a
   * human-readable string (e.g. "23.4 ms"). Chooses units based on the
   * profile type's unit.
   */
  public static formatProfileValue(value: number, unit: string): string {
    const lowerUnit: string = unit.toLowerCase();

    if (lowerUnit === "nanoseconds" || lowerUnit === "ns") {
      if (value >= 1_000_000_000) {
        return `${(value / 1_000_000_000).toFixed(2)} s`;
      }
      if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)} ms`;
      }
      if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)} µs`;
      }
      return `${value} ns`;
    }

    if (lowerUnit === "bytes" || lowerUnit === "byte") {
      if (value >= 1_073_741_824) {
        return `${(value / 1_073_741_824).toFixed(2)} GB`;
      }
      if (value >= 1_048_576) {
        return `${(value / 1_048_576).toFixed(2)} MB`;
      }
      if (value >= 1_024) {
        return `${(value / 1_024).toFixed(1)} KB`;
      }
      return `${value} B`;
    }

    if (lowerUnit === "count" || lowerUnit === "samples") {
      if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
      }
      if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}K`;
      }
      return `${value}`;
    }

    return `${value} ${unit}`;
  }

  /**
   * Format a percentage share (0..100) using a tight, readable form
   * ("41%", "3.2%", "<0.1%").
   */
  public static formatPercent(pct: number): string {
    if (!isFinite(pct)) {
      return "—";
    }
    if (pct === 0) {
      return "0%";
    }
    if (pct < 0.1) {
      return "<0.1%";
    }
    if (pct < 10) {
      return `${pct.toFixed(1)}%`;
    }
    return `${Math.round(pct)}%`;
  }
}
