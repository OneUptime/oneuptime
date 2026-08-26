import {
  countMatches,
  countOccurrences,
  PAGE_FIXTURES,
  PageFixture,
  renderPage,
  VIEWS_ROOT,
} from "./ReferenceFixtures";
import { beforeAll, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Render the real templates.
 *
 * Unit tests over the navigation model cannot tell you that a template renders
 * at all, that its loops are wired to the right fields, or that the sidebar
 * still marks the page you are on. These do.
 */

const ALL_PAGES: Array<[string, PageFixture]> = Object.entries(PAGE_FIXTURES);

/*
 * A raw Tailwind palette class - the thing that does not change in dark mode.
 * The lookbehind keeps it from matching the tail of a token like `bg-surface`.
 */
const RAW_PALETTE_CLASS: RegExp =
  /(?<![-\w/])(?:text|bg|border|ring|divide|fill|stroke)-(?:slate|zinc|gray|indigo|emerald|amber|rose|red|sky|orange|violet|purple)-\d/;
const OPENS_A_SCRIPT: RegExp = /<script[\s>]/;
const HAS_INLINE_HANDLER: RegExp = /\son(?:click|load)=/;

describe("every page renders", () => {
  it.each(ALL_PAGES)(
    "renders %s",
    async (_name: string, fixture: PageFixture) => {
      const html: string = await renderPage(fixture);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html.trim().endsWith("</html>")).toBe(true);
      expect(html.length).toBeGreaterThan(5000);
    },
  );
});

describe("document shell", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await renderPage(PAGE_FIXTURES["introduction"]!);
  });

  it("declares the charset and the viewport exactly once each", () => {
    /*
     * The previous head declared both twice - the second charset is ignored by
     * every browser, but it is the kind of duplication that hides a real
     * conflict later.
     */
    expect(countOccurrences(html, "<meta charset=")).toBe(1);
    expect(countOccurrences(html, 'name="viewport"')).toBe(1);
  });

  it("carries the page language on the root element", () => {
    expect(html).toContain('<html lang="en"');
  });

  it("has one skip link, pointing at the content region", () => {
    expect(countOccurrences(html, 'href="#reference-content"')).toBe(1);
    expect(html).toContain('id="reference-content"');
    expect(html).toContain("Skip to content");
  });

  it("no longer restyles itself after first paint", () => {
    /*
     * The old head added its typography classes from a body onload handler,
     * which is why the page used to reflow a beat after it appeared.
     */
    expect(html).not.toContain("applyStyles");
    expect(html).not.toMatch(/<body[^>]*onload=/);
  });
});

describe("theme", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await renderPage(PAGE_FIXTURES["introduction"]!);
  });

  it("resolves the theme before any styling is applied", () => {
    const bootstrapAt: number = html.indexOf("oneuptime-reference-theme");
    const tokensAt: number = html.indexOf("--ou-canvas");

    expect(bootstrapAt).toBeGreaterThan(-1);
    expect(tokensAt).toBeGreaterThan(bootstrapAt);
  });

  it("switches on a class, not on the media query alone", () => {
    expect(html).toContain("darkMode: 'class'");
    expect(html).toContain("classList.toggle('dark'");
  });

  it("defines the full palette twice - once light, once dark", () => {
    const lightTokens: number = countOccurrences(html, "--ou-ink-muted:");
    expect(lightTokens).toBe(2);
    expect(html).toContain(".dark {");
  });

  it("still honours the key the previous version wrote", () => {
    expect(html).toContain("isDarkMode");
  });

  it("offers a control to change it", () => {
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain("Light theme");
    expect(html).toContain("Dark theme");
    expect(html).toContain("System theme");
  });
});

