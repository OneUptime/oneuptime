import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Browser, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  JSONish,
  SessionUser,
  createItem,
  getItem,
  getSessionUser,
  listItems,
  pollUntil,
  toId,
} from "./Helpers/MonitorAlerting";

/*
 * An incident template's Custom Fields on Create, end to end against a real
 * stack: the wizard step that sets them, the card that edits them, and the
 * Declare Incident page they shape - and the template owners that page used
 * to drop.
 *
 * These were written with incident forms (#4114) and lived in their spec.
 * Incident forms became the Forms product (Forms.spec.ts); the template
 * settings stayed with incident templates, and so did these tests.
 *
 * Anti-flake notes:
 * - one fresh user and project per run, and run-unique names, so a re-run
 *   never meets another run's templates or incidents
 * - no fixed sleeps: every wait is a Playwright expectation or a poll
 * - chromium only: this is server behaviour and one set of pages, not
 *   rendering quirks
 *
 *   cd packages/E2E && npx playwright test \
 *     Tests/Dashboard/IncidentTemplateCustomFieldsOnCreate.spec.ts --project=chromium
 */

// Incident custom fields are a Growth feature.
const PREFERRED_PLAN_NAME: string = "Growth";

// The incident custom fields the project gets, and what each one is for.
interface FieldSpec {
  name: string;
  customFieldType: string;
  dropdownOptions?: string | undefined;
  /*
   * The project's own "Sort Order", "Show on Create" and "Required on
   * Create". Every field here has a sort order, so every page asks them in
   * the same, deterministic order.
   */
  sortOrder: number;
  showOnCreate: boolean;
  isRequiredOnCreate: boolean;
}

const FIELDS: {
  impact: FieldSpec;
  region: FieldSpec;
  customerFacing: FieldSpec;
  affectedUsers: FieldSpec;
  targetDate: FieldSpec;
  internalReference: FieldSpec;
} = {
  // Required by the template.
  impact: {
    name: "Impact",
    customFieldType: "Text",
    sortOrder: 1,
    showOnCreate: false,
    isRequiredOnCreate: false,
  },
  // Left on Default by the template; the project shows it on create.
  region: {
    name: "Region",
    customFieldType: "Dropdown",
    dropdownOptions: "EU\nUS\nAPAC",
    sortOrder: 2,
    showOnCreate: true,
    isRequiredOnCreate: false,
  },
  // Optional on the template.
  customerFacing: {
    name: "Customer Facing",
    customFieldType: "Boolean",
    sortOrder: 3,
    showOnCreate: false,
    isRequiredOnCreate: false,
  },
  // On Default until C makes it Optional.
  affectedUsers: {
    name: "Affected Users",
    customFieldType: "Number",
    sortOrder: 4,
    showOnCreate: false,
    isRequiredOnCreate: false,
  },
  // On Default; B's wizard template requires it.
  targetDate: {
    name: "Target Date",
    customFieldType: "Date",
    sortOrder: 5,
    showOnCreate: false,
    isRequiredOnCreate: false,
  },
  /*
   * Hidden by the template although the project marks it Show on Create and
   * Required on Create: on the template's incidents its value comes from the
   * template.
   */
  internalReference: {
    name: "Internal Reference",
    customFieldType: "Text",
    sortOrder: 6,
    showOnCreate: true,
    isRequiredOnCreate: true,
  },
};

// What the template declares with.
const TEMPLATE_TITLE: string = "Customer reported problem";
const TEMPLATE_DESCRIPTION: string =
  "A customer reported a problem through the form.";
const TEMPLATE_REGION: string = "EU";
const TEMPLATE_INTERNAL_REFERENCE: string = "REF-4114";

interface Ctx {
  page: Page;
  projectId: string;
  user: SessionUser;
  unique: string;
  severityId: string;
  labelId: string;
  labelName: string;
  teamId: string;
  teamName: string;
  variableKeys: Record<string, string>;
  templateId: string;
  templateName: string;
  templateSettings: Record<string, string>;
}

