import {
  APIRequestContext,
  expect,
  Locator,
  Page,
  test,
} from "@playwright/test";
import {
  readFixtureEdition,
  skipUnlessEnterprise,
} from "../SuiteHelpers/Edition";
import fs from "fs/promises";
import path from "path";

/*
 * Custom roles on API keys, in a browser, against the offline fixture
 * (CustomRoles/Fixture): a key's own page under Project Settings > API Keys,
 * Create API Key on the keys list, and a role's own page under Teams >
 * Settings > Roles.
 *
 * The ask (the maintainer's): "We can create custom roles and add that to
 * teams, but we cannot add that to API keys." So a key is given a custom
 * role the way a team is - from the key's page, from the role's page, or
 * when it is created - and holds everything the role allows but what the
 * role limits to resources someone owns, which gives a key nothing (a key
 * owns nothing). Every line that counts a role's permissions on a key says
 * how many apply to it, and why not the rest - in the words the role's
 * Scope column uses ("Only resources they own"): behind an (i) on the key's
 * page, in the role's API Keys card and in the dialogs that give a role -
 * which say nothing of it for a role that has no such permission.
 *
 * The fixture holds two keys: Deploy bot, given Team Lead (Incident Admin
 * and On-Call Admin, with Alert Member limited to what someone owns) and
 * Incident Helper (Incident Member and Alert Member), with Workflow Viewer
 * of its own; and Terraform, given no role, with Monitor Admin of its own.
 * It records each write the pages send, so the tests check what was sent as
 * well as what was drawn.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const API_KEYS_ROUTE: string = `/dashboard/${PROJECT}/settings/api-keys`;
const ROLES_ROUTE: string = `/dashboard/${PROJECT}/teams/roles`;

// A new key's page: PROJECT, then an id.
const KEY_PAGE_PATH: RegExp =
  /^\/dashboard\/10000000-0000-4000-8000-000000000001\/settings\/api-keys\/[0-9a-f-]{36}$/;

const ROLE_IDS: Record<string, string> = {
  responder: "30000000-0000-4000-8000-000000000001",
  lead: "30000000-0000-4000-8000-000000000002",
  auditor: "30000000-0000-4000-8000-000000000003",
  helper: "30000000-0000-4000-8000-000000000004",
};

const KEY_IDS: Record<string, string> = {
  deploy: "60000000-0000-4000-8000-000000000001",
  terraform: "60000000-0000-4000-8000-000000000002",
};

const LONG_WORD_NAME: string =
  "incident-responders.eu-west-1.enterprise-platform.payments-and-identity-services";

// Why a key holds less than a role, as every surface says it.
const OWNED_REASON: string =
  "Permissions scoped to “Only resources they own” don't apply to an API key: a key owns nothing.";

// Team Lead's API Keys card: Alert Member is scoped to what someone owns.
const LEAD_KEYS_GET: string =
  "These API keys get 2 of this role's 3 permissions: those scoped to “Only resources they own” don't apply to a key.";

const KEYS_GET_EVERYTHING: string =
  "These API keys can do everything this role allows.";

// Read by a screen reader, not drawn: a phone card's field name kept for it.
const SCREEN_READER_ONLY: RegExp = /(^|\s)sr-only(\s|$)/;

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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/*
 * Custom roles are an Enterprise feature (ee/Dashboard/CustomRoles): the
 * fixture serves the Enterprise pages only where ee/ is checked out, and
 * /edition.json says which. Everything here is about them, so it skips on
 * the Community Edition - the Dashboard Offline UI jobs run without ee/ -
 * where core's jest suites hold what is drawn instead (the upsell, and the
 * roles a team or key still has, to remove).
 */
let edition: string = "";

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  edition = await readFixtureEdition(request);
});

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  skipUnlessEnterprise(
    edition,
    "Custom roles are an Enterprise feature: ee/ is not checked out.",
  );
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  // The width a laptop draws the pages at; the phone tests set their own.
  await page.setViewportSize({ width: 1280, height: 900 });
});

