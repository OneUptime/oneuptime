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

test("the table reports what each rule declares", async ({
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
   * An incident-only rule must not advertise an alert severity or an alert
   * on-call policy — that would promise a page that will never arrive.
   */
  await expect(emergency).toContainText("Incident: SEV1 - Critical");
  await expect(emergency).not.toContainText("Alert:");

  // Both outputs, each with its own severity and its own escalation.
  await expect(fastBurn).toContainText("Alert: Critical");
  await expect(fastBurn).toContainText("Incident: SEV1 - Critical");
  await expect(fastBurn).toContainText("Alert: Checkout on-call");
  await expect(fastBurn).toContainText("Incident: Major incident commander");

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

  await screenshot(page, "burn-rate-rules-table-synthetic");
});

/*
 * The create form is a wizard. These walk it, because the interesting part is
 * not that the fields exist — the unit suite pins that from the exported
 * arrays — but that the rail reacts: Incident Routing is absent until the rule
 * says it declares one, and Alert Routing leaves when it says it does not.
 */

const STEP_RAIL: Array<string> = [
  "Rule",
  "Burn Window",
  "What It Declares",
  "Alert Routing",
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

test("the form opens as a wizard, and offers no incident routing until asked", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);

  /*
   * Four steps, not five. `shouldCreateIncident` defaults to false, so the
   * step that configures an incident has nothing to configure — BasicForm
   * drops a step whose showIf is false from the rail AND from the
   * next/previous walk, so it cannot be reached by tabbing past it either.
   */
  expect(await visibleSteps(page)).toEqual([
    "Rule",
    "Burn Window",
    "What It Declares",
    "Alert Routing",
  ]);

  // Enabled carries its column default, so the first step is already truthful.
  const enabledToggle: ReturnType<Page["locator"]> = page
    .locator("div")
    .filter({ hasText: /^Enabled \(Optional\)/ })
    .last()
    .locator("[aria-checked]")
    .first();
  await expect(enabledToggle).toHaveAttribute("aria-checked", "true");

  await screenshot(page, "burn-rate-rule-form-step-rule-synthetic", false);
});

test("the step rail gains and loses a routing step with the toggle that owns it", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);

  // Step 1 - Rule.
  await page.getByPlaceholder("Fast burn").fill("Fast burn");
  await next(page);

  // Step 2 - Burn Window. Every field here is required, so fill them all.
  await page.getByPlaceholder("14.4").fill("14.4");
  await page.getByPlaceholder("60").first().fill("60");
  await page.getByPlaceholder("5").fill("5");
  await screenshot(page, "burn-rate-rule-form-step-window-synthetic", false);
  await next(page);

  // Step 3 - What It Declares: both toggles, together, before either routing.
  const alertToggle: ReturnType<Page["locator"]> = page
    .locator("div")
    .filter({ hasText: /^Create Alert \(Optional\)/ })
    .last()
    .locator("[aria-checked]")
    .first();
  const incidentToggle: ReturnType<Page["locator"]> = page
    .locator("div")
    .filter({ hasText: /^Declare Incident \(Optional\)/ })
    .last()
    .locator("[aria-checked]")
    .first();

  await expect(alertToggle).toHaveAttribute("aria-checked", "true");
  await expect(incidentToggle).toHaveAttribute("aria-checked", "false");

  await screenshot(page, "burn-rate-rule-form-step-declares-synthetic", false);

  // Declaring an incident adds the step that configures it.
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

  // And dropping the alert takes its routing step away again.
  await alertToggle.click();
  await expect(alertToggle).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() => {
      return visibleSteps(page);
    })
    .toEqual(["Rule", "Burn Window", "What It Declares", "Incident Routing"]);

  /*
   * A rule that declares nothing is refused here rather than after a
   * round-trip. The server enforces it too — this only saves the trip.
   *
   * With neither output on, both routing steps leave the rail, so What It
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

test("each routing step configures one output, with its own severity and escalation", async ({
  page,
}: {
  page: Page;
}) => {
  await openCreateForm(page);

  await page.getByPlaceholder("Fast burn").fill("Fast burn");
  await next(page);

  await page.getByPlaceholder("14.4").fill("14.4");
  await page.getByPlaceholder("60").first().fill("60");
  await page.getByPlaceholder("5").fill("5");
  await next(page);

  await page
    .locator("div")
    .filter({ hasText: /^Declare Incident \(Optional\)/ })
    .last()
    .locator("[aria-checked]")
    .first()
    .click();
  await next(page);

  // Alert Routing - the alert's severity and the alert's policies, alone.
  await expect(page.getByText("Alert Severity").first()).toBeVisible();
  await expect(
    page.getByText("Alert On-Call Duty Policies").first(),
  ).toBeVisible();
  await expect(page.getByText("Incident Severity")).toHaveCount(0);

  await screenshot(
    page,
    "burn-rate-rule-form-step-alert-routing-synthetic",
    false,
  );

  await next(page);

  // Incident Routing - its twin, and nothing about alerts.
  await expect(page.getByText("Incident Severity").first()).toBeVisible();
  await expect(
    page.getByText("Incident On-Call Duty Policies").first(),
  ).toBeVisible();
  await expect(page.getByText("Alert Severity")).toHaveCount(0);

  await screenshot(
    page,
    "burn-rate-rule-form-step-incident-routing-synthetic",
    false,
  );
});
