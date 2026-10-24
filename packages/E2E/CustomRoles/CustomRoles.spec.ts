import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Custom roles on the real Teams pages, in a browser, against the offline
 * fixture (CustomRoles/Fixture): Teams > Settings > Roles, a role's own page,
 * a team's Permissions page and Create Team.
 *
 * The ask (a customer's, through the maintainer): "group a couple of
 * permissions I like into some role like 'Incident responder', 'Team Lead'
 * etc., so I can add that role to my teams." So a role is made from a name
 * and the built-in roles it bundles, reads as "Incident Responder - 6
 * permissions" wherever a team's access is shown, is given to teams from the
 * role or from the team, and says before every change who it reaches.
 *
 * The fixture records each write the pages send, so the tests check what
 * was sent as well as what was drawn.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const ROLES_ROUTE: string = `/dashboard/${PROJECT}/teams/roles`;
const TEAMS_ROUTE: string = `/dashboard/${PROJECT}/teams`;

// A role's own page, and a new team's Members page: PROJECT, then an id.
const ROLE_PAGE_PATH: RegExp =
  /^\/dashboard\/10000000-0000-4000-8000-000000000001\/teams\/roles\/[0-9a-f-]{36}$/;
const NEW_TEAM_MEMBERS_PATH: RegExp =
  /^\/dashboard\/10000000-0000-4000-8000-000000000001\/teams\/[0-9a-f-]{36}\/members$/;

const ROLE_IDS: Record<string, string> = {
  responder: "30000000-0000-4000-8000-000000000001",
  lead: "30000000-0000-4000-8000-000000000002",
  auditor: "30000000-0000-4000-8000-000000000003",
  helper: "30000000-0000-4000-8000-000000000004",
  longSentence: "33000000-0000-4000-8000-000000000001",
  longWord: "33000000-0000-4000-8000-000000000002",
};

const TEAM_IDS: Record<string, string> = {
  owners: "50000000-0000-4000-8000-000000000001",
  admin: "50000000-0000-4000-8000-000000000002",
  members: "50000000-0000-4000-8000-000000000003",
  platform: "50000000-0000-4000-8000-000000000004",
  support: "50000000-0000-4000-8000-000000000005",
};

const LONG_WORD_NAME: string =
  "incident-responders.eu-west-1.enterprise-platform.payments-and-identity-services";

// What the Roles card says a custom role is.
const ROLES_CARD_DESCRIPTION: string =
  "A set of permissions you name once, such as Incident Responder, and give to teams and API keys. Changing a role changes every team and key that has it.";

// DeleteConsequences' sentence for a custom role.
const ROLE_DELETE_CONSEQUENCE: string =
  "Deleting a custom role takes its permissions from every team and API key that has it. The teams and keys themselves stay, with everything else they have.";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/custom-roles-ui",
);

interface RecordedWrite {
  tableName: string;
  id?: string;
  data: Record<string, unknown>;
}

interface RecordedDelete {
  tableName: string;
  id: string;
}

interface RecordedList {
  tableName: string;
  query: Record<string, unknown>;
}

interface FixtureLog {
  creates: Array<RecordedWrite>;
  updates: Array<RecordedWrite>;
  deletes: Array<RecordedDelete>;
  listRequests: Array<RecordedList>;
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
    fullPage: true,
    animations: "disabled",
  });
}

async function fixtureLog(page: Page): Promise<FixtureLog> {
  return await page.evaluate((): FixtureLog => {
    return (window as unknown as { __fixture: FixtureLog }).__fixture;
  });
}

async function createsOf(
  page: Page,
  tableName: string,
): Promise<Array<Record<string, unknown>>> {
  return (await fixtureLog(page)).creates
    .filter((write: RecordedWrite): boolean => {
      return write.tableName === tableName;
    })
    .map((write: RecordedWrite): Record<string, unknown> => {
      return write.data;
    });
}

function idOf(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "object" && value !== null && "value" in value) {
    return String((value as { value: unknown }).value).toLowerCase();
  }

  return String(value).toLowerCase();
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

// The Teams side menu: "Roles" is also a link in the breadcrumb trail.
function sideMenu(page: Page): Locator {
  return page.getByRole("navigation", { name: "Main navigation" });
}

/*
 * A section's header in the Teams side menu, the button that folds and
 * opens it: Roles is in "Settings", which starts folded on All Teams.
 */
function menuSection(page: Page, title: string): Locator {
  return sideMenu(page).getByRole("button", { name: title, exact: true });
}

/*
 * The side menu's links a reader can see, in order. A folded section's
 * links stay mounted but hidden, so they are not among them.
 */
function shownMenuLinks(page: Page): Locator {
  return sideMenu(page).getByRole("link");
}

// Where the page is, without the fixture's ?scenario in the address.
async function expectPath(
  page: Page,
  expected: string | RegExp,
): Promise<void> {
  const readPath: () => string = (): string => {
    return new URL(page.url()).pathname;
  };

  if (typeof expected === "string") {
    await expect.poll(readPath).toBe(expected);
    return;
  }

  await expect.poll(readPath).toMatch(expected);
}

