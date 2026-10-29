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
 * A network device's menu badges Incidents and Alerts with how many of the
 * incidents and alerts linked to the device are still open (issue #5341),
 * as a host's and an SLO's menus do. These render the real menu against the
 * real RouteMap, with the two data sources stubbed: the project's
 * unresolved states (Dashboard Utils) and ModelAPI.count.
 *
 * What is pinned: the counts go through the `networkDevices` relation the
 * tabs list by, over unresolved states only; nothing is counted before the
 * states are known (no request, no flashing badge); and a failed state
 * lookup costs that badge and nothing else.
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

import NetworkDeviceViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/SideMenu";
import {
  getNetworkDeviceOpenAlertCountQuery,
  getNetworkDeviceOpenIncidentCountQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Utils/NetworkDeviceOpenActivityCountQuery";
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
  PROJECT_ID,
  goTo,
  renderMenu,
  sectionRoot,
  setViewportWidth,
} from "./SideMenuHarness";

const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const INCIDENT_STATE_IDS: Array<string> = [
  "0193c0de-9999-4aaa-8bbb-0000000000a1",
  "0193c0de-9999-4aaa-8bbb-0000000000a2",
];
const ALERT_STATE_IDS: Array<string> = ["0193c0de-9999-4aaa-8bbb-0000000000b1"];

const OPEN_ALERTS: number = 4;
const OPEN_INCIDENTS: number = 2;

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
    modelId: DEVICE_ID,
  }).toString();
}

