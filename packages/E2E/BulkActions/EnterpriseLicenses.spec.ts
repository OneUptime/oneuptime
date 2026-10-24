import { APIResponse, expect, Locator, Page, test } from "@playwright/test";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";

/*
 * Admin Dashboard > Enterprise Licenses, in a browser, against the offline
 * fixture (BulkActions/Fixture): Delete in each row's ⋯ menu and in Bulk
 * Actions, and the bulk Change Expiry Date.
 *
 * "Please add delete option in more, also add bulk actions for this table."
 * - the maintainer, on this list, whose rows' ⋯ held only Show ID, beside
 * two expired licenses of one company. So every dialog names a license by
 * its company AND its masked key, and every Delete says what deleting one
 * does to the installations that use its key.
 *
 * The screen ships in the Enterprise Edition; the fixture reaches it through
 * the Admin Dashboard's plugin, as the Admin Dashboard does. Where ee/ is
 * not checked out (the Dashboard Offline UI job removes it) the fixture
 * builds the Community Edition, and these tests are skipped.
 */

const LICENSES: string = "/admin/settings/enterprise-licenses?page=licenses";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/bulk-actions-ui",
);

const ADMIN_LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/AdminDashboard/src/Locales",
);

const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const IDS: Record<string, string> = {
  netlockA: "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e01",
  netlockB: "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e02",
  govtech: "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e03",
};

// How every dialog names a license: its company and its masked key.
const NAMES: Record<string, string> = {
  netlockA: "Netlock.hu · da74••••7c7a",
  netlockB: "Netlock.hu · e639••••e1f4",
  govtech: "GovTech Singapore · 832c••••8915",
};

// DeleteConsequences' sentence for a license.
const LICENSE_CONSEQUENCE: string =
  "Deleting a license also deletes its instances. Installations that use its key keep the license they already hold until it expires, but can no longer refresh or reactivate it, and their seat reports are refused.";

const NEW_EXPIRY_DESCRIPTION: string =
  "A date after today. Installations get it with their daily report, or at once when their admin presses Refresh license.";

interface RecordedWrite {
  tableName: string;
  id: string;
  data?: Record<string, unknown>;
}

let edition: string = "";

test.beforeAll(
  async ({
    request,
  }: {
    request: { get: (url: string) => Promise<APIResponse> };
  }) => {
    const response: APIResponse = await request.get("/edition.json");
    edition = ((await response.json()) as { edition: string }).edition;
  },
);

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  test.skip(
    edition !== "enterprise",
    "The Enterprise Licenses screen ships in the Enterprise Edition, and ee/ is not checked out.",
  );

  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

function readAdminLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(ADMIN_LOCALES, `${language}.json`), "utf-8"),
  ) as Record<string, unknown>;
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `licenses-${name}-synthetic.png`),
    fullPage: false,
    animations: "disabled",
  });
}

async function openList(page: Page, search: string = ""): Promise<void> {
  await page.goto(`${LICENSES}${search}`);
  await expect(page.getByRole("checkbox").first()).toBeVisible();
}

/*
 * A license's select box, on its row or its phone card: "Select Enterprise
 * License: Netlock.hu · da74••••7c7a", whose kind is in the reader's
 * language.
 */
function checkbox(page: Page, name: string): Locator {
  return page.getByRole("checkbox", {
    name: new RegExp(`^Select [^:]+: ${escapeRegExp(name)}$`),
  });
}

async function select(page: Page, names: Array<string>): Promise<void> {
  for (const name of names) {
    await checkbox(page, name).check();
  }
}

/*
 * The row - or, on a phone, the card - a license is drawn in: the
 * innermost element that holds both its select box and a ⋯ button.
 */
function rowOf(page: Page, name: string): Locator {
  return page
    .locator("tr, div")
    .filter({ has: checkbox(page, name) })
    .filter({ has: page.getByTestId("row-actions-more-button") })
    .last();
}