test.afterEach(({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

/*
 * The whole page, or - with a dialog open - what the screen shows: a whole
 * page's shot stretches the dialog's backdrop over only the first screen.
 */
async function screenshot(
  page: Page,
  name: string,
  options: { screenOnly?: boolean } = {},
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: !options.screenOnly,
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

// An id as the fixture recorded it: a serialised ObjectID, a relation or a string.
function idOf(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "object" && value !== null) {
    if ("value" in value) {
      return String((value as { value: unknown }).value).toLowerCase();
    }

    if ("_id" in value) {
      return idOf((value as { _id: unknown })._id);
    }
  }

  return String(value).toLowerCase();
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function card(page: Page, title: string): Locator {
  return page
    .getByTestId("card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

function customRolesCard(page: Page): Locator {
  return page.getByTestId("api-key-custom-roles");
}

function row(scope: Locator, name: string): Locator {
  return scope
    .locator("tbody tr")
    .filter({ has: scope.page().getByText(name, { exact: true }) });
}

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

async function openKey(
  page: Page,
  keyId: string,
  search: string = "",
): Promise<void> {
  await page.goto(`${API_KEYS_ROUTE}/${keyId}${search}`);
  await expect(
    page.getByRole("heading", { name: "Permissions", exact: true }),
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

async function submitDialog(page: Page): Promise<void> {
  await dialog(page).getByTestId("modal-footer-submit-button").click();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

// The cards Add Custom Role offers, by role id, in order.
async function offeredRoleIds(page: Page): Promise<Array<string>> {
  return (
    await dialog(page)
      .getByRole("radio")
      .evaluateAll((cards: Array<Element>): Array<string> => {
        return cards.map((element: Element): string => {
          return element.getAttribute("data-testid") || "";
        });
      })
  ).map((testId: string): string => {
    return testId.replace("card-select-option-", "");
  });
}

test.describe("an API key's page", () => {
  test("lists the key's custom roles above its own permissions, each saying how much of it the key holds", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openKey(page, KEY_IDS["deploy"]!);

    const roles: Locator = customRolesCard(page);
    await expect(
      roles.getByRole("heading", { name: "Custom Roles", exact: true }),
    ).toBeVisible();
    await expect(roles).toContainText(
      "Named sets of permissions, made on the Roles page. Changing a role changes this key too.",
    );
    // "Roles" is a link to the Roles page, which nothing else on the page leads to.
    await expect(
      roles.getByRole("link", { name: "Roles", exact: true }),
    ).toHaveAttribute("href", ROLES_ROUTE);

    // Team Lead's Alert Member is limited to what someone owns: not the key's.
    await expect(row(roles, "Team Lead")).toContainText(
      "2 of its 3 permissions apply to this key",
    );
    await expect(row(roles, "Incident Helper")).toContainText("2 permissions");
    await expect(roles.locator("tbody tr")).toHaveCount(2);

    // Above what the key was given directly.
    const permissions: Locator = card(page, "Permissions");
    expect((await boxOf(roles)).y).toBeLessThan((await boxOf(permissions)).y);

    // The key's own permission only: never the copies its roles keep.
    await expect(permissions.locator("tbody tr")).toHaveCount(1);
    await expect(row(permissions, "Workflow Viewer")).toBeVisible();
    for (const copied of ["Incident Admin", "On-Call Admin", "Alert Member"]) {
      await expect(permissions.getByText(copied, { exact: true })).toHaveCount(
        0,
      );
    }
    const ownReads: Array<RecordedList> = (
      await fixtureLog(page)
    ).listRequests.filter((request: RecordedList): boolean => {
      return request.tableName === "ApiKeyPermission";
    });
    expect(ownReads.length).toBeGreaterThan(0);
    for (const request of ownReads) {
      expect(JSON.stringify(request.query["apiKeyCustomRoleId"])).toContain(
        "IsNull",
      );
    }

    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "api-key-custom-roles");

    // Each role opens its own page.
    await roles.getByRole("link", { name: "Team Lead", exact: true }).click();
    await expectPath(page, `${ROLES_ROUTE}/${ROLE_IDS["lead"]}`);
    await expect(
      page.getByRole("heading", { name: "API Keys with this Role" }),
    ).toBeVisible();
  });

  test("Add Custom Role offers the roles the key does not have, each saying what it would give, and gives the one picked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openKey(page, KEY_IDS["terraform"]!);

    const roles: Locator = customRolesCard(page);
    await expect(roles).toContainText("This key has no custom role yet");

    await roles
      .getByRole("button", { name: "Add Custom Role" })
      .first()
      .click();

    const form: Locator = dialog(page);
    await expect(form.getByTestId("modal-title")).toHaveText(
      "Add a Custom Role",
    );
    // Team Lead, on offer, has a permission scoped to what someone owns.
    await expect(form).toContainText(
      "The key gets everything the role allows, except permissions scoped to “Only resources they own”: a key owns nothing.",
    );
    // Where roles are made is a link, not a page named in plain text.
    await expect(
      form
        .getByTestId("modal-description")
        .getByRole("link", { name: "Roles", exact: true }),
    ).toHaveAttribute("href", ROLES_ROUTE);
    expect((await offeredRoleIds(page)).sort()).toEqual(
      [
        ROLE_IDS["responder"]!,
        ROLE_IDS["lead"]!,
        ROLE_IDS["auditor"]!,
        ROLE_IDS["helper"]!,
      ].sort(),
    );
    await expect(
      form.getByTestId(`card-select-option-${ROLE_IDS["lead"]}`),
    ).toContainText(
      "2 of its 3 permissions apply to this key · Runs a team: its incidents, its on-call and who is on it.",
    );
    await expect(
      form.getByTestId(`card-select-option-${ROLE_IDS["responder"]}`),
    ).toContainText("6 permissions");
    await screenshot(page, "api-key-add-custom-role", { screenOnly: true });

    await form
      .getByTestId(`card-select-option-${ROLE_IDS["responder"]}`)
      .click();
    await submitDialog(page);

    await expect(row(roles, "Incident Responder")).toContainText(
      "6 permissions",
    );
    const given: Array<Record<string, unknown>> = await createsOf(
      page,
      "ApiKeyCustomRole",
    );
    expect(given).toHaveLength(1);
    expect(idOf(given[0]!["apiKeyId"])).toBe(KEY_IDS["terraform"]);
    expect(idOf(given[0]!["customRoleId"])).toBe(ROLE_IDS["responder"]);

    // What the key was given directly is as it was.
    const permissions: Locator = card(page, "Permissions");
    await expect(permissions.locator("tbody tr")).toHaveCount(1);
    await expect(row(permissions, "Monitor Admin")).toBeVisible();

    // The roles it has are not offered again.
    await roles
      .getByRole("button", { name: "Add Custom Role" })
      .first()
      .click();
    await expect(
      dialog(page).getByTestId(`card-select-option-${ROLE_IDS["lead"]}`),
    ).toBeVisible();
    expect(await offeredRoleIds(page)).not.toContain(ROLE_IDS["responder"]);
  });

  test("a role that gives the key part of itself says why behind an (i), on hover and on keyboard focus", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openKey(page, KEY_IDS["deploy"]!);

    const roles: Locator = customRolesCard(page);
    const reason: Locator = roles.getByTestId("api-key-role-owned-reason");

    // Team Lead only: Incident Helper gives the key all of itself.
    await expect(reason).toHaveCount(1);
    await expect(
      row(roles, "Team Lead").getByTestId("api-key-role-owned-reason"),
    ).toHaveCount(1);
    await expect(reason).toHaveAccessibleName(
      "About the permissions that apply to this key",
    );

    await reason.hover();
    await expect(page.getByRole("tooltip")).toHaveText(OWNED_REASON);
    await screenshot(page, "api-key-role-owned-reason", { screenOnly: true });

    // Away and back by keyboard: the reason is not for mouse users only.
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await reason.focus();
    await expect(page.getByRole("tooltip")).toHaveText(OWNED_REASON);
  });

  test("Add Custom Role says nothing of what someone owns when no role on offer has such a permission", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Deploy bot has Team Lead: Incident Responder and Auditor are offered.
    await openKey(page, KEY_IDS["deploy"]!);

    await customRolesCard(page)
      .getByRole("button", { name: "Add Custom Role" })
      .first()
      .click();

    const form: Locator = dialog(page);
    await expect(form).toContainText(
      "The key gets everything the role allows. Make or change roles on the Roles page.",
    );
    await expect(form).not.toContainText("Only resources they own");
  });

  test("Remove takes a role from the key, and says the key keeps the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openKey(page, KEY_IDS["deploy"]!);

    const roles: Locator = customRolesCard(page);
    await row(roles, "Team Lead")
      .getByRole("button", { name: "Remove" })
      .click();

    const confirm: Locator = dialog(page);
    await expect(confirm).toContainText("Remove Team Lead");
    await expect(confirm).toContainText(
      "This key loses the permissions of Team Lead. Its other roles and permissions stay.",
    );
    await screenshot(page, "api-key-remove-custom-role", { screenOnly: true });
    await submitDialog(page);

    await expect(row(roles, "Team Lead")).toHaveCount(0);
    await expect(row(roles, "Incident Helper")).toBeVisible();
    const deletes: Array<RecordedDelete> = (await fixtureLog(page)).deletes;
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.tableName).toBe("ApiKeyCustomRole");
    // Its own permission stays.
    await expect(
      row(card(page, "Permissions"), "Workflow Viewer"),
    ).toBeVisible();
  });

  test("a project with no custom role sees the key's page as it always was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openKey(page, KEY_IDS["deploy"]!, "?roles=none");

    await expect(
      row(card(page, "Permissions"), "Workflow Viewer"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Custom Roles", exact: true }),
    ).toHaveCount(0);
    await expect(customRolesCard(page)).toHaveCount(0);
  });
});

test.describe("a role's page", () => {
  test("lists the API keys given the role, and says a change reaches them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["lead"]!);

    await expect(card(page, "Permissions")).toContainText(
      "Given to 1 team (3 people) and 1 API key. A change here changes what they can do at once.",
    );

    const keys: Locator = page.getByTestId("custom-role-api-keys");
    await expect(
      keys.getByRole("heading", { name: "API Keys with this Role" }),
    ).toBeVisible();
    // Alert Member is scoped to what someone owns: the keys get the rest.
    await expect(keys).toContainText(LEAD_KEYS_GET);
    await expect(keys).not.toContainText(KEYS_GET_EVERYTHING);
    await expect(keys.locator("tbody tr")).toHaveCount(1);
    await expect(
      keys.getByRole("link", { name: "Deploy bot", exact: true }),
    ).toHaveAttribute("href", `${API_KEYS_ROUTE}/${KEY_IDS["deploy"]}`);

    // Below the teams given it.
    expect((await boxOf(page.getByTestId("custom-role-teams"))).y).toBeLessThan(
      (await boxOf(keys)).y,
    );

    await screenshot(page, "role-page-api-keys");
  });

  test("gives the role to an API key, offering only the keys without it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["lead"]!);

    const keys: Locator = page.getByTestId("custom-role-api-keys");
    await keys
      .getByRole("button", { name: "Give to an API Key" })
      .first()
      .click();

    const form: Locator = dialog(page);
    await expect(form).toContainText("Give Team Lead to an API Key");
    await expect(form).toContainText(
      "From now on the key can do everything this role allows, except permissions scoped to “Only resources they own”: a key owns nothing.",
    );
    await form.getByRole("combobox", { name: "API Key" }).click();
    // Not Deploy bot, which has the role already.
    const options: Locator = page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveText(["Terraform"]);
    await screenshot(page, "role-give-to-api-key", { screenOnly: true });
    await options.filter({ hasText: "Terraform" }).click();
    await submitDialog(page);

    const given: Array<Record<string, unknown>> = await createsOf(
      page,
      "ApiKeyCustomRole",
    );
    expect(given).toHaveLength(1);
    expect(idOf(given[0]!["customRoleId"])).toBe(ROLE_IDS["lead"]);
    expect(idOf(given[0]!["apiKey"] || given[0]!["apiKeyId"])).toBe(
      KEY_IDS["terraform"],
    );

    // The key is listed, and the reach is read again: one more key.
    await expect(
      keys.getByRole("link", { name: "Terraform", exact: true }),
    ).toBeVisible();
    await expect(card(page, "Permissions")).toContainText(
      "Given to 1 team (3 people) and 2 API keys.",
    );

    // Every key has the role now: Give to an API Key is off, and says why.
    const give: Locator = keys
      .getByRole("button", { name: "Give to an API Key" })
      .first();
    await expect(give).toBeDisabled();
    await keys.getByTestId("card-button-disabled-wrapper").first().hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "Every API key has this role already.",
    );
  });

  test("a role with nothing scoped to what someone owns gives its keys everything, and says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["responder"]!);

    const keys: Locator = page.getByTestId("custom-role-api-keys");
    await expect(keys).toContainText(KEYS_GET_EVERYTHING);

    await keys
      .getByRole("button", { name: "Give to an API Key" })
      .first()
      .click();
    const form: Locator = dialog(page);
    await expect(form).toContainText(
      "From now on the key can do everything this role allows.",
    );
    await expect(form).not.toContainText("Only resources they own");
  });

  test("removing the role's owned-only permission: its keys get everything, said at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["lead"]!);

    const keys: Locator = page.getByTestId("custom-role-api-keys");
    await expect(keys).toContainText(LEAD_KEYS_GET);

    await row(card(page, "Permissions"), "Alert Member")
      .getByTestId("row-actions-more-button")
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await submitDialog(page);

    await expect(row(card(page, "Permissions"), "Alert Member")).toHaveCount(0);
    await expect(keys).toContainText(KEYS_GET_EVERYTHING);
    await expect(keys).not.toContainText("Only resources they own");
  });

  test("a project with no API key: the card says so, links to the API Keys page, and Give to an API Key is off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["lead"]!, "?keys=none");

    const keys: Locator = page.getByTestId("custom-role-api-keys");
    await expect(keys).toContainText("This project has no API key yet");
    await expect(keys).toContainText(
      "Create one on the API Keys page, then give it this role here.",
    );
    // No button under it: a key is made on the API Keys page first.
    await expect(keys.getByTestId("empty-table-create-button")).toHaveCount(0);

    const give: Locator = keys
      .getByRole("button", { name: "Give to an API Key" })
      .first();
    await expect(give).toBeDisabled();
    await keys.getByTestId("card-button-disabled-wrapper").first().hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "This project has no API key yet. Create one on the API Keys page.",
    );
    await screenshot(page, "role-page-no-api-key");

    await keys.getByRole("link", { name: "API Keys", exact: true }).click();
    await expectPath(page, API_KEYS_ROUTE);
  });

  test("Remove takes the role from one key, and says what that key keeps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["lead"]!);

    const keys: Locator = page.getByTestId("custom-role-api-keys");
    await row(keys, "Deploy bot")
      .getByRole("button", { name: "Remove" })
      .click();

    const confirm: Locator = dialog(page);
    await expect(confirm).toContainText("Remove Team Lead from Deploy bot");
    await expect(confirm).toContainText(
      "Deploy bot loses the permissions of Team Lead. Its other roles and permissions stay.",
    );
    await submitDialog(page);

    await expect(row(keys, "Deploy bot")).toHaveCount(0);
    const deletes: Array<RecordedDelete> = (await fixtureLog(page)).deletes;
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.tableName).toBe("ApiKeyCustomRole");
    await expect(card(page, "Permissions")).toContainText(
      "Given to 1 team (3 people). A change here changes what they can do at once.",
    );
  });

  test("its Delete counts the keys that lose the role", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["lead"]!);
    await page.getByRole("button", { name: "Delete Custom Role" }).click();

    const confirm: Locator = dialog(page);
    await expect(confirm).toContainText(
      "Deleting a custom role takes its permissions from every team and API key that has it. The teams and keys themselves stay, with everything else they have.",
    );
    await expect(confirm.getByTestId("custom-role-delete-reach")).toHaveText(
      "It is given to 1 team (3 people) and 1 API key right now.",
    );
  });

  test("someone who may not read the project's API keys sees no keys there, and a reach of teams only", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRole(page, ROLE_IDS["lead"]!, "?user=editor");

    await expect(card(page, "Permissions")).toContainText(
      "Given to 1 team (3 people). A change here changes what they can do at once.",
    );
    await expect(page.getByTestId("custom-role-api-keys")).toHaveCount(0);
    await expect(page.getByText("Deploy bot")).toHaveCount(0);
  });
});

