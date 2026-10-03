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
 * The public dashboard's auto-refresh picker is a More menu whose items are
 * choices - Off, 5s, 10s, ... - and its items had nothing in the icon slot,
 * and nothing that said which choice was in use. Every menu item in the
 * product now shows something there; for a list of choices that is a tick on
 * the one in use, as the private dashboard's own auto-refresh picker shows
 * it, with the other labels lined up beside the tick's space.
 */

const publicPostMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock variable above is still unassigned when the factory
 * runs. Dereferencing it lazily, at call time, is what makes this work.
 */
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

import DashboardViewPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import {
  getGlyphOfIcon,
  getGlyphOfMenuItem,
  getMenuItem,
} from "../../UI/Components/MenuItemIcons";

const DASHBOARD_ID: ObjectID = new ObjectID(
  "d4d4d4d4-1111-4111-8111-d4d4d4d4d4d4",
);

const INTERVAL_LABELS: Array<string> = [
  "Off",
  "5s",
  "10s",
  "30s",
  "1m",
  "5m",
  "15m",
];

function buildBoard(
  refreshInterval?: AutoRefreshInterval,
): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    heightInDashboardUnits: 4,
    refreshInterval: refreshInterval,
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

// The picker's trigger: "More options" while off, the interval's label after.
async function openPicker(triggerName: string): Promise<HTMLElement> {
  const trigger: HTMLElement = await waitFor(() => {
    return screen.getByRole("button", { name: triggerName });
  });

  fireEvent.click(trigger);

  return screen.getByRole("menu");
}

function tickedLabels(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("menuitem")
    .filter((item: HTMLElement) => {
      return Boolean(item.querySelector("svg"));
    })
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
}

describe("the public dashboard's auto-refresh picker", () => {
  beforeEach(() => {
    answerWithBoard(buildBoard());
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("lists every interval, with a tick on the one in use", async () => {
    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    const menu: HTMLElement = await openPicker("More options");

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement) => {
          return (item.textContent || "").trim();
        }),
    ).toEqual(INTERVAL_LABELS);
    expect(tickedLabels(menu)).toEqual(["Off"]);
    expect(getGlyphOfMenuItem(getMenuItem(menu, "Off"))).toBe(
      getGlyphOfIcon(IconProp.Check),
    );
  });

  test("the choices not in use keep the tick's space, so every label lines up", async () => {
    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    const menu: HTMLElement = await openPicker("More options");

    for (const label of INTERVAL_LABELS.slice(1)) {
      const item: HTMLElement = getMenuItem(menu, label);
      const gutter: Element | null = item.querySelector(
        'span[aria-hidden="true"]',
      );

      expect([label, item.querySelector("svg")]).toEqual([label, null]);
      expect([label, gutter?.className.includes("w-4")]).toEqual([label, true]);
    }
  });

  test("picking an interval moves the tick to it", async () => {
    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    fireEvent.click(getMenuItem(await openPicker("More options"), "30s"));

    // The trigger now reads the interval it refreshes at.
    const menu: HTMLElement = await openPicker("30s");

    expect(tickedLabels(menu)).toEqual(["30s"]);
  });

  test("a board saved with an interval opens with the tick on it", async () => {
    answerWithBoard(buildBoard(AutoRefreshInterval.ONE_MINUTE));

    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    expect(tickedLabels(await openPicker("1m"))).toEqual(["1m"]);
  });
});
