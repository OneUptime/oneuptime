import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * What the deployed API Reference tells search engines, through the ingress:
 * an old address without a language redirects permanently to the English
 * page, a language's own address to its introduction, a page names its
 * canonical address, and the File resource's page - which answered 500 -
 * renders. The rules themselves are tested in App
 * (Tests/FeatureSet/APIReference); this proves they are what a crawler gets.
 */

function endpointFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

// The pathname of the page's canonical link, or null without one.
function canonicalPathOf(html: string): string | null {
  const link: RegExpMatchArray | null = html.match(
    /<link rel="canonical" href="([^"]+)">/,
  );

  return link ? new globalThis.URL(link[1]!).pathname : null;
}

test.describe("API Reference: search engines", () => {
  test("an old address without a language redirects permanently to the English page", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const referencePage of ["monitor", "authentication"]) {
      const response: APIResponse = await page.request.get(
        endpointFor(`/reference/${referencePage}`),
        { maxRedirects: 0, headers: { "Accept-Language": "de-DE,de;q=0.9" } },
      );

      expect(response.status(), referencePage).toBe(301);
      expect(response.headers()["location"], referencePage).toBe(
        `/reference/en/${referencePage}`,
      );
    }
  });

  test("a language's own address redirects permanently to its introduction", async ({
    page,
  }: {
    page: Page;
  }) => {
    const response: APIResponse = await page.request.get(
      endpointFor("/reference/de"),
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(301);
    expect(response.headers()["location"]).toBe("/reference/de/introduction");
  });

  test("a page names its canonical address", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A translated guide names itself; a resource names its English page.
    for (const [path, canonicalPath] of [
      ["/reference/de/authentication", "/reference/de/authentication"],
      ["/reference/de/monitor", "/reference/en/monitor"],
    ] as Array<[string, string]>) {
      const response: APIResponse = await page.request.get(endpointFor(path));

      expect(response.status(), path).toBe(200);
      expect(canonicalPathOf(await response.text()), path).toBe(canonicalPath);
    }
  });

  test("the File resource's page renders", async ({ page }: { page: Page }) => {
    const response: APIResponse = await page.request.get(
      endpointFor("/reference/en/file"),
    );

    expect(response.status()).toBe(200);
  });
});