function card(page: Page, title: string): Locator {
  return page
    .getByTestId("card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

function row(scope: Page | Locator, name: string): Locator {
  // The inner locator is read inside each row, so it starts from the page.
  const page: Page = "page" in scope ? scope.page() : scope;
  return scope
    .locator("tbody tr")
    .filter({ has: page.getByText(name, { exact: true }) });
}

async function openRoles(page: Page, search: string = ""): Promise<void> {
  await page.goto(`${ROLES_ROUTE}${search}`);
  await expect(
    page.getByRole("heading", { name: "Custom Roles", exact: true }),
  ).toBeVisible();
}

async function openRole(
  page: Page,
  roleId: string,
  search: string = "",
): Promise<void> {
  await page.goto(`${ROLES_ROUTE}/${roleId}${search}`);
  await expect(
    page.getByRole("heading", { name: "Teams with this Role", exact: true }),
  ).toBeVisible();
}

async function openTeamPermissions(
  page: Page,
  teamId: string,
  search: string = "",
): Promise<void> {
  await page.goto(`${TEAMS_ROUTE}/${teamId}/permissions${search}`);
  await expect(
    page.getByRole("heading", { name: "Permissions", exact: true }),
  ).toBeVisible();
}

async function submitDialog(page: Page): Promise<void> {
  await dialog(page).getByTestId("modal-footer-submit-button").click();
}

// Types into a picker drawn by the react-select Dropdown, and picks the option.
async function pickInMultiSelect(
  page: Page,
  combobox: Locator,
  option: string,
): Promise<void> {
  await combobox.click();
  await combobox.fill(option);
  await page
    .locator(".ou-select__option")
    .filter({ hasText: option })
    .first()
    .click();
}

// Types into a picker of records (EntityDropdown: labels, teams), and picks one.
async function pickRecord(
  page: Page,
  combobox: Locator,
  name: string,
): Promise<void> {
  await combobox.click();
  await combobox.fill(name);
  await page
    .getByRole("listbox")
    .getByRole("option", { name: name, exact: true })
    .click();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

/*
 * Where an element's text starts, not its box: a centred line sits inside a
 * box as wide as its neighbour's, so only the text's own edge tells.
 */
async function textLeftEdge(locator: Locator): Promise<number> {
  return await locator.evaluate((element: Element): number => {
    const range: Range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().left;
  });
}

test.describe("Teams > Settings > Roles", () => {
  test("lists the project's custom roles, each with how many permissions it holds", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page);

    await expect(row(page, "Incident Responder")).toContainText(
      "6 permissions",
    );
    await expect(row(page, "Incident Responder")).toContainText(
      "Declares, works and resolves incidents and alerts.",
    );
    await expect(row(page, "Team Lead")).toContainText("3 permissions");
    await expect(row(page, "Auditor")).toContainText("No permissions yet");
    await expect(row(page, "Incident Helper")).toContainText("2 permissions");

    // Each row opens its role with a short "View Role", not "View Custom Role".
    await expect(
      row(page, "Incident Responder").getByRole("button", {
        name: "View Role",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "View Custom Role" }),
    ).toHaveCount(0);

    /*
     * Roles is in the Teams menu's Settings section, which opened by itself
     * on its page, and is marked as the page.
     */
    const menuEntry: Locator = sideMenu(page).getByRole("link", {
      name: "Roles",
      exact: true,
    });
    await expect(menuEntry).toBeVisible();
    await expect(menuEntry).toHaveClass(/bg-indigo-50/);
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await screenshot(page, "roles-list");
  });

  test("a project with none says what a custom role is for, and offers to create one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page, "?roles=none");

    await expect(page.getByText("No custom roles yet")).toBeVisible();
    /*
     * What a custom role is, said once: under the empty list's title, while
     * the card's header leaves it out.
     */
    await expect(page.getByText(ROLES_CARD_DESCRIPTION)).toHaveCount(1);
    await expect(page.getByTestId("custom-roles-table-no-items")).toContainText(
      ROLES_CARD_DESCRIPTION,
    );
    await expect(
      page.getByRole("button", { name: "Create Custom Role" }).first(),
    ).toBeVisible();

    await screenshot(page, "roles-empty");
  });

  test("creates a role from a name and the built-in roles it bundles, then opens it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page);
    await page
      .getByRole("button", { name: "Create Custom Role" })
      .first()
      .click();

    const form: Locator = dialog(page);
    // Name, then the built-in roles it bundles; the description is folded.
    const permissionsPicker: Locator = form.getByRole("combobox", {
      name: "Permissions",
    });
    await expect(permissionsPicker).toBeVisible();
    await expect(form).toContainText(
      "The built-in roles it bundles, for every resource in the project. Add single permissions on the role's page.",
    );
    // Each field says what it is for, not the API's words for the column.
    await expect(form).toContainText(
      "Shown on every team you give the role to.",
    );
    await expect(form).not.toContainText(
      "Unique in the project, and never the name of a built-in role.",
    );
    await expect(
      form.getByPlaceholder(
        "Declares, works and resolves incidents and alerts.",
      ),
    ).toBeHidden();
    await expect(
      form.getByRole("button", { name: "More fields" }),
    ).toBeVisible();
    await form.getByPlaceholder("Incident Responder").fill("Payments On-Call");
    await pickInMultiSelect(page, permissionsPicker, "Incident Member");
    await pickInMultiSelect(page, permissionsPicker, "Alert Member");
    await screenshot(page, "role-create-dialog");
    await submitDialog(page);

    await expectPath(page, ROLE_PAGE_PATH);

    const roles: Array<Record<string, unknown>> = await createsOf(
      page,
      "CustomRole",
    );
    expect(roles).toHaveLength(1);
    expect(roles[0]!["name"]).toBe("Payments On-Call");

    // Each picked role, as its own permission of the role, for every resource.
    const permissions: Array<Record<string, unknown>> = await createsOf(
      page,
      "CustomRolePermission",
    );
    expect(
      permissions.map((data: Record<string, unknown>): string => {
        return String(data["permission"]);
      }),
    ).toEqual(["IncidentMember", "AlertMember"]);
    for (const data of permissions) {
      expect(data["scope"]).toBe("All");
      expect(idOf(data["customRoleId"])).toBe(idOf(roles[0]!["_id"]));
    }

    // The new role's page: its permissions, and its name at the end of the trail.
    await expect(
      page.getByRole("heading", { name: "Teams with this Role" }),
    ).toBeVisible();
    await expect(
      page.getByText("Incident Member", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Alert Member", { exact: true })).toBeVisible();
    await expect(page.getByText("Payments On-Call").first()).toBeVisible();
  });

  test("a role whose picked roles are refused in part is kept, and says which and why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page, "?refuse=AlertMember");
    await page
      .getByRole("button", { name: "Create Custom Role" })
      .first()
      .click();

    const form: Locator = dialog(page);
    const permissionsPicker: Locator = form.getByRole("combobox", {
      name: "Permissions",
    });
    await form.getByPlaceholder("Incident Responder").fill("Night Shift");
    await pickInMultiSelect(page, permissionsPicker, "Incident Member");
    await pickInMultiSelect(page, permissionsPicker, "Alert Member");
    await submitDialog(page);

    const notice: Locator = page.getByTestId("custom-role-create-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      "Night Shift was created without 1 of the roles picked for it.",
    );
    await expect(notice).toContainText(
      "You cannot grant Alert Member because your own access does not include that permission at an equal or broader scope.",
    );
    // The refusal names the role it left out; the notice does not name it twice.
    await expect(notice).not.toContainText("Alert Member: You cannot grant");

    // Still on the list, with the role and what was put into it.
    await expectPath(page, ROLES_ROUTE);
    await expect(row(page, "Night Shift")).toContainText("1 permission");
    await screenshot(page, "role-create-partly-refused");

    await notice.getByText("Open the role").click();
    await expectPath(page, ROLE_PAGE_PATH);
  });

  /*
   * A member who may change teams but holds only Incident Member and Alert
   * Member could put only those into a role: the server refuses the rest.
   * Create offers only those, and says why the list is short.
   */
  test("offers only the built-in roles the user could put into a role, and says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page, "?user=editor");
    await page
      .getByRole("button", { name: "Create Custom Role" })
      .first()
      .click();

    const form: Locator = dialog(page);
    await expect(form).toContainText(
      "The built-in roles it bundles, for every resource in the project. Roles you don't hold yourself are not listed.",
    );
    await form.getByRole("combobox", { name: "Permissions" }).click();

    const options: Locator = page.locator(".ou-select__option");
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText("Incident Member");
    await expect(options.nth(1)).toContainText("Alert Member");
    await screenshot(page, "role-create-editor");
  });

  test("the built-in roles are folded, and open to every role with what it can do", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page);

    const builtIn: Locator = page.getByTestId("built-in-roles");
    await expect(builtIn).toContainText(
      "Every project has these 40 roles. They can't be changed",
    );
    await expect(page.getByTestId("built-in-roles-list")).toHaveCount(0);

    await builtIn.getByRole("button", { name: "Show Built-in Roles" }).click();

    const list: Locator = page.getByTestId("built-in-roles-list");
    await expect(list).toBeVisible();
    await expect(list.locator("li")).toHaveCount(40);
    // As Add Role's picker finds them: the whole project, then each area.
    await expect(list.getByRole("heading")).toHaveText([
      "Whole project",
      "Incidents",
      "Alerts",
      "Monitors",
      "Status Pages",
      "On-Call",
      "Scheduled Maintenance",
      "Telemetry",
      "Security",
      "Workflows",
      "Runbooks",
      "Settings",
      "Billing",
    ]);
    await expect(
      list.getByText("Project Owner", { exact: true }),
    ).toBeVisible();
    await expect(
      list.getByText("Incident Member", { exact: true }),
    ).toBeVisible();

    await builtIn.getByRole("button", { name: "Hide Built-in Roles" }).click();
    await expect(page.getByTestId("built-in-roles-list")).toHaveCount(0);
  });

  /*
   * A role's name sits beside what it can do only where there is room for
   * both: from lg up. The side menu takes its room from md, and at 768 a
   * description beside its name ran down a column of three words a line.
   */
  for (const [width, isBeside] of [
    [768, false],
    [1024, true],
    [1280, true],
  ] as const) {
    test(`at ${width} px each built-in role's description sits ${isBeside ? "beside" : "under"} its name, in a column of readable width`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: width, height: 900 });
      await openRoles(page);
      await page
        .getByTestId("built-in-roles")
        .getByRole("button", { name: "Show Built-in Roles" })
        .click();

      const role: Locator = page
        .getByTestId("built-in-roles-list")
        .locator("li")
        .filter({ hasText: "Project Member" });
      const name: Locator = role.getByText("Project Member", { exact: true });
      const description: Locator = role.getByText("Member of this project.", {
        exact: false,
      });

      const nameBox: { x: number; y: number; height: number } | null =
        await name.boundingBox();
      const descriptionBox: { x: number; y: number; width: number } | null =
        await description.boundingBox();

      expect(nameBox).not.toBeNull();
      expect(descriptionBox).not.toBeNull();

      if (isBeside) {
        expect(descriptionBox!.x).toBeGreaterThan(nameBox!.x + 150);
      } else {
        expect(Math.abs(descriptionBox!.x - nameBox!.x)).toBeLessThan(1);
        expect(descriptionBox!.y).toBeGreaterThanOrEqual(
          nameBox!.y + nameBox!.height - 1,
        );
      }

      // Never a narrow column: some 40 characters a line or more.
      expect(descriptionBox!.width).toBeGreaterThan(300);
    });
  }

  test("deleting a role says who loses access, and deletes it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page);

    await row(page, "Incident Responder")
      .getByTestId("row-actions-more-button")
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const confirm: Locator = dialog(page);
    await expect(confirm).toContainText(
      "Are you sure you want to delete Incident Responder?",
    );
    await expect(confirm).toContainText(ROLE_DELETE_CONSEQUENCE);
    // Two teams, four people who accepted: the invited one holds nothing yet.
    await expect(confirm).toContainText(
      "It is given to 2 teams (4 people) right now.",
    );
    await screenshot(page, "role-delete-dialog");

    await submitDialog(page);
    await expect(row(page, "Incident Responder")).toHaveCount(0);
    expect((await fixtureLog(page)).deletes).toEqual([
      { tableName: "CustomRole", id: ROLE_IDS["responder"] },
    ]);
  });

  test("deleting a role no team or key has says nothing loses access", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page);
    await row(page, "Auditor").getByTestId("row-actions-more-button").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await expect(dialog(page)).toContainText(
      "No team or API key has this role right now, so nothing loses access.",
    );
  });

  test("names the API keys too, for a role given to one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page);
    await row(page, "Team Lead").getByTestId("row-actions-more-button").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await expect(dialog(page)).toContainText(
      "It is given to 1 team (3 people) and 1 API key right now.",
    );
  });

  test("names the teams only, when the reader may not read who is on them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page, "?members=hidden");
    await row(page, "Incident Responder")
      .getByTestId("row-actions-more-button")
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await expect(dialog(page)).toContainText(
      "It is given to 2 teams right now.",
    );
  });
});

