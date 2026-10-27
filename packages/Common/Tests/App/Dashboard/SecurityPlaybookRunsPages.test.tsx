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
  within,
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
import SecurityCasePlaybookRuns, {
  CASE_PLAYBOOK_RUNS_DESCRIPTION,
  CASE_PLAYBOOK_RUNS_EMPTY_DESCRIPTION,
  CASE_PLAYBOOK_RUNS_EMPTY_TEST_ID,
  CASE_PLAYBOOK_RUNS_EMPTY_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityCasePlaybookRuns";
import { TableEmptyStateKind } from "../../../UI/Components/Table/TableEmptyState";
import {
  RUN_CARD_STEPS_TOGGLE_TEST_ID,
  RUN_CARD_SUMMARY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunCard";
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

/*
 * Another run on the same case: a playbook run at a new detection, `minutes`
 * ago, one step that did what it should.
 */
function runOnCase(
  id: string,
  playbookName: string,
  minutesAgo: number,
  status: SecurityPlaybookRunStatus,
): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = finishedRun();
  run._id = id;
  run.playbookName = playbookName;
  run.status = status;
  run.steps = [
    {
      id: `${id}-step`,
      action: "AddCaseNote",
      title: "Add a note",
    } as never,
  ];
  run.stepResults = [];
  run.createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);
  run.startedAt = run.createdAt;
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

/*
 * A case's own Playbooks page draws its runs as the runs pages do, and says
 * what it is for the way they do: before any playbook has run on the case,
 * an empty state of the product's kind - not a line of grey text under a
 * description saying the same thing.
 */
describe("a case's Playbooks", () => {
  async function renderCaseRuns(): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityCasePlaybookRuns securityCaseId={new ObjectID(CASE_ID)} />
        </MemoryRouter>,
      );
    });
  }

  test("reads the case's runs only, newest first", async () => {
    await renderCaseRuns();

    expect(listRequests[0]).toEqual({
      query: { securityCaseId: new ObjectID(CASE_ID) },
      sort: { createdAt: SortOrder.Descending },
      limit: 25,
    });
  });

  test("with no run yet, the empty state says what runs here, and the card does not say it a second time", async () => {
    await renderCaseRuns();

    const empty: HTMLElement = await screen.findByTestId(
      CASE_PLAYBOOK_RUNS_EMPTY_TEST_ID,
    );

    expect(
      screen.getByRole("heading", { name: "Playbooks" }),
    ).toBeInTheDocument();
    expect(empty).toHaveAttribute(
      "data-empty-state-kind",
      TableEmptyStateKind.Empty,
    );
    expect(
      screen.getByTestId(`${CASE_PLAYBOOK_RUNS_EMPTY_TEST_ID}-title`),
    ).toHaveTextContent("No playbook has run on this case yet");
    expect(CASE_PLAYBOOK_RUNS_EMPTY_TITLE).toBe(
      "No playbook has run on this case yet.",
    );
    expect(
      screen.getByTestId(`${CASE_PLAYBOOK_RUNS_EMPTY_TEST_ID}-description`),
    ).toHaveTextContent(CASE_PLAYBOOK_RUNS_EMPTY_DESCRIPTION);
    expect(screen.queryByTestId("card-description")).toBeNull();
    expect(screen.queryByText(CASE_PLAYBOOK_RUNS_DESCRIPTION)).toBeNull();
  });

  test("with runs, the card says what it holds and draws them, with no empty state", async () => {
    listedRuns = [finishedRun()];

    await renderCaseRuns();

    expect(
      await screen.findByTestId("security-playbook-run-card"),
    ).toHaveTextContent("Enrich New Cases");
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      CASE_PLAYBOOK_RUNS_DESCRIPTION,
    );
    expect(screen.queryByTestId(CASE_PLAYBOOK_RUNS_EMPTY_TEST_ID)).toBeNull();
  });

  /*
   * A playbook that runs at every new detection gives a busy case a run a
   * detection, and drawn whole they made a page of steps nobody could
   * scan. Each run is a line of how far it got, as on Playbook Runs - but
   * the newest opens: it is the one a case's page is read for.
   */
  test("folds each run to a line, the newest open on its steps", async () => {
    listedRuns = [
      runOnCase(
        "25000000-0000-4000-8000-000000000011",
        "Escalate Known-Bad Indicators",
        5,
        SecurityPlaybookRunStatus.Succeeded,
      ),
      runOnCase(
        "25000000-0000-4000-8000-000000000012",
        "Enrich New Cases",
        90,
        SecurityPlaybookRunStatus.Succeeded,
      ),
      runOnCase(
        "25000000-0000-4000-8000-000000000013",
        "Notify the SOC",
        180,
        SecurityPlaybookRunStatus.Succeeded,
      ),
    ];

    await renderCaseRuns();

    const cards: Array<HTMLElement> = await screen.findAllByTestId(
      "security-playbook-run-card",
    );

    expect(
      cards.map((card: HTMLElement): [string, string | null] => {
        return [
          card.textContent?.includes("Escalate Known-Bad Indicators")
            ? "newest"
            : card.textContent?.includes("Enrich New Cases")
              ? "older"
              : "oldest",
          within(card)
            .getByTestId(RUN_CARD_STEPS_TOGGLE_TEST_ID)
            .getAttribute("aria-expanded"),
        ];
      }),
    ).toEqual([
      ["newest", "true"],
      ["older", "false"],
      ["oldest", "false"],
    ]);

    // Each says how far it got, folded or not.
    for (const card of cards) {
      expect(within(card).getByTestId(RUN_CARD_SUMMARY_TEST_ID)).toBeVisible();
    }

    // The newest shows its steps; the others hide theirs a click away.
    expect(within(cards[0]!).getByText("Hide steps")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Show steps")).toBeInTheDocument();
    expect(within(cards[2]!).getByText("Show steps")).toBeInTheDocument();
  });

  test("an older run waiting for approval opens too: its steps are what the approver decides on", async () => {
    listedRuns = [
      runOnCase(
        "25000000-0000-4000-8000-000000000021",
        "Enrich New Cases",
        5,
        SecurityPlaybookRunStatus.Succeeded,
      ),
      runOnCase(
        "25000000-0000-4000-8000-000000000022",
        "Contain Compromised Okta Users",
        40,
        SecurityPlaybookRunStatus.WaitingForApproval,
      ),
      runOnCase(
        "25000000-0000-4000-8000-000000000023",
        "Notify the SOC",
        180,
        SecurityPlaybookRunStatus.Failed,
      ),
    ];

    await renderCaseRuns();

    const cards: Array<HTMLElement> = await screen.findAllByTestId(
      "security-playbook-run-card",
    );

    expect(
      cards.map((card: HTMLElement): string | null => {
        return within(card)
          .getByTestId(RUN_CARD_STEPS_TOGGLE_TEST_ID)
          .getAttribute("aria-expanded");
      }),
    ).toEqual(["true", "true", "false"]);
  });

  test("an older run opens on Show steps, and the newest folds on Hide steps", async () => {
    listedRuns = [
      runOnCase(
        "25000000-0000-4000-8000-000000000031",
        "Escalate Known-Bad Indicators",
        5,
        SecurityPlaybookRunStatus.Succeeded,
      ),
      runOnCase(
        "25000000-0000-4000-8000-000000000032",
        "Enrich New Cases",
        90,
        SecurityPlaybookRunStatus.Succeeded,
      ),
    ];

    await renderCaseRuns();

    const cards: Array<HTMLElement> = await screen.findAllByTestId(
      "security-playbook-run-card",
    );
    const toggles: Array<HTMLElement> = cards.map(
      (card: HTMLElement): HTMLElement => {
        return within(card).getByTestId(RUN_CARD_STEPS_TOGGLE_TEST_ID);
      },
    );

    await act(async () => {
      toggles[1]!.click();
    });
    await act(async () => {
      toggles[0]!.click();
    });

    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "true");
  });

  test("while its runs load, the card keeps its description and says it is busy", async () => {
    let answer: (value: ListResult<BaseModel>) => void = (): void => {
      // Replaced below.
    };
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation((): Promise<ListResult<BaseModel>> => {
        return new Promise(
          (resolve: (value: ListResult<BaseModel>) => void) => {
            answer = resolve;
          },
        );
      });

    await renderCaseRuns();

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      CASE_PLAYBOOK_RUNS_DESCRIPTION,
    );
    expect(screen.queryByTestId(CASE_PLAYBOOK_RUNS_EMPTY_TEST_ID)).toBeNull();

    await act(async () => {
      answer({
        data: [],
        count: 0,
        skip: 0,
        limit: 25,
      } as unknown as ListResult<BaseModel>);
    });

    expect(
      await screen.findByTestId(CASE_PLAYBOOK_RUNS_EMPTY_TEST_ID),
    ).toBeInTheDocument();
  });
});
