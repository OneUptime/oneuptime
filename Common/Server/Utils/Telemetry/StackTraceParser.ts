/**
 * Stack trace parser that transforms raw stack trace strings into structured frames.
 * Supports JavaScript/Node.js, Python, Java, Go, Ruby, C#/.NET, and PHP stack traces.
 */

export interface StackFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
  inApp: boolean; // true if user code, false if library/framework code
}

export interface ParsedStackTrace {
  frames: StackFrame[];
  raw: string; // original raw stack trace string
}

// Known library/framework path patterns that indicate non-app code
const LIBRARY_PATTERNS: Array<RegExp> = [
  // Node.js internals
  /^node:/,
  /^internal\//,
  /node_modules\//,
  /^events\.js$/,
  /^timers\.js$/,
  /^util\.js$/,
  /^net\.js$/,
  /^stream\.js$/,
  /^buffer\.js$/,
  // Python
  /\/site-packages\//,
  /\/dist-packages\//,
  /\/lib\/python\d+\.\d+\//,
  /\/usr\/lib\//,
  /\/usr\/local\/lib\//,
  /\/venv\//,
  /\/\.venv\//,
  /\/virtualenv\//,
  // Java
  /^java\./,
  /^javax\./,
  /^sun\./,
  /^com\.sun\./,
  /^org\.springframework\./,
  /^org\.apache\./,
  /^org\.hibernate\./,
  /^org\.eclipse\./,
  /^io\.netty\./,
  /^com\.google\./,
  /^org\.junit\./,
  // Go
  /^runtime\//,
  /^net\/http\//,
  /^testing\//,
  /\/vendor\//,
  /\/pkg\/mod\//,
  // Ruby
  /\/gems\//,
  /\/rubygems\//,
  /\/ruby\/\d+\.\d+\.\d+\//,
  // C#/.NET
  /^System\./,
  /^Microsoft\./,
  /^Newtonsoft\./,
  // PHP
  /\/vendor\//,
  /^phar:\/\//,
];

export default class StackTraceParser {
  /**
   * Parse a raw stack trace string into structured frames.
   * Auto-detects the language and applies the appropriate parser.
   */
  public static parse(rawStackTrace: string): ParsedStackTrace {
    if (!rawStackTrace || rawStackTrace.trim().length === 0) {
      return { frames: [], raw: rawStackTrace || "" };
    }

    const lines: string[] = rawStackTrace.split("\n").map((l: string) => {
      return l.trim();
    });

    // Try each parser and use the one that produces the most frames
    const parsers: Array<(lines: string[]) => StackFrame[]> = [
      StackTraceParser.parseJavaScript,
      StackTraceParser.parsePython,
      StackTraceParser.parseJava,
      StackTraceParser.parseGo,
      StackTraceParser.parseRuby,
      StackTraceParser.parseCSharp,
      StackTraceParser.parsePHP,
    ];

    let bestFrames: StackFrame[] = [];

    for (const parser of parsers) {
      try {
        const frames: StackFrame[] = parser(lines);
        if (frames.length > bestFrames.length) {
          bestFrames = frames;
        }
      } catch {
        // Skip failing parsers
      }
    }

    return {
      frames: bestFrames,
      raw: rawStackTrace,
    };
  }

