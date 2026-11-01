import { plainText } from "../Utils/AirGapped";
import {
  AIR_GAPPED_TOPIC_PATHS,
  AirGappedIconName,
  AirGappedIcons,
  AirGappedProductLink,
  AirGappedTopicCapability,
  AirGappedTopicCard,
  AirGappedTopicChange,
  AirGappedTopicChangeStatus,
  AirGappedTopicConfigureStep,
  AirGappedTopicFaq,
  AirGappedTopicFlowItem,
  AirGappedTopicPage,
  AirGappedTopicPages,
  AirGappedTopicSlug,
  getAirGappedProductLinks,
  getAirGappedTopicCard,
  getAirGappedTopicCards,
  getAirGappedTopicPage,
  getAirGappedTopicSlugForPath,
} from "../Utils/AirGappedPages";
import PageSEOConfig, { PageSEOData } from "../Utils/PageSEO";
import {
  HOME_URL,
  SEOForTemplate,
  all,
  bodyOfGetRoute,
  codeIn,
  codeSpansOf,
  documentOf,
  problemWithLink,
  renderHub,
  renderTopic,
  renderView,
  routesSource,
  seoFor,
  stringsOf,
  textOf,
} from "./Helpers/AirGappedTopics";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE AIR-GAPPED PRODUCT PAGES, RENDERED.
 *
 * Every page of the family, through the real template with the locals
 * Routes.ts hands it, read back as a browser would: what each section says
 * (all of it from Utils/AirGappedPages.ts, whose facts
 * Tests/AirGappedTopicFacts.test.ts holds to the repository), that every link
 * goes somewhere real, that the headings read in order for a screen reader,
 * that a phone reads every table, and that every way to the booking is tagged
 * so it counts. Then the family as a whole: what a page must have to join it.
 */

const STATUS_WORDS: Record<AirGappedTopicChangeStatus, string> = {
  "change-a-setting": "Change a setting",
  "use-your-own": "Use your own",
  "needs-a-route": "Needs a route",
};

const BOOKING: string = "/enterprise/air-gapped#plan-your-install";

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");

const itemText: (item: AirGappedTopicFlowItem) => string = (
  item: AirGappedTopicFlowItem,
): string => {
  return `${item.label} ${item.detail}`;
};

const eachPage: Array<[string, AirGappedTopicPage]> = AirGappedTopicPages.map(
  (entry: AirGappedTopicPage): [string, AirGappedTopicPage] => {
    return [entry.slug, entry];
  },
);