/*
 * Roles moved from beside All Teams into the Teams menu's Settings section
 * (the maintainer: "Move the roles page to the settings side menu"), first,
 * above Custom Fields. Settings starts folded on All Teams and opens by
 * itself on the pages inside it.
 */
test.describe("the Teams menu", () => {
  test("on All Teams, Roles waits in the folded Settings section, and opens from there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(TEAMS_ROUTE);
    await expect(
      page.getByRole("button", { name: "Create Team" }).first(),
    ).toBeVisible();

    // One row on arrival: All Teams, marked. Roles is not beside it.
    await expect(shownMenuLinks(page)).toHaveText(["All Teams"]);
    await expect(
      sideMenu(page).getByRole("link", { name: "All Teams", exact: true }),
    ).toHaveClass(/bg-indigo-50/);
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(
      sideMenu(page).getByRole("link", { name: "Roles", exact: true }),
    ).toHaveCount(0);
    await screenshot(page, "teams-menu-folded");

    // One click opens Settings: Roles first, then Custom Fields.
    await menuSection(page, "Settings").click();
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(shownMenuLinks(page)).toHaveText([
      "All Teams",
      "Roles",
      "Custom Fields",
    ]);
    await screenshot(page, "teams-menu-settings-open");

    await sideMenu(page)
      .getByRole("link", { name: "Roles", exact: true })
      .click();

    await expectPath(page, ROLES_ROUTE);
    await expect(
      page.getByRole("heading", { name: "Custom Roles", exact: true }),
    ).toBeVisible();
    await expect(
      sideMenu(page).getByRole("link", { name: "Roles", exact: true }),
    ).toHaveClass(/bg-indigo-50/);
    // Settings stays open on the page it led to.
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("Settings opens by itself on Roles, on a role's page and on Custom Fields, each marked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRoles(page);
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(shownMenuLinks(page)).toHaveText([
      "All Teams",
      "Roles",
      "Custom Fields",
    ]);
    await screenshot(page, "teams-menu-on-roles");

    await openRole(page, ROLE_IDS["lead"]!);
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      sideMenu(page).getByRole("link", { name: "Roles", exact: true }),
    ).toHaveClass(/bg-indigo-50/);

    await page.goto(`${TEAMS_ROUTE}/custom-fields`);
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      sideMenu(page).getByRole("link", { name: "Custom Fields", exact: true }),
    ).toHaveClass(/bg-indigo-50/);
    await expect(
      sideMenu(page).getByRole("link", { name: "Roles", exact: true }),
    ).not.toHaveClass(/bg-indigo-50/);
  });

  test("on a phone the menu names Settings / Roles, and Roles is reached from All Teams", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const menuButton: Locator = page.getByTestId("mobile-sidemenu-toggle");

    await openRoles(page);
    await expect(menuButton).toContainText("Settings / Roles");

    /*
     * Its two lines start at one edge: a button centres its text, which set
     * "Navigate to" off-centre above "Settings / Roles".
     */
    const labelLeft: number = await textLeftEdge(
      menuButton.getByText("Navigate to", { exact: true }),
    );
    const whereLeft: number = await textLeftEdge(
      menuButton.getByRole("heading", { name: "Settings / Roles" }),
    );
    expect(Math.abs(labelLeft - whereLeft)).toBeLessThanOrEqual(1);

    await openRole(page, ROLE_IDS["responder"]!);
    await expect(menuButton).toContainText("Settings / Roles");

    // From All Teams: open the menu, open Settings, tap Roles.
    await page.goto(TEAMS_ROUTE);
    await expect(menuButton).toContainText("Teams / All Teams");
    await menuButton.click();
    await expect(
      sideMenu(page).getByRole("link", { name: "Roles", exact: true }),
    ).toHaveCount(0);
    // Opening a section keeps the phone's menu open.
    await menuSection(page, "Settings").click();
    await sideMenu(page)
      .getByRole("link", { name: "Roles", exact: true })
      .click();

    await expectPath(page, ROLES_ROUTE);
    await expect(menuButton).toContainText("Settings / Roles");
    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "phone-teams-menu-roles");
  });
});

