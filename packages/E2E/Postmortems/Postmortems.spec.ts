import { expect, Locator, Page, test } from "@playwright/test";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs/promises";
import path from "path";

/*
 * Postmortems across every incident, in a browser, against the offline
 * fixture (Postmortems/Fixture): Incidents -> Postmortems, an incident's
 * Postmortem page and Incidents -> Settings -> Postmortem Statuses, each the
 * production page beside its real side menu.
 *
 * The customer's ask: "is there any way I can view and filter postmortem
 * reports across all incidents - by team/owner, severity, postmortem report
 * status (not started, draft and a few custom statuses)?" And the
 * maintainer's: make postmortems easy to use and easy to understand, with
 * the advanced things out of the way. The fixture records every move the
 * pages send, so the tests check what was asked of the server as well as
 * what was drawn.
 */

const PROJECT: string = "/dashboard/10000000-0000-4000-8000-0000000000a1";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/postmortems-ui",
);

// The fixture's statuses and incidents, by number.
const statusId: (number: number) => string = (number: number): string => {
  return `a0000000-0000-4000-8000-00000000000${number}`;
};
const incidentId: (number: number) => string = (number: number): string => {
  return `b0000000-0000-4000-8000-00000000010${number}`;
};

const NOT_STARTED: string = statusId(1);
const DRAFT: string = statusId(2);
const COMPLETED: string = statusId(3);
const NOT_NEEDED: string = statusId(4);
const IN_REVIEW: string = statusId(5);

interface RecordedUpdate {
  model: string;
  id: string;
  data: Record<string, unknown>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

/*
 * The whole page, or - for an open menu or dialog, which is fixed to the
 * window - the window as it is seen.
 */
async function screenshot(
  page: Page,
  name: string,
  fullPage: boolean = true,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: fullPage,
    animations: "disabled",
  });
}