describe.each(eachPage)("%s", (_slug: string, topic: AirGappedTopicPage) => {
  let html: string;
  let page: Document;
  let main: Element;
  let hub: Document;

  beforeAll(async () => {
    html = await renderTopic(topic.slug);
    page = documentOf(html);
    main = page.getElementById("main-content")!;
    hub = documentOf(await renderHub());
  });

  test("renders a whole page, with nothing left unfilled", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(main).not.toBeNull();
    expect(textOf(main)).not.toContain("undefined");
    expect(textOf(main)).not.toContain("[object Object]");
    // Text is drawn as written: a Markdown code span would show its backticks.
    expect(textOf(main)).not.toContain("`");
  });

  test("writes the head from its SEO entry", () => {
    const seo: SEOForTemplate = seoFor(topic.path);

    expect(page.title).toBe(topic.seo.title);
    expect(
      page.querySelector('meta[name="description"]')?.getAttribute("content"),
    ).toBe(topic.seo.description);
    expect(
      page.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe(seo.fullCanonicalUrl);
  });

  test("leads with one heading, in two parts", () => {
    const headings: Array<Element> = all(page, "h1");

    expect(headings).toHaveLength(1);
    expect(textOf(headings[0])).toBe(
      `${topic.headline} ${topic.headlineContinued}`,
    );
    expect(textOf(headings[0]!.querySelector("span"))).toBe(
      topic.headlineContinued,
    );
  });

  test("says where it sits: a link back to the hub, and the product's name", () => {
    const eyebrow: Element = page.querySelector("#air-gapped-topic-hero p")!;

    expect(textOf(eyebrow)).toBe(`Air-Gapped ${topic.name}`);
    expect(eyebrow.querySelector("a")?.getAttribute("href")).toBe(
      "/enterprise/air-gapped",
    );
  });

  test("offers the two things a visitor comes for: planning an install, and what changes", () => {
    const hero: Element = page.getElementById("air-gapped-topic-hero")!;
    const plan: Element | null = hero.querySelector(`a[href="${BOOKING}"]`);
    const changes: Element | null = hero.querySelector(
      'a[href="#what-changes"]',
    );

    expect(textOf(plan)).toBe("Plan your air-gapped install");
    expect(plan?.getAttribute("data-ou-cta")).toBe("cta_request_demo");
    expect(textOf(changes)).toBe("See what changes");
  });

  test("lists its proof points under the buttons, in order", () => {
    expect(
      all(page, '[data-testid="air-gapped-topic-proof-points"] li').map(textOf),
    ).toEqual(topic.proofPoints);
  });

  test("draws everything inside one boundary: the customer's network", () => {
    const picture: Element = page.querySelector(
      '[data-testid="air-gapped-topic-flow"]',
    )!;

    expect(textOf(picture)).toContain("Your network");
    expect(textOf(picture)).toContain("No route to the internet needed");

    const from: Element = picture.querySelector(
      '[data-testid="air-gapped-topic-flow-from"]',
    )!;
    const to: Element = picture.querySelector(
      '[data-testid="air-gapped-topic-flow-to"]',
    )!;
    const oneUptime: Element = picture.querySelector(
      '[data-testid="air-gapped-topic-flow-oneuptime"]',
    )!;

    expect(textOf(from.querySelector("p"))).toBe(topic.flow.from.title);
    expect(all(from, "li").map(textOf)).toEqual(
      topic.flow.from.items.map(itemText),
    );
    expect(textOf(to.querySelector("p"))).toBe(topic.flow.to.title);
    expect(all(to, "li").map(textOf)).toEqual(
      topic.flow.to.items.map(itemText),
    );
    expect(textOf(oneUptime.querySelector("p"))).toBe("OneUptime");
    expect(textOf(oneUptime)).toContain(topic.flow.oneUptime.detail);
    expect(all(oneUptime, "li").map(textOf)).toEqual(
      topic.flow.oneUptime.items.map((item: { label: string }): string => {
        return item.label;
      }),
    );

    // Each list says what it is, for a screen reader.
    for (const lane of [from, to]) {
      const list: Element = lane.querySelector("ul")!;

      expect(
        page.getElementById(list.getAttribute("aria-labelledby") || ""),
      ).toBe(lane.querySelector("p"));
    }

    // Every item has an icon the template draws, and the arrows are decoration.
    for (const icon of all(picture, "li svg path")) {
      expect((icon.getAttribute("d") || "").length).toBeGreaterThan(10);
    }
    expect(
      picture.querySelectorAll('span[aria-hidden="true"] svg'),
    ).toHaveLength(2);
  });

  test("names each section in the bar that follows the reader, each link landing on its section", () => {
    const bar: Element = page.querySelector('nav[aria-label="On this page"]')!;
    const links: Array<[string, string]> = all(bar, "a").map(
      (link: Element): [string, string] => {
        return [textOf(link), link.getAttribute("href") || ""];
      },
    );

    expect(links).toEqual([
      ["What runs inside", "#inside"],
      ["What changes", "#what-changes"],
      ["Configure", "#configure"],
      ["Install", "#install"],
      ["FAQ", "#faq"],
    ]);

    for (const [, href] of links) {
      expect(page.getElementById(href.slice(1))?.tagName).toBe("SECTION");
    }
  });

  test("keeps the bar under the site's menus, and the booking in it from a tablet up", () => {
    const layerOf: (element: Element | null) => number = (
      element: Element | null,
    ): number => {
      const layer: string | undefined = (element?.className || "")
        .split(" ")
        .find((name: string): boolean => {
          return name.startsWith("z-");
        });

      return Number((layer || "z-0").slice(2));
    };
    const bar: Element | null =
      page.querySelector('nav[aria-label="On this page"]')?.parentElement
        ?.parentElement || null;

    expect(bar?.className.split(" ")).toContain("sticky");

    for (const menu of ["mobile-menu", "solutions-menu", "resources-menu"]) {
      expect([menu, layerOf(bar) < layerOf(page.getElementById(menu))]).toEqual(
        [menu, true],
      );
    }

    const button: Element = page.querySelector(
      '[data-testid="air-gapped-topic-nav-plan"]',
    )!;

    expect(button.getAttribute("href")).toBe(BOOKING);
    expect(textOf(button)).toBe("Plan your install");
    // Hidden on a phone without the bare `hidden` a foreign stylesheet overrides.
    expect(button.className.split(" ")).toEqual(
      expect.arrayContaining(["max-md:hidden", "md:inline-flex"]),
    );
    expect(button.className.split(" ")).not.toContain("hidden");
  });

  test("labels every section with its own heading, in the page's order", () => {
    const sections: Array<Element> = all(main, "section[id]");

    expect(
      sections.map((section: Element): string => {
        return section.id;
      }),
    ).toEqual([
      "air-gapped-topic-hero",
      "inside",
      "what-changes",
      "configure",
      "install",
      "faq",
      "related",
      "plan-your-install",
    ]);

    for (const section of sections) {
      const label: Element | null = page.getElementById(
        section.getAttribute("aria-labelledby") || "",
      );

      expect([section.id, Boolean(label && section.contains(label))]).toEqual([
        section.id,
        true,
      ]);
      expect(["H1", "H2"]).toContain(label!.tagName);
    }
  });

  test("never skips a heading level, so a screen reader reads the page in order", () => {
    const levels: Array<number> = all(main, "h1, h2, h3, h4, h5, h6").map(
      (heading: Element): number => {
        return Number(heading.tagName.slice(1));
      },
    );

    expect(levels[0]).toBe(1);

    levels.forEach((level: number, index: number) => {
      if (index > 0) {
        expect(level).toBeLessThanOrEqual(levels[index - 1]! + 1);
      }
    });

    expect(all(main, "h2").map(textOf)).toEqual([
      topic.inside.title,
      topic.changes.title,
      topic.configure.title,
      "The same four steps as every air-gapped install",
      "Questions buyers ask",
      "The rest of OneUptime, air-gapped",
      "Bring us your network. Leave with an install plan.",
    ]);
  });

  test("shows what runs inside, each card with where to read more", () => {
    const section: Element = page.getElementById("inside")!;
    const cards: Array<Element> = all(
      section,
      '[data-testid="air-gapped-topic-capability"]',
    );

    expect(textOf(section.querySelector("h2 + p"))).toBe(
      plainText(topic.inside.lead),
    );
    expect(cards).toHaveLength(topic.inside.capabilities.length);

    topic.inside.capabilities.forEach(
      (capability: AirGappedTopicCapability, index: number) => {
        const card: Element = cards[index]!;

        expect(card.id).toBe(`capability-${capability.key}`);
        expect(textOf(card.querySelector("h3"))).toBe(capability.title);
        expect(textOf(card.querySelector("p"))).toBe(
          plainText(capability.description),
        );
        expect(codeIn(card.querySelector("p"))).toEqual(
          codeSpansOf(capability.description),
        );

        const link: Element = card.querySelector("a")!;

        expect(link.getAttribute("href")).toBe(capability.link.href);
        expect(textOf(link)).toBe(capability.link.label);
        expect(
          (card.querySelector("svg path")?.getAttribute("d") || "").length,
        ).toBeGreaterThan(10);
      },
    );
  });

  test("tables what changes: what it talks to, what to do inside, and what it takes", () => {
    const section: Element = page.getElementById("what-changes")!;
    const rows: Array<Element> = all(
      section,
      '[data-testid="air-gapped-topic-change"]',
    );

    expect(textOf(section.querySelector("h2 + p"))).toBe(
      plainText(topic.changes.lead),
    );
    expect(rows).toHaveLength(topic.changes.rows.length);

    topic.changes.rows.forEach(
      (change: AirGappedTopicChange, index: number) => {
        const row: Element = rows[index]!;

        expect(row.id).toBe(`change-${change.key}`);
        expect(textOf(row.querySelector("h3"))).toBe(change.name);
        expect(textOf(row)).toContain(plainText(change.usually));
        expect(textOf(row)).toContain(plainText(change.inside));
        // Settings, values and addresses are drawn as code, and nothing else.
        expect(codeIn(row)).toEqual([
          ...codeSpansOf(change.usually),
          ...codeSpansOf(change.inside),
        ]);

        const pill: Element = row.querySelector("[data-status]")!;

        expect(pill.getAttribute("data-status")).toBe(change.status);
        expect(textOf(pill)).toBe(STATUS_WORDS[change.status]);
      },
    );
  });

  test("names the table's columns from a tablet up, and each row's on a phone", () => {
    const header: Element = page.querySelector(
      '[data-testid="air-gapped-topic-changes-columns"]',
    )!;

    expect(header.getAttribute("aria-hidden")).toBe("true");
    expect(all(header, "span").map(textOf)).toEqual([
      "Feature",
      "Inside an air gap",
      "What it takes",
    ]);
    expect(header.className.split(" ")).toEqual(
      expect.arrayContaining(["max-md:hidden", "md:grid"]),
    );
    expect(header.className.split(" ")).not.toContain("hidden");

    for (const row of all(page, '[data-testid="air-gapped-topic-change"]')) {
      expect(all(row, ".md\\:hidden").map(textOf)).toEqual([
        "Inside an air gap:",
      ]);
    }
  });

  test("sends a reader on to every connection a self-hosted install makes", () => {
    const more: Element = page.querySelector(
      '[data-testid="air-gapped-topic-changes-more"]',
    )!;

    expect(more.querySelector("a")?.getAttribute("href")).toBe(
      "/enterprise/air-gapped#connections-out",
    );
  });

  test("numbers what to configure, in order", () => {
    const section: Element = page.getElementById("configure")!;
    const steps: Array<Element> = all(
      section,
      'ol [data-testid="air-gapped-topic-configure-step"]',
    );

    expect(textOf(section.querySelector("h2 + p"))).toBe(
      plainText(topic.configure.lead),
    );
    expect(steps).toHaveLength(topic.configure.steps.length);

    topic.configure.steps.forEach(
      (step: AirGappedTopicConfigureStep, index: number) => {
        expect(textOf(steps[index])).toBe(
          `${index + 1} ${step.title} ${plainText(step.description)}`,
        );
        expect(codeIn(steps[index])).toEqual(codeSpansOf(step.description));
      },
    );
  });

  test("shows the code exactly as it is written, in a block a keyboard can scroll", () => {
    const panel: Element = page.querySelector(
      '[data-testid="air-gapped-topic-configure-code"]',
    )!;

    // What a reader copies is what the docs and the chart give, character for character.
    expect(panel.querySelector("pre")?.textContent).toBe(
      topic.configure.code.text,
    );
    expect(textOf(panel)).toContain(topic.configure.code.label);

    const scroller: Element = panel.querySelector(".ag-scroll")!;

    expect(scroller.getAttribute("tabindex")).toBe("0");
    expect(scroller.getAttribute("role")).toBe("region");
    expect(scroller.getAttribute("aria-label")).toBe(
      topic.configure.code.ariaLabel,
    );
  });

  test("sets each value in the code off in colour from what names it", () => {
    const { separator, text } = topic.configure.code;
    const panel: Element = page.querySelector(
      '[data-testid="air-gapped-topic-configure-code"]',
    )!;

    expect(all(panel, "pre span").map(textOf)).toEqual(
      text
        .split("\n")
        .filter((line: string): boolean => {
          const at: number = line.indexOf(separator);

          return at !== -1 && at + separator.length < line.length;
        })
        .map((line: string): string => {
          return textOf(
            documentOf(
              `<p>${line
                .slice(line.indexOf(separator) + separator.length)
                .split("<")
                .join("&lt;")}</p>`,
            ).querySelector("p"),
          );
        }),
    );
  });

  test("captions the code, and says where to read on", () => {
    const section: Element = page.getElementById("configure")!;
    const caption: Element = section.querySelector(
      '[data-testid="air-gapped-topic-configure-caption"]',
    )!;

    expect(textOf(caption)).toBe(plainText(topic.configure.caption));
    expect(codeIn(caption)).toEqual(codeSpansOf(topic.configure.caption));

    const link: Element = caption.nextElementSibling!;

    expect(link.getAttribute("href")).toBe(topic.configure.link.href);
    expect(textOf(link)).toBe(topic.configure.link.label);
  });

  test("leads into the hub's four steps, each landing on its step", () => {
    const section: Element = page.getElementById("install")!;
    const steps: Array<Element> = all(
      section,
      '[data-testid="air-gapped-topic-install-step"] a',
    );

    expect(textOf(section.querySelector("h2 + p"))).toBe(
      plainText(topic.installNote),
    );
    expect(steps).toHaveLength(4);

    for (const step of steps) {
      const href: string = step.getAttribute("href")!;

      expect(href.startsWith("/enterprise/air-gapped#step-")).toBe(true);

      const anchor: string = href.slice(href.indexOf("#") + 1);

      expect(hub.getElementById(anchor)?.querySelector("h3")).not.toBeNull();
      expect(textOf(step)).toContain(
        textOf(hub.getElementById(anchor)?.querySelector("h3")),
      );
    }
  });

  test("answers the questions buyers ask, folded, and the same answers for search engines", () => {
    const questions: Array<Element> = all(
      page,
      '[data-testid="air-gapped-topic-faq"]',
    );

    expect(
      questions.map((question: Element): [string, string] => {
        return [
          textOf(question.querySelector("summary")),
          textOf(question.querySelector("p")),
        ];
      }),
    ).toEqual(
      topic.faqs.map((faq: AirGappedTopicFaq): [string, string] => {
        return [faq.question, plainText(faq.answer)];
      }),
    );

    for (const question of questions) {
      expect(question.tagName).toBe("DETAILS");
      expect(question.hasAttribute("open")).toBe(false);
    }

    expect(
      questions.map((question: Element): Array<string> => {
        return codeIn(question.querySelector("p"));
      }),
    ).toEqual(
      topic.faqs.map((faq: AirGappedTopicFaq): Array<string> => {
        return codeSpansOf(faq.answer);
      }),
    );

    const schema: { mainEntity: Array<Record<string, unknown>> } = all(
      page,
      'script[type="application/ld+json"]',
    )
      .map((script: Element) => {
        return JSON.parse(script.textContent || "{}");
      })
      .find((entry: Record<string, unknown>) => {
        return entry["@type"] === "FAQPage";
      });

    expect(schema.mainEntity).toEqual(
      topic.faqs.map((faq: AirGappedTopicFaq) => {
        return {
          "@type": "Question",
          name: faq.question,
          // Plain words for a search result: no backticks.
          acceptedAnswer: { "@type": "Answer", text: plainText(faq.answer) },
        };
      }),
    );
    expect(JSON.stringify(schema)).not.toContain("`");
  });

  test("leads to the pages beside it, and to the hub", () => {
    const section: Element = page.getElementById("related")!;
    const cards: Array<Element> = all(
      section,
      '[data-testid="air-gapped-topic-related"] a',
    );

    expect(
      cards.map((card: Element): string => {
        return card.getAttribute("href") || "";
      }),
    ).toEqual(
      topic.relatedSlugs.map((slug: AirGappedTopicSlug): string => {
        return getAirGappedTopicPage(slug).path;
      }),
    );

    topic.relatedSlugs.forEach((slug: AirGappedTopicSlug, index: number) => {
      const card: AirGappedTopicCard = getAirGappedTopicCard(slug);

      expect(textOf(cards[index])).toBe(`${card.title} ${card.summary}`);
      expect(cards[index]!.querySelector("path")?.getAttribute("d")).toBe(
        card.iconPath,
      );
    });

    expect(
      section.querySelector('a[href="/enterprise/air-gapped"]'),
    ).not.toBeNull();
  });

  test("closes on the booking, the product page and an email address", () => {
    const section: Element = page.getElementById("plan-your-install")!;
    const book: Element = section.querySelector(`a[href="${BOOKING}"]`)!;
    const product: Element = section.querySelector(
      `a[href="${topic.product.href}"]`,
    )!;

    expect(textOf(book)).toBe("Pick a time");
    expect(textOf(product)).toBe(topic.product.label);
    expect(
      section.querySelector('a[href^="mailto:"]')?.getAttribute("href"),
    ).toBe("mailto:enterprise@oneuptime.com");
  });

  test("tags every link to the booking, so each click counts", () => {
    const toBooking: Array<Element> = all(page, `a[href="${BOOKING}"]`);

    // The hero, the bar that follows the reader, and the close.
    expect(toBooking).toHaveLength(3);

    for (const link of toBooking) {
      expect(link.getAttribute("data-ou-cta")).toBe("cta_request_demo");
    }
  });

  test("books on the hub alone: one calendar, one measured conversation", () => {
    expect(html).not.toContain("my-cal-inline");
    expect(html).not.toContain('Cal("inline"');
    expect(html).not.toContain("app.cal.com/embed/embed.js");
    expect(html).not.toContain("window.oneUptimeTrackMeetingBooked({");
  });

  test("links only to real places: routes, docs pages at their headings, and the hub's anchors", () => {
    const links: Array<Element> = all(main, "a[href]");

    expect(links.length).toBeGreaterThan(15);

    for (const link of links) {
      const href: string = link.getAttribute("href")!;

      expect([href, problemWithLink(page, href, hub)]).toEqual([href, null]);
    }
  });

  test("loads no image and no script from anywhere but the site", () => {
    expect(all(main, "img")).toHaveLength(0);

    for (const script of all(page, "script[src]")) {
      expect(script.getAttribute("src")!.startsWith("/")).toBe(true);
    }
  });

  test("draws code in the monospace font, even inside it, and lands each jump under the bar", () => {
    const style: string = all(page, "head style")
      .map((element: Element): string => {
        return element.textContent || "";
      })
      .join("\n");

    expect(style).toContain(".ag-code * {\n      font-family: inherit;");
    expect(style).toContain("scroll-margin-top: 2.875rem;");
  });
});

