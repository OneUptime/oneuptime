import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import {
  DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
} from "Common/Utils/Slo/SloBurnRateTemplate";
import fs from "fs/promises";
import path from "path";

/*
 * Renders the real Burn Rate Rules page against the offline fixture and
 * captures what a burn rate rule's two outputs actually look like.
 *
 * The assertions are not decoration around the screenshots: each one pins a
 * cell that reads from a NEW column, and every one of them would render a
 * silent fallback instead of failing if the column were missing from the
 * page's `selectMoreFields` — the exact bug the page's own comment warns
 * about.
 */

const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/slos/20000000-0000-4000-8000-000000000001/burn-rate-rules";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/slo-burn-rate",
);

const pageErrors: Map<Page, Array<string>> = new Map();

/*
 * `fullPage` is off for the modal shot: a fixed overlay stretched over a
 * full-page capture renders as a band of backdrop with the dialog floating in
 * the middle of it.
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

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", (error: Error): void => {
    pageErrors.get(page)!.push(error.message);
  });

  /*
   * Nothing may leave the fixture. A request that escaped to a real host
   * would make the screenshot depend on someone's dev stack being up.
   */
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === "4213") {
      await route.continue();
      return;
    }

    await route.abort();
  });

  await page.goto(ROUTE);
  await expect(
    page.getByText("Burn Rate Rules", { exact: true }).first(),
  ).toBeVisible();
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test("the table reports what each rule declares, and where each output goes", async ({
  page,
}: {
  page: Page;
}) => {
  const fastBurn: ReturnType<Page["locator"]> = page
    .locator("tr")
    .filter({ hasText: "Fast burn" });
  const slowBurn: ReturnType<Page["locator"]> = page
    .locator("tr")
    .filter({ hasText: "Slow burn" });
  const emergency: ReturnType<Page["locator"]> = page
    .locator("tr")
    .filter({ hasText: "Budget emergency" });

  // The three shapes the Declares column can report.
  await expect(fastBurn).toContainText("Alert + Incident");
  await expect(slowBurn).toContainText("Alert");
  await expect(slowBurn).not.toContainText("Incident");
  await expect(emergency).toContainText("Incident");

  /*
   * An incident-only rule must not advertise an alert severity, an alert
   * on-call policy or alert owners — that would promise a page that will never
   * arrive.
   */
  await expect(emergency).toContainText("Incident: SEV1 - Critical");
  await expect(emergency).not.toContainText("Alert:");

  // Both outputs, each with its own severity and its own escalation.
  await expect(fastBurn).toContainText("Alert: Critical");
  await expect(fastBurn).toContainText("Incident: SEV1 - Critical");
  await expect(fastBurn).toContainText("Alert: Checkout on-call");
  await expect(fastBurn).toContainText("Incident: Major incident commander");

  /*
   * The options a responder would otherwise not know about, listed under the
   * Declares label - and only for an output the rule declares.
   */
  await expect(slowBurn).toContainText("Alert: resolved by hand");
  await expect(emergency).toContainText("Incident: private");
  await expect(fastBurn).toContainText("SLO owners added as owners");

  // Owners, per output.
  await expect(fastBurn).toContainText("Alert: Checkout team");
  await expect(fastBurn).toContainText("Incident: Jane Doe");
  await expect(fastBurn).toContainText("+ SLO owners");
  await expect(slowBurn).toContainText("Alert: None");
  await expect(emergency).toContainText("Incident: Major incident team");

  // Labels, once each across both outputs.
  await expect(fastBurn.getByText("checkout", { exact: true })).toHaveCount(1);
  await expect(fastBurn).toContainText("customer-impact");

  /*
   * The live pill. Fast burn was stamped 12 minutes ago with no resolve, so
   * both lifecycles are open.
   */
  await expect(fastBurn).toContainText("Firing");

  // A rule that has never declared anything reads as such, not as an error.
  await expect(emergency).toContainText("Never fired");

  /*
   * The firing lifecycle and the enabled flag are two different columns, and
   * both used to be called "Status".
   */
  await expect(page.getByRole("columnheader", { name: "Status" })).toHaveCount(
    1,
  );
  await expect(page.getByRole("columnheader", { name: "Enabled" })).toHaveCount(
    1,
  );
  await expect(page.getByRole("columnheader", { name: "Owners" })).toHaveCount(
    1,
  );
  await expect(page.getByRole("columnheader", { name: "Labels" })).toHaveCount(
    1,
  );

  await screenshot(page, "burn-rate-rules-table-synthetic");
});