describe("assets", () => {
  it("loads every library from this install", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);

    expect(html).toContain("/oneuptime-assets/tailwind/tailwind-3.4.5.js");
    expect(html).toContain("/oneuptime-assets/highlight/highlight.min.js");
    expect(html).toContain(
      "/oneuptime-assets/highlight/styles/github-dark.min.css",
    );
    expect(html).toContain("/reference/fonts/InterVariable.woff2");
  });

  it("reaches no third-party host", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);

    for (const host of [
      "cdn.tailwindcss.com",
      "cdnjs.cloudflare.com",
      "cdn.jsdelivr.net",
      "unpkg.com",
      "fonts.googleapis.com",
      "fonts.gstatic.com",
    ]) {
      expect(html).not.toContain(host);
    }
  });

  it("keeps analytics behind its flag", async () => {
    const off: string = await renderPage(PAGE_FIXTURES["introduction"]!, {
      enableGoogleTagManager: false,
    });
    const on: string = await renderPage(PAGE_FIXTURES["introduction"]!, {
      enableGoogleTagManager: true,
    });

    expect(off).not.toContain("googletagmanager.com");
    expect(on).toContain("googletagmanager.com");
  });
});

describe("sidebar", () => {
  it("marks the current page in both the rail and the drawer", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);

    /* Two navs render the same tree, so the current page is marked twice. */
    expect(
      countMatches(html, /data-nav-slug="monitor"\s+aria-current="page"/g),
    ).toBe(2);
    expect(
      countMatches(html, /data-nav-slug="[^"]+"\s+aria-current="page"/g),
    ).toBe(2);
  });

  it("marks nothing when the page is outside the navigation", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["notFound"]!);

    expect(
      countMatches(html, /data-nav-slug="[^"]+"\s+aria-current="page"/g),
    ).toBe(0);
  });

  it("links every entry under the current language", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["introduction"]!, {
      lang: "de",
    });

    expect(html).toContain('href="/reference/de/monitor"');
    expect(html).not.toContain('href="/reference/en/monitor"');
  });

  it("hides the master admin guide on the billing-enabled build", async () => {
    const selfHosted: string = await renderPage(
      PAGE_FIXTURES["introduction"]!,
      {
        showMasterAdminApis: true,
      },
    );
    const hosted: string = await renderPage(PAGE_FIXTURES["introduction"]!, {
      showMasterAdminApis: false,
    });

    expect(selfHosted).toContain("/reference/en/master-admin-apis");
    expect(hosted).not.toContain("/reference/en/master-admin-apis");
  });

  it("renders the wordmark once per nav rather than three inline copies", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["introduction"]!);

    /* Top bar, desktop rail, drawer - and every one of them tinted by CSS. */
    expect(
      countMatches(
        html,
        /<svg role="img" aria-hidden="true" focusable="false"/g,
      ),
    ).toBe(3);
    expect(html).not.toContain('fill="#121212"');
    /*
     * Three copies of one SVG on a page means any id inside it is a duplicate
     * id, so the mark is drawn rather than clipped.
     */
    expect(html).not.toContain("clipPath");
  });
});

describe("breadcrumb and pager", () => {
  it("says where a resource page sits", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);

    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain("Resources");
  });

  it("offers the neighbouring pages", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["pagination"]!);

    expect(html).toContain('aria-label="Previous and next page"');
    expect(html).toContain("/reference/en/authentication");
    expect(html).toContain("/reference/en/permissions");
  });

  it("renders neither on a page that is not in the navigation", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["notFound"]!);

    expect(html).not.toContain('aria-label="Breadcrumb"');
    expect(html).not.toContain('aria-label="Previous and next page"');
  });
});

describe("on this page", () => {
  it("ships an empty rail for the script to fill from the real headings", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);

    expect(html).toContain('id="reference-toc"');
    expect(html).toContain('id="reference-toc-list"');
    /* Starts hidden; the script reveals it only when there is more than one heading. */
    expect(html).toMatch(/id="reference-toc"[^>]*hidden/);
    expect(html).toContain('id="back-to-top"');
  });
});

