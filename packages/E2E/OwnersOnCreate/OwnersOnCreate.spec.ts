import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * "On Alert/Incident creation - I don't see a way to add the team of the
 * incident creator as an owner. Can you please check if this is true, and
 * if this is true, can you please build that option as well? We can have
 * that and more, so it is not visible by default on the form." - the
 * maintainer. And a customer: nothing on the form said which owner rules
 * would run, or whom they would add ("Team_XYZ will be added").
 *
 * Declare Incident and Create Alert in a browser, against the offline
 * fixture (OwnersOnCreate/Fixture), whose owner rule preview answers as the
 * server would:
 *
 *   - Owners waits folded under More fields at the end of the first step,
 *     named in its header but not open;
 *   - opened, it says the person creating it becomes an owner anyway, and
 *     offers their own teams one click away ("Your teams: + Database
 *     + Members + Platform  Add all") - nothing picked by itself, nothing
 *     offered to someone in no team;
 *   - the review step's Owners row always says who will own it: the owners
 *     picked, then each owner rule that will run, by name, with whom it
 *     adds - worked out by the server for what was filled in (a label brings
 *     a rule in); while it asks, when it cannot, and to someone who may not
 *     see the rules, it says so, or nothing;
 *   - what the preview is asked, and what a create sends: the owners picked,
 *     as ownerUsers and ownerTeams;
 *   - all of it at a 390px phone's width, in dark mode and in German.
 *
 * And the other half, Settings > Owner Rules: an incident or alert owner
 * rule lists teams under Creator's Team, last in its Inherit Owners fold -
 * whose folded line says so - and a rule that lists only a team there adds
 * someone: it saves, is named after it, reads back on Edit, and is not
 * marked "Adds nothing".
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000c7";
const INCIDENT_PATH: string = `/dashboard/${PROJECT_ID}/incidents/create`;
const ALERT_PATH: string = `/dashboard/${PROJECT_ID}/alerts/create`;
const INCIDENT_RULES_PATH: string = `/dashboard/${PROJECT_ID}/incidents/settings/owner-rules`;
const ALERT_RULES_PATH: string = `/dashboard/${PROJECT_ID}/alerts/settings/owner-rules`;
const PORT: string = process.env["OWNERS_ON_CREATE_FIXTURE_PORT"] || "4253";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/owners-on-create-ui",
);

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

const INCIDENT_LINE: string =
  "You become an owner when you declare it. Add your team, or anyone else who should own it.";
const ALERT_LINE: string =
  "You become an owner when you create it. Add your team, or anyone else who should own it.";

// The owner rule form's words for the creator's team, on each kind of rule.
const RULE_FOLD_LINES: Record<"incident" | "alert", string> = {
  incident:
    "Optionally assign owners from related entities, or the creator's team, to the incident.",
  alert:
    "Optionally assign owners from related entities, or the creator's team, to the alert.",
};
const CREATOR_TEAM_LINES: Record<"incident" | "alert", string> = {
  incident:
    "When the person who declares a matching incident is in one of these teams, that team becomes an owner too.",
  alert:
    "When the person who creates a matching alert is in one of these teams, that team becomes an owner too.",
};
const CREATOR_TEAM_RULE_NAME: string = "Add the creator's team as an owner";
const INHERIT_OWNER_SWITCHES: Array<string> = [
  "inheritOwnersFromMonitors",
  "inheritOwnersFromHosts",
  "inheritOwnersFromKubernetesClusters",
  "inheritOwnersFromDockerHosts",
  "inheritOwnersFromPodmanHosts",
  "inheritOwnersFromServices",
];

interface FixtureIds {
  ada: string;
  grace: string;
  linus: string;
  platform: string;
  database: string;
  sre: string;
  members: string;
  frontend: string;
  databaseLabel: string;
}

