/**
 * Stack trace parser that transforms raw stack trace strings into structured frames.
 * Supports JavaScript/Node.js, Python, Java, Go, Ruby, C#/.NET, and PHP stack traces.
 *
 * JavaScript is covered twice, because the engines do not agree on a format:
 * V8 (Chrome, Edge, Node) writes `at fn (file:line:col)`, while SpiderMonkey
 * (Firefox) and JavaScriptCore (Safari) write `fn@source:line:col`. See
 * parseJavaScript and parseJavaScriptBrowser respectively.
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
  /*
   * Browser engines and extensions. Frames sourced from an extension, from a
   * `resource:`/`chrome:` internal, from a WebAssembly module or from one of
   * SpiderMonkey's / JavaScriptCore's pseudo-sources are never the page's own
   * code, so they must not be highlighted as in-app.
   */
  /^moz-extension:/,
  /^chrome-extension:/,
  /^safari-web-extension:/,
  /^safari-extension:/,
  /^ms-browser-extension:/,
  /^resource:/,
  /^chrome:/,
  /^about:/,
  /^jar:/,
  /^wasm:/,
  /^self-hosted$/,
  /^\[native code\]$/,
  /^\[wasm code\]$/,
];

/*
 * ---------------------------------------------------------------------------
 * Firefox (SpiderMonkey) / Safari (JavaScriptCore) frame grammar.
 *
 * Neither engine writes V8's `at fn (file:line:col)`. Both write
 *
 *     [asyncCause*]functionName@source:line[:column]
 *
 * with the function name optional (`@https://…` is every Firefox top-level
 * frame) and the location sometimes absent entirely (`map@[native code]` in
 * Safari). Because the source is a URL it carries colons of its own — the
 * `https:`, a `:port`, a nested `blob:https:` — so the line and column are
 * peeled off the RIGHT, never by splitting on the first colon.
 *
 * These constants are the grammar; parseBrowserFrame() composes them.
 * ---------------------------------------------------------------------------
 */

/*
 * The longest source a browser reports is a data: URL. Longer lines are
 * skipped rather than handed to the regex engine — exception.stacktrace is
 * attacker-influenceable and reaches this parser on the ingest hot path.
 */
const BROWSER_MAX_FRAME_LINE_LENGTH: number = 4096;
const BROWSER_MAX_FUNCTION_NAME_LENGTH: number = 256;

/*
 * A real frame has one `@`, but a URL may carry userinfo (`https://u:p@cdn/…`)
 * and a name may be a quoted property key (`obj["a@b"]`), so the split point is
 * found by trying each `@` left to right until one yields a valid source. The
 * bound keeps a line of nothing but `@` off the retry loop.
 */
const BROWSER_MAX_AT_SPLITS: number = 8;

// V8 frames belong to parseJavaScript. Never double-claim one.
const V8_FRAME_PREFIX: RegExp = /^at\s/;

/*
 * Schemes a browser can legitimately name as a frame source. An allowlist on
 * purpose: together with BROWSER_FUNCTION_NAME it is the clause that stops
 * ordinary log prose from reading as a stack frame — `git@github.com:22:1`,
 * `deploy@prod:8080:1` and `/app/node_modules/@scope/pkg/index.js:10:5` all
 * fail here because what follows the `@` names no scheme. Extend it when a new
 * engine or embedder scheme shows up in the wild.
 */
const BROWSER_SOURCE_SCHEME: RegExp =
  /^(?:https?|file|blob|data|webpack(?:-internal)?|moz-extension|chrome-extension|safari-web-extension|safari-extension|ms-browser-extension|resource|chrome|about|jar|view-source|capacitor|ionic|wasm):/i;

/*
 * `scheme://authority` with no path left — what remains when a URL's `:port`
 * is peeled as if it were a line number (`@http://127.0.0.1:8080`). A real
 * frame always has a path after the host, so this shape is always a mis-peel.
 */
const BROWSER_BARE_AUTHORITY: RegExp =
  /^[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^/]*$/;