test.describe("a role's page", () => {
  test("says who a change reaches, then what the role gives and who has it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["responder"]!);

    /*
     * The trail ends with the role's name; Roles stays marked in the menu,
     * its Settings section open.
     */
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Incident Responder");
    await expect(
      sideMenu(page).getByRole("link", { name: "Roles", exact: true }),
    ).toHaveClass(/bg-indigo-50/);
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Its ID, under its name and description, as on every record's page.
    await expect(
      card(page, "Custom Role Details").getByTestId("detail-id-line"),
    ).toBeVisible();

    const permissions: Locator = card(page, "Permissions");
    await expect(permissions).toContainText(
      "Given to 2 teams (4 people). A change here changes what they can do at once.",
    );
    await expect(permissions.locator("tbody tr")).toHaveCount(6);
    // The Scope cell reads in the Scope choice's words, with the labels.
    await expect(
      row(permissions, "Monitor Viewer").getByTestId("permission-scope-cell"),
    ).toContainText("Only resources with certain labels");
    await expect(row(permissions, "Monitor Viewer")).toContainText(
      "Production",
    );

    const teams: Locator = page.getByTestId("custom-role-teams");
    await expect(teams).toContainText(
      "Members of these teams can do everything this role allows.",
    );
    await expect(teams.locator("tbody tr")).toHaveCount(2);
    await expect(
      teams.getByRole("link", { name: "Platform On-Call" }),
    ).toHaveAttribute("href", `${TEAMS_ROUTE}/${TEAM_IDS["platform"]}`);
    await expect(teams.getByText("Support", { exact: true })).toBeVisible();

    await screenshot(page, "role-page");
  });

  test("Add Role offers every built-in role but Project Owner, and adds the pick for every resource", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["auditor"]!);
    await card(page, "Permissions")
      .getByRole("button", { name: "Add Role" })
      .first()
      .click();

    const form: Locator = dialog(page);
    // Named for the button that opened it, and the role it adds to.
    await expect(form.getByTestId("modal-title")).toHaveText(
      "Add a Role to Auditor",
    );
    await expect(form.getByTestId("modal-footer-submit-button")).toHaveText(
      "Add Role",
    );

    // A custom role is most often a few areas' roles: it opens on One area.
    await expect(form.getByTestId("role-picker-reach-OneArea")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Whole project has every role but Project Owner, which no role holds.
    await form.getByTestId("role-picker-reach-WholeProject").click();
    await expect(form.getByTestId("role-picker-role-ProjectOwner")).toHaveCount(
      0,
    );
    await expect(
      form.getByTestId("role-picker-role-ProjectAdmin"),
    ).toBeVisible();

    await form.getByTestId("role-picker-reach-OneArea").click();
    await form.getByTestId("role-picker-area-Incidents").click();
    await form.getByTestId("role-picker-level-Admin").click();
    await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
      "Incident Admin",
    );
    await submitDialog(page);

    await expect(
      row(card(page, "Permissions"), "Incident Admin"),
    ).toBeVisible();
    const permissions: Array<Record<string, unknown>> = await createsOf(
      page,
      "CustomRolePermission",
    );
    expect(permissions).toHaveLength(1);
    expect(permissions[0]!["permission"]).toBe("IncidentAdmin");
    expect(permissions[0]!["scope"]).toBe("All");
    expect(idOf(permissions[0]!["customRoleId"])).toBe(ROLE_IDS["auditor"]);
  });

  test("the scope Labels asks for a label before it adds anything", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["auditor"]!);
    await card(page, "Permissions")
      .getByRole("button", { name: "Add Role" })
      .first()
      .click();

    const form: Locator = dialog(page);
    await form.getByTestId("role-picker-area-Incidents").click();
    await form.getByTestId("role-picker-level-Viewer").click();

    // The Scope waits under More fields: three plain answers, All picked.
    const moreFields: Locator = form.getByRole("button", {
      name: /More fields/,
    });
    await expect(moreFields).toHaveAttribute("aria-expanded", "false");
    await moreFields.click();
    await expect(
      form.getByRole("radio", { name: "All resources in the project" }),
    ).toBeChecked();
    await form
      .getByRole("radio", { name: "Only resources with certain labels" })
      .check();
    await submitDialog(page);

    // Nothing is sent without a label.
    await expect(form).toContainText("Labels is required");
    expect(await createsOf(page, "CustomRolePermission")).toEqual([]);

    await pickRecord(
      page,
      form.getByRole("combobox", { name: "Labels" }),
      "Production",
    );
    await screenshot(page, "role-add-permission-labels");
    await submitDialog(page);

    await expect(
      row(card(page, "Permissions"), "Incident Viewer"),
    ).toContainText("Production");
    const permissions: Array<Record<string, unknown>> = await createsOf(
      page,
      "CustomRolePermission",
    );
    expect(permissions[0]!["scope"]).toBe("Labels");
    expect(JSON.stringify(permissions[0]!["labels"])).toContain(
      "20000000-0000-4000-8000-000000000001",
    );
  });

  test("Add Permission says what a single permission is for, in a dialog named for it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["responder"]!);
    await card(page, "Permissions")
      .getByTestId("card-header")
      .getByRole("button", { name: /more/i })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Add Permission" }).click();

    const form: Locator = dialog(page);
    await expect(form.getByTestId("modal-title")).toHaveText(
      "Add a Permission to Incident Responder",
    );
    await expect(form.getByTestId("modal-footer-submit-button")).toHaveText(
      "Add Permission",
    );
    await expect(form).toContainText(
      "A single permission, for exactly what the role needs.",
    );
    // Not the API's description, in code names.
    await expect(form).not.toContainText("IncidentMember");
    await expect(form).not.toContainText("ReadProjectIncident");
    await screenshot(page, "role-add-permission");
  });

  test("Edit opens the picker a row was added with, its pick shown", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["responder"]!);
    const permissions: Locator = card(page, "Permissions");

    // A single permission: the full list, on its row, pressed and in view.
    await row(permissions, "Read Telemetry Service Log")
      .getByRole("button", { name: "Edit" })
      .click();

    let form: Locator = dialog(page);
    await expect(form.getByTestId("modal-title")).toHaveText("Edit Permission");
    await expect(form.getByTestId("role-picker")).toHaveCount(0);
    const picked: Locator = form
      .getByTestId("permission-picker-list")
      .getByRole("button", { pressed: true });
    await expect(picked).toHaveCount(1);
    await expect(picked).toContainText("Read Telemetry Service Log");
    await expect(picked).toBeInViewport();
    await screenshot(page, "role-edit-single-permission");

    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);

    // A built-in role: the role picker, on that role's area and level.
    await row(permissions, "Monitor Viewer")
      .getByRole("button", { name: "Edit" })
      .click();

    form = dialog(page);
    await expect(form.getByTestId("role-picker-reach-OneArea")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      form.getByTestId("role-picker-area-Monitors").getByRole("radio"),
    ).toBeChecked();
    await expect(form.getByTestId("role-picker-level-Viewer")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(form.getByTestId("role-picker-picked-title")).toHaveText(
      "Monitor Viewer",
    );
    await expect(form.getByTestId("permission-picker-list")).toHaveCount(0);
  });

  test("gives the role to a team, offering only the teams that could take it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["responder"]!);
    await page
      .getByTestId("custom-role-teams")
      .getByRole("button", { name: "Give to a Team" })
      .first()
      .click();

    const form: Locator = dialog(page);
    await expect(form).toContainText("Give Incident Responder to a Team");
    await form.getByRole("combobox", { name: "Team" }).click();
    /*
     * Not Owners or Admin, whose permissions can't change, and not Platform
     * On-Call or Support, which have the role already.
     */
    const options: Locator = page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveText(["Members"]);
    await screenshot(page, "role-give-to-team");
    await options.filter({ hasText: "Members" }).click();
    await submitDialog(page);

    const given: Array<Record<string, unknown>> = await createsOf(
      page,
      "TeamCustomRole",
    );
    expect(given).toHaveLength(1);
    expect(idOf(given[0]!["customRoleId"])).toBe(ROLE_IDS["responder"]);
    expect(JSON.stringify(given[0]!["team"] || given[0]!["teamId"])).toContain(
      TEAM_IDS["members"],
    );

    // The team is listed, and the reach is read again: one more team, one more person.
    const teams: Locator = page.getByTestId("custom-role-teams");
    await expect(teams.getByText("Members", { exact: true })).toBeVisible();
    await expect(card(page, "Permissions")).toContainText(
      "Given to 3 teams (5 people).",
    );
  });

  test("Remove takes the role from one team, and says what that team keeps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["responder"]!);

    const teams: Locator = page.getByTestId("custom-role-teams");
    await row(teams, "Support").getByRole("button", { name: "Remove" }).click();

    const confirm: Locator = dialog(page);
    await expect(confirm).toContainText(
      "Remove Incident Responder from Support",
    );
    await expect(confirm).toContainText(
      "Support loses the permissions of Incident Responder. Its other roles and permissions stay.",
    );
    await submitDialog(page);

    await expect(row(teams, "Support")).toHaveCount(0);
    const deletes: Array<RecordedDelete> = (await fixtureLog(page)).deletes;
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.tableName).toBe("TeamCustomRole");
    await expect(card(page, "Permissions")).toContainText(
      "Given to 1 team (3 people).",
    );
  });

  test("a renamed role reads its new name at the end of the trail", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["lead"]!);
    await page.getByRole("button", { name: "Edit Custom Role" }).click();

    const form: Locator = dialog(page);
    await form.getByPlaceholder("Incident Responder").fill("Engineering Lead");
    await submitDialog(page);

    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Engineering Lead");
    expect(
      (await fixtureLog(page)).updates.some((write: RecordedWrite): boolean => {
        return (
          write.tableName === "CustomRole" &&
          JSON.stringify(write.data).includes("Engineering Lead")
        );
      }),
    ).toBe(true);
  });

  test("its Delete says who loses access before it is pressed, and returns to the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["responder"]!);
    await page.getByRole("button", { name: "Delete Custom Role" }).click();

    const confirm: Locator = dialog(page);
    await expect(confirm).toContainText(ROLE_DELETE_CONSEQUENCE);
    await expect(confirm.getByTestId("custom-role-delete-reach")).toHaveText(
      "It is given to 2 teams (4 people) right now.",
    );
    await submitDialog(page);

    await expectPath(page, ROLES_ROUTE);
  });
});

