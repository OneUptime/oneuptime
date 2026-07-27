import { BASE_URL } from "../../Config";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";

/*
 * Two probe regressions, end to end.
 *
 * (A) Creating a monitor had no probe step. Probes were attached afterwards -
 *     every probe flagged "auto enable on new monitors" - so a project with a
 *     global probe and a custom probe could not say which one should watch a
 *     given resource. Test: create a Website monitor selecting ONLY the custom
 *     probe, then read /api/monitor-probe back and assert the global probe is
 *     not attached.
 *
 * (B) Editing a probe looked like it did nothing: the Probe Details form was a
 *     two-step wizard whose primary button read "Next", so a user who changed
 *     a field on step one never saw a Save button. Test: toggle "enable
 *     monitoring automatically on new monitors" from the card, save, reload,
 *     and assert the card shows the new value.
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/MonitorProbeSelection.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

const monitorCreateFormSelector: string = "#create-monitor-form";
const submitButtonTestId: string = "Create Monitor";
const autoEnableToggleName: RegExp =
  /Enable monitoring automatically on new monitors/i;

interface SharedContext {
  page: Page;
  projectId: string;
  customProbeName: string;
  customProbeId: string;
}

type ApiUrlFunction = (path: string) => string;

const apiUrl: ApiUrlFunction = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

/*
 * Creates a custom probe through the CRUD API with the authenticated browser
 * session (page.request shares the login cookies). Deliberately created with
 * the auto-enable flag OFF so test (B) has something to turn on, and so test
 * (A) proves the picker - not the flag - is what attached it.
 */
type SeedCustomProbeFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
}) => Promise<string>;

const seedCustomProbe: SeedCustomProbeFunction = async (data: {
  page: Page;
  projectId: string;
  name: string;
}): Promise<string> => {
  const response: APIResponse = await data.page.request.post(
    apiUrl("/api/probe"),
    {
      headers: {
        "content-type": "application/json",
        tenantid: data.projectId,
      },
      data: {
        data: {
          name: data.name,
          description: "Seeded by the probe selection e2e spec.",
          projectId: data.projectId,
          shouldAutoEnableProbeOnNewMonitors: false,
        },
      },
    },
  );

  expect(
    response.ok(),
    `Seed custom probe failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);

  const body: any = await response.json();

  return (body?.data?._id || body?._id || "").toString();
};

type ListMonitorProbesFunction = (data: {
  page: Page;
  projectId: string;
  monitorId: string;
}) => Promise<Array<any>>;

const listMonitorProbes: ListMonitorProbesFunction = async (data: {
  page: Page;
  projectId: string;
  monitorId: string;
}): Promise<Array<any>> => {
  const response: APIResponse = await data.page.request.post(
    apiUrl("/api/monitor-probe/get-list"),
    {
      headers: {
        "content-type": "application/json",
        tenantid: data.projectId,
      },
      data: {
        query: { monitorId: data.monitorId, projectId: data.projectId },
        select: { probeId: true, isEnabled: true },
        limit: 50,
        skip: 0,
        sort: {},
      },
    },
  );

  expect(
    response.ok(),
    `List monitor probes failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);

  const body: any = await response.json();

  return (body?.data || []) as Array<any>;
};

