import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, waitFor, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The SLO side menu badges Alerts and Incidents with how many of the records
 * this SLO's burn rate rules raised are still open - the same prompt the
 * service, host and IoT fleet menus give. These render the real menu against
 * the real RouteMap, with the two data sources stubbed: the project's
 * unresolved states (Dashboard Utils) and ModelAPI.count.
 *
 * What is pinned: the counts go through the `serviceLevelObjectives`
 * relation the tabs list by, over unresolved states only; nothing is counted
 * before the states are known (no request, no flashing badge); and a failed
 * state lookup costs the badge and nothing else.
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

const mockCount: MockFunction = getJestMockFunction();
const mockGetUnresolvedIncidentStates: MockFunction = getJestMockFunction();
const mockGetUnresolvedAlertStates: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return mockCount(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (...args: Array<unknown>): unknown => {
          return mockGetUnresolvedIncidentStates(...args);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (...args: Array<unknown>): unknown => {
        return mockGetUnresolvedAlertStates(...args);
      },
    },
  };
});

import SloViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  sectionRoot,
  setViewportWidth,
} from "./SideMenuHarness";

const SLO_ID: ObjectID = new ObjectID("0193c0de-9999-4aaa-8bbb-000000000009");

const INCIDENT_STATE_IDS: Array<string> = [
  "0193c0de-9999-4aaa-8bbb-0000000000a1",
  "0193c0de-9999-4aaa-8bbb-0000000000a2",
];
const ALERT_STATE_IDS: Array<string> = ["0193c0de-9999-4aaa-8bbb-0000000000b1"];

const OPEN_ALERTS: number = 3;
const OPEN_INCIDENTS: number = 1;

interface CountCall {
  modelType: unknown;
  query: JSONObject;
}

function incidentStates(): Array<IncidentState> {
  return INCIDENT_STATE_IDS.map((id: string): IncidentState => {
    const state: IncidentState = new IncidentState();
    state._id = id;
    return state;
  });
}

function alertStates(): Array<AlertState> {
  return ALERT_STATE_IDS.map((id: string): AlertState => {
    const state: AlertState = new AlertState();
    state._id = id;
    return state;
  });
}

function pagePath(page: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: SLO_ID,
  }).toString();
}

function countCalls(): Array<CountCall> {
  return mockCount.mock.calls.map((call: Array<unknown>): CountCall => {
    return call[0] as CountCall;
  });
}

function countCallFor(modelType: unknown): CountCall | undefined {
  return countCalls().find((call: CountCall): boolean => {
    return call.modelType === modelType;
  });
}

function idsOf(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);

  return ((value as Includes).values as Array<ObjectID | string>).map(
    (id: ObjectID | string): string => {
      return id.toString();
    },
  );
}

function anchorFor(page: PageMap): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    sectionRoot("SLO").querySelectorAll<HTMLAnchorElement>("a"),
  ).find((candidate: HTMLAnchorElement): boolean => {
    return candidate.getAttribute("href") === pagePath(page);
  });

  if (!anchor) {
    throw new Error(`No SLO menu link to ${page}.`);
  }

  return anchor;
}

// Badge renders its count in a tabular-nums pill; nothing else in the menu does.
function badgesInMenu(): Array<Element> {
  return Array.from(document.querySelectorAll("span.tabular-nums"));
}

async function renderSloMenu(): Promise<void> {
  await renderMenu(<SloViewSideMenu modelId={SLO_ID} />);
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  /*
   * Route population and ProjectUtil both read the project id from the
   * current URL, so the project comes first - a path built before it would
   * carry a literal ":projectId" and the menu would (rightly) count nothing.
   */
  goTo(`/dashboard/${PROJECT_ID}/slos`);
  goTo(pagePath(PageMap.SLO_VIEW));

  mockCount.mockReset();
  mockCount.mockImplementation((args: unknown): Promise<number> => {
    return Promise.resolve(
      (args as CountCall).modelType === Alert ? OPEN_ALERTS : OPEN_INCIDENTS,
    );
  });

  mockGetUnresolvedIncidentStates.mockReset();
  mockGetUnresolvedIncidentStates.mockImplementation(() => {
    return Promise.resolve(incidentStates());
  });

  mockGetUnresolvedAlertStates.mockReset();
  mockGetUnresolvedAlertStates.mockImplementation(() => {
    return Promise.resolve(alertStates());
  });
});

afterEach(() => {
  cleanup();
});

