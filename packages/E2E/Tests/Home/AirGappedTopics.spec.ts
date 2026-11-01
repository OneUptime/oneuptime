import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  APIResponse,
  Locator,
  Page,
  Request,
  Route,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The air-gapped product pages (Home/Views/air-gapped-topic.ejs,
 * Home/Utils/AirGappedPages.ts) as deployed behind the ingress.
 *
 * Unit tests pin what each page says and where each link goes; this suite is
 * the deployment contract: every page is served, the hub and the footer lead
 * to them, a product page leads to its own, each renders whole with every
 * request to another host refused at a desktop and a phone width, and the
 * markdown variants describe them for machines.
 */

interface TopicPage {
  path: string;
  title: string;
  name: string;
}

const PAGES: Array<TopicPage> = [
  {
    path: "/enterprise/air-gapped/observability",
    title: "Air-Gapped Observability | Logs, Metrics, Traces | OneUptime",
    name: "Observability",
  },
  {
    path: "/enterprise/air-gapped/log-management",
    title: "Air-Gapped Log Management | Syslog, Fluent Bit | OneUptime",
    name: "Log Management",
  },
  {
    path: "/enterprise/air-gapped/monitoring",
    title: "Air-Gapped Uptime & Synthetic Monitoring | OneUptime",
    name: "Monitoring",
  },
  {
    path: "/enterprise/air-gapped/incident-management",
    title: "Air-Gapped Incident Management | No Internet | OneUptime",
    name: "Incident Management",
  },
  {
    path: "/enterprise/air-gapped/on-call",
    title: "Air-Gapped On-Call | Paging With No Internet | OneUptime",
    name: "On-Call",
  },
  {
    path: "/enterprise/air-gapped/status-pages",
    title: "Air-Gapped Status Pages | Private Status Pages | OneUptime",
    name: "Status Pages",
  },
  {
    path: "/enterprise/air-gapped/kubernetes",
    title: "Air-Gapped Kubernetes Monitoring | OneUptime",
    name: "Kubernetes",
  },
  {
    path: "/enterprise/air-gapped/network-monitoring",
    title: "Air-Gapped Network Monitoring | SNMP & Flows | OneUptime",
    name: "Network Monitoring",
  },
  {
    path: "/enterprise/air-gapped/infrastructure",
    title: "Air-Gapped Infrastructure Monitoring | OneUptime",
    name: "Infrastructure",
  },
  {
    path: "/enterprise/air-gapped/ai",
    title: "Air-Gapped AI for Incidents | Your Own Model | OneUptime",
    name: "AI",
  },
  {
    path: "/enterprise/air-gapped/security-events",
    title: "Air-Gapped SIEM | Security Events | OneUptime",
    name: "Security Events",
  },
  {
    path: "/enterprise/air-gapped/workflows",
    title: "Air-Gapped Workflows & Runbooks | Automation | OneUptime",
    name: "Workflows",
  },
];

const origin: string = new globalThis.URL(BASE_URL.toString()).origin;

function addressOn(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

test.describe("Home: Air-gapped product pages", () => {
  test.skip(
    !IS_BILLING_ENABLED,
    "The marketing website is deployed only in billing-enabled environments.",
  );

  test.beforeEach(async ({ page }: { page: Page }) => {
    page.setDefaultNavigationTimeout(120000);
    // Keep the shared consent banner from covering the page.
    await page.addInitScript((): void => {
      localStorage.setItem("cookiesAccepted", "false");
    });
  });

  for (const topic of PAGES) {
    test(`${topic.path} is served, and renders whole with nothing from another host`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // Everything off the site's own origin is refused, as with no internet.
      await page.route("**/*", async (route: Route): Promise<void> => {
        const request: Request = route.request();

        if (new globalThis.URL(request.url()).origin === origin) {
          await route.continue();
          return;
        }

        await route.abort();
      });

      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(addressOn(topic.path));

        await expect(page).toHaveTitle(topic.title);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        // What changes, with what each row takes.
        const rows: Locator = page.getByTestId("air-gapped-topic-change");
        await rows.first().scrollIntoViewIfNeeded();
        await expect(rows.first()).toBeVisible();

        // The code block, which scrolls inside itself on a phone.
        const code: Locator = page.getByTestId(
          "air-gapped-topic-configure-code",
        );
        await code.scrollIntoViewIfNeeded();
        await expect(code).toBeVisible();

        // A question opens when it is clicked.
        const question: Locator = page
          .getByTestId("air-gapped-topic-faq")
          .first();
        await question.locator("summary").click();
        await expect(question.locator("p")).toBeVisible();

        // The bar that follows the reader offers the booking from a tablet up.
        const planButton: Locator = page.getByTestId(
          "air-gapped-topic-nav-plan",
        );

        if (width >= 768) {
          await expect(planButton).toBeVisible();
        } else {
          await expect(planButton).toBeHidden();
        }

        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      }
    });
  }

  test("the hub lists every page, and a card leads to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(addressOn("/enterprise/air-gapped"));

    const cards: Locator = page.getByTestId("air-gapped-topic-card");

    await expect(cards).toHaveCount(PAGES.length);

    await page
      .locator("#by-product")
      .getByRole("link", { name: /^Air-gapped observability/ })
      .click();
    await expect(page).toHaveURL(
      addressOn("/enterprise/air-gapped/observability"),
    );
  });

  test("a page's booking button lands on the hub's calendar section", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(addressOn("/enterprise/air-gapped/on-call"));

    await page
      .getByRole("link", { name: "Plan your air-gapped install" })
      .click();

    await expect(page).toHaveURL(/\/enterprise\/air-gapped#plan-your-install$/);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Bring us your network. Leave with an install plan.",
      }),
    ).toBeVisible();
  });

  test("the footer leads to a page, and a product page leads to its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(BASE_URL.toString());
    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Incident Management", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(
      addressOn("/enterprise/air-gapped/incident-management"),
    );

    await page.goto(addressOn("/product/on-call"));

    const pointer: Locator = page.getByTestId("enterprise-ready-air-gapped");

    await pointer.scrollIntoViewIfNeeded();
    await pointer.getByRole("link").click();
    await expect(page).toHaveURL(addressOn("/enterprise/air-gapped/on-call"));
  });

  test("their markdown variants and llms.txt describe them for machines", async ({
    page,
  }: {
    page: Page;
  }) => {
    const llms: string = await (
      await page.request.get(addressOn("/llms.txt"))
    ).text();

    for (const topic of PAGES) {
      const markdown: APIResponse = await page.request.get(
        addressOn(`${topic.path}.md`),
      );

      expect(markdown.status()).toBe(200);
      expect(markdown.headers()["content-type"] || "").toContain(
        "text/markdown",
      );
      expect(markdown.headers()["x-robots-tag"]).toBe("noindex");
      expect(await markdown.text()).toContain("## Questions buyers ask");
      expect(llms).toContain(`${topic.path}.md`);
    }
  });
});
