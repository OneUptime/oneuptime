import {
  DocsContainerUse,
  DocsFence,
  DocsHeading,
  DocsLink,
  DocsPageLink,
  ScannedPage,
  TRANSLATED_LANGUAGES,
  hasPage,
  listPages,
  parseDocsLink,
  scanPage,
} from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";

/*
 * Every page is in every language, and each translation says what the
 * English says: the same sections, the same code, the same diagrams, the
 * same components, links and images. A page with no translation is served in
 * English, and a translation that has drifted - a section the English gained
 * after it was translated, a code sample that changed - tells its readers
 * something the product no longer does.
 *
 * What is compared is the page's shape, not its words: the heading levels in
 * order, each code sample's language, the components and their tabs and
 * steps, the callouts, the {{PLACEHOLDERS}}, the docs pages it links to and
 * the images it shows.
 */

interface Shape {
  headings: Array<number>;
  fences: Array<string>;
  components: Array<string>;
  alerts: Array<string>;
  placeholders: Array<string>;
  pageLinks: Array<string>;
  images: Array<string>;
}

const shapeOf: (lang: string, page: string) => Shape = (
  lang: string,
  page: string,
): Shape => {
  const scanned: ScannedPage = scanPage(lang, page);

  return {
    headings: scanned.headings.map((heading: DocsHeading): number => {
      return heading.level;
    }),
    fences: scanned.fences.map((fence: DocsFence): string => {
      return fence.lang || "(none)";
    }),
    components: scanned.containers.map((use: DocsContainerUse): string => {
      if (use.name === "tabs") {
        return `tabs(${use.tabs.length})`;
      }
      if (use.name === "steps") {
        return `steps(${use.steps})`;
      }
      return use.name;
    }),
    alerts: scanned.alerts,
    placeholders: Array.from(new Set(scanned.placeholders)).sort(),
    pageLinks: Array.from(
      new Set(
        scanned.links
          .map((link: DocsLink): DocsPageLink | null => {
            return link.isImage ? null : parseDocsLink(link.target);
          })
          .filter((target: DocsPageLink | null): boolean => {
            return target !== null;
          })
          .map((target: DocsPageLink | null): string => {
            return target!.page;
          }),
      ),
    ).sort(),
    images: scanned.links
      .filter((link: DocsLink): boolean => {
        return link.isImage;
      })
      .map((link: DocsLink): string => {
        return link.target;
      }),
  };
};

const ENGLISH_PAGES: Array<string> = listPages("en");

const TITLE_LINE: RegExp = /^#\s+\S/;

describe.each(TRANSLATED_LANGUAGES)("the %s docs", (lang: string) => {
  it("have every page the English docs have", () => {
    const untranslated: Array<string> = ENGLISH_PAGES.filter(
      (page: string): boolean => {
        return !hasPage(lang, page);
      },
    );

    expect(untranslated).toEqual([]);
  });

  it("keep each page's shape: sections, code, components, callouts, links and images", () => {
    const drifted: Array<string> = [];

    for (const page of ENGLISH_PAGES) {
      if (!hasPage(lang, page)) {
        continue;
      }

      const english: Shape = shapeOf("en", page);
      const translated: Shape = shapeOf(lang, page);

      for (const key of Object.keys(english) as Array<keyof Shape>) {
        const theirs: string = JSON.stringify(english[key]);
        const ours: string = JSON.stringify(translated[key]);

        if (theirs !== ours) {
          drifted.push(`${page} ${key}: English ${theirs}, ${lang} ${ours}`);
        }
      }
    }

    expect(drifted).toEqual([]);
  });

  it("keep the title on the first line", () => {
    const untitled: Array<string> = listPages(lang).filter(
      (page: string): boolean => {
        return !TITLE_LINE.test(scanPage(lang, page).lines[0] || "");
      },
    );

    expect(untitled).toEqual([]);
  });
});
