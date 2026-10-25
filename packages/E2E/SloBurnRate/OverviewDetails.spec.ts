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
    /*
     * The card, its header and its fields all fit, at every width. The
     * fields' box used to pull itself out 24px whatever the card's padding,
     * so on a phone (20px) its rule ran 4px past the card's edges: this
     * checked only the header and the fields there. The box is the card's
     * ruled body now, padded as the card is.
     */
    const fittedRegions: Array<Locator> = [
      details,
      details.getByTestId("card-header"),
      details.locator("#slo-details"),
    ];
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
    /*
     * The labels fold under More fields, as on the create form, and the
     * folded header shows how many this SLO has. This save leaves them folded: folded
     * values are saved all the same, so the card keeps both labels.
     */
    const advanced: Locator = dialog.getByRole("button", {
      name: "More fields",
      exact: true,
    });
    const labels: Locator = dialog.getByRole("combobox", {
      name: "Labels (Optional)",
      exact: true,
    });
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await expect(advanced).toContainText("Labels: 2");
    await expect(labels).toBeHidden();
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
    // One click shows the labels that save kept, ready to change.
    await expect(advanced).toContainText("Labels: 2");
    await advanced.click();
    await expect(advanced).toHaveAttribute("aria-expanded", "true");
    await expect(labels).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Remove checkout", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Remove customer-impact",
        exact: true,
      }),
    ).toBeVisible();
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
  const details: Locator = card(page, "SLO Details");
  /*
   * In the card's ⋯, as a table keeps its documentation - not a button of
   * its own beside Edit.
   */
  await expect(
    details.getByRole("button", { name: "View Documentation", exact: true }),
  ).toHaveCount(0);
  await details
    .getByTestId("card-header-actions")
    .getByRole("button", { name: "More options", exact: true })
    .click();
  const popupPromise: Promise<Page> = page.waitForEvent("popup");
  await page
    .getByRole("menuitem", { name: "View Documentation", exact: true })
    .click();
  const popup: Page = await popupPromise;
  await expect(popup).toHaveURL(/\/docs\/slo\/error-budget$/);
  await popup.close();
});

/*
 * "If I click on add owners, I should be able to add owners from this page
 * directly instead of going to owners page." The hero adds owners right
 * there - Add owners on an SLO nobody owns, the place after the avatars on
 * one that has owners - each opening the Owners page's own list under it.
 */
const SLO_ID: string = "20000000-0000-4000-8000-000000000001";
const CHECKOUT_TEAM_ID: string = "a0000000-0000-4000-8000-000000000001";
const JANE_ID: string = "b0000000-0000-4000-8000-000000000001";

interface SloOwnerAdd {
  model: string;
  serviceLevelObjectiveId: string;
  id: string;
}

async function sloOwnerAdds(page: Page): Promise<Array<SloOwnerAdd>> {
  return await page.evaluate((): Array<SloOwnerAdd> => {
    return (
      (window as unknown as { __sloOwnerAdds?: Array<SloOwnerAdd> })
        .__sloOwnerAdds || []
    );
  });
}

test("the hero adds owners right there, from the Owners page's list", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openOverview(page);

  const owners: Locator = page.getByTestId("slo-overview-owners");
  const add: Locator = owners.getByRole("button", { name: "Add owners" });
  await expect(add).toHaveAttribute("data-testid", "slo-overview-add-owners");
  await expect(add).toHaveAttribute("aria-haspopup", "dialog");
  // Nothing sends the reader to the Owners page to add one.
  await expect(owners.getByRole("link")).toHaveCount(0);
  /*
   * "No owners", then "+ Add owners" - as the monitor overview says it, so
   * the two heroes read alike (UI review).
   */
  await expect(owners.getByText("No owners", { exact: true })).toBeVisible();
  const noOwners: Awaited<ReturnType<typeof bounds>> = await bounds(
    owners.getByText("No owners", { exact: true }),
  );
  const addBox: Awaited<ReturnType<typeof bounds>> = await bounds(add);
  expect(addBox.x, "Add owners after No owners").toBeGreaterThan(
    noOwners.x + noOwners.width,
  );
  expect(
    Math.abs(addBox.y + addBox.height / 2 - (noOwners.y + noOwners.height / 2)),
    "on one line",
  ).toBeLessThanOrEqual(2);
  await expect(add.locator("svg")).toHaveCount(1);
  await add.click();

  const list: Locator = page.getByRole("dialog", { name: "Add owners" });
  await expect(
    list.getByRole("combobox", { name: "Search people or teams..." }),
  ).toBeFocused();
  // The project's people, then its teams.
  await expect(list.getByTestId("people-search-option")).toHaveText([
    /Jane Doe/,
    /Sam Lee/,
    /Checkout team/,
    /Major incident team/,
  ]);
  const control: Awaited<ReturnType<typeof bounds>> = await bounds(add);
  const popup: Awaited<ReturnType<typeof bounds>> = await bounds(list);
  expect(popup.y).toBeGreaterThanOrEqual(control.y + control.height - 0.5);

  await list.getByRole("option", { name: /Checkout team/ }).click();

  /*
   * Added: the hero names the new owner, and the list stays open - now on
   * the place after the avatars, lit while it is open - for the next.
   */
  await expect(list.getByTestId("people-search-notice-done")).toHaveText(
    "Added Checkout team.",
  );
  const more: Locator = owners.getByRole("button", { name: "Add owners" });
  await expect(more).toHaveAttribute(
    "data-testid",
    "slo-overview-add-more-owners",
  );
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByTestId("people-search-option")).toHaveText([
    /Jane Doe/,
    /Sam Lee/,
    /Major incident team/,
  ]);

  await list.getByRole("option", { name: /Jane Doe/ }).click();
  await expect(list.getByTestId("people-search-notice-done")).toHaveText(
    "Added Jane Doe.",
  );
  expect(await sloOwnerAdds(page)).toEqual([
    {
      model: "ServiceLevelObjectiveOwnerTeam",
      serviceLevelObjectiveId: SLO_ID,
      id: CHECKOUT_TEAM_ID,
    },
    {
      model: "ServiceLevelObjectiveOwnerUser",
      serviceLevelObjectiveId: SLO_ID,
      id: JANE_ID,
    },
  ]);
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, "slo-overview-owners-added.png"),
    animations: "disabled",
  });

  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(new URL(page.url()).pathname).toBe(OVERVIEW_ROUTE);
});

test("?owners=team: the place after the avatars offers whoever does not own the SLO yet", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openOverview(page, "?owners=team");

  const more: Locator = page
    .getByTestId("slo-overview-owners")
    .getByRole("button", { name: "Add owners" });
  await expect(more).toHaveAttribute(
    "data-testid",
    "slo-overview-add-more-owners",
  );
  await more.click();

  const list: Locator = page.getByRole("dialog", { name: "Add owners" });
  await expect(list.getByTestId("people-search-option")).toHaveText([
    /Jane Doe/,
    /Sam Lee/,
    /Major incident team/,
  ]);
  // Whole on a phone's screen, under its control.
  await expect
    .poll(async (): Promise<boolean> => {
      const box: Awaited<ReturnType<Locator["boundingBox"]>> =
        await list.boundingBox();
      return Boolean(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= 390.5 &&
          box.y + box.height <= 900.5,
      );
    }, "the list is whole on screen")
    .toBe(true);
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, "slo-overview-owners-add-list-390.png"),
    animations: "disabled",
  });
});