async function openBulkMenu(
  page: Page,
  title: string = "Bulk Actions",
): Promise<Locator> {
  await page.getByText(title, { exact: true }).click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

async function writesSent(
  page: Page,
): Promise<{ updates: Array<RecordedWrite>; deletes: Array<RecordedWrite> }> {
  return await page.evaluate(
    (): { updates: Array<RecordedWrite>; deletes: Array<RecordedWrite> } => {
      const fixture: {
        updates: Array<RecordedWrite>;
        deletes: Array<RecordedWrite>;
      } = (
        window as unknown as {
          __fixture: {
            updates: Array<RecordedWrite>;
            deletes: Array<RecordedWrite>;
          };
        }
      ).__fixture;
      return { updates: fixture.updates, deletes: fixture.deletes };
    },
  );
}

async function openRowDelete(page: Page, name: string): Promise<void> {
  await rowOf(page, name).getByTestId("row-actions-more-button").click();
  const menu: Locator = page.getByRole("menu");
  const isPhone: boolean = (page.viewportSize()?.width || 0) < 640;

  // Show ID is left off phones (hideOnMobile); Delete is not.
  await expect(menu.getByRole("menuitem")).toHaveText(
    isPhone ? ["Delete"] : ["Show ID", "Delete"],
  );
  await menu.getByRole("menuitem", { name: "Delete" }).click();
  await expect(dialog(page)).toBeVisible();
}

async function openChangeExpiry(
  page: Page,
  names: Array<string>,
): Promise<void> {
  await select(page, names);
  const menu: Locator = await openBulkMenu(page);
  await menu
    .getByRole("menuitem", { name: "Change Expiry Date", exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();
}

// The day after tomorrow, and yesterday, as a date field takes them.
function dayFromToday(days: number): string {
  const date: Date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test.describe("a license's ⋯ menu", () => {
  test("offers Delete; its dialog names the license by company and masked key, and says what deleting does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await openRowDelete(page, NAMES["netlockA"]!);

    // Two licenses of one company: only the key tells them apart.
    await expect(page.getByTestId("delete-confirmation-message")).toContainText(
      `Are you sure you want to delete ${NAMES["netlockA"]}?`,
    );
    await expect(
      page.getByTestId("delete-confirmation-consequence"),
    ).toHaveText(LICENSE_CONSEQUENCE);
    // The full key is never shown.
    await expect(dialog(page)).not.toContainText("da740000");
    await screenshot(page, "row-delete-dialog");

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toBeHidden();

    expect((await writesSent(page)).deletes).toEqual([
      { tableName: "EnterpriseLicense", id: IDS["netlockA"] },
    ]);
    // The other Netlock license stays.
    await expect(checkbox(page, NAMES["netlockA"]!)).toHaveCount(0);
    await expect(checkbox(page, NAMES["netlockB"]!)).toHaveCount(1);
  });
});

test.describe("Bulk Actions", () => {
  test("offer Change Expiry Date and Delete", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await select(page, [NAMES["netlockA"]!]);
    const menu: Locator = await openBulkMenu(page);

    await expect(menu.getByRole("menuitem")).toHaveText([
      "Change Expiry Date",
      "Export CSV",
      "Delete",
    ]);
    await screenshot(page, "bulk-menu");
  });

  /*
   * The file reads like the list: every key masked as its row shows it -
   * never a key an installation activates with - and the type, status and
   * seats in the list's words.
   */
  test("Export CSV writes the licenses as the list shows them, keys masked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await select(page, [NAMES["netlockA"]!, NAMES["govtech"]!]);
    const menu: Locator = await openBulkMenu(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      menu.getByRole("menuitem", { name: "Export CSV", exact: true }).click(),
    ]);
    const csv: string = fs.readFileSync(
      (await download.path()) as string,
      "utf-8",
    );
    const lines: Array<string> = csv
      .replace(String.fromCharCode(0xfeff), "")
      .split("\r\n");

    expect(lines[0]).toBe(
      "Company,Email,License Key,Type,Status,Seats,Expires At,Last Report",
    );
    expect(lines.slice(1)).toEqual([
      `Netlock.hu,,da74••••7c7a,Evaluation,Expired,0 / 50 users,"Sep 30, 2026",`,
      `GovTech Singapore,,832c••••8915,Production,Active,13 / 150 users,"Oct 09, 2099",`,
    ]);
    // The fixture's keys are the masked ends around 56 zeros.
    expect(csv).not.toContain("0".repeat(56));
  });

  test("a bulk Delete names each license, says what deleting does, and deletes exactly those", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await select(page, [NAMES["netlockA"]!, NAMES["netlockB"]!]);
    const menu: Locator = await openBulkMenu(page);
    await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();

    await expect(page.getByTestId("delete-confirmation-item")).toHaveText([
      NAMES["netlockA"]!,
      NAMES["netlockB"]!,
    ]);
    await expect(page.getByTestId("bulk-delete-consequence")).toContainText(
      LICENSE_CONSEQUENCE,
    );
    await screenshot(page, "bulk-delete-dialog");

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Enterprise Licenses deleted",
    );
    expect((await writesSent(page)).deletes).toEqual([
      { tableName: "EnterpriseLicense", id: IDS["netlockA"] },
      { tableName: "EnterpriseLicense", id: IDS["netlockB"] },
    ]);
  });

  test("Change Expiry Date asks for a day after today, writes it to each license, and leaves one already on that day alone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await openChangeExpiry(page, [
      NAMES["netlockA"]!,
      NAMES["netlockB"]!,
      NAMES["govtech"]!,
    ]);

    await expect(dialog(page)).toContainText(
      "The 3 selected licenses will expire on the date you pick.",
    );
    await expect(dialog(page)).toContainText(NEW_EXPIRY_DESCRIPTION);
    await screenshot(page, "change-expiry-dialog");

    // GovTech's own expiry day.
    await dialog(page).locator('input[type="date"]').fill("2099-10-09");
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Enterprise Licenses updated",
    );
    await expect(page.getByTestId("bulk-action-unchanged-count")).toHaveText(
      "1 Enterprise License not changed",
    );
    await expect(
      page.getByTestId("bulk-action-unchanged-items-group"),
    ).toHaveText([
      `Enterprise License: ${NAMES["govtech"]}Already expires on this date.`,
    ]);
    await screenshot(page, "change-expiry-result");

    expect((await writesSent(page)).updates).toEqual([
      {
        tableName: "EnterpriseLicense",
        id: IDS["netlockA"],
        data: { expiresAt: "2099-10-09" },
      },
      {
        tableName: "EnterpriseLicense",
        id: IDS["netlockB"],
        data: { expiresAt: "2099-10-09" },
      },
    ]);
  });

  test("a day that is not after today is refused before anything is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await openChangeExpiry(page, [NAMES["netlockA"]!]);

    await expect(dialog(page)).toContainText(
      "The selected license will expire on the date you pick.",
    );
    await dialog(page).locator('input[type="date"]').fill(dayFromToday(-1));
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(dialog(page)).toContainText(
      "New Expiry Date should be a future date.",
    );
    expect((await writesSent(page)).updates).toEqual([]);
  });

  test("a license the server refuses is listed with its words; the rest change", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, `&refuse=${IDS["netlockB"]}`);
    await openChangeExpiry(page, [NAMES["netlockA"]!, NAMES["netlockB"]!]);
    await dialog(page).locator('input[type="date"]').fill(dayFromToday(365));
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Enterprise License updated",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Enterprise License not updated",
    );
    await expect(page.getByTestId("bulk-action-failed-items")).toContainText(
      `Enterprise License: ${NAMES["netlockB"]}`,
    );
    await expect(page.getByTestId("bulk-action-failed-items")).toContainText(
      "Enterprise License not found.",
    );
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test("the row Delete and Change Expiry Date dialogs fit the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await openRowDelete(page, NAMES["netlockA"]!);
    await expect(
      page.getByTestId("delete-confirmation-consequence"),
    ).toHaveText(LICENSE_CONSEQUENCE);
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toBeInViewport();
    await screenshot(page, "row-delete-dialog-phone");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();

    await openChangeExpiry(page, [NAMES["netlockA"]!, NAMES["netlockB"]!]);
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toBeInViewport();
    const widths: { scroll: number; inner: number } = await page.evaluate(
      (): { scroll: number; inner: number } => {
        return {
          scroll: (document.scrollingElement as Element).scrollWidth,
          inner: window.innerWidth,
        };
      },
    );
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    await screenshot(page, "change-expiry-dialog-phone");
  });
});