describe("the family of pages", () => {
  test("is the twelve products a buyer asks about, each at its own address", () => {
    expect(
      AirGappedTopicPages.map((page: AirGappedTopicPage): string => {
        return page.slug;
      }),
    ).toEqual([
      "observability",
      "log-management",
      "monitoring",
      "incident-management",
      "on-call",
      "status-pages",
      "kubernetes",
      "network-monitoring",
      "infrastructure",
      "ai",
      "security-events",
      "workflows",
    ]);

    for (const page of AirGappedTopicPages) {
      expect(page.path).toBe(`/enterprise/air-gapped/${page.slug}`);
    }

    expect(AIR_GAPPED_TOPIC_PATHS).toEqual(
      AirGappedTopicPages.map((page: AirGappedTopicPage): string => {
        return page.path;
      }),
    );
  });

  test.each(eachPage)(
    "%s has everything the template draws, in the amounts its grids need",
    (_slug: string, page: AirGappedTopicPage) => {
      expect(page.proofPoints).toHaveLength(4);
      // Three columns on a laptop and two on a tablet: six leave no gap.
      expect(page.inside.capabilities).toHaveLength(6);
      expect(page.configure.steps).toHaveLength(3);
      expect(page.relatedSlugs).toHaveLength(3);
      expect(page.changes.rows.length).toBeGreaterThanOrEqual(3);
      expect(page.faqs.length).toBeGreaterThanOrEqual(3);
      expect(page.flow.from.items.length).toBeGreaterThanOrEqual(3);
      expect(page.flow.to.items.length).toBeGreaterThanOrEqual(3);
      expect(page.flow.oneUptime.items).toHaveLength(3);
      expect(page.productPaths.length).toBeGreaterThan(0);
    },
  );

  test.each(eachPage)(
    "%s keeps its keys unique, so every row and card has its own anchor",
    (_slug: string, page: AirGappedTopicPage) => {
      for (const keys of [
        page.inside.capabilities.map(
          (entry: AirGappedTopicCapability): string => {
            return entry.key;
          },
        ),
        page.changes.rows.map((entry: AirGappedTopicChange): string => {
          return entry.key;
        }),
        page.configure.steps.map(
          (entry: AirGappedTopicConfigureStep): string => {
            return entry.key;
          },
        ),
      ]) {
        expect(new Set<string>(keys).size).toBe(keys.length);
      }
    },
  );

  test.each(eachPage)(
    "%s opens and closes every code span it writes",
    (_slug: string, page: AirGappedTopicPage) => {
      const { code, ...configure } = page.configure;
      // The code block is drawn as it is: only the sentences hold code marks.
      const strings: Array<string> = stringsOf({
        ...page,
        configure,
        codeLabel: code.label,
      });

      expect(strings.length).toBeGreaterThan(40);

      for (const text of strings) {
        const backticks: number = text.split("`").length - 1;

        expect([text, backticks % 2]).toEqual([text, 0]);
        expect([text, text.includes("``")]).toEqual([text, false]);
      }
    },
  );

  test.each(eachPage)(
    "%s fits a search result, leads with what buyers search for, and names itself",
    (_slug: string, page: AirGappedTopicPage) => {
      const seo: PageSEOData = PageSEOConfig[page.path]!;

      expect(seo.title).toBe(page.seo.title);
      expect(seo.description).toBe(page.seo.description);
      expect(seo.title.length).toBeLessThanOrEqual(60);
      expect(seo.description.length).toBeLessThanOrEqual(160);
      expect(seo.description.length).toBeGreaterThan(100);
      expect(seo.title.startsWith("Air-Gapped ")).toBe(true);
      expect(seo.title.endsWith(" | OneUptime")).toBe(true);
      expect(seo.description.toLowerCase()).toContain("no internet");
      expect(page.title.startsWith("Air-gapped ")).toBe(true);
    },
  );

  test.each(eachPage)(
    "%s is an enterprise page, under Air-Gapped in its breadcrumb trail",
    (_slug: string, page: AirGappedTopicPage) => {
      const seo: PageSEOData = PageSEOConfig[page.path]!;

      expect(seo.canonicalPath).toBe(page.path);
      expect(seo.pageType).toBe("enterprise");
      expect(seo.softwareApplication).toBeUndefined();
      expect(
        seo.breadcrumbs.map((crumb: { name: string; url: string }): string => {
          return `${crumb.name} ${crumb.url}`;
        }),
      ).toEqual([
        "Home /",
        "Enterprise /enterprise/overview",
        "Self-Hosted /enterprise/self-hosted",
        "Air-Gapped /enterprise/air-gapped",
        `${page.name} ${page.path}`,
      ]);
    },
  );

  test("no two pages share a title, a description, a heading or a summary", () => {
    for (const read of [
      (page: AirGappedTopicPage): string => {
        return page.seo.title;
      },
      (page: AirGappedTopicPage): string => {
        return page.seo.description;
      },
      (page: AirGappedTopicPage): string => {
        return `${page.headline} ${page.headlineContinued}`;
      },
      (page: AirGappedTopicPage): string => {
        return page.summary;
      },
      (page: AirGappedTopicPage): string => {
        return page.title;
      },
      (page: AirGappedTopicPage): string => {
        return page.lead;
      },
    ]) {
      const values: Array<string> = AirGappedTopicPages.map(read);

      expect(new Set<string>(values).size).toBe(values.length);
    }
  });

  test("no page's title or description repeats another page's on the site", () => {
    const titles: Array<string> = Object.values(PageSEOConfig).map(
      (seo: PageSEOData): string => {
        return seo.title;
      },
    );

    for (const page of AirGappedTopicPages) {
      expect(
        titles.filter((title: string): boolean => {
          return title === page.seo.title;
        }),
      ).toHaveLength(1);
    }
  });

  test("every page is beside other pages, and none is beside itself or left out", () => {
    const linkedTo: Set<AirGappedTopicSlug> = new Set<AirGappedTopicSlug>();

    for (const page of AirGappedTopicPages) {
      expect(page.relatedSlugs).not.toContain(page.slug);
      expect(new Set<string>(page.relatedSlugs).size).toBe(
        page.relatedSlugs.length,
      );

      for (const slug of page.relatedSlugs) {
        linkedTo.add(slug);
      }
    }

    expect(linkedTo.size).toBe(AirGappedTopicPages.length);
  });

  test("every status a row uses is a status the template draws", () => {
    const source: string = fs.readFileSync(
      path.join(VIEWS_ROOT, "air-gapped-topic.ejs"),
      "utf8",
    );

    for (const [status, words] of Object.entries(STATUS_WORDS)) {
      expect(source).toContain(`'${status}': { label: '${words}'`);
    }
  });

  test("the rows that need a route are the pages' honest part, and every kind appears", () => {
    const rows: Array<AirGappedTopicChange> = AirGappedTopicPages.flatMap(
      (page: AirGappedTopicPage): Array<AirGappedTopicChange> => {
        return page.changes.rows;
      },
    );

    for (const status of Object.keys(STATUS_WORDS)) {
      expect(
        rows.filter((row: AirGappedTopicChange): boolean => {
          return row.status === status;
        }).length,
      ).toBeGreaterThan(0);
    }
  });

  test("the monitoring page's count of what changes is its table's", () => {
    const page: AirGappedTopicPage = getAirGappedTopicPage("monitoring");
    const count: (status: AirGappedTopicChangeStatus) => number = (
      status: AirGappedTopicChangeStatus,
    ): number => {
      return page.changes.rows.filter((row: AirGappedTopicChange): boolean => {
        return row.status === status;
      }).length;
    };

    expect(page.changes.lead).toBe(
      "Two settings to change, three swaps, and one monitor that needs the public internet whatever you do.",
    );
    expect(count("change-a-setting")).toBe(2);
    expect(count("use-your-own")).toBe(3);
    expect(count("needs-a-route")).toBe(1);
  });

  test("the on-call page's lead names exactly the rows that need a route", () => {
    const page: AirGappedTopicPage = getAirGappedTopicPage("on-call");

    expect(
      page.changes.rows
        .filter((row: AirGappedTopicChange): boolean => {
          return row.status === "needs-a-route";
        })
        .map((row: AirGappedTopicChange): string => {
          return row.key;
        }),
    ).toEqual(["push", "whatsapp-telegram", "incoming-calls"]);
    expect(page.changes.lead).toContain(
      "Push, WhatsApp, Telegram and incoming calls need a route to their service.",
    );
  });

  test("promises no certificate, percentage, customer or guarantee, and writes in the site's own register", () => {
    const text: string = JSON.stringify(
      AirGappedTopicPages.map((page: AirGappedTopicPage) => {
        return { ...page, configure: { ...page.configure, code: undefined } };
      }),
    );

    expect(text).not.toMatch(/\bcertified\b/i);
    expect(text).not.toMatch(/\d\s*%/);
    expect(text).not.toMatch(/\bcustomers\b/i);
    expect(text).not.toMatch(/FedRAMP/i);
    expect(text).not.toMatch(/guarantee/i);
    expect(text).not.toMatch(/\bcompliant\b/i);
    expect(text).not.toMatch(
      /world-class|best-in-class|seamless|cutting-edge/i,
    );
    // The site writes colons and commas where a machine writes dashes.
    expect(text).not.toContain("—");
  });

  test("every icon a page names is one the module draws, each a real path", () => {
    const names: Array<AirGappedIconName> = AirGappedTopicPages.flatMap(
      (page: AirGappedTopicPage): Array<AirGappedIconName> => {
        return [
          page.icon,
          ...page.flow.from.items.map((item: AirGappedTopicFlowItem) => {
            return item.icon;
          }),
          ...page.flow.to.items.map((item: AirGappedTopicFlowItem) => {
            return item.icon;
          }),
          ...page.flow.oneUptime.items.map(
            (item: { icon: AirGappedIconName }) => {
              return item.icon;
            },
          ),
          ...page.inside.capabilities.map(
            (capability: AirGappedTopicCapability) => {
              return capability.icon;
            },
          ),
        ];
      },
    );

    for (const name of names) {
      expect([name, typeof AirGappedIcons[name]]).toEqual([name, "string"]);
    }

    for (const [name, icon] of Object.entries(AirGappedIcons)) {
      expect([
        name,
        icon.toLowerCase().startsWith("m"),
        icon.length > 10,
      ]).toEqual([name, true, true]);
    }
  });

  test("every card's link to read more goes into the docs", () => {
    for (const page of AirGappedTopicPages) {
      for (const capability of page.inside.capabilities) {
        expect([
          capability.key,
          capability.link.href.startsWith("/docs/"),
        ]).toEqual([capability.key, true]);
      }

      expect(page.configure.link.href.startsWith("/docs/")).toBe(true);
    }
  });

  test("each page leads back to its own product, a page the site serves", () => {
    for (const page of AirGappedTopicPages) {
      expect([
        page.product.href,
        bodyOfGetRoute(page.product.href) !== null,
      ]).toEqual([page.product.href, true]);
      expect(page.productPaths).toContain(page.product.href);
    }
  });
});

