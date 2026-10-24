import {
  APIRequestContext,
  APIResponse,
  expect,
  Locator,
  Page,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * The Add a Role dialog, in a browser, on the real Teams pages of the
 * offline fixture (CustomRoles/Fixture).
 *
 * The maintainer, on its forty look-alike cards: "This is very confusing. it
 * gives a lot of information to the user. Can you please make the UI a lot
 * better to understand? Please make the UI a lot better in terms of visuals
 * as well. Make it natural for people to understand and use." It now asks
 * what every role answers (Components/Permission/RolePicker): Whole project
 * - the four roles that reach all of it - or One area, then a level; with a
 * search box beside the switch. The Scope folds under More fields.
 *
 * What jsdom cannot show is checked here: the browser's own radios under the
 * keyboard, the dialog's layout and size as it is drawn, a phone's width,
 * dark mode and German - and each pick is followed to the row the page
 * sends. Screenshots land in output/playwright/custom-roles-ui.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const PLATFORM_TEAM: string = "50000000-0000-4000-8000-000000000004";
const TEAM_PERMISSIONS: string = `/dashboard/${PROJECT}/teams/${PLATFORM_TEAM}/permissions`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/custom-roles-ui",
);

interface RecordedWrite {
  tableName: string;
  data: Record<string, unknown>;
}

// Where an element is drawn, as Playwright measures it.
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  expect(box).not.toBeNull();

  return box as Box;
}

/*
 * Where an element is once it has stopped moving: a dialog grows in from
 * 95% for its first 150 ms, so a box taken at once is a box mid-way.
 */
async function steadyBoxOf(locator: Locator): Promise<Box> {
  let last: Box = await boxOf(locator);

  for (let attempt: number = 0; attempt < 20; attempt++) {
    await locator.page().waitForTimeout(100);
    const now: Box = await boxOf(locator);

    if (
      now.x === last.x &&
      now.y === last.y &&
      now.width === last.width &&
      now.height === last.height
    ) {
      return now;
    }

    last = now;
  }

  return last;
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

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    animations: "disabled",
  });
}