async function openList(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${PROJECT}/incidents/postmortems?page=list${query}`);
  await expect(page.locator("tbody tr").first()).toBeVisible();
}

function row(page: Page, title: string): Locator {
  return page
    .locator("tbody tr")
    .filter({ has: page.getByText(title, { exact: true }) });
}

function rowStatus(page: Page, title: string): Locator {
  return row(page, title).getByTestId("postmortem-row-status-pill");
}

function count(page: Page, status: string): Locator {
  return page.getByTestId(`postmortem-status-count-${status}`);
}

function tile(page: Page, name: string): Locator {
  return page
    .getByTestId("postmortem-status-summary-cards")
    .getByRole("button", {
      name: new RegExp(`^${escapeRegExp(name)}: \\d+\\.`),
    });
}

async function updatesSent(page: Page): Promise<Array<RecordedUpdate>> {
  return await page.evaluate((): Array<RecordedUpdate> => {
    return (
      window as unknown as { __fixture: { updates: Array<RecordedUpdate> } }
    ).__fixture.updates;
  });
}

// The status id an update moved a postmortem to, however the ObjectID was serialised.
function movedTo(update: RecordedUpdate): string {
  const value: unknown = update.data["postmortemStatusId"];

  if (value && typeof value === "object") {
    return String((value as { value?: unknown }).value);
  }

  return String(value);
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

// Nothing on the page reaches past the window's right edge.
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });

  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("Incidents -> Postmortems", () => {
  test("lists every incident's postmortem, newest first, with a tile counting each status", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);

    await expect(
      page.getByRole("heading", { name: "Postmortems", exact: true }),
    ).toBeVisible();

    // Three not started, a draft, one completed and one that needs none.
    await expect(count(page, NOT_STARTED)).toHaveText("3");
    await expect(count(page, DRAFT)).toHaveText("1");
    await expect(count(page, COMPLETED)).toHaveText("1");
    await expect(count(page, NOT_NEEDED)).toHaveText("1");

    await expect(page.locator("tbody tr")).toHaveCount(6);
    await expect(page.locator("tbody tr").first()).toContainText(
      "Checkout API errors after Postgres disk filled up",
    );
    await expect(
      rowStatus(page, "Checkout API errors after Postgres disk filled up"),
    ).toHaveText(/Draft/);
    await expect(rowStatus(page, "Payments webhook delays")).toHaveText(
      /Not Started/,
    );
    await expect(
      row(page, "Checkout API errors after Postgres disk filled up"),
    ).toContainText("Critical");

    // The list fits beside the side menu at a laptop's width.
    await expectNoSidewaysScroll(page);

    await screenshot(page, "list");
  });

  test("a tile lists only the postmortems it counts and lights; a second click lists them all again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await expect(count(page, NOT_STARTED)).toHaveText("3");

    await tile(page, "Not Started").click();

    await expect(page.locator("tbody tr")).toHaveCount(3);
    for (const title of [
      "Payments webhook delays",
      "Elevated 5xx on the public API gateway after the 14.0.80 deploy",
      "Background jobs backlog",
    ]) {
      await expect(rowStatus(page, title)).toHaveText(/Not Started/);
    }
    await expect(tile(page, "Not Started")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(tile(page, "Draft")).toHaveAttribute("aria-pressed", "false");

    await screenshot(page, "list-not-started");

    await tile(page, "Not Started").click();

    await expect(page.locator("tbody tr")).toHaveCount(6);
    await expect(tile(page, "Not Started")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("a row's status moves its postmortem at once, and the counts follow", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await expect(count(page, NOT_NEEDED)).toHaveText("1");

    await rowStatus(page, "Payments webhook delays").click();

    // Every status a postmortem can move to, the one it is in ticked.
    await expect(page.getByRole("menuitemradio")).toHaveText([
      "Not Started",
      "Draft",
      "Completed",
      "Not Needed",
    ]);
    await expect(
      page.getByRole("menuitemradio", { name: "Not Started" }),
    ).toHaveAttribute("aria-checked", "true");

    await screenshot(page, "row-status-menu", false);

    await page.getByRole("menuitemradio", { name: "Not Needed" }).click();

    await expect(rowStatus(page, "Payments webhook delays")).toHaveText(
      /Not Needed/,
    );
    await expect(count(page, NOT_STARTED)).toHaveText("2");
    await expect(count(page, NOT_NEEDED)).toHaveText("2");

    const updates: Array<RecordedUpdate> = await updatesSent(page);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.model).toBe("Incident");
    expect(updates[0]!.id).toBe(incidentId(2));
    expect(Object.keys(updates[0]!.data)).toEqual(["postmortemStatusId"]);
    expect(movedTo(updates[0]!)).toBe(NOT_NEEDED);
  });

  test("a move the server refuses is put back, with the reason", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "&fail=move");

    await rowStatus(page, "Payments webhook delays").click();
    await page.getByRole("menuitemradio", { name: "Completed" }).click();

    await expect(
      row(page, "Payments webhook delays").getByRole("alert"),
    ).toContainText("Could not change the postmortem's status.");
    await expect(rowStatus(page, "Payments webhook delays")).toHaveText(
      /Not Started/,
    );
    await expect(count(page, COMPLETED)).toHaveText("1");
  });

  test("Change Postmortem Status moves the selected postmortems to one status, archived ones never offered", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "&custom=1");
    await expect(count(page, IN_REVIEW)).toHaveText("1");

    for (const title of [
      "Payments webhook delays",
      "Background jobs backlog",
    ]) {
      await row(page, title).locator('input[type="checkbox"]').first().check();
    }

    await page.getByText("Bulk Actions", { exact: true }).click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Change Postmortem Status" })
      .click();

    await expect(
      dialog(page).getByRole("heading", { name: "Change Postmortem Status" }),
    ).toBeVisible();

    await dialog(page).getByRole("combobox").click();
    // The dialog's dropdown, not the table's page-size picker under it.
    await expect(
      page.locator(".ou-select__menu").getByRole("option"),
    ).toHaveText([
      "Not Started",
      "Draft",
      "In Review",
      "Completed",
      "Not Needed",
    ]);

    await screenshot(page, "bulk-dialog", false);

    await page.getByRole("option", { name: "Not Needed", exact: true }).click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toBeVisible();

    const updates: Array<RecordedUpdate> = await updatesSent(page);

    expect(
      updates
        .map((update: RecordedUpdate): string => {
          return `${update.id}:${movedTo(update)}`;
        })
        .sort(),
    ).toEqual(
      [
        `${incidentId(2)}:${NOT_NEEDED}`,
        `${incidentId(6)}:${NOT_NEEDED}`,
      ].sort(),
    );

    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(count(page, NOT_NEEDED)).toHaveText("3");
    await expect(count(page, NOT_STARTED)).toHaveText("1");
  });

  test("a viewer reads where each postmortem stands, with nothing to move it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "&role=viewer");

    await expect(rowStatus(page, "Payments webhook delays")).toHaveText(
      /Not Started/,
    );
    await expect(
      page.getByRole("button", { name: /^Postmortem status:/ }),
    ).toHaveCount(0);
  });

  test("a project with no incidents yet: no tiles, and the list says what it will hold", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${PROJECT}/incidents/postmortems?page=list&empty=1`);

    await expect(page.getByText("No postmortems yet")).toBeVisible();
    await expect(
      page.getByText(
        "Every incident has a postmortem to write. Once an incident is declared, its postmortem is listed here.",
      ),
    ).toBeVisible();
    await expect(
      page.getByTestId("postmortem-status-summary-cards"),
    ).toHaveCount(0);

    await screenshot(page, "list-empty");
  });

  test("on a phone the tiles sit two to a line and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${PROJECT}/incidents/postmortems?page=list`);
    await expect(count(page, NOT_STARTED)).toHaveText("3");

    const first: { x: number; y: number } | null = await tile(
      page,
      "Not Started",
    ).boundingBox();
    const second: { x: number; y: number } | null = await tile(
      page,
      "Draft",
    ).boundingBox();
    const third: { x: number; y: number } | null = await tile(
      page,
      "Completed",
    ).boundingBox();

    // Not Started and Draft share a line; Completed starts the next.
    expect(Math.abs((first?.y || 0) - (second?.y || 0))).toBeLessThan(2);
    expect((third?.y || 0) - (first?.y || 0)).toBeGreaterThan(20);

    await expectNoSidewaysScroll(page);
    await screenshot(page, "list-phone");
  });

  test("in dark mode", async ({ page }: { page: Page }) => {
    await openList(page, "&theme=dark&custom=1");
    await expect(count(page, IN_REVIEW)).toHaveText("1");

    await screenshot(page, "list-dark");
  });

  test("in German, the tiles and pills name the statuses as the Dashboard does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "&lang=de");

    await expect(
      page.getByRole("heading", { name: "Postmortem-Analysen", exact: true }),
    ).toBeVisible();
    await expect(tile(page, "Nicht gestartet")).toBeVisible();
    await expect(rowStatus(page, "Payments webhook delays")).toHaveText(
      /Nicht gestartet/,
    );

    await expectNoSidewaysScroll(page);
    await screenshot(page, "list-german");
  });
});