describe("reading the family", () => {
  test("a slug finds its page, and a slug no page has says so", () => {
    expect(getAirGappedTopicPage("on-call").name).toBe("On-Call");
    expect((): void => {
      getAirGappedTopicPage("no-such-page" as AirGappedTopicSlug);
    }).toThrow("No air-gapped page for no-such-page");
  });

  test("an address finds its page's slug, and any other address finds none", () => {
    expect(
      getAirGappedTopicSlugForPath("/enterprise/air-gapped/observability"),
    ).toBe("observability");
    expect(getAirGappedTopicSlugForPath("/enterprise/air-gapped")).toBe(
      undefined,
    );
    expect(getAirGappedTopicSlugForPath("/enterprise/air-gapped/nope")).toBe(
      undefined,
    );
    expect(getAirGappedTopicSlugForPath("")).toBe(undefined);
  });

  test("the cards are the pages, in the pages' order, each with its icon drawn", () => {
    const cards: Array<AirGappedTopicCard> = getAirGappedTopicCards();

    expect(cards).toHaveLength(AirGappedTopicPages.length);

    AirGappedTopicPages.forEach((page: AirGappedTopicPage, index: number) => {
      expect(cards[index]).toEqual({
        slug: page.slug,
        path: page.path,
        title: page.title,
        name: page.name,
        summary: page.summary,
        iconPath: AirGappedIcons[page.icon],
      });
      expect(getAirGappedTopicCard(page.slug)).toEqual(cards[index]);
    });
  });
});