interface FixtureRecord {
  previews: Array<{
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }>;
  saves: Array<{
    model: string;
    data: Record<string, unknown>;
    miscDataProps: Record<string, unknown>;
  }>;
  unhandled: Array<Record<string, unknown>>;
  ids: FixtureIds;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture: a request to a real host is a test bug.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the pages made is one the fixture answers as the API does.
  expect((await fixture(page)).unhandled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function openForm(
  page: Page,
  data: { form?: "incident" | "alert"; query?: string } = {},
): Promise<void> {
  const form: "incident" | "alert" = data.form || "incident";
  const query: string = [form === "alert" ? "form=alert" : "", data.query || ""]
    .filter(Boolean)
    .join("&");

  await page.goto(
    `${form === "alert" ? ALERT_PATH : INCIDENT_PATH}${query ? `?${query}` : ""}`,
  );
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(titleBox(page)).toBeVisible();
}

// The form's first box, in any language: its Title.
function titleBox(page: Page): Locator {
  return page.getByRole("textbox").first();
}

function moreFields(page: Page, name: string = "More fields"): Locator {
  return page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
}

// The Title first: leaving it empty would fold a "Title is required." in.
async function fillDetails(
  page: Page,
  form: "incident" | "alert" = "incident",
): Promise<void> {
  await titleBox(page).fill("Checkout is down");
  await page
    .getByRole("combobox", {
      name: form === "alert" ? /^Alert Severity/ : /^Incident Severity/,
    })
    .first()
    .click();
  await page
    .getByRole("option", {
      name: form === "alert" ? "High" : "Critical",
      exact: true,
    })
    .first()
    .click();
}

/*
 * Opened from the keyboard: a click could land on the header while a field
 * it leaves validates and shifts it.
 */
async function openMoreFields(
  page: Page,
  name: string = "More fields",
): Promise<void> {
  await openFold(page, moreFields(page, name));
}

async function openFold(page: Page, header: Locator): Promise<void> {
  await header.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-expanded", "true");
}

function ownersGroup(page: Page): Locator {
  return page.getByRole("group", { name: /^Owners/ }).first();
}

function suggestions(page: Page): Locator {
  return page.getByTestId("my-team-suggestions-line");
}

async function suggestedTeams(page: Page): Promise<Array<string>> {
  return (
    await suggestions(page).getByTestId("my-team-suggestion").allTextContents()
  ).map((text: string): string => {
    return text.trim();
  });
}

// Who the Owners picker holds, by name: each chip names its pick by id.
async function pickedNames(page: Page): Promise<Array<string>> {
  const ids: FixtureIds = (await fixture(page)).ids;
  const names: Record<string, string> = {
    [ids.ada]: "Ada Lovelace",
    [ids.grace]: "Grace Hopper",
    [ids.linus]: "Linus Torvalds",
    [ids.platform]: "Platform",
    [ids.database]: "Database",
    [ids.sre]: "SRE On-call",
    [ids.members]: "Members",
  };

  const chipIds: Array<string> = await ownersGroup(page)
    .getByTestId("people-chip")
    .evaluateAll((chips: Array<Element>): Array<string> => {
      return chips.map((chip: Element): string => {
        return chip.getAttribute("data-id") || "";
      });
    });

  return chipIds.map((id: string): string => {
    return names[id] || id;
  });
}

// What was declared or created: the event itself, not what it brings along.
async function eventSaves(
  page: Page,
  model: string,
): Promise<FixtureRecord["saves"]> {
  return (await fixture(page)).saves.filter(
    (save: FixtureRecord["saves"][number]): boolean => {
      return save.model === model;
    },
  );
}

async function toSummary(
  page: Page,
  form: "incident" | "alert" = "incident",
): Promise<void> {
  const steps: number = form === "alert" ? 2 : 3;

  for (let index: number = 0; index < steps; index++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }

  await expect(ownersRow(page)).toBeVisible();
}

function ownersRow(page: Page): Locator {
  return page.getByTestId("owners-on-create-summary");
}

async function ruleRows(
  page: Page,
): Promise<Array<{ name: string; owners: string }>> {
  const rows: Locator = ownersRow(page).getByTestId("owner-rule-preview-rule");
  const result: Array<{ name: string; owners: string }> = [];

  for (let index: number = 0; index < (await rows.count()); index++) {
    const row: Locator = rows.nth(index);

    result.push({
      name: (
        await row.getByTestId("owner-rule-preview-rule-name").innerText()
      ).trim(),
      owners: (
        await row.getByTestId("owner-rule-preview-owners").innerText()
      ).replace(/\s+/g, " "),
    });
  }

  return result;
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    }),
  ).toBeLessThanOrEqual(0);
}

