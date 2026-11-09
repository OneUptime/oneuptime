import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * "Add recommended rules" on the real Burn Rate Rules page, against the
 * offline fixture. The fixture's SLO (99.9% over a rolling 30 days) has the
 * Fast burn and Slow burn rules an SLO was created with before Slow leak
 * existed, so the page offers exactly Slow leak - the SRE Workbook's ticket
 * tier, 1x over 3 days confirmed over 6 hours, at the project's least severe
 * severity (Warning) - in a note above the rules that names it, and adding
 * it puts that row in the table and takes the note away.
 */

const SLO_ID: string = "20000000-0000-4000-8000-000000000001";

const ROUTE: string = `/dashboard/10000000-0000-4000-8000-000000000001/slos/${SLO_ID}/burn-rate-rules`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/slo-burn-rate",
);

const BUTTON: string = "Add recommended rules";

const BANNER_TEST_ID: string = "slo-recommended-burn-rate-rules-banner";

const pageErrors: Map<Page, Array<string>> = new Map();

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
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
    page.getByText("Burn Rate Rules", { exact: true }).first(),
  ).toBeVisible();
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test("offers the missing Slow leak, lists exactly what it adds, and adds just that", async ({
  page,
}: {
  page: Page;
}) => {
  const banner: Locator = page.getByTestId(BANNER_TEST_ID);

  // In sight above the rules, not folded into the table's More options menu.
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Recommended rules not set up");
  await expect(banner).toContainText(
    "Not on this SLO yet: Slow leak. Nothing is added until you confirm.",
  );

  const button: Locator = banner.getByRole("button", { name: BUTTON });

  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(page.locator("tr").filter({ hasText: "Slow leak" })).toHaveCount(
    0,
  );

  await screenshot(page, "burn-rate-rules-recommended-note-synthetic");

  await button.click();

  const dialog: Locator = page.getByRole("dialog");

  await expect(dialog).toContainText(BUTTON);
  await expect(dialog).toContainText(
    "These are the recommended burn rate rules this SLO does not have yet, scaled to its compliance window.",
  );

  const rules: Locator = dialog.getByTestId("slo-recommended-burn-rate-rule");

  await expect(rules).toHaveCount(1);

  for (const text of [
    "Slow leak",
    "1×",
    "Fires when about 10% of the error budget burns in 3d",
    "4320m / 360m",
    "Suppress 1440m after resolve",
    "Alert: Warning",
  ]) {
    await expect(rules.first()).toContainText(text);
  }

  await screenshot(page, "burn-rate-rules-add-recommended-synthetic");

  await dialog.getByRole("button", { name: "Add rules" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);

  const leak: Locator = page.locator("tr").filter({ hasText: "Slow leak" });

  await expect(leak).toHaveCount(1);
  await expect(leak).toContainText("1×");
  await expect(leak).toContainText("4320m / 360m");
  await expect(leak).toContainText("Suppress 1440m after resolve");
  await expect(leak).toContainText("Alert: Warning");
  await expect(leak).not.toContainText("Incident:");

  // Nothing is missing any more, so the note and its action are gone.
  await expect(page.getByTestId(BANNER_TEST_ID)).toHaveCount(0);
  await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);

  expect(
    await page.evaluate((): unknown => {
      return (window as unknown as { __recommendedAdds?: unknown })
        .__recommendedAdds;
    }),
  ).toEqual([{ serviceLevelObjectiveId: SLO_ID, names: ["Slow leak"] }]);
});

test("closing the confirmation adds nothing", async ({
  page,
}: {
  page: Page;
}) => {
  await page.getByRole("button", { name: BUTTON }).click();

  const dialog: Locator = page.getByRole("dialog");

  await expect(dialog).toContainText("Slow leak");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("tr").filter({ hasText: "Slow leak" })).toHaveCount(
    0,
  );
  await expect(page.getByTestId(BANNER_TEST_ID)).toBeVisible();
  await expect(page.getByRole("button", { name: BUTTON })).toBeVisible();
  expect(
    await page.evaluate((): unknown => {
      return (window as unknown as { __recommendedAdds?: unknown })
        .__recommendedAdds;
    }),
  ).toBeUndefined();
});
