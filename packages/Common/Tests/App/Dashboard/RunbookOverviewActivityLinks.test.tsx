import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";

/*
 * THE OVERVIEW'S WAY TO THE RUNS.
 *
 * A runbook's side menu keeps Executions in its Logs section, folded until
 * opened (the maintainer: "show as little stuff as possible to the user").
 * So the Overview's Activity card is the way to the runs that is always in
 * sight: Last Run opens that run, and Total Runs the list of every run.
 *
 * Both were tiles with a click handler. The keyboard never reached them, a
 * screen reader never heard of them, a middle click opened nothing - and a
 * click on the last run's own incident or alert link was taken to the run
 * instead, because the tile's handler ran after the link's. Now each is a
 * real link, its label stretched over its tile, and what started the last
 * run sits above it with its own link.
 *
 * The real page; its details card is a stand-in that hands the page the
 * runbook it read, as the real one does (onItemLoaded). The network, the
 * signed-in user's permissions and navigation are stubbed.
 */

interface DetailProps {
  modelDetailProps: {
    onItemLoaded?: ((item: unknown) => void) | undefined;
  };
}

let mockRunbook: Record<string, unknown> = {};

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  const ReactInMock: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: DetailProps): ReactElement => {
      ReactInMock.useEffect(() => {
        props.modelDetailProps.onItemLoaded?.(mockRunbook);
      }, []);

      return ReactInMock.createElement("div", {
        "data-testid": "runbook-details",
      });
    },
  };
});

// The newest run, and how many runs there are of each outcome.
let mockLastRun: Record<string, unknown> | null = null;
let mockCounts: { total: number; completed: number; failed: number } = {
  total: 0,
  completed: 0,
  failed: 0,
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<unknown> => {
        return {
          data: mockLastRun ? [mockLastRun] : [],
          count: mockLastRun ? 1 : 0,
          skip: 0,
          limit: 1,
        };
      },
      count: async (options: {
        query?: { status?: string | undefined } | undefined;
      }): Promise<number> => {
        const status: string | undefined = options.query?.status;

        if (status === "Completed") {
          return mockCounts.completed;
        }

        if (status === "Failed") {
          return mockCounts.failed;
        }

        return mockCounts.total;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import RunbookOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Index";
import {
  RUNBOOK_LAST_RUN_LINK_TEST_ID,
  RUNBOOK_LAST_RUN_TILE_TEST_ID,
  RUNBOOK_TOTAL_RUNS_LINK_TEST_ID,
  RUNBOOK_TOTAL_RUNS_TILE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookOverviewState";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import RunbookTriggerType from "../../../Types/Runbook/RunbookTriggerType";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b1f0a0e-1111-4c1e-9a1e-000000000001",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "2a000000-0000-4000-8000-0000000000a1",
);
const RUN_ID: string = "3a000000-0000-4000-8000-0000000000b1";
const INCIDENT_ID: string = "4a000000-0000-4000-8000-0000000000c1";

const RUNBOOK_PATH: string = `/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID.toString()}`;
const EXECUTIONS_PATH: string = `${RUNBOOK_PATH}/executions`;
const RUN_PATH: string = `${EXECUTIONS_PATH}/${RUN_ID}`;
const INCIDENT_PATH: string = `/dashboard/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID}`;

const ONE_STEP: Array<Record<string, unknown>> = [
  { id: "s1", type: "Manual", order: 1, title: "Check replication lag" },
];

// A run an incident's rule started, as the Overview selects it.
function runStartedByIncident(): Record<string, unknown> {
  return {
    _id: RUN_ID,
    status: RunbookExecutionStatus.Completed,
    startedAt: new Date(Date.now() - 4 * 60 * 1000),
    createdAt: new Date(Date.now() - 4 * 60 * 1000),
    triggerType: RunbookTriggerType.Manual,
    incident: { _id: INCIDENT_ID, title: "Checkout is down" },
  };
}

let navigateSpy: jest.SpyInstance;

beforeEach(() => {
  mockRunbook = { isEnabled: true, steps: ONE_STEP };
  mockLastRun = runStartedByIncident();
  mockCounts = { total: 4, completed: 3, failed: 1 };
  PermissionGate.clearPermissionPropsCache();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    RUNBOOK_ID,
  );
  navigateSpy = getJestSpyOn(Navigation, "navigate").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// Where the router is: an incident's link moves it, as in the Dashboard.
function Location(): ReactElement {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

async function openOverview(): Promise<void> {
  // The runbook is read, and its runs read and counted, as it opens.
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[RUNBOOK_PATH]}>
        <RunbookOverview
          pageRoute={new Route(RUNBOOK_PATH)}
          currentProject={null}
          hasPaymentMethod={true}
        />
        <Location />
      </MemoryRouter>,
    );
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });

  await waitFor(() => {
    expect(
      screen.getByTestId(RUNBOOK_LAST_RUN_TILE_TEST_ID),
    ).not.toHaveTextContent("Loading…");
  });
}

function totalRunsLink(): HTMLElement {
  return screen.getByTestId(RUNBOOK_TOTAL_RUNS_LINK_TEST_ID);
}

function lastRunLink(): HTMLElement {
  return screen.getByTestId(RUNBOOK_LAST_RUN_LINK_TEST_ID);
}