function countCallFor(modelType: unknown): CountCall | undefined {
  return mockCount.mock.calls
    .map((call: Array<unknown>): CountCall => {
      return call[0] as CountCall;
    })
    .find((call: CountCall): boolean => {
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
    sectionRoot("Activity").querySelectorAll<HTMLAnchorElement>("a"),
  ).find((candidate: HTMLAnchorElement): boolean => {
    return candidate.getAttribute("href") === pagePath(page);
  });

  if (!anchor) {
    throw new Error(`No device menu link to ${page}.`);
  }

  return anchor;
}

// Badge renders its count in a tabular-nums pill; nothing else in the menu does.
function badgesInMenu(): Array<Element> {
  return Array.from(document.querySelectorAll("span.tabular-nums"));
}

async function renderDeviceMenu(): Promise<void> {
  await renderMenu(<NetworkDeviceViewSideMenu modelId={DEVICE_ID} />);
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  // The project first: route population and ProjectUtil read it from the URL.
  goTo(`/dashboard/${PROJECT_ID}/network-devices`);
  goTo(pagePath(PageMap.NETWORK_DEVICE_VIEW));

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

describe("a network device's menu: open incidents and alerts", () => {
  test("badges Incidents and Alerts with the device's open counts", async () => {
    await renderDeviceMenu();

    await waitFor(() => {
      expect(
        within(anchorFor(PageMap.NETWORK_DEVICE_VIEW_ALERTS)).getByText(
          `${OPEN_ALERTS}`,
        ),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        within(anchorFor(PageMap.NETWORK_DEVICE_VIEW_INCIDENTS)).getByText(
          `${OPEN_INCIDENTS}`,
        ),
      ).toBeInTheDocument();
    });
    expect(badgesInMenu()).toHaveLength(2);
  });

  test("the incident count is the device's incidents through the relation the tab lists by, in unresolved states only", async () => {
    await renderDeviceMenu();

    await waitFor(() => {
      expect(countCallFor(Incident)).toBeDefined();
    });

    const query: JSONObject = countCallFor(Incident)!.query;

    expect(Object.keys(query).sort()).toEqual(
      ["currentIncidentStateId", "networkDevices", "projectId"].sort(),
    );
    expect(query["projectId"]!.toString()).toBe(PROJECT_ID);
    expect(idsOf(query["networkDevices"])).toEqual([DEVICE_ID.toString()]);
    expect(idsOf(query["currentIncidentStateId"])).toEqual(INCIDENT_STATE_IDS);
  });

  test("the alert count is the device's alerts through the relation, in unresolved states only", async () => {
    await renderDeviceMenu();

    await waitFor(() => {
      expect(countCallFor(Alert)).toBeDefined();
    });

    const query: JSONObject = countCallFor(Alert)!.query;

    expect(Object.keys(query).sort()).toEqual(
      ["currentAlertStateId", "networkDevices", "projectId"].sort(),
    );
    expect(idsOf(query["networkDevices"])).toEqual([DEVICE_ID.toString()]);
    expect(idsOf(query["currentAlertStateId"])).toEqual(ALERT_STATE_IDS);
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

    await renderDeviceMenu();
    await settle();

    expect(mockCount).not.toHaveBeenCalled();
    expect(badgesInMenu()).toHaveLength(0);
    expect(
      anchorFor(PageMap.NETWORK_DEVICE_VIEW_INCIDENTS),
    ).toBeInTheDocument();
  });

  test("a failed state lookup costs only that badge", async () => {
    mockGetUnresolvedAlertStates.mockImplementation(() => {
      return Promise.reject(new Error("network down"));
    });

    await renderDeviceMenu();

    await waitFor(() => {
      expect(countCallFor(Incident)).toBeDefined();
    });
    await settle();

    expect(countCallFor(Alert)).toBeUndefined();
    expect(anchorFor(PageMap.NETWORK_DEVICE_VIEW_ALERTS)).toBeInTheDocument();
    expect(
      within(anchorFor(PageMap.NETWORK_DEVICE_VIEW_ALERTS)).queryByText(
        `${OPEN_ALERTS}`,
      ),
    ).toBeNull();
  });

  test("a project with no unresolved states counts nothing", async () => {
    mockGetUnresolvedIncidentStates.mockImplementation(() => {
      return Promise.resolve([]);
    });
    mockGetUnresolvedAlertStates.mockImplementation(() => {
      return Promise.resolve([]);
    });

    await renderDeviceMenu();
    await settle();

    expect(mockGetUnresolvedIncidentStates).toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
    expect(badgesInMenu()).toHaveLength(0);
  });

  test("looks the states up for the project in the URL", async () => {
    await renderDeviceMenu();

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

describe("the count queries, on their own", () => {
  const PROJECT: ObjectID = new ObjectID(PROJECT_ID);
  const STATES: Array<ObjectID> = INCIDENT_STATE_IDS.map(
    (id: string): ObjectID => {
      return new ObjectID(id);
    },
  );

  test.each([
    ["no project in the address", null, STATES],
    ["the states still loading", PROJECT, null],
    ["a project with no unresolved states", PROJECT, []],
  ] as Array<[string, ObjectID | null, Array<ObjectID> | null]>)(
    "count nothing with %s",
    (
      _case: string,
      projectId: ObjectID | null,
      unresolvedStateIds: Array<ObjectID> | null,
    ) => {
      const input: {
        projectId: ObjectID | null;
        networkDeviceId: ObjectID;
        unresolvedStateIds: Array<ObjectID> | null;
      } = { projectId, networkDeviceId: DEVICE_ID, unresolvedStateIds };

      expect(getNetworkDeviceOpenIncidentCountQuery(input)).toBeUndefined();
      expect(getNetworkDeviceOpenAlertCountQuery(input)).toBeUndefined();
    },
  );

  test("each counts this device only, in this project", () => {
    const incidentQuery: JSONObject = getNetworkDeviceOpenIncidentCountQuery({
      projectId: PROJECT,
      networkDeviceId: DEVICE_ID,
      unresolvedStateIds: STATES,
    }) as unknown as JSONObject;
    const alertQuery: JSONObject = getNetworkDeviceOpenAlertCountQuery({
      projectId: PROJECT,
      networkDeviceId: DEVICE_ID,
      unresolvedStateIds: STATES,
    }) as unknown as JSONObject;

    for (const query of [incidentQuery, alertQuery]) {
      expect(query["projectId"]!.toString()).toBe(PROJECT_ID);
      expect(idsOf(query["networkDevices"])).toEqual([DEVICE_ID.toString()]);
    }

    expect(idsOf(incidentQuery["currentIncidentStateId"])).toEqual(
      INCIDENT_STATE_IDS,
    );
    expect(idsOf(alertQuery["currentAlertStateId"])).toEqual(
      INCIDENT_STATE_IDS,
    );
  });
});
