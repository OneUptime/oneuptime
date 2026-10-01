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

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

// For assertions that wait on the server; the suite's 5s default is for the screen.
const SERVER: { timeout: number } = { timeout: 30000 };

const WORKFLOW_NAME: string = "e2e-workflow-turn-on";

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

/*
 * "When workflow is not enabled, it doesnt tell me how to enable this
 * workflow." - the maintainer, after running a step of a workflow that was
 * off and getting an Error dialog that said "This workflow is not enabled",
 * with only a Close button.
 *
 * Against a real project and server: the Builder shows the Enabled switch
 * and a notice while the workflow is off; Run Workflow on a workflow that is
 * off asks "Turn on this workflow?", and Turn on and run turns it on and
 * runs it; the switch and the notice's Turn on workflow change what the
 * server stores. A temporary project isolates it and is deleted even when
 * the test fails. Growth, because workflows are a Growth feature when
 * billing is on.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/WorkflowTurnOn.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Turning a workflow on from the Builder", () => {
  test("the Builder says the workflow is off, and turns it on: from the run it blocked, the notice and the switch", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(300000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Workflow Turn On",
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

      // Off, said up front, with the one thing to do about it.
      await expect(notice).toContainText("This workflow is off");
      await expect(notice).toContainText(
        "Its trigger is ignored and it can't be run or tested until you turn it on.",
      );
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");

      /*
       * Run Workflow while it is off: the run panel, its confirmation, and
       * then - instead of an Error dialog - the offer to turn it on.
       */
      await page
        .getByRole("button", { name: "Run Workflow", exact: true })
        .click();

      const runPanel: Locator = page.getByTestId("side-over");
      await expect(runPanel).toBeVisible(SERVER);
      await runPanel
        .getByTestId("side-over-footer")
        .getByRole("button", { name: "Run Workflow Manually" })
        .click();

      const confirmRun: Locator = page.getByTestId("modal").filter({
        hasText: "Are you sure you want to run this workflow manually?",
      });
      await expect(confirmRun).toBeVisible();
      await confirmRun.getByTestId("modal-footer-submit-button").click();

      const prompt: Locator = page
        .getByTestId("modal")
        .filter({ has: page.getByTestId("workflow-turn-on-prompt") });
      await expect(prompt).toBeVisible(SERVER);
      await expect(prompt).toContainText("Turn on this workflow?");
      await expect(prompt).toContainText(
        "This workflow is off, so it can't run. Turn it on to run it now.",
      );
      await expect(prompt).toContainText(
        "You can turn it off again with the Enabled switch above the canvas.",
      );
      await expect(page.getByText("This workflow is not enabled")).toHaveCount(
        0,
      );

      // Nothing has been changed or sent yet.
      expect(await isEnabledOnServer(page, projectId)).toBe(false);

      const turnOnAndRun: Locator = prompt.getByTestId(
        "modal-footer-submit-button",
      );
      await expect(turnOnAndRun).toHaveText("Turn on and run");

      const runRequest: Promise<Response> = page.waitForResponse(
        (response: Response) => {
          return (
            response.url().includes(`/workflow/manual/run/${workflow._id}`) &&
            response.request().method() === "POST"
          );
        },
        SERVER,
      );

      await turnOnAndRun.click();

      // Turned on, then run: the run the user asked for opens.
      expect((await runRequest).ok()).toBe(true);
      await expect(
        page.getByText("This is the run you just started."),
      ).toBeVisible(SERVER);
      await expect(notice).toHaveCount(0);
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
      expect(await isEnabledOnServer(page, projectId)).toBe(true);

      await page
        .getByTestId("modal")
        .filter({ hasText: "This is the run you just started." })
        .getByTestId("close-button")
        .click();

      // The switch turns it off again, and the notice comes back.
      await enabledSwitch.click();
      await expect(notice).toBeVisible(SERVER);
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");
      await expect
        .poll(async () => {
          return isEnabledOnServer(page, projectId);
        }, SERVER)
        .toBe(false);

      // The notice's Turn on workflow turns it on without running anything.
      await notice.getByTestId("workflow-turn-on-button").click();
      await expect(notice).toHaveCount(0, SERVER);
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
      await expect
        .poll(async () => {
          return isEnabledOnServer(page, projectId);
        }, SERVER)
        .toBe(true);

      // It stays on after a full load.
      await page.reload();
      await expect(enabledSwitch).toHaveAttribute(
        "aria-checked",
        "true",
        SERVER,
      );
      await expect(notice).toHaveCount(0);
    } finally {
      const response: APIResponse = await page.request.delete(
        urlFor(`/api/project/${projectId}`),
        { headers: { tenantid: projectId } },
      );
      expect(response.ok(), "Temporary workflow project is deleted").toBe(true);
    }
  });
});
