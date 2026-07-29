import { BASE_URL } from "../../Config";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import { toId } from "./Helpers/MonitorAlerting";
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
 * https://github.com/OneUptime/oneuptime/issues/2899 - "No Save/Discard
 * confirmation after editing Probe settings - changes not actually applied",
 * end to end.
 *
 * The reporter had a global probe "Probe" and a custom probe "WBHQ", changed
 * the monitor's probe, refreshed, and found nothing had changed. Two dead ends
 * produced that:
 *
 * (A) The "Monitor Summary" card's probe picker was fed every probe in the
 *     project plus every global probe rather than the probes attached to the
 *     monitor. Selecting a probe that was not monitoring the resource answered
 *     "should be few minutes for summary to show up" about data that could
 *     never arrive - and since the list is project-probes-first, the card often
 *     opened on one. Test: attach exactly one of two custom probes, then assert
 *     the picker offers only that one.
 *
 * (B) Monitor > Probes declared a required "Probe" dropdown on an editable
 *     table whose probe relation is create-only, so ModelForm silently dropped
 *     it from the edit form and the request; and the table could not delete, so
 *     a probe attached by mistake was permanent. Test: the edit modal offers
 *     only the toggle it can actually save, that toggle persists across a
 *     reload, and the row can be removed.
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/MonitorProbeSummary.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

const monitorCreateFormSelector: string = "#create-monitor-form";
const submitButtonTestId: string = "Create Monitor";

interface SharedContext {
  page: Page;
  projectId: string;
  monitorId: string;
  attachedProbeName: string;
  attachedProbeId: string;
  unattachedProbeName: string;
  unattachedProbeId: string;
}

type ApiUrlFunction = (path: string) => string;

const apiUrl: ApiUrlFunction = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

type DashboardUrlFunction = (path: string) => string;

const dashboardUrl: DashboardUrlFunction = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

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
          description: "Seeded by the probe summary e2e spec.",
          projectId: data.projectId,
          /*
           * Off, so neither probe is attached automatically - the create form's
           * picker is what decides, and that is what this spec relies on.
           */
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

  // Ids come back as a bare string or { _type: "ObjectID", value }; normalise.
  return toId(body?.data?._id ?? body?._id);
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

