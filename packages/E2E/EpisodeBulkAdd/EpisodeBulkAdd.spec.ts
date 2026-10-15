import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Adding several alerts or incidents to an episode at once, in a browser,
 * against the offline fixture (EpisodeBulkAdd/Fixture): the real Alerts and
 * Incidents lists - their Bulk Actions "Add to Existing Episode" and "Add to
 * New Episode" - and an episode's own Alerts / Incidents page with its
 * several-at-once "Add Alerts" dialog.
 *
 * The maintainer's ask: "UI wise, I expected to do a multi select alerts.
 * Bulk actions - Add to existing / new episode. Please do this for incidents
 * as well." The screenshot was the old one-at-a-time "Add New Alert Episode
 * Member" dialog. The fixture records each request the page sends, so the
 * tests check what was asked of the server as well as what the page drew.
 */

const PROJECT: string = "/dashboard/10000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/episode-bulk-add-ui",
);

// The fixture's records and episodes, by number.
const alertId: (number: number) => string = (number: number): string => {
  return `23000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
};
const alertEpisodeId: (number: number) => string = (number: number): string => {
  return `24000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
};
const incidentId: (number: number) => string = (number: number): string => {
  return `33000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
};
const incidentEpisodeId: (number: number) => string = (
  number: number,
): string => {
  return `34000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
};

const CRITICAL_ALERT_SEVERITY: string = "22000000-0000-4000-8000-000000000001";

const ALERT_NOT_FOUND: string =
  "This alert does not exist in this project, or you do not have access to it.";

interface RecordedAdd {
  route: string;
  episodeId: string;
  ids: Array<string>;
  headers: Record<string, string>;
}

interface RecordedCreate {
  tableName: string;
  title: string;
  severityId: string;
  isManuallyCreated: boolean;
  ids: Array<string>;
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
  // A dialog that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: false,
    animations: "disabled",
  });
}

async function openList(
  page: Page,
  kind: "alerts" | "incidents",
  query: string = "",
): Promise<void> {
  await page.goto(`${PROJECT}/${kind}?page=${kind}${query}`);
  await expect(page.locator("tbody tr").first()).toBeVisible();
}

function row(page: Page, title: string): Locator {
  return page
    .locator("tbody tr")
    .filter({ has: page.getByText(title, { exact: true }) });
}

async function selectRows(page: Page, titles: Array<string>): Promise<void> {
  for (const title of titles) {
    await row(page, title).locator('input[type="checkbox"]').first().check();
  }
}