const ctx: Ctx = {
  page: null as unknown as Page,
  projectId: "",
  user: { userId: "", email: "" },
  unique: "",
  severityId: "",
  labelId: "",
  labelName: "",
  teamId: "",
  teamName: "",
  variableKeys: {},
  templateId: "",
  templateName: "",
  templateSettings: {},
};

type KeyOfFunction = (field: FieldSpec) => string;

// A field's template key, as the server made it from the field's name (A).
const keyOf: KeyOfFunction = (field: FieldSpec): string => {
  return ctx.variableKeys[field.name] || "";
};

type DashboardUrlFunction = (projectId: string, path: string) => string;

const dashboardUrl: DashboardUrlFunction = (
  projectId: string,
  path: string,
): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${projectId}${path}`)
    .toString();
};

type FieldLabelsFunction = (scope: Locator) => Promise<Array<string>>;

/*
 * The visible field labels inside a form, in order, whitespace collapsed:
 * "Region (Optional)" for an optional field, the bare name for a required one
 * - that suffix is the form's required marker.
 */
const fieldLabels: FieldLabelsFunction = async (
  scope: Locator,
): Promise<Array<string>> => {
  const texts: Array<string> = await scope
    .locator("label:visible")
    .allInnerTexts();

  return texts
    .map((text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });
};

type CardFunction = (page: Page, title: string) => Locator;

// A card on a dashboard page, by its heading.
const card: CardFunction = (page: Page, title: string): Locator => {
  return page.getByTestId("card").filter({
    has: page.getByTestId("card-details-heading").getByText(title, {
      exact: true,
    }),
  });
};

type SettingLabelFunction = (page: Page, field: FieldSpec) => Locator;

/*
 * What a template's Custom Fields on Create card says about one field:
 * "Required", "Hidden", "Default (Optional)"...
 */
const settingLabel: SettingLabelFunction = (
  page: Page,
  field: FieldSpec,
): Locator => {
  return page
    .getByTestId("incident-custom-field-settings-list")
    .getByTestId(`incident-custom-field-setting-${keyOf(field)}`)
    .getByTestId("incident-custom-field-setting-value");
};

type ChooseOptionFunction = (data: {
  page: Page;
  scope: Locator;
  field: RegExp;
  option: string;
}) => Promise<void>;

// Opens a dropdown by its label and picks one of its options by its text.
const chooseOption: ChooseOptionFunction = async (data: {
  page: Page;
  scope: Locator;
  field: RegExp;
  option: string;
}): Promise<void> => {
  await data.scope.getByRole("combobox", { name: data.field }).click();
  await data.page
    .getByRole("option", { name: data.option, exact: true })
    .click();
};

type SaveModalFunction = (page: Page) => Promise<void>;

// Presses the open modal's primary button and waits until it has closed.
const saveModal: SaveModalFunction = async (page: Page): Promise<void> => {
  await page
    .getByTestId("modal")
    .getByTestId("modal-footer-submit-button")
    .click();
  await expect(page.getByTestId("modal")).toHaveCount(0, { timeout: 60000 });
};

type IsOnStepFunction = (form: Locator, title?: string) => Promise<boolean>;

/*
 * Whether a multi-step form shows the step with this title - or, with no
 * title, its last step - read from the form's own progress list, where the
 * step being filled in is marked aria-current, rather than inferred from
 * which footer button is drawn.
 */
const isOnStep: IsOnStepFunction = async (
  form: Locator,
  title?: string,
): Promise<boolean> => {
  const steps: Locator = form
    .getByRole("navigation", { name: "Progress" })
    .getByRole("listitem");
  const step: Locator = title
    ? steps.filter({ has: form.page().getByText(title, { exact: true }) })
    : steps.last();

  return (await step.locator('[aria-current="step"]').count()) > 0;
};

type StepThroughFunction = (data: {
  form: Locator;
  next: Locator;
  // The step to stop at, by its title; the last step when left out.
  stepTitle?: string | undefined;
}) => Promise<void>;

/*
 * A multi-step form's plain Next: every step but the last shows it, in place
 * of the form's action, which is on the last step only.
 */
type NextButtonFunction = (form: Locator) => Locator;

const nextButtonOf: NextButtonFunction = (form: Locator): Locator => {
  return form.getByRole("button", { name: "Next", exact: true });
};

/*
 * Presses a multi-step form's Next until the step the caller is after
 * shows, waiting after each press for the step to change. Bounded: no form
 * here has ten steps. It never presses the button on the step it stops at,
 * so it never submits; the caller asserts where it ended up.
 */
const stepThrough: StepThroughFunction = async (data: {
  form: Locator;
  next: Locator;
  stepTitle?: string | undefined;
}): Promise<void> => {
  // Without its progress list there is no telling the last step: stop here.
  await expect(
    data.form.getByRole("navigation", { name: "Progress" }),
  ).toBeVisible();

  for (let step: number = 0; step < 10; step++) {
    if (await isOnStep(data.form, data.stepTitle)) {
      return;
    }

    const before: string = await data.form.innerText();
    await data.next.click();
    await expect
      .poll(
        async () => {
          return await data.form.innerText();
        },
        { timeout: 30000 },
      )
      .not.toBe(before);
  }
};

type FindIncidentByTitleFunction = (title: string) => Promise<JSONish>;

// The one incident with this (run-unique) title.
const findIncidentByTitle: FindIncidentByTitleFunction = async (
  title: string,
): Promise<JSONish> => {
  const incidents: Array<JSONish> = await listItems({
    page: ctx.page,
    projectId: ctx.projectId,
    path: "/api/incident",
    query: { title },
    select: { _id: true },
  });
  expect(incidents, `exactly one incident titled "${title}"`).toHaveLength(1);

  return getItem({
    page: ctx.page,
    projectId: ctx.projectId,
    path: "/api/incident",
    id: toId(incidents[0]!["_id"]),
    select: {
      _id: true,
      title: true,
      description: true,
      incidentSeverityId: true,
      customFields: true,
      isVisibleOnStatusPage: true,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      isPrivate: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      createdByUserId: true,
      labels: { _id: true, name: true },
    },
  });
};

interface IncidentOwners {
  userIds: Array<string>;
  teamIds: Array<string>;
}

type WaitForOwnersFunction = (data: {
  incidentId: string;
  description: string;
}) => Promise<IncidentOwners>;

/*
 * The incident's owner users and teams, once both are there. Owners are
 * added after the incident is created, so this polls.
 */
const waitForOwners: WaitForOwnersFunction = async (data: {
  incidentId: string;
  description: string;
}): Promise<IncidentOwners> => {
  return pollUntil<IncidentOwners>({
    page: ctx.page,
    description: data.description,
    timeoutMs: 60000,
    check: async (): Promise<IncidentOwners | null> => {
      const users: Array<JSONish> = await listItems({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/incident-owner-user",
        query: { incidentId: data.incidentId },
        select: { _id: true, userId: true },
      });
      const teams: Array<JSONish> = await listItems({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/incident-owner-team",
        query: { incidentId: data.incidentId },
        select: { _id: true, teamId: true },
      });

      if (users.length === 0 || teams.length === 0) {
        return null;
      }

      return {
        userIds: users.map((row: JSONish): string => {
          return toId(row["userId"]);
        }),
        teamIds: teams.map((row: JSONish): string => {
          return toId(row["teamId"]);
        }),
      };
    },
  });
};

test.describe("Incident template Custom Fields on Create", () => {
  /*
   * One story, told in order: each test builds on what the one before it
   * left. Retried once at most.
   */
  test.describe.configure({ mode: "serial", retries: 1 });

  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "server behaviour and one set of pages, one engine is enough");

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(360000);

    ctx.page = await browser.newPage();

    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "Template Custom Fields E2E",
      preferredPlanName: IS_BILLING_ENABLED ? PREFERRED_PLAN_NAME : undefined,
    });
    ctx.user = await getSessionUser({ page: ctx.page });

    ctx.unique = `${Date.now().toString(36)}${Math.floor(
      Math.random() * 1e6,
    ).toString(36)}`;
    ctx.templateName = `Customer Report Template ${ctx.unique}`;
    ctx.labelName = `Reported by customers ${ctx.unique}`;
    ctx.teamName = "Admin";
  });

  test.afterAll(async () => {
    await ctx.page?.close();
  });

  test("A. an admin sets up custom fields, a label and a template", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    // Severities are seeded after the project is created.
    const severities: Array<JSONish> = await pollUntil<Array<JSONish>>({
      page,
      description: "the project's incident severities to be seeded",
      timeoutMs: 120000,
      check: async (): Promise<Array<JSONish> | null> => {
        const rows: Array<JSONish> = await listItems({
          page,
          projectId: ctx.projectId,
          path: "/api/incident-severity",
          select: { _id: true, name: true, order: true },
        });

        return rows.length >= 1 ? rows : null;
      },
    });

    ctx.severityId = toId(severities[0]!["_id"]);

    for (const field of Object.values(FIELDS)) {
      await createItem({
        page,
        projectId: ctx.projectId,
        path: "/api/incident-custom-field",
        item: {
          projectId: ctx.projectId,
          name: field.name,
          description: `${field.name} of the reported problem`,
          customFieldType: field.customFieldType,
          dropdownOptions: field.dropdownOptions,
          sortOrder: field.sortOrder,
          showOnCreate: field.showOnCreate,
          isRequiredOnCreate: field.isRequiredOnCreate,
        },
      });
    }

    /*
     * The settings are keyed by each field's template key, which the server
     * makes from the name - read them back rather than guess the spelling.
     */
    const fieldRows: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-custom-field",
      select: { _id: true, name: true, variableKey: true },
    });

    for (const field of Object.values(FIELDS)) {
      const row: JSONish | undefined = fieldRows.find((candidate: JSONish) => {
        return candidate["name"] === field.name;
      });
      const variableKey: string = String(row?.["variableKey"] || "");

      expect(
        variableKey,
        `the server should give "${field.name}" a template key`,
      ).not.toBe("");
      ctx.variableKeys[field.name] = variableKey;
    }

    const label: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/label",
      item: {
        projectId: ctx.projectId,
        name: ctx.labelName,
        color: { _type: "Color", value: "#6366f1" },
      },
    });
    ctx.labelId = toId(label["_id"]);
    expect(ctx.labelId, "the label should have been created").not.toBe("");

    /*
     * A team to own the template's incidents next to the admin. The admin
     * alone would prove little on the dashboard's Declare Incident page (C):
     * whoever declares an incident there becomes one of its owners anyway.
     * The team gets there only as the template's owner.
     *
     * Every project starts with an Admin team, which the admin who created
     * the project is not in. It is used instead of a new team because
     * creating a team needs the Scale plan on a billing install, and this
     * project is on Growth.
     */
    const teams: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/team",
      select: { _id: true, name: true },
    });
    const adminTeams: Array<JSONish> = teams.filter((team: JSONish) => {
      return team["name"] === ctx.teamName;
    });

    expect(
      adminTeams,
      `every project should start with one "${ctx.teamName}" team`,
    ).toHaveLength(1);
    ctx.teamId = toId(adminTeams[0]!["_id"]);
    expect(ctx.teamId, "the Admin team should have an id").not.toBe("");

    /*
     * The template's Custom Fields on Create (TEMPLATE semantics): Impact
     * Required and Customer Facing Optional although the project does not
     * show either on create; Internal Reference Hidden although the project
     * requires it; Region, Affected Users and Target Date left on Default.
     */
    ctx.templateSettings = {
      [keyOf(FIELDS.impact)]: "Required",
      [keyOf(FIELDS.customerFacing)]: "Optional",
      [keyOf(FIELDS.internalReference)]: "Hidden",
    };

    const template: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-templates",
      item: {
        projectId: ctx.projectId,
        templateName: ctx.templateName,
        templateDescription: "Declared for problems customers report.",
        title: TEMPLATE_TITLE,
        description: TEMPLATE_DESCRIPTION,
        incidentSeverityId: ctx.severityId,
        isScopedToStatusPages: false,
        labels: [{ _id: ctx.labelId }],
        customFields: {
          [FIELDS.region.name]: TEMPLATE_REGION,
          [FIELDS.internalReference.name]: TEMPLATE_INTERNAL_REFERENCE,
        },
        customFieldSettings: ctx.templateSettings,
      },
    });
    ctx.templateId = toId(template["_id"]);
    expect(ctx.templateId, "the template should have been created").not.toBe(
      "",
    );

    // The template's owners own what it declares: the admin and the team.
    await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-template-owner-user",
      item: {
        projectId: ctx.projectId,
        incidentTemplateId: ctx.templateId,
        userId: ctx.user.userId,
      },
    });
    await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-template-owner-team",
      item: {
        projectId: ctx.projectId,
        incidentTemplateId: ctx.templateId,
        teamId: ctx.teamId,
      },
    });

    const storedTemplate: JSONish = await getItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-templates",
      id: ctx.templateId,
      select: {
        _id: true,
        customFieldSettings: true,
        labels: { _id: true },
      },
    });

    // Stored exactly as sent: nothing rewritten, nothing dropped.
    expect(storedTemplate["customFieldSettings"]).toEqual(ctx.templateSettings);
    expect(
      ((storedTemplate["labels"] as Array<JSONish>) || []).map(
        (row: JSONish) => {
          return toId(row["_id"]);
        },
      ),
    ).toEqual([ctx.labelId]);
  });

  test("B. a new template's Custom Fields on Create step stores what it is set to", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;
    const wizardTemplateName: string = `Wizard Template ${ctx.unique}`;

    // Incidents > Settings > Incident Templates > Create Incident Template.
    const createButton: Locator = page.getByRole("button", {
      name: "Create Incident Template",
      exact: true,
    });
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(ctx.projectId, "/incidents/settings/templates"),
      ready: createButton,
    });
    await createButton.click();
    const wizard: Locator = page.getByTestId("modal");
    const next: Locator = nextButtonOf(wizard);
    const submit: Locator = wizard.getByTestId("modal-footer-submit-button");

    // Only the template's name, description and incident title are required.
    await wizard
      .getByRole("textbox", { name: /^Template Name/ })
      .fill(wizardTemplateName);
    await wizard
      .getByRole("textbox", { name: /^Template Description/ })
      .fill("Made in the wizard.");
    await next.click();
    await wizard
      .getByRole("textbox", { name: /^Title/ })
      .fill("Declared from the wizard's template");

    // On to its own step, after the field values: one dropdown per field.
    await stepThrough({
      form: wizard,
      next,
      stepTitle: "Custom Fields on Create",
    });
    expect(await isOnStep(wizard, "Custom Fields on Create")).toBe(true);
    await expect(
      wizard.getByRole("combobox", {
        name: new RegExp(`^${FIELDS.targetDate.name}`),
      }),
    ).toBeVisible();

    // Require Target Date, and hide Region; the rest stay on Default.
    await chooseOption({
      page,
      scope: wizard,
      field: new RegExp(`^${FIELDS.targetDate.name}`),
      option: "Required",
    });
    await chooseOption({
      page,
      scope: wizard,
      field: new RegExp(`^${FIELDS.region.name}`),
      option: "Hidden",
    });

    /*
     * The step after it (On-Call) is optional - the owners and the labels
     * fold under Advanced on Incident Details - but Create Incident Template
     * is on the last step only: Next here.
     */
    await expect(submit).toHaveCount(0);
    await expect(next).toBeVisible();
    await stepThrough({ form: wizard, next });
    expect(await isOnStep(wizard)).toBe(true);
    await expect(submit).toHaveText("Create Incident Template");
    await saveModal(page);

    /*
     * Stored under each field's template key, Default left out - and none of
     * the step's own form keys leaked into the template.
     */
    const templates: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-templates",
      query: { templateName: wizardTemplateName },
      select: { _id: true, customFieldSettings: true, customFields: true },
    });
    expect(templates).toHaveLength(1);
    expect(templates[0]!["customFieldSettings"]).toEqual({
      [keyOf(FIELDS.targetDate)]: "Required",
      [keyOf(FIELDS.region)]: "Hidden",
    });
    expect(JSON.stringify(templates[0]!["customFields"] || {})).not.toContain(
      "customFieldSettings",
    );

    // And the template's own page says so.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(
        ctx.projectId,
        `/incidents/settings/templates/${toId(templates[0]!["_id"])}`,
      ),
      ready: page.getByTestId("incident-custom-field-settings-list"),
    });
    await expect(settingLabel(page, FIELDS.targetDate)).toHaveText("Required", {
      timeout: 60000,
    });
    await expect(settingLabel(page, FIELDS.region)).toHaveText("Hidden");
    await expect(settingLabel(page, FIELDS.impact)).toHaveText(
      "Default (Not Shown)",
    );
  });

  test("C. a template's Custom Fields on Create shape Declare Incident, and its owners stay", async () => {
    test.setTimeout(300000);
    const page: Page = ctx.page;

    /*
     * The template's page lists every field with what the template does with
     * it - a field on Default says what the project's own switches make it.
     */
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(
        ctx.projectId,
        `/incidents/settings/templates/${ctx.templateId}`,
      ),
      ready: page.getByTestId("incident-custom-field-settings-list"),
    });
    const expectedSettings: Array<[FieldSpec, string]> = [
      [FIELDS.impact, "Required"],
      [FIELDS.region, "Default (Optional)"],
      [FIELDS.customerFacing, "Optional"],
      [FIELDS.affectedUsers, "Default (Not Shown)"],
      [FIELDS.targetDate, "Default (Not Shown)"],
      [FIELDS.internalReference, "Hidden"],
    ];
    for (const [field, setting] of expectedSettings) {
      await expect(settingLabel(page, field)).toHaveText(setting, {
        timeout: 60000,
      });
    }

    // Ask for Affected Users too, from the card's own editor.
    await card(page, "Custom Fields on Create")
      .getByRole("button", {
        name: "Edit Custom Fields on Create",
        exact: true,
      })
      .click();
    await chooseOption({
      page,
      scope: page.getByTestId("modal"),
      field: new RegExp(`^${FIELDS.affectedUsers.name}`),
      option: "Optional",
    });
    await saveModal(page);
    await expect(settingLabel(page, FIELDS.affectedUsers)).toHaveText(
      "Optional",
    );

    // Stored with the other settings, which the save left as they were.
    ctx.templateSettings = {
      ...ctx.templateSettings,
      [keyOf(FIELDS.affectedUsers)]: "Optional",
    };
    const storedTemplate: JSONish = await getItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-templates",
      id: ctx.templateId,
      select: { _id: true, customFieldSettings: true },
    });
    expect(storedTemplate["customFieldSettings"]).toEqual(ctx.templateSettings);

    /*
     * Incidents > Create from Template > this template. Declare Incident is
     * the card's one button; Create from Template sits in its ⋯ menu.
     */
    const moreActions: Locator = card(page, "Incidents").getByRole("button", {
      name: "More options",
    });
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(ctx.projectId, "/incidents"),
      ready: moreActions,
    });
    await moreActions.click();
    await expect(moreActions).toHaveAttribute("aria-expanded", "true");
    const menuId: string =
      (await moreActions.getAttribute("aria-controls")) || "";
    expect(menuId, "the ⋯ button should name the menu it opened").not.toBe("");
    await page
      .locator(`[id="${menuId}"]`)
      .getByRole("menuitem", { name: "Create from Template" })
      .click();
    const picker: Locator = page.getByTestId("modal");
    await chooseOption({
      page,
      scope: picker,
      field: /^Select Incident Template/,
      option: ctx.templateName,
    });
    await picker.getByTestId("modal-footer-submit-button").click();

    await expect(page).toHaveURL(
      new RegExp(`/incidents/create\\?incidentTemplateId=${ctx.templateId}`),
      { timeout: 60000 },
    );

    const createForm: Locator = page.locator("#create-incident-form");
    const next: Locator = nextButtonOf(createForm);
    const declare: Locator = page.locator(
      "#create-incident-form-submit-button",
    );

    // Incident Details, prefilled from the template.
    const title: Locator = createForm.getByRole("textbox", { name: /^Title/ });
    await expect(title).toHaveValue(TEMPLATE_TITLE, { timeout: 60000 });
    const declaredTitle: string = `Declared from the template ${ctx.unique}`;
    await title.fill(declaredTitle);

    // Incident Details -> Resources Affected -> Details.
    await next.click();
    await expect(
      createForm.getByText("Resources Affected", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    await next.click();

    /*
     * Details asks exactly what the template's settings say: Impact
     * (Required, although the project does not show it on create), Region (the
     * template leaves it on Default, and the project shows it), Customer Facing
     * and Affected Users (Optional). Internal Reference is Hidden by the
     * template although the project requires it, and Target Date stays on the
     * project's own "not on create".
     */
    await expect
      .poll(
        async () => {
          return await fieldLabels(createForm);
        },
        { timeout: 30000 },
      )
      .toEqual([
        FIELDS.impact.name,
        `${FIELDS.region.name} (Optional)`,
        FIELDS.customerFacing.name,
        `${FIELDS.affectedUsers.name} (Optional)`,
      ]);
    for (const absent of [FIELDS.internalReference, FIELDS.targetDate]) {
      await expect(createForm.getByText(absent.name)).toHaveCount(0);
    }
    // Region starts from the template's value.
    await expect(createForm).toContainText(TEMPLATE_REGION);

    /*
     * Required is enforced: the step does not move on without Impact. Every
     * step after this one is optional, but Declare Incident is on the last
     * step only - not here.
     */
    await expect(declare).toHaveCount(0);
    await next.click();
    const impact: Locator = createForm.getByLabel(FIELDS.impact.name, {
      exact: true,
    });
    await expect(
      createForm.getByText(`${FIELDS.impact.name} is required.`),
    ).toBeVisible();
    await expect(impact).toBeVisible();

    const declaredImpact: string = "Declared by the on-call team";
    await impact.fill(declaredImpact);
    await impact.press("Tab");
    await expect(
      createForm.getByText(`${FIELDS.impact.name} is required.`),
    ).toHaveCount(0);

    // On through the remaining steps to the last, where the button declares.
    await stepThrough({ form: createForm, next });
    expect(await isOnStep(createForm)).toBe(true);
    await expect(declare).toHaveText("Declare Incident");
    await declare.click();

    await expect(page).toHaveURL(
      new RegExp(
        `/dashboard/${ctx.projectId}/incidents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`,
        "i",
      ),
      { timeout: 120000 },
    );

    const declared: JSONish = await findIncidentByTitle(declaredTitle);
    const declaredIncidentId: string = toId(declared["_id"]);
    expect(page.url()).toContain(declaredIncidentId);

    const customFields: JSONish = (declared["customFields"] as JSONish) || {};
    expect(customFields[FIELDS.impact.name]).toBe(declaredImpact);
    // The Hidden field still gets the template's value.
    expect(customFields[FIELDS.internalReference.name]).toBe(
      TEMPLATE_INTERNAL_REFERENCE,
    );
    expect(customFields[FIELDS.region.name]).toBe(TEMPLATE_REGION);

    /*
     * The template's owners are the incident's owners. Declaring from a
     * template used to drop them silently (the page read them and never sent
     * them). The admin who declared would be an owner either way; the team
     * is one only because the template's owners were sent.
     */
    const owners: IncidentOwners = await waitForOwners({
      incidentId: declaredIncidentId,
      description:
        "the template's owner team on the incident declared from the dashboard",
    });
    expect(owners.teamIds).toEqual([ctx.teamId]);
    expect(owners.userIds).toEqual([ctx.user.userId]);
  });
});
