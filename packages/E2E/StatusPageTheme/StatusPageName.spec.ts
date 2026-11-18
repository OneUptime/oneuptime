import { expect, Locator, Page, test } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A NEW STATUS PAGE SAYS WHOSE IT IS (#7467), on the real status page - its
 * own index.ejs, Tailwind and app - with only its API answered from fixture
 * data (StatusPageTheme/Fixture, `logo=none`). See README.md.
 *
 * A page made by Create Status Page or the guided setup has a name and no
 * logo. Its header - a logo and links - drew nothing for it, so a visitor
 * read "All Resources are Operational" and could not tell whose status it
 * was, and its tab said "Status Page". The server now sends its name as
 * its pageTitle (its Page Title, else its name), and:
 *
 *   - the header draws it where the logo would be, a link to the Overview
 *     as the logo is, beside the header's links, on a laptop and a phone,
 *     light and dark, left to right and right to left;
 *   - the browser tab is named after it on every page of it: its Overview
 *     the page alone, its other pages the page's name first, never
 *     OneUptime's.
 *
 * Laptop- and phone-sized: each test sets its own window, so the phone
 * project skips them. Screenshots: output/playwright/status-page-theme-ui/
 * name-*.png.
 */

const PAGE: string = "/status-page/00000000-0000-4000-8000-000000000001";
const SCREENSHOTS: string = "../../output/playwright/status-page-theme-ui";
// What the fixture's server sends as the page's name (Fixture/Data.js).
const NAME: string = "Acme Cloud Status";

const openPage: (
  page: Page,
  data: { width: number; theme: string; lang?: string | undefined },
) => Promise<void> = async (
  page: Page,
  data: { width: number; theme: string; lang?: string | undefined },
): Promise<void> => {
  await page.setViewportSize({ width: data.width, height: 900 });
  const query: URLSearchParams = new URLSearchParams({
    theme: data.theme,
    logo: "none",
  });

  if (data.lang) {
    query.set("lang", data.lang);
  }

  await page.goto(`${PAGE}?${query.toString()}`);
  await expect(page.getByTestId("status-page-overview")).toBeVisible();
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
};

test.describe("a status page with no logo names itself (#7467)", () => {
  test.skip(({ isMobile }: { isMobile: boolean }) => {
    return isMobile;
  }, "Each test sets its own window.");

  for (const lang of ["en", "ar"]) {
    for (const theme of ["Light", "Dark"]) {
      for (const width of [390, 1280]) {
        test(`${lang}, ${theme}, ${width}px: its header names it, a link to its Overview beside its links`, async ({
          page,
        }: {
          page: Page;
        }) => {
          await openPage(page, {
            width,
            theme,
            lang: lang === "en" ? undefined : lang,
          });

          const name: Locator = page.getByTestId("status-page-name");

          await expect(name).toBeVisible();
          await expect(name).toHaveText(NAME);
          await expect(name).toHaveAttribute("href", /\/status-page\//);
          // No logo is drawn: the name stands where it would be.
          await expect(page.locator("#status-page-logo")).toHaveCount(0);
          // Read the way it is written: English, left to right, on any page.
          await expect(name.locator("bdi")).toHaveAttribute("dir", "ltr");

          /*
           * Its text reads on the page's ground in both themes: a name in
           * the near-black or near-white of a heading, never the gray of
           * a link.
           */
          const contrast: number = await name.evaluate(
            (element: Element): number => {
              const parse: (value: string) => Array<number> = (
                value: string,
              ): Array<number> => {
                return (value.match(/[\d.]+/g) || []).map(Number);
              };
              const luminance: (rgb: Array<number>) => number = (
                rgb: Array<number>,
              ): number => {
                const linear: (channel: number) => number = (
                  channel: number,
                ): number => {
                  const value: number = channel / 255;
                  return value <= 0.03928
                    ? value / 12.92
                    : Math.pow((value + 0.055) / 1.055, 2.4);
                };
                return (
                  0.2126 * linear(rgb[0]!) +
                  0.7152 * linear(rgb[1]!) +
                  0.0722 * linear(rgb[2]!)
                );
              };
              let ground: Element | null = element;
              let background: Array<number> = [255, 255, 255, 0];

              while (ground) {
                background = parse(getComputedStyle(ground).backgroundColor);

                if (background.length === 3 || background[3]! > 0.95) {
                  break;
                }

                ground = ground.parentElement;
              }

              const text: number = luminance(
                parse(getComputedStyle(element).color),
              );
              const page: number = luminance(background);

              return (
                (Math.max(text, page) + 0.05) / (Math.min(text, page) + 0.05)
              );
            },
          );

          expect(contrast).toBeGreaterThanOrEqual(7);

          // The header's links stay beside it, on the same line.
          const nameBox: { y: number; height: number } =
            (await name.boundingBox())!;

          if (width >= 768) {
            const link: { y: number; height: number } = (await page
              .getByRole("link", { name: "Docs", exact: true })
              .boundingBox())!;

            expect(
              Math.abs(
                nameBox.y + nameBox.height / 2 - (link.y + link.height / 2),
              ),
            ).toBeLessThanOrEqual(12);
          } else {
            await expect(
              page.getByTestId("mobile-header-toggle"),
            ).toBeVisible();
          }

          await expectNoSidewaysScroll(page);
          await page.screenshot({
            path: `${SCREENSHOTS}/name-${lang}-${theme.toLowerCase()}-${width}.png`,
            fullPage: true,
          });
        });
      }
    }
  }

  test("the browser tab is named after the page on every page of it, never OneUptime", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, { width: 1280, theme: "Light" });

    await expect(page).toHaveTitle(NAME);

    // Another page of it, from its tabs.
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Incidents", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/incidents/);
    await expect(page).toHaveTitle(new RegExp(`^${NAME} \\| `));
    expect(await page.title()).not.toContain("OneUptime");

    // Back on its Overview, by its name in the header.
    await page.getByTestId("status-page-name").click();
    await expect(page.getByTestId("status-page-overview")).toBeVisible();
    await expect(page).toHaveTitle(NAME);
  });
});