/*
 * The create form is a wizard. These walk it, because the interesting part is
 * not that the fields exist — the unit suite pins that from the exported
 * arrays — but that the rail reacts: the incident step is absent until the
 * rule says it declares one, and the alert step leaves when it says it does not.
 */

const STEP_RAIL: Array<string> = [
  "Rule",
  "Burn Window",
  "What It Declares",
  "Alert",
  "Incident",
];

/*
 * The rail in document order, so these assert the SEQUENCE and not just which
 * steps happen to exist. Steps render as plain list items inside the progress
 * nav — no role, no accessible name — so this reads the list rather than
 * looking them up by role.
 */
async function visibleSteps(page: Page): Promise<Array<string>> {
  const titles: Array<string> = await page
    .locator('nav[aria-label="Progress"] li')
    .allInnerTexts();

  return titles
    .map((title: string): string => {
      return title.trim();
    })
    .filter((title: string): boolean => {
      return title.length > 0;
    });
}

async function openCreateForm(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Create SLO Burn Rate Rule" })
    .first()
    .click();

  await expect(
    page.getByText("Create New SLO Burn Rate Rule", { exact: true }),
  ).toBeVisible();
}

async function next(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

// A toggle is found by the label it renders ("<Title> (Optional)").
function toggle(page: Page, title: string): ReturnType<Page["locator"]> {
  return page
    .locator("div")
    .filter({ hasText: new RegExp(`^${title} \\(Optional\\)`) })
    .last()
    .locator("[aria-checked]")
    .first();
}

async function fillRuleAndWindow(
  page: Page,
  name: string = "Fast burn",
): Promise<void> {
  // Step 1 - Rule.
  await page.getByPlaceholder("Fast burn").fill(name);
  await next(page);

  // Step 2 - Burn Window. Every field here is required, so fill them all.
  await page.getByPlaceholder("14.4").fill("14.4");
  await page.getByPlaceholder("60").first().fill("60");
  await page.getByPlaceholder("5").fill("5");
}

test("the wider form opens with only the steps for its enabled outputs", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);

  /*
   * Incident defaults to false. BasicForm drops that step from both the
   * rail and the next/previous walk until the rule declares an incident.
   */
  expect(await visibleSteps(page)).toEqual([
    "Rule",
    "Burn Window",
    "What It Declares",
    "Alert",
  ]);

  const bounds: Awaited<ReturnType<Locator["boundingBox"]>> = await page
    .getByRole("dialog")
    .boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBe(1280);

  // Enabled carries its column default, so the first step is already truthful.
  await expect(toggle(page, "Enabled")).toHaveAttribute("aria-checked", "true");

  await screenshot(page, "burn-rate-rule-form-step-rule-synthetic", false);
});

test("the step rail gains and loses each output step with its toggle", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);
  await fillRuleAndWindow(page);
  await screenshot(page, "burn-rate-rule-form-step-window-synthetic", false);
  await next(page);

  // Step 3 - What It Declares: both toggles, together, before any output step.
  const alertToggle: ReturnType<Page["locator"]> = toggle(page, "Create Alert");
  const incidentToggle: ReturnType<Page["locator"]> = toggle(
    page,
    "Declare Incident",
  );

  await expect(alertToggle).toHaveAttribute("aria-checked", "true");
  await expect(incidentToggle).toHaveAttribute("aria-checked", "false");

  // The switch that applies to both outputs lives here, off by default.
  await expect(toggle(page, "Add SLO Owners as Owners")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  await screenshot(page, "burn-rate-rule-form-step-declares-synthetic", false);

  // Declaring an incident adds its configuration step.
  await incidentToggle.click();
  await expect(incidentToggle).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() => {
      return visibleSteps(page);
    })
    .toEqual(STEP_RAIL);

  await screenshot(
    page,
    "burn-rate-rule-form-step-declares-both-synthetic",
    false,
  );

  // And dropping the alert takes its configuration step away again.
  await alertToggle.click();
  await expect(alertToggle).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() => {
      return visibleSteps(page);
    })
    .toEqual(["Rule", "Burn Window", "What It Declares", "Incident"]);

  /*
   * A rule that declares nothing is refused here rather than after a
   * round-trip. The server enforces it too — this only saves the trip.
   *
   * With neither output on, every output step leaves the rail, so What It
   * Declares becomes the last step and its primary button turns from "Next"
   * into the submit button. Wait for that before clicking: reaching for "Next"
   * straight after the toggle only worked when the click beat the re-render.
   */
  await incidentToggle.click();
  await expect(incidentToggle).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() => {
      return visibleSteps(page);
    })
    .toEqual(["Rule", "Burn Window", "What It Declares"]);
  const dialog: ReturnType<Page["locator"]> = page.getByRole("dialog", {
    name: "Create New SLO Burn Rate Rule",
  });
  await dialog
    .getByRole("button", { name: "Create SLO Burn Rate Rule", exact: true })
    .click();

  // Refused in the form: the dialog is still open on the same step.
  await expect(dialog).toBeVisible();

  const noOutputError: ReturnType<Page["locator"]> = page.getByText(
    "This rule would do nothing. Turn on Create Alert, Declare Incident, or both.",
  );

  /*
   * Once, not twice. The validator hangs off the alert toggle alone — both
   * toggles carrying it rendered the same sentence under each of them.
   */
  await expect(noOutputError).toHaveCount(1);
  await expect(noOutputError).toBeVisible();

  await screenshot(page, "burn-rate-rule-form-no-output-synthetic", false);
});