test.describe("Create API Key", () => {
  test("offers the custom roles that give a key something, and the new key opens with the one picked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(API_KEYS_ROUTE);
    await page.getByRole("button", { name: "Create API Key" }).first().click();

    const form: Locator = dialog(page);
    const lead: Locator = form.getByTestId(
      `card-select-option-customRole:${ROLE_IDS["lead"]}`,
    );
    await expect(lead).toContainText(
      "Custom role · 2 of its 3 permissions apply to this key · Runs a team: its incidents, its on-call and who is on it.",
    );
    await expect(
      form.getByTestId(
        `card-select-option-customRole:${ROLE_IDS["responder"]}`,
      ),
    ).toContainText("Custom role · 6 permissions");
    // Auditor holds nothing yet: it would give the key nothing.
    await expect(
      form.getByTestId(`card-select-option-customRole:${ROLE_IDS["auditor"]}`),
    ).toHaveCount(0);
    await screenshot(page, "create-api-key-custom-roles", { screenOnly: true });

    await form.getByPlaceholder("API Key Name").fill("Pager bridge");
    await lead.click();
    await submitDialog(page);

    // The key first, then the role given to it; then its page opens.
    await expectPath(page, KEY_PAGE_PATH);
    const keys: Array<Record<string, unknown>> = await createsOf(
      page,
      "ApiKey",
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]!["name"]).toBe("Pager bridge");
    const given: Array<Record<string, unknown>> = await createsOf(
      page,
      "ApiKeyCustomRole",
    );
    expect(given).toHaveLength(1);
    expect(idOf(given[0]!["customRoleId"])).toBe(ROLE_IDS["lead"]);
    expect(idOf(given[0]!["apiKeyId"])).toBe(
      new URL(page.url()).pathname.split("/").pop(),
    );
    // Nothing of its own: the role is all it holds.
    expect(await createsOf(page, "ApiKeyPermission")).toEqual([]);

    await expect(row(customRolesCard(page), "Team Lead")).toContainText(
      "2 of its 3 permissions apply to this key",
    );
  });
});

