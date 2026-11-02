import {
  AirGappedTopicContent,
  getAirGappedTopicContent,
} from "../Utils/AirGapped";
import {
  AIR_GAPPED_TOPIC_PATHS,
  AirGappedTopicCard,
  AirGappedTopicCapability,
  AirGappedTopicChange,
  AirGappedTopicConfigureStep,
  AirGappedTopicFaq,
  AirGappedTopicPage,
  AirGappedTopicPages,
} from "../Utils/AirGappedPages";
import {
  generateAirGappedTopicMarkdown,
  generateLlmsTxt,
} from "../Utils/AIDiscovery";
import { REDIRECT_PATHS, isRedirectPath } from "../Utils/Sitemap";
import {
  HOME_URL,
  bodyOfGetRoute,
  routesSource,
} from "./Helpers/AirGappedTopics";
import { describe, expect, test } from "@jest/globals";

/*
 * THE AIR-GAPPED PRODUCT PAGES, FOR MACHINES AND CRAWLERS.
 *
 * How each page is reached and read without a browser: its route, its line in
 * llms.txt, and its markdown variant, /enterprise/air-gapped/<product>.md,
 * written from the same entry as the page (Utils/AirGappedPages.ts) - section
 * by section, every link absolute.
 */

// Every markdown link's target, and every second-level heading.
const MARKDOWN_LINK_TARGET: RegExp = /\]\(([^()\]\s]+)\)/g;
const SECOND_LEVEL_HEADING: RegExp = /^## (.+)$/gm;

const eachPage: Array<[string, AirGappedTopicPage]> = AirGappedTopicPages.map(
  (entry: AirGappedTopicPage): [string, AirGappedTopicPage] => {
    return [entry.slug, entry];
  },
);

function contentOf(page: AirGappedTopicPage): AirGappedTopicContent {
  return getAirGappedTopicContent(page.slug);
}

function markdown(
  page: AirGappedTopicPage,
  homeUrl: string = HOME_URL,
): string {
  return generateAirGappedTopicMarkdown(homeUrl, contentOf(page));
}

describe("the routes", () => {
  test.each(eachPage)(
    "%s is registered, rendered with its own entry and handed its own SEO entry",
    (_slug: string, page: AirGappedTopicPage) => {
      const body: string | null = bodyOfGetRoute(page.path);

      expect(body).not.toBeNull();
      expect(body).toContain("res.render(`${ViewsPath}/air-gapped-topic`");
      expect(body).toContain(
        `airGappedTopic: getAirGappedTopicContent("${page.slug}")`,
      );
      expect(body).toContain(`getSEOForPath(\n          "${page.path}"`);
      expect(body).toContain("enableGoogleTagManager: GoogleTagManagerEnabled");
    },
  );

  test("every page has a route written out, so the tests that read the table find it", () => {
    const written: Array<string> = Array.from(
      routesSource.matchAll(
        /app\.get\(\s*"(\/enterprise\/air-gapped\/[^"]+)"/g,
      ),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(written.sort()).toEqual(AIR_GAPPED_TOPIC_PATHS.slice().sort());
  });

  test.each(eachPage)(
    "%s is a page, not a redirect, so the sitemap lists it",
    (_slug: string, page: AirGappedTopicPage) => {
      expect(isRedirectPath(page.path)).toBe(false);
      expect(REDIRECT_PATHS.has(page.path)).toBe(false);
    },
  );

  test("its markdown variant is the page's own, not the generic one", () => {
    const start: number = routesSource.indexOf("app.get(/^\\/.+\\.md$/");
    const handler: string = routesSource.slice(
      start,
      routesSource.indexOf("app.get(", start + 1),
    );

    expect(handler).toContain("getAirGappedTopicSlugForPath(pagePath);");
    expect(handler).toContain("generateAirGappedTopicMarkdown(");
    // Checked before the generic SEO-entry branch, which would win otherwise.
    expect(handler.indexOf("else if (airGappedTopic)")).toBeGreaterThan(-1);
    expect(handler.indexOf("else if (airGappedTopic)")).toBeLessThan(
      handler.indexOf("PageSEOConfig[pagePath]"),
    );
  });
});

describe("llms.txt", () => {
  const txt: string = generateLlmsTxt(HOME_URL, []);
  const enterprise: string = txt.slice(
    txt.indexOf("## Enterprise"),
    txt.indexOf("## Compare OneUptime"),
  );

  test.each(eachPage)(
    "lists %s with the other enterprise pages, linking its markdown",
    (_slug: string, page: AirGappedTopicPage) => {
      const name: string = page.seo.title.split("|")[0]!.trim();

      expect(enterprise).toContain(
        `- [${name}](https://oneuptime.com${page.path}.md): ${page.seo.description}`,
      );
    },
  );

  test("lists each page once", () => {
    for (const path of AIR_GAPPED_TOPIC_PATHS) {
      expect(txt.split(`${path}.md`).length - 1).toBe(1);
    }
  });
});