async function createsOf(
  page: Page,
  tableName: string,
): Promise<Array<Record<string, unknown>>> {
  const writes: Array<RecordedWrite> = await page.evaluate(
    (): Array<RecordedWrite> => {
      return (
        window as unknown as { __fixture: { creates: Array<RecordedWrite> } }
      ).__fixture.creates;
    },
  );

  return writes
    .filter((write: RecordedWrite): boolean => {
      return write.tableName === tableName;
    })
    .map((write: RecordedWrite): Record<string, unknown> => {
      return write.data;
    });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function card(page: Page, title: string): Locator {
  return page
    .getByTestId("card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

function row(scope: Locator, name: string): Locator {
  return scope
    .locator("tbody tr")
    .filter({ has: scope.page().getByText(name, { exact: true }) });
}

async function openTeamPermissions(
  page: Page,
  search: string = "",
): Promise<void> {
  await page.goto(`${TEAM_PERMISSIONS}${search}`);
  await expect(page.getByTestId("card-details-heading").first()).toBeVisible();
}

// One channel of a computed colour, rgb(209, 213, 219).
const COLOUR_CHANNEL: RegExp = /\d+/g;

// The Add Role button, whole: not Add Custom Role, nor Benutzerdefinierte Rolle hinzufügen.
const ADD_ROLE: RegExp = /^Add Role$/;
const ADD_ROLE_IN_GERMAN: RegExp = /^Rolle hinzufügen$/;

// The Permissions card's Add Role, whatever the reader's language.
async function openAddRole(
  page: Page,
  addRole: RegExp = ADD_ROLE,
): Promise<Locator> {
  await page
    .getByTestId("card-button")
    .filter({ hasText: addRole })
    .first()
    .click();
  const form: Locator = dialog(page);
  await expect(form.getByTestId("role-picker")).toBeVisible();
  return form;
}

function reach(form: Locator, answer: "WholeProject" | "OneArea"): Locator {
  return form.getByTestId(`role-picker-reach-${answer}`);
}

function roleRow(form: Locator, permission: string): Locator {
  return form.getByTestId(`role-picker-role-${permission}`);
}

function areaTile(form: Locator, area: string): Locator {
  return form.getByTestId(`role-picker-area-${area}`);
}

function level(
  form: Locator,
  levelName: "Admin" | "Member" | "Viewer",
): Locator {
  return form.getByTestId(`role-picker-level-${levelName}`);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

async function activeTestId(page: Page): Promise<string | null> {
  return await page.evaluate((): string | null => {
    const active: Element | null = document.activeElement;

    return (
      active?.getAttribute("data-testid") ||
      active?.closest("[data-testid]")?.getAttribute("data-testid") ||
      null
    );
  });
}

test.describe("Add a Role on a team's Permissions page", () => {
  test("opens on the four whole-project roles, a line each, and adds the one picked for every resource", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);

    await expect(form.getByTestId("modal-title")).toHaveText("Add a Role");
    await expect(reach(form, "WholeProject")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const rows: Locator = form
      .getByTestId("role-picker-whole-project")
      .getByRole("radio");
    await expect(rows).toHaveCount(4);
    await expect(roleRow(form, "ProjectOwner")).toContainText(
      "Everything, billing and deleting the project included.",
    );
    await expect(roleRow(form, "ProjectAdmin")).toBeVisible();
    await expect(roleRow(form, "ProjectMember")).toContainText(
      "Create, change and delete monitors, incidents, status pages and other resources.",
    );
    await expect(roleRow(form, "Viewer")).toContainText(
      "Read everything in the project. Change nothing.",
    );
    // No wall of cards, and no help over the picker.
    await expect(form.getByText("Domain Roles")).toHaveCount(0);
    await expect(
      form.getByText("A ready-made set of permissions."),
    ).toHaveCount(0);
    await screenshot(page, "add-role-whole-project");

    await roleRow(form, "ProjectMember").click();
    await expect(
      roleRow(form, "ProjectMember").getByRole("radio"),
    ).toBeChecked();

    // A role with a scope folds it under More fields.
    const moreFields: Locator = form.getByRole("button", {
      name: /More fields/,
    });
    await expect(moreFields).toHaveAttribute("aria-expanded", "false");
    await screenshot(page, "add-role-whole-project-picked");

    await form.getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const created: Array<Record<string, unknown>> = await createsOf(
      page,
      "TeamPermission",
    );
    expect(created).toHaveLength(1);
    expect(created[0]!["permission"]).toBe("ProjectMember");
    expect(created[0]!["scope"]).toBe("All");
    expect(created[0]!["isBlockPermission"]).toBe(false);
    await expect(
      row(card(page, "Permissions"), "Project Member"),
    ).toBeVisible();
  });

  test("One area: an area, then its level, the pick named with its line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);

    await reach(form, "OneArea").click();

    const tiles: Locator = form
      .getByTestId("role-picker-areas")
      .getByRole("radio");
    await expect(tiles).toHaveCount(12);
    await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
      "Pick an area",
    );
    await expect(form.getByTestId("role-picker-picked-summary")).toHaveText(
      "Then choose Admin, Member or Viewer.",
    );
    await screenshot(page, "add-role-one-area");

    await areaTile(form, "Telemetry").click();
    await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
      "Telemetry Member",
    );
    await expect(form.getByTestId("role-picker-picked-summary")).toHaveText(
      "Read and send logs, traces, metrics and exceptions.",
    );

    await level(form, "Viewer").click();
    await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
      "Telemetry Viewer",
    );
    await expect(level(form, "Viewer")).toHaveAttribute("aria-pressed", "true");
    await screenshot(page, "add-role-one-area-picked");

    await form.getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const created: Array<Record<string, unknown>> = await createsOf(
      page,
      "TeamPermission",
    );
    expect(created).toHaveLength(1);
    expect(created[0]!["permission"]).toBe("TelemetryViewer");
    expect(created[0]!["scope"]).toBe("All");
  });

  test("a tile under the pointer only greys: it never looks like the one picked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);
    await reach(form, "OneArea").click();
    await areaTile(form, "Incidents").click();
    await areaTile(form, "Alerts").hover();
    // Past the tiles' colour transition.
    await page.waitForTimeout(300);

    const borderOf: (locator: Locator) => Promise<string> = async (
      locator: Locator,
    ): Promise<string> => {
      return await locator.evaluate((element: Element): string => {
        return getComputedStyle(element).borderTopColor;
      });
    };

    const picked: string = await borderOf(areaTile(form, "Incidents"));
    const hovered: string = await borderOf(areaTile(form, "Alerts"));
    const resting: string = await borderOf(areaTile(form, "Monitors"));

    expect(hovered).not.toBe(picked);
    expect(hovered).not.toBe(resting);
    // Grey, as the resting border is: no accent in it.
    const channels: Array<number> = (hovered.match(COLOUR_CHANNEL) || []).map(
      Number,
    );
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(40);
  });

  test("every area's tile picks that area's role, at the level chosen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);
    await reach(form, "OneArea").click();

    const expected: Array<[string, string]> = [
      ["Incidents", "Incident"],
      ["Alerts", "Alert"],
      ["Monitors", "Monitor"],
      ["StatusPages", "Status Page"],
      ["OnCall", "On-Call"],
      ["ScheduledMaintenance", "Scheduled Maintenance"],
      ["Telemetry", "Telemetry"],
      ["Security", "Security"],
      ["Workflows", "Workflow"],
      ["Runbooks", "Runbook"],
      ["Settings", "Settings"],
      ["Billing", "Billing"],
    ];

    for (const levelName of ["Member", "Admin", "Viewer"] as const) {
      await level(form, levelName).click();

      for (const [area, name] of expected) {
        await areaTile(form, area).click();
        await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
          `${name} ${levelName}`,
        );
      }
    }
  });

  test("with nothing picked, Add Role says a role is needed inside the room it keeps: the dialog does not grow", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);
    const before: Box = await steadyBoxOf(form);

    await form.getByTestId("modal-footer-submit-button").click();

    const error: Locator = form
      .getByTestId("role-picker-room")
      .getByRole("alert");
    await expect(error).toHaveText("Role is required.");
    expect(await createsOf(page, "TeamPermission")).toEqual([]);

    const after: Box = await boxOf(form);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  });

  test("the search: Enter takes the first match and keeps the dialog open; Escape clears it, a second closes the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);

    const search: Locator = form.getByRole("searchbox", {
      name: "Search roles",
    });
    await search.fill("billing view");

    const results: Locator = form.getByTestId("role-picker-results");
    await expect(results.getByRole("radio").first()).toHaveAttribute(
      "value",
      "BillingViewer",
    );
    // The matches come from both answers: neither is pressed.
    await expect(reach(form, "WholeProject")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(reach(form, "OneArea")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await screenshot(page, "add-role-search");

    await search.press("Enter");
    await expect(
      roleRow(form, "BillingViewer").getByRole("radio"),
    ).toBeChecked();
    await expect(dialog(page)).toHaveCount(1);

    // Escape clears the search: the pick shows where it lives.
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(dialog(page)).toHaveCount(1);
    await expect(reach(form, "OneArea")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(areaTile(form, "Billing").getByRole("radio")).toBeChecked();
    await expect(level(form, "Viewer")).toHaveAttribute("aria-pressed", "true");

    // With nothing to clear, Escape closes the dialog, adding nothing.
    await search.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect(await createsOf(page, "TeamPermission")).toEqual([]);
  });

  test("a search with no match says so, with a way back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);

    await form.getByTestId("role-picker-search").fill("incident zebra");

    const empty: Locator = form.getByTestId("role-picker-no-results");
    await expect(empty).toContainText("Nothing matches every word you typed.");
    await empty.getByRole("button", { name: "Clear search" }).click();

    await expect(form.getByTestId("role-picker-search")).toHaveValue("");
    await expect(form.getByTestId("role-picker-search")).toBeFocused();
    await expect(form.getByTestId("role-picker-whole-project")).toBeVisible();
  });

  test("the keyboard reaches every part: the switch, the search, the rows, the tiles and the levels", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);

    // From the first control of the picker: the Whole project answer.
    await reach(form, "WholeProject").focus();
    await expect(reach(form, "WholeProject")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(reach(form, "OneArea")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(form.getByTestId("role-picker-search")).toBeFocused();

    // Into the rows: one stop for the group; the arrows move and pick.
    await page.keyboard.press("Tab");
    expect(await activeTestId(page)).toBe("role-picker-role-ProjectOwner");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(
      roleRow(form, "ProjectMember").getByRole("radio"),
    ).toBeChecked();
    expect(await activeTestId(page)).toBe("role-picker-role-ProjectMember");

    // Back to the switch, and over to One area.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(reach(form, "OneArea")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(reach(form, "OneArea")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // The tiles: Tab in, an arrow to the next area picks it.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(await activeTestId(page)).toBe("role-picker-area-Incidents");
    await page.keyboard.press("ArrowRight");
    await expect(areaTile(form, "Alerts").getByRole("radio")).toBeChecked();
    await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
      "Alert Member",
    );

    // The level switch follows the tiles.
    await page.keyboard.press("Tab");
    await expect(level(form, "Admin")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
      "Alert Admin",
    );

    // A focused tile shows the focus ring the keyboard needs.
    await areaTile(form, "Alerts").getByRole("radio").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    const ring: string = await areaTile(form, "Alerts").evaluate(
      (element: Element): string => {
        return getComputedStyle(element).boxShadow;
      },
    );
    expect(ring).not.toBe("none");

    await form.getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const created: Array<Record<string, unknown>> = await createsOf(
      page,
      "TeamPermission",
    );
    expect(created).toHaveLength(1);
    expect(created[0]!["permission"]).toBe("AlertAdmin");
  });

  test("Edit opens the picker on the row's role, where it lives", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);

    await row(card(page, "Permissions"), "Workflow Viewer")
      .getByRole("button", { name: "Edit" })
      .click();

    const form: Locator = dialog(page);
    await expect(reach(form, "OneArea")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(areaTile(form, "Workflows").getByRole("radio")).toBeChecked();
    await expect(level(form, "Viewer")).toHaveAttribute("aria-pressed", "true");
    await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
      "Workflow Viewer",
    );
  });

  test("a block permission's Add Role opens on One area", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);

    await page
      .getByTestId("team-permissions-advanced-section")
      .getByRole("button", { name: "More settings" })
      .click();
    await card(page, "Block Permissions")
      .getByTestId("card-button")
      .filter({ hasText: ADD_ROLE })
      .click();

    const form: Locator = dialog(page);
    await expect(reach(form, "OneArea")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await areaTile(form, "Billing").click();
    await level(form, "Admin").click();
    await form.getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const created: Array<Record<string, unknown>> = await createsOf(
      page,
      "TeamPermission",
    );
    expect(created).toHaveLength(1);
    expect(created[0]!["permission"]).toBe("BillingAdmin");
    expect(created[0]!["isBlockPermission"]).toBe(true);
  });
});

