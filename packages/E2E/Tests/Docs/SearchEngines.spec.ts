import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * What the deployed docs tell search engines, through the ingress: an old
 * address without a language redirects permanently to the English page,
 * the retired Copilot pages and /docs/<lang>/monitor/monitor redirect to
 * their successors, a page names its canonical address, the page as
 * Markdown is never indexed, and the docs' sitemap is served. The rules
 * themselves are unit tested in App (Tests/FeatureSet/Docs); this proves
 * they are what a crawler gets.
 */

function endpointFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

test.describe("Docs: search engines", () => {
  test("an old address without a language redirects permanently to the English page", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const docsPage of [
      "terraform/self-hosted",
      "installation/docker-compose",
    ]) {
      const response: APIResponse = await page.request.get(
        endpointFor(`/docs/${docsPage}`),
        { maxRedirects: 0, headers: { "Accept-Language": "de-DE,de;q=0.9" } },
      );

      expect(response.status()).toBe(301);
      expect(response.headers()["location"]).toBe(`/docs/en/${docsPage}`);
    }
  });

  test("retired addresses redirect permanently to their successors", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [oldPath, newPath] of [
      ["/docs/copilot/introduction", "/docs/en/ai/ai-agent"],
      ["/docs/en/copilot/deploy-llm-server", "/docs/en/ai/ai-agent"],
      ["/docs/en/monitor/monitor", "/docs/en/monitor/create-monitor"],
    ] as Array<[string, string]>) {
      const response: APIResponse = await page.request.get(
        endpointFor(oldPath),
        { maxRedirects: 0 },
      );

      expect(response.status(), oldPath).toBe(301);
      expect(response.headers()["location"], oldPath).toBe(newPath);
    }
  });

  test("a page names its canonical address", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000);

    await page.goto(endpointFor("/docs/en/installation/docker-compose"));

    const canonical: string | null = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");

    expect(canonical).not.toBeNull();
    expect(new globalThis.URL(canonical!).pathname).toBe(
      "/docs/en/installation/docker-compose",
    );
  });

  test("the page as Markdown is never indexed, and is served as Markdown", async ({
    page,
  }: {
    page: Page;
  }) => {
    const response: APIResponse = await page.request.get(
      endpointFor("/docs/as-markdown/en/installation/docker-compose"),
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toBe("noindex");
    expect(response.headers()["content-type"] || "").toContain("text/markdown");
  });

  test("the docs' sitemap is served", async ({ page }: { page: Page }) => {
    const response: APIResponse = await page.request.get(
      endpointFor("/docs/sitemap.xml"),
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] || "").toContain(
      "application/xml",
    );
    expect(await response.text()).toContain(
      "/docs/en/introduction/getting-started</loc>",
    );
  });
});
