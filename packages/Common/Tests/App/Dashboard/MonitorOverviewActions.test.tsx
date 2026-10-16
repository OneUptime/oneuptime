/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { HERO_ICON_BUTTON_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorChangeStatusMenu";
import MonitorOverviewActions, {
  ComponentProps,
  getLoadedAtText,
  MONITOR_OVERVIEW_ACTIONS_TEST_ID,
  MONITOR_OVERVIEW_REFRESH_ANNOUNCEMENT_TEST_ID,
  MONITOR_OVERVIEW_REFRESH_TEST_ID,
  MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewActions";
import { MONITOR_OVERVIEW_REFRESH_INTERVAL_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorOverviewData";

/*
 * The top right of the monitor overview's hero. "Can you please improve the
 * refresh button as well? Make it a lot nicer and easier for people to
 * understand."
 *
 * Refresh only reads the page again - it runs no check - so it is an icon
 * button beside the ⋯, whose tooltip says what it does and that the page
 * refreshes itself every minute, with the clock time the data on screen is
 * from beside it. A press is confirmed to a screen reader; a failure is the
 * hero's alert's to announce. Tippy is stubbed to record what each tooltip
 * was asked to say: jsdom shows none of them.
 */

interface TippyProps {
  content?: ReactElement;
  children?: ReactElement;
}

const tippyCalls: Array<TippyProps> = [];

jest.mock("@tippyjs/react", () => {
  return {
    __esModule: true,
    default: (props: TippyProps): ReactElement | null => {
      tippyCalls.push(props);
      return props.children || null;
    },
  };
});

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * 1000);
};

let prefers12Hour: boolean = false;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  prefers12Hour = false;
  tippyCalls.length = 0;

  getJestSpyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockImplementation(
    (): boolean => {
      return prefers12Hour;
    },
  );

  // The ⋯'s own read and gate (MonitorChangeStatusMenu has its own suite).
  getJestSpyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function propsWith(overrides?: Partial<ComponentProps>): ComponentProps {
  return {
    monitorId: MONITOR_ID,
    isRefreshing: false,
    refreshError: "",
    lastLoadedAt: secondsAgo(30),
    onRefresh: (): void => {},
    moreActions: [],
    ...overrides,
  };
}

function renderActions(overrides?: Partial<ComponentProps>): RenderResult {
  return render(<MonitorOverviewActions {...propsWith(overrides)} />);
}

function refreshButton(): HTMLElement {
  return screen.getByTestId(MONITOR_OVERVIEW_REFRESH_TEST_ID);
}

function refreshIcon(): Element {
  return refreshButton().querySelector("svg")!;
}

function announcement(): HTMLElement {
  return screen.getByTestId(MONITOR_OVERVIEW_REFRESH_ANNOUNCEMENT_TEST_ID);
}

// The text a recorded tooltip was asked to show.
function tooltipTexts(): Array<string> {
  return tippyCalls.map((call: TippyProps): string => {
    const content: ReactElement | undefined = call.content;
    return String(
      (content?.props as { children?: unknown } | undefined)?.children ?? "",
    );
  });
}

describe("Refresh", () => {
  test("is an icon button named Refresh, drawn like the ⋯ it sits beside", () => {
    renderActions();

    const button: HTMLElement = screen.getByRole("button", { name: "Refresh" });

    expect(button).toBe(refreshButton());
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    // No label but its name: the icon says it, the tooltip explains it.
    expect(button.textContent).toBe("");
    expect(refreshIcon()).not.toBeNull();

    for (const token of HERO_ICON_BUTTON_CLASS_NAME.split(" ")) {
      expect(button).toHaveClass(token);
    }
  });

  test("its tooltip says what it does, and that the page refreshes itself every minute", () => {
    renderActions();

    expect(tooltipTexts()).toContain(
      "Refresh now. This page also refreshes every minute.",
    );
    // What the tooltip promises is the page's own poll.
    expect(MONITOR_OVERVIEW_REFRESH_INTERVAL_MS).toBe(60 * 1000);
  });

  test("a press reads the page again, once", () => {
    const onRefresh: MockFunction = getJestMockFunction();
    renderActions({ onRefresh });

    fireEvent.click(refreshButton());

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("while a read is out the icon spins, presses do nothing, and the focus stays on it", () => {
    const onRefresh: MockFunction = getJestMockFunction();
    const view: RenderResult = renderActions({ onRefresh });

    refreshButton().focus();
    expect(document.activeElement).toBe(refreshButton());

    view.rerender(
      <MonitorOverviewActions
        {...propsWith({ onRefresh, isRefreshing: true })}
      />,
    );

    const button: HTMLElement = refreshButton();

    expect(button).toHaveAttribute("aria-disabled", "true");
    // aria-disabled, not disabled: a disabled button would drop the focus.
    expect(button).not.toBeDisabled();
    expect(document.activeElement).toBe(button);
    expect(button).toHaveClass("cursor-progress");
    expect(refreshIcon()).toHaveClass(
      "animate-spin",
      "motion-reduce:animate-none",
    );

    fireEvent.click(button);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test("idle, the icon holds still and the button can be pressed", () => {
    renderActions();

    expect(refreshButton()).toHaveAttribute("aria-disabled", "false");
    expect(refreshButton()).toHaveClass("cursor-pointer");
    expect(refreshIcon()).not.toHaveClass("animate-spin");
  });
});

describe("when the data on screen is from", () => {
  test("is the clock time it was read, machine readable, with the full date and time on hover", () => {
    renderActions({ lastLoadedAt: secondsAgo(30) });

    const caption: HTMLElement = screen.getByTestId(
      MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID,
    );

    expect(caption).toHaveTextContent("Refreshed at 11:59");

    const time: HTMLElement = caption.querySelector("time")!;
    expect(time).toHaveAttribute("dateTime", secondsAgo(30).toISOString());
    expect(time).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(secondsAgo(30)),
    );
  });

  test("in the reader's 12-hour clock when they use one", () => {
    prefers12Hour = true;

    renderActions({ lastLoadedAt: secondsAgo(30) });

    expect(
      screen.getByTestId(MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID),
    ).toHaveTextContent("Refreshed at 11:59 AM");
  });

  test("a read from an earlier day names the day as well", () => {
    renderActions({ lastLoadedAt: new Date("2026-09-20T23:58:00.000Z") });

    expect(
      screen.getByTestId(MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID),
    ).toHaveTextContent("Refreshed at Sep 20, 23:58");
  });

  test("holds still between reads: no relative time ticking beside the buttons", () => {
    renderActions({ lastLoadedAt: secondsAgo(30) });

    const before: string =
      screen.getByTestId(MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID).textContent ||
      "";

    act(() => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(
      screen.getByTestId(MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID).textContent,
    ).toBe(before);
  });

  test("moves on with every read", () => {
    const view: RenderResult = renderActions({ lastLoadedAt: secondsAgo(30) });

    view.rerender(
      <MonitorOverviewActions
        {...propsWith({ lastLoadedAt: new Date("2026-09-21T12:01:05.000Z") })}
      />,
    );

    expect(
      screen.getByTestId(MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID),
    ).toHaveTextContent("Refreshed at 12:01");
  });

  test("says nothing before the first read", () => {
    renderActions({ lastLoadedAt: null });

    expect(
      screen.queryByTestId(MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID),
    ).toBeNull();
    expect(refreshButton()).toBeInTheDocument();
  });

  test("gives the badges the row below lg, where the hero is narrow, and is back from lg up", () => {
    renderActions();

    const caption: HTMLElement = screen.getByTestId(
      MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID,
    );

    expect(caption).toHaveClass(
      "max-lg:hidden",
      "lg:inline",
      "whitespace-nowrap",
    );
    // Hidden with a max- variant, so a foreign .hidden rule cannot pin it shut.
    expect(caption).not.toHaveClass("hidden");
  });

  test("the loaded-at text is today's clock time, or the day and time of an earlier day", () => {
    expect(getLoadedAtText(secondsAgo(30))).toBe("11:59");
    expect(getLoadedAtText(new Date("2026-09-20T23:58:00.000Z"))).toBe(
      "Sep 20, 23:58",
    );

    prefers12Hour = true;
    expect(getLoadedAtText(secondsAgo(3600))).toBe("11:00 AM");
  });
});

describe("telling a screen reader", () => {
  test("is a polite status region, out of sight", () => {
    renderActions();

    expect(announcement()).toHaveAttribute("role", "status");
    expect(announcement()).toHaveClass("sr-only");
    expect(announcement()).toBeEmptyDOMElement();
  });

  test("a pressed Refresh says when it is done", () => {
    const view: RenderResult = renderActions();

    fireEvent.click(refreshButton());
    view.rerender(
      <MonitorOverviewActions {...propsWith({ isRefreshing: true })} />,
    );
    expect(announcement()).toBeEmptyDOMElement();

    view.rerender(
      <MonitorOverviewActions
        {...propsWith({ isRefreshing: false, lastLoadedAt: NOW })}
      />,
    );
    expect(announcement()).toHaveTextContent("Monitor refreshed.");
  });

  test("the page's own every-minute refresh says nothing", () => {
    const view: RenderResult = renderActions();

    view.rerender(
      <MonitorOverviewActions {...propsWith({ isRefreshing: true })} />,
    );
    view.rerender(
      <MonitorOverviewActions {...propsWith({ isRefreshing: false })} />,
    );

    expect(announcement()).toBeEmptyDOMElement();
  });

  test("a failed Refresh is left to the hero's alert", () => {
    const view: RenderResult = renderActions();

    fireEvent.click(refreshButton());
    view.rerender(
      <MonitorOverviewActions {...propsWith({ isRefreshing: true })} />,
    );
    view.rerender(
      <MonitorOverviewActions
        {...propsWith({ isRefreshing: false, refreshError: "Network error." })}
      />,
    );

    expect(announcement()).toBeEmptyDOMElement();
  });

  test("each press is spoken: the region is emptied when the next one starts", () => {
    const view: RenderResult = renderActions();

    for (let press: number = 0; press < 2; press++) {
      fireEvent.click(refreshButton());
      expect(announcement()).toBeEmptyDOMElement();

      view.rerender(
        <MonitorOverviewActions {...propsWith({ isRefreshing: true })} />,
      );
      view.rerender(
        <MonitorOverviewActions {...propsWith({ isRefreshing: false })} />,
      );
      expect(announcement()).toHaveTextContent("Monitor refreshed.");
    }
  });

  test("a poll after a press is not taken for it", () => {
    const view: RenderResult = renderActions();

    // The press's read lands...
    fireEvent.click(refreshButton());
    view.rerender(
      <MonitorOverviewActions {...propsWith({ isRefreshing: true })} />,
    );
    view.rerender(
      <MonitorOverviewActions {...propsWith({ isRefreshing: false })} />,
    );

    // ...and the next poll lands after a failure: nothing new is said.
    view.rerender(
      <MonitorOverviewActions
        {...propsWith({ isRefreshing: true, refreshError: "" })}
      />,
    );
    view.rerender(
      <MonitorOverviewActions
        {...propsWith({ isRefreshing: false, refreshError: "Timed out." })}
      />,
    );

    expect(announcement()).toHaveTextContent("Monitor refreshed.");
  });
});

describe("the group", () => {
  test("holds the time, Refresh and the ⋯, in that order, named Monitor actions", async () => {
    renderActions({ moreActions: ["changeStatus"] });
    await act(async () => {
      await Promise.resolve();
    });

    const group: HTMLElement = screen.getByRole("group", {
      name: "Monitor actions",
    });

    expect(group).toHaveAttribute("data-testid", MONITOR_OVERVIEW_ACTIONS_TEST_ID);

    const order: Array<string> = Array.from(
      group.querySelectorAll("[data-testid]"),
    )
      .map((element: Element): string => {
        return element.getAttribute("data-testid") || "";
      })
      .filter((testId: string): boolean => {
        return [
          MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID,
          MONITOR_OVERVIEW_REFRESH_TEST_ID,
          "monitor-overview-more-actions",
        ].includes(testId);
      });

    expect(order).toEqual([
      MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID,
      MONITOR_OVERVIEW_REFRESH_TEST_ID,
      "monitor-overview-more-actions",
    ]);
    expect(
      within(group).getByRole("button", { name: "More actions" }),
    ).toBeInTheDocument();
  });

  test("has no ⋯ when the monitor has nothing for it", () => {
    renderActions({ moreActions: [] });

    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  test("keeps its buttons in one row at the right, as tall as the badges' line", () => {
    renderActions();

    expect(screen.getByTestId(MONITOR_OVERVIEW_ACTIONS_TEST_ID)).toHaveClass(
      "flex",
      "items-center",
      "justify-end",
      "gap-2",
      "-my-1.5",
    );
  });
});

describe("in German", () => {
  const german: i18n = createInstance();

  // The Dashboard's own German file, so a missing translation fails here.
  const GERMAN: JSONObject = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        "de.json",
      ),
      "utf8",
    ),
  ) as JSONObject;

  function inGerman(key: string): string {
    const value: unknown = GERMAN[key];

    if (typeof value !== "string" || value === key) {
      throw new Error(`"${key}" has no German translation.`);
    }

    return value;
  }

  beforeAll(async () => {
    await german.init({
      lng: "de",
      resources: { de: { translation: GERMAN } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  function renderGerman(overrides?: Partial<ComponentProps>): RenderResult {
    return render(
      <I18nextProvider i18n={german}>
        <MonitorOverviewActions {...propsWith(overrides)} />
      </I18nextProvider>,
    );
  }

  test("names the group, Refresh and its tooltip in German", () => {
    renderGerman();

    expect(
      screen.getByRole("group", { name: inGerman("Monitor actions") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: inGerman("Refresh") }),
    ).toBeInTheDocument();
    expect(tooltipTexts()).toContain(
      inGerman("Refresh now. This page also refreshes every minute."),
    );
  });

  test("says when the data is from in German", () => {
    renderGerman({ lastLoadedAt: secondsAgo(30) });

    expect(
      screen.getByTestId(MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID),
    ).toHaveTextContent(
      inGerman("Refreshed at {{time}}").replace("{{time}}", "11:59"),
    );
  });

  test("confirms a press in German", () => {
    const view: RenderResult = renderGerman();

    fireEvent.click(refreshButton());
    view.rerender(
      <I18nextProvider i18n={german}>
        <MonitorOverviewActions {...propsWith({ isRefreshing: true })} />
      </I18nextProvider>,
    );
    view.rerender(
      <I18nextProvider i18n={german}>
        <MonitorOverviewActions {...propsWith({ isRefreshing: false })} />
      </I18nextProvider>,
    );

    expect(announcement()).toHaveTextContent(inGerman("Monitor refreshed."));
  });
});