test.describe("Add a Role on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the switch fills the row, the tiles go two to a row, the level switch sits under the pick, and nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);

    const wholeProject: Box = await boxOf(reach(form, "WholeProject"));
    const oneArea: Box = await boxOf(reach(form, "OneArea"));
    const search: Box = await boxOf(form.getByTestId("role-picker-search"));

    // Two equal halves of the row, the search box under them.
    expect(Math.abs(wholeProject.width - oneArea.width)).toBeLessThan(2);
    expect(wholeProject.width + oneArea.width).toBeGreaterThan(
      search.width - 12,
    );
    expect(search.y).toBeGreaterThan(wholeProject.y + wholeProject.height);
    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "add-role-phone");

    await reach(form, "OneArea").click();
    const first: Box = await boxOf(areaTile(form, "Incidents"));
    const second: Box = await boxOf(areaTile(form, "Alerts"));
    const third: Box = await boxOf(areaTile(form, "Monitors"));

    expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    expect(third.y).toBeGreaterThan(first.y + first.height);
    expect(Math.abs(first.x - third.x)).toBeLessThan(1);

    await areaTile(form, "Incidents").click();
    const title: Box = await boxOf(
      form.getByTestId("role-picker-picked-title"),
    );
    const levels: Box = await boxOf(form.getByTestId("role-picker-level"));

    expect(levels.y).toBeGreaterThan(title.y + title.height);
    expect(await horizontalOverflow(page)).toBe(0);
    await form.getByTestId("role-picker-picked").scrollIntoViewIfNeeded();
    await screenshot(page, "add-role-phone-area");
  });
});