describe("Total Runs leads to every run of the runbook", () => {
  test("is a link, named Total Runs, to the runbook's Executions list", async () => {
    await openOverview();

    const link: HTMLElement = totalRunsLink();

    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(EXECUTIONS_PATH);
    expect(link).toHaveTextContent(/^Total Runs$/);
    expect(
      screen.getByRole("link", { name: "Total Runs" }),
    ).toBeInTheDocument();
    // An href is what puts it in the keyboard's way and lets it open in a new tab.
    expect(link.tabIndex).toBe(0);
  });

  test("opens the Executions list when clicked", async () => {
    await openOverview();

    fireEvent.click(totalRunsLink());

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(EXECUTIONS_PATH);
  });

  test("stretches over its whole tile, so a click anywhere on it is the link's", async () => {
    await openOverview();

    const tile: HTMLElement = screen.getByTestId(
      RUNBOOK_TOTAL_RUNS_TILE_TEST_ID,
    );

    expect(tile).toContainElement(totalRunsLink());
    // The tile places the link's ::after, which covers it.
    expect(tile.className.split(" ")).toContain("relative");
    expect(totalRunsLink().className.split(" ")).toEqual(
      expect.arrayContaining([
        "after:absolute",
        "after:inset-0",
        "focus-visible:after:ring-2",
      ]),
    );
    // The count and its words are in the tile, under the link.
    expect(tile).toHaveTextContent("4");
    expect(tile).toHaveTextContent("All executions on record");
  });

  test("still leads to the list before anything has run", async () => {
    mockLastRun = null;
    mockCounts = { total: 0, completed: 0, failed: 0 };

    await openOverview();

    expect(totalRunsLink().getAttribute("href")).toBe(EXECUTIONS_PATH);
  });
});

describe("Last Run leads to that run", () => {
  test("is a link, named Last Run, to the run's own page", async () => {
    await openOverview();

    const link: HTMLElement = lastRunLink();

    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(RUN_PATH);
    expect(screen.getByRole("link", { name: "Last Run" })).toBe(link);
    expect(link.tabIndex).toBe(0);
  });

  test("opens the run when clicked", async () => {
    await openOverview();

    fireEvent.click(lastRunLink());

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(RUN_PATH);
  });

  test("stretches over its tile, under what started the run", async () => {
    await openOverview();

    const tile: HTMLElement = screen.getByTestId(RUNBOOK_LAST_RUN_TILE_TEST_ID);
    const incidentLink: HTMLElement = within(tile).getByRole("link", {
      name: "Checkout is down",
    });
    const startedBy: HTMLElement = incidentLink.closest("div") as HTMLElement;

    expect(tile.className.split(" ")).toContain("relative");
    expect(lastRunLink().className.split(" ")).toEqual(
      expect.arrayContaining(["after:absolute", "after:inset-0"]),
    );
    /*
     * Above the stretched link, letting a click on its words through to the
     * run and keeping its own link's clicks for itself.
     */
    expect(startedBy.className.split(" ")).toEqual(
      expect.arrayContaining([
        "relative",
        "z-10",
        "pointer-events-none",
        "[&_a]:pointer-events-auto",
      ]),
    );
    // Not inside the run's link: a link in a link is no link at all.
    expect(lastRunLink()).not.toContainElement(incidentLink);
  });

  test("an incident that started the run opens from its own link, not the run", async () => {
    await openOverview();

    const tile: HTMLElement = screen.getByTestId(RUNBOOK_LAST_RUN_TILE_TEST_ID);

    fireEvent.click(
      within(tile).getByRole("link", { name: "Checkout is down" }),
    );

    // The incident's link moved the router; nothing sent it on to the run.
    expect(screen.getByTestId("location")).toHaveTextContent(INCIDENT_PATH);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("is not a link before anything has run, and says so", async () => {
    mockLastRun = null;
    mockCounts = { total: 0, completed: 0, failed: 0 };

    await openOverview();

    const tile: HTMLElement = screen.getByTestId(RUNBOOK_LAST_RUN_TILE_TEST_ID);

    expect(screen.queryByTestId(RUNBOOK_LAST_RUN_LINK_TEST_ID)).toBeNull();
    expect(within(tile).queryByRole("link")).toBeNull();
    expect(tile).toHaveTextContent("Never run yet.");
    // Only a tile that leads somewhere lights up on hover.
    expect(tile.className).not.toContain("hover:border-indigo-300");
  });
});

describe("Outcomes", () => {
  test("is not a link, and its two counts wrap rather than run past the tile", async () => {
    await openOverview();

    const label: HTMLElement = screen.getByText("Outcomes");
    const tile: HTMLElement = label.parentElement as HTMLElement;
    const counts: HTMLElement = within(tile).getByText("completed")
      .parentElement!.parentElement as HTMLElement;

    expect(within(tile).queryByRole("link")).toBeNull();
    expect(counts.className.split(" ")).toEqual(
      expect.arrayContaining(["flex", "flex-wrap"]),
    );
    expect(tile).toHaveTextContent("3");
    expect(tile).toHaveTextContent("1");
  });
});

describe("the Activity card has no click handlers of its own left", () => {
  test("only its links lead anywhere: a click on the tiles' text sends nothing", async () => {
    await openOverview();

    for (const testId of [
      RUNBOOK_LAST_RUN_TILE_TEST_ID,
      RUNBOOK_TOTAL_RUNS_TILE_TEST_ID,
    ]) {
      fireEvent.click(screen.getByTestId(testId));
    }

    fireEvent.click(screen.getByText("All executions on record"));

    /*
     * A click outside the links themselves does nothing in jsdom, which has
     * no layout: in a browser the stretched links cover the tiles (the
     * offline RunbookSideMenu spec clicks them there).
     */
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
