import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * HANDING AN INCIDENT'S ROLES ON (#10191, #10195), on the real incident and
 * incident episode overview pages against the offline fixture
 * (Fixture/Fixture.js), in a browser.
 *
 * #10191: the Incident Roles card's Reassign took the commander's role off
 * its holder and then gave it to the person picked; a reader who may not
 * take anybody off a role read "You do not have permission to delete this
 * Incident member" as raw text behind the dialog. Reassign is one update of
 * the role's row now, offered to whoever may change roles, and what it is
 * refused is said in its dialog.
 *
 * #10195: the commander was changed only from that card, further down the
 * page. The name in the header is the control now: pointed at, a pencil
 * fades in after the role's label, a ring goes round the name and "Click to
 * reassign" shows; pressed, or opened from the keyboard, it opens the
 * header's own list of people right under it, and the person picked takes
 * the role over. To a reader who may not hand roles on, and on an incident
 * that is over, it is the plain name it always was.
 *
 * Maya Chen holds Incident Commander on incident #1042 and episode #12
 * (Fixture.js); ?state=ongoing keeps them open.
 */

// The fixture server's port: EVENT_OVERVIEW_FIXTURE_PORT, as the config and server.js read it.
const PORT: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");

function uuid(prefix: string, suffix: number): string {
  return `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

const INCIDENT_PATH: string = `/dashboard/${PROJECT_ID}/incidents/${uuid("20000000", 1042)}`;
const EPISODE_PATH: string = `/dashboard/${PROJECT_ID}/incidents/episodes/${uuid("50000000", 12)}`;

const JORDAN_ID: string = uuid("80000000", 3);

const REASSIGN_MAYA: string = "Reassign Incident Commander from Maya Chen";
const REASSIGN_JORDAN: string = "Reassign Incident Commander from Jordan Patel";
const LIST_NAME: string = "Reassign Incident Commander";
const CLICK_TO_REASSIGN: string = "Click to reassign";

// What the fixture's server says when it refuses a role handed on.
const ROLE_REASSIGN_REFUSAL: string =
  "You do not have permission to update this Incident Member.";

// Why Reassign is locked for a reader who may not hand roles on.
const ROLES_LOCKED: string =
  "You do not have permission to change this incident's roles.";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/event-overview-ui",
);

interface RecordedWrite {
  modelName: string;
  id?: string;
  data?: unknown;
}

interface FixtureState {
  unhandled: Array<unknown>;
  creates: Array<RecordedWrite>;
  updates: Array<RecordedWrite>;
  deletes: Array<RecordedWrite>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    await route.abort();
  });

  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    (await fixture(page)).unhandled,
    "requests the fixture does not model",
  ).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __eventOverviewFixture: FixtureState })
          .__eventOverviewFixture,
      ),
    ) as FixtureState;
  });
}

// The writes of one table: what the page sent the server.
async function writesTo(
  page: Page,
  modelName: string,
): Promise<{
  creates: Array<RecordedWrite>;
  updates: Array<RecordedWrite>;
  deletes: Array<RecordedWrite>;
}> {
  const state: FixtureState = await fixture(page);
  const of: (writes: Array<RecordedWrite>) => Array<RecordedWrite> = (
    writes: Array<RecordedWrite>,
  ): Array<RecordedWrite> => {
    return writes.filter((write: RecordedWrite): boolean => {
      return write.modelName === modelName;
    });
  };

  return {
    creates: of(state.creates),
    updates: of(state.updates),
    deletes: of(state.deletes),
  };
}

function hero(page: Page): Locator {
  return page.getByTestId("event-header");
}

function commander(page: Page): Locator {
  return hero(page).getByTestId("event-commander");
}

// The pencil after the commander's label.
function pencil(page: Page): Locator {
  return hero(page).getByTestId("event-header-fact-edit-hint").locator("svg");
}

function card(page: Page, heading: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { level: 2, name: heading, exact: true }),
  });
}

// Who a roles card names in a role.
async function holdersIn(roles: Locator, roleName: string): Promise<string> {
  const section: Locator = roles
    .getByTestId("member-role-header")
    .filter({ hasText: roleName })
    .locator("..");

  return (
    (await section.getByTestId("member-role-member-name").allTextContents())
      .join(", ")
      .trim() || "nobody"
  );
}

async function openRecord(
  page: Page,
  recordPath: string,
  query: string,
): Promise<void> {
  await page.goto(`${recordPath}?${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(hero(page).getByTestId("event-owners")).toBeVisible({
    timeout: 30000,
  });
  await expect(commander(page)).toBeVisible({ timeout: 30000 });
}

async function opacityOf(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).opacity;
  });
}

