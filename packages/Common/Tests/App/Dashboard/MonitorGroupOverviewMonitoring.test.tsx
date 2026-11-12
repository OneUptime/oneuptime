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
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
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
// The group's status timeline (MonitorGroupService.getStatusTimeline).
let timelineRows: Array<MonitorStatusTimeline> = [];

// How many times the page has read the group's timeline.
function timelineReads(): number {
  return mockGetList.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { modelType: unknown }).modelType === MonitorStatusTimeline
    );
  }).length;
}

beforeEach(() => {
  groupStatus = OPERATIONAL;
  summary = { monitorCount: 3, monitoringOffCount: 0 };
  monitorCount = 3;
  timelineRows = [];

  mockGetList.mockReset();
  mockGetList.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };
    const data: Array<unknown> =
      request.modelType === MonitorStatus
        ? [OPERATIONAL, OFFLINE]
        : request.modelType === MonitorStatusTimeline
          ? timelineRows
          : [];
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
 * THE GROUP'S UPTIME, BESIDE ITS UPTIME GRAPH (issues #6478, #6480, #6987).
 *
 * A monitor counts in the group's timeline only while its monitoring is on:
 * its rows up to when monitoring was turned off count, and the rows from
 * then on mark it (isMonitoringOff), which uptime leaves out. So the
 * percentage is of the time some monitor was monitored in the 90 days, and
 * a group none of whose monitors was monitored in them shows none at all,
 * rather than the 100% that no time reads as.
 */
const DAY_MS: number = 24 * 60 * 60 * 1000;
const MONITOR_A: string = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const MONITOR_B: string = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function timelineRow(data: {
  monitorId: string;
  status: MonitorStatus;
  startsAt: Date;
  endsAt?: Date | undefined;
  isMonitoringOff?: boolean | undefined;
}): MonitorStatusTimeline {
  const item: MonitorStatusTimeline = new MonitorStatusTimeline();
  item._id = ObjectID.generate().toString();
  item.monitorId = new ObjectID(data.monitorId);
  item.monitorStatus = data.status;
  item.startsAt = data.startsAt;
  if (data.endsAt) {
    item.endsAt = data.endsAt;
  }
  item.isMonitoringOff = data.isMonitoringOff === true;
  return item;
}

/*
 * Issue #6987's member: Offline for a day ten days ago, then operational,
 * and - when offSince is given - its monitoring turned off then: the row
 * the switch starts marks it.
 */
function offlineTenDaysAgo(
  monitorId: string,
  offSince: Date | null,
): Array<MonitorStatusTimeline> {
  const rows: Array<MonitorStatusTimeline> = [
    timelineRow({
      monitorId: monitorId,
      status: OPERATIONAL,
      startsAt: daysAgo(120),
      endsAt: daysAgo(10),
    }),
    timelineRow({
      monitorId: monitorId,
      status: OFFLINE,
      startsAt: daysAgo(10),
      endsAt: daysAgo(9),
    }),
    timelineRow({
      monitorId: monitorId,
      status: OPERATIONAL,
      startsAt: daysAgo(9),
      endsAt: offSince || undefined,
    }),
  ];

  if (offSince) {
    rows.push(
      timelineRow({
        monitorId: monitorId,
        status: OPERATIONAL,
        startsAt: offSince,
        isMonitoringOff: true,
      }),
    );
  }

  return rows;
}

function offlineTenDaysAgoOffSinceYesterday(
  monitorId: string,
): Array<MonitorStatusTimeline> {
  return offlineTenDaysAgo(monitorId, daysAgo(1));
}

// Operational throughout; when offSince is given, monitoring off since then.
function operationalThroughout(
  monitorId: string,
  offSince?: Date | undefined,
): Array<MonitorStatusTimeline> {
  if (!offSince) {
    return [
      timelineRow({
        monitorId: monitorId,
        status: OPERATIONAL,
        startsAt: daysAgo(120),
      }),
    ];
  }

  return [
    timelineRow({
      monitorId: monitorId,
      status: OPERATIONAL,
      startsAt: daysAgo(120),
      endsAt: offSince,
    }),
    timelineRow({
      monitorId: monitorId,
      status: OPERATIONAL,
      startsAt: offSince,
      isMonitoringOff: true,
    }),
  ];
}

// Monitoring off since before the 90 days the graph is drawn over.
function offSinceLongAgo(monitorId: string): Array<MonitorStatusTimeline> {
  return [
    timelineRow({
      monitorId: monitorId,
      status: OFFLINE,
      startsAt: daysAgo(130),
      endsAt: daysAgo(100),
    }),
    timelineRow({
      monitorId: monitorId,
      status: OFFLINE,
      startsAt: daysAgo(100),
      isMonitoringOff: true,
    }),
  ];
}

function uptimePercent(): HTMLElement | null {
  return screen.queryByText(/% uptime$/);
}

const MIXED_DESCRIPTION: string =
  "This group's status over the last 90 days, one bar per day. Each monitor counts only while its monitoring is on.";
const OFF_DESCRIPTION: string =
  "This group's status over the last 90 days, one bar per day, up to when monitoring was turned off for all of its monitors.";
const DEFAULT_DESCRIPTION: string =
  "This group's status over the last 90 days, one bar per day.";

async function turnMonitoringOffFromTheCard(): Promise<void> {
  fireEvent.click(
    screen.getByTestId(MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Turn off monitoring",
    }),
  );
  await flush();
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

  /*
   * Issue #6987's group: the member's Offline day ten days ago still counts
   * against the group, and the day since its monitoring was turned off is
   * left out. The other monitor is checked throughout, so the group was
   * monitored for all 90 days: 89 of them up. Before, the member's rows
   * were all left out and the group read 100%.
   */
  test("a member Offline for a day ten days ago, its monitoring off since yesterday: its day still counts", async () => {
    summary = { monitorCount: 2, monitoringOffCount: 1 };
    timelineRows = [
      ...offlineTenDaysAgoOffSinceYesterday(MONITOR_A),
      ...operationalThroughout(MONITOR_B),
    ];

    await renderOverview();

    expect(uptimePercent()).toHaveTextContent("98.888% uptime");
    expect(screen.getByText(MIXED_DESCRIPTION)).toBeVisible();
    // In the colour of the group's status: some monitors are still checked.
    expect(screen.getByTestId("monitor-group-uptime-percent")).toHaveStyle({
      color: OPERATIONAL.color!.toString(),
    });
  });

  /*
   * Every member like that one: the group was monitored until yesterday,
   * so its uptime is of those 89 days, one of them Offline - not of the
   * day since, which nothing checked.
   */
  test("every member's monitoring off since yesterday: the percentage of the time before, in grey", async () => {
    summary = { monitorCount: 2, monitoringOffCount: 2 };
    groupStatus = OFFLINE;
    timelineRows = [
      ...offlineTenDaysAgoOffSinceYesterday(MONITOR_A),
      ...offlineTenDaysAgoOffSinceYesterday(MONITOR_B),
    ];

    await renderOverview();

    expect(uptimePercent()).toHaveTextContent("98.876% uptime");
    expect(screen.getByText(OFF_DESCRIPTION)).toBeVisible();
    // Grey, as the group's Disabled status: not the Offline its monitors were left at.
    expect(screen.getByTestId("monitor-group-uptime-percent")).toHaveStyle({
      color: "#6b7280",
    });
    expect(
      within(currentStatus()).getByTestId(
        MONITOR_GROUP_DISABLED_STATUS_TEST_ID,
      ),
    ).toBeVisible();
  });

  test("every member's monitoring off since before the 90 days: no percentage, though the graph is still there", async () => {
    summary = { monitorCount: 2, monitoringOffCount: 2 };
    timelineRows = [
      ...offSinceLongAgo(MONITOR_A),
      ...offSinceLongAgo(MONITOR_B),
    ];

    await renderOverview();

    expect(screen.getByText("Uptime Graph")).toBeVisible();
    expect(screen.getByText(OFF_DESCRIPTION)).toBeVisible();
    expect(uptimePercent()).toBeNull();
    expect(screen.queryByText(/100% uptime/)).toBeNull();
  });

  // One member checked throughout: the group was monitored, and up.
  test("one member off since before the 90 days, the other checked: the other's uptime", async () => {
    summary = { monitorCount: 2, monitoringOffCount: 1 };
    timelineRows = [
      ...offSinceLongAgo(MONITOR_A),
      ...operationalThroughout(MONITOR_B),
    ];

    await renderOverview();

    // The Offline the first was left at counts for nothing.
    expect(uptimePercent()).toHaveTextContent("100% uptime");
  });

  test("when the group's monitoring cannot be read, the percentage is shown as before", async () => {
    summary = new Error("Server Error. Please try again");

    await renderOverview();

    expect(uptimePercent()).not.toBeNull();
  });

  /*
   * Turning monitoring off from the card leaves the group's history as it
   * was: the percentage stays, grey now, and the timeline is read again so
   * the time from the switch on is left out.
   */
  test("monitoring turned off from the card: the percentage stays, in grey, and the timeline is read again", async () => {
    summary = { monitorCount: 2, monitoringOffCount: 0 };
    mockSetMonitoring.mockResolvedValue({
      monitorCount: 2,
      monitoringOffCount: 2,
    } as never);
    timelineRows = [
      ...offlineTenDaysAgo(MONITOR_A, null),
      ...operationalThroughout(MONITOR_B),
    ];

    await renderOverview();
    expect(uptimePercent()).toHaveTextContent("98.888% uptime");
    expect(screen.getByTestId("monitor-group-uptime-percent")).toHaveStyle({
      color: OPERATIONAL.color!.toString(),
    });
    const timelineReadsBefore: number = timelineReads();

    // What the server answers once the switch has marked both timelines.
    const switchedAt: Date = new Date(Date.now() - 60 * 1000);
    timelineRows = [
      ...offlineTenDaysAgo(MONITOR_A, switchedAt),
      ...operationalThroughout(MONITOR_B, switchedAt),
    ];

    await turnMonitoringOffFromTheCard();

    expect(timelineReads()).toBe(timelineReadsBefore + 1);
    // The 90 days before the switch still count, the Offline day with them.
    expect(uptimePercent()).toHaveTextContent("98.888% uptime");
    expect(screen.getByTestId("monitor-group-uptime-percent")).toHaveStyle({
      color: "#6b7280",
    });
  });

  test("every monitor with monitoring off: the graph says it ends where monitoring was turned off", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 3 };

    await renderOverview();

    expect(screen.getByText(OFF_DESCRIPTION)).toBeVisible();
    expect(screen.queryByText(MIXED_DESCRIPTION)).toBeNull();
    expect(screen.queryByText(/has no uptime to show/)).toBeNull();
  });

  test("some monitors with monitoring off: the graph says each counts only while it is on", async () => {
    summary = { monitorCount: 3, monitoringOffCount: 1 };

    await renderOverview();

    expect(screen.getByText(MIXED_DESCRIPTION)).toBeVisible();
    expect(screen.queryByText(/are left out/)).toBeNull();
  });

  test("every monitor checked, or the group's monitoring unread: the graph's description is as before", async () => {
    await renderOverview();

    expect(screen.getByText(DEFAULT_DESCRIPTION)).toBeVisible();

    cleanup();
    summary = new Error("Server Error. Please try again");
    await renderOverview();

    expect(screen.getByText(DEFAULT_DESCRIPTION)).toBeVisible();
    expect(screen.queryByText(/monitoring is on/)).toBeNull();
    expect(screen.queryByText(/turned off/)).toBeNull();
  });

  test("monitoring turned off from the card: the graph's description follows at once", async () => {
    mockSetMonitoring.mockResolvedValue({
      monitorCount: 3,
      monitoringOffCount: 3,
    } as never);

    await renderOverview();
    expect(screen.getByText(DEFAULT_DESCRIPTION)).toBeVisible();

    await turnMonitoringOffFromTheCard();

    expect(screen.getByText(OFF_DESCRIPTION)).toBeVisible();
  });

  test("monitoring turned back on from the card: the timeline is read again, and the percentage is back", async () => {
    summary = { monitorCount: 2, monitoringOffCount: 2 };
    timelineRows = [
      ...offSinceLongAgo(MONITOR_A),
      ...offSinceLongAgo(MONITOR_B),
    ];
    mockSetMonitoring.mockResolvedValue({
      monitorCount: 2,
      monitoringOffCount: 0,
    } as never);

    await renderOverview();
    expect(uptimePercent()).toBeNull();

    // Turned back on an hour ago: that hour counts.
    timelineRows = [MONITOR_A, MONITOR_B].flatMap(
      (monitorId: string): Array<MonitorStatusTimeline> => {
        return [
          timelineRow({
            monitorId: monitorId,
            status: OFFLINE,
            startsAt: daysAgo(100),
            endsAt: new Date(Date.now() - 60 * 60 * 1000),
            isMonitoringOff: true,
          }),
          timelineRow({
            monitorId: monitorId,
            status: OPERATIONAL,
            startsAt: new Date(Date.now() - 60 * 60 * 1000),
          }),
        ];
      },
    );

    fireEvent.click(
      screen.getByTestId(MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID),
    );
    await flush();

    expect(uptimePercent()).toHaveTextContent("100% uptime");
    expect(screen.getByText(DEFAULT_DESCRIPTION)).toBeVisible();
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
