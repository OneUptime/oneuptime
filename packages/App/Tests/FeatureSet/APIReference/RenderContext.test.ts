import {
  flattenNavigation,
  ReferenceNavItem,
  ReferenceNavSection,
} from "../../../FeatureSet/APIReference/Utils/Navigation";
import {
  buildRenderContext,
  clearNavigationCaches,
  getNavigationForLanguage,
  ReferenceRenderContext,
} from "../../../FeatureSet/APIReference/Utils/RenderContext";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The context is what every service hands the templates. These tests use the
 * live model and data type registries, so they also stand as the check that the
 * real navigation is not empty, out of order, or missing the guides.
 */

function requestFor(lang: string, page?: string): ExpressRequest {
  return {
    params: page === undefined ? { lang: lang } : { lang: lang, page: page },
    originalUrl: page ? `/reference/${lang}/${page}` : `/reference/${lang}`,
    headers: {},
  } as unknown as ExpressRequest;
}

describe("buildRenderContext", () => {
  beforeEach(() => {
    clearNavigationCaches();
  });

  it("takes the language from the URL", () => {
    const context: ReferenceRenderContext = buildRenderContext(
      requestFor("de", "introduction"),
    );

    expect(context.lang).toBe("de");
    expect(context.t("ui.guides")).not.toBe("Guides");
  });

  it("falls back to English for a language the reference is not offered in", () => {
    expect(buildRenderContext(requestFor("kl", "introduction")).lang).toBe(
      "en",
    );
    expect(buildRenderContext(requestFor("", "introduction")).lang).toBe("en");
  });

  it("carries the page slug, which is what the sidebar highlights", () => {
    expect(buildRenderContext(requestFor("en", "monitor")).currentPage).toBe(
      "monitor",
    );
    expect(buildRenderContext(requestFor("en")).currentPage).toBe("");
  });

  it("keeps the canonical path, so the language switcher can rewrite it", () => {
    expect(buildRenderContext(requestFor("en", "monitor")).currentPath).toBe(
      "/reference/en/monitor",
    );
  });

  it("builds a navigation with all three sections from the live registries", () => {
    const context: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "introduction"),
    );

    expect(
      context.navSections.map((section: ReferenceNavSection) => {
        return section.id;
      }),
    ).toEqual(["guides", "resources", "data-types"]);

    /* The product documents well over a hundred resources. */
    expect(context.navSections[1]!.groups[0]!.items.length).toBeGreaterThan(50);
  });

  it("documents the guides every install has", () => {
    const context: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "introduction"),
    );
    const slugs: Array<string> = flattenNavigation(context.navSections).map(
      (item: ReferenceNavItem) => {
        return item.slug;
      },
    );

    for (const slug of [
      "introduction",
      "authentication",
      "pagination",
      "permissions",
      "data-types",
      "errors",
      "openapi",
      "monitor",
    ]) {
      expect([slug, slugs.includes(slug)]).toEqual([slug, true]);
    }
  });

  it("gives every page in the navigation a unique slug", () => {
    /*
     * Two pages with one slug means one of them is unreachable, and the pager
     * would step over it.
     */
    const slugs: Array<string> = flattenNavigation(
      getNavigationForLanguage("en"),
    ).map((item: ReferenceNavItem) => {
      return item.slug;
    });

    const duplicates: Array<string> = slugs.filter(
      (slug: string, index: number) => {
        return slugs.indexOf(slug) !== index;
      },
    );

    expect(duplicates).toEqual([]);
  });

  it("locates a real resource page and pages either side of it", () => {
    const context: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "monitor"),
    );

    expect(context.currentLocation?.item.slug).toBe("monitor");
    expect(context.currentLocation?.section.id).toBe("resources");
    expect(context.pager.previous).not.toBeNull();
    expect(context.pager.next).not.toBeNull();
  });

  it("gives a page outside the navigation no pager and no breadcrumb", () => {
    const context: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "page-not-found"),
    );

    expect(context.currentLocation).toBeNull();
    expect(context.pager).toEqual({ previous: null, next: null });
  });

  it("starts the reader at the introduction, with nothing before it", () => {
    const context: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "introduction"),
    );

    expect(context.pager.previous).toBeNull();
    expect(context.pager.next?.slug).toBe("authentication");
  });

  it("indexes every navigable page for the palette", () => {
    const context: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "introduction"),
    );

    expect(context.searchIndex.length).toBe(
      flattenNavigation(context.navSections).length,
    );
  });

  it("builds the navigation once per language, not once per request", () => {
    /*
     * Building it instantiates every documented model. Doing that on every
     * request would put that cost in front of every page load.
     */
    const first: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "introduction"),
    );
    const second: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "monitor"),
    );

    expect(second.navSections).toBe(first.navSections);
    expect(second.searchIndex).toBe(first.searchIndex);
  });

  it("holds a separate navigation per language", () => {
    const english: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "introduction"),
    );
    const japanese: ReferenceRenderContext = buildRenderContext(
      requestFor("ja", "introduction"),
    );

    expect(japanese.navSections).not.toBe(english.navSections);
    expect(japanese.navSections[0]!.title).not.toBe(
      english.navSections[0]!.title,
    );
    /* Same pages, different labels. */
    expect(flattenNavigation(japanese.navSections).length).toBe(
      flattenNavigation(english.navSections).length,
    );
  });

  it("offers every language the reference is translated into", () => {
    const context: ReferenceRenderContext = buildRenderContext(
      requestFor("en", "introduction"),
    );

    expect(context.supportedLanguages.length).toBeGreaterThan(1);
    expect(
      context.supportedLanguages.some((language: { code: string }): boolean => {
        return language.code === "en";
      }),
    ).toBe(true);
  });
});