// ---- Settings > Owner Rules -------------------------------------------------

type RuleKind = "incident" | "alert";

function ruleModelName(kind: RuleKind): string {
  return kind === "alert" ? "Alert Owner Rule" : "Incident Owner Rule";
}

async function openRulesPage(page: Page, kind: RuleKind): Promise<void> {
  await page.goto(
    `${kind === "alert" ? ALERT_RULES_PATH : INCIDENT_RULES_PATH}?form=${kind}-rules`,
  );
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(
    page.getByRole("button", { name: `Create ${ruleModelName(kind)}` }).first(),
  ).toBeVisible();
}

function ruleForm(page: Page): Locator {
  return page.getByTestId("modal");
}

// The Create form, on its second step: what the rule adds.
async function openNewRuleOwners(page: Page, kind: RuleKind): Promise<Locator> {
  await page
    .getByRole("button", { name: `Create ${ruleModelName(kind)}` })
    .first()
    .click();

  const form: Locator = ruleForm(page);

  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Next", exact: true }).click();
  await expect(inheritOwnersFold(form)).toBeVisible();

  return form;
}

function inheritOwnersFold(form: Locator): Locator {
  return form.getByRole("button", { name: /^Inherit Owners/ }).first();
}

function creatorTeamField(form: Locator): Locator {
  return form.getByRole("group", { name: /^Creator's Team/ }).first();
}

// The teams Creator's Team lists, by id: each chip names its team.
async function creatorTeamIds(form: Locator): Promise<Array<string>> {
  return await creatorTeamField(form)
    .getByTestId("people-chip")
    .evaluateAll((chips: Array<Element>): Array<string> => {
      return chips.map((chip: Element): string => {
        return chip.getAttribute("data-id") || "";
      });
    });
}

async function addCreatorTeam(
  page: Page,
  form: Locator,
  team: string,
): Promise<void> {
  await creatorTeamField(form)
    .getByRole("button", { name: "Add team" })
    .click();

  const popup: Locator = page.getByTestId("people-search-popup");

  await expect(popup).toBeVisible();
  await popup.getByRole("option", { name: `${team} Team` }).click();
  await expect
    .poll(async () => {
      return (await creatorTeamIds(form)).length;
    })
    .toBeGreaterThan(0);

  // The picker stays open for more picks.
  if (await popup.isVisible()) {
    await page.keyboard.press("Escape");
  }

  await expect(popup).toBeHidden();
  await expect(form).toBeVisible();
}

// The ids a create sent for a list of related rows ({ _id } each).
function idsOf(value: unknown): Array<string> {
  return (Array.isArray(value) ? value : []).map((item: unknown): string => {
    return String((item as { _id?: unknown })?._id ?? item);
  });
}

test.describe("Declare Incident", () => {
  test("keeps Owners folded under More fields, named in its header", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);

    await expect(moreFields(page)).toHaveAttribute("aria-expanded", "false");
    await expect(moreFields(page)).toContainText("Owners");
    await expect(page.getByRole("button", { name: "Add owner" })).toBeHidden();
    await expect(suggestions(page)).toBeHidden();
  });

  test("opened, says the declarer owns it anyway, and offers their teams one click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);
    await titleBox(page).fill("Checkout is down");
    await openMoreFields(page);

    await expect(page.getByText(INCIDENT_LINE)).toBeVisible();
    await expect(suggestions(page)).toBeVisible();
    await expect(suggestions(page)).toContainText("Your teams:");
    expect(await suggestedTeams(page)).toEqual([
      "Database",
      "Members",
      "Platform",
    ]);
    // Nothing is picked by itself: Members is a team too.
    expect(await pickedNames(page)).toEqual([]);

    await screenshot(page, "incident-owners-folded-open-1280");

    await suggestions(page)
      .getByRole("button", { name: "Add Platform as an owner" })
      .click();

    await expect
      .poll(() => {
        return pickedNames(page);
      })
      .toEqual(["Platform"]);
    expect(await suggestedTeams(page)).toEqual(["Database", "Members"]);
    await expect(page.getByTestId("my-team-suggestions-status")).toHaveText(
      "Added Platform to the owners.",
    );

    await screenshot(page, "incident-owners-one-team-added-1280");
  });

  test("Add all makes every one of their teams an owner, and the line goes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);
    await titleBox(page).fill("Checkout is down");
    await openMoreFields(page);

    await page.getByTestId("my-team-suggestions-add-all").click();

    await expect
      .poll(() => {
        return pickedNames(page);
      })
      .toHaveLength(3);
    await expect(suggestions(page)).toBeHidden();
    await expect(page.getByTestId("my-team-suggestions-status")).toHaveText(
      "Added 3 teams to the owners.",
    );
  });

  test("offers nothing to someone in no team - the picker is still there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, { query: "teams=none" });
    await titleBox(page).fill("Checkout is down");
    await openMoreFields(page);

    await expect(page.getByRole("button", { name: "Add owner" })).toBeVisible();
    await expect(suggestions(page)).toBeHidden();
  });

  test("offers one team as one team", async ({ page }: { page: Page }) => {
    await openForm(page, { query: "teams=one" });
    await titleBox(page).fill("Checkout is down");
    await openMoreFields(page);

    await expect(suggestions(page)).toContainText("Your team:");
    expect(await suggestedTeams(page)).toEqual(["Platform"]);
    await expect(page.getByTestId("my-team-suggestions-add-all")).toBeHidden();
  });

  test("the review lists the owners picked and the owner rules that will add more, as the server works them out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);
    await fillDetails(page);
    await openMoreFields(page);

    // A label the "Database incidents" rule matches on.
    await page
      .getByRole("combobox", { name: /^Labels/ })
      .first()
      .click();
    await page
      .getByRole("option", { name: "database", exact: true })
      .first()
      .click();
    await page.keyboard.press("Escape");

    await suggestions(page)
      .getByRole("button", { name: "Add Platform as an owner" })
      .click();
    await expect
      .poll(() => {
        return pickedNames(page);
      })
      .toEqual(["Platform"]);

    await toSummary(page);

    await expect(
      ownersRow(page).getByTestId("owners-on-create-picked"),
    ).toHaveText(/Platform/);
    await expect(
      ownersRow(page).getByTestId("owner-rule-preview"),
    ).toContainText("Added by owner rules");

    await expect
      .poll(() => {
        return ruleRows(page);
      })
      .toEqual([
        {
          name: "Database incidents",
          owners: expect.stringMatching(/Grace Hopper.*Database/),
        },
        {
          name: "Add the creator's team as an owner",
          owners: expect.stringMatching(
            /Platform.*Database|Database.*Platform/,
          ),
        },
      ]);

    await screenshot(page, "incident-review-owners-1280");

    // What it asked: the incident as the form holds it, for this project.
    const record: FixtureRecord = await fixture(page);
    const asked: FixtureRecord["previews"][number] =
      record.previews[record.previews.length - 1]!;

    expect(asked.url).toMatch(/\/incident\/owner-rule-preview$/);
    expect(asked.headers).toEqual({ tenantid: PROJECT_ID });
    expect(asked.body["title"]).toBe("Checkout is down");
    expect(asked.body["severityId"]).toBeTruthy();
    expect(asked.body["labelIds"]).toEqual([record.ids.databaseLabel]);
  });

  test("declaring sends the owners picked - and none picked by itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);
    await fillDetails(page);
    await openMoreFields(page);
    await suggestions(page)
      .getByRole("button", { name: "Add Platform as an owner" })
      .click();
    await expect
      .poll(() => {
        return pickedNames(page);
      })
      .toEqual(["Platform"]);
    await toSummary(page);

    await page.getByRole("button", { name: "Declare Incident" }).click();

    await expect
      .poll(async () => {
        return (await eventSaves(page, "Incident")).length;
      })
      .toBe(1);

    const ids: FixtureIds = (await fixture(page)).ids;
    const declared: FixtureRecord["saves"][number] = (
      await eventSaves(page, "Incident")
    )[0]!;

    expect(declared.miscDataProps["ownerTeams"]).toEqual([ids.platform]);
    expect(
      (declared.miscDataProps["ownerUsers"] as Array<string>) || [],
    ).toEqual([]);
  });

  test("with no rule that adds anyone, says nobody else is picked, and nothing about rules", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, { query: "rules=none" });
    await fillDetails(page);
    await toSummary(page);

    await expect(
      ownersRow(page).getByTestId("owners-on-create-nobody-picked"),
    ).toHaveText("Nobody else picked.");
    await expect(page.getByTestId("owner-rule-preview-loading")).toBeHidden();
    await expect(page.getByTestId("owner-rule-preview")).toBeHidden();
    await expect(page.getByTestId("owner-rule-preview-error")).toBeHidden();
  });

  test("says it is checking while the server works the rules out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, { query: "rules=slow" });
    await fillDetails(page);
    await toSummary(page);

    await expect(page.getByTestId("owner-rule-preview-loading")).toHaveText(
      "Checking which owner rules will run...",
    );
  });

  test("says so when the rules cannot be checked - and still declares the incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, { query: "rules=error" });
    await fillDetails(page);
    await toSummary(page);

    await expect(page.getByTestId("owner-rule-preview-error")).toHaveText(
      "Could not check which owner rules will run. They still run when it is created.",
    );

    await page.getByRole("button", { name: "Declare Incident" }).click();
    await expect
      .poll(async () => {
        return (await eventSaves(page, "Incident")).length;
      })
      .toBe(1);
  });

  test("tells someone who may not see the owner rules nothing about them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, { query: "rules=denied" });
    await fillDetails(page);
    await toSummary(page);

    await expect(page.getByTestId("owner-rule-preview-loading")).toBeHidden();
    await expect(page.getByTestId("owner-rule-preview-error")).toBeHidden();
    await expect(page.getByTestId("owner-rule-preview")).toBeHidden();
    await expect(
      ownersRow(page).getByTestId("owners-on-create-nobody-picked"),
    ).toBeVisible();
  });
});

