// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import React, { act, FunctionComponent, ReactElement } from "react";
import {
  BrowserRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import AppLink from "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink";
import Route from "../../../Types/API/Route";
import LeaveGuard, { LeavePageFunction } from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * The Dashboard app's AppLink is react-router's own Link: the router takes
 * the click, not Navigation.navigate. While the page shown holds unsaved
 * work (LeaveGuard, issue #7173), the router leaves the click alone and the
 * step waits for the page's answer. With no unsaved work it is the link it
 * always was.
 */

const BOARD_PATH: string = "/dashboard/p1/dashboards/d1";
const MONITOR_PATH: string = "/dashboard/p1/monitors/m1";

let asked: Array<LeavePageFunction>;
let completed: number;

const Shell: FunctionComponent = (): ReactElement => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());

  return (
    <Routes>
      <RouterRoute
        path="/dashboard/:projectId/dashboards/:id"
        element={
          <AppLink
            to={new Route(MONITOR_PATH)}
            onNavigateComplete={() => {
              completed++;
            }}
          >
            Checkout API
          </AppLink>
        }
      />
      <RouterRoute
        path="/dashboard/:projectId/monitors/:id"
        element={<p>Monitor page</p>}
      />
    </Routes>
  );
};

const renderBoardWithLink: () => HTMLElement = (): HTMLElement => {
  render(
    <BrowserRouter useTransitions={false}>
      <Shell />
    </BrowserRouter>,
  );

  return screen.getByText("Checkout API");
};

const holdWithUnsavedWork: () => void = (): void => {
  LeaveGuard.hold((leave: LeavePageFunction): void => {
    asked.push(leave);
  });
};

beforeEach(() => {
  LeaveGuard.reset();
  asked = [];
  completed = 0;
  window.history.replaceState(null, "", BOARD_PATH);
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
});

describe("an AppLink on a page with nothing unsaved", () => {
  test("opens its page at once, as always", async () => {
    const link: HTMLElement = renderBoardWithLink();

    await act(async () => {
      fireEvent.click(link);
    });

    expect(screen.getByText("Monitor page")).toBeInTheDocument();
    expect(window.location.pathname).toBe(MONITOR_PATH);
    expect(completed).toBe(1);
    expect(asked).toHaveLength(0);
  });
});

describe("an AppLink while the page shown holds unsaved work", () => {
  test("asks, and the router does not move", async () => {
    holdWithUnsavedWork();
    const link: HTMLElement = renderBoardWithLink();

    await act(async () => {
      fireEvent.click(link);
    });

    expect(asked).toHaveLength(1);
    expect(screen.queryByText("Monitor page")).toBeNull();
    expect(window.location.pathname).toBe(BOARD_PATH);
    expect(completed).toBe(0);
  });

  test("Discard Changes opens the page", async () => {
    holdWithUnsavedWork();
    const link: HTMLElement = renderBoardWithLink();

    await act(async () => {
      fireEvent.click(link);
    });
    await act(async () => {
      asked[0]!();
    });

    expect(screen.getByText("Monitor page")).toBeInTheDocument();
    expect(window.location.pathname).toBe(MONITOR_PATH);
    expect(completed).toBe(1);
  });

  test("a Ctrl-click is the browser's new tab: nothing asks, the page stays", async () => {
    holdWithUnsavedWork();
    const link: HTMLElement = renderBoardWithLink();

    await act(async () => {
      fireEvent.click(link, { ctrlKey: true });
    });

    expect(asked).toHaveLength(0);
    expect(window.location.pathname).toBe(BOARD_PATH);
    expect(screen.queryByText("Monitor page")).toBeNull();
  });
});