test.describe("Add a Role in dark mode", () => {
  test("draws its rows, tiles and pick in the dark theme's colours", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page, "?theme=dark");
    const form: Locator = await openAddRole(page);

    await roleRow(form, "ProjectAdmin").click();
    await screenshot(page, "add-role-dark");

    const backgroundOf: (locator: Locator) => Promise<string> = async (
      locator: Locator,
    ): Promise<string> => {
      return await locator.evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    };

    // No white row or tile on a dark dialog.
    expect(await backgroundOf(roleRow(form, "Viewer"))).not.toBe(
      "rgb(255, 255, 255)",
    );

    await reach(form, "OneArea").click();
    await areaTile(form, "Monitors").click();
    expect(await backgroundOf(areaTile(form, "Alerts"))).not.toBe(
      "rgb(255, 255, 255)",
    );
    expect(await backgroundOf(form.getByTestId("role-picker-search"))).not.toBe(
      "rgb(255, 255, 255)",
    );
    await screenshot(page, "add-role-dark-area");
  });

  test("on a phone too", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTeamPermissions(page, "?theme=dark");
    const form: Locator = await openAddRole(page);

    await reach(form, "OneArea").click();
    await areaTile(form, "OnCall").click();
    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "add-role-dark-phone");
  });
});

test.describe("Add a Role in German", () => {
  test("asks in the reader's words", async ({ page }: { page: Page }) => {
    await openTeamPermissions(page, "?lang=de");
    const form: Locator = await openAddRole(page, ADD_ROLE_IN_GERMAN);

    await expect(reach(form, "WholeProject")).toHaveText("Ganzes Projekt");
    await expect(reach(form, "OneArea")).toHaveText("Ein Bereich");
    await expect(form.getByTestId("role-picker-search")).toHaveAttribute(
      "placeholder",
      "Rollen durchsuchen",
    );

    await reach(form, "OneArea").click();
    await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
      "Bereich wählen",
    );
    await expect(level(form, "Admin")).toHaveText("Administrator");
    await expect(level(form, "Member")).toHaveText("Mitglied");
    await expect(level(form, "Viewer")).toHaveText("Betrachter");
    await expect(areaTile(form, "Incidents")).toHaveText("Vorfälle");
    await screenshot(page, "add-role-german");
  });
});

