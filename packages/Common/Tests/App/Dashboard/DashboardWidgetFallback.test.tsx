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
  within,
} from "@testing-library/react";
import React from "react";
import DashboardWidgetFallback, {
  ComponentProps,
  DASHBOARD_WIDGET_FALLBACK_TEST_ID,
  DashboardWidgetProblem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetFallback";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import { findNestedControls } from "../../Helpers/NestedControls";

/*
 * What a dashboard widget shows in its own place when it cannot be drawn
 * (issue #4571), in every state it has: a type this version does not draw,
 * no type at all, a widget that threw; while viewing and while editing; for
 * someone who may edit the dashboard, a reader, and a public dashboard's
 * anonymous visitor.
 */

function renderFallback(props: Partial<ComponentProps>): HTMLElement {
  render(
    <DashboardWidgetFallback
      problem={DashboardWidgetProblem.UnknownType}
      componentType="HostMetricChart"
      isEditMode={false}
      {...props}
    />,
  );

  return screen.getByTestId(DASHBOARD_WIDGET_FALLBACK_TEST_ID);
}

function buttonNames(card: HTMLElement): Array<string> {
  return within(card)
    .queryAllByRole("button")
    .map((button: HTMLElement) => {
      return (button.textContent || "").trim();
    });
}

function enterPublicDashboard(): void {
  setPublicDashboardContext({
    dashboardId: new ObjectID("d4d4d4d4-1111-4111-8111-d4d4d4d4d4d4"),
    apiUrl: URL.fromString("http://localhost/public-dashboard-api"),
    postJSON: () => {
      return Promise.reject(new Error("not used"));
    },
    apiClient: {} as PublicDashboardContext["apiClient"],
  });
}

beforeEach(() => {
  setPublicDashboardContext(null);
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("a widget of a type this version does not draw", () => {
  test("says it could not be shown, and names the type it was stored with", () => {
    const card: HTMLElement = renderFallback({});

    expect(card).toHaveAttribute("data-problem", "UnknownType");
    expect(
      within(card).getByText("This widget could not be shown"),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("dashboard-widget-fallback-reason"),
    ).toHaveTextContent('OneUptime has no "HostMetricChart" widget.');
  });

  test("a widget with no type says so instead of naming an empty one", () => {
    const card: HTMLElement = renderFallback({ componentType: "" });

    expect(
      within(card).getByTestId("dashboard-widget-fallback-reason"),
    ).toHaveTextContent("It does not say which kind of widget it is.");
  });

  test("a type of only spaces counts as none", () => {
    const card: HTMLElement = renderFallback({ componentType: "   " });

    expect(
      within(card).getByTestId("dashboard-widget-fallback-reason"),
    ).toHaveTextContent("It does not say which kind of widget it is.");
  });

  test("offers no Try again: drawing it again cannot work", () => {
    const card: HTMLElement = renderFallback({
      onRetry: () => {
        return undefined;
      },
    });

    expect(
      within(card).queryByTestId("dashboard-widget-fallback-retry"),
    ).toBeNull();
  });

  test("offers Edit widget to someone who may edit, and calls it", () => {
    const onEditWidgetClick: jest.Mock<() => void> = jest.fn<() => void>();
    const card: HTMLElement = renderFallback({ onEditWidgetClick });

    expect(buttonNames(card)).toEqual(["Edit widget"]);

    fireEvent.click(within(card).getByTestId("dashboard-widget-fallback-edit"));
    expect(onEditWidgetClick).toHaveBeenCalledTimes(1);
  });

  test("offers a reader nothing to click", () => {
    const card: HTMLElement = renderFallback({});

    expect(buttonNames(card)).toEqual([]);
  });

  test("shows no error details: nothing was thrown", () => {
    const card: HTMLElement = renderFallback({});

    expect(
      within(card).queryByTestId("dashboard-widget-fallback-details"),
    ).toBeNull();
  });
});

describe("a widget that threw while it was drawn", () => {
  const ERROR: Error = new Error(
    "Cannot read properties of undefined (reading 'metricQueryConfigs')",
  );

  test("says something went wrong while drawing it", () => {
    const card: HTMLElement = renderFallback({
      problem: DashboardWidgetProblem.Crashed,
      componentType: "Chart",
      error: ERROR,
    });

    expect(card).toHaveAttribute("data-problem", "Crashed");
    expect(
      within(card).getByText("This widget could not be shown"),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("dashboard-widget-fallback-reason"),
    ).toHaveTextContent("Something went wrong while drawing it.");
  });

  test("offers Try again, which draws it again", () => {
    const onRetry: jest.Mock<() => void> = jest.fn<() => void>();
    const card: HTMLElement = renderFallback({
      problem: DashboardWidgetProblem.Crashed,
      componentType: "Chart",
      error: ERROR,
      onRetry,
    });

    expect(buttonNames(card)).toEqual(["Try again"]);

    fireEvent.click(
      within(card).getByTestId("dashboard-widget-fallback-retry"),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("offers Try again and Edit widget to someone who may edit", () => {
    const card: HTMLElement = renderFallback({
      problem: DashboardWidgetProblem.Crashed,
      componentType: "Chart",
      error: ERROR,
      onRetry: () => {
        return undefined;
      },
      onEditWidgetClick: () => {
        return undefined;
      },
    });

    expect(buttonNames(card)).toEqual(["Try again", "Edit widget"]);
  });

  test("keeps what was thrown under a closed Details, for support", () => {
    const card: HTMLElement = renderFallback({
      problem: DashboardWidgetProblem.Crashed,
      componentType: "Chart",
      error: ERROR,
    });

    const details: HTMLElement = within(card).getByTestId(
      "dashboard-widget-fallback-details",
    );

    expect(details.tagName).toBe("DETAILS");
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("Details")).toBeInTheDocument();
    expect(details).toHaveTextContent(ERROR.message);
  });
});

describe("while the dashboard is being edited", () => {
  test("says the widget itself opens its settings, and offers no buttons under the edit overlay", () => {
    const card: HTMLElement = renderFallback({
      isEditMode: true,
      onEditWidgetClick: () => {
        return undefined;
      },
    });

    expect(
      within(card).getByTestId("dashboard-widget-fallback-edit-hint"),
    ).toHaveTextContent("Click it to edit or delete it.");
    expect(buttonNames(card)).toEqual([]);
  });

  test("a widget that threw offers no Try again while editing either", () => {
    const card: HTMLElement = renderFallback({
      problem: DashboardWidgetProblem.Crashed,
      isEditMode: true,
      error: new Error("x"),
      onRetry: () => {
        return undefined;
      },
    });

    expect(buttonNames(card)).toEqual([]);
  });

  test("no hint while viewing", () => {
    const card: HTMLElement = renderFallback({});

    expect(
      within(card).queryByTestId("dashboard-widget-fallback-edit-hint"),
    ).toBeNull();
  });
});

describe("on a public dashboard", () => {
  beforeEach(() => {
    enterPublicDashboard();
  });

  test("a visitor is told only that the widget could not be shown: not its type", () => {
    const card: HTMLElement = renderFallback({
      onEditWidgetClick: () => {
        return undefined;
      },
    });

    expect(
      within(card).getByText("This widget could not be shown"),
    ).toBeInTheDocument();
    expect(
      within(card).queryByTestId("dashboard-widget-fallback-reason"),
    ).toBeNull();
    expect(card).not.toHaveTextContent("HostMetricChart");
    expect(buttonNames(card)).toEqual([]);
  });

  test("a widget that threw offers Try again, but never the error", () => {
    const card: HTMLElement = renderFallback({
      problem: DashboardWidgetProblem.Crashed,
      componentType: "Chart",
      error: new Error("internal detail"),
      onRetry: () => {
        return undefined;
      },
    });

    expect(buttonNames(card)).toEqual(["Try again"]);
    expect(card).not.toHaveTextContent("internal detail");
    expect(
      within(card).queryByTestId("dashboard-widget-fallback-details"),
    ).toBeNull();
  });
});

describe("the card itself", () => {
  test("fills the widget's place, scrolls, and centres its contents with auto margins", () => {
    const card: HTMLElement = renderFallback({});

    expect(card.className).toContain("w-full");
    expect(card.className).toContain("h-full");
    // A small widget scrolls its note rather than spilling over its neighbours.
    expect(card.className).toContain("overflow-auto");

    /*
     * Centred by m-auto, not justify-center: a note taller than its widget
     * then starts at the top and scrolls, where justify-center would cut
     * it off above the top edge, out of the scroll's reach.
     */
    const content: HTMLElement = card.firstElementChild as HTMLElement;
    expect(content.className).toContain("m-auto");
    expect(card.className).not.toContain("justify-center");
  });

  test("shows its icon, unless the widget is too short for it", () => {
    renderFallback({});
    expect(
      screen.getByTestId("dashboard-widget-fallback-icon"),
    ).toBeInTheDocument();
    cleanup();

    const compact: HTMLElement = renderFallback({ isCompact: true });
    expect(
      within(compact).queryByTestId("dashboard-widget-fallback-icon"),
    ).toBeNull();
    // Everything that says something stays.
    expect(compact).toHaveTextContent("This widget could not be shown");
    expect(compact).toHaveTextContent(
      'OneUptime has no "HostMetricChart" widget.',
    );
  });

  test("spaces its buttons with the row's gap, not the shared Button's form margins", () => {
    const card: HTMLElement = renderFallback({
      problem: DashboardWidgetProblem.Crashed,
      error: new Error("x"),
      onRetry: () => {
        return undefined;
      },
      onEditWidgetClick: () => {
        return undefined;
      },
    });

    const row: HTMLElement = within(card).getByTestId(
      "dashboard-widget-fallback-retry",
    ).parentElement as HTMLElement;

    expect(row.className).toContain("gap-2");
    expect(row.className).toContain("[&_button]:ml-0");
    expect(row.className).toContain("[&_button]:w-auto");
    expect(row.className).toContain("flex-wrap");
  });

  test("draws no control inside another", () => {
    const card: HTMLElement = renderFallback({
      problem: DashboardWidgetProblem.Crashed,
      error: new Error("x"),
      onRetry: () => {
        return undefined;
      },
      onEditWidgetClick: () => {
        return undefined;
      },
    });

    expect(findNestedControls(card)).toEqual([]);
  });
});
