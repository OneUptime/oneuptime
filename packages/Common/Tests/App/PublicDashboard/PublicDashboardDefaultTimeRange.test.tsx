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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A public dashboard's time range (issue #5080), on the real public
 * DashboardViewPage against a fake public API: a dashboard shared with
 * anyone who has the link - with a password or without - opens on its saved
 * default time range, a visitor's remembered pick or a link's ?range=, and
 * the visitor's time range picker offers "Default (...)" first, the way back.
 *
 * The canvas is stubbed: it publishes the time range every widget is handed.
 */

const publicPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return publicPostMock(...args);
      },
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      default: (props: { dashboardStartAndEndDate: { range: string } }) => {
        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-range": props.dashboardStartAndEndDate.range,
        });
      },
    };
  },
);

import DashboardViewPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";

const DASHBOARD_ID: ObjectID = new ObjectID(
  "d5d5d5d5-2222-4222-8222-d5d5d5d5d5d5",
);

const TIME_RANGE_KEY: string = `oneuptime-dashboard-time-range:${DASHBOARD_ID.toString()}`;

function buildBoard(timeRange?: TimeRange): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    heightInDashboardUnits: 4,
    timeRange: timeRange,
    components: [
      {
        _type: ObjectType.DashboardComponent,
        componentId: ObjectID.generate(),
        componentType: DashboardComponentType.Text,
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 4,
        heightInDashboardUnits: 2,
        minWidthInDashboardUnits: 1,
        minHeightInDashboardUnits: 1,
        arguments: {
          text: "Checkout service",
          isBold: false,
          isItalic: false,
          isUnderline: false,
        },
      },
    ],
  } as unknown as DashboardViewConfig;
}

function answerWithBoard(board: DashboardViewConfig): void {
  publicPostMock.mockImplementation(() => {
    return Promise.resolve({
      isFailure: (): boolean => {
        return false;
      },
      data: {
        dashboardViewConfig: JSONFunctions.serialize(
          board as unknown as JSONObject,
        ),
        name: "Status board",
      },
    });
  });
}

async function renderPage(): Promise<void> {
  render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
}

function canvasRange(): string | null {
  return screen.getByTestId("canvas-stub").getAttribute("data-range");
}

async function openTimeRangePicker(label: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });

  return screen.getByRole("radiogroup", { name: "Time range" });
}

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

beforeEach(() => {
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  window.history.replaceState(null, "", "/public-dashboard/board");
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  window.history.replaceState(null, "", "/");
});

describe("what a public dashboard opens on", () => {
  test("its saved default time range", async () => {
    answerWithBoard(buildBoard(TimeRange.PAST_ONE_WEEK));

    await renderPage();

    expect(canvasRange()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(
      screen.getByRole("button", { name: "Past 1 Week" }),
    ).toBeInTheDocument();
  });

  test("the past hour, for one saved before the setting", async () => {
    answerWithBoard(buildBoard());

    await renderPage();

    expect(canvasRange()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("the visitor's remembered pick, over the dashboard's default", async () => {
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_THREE_HOURS);
    answerWithBoard(buildBoard(TimeRange.PAST_ONE_WEEK));

    await renderPage();

    expect(canvasRange()).toBe(TimeRange.PAST_THREE_HOURS);
  });

  test("a link's ?range=, over both - a wall screen's address", async () => {
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_THREE_HOURS);
    window.history.replaceState(
      null,
      "",
      "/public-dashboard/board?range=24h&theme=dark",
    );
    answerWithBoard(buildBoard(TimeRange.PAST_ONE_WEEK));

    await renderPage();

    expect(canvasRange()).toBe(TimeRange.PAST_ONE_DAY);
    // The link is the visitor's to keep, not their browser's.
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_THREE_HOURS,
    );
    // Its theme stays in the address.
    expect(param("theme")).toBe("dark");
  });
});

describe("a visitor's own range", () => {
  test("is remembered and written into the address, and Default goes back to the dashboard's", async () => {
    answerWithBoard(buildBoard(TimeRange.PAST_ONE_WEEK));

    await renderPage();

    let rail: HTMLElement = await openTimeRangePicker("Past 1 Week");

    expect(within(rail).getAllByRole("radio")[0]).toHaveTextContent(
      "Default (Past 1 Week)",
    );
    expect(within(rail).getAllByRole("radio")[0]).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await act(async () => {
      fireEvent.click(within(rail).getByText("Past 30 Minutes"));
    });

    expect(canvasRange()).toBe(TimeRange.PAST_THIRTY_MINS);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_THIRTY_MINS,
    );
    expect(param("range")).toBe("30m");

    rail = await openTimeRangePicker("Past 30 Minutes");

    await act(async () => {
      fireEvent.click(within(rail).getByText("Default (Past 1 Week)"));
    });

    expect(canvasRange()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBeNull();
    expect(param("range")).toBeNull();
  });
});