/*
 * JavaScriptCore's native pseudo-source. A real frame, but it has no location
 * and can never be matched to a bundle.
 */
const BROWSER_NATIVE_SOURCE: RegExp = /^\[(?:native|wasm) code\]$/;

// SpiderMonkey's source for a self-hosted builtin: `next@self-hosted:1154:9`.
const BROWSER_SELF_HOSTED_SOURCE: string = "self-hosted";

/*
 * Peel `:line:column` — or just `:line` — off the RIGHT of the source. `(.*)`
 * is greedy, so it keeps every earlier colon (the `https:`, the `:port`, the
 * colons inside a data: URL) and only the trailing numeric groups are taken.
 * Both groups are digit-bounded, so neither can backtrack across the line.
 */
const BROWSER_LOCATION_WITH_COLUMN: RegExp = /^(.*):(\d{1,9}):(\d{1,9})$/;
const BROWSER_LOCATION_LINE_ONLY: RegExp = /^(.*):(\d{1,9})$/;

/*
 * Firefox <= 29 and Safari <= 6 emitted `fn@url:line` with no column — which
 * is also the shape of a logged URL that merely ends in a number
 * (`notify@https://hooks.slack.com/services/T000:200`). Requiring the source
 * to name a script is what tells the two apart.
 */
const BROWSER_SCRIPT_EXTENSION: RegExp =
  /\.(?:m?js|cjs|jsx|m?ts|tsx|html?|vue|svelte|astro)(?:[?#]|$)/i;

/*
 * Firefox decorates the source of code introduced by another script:
 * `<introducer> line <N> > <kind>`, nested for nested evals, e.g.
 * `https://x/app.js line 12 > eval line 1 > eval`. The FIRST occurrence is the
 * boundary: everything before it is the real file and its N is the line in
 * that file, which is the only position a source map can resolve. A URL cannot
 * contain a literal space, so this can never fire on an ordinary source.
 */
const BROWSER_EVAL_INTRODUCER: RegExp = / line (\d{1,9}) > /;

/*
 * The function-name field — everything before the `@`.
 *
 * Firefox prefixes an async frame with `<cause>*`, where the cause may contain
 * spaces (`promise callback*fetchAll`, `setTimeout handler*poll`), and that
 * prefix composes with any name — including an accessor, which is why the
 * prefix is a separate optional group rather than its own alternative. A
 * getter that registers a promise callback really does arrive as
 * `promise callback*get profile@…`.
 *
 * The name itself is JavaScriptCore's `global code` family, an ES2015 accessor
 * or bound name (`get fullName`, `bound save`), or any single whitespace-free
 * token — which is what carries Firefox's composed display names
 * (`Foo.prototype.render`, `initGrid/</<`, `[16]</Grid.prototype.draw/<`). It
 * is optional so that an anonymous async frame (`async*@url:1:1`) still parses.
 *
 * No alternative admits a colon, and only the accessor, `… code` and async
 * forms admit a space. Those two exclusions are load-bearing — they are what
 * reject `notified on-call engineer jane@https://status.example.com/app.js:1:2`
 * (spaces) and `Connection string: svc@https://db.example.com/app.js:1:1`
 * (colon), both of which name a perfectly valid source.
 */
const BROWSER_FUNCTION_NAME: RegExp =
  /^(?:[A-Za-z][A-Za-z0-9 ]{0,31}\*)?(?:(?:global|module|eval|function) code|(?:get|set|bound) [^\s:]{1,200}|[^\s:]{1,256})?$/;

/**
 * A parsed Firefox/Safari frame plus the evidence parseJavaScriptBrowser needs
 * to decide whether the stack as a whole really is a browser stack.
 */
interface BrowserFrameCandidate {
  frame: StackFrame;
  /*
   * True only for a frame that could not plausibly be anything else: an
   * explicit `@`, a source with a real URL scheme, and a line number. A
   * pseudo-source frame (`map@[native code]`) is not an anchor — it carries no
   * URL and no digits, so on its own it is far too easy to forge.
   */
  isAnchor: boolean;
}

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
      /*
       * Firefox/Safari must stay LAST. The election below keeps the first
       * parser to reach a given frame count, so a parser at the end can only
       * win by producing strictly more frames than every language before it —
       * it can never take a tie away from the incumbent.
       */
      StackTraceParser.parseJavaScriptBrowser,
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
  /**
   * Parse Firefox (SpiderMonkey) / Safari (JavaScriptCore) stack traces.
   * Format: `functionName@source:line:col`, `@source:line:col` (anonymous),
   * `fn@[native code]` (Safari), `async*fn@source:line:col` (Firefox async).
   *
   * Registered LAST in parse()'s parsers array on purpose. That election keeps
   * the first parser to reach a frame count, so a parser appended at the end
   * can only win by producing strictly more frames than every language before
   * it — it can never take a tie away from the incumbent. A Ruby stack with a
   * couple of browser-shaped lines in it therefore stays Ruby.
   *
   * Deliberately NOT accepted, because each one is indistinguishable from
   * ordinary log text and this parser is fed arbitrary ERROR log bodies:
   *   - a bare `url:line:col` with no `@` (Safari <= 9 top-level frames), and
   *     bare `[native code]` / `global code` lines carrying no `@` at all;
   *   - a source naming no scheme, which is the shape of React Native's
   *     JavaScriptCore bundles and of `//# sourceURL=` pragma names;
   *   - a scheme outside BROWSER_SOURCE_SCHEME, such as Angular JIT's `ng:///`.
   */
  private static parseJavaScriptBrowser(lines: string[]): StackFrame[] {
    const frames: StackFrame[] = [];
    let anchorCount: number = 0;

    for (const line of lines) {
      if (line.length === 0 || line.length > BROWSER_MAX_FRAME_LINE_LENGTH) {
        continue;
      }

      if (V8_FRAME_PREFIX.test(line)) {
        continue;
      }

      const candidate: BrowserFrameCandidate | null =
        StackTraceParser.parseBrowserFrame(line);

      if (!candidate) {
        continue;
      }

      if (candidate.isAnchor) {
        anchorCount++;
      }

      frames.push(candidate.frame);
    }

    /*
     * A pseudo-source frame carries no URL and no digits, so two forged
     * `x@[native code]` lines must not be able to out-count and evict a real
     * Ruby or Python stack in parse()'s election. Nothing is trusted until the
     * stack has produced at least one unambiguous `name@<url>:line` frame.
     */
    if (anchorCount === 0) {
      return [];
    }

    return frames;
  }

  /**
   * Split one Firefox/Safari frame line at its `@` and parse the source.
   *
   * The split point is searched left to right rather than taken at the first
   * or last `@`, because both sides may legitimately contain one: a URL may
   * carry userinfo (`send@https://user:pw@cdn.example.com/sdk.js:1:9033`) and
   * a name may be a quoted property key (`obj["a@b"]@https://x/app.js:3:11`).
   * The first split whose right-hand side parses as a source wins.
   */
  private static parseBrowserFrame(line: string): BrowserFrameCandidate | null {
    let searchFrom: number = 0;

    for (let attempt: number = 0; attempt < BROWSER_MAX_AT_SPLITS; attempt++) {
      const atIndex: number = line.indexOf("@", searchFrom);

      if (atIndex < 0) {
        return null;
      }

      searchFrom = atIndex + 1;

      const functionName: string = line.substring(0, atIndex);
      const source: string = line.substring(atIndex + 1);

      if (functionName.length > BROWSER_MAX_FUNCTION_NAME_LENGTH) {
        continue;
      }

      // An empty name is the anonymous/top-level frame Firefox emits as `@url`.
      if (
        functionName.length > 0 &&
        !BROWSER_FUNCTION_NAME.test(functionName)
      ) {
        continue;
      }

      const candidate: BrowserFrameCandidate | null =
        StackTraceParser.parseBrowserSource(functionName, source);

      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Turn the right-hand side of a browser frame into a StackFrame, or return
   * null when it does not name a location a browser could have reported.
   */
  private static parseBrowserSource(
    functionName: string,
    source: string,
  ): BrowserFrameCandidate | null {
    /*
     * The async cause and the closure suffixes are kept verbatim
     * (`async*loadUser`, `initGrid/<`): they are what distinguishes two
     * otherwise identical rows in the frame viewer, they match the raw stack
     * rendered beside it, and StackFrame has no field to move them to.
     */
    const displayName: string =
      functionName.length > 0 ? functionName : "<anonymous>";

    // Safari: `map@[native code]` — a real frame with no location at all.
    if (BROWSER_NATIVE_SOURCE.test(source)) {
      return {
        frame: {
          functionName: displayName,
          fileName: source,
          /*
           * StackFrame.lineNumber is not optional, and 0 is already the
           * file-less sentinel parseJava uses for `(Native Method)`.
           * SourceMapResolver skips any frame with lineNumber < 1, so this
           * frame renders but is never probed against a source map.
           */
          lineNumber: 0,
          inApp: false,
        },
        isAnchor: false,
      };
    }

    let fileName: string = "";
    let lineNumber: number = 0;
    let columnNumber: number | undefined = undefined;

    const withColumn: RegExpMatchArray | null = source.match(
      BROWSER_LOCATION_WITH_COLUMN,
    );

    if (withColumn) {
      fileName = withColumn[1]!;
      lineNumber = parseInt(withColumn[2]!, 10);
      columnNumber = parseInt(withColumn[3]!, 10);
    } else {
      const lineOnly: RegExpMatchArray | null = source.match(
        BROWSER_LOCATION_LINE_ONLY,
      );

      if (!lineOnly) {
        return null;
      }

      fileName = lineOnly[1]!;
      lineNumber = parseInt(lineOnly[2]!, 10);
    }

    /*
     * Firefox: `https://x/app.js line 12 > eval:1:5`. The eval'd text has no
     * URL and no source map of its own; the only resolvable position is the
     * introducer's — app.js line 12. The inner column belongs to the eval'd
     * text, so it is dropped rather than reported against the wrong file.
     */
    const introducer: RegExpMatchArray | null = fileName.match(
      BROWSER_EVAL_INTRODUCER,
    );
    let fromEvalIntroducer: boolean = false;

    if (introducer && introducer.index !== undefined) {
      lineNumber = parseInt(introducer[1]!, 10);
      columnNumber = undefined;
      fileName = fileName.substring(0, introducer.index);
      fromEvalIntroducer = true;
    }

    if (lineNumber < 1) {
      return null;
    }

    // Firefox self-hosted builtins: `next@self-hosted:1154:9`.
    if (fileName === BROWSER_SELF_HOSTED_SOURCE) {
      return {
        frame: {
          functionName: displayName,
          fileName: fileName,
          lineNumber: lineNumber,
          ...(columnNumber === undefined ? {} : { columnNumber: columnNumber }),
          inApp: false,
        },
        isAnchor: false,
      };
    }

    if (
      !BROWSER_SOURCE_SCHEME.test(fileName) ||
      BROWSER_BARE_AUTHORITY.test(fileName)
    ) {
      return null;
    }

    /*
     * A column-less frame is either a Firefox <= 29 / Safari <= 6 frame or a
     * URL that happens to end in a number, and only the source can tell them
     * apart. The `line N >` decoration is already unmistakable, so a frame that
     * lost its column to an eval introducer is exempt.
     */
    if (
      columnNumber === undefined &&
      !fromEvalIntroducer &&
      !BROWSER_SCRIPT_EXTENSION.test(fileName)
    ) {
      return null;
    }

    return {
      frame: {
        functionName: displayName,
        fileName: fileName,
        lineNumber: lineNumber,
        ...(columnNumber === undefined ? {} : { columnNumber: columnNumber }),
        inApp: StackTraceParser.isAppCode(fileName),
      },
      isAnchor: true,
    };
  }
}
