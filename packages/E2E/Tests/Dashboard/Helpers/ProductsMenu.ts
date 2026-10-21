import { expect, Locator, Page } from "@playwright/test";

/*
 * The Dashboard's products menu lists its sections as the rows of one list.
 * It always opens with the first of them, Essentials (Monitors, Incidents,
 * Alerts, On-Call Duty, Status Pages, Scheduled Maintenance, SLOs), open,
 * and every other section - Observability, AI, Code, Resources,
 * Infrastructure, Dashboards & Automation, Settings - folded to one row
 * until it is opened.
 *
 * A spec that reaches a product through the menu opens its section first,
 * the way a user does. The menu remembers opened sections on the browser,
 * and opens on Essentials, so a section is clicked only while it is folded:
 * clicking an open one would fold it again.
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
  // Every section's row is a heading with the button that folds it inside.
  const toggle: Locator = menu.getByRole("button", {
    name: section,
    exact: true,
  });

  await expect(toggle).toBeVisible({ timeout: 30000 });

  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  return menu;
};
