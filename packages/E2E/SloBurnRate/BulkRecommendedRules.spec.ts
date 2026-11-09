import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Bulk Actions > Add recommended rules on the real SLO list, against the
 * offline fixture. The fixture lists four SLOs:
 *
 *   - Checkout availability (30 days), missing Slow leak;
 *   - Search latency (7 days), missing Slow leak, which a 7-day window
 *     scales to 1x over 16.8 hours;
 *   - Payments API (30 days), with all three rules;
 *   - Login (calendar month), with only a renamed fast-burn rule, so
 *     missing Slow burn and Slow leak.
 *
 * Selecting all four and choosing the action asks the server what each is
 * missing and says so before anything is added; confirming adds exactly
 * that, in one request for the three that need it, and the result says what
 * happened to each SLO and what was added. Asked again, there is nothing to
 * add.
 */

const ROUTE: string = "/dashboard/10000000-0000-4000-8000-000000000001/slos";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/slo-burn-rate",
);

const BUTTON: string = "Add recommended rules";

const SLO_NAMES: Array<string> = [
  "Checkout availability",
  "Search latency",
  "Payments API",
  "Login",
];

const pageErrors: Map<Page, Array<string>> = new Map();

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: false,
    animations: "disabled",
  });
}

async function selectAll(page: Page): Promise<void> {
  for (const name of SLO_NAMES) {
    await page
      .getByRole("checkbox", {
        // The SLOs table names its rows SLO.
        name: `Select SLO: ${name}`,
        exact: true,
      })
      .check();
  }
}

async function openAction(page: Page): Promise<Locator> {
  await page.getByText("Bulk Actions", { exact: true }).click();

  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: BUTTON, exact: true }).click();

  const dialog: Locator = page.getByRole("dialog", {
    name: "Add recommended rules to 4 SLOs",
  });
  await expect(dialog).toBeVisible();

  return dialog;
}

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", (error: Error): void => {
    pageErrors.get(page)!.push(error.message);
  });

  // Nothing may leave the fixture.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === "4213") {
      await route.continue();
      return;
    }

    await route.abort();
  });

  await page.goto(ROUTE);
  await expect(
    page.getByRole("checkbox", {
      name: "Select SLO: Login",
      exact: true,
    }),
  ).toBeVisible();
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test("says what each selected SLO would get, scaled to its window, before anything is added", async ({
  page,
}: {
  page: Page;
}) => {
  await selectAll(page);

  const dialog: Locator = await openAction(page);

  await expect(
    dialog.getByTestId("slo-bulk-recommended-rules-headline"),
  ).toHaveText("3 SLOs get the recommended rules they are missing:");

  const rules: Locator = dialog.getByTestId("slo-bulk-recommended-rules-rule");
  await expect(rules).toHaveCount(2);

  // Slow burn: Login alone, at the calendar month's 6x.
  await expect(rules.nth(0)).toContainText("Slow burn");
  await expect(rules.nth(0)).toContainText("1 SLO");
  await expect(rules.nth(0)).toContainText(
    "6× · Fires when about 5% of the error budget burns in 6h",
  );
  await expect(rules.nth(0)).toContainText("Login");

  // Slow leak: two shapes - three days on 30 days and a calendar month, 16.8 hours on 7 days.
  await expect(rules.nth(1)).toContainText("Slow leak");
  await expect(rules.nth(1)).toContainText("3 SLOs");

  const leakShapes: Locator = rules
    .nth(1)
    .getByTestId("slo-bulk-recommended-rules-variant");
  await expect(leakShapes).toHaveCount(2);
  await expect(leakShapes.nth(0)).toContainText(
    "1× · Fires when about 10% of the error budget burns in 3d",
  );
  await expect(leakShapes.nth(0)).toContainText("2 SLOs");
  await expect(leakShapes.nth(0)).toContainText("4320m / 360m");
  await expect(leakShapes.nth(0)).toContainText("Alert: Warning");
  await expect(leakShapes.nth(0)).toContainText(
    "Checkout availability and Login",
  );
  await expect(leakShapes.nth(1)).toContainText(
    "1× · Fires when about 10% of the error budget burns in 16h 48m",
  );
  await expect(leakShapes.nth(1)).toContainText("1008m / 84m");
  await expect(leakShapes.nth(1)).toContainText("Search latency");

  await expect(
    dialog.getByTestId("slo-bulk-recommended-rules-complete"),
  ).toHaveText(
    "1 SLO already has every recommended rule and is left as it is.",
  );

  await expect(dialog.getByTestId("modal-footer-submit-button")).toBeEnabled();
  await expect(dialog.getByTestId("modal-footer-submit-button")).toHaveText(
    BUTTON,
  );

  await screenshot(page, "slo-list-bulk-recommended-rules-confirmation");

  // Closing it adds nothing.
  await dialog.getByTestId("modal-footer-close-button").click();
  await expect(dialog).toBeHidden();

  expect(
    await page.evaluate(() => {
      return (window as unknown as { __bulkRecommendedAdds?: unknown })
        .__bulkRecommendedAdds;
    }),
  ).toBeUndefined();
});

test("adds only what each SLO is missing, says what happened to each, and finds nothing left the next time", async ({
  page,
}: {
  page: Page;
}) => {
  await selectAll(page);

  const dialog: Locator = await openAction(page);
  const submit: Locator = dialog.getByTestId("modal-footer-submit-button");

  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
    "Rules added to 3 SLOs",
  );
  await expect(page.getByTestId("bulk-action-unchanged-count")).toHaveText(
    "1 SLO already had every recommended rule",
  );
  await expect(page.getByTestId("bulk-action-unchanged-items")).toContainText(
    "Payments API",
  );
  await expect(page.getByTestId("bulk-action-unchanged-items")).toContainText(
    "Already has every recommended rule.",
  );
  await expect(page.getByTestId("bulk-action-failed-count")).toHaveCount(0);

  const added: Locator = page.getByTestId("slo-bulk-recommended-rules-added");
  await expect(added).toContainText("Slow burn: added to 1 SLO");
  await expect(added).toContainText("Slow leak: added to 3 SLOs");

  await screenshot(page, "slo-list-bulk-recommended-rules-result");

  // One request, for the three that needed rules, each given just those.
  expect(
    await page.evaluate(() => {
      return (window as unknown as { __bulkRecommendedAdds?: unknown })
        .__bulkRecommendedAdds;
    }),
  ).toEqual([
    {
      serviceLevelObjectiveIds: [
        "20000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000002",
        "20000000-0000-4000-8000-000000000004",
      ],
      added: [["Slow leak"], ["Slow leak"], ["Slow burn", "Slow leak"]],
    },
  ]);

  await page.getByRole("button", { name: "Close" }).click();

  // Asked again, there is nothing to add, and nothing to confirm.
  await selectAll(page);

  const again: Locator = await openAction(page);

  await expect(
    again.getByTestId("slo-bulk-recommended-rules-nothing"),
  ).toHaveText("There is nothing to add.");
  await expect(
    again.getByTestId("slo-bulk-recommended-rules-complete"),
  ).toHaveText(
    "4 SLOs already have every recommended rule and are left as they are.",
  );
  await expect(again.getByTestId("modal-footer-submit-button")).toBeDisabled();
});

test("the confirmation fits a phone's width", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ROUTE);

  await selectAll(page);

  const dialog: Locator = await openAction(page);

  await expect(
    dialog.getByTestId("slo-bulk-recommended-rules-headline"),
  ).toBeVisible();

  await expectNoSidewaysScroll(page);

  await screenshot(page, "slo-list-bulk-recommended-rules-phone");
});
