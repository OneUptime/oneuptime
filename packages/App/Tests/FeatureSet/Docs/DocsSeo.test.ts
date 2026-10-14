import {
  DocsPageSeo,
  X_DEFAULT_HREFLANG,
  getDocsPageSeo,
  getDocsPageUrl,
} from "../../../FeatureSet/Docs/Utils/Seo";
import {
  NOT_PAGE_CATEGORIES,
  getLegacyDocsPageTarget,
  withQueryOf,
} from "../../../FeatureSet/Docs/Utils/Redirects";
import { getDocsPagePaths } from "../../../FeatureSet/Docs/Utils/Sitemap";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
import { NAV_PAGES } from "./DocsContentSupport";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { describe, expect, it } from "@jest/globals";

/*
 * The pieces behind what the docs tell search engines, one by one: a page's
 * canonical address and alternates (Utils/Seo.ts), where an old address
 * without a language goes (Utils/Redirects.ts) and which pages the sitemap
 * reads (Utils/Sitemap.ts). DocsCanonicalPages and DocsSearchEngineRoutes run
 * them through the docs' routes.
 */

const ORIGIN: string = "https://oneuptime.com";

describe("getDocsPageSeo", () => {
  const seoOf: (
    lang: string,
    translatedLanguages: Array<string>,
  ) => DocsPageSeo = (
    lang: string,
    translatedLanguages: Array<string>,
  ): DocsPageSeo => {
    return getDocsPageSeo({
      origin: ORIGIN,
      pagePath: "monitor/website-monitor",
      lang: lang,
      translatedLanguages: translatedLanguages,
    });
  };

  it("makes a translated page its own canonical page, in every language it is written in", () => {
    for (const lang of ["en", "de", "fa"]) {
      expect(seoOf(lang, ["en", "de", "fa"]).canonicalUrl).toBe(
        `${ORIGIN}/docs/${lang}/monitor/website-monitor`,
      );
    }
  });

  it("lists the languages a page is written in as alternates, and English as the default", () => {
    expect(seoOf("de", ["en", "de", "fa"]).alternateLinks).toEqual([
      { hreflang: "en", href: `${ORIGIN}/docs/en/monitor/website-monitor` },
      { hreflang: "de", href: `${ORIGIN}/docs/de/monitor/website-monitor` },
      { hreflang: "fa", href: `${ORIGIN}/docs/fa/monitor/website-monitor` },
      {
        hreflang: X_DEFAULT_HREFLANG,
        href: `${ORIGIN}/docs/en/monitor/website-monitor`,
      },
    ]);
    expect(X_DEFAULT_HREFLANG).toBe("x-default");
  });

  it("lists the alternates in the docs' order, whatever order it is given", () => {
    const shuffledOrder: Array<string> = ["fa", "zh-TW", "en", "de", "no"];

    expect(
      seoOf("en", shuffledOrder).alternateLinks.map(
        (alternate: { hreflang: string }): string => {
          return alternate.hreflang;
        },
      ),
    ).toEqual(["en", "de", "no", "zh-TW", "fa", X_DEFAULT_HREFLANG]);
  });

  it("lists every language when a page is written in every one", () => {
    const seo: DocsPageSeo = seoOf("ja", SUPPORTED_DOCS_LANGUAGE_CODES);

    expect(seo.canonicalUrl).toBe(`${ORIGIN}/docs/ja/monitor/website-monitor`);
    expect(seo.alternateLinks).toHaveLength(
      SUPPORTED_DOCS_LANGUAGE_CODES.length + 1,
    );
  });

  it("names the English page as canonical for a page served in English under another prefix, with no alternates", () => {
    for (const lang of ["de", "ja", "fa"]) {
      expect(seoOf(lang, ["en"])).toEqual({
        canonicalUrl: `${ORIGIN}/docs/en/monitor/website-monitor`,
        alternateLinks: [],
      });
    }

    // Translated into some languages, but not this one.
    expect(seoOf("fr", ["en", "de", "fa"])).toEqual({
      canonicalUrl: `${ORIGIN}/docs/en/monitor/website-monitor`,
      alternateLinks: [],
    });
  });

  it("lists no alternates for a page written in English alone", () => {
    expect(seoOf("en", ["en"])).toEqual({
      canonicalUrl: `${ORIGIN}/docs/en/monitor/website-monitor`,
      alternateLinks: [],
    });
  });

  it("points at English when it is told of no language at all", () => {
    expect(seoOf("de", [])).toEqual({
      canonicalUrl: `${ORIGIN}/docs/en/monitor/website-monitor`,
      alternateLinks: [],
    });
  });

  it("writes every address in full, on the origin it is given", () => {
    expect(getDocsPageUrl("http://localhost:3000", "zh-CN", "a/b")).toBe(
      "http://localhost:3000/docs/zh-CN/a/b",
    );
  });
});