test.describe("an incident's Postmortem page", () => {
  async function openTab(page: Page, query: string): Promise<void> {
    await page.goto(`${PROJECT}/incidents/postmortems?page=tab${query}`);
    await expect(page.getByTestId("postmortem-summary")).toBeVisible();
  }

  test("a written postmortem: where it stands and who owns it on top, Edit Postmortem Note, and the template and AI draft folded into the ⋯", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTab(page, "&incident=1");

    const summary: Locator = page.getByTestId("postmortem-summary");

    await expect(summary.getByTestId("postmortem-status-pill")).toHaveText(
      /Draft/,
    );
    await expect(summary).toContainText("Alice Smith");
    await expect(summary).toContainText("Database Team");
    await expect(
      summary.getByRole("link", { name: "Change owners" }),
    ).toHaveAttribute("href", `${PROJECT}/incidents/${incidentId(1)}/owners`);

    await expect(
      page.getByRole("button", { name: "Edit Postmortem Note" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Write Postmortem" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "More postmortem options" }).click();
    await expect(page.getByRole("menuitem")).toHaveText([
      "Apply Template",
      "Generate with AI",
    ]);

    await screenshot(page, "tab-written");
  });

  test("nothing written yet: Write Postmortem, with Start from Template and Generate with AI beside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTab(page, "&incident=2");

    await expect(
      page
        .getByTestId("postmortem-summary")
        .getByTestId("postmortem-status-pill"),
    ).toHaveText(/Not Started/);
    await expect(page.getByText("No postmortem yet")).toBeVisible();
    await expect(page.getByTestId("postmortem-write-button")).toBeVisible();
    await expect(
      page.getByTestId("postmortem-start-from-template-button"),
    ).toBeVisible();
    await expect(
      page.getByTestId("postmortem-generate-with-ai-button"),
    ).toBeVisible();
    // Nothing to edit yet, and nothing folded away.
    await expect(
      page.getByRole("button", { name: "Edit Postmortem Note" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "More postmortem options" }),
    ).toHaveCount(0);

    await screenshot(page, "tab-empty");

    await page.getByTestId("postmortem-write-button").click();
    await expect(
      dialog(page).getByRole("heading", { name: "Write Postmortem" }),
    ).toBeVisible();
    await expect(dialog(page)).toContainText("Postmortem Note");

    await screenshot(page, "tab-write-dialog", false);
  });

  test("with no template and AI off, Write Postmortem is the one button", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTab(page, "&incident=2&templates=0&ai=off");

    await expect(page.getByTestId("postmortem-write-button")).toBeVisible();
    await expect(
      page.getByTestId("postmortem-start-from-template-button"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("postmortem-generate-with-ai-button"),
    ).toHaveCount(0);
  });

  test("its status moves from the pill at the top of the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTab(page, "&incident=1");

    await page
      .getByTestId("postmortem-summary")
      .getByTestId("postmortem-status-pill")
      .click();
    await page.getByRole("menuitemradio", { name: "Completed" }).click();

    await expect(
      page
        .getByTestId("postmortem-summary")
        .getByTestId("postmortem-status-pill"),
    ).toHaveText(/Completed/);

    const updates: Array<RecordedUpdate> = await updatesSent(page);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe(incidentId(1));
    expect(movedTo(updates[0]!)).toBe(COMPLETED);
  });

  test("on a phone, status and owners stack and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTab(page, "&incident=1");

    await expectNoSidewaysScroll(page);
    await screenshot(page, "tab-phone");
  });
});