async function openBulkMenu(page: Page): Promise<Locator> {
  await page.getByText("Bulk Actions", { exact: true }).click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

async function addsSent(page: Page): Promise<Array<RecordedAdd>> {
  return await page.evaluate((): Array<RecordedAdd> => {
    return (window as unknown as { __fixture: { adds: Array<RecordedAdd> } })
      .__fixture.adds;
  });
}

interface RecordedListRequest {
  tableName: string;
}

async function listRequestsFor(page: Page, tableName: string): Promise<number> {
  return await page.evaluate((name: string): number => {
    return (
      window as unknown as {
        __fixture: { listRequests: Array<RecordedListRequest> };
      }
    ).__fixture.listRequests.filter((request: RecordedListRequest) => {
      return request.tableName === name;
    }).length;
  }, tableName);
}

async function createsSent(page: Page): Promise<Array<RecordedCreate>> {
  return await page.evaluate((): Array<RecordedCreate> => {
    return (
      window as unknown as { __fixture: { creates: Array<RecordedCreate> } }
    ).__fixture.creates;
  });
}

function pickerOption(page: Page, list: string, title: string): Locator {
  return dialog(page).getByTestId(`${list}-option`).filter({ hasText: title });
}

test.describe("the alerts list: Add to Existing Episode", () => {
  test("is a bulk action beside the others, before Delete", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts");
    await selectRows(page, ["Checkout API is offline"]);
    const menu: Locator = await openBulkMenu(page);

    const titles: Array<string> = (
      await menu.getByRole("menuitem").allInnerTexts()
    ).map((title: string): string => {
      return title.trim();
    });

    expect(titles).toContain("Add to Existing Episode");
    expect(titles).toContain("Add to New Episode");
    expect(titles.indexOf("Add to New Episode")).toBe(
      titles.indexOf("Add to Existing Episode") + 1,
    );
    expect(titles.indexOf("Add to New Episode")).toBeLessThan(
      titles.indexOf("Delete"),
    );

    await screenshot(page, "alerts-bulk-menu");
  });

  test("picks one episode - ongoing first, then recently resolved - and adds the selection in one request", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts");
    await selectRows(page, [
      "Checkout API is offline",
      "Checkout API p95 latency above 2 s",
      "Payment provider webhook failures",
    ]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    await expect(
      dialog(page).getByRole("heading", { name: "Add 3 Alerts to an Episode" }),
    ).toBeVisible();

    const list: string = "add-to-existing-episode-list";
    await expect(
      dialog(page).getByTestId(`${list}-section-open`),
    ).toContainText("Ongoing");
    await expect(
      dialog(page)
        .getByTestId(`${list}-section-open`)
        .getByTestId(`${list}-option-title`),
    ).toHaveText(["Checkout degradation", "Database latency"]);
    await expect(
      dialog(page)
        .getByTestId(`${list}-section-resolved`)
        .getByTestId(`${list}-option-title`),
    ).toHaveText(["Network blip in eu-west"]);

    // Nothing to add until an episode is picked.
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toBeDisabled();

    await pickerOption(page, list, "Checkout degradation").click();

    // ALT-61 is in AE-12 already: left as it is.
    await expect(
      dialog(page).getByTestId("add-to-existing-episode-in-this"),
    ).toHaveText("1 of them is in this episode already and is left as it is.");

    await screenshot(page, "alerts-existing-dialog");

    await dialog(page).getByTestId("modal-footer-submit-button").click();

    // The result: added, in already, and the episode to open.
    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Alerts added to the episode",
    );
    await expect(page.getByTestId("bulk-action-unchanged-count")).toBeVisible();
    await expect(page.getByText("Already in this episode.")).toBeVisible();
    await expect(
      page
        .getByTestId("bulk-action-result-details")
        .getByRole("link", { name: "Open episode AE-12" }),
    ).toBeVisible();

    await screenshot(page, "alerts-existing-result");

    expect(await addsSent(page)).toEqual([
      {
        route: "/alert-episode-member/add-alerts",
        episodeId: alertEpisodeId(12),
        ids: [alertId(63), alertId(62), alertId(61)],
        headers: { tenantid: "10000000-0000-4000-8000-000000000001" },
      },
    ]);
  });

  test("a resolved episode is not reopened, and the dialog says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts");
    await selectRows(page, ["Checkout API is offline"]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    await pickerOption(
      page,
      "add-to-existing-episode-list",
      "Network blip in eu-west",
    ).click();

    await expect(
      dialog(page).getByTestId("add-to-existing-episode-resolved"),
    ).toHaveText("This episode is resolved. Adding to it does not reopen it.");
  });

  test("a resolved episode is dated by when it was resolved, and the notes sit above the button", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts");
    await selectRows(page, [
      "Checkout API is offline",
      "Cart service restarts",
    ]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    const resolved: Locator = pickerOption(
      page,
      "add-to-existing-episode-list",
      "Network blip in eu-west",
    );
    // AE-9 was resolved 570 minutes before the fixture's "now".
    await expect(resolved.locator("time")).toHaveAttribute(
      "datetime",
      "2026-10-14T02:30:00.000Z",
    );
    await expect(resolved).toContainText("2 alerts");

    await resolved.click();

    const notes: Locator = dialog(page).getByTestId(
      "add-to-existing-episode-notes",
    );
    await expect(notes).toContainText(
      "1 of them is already in another episode. It stays there too: alerts can be in more than one episode.",
    );
    await expect(notes).toContainText(
      "This episode is resolved. Adding to it does not reopen it.",
    );

    // Between the list and the button that adds them.
    const notesBox: { y: number; height: number } | null =
      await notes.boundingBox();
    const listBox: { y: number; height: number } | null = await dialog(page)
      .getByTestId("add-to-existing-episode-list-list")
      .boundingBox();
    const buttonBox: { y: number } | null = await dialog(page)
      .getByTestId("modal-footer-submit-button")
      .boundingBox();
    expect(notesBox!.y).toBeGreaterThanOrEqual(listBox!.y + listBox!.height);
    expect(buttonBox!.y).toBeGreaterThan(notesBox!.y + notesBox!.height);

    await screenshot(page, "alerts-existing-resolved-picked");
  });

  test("while the episodes load it shows a skeleton; one that cannot be read says so and reads again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts", "&slow=AlertEpisode&slowMs=4000");
    await selectRows(page, ["Checkout API is offline"]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    await expect(
      dialog(page).getByTestId("add-to-existing-episode-list-skeleton"),
    ).toBeVisible();
    await expect(dialog(page).getByRole("status")).toContainText("Loading");
    await expect(
      dialog(page).getByTestId("add-to-existing-episode-list-search"),
    ).toBeFocused();

    await expect(
      pickerOption(page, "add-to-existing-episode-list", "Database latency"),
    ).toBeVisible({ timeout: 20000 });

    await page.goto(`${PROJECT}/alerts?page=alerts&fail=AlertEpisode`);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await selectRows(page, ["Checkout API is offline"]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    await expect(dialog(page)).toContainText(
      "The server could not be reached. Try again.",
    );
    // The search box stays: the list may come back.
    await expect(
      dialog(page).getByTestId("add-to-existing-episode-list-search"),
    ).toBeVisible();

    const before: number = await listRequestsFor(page, "AlertEpisode");
    await dialog(page).getByTestId("refresh-button").click();
    await expect
      .poll(async (): Promise<number> => {
        return await listRequestsFor(page, "AlertEpisode");
      })
      .toBeGreaterThan(before);

    await screenshot(page, "alerts-existing-error");
  });

  test("searches every episode by number", async ({ page }: { page: Page }) => {
    await openList(page, "alerts");
    await selectRows(page, ["Checkout API is offline"]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    const list: string = "add-to-existing-episode-list";
    await dialog(page).getByTestId(`${list}-search`).fill("AE-11");

    await expect(dialog(page).getByTestId(`${list}-option-title`)).toHaveText([
      "Database latency",
    ]);

    await dialog(page).getByTestId(`${list}-search`).fill("nothing like it");
    await expect(dialog(page).getByTestId(`${list}-no-match`)).toHaveText(
      'No episodes match "nothing like it".',
    );
  });

  test("one the server does not add is reported with why; the rest are added", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts", `&refuse=${alertId(62)}`);
    await selectRows(page, [
      "Checkout API is offline",
      "Checkout API p95 latency above 2 s",
    ]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();
    await pickerOption(
      page,
      "add-to-existing-episode-list",
      "Database latency",
    ).click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Alert added to the episode",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Alert not added",
    );
    await expect(page.getByText(ALERT_NOT_FOUND)).toBeVisible();

    await screenshot(page, "alerts-existing-partly-refused");
  });

  test("with no episode yet, it offers Add to New Episode instead", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts", "&noEpisodes=1");
    await selectRows(page, ["Checkout API is offline"]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    await expect(
      dialog(page).getByTestId("add-to-existing-episode-list-empty"),
    ).toContainText("No episodes yet");
    await expect(
      dialog(page).getByTestId("add-to-existing-episode-list-empty"),
    ).toContainText("Start one with your selection.");

    // Nothing to search: the box goes, and the way forward has focus.
    await expect(
      dialog(page).getByTestId("add-to-existing-episode-list-search"),
    ).toHaveCount(0);
    await expect(
      dialog(page).getByTestId("add-to-existing-episode-create-instead"),
    ).toBeFocused();

    await screenshot(page, "alerts-existing-no-episodes");

    await dialog(page)
      .getByTestId("add-to-existing-episode-create-instead")
      .click();

    await expect(
      dialog(page).getByRole("heading", {
        name: "Add 1 Alert to a New Episode",
      }),
    ).toBeVisible();
  });
});

