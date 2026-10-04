import { expect, Locator, Page } from "@playwright/test";

/*
 * The Dashboard's products menu always opens on Essentials (Monitors,
 * Incidents, Alerts, On-Call Duty, Status Pages, Scheduled Maintenance,
 * SLOs), which never fold, and folds every other section - Observability, AI,
 * Code, Resources, Infrastructure, Dashboards & Automation, Settings - to one
 * line until it is opened.
 *
 * A spec that reaches a product through the menu opens its section first,
 * the way a user does. The menu remembers opened sections on the browser, so
 * a section is clicked only while it is folded: clicking an open one would
 * fold it again. Essentials have a plain heading with nothing to click, and
 * are always open already.
 *
 * Call it with the menu open (after clicking "Products"). It returns the
 * menu, to look for the product inside it.
 */
export const openProductsMenuSection: (
  page: Page,
  section: string,
) => Promise<Locator> = async (
  page: Page,
  section: string,
): Promise<Locator> => {
  const menu: Locator = page.getByRole("dialog", { name: "Products menu" });
  // Every section has a heading; one that folds has a button inside it.
  const heading: Locator = menu.getByRole("heading", {
    name: section,
    exact: true,
  });
  const toggle: Locator = menu.getByRole("button", {
    name: section,
    exact: true,
  });

  await expect(heading).toBeVisible({ timeout: 30000 });

  if ((await toggle.count()) === 0) {
    // A section that never folds (Essentials): it is open already.
    return menu;
  }

  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  return menu;
};
