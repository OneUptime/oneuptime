import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The security event detail panel renders observables as pivot chips: with
 * an onCorrelateObservable handler (the Correlate page embeds it that way)
 * a chip pivots in place; without one (the events table) a chip deep-links
 * to the Correlate page with the observable pre-seeded — URL-encoded, since
 * Route.addQueryParams does not encode.
 */

const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<any>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  const routeMap: Record<string, unknown> = {};
  routeMap[PageMap.SECURITY_EVENTS_CORRELATE] = new Route(
    "/dashboard/mock-project/security-events/correlate",
  );
  return {
    __esModule: true,
    default: routeMap,
    RouteUtil: {
      /*
       * Fresh Route per call — addQueryParams mutates the instance, and a
       * shared one would leak query params across tests.
       */
      populateRouteParams: (route: { toString: () => string }) => {
        return new Route(route.toString());
      },
    },
  };
});

/*
 * The component import comes LAST: requiring it instantiates the mock
 * factories above, which reference Route and PageMap — so those must be
 * initialized first.
 */
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Route from "../../../Types/API/Route";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import SecurityEventDetail from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetail";

function buildEvent(observables: Array<string>): SecurityEvent {
  const event: SecurityEvent = new SecurityEvent();
  event.className = "Authentication";
  event.severityName = OcsfSeverity.High;
  event.message = "failed password for alice";
  event.observables = observables;
  return event;
}

beforeEach(() => {
  navigateMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SecurityEventDetail observables", () => {
  test("renders one chip per observable", () => {
    render(
      <SecurityEventDetail
        securityEvent={buildEvent(["wb-ubuntu-03", "alice", "192.168.1.20"])}
        onClose={() => {
          return;
        }}
      />,
    );

    expect(
      screen.getByTestId("security-event-observable-chip-0"),
    ).toHaveTextContent("wb-ubuntu-03");
    expect(
      screen.getByTestId("security-event-observable-chip-1"),
    ).toHaveTextContent("alice");
    expect(
      screen.getByTestId("security-event-observable-chip-2"),
    ).toHaveTextContent("192.168.1.20");
  });

  test("empty observable strings render no chip, and no observables hides the row", () => {
    render(
      <SecurityEventDetail
        securityEvent={buildEvent(["", "alice"])}
        onClose={() => {
          return;
        }}
      />,
    );
    expect(
      screen.getByTestId("security-event-observable-chip-0"),
    ).toHaveTextContent("alice");
    expect(screen.queryByTestId("security-event-observable-chip-1")).toBeNull();

    cleanup();

    render(
      <SecurityEventDetail
        securityEvent={buildEvent([])}
        onClose={() => {
          return;
        }}
      />,
    );
    expect(screen.queryByText("Observables")).toBeNull();
  });

  test("with an onCorrelateObservable handler, a chip pivots in place instead of navigating", () => {
    const onCorrelateMock: MockFunction = getJestMockFunction();

    render(
      <SecurityEventDetail
        securityEvent={buildEvent(["wb-ubuntu-03"])}
        onClose={() => {
          return;
        }}
        onCorrelateObservable={onCorrelateMock as (observable: string) => void}
      />,
    );

    fireEvent.click(screen.getByTestId("security-event-observable-chip-0"));

    expect(onCorrelateMock).toHaveBeenCalledWith("wb-ubuntu-03");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("without a handler, a chip deep-links to Correlate with the observable pre-seeded", () => {
    render(
      <SecurityEventDetail
        securityEvent={buildEvent(["wb-ubuntu-03"])}
        onClose={() => {
          return;
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("security-event-observable-chip-0"));

    expect(navigateMock).toHaveBeenCalledTimes(1);
    const route: Route = navigateMock.mock.calls[0]?.[0] as Route;
    expect(route.toString()).toBe(
      "/dashboard/mock-project/security-events/correlate?observable=wb-ubuntu-03",
    );
  });

  test("observable values are URL-encoded into the deep link", () => {
    render(
      <SecurityEventDetail
        securityEvent={buildEvent(["svc account&admin"])}
        onClose={() => {
          return;
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("security-event-observable-chip-0"));

    const route: Route = navigateMock.mock.calls[0]?.[0] as Route;
    expect(route.toString()).toContain(
      `observable=${encodeURIComponent("svc account&admin")}`,
    );
  });
});
