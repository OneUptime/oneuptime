import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import {
  BUNDLED_GLOBAL_RUNNER_DESCRIPTION,
  BUNDLED_GLOBAL_RUNNER_ID,
} from "Common/Types/Runner/BundledGlobalRunner";
import {
  RunnerChoiceRefusal,
  describeRunnerChoiceRefusal,
} from "Common/Types/Runner/RunnerChoice";

interface GlobalRunnerRecord {
  _id: string;
}

interface StepExecutionRecord {
  status?: string;
  output?: string;
  errorMessage?: string;
}

interface RunRecord {
  _id: string;
  status?: string;
  stepExecutions?: Array<StepExecutionRecord>;
}

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

// For assertions that wait on the server; the suite's 5s default is for the screen.
const SERVER: { timeout: number } = { timeout: 30000 };

const RUNBOOK_NAME: string = "e2e-global-runners";

/*
 * One JavaScript step that picks no Runner, as the Steps page saves it when
 * its Runner dropdown is left on Global Runner. From inside the global
 * Runner's sandbox it asks for the app container itself (on the Compose
 * network the global Runner sits in), a private address and a cloud
 * metadata endpoint, and returns what each said, with a sum to show it ran.
 */
const SCRIPT: string = [
  "const tries = {};",
  'for (const url of ["http://app:3002/", "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/"]) {',
  "  try {",
  "    const response = await axios.get(url, { timeout: 5000 });",
  '    tries[url] = "reached " + response.status;',
  "  } catch (error) {",
  '    tries[url] = "refused: " + (error && error.message ? error.message : String(error));',
  "  }",
  "}",
  'console.log("ran on a global Runner");',
  "return { sum: 40 + 2, tries };",
].join("\n");

const STEPS: Array<Record<string, unknown>> = [
  {
    id: "c1f2a3b4-0000-4000-8000-00000000e2f1",
    order: 1,
    type: "JavaScript",
    title: "Ask from a global Runner",
    config: { script: SCRIPT, agentId: "" },
  },
];

const FINISHED: Array<string> = ["Completed", "Failed", "Cancelled"];

type ReadGlobalRunnersFunction = (
  page: Page,
  projectId: string,
) => Promise<Array<GlobalRunnerRecord>>;

