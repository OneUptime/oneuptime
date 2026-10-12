import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  APIResponse,
  Locator,
  Page,
  Response,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

interface WorkflowRecord {
  _id: string;
  name: string;
  isEnabled?: boolean;
}

interface WorkflowRunRecord {
  _id: string;
  isTestRun?: boolean;
  startedByUserId?: string | { value?: string } | null;
}

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

// For assertions that wait on the server; the suite's 5s default is for the screen.
const SERVER: { timeout: number } = { timeout: 30000 };

const WORKFLOW_NAME: string = "e2e-workflow-test-run-while-off";

// registerAndCreateProject's person, as a test run names them.
const PERSON_NAME: string = "E2E Test User";

// A Manual trigger on its own: Run Workflow starts it, nothing else does.
const MANUAL_TRIGGER_GRAPH: Record<string, unknown> = {
  nodes: [
    {
      id: "canvas-manual-1",
      type: "node",
      position: { x: 160, y: 64 },
      data: {
        id: "manual-1",
        internalId: "e2e-manual-1",
        nodeType: "Node",
        componentType: "Trigger",
        metadataId: "manual",
        error: "",
        arguments: {},
        returnValues: {},
      },
    },
  ],
  edges: [],
};

type ReadWorkflowFunction = (
  page: Page,
  projectId: string,
) => Promise<WorkflowRecord>;