test.describe("a team's Permissions page", () => {
  test("lists its custom roles above its own permissions, each linking to its role", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page, TEAM_IDS["platform"]!);

    const customRoles: Locator = page.getByTestId("team-custom-roles");
    await expect(customRoles).toBeVisible();
    await expect(customRoles).toContainText(
      "Named sets of permissions, made on the Roles page. Changing a role changes this team too.",
    );
    await expect(row(customRoles, "Incident Responder")).toContainText(
      "6 permissions",
    );
    await expect(row(customRoles, "Team Lead")).toContainText("3 permissions");
    await expect(
      customRoles.getByRole("link", { name: "Incident Responder" }),
    ).toHaveAttribute("href", `${ROLES_ROUTE}/${ROLE_IDS["responder"]}`);

    // The team's own permissions: the role's copies are the role's, not listed here.
    const own: Locator = card(page, "Permissions");
    await expect(own.locator("tbody tr")).toHaveCount(1);
    await expect(row(own, "Workflow Viewer")).toBeVisible();

    const ownListRead: RecordedList | undefined = (
      await fixtureLog(page)
    ).listRequests.find((request: RecordedList): boolean => {
      return (
        request.tableName === "TeamPermission" &&
        request.query["isBlockPermission"] === false
      );
    });
    expect(JSON.stringify(ownListRead?.query["teamCustomRoleId"])).toContain(
      "IsNull",
    );

    await screenshot(page, "team-permissions");
  });

  /*
   * Roles waits in the Teams menu's folded Settings section, and a team's
   * own menu has no entry for it: the card's "Roles" is a link to it.
   */
  test("the card's Roles is a link to the Roles page, which opens with Settings open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page, TEAM_IDS["platform"]!);

    const description: Locator = page
      .getByTestId("team-custom-roles")
      .getByTestId("card-description");
    await expect(description).toHaveText(
      "Named sets of permissions, made on the Roles page. Changing a role changes this team too.",
    );
    const rolesLink: Locator = description.getByRole("link", {
      name: "Roles",
      exact: true,
    });
    await expect(rolesLink).toHaveAttribute("href", ROLES_ROUTE);

    await rolesLink.click();

    await expectPath(page, ROLES_ROUTE);
    await expect(
      page.getByRole("heading", { name: "Custom Roles", exact: true }),
    ).toBeVisible();
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      sideMenu(page).getByRole("link", { name: "Roles", exact: true }),
    ).toHaveClass(/bg-indigo-50/);
  });

  test("Add Custom Role offers only the roles the team does not have", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page, TEAM_IDS["support"]!);
    await page
      .getByTestId("team-custom-roles")
      .getByRole("button", { name: "Add Custom Role" })
      .first()
      .click();

    const form: Locator = dialog(page);
    await expect(form).toContainText("Add a Custom Role");
    await expect(
      form.getByTestId(`card-select-option-${ROLE_IDS["responder"]}`),
    ).toHaveCount(0);
    const lead: Locator = form.getByTestId(
      `card-select-option-${ROLE_IDS["lead"]}`,
    );
    await expect(lead).toContainText("Team Lead");
    await expect(lead).toContainText(
      "3 permissions · Runs a team: its incidents, its on-call and who is on it.",
    );
    await screenshot(page, "team-add-custom-role");
    await lead.click();
    await submitDialog(page);

    const given: Array<Record<string, unknown>> = await createsOf(
      page,
      "TeamCustomRole",
    );
    expect(given).toHaveLength(1);
    expect(idOf(given[0]!["customRoleId"])).toBe(ROLE_IDS["lead"]);
    expect(idOf(given[0]!["teamId"])).toBe(TEAM_IDS["support"]);
    await expect(
      row(page.getByTestId("team-custom-roles"), "Team Lead"),
    ).toBeVisible();
  });

  test("a project with no custom roles sees the page as it always was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTeamPermissions(page, TEAM_IDS["platform"]!, "?roles=none");

    await expect(
      row(card(page, "Permissions"), "Workflow Viewer"),
    ).toBeVisible();
    await expect(page.getByTestId("team-custom-roles")).toHaveCount(0);
  });

  /*
   * The server refuses Owners and Admin every custom role: a card there
   * could only offer an Add Custom Role that fails.
   */
  for (const teamKey of ["owners", "admin"]) {
    test(`${teamKey === "owners" ? "Owners" : "Admin"}, whose permissions can't change, shows no Custom Roles card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openTeamPermissions(page, TEAM_IDS[teamKey]!);

      await expect(card(page, "Permissions").locator("tbody tr")).toHaveCount(
        1,
      );
      await expect(page.getByTestId("team-custom-roles")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Add Custom Role" }),
      ).toHaveCount(0);
    });
  }
});

test.describe("Create Team", () => {
  test("offers the custom roles the user could give, after the built-in roles", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(TEAMS_ROUTE);
    await page.getByRole("button", { name: "Create Team" }).first().click();

    const form: Locator = dialog(page);
    const cards: Locator = form.getByRole("radio");
    await expect(cards.first()).toBeVisible();

    const titles: Array<string> = (await cards.allInnerTexts()).map(
      (text: string): string => {
        return text.split("\n")[0]!.trim();
      },
    );
    expect(titles).toEqual([
      "Project Admin",
      "Project Member",
      "Viewer",
      "Incident Helper",
      "Incident Responder",
      "Team Lead",
      "Choose permissions later",
    ]);

    const responder: Locator = form.getByTestId(
      `card-select-option-customRole:${ROLE_IDS["responder"]}`,
    );
    await expect(responder).toContainText(
      "Custom role · 6 permissions · Declares, works and resolves incidents and alerts.",
    );
    await screenshot(page, "create-team-access");

    await form.getByPlaceholder("Team Name").fill("SRE");
    await responder.click();
    await submitDialog(page);

    const teams: Array<Record<string, unknown>> = await createsOf(page, "Team");
    expect(teams).toHaveLength(1);
    const given: Array<Record<string, unknown>> = await createsOf(
      page,
      "TeamCustomRole",
    );
    expect(given).toHaveLength(1);
    expect(idOf(given[0]!["customRoleId"])).toBe(ROLE_IDS["responder"]);
    expect(idOf(given[0]!["teamId"])).toBe(idOf(teams[0]!["_id"]));
    // No built-in role was added instead.
    expect(await createsOf(page, "TeamPermission")).toEqual([]);

    // A team that can do something opens where people are invited.
    await expectPath(page, NEW_TEAM_MEMBERS_PATH);
  });

  test("a member who may change teams is offered only the roles made of what they hold", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${TEAMS_ROUTE}?user=editor`);
    await page.getByRole("button", { name: "Create Team" }).first().click();

    const form: Locator = dialog(page);
    await expect(
      form.getByTestId(`card-select-option-customRole:${ROLE_IDS["helper"]}`),
    ).toBeVisible();
    for (const roleId of [
      ROLE_IDS["responder"],
      ROLE_IDS["lead"],
      ROLE_IDS["auditor"],
    ]) {
      await expect(
        form.getByTestId(`card-select-option-customRole:${roleId}`),
      ).toHaveCount(0);
    }
  });

  test("a project with many roles gets a search box over them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${TEAMS_ROUTE}?roles=many`);
    await page.getByRole("button", { name: "Create Team" }).first().click();

    const form: Locator = dialog(page);
    const search: Locator = form.getByTestId("card-select-search");
    await expect(search).toBeVisible();
    // What a search reads - not the monitor type picker's words.
    await expect(form.getByTestId("card-select-search-summary")).toHaveText(
      "34 to choose from. Search by name or by what a role allows.",
    );
    await search.fill("Region 07");
    await expect(form.getByText("Region 07 Responders")).toBeVisible();
    await expect(form.getByText("Region 08 Responders")).toHaveCount(0);
  });
});