async function screenshot(locator: Locator, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

async function screenshotPage(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

test.describe("the header's commander hands the role on (#10195)", () => {
  test("pointed at: a pencil after the label, a ring round the name and Click to reassign - and nothing moves", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, INCIDENT_PATH, "state=ongoing");

    const name: Locator = commander(page).getByRole("button", {
      name: REASSIGN_MAYA,
    });
    await expect(name).toBeVisible();
    await expect(name).toHaveText(/Maya Chen/);

    // At rest: the plain name, no pencil, no ring.
    expect(await opacityOf(pencil(page))).toBe("0");
    const before: { x: number; y: number; width: number; height: number } =
      (await name.boundingBox())!;
    const restingShadow: string = await name.evaluate(
      (element: Element): string => {
        return getComputedStyle(element).boxShadow;
      },
    );

    // The name reads on one line, as the plain name always did.
    const nameLine: { x: number; y: number; width: number; height: number } =
      (await name.getByTestId("event-person-name").boundingBox())!;
    expect(nameLine.height, "one line").toBeLessThan(28);

    await name.hover();

    const tooltip: Locator = page.getByRole("tooltip");
    await expect(tooltip).toHaveText(CLICK_TO_REASSIGN);
    await expect
      .poll(() => {
        return opacityOf(pencil(page));
      })
      .toBe("1");

    // Under the name: the role's label and its pencil stay in sight.
    const tip: { x: number; y: number; width: number; height: number } =
      (await tooltip.boundingBox())!;
    expect(tip.y, "under the name").toBeGreaterThanOrEqual(
      before.y + before.height - 1,
    );
    await expect(pencil(page)).toBeInViewport();
    await expect
      .poll(() => {
        return name.evaluate((element: Element): string => {
          return getComputedStyle(element).boxShadow;
        });
      })
      .not.toBe(restingShadow);

    // Lighting up moves nothing: the name stays where it was.
    expect(await name.boundingBox()).toEqual(before);

    await screenshot(hero(page), "incident-commander-reassign-hover");
  });

  test("pressed: the header's list opens right under the name with Maya ticked, and picking Jordan hands the role over in one update", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, INCIDENT_PATH, "state=ongoing");

    const name: Locator = commander(page).getByRole("button", {
      name: REASSIGN_MAYA,
    });
    await name.click();

    const list: Locator = page.getByRole("dialog", { name: LIST_NAME });
    await expect(list).toBeVisible();
    await expect(name).toHaveAttribute("aria-expanded", "true");
    // The tooltip goes while the list is open.
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    // The pencil stays lit while the list is open.
    await expect
      .poll(() => {
        return opacityOf(pencil(page));
      })
      .toBe("1");

    // Right under the name.
    const control: { x: number; y: number; width: number; height: number } =
      (await name.boundingBox())!;
    const popup: { x: number; y: number; width: number; height: number } =
      (await list.boundingBox())!;
    expect(popup.y, "under the name").toBeGreaterThanOrEqual(
      control.y + control.height - 0.5,
    );
    expect(popup.y - (control.y + control.height)).toBeLessThanOrEqual(12);

    // The holder is ticked.
    await expect(
      list.getByRole("option", { name: /Maya Chen/ }),
    ).toHaveAttribute("aria-selected", "true");

    await page.mouse.move(0, 0);
    await screenshotPage(page, "incident-commander-reassign-list");

    await list.getByRole("option", { name: /Jordan Patel/ }).click();

    await expect(list).toHaveCount(0);
    await expect(commander(page).getByTestId("event-person-name")).toHaveText([
      "Jordan Patel",
    ]);
    // The keyboard is back on the name, which now names Jordan.
    await expect(
      commander(page).getByRole("button", { name: REASSIGN_JORDAN }),
    ).toBeFocused();

    // One update of the commander's row: never a delete and a create.
    const writes: {
      creates: Array<RecordedWrite>;
      updates: Array<RecordedWrite>;
      deletes: Array<RecordedWrite>;
    } = await writesTo(page, "IncidentMember");
    expect(writes.deletes).toEqual([]);
    expect(writes.creates).toEqual([]);
    expect(writes.updates).toHaveLength(1);
    expect(JSON.stringify(writes.updates[0]!.data)).toContain(JORDAN_ID);

    // The roles card says the same once it has read the incident again.
    await expect
      .poll(() => {
        return holdersIn(card(page, "Incident Roles"), "Incident Commander");
      })
      .toBe("Jordan Patel");

    await screenshot(hero(page), "incident-commander-reassigned");
  });

  test("from the keyboard: Enter on the name opens the list in its search box, Down and Enter pick, and the focus comes back to the name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, INCIDENT_PATH, "state=ongoing");

    const name: Locator = commander(page).getByRole("button", {
      name: REASSIGN_MAYA,
    });
    await name.focus();
    await page.keyboard.press("Enter");

    const list: Locator = page.getByRole("dialog", { name: LIST_NAME });
    await expect(list).toBeVisible();
    await expect(
      list.getByRole("combobox", { name: "Search people..." }),
    ).toBeFocused();

    // People in name order: Alex Kim first, then Jordan Patel.
    await expect(list.getByRole("option").first()).toContainText("Alex Kim");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(list).toHaveCount(0);
    await expect(commander(page).getByTestId("event-person-name")).toHaveText([
      "Jordan Patel",
    ]);
    await expect(
      commander(page).getByRole("button", { name: REASSIGN_JORDAN }),
    ).toBeFocused();
  });

  test("Escape closes the list, hands nothing on, and the keyboard is back on the name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, INCIDENT_PATH, "state=ongoing");

    const name: Locator = commander(page).getByRole("button", {
      name: REASSIGN_MAYA,
    });
    await name.click();

    const list: Locator = page.getByRole("dialog", { name: LIST_NAME });
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(list).toHaveCount(0);
    await expect(name).toBeFocused();
    expect((await writesTo(page, "IncidentMember")).updates).toEqual([]);
  });

  test("?fail=role-reassign: the server's refusal is said in the list, which stays open, and Maya keeps the role", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, INCIDENT_PATH, "state=ongoing&fail=role-reassign");

    await commander(page).getByRole("button", { name: REASSIGN_MAYA }).click();

    const list: Locator = page.getByRole("dialog", { name: LIST_NAME });
    await list.getByRole("option", { name: /Jordan Patel/ }).click();

    await expect(list.getByRole("alert")).toContainText(ROLE_REASSIGN_REFUSAL);
    await expect(list).toBeVisible();
    // Said once, in the list: nowhere else on the page.
    await expect(page.getByText(ROLE_REASSIGN_REFUSAL)).toHaveCount(1);
    await expect(commander(page).getByTestId("event-person-name")).toHaveText([
      "Maya Chen",
    ]);

    await screenshotPage(page, "incident-commander-reassign-refused");
  });

  test("a reader who may not hand roles on reads the commander as plain text: no button, no pencil, no tooltip", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const role of ["viewer", "role-giver"]) {
      await openRecord(page, INCIDENT_PATH, `state=ongoing&role=${role}`);

      await expect(commander(page).getByTestId("event-person-name")).toHaveText(
        ["Maya Chen"],
      );
      await expect(commander(page).getByRole("button")).toHaveCount(0);
      await expect(
        hero(page).getByTestId("event-header-fact-edit-hint"),
      ).toHaveCount(0);

      await commander(page).getByTestId("event-person-name").hover();
      await page.waitForTimeout(300);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
  });

  test("an incident that is over names its commander as plain text: there is nothing to hand on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, INCIDENT_PATH, "state=resolved");

    await expect(commander(page).getByTestId("event-person-name")).toHaveText([
      "Maya Chen",
    ]);
    await expect(commander(page).getByRole("button")).toHaveCount(0);
  });

  test("an incident episode's commander is handed on the same way: one update of the episode's row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, EPISODE_PATH, "state=ongoing");

    await commander(page).getByRole("button", { name: REASSIGN_MAYA }).click();

    const list: Locator = page.getByRole("dialog", { name: LIST_NAME });
    await list.getByRole("option", { name: /Jordan Patel/ }).click();

    await expect(list).toHaveCount(0);
    await expect(commander(page).getByTestId("event-person-name")).toHaveText([
      "Jordan Patel",
    ]);

    const writes: {
      creates: Array<RecordedWrite>;
      updates: Array<RecordedWrite>;
      deletes: Array<RecordedWrite>;
    } = await writesTo(page, "IncidentEpisodeRoleMember");
    expect(writes.deletes).toEqual([]);
    expect(writes.creates).toEqual([]);
    expect(writes.updates).toHaveLength(1);
    expect(JSON.stringify(writes.updates[0]!.data)).toContain(JORDAN_ID);
  });

  test("on a phone and on the dark theme, the name, its ring and its list fit the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRecord(page, INCIDENT_PATH, "state=ongoing&theme=dark");

    const name: Locator = commander(page).getByRole("button", {
      name: REASSIGN_MAYA,
    });
    await name.click();

    const list: Locator = page.getByRole("dialog", { name: LIST_NAME });
    await expect(list).toBeVisible();

    const box: { x: number; y: number; width: number; height: number } =
      (await list.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expectNoSidewaysScroll(page);

    await screenshotPage(page, "incident-commander-reassign-phone-dark");
  });
});

