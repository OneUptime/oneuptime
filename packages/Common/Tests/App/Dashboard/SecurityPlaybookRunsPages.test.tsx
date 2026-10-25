import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * The playbook runs, as two pages under Playbooks in the side menu:
 * Approvals and Playbook Runs. They were three views switched by buttons
 * along the top of one card (Waiting for Approval, Running, All Runs). Each page is drawn here for real: what it asks the server for,
 * its card, its runs, and what it says when there are none - all clear for
 * the approvals, a way to the playbooks for the runs.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import SecurityPlaybookRunsPage, {
  VIEW_PLAYBOOKS,
  VIEW_PLAYBOOKS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/PlaybookRuns";
import {
  PLAYBOOK_RUNS_PAGE_LIMIT,
  SECURITY_PLAYBOOK_RUN_VIEWS,
  SecurityPlaybookRunView,
  SecurityPlaybookRunViewKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunViews";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(
    `/dashboard/${PROJECT_ID}/security-events/playbook-runs`,
  ),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

const CASE_ID: string = "20000000-0000-4000-8000-000000000142";

interface ListRequest {
  query: Record<string, unknown>;
  sort: unknown;
  limit: number | undefined;
}

let listedRuns: Array<SecurityPlaybookRun> = [];
let listRequests: Array<ListRequest> = [];

function finishedRun(): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = new SecurityPlaybookRun();
  run._id = "25000000-0000-4000-8000-000000000002";
  run.playbookName = "Enrich New Cases";
  run.status = SecurityPlaybookRunStatus.Succeeded;
  run.securityCaseId = new ObjectID(CASE_ID);
  run.steps = [];
  run.stepResults = [];
  run.createdAt = new Date(Date.now() - 60 * 60 * 1000);
  run.startedAt = run.createdAt;
  run.completedAt = new Date(Date.now() - 59 * 60 * 1000);
  return run;
}

async function renderRuns(
  view: SecurityPlaybookRunViewKey | undefined,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityPlaybookRunsPage {...PAGE_PROPS} view={view} />
      </MemoryRouter>,
    );
  });
}

function viewOf(key: SecurityPlaybookRunViewKey): SecurityPlaybookRunView {
  return SECURITY_PLAYBOOK_RUN_VIEWS.find(
    (view: SecurityPlaybookRunView): boolean => {
      return view.key === key;
    },
  )!;
}

