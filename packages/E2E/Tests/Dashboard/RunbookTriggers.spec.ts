import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

interface RunbookRecord {
  _id: string;
  isScheduleEnabled?: boolean;
  scheduleCron?: string | null;
  scheduleTimezone?: string | null;
  isWebhookEnabled?: boolean;
}

interface RunRecord {
  _id: string;
  triggerType?: string | null;
  inputs?: Record<string, unknown> | null;
}

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

// For assertions that wait on the server; the suite's 5s default is for the screen.
const SERVER: { timeout: number } = { timeout: 30000 };

const RUNBOOK_NAME: string = "e2e-runbook-triggers";

// One manual step: a run starts, and waits for someone to tick it off.
const STEPS: Array<Record<string, unknown>> = [
  {
    id: "c1f2a3b4-0000-4000-8000-00000000e2e1",
    order: 1,
    type: "Manual",
    title: "Check the web tier",
    config: {},
  },
];

type ReadRunbookFunction = (
  page: Page,
  projectId: string,
) => Promise<RunbookRecord>;

// The runbook as the server has it, not as the page shows it.
const readRunbook: ReadRunbookFunction = async (
  page: Page,
  projectId: string,
): Promise<RunbookRecord> => {
  const response: APIResponse = await page.request.post(
    urlFor("/api/runbook/get-list"),
    {
      headers: { tenantid: projectId },
      data: {
        query: { projectId, name: RUNBOOK_NAME },
        select: {
          _id: true,
          isScheduleEnabled: true,
          scheduleCron: true,
          scheduleTimezone: true,
          isWebhookEnabled: true,
        },
        limit: 2,
        skip: 0,
        sort: {},
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);

  const runbooks: Array<RunbookRecord> = (
    (await response.json()) as { data: Array<RunbookRecord> }
  ).data;
  expect(runbooks).toHaveLength(1);

  return runbooks[0]!;
};

type ReadRunsFunction = (
  page: Page,
  projectId: string,
  runbookId: string,
  triggerType: string,
) => Promise<Array<RunRecord>>;

// The runbook's runs a trigger started, as the server recorded them.
const readRuns: ReadRunsFunction = async (
  page: Page,
  projectId: string,
  runbookId: string,
  triggerType: string,
): Promise<Array<RunRecord>> => {
  const response: APIResponse = await page.request.post(
    urlFor("/api/runbook-execution/get-list"),
    {
      headers: { tenantid: projectId },
      data: {
        query: { runbookId, triggerType },
        select: { _id: true, triggerType: true, inputs: true },
        limit: 10,
        skip: 0,
        sort: {},
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);

  return ((await response.json()) as { data: Array<RunRecord> }).data;
};

/*
 * "Can you build an option that can help me execute Runbook with a webhook
 * or on schedule?" - the maintainer.
 *
 * Against a real project and server: a runbook's Triggers page (in its side
 * menu's Settings section, folded until opened) sets up a schedule through
 * its dialog, the server
 * stores its cron and zone, and the Worker starts a run on it within a
 * couple of minutes, recorded as started by the schedule; pausing it is the
 * switch alone. The webhook's switch gives the runbook a URL, shown masked
 * until asked for; a POST to it starts a run that carries the values sent,
 * a GET starts nothing, a wrong key is not found, and a runbook that is
 * turned off refuses it in words. A temporary project isolates it and is
 * deleted even when the test fails. Growth, as the other runbook suites.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/RunbookTriggers.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Running a runbook on a schedule or from a webhook", () => {
  test("a schedule set up on the Triggers page starts runs, and the webhook URL starts one with what it is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The Worker starts scheduled runs once a minute.
    test.setTimeout(480000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Runbook Triggers",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      const createResponse: APIResponse = await page.request.post(
        urlFor("/api/runbook"),
        {
          headers: { tenantid: projectId },
          data: {
            data: {
              projectId,
              name: RUNBOOK_NAME,
              isEnabled: true,
              steps: STEPS,
            },
          },
        },
      );
      expect(createResponse.ok(), await createResponse.text()).toBe(true);

      const runbook: RunbookRecord = await readRunbook(page, projectId);
      // Nothing starts it on its own until a trigger is set up.
      expect(Boolean(runbook.isScheduleEnabled)).toBe(false);
      expect(Boolean(runbook.isWebhookEnabled)).toBe(false);

      const runbookPath: string = `/dashboard/${projectId}/runbooks/${runbook._id}`;
      const scheduleCard: Locator = page.getByTestId("runbook-schedule-card");
      const sideMenu: Locator = page.locator(
        "aside[role='navigation'][aria-label='Main navigation']",
      );
      // A section's toggle, by its heading's text (drawn in capitals by CSS).
      const settingsSection: Locator = sideMenu.locator(
        "xpath=.//h6[normalize-space(.)='Settings']/ancestor::button[1]",
      );
      const triggersLink: Locator = sideMenu.locator(
        `a[href='${runbookPath}/triggers']`,
      );

      /*
       * The runbook's menu keeps Triggers in its Settings section, folded
       * until it is opened: on the Overview only Basic is open.
       */
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(runbookPath),
        ready: settingsSection,
      });
      await expect(settingsSection).toHaveAttribute("aria-expanded", "false");
      await expect(triggersLink).toBeHidden();
      await settingsSection.click();
      await expect(settingsSection).toHaveAttribute("aria-expanded", "true");
      await triggersLink.click();
      await expect(page).toHaveURL(urlFor(`${runbookPath}/triggers`), SERVER);
      await expect(
        page.getByRole("navigation", { name: "Breadcrumb" }),
      ).toContainText("Triggers");
      await expect(
        scheduleCard.getByTestId("runbook-schedule-empty"),
      ).toBeVisible(SERVER);

      /*
       * Set Up Schedule: every minute, so the Worker starts a run while
       * the test waits.
       */
      await scheduleCard
        .getByRole("button", { name: "Set Up Schedule" })
        .click();
      const modal: Locator = page.getByTestId("modal");
      await expect(modal).toBeVisible();
      await modal.getByRole("combobox", { name: "Repeat" }).click();
      await page
        .getByRole("option", { name: "Every few minutes", exact: true })
        .click();
      await modal.getByRole("combobox", { name: "Every" }).click();
      await page.getByRole("option", { name: "1 minute", exact: true }).click();
      await expect(modal.getByTestId("runbook-schedule-preview")).toContainText(
        "Runs every minute",
      );
      await modal.getByRole("button", { name: "Save Schedule" }).click();
      await expect(modal).toBeHidden(SERVER);

      await expect(page.getByTestId("runbook-schedule-switch")).toHaveAttribute(
        "aria-checked",
        "true",
        SERVER,
      );
      await expect(scheduleCard).toContainText("Runs every minute", SERVER);

      const scheduled: RunbookRecord = await readRunbook(page, projectId);
      expect(scheduled.isScheduleEnabled).toBe(true);
      expect(scheduled.scheduleCron).toBeTruthy();
      expect(scheduled.scheduleTimezone).toBeTruthy();

      // The Worker starts a run on it, recorded as started by the schedule.
      await expect
        .poll(
          async () => {
            return (await readRuns(page, projectId, runbook._id, "Schedule"))
              .length;
          },
          { timeout: 240000, intervals: [5000] },
        )
        .toBeGreaterThan(0);

      // Pausing it is the switch alone; the schedule itself is kept.
      await page.getByTestId("runbook-schedule-switch").click();
      await expect(scheduleCard).toContainText(
        "Paused. Nothing runs on this schedule until you turn it on.",
        SERVER,
      );
      await expect
        .poll(async () => {
          return (await readRunbook(page, projectId)).isScheduleEnabled;
        }, SERVER)
        .toBe(false);
      expect((await readRunbook(page, projectId)).scheduleCron).toBe(
        scheduled.scheduleCron,
      );

      // The webhook: its switch gives the runbook a URL, masked until shown.
      await page.getByTestId("runbook-webhook-switch").click();
      const url: Locator = page.getByTestId("runbook-webhook-url");
      await expect(url).toBeVisible(SERVER);
      await expect(url).toHaveAttribute("data-url-shown", "false");
      await page.getByTestId("runbook-webhook-url-visibility").click();
      await expect(url).toHaveAttribute("data-url-shown", "true");

      const shownUrl: string = ((await url.textContent()) || "").trim();
      expect(shownUrl).toMatch(
        new RegExp(`/runbook/webhook/${runbook._id}/[A-Za-z0-9_-]{43}$`),
      );
      // Called at this stack's address, whatever host the page names.
      const webhookPath: string = shownUrl.slice(
        shownUrl.indexOf("/runbook/webhook/"),
      );

      // A GET starts nothing: a link preview cannot run it.
      const getResponse: APIResponse = await page.request.get(
        urlFor(webhookPath),
      );
      expect(getResponse.status()).toBe(405);

      // A wrong key is not found, as if there were no such runbook.
      const wrongResponse: APIResponse = await page.request.post(
        urlFor(
          `${webhookPath.slice(0, webhookPath.lastIndexOf("/"))}/${"x".repeat(43)}`,
        ),
        { data: { host: "web-1" } },
      );
      expect(wrongResponse.status()).toBe(404);

      // A POST starts a run that carries what it was sent, as data.
      const postResponse: APIResponse = await page.request.post(
        urlFor(webhookPath),
        { data: { host: "web-1", reason: "Disk almost full" } },
      );
      expect(postResponse.ok(), await postResponse.text()).toBe(true);
      const started: { runbookExecutionId?: string } =
        (await postResponse.json()) as { runbookExecutionId?: string };
      expect(started.runbookExecutionId).toBeTruthy();

      const webhookRuns: Array<RunRecord> = await readRuns(
        page,
        projectId,
        runbook._id,
        "Webhook",
      );
      expect(webhookRuns).toHaveLength(1);
      expect(webhookRuns[0]!._id).toBe(started.runbookExecutionId);
      expect(webhookRuns[0]!.inputs).toEqual({
        host: "web-1",
        reason: "Disk almost full",
      });

      // Its page says the webhook started it, and shows what it was sent.
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`${runbookPath}/executions/${started.runbookExecutionId}`),
        ready: page.getByTestId("runbook-run-trigger"),
      });
      await expect(page.getByTestId("runbook-run-trigger")).toContainText(
        "Webhook",
      );
      await expect(page.getByTestId("runbook-run-inputs")).toContainText(
        '"reason": "Disk almost full"',
      );
      // A run's page opens the menu's folded Logs section by itself, at Executions.
      await expect(
        sideMenu.locator(`a[href='${runbookPath}/executions']`),
      ).toBeVisible();

      // A runbook that is turned off refuses the call, saying so.
      const offResponse: APIResponse = await page.request.put(
        urlFor(`/api/runbook/${runbook._id}`),
        {
          headers: { tenantid: projectId },
          data: { data: { isEnabled: false } },
        },
      );
      expect(offResponse.ok(), await offResponse.text()).toBe(true);

      const refused: APIResponse = await page.request.post(
        urlFor(webhookPath),
        { data: { host: "web-1" } },
      );
      expect(refused.status()).toBe(403);
      expect(await refused.text()).toContain("turned off");
      expect(
        await readRuns(page, projectId, runbook._id, "Webhook"),
      ).toHaveLength(1);
    } finally {
      const response: APIResponse = await page.request.delete(
        urlFor(`/api/project/${projectId}`),
        { headers: { tenantid: projectId } },
      );
      expect(response.ok(), "Temporary runbook project is deleted").toBe(true);
    }
  });
});