describe("command palette", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await renderPage(PAGE_FIXTURES["introduction"]!);
  });

  it("has an opener in the top bar and one for narrow screens", () => {
    expect(countMatches(html, /<button[^>]*data-search-open/g)).toBe(2);
  });

  it("serialises the whole navigation as its index", () => {
    const match: RegExpMatchArray | null = html.match(
      /<script id="reference-search-index" type="application\/json">([\s\S]*?)<\/script>/,
    );

    expect(match).not.toBeNull();

    const index: Array<{ slug: string; section: string }> = JSON.parse(
      match![1]!,
    );

    expect(
      index.map((entry: { slug: string }) => {
        return entry.slug;
      }),
    ).toContain("on-call-duty-policy");
    expect(
      index.find((entry: { slug: string }) => {
        return entry.slug === "monitor-step";
      })?.section,
    ).toBe("Data Types · Monitor");
  });

  it("escapes anything that could close the script element early", () => {
    const match: RegExpMatchArray | null = html.match(
      /<script id="reference-search-index" type="application\/json">([\s\S]*?)<\/script>/,
    );

    expect(match![1]).not.toContain("<");
  });

  it("is a combobox, so a screen reader announces the result list", () => {
    expect(html).toContain('role="combobox"');
    expect(html).toContain('id="reference-search-results"');
    expect(html).toContain('role="listbox"');
  });
});

describe("code blocks", () => {
  let modelHtml: string = "";

  beforeAll(async () => {
    modelHtml = await renderPage(PAGE_FIXTURES["model"]!);
  });

  it("renders one tab group per documented operation", () => {
    /* list, get item, count, create, update, delete. */
    expect(countMatches(modelHtml, /class="code-tabs-container/g)).toBe(6);
  });

  it("offers the request preview plus every client language", () => {
    expect(countOccurrences(modelHtml, 'role="tab"')).toBe(6 * 12);
    expect(countOccurrences(modelHtml, 'role="tabpanel"')).toBe(6 * 12);
  });

  it("gives each strip a single tab stop, so Tab does not walk twelve buttons", () => {
    expect(countMatches(modelHtml, /role="tab"[^>]*tabindex="0"/g)).toBe(6);
    expect(countMatches(modelHtml, /role="tab"[^>]*tabindex="-1"/g)).toBe(
      6 * 11,
    );
  });

  it("points every tab at a panel that exists", () => {
    const controls: Array<string> = Array.from(
      modelHtml.matchAll(/role="tab"[^>]*aria-controls="([^"]+)"/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(controls.length).toBe(6 * 12);

    for (const id of controls) {
      expect(modelHtml).toContain(`id="${id}"`);
    }
  });

  it("shows exactly one panel per group before the script runs", () => {
    expect(countOccurrences(modelHtml, 'class="code-panel relative "')).toBe(6);
  });

  it("no longer ships one copy of the same script per block", async () => {
    /*
     * Each code partial used to carry its own <script>. A model page includes
     * six tab groups and eight response blocks, so it shipped fourteen copies of
     * three functions and bound the same listeners fourteen times.
     */
    const authenticationHtml: string = await renderPage(
      PAGE_FIXTURES["authentication"]!,
    );

    expect(countOccurrences(modelHtml, "<script")).toBe(
      countOccurrences(authenticationHtml, "<script"),
    );
    expect(modelHtml).not.toContain("function copyCodeBlock");
    expect(countOccurrences(modelHtml, "function selectCodeTab")).toBe(1);
  });

  it("renders the same markup every time, so nothing depends on a random id", async () => {
    const again: string = await renderPage(PAGE_FIXTURES["model"]!);

    expect(again).toBe(modelHtml);
  });

  it("labels each copy button and marks what it copies", () => {
    const copyButtons: number = countOccurrences(modelHtml, "data-copy-button");
    const copyScopes: number = countOccurrences(modelHtml, "data-copy-scope");

    expect(copyButtons).toBeGreaterThan(0);
    expect(copyScopes).toBe(copyButtons);
    expect(modelHtml).toContain("data-copy-headers");
    expect(modelHtml).toContain("data-copy-body");
  });

  it("tags each language block for the highlighter", () => {
    for (const language of [
      "language-bash",
      "language-javascript",
      "language-typescript",
      "language-python",
      "language-go",
      "language-java",
      "language-csharp",
      "language-php",
      "language-ruby",
      "language-rust",
      "language-powershell",
      "language-json",
    ]) {
      expect(modelHtml).toContain(language);
    }
  });
});

describe("endpoints", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await renderPage(PAGE_FIXTURES["model"]!);
  });

  it("shows every operation the model exposes", () => {
    for (const endpoint of [
      "/api/monitor/get-list",
      "/api/monitor/:id/get-item",
      "/api/monitor/count",
      "/api/monitor/:id",
    ]) {
      expect(html).toContain(endpoint);
    }
  });

  it("colours each method through the shared badge", () => {
    expect(html).toContain("bg-success-soft text-success");
    expect(html).toContain("bg-info-soft text-info");
    expect(html).toContain("bg-warn-soft text-warn");
    expect(html).toContain("bg-danger-soft text-danger");
  });

  it("drops the create and delete sections when permissions do not allow them", async () => {
    const readOnly: string = await renderPage({
      ...PAGE_FIXTURES["model"]!,
      pageData: {
        ...PAGE_FIXTURES["model"]!.pageData,
        tablePermissions: {
          ...(PAGE_FIXTURES["model"]!.pageData["tablePermissions"] as Record<
            string,
            unknown
          >),
          create: [],
          update: [],
          delete: [],
        },
      },
    });

    expect(readOnly).not.toContain('id="create"');
    expect(readOnly).not.toContain('id="update"');
    expect(readOnly).not.toContain('id="delete"');
    expect(readOnly).toContain('id="count"');
  });
});