test.describe("in dark mode", () => {
  for (const viewport of [{ width: 1280, height: 900 }, PHONE]) {
    test(`the Delete and Change Expiry Date dialogs are drawn dark, at ${viewport.width} pixels`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport);
      await openList(page, "&theme=dark");
      await expect(page.locator("html")).toHaveClass(/dark/);

      await openRowDelete(page, NAMES["netlockA"]!);
      await expect(
        page.getByTestId("delete-confirmation-consequence"),
      ).toBeVisible();
      await screenshot(page, `row-delete-dialog-dark-${viewport.width}`);
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
      await expect(dialog(page)).toBeHidden();

      await openChangeExpiry(page, [NAMES["netlockA"]!, NAMES["netlockB"]!]);
      await screenshot(page, `change-expiry-dialog-dark-${viewport.width}`);
    });
  }
});

test.describe("in German", () => {
  test("Change Expiry Date and the Delete dialog read in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    const german: Record<string, unknown> = readAdminLocale("de");
    const word: (english: string) => string = (english: string): string => {
      return german[english] as string;
    };

    await openList(page, "&lang=de");
    await select(page, [NAMES["netlockA"]!, NAMES["netlockB"]!]);
    const menu: Locator = await openBulkMenu(page, word("Bulk Actions"));
    await expect(menu.getByRole("menuitem").first()).toHaveText(
      word("Change Expiry Date"),
    );
    await menu.getByRole("menuitem").first().click();

    await expect(dialog(page)).toContainText(word(NEW_EXPIRY_DESCRIPTION));
    await expect(dialog(page)).not.toContainText(NEW_EXPIRY_DESCRIPTION);
    await screenshot(page, "change-expiry-dialog-german");
    await dialog(page)
      .getByRole("button")
      .filter({ hasText: word("Cancel") })
      .click();
    await expect(dialog(page)).toBeHidden();

    await openBulkMenu(page, word("Bulk Actions"));
    await page.getByRole("menuitem").last().click();
    await expect(page.getByTestId("bulk-delete-consequence")).toContainText(
      word(LICENSE_CONSEQUENCE),
    );
    await screenshot(page, "bulk-delete-dialog-german");
  });
});
