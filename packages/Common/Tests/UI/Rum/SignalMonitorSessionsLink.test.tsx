import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { buildRumCustomSignalTemplate } from "../../../Types/Monitor/RumAlertTemplates";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The page of a monitor that watches one of a RUM application's own
 * signals (issue #6518) names the signal as it is called now and links to
 * its sessions - the session list filtered to that name. A signal that was
 * deleted says so; any other monitor, and a reader who may not read the
 * application, see nothing of it.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

import SignalMonitorSessionsLink from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/SignalMonitorSessionsLink";

const APP_ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";

function stepOf(signalId: string, name: string): MonitorStep {
  return buildRumCustomSignalTemplate({
    id: signalId,
    name: name,
  }).getMonitorStep({
    rumApplicationId: APP_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Checkout",
  });
}

function applicationWith(customSignals: Array<JSONObject>): JSONObject {
  return {
    _id: APP_ID,
    sessionReplayFrustrationSignals: { customSignals: customSignals },
  };
}

function renderLink(monitorType: MonitorType, step: MonitorStep): void {
  render(
    <MemoryRouter>
      <SignalMonitorSessionsLink monitorType={monitorType} monitorStep={step} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("a monitor on a signal of the application's own", () => {
  test("names the signal as it is called now, and links to its sessions", async () => {
    getItemMock.mockResolvedValue(
      applicationWith([
        {
          id: "signal-payment",
          name: "Payment declined",
          trigger: "page",
          match: "/checkout/error",
        },
      ]),
    );

    // Created while it was called Payment failed; renamed since.
    renderLink(MonitorType.Metrics, stepOf("signal-payment", "Payment failed"));

    const link: HTMLElement = await screen.findByTestId(
      "monitor-signal-see-sessions",
    );

    expect(screen.getByTestId("monitor-signal-sessions")).toHaveTextContent(
      "This monitor counts the recorded sessions that hit your signal Payment declined.See sessions",
    );

    const href: URL = new URL(
      link.getAttribute("href") || "",
      "https://dash.example.com",
    );

    expect(href.pathname.endsWith(`/rum/${APP_ID}/session-replay`)).toBe(true);
    expect(href.searchParams.get("signalName")).toBe("Payment declined");

    const args: JSONObject = getItemMock.mock.calls[0]![0] as JSONObject;

    expect((args["id"] as ObjectID).toString()).toBe(APP_ID);
    expect(args["select"]).toEqual({
      _id: true,
      sessionReplayFrustrationSignals: true,
    });
  });

  test("says so when the application no longer has the signal", async () => {
    getItemMock.mockResolvedValue(applicationWith([]));

    renderLink(MonitorType.Metrics, stepOf("signal-payment", "Payment failed"));

    expect(await screen.findByTestId("monitor-signal-gone")).toHaveTextContent(
      "This monitor's signal is no longer on the application's Frustration Signals page, so no session counts toward it.",
    );
    expect(screen.queryByTestId("monitor-signal-see-sessions")).toBeNull();
  });

  test("shows nothing to a reader who may not read the application", async () => {
    getItemMock.mockRejectedValue(new Error("You do not have permission"));

    renderLink(MonitorType.Metrics, stepOf("signal-payment", "Payment failed"));

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("monitor-signal-sessions")).toBeNull();
    });
    expect(screen.queryByTestId("monitor-signal-gone")).toBeNull();
  });
});

describe("any other monitor", () => {
  test("shows nothing and asks for nothing", () => {
    renderLink(MonitorType.Logs, stepOf("signal-payment", "Payment failed"));

    expect(screen.queryByTestId("monitor-signal-sessions")).toBeNull();
    expect(getItemMock).not.toHaveBeenCalled();
  });
});
