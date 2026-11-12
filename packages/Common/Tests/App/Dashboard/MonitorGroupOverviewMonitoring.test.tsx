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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A MONITOR GROUP'S OVERVIEW: ITS MONITORING, AND "DISABLED" (issue #6401).
 *
 * The Overview of a group with monitors carries a Monitoring card that turns
 * monitoring off or on for every one of them, and a group whose monitors
 * all have monitoring off says "Disabled" where its status is shown -
 * nothing checks them, so their worst status is only what their last
 * checks saw. Turning monitoring off or on from the card changes both at
 * once, and reads the group's status again: turning it off resolves
 * incidents, which hands monitors their operational status back.
 *
 * The page is the real one; the API, the details card (drawn as its fields)
 * and the permission gate are stubbed.
 */

const mockGetList: MockFunction = getJestMockFunction();
const mockCount: MockFunction = getJestMockFunction();
const mockPost: MockFunction = getJestMockFunction();
const mockSummary: MockFunction = getJestMockFunction();
const mockSetMonitoring: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return mockCount(...args);
      },
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringAPI",
  () => {
    return {
      __esModule: true,
      fetchMonitorGroupMonitoringSummary: (
        ...args: Array<unknown>
      ): unknown => {
        return mockSummary(...args);
      },
      setMonitorGroupMonitoring: (...args: Array<unknown>): unknown => {
        return mockSetMonitoring(...args);
      },
    };
  },
);

interface MockDetailField {
  title?: string;
  getElement?: (item: unknown) => ReactElement;
}

// The group's details card, drawn as the fields the page computes itself.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      modelDetailProps: { fields: Array<MockDetailField> };
    }): ReactElement => {
      return (
        <div data-testid="group-details">
          {props.modelDetailProps.fields.map(
            (field: MockDetailField, index: number): ReactElement => {
              return (
                <div key={index} data-testid={`detail-${field.title}`}>
                  {field.getElement ? field.getElement({}) : null}
                </div>
              );
            },
          )}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDClass: new (id: string) => unknown = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: new (id: string) => unknown;
          }
        ).default;
        return new ObjectIDClass("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import {
  MONITOR_GROUP_DISABLED_STATUS_TEST_ID,
  MONITOR_GROUP_MONITORING_CARD_TEST_ID,
  MONITOR_GROUP_MONITORING_STATE_TEST_ID,
  MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID,
  MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringCopy";
import MonitorGroupView from "../../../../App/FeatureSet/Dashboard/src/Pages/MonitorGroup/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { MonitorGroupMonitoringSummary } from "../../../Utils/Monitor/MonitorGroupMonitoring";

const GROUP_ID: string = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/monitor-groups/view"),
  currentProject: null,
  hasPaymentMethod: true,
};

function status(
  name: string,
  color: string,
  operational: boolean,
): MonitorStatus {
  const item: MonitorStatus = new MonitorStatus();
  item._id = ObjectID.generate().toString();
  item.name = name;
  item.color = new Color(color);
  item.isOperationalState = operational;
  item.priority = operational ? 1 : 3;
  return item;
}

const OPERATIONAL: MonitorStatus = status("Operational", "#10b981", true);
const OFFLINE: MonitorStatus = status("Offline", "#ef4444", false);

// What the server answers about the group, as the tests set it.
let groupStatus: MonitorStatus = OPERATIONAL;
let summary: MonitorGroupMonitoringSummary | Error = {
  monitorCount: 3,
  monitoringOffCount: 0,
};
let monitorCount: number = 3;

beforeEach(() => {
  groupStatus = OPERATIONAL;
  summary = { monitorCount: 3, monitoringOffCount: 0 };
  monitorCount = 3;

  mockGetList.mockReset();
  mockGetList.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };
    const data: Array<unknown> =
      request.modelType === MonitorStatus ? [OPERATIONAL, OFFLINE] : [];
    return { data, count: data.length, skip: 0, limit: 10 };
  });

  mockCount.mockReset();
  mockCount.mockImplementation(async () => {
    return monitorCount;
  });

  mockPost.mockReset();
  mockPost.mockImplementation(async () => {
    return groupStatus;
  });

  mockSummary.mockReset();
  mockSummary.mockImplementation(async () => {
    if (summary instanceof Error) {
      throw summary;
    }
    return summary;
  });

  mockSetMonitoring.mockReset();

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(GROUP_ID));
  jest.spyOn(PermissionGate, "check").mockReturnValue({
    isAllowed: true,
  } as PermissionGateResult);
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockReturnValue({
    isAllowed: true,
  } as PermissionGateResult);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <MonitorGroupView {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await screen.findByTestId("group-details");
}

