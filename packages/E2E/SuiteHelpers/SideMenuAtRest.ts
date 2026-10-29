import { expect, Page } from "@playwright/test";

/*
 * A page's side menu at rest: every section drawn as its toggle says, and
 * every finite animation run to its end.
 *
 * The offline fixtures load Tailwind's runtime (tailwind.js, as the
 * Dashboard's own page does), which writes the rules for a class once the
 * class is in the page. For about a tenth of a second the menu is drawn
 * without them, every section open; then each section that starts folded
 * folds with its own transition (SideMenuSection: max-h-0 opacity-0
 * invisible transition-all, 150 to 200 ms), and until that has run its rows
 * say visibility: visible and take focus. The record's name reaches the
 * page's h1 in that time, so a test that used the menu as soon as the h1
 * named the record found either state. On master in October 2026 that
 * failed the Rules Menu Section suite on runs whose menu code was that of
 * runs that passed: its two Tab tests stopped on a folded section's row
 * (7f62112a7e), and SideMenuWordBreaks counted the folded "Benutzerdefinierte
 * Domains" and "Benutzerdefinierte Felder" among the titles in sight
 * (7f62112a7e in Chromium and Firefox, 23b1ebcd1f in Firefox).
 *
 * Waiting for running animations alone is not enough: the rules can be
 * written later than two frames after the h1, and then nothing runs yet.
 * A page with no side menu (a phone's, until its button opens it) is at
 * rest at once.
 */
export type SideMenuAtRestFunction = (page: Page) => Promise<void>;

export const sideMenuAtRest: SideMenuAtRestFunction = async (
  page: Page,
): Promise<void> => {
  // The titles of the sections drawn otherwise than their toggles say.
  await expect
    .poll(
      async (): Promise<Array<string>> => {
        return await page.evaluate((): Array<string> => {
          return Array.from(
            document.querySelectorAll(
              "button[aria-controls^='side-menu-section-']",
            ),
          )
            .filter((toggle: Element): boolean => {
              const body: HTMLElement | null = document.getElementById(
                toggle.getAttribute("aria-controls") || "",
              );

              if (!body) {
                return false;
              }

              const isOpen: boolean =
                toggle.getAttribute("aria-expanded") === "true";
              const isDrawnOpen: boolean =
                getComputedStyle(body).visibility === "visible";

              return isOpen !== isDrawnOpen;
            })
            .map((toggle: Element): string => {
              return (toggle.textContent || "").trim();
            });
        });
      },
      {
        message: "side menu sections drawn otherwise than their toggles say",
        intervals: [50],
      },
    )
    .toEqual([]);

  // Whatever else first paint set moving, such as the lit entry's rail.
  await page.evaluate(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
    await Promise.all(
      document
        .getAnimations()
        .filter((animation: Animation): boolean => {
          return animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation: Animation): Promise<unknown> => {
          return animation.finished.catch(() => {
            return undefined;
          });
        }),
    );
  });
};