const OUTPUT_SECTIONS: Array<string> = [
  "Description",
  "Ownership & Labels",
  "On-Call",
  "Advanced Options",
];

async function setSection(
  page: Page,
  title: string,
  expanded: boolean,
): Promise<void> {
  const header: Locator = page.getByRole("button", {
    name: title,
    exact: true,
  });
  await expect(header).toBeVisible();
  if ((await header.getAttribute("aria-expanded")) !== String(expanded)) {
    await header.click();
  }
  await expect(header).toHaveAttribute("aria-expanded", String(expanded));
}

async function selectOption(
  page: Page,
  field: string,
  value: string,
): Promise<void> {
  await page.getByRole("combobox", { name: field }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}

async function openEditForm(page: Page, ruleName: string): Promise<void> {
  await page
    .locator("tr")
    .filter({ hasText: ruleName })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit SLO Burn Rate Rule", exact: true }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Fast burn")).toHaveValue(ruleName);
}

async function reachOutputStep(page: Page): Promise<void> {
  await next(page);
  await next(page);
  await next(page);
}

test("each output keeps title and severity beside collapsible optional sections", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);
  await fillRuleAndWindow(page);
  await next(page);
  await toggle(page, "Declare Incident").click();
  await next(page);

  for (const output of ["Alert", "Incident"]) {
    await expect(
      page.getByRole("textbox", { name: `${output} Title` }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: `${output} Severity` }),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder("SLO burn rate: {{sloName}} — {{ruleName}}"),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: `${output} Title` }),
    ).toHaveValue(DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE);
    await expect(
      page.getByRole("textbox", { name: `${output} Description` }),
    ).toHaveText(DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE);

    for (const title of OUTPUT_SECTIONS) {
      await expect(
        page.getByRole("button", { name: title, exact: true }),
      ).toHaveAttribute("aria-expanded", String(title === "Description"));
    }

    await screenshot(
      page,
      `burn-rate-rule-form-step-${output.toLowerCase()}-synthetic`,
      false,
    );

    await setSection(page, "Description", true);
    await expect(
      page.getByRole("textbox", { name: `${output} Description` }),
    ).toBeVisible();
    await setSection(page, "Ownership & Labels", true);
    for (const field of ["Owner Teams", "Owner Users", "Labels"]) {
      await expect(
        page.getByRole("combobox", { name: `${output} ${field}` }),
      ).toBeVisible();
    }
    await setSection(page, "On-Call", true);
    await expect(
      page.getByRole("combobox", { name: `${output} On-Call Duty Policies` }),
    ).toBeVisible();
    await setSection(page, "Advanced Options", true);
    await expect(toggle(page, `Auto Resolve ${output}`)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(toggle(page, `Private ${output}`)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(
      page.getByRole("textbox", { name: `${output} Remediation Notes` }),
    ).toBeVisible();

    const otherOutput: string = output === "Alert" ? "Incident" : "Alert";
    await expect(
      page.getByRole("combobox", { name: `${otherOutput} Severity` }),
    ).toHaveCount(0);

    if (output === "Alert") {
      await next(page);
    }
  }
});