describe("the product pages that lead here", () => {
  const links: Record<string, AirGappedProductLink> =
    getAirGappedProductLinks();

  // The view a route renders: the page a product's address is.
  const viewOf: (productPath: string) => string = (
    productPath: string,
  ): string => {
    const body: string = bodyOfGetRoute(productPath)!;
    const start: number =
      body.indexOf("${ViewsPath}/") + "${ViewsPath}/".length;
    const name: string = body.slice(start, body.indexOf("`", start));

    return name.endsWith(".ejs") ? name : `${name}.ejs`;
  };

  test("no product page leads to two air-gapped pages", () => {
    const paths: Array<string> = AirGappedTopicPages.flatMap(
      (page: AirGappedTopicPage): Array<string> => {
        return page.productPaths;
      },
    );

    expect(new Set<string>(paths).size).toBe(paths.length);
    expect(Object.keys(links).sort()).toEqual(paths.slice().sort());
  });

  test.each(Object.keys(links))(
    "%s is a page the site serves, with the block that carries the link",
    (productPath: string) => {
      expect(bodyOfGetRoute(productPath)).not.toBeNull();
      expect(
        fs.readFileSync(path.join(VIEWS_ROOT, viewOf(productPath)), "utf8"),
      ).toContain("./Partials/enterprise-ready");
    },
  );

  test("the routes hand every page the links, as they hand it the stylesheet's address", () => {
    expect(routesSource).toContain(
      'app.locals["airGappedProductLinks"] = getAirGappedProductLinks();',
    );
  });

  test("a mapped product page says it can run with no internet, and links its page", async () => {
    const html: string = await renderView("on-call.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/on-call"),
      homeUrl: HOME_URL,
      airGappedProductLinks: links,
    });
    const pointer: Element = documentOf(html).querySelector(
      '[data-testid="enterprise-ready-air-gapped"]',
    )!;

    expect(textOf(pointer)).toBe(
      "Running with no internet connection? Air-gapped on-call",
    );
    expect(pointer.querySelector("a")?.getAttribute("href")).toBe(
      "/enterprise/air-gapped/on-call",
    );
  });

  test.each(Object.entries(links))(
    "the block on %s names that product's page",
    async (productPath: string, link: AirGappedProductLink) => {
      const html: string = await renderView("Partials/enterprise-ready.ejs", {
        seo: { canonicalPath: productPath },
        airGappedProductLinks: links,
      });
      const pointer: Element = documentOf(html).querySelector(
        '[data-testid="enterprise-ready-air-gapped"]',
      )!;

      expect(textOf(pointer.querySelector("a"))).toBe(link.title);
      expect(pointer.querySelector("a")?.getAttribute("href")).toBe(link.href);
    },
  );

  test("a page with no air-gapped page shows no pointer", async () => {
    const html: string = await renderView("Partials/enterprise-ready.ejs", {
      seo: { canonicalPath: "/product/serverless" },
      airGappedProductLinks: links,
    });

    expect(html).not.toContain("enterprise-ready-air-gapped");
  });

  test("a page rendered without the links, or without SEO data, still renders", async () => {
    const withoutLinks: string = await renderView(
      "Partials/enterprise-ready.ejs",
      { seo: { canonicalPath: "/product/on-call" } },
    );
    const withoutSeo: string = await renderView(
      "Partials/enterprise-ready.ejs",
      { airGappedProductLinks: links },
    );

    for (const html of [withoutLinks, withoutSeo]) {
      expect(html).toContain("enterprise-ready-title");
      expect(html).not.toContain("enterprise-ready-air-gapped");
    }
  });
});