test.describe("Create Alert", () => {
  test("keeps Owners under More fields, offers the creator's teams, and says which rules will add whom", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, { form: "alert" });

    await expect(moreFields(page)).toContainText("Owners");

    await fillDetails(page, "alert");
    await openMoreFields(page);

    await expect(page.getByText(ALERT_LINE)).toBeVisible();
    expect(await suggestedTeams(page)).toEqual([
      "Database",
      "Members",
      "Platform",
    ]);

    await toSummary(page, "alert");

    await expect
      .poll(() => {
        return ruleRows(page);
      })
      .toEqual([
        {
          name: "Checkout alerts",
          owners: expect.stringMatching(/Linus Torvalds.*SRE On-call/),
        },
      ]);

    await screenshot(page, "alert-review-owners-1280");

    const record: FixtureRecord = await fixture(page);

    expect(record.previews[record.previews.length - 1]!.url).toMatch(
      /\/alert\/owner-rule-preview$/,
    );
  });
});

test.describe("Owner rules", () => {
  test("a rule that adds only the creator's team is not listed as adding nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRulesPage(page, "incident");

    await expect(
      page.getByRole("row", { name: /Old checkout rule/ }),
    ).toContainText("Adds nothing");
    await expect(
      page.getByRole("row", { name: new RegExp(CREATOR_TEAM_RULE_NAME) }),
    ).not.toContainText("Adds nothing");
  });

  test("a new incident rule keeps Creator's Team last in Inherit Owners, whose folded line names it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRulesPage(page, "incident");

    const form: Locator = await openNewRuleOwners(page, "incident");
    const fold: Locator = inheritOwnersFold(form);

    // Folded, and still read as the place for the creator's team.
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(fold).toContainText(RULE_FOLD_LINES.incident);
    await expect(creatorTeamField(form)).toBeHidden();

    await openFold(page, fold);

    const field: Locator = creatorTeamField(form);

    await expect(field).toBeVisible();
    await expect(form.getByText(CREATOR_TEAM_LINES.incident)).toBeVisible();
    // Nothing listed by itself.
    expect(await creatorTeamIds(form)).toEqual([]);

    /*
     * Last in the fold: after the six switches, before the rule's Name -
     * once the fold has finished opening, and moved the Name down.
     */
    const lastSwitch: Locator = form.getByRole("switch", {
      name: "Inherit Owners From Services",
    });
    const name: Locator = form.getByRole("textbox", { name: "Name" });

    await expect
      .poll(async (): Promise<Array<string>> => {
        const tops: Array<{ part: string; y: number }> = [];

        for (const [part, locator] of [
          ["Inherit Owners From Services", lastSwitch],
          ["Creator's Team", field],
          ["Name", name],
        ] as Array<[string, Locator]>) {
          tops.push({ part, y: (await locator.boundingBox())?.y ?? -1 });
        }

        return tops
          .sort((left: { y: number }, right: { y: number }): number => {
            return left.y - right.y;
          })
          .map((top: { part: string }): string => {
            return top.part;
          });
      })
      .toEqual(["Inherit Owners From Services", "Creator's Team", "Name"]);
  });

  test("one team listed is enough: the rule is named after it and saved with it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRulesPage(page, "incident");

    const form: Locator = await openNewRuleOwners(page, "incident");

    await openFold(page, inheritOwnersFold(form));
    await addCreatorTeam(page, form, "Platform");

    const ids: FixtureIds = (await fixture(page)).ids;

    expect(await creatorTeamIds(form)).toEqual([ids.platform]);
    // Named after what it adds, until a name of one's own is typed.
    await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue(
      CREATOR_TEAM_RULE_NAME,
    );

    await screenshot(page, "incident-owner-rule-creator-team-1280");

    await form
      .getByRole("button", { name: "Create Incident Owner Rule" })
      .click();
    await expect(form).toBeHidden();

    const saves: FixtureRecord["saves"] = await eventSaves(
      page,
      "IncidentOwnerRule",
    );

    expect(saves).toHaveLength(1);

    const rule: Record<string, unknown> = saves[0]!.data;

    expect(rule["name"]).toBe(CREATOR_TEAM_RULE_NAME);
    expect(idsOf(rule["creatorTeams"])).toEqual([ids.platform]);
    // Nobody named, nothing inherited: the creator's team is all it adds.
    expect(idsOf(rule["ownerUsers"])).toEqual([]);
    expect(idsOf(rule["ownerTeams"])).toEqual([]);

    for (const column of INHERIT_OWNER_SWITCHES) {
      expect({ column, on: rule[column] }).toEqual({ column, on: false });
    }
  });

  test("editing a rule that lists teams opens Inherit Owners on them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRulesPage(page, "incident");

    await page
      .getByRole("row", { name: new RegExp(CREATOR_TEAM_RULE_NAME) })
      .getByRole("button", { name: /^More actions for Incident Owner Rule/ })
      .click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    const form: Locator = ruleForm(page);

    await form.getByRole("button", { name: "Next", exact: true }).click();
    await expect(inheritOwnersFold(form)).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const ids: FixtureIds = (await fixture(page)).ids;

    await expect
      .poll(() => {
        return creatorTeamIds(form);
      })
      .toEqual([ids.platform, ids.database, ids.frontend]);
  });

  test("an alert rule's creator is whoever creates the alert", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRulesPage(page, "alert");

    const form: Locator = await openNewRuleOwners(page, "alert");
    const fold: Locator = inheritOwnersFold(form);

    await expect(fold).toContainText(RULE_FOLD_LINES.alert);
    await openFold(page, fold);
    await expect(form.getByText(CREATOR_TEAM_LINES.alert)).toBeVisible();

    await addCreatorTeam(page, form, "SRE On-call");

    await screenshot(page, "alert-owner-rule-creator-team-1280");

    await form.getByRole("button", { name: "Create Alert Owner Rule" }).click();
    await expect(form).toBeHidden();

    const saves: FixtureRecord["saves"] = await eventSaves(
      page,
      "AlertOwnerRule",
    );
    const ids: FixtureIds = (await fixture(page)).ids;

    expect(saves).toHaveLength(1);
    expect(idsOf(saves[0]!.data["creatorTeams"])).toEqual([ids.sre]);
    expect(saves[0]!.data["name"]).toBe(CREATOR_TEAM_RULE_NAME);
  });
});