/*
 * Nothing a pick changes moves the dialog. It is centred on a desktop and
 * rises from the bottom of a phone, so anything that grew under a row or a
 * tile moved it - and the switch just pressed - from under the pointer: the
 * first pick (the More fields line appearing), a role without a scope (the
 * line going), a picked row's check (its line re-wrapping), a longer line
 * under the tiles (one row to four in German on a phone), and switching
 * between the two answers (a hundred pixels on a German phone). Each walk
 * below measures the dialog and its switch after every step.
 */
interface StillWalk {
  name: string;
  width: number;
  height: number;
  search: string;
  addRole: RegExp;
  path: string;
  wholeProjectRoles: Array<string>;
  // A custom role's page is an Enterprise page: it skips where ee/ is not checked out.
  needsEnterprise?: boolean;
}

/*
 * Which edition the fixture serves (/edition.json): a custom role's page
 * is there only where ee/ is checked out.
 */
let edition: string = "";

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const response: APIResponse = await request.get("/edition.json");
  edition = ((await response.json()) as { edition: string }).edition;
});

const isEnterprise: () => boolean = (): boolean => {
  return edition === "enterprise";
};

const STILL_WALKS: Array<StillWalk> = [
  {
    name: "a team's, on a laptop",
    width: 1280,
    height: 900,
    search: "",
    addRole: ADD_ROLE,
    path: TEAM_PERMISSIONS,
    wholeProjectRoles: [
      "ProjectOwner",
      "ProjectMember",
      "ProjectAdmin",
      "Viewer",
    ],
  },
  {
    name: "a team's, on a phone",
    width: 390,
    height: 844,
    search: "",
    addRole: ADD_ROLE,
    path: TEAM_PERMISSIONS,
    wholeProjectRoles: ["ProjectMember", "ProjectAdmin", "Viewer"],
  },
  {
    name: "a team's, in German on a small tablet",
    width: 640,
    height: 900,
    search: "?lang=de",
    addRole: ADD_ROLE_IN_GERMAN,
    path: TEAM_PERMISSIONS,
    wholeProjectRoles: ["ProjectMember", "ProjectAdmin"],
  },
  {
    name: "a custom role's, on a laptop",
    width: 1280,
    height: 900,
    search: "",
    addRole: ADD_ROLE,
    path: `/dashboard/${PROJECT}/teams/roles/30000000-0000-4000-8000-000000000001`,
    wholeProjectRoles: ["ProjectAdmin", "ProjectMember", "Viewer"],
    needsEnterprise: true,
  },
];

