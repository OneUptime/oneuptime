import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";

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

    // In one frame: the dialog grows in as it opens (Modal, from 95%).
    const [dialogBox, titleBox] = (await boxesInOneFrame([
      dialog(page),
      long.getByTestId(`${LIST}-option-title`),
    ])) as [FrameBox, FrameBox];
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(
      dialogBox.x + dialogBox.width,
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

/*
 * A project that allows an alert (or an incident) in only one episode
 * (Common/Types/Episode/EpisodeSingleMembership; ?oneEpisode=1). The
 * maintainer: "Some customers dont want [an incident in many episodes], so
 * can we create a setting in alert / incident settings to allow alert to be
 * in only one episode and same for incidents." The fixture's server leaves
 * out one in another episode, and refuses a new episode created with one,
 * as the member services do.
 */
const ALERT_IN_ANOTHER_EPISODE: string =
  "Already in another episode. An alert can be in only one episode in this project.";

// Under an episode's add list: the rule, and how to add one that is held.
const ALERT_LIST_RULE: string =
  "An alert can be in only one episode in this project. To add one that is in another episode, remove it from that episode first.";

/*
 * How see-through an element is drawn: its own opacity times that of every
 * element it sits in, up to the dialog.
 */
async function renderedOpacity(locator: Locator): Promise<number> {
  return await locator.evaluate((element: Element): number => {
    let opacity: number = 1;
    let current: Element | null = element;

    while (current) {
      opacity *= Number(getComputedStyle(current).opacity);
      current = current.parentElement;
    }

    return opacity;
  });
}

test.describe("a project that allows an alert in only one episode", () => {
  test("Add to Existing Episode says the one in another episode is not added, and the result says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts", "&oneEpisode=1");
    // ALT-63 is in no episode; ALT-58 is in AE-11.
    await selectRows(page, [
      "Checkout API is offline",
      "Cart service restarts",
    ]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    await pickerOption(
      page,
      "add-to-existing-episode-list",
      "Checkout degradation",
    ).click();

    await expect(
      dialog(page).getByTestId("add-to-existing-episode-in-another"),
    ).toHaveText(
      "1 of them is already in another episode, so it won't be added. An alert can be in only one episode in this project.",
    );

    await screenshot(page, "one-episode-existing-dialog");

    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Alert added to the episode",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Alert not added",
    );
    await expect(page.getByText(ALERT_IN_ANOTHER_EPISODE)).toBeVisible();

    await screenshot(page, "one-episode-existing-result");

    expect(await addsSent(page)).toEqual([
      {
        route: "/alert-episode-member/add-alerts",
        episodeId: alertEpisodeId(12),
        ids: [alertId(63), alertId(58)],
        headers: { tenantid: "10000000-0000-4000-8000-000000000001" },
      },
    ]);
  });

  test("Add to Existing Episode with only alerts in an episode says there is nothing to add", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts", "&oneEpisode=1");
    // ALT-58 is in AE-11, ALT-56 in AE-9.
    await selectRows(page, [
      "Cart service restarts",
      "CDN error rate above 1%",
    ]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to Existing Episode" })
      .click();

    await expect(
      dialog(page).getByTestId("add-to-existing-episode-nothing-to-add"),
    ).toContainText("Nothing to add");
    await expect(
      dialog(page).getByTestId("add-to-existing-episode-nothing-to-add-reason"),
    ).toHaveText(
      "Every selected alert is already in an episode. An alert can be in only one episode in this project. To move them, remove them from their episodes first.",
    );
    // Only Close: nothing here adds - and the keyboard starts there.
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveCount(0);
    await expect(
      dialog(page).getByTestId("modal-footer-close-button"),
    ).toBeFocused();

    await screenshot(page, "one-episode-existing-nothing-to-add");

    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toBeHidden();
    expect(await addsSent(page)).toEqual([]);
  });

  test("Add to New Episode leaves the one in an episode out, says so, and creates the episode with the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "alerts", "&oneEpisode=1");
    await selectRows(page, [
      "Checkout API is offline",
      "Cart service restarts",
    ]);
    await (await openBulkMenu(page))
      .getByRole("menuitem", { name: "Add to New Episode" })
      .click();

    // What changes what this creates is said first.
    await expect(dialog(page).getByTestId("modal-description")).toHaveText(
      "1 of them is already in an episode, so it is left out. An alert can be in only one episode in this project. You can add owners, on-call policies and notes on the episode's page.",
    );
    await expect(
      dialog(page).locator('input[type="text"]').first(),
    ).toHaveValue("Checkout API is offline");

    await screenshot(page, "one-episode-new-dialog");

    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Alert added to the new episode",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Alert not added",
    );
    await expect(page.getByText(ALERT_IN_ANOTHER_EPISODE)).toBeVisible();

    // The create carried only the one that could go in.
    const creates: Array<RecordedCreate> = await createsSent(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.ids).toEqual([alertId(63)]);
  });

  test("an episode's Add Alerts lists only the alerts in no episode; a search shows the rest locked, naming their episode", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/alerts/episodes/${alertEpisodeId(12)}/alerts?page=alert-episode&oneEpisode=1`,
    );
    await page.getByRole("button", { name: "Add Alerts" }).click();

    const LIST: string = "add-episode-members-list";

    await expect(dialog(page).getByTestId(`${LIST}-option-title`)).toHaveText([
      "Checkout API is offline",
      "Checkout API p95 latency above 2 s",
      "Disk usage above 90% on db-2",
      "Payroll export job failing",
    ]);
    await expect(
      dialog(page).getByTestId("add-episode-members-one-episode"),
    ).toHaveText(ALERT_LIST_RULE);

    await screenshot(page, "one-episode-add-dialog");

    await dialog(page).getByTestId(`${LIST}-search`).fill("ALT-58");

    const locked: Locator = pickerOption(page, LIST, "Cart service restarts");
    await expect(locked).toBeVisible();
    await expect(locked.getByTestId(`${LIST}-option-note`)).toHaveText(
      "Already in episode AE-11",
    );
    await expect(locked.getByTestId(`${LIST}-option-note`)).toHaveAttribute(
      "title",
      "An alert can be in only one episode in this project. To add it here, remove it from episode AE-11 first.",
    );
    await expect(locked.locator('input[type="checkbox"]')).toBeDisabled();

    /*
     * Drawn faded - its title and facts - but its note, which says why it
     * cannot be picked, is as easy to read as any line: nothing between it
     * and the dialog is see-through.
     */
    expect(
      await renderedOpacity(locked.getByTestId(`${LIST}-option-title`)),
    ).toBeLessThan(0.75);
    expect(
      await renderedOpacity(locked.getByTestId(`${LIST}-option-note`)),
    ).toBe(1);

    // A click on it picks nothing.
    await locked.click({ force: true });
    await expect(locked).toHaveAttribute("data-selected", "false");
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toBeDisabled();

    await screenshot(page, "one-episode-add-search-locked");
  });

  test("with every other alert in another episode, it says so - and the rule once, under the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Every alert in no episode is put in AE-11: AE-12 can take none.
    await page.goto(
      `${PROJECT}/alerts/episodes/${alertEpisodeId(12)}/alerts?page=alert-episode&oneEpisode=1&heldElsewhere=1`,
    );
    await page.getByRole("button", { name: "Add Alerts" }).click();

    const LIST: string = "add-episode-members-list";

    await expect(dialog(page).getByTestId(`${LIST}-empty`)).toContainText(
      "Every other alert you can see is already in another episode.",
    );
    await expect(
      dialog(page).getByTestId("add-episode-members-one-episode"),
    ).toHaveText(ALERT_LIST_RULE);

    // Said once in the whole dialog, not by the empty state again.
    const text: string = (await dialog(page).textContent()) || "";
    expect(
      text.split("An alert can be in only one episode in this project.")
        .length - 1,
    ).toBe(1);

    // Nothing a search could pick: no search box.
    await expect(dialog(page).getByTestId(`${LIST}-search`)).toHaveCount(0);

    await screenshot(page, "one-episode-add-all-held");
  });

  test("with every alert in this episode already, the rule is not said", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/alerts/episodes/${alertEpisodeId(12)}/alerts?page=alert-episode&oneEpisode=1&onlyMembers=1`,
    );
    await page.getByRole("button", { name: "Add Alerts" }).click();

    await expect(
      dialog(page).getByTestId("add-episode-members-list-empty"),
    ).toContainText("All the alerts you can see are in this episode already.");
    await expect(
      dialog(page).getByTestId("add-episode-members-one-episode"),
    ).toHaveCount(0);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("nothing to add fits the screen, with Close only", async ({
      page,
    }: {
      page: Page;
    }) => {
      // Rows are picked on a wide screen; the dialog opens on the phone.
      await page.setViewportSize({ width: 1280, height: 900 });
      await openList(page, "alerts", "&oneEpisode=1");
      await selectRows(page, ["Cart service restarts"]);
      await page.setViewportSize({ width: 390, height: 844 });

      await (await openBulkMenu(page))
        .getByRole("menuitem", { name: "Add to New Episode" })
        .click();

      await expect(
        dialog(page).getByTestId("add-to-new-episode-nothing-to-add-reason"),
      ).toHaveText(
        "The selected alert is already in an episode. An alert can be in only one episode in this project. To move it, remove it from its episode first.",
      );
      await expect(
        dialog(page).getByTestId("modal-footer-submit-button"),
      ).toHaveCount(0);

      const box: { x: number; width: number } | null =
        await dialog(page).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(
        await page.evaluate((): number => {
          return document.documentElement.scrollWidth;
        }),
      ).toBeLessThanOrEqual(390);

      await screenshot(page, "one-episode-new-nothing-phone");
    });
  });

  test("the incidents' dialog says incidents", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/incidents/episodes/${incidentEpisodeId(12)}/incidents?page=incident-episode&oneEpisode=1`,
    );
    await page.getByRole("button", { name: "Add Incidents" }).click();

    await expect(
      dialog(page).getByTestId("add-episode-members-one-episode"),
    ).toHaveText(
      "An incident can be in only one episode in this project. To add one that is in another episode, remove it from that episode first.",
    );
    // INC-58 is in IE-11: not offered until searched for.
    await expect(
      pickerOption(page, "add-episode-members-list", "Cart service restarts"),
    ).toHaveCount(0);
  });

  test("in the dark theme, the locked row and the rule read on the dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/alerts/episodes/${alertEpisodeId(12)}/alerts?page=alert-episode&oneEpisode=1&theme=dark`,
    );
    await page.getByRole("button", { name: "Add Alerts" }).click();

    const LIST: string = "add-episode-members-list";
    await dialog(page).getByTestId(`${LIST}-search`).fill("Cart");
    await expect(
      pickerOption(page, LIST, "Cart service restarts"),
    ).toBeVisible();

    const background: string = await dialog(page)
      .getByTestId(`${LIST}-list`)
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    expect(background).not.toBe("rgb(255, 255, 255)");

    await screenshot(page, "one-episode-add-dark");
  });
});

