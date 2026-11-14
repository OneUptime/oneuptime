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
} from "@testing-library/react";
import React from "react";
import { ObjectType } from "../../../Types/JSON";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import DashboardMode from "../../../Types/Dashboard/DashboardMode";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import DashboardToolbar from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar";
import {
  DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
  DEFAULT_TIME_RANGE_PICKER_TEST_ID,
  DashboardDefaultsCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardDefaultsCopy";
import {
  TOOLBAR_MENU_SCREEN_GUTTER_PX,
  getMenuShiftToStayOnScreen,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/UseMenuKeptOnScreen";

/*
 * A DASHBOARD TOOLBAR'S MENUS STAY ON A PHONE'S SCREEN.
 *
 * The auto-refresh menu hangs from its button's end and the editing row's
 * Default time range and Default auto-refresh from their button's start,
 * which keeps each over the board at a laptop's width. On a phone the
 * toolbar wraps: once its intervals were written in the reader's language
 * (issue #7303), a German board's auto-refresh button ("1 Min.") moved to
 * the start of a line of its own, and its menu, hung from that button's
 * end, ran off the screen's left edge - "Alle 5 Sek. aktualisieren" cut in
 * half - while the editing row's ran off the right edge and scrolled the
 * page sideways. Each menu now moves sideways just as far as it must to keep
 * the page's 16px gutter at both edges, and not at all while it fits.
 *
 * jsdom lays nothing out, so these tests give the menu the box a phone's
 * browser drew; the offline suite packages/E2E/DashboardTimeRange checks the
 * real thing on a phone, in German and Persian.
 */

const GUTTER: number = TOOLBAR_MENU_SCREEN_GUTTER_PX;

const RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-10-19T10:00:00.000Z"),
    new Date("2026-10-20T10:00:00.000Z"),
  ),
};

const WALL_SCREEN: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [DashboardTextComponentUtil.getDefaultComponent()],
  heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  timeRange: TimeRange.PAST_ONE_DAY,
  refreshInterval: AutoRefreshInterval.ONE_MINUTE,
};

function noop(): void {
  return undefined;
}

function toolbar(mode: DashboardMode): React.ReactElement {
  return (
    <DashboardToolbar
      dashboardMode={mode}
      dashboardName="Production wall screen"
      dashboardViewConfig={WALL_SCREEN}
      isSaving={false}
      canEditDashboard={true}
      startAndEndDate={RANGE}
      onStartAndEndDateChange={noop}
      autoRefreshInterval={AutoRefreshInterval.ONE_MINUTE}
      onAutoRefreshIntervalChange={noop}
      defaultTimeRange={TimeRange.PAST_ONE_DAY}
      isOnDefaultTimeRange={true}
      onDefaultTimeRangeSelect={noop}
      defaultAutoRefreshInterval={AutoRefreshInterval.ONE_MINUTE}
      isOnDefaultAutoRefresh={true}
      onDefaultAutoRefreshSelect={noop}
      onDashboardDefaultsChange={noop}
      onEditClick={noop}
      onSaveClick={noop}
      onCancelEditClick={noop}
      onFullScreenClick={noop}
      onAddComponentClick={noop}
    />
  );
}