describe("SLO side menu open counts", () => {
  test("badges Alerts and Incidents with this SLO's open counts", async () => {
    await renderSloMenu();

    await waitFor(() => {
      expect(
        within(anchorFor(PageMap.SLO_VIEW_ALERTS)).getByText(`${OPEN_ALERTS}`),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        within(anchorFor(PageMap.SLO_VIEW_INCIDENTS)).getByText(
          `${OPEN_INCIDENTS}`,
        ),
      ).toBeInTheDocument();
    });
  });

  test("the badges do not change the menu titles or destinations", async () => {
    await renderSloMenu();

    await waitFor(() => {
      expect(mockCount).toHaveBeenCalledTimes(2);
    });

    const titles: Array<string> = linksIn("SLO").map(
      (link: MenuLink): string => {
        return link.title;
      },
    );

    expect(titles).toContain("Alerts");
    expect(titles).toContain("Incidents");
    expect(anchorFor(PageMap.SLO_VIEW_ALERTS)).toBeInTheDocument();
    expect(anchorFor(PageMap.SLO_VIEW_INCIDENTS)).toBeInTheDocument();
  });

  test("the alert count is this SLO's alerts through the relation, in unresolved states only", async () => {
    await renderSloMenu();

    await waitFor(() => {
      expect(countCallFor(Alert)).toBeDefined();
    });

    const query: JSONObject = countCallFor(Alert)!.query;

    expect(Object.keys(query).sort()).toEqual(
      ["currentAlertStateId", "projectId", "serviceLevelObjectives"].sort(),
    );
    expect(query["projectId"]!.toString()).toBe(PROJECT_ID);
    expect(idsOf(query["serviceLevelObjectives"])).toEqual([SLO_ID.toString()]);
    expect(idsOf(query["currentAlertStateId"])).toEqual(ALERT_STATE_IDS);
  });

  test("the incident count is this SLO's incidents through the relation, in unresolved states only", async () => {
    await renderSloMenu();

    await waitFor(() => {
      expect(countCallFor(Incident)).toBeDefined();
    });

    const query: JSONObject = countCallFor(Incident)!.query;

    expect(Object.keys(query).sort()).toEqual(
      ["currentIncidentStateId", "projectId", "serviceLevelObjectives"].sort(),
    );
    expect(idsOf(query["serviceLevelObjectives"])).toEqual([SLO_ID.toString()]);
    expect(idsOf(query["currentIncidentStateId"])).toEqual(INCIDENT_STATE_IDS);
  });

  test("only Alerts and Incidents carry a badge", async () => {
    await renderSloMenu();

    await waitFor(() => {
      expect(badgesInMenu()).toHaveLength(2);
    });
  });

  test("asks for no count while the unresolved states are still loading", async () => {
    mockGetUnresolvedIncidentStates.mockImplementation(() => {
      return new Promise<Array<IncidentState>>(() => {
        // never settles
      });
    });
    mockGetUnresolvedAlertStates.mockImplementation(() => {
      return new Promise<Array<AlertState>>(() => {
        // never settles
      });
    });

    await renderSloMenu();
    await settle();

    expect(mockCount).not.toHaveBeenCalled();
    expect(badgesInMenu()).toHaveLength(0);
    expect(anchorFor(PageMap.SLO_VIEW_ALERTS)).toBeInTheDocument();
  });

  test("a failed state lookup costs only that badge", async () => {
    mockGetUnresolvedAlertStates.mockImplementation(() => {
      return Promise.reject(new Error("network down"));
    });

    await renderSloMenu();

    await waitFor(() => {
      expect(countCallFor(Incident)).toBeDefined();
    });
    await settle();

    expect(countCallFor(Alert)).toBeUndefined();
    expect(anchorFor(PageMap.SLO_VIEW_ALERTS)).toBeInTheDocument();
    expect(
      within(anchorFor(PageMap.SLO_VIEW_ALERTS)).queryByText(`${OPEN_ALERTS}`),
    ).toBeNull();
  });

  test("a project with no unresolved states counts nothing", async () => {
    mockGetUnresolvedIncidentStates.mockImplementation(() => {
      return Promise.resolve([]);
    });
    mockGetUnresolvedAlertStates.mockImplementation(() => {
      return Promise.resolve([]);
    });

    await renderSloMenu();
    await settle();

    expect(mockGetUnresolvedIncidentStates).toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
    expect(badgesInMenu()).toHaveLength(0);
  });

  test("looks the states up for the project in the URL", async () => {
    await renderSloMenu();

    await waitFor(() => {
      expect(mockGetUnresolvedAlertStates).toHaveBeenCalled();
    });

    expect(
      (mockGetUnresolvedAlertStates.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(PROJECT_ID);
    expect(
      (
        mockGetUnresolvedIncidentStates.mock.calls[0]![0] as ObjectID
      ).toString(),
    ).toBe(PROJECT_ID);
  });
});