interface OutputValues {
  output: "Alert" | "Incident";
  title: string;
  description: string;
  severity: string;
  team: string;
  user: string;
  label: string;
  policy: string;
  remediation: string;
}

const ALERT_VALUES: OutputValues = {
  output: "Alert",
  title: "Investigate {{sloName}}",
  description: "Alert context for {{ruleName}}",
  severity: "Warning",
  team: "Checkout team",
  user: "Sam Lee",
  label: "checkout",
  policy: "Checkout on-call",
  remediation: "Check the latest checkout deployment",
};

const INCIDENT_VALUES: OutputValues = {
  output: "Incident",
  title: "Coordinate response for {{sloName}}",
  description: "Incident context for {{ruleName}}",
  severity: "SEV2 - Major",
  team: "Major incident team",
  user: "Jane Doe",
  label: "customer-impact",
  policy: "Major incident commander",
  remediation: "Start the incident response call",
};

async function configureOutput(
  page: Page,
  values: OutputValues,
): Promise<void> {
  const output: string = values.output;
  await page
    .getByRole("textbox", { name: `${output} Title` })
    .fill(values.title);
  await selectOption(page, `${output} Severity`, values.severity);
  await setSection(page, "Description", true);
  await page
    .getByRole("textbox", { name: `${output} Description` })
    .fill(values.description);
  await setSection(page, "Ownership & Labels", true);
  await selectOption(page, `${output} Owner Teams`, values.team);
  await selectOption(page, `${output} Owner Users`, values.user);
  await selectOption(page, `${output} Labels`, values.label);
  await setSection(page, "On-Call", true);
  await selectOption(page, `${output} On-Call Duty Policies`, values.policy);
  await setSection(page, "Advanced Options", true);
  await toggle(page, `Auto Resolve ${output}`).click();
  await toggle(page, `Private ${output}`).click();
  await page
    .getByRole("textbox", { name: `${output} Remediation Notes` })
    .fill(values.remediation);

  // Saving a closed section must retain all of its values.
  for (const title of OUTPUT_SECTIONS) {
    await setSection(page, title, false);
  }
}

