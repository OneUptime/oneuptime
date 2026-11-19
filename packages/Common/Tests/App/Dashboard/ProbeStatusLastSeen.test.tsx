/** @timezone UTC */
import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import ProbeStatusElement, {
  getProbeLastSeenAt,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeStatus";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import { JSONObject } from "../../../Types/JSON";

/*
 * A DISCONNECTED PROBE SAYS WHEN IT WAS LAST HEARD FROM (#9597).
 *
 * The probe lists said "Disconnected" and nothing more: a probe that
 * dropped a minute ago read the same as one gone for a week. Under it now:
 * "Last seen 3 hours ago", from the probe's lastAlive - and nothing where a
 * list did not read it, rather than a "never" nobody measured.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

function probe(data: {
  status: ProbeConnectionStatus;
  lastAlive?: Date | undefined;
}): Probe {
  const row: Probe = new Probe();

  row.connectionStatus = data.status;

  if (data.lastAlive) {
    row.lastAlive = data.lastAlive;
  }

  return row;
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a probe's status", () => {
  test("Disconnected says when it was last seen", () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    render(
      <ProbeStatusElement
        probe={probe({
          status: ProbeConnectionStatus.Disconnected,
          lastAlive: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
        })}
      />,
    );

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByTestId("probe-status-last-seen")).toHaveTextContent(
      "Last seen 3 hours ago",
    );
  });

  test("a list that did not read when it was last seen says nothing of it", () => {
    render(
      <ProbeStatusElement
        probe={probe({ status: ProbeConnectionStatus.Disconnected })}
      />,
    );

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(
      screen.queryByTestId("probe-status-last-seen"),
    ).not.toBeInTheDocument();
  });

  test("Connected says no more than that", () => {
    render(
      <ProbeStatusElement
        probe={probe({
          status: ProbeConnectionStatus.Connected,
          lastAlive: NOW,
        })}
      />,
    );

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(
      screen.queryByTestId("probe-status-last-seen"),
    ).not.toBeInTheDocument();
  });
});

describe("when a probe was last seen", () => {
  test("is read from a date or the API's string, never from nothing", () => {
    expect(
      getProbeLastSeenAt({ lastAlive: NOW } as unknown as JSONObject),
    ).toEqual(NOW);
    expect(
      getProbeLastSeenAt({
        lastAlive: "2026-11-19T09:00:00.000Z",
      } as unknown as JSONObject)?.toISOString(),
    ).toBe("2026-11-19T09:00:00.000Z");
    expect(getProbeLastSeenAt({} as JSONObject)).toBeNull();
    expect(
      getProbeLastSeenAt({ lastAlive: "not a date" } as unknown as JSONObject),
    ).toBeNull();
  });
});
