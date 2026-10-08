import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Dashboard's ongoing scheduled maintenance: the two Ongoing lists (under
 * Scheduled Maintenance, and on Home) and their menu badges.
 *
 * They used to ask for events whose state carries the ongoing flag, so an
 * event moved on to a state of the project's own after Ongoing - "Verifying",
 * say - dropped off them while the server still held its monitors in
 * maintenance and the status page listed it as ongoing. They now ask for the
 * events in any state an event is in progress in, by the one rule
 * (Common/Utils/ScheduledMaintenanceStart): the ongoing state, and every
 * state of the project's own placed between Ongoing and Ended. One placed
 * after Ended ("Reviewing") is over; one placed before Ongoing ("Preparing")
 * has not started.
 *
 * The real menus and pages are rendered. The project's states come through
 * the real ScheduledMaintenanceStateUtil over a stubbed ModelListCache; the
 * table is stubbed to keep the query it is handed.
 */

const countMock: MockFunction = getJestMockFunction();
const listMock: MockFunction = getJestMockFunction();
const mockTableQueries: Array<Record<string, unknown>> = [];

/*
 * ModelAPI.count backs the badges; ModelListCache the project's state lists.
 * Stubbed inline because jest.mock is hoisted above the imports.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return listMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceTable",
  () => {
    return {
      __esModule: true,
      default: (props: { query: Record<string, unknown> }): null => {
        mockTableQueries.push(props.query);
        return null;
      },
    };
  },
);

import HomeOngoingScheduledMaintenancePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/OngoingScheduledMaintenance";
import HomeSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/SideMenu";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import OngoingScheduledMaintenancePage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Ongoing";
import ScheduledMaintenanceSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  renderMenu,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The project's states in their order: the four built-in ones, a state of
 * the project's own before Ongoing ("Preparing"), one between Ongoing and
 * Ended ("Verifying") and one after Ended ("Reviewing").
 */
const SCHEDULED: string = "65f0000000000000000000a1";
const PREPARING: string = "65f0000000000000000000a2";
const ONGOING: string = "65f0000000000000000000a3";
const VERIFYING: string = "65f0000000000000000000a4";
const ENDED: string = "65f0000000000000000000a5";
const REVIEWING: string = "65f0000000000000000000a6";
const COMPLETED: string = "65f0000000000000000000a7";

type Flag =
  | "isScheduledState"
  | "isOngoingState"
  | "isEndedState"
  | "isResolvedState";

interface StateRow {
  id: ObjectID;
  _id: string;
  order: number;
  isScheduledState: boolean;
  isOngoingState: boolean;
  isEndedState: boolean;
  isResolvedState: boolean;
}

function stateRow(id: string, order: number, flag: Flag | null): StateRow {
  return {
    id: new ObjectID(id),
    _id: id,
    order,
    isScheduledState: flag === "isScheduledState",
    isOngoingState: flag === "isOngoingState",
    isEndedState: flag === "isEndedState",
    isResolvedState: flag === "isResolvedState",
  };
}

function projectStates(): Array<StateRow> {
  return [
    stateRow(SCHEDULED, 1, "isScheduledState"),
    stateRow(PREPARING, 2, null),
    stateRow(ONGOING, 3, "isOngoingState"),
    stateRow(VERIFYING, 4, null),
    stateRow(ENDED, 5, "isEndedState"),
    stateRow(REVIEWING, 6, null),
    stateRow(COMPLETED, 7, "isResolvedState"),
  ];
}

// How the project's states answer: a list, a failure, or not yet.
let answerStates: () => Promise<unknown> = () => {
  return Promise.resolve(listOf(projectStates()));
};

function listOf(rows: Array<unknown>): unknown {
  return { data: rows, count: rows.length, skip: 0, limit: rows.length };
}

let badgeCount: number = 0;

interface CountRequest {
  modelType: unknown;
  query: Record<string, unknown>;
}

function scheduledMaintenanceCounts(): Array<CountRequest> {
  return countMock.mock.calls
    .map((call: Array<unknown>): CountRequest => {
      return call[0] as CountRequest;
    })
    .filter((request: CountRequest): boolean => {
      return request.modelType === ScheduledMaintenance;
    });
}

function stateListRequests(): Array<Record<string, unknown>> {
  return listMock.mock.calls
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[0] as Record<string, unknown>;
    })
    .filter((request: Record<string, unknown>): boolean => {
      return request["modelType"] === ScheduledMaintenanceState;
    });
}

function idsIn(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);
  return ((value as Includes).values as Array<unknown>)
    .map((id: unknown): string => {
      return String(id);
    })
    .sort();
}

// The last of a list (indexed: this project targets es2017, without .at()).
function lastOf<T>(items: Array<T>): T {
  expect(items.length).toBeGreaterThan(0);
  return items[items.length - 1]!;
}

const IN_PROGRESS: Array<string> = [ONGOING, VERIFYING].sort();

