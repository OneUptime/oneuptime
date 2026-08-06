import { BASE_URL } from "../../Config";
import { Browser, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";

/*
 * Log drop filters, created the way a customer creates them: through the
 * dashboard form, against a real API and a real Postgres table.
 *
 * Both bugs this covers were invisible to unit tests because both lived in
 * the plumbing *between* the form and the row, and both made the feature
 * completely unusable rather than subtly wrong:
 *
 *   - Creating any drop filter returned HTTP 500. `droppedCount` is NOT NULL
 *     DEFAULT 0 and ingest-owned, so no create sends it — but its column
 *     transformer folded `undefined` into `null`, and TypeORM runs the
 *     transformer before deciding whether to emit DEFAULT. Every insert hit
 *     the not-null constraint.
 *     github.com/OneUptime/oneuptime/issues/3026
 *
 *   - Creating a *sample* filter returned HTTP 400 — "Sample percentage is
 *     required when the action is Sample" — on a form where the percentage
 *     had been filled in. `<input type="number">` yields a string, so the
 *     save hook's `typeof === "number"` check rejected "10".
 *     github.com/OneUptime/oneuptime/issues/3027
 *
 * A test that posts a hand-built JSON body would have missed the second one
 * entirely, which is the whole reason this spec drives the form.
 *
 * Serial mode with a shared page: one registration + project is enough for
 * every case here, and the later steps are pointless once creation breaks.
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/LogDropFilters.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

// ModelTable names its create form after the model class.
const createFormSelector: string = "#create-LogDropFilter-from";

const createButtonName: string = "Create Log Drop Filter";

interface SharedContext {
  page: Page;
  projectId: string;
  dropFilterName: string;
  sampleFilterName: string;
}

type DropFiltersUrlFunction = (projectId: string) => string;

const dropFiltersUrl: DropFiltersUrlFunction = (projectId: string): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${projectId}/logs/settings/drop-filters`)
    .toString();
};

test.describe("Log Drop Filters", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    dropFilterName: "",
    sampleFilterName: "",
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Drop Filter Project",
    });

    // Run-unique, so a re-run never collides with a previous run's rows.
    const token: string = Faker.generateName().toString();
    ctx.dropFilterName = `E2E Drop Debug ${token}`;
    ctx.sampleFilterName = `E2E Sample Debug ${token}`;
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  /*
   * Opens the create modal and fills the first two steps, which are
   * identical for both actions: a name, then a real filter condition.
   *
   * The Filter Query field is a custom query builder, not an input. Its
   * first condition starts as `severityText = <nothing>` and only emits a
   * query once a value is picked — and an empty query is rejected on save
   * (it would match every log and discard the project's telemetry), so this
   * has to pick one.
   */
  async function openCreateModalAndFillConditions(name: string): Promise<void> {
    const page: Page = ctx.page;

    const createButton: Locator = page.getByRole("button", {
      name: createButtonName,
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dropFiltersUrl(ctx.projectId),
      ready: createButton,
    });

    await createButton.click();

    const modal: Locator = page.getByTestId("modal");
    await modal.waitFor({ state: "visible", timeout: 30000 });

    const form: Locator = page.locator(createFormSelector);
    await form.waitFor({ state: "visible", timeout: 30000 });

    // Step 1 — Basic Info.
    await form.getByLabel("Name").fill(name);
    await page.getByTestId("modal-footer-submit-button").click();

    /*
     * Step 2 — Filter Conditions. The step renders exactly one condition
     * row, and BasicForm renders only the current step's fields, so the
     * three comboboxes on screen are this row's Field, Operator and Value in
     * DOM order. Value is the one to set; Field and Operator already default
     * to Severity / equals.
     */
    const valueDropdown: Locator = form.getByRole("combobox").nth(2);
    await valueDropdown.waitFor({ state: "visible", timeout: 30000 });
    await valueDropdown.click();
    await page.getByRole("option", { name: "Debug", exact: true }).click();

    // The preview proves the builder emitted a query rather than staying blank.
    await form.getByText("Preview query").click();
    await expect(form.getByText("severityText = 'Debug'")).toBeVisible({
      timeout: 30000,
    });

    await page.getByTestId("modal-footer-submit-button").click();
  }

  test("should reach the log drop filters settings page", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const createButton: Locator = page.getByRole("button", {
      name: createButtonName,
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dropFiltersUrl(ctx.projectId),
      ready: createButton,
    });

    await expect(createButton).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("No drop filters found.")).toBeVisible({
      timeout: 60000,
    });
  });

  /*
   * Issue 3026. Nothing about this filter is unusual — that is the point.
   * The create failed on a column the form never mentions.
   */
  test("should create a drop-action filter", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    await openCreateModalAndFillConditions(ctx.dropFilterName);

    /*
     * Step 3 — Action. Drop is the form's initial value, so submitting the
     * step as-is is exactly the reported reproduction: Logs -> Settings ->
     * Drop filters -> Create.
     */
    const form: Locator = page.locator(createFormSelector);
    await expect(
      form.getByText("Action", { exact: false }).first(),
    ).toBeVisible({ timeout: 30000 });

    await page.getByTestId("modal-footer-submit-button").click();

    // No 500: the modal only closes when the create actually succeeded.
    await page
      .getByTestId("modal")
      .waitFor({ state: "hidden", timeout: 90000 });

    const row: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.dropFilterName });
    await expect(row).toBeVisible({ timeout: 60000 });
    await expect(row).toContainText("Drop");
    await expect(row).toContainText("Enabled");

    /*
     * The counter the insert used to choke on. It renders its empty state,
     * which means the column came back as 0 from its DEFAULT — not as the
     * null that would have failed the constraint.
     */
    await expect(row).toContainText("Nothing dropped yet");
  });

  /*
   * Issue 3027. The percentage is typed into a real <input type="number">,
   * so this is the only kind of test that can catch a value arriving at the
   * API as a string.
   */
  test("should create a sample-action filter with a percentage", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    await openCreateModalAndFillConditions(ctx.sampleFilterName);

    // Step 3 — Action: switch to Sample, which reveals the percentage field.
    const form: Locator = page.locator(createFormSelector);
    const actionDropdown: Locator = form.getByRole("combobox").first();
    await actionDropdown.waitFor({ state: "visible", timeout: 30000 });
    await actionDropdown.click();
    await page.getByRole("option", { name: "Sample", exact: true }).click();

    const percentage: Locator = form.getByLabel("Sample Percentage");
    await expect(percentage).toBeVisible({ timeout: 30000 });
    await percentage.fill("10");

    await page.getByTestId("modal-footer-submit-button").click();

    /*
     * No 400. The failure mode this replaces left the modal open with
     * "Sample percentage is required when the action is Sample" above a
     * field containing 10, so assert the message is absent before waiting on
     * the modal — it names the bug instead of timing out anonymously.
     */
    await expect(
      page.getByText("Sample percentage is required", { exact: false }),
    ).toHaveCount(0);

    await page
      .getByTestId("modal")
      .waitFor({ state: "hidden", timeout: 90000 });

    /*
     * "Sample 10%", not "Sample" and not "Sample 0%": the percentage survived
     * the round trip as a number the list can render.
     */
    const row: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.sampleFilterName });
    await expect(row).toBeVisible({ timeout: 60000 });
    await expect(row).toContainText("Sample 10%");
  });

  /*
   * Reading the row back from the API is the other half of the round trip:
   * the list renders whatever create wrote, but the view page re-fetches it.
   */
  test("should show the saved percentage on the filter's view page", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const row: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.sampleFilterName });
    await row.getByRole("button", { name: "View Log Drop Filter" }).click();

    await page.waitForURL(
      new RegExp(
        `/dashboard/${ctx.projectId}/logs/settings/drop-filters/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`,
        "i",
      ),
      { timeout: 60000 },
    );

    await expect(page.getByText(ctx.sampleFilterName)).toBeVisible({
      timeout: 60000,
    });

    /*
     * "10% kept / 90% discarded". The view page renders "Not configured"
     * for any percentage the engine cannot honour — which is what a value
     * that stayed a string, or never arrived, would have produced.
     */
    await expect(page.getByText("10%", { exact: true }).first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("kept").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Not configured")).toHaveCount(0);
  });

  /*
   * The save-time guard is still a guard. Coercing "10" to 10 must not have
   * turned the range check into something a string can walk past.
   */
  test("should reject a sample percentage outside the allowed range", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    const rejectedName: string = `E2E Rejected ${Faker.generateName().toString()}`;

    await openCreateModalAndFillConditions(rejectedName);

    const form: Locator = page.locator(createFormSelector);
    const actionDropdown: Locator = form.getByRole("combobox").first();
    await actionDropdown.click();
    await page.getByRole("option", { name: "Sample", exact: true }).click();

    const percentage: Locator = form.getByLabel("Sample Percentage");
    await percentage.fill("100");

    await page.getByTestId("modal-footer-submit-button").click();

    /*
     * Rejected client-side by the field's own 1-99 range, or server-side by
     * the save hook if it ever gets past that. Either way the modal stays
     * open and no row is created — which is what this asserts, rather than
     * pinning which of the two layers spoke first.
     */
    await expect(page.getByTestId("modal")).toBeVisible({ timeout: 30000 });

    await page.getByTestId("modal-footer-close-button").click();
    await page
      .getByTestId("modal")
      .waitFor({ state: "hidden", timeout: 30000 });

    await expect(
      page.getByRole("row").filter({ hasText: rejectedName }),
    ).toHaveCount(0);
  });
});
