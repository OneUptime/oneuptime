import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { VendorAssetsPath } from "../../../Server/Utils/VendorAssets";
import {
  MermaidBrowserBuild,
  MermaidBrowserEntry,
  runMermaidBrowserBuild,
} from "../../../Server/Utils/MermaidBrowserBuild";

/*
 * The vendored files are third-party build output that a human refreshes by
 * hand (see Common/Server/Static/Vendor/README.md). Serving them with a 200 is
 * not the same as them working: a highlight.js grammar compiled against a
 * different core throws on registration, and a mermaid chunk the build did not
 * produce is a diagram that never appears. Neither failure shows up in a
 * status code, and both are exactly what a careless refresh or upgrade
 * produces.
 *
 * So these tests execute the code and walk the module graph rather than
 * stat-ing files.
 */

const HIGHLIGHT_PATH: string = path.join(VendorAssetsPath, "highlight");
const LANGUAGES_PATH: string = path.join(HIGHLIGHT_PATH, "languages");

/* /*! Highlight.js v11.11.1 (git: ...) */
const CORE_VERSION_PATTERN: RegExp = /Highlight\.js v([0-9]+\.[0-9]+\.[0-9]+)/;

/* /*! `python` grammar compiled for Highlight.js 11.11.1 */
const GRAMMAR_HEADER_PATTERN: RegExp =
  /`([a-z0-9-]+)` grammar compiled for Highlight\.js ([0-9]+\.[0-9]+\.[0-9]+)/;

function grammarFiles(): Array<string> {
  return fs.readdirSync(LANGUAGES_PATH).sort();
}

function readGrammar(file: string): string {
  return fs.readFileSync(path.join(LANGUAGES_PATH, file), "utf8");
}

