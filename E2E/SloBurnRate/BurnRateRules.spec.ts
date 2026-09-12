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

test("the form offers both outputs with their own severity and escalation", async ({
  page,
}: {
  page: Page;
}) => {
  await page
    .getByRole("button", { name: "Create SLO Burn Rate Rule" })
    .first()
    .click();

  /*
   * Substring matches, not exact ones: an optional field's label renders as
   * "<title> (Optional)" in one element, so an exact match finds nothing.
   */
  await expect(page.getByText("Create Alert").first()).toBeVisible();
  await expect(page.getByText("Declare Incident").first()).toBeVisible();
  await expect(
    page.getByText("Alert On-Call Duty Policies").first(),
  ).toBeVisible();
  await expect(page.getByText("Incident Severity").first()).toBeVisible();
  await expect(
    page.getByText("Incident On-Call Duty Policies").first(),
  ).toBeVisible();

  /*
   * Create Alert must render ON even though nobody touched it — it carries the
   * column's own default, so a form showing it off would be telling the user
   * the opposite of what the row will hold.
   */
  const createAlertToggle: ReturnType<Page["locator"]> = page
    .locator("div")
    .filter({ hasText: /^Create Alert \(Optional\)/ })
    .last()
    .locator("[aria-checked]")
    .first();
  await expect(createAlertToggle).toHaveAttribute("aria-checked", "true");

  /*
   * And its neighbour is off, which is the other half of the claim: the two
   * toggles carry their own column defaults rather than both rendering off.
   */
  const declareIncidentToggle: ReturnType<Page["locator"]> = page
    .locator("div")
    .filter({ hasText: /^Declare Incident \(Optional\)/ })
    .last()
    .locator("[aria-checked]")
    .first();
  await expect(declareIncidentToggle).toHaveAttribute("aria-checked", "false");

  /*
   * Two shots: the modal shows about six fields at a time, and the point of
   * the change is that the alert half and the incident half are configured
   * independently.
   */
  await page.getByText("Create Alert").first().scrollIntoViewIfNeeded();
  await screenshot(page, "burn-rate-rule-form-alert-synthetic", false);

  await page
    .getByText("Incident On-Call Duty Policies")
    .first()
    .scrollIntoViewIfNeeded();
  await screenshot(page, "burn-rate-rule-form-incident-synthetic", false);
});
