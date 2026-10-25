import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Each row's ⋯ menu on the lists the row actions audit gave their everyday
 * actions, in real Chromium against the offline fixture (ModelTables/
 * Fixture): the production Incidents, Alerts, Monitors and Runbooks lists
 * over in-memory records whose updates and creates the fixture records and
 * applies, as the API would.
 *
 * "I dont see the button to assign to me, change priority, change status
 * here ... Please also check the entire product for missing things in more
 * menu just like this and build those as well." - the maintainer.
 *
 * What jsdom cannot show is checked here: the menu as drawn, in its order;
 * each action's dialog as the record's own page words it, naming the row,
 * at 1280 and 390 pixels, light and dark; what is written; and the list read
 * again, the row's menu then offering what its new state leads to.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const VIEWER: string = "80000000-0000-4000-8000-000000000001";
const INCIDENTS: string = `/dashboard/${PROJECT}/incidents`;
const ALERTS: string = `/dashboard/${PROJECT}/alerts`;
const MONITORS: string = `/dashboard/${PROJECT}/monitors`;
const RUNBOOKS: string = `/dashboard/${PROJECT}/runbooks`;

// The fixture's records.
const INCIDENT: string = "40000000-0000-4000-8000-000000000002";
const INCIDENT_TITLE: string = "ghfghgf";
const ACKNOWLEDGED: string = "41000000-0000-4000-8000-000000000002";
const MINOR: string = "43000000-0000-4000-8000-000000000003";
const ALERT: string = "44000000-0000-4000-8000-000000000010";
const ALERT_RESOLVED: string = "45000000-0000-4000-8000-000000000003";
const CHECKOUT_MONITOR: string = "60000000-0000-4000-8000-000000000002";
const FAILOVER_RUNBOOK: string = "90000000-0000-4000-8000-000000000002";

// What the lists' durations are measured against.
const NOW: Date = new Date("2026-10-16T05:35:00.000Z");

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/model-tables-ui",
);

// What a row's state move, Change Severity and Assign to Me ask and do.
const ACKNOWLEDGE_SENTENCE: string =
  "This records an acknowledgement on the incident timeline and stops any on-call escalation for this incident.";

interface FixtureRecord {
  listRequests: Array<{ tableName: string }>;
  updates: Array<{
    tableName: string;
    id: string;
    data: Record<string, unknown>;
  }>;
  creates: Array<{ tableName: string; data: Record<string, unknown> }>;
  unmodelled: Array<string>;
}

// react-beautiful-dnd's warning about defaultProps, not this page's doing.
const KNOWN_LIBRARY_WARNINGS: Array<string> = [
  "Support for defaultProps will be removed from memo components",
];

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (
      message.type() === "error" &&
      !KNOWN_LIBRARY_WARNINGS.some((warning: string): boolean => {
        return message.text().includes(warning);
      })
    ) {
      errors.push(message.text());
    }
  });
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the lists made is one the fixture answers as the API does.
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

async function screenshot(locator: Locator, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await locator.screenshot({
    path: path.join(SCREENSHOTS, `row-actions-${name}.png`),
    animations: "disabled",
  });
}

async function open(
  page: Page,
  address: string,
  width: number = 1280,
  height: number = 900,
): Promise<void> {
  await page.setViewportSize({ width: width, height: height });
  await page.goto(address);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
}

// A row of a list: its table row, or on a phone its card.
function row(page: Page, tableId: string, text: string): Locator {
  return page
    .locator(`#${tableId}-body > tr, #${tableId}-body > div`)
    .filter({ hasText: text });
}

// Opens a row's ⋯ menu and reads its items, in order.
async function openMenu(rowLocator: Locator): Promise<Locator> {
  await rowLocator.getByTestId("row-actions-more-button").click();

  const menu: Locator = rowLocator.page().getByRole("menu");

  await expect(menu).toBeVisible();

  return menu;
}