const ALL_AREAS: Array<string> = [
  "Incidents",
  "Alerts",
  "Monitors",
  "StatusPages",
  "OnCall",
  "ScheduledMaintenance",
  "Telemetry",
  "Security",
  "Workflows",
  "Runbooks",
  "Settings",
  "Billing",
];

test.describe("Add a Role never moves under the pointer", () => {
  for (const walk of STILL_WALKS) {
    test(`${walk.name}: every pick, every area at every level, and both answers`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.skip(
        Boolean(walk.needsEnterprise) && !isEnterprise(),
        "Custom roles are an Enterprise feature: ee/ is not checked out.",
      );
      await page.setViewportSize({ width: walk.width, height: walk.height });
      await page.goto(`${walk.path}${walk.search}`);
      const form: Locator = await openAddRole(page, walk.addRole);
      const switchOf: Locator = form.getByTestId("role-picker-reach");

      // Where the dialog and its switch are, and how tall it is.
      const place: () => Promise<string> = async (): Promise<string> => {
        const dialogBox: Box = await boxOf(form);
        const switchBox: Box = await boxOf(switchOf);

        return `${Math.round(dialogBox.y)}/${Math.round(dialogBox.height)}/${Math.round(switchBox.y)}`;
      };

      await reach(form, "WholeProject").click();
      await steadyBoxOf(form);
      const start: string = await place();
      const moved: Array<string> = [];
      const check: (step: string) => Promise<void> = async (
        step: string,
      ): Promise<void> => {
        const now: string = await place();

        if (now !== start) {
          moved.push(`${step}: ${now} (was ${start})`);
        }
      };

      for (const role of walk.wholeProjectRoles) {
        await roleRow(form, role).click();
        await check(`row ${role}`);
      }

      await reach(form, "OneArea").click();
      await check("One area");

      for (const levelName of ["Member", "Admin", "Viewer"] as const) {
        await level(form, levelName).click();

        for (const area of ALL_AREAS) {
          await areaTile(form, area).click();
          await check(`${area} at ${levelName}`);
        }
      }

      await reach(form, "WholeProject").click();
      await check("back to Whole project");

      /*
       * Typed a letter at a time: a broad search lists more matches than
       * the answers have room for, and the search box must not move from
       * under the caret.
       */
      const search: Locator = form.getByTestId("role-picker-search");

      for (const typed of ["m", "me", "member", "member v", "zebra"]) {
        await search.fill(typed);
        await expect(
          form
            .getByTestId("role-picker-results")
            .or(form.getByTestId("role-picker-no-results")),
        ).toBeVisible();
        await check(`a search for "${typed}"`);
      }

      expect(moved).toEqual([]);
    });
  }

  test("on a laptop a broad search scrolls inside the room, and the arrow keys bring each match fully into view", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTeamPermissions(page);
    const form: Locator = await openAddRole(page);

    await form.getByTestId("role-picker-search").fill("member");

    const list: Locator = form.getByTestId("role-picker-body-on-screen");
    const matches: Locator = form
      .getByTestId("role-picker-results")
      .getByRole("radio");

    // Thirteen roles say Member: more than the room shows at once.
    await expect(matches).toHaveCount(13);
    const overflows: boolean = await list.evaluate(
      (element: Element): boolean => {
        return element.scrollHeight > element.clientHeight;
      },
    );
    expect(overflows).toBe(true);

    await form.getByTestId("role-picker-search").press("ArrowDown");

    for (let step: number = 0; step < 8; step++) {
      await page.keyboard.press("ArrowDown");

      const focusedRow: Box = await boxOf(
        form.locator("label:has(input:focus)"),
      );
      const room: Box = await boxOf(list);

      // The whole row is on screen, above the list's faded foot.
      expect(focusedRow.y).toBeGreaterThanOrEqual(room.y - 1);
      expect(focusedRow.y + focusedRow.height).toBeLessThanOrEqual(
        room.y + room.height + 1,
      );
    }

    // The arrows picked as they went, as a radio group does.
    await expect(
      form.locator("label:has(input:focus)").getByRole("radio"),
    ).toBeChecked();
  });
});