describe("column permissions", () => {
  it("is a disclosure a screen reader can operate", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);
    const columnCount: number = Object.keys(
      PAGE_FIXTURES["model"]!.pageData["columns"] as Record<string, unknown>,
    ).length;

    expect(countMatches(html, /<button[^>]*data-permissions-toggle/g)).toBe(
      columnCount,
    );
    expect(
      countOccurrences(html, 'aria-expanded="false"'),
    ).toBeGreaterThanOrEqual(columnCount);
    expect(html).toContain('aria-controls="name-permissions"');
    expect(html).toMatch(/id="name-permissions"/);
    /* The panel is closed with the attribute, not with an inline style. */
    expect(html).not.toContain('style="display: none;"');
    expect(html).not.toContain("onclick=");
  });
});

describe("translation", () => {
  it("renders a non-English page in that language", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["introduction"]!, {
      lang: "de",
    });

    expect(html).toContain('<html lang="de"');
    expect(html).toContain("Zum Inhalt springen");
    expect(html).toContain("Auf dieser Seite");
  });

  it("keeps the language switcher pointed at the page you are on", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!, {
      lang: "de",
    });

    expect(
      countOccurrences(html, 'data-current-path="/reference/de/monitor"'),
    ).toBe(2);
  });
});

describe("template sources", () => {
  function readTemplates(directory: string): Array<[string, string]> {
    const root: string = path.join(VIEWS_ROOT, directory);

    return fs.readdirSync(root).map((name: string) => {
      return [name, fs.readFileSync(path.join(root, name), "utf8")];
    });
  }

  it("uses the theme-aware palette everywhere, not raw Tailwind colours", () => {
    /*
     * A raw `text-slate-900` does not change in dark mode. Every colour in
     * these templates has to come from a token so one variable flip on <html>
     * repaints the whole page.
     */
    const offenders: Array<string> = readTemplates("main")
      .filter(([, contents]: [string, string]) => {
        return RAW_PALETTE_CLASS.test(contents);
      })
      .map(([name]: [string, string]) => {
        return name;
      });

    expect(offenders).toEqual([]);
  });

  it("keeps the code partials free of script tags", () => {
    /*
     * Every code block on a page used to bring its own copy of the same three
     * functions along with it.
     */
    for (const name of ["code.ejs", "code-tabs.ejs", "endpoint.ejs"]) {
      const contents: string = fs.readFileSync(
        path.join(VIEWS_ROOT, "partials", name),
        "utf8",
      );

      expect([name, OPENS_A_SCRIPT.test(contents)]).toEqual([name, false]);
    }
  });

  it("keeps every page template free of inline handlers and inline scripts", () => {
    const offenders: Array<string> = readTemplates("main")
      .filter(([, contents]: [string, string]) => {
        return (
          contents.includes("<script") || HAS_INLINE_HANDLER.test(contents)
        );
      })
      .map(([name]: [string, string]) => {
        return name;
      });

    expect(offenders).toEqual([]);
  });

  it("derives element ids deterministically", () => {
    const contents: string = fs.readFileSync(
      path.join(VIEWS_ROOT, "partials", "code-tabs.ejs"),
      "utf8",
    );

    expect(contents).not.toContain("Math.random(");
  });
});