// The workflow as the server has it, not as the page shows it.
const readWorkflow: ReadWorkflowFunction = async (
  page: Page,
  projectId: string,
): Promise<WorkflowRecord> => {
  const response: APIResponse = await page.request.post(
    urlFor("/api/workflow/get-list"),
    {
      headers: { tenantid: projectId },
      data: {
        query: { projectId, name: WORKFLOW_NAME },
        select: { _id: true, name: true, isEnabled: true },
        limit: 2,
        skip: 0,
        sort: {},
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);

  const workflows: Array<WorkflowRecord> = (
    (await response.json()) as { data: Array<WorkflowRecord> }
  ).data;
  expect(workflows).toHaveLength(1);

  return workflows[0]!;
};

type IsEnabledOnServerFunction = (
  page: Page,
  projectId: string,
) => Promise<boolean>;

const isEnabledOnServer: IsEnabledOnServerFunction = async (
  page: Page,
  projectId: string,
): Promise<boolean> => {
  return Boolean((await readWorkflow(page, projectId)).isEnabled);
};

type ReadRunsFunction = (
  page: Page,
  projectId: string,
  workflowId: string,
) => Promise<Array<WorkflowRunRecord>>;

// The workflow's runs as the server recorded them.
const readRuns: ReadRunsFunction = async (
  page: Page,
  projectId: string,
  workflowId: string,
): Promise<Array<WorkflowRunRecord>> => {
  const response: APIResponse = await page.request.post(
    urlFor("/api/workflow-log/get-list"),
    {
      headers: { tenantid: projectId },
      data: {
        query: { workflowId },
        select: { _id: true, isTestRun: true, startedByUserId: true },
        limit: 10,
        skip: 0,
        sort: {},
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);

  return ((await response.json()) as { data: Array<WorkflowRunRecord> }).data;
};

/*
 * "Run - Why do I have to enable a workflow in order to test run it? Can you
 * please fix it?" - the maintainer. The Builder used to answer Run Workflow
 * on a workflow that was off with "Turn on this workflow?", whose only way
 * forward turned it on - letting its trigger loose just to try it once.
 *
 * Against a real project and server: the Builder shows the Enabled switch and
 * a notice while the workflow is off, saying the trigger is paused and Run
 * Workflow still tests it; Run Workflow on a workflow that is off says it will
 * be a test run, runs it without turning anything on, opens the run with a
 * Test run note naming who started it, and the server records it as a test
 * run by that person; the runs list marks it; the notice's Turn on workflow
 * and the switch still change what the server stores. A temporary project
 * isolates it and is deleted even when the test fails. Growth, because
 * workflows are a Growth feature when billing is on.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/WorkflowTurnOn.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Testing a workflow that is off, and turning it on, from the Builder", () => {
  test("Run Workflow runs a workflow that is off as a test run, and the notice and the switch turn it on and off", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(300000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Workflow Test Run",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      const createResponse: APIResponse = await page.request.post(
        urlFor("/api/workflow"),
        {
          headers: { tenantid: projectId },
          data: {
            data: {
              projectId,
              name: WORKFLOW_NAME,
              graph: MANUAL_TRIGGER_GRAPH,
            },
          },
        },
      );
      expect(createResponse.ok(), await createResponse.text()).toBe(true);

      // New workflows start turned off.
      const workflow: WorkflowRecord = await readWorkflow(page, projectId);
      expect(Boolean(workflow.isEnabled)).toBe(false);

      const builderPath: string = `/dashboard/${projectId}/workflows/${workflow._id}/builder`;

      const notice: Locator = page.getByTestId("workflow-turned-off-notice");
      const enabledSwitch: Locator = page.getByRole("switch", {
        name: "Enabled",
        exact: true,
      });

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(builderPath),
        ready: notice,
      });

      /*
       * Off, said up front, in one sentence: the trigger is paused, and Run
       * Workflow - named in bold, as the toolbar names it - still tests it.
       */
      await expect(notice).toContainText("This workflow is off");
      await expect(
        notice.getByTestId("workflow-turned-off-notice-body"),
      ).toHaveText(
        "Its trigger is paused until you turn it on. You can still test it with Run Workflow.",
      );
      await expect(
        notice.locator("strong", { hasText: "Run Workflow" }),
      ).toHaveCount(1);
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");

      // Run Workflow while it is off: the panel says this will be a test run.
      await page
        .getByRole("button", { name: "Run Workflow", exact: true })
        .click();

      /*
       * The side-over's root is a zero-size wrapper around a fixed panel, so
       * Playwright never calls it visible: wait for what is inside it.
       */
      const runPanel: Locator = page.getByTestId("side-over");
      await expect(
        runPanel.getByRole("heading", { name: "Run Workflow", exact: true }),
      ).toBeVisible(SERVER);
      await expect(
        runPanel.getByTestId("workflow-run-panel-test-run-note"),
      ).toContainText("This workflow is off, so this is a test run.");

      await runPanel
        .getByTestId("side-over-footer")
        .getByRole("button", { name: "Run Workflow Manually" })
        .click();

      const confirmRun: Locator = page.getByTestId("modal").filter({
        hasText: "Are you sure you want to run this workflow manually?",
      });
      await expect(confirmRun).toBeVisible();

      const runRequest: Promise<Response> = page.waitForResponse(
        (response: Response) => {
          return (
            response.url().includes(`/workflow/manual/run/${workflow._id}`) &&
            response.request().method() === "POST"
          );
        },
        SERVER,
      );

      await confirmRun.getByTestId("modal-footer-submit-button").click();

      // Sent and accepted as it is - no dialog asks to turn the workflow on.
      expect((await runRequest).ok()).toBe(true);
      await expect(page.getByTestId("workflow-turn-on-prompt")).toHaveCount(0);
      await expect(page.getByText("Turn on this workflow?")).toHaveCount(0);

      /*
       * The run opens, and says it is a test run, started by this person -
       * on a line under the run's status, which is read first.
       */
      const runModal: Locator = page
        .getByTestId("modal")
        .filter({ hasText: "This is the run you just started." });
      await expect(runModal).toBeVisible(SERVER);
      const testRunNote: Locator = runModal.getByTestId(
        "workflow-run-test-run-note",
      );
      await expect(testRunNote).toBeVisible(SERVER);
      await expect(testRunNote).toContainText("Test run");
      await expect(testRunNote).toContainText(
        `Started by ${PERSON_NAME} while this workflow was off.`,
      );
      const statusRow: Locator = runModal.getByTestId(
        "workflow-run-status-row",
      );
      await expect(statusRow).toBeVisible();
      const statusBox: { y: number } | null = await statusRow.boundingBox();
      const noteBox: { y: number } | null = await testRunNote.boundingBox();
      expect(statusBox).not.toBeNull();
      expect(noteBox).not.toBeNull();
      expect(noteBox!.y).toBeGreaterThan(statusBox!.y);

      // Nothing was turned on.
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");
      expect(await isEnabledOnServer(page, projectId)).toBe(false);

      // The server recorded it as a test run, by a person.
      await expect
        .poll(async () => {
          const runs: Array<WorkflowRunRecord> = await readRuns(
            page,
            projectId,
            workflow._id,
          );

          return runs.map((run: WorkflowRunRecord) => {
            return {
              isTestRun: run.isTestRun === true,
              hasPerson: Boolean(run.startedByUserId),
            };
          });
        }, SERVER)
        .toEqual([{ isTestRun: true, hasPerson: true }]);

      await runModal.getByTestId("close-button").click();
      await expect(notice).toBeVisible();

      // The notice's Turn on workflow turns it on without running anything.
      await notice.getByTestId("workflow-turn-on-button").click();
      await expect(notice).toHaveCount(0, SERVER);
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
      await expect
        .poll(async () => {
          return isEnabledOnServer(page, projectId);
        }, SERVER)
        .toBe(true);
      expect(await readRuns(page, projectId, workflow._id)).toHaveLength(1);

      // On, the run panel no longer calls a run a test run.
      await page
        .getByRole("button", { name: "Run Workflow", exact: true })
        .click();
      await expect(
        runPanel.getByRole("heading", { name: "Run Workflow", exact: true }),
      ).toBeVisible(SERVER);
      await expect(
        runPanel.getByTestId("workflow-run-panel-test-run-note"),
      ).toHaveCount(0);
      await runPanel.getByTestId("close-button").click();

      // The switch turns it off again, and the notice comes back.
      await enabledSwitch.click();
      await expect(notice).toBeVisible(SERVER);
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");
      await expect
        .poll(async () => {
          return isEnabledOnServer(page, projectId);
        }, SERVER)
        .toBe(false);

      // It stays off after a full load.
      await page.reload();
      await expect(enabledSwitch).toHaveAttribute(
        "aria-checked",
        "false",
        SERVER,
      );
      await expect(notice).toBeVisible();

      // The workflow's runs list marks the test run beside its status.
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/workflows/${workflow._id}/logs`),
        ready: page.getByTestId("workflow-test-run-pill").first(),
      });
      await expect(page.getByTestId("workflow-test-run-pill")).toHaveCount(1);
      await expect(
        page.getByTestId("workflow-test-run-pill").first(),
      ).toContainText("Test run");

      // The same size as the status pill beside it, so the two read as a pair.
      const pillFontSizes: Array<string> = await page
        .getByTestId("workflow-test-run-pill")
        .first()
        .locator("xpath=..")
        .getByTestId("pill")
        .evaluateAll((pills: Array<Element>): Array<string> => {
          return pills.map((pill: Element): string => {
            return window.getComputedStyle(pill).fontSize;
          });
        });
      expect(pillFontSizes).toHaveLength(2);
      expect(pillFontSizes[0]).toBe(pillFontSizes[1]);
    } finally {
      const response: APIResponse = await page.request.delete(
        urlFor(`/api/project/${projectId}`),
        { headers: { tenantid: projectId } },
      );
      expect(response.ok(), "Temporary workflow project is deleted").toBe(true);
    }
  });
});