// The global Runners as every project reads them.
const readGlobalRunners: ReadGlobalRunnersFunction = async (
  page: Page,
  projectId: string,
): Promise<Array<GlobalRunnerRecord>> => {
  const response: APIResponse = await page.request.post(
    urlFor("/api/runner/global-runners"),
    {
      headers: { tenantid: projectId },
      data: { query: {}, select: { _id: true }, limit: 50, skip: 0, sort: {} },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);

  return ((await response.json()) as { data: Array<GlobalRunnerRecord> }).data;
};

type RunRunbookFunction = (
  page: Page,
  projectId: string,
  runbookId: string,
) => Promise<string>;

// Run Now, as the runbook's Overview presses it.
const runRunbook: RunRunbookFunction = async (
  page: Page,
  projectId: string,
  runbookId: string,
): Promise<string> => {
  const response: APIResponse = await page.request.post(
    urlFor(`/runbook/run/${runbookId}`),
    { headers: { tenantid: projectId }, data: {} },
  );
  expect(response.ok(), await response.text()).toBe(true);

  const runId: string | undefined = (
    (await response.json()) as { runbookExecutionId?: string }
  ).runbookExecutionId;
  expect(runId).toBeTruthy();

  return runId!;
};

type WaitForRunFunction = (
  page: Page,
  projectId: string,
  runId: string,
) => Promise<RunRecord>;

// The run once it has finished, as the server recorded it.
const waitForRun: WaitForRunFunction = async (
  page: Page,
  projectId: string,
  runId: string,
): Promise<RunRecord> => {
  let run: RunRecord | undefined = undefined;

  await expect
    .poll(
      async (): Promise<string> => {
        const response: APIResponse = await page.request.post(
          urlFor("/api/runbook-execution/get-list"),
          {
            headers: { tenantid: projectId },
            data: {
              query: { _id: runId },
              select: { _id: true, status: true, stepExecutions: true },
              limit: 1,
              skip: 0,
              sort: {},
            },
          },
        );
        expect(response.ok(), await response.text()).toBe(true);
        run = ((await response.json()) as { data: Array<RunRecord> }).data[0];
        return run?.status || "";
      },
      { timeout: 120000, intervals: [2000] },
    )
    .toMatch(new RegExp(`^(?:${FINISHED.join("|")})$`));

  return run!;
};

/*
 * "Please also show global runners here as well, and people can create
 * custom runners if they want more security. Global runners are enabled by
 * default. Just like we do for probes" - the maintainer.
 *
 * Against a real server that runs the bundled global Runner, as every Docker
 * Compose install does (the SaaS e2e stack turns it off, and this skips
 * there): a new project's Runbooks → Runners lists it under Global Runners,
 * connected, above Custom Runners and the switch that is on by default. A
 * runbook whose JavaScript step picks no Runner runs on it: the step returns
 * what its script returned, and from the global Runner's sandbox the app
 * container, a private address and a cloud metadata endpoint are all
 * refused. With Use global Runners turned off, the same step fails, saying
 * why and what to do. A temporary project isolates it and is deleted even
 * when the test fails.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/GlobalRunners.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Global Runners", () => {
  test("a JavaScript step that picks no Runner runs on the bundled global Runner, which reaches the internet only", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(420000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Global Runners",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      const globalRunners: Array<GlobalRunnerRecord> = await readGlobalRunners(
        page,
        projectId,
      );
      test.skip(
        !globalRunners.some((runner: GlobalRunnerRecord): boolean => {
          return runner._id === BUNDLED_GLOBAL_RUNNER_ID;
        }),
        "This stack runs no bundled global Runner (the SaaS overlay turns it off).",
      );

      const runnersPath: string = `/dashboard/${projectId}/runbooks/runners`;
      const headings: Locator = page.getByTestId("card-details-heading");
      const bundledRow: Locator = page
        .getByRole("row")
        .filter({ hasText: BUNDLED_GLOBAL_RUNNER_DESCRIPTION });
      const useGlobalRunners: Locator = page.getByTestId(
        "use-global-runners-switch",
      );

      /*
       * Runbooks → Runners: the global Runners first, read-only, then the
       * project's own, then the switch. The bundled one is connected once it
       * has sent a heartbeat (every minute), which on a fresh stack can take
       * a moment.
       */
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(runnersPath),
        ready: bundledRow,
      });
      await expect
        .poll(
          async (): Promise<string> => {
            await page.reload();
            await bundledRow.waitFor({ state: "visible", timeout: 30000 });
            return await bundledRow.innerText();
          },
          { timeout: 180000, intervals: [5000] },
        )
        .toContain("Connected");
      await expect(bundledRow).not.toContainText("Disconnected");

      await expect(
        headings.filter({ hasText: /^Global Runners$/ }),
      ).toBeVisible();
      await expect(
        headings.filter({ hasText: /^Custom Runners$/ }),
      ).toBeVisible();
      // The project has none yet: one plain line says why to add one.
      await expect(page.getByTestId("table-empty-state-title")).toHaveText(
        /^Add a Runner of your own\.?$/,
      );
      await expect(page.getByText("No Runners yet")).toHaveCount(0);
      // Nobody in a project edits, deletes or creates a global Runner.
      await expect(
        bundledRow.getByRole("button", { name: /Delete|Edit/ }),
      ).toHaveCount(0);
      await expect(useGlobalRunners).toHaveAttribute("aria-checked", "true");

      // A runbook whose one JavaScript step picks no Runner.
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
      const runbookId: string = (
        (await createResponse.json()) as { _id: string }
      )._id;
      expect(runbookId).toBeTruthy();

      /*
       * Its Steps page says the step runs on Global Runner: on the folded
       * step's line, on its folded More fields line, and - in the Runner
       * dropdown under those More fields - that a global Runner is
       * connected.
       */
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/runbooks/${runbookId}/steps`),
        ready: page.getByText("Ask from a global Runner").first(),
      });
      const stepHeader: Locator = page
        .getByTestId("runbook-step-header")
        .filter({ hasText: "Ask from a global Runner" });
      await expect(stepHeader).toContainText(
        "JavaScript on Global Runner",
        SERVER,
      );
      await stepHeader.getByRole("button", { expanded: false }).click();

      const stepMoreFields: Locator = page.getByTestId(
        "runbook-step-0-more-fields",
      );
      const stepMoreFieldsHeader: Locator = stepMoreFields.getByTestId(
        "folded-section-header",
      );
      await expect(
        stepMoreFields.locator(
          '[data-testid="folded-section-item"][data-item-key="runner"]',
        ),
      ).toHaveText("Runner: Global Runner");
      await stepMoreFieldsHeader.click();
      await expect(stepMoreFieldsHeader).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(
        stepMoreFields.getByText(/Global Runner · Connected/).first(),
      ).toBeVisible(SERVER);

      // It runs there, and nothing outside the internet answers it.
      const run: RunRecord = await waitForRun(
        page,
        projectId,
        await runRunbook(page, projectId, runbookId),
      );
      const step: StepExecutionRecord = run.stepExecutions?.[0] || {};
      expect({
        run: run.status,
        step: step.status,
        error: step.errorMessage,
      }).toEqual({ run: "Completed", step: "Completed", error: undefined });

      const output: string = step.output || "";
      expect(output).toContain("ran on a global Runner");
      expect(output).toContain('"sum": 42');
      expect(output).toContain("Global Runners reach the internet only");
      expect(output).not.toMatch(/": "reached /);
      expect(output.match(/": "refused: /g) || []).toHaveLength(3);

      /*
       * Use global Runners off: asked first, then saved. The same step now
       * fails, saying why and what to do.
       */
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(runnersPath),
        ready: useGlobalRunners,
      });
      await useGlobalRunners.click();
      const modal: Locator = page.getByTestId("modal");
      await expect(modal).toContainText("Stop using global Runners?");
      await modal.getByTestId("modal-footer-submit-button").click();
      await expect(useGlobalRunners).toHaveAttribute(
        "aria-checked",
        "false",
        SERVER,
      );

      const refusedRun: RunRecord = await waitForRun(
        page,
        projectId,
        await runRunbook(page, projectId, runbookId),
      );
      expect({
        run: refusedRun.status,
        error: refusedRun.stepExecutions?.[0]?.errorMessage,
      }).toEqual({
        run: "Failed",
        error: describeRunnerChoiceRefusal({
          refusal: RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff,
          stepType: "JavaScript",
        }),
      });
    } finally {
      const response: APIResponse = await page.request.delete(
        urlFor(`/api/project/${projectId}`),
        { headers: { tenantid: projectId } },
      );
      expect(response.ok(), "Temporary Global Runners project is deleted").toBe(
        true,
      );
    }
  });
});