function project(): Project {
  const value: Project = new Project();
  value._id = PROJECT_ID;
  return value;
}

// Lets every pending promise (and the renders they cause) settle.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/scheduled-maintenance-events`);
  window.localStorage.clear();
  ConnectedWorkspaces.reset();
  ConnectedWorkspaces.setConnected(PROJECT_ID, [
    WorkspaceType.Slack,
    WorkspaceType.MicrosoftTeams,
  ]);

  mockTableQueries.length = 0;
  badgeCount = 0;
  answerStates = () => {
    return Promise.resolve(listOf(projectStates()));
  };

  countMock.mockImplementation(() => {
    return Promise.resolve(badgeCount);
  });
  listMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };
    if (request.modelType === ScheduledMaintenanceState) {
      return answerStates();
    }
    // The Home menu's incident and alert states: none needed here.
    return Promise.resolve(listOf([]));
  });
});

afterEach(() => {
  cleanup();
  ConnectedWorkspaces.reset();
  countMock.mockReset();
  listMock.mockReset();
});

describe("the Scheduled Maintenance menu's Ongoing Events badge", () => {
  async function renderMenuAndWait(): Promise<void> {
    await renderMenu(<ScheduledMaintenanceSideMenu project={project()} />);
    await settle();
  }

  test("counts the events in the ongoing state and in a state of the project's own between Ongoing and Ended", async () => {
    await renderMenuAndWait();

    await waitFor(() => {
      expect(scheduledMaintenanceCounts().length).toBeGreaterThan(0);
    });
    const request: CountRequest = lastOf(scheduledMaintenanceCounts());
    expect(Object.keys(request.query).sort()).toEqual([
      "currentScheduledMaintenanceStateId",
      "projectId",
    ]);
    expect(idsIn(request.query["currentScheduledMaintenanceStateId"])).toEqual(
      IN_PROGRESS,
    );
  });

  test("leaves out Scheduled, a state before Ongoing, Ended, Completed and a state after Ended", async () => {
    await renderMenuAndWait();

    await waitFor(() => {
      expect(scheduledMaintenanceCounts().length).toBeGreaterThan(0);
    });
    const ids: Array<string> = idsIn(
      lastOf(scheduledMaintenanceCounts()).query[
        "currentScheduledMaintenanceStateId"
      ],
    );
    for (const notInProgress of [
      SCHEDULED,
      PREPARING,
      ENDED,
      REVIEWING,
      COMPLETED,
    ]) {
      expect(ids).not.toContain(notInProgress);
    }
  });

  test("never asks by the ongoing flag", async () => {
    await renderMenuAndWait();

    await waitFor(() => {
      expect(scheduledMaintenanceCounts().length).toBeGreaterThan(0);
    });
    for (const request of scheduledMaintenanceCounts()) {
      expect(request.query).not.toHaveProperty(
        "currentScheduledMaintenanceState",
      );
    }
  });

  test("shows the count the server answers", async () => {
    badgeCount = 3;
    await renderMenuAndWait();

    const link: HTMLAnchorElement = document.querySelector(
      `a[href="${routeFor(PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS)}"]`,
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    await waitFor(() => {
      expect(link).toHaveTextContent("3");
    });
  });

  test("the states' place decides, not the order they arrive in", async () => {
    answerStates = () => {
      return Promise.resolve(listOf([...projectStates()].reverse()));
    };
    await renderMenuAndWait();

    await waitFor(() => {
      expect(scheduledMaintenanceCounts().length).toBeGreaterThan(0);
    });
    expect(
      idsIn(
        lastOf(scheduledMaintenanceCounts()).query[
          "currentScheduledMaintenanceStateId"
        ],
      ),
    ).toEqual(IN_PROGRESS);
  });

  test("waits for the project's states: nothing is counted before they are read", async () => {
    answerStates = () => {
      return new Promise<unknown>(() => {});
    };
    await renderMenuAndWait();

    expect(stateListRequests()).toHaveLength(1);
    expect(scheduledMaintenanceCounts()).toHaveLength(0);
  });

  test("a failed read of the states leaves the badge off, and the entry still there", async () => {
    answerStates = async () => {
      throw new Error("states failed");
    };
    await renderMenuAndWait();

    expect(scheduledMaintenanceCounts()).toHaveLength(0);
    expect(
      document.querySelector(
        `a[href="${routeFor(PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS)}"]`,
      ),
    ).not.toBeNull();
  });

  test("the states are read for the current project, with their place and every flag", async () => {
    await renderMenuAndWait();

    expect(stateListRequests()).toHaveLength(1);
    const request: Record<string, unknown> = stateListRequests()[0]!;
    expect(
      String((request["query"] as Record<string, unknown>)["projectId"]),
    ).toBe(PROJECT_ID);
    const select: Record<string, unknown> = request["select"] as Record<
      string,
      unknown
    >;
    for (const column of [
      "_id",
      "order",
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ]) {
      expect([column, select[column]]).toEqual([column, true]);
    }
  });
});

describe("the Home menu's Ongoing badge", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/home`);
  });

  test("counts the same events: the ongoing state and a state between Ongoing and Ended", async () => {
    await renderMenu(<HomeSideMenu project={project()} />);
    await settle();

    await waitFor(() => {
      const requests: Array<CountRequest> = scheduledMaintenanceCounts();
      expect(requests.length).toBeGreaterThan(0);
      expect(
        idsIn(lastOf(requests).query["currentScheduledMaintenanceStateId"]),
      ).toEqual(IN_PROGRESS);
    });

    const request: CountRequest = lastOf(scheduledMaintenanceCounts());
    expect(Object.keys(request.query).sort()).toEqual([
      "currentScheduledMaintenanceStateId",
      "projectId",
    ]);
    for (const asked of scheduledMaintenanceCounts()) {
      expect(asked.query).not.toHaveProperty(
        "currentScheduledMaintenanceState",
      );
    }
  });

  test("before the states are read it asks for no state at all, never for every event", async () => {
    answerStates = () => {
      return new Promise<unknown>(() => {});
    };
    await renderMenu(<HomeSideMenu project={project()} />);
    await settle();

    for (const asked of scheduledMaintenanceCounts()) {
      expect(idsIn(asked.query["currentScheduledMaintenanceStateId"])).toEqual(
        [],
      );
    }
  });
});

describe.each([
  [
    "Scheduled Maintenance > Ongoing Events",
    OngoingScheduledMaintenancePage,
    "scheduled-maintenance-events/ongoing",
  ],
  [
    "Home > Ongoing",
    HomeOngoingScheduledMaintenancePage,
    "home/scheduled-maintenance-ongoing",
  ],
] as Array<[string, React.FunctionComponent<PageComponentProps>, string]>)(
  "the %s list",
  (
    _name: string,
    Page: React.FunctionComponent<PageComponentProps>,
    pagePath: string,
  ) => {
    beforeEach(() => {
      goTo(`/dashboard/${PROJECT_ID}/${pagePath}`);
    });

    async function renderPage(): Promise<void> {
      await act(async () => {
        render(<Page {...({} as PageComponentProps)} />);
      });
      await settle();
    }

    test("lists the events in progress: the ongoing state and a state between Ongoing and Ended", async () => {
      await renderPage();

      await waitFor(() => {
        expect(mockTableQueries.length).toBeGreaterThan(0);
      });
      const query: Record<string, unknown> = lastOf(mockTableQueries);
      expect(Object.keys(query).sort()).toEqual([
        "currentScheduledMaintenanceStateId",
        "projectId",
      ]);
      expect(String(query["projectId"])).toBe(PROJECT_ID);
      expect(idsIn(query["currentScheduledMaintenanceStateId"])).toEqual(
        IN_PROGRESS,
      );
    });

    test("never lists by the ongoing flag", async () => {
      await renderPage();

      await waitFor(() => {
        expect(mockTableQueries.length).toBeGreaterThan(0);
      });
      for (const query of mockTableQueries) {
        expect(query).not.toHaveProperty("currentScheduledMaintenanceState");
      }
    });

    test("an event in a state after Ended, or before Ongoing, is not listed", async () => {
      await renderPage();

      await waitFor(() => {
        expect(mockTableQueries.length).toBeGreaterThan(0);
      });
      const ids: Array<string> = idsIn(
        lastOf(mockTableQueries)["currentScheduledMaintenanceStateId"],
      );
      expect(ids).not.toContain(REVIEWING);
      expect(ids).not.toContain(PREPARING);
      expect(ids).not.toContain(SCHEDULED);
      expect(ids).not.toContain(ENDED);
      expect(ids).not.toContain(COMPLETED);
    });

    test("waits for the project's states before asking for any event", async () => {
      answerStates = () => {
        return new Promise<unknown>(() => {});
      };
      await renderPage();

      expect(stateListRequests()).toHaveLength(1);
      expect(mockTableQueries).toHaveLength(0);
    });

    test("says why when the states cannot be read, and lists nothing", async () => {
      answerStates = async () => {
        throw new Error("The states could not be read.");
      };
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("The states could not be read."),
        ).toBeInTheDocument();
      });
      expect(mockTableQueries).toHaveLength(0);
    });

    test("a project without an ongoing state lists nothing in progress", async () => {
      answerStates = () => {
        return Promise.resolve(
          listOf(
            projectStates().filter((state: StateRow): boolean => {
              return !state.isOngoingState;
            }),
          ),
        );
      };
      await renderPage();

      await waitFor(() => {
        expect(mockTableQueries.length).toBeGreaterThan(0);
      });
      expect(
        idsIn(lastOf(mockTableQueries)["currentScheduledMaintenanceStateId"]),
      ).toEqual([]);
    });
  },
);