test.describe("at a phone's width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("an owner rule's Creator's Team fits the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRulesPage(page, "incident");

    const form: Locator = await openNewRuleOwners(page, "incident");

    await openFold(page, inheritOwnersFold(form));
    await addCreatorTeam(page, form, "Platform");

    const field: Locator = creatorTeamField(form);

    await field.scrollIntoViewIfNeeded();
    await expectNoSidewaysScroll(page);

    for (const part of [
      field.getByRole("button", { name: "Add team" }),
      field.getByTestId("people-chip").first(),
      form.getByText(CREATOR_TEAM_LINES.incident),
    ]) {
      const box: { x: number; width: number } | null = await part.boundingBox();

      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }

    await screenshot(page, "incident-owner-rule-creator-team-390");
  });

  test("the Owners field and its teams fit the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);
    await titleBox(page).fill("Checkout is down");
    await openMoreFields(page);

    await expect(suggestions(page)).toBeVisible();
    await expectNoSidewaysScroll(page);

    // Every suggestion is on the screen, wrapped rather than cut.
    const buttons: Locator =
      suggestions(page).getByTestId("my-team-suggestion");

    for (let index: number = 0; index < (await buttons.count()); index++) {
      const box: { x: number; width: number } | null = await buttons
        .nth(index)
        .boundingBox();

      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }

    await screenshot(page, "incident-owners-folded-open-390");
  });

  test("the review's rules put each name above whom it adds", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);
    await fillDetails(page);
    await openMoreFields(page);
    await page.getByTestId("my-team-suggestions-add-all").click();
    await expect
      .poll(() => {
        return pickedNames(page);
      })
      .toHaveLength(3);
    await toSummary(page);

    const row: Locator = ownersRow(page)
      .getByTestId("owner-rule-preview-rule")
      .first();

    await expect(row).toBeVisible();

    const name: { y: number; height: number } | null = await row
      .getByTestId("owner-rule-preview-rule-name")
      .boundingBox();
    const owners: { y: number } | null = await row
      .getByTestId("owner-rule-preview-owners")
      .boundingBox();

    expect(name!.y + name!.height).toBeLessThanOrEqual(owners!.y + 1);
    await expectNoSidewaysScroll(page);

    await screenshot(page, "incident-review-owners-390");
  });
});