function currentStatus(): HTMLElement {
  return screen.getByTestId("detail-Current Status");
}

describe("the group's Current Status", () => {
  test("every monitor with monitoring off: Disabled, not the worst status they last had", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 3 };
    groupStatus = OFFLINE;

    await renderOverview();

    expect(
      within(currentStatus()).getByTestId(
        MONITOR_GROUP_DISABLED_STATUS_TEST_ID,
      ),
    ).toHaveTextContent("Disabled");
    expect(currentStatus()).not.toHaveTextContent("Offline");
  });

  test("some monitors still checked: the worst status among them, as before", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 2 };
    groupStatus = OFFLINE;

    await renderOverview();

    expect(currentStatus()).toHaveTextContent("Offline");
    expect(
      within(currentStatus()).queryByTestId(
        MONITOR_GROUP_DISABLED_STATUS_TEST_ID,
      ),
    ).toBeNull();
  });

  test("it reads this group's monitoring", async () => {
    await renderOverview();

    expect(mockSummary).toHaveBeenCalledTimes(1);
    expect(String(mockSummary.mock.calls[0]![0])).toBe(GROUP_ID);
  });
});

/*
 * THE GROUP'S UPTIME, BESIDE ITS UPTIME GRAPH (issue #6478).
 *
 * Monitors whose monitoring is off are left out of the group's timeline, as
 * from its status. A group none of whose monitors is checked has no
 * timeline left to measure, so it shows no percentage at all, rather than
 * the 100% an empty timeline would read as.
 */
function uptimePercent(): HTMLElement | null {
  return screen.queryByText(/% uptime$/);
}

describe("the group's uptime, beside its Uptime Graph", () => {
  test("some monitors still checked: the percentage is shown", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 2 };

    await renderOverview();

    expect(screen.getByText("Uptime Graph")).toBeVisible();
    expect(uptimePercent()).not.toBeNull();
    expect(uptimePercent()).toHaveTextContent(/^[0-9.]+% uptime$/);
  });

  test("every monitor checked: the percentage is shown, as before", async () => {
    await renderOverview();

    expect(uptimePercent()).not.toBeNull();
  });

  test("every monitor with monitoring off: no percentage, though the graph is still there", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 3 };

    await renderOverview();

    expect(screen.getByText("Uptime Graph")).toBeVisible();
    expect(uptimePercent()).toBeNull();
    expect(screen.queryByText(/100% uptime/)).toBeNull();
  });

  test("when the group's monitoring cannot be read, the percentage is shown as before", async () => {
    summary = new Error("Server Error. Please try again");

    await renderOverview();

    expect(uptimePercent()).not.toBeNull();
  });

  test("monitoring turned off from the card: the percentage goes at once", async () => {
    mockSetMonitoring.mockResolvedValue({
      monitorCount: 3,
      monitoringOffCount: 3,
    } as never);

    await renderOverview();
    expect(uptimePercent()).not.toBeNull();

    fireEvent.click(
      screen.getByTestId(MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Turn off monitoring",
      }),
    );
    await flush();

    expect(uptimePercent()).toBeNull();
  });

  test("every monitor with monitoring off: the graph says why it has no uptime to show", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 3 };

    await renderOverview();

    expect(
      screen.getByText(
        "Monitoring is off for every monitor in this group, so it has no uptime to show.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/over the last 90 days/)).toBeNull();
  });

  test("some monitors with monitoring off: the graph says they are left out", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 1 };

    await renderOverview();

    expect(
      screen.getByText(
        "This group's status over the last 90 days, one bar per day. Monitors whose monitoring is off are left out.",
      ),
    ).toBeVisible();
  });

  test("every monitor checked, or the group's monitoring unread: the graph's description is as before", async () => {
    await renderOverview();

    expect(
      screen.getByText(
        "This group's status over the last 90 days, one bar per day.",
      ),
    ).toBeVisible();

    cleanup();
    summary = new Error("Server Error. Please try again");
    await renderOverview();

    expect(
      screen.getByText(
        "This group's status over the last 90 days, one bar per day.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/left out/)).toBeNull();
  });

  test("monitoring turned off from the card: the graph's description follows at once", async () => {
    mockSetMonitoring.mockResolvedValue({
      monitorCount: 3,
      monitoringOffCount: 3,
    } as never);

    await renderOverview();

    fireEvent.click(
      screen.getByTestId(MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Turn off monitoring",
      }),
    );
    await flush();

    expect(
      screen.getByText(
        "Monitoring is off for every monitor in this group, so it has no uptime to show.",
      ),
    ).toBeVisible();
  });

  test("monitoring turned back on from the card: the percentage is back", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 3 };
    mockSetMonitoring.mockResolvedValue({
      monitorCount: 3,
      monitoringOffCount: 0,
    } as never);

    await renderOverview();
    expect(uptimePercent()).toBeNull();

    fireEvent.click(
      screen.getByTestId(MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID),
    );
    await flush();

    expect(uptimePercent()).not.toBeNull();
  });
});

