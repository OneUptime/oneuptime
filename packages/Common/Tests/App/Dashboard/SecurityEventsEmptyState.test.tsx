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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Security Events with no events: a compact, centred empty state that
 * offers both ways to start sending - the ingest setup guide and the
 * Connections page.
 *
 * It used to be the full-page EmptyState dropped into a table: 13rem of
 * padding above and below, a description running the full table width as
 * one line, and an outline button pinned to the left edge.
 */

const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
      getCurrentPath: (): string => {
        return "/dashboard/11111111-1111-4111-8111-111111111111/security-events";
      },
      getParamByName: (): string => {
        return "11111111-1111-4111-8111-111111111111";
      },
      getCurrentRoute: (): string => {
        return "/dashboard/11111111-1111-4111-8111-111111111111/security-events";
      },
    },
  };
});

import SecurityEventsEmptyState, {
  SECURITY_EVENTS_EMPTY_STATE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsEmptyState";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function renderEmptyState(): RenderResult {
  return render(
    <MemoryRouter>
      <SecurityEventsEmptyState />
    </MemoryRouter>,
  );
}

function root(): HTMLElement {
  return document.getElementById(SECURITY_EVENTS_EMPTY_STATE_ID) as HTMLElement;
}

function expectedRoute(pageMap: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route).toString();
}

function navigatedTo(): Array<string> {
  return navigateMock.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

beforeEach((): void => {
  navigateMock.mockReset();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("SecurityEventsEmptyState", () => {
  test("keeps the id pages and tests target", () => {
    renderEmptyState();

    expect(SECURITY_EVENTS_EMPTY_STATE_ID).toBe("security-events-empty-state");
    expect(root()).toBeInTheDocument();
  });

  test("shows the shield, the title and a description of both ways in", () => {
    renderEmptyState();

    expect(root().querySelector("svg")).not.toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "No security events yet",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`${SECURITY_EVENTS_EMPTY_STATE_ID}-description`),
    ).toHaveTextContent(
      "Send events from any source that can POST JSON — a SIEM, a SOAR webhook, a log forwarder — or connect a security product and OneUptime polls it for you. Every event is normalized to OCSF, whatever dialect it arrives in.",
    );
  });

  test("uses compact table padding rather than the full-page 13rem", () => {
    renderEmptyState();

    expect(root()).toHaveClass("py-4");
    expect(root()).not.toHaveClass("pt-52");
    expect(root()).not.toHaveClass("pb-52");
  });

  /*
   * The list card has no padding of its own, so without a side gutter the
   * text and the full-width phone buttons sat flush against its border. The
   * gutter stops at md, so the desktop spacing is what it was.
   */
  test("keeps a side gutter inside the list card on a phone", () => {
    renderEmptyState();

    expect(root()).toHaveClass("px-4", "md:px-0");
  });

  test("the description is capped to a readable width", () => {
    renderEmptyState();

    expect(
      screen.getByTestId(`${SECURITY_EVENTS_EMPTY_STATE_ID}-description`),
    ).toHaveClass("max-w-xl", "mx-auto");
  });

  test("offers two actions, centred and wrapping, setup guide first", () => {
    renderEmptyState();

    const footer: HTMLElement = screen.getByTestId(
      `${SECURITY_EVENTS_EMPTY_STATE_ID}-footer`,
    );
    expect(footer).toHaveClass("flex", "justify-center");

    const actions: HTMLElement = footer.firstElementChild as HTMLElement;
    expect(actions).toHaveClass(
      "flex",
      "flex-wrap",
      "items-center",
      "justify-center",
      "gap-3",
    );
    expect(
      within(actions)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        }),
    ).toEqual(["Read the setup guide", "Connect a security product"]);
  });

  test("the setup guide is the primary action and the connections link the secondary", () => {
    renderEmptyState();

    const guide: HTMLElement = screen.getByTestId(
      `${SECURITY_EVENTS_EMPTY_STATE_ID}-setup-guide`,
    );
    const connections: HTMLElement = screen.getByTestId(
      `${SECURITY_EVENTS_EMPTY_STATE_ID}-connections`,
    );
    expect(guide).toHaveClass("bg-indigo-600");
    expect(connections).toHaveClass("bg-white", "border-gray-300");
    expect(connections).not.toHaveClass("bg-indigo-600");
    // The row's gap spaces them; the variants' modal margin would not.
    expect(guide).toHaveClass("md:!ml-0");
    expect(connections).toHaveClass("md:!ml-0");
    expect(guide.querySelector("svg")).not.toBeNull();
    expect(connections.querySelector("svg")).not.toBeNull();
  });

  test("Read the setup guide opens the Security Events setup guide", () => {
    renderEmptyState();

    fireEvent.click(
      screen.getByRole("button", { name: "Read the setup guide" }),
    );

    expect(navigatedTo()).toEqual([
      expectedRoute(PageMap.SECURITY_EVENTS_DOCUMENTATION),
    ]);
    expect(navigatedTo()[0]).toMatch(/\/security-events\//);
    expect(navigatedTo()[0]).not.toContain(":projectId");
  });

  test("Connect a security product opens Security Events > Connections", () => {
    renderEmptyState();

    fireEvent.click(
      screen.getByRole("button", { name: "Connect a security product" }),
    );

    expect(navigatedTo()).toEqual([
      expectedRoute(PageMap.SECURITY_EVENTS_CONNECTIONS),
    ]);
    expect(navigatedTo()[0]).toMatch(/\/security-events\/connections$/);
    expect(navigatedTo()[0]).not.toContain(":projectId");
  });

  test("the two actions go to different pages", () => {
    expect(expectedRoute(PageMap.SECURITY_EVENTS_DOCUMENTATION)).not.toBe(
      expectedRoute(PageMap.SECURITY_EVENTS_CONNECTIONS),
    );
  });

  test("nothing navigates until an action is clicked", () => {
    renderEmptyState();

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