test.describe("Incidents -> Settings -> Postmortem Statuses", () => {
  async function openSettings(page: Page, query: string = ""): Promise<void> {
    await page.goto(`${PROJECT}/incidents/postmortems?page=settings${query}`);
    await expect(page.getByTestId("state-settings-name").first()).toBeVisible();
  }

  test("lists the statuses top first, each with what it counts as, the built-in ones marked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page);

    await expect(page.getByTestId("state-settings-name")).toHaveText([
      /Not Started/,
      /Draft/,
      /Completed/,
      /Not Needed/,
    ]);
    await expect(page.getByTestId("state-settings-counts-as")).toHaveText([
      "Not started",
      "In progress",
      "Done",
      "Done",
    ]);
    await expect(page.getByTestId("state-settings-built-in")).toHaveCount(3);

    await screenshot(page, "settings");
  });

  test("a status of the project's own counts by where it sits, and an archived one is folded away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page, "&custom=1");

    await expect(page.getByTestId("state-settings-name")).toHaveText([
      /Not Started/,
      /Draft/,
      /In Review/,
      /Completed/,
      /Not Needed/,
    ]);
    await expect(page.getByTestId("state-settings-counts-as")).toHaveText([
      "Not started",
      "In progress",
      "In progress",
      "Done",
      "Done",
    ]);
    await expect(page.getByTestId("archived-values-section")).toContainText(
      "Archived Postmortem Statuses",
    );

    await screenshot(page, "settings-custom");
  });
});
