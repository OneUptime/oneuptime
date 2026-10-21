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
 *
 * Since issue #5080 the first choice is the dashboard's own interval,
 * "Default (1m)": the tick is on it while the visitor has no interval of
 * their own, and picking it forgets the one they had. Each item is a
 * menuitemradio whose aria-checked says what the tick shows.
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

// Where the visitor's own interval is kept for this dashboard.
const PICK_KEY: string = `oneuptime-dashboard-auto-refresh:${DASHBOARD_ID.toString()}`;

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

/*
 * The picker's trigger, named "Auto-refresh settings" whatever it shows (it
 * used to be "More options" while off), with the interval it refreshes at
 * drawn beside its icon.
 */
async function openPicker(shownInterval: string): Promise<HTMLElement> {
  const trigger: HTMLElement = await waitFor(() => {
    return screen.getByRole("button", { name: "Auto-refresh settings" });
  });

  expect((trigger.textContent || "").trim()).toBe(shownInterval);

  fireEvent.click(trigger);

  return screen.getByRole("menu");
}

// The menu's choices, each a menuitemradio.
function choicesOf(menu: HTMLElement): Array<HTMLElement> {
  return within(menu).getAllByRole("menuitemradio");
}

function labelsOf(menu: HTMLElement): Array<string> {
  return choicesOf(menu).map((item: HTMLElement) => {
    return (item.textContent || "").trim();
  });
}

function choiceOf(menu: HTMLElement, label: string): HTMLElement {
  const item: HTMLElement | undefined = choicesOf(menu).find(
    (candidate: HTMLElement) => {
      return (candidate.textContent || "").trim() === label;
    },
  );

  if (!item) {
    throw new Error(`The menu has no "${label}" choice.`);
  }

  return item;
}

function tickedLabels(menu: HTMLElement): Array<string> {
  return choicesOf(menu)
    .filter((item: HTMLElement) => {
      return Boolean(item.querySelector("svg"));
    })
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
}

// The choices a screen reader hears as checked.
function checkedLabels(menu: HTMLElement): Array<string> {
  return choicesOf(menu)
    .filter((item: HTMLElement) => {
      return item.getAttribute("aria-checked") === "true";
    })
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
}

describe("the public dashboard's auto-refresh picker", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/public-dashboard/board");
    answerWithBoard(buildBoard());
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  test("lists the dashboard's own interval first, then every interval, with a tick on the one in use", async () => {
    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    const menu: HTMLElement = await openPicker("");

    expect(labelsOf(menu)).toEqual(["Default (Off)", ...INTERVAL_LABELS]);
    // A visitor with no interval of their own is on the default.
    expect(tickedLabels(menu)).toEqual(["Default (Off)"]);
    expect(checkedLabels(menu)).toEqual(["Default (Off)"]);
    expect(getGlyphOfMenuItem(choiceOf(menu, "Default (Off)"))).toBe(
      getGlyphOfIcon(IconProp.Check),
    );
  });

  test("the choices not in use keep the tick's space, so every label lines up", async () => {
    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    const menu: HTMLElement = await openPicker("");

    for (const label of INTERVAL_LABELS) {
      const item: HTMLElement = choiceOf(menu, label);
      const gutter: Element | null = item.querySelector(
        'span[aria-hidden="true"]',
      );

      expect([label, item.querySelector("svg")]).toEqual([label, null]);
      expect([label, gutter?.className.includes("w-4")]).toEqual([label, true]);
    }
  });

  test("picking an interval moves the tick to it, off the default", async () => {
    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    fireEvent.click(choiceOf(await openPicker(""), "30s"));

    // The trigger now reads the interval it refreshes at.
    const menu: HTMLElement = await openPicker("30s");

    expect(tickedLabels(menu)).toEqual(["30s"]);
    expect(checkedLabels(menu)).toEqual(["30s"]);
    // Remembered for this dashboard, and written into the address.
    expect(window.localStorage.getItem(PICK_KEY)).toBe("30s");
    expect(new URLSearchParams(window.location.search).get("refresh")).toBe(
      "30s",
    );
  });

  test("a board saved with an interval opens on it, the tick on its Default", async () => {
    answerWithBoard(buildBoard(AutoRefreshInterval.ONE_MINUTE));

    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    const menu: HTMLElement = await openPicker("1m");

    expect(labelsOf(menu)[0]).toBe("Default (1m)");
    expect(tickedLabels(menu)).toEqual(["Default (1m)"]);
    // The interval the default names is not ticked twice.
    expect(choiceOf(menu, "1m").querySelector("svg")).toBeNull();
  });

  test("the visitor's own interval wins over the dashboard's, and Default goes back to it", async () => {
    window.localStorage.setItem(PICK_KEY, "5m");
    answerWithBoard(buildBoard(AutoRefreshInterval.ONE_MINUTE));

    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    const menu: HTMLElement = await openPicker("5m");

    expect(tickedLabels(menu)).toEqual(["5m"]);

    fireEvent.click(choiceOf(menu, "Default (1m)"));

    // Back on the dashboard's own interval, and nothing of the pick kept.
    expect(tickedLabels(await openPicker("1m"))).toEqual(["Default (1m)"]);
    expect(window.localStorage.getItem(PICK_KEY)).toBeNull();
    expect(new URLSearchParams(window.location.search).has("refresh")).toBe(
      false,
    );
  });

  test("a link's ?refresh= wins over both, and is not kept as the visitor's own", async () => {
    window.localStorage.setItem(PICK_KEY, "5m");
    window.history.replaceState(
      null,
      "",
      "/public-dashboard/board?refresh=10s",
    );
    answerWithBoard(buildBoard(AutoRefreshInterval.ONE_MINUTE));

    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    expect(tickedLabels(await openPicker("10s"))).toEqual(["10s"]);
    expect(window.localStorage.getItem(PICK_KEY)).toBe("5m");
  });
});