async function expectOutputValues(
  page: Page,
  values: OutputValues,
): Promise<void> {
  const output: string = values.output;
  for (const title of OUTPUT_SECTIONS) {
    await expect(
      page.getByRole("button", { name: title, exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
  }
  await expect(
    page.getByRole("textbox", { name: `${output} Title` }),
  ).toHaveValue(values.title);
  await expect(
    page.getByRole("textbox", { name: `${output} Description` }),
  ).toHaveText(values.description);
  await expect(
    page.getByRole("textbox", { name: `${output} Remediation Notes` }),
  ).toHaveText(values.remediation);
  const dialog: Locator = page.getByRole("dialog");
  for (const value of [
    values.severity,
    values.team,
    values.user,
    values.label,
    values.policy,
  ]) {
    await expect(dialog.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(toggle(page, `Auto Resolve ${output}`)).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(toggle(page, `Private ${output}`)).toHaveAttribute(
    "aria-checked",
    "true",
  );
}

test("creating and editing preserve both outputs' optional values and distinct routing", async ({
  page,
}: {
  page: Page;
}) => {
  // This covers a complete create plus two edit journeys for both outputs.
  test.setTimeout(180000);
  await openCreateForm(page);
  await fillRuleAndWindow(page, "Custom burn");
  await next(page);
  await toggle(page, "Declare Incident").click();
  await toggle(page, "Add SLO Owners as Owners").click();
  await next(page);
  await configureOutput(page, ALERT_VALUES);
  await next(page);
  await configureOutput(page, INCIDENT_VALUES);

  /*
   * Go back with every optional section closed. The filled values survive
   * both remounting a wizard step and the final create request.
   */
  await page
    .locator('nav[aria-label="Progress"] li')
    .filter({ hasText: /^Alert$/ })
    .click();
  await expectOutputValues(page, ALERT_VALUES);
  await next(page);
  await expectOutputValues(page, INCIDENT_VALUES);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create SLO Burn Rate Rule", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openEditForm(page, "Custom burn");
  await page.getByPlaceholder("Fast burn").fill("Custom burn updated");
  await next(page);
  await next(page);
  await expect(toggle(page, "Add SLO Owners as Owners")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await next(page);
  await expectOutputValues(page, ALERT_VALUES);
  await page
    .getByRole("textbox", { name: "Alert Title" })
    .fill("Updated alert title");
  await setSection(page, "Ownership & Labels", false);
  await setSection(page, "On-Call", false);
  await next(page);
  await expectOutputValues(page, INCIDENT_VALUES);
  await page
    .getByRole("textbox", { name: "Incident Title" })
    .fill("Updated incident title");
  await setSection(page, "Ownership & Labels", false);
  await setSection(page, "On-Call", false);
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openEditForm(page, "Custom burn updated");
  await reachOutputStep(page);
  await expectOutputValues(page, {
    ...ALERT_VALUES,
    title: "Updated alert title",
  });
  await next(page);
  await expectOutputValues(page, {
    ...INCIDENT_VALUES,
    title: "Updated incident title",
  });
});

test("editing expands configured sections and keeps empty defaults collapsed", async ({
  page,
}: {
  page: Page;
}) => {
  await openEditForm(page, "Fast burn");
  await reachOutputStep(page);
  for (const output of ["Alert", "Incident"]) {
    await expect(
      page.getByRole("textbox", { name: `${output} Title` }),
    ).toHaveValue("");
    await expect(
      page
        .getByRole("dialog")
        .getByText(output === "Alert" ? "Checkout team" : "Jane Doe", {
          exact: true,
        }),
    ).toBeVisible();
    for (const title of ["Ownership & Labels", "On-Call"]) {
      await expect(
        page.getByRole("button", { name: title, exact: true }),
      ).toHaveAttribute("aria-expanded", "true");
    }
    for (const title of ["Description", "Advanced Options"]) {
      await expect(
        page.getByRole("button", { name: title, exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
    }
    if (output === "Alert") {
      await next(page);
    }
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // A false auto-resolve value is configured; a truthy-only check loses it.
  await openEditForm(page, "Slow burn");
  await reachOutputStep(page);
  await expect(
    page.getByRole("button", { name: "Advanced Options", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(toggle(page, "Auto Resolve Alert")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Ownership & Labels", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await openEditForm(page, "Budget emergency");
  await reachOutputStep(page);
  await expect(
    page.getByRole("textbox", { name: "Incident Title" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Advanced Options", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(toggle(page, "Private Incident")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("validation reopens a collapsed section containing an invalid description", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);
  await fillRuleAndWindow(page);
  await next(page);
  await toggle(page, "Declare Incident").click();
  await next(page);
  await setSection(page, "Description", true);
  await page
    .getByRole("textbox", { name: "Alert Description" })
    .fill("x".repeat(50001));
  await setSection(page, "Description", false);
  await next(page);
  await expect(
    page.getByRole("button", { name: "Description", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText("Alert Description cannot be more than 50000 characters.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Alert Title" }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Alert Description" })
    .fill("Valid description");
  await next(page);
  await expect(
    page.getByRole("textbox", { name: "Incident Title" }),
  ).toBeVisible();
});

test("the wider modal fits a narrow viewport and its sections work by keyboard", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCreateForm(page);
  await fillRuleAndWindow(page);
  await next(page);
  await next(page);
  const dialog: Locator = page.getByRole("dialog");
  const bounds: Awaited<ReturnType<Locator["boundingBox"]>> =
    await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeLessThanOrEqual(844);
  expect(
    await dialog.evaluate((element: HTMLElement | SVGElement): boolean => {
      return element.scrollWidth <= element.clientWidth;
    }),
  ).toBe(true);

  const description: Locator = page.getByRole("button", {
    name: "Description",
    exact: true,
  });
  await expect(description).toHaveAttribute("aria-expanded", "true");
  await description.focus();
  await page.keyboard.press("Space");
  await expect(description).toHaveAttribute("aria-expanded", "false");
  await description.focus();
  await page.keyboard.press("Enter");
  await expect(description).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("textbox", { name: "Alert Description" })
    .fill("Written on a narrow screen");
  await description.focus();
  await page.keyboard.press("Space");
  await expect(description).toHaveAttribute("aria-expanded", "false");
  await selectOption(page, "Alert Severity", "Warning");
  await screenshot(page, "burn-rate-rule-form-narrow-synthetic", false);

  await dialog
    .getByRole("button", { name: "Create SLO Burn Rate Rule", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});

test("default templates survive saving and reopening, and clearing them keeps the backend fallback", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);
  await fillRuleAndWindow(page, "Default templates");
  await next(page);
  await toggle(page, "Declare Incident").click();
  await next(page);

  for (const output of ["Alert", "Incident"]) {
    await expect(
      page.getByRole("textbox", { name: `${output} Title` }),
    ).toHaveValue(DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE);
    await expect(
      page.getByRole("textbox", { name: `${output} Description` }),
    ).toHaveText(DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE);
    await expect(
      page.getByRole("button", { name: "Description", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    if (output === "Alert") {
      await next(page);
    }
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create SLO Burn Rate Rule", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openEditForm(page, "Default templates");
  await reachOutputStep(page);
  for (const output of ["Alert", "Incident"]) {
    const title: Locator = page.getByRole("textbox", {
      name: `${output} Title`,
    });
    const description: Locator = page.getByRole("textbox", {
      name: `${output} Description`,
    });
    await expect(title).toHaveValue(DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE);
    await expect(description).toHaveText(
      DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
    );
    await title.fill("");
    await description.fill("");
    if (output === "Alert") {
      await next(page);
    }
  }
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openEditForm(page, "Default templates");
  await reachOutputStep(page);
  for (const output of ["Alert", "Incident"]) {
    await expect(
      page.getByRole("textbox", { name: `${output} Title` }),
    ).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Description", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await setSection(page, "Description", true);
    await expect(
      page.getByRole("textbox", { name: `${output} Description` }),
    ).toBeEmpty();
    if (output === "Alert") {
      await next(page);
    }
  }
});

for (const disabledOutput of ["Alert", "Incident"]) {
  test(`a disabled ${disabledOutput.toLowerCase()} restores its configured values after saving and re-enabling`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEditForm(page, "Fast burn");
    await reachOutputStep(page);
    for (const output of ["Alert", "Incident"]) {
      await page
        .getByRole("textbox", { name: `${output} Title` })
        .fill(`Retained ${output.toLowerCase()} title`);
      await setSection(page, "Description", true);
      await page
        .getByRole("textbox", { name: `${output} Description` })
        .fill(`Retained ${output.toLowerCase()} description`);
      if (output === "Alert") {
        await next(page);
      }
    }

    await page
      .locator('nav[aria-label="Progress"] li')
      .filter({ hasText: /^What It Declares$/ })
      .click();
    const disabledToggle: string =
      disabledOutput === "Alert" ? "Create Alert" : "Declare Incident";
    const enabledOutput: string =
      disabledOutput === "Alert" ? "Incident" : "Alert";
    await toggle(page, disabledToggle).click();
    await expect
      .poll(() => {
        return visibleSteps(page);
      })
      .toEqual(["Rule", "Burn Window", "What It Declares", enabledOutput]);
    await next(page);
    await expect(
      page.getByRole("textbox", { name: `${enabledOutput} Title` }),
    ).toHaveValue(`Retained ${enabledOutput.toLowerCase()} title`);
    await expect(
      page.getByRole("textbox", { name: `${disabledOutput} Title` }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await openEditForm(page, "Fast burn");
    await next(page);
    await next(page);
    await expect(toggle(page, disabledToggle)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await toggle(page, disabledToggle).click();
    await expect
      .poll(() => {
        return visibleSteps(page);
      })
      .toEqual(STEP_RAIL);
    await next(page);

    for (const output of ["Alert", "Incident"]) {
      await expect(
        page.getByRole("textbox", { name: `${output} Title` }),
      ).toHaveValue(`Retained ${output.toLowerCase()} title`);
      await expect(
        page.getByRole("textbox", { name: `${output} Description` }),
      ).toHaveText(`Retained ${output.toLowerCase()} description`);
      for (const section of ["Description", "Ownership & Labels", "On-Call"]) {
        await expect(
          page.getByRole("button", { name: section, exact: true }),
        ).toHaveAttribute("aria-expanded", "true");
      }
      const savedRelations: Array<string> =
        output === "Alert"
          ? ["Critical", "Checkout team", "Checkout on-call", "checkout"]
          : [
              "SEV1 - Critical",
              "Jane Doe",
              "Major incident commander",
              "checkout",
              "customer-impact",
            ];
      for (const relation of savedRelations) {
        await expect(
          page.getByRole("dialog").getByText(relation, { exact: true }),
        ).toBeVisible();
      }
      if (output === "Alert") {
        await next(page);
      }
    }
  });
}
