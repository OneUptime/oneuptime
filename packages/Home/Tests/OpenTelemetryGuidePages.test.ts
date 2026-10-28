import {
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import {
  GuidePageContent,
  GuideSection,
  checkedLabels,
  getGuidePageContent,
  guideSections,
} from "../Utils/Integrations/OpenTelemetry/GuidePage";
import { getIntegrationsIndexContent } from "../Utils/Integrations/OpenTelemetry/IntegrationsIndex";
import {
  generateGuideMarkdown,
  generateIntegrationsIndexMarkdown,
} from "../Utils/Integrations/OpenTelemetry/GuideMarkdown";
import {
  OPEN_TELEMETRY_GUIDE_PAGES,
  getGuideEntry,
} from "../Utils/Integrations/OpenTelemetry/OpenTelemetryGuides";
import {
  GuideQuestion,
  OpenTelemetryGuide,
} from "../Utils/Integrations/OpenTelemetry/GuideTypes";
import { guideSnippets } from "../Utils/Integrations/OpenTelemetry/GuideSnippets";
import {
  checkedWith,
  getVerificationRecord,
} from "../Utils/Integrations/OpenTelemetry/GuideVerifications";
import { inlineTextToPlainText } from "../Utils/Integrations/OpenTelemetry/GuideText";
import { HOME_URL, renderView, seoFor } from "./Helpers/TailwindPages";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { JSDOM } from "jsdom";

/*
 * The guides and their index as Routes.ts renders them, read back as a
 * browser and a search engine would: one h1, the page's own title,
 * description and canonical address, structured data that parses and says
 * what the page shows, the sections in order with the contents list
 * pointing at each, every snippet with its copy button, tabs a screen
 * reader can use, images that hold their place, and links to pages the site
 * publishes. The Markdown copies (llms.txt lists them) carry the same
 * sections.
 */

const GUIDES: Array<OpenTelemetryGuide> = [...OPEN_TELEMETRY_GUIDE_PAGES];
const SCRIPT_PATH: string = "/js/integrations.js?v=test";

type JsonLd = Record<string, unknown>;

function structuredDataOf(document: Document): Array<JsonLd> {
  return Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  ).map((script: Element): JsonLd => {
    return JSON.parse(script.textContent || "{}") as JsonLd;
  });
}

function ofType(schemas: Array<JsonLd>, type: string): Array<JsonLd> {
  return schemas.filter((schema: JsonLd): boolean => {
    return schema["@type"] === type;
  });
}

async function renderGuide(slug: string): Promise<Document> {
  const html: string = await renderView(
    "integrations/opentelemetry-guide.ejs",
    {
      enableGoogleTagManager: false,
      seo: seoFor(getOpenTelemetryGuidePath(slug)),
      guide: getGuidePageContent(slug, HOME_URL),
      integrationsScript: SCRIPT_PATH,
    },
  );

  return new JSDOM(html).window.document;
}

