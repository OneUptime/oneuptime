import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

const OVERVIEW_ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/slos/20000000-0000-4000-8000-000000000001";
const DESCRIPTION: string =
  "Availability of the checkout API for customer purchases.";
const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/slo-burn-rate",
);
const pageErrors: Map<Page, Array<string>> = new Map();

function card(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

async function bounds(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  await expect(locator).toBeVisible();
  const box: Awaited<ReturnType<Locator["boundingBox"]>> =
    await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function openOverview(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${OVERVIEW_ROUTE}${query}`);
  await expect(card(page, "SLO Details")).toBeVisible();
  await expect(
    card(page, "SLO Details").getByText("Checkout availability", {
      exact: true,
    }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", (error: Error): void => {
    pageErrors.get(page)!.push(error.message);
  });
  await page.clock.setFixedTime(new Date("2026-09-11T12:00:00.000Z"));
  await page.route("**/*", async (route: Route): Promise<void> => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === "4213") {
      await route.continue();
      return;
    }
    await route.abort();
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

for (const width of [1440, 1280, 1024, 390]) {
  test(`details precede open events and fit the ${width}px overview`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openOverview(page);
    const details: Locator = card(page, "SLO Details");
    const events: Locator = card(page, "Open alerts & incidents");
    const budget: Locator = card(page, "Error budget burn-down");
    const activity: Locator = card(page, "Recent activity");
    const detailsBox: Awaited<ReturnType<typeof bounds>> =
      await bounds(details);
    const eventsBox: Awaited<ReturnType<typeof bounds>> = await bounds(events);
    const budgetBox: Awaited<ReturnType<typeof bounds>> = await bounds(budget);
    const activityBox: Awaited<ReturnType<typeof bounds>> =
      await bounds(activity);

    // The actual ModelPage and side menu participate in the available width.
    expect(Math.abs(eventsBox.x - detailsBox.x)).toBeLessThan(1);
    expect(Math.abs(eventsBox.width - detailsBox.width)).toBeLessThan(1);
    expect(eventsBox.y).toBeGreaterThanOrEqual(
      detailsBox.y + detailsBox.height,
    );
    if (width >= 1280) {
      expect(detailsBox.x).toBeGreaterThan(budgetBox.x + budgetBox.width);
      expect(Math.abs(detailsBox.y - budgetBox.y)).toBeLessThan(1);
      expect(budgetBox.width).toBeGreaterThan(detailsBox.width * 1.9);
    } else {
      expect(Math.abs(detailsBox.x - budgetBox.x)).toBeLessThan(1);
      expect(detailsBox.y).toBeGreaterThanOrEqual(
        activityBox.y + activityBox.height,
      );
    }

    await expect(details).toContainText(DESCRIPTION);
    for (const label of ["checkout", "customer-impact"]) {
      await expect(details.getByText(label, { exact: true })).toBeVisible();
    }
    const edit: Locator = details.getByRole("button", {
      name: "Edit Service Level Objective",
      exact: true,
    });
    await expect(edit).toBeVisible();
    const editBox: Awaited<ReturnType<typeof bounds>> = await bounds(edit);
    expect(editBox.x).toBeGreaterThanOrEqual(detailsBox.x);
    expect(editBox.x + editBox.width).toBeLessThanOrEqual(
      detailsBox.x + detailsBox.width,
    );
    // The shared mobile detail border has a negative margin; inspect the
    // actual header/fields instead, so decoration is not treated as content.
    const fittedRegions: Array<Locator> =
      width >= 768
        ? [details]
        : [details.getByTestId("card-header"), details.locator("#slo-details")];
    for (const region of fittedRegions) {
      expect(
        await region.evaluate((element: HTMLElement | SVGElement): boolean => {
          return element.scrollWidth <= element.clientWidth;
        }),
      ).toBe(true);
      const regionBox: Awaited<ReturnType<typeof bounds>> =
        await bounds(region);
      expect(regionBox.x).toBeGreaterThanOrEqual(detailsBox.x);
      expect(regionBox.x + regionBox.width).toBeLessThanOrEqual(
        detailsBox.x + detailsBox.width,
      );
    }
    expect(
      await page.evaluate((): boolean => {
        return document.documentElement.scrollWidth <= window.innerWidth;
      }),
    ).toBe(true);
    expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(width);

    if (width === 1440 || width === 390) {
      await fs.mkdir(SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: path.join(
          SCREENSHOTS,
          `slo-overview-details-${width}-synthetic.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    }
  });
}

test("empty optional details retain their placeholders in the sidebar", async ({
  page,
}: {
  page: Page;
}) => {
  await openOverview(page, "?details=empty");
  const details: Locator = card(page, "SLO Details");
  await expect(
    details.getByText("No description", { exact: true }),
  ).toBeVisible();
  await expect(details.getByText("No labels", { exact: true })).toBeVisible();
  await expect(
    details.getByText("Checkout availability", { exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`editing sidebar details refreshes the card and hero at ${width}px`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openOverview(page);
    const details: Locator = card(page, "SLO Details");
    await details
      .getByRole("button", { name: "Edit Service Level Objective" })
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(
      dialog.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Checkout availability");
    await expect(
      dialog.getByRole("textbox", {
        name: "Description (Optional)",
        exact: true,
      }),
    ).toHaveValue(DESCRIPTION);
    await expect(
      dialog.getByRole("combobox", { name: "Labels (Optional)", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Purchase availability");
    await dialog
      .getByRole("textbox", { name: "Description (Optional)", exact: true })
      .fill("Availability for completed purchases.");
    await dialog
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      details.getByText("Purchase availability", { exact: true }),
    ).toBeVisible();
    await expect(details).toContainText(
      "Availability for completed purchases.",
    );
    await expect(page.getByTestId("slo-overview-hero")).toContainText(
      "Availability for completed purchases.",
    );
    await expect(details.getByText("checkout", { exact: true })).toBeVisible();
    await expect(
      details.getByText("customer-impact", { exact: true }),
    ).toBeVisible();

    await details
      .getByRole("button", { name: "Edit Service Level Objective" })
      .click();
    await expect(
      dialog.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Purchase availability");
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Discard this change");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      details.getByText("Purchase availability", { exact: true }),
    ).toBeVisible();
    await expect(details).not.toContainText("Discard this change");
  });
}

test("documentation remains accessible from the sidebar", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openOverview(page);
  const popupPromise: Promise<Page> = page.waitForEvent("popup");
  await card(page, "SLO Details")
    .getByRole("button", { name: "View Documentation", exact: true })
    .click();
  const popup: Page = await popupPromise;
  await expect(popup).toHaveURL(/\/docs\/slo\/error-budget$/);
  await popup.close();
});