  /**
   * Determine if a file path is application code (not library/framework).
   */
  private static isAppCode(filePath: string): boolean {
    if (!filePath) {
      return true;
    }

    for (const pattern of LIBRARY_PATTERNS) {
      if (pattern.test(filePath)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse JavaScript/Node.js stack traces.
   * Format: `at functionName (filePath:line:col)` or `at filePath:line:col`
   */
  private static parseJavaScript(lines: string[]): StackFrame[] {
    const frames: StackFrame[] = [];

    // Pattern 1: at functionName (filePath:line:col)
    const patternWithParens: RegExp = /^at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/;
    // Pattern 2: at filePath:line:col
    const patternWithoutParens: RegExp = /^at\s+(.+?):(\d+):(\d+)$/;
    // Pattern 3: at functionName (filePath:line)
    const patternWithParensNoCol: RegExp = /^at\s+(.+?)\s+\((.+?):(\d+)\)$/;
    // Pattern 4: at eval (eval at functionName (filePath:line:col))
    const patternEval: RegExp =
      /^at\s+eval\s+\(eval\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/;

    for (const line of lines) {
      let match: RegExpMatchArray | null = null;

      match = line.match(patternEval);
      if (match) {
        frames.push({
          functionName: `eval at ${match[1]!}`,
          fileName: match[2]!,
          lineNumber: parseInt(match[3]!, 10),
          columnNumber: parseInt(match[4]!, 10),
          inApp: StackTraceParser.isAppCode(match[2]!),
        });
        continue;
      }

      match = line.match(patternWithParens);
      if (match) {
        frames.push({
          functionName: match[1]!,
          fileName: match[2]!,
          lineNumber: parseInt(match[3]!, 10),
          columnNumber: parseInt(match[4]!, 10),
          inApp: StackTraceParser.isAppCode(match[2]!),
        });
        continue;
      }

      match = line.match(patternWithParensNoCol);
      if (match) {
        frames.push({
          functionName: match[1]!,
          fileName: match[2]!,
          lineNumber: parseInt(match[3]!, 10),
          inApp: StackTraceParser.isAppCode(match[2]!),
        });
        continue;
      }

      match = line.match(patternWithoutParens);
      if (match) {
        frames.push({
          functionName: "<anonymous>",
          fileName: match[1]!,
          lineNumber: parseInt(match[2]!, 10),
          columnNumber: parseInt(match[3]!, 10),
          inApp: StackTraceParser.isAppCode(match[1]!),
        });
        continue;
      }
    }

    return frames;
  }

  /**
   * Parse Python stack traces.
   * Format: `File "path", line N, in function`
   */
  private static parsePython(lines: string[]): StackFrame[] {
    const frames: StackFrame[] = [];
    const pattern: RegExp =
      /^File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/;

    for (const line of lines) {
      const match: RegExpMatchArray | null = line.match(pattern);
      if (match) {
        frames.push({
          functionName: match[3] || "<module>",
          fileName: match[1]!,
          lineNumber: parseInt(match[2]!, 10),
          inApp: StackTraceParser.isAppCode(match[1]!),
        });
      }
    }

    return frames;
  }

  /**
   * Parse Java stack traces.
   * Format: `at package.Class.method(File.java:line)`
   */
  private static parseJava(lines: string[]): StackFrame[] {
    const frames: StackFrame[] = [];
    // Pattern: at com.package.Class.method(File.java:123)
    const pattern: RegExp = /^at\s+([\w.$]+)\(([\w.]+):(\d+)\)$/;
    // Pattern for native methods: at com.package.Class.method(Native Method)
    const patternNative: RegExp = /^at\s+([\w.$]+)\(Native Method\)$/;
    // Pattern for unknown source: at com.package.Class.method(Unknown Source)
    const patternUnknown: RegExp = /^at\s+([\w.$]+)\(Unknown Source\)$/;

    for (const line of lines) {
      let match: RegExpMatchArray | null = null;

      match = line.match(pattern);
      if (match) {
        const fullMethod: string = match[1]!;
        frames.push({
          functionName: fullMethod,
          fileName: match[2]!,
          lineNumber: parseInt(match[3]!, 10),
          inApp: StackTraceParser.isAppCode(fullMethod),
        });
        continue;
      }

      match = line.match(patternNative);
      if (match) {
        frames.push({
          functionName: match[1]!,
          fileName: "Native Method",
          lineNumber: 0,
          inApp: false,
        });
        continue;
      }

      match = line.match(patternUnknown);
      if (match) {
        frames.push({
          functionName: match[1]!,
          fileName: "Unknown Source",
          lineNumber: 0,
          inApp: StackTraceParser.isAppCode(match[1]!),
        });
        continue;
      }
    }

    return frames;
  }

  /**
   * Parse Go stack traces.
   * Format: `package/file.go:line +0xNN` or `goroutine N [reason]:`
   * Go stack traces have pairs of lines:
   *   functionName(args)
   *   /path/to/file.go:line +0xNN
   */
  private static parseGo(lines: string[]): StackFrame[] {
    const frames: StackFrame[] = [];
    const filePattern: RegExp = /^(.+\.go):(\d+)\s*(?:\+0x[0-9a-f]+)?$/;

    for (let i: number = 0; i < lines.length; i++) {
      const line: string = lines[i]!;

      // Skip goroutine headers
      if (line.startsWith("goroutine ")) {
        continue;
      }

      // Look for file:line pattern
      const match: RegExpMatchArray | null = line.match(filePattern);
      if (match) {
        // The previous line should be the function name
        let functionName: string = "<unknown>";
        if (i > 0 && lines[i - 1]) {
          // Remove arguments from function name
          const funcLine: string = lines[i - 1]!;
          const parenIndex: number = funcLine.indexOf("(");
          functionName =
            parenIndex > 0 ? funcLine.substring(0, parenIndex) : funcLine;
        }

        frames.push({
          functionName: functionName,
          fileName: match[1]!,
          lineNumber: parseInt(match[2]!, 10),
          inApp: StackTraceParser.isAppCode(match[1]!),
        });
      }
    }

    return frames;
  }

  /**
   * Parse Ruby stack traces.
   * Format: `file:line:in 'method'` or `file:line:in \`method'`
   */
  private static parseRuby(lines: string[]): StackFrame[] {
    const frames: StackFrame[] = [];
    const pattern: RegExp = /^(.+?):(\d+):in\s+[`'](.+?)'$/;

    for (const line of lines) {
      const match: RegExpMatchArray | null = line.match(pattern);
      if (match) {
        frames.push({
          functionName: match[3]!,
          fileName: match[1]!,
          lineNumber: parseInt(match[2]!, 10),
          inApp: StackTraceParser.isAppCode(match[1]!),
        });
      }
    }

    return frames;
  }

  /**
   * Parse C#/.NET stack traces.
   * Format: `at Namespace.Class.Method(params) in file:line N`
   */
  private static parseCSharp(lines: string[]): StackFrame[] {
    const frames: StackFrame[] = [];
    // Pattern: at Namespace.Class.Method(params) in /path/to/file.cs:line 42
    const patternWithFile: RegExp = /^at\s+(.+?)\s+in\s+(.+?):line\s+(\d+)$/;
    // Pattern: at Namespace.Class.Method(params)
    const patternWithoutFile: RegExp = /^at\s+([\w.<>+]+\(.*?\))$/;

    for (const line of lines) {
      let match: RegExpMatchArray | null = null;

      match = line.match(patternWithFile);
      if (match) {
        frames.push({
          functionName: match[1]!,
          fileName: match[2]!,
          lineNumber: parseInt(match[3]!, 10),
          inApp: StackTraceParser.isAppCode(match[1]!),
        });
        continue;
      }

      match = line.match(patternWithoutFile);
      if (match) {
        frames.push({
          functionName: match[1]!,
          fileName: "",
          lineNumber: 0,
          inApp: StackTraceParser.isAppCode(match[1]!),
        });
        continue;
      }
    }

    return frames;
  }

  /**
   * Parse PHP stack traces.
   * Format: `#N /path/to/file.php(line): Class->method()`
   */
  private static parsePHP(lines: string[]): StackFrame[] {
    const frames: StackFrame[] = [];
    // Pattern: #0 /path/to/file.php(42): ClassName->method()
    const pattern: RegExp = /^#\d+\s+(.+?)\((\d+)\):\s+(.+)$/;
    // Pattern: #0 {main}
    const patternMain: RegExp = /^#\d+\s+\{main\}$/;

    for (const line of lines) {
      if (patternMain.test(line)) {
        frames.push({
          functionName: "{main}",
          fileName: "",
          lineNumber: 0,
          inApp: true,
        });
        continue;
      }

      const match: RegExpMatchArray | null = line.match(pattern);
      if (match) {
        frames.push({
          functionName: match[3]!.replace(/\(\)$/, ""),
          fileName: match[1]!,
          lineNumber: parseInt(match[2]!, 10),
          inApp: StackTraceParser.isAppCode(match[1]!),
        });
      }
    }

    return frames;
  }
}
