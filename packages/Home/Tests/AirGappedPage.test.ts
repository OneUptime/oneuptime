import PageSEOConfig, { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import {
  AIR_GAPPED_LLM_PROVIDER_ENV,
  AIR_GAPPED_VALUES_YAML,
  AirGappedAudience,
  AirGappedCapability,
  AirGappedCompliancePoint,
  AirGappedConnection,
  AirGappedFaq,
  AirGappedNetworkItem,
  AirGappedPageContent,
  AirGappedStep,
  CHART_SIGNING_KEY_URL,
  getAirGappedContent,
  plainText,
} from "../Utils/AirGapped";
import { getSelfHostedContent } from "../Utils/SelfHosted";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * THE AIR-GAPPED PAGE, RENDERED.
 *
 * The real template with the locals Routes.ts hands it, read back as a
 * browser would: what each section says (all of it from Utils/AirGapped.ts,
 * whose facts Tests/AirGappedFacts.test.ts holds to the repository), that
 * every link goes somewhere real - a route of this site, a docs page at a
 * heading it has, an anchor on the page, or an outside page opened in a new
 * tab - that the headings read in order for a screen reader, that the
 * booking is the architecture assessment the CRM knows, and that the menus,
 * the footer and the pages buyers come from lead here.
 */

const HOME: string = path.join(__dirname, "..");
const VIEWS_ROOT: string = path.join(HOME, "Views");
const DOCS_CONTENT: string = path.join(
  HOME,
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);
const HOME_URL: string = "https://oneuptime.com";
const PAGE_PATH: string = "/enterprise/air-gapped";

const routesSource: string = fs.readFileSync(
  path.join(HOME, "Routes.ts"),
  "utf8",
);

type SEOForTemplate = PageSEOData & { fullCanonicalUrl: string };

function seoFor(pagePath: string): SEOForTemplate {
  const seo: PageSEOData = getPageSEO(pagePath);

  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

async function renderView(
  template: string,
  locals: Record<string, unknown>,
): Promise<string> {
  return (await ejs.renderFile(path.join(VIEWS_ROOT, template), locals, {
    views: [VIEWS_ROOT],
  })) as string;
}

// Exactly the locals Routes.ts hands the page, plus homeUrl.
async function renderPage(
  content: AirGappedPageContent = getAirGappedContent(),
): Promise<string> {
  return renderView("air-gapped.ejs", {
    enableGoogleTagManager: false,
    seo: seoFor(PAGE_PATH),
    airGapped: content,
    homeUrl: HOME_URL,
  });
}

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent || "").split(/\s+/).join(" ").trim();
}

function all(root: ParentNode, selector: string): Array<Element> {
  return Array.from(root.querySelectorAll(selector));
}

/*
 * The spans of a string that the page draws as code: the words between each
 * pair of backticks (Utils/AirGapped.ts, "Code inside a sentence").
 */
function codeSpansOf(text: string): Array<string> {
  return text.split("`").filter((_part: string, index: number): boolean => {
    return index % 2 === 1;
  });
}

// What an element draws as code, in order.
function codeIn(element: Element | null | undefined): Array<string> {
  return element ? all(element, "code").map(textOf) : [];
}

// Every string of the page's content, wherever it sits in it.
function stringsOf(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(stringsOf);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringsOf);
  }

  return [];
}

// Is `routePath` the first argument of an app.get( in Routes.ts?
function hasGetRoute(routePath: string): boolean {
  const declaration: string = `"${routePath}"`;
  let searchFrom: number = 0;

  while (searchFrom < routesSource.length) {
    const index: number = routesSource.indexOf(declaration, searchFrom);

    if (index === -1) {
      return false;
    }

    if (
      routesSource
        .slice(Math.max(0, index - 40), index)
        .trim()
        .endsWith("app.get(")
    ) {
      return true;
    }

    searchFrom = index + declaration.length;
  }

  return false;
}

/*
 * A markdown heading's text ("## Webhooks" -> "Webhooks"), or null for a
 * line that is no heading. Read with string steps rather than a pattern, so
 * it stays linear in the line's length.
 */
function headingText(line: string): string | null {
  let level: number = 0;

  while (level < line.length && line[level] === "#") {
    level++;
  }

  if (
    level === 0 ||
    level > 6 ||
    (line[level] !== " " && line[level] !== "\t")
  ) {
    return null;
  }

  let text: string = line.slice(level).trim();

  // A closing run of #s is not part of the heading.
  while (text.endsWith("#")) {
    text = text.slice(0, -1);
  }

  text = text.trim();

  return text === "" ? null : text;
}

// The anchors a docs page answers to: its headings, slugged as the docs do.
function docsAnchors(markdownFile: string): Set<string> {
  const anchors: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of fs.readFileSync(markdownFile, "utf8").split("\n")) {
    const trimmed: string = line.trimStart();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }

    const heading: string | null = inFence ? null : headingText(line);

    if (heading) {
      anchors.add(slugifyMarkdownHeading(heading));
    }
  }

  return anchors;
}

