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
 * The air-gapped page (Home/Views/air-gapped.ejs, Home/Utils/AirGapped.ts)
 * as deployed behind the ingress.
 *
 * Unit tests pin what the page says and where each link goes; this suite is
 * the deployment contract: the page and the short addresses buyers type are
 * served, the footer and the Enterprise menu lead to it, it renders whole
 * with every request to another host refused - the booking calendar, fonts
 * and analytics included - at a desktop and a phone width, and its markdown
 * variant and llms.txt describe it for machines.
 */

const pageUrl: string = URL.fromString(BASE_URL.toString())
  .addRoute("/enterprise/air-gapped")
  .toString();

const origin: string = new globalThis.URL(BASE_URL.toString()).origin;

const HEADING: string = "Run OneUptime with no internet connection.";

const SECTION_HEADINGS: Array<string> = [
  "For networks that stay closed",
  "Everything runs inside your network",
  "Four steps to an air-gapped install",
  "What reaches out, and what to use instead",
  "OneUptime AI, on a model you run",
  "Your data, inside your boundary",
  "Questions buyers ask",
  "Bring us your network. Leave with an install plan.",
];

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

test.describe("Home: Air-gapped installs", () => {
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

  test("the page is served and says what it is for, and the short addresses lead to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(pageUrl);

    await expect(page).toHaveTitle(
      "Air-Gapped Monitoring & Observability | OneUptime",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: HEADING }),
    ).toBeVisible();

    for (const name of SECTION_HEADINGS) {
      await expect(page.getByRole("heading", { level: 2, name })).toHaveCount(
        1,
      );
    }

    for (const shortPath of ["/air-gapped", "/airgapped"]) {
      await page.goto(addressOn(shortPath));
      await expect(page).toHaveURL(pageUrl);
    }
  });

  test("renders whole with nothing from another host, on a desktop and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    const refused: Set<string> = new Set<string>();

    // Everything off the site's own origin is refused, as with no internet.
    await page.route("**/*", async (route: Route): Promise<void> => {
      const request: Request = route.request();

      if (new globalThis.URL(request.url()).origin === origin) {
        await route.continue();
        return;
      }

      refused.add(new globalThis.URL(request.url()).host);
      await route.abort();
    });

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pageUrl);

      await expect(
        page.getByRole("heading", { level: 1, name: HEADING }),
      ).toBeVisible();

      // The values.yaml the chart's air-gapped suite renders, in full.
      const values: Locator = page.getByTestId("air-gapped-values");
      await values.scrollIntoViewIfNeeded();
      await expect(values).toBeVisible();
      await expect(values).toContainText("registry: registry.example.com");
      await expect(values).toContainText("disabled: true");

      /*
       * Every connection out, each with what to use inside the gap: the four
       * made unless a setting stops them (the update check, the instance
       * check-in, release emails and the probes' DNS) in a table of their
       * own, and the five made once someone sets them up. Home's
       * Utils/AirGapped.ts lists them; Home's AirGappedPage test holds the
       * page to that list.
       */
      await expect(page.getByTestId("air-gapped-connection")).toHaveCount(9);
      await expect(
        page
          .getByTestId("air-gapped-connections-on-by-default")
          .getByTestId("air-gapped-connection"),
      ).toHaveCount(4);
      await expect(
        page
          .getByTestId("air-gapped-connections-once-set-up")
          .getByTestId("air-gapped-connection"),
      ).toHaveCount(5);

      // The bar that follows the reader offers the booking from a tablet up.
      const planButton: Locator = page.getByTestId("air-gapped-nav-plan");

      if (width >= 768) {
        await expect(planButton).toBeVisible();
      } else {
        await expect(planButton).toBeHidden();
      }

      // A question opens when it is clicked.
      const question: Locator = page.getByTestId("air-gapped-faq").first();
      await question.locator("summary").click();
      await expect(question.locator("p")).toBeVisible();

      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    }

    // The page asked for other hosts (the booking calendar at least), and rendered without them.
    expect(refused.size).toBeGreaterThan(0);
  });

  test("the footer and the Enterprise menu lead to the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(BASE_URL.toString());

    const footerLink: Locator = page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Air-Gapped", exact: true });
    await expect(footerLink).toHaveAttribute("href", "/enterprise/air-gapped");
    await footerLink.click();
    await expect(page).toHaveURL(pageUrl);

    await page.goto(BASE_URL.toString());
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Enterprise" })
      .click();
    await page
      .locator("#solutions-menu")
      .getByRole("link", { name: /^Air-Gapped/ })
      .click();
    await expect(page).toHaveURL(pageUrl);
  });

  test("its markdown variant and llms.txt describe it for machines", async ({
    page,
  }: {
    page: Page;
  }) => {
    const markdown: APIResponse = await page.request.get(
      addressOn("/enterprise/air-gapped.md"),
    );

    expect(markdown.status()).toBe(200);
    expect(markdown.headers()["content-type"] || "").toContain("text/markdown");
    expect(markdown.headers()["x-robots-tag"]).toBe("noindex");

    const body: string = await markdown.text();

    expect(body).toContain("# Air-Gapped Monitoring & Observability");
    expect(body).toContain("## What reaches out, and what to use instead");
    expect(body).toContain("```yaml\nimage:\n  registry: registry.example.com");

    const llms: string = await (
      await page.request.get(addressOn("/llms.txt"))
    ).text();

    expect(llms).toContain("/enterprise/air-gapped.md");
  });
});