test.describe("the alerts list: Add to New Episode", () => {
  test("starts from the most severe selected alert, never a private title, and creates the episode with them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts");
    await selectRows(page, [
      "Disk usage above 90% on db-2",
      "Payroll export job failing",
      "Checkout API p95 latency above 2 s",
    ]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to New Episode" })
      .click();

    await expect(
      dialog(page).getByRole("heading", {
        name: "Add 3 Alerts to a New Episode",
      }),
    ).toBeVisible();

    // The private alert is the most severe: its severity, never its title.
    const title: Locator = dialog(page).locator('input[type="text"]').first();
    await expect(title).toHaveValue("Checkout API p95 latency above 2 s");
    await expect(dialog(page)).toContainText("Critical");

    await screenshot(page, "alerts-new-dialog");

    await title.fill("Checkout outage");
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "3 Alerts added to the new episode",
    );
    await expect(
      page
        .getByTestId("bulk-action-result-details")
        .getByRole("link", { name: "Open episode AE-13" }),
    ).toBeVisible();

    await screenshot(page, "alerts-new-result");

    expect(await createsSent(page)).toEqual([
      {
        tableName: "AlertEpisode",
        title: "Checkout outage",
        severityId: CRITICAL_ALERT_SEVERITY,
        isManuallyCreated: true,
        ids: [alertId(60), alertId(59), alertId(62)],
      },
    ]);
    // Nothing else was asked: the create carried them.
    expect(await addsSent(page)).toEqual([]);
  });

  test("a refused create adds none, and says why for each", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts", "&failNew=1");
    await selectRows(page, [
      "Checkout API is offline",
      "Cart service restarts",
    ]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to New Episode" })
      .click();
    await expect(
      dialog(page).locator('input[type="text"]').first(),
    ).toHaveValue("Checkout API is offline");
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "2 Alerts not added",
    );
    await expect(page.getByTestId("bulk-action-result-details")).toHaveCount(0);
  });
});