describe.each(
  GUIDES.map((guide: OpenTelemetryGuide): [string, OpenTelemetryGuide] => {
    return [guide.slug, guide];
  }),
)("the %s guide's page", (slug: string, guide: OpenTelemetryGuide) => {
  let document: Document;
  let content: GuidePageContent;

  beforeAll(async () => {
    document = await renderGuide(slug);
    content = getGuidePageContent(slug, HOME_URL)!;
  });

  test("has one h1, the guide's", () => {
    const headings: Array<string> = Array.from(
      document.querySelectorAll("h1"),
    ).map((heading: Element): string => {
      return (heading.textContent || "").trim();
    });

    expect(headings).toEqual([guide.h1]);
  });

  test("is titled, described and made canonical as its own search result", () => {
    expect(document.title).toBe(guide.seo.title);
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe(guide.seo.description);
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe(`${HOME_URL}${getOpenTelemetryGuidePath(slug)}`);
  });

  test("describes itself in structured data a search engine can read", () => {
    const schemas: Array<JsonLd> = structuredDataOf(document);
    const article: JsonLd = ofType(schemas, "TechArticle")[0]!;
    const faq: JsonLd = ofType(schemas, "FAQPage")[0]!;
    const breadcrumbs: JsonLd = ofType(schemas, "BreadcrumbList")[0]!;

    expect(article).toMatchObject({
      headline: guide.h1,
      description: guide.seo.description,
      url: `${HOME_URL}${getOpenTelemetryGuidePath(slug)}`,
      dateModified: getVerificationRecord(slug)!.checkedOn,
    });
    expect(
      (faq["mainEntity"] as Array<JsonLd>).map((question: JsonLd): unknown => {
        return [
          question["name"],
          (question["acceptedAnswer"] as JsonLd)["text"],
        ];
      }),
    ).toEqual(
      guide.faq.map((question: GuideQuestion): Array<string> => {
        return [question.question, inlineTextToPlainText(question.answer)];
      }),
    );
    expect(
      (breadcrumbs["itemListElement"] as Array<JsonLd>).map(
        (item: JsonLd): unknown => {
          return item["name"];
        },
      ),
    ).toEqual([
      "Home",
      "Integrations",
      `${getGuideEntry(slug).name} OpenTelemetry`,
    ]);
  });

  test("sets out its sections in order, each with its h2, and lists them in its contents", () => {
    const sections: Array<GuideSection> = guideSections(
      getGuideEntry(slug).name,
      getGuideEntry(slug).kind,
    );

    expect(
      Array.from(document.querySelectorAll("section.guide-section")).map(
        (section: Element): Array<string> => {
          return [
            section.id,
            (section.querySelector("h2")?.textContent || "").trim(),
          ];
        },
      ),
    ).toEqual(
      sections.map((section: GuideSection): Array<string> => {
        return [section.id, section.title];
      }),
    );

    const contents: Element = document.querySelector(
      'nav[aria-label="On this page"]',
    )!;
    expect(
      Array.from(contents.querySelectorAll("a")).map(
        (link: Element): string | null => {
          return link.getAttribute("href");
        },
      ),
    ).toEqual(
      sections.map((section: GuideSection): string => {
        return `#${section.id}`;
      }),
    );
  });

  test("shows every snippet once, with a copy button", () => {
    const blocks: Array<Element> = Array.from(
      document.querySelectorAll("[data-code-block]"),
    );

    expect(
      blocks.map((block: Element): string | null => {
        return block.getAttribute("data-snippet");
      }),
    ).toEqual(
      guideSnippets(guide).map((snippet: { id: string }): string => {
        return snippet.id;
      }),
    );
    for (const block of blocks) {
      expect(block.querySelector("[data-copy-button]")).not.toBeNull();
      expect(
        (block.querySelector("pre code")?.textContent || "").length,
      ).toBeGreaterThan(0);
    }
  });

  test("shows each snippet's code as it is written, character for character", () => {
    const shown: Map<string, string> = new Map(
      Array.from(document.querySelectorAll("[data-code-block]")).map(
        (block: Element): [string, string] => {
          return [
            block.getAttribute("data-snippet") || "",
            block.querySelector("pre code")?.textContent || "",
          ];
        },
      ),
    );

    for (const snippet of guideSnippets(guide)) {
      expect([snippet.id, shown.get(snippet.id)]).toEqual([
        snippet.id,
        snippet.code,
      ]);
    }
  });

  test("gives its tabs the roles and states a screen reader needs", () => {
    const tablists: Array<Element> = Array.from(
      document.querySelectorAll('[role="tablist"]'),
    );

    expect(tablists.length).toBeGreaterThan(0);
    for (const tablist of tablists) {
      const tabs: Array<Element> = Array.from(
        tablist.querySelectorAll('[role="tab"]'),
      );
      expect(
        tabs.filter((tab: Element): boolean => {
          return tab.getAttribute("aria-selected") === "true";
        }).length,
      ).toBe(1);
      for (const tab of tabs) {
        const panel: Element | null = document.getElementById(
          tab.getAttribute("aria-controls") || "",
        );
        expect(panel?.getAttribute("role")).toBe("tabpanel");
        expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      }
    }
  });

  test("gives every image its size, so nothing moves as the page loads", () => {
    for (const image of Array.from(document.querySelectorAll("main img"))) {
      expect([
        image.getAttribute("src"),
        image.getAttribute("width"),
        image.getAttribute("height"),
      ]).toEqual([
        image.getAttribute("src"),
        expect.stringMatching(/^\d+$/),
        expect.stringMatching(/^\d+$/),
      ]);
    }
  });

  test("links its related guides, the index and the docs it names", () => {
    const hrefs: Array<string> = Array.from(
      document.querySelectorAll("main a"),
    ).map((link: Element): string => {
      return link.getAttribute("href") || "";
    });

    for (const related of guide.related) {
      expect(hrefs).toContain(getOpenTelemetryGuidePath(related));
    }
    for (const doc of guide.docs) {
      expect(hrefs).toContain(doc.href);
    }
    expect(hrefs).toContain(OPEN_TELEMETRY_GUIDES_INDEX_PATH);
    expect(content.related.length).toBe(guide.related.length);
  });

  test("says when and with what it was checked end to end", () => {
    const text: string =
      document.querySelector("main header")?.textContent || "";

    expect(content.checked).toBeDefined();
    expect(text).toContain(content.checked!.onLabel);
    expect(text).toContain(getVerificationRecord(slug)!.runtime);
  });

  test("names what it was checked with once each, on the page and in its Markdown copy", () => {
    const record: ReturnType<typeof getVerificationRecord> =
      getVerificationRecord(slug)!;
    const parts: Array<string> = checkedWith(record);

    expect(content.checked!.withLabel).toBe(parts.join(" · "));
    // The runtime, always; never the same thing twice.
    expect(parts[parts.length - 1]).toBe(record.runtime);
    expect(new Set(parts).size).toBe(parts.length);
    expect(generateGuideMarkdown(guide, HOME_URL).split("\n")).toContain(
      `${content.checked!.onLabel} with ${parts.join(", ")}.`,
    );
  });

  test("loads the page's script once, deferred", () => {
    const scripts: Array<Element> = Array.from(
      document.querySelectorAll(`script[src="${SCRIPT_PATH}"]`),
    );

    expect(scripts.length).toBe(1);
    expect(scripts[0]!.hasAttribute("defer")).toBe(true);
  });

  test("has a Markdown copy with the same sections and every snippet", () => {
    const markdown: string = generateGuideMarkdown(guide, HOME_URL);

    expect(markdown.startsWith(`# ${guide.h1}\n`)).toBe(true);
    for (const section of guideSections(
      getGuideEntry(slug).name,
      getGuideEntry(slug).kind,
    )) {
      expect(markdown).toContain(`\n## ${section.title}\n`);
    }
    for (const snippet of guideSnippets(guide)) {
      expect(markdown).toContain(snippet.code);
    }
    // Links work wherever the copy is pasted.
    expect(markdown).not.toContain("](/");
  });
});