describe("the footer's air-gapped list", () => {
  let footer: Element;

  beforeAll(async () => {
    footer = documentOf(await renderHub()).querySelector("footer")!;
  });

  test("leads to the pages buyers ask for first, and to the rest", () => {
    const heading: Element = all(footer, "h3").find(
      (element: Element): boolean => {
        return textOf(element) === "Air-Gapped";
      },
    )!;
    const hrefs: Array<string> = all(heading.parentElement!, "a").map(
      (link: Element): string => {
        return link.getAttribute("href")!;
      },
    );

    expect(hrefs).toEqual([
      "/enterprise/air-gapped/observability",
      "/enterprise/air-gapped/monitoring",
      "/enterprise/air-gapped/incident-management",
      "/enterprise/air-gapped/on-call",
      "/enterprise/air-gapped/status-pages",
      "/enterprise/air-gapped/kubernetes",
      "/enterprise/air-gapped#by-product",
    ]);
  });

  test("names a page that exists at every address, and an anchor the hub has", async () => {
    const hub: Document = documentOf(await renderHub());

    for (const link of all(footer, 'a[href^="/enterprise/air-gapped"]')) {
      const href: string = link.getAttribute("href")!;

      expect([href, problemWithLink(hub, href, hub)]).toEqual([href, null]);
    }
  });
});