/*
 * "Incident Responder" is also a placeholder the Dashboard translates
 * ("Vorfallbearbeiter" in German). A role someone called that is their
 * name, and reads as they typed it wherever it is drawn.
 */
test.describe("in another language", () => {
  const GERMAN_WORD_FOR_IT: string = "Vorfallbearbeiter";

  test("a role's name reads as typed on its page, in Create Team and in Add Custom Role", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The role's page: the end of the trail.
    await page.goto(`${ROLES_ROUTE}/${ROLE_IDS["responder"]}?lang=de`);
    const trail: Locator = page.getByRole("navigation", {
      name: "Breadcrumb",
    });
    await expect(trail).toContainText("Incident Responder");
    await expect(trail).not.toContainText(GERMAN_WORD_FOR_IT);

    // Create Team's Access card for it.
    await page.goto(`${TEAMS_ROUTE}?lang=de`);
    await page.getByRole("button", { name: "Team erstellen" }).first().click();
    const access: Locator = dialog(page).getByTestId(
      `card-select-option-customRole:${ROLE_IDS["responder"]}`,
    );
    await expect(access).toContainText("Incident Responder");
    await expect(access).not.toContainText(GERMAN_WORD_FOR_IT);
    // The rest of the card is in German.
    await expect(access).toContainText("Benutzerdefinierte Rolle");
    await screenshot(page, "create-team-access-de");

    // A team's Add Custom Role card for it (Members has no role yet).
    await page.goto(
      `${TEAMS_ROUTE}/${TEAM_IDS["members"]}/permissions?lang=de`,
    );
    await page
      .getByTestId("team-custom-roles")
      .getByRole("button", { name: "Benutzerdefinierte Rolle hinzufügen" })
      .first()
      .click();
    const roleCard: Locator = dialog(page).getByTestId(
      `card-select-option-${ROLE_IDS["responder"]}`,
    );
    await expect(roleCard).toContainText("Incident Responder");
    await expect(roleCard).not.toContainText(GERMAN_WORD_FOR_IT);
  });

  test("a team's Custom Roles card links the menu's word for Roles inside its own sentence", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${TEAMS_ROUTE}/${TEAM_IDS["platform"]}/permissions?lang=de`,
    );

    const description: Locator = page
      .getByTestId("team-custom-roles")
      .getByTestId("card-description");
    // The German sentence, the link where German grammar puts the page's name.
    await expect(description).toHaveText(
      "Benannte Sätze von Berechtigungen, erstellt auf der Seite Rollen. Eine Änderung einer Rolle ändert auch dieses Team.",
    );
    await expect(
      description.getByRole("link", { name: "Rollen", exact: true }),
    ).toHaveAttribute("href", ROLES_ROUTE);
  });
});

test.describe("on a phone and in dark mode", () => {
  test("every page fits a phone, long names wrapping inside their cards", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await openRoles(page, "?long=1");
    expect(await horizontalOverflow(page)).toBe(0);
    await expect(page.getByText(LONG_WORD_NAME)).toBeVisible();
    await screenshot(page, "phone-roles");

    await openRole(page, ROLE_IDS["longWord"]!, "?long=1");
    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "phone-role-page");

    await openTeamPermissions(page, TEAM_IDS["platform"]!);
    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "phone-team-permissions");
  });

  test("at a laptop's width a long name wraps and the counts stay on the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openRoles(page, "?long=1");

    const table: Locator = card(page, "Custom Roles");
    const tableBox: { x: number; width: number } | null =
      await table.boundingBox();
    const header: { x: number; width: number } | null = await table
      .getByRole("columnheader", { name: "Permissions" })
      .boundingBox();

    expect(tableBox).not.toBeNull();
    expect(header).not.toBeNull();
    expect(header!.x + header!.width).toBeLessThanOrEqual(
      tableBox!.x + tableBox!.width,
    );
  });

  test("dark mode draws the pages dark", async ({ page }: { page: Page }) => {
    await openRoles(page, "?theme=dark");

    const background: string = await page
      .getByTestId("card")
      .first()
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    // Not the light theme's white.
    expect(background).not.toBe("rgb(255, 255, 255)");
    await screenshot(page, "dark-roles");

    await openRole(page, ROLE_IDS["responder"]!, "?theme=dark");
    await screenshot(page, "dark-role-page");
  });
});
