import {
  expect,
  Locator,
  Page,
  Route,
  test as base,
  TestType,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
} from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * What every spec of the OpenStack pages shares: how to reach a page of the fixture,
 * and the rules every walk is held to, whatever it walks. Import `test` and `expect`
 * from here, and each spec in this folder runs under them:
 *
 *   - a page that threw while drawing is a bug, even when the test passed;
 *   - nothing leaves the fixture: no CDN, no telemetry, no real API;
 *   - every read a page made is one the fixture answers as the server does, so a page
 *     cannot pass by asking for something nothing checks.
 */

export const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
export const CLOUD_ID: string = "71000000-0000-4000-8000-000000000001";
export const CLOUD_PATH: string = `/dashboard/${PROJECT_ID}/openstack/${CLOUD_ID}`;

export const VIEWPORTS: ReadonlyArray<{
  width: number;
  height: number;
}> = [
  { width: 1280, height: 900 },
  { width: 1024, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

export const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/openstack-pages-ui",
);

export interface FixtureRecord {
  scenario: Record<string, unknown>;
  loadedAt: number;
  listRequests: Array<{
    modelName: string;
    query: Record<string, unknown> | null;
    select: Record<string, unknown> | null;
    limit?: number;
    skip?: number;
  }>;
  countRequests: Array<{
    modelName: string;
    query: Record<string, unknown> | null;
  }>;
  itemRequests: Array<{ modelName: string; id: string }>;
  aggregateRequests: Array<{
    modelName: string;
    name: string;
    attributes: Record<string, unknown> | null;
  }>;
  apiRequests: Array<{
    method: string;
    url: string;
    body: Record<string, unknown> | null;
  }>;
  unhandled: Array<Record<string, unknown>>;
}

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap();
const outsideRequests: WeakMap<Page, Array<string>> = new WeakMap();

export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = base.extend<Record<string, never>>({
  page: async (
    { page }: { page: Page },
    use: (page: Page) => Promise<void>,
  ): Promise<void> => {
    const errors: Array<string> = [];
    const outside: Array<string> = [];
    pageErrors.set(page, errors);
    outsideRequests.set(page, outside);

    page.on("pageerror", (error: Error) => {
      errors.push(String(error));
    });

    await page.route("**/*", async (route: Route) => {
      const url: URL = new URL(route.request().url());
      if (url.hostname === "127.0.0.1") {
        await route.continue();
        return;
      }
      outside.push(url.toString());
      await route.abort();
    });

    await use(page);

    expect(errors).toEqual([]);
    expect(outside).toEqual([]);

    if (!page.isClosed()) {
      const unhandled: Array<Record<string, unknown>> = await page.evaluate(
        (): Array<Record<string, unknown>> => {
          const fixture: FixtureRecord | undefined = (
            window as unknown as { __openStackPagesFixture?: FixtureRecord }
          ).__openStackPagesFixture;
          return fixture ? fixture.unhandled : [];
        },
      );
      expect(unhandled).toEqual([]);
    }
  },
});

export { expect };

export async function fixtureRecord(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __openStackPagesFixture: FixtureRecord })
      .__openStackPagesFixture;
  });
}

export async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// A page of the cloud, from its path under the cloud: "" for the Overview, "services".
export async function openCloudPage(
  page: Page,
  subPath: string = "",
  query: string = "",
): Promise<void> {
  await page.goto(
    `${CLOUD_PATH}${subPath ? `/${subPath}` : ""}${query ? `?${query}` : ""}`,
  );
}

// A part's page, whose last path segment is its externalId, as the app encodes it.
export function partPath(listPath: string, externalId: string): string {
  return `${CLOUD_PATH}/${listPath}/${encodeURIComponent(externalId)}`;
}

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The Dashboard's German and Persian words, as the fixture draws them.
export const GERMAN: Record<string, string> = locale("de");
export const PERSIAN: Record<string, string> = locale("fa");

// A word as a locale draws it: the English while it has no translation of its own.
export function inLocale(
  words: Record<string, string>,
  english: string,
): string {
  return words[english] || english;
}

// The rows of a Needs attention card, as key and severity, in order.
export async function attentionRows(
  card: Locator,
): Promise<Array<{ key: string; severity: string }>> {
  return await card
    .locator('[data-testid$="-item"]')
    .evaluateAll(
      (elements: Array<Element>): Array<{ key: string; severity: string }> => {
        return elements.map((element: Element) => {
          return {
            key: element.getAttribute("data-key") || "",
            severity: element.getAttribute("data-severity") || "",
          };
        });
      },
    );
}
