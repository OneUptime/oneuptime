/** @timezone UTC */
import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import ProbeStatusElement, {
  DISCONNECTED_PROBE_WHAT_TO_CHECK,
  getProbeLastSeenAt,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeStatus";
import { meetsErrorMessageRule } from "../../../Types/Exception/ErrorMessageRule";
import fs from "fs";
import path from "path";
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

/*
 * A PROJECT'S OWN DISCONNECTED PROBE SAYS WHAT TO CHECK (#7273).
 *
 * "Disconnected" and "Last seen" said that it was gone, and nothing about
 * why. One of the project's own probes - which the person runs - says
 * what to check under them; a global probe is not theirs to check.
 */
describe("what to check when a project's own probe is disconnected", () => {
  test("its container, and the probe's ID and key", () => {
    render(
      <ProbeStatusElement
        probe={probe({ status: ProbeConnectionStatus.Disconnected })}
        isProjectProbe={true}
      />,
    );

    expect(screen.getByTestId("probe-status-what-to-check")).toHaveTextContent(
      DISCONNECTED_PROBE_WHAT_TO_CHECK,
    );
    expect(DISCONNECTED_PROBE_WHAT_TO_CHECK).toContain("container");
    expect(DISCONNECTED_PROBE_WHAT_TO_CHECK).toContain("PROBE_ID");
    expect(DISCONNECTED_PROBE_WHAT_TO_CHECK).toContain("PROBE_KEY");
    expect(meetsErrorMessageRule(DISCONNECTED_PROBE_WHAT_TO_CHECK)).toBe(true);
  });

  test("not for a global probe, which is not the project's to check", () => {
    render(
      <ProbeStatusElement
        probe={probe({ status: ProbeConnectionStatus.Disconnected })}
      />,
    );

    expect(
      screen.queryByTestId("probe-status-what-to-check"),
    ).not.toBeInTheDocument();
  });

  test("not while it is connected", () => {
    render(
      <ProbeStatusElement
        probe={probe({
          status: ProbeConnectionStatus.Connected,
          lastAlive: NOW,
        })}
        isProjectProbe={true}
      />,
    );

    expect(
      screen.queryByTestId("probe-status-what-to-check"),
    ).not.toBeInTheDocument();
  });

  test("the project's probe list and a probe's page ask for it, the global list does not", () => {
    const settings: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings",
    );
    const list: string = fs.readFileSync(
      path.join(settings, "MonitorProbes.tsx"),
      "utf8",
    );
    const page: string = fs.readFileSync(
      path.join(settings, "MonitorProbeView.tsx"),
      "utf8",
    );

    // Two lists: the global probes', then the project's own.
    expect(list.match(/<ProbeStatusElement /g)?.length).toBe(2);
    expect(list.match(/isProjectProbe=\{true\}/g)?.length).toBe(1);
    expect(list.indexOf("isProjectProbe={true}")).toBeGreaterThan(
      list.indexOf('id="probes-table"'),
    );
    expect(page).toContain("isProjectProbe={true}");
  });
});