describe("the Monitoring card", () => {
  test("is on the Overview of a group with monitors, saying how many are checked", async () => {
    summary = { monitorCount: 4, monitoringOffCount: 1 };

    await renderOverview();

    expect(
      screen.getByTestId(MONITOR_GROUP_MONITORING_CARD_TEST_ID),
    ).toBeVisible();
    expect(
      screen.getByTestId(MONITOR_GROUP_MONITORING_STATE_TEST_ID),
    ).toHaveTextContent("Monitoring is off for 1 of 4 monitors in this group.");
    // And the uptime graph is still there.
    expect(screen.getByText("Uptime Graph")).toBeVisible();
  });

  test("is not on the Overview of an empty group: it has nothing to turn", async () => {
    monitorCount = 0;
    summary = { monitorCount: 0, monitoringOffCount: 0 };

    await renderOverview();

    expect(
      screen.queryByTestId(MONITOR_GROUP_MONITORING_CARD_TEST_ID),
    ).toBeNull();
    expect(screen.getByText("No monitors in this group yet")).toBeVisible();
  });

  test("is not there for a group of archived monitors only: none is checked, whatever its switch", async () => {
    monitorCount = 2;
    summary = { monitorCount: 0, monitoringOffCount: 0 };

    await renderOverview();

    expect(
      screen.queryByTestId(MONITOR_GROUP_MONITORING_CARD_TEST_ID),
    ).toBeNull();
  });

  test("when the group's monitoring cannot be read, the card is left out and the page still shows", async () => {
    summary = new Error("Server Error. Please try again");
    groupStatus = OFFLINE;

    await renderOverview();

    expect(
      screen.queryByTestId(MONITOR_GROUP_MONITORING_CARD_TEST_ID),
    ).toBeNull();
    expect(currentStatus()).toHaveTextContent("Offline");
    expect(screen.queryByText("Server Error. Please try again")).toBeNull();
  });
});

describe("turning monitoring off and on from the card", () => {
  test("turned off, the group reads Disabled at once, and its status is read again", async () => {
    mockSetMonitoring.mockResolvedValue({
      monitorCount: 3,
      monitoringOffCount: 3,
    } as never);

    await renderOverview();
    const statusReadsBefore: number = mockPost.mock.calls.length;

    fireEvent.click(
      screen.getByTestId(MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Turn off monitoring",
      }),
    );
    await flush();

    expect(mockSetMonitoring).toHaveBeenCalledWith({
      monitorGroupId: new ObjectID(GROUP_ID),
      isMonitoringOn: false,
    });
    expect(
      within(currentStatus()).getByTestId(
        MONITOR_GROUP_DISABLED_STATUS_TEST_ID,
      ),
    ).toBeVisible();
    expect(
      screen.getByTestId(MONITOR_GROUP_MONITORING_STATE_TEST_ID),
    ).toHaveTextContent("Monitoring is off for every monitor in this group.");
    expect(
      screen.getByTestId(MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID),
    ).toBeVisible();
    expect(mockPost.mock.calls.length).toBe(statusReadsBefore + 1);
  });

  test("turned back on, the group shows its status again", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 3 };
    groupStatus = OFFLINE;
    mockSetMonitoring.mockResolvedValue({
      monitorCount: 3,
      monitoringOffCount: 0,
    } as never);

    await renderOverview();
    expect(
      within(currentStatus()).getByTestId(
        MONITOR_GROUP_DISABLED_STATUS_TEST_ID,
      ),
    ).toBeVisible();

    // The next check has not run yet: the status is what it was.
    fireEvent.click(
      screen.getByTestId(MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID),
    );
    await flush();

    expect(currentStatus()).toHaveTextContent("Offline");
    expect(
      screen.getByTestId(MONITOR_GROUP_MONITORING_STATE_TEST_ID),
    ).toHaveTextContent("Monitoring is on for every monitor in this group.");
  });
});