test.describe("Monitor probe selection", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    customProbeName: "",
    customProbeId: "",
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Probe Selection Project",
    });

    ctx.customProbeName = `e2e-probe-${Faker.generateRandomString(6)}`;
    ctx.customProbeId = await seedCustomProbe({
      page: ctx.page,
      projectId: ctx.projectId,
      name: ctx.customProbeName,
    });

    expect(ctx.customProbeId).not.toEqual("");
  });

  test.afterAll(async () => {
    await ctx.page?.close();
  });

  test("the create form offers a probe picker and attaches exactly what was picked", async () => {
    test.setTimeout(180000);

    const page: Page = ctx.page;
    const monitorName: string = `e2e-probe-monitor-${Faker.generateRandomString(6)}`;

    await page.goto(
      apiUrl(`/dashboard/${ctx.projectId}/monitors/create`).replace(
        "/api/",
        "/",
      ),
      { waitUntil: "domcontentloaded" },
    );
    await page
      .locator(monitorCreateFormSelector)
      .waitFor({ state: "visible", timeout: 60000 });

    // Step 1: name + type.
    await page
      .locator(`${monitorCreateFormSelector} input[placeholder='Monitor Name']`)
      .fill(monitorName);
    const card: Locator = page.getByTestId("card-select-option-Website");
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.click();
    await page.getByTestId(submitButtonTestId).click();

    // Step 2: criteria. Wait for the async defaults, then fill the URL.
    await expect(page.getByText("Monitor Criteria").first()).toBeVisible({
      timeout: 60000,
    });
    const destination: Locator = page
      .locator(monitorCreateFormSelector)
      .getByRole("textbox")
      .first();
    await destination.waitFor({ state: "visible", timeout: 30000 });
    await destination.fill("https://oneuptime.com");
    await page.getByTestId(submitButtonTestId).click();

    // Step 3: probes + interval.
    const probesCombo: Locator = page.getByRole("combobox", {
      name: "Probes",
    });
    await expect(probesCombo).toBeVisible({ timeout: 60000 });

    /*
     * The picker starts on the set the server would have attached on its own,
     * which on a fresh project is the global probe.
     */
    await expect(page.getByText("Probe", { exact: true }).first()).toBeVisible({
      timeout: 30000,
    });

    // Replace the default selection with only the custom probe.
    await probesCombo.click();
    await page.keyboard.press("Backspace");
    await probesCombo.fill(ctx.customProbeName);
    await page
      .getByRole("option", { name: ctx.customProbeName, exact: true })
      .click();

    const intervalCombo: Locator = page.getByRole("combobox", {
      name: "Monitoring Interval",
    });
    await intervalCombo.click();
    await page
      .getByRole("option", { name: "Every 5 Minutes", exact: true })
      .click();

    await page.getByTestId(submitButtonTestId).click();

    await page.waitForURL(
      new RegExp(
        `/dashboard/${ctx.projectId}/monitors/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`,
        "i",
      ),
      { timeout: 120000 },
    );

    const monitorId: string =
      page
        .url()
        .match(
          /\/monitors\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        )?.[1] || "";

    expect(monitorId).not.toEqual("");

    const monitorProbes: Array<any> = await listMonitorProbes({
      page,
      projectId: ctx.projectId,
      monitorId,
    });

    const probeIds: Array<string> = monitorProbes.map((monitorProbe: any) => {
      return (monitorProbe.probeId || monitorProbe.probe?._id || "").toString();
    });

    /*
     * The whole point of the picker: exactly the chosen probe, and none of the
     * probes that would have been attached automatically.
     */
    expect(probeIds).toEqual([ctx.customProbeId]);
  });

  test("editing a probe shows a Save button, persists, and shows the new value", async () => {
    test.setTimeout(180000);

    const page: Page = ctx.page;

    const probeViewUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(
        `/dashboard/${ctx.projectId}/monitors/settings/probes/${ctx.customProbeId}`,
      )
      .toString();

    await page.goto(probeViewUrl, { waitUntil: "domcontentloaded" });

    // The card shows the flag it edits, so a save is observable.
    await expect(
      page.getByText("Enable Monitoring on New Monitors").first(),
    ).toBeVisible({ timeout: 60000 });

    await page.getByRole("button", { name: /Edit Probe/i }).click();

    /*
     * A one-page form: the primary button is a real Save, not a "Next" that
     * hides the save behind another step.
     */
    const saveButton: Locator = page.getByRole("button", {
      name: /Save Changes/i,
    });
    await expect(saveButton).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("button", { name: /^Next$/ })).toHaveCount(0);

    const toggle: Locator = page.getByRole("switch", {
      name: autoEnableToggleName,
    });
    await expect(toggle).toBeVisible({ timeout: 30000 });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();

    await saveButton.click();

    // An explicit confirmation, rather than a modal that just disappears.
    await expect(page.getByText("Changes saved").first()).toBeVisible({
      timeout: 30000,
    });

    // And it survives a reload - the actual bug report.
    await page.reload({ waitUntil: "domcontentloaded" });

    const detailRow: Locator = page
      .locator("div")
      .filter({ hasText: /^Enable Monitoring on New Monitors$/ })
      .first();
    await expect(detailRow).toBeVisible({ timeout: 60000 });

    await expect(
      page.getByText("Enable Monitoring on New Monitors").locator("xpath=.."),
    ).toContainText("Yes", { timeout: 30000 });
  });
});