describe("vendored highlight.js", () => {
  const core: string = fs.readFileSync(
    path.join(HIGHLIGHT_PATH, "highlight.min.js"),
    "utf8",
  );

  const coreVersion: string = (core.match(CORE_VERSION_PATTERN) || [])[1] || "";

  test("the core bundle declares a version", () => {
    expect(coreVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("every grammar was compiled against that exact core", () => {
    /*
     * highlight.js grammars are compiled against a specific core API. Mixing
     * versions throws at registerLanguage, which takes out highlighting for the
     * whole page - not just the one language. Refreshing the core without
     * refreshing the grammars beside it is the obvious way to get there, and
     * the version is right there in each file's banner.
     */
    const mismatched: Array<string> = [];

    for (const file of grammarFiles()) {
      const header: RegExpMatchArray | null = readGrammar(file).match(
        GRAMMAR_HEADER_PATTERN,
      );

      if (!header) {
        mismatched.push(`${file}: no version banner`);
        continue;
      }

      if (header[2] !== coreVersion) {
        mismatched.push(`${file}: ${header[2]} != core ${coreVersion}`);
      }
    }

    expect(mismatched).toEqual([]);
  });

  test("every grammar file is named after the language it registers", () => {
    /*
     * The views build the URL from the langMap value - `.../languages/` + lang
     * + `.min.js` - so a file whose name and grammar disagree is a request that
     * 404s for one language while a different one sits there unreachable.
     */
    const misnamed: Array<string> = [];

    for (const file of grammarFiles()) {
      const contents: string = readGrammar(file);
      const header: RegExpMatchArray | null = contents.match(
        GRAMMAR_HEADER_PATTERN,
      );
      const registered: RegExpMatchArray | null = contents.match(
        /registerLanguage\("([a-z0-9-]+)"/,
      );

      const expectedName: string = file.replace(/\.min\.js$/, "");

      if (header && header[1] !== expectedName) {
        misnamed.push(`${file}: banner says ${header[1]}`);
      }

      if (registered && registered[1] !== expectedName) {
        misnamed.push(`${file}: registers ${registered[1]}`);
      }
    }

    expect(misnamed).toEqual([]);
  });

  describe("actually running it", () => {
    /*
     * Common's Jest environment is jsdom, so the browser bundle can be
     * evaluated as-is. Indirect eval puts `var hljs` on the global the way a
     * <script> tag would; a direct eval would scope it to this function and the
     * grammar files, which reach for the global, would throw.
     */
    const indirectEval: (source: string) => unknown = eval;

    interface HighlightResult {
      value: string;
    }

    interface HighlightJs {
      highlight: (
        code: string,
        options: { language: string },
      ) => HighlightResult;
      listLanguages: () => Array<string>;
      versionString: string;
    }

    indirectEval(core);

    const hljs: HighlightJs = (globalThis as unknown as { hljs: HighlightJs })
      .hljs;

    afterAll(() => {
      delete (globalThis as unknown as { hljs?: HighlightJs }).hljs;
    });

    test("the bundle evaluates and exposes the global the views call", () => {
      expect(typeof hljs).toBe("object");
      expect(typeof hljs.highlight).toBe("function");
      expect(hljs.versionString).toBe(coreVersion);
    });

    test("every grammar registers without throwing, and highlights", () => {
      /*
       * A truncated or half-downloaded grammar - the realistic outcome of a
       * refresh script that lost its network partway - parses as JavaScript
       * often enough to pass a byte-count check and still fail here.
       */
      const broken: Array<string> = [];

      for (const file of grammarFiles()) {
        const language: string = file.replace(/\.min\.js$/, "");

        try {
          indirectEval(readGrammar(file));
        } catch (error) {
          broken.push(`${language}: registration threw - ${String(error)}`);
          continue;
        }

        if (!hljs.listLanguages().includes(language)) {
          broken.push(`${language}: did not appear in listLanguages()`);
        }
      }

      expect(broken).toEqual([]);
    });

    test("highlights the languages the API reference loads eagerly", () => {
      const samples: Array<[string, string]> = [
        ["python", "def hello(name):\n    return f'hi {name}'"],
        ["json", '{"id": 1, "name": "oneuptime"}'],
        ["bash", 'if [ -f oneuptime.env ]; then echo "found"; fi'],
        ["typescript", "const a: number = 1;"],
        ["go", 'package main\nfunc main() { println("hi") }'],
      ];

      for (const [language, code] of samples) {
        const highlighted: string = hljs.highlight(code, { language }).value;

        expect([language, highlighted.includes("<span class=")]).toEqual([
          language,
          true,
        ]);
      }
    });
  });
});

describe("the mermaid build the docs and the blog import", () => {
  /*
   * The same build VendorAssets serves (MermaidBrowserBuild.ts runs
   * Common/UI/esbuild-mermaid.js in a child process), read straight from its
   * output rather than over HTTP: VendorAssets.test.ts covers the mount.
   */
  let build: MermaidBrowserBuild;

  beforeAll(async () => {
    build = await runMermaidBrowserBuild();
  });

  /*
   * The `\(?` matters more than it looks. mermaid loads every diagram type
   * through a dynamic import() - `import("./chunks/flowDiagram-X.mjs")` - and
   * a pattern that only caught static `from "..."` would see a fraction of
   * the graph. Those dynamic ones ARE the diagrams.
   */
  const IMPORT_SPECIFIER: RegExp =
    /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

  function importsOf(file: string): Array<string> {
    const contents: Buffer | undefined = build.files.get(file);

    if (!contents) {
      return [];
    }

    const specifiers: Array<string> = [];

    for (const match of contents.toString("utf8").matchAll(IMPORT_SPECIFIER)) {
      if (match[1]) {
        specifiers.push(match[1]);
      }
    }

    return specifiers;
  }

  function textOf(file: string): string {
    return (build.files.get(file) as Buffer).toString("utf8");
  }

  // "0.18.10" against a range's floor such as "^0.18.2".
  function isAtLeast(version: string, range: string): boolean {
    const actual: Array<number> = version.split(".").map(Number);
    const minimum: Array<number> = range
      .replace(/^[^0-9]*/, "")
      .split(".")
      .map(Number);

    for (let index: number = 0; index < 3; index++) {
      const have: number = actual[index] || 0;
      const need: number = minimum[index] || 0;

      if (have !== need) {
        return have > need;
      }
    }

    return true;
  }

  test("compares versions the way the katex check needs", () => {
    expect(isAtLeast("0.18.10", "^0.18.2")).toBe(true);
    expect(isAtLeast("0.18.2", "^0.18.2")).toBe(true);
    expect(isAtLeast("0.19.0", "^0.18.2")).toBe(true);
    expect(isAtLeast("0.16.47", "^0.18.2")).toBe(false);
    expect(isAtLeast("0.18.1", "^0.18.2")).toBe(false);
  });

  test("has the entry the views import, with imports to check", () => {
    expect(build.entry).toBe(MermaidBrowserEntry);
    expect(build.files.has(MermaidBrowserEntry)).toBe(true);
    expect(importsOf(MermaidBrowserEntry).length).toBeGreaterThan(5);
  });

  test("every module the entry reaches is in the build", () => {
    /*
     * Walks the graph rather than checking the entry's direct imports: the
     * chunks import each other, and a missing file two levels down fails just
     * as completely as one at the top.
     */
    const visited: Set<string> = new Set<string>([MermaidBrowserEntry]);
    const queue: Array<string> = [MermaidBrowserEntry];
    const problems: Array<string> = [];

    while (queue.length > 0) {
      const current: string = queue.shift() as string;

      for (const specifier of importsOf(current)) {
        const resolved: string = path.posix.normalize(
          path.posix.join(path.posix.dirname(current), specifier),
        );

        if (resolved.startsWith("..")) {
          problems.push(`${resolved}: escapes the served directory`);
          continue;
        }

        if (!build.files.has(resolved)) {
          problems.push(`${resolved}: not in the build`);
          continue;
        }

        if (!visited.has(resolved)) {
          visited.add(resolved);
          queue.push(resolved);
        }
      }
    }

    expect(problems).toEqual([]);

    /*
     * A floor, not a pin - the chunking changes between releases. It is here
     * so that a regex that silently stops matching cannot turn this into a
     * walk of one file that passes.
     */
    expect(visited.size).toBeGreaterThan(50);
  });

  test("names every chunk by its content, under chunks/", () => {
    for (const file of build.files.keys()) {
      if (file === MermaidBrowserEntry) {
        continue;
      }

      expect([file, /^chunks\/[A-Za-z0-9._-]+-[A-Z0-9]{8,}\.mjs$/.test(file)])
        .toEqual([file, true]);
    }
  });

  test("carries exactly one katex: the one npm installed, no older than Common's override", () => {
    const katexFiles: Array<string> = [...build.files.keys()].filter(
      (file: string): boolean => {
        return textOf(file).includes("KaTeX parse error");
      },
    );

    expect(katexFiles).toHaveLength(1);

    const installed: string = (
      JSON.parse(
        fs.readFileSync(require.resolve("katex/package.json"), "utf8"),
      ) as { version: string }
    ).version;

    expect(textOf(katexFiles[0] as string)).toContain(`"${installed}"`);

    /*
     * Common's package.json holds katex for mermaid at a floor ("^0.18.2").
     * The installed copy must be at least that, or the override was lost.
     */
    const commonPackage: {
      overrides: { mermaid: { katex: string } };
    } = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "..", "..", "..", "package.json"),
        "utf8",
      ),
    ) as { overrides: { mermaid: { katex: string } } };

    const floor: string = commonPackage.overrides.mermaid.katex;

    expect([installed, floor, isAtLeast(installed, floor)]).toEqual([
      installed,
      floor,
      true,
    ]);
  });

  test("is built from the mermaid Common depends on", () => {
    const installed: string = (
      JSON.parse(
        fs.readFileSync(require.resolve("mermaid/package.json"), "utf8"),
      ) as { version: string }
    ).version;

    const commonPackage: { dependencies: Record<string, string> } = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "..", "..", "..", "package.json"),
        "utf8",
      ),
    ) as { dependencies: Record<string, string> };

    expect(commonPackage.dependencies["mermaid"]).toBeDefined();
    expect(installed.split(".")[0]).toBe(
      (commonPackage.dependencies["mermaid"] as string)
        .replace(/[^0-9]/, "")
        .split(".")[0],
    );
  });

  test("is not committed under Static/Vendor", () => {
    expect(fs.existsSync(path.join(VendorAssetsPath, "mermaid"))).toBe(false);
  });
});