test.describe("on a phone and in dark mode", () => {
  test("a key's page and Add Custom Role fit a phone, long names wrapping inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openKey(page, KEY_IDS["deploy"]!, "?long=1");

    const roles: Locator = customRolesCard(page);
    const name: Locator = roles.getByText(LONG_WORD_NAME, { exact: true });
    await expect(name).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    // The name breaks inside the card, not past its edge.
    const cardBox: Box = await boxOf(roles);
    const nameBox: Box = await boxOf(name);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width,
    );

    // Each role's card leads with its name: no "Role" over every one.
    const fieldNames: Locator = roles.locator("dl dt");
    expect(await fieldNames.count()).toBeGreaterThan(0);
    for (const fieldName of await fieldNames.all()) {
      await expect(fieldName).toHaveText("Role");
      await expect(fieldName).toHaveClass(SCREEN_READER_ONLY);
    }
    await screenshot(page, "phone-api-key-custom-roles");

    await roles
      .getByRole("button", { name: "Add Custom Role" })
      .first()
      .click();
    await expect(
      dialog(page).getByTestId(`card-select-option-${ROLE_IDS["responder"]}`),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "phone-api-key-add-custom-role", {
      screenOnly: true,
    });
  });

  test("dark mode draws the key's Custom Roles card dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openKey(page, KEY_IDS["deploy"]!, "?theme=dark");

    const roles: Locator = customRolesCard(page);
    await expect(row(roles, "Team Lead")).toBeVisible();

    const colours: { surface: string; name: string } = await roles.evaluate(
      (element: Element): { surface: string; name: string } => {
        const surface: Element | null = element.querySelector(
          "[data-testid='card'] > div",
        );
        const name: Element | undefined = Array.from(
          element.querySelectorAll("tbody span"),
        ).find((span: Element): boolean => {
          return span.textContent === "Team Lead";
        });

        return {
          surface: surface ? getComputedStyle(surface).backgroundColor : "",
          name: name ? getComputedStyle(name).color : "",
        };
      },
    );

    // A dark card with light text: not the light theme's white and near-black.
    const brightness: (colour: string) => number = (colour: string): number => {
      const channels: Array<number> = (colour.match(/\d+/g) || [])
        .slice(0, 3)
        .map(Number);
      return (
        channels.reduce((sum: number, channel: number): number => {
          return sum + channel;
        }, 0) / 3
      );
    };
    expect(brightness(colours.surface)).toBeLessThan(80);
    expect(brightness(colours.name)).toBeGreaterThan(180);

    await screenshot(page, "dark-api-key-custom-roles");
  });
});
