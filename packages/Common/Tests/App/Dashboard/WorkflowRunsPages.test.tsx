import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The two run pages - every run in the project (Workflows → Logs → Runs) and
 * one workflow's runs (a workflow's Logs → Runs) - are called "Runs" in the
 * menu, so the pages say runs too: the card is titled "Runs", its line says
 * what the list holds, and the row count reads "workflow runs" rather than
 * the model's own name, "Workflow Logs".
 *
 * The real pages are rendered, with a project admin's permissions and two
 * runs (or none) behind ModelAPI.
 *
 * Each run can be downloaded - its log as text or the whole run as JSON -
 * from its row's ⋯ menu and from the run's own modal. The browser's download
 * is replaced by a recorder of what would be saved.
 */

interface RecordedListCall {
  tableName: string;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}

const listCalls: Array<RecordedListCall> = [];
let runsForTest: Array<unknown> = [];

interface DownloadCall {
  content: Blob | string;
  filename: string;
  mimeType?: string | undefined;
}

const mockDownloads: Array<DownloadCall> = [];

jest.mock("../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (data: DownloadCall): void => {
      mockDownloads.push(data);
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["ProjectAdmin"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

// Runs for the run table; nothing for anything else the page asks about.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (data: {
        modelType: new () => { tableName?: string };
        query: Record<string, unknown>;
        select: Record<string, unknown>;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        const tableName: string = new data.modelType().tableName || "";
        listCalls.push({ tableName, query: data.query, select: data.select });

        if (tableName === "WorkflowLog") {
          return {
            data: runsForTest,
            count: runsForTest.length,
            skip: 0,
            limit: 10,
          };
        }

        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import AllWorkflowRunsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Logs";
import OneWorkflowRunsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Logs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import WorkflowStatus from "../../../Types/Workflow/WorkflowStatus";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const WORKFLOW_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const WORKFLOWS_PATH: string = `/dashboard/${PROJECT_ID}/workflows`;

function run(id: string, status: WorkflowStatus): WorkflowLog {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID;
  workflow.name = "Nightly sync";

  const log: WorkflowLog = new WorkflowLog();
  log._id = id;
  log.workflowId = new ObjectID(WORKFLOW_ID);
  log.workflow = workflow;
  log.workflowStatus = status;
  log.logs = `Run ${id} log line`;
  log.createdAt = new Date("2026-09-30T10:00:00.000Z");
  log.startedAt = new Date("2026-09-30T10:00:01.000Z");
  log.completedAt = new Date("2026-09-30T10:00:03.000Z");
  return log;
}

const TWO_RUNS: Array<WorkflowLog> = [
  run("0193c0de-1111-4aaa-8bbb-000000000001", WorkflowStatus.Success),
  run("0193c0de-2222-4aaa-8bbb-000000000002", WorkflowStatus.Error),
];

interface RunPage {
  name: string;
  path: string;
  pageKey: PageMap;
  render: () => React.ReactElement;
  description: string;
  emptySentence: string;
}

function pageProps(pageKey: PageMap): PageComponentProps {
  return {
    pageRoute: RouteMap[pageKey] as Route,
    hasPaymentMethod: true,
    currentProject: null,
  } as unknown as PageComponentProps;
}

const RUN_PAGES: Array<RunPage> = [
  {
    name: "Every run in the project",
    path: `${WORKFLOWS_PATH}/logs`,
    pageKey: PageMap.WORKFLOWS_LOGS,
    render: (): React.ReactElement => {
      return <AllWorkflowRunsPage {...pageProps(PageMap.WORKFLOWS_LOGS)} />;
    },
    description:
      "Every run of every workflow in this project, from the last 30 days.",
    emptySentence: "Looks like no workflow ran so far in the last 30 days.",
  },
  {
    name: "One workflow's runs",
    path: `${WORKFLOWS_PATH}/${WORKFLOW_ID}/logs`,
    pageKey: PageMap.WORKFLOW_LOGS,
    render: (): React.ReactElement => {
      return <OneWorkflowRunsPage {...pageProps(PageMap.WORKFLOW_LOGS)} />;
    },
    description: "Every run of this workflow, from the last 30 days.",
    emptySentence:
      "Looks like this workflow did not run so far in the last 30 days.",
  },
];

function runListCalls(): Array<RecordedListCall> {
  return listCalls.filter((call: RecordedListCall): boolean => {
    return call.tableName === "WorkflowLog";
  });
}

// Opens the ⋯ menu of the run at that row.
async function openRowMenu(rowIndex: number): Promise<void> {
  const menuButtons: Array<HTMLElement> = await screen.findAllByTestId(
    "row-actions-more-button",
  );

  expect(menuButtons).toHaveLength(2);

  fireEvent.click(menuButtons[rowIndex]!);
}

async function renderRunPage(page: RunPage): Promise<void> {
  goTo(page.path);
  // A run's workflow name links to the workflow, which needs a router.
  render(
    <MemoryRouter initialEntries={[page.path]}>{page.render()}</MemoryRouter>,
  );
  await waitFor(
    () => {
      expect(runListCalls().length).toBeGreaterThan(0);
    },
    { timeout: 10000 },
  );
}

beforeEach(() => {
  listCalls.length = 0;
  mockDownloads.length = 0;
  runsForTest = TWO_RUNS;
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(RUN_PAGES)("$name", (page: RunPage) => {
  test("the card is titled Runs, like the menu entry that opens it", async () => {
    await renderRunPage(page);

    expect(screen.getByTestId("card-details-heading")).toHaveTextContent(
      /^Runs$/,
    );
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      page.description,
    );
  });

  test("the page no longer calls itself Workflow Logs", async () => {
    await renderRunPage(page);
    await screen.findByText(/workflow runs/);

    const text: string = document.body.textContent || "";
    expect(text).not.toContain("Workflow Logs");
    expect(text).not.toContain("List of logs");
    expect(text).not.toContain("Runs & Logs");
  });

  test("the row count reads workflow runs", async () => {
    await renderRunPage(page);

    expect(
      await screen.findByText("Showing 1-2 of 2 workflow runs"),
    ).toBeInTheDocument();
  });

  test("a single run is counted as one workflow run", async () => {
    runsForTest = [TWO_RUNS[0]!];
    await renderRunPage(page);

    expect(
      await screen.findByText("Showing 1 of 1 workflow run"),
    ).toBeInTheDocument();
  });

  test("with no runs, it keeps saying that nothing ran in the last 30 days", async () => {
    runsForTest = [];
    await renderRunPage(page);

    expect(await screen.findByText(page.emptySentence)).toBeInTheDocument();
  });

  test("View Logs on a run still opens that run", async () => {
    await renderRunPage(page);

    const buttons: Array<HTMLElement> = await screen.findAllByRole("button", {
      name: "View Logs",
    });
    expect(buttons).toHaveLength(2);

    expect(screen.queryByTestId("modal")).toBeNull();

    fireEvent.click(buttons[0]!);

    /*
     * Only that it opens: what the run view shows inside is the run view's
     * own business, and it is tested with it (WorkflowLogModal.test.tsx).
     */
    expect(await screen.findByTestId("modal")).toBeInTheDocument();
  });

  test("View Logs stays the row's one button; the downloads wait in its ⋯ menu", async () => {
    await renderRunPage(page);

    const row: HTMLElement = (
      await screen.findAllByRole("button", { name: "View Logs" })
    )[0]!.closest("[data-testid='row-actions']") as HTMLElement;

    expect(
      within(row)
        .getAllByRole("button")
        .map((button: HTMLElement) => {
          return (
            button.textContent?.trim() || button.getAttribute("aria-label")
          );
        }),
    ).toEqual(["View Logs", expect.stringMatching(/^More actions/)]);

    fireEvent.click(within(row).getByTestId("row-actions-more-button"));

    expect(
      screen.getAllByRole("menuitem").map((item: HTMLElement) => {
        return item.textContent;
      }),
    ).toEqual(["Download log", "Download run as JSON"]);
  });

  test("Download log on a row saves that run's log, named after its workflow and the run", async () => {
    await renderRunPage(page);
    await openRowMenu(1);

    fireEvent.click(screen.getByRole("menuitem", { name: "Download log" }));

    expect(mockDownloads).toHaveLength(1);
    expect(mockDownloads[0]!.filename).toBe(
      `nightly-sync-run-${TWO_RUNS[1]!._id}-2026-09-30T10-00-01.txt`,
    );
    expect(mockDownloads[0]!.mimeType).toBe("text/plain;charset=utf-8");
    expect(mockDownloads[0]!.content).toBe(
      [
        "Workflow: Nightly sync",
        `Workflow ID: ${WORKFLOW_ID}`,
        `Run ID: ${TWO_RUNS[1]!._id}`,
        "Status: Error",
        "Scheduled at: 2026-09-30T10:00:00.000Z",
        "Started at: 2026-09-30T10:00:01.000Z",
        "Completed at: 2026-09-30T10:00:03.000Z",
        "",
        `Run ${TWO_RUNS[1]!._id} log line`,
        "",
      ].join("\n"),
    );
  });

  test("Download run as JSON on a row saves that run as data", async () => {
    await renderRunPage(page);
    await openRowMenu(0);

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Download run as JSON" }),
    );

    expect(mockDownloads).toHaveLength(1);
    expect(mockDownloads[0]!.filename).toBe(
      `nightly-sync-run-${TWO_RUNS[0]!._id}-2026-09-30T10-00-01.json`,
    );
    expect(JSON.parse(mockDownloads[0]!.content as string)).toEqual({
      workflow: { id: WORKFLOW_ID, name: "Nightly sync" },
      run: {
        id: TWO_RUNS[0]!._id,
        status: "Success",
        scheduledAt: "2026-09-30T10:00:00.000Z",
        startedAt: "2026-09-30T10:00:01.000Z",
        completedAt: "2026-09-30T10:00:03.000Z",
      },
      // These runs predate step tracing: no steps, and the log says it all.
      stepTrace: { steps: [] },
      log: [`Run ${TWO_RUNS[0]!._id} log line`],
    });
  });

  test("the run View Logs opens can be copied and downloaded, under the run's name", async () => {
    await renderRunPage(page);

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "View Logs" }))[1]!,
    );

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(within(modal).getByTestId("workflow-run-copy-log")).toBeVisible();

    fireEvent.click(within(modal).getByTestId("workflow-run-download"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download log" }));

    expect(mockDownloads).toHaveLength(1);
    expect(mockDownloads[0]!.filename).toBe(
      `nightly-sync-run-${TWO_RUNS[1]!._id}-2026-09-30T10-00-01.txt`,
    );
    expect(mockDownloads[0]!.content).toContain("Status: Error");
  });

  test("the list asks for everything a download writes", async () => {
    await renderRunPage(page);

    const select: Record<string, unknown> = runListCalls()[0]!.select;

    expect(select["logs"]).toBe(true);
    expect(select["stepTrace"]).toBe(true);
    expect(select["workflowId"]).toBe(true);
    expect(select["workflow"]).toMatchObject({ name: true });
    expect(select["createdAt"]).toBe(true);
    expect(select["startedAt"]).toBe(true);
    expect(select["completedAt"]).toBe(true);
    expect(select["workflowStatus"]).toBe(true);
  });

  /*
   * resumeData holds a sleeping run's state, return values and all, and is
   * never readable through the API. The list must not ask for it, or for
   * anything else a download would have to leave out.
   */
  test("the list never asks for the run's internal resume state", async () => {
    await renderRunPage(page);

    const select: Record<string, unknown> = runListCalls()[0]!.select;

    expect(select["resumeData"]).toBeUndefined();
  });
});

describe("which runs each page lists", () => {
  test("a workflow's Runs page lists only that workflow's runs", async () => {
    await renderRunPage(RUN_PAGES[1]!);

    const query: Record<string, unknown> = runListCalls()[0]!.query;
    expect(String(query["workflowId"])).toBe(WORKFLOW_ID);
    expect(String(query["projectId"])).toBe(PROJECT_ID);
  });

  test("the project's Runs page names each run's workflow", async () => {
    await renderRunPage(RUN_PAGES[0]!);

    const names: Array<HTMLElement> =
      await screen.findAllByText("Nightly sync");
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(runListCalls()[0]!.query["workflowId"]).toBeUndefined();
  });
});