async function menuItems(rowLocator: Locator): Promise<Array<string>> {
  const menu: Locator = await openMenu(rowLocator);
  const names: Array<string> = (
    await menu.getByRole("menuitem").allTextContents()
  ).map((name: string): string => {
    return name.trim();
  });

  await rowLocator.page().keyboard.press("Escape");
  await expect(menu).toBeHidden();

  return names;
}

async function choose(rowLocator: Locator, name: string): Promise<Locator> {
  const menu: Locator = await openMenu(rowLocator);

  await menu.getByRole("menuitem", { name: name, exact: true }).click();

  return rowLocator.page().getByRole("dialog");
}

async function submit(dialog: Locator): Promise<void> {
  await dialog.getByTestId("modal-footer-submit-button").click();
  await expect(dialog).toBeHidden();
}

// Whether the page is wider than its viewport anywhere (a sideways scroll).
async function scrollsSideways(page: Page): Promise<boolean> {
  return await page.evaluate((): boolean => {
    return (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
    );
  });
}

test.describe("an incident's row", () => {
  for (const [width, theme] of [
    [1280, "light"],
    [1280, "dark"],
    [390, "dark"],
  ] as Array<[number, string]>) {
    test(`its ⋯ menu offers the incident page's moves, severity and owners, ahead of what every row carries (${width}px, ${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(
        page,
        `${INCIDENTS}${theme === "dark" ? "?theme=dark" : ""}`,
        width,
        width === 390 ? 844 : 900,
      );

      const incident: Locator = row(page, "incidents-table", INCIDENT_TITLE);
      const menu: Locator = await openMenu(incident);

      await screenshot(menu, `incident-menu-${width}-${theme}`);

      const box: { x: number; width: number } | null = await menu.boundingBox();

      // The menu opens inside the screen, on a phone too.
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await scrollsSideways(page)).toBe(false);

      await page.keyboard.press("Escape");

      const names: Array<string> = await menuItems(incident);

      expect(names.slice(0, 6)).toEqual([
        "Acknowledge",
        "Resolve",
        "Change State",
        "Change Severity",
        "Assign to Me",
        "Add Owner",
      ]);
      // Delete, as on every list, is the last and stays apart.
      expect(names[names.length - 1]).toBe("Delete");
    });
  }

  for (const theme of ["light", "dark"]) {
    test(`Acknowledge asks the incident page's question, naming the incident, and moves it on its timeline (${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `${INCIDENTS}${theme === "dark" ? "?theme=dark" : ""}`);

      const incident: Locator = row(page, "incidents-table", INCIDENT_TITLE);
      const dialog: Locator = await choose(incident, "Acknowledge");

      await expect(dialog.getByTestId("modal-title")).toHaveText(
        "Acknowledge Incident",
      );
      await expect(dialog).toContainText(ACKNOWLEDGE_SENTENCE);
      // The incident it lands on, named above the fields.
      await expect(dialog.getByTestId("form-modal-before-form")).toContainText(
        INCIDENT_TITLE,
      );
      await expect(dialog).toContainText("Notify Status Page Subscribers");
      await expect(
        dialog.getByRole("button", { name: "Add a public note" }),
      ).toBeVisible();
      await expect(dialog.getByTestId("modal-footer-submit-button")).toHaveText(
        "Acknowledge",
      );
      await screenshot(dialog, `acknowledge-1280-${theme}`);

      await submit(dialog);

      expect(
        (await fixture(page)).creates.map(
          (created: { tableName: string; data: Record<string, unknown> }) => {
            return {
              tableName: created.tableName,
              incidentId: created.data["incidentId"],
              incidentStateId: created.data["incidentStateId"],
              notify: created.data["shouldStatusPageSubscribersBeNotified"],
            };
          },
        ),
      ).toEqual([
        {
          tableName: "IncidentStateTimeline",
          incidentId: INCIDENT,
          incidentStateId: ACKNOWLEDGED,
          notify: true,
        },
      ]);

      // Read again, the row is acknowledged, and Acknowledge is gone.
      await expect(incident).toContainText("Acknowledged");
      await expect
        .poll(async (): Promise<Array<string>> => {
          return (await menuItems(incident)).slice(0, 2);
        })
        .toEqual(["Resolve", "Change State"]);
    });
  }

  test("Change State offers the states the incident may move to, and names it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const dialog: Locator = await choose(
      row(page, "incidents-table", INCIDENT_TITLE),
      "Change State",
    );

    await expect(dialog.getByTestId("modal-title")).toHaveText(
      "Change Incident State",
    );
    await expect(dialog).toContainText(
      `Pick the next state for ${INCIDENT_TITLE}.`,
    );

    await dialog.getByRole("combobox").first().click();

    /*
     * The picker's own list, drawn over the dialog (the page's rows-per-page
     * picker has options too).
     */
    await expect(
      page.locator(".ou-select__menu").getByRole("option"),
    ).toHaveText(["Acknowledged", "Resolved"]);
    await page.keyboard.press("Escape");
    await dialog.getByTestId("modal-footer-close-button").click();
    await expect(dialog).toBeHidden();
    expect((await fixture(page)).creates).toEqual([]);
  });

  test("Change Severity offers the project's severities in their order, the row's own marked Current, and writes the pick", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const incident: Locator = row(page, "incidents-table", INCIDENT_TITLE);
    const dialog: Locator = await choose(incident, "Change Severity");

    await expect(dialog.getByTestId("modal-title")).toHaveText(
      "Change Severity",
    );
    await expect(dialog).toContainText(
      `Pick the new severity for ${INCIDENT_TITLE}.`,
    );

    await dialog.getByRole("combobox").first().click();

    const options: Locator = page
      .locator(".ou-select__menu")
      .getByRole("option");

    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toContainText("Critical Incident");
    await expect(options.nth(0)).toContainText("Current");
    await expect(options.nth(1)).toHaveText("Major Incident");
    await expect(options.nth(2)).toHaveText("Minor Incident");

    await options.nth(2).click();
    await submit(dialog);

    expect((await fixture(page)).updates).toEqual([
      {
        tableName: "Incident",
        id: INCIDENT,
        data: { incidentSeverityId: MINOR },
      },
    ]);
    await expect(incident).toContainText("Minor Incident");
  });

  test("Assign to Me makes the signed-in member an owner at once, and the row offers it no more", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const incident: Locator = row(page, "incidents-table", INCIDENT_TITLE);
    const menu: Locator = await openMenu(incident);

    await menu.getByRole("menuitem", { name: "Assign to Me" }).click();

    // Nothing to ask: the owner row is written, and the list read again.
    await expect
      .poll(async (): Promise<number> => {
        return (await fixture(page)).creates.length;
      })
      .toBe(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await fixture(page)).creates[0]).toEqual({
      tableName: "IncidentOwnerUser",
      data: expect.objectContaining({
        incidentId: INCIDENT,
        userId: VIEWER,
        projectId: PROJECT,
      }),
    });

    await expect
      .poll(async (): Promise<Array<string>> => {
        return await menuItems(incident);
      })
      .not.toContain("Assign to Me");
    expect(await menuItems(incident)).toContain("Add Owner");
  });

  test("Add Owner opens the people and teams picker for that incident, named, and keeps its owners", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const dialog: Locator = await choose(
      row(page, "incidents-table", INCIDENT_TITLE),
      "Add Owner",
    );

    await expect(dialog.getByTestId("modal-title")).toHaveText("Add Owner");
    await expect(dialog).toContainText(
      `Pick the people and teams to add as owners of ${INCIDENT_TITLE}. Its existing owners are kept.`,
    );
    // The people and teams picker, empty: nobody is added until picked.
    await expect(dialog.getByTestId("people-picker-add-button")).toBeVisible();

    await dialog.getByTestId("modal-footer-close-button").click();
    await expect(dialog).toBeHidden();
    expect((await fixture(page)).creates).toEqual([]);
  });

  test("a member who may not move incidents finds the moves locked, saying why, and nothing opens", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?role=viewer`);

    const menu: Locator = await openMenu(
      row(page, "incidents-table", INCIDENT_TITLE),
    );

    for (const name of ["Acknowledge", "Resolve", "Change Severity"]) {
      const item: Locator = menu.getByRole("menuitem", {
        name: name,
        exact: true,
      });

      await expect(item).toHaveAttribute("aria-disabled", "true");

      const reason: string = await item.evaluate((element: Element): string => {
        const describedBy: string | null =
          element.getAttribute("aria-describedby");

        return describedBy
          ? document.getElementById(describedBy)?.textContent || ""
          : "";
      });

      expect({ name, reason }).toEqual({
        name,
        reason: expect.stringContaining("permission"),
      });
    }

    // Pressed anyway, a locked item opens nothing.
    await menu
      .getByRole("menuitem", { name: "Acknowledge", exact: true })
      .click({ force: true });

    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  for (const theme of ["light", "dark"]) {
    test(`on a phone the row's dialog fits the screen (${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(
        page,
        `${INCIDENTS}${theme === "dark" ? "?theme=dark" : ""}`,
        390,
        844,
      );

      const dialog: Locator = await choose(
        row(page, "incidents-table", INCIDENT_TITLE),
        "Acknowledge",
      );

      await expect(dialog.getByTestId("modal-title")).toHaveText(
        "Acknowledge Incident",
      );

      const box: { x: number; width: number } | null =
        await dialog.boundingBox();

      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(await scrollsSideways(page)).toBe(false);
      await screenshot(dialog, `acknowledge-390-${theme}`);

      await dialog.getByTestId("modal-footer-close-button").click();
      await expect(dialog).toBeHidden();

      // And the severity dialog, the other one a row opens.
      const severity: Locator = await choose(
        row(page, "incidents-table", INCIDENT_TITLE),
        "Change Severity",
      );
      const severityBox: { x: number; width: number } | null =
        await severity.boundingBox();

      expect(severityBox!.x + severityBox!.width).toBeLessThanOrEqual(390);
      expect(await scrollsSideways(page)).toBe(false);
      await screenshot(severity, `change-severity-390-${theme}`);
    });
  }
});