/*
 * Incidents -> Settings -> Episode Membership and Alerts -> Settings ->
 * Episode Membership: the one switch, off for a project that never turned
 * it on, saved the moment it is flipped (the project's own column, nothing
 * else), and locked for someone who may not change it.
 */
interface RecordedUpdate {
  tableName: string;
  id: string;
  data: Record<string, unknown>;
}

async function updatesSent(page: Page): Promise<Array<RecordedUpdate>> {
  return await page.evaluate((): Array<RecordedUpdate> => {
    return (
      window as unknown as { __fixture: { updates: Array<RecordedUpdate> } }
    ).__fixture.updates;
  });
}

test.describe("the Episode Membership settings page", () => {
  test("Incidents: the switch is off, and a flip saves the project's column at once, with no dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/incidents/settings/episode-membership?page=incident-settings`,
    );

    const control: Locator = page.getByRole("switch", {
      name: "An incident can be in only one episode",
    });
    await expect(control).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByText(
        "Choose whether an incident can be in more than one episode.",
      ),
    ).toBeVisible();

    const row: Locator = page.getByTestId("incident-single-episode-switch-row");
    await expect(row).toContainText(
      "An incident can be in several episodes at once.",
    );
    // Off says what off means, and nothing more.
    await expect(row).not.toContainText("Turning this on");

    await screenshot(page, "one-episode-settings-off");

    await control.click();

    await expect(control).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByTestId("incident-single-episode-switch-status"),
    ).toContainText("Saved");
    await expect(row).toContainText(
      "An incident in an episode can't be added to another. Incidents already in several episodes stay in them.",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);

    expect(await updatesSent(page)).toEqual([
      {
        tableName: "Project",
        id: "10000000-0000-4000-8000-000000000001",
        data: { limitIncidentsToOneEpisode: true },
      },
    ]);

    await screenshot(page, "one-episode-settings-on");
  });

  test("Alerts, for a Viewer: the switch is locked, says who may change it, and a press saves nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${PROJECT}/alerts/settings/episode-membership?page=alert-settings&role=viewer`,
    );

    const control: Locator = page.getByRole("switch", {
      name: "An alert can be in only one episode",
    });
    await expect(control).toHaveAttribute("aria-checked", "false");
    await expect(control).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByTestId("alert-single-episode-switch-row"),
    ).toContainText("Project Owner, Project Admin");

    await control.click({ force: true });
    await expect(control).toHaveAttribute("aria-checked", "false");
    expect(await updatesSent(page)).toEqual([]);

    await screenshot(page, "one-episode-settings-viewer");
  });

  test.describe("on a phone, in the dark theme", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the card fits the screen, on the dark surface", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(
        `${PROJECT}/alerts/settings/episode-membership?page=alert-settings&oneEpisode=1&theme=dark`,
      );

      const control: Locator = page.getByRole("switch", {
        name: "An alert can be in only one episode",
      });
      await expect(control).toHaveAttribute("aria-checked", "true");
      await expect(
        page.getByTestId("alert-single-episode-switch-row"),
      ).toContainText(
        "An alert in an episode can't be added to another. Alerts already in several episodes stay in them.",
      );

      // No sideways scroll.
      expect(
        await page.evaluate((): number => {
          return document.documentElement.scrollWidth;
        }),
      ).toBeLessThanOrEqual(390);

      const background: string = await page
        .getByTestId("card")
        .first()
        .evaluate((element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        });
      expect(background).not.toBe("rgb(255, 255, 255)");

      await screenshot(page, "one-episode-settings-phone-dark");
    });
  });
});