async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("getMenuShiftToStayOnScreen", () => {
  test("leaves a menu that fits where its button put it", () => {
    expect(
      getMenuShiftToStayOnScreen({ left: 120, width: 224, screenWidth: 390 }),
    ).toBe(0);
    // Right up to the gutter on either side, and no further.
    expect(
      getMenuShiftToStayOnScreen({
        left: GUTTER,
        width: 390 - 2 * GUTTER,
        screenWidth: 390,
      }),
    ).toBe(0);
    // A laptop's toolbar: far from either edge.
    expect(
      getMenuShiftToStayOnScreen({ left: 900, width: 270, screenWidth: 1280 }),
    ).toBe(0);
  });

  test("moves a menu that runs off the left edge right, to the gutter", () => {
    // The German auto-refresh menu, hung from a button at a line's start.
    expect(
      getMenuShiftToStayOnScreen({ left: -142, width: 270, screenWidth: 390 }),
    ).toBe(142 + GUTTER);
    expect(
      getMenuShiftToStayOnScreen({ left: 10, width: 200, screenWidth: 390 }),
    ).toBe(GUTTER - 10);
  });

  test("moves a menu that runs off the right edge left, to the gutter", () => {
    // The editing row's menu, hung from a button near a line's end.
    expect(
      getMenuShiftToStayOnScreen({ left: 249, width: 268, screenWidth: 390 }),
    ).toBe(390 - GUTTER - (249 + 268));
    expect(
      getMenuShiftToStayOnScreen({ left: 200, width: 180, screenWidth: 390 }),
    ).toBe(390 - GUTTER - 380);
  });

  test("keeps the start of a menu wider than the screen in view", () => {
    expect(
      getMenuShiftToStayOnScreen({ left: 40, width: 500, screenWidth: 390 }),
    ).toBe(GUTTER - 40);
    expect(
      getMenuShiftToStayOnScreen({ left: -60, width: 500, screenWidth: 390 }),
    ).toBe(GUTTER + 60);
  });

  test("leaves a menu that has no box yet, or a screen with no width, alone", () => {
    expect(
      getMenuShiftToStayOnScreen({ left: -142, width: 0, screenWidth: 390 }),
    ).toBe(0);
    expect(
      getMenuShiftToStayOnScreen({ left: -142, width: 270, screenWidth: 0 }),
    ).toBe(0);
    expect(
      getMenuShiftToStayOnScreen({
        left: -142,
        width: Number.NaN,
        screenWidth: 390,
      }),
    ).toBe(0);
  });

  test("moves by whole pixels", () => {
    expect(
      getMenuShiftToStayOnScreen({
        left: -10.4,
        width: 200,
        screenWidth: 390,
      }),
    ).toBe(26);
  });
});

/*
 * The boxes a phone's browser drew: where each menu's button put it, before
 * any move, and how wide it is. Its button's wrapper - the box it hangs
 * from - sits at WRAPPER_LEFT; jsdom has no stylesheet, so the menu's place
 * in it is its offsetLeft. A menu given a left edge of its own is drawn
 * there, as a browser draws it, so a second read sees where it went.
 */
interface DrawnMenu {
  left: number;
  width: number;
}

const WRAPPER_LEFT: number = 100;

let drawn: DrawnMenu = { left: 0, width: 0 };

let screenWidth: number = 390;

type ResizeCallback = () => void;

let resizeCallbacks: Array<ResizeCallback> = [];

const originalResizeObserver: unknown = (
  globalThis as unknown as { ResizeObserver?: unknown }
).ResizeObserver;

function isMenu(element: HTMLElement): boolean {
  return element.getAttribute("role") === "menu";
}

// The wrapper a menu hangs from: its parent.
function isWrapper(element: HTMLElement): boolean {
  return Array.from(element.children).some((child: Element): boolean => {
    return child.getAttribute("role") === "menu";
  });
}

// Where its button puts the menu, in its wrapper.
function naturalOffset(): number {
  return drawn.left - WRAPPER_LEFT;
}

// The menu's left edge in its wrapper: its own, else its button's.
function offsetOf(menu: HTMLElement): number {
  const own: number = parseFloat(menu.style.left);

  return Number.isFinite(own) ? own : naturalOffset();
}

function box(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    left: left,
    top: 0,
    width: width,
    height: 300,
    right: left + width,
    bottom: 300,
    toJSON: (): unknown => {
      return {};
    },
  } as DOMRect;
}

// Moved `shift` pixels by a left edge of its own, or not moved at all.
function expectMoved(menu: HTMLElement, shift: number): void {
  if (shift === 0) {
    expect(menu.style.left).toBe("");
    expect(menu.style.right).toBe("");
    expect(menu.getBoundingClientRect().left).toBe(drawn.left);
    return;
  }

  /*
   * Its own left edge in its wrapper (its right one let go: "auto", which
   * jsdom's style object does not keep, so the browser suite reads that
   * part), drawn `shift` pixels along from where its button put it.
   */
  expect(menu.style.left).toBe(`${naturalOffset() + shift}px`);
  expect(menu.getBoundingClientRect().left).toBe(drawn.left + shift);
  // Never by a transform, which a right-to-left page still scrolled to.
  expect(menu.style.transform).toBe("");
}

