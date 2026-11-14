// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { NavigateFunction } from "react-router-dom";
import Route from "../../../Types/API/Route";
import Breadcrumbs from "../../../UI/Components/Breadcrumbs/Breadcrumbs";
import Link from "../../../UI/Components/Link/Link";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import LeaveGuard, { LeavePageFunction } from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * Links into the app - the side menu, the breadcrumbs, every Link - while
 * the page shown holds unsaved work (LeaveGuard, issue #7173): the whole
 * click waits for the page's answer. Keep Editing leaves the page exactly
 * as it was (no step, no side menu scroll); Discard Changes does everything
 * the click always did. With no unsaved work, a click is what it always
 * was.
 */

const DASHBOARD: string = "/dashboard/p1/dashboards/d1";
const MONITORS: string = "/dashboard/p1/monitors";

let calls: Array<string>;
let asked: Array<LeavePageFunction>;
// A side menu entry scrolls the page to the top as it opens its page.
let scrollTo: SpyInstance<(x: number, y: number) => void>;

const holdWithUnsavedWork: () => void = (): void => {
  LeaveGuard.hold((leave: LeavePageFunction): void => {
    asked.push(leave);
  });
};

const renderMonitorsLink: () => HTMLElement = (): HTMLElement => {
  render(
    <Link
      to={new Route(MONITORS)}
      onClick={() => {
        calls.push("onClick");
      }}
      onNavigateComplete={() => {
        calls.push("onNavigateComplete");
      }}
    >
      Monitors
    </Link>,
  );

  return screen.getByText("Monitors");
};

beforeEach(() => {
  LeaveGuard.reset();
  calls = [];
  asked = [];
  window.history.replaceState({ usr: null, key: "d1", idx: 0 }, "", DASHBOARD);
  Navigation.setNavigateHook(((to: string) => {
    calls.push(`navigate ${to}`);
  }) as unknown as NavigateFunction);
  scrollTo = jest.spyOn(window, "scrollTo").mockImplementation(() => {
    calls.push("scrollTo");
  });
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
  scrollTo.mockRestore();
});

describe("a Link on a page with nothing unsaved", () => {
  test("is the click it always was: its own step, the page, then what follows", () => {
    const link: HTMLElement = renderMonitorsLink();

    const wentAhead: boolean = fireEvent.click(link);

    // The browser's own load is stopped: the router opens the page.
    expect(wentAhead).toBe(false);
    expect(calls).toEqual([
      "onClick",
      `navigate ${MONITORS}`,
      "onNavigateComplete",
    ]);
  });

  test("a side menu entry scrolls to the top and opens its page", () => {
    render(
      <SideMenuItem link={{ title: "Monitors", to: new Route(MONITORS) }} />,
    );

    fireEvent.click(screen.getByText("Monitors"));

    expect(calls).toEqual(["scrollTo", `navigate ${MONITORS}`]);
  });
});

describe("a Link while the page shown holds unsaved work", () => {
  test("asks, and nothing happens until the page answers", () => {
    holdWithUnsavedWork();
    const link: HTMLElement = renderMonitorsLink();

    const wentAhead: boolean = fireEvent.click(link);

    expect(wentAhead).toBe(false);
    expect(asked).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  test("Discard Changes does all the click did, in its order", () => {
    holdWithUnsavedWork();
    fireEvent.click(renderMonitorsLink());

    asked[0]!();

    expect(calls).toEqual([
      "onClick",
      `navigate ${MONITORS}`,
      "onNavigateComplete",
    ]);
    expect(LeaveGuard.isHeld()).toBe(false);
  });

  test("a side menu entry asks before it scrolls: Keep Editing leaves the page where it was", () => {
    holdWithUnsavedWork();
    render(
      <SideMenuItem link={{ title: "Monitors", to: new Route(MONITORS) }} />,
    );

    fireEvent.click(screen.getByText("Monitors"));

    expect(asked).toHaveLength(1);
    // Kept: the answer is dropped, and nothing moved.
    expect(calls).toEqual([]);
  });

  test("a side menu entry, Discard Changes: scrolls to the top and opens its page", () => {
    holdWithUnsavedWork();
    render(
      <SideMenuItem link={{ title: "Monitors", to: new Route(MONITORS) }} />,
    );

    fireEvent.click(screen.getByText("Monitors"));
    asked[0]!();

    expect(calls).toEqual(["scrollTo", `navigate ${MONITORS}`]);
  });

  test("a breadcrumb asks first", () => {
    holdWithUnsavedWork();
    render(
      <Breadcrumbs
        links={[
          { title: "Dashboards", to: new Route("/dashboard/p1/dashboards") },
          { title: "Production", to: new Route(DASHBOARD) },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Dashboards"));

    expect(asked).toHaveLength(1);
    expect(calls).toEqual([]);

    asked[0]!();

    expect(calls).toEqual(["navigate /dashboard/p1/dashboards"]);
  });

  test("a link to the same page (a query) goes on at once", () => {
    holdWithUnsavedWork();
    render(<Link to={new Route(`${DASHBOARD}?startTime=1`)}>Last hour</Link>);

    fireEvent.click(screen.getByText("Last hour"));

    expect(asked).toHaveLength(0);
    expect(calls).toEqual([`navigate ${DASHBOARD}?startTime=1`]);
  });

  test.each<
    [string, { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }]
  >([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Shift", { shiftKey: true }],
  ])(
    "a %s-click opens a new tab or window, as the browser does, and asks nothing",
    (_key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean }) => {
      holdWithUnsavedWork();
      const link: HTMLElement = renderMonitorsLink();

      const wentAhead: boolean = fireEvent.click(link, modifiers);

      expect(wentAhead).toBe(true);
      expect(asked).toHaveLength(0);
      expect(calls).toEqual(["onClick"]);
    },
  );

  test("a link that opens in a new tab asks nothing", () => {
    holdWithUnsavedWork();
    render(
      <Link to={new Route(MONITORS)} openInNewTab={true}>
        Monitors
      </Link>,
    );

    const wentAhead: boolean = fireEvent.click(screen.getByText("Monitors"));

    expect(wentAhead).toBe(true);
    expect(asked).toHaveLength(0);
    expect(calls).toEqual([]);
  });
});
