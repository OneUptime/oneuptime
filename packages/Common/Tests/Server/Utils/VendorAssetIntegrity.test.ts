import { afterAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  VendorAssetsPath,
  getMermaidDistPath,
} from "../../../Server/Utils/VendorAssets";

/*
 * The vendored files are third-party build output that a human refreshes by
 * hand (see Common/Server/Static/Vendor/README.md). Serving them with a 200 is
 * not the same as them working: a highlight.js grammar compiled against a
 * different core throws on registration, and a mermaid chunk the static mount
 * declines to serve is a diagram that never appears. Neither failure shows up
 * in a status code, and both are exactly what a careless refresh produces.
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

describe("vendored mermaid", () => {
  const mermaidDistPath: string | null = getMermaidDistPath();

  /*
   * Only .js and .mjs are served (VendorAssets.ts). mermaid's ES entrypoint is
   * 26 KB of imports pointing at everything else it can draw, so "the
   * entrypoint is served" says nothing about whether a diagram renders. If a
   * release ever code-splits across an extension the filter declines, the docs
   * page silently loses its diagrams.
   */
  const SERVABLE_EXTENSIONS: Array<string> = [".js", ".mjs"];

  /*
   * The `\(?` matters more than it looks. mermaid loads every diagram type
   * through a dynamic import() - `import("./chunks/.../flowDiagram-X.mjs")` -
   * and a pattern that only caught static `from "..."` sees 15 modules where
   * the real graph is 47. Those dynamic ones ARE the diagrams; missing them
   * would have left this test green while the docs page rendered nothing.
   */
  const IMPORT_SPECIFIER: RegExp =
    /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

  function importsOf(file: string): Array<string> {
    const specifiers: Array<string> = [];

    for (const match of fs
      .readFileSync(file, "utf8")
      .matchAll(IMPORT_SPECIFIER)) {
      if (match[1]) {
        specifiers.push(match[1]);
      }
    }

    return specifiers;
  }

  test("resolves out of node_modules", () => {
    expect(mermaidDistPath).not.toBeNull();
  });

  test("the ES entrypoint the docs import exists and has imports to check", () => {
    const entrypoint: string = path.join(
      mermaidDistPath as string,
      "mermaid.esm.min.mjs",
    );

    expect(fs.existsSync(entrypoint)).toBe(true);
    expect(importsOf(entrypoint).length).toBeGreaterThan(5);
  });

  test("every module it reaches is on disk and has a servable extension", () => {
    /*
     * Walks the graph rather than checking the entrypoint's direct imports:
     * mermaid's chunks import each other, and a blocked extension two levels
     * down fails just as completely as one at the top.
     */
    const entrypoint: string = path.join(
      mermaidDistPath as string,
      "mermaid.esm.min.mjs",
    );

    const visited: Set<string> = new Set<string>([entrypoint]);
    const queue: Array<string> = [entrypoint];
    const problems: Array<string> = [];

    while (queue.length > 0) {
      const current: string = queue.shift() as string;

      for (const specifier of importsOf(current)) {
        const resolved: string = path.resolve(path.dirname(current), specifier);

        const relative: string = path.relative(
          mermaidDistPath as string,
          resolved,
        );

        if (!SERVABLE_EXTENSIONS.includes(path.extname(resolved))) {
          problems.push(`${relative}: extension is not served`);
          continue;
        }

        if (!fs.existsSync(resolved)) {
          problems.push(`${relative}: does not exist`);
          continue;
        }

        if (relative.startsWith("..")) {
          problems.push(`${relative}: escapes the served directory`);
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
     * A floor, not a pin - mermaid's chunking changes between releases. It is
     * here so that a regex that silently stops matching cannot turn this into
     * a walk of one file that passes.
     */
    expect(visited.size).toBeGreaterThan(50);
  });

  test("the UMD bundle the blog loads is self-contained and sets a global", () => {
    /*
     * The blog appends it as a plain <script> and then calls
     * window.mermaid.run(). It used to be mermaid 10 from jsdelivr; this is
     * whatever version Common depends on, so the shape it exposes matters.
     */
    const umd: string = path.join(mermaidDistPath as string, "mermaid.min.js");

    expect(fs.existsSync(umd)).toBe(true);

    const contents: string = fs.readFileSync(umd, "utf8");

    expect(contents).toContain("mermaid");
    /* A UMD build inlines everything - no bare import of a sibling chunk. */
    expect(importsOf(umd)).toEqual([]);
  });

  test("is the version Common depends on, not a second copy", () => {
    const declared: string = (
      JSON.parse(
        fs.readFileSync(
          path.join(path.dirname(mermaidDistPath as string), "package.json"),
          "utf8",
        ),
      ) as { version: string }
    ).version;

    const commonPackage: { dependencies: Record<string, string> } = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "..", "..", "..", "package.json"),
        "utf8",
      ),
    ) as { dependencies: Record<string, string> };

    expect(commonPackage.dependencies["mermaid"]).toBeDefined();
    expect(declared.split(".")[0]).toBe(
      (commonPackage.dependencies["mermaid"] as string)
        .replace(/[^0-9]/, "")
        .split(".")[0],
    );
  });
});
