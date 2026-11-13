import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import {
  DocsScreenManifest,
  readManifest,
} from "../../../FeatureSet/Docs/Screens/DocsScreenFiles";
import { DOCS_SCREENS } from "../../../FeatureSet/Docs/Screens/DocsScreenList";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";

/*
 * THE DOCS' SCREENSHOT COMPONENT (#6823): a page writes
 * `![alt text](screen:<shot>)`, and the docs show that shot's picture in the
 * language the page is written in - the English one where the shot is not
 * drawn in it - at its own size, with the page's own alt text, from the
 * installation's own static files.
 */

const MANIFEST: DocsScreenManifest = {
  pixelRatio: 2,
  shots: {
    "website-down-who": {
      en: { width: 780, height: 314 },
      de: { width: 780, height: 340 },
    },
    "english-only": { en: { width: 500, height: 200 } },
  },
};

const render: (
  markdown: string,
  lang: string,
  contentLang?: string,
) => Promise<string> = (
  markdown: string,
  lang: string,
  contentLang?: string,
): Promise<string> => {
  return DocsRender.render(markdown, {
    lang,
    contentLang: contentLang || lang,
    screens: MANIFEST,
  });
};

// Every <img> the HTML has, as written.
function images(html: string): Array<string> {
  return html.match(/<img\b[^>]*>/g) || [];
}

describe("a screenshot on a docs page", () => {
  it("shows the page language's picture, at its size, with the page's alt text", async () => {
    const html: string = await render(
      "![Der Schritt „Wer soll informiert werden?“](screen:website-down-who)",
      "de",
    );

    expect(images(html)).toEqual([
      '<img src="/docs/static/images/screens/de/website-down-who.webp" alt="Der Schritt „Wer soll informiert werden?“" width="780" height="340" class="docs-image docs-screen" loading="lazy" decoding="async" />',
    ]);
  });

  it("shows the English picture in a language the shot is not drawn in", async () => {
    const html: string = await render("![Un écran](screen:english-only)", "fr");

    expect(images(html)).toEqual([
      '<img src="/docs/static/images/screens/en/english-only.webp" alt="Un écran" width="500" height="200" class="docs-image docs-screen" loading="lazy" decoding="async" />',
    ]);
  });

  it("follows the language the page is written in, so its steps and its picture name the same buttons", async () => {
    // A German page with no translation yet is English: English buttons.
    const html: string = await render(
      "![The step](screen:website-down-who)",
      "de",
      "en",
    );

    expect(html).toContain(
      'src="/docs/static/images/screens/en/website-down-who.webp"',
    );
    expect(html).toContain('height="314"');
  });

  it("keeps a title, and escapes the alt text as Markdown does", async () => {
    const html: string = await render(
      '![A "quoted" <b>word</b> & more](screen:website-down-who "Who is told")',
      "en",
    );

    expect(images(html)).toHaveLength(1);
    expect(images(html)[0]).toContain(' title="Who is told"');
    expect(images(html)[0]).not.toContain("<b>");
    expect(images(html)[0]).toContain("&amp;");
    expect(images(html)[0]).toContain(
      'src="/docs/static/images/screens/en/website-down-who.webp"',
    );
  });

  it("leaves only its words where a shot has no picture at all, never a broken address", async () => {
    const html: string = await render(
      "Before ![What it shows](screen:no-such-shot) after",
      "en",
    );

    expect(html).not.toContain("screen:");
    expect(images(html)).toEqual([]);
    expect(html).toContain("What it shows");
  });

  it("leaves images that are not screenshots as they were", async () => {
    const html: string = await render(
      "![Monitors](/docs/static/images/monitors.png)",
      "de",
    );

    expect(images(html)).toEqual([
      '<img src="/docs/static/images/monitors.png" alt="Monitors" class="docs-image" loading="lazy" decoding="async" />',
    ]);
  });

  it("reads the real manifest when a page names no other", async () => {
    const manifest: DocsScreenManifest = readManifest();
    const shot: string = DOCS_SCREENS[0]!.name;
    const html: string = await DocsRender.render(`![x](screen:${shot})`, {
      lang: "de",
      contentLang: "de",
    });

    expect(manifest.shots[shot]?.["de"]).toBeDefined();
    expect(html).toContain(`src="/docs/static/images/screens/de/${shot}.webp"`);
    expect(html).toContain(`width="${manifest.shots[shot]!["de"]!.width}"`);
  });
});

describe("the pages that show screenshots, as the docs serve them", () => {
  const PAGES: Array<string> = [
    "guides/website-down",
    "guides/paging",
    "guides/status-page",
    "introduction/quickstart",
  ];

  it.each(DOCS_LANGUAGES)(
    "show every screenshot in %s from the installation's own files, in that language, with alt text",
    async (lang: string) => {
      for (const page of PAGES) {
        const body: string = readPage(lang, page)
          .split("\n")
          .slice(1)
          .join("\n");
        const html: string = await DocsRender.render(
          DocsPlaceholders.render(body, lang),
          { lang, contentLang: lang },
        );
        const screens: Array<string> = images(html).filter((tag: string) => {
          return tag.includes("docs-screen");
        });

        expect({ page, left: html.includes("screen:") }).toEqual({
          page,
          left: false,
        });
        expect(screens.length).toBeGreaterThanOrEqual(3);
        for (const tag of screens) {
          expect(tag).toMatch(
            new RegExp(
              `src="/docs/static/images/screens/${lang}/[a-z0-9-]+\\.webp"`,
            ),
          );
          expect(tag).toMatch(/ alt="[^"]{12,}"/);
          expect(tag).toMatch(/ width="\d+" height="\d+"/);
        }
      }
    },
  );
});