test.describe("in dark mode and in German", () => {
  test("reads in dark mode", async ({ page }: { page: Page }) => {
    await openForm(page, { query: "theme=dark" });
    await fillDetails(page);
    await openMoreFields(page);
    await suggestions(page)
      .getByRole("button", { name: "Add Platform as an owner" })
      .click();
    await expect
      .poll(() => {
        return pickedNames(page);
      })
      .toEqual(["Platform"]);

    await screenshot(page, "incident-owners-dark-1280");

    await toSummary(page);
    await expect(
      ownersRow(page).getByTestId("owner-rule-preview"),
    ).toBeVisible();

    await screenshot(page, "incident-review-owners-dark-1280");
  });

  test("speaks German", async ({ page }: { page: Page }) => {
    await openForm(page, { query: "lang=de" });
    await titleBox(page).fill("Checkout ist ausgefallen");
    await openMoreFields(page, GERMAN["More fields"]!);

    await expect(page.getByText(GERMAN[INCIDENT_LINE]!)).toBeVisible();
    await expect(suggestions(page)).toContainText(GERMAN["Your teams:"]!);
    await expect(
      suggestions(page).getByRole("button", {
        name: GERMAN["Add {{teamName}} as an owner"]!.replace(
          "{{teamName}}",
          "Platform",
        ),
      }),
    ).toBeVisible();
    await expect(page.getByTestId("my-team-suggestions-add-all")).toHaveText(
      GERMAN["Add all"]!,
    );

    await screenshot(page, "incident-owners-german-1280");
  });
});