describe("getLegacyDocsPageTarget", () => {
  it("sends an old page address to the English page", () => {
    expect(getLegacyDocsPageTarget("terraform", "self-hosted")).toBe(
      "/docs/en/terraform/self-hosted",
    );
    expect(getLegacyDocsPageTarget("installation", "docker-compose")).toBe(
      "/docs/en/installation/docker-compose",
    );
  });

  it("lands in lower case, as the docs serve every page", () => {
    expect(getLegacyDocsPageTarget("Installation", "Docker-Compose")).toBe(
      "/docs/en/installation/docker-compose",
    );
  });

  it("keeps the address on this site, whatever it is given", () => {
    for (const [category, page] of [
      ["//evil.example.com", "x"],
      ["a", "b?c=d#e"],
      ["a b", "c\r\nLocation: https://evil.example.com"],
    ] as Array<[string, string]>) {
      const target: string = getLegacyDocsPageTarget(category, page) || "";

      expect(target.startsWith("/docs/en/")).toBe(true);
      expect(target.split("/")).toHaveLength(5);
      expect(target).not.toMatch(/[?#\s]/);
    }
  });

  it("does not take a step up a path for a page", () => {
    for (const [category, page] of [
      ["..", ".."],
      ["a", ".."],
      [".", "b"],
    ] as Array<[string, string]>) {
      expect(getLegacyDocsPageTarget(category, page)).toBeNull();
    }
  });

  it("leaves files and endpoints alone: they were never pages", () => {
    for (const category of NOT_PAGE_CATEGORIES) {
      expect(getLegacyDocsPageTarget(category, "x")).toBeNull();
      expect(getLegacyDocsPageTarget(category.toUpperCase(), "x")).toBeNull();
    }
    expect(NOT_PAGE_CATEGORIES).toEqual(
      expect.arrayContaining(["static", "as-markdown", "search-index"]),
    );
  });

  it("is a page address for every page in the nav, which no file or endpoint shadows", () => {
    for (const page of NAV_PAGES) {
      const [category, name] = page.split("/") as [string, string];

      expect(getLegacyDocsPageTarget(category, name)).toBe(`/docs/en/${page}`);
    }
  });
});

describe("withQueryOf", () => {
  const requestFor: (originalUrl: string) => ExpressRequest = (
    originalUrl: string,
  ): ExpressRequest => {
    return { originalUrl: originalUrl } as ExpressRequest;
  };

  it("keeps the query a request came with, as it was sent", () => {
    expect(
      withQueryOf(
        requestFor("/docs/a/b?utm_source=x&gclid=AbC%2Fd&utm_source=y"),
        "/docs/en/a/b",
      ),
    ).toBe("/docs/en/a/b?utm_source=x&gclid=AbC%2Fd&utm_source=y");
  });

  it("adds nothing when there is no query, or an empty one", () => {
    expect(withQueryOf(requestFor("/docs/a/b"), "/docs/en/a/b")).toBe(
      "/docs/en/a/b",
    );
    expect(withQueryOf(requestFor("/docs/a/b?"), "/docs/en/a/b")).toBe(
      "/docs/en/a/b",
    );
    expect(withQueryOf({} as ExpressRequest, "/docs/en/a/b")).toBe(
      "/docs/en/a/b",
    );
  });

  it("joins a target that has a query of its own with an ampersand", () => {
    expect(withQueryOf(requestFor("/old?b=2"), "/new?a=1")).toBe(
      "/new?a=1&b=2",
    );
  });
});

describe("getDocsPagePaths", () => {
  it("is every docs page in the nav, in the nav's order, once", () => {
    expect(getDocsPagePaths()).toEqual(NAV_PAGES);
    expect(new Set(getDocsPagePaths()).size).toBe(NAV_PAGES.length);
  });

  it("leaves out the nav's links to other sites", () => {
    const external: number = DocsNav.flatMap((group: NavGroup) => {
      return group.links;
    }).filter((link: { url: string }): boolean => {
      return !link.url.startsWith("/docs/");
    }).length;

    expect(external).toBeGreaterThan(0);
    for (const page of getDocsPagePaths()) {
      expect(page).not.toMatch(/^https?:/);
    }
  });

  it("reads a nav it is given, lower-cased and once each", () => {
    expect(
      getDocsPagePaths([
        {
          title: "A",
          section: "Get Started",
          links: [
            { title: "One", url: "/docs/a/One" },
            { title: "Out", url: "https://example.com/docs/x" },
          ],
        },
        {
          title: "B",
          section: "Get Started",
          links: [
            { title: "One again", url: "/docs/a/one" },
            { title: "Two", url: "/docs/b/two" },
          ],
        },
      ]),
    ).toEqual(["a/one", "b/two"]);
  });
});
