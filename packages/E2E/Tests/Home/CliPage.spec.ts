import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The website's CLI page (/tool/cli), deployed. Home's Tests/CliPage and the
 * CLI's Tests/HomeCliPage hold every command on the page to the CLI; this
 * suite is what they cannot see: the page as the Home service serves it, its
 * docs links followed through the real routing to the docs (the page used to
 * send readers to /docs/cli, which the docs answer with a 404), and its
 * Markdown variant, which AI tools read. Like the other Home specs it runs
 * only where the marketing site is deployed (IS_BILLING_ENABLED).
 */

const CLI_PAGE: string = "/tool/cli";
const INSTALL_COMMAND: string = "npm install -g @oneuptime/cli";

function urlFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

test.describe("Home: the CLI page", () => {
  test("installs the CLI's npm package, and no package, tap or image that does not exist", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // Home marketing site is only deployed in the SaaS stack.
    }

    page.setDefaultNavigationTimeout(120000); // 2 minutes

    await page.goto(urlFor(CLI_PAGE));

    await expect(page.locator('[data-cli-install="npm"]')).toHaveText(
      INSTALL_COMMAND,
    );
    await expect(page.locator('[data-cli-first-command="install"]')).toHaveText(
      INSTALL_COMMAND,
    );

    const main: Locator = page.locator("main");

    await expect(main).not.toContainText("oneuptime-cli");
    await expect(main).not.toContainText("brew install");
    await expect(main).not.toContainText("docker run --rm oneuptime/cli");
  });

  test("shows real commands in its terminals, each behind a prompt", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    await page.goto(urlFor(CLI_PAGE));

    for (const transcript of ["overview", "monitors", "incidents"]) {
      const commands: Locator = page.locator(
        `[data-cli-transcript="${transcript}"] [data-cli-prompt]`,
      );

      expect(await commands.count()).toBeGreaterThan(1);
    }

    await expect(
      page.locator('[data-cli-transcript="monitors"]'),
    ).toContainText("oneuptime monitor count");
    await expect(
      page.locator('[data-cli-transcript="incidents"]'),
    ).not.toContainText("oneuptime incident resolve");
  });

  test("links only to docs pages that open", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    await page.goto(urlFor(CLI_PAGE));

    const links: Array<string> = await page
      .locator('main a[href^="/docs"]')
      .evaluateAll((anchors: Array<Element>): Array<string> => {
        return anchors.map((anchor: Element): string => {
          return anchor.getAttribute("href") || "";
        });
      });

    expect(links).toContain("/docs/cli/index");

    for (const link of new Set(links)) {
      // The anchor stays in the browser: the server is asked for the page.
      const pagePath: string = link.split("#")[0] as string;
      const response: APIResponse = await page.request.get(urlFor(pagePath));

      // A page without a language opens its English page, through a redirect.
      expect([link, response.status()]).toEqual([link, 200]);
      expect([link, new globalThis.URL(response.url()).pathname]).toEqual([
        link,
        pagePath.replace("/docs/", "/docs/en/"),
      ]);
    }
  });

  test("its Markdown variant lists what the CLI does, and how to install it", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      urlFor(`${CLI_PAGE}.md`),
    );

    expect(response.status()).toBe(200);

    const body: string = await response.text();

    expect(body).toContain("# OneUptime CLI");
    expect(body).toContain("- Install from npm: @oneuptime/cli");
    expect(body).not.toContain("Homebrew");
    expect(body).not.toContain("log tailing");
  });
});