test.describe("an alert's row", () => {
  test("offers the alert page's moves while the alert can make them, and Change Severity and owners", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS);

    expect(
      (
        await menuItems(
          row(page, "alerts-table", "High Node Memory Utilization"),
        )
      ).slice(0, 6),
    ).toEqual([
      "Acknowledge",
      "Resolve",
      "Change State",
      "Change Severity",
      "Assign to Me",
      "Add Owner",
    ]);

    // Acknowledged: Resolve, and no Acknowledge.
    const acknowledged: Array<string> = await menuItems(
      row(page, "alerts-table", "Pod Stuck in Pending"),
    );

    expect(acknowledged).toContain("Resolve");
    expect(acknowledged).not.toContain("Acknowledge");

    // Resolved: neither.
    const resolved: Array<string> = await menuItems(
      row(page, "alerts-table", "HPA Saturated at Max Replicas"),
    );

    expect(resolved).not.toContain("Acknowledge");
    expect(resolved).not.toContain("Resolve");
    expect(resolved).toContain("Change Severity");
  });

  test("Resolve asks the alert page's question, with a private note and no subscribers, and resolves it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS);

    const alert: Locator = row(
      page,
      "alerts-table",
      "High Node Memory Utilization",
    );
    const dialog: Locator = await choose(alert, "Resolve");

    await expect(dialog.getByTestId("modal-title")).toHaveText("Resolve Alert");
    await expect(dialog).toContainText(
      "This marks the alert as resolved on the alert timeline.",
    );
    await expect(
      dialog.getByRole("button", { name: "Add a private note" }),
    ).toBeVisible();
    await expect(dialog).not.toContainText("Notify Status Page Subscribers");

    await submit(dialog);

    expect(
      (await fixture(page)).creates.map(
        (created: { tableName: string; data: Record<string, unknown> }) => {
          return [
            created.tableName,
            created.data["alertId"],
            created.data["alertStateId"],
          ];
        },
      ),
    ).toEqual([["AlertStateTimeline", ALERT, ALERT_RESOLVED]]);
    await expect(alert).toContainText("Resolved");
  });
});