/*
 * What a check ran on, named the way a reader reads it: a framework at its
 * version, then the runtime; a guide whose framework is the runtime itself
 * - Node.js, Bun, Deno, and the browser, whose check names Chromium as its
 * framework and Chrome as its runtime - names the runtime alone.
 */
describe("the checked line's names", () => {
  test("a framework at its version, then its runtime", () => {
    expect(
      checkedWith({ framework: "Express 5.3.0", runtime: "Node.js 24.22.1" }),
    ).toEqual(["Express 5.3.0", "Node.js 24.22.1"]);
    expect(
      checkedWith({
        framework: "React 19.3.1",
        runtime: "Chrome 153.0.8010.12",
      }),
    ).toEqual(["React 19.3.1", "Chrome 153.0.8010.12"]);
  });

  test("a runtime's own guide names the runtime once", () => {
    expect(
      checkedWith({ framework: "Node.js", runtime: "Node.js 24.22.1" }),
    ).toEqual(["Node.js 24.22.1"]);
    expect(checkedWith({ framework: "Bun", runtime: "Bun 1.4.4" })).toEqual([
      "Bun 1.4.4",
    ]);
    expect(checkedWith({ framework: "Deno", runtime: "Deno 2.9.8" })).toEqual([
      "Deno 2.9.8",
    ]);
  });

  test("the browser's guide names the browser it ran in, not Chromium beside Chrome", () => {
    expect(
      checkedWith({ framework: "Chromium", runtime: "Chrome 153.0.8010.12" }),
    ).toEqual(["Chrome 153.0.8010.12"]);
    expect(checkedLabels(getVerificationRecord("browser"))!.withLabel).toBe(
      getVerificationRecord("browser")!.runtime,
    );
    expect(
      generateGuideMarkdown(
        OPEN_TELEMETRY_GUIDE_PAGES.find((guide: OpenTelemetryGuide) => {
          return guide.slug === "browser";
        })!,
        HOME_URL,
      ),
    ).not.toContain("Chromium,");
  });

  test("a guide never checked has no line", () => {
    expect(checkedLabels(undefined)).toBeUndefined();
  });
});