test.describe("Monitor summary probe picker", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    monitorId: "",
    attachedProbeName: "",
    attachedProbeId: "",
    unattachedProbeName: "",
    unattachedProbeId: "",
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Probe Summary Project",
      /*
       * Custom probes are gated behind the Growth plan when billing is enabled
       * (TableBillingAccessControl.create on the Probe model).
       */
      preferredPlanName: "Growth",
    });

    ctx.attachedProbeName = `e2e-attached-${Faker.generateRandomString(6)}`;
    ctx.attachedProbeId = await seedCustomProbe({
      page: ctx.page,
      projectId: ctx.projectId,
      name: ctx.attachedProbeName,
    });

    ctx.unattachedProbeName = `e2e-stranger-${Faker.generateRandomString(6)}`;
    ctx.unattachedProbeId = await seedCustomProbe({
      page: ctx.page,
      projectId: ctx.projectId,
      name: ctx.unattachedProbeName,
    });

    expect(ctx.attachedProbeId).not.toEqual("");
    expect(ctx.unattachedProbeId).not.toEqual("");
  });

  test.afterAll(async () => {
    await ctx.page?.close();
  });

  test("creates a monitor watched by exactly one of the project's probes", async () => {
    test.setTimeout(180000);

    const page: Page = ctx.page;
    const monitorName: string = `e2e-summary-monitor-${Faker.generateRandomString(6)}`;

    await page.goto(
      dashboardUrl(`/dashboard/${ctx.projectId}/monitors/create`),
      {
        waitUntil: "domcontentloaded",
      },
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

    // Step 2: criteria.
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

    // Step 3: probes + interval. Clear the defaults, pick one probe only.
    const probesCombo: Locator = page.getByRole("combobox", { name: "Probes" });
    await expect(probesCombo).toBeVisible({ timeout: 60000 });
    await probesCombo.click();
    for (let clearAttempt: number = 0; clearAttempt < 6; clearAttempt++) {
      await page.keyboard.press("Backspace");
    }
    await probesCombo.fill(ctx.attachedProbeName);
    await page
      .getByRole("option", { name: ctx.attachedProbeName, exact: true })
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

    ctx.monitorId =
      page
        .url()
        .match(
          /\/monitors\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        )?.[1] || "";

    expect(ctx.monitorId).not.toEqual("");

    const monitorProbes: Array<any> = await listMonitorProbes({
      page,
      projectId: ctx.projectId,
      monitorId: ctx.monitorId,
    });

    expect(
      monitorProbes.map((monitorProbe: any) => {
        return toId(monitorProbe.probeId ?? monitorProbe.probe?._id);
      }),
    ).toEqual([ctx.attachedProbeId]);
  });

  test("the summary picker offers only the probes that monitor this resource", async () => {
    test.setTimeout(180000);

    const page: Page = ctx.page;

    await page.goto(
      dashboardUrl(`/dashboard/${ctx.projectId}/monitors/${ctx.monitorId}`),
      { waitUntil: "domcontentloaded" },
    );

    /*
     * Labelled as what it is - a filter on what the card shows - rather than
     * chromed as a required form field, which is what invited users to read
     * changing it as editing the monitor's probe.
     */
    await expect(page.getByText("Showing results from:").first()).toBeVisible({
      timeout: 90000,
    });

    /*
     * By accessible name, not by text: react-select's role="combobox" element
     * is the search <input> it renders, which has no text content at all - the
     * selected probe is painted in a sibling node - so filtering on hasText can
     * never match. The name comes from the picker's own label via
     * aria-labelledby, the same way the "Probes" combobox is addressed above.
     */
    const probeCombo: Locator = page
      .getByRole("combobox", { name: "Showing results from:" })
      .first();
    await probeCombo.click();

    // The probe that watches this monitor is offered.
    await expect(
      page.getByRole("option", { name: ctx.attachedProbeName, exact: true }),
    ).toBeVisible({ timeout: 30000 });

    /*
     * The one that does not is NOT - this is the defect. Offering it produced
     * "no summary available ... should be few minutes", which the reporter read
     * as a probe change that had not been applied.
     */
    await expect(
      page.getByRole("option", { name: ctx.unattachedProbeName, exact: true }),
    ).toHaveCount(0);

    await page.keyboard.press("Escape");
  });

  test("the probe row's edit form offers only what it can actually save", async () => {
    test.setTimeout(180000);

    const page: Page = ctx.page;

    await page.goto(
      dashboardUrl(
        `/dashboard/${ctx.projectId}/monitors/${ctx.monitorId}/probes`,
      ),
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByText(ctx.attachedProbeName).first()).toBeVisible({
      timeout: 90000,
    });

    await page
      .getByRole("button", { name: /^Edit$/ })
      .first()
      .click();

    const saveButton: Locator = page.getByRole("button", {
      name: /Save Changes/i,
    });
    await expect(saveButton).toBeVisible({ timeout: 30000 });

    /*
     * No Probe dropdown: MonitorProbe's probe relation is create-only, so
     * ModelForm dropped that field from the form and from the request with no
     * message at all. Rendering "Save Changes" over a silently missing control
     * is what the bug report describes.
     */
    await expect(page.getByRole("combobox", { name: "Probe" })).toHaveCount(0);

    // The toggle it CAN save is there.
    const enabledToggle: Locator = page.getByRole("switch", {
      name: /Enabled/i,
    });
    await expect(enabledToggle).toBeVisible({ timeout: 30000 });
    await expect(enabledToggle).toHaveAttribute("aria-checked", "true");

    await enabledToggle.click();
    await saveButton.click();

    /*
     * The modal is torn down only when the update actually succeeds
     * (BaseModelTable's onSuccess), so its disappearance is the save's
     * acknowledgement. Reloading straight after the click races the in-flight
     * PUT /api/monitor-probe/<id> and can abort it, which would fail the
     * isEnabled assertion below for the wrong reason.
     */
    await expect(saveButton).toHaveCount(0, { timeout: 60000 });

    // And it survives a reload - the actual claim in the report.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(ctx.attachedProbeName).first()).toBeVisible({
      timeout: 90000,
    });

    const monitorProbes: Array<any> = await listMonitorProbes({
      page,
      projectId: ctx.projectId,
      monitorId: ctx.monitorId,
    });

    expect(monitorProbes).toHaveLength(1);
    expect(monitorProbes[0].isEnabled).toBe(false);
  });

  test("a disabled probe is labelled instead of pretending data is on its way", async () => {
    test.setTimeout(180000);

    const page: Page = ctx.page;

    await page.goto(
      dashboardUrl(`/dashboard/${ctx.projectId}/monitors/${ctx.monitorId}`),
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByText("Showing results from:").first()).toBeVisible({
      timeout: 90000,
    });

    // The option says why it has nothing to show.
    await expect(
      page.getByText(`${ctx.attachedProbeName} (disabled)`).first(),
    ).toBeVisible({ timeout: 30000 });

    // And so does the card, rather than "should be few minutes".
    await expect(
      page.getByText(/is disabled for this monitor/).first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("a probe attached by mistake can be removed", async () => {
    test.setTimeout(180000);

    const page: Page = ctx.page;

    await page.goto(
      dashboardUrl(
        `/dashboard/${ctx.projectId}/monitors/${ctx.monitorId}/probes`,
      ),
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByText(ctx.attachedProbeName).first()).toBeVisible({
      timeout: 90000,
    });

    /*
     * The table used to set isDeleteable={false}, so with the probe relation
     * create-only there was no way at all to undo attaching the wrong probe.
     */
    await page
      .getByRole("button", { name: /^Delete$/ })
      .first()
      .click();
    /*
     * Scope the confirm to the modal. The row's Delete button matches
     * /^Delete$/ too, so .last() on the whole page silently re-clicks the row
     * whenever the query lands before React commits the modal.
     */
    const deleteConfirmModal: Locator = page.getByRole("dialog", {
      name: /Delete Monitor Probe/i,
    });
    await expect(deleteConfirmModal).toBeVisible({ timeout: 30000 });
    await deleteConfirmModal.getByRole("button", { name: /^Delete$/ }).click();

    await expect
      .poll(
        async () => {
          return (
            await listMonitorProbes({
              page,
              projectId: ctx.projectId,
              monitorId: ctx.monitorId,
            })
          ).length;
        },
        { timeout: 60000 },
      )
      .toBe(0);

    /*
     * And the monitor notices: removing the last probe has to recompute
     * Monitor.isNoProbeEnabledOnThisMonitor, which is the banner below. Without
     * the delete hook on MonitorProbeService the monitor went on claiming it
     * was being watched.
     */
    await page.goto(
      dashboardUrl(`/dashboard/${ctx.projectId}/monitors/${ctx.monitorId}`),
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByText("Probes Not Enabled").first()).toBeVisible({
      timeout: 90000,
    });
  });
});
