import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Perf contract (linear-polish): the Dashboard's eager first-load graph must
 * never reach MarkdownViewer or mermaid. mermaid's pre-bundled build is
 * ~4.5MB, and one static import chain used to pull it into the entry bundle:
 *
 *   App.tsx (eager) -> AIChatPanel -> ChatMessageList -> SafeChatMarkdown
 *     -> Common/UI/Components/Markdown.tsx/MarkdownViewer -> mermaid
 *
 * The fix has two independent halves, and each is pinned here because
 * neither is expressible as a type and the App suite runs in a plain Node
 * environment (no renderer, no bundler):
 *
 *  1. Every call site imports the Suspense wrapper LazyMarkdownViewer, so
 *     the viewer's whole module (react-markdown, syntax highlighter,
 *     mermaid loader) lives in a lazy chunk.
 *  2. MarkdownViewer itself only ever loads mermaid through a dynamic
 *     import() on first diagram render — never statically, never at module
 *     scope — so even the lazy markdown chunk stays mermaid-free until a
 *     mermaid fence actually renders. (The behavioral half of this contract
 *     is exercised by Common/Tests/UI/Components/MarkdownLazy.test.tsx.)
 *
 * Patterns are tolerant (they match intent: import paths and import kinds),
 * never exact byte strings — see commits 4f28593d36/5d33ea0703 for why.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

const ADMIN_DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const MARKDOWN_DIR: string = path.join(
  COMMON_ROOT,
  "UI",
  "Components",
  // The directory really is named "Markdown.tsx".
  "Markdown.tsx",
);

/*
 * Comments are stripped before matching: several call sites (and this repo's
 * own docs) mention "MarkdownViewer" in prose, and an assertion about the
 * import graph has to read imports, not commentary.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCode(filePath: string): string {
  return stripComments(fs.readFileSync(filePath, "utf8"));
}

/*
 * A static ESM import (of any shape — default, named, namespace, bare) whose
 * specifier resolves to the eager MarkdownViewer module. `import type` is
 * excluded: it is erased at compile time and creates no bundle edge.
 */
const STATIC_MARKDOWN_VIEWER_IMPORT: RegExp =
  /import\s+(?!type\b)[^;]*?from\s*["'][^"']*Markdown\.tsx\/MarkdownViewer["']/;

// Same shape, for a static import of the mermaid package itself.
const STATIC_MERMAID_IMPORT: RegExp =
  /import\s+(?!type\b)[^;]*?from\s*["']mermaid["']/;

const SOURCE_FILE_EXTENSION: RegExp = /\.(ts|tsx)$/;

function collectSourceFiles(dir: string): Array<string> {
  const collected: Array<string> = [];
  const entries: Array<fs.Dirent> = fs.readdirSync(dir, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const fullPath: string = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectSourceFiles(fullPath));
    } else if (SOURCE_FILE_EXTENSION.test(entry.name)) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function filesWithEagerViewerImport(root: string): Array<string> {
  return collectSourceFiles(root)
    .filter((filePath: string) => {
      return STATIC_MARKDOWN_VIEWER_IMPORT.test(readCode(filePath));
    })
    .map((filePath: string) => {
      return path.relative(root, filePath);
    });
}

describe("Markdown eager-graph contract", () => {
  test("SafeChatMarkdown (the eager AIChat chain) imports LazyMarkdownViewer, not MarkdownViewer", () => {
    const source: string = readCode(
      path.join(DASHBOARD_SRC, "Components", "AIChat", "SafeChatMarkdown.tsx"),
    );

    expect(source).toMatch(
      /from\s*["']Common\/UI\/Components\/Markdown\.tsx\/LazyMarkdownViewer["']/,
    );
    expect(source).not.toMatch(STATIC_MARKDOWN_VIEWER_IMPORT);
  });

  test("eager-graph Common components (BaseModelTable, FeedItem) import LazyMarkdownViewer, not MarkdownViewer", () => {
    /*
     * Statically-imported Dashboard pages (Home, ActiveIncidents, ...) reach
     * BaseModelTable through ModelTable, and feeds reach FeedItem — so these
     * two Common files are part of the eager graph as much as SafeChatMarkdown.
     */
    const files: Array<string> = [
      path.join(
        COMMON_ROOT,
        "UI",
        "Components",
        "ModelTable",
        "BaseModelTable.tsx",
      ),
      path.join(COMMON_ROOT, "UI", "Components", "Feed", "FeedItem.tsx"),
    ];

    for (const filePath of files) {
      const source: string = readCode(filePath);
      expect(source).toMatch(
        /from\s*["'][^"']*Markdown\.tsx\/LazyMarkdownViewer["']/,
      );
      expect(source).not.toMatch(STATIC_MARKDOWN_VIEWER_IMPORT);
    }
  });

  test("no file under Dashboard or AdminDashboard src statically imports MarkdownViewer", () => {
    /*
     * The sweep-level invariant: LazyMarkdownViewer is the only sanctioned
     * import. A single static import anywhere re-creates a path for the
     * whole markdown/mermaid stack to leak into an eager or shared chunk.
     * If this fails, switch the listed files to
     * Common/UI/Components/Markdown.tsx/LazyMarkdownViewer.
     */
    expect(filesWithEagerViewerImport(DASHBOARD_SRC)).toEqual([]);
    expect(filesWithEagerViewerImport(ADMIN_DASHBOARD_SRC)).toEqual([]);
  });

  test("MarkdownViewer loads mermaid only through a dynamic import()", () => {
    const source: string = readCode(
      path.join(MARKDOWN_DIR, "MarkdownViewer.tsx"),
    );

    expect(source).not.toMatch(STATIC_MERMAID_IMPORT);
    expect(source).toMatch(/import\(\s*["']mermaid["']\s*\)/);
  });

  test("LazyMarkdownViewer's only static edge to MarkdownViewer is type-only", () => {
    const source: string = readCode(
      path.join(MARKDOWN_DIR, "LazyMarkdownViewer.tsx"),
    );

    expect(source).toMatch(
      /import\s+type\s+[^;]*?from\s*["']\.\/MarkdownViewer["']/,
    );
    expect(source).toMatch(/import\(\s*["']\.\/MarkdownViewer["']\s*\)/);
    // A value import here would drag the viewer back into every consumer.
    expect(source).not.toMatch(
      /import\s+(?!type\b)[^;]*?from\s*["']\.\/MarkdownViewer["']/,
    );
  });
});
