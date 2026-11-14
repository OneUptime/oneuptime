// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import Route from "../../../Types/API/Route";
import LeaveGuard, { LeavePageFunction } from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";
import NewVersion from "../../../UI/Utils/NewVersion/NewVersion";
import { NavigateFunction } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * Navigation.navigate is how the app opens its pages (the command palette,
 * buttons, a page passing the reader on). While a page holds unsaved work
 * (LeaveGuard), another page waits for that page's answer; with none, it
 * opens at once, exactly as it always did (issue #7173).
 */

const DASHBOARD: string = "/dashboard/p1/dashboards/d1";
const MONITORS: string = "/dashboard/p1/monitors";

let navigateHook: Mock<(...args: Array<unknown>) => void>;
let asked: Array<LeavePageFunction>;

const holdWithUnsavedWork: () => () => void = (): (() => void) => {
  return LeaveGuard.hold((leave: LeavePageFunction): void => {
    asked.push(leave);
  });
};

beforeEach(() => {
  LeaveGuard.reset();
  asked = [];
  window.history.replaceState({ usr: null, key: "d1", idx: 0 }, "", DASHBOARD);
  navigateHook = jest.fn<(...args: Array<unknown>) => void>();
  Navigation.setNavigateHook(navigateHook as unknown as NavigateFunction);
});

afterEach(() => {
  LeaveGuard.reset();
  jest.restoreAllMocks();
});

describe("Navigation.navigate with no page holding unsaved work", () => {
  test("opens another page at once, as always", () => {
    Navigation.navigate(new Route(MONITORS));

    expect(navigateHook).toHaveBeenCalledTimes(1);
    expect(navigateHook).toHaveBeenCalledWith(MONITORS);
  });

  test("keeps replacing the entry when asked to", () => {
    Navigation.navigate(new Route(MONITORS), { replace: true });

    expect(navigateHook).toHaveBeenCalledWith(MONITORS, { replace: true });
  });
});

describe("Navigation.navigate while a page holds unsaved work", () => {
  test("another page waits for the page's answer", () => {
    holdWithUnsavedWork();

    Navigation.navigate(new Route(MONITORS));

    expect(asked).toHaveLength(1);
    expect(navigateHook).not.toHaveBeenCalled();
  });

  test("Keep Editing: the page never changes", () => {
    holdWithUnsavedWork();

    Navigation.navigate(new Route(MONITORS));
    // The answer is dropped.

    expect(navigateHook).not.toHaveBeenCalled();
    expect(LeaveGuard.isHeld()).toBe(true);
  });

  test("Discard Changes: the page opens, once", () => {
    holdWithUnsavedWork();

    Navigation.navigate(new Route(MONITORS));
    asked[0]!();
    asked[0]!();

    expect(navigateHook).toHaveBeenCalledTimes(1);
    expect(navigateHook).toHaveBeenCalledWith(MONITORS);
  });

  test("a step that replaces its entry still replaces it after the answer", () => {
    holdWithUnsavedWork();

    Navigation.navigate(new Route(MONITORS), { replace: true });
    asked[0]!();

    expect(navigateHook).toHaveBeenCalledWith(MONITORS, { replace: true });
  });

  test("a query on the same page opens at once, without a question", () => {
    holdWithUnsavedWork();

    Navigation.navigate(new Route(`${DASHBOARD}?startTime=1`));

    expect(asked).toHaveLength(0);
    expect(navigateHook).toHaveBeenCalledWith(`${DASHBOARD}?startTime=1`);
  });

  test("a new tab never asks: the page stays as it is", () => {
    const open: Mock<(...args: Array<unknown>) => null> = jest.fn<
      (...args: Array<unknown>) => null
    >(() => {
      return null;
    });
    jest
      .spyOn(window, "open")
      .mockImplementation(open as unknown as typeof window.open);
    holdWithUnsavedWork();

    Navigation.navigate(new Route(MONITORS), { openInNewTab: true });

    expect(asked).toHaveLength(0);
    expect(open).toHaveBeenCalledWith(MONITORS, "_blank");
  });

  test("a new version's full load waits too, and meets no browser dialog after the page's", () => {
    const askedByBrowser: Array<boolean> = [];

    jest.spyOn(NewVersion, "shouldLoadNavigationInFull").mockReturnValue(true);
    jest.spyOn(NewVersion, "openInFull").mockImplementation(() => {
      const event: Event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      askedByBrowser.push(event.defaultPrevented);
    });
    holdWithUnsavedWork();

    Navigation.navigate(new Route(MONITORS));

    expect(NewVersion.openInFull).not.toHaveBeenCalled();

    asked[0]!();

    expect(NewVersion.openInFull).toHaveBeenCalledWith(MONITORS, {
      replace: false,
    });
    expect(askedByBrowser).toEqual([false]);
    expect(navigateHook).not.toHaveBeenCalled();
  });
});