describe.each(eachPage)(
  "/enterprise/air-gapped/%s.md",
  (_slug: string, page: AirGappedTopicPage) => {
    const content: AirGappedTopicContent = contentOf(page);
    const md: string = markdown(page);

    test("leads with the page's name, description and canonical address", () => {
      expect(md.startsWith(`# ${page.title}\n`)).toBe(true);
      expect(md).toContain(`> ${page.seo.description}`);
      expect(md).toContain(`Canonical page: https://oneuptime.com${page.path}`);
      expect(md).toContain(page.lead);
    });

    test("has the page's sections, in the page's order", () => {
      expect(
        Array.from(
          md.matchAll(SECOND_LEVEL_HEADING),
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ).toEqual([
        page.inside.title,
        page.changes.title,
        page.configure.title,
        "The same four steps as every air-gapped install",
        "Questions buyers ask",
        "Plan your install",
        "Learn More",
      ]);
    });

    test("lists what runs inside, each with where to read more", () => {
      for (const capability of page.inside
        .capabilities as Array<AirGappedTopicCapability>) {
        const href: string = capability.link.href;

        expect(md).toContain(
          `- **${capability.title}**: ${capability.description} ([${capability.link.label}](https://oneuptime.com${href}))`,
        );
      }
    });

    test("tables what changes, in the page's words", () => {
      const words: Record<string, string> = {
        "change-a-setting": "Change a setting",
        "use-your-own": "Use your own",
        "needs-a-route": "Needs a route",
      };

      expect(md).toContain(
        "| Feature | With a route out | Inside an air gap | What it takes |",
      );

      for (const change of page.changes.rows as Array<AirGappedTopicChange>) {
        expect(md).toContain(
          `| ${change.name} | ${change.usually} | ${change.inside} | ${words[change.status]} |`,
        );
      }
    });

    test("numbers what to configure, and carries the code exactly as the page shows it", () => {
      page.configure.steps.forEach(
        (step: AirGappedTopicConfigureStep, index: number) => {
          expect(md).toContain(
            `${index + 1}. **${step.title}**: ${step.description}`,
          );
        },
      );

      expect(md).toContain(
        `\`\`\`${page.configure.code.language}\n${page.configure.code.text}\n\`\`\``,
      );
      expect(md).toContain(page.configure.caption);
    });

    test("leads into each of the hub's four steps", () => {
      expect(content.hub.steps).toHaveLength(4);

      content.hub.steps.forEach(
        (step: { key: string; title: string }, index: number) => {
          expect(md).toContain(
            `${index + 1}. [${step.title}](https://oneuptime.com/enterprise/air-gapped#step-${step.key})`,
          );
        },
      );
    });

    test("answers every question, each under its own heading", () => {
      for (const faq of page.faqs as Array<AirGappedTopicFaq>) {
        expect(md).toContain(`### ${faq.question}\n\n${faq.answer}`);
      }
    });

    test("says where to book or write", () => {
      expect(md).toContain(
        "Book a working session with OneUptime's engineers at https://oneuptime.com/enterprise/air-gapped#plan-your-install, or email enterprise@oneuptime.com.",
      );
    });

    test("leads on to the hub, the product and the pages beside it", () => {
      expect(md).toContain(
        "- [Air-gapped installs](https://oneuptime.com/enterprise/air-gapped.md)",
      );
      expect(md).toContain(
        `- [${page.product.label}](https://oneuptime.com${page.product.href}.md)`,
      );

      for (const related of content.related as Array<AirGappedTopicCard>) {
        expect(md).toContain(
          `- [${related.title}](https://oneuptime.com${related.path}.md)`,
        );
      }
    });

    test("writes every link absolute, so it works where the markdown is read", () => {
      const targets: Array<string> = Array.from(
        md.matchAll(MARKDOWN_LINK_TARGET),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      expect(targets.length).toBeGreaterThan(12);

      for (const target of targets) {
        expect([target, new URL(target).protocol]).toEqual([target, "https:"]);
      }
    });

    test("leaves nothing unfilled", () => {
      expect(md).not.toContain("undefined");
      expect(md).not.toContain("[object Object]");
    });

    test("normalizes a trailing slash on the home URL", () => {
      const slashed: string = markdown(page, "https://oneuptime.com/");

      expect(slashed).toContain(
        `Canonical page: https://oneuptime.com${page.path}\n`,
      );
      expect(slashed).not.toContain("https://oneuptime.com//");
    });
  },
);

describe("the markdown's table", () => {
  test("keeps a cell's own | inside the cell", () => {
    const content: AirGappedTopicContent = getAirGappedTopicContent("on-call");
    const row: AirGappedTopicChange = {
      ...content.changes.rows[0]!,
      inside: "One | or the other",
    };
    const md: string = generateAirGappedTopicMarkdown(HOME_URL, {
      ...content,
      changes: { ...content.changes, rows: [row] },
    });

    expect(md).toContain("One \\| or the other");
  });
});
