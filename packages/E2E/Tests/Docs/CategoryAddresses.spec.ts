import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * A category's own docs address, through the ingress to the deployed docs.
 * /docs/terraform and the like are not pages, and the docs answered them
 * with a bare 404 although the website linked them. A category now opens
 * its first page in the nav - in English without a language, permanently,
 * and in the language an address names - and any other name is the docs'
 * own 404 page. The rules are unit tested in App
 * (Tests/FeatureSet/Docs/DocsCategoryRedirects); this proves they are what
 * a browser gets.
 */

function endpointFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

test.describe("Docs: a category's own address", () => {
  test("opens the category's first page, permanently, in English or the language it names", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [address, landing] of [
      ["/docs/terraform", "/docs/en/terraform/index"],
      ["/docs/incidents", "/docs/en/incidents/index"],
      ["/docs/de/terraform", "/docs/de/terraform/index"],
    ] as Array<[string, string]>) {
      const redirect: APIResponse = await page.request.get(
        endpointFor(address),
        { maxRedirects: 0 },
      );

      expect(redirect.status(), address).toBe(301);
      expect(redirect.headers()["location"], address).toBe(landing);

      const followed: APIResponse = await page.request.get(
        endpointFor(address),
      );

      expect(followed.status(), address).toBe(200);
      expect(new globalThis.URL(followed.url()).pathname, address).toBe(
        landing,
      );
    }
  });

  test("a name that is no category is the docs' 404 page", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor("/docs/compliance"),
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(404);
    expect(response.headers()["location"]).toBeUndefined();

    await page.goto(endpointFor("/docs/compliance"));

    await expect(page.locator("#docs-content h1")).toHaveText("Page not found");
    // The way back, and the search box.
    await expect(
      page.getByRole("link", { name: "Back to Documentation" }),
    ).toHaveAttribute("href", "/docs/en/introduction/getting-started");
    await expect(
      page.locator("#docs-content [data-search-open]"),
    ).toBeVisible();
  });
});