beforeEach(() => {
  resizeCallbacks = [];
  screenWidth = 390;

  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      if (isMenu(this)) {
        return box(WRAPPER_LEFT + offsetOf(this), drawn.width);
      }

      if (isWrapper(this)) {
        return box(WRAPPER_LEFT, 80);
      }

      return box(0, 0);
    });

  jest
    .spyOn(HTMLElement.prototype, "offsetLeft", "get")
    .mockImplementation(function (this: HTMLElement): number {
      return isMenu(this) ? offsetOf(this) : 0;
    });

  jest
    .spyOn(HTMLElement.prototype, "offsetWidth", "get")
    .mockImplementation(function (this: HTMLElement): number {
      return isMenu(this) ? drawn.width : 0;
    });

  jest
    .spyOn(document.documentElement, "clientWidth", "get")
    .mockImplementation((): number => {
      return screenWidth;
    });

  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class {
      private callback: ResizeCallback;

      public constructor(callback: ResizeCallback) {
        this.callback = callback;
      }

      public observe(): void {
        resizeCallbacks.push(this.callback);
      }

      public disconnect(): void {
        resizeCallbacks = resizeCallbacks.filter(
          (callback: ResizeCallback): boolean => {
            return callback !== this.callback;
          },
        );
      }
    };
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    originalResizeObserver;
});

describe("the auto-refresh menu while viewing", () => {
  async function open(): Promise<HTMLElement> {
    render(toolbar(DashboardMode.View));
    await press(screen.getByTitle("Auto-refresh settings"));

    return screen.getByRole("menu", { name: "Auto-refresh settings" });
  }

  test("hung from a button at the start of a phone's line, moves right onto the screen", async () => {
    drawn = { left: -142, width: 270 };

    const menu: HTMLElement = await open();

    expectMoved(menu, 142 + GUTTER);
    expect(menu.getBoundingClientRect().left).toBe(GUTTER);
  });

  test("stays where its button put it while it fits, as at a laptop's width", async () => {
    screenWidth = 1280;
    drawn = { left: 900, width: 270 };

    const menu: HTMLElement = await open();

    expectMoved(menu, 0);
    // Still hung from the button's end.
    expect(menu).toHaveClass("end-0");
  });

  test("moves again when its width settles after it was first drawn", async () => {
    // First drawn before its classes were styled: narrow, and on the screen.
    drawn = { left: 120, width: 120 };

    const menu: HTMLElement = await open();

    expectMoved(menu, 0);

    // Then as wide as its longest choice, hung from the same button's end.
    drawn = { left: -30, width: 270 };
    await act(async () => {
      for (const callback of resizeCallbacks) {
        callback();
      }
    });

    expectMoved(menu, 30 + GUTTER);
    expect(menu.getBoundingClientRect().left).toBe(GUTTER);

    // A read with nothing changed leaves it where it went.
    await act(async () => {
      for (const callback of resizeCallbacks) {
        callback();
      }
    });

    expectMoved(menu, 30 + GUTTER);
  });

  test("moves again when the screen turns", async () => {
    drawn = { left: 200, width: 270 };

    const menu: HTMLElement = await open();

    expectMoved(menu, 390 - GUTTER - 470);

    // Turned sideways: room for it where its button put it.
    screenWidth = 844;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expectMoved(menu, 0);
  });

  test("stops watching once it closes", async () => {
    drawn = { left: -142, width: 270 };

    await open();

    expect(resizeCallbacks).toHaveLength(1);

    await press(screen.getByTitle("Auto-refresh settings"));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(resizeCallbacks).toHaveLength(0);
  });

  test("works where the browser has no ResizeObserver", async () => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      undefined;
    drawn = { left: -142, width: 270 };

    const menu: HTMLElement = await open();

    expectMoved(menu, 142 + GUTTER);
  });
});

describe("the editing row's pickers", () => {
  test.each([
    [DashboardDefaultsCopy.timeRangeLabel, DEFAULT_TIME_RANGE_PICKER_TEST_ID],
    [
      DashboardDefaultsCopy.autoRefreshLabel,
      DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
    ],
  ])(
    "%s, hung from a button near a phone's right edge, moves left onto the screen",
    async (label: string, testId: string) => {
      drawn = { left: 249, width: 268 };
      render(toolbar(DashboardMode.Edit));

      await press(screen.getByTestId(testId));

      const menu: HTMLElement = screen.getByRole("menu", { name: label });

      expectMoved(menu, 390 - GUTTER - (249 + 268));
      expect(menu.getBoundingClientRect().right).toBe(390 - GUTTER);
      // Still hung from the button's start.
      expect(menu).toHaveClass("start-0");
    },
  );

  test("a picker's menu that fits is left where its button put it", async () => {
    drawn = { left: 60, width: 268 };
    render(toolbar(DashboardMode.Edit));

    await press(screen.getByTestId(DEFAULT_AUTO_REFRESH_PICKER_TEST_ID));

    expectMoved(
      screen.getByRole("menu", {
        name: DashboardDefaultsCopy.autoRefreshLabel,
      }),
      0,
    );
  });
});