beforeEach(() => {
  listedRuns = [];
  listRequests = [];
  goTo(`/dashboard/${PROJECT_ID}/security-events/playbook-runs`);

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest
    .spyOn(Realtime, "listenToModelEvent")
    .mockImplementation((): (() => void) => {
      return (): void => {
        // Nothing pushes changes here.
      };
    });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        query: Record<string, unknown>;
        sort: unknown;
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        listRequests.push({
          query: options.query,
          sort: options.sort,
          limit: options.limit,
        });

        return {
          data: listedRuns,
          count: listedRuns.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the two runs pages", () => {
  test.each(["waiting", "all"])(
    "%s: its name and what it holds head the card, with no view buttons",
    async (key: string) => {
      const view: SecurityPlaybookRunView = viewOf(
        key as SecurityPlaybookRunViewKey,
      );
      listedRuns = [finishedRun()];

      await renderRuns(view.key);

      expect(
        screen.getByRole("heading", { name: view.title }),
      ).toBeInTheDocument();
      expect(
        await screen.findByTestId("security-playbook-run-card"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("card-description")).toHaveTextContent(
        view.description,
      );
      // Waiting for Approval, Running and All Runs are no longer buttons.
      expect(
        document.querySelectorAll(
          '[data-testid^="security-playbook-runs-view-"]:not([data-testid="security-playbook-runs-view-playbooks"])',
        ),
      ).toHaveLength(0);
      expect(document.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
    },
  );

  test("Approvals asks for the runs held for an approval, newest first", async () => {
    await renderRuns("waiting");

    expect(listRequests[0]).toEqual({
      query: { status: SecurityPlaybookRunStatus.WaitingForApproval },
      sort: { createdAt: SortOrder.Descending },
      limit: PLAYBOOK_RUNS_PAGE_LIMIT,
    });
  });

  test("Playbook Runs asks for every run, newest first", async () => {
    await renderRuns("all");

    expect(listRequests[0]).toEqual({
      query: {},
      sort: { createdAt: SortOrder.Descending },
      limit: PLAYBOOK_RUNS_PAGE_LIMIT,
    });
  });

  test("a page without a view is Approvals, the runs page's old address", async () => {
    await renderRuns(undefined);

    expect(
      screen.getByRole("heading", { name: "Approvals" }),
    ).toBeInTheDocument();
    expect(listRequests[0]?.query).toEqual({
      status: SecurityPlaybookRunStatus.WaitingForApproval,
    });
  });
});

describe("a run on the runs pages", () => {
  test.each(["waiting", "all"])(
    "%s: a finished run is its header and a line, its steps a click away",
    async (key: string) => {
      listedRuns = [finishedRun()];

      await renderRuns(key as SecurityPlaybookRunViewKey);

      await screen.findByTestId("security-playbook-run-card");

      expect(
        screen.getByTestId("security-playbook-run-steps-toggle"),
      ).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.getByTestId("security-playbook-run-summary"),
      ).toBeInTheDocument();
    },
  );
});

describe("what an empty runs page says", () => {
  test.each(["waiting", "all"])(
    "%s: the empty state says what the page is for, and the card does not say it a second time",
    async (key: string) => {
      const view: SecurityPlaybookRunView = viewOf(
        key as SecurityPlaybookRunViewKey,
      );

      await renderRuns(view.key);

      await screen.findByTestId("security-playbook-runs-empty");

      expect(
        screen.getByRole("heading", { name: view.title }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("security-playbook-runs-empty-description"),
      ).toHaveTextContent(view.emptyDescription);
      expect(screen.queryByTestId("card-description")).toBeNull();
      expect(screen.queryByText(view.description)).toBeNull();
    },
  );

  test("nothing waiting for approval is good news, with nothing to do", async () => {
    await renderRuns("waiting");

    const empty: HTMLElement = await screen.findByTestId(
      "security-playbook-runs-empty",
    );

    expect(empty).toHaveAttribute("data-empty-state-kind", "all-clear");
    expect(
      screen.getByTestId("security-playbook-runs-empty-title"),
    ).toHaveTextContent("No step is waiting for approval");
    expect(
      screen.getByTestId("security-playbook-runs-empty-description"),
    ).toHaveTextContent(
      "A step that needs approval holds its run here until someone approves or rejects it.",
    );
    expect(screen.queryByTestId(VIEW_PLAYBOOKS_TEST_ID)).toBeNull();
  });

  test("no run yet is a first visit, and its one button opens the playbooks", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        // Recorded, not followed.
      });

    await renderRuns("all");

    const empty: HTMLElement = await screen.findByTestId(
      "security-playbook-runs-empty",
    );

    expect(empty).toHaveAttribute("data-empty-state-kind", "empty");
    expect(
      screen.getByTestId("security-playbook-runs-empty-title"),
    ).toHaveTextContent("No playbook has run yet");

    const button: HTMLElement = screen.getByTestId(VIEW_PLAYBOOKS_TEST_ID);

    expect(button).toHaveTextContent(VIEW_PLAYBOOKS);

    fireEvent.click(button);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]?.[0])).toBe(
      routeFor(PageMap.SECURITY_PLAYBOOKS),
    );
  });
});

describe("a runs page with runs", () => {
  test("draws each run, linked to its case, and no empty state", async () => {
    listedRuns = [finishedRun()];

    await renderRuns("all");

    expect(
      await screen.findByTestId("security-playbook-run-card"),
    ).toHaveTextContent("Enrich New Cases");
    expect(screen.queryByTestId("security-playbook-runs-empty")).toBeNull();

    const caseLink: HTMLAnchorElement | null = document.querySelector(
      `a[href$="/security-events/cases/${CASE_ID}"]`,
    );

    expect(caseLink).not.toBeNull();
  });
});