test.describe("a monitor's row", () => {
  test("offers Disable and Archive; Disable asks the monitor's own question before monitoring is turned off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, MONITORS);

    const monitor: Locator = row(page, "Monitors-table", "Checkout API");
    const names: Array<string> = await menuItems(monitor);

    expect(names[0]).toBe("Disable");
    expect(names).toContain("Archive");
    expect(names).not.toContain("Enable");

    const dialog: Locator = await choose(monitor, "Disable");

    await expect(dialog.getByTestId("modal-title")).toHaveText(
      "Turn off monitoring?",
    );
    await expect(dialog).toContainText(
      "Nothing will check this monitor until monitoring is turned back on",
    );
    await expect(dialog.getByTestId("row-switch-name")).toHaveText(
      "Checkout API",
    );
    await expect(dialog.getByTestId("modal-footer-submit-button")).toHaveText(
      "Turn off monitoring",
    );
    await screenshot(dialog, "monitor-disable-1280-light");

    await submit(dialog);

    expect((await fixture(page)).updates).toEqual([
      {
        tableName: "Monitor",
        id: CHECKOUT_MONITOR,
        data: { disableActiveMonitoring: true },
      },
    ]);
    // Read again, the row offers Enable, which turns it on at once.
    await expect
      .poll(async (): Promise<string> => {
        return (await menuItems(monitor))[0] || "";
      })
      .toBe("Enable");
  });

  test("Archive asks first, naming the monitor, and the monitor leaves the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, MONITORS);

    const dialog: Locator = await choose(
      row(page, "Monitors-table", "Marketing Website"),
      "Archive",
    );

    // In the monitor page's own words (its Settings' Archive card).
    await expect(dialog.getByTestId("modal-title")).toHaveText(
      "Archive monitor",
    );
    await expect(dialog.getByTestId("row-archive-name")).toHaveText(
      "Marketing Website",
    );

    await submit(dialog);

    expect(
      (await fixture(page)).updates.map(
        (update: { tableName: string; data: Record<string, unknown> }) => {
          return [update.tableName, update.data];
        },
      ),
    ).toEqual([["Monitor", { isArchived: true }]]);
    await expect(row(page, "Monitors-table", "Marketing Website")).toHaveCount(
      0,
    );
  });
});