test.describe("who may add", () => {
  test("a viewer sees both actions locked, saying which permission is missing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts", "&role=viewer");
    await selectRows(page, ["Checkout API is offline"]);
    const menu: Locator = await openBulkMenu(page);

    const tooltips: Record<string, string> = {
      "Add to Existing Episode":
        "You do not have permission to create this Alert Episode Member.",
      "Add to New Episode":
        "You do not have permission to create this Alert Episode.",
    };

    for (const [name, tooltip] of Object.entries(tooltips)) {
      const item: Locator = menu.getByRole("menuitem", { name });
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await item.hover();
      // The tooltip of the item hovered before may still be fading out.
      await expect(
        page.getByRole("tooltip").filter({ hasText: tooltip }),
      ).toBeVisible();
    }

    await screenshot(page, "alerts-viewer-menu");

    // A locked action opens nothing.
    await menu
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click({ force: true });
    await expect(dialog(page)).toHaveCount(0);
  });

  test("someone who may add but not create an episode keeps Add to Existing Episode", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts", "&role=adder");
    await selectRows(page, ["Checkout API is offline"]);
    const menu: Locator = await openBulkMenu(page);

    await expect(
      menu.getByRole("menuitem", { name: "Add to Existing Episode" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    await expect(
      menu.getByRole("menuitem", { name: "Add to New Episode" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("an alert episode's Add Alerts", () => {
  const LIST: string = "add-episode-members-list";

  async function openEpisode(page: Page, query: string = ""): Promise<void> {
    await page.goto(
      `${PROJECT}/alerts/episodes/${alertEpisodeId(12)}/alerts?page=alert-episode${query}`,
    );
    await expect(page.locator("tbody tr").first()).toBeVisible();
  }

  test("picks several at once, leaving out the ones in the episode, and says which are in another", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEpisode(page);
    await page.getByRole("button", { name: "Add Alerts" }).click();

    await expect(
      dialog(page).getByRole("heading", { name: "Add Alerts to Episode" }),
    ).toBeVisible();

    // ALT-61 is in this episode already: not listed.
    await expect(
      dialog(page).getByTestId(`${LIST}-option`).first(),
    ).toBeVisible();
    await expect(
      pickerOption(page, LIST, "Payment provider webhook failures"),
    ).toHaveCount(0);

    // ALT-58 is in AE-11: it says so.
    await expect(
      pickerOption(page, LIST, "Cart service restarts").getByTestId(
        `${LIST}-option-note`,
      ),
    ).toHaveText("In episode AE-11");

    // Each row: its number, state and severity.
    const first: Locator = pickerOption(page, LIST, "Checkout API is offline");
    await expect(first.getByTestId(`${LIST}-option-number`)).toHaveText(
      "ALT-63",
    );
    await expect(first.getByTestId(`${LIST}-option-state`)).toHaveText(
      "Created",
    );
    await expect(first.getByTestId(`${LIST}-option-severity`)).toHaveText(
      "Critical",
    );

    await screenshot(page, "alert-episode-add-dialog");

    await pickerOption(page, LIST, "Checkout API is offline").click();
    await pickerOption(page, LIST, "Cart service restarts").click();

    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveText("Add 2 Alerts");
    await expect(
      dialog(page).getByTestId("add-episode-members-other-note"),
    ).toHaveText("Alerts that are in another episode stay there too.");

    await screenshot(page, "alert-episode-add-picked");

    await dialog(page).getByTestId("modal-footer-submit-button").click();

    // Everything added: the dialog closes and the list shows them.
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, "Checkout API is offline")).toHaveCount(1);
    await expect(row(page, "Cart service restarts")).toHaveCount(1);
    await expect(row(page, "Checkout API is offline")).toContainText(
      "Jane Doe",
    );

    await screenshot(page, "alert-episode-after-add");

    expect(await addsSent(page)).toEqual([
      {
        route: "/alert-episode-member/add-alerts",
        episodeId: alertEpisodeId(12),
        ids: [alertId(63), alertId(58)],
        headers: { tenantid: "10000000-0000-4000-8000-000000000001" },
      },
    ]);
  });

  test("searches by number, with or without its prefix", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEpisode(page);
    await page.getByRole("button", { name: "Add Alerts" }).click();
    await expect(
      dialog(page).getByTestId(`${LIST}-option`).first(),
    ).toBeVisible();

    await dialog(page).getByTestId(`${LIST}-search`).fill("#60");
    await expect(dialog(page).getByTestId(`${LIST}-option-title`)).toHaveText([
      "Disk usage above 90% on db-2",
    ]);

    await dialog(page).getByTestId(`${LIST}-search`).fill("ALT-56");
    await expect(dialog(page).getByTestId(`${LIST}-option-title`)).toHaveText([
      "CDN error rate above 1%",
    ]);
  });

  test("what could not be added stays listed, with why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEpisode(page, `&refuse=${alertId(60)}`);
    await page.getByRole("button", { name: "Add Alerts" }).click();

    await pickerOption(page, LIST, "Checkout API is offline").click();
    await pickerOption(page, LIST, "Disk usage above 90% on db-2").click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    // Drawn as a dialog draws any refusal: the danger alert.
    const box: Locator = dialog(page).getByTestId(
      "add-episode-members-not-added",
    );
    await expect(box).toHaveAttribute("role", "alert");
    await expect(box).toContainText("1 alert was not added");
    await expect(
      box.getByTestId("add-episode-members-not-added-name"),
    ).toHaveText(["ALT-60: Disk usage above 90% on db-2"]);
    await expect(
      box.getByTestId("add-episode-members-not-added-reason"),
    ).toHaveText(ALERT_NOT_FOUND);

    // The one added left the list; the one that was not is still picked.
    await expect(
      pickerOption(page, LIST, "Checkout API is offline"),
    ).toHaveCount(0);
    await expect(
      pickerOption(page, LIST, "Disk usage above 90% on db-2"),
    ).toHaveAttribute("data-selected", "true");

    await screenshot(page, "alert-episode-not-added");
  });

  test("a private alert says so on its line of facts, beside its state and severity", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEpisode(page);
    await page.getByRole("button", { name: "Add Alerts" }).click();

    const option: Locator = pickerOption(
      page,
      LIST,
      "Payroll export job failing",
    );
    await expect(
      option
        .getByTestId(`${LIST}-option-facts`)
        .getByTestId(`${LIST}-option-private`),
    ).toHaveText("Private");

    // Under the title, not beside it.
    const titleBox: { y: number; height: number } | null = await option
      .getByTestId(`${LIST}-option-title`)
      .boundingBox();
    const privateBox: { y: number } | null = await option
      .getByTestId(`${LIST}-option-private`)
      .boundingBox();
    expect(privateBox!.y).toBeGreaterThanOrEqual(
      titleBox!.y + titleBox!.height - 1,
    );
  });

  test("while the alerts load it shows a skeleton; then the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEpisode(page, "&slow=Alert&slowMs=4000");
    await page.getByRole("button", { name: "Add Alerts" }).click();

    await expect(dialog(page).getByTestId(`${LIST}-skeleton`)).toBeVisible();
    await expect(dialog(page).getByTestId(`${LIST}-search`)).toBeFocused();
    await expect(
      pickerOption(page, LIST, "Checkout API is offline"),
    ).toBeVisible({ timeout: 20000 });
  });

  test("a list that cannot be read says so, and Refresh reads it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEpisode(page, "&fail=Alert");
    await page.getByRole("button", { name: "Add Alerts" }).click();

    await expect(dialog(page)).toContainText(
      "The server could not be reached. Try again.",
    );
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toBeDisabled();

    const before: number = await listRequestsFor(page, "Alert");
    await dialog(page).getByTestId("refresh-button").click();
    await expect
      .poll(async (): Promise<number> => {
        return await listRequestsFor(page, "Alert");
      })
      .toBeGreaterThan(before);

    await screenshot(page, "alert-episode-add-error");
  });

  test("past the 50 it lists before a search, it says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEpisode(page, "&many=150");
    await page.getByRole("button", { name: "Add Alerts" }).click();

    await expect(dialog(page).getByTestId(`${LIST}-option`)).toHaveCount(50);
    await expect(
      dialog(page).getByTestId("add-episode-members-shown"),
    ).toHaveText(
      "Showing the 50 most recent alerts that are not in this episode. Search to find others.",
    );

    // A search reaches the older ones.
    await dialog(page).getByTestId(`${LIST}-search`).fill("ALT-249");
    await expect(dialog(page).getByTestId(`${LIST}-option-title`)).toHaveText([
      "Synthetic check 249 failing in us-east-1",
    ]);
  });

  test("with nothing left to add it says why, without a search box that could find nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEpisode(page, "&onlyMembers=1");
    await page.getByRole("button", { name: "Add Alerts" }).click();

    await expect(dialog(page).getByTestId(`${LIST}-empty`)).toContainText(
      "All the alerts you can see are in this episode already.",
    );
    await expect(dialog(page).getByTestId(`${LIST}-search`)).toHaveCount(0);
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toBeDisabled();

    await screenshot(page, "alert-episode-add-nothing-left");
  });

  test("a viewer's Add Alerts is locked", async ({ page }: { page: Page }) => {
    await openEpisode(page, "&role=viewer");

    await expect(
      page.getByRole("button", { name: "Add Alerts" }),
    ).toBeDisabled();
  });
});