test.describe("the Incident Roles card's Reassign (#10191)", () => {
  // Picks `name` in the Reassign dialog's picker, by typing it.
  async function pickInDialog(dialog: Locator, name: string): Promise<void> {
    const picker: Locator = dialog.getByRole("combobox", {
      name: "Incident Commander",
    });
    await picker.click();
    await picker.fill(name);
    await dialog.page().keyboard.press("Enter");
  }

  test("#10191's customer, who may change roles but take nobody off one: Remove is locked, and Reassign hands the role on in one update", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, INCIDENT_PATH, "state=ongoing&role=role-editor");

    const roles: Locator = card(page, "Incident Roles");
    await expect(roles.getByTestId("member-role-remove-locked")).toBeVisible();
    await expect(roles.getByTestId("member-role-reassign-locked")).toHaveCount(
      0,
    );

    await roles.getByRole("button", { name: REASSIGN_MAYA }).click();

    const dialog: Locator = page.getByRole("dialog", { name: "Reassign Role" });
    await expect(dialog).toBeVisible();
    await pickInDialog(dialog, "Jordan Patel");
    await dialog.getByRole("button", { name: "Reassign", exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => {
        return holdersIn(roles, "Incident Commander");
      })
      .toBe("Jordan Patel");

    const writes: {
      creates: Array<RecordedWrite>;
      updates: Array<RecordedWrite>;
      deletes: Array<RecordedWrite>;
    } = await writesTo(page, "IncidentMember");
    expect(writes.deletes).toEqual([]);
    expect(writes.creates).toEqual([]);
    expect(writes.updates).toHaveLength(1);

    // Nothing about deleting anywhere on the page.
    await expect(page.getByText(/permission to delete/i)).toHaveCount(0);
  });

  test("refused by the server, Reassign says why in its dialog, which stays open - never behind it - and closed it leaves nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, INCIDENT_PATH, "state=ongoing&fail=role-reassign");

    const roles: Locator = card(page, "Incident Roles");
    await roles.getByRole("button", { name: REASSIGN_MAYA }).click();

    const dialog: Locator = page.getByRole("dialog", { name: "Reassign Role" });
    await pickInDialog(dialog, "Jordan Patel");
    await dialog.getByRole("button", { name: "Reassign", exact: true }).click();

    await expect(dialog.getByText(ROLE_REASSIGN_REFUSAL)).toBeVisible();
    await expect(page.getByText(ROLE_REASSIGN_REFUSAL)).toHaveCount(1);
    await expect(dialog).toBeVisible();

    await screenshotPage(page, "incident-roles-reassign-refused");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(ROLE_REASSIGN_REFUSAL)).toHaveCount(0);
    expect(await holdersIn(roles, "Incident Commander")).toBe("Maya Chen");
  });

  test("a reader who may give and take off roles but not hand them on finds Reassign locked, saying why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRecord(page, INCIDENT_PATH, "state=ongoing&role=role-giver");

    const locked: Locator = card(page, "Incident Roles").getByTestId(
      "member-role-reassign-locked",
    );
    await expect(locked).toBeVisible();
    // Why, first, in the words of what they pressed; the permission follows.
    const reason: string = (await locked.getAttribute("aria-label")) || "";
    expect(reason.startsWith(ROLES_LOCKED), reason).toBe(true);
    expect(reason).toContain("Edit Incident Member");
    await expect(
      locked.getByRole("button", { name: REASSIGN_MAYA }),
    ).toBeDisabled();

    await locked.hover();
    await expect(page.getByRole("tooltip")).toContainText(ROLES_LOCKED);
  });
});