test.describe("a runbook's row", () => {
  test("offers Disable on a runbook that runs and Enable on one that does not, and Disable says what a disabled runbook stops doing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${RUNBOOKS}?data=rich`);

    const failover: Locator = row(page, "runbooks-table", "Database failover");

    expect((await menuItems(failover))[0]).toBe("Disable");
    expect(
      (await menuItems(row(page, "runbooks-table", "Clear the CDN cache")))[0],
    ).toBe("Enable");

    const dialog: Locator = await choose(failover, "Disable");

    await expect(dialog.getByTestId("modal-title")).toHaveText(
      "Disable Runbook",
    );
    await expect(dialog.getByTestId("row-switch-name")).toHaveText(
      "Database failover",
    );
    await expect(dialog.getByTestId("row-switch-consequence")).toHaveText(
      "A disabled runbook cannot be run - not by hand, by its rules, by OneUptime AI, on its schedule or by its webhook - until it is enabled again.",
    );

    await submit(dialog);

    expect((await fixture(page)).updates).toEqual([
      {
        tableName: "Runbook",
        id: FAILOVER_RUNBOOK,
        data: { isEnabled: false },
      },
    ]);
    await expect
      .poll(async (): Promise<string> => {
        return (await menuItems(failover))[0] || "";
      })
      .toBe("Enable");
  });
});
