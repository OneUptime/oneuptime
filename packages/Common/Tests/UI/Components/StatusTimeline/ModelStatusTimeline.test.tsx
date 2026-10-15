/** @timezone UTC */

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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";

configure({ asyncUtilTimeout: 15000 });

/*
 * ModelStatusTimeline: a record's status rows, read through ModelAPI and
 * drawn as a timeline, with every action the table had.
 *
 *   - the window it reads: for a monitor, the rows that began in the period
 *     (newest first, a page at a time) and the one row in effect when it
 *     began - never every row of a monitor with years of history; for an
 *     incident, its whole history, fitted to the band;
 *   - moving through time re-reads: the range picker, the period before
 *     and after, a zoom and its reset;
 *   - Create, View Cause, View Logs, Show ID and Delete, gated by the
 *     viewer's permissions as the table gates them, with the page's own
 *     delete locks and dialogs.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
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

interface ListCall {
  model: string;
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  sort: Record<string, unknown>;
  select: Record<string, unknown>;
}

const listCalls: Array<ListCall> = [];
const getItemCalls: Array<{ id: string; select: Record<string, unknown> }> = [];
const deleteCalls: Array<string> = [];
let rowsInStore: Array<unknown> = [];
let failReads: boolean = false;
let failDelete: string = "";
let countOverride: number | null = null;

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  const time: (value: unknown) => number = (value: unknown): number => {
    return new Date(value as Date).getTime();
  };

  return {
    __esModule: true,
    default: {
      getList: async (data: {
        modelType: { name: string };
        query: Record<string, unknown>;
        limit: number;
        skip: number;
        sort: Record<string, unknown>;
        select: Record<string, unknown>;
      }): Promise<unknown> => {
        listCalls.push({
          model: data.modelType.name,
          query: data.query,
          limit: data.limit,
          skip: data.skip,
          sort: data.sort,
          select: data.select,
        });

        if (failReads) {
          throw new Error("Error connecting to server.");
        }

        const bound: {
          constructor?: { name: string };
          value?: unknown;
          startValue?: unknown;
          endValue?: unknown;
        } = data.query["startsAt"] as {
          constructor?: { name: string };
          value?: unknown;
          startValue?: unknown;
          endValue?: unknown;
        };

        const rows: Array<{ startsAt: Date }> = (
          rowsInStore as Array<{ startsAt: Date }>
        )
          .filter((row: { startsAt: Date }): boolean => {
            if (!bound) {
              return true;
            }

            const startsAt: number = time(row.startsAt);

            if (bound.constructor?.name === "InBetween") {
              return (
                startsAt >= time(bound.startValue) &&
                startsAt <= time(bound.endValue)
              );
            }

            if (bound.constructor?.name === "LessThan") {
              return startsAt < time(bound.value);
            }

            return true;
          })
          .sort((a: { startsAt: Date }, b: { startsAt: Date }): number => {
            return time(b.startsAt) - time(a.startsAt);
          });

        return {
          data: rows.slice(data.skip, data.skip + data.limit),
          count: countOverride ?? rows.length,
          skip: data.skip,
          limit: data.limit,
        };
      },
      getItem: async (data: {
        id: { toString: () => string };
        select: Record<string, unknown>;
      }): Promise<unknown> => {
        getItemCalls.push({ id: data.id.toString(), select: data.select });

        return (
          (rowsInStore as Array<{ _id: string }>).find(
            (row: { _id: string }): boolean => {
              return row._id === data.id.toString();
            },
          ) || null
        );
      },
      deleteItem: async (data: {
        id: { toString: () => string };
      }): Promise<void> => {
        deleteCalls.push(data.id.toString());

        if (failDelete) {
          throw new Error(failDelete);
        }

        rowsInStore = (rowsInStore as Array<{ _id: string }>).filter(
          (row: { _id: string }): boolean => {
            return row._id !== data.id.toString();
          },
        );
      },
    },
  };
});

// The create dialog is ModelForm's own concern; here, what it is opened with.
let createModalProps: Record<string, unknown> | null = null;

jest.mock("../../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      createModalProps = props;

      return React.createElement(
        "div",
        { "data-testid": "create-modal" },
        React.createElement("p", null, props["title"] as string),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              (props["onSuccess"] as () => void)();
            },
          },
          props["submitButtonText"] as string,
        ),
      );
    },
  };
});

jest.mock("../../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import ModelStatusTimeline, {
  ComponentProps,
  STATUS_TIMELINE_PAGE_SIZE,
} from "../../../../UI/Components/StatusTimeline/ModelStatusTimeline";
import { DeleteConfirmation } from "../../../../UI/Components/ModelTable/BaseModelTable";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import User from "../../../../Models/DatabaseModels/User";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import TimeRange from "../../../../Types/Time/TimeRange";
import Timezone from "../../../../Types/Timezone";
import BadDataException from "../../../../Types/Exception/BadDataException";
import getJestMockFunction, { MockFunction } from "../../../MockType";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-10-14T08:36:00.000Z");
const MONITOR_ID: string = "6c1f0a0e-2222-4c1e-9a1e-000000000002";
const PROJECT_ID: string = "5b1f0a0e-1111-4c1e-9a1e-000000000001";

const at: (offsetMs: number) => Date = (offsetMs: number): Date => {
  return new Date(NOW.getTime() + offsetMs);
};

const status: (data: {
  id: string;
  name: string;
  color: string;
  priority: number;
}) => MonitorStatus = (data: {
  id: string;
  name: string;
  color: string;
  priority: number;
}): MonitorStatus => {
  const value: MonitorStatus = new MonitorStatus();
  value._id = data.id;
  value.name = data.name;
  value.color = new Color(data.color);
  value.priority = data.priority;
  return value;
};

const OPERATIONAL: MonitorStatus = status({
  id: "11111111-aaaa-4aaa-8aaa-000000000001",
  name: "Operational",
  color: "#10b981",
  priority: 1,
});
const OFFLINE: MonitorStatus = status({
  id: "11111111-aaaa-4aaa-8aaa-000000000003",
  name: "Offline",
  color: "#ef4444",
  priority: 3,
});

let rowCounter: number = 0;

const monitorRow: (data: {
  status: MonitorStatus;
  from: number;
  to: number | null;
  changedBy?: string;
  rootCause?: string;
}) => MonitorStatusTimeline = (data: {
  status: MonitorStatus;
  from: number;
  to: number | null;
  changedBy?: string;
  rootCause?: string;
}): MonitorStatusTimeline => {
  rowCounter++;
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row._id = `7e1f0a0e-4444-4c1e-9a1e-${String(rowCounter).padStart(12, "0")}`;
  row.monitorStatus = data.status;
  row.startsAt = at(data.from);

  if (data.to !== null) {
    row.endsAt = at(data.to);
  }

  if (data.rootCause) {
    row.rootCause = data.rootCause;
  }

  row.statusChangeLog = { responseCode: 503 } as JSONObject;

  if (data.changedBy) {
    const user: User = new User();
    user._id = "9d3f0c0e-3333-4e3e-9c3e-000000000003";
    user.name = new Name(data.changedBy);
    row.createdByUser = user;
  }

  return row;
};

let onFetchSuccess: MockFunction;

const monitorProps: (
  overrides?: Partial<ComponentProps<MonitorStatusTimeline>>,
) => ComponentProps<MonitorStatusTimeline> = (
  overrides?: Partial<ComponentProps<MonitorStatusTimeline>>,
): ComponentProps<MonitorStatusTimeline> => {
  return {
    modelType: MonitorStatusTimeline,
    id: "monitor-status-timeline",
    name: "Monitor > Status Timeline",
    title: "Status Timeline",
    description:
      "Each status this monitor has been in, when it began and how long it lasted.",
    query: {
      monitorId: new ObjectID(MONITOR_ID),
      projectId: new ObjectID(PROJECT_ID),
    },
    stateColumn: "monitorStatus",
    stateSelect: { priority: true },
    getStateRank: (state: JSONObject): number | undefined => {
      return typeof state["priority"] === "number"
        ? (state["priority"] as number)
        : undefined;
    },
    defaultRange: TimeRange.PAST_ONE_MONTH,
    showShare: true,
    ariaLabel: "Status timeline of this monitor",
    emptyMessage: "No status recorded for this monitor yet.",
    isCreateable: true,
    formFields: [],
    isDeleteable: true,
    causeColumn: "rootCause",
    logColumn: "statusChangeLog",
    showViewIdButton: true,
    onFetchSuccess: onFetchSuccess as unknown as () => void,
    getItemName: (item: MonitorStatusTimeline): string => {
      return `${item.monitorStatus?.name || ""} event`;
    },
    ...(overrides || {}),
  };
};

const renderMonitor: (
  overrides?: Partial<ComponentProps<MonitorStatusTimeline>>,
) => Promise<void> = async (
  overrides?: Partial<ComponentProps<MonitorStatusTimeline>>,
): Promise<void> => {
  await act(async () => {
    render(<ModelStatusTimeline {...monitorProps(overrides)} />);
  });

  await waitFor(() => {
    expect(
      screen.queryByTestId("status-timeline-loading"),
    ).not.toBeInTheDocument();
  });
};

// The rows ModelStatusTimeline read for the band, in the order it asked.
const timelineReads: () => Array<ListCall> = (): Array<ListCall> => {
  return listCalls.filter((call: ListCall): boolean => {
    return (
      call.model === "MonitorStatusTimeline" ||
      call.model === "IncidentStateTimeline"
    );
  });
};

const entryRow: (index: number) => HTMLElement = (
  index: number,
): HTMLElement => {
  return screen.getAllByTestId("status-timeline-entry")[index]!;
};

const openEntryMenu: (index: number) => Promise<HTMLElement> = async (
  index: number,
): Promise<HTMLElement> => {
  fireEvent.click(
    within(entryRow(index)).getByTestId("row-actions-more-button"),
  );

  return screen.findByRole("menu");
};

const STANDARD_HISTORY: () => Array<MonitorStatusTimeline> =
  (): Array<MonitorStatusTimeline> => {
    return [
      // Began long before the period, and was still in effect when it began.
      monitorRow({ status: OPERATIONAL, from: -60 * DAY, to: -5 * DAY }),
      monitorRow({
        status: OFFLINE,
        from: -5 * DAY,
        to: -5 * DAY + 38 * SECOND,
        rootCause: "Response status code is **503**.",
      }),
      monitorRow({
        status: OPERATIONAL,
        from: -5 * DAY + 38 * SECOND,
        to: null,
        changedBy: "Ada Lovelace",
      }),
    ];
  };

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  OneUptimeDate.setUserTimezone("UTC" as Timezone);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
  permissionsForTest = [Permission.ProjectOwner];
  listCalls.length = 0;
  getItemCalls.length = 0;
  deleteCalls.length = 0;
  rowsInStore = STANDARD_HISTORY();
  failReads = false;
  failDelete = "";
  countOverride = null;
  createModalProps = null;
  onFetchSuccess = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("what a monitor's timeline reads", () => {
  test("the rows that began in the past month, newest first, a page at a time", async () => {
    await renderMonitor();

    const [inPeriod] = timelineReads();
    const between: InBetween<Date> = inPeriod!.query[
      "startsAt"
    ] as InBetween<Date>;

    expect(between).toBeInstanceOf(InBetween);
    expect(new Date(between.endValue).getTime()).toBe(NOW.getTime());
    expect(OneUptimeDate.fromString(between.startValue).toISOString()).toBe(
      OneUptimeDate.addRemoveMonths(NOW, -1).toISOString(),
    );
    expect(inPeriod!.query["monitorId"]).toEqual(new ObjectID(MONITOR_ID));
    expect(inPeriod!.query["projectId"]).toEqual(new ObjectID(PROJECT_ID));
    expect(inPeriod!.sort).toEqual({ startsAt: SortOrder.Descending });
    expect(inPeriod!.limit).toBe(STATUS_TIMELINE_PAGE_SIZE);
    expect(inPeriod!.skip).toBe(0);
  });

  test("and the one row in effect when the period began - one row, never the rest of the history", async () => {
    await renderMonitor();

    const [inPeriod, before] = timelineReads();
    const lessThan: LessThan<Date> = before!.query[
      "startsAt"
    ] as LessThan<Date>;

    expect(lessThan).toBeInstanceOf(LessThan);
    expect(new Date(lessThan.value).getTime()).toBe(
      new Date(
        (inPeriod!.query["startsAt"] as InBetween<Date>).startValue,
      ).getTime(),
    );
    expect(before!.limit).toBe(1);
    expect(before!.sort).toEqual({ startsAt: SortOrder.Descending });
    expect(timelineReads()).toHaveLength(2);
  });

  test("selects the status with its colour and rank, and who changed it", async () => {
    await renderMonitor();

    expect(timelineReads()[0]!.select).toEqual({
      _id: true,
      startsAt: true,
      endsAt: true,
      monitorStatus: { _id: true, name: true, color: true, priority: true },
      createdByUser: { _id: true, name: true, email: true },
    });
  });

  test("the cause and the log are not read with the list: they are read when asked for", async () => {
    await renderMonitor();

    for (const call of timelineReads()) {
      expect(call.select).not.toHaveProperty("rootCause");
      expect(call.select).not.toHaveProperty("statusChangeLog");
    }
  });

  test("draws the row in effect when the period began, then the period's rows", async () => {
    await renderMonitor();

    expect(
      screen
        .getAllByTestId("status-timeline-entry-name")
        .map((element: HTMLElement): string | null => {
          return element.textContent;
        }),
    ).toEqual(["Operational", "Offline", "Operational"]);
    expect(
      within(entryRow(0)).getByTestId("status-timeline-entry-changed-by"),
    ).toHaveTextContent("by Ada Lovelace");
  });

  test("reads which rows a delete is refused for after every load", async () => {
    await renderMonitor();

    expect(onFetchSuccess).toHaveBeenCalledTimes(1);
  });

  test("a period with more rows than a page: the newest page, the rest a click away", async () => {
    countOverride = 7;

    await renderMonitor();

    // The row in effect when the period began is not drawn: rows in between are missing.
    expect(screen.getAllByTestId("status-timeline-entry")).toHaveLength(2);
    expect(
      screen.getByTestId("status-timeline-gap-load-older"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-timeline-gap-load-older"));
    });

    const olderPage: ListCall = timelineReads()[2]!;

    expect(olderPage.skip).toBe(2);
    expect(olderPage.query["startsAt"]).toBeInstanceOf(InBetween);
  });
});

describe("moving through time", () => {
  test("picking another period reads it", async () => {
    await renderMonitor();

    fireEvent.click(screen.getByTestId("monitor-status-timeline-range-button"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Past 1 Week" }));
    });

    const between: InBetween<Date> = timelineReads()[2]!.query[
      "startsAt"
    ] as InBetween<Date>;

    expect(
      new Date(between.endValue).getTime() -
        new Date(between.startValue).getTime(),
    ).toBe(7 * DAY);
  });

  test("the period before is as long, and ends where this one began", async () => {
    await renderMonitor();

    const first: InBetween<Date> = timelineReads()[0]!.query[
      "startsAt"
    ] as InBetween<Date>;

    await act(async () => {
      fireEvent.click(screen.getByTestId("monitor-status-timeline-earlier"));
    });

    const earlier: InBetween<Date> = timelineReads()[2]!.query[
      "startsAt"
    ] as InBetween<Date>;

    expect(new Date(earlier.endValue).getTime()).toBe(
      new Date(first.startValue).getTime(),
    );
    expect(screen.getByTestId("monitor-status-timeline-later")).toBeEnabled();
  });

  test("nothing is later than now", async () => {
    await renderMonitor();

    expect(screen.getByTestId("monitor-status-timeline-later")).toBeDisabled();
  });

  test("nothing earlier to show for a monitor whose history began in the period", async () => {
    rowsInStore = [monitorRow({ status: OPERATIONAL, from: -HOUR, to: null })];

    await renderMonitor();

    expect(
      screen.getByTestId("monitor-status-timeline-earlier"),
    ).toBeDisabled();
    expect(screen.queryByTestId("status-timeline-show-earlier")).toBeNull();
  });

  test("zooming into a cluster reads that stretch; Reset zoom goes back", async () => {
    rowsInStore = [
      monitorRow({ status: OPERATIONAL, from: -60 * DAY, to: -10 * DAY }),
      monitorRow({ status: OFFLINE, from: -10 * DAY, to: -10 * DAY + MINUTE }),
      monitorRow({
        status: OPERATIONAL,
        from: -10 * DAY + MINUTE,
        to: -10 * DAY + 2 * MINUTE,
      }),
      monitorRow({
        status: OFFLINE,
        from: -10 * DAY + 2 * MINUTE,
        to: -10 * DAY + 3 * MINUTE,
      }),
      monitorRow({
        status: OPERATIONAL,
        from: -10 * DAY + 3 * MINUTE,
        to: null,
      }),
    ];

    await renderMonitor();

    await act(async () => {
      fireEvent.click(screen.getByTestId("status-timeline-cluster"));
    });

    const zoomed: InBetween<Date> = timelineReads()[2]!.query[
      "startsAt"
    ] as InBetween<Date>;

    expect(new Date(zoomed.startValue).getTime()).toBeLessThanOrEqual(
      at(-10 * DAY).getTime(),
    );
    expect(new Date(zoomed.endValue).getTime()).toBeGreaterThanOrEqual(
      at(-10 * DAY + 3 * MINUTE).getTime(),
    );
    expect(
      new Date(zoomed.endValue).getTime() -
        new Date(zoomed.startValue).getTime(),
    ).toBeLessThan(HOUR);
    // The picker names the stretch on screen.
    expect(
      screen.getByTestId("monitor-status-timeline-range-button"),
    ).not.toHaveTextContent("Past 1 Month");

    await act(async () => {
      fireEvent.click(screen.getByTestId("monitor-status-timeline-reset-zoom"));
    });

    expect(
      screen.getByTestId("monitor-status-timeline-range-button"),
    ).toHaveTextContent("Past 1 Month");
    expect(
      screen.queryByTestId("monitor-status-timeline-reset-zoom"),
    ).toBeNull();
  });

  test("Refresh reads the period again", async () => {
    await renderMonitor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });

    // The same period, read again: the rows in it and the row before it.
    expect(timelineReads()).toHaveLength(4);
    expect(timelineReads()[2]!.query["startsAt"]).toEqual(
      timelineReads()[0]!.query["startsAt"],
    );
    expect(onFetchSuccess).toHaveBeenCalledTimes(2);
  });
});

describe("creating a status event", () => {
  test("the Create button opens the form, worded as the table words it, and the period re-reads after", async () => {
    await renderMonitor();

    fireEvent.click(
      screen.getByRole("button", { name: "Create Monitor Status Event" }),
    );

    expect(screen.getByTestId("create-modal")).toHaveTextContent(
      "Create New Monitor Status Event",
    );
    expect(createModalProps?.["submitButtonText"]).toBe(
      "Create Monitor Status Event",
    );

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("create-modal")).getByRole("button"),
      );
    });

    expect(screen.queryByTestId("create-modal")).toBeNull();
    expect(timelineReads().length).toBe(4);
  });

  test("hands the page's onBeforeCreate the new row", async () => {
    const onBeforeCreate: MockFunction =
      getJestMockFunction().mockImplementation(
        async (item: unknown): Promise<unknown> => {
          return item;
        },
      );

    await renderMonitor({
      onBeforeCreate: onBeforeCreate as unknown as (
        item: MonitorStatusTimeline,
      ) => Promise<MonitorStatusTimeline>,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Create Monitor Status Event" }),
    );

    const row: MonitorStatusTimeline = new MonitorStatusTimeline();
    await (
      createModalProps?.["onBeforeCreate"] as (
        item: MonitorStatusTimeline,
      ) => Promise<MonitorStatusTimeline>
    )(row);

    expect(onBeforeCreate).toHaveBeenCalledWith(row);
  });

  test("a viewer who may not create sees it locked, saying which permission is missing", async () => {
    permissionsForTest = [Permission.Viewer];

    await renderMonitor();

    const create: HTMLElement = screen.getByRole("button", {
      name: "Create Monitor Status Event",
    });

    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(screen.queryByTestId("create-modal")).toBeNull();
  });

  test("an empty history offers Create where the reader is looking", async () => {
    rowsInStore = [];

    await renderMonitor();

    expect(screen.getByTestId("status-timeline-empty")).toHaveTextContent(
      "No status recorded for this monitor yet.",
    );
    fireEvent.click(
      screen.getByTestId("monitor-status-timeline-empty-create-button"),
    );
    expect(screen.getByTestId("create-modal")).toBeInTheDocument();
  });
});

describe("an entry's actions", () => {
  test("View cause reads the cause when asked, and shows it", async () => {
    await renderMonitor();

    await act(async () => {
      fireEvent.click(
        within(entryRow(1)).getByTestId("monitor-status-timeline-view-cause"),
      );
    });

    expect(getItemCalls).toEqual([
      {
        id: (rowsInStore[1] as MonitorStatusTimeline)._id!,
        select: { rootCause: true },
      },
    ]);
    expect(await screen.findByTestId("markdown")).toHaveTextContent(
      "Response status code is **503**.",
    );
  });

  test("an event with no recorded cause says so", async () => {
    await renderMonitor({
      noCauseText:
        "No root cause. This monitor status could be created manually.",
    });

    await act(async () => {
      fireEvent.click(
        within(entryRow(0)).getByTestId("monitor-status-timeline-view-cause"),
      );
    });

    expect(await screen.findByTestId("markdown")).toHaveTextContent(
      "No root cause. This monitor status could be created manually.",
    );
  });

  test("the cause link names the event for a screen reader", async () => {
    await renderMonitor();

    expect(
      within(entryRow(1)).getByTestId("monitor-status-timeline-view-cause"),
    ).toHaveAccessibleName("View the cause of Offline event");
  });

  test("the ⋯ menu holds Show ID, View Cause, View Logs and, last, Delete", async () => {
    await renderMonitor();

    const menu: HTMLElement = await openEntryMenu(1);

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string | undefined => {
          return item.textContent?.trim();
        }),
    ).toEqual(["Show ID", "View Cause", "View Logs", "Delete"]);
  });

  test("View Logs reads the log when asked, and shows it", async () => {
    await renderMonitor();

    const menu: HTMLElement = await openEntryMenu(1);

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: "View Logs" }),
      );
    });

    expect(getItemCalls[0]!.select).toEqual({ statusChangeLog: true });
    expect(await screen.findByText(/"responseCode": 503/)).toBeInTheDocument();
  });

  test("Show ID shows the event's id", async () => {
    await renderMonitor();

    const menu: HTMLElement = await openEntryMenu(1);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Show ID" }));

    expect(
      await screen.findByText((rowsInStore[1] as MonitorStatusTimeline)._id!),
    ).toBeInTheDocument();
  });

  test("the ⋯ is named after the event, as the table's row menu is", async () => {
    await renderMonitor();

    expect(
      within(entryRow(1)).getByRole("button", {
        name: "More actions for Offline event",
      }),
    ).toBeInTheDocument();
  });
});

describe("deleting a status event", () => {
  test("asks with the page's own words, then deletes that one event and reads the period again", async () => {
    const getDeleteConfirmation: MockFunction =
      getJestMockFunction().mockImplementation(
        async (): Promise<DeleteConfirmation> => {
          return {
            description: (
              <span data-testid="page-delete-words">
                Are you sure you want to delete the Offline status event?
              </span>
            ),
          };
        },
      );

    await renderMonitor({
      getDeleteConfirmation: getDeleteConfirmation as unknown as (
        item: MonitorStatusTimeline,
      ) => Promise<DeleteConfirmation>,
    });

    const target: MonitorStatusTimeline =
      rowsInStore[1] as MonitorStatusTimeline;
    const menu: HTMLElement = await openEntryMenu(1);

    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    });

    expect(getDeleteConfirmation).toHaveBeenCalledTimes(1);
    expect(
      (getDeleteConfirmation.mock.calls[0]![0] as MonitorStatusTimeline)._id,
    ).toBe(target._id);
    expect(await screen.findByTestId("page-delete-words")).toBeInTheDocument();
    expect(deleteCalls).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(deleteCalls).toEqual([target._id]);
    await waitFor(() => {
      expect(screen.getAllByTestId("status-timeline-entry")).toHaveLength(2);
    });
    expect(onFetchSuccess).toHaveBeenCalledTimes(2);
  });

  test("an event the server would refuse is locked, in the page's words, and asks nothing", async () => {
    const reason: string =
      "The monitor's only status event can't be deleted: the monitor would have no status, and status pages would show it gray. To change its status, add a new status event.";

    await renderMonitor({
      getDeleteDisabledReason: (
        item: MonitorStatusTimeline,
      ): string | undefined => {
        return item._id === (rowsInStore[0] as MonitorStatusTimeline)._id
          ? reason
          : undefined;
      },
    });

    // The oldest is the last entry of the list.
    const menu: HTMLElement = await openEntryMenu(2);
    const remove: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    expect(remove).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(remove);
    });

    expect(screen.queryByTestId("modal-footer-submit-button")).toBeNull();
    expect(deleteCalls).toEqual([]);
  });

  test("a refusal found while asking is said instead of asking", async () => {
    await renderMonitor({
      getDeleteConfirmation: async (): Promise<DeleteConfirmation> => {
        throw new BadDataException(
          "The monitor's oldest status event can't be deleted while it covers part of the last 90 days.",
        );
      },
    });

    const menu: HTMLElement = await openEntryMenu(1);

    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    });

    expect(
      await screen.findByText(
        "The monitor's oldest status event can't be deleted while it covers part of the last 90 days.",
      ),
    ).toBeInTheDocument();
    expect(deleteCalls).toEqual([]);
  });

  test("the server's refusal is shown, and nothing is drawn as deleted", async () => {
    failDelete =
      "You do not have permission to delete this Monitor Status Event.";

    await renderMonitor({
      getDeleteConfirmation: async (): Promise<DeleteConfirmation> => {
        return { description: "Delete it?" };
      },
    });

    const menu: HTMLElement = await openEntryMenu(1);

    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(
      await screen.findByText(
        "You do not have permission to delete this Monitor Status Event.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("status-timeline-entry")).toHaveLength(3);
  });

  test("a viewer who may not delete sees Delete locked, saying which permission is missing", async () => {
    permissionsForTest = [Permission.Viewer];

    await renderMonitor();

    const menu: HTMLElement = await openEntryMenu(1);
    const remove: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      document.getElementById(remove.getAttribute("aria-describedby")!),
    ).toHaveTextContent("permission to delete this Monitor Status Event");
  });

  test("a timeline that may not be deleted from has no Delete", async () => {
    await renderMonitor({ isDeleteable: false });

    const menu: HTMLElement = await openEntryMenu(1);

    expect(within(menu).queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });
});

describe("a read that fails", () => {
  test("says why, with a way to try again", async () => {
    failReads = true;

    await renderMonitor();

    expect(screen.getByText("Error connecting to server.")).toBeInTheDocument();

    failReads = false;

    // The message's own way out, where the reader is looking.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh?" }));
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("status-timeline-entry")).toHaveLength(3);
    });
  });
});

describe("an incident's timeline: its whole history on one band", () => {
  let stateCounter: number = 0;

  const incidentState: (name: string, color: string) => IncidentState = (
    name: string,
    color: string,
  ): IncidentState => {
    stateCounter++;
    const value: IncidentState = new IncidentState();
    value._id = `9a1f0a0e-5555-4c1e-9a1e-${String(stateCounter).padStart(12, "0")}`;
    value.name = name;
    value.color = new Color(color);
    return value;
  };

  const incidentRow: (
    state: IncidentState,
    from: number,
    to: number | null,
  ) => IncidentStateTimeline = (
    state: IncidentState,
    from: number,
    to: number | null,
  ): IncidentStateTimeline => {
    rowCounter++;
    const row: IncidentStateTimeline = new IncidentStateTimeline();
    row._id = `8e1f0a0e-4444-4c1e-9a1e-${String(rowCounter).padStart(12, "0")}`;
    row.incidentState = state;
    row.startsAt = at(from);

    if (to !== null) {
      row.endsAt = at(to);
    }

    return row;
  };

  const renderIncident: (
    overrides?: Partial<ComponentProps<IncidentStateTimeline>>,
  ) => Promise<void> = async (
    overrides?: Partial<ComponentProps<IncidentStateTimeline>>,
  ): Promise<void> => {
    await act(async () => {
      render(
        <ModelStatusTimeline<IncidentStateTimeline>
          modelType={IncidentStateTimeline}
          id="incident-status-timeline"
          name="Incident > State Timeline"
          title="Status Timeline"
          description="Each status this incident has been in, when it began and how long it lasted."
          query={{
            incidentId: new ObjectID(MONITOR_ID),
            projectId: new ObjectID(PROJECT_ID),
          }}
          stateColumn="incidentState"
          ariaLabel="Status timeline of this incident"
          emptyMessage="No status recorded for this incident yet."
          isCreateable={true}
          isDeleteable={true}
          singularName="State Change"
          {...(overrides || {})}
        />,
      );
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("status-timeline-loading"),
      ).not.toBeInTheDocument();
    });
  };

  beforeEach(() => {
    const created: IncidentState = incidentState("Created", "#ef4444");
    const acknowledged: IncidentState = incidentState(
      "Acknowledged",
      "#eab308",
    );
    const resolved: IncidentState = incidentState("Resolved", "#10b981");

    rowsInStore = [
      incidentRow(created, -21 * DAY - 2 * HOUR, -21 * DAY - HOUR),
      incidentRow(acknowledged, -21 * DAY - HOUR, -21 * DAY),
      incidentRow(resolved, -21 * DAY, null),
    ];
  });

  test("reads its rows newest first, with no period - and no second read", async () => {
    await renderIncident();

    expect(timelineReads()).toHaveLength(1);
    expect(timelineReads()[0]!.query).not.toHaveProperty("startsAt");
    expect(timelineReads()[0]!.query["incidentId"]).toEqual(
      new ObjectID(MONITOR_ID),
    );
    expect(timelineReads()[0]!.sort).toEqual({
      startsAt: SortOrder.Descending,
    });
  });

  test("has no period to pick: the band is fitted to the incident's life", async () => {
    await renderIncident();

    expect(
      screen.queryByTestId("incident-status-timeline-window-controls"),
    ).toBeNull();
    // Created 21 days and 2 hours ago: the band begins with it.
    expect(screen.getByTestId("status-timeline-start")).toHaveTextContent(
      "Sep 23, 06:36",
    );
    // Resolved three weeks ago: the band ends a little after the change.
    expect(screen.queryByTestId("status-timeline-now")).toBeNull();
  });

  test("its legend counts each state's whole time, in the order the incident went through them", async () => {
    await renderIncident();

    expect(
      screen
        .getAllByTestId("status-timeline-legend-item")
        .map((item: HTMLElement): string | null => {
          return item.textContent;
        }),
    ).toEqual(["Created1 hour", "Acknowledged1 hour", "Resolved21 days"]);
  });

  test("still open, it runs on to now, however long ago it last changed", async () => {
    const created: IncidentState = incidentState("Created", "#ef4444");
    const acknowledged: IncidentState = incidentState(
      "Acknowledged",
      "#eab308",
    );

    rowsInStore = [
      incidentRow(created, -3 * HOUR, -3 * HOUR + 12 * MINUTE),
      incidentRow(acknowledged, -3 * HOUR + 12 * MINUTE, null),
    ];

    await renderIncident({
      stateSelect: { isResolvedState: true },
      isFinalState: (state: JSONObject): boolean => {
        return state["isResolvedState"] === true;
      },
    });

    // The flag is read with the state.
    expect(timelineReads()[0]!.select["incidentState"]).toEqual({
      _id: true,
      name: true,
      color: true,
      isResolvedState: true,
    });
    expect(screen.getByTestId("status-timeline-now")).toBeInTheDocument();
  });

  test("resolved, it ends a little after its last change", async () => {
    const resolvedState: IncidentState = incidentState("Resolved", "#10b981");
    resolvedState.isResolvedState = true;
    const created: IncidentState = incidentState("Created", "#ef4444");

    rowsInStore = [
      incidentRow(created, -3 * HOUR, -3 * HOUR + 12 * MINUTE),
      incidentRow(resolvedState, -3 * HOUR + 12 * MINUTE, null),
    ];

    await renderIncident({
      stateSelect: { isResolvedState: true },
      isFinalState: (state: JSONObject): boolean => {
        return state["isResolvedState"] === true;
      },
    });

    expect(screen.queryByTestId("status-timeline-now")).toBeNull();
  });

  test("its rows are called state changes", async () => {
    await renderIncident();

    expect(
      screen.getByRole("button", { name: "Create State Change" }),
    ).toBeInTheDocument();
  });
});