test.describe("incidents", () => {
  test("the incidents list adds to an existing episode in one request", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "incidents");
    await selectRows(page, [
      "Checkout API is offline",
      "Disk usage above 90% on db-2",
    ]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    await expect(
      dialog(page).getByRole("heading", {
        name: "Add 2 Incidents to an Episode",
      }),
    ).toBeVisible();

    await pickerOption(
      page,
      "add-to-existing-episode-list",
      "Database latency",
    ).click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Incidents added to the episode",
    );
    await expect(
      page
        .getByTestId("bulk-action-result-details")
        .getByRole("link", { name: "Open episode IE-11" }),
    ).toBeVisible();

    expect(await addsSent(page)).toEqual([
      {
        route: "/incident-episode-member/add-incidents",
        episodeId: incidentEpisodeId(11),
        ids: [incidentId(63), incidentId(60)],
        headers: { tenantid: "10000000-0000-4000-8000-000000000001" },
      },
    ]);
  });

  test("an incident episode's Add Incidents adds several at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/incidents/episodes/${incidentEpisodeId(12)}/incidents?page=incident-episode`,
    );
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.getByRole("button", { name: "Add Incidents" }).click();

    const LIST: string = "add-episode-members-list";
    await pickerOption(page, LIST, "Checkout API is offline").click();
    await pickerOption(page, LIST, "CDN error rate above 1%").click();
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveText("Add 2 Incidents");
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(dialog(page)).toBeHidden();
    await expect(row(page, "CDN error rate above 1%")).toHaveCount(1);

    expect(await addsSent(page)).toEqual([
      {
        route: "/incident-episode-member/add-incidents",
        episodeId: incidentEpisodeId(12),
        ids: [incidentId(63), incidentId(56)],
        headers: { tenantid: "10000000-0000-4000-8000-000000000001" },
      },
    ]);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the add dialog fits the screen, and its rows can still be picked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/alerts/episodes/${alertEpisodeId(12)}/alerts?page=alert-episode`,
    );
    await page.getByRole("button", { name: "Add Alerts" }).click();

    const LIST: string = "add-episode-members-list";
    await expect(
      dialog(page).getByTestId(`${LIST}-option`).first(),
    ).toBeVisible();

    const box: { x: number; width: number } | null =
      await dialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    // No sideways scroll.
    expect(
      await page.evaluate((): number => {
        return document.documentElement.scrollWidth;
      }),
    ).toBeLessThanOrEqual(390);

    await pickerOption(page, LIST, "Checkout API is offline").click();
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveText("Add 1 Alert");

    await screenshot(page, "alert-episode-add-phone");
  });

  test("a long title wraps inside the dialog, and a private one keeps Private under its title", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/alerts/episodes/${alertEpisodeId(12)}/alerts?page=alert-episode&long=1`,
    );
    await page.getByRole("button", { name: "Add Alerts" }).click();

    const LIST: string = "add-episode-members-list";
    const long: Locator = dialog(page)
      .getByTestId(`${LIST}-option`)
      .filter({ hasText: "ALT-62" });
    await expect(long).toBeVisible();

    const dialogBox: { x: number; width: number } | null =
      await dialog(page).boundingBox();
    const titleBox: { x: number; width: number } | null = await long
      .getByTestId(`${LIST}-option-title`)
      .boundingBox();
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(
      dialogBox!.x + dialogBox!.width,
    );
    expect(
      await page.evaluate((): number => {
        return document.documentElement.scrollWidth;
      }),
    ).toBeLessThanOrEqual(390);

    const privateOne: Locator = pickerOption(
      page,
      LIST,
      "Payroll export job failing",
    );
    const privateTitle: { y: number; height: number } | null = await privateOne
      .getByTestId(`${LIST}-option-title`)
      .boundingBox();
    const privatePill: { y: number } | null = await privateOne
      .getByTestId(`${LIST}-option-private`)
      .boundingBox();
    expect(privatePill!.y).toBeGreaterThanOrEqual(
      privateTitle!.y + privateTitle!.height - 1,
    );

    await screenshot(page, "alert-episode-add-phone-long");
  });

  test("what could not be added fits the screen too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/alerts/episodes/${alertEpisodeId(12)}/alerts?page=alert-episode&refuse=${alertId(60)}`,
    );
    await page.getByRole("button", { name: "Add Alerts" }).click();

    const LIST: string = "add-episode-members-list";
    await pickerOption(page, LIST, "Disk usage above 90% on db-2").click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    const box: Locator = dialog(page).getByTestId(
      "add-episode-members-not-added",
    );
    await expect(box).toBeVisible();

    const boxBounds: { x: number; width: number } | null =
      await box.boundingBox();
    expect(boxBounds!.x).toBeGreaterThanOrEqual(0);
    expect(boxBounds!.x + boxBounds!.width).toBeLessThanOrEqual(390);

    await screenshot(page, "alert-episode-not-added-phone");
  });
});

test.describe("in the dark theme", () => {
  test("the picker draws its rows, picked and not, on the dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/alerts/episodes/${alertEpisodeId(12)}/alerts?page=alert-episode&theme=dark`,
    );
    await page.getByRole("button", { name: "Add Alerts" }).click();

    const LIST: string = "add-episode-members-list";
    const option: Locator = pickerOption(page, LIST, "Checkout API is offline");
    await expect(option).toBeVisible();

    // Not white: Theme.css re-colours the row for the dark theme.
    const background: string = await dialog(page)
      .getByTestId(`${LIST}-list`)
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    expect(background).not.toBe("rgb(255, 255, 255)");

    await option.click();
    await screenshot(page, "alert-episode-add-dark");
  });
});