describe("a slug the catalog does not know", () => {
  test("has no page", () => {
    expect(getGuidePageContent("cobol", HOME_URL)).toBeNull();
  });
});

describe("the integrations index", () => {
  let document: Document;

  beforeAll(async () => {
    const html: string = await renderView("integrations/index.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor(OPEN_TELEMETRY_GUIDES_INDEX_PATH),
      integrations: getIntegrationsIndexContent(HOME_URL),
      integrationsScript: SCRIPT_PATH,
    });
    document = new JSDOM(html).window.document;
  });

  test("has one h1, and its own title, description and canonical address", () => {
    expect(document.querySelectorAll("h1").length).toBe(1);
    expect(document.title).toBe(seoFor(OPEN_TELEMETRY_GUIDES_INDEX_PATH).title);
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe(`${HOME_URL}${OPEN_TELEMETRY_GUIDES_INDEX_PATH}`);
  });

  test("groups every guide under its language, in the catalog's order, each card a link", () => {
    const groups: Array<Element> = Array.from(
      document.querySelectorAll("[data-integrations-group]"),
    );

    expect(
      groups.map((group: Element): string => {
        return group.id;
      }),
    ).toEqual(["javascript"]);
    expect(
      Array.from(document.querySelectorAll("[data-integration-card] a")).map(
        (link: Element): string | null => {
          return link.getAttribute("href");
        },
      ),
    ).toEqual(
      GUIDES.map((guide: OpenTelemetryGuide): string => {
        return getOpenTelemetryGuidePath(guide.slug);
      }),
    );
  });

  test("gives each card the words its search finds it by", () => {
    for (const card of Array.from(
      document.querySelectorAll("[data-integration-card]"),
    )) {
      const words: string = card.getAttribute("data-search") || "";
      const name: string = (
        card.querySelector("a > span.min-w-0 > span")?.textContent || ""
      ).trim();

      expect(words).toContain(name.toLowerCase());
      expect(words).toContain("javascript");
    }
  });

  test("labels its search box, and shows every guide without the script", () => {
    const search: Element | null = document.querySelector(
      "[data-integrations-search]",
    );

    expect(search).not.toBeNull();
    expect(document.querySelector(`label[for="${search!.id}"]`)).not.toBeNull();
    for (const card of Array.from(
      document.querySelectorAll("[data-integration-card]"),
    )) {
      expect(card.hasAttribute("hidden")).toBe(false);
    }
  });

  test("lists every guide in its structured data", () => {
    const itemList: JsonLd = ofType(structuredDataOf(document), "ItemList")[0]!;

    expect(itemList["numberOfItems"]).toBe(GUIDES.length);
    expect(
      (itemList["itemListElement"] as Array<JsonLd>).map(
        (item: JsonLd): unknown => {
          return item["url"];
        },
      ),
    ).toEqual(
      GUIDES.map((guide: OpenTelemetryGuide): string => {
        return `${HOME_URL}${getOpenTelemetryGuidePath(guide.slug)}`;
      }),
    );
  });

  test("has a Markdown copy that links every guide's", () => {
    const markdown: string = generateIntegrationsIndexMarkdown(HOME_URL);

    for (const guide of GUIDES) {
      expect(markdown).toContain(
        `${HOME_URL}${getOpenTelemetryGuidePath(guide.slug)}.md`,
      );
    }
  });
});
