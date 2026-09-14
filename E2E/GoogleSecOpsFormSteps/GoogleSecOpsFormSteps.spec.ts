import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Walks the production ModelTable create modal against the offline fixture.
 * No record is submitted; all entered values are visibly synthetic.
 */
const PORT: string = "4216";
const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/security-events/connections";
const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../output/playwright/google-secops-form-steps",
);
const STEP_RAIL: Array<string> = ["Basic Info", "Google SecOps", "Polling"];
const SERVICE_ACCOUNT: string =
  '{"type":"service_account","client_email":"fixture@example.invalid","private_key":"SYNTHETIC-NOT-A-SECRET"}';

const pageErrors: Map<Page, Array<string>> = new Map();

function dialog(page: Page): Locator {
  return page.getByRole("dialog", {
    name: "Create New Google SecOps Connection",
  });
}

async function steps(page: Page): Promise<Array<string>> {
  return dialog(page)
    .locator('nav[aria-label="Progress"] li')
    .allInnerTexts()
    .then((titles: Array<string>): Array<string> => {
      return titles.map((title: string): string => {
        return title.trim();
      });
    });
}

async function expectActiveStep(page: Page, title: string): Promise<void> {
  await expect(dialog(page).locator('[aria-current="step"]')).toHaveText(title);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
}

async function fillCodeEditor(page: Page, value: string): Promise<void> {
  const modal: Locator = dialog(page);
  const editor: Locator = modal.locator(".monaco-editor").first();
  const lines: Locator = editor.locator(".view-lines");
  await expect(editor).toBeVisible({ timeout: 30000 });
  await lines.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(value);
  // Remove brackets/quotes Monaco may have auto-closed after the caret.
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Delete");
  await expect(lines).toContainText("fixture@example.invalid");
}

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", (error: Error): void => {
    pageErrors.get(page)!.push(error.message);
  });

  // A request leaving this fixture is a test failure, not a dependency.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    await route.abort();
  });

  await page.goto(ROUTE);
  await expect(
    page.getByText("Google SecOps Connections", { exact: true }).last(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create Google SecOps Connection" })
    .click();
  await expect(dialog(page)).toBeVisible();
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test("the real create modal enforces and renders all three form steps", async ({
  page,
}: {
  page: Page;
}) => {
  const modal: Locator = dialog(page);
  const next: Locator = modal.getByRole("button", {
    name: "Next",
    exact: true,
  });

  expect(await steps(page)).toEqual(STEP_RAIL);
  await expectActiveStep(page, "Basic Info");
  // ModelForm resolves field metadata after the modal shell mounts.
  await expect(modal.getByLabel("Name", { exact: true })).toBeVisible();

  // Inactive rail entries cannot skip the required first step.
  await modal.getByText("Google SecOps", { exact: true }).click();
  await modal.getByText("Polling", { exact: true }).click();
  await expectActiveStep(page, "Basic Info");
  await next.click();
  await expectActiveStep(page, "Basic Info");
  await expect(
    modal.getByText("Name is required.", { exact: true }),
  ).toBeVisible();

  // Step 1 contains only identity/scheduling state, with Enabled on by default.
  await expect(modal.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(modal.getByRole("switch", { name: /^Enabled/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(modal.getByLabel("Region", { exact: true })).toHaveCount(0);
  await expect(modal.getByLabel("Poll Interval (Minutes)")).toHaveCount(0);
  await modal
    .getByLabel("Name", { exact: true })
    .fill("Synthetic SecOps Fixture");
  await next.focus();
  await screenshot(page, "google-secops-form-step-basic-info-synthetic");
  await next.click();

  // Step 2 isolates the Google endpoint and credential fields.
  await expectActiveStep(page, "Google SecOps");
  await expect(modal.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(modal.getByLabel("Region", { exact: true })).toBeVisible();
  await expect(
    modal.getByLabel("Instance Resource Name", { exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByText("Service Account JSON", { exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("switch", { name: /^Alerts and detections/ }),
  ).toHaveCount(0);

  // Polling is still inactive, and required Google fields block Next.
  await modal.getByText("Polling", { exact: true }).click();
  await expectActiveStep(page, "Google SecOps");
  await next.click();
  await expectActiveStep(page, "Google SecOps");
  await expect(
    modal.getByText("Region is required.", { exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByText("Instance Resource Name is required.", { exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByText("Service Account JSON is required.", { exact: true }),
  ).toBeVisible();

  await modal.getByLabel("Region", { exact: true }).fill("us");
  await modal
    .getByLabel("Instance Resource Name", { exact: true })
    .fill("projects/synthetic/locations/us/instances/e2e-fixture");
  await fillCodeEditor(page, SERVICE_ACCOUNT);
  await next.focus();
  await screenshot(page, "google-secops-form-step-google-secops-synthetic");
  await next.click();

  // Step 3 contains only polling controls and preserves both production defaults.
  await expectActiveStep(page, "Polling");
  await expect(modal.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(modal.getByLabel("Region", { exact: true })).toHaveCount(0);
  await expect(
    modal.getByText("Service Account JSON", { exact: true }),
  ).toHaveCount(0);
  await expect(
    modal.getByRole("switch", { name: /^Alerts and detections/ }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(modal.getByLabel("Poll Interval (Minutes)")).toHaveValue("5");

  const create: Locator = modal.getByRole("button", {
    name: "Create Google SecOps Connection",
    exact: true,
  });
  await expect(create).toBeVisible();
  await expect(next).toHaveCount(0);
  await create.focus();
  await screenshot(page, "google-secops-form-step-polling-synthetic");

  // The fixture proves the walkthrough stopped before persistence.
  const createAttempts: number = await page.evaluate((): number => {
    return (window as unknown as { __fixture: { createAttempts: number } })
      .__fixture.createAttempts;
  });
  expect(createAttempts).toBe(0);
});