/*
 * Where a link goes, checked: a docs page at a heading it has, a route of
 * this site, an anchor of this page, or an outside page.
 */
function problemWithLink(page: Document, href: string): string | null {
  if (href.startsWith("#")) {
    return page.getElementById(href.slice(1)) ? null : "no such anchor";
  }

  if (href.startsWith("mailto:") || href.startsWith("https://")) {
    return null;
  }

  const [address, anchor] = href.split("#") as [string, string | undefined];

  if (address.startsWith("/docs/")) {
    const file: string = path.join(
      DOCS_CONTENT,
      `${address.slice("/docs/".length)}.md`,
    );

    if (!fs.existsSync(file)) {
      return "no such docs page";
    }

    return anchor && !docsAnchors(file).has(anchor)
      ? "no such heading on the docs page"
      : null;
  }

  return hasGetRoute(address) ? null : "no route";
}

describe("the air-gapped page", () => {
  let html: string;
  let page: Document;
  let main: Element;
  const content: AirGappedPageContent = getAirGappedContent();

  beforeAll(async () => {
    html = await renderPage();
    page = documentOf(html);
    main = page.getElementById("main-content")!;
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
    const seo: SEOForTemplate = seoFor(PAGE_PATH);

    expect(page.title).toBe(seo.title);
    expect(
      page.querySelector('meta[name="description"]')?.getAttribute("content"),
    ).toBe(seo.description);
    expect(
      page.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe(`${HOME_URL}${PAGE_PATH}`);
  });

  test("leads with one heading that says what the page is for", () => {
    const headings: Array<Element> = all(page, "h1");

    expect(headings).toHaveLength(1);
    expect(textOf(headings[0])).toBe(
      "Run OneUptime with no internet connection.",
    );
    expect(headings[0]!.id).toBe("air-gapped-title");
  });

  test("offers the two things a visitor comes for: planning an install, and the steps", () => {
    const hero: Element = page.getElementById("air-gapped-hero")!;
    const plan: Element | null = hero.querySelector(
      'a[href="#plan-your-install"]',
    );
    const steps: Element | null = hero.querySelector('a[href="#set-up"]');

    expect(textOf(plan)).toBe("Plan your air-gapped install");
    // Booking the assessment is the enterprise conversion: tagged, so it counts.
    expect(plan?.getAttribute("data-ou-cta")).toBe("cta_request_demo");
    expect(textOf(steps)).toBe("See the four steps");
    expect(page.getElementById("plan-your-install")).not.toBeNull();
    expect(page.getElementById("set-up")).not.toBeNull();
  });

  test("lists the proof points under the buttons, in order", () => {
    expect(
      all(page, '[data-testid="air-gapped-proof-points"] li').map(textOf),
    ).toEqual(content.proofPoints);
  });

  test("draws OneUptime and everything it uses inside one boundary: the customer's network", () => {
    const picture: Element = page.querySelector(
      '[data-testid="air-gapped-network"]',
    )!;
    const itemText: (item: AirGappedNetworkItem) => string = (
      item: AirGappedNetworkItem,
    ): string => {
      return `${item.label} ${item.detail}`;
    };

    expect(textOf(picture)).toContain("Your network");
    expect(textOf(picture)).toContain("No route to the internet needed");

    // The probes and datastores the chart runs are drawn inside OneUptime.
    const oneUptime: Element = picture.querySelector(
      '[data-testid="air-gapped-network-oneuptime"]',
    )!;

    expect(textOf(oneUptime.querySelector("p"))).toBe("OneUptime");
    expect(
      all(oneUptime, 'ul[aria-label="Runs in your cluster"] li').map(textOf),
    ).toEqual(content.network.runs.map(itemText));

    // The customer's own services are drawn beside it, under their own label.
    const yours: Element = picture.querySelector(
      'ul[aria-labelledby="air-gapped-network-yours"]',
    )!;

    expect(oneUptime.contains(yours)).toBe(false);
    expect(textOf(page.getElementById("air-gapped-network-yours"))).toBe(
      "Uses your own",
    );
    expect(all(yours, "li").map(textOf)).toEqual(
      content.network.yours.map(itemText),
    );

    // Every item has an icon the template draws.
    for (const path of all(picture, "li svg path")) {
      expect((path.getAttribute("d") || "").length).toBeGreaterThan(10);
    }
  });

  test("keeps the bar that follows the reader under the site's menus, here and on the self-hosted page", async () => {
    const zIndex: (element: Element | null) => number = (
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

    // A phone's menu is taller than the screen: scrolling it must not slide the bar over it.
    for (const menu of ["mobile-menu", "solutions-menu", "resources-menu"]) {
      expect([menu, zIndex(bar) < zIndex(page.getElementById(menu))]).toEqual([
        menu,
        true,
      ]);
    }

    const selfHosted: Document = documentOf(
      await renderView("self-hosted.ejs", {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: false,
        blackLogo: false,
        requestDemoCta: true,
        selfHosted: getSelfHostedContent(),
        seo: seoFor("/enterprise/self-hosted"),
        homeUrl: HOME_URL,
      }),
    );
    const selfHostedBar: Element | null =
      selfHosted
        .querySelector('a[href="#deployment-models"]')
        ?.closest(".sticky") || null;

    expect(zIndex(selfHostedBar)).toBeLessThan(
      zIndex(selfHosted.getElementById("mobile-menu")),
    );
  });

  test("keeps the button to the booking in the bar that follows the reader, from a tablet up", () => {
    const button: Element = page.querySelector(
      '[data-testid="air-gapped-nav-plan"]',
    )!;

    expect(button.getAttribute("href")).toBe("#plan-your-install");
    expect(textOf(button)).toBe("Plan your install");
    // Outside the list of sections, so a screen reader hears seven links there.
    expect(button.closest('nav[aria-label="On this page"]')).toBeNull();
    // Hidden on a phone without the bare `hidden` a foreign stylesheet overrides.
    expect(button.className.split(" ")).toEqual(
      expect.arrayContaining(["max-md:hidden", "md:inline-flex"]),
    );
    expect(button.className.split(" ")).not.toContain("hidden");
  });

  test("names each section in the bar that follows the reader, each link landing on its section", () => {
    const bar: Element = page.querySelector('nav[aria-label="On this page"]')!;
    const links: Array<[string, string]> = all(bar, "a").map(
      (link: Element): [string, string] => {
        return [textOf(link), link.getAttribute("href") || ""];
      },
    );

    expect(links).toEqual([
      ["Who it's for", "#who-its-for"],
      ["What runs inside", "#inside"],
      ["Set up", "#set-up"],
      ["Connections out", "#connections-out"],
      ["AI", "#ai"],
      ["Compliance", "#compliance"],
      ["FAQ", "#faq"],
    ]);

    for (const [, href] of links) {
      expect(page.getElementById(href.slice(1))?.tagName).toBe("SECTION");
    }
  });

  test("labels every section with its own heading", () => {
    const sections: Array<Element> = all(main, "section[id]");

    expect(
      sections.map((section: Element): string => {
        return section.id;
      }),
    ).toEqual([
      "air-gapped-hero",
      "who-its-for",
      "inside",
      "set-up",
      "connections-out",
      "ai",
      "compliance",
      "faq",
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
      "For networks that stay closed",
      "Everything runs inside your network",
      "Four steps to an air-gapped install",
      "What reaches out, and what to use instead",
      "OneUptime AI, on a model you run",
      "Your data, inside your boundary",
      "Questions buyers ask",
      "Bring us your network. Leave with an install plan.",
    ]);
  });

  test("says who it is for: one card per audience", () => {
    const cards: Array<Element> = all(
      page,
      '[data-testid="air-gapped-audience"]',
    );

    expect(
      cards.map((card: Element): string => {
        return textOf(card);
      }),
    ).toEqual(
      content.audiences.map((audience: AirGappedAudience): string => {
        return `${audience.title} ${audience.description}`;
      }),
    );
  });

  test("shows everything that runs inside, each card with where to read more", () => {
    const cards: Array<Element> = all(
      page,
      '[data-testid="air-gapped-capability"]',
    );

    expect(cards).toHaveLength(content.capabilities.length);

    content.capabilities.forEach(
      (capability: AirGappedCapability, index: number) => {
        const card: Element = cards[index]!;

        expect(textOf(card.querySelector("h3"))).toBe(capability.title);
        expect(textOf(card.querySelector("p"))).toBe(capability.description);

        const link: Element | null = card.querySelector("a");

        if (capability.link) {
          expect(link?.getAttribute("href")).toBe(capability.link.href);
          expect(textOf(link)).toBe(capability.link.label);
        } else {
          expect(link).toBeNull();
        }
      },
    );
  });

  test("numbers the four steps, in order, each with the settings it uses", () => {
    const steps: Array<Element> = all(
      page,
      'ol [data-testid="air-gapped-step"]',
    );

    expect(steps).toHaveLength(4);

    content.steps.forEach((step: AirGappedStep, index: number) => {
      const item: Element = steps[index]!;

      expect(item.id).toBe(`step-${step.key}`);
      expect(textOf(item.querySelector("span"))).toBe(String(index + 1));
      expect(textOf(item.querySelector("h3"))).toBe(step.title);
      expect(textOf(item.querySelector("p"))).toBe(plainText(step.description));
      // What the description writes as code is drawn as code.
      expect(codeIn(item.querySelector("p"))).toEqual(
        codeSpansOf(step.description),
      );
      // The settings the step uses, in their own row: none for a step with none.
      expect(
        codeIn(item.querySelector('[data-testid="air-gapped-step-settings"]')),
      ).toEqual(step.settings);

      if (step.link) {
        const link: Element | null = item.querySelector(
          `a[href="${step.link.href}"]`,
        );

        expect(textOf(link)).toContain(step.link.label);
      }
    });
  });

  test("names as code what a reader types: the settings each step uses, and none for licensing", () => {
    expect(
      content.steps.map((step: AirGappedStep): Array<string> => {
        return step.settings;
      }),
    ).toEqual([
      ["image.registry", "image.tag", "imagePullSecrets"],
      ["helm verify"],
      [
        "updateCheck.disabled",
        "instanceCheckIn.disabled",
        "dnsConfig.nameservers",
        "probes.one.allowPrivateNetworkMonitors",
        "webhooks.allowPrivateNetwork",
      ],
      // A license token is something we send, not a setting: no code chip.
      [],
    ]);
    // Every setting the third step names is a key of the values it shows.
    for (const setting of content.steps[2]!.settings) {
      const leaf: string = setting.split(".").pop()!;

      expect([setting, AIR_GAPPED_VALUES_YAML.includes(`${leaf}:`)]).toEqual([
        setting,
        true,
      ]);
    }
    // The licensing step still says where to read on, with no empty chip row.
    const licensing: Element = page.getElementById("step-license-offline")!;

    expect(
      licensing.querySelector('[data-testid="air-gapped-step-settings"] a'),
    ).not.toBeNull();
  });

  test("gives the chart's signing key fingerprint where the chart is brought in", () => {
    const key: Element = page.querySelector(
      '#step-bring-in-chart [data-testid="air-gapped-signing-key"]',
    )!;

    expect(all(key, "p.ag-code span").map(textOf)).toEqual(
      content.signingKey.fingerprintHalves,
    );
    // After the settings row, as in every other step.
    const settings: Element = page.querySelector(
      '#step-bring-in-chart [data-testid="air-gapped-step-settings"]',
    )!;

    expect(
      settings.compareDocumentPosition(key) & 4 /* FOLLOWING */,
    ).toBeTruthy();

    const link: Element | null = key.querySelector("a");

    expect(link?.getAttribute("href")).toBe(CHART_SIGNING_KEY_URL);
    expect(textOf(link)).toBe("OneUptime's public key (opens in a new tab)");
  });

  test("shows the values.yaml exactly as the chart's air-gapped suite renders it, with what the test proves", () => {
    const panel: Element = page.querySelector(
      '[data-testid="air-gapped-values"]',
    )!;

    expect(panel.querySelector("pre")?.textContent).toBe(
      AIR_GAPPED_VALUES_YAML,
    );
    expect(textOf(panel)).toContain("values.yaml");
    expect(textOf(panel.nextElementSibling)).toBe(content.valuesCaption);

    // Each value is set off in colour from the key that names it.
    expect(all(panel, "pre span").map(textOf)).toEqual(
      AIR_GAPPED_VALUES_YAML.split("\n")
        .filter((line: string): boolean => {
          return line.includes(": ");
        })
        .map((line: string): string => {
          return line.slice(line.indexOf(": ") + 2);
        }),
    );

    // A phone scrolls the long lines sideways: by keyboard too, and named.
    const scroller: Element = panel.querySelector(".ag-scroll")!;

    expect(scroller.getAttribute("tabindex")).toBe("0");
    expect(scroller.getAttribute("role")).toBe("region");
    expect(scroller.getAttribute("aria-label")).toBe(
      "values.yaml for an air-gapped install",
    );
  });

  test("says what the values change for an air-gapped cluster, private addresses included", () => {
    // On a network with no route out, every monitor target and webhook is private.
    expect(AIR_GAPPED_VALUES_YAML).toContain(
      "probes:\n  one:\n    allowPrivateNetworkMonitors: true",
    );
    expect(AIR_GAPPED_VALUES_YAML).toContain(
      "webhooks:\n  allowPrivateNetwork: true",
    );
    expect(content.steps[2]!.description).toContain(
      "let probes and webhooks reach private addresses",
    );
    expect(content.valuesCaption).toContain(
      "probes and webhooks may reach private addresses",
    );
  });

  test("says how upgrades work, linking the upgrade guide", () => {
    const upgrades: Element = page.querySelector(
      '[data-testid="air-gapped-upgrades"]',
    )!;

    // The note names itself ("Upgrades work the same way"): no label repeats it.
    expect(textOf(upgrades.querySelector("p"))).toBe(
      plainText(content.upgradeNote),
    );
    expect(textOf(upgrades)).not.toContain("Upgrades. Upgrades");
    expect(codeIn(upgrades)).toEqual(["helm upgrade"]);
    expect(upgrades.querySelector("a")?.getAttribute("href")).toBe(
      "/docs/installation/upgrading",
    );
  });

  test("lists every connection out, with when it happens and what to use inside the gap", () => {
    const rows: Array<Element> = all(
      page,
      '[data-testid="air-gapped-connection"]',
    );

    expect(rows).toHaveLength(content.connections.length);

    content.connections.forEach(
      (connection: AirGappedConnection, index: number) => {
        const row: Element = rows[index]!;

        expect(row.id).toBe(`connection-${connection.key}`);
        expect(textOf(row.querySelector("h4"))).toBe(connection.name);
        expect(textOf(row)).toContain(plainText(connection.destination));
        expect(textOf(row)).toContain(plainText(connection.when));
        expect(textOf(row)).toContain(plainText(connection.inside));
        // Settings, values and addresses are drawn as code, and nothing else.
        expect(codeIn(row)).toEqual([
          ...codeSpansOf(connection.destination),
          ...codeSpansOf(connection.when),
          ...codeSpansOf(connection.inside),
        ]);
      },
    );

    // What to set for the update check and the probes' DNS reads as code.
    expect(codeIn(page.getElementById("connection-update-check"))).toEqual([
      "api.github.com",
      "updateCheck.disabled: true",
      "updateCheck.url",
    ]);
    expect(codeIn(page.getElementById("connection-probe-dns"))).toEqual([
      "8.8.8.8",
      "1.1.1.1",
      "dnsConfig.nameservers",
      "[]",
    ]);
  });

  test("tables what reaches out by default apart from what reaches out once set up, each table named", () => {
    const groups: Array<[string, string, boolean]> = [
      ["on-by-default", "On by default", true],
      ["once-set-up", "Only once you set them up", false],
    ];

    for (const [key, title, onByDefault] of groups) {
      const group: Element = page.querySelector(
        `[data-testid="air-gapped-connections-${key}"]`,
      )!;
      const heading: Element = group.querySelector("h3")!;
      const list: Element = group.querySelector("ul")!;

      expect(textOf(heading)).toBe(title);
      expect(list.getAttribute("aria-labelledby")).toBe(heading.id);
      expect(
        all(group, '[data-testid="air-gapped-connection"]').map(
          (row: Element): string => {
            return row.id;
          },
        ),
      ).toEqual(
        content.connections
          .filter((connection: AirGappedConnection): boolean => {
            return connection.onByDefault === onByDefault;
          })
          .map((connection: AirGappedConnection): string => {
            return `connection-${connection.key}`;
          }),
      );
    }

    // The first table is the four the section's first sentence names.
    expect(
      all(
        page,
        '[data-testid="air-gapped-connections-on-by-default"] [data-testid="air-gapped-connection"]',
      ),
    ).toHaveLength(4);
    expect(
      textOf(page.querySelector("#connections-out h2 + p")).startsWith(
        "Four things reach out on their own unless you change a setting.",
      ),
    ).toBe(true);
  });

  test("says under the tables where the docs list each integration's addresses and the private-address settings", () => {
    const more: Element = page.querySelector(
      '[data-testid="air-gapped-connections-more"]',
    )!;

    // The settings themselves are in step 3 and its values.yaml now.
    expect(more.querySelector("code")).toBeNull();
    expect(
      all(more, "a").map((link: Element): string => {
        return `${textOf(link)} ${link.getAttribute("href")}`;
      }),
    ).toEqual([
      "connections out of your network /docs/self-hosted/architecture#connections-out-of-your-network",
      "private network access /docs/self-hosted/private-network-access",
    ]);
  });

  test("labels each connection's columns on a phone, and the table's columns from a tablet up", () => {
    const headers: Array<Element> = all(
      page,
      '[data-testid="air-gapped-connections-columns"]',
    );

    // One header row per table.
    expect(headers).toHaveLength(2);

    for (const header of headers) {
      expect(header.getAttribute("aria-hidden")).toBe("true");
      expect(all(header, "span").map(textOf)).toEqual([
        "Connection",
        "When",
        "Inside an air gap",
      ]);
      // Hidden on a phone without the bare `hidden` a foreign stylesheet overrides.
      expect(header.className.split(" ")).toEqual(
        expect.arrayContaining(["max-md:hidden", "md:grid"]),
      );
      expect(header.className.split(" ")).not.toContain("hidden");
    }

    for (const row of all(page, '[data-testid="air-gapped-connection"]')) {
      expect(all(row, ".md\\:hidden").map(textOf)).toEqual([
        "When:",
        "Inside an air gap:",
      ]);
    }

    // A phone reads "When: ...", so no cell starts by saying "When" again.
    for (const connection of content.connections) {
      expect([connection.key, connection.when.startsWith("When")]).toEqual([
        connection.key,
        false,
      ]);
    }
  });

  test("offers AI on a model the customer runs, with the server settings for it", () => {
    const section: Element = page.getElementById("ai")!;

    expect(
      all(section, '[data-testid="air-gapped-ai-option"]').map(textOf),
    ).toEqual(
      content.ai.options.map(
        (option: { title: string; description: string }) => {
          return `${option.title} ${option.description}`;
        },
      ),
    );
    expect(section.querySelector("pre")?.textContent).toBe(
      AIR_GAPPED_LLM_PROVIDER_ENV,
    );
    // Each value set off from its variable, and the block scrolls by keyboard.
    expect(all(section, "pre span").map(textOf)).toEqual([
      "Ollama",
      "http://ollama:11434",
      "llama3.1",
    ]);
    expect(section.querySelector(".ag-scroll")?.getAttribute("tabindex")).toBe(
      "0",
    );
    expect(textOf(section)).toContain(plainText(content.ai.setup));
    expect(
      codeIn(section.querySelector('[data-testid="air-gapped-ai-setup"]')),
    ).toEqual(["GLOBAL_LLM_PROVIDER_*"]);
    expect(textOf(section)).toContain(content.ai.safety);
    expect(
      section
        .querySelector('a[href^="/docs/ai/llm-provider"]')
        ?.getAttribute("href"),
    ).toBe(
      "/docs/ai/llm-provider#self-hosted-zero-config-via-environment-variables",
    );
  });

  test("says what stays inside for compliance, pointing at the claims matrix", () => {
    const section: Element = page.getElementById("compliance")!;

    expect(
      all(section, '[data-testid="air-gapped-compliance"]').map(textOf),
    ).toEqual(
      content.compliance.map((point: AirGappedCompliancePoint): string => {
        return `${point.title} ${point.description}`;
      }),
    );
    expect(section.querySelector('a[href="/trust#claims"]')).not.toBeNull();
    expect(
      section.querySelector('a[href="/enterprise/self-hosted"]'),
    ).not.toBeNull();
  });

  test("answers the questions buyers ask, folded, and the same answers for search engines", () => {
    const questions: Array<Element> = all(
      page,
      '[data-testid="air-gapped-faq"]',
    );

    expect(
      questions.map((question: Element): [string, string] => {
        return [
          textOf(question.querySelector("summary")),
          textOf(question.querySelector("p")),
        ];
      }),
    ).toEqual(
      content.faqs.map((faq: AirGappedFaq): [string, string] => {
        return [faq.question, plainText(faq.answer)];
      }),
    );

    for (const question of questions) {
      expect(question.tagName).toBe("DETAILS");
      expect(question.hasAttribute("open")).toBe(false);
    }

    // A setting or a command in an answer is drawn as code.
    expect(
      questions.map((question: Element): Array<string> => {
        return codeIn(question.querySelector("p"));
      }),
    ).toEqual(
      content.faqs.map((faq: AirGappedFaq): Array<string> => {
        return codeSpansOf(faq.answer);
      }),
    );

    const faqSchema: { mainEntity: Array<Record<string, unknown>> } = all(
      page,
      'script[type="application/ld+json"]',
    )
      .map((script: Element) => {
        return JSON.parse(script.textContent || "{}");
      })
      .find((schema: Record<string, unknown>) => {
        return schema["@type"] === "FAQPage";
      });

    expect(faqSchema.mainEntity).toEqual(
      content.faqs.map((faq: AirGappedFaq) => {
        return {
          "@type": "Question",
          name: faq.question,
          // Plain words for a search result: no backticks.
          acceptedAnswer: { "@type": "Answer", text: plainText(faq.answer) },
        };
      }),
    );
    expect(JSON.stringify(faqSchema)).not.toContain("`");
  });

  test("books the architecture assessment, the conversation the CRM knows, and offers email", () => {
    const section: Element = page.getElementById("plan-your-install")!;

    expect(
      all(section, '[data-testid="air-gapped-plan-topics"] li').map(textOf),
    ).toEqual(content.planCall.topics);
    expect(
      section.querySelector('a[href^="mailto:"]')?.getAttribute("href"),
    ).toBe(`mailto:${content.planCall.email}`);
    expect(page.getElementById("my-cal-inline-air-gapped")).not.toBeNull();

    for (const words of [
      'elementOrSelector: "#my-cal-inline-air-gapped"',
      'calLink: "oneuptimehq/demo"',
      "window.oneUptimeCalAttributionMetadata('architecture_assessment')",
      "window.oneUptimeOnCalBookingSuccess(",
      "bookingKind: 'architecture_assessment'",
      "legacyEventName: 'home/architecture-assessment-booked'",
    ]) {
      expect([words, html.includes(words)]).toEqual([words, true]);
    }

    // The attendee's name and email in Cal's detail never reach analytics.
    for (const words of [
      "const { data, type, namespace }",
      "'data': data",
      "detail.data,",
      "detail.data)",
    ]) {
      expect([words, html.includes(words)]).toEqual([words, false]);
    }
  });

  test("tags every link to the booking, so each click counts", () => {
    const toBooking: Array<Element> = all(page, 'a[href="#plan-your-install"]');

    expect(toBooking.length).toBeGreaterThan(0);

    for (const link of toBooking) {
      expect(link.getAttribute("data-ou-cta")).toBe("cta_request_demo");
    }
  });

  test("links only to real places: routes, docs pages at their headings, anchors, and outside pages", () => {
    const links: Array<Element> = all(main, "a[href]");

    expect(links.length).toBeGreaterThan(15);

    for (const link of links) {
      const href: string = link.getAttribute("href")!;

      expect([href, problemWithLink(page, href)]).toEqual([href, null]);
    }
  });

  test("opens every outside page in a new tab, and says so", () => {
    for (const link of all(main, 'a[href^="https://"]')) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect((link.getAttribute("rel") || "").split(" ").sort()).toEqual([
        "noopener",
        "noreferrer",
      ]);
      expect(textOf(link.querySelector(".sr-only"))).toBe(
        "(opens in a new tab)",
      );
    }
  });

  test("opens and closes every code span it writes, so no stray backtick turns a sentence into code", () => {
    const strings: Array<string> = stringsOf(content);

    expect(strings.length).toBeGreaterThan(100);

    for (const text of strings) {
      const backticks: number = text.split("`").length - 1;

      expect([text, backticks % 2]).toEqual([text, 0]);
      // And no empty span: two backticks side by side.
      expect([text, text.includes("``")]).toEqual([text, false]);
    }
  });

  test("draws code in the monospace font, even inside it (the site gives every element its sans-serif font)", () => {
    const style: string = all(page, "head style")
      .map((element: Element): string => {
        return element.textContent || "";
      })
      .join("\n");

    expect(style).toContain(".ag-code * {\n      font-family: inherit;");
  });

  test("lands each section the bar jumps to right under the bar", () => {
    const style: string = all(page, "head style")
      .map((element: Element): string => {
        return element.textContent || "";
      })
      .join("\n");

    expect(style).toContain("scroll-margin-top: 2.875rem;");
  });

  test("loads no image and no script from anywhere but the site and the booking calendar", () => {
    expect(all(main, "img")).toHaveLength(0);

    const scriptSources: Array<string> = all(page, "script[src]").map(
      (script: Element): string => {
        return script.getAttribute("src")!;
      },
    );

    for (const source of scriptSources) {
      expect(source.startsWith("/")).toBe(true);
    }
  });
});

describe("the air-gapped page's structured data and metadata", () => {
  test("is an enterprise page, under Self-Hosted in its breadcrumb trail", () => {
    const seo: PageSEOData = PageSEOConfig[PAGE_PATH]!;

    expect(seo.canonicalPath).toBe(PAGE_PATH);
    expect(seo.pageType).toBe("enterprise");
    expect(
      seo.breadcrumbs.map((crumb: { name: string; url: string }): string => {
        return `${crumb.name} ${crumb.url}`;
      }),
    ).toEqual([
      "Home /",
      "Enterprise /enterprise/overview",
      "Self-Hosted /enterprise/self-hosted",
      "Air-Gapped /enterprise/air-gapped",
    ]);
  });

  test("leads its title with what buyers search for, and fits a search result", () => {
    const seo: PageSEOData = PageSEOConfig[PAGE_PATH]!;

    expect(seo.title).toBe("Air-Gapped Monitoring & Observability | OneUptime");
    expect(seo.title.length).toBeLessThanOrEqual(60);
    expect(seo.description.length).toBeLessThanOrEqual(160);
    expect(seo.description).toContain("no internet");
    expect(seo.description).toContain("license offline");
  });
});

describe("the pages and menus that lead to the air-gapped page", () => {
  let page: Document;

  beforeAll(async () => {
    page = documentOf(await renderPage());
  });

  test("is in the Enterprise menu, after Self-Hosted", () => {
    const menu: Element = page.getElementById("solutions-menu")!;
    const featured: Array<string> = all(menu, "a")
      .map((link: Element): string => {
        return link.getAttribute("href") || "";
      })
      .filter((href: string): boolean => {
        return href.startsWith("/enterprise/");
      });

    expect(featured.slice(0, 4)).toEqual([
      "/enterprise/overview",
      "/enterprise/self-hosted",
      "/enterprise/air-gapped",
      "/enterprise/demo",
    ]);
    expect(textOf(menu.querySelector('a[href="/enterprise/air-gapped"]'))).toBe(
      "Air-Gapped Run it with no internet connection",
    );
  });

  test("is in the phone menu beside Self-Hosted, with the Enterprise page, and the two columns stay even", () => {
    const mobile: Element = page.getElementById("mobile-menu")!;
    const link: Element = mobile.querySelector(
      '[data-testid="air-gapped-mobile-link"]',
    )!;

    expect(link.getAttribute("href")).toBe("/enterprise/air-gapped");
    expect(textOf(link)).toBe("Air-Gapped");

    const grid: Element = link.parentElement!;
    const links: Array<string> = all(grid, "a").map(
      (anchor: Element): string => {
        return `${textOf(anchor)} ${anchor.getAttribute("href")}`;
      },
    );

    expect(grid.className).toContain("grid-cols-2");
    // Read in rows of two: Enterprise beside Request Demo, Self-Hosted beside Air-Gapped.
    expect(links.slice(2, 6)).toEqual([
      "Enterprise /enterprise/overview",
      "Request Demo /enterprise/demo",
      "Self-Hosted /enterprise/self-hosted",
      "Air-Gapped /enterprise/air-gapped",
    ]);
    expect(links.length % 2).toBe(0);
    expect(
      mobile.querySelectorAll('a[href="/enterprise/air-gapped"]'),
    ).toHaveLength(1);
  });

  test("is in the footer's Solutions column, after Self-Hosted", () => {
    const footer: Element = page.querySelector("footer")!;
    const link: Element | null = footer.querySelector(
      'a[href="/enterprise/air-gapped"]',
    );

    expect(textOf(link)).toBe("Air-Gapped");

    const previous: Element | null =
      link?.closest("li")?.previousElementSibling || null;

    expect(previous?.querySelector("a")?.getAttribute("href")).toBe(
      "/enterprise/self-hosted",
    );
  });

  test("the self-hosted page's air-gapped section leads here, and to the connections out", async () => {
    const selfHosted: Document = documentOf(
      await renderView("self-hosted.ejs", {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: false,
        blackLogo: false,
        requestDemoCta: true,
        selfHosted: getSelfHostedContent(),
        seo: seoFor("/enterprise/self-hosted"),
        homeUrl: HOME_URL,
      }),
    );
    const section: Element = selfHosted.getElementById("air-gapped")!;
    const link: Element | null = section.querySelector(
      '[data-testid="self-hosted-air-gapped-link"]',
    );

    expect(link?.getAttribute("href")).toBe("/enterprise/air-gapped");
    expect(textOf(link)).toBe("Everything about air-gapped installs");
    expect(
      section.querySelector('a[href="/enterprise/air-gapped#connections-out"]'),
    ).not.toBeNull();
    expect(textOf(section)).not.toContain("SMS gateway");
  });

  test("the Enterprise overview's data residency card and the government page lead here", async () => {
    const overview: Document = documentOf(
      await renderView("enterprise-overview.ejs", {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: true,
        reviewsList1: [],
        reviewsList2: [],
        reviewsList3: [],
        seo: seoFor("/enterprise/overview"),
        homeUrl: HOME_URL,
      }),
    );
    const residency: Element | null | undefined = all(overview, "h3")
      .find((heading: Element): boolean => {
        return textOf(heading) === "Custom Data Residency";
      })
      ?.closest("div");

    expect(
      residency
        ?.querySelector('a[href="/enterprise/air-gapped"]')
        ?.textContent?.trim(),
    ).toBe("air-gapped");

    const government: Document = documentOf(
      await renderView("industries/government.ejs", {
        enableGoogleTagManager: false,
        seo: seoFor("/industries/government"),
        homeUrl: HOME_URL,
      }),
    );

    expect(
      textOf(
        government.querySelector("main a[href='/enterprise/air-gapped']") ||
          government.querySelector("a[href='/enterprise/air-gapped']"),
      ),
    ).toBe("air-gap support");
  });
});

describe("the anchors the page links into the docs", () => {
  test("every docs address the content writes is a docs page at a heading it has", () => {
    const content: AirGappedPageContent = getAirGappedContent();
    const addresses: Array<string> = [
      ...Object.values(content.docs),
      ...content.capabilities
        .map((capability: AirGappedCapability): string => {
          return capability.link?.href || "";
        })
        .filter((href: string): boolean => {
          return href.startsWith("/docs/");
        }),
      ...content.steps
        .map((step: AirGappedStep): string => {
          return step.link?.href || "";
        })
        .filter((href: string): boolean => {
          return href.startsWith("/docs/");
        }),
    ];

    expect(addresses.length).toBeGreaterThan(8);

    const empty: Document = documentOf("<html><body></body></html>");

    for (const address of addresses) {
      expect([address, problemWithLink(empty, address)]).toEqual([
        address,
        null,
      ]);
    }
  });

  test("the heading reader takes what the docs write, and nothing else", () => {
    expect(headingText("## Webhooks")).toBe("Webhooks");
    expect(headingText("### Offline activation (air-gapped installs) ##")).toBe(
      "Offline activation (air-gapped installs)",
    );
    expect(headingText("#\tTabbed")).toBe("Tabbed");
    expect(headingText("#NoSpace")).toBeNull();
    expect(headingText("####### Seven")).toBeNull();
    expect(headingText("## ")).toBeNull();
    expect(headingText("Not a heading")).toBeNull();
  });

  test("the heading reader stays linear on a very long line", () => {
    const started: number = Date.now();

    headingText(`# ${"\t".repeat(200000)}x${"#".repeat(200000)}`);

    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("the helper finds a missing page and a missing heading", () => {
    const empty: Document = documentOf("<html><body></body></html>");

    expect(problemWithLink(empty, "/docs/self-hosted/no-such-page")).toBe(
      "no such docs page",
    );
    expect(
      problemWithLink(empty, "/docs/self-hosted/enterprise#no-such-heading"),
    ).toBe("no such heading on the docs page");
    expect(problemWithLink(empty, "/no-such-route")).toBe("no route");
    expect(problemWithLink(empty, "#nowhere")).toBe("no such anchor");
    expect(problemWithLink(empty, "/enterprise/air-gapped")).toBeNull();
  });
});
