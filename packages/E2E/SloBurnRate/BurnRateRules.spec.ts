import { expect, Page, Route as PlaywrightRoute, test } from "@playwright/test";
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
  "../../output/playwright/slo-burn-rate",
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
 * arrays — but that the rail reacts: the incident steps are absent until the
 * rule says it declares one, and the alert steps leave when it says it does not.
 */

const STEP_RAIL: Array<string> = [
  "Rule",
  "Burn Window",
  "What It Declares",
  "Alert Details",
  "Alert Routing",
  "Incident Details",
  "Incident Routing",
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

async function fillRuleAndWindow(page: Page): Promise<void> {
  // Step 1 - Rule.
  await page.getByPlaceholder("Fast burn").fill("Fast burn");
  await next(page);

  // Step 2 - Burn Window. Every field here is required, so fill them all.
  await page.getByPlaceholder("14.4").fill("14.4");
  await page.getByPlaceholder("60").first().fill("60");
  await page.getByPlaceholder("5").fill("5");
}

test("the form opens as a wizard, and offers no incident steps until asked", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);

  /*
   * Five steps, not seven. `shouldCreateIncident` defaults to false, so the
   * two steps that configure an incident have nothing to configure — BasicForm
   * drops a step whose showIf is false from the rail AND from the
   * next/previous walk, so it cannot be reached by tabbing past it either.
   */
  expect(await visibleSteps(page)).toEqual([
    "Rule",
    "Burn Window",
    "What It Declares",
    "Alert Details",
    "Alert Routing",
  ]);

  // Enabled carries its column default, so the first step is already truthful.
  await expect(toggle(page, "Enabled")).toHaveAttribute("aria-checked", "true");

  await screenshot(page, "burn-rate-rule-form-step-rule-synthetic", false);
});

test("the step rail gains and loses each output's steps with the toggle that owns them", async ({
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

  // Declaring an incident adds the two steps that configure it.
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

  // And dropping the alert takes its two steps away again.
  await alertToggle.click();
  await expect(alertToggle).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() => {
      return visibleSteps(page);
    })
    .toEqual([
      "Rule",
      "Burn Window",
      "What It Declares",
      "Incident Details",
      "Incident Routing",
    ]);

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

test("each output gets a details step and a routing step of its own", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);
  await fillRuleAndWindow(page);
  await next(page);

  await toggle(page, "Declare Incident").click();
  await next(page);

  /*
   * Alert Details - what the alert says. The title field shows the built-in
   * title as its placeholder, so an empty field says what the alert will be
   * called rather than implying it will be untitled.
   */
  await expect(page.getByText("Alert Title").first()).toBeVisible();
  await expect(
    page.getByPlaceholder("SLO burn rate: {{sloName}} — {{ruleName}}"),
  ).toBeVisible();
  await expect(page.getByText("Alert Description").first()).toBeVisible();
  await expect(page.getByText("Alert Severity").first()).toBeVisible();
  await expect(page.getByText("Incident Severity")).toHaveCount(0);

  await screenshot(
    page,
    "burn-rate-rule-form-step-alert-details-synthetic",
    false,
  );

  await next(page);

  // Alert Routing - who hears about the alert, and what happens to it.
  await expect(
    page.getByText("Alert On-Call Duty Policies").first(),
  ).toBeVisible();
  await expect(page.getByText("Alert Owner Teams").first()).toBeVisible();
  await expect(page.getByText("Alert Owner Users").first()).toBeVisible();
  await expect(page.getByText("Alert Labels").first()).toBeVisible();
  await expect(page.getByText("Alert Remediation Notes").first()).toBeVisible();

  // Auto-resolve defaults ON (every rule always resolved), private OFF.
  await expect(toggle(page, "Auto Resolve Alert")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(toggle(page, "Private Alert")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByText("Incident On-Call Duty Policies")).toHaveCount(0);

  await screenshot(
    page,
    "burn-rate-rule-form-step-alert-routing-synthetic",
    false,
  );

  await next(page);

  // Incident Details - its twin, and nothing about alerts.
  await expect(page.getByText("Incident Title").first()).toBeVisible();
  await expect(page.getByText("Incident Description").first()).toBeVisible();
  await expect(page.getByText("Incident Severity").first()).toBeVisible();
  await expect(page.getByText("Alert Severity")).toHaveCount(0);

  await screenshot(
    page,
    "burn-rate-rule-form-step-incident-details-synthetic",
    false,
  );

  await next(page);

  // Incident Routing.
  await expect(
    page.getByText("Incident On-Call Duty Policies").first(),
  ).toBeVisible();
  await expect(page.getByText("Incident Owner Teams").first()).toBeVisible();
  await expect(page.getByText("Incident Owner Users").first()).toBeVisible();
  await expect(page.getByText("Incident Labels").first()).toBeVisible();
  await expect(toggle(page, "Auto Resolve Incident")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(toggle(page, "Private Incident")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByText("Alert On-Call Duty Policies")).toHaveCount(0);

  await screenshot(
    page,
    "burn-rate-rule-form-step-incident-routing-synthetic",
    false,
  );
});
